// source-boundaries.mjs — THE boundary source. One script, every level, one schema.
//
//   node plugin-designs/my-upg-100-list/data/source-boundaries.mjs            # ADM0 + ADM1
//   node plugin-designs/my-upg-100-list/data/source-boundaries.mjs --level ADM0
//   node plugin-designs/my-upg-100-list/data/source-boundaries.mjs --iso NPL,BGD --force
//   node plugin-designs/my-upg-100-list/data/source-boundaries.mjs --resimplify [tol]
//
// Supersedes source-adm0.mjs (04t) and source-adm0-uncovered.mjs (09b-5), which
// fetched the SAME provider through two code paths with two property schemas and
// disagreed about which countries to include. That disagreement is what left India
// out of ADM0 and forced world-adm0-plus.geojson to exist as a patch.
//
// ═══ API AT BUILD TIME, FILES AT RENDER TIME ════════════════════════════════
// Only the FETCH is unified. Consumers keep reading the same local .geojson paths
// they always did, so nothing downstream changes a line — and the poster generator
// (library/scripts/posters/generate.mjs, 378 sheets via readFileSync) stays fully
// offline. Boundaries must never become a network dependency at render time.
//
// ═══ THE ONE SCHEMA ═════════════════════════════════════════════════════════
//   ADM0  { iso3, shapeGroup, shapeName }
//   ADM1  { iso3, shapeGroup, shapeName, listId }
// `iso3` is retained because every consumer resolves countries by it
// (zone-geometry.js, verify-map-paint.mjs, emit-countries.mjs, the choropleths).
// `shapeName` is NEW at ADM0: the old ADM0 pass stripped names, which is why
// territory-counts.js had to carry a separate 161-entry ISO3_NAME dictionary.
//
// ═══ listId IS OURS, NOT geoBoundaries' — AND IT IS LOAD-BEARING ════════════
// zone-geometry.js:77 resolves an Asia zone's polygons by
//   feature.properties.listId === zone.id
// listId is OUR curation; the API knows nothing about it. A fetch that overwrites
// ADM1 without re-stamping it paints NOTHING for those zones and still passes a
// build — that regression already shipped once (see retag-adm1.mjs). So this
// script never writes ADM1 without immediately re-deriving listId from the
// clusters files, and refuses to leave a feature untagged.
//
// ═══ ADM1 IS A CURATED SUBSET — FILTER, DO NOT REPLACE ══════════════════════
// MEASURED 2026-08-02 against live gbOpen:
//   IND  ADM1  api 36 units  |  on disk 34  (Mizoram, Nāgāland excluded)
//   CHN  ADM1  api 34 units  |  on disk 12  (only the provinces the 100-list covers)
// The on-disk files are the 100-list's PARTITION, not a raw dump. Every curated
// shapeName still matches the API exactly (0 drift), so we fetch the full level and
// keep the members india-clusters.json / china-clusters.json actually name. Taking
// the raw dump instead would add 24 units that belong to no cluster, and retag
// would (correctly) exit 1. Curation stays in the clusters files, where it is
// reviewable — not in an opaque geojson of unknown vintage.
//
// ═══ ADM2 IS DELIBERATELY OUT ═══════════════════════════════════════════════
// MEASURED: India ADM2 simplified = 7.6 MB / 735 features — larger than all nine
// current bundles combined (~3.8 MB). Global ADM2 is hundreds of MB. ADM2 is
// fetched per-country on demand, never bundled.
//
// ═══ PROVENANCE + LICENCE (corrects a wrong comment in source-adm0.mjs) ═════
// Source: geoBoundaries gbOpen.
//   metadata  GET https://www.geoboundaries.org/api/current/gbOpen/<ISO3>/<LEVEL>/
//   geometry  <metadata>.simplifiedGeometryGeoJSON  (fallback gjDownloadURL)
// source-adm0.mjs called gbOpen "Apache-2.0-ish open license". That is WRONG.
// gbOpen PASSES THROUGH each country's UPSTREAM licence, so the collection is
// MIXED-LICENCE with real per-country attribution duties — verified live:
//   IND ADM1  CC BY 2.5 IN   (datameet/maps)
//   SDN, BRA ADM0  CC BY 3.0 IGO (HDX)
//   USA, CHN ADM0  Public Domain
// This script therefore records the licence the API reports for every country it
// fetches, into adm0/PROVENANCE.json, so the attribution surface
// (library/composables/useMapAttribution.js) is backed by fetched fact rather than
// a hand-written guess. Countries gbOpen cannot serve are reported as gaps, never
// silently substituted from another provider — a mixed-provider collection that
// claims one provider is the fabricated-precision failure this card exists to end.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADM0_DIR = join(__dirname, 'adm0');
const ADM0_PATH = join(ADM0_DIR, 'world-adm0.geojson');
const PROVENANCE_PATH = join(ADM0_DIR, 'PROVENANCE.json');

const GB_API = (iso3, level) =>
  `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/${level}/`;

// The ADM1 levels we bundle, and the clusters file that defines each one's
// curated member set (the SAME files retag-adm1.mjs re-derives listId from).
const ADM1_TARGETS = [
  { iso3: 'IND', file: 'gb-IND-ADM1.geojson', clusters: 'india-clusters.json' },
  { iso3: 'CHN', file: 'gb-CHN-ADM1.geojson', clusters: 'china-clusters.json' },
];

// THE ADM0 COUNTRY SET — explicit, committed, and NOT derived from the file this
// script writes. It was derived from the artifact once, and that is a trap: delete or
// truncate world-adm0.geojson and the "needed" set silently collapses to whatever
// survived, so a re-fetch quietly narrows the map instead of restoring it. (Measured
// 2026-08-02: a run against a removed file fetched 16 countries and reported success.)
// The set is the accumulated need of every slice to date, plus India.
const ADM0_ISO3 = [
  'ABW', 'AFG', 'AGO', 'ALB', 'AND', 'ARE', 'ARM', 'ASM', 'ATG', 'AZE', 'BEN', 'BFA', 'BGD',
  'BGR', 'BHR', 'BHS', 'BIH', 'BLM', 'BLR', 'BMU', 'BOL', 'BRA', 'BRB', 'BRN', 'BTN', 'CAF',
  'CHN', 'CIV', 'CMR', 'COD', 'COG', 'COK', 'COL', 'COM', 'CUB', 'CUW', 'CYM', 'CYP', 'CZE',
  'DJI', 'DMA', 'DZA', 'ECU', 'EGY', 'ERI', 'ESP', 'ETH', 'FIN', 'FJI', 'FRO', 'FSM', 'GAB',
  'GEO', 'GGY', 'GHA', 'GIN', 'GLP', 'GMB', 'GNB', 'GNQ', 'GRC', 'GRD', 'GUF', 'GUM', 'GUY',
  'IDN', 'IND', 'IRN', 'IRQ', 'ISL', 'ISR', 'JAM', 'JOR', 'JPN', 'KAZ', 'KEN', 'KGZ', 'KHM',
  'KIR', 'KWT', 'LAO', 'LBN', 'LBR', 'LBY', 'LCA', 'LIE', 'LKA', 'LUX', 'MAR', 'MDV', 'MHL',
  'MLI', 'MLT', 'MMR', 'MNE', 'MNG', 'MNP', 'MOZ', 'MRT', 'MSR', 'MUS', 'MWI', 'MYS', 'MYT',
  'NAM', 'NCL', 'NER', 'NGA', 'NIU', 'NPL', 'NZL', 'OMN', 'PAK', 'PAN', 'PER', 'PHL', 'PLW',
  'PNG', 'PRK', 'PRY', 'PSE', 'PYF', 'QAT', 'RUS', 'SAU', 'SDN', 'SEN', 'SHN', 'SLB', 'SLE',
  'SMR', 'SOM', 'SSD', 'STP', 'SUR', 'SWE', 'SWZ', 'SYR', 'TCA', 'TCD', 'TGO', 'THA', 'TJK',
  'TON', 'TUN', 'TUR', 'TZA', 'UGA', 'USA', 'UZB', 'VCT', 'VEN', 'VGB', 'VIR', 'VNM', 'VUT',
  'WLF', 'WSM', 'YEM', 'ZAF', 'ZMB', 'ZWE',
];

// Countries the 115 uncovered UPGs live in (from the retired source-adm0-uncovered.mjs).
// Kept as a named subset so the uncovered zones' need stays legible inside the one set.
const UNCOVERED_ISO3 = [
  'NPL', 'PAK', 'AFG', 'BTN', 'JPN', 'USA', 'BGD', 'MNG',
  'AZE', 'CHN', 'TJK', 'AND', 'CCK', 'KGZ', 'UZB', 'GUF',
];

// India ships ADM0 like every other country. It was absent for one reason only:
// the 100-list splits it into 10 provincial zones, so the old ADM0 pass skipped
// it — and every global choropleth then left the largest field in the dataset
// (856 people groups) as an unpainted hole. The review caught it as "India seems
// to have no internet coverage". Nothing selects IND at ADM0 in the tapestry
// (verified: no regional/uncovered selector and no Asia zone.adm0 hook names it),
// so including it fixes the choropleths without touching the 100-list partition.
const ALWAYS_ISO3 = ['IND'];

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ── geometry simplification ─────────────────────────────────────────────────
// Lightweight deterministic stand-in for mapshaper -simplify (no new deps): drop
// tiny rings/parts, quantize coordinates, then Douglas-Peucker. Keeps country
// fills recognizable at world/region zoom, which is the only use these have.

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function perpDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts.slice();
  let maxD = -1, idx = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > tol) {
    const left = douglasPeucker(pts.slice(0, idx + 1), tol);
    const right = douglasPeucker(pts.slice(idx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

function quantizeRing(ring, q = 1e3) {
  const out = [];
  let prev = null;
  for (const [x, y] of ring) {
    const rx = Math.round(x * q) / q;
    const ry = Math.round(y * q) / q;
    if (!prev || prev[0] !== rx || prev[1] !== ry) {
      out.push([rx, ry]);
      prev = [rx, ry];
    }
  }
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) {
    out.push([out[0][0], out[0][1]]);
  }
  return out;
}

function simplifyPolygon(coords, minRingArea, tol = 0) {
  const out = [];
  for (let i = 0; i < coords.length; i++) {
    const ring = coords[i];
    if (i > 0 && ringArea(ring) < minRingArea) continue; // drop tiny hole
    let q = quantizeRing(ring);
    if (tol > 0 && q.length > 4) {
      q = douglasPeucker(q, tol);
      if (q.length && (q[0][0] !== q[q.length - 1][0] || q[0][1] !== q[q.length - 1][1])) q.push([q[0][0], q[0][1]]);
    }
    if (q.length >= 4) out.push(q);
  }
  return out.length ? out : null;
}

function simplifyGeometry(geom, minPartArea = 0.02, minRingArea = 0.0005, tol = 0) {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    const p = simplifyPolygon(geom.coordinates, minRingArea, tol);
    return p ? { type: 'Polygon', coordinates: p } : null;
  }
  if (geom.type === 'MultiPolygon') {
    const parts = [];
    for (const poly of geom.coordinates) {
      if (ringArea(poly[0]) < minPartArea) continue; // drop tiny island part
      const p = simplifyPolygon(poly, minRingArea, tol);
      if (p) parts.push(p);
    }
    if (!parts.length) {
      // keep at least the largest part so the country still paints
      let best = null, bestA = -1;
      for (const poly of geom.coordinates) {
        const a = ringArea(poly[0]);
        if (a > bestA) { bestA = a; best = poly; }
      }
      const p = best ? simplifyPolygon(best, minRingArea, tol) : null;
      return p ? { type: 'Polygon', coordinates: p } : null;
    }
    return { type: 'MultiPolygon', coordinates: parts };
  }
  return null;
}

// ── fetch ───────────────────────────────────────────────────────────────────
// Returns { features:[{properties,geometry}], licence } for one country+level.
async function fetchLevel(iso3, level) {
  const metaRes = await fetch(GB_API(iso3, level));
  if (!metaRes.ok) throw new Error(`meta HTTP ${metaRes.status}`);
  const meta = await metaRes.json();
  const url = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
  if (!url) throw new Error('no geometry url in metadata');
  const gjRes = await fetch(url);
  if (!gjRes.ok) throw new Error(`geojson HTTP ${gjRes.status}`);
  const fc = await gjRes.json();
  const features = (fc.features || []).filter((f) => f && f.geometry);
  if (!features.length) throw new Error('empty feature collection');

  // The API reports licence per country; record what it actually says rather than
  // asserting one blanket licence for the whole collection (it is mixed).
  const licence = {
    licenseType: meta.licenseType ?? null,
    licenseDetail: meta.licenseDetail ?? null,
    licenseSource: meta.licenseSource ?? null,
    boundarySource: meta.boundarySourceURL ?? meta.boundarySource ?? null,
  };
  return { features, licence };
}

// ── ADM0 ────────────────────────────────────────────────────────────────────
async function buildAdm0({ isoList, force }) {
  mkdirSync(ADM0_DIR, { recursive: true });

  // MERGE, never clobber: an existing feature is kept when the API cannot serve
  // its country, so a transient outage degrades to "unchanged", not "map loses a
  // country". Countries that were only ever obtainable from the retired Natural
  // Earth fallback surface below as LEGACY rather than being silently re-blessed
  // as gbOpen.
  const byIso = new Map();
  const wasOnDisk = new Set();
  if (existsSync(ADM0_PATH)) {
    for (const f of readJSON(ADM0_PATH).features || []) {
      if (f.properties?.iso3) { byIso.set(f.properties.iso3, f); wasOnDisk.add(f.properties.iso3); }
    }
    console.log(`[adm0] ${byIso.size} features already on disk`);
  }

  const licences = {};
  const fetched = [], skipped = [], gaps = [];
  let n = 0;
  for (const iso3 of isoList) {
    n++;
    if (byIso.has(iso3) && !force) { skipped.push(iso3); continue; }
    try {
      const { features, licence } = await fetchLevel(iso3, 'ADM0');
      const src = features[0];
      const simp = simplifyGeometry(src.geometry);
      if (!simp) throw new Error('simplify produced empty geometry');
      byIso.set(iso3, {
        type: 'Feature',
        properties: {
          iso3,
          shapeGroup: src.properties?.shapeGroup || iso3,
          shapeName: src.properties?.shapeName || iso3,
        },
        geometry: simp,
      });
      licences[iso3] = licence;
      fetched.push(iso3);
      process.stdout.write(`\r[adm0] ${n}/${isoList.length} fetched=${fetched.length} (${iso3})            `);
    } catch (e) {
      gaps.push(`${iso3}: ${e.message}`);
    }
  }
  process.stdout.write('\n');

  const features = [...byIso.values()].sort((a, b) =>
    (a.properties.iso3 || '').localeCompare(b.properties.iso3 || ''));
  const out = { type: 'FeatureCollection', features };
  writeFileSync(ADM0_PATH, JSON.stringify(out));
  const bytes = Buffer.byteLength(JSON.stringify(out));

  // Features we did NOT fetch this run and which carry no shapeName are of
  // unverified provenance — name them instead of implying the whole file is gbOpen.
  const legacy = features
    .filter((f) => !licences[f.properties.iso3] && !f.properties.shapeName)
    .map((f) => f.properties.iso3);

  writeFileSync(PROVENANCE_PATH, JSON.stringify({
    generated: new Date().toISOString(),
    source: 'geoBoundaries gbOpen',
    endpoint: 'https://www.geoboundaries.org/api/current/gbOpen/<ISO3>/<LEVEL>/',
    note: 'gbOpen passes through each country UPSTREAM licence — this collection is MIXED-LICENCE with per-country attribution duties.',
    adm0_features: features.length,
    licences,
    unverified_provenance: legacy,
    gaps,
  }, null, 2));

  console.log(`[adm0] wrote ${ADM0_PATH}`);
  console.log(`[adm0] features=${features.length}  size=${(bytes / 1024).toFixed(0)} KB  (budget <~2048 KB)`);
  console.log(`[adm0] fetched=${fetched.length}  kept-from-disk=${skipped.length}  gaps=${gaps.length}`);
  if (gaps.length) {
    console.log(`[adm0] COVERAGE GAPS — gbOpen could not serve (NOT substituted from another provider):`);
    for (const g of gaps) console.log(`    - ${g}`);
  }
  if (legacy.length) {
    console.log(`[adm0] UNVERIFIED PROVENANCE (on disk, not re-fetched this run): ${legacy.join(', ')}`);
  }
  if (bytes > 2_200_000) {
    console.log('[adm0] WARNING: over budget — run --resimplify to bring it under.');
  }
  return { features: features.length, gaps, bytes };
}

// ── ADM1 ────────────────────────────────────────────────────────────────────
// Fetch the whole level, then keep ONLY the units the clusters file names. See the
// header: the on-disk files are the 100-list's curated partition, not a raw dump.
async function buildAdm1({ force }) {
  const results = [];
  for (const t of ADM1_TARGETS) {
    const outPath = join(__dirname, t.file);
    const clusters = readJSON(join(__dirname, t.clusters));
    const members = new Map(); // shapeName -> listId  (curation + the load-bearing tag)
    for (const c of clusters) for (const m of c.members || []) members.set(m, c.id);

    if (existsSync(outPath) && !force) {
      console.log(`[adm1] ${t.file} present — pass --force to re-fetch`);
      results.push({ file: t.file, action: 'kept' });
      continue;
    }

    let features, licence;
    try {
      ({ features, licence } = await fetchLevel(t.iso3, 'ADM1'));
    } catch (e) {
      console.log(`[adm1] ${t.iso3}: FETCH FAILED (${e.message}) — leaving ${t.file} untouched`);
      results.push({ file: t.file, action: 'fetch-failed', error: e.message });
      continue;
    }

    const kept = [], dropped = [], missing = [];
    for (const f of features) {
      const shapeName = f.properties?.shapeName;
      const listId = members.get(shapeName);
      if (listId === undefined) { dropped.push(shapeName); continue; } // not in the partition
      const simp = simplifyGeometry(f.geometry);
      if (!simp) { missing.push(`${shapeName}: simplify produced empty geometry`); continue; }
      kept.push({
        type: 'Feature',
        properties: {
          iso3: t.iso3,
          shapeGroup: f.properties?.shapeGroup || t.iso3,
          shapeName,
          listId,
        },
        geometry: simp,
      });
    }

    // Every curated member MUST come back, or a zone silently loses polygons —
    // the exact regression class retag-adm1.mjs was written for. Refuse to write.
    const got = new Set(kept.map((f) => f.properties.shapeName));
    const absent = [...members.keys()].filter((m) => !got.has(m));
    if (absent.length || missing.length) {
      console.log(`[adm1] ${t.iso3}: REFUSING TO WRITE — ${absent.length} curated member(s) absent from the API response:`);
      for (const a of absent) console.log(`    - ${a}`);
      for (const m of missing) console.log(`    - ${m}`);
      console.log(`[adm1] ${t.file} left untouched. Reconcile ${t.clusters} against the API before re-running.`);
      results.push({ file: t.file, action: 'refused', absent, missing });
      continue;
    }

    writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features: kept }));
    const kb = (Buffer.byteLength(JSON.stringify({ type: 'FeatureCollection', features: kept })) / 1024).toFixed(0);
    console.log(`[adm1] ${t.file}: kept ${kept.length}/${features.length} curated units, dropped ${dropped.length} not in ${t.clusters}, ${kb} KB`);
    console.log(`[adm1]   licence: ${licence.licenseType ?? 'not reported'} ${licence.licenseDetail ?? ''}`);
    results.push({ file: t.file, action: 'written', kept: kept.length, dropped: dropped.length, licence });
  }

  if (results.some((r) => r.action === 'written')) {
    console.log(`\n[adm1] listId was written from the clusters files above. Now re-run the`);
    console.log(`[adm1] canonical re-tag so the tag has ONE authority and is proven:`);
    console.log(`[adm1]     node plugin-designs/my-upg-100-list/data/retag-adm1.mjs`);
    console.log(`[adm1]     node plugin-designs/my-upg-100-list/data/zone-resolves-proof.mjs`);
  }
  return results;
}

// ── --resimplify (offline budget control) ───────────────────────────────────
// The raw fetch lands ~11 MB; the IIFE budget is ~2 MB. This is the pass that
// closes that gap, and its knobs are DELIBERATELY exposed rather than fixed:
//   --resimplify <tol>   Douglas-Peucker tolerance, degrees (detail along a coast)
//   --min-part <a>       drop MultiPolygon parts under this area (whole islands)
//   --min-ring <a>       drop interior rings under this area (holes)
// tol alone trades detail; min-part/min-ring DELETE FEATURES' PARTS. The defaults
// here escalate all three until under budget, which is why a lazy `--resimplify`
// can land far below budget and quietly coarsen the map — measured 2026-08-02:
// the default start produced 621 KB against a 2048 KB budget, a 3x fidelity drop
// from the 1860 KB that had been shipping. Aim NEAR the budget, not under it.
function resimplify(startTol, startMinPart, startMinRing) {
  if (!existsSync(ADM0_PATH)) {
    console.error('[resimplify] no world-adm0.geojson on disk; run the fetch pass first');
    process.exit(2);
  }
  const fc = readJSON(ADM0_PATH);
  const BUDGET = 2_000_000;
  let tol = startTol, minPart = startMinPart, minRing = startMinRing, out, bytes;
  for (let pass = 0; pass < 8; pass++) {
    const feats = [];
    for (const f of fc.features) {
      const g = simplifyGeometry(f.geometry, minPart, minRing, tol);
      if (g) feats.push({ type: 'Feature', properties: { ...f.properties }, geometry: g });
    }
    out = { type: 'FeatureCollection', features: feats };
    bytes = Buffer.byteLength(JSON.stringify(out));
    console.log(`[resimplify] tol=${tol.toFixed(3)} minPart=${minPart.toFixed(3)} -> ${feats.length} feats, ${(bytes / 1024).toFixed(0)} KB`);
    if (bytes <= BUDGET) break;
    tol *= 1.8; minPart *= 1.6; minRing *= 1.6;
  }
  writeFileSync(ADM0_PATH, JSON.stringify(out));
  console.log(`[resimplify] wrote ${ADM0_PATH}  features=${out.features.length}  size=${(bytes / 1024).toFixed(0)} KB`);
  process.exit(bytes <= 2_200_000 ? 0 : 1);
}

// ── main ────────────────────────────────────────────────────────────────────
function argValue(name) {
  const i = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i === -1) return null;
  const a = process.argv[i];
  return a.includes('=') ? a.split('=')[1] : process.argv[i + 1] ?? null;
}

async function main() {
  if (process.argv.includes('--resimplify')) {
    return resimplify(
      parseFloat(argValue('--resimplify')) || 0.03,
      parseFloat(argValue('--min-part')) || 0.05,
      parseFloat(argValue('--min-ring')) || 0.01,
    );
  }

  const force = process.argv.includes('--force');
  const level = (argValue('--level') || 'all').toUpperCase();
  const isoArg = argValue('--iso');

  // The needed ADM0 set: whatever is already on disk (the accumulated needed set
  // from every prior slice) ∪ the uncovered-zone countries ∪ India.
  let isoList;
  if (isoArg) {
    isoList = isoArg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  } else {
    isoList = [...new Set([...ADM0_ISO3, ...UNCOVERED_ISO3, ...ALWAYS_ISO3])].sort();
  }

  console.log('======== source-boundaries — geoBoundaries gbOpen, one schema ========');
  console.log(`level=${level}  force=${force}  adm0 countries=${isoList.length}`);

  if (level === 'ALL' || level === 'ADM0') await buildAdm0({ isoList, force });
  if (level === 'ALL' || level === 'ADM1') await buildAdm1({ force });
}

main().catch((e) => { console.error('[source-boundaries] FATAL', e); process.exit(1); });
