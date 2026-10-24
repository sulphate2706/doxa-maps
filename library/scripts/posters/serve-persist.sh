#!/usr/bin/env bash
# serve-persist.sh — keep the UPG100 poster gallery (out/) up on :8097 across
# process death, WITHOUT systemd. Two modes:
#
#   ./serve-persist.sh            # foreground respawn loop (re-launches the
#                                 # http.server if it ever exits; Ctrl-C stops)
#   ./serve-persist.sh --detach   # detach via setsid+nohup so it survives the
#                                 # spawning shell exiting, then return
#
# Preferred persistence is the systemd --user unit (upg100-gallery.service);
# this wrapper is the zero-dependency fallback for hosts without systemd --user.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8097}"
SERVE_DIR="$HERE/out"
LOG="${LOG:-$HERE/out/_serve.log}"

run_loop() {
  cd "$SERVE_DIR"
  while true; do
    echo "==> $(date -Is) UPG100 gallery up: http://localhost:${PORT}/index.html"
    python3 -m http.server "$PORT" --bind 127.0.0.1
    echo "==> $(date -Is) http.server exited ($?). Respawning in 2s..." >&2
    sleep 2
  done
}

if [[ "${1:-}" == "--detach" ]]; then
  # already detached child? run the loop
  if [[ "${_UPG100_SERVE_CHILD:-}" == "1" ]]; then run_loop; exit 0; fi
  _UPG100_SERVE_CHILD=1 setsid nohup "$0" --detach >>"$LOG" 2>&1 &
  disown || true
  echo "detached respawn loop (pid $!) → :$PORT, log: $LOG"
  exit 0
fi

run_loop
