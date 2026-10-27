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
from engine.montecarlo import process_pool_runner  # noqa: E402

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


if __name__ == "__main__":
    main(set(sys.argv[1:]) or {"map", "jury"})
