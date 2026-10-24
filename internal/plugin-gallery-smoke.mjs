#!/usr/bin/env node
/**
 * plugin-gallery-smoke.mjs — prove EVERY element in the auto-generated dev SPA
 * (the plugin gallery served by `bun x vite` at /__gallery) actually works.
 *
 * WHY: the plugin gallery is the architecture demo and the pre-handoff gate — "all
 * the maps work in the auto-generated SPA" must be a checked fact, not a hope.
 * embed-smoke.mjs proves the BUILT pages boot; THIS proves each element boots
 * inside the plugin gallery shell: element defined, shadow DOM populated, no
 * ProfileLoader error card, and (for map profiles) a WebGL canvas present.
 *
 * HOW: reads the plugin gallery's own registry (GET /__plugin-gallery/registry.json —
 * the same discovery the page renders), then opens each element by DEEP LINK
 * (/#/<bundle>/<profile>[/<instance>]) in a FRESH page, one at a time (sequential by
 * default so a laptop's memory / WebGL-context budget is never blown), and audits the mount.
 * Browser: Firefox by default (house rule: never Google Chrome; Playwright's
 * bundled Chromium is also allowed via --browser chromium when installed). If
 * Playwright's pinned Firefox revision is missing, falls back to any cached one.
 *
 * Usage:  node internal/plugin-gallery-smoke.mjs [--url http://localhost:5173] [--page <gallery url>]
 *         EXPECT_CANVAS=1 …   also require a WebGL canvas on map profiles (needs a real GPU)
 *
 * (This usage line said 5174 for one tick after the default changed to 5173 — a comment describing
 *  the old behaviour, which is exactly the kind of line someone copies verbatim.)
 *           [--grep <substr>] [--browser firefox|chromium] [--parallel 1]
 *           [--wait 12000] [--json <out.json>]
 * Exit:   0 all pass · 1 any fail (list printed)
 * Every failure is a builder-cycle backlog candidate — the --json report carries
 * the evidence (console errors, page errors, mount state, timing).
 */
import { writeFileSync } from 'node:fs'
import { launch, deepEvaluate, TELEMETRY } from './lib/browser.mjs'
import { requireDevServesThisCheckout as __devGuard, requireThisTree as __treeGuard } from './_serves-this-tree.mjs'
import { fileURLToPath as __f2p } from 'node:url'
import { dirname as __dn, resolve as __rs } from 'node:path'
const __ROOT = __rs(__dn(__f2p(import.meta.url)), '..')

const args = process.argv.slice(2)
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
// ★ 5173, NOT 5174. `bun run dev` is `bun x vite`, whose default port is 5173; the 5174 default
// here meant the documented invocation `bun run smoke:gallery` failed with
// "cannot read http://localhost:5174/__plugin-gallery/registry.json — is `bun x vite` running?"
// against a dev server that WAS running, on the port the repo's own dev script uses. A gate that
// cannot reach its subject has not passed and has not failed: it has not run, and the message
// blames the user for not starting a server they had started.
const BASE = String(argOf('--url', process.env.DEV_URL || 'http://localhost:5173')).replace(/\/+$/, '')
// Measure THIS checkout, or measure nothing (exit 75 = NOT MEASURED; see _serves-this-tree.mjs).
await __devGuard(BASE, __ROOT, 'PLUGIN-GALLERY-SMOKE')

// Paint needs a GPU this build box does not have; see the long note at the canvas assertion below.
const EXPECT_CANVAS = process.env.EXPECT_CANVAS === '1'
// ── THE GALLERY PAGE IS NO LONGER AT `/` (2026-09-22) ──────────────────────────────────────────
// `/` now mounts <plugin-studio> in both trees; the gallery moved to the explicit /__gallery.
// This gate asserts the GALLERY's DOM contract (a #slot the chosen element is mounted into), which
// the studio does not have and is not supposed to have — it mounts panes into its own shadow root
// on tab activation. So the two URLs must be separable:
//   --url   the SERVER ROOT, where /__plugin-gallery/registry.json lives (discovery)
//   --page  the GALLERY PAGE the deep links are appended to (defaults to <url>/__gallery)
// They were ONE argument, which is why pointing --url at the gallery broke discovery (the registry
// 404'd at /__gallery/__plugin-gallery/registry.json) while leaving it at the root made every
// target fail against the studio's DOM — 29 confident ✗ lines describing a page that was working.
// A gate aimed at the wrong surface reports FAIL just as loudly as a real regression, and the
// output gives no hint which it is; that is the expensive part, not the red text.
const PAGE = String(argOf('--page', `${BASE}/__gallery`)).replace(/\/+$/, '')
const GREP = argOf('--grep', '')
const BROWSER = argOf('--browser', 'firefox')
const PARALLEL = Math.max(1, Number(argOf('--parallel', 1)))
const WAIT = Number(argOf('--wait', 12000))
const JSON_OUT = argOf('--json', '')
// browser launch (Firefox first; cached-Firefox fallback), TELEMETRY filter and the
// shadow-piercing deepFind live in internal/lib/browser.mjs — shared with share-roundtrip-smoke.

// ── targets: every element the plugin gallery lists ─────────────────────────
const regRes = await fetch(`${BASE}/__plugin-gallery/registry.json`).catch(() => null)
if (!regRes || !regRes.ok) { console.error(`[plugin-gallery-smoke] cannot read ${BASE}/__plugin-gallery/registry.json — is \`bun x vite\` running?`); process.exit(2) }
const registry = await regRes.json()
const targets = []
for (const b of registry) for (const it of b.items) {
  // The gallery's deep-link key: <bundle>/<profile>, plus /<id> for a preset instance.
  const key = `${b.bundle}/${it.profile}${it.type === 'parameterized' ? `/${it.id}` : ''}`
  if (GREP && !key.includes(GREP) && !String(it.label).includes(GREP)) continue
  // A WebGL canvas is expected for map profiles and for composites (their maps live inside
  // NESTED custom elements — checked deep); lists/tables/charts/poster walls are DOM-only.
  const expectCanvas = (/map/i.test(it.profile) && !/list|table|chart|wall|dashboard/i.test(it.profile))
    || it.type === 'nested-elements-mfe' || it.type === 'nested-mfe-spa'
  targets.push({ bundle: b.bundle, tag: b.tag, id: it.id, key, label: it.label, type: it.type, profile: it.profile, expectCanvas, url: `${PAGE}#/${key.split('/').map(encodeURIComponent).join('/')}` })
}
console.log(`[plugin-gallery-smoke] ${targets.length} element(s) from ${registry.length} bundle(s) @ ${PAGE} (registry @ ${BASE})`)

const browser = await launch(BROWSER, { label: 'plugin-gallery-smoke' })

async function check(t) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = [], pageErrors = [], dataProblems = []
  page.on('console', m => { if (m.type() === 'error' && !TELEMETRY.test(m.text())) consoleErrors.push(m.text().slice(0, 240)) })
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 240)))
  // Data contract evidence: a .json/.geojson request answered with HTML (dev-server
  // fallback for a path nobody serves) or 4xx/5xx is the classic silent map killer —
  // the profile's JSON.parse throws before it ever creates the map.
  page.on('response', res => {
    const u = res.url()
    if (!/\.(geo)?json(\?|$)/i.test(u) || TELEMETRY.test(u)) return
    const ct = res.headers()['content-type'] || ''
    if (res.status() >= 400) dataProblems.push(`${res.status()} ${u}`)
    else if (/text\/html/i.test(ct)) dataProblems.push(`HTML instead of JSON ← ${u}`)
  })
  const t0 = Date.now()
  const r = { ...t, pass: false, why: '', ms: 0, defined: false, shadowChildren: 0, errorCard: null, statusText: null, canvas: false, activeRow: null, consoleErrors, pageErrors, dataProblems }
  try {
    await page.goto(t.url, { waitUntil: 'load', timeout: 60000 })
    // poll until the element mounts a canvas / an error card / or we run out of patience
    const deadline = Date.now() + WAIT
    let state = null
    while (Date.now() < deadline) {
      // Composite MFEs nest further custom elements (each with its own shadow root):
      // deepFind (bound by deepEvaluate) searches every nested shadow root, not just the outer one.
      state = await deepEvaluate(page, (deepFind, tag) => {
        const el = document.querySelector('#slot > *')
        const defined = !!customElements.get(tag)
        const sr = el && el.shadowRoot
        const children = sr ? sr.childElementCount : 0
        const err = sr ? deepFind(sr, '.profile-error') : null
        // The profile's OWN status line (e.g. "JSON.parse: unexpected character…") — the
        // ProfileLoader card only covers boot failures; init failures land here.
        const st = sr ? deepFind(sr, '[role="alert"], [role="status"], [class*="status"], [class*="error"], [class*="err"]') : null
        const canvas = !!(sr && deepFind(sr, 'canvas'))
        const row = document.querySelector('button.row[aria-current="true"]')
        // Host contract: some profiles take the engine as a page global (window.mapboxgl).
        const hostHasMapbox = typeof window.mapboxgl !== 'undefined'
        return { mountedTag: el ? el.tagName.toLowerCase() : null, defined, children, errorCard: err ? err.textContent.trim().slice(0, 160) : null, statusText: st && st.textContent.trim() ? st.textContent.trim().slice(0, 160) : null, canvas, activeRow: row ? row.dataset.k : null, hostHasMapbox }
      }, t.tag)
      if (state.errorCard || (state.children > 0 && (state.canvas || !t.expectCanvas))) break
      await page.waitForTimeout(400)
    }
    await page.waitForTimeout(1200) // let late errors surface
    Object.assign(r, { defined: state?.defined, shadowChildren: state?.children ?? 0, errorCard: state?.errorCard, statusText: state?.statusText ?? null, canvas: state?.canvas, activeRow: state?.activeRow, mountedTag: state?.mountedTag })
    r.ms = Date.now() - t0
    const problems = []
    if (r.activeRow !== t.key) problems.push(`deep link resolved to ${r.activeRow}`)
    if (!r.mountedTag) problems.push('nothing mounted in #slot')
    else if (r.mountedTag !== t.tag) problems.push(`mounted <${r.mountedTag}>, expected <${t.tag}>`)
    if (!r.defined) problems.push(`custom element <${t.tag}> not defined`)
    if (r.shadowChildren === 0) problems.push('shadow DOM empty')
    if (r.errorCard) problems.push(`ProfileLoader error: ${r.errorCard}`)
    // ★ A CANVAS REQUIREMENT CANNOT HOLD ON A BOX WITH NO WebGL (measured 2026-09-22).
    // This build VPS has no hardware GL, so EVERY map profile failed here with "no WebGL canvas"
    // regardless of whether anything was wrong — 34 elements, all red, from an assertion the
    // environment could never satisfy. That is a gate that cannot PASS, and it is as useless as one
    // that cannot fail: it gets ignored, and the REAL finding underneath it gets ignored with it.
    //
    // What it was actually reporting, buried under the false signal, was genuine: `data: 404
    // http://localhost:5173/manifest.json` — the archived /__gallery page fetches a BARE relative
    // manifest with no base, so it resolves against `/` instead of `/__gallery/`. The studio at `/`
    // is correct (it carries tree-base="/__plugin-gallery" and smoke:studio passes in ~5s), so the
    // defect belongs to the archived surface alone.
    //
    // So the canvas assertion is now opt-in via EXPECT_CANVAS=1, for a machine that has GL. Paint is
    // verified separately by verify:map-paint, which uses SwiftShader deliberately. Everything else
    // this gate checks — the element is defined, it mounted its own tag, its shadow root is not
    // empty, no ProfileLoader error card, no page errors, no data 404s — is environment-independent
    // and still enforced.
    if (EXPECT_CANVAS && t.expectCanvas && !r.canvas) {
      let why = 'no WebGL canvas (map did not initialize)'
      if (state?.hostHasMapbox === false) why += ' — window.mapboxgl is UNDEFINED on the host page (profile expects the Mapbox peer)'
      if (r.statusText) why += ` — profile status: "${r.statusText}"`
      if (dataProblems.length) why += ` — data: ${dataProblems[0]}${dataProblems.length > 1 ? ` (+${dataProblems.length - 1} more)` : ''}`
      problems.push(why)
    }
    // ★ DATA 404s ARE THEIR OWN FINDING, not a footnote on the canvas message. They used to be
    // appended to the "no WebGL canvas" string, so on a box without GL they were reported only as
    // part of a failure that was itself environmental — and on a box WITH GL a map that painted
    // fine would have hidden them entirely. A missing .json/.geojson is a real, checkable defect on
    // any machine; it earns its own line.
    if (dataProblems.length) {
      problems.push(`data: ${dataProblems[0]}${dataProblems.length > 1 ? ` (+${dataProblems.length - 1} more)` : ''}`)
    }
    // ★ A WebGL PAGE ERROR IS THE SAME ENVIRONMENTAL LIMIT COMING BACK THROUGH ANOTHER DOOR.
    // Removing the canvas ASSERTION was not enough: on a box with no GL the map library still logs
    // "Failed to initialize WebGL", and every console error counted as a failure — so the gate still
    // could not pass here, just with a different sentence. Measured 2026-09-22: of 34 elements, 26
    // passed and 7 failed, from exactly two causes — 3 WebGL page errors (environmental) and 3
    // manifest 404s (a real defect on the archived /__gallery page).
    //
    // FILTERED, NOT SUPPRESSED, and the difference matters: the count of filtered errors is PRINTED,
    // so an exemption can never hide behind silence. Anything that is not the GL-init message still
    // fails the gate. With EXPECT_CANVAS=1 on a machine that has GL, nothing is filtered at all.
    const GL_NOISE = /failed to initialize webgl|webgl.*not supported|getcontext.*webgl/i
    const realPageErrors = EXPECT_CANVAS ? pageErrors : pageErrors.filter((e) => !GL_NOISE.test(e))
    const glFiltered = pageErrors.length - realPageErrors.length
    if (glFiltered) r.glNoise = glFiltered
    if (realPageErrors.length) problems.push(`page error: ${realPageErrors[0]}`)
    r.pass = problems.length === 0
    r.why = problems.join(' · ')
  } catch (e) {
    r.ms = Date.now() - t0; r.why = 'exception: ' + String(e.message || e).slice(0, 200)
  } finally { await page.close() }
  return r
}

// sequential by default (memory/WebGL budget); --parallel N to widen
const results = []
for (let i = 0; i < targets.length; i += PARALLEL) {
  const slice = targets.slice(i, i + PARALLEL)
  const rs = await Promise.all(slice.map(check))
  for (const r of rs) {
    results.push(r)
    const warn = r.consoleErrors.length ? ` · ${r.consoleErrors.length} console error(s)` : ''
    console.log(`${r.pass ? '✓' : '✗'} ${r.key} (${r.type})  canvas:${r.canvas ? 'y' : 'n'}  ${r.ms}ms${warn}${r.pass ? '' : '\n      ' + r.why}`)
  }
}
await browser.close()

const failed = results.filter(r => !r.pass)
const noisy = results.filter(r => r.pass && r.consoleErrors.length)
// ★ PRINT THE EXEMPTED COUNT. A filter that is silent is indistinguishable from a gate that never
// looked, and this repo has already shipped one of those. Saying "3 WebGL page error(s) filtered"
// keeps the exemption visible on every run, so nobody has to read the source to know it exists.
const glNoise = results.reduce((n, r) => n + (r.glNoise || 0), 0)
console.log(`\n[plugin-gallery-smoke] ${results.length - failed.length}/${results.length} pass · ${failed.length} fail · ${noisy.length} pass-with-console-errors`)
if (glNoise) {
  console.log(`[plugin-gallery-smoke] ${glNoise} WebGL page error(s) FILTERED — this box has no GPU.`)
  console.log('  Paint is verified separately by verify:map-paint (SwiftShader). Run with')
  console.log('  EXPECT_CANVAS=1 on a machine with real GL to assert canvases and stop filtering.')
}
// ★ SAY WHAT THE NOISE IS, NOT JUST HOW MUCH. A bare "17 pass-with-console-errors" is an invitation
// to investigate, and on 2026-09-23 it cost a full tick: the count was carded as a suspected hidden
// defect, on the real precedent that a thrown setup() in this repo once removed a subtree silently
// while the gate still counted the element as mounted.
//
// IT WAS NOISE, AND THE PROOF IS THE PARTITION. Every noisy element is map-bearing; every silent one
// is not (poster-wall, people-groups-grid, doxa-vision-card, connectivity-list, big-picture). No
// noisy element had 0 shadow children or an error card — which is the shape the feared defect would
// take. On a box with no GPU and no Mapbox token, a map that reports a failed init is the CORRECT
// behaviour, so the count tracks the ENVIRONMENT, not the product.
//
// ★ AND ONE MESSAGE CLASS WAS AN ARTIFACT OF THIS REPORT ITSELF. `console.error('[x] Map failed to
// initialize —', err)` passes TWO arguments; Playwright renders the Error argument as the bare word
// "Error", and storing each argument separately made those look like 12 anonymous errors of unknown
// origin. They were the second half of messages already counted. Grouping by element and showing the
// first message stops the same reader-hours being spent again.
if (noisy.length) {
  const withMap = noisy.filter(r => r.canvas || /map/i.test(r.key)).length
  console.log(`[plugin-gallery-smoke] ${noisy.length} element(s) passed WITH console errors — ${withMap} of them map-bearing.`)
  console.log('  A map that cannot reach Mapbox logs an init failure; with no GPU and no token that is')
  console.log('  EXPECTED here and is not a product defect. What WOULD be one: a noisy element with 0')
  console.log(`  shadow children or an error card. Count of those right now: ${noisy.filter(r => r.shadowChildren === 0 || r.errorCard).length}.`)
  for (const r of noisy) {
    const first = String(r.consoleErrors[0] || '').replace(/\s+/g, ' ').slice(0, 72)
    console.log(`    ${r.key.padEnd(44)} children=${String(r.shadowChildren).padStart(3)}  ${first}`)
  }
}
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, results }, null, 2)); console.log(`[plugin-gallery-smoke] report → ${JSON_OUT}`) }
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(`  ✗ ${f.key} — ${f.why}`)); process.exit(1) }
