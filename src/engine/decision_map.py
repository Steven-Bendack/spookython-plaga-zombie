"""Decision map: the best strategy for a grid of conditions, computed in advance.

During the Surprise Outbreak the UI looks up the closest cell and shows an
answer instantly; the live tournament then confirms it with the jury's seed.
"""
from __future__ import annotations

import itertools
from dataclasses import replace

from .config import SimConfig
from .montecarlo import Runner, paired, rank_candidates, run_many, serial_runner
from .strategies import BASELINES, CANDIDATES

GRID = {
    "r0": (1.5, 2.0, 3.0, 4.0),
    "dose_factor": (0.5, 1.0, 2.0),
    "vaccine_efficacy": (0.5, 0.9),
    "seed_location": ("random", "market", "school"),
}


def build_decision_map(base: SimConfig, runs: int = 20, runner: Runner = serial_runner) -> dict:
    jobs = decision_map_jobs(base, runs)
    return decision_map_report(base, runs, run_many(jobs, runner, chunk_runs=runs))


def _combos():
    return list(itertools.product(*GRID.values()))


def decision_map_jobs(base: SimConfig, runs: int) -> list:
    return [(replace(base, runs=runs, r0=r0, vaccine_efficacy=eff, seed_location=loc,
                     doses_per_day=max(1, round(base.doses_per_day * factor))).validated(),
             BASELINES + CANDIDATES) for r0, factor, eff, loc in _combos()]


def decision_map_report(base: SimConfig, runs: int, results: list) -> dict:
    cells = []
    for (r0, factor, eff, loc), (_, res) in zip(_combos(), results):
        ranking = rank_candidates(res, CANDIDATES)
        best = ranking[0]
        vs_rnd = paired(res["random"], res[best])
        vs_none = paired(res["none"], res[best])
        cells.append({
            "r0": r0, "dose_factor": factor, "vaccine_efficacy": eff, "seed_location": loc,
            "best": best, "ranking": ranking,
            "saved_vs_random": round(vs_rnd["mean"], 1), "win_rate_vs_random": vs_rnd["win_rate"],
            "saved_vs_none": round(vs_none["mean"], 1),
        })
    return {"base": base.to_dict(), "runs_per_cell": runs, "grid": GRID, "cells": cells}


def lookup(decision_map: dict, cfg: SimConfig) -> dict:
    """Closest precomputed cell to a configuration."""
    base_doses = decision_map["base"]["doses_per_day"]
    factor = cfg.doses_per_day / max(base_doses, 1)

    def distance(cell):
        return (abs(cell["r0"] - cfg.r0) / 1.0
                + abs(cell["dose_factor"] - factor) / 0.5
                + abs(cell["vaccine_efficacy"] - cfg.vaccine_efficacy) / 0.2
                + (0 if cell["seed_location"] == cfg.seed_location else 0.5))

    return min(decision_map["cells"], key=distance)
