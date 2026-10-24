#!/usr/bin/env node
/**
 * smoke.mjs — boot the built site in a real browser and assert it actually works.
 *
 * WHY THIS EXISTS
 * Every other gate checks artefacts: that files exist, parse, and carry the right
 * paths. All of them passed while the app was incapable of drawing a single map,
 * because the shell had no way to obtain a Mapbox token on any host but this one.
 * Nothing that inspects files can catch that. It only shows up when a browser runs
 * the page.
 *
 * WHAT IT ASSERTS
 *   on the SHELL (/):
 *   1. it renders (has a <title>),
 *   2. it resolves a token from the endpoint the build writes,
 *   3. no uncaught page errors,
 *   4. no failed same-origin requests — this is what caught a 404 on every single
 *      page load, from a <script src> for a file that is deliberately never deployed.
 *   on a GENERATED PROFILE PAGE (picked from the manifest, never hardcoded):
 *   5. a bundle imports and registers its custom element,
 *   6. an element actually mounts with a profile-config,
 *   7. its own #status node reports no complaint,
 *   8. no uncaught errors and no failed same-origin requests there either.
 *
 * ★ 5 and 6 are asserted on the PROFILE PAGE ONLY, and that is deliberate (2026-09-22). They used
 * to be asserted on the shell too, from when the root page embedded a live preview. The gallery is
 * now a navigation CATALOG that embeds nothing, so those copies reported a product decision as a
 * failure. The shell still REPORTS both counts in its log line, so a change of behaviour is
 * visible; it just no longer fails on the intended one.
 *
 * It checks TWO surfaces, because they resolve a token by different routes and one
 * passing says nothing about the other: the shell at / fetches the endpoint itself,
 * while a generated profile page walks the six-rung ladder. A generated page is also
 * what a partner iframes, so it is the surface an outside site actually depends on.
 *
 * Requests to Mapbox and the people-group API are IGNORED: this runs offline, and
 * their failure says nothing about whether the site is correctly built.
 *
 * Usage:  bun run smoke        (serves public/ on a free port, then drives it)
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.css':'text/css', '.webp':'image/webp', '.png':'image/png',
  '.svg':'image/svg+xml', '.geojson':'application/json', '.csv':'text/csv' }

const server = createServer(async (req, res) => {
  try {
    let p = join(ROOT, decodeURIComponent(req.url.split('?')[0]))
    if ((await stat(p)).isDirectory()) p = join(p, 'index.html')
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' })
    res.end(await readFile(p))
  } catch { res.writeHead(404).end('not found') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

const EXTERNAL = ['api.mapbox.com', 'events.mapbox.com', 'pray.doxa.life', 'esm.sh']
const browser = await chromium.launch()
const page = await browser.newPage()
const pageErrors = [], failed = []
page.on('pageerror', e => pageErrors.push(e.message.split('\n')[0]))
page.on('requestfailed', r => {
  if (!EXTERNAL.some(h => r.url().includes(h))) failed.push(`${r.failure()?.errorText} ${r.url().replace(BASE, '')}`)
})

const fail = []
try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 })
  const title = await page.title()
  if (!title.trim()) fail.push('shell rendered no <title>')

  const token = await page.evaluate(async () => {
    try { const r = await fetch('./api/maps/token.json'); return r.ok ? ((await r.json()).token || '') : `HTTP ${r.status}` }
    catch (e) { return 'ERR ' + e.message }
  })
  if (!String(token).startsWith('pk.') && !String(token).startsWith('tk.'))
    fail.push(`shell could not resolve a token from ./api/maps/token.json (got: ${token}) — every basemap would be blank`)

  // ── THE SHELL IS A CATALOG, NOT A HOST — these two counts are REPORTED, NOT ASSERTED ────────
  //
  // ★ CORRECTED 2026-09-22. This block used to fail when the shell mounted no element. That was
  // right when the root page embedded a live preview; it is wrong now. It was first relaxed when
  // the root was the GALLERY (a capability-sorted NAVIGATION CATALOG whose four "profile-config"
  // occurrences were all escaped snippet text), and it stays relaxed now that the root is the
  // PLUGIN STUDIO, for the stronger reason spelled out below: <plugin-studio> mounts its panes ON
  // ACTIVATION, and it carries no profile-config attribute of its own here, so a load-time count of
  // [profile-config] is 0 BY DESIGN on this page. Asserting it would fail the build on correct
  // behaviour — the classic case of a gate measuring the wrong surface.
  //
  // THE COVERAGE IS NOT LOST, which is the only reason this is safe to relax: the generated-profile
  // block below asserts the SAME TWO THINGS ("mounted no element" / "imported no bundle that
  // registered its element") against a real leaf page picked from the manifest — and that surface
  // passes (mounted=1). 41 of the built leaf pages mount with a profile-config at load (corrected
  // 2026-09-22 — an earlier note said 21, which came from sampling only the first 30 leaves). So these
  // were duplicate assertions aimed at the one surface that by design satisfies neither.
  //
  // WHY NOT RE-AIM THEM AT plugin-studio INSTEAD (my first instinct, and it was wrong): the cap-5
  // studio leaf has exactly ONE [profile-config] element at load — its own <plugin-studio> host —
  // and ZERO nested elements or live iframes. It mounts panes ON ACTIVATION, which is the lazy
  // design that keeps the shell fast. A load-time assertion cannot see behaviour that starts on a
  // click. Verified in a browser before changing this.
  //
  // KEPT AS OUTPUT so a regression is still visible: if the shell ever starts mounting again, or a
  // future catalog page is expected to, these numbers say so in the log line below.
  const registered = await page.evaluate(() =>
    [...document.querySelectorAll('[profile-config]')].map(e => e.tagName.toLowerCase())
      .filter(t => !!customElements.get(t)))

  const mounted = await page.evaluate(() => document.querySelectorAll('[profile-config]').length)

  if (pageErrors.length) fail.push(`uncaught page errors: ${pageErrors.slice(0, 3).join(' | ')}`)
  if (failed.length) fail.push(`failed same-origin requests: ${failed.slice(0, 3).join(' | ')}`)

  console.log(`[smoke] shell   title=${JSON.stringify(title)} token=${String(token).slice(0, 6)}… registered=[${registered}] mounted=${mounted}`)

  // A generated profile page — the surface a partner iframes. Picked from the
  // manifest rather than hardcoded, so renaming or removing a bundle cannot leave
  // this silently checking a page that no longer exists.
  const manifest = JSON.parse(await readFile(join(ROOT, TREE_NAME, 'manifest.json'), 'utf8'))
  const first = manifest.bundles.find(b => b.profiles?.length)
  if (!first) fail.push('manifest declares no bundle with a profile — nothing to iframe')
  else {
    const path = `/${TREE_NAME}/${first.bundle}/${first.profiles[0].profile}/`
    const p2 = await browser.newPage()
    const err2 = [], failed2 = []
    p2.on('pageerror', e => err2.push(e.message.split('\n')[0]))
    p2.on('requestfailed', r => { if (!EXTERNAL.some(h => r.url().includes(h))) failed2.push(`${r.failure()?.errorText} ${r.url().replace(BASE, '')}`) })
    await p2.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 })
    const mounted2 = await p2.evaluate(() => document.querySelectorAll('[profile-config]').length)
    const defined2 = await p2.evaluate(() => [...document.querySelectorAll('[profile-config]')]
      .map(e => e.tagName.toLowerCase()).filter(t => !!customElements.get(t)))
    // These pages surface their own failure in #status — an empty one means no complaint.
    const status = await p2.evaluate(() => document.getElementById('status')?.textContent.trim() || '')
    if (!mounted2) fail.push(`${path} mounted no element`)
    if (!defined2.length) fail.push(`${path} imported no bundle that registered its element`)
    if (status) fail.push(`${path} reported: ${status.slice(0, 90)}`)
    if (err2.length) fail.push(`${path} uncaught errors: ${err2.slice(0, 2).join(' | ')}`)
    if (failed2.length) fail.push(`${path} failed same-origin requests: ${failed2.slice(0, 2).join(' | ')}`)
    console.log(`[smoke] profile ${path} defined=[${defined2}] mounted=${mounted2}`)
    await p2.close()
  }
} finally {
  await browser.close(); server.close()
}

if (fail.length) { console.error('\n[smoke] FAILED:'); for (const f of fail) console.error('  ✗ ' + f); process.exit(1) }
console.log('[smoke] PASS — the built site boots, resolves a token, and mounts a map')
