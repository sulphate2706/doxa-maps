#!/usr/bin/env node
/**
 * embed-smoke.mjs — prove EVERY map embeds: load each generated profile page
 * headless and assert its custom element actually mounts.
 *
 * WHY: "embeddability works on all the maps" is the product promise. The build
 * guards prove the files exist; THIS proves each page boots — element defined,
 * shadow DOM populated, no ProfileLoader error card, and (for map profiles) a
 * WebGL canvas present.
 *
 * HOW: reads public/doxa-maps/manifest.json (the same registry partners use),
 * serves public/ itself if nothing is on --port, and drives Playwright
 * Chromium with SwiftShader software WebGL — CI boxes rarely have a GPU. (The
 * posters pipeline stays Firefox-only; this is a headless VERIFICATION harness,
 * not a rendering pipeline.)
 *
 * Usage:  node internal/embed-smoke.mjs [--port 4177] [--grep <substr>]
 * Exit:   0 all pass · 1 any fail (list printed)
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { resolve, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './lib/playwright-guarded.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PUB = resolve(__dirname, '..', 'public')
const args = process.argv.slice(2)
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const PORT = Number(argOf('--port', 4177))
const GREP = argOf('--grep', '')

// ── tiny static server (no deps; mime enough for the pages) ─────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.csv': 'text/csv' }
const server = createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (p.endsWith('/')) p += 'index.html'
    const f = join(PUB, p)
    if (!f.startsWith(PUB) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' })
    createReadStream(f).pipe(res)
  } catch { res.writeHead(500); res.end() }
})

// ── the page list: every profile page in the manifest ───────────────────────
const manifest = JSON.parse(readFileSync(join(PUB, TREE_NAME, 'manifest.json'), 'utf8'))
const targets = []
for (const b of manifest.bundles) for (const p of b.profiles) {
  // iframeUrl is ./-relative to the tree root
  const url = p.iframeUrl.replace(/^\.\//, `/${TREE_NAME}/`)
  targets.push({ bundle: b.bundle, profile: p.profile, element: p.element, url })
  // Preconfigured instances are embeddable pages too — verify them the same way.
  for (const inst of (p.instances || [])) {
    targets.push({ bundle: b.bundle, profile: `${p.profile}/${inst.id}`, element: inst.element || p.element,
      url: inst.iframeUrl.replace(/^\.\//, `/${TREE_NAME}/`) })
  }
}
const list = GREP ? targets.filter(t => (t.bundle + '/' + t.profile).includes(GREP)) : targets

await new Promise(r => server.listen(PORT, '127.0.0.1', r))
console.log(`[embed-smoke] serving ${PUB} on :${PORT} — ${list.length} profile page(s)`)

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })

// MAPBOX TOKEN — without it, EVERY map profile fails the mount assertion below and this
// gate reports a wall of "mount timeout" that looks like 13 broken plugins. It is not:
// measured 2026-09-21, my-upg-100-list/upg-100-list mounts at 1440x900 with
// "195 polys · 27/27 zones · 2107 pins" the moment a token is supplied. The same
// omission was fixed in verify-map-paint.mjs earlier; this script never had the wiring.
//
// BOTH channels are required and they are not interchangeable (measured):
//   ?tk=          reaches only the TOP-LEVEL element's profile-config
//   window.MAP_TOKEN   is what NESTED children read
// A composite profile mounts with ?tk= alone but its children stay blank, so set both.
//
// No token is NOT a failure — the run degrades to DOM-only coverage and says so, rather
// than reporting map profiles as broken. Get one with:
//   MAPBOX_TOKEN=$(curl -s -A "Mozilla/5.0" https://doxa.life/api/maps/token \
//     | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
const TOKEN = process.env.MAPBOX_TOKEN || ''
if (!TOKEN) {
  console.log('[embed-smoke] NO MAPBOX_TOKEN — map profiles cannot mount; expect them to time out.')
  console.log('[embed-smoke] Set MAPBOX_TOKEN for full coverage (see the comment in this file).')
}

const results = []
for (const t of list) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 } })
  const page = await ctx.newPage()
  if (TOKEN) await page.addInitScript(tk => { window.MAP_TOKEN = tk }, TOKEN)
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  const r = { ...t, ok: false, why: '' }
  try {
    const sep = t.url.includes('?') ? '&' : '?'
    const url = `http://127.0.0.1:${PORT}${t.url}${TOKEN ? `${sep}tk=${TOKEN}` : ''}`
    await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    // give the element time to define + mount + (maybe) paint a canvas
    await page.waitForFunction((tag) => {
      const el = document.querySelector(tag)
      return el && el.shadowRoot && el.shadowRoot.childElementCount > 0
    }, t.element, { timeout: 25000 })
    await page.waitForTimeout(4000)
    // ★ THE NODE COUNT IS A MOUNT SIGNAL, NOT A QUALITY SIGNAL — do not read it as "how much
    // rendered". This counts ONE shadow level, so a composite that nests its children BY TAG (the
    // stack-demo element/src contract, used by research-map-plus-grid to avoid bypassing the child
    // bundle's own index.js) reports only its wrapper: 12 nodes, no canvas, while a recursive walk
    // of the same page finds 518 nodes, 1 canvas, both children present and 13,867px of content.
    // That reads as a broken composite beside dashboard-plus-grid's 1,499, and it is not one —
    // measured 2026-09-23 after chasing it as a defect. Shadow DOM does not pierce; a single-level
    // querySelectorAll cannot see a tag-composed child. The `< 5` bar below is still the right
    // assertion, because it catches a mount that produced NOTHING, which is what this gate is for.
    const verdict = await page.evaluate((tag) => {
      const el = document.querySelector(tag)
      const sr = el.shadowRoot
      return {
        errorCard: !!sr.querySelector('.profile-error'),
        canvas: !!sr.querySelector('canvas'),
        nodes: sr.querySelectorAll('*').length,
      }
    }, t.element)
    if (verdict.errorCard) r.why = 'ProfileLoader error card shown'
    else if (verdict.nodes < 5) r.why = `shadow DOM nearly empty (${verdict.nodes} nodes)`
    else { r.ok = true; r.why = `${verdict.nodes} nodes${verdict.canvas ? ' + canvas' : ' (no canvas — DOM profile)'}` }
  } catch (e) {
    // ★ DO NOT COLLAPSE EVERY REJECTION INTO "mount timeout" — that is a DIAGNOSIS, and it was
    // the WRONG one. A malformed @element in the manifest made querySelector throw a SyntaxError;
    // reported as "mount timeout", it accused big-picture (tab-1 of the cap-5 SPA) of being a
    // broken plugin for as long as this suite has existed. The plugin was fine; the SELECTOR was
    // invalid. Name what actually happened and let the reader diagnose.
    const msg = String(e.message || e)
    if (/SyntaxError|is not a valid selector|failed to execute 'queryselector'/i.test(msg)) {
      r.why = `INVALID SELECTOR — @element is not a bare tag: ${JSON.stringify(t.element)} ` +
              '(fix the @element JSDoc in the bundle\'s root .vue; it is copied verbatim into manifest.json)'
    } else if (/Timeout|exceeded/i.test(msg)) {
      r.why = 'mount timeout / ' + msg.slice(0, 100)
    } else {
      r.why = 'error / ' + msg.slice(0, 100)
    }
  }
  if (errors.length && r.ok) r.why += ` · ${errors.length} pageerror(s): ${errors[0]}`
  results.push(r)
  console.log(`  ${r.ok ? '✓' : '✗'} ${t.bundle}/${t.profile} <${t.element}> — ${r.why}`)
  await ctx.close()
}
await browser.close(); server.close()

const failed = results.filter(r => !r.ok)
console.log(`\n[embed-smoke] ${results.length - failed.length}/${results.length} pages mount cleanly`)
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(`  ✗ ${f.bundle}/${f.profile} — ${f.why}`)); process.exit(1) }
