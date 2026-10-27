from http.server import BaseHTTPRequestHandler

from _common import send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        send_json(self, {"error": "El ataque en vivo corre en la versión de AWS o en local; "
                                  "aquí se muestra el último ataque guardado"}, 503)
