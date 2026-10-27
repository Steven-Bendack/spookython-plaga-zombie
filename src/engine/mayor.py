"""Mayor's report: the verdict told in plain Spanish by an LLM (DeepSeek).

The engine already computed every number; the LLM only writes. It receives
validated numbers and a known strategy name, never free text from the client,
so it cannot be steered by the request. Without a key, or if the LLM fails,
the same report is built from a template: the app never depends on the AI.
"""
from __future__ import annotations

import json
import math
import os
import urllib.request

from .strategies import LABELS

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
TIMEOUT_S = 20

NUMBERS = {  # field: (low, high)
    "r0": (0, 8), "doses_per_day": (0, 5_000), "vaccine_efficacy": (0, 1), "runs": (1, 400),
    "manta_scale": (1, 1_000), "saved_none": (-1e6, 1e6), "saved_none_p5": (-1e6, 1e6),
    "saved_none_p95": (-1e6, 1e6), "saved_random": (-1e6, 1e6), "win_rate": (0, 1),
    "wasted_share": (0, 1),
}
PLACES = {"random": "cualquier lugar", "market": "el mercado central", "school": "los colegios"}


def facts_from(body: dict) -> dict:
    """Keep only known fields; reject anything that is not a finite number in range."""
    if body.get("strategy") not in LABELS or body["strategy"] in ("none", "random"):
        raise ValueError("estrategia desconocida")
    facts = {"strategy_label": LABELS[body["strategy"]],
             "place": PLACES.get(body.get("seed_location"), "un barrio de Manta")}
    for name, (low, high) in NUMBERS.items():
        value = float(body[name])
        if not math.isfinite(value):
            raise ValueError(f"{name} no es un número válido")
        facts[name] = min(max(value, low), high)
    return facts


def build_prompt(f: dict) -> str:
    wins = round(f["win_rate"] * f["runs"])
    return (
        "Eres el asesor del Comité de Contención de Manta, Ecuador. Escribe un informe para el alcalde, "
        "en español claro, sin tecnicismos ni siglas, máximo 110 palabras, en tres párrafos cortos: "
        "1) qué hacer, 2) por qué (con los números), 3) qué riesgo queda. Usa SOLO estos datos, "
        "no inventes cifras y aclara que es una simulación.\n"
        f"- Estrategia recomendada: {f['strategy_label']}\n"
        f"- La plaga empieza en {f['place']}; cada zombi contagia a {f['r0']:.1f} personas sin defensas\n"
        f"- Llegan {f['doses_per_day']:.0f} vacunas por día (modelo de 10 000 personas), eficacia {f['vaccine_efficacy']:.0%}\n"
        f"- Frente a no hacer nada evita {f['saved_none']:.0f} contagios en promedio "
        f"(entre {f['saved_none_p5']:.0f} y {f['saved_none_p95']:.0f}), unas "
        f"{f['saved_none'] * f['manta_scale']:.0f} personas de Manta\n"
        f"- Frente a vacunar al azar evita {f['saved_random']:.0f} contagios más y gana en {wins} de {f['runs']:.0f} simulaciones\n"
        f"- {f['wasted_share']:.0%} de las dosis se pierden en mordidos que aún no muestran síntomas"
    )


def fallback_text(f: dict) -> str:
    wins = round(f["win_rate"] * f["runs"])
    manta = f"{f['saved_none'] * f['manta_scale']:,.0f}".replace(",", " ")
    return (
        f"Señor alcalde: recomendamos «{f['strategy_label']}» para repartir las {f['doses_per_day']:.0f} vacunas diarias.\n\n"
        f"En la simulación evita en promedio {f['saved_none']:.0f} contagios frente a no hacer nada "
        f"(unas {manta} personas de Manta) y {f['saved_random']:.0f} más que vacunar al azar; "
        f"gana en {wins} de {f['runs']:.0f} simulaciones.\n\n"
        f"Riesgo: {f['wasted_share']:.0%} de las dosis se pierden en mordidos que todavía no se detectan. "
        "Son resultados de un modelo, no una predicción exacta."
    )


def ask_deepseek(prompt: str) -> str:
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("sin llave de DeepSeek")
    body = json.dumps({"model": os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"), "temperature": 0.3,
                       "max_tokens": 400, "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(DEEPSEEK_URL, body, {"Content-Type": "application/json",
                                                      "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
        text = json.load(res)["choices"][0]["message"]["content"].strip()
    if not text:
        raise RuntimeError("respuesta vacía")
    return text


def mayor_report(body: dict, ask=ask_deepseek) -> dict:
    facts = facts_from(body)
    try:
        return {"text": ask(build_prompt(facts)), "source": "ai"}
    except Exception:  # noqa: BLE001 - any AI failure falls back to the template
        return {"text": fallback_text(facts), "source": "fallback"}
