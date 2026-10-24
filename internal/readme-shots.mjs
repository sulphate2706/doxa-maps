#!/usr/bin/env node
/**
 * readme-shots.mjs — capture the README screenshot family from the BUILT tree.
 *
 * Serves public/ on a local port (same static server shape as smoke.mjs), then
 * drives headless chromium to screenshot each capability + deploy surface.
 * A live Mapbox token is fetched from https://doxa.life/api/maps/token and passed
 * as ?tk= so maps fully paint (network is up). Token-free surfaces (vision-card,
 * template) render regardless.
 *
 * Output: documentation/readme-images/*.png
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { createServer } from 'node:http'
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME, TREE_NAME_RE } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', 'public')
const OUT = resolve(HERE, '..', 'documentation', 'readme-images')
await mkdir(OUT, { recursive: true })

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.css':'text/css', '.webp':'image/webp', '.png':'image/png',
  '.svg':'image/svg+xml', '.geojson':'application/json', '.csv':'text/csv', '.woff2':'font/woff2' }

// In-memory pages (e.g. the iframe host demo). Served without touching public/, so no agentic
// scratch lands in the studio tree and nothing is lost to the next build's clean.
const virtualPages = new Map()

const server = createServer(async (req, res) => {
  try {
    const reqPath = decodeURIComponent(req.url.split('?')[0])
    if (virtualPages.has(reqPath)) {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(virtualPages.get(reqPath))
    }
    let p = join(ROOT, reqPath)
    if ((await stat(p)).isDirectory()) p = join(p, 'index.html')
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' })
    res.end(await readFile(p))
  } catch { res.writeHead(404).end('not found') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

// ★ SHOOT WITH THE TOKEN THE BUNDLES ACTUALLY SHIP, not one fetched over the network.
//
// This used to fetch https://doxa.life/api/maps/token unconditionally. That token belongs to the
// Mapbox account that is URL-restricted to doxa.life, which is why the shot harness had
// to spoof a Referer to make tiles load at all. Meanwhile the BUILT BUNDLES carry a different
// token — baked in at build time from vite.doxa-maps-build-config.json — which is not
// URL-restricted. Measured 2026-09-23 with no Referer at all: mapbox-streets-v8,
// country-boundaries-v1 and bathymetry-v2 all return 200 on the baked token and 403 on the fetched
// one. So the harness was doing extra work to use the weaker of the two.
//
// Two reasons to prefer the baked token beyond it simply working. A README image is evidence about
// the SHIPPED artifact, so it should render with the credential the artifact ships with; rendering
// with a different token means the picture no longer proves what a reader downloads. And reading
// the build config is local and deterministic — the network path degrades silently, setting TK to
// '' when doxa.life is slow, after which every shot is taken token-limited and still written to
// disk. The fetch is kept only as a fallback for a tree whose build config has no baked token.
// ★ TOKENLESS BY DEFAULT (2026-09-26). The engine default is now 'auto': no token means
// MapLibre, which is what every keyless partner embed shows. So the README pictures are taken with
// NO token, showing the look a reader gets by default. SHOTS_WITH_TOKEN=1 restores the Mapbox shots
// (the token ladder below).
const WITH_TOKEN = process.env.SHOTS_WITH_TOKEN === '1'
let TK = ''
let TK_SRC = ''
if (WITH_TOKEN) try {
  const cfg = JSON.parse(await readFile(new URL('../vite.doxa-maps-build-config.json', import.meta.url), 'utf8'))
  if (typeof cfg.token === 'string' && cfg.token.startsWith('pk.')) { TK = cfg.token; TK_SRC = 'build config (the token the bundles ship)' }
} catch {}
if (WITH_TOKEN && !TK) {
  try {
    const r = await fetch('https://doxa.life/api/maps/token', { signal: AbortSignal.timeout(8000) })
    TK = r.ok ? ((await r.json()).token || '') : ''
    if (TK) TK_SRC = 'doxa.life/api/maps/token (fallback — needs the Referer header below)'
  } catch {}
}
console.log(TK ? `token: ${TK.length} chars from ${TK_SRC}` : (WITH_TOKEN ? 'token: NONE — maps token-limited' : 'token: none, by design (engine auto -> MapLibre); SHOTS_WITH_TOKEN=1 for Mapbox'))

// ★ SwiftShader — WITHOUT THESE ARGS EVERY MAP SHOT IS TAKEN WITH NO GL CONTEXT.
// This script was written under the belief "this VPS has no WebGL", which was a LAUNCH-FLAG
// property, not a machine property. A bare chromium.launch() yields no WebGL, so mapbox-gl
// never paints and the README documents blank maps. Same flags as internal/verify-map-paint.mjs.
const browser = await chromium.launch({ args: [
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox',
] })

// ★ A SHOT THAT FAILS MUST NOT SILENTLY PRODUCE A README IMAGE. Collected and asserted at the end.
const failures = []
// documentation/readme-images/shot-bundles.json: shot name -> the sha256 of the bundle it was shot
// from. Merged, so an ONLY= run updates just the shots it took.
const SHOT_BUNDLES = resolve(HERE, '..', 'documentation', 'readme-images', 'shot-bundles.json')
const shotBundles = existsSync(SHOT_BUNDLES) ? JSON.parse(readFileSync(SHOT_BUNDLES, 'utf8')) : {}
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null

// mapbox canvas selector to wait on (leaf pages mount a custom element with a canvas)
const CANVAS = 'canvas'

// Readiness floor. Declared BEFORE shot() because it is a default parameter value; leaving it
// below the function relied on shot() not being CALLED until later, which is true today but is a
// trap for anyone who adds a call higher up.
// A login wall renders ~67 elements; a real plugin leaf renders hundreds. Per-shot overrides via
// `minElements` (cap-1 is legitimately 34) and `countFrames` (iframe hosts) handle the outliers.
const MIN_ELEMENTS = Number(process.env.MIN_ELEMENTS || 40)

// path is relative to the tree root (public/). tk appended unless tokenFree.
async function shot(name, path, {
  vp = { width: 1440, height: 900 }, wait = 6000, tokenFree = false,
  waitFor = null, before = null, fullPage = false, clip = null, dsf = 2,
  minElements = MIN_ELEMENTS, countFrames = false,
  // Opt in to the doxa.life Referer (see the note in the body). Defaults ON because most shots are
  // MAP LEAVES, which fetch Mapbox tiles directly and render blank without it.
  //
  // ★ THE RULE, so the next author does not rediscover it one shot at a time: pass FALSE for any
  // surface that nests content in an <iframe>. The header is context-wide and breaks same-origin
  // frames, and such a surface needs no tiles of its own — each nested leaf is its own document
  // and fetches its own. Today that is the iframe-host demo and all three cap-5 shell shots
  // (every cap-5 tab is an iframe). I set it per-instance for deploy1 first, saw cap5-doxa-maps-spa
  // collapse 1135KB -> 91KB and deploy2-mobile-spa 902KB -> 26KB on the next run, and only then
  // generalised: the predicate is "does this surface use iframes", not "did this shot fail".
  mapboxReferer = true,
} = {}) {
  // ONLY=<name>[,<name>] retakes just those shots, leaving every other image untouched.
  if (ONLY && !ONLY.includes(name)) return
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dsf })
  // ★ SEND THE REFERER THE TOKEN IS SCOPED TO, or every map ships a BLANK BASEMAP.
  //
  // MEASURED 2026-09-22, both directions: a Mapbox tile request with NO Referer returns 403, the
  // same request with `Referer: https://doxa.life/` returns 200. The STYLE DOCUMENT returns 200
  // either way — which is exactly why this hid for four ticks. The map genuinely BOOTS: controls
  // paint, the legend fills with real numbers, the data layer draws every dot. Only the basemap is
  // missing, so the picture is data floating on an empty navy void with no coastlines or borders,
  // and every gate passes it (element counts, freshness and distinctness are all satisfied).
  //
  // This shot harness serves from 127.0.0.1 and therefore sent no Referer at all. Setting it does
  // NOT circumvent the restriction — the restriction exists so third-party sites cannot burn the
  // project's quota, and these ARE doxa.life's own documentation images, generated by its own repo
  // from its own token. The header makes the request honest about who it is for; without it the
  // legitimate owner was the one being blocked.
  //
  // Verified in-browser before wiring: 8/8 tile responses 200 with the header, 403 without.
  // This unblocks BUG-README-SCREENSHOTS-SHOW-BLANK-BASEMAPS and
  // BUG-FOUR-README-PROOF-IMAGES-SHIP-A-BLANK-BASEMAP without needing a change to the
  // token's allow-list. That change is still worth making for rendering on the LIVE test host, which
  // this does not address — a browser sets its own Referer and cannot be overridden this way.
  //
  // ★ WHY A CONTEXT-WIDE HEADER AND NOT ROUTE INTERCEPTION, measured both ways 2026-09-22:
  //     ctx.setExtraHTTPHeaders({Referer})           -> tiles 200   ✔
  //     ctx.route(/api.mapbox.com/, continue+headers) -> tiles 403  �’
  //   Chromium does not honour a `referer` supplied through route.continue({headers}), so the
  //   "properly scoped" version silently does nothing. Scoping had to be moved UP a level instead.
  //
  // ★ AND WHY IT IS OPT-IN PER SHOT. The context-wide header also stamps the LOCAL 127.0.0.1
  //   requests, which breaks a same-origin iframe: reproduced in isolation at 180 elements without
  //   it versus 8 with it, and the deploy1-iframe shot regressed 187 -> 15 in a full run. So the
  //   two needs genuinely conflict, and the honest resolution is per-shot: MAP shots opt in (they
  //   need upstream tiles and have no iframe), the iframe-host shot opts out (it needs its local
  //   frame and loads no tiles of its own).
  if (mapboxReferer) await ctx.setExtraHTTPHeaders({ Referer: 'https://doxa.life/' })
  // ★ WAIT ON THE MAP ITSELF, NOT A CLOCK (2026-09-26). Every map a page (or any frame in it) creates is
  // recorded, so the capture can wait until each visible one has its style and tiles loaded AND has
  // drawn features on OUR layers (sources that are not the basemap's). A fixed 7 s wait shot the
  // upg-100-list counter over a bare basemap: that leaf paints 9.5-16.5 s in (3 cold loads at
  // fc2fa2e4). The same predicate the browser check measures with.
  await ctx.addInitScript(() => {
    window.__SHOT_MAPS = []
    const patch = (x) => {
      if (!x || !x.Map || x.Map.__shotPatched) return
      x.Map.__shotPatched = true
      const ss = x.Map.prototype.setStyle
      x.Map.prototype.setStyle = function (...a) { if (!window.__SHOT_MAPS.includes(this)) window.__SHOT_MAPS.push(this); return ss.apply(this, a) }
    }
    for (const g of ['maplibregl', 'mapboxgl']) {
      let v = window[g]
      try { patch(v) } catch (_) {}
      try { Object.defineProperty(window, g, { configurable: true, get: () => v, set: (x) => { v = x; try { patch(x) } catch (_) {} } }) } catch (_) {}
    }
  })
  const page = await ctx.newPage()
  // ★ WAIT FOR THE MAP TO FINISH LOADING, NOT JUST FOR THE PAGE TO EXIST. The element-count guard
  // below proves the UI rendered; it says nothing about map tiles and data, which arrive later. Shots
  // taken on a fixed timer showed the Big Picture globe as a bare white ball and the UPG-100 map
  // without its resources. So every request is tracked, and the capture waits until nothing has
  // been in flight for QUIET_MS (capped at QUIET_MAX_MS, and reported if the cap is hit).
  let inflight = 0, lastNet = Date.now()
  const track = (d) => (req) => { if (/^(websocket|eventsource|media)$/.test(req.resourceType())) return; inflight += d; lastNet = Date.now() }
  page.on('request', track(1)); page.on('requestfinished', track(-1)); page.on('requestfailed', track(-1))
  const url = (/^https?:/.test(path) ? path : BASE + path) + (tokenFree || !TK ? '' : (path.includes('?') ? '&' : '?') + 'tk=' + encodeURIComponent(TK))
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 })
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 })
    if (before) await before(page)
    // `wait` is now a FLOOR for the UI to settle (at most 3 s); the map readiness below does the rest.
    // A surface with no map (a card, a grid) waits its full `wait`, since there is nothing to ask.
    await page.waitForTimeout(Math.min(wait, 3000))
    const mapState = (frame) => frame.evaluate(() => (window.__SHOT_MAPS || []).map((m) => {
      try {
        const c = m.getContainer().getBoundingClientRect()
        if (c.width < 2 || c.height < 2) return { hidden: true }
        const st = m.getStyle() || {}
        // OUR data is GeoJSON; the basemap's sources are vector tiles. Type, not name: a source id can say anything.
        const own = Object.entries(st.sources || {}).filter(([, src]) => src && src.type === 'geojson').map(([k]) => k)
        const ids = (st.layers || []).filter((l) => own.includes(l.source) && (l.layout?.visibility ?? 'visible') !== 'none').map((l) => l.id)
        let drawn = 0
        try { drawn = ids.length ? m.queryRenderedFeatures({ layers: ids }).length : 0 } catch (_) {}
        return { style: m.isStyleLoaded(), tiles: m.areTilesLoaded(), ownLayers: ids.length, drawn }
      } catch (e) { return { err: String(e).slice(0, 80) } }
    })).catch(() => [])
    const MAP_CAP_MS = 60000, tMap = Date.now()
    let maps = []
    for (;;) {
      maps = []
      for (const f of page.frames()) maps.push(...(await mapState(f)))
      const live = maps.filter((m) => !m.hidden && !m.err)
      if (!live.length) { if (Date.now() - tMap < 4000) { await page.waitForTimeout(500); continue } await page.waitForTimeout(Math.max(0, wait - 3000)); break }
      if (live.every((m) => m.style && m.tiles && (m.ownLayers === 0 || m.drawn > 0))) break
      if (Date.now() - tMap > MAP_CAP_MS) { console.log(`  WARN ${name}: a map was not ready in ${MAP_CAP_MS / 1000}s ${JSON.stringify(live)} — check the image`); break }
      await page.waitForTimeout(500)
    }
    const QUIET_MS = 4000, QUIET_MAX_MS = 60000, t0 = Date.now()
    while (!(inflight <= 0 && Date.now() - lastNet >= QUIET_MS)) {
      if (Date.now() - t0 > QUIET_MAX_MS) { console.log(`  WARN ${name}: network never went quiet in ${QUIET_MAX_MS / 1000}s (${inflight} in flight) — check the image`); break }
      await page.waitForTimeout(250)
    }
    await page.waitForTimeout(1500)   // let the last tiles paint

    // ★ READINESS GUARD — a screenshot of a blank page is still a valid PNG, so the file
    // existing proves nothing. Walk shadow roots (a composite's content is NOT in the light
    // DOM; a single-level querySelectorAll lies about every cap-4/5 surface) and require a
    // real element count before anything is written to documentation/.
    const countIn = (frame) => frame.evaluate(() => {
      const deep = (root, out = []) => {
        for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) deep(el.shadowRoot, out) }
        return out
      }
      return deep(document).length
    })
    // ★ deep() CANNOT CROSS AN IFRAME. An iframe is a separate document, not a shadow root, so a
    // host page whose whole point is the embedded map counts only its own chrome (~12 elements).
    // For those shots, count the frames too — otherwise the guard rejects a working page.
    let ready = await countIn(page)
    if (countFrames) for (const f of page.frames()) { if (f !== page.mainFrame()) ready += await countIn(f).catch(() => 0) }
    if (ready < minElements) throw new Error(`rendered only ${ready} elements (<${minElements}) — surface did not load`)

    const opts = { path: join(OUT, name + '.png') }
    if (fullPage) opts.fullPage = true
    if (clip) opts.clip = clip
    await page.screenshot(opts)
    console.log('  OK', name + '.png', `<- ${path}  (${ready} elements)`)
    // Record WHICH BUNDLE this picture is of, by content hash, so check:shots can tell a current
    // picture from a stale one without trusting any clock (see SHOT_BUNDLES below).
    const lm = path.match(new RegExp(`^/${TREE_NAME_RE}/([^/]+)/`))
    const bundleJs = lm && join(ROOT, TREE_NAME, lm[1], `${lm[1]}.js`)
    if (bundleJs && existsSync(bundleJs)) {
      shotBundles[name] = { bundle: lm[1], sha256: createHash('sha256').update(readFileSync(bundleJs)).digest('hex') }
    }
  } catch (e) {
    console.log('  ERR', name, e.message.split('\n')[0])
    failures.push(name + ': ' + e.message.split('\n')[0])
  } finally { await ctx.close() }
}

// ---- CAP1: single element (token-free vision card) ----
// minElements lowered DELIBERATELY: a single vision card is legitimately the smallest surface in
// the family. MEASURED 2026-09-20: 34 elements, shadow root mounted, 1440x900, 0 console errors --
// small, not broken. (document.body.innerText is EMPTY here and that is also fine: innerText does
// not reach into shadow DOM, which is why the element COUNT is the readiness signal, not text.)
// ★ CORRECTED 2026-09-21 — this slot shot doxa-vision-card, which is NOT a cap-1 single element.
// It ships doxa-vision-card.instances.json with TWO instances (default, frontier), so discover.mjs
// types it PARAMETERIZED and manifest.json agrees: type "parameterized" = cap-2. The README
// captioned it "Capability 1 — a single-element plugin (doxa-vision-card)".
//
// ★ THE IDENTICAL ERROR WAS ALREADY FOUND AND FIXED IN verify-5-capabilities.mjs, whose own comment
// records it: that gate "had been reporting '5/5 capability levels' while sampling cap-2 TWICE and
// cap-1 NEVER", and it switched to all-people-groups. The README never got the same correction — a
// fix landed in ONE artifact while the OTHER artifact encoding the same fact kept the bug. That is
// this repo's recurring shape: two copies of one claim with nothing forcing agreement.
//
// all-people-groups is a genuine cap-1: ONE .vue, NO instances.json, manifest type "single".
// It DOES own a map, so it needs a token and longer to settle than the token-free vision card did.
await shot('cap1-single-element', `/${TREE_NAME}/all-people-groups/all-people-groups/index.html`,
  { wait: 8000, minElements: 25 })

// ---- CAP2: prop-table -> 3 shots from ONE root.vue (prayer/engagement/adoption) ----
await shot('cap2-prayer', `/${TREE_NAME}/doxa-simple-map/doxa-simple-map/prayer/index.html`, { waitFor: CANVAS, wait: 8000 })
await shot('cap2-engagement', `/${TREE_NAME}/doxa-simple-map/doxa-simple-map/engagement/index.html`, { waitFor: CANVAS, wait: 8000 })
await shot('cap2-adoption', `/${TREE_NAME}/doxa-simple-map/doxa-simple-map/adoption/index.html`, { waitFor: CANVAS, wait: 8000 })

// ---- CAP3: monolithic research map ----
await shot('cap3-monolithic-research', `/${TREE_NAME}/doxa-research-map/research-map/index.html`, { waitFor: CANVAS, wait: 9000 })

// ---- CAP4: nested-element SPA. The bundle ships THREE profiles, one shot each:
//      upg-100-mfe (the cap-4 composite) · upg-100-list (the list) · poster-wall.
//      There are no "list pages" — see the note below the second shot. ----
await shot('cap4-upg100-mfe', `/${TREE_NAME}/my-upg-100-list/upg-100-mfe/index.html`, { wait: 8000 })
// wait 20000: this leaf PAINTS 9.5-16.5 s after load under swiftshader (3 cold loads at fc2fa2e4,
// judged by rendered features on its own layers), and its "195 polys · 27/27 zones · 2107 pins" counter
// appears BEFORE the paint, so a 7 s wait shot the counter over a bare basemap. The shot now waits on the
// map itself (style + tiles + features drawn on our layers, see shot()); `wait` is only a fallback.
await shot('cap4-upg100-list', `/${TREE_NAME}/my-upg-100-list/upg-100-list/index.html`, { wait: 20000 })

// ---- CAP4's THIRD profile: the poster wall ----
// ★ REPLACED 'cap4-upg100-list-page2' 2026-09-21. That shot loaded the SAME URL as page 1 and
// tried to reach a "page 2" by scrolling to the bottom and clicking a Next control. NEITHER
// EXISTS: my-upg-100-list has NO pagination (no Next button, no pages), and window.scrollTo is a
// no-op because the map fills the viewport. Every attempt sat inside try/catch, so the failure
// was SILENT and the shot "succeeded" — producing a second copy of page 1. The two PNGs differed
// by 0.16% (render noise), so they were not byte-identical and no duplicate check caught them.
// The README then displayed the same image twice under "List — page 1" and "List — page 2".
//
// ★ THE SLOT WAS CHASING UI THAT DOES NOT EXIST while a REAL profile went unshot: this bundle
// ships THREE manifest-listed profiles (upg-100-mfe, upg-100-list, poster-wall) and poster-wall
// had no screenshot anywhere. Shoot the real third thing rather than fake a fourth.
await shot('cap4-upg100-poster-wall', `/${TREE_NAME}/my-upg-100-list/poster-wall/index.html`, { wait: 8000 })

// ---- CAP5: nested SPA — the doxa-maps-spa ELEMENT, not the gallery page ----
// ★ CORRECTED 2026-09-20. This shot previously pointed at /index.html, the AUTO-GENERATED
// GALLERY PAGE. That is a static preview page, NOT the capability-5 plugin — publishing it as
// the cap-5 evidence is mistake #1 in the /plugin-designer skill's do-not-repeat list ("a page
// is not a plugin"). The real cap-5 artifact is the doxa-maps-spa custom element, declared by
// doxa-maps-spa.meta.json {"type":"nested-mfe-spa"} and served from its own leaf page.
// mapboxReferer:false — a cap-5 shell nests EVERY tab in an iframe, so the context-wide Referer
// (see shot()) breaks its content exactly as it broke deploy1-iframe. The shell loads no Mapbox
// tiles of its own; each nested leaf is its own document and fetches its own.
await shot('cap5-doxa-maps-spa', `/${TREE_NAME}/doxa-maps-spa/doxa-maps-spa/index.html`,
  { wait: 10000, mapboxReferer: false })

// ---- CAP5 (the OTHER one): the plugin-studio ELEMENT — the DEVELOPER gallery ----
// ★ ADDED 2026-09-21. There are TWO cap-5 products and only ONE was ever shot. README.md drew the
// distinction correctly in prose — and even warned, one line above, that "Captioning a studio shot
// as the product SPA is a documented mistake (see /plugin-designer)" — then captioned its
// plugin-studio slot with cap5-doxa-maps-spa.png, the PRODUCT image. Both cap-5 figures showed the
// same app, and the studio had no screenshot anywhere in the repo.
//
// ★ THE FAILURE MODE IS NOT A TYPO — it is a MISSING ARTIFACT wearing a plausible one. A slot
// filled with the wrong real image looks exactly like a slot filled correctly; nothing 404s.
// The fix is to SHOOT THE MISSING THING, not to re-caption around the gap.
//
// plugin-studio is a real cap-5 element, not the static gallery page: plugin-studio.meta.json
// declares {"type":"nested-mfe-spa"}, the source calls defineCustomElement, and the built bundle
// carries customElements.define. Shot from its own leaf page for the same reason as above.
// ★ SELECT A ROW BEFORE CAPTURING (fixed 2026-09-22). This shot used to just load and wait, so it
// captured the studio's EMPTY STATE — a full rail beside a pane reading "Choose an element from the
// list." The README's flagship capability-5 image demonstrated nothing, and every shot gate passed
// it: freshness, distinctness and element counts are all satisfied by an empty pane. Found by
// READING the image, the same way the mobile shot's error card was found the day before.
//
// Clicks the first rail row (cap-5 → doxa-maps-spa), so the picture shows what the studio is FOR:
// a nested SPA rendering inside the shell that lists every element by capability. Fails soft — if
// the row is not found the shot still captures, and the readiness guard below still applies.
await shot('cap5-plugin-studio', `/${TREE_NAME}/plugin-studio/plugin-studio/index.html`, {
  // Same iframe-nesting reason as the other cap-5 shell above.
  mapboxReferer: false,
  wait: 12000,
  before: async (page) => {
    // The rail lives inside the element's shadow root, so a light-DOM selector finds nothing —
    // click through an evaluated deep walk instead (the same seen-Set walk the readiness guard uses).
    // The rail is an Explorer tree (f63d75e): its plugin rows are .st-row[role=treeitem], and a
    // .st-sec row is a section heading, not a plugin. The older .vtl-tab rail is kept as a
    // fallback. Without a tree row, the walk would reach the NESTED gallery's own .vtl-tab buttons
    // instead, and click a tab inside the plugin rather than a plugin in the rail.
    await page.evaluate(() => {
      const find = (test) => {
        const seen = new Set(); let hit = null
        ;(function w(n) {
          if (!n || seen.has(n) || hit) return
          seen.add(n)
          if (n.nodeType === 1 && test(n)) { hit = n; return }
          if (n.shadowRoot) w(n.shadowRoot)
          for (const c of (n.children || [])) w(c)
        })(document.body)
        return hit
      }
      const first = find((n) => n.matches('.st-row[role="treeitem"]:not(.st-sec)'))
        || find((n) => n.tagName === 'BUTTON' && /vtl-tab\b/.test((n.className || '').toString()))
      if (first) first.click()
    })
    await page.waitForTimeout(3000)   // let the selected element mount before the main wait
  },
})

// ---- DEPLOY1: iframe embed on a host page ----
// ★ FIXED 2026-09-20. This shot pointed at /__readme-iframe-host.html, a file the script's own
// comment said it would write and NEVER DID. The page 404'd, the old error path logged ERR and
// exited 0, so deploy1-iframe.png has been a screenshot of a 404 page since 2026-09-18.
// The host page is SERVED FROM MEMORY rather than written into public/: anything written there
// is agentic scratch in the studio tree and would be destroyed by the next build's clean.
const IFRAME_SRC = `/${TREE_NAME}/doxa-simple-map/doxa-simple-map/prayer/index.html`
    + '?tk=' + encodeURIComponent(TK)
virtualPages.set('/__readme-iframe-host.html', `<!doctype html>
<html><head><meta charset="utf-8"><title>Embedding a Doxa map</title>
<style>
  body { margin:0; font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:#f3f3f1; color:#3b463d; }
  .wrap { max-width:900px; margin:0 auto; padding:32px 24px; }
  h1 { font-size:26px; margin:0 0 6px; }
  p  { color:#6d766e; margin:0 0 20px; }
  .frame { border:1px solid #d1d4cd; border-radius:10px; overflow:hidden; background:#fff; }
  iframe { display:block; width:100%; height:520px; border:0; }
  code { background:#fff; border:1px solid #d1d4cd; border-radius:5px; padding:2px 6px; font-size:14px; }
</style></head>
<body><div class="wrap">
  <h1>Any site can embed a Doxa map</h1>
  <p>One <code>&lt;iframe&gt;</code> tag — no build step, no framework, no npm install.</p>
  <div class="frame"><iframe src="${IFRAME_SRC}" title="Prayer map embedded in a host page"></iframe></div>
</div></body></html>`)
// Viewport trimmed to the host page's actual content height (32px pad + heading/lede + a 520px
// frame + 32px pad). At 1440x900 the shot carried ~330px of dead background below the card.
// mapboxReferer:false — this is the ONE shot that must not carry it. The header is context-wide
// (route interception does not work for Referer; see the note in shot()), so it would stamp the
// local 127.0.0.1 requests too and the embedded frame stops loading: measured 187 elements -> 15
// in a full run, and 180 -> 8 reproduced in isolation. This surface needs its LOCAL frame, and it
// loads no Mapbox tiles of its own — the map inside the iframe is its own document.
await shot('deploy1-iframe', '/__readme-iframe-host.html',
  { vp: { width: 1000, height: 700 }, wait: 11000, countFrames: true, mapboxReferer: false })

// ---- THE 7 PRODUCTION MAPS: one shot each, for the README's opening gallery ----
// Each is the plugin's own standalone leaf page — the same element the Research Gallery nests.
// (UPG-100 List and Prayer Progress reuse cap4-upg100-mfe and cap2-prayer.)
await shot('prod-big-picture', `/${TREE_NAME}/dashboard-plus-grid/dashboard-plus-grid/index.html`, { wait: 10000, minElements: 300 })
await shot('prod-simple-research', `/${TREE_NAME}/research-map-plus-grid/research-map-plus-grid/index.html`, { wait: 10000, minElements: 200 })
await shot('prod-regions', `/${TREE_NAME}/regions-dashboard/regions-mfe/index.html`, { wait: 10000, minElements: 100 })
await shot('prod-cities-internet', `/${TREE_NAME}/cities-internet/connectivity-map/index.html`, { wait: 10000, minElements: 60 })
await shot('prod-gospel-resources', `/${TREE_NAME}/gospel-resources/resources-map/index.html`, { wait: 10000, minElements: 100 })

// ---- THE PRODUCTION MAPS ON A PHONE (390x844) — for the README's phone row ----
// Big Picture is desktop-only by ruling (on phones the Research Gallery disables it and Simple Research is
// the dashboard), so it has no phone shot. UPG-100's phone shot is deploy2-mobile-upg100.
await shot('prod-simple-research-phone', `/${TREE_NAME}/research-map-plus-grid/research-map-plus-grid/index.html`, { vp: { width: 390, height: 844 }, dsf: 2, wait: 10000, minElements: 60 })
await shot('prod-research-gallery-phone', `/${TREE_NAME}/doxa-maps-spa/doxa-maps-spa/index.html`, { vp: { width: 390, height: 844 }, dsf: 2, wait: 10000, minElements: 60 })
await shot('prod-regions-phone', `/${TREE_NAME}/regions-dashboard/regions-mfe/index.html`, { vp: { width: 390, height: 844 }, dsf: 2, wait: 10000, minElements: 60 })
await shot('prod-prayer-phone', `/${TREE_NAME}/doxa-simple-map/doxa-simple-map/prayer/index.html`, { vp: { width: 390, height: 844 }, dsf: 2, wait: 10000, minElements: 60 })
await shot('prod-cities-internet-phone', `/${TREE_NAME}/cities-internet/connectivity-map/index.html`, { vp: { width: 390, height: 844 }, dsf: 2, wait: 10000, minElements: 60 })
await shot('prod-gospel-resources-phone', `/${TREE_NAME}/gospel-resources/resources-map/index.html`, { vp: { width: 390, height: 844 }, dsf: 2, wait: 10000, minElements: 60 })

// ---- EXPERIMENTAL SHELF: the plugins the README pictures there ----
await shot('exp-wall-of-people-groups', `/${TREE_NAME}/wall-of-people-groups/wall-of-people-groups/index.html`, { wait: 12000, minElements: 40 })
await shot('exp-prayer-walk-planner', `/${TREE_NAME}/prayer-walk-planner/prayer-walk-planner/index.html`, { wait: 12000, minElements: 40 })

// ---- LANGUAGES: UPG-100 in Arabic (?lang=ar), right-to-left — the most completely translated map ----
await shot('lang-arabic-upg100', `/${TREE_NAME}/my-upg-100-list/upg-100-list/index.html?lang=ar`, { wait: 20000, minElements: 200 })   // same leaf, same paint time: see cap4-upg100-list

// ---- DEPLOY2: mobile — the UPG-100 list as the phone app ----
// The mobile example is UPG-100 (ruled 2026-09-24; Simple Research was retired as the example because
// it was never built for phones). Shot once its owner marked the phone layout ready at 88a566f:
// posters one per row, the legend a bottom sheet flush with the map, print options wrapping.
await shot('deploy2-mobile-upg100', `/${TREE_NAME}/my-upg-100-list/upg-100-mfe/index.html`,
  { vp: { width: 390, height: 844 }, wait: 10000, dsf: 3 })

// ---- DEPLOY3: JS embed — the Research Gallery on a real host site ----
// The whole cap-5 gallery JS-embedded on dx-life's research page (a <script src> plus one element,
// the snippet manifest.json ships). The host is a SEPARATE app, so this shot runs only when its dev
// server is up: DXLIFE_URL=http://127.0.0.1:<port> bun run shots. Without it the shot is skipped
// and the committed image stays as it is.
if (process.env.DXLIFE_URL) {
  // shot-floor: dynamic — the URL comes from DXLIFE_URL at run time, so the gates cannot parse it
  await shot('deploy3-js-embed-dxlife', process.env.DXLIFE_URL.replace(/\/$/, '') + '/research',
    { vp: { width: 1440, height: 1100 }, wait: 16000, tokenFree: true, minElements: 300 })
} else if (!ONLY || ONLY.includes('deploy3-js-embed-dxlife')) {
  console.log('  SKIP deploy3-js-embed-dxlife (set DXLIFE_URL to a running dx-life dev server)')
}

await browser.close()
server.close()
await writeFile(SHOT_BUNDLES, JSON.stringify(Object.fromEntries(Object.entries(shotBundles).sort()), null, 1) + '\n')

// ★ EXIT NON-ZERO ON ANY FAILED SHOT. Previously this printed DONE unconditionally, so a run
// where every map came back blank still reported success and the stale PNGs stayed in documentation/.
if (failures.length) {
  console.error(`\nREADME-SHOTS: FAIL — ${failures.length} shot(s) did not render:`)
  failures.forEach((f) => console.error('  ' + f))
  console.error('  documentation/readme-images/ may still hold STALE images for these surfaces.')
  process.exit(1)
}
console.log('DONE — shots in documentation/readme-images/')
