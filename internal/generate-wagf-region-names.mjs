#!/usr/bin/env node
/**
 * generate-wagf-region-names.mjs — the WAGF region names, in the reader's language, from vendored CLDR.
 *
 * ★ THE DEFECT (KA3, 3d64bcad, ?lang=ar). Big Picture's region chart labels its bars with the
 * prayer API's ENGLISH region names — "Africa", "Asia", "Latin America & Caribbean" — on an Arabic page.
 * They are not chrome and no catalogue held them: they are DATA labels, so every i18n gate was green
 * while the chart read English to every reader. The regions are a closed set of seven
 * (library/colors/wagf-region.js WAGF_REGIONS), which is what makes cataloguing them possible at all.
 *
 * ★ WHY GENERATED AND NOT HAND-AUTHORED. Ten locales x seven names is seventy strings that cannot be hand-written reliably.
 * Five of the seven ARE standard UN M49 macro-regions, so CLDR already names them in every locale we
 * ship, and Node's own ICU is the same data library/utils/countryName.js already trusts for countries.
 * Generating is what keeps a translation out of my hands: the strings are copied from CLDR, committed,
 * and reviewable, and re-running this reproduces them byte for byte.
 *
 *   africa -> 002 · asia -> 142 · europe -> 150 · latin_america_&_caribbean -> 419 · oceania -> 009
 *
 * ★ TWO REGIONS ARE DELIBERATELY NOT WRITTEN, because CLDR has no code that means them:
 *   · middle_east — M49 145 is "Western Asia", a different set (it includes the Caucasus and excludes
 *     Egypt). Naming it "Western Asia" in ten locales would silently redraw the region.
 *   · north_america_&_non-spanish_caribbean — M49 021 is "Northern America", which excludes the
 *     Caribbean this bucket exists to include.
 *   Both stay English, provisional, pending a product decision on a translation source. An English label a reader can
 *   still match to the map beats a localized label that names the wrong territory.
 *
 * ★ AND ONE SCOPE NOTE ON 419: CLDR's long name is "Latin America" while our label says
 * "Latin America & Caribbean". The ENGLISH entry keeps our wording (it is the authored, authoritative
 * one); the other ten take CLDR's, which omits the Caribbean from the NAME while the bucket still holds
 * it. Recorded here rather than silently accepted — the alternative was English in ten locales.
 *
 *   node internal/generate-wagf-region-names.mjs            # write
 *   node internal/generate-wagf-region-names.mjs --check    # verify the catalogue matches CLDR (CI)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const M49 = { africa: '002', asia: '142', europe: '150', 'latin_america_&_caribbean': '419', oceania: '009' }
const HELD = ['middle_east', 'north_america_&_non-spanish_caribbean']
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'pt', 'ro', 'ru', 'zh']
// The English entries stay as the product authored them (see the 419 note above); every other locale
// is CLDR's. Read from the one file that already owns the region set, so a seventh region added there
// shows up here as a missing name rather than as a silent English label.
const { WAGF_REGIONS } = await import(join(ROOT, 'library/colors/wagf-region.js'))

const names = (lc) => {
  const dn = new Intl.DisplayNames([lc], { type: 'region' })
  const out = {}
  for (const [slug, code] of Object.entries(M49)) out[slug] = lc === 'en' ? WAGF_REGIONS[slug] : dn.of(code)
  return out
}
let wrote = 0
const drift = []
for (const lc of LOCALES) {
  const p = join(ROOT, 'library/i18n/locales', lc, 'dashboard.json')
  const cat = JSON.parse(readFileSync(p, 'utf8'))
  const want = names(lc)
  if (CHECK) {
    const have = cat.wagfRegion || {}
    for (const [k, v] of Object.entries(want)) if (have[k] !== v) drift.push(`${lc}.wagfRegion.${k}: catalogue ${JSON.stringify(have[k])} vs CLDR ${JSON.stringify(v)}`)
    continue
  }
  cat.wagfRegion = want
  writeFileSync(p, JSON.stringify(cat, null, 2) + '\n')
  wrote++
}
const unaccounted = Object.keys(WAGF_REGIONS).filter((s) => !M49[s] && !HELD.includes(s))
if (unaccounted.length) {
  console.error(`WAGF-REGION-NAMES: FAIL — ${unaccounted.length} region(s) in WAGF_REGIONS have neither a CLDR code nor a recorded reason: ${unaccounted.join(', ')}`)
  process.exit(1)
}
if (CHECK) {
  if (drift.length) { console.error(`WAGF-REGION-NAMES: FAIL — ${drift.length} catalogue entry(ies) no longer match CLDR:\n  ${drift.join('\n  ')}`); process.exit(1) }
  console.log(`WAGF-REGION-NAMES: PASS — ${Object.keys(M49).length} name(s) x ${LOCALES.length} locale(s) match vendored CLDR; ${HELD.length} held in English on purpose (${HELD.join(', ')}).`)
} else {
  console.log(`WAGF-REGION-NAMES: wrote ${Object.keys(M49).length} name(s) into ${wrote} locale catalogue(s); ${HELD.length} held in English (${HELD.join(', ')}).`)
}
