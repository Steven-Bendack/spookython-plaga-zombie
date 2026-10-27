"""Local server: serves the web UI and the same JSON API as AWS.

    python src/server.py            # http://localhost:8000

Uses only the standard library. Simulations run in a local process pool.
"""
from __future__ import annotations

import json
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine.api import meta, simulate  # noqa: E402
from engine.config import SimConfig  # noqa: E402
from engine.jury import red_team  # noqa: E402
from engine.mayor import mayor_report  # noqa: E402
from engine.montecarlo import process_pool_runner  # noqa: E402

WEB_DIR = Path(__file__).resolve().parent / "web"
MAX_BODY = 16_384


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/meta"):
            return self._json(meta())
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self._json({"error": "La petición es demasiado grande."}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._json({"error": "El cuerpo no es JSON válido."}, HTTPStatus.BAD_REQUEST)
        try:
            if self.path.startswith("/api/simulate"):
                return self._json(simulate(body, process_pool_runner))
            if self.path.startswith("/api/report"):
                return self._json(mayor_report(body))
            if self.path.startswith("/api/jury"):
                cfg = SimConfig.from_dict(body)
                points = int(min(max(body.get("points", 24), 8), 60))
                return self._json(red_team(cfg, points=points, runs=10, refine=6,
                                           runner=process_pool_runner))
        except (ValueError, TypeError, KeyError) as exc:
            return self._json({"error": f"Parámetros inválidos: {exc}"}, HTTPStatus.BAD_REQUEST)
        return self._json({"error": "Ruta no encontrada."}, HTTPStatus.NOT_FOUND)

    def _json(self, data, status=HTTPStatus.OK):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


def main(port: int = 8000) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Plaga Zombie listo en http://localhost:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
