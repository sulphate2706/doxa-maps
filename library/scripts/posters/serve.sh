#!/usr/bin/env bash
# serve.sh — serve the UPG100 poster gallery over HTTP so the browser can
# fetch the PNGs + iframe the poster HTMLs (file:// blocks both).
#
#   ./serve.sh              # serve out/ on :8090
#   PORT=9000 ./serve.sh    # custom port
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8090}"
cd "$HERE/out"
echo "==> UPG100 poster gallery:  http://localhost:${PORT}/index.html"
echo "    (Ctrl-C to stop)"
exec python3 -m http.server "$PORT"
