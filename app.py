"""Vercel preview adapter: one WSGI app (standard library only) over the engine.

Vercel is a secondary preview host; the official deployment is AWS (infra/).
Each request runs serially in one function, so runs are capped lower.
Static files are served by Vercel from public/ (a copy of src/web).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from engine.api import meta, simulate  # noqa: E402
from engine.mayor import mayor_report  # noqa: E402

MAX_RUNS = 40
MAX_BODY = 16_384


def app(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET")
    path = environ.get("PATH_INFO", "")
    try:
        if method == "GET" and path.endswith("/api/meta"):
            return _json(start_response, meta())
        if method == "POST" and path.endswith("/api/simulate"):
            body = _body(environ)
            body["runs"] = min(int(body.get("runs", MAX_RUNS)), MAX_RUNS)
            return _json(start_response, simulate(body))
        if method == "POST" and path.endswith("/api/report"):
            return _json(start_response, mayor_report(_body(environ)))
        if method == "POST" and path.endswith("/api/jury"):
            return _json(start_response, {"error": "El ataque en vivo corre en la versión de AWS o en local; "
                                                   "aquí se muestra el último ataque guardado"}, "503 Service Unavailable")
    except (ValueError, TypeError, OverflowError, KeyError) as exc:
        return _json(start_response, {"error": f"Parámetros inválidos: {exc}"}, "400 Bad Request")
    return _json(start_response, {"error": "Ruta no encontrada."}, "404 Not Found")


def _body(environ) -> dict:
    length = int(environ.get("CONTENT_LENGTH") or 0)
    if length > MAX_BODY:
        raise ValueError("cuerpo demasiado grande")
    data = json.loads(environ["wsgi.input"].read(length) or b"{}")
    if not isinstance(data, dict):
        raise ValueError("se esperaba un objeto JSON")
    return data


def _json(start_response, data, status="200 OK"):
    payload = json.dumps(data).encode()
    start_response(status, [("Content-Type", "application/json; charset=utf-8"),
                            ("Content-Length", str(len(payload)))])
    return [payload]
