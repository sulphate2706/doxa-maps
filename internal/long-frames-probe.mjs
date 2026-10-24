#!/usr/bin/env node
/**
 * long-frames-probe.mjs — COUNT the long frames a map page produces, per phase, and
 * say WHO is burning the time. Gate for the DevTools flood of
 * "[Violation] 'requestAnimationFrame' handler took <N>ms" (~1000 lines per session).
 *
 * WHY: that Violation line is DevTools' long-frame notice (Verbose level). It cannot be
 * silenced from code — the only real fix is cheaper per-frame work — so "it feels
 * smooth" is not evidence. This tool turns the flood into NUMBERS per target and phase
 * (how many frames blew the 50 ms budget, the worst one, the total time over budget),
 * before and after a fix, plus a sampled CPU profile of the idle phase that names the
 * function and 📁 file:line responsible. A map sitting idle should render NOTHING; every
 * idle long frame is work somebody asked for.
 *
 * HOW: one FRESH context per target (1440x900), a script injected BEFORE load that
 *   · observes PerformanceObserver 'long-animation-frame' (LoAF: duration, blocking time,
 *     the attributed scripts) — Chromium; falls back to 'longtask' where LoAF is missing;
 *   · runs a rAF-delta sampler: consecutive requestAnimationFrame timestamps more than
 *     --threshold ms apart = a long frame (works in every browser, incl. Firefox);
 *   · counts WebGL draw calls (drawArrays/drawElements wrapped on the GL prototypes) so
 *     each phase also reports how many frames the MAP actually re-rendered — the direct
 *     "is Mapbox rendering at idle?" number, no handle to the map object needed;
 * and, on Chromium, a raw CDP session that asks the page's PerformanceMonitor for the same
 * violations DevTools prints (Log.startViolationsReport: recurringHandler ≥ 50 ms) and
 * captures every "[Violation] … requestAnimationFrame …" entry — the exact
 * complaint, counted. Phases: 'boot' (first canvas → +--boot ms), 'idle' (--idle ms, no
 * input), 'interaction' (--interact ms: two mouse drags across the canvas, wheel zoom in
 * and out, a third drag, then clicks on the first 2 visible legend rows `.stl-rows
 * .stl-row` and up to 2 research-map tabs `.rm-tab-bar .rm-tab`, all found through nested
 * shadow roots). Every observation is bucketed by the phase it STARTED in.
 * --profile (Chromium): CDP Profiler sampled at 0.5 ms during the idle phase, aggregated
 * to self/total ms per function@file:line; the top frames are printed (all, and app-only:
 * library/ plugin-designs/ internal/) and saved in the report. Line numbers are those of
 * the Vite-served module (.js files keep their lines; .vue compiled output does not).
 * Browser: Chromium by DEFAULT here (Playwright's bundled build — never Google Chrome) —
 * LoAF, the Violation log and the Profiler are Chromium-only; --browser firefox still
 * measures via the rAF-delta sampler + draw counter. Missing bundled Chromium → Firefox.
 *
 * Usage:  node internal/long-frames-probe.mjs [--base http://localhost:5174]
 *           [--url <page URL | #/bundle/id> [--url …]] [--tag <element tag> …]
 *           [--grep <substr>] [--browser chromium|firefox] [--threshold 50]
 *           [--boot 5000] [--idle 15000] [--interact 15000] [--wait 25000]
 *           [--profile] [--top 12] [--max-idle 0] [--viewport 1440x900] [--json <out.json>]
 *         Default targets: the three plugin gallery deep links doxa-simple-map/prayer,
 *         doxa-simple-map/engagement, doxa-research-map/research-map. --tag pairs with
 *         --url by position (one for all, or none = report the mounted tag).
 * Exit:   0 every target's IDLE phase has ≤ --max-idle long frames (LoAF where supported,
 *         else rAF-delta) · 1 any target over · 2 setup failure (plugin gallery unreachable /
 *         no canvas within --wait)
 * CAVEATS (be honest with the numbers): headless Chromium renders WebGL through SwiftShader
 * (CPU) — GL back-pressure can land in the main thread, so absolute ms are pessimistic and
 * the rAF-delta count also catches GPU-bound frames; compare BEFORE vs AFTER on the same
 * machine and lean on `rendered` (frames the map drew) and LoAF `scripts` for causality.
 * The plugin gallery dev server compiles on first load, so boot numbers are dev numbers.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { launch, DEEP_FIND_SRC, deepEvaluate, TELEMETRY } from './lib/browser.mjs'
import { requireDevServesThisCheckout as __devGuard, requireThisTree as __treeGuard } from './_serves-this-tree.mjs'
import { fileURLToPath as __f2p } from 'node:url'
import { dirname as __dn, resolve as __rs } from 'node:path'
const __ROOT = __rs(__dn(__f2p(import.meta.url)), '..')

const TOOL = 'long-frames-probe'
const args = process.argv.slice(2)
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const argAll = (k) => args.flatMap((a, i) => a === k && args[i + 1] ? [args[i + 1]] : [])
const BASE = String(argOf('--base', 'http://localhost:5174')).replace(/\/+$/, '')
// Measure THIS checkout, or measure nothing (exit 75 = NOT MEASURED; see _serves-this-tree.mjs).
await __devGuard(BASE, __ROOT, 'LONG-FRAMES')
const URLS = argAll('--url')
const TAGS = argAll('--tag')
const GREP = argOf('--grep', '')
let BROWSER = argOf('--browser', 'chromium')
const THRESHOLD = Number(argOf('--threshold', 50))
const BOOT_MS = Number(argOf('--boot', 5000))
const IDLE_MS = Number(argOf('--idle', 15000))
const INTERACT_MS = Number(argOf('--interact', 15000))
const WAIT = Number(argOf('--wait', 25000))
const PROFILE = args.includes('--profile')
const TOP = Math.max(1, Number(argOf('--top', 12)))
const MAX_IDLE = Number(argOf('--max-idle', 0))
const JSON_OUT = argOf('--json', '')
// --viewport WxH: a SMALL viewport makes software-GL frames cheap enough to exceed the
// animation's write rate, so `rendered` shows the throttle (renders/s) instead of the GPU.
const [VW, VH] = String(argOf('--viewport', '1440x900')).split('x').map(Number)
const VIEWPORT = { width: VW || 1440, height: VH || 900 }
const VIOLATION_RE = /requestAnimationFrame/i   // applied to Violation-source log entries + console text
const APP_URL_RE = /\/(library|plugin-designs|internal)\//

// ── targets ──────────────────────────────────────────────────────────────────
if (TAGS.length > 1 && TAGS.length !== URLS.length) { console.error(`[${TOOL}] ${TAGS.length} --tag for ${URLS.length} --url — give one per --url, one for all, or none`); process.exit(2) }
const asUrl = (u) => /^https?:\/\//.test(u) ? u : `${BASE}/${u.replace(/^\/+/, '')}`
let targets = URLS.length
  ? URLS.map((u, i) => ({ label: u.replace(/^.*#\//, ''), tag: TAGS.length === URLS.length ? TAGS[i] : (TAGS[0] || null), url: asUrl(u) }))
  : [
      { label: 'doxa-simple-map/prayer', tag: 'doxa-map', url: `${BASE}/#/doxa-simple-map/prayer` },
      { label: 'doxa-simple-map/engagement', tag: 'doxa-map', url: `${BASE}/#/doxa-simple-map/engagement` },
      { label: 'doxa-research-map/research-map', tag: 'doxa-research-map', url: `${BASE}/#/doxa-research-map/research-map` },
    ]
if (GREP) targets = targets.filter(t => t.label.includes(GREP) || String(t.tag).includes(GREP))
if (!targets.length) { console.error(`[${TOOL}] no targets after --grep`); process.exit(2) }
const ping = await fetch(targets[0].url.replace(/#.*$/, '')).catch(() => null)
if (!ping || !ping.ok) { console.error(`[${TOOL}] cannot reach ${targets[0].url.replace(/#.*$/, '')} — is \`bun x vite\` running?`); process.exit(2) }

// ── page-side instrumentation (injected before any page script runs) ─────────
// window.__lfp: phase marks, per-phase buckets of rAF-delta long frames, LoAF/longtask
// entries and rendered-frame counts; draw-call counter on the WebGL prototypes.
const INIT_SRC = `(() => {
  const T = ${THRESHOLD}
  const S = window.__lfp = { threshold: T, phase: 'pre', marks: [{ name: 'pre', t: 0 }], phases: {}, draws: 0,
    loafSupported: false, longtaskSupported: false, ticks: 0 }
  const bucket = (n) => S.phases[n] || (S.phases[n] = { raf: [], loaf: [], longtask: [], frames: 0, rendered: 0 })
  bucket('pre')
  S.setPhase = (n) => { S.phase = n; S.marks.push({ name: n, t: performance.now() }); bucket(n) }
  S.phaseAt = (t) => { let cur = 'pre'; for (const m of S.marks) { if (t >= m.t) cur = m.name; else break } return cur }
  // draw-call counter: any drawArrays/drawElements(+Instanced) on either GL prototype
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!P || !P.prototype) continue
    for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawArraysInstancedANGLE', 'drawElementsInstancedANGLE']) {
      const orig = P.prototype[fn]; if (typeof orig !== 'function') continue
      P.prototype[fn] = function () { S.draws++; return orig.apply(this, arguments) }
    }
  }
  // rAF-delta sampler + rendered-frame detector (draw counter moved since the last tick)
  let last = null, lastDraws = 0
  const tick = (now) => {
    S.ticks++
    const b = bucket(S.phase)
    b.frames++
    if (S.draws !== lastDraws) { b.rendered++; lastDraws = S.draws }
    if (last != null) { const d = now - last; if (d > T) bucket(S.phaseAt(last)).raf.push({ t: Math.round(last), ms: Math.round(d * 10) / 10 }) }
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  // Long Animation Frames (Chromium 123+) → longtask fallback
  try {
    const types = (PerformanceObserver.supportedEntryTypes || [])
    if (types.includes('long-animation-frame')) {
      S.loafSupported = true
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration < T) continue
          bucket(S.phaseAt(e.startTime)).loaf.push({ t: Math.round(e.startTime), ms: Math.round(e.duration), blocking: Math.round(e.blockingDuration || 0),
            scripts: (e.scripts || []).slice(0, 6).map(s => ({ ms: Math.round(s.duration), invoker: s.invoker, type: s.invokerType, fn: s.sourceFunctionName || null,
              src: s.sourceURL ? String(s.sourceURL).replace(/^https?:\\/\\/[^/]+/, '').replace(/\\?.*$/, '') : null, pos: s.sourceCharPosition ?? null, forcedLayoutMs: Math.round(s.forcedStyleAndLayoutDuration || 0) })) })
        }
      }).observe({ type: 'long-animation-frame', buffered: true })
    } else if (types.includes('longtask')) {
      S.longtaskSupported = true
      new PerformanceObserver((list) => { for (const e of list.getEntries()) bucket(S.phaseAt(e.startTime)).longtask.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) }) })
        .observe({ type: 'longtask', buffered: true })
    }
  } catch (_) {}
})()`

// ── shadow-piercing handles (deepFind = page-side helper from lib/browser.mjs) ─
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
const CANVAS_SEL = 'canvas.mapboxgl-canvas, canvas.maplibregl-canvas'
const setPhase = (page, n) => page.evaluate((n) => window.__lfp && window.__lfp.setPhase(n), n).catch(() => {})

// ── CPU profile aggregation (CDP Profiler.stop payload → self/total ms per frame) ─
const shortUrl = (u) => (u || '').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
function aggregateProfile(profile) {
  const nodes = new Map(); for (const n of profile.nodes) nodes.set(n.id, n)
  const parent = new Map(); for (const n of profile.nodes) for (const c of (n.children || [])) parent.set(c, n.id)
  const keyOf = (n) => { const cf = n.callFrame; const name = cf.functionName || '(anonymous)'; return cf.url ? `${name} ${shortUrl(cf.url)}:${cf.lineNumber + 1}:${cf.columnNumber + 1}` : name }
  const self = new Map(), total = new Map(), callers = new Map() // callers: leaf key → { parent key → ms }
  let sampled = 0
  const deltas = profile.timeDeltas || []
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (deltas[i] || 0) / 1000 // µs → ms
    sampled += dt
    let id = profile.samples[i]
    const leaf = nodes.get(id); if (!leaf) continue
    const lk = keyOf(leaf); self.set(lk, (self.get(lk) || 0) + dt)
    // nearest ancestor with a DIFFERENT key = who called the leaf (skips recursion frames)
    let pid = parent.get(id); while (pid != null && keyOf(nodes.get(pid)) === lk) pid = parent.get(pid)
    if (pid != null) { const pk = keyOf(nodes.get(pid)); const c = callers.get(lk) || new Map(); c.set(pk, (c.get(pk) || 0) + dt); callers.set(lk, c) }
    const seen = new Set()
    while (id != null) { const n = nodes.get(id); if (!n) break; const k = keyOf(n); if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) || 0) + dt) } id = parent.get(id) }
  }
  const topCallers = (k) => [...(callers.get(k) || new Map())].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([frame, ms]) => ({ frame, ms: Math.round(ms) }))
  const rows = [...total.keys()].map(k => ({ frame: k, selfMs: Math.round(self.get(k) || 0), totalMs: Math.round(total.get(k) || 0), callers: topCallers(k) }))
  const meta = /^\((program|idle|garbage collector|root)\)$/
  const byGroup = {}
  for (const [k, ms] of self) {
    const g = meta.test(k) ? k : /mapbox-gl|maplibre-gl/.test(k) ? 'mapbox-gl' : APP_URL_RE.test(k) ? 'app (library/plugin-designs/internal)' : /\/node_modules\/|\/@vite\/|\/@fs\//.test(k) ? 'other node_modules' : 'other'
    byGroup[g] = Math.round((byGroup[g] || 0) + ms)
  }
  return {
    sampledMs: Math.round(sampled), byGroupSelfMs: byGroup,
    topSelf: rows.filter(r => !meta.test(r.frame)).sort((a, b) => b.selfMs - a.selfMs).slice(0, TOP),
    topApp: rows.filter(r => APP_URL_RE.test(r.frame) && !/\/node_modules\//.test(r.frame)).sort((a, b) => b.totalMs - a.totalMs).slice(0, TOP),
  }
}

// ── one target ───────────────────────────────────────────────────────────────
let browser
try { browser = await launch(BROWSER, { label: TOOL }) } catch (e) {
  if (BROWSER !== 'chromium') throw e
  console.log(`[${TOOL}] bundled Chromium unavailable (${String(e.message || e).split('\n')[0].slice(0, 80)}) — measuring with Firefox (rAF-delta + draw counter only)`)
  BROWSER = 'firefox'; browser = await launch(BROWSER, { label: TOOL })
}
const isChromium = BROWSER === 'chromium'
console.log(`[${TOOL}] ${targets.length} target(s) · browser ${BROWSER} · threshold ${THRESHOLD}ms · boot ${BOOT_MS}ms · idle ${IDLE_MS}ms · interaction ${INTERACT_MS}ms${PROFILE ? (isChromium ? ' · CPU profile during idle' : ' · --profile ignored (Chromium only)') : ''}`)

async function probe(t) {
  const ctx = await browser.newContext({ viewport: VIEWPORT })
  await ctx.addInitScript(INIT_SRC)
  const page = await ctx.newPage()
  const consoleErrors = [], pageErrors = [], violations = []
  // Node-side phase windows (wall clock) for bucketing CDP log entries
  const windows = []; let phaseNow = 'pre'
  const mark = async (n) => { windows.push({ name: n, t: Date.now() }); phaseNow = n; await setPhase(page, n) }
  const phaseOfWall = (ts) => { let cur = 'pre'; for (const w of windows) { if (ts >= w.t) cur = w.name; else break } return cur }
  const onViolation = (text, ts) => { const m = /took\s*([\d.]+)\s*ms/.exec(text); violations.push({ phase: phaseOfWall(ts), ms: m ? Number(m[1]) : null, text: text.slice(0, 160) }) }
  page.on('console', m => {
    const text = m.text()
    if (m.type() === 'error' && !TELEMETRY.test(text)) consoleErrors.push(text.slice(0, 240))
    if (/Violation/.test(text) && VIOLATION_RE.test(text)) onViolation(text, Date.now())
  })
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 240)))
  let cdp = null
  if (isChromium) {
    // The same PerformanceMonitor report DevTools shows (Verbose): recurringHandler = rAF /
    // setInterval handlers over the threshold; the [Violation] prefix is DevTools' rendering.
    cdp = await ctx.newCDPSession(page)
    await cdp.send('Log.enable')
    await cdp.send('Log.startViolationsReport', { config: [{ name: 'recurringHandler', threshold: THRESHOLD }, { name: 'handler', threshold: 150 }, { name: 'longTask', threshold: 200 }] }).catch(() => {})
    cdp.on('Log.entryAdded', ({ entry }) => { if (entry.source === 'violation' && VIOLATION_RE.test(entry.text)) onViolation(`[Violation] ${entry.text}`, entry.timestamp ? Math.round(entry.timestamp) : Date.now()) })
    if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }) }
  }
  const r = { ...t, browser: BROWSER, phases: {}, canvasFoundMs: null, canvasBox: null, mountedTag: null, loafSupported: false, longtaskSupported: false, clicked: [], profile: null, consoleErrors, pageErrors, setupError: null }
  try {
    const tNav = Date.now()
    await page.goto(t.url, { waitUntil: 'load', timeout: 60000 })
    let canvas = null
    const deadline = Date.now() + WAIT
    while (!canvas && Date.now() < deadline) { canvas = await deepHandle(page, CANVAS_SEL); if (!canvas) await page.waitForTimeout(100) }
    if (!canvas) {
      const st = await deepEvaluate(page, (deepFind, tag) => ({ defined: !!customElements.get(tag), err: (deepFind(document, '.profile-error') || {}).textContent || null }), t.tag || '')
      r.setupError = `no map canvas within ${WAIT}ms (element defined: ${st.defined}${st.err ? ` · ProfileLoader: ${st.err.trim().slice(0, 120)}` : ''})`
      return r
    }
    r.canvasFoundMs = Date.now() - tNav
    r.canvasBox = await canvas.boundingBox(); await canvas.dispose()
    r.mountedTag = await page.evaluate(() => { const el = document.querySelector('#slot > *'); return el ? el.tagName.toLowerCase() : null }).catch(() => null)
    console.log(`  [${t.label}] canvas after ${r.canvasFoundMs}ms (box ${r.canvasBox ? `${Math.round(r.canvasBox.width)}x${Math.round(r.canvasBox.height)}` : '?'})${r.mountedTag ? ` · mounted <${r.mountedTag}>` : ''}`)
    // ── boot ──
    await mark('boot'); await page.waitForTimeout(BOOT_MS)
    // ── idle (+ optional CPU profile) ──
    await mark('idle')
    if (cdp && PROFILE) await cdp.send('Profiler.start')
    await page.waitForTimeout(IDLE_MS)
    if (cdp && PROFILE) { const { profile } = await cdp.send('Profiler.stop'); r.profile = aggregateProfile(profile) }
    // ── interaction ──
    await mark('interaction')
    const tI = Date.now()
    const box = r.canvasBox
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    const drag = async (dx, dy) => { await page.mouse.move(cx, cy); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(cx + dx * i / 12, cy + dy * i / 12); await page.mouse.up() }
    await drag(220, 40); await page.waitForTimeout(700)
    await drag(-180, -90); await page.waitForTimeout(700)
    await page.mouse.move(cx + 40, cy - 30)
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -160); await page.waitForTimeout(450) }
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 160); await page.waitForTimeout(450) }
    await drag(120, -60); await page.waitForTimeout(600)
    r.clicked.push('drag×3', 'wheel×6')
    for (const h of (await deepHandles(page, '.stl-rows .stl-row')).slice(0, 2)) {
      const label = await h.evaluate(el => (el.querySelector('.stl-name') || el).textContent.trim().slice(0, 24)).catch(() => '?')
      const ok = await h.click({ timeout: 3000 }).then(() => true).catch(() => false)
      r.clicked.push(`legend-row:${label}${ok ? '' : ' (click failed)'}`); await page.waitForTimeout(1400)
    }
    let tabsClicked = 0
    for (const h of await deepHandles(page, '.rm-tab-bar .rm-tab')) {
      if (tabsClicked >= 2) break
      const info = await h.evaluate(el => ({ label: el.textContent.trim().slice(0, 24), active: el.classList.contains('active') })).catch(() => null)
      if (!info || info.active) continue
      const ok = await h.click({ timeout: 3000 }).then(() => true).catch(() => false)
      r.clicked.push(`tab:${info.label}${ok ? '' : ' (click failed)'}`); tabsClicked++; await page.waitForTimeout(1500)
    }
    const rest = INTERACT_MS - (Date.now() - tI)
    if (rest > 0) await page.waitForTimeout(rest)
    await mark('done')
    // ── collect ──
    const S = await page.evaluate(() => { const s = window.__lfp; return { loafSupported: s.loafSupported, longtaskSupported: s.longtaskSupported, phases: s.phases, draws: s.draws, ticks: s.ticks } })
    r.loafSupported = S.loafSupported; r.longtaskSupported = S.longtaskSupported
    for (const name of ['boot', 'idle', 'interaction']) {
      const b = S.phases[name] || { raf: [], loaf: [], longtask: [], frames: 0, rendered: 0 }
      const v = violations.filter(x => x.phase === name)
      const durationMs = name === 'boot' ? BOOT_MS : name === 'idle' ? IDLE_MS : INTERACT_MS
      const loafLike = S.loafSupported ? b.loaf : b.longtask
      // LoAF scripts, merged by (invoker/function, source) — who kept asking for the frames
      const attrib = new Map()
      for (const e of b.loaf) for (const s of (e.scripts || [])) { const k = `${s.invoker || s.fn || '?'}${s.src ? ` ${s.src}` : ''}`; const a = attrib.get(k) || { key: k, frames: 0, ms: 0 }; a.frames++; a.ms += s.ms; attrib.set(k, a) }
      r.phases[name] = {
        durationMs, frames: b.frames, rendered: b.rendered,
        raf: { count: b.raf.length, worstMs: b.raf.length ? Math.max(...b.raf.map(x => x.ms)) : 0, overBudgetMs: Math.round(b.raf.reduce((s, x) => s + (x.ms - 1000 / 60), 0)) },
        loaf: { source: S.loafSupported ? 'long-animation-frame' : S.longtaskSupported ? 'longtask' : null, count: loafLike.length, worstMs: loafLike.length ? Math.max(...loafLike.map(x => x.ms)) : 0,
          blockingMs: Math.round(loafLike.reduce((s, x) => s + (x.blocking ?? Math.max(0, x.ms - 50)), 0)), attribution: [...attrib.values()].sort((a, b) => b.ms - a.ms).slice(0, 6) },
        violations: { count: v.length, worstMs: v.length ? Math.max(...v.map(x => x.ms || 0)) : 0, source: isChromium ? 'CDP Log violation report + console' : 'console only (Chromium-only message)' },
        samples: { raf: b.raf.slice(0, 400), loaf: b.loaf.slice(0, 200), longtask: b.longtask.slice(0, 200) },
      }
    }
    r.totalDraws = S.draws
  } catch (e) {
    r.setupError = 'exception: ' + String(e.message || e).slice(0, 200)
  } finally {
    if (cdp) await cdp.detach().catch(() => {})
    await page.close(); await ctx.close()
  }
  return r
}

// ── output ───────────────────────────────────────────────────────────────────
const longCount = (p, r) => (r.loafSupported || r.longtaskSupported) ? p.loaf.count : p.raf.count
const line = (r, name, p) => {
  const over = name === 'idle' && longCount(p, r) > MAX_IDLE
  console.log(`${name === 'idle' ? (over ? '✗' : '✓') : '·'} ${(r.mountedTag || r.tag || r.label).padEnd(19)} ${name.padEnd(11)} ${String(p.durationMs / 1000).padStart(2)}s  frames:${String(p.frames).padStart(4)} rendered:${String(p.rendered).padStart(4)}  rAF>${THRESHOLD}: ${String(p.raf.count).padStart(4)} (worst ${String(Math.round(p.raf.worstMs)).padStart(4)}ms, +${String(p.raf.overBudgetMs).padStart(5)}ms over budget)  ${p.loaf.source ? `LoAF: ${String(p.loaf.count).padStart(4)} (worst ${String(p.loaf.worstMs).padStart(4)}ms, blocking ${String(p.loaf.blockingMs).padStart(5)}ms)` : 'LoAF: n/a'.padEnd(46)}  violations: ${String(p.violations.count).padStart(4)}${p.violations.worstMs ? ` (worst ${p.violations.worstMs}ms)` : ''}`)
  if (p.loaf.attribution.length) console.log(`      LoAF scripts: ${p.loaf.attribution.slice(0, 4).map(a => `${a.key} ×${a.frames} ${Math.round(a.ms)}ms`).join(' · ')}`)
}
const results = []
for (const t of targets) {
  console.log(`\n▶ ${t.label}  <${t.tag || '?'}>  ${t.url}`)
  const r = await probe(t)
  if (r.setupError) { console.log(`✗ ${r.tag || r.label}  SETUP  ${r.setupError}`); results.push(r); continue }
  for (const name of ['boot', 'idle', 'interaction']) line(r, name, r.phases[name])
  if (r.clicked.length) console.log(`      interaction: ${r.clicked.join(', ')}`)
  if (r.profile) {
    const pr = r.profile
    console.log(`      CPU profile (idle, ${pr.sampledMs}ms sampled) self-time by group: ${Object.entries(pr.byGroupSelfMs).sort((a, b) => b[1] - a[1]).map(([g, ms]) => `${g} ${ms}ms`).join(' · ')}`)
    console.log(`      top self (← callers):`); for (const x of pr.topSelf) console.log(`        ${String(x.selfMs).padStart(6)}ms self ${String(x.totalMs).padStart(6)}ms total  ${x.frame}${x.callers.length ? `\n${' '.repeat(38)}← ${x.callers.map(c => `${c.frame} ${c.ms}ms`).join(' · ')}` : ''}`)
    console.log(`      top app frames (by total):`); for (const x of pr.topApp) console.log(`        ${String(x.selfMs).padStart(6)}ms self ${String(x.totalMs).padStart(6)}ms total  ${x.frame}`)
  }
  if (r.consoleErrors.length || r.pageErrors.length) console.log(`      ${r.consoleErrors.length} console error(s), ${r.pageErrors.length} page error(s)${r.pageErrors[0] ? ` — ${r.pageErrors[0]}` : ''}`)
  results.push(r)
}
await browser.close()

const setupFails = results.filter(r => r.setupError)
const overIdle = results.filter(r => !r.setupError && longCount(r.phases.idle, r) > MAX_IDLE)
console.log(`\n[${TOOL}] ${results.length} target(s) · ${overIdle.length} with > ${MAX_IDLE} idle long frame(s) · ${setupFails.length} setup failure(s)`)
if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true })
  writeFileSync(JSON_OUT, JSON.stringify({
    tool: TOOL, generatedAt: new Date().toISOString(), base: BASE, browser: BROWSER, viewport: VIEWPORT,
    options: { threshold: THRESHOLD, boot: BOOT_MS, idle: IDLE_MS, interact: INTERACT_MS, wait: WAIT, profile: PROFILE, maxIdle: MAX_IDLE },
    method: 'init script: PerformanceObserver long-animation-frame (fallback longtask) + rAF-delta sampler (> threshold) + WebGL draw-call counter (rendered = frames with draws); Chromium: CDP Log.startViolationsReport(recurringHandler ≥ threshold) entries matching /requestAnimationFrame/ = the DevTools "[Violation] requestAnimationFrame handler took" lines; --profile: CDP Profiler @0.5ms during idle, self/total ms per function@file:line; observations bucketed by the phase they started in',
    passRule: `idle long frames (LoAF where supported, else rAF-delta) ≤ ${MAX_IDLE} per target`,
    pass: !overIdle.length && !setupFails.length, results,
  }, null, 2))
  console.log(`[${TOOL}] report → ${JSON_OUT}`)
}
if (setupFails.length) { console.log('SETUP FAILED:'); setupFails.forEach(r => console.log(`  ✗ ${r.label} — ${r.setupError}`)); process.exit(2) }
if (overIdle.length) { console.log('IDLE LONG FRAMES:'); overIdle.forEach(r => console.log(`  ✗ ${r.mountedTag || r.label} — ${longCount(r.phases.idle, r)} long frame(s) in ${IDLE_MS / 1000}s idle (worst ${Math.max(r.phases.idle.loaf.worstMs, r.phases.idle.raf.worstMs)}ms, ${r.phases.idle.rendered} rendered frames, ${r.phases.idle.violations.count} violations)`)); process.exit(1) }
