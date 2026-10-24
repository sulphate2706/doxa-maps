// verify-resource-join.mjs — prove the gospel-resource join against the RAW pools.
//
//   node verify-resource-join.mjs        # exits 1 on any failure
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// `no_resource_found` is the most consequential claim in this corpus: it is what
// says a people group has NOTHING in their language. A false positive sends effort
// toward a group that already has a resource; a false negative hides a group that
// has nothing. Neither is visible by reading the table.
//
// Checking the table against language-resources.json only proves the table is
// FAITHFUL TO ITS OWN INPUT. It cannot catch an error in that input. So this checks
// BOTH DIRECTIONS against the RAW pool caches:
//   * has_x=true  but the ISO is NOT in the raw pool  -> false positive
//   * has_x=false but the ISO IS  in the raw pool     -> false negative (the worse one)
//
// TWO PARSING TRAPS, both of which I hit and which made a hand-check report 306
// fake mismatches before I read the schemas:
//   * arclight-languages.json is a PAGINATED ENVELOPE — the records are at
//     _embedded.mediaLanguages, not the top level. Reading the top level yields 0.
//   * ebible-translations.csv carries a UTF-8 BOM, so row['languageCode'] is
//     undefined unless the file is read as utf-8-sig / the BOM is stripped.
// A cross-check that silently parses 0 records "passes" everything, which is the
// same fail-open shape this repo keeps catching. Hence the guard asserts the raw
// pools are NON-EMPTY and near their known sizes before comparing anything.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');

let failed = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

const arc = JSON.parse(readFileSync(join(OUT, 'arclight-languages.json'), 'utf8'));
const arcIso = new Set((arc?._embedded?.mediaLanguages || []).map((r) => r.iso3).filter(Boolean));

const csv = readFileSync(join(OUT, 'ebible-translations.csv'), 'utf8').replace(/^﻿/, '');
const [head, ...lines] = csv.split(/\r?\n/);
const col = head.split(',').findIndex((h) => h.replace(/"/g, '') === 'languageCode');
const ebIso = new Set(lines.map((l) => (l.split(',')[col] || '').replace(/"/g, '').trim()).filter(Boolean));

console.log('GOSPEL-RESOURCE JOIN VERIFICATION (against the RAW pools)');

// FAIL-CLOSED on an empty parse — an empty pool would clear every comparison below.
if (arcIso.size < 1500) fail(`arclight parsed only ${arcIso.size} ISO codes — expected ~2085. Parser broken, comparisons below are meaningless.`);
else ok(`arclight raw: ${arcIso.size} ISO codes`);
if (ebIso.size < 900) fail(`ebible parsed only ${ebIso.size} ISO codes — expected ~1241. Parser broken.`);
else ok(`ebible raw: ${ebIso.size} ISO codes`);
if (failed) { console.log('\nFAILED — raw pools did not parse; not comparing.'); process.exit(1); }

const langs = JSON.parse(readFileSync(join(OUT, 'language-resources.json'), 'utf8')).languages;
const fpFilm = langs.filter((l) => l.has_film && !arcIso.has(l.iso639_3));
const fnFilm = langs.filter((l) => !l.has_film && arcIso.has(l.iso639_3));
const fpScr = langs.filter((l) => l.has_scripture && !ebIso.has(l.iso639_3));
const fnScr = langs.filter((l) => !l.has_scripture && ebIso.has(l.iso639_3));

const rep = (label, arr) => arr.length
  ? fail(`${arr.length} ${label}: e.g. ${arr.slice(0, 5).map((l) => l.iso639_3).join(', ')}`)
  : ok(`0 ${label}`);

rep('FALSE POSITIVE has_film (claims film, absent from raw pool)', fpFilm);
rep('FALSE NEGATIVE has_film (in raw pool, claims none) — the dangerous direction', fnFilm);
rep('FALSE POSITIVE has_scripture', fpScr);
rep('FALSE NEGATIVE has_scripture — the dangerous direction', fnScr);

console.log(`\n${failed ? `FAILED — ${failed} problem(s)` : 'JOIN VALID — both directions agree with the raw pools'}`);
process.exit(failed ? 1 : 0);
