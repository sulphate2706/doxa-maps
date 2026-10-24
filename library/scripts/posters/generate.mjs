// generate.mjs — UPG100-POSTERS generator (card 7c4feeda22bd8bc2, P2/P3)
//
// One self-hosted, print-deterministic SVG poster per leaf zone of the
// my-upg-100-list map. NO Mapbox, NO token, NO external fetch at render time,
// NO npm installs — pure Node 22 + the map's OWN zone-resolution logic (reused
// read-only) so every poster matches the live map exactly.
//
//   • basemap   : country (ADM0) + state-cluster (ADM1) polygons drawn as SVG
//                 from the geojson the map already ships (scope (B), approved).
//   • pins      : every people-group at its TRUE lat/lng (Web Mercator).
//   • labels    : the HARD part — names de-overlapped via a two-gutter CALLOUT
//                 layout + LEADER LINES (pins never move; labels stack in the
//                 left/right margins, ordered by latitude, connected by lines).
//   • aspect    : portrait 3:4 (3ft × 4ft). Rendered at CSS 1350×1800; shoot.mjs
//                 screenshots at deviceScaleFactor 4 → 5400×7200 px (~150 DPI @ 3ft).
//
// Usage:  node generate.mjs            # all 28 zones
//         ONLY=laos node generate.mjs  # one zone (smoke test)
//
// Output: out/posters/<zoneKey>.html  +  out/manifest.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
// OSM street tiles for city sheets — no token, no account. See osm-basemap.mjs.
import { fetchGrid, bestZoom } from './osm-basemap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The profile data lives in THIS repo — library/scripts/posters -> plugin-designs.
// This generator used to sit outside doxa-maps entirely and reach in via
// UPG100_DATA_PATH; forgetting that env var silently rendered a STALE COPY of the
// data (that is how Nepal vanished from a poster). Now the default path is the
// repo's own profile, so the generator cannot read anyone else's data by accident.
const DATA = process.env.UPG100_DATA_PATH
  ? resolve(process.env.UPG100_DATA_PATH)
  : resolve(__dirname, '..', '..', '..', 'plugin-designs', 'my-upg-100-list', 'data');
// OUT_DIR lets a caller write somewhere private instead of the shared out/. out/posters/ is
// gitignored but SHARED, and other gates read it: check:zone-census counts the sheets there to
// decide whether every selectable zone has a poster. A checker that runs this generator for its own
// comparison therefore has to write elsewhere, or it leaves two real sheets behind and the next gate
// reads them as a half-finished poster build. Measured: exactly that turned check:zone-census from
// NOT MEASURED into FAIL ("28 selectable zone(s) have NO poster") on a fresh checkout.
const OUT = process.env.OUT_DIR ? resolve(process.env.OUT_DIR) : join(__dirname, 'out');
const POSTERS = join(OUT, 'posters');
mkdirSync(POSTERS, { recursive: true });

// ── THE SERIES ──────────────────────────────────────────────────────────────
// ★ THIS FILE IS THE HALF NOBODY WAS LOOKING AT. The country posters were reported carrying
// UPG-100 framing, and the search went to packet-strings.json — but the block telling the reader to
// divide the set among THIRTY disciples is not a packet string at all. It is poster furniture, a
// hard-coded array in THIS file (see NETWORKS below), so a series parameter applied to the packet
// alone would have left "Thirty disciples" printing on all ~170 country posters.
// Same series.json as packet.mjs reads, so the two surfaces cannot drift apart; unknown or absent
// SERIES resolves to upg100 so an unchanged command renders unchanged output.
// ⚠ DATA PATH IS NOT TAKEN FROM THE SERIES HERE. This file already has UPG100_DATA_PATH above, with
// its own history (forgetting it once rendered a stale copy and Nepal vanished from a poster).
// Adding a second, silently-competing source for the same path would rebuild that bug.
const SERIES_DEF_ALL = readJSON_early(join(__dirname, 'series.json'));
// ★ COUNTRIES=1 IS AN ALIAS FOR SERIES=country, not a second switch (2026-09-28).
// The country-posters app has been run as COUNTRIES=1 since before series.json existed, so the
// alias keeps every one of those commands working AND now gives them the matching packet. Having
// TWO parameters for ONE concept is precisely what let a SERIES=country render take the new
// packet path while its header stayed UPG-100 — one switch, or the halves drift again.
const SERIES_ID = process.env.SERIES || (process.env.COUNTRIES === '1' ? 'country' : 'upg100');
if (!SERIES_DEF_ALL[SERIES_ID] || SERIES_ID.startsWith('_')) {
  const known = Object.keys(SERIES_DEF_ALL).filter((k) => !k.startsWith('_')).join(', ');
  console.error(`SERIES="${SERIES_ID}" is not in series.json. Known: ${known}`);
  process.exit(1);
}
// ⚠ SERIES_DEF, not SERIES. A `SERIES` already exists further down meaning the poster series'
// derived FACTS (totalGroups, totalLists, index). Two different senses of one word; the newcomer
// takes the longer name rather than shadowing a constant that predates it.
const SERIES_DEF = SERIES_DEF_ALL[SERIES_ID];
// readJSON is declared below, after the dynamic imports; this one line cannot wait for it.
function readJSON_early(p) { return JSON.parse(readFileSync(p, 'utf8')); }

// ── the map's own logic, reused read-only ────────────────────────────────────
const { upg100Zones, assignPins, seriesFacts } = await import(join(DATA, 'zone-sheet.js'));
const { resolveZoneGeometry } = await import(join(DATA, 'zone-geometry.js'));
const { normalizeRecords, extractRecords } = await import(join(DATA, 'normalize.js'));
// The adm0 geojson carries ONLY { iso3 } — no country names at all — so the label
// text has to come from the map's own ISO3 dictionary rather than the geometry.
const { ISO3_NAME } = await import(join(DATA, 'territory-counts.js'));

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clusters = readJSON(join(DATA, 'clusters.json'));
const adm0 = readJSON(join(DATA, 'adm0', 'world-adm0.geojson'));
const adm1Ind = readJSON(join(DATA, 'gb-IND-ADM1.geojson'));
const adm1Chn = readJSON(join(DATA, 'gb-CHN-ADM1.geojson'));

// CAPITALS + MAJOR CITIES. A map poster needs enough detail to read easily, but not
// so much that it becomes complicated: cities and capitals.
//
// Natural Earth 1:10m, PUBLIC DOMAIN: no attribution required, no licence notice to
// carry onto a printed packet, and vendored so a build is reproducible offline and
// adds no runtime dependency. Trimmed at vendor time from 4.9 MB / 7,342 places to
// 170 KB / 2,573 (national + admin-1 capitals, plus cities >= 250k) because a poster
// cannot legibly carry 7,342 dots and the packet is downloaded.
//
// ⚠ ROADS WERE DELIBERATELY NOT ADDED, though main roads were asked for.
// Natural Earth's 10m roads layer has ZERO features for LAO, MMR, KHM, VNM, THA,
// NPL, BTN, TCD, NER, MLI, SOM, AFG, YEM, IDN, IND and CHN — its coverage is
// essentially USA/CAN/MEX. Shipping it would draw a rich road network on a US map
// and NOTHING on the countries these packets are actually for, which reads as a
// broken map exactly where it matters. A roads layer needs a source with real
// coverage in South/Southeast Asia and Africa (OSM extracts), which is a much
// bigger dependency — carded rather than half-shipped.
const nePlaces = (() => {
  try { return readJSON(join(__dirname, 'data', 'ne-places.json')).places || []; }
  catch { return []; }          // absent data degrades to no cities, never a crash
})();

// CONFIG-ONLY, FAIL-CLOSED — mirrors src/api-connections/apiBaseUrl.js. The data
// host comes SOLELY from build-time config; there is deliberately NO default host
// so an unconfigured run never silently phones home to someone else's data source.
const API = process.env.VITE_API_BASE_URL || process.env.MAP_APP_API_URL;
if (!API) {
  console.error('[generate] No API base configured — set VITE_API_BASE_URL to your data source. Failing closed: no request will be made.');
  process.exit(1);
}
const FIELDS = 'slug,name,country_code,wagf_region,wagf_block,rop1,population,latitude,longitude';

// ── fetch the live pins (the only network call; happens at GENERATE time only) ─
async function loadRecords() {
  // RECORDS_FILE lets a caller name the offline input instead of only the API-written cache. The
  // equivalence check needs BOTH sides fed from the same records, and out/_records.json is
  // gitignored — so without this the Node side could only ever run where a live API had already
  // written that file, which is what left that gate inert on every fresh checkout.
  const cache = process.env.RECORDS_FILE || join(__dirname, 'out', '_records.json');
  if (process.env.OFFLINE) { try { return readJSON(cache); } catch { /* fall through */ } }
  const url = `${API}/api/people-groups/list?fields=${FIELDS}&lang=en`;
  const resp = await fetch(url, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`PG API ${resp.status} ${url}`);
  const raw = await resp.json();
  const recs = normalizeRecords(extractRecords(raw));
  try { writeFileSync(cache, JSON.stringify(recs)); } catch { /* best effort cache */ }
  return recs;
}

// ── THE DRAWING LAYER lives in the library now (library/packet/poster-render.js), so the browser can
// generate a sheet at click time with the SAME code; this file is its Node driver: env and files in,
// sheets out. SERIES is created here and filled once the zones are known (the generator reads it).
import { createPosterGenerator } from '../../packet/poster-render.js';
const SERIES = { totalGroups: 0, totalLists: 0, index: 1 };
const { renderPoster, CITIES, COUNTRIES, FILE_SUFFIX } = createPosterGenerator({
  env: process.env, SERIES_DEF, ISO3_NAME, adm0, adm1Ind, adm1Chn, nePlaces, fetchGrid, bestZoom, series: SERIES,
});


// ── main ──────────────────────────────────────────────────────────────────────
const records = await loadRecords();

// ── COUNTRY MODE (COUNTRIES=1) ───────────────────────────────────────────────
// The country-posters app renders one sheet per COUNTRY instead of one per
// 100-list zone. A country is just a zone whose selector is its ISO3, so the whole
// template — header, facts table, pins, leaders, scripture bands, guards — is
// reused with a different zone LIST. Nothing about the sheet is country-specific.
//
// It creates posters with exactly the same template, showing the people groups in
// each of those countries.
//
// The sheet size comes from countries.json (emit-countries.mjs): 3x3 for <=120
// groups, 3x4 for China (154), and no sheet for India (855 — a not-yet card).
// Run FORMAT=3x4 separately for the oversize tier.
// ── CITY MODE (CITIES=1) ─────────────────────────────────────────────────────
// One sheet per NAMED POPULATION CENTRE — the Key City Posters app.
// A "city" here is a cluster of people-group pins within ~25km that holds
// MORE THAN ONE group, named by a CITED gazetteer (Nominatim/OSM). Unnamed and
// single-group clusters are excluded: a poster titled "unnamed location" is not a
// poster, and naming one by inference would fabricate a placename.
//
// ASCII-ONLY, deliberately. 99 of the 277 named centres are non-Latin
// (Hebrew/Arabic/Lao/Tibetan/Chinese/Cyrillic) and the sheet fonts are
// Lato/Georgia — those render as tofu. Rather than ship broken sheets or guess a
// font, city mode builds the 178 ASCII-safe centres now and the rest wait on the
// the brief's font decision (likely Noto Sans per-script). Partial and correct beats
// complete and wrong.
//
// The zone shape is identical to country mode, so the whole template — header,
// facts table, pins, leaders, scripture bands, guards — is reused unchanged.
let zones;
if (CITIES) {
  const cpath = resolve(__dirname, '..', 'research', 'out', 'tables', 'key-cities.json');
  const cdata = JSON.parse(readFileSync(cpath, 'utf8'));
  const pick = (cdata.rows || []).filter((r) =>
    r.named && r.place_name && r.place_name.split('').every((ch) => ch.charCodeAt(0) < 128) && r.people_group_count > 1);
  zones = pick.map((r) => {
    const names = String(r.people_groups || '').split(', ').filter(Boolean);
    return {
      id: `city-${r.iso3.toLowerCase()}-${r.place_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      zoneKey: `city-${r.iso3.toLowerCase()}-${r.lat}-${r.lng}`,
      label: r.place_name,
      count: r.people_group_count,
      color: '#2bb',
      adm0: [r.iso3],
      // Members are named explicitly — the pins for THIS cluster, nothing wider.
      // GEOMETRY selector is the COUNTRY: zone-geometry resolves a zone's polygons
      // via memberCountryCodes(), which the evaluator only answers for country/
      // region selectors — a pg_slugs selector throws there (the 100-list's Asia
      // zones dodge it through isAsiaZone()'s ADM1 branch, which a city is not).
      // So the sheet draws the country, and _pgSlugs (below) decides which PINS
      // land on it. Those are two different questions and conflating them is what
      // broke the first attempt.
      selector: { type: 'country_codes', values: [r.iso3] },
      _pgNames: names,
      _bbox: [r.lng - 1.2, r.lat - 1.2, r.lng + 1.2, r.lat + 1.2],
    };
  });
  // NAME -> SLUG. The table carries names (human-readable); the evaluator matches
  // on slug. Resolving here keeps the selector honest rather than silently empty.
  const slugByName = new Map();
  for (const r of records) if (r.name && r.slug) slugByName.set(r.name, r.slug);
  let unresolved = 0;
  for (const z of zones) {
    z._pgSlugs = (z._pgNames || []).map((n) => slugByName.get(n)).filter(Boolean);
    unresolved += (z._pgNames || []).length - z._pgSlugs.length;
  }
  zones = zones.filter((z) => z._pgSlugs.length > 1);
  console.log(`[generate] CITY MODE — ${zones.length} named ASCII population centres` +
    (unresolved ? ` (${unresolved} group names did not resolve to a slug)` : ''));
} else if (COUNTRIES) {
  // ★ THE HUE RULE IS THE LIBRARY'S, NOT THIS FILE'S, AND THAT IS THE POINT. The browser generates
  // these sheets at click time from library/packet/posterSheets.js; this file is the Node driver for
  // the same output. A first attempt defined the region-to-hue mapping HERE and broke
  // check:poster-browser-equiv by exactly 26 bytes on country-npl -- 'hsl(45, 72%, 56%)' over
  // '#2bb', twice, because --zc is emitted at two places. Two definitions is two different posters
  // for the same country, which is precisely what that gate exists to refuse. One definition,
  // imported by both.
  const { countryRegionColor } = await import('../../packet/posterSheets.js');
  // ⚠ THE PATH THIS USED TO READ NO LONGER EXISTS, and COUNTRY MODE HAS BEEN BROKEN BECAUSE OF IT.
  // emit-countries.mjs writes library/data/country-posters.json (its OUT_DIR is library/data), and
  // ddde518a8 moved the data there while this reader kept pointing at
  // plugin-designs/country-posters/data/countries.json — a path with no file on main. Any
  // COUNTRIES=1 run has been dying on ENOENT since; it surfaced only once the single SERIES
  // switch made SERIES=country depend on this branch.
  // Both paths are tried, new one first, so a checkout carrying either layout works.
  const cpath = [
    resolve(__dirname, '..', '..', 'data', 'country-posters.json'),
    resolve(__dirname, '..', '..', '..', 'plugin-designs', 'country-posters', 'data', 'countries.json'),
  ].find((p) => existsSync(p));
  if (!cpath) {
    console.error('[generate] COUNTRY MODE needs the country list, and neither location has it:');
    console.error('  library/data/country-posters.json   (written by: node emit-countries.mjs)');
    console.error('  plugin-designs/country-posters/data/countries.json   (the pre-ddde518a8 path)');
    process.exit(1);
  }
  const cdata = JSON.parse(readFileSync(cpath, 'utf8'));
  const want = process.env.SHEET || '3x3';     // which tier to build
  zones = (cdata.countries || [])
    .filter((c) => c.sheet === want)
    .map((c) => ({
      id: c.id,
      zoneKey: c.id,
      label: c.label,
      count: c.count,
      color: countryRegionColor(c.region),
      adm0: [c.iso3],
      // PLURAL type + `values` — the evaluator's singular form is
      // { type:'country_code', value:'SDN' }. Passing `values` to the singular type
      // matches nothing and yields a silently empty poster.
      selector: { type: 'country_codes', values: [c.iso3] },
    }));
  console.log(`[generate] COUNTRY MODE — ${zones.length} countries at sheet ${want}`);
} else {
  zones = upg100Zones(clusters, records);   // leaf zones, each carrying its selector (data/zone-sheet.js)
}

// ── SERIES FACTS, derived — never typed ──────────────────────────────────────
// The the brief's requirement: numbers on the poster must come from the API and the
// cluster data at generation time, so a sheet printed later states later figures
// rather than carrying a stale count on a wall. `index` is filled per-poster.
Object.assign(SERIES, seriesFacts(zones));
// ★ THE SERIES SPANS BOTH SHEET TIERS AND A RUN ONLY EVER SEES ONE OF THEM. seriesFacts counts the
// zones THIS run built, so the 3x3 run reports 173 and the 3x4 run -- China alone -- reports 1.
// That is how China's sheet came to print "map 1 of 1" and, because the body sentence rounds
// (approxLists = Math.round(totalLists / 10) * 10 in poster-render), "one of a 0-map set". A 0-map
// set is nonsense on a printed poster. SERIES_TOTAL lets a tier run be told the size of the whole
// series; both tiers should be run with SERIES_TOTAL=174 so every sheet agrees.
if (process.env.SERIES_TOTAL) SERIES.totalLists = Number(process.env.SERIES_TOTAL);

// ★ WHICH GROUP PINS WHERE is data/zone-sheet.js's assignPins — the SAME function the browser uses when
// it generates a sheet at the click, so a group cannot pin in one zone on a printed poster and another
// on screen. Country zones carry their own country_code selector; UPG-100 zones got theirs above.
// A city's pins are EXACTLY its member groups (not everyone in the country), so cities keep their own
// name-resolved assignment.
let pinsByZone;
if (CITIES) {
  const slugToZone = {};
  for (const z of zones) for (const sl of (z._pgSlugs || [])) slugToZone[sl] = z.zoneKey;
  pinsByZone = new Map(zones.map((z) => [z.zoneKey, []]));
  for (const r of records) {
    const lat = Number(r.latitude), lng = Number(r.longitude);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const zk = slugToZone[r.slug];
    if (zk && pinsByZone.has(zk)) pinsByZone.get(zk).push({
      name: r.name || r.slug || '', lat, lng, slug: r.slug, country_code: r.country_code,
      population: r.population,
    });
  }
} else {
  pinsByZone = assignPins(zones, records, { onSkip: (z, e) => console.warn('zone selector skipped', z.id, e && e.message) });
}

const ONLY = process.env.ONLY;
const manifest = [];
let made = 0;
const failed = [];       // zones whose render threw — reported as a census at the end
for (const z of zones) {
  // The sheet's own position in the series: "1 of 30", not "23 of 30", because the
  // ORDER OF THE LIST WILL CHANGE.
  // The zone ordering in legend-tree is a legend ordering, not a series ordering,
  // so deriving the number from it printed an arbitrary position. SERIES_INDEX
  // makes it explicit and overridable until the series order is actually settled.
  SERIES.index = process.env.SERIES_INDEX ? Number(process.env.SERIES_INDEX)
               : (zones.indexOf(z) + 1);
  if (ONLY && z.zoneKey !== ONLY && z.id !== ONLY) continue;
  const pins = pinsByZone.get(z.zoneKey) || [];
  const zoneFC = resolveZoneGeometry(z, { records, adm0, adm1Ind, adm1Chn });
  // ONE BAD ZONE MUST NOT COST THE OTHER 28. The header guard throws when the
  // predicted HEADER is smaller than the laid-out content, which is a REAL defect
  // and must stay loud — but aborting the whole run meant a single overflowing
  // zone produced 16 posters instead of 29 and left the rest silently unbuilt.
  // Collect failures, keep going, and fail the RUN at the end with a census, so
  // the error is impossible to miss and the good posters still exist.
  // (Measured 2026-09-24: 3 of 29 zones overflow — oceania-indonesia and
  // andean-caribbean by 44px, asia-china-tibet by 21px. Root cause is that
  // measureHeader() returns a fixed HEADER_BASE outside SPARSE mode instead of
  // measuring the zone's own content — carded separately, not patched here.)
  let rendered;
  try {
    rendered = await renderPoster(z, pins, zoneFC);
  } catch (err) {
    failed.push({ zone: z.zoneKey, message: String(err && err.message || err) });
    console.error(`  ✗ ${z.zoneKey.padEnd(34)} ${String(err && err.message || err).slice(0, 90)}`);
    continue;
  }
  const { html, title, octiOK, crossings, diagFrac } = rendered;
  const file = `${z.zoneKey}${FILE_SUFFIX}.html`;
  writeFileSync(join(POSTERS, file), html);
  manifest.push({ zoneKey: z.zoneKey, title, count: pins.length, octilinear: octiOK, crossings, diagFrac, html: `posters/${file}`, png: `posters/${z.zoneKey}${FILE_SUFFIX}.png` });
  made++;
  console.log(`  ✓ ${z.zoneKey.padEnd(34)} ${String(pins.length).padStart(3)} pins  octi=${octiOK?'Y':'N'}  d=${diagFrac}  cross=${crossings}`);
}
// The poster manifest is what the wall reads; a paper-format run writes its own beside it.
if (!ONLY) writeFileSync(join(OUT, `manifest${FILE_SUFFIX}.json`), JSON.stringify({ generated: 'live', count: manifest.length, posters: manifest }, null, 2));
console.log(`\n${made} poster(s) → ${POSTERS}${ONLY ? ' (ONLY=' + ONLY + ')' : ', manifest.json written'}`);
// FAIL THE RUN, but only after every good poster is on disk. A non-zero exit keeps
// this a build error rather than a warning somebody scrolls past, and the census
// names exactly which zones are missing instead of leaving a silent short count.
if (failed.length) {
  console.error(`\n${failed.length} zone(s) FAILED to render and have NO poster:`);
  for (const f of failed) console.error(`  ✗ ${f.zone}: ${f.message}`);
  process.exit(1);
}
