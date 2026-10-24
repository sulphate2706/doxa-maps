#!/usr/bin/env node
/**
 * check-poster-sizes.mjs — the poster-size LADDER (library/constants/posterSizes.js) says what it promises.
 *
 * Every print surface offers these sizes through one picker, and each renderer maps a key to its own
 * geometry. So the table itself must be right: a wrong sheet count or overlap prints a poster that does not
 * glue up to its size, and a landscape size breaks the portrait-only rule.
 *
 * ASSERTS: the picker order lists exactly the ladder; no size is both offered and legacy; only 66x66 and 60x96
 * are glued from several sheets; every key is dot-free (i18n paths, URLs); every size is
 * PORTRAIT (h ≥ w); the sheets glue up to the finished size (count × sheet − overlaps, in `direction`); a
 * photo slot is allowed on exactly the large sizes (66x66, 60x96); paper prints through the browser and the
 * rest through a print-shop PDF; every alias resolves; paperFor() picks Letter or A4 by region.
 * --self-test feeds broken copies of the table and must see each one refused.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const S = await import(pathToFileURL(join(ROOT, 'library/constants/posterSizes.js')).href)

const PHOTO_SIZES = ['66x66', '60x96']
// Every size up to 36x66 prints on ONE sheet; only these two are glued from several.
const MULTI_SHEET = ['66x66', '60x96']
function audit({ ladder, order, legacy, aliases }) {
  const bad = []
  const keys = Object.keys(ladder)
  if (order.join() !== keys.join()) bad.push(`the picker order [${order}] is not the ladder [${keys}]`)
  for (const [k, e] of [...Object.entries(ladder), ...Object.entries(legacy)]) {
    if (!/^[a-z0-9]+$/.test(k)) bad.push(`${k}: a key must be dot-free lowercase letters/digits`)
    if (e.id !== k) bad.push(`${k}: its id is "${e.id}"`)
    const { w, h } = e.inches
    if (!(h >= w)) bad.push(`${k}: ${w}×${h} in is landscape; every poster is portrait`)
    const s = e.sheets
    const W = s.direction === 'horizontal' ? s.count * s.sheetW - (s.count - 1) * s.joinIn : s.sheetW
    const H = s.direction === 'vertical' ? s.count * s.sheetH - (s.count - 1) * s.joinIn : s.sheetH
    if (W !== w || H !== h) bad.push(`${k}: ${s.count} sheet(s) of ${s.sheetW}×${s.sheetH} (${s.direction}, ${s.joinIn} in overlap) glue up to ${W}×${H}, not ${w}×${h}`)
    if (s.count === 1 && s.joinIn !== 0) bad.push(`${k}: one sheet cannot have a ${s.joinIn} in overlap`)
  }
  for (const k of Object.keys(legacy)) if (ladder[k]) bad.push(`${k} is both offered and legacy`)
  const multi = keys.filter((k) => ladder[k].sheets.count > 1)
  if (multi.join() !== MULTI_SHEET.join()) bad.push(`glued sizes are [${multi}], expected [${MULTI_SHEET}]; every other size is one sheet`)
  const photos = keys.filter((k) => ladder[k].photos)
  if (photos.join() !== PHOTO_SIZES.join()) bad.push(`photo slots are allowed on [${photos}], expected [${PHOTO_SIZES}] (the large sizes)`)
  for (const k of keys) {
    const want = ladder[k].paper ? 'print' : 'pdf'
    if (ladder[k].path !== want) bad.push(`${k}: path "${ladder[k].path}", expected "${want}"`)
  }
  for (const [a, t] of Object.entries(aliases)) if (!ladder[t] && !legacy[t]) bad.push(`alias ${a} → ${t}, which is not a size`)
  return bad
}
const table = { ladder: S.POSTER_LADDER, order: S.POSTER_LADDER_ORDER, legacy: S.POSTER_LADDER_LEGACY, aliases: S.POSTER_LADDER_ALIASES }
const problems = audit(table)
const paper = [['en-US', 'letter'], ['es-MX', 'letter'], ['fr-CA', 'letter'], ['en-GB', 'a4'], ['ar', 'a4'], ['zh-CN', 'a4'], ['en', 'letter']]
for (const [tag, want] of paper) if (S.paperFor(tag) !== want) problems.push(`paperFor('${tag}') is ${S.paperFor(tag)}, expected ${want}`)
if (S.resolvePosterSize('5x8ft')?.id !== '60x96' || S.resolvePosterSize('nope') !== null) problems.push('resolvePosterSize does not resolve an alias, or invents an unknown size')

if (process.argv.includes('--self-test')) {
  if (problems.length) { console.error('POSTER-SIZES SELF-TEST: FAIL — the real table already fails; fix that first.'); process.exit(1) }
  const clone = () => JSON.parse(JSON.stringify(table))
  const poisons = [
    ['one sheet short', (t) => { t.ladder['60x96'].sheets.count = 2 }],
    ['no overlap', (t) => { t.ladder['66x66'].sheets.joinIn = 0 }],
    ['landscape', (t) => { t.ladder['36x60'].inches = { w: 60, h: 36 }; t.ladder['36x60'].sheets = { sheetW: 60, sheetH: 36, count: 1, direction: 'vertical', joinIn: 0 } }],
    ['photos on a small size', (t) => { t.ladder['36x60'].photos = true }],
    ['a dotted key', (t) => { t.ladder['5.5x5.5'] = { ...t.ladder['66x66'], id: '5.5x5.5' }; t.order.push('5.5x5.5') }],
    ['order drift', (t) => { t.order.reverse() }],
    ['a dangling alias', (t) => { t.aliases['4x6ft'] = '48x72' }],
    ['paper through a PDF', (t) => { t.ladder.paper.path = 'pdf' }],
    ['offered and legacy at once', (t) => { t.legacy['36x48'] = t.ladder['36x48'] }],
    ['a single-sheet size split in two', (t) => { t.ladder['36x66'].sheets = { sheetW: 36, sheetH: 36, count: 2, direction: 'vertical', joinIn: 6 } }],
  ]
  let missed = 0
  for (const [name, poison] of poisons) { const t = clone(); poison(t); const caught = audit(t).length > 0; console.log(`  ${name}: ${caught ? 'caught' : 'NOT CAUGHT'}`); if (!caught) missed++ }
  if (missed) { console.error(`POSTER-SIZES SELF-TEST: FAIL — ${missed} poison(s) not caught.`); process.exit(1) }
  console.log(`POSTER-SIZES SELF-TEST: PASS — all ${poisons.length} broken tables refused.`); process.exit(0)
}
if (problems.length) { console.error('POSTER-SIZES: FAIL\n' + problems.map((p) => '  ✗ ' + p).join('\n')); process.exit(1) }
console.log(`POSTER-SIZES: PASS — ${S.POSTER_LADDER_ORDER.length} sizes (${S.POSTER_LADDER_ORDER.join(' · ')}), portrait, sheets glue up, photos on ${PHOTO_SIZES.join(' + ')}, ${Object.keys(S.POSTER_LADDER_ALIASES).length} aliases resolve, paper by region.`)
