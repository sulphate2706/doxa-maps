#!/usr/bin/env node
// check-legend-export-reachable — the Export affordance must be reachable AT BOTH WIDTHS.
//
// ★ WHAT THIS CAUGHT. The Export menu lives in SemanticTreeLegend, which upg-100-list.vue mounts
// for DESKTOP only ("Hidden below the mobile breakpoint, where <LegendMobile>..."). LegendMobile —
// the phone bottom-sheet — contains the string "export" ZERO times. So on a phone a reader can
// browse the UPG-100 lists and cannot export a packet or a poster. No error, nothing to click; the
// failure is invisible rather than broken, which is why it survived.
//
// The packet IS the product for this profile, so the print options sit at the top right of the
// legend: without them that map is not usable.
//
// ⚠ THE CONTROL IS GATED ON A SELECTION. `v-if="SHOW_EXPORT_BUTTON && exportEnabled && selectedNode"`
// — so a probe that merely loads the page finds nothing at EITHER width and concludes "no export
// anywhere". Measured: that was my first reading and it was wrong. This gate SELECTS A LEAF ROW
// first, and asserts the 0 -> n transition, which is also what proves the control is selection-gated
// rather than always-on.
//
// ⚠ AND ON MOBILE THE LEGEND STARTS CLOSED. 20 rows exist with 0 visible until the "Show or hide
// the legend" control is clicked. A probe that skips that step reports "no rows on mobile", which is
// a true statement about the wrong surface — the second wrong reading this gate encodes against.
//
// ⚠ VISIBILITY IS GEOMETRY, NOT A CSS PROPERTY. The mobile elements report display:block and
// visibility:visible while measuring 0x0 at (0,0) inside an overflow:hidden parent — the desktop
// panel rendered but never laid out. A predicate reading `visibility` would call that visible.
// Assert a real box.
//
// Usage: node internal/check-legend-export-reachable.mjs [leafUrl]
//   SKIPs when nothing is served — this needs the built tree.
import { chromium } from './lib/playwright-guarded.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const DEFAULT_LEAF = (process.env.BASE_URL || 'http://127.0.0.1:4173')
  + `/${TREE_NAME}/my-upg-100-list/upg-100-list/index.html`
const LEAF = process.argv[2] || DEFAULT_LEAF

let reachable = false
try {
  const r = await fetch(LEAF, { signal: AbortSignal.timeout(4000) })
  reachable = r.ok
} catch { /* a precondition, not a product failure */ }
if (!reachable) {
  console.log(`LEGEND-EXPORT-REACHABLE: SKIP — nothing served at ${LEAF}.`)
  console.log('  Serve the built tree: python3 -m http.server 4173 --directory public (or set BASE_URL)')
  process.exit(0)
}
// Measure THIS build, or measure nothing (exit 75 = NOT MEASURED; see a9550858 / _serves-this-tree.mjs).
await requireThisTree(LEAF, resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'LEGEND-EXPORT-REACHABLE')

const WALK = `(root, out) => { out = out || []; const rec = (r) => { for (const e of r.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) rec(e.shadowRoot) } }; rec(root); return out }`

async function probe(browser, { name, width, height, mobile }) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 110)))
  await page.goto(LEAF, { waitUntil: 'load', timeout: 45000 })
  await page.waitForTimeout(9000)

  const before = await page.evaluate(`(${WALK})(document).filter(e => (e.className||'').toString().includes('stl-export')).length`)

  // On a phone the legend starts closed — open it first, or every row query returns nothing.
  // ⚠ ONLY OPEN THE SHEET IF IT IS SHUT. This clicked the toggle unconditionally, which is
  // right for my-upg-100-list (its sheet starts CLOSED) and exactly wrong for country-posters,
  // whose sheet opens EXPANDED — measured 2026-09-24: 8 rows visible before the click, 0 after.
  // The gate was closing the panel it came to inspect and then reporting "no selectable row",
  // which reads as a product defect and is purely the probe. Toggle only when there is nothing
  // to select yet.
  const openedSheet = await page.evaluate(`(() => {
    const all = (${WALK})(document)
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 }
    const rowsNow = all.filter(e => (e.className||'').toString().includes('stl-row')).filter(vis).length
    if (rowsNow > 0) return false
    const b = all.filter(e => e.tagName === 'BUTTON')
      .find(e => /show or hide the legend|toggle.?legend/i.test(e.getAttribute('aria-label') || ''))
    if (!b) return false
    b.click(); return true
  })()`)
  if (openedSheet) await page.waitForTimeout(2200)

  // Select a LEAF row. Height-bounded because a container also carries .stl-row-ish classes and
  // clicking it selects nothing — measured: its textContent is the whole list concatenated.
  const clicked = await page.evaluate(`(() => {
    const rows = (${WALK})(document)
      .filter(e => (e.className||'').toString().includes('stl-row'))
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 60 })
    if (!rows.length) return null
    rows[0].click()
    return (rows[0].textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30)
  })()`)
  await page.waitForTimeout(2200)

  const after = await page.evaluate(`(() => {
    const el = (${WALK})(document).filter(e => (e.className||'').toString().includes('stl-export'))
    // A REAL BOX, not a CSS property: the mobile case reports visibility:visible at 0x0.
    const boxed = el.filter(e => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
    return { total: el.length, boxed: boxed.length,
             label: boxed.map(e => (e.textContent || '').trim().slice(0, 18))[0] || '' }
  })()`)
  await page.close()
  return { name, before, openedSheet, clicked, ...after, errs }
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
let results
try {
  results = [
    await probe(browser, { name: 'desktop', width: 1500, height: 1000, mobile: false }),
    await probe(browser, { name: 'mobile', width: 390, height: 844, mobile: true }),
  ]
} finally {
  await browser.close()
}

console.log('LEGEND-EXPORT-REACHABLE')
console.log(`  leaf     : ${LEAF}`)
for (const r of results) {
  console.log(`  ${r.name.padEnd(8)}: selected ${JSON.stringify(r.clicked)} — `
    + `.stl-export ${r.before} -> ${r.total} present, ${r.boxed} with a real box`
    + `${r.label ? ` ("${r.label}")` : ''}${r.openedSheet ? '  [opened the sheet first]' : ''}`)
}

const fails = []
for (const r of results) {
  if (!r.clicked) {
    fails.push(`${r.name}: no selectable legend row — the probe could not reach the state the `
      + 'export control is gated on, so this width was not actually tested')
    continue
  }
  if (r.boxed === 0) {
    fails.push(`${r.name}: the Export affordance has NO reachable box`
      + (r.total > 0
        ? ` — ${r.total} .stl-export element(s) exist but all measure 0x0, i.e. the desktop legend `
          + 'rendered without being laid out. A reader here can browse the lists and cannot export '
          + 'a packet or a poster.'
        : ' — no .stl-export element at all.'))
  }
  if (r.errs.length) fails.push(`${r.name}: ${r.errs.length} page error(s): ${r.errs[0]}`)
}

if (fails.length) {
  console.error(`\nLEGEND-EXPORT-REACHABLE: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  console.error('\n  The packet IS the product for this profile. See '
    + 'BUG-UPG100-PACKET-AND-POSTER-EXPORT-ARE-UNREACHABLE-ON-A-PHONE — WHERE the control goes on a '
    + 'phone is a design call (the sheet has no titlebar), so this gate names the gap rather than '
    + 'assuming a fix.')
  process.exit(1)
}
console.log('\nLEGEND-EXPORT-REACHABLE: PASS — selecting a list reveals a reachable Export control at '
  + 'every width tested.')
