#!/usr/bin/env bash
# build-lock.sh — a first-wins BUILD MUTEX for `bun run build`.
#
# WHY: multiple agents (and RESUMED "idle" agents — a SendMessage revives one) can each run `bun run build`
# into the shared public/ output. Concurrent builds clobber each other (a neighbor's `bun run clean` wipes
# your in-progress output → false "bundle MISSING"). Nothing but coordinator-discipline prevented this — so
# this makes the collision STRUCTURALLY impossible: the FIRST build acquires the lock; a SECOND build that
# tries while it's held FAILS FAST with a clear message instead of corrupting the tree.
#
# This is the local-dev form of IDEA-FORGEJO-CICD-BUILD-LOCK-MULTIWRITER (the CI/CD concurrency mutex) — the
# swarm hit the hazard before that gate, so the primitive is built now. Same contract: first-wins, second
# fails clean, no race.
#
# USAGE: `bun run build` (package.json wires build -> this wrapper -> build:unlocked). Override the wait with
#   BUILD_LOCK_WAIT=<seconds> (default 0 = fail-fast/nonblock; set e.g. 300 to QUEUE behind a running build).
set -euo pipefail

# At the repo root, NOT in public/: public/ holds only the output folder + README.md (BUILD-OUTPUT-IS-ONE-FOLDER).
LOCK_FILE="${BUILD_LOCK_FILE:-.build.lock}"
WAIT="${BUILD_LOCK_WAIT:-0}"
mkdir -p "$(dirname "$LOCK_FILE")"

# ── THE COORDINATOR-ONLY GUARD ───────────────────────────────────────────────────────────────
# ★ WHY A GUARD AND NOT A DOCUMENTED RULE (measured 2026-09-23, the third instance of one shape)
#   "Agents never run `bun run build`" is ALREADY a top-level rule in the contributor guidance, and the
#   research doc that established it is three hours old. It was violated anyway — by the
#   coordinator, who put `bun run build` into a dispatch prompt while telling the same agent to
#   read the brief first. The agent obeyed the prompt, the build's clean step wiped public/ mid-
#   probe, and an unrelated bundle read back as "did not mount." That near-diagnosis was a
#   fictional defect in a file that was fine.
#
#   So the failure mode is NOT that the rule is missing, buried, or unclear. It is that an
#   explicit instruction beats a standing rule at the point of work, every time. Documentation
#   cannot fix that; only something that REFUSES the action can. The lock below already makes
#   concurrent builds impossible — but it does not make an UNNECESSARY build impossible, and N
#   queued agents still cost N full rebuilds, each one cleaning the tree out from under every
#   concurrent reader.
#
#   This guard is deliberately a SPEED BUMP, not a wall: it fails with the cheaper alternative
#   printed, and any caller can proceed by setting BUILD_ALLOW=1. That is the point — the person
#   who genuinely needs a full build spends one line saying so, while the agent who inherited
#   `bun run build` from a careless prompt gets told what to run instead.
#
# ★ WHY OPT-IN AND NOT SUBAGENT-DETECTION (a gate that could not fail, caught before shipping)
#   The first version of this guard fired on `CLAUDE_AGENT_ID` / `CLAUDE_SUBAGENT`. MEASURED: both
#   are UNSET in a real subagent — I invented them — so the guard would have passed silently 100%
#   of the time while looking like protection. A probe agent then reported CLAUDE_CODE_CHILD_SESSION
#   as the discriminator; that is ALSO wrong, and instructively so — it is set to 1 in the
#   subagent AND in the coordinator, so it marks "a Claude process", not "a child". The agent could
#   not have known: it only saw its own side. A discriminator is only validated by comparing BOTH
#   environments, which is why this is now opt-in rather than detection. There is no env var here
#   that distinguishes coordinator from subagent; anything claiming to is an untested guess.
if [ "${BUILD_ALLOW:-}" != "1" ]; then
  echo "🚫 FULL BUILD REFUSED — a full build is almost never what you want here, and its FIRST" >&2
  echo "   step deletes public/$(node "$(dirname "$0")/_tree-name.mjs" 2>/dev/null || echo "<tree>")/ entirely, which tears" >&2
  echo "   the tree out from under every other agent reading it (measured 3+ times, incl. a" >&2
  echo "   461-file phantom deletion and several false 'element did not mount' diagnoses)." >&2
  echo "" >&2
  echo "   USE INSTEAD, cheapest first:" >&2
  echo "     bun run tree                  # regenerates manifest.json + leaf pages, NO clean" >&2
  echo "     BUNDLE=<name> bun x vite build  # rebuilds ONE bundle, leaves the others alone" >&2
  echo "     node internal/settled-tree-gate.mjs   # just READ the tree someone else built" >&2
  echo "" >&2
  echo "   If you ARE the coordinator and genuinely want the one authoritative full build," >&2
  echo "   re-run it as:  BUILD_ALLOW=1 bun run build" >&2
  echo "   If you are a SUBAGENT, do not set BUILD_ALLOW — ask the coordinator to build instead." >&2
  exit 75  # EX_TEMPFAIL, same code as a held lock — 'not now', not 'broken'
fi

# fd 9 = the lock handle
exec 9>"$LOCK_FILE"

if [ "$WAIT" = "0" ]; then
  # nonblocking: first-wins, second fails clean
  if ! flock -n 9; then
    echo "🚫 BUILD LOCK HELD — another build is running (holder: $(cat "$LOCK_FILE" 2>/dev/null || echo '?'))." >&2
    echo "   Rebuild refused to avoid a concurrent-build race (would clobber public/). Wait for it to finish" >&2
    echo "   and retry, or run with BUILD_LOCK_WAIT=300 to QUEUE behind it." >&2
    exit 75  # EX_TEMPFAIL — 'try again later', distinct from a real build failure
  fi
else
  echo "⏳ waiting up to ${WAIT}s for the build lock…" >&2
  if ! flock -w "$WAIT" 9; then
    echo "🚫 BUILD LOCK still held after ${WAIT}s — giving up (no race caused)." >&2
    exit 75
  fi
fi

# we hold the lock — stamp who + when, then build
echo "pid=$$ started=$(date -u +%FT%TZ) by=${BUILD_LOCK_OWNER:-$(whoami)}" >&9
echo "🔒 build lock acquired — running the authoritative build." >&2
bun run build:unlocked
status=$?
echo "🔓 build done (exit $status) — releasing lock." >&2
exit $status
