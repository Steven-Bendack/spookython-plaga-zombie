"""Precompute the decision map and the Jury Mode report for the web UI.

Usage (from the repo root):
    python scripts/precompute.py            # both
    python scripts/precompute.py jury       # only Jury Mode
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from engine.config import SimConfig  # noqa: E402
from engine.decision_map import build_decision_map  # noqa: E402
from engine.jury import red_team  # noqa: E402
from dataclasses import replace  # noqa: E402

import numpy as np  # noqa: E402

from engine.montecarlo import process_pool_runner, tournament  # noqa: E402
from engine.realdata import (calibrate_to_growth, growth_rate, half_max_width,  # noqa: E402
                             load_excess)
from engine.scenarios import COVID_MANTA_2020_R0, SCENARIOS  # noqa: E402
from engine.strategies import LABELS  # noqa: E402

OUT = ROOT / "src" / "web" / "data"


def main(which: set[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = SimConfig()
    if "map" in which:
        t = time.time()
        data = build_decision_map(base, runs=20, runner=process_pool_runner)
        (OUT / "decision_map.json").write_text(json.dumps(data), encoding="utf-8")
        print(f"decision map: {len(data['cells'])} cells in {time.time() - t:.0f} s")
    if "jury" in which:
        t = time.time()
        data = red_team(base, strategy="ring_hubs", points=40, runs=12, refine=9,
                        runner=process_pool_runner)
        (OUT / "jury.json").write_text(json.dumps(data), encoding="utf-8")
        print(f"jury: {len(data['points'])} points in {time.time() - t:.0f} s")
        print("fixed", data["fixed_share"], "auto", data["auto_share"])
        print(data["frontier_text"])


def real(base: SimConfig) -> None:
    """Calibrate R0 to the growth of Manta's 2020 excess deaths; compare shapes."""
    t = time.time()
    weeks, excess = load_excess(ROOT / "data" / "covid_manta_2020.csv")
    observed = np.clip(excess, 0, None)
    rate, window = growth_rate(observed, step_days=7)
    fit = calibrate_to_growth(base, rate, runs=30, runner=process_pool_runner)
    model = np.array(fit["curve_at_r0"])
    # Align the two waves at their peaks to compare the shape.
    shift = int(np.argmax(observed)) - int(np.argmax(model))
    data = {
        "weeks": weeks.tolist(), "excess": excess.tolist(),
        "observed_growth_per_day": rate, "doubling_days": float(np.log(2) / rate),
        "rising_weeks": weeks[window].tolist(),
        "r0_calibrated": fit["r0"], "fit": {"r0": fit["r0_grid"], "growth_per_day": fit["model_rates"]},
        "model_weekly": model.tolist(), "model_week_shift": shift,
        "model_r0_for_curve": fit["grid_r0_for_curve"],
        "half_max_weeks": {"real": half_max_width(observed), "model": half_max_width(model)},
        "excess_total": float(observed[9:40].sum()),
    }
    (OUT / "real_covid.json").write_text(json.dumps(data), encoding="utf-8")
    print(f"real: growth {rate:.4f}/day, R0 = {fit['r0']:.2f} in {time.time() - t:.0f} s")
    if abs(fit["r0"] - COVID_MANTA_2020_R0) > 0.05:
        print(f"WARNING: update COVID_MANTA_2020_R0 in engine/scenarios.py to {fit['r0']:.2f}")


def fiction(base: SimConfig) -> None:
    """Run the tournament on each real and fictional scenario."""
    t = time.time()
    out = {}
    for key, sc in SCENARIOS.items():
        days = 365 if sc["kind"] == "fiction" else 200
        cfg = replace(base, runs=40, days=days, **sc["changes"]).validated()
        res = tournament(cfg, process_pool_runner)
        best = res["ranking"][0]
        none = res["summaries"]["none"]
        zombies = np.array(none["curves"]["I"])
        alive = np.flatnonzero(zombies >= 0.5)
        out[key] = {
            "label": sc["label"], "kind": sc["kind"], "source": sc["source"], "config": cfg.to_dict(),
            "attack_rate_none": none["attack_rate"], "peak_day_none": none["peak_day"],
            "last_day_none": int(alive[-1]) if alive.size else 0,
            "best": best["name"], "best_label": LABELS[best["name"]],
            "saved_vs_none": best["vs_none"]["mean"], "saved_vs_random": best["vs_random"]["mean"],
            "win_rate_vs_random": best["vs_random"]["win_rate"],
            "curve_none": none["curves"]["I"],
            "curve_best": res["summaries"][best["name"]]["curves"]["I"],
        }
        print(f"  {key}: attack {none['attack_rate']:.0%}, best {best['name']}, "
              f"win {best['vs_random']['win_rate']:.0%}")
    (OUT / "scenarios.json").write_text(json.dumps(out), encoding="utf-8")
    print(f"scenarios in {time.time() - t:.0f} s")


if __name__ == "__main__":
    steps = set(sys.argv[1:]) or {"map", "jury", "real", "fiction"}
    main(steps)
    if "real" in steps:
        real(SimConfig())
    if "fiction" in steps:
        fiction(SimConfig())
