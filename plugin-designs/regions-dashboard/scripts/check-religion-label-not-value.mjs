#!/usr/bin/env node
/* check-religion-label-not-value.mjs — `bun run check:religion-label-not-value`. Source-only, headless.
 *
 * REGREL: two LIBRARY sites showed RELIGION_FAMILIES values as English in every locale. The fix is to
 * project the LABEL through religionFamilyLabel() and leave the VALUE canonical English — because a
 * TRANSLATED VALUE MATCHES NOTHING. That is the language-link bug class: the moment a localized string
 * lands in a filter, a bus payload or an element attribute, the link works in English and silently
 * fails in Arabic.
 *
 * So this gate asserts BOTH halves. Projecting the label is the easy half; the half worth a gate is
 * that the value did NOT move with it.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeOnly } from './strip-code.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

// ── 1. BEHAVIOUR, against the SHIPPED catalogues ────────────────────────────────────────────────
// religion.js imports tStatic from library/i18n/index.js, which calls import.meta.glob — a Vite
// transform plain Node cannot run. So religionFamilyLabel's REAL SOURCE is extracted and executed with
// tStatic stubbed over the actual ar/ and en/ religion.json, rather than re-typed here: a copy would
// test the copy. Same approach as check-provider-for.mjs and check-optional-t-equivalence.mjs.
const relSrc = read('library/colors/religion.js')
const famBlock = /export const RELIGION_FAMILIES = \{[\s\S]*?\n\}/.exec(relSrc)
const labelFn = /export function religionFamilyLabel\(familyOrName\) \{[\s\S]*?\n\}/.exec(relSrc)
if (!famBlock || !labelFn) {
  console.error('  FAIL - could not extract RELIGION_FAMILIES / religionFamilyLabel: NOT MEASURED, not passing')
  process.exit(2)
}
const en = JSON.parse(read('library/i18n/locales/en/religion.json'))
const ar = JSON.parse(read('library/i18n/locales/ar/religion.json'))
const messages = { en: { religion: en }, ar: { religion: ar } }
const tStaticFor = (want) => (path) => {
  const walk = (loc) => String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), messages[loc])
  const v = walk(want)
  return typeof v === 'string' ? v : walk('en')
}
const build = (want) => new Function('tStatic',
  famBlock[0].replace(/^export /, '') + ';\n' + labelFn[0].replace(/^export /, '')
  + ';\nreturn { RELIGION_FAMILIES, religionFamilyLabel };')(tStaticFor(want))

const AR = build('ar'), EN = build('en')
ok(AR.religionFamilyLabel('C') === ar.family.Christianity,
  `under ar the LABEL is Arabic ("${ar.family.Christianity}")`)
ok(AR.RELIGION_FAMILIES.C === 'Christianity',
  'while the VALUE stays canonical English ("Christianity") -- a translated value would match nothing')
ok(AR.religionFamilyLabel('C') !== AR.RELIGION_FAMILIES.C,
  'CONTROL: label and value really DIFFER under ar, so the projection is doing something')
ok(EN.religionFamilyLabel('C') === 'Christianity',
  'under en the label equals the canonical name, so nothing changes for an English reader')
ok(AR.religionFamilyLabel('M') === ar.family.Islam && AR.religionFamilyLabel('H') === ar.family.Hinduism,
  'and it holds for more than one family (Islam, Hinduism)')
ok(AR.religionFamilyLabel('') === '', 'an empty family gives an empty label, not the word "undefined"')
ok(AR.religionFamilyLabel('Christianity') === ar.family.Christianity,
  'it accepts a NAME as well as a letter, as its signature promises (familyOrName)')
ok(AR.religionFamilyLabel('ZZZ') === 'ZZZ',
  'an unknown family falls through to the input rather than blanking the row')

// ── 2. THE HALF WORTH A GATE: the VALUE did not move with the label ─────────────────────────────
const legend = codeOnly(read('library/composables/legends/useLegendData.js'))
ok(/label:\s*religionFamilyLabel\(fam\)/.test(legend), 'useLegendData projects the LABEL through religionFamilyLabel(fam)')
ok(/key:\s*fam\b/.test(legend), 'and `key` is still the canonical family letter')
ok(/filterKey:\s*fam\b/.test(legend), 'and `filterKey` is still the canonical family letter -- this is what the filter compares')
ok(!/key:\s*religionFamilyLabel|filterKey:\s*religionFamilyLabel/.test(legend),
  'NEG: neither key nor filterKey is derived from the localized label')

const search = codeOnly(read('library/composables/useSearch.js'))
ok(/religions:\s*aggregate\(/.test(search), 'useSearch still aggregates religions')
ok(/\(e\) => religionFamilyLabel\(getReligionFamily\(/.test(search),
  'its LABEL function goes through religionFamilyLabel()')
ok(/\(e\) => getReligionFamily\(/.test(search),
  'and its KEY function is still bare getReligionFamily() -- the value is untouched')
ok(/key,\n\s*label:/.test(search) || /\bkey,\s*$/m.test(search),
  'aggregate() still emits key and label as SEPARATE fields, so a consumer can choose')

// ── 3. the consumer really does resolve by VALUE, which is why (2) is sufficient ────────────────
const consumer = codeOnly(read('plugin-designs/country-posters/countries-map.vue'))
ok(/kind === 'religion'/.test(consumer) && /expectedValue = detail\.expectedValue/.test(consumer),
  'the religion consumer resolves by detail.expectedValue, never by the label (countries-map)')

// ── 4. the stale comment that argued AGAINST this fix is gone ───────────────────────────────────
// ★ THIS ASSERTION FAILED ON MY OWN RETRACTION, which is worth recording. The first version required
// that "onGeocoderAggregateResult religion branch" be ABSENT from the file — but the corrected comment
// QUOTES that phrase in order to record what it used to claim, so the string is still there, inside the
// retraction that fixes it. Requiring the absence of a phrase punishes documenting the error. What I
// actually care about is that the claim is no longer presented as CURRENT, so assert the retraction.
const searchRaw = read('library/composables/useSearch.js')
ok(/USED TO SAY/.test(searchRaw) && /does not exist anywhere in this repo/.test(searchRaw),
  'the stale claim is RETRACTED in place, with the measurement that falsified it (the cited handler does not exist)')
ok(!/\/\/ into their family row\. label = family name so selection/.test(searchRaw),
  'and it no longer reads as a live requirement -- the original standalone sentence is gone')

// ── 5. NEG CONTROL: the behavioural half must be capable of failing ─────────────────────────────
const brokenLabel = (f) => ({ C: 'Christianity' })[f] || f   // an English-only "projection"
ok(brokenLabel('C') !== ar.family.Christianity,
  'NEG CONTROL: an English-only projection FAILS the ar assertion, so passing it means something')

console.log(fails ? `\nRELIGION-LABEL: ${fails} FAIL(s)` : '\nRELIGION-LABEL: the label follows the reader, the value stays canonical, and the filter still compares the value')
process.exit(fails ? 1 : 0)
