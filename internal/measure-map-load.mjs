#!/usr/bin/env node
/**
 * measure-map-load — what each production map fetches before first render, and how long it takes.
 *
 * USAGE:   node internal/measure-map-load.mjs [--runs 3] [--mbps 10] [--rtt 60] [--only bundle/profile,…]
 *          --mbps 0 = no throttling. Serves the BUILT tree itself on a free port (serve-strict).
 * Prints, per map: median time to the bundle, to the engine script (mapbox-gl.js), to the map's
 * `load` event, and the serial chain — the requests that had to finish before the next could start.
 *
 * ★ WHY. The ask: bundle Vue inline into the maps so they load faster. Vue is
 *   already compiled into every IIFE (vite.config.js externalises only jspdf), so the measurement has
 *   to find what DOES wait on what. Every run is a FRESH browser context (cold HTTP cache) under
 *   Chrome DevTools network throttling, so a local server is not mistaken for a real connection.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { TREE_NAME, TREE_NAME_RE } from './_tree-name.mjs'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const RUNS = Number(arg('--runs', 3)), MBPS = Number(arg('--mbps', 10)), RTT = Number(arg('--rtt', 60))
// --embed: measure the PARTNER case — a page on another origin that pastes only the manifest's
// embed snippet (no leaf page, so nothing preloads the engine). Default: the map's own leaf page.
const EMBED = argv.includes('--embed')
const DEFAULT = JSON.parse(readFileSync('plugin-designs/doxa-maps-spa/doxa-maps-spa.meta.json', 'utf8')).composes
const ONLY = arg('--only', '') ? arg('--only', '').split(',') : DEFAULT
const manifest = JSON.parse(readFileSync(`public/${TREE_NAME}/manifest.json`, 'utf8'))

const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const srv = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(port), '--exit-with-parent'], { stdio: 'ignore' })
const hostPort = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
let hostHtml = ''
const host = createServer((_, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(hostHtml) }).listen(hostPort, 'localhost')
await new Promise((r) => setTimeout(r, 900))
const T = `http://127.0.0.1:${port}/${TREE_NAME}`

const kind = (u) => /mapbox-gl(\.min)?\.js|maplibre-gl\.js/.test(u) ? 'engine' : /mapbox-gl\.css|maplibre-gl\.css/.test(u) ? 'engine-css'
  : /\/styles\/v1\/|tiles\.openfreemap\.org\/styles/.test(u) ? 'style' : new RegExp(`/${TREE_NAME_RE}/[^/]+/[^/]+\\.js$`).test(u) ? 'bundle'
  : /pray\.doxa\.life\/api/.test(u) ? 'api' : /\/assets\/.*\.(json|geojson)/.test(u) ? 'data' : /\.pbf|\.mvt|vector/.test(u) ? 'tile' : 'other'

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const rows = []
for (const ref of ONLY) {
  const [bundle, profile] = ref.split('/')
  const b = manifest.bundles.find((x) => x.bundle === bundle)
  const p = b && b.profiles.find((x) => x.profile === profile)
  if (!p) { rows.push({ ref, missing: true }); continue }
  let url = `${T}/${String(p.iframeUrl).replace(/^\.\//, '')}`
  if (EMBED) {
    const tok = (readFileSync(`public/${TREE_NAME}/${String(p.iframeUrl).replace(/^\.\//, '')}`, 'utf8').match(/BAKED_TOKEN\s*=\s*"(pk\.[^"]+)"/) || [])[1] || ''
    const snip = String((p.embed && p.embed.script) || '').replace(/src="\.\//g, `src="${T}/`).replace(/YOUR_MAPBOX_TOKEN/g, tok)
    hostHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Partner</title></head><body style="margin:0"><div style="position:relative;height:900px">${snip}</div></body></html>`
    url = `http://localhost:${hostPort}/partner.html`
  }
  const runs = []
  for (let r = 0; r < RUNS; r++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    if (MBPS > 0) {
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: RTT, downloadThroughput: (MBPS * 1e6) / 8, uploadThroughput: (MBPS * 1e6) / 16 })
    }
    const reqs = new Map()
    let t0 = 0
    page.on('request', (q) => { reqs.set(q, { url: q.url(), kind: kind(q.url()), start: Date.now() - t0 }) })
    page.on('requestfinished', (q) => { const x = reqs.get(q); if (x) x.end = Date.now() - t0 })
    t0 = Date.now()
    await page.goto(url, { waitUntil: 'commit' })
    let loaded = null, styled = null
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const st = await page.evaluate(() => {
        const find = (r) => { for (const e of r.querySelectorAll('*')) { if (e.__doxaMap) return e.__doxaMap; if (e.shadowRoot) { const m = find(e.shadowRoot); if (m) return m } } return null }
        const m = find(document)
        // FIRST RENDER = the style is loaded and the tiles in view are loaded. Not map.loaded(): it
        // stays false while any animation runs, and several maps animate continuously (pulses, glow),
        // so the first version of this probe waited out its full timeout on every run.
        return { style: !!(m && m.isStyleLoaded && m.isStyleLoaded()), tiles: !!(m && m.isStyleLoaded && m.isStyleLoaded() && m.areTilesLoaded && m.areTilesLoaded()) }
      }).catch(() => ({}))
      if (st.style && styled === null) styled = Date.now() - t0
      if (st.tiles) { loaded = Date.now() - t0; break }
      await page.waitForTimeout(100)
    }
    const all = [...reqs.values()]
    const first = (k) => all.filter((x) => x.kind === k).sort((a, c) => a.start - c.start)[0]
    const bundleReq = all.find((x) => x.kind === 'bundle' && x.url.includes(`/${bundle}/${bundle}.js`)) || first('bundle')
    const eng = first('engine'), sty = first('style'), dat = first('data')
    // A preload the browser cannot reuse (request mode mismatch) shows up as a SECOND engine request.
    const engineRequests = all.filter((x) => x.kind === 'engine').length
    runs.push({
      engineRequests,
      loaded, styled, bundleEnd: bundleReq && bundleReq.end, engineStart: eng && eng.start, engineEnd: eng && eng.end,
      styleStart: sty && sty.start, dataStart: dat && dat.start,
      bytes: { bundle: 0 },
    })
    await ctx.close()
  }
  const med = (k) => { const v = runs.map((x) => x[k]).filter((x) => x != null).sort((a, c) => a - c); return v.length ? v[Math.floor(v.length / 2)] : null }
  console.log('  measured ' + ref + ': ' + JSON.stringify(runs.map((x) => x.loaded)) + ' · engine requests per run ' + JSON.stringify(runs.map((x) => x.engineRequests)))
  rows.push({ ref, styled: med('styled'), loaded: med('loaded'), bundleEnd: med('bundleEnd'), engineStart: med('engineStart'), engineEnd: med('engineEnd'), styleStart: med('styleStart'), dataStart: med('dataStart'), runs: runs.map((x) => x.loaded) })
}
await browser.close(); srv.kill(); host.close()

const f = (x) => (x == null ? '—' : (x / 1000).toFixed(2) + 's')
console.log(`\n${EMBED ? 'PARTNER EMBED (snippet on another origin)' : 'LEAF PAGE'} · throttle: ${MBPS > 0 ? MBPS + ' Mbps, ' + RTT + ' ms RTT' : 'none'} · ${RUNS} cold run(s) each · medians`)
console.log('map'.padEnd(46) + 'bundle done  engine start  engine done  style start  data start  BASEMAP UP  TILES LOADED (runs)')
for (const r of rows) {
  if (r.missing) { console.log(r.ref.padEnd(46) + 'not in manifest'); continue }
  console.log(r.ref.padEnd(46) + f(r.bundleEnd).padEnd(13) + f(r.engineStart).padEnd(14) + f(r.engineEnd).padEnd(13) + f(r.styleStart).padEnd(13) + f(r.dataStart).padEnd(12) + f(r.styled).padEnd(12) + f(r.loaded).padEnd(13) + JSON.stringify(r.runs.map((x) => (x == null ? null : +(x / 1000).toFixed(2)))))
}
