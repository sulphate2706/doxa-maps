#!/usr/bin/env node
/**
 * check-experimental-shelf — "all experimental plugins working", as a measurement.
 *
 * THE SHELF is derived, never listed: every bundle in the built manifest that the Research Gallery
 * would discover into its Experimental folder, i.e. not a curated tab and not in NOT_EXPERIMENTAL.
 * Both sets are read from plugin-designs/doxa-maps-spa/doxa-maps-spa.vue, so a bundle that joins or
 * leaves the shelf changes what this gate measures without an edit here.
 *
 * PER BUNDLE, PER ENGINE (mapbox, maplibre), on FOUR surfaces:
 *   A its own leaf page
 *   B a host page on a DIFFERENT ORIGIN that iframes the leaf, built from the manifest's own
 *     embed.iframe snippet; the host's title, URL and scroll must not change
 *   C a host page on a different origin that pastes the manifest's own embed.script snippet with
 *     the HOST's token and provider filled in. Under maplibre it must make 0 api.mapbox.com
 *     requests; under mapbox, where the plugin draws a Mapbox map, a second run with a fake host
 *     token must show that token in its tile requests and no other (the host's token is used,
 *     not one baked into the bundle). A MapLibre-only plugin takes no token: reported n/a
 *   D its tab inside the Research Gallery
 * B and C test exactly what a partner pastes, so a broken snippet fails here too.
 * Every surface with a map also gets the PAINT arm (after gospel's check-gospel-map-paints):
 * distinct colours read off the map's own canvas (floor 40) and the map's height over the plugin
 * element's (floor 70%). Feature counts cannot see a white rectangle; these two can. Each has its
 * own self-test poison and must be the arm that catches it: 'blank' (every layer's opacity 0,
 * every feature still "drawn") and 'collapse' (the container squeezed to 300px).
 * Drawn counts are read SETTLED: equal on two consecutive polls, never the first non-zero read.
 * A surface passes when:
 *   - the element mounted with content (its shadow tree has real nodes),
 *   - 0 page errors and 0 failed requests (4xx/5xx; Mapbox telemetry and favicons excluded),
 *   - no loading text is left on screen (Loading / Adding / Computing),
 *   - and, for every MAP on the page: its 'load' fired, and it DRAWS its own data, meaning at
 *     least one rendered feature on a layer fed by a GeoJSON source. That is the lesson from the
 *     PPLR check: 'load' alone is not loaded, and an empty GeoJSON source still counts as a
 *     source.
 * Maps are found without touching any bundle: an init script wraps the engine's Map class as the
 * engine script defines it, so every map the page constructs is recorded.
 *
 * IDENTITY: the gate serves THIS checkout's public/ itself, on a port the OS hands out, so it
 * cannot grade another worktree's tree (the fixed-port trap internal/_serves-this-tree.mjs names).
 *
 * SELF-TEST (--self-test, and always first unless --no-self-test): the first shelf bundle's script
 * is replaced in flight by one that throws. That bundle MUST fail on both surfaces; if it does not,
 * the gate is blind and exits 3 before grading anything.
 *
 * Usage: node internal/check-experimental-shelf.mjs [--engines mapbox,maplibre] [--only a,b]
 *        [--no-self-test] [--self-test]
 * Exit: 0 all pass · 1 a bundle failed · 3 self-test could not see a broken bundle · 2 setup.
 * Run browser gates through internal/browser-slot.sh.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const ENGINES = arg('--engines', 'mapbox,maplibre').split(',')
const ONLY = arg('--only', '') ? arg('--only', '').split(',') : null
// --surfaces A,B,C,D (default all). The full shelf is ~60 page loads, ~20 min under SwiftShader:
// run it with BROWSER_MAX_HOLD raised, or split it by --only / --surfaces.
const SURFACES = arg('--surfaces', 'A,B,C,D').split(',')
const SELF_TEST = !argv.includes('--no-self-test')
const WAIT_MS = Number(process.env.SHELF_WAIT_MS || 75000)
// the PAINT arm (after gospel's check-gospel-map-paints, 0574fe7f): every assertion above counts
// FEATURES, and queryRenderedFeatures answers happily over a white rectangle. These two look.
const MIN_COLOURS = Number(process.env.MIN_MAP_COLOURS || 40)
const MIN_FILL = Number(process.env.MIN_MAP_FILL || 0.7)

// Through the slot guard like every repo browser gate (it imported node_modules/playwright by path and so
// launched outside the slot; upg100 measured it).
const { chromium } = await import('./lib/playwright-guarded.mjs')
const manifest = JSON.parse(readFileSync(resolve(ROOT, `public/${TREE_NAME}/manifest.json`), 'utf8'))
const spa = readFileSync(resolve(ROOT, 'plugin-designs/doxa-maps-spa/doxa-maps-spa.vue'), 'utf8')
const cfg = JSON.parse(readFileSync(resolve(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
const TK = process.env.MAPBOX_TOKEN || cfg.token || ''

// ── the shelf, derived from the Gallery's own rules ───────────────────────────
const notExp = new Set((spa.match(/const NOT_EXPERIMENTAL = new Set\(\[([\s\S]*?)\]\)/) || [, ''])[1].match(/'([a-z0-9-]+)'/g)?.map(s => s.slice(1, -1)) || [])
const curated = new Set([...spa.matchAll(/bundle:\s*'([a-z0-9-]+)'/g)].map(m => m[1]))
if (!notExp.size || !curated.size) { console.error('check-experimental-shelf: could not read NOT_EXPERIMENTAL / curated tabs from doxa-maps-spa.vue'); process.exit(2) }
const shelf = manifest.bundles
  .filter(b => !notExp.has(b.bundle) && !curated.has(b.bundle) && (b.profiles || []).length)
  .filter(b => !ONLY || ONLY.includes(b.bundle))
  .map(b => {
    // the entry profile the Gallery opens: a map profile, else the one named like the bundle, else the first
    const p = b.profiles.find(x => x.isMap) || b.profiles.find(x => x.profile === b.bundle) || b.profiles[0]
    return { bundle: b.bundle, profile: p.profile, isMap: !!p.isMap, tag: p.element || (b.elements || [])[0] || b.bundle }
  })
if (!shelf.length) { console.error('check-experimental-shelf: the shelf is empty'); process.exit(2) }

// ── SEEDS: bundles whose data is the USER'S, so a fresh browser correctly shows none ─────────
// Seeded before load, then required to be DRAWN, which is stronger than exempting them. Printed on
// every run with the reason, so a seed can never quietly hide a regression.
const SEED = {
  'prayer-walk-planner': {
    why: 'walk zones are user-drawn and kept in localStorage; a fresh browser has none, so one known zone is seeded and must be drawn',
    keyPrefix: 'prayer-walk-planner:v1:',
    value: JSON.stringify([{ id: 'shelf-seed', title: 'Shelf check zone', coords: [[0, 10], [20, 10], [20, 25], [0, 25]] }]),
  },
}

// ── our own server, on a port nobody else can be holding ──────────────────────
const port = await new Promise(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const srv = spawn(process.execPath, [resolve(ROOT, 'internal/serve-strict.mjs'), '--port', String(port), '--directory', 'public', '--exit-with-parent'], { cwd: ROOT, stdio: 'ignore' })
const reap = () => { try { srv.kill() } catch (_) {} }
process.on('exit', reap); for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { reap(); process.exit(130) })
const BASE = `http://127.0.0.1:${port}/${TREE_NAME}`
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/manifest.json')).ok) break } catch (_) {} await new Promise(r => setTimeout(r, 250)) }

// ── the PARTNER: a host site on a different origin (localhost vs 127.0.0.1) ────────────────
// Its pages are built from the manifest's own embed snippets, placeholders filled the way the
// snippet's comments tell a partner to.
const byBundle = Object.fromEntries(manifest.bundles.map(x => [x.bundle, x]))
const snippet = (bundle, profile, kind) => ((byBundle[bundle].profiles.find(x => x.profile === profile) || {}).embed || {})[kind] || ''
function hostPage(kind, s, eng, token) {
  let body
  if (kind === 'B') {
    const leafUrl = `${BASE}/${s.bundle}/${s.profile}/index.html?provider=${eng}` + (eng === 'mapbox' ? `&tk=${token}` : '')
    body = snippet(s.bundle, s.profile, 'iframe').replace(/src="[^"]*"/, `src="${leafUrl}&utm_source=shelf"`).replace(/height="\d+"/, 'height="720"')
  } else {
    body = snippet(s.bundle, s.profile, 'script')
      .replaceAll('src="./', `src="${BASE}/`).replaceAll('href="./', `href="${BASE}/`)
      .replaceAll('YOUR_MAPBOX_TOKEN', token).replaceAll('YOUR_SOURCE', 'shelf').replaceAll('YOUR_TREE_URL', BASE)
    if (eng === 'maplibre') body = body.replace(/<!--[^>]*(?:remove this line|this line must go)[^>]*-->\s*<link[^>]*>\s*/i, '')
    // ★ BOTH ENGINES ARE NOW ASKED FOR BY NAME. This used to inject provider only for maplibre and
    // let the mapbox arm be chosen by the token it fills in. Since 2026-09-28 a token no longer
    // selects an engine — auto is always MapLibre — so the mapbox arm would have quietly run
    // MapLibre and still passed. The published snippet already carries a provider key, so this
    // REPLACES it rather than prepending a second one: a duplicate key parses to whichever came
    // last, which is a coin-flip that happens to work.
    body = body.replace(/("provider"\s*:\s*")[^"]*(")/g, `$1${eng}$2`)
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PARTNER ${kind}</title>
<style>body{margin:0;font:14px sans-serif}header{height:64px;background:#eee;padding:8px}main>*{display:block;width:100%;height:720px;position:relative}</style></head>
<body><header>A partner's own site</header><main>${body}</main></body></html>`
}
const FAKE_TK = 'pk.SHELFHOSTTOKEN' + 'x'.repeat(20)
const hostSrv = createHttpServer((req, res) => {
  const m = req.url.match(/^\/(B|C)\/([a-z0-9-]+)\/(mapbox|maplibre)(\/fake)?/)
  const s = m && shelf.find(x => x.bundle === m[2])
  if (!s) { res.writeHead(404); return res.end('no') }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(hostPage(m[1], s, m[3], m[4] ? FAKE_TK : TK))
})
const hostPort = await new Promise(ok => hostSrv.listen(0, '127.0.0.1', () => ok(hostSrv.address().port)))
const HOST = `http://localhost:${hostPort}`
process.on('exit', () => { try { hostSrv.close() } catch (_) {} })

// ── every Map the page builds, recorded without touching the bundle ───────────
const RECORD_MAPS = () => {
  window.__shelfMaps = []
  for (const name of ['mapboxgl', 'maplibregl']) {
    let v
    Object.defineProperty(window, name, {
      configurable: true,
      get() { return v },
      set(val) {
        if (val && val.Map && !val.Map.__shelfWrapped) {
          const Orig = val.Map
          class Recorded extends Orig { constructor(...a) { super(...a); window.__shelfMaps.push(this); this.once('load', () => { this.__shelfLoaded = true }) } }
          Recorded.__shelfWrapped = true
          try { val.Map = Recorded } catch (_) { try { Object.defineProperty(val, 'Map', { value: Recorded }) } catch (_) {} }
        }
        v = val
      },
    })
  }
}
const PROBE = (tag) => `(() => {
  const acc = []; const w = (r) => { for (const el of r.querySelectorAll('*')) { acc.push(el); if (el.shadowRoot) w(el.shadowRoot) } }; w(document)
  // CONTENT is the plugin's own subtree, not the page: a small card on a bare leaf and a card inside the
  // Gallery's chrome must be judged the same way.
  const host = acc.find(e => e.tagName === ${JSON.stringify('__TAG__')}.toUpperCase())
  let own = 0, sized = false
  if (host) { const inner = []; const w2 = (r) => { for (const el of r.querySelectorAll('*')) { inner.push(el); if (el.shadowRoot) w2(el.shadowRoot) } }; w2(host.shadowRoot || host); own = inner.length
    const hr = host.getBoundingClientRect(); sized = hr.width > 100 && hr.height > 100 }
  const busy = acc.filter(e => e.children.length === 0 && /Loading|Adding|Computing/i.test(e.textContent || '') && e.getBoundingClientRect().height > 0).length
  const maps = (window.__shelfMaps || []).filter(m => { try { return m.getContainer() && m.getContainer().isConnected } catch (_) { return false } }).map(m => {
    let drawn = 0, geo = 0
    try {
      const st = m.getStyle(); const srcs = st.sources || {}
      const geoIds = Object.keys(srcs).filter(k => srcs[k].type === 'geojson'); geo = geoIds.length
      const layers = (st.layers || []).filter(l => geoIds.includes(l.source)).map(l => l.id)
      if (layers.length) drawn = m.queryRenderedFeatures({ layers }).length
    } catch (_) {}
    return { loaded: !!(m.__shelfLoaded || (m.isStyleLoaded && m.isStyleLoaded())), geo, drawn, mapbox: !!(window.mapboxgl && m instanceof window.mapboxgl.Map) }
  })
  return { own, sized, host: !!host, busy, maps }
})()`.replace('__TAG__', tag)

// ── PAINT: does each map put pixels on the screen, and does it fill its plugin? ───────────────
// COLOURS are read off the map's OWN WebGL canvas inside its 'render' event (the drawing buffer is
// still intact there), so a legend or panel floating over the map cannot inflate the count, and
// no per-plugin clip rectangle is needed. A basemap with land, water, borders and data has hundreds
// of colours; a blank map has one. FILL is the map's height over the PLUGIN ELEMENT's height, not
// canvas over container: in gospel's incident a stylesheet collapsed the container and the canvas
// followed it, so canvas/container stayed 1.0 over a 300px strip in a 900px box.
// POISON (self-test only): 'blank' zeroes every layer's opacity (the map is white and every
// feature still counts as drawn); 'collapse' squeezes the container to 300px (the real incident).
const PAINT = (tag, poison) => `(async () => {
  const acc = []; const w = (r) => { for (const el of r.querySelectorAll('*')) { acc.push(el); if (el.shadowRoot) w(el.shadowRoot) } }; w(document)
  const host = acc.find(e => e.tagName === ${JSON.stringify('__TAG__')}.toUpperCase())
  const hb = host ? host.getBoundingClientRect() : null
  const maps = (window.__shelfMaps || []).filter(m => { try { return m.getContainer() && m.getContainer().isConnected } catch (_) { return false } })
  const poison = ${JSON.stringify('__POISON__')}
  const OPACITY = { background: ['background-opacity'], fill: ['fill-opacity'], line: ['line-opacity'], circle: ['circle-opacity', 'circle-stroke-opacity'], symbol: ['text-opacity', 'icon-opacity'], raster: ['raster-opacity'], 'fill-extrusion': ['fill-extrusion-opacity'], heatmap: ['heatmap-opacity'] }
  for (const m of maps) {
    if (poison === 'blank') for (const l of (m.getStyle().layers || [])) for (const k of (OPACITY[l.type] || [])) { try { m.setPaintProperty(l.id, k, 0) } catch (_) {} }
    if (poison === 'collapse') { const c = m.getContainer(); c.style.position = 'relative'; c.style.inset = 'auto'; c.style.height = '300px'; c.style.flex = 'none'; m.resize() }
  }
  if (poison) await new Promise(r => setTimeout(r, 1200))
  const out = []
  for (const m of maps) {
    const cb = m.getContainer().getBoundingClientRect()
    const colours = await new Promise(res => {
      const t = setTimeout(() => res(-1), 8000)
      m.once('render', () => { clearTimeout(t); try {
        const cv = m.getCanvas(), W = Math.min(480, cv.width), H = Math.max(1, Math.round(cv.height * W / cv.width))
        const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(cv, 0, 0, W, H)
        const d = x.getImageData(0, 0, W, H).data, seen = new Set()
        for (let i = 0; i < d.length; i += 4) seen.add(((d[i] >> 3) << 11) | ((d[i + 1] >> 3) << 6) | ((d[i + 2] >> 3) << 1) | (d[i + 3] > 127 ? 1 : 0))
        res(seen.size)
      } catch (_) { res(-2) } })
      m.triggerRepaint()
    })
    let drawn = 0
    try { const st = m.getStyle(), srcs = st.sources || {}, geo = Object.keys(srcs).filter(k => srcs[k].type === 'geojson'); const layers = (st.layers || []).filter(l => geo.includes(l.source)).map(l => l.id); if (layers.length) drawn = m.queryRenderedFeatures({ layers }).length } catch (_) {}
    out.push({ colours, fill: hb && hb.height ? cb.height / hb.height : 0, drawn })
  }
  return out
})()`.replace('__TAG__', tag).replace('__POISON__', poison || '')

const b = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] })

async function measure(url, s, poisonBundle, opts = {}) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
  await p.addInitScript(RECORD_MAPS)
  const seed = SEED[s.bundle]
  if (seed) await p.addInitScript(({ keyPrefix, value }) => {
    const get = Storage.prototype.getItem
    Storage.prototype.getItem = function (k) { const v = get.call(this, k); return (v == null && String(k).startsWith(keyPrefix)) ? value : v }
  }, seed)
  if (poisonBundle) await p.route(new RegExp(`/${poisonBundle}/${poisonBundle}\\.js(\\?|$)`), r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'throw new Error("shelf self-test: deliberately broken bundle")' }))
  const errs = [], fails = [], mapboxReqs = [], tokens = new Set()
  p.on('request', r => { const u = r.url(); if (/api\.mapbox\.com/.test(u)) mapboxReqs.push(u.replace(/\?.*/, '').slice(-60)); const t = u.match(/access_token=([^&]+)/); if (t) tokens.add(t[1]) })
  p.on('pageerror', e => errs.push(e.message.slice(0, 140)))
  p.on('response', r => { if (r.status() >= 400 && !/events\.mapbox\.com|favicon/.test(r.url())) fails.push(r.status() + ' ' + r.url().replace(/\?.*/, '').slice(-80)) })
  await p.goto(url)
  const host0 = opts.frame ? await p.evaluate(() => ({ title: document.title, href: location.href, y: scrollY })) : null
  // B: the plugin lives in the iframe whose document comes from the tree
  const ctx = () => (opts.frame ? p.frames().find(f => f.url().startsWith(BASE)) : p.mainFrame()) || p.mainFrame()
  let st = null, prevDrawn = ''
  const t0 = Date.now()
  // provenance needs one tile request, not a drawn map: a fake token cannot draw anything
  while (Date.now() - t0 < (opts.provenanceOnly ? Math.min(WAIT_MS, 25000) : WAIT_MS)) {
    await p.waitForTimeout(2500)
    try { st = await ctx().evaluate(PROBE(s.tag)) } catch (_) { st = null; continue }
    // SETTLED, not first-non-zero: the drawn counts must hold across two polls, or a count read
    // mid-fit (1752 of 2107 while tiles were still arriving) passes as the answer
    const drawnNow = st.maps.map(m => m.drawn).join(','), steady = drawnNow === prevDrawn; prevDrawn = drawnNow
    const mapsReady = st.maps.every(m => m.loaded && m.drawn > 0) && steady
    if (opts.provenanceOnly ? tokens.has(FAKE_TK) : (st.own > 8 && st.sized && st.busy === 0 && mapsReady && Date.now() - t0 > 6000)) break
  }
  const host1 = opts.frame ? await p.evaluate(() => ({ title: document.title, href: location.href, y: scrollY })) : null
  let paint = []
  if (!opts.provenanceOnly && st && st.maps.length) { try { paint = await ctx().evaluate(PAINT(s.tag, opts.poisonPaint)) } catch (e) { paint = [{ colours: -3, fill: 0, drawn: 0 }] } }
  await p.close()
  if (opts.provenanceOnly) {
    // C provenance: with a FAKE host token the tiles cannot load, so only one thing is asserted:
    // the requests carry the HOST's token, not a token baked into the bundle.
    const used = tokens.has(FAKE_TK), baked = [...tokens].filter(t => t !== FAKE_TK)
    return { pass: used && !baked.length, why: used ? (baked.length ? [`a token other than the host's was also used (${baked[0].slice(0, 14)}…)`] : []) : ['the host token never reached a tile request'], maps: 0 }
  }
  const why = []
  if (!st || !st.host) why.push(`<${s.tag}> never appeared`)
  else if (st.own <= 8 || !st.sized) why.push(`<${s.tag}> mounted empty (${st.own} node(s)${st.sized ? '' : ', not sized'})`)
  if (st && st.busy) why.push(`${st.busy} loading label(s) left`)
  if (st) st.maps.forEach((m, i) => { if (!m.loaded) why.push(`map ${i + 1}: 'load' never fired`); else if (!m.drawn) why.push(`map ${i + 1}: no own data drawn (${m.geo} geojson source(s))`) })
  paint.forEach((q, i) => {
    if (q.colours < 0) why.push(`map ${i + 1}: could not read its pixels (${q.colours})`)
    else if (q.colours < MIN_COLOURS) why.push(`map ${i + 1}: only ${q.colours} colour(s) on its canvas, a blank map (floor ${MIN_COLOURS})${q.drawn ? `, while ${q.drawn} features still count as drawn` : ''}`)
    if (q.fill < MIN_FILL) why.push(`map ${i + 1}: fills ${Math.round(q.fill * 100)}% of <${s.tag}>'s height, collapsed (floor ${Math.round(MIN_FILL * 100)}%)`)
  })
  if (host0 && host1 && (host0.title !== host1.title || host0.href !== host1.href || host0.y !== host1.y)) why.push(`the host page changed (title/URL/scroll): ${JSON.stringify(host0)} -> ${JSON.stringify(host1)}`)
  if (opts.noMapbox && mapboxReqs.length) why.push(`${mapboxReqs.length} api.mapbox.com request(s) under maplibre, e.g. ${mapboxReqs[0]}`)
  // ★ AND THE CONVERSE, which was missing: "0 requests under maplibre" is satisfied by a run that
  // contacted nobody, so the mapbox arm has to prove it reached Mapbox at all. Without this, the
  // day the mapbox arm silently runs MapLibre — which is what pinning provider in the snippet
  // would have caused — BOTH arms pass and the gate measures one engine twice.
  if (opts.wantMapbox && !mapboxReqs.length) why.push('asked for the Mapbox engine and made ZERO api.mapbox.com requests — this arm measured nothing')
  if (errs.length) why.push(`page error: ${errs[0]}`)
  if (fails.length) why.push(`failed request: ${fails[0]}`)
  return { pass: !why.length, why, maps: st ? st.maps.length : 0, paint, drawn: st ? st.maps.map(m => m.drawn) : [], mapboxMaps: st ? st.maps.filter(m => m.mapbox).length : 0 }
}

const leaf = (s, eng) => `${BASE}/${s.bundle}/${s.profile}/index.html?provider=${eng}` + (eng === 'mapbox' ? `&tk=${TK}` : '')
const gallery = (s, eng) => `${BASE}/doxa-maps-spa/doxa-maps-spa/index.html?tab=${s.bundle}&provider=${eng}` + (eng === 'mapbox' ? `&tk=${TK}` : '')

let exit = 0
try {
  if (SELF_TEST) {
    const s = shelf[0]
    const a = await measure(leaf(s, 'maplibre'), s, s.bundle), d = await measure(gallery(s, 'maplibre'), s, s.bundle)
    const c = await measure(`${HOST}/C/${s.bundle}/maplibre`, s, s.bundle, { noMapbox: true })
    if (a.pass || d.pass || c.pass) { console.error(`SELF-TEST FAILED: a deliberately broken ${s.bundle} still passed (${a.pass ? 'leaf ' : ''}${d.pass ? 'gallery ' : ''}${c.pass ? 'script-embed' : ''}). This gate cannot see a broken bundle.`); exit = 3 }
    else console.log(`self-test: a deliberately broken ${s.bundle} fails as it must (leaf: ${a.why[0]}; script-embed: ${c.why[0]}; gallery: ${d.why[0]})`)
    // each PAINT arm gets its own poison and must be the arm that catches it: a collapse caught
    // only by the colour floor (or a blank map caught only by fill) proves nothing about the other
    const sm = shelf.find(x => x.isMap)
    if (sm) for (const [poison, arm] of [['blank', /colour\(s\) on its canvas/], ['collapse', /of <.*>'s height, collapsed/]]) {
      const r = await measure(leaf(sm, 'maplibre'), sm, null, { poisonPaint: poison })
      if (!r.why.some(w => arm.test(w))) { console.error(`SELF-TEST FAILED: a ${poison} ${sm.bundle} map was not caught by its own arm (${r.pass ? 'it passed' : r.why.join('; ')}). This gate cannot see a ${poison} map.`); exit = 3 }
      else console.log(`self-test: a ${poison} ${sm.bundle} map fails as it must (${r.why.find(w => arm.test(w))})`)
    }
  }
  if (exit !== 3) {
    for (const [k, v] of Object.entries(SEED)) if (shelf.some(s => s.bundle === k)) console.log(`SEEDED ${k}: ${v.why}`)
    console.log(`EXPERIMENTAL SHELF — ${shelf.length} bundle(s): ${shelf.map(s => s.bundle).join(', ')} · engines: ${ENGINES.join(', ')}`)
    // B does NOT assert 0 api.mapbox.com: the iframe loads the LEAF page, and every generated leaf
    // <head> links Mapbox's JS/CSS statically whatever the provider (generate-tree's template).
    // That is a fleet-wide leaf property, reported separately; C is where a partner chooses.
    const row = (r, s, eng, surf, t0) => {
      if (!r.pass) exit = 1
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${s.bundle.padEnd(24)} ${eng.padEnd(9)} ${surf.padEnd(10)} ${(r.maps ? r.maps + ' map(s)' : 'no map').padEnd(9)} ${(r.paint && r.paint.length ? r.paint.map(q => `${q.colours}c ${Math.round(q.fill * 100)}%`).join(' ') : '').padEnd(12)} ${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s${r.pass ? '' : '  — ' + r.why.join('; ')}`)
    }
    for (const s of shelf) for (const eng of ENGINES) for (const [surf, url, opts] of [
      ['A leaf', leaf(s, eng), {}],
      ['B iframe', `${HOST}/B/${s.bundle}/${eng}`, { frame: true }],
      // The two flags are twins and set from the SAME expression, so an arm can never be
      // exempt from both: under maplibre we require zero Mapbox requests, under mapbox at least one.
      ['C script', `${HOST}/C/${s.bundle}/${eng}`, { noMapbox: eng === 'maplibre', wantMapbox: eng === 'mapbox' }],
      ['D gallery', gallery(s, eng), {}],
    ].filter(x => SURFACES.includes(x[0][0]))) {
      let t0 = Date.now()
      const r = await measure(url, s, null, opts)
      row(r, s, eng, surf, t0)
      // C host-tk: only where the script embed really made a MAPBOX map. A MapLibre-only plugin
      // (prayer-walk-planner) takes no token at all, so there is nothing to prove.
      if (surf === 'C script' && eng === 'mapbox' && r.pass) {
        if (!r.mapboxMaps) { console.log(`n/a   ${s.bundle.padEnd(24)} ${eng.padEnd(9)} C host-tk  — no Mapbox map on this plugin, it takes no token`); continue }
        t0 = Date.now()
        row(await measure(`${HOST}/C/${s.bundle}/mapbox/fake`, s, null, { provenanceOnly: true }), s, eng, 'C host-tk', t0)
      }
    }
    console.log(exit ? 'EXPERIMENTAL-SHELF: FAIL' : `EXPERIMENTAL-SHELF: PASS — every experimental plugin works ${SURFACES.map(x => ({ A: 'on its own page', B: 'iframed on another site', C: 'script-embedded on another site', D: 'in the Gallery' })[x]).filter(Boolean).join(', ')}, and every map paints, under ${ENGINES.join(' and ')}`)
  }
} finally { await b.close(); reap() }
process.exit(exit)
