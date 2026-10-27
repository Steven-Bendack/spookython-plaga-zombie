"""Shared helpers for the Vercel preview (serverless Python functions).

Vercel is a secondary preview host; the official deployment is AWS (infra/).
Each request runs serially in one function, so runs are capped lower.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

MAX_RUNS = 40
MAX_BODY = 16_384


def send_json(handler: BaseHTTPRequestHandler, data, status: int = 200) -> None:
    payload = json.dumps(data).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def read_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length") or 0)
    if length > MAX_BODY:
        raise ValueError("cuerpo demasiado grande")
    data = json.loads(handler.rfile.read(length) or b"{}")
    if not isinstance(data, dict):
        raise ValueError("se esperaba un objeto JSON")
    return data
