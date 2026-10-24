#!/usr/bin/env node
// check-poster-print-fallback — the PRINT preview must survive a missing .webp.
//
// ★ THE ASYMMETRY THIS GUARDS. posters/*.webp is not shipped by default (42MB;
// bundling it pushed the tree to 80MB, git-packed to 57MiB, and the catalog
// rejected the push outright). The DOWNLOAD path has always handled that —
// PosterWall.vue fetches posters/<id>.html and rasterises it in the browser. The
// PRINT path did not: it handed an <img> a url it never checked, so on a default
// drop the SAME poster downloaded fine and printed as "Poster not available yet."
//
// Two paths, one missing file, different outcomes — and the difference was
// invisible to every existing gate, because check:poster-raster drives the
// RENDERER directly and never goes near the print button.
//
// ⚠ IT INTERCEPTS THE PRINTED HTML rather than reading the frame back.
// openPrintFrame calls window.print(), which BLOCKS in headless Chromium, and the
// frame self-removes on afterprint — reading it back measures a frame that has
// already gone. Same technique as check-deck-click.
//
// ⚠ IT FORCES THE MISS. The dev tree may or may not have the .webp; a gate whose
// result depends on that is measuring the fixture, not the product. So every
// request for posters/<id>.webp is failed at the network layer, which is exactly
// the default-drop condition, and the .html is left reachable.
//
// Usage: node internal/check-poster-print-fallback.mjs [wallUrl] [zoneId]
//   With no wallUrl it serves THIS checkout's public/ on a free port and opens the UPG-100 poster wall.
import { chromium, requireBrowserSlot, NOT_MEASURED } from './lib/playwright-guarded.mjs'
import { requireThisTree, serveThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ PART 1, NO BROWSER, SO IT RUNS IN EVERY WAVE: the BUILT TREE carries the poster sources its build
// config ships. The prayer packet's first page (the zone map) and this print fallback both fetch
// <tree>/assets/posters/<id>.html. A tree without them printed page 1 BLANK: the packet swallows a
// failed map fetch so the other pages still print, so nothing said why. Byte-identical, not merely
// present: a stale copy prints an old map just as quietly.
const CFG = JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
if (CFG.posterSources !== true && CFG.bundlePosters !== true) {
  console.log('POSTER-PRINT-FALLBACK: NOT MEASURED — this build config ships no poster sources (posterSources and')
  console.log('  bundlePosters are both off), so a tree built from it has nothing to rasterise.')
  process.exit(NOT_MEASURED)
}
const SRC_DIR = join(ROOT, 'data', 'posters')
const TREE_DIR = join(ROOT, 'public', TREE_NAME, 'assets', 'posters')
const sources = existsSync(SRC_DIR) ? readdirSync(SRC_DIR).filter((f) => f.endsWith('.html')).sort() : []
const missing = sources.filter((f) => !existsSync(join(TREE_DIR, f)))
const stale = sources.filter((f) => !missing.includes(f)
  && !readFileSync(join(TREE_DIR, f)).equals(readFileSync(join(SRC_DIR, f))))
if (!sources.length || missing.length || stale.length) {
  console.error('POSTER-PRINT-FALLBACK: FAIL — the built tree does not carry the poster sources its config ships.')
  if (!sources.length) console.error('  - data/posters/ holds no <id>.html at all')
  if (missing.length) console.error(`  - ${missing.length} of ${sources.length} missing from public/${TREE_NAME}/assets/posters/: ${missing.slice(0, 6).join(', ')}`)
  if (stale.length) console.error(`  - ${stale.length} differ from data/posters/ (the tree is older than its source): ${stale.slice(0, 6).join(', ')}`)
  console.error('  Regenerate the tree (node internal/generate-tree.mjs) and commit public/.')
  process.exit(1)
}
console.log(`  · the tree carries all ${sources.length} poster sources, byte-identical to data/posters/`)

// PART 2, THE BROWSER: only on the browser seat, inside the slot. Anywhere else this is NOT MEASURED
// (75), never a pass: part 1 above is what an ordinary wave can vouch for.
requireBrowserSlot('POSTER-PRINT-FALLBACK')

// No url given: serve THIS checkout and open its own UPG-100 wall, so the gate RUNS by default. It
// used to SKIP with exit 0 for want of an argument, which a wave reads as a pass.
let WALL = process.argv[2] || process.env.POSTER_WALL_URL || ''
if (!WALL) {
  const own = await serveThisTree(join(ROOT, 'public'))
  if (!own) {
    console.log('POSTER-PRINT-FALLBACK: NOT MEASURED — could not start a server for this checkout.')
    process.exit(NOT_MEASURED)
  }
  process.once('exit', () => own.stop())
  WALL = `${own.origin}/${TREE_NAME}/my-upg-100-list/poster-wall/index.html`
}

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(WALL, ROOT, 'POSTER-PRINT-FALLBACK')

// The poster SOURCE must be reachable before any of this means anything. Without it
// the fallback has nothing to rasterise and every assertion below would report a
// product bug that is really a missing fixture.
const probeId = process.argv[3] || 'laos'
// ⚠ '../../assets', NOT '../assets'. A leaf page lives at
// <tree>/<bundle>/<profile>/index.html and resolves assetsBase to '../../assets' —
// two levels up, to the TREE root. Measured 2026-09-24: this probe used one level,
// so it 404'd on a tree that DID carry the sources and this gate SKIPped with
// "posterSources:true was not set" when it had been. A precondition check that is
// wrong about the precondition silently turns the whole gate off.
const srcUrl = new URL(`../../assets/posters/${probeId}.html`, WALL).href
try {
  const r = await fetch(srcUrl)
  if (!r.ok) {
    console.log(`POSTER-PRINT-FALLBACK: NOT MEASURED — ${srcUrl} is ${r.status}.`)
    console.log('  The SERVED tree lacks this poster source (another build, or one made with posterSources off).')
    process.exit(NOT_MEASURED)
  }
} catch {
  console.log(`POSTER-PRINT-FALLBACK: NOT MEASURED — cannot reach ${srcUrl} (no server?).`)
  process.exit(NOT_MEASURED)
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))

// THE DEFAULT-DROP CONDITION, forced: the print-resolution image is absent, its
// HTML source is not. Anything else would leave the gate at the mercy of whether
// this particular checkout happens to carry 42MB of posters.
//
// ★ AND THE GENERATOR IS UNAVAILABLE. A wall whose host passes `sheet` now GENERATES
// the poster first (packet/posterSheets.js, running the served lib/poster-render.js)
// and never touches posters/ at all. Blocking only the .webp left this gate measuring
// the generator: measured twice on the served tree, 0 .webp and 0 .html requests, and a
// FAIL that said nothing about the fallback. The stored-file path is what a reader gets
// when that generator cannot load (a policy that refuses both the blob and the classic
// script, a failed integrity check, a print while offline), so the generator is blocked
// too, and the .html is the one way through.
// ★ ASSERT THE OUTCOME, NOT THE REQUEST (2026-09-29). A poison run answered 404 to posters/<id>.html
// for the browser only, and this gate still PASSED: it counted the REQUEST, and its failure pattern did
// not match what the wall then says ("poster not found (404)"). So it could not fail on the one path it
// exists for. It now requires the .html to ANSWER 200, a print frame to actually OPEN (counted at
// creation, the degrade gate's technique), and reads "not found" as the failure it is.
let webpBlocked = 0
let htmlServed = 0
let htmlOk = 0
let printFrames = 0
let generatorBlocked = 0
page.on('response', (r) => { if (/\/posters\/[^/?]+\.html(\?|$)/.test(r.url()) && r.status() === 200) htmlOk += 1 })
await page.exposeFunction('__notePrintFrame', () => { printFrames += 1 })
await page.route('**/posters/*.webp', (route) => { webpBlocked += 1; route.abort() })
await page.route('**/posters/*.html', (route) => { htmlServed += 1; route.continue() })
await page.route(/\/lib\/poster-render(\.global)?\.js(\?|$)/, (route) => { generatorBlocked += 1; route.abort() })

await page.goto(WALL, { waitUntil: 'load', timeout: 45000 })
await page.waitForTimeout(8000)

// Capture what reaches the print frame instead of letting it print-and-vanish.
// ⚠ ASSERT THE HUD, NOT doc.write. Three separate attempts to intercept the printed
// document all captured nothing while the feature DEMONSTRABLY worked (the HUD ran
// "generating the poster" and finished clean): openPrintFrame writes into the iframe's
// OWN realm, calls doc.open() AFTER append — which resets the document and discards a
// patched write — and the frame self-removes on afterprint. A capture that silently
// misses reports a product bug that is not there.
// The HUD is the better assertion anyway: it is what a USER sees, it survives a
// refactor of the print internals, and it distinguishes the three outcomes that
// matter — rasterised / shipped-image / failed — which is exactly what this gate is for.
await page.evaluate(() => {
  window.__HUD = []
  window.print = () => {}
  // Count print frames AT CREATION: the frame self-removes on afterprint, so polling finds none.
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
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out) }
    return out
  }
  window.__readHud = () => walk(document)
    .filter((e) => e.childElementCount === 0 && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE')
    .map((e) => (e.textContent || '').trim())
    .filter((t) => t && /generating|preparing|saving|not found|not available|failed|blank|error/i.test(t))
  setInterval(() => { for (const t of window.__readHud()) if (!window.__HUD.includes(t)) window.__HUD.push(t) }, 120)
})

// Click the REAL print control, found by its accessible name through every shadow root.
const clicked = await page.evaluate(() => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll('*')) {
      out.push(el)
      if (el.shadowRoot) walk(el.shadowRoot, out)
    }
    return out
  }
  const all = walk(document)
  const btn = all.find((el) => {
    if (!(el instanceof HTMLElement)) return false
    if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') return false
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`
    // ⚠ THE CONTROL IS NOT LABELLED "print". It reads "UPG prayer poster" — the
    // product names the ARTEFACT, not the action. A /print/i matcher finds nothing
    // and this gate then reports "nothing reached the print frame", which reads as a
    // product bug and is purely the selector. Measured 2026-09-24: the .webp and
    // .html request counters even LOOKED corroborating, because the wall loads both
    // on its own. Match the poster control, and exclude its siblings by name.
    return /poster/i.test(label) && !/list|deck|packet|show on map/i.test(label)
  })
  if (!btn) {
    return { ok: false, labels: all.filter((e) => e.tagName === 'BUTTON')
      .map((e) => (e.getAttribute('title') || e.textContent || '').trim().slice(0, 30)).filter(Boolean).slice(0, 14) }
  }
  btn.click()
  return { ok: true }
})

let hud = []
let settled = false
if (clicked.ok) {
  // Rasterising a 3000px poster takes real time; poll for the terminal state rather
  // than guessing one timeout.
  for (let i = 0; i < 45 && !settled; i++) {
    await page.waitForTimeout(1000)
    hud = await page.evaluate(() => window.__HUD || [])
    // Terminal states: an explicit failure, or "generating" seen AND no longer showing.
    const live = await page.evaluate(() => window.__readHud())
    const failing = hud.some((t) => /not found|not available|failed|blank|error/i.test(t))
    const generated = hud.some((t) => /generating/i.test(t))
    if (failing) { settled = true; break }
    if (generated && !live.some((t) => /generating|preparing|saving/i.test(t))) { settled = true }
  }
}
await browser.close()

const fails = []
if (!clicked.ok) {
  fails.push(`no poster print control found in any shadow root (buttons seen: ${(clicked.labels || []).join(' | ')})`)
}
if (clicked.ok && !hud.length) {
  fails.push('the poster control was clicked but the export HUD never reported anything — '
    + 'the click did not reach printPoster at all')
}
// THE LOAD-BEARING ASSERTIONS.
if (hud.some((t) => /Poster not available yet/i.test(t))) {
  fails.push('the print preview opened on "Poster not available yet" — the old behaviour: '
    + 'the .webp 404ed and the rasterise fallback did not run')
}
if (hud.some((t) => /not found|not available|failed|blank|error/i.test(t))) {
  fails.push(`the print path ended in an error state: ${JSON.stringify(hud.filter((t) => /not found|not available|failed|blank|error/i.test(t)))}`)
}
// With EVERY .webp aborted, a clean run is only possible via the rasteriser — so the
// "generating the poster" phase MUST have been entered. Its absence means the preview
// came from somewhere this gate did not intend, and proves nothing about the fallback.
if (clicked.ok && !hud.some((t) => /generating/i.test(t))) {
  fails.push(`the fallback never entered its "generating the poster" phase (HUD: ${JSON.stringify(hud)}) — `
    + 'with every .webp aborted there is no other way to a working preview, so this did not exercise the fallback')
}
if (clicked.ok && !settled) {
  fails.push('the print path never reached a terminal state within 45s')
}
if (webpBlocked === 0) {
  fails.push('no posters/*.webp request was made at all — the print path never probed the '
    + 'image, so this gate did not exercise the fallback it exists to test')
}
if (htmlServed === 0) {
  fails.push('no posters/*.html was fetched — the rasterise fallback never ran')
} else if (htmlOk === 0) {
  // THE OUTCOME, not the attempt: requested is not loaded, and a 404 source rasterises nothing.
  fails.push(`posters/*.html was requested ${htmlServed} time(s) but never answered 200 — the fallback had no source to rasterise`)
}
if (clicked.ok && printFrames === 0) {
  fails.push('no print frame opened — the print path never reached the dialog, so nothing was printed')
}
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

console.log('POSTER-PRINT-FALLBACK')
console.log(`  wall            : ${WALL}`)
console.log(`  .webp requests  : ${webpBlocked} (all aborted — the default-drop condition)`)
console.log(`  .html requests  : ${htmlServed} (${htmlOk} answered 200)`)
console.log(`  print frames    : ${printFrames}`)
console.log(`  generator       : ${generatorBlocked} request(s) aborted${generatorBlocked ? '' : ' (this wall generated nothing first)'}`)
console.log(`  print button    : ${clicked.ok ? 'found and clicked' : 'NOT FOUND'}`)
console.log(`  HUD             : ${hud.length ? JSON.stringify(hud) : '(nothing)'}`)

if (fails.length) {
  console.error(`\nPOSTER-PRINT-FALLBACK: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nPOSTER-PRINT-FALLBACK: PASS — with the generator unavailable and every .webp missing, the print '
  + 'preview still opens on a real rasterised poster instead of "Poster not available yet".')
