"""Named scenarios: real diseases and fictional zombies, with their sources.

Every number is either sourced or marked as a fiction assumption. The model is
a daily SEIR, so anything faster than a day (World War Z's 12-second turn)
becomes the minimum of one day: that limitation is stated in the UI.
"""
from __future__ import annotations

# R0 that reproduces the growth of Manta's first COVID-19 wave (2020) in our
# synthetic Manta. Computed by scripts/precompute.py (step "real") from the
# Registro Civil excess deaths; see engine/realdata.py and data/README.md.
COVID_MANTA_2020_R0 = 2.35

SCENARIOS = {
    "covid_manta_2020": {
        "label": "COVID-19 · Manta 2020",
        "kind": "real",
        "changes": {"r0": COVID_MANTA_2020_R0, "latent_mean": 3.0, "infectious_mean": 5.0},
        "source": "Calibrado con el exceso de muertes de Manta en 2020 (Registro Civil vía ecuacovid): "
                  "la ola crecía 8,4 % por día (se duplicaba cada 8,3 días).",
    },
    "flu_2009": {
        "label": "Influenza H1N1 · 2009",
        "kind": "real",
        "changes": {"r0": 1.46, "latent_mean": 1.5, "infectious_mean": 4.0},
        "source": "R0 mediano de la pandemia de 2009: 1,46 (Biggerstaff et al. 2014). "
                  "Incubación de influenza A ≈ 1,4 días (Lessler et al. 2009).",
    },
    "classic_zombie": {
        "label": "Zombi clásico (cine)",
        "kind": "fiction",
        "changes": {"r0": 1.25, "latent_mean": 0.5, "infectious_mean": 21.0},
        "source": "Alemi et al. 2015 (Physical Review E) ajustaron películas de zombis: α = 0,8, "
                  "así que cada zombi muerde a 1/α = 1,25 personas antes de ser destruido; "
                  "conversión con vida media de 30 minutos. Los zombis no se curan: duran hasta que los destruyen.",
    },
    "walking_dead": {
        "label": "The Walking Dead",
        "kind": "fiction",
        "changes": {"r0": 1.25, "latent_mean": 1.5, "infectious_mean": 21.0},
        "source": "Caminantes lentos como el zombi clásico (R0 1,25, Alemi et al. 2015). En la serie, "
                  "el mordido tiene fiebre, muere en uno o dos días y se levanta: latencia ≈ 1,5 días (supuesto de ficción).",
    },
    "world_war_z": {
        "label": "Guerra Mundial Z",
        "kind": "fiction",
        "changes": {"r0": 6.0, "latent_mean": 0.5, "infectious_mean": 21.0},
        "source": "En la película (2013) la conversión tarda 12 segundos y los zombis corren en hordas. "
                  "No hay estimación publicada: suponemos R0 = 6 (supuesto de ficción). Un modelo diario no "
                  "baja de 1 día de latencia, así que aquí la plaga es más lenta que en la película.",
    },
}
