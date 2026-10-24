#!/usr/bin/env node
/**
 * check-fixed-anchoring.mjs — a `position:fixed` popover must stay anchored to its trigger IN EVERY
 * HOST, not just the one it was developed in.
 *
 * THE DEFECT THIS CATCHES. FilterDropdown positions its menu with position:fixed and viewport
 * coordinates. That is correct only while nothing establishes a containing block for fixed
 * descendants. VerticalTabsLayout — the cap-5 shell every plugin is hosted in as a tab — sets
 * `contain: layout paint` on .vtl-content, inside `.vtl-main { left: 256px }`. So the identical
 * component read:
 *     STANDALONE research-dashboard ....... dLeft=0   dTop=4     (six of six)
 *     INSIDE plugin-studio dashboard tab .. dLeft=256 dTop=111   (every one)
 * The menu was reported for days as appearing in a random spot further down to the right. It
 * was never random. 256 is the rail width, 111 the header height.
 *
 * ★ WHY NO EXISTING GATE SAW IT, AND WHY THAT IS THE INTERESTING PART. A probe DID exist and it DID
 * pass — six triggers, four viewport widths, every one accurate. It measured the standalone
 * composite. Widening it across MORE viewport widths would never have found this, because the
 * variable that mattered was not the width but the HOST. A measurement can be precise, repeatable,
 * and about the wrong thing. So this gate's contract is deliberately "the same component in two
 * different hosts", and the comparison between them — not either number alone — is the evidence.
 *
 * WHAT IT ASSERTS. For each (host, trigger) pair: opening the menu puts it within 8px horizontally
 * of its trigger's left or right edge, and within [-8, 40]px vertically of the trigger's bottom.
 * When a pair fails it names the capturing ancestor from a live computed-style walk, so the report
 * says `div.vtl-content [contain:layout paint]` rather than "misplaced".
 *
 * PRECONDITIONS: a built tree and `bun run serve` on 4173. No Mapbox token needed — this measures
 * DOM geometry, and the dropdowns render with or without a basemap. (This VPS has no WebGL, so any
 * gate that needed paint would be unrunnable here anyway.)
 *
 * NEGATIVE-TESTED: reverting the fixedOrigin() subtraction in FilterDropdown.vue makes the
 * plugin-studio host fail with dLeft=256, while standalone continues to pass — i.e. the gate fails
 * exactly where the old probe passed, which is the property that makes it worth having.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const BASE = process.env.BASE || `http://127.0.0.1:4173/${TREE_NAME}`
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(BASE, ROOT, 'FIXED-ANCHORING')
const TK = process.env.MAPBOX_TOKEN ? `?tk=${process.env.MAPBOX_TOKEN}` : ''

const DEEP = `(sel)=>{const out=[],seen=new Set();const w=(r)=>{if(!r||seen.has(r))return;seen.add(r);try{out.push(...r.querySelectorAll(sel))}catch(e){};for(const el of r.querySelectorAll('*'))if(el.shadowRoot)w(el.shadowRoot)};w(document);return out}`

const MEASURE = (i) => `(()=>{
  const t=(${DEEP})('.filter-dropdown__trigger')[${i}];
  if(!t) return null;
  const ms=(${DEEP})('.filter-dropdown__menu');
  const m=ms[ms.length-1];
  const tr=t.getBoundingClientRect();
  const name=(t.textContent||'').trim().replace(/\\s+/g,' ').slice(0,14);
  if(!m) return {name,open:false};
  const mr=m.getBoundingClientRect();
  const cap=[];let el=t;
  while(el){ if(el.nodeType===1){ const cs=getComputedStyle(el); const why=[];
    if(cs.transform&&cs.transform!=='none')why.push('transform');
    if(cs.filter&&cs.filter!=='none')why.push('filter');
    if(cs.perspective&&cs.perspective!=='none')why.push('perspective');
    if(cs.backdropFilter&&cs.backdropFilter!=='none')why.push('backdrop-filter');
    if(/paint|layout|strict|content/.test(cs.contain||''))why.push('contain:'+cs.contain);
    if(/transform|filter|perspective/.test(cs.willChange||''))why.push('will-change:'+cs.willChange);
    if(why.length)cap.push((el.tagName||'').toLowerCase()+(typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\\s+/)[0]:'')+' ['+why.join(',')+']'); }
    el=el.parentElement||(el.parentNode&&el.parentNode.host)||null; }
  return {name,open:true,
    dLeftEdge:Math.round(mr.left-tr.left),
    dRightEdge:Math.round(mr.right-tr.right),
    dTop:Math.round(mr.top-tr.bottom),cap};
})()`

async function hostRun(browser, label, url, activate) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const rows = []
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(6000)
    if (activate) {
      // Heavy tabs are lazy-mounted on activation, so nothing exists until a tab is clicked. A flat
      // query before this point returns 0 triggers and reads as "no dropdowns here" — which is how
      // a host can silently drop out of coverage while the gate still reports success.
      const idx = await page.evaluate(`(${DEEP})('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)').findIndex(t=>${activate}.test(t.textContent||''))`)
      if (idx < 0) return { label, error: 'no tab matched ' + activate }
      await page.evaluate(`(${DEEP})('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)')[${idx}].click()`)
      await page.waitForTimeout(9000)
    }
    const n = await page.evaluate(`(${DEEP})('.filter-dropdown__trigger').length`)
    if (!n) return { label, error: 'no .filter-dropdown__trigger in the composed tree' }
    for (let i = 0; i < n; i++) {
      await page.evaluate(`(${DEEP})('.filter-dropdown__trigger')[${i}].click()`)
      await page.waitForTimeout(320)
      const r = await page.evaluate(MEASURE(i))
      if (r) rows.push(r)
      await page.evaluate(`(${DEEP})('.filter-dropdown__trigger')[${i}].click()`)
      await page.waitForTimeout(110)
    }
  } catch (e) {
    return { label, error: e.message.slice(0, 140) }
  } finally {
    await page.close()
  }
  return { label, rows }
}

const browser = await chromium.launch()
// ★ index.html IS EXPLICIT. These were bare-directory URLs. The old local server resolved a
// directory to its index; the live static layer returns 404, so this gate was only ever green
// because the local server was more forgiving than production. Under serve-strict.mjs it reported
// UNMEASURED for BOTH hosts the first time it ran — correctly refusing to claim a pass it could not
// measure, which is the difference between this gate and one that would have found 0 dropdowns and
// called that 0 problems.
const hosts = [
  await hostRun(browser, 'STANDALONE research-dashboard', `${BASE}/research-dashboard/research-dashboard/index.html${TK}`, null),
  await hostRun(browser, 'INSIDE cap-5 plugin-studio', `${BASE}/plugin-studio/plugin-studio/index.html${TK}`, '/dashboard-plus-grid/i'),
]
await browser.close()

let failed = 0
let measured = 0
console.log('FIXED-ANCHORING: measuring the same dropdown in two different hosts\n')
for (const h of hosts) {
  console.log(`--- ${h.label} ---`)
  if (h.error) {
    console.log('  UNMEASURED: ' + h.error)
    failed++ // an unmeasured host is a failure, not a pass; silence is how coverage rots
    continue
  }
  for (const r of h.rows) {
    if (!r.open) { console.log(`  FAIL [${r.name}] menu did not open`); failed++; continue }
    measured++
    // Anchored means sharing an edge: left-aligned OR right-aligned (the standard popover flip).
    const edgeOk = Math.abs(r.dLeftEdge) <= 8 || Math.abs(r.dRightEdge) <= 8
    const vertOk = r.dTop >= -8 && r.dTop <= 40
    if (edgeOk && vertOk) {
      console.log(`  ok   [${r.name}] dLeft=${r.dLeftEdge} dTop=${r.dTop}`)
    } else {
      failed++
      console.log(`  FAIL [${r.name}] dLeft=${r.dLeftEdge} dRight=${r.dRightEdge} dTop=${r.dTop}`)
      if (r.cap.length) {
        console.log('       a containing block for fixed descendants exists on this chain:')
        r.cap.forEach((c) => console.log('         - ' + c))
        console.log('       The menu is position:fixed, so its coordinates resolve against that')
        console.log('       ancestor, not the viewport. Measure the real origin instead of assuming')
        console.log('       the viewport (see fixedOrigin() in FilterDropdown.vue).')
      }
    }
  }
  console.log('')
}

if (failed) {
  console.error(`FIXED-ANCHORING: FAIL — ${failed} problem(s) across ${hosts.length} host(s).`)
  process.exit(1)
}
console.log(`FIXED-ANCHORING: PASS — ${measured} trigger(s) anchored across ${hosts.length} hosts.`)
console.log('  The two-host comparison IS the assertion. A single-host pass proves nothing about a')
console.log('  popover, because the defect lives in the HOST chain, not in the component.')
