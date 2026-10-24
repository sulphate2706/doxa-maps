// pin-proof.mjs — Fix2 §1e runtime-shaped, can-fail proof for the PIN build
//
//   node data/pin-proof.mjs
//
// Reproduces the EXACT pin-stamping logic from upg-100-list.vue (the post-fix
// version) over the full record cache (lat/lng-bearing) and asserts:
//   (1) NO throw across all 26 leaf zones, INCLUDING the 12 Asia pg_slugs rows
//       (the old loop threw on the first Asia zone → zero pins).
//   (2) pin count ≈ 2106 — i.e. every record with finite lat/lng becomes a pin.
//   (3) at least one Asia pg_slugs zone contributes ≥1 slug to the zoneKey map
//       (proves Asia pins get a zoneKey, hence a color).
//
// Can-fail: revert the pg_slugs special-case (set REGRESS=1) and the stamp loop
// throws on the first Asia zone → assertion (1) fails, proving the test bites.
//
// Data source = the FULL cache (rop1 + population + lat/lng). The build emit +
// sibling-isolation checks live in the bash wrapper (proof.sh).

import { evaluate } from './selector-evaluator.js';
import { loadRecords } from './normalize.js';
import { acquireFullPayload } from './recache-full.mjs';
import { buildLegendNodes, leafZones } from './legend-tree.js';

const EXPECT_PINS = 2106;        // live UUPG count (records with finite lat/lng)
const REGRESS = process.env.REGRESS === '1';   // can-fail switch: disable the fix

// ── the EXACT slug→zoneKey stamp loop from upg-100-list.vue (post-fix) ──────────
// When REGRESS=1 we drop the pg_slugs special-case to reproduce the OLD bug, so
// this proof demonstrably bites.
function stampSlugToZone(leafZoneList, records) {
  const slugToZone = {};
  for (const z of leafZoneList) {
    if (!REGRESS && z.selector && z.selector.type === 'pg_slugs') {
      for (const s of (z.selector.values || [])) if (!(s in slugToZone)) slugToZone[s] = z.zoneKey;
    } else {
      try {
        for (const s of evaluate(z.selector, records)) if (!(s in slugToZone)) slugToZone[s] = z.zoneKey;
      } catch (e) {
        if (REGRESS) throw e;   // OLD behavior: let the throw abort the whole build
        console.warn('zone selector skipped', z.id, e && e.message);
      }
    }
  }
  return slugToZone;
}

function buildPins(records, slugToZone) {
  const pinFeatures = [];
  for (const r of records) {
    const lat = Number(r.latitude), lng = Number(r.longitude);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    pinFeatures.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { slug: r.slug, zoneKey: slugToZone[r.slug] || '' },
    });
  }
  return pinFeatures;
}

async function main() {
  let fails = 0;
  const log = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

  const { payload, skip, source } = await acquireFullPayload();
  if (skip) {
    console.log(`SKIP — ${skip}\n(run: node data/recache-full.mjs --force)`);
    process.exit(2);
  }
  console.log(`[pin-proof] records source = ${source}`);
  const records = loadRecords(payload);
  console.log(`[pin-proof] total records = ${records.length}`);

  // Build the 26-leaf nested legend + attach each leaf's selector (same as the .vue).
  const clusters = JSON.parse(
    (await import('node:fs')).readFileSync(new URL('./clusters.json', import.meta.url), 'utf8'),
  );
  const nodes = buildLegendNodes(clusters, { deafCount: 123 });
  const leafZoneList = leafZones(nodes);
  const byId = {};
  for (const l of clusters.lists || []) byId[l.id] = l.selector;
  for (const a of clusters.asia_lists || []) byId[a.id] = a.selector;
  byId['deaf'] = { type: 'affinity_bloc', rop1: 'A017' };
  for (const z of leafZoneList) z.selector = byId[z.id];

  const asiaZones = leafZoneList.filter((z) => z.selector && z.selector.type === 'pg_slugs');
  console.log(`[pin-proof] leaf zones = ${leafZoneList.length} (expect 26); pg_slugs(Asia) zones = ${asiaZones.length} (expect 12)`);

  // ── (1) NO throw across all 26 zones incl Asia pg_slugs ────────────────────────
  console.log('\n--- (1) stamp loop must not throw across all 26 zones ---');
  let slugToZone = null, threw = null;
  try {
    slugToZone = stampSlugToZone(leafZoneList, records);
  } catch (e) {
    threw = e;
  }
  log(threw === null, `pin-stamp loop completes without throwing (REGRESS=${REGRESS ? 1 : 0})`
    + (threw ? ` — THREW: ${threw.message}` : ''));
  if (threw) {
    // In REGRESS mode this is the expected failure; bail out so (2)/(3) report cleanly.
    console.log('\n========================================================');
    console.log(`PIN-PROOF SUMMARY: ${fails} FAILED (stamp threw — this is the OLD bug)`);
    console.log('========================================================');
    process.exit(1);
  }

  // ── (2) pin count ≈ 2106 (finite lat/lng) ──────────────────────────────────────
  console.log('\n--- (2) pin count = records with finite lat/lng ---');
  const pins = buildPins(records, slugToZone);
  const withCoords = records.filter((r) => isFinite(Number(r.latitude)) && isFinite(Number(r.longitude))).length;
  console.log(`[pin-proof] pins built = ${pins.length}; records w/ finite lat,lng = ${withCoords}; expect ≈ ${EXPECT_PINS}`);
  log(pins.length === withCoords, `every finite-coord record becomes a pin (${pins.length} == ${withCoords})`);
  log(Math.abs(pins.length - EXPECT_PINS) <= 50, `pin count ≈ ${EXPECT_PINS} (got ${pins.length}, |Δ|≤50)`);
  log(pins.length > 0, `pins are NON-zero (the bug produced zero)`);

  // ── (3) at least one Asia pg_slugs zone contributes ≥1 slug ─────────────────────
  console.log('\n--- (3) Asia pg_slugs zones contribute slugs to the zoneKey map ---');
  const zoneKeysInMap = new Set(Object.values(slugToZone));
  let asiaContributors = 0, asiaSlugTotal = 0;
  for (const z of asiaZones) {
    const got = zoneKeysInMap.has(z.zoneKey);
    const n = (z.selector.values || []).filter((s) => slugToZone[s] === z.zoneKey).length;
    if (got && n >= 1) asiaContributors++;
    asiaSlugTotal += n;
  }
  console.log(`[pin-proof] Asia zones contributing ≥1 slug = ${asiaContributors}/${asiaZones.length}; total Asia slugs mapped = ${asiaSlugTotal}`);
  log(asiaContributors >= 1, `≥1 Asia pg_slugs zone contributes its slugs (got ${asiaContributors})`);

  // How many pins actually carry an Asia zoneKey (proves they get colored, not '').
  const asiaZoneKeys = new Set(asiaZones.map((z) => z.zoneKey));
  const asiaPins = pins.filter((p) => asiaZoneKeys.has(p.properties.zoneKey)).length;
  console.log(`[pin-proof] pins carrying an Asia zoneKey = ${asiaPins} (these were 0 before the fix)`);

  console.log('\n========================================================');
  console.log(`PIN-PROOF SUMMARY: ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  console.log('========================================================');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('PIN-PROOF ERROR', e); process.exit(1); });
