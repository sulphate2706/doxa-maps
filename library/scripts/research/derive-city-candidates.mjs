// derive-city-candidates.mjs — the LOCATION SPINE for the DX cities corpus.
//
//   node derive-city-candidates.mjs  ->  out/city-candidates.json
//
// ═══ READ THIS BEFORE TRUSTING THE OUTPUT ═══════════════════════════════════
//
// THESE ARE NOT CITIES. They are CLUSTERS OF PEOPLE-GROUP CENTROIDS, and the
// distinction is the whole integrity of this dataset.
//
// The flight brief says "list the key cities where the pens are". Measured against
// the real pin data, that instruction cannot be followed literally:
//
//   MEASURED 2026-08-01 (out/_records.json, 2,106 records, all with lat/lng):
//     India   855 pins -> 625 distinct ~11km cells
//     China   154 pins -> 149
//     Sudan   105 pins ->  93
//     Brazil  103 pins -> 102
//
// Pins are almost entirely DISTINCT locations, because each one is a people
// group's centroid — not a settlement. Clustering them into "cities" would
// manufacture placenames that do not exist, and a fabricated placename in a
// persecution-sensitive dataset is exactly the class of error that gets someone
// hurt. So this script does NOT name cities. It emits ANONYMOUS LOCATION
// CLUSTERS with coordinates, and leaves naming to a cited external source.
//
// WHAT IS DEFENSIBLE: at a ~25km radius, 277 cells hold MORE THAN ONE people
// group. A place where several distinct groups live within 25km IS a real
// population centre — that inference is sound, and it is the only inference this
// file makes. Single-pin cells are emitted too, flagged `shared:false`, so a
// consumer can weight them differently.
//
// EVERY row therefore carries provenance and an explicit unknown for anything not
// derived from the source data. Nothing here is researched; nothing is guessed.
// Constraint: unknowns are marked unknown; a yes/no is never guessed.
//
// PERSECUTION-SAFETY: this file emits location + language + population only. It
// carries NO gospel-resource, church, or believer field, and must not gain one —
// that join would be a targeting list.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const RECORDS = resolve(__dirname, '..', 'posters', 'out', '_records.json');

// ~25km at the equator, narrowing with latitude. Chosen because it is the radius
// at which multi-group cells appear at all (277 of 1,646); at ~11km almost every
// pin is alone, and at ~50km unrelated valleys merge.
const CELL = 4;               // quarter-degree
const cellKey = (lat, lng) => `${Math.round(lat * CELL) / CELL},${Math.round(lng * CELL) / CELL}`;

const raw = JSON.parse(readFileSync(RECORDS, 'utf8'));
const rows = Array.isArray(raw) ? raw : (raw.records || raw.data || []);

const cells = new Map();
for (const r of rows) {
  const lat = Number(r.latitude), lng = Number(r.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const k = cellKey(lat, lng);
  if (!cells.has(k)) cells.set(k, []);
  cells.get(k).push({ ...r, _lat: lat, _lng: lng });
}

const clusters = [];
for (const [key, members] of cells) {
  const lat = members.reduce((a, m) => a + m._lat, 0) / members.length;
  const lng = members.reduce((a, m) => a + m._lng, 0) / members.length;
  const pop = members.reduce((a, m) => a + (parseInt(m.population, 10) || 0), 0);
  const langs = [...new Set(members.map((m) => m.primary_language_label).filter(Boolean))];
  const iso3 = members[0].country_code;

  clusters.push({
    cluster_id: `loc-${iso3.toLowerCase()}-${key.replace(/[.,-]/g, '_')}`,
    iso3,
    country: members[0].country_code_label || iso3,
    region: members[0].wagf_region_label || 'Other',
    lat: +lat.toFixed(4),
    lng: +lng.toFixed(4),
    // TRUE when >1 distinct people group sits within ~25km — the only signal here
    // that actually argues "this is a population centre".
    shared: members.length > 1,
    people_group_count: members.length,
    people_groups: members.map((m) => m.name),
    languages: langs,
    // Summed from the source records. NOT a city population — it is the combined
    // people-group population within the cell, which is a different quantity.
    upg_population_sum: pop,

    // ── RESEARCH FIELDS — all unknown until individually sourced ─────────────
    place_name: null,              // must come from a cited gazetteer, never inferred
    place_name_source: null,
    internet_access: 'unknown',    // yes | partial | no | unknown
    internet_note: null,
    mobile_coverage: 'unknown',
    censorship: 'unknown',
    sources: [],

    provenance: {
      derived_from: 'doxa people-group records (lat/lng centroids)',
      method: `~25km cell aggregation (quarter-degree), cell=${key}`,
      caveat: 'NOT a settlement. A cluster of people-group pins; place_name is unresolved.',
      derived_on: '2026-08-01',
    },
  });
}

clusters.sort((a, b) => b.people_group_count - a.people_group_count);

const byCountry = {};
for (const c of clusters) byCountry[c.iso3] = (byCountry[c.iso3] || 0) + 1;

const stats = {
  source_records: rows.length,
  location_clusters: clusters.length,
  multi_group_clusters: clusters.filter((c) => c.shared).length,
  single_group_clusters: clusters.filter((c) => !c.shared).length,
  countries: Object.keys(byCountry).length,
  cell_size_deg: 1 / CELL,
  named_places: clusters.filter((c) => c.place_name).length,
  internet_researched: clusters.filter((c) => c.internet_access !== 'unknown').length,
  generated: '2026-08-01',
  scope_note: 'Scope is the full 2,106-record DX people-group corpus. No separate "2000 list" artefact exists on disk — verified by search — so this corpus IS the scope.',
  safety_note: 'Contains NO gospel-resource, church or believer field, and must not gain one. That join is held pending its own architecture (separate store, never joined to UPG locations in a public artifact).',
};

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'city-candidates.json'), JSON.stringify({ stats, clusters }, null, 1));

console.log(`[cities] ${stats.location_clusters} location clusters from ${stats.source_records} records`);
console.log(`[cities] multi-group (real population centres): ${stats.multi_group_clusters}`);
console.log(`[cities] single-group: ${stats.single_group_clusters}`);
console.log(`[cities] countries: ${stats.countries}`);
console.log(`[cities] named: ${stats.named_places}  internet-researched: ${stats.internet_researched}  (both 0 until sourced)`);
console.log('[cities] top multi-group clusters:');
for (const c of clusters.slice(0, 8)) {
  console.log(`   ${String(c.people_group_count).padStart(2)} groups  ${c.country.padEnd(28)} ${c.lat},${c.lng}`);
}
