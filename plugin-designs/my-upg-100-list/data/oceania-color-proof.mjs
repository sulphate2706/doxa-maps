// oceania-color-proof.mjs — slice 09b-oceania-color-fix §1(4) the missed gate
//
//   node plugin-designs/my-upg-100-list/data/oceania-color-proof.mjs
//
// THE BUG (09b-oceania-color-fix): oceania-indonesia (union of wagf_region:oceania
// + country_code:IDN → 18 ISO3) painted MULTIPLE colors on the map until clicked.
//
// ROOT CAUSE (proven, NOT the card's "missing ADM0" hypothesis — all 18 ISO3 were
// already present in world-adm0.geojson): the `deaf` affinity overlay (color #18ffff)
// double-stamps 16 of those 18 Pacific countries (its selector includes the oceania
// region). Both the oceania-indonesia (#ffc400) feature AND the deaf (#18ffff) feature
// for each Pacific country live in the SAME flat tapestry source painted by one
// tapestry-fill layer. Mapbox draws LATER source features ON TOP — and `deaf` resolved
// AFTER oceania-indonesia (leaf index 13 > 9) — so cyan over-painted amber on 16 of 18
// countries → the zone looked multi-colored. Click-isolate re-filtered the source to a
// single zone, forcing one color, which is why it "fixed itself" on click.
//
// THE FIX (zone-geometry.js, 1 ordering line): resolveAllZones() now resolves `deaf`
// FIRST, so every geographic land color paints OVER the deaf overlay. Pure draw-order:
// the per-zone resolved feature sets + their colors are byte-identical.
//
// THIS PROOF asserts two things, CAN-FAIL:
//   A. SINGLE-COLOR INVARIANT — every zone's resolved features ALL share ONE zoneColor.
//      (The card's required assertion. Revert the fix → still passes per-zone, because
//       the per-zone sets never mixed; this guards against a future selector that DOES
//       stamp two colors into one zone.)
//   B. OVERLAY-UNDER-LAND DRAW ORDER — for every ADM0 country that BOTH a geographic
//      land zone AND the `deaf` overlay stamp, the geographic feature must appear LATER
//      in the tapestry source array than the deaf feature (so land paints on top).
//      Revert the ordering fix in zone-geometry.js → deaf resolves after the land zone
//      for the 16 Pacific overlaps → this FAILS with a non-zero exit. THIS is the gate
//      the original slice missed.
//
// Pure data layer: same loaders as zone-resolves-proof.mjs / tapestry-proof.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadRecords } from './normalize.js';
import { acquireRop1Payload } from './recache-rop1.mjs';
import { buildLegendNodes, leafZones } from './legend-tree.js';
import { resolveAllZones } from './zone-geometry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

// The oceania-indonesia membership the card names (advisory spotlight).
const OCEANIA_18 = ['ASM','COK','FJI','FSM','GUM','IDN','KIR','MHL','MNP','NCL','NZL','PLW','PNG','PYF','SLB','TON','VUT','WSM'];

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
  console.log('===== 09b-oceania-color-fix §1(4) OCEANIA COLOR PROOF =====');

  const { payload, skip } = await acquireRop1Payload();
  if (skip) {
    console.log(`SKIP — ${skip}\n(run: node data/recache-rop1.mjs --force)`);
    process.exit(2);
  }
  const records = loadRecords(payload);
  const { clusters, adm0, adm1Ind, adm1Chn } = loadDeps();
  const deps = { records, adm0, adm1Ind, adm1Chn };

  const nodes = buildLegendNodes(clusters, { deafCount: 123 });
  const zones = leafZones(nodes);
  const byId = {};
  for (const l of clusters.lists || []) byId[l.id] = l.selector;
  for (const a of clusters.asia_lists || []) byId[a.id] = a.selector;
  for (const u of clusters.uncovered_lists || []) byId[u.id] = u.selector;
  byId['deaf'] = { type: 'affinity_bloc', rop1: 'A017' };
  for (const z of zones) z.selector = byId[z.id];

  const { tapestry } = resolveAllZones(zones, deps);

  // ── (0) advisory: oceania-indonesia resolves all 18 ISO3, all one color ──
  const oiFeats = tapestry.features.filter((f) => f.properties.zoneKey === 'oceania-indonesia');
  const oiIso = new Set(oiFeats.map((f) => f.properties.iso3).filter(Boolean));
  const oiColors = new Set(oiFeats.map((f) => f.properties.zoneColor));
  const missing18 = OCEANIA_18.filter((c) => !oiIso.has(c));
  console.log(`[spotlight] oceania-indonesia: ${oiFeats.length} feats, ` +
    `${oiIso.size}/18 ISO3, colors=${JSON.stringify([...oiColors])}`);
  if (missing18.length) { console.log(`FAIL  oceania-indonesia missing ISO3: ${missing18.join(' ')}`); fails++; }
  if (oiColors.size !== 1) { console.log(`FAIL  oceania-indonesia is multi-color: ${[...oiColors]}`); fails++; }

  // ── (A) SINGLE-COLOR INVARIANT: every zone's features share ONE zoneColor ──
  console.log('\n--- (A) single-color invariant: every zone resolves to ONE zoneColor ---');
  const zoneColors = new Map();
  for (const f of tapestry.features) {
    const k = f.properties.zoneKey;
    if (!zoneColors.has(k)) zoneColors.set(k, new Set());
    zoneColors.get(k).add(f.properties.zoneColor);
  }
  let multi = 0;
  for (const [k, s] of zoneColors) {
    if (s.size !== 1) { multi++; fails++; console.log(`FAIL  zone ${k} has ${s.size} colors: ${[...s].join(',')}`); }
  }
  console.log(multi === 0
    ? `PASS  all ${zoneColors.size} zones resolve to exactly ONE zoneColor`
    : `FAIL  ${multi} zone(s) resolve to >1 zoneColor`);

  // ── (B) deaf overlay is ABSENT from the region fill (design fix, an earlier fix) ──
  // HISTORY: this gate previously checked OVERLAY-UNDER-LAND DRAW ORDER — for every ADM0
  // iso3 stamped by BOTH a geographic land zone and `deaf`, the land feature's source index
  // had to be > the deaf feature's index so land painted on top. That draw-order mitigation
  // only re-stacked the same overlapping geometry; deaf still double-stamped land (16 of 18
  // Pacific ISO3) and still showed twice. The the brief's directive is to REMOVE the deaf
  // polygon/region layer entirely, which is the stronger invariant asserted below: deaf
  // contributes ZERO features to the tapestry, so there is no overlap to order at all.
  // deaf remains in the LEGEND/list + PINS (built outside this region-fill source).
  console.log('\n--- (B) deaf overlay ABSENT from region fill (overlap/coloring fix) ---');
  const deafFeats = tapestry.features.filter((f) => f.properties.zoneKey === 'deaf');
  const deafColorFeats = tapestry.features.filter((f) => f.properties.zoneColor === '#18ffff');
  const okAbsent = deafFeats.length === 0 && deafColorFeats.length === 0;
  if (!okAbsent) fails++;
  console.log(`[absent] deaf zoneKey features=${deafFeats.length}, #18ffff features=${deafColorFeats.length}`);
  console.log(okAbsent
    ? `PASS  deaf contributes 0 polygons to the tapestry — no underlap, no until-click bug`
    : `FAIL  deaf still present in the region fill (${deafFeats.length} feats / ${deafColorFeats.length} cyan)`);

  console.log('\n=========================================================');
  console.log(`OCEANIA COLOR SUMMARY: ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  console.log('=========================================================');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('OCEANIA COLOR PROOF ERROR', e); process.exit(1); });
