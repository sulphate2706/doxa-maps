#!/usr/bin/env node
/**
 * check-mapbox-drew — the Mapbox engine actually DREW, on every production leaf.
 *
 * ★ THE HOLE THIS FILLS (regions, RT8 goal b). Two gates already touch the engine and neither
 * asserts this one thing:
 *   check-leaf-engine-per-provider  proves MAPLIBRE purity (zero *.mapbox.com requests under
 *                                   ?provider=maplibre) and that a map still draws. It never forces
 *                                   Mapbox.
 *   check-provider-switch           does load ?provider=mapbox — but with a FAKE token, so it proves
 *                                   the ENGINE LOADS, not that a single tile rendered. One leaf.
 * So "Mapbox works" was never measured on the seven production maps. This measures it.
 *
 * ★ A SILENT FALLBACK IS THE FAILURE WORTH CATCHING. A leaf asked for Mapbox that quietly draws with
 * MapLibre looks perfect in a screenshot and passes every paint check. So the ENGINE is read off the
 * canvas that drew (.mapboxgl-canvas vs .maplibregl-canvas), never from which globals exist — a peer
 * script that merely loaded Mapbox proves nothing.
 *
 * ★ AND A CANVAS AT THE RIGHT SIZE IS NOT A MAP. This repo learned that the hard way: a country map
 * rendered fully blank while "a real GL canvas exists at 1200x780" passed. So drawing is asserted
 * with queryRenderedFeatures() > 0 on the leaf's own rendered features, not by canvas geometry.
 *
 * ★ THREE EXIT STATES, BECAUSE TWO WOULD FORCE A LIE. When a tile endpoint 403s, the leaf draws
 * nothing through no fault of its owner. Counting that as a failure would manufacture work for every
 * owner; counting it as a pass would be false. It exits 75 NOT MEASURED instead, NAMING every
 * distinct blocked request path and the token's source, so the next reader can tell which
 * credential was in play without the gate ever printing it.
 * ✗ AN EARLIER VERSION CALLED THIS "TILESET ENTITLEMENT" AND THAT WAS WRONG. Measured 2026-09-29 with
 * this gate's own token: /v4/ streets-v8 and country-boundaries both return 200, with no
 * Referer and from our research and maps-dev hosts, doxa.life, 127.0.0.1 and
 * example.com. The token is unrestricted and entitled. The old claim rested on three no-Referer
 * probes, which cannot distinguish a URL-restricted token from a missing entitlement. Whatever 403s
 * is a different request or a different token — which is exactly what the gate must now report
 * instead of guessing.
 *
 * USAGE  MAP_TOKEN=pk.… node internal/check-mapbox-drew.mjs [--dir <tree>] [--only a/b,c/d]
 *        Run through internal/browser-slot.sh — it needs the browser seat.
 *        @browser-slot-max-hold 1800
 * EXIT   0 every measured leaf drew with Mapbox · 1 a real failure · 75 no token, or only
 *        entitlement 403s (nothing could be judged).
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const DIR = resolve(arg('--dir', resolve(ROOT, 'public')))
const ONLY = arg('--only', '') ? new Set(arg('--only', '').split(',')) : null
const TOKEN = process.env.MAP_TOKEN || ''

// ── 3. NO REAL TOKEN -> NOT MEASURED, never a pass and never a fail ───────────────────────────
if (!/^pk\./.test(TOKEN)) {
  console.log('MAPBOX-DREW: NOT MEASURED — set MAP_TOKEN to a real pk.… token. A fake token loads the'
    + ' engine and renders nothing, which is exactly the false green this gate exists to refuse.')
  process.exit(75)
}

const manifestPath = join(DIR, TREE_NAME, 'manifest.json')
if (!existsSync(manifestPath)) { console.log(`MAPBOX-DREW: NOT MEASURED — no ${manifestPath}`); process.exit(75) }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

// ── 2. TARGETS FROM THE MANIFEST, never hardcoded: the curated production tabs ─────────────────
// The seven are whatever doxa-maps-spa composes. Reading it here means adding a production tab
// cannot silently escape this gate.
const spa = (manifest.bundles || []).find((b) => b.bundle === 'doxa-maps-spa')
const composed = new Set(((spa?.composes) || []).map(String))
const leaves = []
// ★ isMap IS FALSE ON A COMPOSITE WHOSE CHILD HOLDS THE MAP, and skipping on it would have lost a
// production tab silently. research-map-plus-grid (Simple Research) is type nested-elements-mfe with
// isMap:false and composes ['doxa-research-map', 'people-groups-grid'] — the MAP is the child. So a
// composed tab counts as a map leaf if it is isMap ITSELF or it composes a profile that is. Measured:
// selecting on isMap alone found 6 of the 7 curated tabs.
const profileIsMap = new Map()
for (const b of manifest.bundles || []) for (const p of b.profiles || []) profileIsMap.set(`${b.bundle}/${p.profile}`, !!p.isMap)
const composesAMap = (b, p) => ((b.composes || []).some((ref) => {
  const r = String(ref)
  return profileIsMap.get(r) || [...profileIsMap.keys()].some((k) => k.startsWith(`${r}/`) && profileIsMap.get(k))
}))
for (const b of manifest.bundles || []) for (const p of b.profiles || []) {
  const id = `${b.bundle}/${p.profile}`
  if (!composed.has(id)) continue                             // only the curated tabs
  if (!p.isMap && !composesAMap(b, p)) continue                // …that draw a map, directly or via a child
  if (ONLY && !ONLY.has(id)) continue
  if (existsSync(join(DIR, TREE_NAME, id, 'index.html'))) leaves.push(id)
}
if (!leaves.length) { console.log('MAPBOX-DREW: NOT MEASURED — no composed map leaf matched'); process.exit(75) }

async function serve(dir) {
  const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => ok(n)) }) })
  const srv = spawn(process.execPath, [resolve(ROOT, 'internal/serve-strict.mjs'), '--port', String(port), '--directory', dir, '--exit-with-parent'], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 600))
  return { port, stop: () => { try { srv.kill() } catch (_) {} } }
}

// Endpoints whose 403 is NOT the leaf owner's bug, so a leaf blocked on one is NOT MEASURED
// rather than FAILED.
//
// ✗ WHY THIS NO LONGER CLAIMS "ENTITLEMENT" (corrected 2026-09-29). It used to report a 403 here
// as "tileset, not the embed", on the strength of three no-Referer probes. MEASURED since,
// with the very token this gate runs on: /v4/ streets-v8 AND country-boundaries return 200 — with
// no Referer, and with our research and maps-dev hosts, doxa.life, 127.0.0.1 and
// example.com. The token is unrestricted and entitled, so whatever 403s here is a DIFFERENT
// request (a style, sprite, glyphs, a composite with terrain) or a different token than the one
// tested. Three no-Referer cases cannot tell a URL-restricted token from a missing entitlement,
// and the old comment stated a conclusion those cases could not support.
// So this list stays — a 403 on a tile endpoint still makes a leaf unjudgeable — but the gate now
// NAMES every distinct blocked path and where its token came from, and asserts no cause.
const ENTITLEMENT = [/\/v4\//, /country-boundaries/]
// Where the token came from, so a NOT MEASURED says which credential was in play. Never the value.
const TOKEN_SOURCE = process.env.MAP_TOKEN ? 'env MAP_TOKEN'
  : process.env.MAPBOX_TOKEN ? 'env MAPBOX_TOKEN'
  : 'none in env (the leaf used its own baked token, if any)'
// Distinct request paths, query dropped and TILE COORDINATES folded to {z}/{x}/{y}: one blocked
// tileset requested over 40 tiles is ONE fact, not forty, and a reader needs the tileset name, not
// which tile happened to be first. The query goes first, so a token can never reach the output.
const pathsOf = (urls) => [...new Set(urls.map((u) => String(u)
  .replace(/\?.*/, '')
  .replace(/\/\d+\/\d+\/\d+(?=(\.|@|$))/, '/{z}/{x}/{y}')))]

async function measure(page, url, provider) {
  const errs = []
  const forbidden = []
  page.on('pageerror', (e) => errs.push(String(e.message || e)))
  page.on('response', (r) => { if (r.status() === 403 && /mapbox\.com/.test(r.url())) forbidden.push(r.url()) })
  await page.addInitScript((tk) => { window.MAP_TOKEN = tk }, TOKEN)
  // Collect EVERY Map the page constructs, before any of them exist. The engines arrive as CDN
  // scripts after this runs, so the constructor cannot be wrapped directly — instead watch for the
  // global appearing and wrap Map the first time it does. Reading window.__rcmMap alone saw 2 of
  // the 7 leaves; this sees all of them, whatever each page names its instance.
  await page.addInitScript(() => {
    window.__gateMaps = []
    const wrap = (ns) => {
      if (!ns || !ns.Map || ns.__gateWrapped) return
      const Original = ns.Map
      function Patched(...args) {
        const m = new Original(...args)
        try { window.__gateMaps.push(m) } catch (_) { /* nothing to do */ }
        return m
      }
      Patched.prototype = Original.prototype
      Object.setPrototypeOf(Patched, Original)
      try { ns.Map = Patched; ns.__gateWrapped = true } catch (_) { /* frozen namespace */ }
    }
    let tries = 0
    const tick = () => { wrap(window.maplibregl); wrap(window.mapboxgl); if (++tries < 600) setTimeout(tick, 50) }
    tick()
  })
  await page.goto(`${url}?provider=${provider}`, { waitUntil: 'load', timeout: 45000 })

  // Give the engine a real chance to paint before judging; a slow tile server is not a failure.
  const drew = await page.waitForFunction(() => {
    const deep = (root, out = []) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'CANVAS') out.push(el)
        if (el.shadowRoot) deep(el.shadowRoot, out)
      }
      return out
    }
    const c = deep(document).find((x) => x.width > 0 && x.height > 0)
    if (!c) return null
    const engine = c.classList.contains('mapboxgl-canvas') ? 'mapbox'
      : c.classList.contains('maplibregl-canvas') ? 'maplibre' : 'other'
    // ★ EVERY map, not the two this repo happens to publish. Reading only
    // window.__rcmMap/__rdashMap made 5 of the 7 production leaves report -1 and then FAIL as
    // "0 rendered features" even when they had drawn (measured 2026-09-29). The hook
    // installed before navigation collects every Map the page constructs, whatever it calls it.
    const maps = (window.__gateMaps || []).slice()
    const published = window.__rcmMap || window.__rdashMap || null
    if (published && !maps.includes(published)) maps.push(published)
    let features = -1
    for (const m of maps) {
      try {
        if (!m || typeof m.queryRenderedFeatures !== 'function') continue
        const n = m.queryRenderedFeatures().length
        if (n > features) features = n
      } catch (_) { /* a map mid-style-load throws; another may answer */ }
    }
    // ★ AND DO NOT JUDGE UNTIL SOMETHING IS ACTUALLY PAINTED. Returning {engine, features} was
    // truthy even with features:0, so waitForFunction resolved at the FIRST sized canvas —
    // before a single tile had loaded — and the leaf was judged on an empty frame. Hold out for a
    // rendered feature, and let the timeout be what reports a genuinely empty map.
    if (features <= 0) return null
    return { engine, features }
  }, { timeout: 45000, polling: 500 }).then((h) => h.jsonValue()).catch(() => null)

  return { drew, errs, forbidden }
}

const cur = await serve(DIR)
// ✗ NOT THE WEBGL FLAGS, though that was the first diagnosis. A flag A/B (these flags, ANGLE's
// software backend, and none at all) gets WebGL and WebGL2 in every case — ANGLE Vulkan SwiftShader,
// 1x1 readback correct, Chromium 149. So these stay as they were; the "nothing painted" was the
// directory URL above, not the renderer.
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const base = `http://127.0.0.1:${cur.port}/${TREE_NAME}`
const fails = []
const notMeasured = []
const passes = []

for (const id of leaves) {
  const page = await browser.newPage()
  const { drew, errs, forbidden } = await measure(page, `${base}/${id}/index.html`, 'mapbox')
  await page.close()

  const entitlement = forbidden.filter((u) => ENTITLEMENT.some((re) => re.test(u)))
  const otherForbidden = forbidden.filter((u) => !ENTITLEMENT.some((re) => re.test(u)))

  if (!drew) { notMeasured.push(`${id}: no sized canvas appeared within 30s`); continue }
  // ── 4. THE ENGINE. A silent fallback is the failure worth catching. ──
  if (drew.engine !== 'mapbox') { fails.push(`${id}: asked for ?provider=mapbox and the canvas that drew is ${drew.engine.toUpperCase()} — a silent fallback`); continue }
  if (otherForbidden.length) { fails.push(`${id}: 403 on ${pathsOf(otherForbidden).join(' , ')} — not a tile endpoint [token: ${TOKEN_SOURCE}]`); continue }
  // ── 5/6. DREW, or an entitlement 403 that makes it unjudgeable. ──
  if (drew.features > 0) { passes.push(`${id}: mapbox canvas, ${drew.features} rendered feature(s)`); continue }
  if (entitlement.length) { notMeasured.push(`${id}: 0 features; 403 on ${pathsOf(entitlement).join(' , ')} [token: ${TOKEN_SOURCE}]`); continue }
  if (errs.length) { fails.push(`${id}: 0 rendered features, page error: ${errs[0].slice(0, 90)}`); continue }
  fails.push(`${id}: mapbox canvas drew 0 rendered features, and no 403 explains it`)
}

// ── 8. THE NEGATIVE ARM. If the engine assertion cannot fail, a green above means nothing. ─────
let armOk = false
{
  const page = await browser.newPage()
  const { drew } = await measure(page, `${base}/${leaves[0]}/index.html`, 'maplibre')
  await page.close()
  armOk = !!drew && drew.engine === 'maplibre'
}
// ★ THIS ARM EARNED ITS KEEP, 2026-09-29. Every target loaded a 404 page, so NEITHER engine
// painted, and this arm is what said so: it failed, which correctly refused to certify six
// "no sized canvas" results as broken production maps when the real fault was this gate's own URL.
// If this fires, suspect the harness before the leaves.
if (!armOk) fails.push('NEGATIVE ARM BROKEN: ?provider=maplibre did not draw with MapLibre, so the engine'
  + ' check cannot distinguish the engines and every pass above is unfalsifiable'
  + ' — if the mapbox targets also reported "no sized canvas", suspect WebGL in THIS browser first')

await browser.close(); cur.stop()

for (const p of passes) console.log(`  ✓ ${p}`)
for (const n of notMeasured) console.log(`  · NOT MEASURED ${n}`)
for (const f of fails) console.error(`  ✗ ${f}`)

// ── 9. THREE STATES ──
if (fails.length) { console.error(`MAPBOX-DREW: FAIL — ${fails.length} of ${leaves.length} leaf/leaves`); process.exit(1) }
if (!passes.length) { console.log(`MAPBOX-DREW: NOT MEASURED — nothing could be judged (${notMeasured.length} leaf/leaves blocked)`); process.exit(75) }
console.log(`MAPBOX-DREW: PASS — ${passes.length} of ${leaves.length} composed map leaf/leaves drew with Mapbox`
  + `${notMeasured.length ? `, ${notMeasured.length} not measurable on this token` : ''}; negative arm holds.`)
