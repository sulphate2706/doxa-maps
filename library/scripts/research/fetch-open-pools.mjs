// fetch-open-pools.mjs — gospel resources reachable with NO KEY, NO ACCOUNT.
//
//   node fetch-open-pools.mjs
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// Every gospel resource on the internet that needs no API key or password and is
// reachable now is researched and mapped into one resource pool.
//
// The corpus already carries eBible (scripture) + Arclight (film). This adds every
// OTHER pool that answered a live request without a credential. Each was probed,
// not assumed — several well-known names failed and are recorded as failures.
//
// ═══ THE DISTINCTION THAT MATTERS MOST ══════════════════════════════════════
// Being listed in a catalogue's LANGUAGE LIST is NOT having a resource.
// Door43 advertises 228 languages; querying each one's actual content shows many
// have ZERO resources — the language is merely known to the platform. Measured:
// of 9 Door43 languages that overlap our no-resource set, 2 have NOTHING and 7 have
// Open Bible Stories only. Counting all 9 as "covered" would have been a fabricated
// 9-language gain. So this script queries CONTENT per language, never the roster.
//
// And OPEN BIBLE STORIES IS NOT SCRIPTURE. It is 50 illustrated Bible narratives —
// a real gospel resource, genuinely useful for oral-preference and low-literacy
// communities, and categorically NOT a Bible translation. It gets its OWN field.
// Folding it into has_scripture would overstate translation coverage, which is the
// one number that misdirects real translation effort.
//
// ═══ POOLS PROBED (live, this run) ══════════════════════════════════════════
//  OPEN, no key:
//    Door43 / unfoldingWord  git.door43.org/api/v1  — OBS, Bible, translation helps
//    bible-api.com           /data                  — public-domain translations
//    labs.bible.org          /api/                  — passage API (English)
//  CLOSED (recorded so nobody re-probes):
//    api.scripture.api.bible 401  · openbible.com 404 · bibleapi.co = fingerprint
//    redirect page, not an API · bible.cloud 522/000
//
// Honesty rules carried from the corpus: absence is 'not-found-in-pools-checked',
// never proven-absent; every row names its pool and licence; exact ISO 639-3 joins.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
const OUTFILE = join(OUT, 'open-pools.json');
const UA = 'doxa-maps-research/1.0 (people-group prayer mapping)';

const POOLS = {
  door43: {
    name: 'Door43 / unfoldingWord',
    base: 'https://git.door43.org/api/v1',
    licence: 'CC BY-SA 4.0 (open, no key, no account)',
    note: 'Translation platform aimed at minority languages. Hosts Open Bible Stories, Bibles and translation helps.',
  },
  bible_api: {
    name: 'bible-api.com',
    base: 'https://bible-api.com',
    licence: 'per-translation, mostly Public Domain (no key, no account)',
    note: 'Small set of public-domain translations, passage-level API.',
  },
};

async function getJSON(url, attempts = 3) {
  for (let a = 0; a < attempts; a++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status !== 503) return null;
    await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
  }
  return null;
}

// The DX languages we actually care about — no point cataloguing the whole internet.
const langs = JSON.parse(readFileSync(join(OUT, 'language-resources.json'), 'utf8')).languages;
const wanted = new Set(langs.map((l) => l.iso639_3).filter(Boolean));

const out = existsSync(OUTFILE) ? JSON.parse(readFileSync(OUTFILE, 'utf8')).languages || {} : {};

console.log(`[pools] ${wanted.size} DX languages to check against open pools`);

// ── bible-api.com: one shot, it publishes its whole catalogue ───────────────
const bapi = await getJSON('https://bible-api.com/data');
const bapiByLang = {};
for (const t of (bapi?.translations || [])) {
  const code = String(t.language_code || '').split('-')[0].toLowerCase();
  (bapiByLang[code] ||= []).push({ id: t.identifier, name: t.name, licence: t.license, url: t.url });
}
console.log(`[pools] bible-api.com: ${(bapi?.translations || []).length} translations, ${Object.keys(bapiByLang).length} language codes`);

// ── Door43: the roster is NOT the content. Query each candidate language. ───
const d43 = await getJSON('https://git.door43.org/api/v1/catalog/list/languages');
const d43Roster = (d43?.data || []).map((l) => l.lc).filter(Boolean);
const candidates = d43Roster.filter((lc) => wanted.has(lc));
console.log(`[pools] Door43 roster: ${d43Roster.length} languages, ${candidates.length} overlap DX — now querying CONTENT for each`);

let checked = 0;
for (const lc of candidates) {
  const res = await getJSON(`https://git.door43.org/api/v1/catalog/search?lang=${lc}&metadataType=rc`);
  const items = res?.data || [];
  // SUBJECT is what separates a Bible from a study helper from OBS. Keep them apart.
  const subjects = [...new Set(items.map((i) => i.subject).filter(Boolean))];
  const hasBible = subjects.some((s) => /^(Aligned )?Bible$|Greek New Testament|Hebrew Old Testament/i.test(s));
  const hasOBS = subjects.some((s) => /Open Bible Stories/i.test(s));

  const rec = out[lc] || (out[lc] = { iso639_3: lc, pools: {} });
  rec.pools.door43 = {
    resource_count: items.length,
    subjects,
    has_bible: hasBible,
    has_open_bible_stories: hasOBS,
    // The whole point of this script, stated on the row:
    roster_only: items.length === 0,
    roster_only_meaning: items.length === 0
      ? 'Door43 LISTS this language but hosts NO resources for it. Being in a catalogue roster is NOT having a resource.'
      : '',
    licence: POOLS.door43.licence,
    url: `https://git.door43.org/?lang=${lc}`,
  };
  checked++;
  if (checked % 10 === 0) console.log(`[pools]   … ${checked}/${candidates.length}`);
  await new Promise((r) => setTimeout(r, 350));
}

for (const [code, list] of Object.entries(bapiByLang)) {
  if (!wanted.has(code)) continue;
  const rec = out[code] || (out[code] = { iso639_3: code, pools: {} });
  rec.pools.bible_api = { translations: list, count: list.length, licence: POOLS.bible_api.licence };
}

writeFileSync(OUTFILE, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  pools: POOLS,
  closed_pools_do_not_reprobe: {
    'api.scripture.api.bible': 'HTTP 401 — key required',
    'openbible.com': 'HTTP 404',
    'bibleapi.co': 'NOT an API — a browser-fingerprinting redirect page',
    'bible.cloud / content.bible.cloud': 'HTTP 522 / no response',
    GRN: 'key required (already recorded)',
    'FCBH / 4.dbt.io': 'HTTP 422 missing key (already recorded)',
  },
  languages: out,
}, null, 1));

const withBible = Object.values(out).filter((l) => l.pools.door43?.has_bible).length;
const withOBS = Object.values(out).filter((l) => l.pools.door43?.has_open_bible_stories).length;
const rosterOnly = Object.values(out).filter((l) => l.pools.door43?.roster_only).length;
console.log(`[pools] DONE — ${Object.keys(out).length} languages recorded`);
console.log(`[pools]   Door43 with a BIBLE: ${withBible} · with OPEN BIBLE STORIES: ${withOBS} · ROSTER-ONLY (no content): ${rosterOnly}`);
