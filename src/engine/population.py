"""Synthetic Manta: agents, households and a multilayer contact network.

The same city_seed always builds the same city. The network is stored as a
compressed sparse row (CSR) adjacency list: for agent i, its contacts are
indices[indptr[i]:indptr[i+1]], each with a weight and a layer.
Two agents can be linked in several layers (e.g. same home and same bus);
those are separate edges and their risks multiply.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cached_property, lru_cache
from pathlib import Path

import numpy as np

# Age groups.
TODDLER, STUDENT, ADULT, ELDER = 0, 1, 2, 3
# Shares derived from Manta canton, INEC Census 2022 (docs/supuestos.md).
AGE_SHARES = np.array([0.0815, 0.2035, 0.6353, 0.0797])

MEAN_HOUSEHOLD_SIZE = 3.2  # INEC Census 2022, national average

# Layers: name -> daily contact intensity relative to a household contact (assumption).
LAYERS = ("household", "school", "work", "bus", "market", "neighborhood")
LAYER_WEIGHTS = np.array([1.0, 0.2, 0.2, 0.05, 0.05, 0.02])
HOUSEHOLD, SCHOOL, WORK, BUS, MARKET, NEIGHBORHOOD = range(6)

CLASS_SIZE = 30
WORKPLACE_SIZE = 10
EMPLOYMENT_RATE = 0.55          # share of 18-64 with an out-of-home job (assumption)
MARKET_VISITOR_SHARE = 0.20     # adults/elders who go to the central market (assumption)
MARKET_VENDOR_SHARE = 0.01      # adults who sell there (assumption)
MARKET_VISITOR_DEGREE = 6
MARKET_VENDOR_CONTACTS = 40
BUS_DEGREE = 4
NEIGHBORHOOD_DEGREE = 4

# Approximate neighborhoods of Manta: name, lat, lon, share of households (assumption).
BARRIOS = (
    ("Tarqui", -0.9555, -80.7175, 0.18),
    ("Los Esteros", -0.9615, -80.7020, 0.12),
    ("Centro", -0.9475, -80.7290, 0.10),
    ("Eloy Alfaro", -0.9700, -80.6950, 0.10),
    ("Jocay", -0.9640, -80.7250, 0.10),
    ("La Pradera", -0.9720, -80.7120, 0.10),
    ("Urbirrios", -0.9860, -80.7150, 0.10),
    ("Barbasquillo", -0.9530, -80.7480, 0.07),
    ("San Mateo", -0.9560, -80.7880, 0.05),
    ("Santa Marianita", -1.0070, -80.8060, 0.08),
)
BARRIO_NAMES = tuple(b[0] for b in BARRIOS)


@dataclass(frozen=True)
class City:
    n: int
    age_group: np.ndarray      # (n,) int8
    household: np.ndarray      # (n,) int32
    barrio: np.ndarray         # (n,) int16
    is_student: np.ndarray     # (n,) bool
    is_worker: np.ndarray      # (n,) bool
    is_market: np.ndarray      # (n,) bool, visitor or vendor
    is_vendor: np.ndarray      # (n,) bool
    indptr: np.ndarray         # (n+1,) int64, CSR row pointers
    indices: np.ndarray        # (e,) int32, neighbor of each edge
    weight: np.ndarray         # (e,) float64, layer weight of each edge
    layer: np.ndarray          # (e,) int8
    pair_id: np.ndarray        # (e,) int64, same id for edges of the same (i, j) pair

    @cached_property
    def edge_source(self) -> np.ndarray:
        return np.repeat(np.arange(self.n, dtype=np.int32), np.diff(self.indptr))

    @cached_property
    def contact_count(self) -> np.ndarray:
        """Number of distinct people each agent meets."""
        first_of_pair = np.r_[True, self.pair_id[1:] != self.pair_id[:-1]]
        return np.bincount(self.edge_source[first_of_pair], minlength=self.n)

    @cached_property
    def strength(self) -> np.ndarray:
        """Weighted degree: total daily contact intensity of each agent."""
        return np.bincount(self.edge_source, weights=self.weight, minlength=self.n)

    @cached_property
    def hub_rank(self) -> np.ndarray:
        """Position of each agent when sorted by strength, scaled to [0, 1).

        Higher = more connected. A fixed shuffle breaks ties between equals.
        """
        tie_break = np.random.default_rng(0).permutation(self.n)
        order = np.lexsort((tie_break, self.strength))
        rank = np.empty(self.n)
        rank[order] = np.arange(self.n) / self.n
        return rank

    @cached_property
    def coords(self) -> np.ndarray:
        """(n, 2) lat/lon of each agent's home, for the map only (contagion uses the network).

        Each household gets one real point on a residential street of its barrio
        (OpenStreetMap, see scripts/build_manta_streets.py); its members stand a
        few meters apart there. Without that file, homes are scattered around
        the barrio center.
        """
        rng = np.random.default_rng(np.random.SeedSequence([self.n, 11]))
        homes = _street_homes()
        if homes is None:
            centers = np.array([(b[1], b[2]) for b in BARRIOS])[self.barrio]
            lat = centers[:, 0] - np.abs(rng.normal(0, 0.006, self.n))
            lon = centers[:, 1] + rng.normal(0, 0.007, self.n)
            return np.column_stack([lat, lon])
        n_households = int(self.household.max()) + 1
        house = np.zeros((n_households, 2))
        house_barrio = np.zeros(n_households, dtype=int)
        house_barrio[self.household] = self.barrio
        for b, points in enumerate(homes):
            members = np.flatnonzero(house_barrio == b)
            house[members] = points[rng.integers(0, len(points), members.size)]
        return house[self.household] + rng.normal(0, 0.00004, (self.n, 2))  # ~4 m apart

    @cached_property
    def hub_rank(self) -> np.ndarray:
        """Position of each agent when sorted by strength, scaled to [0, 1).

        Higher = more connected. A fixed shuffle breaks ties between equals.
        """
        tie_break = np.random.default_rng(0).permutation(self.n)
        order = np.lexsort((tie_break, self.strength))
        rank = np.empty(self.n)
        rank[order] = np.arange(self.n) / self.n
        return rank

    @cached_property
    def coords(self) -> np.ndarray:
        """(n, 2) approximate lat/lon of each agent's home, for the map only.

        Homes are scattered around their barrio's center; latitude only moves
        south (inland), because the barrios lie along the coast.
        """
        rng = np.random.default_rng(np.random.SeedSequence([self.n, 11]))
        centers = np.array([(b[1], b[2]) for b in BARRIOS])[self.barrio]
        lat = centers[:, 0] - np.abs(rng.normal(0, 0.006, self.n))
        lon = centers[:, 1] + rng.normal(0, 0.007, self.n)
        return np.column_stack([lat, lon])

    def summary(self) -> dict:
        per_layer = np.bincount(self.layer, minlength=len(LAYERS)) // 2
        return {
            "agents": self.n,
            "households": int(self.household.max() + 1),
            "students": int(self.is_student.sum()),
            "workers": int(self.is_worker.sum()),
            "market_people": int(self.is_market.sum()),
            "vendors": int(self.is_vendor.sum()),
            "contacts_by_layer": {name: int(c) for name, c in zip(LAYERS, per_layer)},
            "mean_contacts": float(self.contact_count.mean()),
            "barrios": list(BARRIO_NAMES),
        }


@lru_cache(maxsize=1)
def _street_homes():
    """Possible homes along Manta's residential streets, per barrio, or None."""
    path = Path(__file__).with_name("data") / "manta_homes.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("barrios") != list(BARRIO_NAMES):
        return None
    return [np.array(h, dtype=float) for h in data["homes"]]


def build_city(n: int, city_seed: int) -> City:
    return _build_city_cached(int(n), int(city_seed))


@lru_cache(maxsize=8)
def _build_city_cached(n: int, city_seed: int) -> City:
    rng = np.random.default_rng(np.random.SeedSequence([city_seed, 7]))

    age = rng.choice(4, size=n, p=AGE_SHARES).astype(np.int8)
    household = _assign_households(rng, age)
    barrio_shares = np.array([b[3] for b in BARRIOS])
    barrio_of_household = rng.choice(len(BARRIOS), size=household.max() + 1, p=barrio_shares)
    barrio = barrio_of_household[household].astype(np.int16)

    is_student = age == STUDENT
    is_worker = (age == ADULT) & (rng.random(n) < EMPLOYMENT_RATE)
    grown = (age == ADULT) | (age == ELDER)
    is_vendor = (age == ADULT) & (rng.random(n) < MARKET_VENDOR_SHARE)
    is_market = is_vendor | (grown & (rng.random(n) < MARKET_VISITOR_SHARE))

    edges = []  # list of (u, v, layer) arrays, each undirected pair listed once
    edges.append(_clique_edges(household, HOUSEHOLD))
    edges.append(_clique_edges(_chunk_groups(rng, np.flatnonzero(is_student), CLASS_SIZE,
                                             by=barrio, n=n), SCHOOL))
    edges.append(_clique_edges(_chunk_groups(rng, np.flatnonzero(is_worker), WORKPLACE_SIZE,
                                             by=None, n=n), WORK))
    commuters = np.flatnonzero(is_student | is_worker)
    edges.append(_random_edges(rng, commuters, BUS_DEGREE, BUS))
    edges.append(_market_edges(rng, np.flatnonzero(is_market), np.flatnonzero(is_vendor)))
    for b in range(len(BARRIOS)):
        edges.append(_random_edges(rng, np.flatnonzero(barrio == b), NEIGHBORHOOD_DEGREE,
                                   NEIGHBORHOOD))

    u = np.concatenate([e[0] for e in edges])
    v = np.concatenate([e[1] for e in edges])
    lay = np.concatenate([e[2] for e in edges])
    keep = u != v
    u, v, lay = u[keep], v[keep], lay[keep]

    # Store both directions, sorted by (source, neighbor).
    src = np.concatenate([u, v])
    dst = np.concatenate([v, u])
    lay = np.concatenate([lay, lay]).astype(np.int8)
    order = np.lexsort((dst, src))
    src, dst, lay = src[order], dst[order], lay[order]
    indptr = np.zeros(n + 1, dtype=np.int64)
    np.cumsum(np.bincount(src, minlength=n), out=indptr[1:])
    new_pair = np.r_[True, (src[1:] != src[:-1]) | (dst[1:] != dst[:-1])]
    pair_id = np.cumsum(new_pair) - 1

    return City(
        n=n, age_group=age, household=household, barrio=barrio,
        is_student=is_student, is_worker=is_worker, is_market=is_market, is_vendor=is_vendor,
        indptr=indptr, indices=dst.astype(np.int32), weight=LAYER_WEIGHTS[lay],
        layer=lay, pair_id=pair_id,
    )


def _assign_households(rng: np.random.Generator, age: np.ndarray) -> np.ndarray:
    """One adult or elder heads each home; everyone else joins a random home.

    Sizes come out as 1 + Poisson(mean - 1), so the mean matches the census.
    """
    n = age.size
    n_households = max(1, round(n / MEAN_HOUSEHOLD_SIZE))
    can_head = np.flatnonzero(age >= ADULT)
    heads = rng.choice(can_head, size=min(n_households, can_head.size), replace=False)
    household = np.empty(n, dtype=np.int32)
    household[heads] = np.arange(heads.size)
    others = np.setdiff1d(np.arange(n), heads)
    household[others] = rng.integers(0, heads.size, size=others.size)
    return household


def _chunk_groups(rng, members: np.ndarray, size: int, by, n: int) -> np.ndarray:
    """Split members into groups of `size` (within each value of `by` if given).

    Returns a group id per agent, -1 for agents outside every group.
    """
    group = np.full(n, -1, dtype=np.int64)
    pools = [members] if by is None else [members[by[members] == b] for b in np.unique(by)]
    next_id = 0
    for pool in pools:
        pool = rng.permutation(pool)
        ids = np.arange(pool.size) // size
        group[pool] = ids + next_id
        next_id += int(ids.max()) + 1 if pool.size else 0
    return group


def _clique_edges(group: np.ndarray, layer: int):
    """Everyone in the same group is in contact with everyone else."""
    members = np.flatnonzero(group >= 0)
    members = members[np.argsort(group[members], kind="stable")]
    g = group[members]
    starts = np.flatnonzero(np.r_[True, g[1:] != g[:-1]])
    ends = np.r_[starts[1:], members.size]
    us, vs = [], []
    for s, e in zip(starts, ends):
        k = e - s
        if k < 2:
            continue
        a, b = np.triu_indices(k, 1)
        us.append(members[s + a])
        vs.append(members[s + b])
    u = np.concatenate(us) if us else np.empty(0, np.int64)
    v = np.concatenate(vs) if vs else np.empty(0, np.int64)
    return u, v, np.full(u.size, layer)


def _random_edges(rng, members: np.ndarray, mean_degree: float, layer: int):
    """Random contacts inside a set of people (Erdos-Renyi style)."""
    m = int(members.size * mean_degree / 2)
    if members.size < 2 or m == 0:
        return np.empty(0, np.int64), np.empty(0, np.int64), np.empty(0, np.int64)
    u = rng.choice(members, size=m)
    v = rng.choice(members, size=m)
    return u, v, np.full(m, layer)


def _market_edges(rng, market_people: np.ndarray, vendors: np.ndarray):
    """Visitors meet a few people; each vendor meets many visitors (market hubs)."""
    u1, v1, _ = _random_edges(rng, market_people, MARKET_VISITOR_DEGREE, MARKET)
    u2 = np.repeat(vendors, MARKET_VENDOR_CONTACTS)
    v2 = rng.choice(market_people, size=u2.size)
    u = np.concatenate([u1, u2])
    v = np.concatenate([v1, v2])
    return u, v, np.full(u.size, MARKET)
