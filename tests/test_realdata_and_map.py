from pathlib import Path

import numpy as np
import pytest

from engine.api import simulate
from engine.config import SimConfig
from engine.realdata import growth_rate, half_max_width, load_excess, rising_window
from engine.scenarios import SCENARIOS

ROOT = Path(__file__).resolve().parents[1]


def test_growth_rate_recovers_a_known_exponential():
    days = np.arange(60)
    rise = np.exp(0.1 * days[:40])                       # pure exponential growth...
    fall = rise[-1] * np.exp(-0.2 * (days[40:] - 39))    # ...then the wave falls
    rate, window = growth_rate(np.concatenate([rise, fall]), step_days=1)
    assert rate == pytest.approx(0.1, rel=1e-6)
    assert window.size >= 5


def test_rising_window_stays_before_the_peak():
    values = np.array([1, 2, 5, 20, 50, 80, 100, 60, 30])
    window = rising_window(values)
    assert window.max() < int(np.argmax(values))


def test_manta_2020_data_shows_the_first_wave():
    weeks, excess = load_excess(ROOT / "data" / "covid_manta_2020.csv")
    assert weeks.size == 52
    assert 14 <= weeks[int(np.argmax(excess))] <= 20     # peak in April-May 2020
    rate, _ = growth_rate(np.clip(excess, 0, None), step_days=7)
    assert 0.05 < rate < 0.12
    assert half_max_width(np.clip(excess, 0, None)) >= 3


def test_scenarios_are_valid_configs():
    for key, sc in SCENARIOS.items():
        cfg = SimConfig.from_dict(sc["changes"])
        for name, value in sc["changes"].items():
            assert getattr(cfg, name) == pytest.approx(value), (key, name)
        assert sc["source"] and sc["kind"] in ("real", "fiction")


def test_map_replays_run_one_inside_manta():
    out = simulate({"runs": 3, "days": 60, "population": 3000})
    for key in ("none", "random", "strategy"):
        pts = np.array(out["map"][key]["bitten"])
        assert pts.size and (pts[:, 2] >= 0).all() and (pts[:, 2] <= 60).all()
        lat, lon = pts[:, 0] / 1e4, pts[:, 1] / 1e4
        assert (lat > -1.10).all() and (lat < -0.90).all()
        assert (lon > -80.90).all() and (lon < -80.60).all()
    # The map only shows doses from the day the vaccines arrive.
    vax = np.array(out["map"]["strategy"]["vaccinated"])
    assert (vax[:, 2] >= out["config"]["vaccine_start_day"]).all()


def test_map_replays_the_median_run_exactly():
    out = simulate({"runs": 5, "days": 60, "population": 3000})
    per_run = out["saved_vs_none"]["per_run"]
    run = out["map"]["run"] - 1
    assert sorted(per_run)[len(per_run) // 2] == per_run[run]
    replay_saved = len(out["map"]["none"]["bitten"]) - len(out["map"]["strategy"]["bitten"])
    assert replay_saved == per_run[run]


def test_every_agent_stands_on_a_real_street_home_of_its_barrio():
    # Coastal barrios used to scatter people into the sea; homes must come from OSM streets.
    import numpy as np
    from engine.population import _street_homes, build_city
    city = build_city(10_000, 2026)
    homes = _street_homes()
    assert homes is not None
    for b, points in enumerate(homes):
        mine = city.coords[city.barrio == b]
        nearest = np.min(np.abs(mine[:, None, :] - points[None, :, :]).max(axis=2), axis=1)
        assert nearest.max() < 0.0003, f"barrio {b}: someone is {nearest.max() * 111_000:.0f} m from any home"


def test_contagion_lines_point_to_a_real_contact_who_was_a_zombie():
    import numpy as np
    from engine.api import likely_sources
    from engine.calibrate import calibrated_beta
    from engine.config import SimConfig
    from engine.population import build_city
    from engine.seir import simulate_policy
    cfg = SimConfig.from_dict({"population": 3000, "runs": 1, "days": 120, "seed": 7})
    city = build_city(cfg.population, cfg.city_seed)
    beta = calibrated_beta(cfg.population, cfg.city_seed, cfg.r0, cfg.infectious_mean)
    res = simulate_policy(city, cfg, beta, "none", run_ids=[0])
    order = np.flatnonzero(res.bitten_day >= 0)
    src = likely_sources(city, res)
    assert len(src) == order.size
    for pos, s in enumerate(src):
        i = order[pos]
        if res.bitten_day[i] == 0:
            assert s == -1  # the first cases came from outside
            continue
        assert s >= 0, "every later case has a Zombie contact in the model"
        j = order[s]
        d = res.bitten_day[i]
        assert j in city.indices[city.indptr[i]:city.indptr[i + 1]]
        assert 0 <= res.zombie_day[j] <= d - 1 and (res.exorcised_day[j] < 0 or res.exorcised_day[j] >= d)
