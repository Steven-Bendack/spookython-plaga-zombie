from http.server import BaseHTTPRequestHandler

from _common import MAX_RUNS, read_body, send_json
from engine.api import simulate


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_body(self)
            body["runs"] = min(int(body.get("runs", MAX_RUNS)), MAX_RUNS)
            send_json(self, simulate(body))
        except (ValueError, TypeError) as exc:
            send_json(self, {"error": f"Parámetros inválidos: {exc}"}, 400)
