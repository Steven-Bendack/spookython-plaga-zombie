"""Day-by-day stochastic SEIR on the contact network, many runs at once.

States: S Sano, E Mordido, I Zombie, R Exorcizado, V vacunado e inmune.
Each row of the state matrix is one Monte Carlo run; each column is one agent.

Common random numbers: every random draw that is not a decision of the policy
(who gets infected each day, how long each stage lasts, who is detected, whether
a dose works, where the outbreak starts) comes from generators keyed only by
(seed, run). So "none", "random" and every strategy face exactly the same
epidemic luck in run k; only their decisions differ.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .config import SimConfig
from .disease import edge_log_survival, infection_pressure, sample_durations
from .population import BARRIO_NAMES, City
from .strategies import Visible, priority_keys

S, E, I, R, V = 0, 1, 2, 3, 4
N_STATES = 5

# Purposes of the per-run random streams.
_INFECTION, _FATES, _SEEDING = 1, 2, 3
_POLICY_BASE = 100


@dataclass
class PolicyResult:
    policy: str
    counts: np.ndarray           # (runs, days+1, 5) agents per state per day
    infected: np.ndarray         # (runs,) people ever infected (initial cases included)
    doses_used: np.ndarray       # (runs,)
    doses_wasted: np.ndarray     # (runs,) doses given to someone not Sano
    doses_by_day: np.ndarray     # (runs, days+1)
    vaccinated_non_eligible: int  # doses given to visibly non-eligible people (must be 0)
    bitten_day: np.ndarray       # (n,) day each agent was bitten in the first simulated run, -1 = never
    vaccinated_day: np.ndarray   # (n,) day each agent got a dose in the first simulated run, -1 = never


def run_stream(seed: int, run: int, purpose: int) -> np.random.Generator:
    return np.random.default_rng(np.random.SeedSequence(seed, spawn_key=(run, purpose)))


def policy_code(policy: str) -> int:
    return _POLICY_BASE + sum(ord(ch) * (i + 1) for i, ch in enumerate(policy))


def pick_initial_cases(city: City, cfg: SimConfig, rng: np.random.Generator) -> np.ndarray:
    loc = cfg.seed_location
    if loc == "market":
        pool = np.flatnonzero(city.is_market)
    elif loc == "school":
        pool = np.flatnonzero(city.is_student)
    elif loc in BARRIO_NAMES:
        pool = np.flatnonzero(city.barrio == BARRIO_NAMES.index(loc))
    else:
        pool = np.arange(city.n)
    return rng.choice(pool, size=min(cfg.initial_cases, pool.size), replace=False)


def simulate_policy(city: City, cfg: SimConfig, beta: float, policy: str,
                    run_ids=None) -> PolicyResult:
    """Simulate one policy for the given runs (default: runs 0..cfg.runs-1).

    Run k always uses the same random streams, so the runs can be split across
    processes or Lambda workers and the result does not change.
    """
    run_ids = np.arange(cfg.runs) if run_ids is None else np.asarray(run_ids)
    runs, n, days = run_ids.size, city.n, cfg.days
    log_surv = edge_log_survival(city, beta)

    infection_rng = [run_stream(cfg.seed, int(k), _INFECTION) for k in run_ids]
    fate_rng = [run_stream(cfg.seed, int(k), _FATES) for k in run_ids]
    policy_rng = [run_stream(cfg.seed, int(k), policy_code(policy)) for k in run_ids]

    # Fates fixed per run and agent, identical for every policy.
    latent_days = np.stack([sample_durations(g, cfg.latent_mean, n) for g in fate_rng])
    sick_days = np.stack([sample_durations(g, cfg.infectious_mean, n) for g in fate_rng])
    will_be_detected = np.stack([g.random(n) < cfg.detection_prob for g in fate_rng])
    dose_works = np.stack([g.random(n) < cfg.vaccine_efficacy for g in fate_rng])

    state = np.full((runs, n), S, dtype=np.int8)
    timer = np.zeros((runs, n), dtype=np.int16)
    zombie_since = np.full((runs, n), -1, dtype=np.int32)
    detected = np.zeros((runs, n), dtype=bool)
    vaccinated = np.zeros((runs, n), dtype=bool)

    bitten_day = np.full(n, -1, dtype=np.int16)    # first row of run_ids only (for the map)
    vaccinated_day = np.full(n, -1, dtype=np.int16)

    for row, k in enumerate(run_ids):
        seeds = pick_initial_cases(city, cfg, run_stream(cfg.seed, int(k), _SEEDING))
        state[row, seeds] = I
        timer[row, seeds] = sick_days[row, seeds]
        zombie_since[row, seeds] = 0
        if row == 0:
            bitten_day[seeds] = 0

    counts = np.zeros((runs, days + 1, N_STATES), dtype=np.int32)
    counts[:, 0] = _count_states(state)
    infected = (state == I).sum(axis=1).astype(np.int64)
    doses_by_day = np.zeros((runs, days + 1), dtype=np.int32)
    wasted = np.zeros(runs, dtype=np.int64)
    non_eligible_hits = 0
    luck = np.empty((runs, n), dtype=np.float32)
    vaccinates = policy != "none" and cfg.doses_per_day > 0

    for day in range(1, days + 1):
        zombie = state == I
        sick = zombie | (state == E)
        if not sick.any():
            # The outbreak is over in every run: nothing can change any more.
            counts[:, day:] = counts[:, day - 1:day]
            break
        # The luck of the day for every agent, drawn whether or not it is used,
        # so the streams stay aligned across policies.
        for row, g in enumerate(infection_rng):
            g.standard_exponential(dtype=np.float32, out=luck[row])

        # 1. Transmission from today's Zombies: bitten if luck < pressure,
        #    which has probability 1 - exp(-pressure) (see disease.py).
        newly_bitten = (state == S) & (luck < infection_pressure(city, log_surv, zombie))
        infected += newly_bitten.sum(axis=1)
        bitten_day[newly_bitten[0]] = day

        # 2. Progress Mordidos and Zombies whose stage ends today.
        timer -= sick
        done = sick & (timer <= 0)
        turning = done & ~zombie
        np.copyto(state, R, where=done & zombie)
        np.copyto(state, I, where=turning)
        np.copyto(timer, sick_days, where=turning)
        np.copyto(zombie_since, day, where=turning)
        np.copyto(state, E, where=newly_bitten)
        np.copyto(timer, latent_days, where=newly_bitten)

        # 3. Some Zombies are detected after a delay.
        zombie = state == I
        detected |= zombie & will_be_detected & (day - zombie_since >= cfg.detection_delay)

        # 4. The doses of the day. A run whose outbreak is over stops its campaign.
        if vaccinates and day >= cfg.vaccine_start_day:
            outbreak_on = ((state == E) | zombie).any(axis=1, keepdims=True)
            eligible = ~vaccinated & ~detected & outbreak_on
            seen = Visible(visible_zombie=detected & zombie, rng=policy_rng)
            keys = np.where(eligible, priority_keys(policy, city, seen), -np.inf)
            chosen = _top_k(keys, cfg.doses_per_day)
            non_eligible_hits += int((chosen & ~eligible).sum())
            vaccinated |= chosen
            susceptible_chosen = chosen & (state == S)
            wasted += chosen.sum(axis=1) - susceptible_chosen.sum(axis=1)
            np.copyto(state, V, where=susceptible_chosen & dose_works)
            doses_by_day[:, day] = chosen.sum(axis=1)
            vaccinated_day[chosen[0]] = day

        counts[:, day] = _count_states(state)

    return PolicyResult(
        policy=policy, counts=counts, infected=infected,
        doses_used=doses_by_day.sum(axis=1), doses_wasted=wasted,
        doses_by_day=doses_by_day, vaccinated_non_eligible=non_eligible_hits,
        bitten_day=bitten_day, vaccinated_day=vaccinated_day,
    )


def _top_k(keys: np.ndarray, k: int) -> np.ndarray:
    """Boolean mask of the k highest finite keys of each row."""
    runs, n = keys.shape
    k = min(k, n)
    chosen = np.zeros((runs, n), dtype=bool)
    if k == 0:
        return chosen
    idx = np.argpartition(-keys, k - 1, axis=1)[:, :k]
    rows = np.arange(runs)[:, None]
    chosen[rows, idx] = np.isfinite(keys[rows, idx])
    return chosen


def _count_states(state: np.ndarray) -> np.ndarray:
    return np.stack([np.count_nonzero(state == s, axis=1) for s in range(N_STATES)], axis=1)
