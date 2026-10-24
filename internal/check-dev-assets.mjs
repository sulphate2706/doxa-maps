#!/usr/bin/env node
/**
 * check-dev-assets — under the DEV SERVER, every plugin reaches the shared asset pool.
 *
 * WHY (2026-09-25, reported from a laptop running `bun run dev`): under the Plugin Studio, Big Picture,
 * Regions, UPG-100 (and its posters), Cities with Internet and Gospel drew with NO boundary polygons.
 * The built tree was fine, and every gate measured the built tree. In dev, a plugin that falls back to
 * the page-relative './assets' on a /__leaf/<bundle>/<profile> page asked for /__leaf/<bundle>/assets/…,
 * which the dev server answered with the leaf's own HTML at HTTP 200: JSON.parse failed, and the map
 * drew with no polygons, previews, fonts or tables. One cause, four faces.
 *
 * WHAT IS ASSERTED, on a dev server whose identity is printed first:
 *   HTTP     boundaries/, previews/, fonts/, images/ and tables/ each resolve (200, not HTML) at every
 *            prefix a dev page can produce: /assets/, /__plugin-gallery/assets/, /<tree>/assets/,
 *            /__leaf/<bundle>/assets/ and /__leaf/<bundle>/<profile>/assets/.
 *   LEAVES   every leaf of the seven studio maps (Big Picture, Simple Research, Regions, UPG-100, Prayer
 *            Progress, Cities, Gospel): its dev page hands the element assetsBase "/assets" (as a built
 *            leaf hands "../../assets"); a boundary file and a table under THAT base answer 200 with bytes
 *            that JSON.parse, and a bogus file under it is a real 404, not HTML.
 *   HEADLESS by project rule (browsers are one agent's, on this machine): whether each map then DRAWS
 *            its polygons is a visual check, handed over as "needs eyes".
 *
 * USAGE  node internal/check-dev-assets.mjs [--url http://127.0.0.1:5190]
 *        Without --url it starts a SHORT-LIVED dev server for THIS checkout on a free port and stops it.
 * EXIT   0 pass · 1 an asset does not resolve · 75 not measured.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const MAP_BUNDLES = ['dashboard-plus-grid', 'doxa-research-map', 'regions-dashboard', 'my-upg-100-list', 'doxa-simple-map', 'cities-internet', 'gospel-resources']
const JSON_SAMPLES = ['boundaries/world-adm0.geojson', 'tables/country-connectivity.json']
const SAMPLES = ['boundaries/world-adm0.geojson', 'previews/andean-caribbean.webp', 'fonts/bebas-neue/bebas-neue-latin.woff2', 'images/worldmap.svg', 'tables/arclight-index.json']

let BASE = arg('--url', ''), dev = null
const stop = () => { if (dev) { try { process.kill(-dev.pid) } catch { try { dev.kill() } catch { /* gone */ } } } }
if (!BASE) {
  const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => ok(n)) }) })
  dev = spawn('bun', ['x', 'vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true })
  BASE = `http://127.0.0.1:${port}`
  let up = false
  for (let i = 0; i < 120 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch(BASE + '/').then((r) => r.ok).catch(() => false) }
  if (!up) { stop(); console.log(`DEV-ASSETS: NOT MEASURED — the dev server did not come up on ${BASE}`); process.exit(75) }
  const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  const dirty = spawnSync('git', ['status', '--porcelain', '--', 'library', 'plugin-designs', 'internal', 'vite.config.js'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  console.log(`DEV-ASSETS: measuring a dev server started for THIS checkout — ${ROOT} @ ${sha}${dirty ? ' + uncommitted changes' : ''} on ${BASE}`)
} else {
  const id = await fetch(BASE + '/__dev-sha').then((r) => (r.ok ? r.text() : '')).catch(() => '')
  console.log(`DEV-ASSETS: measuring ${BASE}${id ? ` — serving ${id.trim()}` : ' — (it does not report which commit it serves)'}`)
}

let bad = 0
try {
  // ── HTTP ──
  const prefixes = ['/assets/', '/__plugin-gallery/assets/', `/${TREE_NAME}/assets/`, '/__leaf/regions-dashboard/assets/', '/__leaf/my-upg-100-list/upg-100-list/assets/']
  for (const p of prefixes) {
    const res = []
    for (const s of SAMPLES) {
      const r = await fetch(BASE + p + s).catch(() => null)
      const ct = r ? r.headers.get('content-type') || '' : ''
      const ok = r && r.status === 200 && !/text\/html/.test(ct)
      if (!ok) { bad++; res.push(`${s.split('/')[0]} ${r ? r.status : 'ERR'}${/html/.test(ct) ? ' (HTML)' : ''}`) }
    }
    console.log(`  ${res.length ? 'FAIL' : 'ok  '}  ${p.padEnd(44)} ${res.length ? res.join(', ') : SAMPLES.map((s) => s.split('/')[0]).join(' ') + ' all 200'}`)
  }

  // ── EVERY LEAF OF THE SEVEN MAPS: the base its page hands the element serves REAL, parseable data ──
  // (bytes + JSON.parse, never an HTML fallback), and a bogus path under the same base is a real 404.
  const reg = await fetch(BASE + '/__plugin-gallery/registry.json').then((r) => r.json()).catch(() => [])
  const leaves = []
  for (const b of reg) if (MAP_BUNDLES.includes(b.bundle)) for (const it of b.items || []) leaves.push(`/__leaf/${b.bundle}/${it.profile}`)
  if (leaves.length < MAP_BUNDLES.length) { bad++; console.log(`  FAIL  registry lists ${leaves.length} leaves for the ${MAP_BUNDLES.length} map bundles`) }
  for (const leaf of leaves) {
    const html = await fetch(BASE + leaf).then((r) => r.text()).catch(() => '')
    const m = /profile-config='([^']*)'/.exec(html)
    let base = ''
    try { base = JSON.parse(m[1]).assetsBase || '' } catch { /* no config */ }
    const out = []
    let ok = base === '/assets'
    if (!ok) out.push(`assetsBase ${JSON.stringify(base)}`)
    const at = (f) => base ? BASE + base + '/' + f : new URL('assets/' + f, BASE + leaf).href
    for (const f of JSON_SAMPLES) {
      const r = await fetch(at(f)).catch(() => null)
      const body = r ? await r.text() : ''
      let parsed = false
      try { JSON.parse(body); parsed = true } catch { /* not JSON */ }
      if (!r || r.status !== 200 || !parsed) { ok = false; out.push(`${f} ${r ? r.status : 'ERR'}${parsed ? '' : ' NOT JSON'}`) } else out.push(`${f.split('/').pop()} ${body.length} B`)
    }
    const ctl = await fetch(at('boundaries/no-such-file.geojson')).catch(() => null)
    if (!ctl || ctl.status !== 404) { ok = false; out.push(`bogus path ${ctl ? ctl.status : 'ERR'} (want 404)`) }
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${leaf.padEnd(52)} assetsBase ${base || '(none)'}: ${out.join(', ')}${ok ? ', bogus 404' : ''}`)
  }
} finally { stop() }

if (bad) { console.log(`DEV-ASSETS: FAIL — ${bad} check(s): the dev server does not hand every plugin the asset pool.`); process.exit(1) }
console.log('DEV-ASSETS: PASS — the pool resolves at every prefix a dev page can produce, and dev leaves hand it to their element.')
