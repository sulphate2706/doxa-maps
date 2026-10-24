// zone-resolves-proof.mjs — slice 09b-7 §1(b) the assertion 09b-3/09b-4 MISSED (L17)
//
//   node plugin-designs/my-upg-100-list/data/zone-resolves-proof.mjs
//
// L17: 09b-3/09b-4 rewrote the cluster SELECTORS but never re-tagged the ADM1
// geojson `listId`, so 4 zones (odisha, assam, yunnan, tibet) resolved 0 polygons
// and nobody caught it — there was no proof that asserted "EVERY geographic zone
// resolves ≥1 polygon via zone-geometry". This IS that proof. It would have failed
// the moment a cluster was renamed without re-tagging; it is the gate that catches
// a stale ADM1 tag.
//
// Scope: the 27 GEOGRAPHIC zones (09b-asia-contiguity-v2 merged partition) —
//   13 regional (ADM0) + 12 asia (ADM1) + 2 uncovered (ADM0) = 27.
//   The 6 retained "Frontier Asia (uncovered)" legend stubs (nepal / himalaya /
//   mongolia / japan / sa-west / central-asia) were DISSOLVED: nepal→IN-A,
//   himalaya→IN-D, mongolia+japan→NAS-B (all as extraCountryCodes that ride the
//   asia ADM1 cores), and sa-west+central-asia MERGED into the single real
//   `uncovered-nas-a` zone (AFG/PAK/AZE/KGZ/TJK/UZB). So `uncovered_lists` is now
//   just [uncovered-nas-a, uncovered-scatter].
// EXEMPT + explicitly listed (NOT geometry-bearing land polygons we gate on):
//   - deaf                : an affinity-bloc overlay (A017), not a contiguous land
//                           zone; its polys double-count geographic rows by design.
//   - uncovered-scatter   : a residual catch-all, not a single land mass.
//   (uncovered-japan was an exempt island ADM0 — it no longer exists; JPN now
//    rides NAS-B as an extraCountryCode, off the uncovered partition entirely.)
// The exempt zones are LOGGED with their resolved count (advisory), never gated.
//
// CAN-FAIL: revert ONE listId tag → that zone resolves 0 polys → this proof FAILs
// with a non-zero exit. (Demonstrated by the proof itself: a 0-poly geographic
// zone is a hard FAIL.)
//
// Pure data layer: same loaders as tapestry-proof.mjs (the canonical model).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadRecords } from './normalize.js';
import { acquireRop1Payload } from './recache-rop1.mjs';
import { buildLegendNodes, leafZones } from './legend-tree.js';
import { resolveAllZones } from './zone-geometry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

// QA §1b exemptions: explicitly listed, logged, NEVER gated.
// (uncovered-japan removed in 09b-asia-contiguity-v2 — JPN dissolved into NAS-B.)
const EXEMPT = new Set(['deaf', 'uncovered-scatter']);

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
  console.log('========= 09b-7 §1b ZONE-RESOLVES PROOF (L17: the missed gate) =========');

  const { payload, skip } = await acquireRop1Payload();
  if (skip) {
    console.log(`SKIP — ${skip}\n(run: node data/recache-rop1.mjs --force)`);
    process.exit(2);
  }
  const records = loadRecords(payload);
  const { clusters, adm0, adm1Ind, adm1Chn } = loadDeps();
  const deps = { records, adm0, adm1Ind, adm1Chn };

  // Build the legend leaves (same shape tapestry-proof uses), attach selectors.
  const nodes = buildLegendNodes(clusters, { deafCount: 123 });
  const zones = leafZones(nodes);
  const byId = {};
  for (const l of clusters.lists || []) byId[l.id] = l.selector;
  for (const a of clusters.asia_lists || []) byId[a.id] = a.selector;
  for (const u of clusters.uncovered_lists || []) byId[u.id] = u.selector;
  byId['deaf'] = { type: 'affinity_bloc', rop1: 'A017' };
  for (const z of zones) z.selector = byId[z.id];

  const { perZone } = resolveAllZones(zones, deps);

  // The full universe (09b-asia-contiguity-v2 merged): 28 leaves = 13 regional +
  // 1 deaf + 12 asia + 2 uncovered. "27 geographic zones" = the 28 minus deaf (the
  // affinity overlay). Of those 27, scatter is EXEMPT from gating (residual
  // catch-all, logged advisory). So the GATED set = 27 − 1 = 26 contiguous land
  // zones that must each resolve ≥1 polygon. (The 6 dissolved uncovered stubs no
  // longer exist; NPL/BGD/BTN/MNG/JPN ride the asia ADM1 cores as extraCountryCodes.)
  const geographicAll = zones.filter((z) => z.id !== 'deaf');   // the "27"
  const gated = zones.filter((z) => !EXEMPT.has(z.id));         // 26: the ones we assert
  const exempt = zones.filter((z) => EXEMPT.has(z.id));

  const EXPECT_GEO = 27; // 13 regional + 12 asia + 2 uncovered (deaf excluded)
  const EXPECT_GATED = 26; // EXPECT_GEO − scatter (the one exempt-but-geographic zone)
  console.log(`[proof] geographic zones = ${geographicAll.length} (expect ${EXPECT_GEO}); ` +
    `gated = ${gated.length} (expect ${EXPECT_GATED}); exempt = ${exempt.length} ${JSON.stringify([...EXEMPT])}`);
  if (geographicAll.length !== EXPECT_GEO) {
    console.log(`FAIL  expected ${EXPECT_GEO} geographic zones, got ${geographicAll.length}`);
    fails++;
  }
  if (gated.length !== EXPECT_GATED) {
    console.log(`FAIL  expected ${EXPECT_GATED} gated zones, got ${gated.length}`);
    fails++;
  }
  const geographic = gated;

  console.log('\n--- gated: EVERY geographic zone resolves ≥1 polygon ---');
  let zeroZones = 0;
  for (const z of geographic) {
    const n = perZone.get(z.zoneKey ?? z.id) ?? 0;
    const kind = z.id.startsWith('asia-') ? 'ADM1' : 'ADM0';
    const ok = n >= 1;
    if (!ok) { zeroZones++; fails++; }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${z.id.padEnd(46)} ${String(n).padStart(3)} ${kind} polys`);
  }

  console.log('\n--- exempt (advisory, NOT gated) ---');
  for (const z of exempt) {
    const n = perZone.get(z.zoneKey ?? z.id) ?? 0;
    console.log(`ADVISORY  ${z.id.padEnd(46)} ${String(n).padStart(3)} polys (exempt: ${z.id === 'deaf' ? 'affinity overlay' : 'island/scatter'})`);
  }

  // Spotlight the 4 zones 09b-7 fixes — make their resolution explicit.
  // 09b-asia-contiguity-v2: the brief re-cut dissolved `asia-india-assam` (its 5
  // NE members migrated into `asia-india-west-bengal`, the IN-D successor). The
  // spot-check follows the successor id so it keeps asserting the NE frontier owns
  // ≥1 poly. (The general "all 30 zones resolve ≥1" gate above is the real proof;
  // this block is the historical 09b-7 spotlight.)
  console.log('\n--- the 4 (formerly-blank / v2-frontier) zones (must now be ≥1) ---');
  for (const id of ['asia-india-odisha', 'asia-india-west-bengal', 'asia-china-yunnan-province', 'asia-china-tibet-autonomous-region']) {
    const n = perZone.get(id) ?? 0;
    const ok = n >= 1;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(46)} ${String(n).padStart(3)} ADM1 polys (was 0 pre-09b-7)`);
  }

  console.log('\n========================================================');
  console.log(zeroZones === 0
    ? `PASS  all ${geographic.length} geographic zones resolve ≥1 polygon`
    : `FAIL  ${zeroZones} geographic zone(s) resolve 0 polygons (stale tag?)`);
  console.log(`ZONE-RESOLVES SUMMARY: ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  console.log('========================================================');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('ZONE-RESOLVES PROOF ERROR', e); process.exit(1); });
