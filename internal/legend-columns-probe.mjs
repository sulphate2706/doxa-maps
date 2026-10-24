/**
 * legend-columns-probe — are the legend table columns properly spaced?
 *
 * Opens a page, finds the visible semantic-tree legend inside the map's shadow DOM and
 * measures every header cell and the first N data rows: the cell box, the actual text
 * extent (a Range over the text, so overflow is caught), spill past the box, and
 * text-vs-text overlap between neighbouring columns. Exit 1 on any overlap or spill.
 *
 * Usage:  node internal/legend-columns-probe.mjs [--url <page>] [--tag doxa-map]
 *                [--width 1440] [--height 900] [--rows 8]
 *         Phone widths (< 600) tap the sheet's drag strip first so the rows are visible.
 *         Site:       --url http://localhost:3001/pray --tag doxa-map
 *                     --url http://localhost:3001/research/ --tag doxa-research-map
 *         Plugin gallery dev server: --url http://localhost:5174/plugin-designs/doxa-simple-map/index.html
 */
import { launch, TELEMETRY } from './lib/browser.mjs'
import { requireDevServesThisCheckout } from './_serves-this-tree.mjs'
import { fileURLToPath as __f2p } from 'node:url'
import { dirname as __dn, resolve as __rs } from 'node:path'
const args = process.argv.slice(2); const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const URL = argOf('--url', 'http://localhost:3001/pray'), TAG = argOf('--tag', 'doxa-map'), W = +argOf('--width', 1440), H = +argOf('--height', 900), ROWS = +argOf('--rows', 8)
// Guard ONLY when pointed at OUR dev gallery (/plugin-designs/…). The default target is the DX-life
// site (a different app this probe compares against on purpose), which has no source of ours to match.
if (/\/plugin-designs\//.test(URL)) await requireDevServesThisCheckout(URL, __rs(__dn(__f2p(import.meta.url)), '..'), 'LEGEND-COLUMNS')
const browser = await launch('firefox', { label: 'legend-columns' })
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: W < 600 }); const page = await ctx.newPage()
await page.route(TELEMETRY, r => r.abort())
await page.goto(URL, { waitUntil: 'domcontentloaded' })
// Phone widths: the legend lives in a bottom sheet that starts collapsed (rows hidden). A tap on
// the drag strip opens it — the same gesture the mobile-sheet probe uses.
if (W < 600) {
  const strip = () => page.evaluate(() => { const deepAll = (root, sel, out = []) => { for (const el of root.querySelectorAll('*')) { if (el.matches(sel)) out.push(el); if (el.shadowRoot) deepAll(el.shadowRoot, sel, out) } return out }; const s = deepAll(document, '.sheet-drag-strip').find(e => e.getBoundingClientRect().width > 0); if (!s) return null; s.scrollIntoView({ block: 'center' }); const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  let st = null; for (let i = 0; i < 60 && !st; i++) { st = await strip(); if (!st) await page.waitForTimeout(500) }
  if (st) { await page.touchscreen.tap(st.x, st.y); await page.waitForTimeout(700) } else console.log('[legend-columns] no drag strip found — measuring whatever is visible')
}
const measure = (arg) => {
  const deepAll = (root, sel, out = []) => { for (const el of root.querySelectorAll('*')) { if (el.matches(sel)) out.push(el); if (el.shadowRoot) deepAll(el.shadowRoot, sel, out) } return out }
  const panel = deepAll(document, '.stl-panel').find(p => p.getBoundingClientRect().width > 0 && p.querySelector('.stl-row')); if (!panel) return { ready: false }
  const rows = [...panel.querySelectorAll('.stl-row')]; if (!rows.length) return { ready: false }
  const textRect = (el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width } }
  const cell = (el) => { const b = el.getBoundingClientRect(); const t = textRect(el); return { text: el.textContent.trim().replace(/\s+/g, ' '), box: [Math.round(b.left), Math.round(b.right)], boxW: Math.round(b.width), textW: Math.round(t.w), textL: Math.round(t.l), textR: Math.round(t.r), spill: Math.max(0, Math.round(t.r - b.right), Math.round(b.left - t.l)), font: getComputedStyle(el).fontSize } }
  const line = (cells) => { cells.sort((a, b) => a.box[0] - b.box[0]); const overlaps = []; for (let i = 0; i + 1 < cells.length; i++) { const o = cells[i].textR - cells[i + 1].textL; if (o > 0) overlaps.push({ a: cells[i].text, b: cells[i + 1].text, px: o }) } return { cells, overlaps } }
  const hdr = panel.querySelector('.stl-col-hdr'); const header = hdr ? line([...hdr.querySelectorAll('.stl-hdr-name, .stl-hdr-num')].map(cell)) : null
  const body = rows.slice(0, arg.rows).map(r => line([...r.querySelectorAll('.stl-name, .stl-num')].map(cell)))
  const cs = getComputedStyle(panel)
  return { ready: true, panelW: Math.round(panel.getBoundingClientRect().width), numW: cs.getPropertyValue('--stl-num-w').trim(), gap: cs.getPropertyValue('--stl-gap').trim(), inSheet: !!panel.closest('.legend-mobile-sheet'), rowCount: rows.length, header, body }
}
let res; for (let i = 0; i < 60; i++) { res = await page.evaluate(measure, { rows: ROWS }); if (res.ready) break; await page.waitForTimeout(500) }
await browser.close()
if (!res?.ready) { console.log('legend rows never rendered'); process.exit(2) }
console.log(`[legend-columns] ${URL} @${W}×${H} · panel ${res.panelW}px · --stl-num-w ${res.numW} · gap ${res.gap} · rows ${res.rowCount}`)
const fmt = (c) => `${JSON.stringify(c.text).padEnd(22)} box ${String(c.boxW).padStart(3)}px  text ${String(c.textW).padStart(3)}px @${c.font}${c.spill ? `  SPILL ${c.spill}px` : ''}`
const show = (label, l) => { console.log(`— ${label}`); for (const c of l.cells) console.log('   ' + fmt(c)); for (const o of l.overlaps) console.log(`   ✗ overlap ${o.px}px: "${o.a}" ↔ "${o.b}"`) }
if (res.header) show('header', res.header)
res.body.forEach((l, i) => show(`row ${i + 1}`, l))
const total = (res.header?.overlaps.length || 0) + res.body.reduce((n, l) => n + l.overlaps.length, 0)
const spills = [...(res.header?.cells || []), ...res.body.flatMap(l => l.cells)].filter(c => c.spill).length
console.log(`\n[legend-columns] ${total} overlap(s) · ${spills} spilling cell(s)`); process.exit(total || spills ? 1 : 0)
