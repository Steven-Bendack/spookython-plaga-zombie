import json

import numpy as np
import pytest

from engine.api import simulate
from engine.calibrate import beta_for_r0, calibrated_beta, expected_r0
from engine.config import SimConfig
from engine.disease import edge_log_survival, infection_pressure, sample_durations
from engine.montecarlo import run_policies
from engine.population import build_city
from engine.seir import simulate_policy

SMALL = {"runs": 6, "days": 60, "population": 4000}


@pytest.fixture(scope="module")
def city():
    return build_city(4000, 2026)


def _without_timing(result: dict) -> str:
    result = dict(result)
    result.pop("elapsed_seconds")
    return json.dumps(result, sort_keys=True)


def test_same_config_and_seed_give_identical_bytes():
    assert _without_timing(simulate(SMALL)) == _without_timing(simulate(SMALL))


def test_different_seed_gives_different_result():
    assert _without_timing(simulate(SMALL)) != _without_timing(simulate({**SMALL, "seed": 7}))


def test_result_does_not_depend_on_how_runs_are_split():
    cfg = SimConfig.from_dict(SMALL)
    _, whole = run_policies(cfg, ["random"], chunk_runs=6)
    _, split = run_policies(cfg, ["random"], chunk_runs=1)
    assert np.array_equal(whole["random"].counts, split["random"].counts)


def test_same_city_seed_builds_same_city():
    a = build_city(3000, 99)
    b = build_city.__wrapped__(3000, 99) if hasattr(build_city, "__wrapped__") else build_city(3000, 99)
    assert np.array_equal(a.indices, b.indices) and np.array_equal(a.household, b.household)


@pytest.mark.parametrize("policy", ["none", "random", "degree", "acquaintance", "ring", "ring_hubs"])
def test_population_is_conserved_every_day(city, policy):
    cfg = SimConfig.from_dict(SMALL)
    res = simulate_policy(city, cfg, calibrated_beta(4000, 2026, cfg.r0, cfg.infectious_mean), policy)
    assert (res.counts.sum(axis=2) == city.n).all()


@pytest.mark.parametrize("policy", ["random", "degree", "acquaintance", "ring", "ring_hubs"])
def test_never_vaccinates_someone_visibly_not_eligible(city, policy):
    cfg = SimConfig.from_dict({**SMALL, "r0": 3.0, "doses_per_day": 200, "detection_prob": 1.0})
    res = simulate_policy(city, cfg, calibrated_beta(4000, 2026, 3.0, cfg.infectious_mean), policy)
    assert res.doses_used.sum() > 0
    # No dose for a detected Zombie/Exorcizado, nor a second dose for anyone.
    assert res.vaccinated_non_eligible == 0


def test_random_and_strategy_get_the_same_doses_every_day(city):
    # Short horizon and strong outbreak: the epidemic never ends early, so both
    # policies are offered the doses of every single day.
    cfg = SimConfig.from_dict({**SMALL, "days": 25, "r0": 3.0, "doses_per_day": 30, "vaccine_start_day": 3})
    beta = calibrated_beta(4000, 2026, 3.0, cfg.infectious_mean)
    rnd = simulate_policy(city, cfg, beta, "random")
    strat = simulate_policy(city, cfg, beta, "ring_hubs")
    assert np.array_equal(rnd.doses_by_day, strat.doses_by_day)
    assert (rnd.doses_by_day[:, 3:] == 30).all()


def test_r0_zero_means_no_one_else_gets_infected():
    out = simulate({**SMALL, "r0": 0.0})
    for key in ("none", "random", "strategy"):
        assert out["policies"][key]["infected"]["max"] == SMALL.get("initial_cases", 5)


def test_vaccinating_everyone_stops_the_outbreak():
    base = {**SMALL, "r0": 3.0, "vaccine_efficacy": 1.0, "vaccine_start_day": 0}
    none = simulate({**base, "doses_per_day": 0})["policies"]["none"]["infected"]["mean"]
    full = simulate({**base, "doses_per_day": 5000})["policies"]["strategy"]["infected"]["mean"]
    assert full < 0.05 * none


def test_calibrated_beta_matches_analytic_r0(city):
    for r0 in (1.5, 2.5, 4.0):
        beta = beta_for_r0(city, r0, 5.0)
        assert expected_r0(city, beta, 5.0) == pytest.approx(r0, rel=1e-3)


@pytest.mark.parametrize("r0", [1.5, 2.5, 4.0])
def test_calibration_matches_simulated_secondary_cases(city, r0):
    """Seed one Zombie in a fully susceptible city, let it infect day by day with
    the engine's own transmission step, count who it bites: mean within 10 %."""
    beta = beta_for_r0(city, r0, 5.0)
    log_surv = edge_log_survival(city, beta)
    rng = np.random.default_rng(1)
    trials = 3000
    index = rng.choice(city.n, size=trials)
    days_sick = sample_durations(rng, 5.0, trials)
    infectious = np.zeros((trials, city.n), dtype=bool)
    infectious[np.arange(trials), index] = True
    bitten = np.zeros((trials, city.n), dtype=bool)
    for day in range(int(days_sick.max())):
        still_sick = (days_sick > day)[:, None]
        pressure = infection_pressure(city, log_surv, infectious & still_sick)
        luck = rng.standard_exponential((trials, city.n))
        bitten |= (luck < pressure) & ~infectious
    secondary = bitten.sum(axis=1).mean()
    assert secondary == pytest.approx(r0, rel=0.10)


def test_config_hash_is_stable_and_sensitive():
    a = SimConfig()
    assert a.config_hash() == SimConfig().config_hash()
    assert a.config_hash() != SimConfig(seed=1).config_hash()


def test_public_limits_are_enforced():
    cfg = SimConfig.from_dict({"runs": 10**6, "population": 10**9, "days": -3})
    assert cfg.runs <= 400 and cfg.population <= 40_000 and cfg.days >= 10
