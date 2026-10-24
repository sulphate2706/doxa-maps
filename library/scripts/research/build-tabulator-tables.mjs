// build-tabulator-tables.mjs — the VALIDATION + MODELING stage of IEMV.
//
//   node build-tabulator-tables.mjs  ->  out/tables/*.json  (+ app data folders)
//
// ═══ WHY THIS FILE EXISTS ═══════════════════════════════════════════════════
// The research stages produced NESTED research objects — good for capture, wrong
// for a list view. Tabulator wants FLAT ROWS: one record per fact, every column a
// scalar, so it can sort, filter, group and export without the app reshaping data
// at render time.
//
// Every research finding is stored as a Tabulator table for the apps' list views:
// organized as lists, at full granularity, in Tabulator's own format.
//
// So this is the M and V of IEMV:
//   I/E  extraction  — done by derive-city-candidates / fetch-* / name-clusters
//   M    modeling    — HERE: nested research objects -> flat typed rows
//   V    validation  — HERE: every table is asserted before it is written
//
// VALIDATION IS FAIL-LOUD. A table that fails its assertions throws rather than
// writing a broken file, because a silently-wrong table is worse than no table:
// the app renders it, it looks authoritative, and nobody checks. Same reasoning as
// the poster generator's fail-loud guards.
//
// EVERY ROW CARRIES ITS PROVENANCE — source, resolution, and (where relevant) what
// an absence means. A list view strips context, so the context has to be IN the row.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { classify, isComms } from './app-kind.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const TABLES = join(OUT, 'tables');
const PROFILES = resolve(__dirname, '..', '..', '..', 'plugin-designs');

const read = (f) => JSON.parse(readFileSync(join(OUT, f), 'utf8'));
const has = (f) => existsSync(join(OUT, f));

/**
 * Write a table only if it passes its own assertions.
 * @param {string} name
 * @param {Array} rows
 * @param {Array<{id,title,field,type}>} columns  the Tabulator column model
 * @param {Function} assert  throws on invalid
 */
// Groups whose UPSTREAM population is an outlier against comparable groups in this
// same corpus. Derived from the data — every other Deaf group sits near 1% of its
// national population (Iran 0.98%, Myanmar 0.97%) while Deaf Pakistanis is 3.98% —
// NOT from an outside prior. Same in-corpus comparison that caught the ISO2
// fabrication. An explicit list, so adding one is a deliberate reviewable act rather
// than a heuristic silently reclassifying real data. We do NOT overwrite the value:
// it is the upstream API's, and flagging is honest where editing would not be.
const POP_OUTLIERS = new Set(['Deaf Pakistanis']);

function emit(name, rows, columns, meta, assert) {
  if (!rows.length) throw new Error(`[tables] ${name}: EMPTY — refusing to write an empty table`);
  // Every declared column must exist on every row: a column Tabulator cannot find
  // renders as a silently blank cell, which reads as "no data" rather than "bug".
  const fields = columns.map((c) => c.field);
  for (const r of rows.slice(0, 50)) {
    for (const f of fields) {
      if (!(f in r)) throw new Error(`[tables] ${name}: row missing declared column '${f}'`);
    }
  }
  if (assert) assert(rows);
  if (!existsSync(TABLES)) mkdirSync(TABLES, { recursive: true });
  writeFileSync(join(TABLES, `${name}.json`), JSON.stringify({ meta, columns, rows }, null, 1));
  console.log(`[tables] ${name.padEnd(26)} ${String(rows.length).padStart(5)} rows  ${columns.length} cols`);
  return { name, rows: rows.length };
}

const built = [];

// ═══ TABLE 1 — PEOPLE GROUPS × RESOURCES (the bridge) ═══════════════════════
// One row per PEOPLE GROUP, not per language: the list view is browsed by group,
// and flattening here means Tabulator never has to expand a nested array.
if (has('language-resources.json')) {

// OPEN-POOL LAYER (keyless pools probed 2026-08-02 — fetch-open-pools.mjs).
// Kept SEPARATE from scripture/film on purpose. Open Bible Stories is 50 illustrated
// Bible narratives — a real gospel resource, strong for oral-preference and
// low-literacy communities, and NOT a Bible translation. Folding it into
// has_scripture would overstate TRANSLATION coverage, which is the single number
// that misdirects real translation effort.
const OPEN_POOLS = (() => {
  const f = join(OUT, 'open-pools.json');
  if (!existsSync(f)) return {};
  return JSON.parse(readFileSync(f, 'utf8')).languages || {};
})();
const obsFor = (iso) => {
  const d = OPEN_POOLS[iso]?.pools?.door43;
  if (!d) return { has: false, note: '' };
  if (d.roster_only) {
    // The trap this whole layer exists to avoid: a catalogue LISTING a language is
    // not the catalogue HAVING a resource for it. Measured: 4 of 44 DX overlaps.
    return { has: false, note: 'Door43 lists this language but hosts NO resources for it — roster membership is not coverage' };
  }
  return { has: !!d.has_open_bible_stories, note: d.has_open_bible_stories ? 'Open Bible Stories (50 illustrated narratives) — NOT a Bible translation' : '' };
};
  const src = read('language-resources.json');
  const rows = [];
  for (const L of src.languages) {
    for (const pg of L.people_groups) {
      rows.push({
        people_group: pg,
        language: L.language,
        iso639_3: L.iso639_3,
        countries: L.countries.join(', '),
        country_count: L.countries.length,
        population: L.population,
        has_scripture: !!L.has_scripture,
        full_bible: !!L.full_bible,
        new_testament: !!L.new_testament,
        has_film: !!L.has_film,
        jesus_film: !!L.jesus_film,
        // STRING not boolean, deliberately: 'unknown' is a THIRD state and a
        // boolean column would collapse it to false — telling a reader a language
        // is unserved when the pool that would answer was never checked.
        has_audio: String(L.has_audio),
        // OPEN BIBLE STORIES — its OWN field, never folded into has_scripture.
        has_open_bible_stories: obsFor(L.iso639_3).has,
        obs_note: obsFor(L.iso639_3).note,
        // The headline: nothing found in ANY checked pool. DELIBERATELY still
        // scripture+film only — OBS is a real resource but not a translation, and
        // this flag drives translation prioritisation. any_resource_found below
        // carries the wider reading so both questions can be asked separately.
        no_resource_found: !L.has_scripture && !L.has_film,
        any_resource_found: !!(L.has_scripture || L.has_film || obsFor(L.iso639_3).has),
        scripture_url: (L.resources && L.resources[0] && L.resources[0].url) || '',
        film_url: L.film_url || '',
        // Structural unmatchability is NOT the same as a measured absence.
        code_unmatchable: !!L.code_unmatchable,
        code_note: L.code_note || '',
        checked_pools: (L.checked_pools || []).join(', '),
        unchecked_pools: (L.unchecked_pools || []).join(', '),
      });
    }
  }
  rows.sort((a, b) => (a.no_resource_found === b.no_resource_found)
    ? b.population - a.population
    : (a.no_resource_found ? -1 : 1));

  built.push(emit('people-group-resources', rows, [
    { title: 'People Group', field: 'people_group', type: 'string' },
    { title: 'Language', field: 'language', type: 'string' },
    { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
    { title: 'Countries', field: 'countries', type: 'string' },
    { title: 'Population', field: 'population', type: 'number' },
    { title: 'Scripture', field: 'has_scripture', type: 'boolean' },
    { title: 'Full Bible', field: 'full_bible', type: 'boolean' },
    { title: 'NT', field: 'new_testament', type: 'boolean' },
    { title: 'Film', field: 'has_film', type: 'boolean' },
    { title: 'JESUS Film', field: 'jesus_film', type: 'boolean' },
    { title: 'Audio', field: 'has_audio', type: 'string' },
    { title: 'NO RESOURCE', field: 'no_resource_found', type: 'boolean' },
    { title: 'Scripture link', field: 'scripture_url', type: 'string' },
    { title: 'Film link', field: 'film_url', type: 'string' },
    { title: 'Code unmatchable', field: 'code_unmatchable', type: 'boolean' },
    { title: 'Code note', field: 'code_note', type: 'string' },
    { title: 'Pools checked', field: 'checked_pools', type: 'string' },
    { title: 'Pools NOT checked', field: 'unchecked_pools', type: 'string' },
  ], {
    title: 'People Groups × Gospel Resources',
    grain: 'one row per people group',
    sources: src.stats.pools_checked,
    not_included: src.stats.pools_unchecked,
    absence_meaning: 'FALSE means NOT FOUND in the pools checked — never proof that no resource exists.',
    unmatchable_note: '33 of 862 DX language codes are OUTSIDE the ISO 639-3 registry (31 private-use q*, almost all SIGN LANGUAGES). No pool can index those codes, so their resource status is UNRESOLVABLE BY JOIN — structurally false, not measured. Filter on code_unmatchable to separate them.',
    boundary: 'Resource availability only. No church, believer or meeting-point data.',
  }, (r) => {
    // The join must not have silently emptied: major languages MUST show scripture.
    const tel = r.find((x) => x.iso639_3 === 'tel');
    if (tel && !tel.has_scripture) throw new Error('validation: Telugu shows no scripture — the ISO join is broken');
    const bad = r.find((x) => x.has_audio !== 'unknown' && x.has_audio !== 'true' && x.has_audio !== 'false');
    if (bad) throw new Error(`validation: has_audio has an unexpected value '${bad.has_audio}'`);
  }));
}

// ═══ TABLE 1b — GOSPEL ACCESS vs POPULATION GROWTH ═════════════════════════
// The strategic question: is gospel access keeping pace with the population it has
// to reach? A group growing 2.5%/yr whose language still has no scripture falls
// further behind every year — invisible in a static "unreached" list.
if (has('language-resources.json') && has('demographics-by-country.json')) {
  const src = read('language-resources.json');
  const demo = read('demographics-by-country.json').countries;
  const recPath = resolve(__dirname, '..', 'posters', 'out', '_records.json');
  const rawRec = JSON.parse(readFileSync(recPath, 'utf8'));
  const records = Array.isArray(rawRec) ? rawRec : (rawRec.records || []);
  const byName = new Map();
  for (const r of records) byName.set(r.name, r);

  const rows = [];
  for (const L of src.languages) {
    for (const pg of L.people_groups) {
      const r = byName.get(pg) || {};
      const iso3 = r.country_code || '';
      const d = demo[iso3] || {};
      const pop = parseInt(r.population, 10) || 0;
      const dr = d.death_rate_per_1000;
      // ORDER-OF-MAGNITUDE: a NATIONAL crude rate applied to a sub-population.
      // Unengaged groups skew rural and poorer, so the real figure is plausibly
      // HIGHER. `estimate_method` travels with the number in every row.
      const deathsDay = (dr != null && pop) ? +((pop * (dr / 1000)) / 365.25).toFixed(2) : null;
      const growth = d.pop_growth_pct;
      const noRes = !L.has_scripture && !L.has_film;
      rows.push({
        people_group: pg,
        language: L.language,
        iso639_3: L.iso639_3,
        country: r.country_code_label || iso3,
        iso3,
        primary_religion: r.religion_label || 'Unknown',
        // Named clumsily on purpose: this is an INFERENCE from the group's primary
        // religion field, not a measurement of individual belief. Nobody counted.
        primary_religion_not_christian: !/christ/i.test(r.religion_label || ''),
        population: pop,
        population_growth_pct: growth ?? null,
        growth_year: d.pop_growth_pct_year || '',
        death_rate_per_1000: dr ?? null,
        death_rate_year: d.death_rate_per_1000_year || '',
        est_deaths_per_day: deathsDay,
        est_deaths_per_year: deathsDay != null ? +(deathsDay * 365.25).toFixed(0) : null,
        has_scripture: !!L.has_scripture,
        has_film: !!L.has_film,
        has_audio: String(L.has_audio),
        no_resource_found: noRes,
        // The headline signal: growing AND unreached by any checked resource.
        growing_without_resource: !!(noRes && growth != null && growth > 0),
        urban_pct: d.urban_pct ?? null,
        // POPULATION OUTLIER FLAG. Not a correction — the population comes from the
        // upstream people-group API and is not ours to overwrite — but a number that
        // disagrees with the corpus's OWN pattern must travel with that fact, because
        // est_deaths_per_day is computed straight from it and feeds the headline.
        // Measured: every other Deaf group sits near 1% of its national population
        // (Iran 0.98%, Myanmar 0.97%), while Deaf Pakistanis is 3.98% — a 4x outlier
        // against the corpus itself, not against an outside assumption. That single
        // row carries ~292 of the ~3,480 total deaths/day.
        population_outlier: POP_OUTLIERS.has(pg) ? 'population disagrees with comparable groups in this corpus — treat the derived rate as UNVERIFIED' : '',
        estimate_method: 'deaths/day = population x (national crude death rate / 1000) / 365.25 — ORDER-OF-MAGNITUDE; a NATIONAL rate applied to a sub-population',
        source: 'World Bank (demographics) + eBible/Arclight (resources)',
      });
    }
  }
  rows.sort((a, b) => (b.est_deaths_per_day || 0) - (a.est_deaths_per_day || 0));

  built.push(emit('gospel-access-vs-growth', rows, [
    { title: 'People Group', field: 'people_group', type: 'string' },
    { title: 'Language', field: 'language', type: 'string' },
    { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
    { title: 'Country', field: 'country', type: 'string' },
    { title: 'Primary religion', field: 'primary_religion', type: 'string' },
    { title: 'Population', field: 'population', type: 'number' },
    { title: 'Growth %/yr', field: 'population_growth_pct', type: 'number' },
    { title: 'Death rate /1000', field: 'death_rate_per_1000', type: 'number' },
    { title: 'Est. deaths/day', field: 'est_deaths_per_day', type: 'number' },
    { title: 'Est. deaths/yr', field: 'est_deaths_per_year', type: 'number' },
    { title: 'Scripture', field: 'has_scripture', type: 'boolean' },
    { title: 'Film', field: 'has_film', type: 'boolean' },
    { title: 'Audio', field: 'has_audio', type: 'string' },
    { title: 'NO RESOURCE', field: 'no_resource_found', type: 'boolean' },
    { title: 'GROWING + UNREACHED', field: 'growing_without_resource', type: 'boolean' },
    { title: 'Urban %', field: 'urban_pct', type: 'number' },
    { title: 'Method', field: 'estimate_method', type: 'string' },
  ], {
    title: 'Gospel Access vs Population Growth',
    grain: 'one row per people group',
    the_question: 'Is gospel access keeping pace with the population it must reach?',
    mortality_caveat: 'est_deaths_per_day applies a NATIONAL crude death rate to a SUB-POPULATION. It is an ORDER-OF-MAGNITUDE ESTIMATE, not a count. Crude death rate is not age-standardised. Unengaged groups skew rural and poorer, so the true figure is plausibly HIGHER.',
    religion_caveat: 'primary_religion_not_christian is INFERRED from the group primary-religion field, not measured individual belief. 1 of 2,106 DX groups has a Christian primary religion.',
    boundary: 'No church, believer or meeting-point data.',
  }, (r) => {
    const withEst = r.filter((x) => x.est_deaths_per_day != null);
    if (withEst.length < 1000) throw new Error(`validation: only ${withEst.length} rows have a mortality estimate`);
    const neg = r.find((x) => x.est_deaths_per_day != null && x.est_deaths_per_day < 0);
    if (neg) throw new Error('validation: negative deaths/day — the arithmetic is wrong');
  }));
}

// ═══ TABLE 2 — KEY CITIES (named population centres) ════════════════════════
if (has('city-candidates.json')) {
  const spine = read('city-candidates.json');
  const named = has('named-places.json') ? read('named-places.json').places : {};
  const conn = has('connectivity-by-country.json') ? read('connectivity-by-country.json').countries : {};

  const rows = spine.clusters.map((c) => {
    const n = named[c.cluster_id] || {};
    const k = conn[c.iso3] || {};
    return {
      place_name: n.place_name || '',
      place_type: n.place_type || '',
      admin_state: n.admin_state || '',
      country: c.country,
      iso3: c.iso3,
      region: c.region,
      lat: c.lat,
      lng: c.lng,
      people_group_count: c.people_group_count,
      people_groups: (c.people_groups || []).join(', '),
      languages: (c.languages || []).join(', '),
      upg_population: c.upg_population_sum,
      is_population_centre: !!c.shared,
      named: !!n.place_name,
      // Country-level context, LABELLED as such so a reader cannot mistake it for
      // a city measurement.
      country_internet_pct: k.internet_pct ?? null,
      country_internet_year: k.internet_year ?? '',
      country_internet_access: k.internet_access || 'unknown',
      internet_resolution: k.internet_pct != null ? 'country' : 'unknown',
      name_source: n.source || '',
      name_licence: n.licence || '',
    };
  });
  rows.sort((a, b) => b.people_group_count - a.people_group_count);

  built.push(emit('key-cities', rows, [
    { title: 'Place', field: 'place_name', type: 'string' },
    { title: 'Type', field: 'place_type', type: 'string' },
    { title: 'Admin area', field: 'admin_state', type: 'string' },
    { title: 'Country', field: 'country', type: 'string' },
    { title: 'ISO3', field: 'iso3', type: 'string' },
    { title: 'Region', field: 'region', type: 'string' },
    { title: 'Lat', field: 'lat', type: 'number' },
    { title: 'Lng', field: 'lng', type: 'number' },
    { title: 'People groups', field: 'people_group_count', type: 'number' },
    { title: 'Group names', field: 'people_groups', type: 'string' },
    { title: 'Languages', field: 'languages', type: 'string' },
    { title: 'UPG population', field: 'upg_population', type: 'number' },
    { title: 'Population centre', field: 'is_population_centre', type: 'boolean' },
    { title: 'Named', field: 'named', type: 'boolean' },
    { title: 'Country internet %', field: 'country_internet_pct', type: 'number' },
    { title: 'Year', field: 'country_internet_year', type: 'string' },
    { title: 'Access band', field: 'country_internet_access', type: 'string' },
    { title: 'Internet resolution', field: 'internet_resolution', type: 'string' },
    { title: 'Name source', field: 'name_source', type: 'string' },
  ], {
    title: 'Key Cities / Location Clusters',
    grain: 'one row per ~25km location cluster',
    caveat: 'A cluster is people-group PINS (each marks a people group, not a town), not a settlement. place_name comes from a cited gazetteer (Nominatim/OSM, ODbL); an unnamed row is honest, not missing.',
    internet_caveat: 'Internet figures are NATIONAL. Per-city connectivity is not publicly available at this scale.',
  }, (r) => {
    const namedRows = r.filter((x) => x.named);
    if (namedRows.length < 200) throw new Error(`validation: only ${namedRows.length} named cities — expected the 277 population centres`);
  }));
}

// ASN holder strings are REGISTRY-formatted, not human names:
//   'AIRTEL TCHAD - AIRTEL TCHAD'                       (doubled)
//   'TELECOM-LA-AS-AP - Lao Telecom Communication, LTC' (handle prefix)
// A list view showing the raw string is technically correct and practically
// unreadable. So `operator` is CLEANED for reading and `operator_raw` keeps the
// exact registry value — the cleaned name is a label, the raw one is the fact.
function cleanOperator(name) {
  const s = String(name || '').trim();
  // RIPE genuinely publishes "-" as the holder name for some ASNs (measured: 5 rows,
  // AS37110/MOZ, AS7901/NZL, AS22354/TZA, AS36997/UGA, AS11157/ZAF). That is real
  // upstream absence, not a parse failure — but rendering "-" in an Operator column
  // reads as if the operator were NAMED "-". Say what is true instead: the name is
  // unknown. The honesty rule's own convention — 'unknown' is a STRING, never a
  // silent blank or a false value.
  if (!s || /^[-–—]+$/.test(s)) return 'unknown — no holder name published by the registry';
  if (!s.includes(' - ')) return s;
  const [left, right] = [s.slice(0, s.indexOf(' - ')).trim(), s.slice(s.indexOf(' - ') + 3).trim()];
  if (left.toLowerCase() === right.toLowerCase()) return left;
  // A registry HANDLE is all-caps with -AS/-AP style suffixes; prefer the human half.
  //
  // KNOWN LIMIT, left visible rather than hidden: some ASN records put a POSTAL
  // ADDRESS in the holder field. Measured: 'ROSHAN-AF - Main Street, House No. 13
  // Wazir Akbar' — the real carrier is Roshan, and the human half is its address.
  // A cleaner cannot reliably tell an address from a company name, so when the
  // right half LOOKS like an address we keep the handle instead: 'ROSHAN-AF' is
  // ugly but true, whereas 'Main Street, House No. 13' is confidently wrong.
  // Guessing the pretty answer is how a dataset starts lying.
  const looksLikeAddress = /\b(street|road|house no|floor|building|p\.?o\.? box|avenue|blvd|suite)\b/i.test(right);
  if (looksLikeAddress) return left;
  return (/^[A-Z0-9-]+$/.test(left) && right) ? right : left;
}

// ═══ TABLE 3 — NETWORK OPERATORS (ISPs + carriers, by name) ═════════════════
if (has('operators-by-country.json')) {
  const ops = read('operators-by-country.json');
  const rows = [];
  for (const c of Object.values(ops.countries)) {
    for (const o of (c.operators || [])) {
      rows.push({
        operator: cleanOperator(o.name),
        operator_raw: o.name,
        asn: o.asn,
        country_iso3: c.iso3,
        country_iso2: c.iso2,
        kind: o.kind,
        likely_carrier: o.kind !== 'unclassified',
        classification: o.classification_method,
        resolution: c.resolution,
        source: c.source,
      });
    }
  }
  if (rows.length) {
    built.push(emit('network-operators', rows, [
      { title: 'Operator', field: 'operator', type: 'string' },
      { title: 'Registry name', field: 'operator_raw', type: 'string' },
      { title: 'ASN', field: 'asn', type: 'string' },
      { title: 'Country', field: 'country_iso3', type: 'string' },
      { title: 'ISO2', field: 'country_iso2', type: 'string' },
      { title: 'Kind', field: 'kind', type: 'string' },
      { title: 'Likely carrier/ISP', field: 'likely_carrier', type: 'boolean' },
      { title: 'How classified', field: 'classification', type: 'string' },
      { title: 'Resolution', field: 'resolution', type: 'string' },
      { title: 'Source', field: 'source', type: 'string' },
    ], {
      title: 'Network Operators (ISPs + cell carriers)',
      grain: 'one row per ASN holder',
      caveat: 'An ASN holder announces IP space in that country. That set includes ISPs and carriers BUT ALSO banks, universities and hosting resellers. `kind` is a NAME-PATTERN HEURISTIC, not a verified classification.',
      resolution_caveat: 'ASN registration is NATIONAL. No public dataset maps operators to individual cities at this scale.',
      source: ops.source,
    }));
  }
}

// ═══ TABLE 4 — COUNTRY CONNECTIVITY ════════════════════════════════════════
if (has('connectivity-by-country.json')) {
  const conn = read('connectivity-by-country.json');
  const spine = has('city-candidates.json') ? read('city-candidates.json') : { clusters: [] };
  const byIso = {};
  for (const c of spine.clusters) {
    byIso[c.iso3] = byIso[c.iso3] || { groups: 0, clusters: 0, country: c.country, region: c.region };
    byIso[c.iso3].groups += c.people_group_count;
    byIso[c.iso3].clusters++;
  }
  const rows = Object.values(conn.countries).map((k) => {
    const s = byIso[k.iso3] || {};
    return {
      country: s.country || k.iso3,
      iso3: k.iso3,
      region: s.region || '',
      internet_access: k.internet_access,
      internet_pct: k.internet_pct,
      internet_year: k.internet_year || '',
      mobile_per_100: k.mobile_per_100,
      mobile_year: k.mobile_year || '',
      national_population: k.national_population,
      people_groups: s.groups || 0,
      locations: s.clusters || 0,
      censorship: k.censorship,
      resolution: k.resolution,
      banding: k.banding,
      source: k.source?.name || '',
    };
  }).sort((a, b) => b.people_groups - a.people_groups);

  built.push(emit('country-connectivity', rows, [
    { title: 'Country', field: 'country', type: 'string' },
    { title: 'ISO3', field: 'iso3', type: 'string' },
    { title: 'Region', field: 'region', type: 'string' },
    { title: 'Access', field: 'internet_access', type: 'string' },
    { title: 'Internet %', field: 'internet_pct', type: 'number' },
    { title: 'Year', field: 'internet_year', type: 'string' },
    { title: 'Mobile/100', field: 'mobile_per_100', type: 'number' },
    { title: 'Mobile year', field: 'mobile_year', type: 'string' },
    { title: 'National population', field: 'national_population', type: 'number' },
    { title: 'People groups', field: 'people_groups', type: 'number' },
    { title: 'Locations', field: 'locations', type: 'number' },
    { title: 'Censorship', field: 'censorship', type: 'string' },
    { title: 'Resolution', field: 'resolution', type: 'string' },
    { title: 'Source', field: 'source', type: 'string' },
  ], {
    title: 'Country Connectivity',
    grain: 'one row per country',
    caveat: 'National figures. `censorship` is `unknown` throughout — it lives in OONI / Access Now / Freedom on the Net reports that are not machine-readable per-country APIs, and approximating it would be a guess wearing a citation.',
    source: conn.source,
  }));
}

// ═══ TABLE 6 — SOCIAL PLATFORMS (where people actually are) ════════════════
// A people group with internet is reachable on SOME platform — but not the same
// one everywhere. Measured: Sudan is Twitter-dominant (50.6%), Laos YouTube
// (77.3%), Pakistan Facebook (91.7%), India Instagram (45.4%). Assuming a global
// default is how digital outreach misses an entire country.
if (has('social-platforms-by-country.json')) {
  const soc = read('social-platforms-by-country.json');
  const spine2 = has('city-candidates.json') ? read('city-candidates.json') : { clusters: [] };
  const groupsBy = {};
  for (const c of spine2.clusters) {
    groupsBy[c.iso3] = groupsBy[c.iso3] || { groups: 0, country: c.country, region: c.region };
    groupsBy[c.iso3].groups += c.people_group_count;
  }
  const rows = [];
  for (const c of Object.values(soc.countries)) {
    const g = groupsBy[c.iso3] || {};
    // One row per COUNTRY×PLATFORM — the grain that lets a list view sort
    // "where is YouTube dominant" without unpacking a nested array.
    for (const p of (c.platforms || [])) {
      rows.push({
        country: g.country || c.iso3,
        iso3: c.iso3,
        region: g.region || '',
        platform: p.name,
        share_pct: p.pct,
        is_top: p.name === c.top_platform,
        month: c.month || '',
        people_groups: g.groups || 0,
        messaging_apps: c.messaging_apps,
        resolution: c.resolution,
        source: c.source,
      });
    }
  }
  if (rows.length) {
    rows.sort((a, b) => b.people_groups - a.people_groups || b.share_pct - a.share_pct);
    built.push(emit('social-platforms', rows, [
      { title: 'Country', field: 'country', type: 'string' },
      { title: 'ISO3', field: 'iso3', type: 'string' },
      { title: 'Region', field: 'region', type: 'string' },
      { title: 'Platform', field: 'platform', type: 'string' },
      { title: 'Share %', field: 'share_pct', type: 'number' },
      { title: 'Dominant', field: 'is_top', type: 'boolean' },
      { title: 'Month', field: 'month', type: 'string' },
      { title: 'People groups', field: 'people_groups', type: 'number' },
      { title: 'Messaging apps', field: 'messaging_apps', type: 'string' },
      { title: 'Resolution', field: 'resolution', type: 'string' },
      { title: 'Source', field: 'source', type: 'string' },
    ], {
      title: 'Social Platforms by Country',
      grain: 'one row per country x platform',
      measures: 'share of page-view referrals among tracked social platforms',
      critical_caveat: 'MESSAGING APPS ARE NOT MEASURED. WhatsApp/Telegram/WeChat/Signal/Viber generate few web referrals but may be THE dominant channel in several of these countries. A low total here means little web-referral traffic, NOT that people are offline.',
      empty_month_note: 'The CURRENT month publishes as all-zeros before StatCounter finalises it; the parser walks BACK to the last month with real data and records which month that was.',
      source: soc.source,
    }, (r) => {
      const zero = r.filter((x) => x.share_pct === 0);
      if (zero.length) throw new Error(`validation: ${zero.length} rows with 0% share — the empty-month trap was not handled`);
    }));
  }
}

// The headline counts are COUNTED from the rows, never typed: a typed "54" stayed true only until
// the classifier changed. WhatsApp is its two apps (Messenger + Business) together.
function messagingWhy(rows) {
  const top = new Map();
  for (const r of rows) if (r.is_top_messaging) top.set(r.iso3, r.app);
  const count = (re) => [...top.values()].filter((a) => re.test(a)).length;
  return `Referral stats (StatCounter) structurally cannot see messaging apps. Measured here: WhatsApp (Messenger or Business) is the top messaging app in ${count(/whatsapp/i)} countries, Telegram in ${count(/telegram/i)} — neither appears in referral share at all.`;
}

// ═══ TABLE 7 — MESSAGING & APP CHANNELS (what referral stats cannot see) ═══
// StatCounter's ENTIRE tracked universe is Western referral platforms — measured:
// Facebook/Instagram/Twitter/YouTube/Pinterest/reddit/LinkedIn/Tumblr/HN/VK/Fark.
// It has NO WhatsApp, WeChat, Telegram, TikTok, LINE, Viber, imo or Zalo, because
// messaging apps generate almost no web referrals. Reading "Facebook 91.7%" as
// "this is where Pakistanis are" would be exactly wrong.
// The research looks beyond the typical Western social platforms.
if (has('top-apps-by-country.json')) {
  const apps = read('top-apps-by-country.json');
  const spine3 = has('city-candidates.json') ? read('city-candidates.json') : { clusters: [] };
  const g = {};
  for (const c of spine3.clusters) {
    g[c.iso3] = g[c.iso3] || { groups: 0, country: c.country, region: c.region };
    g[c.iso3].groups += c.people_group_count;
  }
  const rows = [];
  for (const c of Object.values(apps.countries)) {
    const meta = g[c.iso3] || {};
    // One row per COUNTRY x APP so a list view can sort "where does Telegram rank".
    // The kind is RE-DERIVED from the name with the shared classifier (app-kind.mjs), and the top
    // messaging app with it: the cached fetch may carry a kind from an older rule.
    const comms = (c.comms_apps || []).map((a) => ({ ...a, kind: classify(a.name) })).filter((a) => isComms(a.kind));
    const topMessaging = comms.slice().sort((x, y) => x.rank - y.rank).find((a) => a.kind === 'messaging')?.name || null;
    for (const a of comms) {
      rows.push({
        country: meta.country || c.iso3,
        iso3: c.iso3,
        region: meta.region || '',
        app: a.name,
        kind: a.kind,
        rank: a.rank,
        is_top_messaging: a.name === topMessaging,
        people_groups: meta.groups || 0,
        platform_bias: c.platform_bias,
        classification: c.classification_method,
        source: c.source,
      });
    }
  }
  if (rows.length) {
    rows.sort((a, b) => b.people_groups - a.people_groups || a.rank - b.rank);
    built.push(emit('messaging-channels', rows, [
      { title: 'Country', field: 'country', type: 'string' },
      { title: 'ISO3', field: 'iso3', type: 'string' },
      { title: 'Region', field: 'region', type: 'string' },
      { title: 'App', field: 'app', type: 'string' },
      { title: 'Kind', field: 'kind', type: 'string' },
      { title: 'Store rank', field: 'rank', type: 'number' },
      { title: 'Top messaging', field: 'is_top_messaging', type: 'boolean' },
      { title: 'People groups', field: 'people_groups', type: 'number' },
      { title: 'Platform bias', field: 'platform_bias', type: 'string' },
      { title: 'How classified', field: 'classification', type: 'string' },
      { title: 'Source', field: 'source', type: 'string' },
    ], {
      title: 'Messaging & App Channels',
      grain: 'one row per country x communication app',
      why: messagingWhy(rows),
      ios_caveat: 'iOS ONLY. Most of these countries are Android-majority and Google publishes no keyless equivalent, so this is one eye open. An app absent here is NOT absent in-country. 50 of 175 countries have no Apple storefront.',
      ranking_caveat: 'A top-free RANK is most-DOWNLOADED recently, not most-used.',
      classification_caveat: 'kind is a name-keyword HEURISTIC over a known list, not a verified taxonomy.',
      source: apps.source,
    }));
  }
}

// ═══ TABLE 8 — LANGUAGES BY COUNTRY, ranked, joined to resources ════════════
if (has('trade-languages-by-country.json')) {
  const tl = read('trade-languages-by-country.json');
  const rows = [];
  for (const c of tl.countries) {
    for (const [i, l] of (c.languages_ranked || []).entries()) {
      rows.push({
        country: c.country,
        iso3: c.iso3,
        language: l.label,
        iso639_3: l.iso639_3,
        prevalence_rank: i + 1,
        groups_speaking: l.groups,
        population: l.population,
        // A language spoken by >1 group crosses group boundaries in that country.
        bridge_candidate: l.groups > 1,
        has_scripture: !!l.has_scripture,
        full_bible: !!l.full_bible,
        has_film: !!l.has_film,
        carries_resource: !!l.carries_resource,
        country_people_groups: c.people_groups,
      });
    }
  }
  if (rows.length) {
    rows.sort((a, b) => b.country_people_groups - a.country_people_groups || a.prevalence_rank - b.prevalence_rank);
    built.push(emit('languages-by-country', rows, [
      { title: 'Country', field: 'country', type: 'string' },
      { title: 'ISO3', field: 'iso3', type: 'string' },
      { title: 'Language', field: 'language', type: 'string' },
      { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
      { title: 'Rank', field: 'prevalence_rank', type: 'number' },
      { title: 'Groups speaking', field: 'groups_speaking', type: 'number' },
      { title: 'Population', field: 'population', type: 'number' },
      { title: 'Bridge candidate', field: 'bridge_candidate', type: 'boolean' },
      { title: 'Scripture', field: 'has_scripture', type: 'boolean' },
      { title: 'Full Bible', field: 'full_bible', type: 'boolean' },
      { title: 'Film', field: 'has_film', type: 'boolean' },
      { title: 'Carries a resource', field: 'carries_resource', type: 'boolean' },
    ], {
      title: 'Languages by Country (ranked) x Resources',
      grain: 'one row per country x language',
      ranking: 'By how many DX people groups claim it as their PRIMARY language in that country.',
      bridge_caveat: 'bridge_candidate = primary to MORE THAN ONE group here. That is NOT a national trade language: a lingua franca no unengaged group claims as primary is invisible to this method (Urdu in Pakistan is the clearest case). See gaps-and-opportunities.bridge_strength before acting.',
      source: tl.stats,
    }));
  }
}

// ═══ TABLE 9 — LANGUAGES PER CITY x RESOURCES (the per-city half) ══════════
// The goal: trade languages for each country AND CITY, key languages ordered by
// prevalence, each mapped to gospel resources.
// The country-level view (TABLE 8) answers "what is spoken in this country".
// This answers the sharper question: AT THIS PLACE, which languages are spoken,
// and does each one already carry a resource — so a city can be read as reachable
// or not without aggregating up to its country.
//
// GRAIN is one row per LOCATION x LANGUAGE. 399 of 1,646 clusters are
// multi-language, which is exactly where a city-level bridge could exist that the
// country view averages away.
if (has('city-candidates.json') && has('language-resources.json')) {
  const spine4 = read('city-candidates.json');
  const lr = read('language-resources.json');
  const named4 = has('named-places.json') ? read('named-places.json').places : {};
  const byL = new Map();
  for (const l of lr.languages) byL.set((l.language || '').toLowerCase(), l);
  // languages on a cluster are LABELS; language-resources is keyed by iso639_3, so
  // match on the label and record when it does not resolve rather than dropping it.
  const rows = [];
  for (const c of spine4.clusters) {
    const n = named4[c.cluster_id] || {};
    const langs = c.languages || [];
    for (const [i, label] of langs.entries()) {
      const L = byL.get(String(label).toLowerCase());
      rows.push({
        place_name: n.place_name || '',
        country: c.country,
        iso3: c.iso3,
        region: c.region,
        lat: c.lat,
        lng: c.lng,
        language: label,
        iso639_3: L ? L.iso639_3 : '',
        // Order within THIS place, by how the cluster lists them.
        rank_in_place: i + 1,
        languages_here: langs.length,
        people_groups_here: c.people_group_count,
        upg_population: c.upg_population_sum,
        has_scripture: L ? !!L.has_scripture : false,
        has_film: L ? !!L.has_film : false,
        carries_resource: L ? !!(L.has_scripture || L.has_film) : false,
        // Explicit third state: a label that did not resolve is NOT a language
        // without resources — it is a language we could not look up.
        resolved: !!L,
        note: L ? '' : 'language label did not resolve to an ISO 639-3 record — status UNKNOWN, not absent',
      });
    }
  }
  if (rows.length) {
    rows.sort((a, b) => b.people_groups_here - a.people_groups_here || a.rank_in_place - b.rank_in_place);
    built.push(emit('languages-per-city', rows, [
      { title: 'Place', field: 'place_name', type: 'string' },
      { title: 'Country', field: 'country', type: 'string' },
      { title: 'Region', field: 'region', type: 'string' },
      { title: 'Language', field: 'language', type: 'string' },
      { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
      { title: 'Rank here', field: 'rank_in_place', type: 'number' },
      { title: 'Languages here', field: 'languages_here', type: 'number' },
      { title: 'People groups here', field: 'people_groups_here', type: 'number' },
      { title: 'UPG population', field: 'upg_population', type: 'number' },
      { title: 'Scripture', field: 'has_scripture', type: 'boolean' },
      { title: 'Film', field: 'has_film', type: 'boolean' },
      { title: 'Carries a resource', field: 'carries_resource', type: 'boolean' },
      { title: 'Resolved', field: 'resolved', type: 'boolean' },
      { title: 'Note', field: 'note', type: 'string' },
      { title: 'Lat', field: 'lat', type: 'number' },
      { title: 'Lng', field: 'lng', type: 'number' },
    ], {
      title: 'Languages per City x Resources',
      grain: 'one row per location cluster x language spoken there',
      why: '399 of 1,646 clusters are multi-language — a city-level bridge can exist that a country average hides.',
      place_caveat: 'A location is a cluster of people-group pins within ~25km, NOT a municipal boundary. An empty place_name is an unnamed cluster, never an invented one.',
      resolution_caveat: 'resolved:false means the language LABEL did not match an ISO 639-3 record here — its resource status is UNKNOWN, not absent.',
      pools_caveat: 'Resource status is from eBible + JESUS Film only. GRN and FCBH audio are key-blocked.',
    }, (r) => {
      const unres = r.filter((x) => !x.resolved).length;
      if (unres === r.length) throw new Error('validation: NO language label resolved — the label join is broken');
    }));
  }
}

// ═══ TABLE 10 — CITY BRIDGE OPPORTUNITIES (the actionable shortlist) ═══════
// The sharpest output of the whole corpus, promoted out of the 1,866-row per-city
// table so it is not buried: places where a people group's OWN language carries
// nothing, but ANOTHER language spoken in that same ~25km cluster already does.
//
// Measured: 30 such places. Coimbatore — Muthuvan has nothing, Tamil is right
// there. Port Blair — Andaman Hindi Creole -> Telugu. Jinghong — Kon Keu -> Hani.
//
// WHY IT IS NOT VISIBLE ANYWHERE ELSE: a country-level view averages this away.
// 399 of 1,646 clusters are multi-language, and the bridge exists at CITY scale.
//
// HONEST LIMIT, in every row: co-location inside a 25km cluster is NOT proof the
// group speaks the neighbouring language. This is a LEAD TO VERIFY, not a route to
// assume — which is why the column is named `lead`, not `route`.
if (existsSync(join(TABLES, 'languages-per-city.json'))) {
  const lpc = JSON.parse(readFileSync(join(TABLES, 'languages-per-city.json'), 'utf8'));
  const byPlace = new Map();
  for (const r of lpc.rows) {
    const k = `${r.lat},${r.lng}`;
    if (!byPlace.has(k)) byPlace.set(k, []);
    byPlace.get(k).push(r);
  }
  const rows = [];
  for (const [, v] of byPlace) {
    const top = v[0];
    if (!top || top.carries_resource) continue;          // top language already served
    // A SIGN LANGUAGE CANNOT BRIDGE TO A SPOKEN ONE. Caught before shipping:
    // 'Yemeni Sign Language -> Hebrew (modern)' and 'Angolan Sign Language ->
    // Portuguese'. Scripture text and audio do not reach a Deaf community through
    // a spoken language; the bridge for a sign language is ANOTHER SIGN LANGUAGE.
    // Presenting those as opportunities would misdirect effort away from the
    // population most likely to be overlooked — so they are excluded here and
    // surfaced as their own category instead.
    const isSign = (x) => /\bsign language\b/i.test(x.language || '');
    const bridge = v.find((x) => x !== top && x.carries_resource && isSign(x) === isSign(top));
    if (!bridge) continue;                                // nothing here to bridge to
    rows.push({
      place_name: top.place_name || '',
      country: top.country,
      region: top.region,
      lat: top.lat,
      lng: top.lng,
      primary_language: top.language,
      primary_iso639_3: top.iso639_3,
      primary_has_scripture: top.has_scripture,
      primary_has_film: top.has_film,
      bridge_language: bridge.language,
      bridge_iso639_3: bridge.iso639_3,
      bridge_has_scripture: bridge.has_scripture,
      bridge_has_film: bridge.has_film,
      languages_here: v.length,
      people_groups_here: top.people_groups_here,
      upg_population: top.upg_population,
      lead: 'co-located within ~25km — VERIFY that this group speaks the bridge language before acting',
    });
  }
  if (rows.length) {
    rows.sort((a, b) => b.upg_population - a.upg_population);
    built.push(emit('city-bridge-opportunities', rows, [
      { title: 'Place', field: 'place_name', type: 'string' },
      { title: 'Country', field: 'country', type: 'string' },
      { title: 'Region', field: 'region', type: 'string' },
      { title: 'Their language', field: 'primary_language', type: 'string' },
      { title: 'ISO', field: 'primary_iso639_3', type: 'string' },
      { title: 'Bridge language', field: 'bridge_language', type: 'string' },
      { title: 'Bridge ISO', field: 'bridge_iso639_3', type: 'string' },
      { title: 'Bridge scripture', field: 'bridge_has_scripture', type: 'boolean' },
      { title: 'Bridge film', field: 'bridge_has_film', type: 'boolean' },
      { title: 'Languages here', field: 'languages_here', type: 'number' },
      { title: 'People groups here', field: 'people_groups_here', type: 'number' },
      { title: 'UPG population', field: 'upg_population', type: 'number' },
      { title: 'Lead status', field: 'lead', type: 'string' },
    ], {
      title: 'City Bridge Opportunities',
      grain: 'one row per location where a co-located language already carries a resource',
      the_finding: 'A people group whose own language has nothing, in a place where another spoken language already has scripture or film. Reachable with what exists TODAY.',
      why_only_here: 'A country-level average hides this. The bridge exists at CITY scale — 399 of 1,646 clusters are multi-language.',
      sign_language_rule: 'A SIGN language is only ever bridged by another SIGN language. Two rows were excluded for this (Yemeni Sign Language -> Hebrew, Angolan Sign Language -> Portuguese): text and audio do not reach a Deaf community through a spoken language, and offering them as opportunities would misdirect effort away from the population most likely to be missed. Sign languages appear in the DEAF GAP list instead.',
      hard_caveat: 'CO-LOCATION IS NOT COMPREHENSION. Sharing a 25km cluster does not prove this group speaks that language. Every row is a LEAD TO VERIFY, never a route to assume.',
      pools_caveat: 'Resource status is eBible + JESUS Film only; GRN and FCBH audio are key-blocked.',
    }, (r) => {
      const bad = r.find((x) => x.primary_has_scripture || x.primary_has_film);
      if (bad) throw new Error('validation: a row whose primary language ALREADY has a resource is not an opportunity');
    }));
  }
}

// ═══ TABLE 11 — THE DEAF GAP ═══════════════════════════════════════════════
// Surfaced because the city-bridge work exposed it: two rows tried to bridge a
// Deaf community to a SPOKEN language, and excluding them raised the question of
// how large this population actually is.
//
// MEASURED: 73 sign languages across 120 DX people groups, 19.35M people.
// 68 languages / 90 groups / 17.53M people have NOTHING found in the pools checked.
// And 31 carry PRIVATE-USE (q*) codes that are outside ISO 639-3 entirely, so no
// resource pool can index them — their status is not "absent", it is UNLOOKUPABLE.
//
// This is the largest structurally-invisible bloc in the corpus, and it is invisible
// for a compounding reason: a sign language cannot be reached by a text or audio
// resource in a spoken language, AND a third of them cannot even be queried. A
// dataset that quietly folds them into "no resource found" hides both facts.
if (has('language-resources.json')) {
  const lr2 = read('language-resources.json');
  const sign = lr2.languages.filter((l) => /\bsign language\b/i.test(l.language || ''));
  const rows = [];
  for (const l of sign) {
    for (const pg of l.people_groups) {
      rows.push({
        people_group: pg,
        sign_language: l.language,
        iso639_3: l.iso639_3,
        countries: (l.countries || []).join(', '),
        population: l.population,
        has_scripture: !!l.has_scripture,
        has_film: !!l.has_film,
        has_any: !!(l.has_scripture || l.has_film),
        // The compounding problem: a private-use code cannot be looked up at all.
        code_unmatchable: !!l.code_unmatchable,
        status: l.code_unmatchable
          ? 'UNLOOKUPABLE — private-use code outside ISO 639-3; no pool can index it'
          : (l.has_scripture || l.has_film) ? 'has a resource'
          : 'nothing found in the pools checked',
        bridge_rule: 'A sign language is bridged ONLY by another sign language. Text and audio in a spoken language do not reach a Deaf community.',
      });
    }
  }
  if (rows.length) {
    rows.sort((a, b) => (a.has_any === b.has_any ? b.population - a.population : (a.has_any ? 1 : -1)));
    built.push(emit('deaf-gap', rows, [
      { title: 'People Group', field: 'people_group', type: 'string' },
      { title: 'Sign language', field: 'sign_language', type: 'string' },
      { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
      { title: 'Countries', field: 'countries', type: 'string' },
      { title: 'Population', field: 'population', type: 'number' },
      { title: 'Scripture', field: 'has_scripture', type: 'boolean' },
      { title: 'Film', field: 'has_film', type: 'boolean' },
      { title: 'Has anything', field: 'has_any', type: 'boolean' },
      { title: 'Code unlookupable', field: 'code_unmatchable', type: 'boolean' },
      { title: 'Status', field: 'status', type: 'string' },
      { title: 'Bridge rule', field: 'bridge_rule', type: 'string' },
    ], {
      title: 'The Deaf Gap',
      grain: 'one row per Deaf people group',
      measured: '73 sign languages · 120 people groups · 19.35M people. 68 languages / 90 groups / 17.53M with NOTHING found.',
      compounding_problem: '31 of these carry PRIVATE-USE (q*) codes outside ISO 639-3. No resource pool indexes a private code, so their status is UNLOOKUPABLE — not measured absence. Folding them into "no resource" hides that the query itself is impossible.',
      bridge_rule: 'A sign language is bridged ONLY by another sign language. This is why Deaf groups are excluded from city-bridge-opportunities rather than matched to a co-located spoken language.',
      pools_caveat: 'eBible + JESUS Film only. GRN and FCBH audio are key-blocked — and audio would not serve this population regardless.',
    }));
  }
}

// ═══ TABLE 16 — OPEN DOORS: is the PATH clear, not just the SUPPLY present ══
// THE PROBLEM THIS ANSWERS (the-way-truth-life-problem.md):
// Every other table in this corpus answers a SUPPLY question — does a resource
// exist, is there internet, which platform is popular. NONE answers the PATH
// question the mission is actually for: could a person in this place reach the
// gospel in their own language TODAY?
//
// A path needs THREE legs joined, which until now sat in three separate tables:
//   1. a resource EXISTS in their language      (gospel-access-vs-growth)
//   2. the country can reach the network         (internet-by-country)
//   3. the channel is not WALLED OFF             (platform-reachability)
//
// There is a FOURTH leg — is anyone there — and it is deliberately ABSENT and must
// stay absent. NEVER-DO #6: pin resource AVAILABILITY, never believer/church/
// meeting-point locations. So this table can never say "who will go". It says only
// WHERE THE PATH IS ALREADY OPEN, which is the honest and safe half of the question.
//
// NO NEW RESEARCH. This is a DERIVATION over tables already built and already
// verified — which is why it can be trusted at all.
{
  const spine = JSON.parse(readFileSync(join(TABLES, 'gospel-access-vs-growth.json'), 'utf8')).rows;
  const reachRows = JSON.parse(readFileSync(join(TABLES, 'platform-reachability.json'), 'utf8')).rows;
  const inet = JSON.parse(readFileSync(join(OUT, 'connectivity-by-country.json'), 'utf8')).countries || {};

  // Reachability, collapsed per country: how many platforms are usable at all.
  // 'accessible' and 'interference-suspected' count as reachable-with-friction;
  // 'blocked' / 'interference-widespread' do not. 'not-measured' is counted
  // SEPARATELY and never as either — absence of measurement is not accessibility.
  const byCountry = {};
  for (const r of reachRows) {
    const b = byCountry[r.iso3] || (byCountry[r.iso3] = { open: [], shut: [], unmeasured: 0 });
    if (r.status === 'accessible' || r.status === 'interference-suspected') b.open.push(r.platform);
    else if (r.status === 'not-measured') b.unmeasured += 1;
    else b.shut.push(r.platform);
  }

  const rows = spine.map((r) => {
    const c = byCountry[r.iso3] || { open: [], shut: [], unmeasured: 0 };
    const net = inet[r.iso3] || {};
    const hasResource = String(r.has_scripture) === 'true' || String(r.has_scripture) === 'True'
      || String(r.has_film) === 'true' || String(r.has_film) === 'True';
    const netBand = net.band || net.internet_access || 'unknown';
    const netOk = netBand === 'yes' || netBand === 'partial';
    const channelOpen = c.open.length > 0;

    // THE VERDICT — deliberately NOT a boolean. Each value names WHICH LEG fails,
    // because "closed" for three different reasons needs three different responses:
    // a translation, a distribution route, or neither.
    // NO MEASUREMENT IS NOT A FINDING. If every platform in this country is
    // 'not-measured', channelOpen is false for a reason that has NOTHING to do with
    // censorship — OONI simply has no volunteer probe there. My first version called
    // that 'resource-exists-channel-shut' (a DISTRIBUTION problem) for all 15 rows
    // it produced, every one of them shut=0 / unmeasured=15: Eritrea, Western
    // Sahara, Palau, Niue, Tokelau. That is absence dressed as a finding — the same
    // class this corpus keeps catching — and it would have sent someone chasing a
    // censorship problem that was never measured. Unmeasured gets its OWN verdict.
    const noChannelData = c.open.length === 0 && c.shut.length === 0;
    let verdict, action;
    if (noChannelData) {
      verdict = 'channel-UNMEASURED';
      action = hasResource
        ? 'A resource exists, but NO platform reachability was measured here (no OONI probe coverage). This is an UNKNOWN, not a blockage — do not read it as censorship.'
        : 'No resource found AND no channel data. Both legs unknown; treat as unassessed, not as closed.';
    } else if (!hasResource && !channelOpen) {
      verdict = 'no-resource-and-no-channel';
      action = 'Lowest immediate leverage: a translation here would land where nothing can carry it. Fund the channel question first, or reach by non-internet means.';
    } else if (!hasResource) {
      verdict = 'channel-open-no-resource';
      action = 'HIGHEST TRANSLATION LEVERAGE: the road is open and there is nothing to send. A resource made here can actually arrive.';
    } else if (!channelOpen) {
      verdict = 'resource-exists-channel-shut';
      action = 'NOT a translation problem — a DISTRIBUTION problem. The work is done and cannot travel. Different ask entirely.';
    } else if (!netOk) {
      verdict = 'resource-and-channel-but-network-poor';
      action = 'Resource and platforms exist; national connectivity is the constraint. Offline/physical distribution may beat digital here.';
    } else {
      verdict = 'path-open';
      action = 'Resource exists in-language, network reachable, at least one channel open. The road is clear — this says NOTHING about whether anyone has walked it.';
    }

    return {
      people_group: r.people_group,
      language: r.language,
      iso639_3: r.iso639_3,
      country: r.country,
      iso3: r.iso3,
      region: '',
      population: r.population,
      verdict,
      // The three legs, each auditable on its own so a reader can see WHY.
      leg1_resource_exists: hasResource,
      leg2_network_band: netBand,
      leg3_channels_open: c.open.length,
      channels_shut: c.shut.length,
      channels_not_measured: c.unmeasured,
      open_channels: c.open.slice(0, 6).join(', '),
      shut_channels: c.shut.slice(0, 6).join(', '),
      est_deaths_per_day: r.est_deaths_per_day,
      growing_without_resource: r.growing_without_resource,
      action,
      // THE BOUNDARY, on every row, so it cannot be quoted out of context.
      what_this_does_NOT_say: 'This is a SUPPLY-and-ROUTE reading only. It never indicates believers, churches, meeting points, or that anyone has received anything. path-open means a route is technically clear, NOT that the gospel has arrived.',
      confidence_note: c.unmeasured > 0 ? `${c.unmeasured} of 15 platforms UNMEASURED here — verdict rests on partial channel data` : 'all 15 platforms measured',
      source: 'DERIVED — gospel-access-vs-growth + platform-reachability + connectivity-by-country. No new research.',
    };
  });

  // Rank by the thing that most deserves attention: an open road with nothing on it,
  // weighted by how many die daily. NOT by population — the mission is about reach.
  const order = { 'channel-open-no-resource': 0, 'resource-exists-channel-shut': 1, 'no-resource-and-no-channel': 2, 'resource-and-channel-but-network-poor': 3, 'channel-UNMEASURED': 4, 'path-open': 5 };
  rows.sort((a, b) => (order[a.verdict] - order[b.verdict])
    || (Number(b.est_deaths_per_day) || 0) - (Number(a.est_deaths_per_day) || 0));

  built.push(emit('open-doors', rows, [
    { title: 'People group', field: 'people_group', type: 'string' },
    { title: 'Language', field: 'language', type: 'string' },
    { title: 'Country', field: 'country', type: 'string' },
    { title: 'Verdict', field: 'verdict', type: 'string' },
    { title: 'Resource?', field: 'leg1_resource_exists', type: 'string' },
    { title: 'Network', field: 'leg2_network_band', type: 'string' },
    { title: 'Channels open', field: 'leg3_channels_open', type: 'number' },
    { title: 'Deaths/day', field: 'est_deaths_per_day', type: 'number' },
    { title: 'Population', field: 'population', type: 'number' },
  ], {
    title: 'Open Doors — where the path is clear, and where it is not',
    grain: 'one row per people group x country',
    the_question: 'Every other table answers SUPPLY (does a resource exist, is there internet). This answers ROUTE: could a person here reach the gospel in their own language today?',
    boundary: 'This table records resource AVAILABILITY and network ROUTE only. It never indicates believers, churches or meeting points, and path-open never means the gospel has arrived.',
    verdicts: 'channel-open-no-resource (highest translation leverage) · resource-exists-channel-shut (a DISTRIBUTION problem, not a translation one) · no-resource-and-no-channel · resource-and-channel-but-network-poor · channel-UNMEASURED (no probe coverage — an UNKNOWN, never read as censorship) · path-open.',
    honesty: 'not-measured platforms are counted SEPARATELY and never as open or shut. Rows carry channels_not_measured + a confidence_note so a verdict resting on partial data says so.',
    derived_from: 'gospel-access-vs-growth + platform-reachability + connectivity-by-country. NO new research — a join over already-verified tables.',
  }, (r) => {
    const bad = r.filter((x) => !x.verdict);
    if (bad.length) throw new Error(`validation: ${bad.length} rows with no verdict`);
    const leak = r.filter((x) => /believer|church|congregation|meeting.?point/i.test(JSON.stringify(x).replace(/what_this_does_NOT_say":"[^"]*"/, '')));
    if (leak.length) throw new Error(`SAFETY: ${leak.length} rows mention believer/church/meeting-point data`);
  }));
}

// ═══ TABLE 15 — KEY CITIES UNDER ADMIN-N (the derivation, honestly tiered) ══
// Phase 2: "under admin-n, derive CITIES -> KEY CITIES (pin-density, online-
// reference cross-check, long-running verify -> a VERIFIED key-cities list).
// Cities that have no polygon get a CUSTOM CITY PIN so they're visually distinct."
//
// WHAT 'VERIFIED' CAN AND CANNOT MEAN TODAY — this is the load-bearing honesty.
// Every named place has exactly ONE name source (Nominatim/OSM). A single source
// cannot cross-check itself, so NOTHING here may be called "cross-referenced".
// Instead each row carries an explicit verification_tier naming what was actually
// established, and the highest tier available today is 'gazetteer-named'. Claiming
// a verified list on one source would be the confident-wrong failure this corpus
// keeps catching.
{
  const src = JSON.parse(readFileSync(join(TABLES, 'key-cities.json'), 'utf8')).rows;
  const named = src.filter((r) => r.place_name);

  // PIN DENSITY is the one derivation signal we genuinely have: how many distinct
  // people groups cluster at this place. It is a real, computed measure — not a
  // proxy for importance, and the caveat says so.
  const counts = named.map((r) => Number(r.people_group_count) || 0).sort((a, b) => b - a);
  const p90 = counts[Math.floor(counts.length * 0.10)] || 0;
  const p75 = counts[Math.floor(counts.length * 0.25)] || 0;

  const rows = named.map((r) => {
    const g = Number(r.people_group_count) || 0;
    // KEY-ness is a BAND over pin density, computed from this corpus's own
    // distribution rather than an invented absolute threshold.
    const key_tier = g >= p90 ? 'key-high' : g >= p75 ? 'key' : 'candidate';
    // ADMIN-N: admin_state is the sub-country unit OSM reports. 276 of 277 named
    // places carry one. Whether that unit is a State, Province, Wilayat or Region
    // is country-specific — geoBoundaries' boundaryCanonical names it, and that
    // lookup is a separate (already-researched) step, so the level is labelled
    // GENERICALLY here rather than mislabelled 'province' for everyone.
    return {
      place_name: r.place_name,
      place_type: r.place_type,
      admin_n: r.admin_state || '',
      admin_n_level: r.admin_state ? 'ADM1-equivalent (country-specific name — see boundaryCanonical)' : 'none reported',
      country: r.country,
      iso3: r.iso3,
      region: r.region,
      lat: r.lat,
      lng: r.lng,
      people_group_count: g,
      upg_population: r.upg_population,
      languages: r.languages,
      key_tier,
      // THE CUSTOM CITY PIN the phase asks for: a place with no polygon must render
      // visually DISTINCT from a people-group pin. We hold no city polygons (ADM2 is
      // 7.6MB for India alone and stays API-on-demand), so EVERY row is pin-rendered.
      render_hint: 'city-pin-star',
      has_polygon: false,
      polygon_note: 'No city polygon shipped — ADM2 is fetched per-country on demand (India ADM2 alone = 7.6MB simplified). Render as a STAR pin, distinct from people-group pins.',
      verification_tier: 'gazetteer-named',
      verification_meaning: 'Name resolved from a CITED gazetteer (Nominatim/OSM) at these coordinates. NOT cross-referenced against a second independent source — only one name source exists in this corpus, and a single source cannot cross-check itself.',
      country_internet_pct: r.country_internet_pct,
      internet_resolution: r.internet_resolution,
      name_source: r.name_source,
      name_licence: r.name_licence,
    };
  }).sort((a, b) => b.people_group_count - a.people_group_count);

  built.push(emit('key-cities-admin-n', rows, [
    { title: 'Place', field: 'place_name', type: 'string' },
    { title: 'Admin-n', field: 'admin_n', type: 'string' },
    { title: 'Country', field: 'country', type: 'string' },
    { title: 'Key tier', field: 'key_tier', type: 'string' },
    { title: 'People groups', field: 'people_group_count', type: 'number' },
    { title: 'UPG population', field: 'upg_population', type: 'number' },
    { title: 'Type', field: 'place_type', type: 'string' },
    { title: 'Verification', field: 'verification_tier', type: 'string' },
    { title: 'Region', field: 'region', type: 'string' },
  ], {
    title: 'Key Cities under Admin-N',
    grain: 'one row per NAMED location cluster, with its sub-country admin unit',
    derivation: `key_tier is a band over PIN DENSITY computed from this corpus: key-high >= ${p90} groups (top decile), key >= ${p75} (top quartile), else candidate.`,
    verification_limit: 'Place names are single-source: Nominatim/OSM, not cross-checked against a second gazetteer. verification_tier says exactly what was established.',
    admin_n_note: 'admin_n is the sub-country unit OSM reports (276 of 277 named places have one, 81 distinct values). What that level is CALLED varies by country — geoBoundaries boundaryCanonical gives the native term (State/Union Territory, Province, Wilayat, Region...). Not mislabelled "province" for everyone.',
    rendering: 'No city polygons are shipped; every row renders as a STAR pin, visually distinct from people-group pins.',
    source: 'Nominatim/OpenStreetMap (ODbL 1.0) for names; people-group counts from the DX spine.',
  }, (r) => {
    const bad = r.filter((x) => x.verification_tier !== 'gazetteer-named');
    if (bad.length) throw new Error(`validation: ${bad.length} rows claim a verification tier this corpus cannot support`);
    const nogeo = r.filter((x) => !Number.isFinite(Number(x.lat)) || !Number.isFinite(Number(x.lng)));
    if (nogeo.length) throw new Error(`validation: ${nogeo.length} rows lack usable coordinates`);
  }));
}

// ═══ TABLE 14 — PLATFORM REACHABILITY: is it walled off, or open here? ═════
// Beyond social platforms, the top websites and messaging apps (WeChat, WhatsApp, …)
// are tracked for whether each is closed off or globally accessible.
//
// This is the ONLY table that answers REACHABILITY. social-platforms answers
// POPULARITY (StatCounter web referrals — WhatsApp/WeChat are invisible to it) and
// messaging-channels answers iOS DOWNLOAD RANK. Neither can say whether a platform
// is blocked, which is the question that decides whether a channel is usable at all.
{
  const f = join(OUT, 'reachability-by-country.json');
  if (!existsSync(f)) {
    console.log('[tables] SKIP platform-reachability — run fetch-reachability.mjs first');
  } else {
    const reach = JSON.parse(readFileSync(f, 'utf8')).countries || {};
    // Build country metadata LOCALLY, from the same spine, rather than from a later declaration: an earlier
    // version read one and threw a temporal-dead-zone ReferenceError on its first run.
    const spineR = JSON.parse(readFileSync(join(OUT, 'city-candidates.json'), 'utf8'));
    const groups = {};
    for (const c of spineR.clusters) {
      groups[c.iso3] = groups[c.iso3] || { g: 0, country: c.country, region: c.region };
      groups[c.iso3].g += c.people_group_count;
    }
    const rows = [];
    for (const [iso3, c] of Object.entries(reach)) {
      const meta = groups[iso3] || {};
      for (const [platform, p] of Object.entries(c.platforms || {})) {
        rows.push({
          country: meta.country || iso3,
          iso3,
          region: meta.region || '',
          platform,
          status: p.status,
          measurements: p.measurements || 0,
          confirmed_blocked: p.confirmed_blocked ?? null,
          block_pct: p.block_pct ?? null,
          // anomaly is kept as its OWN column and never folded into block_pct.
          // CHINA is the proof: YouTube 84.9% anomaly with ZERO confirmed, because
          // the Great Firewall resets TCP / poisons DNS rather than serving a block
          // page. Reading "0 confirmed" as "not blocked" would be exactly wrong on
          // the largest censored population in this corpus.
          anomaly: p.anomaly ?? null,
          anomaly_pct: p.anomaly_pct ?? null,
          people_groups: meta.g || 0,
          probe_coverage: c.probe_coverage,
          domains_measured: (p.domains || []).join(', '),
          absence_meaning: p.absence_meaning || '',
          window: c.window,
          source: c.source,
        });
      }
    }
    rows.sort((a, b) => (b.confirmed_blocked || 0) - (a.confirmed_blocked || 0));
    built.push(emit('platform-reachability', rows, [
      { title: 'Country', field: 'country', type: 'string' },
      { title: 'Platform', field: 'platform', type: 'string' },
      { title: 'Status', field: 'status', type: 'string' },
      { title: 'Blocked %', field: 'block_pct', type: 'number' },
      { title: 'Anomaly %', field: 'anomaly_pct', type: 'number' },
      { title: 'Measurements', field: 'measurements', type: 'number' },
      { title: 'People groups', field: 'people_groups', type: 'number' },
      { title: 'Probe coverage', field: 'probe_coverage', type: 'string' },
      { title: 'Region', field: 'region', type: 'string' },
    ], {
      title: 'Platform Reachability — blocked or open?',
      grain: 'one row per country x platform',
      status_scale: 'accessible < interference-suspected (>=30% anomaly) < interference-widespread (>=70% anomaly) < partially-blocked (>=5% confirmed) < blocked (>=20% confirmed). not-measured is a STRING and is NOT evidence of accessibility.',
      hard_caveat: 'OONI runs on VOLUNTEER PROBES: coverage is uneven and NOT population-weighted. confirmed = proven blocked; anomaly = PROBABLE interference. They are never summed.',
      safety: 'NETWORK data only. It says what a network does, NEVER who used what. Must not be joined to anything identifying a person or a fellowship.',
      source: 'OONI — Open Observatory of Network Interference (api.ooni.io, open, no key)',
    }, (r) => {
      const bad = r.filter((x) => x.status === 'not-measured' && x.measurements > 0);
      if (bad.length) throw new Error(`validation: ${bad.length} not-measured rows carry measurements`);
    }));
  }
}

// ── Distribute to the apps that read them ───────────────────────────────────
const ROUTE = {
  'people-group-resources': 'gospel-resources',
  'gospel-access-vs-growth': 'gospel-resources',
  'key-cities': 'cities-internet',
  'network-operators': 'cities-internet',
  'country-connectivity': 'cities-internet',
  'social-platforms': 'cities-internet',
  'messaging-channels': 'cities-internet',
  'languages-by-country': 'gospel-resources',
  'languages-per-city': 'key-cities',
  'city-bridge-opportunities': 'gospel-resources',
  'deaf-gap': 'gospel-resources',
};
for (const b of built) {
  const app = ROUTE[b.name];
  if (!app) continue;
  const dir = join(PROFILES, app, 'data', 'tables');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${b.name}.json`), readFileSync(join(TABLES, `${b.name}.json`)));
}

// DECLARE TABLES WRITTEN BY OTHER SCRIPTS TOO. index.json is the completeness
// contract, but only THIS script writes it — so a table produced elsewhere was
// silently absent from it. gaps-and-opportunities.json (2,106 rows, written by
// build-trade-languages.mjs) shipped this whole flight undeclared, which put it
// outside every completeness check and made the headline count wrong in every
// summary. Two producers, one index: the index has to cover both, or the contract
// only describes part of the corpus.
const EXTERNAL = ['gaps-and-opportunities'];
for (const name of EXTERNAL) {
  const f = join(TABLES, `${name}.json`);
  if (!existsSync(f)) { console.error(`[tables] WARNING: ${name}.json not found — run build-trade-languages.mjs`); continue; }
  const rows = (JSON.parse(readFileSync(f, 'utf8')).rows || []).length;
  if (!built.some((b) => b.name === name)) built.push({ name, rows });
}

writeFileSync(join(TABLES, 'index.json'), JSON.stringify({
  generated: '2026-08-01',
  method: 'extracted from the cited sources, then modelled and validated into one table per question',
  tables: built.filter((b) => !b.private),
}, null, 1));

console.log(`\n[tables] ${built.length} tables, ${built.reduce((n, b) => n + b.rows, 0)} rows total`);
console.log('[tables] all assertions passed');
