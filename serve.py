#!/usr/bin/env python3
"""Stille feed: lokale server. Serveert de statische bestanden en een kleine
alleen-lezen proxy /hup-api/* -> https://hup.social/api/v1/* (Hup stuurt geen CORS-headers)."""
import http.server, os, sys, urllib.request, urllib.error

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/hup-api/'):
            url = 'https://hup.social/api/v1/' + self.path[len('/hup-api/'):]
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'stille-feed/1.0', 'Accept': 'application/json'})
                with urllib.request.urlopen(req, timeout=20) as r:
                    body, code = r.read(), r.status
            except urllib.error.HTTPError as e:
                body, code = e.read(), e.code
            except Exception as e:
                body, code = str(e).encode(), 502
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

print(f'Stille feed draait op http://localhost:{PORT}')
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
