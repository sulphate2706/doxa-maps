#!/usr/bin/env node
// check-poster-degrades-honestly — with NO poster and NO source, say so. Do not
// open a print dialog on nothing.
//
// ★ THE UNCOVERED HALF. check:poster-print-fallback proves the GOOD path: when the
// .webp is missing but posters/<id>.html ships, the browser rasterises it. On a
// tree with neither — which is the DEFAULT drop, since posterSources and
// bundlePosters both default false — that gate SKIPs. So the behaviour a reader is
// most likely to meet was the one behaviour nothing asserted.
//
// The failure this guards against is not a 404. It is a print dialog that OPENS on
// a poster that does not exist: a blank sheet, or worse a low-resolution preview
// thumbnail printed as though it were the 3ft poster. Both look like the feature
// working. An honest refusal — "poster not found (404)" with a Close button — is
// the correct product behaviour and the one BUILD-POSTERS-GENERATE-ON-DEMAND-DROP-52MB
// claims in prose. This turns that claim into an assertion.
//
// ★ THE CONDITION IS FORCED, NOT FOUND. This gate used to look for a tree that served
// neither file and SKIP (exit 0) on any other. Two changes made that tree unreachable:
// the served tree now SHIPS the poster sources (the prayer packet's map needs them), and
// a wall whose host passes `sheet` GENERATES the poster first from the served
// lib/poster-render.js, so "no stored file" no longer means "nothing to print". It
// skipped every time, and the skip read as a pass. So the browser is now told the
// truth of the worst case directly: every posters/*.webp and *.html answers 404, and
// the generator does not load. What the reader is then shown is what this asserts, on
// any tree, whichever directory is served.
//
// Usage: node internal/check-poster-degrades-honestly.mjs <wallUrl>
import { chromium, NOT_MEASURED } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

const WALL = process.argv[2] || process.env.POSTER_WALL_URL
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(WALL, ROOT, 'POSTER-DEGRADES-HONESTLY')
if (!WALL) {
  // NOT MEASURED, not a pass: with no wall there is nothing to click, and exit 0 here read as green.
  console.log('POSTER-DEGRADES: NOT MEASURED — no wall url given (argv[2] or POSTER_WALL_URL).')
  process.exit(NOT_MEASURED)
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
let downloads = 0
page.on('download', () => { downloads += 1 })
const posterHits = []
page.on('response', (r) => { if (/\/posters\//.test(r.url())) posterHits.push(`${r.url().split('/').pop()}=${r.status()}`) })

// THE WORST CASE, forced (see the header): no stored poster, no source, no generator.
// Card thumbnails live under previews/ and still load, so the wall looks as it does to a reader.
let generatorBlocked = 0
await page.route(/\/posters\/[^/?]+\.(webp|html)(\?|$)/, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }))
await page.route(/\/lib\/poster-render(\.global)?\.js(\?|$)/, (route) => { generatorBlocked += 1; route.abort() })

await page.goto(WALL, { waitUntil: 'load', timeout: 45000 })
await page.waitForTimeout(8000)

// Count print frames at creation: openPrintFrame's frame self-removes on afterprint,
// so polling for iframes finds none and would read as a pass for the wrong reason.
let printFrames = 0
await page.exposeFunction('__notePrintFrame', () => { printFrames += 1 })
await page.evaluate(() => {
  const realAppend = Node.prototype.appendChild
  Node.prototype.appendChild = function (n) {
    const r = realAppend.call(this, n)
    try {
      if (n && n.tagName === 'IFRAME') {
        window.__notePrintFrame()
        try { n.contentWindow.print = () => {} } catch { /* cross-realm */ }
      }
    } catch { /* never break the page to observe it */ }
    return r
  }
  window.print = () => {}
})

const clicked = await page.evaluate(() => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out) }
    return out
  }
  const all = walk(document)
  // Skip cards that declare themselves unsupported — they short-circuit before any
  // fetch, so they would prove nothing about the missing-poster path.
  for (const card of all.filter((e) => (e.className || '').toString().split(' ').includes('card'))) {
    if (card.querySelector('.ph.is-soon')) continue
    const btn = [...card.querySelectorAll('button')]
      .find((e) => /poster/i.test(e.textContent || '') && !/show on map/i.test(e.textContent || ''))
    if (btn) { btn.click(); return (btn.textContent || '').trim() }
  }
  return null
})

let modal = []
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(1000)
  modal = await page.evaluate(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out) }
      return out
    }
    return walk(document)
      .filter((e) => /modal-(kind|title|msg|err|soon)/.test((e.className || '').toString()))
      .map((e) => (e.textContent || '').trim()).filter(Boolean)
  })
  if (modal.some((t) => /not found|unavailable|failed|error/i.test(t))) break
}
await browser.close()

const said = modal.join(' | ')
const fails = []
if (!clicked) fails.push('no poster print control found on any supported card')
// THE LOAD-BEARING ASSERTIONS.
if (printFrames > 0) {
  fails.push(`${printFrames} print frame(s) opened with NO poster and NO source — a print dialog on `
    + 'nothing is a blank sheet, or a preview thumbnail printed as a 3ft poster. Both look like it worked.')
}
if (downloads > 0) fails.push(`${downloads} download(s) started with no poster to deliver`)
if (clicked && !/not found|unavailable|failed|error/i.test(said)) {
  fails.push(`the reader was told nothing: modal read ${JSON.stringify(said) || '(empty)'} — `
    + 'a silent no-op is indistinguishable from a slow one')
}
// Both paths must have been TRIED, or this ran a shorter route than the product does.
if (clicked && !posterHits.some((h) => h.endsWith('=404') && h.includes('.webp'))) {
  fails.push(`the .webp was never requested (poster responses: ${JSON.stringify(posterHits)})`)
}
if (clicked && !posterHits.some((h) => h.includes('.html'))) {
  fails.push(`the .html fallback was never attempted (poster responses: ${JSON.stringify(posterHits)}) — `
    + 'the wall gave up before trying to rasterise')
}
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

console.log('POSTER-DEGRADES')
console.log(`  wall          : ${WALL}`)
console.log(`  clicked       : ${clicked || '(nothing)'}`)
console.log(`  poster fetches: ${JSON.stringify(posterHits)}`)
console.log(`  generator     : ${generatorBlocked} request(s) aborted${generatorBlocked ? '' : ' (this wall generated nothing first)'}`)
console.log(`  print frames  : ${printFrames}   downloads: ${downloads}`)
console.log(`  told the user : ${JSON.stringify(said) || '(nothing)'}`)

if (fails.length) {
  console.error(`\nPOSTER-DEGRADES: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nPOSTER-DEGRADES: PASS — with neither poster nor source, both are tried, nothing '
  + 'prints, and the reader is told why.')
