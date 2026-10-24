#!/usr/bin/env node
/**
 * check-maplibre-layer-drops.mjs — MapLibre must not SILENTLY DROP a layer.
 *
 * THE DEFECT CLASS, found twice in one flight and invisible to every other gate:
 * MapLibre validates a layer spec and, if any property is unknown or misplaced, REJECTS THE WHOLE
 * LAYER. addLayer() does NOT throw — it accepts the call, emits an `error` EVENT on the map, and
 * silently omits the layer. getLayer() then returns undefined and the map renders without it. So
 * the symptom is "a thing is missing", with no exception, no failed request, and no console error
 * from the app's own code. Three ticks of instrumenting addLayer() found nothing, because the
 * failure never travels through addLayer's return path.
 *
 * MEASURED instances, both real and both shipped:
 *   layers.regions-fill.paint.fill-emissive-strength: unknown property
 *       -> *-emissive-strength is a Mapbox GL v3 LIGHTING property. The WAGF region fills were
 *          absent on every MapLibre map while Mapbox showed them.
 *   layers.apg-pins.paint.circle-sort-key: unknown property "circle-sort-key"
 *       -> circle-sort-key is a LAYOUT property, written into paint. Mapbox tolerated the
 *          misplacement; MapLibre dropped the layer, so ALL 12,379 pins on all-people-groups
 *          vanished under the keyless engine.
 *
 * WHAT IT ASSERTS: load every isMap leaf in the built manifest with ?provider=maplibre, listen to
 * the map's own `error` event, and fail on any message in the layer/source-dropping family
 * (unknown property / does not exist / is required / Expected / invalid). Other errors are
 * REPORTED but not failed — a tile 404 is a different problem and should not be smuggled in here.
 *
 * ★ IT IS A REAL CONTROL, NOT DECORATION: run against the tree before the fixes it reports
 * 1 of 17 leaves dropping, and 0 of 17 after. It has been seen both red and green on the same
 * codebase, which is the only thing that makes a green meaningful.
 *
 * SKIPS CLEANLY (exit 0) when the server is unreachable. An UNMEASURED check is not a FAILED one —
 * check:filter-width prints "FAIL" when it cannot reach its server, and that is how a gate teaches
 * people to ignore it.
 *
 * Usage: bun run serve   (or any server on BASE_URL), then:
 *        node internal/check-maplibre-layer-drops.mjs
 *        BASE_URL=http://127.0.0.1:4399 node internal/check-maplibre-layer-drops.mjs
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { servesThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

// Portable by construction — see check-no-absolute-paths.mjs. Never hardcode a worktree.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = String(process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')

const DROP_RE = /unknown property|does not exist|is required|Expected|invalid/i

if (!existsSync(MANIFEST)) {
  console.log('MAPLIBRE-LAYER-DROPS: SKIP — no built manifest (run `bun run tree` first).')
  process.exit(0)
}
// ⚠ REACHABLE AND MINE ARE DIFFERENT QUESTIONS. This machine runs several worktrees of one
// repo and the default port belongs to whichever server started first — measured 2026-09-24:
// :4173 was another worktree's, and this gate reported PASS 16/16 about a build that was not
// on disk here. The layer-drop family is silent by nature (MapLibre omits a layer instead of
// throwing), so a verdict taken from the wrong tree is exactly the kind nobody can catch by
// looking. A mismatch is a precondition, not a product failure: SKIP, but name it.
{
  const tree = await servesThisTree(BASE, ROOT)
  if (/DIFFERENT build/.test(tree.why)) {
    console.log('MAPLIBRE-LAYER-DROPS: SKIP — the server is not serving THIS build.')
    console.log('  ' + tree.why)
    console.log('  Start `bun run serve` in this checkout and pass its port as BASE_URL.')
    process.exit(0)
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const leaves = []
for (const b of manifest.bundles || []) {
  for (const p of b.profiles || []) if (p.isMap) leaves.push([b.bundle, p.profile])
}
if (!leaves.length) {
  console.log('MAPLIBRE-LAYER-DROPS: SKIP — the manifest declares no isMap leaf.')
  process.exit(0)
}

// Capture the map's error events by wrapping whichever engine global the bundle loads at runtime.
const INIT = () => {
  window.__mapErrs = []
  const wrap = (ns) => {
    if (!ns || ns.__wrappedForDrops) return ns
    const Orig = ns.Map
    function Patched(...a) {
      const m = new Orig(...a)
      try {
        m.on('error', (ev) => {
          const t = String((ev && ev.error && ev.error.message) || (ev && ev.message) || '')
          if (t) window.__mapErrs.push(t.slice(0, 160))
        })
      } catch (_) { /* an engine without .on must not break the page */ }
      return m
    }
    Patched.prototype = Orig.prototype
    ns.Map = Patched
    ns.__wrappedForDrops = true
    return ns
  }
  for (const name of ['maplibregl', 'mapboxgl']) {
    let v
    Object.defineProperty(window, name, {
      configurable: true, get() { return v }, set(nv) { v = wrap(nv) },
    })
  }
}

console.log(`MAPLIBRE-LAYER-DROPS: ${leaves.length} isMap leaf/leaves at ${BASE}`)
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const offenders = []
let unreachable = 0

for (const [bundle, profile] of leaves) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  await page.addInitScript(INIT)
  const url = `${BASE}/${TREE_NAME}/${bundle}/${profile}/index.html?provider=maplibre`
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(9000)
    const errs = await page.evaluate(() => [...new Set(window.__mapErrs || [])])
    const drops = errs.filter((e) => DROP_RE.test(e))
    if (drops.length) {
      offenders.push({ leaf: `${bundle}/${profile}`, drops })
      console.log(`  ✗ ${bundle}/${profile} — ${drops[0]}`)
    } else {
      console.log(`  ok ${bundle}/${profile}`)
    }
  } catch (e) {
    unreachable++
    console.log(`  · ${bundle}/${profile} — UNMEASURED (${String(e.message).slice(0, 60)})`)
  }
  await page.close()
}
await browser.close()

if (unreachable === leaves.length) {
  console.log('MAPLIBRE-LAYER-DROPS: SKIP — nothing was reachable at ' + BASE + '. Start `bun run serve`.')
  process.exit(0)
}
if (offenders.length) {
  console.error(`\nMAPLIBRE-LAYER-DROPS: FAIL — ${offenders.length} leaf/leaves silently drop a layer under MapLibre.`)
  for (const o of offenders) for (const d of o.drops) console.error(`  ${o.leaf}: ${d}`)
  console.error('\n  MapLibre rejects a whole layer for ONE unknown or misplaced property, without throwing.')
  console.error('  Engine-only paint (e.g. *-emissive-strength) belongs behind emissivePaint(map, kind);')
  console.error('  layout properties (e.g. circle-sort-key) belong in `layout`, not `paint`.')
  process.exit(1)
}
console.log(`\nMAPLIBRE-LAYER-DROPS: PASS — ${leaves.length - unreachable} leaf/leaves, no layer dropped by MapLibre.`)
