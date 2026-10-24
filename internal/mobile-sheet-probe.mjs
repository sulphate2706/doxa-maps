#!/usr/bin/env node
/**
 * mobile-sheet-probe.mjs — REPRODUCE, with numbers, the two reported mobile bugs
 * of the legend bottom sheet (library/components/legends/LegendMobile.vue), on a phone
 * viewport, through the real touch pipeline:
 *
 *   BUG A  "when you click on a people group … moving the informational page up and
 *          down in size has bugs" — the sheet must FOLLOW the finger during a resize
 *          drag (no lag / snap-back mid-drag), snap to the right ladder step on release
 *          (detail mode: open 30% ↔ fullyOpen), never climb over the top reserve where
 *          the search pill lives, keep the detail close X reachable, and re-expand from
 *          the collapsed footer on a tap.
 *   BUG B  the sheet covers Mapbox's bottom-left logo / attribution — the audit here is
 *          a rect×rect overlap of the sheet against .mapboxgl-ctrl-bottom-left/-right
 *          (their VISIBLE children) in every sheet state.
 *
 * WHY: a sense that the sheet feels wrong on a phone is not evidence a fix can be checked against. This
 * probe turns the gesture into a per-step table (finger delta vs measured sheet height),
 * the release into an expected/actual state, and the attribution into overlap px² —
 * run it BEFORE a fix (baseline json) and AFTER (same json shape) and diff.
 *
 * HOW: Firefox (house rule: never Google Chrome) via internal/lib/browser.mjs, a MOBILE
 * context (390×844, isMobile, hasTouch, dpr 2). The page is any host page carrying the
 * custom element (--tag): the website dev server (the BUILT drop-in) or the bundler's
 * standalone dev page (live edits, Vite HMR). The element is scrolled into view, its
 * shadow root is polled for a WebGL canvas AND the mounted sheet.
 *   Selecting a people group — least hacky path found, in order:
 *     1. a REAL TAP on a rendered pin: Vue's custom element keeps its root component at
 *        host._instance (Vue 3.5 VueElement); ProfileLoader provide()s the instance-scoped
 *        stores there, so host._instance.provides.mapStore.maps[*].instance is the live
 *        Mapbox map (both profiles registerMap). queryRenderedFeatures on the pin layer →
 *        map.project → page.touchscreen.tap → Mapbox 'click' → useMapEvents
 *        attachPinClickHandler → uiStore.selectPeopleGroup. The genuine user path.
 *     2. fallback (no pin in the clear middle of the map, or the tap did not select):
 *        uiStore.selectPeopleGroup(feature) with a feature from dataStore.sources — the
 *        exact call the click handler makes (useMapEvents.js:234).
 *   The drag is synthetic TouchEvents (Touch/TouchEvent constructors work in Firefox with
 *   hasTouch) dispatched on the deepest element under the finger (shadow-aware
 *   elementFromPoint), so they bubble exactly like a real touch: touchstart on the drag
 *   strip, N touchmoves of --step px, touchend. After every move the sheet's
 *   offsetHeight is read on the next frame and compared with finger position.
 *   A second drag is started on the TITLE region (strip bottom + 18px) to show whether
 *   a finger that misses the 12px strip resizes the sheet or scrolls the content.
 *
 * Usage:  node internal/mobile-sheet-probe.mjs [--url <page>] [--tag doxa-map]
 *           [--nth 0 | --instance <instanceId substring>] [--browser firefox|chromium]
 *           [--wait 30000] [--steps 10] [--step 20] [--json <out.json>] [--shots <dir>]
 *           [--no-select]   skip the people-group selection and check the LEGEND-TAB
 *                           free-drag contract instead (sheet stays where released,
 *                           pull-to-bottom collapses, strip tap re-opens) + overlap audit
 *         Defaults: --url http://localhost:5174/plugin-designs/doxa-simple-map/index.html
 *         --tag doxa-map --nth 0. NOTE the standalone dev page ignores ?profile= (its tabs
 *         are per-bundle, read from localStorage) and renders three stacked <doxa-map>
 *         slots (engagement / prayer / adoption): pick one with --instance dev-prayer.
 *         Website (built drop-in): --url http://localhost:3001/pray --tag doxa-map ·
 *         --url http://localhost:3001/research/ --tag doxa-research-map
 * Exit:   0 every check passed · 1 any check failed (list printed) · 2 setup failure
 *         (no element / no canvas / no sheet / could not select a people group)
 * Never prints token values; --shots saves PNGs only (nothing is read back).
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, TELEMETRY } from './lib/browser.mjs'
import { requireDevServesThisCheckout as __devGuard, requireThisTree as __treeGuard } from './_serves-this-tree.mjs'
import { fileURLToPath as __f2p } from 'node:url'
import { dirname as __dn, resolve as __rs } from 'node:path'
const __ROOT = __rs(__dn(__f2p(import.meta.url)), '..')

const TOOL = 'mobile-sheet-probe'
const args = process.argv.slice(2)
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const URL = String(argOf('--url', 'http://localhost:5174/plugin-designs/doxa-simple-map/index.html'))
// Measure THIS checkout, or measure nothing (exit 75 = NOT MEASURED; see _serves-this-tree.mjs).
await __devGuard(URL, __ROOT, 'MOBILE-SHEET')
const TAG = argOf('--tag', 'doxa-map')
const NTH = Number(argOf('--nth', 0))
const INSTANCE = argOf('--instance', '')
const BROWSER = argOf('--browser', 'firefox')
const WAIT = Number(argOf('--wait', 30000))
const STEPS = Math.max(1, Number(argOf('--steps', 10)))
const STEP = Number(argOf('--step', 20))
const JSON_OUT = argOf('--json', '')
const SHOTS = argOf('--shots', '')
const NO_SELECT = args.includes('--no-select')   // legend-tab free-drag contract instead of the detail ladder
const FOLLOW_TOL = 8          // px — the sheet must track the finger within this
const SETTLE_MS = 450         // > the sheet's 0.3s height transition

const VIEWPORT = { width: 390, height: 844 }

// ── page-side helpers (composed in Node — no eval inside the page) ───────────
// host(): the probed custom element. sheet(): its bottom sheet. Shadow-aware
// elementFromPoint descends through nested open shadow roots.
const HELPERS = `
const host = () => window.__msp_host
const sr = () => host() && host().shadowRoot
// The VISIBLE sheet. In detail mode doxa-simple-map also mounts LegendDesktop (in the
// display:none desktop slot), which mounts a HIDDEN twin LegendMobile that precedes
// the real one in DOM order — a bare querySelector returns that 0×0 twin.
const sheets = () => sr() ? [...sr().querySelectorAll('.legend-mobile-sheet')] : []
const sheet = () => sheets().find(s => s.getClientRects().length && s.offsetHeight > 0) || sheets()[0] || null
const q = (sel) => { const s = sheet(); return s ? s.querySelector(sel) : null }
const provides = () => (host() && host()._instance && host()._instance.provides) || null
const ui = () => (provides() || {}).uiStore || null
const deepFromPoint = (x, y) => { let el = document.elementFromPoint(x, y); while (el && el.shadowRoot) { const n = el.shadowRoot.elementFromPoint(x, y); if (!n || n === el) break; el = n } return el }
const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, top: r.top, bottom: r.bottom, left: r.left, right: r.right } }
const overlap = (a, b) => { if (!a || !b) return 0; const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return (w > 0 && h > 0) ? Math.round(w * h) : 0 }
// bottom control corner: the union of its VISIBLE children (the logo / attribution
// boxes), falling back to the container's own box. An empty corner → null.
const ctrlRect = (sel) => { const c = sr() && sr().querySelector(sel); if (!c) return null; let u = null; for (const ch of c.children) { const cs = getComputedStyle(ch); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = ch.getBoundingClientRect(); if (!r.width || !r.height) continue; u = u ? { left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom } } if (!u) return null; return { x: Math.round(u.left * 100) / 100, y: Math.round(u.top * 100) / 100, w: Math.round((u.right - u.left) * 100) / 100, h: Math.round((u.bottom - u.top) * 100) / 100, top: u.top, bottom: u.bottom, left: u.left, right: u.right, children: c.childElementCount } }
const touch = (type, target, x, y, id) => { const t = new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x + window.scrollX, pageY: y + window.scrollY, screenX: x, screenY: y }); const list = type === 'touchend' || type === 'touchcancel' ? [] : [t]; const ev = new TouchEvent(type, { touches: list, targetTouches: list, changedTouches: [t], bubbles: true, cancelable: true, composed: true }); const notCancelled = target.dispatchEvent(ev); return notCancelled }
const snap = () => { const s = sheet(); const u = ui(); const root = s && s.parentElement; return { sheetCount: sheets().length, legendState: u && u.legendState, legendMode: u && u.legendMode, legendHeight: u && u.legendHeight, selected: !!(u && u.selectedPeopleGroup), sheetH: s ? s.offsetHeight : null, sheetRect: rect(s), containerH: root ? root.offsetHeight : null, containerRect: rect(root), hostRect: rect(host()), transition: s ? getComputedStyle(s).transitionProperty + ' ' + getComputedStyle(s).transitionDuration : null, maxHeight: s ? getComputedStyle(s).maxHeight : null, classes: s ? s.className : null, ctrlBL: ctrlRect('.mapboxgl-ctrl-bottom-left, .maplibregl-ctrl-bottom-left'), ctrlBR: ctrlRect('.mapboxgl-ctrl-bottom-right, .maplibregl-ctrl-bottom-right'), miniImage: rect(sr() && sr().querySelector('.floating-mini-image')), hostVar: host() ? host().style.getPropertyValue('--legend-sheet-h') : null } }
`
const ev = (page, body, arg) => page.evaluate(new Function('arg', `${HELPERS}\nreturn (async () => { ${body} })()`), arg)
const raf = 'await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));'

// ── main ─────────────────────────────────────────────────────────────────────
const browser = await launch(BROWSER, { label: TOOL })
const ctx = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const consoleErrors = [], pageErrors = []
page.on('console', m => { if (m.type() === 'error' && !TELEMETRY.test(m.text())) consoleErrors.push(m.text().slice(0, 240)) })
page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 240)))
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => {}) }

const report = { tool: TOOL, generatedAt: new Date().toISOString(), url: URL, tag: TAG, nth: NTH, instance: INSTANCE || null, browser: BROWSER, viewport: VIEWPORT, steps: STEPS, stepPx: STEP, followTolPx: FOLLOW_TOL, setupError: null, selection: null, states: {}, drags: [], checks: [], consoleErrors, pageErrors }
const checks = report.checks
const check = (id, pass, detail) => { checks.push({ id, pass: !!pass, detail }); console.log(`  ${pass ? '✓' : '✗'} ${id}${detail ? ` — ${detail}` : ''}`); return !!pass }
const fmtRect = (r) => r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}` : 'none'

async function fail(msg) {
  report.setupError = msg
  console.log(`✗ ${TOOL} SETUP: ${msg}`)
  if (JSON_OUT) { mkdirSync(dirname(JSON_OUT), { recursive: true }); writeFileSync(JSON_OUT, JSON.stringify(report, null, 2)) }
  await browser.close(); process.exit(2)
}

// Records the sheet + bottom-control geometry for one named state (BUG B audit).
async function audit(name) {
  const s = await ev(page, `${raf} return snap()`)
  const blOverlap = overlap2(s.sheetRect, s.ctrlBL), brOverlap = overlap2(s.sheetRect, s.ctrlBR)
  report.states[name] = { ...s, overlapBL: blOverlap, overlapBR: brOverlap }
  console.log(`  [${name}] sheets=${s.sheetCount} state=${s.legendState} mode=${s.legendMode} sheet=${fmtRect(s.sheetRect)} (h ${s.sheetH}, legendHeight '${s.legendHeight}') ctrlBL=${fmtRect(s.ctrlBL)} ctrlBR=${fmtRect(s.ctrlBR)} overlapBL=${blOverlap}px² overlapBR=${brOverlap}px² hostVar='${s.hostVar}'`)
  return report.states[name]
}
function overlap2(a, b) { if (!a || !b) return 0; const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return (w > 0 && h > 0) ? Math.round(w * h) : 0 }

// One resize drag: touchstart at (x, y0), STEPS touchmoves of dy each (negative = up),
// touchend. Per step: expected height = clamp(start + finger delta), measured = offsetHeight
// on the next frame. `label` names it; `expectRelease` is the legend state expected after.
async function drag({ label, y0, dy, steps = STEPS, expectRelease, expectHeightPx, offsetX = 0 }) {
  const before = await ev(page, `${raf} return snap()`)
  const x = before.sheetRect.x + before.sheetRect.w / 2 + offsetX
  const startEl = await ev(page, `const el = deepFromPoint(arg.x, arg.y); window.__msp_finger = el; return el ? (el.className && String(el.className).slice(0, 60) || el.tagName) : null`, { x, y: y0 })
  const started = await ev(page, `const el = window.__msp_finger; if (!el) return false; return touch('touchstart', el, arg.x, arg.y, 7)`, { x, y: y0 })
  const rows = []
  let y = y0, maxH = before.sheetH, minTop = before.sheetRect.top
  for (let i = 1; i <= steps; i++) {
    y += dy
    const r = await ev(page, `touch('touchmove', window.__msp_finger, arg.x, arg.y, 7); ${raf} const s = snap(); return { sheetH: s.sheetH, top: s.sheetRect ? s.sheetRect.top : null, legendHeight: s.legendHeight, legendState: s.legendState, transition: s.transition, classes: s.classes }`, { x, y })
    await page.waitForTimeout(40)  // ~real finger cadence; also lets a CSS transition show its lag
    const fingerDelta = -(y - y0)
    const expected = Math.min(Math.max(before.sheetH + fingerDelta, 48), before.containerH)
    rows.push({ step: i, fingerY: y, fingerDelta, sheetH: r.sheetH, deviation: r.sheetH - expected, legendHeight: r.legendHeight, legendState: r.legendState, transition: r.transition })
    if (r.sheetH > maxH) maxH = r.sheetH
    if (r.top < minTop) minTop = r.top
  }
  // read once more after the last move settles (a lagging transition shows here as a jump)
  await page.waitForTimeout(SETTLE_MS)
  const preRelease = await ev(page, `return snap()`)
  await ev(page, `touch('touchend', window.__msp_finger, arg.x, arg.y, 7)`, { x, y })
  await page.waitForTimeout(SETTLE_MS)
  const after = await ev(page, `${raf} return snap()`)
  const d = { label, startEl, started, x, y0, dy, steps, before: { sheetH: before.sheetH, legendState: before.legendState, containerH: before.containerH, transition: before.transition, maxHeight: before.maxHeight }, rows, preRelease: { sheetH: preRelease.sheetH, legendHeight: preRelease.legendHeight }, after: { sheetH: after.sheetH, legendState: after.legendState, legendHeight: after.legendHeight, sheetRect: after.sheetRect }, maxSheetH: maxH, minSheetTop: minTop, expectRelease, expectHeightPx }
  report.drags.push(d)
  console.log(`  drag "${label}" from ${startEl} @y${y0} ${dy > 0 ? '+' : ''}${dy}px×${steps}: ${before.legendState} h${before.sheetH} → per-step h [${rows.map(r => r.sheetH).join(',')}] (deviation [${rows.map(r => r.deviation).join(',')}]) → release: ${after.legendState} h${after.sheetH}`)
  return d
}

try {
  console.log(`[${TOOL}] ${URL}  <${TAG}>${INSTANCE ? ` instance~"${INSTANCE}"` : ` nth ${NTH}`} · ${BROWSER} · ${VIEWPORT.width}×${VIEWPORT.height} touch`)
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 })

  // ── 1. the element ──
  const found = await ev(page, `const els = [...document.querySelectorAll(arg.tag)]; let el = null; if (arg.instance) el = els.find(e => (e.getAttribute('profile-config') || '').includes(arg.instance)) || null; else el = els[arg.nth] || null; if (!el) return { count: els.length }; window.__msp_host = el; el.scrollIntoView({ block: 'start' }); return { count: els.length, defined: !!customElements.get(arg.tag) }`, { tag: TAG, nth: NTH, instance: INSTANCE })
  if (!found.defined && found.count === 0) await fail(`no <${TAG}> on the page (defined: ${found.defined})`)
  if (!(await ev(page, `return !!host()`))) await fail(`<${TAG}> #${INSTANCE || NTH} not found (${found.count} on page)`)

  // ── 2. canvas + sheet + stores + rendered pins ──
  const deadline = Date.now() + WAIT
  let ready = null
  while (Date.now() < deadline) {
    ready = await ev(page, `const p = provides(); const maps = p && p.mapStore && p.mapStore.maps ? Object.values(p.mapStore.maps) : []; const m = maps.find(x => x && x.instance) ? maps.find(x => x && x.instance).instance : null; let pins = 0, layer = null; try { for (const id of ['language-family-pins', 'language-family-pins-hitbox', 'pins']) { if (m && m.getLayer && m.getLayer(id)) { pins = m.queryRenderedFeatures({ layers: [id] }).length; layer = id; if (pins) break } } } catch (_) {} return { canvas: !!(sr() && sr().querySelector('canvas')), sheet: !!sheet(), stores: !!(p && p.uiStore), map: !!m, mapLoaded: !!(m && m.loaded && m.loaded()), pins, layer, breakpoint: p && p.uiStore ? p.uiStore.breakpoint : null }`)
    if (ready.canvas && ready.sheet && ready.stores && ready.map && ready.pins > 0) break
    await page.waitForTimeout(300)
  }
  console.log(`  ready: canvas=${ready.canvas} sheet=${ready.sheet} stores=${ready.stores} map=${ready.map} loaded=${ready.mapLoaded} renderedPins=${ready.pins} (${ready.layer}) breakpoint=${ready.breakpoint}`)
  if (!ready.canvas) await fail(`no WebGL canvas in <${TAG}> within ${WAIT}ms`)
  if (!ready.sheet) await fail(`no .legend-mobile-sheet mounted within ${WAIT}ms (viewport ${VIEWPORT.width}px should hit the mobile @media slot)`)
  if (!ready.stores) await fail('host._instance.provides.uiStore missing — Vue custom element internals changed?')
  await page.waitForTimeout(800)   // let the pins' first paint + any boot transitions settle
  await shot('01-initial')
  const s0 = await audit('collapsed-initial')

  // ── 3'. --no-select: the NON-detail (legend tab) free-drag contract instead ──
  // qa 2026-05-03: a legend tab is free-drag — the sheet stays where it is released
  // (no snap to fullyOpen); only a pull to the bottom collapses it; a strip tap re-opens.
  if (NO_SELECT) {
    if (s0.legendState === 'collapsed') { const st = await ev(page, `return rect(q('.sheet-drag-strip'))`); await page.touchscreen.tap(st.x + st.w / 2, st.y + st.h / 2); await page.waitForTimeout(SETTLE_MS) }
    const sO = await audit('legend-open')
    check('L0.legend-open', sO.legendState === 'open' && sO.legendMode !== 'detail', `legendState=${sO.legendState} mode=${sO.legendMode} h=${sO.sheetH}`)
    const st1 = await ev(page, `const st = q('.sheet-drag-strip'); return { rect: rect(st), h: st.offsetHeight }`)
    const dU = await drag({ label: 'legend-up-200-from-strip', y0: st1.rect.y + st1.h / 2, dy: -STEP, expectRelease: 'open' })
    const worst = Math.max(...dU.rows.map(r => Math.abs(r.deviation)))
    check('L1.follows-finger-up', worst <= FOLLOW_TOL, `worst deviation ${worst}px; per-step h [${dU.rows.map(r => r.sheetH).join(',')}]`)
    check('L2.free-drag-stays', dU.after.legendState === 'open' && Math.abs(dU.after.sheetH - dU.rows[dU.rows.length - 1].sheetH) <= FOLLOW_TOL, `released at h${dU.rows[dU.rows.length - 1].sheetH} → state ${dU.after.legendState} h${dU.after.sheetH} (must stay, not snap to fullyOpen)`)
    const sL = await audit('legend-custom')
    const st2 = await ev(page, `const st = q('.sheet-drag-strip'); return { rect: rect(st), h: st.offsetHeight }`)
    const downPx = Math.ceil((sL.sheetH - sL.containerH * 0.3 * 0.5 + 20) / 10)
    const dD = await drag({ label: 'legend-down-to-bottom', y0: st2.rect.y + st2.h / 2, dy: +downPx, steps: 10, expectRelease: 'collapsed' })
    check('L3.pull-to-bottom-collapses', dD.after.legendState === 'collapsed' && dD.after.sheetH === 48, `state ${dD.after.legendState} h${dD.after.sheetH}`)
    const sC = await audit('legend-collapsed')
    const st3 = await ev(page, `return rect(q('.sheet-drag-strip'))`)
    await page.touchscreen.tap(st3.x + st3.w / 2, st3.y + st3.h / 2); await page.waitForTimeout(SETTLE_MS)
    const sR = await ev(page, `${raf} return snap()`)
    check('L4.strip-tap-reopens', sR.legendState === 'open', `state ${sR.legendState} h${sR.sheetH}`)
    for (const [name, s] of [['collapsed-initial', s0], ['legend-open', sO], ['legend-custom', sL], ['legend-collapsed', sC]]) {
      if (s.ctrlBL) check(`B.ctrlBL-at-map-bottom@${name}`, s.containerRect.bottom - s.ctrlBL.bottom <= 62, `sheet ${fmtRect(s.sheetRect)} × ctrlBL ${fmtRect(s.ctrlBL)} = ${s.overlapBL}px² (host --legend-sheet-h ${s.hostVar || 'unset'})`)
    }
    throw { done: true }
  }

  // ── 3. select a people group ──
  const sel = { method: null, tapPoint: null, name: null, attempts: [] }
  // 3a. real tap on a pin sitting in the CLEAR part of the map (not under the search
  //     pill / toolbar / sheet / edge strips). Try a few, nearest to the centre first.
  const cands = await ev(page, `const p = provides(); const m = Object.values(p.mapStore.maps).map(x => x.instance).find(Boolean); if (!m) return []; const c = sr().querySelector('canvas').getBoundingClientRect(); const sh = sheet().getBoundingClientRect(); const seen = new Set(); const out = []; for (const id of ['language-family-pins-hitbox', 'language-family-pins']) { if (!m.getLayer(id)) continue; for (const f of m.queryRenderedFeatures({ layers: [id] })) { const uid = f.properties && f.properties.uniqueId; if (!uid || seen.has(uid)) continue; seen.add(uid); const pt = m.project(f.geometry.coordinates); const x = c.left + pt.x, y = c.top + pt.y; if (x < c.left + 60 || x > c.right - 60 || y < c.top + 130 || y > sh.top - 40) continue; out.push({ x, y, uid, name: f.properties.name || f.properties.peopleGroup || '' }) } } const cx = c.left + c.width / 2, cy = (c.top + 130 + sh.top - 40) / 2; out.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)); return out.slice(0, 6)`)
  for (const cnd of cands) {
    const under = await ev(page, `const el = deepFromPoint(arg.x, arg.y); return el ? (el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '')) : null`, cnd)
    if (!/canvas/i.test(under || '')) { sel.attempts.push({ ...cnd, skipped: `covered by ${under}` }); continue }
    await page.touchscreen.tap(cnd.x, cnd.y)
    await page.waitForTimeout(700)
    const st = await ev(page, `return snap()`)
    sel.attempts.push({ ...cnd, under, legendMode: st.legendMode, legendState: st.legendState })
    if (st.legendMode === 'detail' && st.selected) { sel.method = 'real-tap-on-pin (page.touchscreen.tap → Mapbox click → attachPinClickHandler)'; sel.tapPoint = { x: Math.round(cnd.x), y: Math.round(cnd.y) }; sel.name = cnd.name; break }
  }
  // 3b. fallback: the store call the click handler makes
  if (!sel.method) {
    const r = await ev(page, `const p = provides(); let f = null; for (const id in (p.dataStore.sources || {})) { const feats = p.dataStore.sources[id].features || []; f = feats.find(x => x && x.geometry && x.properties && x.properties.uniqueId) || null; if (f) break } if (!f) return { ok: false }; p.uiStore.selectPeopleGroup(f); if (p.uiStore.isMobile && p.uiStore.legendState === 'collapsed') p.uiStore.setLegendState('open'); return { ok: true, name: f.properties.name || '' }`)
    if (r.ok) { await page.waitForTimeout(SETTLE_MS); sel.method = 'store-call uiStore.selectPeopleGroup(feature) (fallback — same call as useMapEvents.js:234)'; sel.name = r.name }
  }
  report.selection = sel
  if (!sel.method) await fail(`could not select a people group (${sel.attempts.length} pin taps tried, no dataStore feature)`)
  console.log(`  selected "${sel.name}" via ${sel.method}`)
  await page.waitForTimeout(SETTLE_MS)
  await shot('02-detail-open')
  const sOpen = await audit('detail-open')
  check('A0.detail-mode-open', sOpen.legendMode === 'detail' && sOpen.legendState === 'open', `legendMode=${sOpen.legendMode} legendState=${sOpen.legendState} h=${sOpen.sheetH} (30% of ${sOpen.containerH} = ${Math.round(sOpen.containerH * 0.3)})`)
  const strip = await ev(page, `const st = q('.sheet-drag-strip'); return { rect: rect(st), h: st ? st.offsetHeight : null }`)
  report.dragStrip = strip
  const closeOpen = await ev(page, `const b = q('.detail-close-btn'); if (!b) return { present: false }; const r = b.getBoundingClientRect(); const hit = deepFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { present: true, rect: rect(b), hit: hit ? (hit === b || b.contains(hit)) : false, inHost: r.top >= host().getBoundingClientRect().top && r.bottom <= host().getBoundingClientRect().bottom }`)
  report.states['detail-open'].closeX = closeOpen
  check('A1.closeX-reachable-open', closeOpen.present && closeOpen.hit && closeOpen.inHost, `rect ${fmtRect(closeOpen.rect)} hit=${closeOpen.hit}`)

  // ── 4. BUG A — drag UP from the drag strip ──
  console.log(`  drag strip: ${fmtRect(strip.rect)} (height ${strip.h}px) · sheet transition: ${sOpen.transition} · CSS max-height: ${sOpen.maxHeight} · JS clamp (container−56): ${sOpen.containerH - 56} vs CSS (container−80): ${sOpen.containerH - 80}`)
  const topReserve = 80
  const dUp = await drag({ label: 'up-200-from-strip', y0: strip.rect.y + strip.h / 2, dy: -STEP, expectRelease: 'fullyOpen' })
  const worstUp = Math.max(...dUp.rows.map(r => Math.abs(r.deviation)))
  check('A2.follows-finger-up', worstUp <= FOLLOW_TOL, `worst deviation ${worstUp}px (tol ±${FOLLOW_TOL}); per-step h [${dUp.rows.map(r => r.sheetH).join(',')}]`)
  const monotonic = dUp.rows.every((r, i) => i === 0 || r.sheetH >= dUp.rows[i - 1].sheetH - 1)
  check('A3.no-snap-back-mid-drag', monotonic, monotonic ? 'height never decreased during the upward drag' : `heights [${dUp.rows.map(r => r.sheetH).join(',')}]`)
  check('A4.release-up→fullyOpen', dUp.after.legendState === 'fullyOpen', `legendState=${dUp.after.legendState} h=${dUp.after.sheetH} (expected ${sOpen.containerH - topReserve})`)
  check('A5.sheet-top-reserve', dUp.minSheetTop >= sOpen.containerRect.top + 56 - 0.5, `min sheet top ${Math.round(dUp.minSheetTop - sOpen.containerRect.top)}px below container top (search pill occupies 10..45px)`)
  await shot('03-fullyOpen')
  const sFull = await audit('detail-fullyOpen')
  const closeFull = await ev(page, `const b = q('.detail-close-btn'); if (!b) return { present: false }; const r = b.getBoundingClientRect(); const hit = deepFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { present: true, rect: rect(b), hit: hit ? (hit === b || b.contains(hit)) : false }`)
  sFull.closeX = closeFull
  check('A6.closeX-reachable-fullyOpen', closeFull.present && closeFull.hit, `rect ${fmtRect(closeFull.rect)} hit=${closeFull.hit}`)

  // ── 5. drag DOWN 150 from fullyOpen → open ──
  const strip2 = await ev(page, `return rect(q('.sheet-drag-strip'))`)
  const dDown = await drag({ label: 'down-150-from-strip', y0: strip2.y + strip.h / 2, dy: +15, steps: 10, expectRelease: 'open' })
  const worstDown = Math.max(...dDown.rows.map(r => Math.abs(r.deviation)))
  check('A7.follows-finger-down', worstDown <= FOLLOW_TOL, `worst deviation ${worstDown}px; per-step h [${dDown.rows.map(r => r.sheetH).join(',')}]`)
  check('A8.release-down→open', dDown.after.legendState === 'open', `legendState=${dDown.after.legendState} h=${dDown.after.sheetH} (30% = ${Math.round(sOpen.containerH * 0.3)})`)
  await shot('04-open-again')

  // ── 6. drag DOWN again from open → collapsed ──
  const strip3 = await ev(page, `return rect(q('.sheet-drag-strip'))`)
  const dDown2 = await drag({ label: 'down-100-from-open', y0: strip3.y + strip.h / 2, dy: +10, steps: 10, expectRelease: 'collapsed' })
  check('A9.release-down→collapsed', dDown2.after.legendState === 'collapsed', `legendState=${dDown2.after.legendState} h=${dDown2.after.sheetH}`)
  await shot('05-collapsed-detail')
  const sCol = await audit('detail-collapsed')

  // ── 7. tap the collapsed footer → open ──
  const footer = await ev(page, `return rect(q('.collapsed-detail-footer'))`)
  if (footer) { await page.touchscreen.tap(footer.x + footer.w / 2, footer.y + footer.h / 2); await page.waitForTimeout(SETTLE_MS) }
  const sReopen = await ev(page, `${raf} return snap()`)
  check('A10.footer-tap-reexpands', !!footer && sReopen.legendState === 'open', `footer ${fmtRect(footer)} → legendState=${sReopen.legendState} h=${sReopen.sheetH}`)
  await shot('06-reopened')

  // ── 8. a finger that misses the 12px strip: drag from the TITLE region ──
  // (strip bottom + 18px — where a thumb naturally lands on the header). Before the
  // fix this scrolls the content instead of resizing; the row is informational
  // (A11) and becomes a hard check once the grab surface is widened.
  const strip4 = await ev(page, `return rect(q('.sheet-drag-strip'))`)
  const dTitle = await drag({ label: 'up-200-from-title-region', y0: strip4.y + strip4.h + 18, dy: -STEP, expectRelease: 'fullyOpen' })
  const titleResized = dTitle.after.sheetH > sReopen.sheetH + FOLLOW_TOL
  check('A11.title-region-drag-resizes', titleResized, `start element ${dTitle.startEl} → ${dTitle.after.legendState} h${dTitle.after.sheetH} (was h${sReopen.sheetH})`)
  const sFull2 = await audit('detail-fullyOpen-2')
  // restore to open for the final overlap audit at 30%
  await ev(page, `ui().openLegend()`); await page.waitForTimeout(SETTLE_MS)
  const sOpen2 = await audit('detail-open-2')

  // ── 9. BUG B — bottom controls must never sit under the sheet ──
  const audits = [['collapsed-initial', s0], ['detail-open', sOpen], ['detail-fullyOpen', sFull], ['detail-collapsed', sCol], ['detail-fullyOpen-2', sFull2], ['detail-open-2', sOpen2]]
  const hasBL = audits.some(([, s]) => s.ctrlBL), hasBR = audits.some(([, s]) => s.ctrlBR)
  for (const [name, s] of audits) {
    if (s.ctrlBL) check(`B.ctrlBL-at-map-bottom@${name}`, s.containerRect.bottom - s.ctrlBL.bottom <= 62, `sheet ${fmtRect(s.sheetRect)} × ctrlBL ${fmtRect(s.ctrlBL)} = ${s.overlapBL}px²${s.hostVar ? ` (host --legend-sheet-h ${s.hostVar})` : ''}`)
    if (s.ctrlBR) check(`B.ctrlBR-at-map-bottom@${name}`, s.containerRect.bottom - s.ctrlBR.bottom <= 62, `sheet ${fmtRect(s.sheetRect)} × ctrlBR ${fmtRect(s.ctrlBR)} = ${s.overlapBR}px²`)
    if (s.ctrlBL) check(`B.ctrlBL-inside-map@${name}`, s.ctrlBL.top >= s.containerRect.top && s.ctrlBL.bottom <= s.containerRect.bottom, `ctrlBL y ${Math.round(s.ctrlBL.y)}..${Math.round(s.ctrlBL.bottom)} within container ${Math.round(s.containerRect.top)}..${Math.round(s.containerRect.bottom)}`)
    // the floating mini photo (detail mode at 30%) must not cover a lifted logo either
    if (s.ctrlBL && s.miniImage && s.miniImage.h > 0) check(`B.no-overlap-miniImage×BL@${name}`, overlap2(s.miniImage, s.ctrlBL) === 0, `mini ${fmtRect(s.miniImage)} × ctrlBL ${fmtRect(s.ctrlBL)} = ${overlap2(s.miniImage, s.ctrlBL)}px²`)
  }
  if (!hasBL && !hasBR) console.log('  (no visible bottom-left/right control children on this instance — a 2nd+ map on the page hides its logo via claimLogo; probe the FIRST map for the attribution audit)')
  report.bottomControls = { visibleBL: hasBL, visibleBR: hasBR }
} catch (e) {
  if (!(e && e.done)) await fail('exception: ' + String(e.stack || e.message || e).slice(0, 600))
}

await browser.close()
const failed = checks.filter(c => !c.pass)
report.pass = failed.length === 0
console.log(`\n[${TOOL}] ${checks.length - failed.length}/${checks.length} checks pass · selection: ${NO_SELECT ? 'n/a (--no-select)' : report.selection?.method}${consoleErrors.length ? ` · ${consoleErrors.length} console error(s)` : ''}${pageErrors.length ? ` · ${pageErrors.length} page error(s)` : ''}`)
if (JSON_OUT) { mkdirSync(dirname(JSON_OUT), { recursive: true }); writeFileSync(JSON_OUT, JSON.stringify(report, null, 2)); console.log(`[${TOOL}] report → ${JSON_OUT}`) }
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(`  ✗ ${f.id} — ${f.detail}`)); process.exit(1) }
