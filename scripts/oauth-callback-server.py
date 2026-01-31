#!/usr/bin/env python3
"""Temporary HTTP server to receive OAuth2 authorization code via loopback redirect."""

import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        code = query.get("code", [None])[0]
        error = query.get("error", [None])[0]

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()

        if code:
            html = (
                "<html><body><h2>認証成功</h2>"
                "<p>このタブを閉じてAlfredに戻ってください。</p></body></html>"
            )
            self.wfile.write(html.encode("utf-8"))
            print(json.dumps({"code": code}), flush=True)
        else:
            html = (
                "<html><body><h2>認証エラー</h2>"
                f"<p>{error or 'unknown error'}</p></body></html>"
            )
            self.wfile.write(html.encode("utf-8"))
            print(json.dumps({"error": error or "unknown"}), flush=True)

        self.server._should_stop = True

    def log_message(self, format, *args):
        pass  # Suppress request logging


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    server = HTTPServer(("127.0.0.1", port), CallbackHandler)
    actual_port = server.server_address[1]

    # Notify JXA of the assigned port
    print(json.dumps({"port": actual_port}), flush=True)

    server._should_stop = False
    server.timeout = 120  # 2 minute timeout for user to complete auth
    while not server._should_stop:
        server.handle_request()
    server.server_close()


if __name__ == "__main__":
    main()
