#!/usr/bin/env node
/**
 * check-filter-width-stable.mjs — a filter trigger must not resize when an option is selected.
 *
 * THE DEFECT THIS CATCHES. `.filter-dropdown` was `flex: 1 1 160px; min-width:160px; max-width:240px`
 * — a RANGE, not a width — so flex-grow re-negotiated the moment
 * `<strong>{{ selectedOption.label }}</strong>` appeared in the label. Measured before the fix: the
 * row grew 960 → 1294px and individual triggers reached 240px.
 *
 * ★ WHY IT IS NOT COSMETIC: the selections row with Clear All sits
 * UNDERNEATH the filters. If a filter grows on selection, the row below re-flows and the whole group
 * stops being the aligned block that was asked for. The stable width is what makes the centred stack hold
 * still — so this is a layout invariant, not a preference about widths.
 *
 * The ellipsis rules were already present and doing nothing: `.filter-dropdown__label` lacked
 * `min-width: 0`, so as a flex item it was floored at min-content and refused to truncate. Both
 * halves are needed, which is why this asserts the OBSERVABLE outcome (width unchanged) rather than
 * the presence of either CSS property — a source grep for `--dx-filter-w` would pass while the
 * missing `min-width:0` still let the label push the box open.
 *
 * WHAT IT ASSERTS. On the standalone dashboard AND inside the cap-5 shell: record every trigger's
 * width with nothing selected, then select the LONGEST option in each dropdown, and require every
 * width to be unchanged.
 *
 * Selecting the longest option is the point. A short option fits inside the old range too, so a
 * probe that picks the first option passes on the broken build — the bug only appears when the
 * label exceeds the flex-basis.
 *
 * TWO HOSTS, because three defects this week were invisible standalone and only appeared in the
 * shell (dropdown containing-block, wheel scroll, grid affordances). An unmeasurable host is a
 * FAILURE here, not a skip: silence is how coverage rots.
 *
 * PRECONDITION: a built tree and `bun run serve` on 4173. No Mapbox token needed — this measures
 * DOM geometry, and the filter row renders with or without a basemap.
 *
 * NEGATIVE-TESTED: restoring `flex:1 1 160px; max-width:240px` on .filter-dropdown makes widths
 * diverge and this fails by name, naming the before/after arrays.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './lib/playwright-guarded.mjs'
import { servesThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.BASE_URL || `http://127.0.0.1:4173/${TREE_NAME}`

// ⚠ "ANSWERS 200" IS NOT "IS THIS BUILD". This machine runs several worktrees of one repo and
// the default port belongs to whichever server started first — measured 2026-09-24: :4173 was
// another worktree's. This gate compares filter widths BEFORE and AFTER a tab change and fails
// on divergence, so a run against someone else's tree can report a width regression in code
// that was never touched here. Separate that from the unreachable case below, which is already
// a SKIP: both are preconditions, neither is a product finding.
{
  const tree = await servesThisTree(BASE, REPO)
  if (/DIFFERENT build/.test(tree.why)) {
    console.log('FILTER-WIDTH: SKIP — the server is not serving THIS build.')
    console.log(`  ${tree.why}`)
    console.log('  Serve this checkout (`bun run serve`) and pass its port as BASE_URL.')
    process.exit(0)
  }
}
const WALK = `(sel)=>{const o=[],s=new Set();const w=(r)=>{if(!r||s.has(r))return;s.add(r);try{o.push(...r.querySelectorAll(sel))}catch(e){};for(const e of r.querySelectorAll('*'))if(e.shadowRoot)w(e.shadowRoot)};w(document);return o}`

async function measure(page, label, activateTab) {
  const widths = () =>
    page.evaluate(`(${WALK})('.filter-dropdown__trigger').map(t=>Math.round(t.getBoundingClientRect().width))`)

  if (activateTab) {
    // Heavy tabs lazy-mount on activation: before the click nothing exists and every query returns
    // 0, which reads as "no filters here" rather than "not mounted yet".
    const idx = await page.evaluate(`(${WALK})('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)').findIndex(t=>${activateTab}.test(t.textContent||''))`)
    if (idx < 0) return { label, error: 'no tab matched ' + activateTab }
    await page.evaluate(`(${WALK})('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)')[${idx}].click()`)
    await page.waitForTimeout(9000)
  }

  const before = await widths()
  if (!before.length) return { label, error: 'no .filter-dropdown__trigger found in the composed tree' }

  for (let i = 0; i < before.length; i++) {
    await page.evaluate(`(${WALK})('.filter-dropdown__trigger')[${i}].click()`)
    await page.waitForTimeout(300)
    // The LONGEST option — a short one fits the old range and passes on a broken build.
    await page.evaluate(`(()=>{const o=(${WALK})('.filter-dropdown__option');if(!o.length)return;
      let best=o[0];for(const x of o) if((x.textContent||'').length>(best.textContent||'').length) best=x;
      best.click()})()`)
    await page.waitForTimeout(350)
  }
  const after = await widths()
  return { label, before, after }
}

const browser = await chromium.launch()
// ★ EXPLICIT index.html, never a trailing slash (fixed 2026-09-23). `bun run serve` is
// serve-strict.mjs, which 404s a DIRECTORY request with no index fallback because the live static
// layer does. Both paths here ended in '/', so both loaded a 404 page — and a 404 page has no
// .filter-dropdown__trigger and no .vtl-tab, so the gate reported "UNMEASURED: no
// .filter-dropdown__trigger found in the composed tree" and "no tab matched /dashboard-plus-grid/i".
// Those read as missing FEATURES; they were a missing PAGE. Measured: both directory URLs return
// 404, both index.html URLs return 200.
//
// This survived a sweep that declared the class closed one tick earlier, because that sweep
// grepped for goto(`${BASE}...`) with a template literal and this file builds the URL as
// `BASE + path` string concatenation. A sweep is only as wide as its pattern — the re-sweep looked
// for any goto whose URL lacks '.html', which is a property of the RESULT rather than of the syntax.
//
// The tab regex was checked rather than assumed guilty: the studio renders a developer row reading
// "🔗dashboard-plus-grid<dashboard-plus-grid>", so /dashboard-plus-grid/i correctly matches tab #3.
// Single cause, not two.
const hosts = []
for (const [label, path, tab] of [
  ['STANDALONE research-dashboard', '/research-dashboard/research-dashboard/index.html', null],
  ['INSIDE cap-5 plugin-studio', '/plugin-studio/plugin-studio/index.html', '/dashboard-plus-grid/i'],
]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  try {
    const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 45000 })
    // ASSERT THE RESPONSE BEFORE ASSERTING CONTENT, so a missing page can never again be reported
    // as a missing feature.
    if (!res || res.status() !== 200) {
      hosts.push({ label, error: `HTTP ${res ? res.status() : 'no response'} for ${path} — nothing below this means anything` })
      await page.close(); continue
    }
    await page.waitForTimeout(7000)
    hosts.push(await measure(page, label, tab))
  } catch (e) {
    hosts.push({ label, error: e.message.slice(0, 140) })
  }
  await page.close()
}
await browser.close()

let failed = 0
let unreachable = 0
// ★ AN ABSENT SERVER IS NOT A PRODUCT FINDING, A MISSING CONTROL IS.
// The rule below ("an unmeasured host is a failure") is right and is kept: if the page loads and
// the trigger or tab cannot be found, the gate has been structurally defeated and must say so.
// But it was also firing when nothing had been measured AT ALL because no server was running —
// ERR_CONNECTION_REFUSED on :4173 printed "UNMEASURED" twice and then "FAIL — 2 host(s)". That
// accuses the product of a width regression on the strength of a missing process, and it cost a
// real misreading during this flight: the gate was reported as failing when it had simply never run.
// Every other browser gate in this repo already separates the two and says so in the same words —
// check-fits-the-screen, interop-harness, check-catalog-identity and check-legend-matches-source all
// print "SKIP — ... unreachable right now. Not a product finding." This one was the outlier.
const isUnreachable = (e) => /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ECONNREFUSED|net::ERR_|ERR_EMPTY_RESPONSE/i.test(String(e))
console.log('FILTER-WIDTH: a trigger must not resize when an option is selected\n')
for (const h of hosts) {
  console.log(`--- ${h.label} ---`)
  if (h.error) {
    if (isUnreachable(h.error)) {
      console.log('  UNREACHABLE: ' + h.error)
      unreachable++
      continue
    }
    // An unmeasured host is a failure. A gate that quietly drops a host reports success about
    // something it never looked at.
    console.log('  UNMEASURED: ' + h.error)
    failed++
    continue
  }
  const same = JSON.stringify(h.before) === JSON.stringify(h.after)
  console.log(`  empty    : ${JSON.stringify(h.before)}`)
  console.log(`  selected : ${JSON.stringify(h.after)}`)
  if (same) {
    console.log('  ok — identical\n')
  } else {
    failed++
    const grew = h.after.reduce((a, w, i) => a + Math.max(0, w - h.before[i]), 0)
    console.log(`  FAIL — widths changed; the row grew ${grew}px in total\n`)
  }
}

if (!failed && unreachable === hosts.length) {
  console.log(`FILTER-WIDTH: SKIP — all ${hosts.length} host(s) unreachable. Not a product finding.`)
  console.log('  Start a server first: `bun run serve` (or set BASE_URL).')
  process.exit(0)
}
if (failed) {
  console.error(`FILTER-WIDTH: FAIL — ${failed} host(s).`)
  console.error('  A trigger that grows on selection re-flows the selections row beneath it, so the')
  console.error('  filter band stops being a fixed block and the centred stack shifts under the user.')
  console.error('  Give .filter-dropdown a fixed width (var(--dx-filter-w)) rather than a flex RANGE,')
  console.error('  and give .filter-dropdown__label min-width:0 so it is allowed to ellipsise — a flex')
  console.error('  item without it is floored at min-content and pushes the box open regardless.')
  process.exit(1)
}
console.log('FILTER-WIDTH: PASS — widths identical before and after selecting the longest option,')
console.log('  in both hosts. The longest option is deliberate: a short one fits the old broken')
console.log('  range too, so picking the first option would pass on a build that still has the bug.')
