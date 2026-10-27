"""Simulation configuration: defaults, limits and a stable hash.

Every number here is documented in docs/supuestos.md.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, fields, replace

ENGINE_VERSION = "0.1.0"

# Manta canton, INEC Census 2022 (see docs/supuestos.md).
MANTA_POPULATION = 271_145

SEED_LOCATIONS = ("random", "market", "school")  # plus any barrio name


@dataclass(frozen=True)
class SimConfig:
    seed: int = 2026                # jury-chosen seed: drives every random draw of the runs
    city_seed: int = 2026           # builds the synthetic Manta (same city for every jury seed)
    runs: int = 100                 # Monte Carlo runs per policy
    days: int = 150
    population: int = 10_000
    r0: float = 2.0                 # target basic reproduction number
    latent_mean: float = 3.0        # days as "Mordido" (exposed, not infectious)
    infectious_mean: float = 5.0    # days as "Zombie" (infectious)
    initial_cases: int = 5
    seed_location: str = "random"
    vaccine_efficacy: float = 0.9   # probability a dose given to a Sano makes them immune
    doses_per_day: int = 20 
    vaccine_start_day: int = 7      # day the first doses arrive
    detection_prob: float = 0.6     # probability a Zombie is ever detected
    detection_delay: int = 2        # days from becoming Zombie to being detected
    strategy: str = "auto"          # "auto" = tournament, or a strategy name

    def validated(self) -> "SimConfig":
        """Clamp to safe limits so a public API cannot trigger huge runs."""
        c = self
        c = replace(c, runs=_clamp_int(c.runs, 1, 400))
        c = replace(c, days=_clamp_int(c.days, 10, 365))
        c = replace(c, population=_clamp_int(c.population, 1_000, 40_000))
        c = replace(c, r0=_clamp(c.r0, 0.0, 8.0))
        c = replace(c, latent_mean=_clamp(c.latent_mean, 0.5, 14.0))
        c = replace(c, infectious_mean=_clamp(c.infectious_mean, 1.0, 21.0))
        c = replace(c, initial_cases=_clamp_int(c.initial_cases, 1, 200))
        c = replace(c, vaccine_efficacy=_clamp(c.vaccine_efficacy, 0.0, 1.0))
        c = replace(c, doses_per_day=_clamp_int(c.doses_per_day, 0, 5_000))
        c = replace(c, vaccine_start_day=_clamp_int(c.vaccine_start_day, 0, 365))
        c = replace(c, detection_prob=_clamp(c.detection_prob, 0.0, 1.0))
        c = replace(c, detection_delay=_clamp_int(c.detection_delay, 0, 30))
        return c

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "SimConfig":
        known = {f.name: f.type for f in fields(cls)}
        kwargs = {}
        defaults = cls()
        for name in known:
            if name in data and data[name] is not None:
                default = getattr(defaults, name)
                kwargs[name] = type(default)(data[name])
        return cls(**kwargs).validated()

    def config_hash(self) -> str:
        """Short SHA-256 of the canonical config + engine version."""
        payload = json.dumps({"engine": ENGINE_VERSION, **self.to_dict()}, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()[:12]

    @property
    def manta_scale(self) -> float:
        """How many real Manta residents each simulated agent represents."""
        return MANTA_POPULATION / self.population


def _clamp(value: float, low: float, high: float) -> float:
    return float(min(max(value, low), high))


def _clamp_int(value: int, low: int, high: int) -> int:
    return int(min(max(int(value), low), high))
