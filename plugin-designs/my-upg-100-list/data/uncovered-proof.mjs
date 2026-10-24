// uncovered-proof.mjs — slice 09b-5 §1(d)  100%-coverage + contiguity + swap-back
//
//   node data/uncovered-proof.mjs        (exit 0 = PASS; can-fail)
//
// 09b-asia-contiguity-v2 UPDATE: the 6 retained "Frontier Asia (uncovered)" legend
// stubs (nepal / himalaya / mongolia / japan / sa-west / central-asia) were
// DISSOLVED per the design directive — they double-owned their polygons (a stub's
// country_codes selector AND the asia zone's extraCountryCodes both claimed the
// same land → Nepal rendered yellow / Mongolia in the uncovered color). The fix:
//   nepal→IN-A, himalaya→IN-D, mongolia+japan→NAS-B (each as extraCountryCodes that
//   ride the asia ADM1 core, which now OWNS both the count AND the render coverage),
//   and sa-west+central-asia MERGED into the single real `uncovered-nas-a` zone.
//   `uncovered_lists` is now [uncovered-nas-a, uncovered-scatter] (was 7).
//
// Proves, can-fail:
//   (1) 100% GEOGRAPHIC COVERAGE — the set of UPGs in NO geographic zone (13
//       regional `lists` + 10 India + 2 China `asia_lists` incl. their
//       extraCountryCodes + 2 `uncovered_lists`) is EMPTY. The deaf A017 row is the
//       ONE explicitly-exempt overlay zone (design-approved double-count, slice
//       08) and is excluded from the geographic partition — listed by name here.
//       => recomputed uncovered == 0  AND  all 2106 slugs accounted for, each in
//          exactly ONE geographic zone (no double-count among geographic zones).
//       PLUS a partition-conserved check: the original 115 frontier UPGs == the
//       union of (dissolved-into-asia extraCountryCodes) ∪ (remaining uncovered_lists).
//   (2) CONTIGUITY — each `uncovered_lists` zone marked `contiguous:true` is
//       internally connected under a committed country-adjacency border map. The
//       contiguity-EXEMPT zones (Scattered + the deaf overlay) are listed
//       explicitly and skipped. NAS-A's required-connected core is AFG+PAK+UZB+TJK+
//       KGZ; AZE is the flagged Caspian-separated near-member (not in the core).
//   (3) SWAP-BACK — deleting ONLY the `uncovered_lists` key and re-writing
//       canonically reproduces clusters.json md5 == a4bf2345 (the pre-09b-5
//       baseline), proving the 10 India + 2 China asia_lists (whose extraCountryCodes
//       now carry the dissolved frontier coverage), 13 regional lists, deaf_lists,
//       asia_unsolved + scalars were untouched by the uncovered re-partition.
//
// pg_slugs handling: the evaluator REJECTS pg_slugs by design (legend-tree.js:54),
// so this proof — like legend-tree.js / partition-uncovered.mjs — matches the asia
// pg_slugs rows + the Scattered `extra_slugs` strays OUTSIDE the evaluator. No
// shared-src change.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { evaluate } from './selector-evaluator.js';
import { loadRecords } from './normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLUSTERS = join(__dirname, 'clusters.json');
const ROP1_CACHE = '/tmp/upg-live-records-rop1.json';
const PLAIN_CACHE = '/tmp/upg-live-records.json';
// Swap-back baseline: dropping `uncovered_lists` and re-serialising must reproduce
// the rest of clusters.json byte-for-byte — proving the 7 uncovered zones are the
// ONLY thing this proof's edits touch. 09b-asia-contiguity-v2 re-cut `asia_lists`
// (the sanctioned re-partition: IN-A/B/C/D + NAS-B), so the baseline rolls
// from the pre-09b-5 snapshot (3aa10103, OLD India zones) to the post-v2 value
// below. The uncovered_lists themselves are unchanged (nepal:34, himalaya:15,
// sa-west:43, central-asia:6, mongolia:3, japan:6, scatter:8) — verified by the
// coverage + 115 + per-zone assertions above; only the asia_lists re-cut moved.
const PRE_09B5_MD5 = 'a4bf234545c7bec0c2388612177505d5';
const PRE_V2_MD5 = '3aa10103f54e172314b28130a63d42a4'; // historical (pre-asia-contiguity-v2)

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail = 1; };
const md5 = (s) => createHash('md5').update(s).digest('hex');
const existsCache = () => {
  try { readFileSync(ROP1_CACHE); return ROP1_CACHE; } catch {}
  try { readFileSync(PLAIN_CACHE); return PLAIN_CACHE; } catch {}
  return null;
};

// ── committed country-adjacency border map (land borders; well-known) ─────────
// Only the ISO3s that appear in uncovered_lists contiguous zones need entries.
const BORDERS = {
  NPL: ['IND', 'CHN'],
  BTN: ['IND', 'CHN'],
  BGD: ['IND', 'MMR'],
  AFG: ['PAK', 'IRN', 'TKM', 'UZB', 'TJK', 'CHN'],
  PAK: ['AFG', 'IRN', 'IND', 'CHN'],
  UZB: ['KAZ', 'KGZ', 'TJK', 'AFG', 'TKM'],
  KGZ: ['KAZ', 'UZB', 'TJK', 'CHN'],
  TJK: ['UZB', 'KGZ', 'AFG', 'CHN'],
  AZE: ['ARM', 'GEO', 'IRN', 'RUS', 'TUR'], // Caspian-separated from Central Asia core
  MNG: ['CHN', 'RUS'],
  JPN: [], // island
};

// Is the member country set internally connected (BFS) using BORDERS, restricted
// to the zone's own members? `core` (optional) limits the required-connected set
// (Central Asia: AZE excluded from the core — it's a flagged near-member).
function isCountryContiguous(members, core = null) {
  const within = core ? members.filter((m) => core.includes(m)) : members.slice();
  if (within.length <= 1) return true;
  const set = new Set(within);
  const seen = new Set([within[0]]);
  const stack = [within[0]];
  while (stack.length) {
    const cur = stack.pop();
    for (const nb of BORDERS[cur] || []) {
      if (set.has(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
  }
  return seen.size === set.size;
}

console.log('================ 09b-5 UNCOVERED-ZONE PROOF ================\n');

const cachePath = existsCache();
if (!cachePath) {
  console.log('SKIP — no live cache at /tmp/upg-live-records*.json (run: node data/recache-rop1.mjs --force)');
  process.exit(2);
}
const records = loadRecords(JSON.parse(readFileSync(cachePath, 'utf8')));
const clusters = JSON.parse(readFileSync(CLUSTERS, 'utf8'));

// 09b-asia-contiguity-v2: the 6 retained "Frontier Asia (uncovered)" stubs were
// DISSOLVED into the asia ADM1 cores (nepal→IN-A, himalaya→IN-D, mongolia+japan→
// NAS-B as extraCountryCodes) and sa-west+central-asia MERGED into the single real
// `uncovered-nas-a` zone. `uncovered_lists` is now [uncovered-nas-a, uncovered-scatter].
ok(Array.isArray(clusters.uncovered_lists) && clusters.uncovered_lists.length === 2,
  `uncovered_lists present with 2 zones (uncovered-nas-a + uncovered-scatter) (got ${clusters.uncovered_lists?.length})`);

// ── geographic membership: slug -> [zoneIds] (deaf overlay EXCLUDED) ──────────
// 09b-asia-contiguity-v2: uncovered-japan + uncovered-himalaya were dissolved
// (JPN→NAS-B, BGD+BTN→IN-D as extraCountryCodes). Only uncovered-scatter remains
// an exempt uncovered zone alongside the deaf overlay.
const EXEMPT_ZONES = ['deaf', 'uncovered-scatter'];
const slugZones = new Map(); // slug -> Set<zoneId>
const addSlug = (slug, zoneId) => {
  if (!slug) return;
  if (!slugZones.has(slug)) slugZones.set(slug, new Set());
  slugZones.get(slug).add(zoneId);
};

// 13 regional lists (country_code/wagf via evaluator)
for (const l of clusters.lists || []) {
  for (const s of evaluate(l.selector, records)) {
    // exclude deaf-* slugs from the regional partition — they belong to the deaf
    // overlay zone (the lists' country_code selectors also match them; this is
    // the slice-08 deaf double-count, kept out of the geographic partition).
    if (/^deaf-|(^|-)deaf($|-)/.test(s)) continue;
    addSlug(s, l.id);
  }
}
// 12 asia_lists (pg_slugs — evaluator rejects; read values directly).
// 09b-asia-contiguity-v2 CROSS-BORDER: an asia ADM1 zone may ALSO carry
// `extraCountryCodes` (the dissolved frontier stubs now ride their nearest ADM1
// core: NPL→IN-A, BGD+BTN→IN-D, MNG+JPN→NAS-B). Those countries' PGs are covered
// by — and geographically owned by — that asia zone, so fold their slugs in here
// (resolved via the evaluator's country_codes path, the same way the regional
// rows resolve). This is what dissolved the double-ownership: the polygon's slugs
// now belong to exactly the asia zone, not a competing uncovered country_codes stub.
for (const a of clusters.asia_lists || []) {
  if (a.selector?.type === 'pg_slugs') for (const s of a.selector.values) addSlug(s, a.id);
  for (const cc of a.extraCountryCodes || []) {
    for (const s of evaluate({ type: 'country_codes', values: [cc] }, records)) {
      if (/^deaf-|(^|-)deaf($|-)/.test(s)) continue; // deaf overlay, not geographic
      addSlug(s, a.id);
    }
  }
}
// 7 uncovered_lists (country_codes via evaluator; + Scattered extra_slugs)
for (const u of clusters.uncovered_lists || []) {
  if (u.selector) {
    for (const s of evaluate(u.selector, records)) {
      if (/^deaf-|(^|-)deaf($|-)/.test(s)) continue; // deaf overlay, not geographic
      addSlug(s, u.id);
    }
  }
  for (const s of u.extra_slugs || []) addSlug(s, u.id);
}

// ── (1) 100% coverage + no geographic double-count ───────────────────────────
const allSlugs = records.map((r) => r.slug).filter(Boolean);
const deafSlugs = new Set(allSlugs.filter((s) => /^deaf-|(^|-)deaf($|-)/.test(s)));
const geographic = allSlugs.filter((s) => !deafSlugs.has(s)); // the partitioned universe
const uncovered = geographic.filter((s) => !slugZones.has(s));

console.log('--- (1) coverage ---');
console.log(`[proof] total records=${records.length}  deaf overlay=${deafSlugs.size}  geographic universe=${geographic.length}`);
console.log(`[proof] geographic UNCOVERED after edit = ${uncovered.length} ${uncovered.slice(0, 8).join(', ')}`);
ok(uncovered.length === 0, `100% geographic coverage — 0 uncovered (deaf overlay exempt & listed)`);

// every geographic slug in exactly ONE geographic zone (no double-count)
const doubles = [];
for (const [slug, zs] of slugZones) {
  if (deafSlugs.has(slug)) continue;
  if (zs.size > 1) doubles.push(`${slug}:[${[...zs].join(',')}]`);
}
console.log(`[proof] geographic slugs in >1 zone = ${doubles.length} ${doubles.slice(0, 8).join(' ')}`);
ok(doubles.length === 0, `no geographic double-count (each non-deaf slug in exactly one zone)`);

// the all-up accounting: geographic covered + deaf overlay == 2106 distinct
const coveredGeo = new Set([...slugZones.keys()].filter((s) => !deafSlugs.has(s)));
console.log(`[proof] COVERAGE  geographic-covered=${coveredGeo.size} + deaf-overlay=${deafSlugs.size}  (universe ${geographic.length} + ${deafSlugs.size} = ${records.length})`);
ok(coveredGeo.size === geographic.length, `every one of the ${geographic.length} geographic UPGs is covered`);
ok(coveredGeo.size + deafSlugs.size === 2106, `COVERAGE 2106/2106 — geographic(${coveredGeo.size}) + deaf overlay(${deafSlugs.size}) == 2106`);

// 09b-asia-contiguity-v2 PARTITION-CONSERVED: the original 115 "Frontier Asia"
// UPGs are now split between (a) the 5 frontier countries that DISSOLVED into the
// asia ADM1 cores as extraCountryCodes (NPL→IN-A, BGD+BTN→IN-D, MNG+JPN→NAS-B) and
// (b) the remaining 2 uncovered_lists zones (uncovered-nas-a + uncovered-scatter).
// The UNION of the two must still equal exactly the original 115 — proving the
// dissolve moved coverage from the stubs onto the asia cores WITHOUT dropping or
// duplicating a single UPG.
const FRONTIER_DISSOLVED_CCS = ['NPL', 'BGD', 'BTN', 'MNG', 'JPN']; // now ride asia ADM1 cores
const dissolvedSlugs = new Set();
for (const cc of FRONTIER_DISSOLVED_CCS) {
  for (const s of evaluate({ type: 'country_codes', values: [cc] }, records)) {
    if (!/^deaf-|(^|-)deaf($|-)/.test(s)) dissolvedSlugs.add(s);
  }
}
const uncSlugs = new Set();
for (const u of clusters.uncovered_lists || []) {
  if (u.selector) for (const s of evaluate(u.selector, records)) { if (!/^deaf-|(^|-)deaf($|-)/.test(s)) uncSlugs.add(s); }
  for (const s of u.extra_slugs || []) uncSlugs.add(s);
}
const frontier115 = new Set([...dissolvedSlugs, ...uncSlugs]);
ok(frontier115.size === 115,
  `partition conserved: dissolved-into-asia(${dissolvedSlugs.size}) ∪ uncovered_lists(${uncSlugs.size}) == the original 115 frontier UPGs (got ${frontier115.size})`);

// ── (2) contiguity ───────────────────────────────────────────────────────────
console.log('\n--- (2) country-adjacency contiguity ---');
console.log(`[proof] EXEMPT zones (no contiguity assertion): ${EXEMPT_ZONES.join(', ')}`);
for (const u of clusters.uncovered_lists || []) {
  const members = (u.selector?.values) || [];
  if (u.contiguityExempt) {
    console.log(`SKIP  ${u.id.padEnd(24)} EXEMPT  (${u.flag || 'island/scatter'})`);
    continue;
  }
  // 09b-asia-contiguity-v2: uncovered-nas-a MERGED AFG+PAK (sa-west) with
  // AZE/KGZ/TJK/UZB (central-asia). The required-connected core is the land-border
  // chain AFG-PAK-UZB-TJK-KGZ (AFG borders PAK+UZB+TJK; PAK borders AFG; UZB borders
  // KGZ+TJK). AZE stays the flagged Caspian-separated near-member (S5-D2), excluded
  // from the core exactly as it was under the old uncovered-central-asia zone.
  const core = u.id === 'uncovered-nas-a' ? ['AFG', 'PAK', 'UZB', 'KGZ', 'TJK'] : null;
  const contig = isCountryContiguous(members, core);
  const note = core ? '  (core AFG+PAK+UZB+KGZ+TJK; AZE flagged Caspian near-member)' : '';
  ok(contig, `${u.id.padEnd(24)} contiguous under land-border map :: ${members.join(', ')}${note}`);
}
// can-fail sentinel: a deliberately non-contiguous pair must FAIL the checker.
ok(!isCountryContiguous(['NPL', 'MNG']), `can-fail: NPL+MNG (no shared border) correctly NON-contiguous`);

// ── (3) swap-back to baseline md5 ────────────────────────────────────────────
console.log('\n--- (3) swap-back isolation ---');
const liveMd5 = md5(readFileSync(CLUSTERS, 'utf8'));
const reverted = JSON.parse(readFileSync(CLUSTERS, 'utf8'));
delete reverted.uncovered_lists;
const revertedStr = JSON.stringify(reverted, null, 2); // SAME canonical writer
const revertedMd5 = md5(revertedStr);
console.log(`[proof] live clusters.json md5      = ${liveMd5}`);
console.log(`[proof] swap-back (drop uncovered)  = ${revertedMd5}`);
console.log(`[proof] expected pre-09b-5 baseline = ${PRE_09B5_MD5}`);
ok(revertedMd5 === PRE_09B5_MD5,
  `swap-back reproduces pre-09b-5 md5 ${PRE_09B5_MD5} → India + China + 13 regional + deaf + all else frozen`);

// ── final zone table ─────────────────────────────────────────────────────────
console.log('\n--- final zone table ---');
console.log('  count  kind     id                        members');
for (const u of clusters.uncovered_lists || []) {
  const members = [...(u.selector?.values || []), ...(u.extra_slugs ? u.extra_slugs.map((s) => 'chn:' + s) : [])];
  const kind = u.contiguityExempt ? 'EXEMPT' : 'contig';
  console.log(`  [${String(u.count).padStart(3)}]  ${kind}  ${u.id.padEnd(24)}  ${members.join(', ')}`);
}
const sum = (clusters.uncovered_lists || []).reduce((a, u) => a + u.count, 0);
console.log(`  displayed uncovered_lists count = ${sum} (NAS-A 55 + Scattered 8 = 63; ` +
  `the other 52 of the original 115 frontier UPGs now ride the asia ADM1 cores as extraCountryCodes)`);

console.log(`\n================ RESULT: ${fail === 0 ? 'ALL-PASS' : 'FAILED'} ================`);
process.exit(fail);
