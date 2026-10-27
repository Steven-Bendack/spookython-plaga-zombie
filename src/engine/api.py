"""Use cases exposed to the outside world (local server, AWS Lambda, CLI).

Input and output are plain dicts (JSON), so adapters stay thin.
"""
from __future__ import annotations

import os
import subprocess
import time

import numpy as np

from .config import ENGINE_VERSION, SimConfig
from dataclasses import replace

from .montecarlo import Runner, paired, policy_summary, rank_candidates, run_many, run_policies, serial_runner, tournament
from .population import BARRIO_NAMES, BARRIOS, build_city
from .seir import simulate_policy
from .strategies import (BASELINES, CANDIDATES, DESCRIPTIONS, LABELS, PLAYER_GROUPS, PLAYER_MAX_GROUPS,
                         player_label, player_policy)

# Surprise Outbreak presets (the jury's own examples), relative to the defaults.
PRESETS = {
    "base": {"label": "Escenario base", "changes": {}},
    "double_r0": {"label": "El doble de contagiosa", "changes": {"r0": 4.0}},
    "half_doses": {"label": "La mitad de las vacunas", "changes": {"doses_per_day": 20}},
    "market": {"label": "Empieza en el mercado", "changes": {"seed_location": "market"}},
    "weak_vaccine": {"label": "Variante: la vacuna cubre a medias", "changes": {"vaccine_efficacy": 0.5}},
}


def simulate(request: dict, runner: Runner = serial_runner) -> dict:
    started = time.perf_counter()
    cfg = SimConfig.from_dict(request)
    result = tournament(cfg, runner)
    best = result["ranking"][0]
    summaries = result["summaries"]
    wants_plans = cfg.close_market or cfg.close_schools or cfg.budget > 0
    plans = (closure_plans(cfg, best["name"], result["runs"], runner)
             if request.get("compare_plans", wants_plans) else None)
    return {
        "config": cfg.to_dict(),
        "certificate": certificate(cfg),
        "calibration": {"r0_target": cfg.r0, "beta": result["beta"]},
        "manta_scale": cfg.manta_scale,
        "policies": {
            "none": _policy_out("none", summaries["none"]),
            "random": _policy_out("random", summaries["random"]),
            "strategy": _policy_out(best["name"], summaries[best["name"]]),
        },
        "candidates": [
            {**r, "label": LABELS[r["name"]], "description": DESCRIPTIONS[r["name"]],
             "summary": _policy_out(r["name"], summaries[r["name"]])}
            for r in result["ranking"]
        ],
        "saved_vs_none": best["vs_none"],
        "saved_vs_random": best["vs_random"],
        "win_rate_vs_random": best["vs_random"]["win_rate"],
        "win_rate_vs_none": best["vs_none"]["win_rate"],
        "random_vs_none": result["random_vs_none"],
        "wasted_doses": {"mean": summaries[best["name"]]["doses_wasted"],
                         "share": summaries[best["name"]]["wasted_share"]},
        "recommendation_text": recommendation_text(cfg, best),
        "map": map_payload(cfg, result["beta"], best),
        "closure_plans": plans,
        "elapsed_seconds": round(time.perf_counter() - started, 2),
    }


def challenge(request: dict, runner: Runner = serial_runner) -> dict:
    """«¿Le ganas al comité?»: the player's plan against the committee's pick.

    Same config, same seeds, same doses: the player's plan, Nada, Azar and the
    committee's candidates all face the same epidemic luck in every run. The
    committee chooses its strategy exactly as in simulate() and is compared with
    the player run by run.
    """
    started = time.perf_counter()
    cfg = SimConfig.from_dict({**request, "strategy": "auto"})
    player = player_policy(request.get("plan") or [])
    beta, runs = run_policies(cfg, BASELINES + CANDIDATES + (player,), runner)
    committee = rank_candidates(runs, CANDIDATES)[0]
    none, rnd, mine, theirs = runs["none"], runs["random"], runs[player], runs[committee]
    vs_player = paired(mine, theirs)  # people the committee saved beyond the player's plan
    out = {
        "config": cfg.to_dict(),
        "certificate": {**certificate(cfg), "plan": player},
        "manta_scale": cfg.manta_scale,
        "player": {"label": player_label(player), "plan": player.split(":", 1)[1].split(","),
                   "vs_none": paired(none, mine), "vs_random": paired(rnd, mine),
                   "summary": policy_summary(mine, cfg.population)},
        "committee": {"name": committee, "label": LABELS[committee], "description": DESCRIPTIONS[committee],
                      "vs_none": paired(none, theirs), "vs_random": paired(rnd, theirs),
                      "summary": policy_summary(theirs, cfg.population)},
        "committee_vs_player": vs_player,
        "curves": {"none": policy_summary(none, cfg.population)["curves"]["I"],
                   "random": policy_summary(rnd, cfg.population)["curves"]["I"]},
        "player_wins": vs_player["median"] < 0,
        "elapsed_seconds": 0.0,
    }
    out["verdict_text"] = challenge_text(cfg, out)
    out["elapsed_seconds"] = round(time.perf_counter() - started, 2)
    return out


def challenge_text(cfg: SimConfig, out: dict) -> str:
    gap = out["committee_vs_player"]
    committee_wins = round(gap["win_rate"] * cfg.runs)
    player_wins = round(gap["loss_rate"] * cfg.runs)
    mine = out["player"]["vs_none"]["mean"]
    theirs = out["committee"]["vs_none"]["mean"]
    scale = cfg.manta_scale
    if out["player_wins"]:
        return (f"¡Le ganaste al comité! Tu plan evita {_num(mine)} contagios frente a no hacer nada "
                f"y el comité ({out['committee']['label']}) {_num(theirs)}. Con la misma suerte, tu plan "
                f"gana en {player_wins} de {cfg.runs} semillas. Prueba otra semilla: ¿sigue ganando?")
    return (f"Gana el comité con «{out['committee']['label']}». Con las mismas dosis y la misma suerte "
            f"evita {_num(gap['mean'])} contagios más que tu plan (≈ {_num(gap['mean'] * scale)} personas "
            f"en Manta) y gana en {committee_wins} de {cfg.runs} semillas. Tu plan evita {_num(mine)} "
            f"frente a no hacer nada; el comité, {_num(theirs)}.")


PLAN_RUNS = 40  # runs per closure plan (paired with the first runs of "Nada")

PLAN_LABELS = {
    (False, False): "Solo vacunas",
    (True, False): "Vacunas + cerrar el mercado",
    (False, True): "Vacunas + cerrar los colegios",
    (True, True): "Vacunas + cerrar mercado y colegios",
}


def closure_plans(cfg: SimConfig, strategy: str, runs: dict, runner: Runner) -> dict:
    """Same seeds, same budget, same vaccine strategy: which closures pay off?

    Each plan closes its places while at least `closure_trigger` Zombies are
    detected, paying each closed day from the shared budget (1 unit = 1 dose).
    """
    combos = list(PLAN_LABELS)
    k = min(cfg.runs, PLAN_RUNS)  # the first k runs: same seeds as the tournament
    jobs = [(replace(cfg, runs=k, close_market=m, close_schools=sc), (strategy,)) for m, sc in combos]
    results = run_many(jobs, runner, chunk_runs=10)
    full = runs["none"]
    none = replace(full, infected=full.infected[:k])
    plans = []
    for (m, sc), (_, res) in zip(combos, results):
        r = res[strategy]
        vs_none = paired(none, r)
        plans.append({
            "market": m, "schools": sc, "label": PLAN_LABELS[(m, sc)],
            "infected_mean": float(r.infected.mean()),
            "saved_vs_none": vs_none["mean"], "saved_median": vs_none["median"],
            "spent": float(r.spent.mean()),
            "market_days": float(r.closed_days[:, 0].mean()),
            "schools_days": float(r.closed_days[:, 1].mean()),
        })
    best = max(plans, key=lambda p: (p["saved_median"], p["saved_vs_none"]))
    base = plans[0]
    extra = best["saved_vs_none"] - base["saved_vs_none"]
    if best is base:
        text = "Con este presupuesto conviene gastar todo en vacunas: ningún cierre evita más contagios."
    else:
        text = (f"Recomendación de cierres: «{best['label'].lower()}». Evita {_num(extra)} contagios más que "
                f"solo vacunar, con ≈ {_num(best['market_days'] + best['schools_days'])} días de cierre "
                f"en promedio y un gasto de {_num(best['spent'])} unidades.")
    return {"plans": plans, "best": best["label"], "text": text, "runs": k,
            "budget": cfg.budget, "trigger": cfg.closure_trigger,
            "costs": {"dose": 1, "market_day": cfg.market_cost, "schools_day": cfg.school_cost}}


def map_payload(cfg: SimConfig, beta: float, best: dict) -> dict:
    """The typical run, replayed person by person for the map.

    The typical run is the one whose people saved vs Nada is the median, so the
    map shows neither a lucky nor an unlucky seed. It is simulated again on its
    own (same streams, same result) for Nada, Azar and the best strategy.
    Each point is [lat, lon, day] with lat/lon as integers in 1e-4 degrees.
    """
    saved = np.asarray(best["vs_none"]["per_run"])
    run = int(np.argsort(saved)[len(saved) // 2])
    city = build_city(cfg.population, cfg.city_seed)
    coords = np.rint(city.coords * 10_000).astype(int)

    def points(days: np.ndarray) -> list:
        idx = np.flatnonzero(days >= 0)
        return np.column_stack([coords[idx], days[idx]]).tolist()

    out = {"days": cfg.days, "run": run + 1,
           "barrios": [{"name": b[0], "lat": b[1], "lon": b[2]} for b in BARRIOS]}
    for key, name in (("none", "none"), ("random", "random"), ("strategy", best["name"])):
        res = simulate_policy(city, cfg, beta, name, run_ids=[run])
        out[key] = {"label": LABELS[name], "bitten": points(res.bitten_day),
                    "vaccinated": points(res.vaccinated_day),
                    # S, E, I, R, V of this run, day by day (the progress bar)
                    "counts": res.counts[0].tolist(),
                    # [market closed, schools closed] each day of this run
                    "closed": res.closed_first.astype(int).tolist()}
    return out


def _policy_out(name: str, summary: dict) -> dict:
    return {"name": name, "label": LABELS[name], **summary}


def recommendation_text(cfg: SimConfig, best: dict) -> str:
    scale = cfg.manta_scale
    vs_none, vs_rnd = best["vs_none"], best["vs_random"]
    wins = round(vs_rnd["win_rate"] * cfg.runs)
    text = (
        f"Con estas condiciones, la mejor opción es «{LABELS[best['name']]}»: "
        f"{DESCRIPTIONS[best['name']].lower()}. "
        f"Frente a no hacer nada evita en promedio {_num(vs_none['mean'])} contagios en la simulación "
        f"(entre {_num(vs_none['p5'])} y {_num(vs_none['p95'])} en el 90 % de las corridas), "
        f"unas {_num(vs_none['mean'] * scale)} personas en Manta. "
        f"Frente a vacunar al azar con las mismas dosis evita {_num(vs_rnd['mean'])} contagios más "
        f"y gana en {wins} de {cfg.runs} semillas."
    )
    if vs_rnd["win_rate"] < 0.6:
        text += (" Ojo: en estas condiciones la vacunación cambia poco el resultado; "
                 "hace falta sumar otras medidas (cierres, cuarentena) o más dosis.")
    return text


def _num(x: float) -> str:
    """Spanish-style thousands separator: 12 345."""
    return f"{x:,.0f}".replace(",", " ")


def certificate(cfg: SimConfig) -> dict:
    return {
        "config_hash": cfg.config_hash(),
        "seed": cfg.seed,
        "city_seed": cfg.city_seed,
        "engine_version": ENGINE_VERSION,
        "commit": git_commit(),
    }


def git_commit() -> str:
    env = os.environ.get("GIT_COMMIT")
    if env:
        return env[:12]
    stamped = os.path.join(os.path.dirname(__file__), "COMMIT")  # written by deploy scripts
    if os.path.exists(stamped):
        return open(stamped, encoding="utf-8").read().strip()[:12]
    try:
        out = subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], capture_output=True,
                             text=True, timeout=5, cwd=os.path.dirname(__file__))
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def meta() -> dict:
    """Defaults, limits, presets and city facts for the UI."""
    cfg = SimConfig()
    city = build_city(cfg.population, cfg.city_seed)
    return {
        "defaults": cfg.to_dict(),
        "presets": PRESETS,
        "seed_locations": [
            {"value": "random", "label": "Cualquier lugar"},
            {"value": "market", "label": "Mercado central"},
            {"value": "school", "label": "Un colegio"},
            *({"value": b, "label": f"Barrio {b}"} for b in BARRIO_NAMES),
        ],
        "player_groups": [{"value": k, "label": v} for k, v in PLAYER_GROUPS.items()],
        "player_max_groups": PLAYER_MAX_GROUPS,
        "strategies": [{"value": k, "label": v, "description": DESCRIPTIONS[k]}
                       for k, v in LABELS.items() if k not in ("none", "random")],
        "city": city.summary(),
        "manta_scale": cfg.manta_scale,
        "engine_version": ENGINE_VERSION,
    }
