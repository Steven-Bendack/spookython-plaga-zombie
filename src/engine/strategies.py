"""Vaccination strategies.

A strategy only sees what a real health committee could see:
  - the contact network (who lives, studies, works with whom),
  - which Zombies were DETECTED (with probability and delay) and are still sick,
  - which people it already vaccinated.
It never sees Mordidos (exposed) or undetected Zombies. A dose given to one of
them is wasted, and we count it.

Each strategy returns a priority key per agent (higher = vaccinate first).
The simulation gives the doses of the day to the highest keys among the
eligible people (not vaccinated and not detected as infected).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .disease import neighbor_sum
from .population import BARRIO_NAMES, ELDER, City

BASELINES = ("none", "random")
CANDIDATES = ("degree", "acquaintance", "ring", "ring_hubs")
ALL_POLICIES = BASELINES + CANDIDATES

# Plain-language description for the mayor (UI and recommendation text).
DESCRIPTIONS = {
    "none": "No vacunar",
    "random": "Vacunar al azar con las mismas dosis",
    "degree": "Vacunar primero a quienes tienen más contacto diario (colegios, trabajos, mercado)",
    "acquaintance": "Elegir gente al azar y vacunar a un contacto suyo (llega a los más conectados sin conocer la red)",
    "ring": "Vacunar el anillo de contactos de cada caso detectado; el resto de dosis al azar",
    "ring_hubs": "Vacunar el anillo de cada caso detectado; el resto de dosis a los más conectados",
}

LABELS = {
    "none": "Nada",
    "random": "Azar",
    "degree": "Más conectados",
    "acquaintance": "Conocido",
    "ring": "Anillo",
    "ring_hubs": "Anillo + conectados",
}


# "¿Le ganas al comité?": a person ranks up to three groups to vaccinate first.
# The plan travels as a policy name, "player:students,barrio:Tarqui", so it gets
# its own random stream and the same luck as every other policy.
PLAYER_PREFIX = "player:"
PLAYER_MAX_GROUPS = 3
PLAYER_GROUPS = {
    "students": "Estudiantes (colegios)",
    "workers": "Trabajadores",
    "elders": "Adultos mayores",
    "market": "Gente del mercado central",
    **{f"barrio:{b}": f"Barrio {b}" for b in BARRIO_NAMES},
}


def player_policy(groups) -> str:
    """Validated policy name for a player's plan (1 to 3 known groups, in order)."""
    groups = [str(g) for g in groups]
    if not 1 <= len(groups) <= PLAYER_MAX_GROUPS or len(set(groups)) != len(groups):
        raise ValueError(f"el plan debe tener de 1 a {PLAYER_MAX_GROUPS} grupos distintos")
    unknown = [g for g in groups if g not in PLAYER_GROUPS]
    if unknown:
        raise ValueError(f"grupo desconocido: {unknown[0]}")
    return PLAYER_PREFIX + ",".join(groups)


def player_groups(policy: str) -> list[str]:
    return policy[len(PLAYER_PREFIX):].split(",")


def player_label(policy: str) -> str:
    return " → ".join(PLAYER_GROUPS[g] for g in player_groups(policy))


def _members(city: City, group: str) -> np.ndarray:
    if group == "students":
        return city.is_student
    if group == "workers":
        return city.is_worker
    if group == "elders":
        return city.age_group == ELDER
    if group == "market":
        return city.is_market
    return city.barrio == BARRIO_NAMES.index(group.split(":", 1)[1])


@dataclass
class Visible:
    """What the committee observes on a given day, per run (rows) and agent (columns)."""
    visible_zombie: np.ndarray   # detected and still infectious
    rng: list                    # one generator per run, private to this policy


def priority_keys(policy: str, city: City, seen: Visible) -> np.ndarray:
    if policy == "degree":
        return np.broadcast_to(city.hub_rank, seen.visible_zombie.shape)
    noise = np.empty(seen.visible_zombie.shape)  # random choices of this policy
    for row, g in enumerate(seen.rng):
        g.random(out=noise[row])
    if policy == "random":
        return noise
    if policy.startswith(PLAYER_PREFIX):
        # First group first, then the second, then the third; at random inside a
        # group and for everyone else once the groups are covered.
        groups = player_groups(policy)
        tier = np.zeros(city.n)
        for rank, group in enumerate(groups):
            tier = np.maximum(tier, np.where(_members(city, group), len(groups) - rank, 0))
        return tier[None, :] + noise
    if policy == "acquaintance":
        # Picking a random person and then a random contact of theirs reaches each
        # agent with probability proportional to their number of contacts.
        # Weighted sampling without replacement (Efraimidis-Spirakis): key = u^(1/k).
        k = np.maximum(city.contact_count, 1)
        return np.log(np.maximum(noise, 1e-300)) / k
    if policy in ("ring", "ring_hubs"):
        # Ring: people in contact with a detected Zombie, closest contacts first.
        exposure = neighbor_sum(city, city.weight, seen.visible_zombie)
        fill = noise if policy == "ring" else city.hub_rank[None, :]
        return np.where(exposure > 0, 2.0 + exposure, fill)
    raise ValueError(f"unknown policy {policy!r}")
