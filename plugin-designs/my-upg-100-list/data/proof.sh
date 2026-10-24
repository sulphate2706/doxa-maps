#!/usr/bin/env bash
# proof.sh — full runnable proof (one command) · updated 09b-6 §1(d) L13
#
#   bash plugin-designs/my-upg-100-list/data/proof.sh
#
# Proves, can-fail:
#   1. rop1 / full re-cache present (or re-fetch)        §1h / 04u §1a
#   2. evaluator test green (incl. A017=123, 0-delta)    §1g
#   3. tapestry-proof: 33 zones >=1 poly, 33 fills       §1b/d/f + 09b-6 wire
#      - the 13 tiny-territory ADM0 gap is a NON-GATING advisory ("KNOWN GAP")
#   4. the 09b-1..5 partition / isolation / coverage proofs
#   5. BUNDLE=my-upg-100-list build emits the IIFE       §1f(5)
#   6. siblings byte-identical (md5 before+after)        §1f(6)
#
# L13 honesty (09b-6): each node proof is gated on its TRUE exit code (captured
# directly, never masked by a `| tail` pipeline). We still print a readable tail
# for the long proofs, but the PASS/FAIL gate reads the real exit status — so the
# RESULT line is green ONLY when every proof genuinely passed.
set -uo pipefail
cd "$(dirname "$0")/../../.."            # -> repo root
PROFILE=plugin-designs/my-upg-100-list
fail=0

# run_proof "<label>" <tail-lines> <node-script> [args...]
# Runs the proof, captures its FULL output + REAL exit code (no pipe masking),
# prints the last <tail-lines> for readability, and gates `fail` on the true exit.
run_proof() {
  local label="$1"; shift
  local tail_n="$1"; shift
  echo; echo "## ${label}"
  local out rc
  out="$(node "$@" 2>&1)"; rc=$?
  if [ "$tail_n" -gt 0 ]; then
    echo "$out" | tail -n "$tail_n"
  else
    echo "$out"
  fi
  if [ "$rc" -ne 0 ]; then
    echo "FAIL  (${label}) exited non-zero: rc=${rc}"
    fail=1
  fi
  return 0
}

echo "================ FULL PROOF (09b-6) ================"

run_proof "§1h re-cache rop1"                                   0 "$PROFILE/data/recache-rop1.mjs"
run_proof "04u §1a re-cache FULL (rop1 + population)"           0 "$PROFILE/data/recache-full.mjs"
run_proof "§1g evaluator test"                                  6 "$PROFILE/data/evaluator.test.mjs"
run_proof "§1b/d/f tapestry proof (33 zones; KNOWN-GAP advisory)" 18 "$PROFILE/data/tapestry-proof.mjs"
run_proof "04u §1d population proof (pop>0, spot-checks, roll-up)" 22 "$PROFILE/data/pop-proof.mjs"
run_proof "Fix2 §1e pin proof (no throw on Asia pg_slugs, ~2106 pins)" 22 "$PROFILE/data/pin-proof.mjs"
run_proof "09b-1 §1d PIP admin-stamp"                           0 "$PROFILE/data/pip-stamp.mjs"
run_proof "09b-1 §1d PIP proof (>=99% stamped, GROUP BY conserved)" 28 "$PROFILE/data/pip-proof.mjs"
run_proof "09b-2 §1d adjacency + contiguity proof"             32 "$PROFILE/data/adjacency-proof.mjs"
run_proof "09b-3 §1d India contiguous partition proof"          0 "$PROFILE/data/india-partition-proof.mjs"
run_proof "09b-3 §1c clusters.json India-only isolation proof"  0 "$PROFILE/data/india-isolation-proof.mjs"
run_proof "09b-4 §1d China contiguous partition proof"          0 "$PROFILE/data/china-partition-proof.mjs"
run_proof "09b-4 §1c clusters.json China-only isolation proof"  0 "$PROFILE/data/china-isolation-proof.mjs"
run_proof "09b-5 §1d uncovered-zone 100%-coverage proof"        0 "$PROFILE/data/uncovered-proof.mjs"
run_proof "09b-7 §1b zone-resolves (L17: every geo zone >=1 poly; catches stale ADM1 tags)" 14 "$PROFILE/data/zone-resolves-proof.mjs"
run_proof "toolC §1d color isolation (recolor → shared registry + siblings byte-identical)" 0 "$PROFILE/data/color-isolation-proof.mjs"
run_proof "toolB §1e apply-grouping (no-op round-trip byte-identical + 1-state move/count/contiguity + revert)" 30 "$PROFILE/data/apply-grouping-proof.mjs"
run_proof "09b-oceania §1(4) single-color + deaf-overlay-under-land draw order (can-fail)" 14 "$PROFILE/data/oceania-color-proof.mjs"
run_proof "09b-9 §1d region-hue (non-Asia zones inherit parent WAGF hue ±8°, pairwise-distinct, deaf exempt)" 18 "$PROFILE/data/region-hue-proof.mjs"

echo; echo "## §1f(6) sibling baseline (before build)"
SIB_BEFORE=$(md5sum app/doxa-simple-map.js app/doxa-research-map.js app/geo-steward.js)
echo "$SIB_BEFORE"

echo; echo "## §1f(5) build IIFE"
if BUNDLE=my-upg-100-list npx vite build 2>&1 | grep -E "my-upg-100-list.js|built in"; then
  :
else
  echo "FAIL  vite build did not report the my-upg-100-list bundle"; fail=1
fi
BYTES=$(wc -c < app/my-upg-100-list.js)
echo "emitted app/my-upg-100-list.js = ${BYTES} bytes"

echo; echo "## §1f(6) sibling isolation (after build)"
SIB_AFTER=$(md5sum app/doxa-simple-map.js app/doxa-research-map.js app/geo-steward.js)
echo "$SIB_AFTER"
if [ "$SIB_BEFORE" = "$SIB_AFTER" ]; then
  echo "PASS  siblings byte-identical before/after build"
else
  echo "FAIL  a sibling bundle changed during my build"; fail=1
fi

echo; echo "================ RESULT: $([ $fail -eq 0 ] && echo ALL-PASS || echo FAILED) ================"
exit $fail
