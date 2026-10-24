#!/usr/bin/env node
/**
 * check-describe-group — the packet's generated profile description, asserted per level, per missing
 * field and per locale.
 *
 * WHY A TEST AND NOT A GLANCE: this string is generated for ~2,000 people groups in eleven languages
 * and printed ~20 to a page. Nobody proofreads two thousand of them, so every failure mode here is
 * silent — a missing field blanks a row, a wrong GSEC branch states the wrong fact about a real people,
 * and an English fragment in an Arabic packet reads as a bug in the data rather than in the code.
 *
 * Headless, no network, no map. Strings are INJECTED, so this tests the function and not the catalogue.
 * Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { describeGroup } = await import(resolve(ROOT, 'library/packets/describeGroup.js'))

// Two locales is enough to prove the lookup: one that exists, one that does not (falls back to en).
const S = {
  en: {
    desc_where_both: 'The {people} live in {country} and speak {language}.',
    desc_where_country: 'The {people} live in {country}.',
    desc_where_language: 'The {people} speak {language}.',
    desc_gsec_0: 'There are no known evangelical Christians among them.',
    desc_gsec_1: 'Fewer than 2% are evangelical, and no one has been planting churches.',
    desc_gsec_4: 'Between 2% and 5% are evangelical.',
    desc_gsec_6: 'More than 10% are evangelical.',
  },
  ar: {
    desc_where_both: 'يعيش {people} في {country} ويتحدثون {language}.',
    desc_where_country: 'يعيش {people} في {country}.',
    desc_gsec_1: 'أقل من 2% إنجيليون.',
  },
}
// The country resolver is INJECTED (see describeGroup's header: countryName.js is Vite-alias-only and
// imports JSON without an attribute, so importing it here would make this gate unrunnable). A two-entry
// stub proves the wiring and the localization; the ladder below proves what happens without it.
const CN = (iso, lc) => ({ MYS: { en: 'Malaysia', ar: 'ماليزيا' } }[iso] || {})[lc] || ''
const O = { strings: S, countryName: CN }
const G = { name: 'Abai Sungai', country_code: 'MYS', primary_language_label: 'Abai Sungai', imb_gsec: 1 }
const fails = []
const eq = (what, got, want) => { if (got !== want) fails.push(`${what}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
const has = (what, got, sub) => { if (!String(got).includes(sub)) fails.push(`${what}: ${JSON.stringify(sub)} missing from ${JSON.stringify(got)}`) }
const hasNot = (what, got, sub) => { if (String(got).includes(sub)) fails.push(`${what}: ${JSON.stringify(sub)} SHOULD NOT be in ${JSON.stringify(got)}`) }

// 1. every GSEC level the catalogue defines resolves to ITS OWN sentence
for (const [g, frag] of [[0, 'no known evangelical'], [1, 'no one has been planting'], [4, 'Between 2% and 5%'], [6, 'More than 10%']]) {
  has(`gsec ${g} picks its own level sentence`, describeGroup({ ...G, imb_gsec: g }, 'en', O), frag)
}
eq('gsec 1 in full', describeGroup(G, 'en', O),
  'The Abai Sungai live in Malaysia and speak Abai Sungai. Fewer than 2% are evangelical, and no one has been planting churches.')

// 2. the country is resolved to the READER's language from its code, not left English
has('country localized from the code (ar)', describeGroup(G, 'ar', O), 'ماليزيا')
hasNot('and the English name is gone', describeGroup(G, 'ar', O), 'Malaysia')

// 3. a missing clause is DROPPED, never blanked — the row still describes the people
const noLang = { ...G }; delete noLang.primary_language_label
eq('language missing -> country sentence only', describeGroup(noLang, 'en', O),
  'The Abai Sungai live in Malaysia. Fewer than 2% are evangelical, and no one has been planting churches.')
const noCountry = { ...G }; delete noCountry.country_code
eq('country missing -> language sentence only', describeGroup(noCountry, 'en', O),
  'The Abai Sungai speak Abai Sungai. Fewer than 2% are evangelical, and no one has been planting churches.')
has('level survives when both clauses are gone', describeGroup({ imb_gsec: 4 }, 'en', O), 'Between 2% and 5%')

// 3b. THE LANGUAGE LABEL IS INDEX-ORDERED AND MUST BE UN-INVERTED BEFORE IT IS PRINTED.
// The API returns "Arabic, Shihhi"; the sentence has to read "Shihhi Arabic". 725 of the 12,379 rows
// carry an inverted label, so this is the single most-printed transformation in the description.
const shihhi = describeGroup({ ...G, name: 'Shihuh', primary_language_label: 'Arabic, Shihhi' }, 'en', O)
has('inverted label reads naturally', shihhi, 'speak Shihhi Arabic.')
hasNot('and the raw index ordering is NOT printed', shihhi, 'Arabic, Shihhi')
// A comma INSIDE a parenthetical is not an inversion marker — 13 real names would be shredded by a
// naive split ("Central Sulawesi) Boano (Indonesia"). These must pass through untouched.
has('parenthetical comma is left alone', describeGroup({ ...G, primary_language_label: 'Boano (Indonesia, Central Sulawesi)' }, 'en', O), 'speak Boano (Indonesia, Central Sulawesi).')
has('a trailing parenthetical stays at the end', describeGroup({ ...G, primary_language_label: 'Naga, Tangkhul (India)' }, 'en', O), 'speak Tangkhul Naga (India).')
has('an uninverted label is unchanged', describeGroup({ ...G, primary_language_label: 'Ainu (China)' }, 'en', O), 'speak Ainu (China).')

// 3c. ★ THE FLATTENED CODE IS NEVER PRINTED. normalize.js flattens primary_language to its .value, an
// ISO 639-3 code; reading that field would print "and speak abf". A group carrying ONLY the code must
// fall to the country sentence — dropping the clause, which is the rule, rather than printing a code.
const codeOnly = { ...G }; delete codeOnly.primary_language_label; codeOnly.primary_language = 'abf'
eq('a bare language code is dropped, not printed', describeGroup(codeOnly, 'en', O),
  'The Abai Sungai live in Malaysia. Fewer than 2% are evangelical, and no one has been planting churches.')

// 3d. NO RESOLVER: the clause degrades down countryName.js's own ladder instead of blanking.
eq('no resolver, no label -> the alpha-3 code, and the level still states its fact', describeGroup(G, 'ar', { strings: S }),
  'يعيش Abai Sungai في MYS ويتحدثون Abai Sungai. أقل من 2% إنجيليون.')
eq('no resolver, label present -> the label', describeGroup({ ...G, country_code_label: 'Malaysia' }, 'en', { strings: S }),
  'The Abai Sungai live in Malaysia and speak Abai Sungai. Fewer than 2% are evangelical, and no one has been planting churches.')
has('resolver returning nothing falls through to the code', describeGroup(G, 'en', { strings: S, countryName: () => '' }), 'live in MYS')

// 3e. ★ A RAW API RECORD MUST DESCRIBE THE SAME PEOPLE AS A NORMALIZED ONE. The live API sends several
// fields as { value, label } pairs, and Number({value:'1'}) is NaN — so on a raw record the GSEC sentence
// did not fall back, it silently VANISHED, and the row read as a people group with no reachedness figure
// at all. upg100 fixed their own normalizer; every other caller passing the raw record lost it the same
// way, which is why the unwrap belongs at the read. The language clause went the same way for the same
// reason: the NAME is at primary_language.label on a raw record.
const RAW = {
  name: 'Abai Sungai',
  country_code: { value: 'MYS', label: 'Malaysia' },
  primary_language: { value: 'abf', label: 'Abai Sungai' },
  imb_gsec: { value: '1', label: 'Fewer than 2% evangelical' },
}
eq('a raw record reads exactly like the normalized one', describeGroup(RAW, 'en', O), describeGroup(G, 'en', O))
has('the level sentence survives a nested imb_gsec', describeGroup(RAW, 'en', O), 'Fewer than 2% are evangelical')
has('the language NAME comes from the nested label, not the code', describeGroup(RAW, 'en', O), 'speak Abai Sungai.')
hasNot('and the nested code is never printed', describeGroup(RAW, 'en', O), 'abf')
has('a nested country_code still localizes from its value', describeGroup(RAW, 'ar', O), 'ماليزيا')
// The nested label is also the English fall-back when no resolver is injected — the same ladder, reached
// through the raw shape rather than through country_code_label.
has('no resolver -> the nested country label, not the bare code',
  describeGroup(RAW, 'en', { strings: S }), 'live in Malaysia')
// An inverted name arrives inverted in the nested shape too, and must still be un-inverted.
has('a nested inverted label is un-inverted',
  describeGroup({ ...RAW, primary_language: { value: 'ssh', label: 'Arabic, Shihhi' } }, 'en', O), 'speak Shihhi Arabic.')
// ...and the rule that a MISSING field drops its clause is unchanged by any of this.
eq('a nested pair with an empty label drops the clause rather than printing nothing',
  describeGroup({ ...RAW, primary_language: { value: 'abf', label: '' } }, 'en', O),
  'The Abai Sungai live in Malaysia. Fewer than 2% are evangelical, and no one has been planting churches.')
eq('a nested imb_gsec with no value drops the level, not the row',
  describeGroup({ ...RAW, imb_gsec: { value: '', label: '' } }, 'en', O),
  'The Abai Sungai live in Malaysia and speak Abai Sungai.')

// 4. missing or nonsense GSEC omits the level rather than inventing one or throwing
hasNot('no gsec -> no level sentence', describeGroup({ ...G, imb_gsec: undefined }, 'en', O), 'evangelical')
hasNot('gsec 9 is not a level', describeGroup({ ...G, imb_gsec: 9 }, 'en', O), 'evangelical')
eq('an empty group is an empty string, not a crash', describeGroup({}, 'en', O), '')
eq('a null group is an empty string', describeGroup(null, 'en', O), '')

// 5. a locale the catalogue lacks falls back to English rather than printing the key
has('unknown locale falls back to en', describeGroup(G, 'zz', O), 'The Abai Sungai live in')
has('partial locale falls back PER KEY', describeGroup(G, 'ar', O), 'أقل من 2%')

// 6. truncation cuts at a word boundary and only when asked
const long = describeGroup(G, 'en', O)
eq('no cap -> untouched', describeGroup(G, 'en', { ...O, maxChars: 0 }), long)
const cut = describeGroup(G, 'en', { ...O, maxChars: 40 })
if (cut.length > 40) fails.push(`maxChars 40 honoured: got ${cut.length}`)
if (!cut.endsWith('…')) fails.push(`truncation is marked: ${JSON.stringify(cut)}`)
if (/\s$/.test(cut.slice(0, -1))) fails.push(`truncation trims its tail: ${JSON.stringify(cut)}`)

// ── 7. THE CATALOGUE ARM ─────────────────────────────────────────────────────────────────────────
// ★ EVERYTHING ABOVE TESTS THE LOGIC AGAINST A FIXTURE, AND THAT IS THE RIGHT DESIGN — but it means
// this gate stayed GREEN while describeGroup returned "" for every group in the product, because the
// ten keys it needs (desc_where_both/_country/_language, desc_gsec_0..6) were not in the SHIPPING
// packet-strings.json. A green gate proved the function and said nothing about the catalogue. Wiring
// the profile table then would have blanked the wide description column on all 100 rows, with no
// error and no empty state — the same "returns nothing, looks like no data" shape as a fetch missing
// its selector field. So: run the REAL catalogue, and assert a non-empty sentence per GSEC level.
// en AND an RTL locale, because a per-key fallback can hide a missing block behind English.
const REAL = JSON.parse(readFileSync(resolve(ROOT, 'library/scripts/posters/packet-strings.json'), 'utf8'))
// ★ NON-EMPTY IS NOT ENOUGH, and a real defect proved it. imb_gsec arrives from the API as
// { value:'1', label:'…' }; it was missing from normalize.js's NESTED_FIELDS, so describeGroup saw
// an object, Number({value:'1'}) was NaN, and the LEVEL SENTENCE was dropped for every group — while
// the where-clause still rendered. A non-empty assertion passes that happily and the packet's widest
// column ships at half length. So each level asserts ITS OWN sentence is present, not merely that
// something is.
const WHERE_ONLY = describeGroup({ ...G, imb_gsec: null }, 'en', { strings: REAL, countryName: CN })
for (const locale of ['en', 'ar']) {
  for (const gsec of [0, 1, 2, 3, 4, 5, 6]) {
    const row = { ...G, imb_gsec: gsec }
    const out = describeGroup(row, locale, { strings: REAL, countryName: CN })
    if (!out) {
      fails.push(`CATALOGUE: describeGroup renders nothing for GSEC ${gsec} in '${locale}' — the shipping packet-strings.json is missing its desc_* keys, so the packet's widest column would print empty`)
      continue
    }
    // The level clause is what `out` has BEYOND the where-clause. If the two are the same length,
    // the sentence for this level never appeared — a missing desc_gsec_N key, or a row whose
    // imb_gsec did not survive normalisation.
    const levelText = String(REAL[locale] && REAL[locale][`desc_gsec_${gsec}`] || REAL.en[`desc_gsec_${gsec}`] || '')
    if (!levelText) fails.push(`CATALOGUE: desc_gsec_${gsec} is absent from the catalogue (checked '${locale}', then en)`)
    else if (out.length <= WHERE_ONLY.length) fails.push(`CATALOGUE: GSEC ${gsec} in '${locale}' rendered only the where-clause — the level sentence is missing, so every profile row would print at half length`)
  }
}

if (fails.length) {
  console.error('DESCRIBE-GROUP: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('DESCRIBE-GROUP: PASS — every GSEC level states its own fact, a raw { value, label } record describes the same people as a normalized one, an index-ordered language label is un-inverted without shredding a parenthetical, a missing clause is dropped rather than blanked, the country is localized from its code, and an unknown locale falls back per key.')
