#!/bin/bash
# pb-prod-migrations.sh — the PRODUCTION PocketBase (pb-prod, the public API) takes its schema from the production
# branch, never from the checkout the dev server follows. The dev server's checkout is BRANCH (the table, e.g.
# development); production is PRODUCTION_BRANCH (e.g. main). PocketBase migrations are code with full access to
# the database, so production runs only what was published.
#
# Keeps /data/pb-prod-migrations/<sha>/, a `current` symlink that pb-prod reads, and `previous` for rollback.
#   pb-prod-migrations.sh fetch              at container start (entry.sh): fetch PRODUCTION_BRANCH into
#                                            refs/cdn/<branch>, the ref build-cdn.sh uses, and snapshot its migrations
#   pb-prod-migrations.sh from <dir> <sha>   after a publish (build-cdn.sh): the snapshot that was just published
# Exit: 0 = current now holds different migrations (restart pb-prod to apply them); 3 = unchanged; 1 = failed, and
# the last good `current` is kept. FAIL-CLOSED: with no good snapshot yet, `current` is an EMPTY folder (no app
# schema). It never points at the development checkout.
set -u
ROOT=/data/pb-prod-migrations
REL=backend/pocketbase/pb_migrations
log() { echo "$(date -u +%FT%TZ) [pb-prod schema] $*"; }
mkdir -p "$ROOT/empty"
[ -L "$ROOT/current" ] || ln -sfn "$ROOT/empty" "$ROOT/current"

# install <source dir, may be absent = no migrations on that branch> <sha>
install() {
  local src=$1 sha=$2 new="$ROOT/$2" old
  old=$(readlink "$ROOT/current")
  rm -rf "$new.tmp" && mkdir -p "$new.tmp" || return 1
  if [ -d "$src" ]; then cp -a "$src/." "$new.tmp/" || return 1; fi
  if [ -d "$old" ] && diff -rq "$old" "$new.tmp" >/dev/null 2>&1; then
    rm -rf "$new.tmp"; log "unchanged at $sha ($(ls "$old" | wc -l) files, from $(basename "$old"))"; return 3
  fi
  rm -rf "$new" && mv "$new.tmp" "$new" || return 1
  ln -sfn "$new" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current" || return 1
  [ -d "$old" ] && [ "$old" != "$new" ] && ln -sfn "$old" "$ROOT/previous.tmp" && mv -T "$ROOT/previous.tmp" "$ROOT/previous"
  # keep empty/, current and previous; drop older snapshots
  # (the current/previous symlinks match */ too: skip them, or this deletes the link it just made)
  for d in "$ROOT"/*/; do d=${d%/}
    [ -L "$d" ] && continue
    case "$d" in "$ROOT/empty"|"$(readlink "$ROOT/current")"|"$(readlink "$ROOT/previous" 2>/dev/null)") ;; *) rm -rf "$d" ;; esac
  done
  [ "$(readlink "$ROOT/current")" = "$new" ] && [ -d "$ROOT/current" ] || { log "FAILED: current does not point at $sha"; return 1; }
  log "now $sha: $(ls "$new" | wc -l) migration files (was $(basename "$old"))"; return 0
}

case "${1:-}" in
  fetch)
    PB="${PRODUCTION_BRANCH:-main}"
    cd /app/repo || exit 1
    # Its own ref and no FETCH_HEAD, exactly as build-cdn.sh: the dev server's pull loop uses FETCH_HEAD.
    if ! git fetch -q --no-write-fetch-head --depth 1 origin "+refs/heads/$PB:refs/cdn/$PB"; then
      log "cannot fetch '$PB': keeping $(basename "$(readlink "$ROOT/current")")"; exit 1
    fi
    SHA=$(git rev-parse --short "refs/cdn/$PB")
    T=$(mktemp -d)
    if git ls-tree -d "refs/cdn/$PB" "$REL" | grep -q .; then
      git archive "refs/cdn/$PB" "$REL" | tar -x -C "$T" || { log "snapshot of $PB failed: keeping the last good"; rm -rf "$T"; exit 1; }
    fi
    install "$T/$REL" "$SHA"; rc=$?; rm -rf "$T"; exit $rc ;;
  from)
    [ $# -eq 3 ] || { echo "usage: $0 from <migrations dir> <sha>"; exit 1; }
    install "$2" "$3"; exit $? ;;
  *) echo "usage: $0 fetch | from <migrations dir> <sha>"; exit 1 ;;
esac
