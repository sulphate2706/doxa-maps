// emit-countries.mjs — build the COUNTRY dataset for the country-posters app.
//
// One entry per country that has at least one people group, carrying everything
// both the map and the poster wall need: the count, the region it files under, its
// bbox, and which sheet size it takes.
//
//   node emit-countries.mjs
//     -> ../../data/country-posters.json   (library/data — two consumers)
//
// SHEET LADDER (2026-08-01) — the count selects the SHEET SIZE, it does not
// exclude a country:
//   <= OVERSIZE_AT   3ft x 3ft   (172 countries, incl. Sudan 105 + Brazil 103)
//   <= UNSUPPORTED_AT 3ft x 4ft  (China, 154 — "lengthen it by one foot")
//   >  UNSUPPORTED_AT none       (India, 855 — a not-yet card printing the EXACT number)
//
// EVERY qualifying country gets a sheet, including the 92 with exactly one group.
// A country with a single people group still gets its map, and those sheets sort
// to the bottom of the list. The wall's descending
// sort is what handles them — NOT a floor and NOT a sparse template variant.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Writes to library/data now, not into the country-posters bundle: the regions-dashboard
// poster dropdown is a SECOND consumer of this dataset, and a generator that still wrote to
// one plugin's folder would quietly recreate the duplicate this move removed.
const OUT_DIR = resolve(__dirname, '..', '..', 'data');
const RECORDS = join(__dirname, 'out', '_records.json');
const ADM0 = resolve(__dirname, '..', '..', '..', 'plugin-designs', 'my-upg-100-list', 'data', 'adm0', 'world-adm0.geojson');

const OVERSIZE_AT = 120;      // above this, the 3x4 sheet
const UNSUPPORTED_AT = 200;   // above this, no single sheet fits legibly

const raw = JSON.parse(readFileSync(RECORDS, 'utf8'));
const rows = Array.isArray(raw) ? raw : (raw.records || raw.data || []);

// Country polygons, so a country with records but no boundary is detectable rather
// than silently absent — that gap (175 record countries vs 161 polygons) is real.
//
// MEASURED 2026-08-01 — the countries without a polygon are NOT random:
//   IND (855) — India USED to be absent from world-adm0.geojson. It is now fetched
//     at ADM0 like every other country (2026-08-02, data/source-boundaries.mjs), so
//     hasGeometry is true for it. India still renders no country SHEET: that is
//     gated on record count (855 > UNSUPPORTED_AT), not on geometry — a not-yet
//     card printing the EXACT number.
//   The rest are microstates/territories with 1-3 groups each: KOS ESH CCK CXR
//     GIB JEY MCO NFK HKG MAC SXM SJM TKL. The pin-extent fallback is the right
//     answer for those — a 1-group territory needs a view, not a boundary.
const adm0 = JSON.parse(readFileSync(ADM0, 'utf8'));
const haveGeom = new Set(adm0.features.map((f) => f.properties?.iso3).filter(Boolean));

const bboxOf = (geom) => {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
    } else for (const p of c) walk(p);
  };
  walk(geom.coordinates);
  return [x0, y0, x1, y1];
};
const geomBbox = new Map();
for (const f of adm0.features) {
  const k = f.properties?.iso3;
  if (k) geomBbox.set(k, bboxOf(f.geometry));
}

// Group the records by ISO3.
const byIso = new Map();
for (const r of rows) {
  const iso = r.country_code;
  if (!iso) continue;
  if (!byIso.has(iso)) byIso.set(iso, []);
  byIso.get(iso).push(r);
}

const countries = [];
for (const [iso, list] of byIso) {
  const count = list.length;
  // The region every record agrees on (they do, in practice — take the first).
  const region = list[0].wagf_region_label || list[0].wagf_region || 'Other';
  const label = list[0].country_code_label || iso;

  // Fall back to the PIN extent when there is no polygon, so a country without a
  // boundary still has a usable view rather than defaulting to the whole globe.
  let bbox = geomBbox.get(iso);
  if (!bbox) {
    const lng = list.map((r) => +r.longitude).filter(Number.isFinite);
    const lat = list.map((r) => +r.latitude).filter(Number.isFinite);
    bbox = lng.length ? [Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)] : null;
  }

  const sheet = count > UNSUPPORTED_AT ? null : count > OVERSIZE_AT ? '3x4' : '3x3';

  countries.push({
    id: `country-${iso.toLowerCase()}`,
    iso3: iso,
    label,
    count,
    region: region === 'N/A' || !region ? 'Other' : region,
    bbox,
    sheet,
    hasGeometry: haveGeom.has(iso),
    // The not-yet reason is DATA, not UI copy, so the exact number travels with the
    // record and cannot drift from what the wall prints.
    // It states the exact number, the one in our data.
    unsupportedReason: sheet ? null
      : `${label} has ${count.toLocaleString()} people groups — too many to fit one poster legibly. A solution is in progress.`,
  });
}

countries.sort((a, b) => b.count - a.count);

const stats = {
  countries: countries.length,
  people_groups: rows.length,
  withGeometry: countries.filter((c) => c.hasGeometry).length,
  noGeometry: countries.filter((c) => !c.hasGeometry).length,
  sheet_3x3: countries.filter((c) => c.sheet === '3x3').length,
  sheet_3x4: countries.filter((c) => c.sheet === '3x4').length,
  unsupported: countries.filter((c) => !c.sheet).length,
  single_group: countries.filter((c) => c.count === 1).length,
  generated: new Date().toISOString().slice(0, 10),
};

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'country-posters.json'), JSON.stringify({ stats, countries }, null, 1));

console.log(`[countries] ${stats.countries} countries, ${stats.people_groups} people groups`);
console.log(`[countries] 3x3=${stats.sheet_3x3}  3x4=${stats.sheet_3x4}  unsupported=${stats.unsupported}`);
console.log(`[countries] no polygon: ${stats.noGeometry}   single-group: ${stats.single_group}`);
for (const c of countries.slice(0, 5)) console.log(`   ${String(c.count).padStart(4)}  ${c.label} [${c.sheet || 'NOT-YET'}]`);
