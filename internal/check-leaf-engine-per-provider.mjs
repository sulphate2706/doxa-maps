#!/usr/bin/env node
/**
 * check-leaf-engine-per-provider — a leaf loads the engine its PROVIDER asks for, and no other.
 *
 * THE BUG (card BUG-LEAF-PAGES-PRELOAD-MAPBOX-EVEN-UNDER-MAPLIBRE; measured at
 * 577149af). generate-tree chose a leaf's engine peer at BUILD time, from the instance config, and
 * baked it into <head> as static tags: mapbox-gl.css, the geocoder css, mapbox-gl.js and the geocoder
 * js, all from api.mapbox.com. The provider is chosen at RUNTIME (resolveMapProvider:
 * profile-config.provider → ?provider= → window.MAP_PROVIDER → mapbox). So a partner that embeds a
 * leaf with ?provider=maplibre still made its visitors' browsers fetch 4 files from Mapbox, sending
 * every visitor's IP to a company the partner chose not to use. No project rule permits that.
 *
 * WHAT IS ASSERTED, on THIS checkout's served tree (every leaf in the manifest, instances included):
 *   MAPLIBRE  every leaf at ?provider=maplibre makes ZERO requests to any *.mapbox.com host; a MAP
 *             leaf must also still draw (a canvas with a live GL context, window.maplibregl defined),
 *             so a fix cannot pass by breaking the map.
 *   DEFAULT   every MAP leaf at its default still DRAWS, with the SAME engine it drew with before.
 *             The engine is read from the canvas that drew (mapboxgl-canvas / maplibregl-canvas), not
 *             from which globals exist: some leaves are MapLibre by design (prayer-walk-planner, the
 *             ".../maplibre" instances), and a peer that merely loaded Mapbox proves nothing.
 *   --baseline <tree root>  measures that tree too (e.g. main, with the static peer) and requires, per
 *             leaf: the default pass draws with the baseline's engine, and the maplibre pass draws with
 *             MapLibre wherever the baseline drew a map at all. Without it, a map leaf must simply draw.
 * Paint here is a floor, not the verdict on looks: verify-map-paint and check:gospel-map-paints judge
 * the map itself.
 *
 * USAGE  node internal/check-leaf-engine-per-provider.mjs [--dir <tree root>] [--only a/b,c/d]
 *        Run through internal/browser-slot.sh.
 *        @browser-slot-max-hold 2700
 * EXIT   0 pass · 1 a leaf calls Mapbox under maplibre, or a map stopped drawing · 75 not measured.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const DIR = resolve(arg('--dir', resolve(ROOT, 'public')))
const ONLY = arg('--only', '') ? new Set(arg('--only', '').split(',')) : null
const BASELINE = arg('--baseline', '') ? resolve(arg('--baseline', '')) : null
const CONCURRENCY = 3
const MAPBOX_HOST = /(^|\.)mapbox\.com$/i

const manifestPath = join(DIR, TREE_NAME, 'manifest.json')
if (!existsSync(manifestPath)) { console.log(`LEAF-ENGINE: NOT MEASURED — no ${manifestPath}`); process.exit(75) }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const leaves = []
for (const b of manifest.bundles || []) for (const p of b.profiles || []) {
  const base = `${b.bundle}/${p.profile}`
  // opensOnMap:false (a preset opening on a non-GL lens, e.g. upg-neighbor/flower-mesh): not judged as
  // a drawing map, but its Mapbox-request count under ?provider=maplibre is still measured.
  const add = (id, opensOnMap = true) => { if ((!ONLY || ONLY.has(id)) && existsSync(join(DIR, TREE_NAME, id, 'index.html'))) leaves.push({ id, isMap: !!p.isMap && opensOnMap }) }
  add(base)
  for (const inst of p.instances || []) add(`${base}/${inst.id}`, inst.opensOnMap !== false)
}
if (!leaves.length) { console.log('LEAF-ENGINE: NOT MEASURED — no leaves matched'); process.exit(75) }

async function serve(dir) {
  const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => ok(n)) }) })
  const srv = spawn(process.execPath, [resolve(ROOT, 'internal/serve-strict.mjs'), '--port', String(port), '--directory', dir, '--exit-with-parent'], { stdio: 'ignore' })
  let up = false
  for (let i = 0; i < 40 && !up; i++) { await new Promise((r) => setTimeout(r, 150)); up = await fetch(`http://127.0.0.1:${port}/${TREE_NAME}/manifest.json`).then((r) => r.ok).catch(() => false) }
  if (!up) { try { srv.kill() } catch { /* gone */ } return null }
  return { port, stop: () => { try { srv.kill() } catch { /* already gone */ } } }
}
const cur = await serve(DIR)
const base = BASELINE ? await serve(BASELINE) : null
const stop = () => { cur && cur.stop(); base && base.stop() }
if (!cur || (BASELINE && !base)) { stop(); console.log(`LEAF-ENGINE: NOT MEASURED — could not serve ${!cur ? DIR : BASELINE}`); process.exit(75) }

// A drawn map: a canvas, somewhere down the shadow roots, with a live WebGL context.
const DRAWN = `(() => {
  const canvases = []
  const walk = (r) => { for (const e of r.querySelectorAll('*')) { if (e.tagName === 'CANVAS') canvases.push(e); if (e.shadowRoot) walk(e.shadowRoot) } }
  walk(document)
  const drawing = canvases.filter((c) => { if (c.width < 50 || c.height < 50) return false
    const gl = c.getContext('webgl2') || c.getContext('webgl'); return !!gl && !gl.isContextLost() })
  const engines = [...new Set(drawing.map((c) => c.classList.contains('maplibregl-canvas') ? 'maplibre' : c.classList.contains('mapboxgl-canvas') ? 'mapbox' : 'other'))].sort()
  return { canvases: canvases.length, live: drawing.length > 0, engine: engines.join('+') || 'none', mapboxgl: !!window.mapboxgl, maplibregl: !!window.maplibregl }
})()`

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
async function load(srvPort, id, provider) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  const mapboxReqs = []
  page.on('request', (r) => { try { if (MAPBOX_HOST.test(new URL(r.url()).hostname)) mapboxReqs.push(r.url()) } catch { /* data: etc */ } })
  const url = `http://127.0.0.1:${srvPort}/${TREE_NAME}/${id}/index.html${provider === 'maplibre' ? '?provider=maplibre' : ''}`
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 })
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
    let d = null
    for (let i = 0; i < 30; i++) { d = await page.evaluate(DRAWN).catch(() => null); if (d && d.live) break; await page.waitForTimeout(500) }
    await page.waitForTimeout(1500)            // late requests (a lazily injected geocoder) still count
    return { ...d, mapboxReqs: [...mapboxReqs] }
  } catch (e) { return { error: String(e.message || e).split('\n')[0], mapboxReqs: [...mapboxReqs] } }
  finally { await ctx.close() }
}

const rows = []
const queue = leaves.slice()
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const L = queue.shift()
    const ml = await load(cur.port, L.id, 'maplibre')
    const mb = L.isMap ? await load(cur.port, L.id, 'default') : null
    const bl = base && L.isMap ? await load(base.port, L.id, 'default') : null
    const problems = []
    if (ml.error) problems.push(`maplibre load: ${ml.error}`)
    if (ml.mapboxReqs.length) problems.push(`${ml.mapboxReqs.length} Mapbox request(s) under maplibre: ${[...new Set(ml.mapboxReqs.map((u) => new URL(u).pathname.split('/').slice(0, 3).join('/') || u))].slice(0, 3).join(', ')}`)
    if (mb && mb.error) problems.push(`default load: ${mb.error}`)
    if (bl && bl.error) problems.push(`baseline load: ${bl.error}`)
    // What SHOULD draw: with a baseline, whatever drew there; without one, a map leaf draws something.
    const baselineDrew = bl ? bl.live : (L.isMap ? true : false)
    if (L.isMap && !ml.error && baselineDrew && !(ml.live && ml.engine.includes('maplibre'))) problems.push(`under maplibre the map does not draw with MapLibre (drew: ${ml.engine})`)
    if (mb && !mb.error) {
      if (bl && !bl.error) {
        if (mb.engine !== bl.engine) problems.push(`the DEFAULT path changed engine: before ${bl.engine}, now ${mb.engine}`)
      } else if (!mb.live) problems.push('the DEFAULT path draws no map')
    }
    rows.push({ id: L.id, isMap: L.isMap, mlReqs: ml.mapboxReqs.length, def: mb ? mb.engine : '', was: bl ? bl.engine : '', problems, unmeasured: !!(ml.error || (mb && mb.error) || (bl && bl.error)) })
  }
}))
await browser.close(); stop()

rows.sort((a, b) => a.id.localeCompare(b.id))
console.log(`LEAF-ENGINE: ${rows.length} leaves (${rows.filter((r) => r.isMap).length} maps) on ${DIR}${BASELINE ? ` — baseline ${BASELINE}` : ''}`)
for (const r of rows) console.log(`  ${r.problems.length ? (r.unmeasured ? '??  ' : 'FAIL') : 'ok  '}  ${r.id.padEnd(46)} ${r.isMap ? 'map ' : '    '} mapbox reqs under maplibre: ${String(r.mlReqs).padStart(2)}${r.def ? `  default draws: ${r.def}${r.was ? ` (was ${r.was})` : ''}` : ''}${r.problems.length ? '  — ' + r.problems.join('; ') : ''}`)
const fails = rows.filter((r) => r.problems.length && !r.unmeasured)
if (fails.length) {
  console.log(`LEAF-ENGINE: FAIL — ${fails.length} leaf/leaves: under ?provider=maplibre they still call Mapbox, or a map stopped drawing.`)
  process.exit(1)
}
if (rows.some((r) => r.unmeasured)) { console.log('LEAF-ENGINE: NOT MEASURED — a leaf did not load.'); process.exit(75) }
console.log(`LEAF-ENGINE: PASS — no leaf calls Mapbox under maplibre; every map draws with MapLibre under maplibre and with ${BASELINE ? 'the same engine as the baseline' : 'an engine'} by default.`)
