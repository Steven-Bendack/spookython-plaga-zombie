import json

from engine.game import DIFFICULTY, WEEK, play


def test_same_seed_and_decisions_replay_identically():
    plan = [{"mode": "ring"}, {"mode": "degree", "schools": True}]
    assert json.dumps(play(2026, "normal", plan)) == json.dumps(play(2026, "normal", plan))


def test_each_turn_advances_one_week():
    out = play(2026, "normal", [{"mode": "ring"}] * 3)
    assert out["day"] == 3 * WEEK and out["week"] == 3 and not out["over"]


def test_budget_never_goes_negative_with_closures():
    plan = [{"mode": "ring", "market": True, "schools": True}] * 6
    out = play(2026, "hard", plan)
    assert out["budget_left"] >= 0


def test_unknown_choices_fall_back_to_safe_defaults():
    out = play(2026, "does-not-exist", [{"mode": "hack", "barrio": "Atlantis"}])
    assert out["day"] == WEEK


def test_the_end_reveals_and_compares_on_the_same_runs():
    out = play(2026, "normal", [{"mode": "degree"}] * 22)
    assert out["over"]
    res = out["result"]
    assert set(res["rivals"]) == {"none", "random", "auto"}
    assert 0 <= res["wins_vs_auto"] <= res["score_runs"]
    assert res["you"]["infected"] < res["rivals"]["none"]["infected"]
    assert res["map"]["bitten"]


def test_difficulties_are_valid():
    for key in DIFFICULTY:
        assert play(7, key, [{"mode": "random"}])["day"] == WEEK
