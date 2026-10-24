#!/usr/bin/env node
/**
 * check-spa-tab-order.mjs — the cap-5 product SPA must open on the Big Picture, in the specified order.
 *
 * WHAT THIS PROTECTS. The rail's order is PUBLISHED (the Deep Research page, 2026-09-29) and must not
 * change: Big Picture, Simple Research, Regions · Prayer Progress, UPG-100 List · Cities with Internet,
 * Gospel Resources, then the Experimental folder. Tab 1 is not a preference — it is the LANDING
 * SURFACE, the first thing anyone opening doxa-maps-spa sees, and the opening step of the
 * onboarding ramp. Today that ordering is held only by the order of entries in a source array and
 * by comments explaining why; nothing fails if someone reorders them.
 *
 * ★ WHY THIS IS EASY TO BREAK WITHOUT NOTICING. NAV_MODEL is also where sections, badges and
 * narrow-screen flags live, so it gets edited for reasons that have nothing to do with ordering —
 * and a row moved while adding a badge produces no error, no console warning, and a SPA that still
 * works perfectly. It just opens somewhere else. The nav file's own comments record that "Big
 * Picture" was once painted TWICE in the rail, from a one-row section that re-declared a row below;
 * that is the same class of accident.
 *
 * ★ IT ASSERTS THE RENDERED RAIL, NOT THE SOURCE ARRAY. Parsing NAV_MODEL is what I tried first and
 * it returned an EMPTY list — the entries do not carry the `id:` shape I assumed, and a regex over
 * a 300-line commented array is guesswork either way. The rail is the thing the user sees, it is
 * what was described, and reading it requires no assumption about how it is built. A source
 * parse could also pass while a rendering bug shows a different order.
 *
 * ORDER, NOT MEMBERSHIP. Checking that four names are present would pass on a rail that opens on
 * Gospel Resources. The assertion is the SEQUENCE, matched as prefixes so a row may carry a
 * subtitle ("Big Picture — dashboard + people-groups grid") without failing.
 *
 * PRECONDITION: a built tree and `bun run serve` on 4173. No Mapbox token needed — the rail renders
 * before any map mounts, and heavy tabs lazy-mount on activation, which this never triggers.
 *
 * NEGATIVE-TESTED: swapping the first two entries of NAV_MODEL fails by name, printing expected vs
 * actual side by side.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { requireDevServesThisCheckout as __devGuard, requireThisTree as __treeGuard } from './_serves-this-tree.mjs'
import { fileURLToPath as __f2p } from 'node:url'
import { dirname as __dn, resolve as __rs } from 'node:path'
import { TREE_NAME } from './_tree-name.mjs'
const __ROOT = __rs(__dn(__f2p(import.meta.url)), '..')

const BASE = process.env.BASE_URL || `http://127.0.0.1:4173/${TREE_NAME}`
// Measure THIS checkout, or measure nothing (exit 75 = NOT MEASURED; see _serves-this-tree.mjs).
await __treeGuard(BASE, __ROOT, 'SPA-TAB-ORDER')

// The specified sequence, verbatim from the open-work brief. Prefix-matched (case-insensitive,
// whitespace-collapsed) so a row may carry its subtitle.
// The specified four, asserted as a RELATIVE ORDER rather than as positions 1-4.
//
// ⚠ THIS USED TO DEMAND A FOUR-ROW RAIL, and it had been FAILING ever since the rail gained its
// three-section structure (4c74bd7, 2026-09-23, "Restore three-section tab structure:
// Dashboards / Prayer Mobilization / Gospel Research"). MEASURED 2026-09-24: the rail renders
// SEVEN rows —
//   Big Picture · Simple Research · Regions · UPG-100 List · Prayer Progress ·
//   Cities with Internet · Gospel Resources
// — and the specified four are ALL PRESENT, at 0/3/4/6, in their specified relative order. The
// product honours the instruction; this gate was asserting a shape the instruction never named.
// It quoted the brief correctly and then over-read it: "(Big Picture, UPG-100, Prayer Progress,
// Gospel Resources)" names an ORDER, not a row count, and nothing there forbids a row between.
//
// So: assert what was actually specified. Tab 1 must still be Big Picture — that IS positional,
// it is the landing surface — and the other three must appear after it, in order.
// ★ ALL SEVEN SINCE 2026-09-29. The published Deep Research order names every production row, so the
// gate asserts every one of them, in order; the earlier four-name list had UPG-100 before Prayer
// Progress, which the published order reverses. As before, the order is relative: a row between two
// named ones is allowed, a named row out of order is not; tab 1 is positional.
const EXPECTED = ['Big Picture', 'Simple Research', 'Regions', 'Prayer Progress', 'UPG-100', 'Cities with Internet', 'Gospel Resources']

const WALK = `(sel)=>{const o=[],s=new Set();const w=(r)=>{if(!r||s.has(r))return;s.add(r);try{o.push(...r.querySelectorAll(sel))}catch(e){};for(const e of r.querySelectorAll('*'))if(e.shadowRoot)w(e.shadowRoot)};w(document);return o}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
let rows = []
let err = null
try {
  // ★ EXPLICIT index.html, never a directory URL. `bun run serve` is serve-strict.mjs, which 404s a
  // directory request with no index fallback BECAUSE THE LIVE STATIC LAYER DOES. Under the old
  // python3 -m http.server this line passed, since that server silently resolved the directory —
  // so this gate was green locally and would have 404'd against production. Measured 2026-09-23:
  // `.../doxa-maps-spa/doxa-maps-spa/` -> 404, `.../index.html` -> 200. The symptom was maximally
  // misleading: a 404 page has no rail, so the gate reported "no .vtl-tab rows found in the composed
  // tree", which reads as a missing tab strip rather than a missing page. Its own next line warns
  // about exactly this confusion for a different cause (shadow roots), and that warning is what
  // makes the wrong reading tempting. Same defect class serve-strict was built to expose after it
  // hid a bad URL in verify-shell-scroll for a whole flight; a repo-wide sweep found this was the
  // last remaining directory URL in internal/.
  await page.goto(`${BASE}/doxa-maps-spa/doxa-maps-spa/index.html`, { waitUntil: 'load', timeout: 45000 })
  await page.waitForTimeout(8000)
  // ⚠ DEDUPE: '.vtl-tab' matches NESTED elements, so each rendered row comes back ~5 times —
  // measured 35 matches for 7 real rows. The old code took the first four of that list, which
  // were all fragments of rows 1 and 2, and then reported them as rows 1-4. Keep only the
  // OUTERMOST match per row (one that has no .vtl-tab ancestor), which is the row itself.
  rows = await page.evaluate(
    `(${WALK})('.vtl-tab')
       .filter(t => !t.parentElement || !t.parentElement.closest('.vtl-tab'))
       .map(t => (t.textContent || '').trim().replace(/\\s+/g, ' '))`
  )
} catch (e) {
  err = e.message.slice(0, 160)
}
await browser.close()

if (err) {
  console.error('SPA-TAB-ORDER: FAIL — could not load the cap-5 SPA: ' + err)
  console.error('  Needs a built tree and `bun run serve` on 4173. Reported as a FAILURE, not a')
  console.error('  skip: a gate that cannot reach its subject has not passed, it has not run.')
  process.exit(1)
}
if (!rows.length) {
  console.error('SPA-TAB-ORDER: FAIL — no .vtl-tab rows found in the composed tree.')
  console.error('  The rail is inside a shadow root, so this walks recursively with a seen-Set; a')
  console.error('  flat querySelectorAll returns 0 here and would read as "no tabs" rather than')
  console.error('  "wrong tool".')
  process.exit(1)
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// Where each expected name lands in the RENDERED rail. -1 = absent.
const at = EXPECTED.map((want) => rows.findIndex((r) => norm(r).startsWith(norm(want))))
const fails = []

// 1. PRESENCE. A specified name must be in the rail at all.
EXPECTED.forEach((want, i) => {
  if (at[i] === -1) fails.push(`"${want}" is not in the rail at all`)
})
// 2. TAB 1 IS POSITIONAL, and only tab 1. It is the landing surface — the first thing anyone
//    opening the SPA sees — which is a claim about position, not merely about order.
if (at[0] > 0) {
  fails.push(`tab 1 is "${(rows[0] || '').slice(0, 40)}", not "${EXPECTED[0]}" — the SPA opens `
    + 'somewhere other than the landing surface')
}
// 3. THE REST ARE RELATIVE. The instruction named an order, not a row count, so a row sitting
//    between two of them is not a violation — a row OUT OF ORDER is.
for (let i = 1; i < EXPECTED.length; i++) {
  if (at[i] !== -1 && at[i - 1] !== -1 && at[i] < at[i - 1]) {
    fails.push(`"${EXPECTED[i]}" (row ${at[i] + 1}) comes before "${EXPECTED[i - 1]}" `
      + `(row ${at[i - 1] + 1}) — the specified order is reversed here`)
  }
}

if (fails.length) {
  console.error(`SPA-TAB-ORDER: FAIL — ${fails.length} problem(s) with the specified rail order.\n`)
  for (const f of fails) console.error('  - ' + f)
  console.error('\n  Rendered rail:')
  rows.forEach((r, i) => console.error(`    ${i + 1}. ${r.slice(0, 52)}`))
  console.error('\n  Tab 1 is the LANDING SURFACE — the first thing anyone opening the product SPA')
  console.error('  sees, and the opening step of the onboarding ramp. A reordered rail produces no')
  console.error('  error and a SPA that still works; it just opens somewhere else.')
  console.error('  The order lives in NAV_MODEL in plugin-designs/doxa-maps-spa/doxa-maps-spa.vue.')
  process.exit(1)
}

console.log(`SPA-TAB-ORDER: PASS — the rail opens in the specified order (${rows.length} rows total).`)
// Print the WHOLE rendered rail and mark the specified four, so a reader can see the rows that
// sit between them rather than only the names being asserted. A gate that prints just its own
// four would hide the very structure that made the old positional assertion wrong.
rows.forEach((r, i) => {
  const k = at.indexOf(i)
  console.log(`  ${String(i + 1).padStart(2)}. ${k >= 0 ? '★' : ' '} ${r.slice(0, 54)}`)
})
console.log('  Asserted on the RENDERED rail rather than on NAV_MODEL: the array is edited for')
console.log('  reasons unrelated to ordering (badges, sections, narrow-screen flags), and a source')
console.log('  parse can pass while a rendering bug shows something else.')
