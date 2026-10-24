#!/usr/bin/env node
/**
 * check-scrim-covers-viewport.mjs — a full-screen SCRIM must cover the VIEWPORT in every host,
 * not just the content pane it happens to be rendered into.
 *
 * THE DEFECT THIS CATCHES. A modal scrim is written `position:fixed; inset:0` on the assumption
 * that fixed coordinates are viewport coordinates. That holds only while nothing in the ancestor
 * chain establishes a containing block for fixed descendants. VerticalTabsLayout — the cap-5 shell
 * every plugin is hosted in as a tab — sets `contain:layout` on .vtl-content. So the identical
 * scrim read, at a 1280x900 viewport:
 *     STANDALONE leaf page .............. 1280x900 @ (0,0)
 *     INSIDE the plugin studio .......... 1024x793 @ (256,107)
 * 256 is the rail width and 107 the header height. The scrim still LOOKS like a modal — it dims
 * the pane it sits in — while leaving the rail and header UNCOVERED AND CLICKABLE behind it. A
 * modal that does not capture input is not modal, which is why this is a correctness bug and not
 * a cosmetic one.
 *
 * ★ WHY A SOURCE GREP CANNOT ANSWER THIS. Every one of these scrims greps as a correct
 * `position:fixed;inset:0`. The bug is not in the declaration, it is in the ANCESTOR — and which
 * ancestors exist depends on the HOST, not on the component. The variable that matters is not the
 * CSS and not the viewport width, it is where the component is mounted. So this gate measures the
 * shipped element's rect inside the real shell and compares it against the viewport.
 *
 * ★ AND WHY THE SHADOW-ROOT REASSURANCE IS A TRAP. poster-wall.vue carried a comment saying
 * "position:fixed inside a shadow root is still viewport-relative, so this covers the whole app".
 * TRUE, and IRRELEVANT: a shadow boundary scopes styles and selectors, it does not create a
 * containing block. transform / filter / perspective / backdrop-filter / will-change of those —
 * or contain:layout|paint|strict|content — do. Reasoning about the shadow boundary answers a
 * question nobody asked, and it reads as a reason not to check.
 *
 * WHAT IT ASSERTS. For each (tab, trigger, scrim) case: open the scrim and require its rect to
 * equal the viewport rect exactly. On failure it names the capturing ancestor from a live
 * computed-style walk, so the report says `div.vtl-content [contain:layout]` rather than
 * "misplaced".
 *
 * PRECONDITIONS: the DEV server (`bun run dev` on :5173) — the studio is the host under test.
 * No Mapbox token needed: this measures DOM geometry and the scrims render without a basemap.
 * Browser gate, so NOT in build:unlocked and NOT in CI.
 *
 * NEGATIVE-TESTED: `--self-test` re-measures each scrim with the util's geometry stripped back to
 * a plain `inset:0` and requires EVERY case to fail. A gate that cannot fail is worse than no
 * gate, and this one is measuring a property that "looks fine" in a screenshot either way.
 *
 * Exit: 0 all pass · 1 any fail · 2 dev server unreachable (a precondition, not a defect).
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

const BASE = (process.env.DEV_URL || 'http://localhost:5173').replace(/\/+$/, '')
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees of this repo run on one machine and
// a default port belongs to whichever server started first — measured 2026-09-24, :4173 was another
// worktree's, and browser gates reported confidently on a build nobody here had touched. Exit 75
// (EX_TEMPFAIL) rather than 1: pointing at the wrong tree is a precondition, not a product defect,
// and the wave runner already reports 75 as ⊘ instead of ✗.
await requireThisTree(BASE, ROOT, 'SCRIM-COVERS-VIEWPORT')
const SELF_TEST = process.argv.includes('--self-test')
const VW = 1280, VH = 900

// Shadow DOM does not pierce: recursive walk with a seen-Set. A single-level querySelector
// reports 0 elements for every one of these components and reads as "no bug".
const DEEP = `(sel)=>{const out=[],seen=new Set();const w=(r)=>{if(!r||seen.has(r))return;seen.add(r);try{out.push(...r.querySelectorAll(sel))}catch(e){};for(const el of r.querySelectorAll('*'))if(el.shadowRoot)w(el.shadowRoot)};w(document);return out}`

// Buttons inside the CONTENT PANE only — the rail tabs are buttons too, and matching one of those
// by label silently "clicks the trigger" while opening nothing.
const PANE_BUTTONS = `(()=>{const pane=(${DEEP})('.vtl-content')[0];const seen=new Set();const out=[];const w=(r)=>{if(!r||seen.has(r))return;seen.add(r);for(const el of r.querySelectorAll('button'))out.push(el);for(const el of r.querySelectorAll('*'))if(el.shadowRoot)w(el.shadowRoot)};w(pane);return out})()`

const CASES = [
  { name: 'DataTable .dt-scrim',            tab: 'data-tables<cities',    scrim: '.dt-scrim',    rowTrigger: '.tabulator-row, .dt-row, tbody tr' },
  { name: 'DataTable .dt-scrim (gospel)',   tab: 'data-tables<gospel',    scrim: '.dt-scrim',    rowTrigger: '.tabulator-row, .dt-row, tbody tr' },
  { name: 'upg poster-wall .modal-scrim',   tab: 'poster-wall<my-upg',    scrim: '.modal-scrim', buttonRe: 'Prayer List' },
  { name: 'LegendTools .lt-overlay',        tab: 'countries-map<country-post', scrim: '.lt-overlay', buttonRe: '^⚙️$' },
]

const browser = await chromium.launch().catch(() => null)
if (!browser) { console.error('[scrim-covers-viewport] could not launch chromium'); process.exit(2) }
const page = await browser.newPage({ viewport: { width: VW, height: VH } })
page.on('pageerror', () => {})

const probe = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => null)
if (!probe) {
  console.error(`[scrim-covers-viewport] cannot reach ${BASE} — is \`bun run dev\` running?`)
  await browser.close(); process.exit(2)
}

let pass = 0, fail = 0, skip = 0
const failures = []
console.log(`SCRIM-VIEWPORT: viewport ${VW}x${VH}${SELF_TEST ? '  [--self-test: every case MUST fail]' : ''}`)

for (const c of CASES) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  // Heavy tabs lazy-mount ON ACTIVATION — click the tab, then wait, or every query returns 0.
  const onTab = await page.evaluate(`(()=>{const t=(${DEEP})('.vtl-tab').find(t=>(t.textContent||'').includes(${JSON.stringify(c.tab)})); if(!t) return false; t.click(); return true})()`)
  if (!onTab) { console.log(`?  ${c.name}: tab not found (${c.tab})`); skip++; continue }
  await page.waitForTimeout(7000)

  const opened = c.rowTrigger
    ? await page.evaluate(`(()=>{const r=(${DEEP})(${JSON.stringify(c.rowTrigger)}); if(!r.length) return false; r[0].click(); return true})()`)
    : await page.evaluate(`(()=>{const re=new RegExp(${JSON.stringify(c.buttonRe)},'i'); const b=${PANE_BUTTONS}.find(e=>re.test((e.textContent||'').trim())); if(!b) return false; b.click(); return true})()`)
  if (!opened) { console.log(`?  ${c.name}: trigger not found`); skip++; continue }
  await page.waitForTimeout(1800)

  const r = await page.evaluate(`(()=>{
    const s = (${DEEP})(${JSON.stringify(c.scrim)})[0];
    if (!s) return { open:false };
    ${SELF_TEST ? `s.setAttribute('style','position:fixed;inset:0');` : ''}
    const b = s.getBoundingClientRect();
    const cap = []; let el = s;
    while (el) {
      if (el.nodeType === 1) {
        const cs = getComputedStyle(el); const why = [];
        if (cs.transform && cs.transform !== 'none') why.push('transform');
        if (cs.filter && cs.filter !== 'none') why.push('filter');
        if (/paint|layout|strict|content/.test(cs.contain||'')) why.push('contain:'+cs.contain);
        if (why.length) cap.push((el.tagName||'').toLowerCase()+(typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\\s+/)[0]:'')+' ['+why.join(',')+']');
      }
      el = el.parentElement || (el.getRootNode() && el.getRootNode().host) || null;
    }
    return { open:true, x:Math.round(b.left), y:Math.round(b.top), w:Math.round(b.width), h:Math.round(b.height), cap };
  })()`)

  if (!r.open) { console.log(`?  ${c.name}: scrim did not open`); skip++; continue }

  const ok = r.x === 0 && r.y === 0 && r.w === VW && r.h === VH
  if (ok) { pass++; console.log(`  ✓ ${c.name} — ${r.w}x${r.h} @ (${r.x},${r.y})`) }
  else {
    fail++
    const why = r.cap.length ? `  captured by ${r.cap.join(' < ')}` : ''
    failures.push(`${c.name}: ${r.w}x${r.h} @ (${r.x},${r.y}) — uncovered ${VW - r.w}px wide, ${VH - r.h}px tall.${why}`)
    console.log(`  ✗ ${c.name} — ${r.w}x${r.h} @ (${r.x},${r.y})${why}`)
  }
}
await browser.close()

if (SELF_TEST) {
  // With the geometry reverted, EVERY measured case must fail. If any still passes, the gate is
  // measuring something that cannot distinguish the bug from the fix.
  if (pass > 0) {
    console.error(`SCRIM-VIEWPORT: SELF-TEST FAILED — ${pass} case(s) still passed with plain inset:0; the gate cannot detect the defect.`)
    process.exit(1)
  }
  console.log(`SCRIM-VIEWPORT: SELF-TEST PASS — all ${fail} measured case(s) failed as required (${skip} skipped).`)
  process.exit(0)
}

if (fail) {
  console.error(`\nSCRIM-VIEWPORT: FAIL — ${fail} scrim(s) do not cover the viewport (${pass} pass, ${skip} skipped).`)
  for (const f of failures) console.error('  ' + f)
  console.error('\n  A fixed;inset:0 scrim is pane-relative wherever an ancestor sets contain/transform.')
  console.error('  Fix: useViewportScrim() from library/utils/viewportScrim.js — it measures the real')
  console.error('  origin and subtracts it. Do NOT remove contain:layout from the shell; it is')
  console.error('  load-bearing (it stops a rail collapse reflowing a heavy mounted map).')
  process.exit(1)
}
console.log(`SCRIM-VIEWPORT: PASS — ${pass} scrim(s) cover the full viewport inside the cap-5 shell (${skip} skipped).`)
