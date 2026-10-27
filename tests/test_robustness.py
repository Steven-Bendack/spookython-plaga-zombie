import json

from engine.config import SimConfig
from engine.decision_map import lookup
from engine.jury import red_team

TINY = SimConfig(population=3000, runs=4, days=60)


def test_jury_mode_reports_every_point_and_consistent_shares():
    report = red_team(TINY, points=4, runs=3, refine=3)
    assert len(report["points"]) == 4 + 3
    for key in ("fixed_share", "auto_share"):
        assert abs(sum(report[key].values()) - 1) < 1e-9
    assert report["frontier_text"] and report["auto_text"]
    json.dumps(report)  # must be JSON-serialisable for the API


def test_jury_mode_is_reproducible():
    a = red_team(TINY, points=3, runs=2, refine=0)
    b = red_team(TINY, points=3, runs=2, refine=0)
    assert json.dumps(a) == json.dumps(b)


def test_decision_map_lookup_picks_closest_cell():
    dmap = {"base": {"doses_per_day": 20}, "cells": [
        {"r0": 2.0, "dose_factor": 1.0, "vaccine_efficacy": 0.9, "seed_location": "random", "best": "a"},
        {"r0": 4.0, "dose_factor": 0.5, "vaccine_efficacy": 0.9, "seed_location": "random", "best": "b"},
    ]}
    assert lookup(dmap, SimConfig(r0=3.9, doses_per_day=10))["best"] == "b"
    assert lookup(dmap, SimConfig(r0=2.1, doses_per_day=20))["best"] == "a"
