"""Build the real-data series used to calibrate the model: excess deaths in Manta, 2020.

Source: ecuacovid (https://github.com/andrab/ecuacovid, MIT license), which
normalises the weekly death records of Ecuador's Registro Civil by canton.
Excess deaths = deaths in 2020 minus the 2017-2019 average of the same week.
During 2020 Ecuador tested very little, so excess deaths show the shape of the
first wave much better than confirmed cases.

Usage (from the repo root):
    python scripts/build_covid_manta.py
Writes data/covid_manta_2020.csv (committed) for scripts/precompute.py.
"""
import csv
import io
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = ("https://raw.githubusercontent.com/andrab/ecuacovid/master/datos_crudos/"
       "defunciones/{year}/lugar_cantones_semanal.csv")
BASELINE_YEARS = (2017, 2018, 2019)
CANTON = "Manta"


def weekly_deaths(year: int) -> dict[int, int]:
    with urllib.request.urlopen(URL.format(year=year), timeout=60) as res:
        text = res.read().decode("utf-8")
    return {int(r["semana"]): int(r["total"]) for r in csv.DictReader(io.StringIO(text))
            if r["canton"] == CANTON}


def main() -> None:
    base = {y: weekly_deaths(y) for y in BASELINE_YEARS}
    deaths_2020 = weekly_deaths(2020)
    out = ROOT / "data" / "covid_manta_2020.csv"
    out.parent.mkdir(exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["week", "deaths_2020", "baseline_2017_2019", "excess"])
        for week in range(1, 53):
            baseline = sum(base[y].get(week, 0) for y in BASELINE_YEARS) / len(BASELINE_YEARS)
            d = deaths_2020.get(week, 0)
            w.writerow([week, d, round(baseline, 2), round(d - baseline, 2)])
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
