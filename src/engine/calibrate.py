"""Calibration: find the per-contact daily rate beta that gives a target R0.

R0 here is "the average number of people one random index case infects in a
fully susceptible Manta". For a random index i with infectious duration D:

    expected secondary cases = sum over contacts j of 1 - prod_layers (1 - beta * w)^D

averaged over agents and over the distribution of D. That expression grows with
beta, so a bisection finds the beta for any target. It is exact for the first
generation; tests check it against the day-by-day simulation.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np

from .disease import duration_pmf, edge_log_survival
from .population import City, build_city

BETA_MAX = 1.0  # beta * w must stay a probability; the largest weight is 1.0


def expected_r0(city: City, beta: float, infectious_mean: float) -> float:
    if beta <= 0:
        return 0.0
    pair_log_surv = np.bincount(city.pair_id, weights=edge_log_survival(city, beta))
    pmf = duration_pmf(infectious_mean)
    total = 0.0
    for d in np.flatnonzero(pmf > 1e-12):
        # Chance each pair transmits within d infectious days.
        total += pmf[d] * float(-np.expm1(d * pair_log_surv).sum())
    return total / city.n


def beta_for_r0(city: City, r0: float, infectious_mean: float, tol: float = 1e-4) -> float:
    if r0 <= 0:
        return 0.0
    if expected_r0(city, BETA_MAX, infectious_mean) <= r0:
        return BETA_MAX
    low, high = 0.0, BETA_MAX
    while high - low > tol * high:
        mid = (low + high) / 2
        if expected_r0(city, mid, infectious_mean) < r0:
            low = mid
        else:
            high = mid
    return (low + high) / 2


@lru_cache(maxsize=64)
def calibrated_beta(population: int, city_seed: int, r0: float, infectious_mean: float) -> float:
    return beta_for_r0(build_city(population, city_seed), r0, infectious_mean)
