// build-trade-languages.mjs — THE BRIDGE LANGUAGES, and the GAPS vs OPPORTUNITIES.
//
//   node build-trade-languages.mjs
//     -> out/trade-languages-by-country.json
//     -> out/tables/gaps-and-opportunities.json
//
// ═══ THE QUESTION THIS ANSWERS ══════════════════════════════════════════════
// The gospel resources map needs the trade languages of each country and city, with the
// key languages ordered by prevalence and mapped to gospel resources. The goal is to get
// the gospel to every people group through the internet, so resources, languages and maps
// are combined to find GAPS and OPPORTUNITIES.
//
// A people group with no scripture in its HEART language is not necessarily
// unreachable. It may already speak a widely-used language of its country that
// DOES have scripture. That is an OPPORTUNITY — reachable today, with a resource
// that already exists — and it is invisible in a table that only asks about the
// heart language.
//
// Conversely a group whose heart language AND whose country's most-used languages
// all lack resources is a GAP — nothing existing reaches them.
//
// ═══ HOW A "TRADE LANGUAGE" IS DERIVED, AND WHY NOT FROM A LIST ═════════════
// restcountries was tried for official languages: the v3.1 API is DEPRECATED and
// returns an error body. Rather than hand-type a 175-row table of national
// languages from memory — which is exactly where a confident error would enter —
// this derives prevalence FROM THE DX CORPUS ITSELF:
//
//   a language is a BRIDGE CANDIDATE in a country when it is the primary language
//   of MULTIPLE distinct people groups there.
//
// That is measured, not asserted. It is also honestly narrower than "trade
// language": it finds languages widely spoken AMONG THE UNENGAGED GROUPS WE TRACK,
// which is the population the app is about — but it will MISS a national lingua
// franca that no unengaged group claims as primary (Hindi in India is the obvious
// case: it is India's bridge language but few DX groups list it as primary).
// So the field is named `bridge_candidates`, NOT `trade_languages`, and every row
// says what it is. Naming it "trade language" would overclaim.
//
// The honest fix for true trade languages is a cited source (Ethnologue is
// paywalled; Glottolog has no lingua-franca field). Recorded as an open item
// rather than guessed.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const TABLES = join(OUT, 'tables');
const RECORDS = resolve(__dirname, '..', 'posters', 'out', '_records.json');

const raw = JSON.parse(readFileSync(RECORDS, 'utf8'));
const records = Array.isArray(raw) ? raw : (raw.records || raw.data || []);
const res = JSON.parse(readFileSync(join(OUT, 'language-resources.json'), 'utf8'));
// ENVIRONMENT — an opportunity is not just "a resource exists". It is a resource
// they can REACH. An opportunity is a place where the resources and the environment
// line up for gospel work.
// So the alignment test is THREE things, not one:
//   RESOURCE   does something exist in a language they plausibly use
//   REACH      is there internet to receive it
//   CHANNEL    is there a known platform they are already on
const conn = existsSync(join(OUT, 'connectivity-by-country.json'))
  ? JSON.parse(readFileSync(join(OUT, 'connectivity-by-country.json'), 'utf8')).countries : {};
const apps = existsSync(join(OUT, 'top-apps-by-country.json'))
  ? JSON.parse(readFileSync(join(OUT, 'top-apps-by-country.json'), 'utf8')).countries : {};
const social = existsSync(join(OUT, 'social-platforms-by-country.json'))
  ? JSON.parse(readFileSync(join(OUT, 'social-platforms-by-country.json'), 'utf8')).countries : {};

// ★ KEYED BY ISO 639-3, NEVER BY NAME — and this is load-bearing, not a style choice.
// Language and people-group NAMES drift between the upstream corpus and this baked snapshot.
// MEASURED 2026-09-23 against the live people-groups API: gaps-and-opportunities.json carries
// "Jerba" and "Tmagourt" where the API now says "Amazigh of Djerba" and "Amazigh, Matmata" — the
// same Tunisian peoples, relabelled. Five name mismatches in all, and every one is harmless ONLY
// because nothing joins on the name.
// Join these tables to the corpus by name and you silently drop three groups and orphan two rows:
// no error, no empty state, just fewer people on a map about people nobody has reached. That is
// exactly the failure internal/check-label-joins.mjs exists to prevent — "the predicate silently
// matches ZERO features — a blank map, with no error anywhere."
// The consumer side states the same rule at plugin-designs/gospel-resources/resources-map.vue:194.
// iso639_3 -> resource status
const byLang = new Map();
for (const l of res.languages) byLang.set(l.iso639_3, l);

// ── Bridge candidates per country ────────────────────────────────────────────
const perCountry = new Map();
for (const r of records) {
  const c = r.country_code, l = (r.primary_language || '').toLowerCase();
  if (!c || !l) continue;
  if (!perCountry.has(c)) perCountry.set(c, { iso3: c, country: r.country_code_label || c, langs: new Map(), groups: 0 });
  const p = perCountry.get(c);
  p.groups++;
  const e = p.langs.get(l) || { iso639_3: l, label: r.primary_language_label || l, groups: 0, population: 0 };
  e.groups++;
  e.population += parseInt(r.population, 10) || 0;
  p.langs.set(l, e);
}

const countries = [];
for (const p of perCountry.values()) {
  const ranked = [...p.langs.values()]
    .map((e) => {
      const L = byLang.get(e.iso639_3);
      return {
        ...e,
        has_scripture: !!L?.has_scripture,
        has_film: !!L?.has_film,
        full_bible: !!L?.full_bible,
        // A bridge is only useful if it CARRIES something.
        carries_resource: !!(L?.has_scripture || L?.has_film),
      };
    })
    .sort((a, b) => b.groups - a.groups || b.population - a.population);

  // MULTIPLE groups = spoken across group boundaries in that country.
  const bridges = ranked.filter((x) => x.groups > 1);
  countries.push({
    iso3: p.iso3,
    country: p.country,
    people_groups: p.groups,
    distinct_languages: ranked.length,
    languages_ranked: ranked.slice(0, 12),
    bridge_candidates: bridges.slice(0, 8),
    // The country-level opportunity: is there ANY multi-group language here that
    // already has a resource?
    best_bridge_with_resource: bridges.find((x) => x.carries_resource) || null,
  });
}
countries.sort((a, b) => b.people_groups - a.people_groups);

writeFileSync(join(OUT, 'trade-languages-by-country.json'), JSON.stringify({
  stats: {
    countries: countries.length,
    generated: '2026-08-01',
    definition: 'A BRIDGE CANDIDATE is a language that is the primary language of MORE THAN ONE distinct DX people group in that country — measured from the corpus, not asserted from a list.',
    honest_limit: 'This is NOT the same as a national trade language. It finds languages widely used AMONG THE UNENGAGED GROUPS TRACKED HERE, and will MISS a lingua franca that no unengaged group claims as primary (e.g. Hindi in India). Named bridge_candidates, not trade_languages, for that reason.',
    why_not_a_list: 'No open machine-readable list of national trade languages was available; bridge candidates are derived from this corpus.',
  },
  countries,
}, null, 1));

// ═══ GAPS AND OPPORTUNITIES — one row per people group ══════════════════════
const rows = [];
for (const r of records) {
  const c = r.country_code;
  const heart = (r.primary_language || '').toLowerCase();
  const L = byLang.get(heart);
  const p = perCountry.get(c);
  const ranked = p ? [...p.langs.values()] : [];

  const heartHas = !!(L?.has_scripture || L?.has_film);
  // A bridge THIS group could plausibly reach: another language of its own
  // country, spoken by multiple groups, that already carries a resource.
  const bridge = ranked
    .filter((e) => e.iso639_3 !== heart && e.groups > 1)
    .map((e) => ({ e, R: byLang.get(e.iso639_3) }))
    .filter((x) => x.R && (x.R.has_scripture || x.R.has_film))
    .sort((a, b) => b.e.groups - a.e.groups)[0];

  rows.push({
    people_group: r.name,
    country: r.country_code_label || c,
    iso3: c,
    heart_language: r.primary_language_label || heart,
    heart_iso639_3: heart,
    population: parseInt(r.population, 10) || 0,
    heart_has_scripture: !!L?.has_scripture,
    heart_has_film: !!L?.has_film,
    heart_has_any: heartHas,
    // THE TWO ANSWERS THE ASKED FOR:
    // OPPORTUNITY — no heart resource, but a country bridge language already carries one.
    opportunity: !heartHas && !!bridge,
    bridge_language: bridge ? (bridge.e.label || bridge.e.iso639_3) : '',
    bridge_iso639_3: bridge ? bridge.e.iso639_3 : '',
    bridge_groups_in_country: bridge ? bridge.e.groups : 0,
    // HOW MUCH TO TRUST THIS BRIDGE. Measured: 24% of "aligned" rows rested on a
    // language shared by only 2-3 groups. Mandarin/Portuguese/Hausa are genuine
    // lingua francas; Akha, Batak Alas-Kluet and Gawri are NOT — Gawri was being
    // offered as the bridge for 10.3M Pakistanis, where the real answer is Urdu.
    // A single boolean hid that difference, so strength is now graded and the weak
    // ones are labelled rather than dropped or silently trusted.
    bridge_strength: !bridge ? ''
      : bridge.e.groups >= 8 ? 'strong'
      : bridge.e.groups >= 4 ? 'moderate'
      : 'weak — shared by few groups; may not be a real lingua franca',
    bridge_has_scripture: bridge ? !!bridge.R.has_scripture : false,
    bridge_has_film: bridge ? !!bridge.R.has_film : false,
    // GAP — nothing in the heart language AND no bridge in-country carries anything.
    gap: !heartHas && !bridge,
    // ── ENVIRONMENT ────────────────────────────────────────────────────────
    internet_access: (conn[c] || {}).internet_access || 'unknown',
    internet_pct: (conn[c] || {}).internet_pct ?? null,
    // The channel they are ALREADY on. top-apps sees messaging apps that
    // referral stats cannot; social is the web-referral view. Either is a channel.
    top_channel: (apps[c] || {}).top_messaging || (apps[c] || {}).top_social
      || (social[c] || {}).top_platform || '',
    channel_source: (apps[c] || {}).top_messaging ? 'app-store ranking'
      : (social[c] || {}).top_platform ? 'referral share' : '',
    // ALIGNED = all three line up: something exists, they can reach it, and there
    // is a channel to carry it. This is the the brief's "resources and environment
    // all aligned" — the highest-leverage rows in the whole corpus.
    aligned: !heartHas && !!bridge
      && ((conn[c] || {}).internet_access === 'yes' || (conn[c] || {}).internet_access === 'partial')
      && !!((apps[c] || {}).top_messaging || (apps[c] || {}).top_social || (social[c] || {}).top_platform),
    status: heartHas ? 'reached in heart language'
      : bridge ? 'opportunity — bridge language has a resource'
      : 'gap — nothing found in heart or bridge language',
    caveat: 'Bridge = a language of the same country spoken by >1 DX group. NOT proof this group speaks it. Resource status = pools checked (eBible + JESUS Film); audio pools are key-blocked.',
  });
}
rows.sort((a, b) => (a.gap === b.gap ? b.population - a.population : (a.gap ? -1 : 1)));

const cols = [
  { title: 'People Group', field: 'people_group', type: 'string' },
  { title: 'Country', field: 'country', type: 'string' },
  { title: 'Heart language', field: 'heart_language', type: 'string' },
  { title: 'ISO 639-3', field: 'heart_iso639_3', type: 'string' },
  { title: 'Population', field: 'population', type: 'number' },
  { title: 'Heart scripture', field: 'heart_has_scripture', type: 'boolean' },
  { title: 'Heart film', field: 'heart_has_film', type: 'boolean' },
  { title: 'OPPORTUNITY', field: 'opportunity', type: 'boolean' },
  { title: 'Bridge language', field: 'bridge_language', type: 'string' },
  { title: 'Bridge ISO', field: 'bridge_iso639_3', type: 'string' },
  { title: 'Groups sharing bridge', field: 'bridge_groups_in_country', type: 'number' },
  { title: 'Bridge strength', field: 'bridge_strength', type: 'string' },
  { title: 'Bridge scripture', field: 'bridge_has_scripture', type: 'boolean' },
  { title: 'Bridge film', field: 'bridge_has_film', type: 'boolean' },
  { title: 'GAP', field: 'gap', type: 'boolean' },
  { title: 'ALIGNED', field: 'aligned', type: 'boolean' },
  { title: 'Internet', field: 'internet_access', type: 'string' },
  { title: 'Internet %', field: 'internet_pct', type: 'number' },
  { title: 'Channel', field: 'top_channel', type: 'string' },
  { title: 'Channel source', field: 'channel_source', type: 'string' },
  { title: 'Status', field: 'status', type: 'string' },
];
for (const r of rows.slice(0, 50)) for (const c of cols) {
  if (!(c.field in r)) throw new Error(`gaps table: missing column ${c.field}`);
}
const gaps = rows.filter((r) => r.gap).length;
const opps = rows.filter((r) => r.opportunity).length;
if (gaps + opps === 0) throw new Error('validation: no gaps AND no opportunities — the join is broken');

if (!existsSync(TABLES)) mkdirSync(TABLES, { recursive: true });
writeFileSync(join(TABLES, 'gaps-and-opportunities.json'), JSON.stringify({
  meta: {
    title: 'Gaps and Opportunities',
    grain: 'one row per people group',
    the_question: 'Can this group reach the gospel today — in their heart language, or through a bridge language of their country that already carries a resource?',
    opportunity_meaning: 'No resource in the heart language, but a language spoken by MULTIPLE groups in the same country DOES have one. Reachable now with what already exists.',
    aligned_meaning: 'ALIGNED = an opportunity where the ENVIRONMENT also lines up: a bridge resource exists AND the country has internet (yes/partial) AND there is a known channel people are already on. These are the highest-leverage rows here.',
    gap_meaning: 'Nothing found in the heart language AND no in-country bridge language carries anything, in the pools checked.',
    bridge_strength_note: 'MEASURED: 24% of aligned rows rest on a bridge shared by only 2-3 groups. bridge_strength grades this (strong >=8 groups, moderate >=4, weak <4). A WEAK bridge is a hypothesis, not a route — e.g. "Gawri" was offered as the bridge for 10.3M Pakistanis where the real lingua franca is Urdu, which no unengaged group here claims as primary and which this method therefore cannot see. Filter on bridge_strength before acting.',
    bridge_caveat: 'A bridge candidate is measured from THIS corpus (a language primary to >1 DX group in the country). It is NOT proof the group speaks it, and it is NOT a national trade language — a lingua franca no unengaged group claims as primary is invisible here.',
    pools_caveat: 'Resource status is from eBible + JESUS Film. GRN and FCBH audio are key-blocked and unchecked — absence is never proof.',
  },
  columns: cols,
  rows,
}, null, 1));

console.log(`[trade] ${countries.length} countries, bridge candidates derived from the corpus`);
console.log(`[gaps]  ${rows.length} people groups: ${gaps} GAP · ${opps} OPPORTUNITY · ${rows.length - gaps - opps} already reached in heart language`);
const oppPop = rows.filter((r) => r.opportunity).reduce((n, r) => n + r.population, 0);
const gapPop = rows.filter((r) => r.gap).reduce((n, r) => n + r.population, 0);
const aligned = rows.filter((r) => r.aligned);
const strong = aligned.filter((r) => r.bridge_strength === 'strong');
console.log(`[gaps]  ALIGNED (resource + internet + channel): ${aligned.length} groups, ${aligned.reduce((n, r) => n + r.population, 0).toLocaleString()} people`);
console.log(`[gaps]    of which STRONG bridge (>=8 groups): ${strong.length} groups, ${strong.reduce((n, r) => n + r.population, 0).toLocaleString()} people`);
console.log(`[gaps]  population — opportunity ${oppPop.toLocaleString()} · gap ${gapPop.toLocaleString()}`);
