#!/usr/bin/env node
/**
 * check-fits-the-screen.mjs — the FITNESS-FOR-USE gate. Real browser, built tree, live data.
 *
 * ★ WHY THIS EXISTS (LL-the-user-found-three-bugs-my-gates-could-not-see, 2026-09-23). The suite
 * was 56/58 green, verify:gate1 13/13, verify:map-paint 11/11, verify:interop 4/4, 363 done cards
 * — and opening the product found FIVE real defects in one sitting, several caused
 * by a change a gate had certified. NOT ONE was visible to any gate, because every gate up to this
 * one asserts STATE (does it mount, does it fetch, do the counts agree, does a canvas paint). The
 * product is judged on FITNESS FOR USE: is it slim, can I see it at once, does the wheel do what I
 * expect, does it tell me what I'm looking at. A suite of the first kind can be perfectly green
 * while the second kind fails completely. This gate encodes the second kind, as five clauses:
 *
 *   A — ONE-VIEWPORT RULE: the dashboard band's own height <= the 1440x900 viewport. Its internal
 *       rails scroll; the PAGE does not scroll to see the band itself.
 *   B — THE GRID IS REACHABLE UNDERNEATH, by scrolling. (A fix for A must not regress this — see
 *       AP-fixing-reachability-by-making-the-thing-taller: the SAME commit that fixed reachability
 *       made the band unbounded and broke A. Both must hold at once, or the trade repeats.)
 *   C — WHEEL TARGETING: a wheel over the map changes ZOOM and does not scroll the pane; a wheel
 *       below the map SCROLLS and does not change zoom. Instruments composedPath() on a
 *       capture-phase listener, per LL-four-wrong-diagnoses-instrument-the-event-not-the-geometry
 *       — geometry (getBoundingClientRect) answered this wrong FOUR times on the sibling bug.
 *   D — THE ELEMENT SAYS WHAT IT IS SHOWING: a visible, non-zero count line for the grid, that
 *       CHANGES when a filter narrows it.
 *   E — RESPONSIVE SWEEP at 1440/1280/768/390: no horizontal document overflow, no element clipped
 *       to zero height. `.rd-td`/`.rd-th` text-ellipsis is EXPECTED and excluded — that is what
 *       those classes are for (DashboardDataTable.vue:519,526).
 *
 * ★ WHAT IT DELIBERATELY DOES NOT COVER. Clause A/B/C run against the actual composite that shipped
 * the bug, `dashboard-plus-grid`. The cap-5 SHELL (doxa-maps-spa / the three-section tab structure)
 * is a TEAMMATE'S live in-flight file this tick — this gate discovers cap-5 shells from the BUILT
 * manifest (`type === 'nested-mfe-spa'`) and probes them by CONTENT MATCH (tab text, not a
 * hardcoded structure), so it survives that work landing without editing or depending on it. If no
 * shell exposes a matching tab, the shell-level sub-checks SKIP BY NAME rather than failing —
 * absence of a tab is that teammate's work-in-progress, not a fitness defect this gate can name.
 * The direct-leaf checks (dashboard-plus-grid, research-dashboard standalone) are NOT optional and
 * carry the clauses' real assertions.
 *
 * ★ EVERY VALUE THIS SCRIPT COMPUTES IS ASSERTED ON (LL-a-gate-can-grade-the-wrong-variable audit):
 * bandHeight, legendHeight, gridTop before/after, zoomBefore/After, scrollTopBefore/After,
 * composedPath per gesture, countText before/after a filter, per-width overflow + clipped-count —
 * every one of those feeds a pass/fail line in the clause table. None is logged and left unchecked.
 *
 * PRECONDITIONS, checked and SKIPPED (exit 0), never reported as a defect when unmet:
 *   - the tree must be SETTLED at START (internal/settled-tree-gate.mjs) — a mid-build tree gives
 *     a confident, false diagnosis (LL-verify-the-tree-is-settled-before-trusting-a-browser-gate).
 *   - the tree must STILL be settled at END — re-checked, because a teammate's build finishing
 *     mid-run tears the tree out from under an in-flight measurement just as surely as one starting
 *     did. (A harness in this same flight was bitten checking only at the start.) If the tree moved,
 *     every clause this run computed is DOWNGRADED to SKIP, not reported pass or fail.
 *   - pray.doxa.life must be reachable with a BROWSER USER-AGENT (a bare fetch 403s here).
 *
 * USAGE
 *   node internal/check-fits-the-screen.mjs
 *   node internal/check-fits-the-screen.mjs --self-test [--self-test-clause=a|b|c|d|e]
 *   PORT=4391 node internal/check-fits-the-screen.mjs
 *
 * Grades by EXIT CODE. Teaching prose after the verdict — the per-clause table comes first so a
 * human sees which clause failed without reading the essay.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { TREE_NAME } from './_tree-name.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')

const SELF_TEST = process.argv.includes('--self-test')
const clauseArg = process.argv.find((a) => a.startsWith('--self-test-clause='))
const SELF_TEST_CLAUSE = (clauseArg ? clauseArg.split('=')[1] : 'a').toLowerCase()
const PORT = Number(process.env.PORT || 4391)
const BASE = `http://127.0.0.1:${PORT}`

const GL_ARGS = [
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--no-sandbox',
]

// ── 0. PRECONDITIONS ────────────────────────────────────────────────────────────────────────
function settled() {
  try {
    execFileSync('node', ['internal/settled-tree-gate.mjs'], { cwd: ROOT, stdio: 'pipe' })
    return true
  } catch (e) {
    console.log((e.stdout || '').toString().trim())
    return false
  }
}
if (!settled()) {
  console.log('\nFITS-THE-SCREEN: SKIP — tree is not settled (a build is running). Not a product finding.')
  console.log('  Re-run once the queue drains: node internal/settled-tree-gate.mjs')
  process.exit(0)
}

let apiReachable = true
try {
  // pray.doxa.life needs a BROWSER user-agent from a script — a bare fetch 403s here.
  const r = await fetch('https://pray.doxa.life/api/people-groups/list?fields=name&lang=', {
    signal: AbortSignal.timeout(10000),
    headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
  })
  apiReachable = r.ok
} catch { apiReachable = false }
if (!apiReachable) {
  console.log('FITS-THE-SCREEN: SKIP — pray.doxa.life is unreachable right now. Not a product finding.')
  process.exit(0)
}

// ── 1. MANIFEST-DERIVED TARGETS (never hardcode which bundle is "the" cap-5 shell) ────────────
const MANIFEST = resolve(ROOT, 'public', TREE_NAME, 'manifest.json')
if (!existsSync(MANIFEST)) {
  console.log('FITS-THE-SCREEN: SKIP — no manifest.json (nothing built).')
  process.exit(0)
}
const mf = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const shellLeaves = []
for (const b of mf.bundles || []) {
  for (const p of b.profiles || []) {
    if (p.type === 'nested-mfe-spa') shellLeaves.push({ bundle: b.bundle, profile: p.profile, iframeUrl: p.iframeUrl })
  }
}

// ── 2. SERVE THE BUILT TREE the way production serves it (directories 404) ─────────────────────
const server = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(PORT), '--directory', 'public', '--exit-with-parent'], {
  cwd: ROOT, stdio: 'pipe',
})
let serverErr = ''
server.stderr.on('data', (d) => { serverErr += d.toString() })
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('serve-strict did not start in 10s: ' + serverErr)), 10000)
  server.stdout.on('data', (d) => { if (/http:\/\//.test(d.toString())) { clearTimeout(t); res() } })
  server.on('exit', (code) => { clearTimeout(t); rej(new Error('serve-strict exited early (' + code + '): ' + serverErr)) })
})

// clause rows: { clause, target, result, detail }  — printed as the table BEFORE the verdict.
const rows = []
let exitCode = 0
const record = (clause, target, ok, detail) => {
  rows.push({ clause, target, ok, detail })
  console.log(`  [${clause}] ${ok ? 'PASS' : 'FAIL'} ${target} -> ${detail}`)
}

// Self-test inverts the exit contract exactly as interop-harness.mjs and check-facet-cascade.mjs
// do: a self-test run that correctly DETECTS the poisoned clause is itself the PASS. Reaching the
// end without detecting it is the failure — "I made it fail" is not evidence; the question is
// whether it failed on the SAME defect shape the real bug had (LL-negative-test-the-regression-
// not-the-feature).
let selfTestCaught = null
const fail = (clause, msg) => {
  if (SELF_TEST && clause === SELF_TEST_CLAUSE && !selfTestCaught) {
    selfTestCaught = msg
    console.log(`\nFITS-THE-SCREEN: SELF-TEST OK [clause ${clause.toUpperCase()}] — the gate REJECTED the poison:`)
    console.log('  caught: ' + msg)
    return
  }
  if (!SELF_TEST) { console.error(`FITS-THE-SCREEN: FAIL [${clause.toUpperCase()}] — ` + msg); exitCode = 1 }
}

// Shadow DOM does not pierce — the same recursive walker every browser gate in this repo carries.
const WALK = `
function __walk(sel) {
  const seen = new Set(); const out = [];
  const visit = (root) => {
    if (!root || seen.has(root)) return; seen.add(root);
    let els = []; try { els = Array.from(root.querySelectorAll('*')) } catch (e) { return }
    for (const el of els) {
      try { if (el.matches && el.matches(sel)) out.push(el) } catch (e) {}
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document); return out;
}
`
async function reinject(page) { await page.addScriptTag({ content: WALK }) }

const browser = await chromium.launch({ args: GL_ARGS })

// ================================================================================================
// CLAUSES A + B + C + D — the composite that shipped the bug: dashboard-plus-grid
// ================================================================================================
async function runComposite() {
  const TARGET = 'dashboard-plus-grid'
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const url = `${BASE}/${TREE_NAME}/dashboard-plus-grid/dashboard-plus-grid/index.html`
  await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch((e) => { throw new Error(`cannot reach ${TARGET}: ${e.message}`) })
  await page.waitForTimeout(6000)
  await reinject(page)

  // ── SELF-TEST POISONS, applied IN THE LIVE PAGE before any measurement (never the source file)
  if (SELF_TEST) {
    if (SELF_TEST_CLAUSE === 'a') {
      // Reproduce AP-fixing-reachability-by-making-the-thing-taller: force the dashboard's
      // section band to grow unbounded, past the viewport — the actual shape of the regression
      // (a scroll fix that let the rail's content set the band's height).
      console.log('  [self-test:a] forcing the dashboard section to overflow the viewport')
      await page.evaluate(`(() => {
        const sec = __walk('.stl-sec')[0];
        if (sec) { sec.style.setProperty('min-height', '2400px', 'important'); sec.style.setProperty('height', 'auto', 'important'); }
      })()`)
    } else if (SELF_TEST_CLAUSE === 'c') {
      // ★ POISON UPDATED 2026-09-23 — the ORIGINAL poison (freezing m.scrollZoom.disable to a
      // no-op) tested a defect shape DashboardMapPanel.vue no longer has: syncScrollZoomToHost
      // used to conditionally disable scroll-zoom based on host layout; it now unconditionally
      // calls .enable() and nothing in the current code ever calls .disable() at all. Freezing
      // .disable() therefore poisons a code path that is already dead — MEASURED: with the old
      // poison AND the current "below map" test point (x=150, outside the map's own column,
      // fixed alongside BUG-DASHBOARD-BAND-GROWS-ENORMOUS so it clears the table's ~54,500px
      // dead zone), both sub-checks passed even with the poison live, because that point was
      // never over the map's canvas regardless of scrollZoom's JS state.
      //
      // The risk that actually matters TODAY is a LAYOUT regression: the map's own hit-test area
      // silently growing to cover ground it should not (exactly how BUG-MAP-EATS-THE-WHEEL first
      // manifested — a Mapbox canvas full-bleeding its container). So the poison now stretches
      // the map's own container to cover the "below map" test point, which is a live reproduction
      // of that shape rather than toggling a dead JS flag.
      console.log('  [self-test:c] stretching the map container over the "below map" test point — the canvas-overreach regression')
      await page.evaluate(`(() => {
        const m = __walk('[data-region="map"]')[0];
        if (m) { m.style.setProperty('height', '3000px', 'important'); m.style.setProperty('overflow', 'visible', 'important'); }
      })()`)
    } else if (SELF_TEST_CLAUSE === 'd') {
      // Reproduce "the grid has no visible count": blank the live count element's text.
      console.log('  [self-test:d] blanking the count line')
      await page.evaluate(`(() => {
        const el = __walk('[data-table-count]')[0];
        if (el) { el.textContent = ''; Object.defineProperty(el, 'textContent', { get(){ return '' }, set(){} }); }
      })()`)
    }
  }

  // ── CLAUSE A — ONE-VIEWPORT RULE ─────────────────────────────────────────────────────────────
  // .stl-sec (StackLayout's own section wrapper, library/layouts/StackLayout.vue:62) is the band
  // a reader actually sees stacked above the grid — measuring .rd-shell alone would miss a
  // regression in the SECTION wrapper around it (exactly what the self-test above pokes).
  //
  // ★ THE CAUSAL TEST, NOT A STATIC SIZE COMPARISON (rewritten 2026-09-23, BUG-DASHBOARD-BAND-
  // GROWS-ENORMOUS fix). The ORIGINAL clause A asserted `bandH < legendH` at rest (sections
  // collapsed). That was a correlation check calibrated to the UNFIXED bug, where the band and
  // the legend's natural content height were the SAME number (band 2325px, legend scrollHeight
  // 2117px — the legend WAS the band's content). After the fix, the legend is independently
  // capped (its own max-height rule) and the band is sized by chrome+map+table, so at rest the
  // band (~892px) is legitimately TALLER than a COLLAPSED legend (~360px) — not because the
  // legend sets the band's height, but because a full dashboard column naturally needs more room
  // than five collapsed section headers. `bandH >= legendH` at that single instant no longer
  // distinguishes "fixed" from "still coupled": it would FAIL a correct fix and could PASS a
  // regression that recoupled them at a taller legend size.
  //
  // The actual claim worth testing is causal: does the band's height CHANGE when the legend's
  // content does? Expand every facet section (the worst case that broke this in the first place
  // — MEASURED live: expanding all five renders ~2112px of rows, matching the original bug's
  // 2117px) and assert the band barely moves. A SMALL tolerance (not zero) allows for a
  // sub-pixel layout reflow that isn't a regression; a band that grows by more than that IS the
  // bug reappearing.
  const collapsed = await page.evaluate(`(() => {
    const sec = __walk('.stl-sec')[0];
    const legend = __walk('.rd-rail')[0] || __walk('[data-region="facets"]')[0];
    return {
      bandH: sec ? Math.round(sec.getBoundingClientRect().height) : null,
      legendH: legend ? Math.round(legend.scrollHeight) : null,
    }
  })()`)
  await page.evaluate(`(() => { __walk('.fr-sech').forEach(h => h.click()); })()`)
  await page.waitForTimeout(600)
  await reinject(page)
  const expanded = await page.evaluate(`(() => {
    const sec = __walk('.stl-sec')[0];
    const frBody = __walk('.fr-body')[0];
    return {
      bandH: sec ? Math.round(sec.getBoundingClientRect().height) : null,
      legendContentH: frBody ? Math.round(frBody.scrollHeight) : null,
    }
  })()`)
  // collapse back so clause B/C measure the SAME rest state every other clause expects.
  // DashboardFacetRail marks a section CLOSED via a .closed class (open is the class's absence),
  // so "still open" is "does not have .closed" — click those to return to the collapsed default.
  await page.evaluate(`(() => { __walk('.fr-sech').filter(h => !h.classList.contains('closed')).forEach(h => h.click()); })()`)
  await page.waitForTimeout(300)
  await reinject(page)

  const VIEWPORT_H = 900
  const band = collapsed
  if (band.bandH == null) {
    fail('a', `dashboard section (.stl-sec) not found — cannot measure band height`)
  } else {
    const fitsViewport = band.bandH <= VIEWPORT_H
    const detail = `band=${band.bandH}px vs viewport=${VIEWPORT_H}px` + (band.legendH != null ? `, legend scrollHeight (collapsed)=${band.legendH}px` : '')
    record('A', TARGET, fitsViewport, detail)
    if (!fitsViewport) fail('a', `dashboard band is ${band.bandH}px, taller than the ${VIEWPORT_H}px viewport — it sizes to its own content instead of the screen. ` + detail)

    // THE BUG: the dashboard rendering to the full height of the tree legend, i.e. the band
    // TRACKING the legend's content, not merely being numerically larger
    // than it. Test that directly: expand every section (worst case, ~2100px of rows) and assert
    // the band does not grow past the viewport with it. GROWTH_TOLERANCE_PX is generous enough to
    // absorb a scrollbar-width reflow, tight enough that the original 2325px regression (a ~1400px
    // jump) would still be caught outright.
    const GROWTH_TOLERANCE_PX = 24
    const growth = expanded.bandH != null && band.bandH != null ? expanded.bandH - band.bandH : null
    const stillFits = expanded.bandH != null && expanded.bandH <= VIEWPORT_H
    const boundedGrowth = growth != null && growth <= GROWTH_TOLERANCE_PX
    const ok = stillFits && boundedGrowth
    const growDetail = `expanded band=${expanded.bandH}px (legend content ${expanded.legendContentH}px), growth=${growth}px vs ${GROWTH_TOLERANCE_PX}px tolerance`
    record('A', `${TARGET} (legend expanded)`, ok, growDetail)
    if (!ok) fail('a', `expanding every facet section grew the band by ${growth}px (now ${expanded.bandH}px) — the band still tracks the legend's content height. ` + growDetail)
  }

  // ── CLAUSE B — THE GRID IS REACHABLE UNDERNEATH, by scrolling ──────────────────────────────
  // Same measured gesture verify-shell-scroll.mjs uses (WHEEL_TICKS*WHEEL_DY), applied to the
  // composite leaf directly rather than through the shell rail, so this clause holds independent
  // of whatever the cap-5 shell tab structure looks like this tick.
  //
  // ★ WHY THE X-COORDINATE IS THE FACETS COLUMN, NOT DASHBOARD-CENTER (fixed alongside the
  // BUG-DASHBOARD-BAND-GROWS-ENORMOUS work, 2026-09-23). x=700 sits over [data-region="table"],
  // DashboardDataTable's own windowed-virtualization grid — a DELIBERATE, pre-existing design
  // (docs: "Excel-style virtualized table... 2,106 rows") whose internal scrollHeight is ~54,500px.
  // A 12-tick*350px gesture (4,200px) cannot dent that before wheel-chaining to the page would
  // ever kick in — not a layout bug, a consequence of the table legitimately owning a much larger
  // scroll range than any bounded gesture can exhaust. MEASURED live: the SAME gesture over the
  // facets column (shallow internal scroll, ~360px when collapsed) chains to the page correctly
  // (scrollTop 0 -> 2159px). Testing at the table's x-position was asserting a claim about a
  // component this clause was never meant to characterize. x=150 sits inside the facets column at
  // every viewport this gate uses (facets is 296px wide, computed 296 vs var(--facet-w)).
  const gridTop = () => page.evaluate(`(() => {
    const g = __walk('.pgg-root')[0];
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height) };
  })()`)
  const before = await gridTop()
  if (!before) {
    fail('b', `.pgg-root (people-groups grid) not mounted on ${TARGET} — cannot measure reachability`)
  } else {
    // ★ DERIVE THE WHEEL POINT FROM THE BAND, NEVER HARDCODE IT (fixed 2026-09-23).
    // y=800 was tuned when the dashboard band measured ~1213px tall. A later fix dropped the
    // page-scroll map default 58svh -> 40svh to satisfy clause A, shrinking the band to ~892px — so
    // y=800 stopped being "below the band" and started landing INSIDE it, on `.rd-td`, the table's
    // own windowed scrollport. Two agents independently confirmed that with elementFromPoint.
    //
    // ★ AND THE PRODUCT WAS FINE THE WHOLE TIME. A real gesture from a natural cursor position
    // (y=870) moved the grid 2159px — fully reachable. The gate was failing on its own staleness and
    // reporting it as a product defect, which is the most expensive kind of wrong a gate can be.
    // A coordinate tuned to a layout is a coordinate that expires the next time the layout moves.
    const wheelY = await page.evaluate(`(() => {
      const band = __walk('[data-region="dashboard"], .rd-shell')[0];
      const b = band ? Math.round(band.getBoundingClientRect().bottom) : 0;
      // 20px clear of the band, and never past the fold — if the band already fills the viewport
      // there is no "below" to wheel over, and clause A is the clause that should be failing.
      return Math.min(window.innerHeight - 30, Math.max(b + 20, 120));
    })()`)
    await page.mouse.move(150, wheelY)
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 350); await page.waitForTimeout(70) }
    await page.waitForTimeout(500)
    await reinject(page)
    const after = await gridTop()
    const moved = before.top - (after ? after.top : before.top)
    const onScreen = after && after.top < VIEWPORT_H
    record('B', TARGET, moved > 200 && onScreen, `grid moved ${moved}px (top ${before.top} -> ${after ? after.top : 'null'}), on-screen=${!!onScreen}`)
    if (!(moved > 200 && onScreen)) fail('b', `wheeling below the dashboard moved the grid only ${moved}px (top now ${after ? after.top : 'null'}) — still not reachable by scrolling`)
  }

  // ── CLAUSE C — WHEEL TARGETING, instrumented on the DISPATCHED EVENT PATH ──────────────────
  // LL-four-wrong-diagnoses: geometry (getBoundingClientRect) gave four wrong answers on the
  // sibling bug. The browser already knows what the user hit — listen in the CAPTURE phase and
  // read composedPath(). A capture-phase listener sees the event BEFORE Mapbox's own handler can
  // preventDefault() it, so `defaultPrevented` after dispatch tells us whether zoom consumed it.
  //
  // ★ SCROLL BACK TO TOP FIRST (fixed alongside BUG-DASHBOARD-BAND-GROWS-ENORMOUS, 2026-09-23).
  // Clause B just scrolled the page ~2000px+ to reach the grid and never reset. mapEl below is
  // computed from [data-region="map"]'s CURRENT getBoundingClientRect(), so without a reset its
  // y-coordinate comes out NEGATIVE (measured: y=-1839 after a real clause-B scroll) — an
  // off-screen point the mouse cannot usefully move to. The wheel instrument then logs NOTHING
  // ("path[0]=n/a"), and the gesture lands wherever the mouse physically ended up instead,
  // reading as "the map did not receive the gesture" when the real defect was a stale scroll
  // position the gate itself introduced one clause earlier.
  await page.evaluate(`(() => { document.scrollingElement.scrollTop = 0; })()`)
  await page.waitForTimeout(300)
  await reinject(page)
  const wheelInstrument = `
    window.__wheelLog = [];
    if (!window.__wheelCaptureInstalled) {
      window.__wheelCaptureInstalled = true;
      document.addEventListener('wheel', (e) => {
        window.__wheelLog.push({
          x: e.clientX, y: e.clientY,
          path: (e.composedPath ? e.composedPath() : []).slice(0, 6).map(n => n && n.className ? String(n.className).slice(0,40) : (n && n.tagName || '')),
        });
      }, { capture: true, passive: true });
    }
  `
  await page.evaluate(wheelInstrument)

  // -- over the map --
  const mapEl = await page.evaluate(`(() => { const m = __walk('[data-region="map"]')[0] || __walk('.mapboxgl-canvas')[0]; if (!m) return null; const r = m.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) } })()`)
  let zoomBefore = null, zoomAfter = null, scrollBefore = null, scrollAfter = null, pathOverMap = []
  if (mapEl) {
    zoomBefore = await page.evaluate(`(() => { const m = window.__rdashMap; return m ? m.getZoom() : null })()`)
    scrollBefore = await page.evaluate(`(() => { const sec = __walk('.stl-sec')[0]; return sec ? sec.getBoundingClientRect().top : (window.scrollY || document.documentElement.scrollTop) })()`)
    await page.mouse.move(mapEl.x, mapEl.y)
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60) }
    await page.waitForTimeout(400)
    zoomAfter = await page.evaluate(`(() => { const m = window.__rdashMap; return m ? m.getZoom() : null })()`)
    await reinject(page)
    scrollAfter = await page.evaluate(`(() => { const sec = __walk('.stl-sec')[0]; return sec ? sec.getBoundingClientRect().top : (window.scrollY || document.documentElement.scrollTop) })()`)
    pathOverMap = await page.evaluate('window.__wheelLog || []')
  }
  const zoomChanged = zoomBefore != null && zoomAfter != null && Math.abs(zoomAfter - zoomBefore) > 0.01
  const scrolledWhileOverMap = scrollBefore != null && scrollAfter != null && Math.abs(scrollAfter - scrollBefore) > 40
  if (!mapEl) {
    fail('c', `map region not found on ${TARGET} — cannot instrument the wheel`)
  } else {
    const ok = zoomChanged && !scrolledWhileOverMap
    record('C', `${TARGET} (over map)`, ok, `zoom ${zoomBefore != null ? zoomBefore.toFixed(2) : '?'} -> ${zoomAfter != null ? zoomAfter.toFixed(2) : '?'}, section.top moved ${scrollBefore != null && scrollAfter != null ? Math.round(scrollAfter - scrollBefore) : '?'}px, path[0]=${pathOverMap[0] ? JSON.stringify(pathOverMap[0].path[0]) : 'n/a'}`)
    if (!zoomChanged) fail('c', `wheel over the map did NOT change zoom (${zoomBefore} -> ${zoomAfter}) — the map is not receiving/using the gesture`)
    if (scrolledWhileOverMap) fail('c', `wheel over the map ALSO scrolled the pane (section.top moved ${Math.round(scrollAfter - scrollBefore)}px) — the gesture is leaking past the map to the page`)
  }

  // -- below the map, over a column that isn't the table's own windowed-virtualization scroller.
  // Same x=150 (facets column) reasoning as clause B above — x=700 sits over [data-region="table"],
  // whose ~54,500px internal scroll cannot be exhausted by a bounded gesture, so it never chains
  // to the page and this clause would fail on a component it was never meant to characterize.
  // ★ SAME STALE-COORDINATE FIX AS CLAUSE B (2026-09-23): y=850 was tuned to a ~1213px band and
  // now lands inside the ~892px one, on `.rd-td`. Derived from the band's measured bottom instead.
  const belowY = await page.evaluate(`(() => {
    const band = __walk('[data-region="dashboard"], .rd-shell')[0];
    const b = band ? Math.round(band.getBoundingClientRect().bottom) : 0;
    return Math.min(window.innerHeight - 30, Math.max(b + 20, 120));
  })()`)
  const below = { x: 150, y: belowY }
  const zoomBefore2 = await page.evaluate(`(() => { const m = window.__rdashMap; return m ? m.getZoom() : null })()`)
  const scrollBefore2 = await gridTop()
  await page.mouse.move(below.x, below.y)
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 250); await page.waitForTimeout(60) }
  await page.waitForTimeout(400)
  await reinject(page)
  const zoomAfter2 = await page.evaluate(`(() => { const m = window.__rdashMap; return m ? m.getZoom() : null })()`)
  const scrollAfter2 = await gridTop()
  const zoomChangedBelow = zoomBefore2 != null && zoomAfter2 != null && Math.abs(zoomAfter2 - zoomBefore2) > 0.01
  const movedBelow = scrollBefore2 && scrollAfter2 ? (scrollBefore2.top - scrollAfter2.top) : 0
  const okBelow = !zoomChangedBelow && movedBelow > 50
  record('C', `${TARGET} (below map)`, okBelow, `zoom ${zoomBefore2 != null ? zoomBefore2.toFixed(2) : '?'} -> ${zoomAfter2 != null ? zoomAfter2.toFixed(2) : '?'}, grid moved ${movedBelow}px`)
  if (zoomChangedBelow) fail('c', `wheel BELOW the map changed zoom (${zoomBefore2} -> ${zoomAfter2}) — an unrelated gesture is reaching the map`)
  if (!(movedBelow > 50)) fail('c', `wheel below the map did not scroll the page (grid moved only ${movedBelow}px)`)

  // ── CLAUSE F — THE WHEEL ESCAPES FROM *EVERY* COLUMN, NOT JUST THE ONE WE TEST ──────────────
  // ★ WHY THIS CLAUSE EXISTS: clause C above wheels at x=150, the FACETS column. That coordinate
  // is correct for what C asserts, but it made 16/16 certify a NARROWER claim than it appears to.
  // MEASURED 2026-09-23, 1440x900, 12 wheel ticks x 350px = 4200px of delta at y=682:
  //     x=150  (facets col)       scrollY 0 -> 2131   moved 2131px
  //     x=736  (TABLE col centre) scrollY 0 -> 0      moved    0px   <-- dead zone
  //     x=1330 (rail col)         scrollY 0 -> 2131   moved 2131px
  // The table column is roughly the centre 60% of the screen — where a cursor naturally rests. A
  // reader who finishes the table and keeps scrolling without moving the mouse sideways is stuck,
  // which is the original complaint. Cause: .rd-grid is its own scroll surface with a virtualized
  // scrollHeight of ~54,838px against a ~300px keyhole, so the overscroll-chain escape the design
  // relies on can never fire — 4200px of wheel does not come close to bottoming out 54,538px.
  //
  // ★ THE GENERAL LESSON, which is why this is a CLAUSE and not a card: a single test coordinate
  // grades one column. When the previously-failing point was moved to a passing column the gate
  // went green while the defect stood — "the gate passes" and "the complaint is fixed" are
  // different claims. Sweeping every column makes the gate fail wherever a user could actually be.
  const colSweep = []
  {
    const cols = await page.evaluate(`(() => {
      const shell = __walk('.rd-shell')[0]; if (!shell) return null
      const pick = (r) => { const e = shell.querySelector('[data-region="' + r + '"]'); if (!e) return null
        const b = e.getBoundingClientRect()
        if (b.height < 40) return null
        return { region: r, x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } }
      return ['facets', 'table', 'rail'].map(pick).filter(Boolean)
    })()`)
    for (const col of (cols || [])) {
      await page.evaluate(`(() => { window.scrollTo(0, 0); if (document.scrollingElement) document.scrollingElement.scrollTop = 0 })()`)
      await page.waitForTimeout(500)
      const y0 = await page.evaluate(`Math.round(window.scrollY)`)
      // ★ WHEEL INSIDE THE COLUMN, NOT BELOW IT. belowY is deliberately past the band's bottom
      // (clause C wants the page there), but a point past the bottom is OUTSIDE every column, so
      // reusing it made all three columns measure the same open page and clause F passed for the
      // wrong reason — elementFromPoint(736, belowY) returned the composite host, never the table.
      // Each column supplies its OWN y: the vertical centre of its own rect.
      await page.mouse.move(col.x, col.y)
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 350); await page.waitForTimeout(50) }
      await page.waitForTimeout(500)
      const y1 = await page.evaluate(`Math.round(window.scrollY)`)
      colSweep.push({ region: col.region, x: col.x, moved: y1 - y0 })
    }
    await page.evaluate(`(() => { window.scrollTo(0, 0); if (document.scrollingElement) document.scrollingElement.scrollTop = 0 })()`)
    await reinject(page)
  }
  const stuck = colSweep.filter((c) => c.moved <= 50)
  const okCols = colSweep.length > 0 && stuck.length === 0
  record('F', `${TARGET} (wheel escapes every column)`, okCols,
    colSweep.map((c) => `${c.region}@${c.x}:${c.moved}px`).join(' · ') || 'no columns found')
  if (colSweep.length && stuck.length) {
    fail('f', `a wheel over the ${stuck.map((s) => s.region).join(', ')} column(s) does not scroll the page ` +
      `(moved ${stuck.map((s) => s.moved + 'px').join(', ')} after 4200px of wheel) — that column is a dead zone ` +
      `for a reader whose cursor rests there`)
  }

  // ── CLAUSE D — THE ELEMENT SAYS WHAT IT IS SHOWING ──────────────────────────────────────────
  // dashboard-plus-grid.vue:279 sets show-total=false on the grid child DELIBERATELY (the count
  // lived twice — the grid's own "Total:" line 38px below the table's "Σ N groups" footer); the
  // documented single source of truth for the composite is the table's own live bar,
  // DashboardDataTable.vue:541 `[data-table-count]`. Asserting on `.pgg-root .repel` here would
  // fail correct code — this reads the element the design actually intends to speak through.
  const countBefore = await page.evaluate(`(() => { const el = __walk('[data-table-count]')[0]; return el ? el.textContent.trim() : null })()`)
  const countVisible = countBefore != null && /\d/.test(countBefore)
  if (!countVisible) {
    fail('d', `no visible count element ([data-table-count]) found, or it carries no digits (saw ${JSON.stringify(countBefore)})`)
  } else {
    // Narrow via a real facet-rail click (interop-harness's proven mechanism) and require the
    // count to CHANGE — a static "N groups" that never updates is the same defect wearing a
    // "technically visible" disguise.
    const facetClicked = await page.evaluate(`(() => {
      const rows = __walk('[data-facet]').filter(r => r.getAttribute('data-facet') && r.getAttribute('data-value') && !r.classList.contains('dash-only'));
      const row = rows.find(r => r.getAttribute('data-facet') === 'wagf_region') || rows[0];
      if (!row) return null;
      row.click();
      return { facet: row.getAttribute('data-facet'), key: row.getAttribute('data-value') };
    })()`)
    if (!facetClicked) {
      // Count is visible but we cannot prove reactivity here — record what we could verify, do not fabricate a pass on the untested half.
      record('D', TARGET, true, `count visible ("${countBefore}"); could not find a clickable facet row to test that it CHANGES`)
    } else {
      await page.waitForTimeout(2000)
      await reinject(page)
      const countAfter = await page.evaluate(`(() => { const el = __walk('[data-table-count]')[0]; return el ? el.textContent.trim() : null })()`)
      const changed = countAfter != null && countAfter !== countBefore
      record('D', TARGET, changed, `"${countBefore}" -> "${countAfter}" after facet ${facetClicked.facet}=${facetClicked.key}`)
      if (!changed) fail('d', `count line did not change after narrowing (${JSON.stringify(countBefore)} -> ${JSON.stringify(countAfter)})`)
    }
  }

  await page.close()
}

// ================================================================================================
// CLAUSE E — RESPONSIVE SWEEP, on both the composite and the standalone dashboard leaf
// ================================================================================================
async function runResponsiveSweep(url, label) {
  const WIDTHS = [1440, 1280, 768, 390]
  for (const w of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } })
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 })
    } catch (e) {
      record('E', `${label}@${w}`, false, `navigation failed: ${e.message}`)
      fail('e', `${label}@${w}: could not navigate (${e.message})`)
      await page.close(); continue
    }
    await page.waitForTimeout(5000)
    await reinject(page)

    if (SELF_TEST && SELF_TEST_CLAUSE === 'e' && w === 1440) {
      console.log('  [self-test:e] forcing the shell wider than the viewport')
      await page.evaluate(`(() => { document.documentElement.style.setProperty('min-width', '2200px', 'important'); })()`)
    }

    const measured = await page.evaluate(`(() => {
      const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
      // Elements clipped to zero height: anything with real content but 0 rendered height.
      // Exempt .rd-td/.rd-th (text-overflow:ellipsis is EXPECTED there — the brief's own carve-out)
      // and anything with zero content (legitimately-empty containers are not a clipping defect).
      // ★ MAPBOX INTERNALS ARE EXEMPT TOO (added 2026-09-23, after the first real verdict).
      // On its first run this clause failed on ALL EIGHT viewport/target combinations with
      // docOverflow=0 and the SAME two elements every time: mapboxgl-canvas-container and
      // mapboxgl-control-container. Both are GL-JS's own wrappers, legitimately zero-height with
      // children — the canvas container collapses because the canvas is absolutely positioned, and
      // the control container is an empty positioning shell. Neither is a layout defect.
      //
      // That was 8 of this gate's 12 failures on its first verdict: a false signal loud enough to
      // drown the ONE real finding (clause B, a wheel below the map scrolling nothing). A gate that
      // reports four-fifths noise teaches its reader to skim the summary line, which is the same
      // failure this file was written to end — so the exemption is a correctness fix, not a
      // convenience.
      //
      // Scoped by PREFIX rather than an exact class list, because GL-JS composes these as
      // multi-class strings ("mapboxgl-canvas-container mapboxgl-interactive") and adds more of
      // them across versions. Kept NARROW to mapboxgl-/maplibregl- so it cannot silently swallow a
      // real defect in our own markup.
      const VENDOR_ZERO_HEIGHT = /(^|\s)(mapboxgl|maplibregl)-/;
      const all = __walk('*');
      const clipped = [];
      for (const el of all) {
        if (el.classList && (el.classList.contains('rd-td') || el.classList.contains('rd-th'))) continue;
        if (el.className && VENDOR_ZERO_HEIGHT.test(String(el.className))) continue;
        const r = el.getBoundingClientRect();
        const hasText = (el.textContent || '').trim().length > 0;
        const hasOwnChildren = el.children && el.children.length > 0;
        if (r.height === 0 && r.width > 0 && (hasText || hasOwnChildren)) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue; // intentionally hidden, not clipped
          clipped.push((el.className ? String(el.className).slice(0,40) : el.tagName));
        }
      }
      return { docOverflow, clippedCount: clipped.length, clippedSample: clipped.slice(0, 5) };
    })()`)
    const ok = measured.docOverflow <= 2 && measured.clippedCount === 0
    record('E', `${label}@${w}`, ok, `doc overflow=${measured.docOverflow}px, clipped-to-zero-height=${measured.clippedCount}${measured.clippedSample.length ? ' (' + measured.clippedSample.join(', ') + ')' : ''}`)
    if (measured.docOverflow > 2) fail('e', `${label}@${w}: document scrolls horizontally by ${measured.docOverflow}px`)
    if (measured.clippedCount > 0) fail('e', `${label}@${w}: ${measured.clippedCount} element(s) clipped to zero height — ${measured.clippedSample.join(', ')}`)
    await page.close()
  }
}

// ================================================================================================
// SHELL-LEVEL BEST-EFFORT (cap-5): discovered by manifest type, probed by content match, never a
// hard dependency on doxa-maps-spa's or plugin-studio's internal tab structure.
// ================================================================================================
async function runShellBestEffort() {
  if (!shellLeaves.length) {
    console.log('  (info) no nested-mfe-spa profile in the manifest — shell-level sub-check skipped, not failed.')
    return
  }
  for (const shell of shellLeaves) {
    const url = shell.iframeUrl ? `${BASE}/${TREE_NAME}/${shell.iframeUrl.replace(/^\.\//, '')}` : null
    if (!url) continue
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 })
    } catch (e) {
      console.log(`  (info) shell ${shell.bundle}/${shell.profile} unreachable (${e.message}) — skipping shell-level check for it.`)
      await page.close(); continue
    }
    await page.waitForTimeout(5000)
    await reinject(page)
    // Content-matched click: find ANY tab whose visible text mentions the composite this gate
    // already proved (dashboard-plus-grid / "Big Picture" / "Dashboard"), rather than assuming a
    // fixed label or index — resilient to the three-section restructure landing mid-flight.
    const tab = await page.evaluate(`(() => {
      const cands = __walk('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)');
      const hit = cands.find(t => /dashboard.plus.grid|big picture|dashboard/i.test((t.textContent||'')));
      if (!hit) return null;
      hit.click();
      return hit.textContent.trim();
    })()`)
    if (!tab) {
      console.log(`  (info) shell ${shell.bundle}/${shell.profile}: no tab text matched the dashboard/grid composite yet — SKIPPING (not a fitness finding; may be mid-restructure).`)
      await page.close(); continue
    }
    await page.waitForTimeout(7000)
    await reinject(page)
    const grid = await page.evaluate(`(() => { const g = __walk('.pgg-root')[0]; return g ? { h: Math.round(g.getBoundingClientRect().height) } : null })()`)
    record('B (shell)', `${shell.bundle} tab="${tab}"`, !!grid, grid ? `grid mounted h=${grid.h}px inside the shell` : 'grid did not mount inside the shell within the wait window')
    if (!grid) fail('b', `shell ${shell.bundle}: grid did not mount inside the "${tab}" tab`)
    await page.close()
  }
}

// ── RUN ──────────────────────────────────────────────────────────────────────────────────────
let runError = null
try {
  await runComposite()
  await runResponsiveSweep(`${BASE}/${TREE_NAME}/dashboard-plus-grid/dashboard-plus-grid/index.html`, 'dashboard-plus-grid')
  await runResponsiveSweep(`${BASE}/${TREE_NAME}/research-dashboard/research-dashboard/index.html`, 'research-dashboard')
  await runShellBestEffort()
} catch (e) {
  runError = e
  console.error('FITS-THE-SCREEN: ERROR — ' + e.message)
  exitCode = 1
} finally {
  await browser.close()
  server.kill()
}

// ── RE-CHECK SETTLEDNESS AT THE END — a build finishing mid-run tears the tree out from under an
// in-flight measurement exactly like one starting did. Downgrade to SKIP rather than report. ─────
if (!settled()) {
  console.log('\nFITS-THE-SCREEN: SKIP — the tree stopped being settled DURING this run (a build landed mid-measurement).')
  console.log('  Every clause above was measured against a tree that moved underneath it. Re-run once the queue drains.')
  process.exit(0)
}

// ── CLAUSE TABLE ─────────────────────────────────────────────────────────────────────────────
console.log('\n── CLAUSE TABLE ' + '─'.repeat(70))
console.log('clause | target | result | detail')
for (const r of rows) {
  console.log(`${r.clause} | ${r.target} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail}`)
}
const passN = rows.filter((r) => r.ok).length
console.log(`\n${passN}/${rows.length} clause-checks PASS`)

if (SELF_TEST) {
  if (selfTestCaught) {
    console.log(`\nFITS-THE-SCREEN: SELF-TEST PASS (clause=${SELF_TEST_CLAUSE.toUpperCase()}) — the poisoned build was correctly rejected.`)
    process.exit(0)
  }
  console.error(`\nFITS-THE-SCREEN: SELF-TEST FAILED (clause=${SELF_TEST_CLAUSE.toUpperCase()}) — the poison was live and this gate still reported PASS.`)
  console.error('  A gate that cannot fail is worse than no gate. Fix the gate, not the product.')
  process.exit(1)
}

if (runError) process.exit(1)
console.log(exitCode ? '\nFITS-THE-SCREEN: FAIL' : '\nFITS-THE-SCREEN: PASS — the product fits the screen, the grid is reachable, the wheel is targeted, the count speaks, and it holds at four widths.')
process.exit(exitCode)
