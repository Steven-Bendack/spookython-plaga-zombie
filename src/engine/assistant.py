"""Two helpers written by an LLM (DeepSeek), both safe without it.

1. parse_request: the jury describes a Surprise Outbreak in plain words ("twice as
   contagious, starts at the market, only 10 doses") and gets back simulation
   parameters. The LLM may only propose changes; every key and value is checked
   against a closed whitelist before the engine sees it, so free text can never
   reach the simulation. Without a key, or if the LLM fails, a rule-based parser
   understands the usual phrases.

2. wave_news: one TV-style headline per week of a replayed run, written from the
   run's own numbers. Without the LLM, the same headlines come from a template.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata

from .mayor import ask_deepseek
from .population import BARRIO_NAMES
from .strategies import LABELS

MAX_TEXT = 400
LOCATIONS = ("random", "market", "school", *BARRIO_NAMES)
# key: (kind, low, high)
CHANGES = {
    "r0": ("float", 0.5, 6.0),
    "doses_per_day": ("int", 0, 200),
    "vaccine_efficacy": ("float", 0.1, 1.0),
    "detection_prob": ("float", 0.1, 1.0),
    "initial_cases": ("int", 1, 50),
    "seed": ("int", 0, 2**31 - 1),
    "seed_location": ("place", None, None),
    "close_market": ("bool", None, None),
    "close_schools": ("bool", None, None),
}
LABELS_ES = {
    "r0": "contagio (R0)", "doses_per_day": "vacunas por día", "vaccine_efficacy": "eficacia",
    "detection_prob": "detección", "initial_cases": "casos iniciales", "seed": "semilla",
    "seed_location": "inicio", "close_market": "cerrar el mercado", "close_schools": "cerrar los colegios",
}
PLACE_ES = {"random": "cualquier lugar", "market": "el mercado central", "school": "un colegio"}


def clean_changes(raw) -> dict:
    """Keep only whitelisted keys with valid, in-range values (anything else is dropped)."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for key, value in raw.items():
        if key not in CHANGES:
            continue
        kind, low, high = CHANGES[key]
        try:
            if kind == "place":
                if value in LOCATIONS:
                    out[key] = value
            elif kind == "bool":
                if isinstance(value, bool):
                    out[key] = value
            else:
                number = float(value)
                if not math.isfinite(number):
                    continue
                number = min(max(number, low), high)
                out[key] = int(round(number)) if kind == "int" else round(number, 2)
        except (TypeError, ValueError):
            continue
    return out


def describe(changes: dict) -> str:
    parts = []
    for key, value in changes.items():
        if key == "seed_location":
            parts.append(f"inicio: {PLACE_ES.get(value, 'barrio ' + value)}")
        elif key in ("close_market", "close_schools"):
            parts.append(LABELS_ES[key] if value else f"no {LABELS_ES[key]}")
        elif key in ("vaccine_efficacy", "detection_prob"):
            parts.append(f"{LABELS_ES[key]} {round(value * 100)} %")
        else:
            parts.append(f"{LABELS_ES[key]} {value}")
    return ", ".join(parts)


def _plain(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def rules_parse(text: str, current: dict) -> dict:
    """The usual Surprise Outbreak phrases, understood without an LLM."""
    t = _plain(text)
    out = {}
    r0 = float(current.get("r0", 2.0))
    doses = float(current.get("doses_per_day", 20))
    if re.search(r"(doble|dos veces|x ?2).{0,20}contag|contag.{0,20}(doble|dos veces|x ?2)", t):
        out["r0"] = r0 * 2
    elif re.search(r"(triple|tres veces).{0,20}contag|contag.{0,20}(triple|tres veces)", t):
        out["r0"] = r0 * 3
    elif m := re.search(r"r0\s*(?:de|=|a)?\s*(\d+(?:[.,]\d+)?)", t):
        out["r0"] = float(m.group(1).replace(",", "."))
    if re.search(r"mitad.{0,20}vacun|vacun.{0,20}mitad", t):
        out["doses_per_day"] = doses / 2
    elif re.search(r"sin vacunas|cero vacunas|0 vacunas", t):
        out["doses_per_day"] = 0
    elif m := re.search(r"(\d+)\s*(?:vacunas|dosis)", t):
        out["doses_per_day"] = int(m.group(1))
    if re.search(r"a medias|mitad de (?:la )?eficacia|eficacia (?:del )?50|50 ?% de eficacia|cubre (?:la )?mitad", t):
        out["vaccine_efficacy"] = 0.5
    elif m := re.search(r"eficacia (?:del |de )?(\d{1,3}) ?%?", t):
        out["vaccine_efficacy"] = int(m.group(1)) / 100
    for name in BARRIO_NAMES:
        if _plain(name) in t:
            out["seed_location"] = name
    if "seed_location" not in out:
        if re.search(r"(empieza|inicia|comienza|arranca|brote).{0,30}mercado", t):
            out["seed_location"] = "market"
        elif re.search(r"(empieza|inicia|comienza|arranca|brote).{0,30}(colegio|escuela)", t):
            out["seed_location"] = "school"
    if re.search(r"cerr\w*.{0,15}mercado", t):
        out["close_market"] = True
    if re.search(r"cerr\w*.{0,15}(colegios|escuelas)", t):
        out["close_schools"] = True
    if m := re.search(r"semilla\s*(\d+)", t):
        out["seed"] = int(m.group(1))
    return clean_changes(out)


def _parse_prompt(text: str, current: dict) -> str:
    keys = ", ".join(f"{k} ({v[0]})" for k, v in CHANGES.items())
    return (
        "Traduce el pedido del jurado a cambios de parámetros de una simulación de epidemia en Manta. "
        "Responde SOLO un objeto JSON: {\"changes\": {...}}. Claves permitidas: " + keys + ". "
        "seed_location es uno de: " + ", ".join(LOCATIONS) + ". "
        "Las proporciones van entre 0 y 1 (50 % = 0.5). Si dice 'el doble' o 'la mitad', calcula sobre los "
        "valores actuales. No agregues claves que el pedido no mencione. "
        f"Valores actuales: {json.dumps({k: current[k] for k in CHANGES if k in current})}. "
        f"Pedido: \"{text}\""
    )


def _json_from(reply: str):
    match = re.search(r"\{.*\}", reply, re.S)
    return json.loads(match.group(0)) if match else {}


def parse_request(body: dict, ask=ask_deepseek) -> dict:
    text = str(body.get("text", ""))[:MAX_TEXT].strip()
    if not text:
        raise ValueError("escribe qué cambia en el brote")
    current = clean_changes(body.get("current") or {})
    source = "ai"
    try:
        changes = clean_changes(_json_from(ask(_parse_prompt(text, current))).get("changes"))
        if not changes:
            raise ValueError("sin cambios")
    except Exception:  # noqa: BLE001 - any AI failure falls back to the rules
        changes, source = rules_parse(text, current), "rules"
    return {"changes": changes, "summary": describe(changes) or "No reconocí ningún cambio.", "source": source}


# ---------- waves: one headline per week of the replayed run ----------

MAX_WEEKS = 26


def clean_weeks(raw) -> list[dict]:
    weeks = []
    for w in (raw or [])[:MAX_WEEKS]:
        try:
            weeks.append({
                "week": int(min(max(int(w["week"]), 1), 60)),
                "zombies": int(min(max(int(w["zombies"]), 0), 1_000_000)),
                "bitten": int(min(max(int(w["bitten"]), 0), 1_000_000)),
                "vaccinated": int(min(max(int(w["vaccinated"]), 0), 1_000_000)),
                "barrios": [b for b in w.get("barrios", []) if b in BARRIO_NAMES][:4],
            })
        except (KeyError, TypeError, ValueError):
            continue
    return weeks


def _n(x: int) -> str:
    return f"{x:,}".replace(",", " ")


def template_news(weeks: list[dict], peak_week: int) -> list[str]:
    out = []
    for w in weeks:
        if w["barrios"]:
            line = f"La plaga llega a {', '.join(w['barrios'])}: {_n(w['zombies'])} zombis caminan por Manta."
        elif w["week"] == peak_week:
            line = f"Pico del brote: {_n(w['zombies'])} zombis a la vez. Los hospitales no dan abasto."
        elif w["week"] > peak_week and w["zombies"] > 0:
            line = f"La ola retrocede: quedan {_n(w['zombies'])} zombis y {_n(w['vaccinated'])} mantenses ya están protegidos."
        elif w["zombies"] == 0:
            line = "Ningún zombi a la vista. Manta respira, pero el comité no baja la guardia."
        else:
            line = f"Ya mordieron a {_n(w['bitten'])} personas; el comité sigue vacunando."
        out.append(line)
    return out


def wave_news(body: dict, ask=ask_deepseek) -> dict:
    weeks = clean_weeks(body.get("weeks"))
    if not weeks:
        raise ValueError("sin semanas")
    strategy = LABELS.get(body.get("strategy"), "sin intervenir")
    peak_week = max(weeks, key=lambda w: w["zombies"])["week"]
    fallback = template_news(weeks, peak_week)
    prompt = (
        "Eres el presentador de un noticiero de última hora en Manta, Ecuador, durante una plaga zombi simulada. "
        "Escribe UN titular por cada semana, con tono de noticiero urgente y humano (máximo 16 palabras), en español. "
        "NO empieces con 'Semana' ni repitas el número de semana. Menciona los barrios cuando aparezcan. "
        f"Usa SOLO estos datos, sin inventar cifras. El comité aplica: {strategy}. "
        "Responde SOLO un arreglo JSON de textos, uno por semana, en el mismo orden.\n"
        + "\n".join(f"Semana {w['week']}: {w['zombies']} zombis activos, {w['bitten']} mordidos en total, "
                    f"{w['vaccinated']} vacunados" + (f", la plaga llega a {', '.join(w['barrios'])}" if w["barrios"] else "")
                    for w in weeks)
    )
    try:
        match = re.search(r"\[.*\]", ask(prompt), re.S)
        lines = json.loads(match.group(0)) if match else []
        if len(lines) != len(weeks) or not all(isinstance(x, str) and x.strip() for x in lines):
            raise ValueError("respuesta incompleta")
        # Thousands spaced like the rest of the app ("16 296"), whatever the model wrote.
        news = [re.sub(r"(?<![\d.,])\d{4,}(?![\d.,])", lambda m: _n(int(m.group(0))), re.sub(r"\s+", " ", x).strip())[:140] for x in lines]
        return {"news": news, "source": "ai"}
    except Exception:  # noqa: BLE001 - template fallback
        return {"news": fallback, "source": "fallback"}
