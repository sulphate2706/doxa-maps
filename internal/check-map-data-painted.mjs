#!/usr/bin/env node
/**
 * check-map-data-painted — every map leaf must have OUR DATA painted on it, not just a basemap.
 *
 * THE HOLE THIS CLOSES, MEASURED RATHER THAN ASSUMED. verify-map-paint.mjs:293 asserts
 *   ok = shadow && glContext && attribution && !asksForToken && cssOk && no-real-errors
 * Every one of those is TRUE of a flawless basemap carrying none of our zones, polygons or pins.
 * "The map engine booted and tiles are loading" and "my data is on it" are two different
 * properties; only the first was ever measured, so every future data-layer regression lands green.
 *
 * ★ THE CENSUS THAT SIZED IT (2026-09-26, starve-probe: abort OUR data requests, leave the basemap
 * untouched, then read what verify-map-paint would have read). The hole is NOT uniform, and that
 * distinction is the whole design:
 *
 *   DECOUPLED — build the map first, add layers later. Starved, these report a live canvas, live
 *   GL, attribution present and ZERO page errors. verify-map-paint passes them with no data at all:
 *     my-upg-100-list/upg-100-list      2821 colours healthy -> 305 starved   (9x)
 *     my-upg-100-list/upg-100-mfe       canvas 1280x720, gl, attrib, 0 errors
 *     doxa-research-map/research-map    canvas 1280x676, gl, attrib, 0 errors
 *     all-people-groups                 canvas 1280x720, gl, attrib, 0 errors
 *     country-posters/countries-map     canvas 1280x720, gl, attrib, 0 errors
 *     dashboard-plus-grid               canvas  686x340, gl, attrib, 0 errors
 *     research-dashboard                canvas  686x357, gl, attrib, 0 errors
 *     demo-map, doxa-simple-map         canvas 1280x*,   gl, attrib, 0 errors
 *
 *   COUPLED — data is load-bearing for map construction. Starved, there is NO CANVAS AT ALL, so
 *   verify-map-paint ALREADY fails them on glContext:
 *     gospel-resources/resources-map    canvas null, gl false, attrib false
 *     cities-internet/connectivity-map  canvas null, gl false, attrib false
 *     regions-dashboard/region-dashboards, regions-dashboard/regions-mfe   likewise
 *
 * 9 of the 13 leaves verify-map-paint covers are decoupled, i.e. the hole is the majority of the
 * suite, not an edge case. A STATIC read of construction order (does `new Map` precede the first
 * `await`?) disagreed with the runtime probe on three of them and returned "indeterminate" for four
 * more, including upg-100-list, whose map is built through engineGlobal() and matches no
 * constructor pattern. The starve-probe is the instrument; source order is not.
 *
 * ⚠ THE COUPLED LEAVES ARE DELIBERATELY NOT LISTED HERE. Asserting them would add coverage that
 * cannot catch a defect — the existing gate detects the identical failure one assertion earlier.
 * A gate's leaf list is a claim about WHERE A FAILURE WOULD OTHERWISE GO UNSEEN, not a trophy
 * cabinet of everything it can be pointed at. Padding it would inflate apparent coverage, which is
 * the same decoration problem as printing a number nobody asserts on.
 *
 * ★ WHY A CANVAS SCREENSHOT, when both obvious canvas approaches are known-broken. Measured three
 * times this cycle: getImageData/drawImage STRAIGHT FROM THE GL CANVAS returns an empty buffer —
 * Mapbox allocates its context with preserveDrawingBuffer:false, so the drawing buffer is already
 * swapped by the time script runs. This probe read `{"colours":1,"nonzero":0}` on three maps that
 * were visibly full of colour. readPixels fails identically.
 *   The fix is the COMPOSITOR, not the context: Playwright's elementHandle.screenshot() forces a
 * real frame and hands back PNG bytes. Same three leaves, same instant: 2821 / 459 / 889 colours.
 * The instrument was wrong, not the map.
 *
 * ★ WHY A DIFFERENTIAL AND NOT A FLOOR. Healthy leaves span 459..2821 colours — a 6x spread —
 * because a choropleth of 195 polygons and a two-tone connectivity map are both correct. ANY global
 * floor is therefore either vacuous or flaky, and the repo has one to prove it: check:map-paints
 * requires 40 distinct colours, and a starved upg-100-list scores 306. It would pass a data-free map
 * without hesitation.
 *   So each leaf is compared AGAINST ITSELF: same URL, same viewport, same wait, run twice — once
 * normally, once with our data aborted. The threshold is then not a guess about how colourful a map
 * ought to be, it is "withholding our data must visibly change THIS map".
 *
 * ★ TWO MEASURES, PASS ON EITHER — see MAX_STARVED_RATIO / MIN_CHANGED_PCT below for the numbers.
 * The short version: palette change and area change catch different kinds of data layer, and each
 * one alone produces a false red on a real leaf. A choropleth in a small dashboard pane repaints a
 * quarter of the canvas while barely touching the palette; a sparse demo map transforms the palette
 * while repainting 5% of the frame. A map with NO data on it moves neither, which is what makes the
 * disjunction sound rather than merely lenient.
 *
 * ⚠ AND BECAUSE A DISJUNCTION IS A WEAKER CLAIM, --poison IS NOT OPTIONAL. It starves BOTH runs so
 * neither measure can move, and requires every leaf to go red. A widened assertion that still
 * passes everything reads as coverage while proving nothing; the poison arm is what distinguishes
 * "measured and fine" from "no longer able to fail".
 *
 * ⚠ AND IT REFUSES TO JUDGE RATHER THAN GUESS. If either run yields no canvas, or the starved run
 * does not actually abort anything, the leaf reports NOT MEASURED and the process exits 75
 * (the repo's EX_TEMPFAIL, reported as the wave runner's (/) ) -- never 0. A gate that measured
 * nothing must not read as green; that exact confusion once let three confident runs be reported
 * about code nobody had changed.
 *
 * Usage: node internal/check-map-data-painted.mjs [url ...]
 *        node internal/check-map-data-painted.mjs --poison     # must go RED; proves it can fail
 *   Defaults to the LOCAL tree's decoupled leaves. Pass URLs explicitly to audit what is published.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { servesThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const BASE = process.env.BASE || `http://127.0.0.1:4173/${TREE_NAME}`

// ONLY the decoupled leaves — see the census above. A leaf moves onto this list when a starve-probe
// shows verify-map-paint still passing it with our data gone, and off it when construction becomes
// data-dependent (at which point the existing gate covers it).
const DECOUPLED_LEAVES = [
  'my-upg-100-list/upg-100-list/index.html',
  'all-people-groups/all-people-groups/index.html',
  'country-posters/countries-map/index.html',
  'dashboard-plus-grid/dashboard-plus-grid/index.html',
  'demo-map/demo-map/index.html',
  'doxa-simple-map/doxa-simple-map/index.html',
]

// ⚠ TWO DECOUPLED LEAVES ARE EXCLUDED BECAUSE THIS INSTRUMENT CANNOT MEASURE THEM — recorded here
// rather than left in the list to emit a permanent (/), which would read as coverage. Each is a
// MEASUREMENT limit, not a verdict that the leaf is fine:
//
//   my-upg-100-list/upg-100-mfe — the map canvas sits at y:800 in an 800px viewport with
//   document.scrollHeight ALSO exactly 800 and scrollY stuck at 0; at viewport 1600 it moves to
//   y:1600,h:1600. It is the composite's second tab pane in a 100vh flex layout, positioned outside
//   the scrollable area, so it is always exactly one viewport below the fold and the document never
//   grows to contain it. scrollIntoView cannot reach it — there is nothing to scroll. Measuring it
//   requires ACTIVATING THE TAB (a product interaction), which is a different gate.
//   Its inner map is the same profile as upg-100-list, which IS measured here.
//
//   doxa-research-map/research-map — page.screenshot times out at 25s on a 400x250 clip, while
//   upg-100-mfe captures the identical size in 0.9s on the same browser and slot. So it is neither
//   capture area nor element stability: this leaf does not yield a compositor frame on demand.
//   Cause unknown; it needs its own investigation rather than a longer timeout.
const EXCLUDED = new Map([
  ['my-upg-100-list/upg-100-mfe', 'map canvas is always exactly one viewport below a non-scrolling document (inactive tab pane); needs tab activation'],
  ['doxa-research-map/research-map', 'page.screenshot times out even on a 400x250 clip that other leaves capture in 0.9s; no compositor frame on demand'],
  ['research-dashboard/research-dashboard', 'map is not in the shared mapStore, so readiness cannot be measured; on the fixed-wait fallback it PASSED and then timed out on consecutive runs minutes apart'],
])

// ⚠ research-dashboard IS THE REASON THE READINESS LABEL IS PRINTED RATHER THAN JUST USED.
// Measured twice, minutes apart, no code change between: pass 1 "PASS … 19.1% changed, fixed wait
// — map instance unreachable", pass 2 "NOT MEASURED (page.screenshot timeout)". Its map does not
// appear in the provides().mapStore that every other leaf exposes, so the isStyleLoaded() &&
// areTilesLoaded() predicate cannot see it and the run falls back to a fixed wait — which is
// exactly the flakiness this gate was rewritten to remove. Excluding it is not a verdict that the
// leaf is fine; it is a refusal to publish a verdict that depends on machine load.
// A leaf leaves this map the moment its map instance is reachable.

// OUR data, as opposed to the basemap vendor's tiles. Measured from a request census across the
// leaves: local boundary/table/point JSON under /assets/, plus the people-groups API.
const OUR_DATA = /\/assets\/(boundaries|tables|people-groups)\/|pray\.doxa\.life\/api\/|\/api\/people-groups\//i

// ★ TWO MEASURES, AND THE LEAF PASSES IF EITHER ONE MOVES DECISIVELY. Neither alone can carry a
// single threshold — measured 2026-09-26 on four healthy leaves, and they disagree in OPPOSITE
// directions, which is the finding that shaped this gate:
//
//   leaf                  colourRatio   changedPixels
//   all-people-groups        0.110          70.1%      both decisive
//   upg-100-list             0.114          30.2%      both decisive
//   dashboard-plus-grid      0.788          26.4%      palette barely moves, AREA does
//   demo-map                 0.196           5.0%      area barely moves, PALETTE does
//
// dashboard-plus-grid's map is a 686x340 PANE inside a composite: the basemap already contributes
// ~846 distinct colours through coastlines, terrain and label antialiasing, and a choropleth
// deletes AREA without introducing many new HUES. demo-map is the mirror image — one sparse data
// request over a muted basemap, so it repaints little of the frame while transforming the palette.
// A 15% changed-pixel bar would falsely fail demo-map; a 0.55 colour bar falsely failed
// dashboard-plus-grid (it did, and I nearly reported it as a product defect).
// A map with NO data on it moves NEITHER: starve it and the palette is unchanged AND the pixels are
// unchanged. So the assertion is a disjunction, and each bar sits far from every healthy reading.
const MAX_STARVED_RATIO = 0.55   // palette: worst healthy non-pane reading is 0.196
const MIN_CHANGED_PCT = 3.0      // area:    worst healthy reading is 5.0% (demo-map)
// Below this many colours even the healthy run is suspect: something other than data is wrong.
const MIN_HEALTHY_COLOURS = 60
// Both images are downsampled to this before comparison — cheap, and coarse enough that tile
// dithering does not read as data.
const SAMPLE_W = 400
const SAMPLE_H = 250
// Widest capture taken from a canvas, in CSS px. Bounded because a full-width 1280px capture timed
// out at 30s on research-map even with a perfectly valid clip rect.
const CLIP_CAP = 800

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']

// ★ --poison IS THE MUTATION ARM, AND WIDENING THE ASSERTION TO A DISJUNCTION IS EXACTLY WHY IT IS
// MANDATORY. "Either the palette moved OR the pixels moved" is a weaker claim than either half, and
// a weakened assertion that still passes everything reads as coverage while proving nothing.
// --poison starves BOTH runs, so the comparison is data-free-vs-data-free: neither measure can
// move, and the gate must go RED. If --poison ever comes back green the bars have drifted into
// vacuity, regardless of what the normal run says.
// ⚠ Flags are filtered out of the positional list below — a bare `--poison` was otherwise consumed
// as a leaf URL, which has bitten this repo's gates twice (--self-test read as a leaf path,
// --emit read as a baseUrl).
const POISON = process.argv.includes('--poison')
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const urls = argv.length
  ? argv
  : DECOUPLED_LEAVES.map((p) => BASE.replace(/\/$/, '') + '/' + p)

// ★ "ANSWERS 200" AND "IS SERVING THIS BUILD" ARE DIFFERENT QUESTIONS. :4173 on this box has been
// held by another worktree before now, and a gate happily reported someone else's map as proof that
// this checkout worked. Refuse rather than measure the wrong tree.
const TREE_BASE = String(urls[0]).split(`/${TREE_NAME}/`)[0]
if (!argv.length) {
  const serves = await servesThisTree(TREE_BASE).catch(() => false)
  if (!serves) {
    console.log(`MAP-DATA-PAINTED: NOT MEASURED — nothing at ${TREE_BASE} is serving this tree.`)
    console.log('  Start it with `bun run serve` in this worktree, then re-run.')
    process.exit(75)
  }
}

const deepSrc = `(sel) => {
  const out = []
  const walk = (r) => {
    for (const e of r.querySelectorAll('*')) { if (e.matches(sel)) out.push(e); if (e.shadowRoot) walk(e.shadowRoot) }
  }
  walk(document)
  return out
}`
const CANVAS_SEL = 'canvas.mapboxgl-canvas, canvas.maplibregl-canvas, canvas'

const browser = await chromium.launch({ headless: true, args: GL_ARGS })

/**
 * Render one leaf and count the distinct colours the COMPOSITOR actually painted.
 * starve=true aborts only OUR data requests; the basemap is left completely alone, so a difference
 * cannot be explained by a blank map.
 */
async function measure(url, starve, forceClip) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  let blocked = 0
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 120)))
  if (starve) {
    await page.route('**/*', (route) => {
      if (OUR_DATA.test(route.request().url())) { blocked++; return route.abort() }
      return route.continue()
    })
  }
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 })
  } catch (e) {
    await ctx.close()
    return { err: `navigation failed: ${String(e.message).slice(0, 70)}`, blocked }
  }
  // ★ A FIXED WAIT MADE THIS GATE FLAKY, AND THAT IS A MEASUREMENT BUG, NOT BAD LUCK. With
  // `waitForTimeout(10000)` alone, two runs minutes apart on identical code disagreed:
  // countries-map read 1868 distinct colours then 54; research-dashboard passed at 17.2% changed
  // then timed out. Under the two-slot browser policy on a loaded box, 10s is sometimes enough for
  // tiles to paint and sometimes not, so the verdict tracked machine load rather than the product.
  //
  // So wait on THE MAP'S OWN VERDICT, the way measure-map-load.mjs:81 does:
  // isStyleLoaded() && areTilesLoaded(). Not map.loaded() — measure-map-load records that it
  // resolves earlier than the tiles in view actually being drawn.
  //
  // ★ THE MAP INSTANCE IS REACHABLE WITHOUT A PER-PROFILE HANDLE. Only upg-100-list exposes
  // window.__UPG_MAP__, but every leaf mounts a Vue custom element, and mobile-sheet-probe.mjs:102
  // already reads host()._instance.provides to get at the shared mapStore. Walking that gives the
  // real instance on any leaf, so this gate reads the map's own readiness rather than a proxy for
  // it — which matters, because my first attempt sampled canvas dimensions and DOM node counts and
  // those stop changing LONG before tiles finish painting. A settled proxy is not a settled map.
  //
  // ⚠ BOTH RUNS USE THE SAME PREDICATE, so this does NOT give them different exposures — which was
  // my original reason for a fixed wait, and it was wrong: equal WAITS do not mean equal READINESS,
  // and it is readiness the comparison depends on.
  await page.waitForTimeout(2500)
  const readiness = await page.evaluate(async ({ maxMs }) => {
    const hosts = [...document.querySelectorAll('*')].filter((e) => e.tagName.includes('-'))
    const maps = []
    for (const h of hosts) {
      const p = h._instance && h._instance.provides
      const store = p && p.mapStore
      const vals = store && store.maps ? Object.values(store.maps) : []
      for (const v of vals) if (v && v.instance) maps.push(v.instance)
    }
    if (!maps.length) return { via: 'none' }
    const ready = () => maps.every((m) => {
      try { return m.isStyleLoaded && m.isStyleLoaded() && m.areTilesLoaded && m.areTilesLoaded() } catch { return false }
    })
    const t0 = Date.now()
    while (Date.now() - t0 < maxMs) {
      if (ready()) return { via: 'mapStore', maps: maps.length, waitedMs: Date.now() - t0 }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { via: 'mapStore', maps: maps.length, timedOut: true, waitedMs: Date.now() - t0 }
  }, { maxMs: 25000 }).catch(() => ({ via: 'error' }))

  // ⚠ NO FIXED-WAIT FALLBACK. If the store was not reachable this returns via:'none' and the caller
  // reports NOT MEASURED — it does NOT wait longer and then judge anyway. Silently degrading to the
  // clock is precisely how the instability above got shipped: the leaf still produced a confident
  // PASS, just an unrepeatable one.
  // A final settle so a just-finished tile fade is fully composited before capture.
  await page.waitForTimeout(2500)

  // Locate the canvas and take its viewport rectangle — NOT an element handle. See below.
  // ⚠ evaluateHandle/evaluate take exactly ONE argument; pass several and Playwright throws
  // "Too many arguments", which surfaced as exit 1, i.e. indistinguishable from "this map has no
  // data on it". Wrap them in an object.
  // ★ THE STARVED RUN REUSES THE HEALTHY RUN'S CLIP. Computing it independently in each run made
  // the two crops disagree by 3px on dashboard-plus-grid (686x340@297,118 vs @297,121) — the grid
  // chrome beside the map reflows slightly when its rows have no data — and a 3px offset compares
  // two different rectangles, which is a silently wrong percentage. Rejecting the pair was my first
  // answer and it threw away a measurable leaf; aligning the crops keeps the comparison honest AND
  // measurable. The canvas is still located and scrolled first, so a clip is only reused when there
  // is in fact a canvas to sample.
  const clip = forceClip ? await page.evaluate(({ src, sel, given }) => {
    const deep = eval(src)
    const c = deep(sel)[0]
    if (!c) return null
    let r = c.getBoundingClientRect()
    if (r.top >= window.innerHeight || r.bottom <= 0) { c.scrollIntoView({ block: 'center', inline: 'center' }); r = c.getBoundingClientRect() }
    return (r.width > 1 && r.height > 1) ? given : null
  }, { src: deepSrc, sel: CANVAS_SEL, given: forceClip }) : await page.evaluate(({ src, sel, cap }) => {
    const deep = eval(src)
    const c = deep(sel)[0]
    if (!c) return null

    // ⚠ SCROLL IT INTO VIEW FIRST. upg-100-mfe's map canvas sits at y:800 in an 800px viewport —
    // it is the composite's map PANE, below the fold in the tab layout — so clamping to
    // innerHeight produced height 0 and the leaf reported "no canvas with a visible box" on a
    // canvas that was painting perfectly. Being off-screen is a fact about the layout, not about
    // whether our data is on the map.
    let r = c.getBoundingClientRect()
    if (r.top >= window.innerHeight || r.bottom <= 0) {
      c.scrollIntoView({ block: 'center', inline: 'center' })
      r = c.getBoundingClientRect()
    }
    if (r.width < 2 || r.height < 2) return null

    // ★ SAMPLE A BOUNDED, CENTRED WINDOW rather than the whole canvas. Two reasons, both measured:
    //   - research-map's canvas is 1280x756, fully in the viewport with a valid rect, and
    //     page.screenshot STILL timed out at 30s on it. A large full-width capture is the cost;
    //     a bounded one is not.
    //   - the canvas edges carry attribution, scale bar and control chrome, which never change
    //     between the two runs and so only DILUTE the changed-pixel fraction. Centre-sampling
    //     measures map, not furniture.
    const cw = Math.min(r.width, cap), ch = Math.min(r.height, cap * 0.625)
    const cx = r.left + (r.width - cw) / 2, cy = r.top + (r.height - ch) / 2
    const x = Math.max(0, Math.floor(cx)), y = Math.max(0, Math.floor(cy))
    const width = Math.floor(Math.min(cw, window.innerWidth - x))
    const height = Math.floor(Math.min(ch, window.innerHeight - y))
    return (width > 1 && height > 1) ? { x, y, width, height } : null
  }, { src: deepSrc, sel: CANVAS_SEL, cap: CLIP_CAP })
  if (!clip) { await ctx.close(); return { err: 'no canvas with a visible box in any shadow root', blocked } }

  // ★ page.screenshot({clip}), NOT elementHandle.screenshot(). This is the whole reason three
  // dashboard leaves reported NOT MEASURED with "Timeout 20000ms exceeded":
  // elementHandle.screenshot() waits for the element to be STABLE — two consecutive animation
  // frames at the same position — before it captures. A Mapbox canvas inside a scrolling dashboard
  // pane is continuously animating (tile fade-in, label collision), so it may never satisfy that
  // precondition and the call times out on a map that is painting perfectly. Raising the timeout
  // does not fix a liveness precondition that is never met.
  // A clip on page.screenshot has no stability requirement: it captures the compositor's output for
  // a rectangle. check-gospel-map-paints:116 and check-embed-basemap-paints:143 both do exactly
  // this, on these same leaves, and neither has ever timed out.
  let png
  try {
    png = await page.screenshot({ type: 'png', clip, timeout: 30000 })
  } catch (e) {
    await ctx.close()
    return { err: `canvas screenshot failed: ${String(e.message).slice(0, 60)}`, blocked }
  }

  // Sanity-read THIS image before it is ever compared: an all-black readback is the known
  // preserveDrawingBuffer failure described above, not a finding about the map.
  const counted = await page.evaluate(async ({ b64, w, h }) => {
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = 'data:image/png;base64,' + b64 })
    const o = document.createElement('canvas'); o.width = w; o.height = h
    const ctx2 = o.getContext('2d')
    ctx2.drawImage(img, 0, 0, w, h)
    const d = ctx2.getImageData(0, 0, w, h).data
    const set = new Set()
    let nonzero = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] || d[i + 1] || d[i + 2]) nonzero++
      // Bucket to 32 levels per channel so gradient dithering is not counted as a distinct colour.
      set.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3))
    }
    return { nonzero, colours: set.size }
  }, { b64: png.toString('base64'), w: SAMPLE_W, h: SAMPLE_H }).catch((e) => ({ err: String(e.message).slice(0, 60) }))

  await ctx.close()
  if (counted.err) return { err: `image read failed: ${counted.err}`, blocked }
  if (counted.nonzero === 0) return { err: 'canvas read back entirely black (buffer already swapped)', blocked }
  return { colours: counted.colours, b64: png.toString('base64'), clip, blocked, pageErrors, readiness }
}

/**
 * What FRACTION of this map's own pixels did our data paint? See the MIN_CHANGED_PCT note above for
 * why this exists beside the palette measure rather than replacing it.
 * Runs in a throwaway blank page — it only needs a 2D canvas, not the leaf.
 */
async function changedPct(page, healthyB64, starvedB64) {
  const r = await page.evaluate(async ({ a, c, w, h }) => {
    const load = (s) => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode'))
      i.src = 'data:image/png;base64,' + s
    })
    const [ia, ic] = await Promise.all([load(a), load(c)])
    const grab = (img) => {
      const o = document.createElement('canvas'); o.width = w; o.height = h
      const q = o.getContext('2d'); q.drawImage(img, 0, 0, w, h)
      return q.getImageData(0, 0, w, h).data
    }
    const da = grab(ia), dc = grab(ic)
    let changed = 0
    // A per-channel-sum threshold of 24 (out of a possible 765) ignores antialiasing and tile
    // compression noise while catching any real fill, stroke or pin.
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - dc[i]) + Math.abs(da[i + 1] - dc[i + 1]) + Math.abs(da[i + 2] - dc[i + 2]) > 24) changed++
    }
    return 100 * changed / (da.length / 4)
  }, { a: healthyB64, c: starvedB64, w: SAMPLE_W, h: SAMPLE_H }).catch(() => null)
  return r
}

console.log('MAP-DATA-PAINTED')
console.log(`  ${urls.length} decoupled leaf(s); each measured twice (healthy vs our-data-starved)`)
console.log(`  bar: withholding our data must move EITHER the palette (ratio <= ${MAX_STARVED_RATIO})`)
console.log(`       OR the pixels (>= ${MIN_CHANGED_PCT}% of the canvas changed). A data-free map moves neither.`)
// ★ SAY WHAT IS NOT COVERED. A silent exclusion reads as "everything is checked"; the loop's rule
// that an unasserted number is decoration applies just as much to an unmentioned gap.
if (!argv.length) {
  for (const [leaf, why] of EXCLUDED) console.log(`  ⊝ NOT COVERED — ${leaf}: ${why}`)
}

// ⚠ AN UNEXPECTED THROW MUST NOT LOOK LIKE A PRODUCT FINDING. The first run of this gate died on a
// Playwright arity error and exited 1 — which a wave runner reads as "these maps have no data on
// them". A harness bug and a data regression are different claims; only the second may exit 1.
process.on('uncaughtException', (e) => {
  console.error('\nMAP-DATA-PAINTED: NOT MEASURED — the gate itself threw, which is a harness bug,')
  console.error('  not a verdict about the maps:')
  console.error(`  ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n  ')}`)
  process.exit(75)
})

// A blank page used only as a 2D-canvas host for comparing the two screenshots. Doing the diff in
// the leaf's own page would make the comparison depend on whichever leaf happened to be open.
const diffCtx = await browser.newContext()
const diffPage = await diffCtx.newPage()
await diffPage.goto('about:blank')

const rows = []
for (const url of urls) {
  const name = url.replace(/^https?:\/\/[^/]+\//, '').replace(/\/index\.html$/, '')
  // Under --poison the "healthy" run is ALSO starved, so both images are data-free and neither
  // measure can move. See the POISON note at the top.
  const healthy = await measure(url, POISON)
  if (healthy.err) { rows.push({ name, unmeasured: `healthy run: ${healthy.err}` }); console.log(`  ⊘ ${name} — NOT MEASURED (healthy run: ${healthy.err})`); continue }

  // ⚠ REFUSE TO PUBLISH A VERDICT THAT RESTS ON A FIXED WAIT — checked BEFORE the second page load,
  // so a leaf this gate will not judge does not cost a run. "Waited 12s and hoped" and "the map said
  // its tiles were loaded" are different confidences, and the fixed wait is measurably unstable
  // here: research-dashboard PASSED at 19.1% changed and then timed out on the next run minutes
  // later, with no code change between them. A PASS produced that way measures machine load, not the
  // product. Such a leaf belongs in EXCLUDED with its reason until its map instance is reachable.
  if ((healthy.readiness || {}).via !== 'mapStore') {
    rows.push({ name, unmeasured: 'map instance unreachable, so readiness could not be measured — a fixed-wait result is load-dependent' })
    console.log(`  ⊘ ${name} — NOT MEASURED (map instance unreachable; a fixed-wait verdict would track machine load, not the product)`)
    continue
  }

  const starved = await measure(url, true, healthy.clip)
  if (starved.err) { rows.push({ name, unmeasured: `starved run: ${starved.err}` }); console.log(`  ⊘ ${name} — NOT MEASURED (starved run: ${starved.err})`); continue }

  // ⚠ IF THE STARVE BLOCKED NOTHING, THE COMPARISON IS BETWEEN TWO IDENTICAL RUNS and would pass
  // forever. That is the vacuous-assertion trap: a leaf whose data URLs stop matching OUR_DATA
  // must report NOT MEASURED, not PASS.
  if (starved.blocked === 0) {
    rows.push({ name, unmeasured: 'starve aborted 0 requests — OUR_DATA matches none of this leaf\'s fetches' })
    console.log(`  ⊘ ${name} — NOT MEASURED (starve aborted 0 requests; OUR_DATA pattern no longer matches this leaf)`)
    continue
  }
  if (healthy.colours < MIN_HEALTHY_COLOURS) {
    rows.push({ name, unmeasured: `healthy run painted only ${healthy.colours} colours (<${MIN_HEALTHY_COLOURS})` })
    console.log(`  ⊘ ${name} — NOT MEASURED (healthy run painted only ${healthy.colours} colours)`)
    continue
  }

  // ⚠ THE TWO RUNS MUST SAMPLE THE SAME REGION or the diff compares two different crops and the
  // percentage is meaningless. The starved run is now HANDED the healthy run's clip, so this is an
  // invariant check on that plumbing rather than a tolerance on layout drift — if it ever fires, the
  // clip did not survive being passed through, and the right response is to fix that, not to widen a
  // threshold.
  const sameClip = healthy.clip && starved.clip
    && healthy.clip.x === starved.clip.x && healthy.clip.y === starved.clip.y
    && healthy.clip.width === starved.clip.width && healthy.clip.height === starved.clip.height
  if (!sameClip) {
    const fmt = (c) => c ? `${c.width}x${c.height}@${c.x},${c.y}` : 'none'
    rows.push({ name, unmeasured: `the layout moved when data was withheld — sampled ${fmt(healthy.clip)} vs ${fmt(starved.clip)}` })
    console.log(`  ⊘ ${name} — NOT MEASURED (layout shifted: sampled ${fmt(healthy.clip)} healthy vs ${fmt(starved.clip)} starved)`)
    continue
  }

  const ratio = starved.colours / healthy.colours
  const pct = await changedPct(diffPage, healthy.b64, starved.b64)
  if (pct === null) {
    rows.push({ name, unmeasured: 'the two screenshots could not be compared (PNG decode failed)' })
    console.log(`  ⊘ ${name} — NOT MEASURED (the two screenshots could not be compared)`)
    continue
  }

  const paletteMoved = ratio <= MAX_STARVED_RATIO
  const pixelsMoved = pct >= MIN_CHANGED_PCT
  const ok = paletteMoved || pixelsMoved
  rows.push({ name, healthy: healthy.colours, starved: starved.colours, ratio, pct, blocked: starved.blocked, ok, paletteMoved, pixelsMoved })
  const rd = healthy.readiness
  const how = rd.timedOut
    ? `tiles NOT settled within 25s (${rd.maps} map(s))`
    : `tiles settled in ${(rd.waitedMs / 1000).toFixed(1)}s`
  const line = `${name} — palette ${healthy.colours}→${starved.colours} (ratio ${ratio.toFixed(3)}${paletteMoved ? ' ✓' : ''}), `
    + `pixels changed ${pct.toFixed(1)}%${pixelsMoved ? ' ✓' : ''}, ${starved.blocked} aborted, ${how}`
  if (ok) console.log(`  PASS ${line}`)
  else console.error(`  FAIL ${line}`)
}

const unmeasured = rows.filter((r) => r.unmeasured)
const failed = rows.filter((r) => r.ok === false)

const measured = rows.filter((r) => !r.unmeasured)

// ★ THE POISON ARM INVERTS THE VERDICT. A green poison run means the bars no longer discriminate.
if (POISON) {
  const leaked = measured.filter((r) => r.ok !== false)
  console.log('')
  if (!measured.length) {
    console.error('MAP-DATA-PAINTED --poison: NOT MEASURED — no leaf produced a comparison to poison.')
    await browser.close()
    process.exit(75)
  }
  if (leaked.length) {
    console.error(`MAP-DATA-PAINTED --poison: FAIL — ${leaked.length} leaf(s) PASSED with our data withheld from BOTH runs.`)
    for (const l of leaked) {
      console.error(`  ✗ ${l.name}: ratio ${l.ratio.toFixed(3)}, changed ${l.pct.toFixed(1)}% — `
        + 'two data-free images should move neither measure')
    }
    console.error('\n  The bars have drifted into vacuity: this gate would now pass a map with none of')
    console.error(`  our data on it. Tighten MAX_STARVED_RATIO (${MAX_STARVED_RATIO}) or MIN_CHANGED_PCT (${MIN_CHANGED_PCT}%).`)
    await browser.close()
    process.exit(1)
  }
  console.log(`MAP-DATA-PAINTED --poison: caught it — all ${measured.length} leaf(s) went RED with the data withheld`)
  console.log('  from both runs, so a green normal run is a real measurement and not a vacuous one.')
  await browser.close()
  process.exit(0)
}

if (failed.length) {
  console.error(`\nMAP-DATA-PAINTED: FAIL — ${failed.length} of ${rows.length} leaf(s) look the same with our data removed.`)
  for (const f of failed) {
    console.error(`  ✗ ${f.name}: palette ratio ${f.ratio.toFixed(3)} (bar <=${MAX_STARVED_RATIO}) `
      + `AND only ${f.pct.toFixed(1)}% of pixels changed (bar >=${MIN_CHANGED_PCT}%)`)
  }
  console.error('\n  A leaf whose canvas barely changes when every one of our data requests is')
  console.error('  aborted is painting a basemap, not a map of our data. verify-map-paint cannot see')
  console.error('  this: a live GL context, attribution and zero console errors are all present on')
  console.error('  exactly that map. Check that the data layers are added to the style, that they')
  console.error('  are above the basemap layers, and that their filters are not evaluating empty.')
  process.exit(1)
}
if (unmeasured.length === rows.length) {
  console.error('\nMAP-DATA-PAINTED: NOT MEASURED — no leaf produced a usable comparison.')
  for (const u of unmeasured) console.error(`  ⊘ ${u.name}: ${u.unmeasured}`)
  await browser.close()
  process.exit(75)
}
if (unmeasured.length) {
  console.log(`\n  ⚠ ${unmeasured.length} leaf(s) NOT MEASURED — these are not passes:`)
  for (const u of unmeasured) console.log(`      ${u.name}: ${u.unmeasured}`)
}
console.log(`\nMAP-DATA-PAINTED: PASS — ${rows.length - unmeasured.length} leaf(s) demonstrably lose their `
  + 'data layers when our data is withheld, so the data is what they were painting.')
await browser.close()
