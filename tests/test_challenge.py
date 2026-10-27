import numpy as np
import pytest

from engine.api import challenge
from engine.calibrate import calibrated_beta
from engine.config import SimConfig
from engine.population import BARRIO_NAMES, build_city
from engine.seir import simulate_policy
from engine.strategies import player_label, player_policy

BASE = {"runs": 6, "days": 80, "population": 4000, "r0": 2.5}


def _run(policy, **changes):
    cfg = SimConfig.from_dict({**BASE, **changes})
    city = build_city(cfg.population, cfg.city_seed)
    beta = calibrated_beta(cfg.population, cfg.city_seed, cfg.r0, cfg.infectious_mean)
    return city, simulate_policy(city, cfg, beta, policy)


@pytest.mark.parametrize("plan", [[], ["students"] * 2, ["students", "workers", "elders", "market"], ["aliens"]])
def test_invalid_plans_are_rejected(plan):
    with pytest.raises(ValueError):
        player_policy(plan)


def test_plan_label_reads_in_order():
    policy = player_policy(["market", f"barrio:{BARRIO_NAMES[0]}"])
    assert player_label(policy) == f"Gente del mercado central → Barrio {BARRIO_NAMES[0]}"


def test_first_doses_go_to_the_first_group():
    # Doses on the first vaccination day all go to students (there are far more students than doses).
    city, res = _run(player_policy(["students"]), vaccine_start_day=1, doses_per_day=30)
    first = res.vaccinated_day == 1
    assert first.sum() > 0 and city.is_student[first].all()


def test_player_never_vaccinates_visible_cases():
    _, res = _run(player_policy(["elders", "market"]), detection_prob=1.0, detection_delay=0)
    assert res.vaccinated_non_eligible == 0


def test_challenge_is_reproducible_and_paired():
    request = {**BASE, "seed": 7, "plan": ["students", "market"]}
    a, b = challenge(request), challenge(request)
    a.pop("elapsed_seconds"), b.pop("elapsed_seconds")
    assert a == b
    gap = a["committee_vs_player"]
    assert len(gap["per_run"]) == BASE["runs"]
    # Committee minus player, run by run, equals the difference of what each saved vs Nada.
    saved_mine = np.array(a["player"]["vs_none"]["per_run"])
    saved_theirs = np.array(a["committee"]["vs_none"]["per_run"])
    assert (np.array(gap["per_run"]) == saved_theirs - saved_mine).all()
    assert a["verdict_text"]


def test_challenge_map_replays_the_typical_duel_for_both_sides():
    out = challenge({**BASE, "plan": ["elders"]})
    m = out["map"]
    gap = sorted(out["committee_vs_player"]["per_run"])
    assert 1 <= m["run"] <= BASE["runs"]
    assert out["committee_vs_player"]["per_run"][m["run"] - 1] == gap[len(gap) // 2]
    for side in ("player", "committee"):
        assert len(m[side]["counts"]) == BASE["days"] + 1
    # The replays use the same streams as the batch: their gap is that run's gap.
    replay_gap = len(m["player"]["bitten"]) - len(m["committee"]["bitten"])
    assert replay_gap == out["committee_vs_player"]["per_run"][m["run"] - 1]
