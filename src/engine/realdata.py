"""Calibration against real data: COVID-19 in Manta, 2020.

Observed: weekly excess deaths in Manta (Registro Civil, 2020 minus the
2017-2019 average). Deaths lag infections by a few weeks but grow at the same
exponential rate, so the growth rate of the rising phase is comparable to the
growth rate of new infections in the model.

Method (same rule applied to the data and to the model):
  1. growth rate r = slope of log(weekly value) over the rising weeks that are
     between 20 % and 80 % of the peak;
  2. simulate "no intervention" in our Manta for a grid of R0 values and
     measure r the same way on weekly new infections;
  3. the calibrated R0 is where the model's r equals the observed r.
Ecuador went into lockdown on 16-17 March 2020, so this is the R0 that
reproduces the wave as it actually happened (with the measures of the time).
"""
from __future__ import annotations

import csv
from dataclasses import replace
from pathlib import Path

import numpy as np

from .config import SimConfig
from .montecarlo import Runner, run_many, serial_runner

RISE_LOW, RISE_HIGH = 0.2, 0.8


def load_excess(path: Path) -> tuple[np.ndarray, np.ndarray]:
    with Path(path).open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    weeks = np.array([int(r["week"]) for r in rows])
    excess = np.array([float(r["excess"]) for r in rows])
    return weeks, excess


def rising_window(values: np.ndarray) -> np.ndarray:
    """Indices of the rising phase between 20 % and 80 % of the peak."""
    peak = int(np.argmax(values))
    top = values[peak]
    idx = [i for i in range(peak + 1) if RISE_LOW * top <= values[i] <= RISE_HIGH * top]
    # keep only the last contiguous run before the peak
    run = []
    for i in reversed(idx):
        if run and i != run[-1] - 1:
            break
        run.append(i)
    return np.array(sorted(run))


def growth_rate(values: np.ndarray, step_days: int) -> tuple[float, np.ndarray]:
    """Exponential growth per DAY fitted on the rising window of a series sampled
    every `step_days` days (7 for the weekly deaths, 1 for the model)."""
    window = rising_window(values)
    if window.size < 2:
        return float("nan"), window
    slope = np.polyfit(window, np.log(values[window]), 1)[0]
    return float(slope / step_days), window


def model_daily_infections(counts: np.ndarray) -> np.ndarray:
    """Mean daily new infections from state counts (runs, days+1, 5), no vaccination."""
    ever_infected = counts[:, :, 1:4].sum(axis=2)  # E + I + R
    return np.diff(ever_infected.mean(axis=0))


def to_weekly(daily: np.ndarray) -> np.ndarray:
    weeks = daily.size // 7
    return daily[: weeks * 7].reshape(weeks, 7).sum(axis=1)


def calibrate_to_growth(base: SimConfig, observed_rate: float, r0_grid=None, runs: int = 30,
                        runner: Runner = serial_runner) -> dict:
    # Below R0 ~1.5 many runs die out early and the mean curve has no clean rising phase.
    r0_grid = np.round(np.arange(1.5, 3.21, 0.1), 2) if r0_grid is None else np.asarray(r0_grid)
    jobs = [(replace(base, r0=float(r0), runs=runs, days=200).validated(), ("none",)) for r0 in r0_grid]
    results = run_many(jobs, runner, chunk_runs=runs)
    rates, curves = [], []
    for _, res in results:
        daily = model_daily_infections(res["none"].counts)
        rate, _ = growth_rate(daily, step_days=1)
        rates.append(rate)
        curves.append(to_weekly(daily))
    rates = np.array(rates)
    ok = np.isfinite(rates)
    # rate grows with R0: interpolate the R0 that matches the observed rate
    order = np.argsort(rates[ok])
    r0 = float(np.interp(observed_rate, rates[ok][order], r0_grid[ok][order]))
    nearest = int(np.argmin(np.abs(r0_grid - r0)))
    return {"r0": r0, "r0_grid": r0_grid.tolist(), "model_rates": rates.tolist(),
            "curve_at_r0": curves[nearest].tolist(), "grid_r0_for_curve": float(r0_grid[nearest])}


def half_max_width(values: np.ndarray) -> int:
    """Number of weeks at or above half of the peak."""
    return int((values >= values.max() / 2).sum())
