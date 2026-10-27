"""Jury Mode: an automatic red team against our own recommendation.

It samples many Surprise Outbreaks (R0, doses, vaccine efficacy, where it
starts, detection delay), and at each one compares against Random:
  - the FIXED strategy (the one we would present), and
  - AUTO, the tournament: it picks a strategy with one set of seeds and is then
    judged on a different set of seeds, so it cannot cheat by choosing with
    hindsight.
Then it searches harder around the worst points, and explains in one sentence
where the fixed strategy loses (its robustness frontier).
"""
from __future__ import annotations

from dataclasses import replace

import numpy as np

from .config import SimConfig
from .montecarlo import Runner, rank_candidates, run_many, serial_runner
from .strategies import CANDIDATES, LABELS

SPACE = {
    "r0": (1.2, 5.0),
    "dose_factor": (0.25, 2.0),      # multiplies the base doses per day
    "vaccine_efficacy": (0.3, 1.0),
    "detection_delay": (0, 6),
}
LOCATIONS = ("random", "market", "school", "Tarqui")
DIM_LABELS = {
    "r0": "R0", "dose_factor": "dosis (× base)", "vaccine_efficacy": "eficacia",
    "detection_delay": "retraso de detección (días)",
}
TIE_SHARE = 0.002  # |mean saved| under 0.2 % of the population counts as a tie


def red_team(base: SimConfig, strategy: str = "ring_hubs", points: int = 32, runs: int = 10,
             refine: int = 6, jury_seed: int = 31, runner: Runner = serial_runner) -> dict:
    rng = np.random.default_rng(jury_seed)
    samples = _latin_hypercube(rng, points)
    evaluated = _evaluate_all(base, samples, strategy, runs, runner)

    # Red team step: perturb the worst points looking for something even worse.
    worst = sorted(evaluated, key=lambda p: p["fixed"]["margin"])[:3]
    for _ in range(refine // max(len(worst), 1)):
        candidates = _evaluate_all(base, [_perturb(rng, p["condition"]) for p in worst],
                                   strategy, runs, runner)
        for result in candidates:
            result["refined"] = True
        evaluated.extend(candidates)
        worst = [new if new["fixed"]["margin"] < old["fixed"]["margin"] else old
                 for old, new in zip(worst, candidates)]

    return jury_report(evaluated, strategy, runs, jury_seed)


def _latin_hypercube(rng: np.random.Generator, n: int) -> list[dict]:
    """Each dimension's range is cut in n slices and every slice is used once."""
    columns = {}
    for dim, (low, high) in SPACE.items():
        u = (rng.permutation(n) + rng.random(n)) / n
        if dim == "dose_factor":  # log scale: 0.25x to 2x evenly in ratio
            columns[dim] = np.exp(np.log(low) + u * (np.log(high) - np.log(low)))
        else:
            columns[dim] = low + u * (high - low)
    locations = rng.permutation(np.resize(np.arange(len(LOCATIONS)), n))
    out = []
    for i in range(n):
        point = {dim: float(columns[dim][i]) for dim in SPACE}
        point["detection_delay"] = int(round(point["detection_delay"]))
        point["seed_location"] = LOCATIONS[locations[i]]
        out.append(point)
    return out


def _perturb(rng: np.random.Generator, condition: dict) -> dict:
    point = dict(condition)
    for dim, (low, high) in SPACE.items():
        step = 0.15 * (high - low)
        point[dim] = float(np.clip(point[dim] + rng.normal(0, step), low, high))
    point["detection_delay"] = int(round(point["detection_delay"]))
    return point


def condition_config(base: SimConfig, condition: dict, runs: int, seed: int) -> SimConfig:
    return replace(
        base, runs=runs, seed=seed, r0=condition["r0"],
        doses_per_day=max(1, round(base.doses_per_day * condition["dose_factor"])),
        vaccine_efficacy=condition["vaccine_efficacy"],
        detection_delay=condition["detection_delay"],
        seed_location=condition["seed_location"],
    ).validated()


def _evaluate_all(base: SimConfig, conditions: list[dict], strategy: str, runs: int,
                  runner: Runner) -> list[dict]:
    jobs = jury_jobs(base, conditions, runs)
    return jury_points(base, conditions, strategy, run_many(jobs, runner, chunk_runs=runs))


def jury_jobs(base: SimConfig, conditions: list[dict], runs: int) -> list:
    jobs = []
    for condition in conditions:
        # AUTO chooses with "training" seeds... (job 2k)
        jobs.append((condition_config(base, condition, runs, seed=base.seed + 10_000),
                     ("random",) + CANDIDATES))
        # ...and everyone is judged on fresh seeds (job 2k + 1).
        jobs.append((condition_config(base, condition, runs, seed=base.seed), ("random",) + CANDIDATES))
    return jobs


def jury_points(base: SimConfig, conditions: list[dict], strategy: str, results: list) -> list[dict]:
    out = []
    for k, condition in enumerate(conditions):
        train, test = results[2 * k][1], results[2 * k + 1][1]
        auto_pick = rank_candidates(train, CANDIDATES)[0]
        n = base.population
        out.append({
            "condition": condition,
            "fixed": _versus_random(test["random"].infected, test[strategy].infected, n),
            "auto": {**_versus_random(test["random"].infected, test[auto_pick].infected, n),
                     "pick": auto_pick},
        })
    return out


def jury_report(points: list[dict], strategy: str, runs: int, jury_seed: int) -> dict:
    return {
        "strategy": strategy,
        "strategy_label": LABELS[strategy],
        "points": points,
        "fixed_share": _shares([p["fixed"]["outcome"] for p in points]),
        "auto_share": _shares([p["auto"]["outcome"] for p in points]),
        "frontier_text": frontier_text(points, strategy),
        "auto_text": auto_text(points),
        "runs_per_point": runs,
        "jury_seed": jury_seed,
    }


def sample_conditions(points: int, jury_seed: int) -> list[dict]:
    return _latin_hypercube(np.random.default_rng(jury_seed), points)


def _versus_random(random_inf: np.ndarray, policy_inf: np.ndarray, n: int) -> dict:
    saved = random_inf - policy_inf
    mean = float(saved.mean())
    if abs(mean) < TIE_SHARE * n:
        outcome = "tie"
    else:
        outcome = "win" if mean > 0 else "loss"
    return {"saved_mean": mean, "margin": mean / n, "win_rate": float((saved > 0).mean()),
            "outcome": outcome}


def _shares(outcomes: list[str]) -> dict:
    total = len(outcomes)
    return {k: outcomes.count(k) / total for k in ("win", "tie", "loss")}


def frontier_text(points: list[dict], strategy: str) -> str:
    """Find the simplest rule (one or two thresholds) that describes the losses."""
    losses = np.array([p["fixed"]["outcome"] == "loss" for p in points])
    share_ok = 1 - losses.mean()
    head = f"«{LABELS[strategy]}» como regla fija gana o empata en el {_pct(share_ok)} de los escenarios probados"
    if not losses.any():
        return head + " y no se encontró ninguna condición donde pierda contra Azar."
    (rule1, dim1), mask1 = _best_rule(points, losses, np.ones(len(points), dtype=bool))
    rules, mask = [rule1], mask1
    if (mask & ~losses).any():
        (rule2, _), mask2 = _best_rule(points, losses, mask1, skip=dim1)
        if rule2 and _f1(mask1 & mask2, losses) >= _f1(mask1, losses):
            rules.append(rule2)
            mask = mask1 & mask2
    covered = int((mask & losses).sum())
    return (f"{head}. Solo pierde cuando {' y '.join(r for r in rules if r)} "
            f"({covered} de {int(losses.sum())} derrotas). En esas condiciones el torneo cambia de estrategia.")


def _pct(x: float, digits: int = 0) -> str:
    """Spanish style: 67 %, 0,2 %."""
    return f"{x * 100:.{digits}f}".replace(".", ",") + " %"


def auto_text(points: list[dict]) -> str:
    share = _shares([p["auto"]["outcome"] for p in points])
    text = (f"El torneo automático, que elige con semillas de entrenamiento y se juzga con semillas nuevas, "
            f"gana en el {_pct(share['win'])} de los escenarios, empata en el {_pct(share['tie'])} "
            f"y pierde en el {_pct(share['loss'])}.")
    if share["tie"]:
        text += (" Los empates son brotes donde ninguna vacunación cambia el resultado en más de "
                 f"{_pct(TIE_SHARE, 1)} de la población (plaga muy contagiosa con pocas dosis).")
    return text


def _best_rule(points, losses, within, skip=None):
    best, best_mask, best_score = (None, None), within, -1.0
    for dim in SPACE:
        if dim == skip:
            continue
        values = np.array([p["condition"][dim] for p in points])
        for t in np.unique(np.round(values[within], 2)):
            for sign in (">=", "<="):
                mask = within & ((values >= t) if sign == ">=" else (values <= t))
                score = _f1(mask, losses)
                if score > best_score:
                    rule = f"{DIM_LABELS[dim]} {'≥' if sign == '>=' else '≤'} {_fmt(dim, t)}"
                    best, best_mask, best_score = (rule, dim), mask, score
    return best, best_mask


def _f1(mask: np.ndarray, losses: np.ndarray) -> float:
    tp = (mask & losses).sum()
    if tp == 0:
        return 0.0
    precision = tp / mask.sum()
    recall = tp / losses.sum()
    return float(2 * precision * recall / (precision + recall))


def _fmt(dim: str, value: float) -> str:
    if dim == "detection_delay":
        return f"{value:.0f}"
    if dim == "vaccine_efficacy":
        return _pct(value)
    return f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",")
