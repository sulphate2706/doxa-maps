// tapestry-proof.mjs — slice 04t §1(f) runnable, can-fail empirical proof
//
//   node data/tapestry-proof.mjs
//
// Asserts (data layer — the gem-frame eyeball is the final REQ-5 call):
//   (1) all 26 leaf zones resolve ≥1 polygon via zone-geometry.js
//   (2) the tapestry has 26 distinct zoneKey fills
//   (3) the deaf A017 selector resolves exactly 123 PGs + zero-delta vs old set
//   (4) ADM0 coverage report (which member countries are missing, honest)
//
// Data source = the rop1-bearing cache (so the deaf row can resolve). The build
// emit + sibling-isolation checks live in the bash wrapper (proof.sh).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { evaluate } from './selector-evaluator.js';
import { loadRecords } from './normalize.js';
import { acquireRop1Payload } from './recache-rop1.mjs';
import { buildLegendNodes, leafZones } from './legend-tree.js';
import { resolveZoneGeometry, resolveAllZones, memberCountryCodes } from './zone-geometry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ── L13 (09b-6 §1d): known-gap ADM0 allowlist ────────────────────────────────
// 13 tiny territories absent from gbOpen ADM0 (sub-pixel islands / micro-states /
// disputed scraps). They are a DOCUMENTED, non-gating advisory: every zone that
// "contains" one of these still resolves via its OTHER member countries, so no
// zone goes empty because of them. We log them as "KNOWN GAP: 13 territories" and
// EXCLUDE them from the missing-ADM0 failure tally — but we do NOT allowlist a
// whole EMPTY zone (a zone resolving 0 polygons is still a hard FAIL; only-known-
// gaps must never paper over a genuinely unresolved zone).
const KNOWN_ADM0_GAP = new Set([
  'CCK', 'CXR', 'ESH', 'GIB', 'HKG', 'MAC', 'MCO',
  'NFK', 'JEY', 'KOS', 'SJM', 'SXM', 'TKL',
]);

function loadDeps() {
  const adm0Path = join(__dirname, 'adm0', 'world-adm0.geojson');
  return {
    clusters: readJSON(join(__dirname, 'clusters.json')),
    adm0: existsSync(adm0Path) ? readJSON(adm0Path) : { type: 'FeatureCollection', features: [] },
    adm1Ind: readJSON(join(__dirname, 'gb-IND-ADM1.geojson')),
    adm1Chn: readJSON(join(__dirname, 'gb-CHN-ADM1.geojson')),
  };
}

async function main() {
  let fails = 0;
  const log = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

  const { payload, skip } = await acquireRop1Payload();
  if (skip) {
    console.log(`SKIP — ${skip}\n(run: node data/recache-rop1.mjs --force)`);
    process.exit(2);
  }
  const records = loadRecords(payload);
  const { clusters, adm0, adm1Ind, adm1Chn } = loadDeps();
  const deps = { records, adm0, adm1Ind, adm1Chn };

  // Build the 26-leaf nested legend, attach each leaf's selector from clusters.
  const nodes = buildLegendNodes(clusters, { deafCount: 123 });
  const zones = leafZones(nodes);

  // attach selectors: regional/asia/uncovered from clusters by id; deaf = affinity_bloc/A017
  const byId = {};
  for (const l of clusters.lists || []) byId[l.id] = l.selector;
  for (const a of clusters.asia_lists || []) byId[a.id] = a.selector;
  // slice 09b-6 §1a: the 7 Frontier-Asia uncovered zones (country_codes → ADM0).
  for (const u of clusters.uncovered_lists || []) byId[u.id] = u.selector;
  byId['deaf'] = { type: 'affinity_bloc', rop1: 'A017' };
  for (const z of zones) z.selector = byId[z.id];

  // 09b-6: 26 prior leaves + 7 wired uncovered = 33.
  // 09b-asia-contiguity-v2: the 6 retained "Frontier Asia (uncovered)" stubs were
  // DISSOLVED — nepal→IN-A, himalaya→IN-D, mongolia+japan→NAS-B (extraCountryCodes
  // on the asia ADM1 cores), sa-west+central-asia MERGED into uncovered-nas-a. Net
  // −5 leaf rows (6 removed, 1 added). So 33 − 5 = 28 leaves:
  // 13 regional + 1 deaf + 12 asia + 2 uncovered (nas-a + scatter).
  const EXPECT_LEAVES = 28;
  console.log(`[proof] legend leaves = ${zones.length} (expect ${EXPECT_LEAVES})`);
  log(zones.length === EXPECT_LEAVES, `legend has ${EXPECT_LEAVES} leaf rows (got ${zones.length})`);

  // deaf-polygon removal (design fix, an earlier fix): the `deaf` zone no longer
  // contributes any polygons to the tapestry (region-fill) layer — its ADM0 double-stamp
  // was the source of the blue underlap + until-click coloring bug. So the region layer
  // now carries EXPECT_LEAVES − 1 geographic/asia zones. deaf is still in the LEGEND
  // (gate (3) below still proves its A017 selector resolves 123 PGs) and in the PINS.
  // HISTORY: gates (1)/(2) previously asserted "all 28 zones resolve ≥1 polygon" and
  // "28 distinct tapestry fills" — that included deaf's region fill. Now deaf is
  // intentionally absent from the fill, so the region-layer expectation is 27.
  const EXPECT_FILL_LEAVES = EXPECT_LEAVES - 1; // deaf removed from region fill

  // ── (1) every NON-DEAF zone resolves ≥1 polygon; deaf resolves 0 (by design) ─
  console.log('\n--- (1) per-zone polygon resolution ---');
  const { tapestry, perZone } = resolveAllZones(zones, deps);
  let zeroZones = 0;
  for (const z of zones) {
    const n = perZone.get(z.zoneKey);
    const kind = z.id.startsWith('asia-') ? 'ADM1' : 'ADM0';
    if (z.id === 'deaf') {
      const ok = n === 0;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${z.id.padEnd(46)} ${String(n).padStart(3)} ${kind} polys (deaf: expect 0 — region fill removed)`);
      if (!ok) fails++;
      continue;
    }
    const ok = n >= 1;
    if (!ok) zeroZones++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${z.id.padEnd(46)} ${String(n).padStart(3)} ${kind} polys`);
    if (!ok) fails++;
  }
  log(zeroZones === 0, `all ${EXPECT_FILL_LEAVES} non-deaf zones resolve ≥1 polygon (${zeroZones} empty)`);

  // ── (2) distinct zoneKey fills in the tapestry (deaf excluded) ──────────────
  console.log('\n--- (2) distinct tapestry fills ---');
  const distinct = new Set(tapestry.features.map((f) => f.properties.zoneKey));
  console.log(`[proof] tapestry features=${tapestry.features.length}  distinct zoneKeys=${distinct.size}`);
  log(!distinct.has('deaf'), `deaf zoneKey absent from tapestry region fill (overlap/coloring fix)`);
  log(distinct.size === EXPECT_FILL_LEAVES, `${EXPECT_FILL_LEAVES} distinct zoneKey fills present (got ${distinct.size})`);
  // colors must be distinct too (one per zone); deaf's #18ffff must NOT appear.
  const colors = new Set(tapestry.features.map((f) => f.properties.zoneColor));
  log(!colors.has('#18ffff'), `deaf overlay color #18ffff absent from region fill`);
  log(colors.size === EXPECT_FILL_LEAVES, `${EXPECT_FILL_LEAVES} distinct fill colors (got ${colors.size})`);

  // ── (3) deaf A017 = 123 + zero-delta ───────────────────────────────────────
  console.log('\n--- (3) deaf affinity_bloc A017 ---');
  const a017 = evaluate({ type: 'affinity_bloc', rop1: 'A017' }, records);
  log(a017.size === 123, `affinity_bloc/A017 = 123 PGs (got ${a017.size})`);
  const oldDeaf = new Set();
  for (const dl of clusters.deaf_lists || []) for (const s of evaluate(dl.selector, records)) oldDeaf.add(s);
  const delta = [...a017].filter((s) => !oldDeaf.has(s)).length + [...oldDeaf].filter((s) => !a017.has(s)).length;
  log(delta === 0, `zero-delta vs old deaf_predicate set (delta=${delta})`);

  // ── (4) ADM0 coverage honesty report (L13 known-gap advisory) ──────────────
  console.log('\n--- (4) ADM0 coverage report (honest; L13 known-gap split) ---');
  const adm0Iso = new Set((adm0.features || []).map((f) => f.properties.iso3));
  let totalMissing = new Set();   // ALL missing member ADM0
  for (const z of zones) {
    if (z.id.startsWith('asia-')) continue;
    const need = memberCountryCodes(z, records);
    const miss = [...need].filter((c) => !adm0Iso.has(c));
    if (miss.length) {
      console.log(`  ${z.id}: ${need.size - miss.length}/${need.size} ADM0 present; missing ${JSON.stringify(miss)}`);
      miss.forEach((c) => totalMissing.add(c));
    }
  }
  // Split the missing set into KNOWN-GAP (advisory, non-gating) vs UNEXPECTED (gates).
  const unexpectedMissing = [...totalMissing].filter((c) => !KNOWN_ADM0_GAP.has(c)).sort();
  const knownMissing = [...totalMissing].filter((c) => KNOWN_ADM0_GAP.has(c)).sort();
  console.log(`[proof] ADM0 features on disk = ${adm0Iso.size}; member countries missing across all zones = ${totalMissing.size}`);
  console.log(`KNOWN GAP: ${knownMissing.length} territories ${JSON.stringify(knownMissing)}  (sub-pixel/micro-territory; advisory, non-gating — every zone still resolves via its OTHER member countries)`);
  // Non-gating: known gaps PASS (advisory). Only an UNEXPECTED missing ADM0 fails.
  log(unexpectedMissing.length === 0,
    `no UNEXPECTED missing ADM0 outside the known-gap allowlist (got ${unexpectedMissing.length}: ${JSON.stringify(unexpectedMissing)})`);

  console.log('\n========================================================');
  console.log(`PROOF SUMMARY: ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  console.log('========================================================');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('PROOF ERROR', e); process.exit(1); });
