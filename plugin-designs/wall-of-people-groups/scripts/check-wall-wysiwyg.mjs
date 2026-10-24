#!/usr/bin/env node
/**
 * check-wall-wysiwyg — the Wall's screen IS its poster. Headless.
 *
 * The Bless view draws the poster on screen (screenPoster) and prints it (buildBlessPosterHtml) from one
 * layout (blessPoster.js). This asserts they stay one, for every preset: the same number of sheets, the
 * same 2,107 card rects (to 0.002 in), the same per-card name size and wrap (cardText), the same verse
 * reference size, the same chrome blocks (banner, themes, footer, journey), and sheets at the preset's
 * aspect. A change to either path that is not made to both fails here.
 *
 * Two-sided: each arm is also run against a planted defect (one screen card moved 0.01 in, one name
 * printed a point larger, one chrome block missing on screen), and each must be caught.
 * EXIT 0 pass · 1 fail
 */
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const m = await import(pathToFileURL(join(ROOT, 'plugin-designs/wall-of-people-groups/src/blessPoster.js')).href)
const names = Array.from({ length: 2107 }, (_, i) => (i % 97 === 0 ? 'Han Chinese, Mandarin-speaking lowlands ' + i : i % 13 === 0 ? 'Accukattavandlu' : 'Group ' + i))
const groups = names.map((name) => ({ name }))
const CARD_RE = /<div class="card" style="left:([\d.]+)in;top:([\d.]+)in;width:([\d.]+)in;height:([\d.]+)in"><div class="nm( w2)?" dir="auto" style="font-size:([\d.]+)pt(?:;-webkit-line-clamp:\d)?">/g

/** Every way the screen and the print disagree for one preset. `plant` may damage the screen side. */
function compare(id, plant = null) {
  const html = m.buildBlessPosterHtml(groups, id, {})
  const sp = m.screenPoster(groups, id, {})
  let cardText = m.cardText
  if (plant) ({ cardText = m.cardText } = plant(sp) || {})
  const P = sp.plan.preset, px = sp.pxPerIn, step = P.sheetH + m.SCREEN_GAP_IN
  const cards = [...html.matchAll(CARD_RE)]
  const pages = (html.match(/<section class="sheet">/g) || []).length
  const errs = []
  if (pages !== P.sheets || sp.sheets.length !== P.sheets) errs.push(`sheets: print ${pages}, screen ${sp.sheets.length}`)
  if (cards.length !== groups.length || sp.cards.length !== groups.length) errs.push(`cards: print ${cards.length}, screen ${sp.cards.length}`)
  for (const R of sp.sheets) if (Math.abs(R.w / R.h - P.sheetW / P.sheetH) > 1e-9) errs.push('a screen sheet is not at the preset\'s aspect')
  sp.cards.forEach((c, k) => {
    const pc = sp.plan.cards[k], h = cards[k]
    if (!h) return
    const ct = cardText(sp.plan, names[c.i])
    const d = Math.max(Math.abs(c.x / px - +h[1]), Math.abs(c.y / px - (pc.s * step + +h[2])), Math.abs(c.w / px - +h[3]), Math.abs(c.h / px - +h[4]))
    if (d > 0.002) errs.push(`card ${c.i}: rect off by ${d.toFixed(4)} in`)
    if (+h[6] !== ct.name.pt || !!h[5] !== ct.name.wrap) errs.push(`card ${c.i}: name prints ${h[6]} pt${h[5] || ''}, screen says ${ct.name.pt} pt${ct.name.wrap ? ' w2' : ''}`)
  })
  const ref = /\.card \.rf\{font-size:([\d.]+)pt/.exec(html)
  if (!ref || +ref[1] !== cardText(sp.plan, '').refPt) errs.push('the verse reference size differs')
  for (const k of ['class="ban"', 'class="themes"', 'class="ftr"', 'class="jny"']) {
    if (html.includes(k) !== sp.chromeHtml.includes(k)) errs.push(`chrome block ${k} is on one side only`)
  }
  return { errs, P, sp }
}

let fails = 0
for (const id of Object.keys(m.PRESETS)) {
  const { errs, P, sp } = compare(id)
  console.log(`  ${errs.length ? 'FAIL' : 'ok  '}  ${id}: ${P.sheets} sheet(s) of ${P.sheetW}×${P.sheetH} in, ${groups.length} cards at the same rects and sizes; screen world ${sp.worldW}×${sp.worldH} px${errs.length ? '\n        ' + errs.slice(0, 5).join('\n        ') : ''}`)
  fails += errs.length ? 1 : 0
}

// Planted defects: each must make the comparison fail.
const id0 = Object.keys(m.PRESETS)[0]
const PLANTS = [
  ['one screen card moved 0.01 in', (sp) => { sp.cards[5].x += 0.01 * sp.pxPerIn }],
  ['one name a point larger on screen', () => ({ cardText: (plan, name) => { const t = m.cardText(plan, name); return name === names[7] ? { ...t, name: { ...t.name, pt: t.name.pt + 1 } } : t } })],
  ['the footer missing on screen', (sp) => { sp.chromeHtml = sp.chromeHtml.replace('class="ftr"', 'class="xx"') }],
]
let caught = 0
for (const [what, plant] of PLANTS) {
  if (compare(id0, plant).errs.length) caught++
  else { console.log(`  FAIL  SELF-TEST: a planted defect was not caught (${what})`); fails++ }
}

if (fails) { console.log(`WALL-WYSIWYG: FAIL — ${fails} problem(s)`); process.exit(1) }
console.log(`WALL-WYSIWYG: PASS — screen and print are one layout on every preset (${Object.keys(m.PRESETS).join(', ')}); ${caught} planted defects each caught.`)
