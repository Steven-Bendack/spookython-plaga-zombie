"""Build Manta's street data from OpenStreetMap (© OpenStreetMap contributors, ODbL).

Writes two files:
  src/engine/data/manta_homes.json   points every ~40 m along residential streets,
                                     grouped by barrio: each household gets one of
                                     them as its home (only used for the map)
  src/web/data/manta_streets.json    the street network as polylines, drawn under
                                     the outbreak on the map

Usage (from the repo root):
    python scripts/build_manta_streets.py
"""
import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from engine.population import BARRIOS  # noqa: E402

BBOX = (-1.035, -80.83, -0.925, -80.66)  # south, west, north, east
QUERY = ('[out:json][timeout:90];way["highway"~"^(primary|secondary|tertiary|residential|'
         'unclassified|living_street|trunk)$"]({},{},{},{});out geom;').format(*BBOX)
HOME_STREETS = {"residential", "living_street", "unclassified", "tertiary"}
STEP_M = 40            # one possible home every 40 m of street
MAX_BARRIO_KM = 2.5    # a street belongs to the closest barrio within this distance


def fetch() -> list[dict]:
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": QUERY}).encode(),
        headers={"User-Agent": "plaga-zombie-manta/0.1 (SpookyThon 2026)", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as res:
        return json.loads(res.read())["elements"]


def meters(a, b) -> float:
    dlat = (a[0] - b[0]) * 111_320
    dlon = (a[1] - b[1]) * 111_320 * math.cos(math.radians(a[0]))
    return math.hypot(dlat, dlon)


def nearest_barrio(p) -> tuple[int, float]:
    dists = [meters(p, (b[1], b[2])) for b in BARRIOS]
    i = min(range(len(dists)), key=dists.__getitem__)
    return i, dists[i]


def main() -> None:
    ways = fetch()
    homes = [[] for _ in BARRIOS]
    lines = []
    for way in ways:
        pts = [(g["lat"], g["lon"]) for g in way.get("geometry", [])]
        if len(pts) < 2:
            continue
        kind = way["tags"].get("highway")
        lines.append({"k": "main" if kind in ("primary", "secondary", "trunk") else "street",
                      "p": [[round(a, 5), round(b, 5)] for a, b in pts]})
        if kind not in HOME_STREETS:
            continue
        carry = 0.0
        for a, b in zip(pts, pts[1:]):
            seg = meters(a, b)
            t = STEP_M - carry
            while t <= seg:
                f = t / seg
                p = (a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]))
                i, d = nearest_barrio(p)
                if d <= MAX_BARRIO_KM * 1000:
                    homes[i].append([round(p[0], 5), round(p[1], 5)])
                t += STEP_M
            carry = (carry + seg) % STEP_M

    eng = ROOT / "src" / "engine" / "data"
    eng.mkdir(exist_ok=True)
    (eng / "manta_homes.json").write_text(json.dumps(
        {"source": "© OpenStreetMap contributors (ODbL)", "step_m": STEP_M,
         "barrios": [b[0] for b in BARRIOS], "homes": homes}), encoding="utf-8")
    (ROOT / "src" / "web" / "data" / "manta_streets.json").write_text(json.dumps(
        {"source": "© OpenStreetMap contributors (ODbL)", "lines": lines}, separators=(",", ":")),
        encoding="utf-8")
    print("homes per barrio:", {b[0]: len(h) for b, h in zip(BARRIOS, homes)})
    print("street lines:", len(lines))


if __name__ == "__main__":
    main()
