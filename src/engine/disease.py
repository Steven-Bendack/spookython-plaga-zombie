"""Disease timing and per-day transmission on the contact network."""
from __future__ import annotations

import math

import numpy as np

from .population import City

# Durations follow a gamma distribution with shape 4 (coefficient of variation 0.5),
# rounded to whole days and at least 1 day.
DURATION_SHAPE = 4
MAX_DURATION = 60


def sample_durations(rng: np.random.Generator, mean: float, size) -> np.ndarray:
    raw = rng.gamma(DURATION_SHAPE, mean / DURATION_SHAPE, size=size)
    return np.clip(np.rint(raw), 1, MAX_DURATION).astype(np.int16)


def duration_pmf(mean: float) -> np.ndarray:
    """P(duration = d) for d = 0..MAX_DURATION, matching sample_durations exactly.

    Shape 4 is an integer, so the gamma CDF has a closed form (Erlang).
    """
    rate = DURATION_SHAPE / mean

    def cdf(x: float) -> float:
        if x <= 0:
            return 0.0
        tail = sum(math.exp(-rate * x) * (rate * x) ** k / math.factorial(k)
                   for k in range(DURATION_SHAPE))
        return 1.0 - tail

    pmf = np.zeros(MAX_DURATION + 1)
    pmf[1] = cdf(1.5)
    for d in range(2, MAX_DURATION):
        pmf[d] = cdf(d + 0.5) - cdf(d - 0.5)
    pmf[MAX_DURATION] = 1.0 - cdf(MAX_DURATION - 0.5)
    return pmf


def edge_log_survival(city: City, beta: float) -> np.ndarray:
    """log(1 - beta * w) per edge: log of the chance a contact does NOT infect today."""
    p = np.minimum(beta * city.weight, 1.0 - 1e-12)
    return np.log1p(-p)


def infection_pressure(city: City, log_surv: np.ndarray, infectious: np.ndarray) -> np.ndarray:
    """Daily infection pressure h_i >= 0 for every agent in every column (run).

    infectious: (columns, n) bool. The chance agent i is infected today is
        p_i = 1 - prod over infectious contacts j of (1 - beta * w_ij) = 1 - exp(-h_i)
    so h_i = -sum_j log(1 - beta * w_ij), a sparse sum over infectious agents' edges.
    Drawing X ~ Exponential(1), "X < h_i" happens with probability exactly p_i.
    """
    return -neighbor_sum(city, log_surv, infectious)


def neighbor_sum(city: City, edge_values: np.ndarray, active: np.ndarray) -> np.ndarray:
    """For every agent, sum edge_values over its edges to active agents.

    active: (columns, n) bool. Only the edges of active agents are touched,
    which keeps a day cheap while few people are infectious.
    """
    cols, n = active.shape
    col_idx, src = np.nonzero(active)
    if src.size == 0:
        return np.zeros((cols, n))
    starts = city.indptr[src]
    counts = city.indptr[src + 1] - starts
    total = int(counts.sum())
    # Edge positions of every active agent, flattened (vectorized ranges).
    offsets = np.repeat(starts - np.cumsum(counts) + counts, counts) + np.arange(total)
    target = city.indices[offsets].astype(np.int64) + np.repeat(col_idx, counts) * n
    return np.bincount(target, weights=edge_values[offsets], minlength=cols * n).reshape(cols, n)
