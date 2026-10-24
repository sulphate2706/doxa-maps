#!/usr/bin/env node
/**
 * check-auto-engine — the default engine ('auto') is MapLibre, token or not; Mapbox only when asked for.
 *
 * WHY. The public repo carries no Mapbox token, so a default of 'mapbox' gave a keyless visitor a map
 * that could not draw. From 2026-09-25 'auto' asked the token ladder (a token meant Mapbox); since
 * 2026-09-28 it is MapLibre whether or not a token is present (useMapProvider.js, resolveMapProvider):
 * holding a token is a capability, choosing Mapbox is a decision. A token still authenticates a map
 * that asked for Mapbox, and place search uses one on either engine.
 *
 * ⚠ THIS GATE ASSERTED THE OLD RULE FOR A DAY AND NOBODY SAW: it sat in no chain, so its case 2
 * (a host token draws Mapbox) never ran against the change that made it false. It is now in
 * gates:post, where it is NOT MEASURED outside the browser slot and runs in it.
 *
 * THREE CASES, on one map leaf of THIS tree (or --dir), each in a fresh browser context:
 *   1 NO TOKEN          the map draws with MapLibre, makes ZERO requests to any *.mapbox.com host, and
 *                       PAINTS (distinct colours on the canvas, not a blank rectangle).
 *   2 HOST TOKEN ALONE  the host sets window.MAP_TOKEN before the page runs and names no provider: the
 *                       map STILL draws with MapLibre, paints, and makes ZERO Mapbox requests. This is
 *                       the case the 09-28 rule exists for.
 *   3 ASKED FOR MAPBOX  the same host token with ?provider=mapbox: the map draws with Mapbox, and THAT
 *                       token is the access_token on its requests to Mapbox.
 * The token is a well-formed FAKE, built at run time; Mapbox requests that carry it are recorded and
 * aborted, never sent. The engine is read from the canvas that drew (mapboxgl-canvas /
 * maplibregl-canvas), not from which globals happen to exist.
 *
 * USAGE  node internal/check-auto-engine.mjs [--dir <tree root>] [--leaf <bundle>/<profile>]
 *        Run through internal/browser-slot.sh.
 * EXIT   0 all three hold · 1 one does not · 75 not measured.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const DIR = resolve(arg('--dir', resolve(ROOT, 'public')))
const LEAF = arg('--leaf', 'doxa-simple-map/doxa-simple-map')
const MIN_COLOURS = 40
const MAPBOX_HOST = /(^|\.)mapbox\.com$/i
// A fake public token of the right SHAPE (pk.<base64url JSON>.<sig>), so the engine accepts it.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const FAKE_TOKEN = ['pk', b64({ u: 'auto-engine-check', a: 'not-a-real-token' }), 'c2lnbmF0dXJl'].join('.')

if (!existsSync(join(DIR, TREE_NAME, LEAF, 'index.html'))) { console.log(`AUTO-ENGINE: NOT MEASURED — no ${LEAF} under ${DIR}/${TREE_NAME}/`); process.exit(75) }

const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => ok(n)) }) })
const srv = spawn(process.execPath, [resolve(ROOT, 'internal/serve-strict.mjs'), '--port', String(port), '--directory', DIR, '--exit-with-parent'], { stdio: 'ignore' })
const stop = () => { try { srv.kill() } catch { /* gone */ } }
let up = false
for (let i = 0; i < 40 && !up; i++) { await new Promise((r) => setTimeout(r, 150)); up = await fetch(`http://127.0.0.1:${port}/${TREE_NAME}/manifest.json`).then((r) => r.ok).catch(() => false) }
if (!up) { stop(); console.log(`AUTO-ENGINE: NOT MEASURED — could not serve ${DIR}`); process.exit(75) }
console.log(`AUTO-ENGINE: measuring THIS TREE — ${DIR} (127.0.0.1:${port}), leaf ${LEAF}`)

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

async function measure({ hostToken = '', query = '' }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const mapbox = []
  // The engine script itself may come from Mapbox's CDN; everything that CARRIES a token is recorded
  // and aborted, so the fake token never leaves this machine.
  await page.route((url) => MAPBOX_HOST.test(url.hostname), (route) => {
    const u = new URL(route.request().url())
    mapbox.push(u)
    if (u.searchParams.has('access_token')) return route.abort()
    return route.continue()
  })
  if (hostToken) await page.addInitScript((tk) => { window.MAP_TOKEN = tk }, hostToken)
  try {
    await page.goto(`http://127.0.0.1:${port}/${TREE_NAME}/${LEAF}/index.html${query}`, { waitUntil: 'load', timeout: 90000 })
    const deadline = Date.now() + 45000
    let engine = ''
    while (Date.now() < deadline && !engine) {
      engine = await page.evaluate(() => {
        const roots = [document]
        for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot)
        for (const r of roots) {
          if (r.querySelector('canvas.maplibregl-canvas')) return 'maplibre'
          if (r.querySelector('canvas.mapboxgl-canvas')) return 'mapbox'
        }
        return ''
      })
      if (!engine) await page.waitForTimeout(500)
    }
    const prompt = await page.evaluate(() => !!document.getElementById('tkIn'))
    let colours = 0
    if (engine === 'maplibre') {
      await page.waitForTimeout(8000)   // tiles
      // Straight from CDP: page.screenshot waits for web fonts first and timed out on this leaf.
      const cdp = await ctx.newCDPSession(page)
      const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
      colours = await page.evaluate(async (data) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode()
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
        const g = c.getContext('2d'); g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set()
        for (let i = 0; i < d.length; i += 4) seen.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3))
        return seen.size
      }, png.toString('base64'))
    } else {
      await page.waitForTimeout(3000)
    }
    return { engine: engine || 'none', prompt, colours, mapbox }
  } catch (e) {
    return { err: String(e.message).split('\n')[0].slice(0, 120), mapbox }
  } finally { await ctx.close() }
}

const results = []
try {
  results.push({ name: '1 no token', r: await measure({}) })
  results.push({ name: '2 host token alone', r: await measure({ hostToken: FAKE_TOKEN }) })
  results.push({ name: '3 provider mapbox + token', r: await measure({ hostToken: FAKE_TOKEN, query: '?provider=mapbox' }) })
} finally { await browser.close(); stop() }

let bad = 0, unmeasured = 0
const say = (ok, name, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(30)} ${msg}`); if (!ok) bad++ }
for (const { name, r } of results) {
  if (r.err) { console.log(`  ??    ${name.padEnd(30)} NOT MEASURED — ${r.err}`); unmeasured++; continue }
  const withToken = r.mapbox.filter((u) => u.searchParams.has('access_token'))
  const summary = `engine ${r.engine}, ${r.mapbox.length} Mapbox request(s)${r.prompt ? ', TOKEN PROMPT shown' : ''}`
  if (name.startsWith('1') || name.startsWith('2')) {
    // The same verdict for both: a token that is merely PRESENT must change nothing about the engine.
    say(r.engine === 'maplibre' && r.mapbox.length === 0 && r.colours >= MIN_COLOURS && !r.prompt, name,
      `${summary}, ${r.colours} colours (floor ${MIN_COLOURS}) — want maplibre, 0 Mapbox requests, painted, no prompt`)
  } else {
    const carries = withToken.length > 0 && withToken.every((u) => u.searchParams.get('access_token') === FAKE_TOKEN)
    say(r.engine === 'mapbox' && carries, name,
      `${summary}, ${withToken.length} carry a token${withToken.length && !carries ? ' — NOT the host token' : ''} — want mapbox, the host token on its requests`)
  }
}
if (bad) { console.log(`AUTO-ENGINE: FAIL — ${bad} of 3 case(s) do not hold.`); process.exit(1) }
if (unmeasured) { console.log(`AUTO-ENGINE: NOT MEASURED — ${unmeasured} case(s) could not be judged.`); process.exit(75) }
console.log('AUTO-ENGINE: PASS — the default draws MapLibre keyless with or without a host token; provider mapbox draws Mapbox with that token.')
