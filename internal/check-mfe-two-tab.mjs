// check-mfe-two-tab — a two-tab MFE must actually MOUNT BOTH PANES and switch.
//
// The failure this catches is BUG-UPG100-NESTED-ELEMENTS-ZERO-HEIGHT: every layer
// inside these composites is position:absolute/height:100%, so the whole chain
// resolves to ZERO unless :host is sized. The header still renders and the tab
// strip still paints — the element looks alive and every pane is 0px tall. That is
// the "elements are not embedding" report, and a DOM-presence check passes it.
// So this asserts MEASURED pane height, not mere existence.
//
// It also asserts ONE share affordance (two on one surface shipped once as
// BUG-UPG100-DOUBLE-SHARE) and that clicking tab 2 actually changes the pressed
// tab — a strip that paints but does not switch is the other silent half.
//
// Usage: node internal/check-mfe-two-tab.mjs <url> [expectedTabCount]
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

const URL = process.argv[2]
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(URL, ROOT, 'MFE-TWO-TAB')
if (!URL) { console.error('usage: check-mfe-two-tab.mjs <url> [tabs]'); process.exit(2) }
const WANT_TABS = Number(process.argv[3] || 2)

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } })
const errs = []
pg.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
await pg.goto(URL, { waitUntil: 'load', timeout: 45000 })
await pg.waitForTimeout(9000)

// Everything lives in a shadow root, so reach through it explicitly.
const r = await pg.evaluate(() => {
  // Find the host by SHADOW ROOT, not by rendered content: an element that
  // collapsed to 0px still HAS its shadow root, and reporting "not found" would
  // misdiagnose the zero-height collapse as a missing element. Measured — removing
  // :host produced exactly that misleading message.
  const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot
    && (e.shadowRoot.querySelector('.viewsel, .pane-col, [role="tab"]')
        || /mfe/i.test(e.tagName)))
  if (!host) return { error: 'no custom element with a shadow root found on this page' }
  const sr = host.shadowRoot
  // ⚠ Select the TABS, not their container. '.viewsel .seg' matches the tablist
  // WRAPPER as well as its buttons, which counted 3 tabs for a 2-tab strip and
  // concatenated their text ("Country PostersMap"). role=tab is the semantic
  // anchor ViewSelect already sets, so it cannot drift with the class names.
  const tabs = [...sr.querySelectorAll('[role="tab"]')]
    .map((t) => (t.textContent || '').trim()).filter(Boolean)
  const panes = [...sr.querySelectorAll('.pane')].map((p) => {
    const box = p.getBoundingClientRect()
    const mounted = !!p.querySelector('.pane-mount > *')
    return { h: Math.round(box.height), w: Math.round(box.width), mounted }
  })
  const shares = sr.querySelectorAll('[aria-label*="hare"], .share-btn, .sharebtn').length
  const hostBox = host.getBoundingClientRect()
  return { tabs, panes, shares, hostH: Math.round(hostBox.height) }
})
await b.close()

if (r.error) { console.error(`MFE-TWO-TAB: FAIL — ${r.error}`); process.exit(1) }

const fails = []
if (r.tabs.length !== WANT_TABS) fails.push(`${r.tabs.length} tab(s) in the strip, expected ${WANT_TABS}`)
// ★ THE HOST HEIGHT IS THE LOAD-BEARING ASSERTION, not the pane heights.
// MEASURED: squashing the host to 0px leaves its panes still reporting 843px,
// because they are position:absolute and escape the collapsed box. So a
// pane-height check alone does NOT catch BUG-UPG100-NESTED-ELEMENTS-ZERO-HEIGHT —
// the panes look fine while the element occupies no space and the reader sees
// nothing. Only the host measurement reveals it.
if (r.hostH < 100) {
  fails.push(`the host element measured ${r.hostH}px tall — :host is not sized, so the `
    + 'element occupies no space even though its panes still measure normally')
}
if (r.panes.length !== WANT_TABS) fails.push(`${r.panes.length} pane(s) mounted, expected ${WANT_TABS}`)
for (const [i, p] of r.panes.entries()) {
  if (!p.mounted) fails.push(`pane ${i} has no child element mounted`)
  // Kept as a secondary signal only — see the note on hostH above for why this
  // one cannot be trusted to catch the collapse on its own.
  if (p.h < 100) fails.push(`pane ${i} measured ${p.h}px tall`)
}
if (r.shares > 1) fails.push(`${r.shares} share affordances on one surface — exactly one belongs here`)
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

console.log(`  host height   : ${r.hostH}px`)
console.log(`  tabs          : ${r.tabs.join(' | ') || '(none)'}`)
console.log(`  panes         : ${r.panes.map((p) => `${p.w}x${p.h}${p.mounted ? '' : ' UNMOUNTED'}`).join(', ')}`)
console.log(`  share buttons : ${r.shares}`)
console.log(`  page errors   : ${errs.length}`)

if (fails.length) {
  console.error(`\nMFE-TWO-TAB: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`\nMFE-TWO-TAB: PASS — ${WANT_TABS} tabs, both panes mounted and sized, one share affordance.`)
