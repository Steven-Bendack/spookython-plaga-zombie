"""Committee Mode: the player is the containment committee, week by week.

Stateless on purpose: every turn the browser sends the whole list of weekly
decisions and the engine replays the same run from day 0. Same seed + same
decisions = same city, so it works the same locally, on Vercel and on Lambda.

The player sees what a real committee would see: only DETECTED Zombies.
At the end everything is revealed and compared, on the same run, with doing
nothing, with random vaccination and with the automatic committee.
"""
from __future__ import annotations

from dataclasses import replace

import numpy as np

from .calibrate import calibrated_beta
from .config import SimConfig
from .disease import edge_log_survival, infection_pressure, sample_durations
from .montecarlo import rank_candidates, run_policies
from .population import BARRIO_NAMES, MARKET, SCHOOL, build_city
from .seir import (E, I, R, S, V, _FATES, _INFECTION, _SEEDING, _top_k, pick_initial_cases,
                   policy_code, run_stream, simulate_policy)
from .strategies import CANDIDATES, LABELS, Visible, priority_keys

WEEK = 7
MODES = ("ring", "degree", "random", "barrio")
MODE_LABELS = {
    "ring": "Contactos de los casos detectados",
    "degree": "Los más conectados",
    "random": "Al azar",
    "barrio": "Todo a un barrio",
}
DIFFICULTY = {
    "normal": {"label": "Normal", "changes": {}},
    "hard": {"label": "Difícil", "changes": {"r0": 3.0, "doses_per_day": 15}},
    "nightmare": {"label": "Pesadilla", "changes": {"r0": 4.0, "doses_per_day": 10, "detection_prob": 0.4}},
}
GAME_RUN = 0      # the run of the chosen seed that the player watches
SCORE_RUNS = 10   # the final score replays the player's plan on these runs, like the rivals


def game_config(seed: int, difficulty: str) -> SimConfig:
    level = DIFFICULTY.get(difficulty, DIFFICULTY["normal"])
    return replace(SimConfig(seed=seed, runs=1, days=154), **level["changes"]).validated()


def play(seed: int, difficulty: str, decisions: list[dict]) -> dict:
    """Replay the game up to the end of the last decided week."""
    cfg = game_config(int(seed), difficulty)
    decisions = [_clean(d) for d in decisions][: cfg.days // WEEK]
    city = build_city(cfg.population, cfg.city_seed)
    beta = calibrated_beta(cfg.population, cfg.city_seed, cfg.r0, cfg.infectious_mean)
    sim = _simulate(city, cfg, beta, decisions)
    over = sim["over"] or len(decisions) * WEEK >= cfg.days
    out = {
        "seed": cfg.seed, "difficulty": difficulty, "config": cfg.to_dict(),
        "day": sim["day"], "week": len(decisions), "over": over,
        "budget_left": sim["budget_left"], "weekly_budget": _weekly_budget(cfg),
        "costs": {"dose": 1, "market_week": cfg.market_cost * WEEK, "schools_week": cfg.school_cost * WEEK},
        # What the committee can see: detected Zombies that are still sick, and its own doses.
        "visible": {
            "zombies": _points(city, sim["visible_now"]),
            "vaccinated": _points(city, sim["vaccinated_day"] >= 0),
            "detected_total": sim["detected_total"],
            "doses_total": sim["doses_total"],
            "detected_series": sim["detected_series"],
        },
        "news": sim["news"],
        "modes": MODE_LABELS, "barrios": list(BARRIO_NAMES),
    }
    if over:
        out["result"] = _reveal(city, cfg, beta, sim, decisions)
    return out


def _clean(d: dict) -> dict:
    mode = d.get("mode") if d.get("mode") in MODES else "ring"
    barrio = d.get("barrio") if d.get("barrio") in BARRIO_NAMES else BARRIO_NAMES[0]
    return {"mode": mode, "barrio": barrio,
            "market": bool(d.get("market")), "schools": bool(d.get("schools"))}


def _weekly_budget(cfg: SimConfig) -> float:
    return float(cfg.doses_per_day * WEEK)


def _points(city, mask: np.ndarray) -> list:
    idx = np.flatnonzero(mask)
    coords = np.rint(city.coords[idx] * 10_000).astype(int)
    return coords.tolist()


def _simulate(city, cfg: SimConfig, beta: float, decisions: list[dict], k: int = GAME_RUN) -> dict:
    """One run, same random streams as the rest of the engine, with the player's plan."""
    n = city.n
    infection_rng = run_stream(cfg.seed, k, _INFECTION)
    fate_rng = run_stream(cfg.seed, k, _FATES)
    latent_days = sample_durations(fate_rng, cfg.latent_mean, n)
    sick_days = sample_durations(fate_rng, cfg.infectious_mean, n)
    will_be_detected = fate_rng.random(n) < cfg.detection_prob
    dose_works = fate_rng.random(n) < cfg.vaccine_efficacy
    policy_rng = {m: run_stream(cfg.seed, k, policy_code("game-" + m)) for m in MODES}

    log_surv = edge_log_survival(city, beta)
    shut = {(m, s): np.where(((city.layer == MARKET) & m) | ((city.layer == SCHOOL) & s), 0.0, log_surv)
            for m in (False, True) for s in (False, True)}

    state = np.full(n, S, dtype=np.int8)
    timer = np.zeros(n, dtype=np.int16)
    zombie_since = np.full(n, -1, dtype=np.int32)
    detected = np.zeros(n, dtype=bool)
    vaccinated = np.zeros(n, dtype=bool)
    bitten_day = np.full(n, -1, dtype=np.int16)
    vaccinated_day = np.full(n, -1, dtype=np.int16)
    seeds = pick_initial_cases(city, cfg, run_stream(cfg.seed, k, _SEEDING))
    state[seeds] = I
    timer[seeds] = sick_days[seeds]
    zombie_since[seeds] = 0
    bitten_day[seeds] = 0

    budget = 0.0
    news, detected_series = [], []
    counts = [np.bincount(state, minlength=5).tolist()]
    last_day = len(decisions) * WEEK
    reached = set()
    over = False
    day = 0
    for day in range(1, last_day + 1):
        week = (day - 1) // WEEK
        plan = decisions[week]
        if (day - 1) % WEEK == 0:
            budget += _weekly_budget(cfg)
        # Closures chosen for the week are paid day by day while there is budget.
        close = [plan["market"], plan["schools"]]
        cost = cfg.market_cost * close[0] + cfg.school_cost * close[1]
        if cost > budget:
            close = [False, False]
            if plan["market"] or plan["schools"]:
                news.append({"day": day, "text": f"Día {day}: no alcanza el presupuesto para mantener los cierres."})
        else:
            budget -= cost

        zombie = state == I
        sick = zombie | (state == E)
        luck = infection_rng.standard_exponential(n, dtype=np.float32)
        if sick.any():
            pressure = infection_pressure(city, shut[(close[0], close[1])], zombie[None, :])[0]
            newly = (state == S) & (luck < pressure)
        else:
            newly = np.zeros(n, dtype=bool)
        bitten_day[newly] = day

        timer -= sick
        done = sick & (timer <= 0)
        turning = done & ~zombie
        state[done & zombie] = R
        state[turning] = I
        timer[turning] = sick_days[turning]
        zombie_since[turning] = day
        state[newly] = E
        timer[newly] = latent_days[newly]

        zombie = state == I
        new_detect = zombie & will_be_detected & ~detected & (day - zombie_since >= cfg.detection_delay)
        detected |= new_detect
        for a in np.flatnonzero(new_detect):
            b = BARRIO_NAMES[city.barrio[a]]
            if b not in reached:
                reached.add(b)
                news.append({"day": day, "text": f"Día {day}: primer caso confirmado en {b}."})

        # Doses: what the budget allows today, aimed the way the player chose.
        if day >= cfg.vaccine_start_day and budget >= 1:
            doses = int(min(cfg.doses_per_day, budget))
            eligible = ~vaccinated & ~detected
            if not ((state == E) | zombie).any():
                eligible[:] = False
            mode = plan["mode"]
            rng = [policy_rng[mode]]
            seen = Visible(visible_zombie=(detected & zombie)[None, :], rng=rng)
            if mode == "barrio":
                noise = rng[0].random(n)
                keys = noise + (city.barrio == BARRIO_NAMES.index(plan["barrio"])) * 2.0
            else:
                keys = priority_keys("ring" if mode == "ring" else mode, city, seen)[0]
            keys = np.where(eligible, keys, -np.inf)
            chosen = _top_k(keys[None, :], doses)[0]
            vaccinated |= chosen
            vaccinated_day[chosen] = day
            budget -= chosen.sum()
            state[chosen & (state == S) & dose_works] = V

        detected_series.append(int((detected & (state == I)).sum()))
        counts.append(np.bincount(state, minlength=5).tolist())
        if not ((state == E) | (state == I)).any():
            over = True
            news.append({"day": day, "text": f"Día {day}: no queda ningún zombi en Manta."})
            break

    return {
        "day": day, "over": over, "budget_left": budget,
        "visible_now": detected & (state == I),
        "detected_total": int(detected.sum()), "doses_total": int(vaccinated.sum()),
        "detected_series": detected_series, "news": news[-12:],
        "bitten_day": bitten_day, "vaccinated_day": vaccinated_day, "counts": counts,
        "infected": int((bitten_day >= 0).sum()),
    }


def _reveal(city, cfg: SimConfig, beta: float, sim: dict, decisions: list[dict]) -> dict:
    """The truth, and the player's plan against nobody, chance and the automatic committee.

    The plan is replayed on the same SCORE_RUNS runs the rivals use, so one
    lucky or unlucky run does not decide the verdict.
    """
    days = max(sim["day"], 1)
    runs = list(range(SCORE_RUNS))
    # The automatic committee chooses with training seeds, like in Jury Mode.
    train = replace(cfg, runs=10, seed=cfg.seed + 10_000)
    _, train_runs = run_policies(train, ("random",) + CANDIDATES)
    auto = rank_candidates(train_runs, CANDIDATES)[0]
    you_runs = np.array([sim["infected"]] + [_simulate(city, cfg, beta, decisions, k)["infected"] for k in runs[1:]])
    rivals = {}
    rival_runs = {}
    for key, policy in (("none", "none"), ("random", "random"), ("auto", auto)):
        res = simulate_policy(city, cfg, beta, policy, run_ids=runs)
        rival_runs[key] = res.infected
        rivals[key] = {"label": LABELS[policy], "infected": float(res.infected.mean())}
    you = float(you_runs.mean())
    wins_auto = int((you_runs < rival_runs["auto"]).sum())
    wins_random = int((you_runs < rival_runs["random"]).sum())
    beat_auto = you < rivals["auto"]["infected"]
    beat_random = you < rivals["random"]["infected"]
    if beat_auto:
        title = "Comité legendario: le ganaste al comité automático"
    elif beat_random:
        title = "Buen comité: le ganaste al azar"
    elif you < rivals["none"]["infected"]:
        title = "Salvaste gente, pero el azar lo hizo mejor"
    else:
        title = "Manta cayó: la plaga ganó esta vez"
    return {
        "you": {"infected": you, "saved_vs_none": rivals["none"]["infected"] - you,
                "watched_run_infected": sim["infected"]},
        "rivals": rivals, "title": title, "beat_auto": beat_auto, "beat_random": beat_random,
        "wins_vs_auto": wins_auto, "wins_vs_random": wins_random, "score_runs": SCORE_RUNS,
        "manta_scale": cfg.manta_scale,
        "map": {"bitten": _pairs(city, sim["bitten_day"]), "vaccinated": _pairs(city, sim["vaccinated_day"]),
                "counts": sim["counts"], "days": days},
    }


def _pairs(city, days_arr: np.ndarray) -> list:
    idx = np.flatnonzero(days_arr >= 0)
    coords = np.rint(city.coords[idx] * 10_000).astype(int)
    return np.column_stack([coords, days_arr[idx]]).tolist()
