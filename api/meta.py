from http.server import BaseHTTPRequestHandler

from _common import send_json
from engine.api import meta


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        send_json(self, meta())
