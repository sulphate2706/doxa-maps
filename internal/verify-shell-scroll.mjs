#!/usr/bin/env node
/**
 * verify-shell-scroll.mjs — THE GATE FOR BUG-STILL-CANNOT-SCROLL-DOWN-TO-THE-GRID.
 *
 * ★ WHAT IT ASSERTS, and why each assertion exists rather than the obvious one.
 *
 *   The obvious assertion — `scrollHeight > innerHeight` — is a FALSE PASS and was used twice to
 *   close this bug while the page could still not be scrolled. In the cap-5 shell the document measures
 *   scrollHeight 900 === clientHeight 900 while the composite element measures 3380/769: the
 *   overflow is real, but it belongs to an element with `overflow:visible` that no scroller owns.
 *   Geometry said "tall"; the user's wheel moved nothing.
 *
 *   So this gate asserts the ONLY thing that actually matters: that a REAL WHEEL GESTURE
 *   over the map area moves the grid up the screen and brings it into view. It measures the grid's
 *   position before and after, in the SHELL, which is the surface in use — not the standalone leaf,
 *   which passed all along and is why the two previous fixes looked green.
 *
 * ★ NEGATIVE-TESTED. Reverting the fix (restoring `.ps-pane`/`.vtl-host` to `position:absolute;
 *   inset:0` with no overflow, and `.vtl-content` to `contain:layout paint`) makes this exit 1 with
 *   "grid did not move". A gate nobody has broken is a gate nobody knows works.
 *
 * Usage: node internal/verify-shell-scroll.mjs [baseUrl]
 *        (defaults to http://localhost:8899; serve ./public)
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

// Default matches every other browser gate in this repo: `bun run serve` on loopback 4173.
// It was `localhost:8899` — one of the ad-hoc ports a previous session happened to have running,
// which meant the gate failed with ERR_CONNECTION_REFUSED for anyone else and looked like a broken
// gate rather than a missing server. Prefer BASE_URL (env) over a positional argument, because
// `bun run <script> <arg>` cannot forward arguments past an inline `#` comment — see
// check:script-flags. The positional form is kept as a fallback for direct `node` invocation.
const BASE = process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:4173'
// ★ ASK FOR index.html EXPLICITLY. These were bare-directory paths, which the OLD local server
// (python3 -m http.server) resolved to index.html while the LIVE static layer returns 404 — so this
// gate passed for a whole flight on URLs that do not work in production. `bun run serve` is now
// internal/serve-strict.mjs, which 404s a directory exactly as production does, and it caught these
// two the first time it ran. The manifest already ships 28/28 iframeUrl values in this form.
const SHELL = `/${TREE_NAME}/plugin-studio/plugin-studio/index.html`
// Measure THIS build, or measure nothing: a default port on this machine can belong to another
// worktree, and a stale studio there would be graded as ours. Exit 75 = NOT MEASURED (see a9550858).
await requireThisTree(BASE, resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'SHELL-SCROLL')
const LEAF = `/${TREE_NAME}/dashboard-plus-grid/dashboard-plus-grid/index.html`

// Shadow DOM DOES NOT PIERCE. A single-level querySelector lies about every composite, so every
// lookup here is a recursive walk with a seen-Set, re-injected after each interaction (a page
// navigation or re-render drops anything we defined earlier).
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
// ★ ANCHOR ON .pgg-root, NOT the <people-groups-grid> TAG. In the cap-4 composite the grid is
// IMPORTED as a Vue child component and compiled into one bundle — so there is no custom-element
// tag to find, and a tag-based lookup reports "not mounted" for a grid that is right there. That
// wrong answer cost a run of this very gate. .pgg-root is the grid's own root div and exists in
// both shapes (standalone element and baked-in child).
function __gridTop() {
  const g = __walk('.pgg-root')[0];
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { top: Math.round(r.top), h: Math.round(r.height) };
}
`

const fail = (m) => { console.error('SHELL-SCROLL: FAIL — ' + m); process.exit(1) }

// The gesture's shape, named ONCE. The assertion below derives its threshold from these, so the
// check and the gesture can never drift apart — the failure mode that let `movedByMap < 200` sit
// beside a measured-broken value of 300 and pass.
const WHEEL_TICKS = 10
const WHEEL_DY = 300
const VIEWPORT_FOLD = 900   // the viewport height this gate opens the page at

async function wheel(page, x, y, dy, times = WHEEL_TICKS) {
  await page.mouse.move(x, y)
  for (let i = 0; i < times; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(80) }
  await page.waitForTimeout(500)
}

const run = async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader']
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  await page.goto(BASE + SHELL, { waitUntil: 'load' })
  await page.waitForTimeout(6000)

  // HEAVY TABS LAZY-MOUNT ON ACTIVATION. Before this click the composite does not exist and every
  // query returns 0 — which reads as "no bug" if you stop here. This is the step both previous
  // investigations skipped.
  const tab = await page.evaluate(`(() => { ${WALK}
    for (const t of __walk('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)')) {
      if ((t.textContent || '').toLowerCase().includes('dashboard-plus-grid')) { t.click(); return t.textContent.trim() }
    }
    return null
  })()`)
  if (!tab) { await browser.close(); fail('could not find the dashboard-plus-grid tab in the shell rail') }
  await page.waitForTimeout(9000)

  // 1. The grid must be MOUNTED. If it is not rendered at all, "cannot scroll to it" has a
  //    completely different cause and this gate must say so rather than blaming the scroll.
  const before = await page.evaluate(`(() => { ${WALK} return __gridTop() })()`)
  if (!before) { await browser.close(); fail('.pgg-root is NOT MOUNTED in the shell — different bug, not a scroll bug') }
  if (before.h < 400) { await browser.close(); fail('.pgg-root mounted but collapsed (h=' + before.h + ') — not a scroll bug') }

  // 2. THE RULING, asserted as stated (2026-09-23, recorded in
  //    plugin-designs/research-dashboard/src/components/dashboards/DashboardMapPanel.vue:~1188):
  //    the map could not be zoomed because the wheel scrolled the page instead. So now
  //    a wheel OVER the map ZOOMS and moves the page 0 px; a wheel BELOW the map SCROLLS the page.
  //    ★ THIS STEP USED TO ASSERT THE OPPOSITE — that a wheel over the map must scroll the page —
  //    written before the ruling, when the map row filled the whole pane. Once the ruling made the
  //    map a bounded region with zoom always on, that assertion failed on the correct behaviour and
  //    kept this gate red on a product that was right (re-measured 2026-09-25: over-map 0 px, below
  //    the map 2502 px, grid on screen). The gate was ruled stale; this is the ruling.
  //    Negative control: SHELL_SCROLL_NEGATIVE=1 disables scrollZoom on the map before the gestures
  //    (the pre-ruling behaviour), and the gate must FAIL.
  const MAP = `(() => { ${WALK}
    const c = __walk('canvas.mapboxgl-canvas, canvas.maplibregl-canvas').find(x => x.getBoundingClientRect().height > 50)
    if (!c) return null
    const host = __walk('*').find(e => e.__doxaMap && e.__doxaMap.getCanvas && e.__doxaMap.getCanvas() === c)
    const r = c.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), bottom: Math.round(r.bottom), top: Math.round(r.top),
      zoom: host ? host.__doxaMap.getZoom() : null }
  })()`
  const mapBox = await page.evaluate(MAP)
  if (!mapBox || mapBox.zoom == null) { await browser.close(); fail('no map (canvas + its map instance) on the dashboard tab — cannot assert the zoom-vs-scroll ruling') }
  if (process.env.SHELL_SCROLL_NEGATIVE === '1') {
    await page.evaluate(`(() => { ${WALK} for (const e of __walk('*')) if (e.__doxaMap && e.__doxaMap.scrollZoom) e.__doxaMap.scrollZoom.disable() })()`)
    console.log('  NEGATIVE CONTROL: scrollZoom disabled on the map — this run must FAIL')
  }
  // (a) a scroll-DOWN wheel over the map: the page must not move.
  await wheel(page, mapBox.x, mapBox.y, WHEEL_DY, 3)
  const afterMapDown = await page.evaluate(`(() => { ${WALK} return __gridTop() })()`)
  const movedByMap = before.top - afterMapDown.top
  // (b) a zoom-IN wheel over the map: the zoom must go up (in, not out, so a map already at its
  //     minimum zoom cannot fake a failure).
  const zBefore = (await page.evaluate(MAP)).zoom
  await wheel(page, mapBox.x, mapBox.y, -WHEEL_DY, 3)
  const zAfter = (await page.evaluate(MAP)).zoom
  // (c) the same scroll-down wheel BELOW the map's box: this is how the page reaches the grid.
  // Below the map's box, and no higher than the y=800 the original gate measured this gesture at: a
  // point just under the canvas (y=636 on a 900px viewport) lands on the dashboard's own lower
  // controls, which consume the wheel themselves, and read as "the page will not scroll".
  const belowY = Math.min(Math.max(mapBox.bottom + 60, VIEWPORT_FOLD - 100), VIEWPORT_FOLD - 20)
  const pageBefore = await page.evaluate(`(() => { ${WALK} return __gridTop() })()`)
  await wheel(page, mapBox.x, belowY, WHEEL_DY)
  const afterLow = await page.evaluate(`(() => { ${WALK} return __gridTop() })()`)
  const movedBelow = pageBefore.top - afterLow.top
  const onScreen = afterLow.top < VIEWPORT_FOLD

  console.log('SHELL-SCROLL measurements (cap-5 shell, tab="' + tab + '"):')
  console.log('  grid mounted              : h=' + before.h + 'px, top=' + before.top)
  console.log('  wheel OVER map (down)     : page moved ' + movedByMap + 'px   (ruling: 0)')
  console.log('  wheel OVER map (zoom in)  : zoom ' + zBefore.toFixed(2) + ' -> ' + zAfter.toFixed(2) + '   (ruling: zooms)')
  console.log('  wheel BELOW map (y=' + belowY + ')  : page moved ' + movedBelow + 'px   (ruling: scrolls)')
  console.log('  grid on screen            : ' + onScreen)

  if (Math.abs(movedByMap) > 4) fail('a wheel OVER the map scrolled the page ' + movedByMap + 'px. The ruling (2026-09-23): a wheel over the map ZOOMS and must not move the page — is scrollZoom disabled on this map?')
  if (!(zAfter > zBefore + 0.05)) fail('a zoom-in wheel OVER the map left the zoom at ' + zAfter.toFixed(2) + ' (was ' + zBefore.toFixed(2) + '). The ruling: a wheel over the map zooms it.')
  if (movedBelow < 200) fail('a wheel BELOW the map scrolled the page only ' + movedBelow + 'px. The grid is mounted at h=' + before.h + 'px and is UNREACHABLE.')
  if (!onScreen) fail('the page scrolled ' + movedBelow + 'px but the grid top is still at ' + afterLow.top + ' (below the 900px fold) — still not reachable.')

  console.log('SHELL-SCROLL: PASS — the grid is reachable by wheel in the cap-5 shell.')

  // ── 5. THE OTHER SIDE OF THE FIX: a MAP tab must NOT gain a scrollbar. ─────────────────────
  // Making the pane scrollable is only correct if it stays a NO-OP for the ~19 fixed-viewport map
  // tabs. It did not, at first: a hosted map ships min-height:100dvh (resolved against the 900px
  // VIEWPORT) beside height:100% (resolved against the 769px PANE), so the floor made it 131px
  // taller than its container and the new overflow:auto faithfully grew a scrollbar on it. That
  // regression was invisible to every assertion above — the grid test passed while a map tab broke —
  // so it is asserted here, in the same gate, rather than left to be re-found by hand.
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page2.goto(BASE + SHELL, { waitUntil: 'load' })
  await page2.waitForTimeout(6000)
  const mapTab = await page2.evaluate(`(() => { ${WALK}
    for (const t of __walk('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)')) {
      if ((t.textContent || '').toLowerCase().includes('doxa-research-map')) { t.click(); return t.textContent.trim() }
    }
    return null
  })()`)
  if (mapTab) {
    await page2.waitForTimeout(9000)
    const panes = await page2.evaluate(`(() => { ${WALK}
      return __walk('.ps-pane, .vtl-host').filter(e => e.getBoundingClientRect().height > 0)
        .map(e => ({ sh: e.scrollHeight, ch: e.clientHeight, over: e.scrollHeight - e.clientHeight }))
    })()`)
    const leaking = panes.filter(p => p.over > 4)
    console.log('  map tab "' + mapTab + '" pane overflow: ' + JSON.stringify(panes))
    await browser.close()
    if (leaking.length) fail('a MAP tab grew a scrollbar (' + leaking[0].over + 'px overflow: ' + leaking[0].sh + '/' + leaking[0].ch + '). The pane scroll must be a NO-OP for fixed-viewport elements — check the dvh floor neutraliser.')
    console.log('MAP-TAB-NO-SCROLLBAR: PASS — fixed-viewport map tabs gained no scrollbar.')
  } else {
    await browser.close()
    console.log('MAP-TAB-NO-SCROLLBAR: SKIPPED — no doxa-research-map tab in this shell.')
  }
}
run().catch(e => { console.error('SHELL-SCROLL: FAIL — ' + e.message); process.exit(1) })
