#!/usr/bin/env node
/**
 * theme-flash-probe.mjs — PROVE whether a map's basemap ever shows a LIGHT frame
 * when it is supposed to be pinned DARK (useMapTheme THEME_TOGGLE=false →
 * lightPreset 'night'). Gate for DXM-007 (simple map) + DXM-010 (research map).
 *
 * @one-shot  Written 2026-09-17 to prove DXM-007/DXM-010 (a LIGHT basemap frame flashing
 *            before useMapTheme pinned it dark). Both are fixed. Kept as the reproduction recipe
 *            — it measures first-paint colour through the real map pipeline, which is expensive
 *            to rebuild — but it is NOT a standing check and is not expected to run again
 *            unless that class of bug returns.
 *
 * WHY: a reader sees (a) a light→dark FLASH on load and (b) the basemap flipping
 * FULLY light after a legend click / tab click. "It looks dark to me" is not
 * evidence — this tool turns the basemap's brightness into NUMBERS sampled over
 * time, before and after every UI action, so the bug (and the fix) is a checked
 * fact on both surfaces. It needs NO handle to the `map` object hidden inside the
 * shadow DOM: it only looks at pixels, exactly like a reader does.
 *
 * HOW: WebGL canvases cannot be read back (Mapbox does not keep the drawing buffer),
 * so the probe deep-finds `canvas.mapboxgl-canvas` through every nested shadow root
 * and measures its bounding box in one of two streams:
 *   screenshots (default) — `page.screenshot({clip: canvas box})` as fast as Firefox
 *     allows (identical pixels to an element screenshot, minus the scroll/"stable"
 *     wait that doubles the cost on a map that never stops animating). Every frame
 *     is a TRUE composite of what the user sees, but one costs ~400–600 ms (the very
 *     first after boot up to ~1.9 s), so the timeline is coarse.
 *   --video — records the page (Playwright recordVideo, ~25 fps, half-size) and
 *     frame-steps the .webm afterwards (default --video-step 80 ms → 12 samples/s).
 *     Fine timeline (how long did the flash last?), aligned to the page by a colour
 *     MARKER the probe paints in the viewport corner at every phase start (video
 *     time and wall time drift by ~1–2 s, so wall-clock alignment is not trusted).
 *     No screenshots are taken in this mode. KNOWN ARTEFACT: the Firefox screencast
 *     drops the WebGL layer from frames — pure white, or half white (a torn frame) —
 *     in bursts of 1–8 frames even on a settled map. Evidence they are capture
 *     artefacts, not real frames: they are rgb(255,255,255) while a covered canvas
 *     shows the real container/overlay colour (rgb 248/249 in the plugin gallery, which
 *     the boot gap does show); Mapbox never paints half a frame; and the true-
 *     composite screenshot stream never catches one (--steady 15000 ≈ 45–50 settled
 *     samples per target: 0 white; 6–8 screenshots per legend click: 0 white, while
 *     the video of the same clicks showed 4- and 8-frame pure-white bursts). So:
 *     pure-white frames over a non-white background are kind 'artefact'; a covered
 *     gap counts only when it lasts ≥ --video-min-run frames (default 10 = 800 ms);
 *     shorter covered runs and torn frames are reported (`whiteArtefactFrames`,
 *     `isolatedGapFrames`, `tornFrames`), never counted. The SCREENSHOT stream is the
 *     arbiter for anything ≥ ~0.3 s; video is for durations. Run video probes ALONE
 *     (no parallel browsers) — CPU contention multiplies these artefacts.
 * Pixel math runs IN THE BROWSER with zero deps: PNG (or video frame) → 2D <canvas>
 * downsampled to 192 px wide in a separate blank page → getImageData (fully-
 * transparent pixels skipped). Per sample, over the CORE window (an inner region
 * excluding the INTENTIONALLY LIGHT UI chrome — legend/geocoder on the left, tab bar
 * on top, attribution at the bottom): `core` = mean Rec.709 luminance of everything
 * the user sees there, `behindFrac` = share of pixels matching the CSS background
 * behind the transparent canvas (read from the DOM: nothing painted there yet),
 * `painted` = mean luminance of the REMAINING pixels = what Mapbox actually painted,
 * plus `full` (whole canvas), `rgb`, `sat`, `white`. Sample kinds: 'covered'
 * (behindFrac ≥ 0.97 — the map is not visible: container or an overlay of the same
 * colour), 'partial' (≥ 0.2), 'painted', 'artefact' (see --video). At first canvas
 * (and after boot) the probe also names the element ON TOP of the canvas via
 * elementFromPoint through the shadow roots (`coverAtBoot`) — a loading overlay
 * shows up here with its background colour.
 * VERDICT per phase: flashDetected when (1) any sample with ≥ 20 % of the core
 * painted has `painted` above the threshold — a RENDERED light basemap (Standard's
 * default lightPreset 'day' painted before applyTheme pinned night), or (2) a covered
 * run lasts ≥ min-run samples (screenshots: 1, every sample is a real composite) —
 * the user sees the container/overlay instead of the map. The two need different
 * fixes and are reported separately (`brightPainted`, `gapMs`, `coverAtBoot`).
 * FINDINGS 2026-09-16 (baseline, dev plugin gallery, Firefox): no 'day' frame was ever
 * painted on either surface in any run, including with the data race forced
 * (--delay-data 3000). The simple map's "light then dark" on load is its LIGHT
 * loading overlay `.dsm-loading{background:#f8f9fa}` (v-if="!appReady"), removed
 * only after the data-dependent onMapReady — 0.6–1.9 s here, the whole boot window
 * when the API is slow. The research map's overlay `.rm-loading` is dark (#0f1216),
 * so its boot never looks light. No legend row or tab click made the basemap light
 * on either surface (screenshot stream, ~200–250 ms cadence).
 * Phases: 'boot' (first canvas → +4 s), optional 'steady' (--steady <ms>, no
 * action: control), then one phase per UI action — visible legend rows
 * (`.stl-rows .stl-row`, re-queried live) on the initial tab, every research-map tab
 * (`.rm-tab-bar .rm-tab`), legend rows again on the final tab, legend tab chips
 * (`.stl-tab`) — each sampled for 2 s after the click; what was clicked is listed.
 * Threshold is CALIBRATED per target: darkMean = mean `painted` over the LAST SECOND
 * of boot (the settled, known-dark state); threshold = max(90, darkMean+60) on the
 * 0–255 scale (override: --threshold N). If the settled boot state itself is not
 * dark (darkMean > 120) calibration is refused (floor used) and boot is marked
 * failed.
 * --delay-data <ms>: delays the DATA requests (default match: any non-mapbox.com
 * request whose path has /api/ or ends in .json/.geojson/.csv[.gz]; Vite module
 * queries like ?import are skipped; --delay-match <regex> on the full URL overrides;
 * the first delayed URLs are printed so the match can be checked). Both profiles
 * start `mapData.loadData()` (REST: /api/people-groups/list) in parallel with the map
 * and only call applyTheme AFTER `await dataPromise` inside the style.load handler,
 * so whether a 'day' frame is ever painted is a RACE between the Standard style
 * download and the data fetch. When the data wins the race is invisible; slow API /
 * fast CDN timing loses it. Delaying the data loses the race on purpose so the day
 * window becomes measurable — and so a fix (e.g. `config:{basemap:{lightPreset:
 * 'night'}}` at construction, supported by GL JS v3.24 — `options.config` maps to
 * the style's initialConfig) can be PROVEN independent of timing.
 * Browser: Firefox by default (house rule: never Google Chrome; Playwright's
 * bundled Chromium is allowed via --browser chromium when installed). Pinned Firefox
 * missing → any cached ~/.cache/ms-playwright/firefox-* build (internal/lib/browser.mjs).
 *
 * Usage:  node internal/theme-flash-probe.mjs [--url http://localhost:5174]
 *           [--grep <substr>] [--target <url|#/bundle/id> --tag <element-tag>]
 *           [--wait 20000] [--boot 4000] [--settle 2000] [--steady 0] [--interval 150]
 *           [--max-rows 8] [--threshold N] [--delay-data 0] [--delay-match <regex>]
 *           [--video] [--video-step 80] [--video-min-run 10] [--keep-video] [--video-dir <dir>]
 *           [--browser firefox|chromium] [--json <out.json>]
 * Exit:   0 no flash anywhere · 1 any flash (list printed) · 2 setup failure
 *         (plugin gallery unreachable / no map canvas within --wait)
 * CAVEATS (be honest with the numbers): the screenshot stream cannot see anything
 * shorter than one screenshot (~0.5 s) — a screenshot PASS means "no bright frame
 * was observed", not "none happened"; use --video for the fine timeline, and treat a
 * FAIL from either stream as proof. Camera moves (legend rows fly the map)
 * legitimately change the scene, which the +60 margin absorbs. The plugin gallery dev
 * server compiles on first load, so boot timings are dev timings, and a warm Vite
 * cache makes the 2nd target boot faster than the 1st. Headless WebGL may render via
 * a software path; the numbers are what THIS browser painted.
 */
import { writeFileSync, mkdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { requireDevServesThisCheckout as __devGuard, requireThisTree as __treeGuard } from './_serves-this-tree.mjs'
import { fileURLToPath as __f2p } from 'node:url'
import { dirname as __dn, resolve as __rs } from 'node:path'
const __ROOT = __rs(__dn(__f2p(import.meta.url)), '..')
import { launch, DEEP_FIND_SRC, deepEvaluate, TELEMETRY } from './lib/browser.mjs'

const args = process.argv.slice(2)
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const BASE = String(argOf('--url', 'http://localhost:5174')).replace(/\/+$/, '')
// Measure THIS checkout, or measure nothing (exit 75 = NOT MEASURED; see _serves-this-tree.mjs).
await __devGuard(BASE, __ROOT, 'THEME-FLASH')
const GREP = argOf('--grep', '')
const TARGET = argOf('--target', '')
const TAG = argOf('--tag', '')
const WAIT = Number(argOf('--wait', 20000))
const BOOT_MS = Number(argOf('--boot', 4000))
const SETTLE_MS = Number(argOf('--settle', 2000))
const STEADY_MS = Number(argOf('--steady', 0))
const INTERVAL = Number(argOf('--interval', 150))
const MAX_ROWS = Math.max(0, Number(argOf('--max-rows', 8)))
const THRESHOLD_OVERRIDE = args.includes('--threshold') ? Number(argOf('--threshold')) : null
const DELAY_DATA = Number(argOf('--delay-data', 0))
const DELAY_MATCH = argOf('--delay-match', '')
const VIDEO = args.includes('--video')
const VIDEO_STEP = Math.max(40, Number(argOf('--video-step', 80)))
const VIDEO_MIN_RUN = Math.max(1, Number(argOf('--video-min-run', 10)))
const KEEP_VIDEO = args.includes('--keep-video')
const VIDEO_DIR = argOf('--video-dir', '') // where the .webm recordings go (default: a temp dir under os.tmpdir())
const BROWSER = argOf('--browser', 'firefox')
const JSON_OUT = argOf('--json', '')
const VIEWPORT = { width: 1440, height: 900 }
const VIDEO_SCALE = 0.5 // recorded at half size: exact pixel mapping, small .webm
const MARKER = 48       // px, phase marker square painted bottom-left of the viewport (video mode)
const MIN_RUN = VIDEO ? VIDEO_MIN_RUN : 1

// Calibration policy (0–255 luminance scale). MARGIN above the settled-dark mean,
// FLOOR so a very dark calibration can't make normal night-scene variation "bright",
// SANE_DARK_CAP = the settled boot state must be below this or it is NOT dark at all.
const MARGIN = 60, FLOOR = 90, SANE_DARK_CAP = 120
// Inner analysis window (fractions of the canvas box) that excludes the light UI chrome:
// legend + geocoder column on the left (~400px of the map), 44px tab bar on top, attribution
// at the bottom, nav control top-right.
const CORE = { x0: 0.35, x1: 0.97, y0: 0.12, y1: 0.92 }
const WHITE_L = 235
// A pixel is "behind" (nothing painted) when within this many levels (per channel) of the
// CSS background behind the transparent canvas. Sample kinds by share of such pixels:
const BEHIND_TOL = 10, UNPAINTED_FRAC = 0.97, PARTIAL_FRAC = 0.2
// `painted` may only convict a LIGHT BASEMAP when at least this share of the core is painted —
// on an unpainted frame the ~1% non-background pixels are the nav control / attribution, not the map.
const PAINTED_MIN_SHARE = 0.2
// --delay-data: which requests are "the data". Never Mapbox's own (style/tiles/sprites/glyphs),
// never Vite module queries (?import/?raw/?url/?worker); --delay-match <regex> overrides the default.
const isDataRequest = (u) => {
  if (/(^|\.)mapbox\.com$/i.test(u.hostname)) return false
  if (/[?&](import|raw|url|worker|init)(=|&|$)/.test(u.search)) return false
  if (/\.(m?js|ts|vue|css|map|woff2?|png|svg)$/i.test(u.pathname)) return false // static modules/assets, never data
  if (DELAY_MATCH) return new RegExp(DELAY_MATCH).test(u.href)
  return /\.(geo)?json(\.gz)?$|\.csv(\.gz)?$|\/api\//i.test(u.pathname)
}

// ── targets ──────────────────────────────────────────────────────────────────
const asUrl = (u) => /^https?:\/\//.test(u) ? u : `${BASE}/${u.replace(/^\/+/, '')}`
let targets = TARGET
  ? [{ label: TARGET.replace(/^.*#\//, ''), tag: TAG || null, url: asUrl(TARGET) }]
  : [
      { label: 'doxa-simple-map/prayer', tag: 'doxa-map', url: `${BASE}/#/doxa-simple-map/prayer` },
      { label: 'doxa-research-map/research-map', tag: 'doxa-research-map', url: `${BASE}/#/doxa-research-map/research-map` },
    ]
if (GREP) targets = targets.filter(t => t.label.includes(GREP) || String(t.tag).includes(GREP))
if (!targets.length) { console.error('[theme-flash-probe] no targets after --grep'); process.exit(2) }

const ping = await fetch(BASE + '/').catch(() => null)
if (!ping || !ping.ok) { console.error(`[theme-flash-probe] cannot reach ${BASE} — is \`bun x vite\` running?`); process.exit(2) }
console.log(`[theme-flash-probe] ${targets.length} target(s) @ ${BASE} · browser ${BROWSER} · stream ${VIDEO ? `video @${VIDEO_STEP}ms (gap counts from ${VIDEO_MIN_RUN} frames)` : `screenshots ≥${INTERVAL}ms`} · boot ${BOOT_MS}ms${STEADY_MS ? ` · steady ${STEADY_MS}ms` : ''} · settle ${SETTLE_MS}ms · threshold ${THRESHOLD_OVERRIDE ?? `max(${FLOOR}, darkMean+${MARGIN})`}${DELAY_DATA ? ` · same-origin JSON delayed ${DELAY_DATA}ms` : ''}`)

// ── shadow-piercing element handles (deepFind is the page-side helper from lib/browser.mjs) ─
// Only VISIBLE elements (a hidden mobile legend slot duplicates every row on desktop).
const DEEP_FIND_ALL_SRC = `(root, sel, out) => {
  out = out || []
  if (!root || !root.querySelectorAll) return out
  for (const el of root.querySelectorAll(sel)) { if (el.getClientRects().length) out.push(el) }
  for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) deepFindAll(el.shadowRoot, sel, out) }
  return out
}`
async function deepHandle(page, sel) {
  const h = await page.evaluateHandle(new Function('sel', `const deepFind = ${DEEP_FIND_SRC};\nreturn deepFind(document, sel)`), sel)
  const el = h.asElement(); if (!el) await h.dispose()
  return el
}
async function deepHandles(page, sel) {
  const arr = await page.evaluateHandle(new Function('sel', `const deepFind = ${DEEP_FIND_SRC};\nconst deepFindAll = ${DEEP_FIND_ALL_SRC};\nreturn deepFindAll(document, sel)`), sel)
  const out = []
  for (const [, v] of await arr.getProperties()) { const el = v.asElement(); if (el) out.push(el) }
  await arr.dispose()
  return out
}
// The CSS background the user sees THROUGH the transparent WebGL canvas before Mapbox paints:
// first non-transparent background-color walking up from the canvas, crossing shadow hosts.
const behindCanvas = (page) => deepEvaluate(page, (deepFind) => {
  let el = deepFind(document, 'canvas.mapboxgl-canvas')
  while (el) {
    const bg = getComputedStyle(el).backgroundColor
    const m = bg && bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (m && (m[4] === undefined || Number(m[4]) > 0.99)) return { el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : ''), rgb: [Number(m[1]), Number(m[2]), Number(m[3])] }
    el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null
  }
  const b = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) || [255, 255, 255]
  return { el: 'body', rgb: b.slice(0, 3).map(Number) }
})
// What is ON TOP of the canvas right now at a core point (66% across, mid-height)? Walks
// elementFromPoint down through nested shadow roots. A loading overlay (e.g. .dsm-loading
// #f8f9fa, .rm-loading #0f1216) shows up here — it is what the user sees, not the map.
const coverAt = (page) => deepEvaluate(page, (deepFind) => {
  const c = deepFind(document, 'canvas.mapboxgl-canvas'); if (!c) return null
  const b = c.getBoundingClientRect(); const x = b.left + b.width * 0.66, y = b.top + b.height * 0.5
  let root = document, el = null
  for (let i = 0; i < 12; i++) { const hit = root.elementFromPoint(x, y); if (!hit || hit === el) break; el = hit; if (!el.shadowRoot) break; root = el.shadowRoot }
  if (!el || el === c) return { covered: false, el: 'canvas.mapboxgl-canvas' }
  const name = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '')
  return { covered: true, el: name, background: getComputedStyle(el).backgroundColor, text: (el.textContent || '').trim().slice(0, 40) }
})
// Phase marker (video mode): a fixed square in the viewport's bottom-left corner whose colour
// changes at every phase start. Outside the map canvas in the plugin gallery; even if a layout put
// it under the canvas box it is excluded by the core window.
const MARKER_COLORS = ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)']
const setMarker = (page, i) => page.evaluate(([i, size, colors]) => {
  let m = document.getElementById('__tfp_marker')
  if (!m) { m = document.createElement('div'); m.id = '__tfp_marker'; m.style.cssText = `position:fixed;left:0;bottom:0;width:${size}px;height:${size}px;z-index:2147483647;pointer-events:none`; document.body.appendChild(m) }
  m.style.background = colors[i % colors.length]
}, [i, MARKER, MARKER_COLORS]).catch(() => {})

// ── pixel statistics (page-side, shared by the image and the video path) ─────
// d = RGBA bytes of a w×h grid; core = inner window fractions; behind = rgb behind the canvas.
const STATS_SRC = `(d, w, h, core, behind, tol) => {
  const cx0 = core.x0 * w, cx1 = core.x1 * w, cy0 = core.y0 * h, cy1 = core.y1 * h
  let sf = 0, nf = 0, sc = 0, nc = 0, minc = 255, maxc = 0, sat = 0, white = 0, transparent = 0, sr = 0, sg = 0, sb = 0, nb = 0, sp = 0, np = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    if (d[i + 3] === 0) { transparent++; continue }
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sf += L; nf++
    if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
      sc += L; nc++; if (L < minc) minc = L; if (L > maxc) maxc = L
      sat += Math.max(r, g, b) - Math.min(r, g, b); if (L > ${WHITE_L}) white++; sr += r; sg += g; sb += b
      const isBehind = behind && Math.abs(r - behind[0]) <= tol && Math.abs(g - behind[1]) <= tol && Math.abs(b - behind[2]) <= tol
      if (isBehind) nb++; else { sp += L; np++ }
    }
  }
  const R = (v) => Math.round(v * 10) / 10
  return { full: nf ? R(sf / nf) : null, core: nc ? R(sc / nc) : null, coreMin: nc ? R(minc) : null, coreMax: nc ? R(maxc) : null,
           rgb: nc ? [Math.round(sr / nc), Math.round(sg / nc), Math.round(sb / nc)] : null,
           sat: nc ? R(sat / nc) : null, white: nc ? Math.round(white / nc * 1000) / 1000 : null,
           behindFrac: nc && behind ? Math.round(nb / nc * 1000) / 1000 : null, painted: np ? R(sp / np) : null,
           pixels: nf, transparent }
}`

async function luminance(analysis, png, behind) {
  const dataUrl = 'data:image/png;base64,' + png.toString('base64')
  return analysis.evaluate(new Function('a', `const stats = ${STATS_SRC};\nreturn (${(async ({ dataUrl, core, maxW, behind, tol }) => {
    const img = new Image(); img.src = dataUrl; await img.decode()
    const W = img.naturalWidth, H = img.naturalHeight
    // Downsample by drawing scaled (drawImage averages source pixels) — ~maxW px wide grid.
    const s = Math.min(1, maxW / W), w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h)
    return { w: W, h: H, grid: `${w}x${h}`, ...stats(ctx.getImageData(0, 0, w, h).data, w, h, core, behind, tol) }
  }).toString()})(a)`), { dataUrl, core: CORE, maxW: 192, behind: behind ? behind.rgb : null, tol: BEHIND_TOL })
}

// Frame-step a recorded .webm: crop to the canvas box (video = viewport × VIDEO_SCALE), same
// downsampled grid, same stats; plus the marker square's colour class per frame.
async function analyseVideo(analysis, webmPath, box, behind) {
  const dataUrl = 'data:video/webm;base64,' + readFileSync(webmPath).toString('base64')
  return analysis.evaluate(new Function('a', `const stats = ${STATS_SRC};\nreturn (${(async ({ dataUrl, box, scale, core, stepMs, maxW, marker, vh, behind, tol }) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = dataUrl
    await new Promise((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('video failed to load')) })
    const seek = (t) => new Promise((res) => { const to = setTimeout(res, 1500); v.onseeked = () => { clearTimeout(to); res() }; v.currentTime = t })
    if (!isFinite(v.duration)) { await seek(1e6) } // some webm report Infinity until the end is seen
    const dur = isFinite(v.duration) ? v.duration : 0
    const sx = box.x * scale, sy = box.y * scale, sw = box.width * scale, sh = box.height * scale
    const w = maxW, h = Math.max(1, Math.round(w * sh / sw))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    const mk = document.createElement('canvas'); mk.width = 4; mk.height = 4
    const mctx = mk.getContext('2d', { willReadFrequently: true })
    const ms = marker * scale
    const frames = []
    for (let t = 0; t < dur; t += stepMs / 1000) {
      await seek(t)
      ctx.clearRect(0, 0, w, h); ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h)
      // marker: centre 50% of the square, averaged to a 4x4 grid
      mctx.drawImage(v, ms * 0.25, vh * scale - ms * 0.75, ms * 0.5, ms * 0.5, 0, 0, 4, 4)
      const md = mctx.getImageData(0, 0, 4, 4).data; let mr = 0, mg = 0, mb = 0
      for (let i = 0; i < 64; i += 4) { mr += md[i]; mg += md[i + 1]; mb += md[i + 2] }
      mr /= 16; mg /= 16; mb /= 16
      const mx = Math.max(mr, mg, mb), mn = Math.min(mr, mg, mb)
      const cls = (mx > 150 && mn < 90 && mx - (mr + mg + mb - mx - mn) > 80) ? (mx === mr ? 0 : mx === mg ? 1 : 2) : -1
      frames.push({ t: Math.round(t * 1000), marker: cls, ...stats(ctx.getImageData(0, 0, w, h).data, w, h, core, behind, tol) })
    }
    return { durationMs: Math.round(dur * 1000), videoSize: `${v.videoWidth}x${v.videoHeight}`, stepMs, frames }
  }).toString()})(a)`), { dataUrl, box, scale: VIDEO_SCALE, core: CORE, stepMs: VIDEO_STEP, maxW: 192, marker: MARKER, vh: VIEWPORT.height, behind: behind ? behind.rgb : null, tol: BEHIND_TOL })
}

// ── sample the canvas for `durationMs` (clock starts at t0) — screenshot stream ─
async function samplePhase(page, analysis, getCanvas, durationMs, t0, behind) {
  const samples = []
  const end = t0 + durationMs
  let box = null, measured = 0
  // at least ONE measured sample per phase (a slow first screenshot must not leave a phase empty)
  while (Date.now() < end || (measured === 0 && Date.now() < t0 + durationMs * 2)) {
    const ts = Date.now()
    try {
      if (!box) { const c = await getCanvas(); box = c ? await c.boundingBox() : null; if (c) await c.dispose() }
      if (!box) { samples.push({ t: ts - t0, error: 'no canvas' }); await page.waitForTimeout(INTERVAL); continue }
      const png = await page.screenshot({ type: 'png', clip: box, timeout: 5000 })
      const shot = Date.now()
      samples.push({ t: ts - t0, shotMs: shot - ts, ...(await luminance(analysis, png, behind)) }); measured++
    } catch (e) {
      samples.push({ t: ts - t0, error: String(e.message || e).split('\n')[0].slice(0, 120) })
      box = null // stale/detached → re-find next round
    }
    const rest = INTERVAL - (Date.now() - ts)
    if (rest > 0) await page.waitForTimeout(rest)
  }
  return { samples, box }
}

// ── verdicts ─────────────────────────────────────────────────────────────────
const fmt = (v) => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1)
// Sample kinds. 'artefact' = a PURE WHITE frame (every channel ≥ 253) while the colour behind the
// canvas is not white: no real state of the page looks like that (a covered canvas shows the
// container/overlay colour, e.g. 249/248) — it is the screencast dropping the WebGL layer.
const isWhite = (rgb) => !!rgb && rgb.every(c => c >= 253)
const kindOf = (s, behind) => {
  if (isWhite(s.rgb) && behind && !isWhite(behind.rgb)) return 'artefact'
  return s.behindFrac == null ? 'painted' : s.behindFrac >= UNPAINTED_FRAC ? 'covered' : s.behindFrac >= PARTIAL_FRAC ? 'partial' : 'painted'
}
const calibrate = (samples, behind) => {
  const ok = samples.filter(s => typeof s.core === 'number')
  const settled = ok.filter(s => s.t >= BOOT_MS - 1000)
  let set = (settled.length >= 2 ? settled : ok.slice(-3)).filter(s => kindOf(s, behind) === 'painted' && typeof s.painted === 'number')
  let metric = 'painted'
  if (!set.length) { set = settled.length >= 2 ? settled : ok.slice(-3); metric = 'core' }
  const vals = set.map(s => metric === 'painted' ? s.painted : s.core)
  return { darkMean: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null, n: vals.length, metric }
}
function threshold(darkMean, n, metric) {
  if (THRESHOLD_OVERRIDE != null) return { threshold: THRESHOLD_OVERRIDE, calibration: `--threshold ${THRESHOLD_OVERRIDE} (override) · settled boot ${metric} mean ${fmt(darkMean)}`, bootNote: '' }
  if (darkMean == null) return { threshold: FLOOR, calibration: `no measurable boot frame — floor ${FLOOR}`, bootNote: '' }
  if (darkMean > SANE_DARK_CAP) return { threshold: FLOOR, calibration: `settled boot ${metric} mean ${fmt(darkMean)} > ${SANE_DARK_CAP}: basemap did NOT settle dark — calibration refused, floor ${FLOOR}`, bootNote: 'settled state is NOT dark (pin lost or never applied)' }
  const thr = Math.max(FLOOR, Math.round((darkMean + MARGIN) * 10) / 10)
  return { threshold: thr, calibration: `settled boot ${metric} mean ${fmt(darkMean)} (n=${n}, last 1s of boot) → threshold max(${FLOOR}, ${fmt(darkMean)}+${MARGIN}) = ${fmt(thr)}`, bootNote: '' }
}
function summarize(phase, action, samples, thr, stepMs, extraNote = '', behind = null) {
  const ok = samples.filter(s => typeof s.core === 'number')
  const cores = ok.map(s => s.core), painteds = ok.map(s => s.painted).filter(Number.isFinite)
  const shots = ok.map(s => s.shotMs).filter(Number.isFinite).sort((a, b) => a - b)
  const step = stepMs ?? (shots.length ? shots[Math.floor(shots.length / 2)] : null)
  // (1) rendered light basemap: what Mapbox painted (a real share of the core) is brighter than the threshold
  const brightPainted = thr == null ? [] : ok.filter(s => Number.isFinite(s.painted) && s.painted > thr && (s.behindFrac == null || 1 - s.behindFrac >= PAINTED_MIN_SHARE))
  // (2) covered gaps (whole core = container/overlay colour: the map is not visible), as consecutive
  //     runs; in video mode runs shorter than MIN_RUN are screencast artefacts (see header).
  //     'artefact' (pure white over a non-white background) and 'partial' (torn capture — Mapbox never
  //     paints half a frame) are reported, never counted.
  const runs = []; let cur = null
  for (const s of ok) { if (kindOf(s, behind) === 'covered') { if (cur) cur.push(s); else { cur = [s]; runs.push(cur) } } else cur = null }
  const gaps = runs.filter(r => r.length >= MIN_RUN), isolated = runs.filter(r => r.length < MIN_RUN)
  const gapSamples = gaps.flat(), isolatedSamples = isolated.flat()
  const torn = ok.filter(s => kindOf(s, behind) === 'partial'), whiteArtefacts = ok.filter(s => kindOf(s, behind) === 'artefact')
  const spanMs = (r) => step ? (r.length * step) : null
  const notes = []
  if (extraNote) notes.push(extraNote)
  if (brightPainted.length) notes.push(`LIGHT BASEMAP painted at t=${brightPainted.slice(0, 6).map(s => s.t + 'ms').join(',')}${brightPainted.length > 6 ? ',…' : ''} (painted ${fmt(brightPainted[0].painted)}, rgb ${brightPainted[0].rgb.join(',')}, sat ${fmt(brightPainted[0].sat)}, behindFrac ${brightPainted[0].behindFrac})`)
  if (gaps.length) notes.push(`MAP NOT VISIBLE (container/overlay colour over the whole core): ${gaps.map(r => `t=${r[0].t}–${r[r.length - 1].t}ms ×${r.length}${step ? ` ≈${spanMs(r)}ms` : ''}`).join(', ')} (rgb ${gapSamples[0].rgb.join(',')}, core ${fmt(gapSamples[0].core)})`)
  if (isolatedSamples.length || torn.length || whiteArtefacts.length) notes.push(`artefacts not counted: ${whiteArtefacts.length} pure-white frame(s), ${isolatedSamples.length} short covered run(s) (< ${MIN_RUN} consecutive)${isolatedSamples.length ? ` at t=${isolatedSamples.slice(0, 6).map(s => s.t).join(',')}${isolatedSamples.length > 6 ? ',…' : ''}ms` : ''}, ${torn.length} torn frame(s)`)
  if (samples.length && !ok.length) notes.push('no measurable frame (all samples errored / fully transparent)')
  else if (samples.length - ok.length) notes.push(`${samples.length - ok.length} sample(s) errored`)
  return {
    phase, action, samples, sampleCount: ok.length,
    maxLum: cores.length ? Math.max(...cores) : null, minLum: cores.length ? Math.min(...cores) : null,
    meanLum: cores.length ? Math.round(cores.reduce((a, b) => a + b, 0) / cores.length * 10) / 10 : null,
    maxPainted: painteds.length ? Math.max(...painteds) : null, maxFull: ok.length ? Math.max(...ok.map(s => s.full ?? 0)) : null,
    stepMs: step,
    brightPainted: brightPainted.length, gapFrames: gapSamples.length, gapMs: step ? gapSamples.length * step : null,
    longestGapMs: gaps.length && step ? Math.max(...gaps.map(spanMs)) : (gaps.length ? null : 0), firstGapAt: gaps.length ? gaps[0][0].t : null,
    isolatedGapFrames: isolatedSamples.length, tornFrames: torn.length, whiteArtefactFrames: whiteArtefacts.length,
    brightFrames: brightPainted.length + gapSamples.length,
    flashDetected: brightPainted.length > 0 || gaps.length > 0, note: notes.join(' · '),
  }
}
const line = (tagLabel, p, thr) =>
  console.log(`${p.flashDetected ? '✗' : '✓'} ${tagLabel}  ${p.phase.padEnd(30)} n:${String(p.sampleCount).padStart(3)}  core max:${fmt(p.maxLum).padStart(5)} min:${fmt(p.minLum).padStart(5)}  painted max:${fmt(p.maxPainted).padStart(5)}  light-basemap:${p.brightPainted}  covered:${p.gapFrames}${p.gapMs ? `(~${p.gapMs}ms)` : ''}  artefacts:${p.whiteArtefactFrames}+${p.isolatedGapFrames}+${p.tornFrames}  thr:${fmt(thr)}  ~${p.stepMs ?? '—'}ms/sample${p.note ? '\n      ' + p.note : ''}`)

// ── one target ───────────────────────────────────────────────────────────────
const browser = await launch(BROWSER, { label: 'theme-flash-probe' })
const analysis = await browser.newPage()  // blank page: pixel math only, never navigates
const videoDir = VIDEO ? (VIDEO_DIR ? (mkdirSync(VIDEO_DIR, { recursive: true }), VIDEO_DIR) : mkdtempSync(join(tmpdir(), 'theme-flash-probe-'))) : null

async function probe(t) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, ...(VIDEO ? { recordVideo: { dir: videoDir, size: { width: VIEWPORT.width * VIDEO_SCALE, height: VIEWPORT.height * VIDEO_SCALE } } } : {}) })
  const page = await ctx.newPage()
  const consoleErrors = [], pageErrors = []
  page.on('console', m => { if (m.type() === 'error' && !TELEMETRY.test(m.text())) consoleErrors.push(m.text().slice(0, 240)) })
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 240)))
  const delayed = []
  if (DELAY_DATA > 0) {
    await page.route(isDataRequest, async route => {
      const u = route.request().url().replace(BASE, '')
      delayed.push(u); if (delayed.length <= 4) console.log(`  [${t.label}] delaying ${DELAY_DATA}ms: ${u.slice(0, 120)}`)
      await new Promise(r => setTimeout(r, DELAY_DATA)); await route.continue()
    })
  }
  const r = { ...t, stream: VIDEO ? 'video' : 'screenshots', phases: [], threshold: null, darkMean: null, calibration: '', canvasFoundMs: null, canvasBox: null, behindCanvas: null, coverAtBoot: null, coverAfterBoot: null, delayedRequests: delayed, clicked: [], consoleErrors, pageErrors, setupError: null, video: null }
  const getCanvas = () => deepHandle(page, 'canvas.mapboxgl-canvas')
  // video mode: phases are cut from the recording afterwards — remember each phase's window
  const pending = [] // { phase, action, durMs, note, markerIdx }
  let markerIdx = -1
  const runPhase = async (phase, action, durMs, tStart, note = '') => {
    if (VIDEO) { markerIdx++; await setMarker(page, markerIdx); pending.push({ phase, action, durMs, note, markerIdx }); await page.waitForTimeout(durMs); return }
    const run = await samplePhase(page, analysis, getCanvas, durMs, tStart, r.behindCanvas)
    if (!r.canvasBox) r.canvasBox = run.box
    if (phase === 'boot') {
      const { darkMean, n, metric } = calibrate(run.samples, r.behindCanvas)
      r.darkMean = darkMean; Object.assign(r, threshold(darkMean, n, metric))
      console.log(`  [${t.label}] canvas after ${r.canvasFoundMs}ms (box ${r.canvasBox ? `${Math.round(r.canvasBox.width)}x${Math.round(r.canvasBox.height)}` : '?'}, behind: ${r.behindCanvas ? `${r.behindCanvas.el} rgb ${r.behindCanvas.rgb.join(',')}` : '?'}) · ${r.calibration}`)
    }
    const p = summarize(phase, action, run.samples, r.threshold, null, note || (phase === 'boot' ? r.bootNote : ''), r.behindCanvas)
    if (phase === 'boot' && r.bootNote) p.flashDetected = true
    r.phases.push(p); line(t.tag || t.label, p, r.threshold)
  }
  try {
    const tNav = Date.now()
    await page.goto(t.url, { waitUntil: 'load', timeout: 60000 })
    // wait for the FIRST canvas (poll fast — the boot flash lives in the first frames)
    let canvas = null
    const deadline = Date.now() + WAIT
    while (!canvas && Date.now() < deadline) { canvas = await getCanvas(); if (!canvas) await page.waitForTimeout(40) }
    if (!canvas) {
      const st = await deepEvaluate(page, (deepFind, tag) => ({ defined: !!customElements.get(tag), err: (deepFind(document, '.profile-error') || {}).textContent || null }), t.tag || '')
      r.setupError = `no canvas.mapboxgl-canvas within ${WAIT}ms (element defined: ${st.defined}${st.err ? ` · ProfileLoader: ${st.err.trim().slice(0, 120)}` : ''})`
      return r
    }
    const t0 = Date.now(); r.canvasFoundMs = t0 - tNav
    r.behindCanvas = await behindCanvas(page).catch(() => null) // ~20 ms; needed by every sample's stats
    r.coverAtBoot = await coverAt(page).catch(() => null)         // what the user sees at this instant
    if (VIDEO) { r.canvasBox = await canvas.boundingBox(); console.log(`  [${t.label}] canvas after ${r.canvasFoundMs}ms (box ${r.canvasBox ? `${Math.round(r.canvasBox.width)}x${Math.round(r.canvasBox.height)}` : '?'}, behind: ${r.behindCanvas ? `${r.behindCanvas.el} rgb ${r.behindCanvas.rgb.join(',')}` : '?'}) · recording; verdicts after the video is analysed`) }
    await canvas.dispose()
    if (r.coverAtBoot?.covered) console.log(`  [${t.label}] at first canvas the map is COVERED by <${r.coverAtBoot.el}> background ${r.coverAtBoot.background}${r.coverAtBoot.text ? ` "${r.coverAtBoot.text}"` : ''}`)
    // ── boot (+ optional steady control) ──
    await runPhase('boot', `page load → first canvas +${BOOT_MS}ms`, BOOT_MS, t0)
    r.coverAfterBoot = await coverAt(page).catch(() => null)
    if (r.coverAfterBoot?.covered) console.log(`  [${t.label}] after boot the map is STILL covered by <${r.coverAfterBoot.el}> background ${r.coverAfterBoot.background}`)
    if (STEADY_MS > 0) await runPhase('steady', `no action, +${STEADY_MS}ms (control)`, STEADY_MS, Date.now())

    // ── actions ── (handles are re-queried right before each click: tab switches re-render the legend)
    const clickPhase = async (kind, label, handle) => {
      const phase = `${kind}:${label.slice(0, 22)}`
      const tc = Date.now()
      try { await handle.click({ timeout: 4000 }) } catch (e) {
        const note = 'click failed (phase skipped): ' + String(e.message || e).split('\n')[0].slice(0, 100)
        r.clicked.push(`${kind}:${label} (click failed)`)
        const p = summarize(phase, `click ${kind} "${label}"`, [], r.threshold, VIDEO ? VIDEO_STEP : null, note, r.behindCanvas)
        if (VIDEO) pending.push({ phase, action: p.action, durMs: 0, note, markerIdx: -1 }); else { r.phases.push(p); line(t.tag || t.label, p, r.threshold) }
        return
      }
      r.clicked.push(`${kind}:${label}`)
      await runPhase(phase, `click ${kind} "${label}" → +${SETTLE_MS}ms`, SETTLE_MS, tc)
    }
    const legendRows = async (suffix) => {
      const rows = await deepHandles(page, '.stl-rows .stl-row')
      if (rows.length > MAX_ROWS) console.log(`  [${t.label}] legend has ${rows.length} visible rows${suffix} — clicking the first ${MAX_ROWS} (--max-rows)`)
      for (const h of rows.slice(0, MAX_ROWS)) await clickPhase('legend-row', (await h.evaluate(el => (el.querySelector('.stl-name') || el).textContent.trim())) + suffix, h)
      return rows.length
    }
    let n = await legendRows('')
    const tabs = []
    for (const h of await deepHandles(page, '.rm-tab-bar .rm-tab')) {
      const info = await h.evaluate(el => ({ label: el.textContent.trim(), active: el.classList.contains('active') }))
      if (!info.active) tabs.push({ label: info.label, handle: h })
    }
    for (const tb of tabs) await clickPhase('tab', tb.label, tb.handle)
    if (tabs.length) n += await legendRows(` @${tabs[tabs.length - 1].label}`)
    for (const h of await deepHandles(page, '.stl-tabs .stl-tab')) {
      const info = await h.evaluate(el => ({ label: el.textContent.trim(), active: !!el.closest('.stl-tab-chip.active') }))
      if (!info.active) await clickPhase('legend-tab', info.label, h)
    }
    if (!n && !tabs.length) console.log(`  [${t.label}] no tabs / legend rows found to click`)
    if (VIDEO) { markerIdx++; await setMarker(page, markerIdx); await page.waitForTimeout(300) } // end marker
  } catch (e) {
    r.setupError = 'exception: ' + String(e.message || e).slice(0, 200)
  } finally {
    const video = VIDEO ? page.video() : null
    await page.close(); await ctx.close()
    if (video && r.canvasBox && !r.setupError) {
      try {
        const path = await video.path()
        const va = await analyseVideo(analysis, path, r.canvasBox, r.behindCanvas)
        // phase starts = marker colour transitions, in order
        const starts = []
        let last = -1
        for (const f of va.frames) { if (f.marker !== -1 && f.marker !== last) { starts.push({ idx: starts.length, t: f.t, color: f.marker }); last = f.marker } }
        const expected = pending.filter(p => p.markerIdx >= 0).length + 1
        r.video = { path: KEEP_VIDEO || JSON_OUT ? path : null, durationMs: va.durationMs, videoSize: va.videoSize, stepMs: va.stepMs, frameCount: va.frames.length, markerTransitions: starts.length, expectedTransitions: expected, alignment: starts.length >= expected ? 'marker' : 'marker-incomplete' }
        console.log(`  [${t.label}] video ${va.videoSize} ${va.durationMs}ms · ${va.frames.length} frames @${va.stepMs}ms · ${starts.length}/${expected} phase markers found`)
        const slice = (k, durMs) => { const s = starts[k]; if (!s) return []; const end = starts[k + 1] ? Math.min(starts[k + 1].t, s.t + durMs) : s.t + durMs; return va.frames.filter(f => f.t >= s.t && f.t < end).map(f => ({ ...f, t: f.t - s.t })) }
        const bootFrames = slice(0, BOOT_MS)
        const { darkMean, n, metric } = calibrate(bootFrames, r.behindCanvas)
        r.darkMean = darkMean; Object.assign(r, threshold(darkMean, n, metric))
        console.log(`  [${t.label}] ${r.calibration}`)
        const boot = summarize('boot', pending[0].action, bootFrames, r.threshold, va.stepMs, r.bootNote, r.behindCanvas)
        if (r.bootNote) boot.flashDetected = true
        r.phases.push(boot); line(t.tag || t.label, boot, r.threshold)
        for (const p of pending.slice(1)) {
          const frames = p.markerIdx >= 0 ? slice(p.markerIdx, p.durMs) : []
          const ph = summarize(p.phase, p.action, frames, r.threshold, va.stepMs, p.note || (p.markerIdx >= 0 && !starts[p.markerIdx] ? 'marker not found in video — phase not sliced' : ''), r.behindCanvas)
          r.phases.push(ph); line(t.tag || t.label, ph, r.threshold)
        }
        r.video.frames = va.frames // full timeline (absolute video ms) for the report
      } catch (e) { console.log(`  [${t.label}] video analysis failed: ${String(e.message || e).slice(0, 160)}`); r.video = { error: String(e.message || e).slice(0, 200) } }
    }
  }
  return r
}

const results = []
for (const t of targets) {
  console.log(`\n▶ ${t.label}  <${t.tag || '?'}>  ${t.url}`)
  const r = await probe(t)
  if (r.setupError) console.log(`✗ ${r.tag || r.label}  SETUP  ${r.setupError}`)
  delete r.bootNote
  results.push(r)
}
await analysis.close()
await browser.close()
if (videoDir && !VIDEO_DIR && !KEEP_VIDEO && !JSON_OUT) rmSync(videoDir, { recursive: true, force: true })

const flashes = results.flatMap(r => r.phases.filter(p => p.flashDetected).map(p =>
  `${r.tag || r.label} ${p.phase} — ${p.brightPainted ? `LIGHT BASEMAP painted in ${p.brightPainted} sample(s) (painted max ${fmt(p.maxPainted)} > thr ${fmt(r.threshold)})` : ''}${p.brightPainted && p.gapFrames ? ' + ' : ''}${p.gapFrames ? `MAP NOT VISIBLE for ${p.gapFrames} sample(s)${p.gapMs ? ` ≈${p.gapMs}ms` : ''} from +${p.firstGapAt}ms${r.coverAtBoot?.covered && p.phase === 'boot' ? ` (covered by <${r.coverAtBoot.el}> ${r.coverAtBoot.background})` : ''}` : ''}${!p.brightPainted && !p.gapFrames ? p.note : ''}`))
const setupFails = results.filter(r => r.setupError)
const phaseCount = results.reduce((n, r) => n + r.phases.length, 0)
console.log(`\n[theme-flash-probe] ${phaseCount} phase(s) on ${results.length} target(s) · ${flashes.length} with a flash · ${setupFails.length} setup failure(s)`)
if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true })
  writeFileSync(JSON_OUT, JSON.stringify({
    tool: 'theme-flash-probe', generatedAt: new Date().toISOString(), base: BASE, browser: BROWSER, viewport: VIEWPORT, stream: VIDEO ? 'video' : 'screenshots',
    options: { wait: WAIT, boot: BOOT_MS, steady: STEADY_MS, settle: SETTLE_MS, interval: INTERVAL, maxRows: MAX_ROWS, thresholdOverride: THRESHOLD_OVERRIDE, delayData: DELAY_DATA, video: VIDEO, videoStep: VIDEO_STEP, videoMinRun: VIDEO_MIN_RUN, videoScale: VIDEO_SCALE, minRun: MIN_RUN },
    method: (VIDEO
      ? 'Playwright recordVideo (viewport × 0.5, ~25 fps) frame-stepped every --video-step ms in a blank analysis page; phases cut at colour-marker transitions painted bottom-left at each phase start; canvas crop = deep-found canvas.mapboxgl-canvas bounding box'
      : 'deep-find canvas.mapboxgl-canvas → page.screenshot({clip: canvas box}) PNG → data: URL → <img> in a blank analysis page')
      + ' → 192px-wide 2D canvas → per sample over the core window (light UI chrome excluded): core = mean Rec.709 luminance, behindFrac = share of pixels matching the CSS background behind the transparent canvas, painted = mean luminance of the rest. flashDetected = painted > threshold in any sample with ≥20% painted (rendered light basemap) OR a covered run ≥ minRun samples (map not visible: container/overlay colour); pure-white frames over a non-white background, shorter covered runs and torn frames are reported as artefacts (screencast), never counted. coverAtBoot names the element on top of the canvas at first canvas (loading overlays)',
    core: CORE, calibration: { margin: MARGIN, floor: FLOOR, saneDarkCap: SANE_DARK_CAP, rule: 'threshold = max(floor, mean painted luminance over last 1s of boot + margin)' },
    classification: { behindTolerance: BEHIND_TOL, unpaintedFrac: UNPAINTED_FRAC, partialFrac: PARTIAL_FRAC, whiteL: WHITE_L },
    flashDetected: flashes.length > 0, flashes, results,
  }, null, 2))
  console.log(`[theme-flash-probe] report → ${JSON_OUT}`)
}
if (setupFails.length) { console.log('SETUP FAILED:'); setupFails.forEach(r => console.log(`  ✗ ${r.label} — ${r.setupError}`)); process.exit(2) }
if (flashes.length) { console.log('FLASH DETECTED:'); flashes.forEach(f => console.log(`  ✗ ${f}`)); process.exit(1) }
