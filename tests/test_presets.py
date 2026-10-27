from engine.api import PRESETS
from engine.config import SimConfig


def test_every_surprise_preset_changes_the_defaults():
    base = SimConfig().to_dict()
    for key, preset in PRESETS.items():
        if key == "base":
            continue
        changed = {k: v for k, v in preset["changes"].items() if base[k] != v}
        assert changed, f"preset {key} does not change anything"


def test_half_doses_is_half_of_the_default():
    assert PRESETS["half_doses"]["changes"]["doses_per_day"] * 2 == SimConfig().doses_per_day


def test_closures_are_tried_only_when_vaccines_fall_short():
    from engine.api import vaccine_budget, vaccines_fall_short
    assert vaccines_fall_short({"win_rate": 0.67, "mean": 500})
    assert vaccines_fall_short({"win_rate": 0.97, "mean": 55})
    assert not vaccines_fall_short({"win_rate": 0.95, "mean": 1950})
    # Closures pay from what the vaccines alone could have spent, never for free.
    cfg = SimConfig(doses_per_day=10)
    assert vaccine_budget(cfg) == 10 * (cfg.days - cfg.vaccine_start_day)
