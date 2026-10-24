/**
 * internal/lib/browser.mjs — helpers shared by the Playwright smoke gates
 * (plugin-gallery-smoke.mjs, share-roundtrip-smoke.mjs).
 *
 *   launch(browserName, { label })   Firefox by default (house rule: never Google Chrome;
 *                                    Playwright's bundled Chromium is allowed via 'chromium').
 *                                    If Playwright's PINNED Firefox revision is missing, falls
 *                                    back to any cached ~/.cache/ms-playwright/firefox-* build;
 *                                    same fallback for the bundled Chromium (any cached
 *                                    chromium-<rev> build — still Playwright's, never
 *                                    Google Chrome).
 *   TELEMETRY                        console/network noise to ignore (Mapbox telemetry beacons).
 *   DEEP_FIND_SRC                    page-side `deepFind(root, sel)` source: querySelector that
 *                                    recurses into every nested OPEN shadow root (composite MFEs
 *                                    nest custom elements, each with its own shadow root).
 *   DEEP_FIND_ALL_SRC                page-side `deepFindAll(root, sel)`: the COUNTING counterpart —
 *                                    returns EVERY match across nested open shadow roots, deduped
 *                                    via a seen-Set (a node reachable through two roots counts once).
 *   deepEvaluate(page, fn, arg)      page.evaluate with both bound: fn receives
 *                                    (deepFind, arg, deepFindAll). The third parameter is APPENDED,
 *                                    so every existing caller taking (deepFind, arg) is unaffected.
 *                                    Composed in Node (no eval inside the page, so a host CSP
 *                                    cannot break it).
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import * as pw from './playwright-guarded.mjs'

export const TELEMETRY = /events\.mapbox\.com/

const CACHE = join(homedir(), '.cache', 'ms-playwright')
// Newest cached build dir for a browser prefix ('firefox-', 'chromium-') whose binary exists.
function cachedBinary(prefix, ...rel) {
  const cands = existsSync(CACHE) ? readdirSync(CACHE).filter(d => d.startsWith(prefix) && /^\d+$/.test(d.slice(prefix.length))).sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length))) : []
  for (const d of cands) {
    // chromium ships as chrome-linux64/ (newer) or chrome-linux/ (older)
    const dirs = rel.length ? [rel] : existsSync(join(CACHE, d)) ? readdirSync(join(CACHE, d)).filter(s => s.startsWith('chrome-linux')).map(s => [s, 'chrome']) : []
    for (const parts of dirs) { const bin = join(CACHE, d, ...parts); if (existsSync(bin)) return { dir: d, bin } }
  }
  return null
}

export async function launch(browserName = 'firefox', { label = 'browser' } = {}) {
  const CHROMIUM_ARGS = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
  if (browserName === 'chromium') {
    try { return await pw.chromium.launch({ args: CHROMIUM_ARGS }) } catch (e) {
      const c = cachedBinary('chromium-')
      if (c) { console.log(`[${label}] pinned Chromium missing — using cached ${c.dir}`); return pw.chromium.launch({ executablePath: c.bin, args: CHROMIUM_ARGS }) }
      throw e
    }
  }
  if (browserName !== 'firefox') throw new Error(`--browser ${browserName} is not allowed (firefox|chromium — Google Chrome is never used)`)
  try { return await pw.firefox.launch() } catch (e) {
    const c = cachedBinary('firefox-', 'firefox', 'firefox')
    if (c) { console.log(`[${label}] pinned Firefox missing — using cached ${c.dir}`); return pw.firefox.launch({ executablePath: c.bin }) }
    throw e
  }
}

// Page-side. Recursion works because deepEvaluate binds it as `const deepFind = …`.
export const DEEP_FIND_SRC = `(root, sel) => {
  if (!root || !root.querySelector) return null
  const hit = root.querySelector(sel); if (hit) return hit
  for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const h = deepFind(el.shadowRoot, sel); if (h) return h } }
  return null
}`

// ── deepFindAll — the COUNTING counterpart to deepFind ───────────────────────────────────────
//
// WHY THIS EXISTS (added 2026-09-22). deepFind returns the FIRST match and stops. Every
// count-based assertion needs all of them — how many rows, anchors, hints, canvases — and because
// this file offered no such helper, each ad-hoc probe hand-rolled its own shadow walker. Measured
// across one session of verification work, those hand-rolled walkers produced FOUR false results:
//
//   · a naive walker double-visited through nested roots and reported 48 cards for 24;
//   · a single-level querySelector found 0 anchors in a composite that had 155;
//   · a `.rd-row` count included a DETAIL PANEL sharing that class, so a correct filter read as broken;
//   · a `<script` prefix match counted the word `scriptUrl` in a comment and flagged a valid file.
//
// Two of those nearly became bug reports against working code. A missing helper does not stop
// anyone writing the check — it just moves the check somewhere nobody reviews.
//
// SEEN-SET DEDUPE IS THE LOAD-BEARING PART. A node reachable through two roots must be counted
// ONCE; without the Set the count silently doubles, which is the first failure above.
export const DEEP_FIND_ALL_SRC = `(root, sel, _seen) => {
  const seen = _seen || new Set()
  const out = []
  if (!root || !root.querySelectorAll) return out
  for (const el of root.querySelectorAll(sel)) { if (!seen.has(el)) { seen.add(el); out.push(el) } }
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) out.push(...deepFindAll(el.shadowRoot, sel, seen))
  }
  return out
}`

export function deepEvaluate(page, fn, arg) {
  const composed = new Function('arg',
    `const deepFind = ${DEEP_FIND_SRC};\n` +
    `const deepFindAll = ${DEEP_FIND_ALL_SRC};\n` +
    `return (${fn.toString()})(deepFind, arg, deepFindAll)`)
  return page.evaluate(composed, arg)
}
