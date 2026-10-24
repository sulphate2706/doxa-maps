// name-clusters.mjs — resolve location clusters to REAL, CITED placenames.
//
//   node name-clusters.mjs            # the 277 multi-group clusters (default)
//   LIMIT=50 node name-clusters.mjs   # cap the run
//   ALL=1 node name-clusters.mjs      # all 1,646 (slow: ~28 min at 1 req/s)
//
// ═══ WHY A GAZETTEER AND NOT CLUSTERING ═════════════════════════════════════
// derive-city-candidates.mjs deliberately emits place_name:null. Each pin marks
// a people group, not a settlement, so inferring a placename from pin
// geometry would MANUFACTURE it — and a fabricated placename in a
// persecution-sensitive dataset is the dangerous kind of wrong. Naming must come
// from a source that can be cited per row. This is that step.
//
// SOURCE: Nominatim (OpenStreetMap), reverse geocoding.
//   - NO ACCOUNT, no API key — satisfies the no-account privacy constraint.
//   - Licence ODbL 1.0, attribution "© OpenStreetMap contributors" carried per row.
//   - CHOSEN OVER GeoNames because GeoNames' shared `demo` user is exhausted
//     ("daily limit of 20000 credits for demo has been exceeded") and a real
//     GeoNames username IS an account signup. Tested 2026-08-01: Nominatim
//     resolved 17.4284,78.4492 -> "Hyderabad" correctly.
//
// RATE LIMIT IS A HARD RULE, NOT A SUGGESTION. Nominatim's usage policy is
// ABSOLUTE MAX 1 request/second with an identifying User-Agent. Exceeding it gets
// the IP banned, which would burn a shared public good for everyone. The 1100ms
// delay below is deliberate and must not be "optimised".
//
// EVERY row records what was asked and what came back. A cluster the gazetteer
// cannot name keeps place_name:null — an honest gap, never a guess.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const SPINE = join(OUT, 'city-candidates.json');
const NAMED = join(OUT, 'named-places.json');

const UA = 'doxa-maps-city-research/1.0 (people-group prayer mapping; contact via repo)';
const SOURCE = {
  name: 'Nominatim / OpenStreetMap',
  url: 'https://nominatim.openstreetmap.org',
  licence: 'ODbL 1.0 — © OpenStreetMap contributors',
  policy: 'max 1 request/second, identifying User-Agent required',
};
const DELAY_MS = 1100;

const spine = JSON.parse(readFileSync(SPINE, 'utf8'));
// Resumable: a kill costs one lookup, not the whole run.
const named = existsSync(NAMED) ? JSON.parse(readFileSync(NAMED, 'utf8')).places || {} : {};

const all = spine.clusters;
const pool = process.env.ALL === '1' ? all : all.filter((c) => c.shared);
const limit = process.env.LIMIT ? Number(process.env.LIMIT) : pool.length;
const todo = pool.filter((c) => !named[c.cluster_id]).slice(0, limit);

console.log(`[name] pool ${pool.length} (${process.env.ALL === '1' ? 'ALL clusters' : 'multi-group only'})`);
console.log(`[name] ${Object.keys(named).length} already named, ${todo.length} to look up`);
console.log(`[name] ~${Math.ceil(todo.length * DELAY_MS / 60000)} min at 1 req/s`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reverse(lat, lng) {
  // zoom=10 asks for the CITY/administrative level rather than a building or a
  // street — the right granularity for "which place is this cluster in".
  const url = `${SOURCE.url}/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const b = await res.json();
    if (b.error) return { error: String(b.error) };
    const a = b.address || {};
    return {
      name: b.name || a.city || a.town || a.village || a.county || null,
      display_name: b.display_name || null,
      addresstype: b.addresstype || null,
      city: a.city || a.town || a.village || null,
      state: a.state || a.region || null,
      country: a.country || null,
      country_code: (a.country_code || '').toUpperCase() || null,
      osm_id: b.osm_id || null,
    };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 80) };
  }
}

const flush = () => writeFileSync(NAMED, JSON.stringify({
  stats: {
    looked_up: Object.keys(named).length,
    resolved: Object.values(named).filter((n) => n.place_name).length,
    unresolved: Object.values(named).filter((n) => !n.place_name).length,
    generated: '2026-08-01',
  },
  source: SOURCE,
  places: named,
}, null, 1));

let done = 0;
for (const c of todo) {
  const r = await reverse(c.lat, c.lng);
  named[c.cluster_id] = {
    cluster_id: c.cluster_id,
    iso3: c.iso3,
    queried: { lat: c.lat, lng: c.lng },
    place_name: r.error ? null : (r.city || r.name || null),
    place_display: r.error ? null : r.display_name,
    place_type: r.error ? null : r.addresstype,
    admin_state: r.error ? null : r.state,
    // Cross-check: the gazetteer's country vs the people-group record's country.
    // A mismatch means the centroid falls outside its declared country — a data
    // problem worth surfacing, not silently accepting.
    gazetteer_country: r.error ? null : r.country_code,
    country_matches: r.error ? null : (r.country_code === c.iso3.slice(0, 2) || r.country === c.country),
    osm_id: r.error ? null : r.osm_id,
    error: r.error || null,
    source: SOURCE.name,
    licence: SOURCE.licence,
  };
  done++;
  if (done % 10 === 0) { flush(); console.log(`[name] ${done}/${todo.length} …`); }
  await sleep(DELAY_MS);
}

flush();
const resolved = Object.values(named).filter((n) => n.place_name).length;
console.log(`[name] DONE — ${Object.keys(named).length} looked up, ${resolved} resolved, ${Object.keys(named).length - resolved} unresolved`);
