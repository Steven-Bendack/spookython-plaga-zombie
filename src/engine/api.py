"""Use cases exposed to the outside world (local server, AWS Lambda, CLI).

Input and output are plain dicts (JSON), so adapters stay thin.
"""
from __future__ import annotations

import os
import subprocess
import time

import numpy as np

from .config import ENGINE_VERSION, SimConfig
from .montecarlo import Runner, serial_runner, tournament
from .population import BARRIO_NAMES, BARRIOS, build_city
from .seir import simulate_policy
from .strategies import DESCRIPTIONS, LABELS

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
        "elapsed_seconds": round(time.perf_counter() - started, 2),
    }


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
                    "vaccinated": points(res.vaccinated_day)}
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
        "strategies": [{"value": k, "label": v, "description": DESCRIPTIONS[k]}
                       for k, v in LABELS.items() if k not in ("none", "random")],
        "city": city.summary(),
        "manta_scale": cfg.manta_scale,
        "engine_version": ENGINE_VERSION,
    }
