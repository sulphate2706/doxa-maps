#!/usr/bin/env node
/**
 * check-research-gallery-embed.mjs — the cap-5 Research Gallery (<doxa-maps-spa>) must embed on
 * SOMEONE ELSE'S page, in both embed modes, with every nested map painting.
 *
 * WHAT THIS PROTECTS. The gallery is going onto the DX-life research page. Every other gate loads
 * the gallery on its OWN generated leaf page, which bakes the three things a nested map needs —
 * window.MAP_APP_API_URL, window.MAP_TOKEN and a correct assets path — and pins the tag
 * position:fixed. A foreign page supplies none of that, so those gates cannot see the embed failing.
 * Measured 2026-09-24 before the fix, from a second origin: the gallery drew OVER the host's header
 * (the element had no :host box, so the layout's position:absolute root anchored to the viewport),
 * and 8 of 13 tabs showed an error card because every data call hit the host's origin.
 *
 * HOW. Serves the built tree with internal/serve-strict.mjs (production parity: strict directories,
 * ACAO:*) on 127.0.0.1, and a stand-in host page on `localhost` — a DIFFERENT ORIGIN, so CORS is
 * genuinely exercised. The host page has its own header and footer around the embed. Then, per mode:
 *   js     — `<script src=…/doxa-maps-spa.js>` + a bare `<doxa-maps-spa>` tag, NO attributes: the
 *            zero-config embed the docs promise.
 *   iframe — an <iframe> at the gallery's leaf page.
 * and for every tab in the rail: select it, wait for it to mount, then assert.
 *
 * ASSERTIONS (a FAIL names the tab and the reason):
 *   1. js mode: the layout root sits INSIDE the element's box (not at the viewport origin).
 *   2. every tab reaches state 'ready' (never 'error', never stuck 'idle'/'loading').
 *   3. every CURATED tab paints a WebGL canvas — they are all maps or map composites.
 *      Experimental tabs need only mount: some are cards or legacy frames with no canvas.
 *   5. GOOD NEIGHBOUR (full runs only): embedded below the fold on a phone-width host page with hostile
 *      typography, the gallery must not scroll the host, rewrite its URL or title, or inherit its
 *      font metrics — after load and after every tab. Nested-plugin violations are listed, owned and
 *      printed in NEIGHBOUR_KNOWN until their owners fix them.
 *   4. zero failed requests to the TREE's own origin (a 404/CORS on our assets is our bug; third-
 *      party tile/glyph hiccups are reported, not failed — they are not this repo's to fix).
 *
 * PRECONDITION: a built tree in public/<tree> (named in the build config; this starts its own servers; no dev server).
 * Usage:  node internal/check-research-gallery-embed.mjs [--mode js|iframe] [--only id,id] [--provider maplibre]
 * Exit:   0 pass · 1 fail · 2 SKIP (no built tree / no browser) · 75 NOT MEASURED (server identity)
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const MODES = argOf('--mode', '') ? [argOf('--mode', '')] : ['js', 'iframe']
const ONLY = argOf('--only', '') ? argOf('--only', '').split(',') : null
// --provider maplibre: the KEYLESS embed. The host asks for maplibre (attribute in js mode, ?provider=
// in iframe mode) and every tab must still paint — with ZERO requests to api.mapbox.com. That is the
// promise a keyless partner embed depends on, and the shell once broke it by not forwarding the engine.
const PROVIDER = argOf('--provider', '')
// --live-cors: serve the tree with the LIVE static layer's CORS rule (no Access-Control-Allow-Origin
// on the tree-root manifest.json; see serve-strict LIVE_CORS). The gallery must still boot on a
// foreign page, by reading the CORS-readable copy generate-tree writes beside its bundle.
const LIVE_CORS = argv.includes('--live-cors')
// KNOWN, ROUTED exemptions from the zero-Mapbox rule — each names its owner. Printed on every run so
// it cannot become invisible; DELETE the entry when the owner lands the fix (the gate then enforces it).
// KNOWN, ROUTED good-neighbour violations by NESTED plugins (key = '<tab id>:<scroll|url|title>').
// Same contract as MAPBOX_KNOWN: printed on every run, owner named, and DELETED in the same commit
// as the owner's fix so main never carries a stale exemption or a red gate on someone else's bug.
const NEIGHBOUR_KNOWN = {
  // EMPTY ON PURPOSE, and by two separate fixes landing together in this merge. The research-map
  // scrollIntoView entries were deleted by their owner when that fix landed; the two
  // regions-dashboard entries (:url and :title) are deleted here in the same commit as the fix that
  // makes region-dashboards honour profile-config.urlSync:false in writeUrl, syncTitle and
  // popstate. Same contract as MAPBOX_KNOWN below: an exemption is printed on every run, names its
  // owner, and is deleted in the SAME commit as the fix, so main never carries a stale exemption
  // and never red-flags a bug that is already fixed.
}
// KNOWN, ROUTED gaps in a composite's internal link (not measurable as pass/fail yet: no DOM hook).
const LINKED_KNOWN = {
  // EMPTY ON PURPOSE. The one entry — upg-100's "Show on map" not selecting the zone, routed 2026-09-25 —
  // is DELETED as STALE, not waived. It outlived its defect by three landings, and the gate's own contract
  // above says an exemption is deleted in the SAME commit as the fix; that did not happen here, so the
  // register red-flagged a bug that was already gone.
  // ⚠ PROVEN BEFORE DELETING, because "someone said it is fixed" is how a stale exemption becomes a hidden
  // live one. Measured on main:
  //   - the entry claimed onShowOnMap "answers with go('map') only; it never re-dispatches
  //     doxa:select-zone". It does: upg-100-mfe.vue dispatches that event AND sets a `select-zone`
  //     attribute first, so a pane that mounts later still reads the request.
  //   - the cited coordinate upg-100-mfe.vue:143 is an unrelated comment about tab rendering; the handler
  //     is at :274. A file: line in a register ages into a false claim the moment anyone edits above it.
  //   - both fixes are ancestors of main: 12a64702 (release the retained request on success — the FIRST
  //     press was losing the zone) and 67e9ede5 (the wall clears its memory when its pane goes inert).
  //   - the receiving side still registers its listener.
  //   - a browser check proved it end to end on BOTH engines at 810ffa26.
}
const MAPBOX_KNOWN = {
  // pplr-data-maps (new Experimental bundle) loads the Mapbox GEOCODER script even when
  // the host asked for maplibre: the only api.mapbox.com request in the whole keyless gallery, both
  // modes, measured 2026-09-25 while that tab was open. Routed to its owner; delete this entry in
  // the owner's fix commit so the gate enforces zero again.
  'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.min.js': 'pplr-data-maps loads the Mapbox geocoder under maplibre',
  // EMPTY ON PURPOSE. The one entry here — my-upg-100-list/upg-100-list.vue:1464 pinning
  // mapbox-gl.css v3.3.0 regardless of engine — was fixed and the exemption deleted in the SAME
  // COMMIT as the fix, so main never had a window where the gate red-flagged its own known bug and
  // never had a window where a stale exemption hid a live one. Proven before deletion: this gate
  // reported "provider=maplibre made 0 request(s) to api.mapbox.com" in BOTH js and iframe modes,
  // with no KNOWN line printed at all.
  //
  // ⚠ NOT COVERED BY THIS MAP, and deliberately so: the generated leaf HEAD still preloads
  // mapbox-gl.css v3.24.0 and mapbox-gl-geocoder v5.0.0. Different versions, different owner —
  // that is generate-tree (bundler-1's lane), tracked as
  // BUG-LEAF-PAGES-PRELOAD-MAPBOX-EVEN-UNDER-MAPLIBRE. This gate embeds the GALLERY, which does not
  // load those leaves, which is why it reads zero today.
}
// ★ FREE PORTS, ASKED OF THE OS — never fixed ones. A stray server left on a fixed port by an
// earlier crashed run answered in place of the tree under test, and this gate PASSED a known-broken
// tree (caught by its own negative control, 2026-09-24): spawn failed with EADDRINUSE silently and
// the old server served the fixed build. A port the OS just handed out cannot be someone else's.
const freePort = () => new Promise(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const TREE_PORT = await freePort()
const HOST_PORT = await freePort()
const TREE = `http://127.0.0.1:${TREE_PORT}/${TREE_NAME}`

if (!existsSync(resolve(ROOT, `public/${TREE_NAME}/doxa-maps-spa/doxa-maps-spa.js`))) {
  console.log(`SKIP check-research-gallery-embed: no built gallery at public/${TREE_NAME}/doxa-maps-spa/`)
  process.exit(2)
}
let chromium
try { ({ chromium } = await import('./lib/playwright-guarded.mjs')) } catch {
  console.log('SKIP check-research-gallery-embed: playwright not installed'); process.exit(2)
}

let mode = 'js'
// NEIGHBOUR mode: the partner-page shape that exposes a badly-behaved guest. The gallery sits BELOW
// THE FOLD, under hostile inherited typography, on a page with its own #anchor and <title>.
const NEIGHBOUR_TITLE = 'Host research page'
const hostPage = () => {
  if (mode === 'neighbour') return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${NEIGHBOUR_TITLE}</title>
<style>body{margin:0;font:20px/3 Georgia,serif;letter-spacing:2px;color:#900} .fold{height:1400px}</style></head>
<body><div class=fold>host content above the fold</div><script src="${TREE}/doxa-maps-spa/doxa-maps-spa.js"></script><doxa-maps-spa${PROVIDER ? ` provider="${PROVIDER}"` : ''}></doxa-maps-spa><p>after</p></body></html>`
  const embed = mode === 'iframe'
    ? `<iframe src="${TREE}/doxa-maps-spa/doxa-maps-spa/index.html${PROVIDER ? '?provider=' + PROVIDER : ''}" style="width:100%;height:760px;border:0"></iframe>`
    : `<script src="${TREE}/doxa-maps-spa/doxa-maps-spa.js"></script><doxa-maps-spa${PROVIDER ? ` provider="${PROVIDER}"` : ''}></doxa-maps-spa>`
  return `<!doctype html><html><head><meta charset=utf-8><title>host</title>
<style>body{margin:0} header,footer{height:60px;background:#eee}</style></head>
<body><header id=hdr>HOST HEADER</header><main style="max-width:1200px;margin:0 auto">${embed}</main><footer>HOST FOOTER</footer></body></html>`
}
const tree = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(TREE_PORT), '--exit-with-parent'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, LIVE_CORS: LIVE_CORS ? '1' : '' } })
const host = createServer((_, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(hostPage()) }).listen(HOST_PORT, 'localhost')
const cleanup = () => { try { tree.kill() } catch {} try { host.close() } catch {} }
await new Promise(r => setTimeout(r, 800))

// ★ SERVER IDENTITY BY CONTENT, before a single measurement. A readiness check that only waits for
// HTTP 200 can adopt a STALE server: if the spawn above died (EADDRINUSE; its output is ignored) and
// something else answers on the port, every result would describe someone else's tree. So the served
// manifest must be byte-identical to THIS checkout's. A mismatch is NOT MEASURED (exit 75), never a
// pass or a fail — the same code the shared browser locks use for "busy, re-run later".
{
  const { readFileSync } = await import('node:fs')
  const disk = readFileSync(resolve(ROOT, `public/${TREE_NAME}/manifest.json`), 'utf8')
  let served = ''
  for (let i = 0; i < 20 && !served; i++) {
    try { const r = await fetch(`http://127.0.0.1:${TREE_PORT}/${TREE_NAME}/manifest.json`); if (r.ok) served = await r.text() } catch { /* not up yet */ }
    if (!served) await new Promise(r => setTimeout(r, 300))
  }
  if (served !== disk) {
    console.log(`NOT MEASURED: the server on :${TREE_PORT} is not serving this checkout's tree (manifest ${served ? 'differs' : 'unreachable'}). Re-run.`)
    cleanup(); process.exit(75)
  }
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })
const fails = []
const checked = {}   // mode -> tabs actually driven; printed, and 0 is a FAIL (see the summary)
try {
  for (mode of MODES) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    const own = new Set(), foreign = new Set(), mapbox = new Set()
    let current = '(page load)'
    const mapboxBy = {}   // tab id (the one open when the request fired) -> distinct mapbox URLs
    page.on('request', q => {
      if (!/^https:\/\/api\.mapbox\.com\//.test(q.url())) return
      const u = q.url().split('?')[0]
      mapbox.add(u); (mapboxBy[current] = mapboxBy[current] || new Set()).add(u)
    })
    const note = (url, why) => (url.startsWith(`http://127.0.0.1:${TREE_PORT}/`) ? own : foreign).add(why + ' ' + url.split('?')[0])
    page.on('response', r => { if (r.status() >= 400) note(r.url(), String(r.status())) })
    page.on('requestfailed', q => { const e = (q.failure() && q.failure().errorText) || ''; if (!/ABORTED/.test(e)) note(q.url(), e) })
    await page.goto(`http://localhost:${HOST_PORT}/`)
    const frame = mode === 'iframe' ? await (await page.waitForSelector('iframe')).contentFrame() : page.mainFrame()
    // A gallery that never boots is a named FAIL for this mode, never an uncaught crash: a crash
    // skips every later mode and the summary, so it reads as "the gate broke" rather than a finding.
    const booted = await frame.waitForFunction(() => { const s = document.querySelector('doxa-maps-spa'); return s && s._instance && s._instance.proxy.tabs.some(t => t.resolved) }, null, { timeout: 60000 }).then(() => true, () => false)
    if (!booted) { console.log(`FAIL [${mode}] the gallery did not boot within 60s`); fails.push(`[${mode}] the gallery did not boot within 60s`); await page.close(); continue }

    if (mode === 'js') {
      const g = await page.evaluate(() => {
        const s = document.querySelector('doxa-maps-spa'), v = s.shadowRoot.querySelector('.vtl')
        const a = s.getBoundingClientRect(), b = v.getBoundingClientRect()
        return { host: [a.top, a.left, a.width, a.height].map(Math.round), vtl: [b.top, b.left, b.width, b.height].map(Math.round) }
      })
      const inside = g.vtl[0] >= g.host[0] - 1 && g.vtl[1] >= g.host[1] - 1 && g.vtl[2] <= g.host[2] + 1 && g.vtl[3] <= g.host[3] + 1 && g.host[3] >= 400
      console.log(`${inside ? 'PASS' : 'FAIL'} [js] layout inside the host box — host ${g.host} layout ${g.vtl}`)
      if (!inside) fails.push(`[js] layout escaped the <doxa-maps-spa> box (host ${g.host}, layout ${g.vtl})`)
    }

    const tabs = await frame.evaluate(() => document.querySelector('doxa-maps-spa')._instance.proxy.tabs.map(t => ({ id: t.id, discovered: !!t.discovered })))
    for (const { id, discovered } of tabs) {
      if (ONLY && !ONLY.includes(id)) continue
      current = id
      await frame.evaluate(id => document.querySelector('doxa-maps-spa')._instance.proxy.onSelect(id), id)
      let v
      for (let k = 0; k < 50; k++) {
        await page.waitForTimeout(400)
        v = await frame.evaluate(id => {
          const vm = document.querySelector('doxa-maps-spa')._instance.proxy
          const i = vm.tabs.findIndex(x => x.id === id), t = vm.tabs[i]
          const el = vm._slots && vm._slots[i] && vm._slots[i].firstElementChild
          let canvas = 0
          const walk = r => { for (const n of r.querySelectorAll('*')) { if (n.tagName === 'CANVAS') canvas++; if (n.shadowRoot) walk(n.shadowRoot) } }
          if (el) { walk(el); if (el.shadowRoot) walk(el.shadowRoot) }
          return { state: t.state, error: t.error, canvas }
        }, id)
        if (v.state === 'error' || (v.state === 'ready' && (v.canvas || discovered && k > 5))) break
      }
      const needCanvas = !discovered
      const ok = v.state === 'ready' && (!needCanvas || v.canvas > 0)
      const why = v.state !== 'ready' ? `state ${v.state}${v.error ? ' — ' + v.error : ''}` : (needCanvas && !v.canvas ? 'mounted but painted no map canvas' : '')
      checked[mode] = (checked[mode] || 0) + 1
      console.log(`${ok ? 'PASS' : 'FAIL'} [${mode}] ${id}${why ? ' — ' + why : ''}`)
      if (!ok) fails.push(`[${mode}] ${id}: ${why}`)
    }
    for (const f of own) { console.log(`FAIL [${mode}] tree request failed: ${f}`); fails.push(`[${mode}] ${f}`) }
    if (PROVIDER === 'maplibre') {
      for (const u of [...mapbox]) if (MAPBOX_KNOWN[u]) { console.log(`KNOWN [${mode}] ${u} — owner: ${MAPBOX_KNOWN[u]}`); mapbox.delete(u); for (const k in mapboxBy) { mapboxBy[k].delete(u); if (!mapboxBy[k].size) delete mapboxBy[k] } }
      const ok = mapbox.size === 0
      console.log(`${ok ? 'PASS' : 'FAIL'} [${mode}] provider=maplibre made ${mapbox.size} request(s) to api.mapbox.com`)
      if (!ok) {
        for (const [tab, urls] of Object.entries(mapboxBy)) {
          console.log(`    while ${tab} was open: ${urls.size} — ${[...urls].slice(0, 3).join(' , ')}`)
          fails.push(`[${mode}] provider=maplibre: ${tab} hit api.mapbox.com (${urls.size} distinct URL(s))`)
        }
      }
    }
    for (const f of foreign) console.log(`note [${mode}] third-party request failed (not gated): ${f}`)
    await page.close()
  }

  // ── GOOD-NEIGHBOUR PHASE (script embed only: an iframe has its own document, title and URL) ──
  // A guest on a partner page must leave the page as it found it. Four rules, each measured after the
  // gallery loads and again after every tab opens, at PHONE width (where Simple Research is the
  // default tab, and where a scroll jump on load was measured, 2026-09-25):
  //   1. the host page does not SCROLL (scrollIntoView on a nested element scrolls every ancestor,
  //      including the partner's page — a visitor is yanked down to the embed with no action);
  //   2. the host URL (path, query, #anchor) is unchanged;  3. document.title is unchanged;
  //   4. the host's inherited typography does not reach the gallery root.
  if (!argOf('--mode', '') && !ONLY) {
    mode = 'neighbour'
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
    const START = `http://localhost:${HOST_PORT}/?page=research#top`
    await page.goto(START)
    const booted = await page.waitForFunction(() => { const s = document.querySelector('doxa-maps-spa'); return s && s._instance && s._instance.proxy.tabs.some(t => t.resolved) }, null, { timeout: 60000 }).then(() => true, () => false)
    if (!booted) { fails.push('[neighbour] the gallery did not boot within 60s'); console.log('FAIL [neighbour] the gallery did not boot within 60s') }
    await page.waitForTimeout(5000)
    const look = () => page.evaluate(() => ({ y: Math.round(scrollY), href: location.href, title: document.title, active: document.querySelector('doxa-maps-spa')._instance.proxy.activeKey }))
    const typo = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('doxa-maps-spa').shadowRoot.querySelector('.vtl')); return { size: c.fontSize, ls: c.letterSpacing, lh: c.lineHeight } })
    const typoOk = typo.size === '16px' && typo.ls === 'normal' && typo.lh === 'normal'
    console.log(`${typoOk ? 'PASS' : 'FAIL'} [neighbour] host typography stops at the box — gallery root ${JSON.stringify(typo)}`)
    if (!typoOk) fails.push(`[neighbour] host typography leaked into the gallery ${JSON.stringify(typo)}`)
    const judge = (at, v) => {
      const bad = []
      if (v.y !== 0) bad.push(['scroll', `host page scrolled to y=${v.y}`])
      if (v.href !== START) bad.push(['url', `host URL became ${v.href.replace(/^https?:\/\/[^/]+/, '')}`])
      if (v.title !== NEIGHBOUR_TITLE) bad.push(['title', `host title became "${v.title}"`])
      for (const [kind, why] of bad) {
        const known = NEIGHBOUR_KNOWN[`${at}:${kind}`]
        if (known) console.log(`KNOWN [neighbour] ${at}: ${why} — owner: ${known}`)
        else { console.log(`FAIL [neighbour] ${at}: ${why}`); fails.push(`[neighbour] ${at}: ${why}`) }
      }
      if (!bad.length) console.log(`PASS [neighbour] ${at} leaves the host page alone`)
      return bad.length
    }
    const first = await look()
    judge(first.active, first)
    const ids = await page.evaluate(() => document.querySelector('doxa-maps-spa')._instance.proxy.tabs.map(t => t.id))
    for (const id of ids) {
      // Reset the host between tabs, so each tab is judged on what IT did, not on a predecessor's.
      await page.evaluate(({ u, t }) => { scrollTo(0, 0); history.replaceState(null, '', u); document.title = t }, { u: START, t: NEIGHBOUR_TITLE })
      await page.evaluate(id => document.querySelector('doxa-maps-spa')._instance.proxy.onSelect(id), id)
      await page.waitForTimeout(4000)
      judge(id, await look())
    }
    checked.neighbour = ids.length
    await page.close()

    // ── LINKED PHASE — matrix cell D for the composites: "a filter in one part updates the other",
    // driven INSIDE a gallery tab (the composites' own leaf pages are covered by verify:interop; this
    // proves the link survives being nested one level deeper, in the gallery's document). Each check
    // clicks the composite's REAL control and polls an observable in the OTHER part. Playwright CSS
    // pierces open shadow roots, so one locator reaches through the gallery and the composite.
    // Mechanics (found 2026-09-25, file:line in each owner's plugin):
    //   Big Picture       dashboard facet → `dashboard-filter` emit → grid props; the grid's count
    //                     line (.repel) is ABSENT until a filter applies, then reads "Showing N".
    //   Simple Research   the two halves are INDEPENDENT BY DESIGN (research-map-plus-grid.vue:49-56),
    //                     so D asserts each half narrows on its own control — the grid's search.
    //   Regions           list `region-selected` → window `doxa-regions-dashboard:select` → the
    //                     dashboard's h1.rd-title becomes the region.
    //   UPG-100           "Show on map" must bring the map; selecting the ZONE on it is a routed gap.
    mode = 'js'
    const lp = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await lp.goto(`http://localhost:${HOST_PORT}/`)
    const lbooted = await lp.waitForFunction(() => { const s = document.querySelector('doxa-maps-spa'); return s && s._instance && s._instance.proxy.tabs.some(t => t.resolved) }, null, { timeout: 60000 }).then(() => true, () => false)
    const pane = () => lp.locator('doxa-maps-spa section.dms-pane:not([hidden])')
    const open = async (id) => {
      await lp.evaluate(id => document.querySelector('doxa-maps-spa')._instance.proxy.onSelect(id), id)
      await lp.waitForFunction(id => { const vm = document.querySelector('doxa-maps-spa')._instance.proxy; const t = vm.tabs.find(x => x.id === id); return t && t.state === 'ready' }, id, { timeout: 60000 })
      await lp.waitForTimeout(6000)   // let the composite fetch + paint its data before touching it
    }
    const poll = async (fn, ms = 25000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn().catch(() => null); if (v && v.ok) return v; await lp.waitForTimeout(700) } return v || { ok: false, why: 'no observation' } }
    const LINKS = {
      'dashboard-plus-grid': async () => {
        const count = pane().locator('.repel').filter({ hasText: /Showing/ })
        const before = await count.count()
        const facet = pane().locator('[data-facet="wagf_region"][data-value]:not(.dash-only)').first()
        const val = await facet.getAttribute('data-value', { timeout: 20000 })
        // The SUBJECT carries its own expected answer: the facet row prints how many groups it holds
        // (e.g. "Asia 1,309"). Asserting the grid shows EXACTLY that — not merely "Showing <digits>" —
        // fails on "Showing 0" (a subject with no data, or a broken link) AND on an unfiltered grid.
        const rowNums = ((await facet.innerText()).match(/\d[\d,]*/g) || []).map(x => Number(x.replace(/,/g, '')))
        const expect = rowNums.length ? rowNums[rowNums.length - 1] : 0
        await facet.click()
        return poll(async () => { const n = await count.count(); const txt = n ? await count.first().innerText() : ''; const got = Number(((txt.match(/Showing\s+([\d,]+)/) || [])[1] || '0').replace(/,/g, '')); return { ok: before === 0 && expect > 0 && got === expect, why: `facet wagf_region=${val} (row says ${expect}) → grid count line ${n ? '"' + txt.trim().slice(0, 40) + '"' : 'still absent'}` } })
      },
      'research-map-plus-grid': async () => {
        const total = pane().locator('.repel').first()
        const num = async () => Number(((await total.innerText({ timeout: 20000 })).match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''))
        const before = await num()
        await pane().locator('.pgg-search input').first().fill('Kurd')
        return poll(async () => { const after = await num(); return { ok: before > 0 && after > 0 && after < before, why: `grid search "Kurd": ${before} → ${after}` } })
      },
      'regions-dashboard': async () => {
        const btn = pane().locator('button.region-card__link').first()
        const name = (await btn.innerText({ timeout: 20000 })).trim()
        const title = pane().locator('h1.rd-title').first()
        const before = (await title.innerText({ timeout: 20000 }).catch(() => '')).trim()
        await btn.click()
        return poll(async () => { const t = (await title.innerText()).trim(); return { ok: t !== before && t.includes(name), why: `list "${name}" → dashboard title "${before}" → "${t}"` } })
      },
      'upg-100': async () => {
        const tape = pane().locator('.card[data-list-id] button.tape.tape-h').first()
        await tape.click({ timeout: 20000 })
        return poll(async () => { const on = pane().locator('.viewsel button[aria-pressed="true"]'); const txt = (await on.first().innerText()).trim(); return { ok: /map/i.test(txt) || /карт|mapa|carte|地图|خريطة|मानचित्र|karte|mappa|hartă/i.test(txt), why: `"Show on map" → active view "${txt}"` } })
      }
    }
    if (!lbooted) fails.push('[linked] the gallery did not boot within 60s')
    for (const [id, run] of Object.entries(lbooted ? LINKS : {})) {
      let r
      try { await open(id); r = await run() } catch (e) { r = { ok: false, why: 'threw: ' + String(e.message || e).split('\n')[0].slice(0, 160) } }
      console.log(`${r.ok ? 'PASS' : 'FAIL'} [linked] ${id}: ${r.why}`)
      if (!r.ok) fails.push(`[linked] ${id}: ${r.why}`)
    }
    for (const [k, owner] of Object.entries(LINKED_KNOWN)) console.log(`KNOWN [linked] ${k} — owner: ${owner}`)
    checked.linked = Object.keys(LINKS).length
    await lp.close()
  }
} finally { await browser.close(); cleanup() }

// ★ A MODE THAT RAN NOTHING HAS NOT PASSED. A flag lost on the way in (package.json once ended
// this entry in an inline # comment, so an appended --mode landed inside the comment) must not
// read as "both modes green": each requested mode has to have driven at least one tab.
for (const m of MODES) if (!checked[m]) fails.push(`[${m}] checked 0 tabs — this mode did not run`)
const tally = [...MODES, ...(checked.neighbour ? ['neighbour'] : []), ...(checked.linked ? ['linked'] : [])].map(m => `${m} ${checked[m] || 0} tab(s)`).join(', ')
if (fails.length) {
  console.log(`\nchecked: ${tally}`)
  console.log(`\ncheck-research-gallery-embed: FAIL (${fails.length})`); for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log(`\ncheck-research-gallery-embed: PASS — the Research Gallery embeds on a foreign origin (${tally})`)
