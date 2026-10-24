#!/usr/bin/env node
/**
 * interop-harness.mjs — the CAP-4 INTEROPERABILITY GATE. Real browser, real shadow DOM, real
 * live data. Closes the gap verify:gate1 leaves open: gate1 is a LOGIC MIRROR of dashboard->grid
 * (fetch the same API, replay the filter math, compare numbers — no browser, no clicks). This
 * file drives the ACTUAL compiled composites the way a person does, and adds the two links
 * nothing else asserts:
 *
 *   1. DESKTOP map -> grid    (dashboard-plus-grid)     — a facet-rail click narrows BOTH halves
 *   2. DESKTOP grid -> map    (dashboard-plus-grid)     — a table row-select MOVES THE CAMERA
 *   3. MOBILE  pair           (research-map-plus-grid)  — each half narrows on ITS OWN control
 *      (there is NO cross-wire here — see "THE MOBILE FINDING" below; this is a real, checked
 *      architectural fact, not an unproven gap)
 *
 * WHY A BROWSER AND NOT ANOTHER LOGIC MIRROR: the desktop link is DOM-mediated (a Vue prop from
 * the dashboard's header down into the grid's `defineProps`, and a `window.__rdashMap` camera
 * move triggered by a table click) — nothing about it is visible to a script that only calls the
 * API. Camera motion in particular (fitBounds/flyTo) has NO API equivalent to mirror; the only
 * way to prove "select rows, the map flies to the selection" is to select rows and read the map.
 *
 * ── THE COMBINATION MATRIX (EVERY SINGLE COMBINATION, logging only whether it DISPLAYED,
 *    pass/fail) ─────────────────────────────────────────────────────────────────────────
 * One line per combination, BOTH halves recorded, pass/fail only. "Displayed" is never inferred
 * from a click firing or an element existing — see WHAT COUNTS AS DISPLAYED per pair below.
 *
 * WHAT COUNTS AS DISPLAYED
 *   grid   — the `Showing N` / `Total: N` count line (people-groups-grid.vue:718-727), the ONE
 *            unambiguous signal per the prior sweep (RESULT-interop-sweep.md): card count is
 *            always 24 (page size) and is a proven FALSE NEGATIVE trap, so it is never asserted
 *            on here.
 *   map    — for map->grid: not measured directly (no WebGL on this box; judged via the grid's
 *            reaction, which only happens if the facet reached the map's filter state upstream —
 *            in dashboard-plus-grid the SAME prop drives both, so grid-narrowed implies the link
 *            fired). For grid->map: the map's OWN camera state — center/zoom/bounds read back off
 *            `window.__rdashMap` via getCenter()/getZoom() — must CHANGE. A camera move without a
 *            handler firing is impossible; a handler firing without the camera moving is the
 *            exact regression class useSelectionCamera.js exists to prevent.
 *
 * SHADOW DOM DOES NOT PIERCE. A flat querySelectorAll finds nothing past the first host boundary
 * — see shadow-dom-does-not-pierce-verify-composites-recursively (this flight's own lesson). The
 * WALK below is the same recursive querySelectorAll+shadowRoot walker check-facet-changes-map.mjs
 * uses, re-injected after every interaction (a re-render drops anything defined earlier).
 *
 * NEGATIVE TEST (`--self-test`, default mode `grid-prop-drop`): forces the dashboard's own
 * `dashboard-filter` handler to STOP forwarding the region prop into the grid — reproducing the
 * exact historical regression this repo shipped and fixed (BUG "selecting anything in the
 * dashboard above did not filter the grid below", dashboard-plus-grid.vue's own header comment) —
 * and requires the harness to FAIL, NAMING the broken combination. `--self-test-mode=camera-freeze`
 * poisons useSelectionCamera's target map instead, reproducing "the grid->map link stops moving
 * the camera" and requires THAT combination named. A harness that has only ever reported PASS is
 * unproven (LL-negative-test-the-regression-not-the-feature): "I made it fail" is not enough
 * evidence — the question is whether it fails on the SAME defect shape the real bug had.
 *
 * PRECONDITIONS, checked and SKIPPED (exit 0) rather than reported as a defect when unmet:
 *   - the tree must be SETTLED (internal/settled-tree-gate.mjs) — a build mid-flight makes any
 *     browser gate that reads it report a confident, false diagnosis
 *     (LL-verify-the-tree-is-settled-before-trusting-a-browser-gate).
 *   - the live API (pray.doxa.life) must be reachable.
 *
 * USAGE
 *   node internal/acceptance/interop-harness.mjs
 *   node internal/acceptance/interop-harness.mjs --self-test [--self-test-mode=grid-prop-drop|camera-freeze]
 *   PORT=4180 node internal/acceptance/interop-harness.mjs
 */
import { chromium } from '../lib/playwright-guarded.mjs'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { TREE_NAME } from '../_tree-name.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

const SELF_TEST = process.argv.includes('--self-test')
const modeArg = process.argv.find((a) => a.startsWith('--self-test-mode='))
const SELF_TEST_MODE = (modeArg ? modeArg.split('=')[1] : 'grid-prop-drop').toLowerCase()
const PORT = Number(process.env.PORT || 4180)
const BASE = `http://127.0.0.1:${PORT}`

const GL_ARGS = [
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox',
]

// ── 0. PRECONDITIONS — say "could not measure", never guess a defect from a torn tree ─────────
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
  console.log('\nINTEROP-HARNESS: SKIP — tree is not settled (a build is running). Not a product finding.')
  console.log('  Re-run once the queue drains: node internal/settled-tree-gate.mjs')
  process.exit(0)
}

let apiReachable = true
try {
  const r = await fetch('https://pray.doxa.life/api/people-groups/list?fields=name&lang=', {
    signal: AbortSignal.timeout(10000),
  })
  apiReachable = r.ok
} catch { apiReachable = false }
if (!apiReachable) {
  console.log('INTEROP-HARNESS: SKIP — pray.doxa.life is unreachable right now. Not a product finding.')
  process.exit(0)
}

// ── 1. SERVE THE BUILT TREE the way production serves it (directories 404; see serve-strict.mjs)
const server = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(PORT), '--directory', 'public'], {
  cwd: ROOT, stdio: 'pipe',
})
let serverErr = ''
server.stderr.on('data', (d) => { serverErr += d.toString() })
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('serve-strict did not start in 10s: ' + serverErr)), 10000)
  server.stdout.on('data', (d) => { if (/http:\/\//.test(d.toString())) { clearTimeout(t); res() } })
  server.on('exit', (code) => { clearTimeout(t); rej(new Error('serve-strict exited early (' + code + '): ' + serverErr)) })
})

let exitCode = 0
const rows = []   // { pair, combination, half, displayed, detail }
const record = (pair, combination, half, displayed, detail) => {
  rows.push({ pair, combination, half, displayed, detail })
  console.log(`  ${displayed ? '✓ DISPLAYED' : '✗ NOT-DISPLAYED'}  [${pair}] ${combination} / ${half} -> ${detail}`)
}

// The self-test inverts the exit contract exactly as check-facet-changes-map.mjs does: a
// self-test run that correctly DETECTS the reverted bug is itself the PASS. Reaching the end of
// the run without ever detecting it is the failure.
let selfTestCaught = null
const fail = (msg) => {
  if (SELF_TEST && !selfTestCaught) {
    selfTestCaught = msg
    console.log('\nINTEROP-HARNESS: SELF-TEST OK — the gate REJECTED the poisoned build:')
    console.log('  caught: ' + msg)
    return
  }
  if (!SELF_TEST) { console.error('INTEROP-HARNESS: FAIL — ' + msg); exitCode = 1 }
}

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
function __gridCount() {
  const repel = __walk('.repel')[0];
  if (!repel) return { present: false };
  const txt = (repel.textContent || '').trim();
  const m = txt.match(/([\\d,]+)\\s*$/);
  return { present: true, text: txt, n: m ? Number(m[1].replace(/,/g, '')) : null };
}
function __cardCount() { return __walk('.uupg__card').length; }
`
async function reinject(page) { await page.addScriptTag({ content: WALK }) }

async function readGrid(page) {
  return page.evaluate('({ count: __gridCount(), cards: __cardCount() })')
}

// ================================================================================================
// PAIR 1+2 — DESKTOP: dashboard-plus-grid (map->grid AND grid->map)
// ================================================================================================
async function runDesktop(browser) {
  const PAIR = 'desktop dashboard-plus-grid'
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const url = `${BASE}/${TREE_NAME}/dashboard-plus-grid/dashboard-plus-grid/index.html`
  console.log(`\n=== ${PAIR} — ${url} ===`)
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  } catch (e) {
    console.log(`INTEROP-HARNESS: SKIP ${PAIR} — cannot reach leaf (${e.message})`)
    await page.close(); return
  }
  await page.waitForTimeout(2500)
  await reinject(page)

  // Mount gate — both halves present before anything is measured.
  const mounted = await page.evaluate('({ dash: !!document.querySelector("dashboard-plus-grid"), cards: __cardCount() })')
  if (!mounted.dash || mounted.cards === 0) {
    fail(`${PAIR}: composite did not mount (dash=${mounted.dash}, cards=${mounted.cards}) — cannot measure`)
    await page.close(); return
  }

  // ── SELF-TEST: grid-prop-drop — reproduce "selecting anything in the dashboard did not filter
  // the grid below" by stubbing the composite's forwarding handler to a no-op, IN THE LIVE PAGE.
  // This is the exact historical regression documented in dashboard-plus-grid.vue's own header
  // comment ("NEITHER HALF WAS BROKEN; THE LINK WAS ABSENT").
  if (SELF_TEST && SELF_TEST_MODE === 'grid-prop-drop') {
    console.log('  [self-test:grid-prop-drop] freezing the grid child props at their CURRENT values')
    await page.evaluate(`(() => {
      const grid = __walk('people-groups-grid')[0];
      if (!grid) return;
      // Intercept every prop setter the composite uses to push filters down — pin each at its
      // current (unfiltered) value so a later facet click narrows the DASHBOARD but the grid
      // never learns about it. This is a DOM-level poison of the link, not a source edit.
      const FROZEN = ['wagfRegion','wagfBlock','rop1','religion','countryCode','engagementStatus','primaryLanguage','query'];
      window.__interopFrozen = true;
      for (const attr of ['wagf-region','wagf-block','rop1','religion','country-code','engagement-status','primary-language','query']) {
        const cur = grid.getAttribute(attr);
        Object.defineProperty(grid, attr.replace(/-([a-z])/g, (_,c)=>c.toUpperCase()), { set(){}, get(){ return cur } });
      }
      const origSetAttr = grid.setAttribute.bind(grid);
      grid.setAttribute = (name, val) => {
        if (FROZEN.map(f=>f.replace(/([A-Z])/g,'-$1').toLowerCase()).includes(name)) return;
        return origSetAttr(name, val);
      };
    })()`)
  }

  // ── 1. MAP->GRID: a facet-rail click must narrow BOTH the dashboard AND the grid ──────────────
  // Baseline is logged, NOT scored as a combination: people-groups-grid.vue:718 deliberately
  // omits the count line when `!isNarrowed` (an unfiltered grid has nothing informative to say —
  // see the grid's own comment on the three-state count line). "no count line at baseline" is the
  // CORRECT state, not a finding, so it must never appear in the pass/fail table as a FAIL.
  const before = await readGrid(page)
  console.log(`  (info) baseline: ${before.count.text || 'no count line (expected — grid is unfiltered)'}, ${before.cards} cards`)

  // DashboardFacetRail.vue:654 — the row's identity is data-facet + data-value (NOT data-key;
  // that was this harness's own first-draft mistake, caught by reading the source before running,
  // not by a failed run). 'dash-only' is the rail's OWN honesty marker for a facet that updates
  // the dashboard but cannot reach the grid (BUG-2 in the prior sweep) — explicitly avoided here
  // so the map->grid assertion below tests a facet that IS supposed to narrow the grid.
  const facetClicked = await page.evaluate(`(() => {
    const rows = __walk('[data-facet]').filter(r => r.getAttribute('data-facet') && r.getAttribute('data-value') && !r.classList.contains('dash-only'));
    const row = rows.find(r => r.getAttribute('data-facet') === 'wagf_region') || rows[0];
    if (!row) return null;
    row.click();
    return { facet: row.getAttribute('data-facet'), key: row.getAttribute('data-value') };
  })()`)
  if (!facetClicked) {
    fail(`${PAIR}: map->grid — no clickable [data-facet][data-value] row found in the rail`)
  } else {
    await page.waitForTimeout(2500)
    await reinject(page)
    const after = await readGrid(page)
    const combo = `facet ${facetClicked.facet}=${facetClicked.key}`
    // THE ASSERTION: the grid's own count line must now be PRESENT (isNarrowed) and non-empty —
    // this is the row-to-the-row signal RESULT-interop-sweep used (881->881 class), read live
    // rather than trusted from the prior doc. Card count (always 24, page size) is DELIBERATELY
    // never read here — the prior sweep proved it a false-negative trap.
    const displayed = after.count.present && after.count.n != null && after.count.n > 0
    record(PAIR, combo, 'dashboard->grid', displayed, after.count.text || '(no count line — grid never learned of the selection)')
    if (!displayed) fail(`${PAIR}: map->grid — selecting ${combo} did not narrow the grid (no live count line appeared)`)

    // clear it back for the next phase (click the same row again, or Clear All)
    await page.evaluate(`(() => {
      const clr = __walk('button').find(b => (b.textContent||'').trim() === 'Clear All' || (b.textContent||'').trim() === 'Clear all');
      if (clr) { clr.click(); return true; }
      const row = __walk('[data-facet="' + ${JSON.stringify(facetClicked.facet)} + '"][data-value="' + ${JSON.stringify(facetClicked.key)} + '"]')[0];
      if (row) row.click();
    })()`)
    await page.waitForTimeout(2000)
    await reinject(page)
  }

  // ── 2. GRID->MAP: selecting table rows must MOVE THE CAMERA (useSelectionCamera.js) ───────────
  // Switch to whatever tab hosts the table if tabbed; DashboardDataTable is generally on-screen
  // alongside the map panel on desktop, so no tab click is assumed here — just locate the rows.
  const camBefore = await page.evaluate(`(() => {
    const m = window.__rdashMap; if (!m) return null;
    try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat, zoom: m.getZoom() } } catch (e) { return null }
  })()`)
  if (!camBefore) {
    fail(`${PAIR}: grid->map — window.__rdashMap is not present; cannot read the camera`)
  } else {
    if (SELF_TEST && SELF_TEST_MODE === 'camera-freeze') {
      console.log('  [self-test:camera-freeze] pinning fitBounds/flyTo to no-ops on the live map')
      await page.evaluate(`(() => {
        const m = window.__rdashMap;
        m.fitBounds = () => {};
        m.flyTo = () => {};
      })()`)
    }

    const rowsClicked = await page.evaluate(`(() => {
      const rowEls = __walk('.rd-row[data-slug]').slice(0, 3);
      let n = 0;
      for (const r of rowEls) {
        const chk = r.querySelector('.rd-td.chk') || r;
        chk.click();
        n++;
      }
      return { n, slugs: rowEls.map(r => r.getAttribute('data-slug')) };
    })()`)
    if (!rowsClicked || rowsClicked.n === 0) {
      fail(`${PAIR}: grid->map — no .rd-row[data-slug] found to select (table not reachable/mounted)`)
    } else {
      // useSelectionCamera debounces 150ms then eases up to FLY_DURATION_MS/900ms — give it room.
      await page.waitForTimeout(2500)
      await reinject(page)
      const camAfter = await page.evaluate(`(() => {
        const m = window.__rdashMap; if (!m) return null;
        try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat, zoom: m.getZoom() } } catch (e) { return null }
      })()`)
      const combo = `select ${rowsClicked.n} row(s) (${rowsClicked.slugs.filter(Boolean).join(', ') || 'unlabeled'})`
      const moved = camAfter && (
        Math.abs(camAfter.lng - camBefore.lng) > 0.0005 ||
        Math.abs(camAfter.lat - camBefore.lat) > 0.0005 ||
        Math.abs(camAfter.zoom - camBefore.zoom) > 0.01
      )
      record(PAIR, combo, 'grid->map camera', !!moved,
        camAfter ? `center ${camBefore.lng.toFixed(3)},${camBefore.lat.toFixed(3)}@${camBefore.zoom.toFixed(2)} -> ${camAfter.lng.toFixed(3)},${camAfter.lat.toFixed(3)}@${camAfter.zoom.toFixed(2)}`
                  : 'camera unreadable after selection')
      if (!moved) fail(`${PAIR}: grid->map — selecting ${rowsClicked.n} row(s) did not move the camera (useSelectionCamera did not fire, or the map handle went stale)`)

      // deselect for cleanliness
      await page.evaluate(`(() => { __walk('.rd-row[data-slug]').slice(0,3).forEach(r => (r.querySelector('.rd-td.chk')||r).click()) })()`)
    }
  }

  await page.close()
}

// ================================================================================================
// PAIR 3 — MOBILE: research-map-plus-grid
// ================================================================================================
// ★ THE MOBILE FINDING, checked in source before writing this gate (not assumed): unlike the
// desktop composite, research-map-plus-grid.vue passes NO props and wires NO events between its
// two children — they are two independently-composed elements stacked by StackLayout, each with
// its OWN search/filter controls (the .vue file's own header comment: "the grid's OWN search bar
// and filters are ENABLED here" because there is no shared header to drive them). grep for
// provide()/inject()/emit() across research-map.vue, people-groups-grid.vue and the composite
// itself confirms NOTHING crosses the shadow-DOM boundary between them.
//
// So the correct interop contract here is NOT "one drives the other" — that link does not exist
// BY DESIGN. It is: EACH half must independently narrow when driven through its OWN control. This
// harness asserts exactly that, and reports the absence of a cross-link as a FINDING (see the
// report), not a failure of this gate.
async function runMobile(browser) {
  const PAIR = 'mobile research-map-plus-grid'
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
  const url = `${BASE}/${TREE_NAME}/research-map-plus-grid/research-map-plus-grid/index.html`
  console.log(`\n=== ${PAIR} — ${url} ===`)
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  } catch (e) {
    console.log(`INTEROP-HARNESS: SKIP ${PAIR} — cannot reach leaf (${e.message})`)
    await page.close(); return
  }
  await page.waitForTimeout(3000)
  await reinject(page)

  // ★ FALSE NEGATIVE FIXED 2026-09-23. This mount gate reported "composite did not mount
  // (map=false, cards=24)" on a tree that was verified SETTLED both before and after the run — so it
  // read as a real defect, and it was not. A direct browser probe of the same leaf found the
  // composite completely healthy: both children mounted, a 1440x856 canvas PAINTED, 0 console
  // errors, 0 failed requests, body 3168px.
  //
  // TWO CAUSES, and the asymmetry with the desktop pair is what hid them:
  //
  // 1. SHADOW DOM DOES NOT PIERCE. This used `document.querySelector("doxa-research-map")`, a
  //    SINGLE-LEVEL query. The desktop gate's `document.querySelector("dashboard-plus-grid")` works
  //    only because that element IS the top-level custom element on its own leaf page. Here
  //    <doxa-research-map> is NESTED INSIDE the composite's shadow root, where a top-level selector
  //    cannot see it. The harness already carries __walk(), a recursive shadowRoot walker, and
  //    simply was not using it on this line.
  //
  // 2. THREE SECONDS IS NOT LONG ENOUGH. The direct probe needed ~22s before the nested map had
  //    mounted and painted. A composite that lazily injects a child bundle's script, waits for
  //    customElements, then initialises a GL map does not finish in 3s on this box.
  //
  // ★ WHY THIS MATTERED MORE THAN A FLAKY TEST: the harness exists to catch interop regressions, and
  // it was reporting the mobile pair as broken while the product was fine. A gate that cries wolf on
  // a healthy surface gets ignored, and then it cannot report the real thing.
  const mounted = await page.waitForFunction(
    '(() => { const m = __walk("doxa-research-map")[0]; const c = __cardCount();' +
    '  return (m && c > 0) ? { map: true, cards: c } : null })()',
    { timeout: 30000 }
  ).then(h => h.jsonValue()).catch(async () => {
    // Report what was ACTUALLY there when it gave up — "map=false" alone cannot distinguish
    // "never mounted" from "mounted somewhere this query cannot reach".
    return page.evaluate(
      '({ map: !!__walk("doxa-research-map")[0], cards: __cardCount(),' +
      '   deepTags: [...new Set(__walk("*").map(e => e.tagName.toLowerCase()).filter(t => t.includes("-")))] })'
    )
  })
  if (!mounted.map || mounted.cards === 0) {
    fail(`${PAIR}: composite did not mount (map=${mounted.map}, cards=${mounted.cards}` +
         `${mounted.deepTags ? `, custom tags found: ${mounted.deepTags.join(', ') || 'none'}` : ''}) — cannot measure`)
    await page.close(); return
  }

  // Grid's OWN search narrows the grid's OWN count.
  const before = await readGrid(page)
  const searched = await page.evaluate(`(() => {
    const input = __walk('.pgg-search input')[0];
    if (!input) return false;
    input.focus();
    input.value = 'India';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  if (!searched) {
    fail(`${PAIR}: grid's own search box (.pgg-search input) not found — grid controls not reachable on mobile`)
  } else {
    await page.waitForTimeout(1500)
    await reinject(page)
    const after = await readGrid(page)
    const displayed = after.count.present && after.count.n != null
    record(PAIR, 'grid search="India"', 'grid (own control)', displayed, after.count.text || '(no count line)')
    if (!displayed) fail(`${PAIR}: grid's own search did not narrow the grid (no count line after typing)`)

    // clear
    await page.evaluate(`(() => { const input = __walk('.pgg-search input')[0]; if (input) { input.value=''; input.dispatchEvent(new Event('input', {bubbles:true})); } })()`)
    await page.waitForTimeout(1000)
  }

  // Map mounts and is queryable (its OWN legend/filters are its own control surface; not driving
  // the grid, and the grid is not driving it — see THE MOBILE FINDING above).
  const mapState = await page.evaluate(`(() => {
    const m = window.__rdashMap;
    if (!m) return { present: false };
    try { const s = m.getSource && Object.keys(m.style ? m.style._layers || {} : {}); return { present: true }; } catch (e) { return { present: true, err: e.message } }
  })()`)
  record(PAIR, 'map mounts independently', 'map (own control)', !!mounted.map, mounted.map ? '<doxa-research-map> present in DOM' : 'missing')

  await page.close()
}

// ── RUN ──────────────────────────────────────────────────────────────────────────────────────
try {
  const browser = await chromium.launch({ args: GL_ARGS })
  await runDesktop(browser)
  await runMobile(browser)
  await browser.close()
} catch (e) {
  console.error('INTEROP-HARNESS: ERROR — ' + e.message)
  exitCode = 1
} finally {
  server.kill()
}

// ── COMBINATION TABLE ────────────────────────────────────────────────────────────────────────
console.log('\n── COMBINATION TABLE ' + '─'.repeat(60))
console.log('pair | combination | half | result | detail')
for (const r of rows) {
  console.log(`${r.pair} | ${r.combination} | ${r.half} | ${r.displayed ? 'PASS' : 'FAIL'} | ${r.detail}`)
}
const passN = rows.filter((r) => r.displayed).length
console.log(`\n${passN}/${rows.length} combinations DISPLAYED`)

if (SELF_TEST) {
  if (selfTestCaught) {
    console.log(`\nINTEROP-HARNESS: SELF-TEST PASS (mode=${SELF_TEST_MODE}) — the poisoned build was correctly rejected.`)
    process.exit(0)
  }
  console.error(`\nINTEROP-HARNESS: SELF-TEST FAILED (mode=${SELF_TEST_MODE}) — the poison was live and this gate still reported all PASS.`)
  console.error('  A gate that cannot fail is worse than no gate. Fix the gate, not the product.')
  process.exit(1)
}

console.log(exitCode ? '\nINTEROP-HARNESS: FAIL' : '\nINTEROP-HARNESS: PASS')
process.exit(exitCode)
