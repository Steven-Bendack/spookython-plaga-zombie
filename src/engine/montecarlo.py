"""Paired Monte Carlo: every policy faces the same runs, then we compare run by run.

The work is cut into chunks (one policy, a range of runs). A chunk is plain
data in and plain data out, so it can run in this process, in a process pool,
or in an AWS Lambda worker. Results do not depend on how the work was split.
"""
from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from typing import Callable, Iterable

import numpy as np

from .calibrate import calibrated_beta
from .config import SimConfig
from .population import build_city
from .seir import simulate_policy
from .strategies import ALL_POLICIES, BASELINES, CANDIDATES

# A runner maps a list of chunk tasks to a list of chunk results.
Runner = Callable[[list[dict]], list[dict]]


def run_chunk(task: dict) -> dict:
    """Simulate one policy for runs [run_start, run_stop). Pure function of its input."""
    cfg = SimConfig.from_dict(task["config"])
    city = build_city(cfg.population, cfg.city_seed)
    run_ids = np.arange(task["run_start"], task["run_stop"])
    res = simulate_policy(city, cfg, task["beta"], task["policy"], run_ids)
    return {
        "policy": task["policy"],
        "run_start": task["run_start"],
        "infected": res.infected.tolist(),
        "doses_used": res.doses_used.tolist(),
        "doses_wasted": res.doses_wasted.tolist(),
        "doses_by_day": res.doses_by_day.tolist(),
        "counts": res.counts.tolist(),
        "vaccinated_non_eligible": res.vaccinated_non_eligible,
    }


def serial_runner(tasks: list[dict]) -> list[dict]:
    return [run_chunk(t) for t in tasks]


_POOL: ProcessPoolExecutor | None = None


def process_pool_runner(tasks: list[dict]) -> list[dict]:
    """Local parallel runner (one process per CPU core, reused between calls)."""
    global _POOL
    if _POOL is None:
        _POOL = ProcessPoolExecutor()
    return list(_POOL.map(run_chunk, tasks))


def make_tasks(cfg: SimConfig, policies: Iterable[str], beta: float, chunk_runs: int) -> list[dict]:
    tasks = []
    for policy in policies:
        for start in range(0, cfg.runs, chunk_runs):
            tasks.append({
                "config": cfg.to_dict(), "beta": beta, "policy": policy,
                "run_start": start, "run_stop": min(start + chunk_runs, cfg.runs),
            })
    return tasks


@dataclass
class PolicyRuns:
    infected: np.ndarray       # (runs,)
    doses_used: np.ndarray     # (runs,)
    doses_wasted: np.ndarray   # (runs,)
    doses_by_day: np.ndarray   # (runs, days+1)
    counts: np.ndarray         # (runs, days+1, 5)
    vaccinated_non_eligible: int


def run_policies(cfg: SimConfig, policies: Iterable[str], runner: Runner = serial_runner,
                 chunk_runs: int = 25) -> tuple[float, dict[str, PolicyRuns]]:
    policies = list(dict.fromkeys(policies))
    beta = calibrated_beta(cfg.population, cfg.city_seed, cfg.r0, cfg.infectious_mean)
    results = runner(make_tasks(cfg, policies, beta, chunk_runs))
    merged = {}
    for policy in policies:
        parts = sorted((r for r in results if r["policy"] == policy), key=lambda r: r["run_start"])
        merged[policy] = PolicyRuns(
            infected=np.concatenate([p["infected"] for p in parts]),
            doses_used=np.concatenate([p["doses_used"] for p in parts]),
            doses_wasted=np.concatenate([p["doses_wasted"] for p in parts]),
            doses_by_day=np.concatenate([np.asarray(p["doses_by_day"]) for p in parts]),
            counts=np.concatenate([np.asarray(p["counts"]) for p in parts]),
            vaccinated_non_eligible=sum(p["vaccinated_non_eligible"] for p in parts),
        )
    return beta, merged


# ---------- statistics ----------

def spread(values: np.ndarray) -> dict:
    """Mean, 90 % range across runs (p5-p95) and 95 % confidence interval of the mean."""
    v = np.asarray(values, dtype=float)
    half = 1.96 * v.std(ddof=1) / np.sqrt(v.size) if v.size > 1 else 0.0
    return {
        "mean": float(v.mean()), "p5": float(np.percentile(v, 5)), "p95": float(np.percentile(v, 95)),
        "min": float(v.min()), "max": float(v.max()),
        "ci95_low": float(v.mean() - half), "ci95_high": float(v.mean() + half),
    }


def policy_summary(runs: PolicyRuns, population: int) -> dict:
    counts = runs.counts
    zombies = counts[:, :, 2]
    mean_curve = counts.mean(axis=0)
    return {
        "infected": spread(runs.infected),
        "attack_rate": float(runs.infected.mean() / population),
        "peak_zombies": spread(zombies.max(axis=1)),
        "peak_day": int(mean_curve[:, 2].argmax()),
        "doses_used": float(runs.doses_used.mean()),
        "doses_wasted": float(runs.doses_wasted.mean()),
        "wasted_share": float(runs.doses_wasted.sum() / max(runs.doses_used.sum(), 1)),
        "vaccinated_non_eligible": runs.vaccinated_non_eligible,
        "curves": {
            "S": _round(mean_curve[:, 0]), "E": _round(mean_curve[:, 1]),
            "I": _round(mean_curve[:, 2]), "R": _round(mean_curve[:, 3]),
            "V": _round(mean_curve[:, 4]),
            "I_p5": _round(np.percentile(zombies, 5, axis=0)),
            "I_p95": _round(np.percentile(zombies, 95, axis=0)),
        },
    }


def paired(baseline: PolicyRuns, other: PolicyRuns) -> dict:
    """People saved by `other` relative to `baseline`, run by run (same seeds)."""
    saved = baseline.infected - other.infected
    out = spread(saved)
    out["win_rate"] = float((saved > 0).mean())
    out["tie_rate"] = float((saved == 0).mean())
    out["loss_rate"] = float((saved < 0).mean())
    return out


def tournament(cfg: SimConfig, runner: Runner = serial_runner, candidates=CANDIDATES,
               chunk_runs: int = 25) -> dict:
    """Run baselines + candidates on the same seeds and rank the candidates."""
    if cfg.strategy != "auto":
        candidates = (cfg.strategy,)
    beta, runs = run_policies(cfg, BASELINES + tuple(candidates), runner, chunk_runs)
    none, rnd = runs["none"], runs["random"]
    ranking = []
    for name in candidates:
        ranking.append({
            "name": name,
            "vs_none": paired(none, runs[name]),
            "vs_random": paired(rnd, runs[name]),
            "infected_mean": float(runs[name].infected.mean()),
        })
    ranking.sort(key=lambda r: r["infected_mean"])
    return {
        "beta": beta,
        "summaries": {p: policy_summary(r, cfg.population) for p, r in runs.items()},
        "random_vs_none": paired(none, rnd),
        "ranking": ranking,
        "best": ranking[0]["name"],
    }


def _round(a: np.ndarray) -> list:
    return np.round(a, 1).tolist()


__all__ = ["ALL_POLICIES", "tournament", "run_policies", "run_chunk", "serial_runner",
           "process_pool_runner", "paired", "spread"]
