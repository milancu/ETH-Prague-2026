#!/usr/bin/env python3
"""Local static dev server for index.html. Stdlib only.

Usage:
  python serve.py            # http://localhost:5175
  python serve.py 8080       # custom port
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5175
ROOT = Path(__file__).parent

handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
with ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"Cosmic Dice → http://localhost:{PORT}")
    print("Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass