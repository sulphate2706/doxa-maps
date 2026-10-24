#!/usr/bin/env node
/**
 * check-snippets-draw — every PUBLISHED embed snippet draws, pasted verbatim on a partner page on another origin.
 * (card GATE-EVERY-PUBLISHED-SNIPPET-DRAWS-A-MAP; ported from the browser probes snipgate.mjs and mbxcheck.mjs)
 *
 * WHY. The manifest's embed snippets are the one artefact a partner copies. check:snippet-engine proves what a
 * snippet SAYS (the engine it preloads, the provider it names); only a browser proves it DRAWS. The probe this is
 * ported from caught what no static check can: country-map's null centre, a dead map from an unedited paste.
 *
 * TWO ARMS, TWO SCRIPTS, so the keyless arm is never held hostage by a missing token:
 *   default   check:snippets-draw          each production profile's embed.script, verbatim: only YOUR_TREE_URL and
 *                                         YOUR_SOURCE filled, "tk":"YOUR_MAPBOX_TOKEN" left as an unedited partner
 *                                         leaves it. A map must draw with MapLibre.
 *   --mapbox  check:snippets-draw:mapbox   each production profile's embed.scriptMapbox, verbatim, with ONLY
 *                                         YOUR_MAPBOX_TOKEN filled from env MAP_TOKEN. No token: NOT MEASURED (75),
 *                                         never a pass. The token is never printed: pk.* and access_token= are
 *                                         redacted in every logged line.
 *
 * PASS, per profile:
 *   draws a map  a hooked engine instance on the EXPECTED engine reports isStyleLoaded() with a sized canvas, >= 1
 *                tile answered 2xx (glyphs and sprites excluded), no failure note ("could not start" / "token or
 *                connection"), 0 page errors. The hook is a SETTER TRAP: Object.defineProperty on window.maplibregl /
 *                mapboxgl wraps Map the moment the UMD assigns the global (a 3 ms poll alone missed upg-100-mfe).
 *                If no instance is caught, the evidence must hold instead: style 2xx + tiles 2xx + a sized canvas of
 *                the expected engine's class + no note.
 *   no map       >= 20 elements in the element's shadow tree and >= 50 characters of visible text, 0 page errors.
 * ★ A COMPOSITE THAT OPENS ON A LIST is pressed to its map view first (PRESS), with the settle rule: click only when
 *   the target is the top element at its centre and that centre held still across two reads 200 ms apart.
 *   regions-mfe's engine draws while its map pane is hidden, so without the press a canvas check passes on a map
 *   nobody sees.
 *
 * Browser gate: through lib/playwright-guarded, so NOT MEASURED outside the browser slot.
 * Usage: node internal/check-snippets-draw.mjs [--mapbox] [--only bundle/profile,…] [--all]
 * EXIT 0 every production snippet draws · 1 one does not · 2 usage · 75 not measured
 */
import { chromium, NOT_MEASURED, requireBrowserSlot } from './lib/playwright-guarded.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const MAPBOX = argv.includes('--mapbox')
const ALL = argv.includes('--all')
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1] || '').split(',').filter(Boolean) : null
const TK = process.env.MAP_TOKEN || ''
const red = (s) => String(s).replace(/pk\.eyJ[A-Za-z0-9_.-]*/g, 'pk.R').replace(/access_token=[^&\s"]+/g, 'access_token=R')
const LABEL = MAPBOX ? 'SNIPPETS-DRAW (mapbox)' : 'SNIPPETS-DRAW'

// Composites that open on a list: the button that shows the map. Pressed in both arms.
const PRESS = {
  'regions-dashboard/regions-mfe': '^region dashboards$',
  'my-upg-100-list/upg-100-mfe': '^map$',
}

if (MAPBOX && !/^pk\./.test(TK)) { console.log(`${LABEL}: NOT MEASURED — no Mapbox token in MAP_TOKEN (never a pass without one)`); process.exit(NOT_MEASURED) }
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
if (!existsSync(MANIFEST)) { console.log(`${LABEL}: NOT MEASURED — no public/${TREE_NAME}/manifest.json; build the tree first`); process.exit(NOT_MEASURED) }
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const every = []
for (const b of manifest.bundles || []) for (const p of b.profiles || []) {
  const script = MAPBOX ? p.embed?.scriptMapbox : p.embed?.script
  if (script) every.push({ id: `${b.bundle}/${p.profile}`, bundle: b.bundle, stage: p.stage || '?', isMap: !!p.isMap || !!p.embed?.scriptMapbox, script })
}
const unknown = (ONLY || []).filter((x) => !every.some((y) => y.id === x))
if (unknown.length) { console.error(`${LABEL}: --only names no ${MAPBOX ? 'scriptMapbox ' : ''}snippet: ${unknown.join(', ')}`); process.exit(2) }
const LIST = every.filter((x) => (ONLY ? ONLY.includes(x.id) : x.stage === 'production' || ALL))
  .sort((a, c) => (a.stage === 'production' ? 0 : 1) - (c.stage === 'production' ? 0 : 1))

const free = () => new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => ok(n)) }) })
// The slot is checked BEFORE anything is started: the guard refuses with process.exit, and a server spawned
// before that refusal outlives the gate (measured 2026-09-29: 41 orphaned serve-strict processes on this box).
requireBrowserSlot('check-snippets-draw')
const TP = await free()
const srv = spawn(process.execPath, [join(ROOT, 'internal/serve-strict.mjs'), '--port', String(TP), '--directory', join(ROOT, 'public'), '--exit-with-parent'], { stdio: 'ignore' })
const TREE = `http://127.0.0.1:${TP}/${TREE_NAME}`
// The partner page is served from ANOTHER origin (localhost, not 127.0.0.1), as a partner's site would be.
const fill = (x) => {
  let s = x.script.replaceAll(`./${x.bundle}/`, `${TREE}/${x.bundle}/`).replaceAll('YOUR_TREE_URL', TREE).replaceAll('YOUR_SOURCE', 'check-snippets-draw')
  if (MAPBOX) s = s.replaceAll('YOUR_MAPBOX_TOKEN', TK)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>partner · ${x.id}</title></head><body><main style="max-width:1200px;margin:0 auto"><h1>Partner page</h1><div style="min-height:820px">${s}</div></main></body></html>`
}
const psrv = createServer((req, res) => {
  const id = decodeURIComponent((req.url.match(/\/s\/(.+)$/) || [])[1] || '')
  const x = every.find((y) => y.id === id)
  res.writeHead(x ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(x ? fill(x) : 'no snippet')
})
const PP = await free()
await new Promise((ok) => psrv.listen(PP, '127.0.0.1', ok))
const stop = () => { try { srv.kill() } catch {} try { psrv.close() } catch {} }
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { stop(); process.exit(143) })
process.on('exit', () => { try { srv.kill() } catch {} })   // every exit path, crashes included
let up = false
for (let i = 0; i < 40 && !up; i++) { await new Promise((r) => setTimeout(r, 150)); up = await fetch(`${TREE}/manifest.json`).then((r) => r.ok).catch(() => false) }
if (!up) { stop(); console.log(`${LABEL}: NOT MEASURED — could not serve public/`); process.exit(NOT_MEASURED) }

const TILE = /\.(pbf|mvt)(\?|$)|\/tiles?\/|\/v4\/|\/\d+\/\d+\/\d+(@2x)?(\.(png|jpe?g|webp|pbf|mvt))?(\?|$)/i
const WANT = MAPBOX ? 'mapboxgl' : 'maplibregl'
const DEEP = `const all = []; const w = (r) => { for (const e of r.querySelectorAll('*')) { all.push(e); if (e.shadowRoot) w(e.shadowRoot) } }; w(document);`
const OUT = mkdtempSync(join(tmpdir(), 'snippets-draw-'))
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const results = []
try {
  for (const x of LIST) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errs = []; const engines = new Set(); let tilesOk = 0; let tilesBad = 0; const styleOk = []
    page.on('pageerror', (e) => errs.push(red(e.message).slice(0, 110)))
    page.on('request', (r) => { const u = r.url(); if (/maplibre-gl|mapbox-gl/.test(u)) engines.add(/maplibre-gl/.test(u) ? 'maplibre-gl' : 'mapbox-gl') })
    page.on('response', (r) => {
      const u = r.url()
      if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u)) return            // our own tree and page, not the basemap
      if (TILE.test(u) && !/\/(fonts|glyphs|sprites?)\//.test(u)) { if (r.status() < 300) tilesOk++; else tilesBad++ }
      else if (/\/styles?\/|style\.json/.test(u) && r.status() < 300) styleOk.push(red(u).split('?')[0].slice(-60))
    })
    await page.addInitScript(() => {
      window.__sdMaps = []
      const wrap = (k, g) => { if (g && g.Map && !g.Map.prototype.__sd) { const O = g.Map; g.Map = class extends O { constructor(...a) { super(...a); window.__sdMaps.push({ k, m: this }) } }; g.Map.prototype.__sd = 1 } return g }
      for (const k of ['maplibregl', 'mapboxgl']) { let v; try { Object.defineProperty(window, k, { configurable: true, get() { return v }, set(y) { v = wrap(k, y) } }) } catch {} }
      const t = setInterval(() => { for (const k of ['maplibregl', 'mapboxgl']) wrap(k, window[k]) }, 3); setTimeout(() => clearInterval(t), 120000)
    })
    const t0 = Date.now(); let st = null; let pressed = null
    try {
      await page.goto(`http://localhost:${PP}/s/${encodeURIComponent(x.id)}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
      if (PRESS[x.id]) {
        // The settle rule: the target must be the top element at its centre, and hold still across two reads 200 ms apart.
        const find = `(() => { ${DEEP} const t = all.find((e) => e.tagName === 'BUTTON' && new RegExp(${JSON.stringify(PRESS[x.id])}, 'i').test((e.textContent || '').replace(/\\s+/g, ' ').trim()) && e.getBoundingClientRect().width > 0); if (!t) return null; const q = t.getBoundingClientRect(); const cx = q.left + q.width / 2, cy = q.top + q.height / 2; let top = document.elementFromPoint(cx, cy); while (top && top.shadowRoot) { const d = top.shadowRoot.elementFromPoint(cx, cy); if (!d || d === top) break; top = d } return { x: Math.round(cx), y: Math.round(cy), hit: !!top && (top === t || t.contains(top)) } })()`
        let prev = null
        for (let k = 0; k < 150; k++) {
          const r = await page.evaluate(find)
          if (r && r.hit && prev && prev.x === r.x && prev.y === r.y) { await page.mouse.click(r.x, r.y); pressed = r; break }
          prev = r; await page.waitForTimeout(200)
        }
      }
      for (let k = 0; k < 40; k++) {
        await page.waitForTimeout(1000)
        st = await page.evaluate(`(() => { ${DEEP}
          const canv = all.filter((e) => e.tagName === 'CANVAS' && /gl-canvas/.test(String(e.className))).map((e) => ({ cls: String(e.className).split(' ')[0], w: e.clientWidth, h: e.clientHeight }))
          const maps = (window.__sdMaps || []).map((y) => { try { return { k: y.k, loaded: y.m.isStyleLoaded(), w: y.m.getCanvas().clientWidth, h: y.m.getCanvas().clientHeight } } catch { return { k: y.k, loaded: false, w: 0, h: 0 } } })
          const host = [...document.querySelectorAll('main *')].find((e) => e.shadowRoot); const inner = []
          if (host) { const ww = (n) => { for (const e of n.querySelectorAll('*')) { inner.push(e); if (e.shadowRoot) ww(e.shadowRoot) } }; ww(host.shadowRoot) }
          const text = inner.filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && e.children.length === 0 }).map((e) => (e.textContent || '').trim()).join(' ').length
          const note = (all.find((e) => e.children.length < 3 && /could not start|token or connection/i.test(e.textContent || '')) || {}).textContent || null
          return { canv, maps, shadow: inner.length, text, note: note ? note.trim().slice(0, 90) : null } })()`)
        const drew = st.maps.some((m) => m.k === WANT && m.loaded && m.w > 0 && m.h > 0) && tilesOk > 0
        if (x.isMap ? drew : (st.shadow >= 20 && st.text >= 50 && Date.now() - t0 > 12000)) break
      }
    } catch (e) { errs.push('PROBE ' + red(String(e.message || e)).split('\n')[0].slice(0, 100)) }
    const why = []
    if (!st) why.push('page never measured')
    else if (x.isMap) {
      const hooked = st.maps.find((m) => m.k === WANT && m.loaded && m.w > 0 && m.h > 0)
      const canvasOk = st.canv.some((c) => c.cls === `${WANT}-canvas` && c.w > 0 && c.h > 0)
      const evidence = !st.maps.length && canvasOk && styleOk.length > 0 && tilesOk > 0 && !st.note
      if (!hooked && !evidence) why.push(`no ${WANT} map with its style loaded and a sized canvas`)
      if (!tilesOk) why.push('0 tiles answered 2xx')
      if (st.note) why.push(`failure note shown: "${st.note}"`)
      if (MAPBOX && engines.has('maplibre-gl')) why.push('fetched maplibre-gl on the Mapbox snippet')
      if (!MAPBOX && engines.has('mapbox-gl')) why.push('fetched mapbox-gl on the default snippet')
      if (PRESS[x.id] && !pressed) why.push('its map view could not be pressed (the settle rule never held)')
    } else {
      if (st.shadow < 20) why.push(`shadow tree has ${st.shadow} elements`)
      if (st.text < 50) why.push(`visible text ${st.text} chars`)
    }
    if (errs.length) why.push(`${errs.length} page error(s): ${errs[0]}`)
    const verdict = why.length ? 'FAIL' : 'PASS'
    if (verdict === 'FAIL') await page.screenshot({ path: join(OUT, `${x.id.replace('/', '_')}.png`) }).catch(() => {})
    results.push({ ...x, verdict, why })
    console.log(`${verdict} [${x.stage}] ${x.id} · ${x.isMap ? `map on ${WANT}` : 'no map'}${pressed ? ' · pressed its map view' : ''} · ${why.join('; ') || 'ok'} · tiles 2xx ${tilesOk} / other ${tilesBad} · ${Math.round((Date.now() - t0) / 1000)} s`)
    await ctx.close()
  }
} finally { await browser.close(); stop() }

const prod = results.filter((r) => r.stage === 'production'); const failed = prod.filter((r) => r.verdict === 'FAIL')
const extra = results.filter((r) => r.stage !== 'production')
if (!prod.length) { console.log(`${LABEL}: NOT MEASURED — no production ${MAPBOX ? 'scriptMapbox ' : ''}snippets selected`); process.exit(NOT_MEASURED) }
console.log(`\n${LABEL}: ${failed.length ? 'FAIL' : 'PASS'} — production ${prod.length - failed.length}/${prod.length} draw`
  + (failed.length ? ` · FAIL: ${failed.map((r) => `${r.id} (${r.why.join('; ')})`).join(' | ')} · screenshots in ${OUT}` : '')
  + (extra.length ? ` · experimental (information only) ${extra.filter((r) => r.verdict === 'PASS').length}/${extra.length}` : ''))
process.exit(failed.length ? 1 : 0)
