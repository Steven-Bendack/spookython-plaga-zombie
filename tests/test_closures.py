import numpy as np

from engine.api import simulate
from engine.calibrate import calibrated_beta
from engine.config import SimConfig
from engine.population import build_city
from engine.seir import simulate_policy

BASE = {"runs": 6, "days": 80, "population": 4000, "r0": 3.0, "closure_trigger": 3, "detection_prob": 1.0}


def _run(policy, **changes):
    cfg = SimConfig.from_dict({**BASE, **changes})
    city = build_city(cfg.population, cfg.city_seed)
    beta = calibrated_beta(cfg.population, cfg.city_seed, cfg.r0, cfg.infectious_mean)
    return simulate_policy(city, cfg, beta, policy)


def test_budget_is_never_exceeded():
    res = _run("ring_hubs", close_market=True, close_schools=True, budget=900, doses_per_day=20)
    assert (res.spent <= 900 + 1e-9).all()
    assert res.spent.max() > 0


def test_closing_schools_saves_people_on_the_same_seeds():
    open_ = _run("random", doses_per_day=0)
    closed = _run("random", doses_per_day=0, close_schools=True)
    assert closed.closed_days[:, 1].sum() > 0
    assert closed.infected.mean() < open_.infected.mean()


def test_doing_nothing_never_closes_anything():
    res = _run("none", close_market=True, close_schools=True)
    assert res.closed_days.sum() == 0 and res.spent.sum() == 0


def test_defaults_do_not_close_or_limit_doses():
    cfg = SimConfig()
    assert not cfg.close_market and not cfg.close_schools and cfg.budget == 0


def test_closure_plans_are_reported_and_paired():
    out = simulate({**BASE, "budget": 2000})
    plans = out["closure_plans"]["plans"]
    assert [p["label"] for p in plans][0] == "Solo vacunas" and len(plans) == 4
    assert all(p["spent"] <= 2000 + 1e-9 for p in plans)
    assert out["closure_plans"]["text"]


def test_closure_flags_accept_text_from_the_url():
    assert SimConfig.from_dict({"close_market": "true", "close_schools": "false"}).close_market is True
    assert SimConfig.from_dict({"close_schools": "false"}).close_schools is False
