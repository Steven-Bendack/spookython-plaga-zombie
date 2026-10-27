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
