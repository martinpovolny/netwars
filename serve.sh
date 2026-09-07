#!/bin/sh
# Serve the NETWARS client on http://localhost:8777/
# (plain static files; the client pulls Three.js from a CDN)
PORT="${1:-8777}"
echo "NETWARS -> http://localhost:$PORT/"
exec python3 -m http.server "$PORT"
