#!/usr/bin/env node
/**
 * check-map-labels — the map on page 1 names its countries in the packet's language.
 *
 * Map sheets are generated once, in English; the packet relabels their country names (and the map's
 * privacy line) at print time (library/packet/mapLabels.js + packet-render.js liftMap). Checked on a
 * real tracked poster, the artwork page 1 actually lifts:
 *
 *   (1) ENGLISH IS UNTOUCHED — lifting with and without the relabeller is byte-identical in English,
 *       and the relabeller for English is null.
 *   (2) KNOWN NAMES ARE ALL REPLACED — in ar and zh no known English label survives, every halo still
 *       matches its fill, and the privacy line takes the language's own sentence.
 *   (3) THE WIDTH GUARD FITS, NEVER GROWS — no label is ever set larger than the sheet's size, the guard
 *       FIRES for a translation wider than its English (ar), and does NOT for shorter ones (zh).
 *   (4) TRACKING OFF WHERE IT BREAKS SCRIPT — Arabic labels drop letter-spacing; Spanish capitals keep it.
 *   (5) UNKNOWN LABELS ARE LEFT AS DRAWN — never guessed.
 *
 * Exit 0 pass · 1 fail · 75 NOT MEASURED.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const POSTER = join(REPO, 'data/posters/sudan.html')
if (!existsSync(POSTER)) {
  console.error('MAP-LABELS: NOT MEASURED (exit 75) — no tracked poster at data/posters/sudan.html to lift')
  process.exit(75)
}
const { createPacketRenderer } = await import(join(REPO, 'library/packet/packet-render.js'))
const { makeCountryLabelFor } = await import(join(REPO, 'library/packet/mapLabels.js'))
const { ISO3_NAME } = await import(join(REPO, 'plugin-designs/my-upg-100-list/data/territory-counts.js'))
const strings = JSON.parse(readFileSync(join(REPO, 'library/scripts/posters/packet-strings.json'), 'utf8'))
const a2 = JSON.parse(readFileSync(join(REPO, 'library/data/iso3-to-alpha2.json'), 'utf8')).map
const countryName = (iso3, lc) => { const t = a2[iso3]; try { return t ? new Intl.DisplayNames([lc], { type: 'region' }).of(t) : '' } catch { return '' } }
// A label the generator cannot draw, planted to prove unknowns are left alone.
const poster = readFileSync(POSTER, 'utf8').replace('</svg>', '<text x="1" y="1" text-anchor="middle" class="ctry-name">ATLANTIS</text></svg>')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const KNOWN = new Set(Object.values(ISO3_NAME).map((n) => esc(String(n).toUpperCase())))
const labels = (html) => [...html.matchAll(/<text([^>]*class="(ctry-name(?:-halo|-own)?)"[^>]*)>([^<]*)<\/text>/g)]
  .map((m) => ({ attrs: m[1], cls: m[2], text: m[3], px: Number((m[1].match(/font-size:([\d.]+)px/) || [])[1]) || null }))
const base = Number((poster.match(/\.ctry-name\{[^}]*font-size:([\d.]+)px/) || [])[1]) || 15
const fails = [], notes = []
const ok = (c, msg, note) => { if (!c) fails.push(msg); else if (note) notes.push(`  ok    ${note}`) }
const lift = (lc) => createPacketRenderer({ strings, lang: lc }).liftMap(poster, { labelFor: makeCountryLabelFor({ iso3Name: ISO3_NAME, countryName, lang: lc }) })

// (1)
{
  const R = createPacketRenderer({ strings, lang: 'en' })
  ok(makeCountryLabelFor({ iso3Name: ISO3_NAME, countryName, lang: 'en' }) === null, 'the English relabeller is not null')
  ok(R.liftMap(poster) === lift('en'), 'lifting in English CHANGED the sheet', 'English: the lifted sheet is byte-identical with and without the relabeller')
}
const out = { ar: lift('ar'), zh: lift('zh'), es: lift('es') }
// (2)
for (const lc of ['ar', 'zh']) {
  const L = labels(out[lc])
  const left = L.filter((l) => KNOWN.has(l.text)).map((l) => l.text)
  const halos = L.filter((l) => l.cls === 'ctry-name-halo'), fills = L.filter((l) => l.cls !== 'ctry-name-halo')
  ok(!left.length, `${lc}: English country names survived: ${[...new Set(left)].join(', ')}`)
  ok(halos.length && halos.every((h, i) => fills[i] && fills[i].text === h.text), `${lc}: a halo no longer matches its fill — the outline and the name would disagree`)
  ok(out[lc].includes(esc(strings[lc].privacy_note)), `${lc}: the map's privacy line was not localized`)
  if (!left.length) notes.push(`  ok    ${lc}: ${halos.length} country labels relabelled, halo = fill, privacy line localized`)
}
// (3)
{
  const all = [...labels(out.ar), ...labels(out.zh), ...labels(out.es)]
  ok(all.every((l) => l.px === null || l.px <= base + 1e-9), 'a relabelled name was set LARGER than the sheet\'s label size')
  const arShrunk = labels(out.ar).filter((l) => l.px !== null && l.px < base).length
  const zhShrunk = labels(out.zh).filter((l) => l.px !== null && l.px < base).length
  ok(arShrunk > 0, 'the width guard never fired in Arabic, where the Saudi Arabia label is far wider than its English')
  ok(zhShrunk === 0, `the width guard shrank ${zhShrunk} Chinese label(s) that are narrower than their English`,
    `width guard: shrinks ${arShrunk} Arabic labels to fit their English boxes, none of the narrower Chinese, and grows nothing`)
}
// (4)
{
  const arFill = labels(out.ar).filter((l) => l.cls !== 'ctry-name-halo' && !KNOWN.has(l.text) && l.text !== 'ATLANTIS')
  const esFill = labels(out.es).filter((l) => l.cls !== 'ctry-name-halo' && l.text !== 'ATLANTIS')
  ok(arFill.length && arFill.every((l) => /letter-spacing:0/.test(l.attrs)), 'Arabic labels keep the capitals\' tracking, which breaks letter joining')
  ok(esFill.every((l) => !/letter-spacing:0/.test(l.attrs)), 'Spanish capitals lost their tracking',
    'tracking is dropped for Arabic and kept for Spanish capitals')
}
// (5)
ok(labels(out.ar).filter((l) => l.text === 'ATLANTIS').length === 1, 'an unknown label was altered or removed', 'an unknown label is left exactly as drawn')

for (const n of notes) console.log(n)
if (fails.length) {
  console.error('MAP-LABELS: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('MAP-LABELS: PASS — the map names its countries in the packet\'s language, fits each name to its English box, and leaves English untouched.')
