/**
 * check-gospel-composed-filters.mjs — cell C: the map COMPOSED above its own tables.
 *
 * THE CLAIM UNDER TEST is not "it renders". It is that the composite keeps the reader INSIDE
 * it. Standalone, the sheet's "Every resource in <language>" is a LINK to the tables page.
 * Composed, it must become an in-place FILTER, because navigating away throws out the map the
 * reader has just positioned and the group they have just found. Two different affordances
 * behind the same words, and only one of them is right in each context.
 *
 * WHAT IT ASSERTS, and each one is a way the composite can look fine and be broken:
 *   - the control is a <button>, not an <a>          (a link here navigates)
 *   - the URL does not change                        (proves it did not navigate)
 *   - the table's ROW COUNT goes down                (proves the filter reached the data)
 *   - the row count stays above zero                 (proves it filtered rather than emptied)
 *   - the pin count is unchanged                     (proves the map survived the click)
 *   - no response >= 400 and no page error           (proves it did not paper over a failure)
 *
 * IT PICKS ITS SUBJECT FROM THE DATA, and that is not a detail. The first run of this check
 * opened pin 0 — Abai Sungai, a group with NOTHING found — so the filter correctly produced an
 * empty table and the check failed a working composite. The test was wrong, not the product.
 * It now selects a tier-2 pin from the live source, so "rows went down but not to zero" is a
 * question the subject can actually answer.
 *
 * BROWSER GATE. Run it under both rendezvous locks, product lock first — the fixed order is
 * what makes the pair deadlock-free:
 *     flock -w 1200 <product-lock> flock -w 1200 <agent-lock> bun run check:composed-filters
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { serveReaped } from './_serve-reaped.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(HERE, '../public')
const PORT = Number(process.env.PORT || 5399)
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(BASE, ROOT, 'GOSPEL-COMPOSED-FILTERS')
const PATHNAME = `/${TREE_NAME}/gospel-resources/gospel-dashboard/index.html`

let srv = null
if (!process.env.BASE_URL) srv = serveReaped(PUBLIC, PORT)

const fail = (msg) => { console.error(`COMPOSED-FILTERS: FAIL — ${msg}`); srv?.stop(); process.exit(1) }

let browser
try {
  browser = await chromium.launch()
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  const bad = []
  p.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`) })
  p.on('pageerror', (e) => bad.push(`pageerror: ${String(e.message).slice(0, 120)}`))

  await p.goto(`${BASE}${PATHNAME}`, { waitUntil: 'networkidle', timeout: 90000 })
  await p.waitForFunction(() => window.__grState && window.__grState().pins > 0, null, { timeout: 60000 })
  await p.waitForTimeout(8000)

  const read = () => p.evaluate(() => {
    const r = document.querySelector('gospel-resources-map').shadowRoot
    return {
      pins: window.__grState().rendered,
      rows: r.querySelectorAll('.tabulator-row').length,
      url: location.href,
      chip: (r.querySelector('.gt-filter')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    }
  })

  const before = await read()
  if (!before.rows) fail('the composed tables rendered no rows at all, so a filter proves nothing.')

  const idx = await p.evaluate(() => {
    const f = window.__grMap.getSource('gr-pin-src')._data.features
    const hit = f.find((x) => x.properties.tier === 2) || f[0]
    return hit.properties.i
  })
  await p.evaluate((i) => window.__grOpenPin(i), idx)
  await p.waitForTimeout(2000)

  const clicked = await p.evaluate(() => {
    const r = document.querySelector('gospel-resources-map').shadowRoot
    const btn = [...r.querySelectorAll('.gm-tablink')].find((e) => /Every resource in/i.test(e.textContent))
    if (!btn) return null
    const tag = btn.tagName.toLowerCase()
    btn.click()
    return { tag, text: btn.textContent.trim().slice(0, 60) }
  })
  if (!clicked) fail('no "Every resource in ..." control in the group sheet.')
  if (clicked.tag !== 'button') fail(`the control is a <${clicked.tag}>, not a <button> — composed, it must filter, not navigate.`)

  await p.waitForTimeout(3000)
  const after = await read()

  console.log(`  control : pins=${before.pins} rows=${before.rows}`)
  console.log(`  clicked : <${clicked.tag}> "${clicked.text}"`)
  console.log(`  after   : pins=${after.pins} rows=${after.rows}`)
  console.log(`  filter  : ${after.chip || '(none)'}`)

  if (after.url !== before.url) fail(`it NAVIGATED (${before.url} -> ${after.url}); the map the reader positioned is gone.`)
  if (after.pins !== before.pins) fail(`the map lost pins on the click: ${before.pins} -> ${after.pins}.`)
  if (!(after.rows < before.rows)) fail(`the table did not narrow: ${before.rows} -> ${after.rows}.`)
  if (after.rows === 0) fail('the table emptied rather than filtered — subject had no resources, so this proves nothing.')
  if (bad.length) fail(`${bad.length} failed request(s) or page error(s): ${[...new Set(bad)].slice(0, 3).join(' | ')}`)

  console.log('COMPOSED-FILTERS: PASS — filters in place, keeps the map and the URL, no failed requests.')
} finally {
  await browser?.close()
  srv?.stop()
}
