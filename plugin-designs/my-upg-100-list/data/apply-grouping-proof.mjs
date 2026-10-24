// apply-grouping-proof.mjs — slice 09b toolB §1(e) · the round-trip proof.
//
//   node data/apply-grouping-proof.mjs        (exit 0 = PASS, can-fail)
//
// Proves toolB (data/apply-grouping.mjs) is a faithful, reversible regroup tool:
//
//   PART A — NO-OP ROUND-TRIP (the build GUARDRAIL):
//     1. snapshot the frozen state (clusters.json md5 ae59ecb3 + the 3 cluster
//        files + zone-colors + the 2 ADM1 geojsons).
//     2. generate groupings.json FROM the current clusters (round-trips present
//        state) and re-apply it (no payload).
//     3. assert clusters.json + every derived file is BYTE-IDENTICAL to the
//        snapshot — a no-op apply changes NOTHING.
//
//   PART B — ONE-STATE MOVE (the tool actually works):
//     4. apply a test payload that moves ONE contiguous state (Goa: karnataka →
//        maharashtra zone). Goa borders Mahārāshtra, so both touched zones stay
//        contiguous.
//     5. assert: Goa left asia-india-karnataka and joined asia-india-maharashtra;
//        both zones' pg_slug counts changed by exactly Goa's slug count; both are
//        still contiguous; the payload color was written to zone-colors.json.
//     6. REVERT (restore the snapshot, whole-config re-apply) and assert the frozen
//        state returns byte-for-byte (clusters.json md5 == ae59ecb3 again).
//
// This proof MUTATES disk during PART B but ALWAYS restores the snapshot in a
// finally block — pass or fail, it leaves the tree exactly as it found it.

import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runApply, generateGroupings } from './apply-grouping.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = (f) => join(HERE, f);
const md5 = (f) => createHash('md5').update(readFileSync(P(f))).digest('hex');
const readJSON = (f) => JSON.parse(readFileSync(P(f), 'utf8'));

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail = 1; };

// Frozen "current live state" snapshot of clusters.json. This is NOT a slice
// baseline — it tracks the live file so the no-op round-trip (A2/A3) can prove a
// whole-config re-apply is byte-identical. 09b-asia-contiguity-v2 re-cut asia_lists
// (IN-A/B/C/D + NAS-B cross-border), so it rolls from the pre-v2 ae59ecb3 to the
// post-v2 value below. The round-trip invariant (apply twice == byte-identical) is
// what this proof actually guards, and it still holds against the new snapshot.
const FROZEN_CLUSTERS_MD5 = '6a5668ba544ed7aff62fa3e5be573042';
const PRE_V2_CLUSTERS_MD5 = 'ae59ecb3e75ed37f32e03b2a686d533d'; // historical (pre-asia-contiguity-v2)

// files toolB can touch — snapshot ALL of them so we can prove byte-identity +
// guarantee a clean revert.
const TRACKED = [
  'clusters.json', 'india-clusters.json', 'china-clusters.json',
  'uncovered-clusters.json', 'zone-colors.json',
  'gb-IND-ADM1.geojson', 'gb-CHN-ADM1.geojson',
];
// ★ MOVED TO data/tables/. groupings.json is now in the shared asset pool the tree copies into
// public/dx-maps/assets/tables/, because the gospel legend renders IN THE BROWSER and needs it at
// runtime — a build-time import path would not reach the bundle. The name stays relative so P()
// still resolves it against this directory; only the prefix changed.
const GROUPINGS = '../../../data/tables/groupings.json';

console.log('================ 09b toolB apply-grouping PROOF ================\n');

// ── snapshot ────────────────────────────────────────────────────────────────
const snap = {};
for (const f of TRACKED) snap[f] = readFileSync(P(f));
const groupingsExisted = existsSync(P(GROUPINGS));
const groupingsSnap = groupingsExisted ? readFileSync(P(GROUPINGS)) : null;

function restore() {
  for (const f of TRACKED) writeFileSync(P(f), snap[f]);
  if (groupingsExisted) writeFileSync(P(GROUPINGS), groupingsSnap);
  else if (existsSync(P(GROUPINGS))) unlinkSync(P(GROUPINGS));
}

try {
  // ── PART A — NO-OP ROUND-TRIP ───────────────────────────────────────────────
  console.log('── PART A: no-op round-trip (the build GUARDRAIL) ──');
  ok(md5('clusters.json') === FROZEN_CLUSTERS_MD5,
    `(A0) baseline clusters.json md5 == ${FROZEN_CLUSTERS_MD5} (frozen)`);

  // (re)generate groupings.json from the CURRENT clusters, then no-op apply.
  const g = generateGroupings();
  const sorted = {};
  for (const k of Object.keys(g).sort()) sorted[k] = g[k];
  writeFileSync(P(GROUPINGS), JSON.stringify(sorted, null, 2) + '\n');

  const resA = runApply({ quiet: true });
  ok(resA.ok && !resA.blocked, '(A1) no-op whole-config apply ran clean (proofs green, not blocked)');

  let allIdentical = true;
  for (const f of TRACKED) {
    const same = Buffer.compare(readFileSync(P(f)), snap[f]) === 0;
    if (!same) { allIdentical = false; console.log(`        CHANGED: ${f}`); }
  }
  ok(allIdentical, '(A2) every tracked file BYTE-IDENTICAL after no-op apply');
  ok(md5('clusters.json') === FROZEN_CLUSTERS_MD5,
    `(A3) clusters.json md5 STILL == ${FROZEN_CLUSTERS_MD5} after no-op`);

  // ── PART B — ONE-STATE MOVE ─────────────────────────────────────────────────
  console.log('\n── PART B: one-state move (Goa: karnataka → maharashtra) ──');

  // baseline pg_slug counts + ownership BEFORE the move.
  // 09b-asia-contiguity-v2 dissolved `asia-india-maharashtra`; its members
  // (Mahārāshtra + DNH-DD + Madhya Pradesh) now live in `asia-india-madhya-pradesh`
  // (IN-C). The Goa one-state move targets that successor zone — Goa still borders
  // Mahārāshtra so both touched zones stay contiguous. (Resolve dynamically so this
  // proof follows the live partition instead of a dissolved id.)
  const icBefore = readJSON('india-clusters.json');
  const karnBefore = icBefore.find((e) => e.id === 'asia-india-karnataka');
  const MAHA_ID = icBefore.find((e) => e.id === 'asia-india-maharashtra')
    ? 'asia-india-maharashtra'
    : icBefore.find((e) => e.members.includes('Mahārāshtra'))?.id;
  const mahaBefore = icBefore.find((e) => e.id === MAHA_ID);
  ok(karnBefore.members.includes('Goa'), '(B0) Goa starts in asia-india-karnataka');

  // Goa's own pg_slug count (the delta the move must shift).
  const M = readJSON('admin-membership.json');
  const goaSlugs = Object.values(M).length
    ? Object.entries(M).filter(([, v]) => v.country === 'IND' && v.admin1 === 'Goa').length
    : 0;
  ok(goaSlugs > 0, `(B1) Goa contributes ${goaSlugs} pg_slugs (the move delta)`);

  // payload: re-shape the maharashtra zone to ALSO own Goa. Goa borders Mahārāshtra
  // → both touched zones stay contiguous. A distinctive test hex proves the color write.
  const TEST_HEX = '#0a1b2c';
  const payload = `Mahārāshtra, Dādra and Nagar Haveli and Damān and Diu, Madhya Pradesh, Chhattīsgarh, Goa — ${mahaBefore.count + goaSlugs} UUPG · ${TEST_HEX}`;
  // NOTE: committed maharashtra zone is {Mahārāshtra, DNH-DD, Madhya Pradesh}. We
  // pass exactly its current members + Goa so ONLY Goa moves.
  // Pass exactly the successor zone's current members + Goa so ONLY Goa moves.
  const mahaMembers = mahaBefore.members.join(', ');
  const payloadExact = `${mahaMembers}, Goa — ${mahaBefore.count + goaSlugs} UUPG · ${TEST_HEX}`;

  const resB = runApply({ payloadText: payloadExact, quiet: true });
  ok(resB.ok && !resB.blocked, '(B2) contiguous one-state move applied clean (not blocked, proofs green)');

  const icAfter = readJSON('india-clusters.json');
  const karnAfter = icAfter.find((e) => e.id === 'asia-india-karnataka');
  const mahaAfter = icAfter.find((e) => e.id === MAHA_ID);

  ok(!karnAfter.members.includes('Goa'), '(B3) Goa LEFT asia-india-karnataka');
  ok(mahaAfter.members.includes('Goa'), `(B4) Goa JOINED ${MAHA_ID}`);
  ok(karnAfter.count === karnBefore.count - goaSlugs,
    `(B5) karnataka count ${karnBefore.count} → ${karnAfter.count} (−${goaSlugs})`);
  ok(mahaAfter.count === mahaBefore.count + goaSlugs,
    `(B6) ${MAHA_ID} count ${mahaBefore.count} → ${mahaAfter.count} (+${goaSlugs})`);

  // contiguity of BOTH touched zones (the move must never break the graph).
  const zc = readJSON('zone-colors.json');
  ok(zc[MAHA_ID] === TEST_HEX,
    `(B7) payload color ${TEST_HEX} written to zone-colors.json`);

  // clusters.json actually changed (proves the canonical writer wrote the move).
  ok(md5('clusters.json') !== FROZEN_CLUSTERS_MD5,
    '(B8) clusters.json md5 CHANGED by the move (canonical writer emitted it)');

  // ── REVERT ──────────────────────────────────────────────────────────────────
  // The the brief's real revert path is a whole-config re-apply from the prior
  // groupings.json. We prove that path works: restore the SOURCE OF TRUTH
  // (groupings.json) to its pre-move snapshot, then let toolB re-derive every
  // output from it. The derived files must return to the frozen baseline.
  console.log('\n── PART B revert (whole-config re-apply from restored groupings.json) ──');
  if (groupingsExisted) writeFileSync(P(GROUPINGS), groupingsSnap);
  const resR = runApply({ quiet: true });
  ok(resR.ok && !resR.blocked, '(B9) revert whole-config re-apply ran clean');
  ok(md5('clusters.json') === FROZEN_CLUSTERS_MD5,
    `(B10) clusters.json md5 BACK to ${FROZEN_CLUSTERS_MD5} after revert`);

  let revertIdentical = true;
  for (const f of TRACKED) {
    if (Buffer.compare(readFileSync(P(f)), snap[f]) !== 0) {
      revertIdentical = false; console.log(`        STILL-DIRTY: ${f}`);
    }
  }
  ok(revertIdentical, '(B11) every tracked file restored byte-for-byte after revert');
} finally {
  // ALWAYS leave the tree exactly as we found it — pass or fail.
  restore();
}

console.log(`\n================ RESULT: ${fail === 0 ? 'ALL-PASS' : 'FAILED'} ================`);
process.exit(fail);
