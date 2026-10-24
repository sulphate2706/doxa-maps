#!/usr/bin/env bash
# browser-slot.sh — run ONE browser command inside a memory-floored, N-slot rendezvous.
#
# WHY A SEMAPHORE AND NOT A LOCK. A single lock made every agent's browser proof wait behind one
# chrome: measured 2026-09-25, the queue sat 10-19 deep for hours. The real constraint is MEMORY,
# not exclusivity — a headless chrome costs ~300-500MB — so the right shape is "as many browsers as
# the box can hold", which is a counting semaphore with a memory floor, not a mutex.
#
# HOW: N slot files. Try each with flock -n (no wait). If all are busy, POLL every slot. Before
# taking any slot, require MemAvailable above the floor — a slot that is free while the box is out
# of memory is an invitation to be OOM-killed mid-measurement, which reads as a flaky gate.
#
# ★ EXIT 75 MEANS "NOT MEASURED", NEVER "FAILED". flock returns 1 on timeout, the same code a
# failing gate uses, and that once turned a busy queue into five red product gates. 75 is
# EX_TEMPFAIL: distinct from 0 and from any gate's own verdict, so a caller can report it as the
# precondition it is.
#
# Usage:  internal/browser-slot.sh <command> [args...]
# ONE SLOT (2026-09-25, project rule): on this machine one agent runs browsers and memory is the limit;
# everyone else proves changes headless. The semaphore stays so a second run QUEUES instead of racing.
# Env:    BROWSER_SLOTS (default 1), BROWSER_SLOT_DIR (default /tmp),
#         BROWSER_MEM_FLOOR_MB (default 2500), BROWSER_LOCK_WAIT (default 900),
#         BROWSER_MEM_WAIT (default 300), BROWSER_MAX_HOLD (default 900 s),
#         BROWSER_DISK_FLOOR_MB (default 1500; checked on / and on $TMPDIR or /tmp)
set -u

SLOTS="${BROWSER_SLOTS:-1}"
DIR="${BROWSER_SLOT_DIR:-/tmp}"
# SLOT_BASE, never BASE: a variable the CALLER exported stays exported in bash, so assigning BASE
# here rewrote the caller's BASE for every gate this runs. Seven gates read process.env.BASE, and
# check:upg-map-data-painted measured /tmp/doxa-maps-browser-gate.lock/... and SKIPPED with exit 0.
SLOT_BASE="$DIR/doxa-maps-browser-gate.lock"
FLOOR_MB="${BROWSER_MEM_FLOOR_MB:-2500}"
WAIT_S="${BROWSER_LOCK_WAIT:-900}"
MEM_WAIT_S="${BROWSER_MEM_WAIT:-300}"
BUSY=75
MAX_HOLD="${BROWSER_MAX_HOLD:-900}"
KILL_AFTER="${BROWSER_KILL_AFTER:-15}"
DISK_FLOOR_MB="${BROWSER_DISK_FLOOR_MB:-1500}"

# ★ A GATE THAT IS LEGITIMATELY LONG DECLARES ITS OWN LIMIT, in its header:  @browser-slot-max-hold 2700
# check:host-locale-contract loads every leaf twice and hit the 900 s default three times on full
# runs (NOT MEASURED, not a verdict). An env prefix in its package.json script could not fix that —
# this wrapper reads its limit before the script's own environment exists — so the gate carries the
# number itself and it holds however the gate is invoked (node <file>, or bun run <script>).
# The caller's BROWSER_MAX_HOLD still wins; a declaration is capped at 3600 s so no file can bring
# back the unbounded hold this limit exists to prevent.
if [ -z "${BROWSER_MAX_HOLD:-}" ]; then
  gate_file=""
  for a in "$@"; do case "$a" in *.mjs|*.js) [ -f "$a" ] && gate_file="$a"; break;; esac; done
  if [ -z "$gate_file" ] && [ "${2:-}" = "run" ] && [ -f package.json ]; then
    gate_file=$(node -e 'const s=(require("./package.json").scripts||{})[process.argv[1]]||"";const m=s.match(/\S+\.m?js/);process.stdout.write(m?m[0]:"")' "${3:-}" 2>/dev/null)
  fi
  if [ -n "$gate_file" ] && [ -f "$gate_file" ]; then
    declared=$(head -c 16384 "$gate_file" | grep -oE '@browser-slot-max-hold[[:space:]]+[0-9]+' | head -1 | grep -oE '[0-9]+$')
    if [ -n "$declared" ]; then MAX_HOLD=$declared; [ "$MAX_HOLD" -gt 3600 ] && MAX_HOLD=3600; fi
  fi
fi

# ★ A SLOT IS HELD FOR AT MOST MAX_HOLD SECONDS, whatever the command does. Measured 2026-09-25: a
# probe awaited map.once('load') with no timeout and sat on slot 1 for 89 minutes on 3 s of CPU while
# every other agent's browser gate queued behind it and timed out as NOT MEASURED. A wrapper that
# trusts each command to end is only as good as the worst probe on the box, so the limit lives HERE.
#
# The command runs as a CHILD (not exec'd) under `timeout`, which signals its whole process group —
# the chrome a probe spawned dies with it — and escalates to KILL after KILL_AFTER seconds. fd 9 (the
# slot lock) is CLOSED for the child (9>&-): with exec, the command and every grandchild inherited it,
# so one orphaned chrome could keep the slot locked after its parent was gone. Now only this shell
# holds it, and this shell exits the moment the command is over.
#
# A timeout is NOT a verdict on the product: 124 (TERM) and 137 (KILL) become 75 NOT MEASURED, with
# the command named so its owner can find it. A long gate that legitimately needs more says so:
#   BROWSER_MAX_HOLD=1800 internal/browser-slot.sh node internal/<long-gate>.mjs
run_held() {
  # EXPORTED, so the gate's own children (a `bash -c "…"` wrapper, a node grandchild) inherit it:
  # internal/lib/playwright-guarded.mjs refuses to launch a browser without it.
  export DOXA_BROWSER_SLOT="${DOXA_BROWSER_SLOT:-held}"
  # The gate's output still flows to the caller untouched (stdout and stderr kept apart); a COPY goes to
  # RAM (/dev/shm, never the disk that may be full) so a failure can be classified afterwards.
  local log="" rc
  if [ -d /dev/shm ] && [ -w /dev/shm ]; then log=$(mktemp /dev/shm/browser-slot.XXXXXX 2>/dev/null) || log=""; fi
  if [ -n "$log" ]; then
    { timeout --kill-after="$KILL_AFTER" "$MAX_HOLD" "$@" 9>&- 2> >(tee -a "$log" >&2); } | tee -a "$log"
    rc=${PIPESTATUS[0]}
    sleep 0.2   # let the stderr tee finish writing its copy
  else
    timeout --kill-after="$KILL_AFTER" "$MAX_HOLD" "$@" 9>&-
    rc=$?
  fi
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "browser-slot: '$*' held a browser slot past BROWSER_MAX_HOLD=${MAX_HOLD}s and was killed (timeout rc $rc) — NOT MEASURED. Give it a timeout of its own, or set BROWSER_MAX_HOLD if it is legitimately that long." >&2
    rm -f "$log"; exit "$BUSY"
  fi
  # ★ AN INFRASTRUCTURE FAILURE IS NOT A PRODUCT VERDICT (measured 2026-09-25: with the disk at 48 MB free,
  # three browser gates went RED with Chromium "Page crashed" — an out-of-disk box wearing a product
  # gate's exit code). ENOSPC is always infrastructure. A browser crash is classified as such ONLY when
  # the box is below a floor at that moment: a renderer crash on a healthy box can be a real product
  # bug (a leak, a runaway loop), and blanket-excusing it would hide exactly that.
  if [ "$rc" -ne 0 ] && [ "$rc" -ne "$BUSY" ] && [ -n "$log" ]; then
    local infra=""
    if grep -qiE 'ENOSPC|No space left on device' "$log"; then
      infra="the disk is full (ENOSPC)"
    elif grep -qE 'Page crashed|Target (page, context or browser )?has been closed|Target closed|Browser (has been )?closed|browser has disconnected' "$log"; then
      local d m; d=$(disk_available_mb); m=$(mem_available_mb)
      if [ "$d" -lt "$DISK_FLOOR_MB" ] || [ "$m" -lt "$FLOOR_MB" ]; then
        infra="the browser crashed while the box was below a floor (disk ${d}MB / floor ${DISK_FLOOR_MB}MB, memory ${m}MB / floor ${FLOOR_MB}MB)"
      fi
    fi
    if [ -n "$infra" ]; then
      echo "browser-slot: '$*' failed from INFRASTRUCTURE, not the product — ${infra}. NOT MEASURED (the command exited $rc)." >&2
      rm -f "$log"; exit "$BUSY"
    fi
  fi
  rm -f "$log"
  exit "$rc"
}

slot_path() { [ "$1" = "1" ] && echo "$SLOT_BASE" || echo "$SLOT_BASE$1"; }

# Free disk, the lower of / and the temp dir (they may be different filesystems). BROWSER_FAKE_DISK_FILE is
# a TEST HOOK: when set, the reading comes from that file, so a test can "fill the disk" mid-run.
disk_available_mb() {
  if [ -n "${BROWSER_FAKE_DISK_FILE:-}" ] && [ -f "$BROWSER_FAKE_DISK_FILE" ]; then cat "$BROWSER_FAKE_DISK_FILE"; return; fi
  local a b; a=$(df --output=avail -m / 2>/dev/null | tail -1 | tr -d ' '); b=$(df --output=avail -m "${TMPDIR:-/tmp}" 2>/dev/null | tail -1 | tr -d ' ')
  a=${a:-999999}; b=${b:-999999}; [ "$a" -lt "$b" ] && echo "$a" || echo "$b"
}

mem_available_mb() {
  awk '/^MemAvailable:/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || echo 999999
}

# ★ REFUSE ON A FULL DISK, before taking a slot: Chromium needs disk for its profile and cache, and a
# measurement started with none ends as a "Page crashed" that reads like a product failure.
if [ "$(disk_available_mb)" -lt "$DISK_FLOOR_MB" ]; then
  echo "browser-slot: only $(disk_available_mb)MB free on disk (floor ${DISK_FLOOR_MB}MB) — not measuring" >&2
  exit "$BUSY"
fi

# Hold off while the box is below the floor. Proceeding anyway is not an option here the way it is
# for a load average: load makes a measurement slow, memory makes it get killed halfway through.
waited=0
while [ "$(mem_available_mb)" -lt "$FLOOR_MB" ]; do
  if [ "$waited" -ge "$MEM_WAIT_S" ]; then
    echo "browser-slot: MemAvailable $(mem_available_mb)MB below floor ${FLOOR_MB}MB after ${waited}s — not measuring" >&2
    exit "$BUSY"
  fi
  sleep 10
  waited=$((waited + 10))
done

# Fast path: any free slot, in a FIXED order so two processes can never take them in opposite
# orders. -n means "do not wait": if this slot is busy we move on rather than queue behind it.
#
# ★ `{ exec 9>…; } 2>/dev/null`, NEVER `exec 9>… 2>/dev/null`. A bare exec applies EVERY redirection
# on its line to this shell for good, so the old form sent stderr to /dev/null for the rest of the
# script AND for the gate exec'd below. Measured 2026-09-25: every gate run through this wrapper lost
# its stderr — verify-map-paint exited 1 on two leaves with its FAIL lines (console.error) gone, and
# this script's own "not measuring" message vanished too. The braces scope the 2>/dev/null to the
# open alone; fd 9 still persists, which is the only thing the exec is for.
i=1
while [ "$i" -le "$SLOTS" ]; do
  { exec 9>"$(slot_path "$i")"; } 2>/dev/null || true
  if flock -n 9; then
    run_held "$@"
  fi
  i=$((i + 1))
done

# Everything busy: keep POLLING EVERY SLOT until the deadline, and report a timeout as UNMEASURED
# rather than as a verdict. This used to queue on slot 1 alone (flock -w on slot 1), so a slot that
# freed up was never taken: measured 2026-09-25, ten waiters were piled on slot 1 while
# slot 2 sat free, and with slot 1 held 12 s and slot 2 freed at ~3 s a caller waited 11.5 s — the
# two-slot semaphore had collapsed into ONE queue. Polling takes the first slot that frees (~4 s in
# the same test). Trade-off, accepted: polling is not first-come-first-served, so under heavy
# contention a waiter can lose a few rounds; an idle slot beside a queue is strictly worse.
deadline=$(( $(date +%s) + WAIT_S ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  i=1
  while [ "$i" -le "$SLOTS" ]; do
    { exec 9>"$(slot_path "$i")"; } 2>/dev/null || true
    if flock -n 9; then run_held "$@"; fi
    i=$((i + 1))
  done
  sleep 2
done
echo "browser-slot: no slot within ${WAIT_S}s (${SLOTS} slots, floor ${FLOOR_MB}MB) — not measuring" >&2
exit "$BUSY"
