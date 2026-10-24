// build-language-resources.mjs — the LANGUAGE → GOSPEL-RESOURCE map.
//
//   node build-language-resources.mjs
//     -> out/language-resources.json          (per ISO 639-3 language)
//     -> ../../plugin-designs/gospel-resources/data/resources.json  (the app's source)
//
// ═══ WHAT THIS ANSWERS ══════════════════════════════════════════════════════
// "Which of the DX people groups have scripture in their own language, and which
// have NONE?" The zero-resource groups are the priority signal the GRN corpus
// names as its goal.
//
// SOURCE: eBible.org translations.csv — 1,549 scripture translations keyed by
// ISO 639-3, with OT/NT book+chapter+verse counts, copyright, and a publication
// URL per row. PUBLIC, no key, no account.
//
// WHY NOT GRN: the GRN API requires a key we do not have (every endpoint returns
// {"data":[],"meta":{"error":"Key required..."}}), and their website blocks
// automated access sitewide behind a proof-of-work challenge while robots.txt
// disallows /*/search/. See BLOCKER-grn-api-key.md. GRN would ADD audio + film;
// eBible gives SCRIPTURE now, without a credential.
//
// THE JOIN IS EXACT, NOT FUZZY. DX people-group records already carry
// `primary_language` as an ISO 639-3 code (verified: 'abf', 'apd', 'tel' — 862
// distinct codes across 2,106 records). eBible's `languageCode` is the same
// standard. So this is a code-to-code join with no name matching and no
// heuristics — name matching across scripts and transliterations is exactly where
// a resource map would silently mis-attribute scripture to the wrong people.
//
// ═══ WHAT THIS DELIBERATELY DOES NOT CONTAIN ════════════════════════════════
// No church, believer, meeting-point or fellowship data of any kind. This maps
// PUBLISHED RESOURCE AVAILABILITY per language — "does a translation exist" — which
// is public bibliographic fact. It must never gain a field describing where
// Christians are. (A standing boundary since 2026-08-01.)
//
// HONESTY RULE: a language absent from eBible is recorded `has_scripture:false`
// with `checked_pools:['ebible']`. That means "not found in the pools we checked",
// NOT "no scripture exists anywhere" — other pools (GRN, Wycliffe, DBL, national
// Bible societies) are unchecked. The distinction is stated in every row so a
// reader cannot mistake an unchecked gap for a proven absence.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const RECORDS = resolve(__dirname, '..', 'posters', 'out', '_records.json');
const EBIBLE = join(OUT, 'ebible-translations.csv');
const APPDATA = resolve(__dirname, '..', '..', '..', 'plugin-designs', 'gospel-resources', 'data');

const POOLS = [{
  id: 'ebible',
  name: 'eBible.org',
  url: 'https://ebible.org/Scriptures/translations.csv',
  covers: 'scripture (OT/NT text)',
  accessed: '2026-08-01',
  note: 'public CSV, no key required',
}, {
  id: 'arclight',
  name: 'Arclight / JESUS Film Project',
  url: 'https://core.arclight.org/v2/media-languages',
  covers: 'film (JESUS Film, feature + short film, audio preview)',
  accessed: '2026-08-01',
  note: 'public API, no key required — carries iso3 per language, so the join is exact',
}];
// Pools not included — named so the gaps are legible rather than implied-complete.
const UNCHECKED = [
  { id: 'grn', name: 'Global Recordings Network', covers: 'audio (37,697 recordings)', status: 'not included: requires an API key' },
  { id: 'api_bible', name: 'API.Bible (bible.com ecosystem)', covers: 'scripture', status: 'not included: requires an API key' },
  { id: 'dbl', name: 'Digital Bible Library', covers: 'scripture', status: 'not included: not evaluated' },
  { id: 'progress_bible', name: 'progress.bible', covers: 'translation status', status: 'not included: no programmatic access' },
];

// ── eBible CSV ───────────────────────────────────────────────────────────────
// Hand-parsed rather than pulling a CSV dep: the file is quoted-comma with a BOM,
// and the fields we need are simple strings.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = readFileSync(EBIBLE, 'utf8').replace(/^﻿/, '');
const table = parseCsv(raw);
const head = table[0].map((h) => h.replace(/^﻿/, '').replace(/^"|"$/g, ''));
const idx = (n) => head.indexOf(n);
const C = {
  lang: idx('languageCode'), name: idx('languageNameInEnglish'), title: idx('title'),
  url: idx('publicationURL'), ot: idx('OTbooks'), nt: idx('NTbooks'),
  redist: idx('Redistributable'), copyright: idx('Copyright'),
};

const byLang = new Map();
for (let i = 1; i < table.length; i++) {
  const r = table[i];
  if (!r || !r[C.lang]) continue;
  const code = r[C.lang].trim().toLowerCase();
  if (!byLang.has(code)) byLang.set(code, []);
  byLang.get(code).push({
    title: r[C.title] || null,
    url: r[C.url] || null,
    ot_books: parseInt(r[C.ot], 10) || 0,
    nt_books: parseInt(r[C.nt], 10) || 0,
    redistributable: r[C.redist] === 'True',
  });
}

// ── ISO 639-3 REGISTRY (SIL) — code validity ─────────────────────────────────
// A resource pool can only be searched by a code the pool itself indexes. If the
// DX record carries a code that is NOT in the official registry, the join can
// never match — and the row would read as "no resource found" for a STRUCTURAL
// reason rather than a real absence. That distinction has to be visible or it
// misdirects effort at languages that may in fact be served.
//
// MEASURED 2026-08-01: 33 of 862 DX codes are outside the registry. 31 are in the
// PRIVATE-USE range (q*) and are almost entirely SIGN LANGUAGES — Natural,
// Francophone African, Somali, Angolan, Bahraini, Benin. 2 more are retired or
// non-standard (dek, ajp). Together: 37 people groups, ~3.87M people whose
// resource status is UNRESOLVABLE by code join, not proven absent.
const isoRegistry = new Set();
try {
  const tab = readFileSync(join(OUT, 'iso-639-3.tab'), 'utf8').split('\n');
  for (let i = 1; i < tab.length; i++) {
    const id = (tab[i].split('\t')[0] || '').trim();
    if (id) isoRegistry.add(id);
  }
} catch (_) { /* absent registry = do not flag anything, rather than flag wrongly */ }

// ── Arclight / JESUS Film ────────────────────────────────────────────────────
// iso3 is on every record, so this is another EXACT code join — no name matching.
const arcRaw = JSON.parse(readFileSync(join(OUT, 'arclight-languages.json'), 'utf8'));
const arcByLang = new Map();
for (const m of (arcRaw?._embedded?.mediaLanguages || [])) {
  const code = String(m.iso3 || '').toLowerCase();
  if (!code) continue;
  const c = m.counts || {};
  arcByLang.set(code, {
    feature_film: (c.featureFilm?.value | 0) > 0,
    short_film: (c.shortFilm?.value | 0) > 0,
    speakers: c.speakerCount?.value ?? null,
    language_id: m.languageId,
    url: `https://www.jesusfilm.org/watch/?languageId=${m.languageId}`,
  });
}

// ── DX people groups ─────────────────────────────────────────────────────────
const rec = JSON.parse(readFileSync(RECORDS, 'utf8'));
const records = Array.isArray(rec) ? rec : (rec.records || rec.data || []);

const languages = new Map();
for (const r of records) {
  const code = (r.primary_language || '').trim().toLowerCase();
  if (!code) continue;
  if (!languages.has(code)) {
    languages.set(code, {
      iso639_3: code,
      language: r.primary_language_label || code,
      people_groups: [],
      countries: new Set(),
      population: 0,
    });
  }
  const L = languages.get(code);
  L.people_groups.push(r.name);
  L.countries.add(r.country_code_label || r.country_code);
  L.population += parseInt(r.population, 10) || 0;
}

const out = [];
for (const L of languages.values()) {
  const hits = byLang.get(L.iso639_3) || [];
  const arc = arcByLang.get(L.iso639_3) || null;
  const full = hits.filter((h) => h.ot_books >= 39 && h.nt_books >= 27).length;
  const ntOnly = hits.filter((h) => h.nt_books >= 27 && h.ot_books < 39).length;

  out.push({
    iso639_3: L.iso639_3,
    language: L.language,
    people_group_count: L.people_groups.length,
    people_groups: L.people_groups,
    countries: [...L.countries],
    population: L.population,

    has_scripture: hits.length > 0,
    scripture_count: hits.length,
    full_bible: full > 0,
    new_testament: ntOnly > 0 || full > 0,
    // FILM is now REAL data from Arclight, not unknown.
    has_film: arc ? (arc.feature_film || arc.short_film) : false,
    film_source: arc ? 'arclight' : null,
    film_url: arc ? arc.url : null,
    jesus_film: arc ? arc.feature_film : false,
    // AUDIO still needs GRN. 'unknown' is the only honest value until the key lands
    // — recording it as false would tell a reader a language is unserved when the
    // pool that would answer has simply not been checked.
    has_audio: 'unknown',
    resources: hits.slice(0, 5),

    // TRUE when the code cannot be looked up in ANY pool that indexes ISO 639-3.
    // Such a row's has_scripture/has_film are structurally false, not measured.
    code_unmatchable: isoRegistry.size > 0 && !isoRegistry.has(L.iso639_3),
    code_note: (isoRegistry.size > 0 && !isoRegistry.has(L.iso639_3))
      ? (L.iso639_3.startsWith('q')
          ? 'PRIVATE-USE code (q*) — outside ISO 639-3, so no resource pool can index it. Status is UNRESOLVABLE, not absent.'
          : 'Code not in the ISO 639-3 registry (retired or non-standard) — join cannot match. Status is UNRESOLVABLE, not absent.')
      : null,
    checked_pools: POOLS.map((p) => p.id),
    unchecked_pools: UNCHECKED.map((p) => p.id),
    // The single most important caveat in this file.
    absence_meaning: (hits.length === 0 && !arc)
      ? 'NOT FOUND in the pools checked (eBible only) — NOT proof that no scripture exists'
      : null,
  });
}

out.sort((a, b) => {
  if (a.has_scripture !== b.has_scripture) return a.has_scripture ? 1 : -1;  // zero-resource FIRST
  return b.people_group_count - a.people_group_count;
});

const withS = out.filter((l) => l.has_scripture);
const without = out.filter((l) => !l.has_scripture);
const stats = {
  dx_languages: out.length,
  dx_people_groups: records.length,
  ebible_translations: table.length - 1,
  ebible_languages: byLang.size,
  languages_with_scripture: withS.length,
  languages_without: without.length,
  people_groups_without_scripture: without.reduce((n, l) => n + l.people_group_count, 0),
  unmatchable_codes: out.filter((l) => l.code_unmatchable).length,
  unmatchable_people_groups: out.filter((l) => l.code_unmatchable).reduce((n, l) => n + l.people_group_count, 0),
  population_without_scripture: without.reduce((n, l) => n + l.population, 0),
  full_bible_languages: out.filter((l) => l.full_bible).length,
  languages_with_film: out.filter((l) => l.has_film).length,
  languages_with_jesus_film: out.filter((l) => l.jesus_film).length,
  languages_with_nothing: out.filter((l) => !l.has_scripture && !l.has_film).length,
  people_groups_with_nothing: out.filter((l) => !l.has_scripture && !l.has_film).reduce((n, l) => n + l.people_group_count, 0),
  generated: '2026-08-01',
  pools_checked: POOLS,
  pools_unchecked: UNCHECKED,
  boundary: 'Resource AVAILABILITY per language only. Contains no church, believer or meeting-point data, and must not gain any.',
};

writeFileSync(join(OUT, 'language-resources.json'), JSON.stringify({ stats, languages: out }, null, 1));
if (!existsSync(APPDATA)) mkdirSync(APPDATA, { recursive: true });
writeFileSync(join(APPDATA, 'resources.json'), JSON.stringify({ stats, languages: out }, null, 1));

console.log(`[resources] DX languages: ${stats.dx_languages}  (from ${stats.dx_people_groups} people groups)`);
console.log(`[resources] eBible: ${stats.ebible_translations} translations across ${stats.ebible_languages} languages`);
console.log(`[resources] WITH scripture: ${stats.languages_with_scripture}   full Bible: ${stats.full_bible_languages}`);
console.log(`[resources] WITHOUT (in checked pools): ${stats.languages_without} languages`);
console.log(`[resources]   -> ${stats.people_groups_without_scripture} people groups, ${stats.population_without_scripture.toLocaleString()} people`);
console.log('[resources] top zero-scripture languages by people-group count:');
for (const l of without.slice(0, 8)) {
  console.log(`   ${l.iso639_3}  ${String(l.people_group_count).padStart(3)} groups  ${l.language}`);
}
