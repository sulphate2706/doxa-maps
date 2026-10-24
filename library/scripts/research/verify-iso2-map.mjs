// verify-iso2-map.mjs — assert the ISO3->ISO2 lookup is INJECTIVE and correct.
//
//   node verify-iso2-map.mjs        # exits 1 on any failure
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// out/iso3-to-iso2.json feeds FIVE consumers — fetch-trending, fetch-operators,
// fetch-social-platforms, fetch-top-apps, and build-tabulator-tables. Nothing in
// this repo WRITES it, so it is an unversioned artefact that every country-keyed
// fetch silently trusts.
//
// It was wrong for 21 of 175 codes. The damaging one was NER -> NG: Niger is a
// sovereign country holding 2 DX people-group clusters, and it was being given
// NIGERIA's alpha-2. Measured before the fix, Niger and Nigeria had BYTE-IDENTICAL
// trending rows — Lionel Messi, Lamine Yamal, Gianni Infantino for both. That is
// not a gap in the data, it is FABRICATED data: a row that looks fully populated
// and is about the wrong country. PSE -> IL was the same class (Palestine given
// Israel's code), and 19 territories were mapped to their sovereign parent.
//
// A wrong-but-plausible row is worse than a missing one. A missing row is visibly
// unknown; a fabricated row gets used.
//
// THE CORE INVARIANT IS INJECTIVITY. Two ISO3 codes sharing one ISO2 means at
// least one of them is being told about a country that is not itself. That single
// check catches the whole class without needing a hand-maintained table of every
// correct pair.
//
// THE GUARD IS ONLY WORTH ITS GREEN IF IT CAN GO RED: set one code to a duplicate
// and re-run — it must fail.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const F = join(__dirname, 'out', 'iso3-to-iso2.json');

if (!existsSync(F)) { console.error('FATAL: out/iso3-to-iso2.json missing'); process.exit(1); }
const map = JSON.parse(readFileSync(F, 'utf8'));

let failed = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('ISO3->ISO2 MAP VERIFICATION');

// 1. INJECTIVE. The check that catches NER->NG and PSE->IL without a lookup table.
const byIso2 = {};
for (const [iso3, iso2] of Object.entries(map)) (byIso2[iso2] ||= []).push(iso3);
const shared = Object.entries(byIso2).filter(([, v]) => v.length > 1);
if (shared.length) {
  for (const [iso2, iso3s] of shared) {
    fail(`ISO2 "${iso2}" claimed by ${iso3s.length} countries: ${iso3s.join(', ')} `
      + '— at least one will receive another country\'s data');
  }
} else ok(`all ${Object.keys(map).length} codes map to a DISTINCT ISO2`);

// 2. WELL-FORMED. A lowercase or 3-letter value silently misses every API lookup.
const malformed = Object.entries(map).filter(([, v]) => !/^[A-Z]{2}$/.test(String(v)));
if (malformed.length) fail(`${malformed.length} malformed ISO2 value(s): e.g. ${malformed[0].join(' -> ')}`);
else ok('every value is a well-formed 2-letter uppercase code');

// 3. SPOT-CHECK the codes this corpus actually got wrong, so a regression is named
//    rather than merely counted. These are the sovereign states whose alpha-2 was
//    previously their neighbour's or their former administrator's.
// SJM belongs here for the same reason PSE and HKG do: it was mapped to its administrator's code.
// SJM -> NO served NORWAY's data under the name "Svalbard and Jan Mayen", and INJECTIVITY COULD NOT
// SEE IT -- the check passes as long as no two codes share an ISO2, and NOR is absent from this map
// entirely, so "NO" had exactly one claimant and looked clean. A uniqueness test cannot tell a right
// code from a wrong one that nobody else wanted; only a named expectation can.
// NOR belongs here as the OTHER HALF of the SJM defect. Norway was absent from this map entirely,
// which is why SJM -> NO looked injective and why Norway appeared in no downstream table at all --
// consumers filter on `ISO3_2[iso3]`, so a missing code is not an error, it is a silent omission.
// Added from ISO 3166-1 (NO/NOR), which is what CLDR's codeMappings encodes; the full CLDR vendor
// still comes with BUILD-ISO3-TABLE-COVERS-ALL-242-COUNTRIES and will re-derive this alongside 66 others.
const MUST = { NER: 'NE', NGA: 'NG', PSE: 'PS', ISR: 'IL', HKG: 'HK', MAC: 'MO', ABW: 'AW', SJM: 'SJ', NOR: 'NO' };
// ABSENT MUST FAIL, NOT PASS. The first version read `map[k] && map[k] !== v`, so a
// code MISSING ENTIRELY was falsey and slipped through — deleting NER outright passed
// all three checks and this line still printed "NER … all correct" about a code that
// no longer existed. Niger would then silently vanish from every downstream table,
// which is the same disappearance the injectivity check exists to prevent, arriving
// by the opposite route. Missing is not clean; it is unverified.
const missing = Object.keys(MUST).filter((k) => !map[k]);
const wrong = Object.entries(MUST).filter(([k, v]) => map[k] && map[k] !== v);
for (const k of missing) fail(`${k} is ABSENT from the map — that country drops out of every consumer`);
for (const [k, v] of wrong) fail(`${k} -> ${map[k]}, expected ${v}`);
if (!missing.length && !wrong.length) ok('previously-wrong codes (NER, PSE, HKG, MAC, ABW …) all present and correct');

// The map must also stay COMPLETE. A silent shrink (175 -> 174) means a country
// stopped being fetched at all, which no per-code check can see.
// 175 -> 176 with NOR. The floor RISES when a code is added, or the check stops being able to see the
// shrink it exists for: left at 175 it would have called a regression back to the pre-NOR map clean.
const EXPECTED_MIN = 176;
if (Object.keys(map).length < EXPECTED_MIN) {
  fail(`map has ${Object.keys(map).length} codes, expected at least ${EXPECTED_MIN} — a country has DISAPPEARED`);
} else ok(`${Object.keys(map).length} codes present (>= ${EXPECTED_MIN})`);

console.log(`\n${failed ? `FAILED — ${failed} problem(s)` : 'ISO2 MAP VALID'}`);
process.exit(failed ? 1 : 0);
