#!/usr/bin/env node
/**
 * smoke-studio.mjs — the FIVE-SECOND studio check, runnable on every edit.
 *
 * WHY THIS EXISTS (measured, 2026-09-22). A single commit shipped the requested change AND a
 * regression: a base prefix applied to an already-rooted URL produced
 *     404 /__plugin-gallery//plugin-designs/<bundle>/index.js
 * and 404'd ALL 29 studio tabs. Finding it took 32 minutes. The root-cause analysis
 * (_qa-cycle/01-ideation-research/RESEARCH-why-plugin-studio-changes-are-slow.md) attributes the
 * single largest share of that to there being NO DEV-SURFACE GATE. The census it measured:
 *     package.json scripts ........................ 76
 *     gate-ish (check:/verify:/smoke:/probe:) ..... 46
 *     gates that launch a real browser ............ 13
 *     gates in verify:browser-all .................  7
 *     gates that exercise the DEV SERVER ..........  0   <- the hole this closes
 *
 * ★ WHY THE BUILD COULD NEVER HAVE CAUGHT IT. The BUILT manifest hands RELATIVE refs
 * ("./big-picture/big-picture.js"); the DEV manifest hands ROOTED ones
 * ("/plugin-designs/big-picture/index.js"). A `base + ref` join is therefore correct forever in the
 * built tree and broken instantly in dev — every build-time gate stays green while every developer's
 * studio is broken. A product that must work on ten laptops cannot be verified by the build alone.
 * See REFERENCE-the-four-surface-contract.md.
 *
 * ★ WHY IT ACTIVATES ONE TAB, NOT 29. The full sweep costs ~75s (29 tabs x ~2.5s), so it only ever
 * gets run at the END of a change — which is exactly how a regression rides along undetected. One
 * mount exercises the whole resolver path: manifest fetch -> scriptUrl resolve -> module load ->
 * customElements.define -> mount. If the resolver is wrong, tab 1 fails like all 29. Cheap enough to
 * run on every edit is worth more than thorough enough to run once.
 *
 * WHAT IT ASSERTS — each one maps to a defect that actually happened:
 *   1. `/` serves the STUDIO, not a staging page   (three staging surfaces have masqueraded as the product)
 *   2. the element MOUNTS and its tag is DEFINED   (a classic <script> on a dev ES module fires
 *                                                   onload, THEN throws — the tag is never defined
 *                                                   while the loader reports success)
 *   3. the tab list is NON-EMPTY                   (a missing tree-base mounts an EMPTY shell; zero
 *                                                   tabs is a PASS for any check that only looks for errors)
 *   4. ZERO 4xx/5xx during load + one activation   (this alone catches the double-slash 404)
 *   5. the activated pane holds REAL CONTENT       ("mounts" and "works" are different assertions —
 *                                                   a dashboard with no MAP_APP_API_URL mounts fine
 *                                                   and renders nothing)
 *
 * USAGE:   bun run smoke:studio                 (expects `bun run dev` already running on :5173)
 *          bun run smoke:studio --url http://localhost:5199
 * EXIT:    0 pass · 1 a real failure · 2 the dev server is not reachable (NOT a product failure)
 *
 * NEGATIVE-TESTED: re-introducing the base-concatenation bug makes this FAIL naming the 404 URL;
 * removing tree-base makes it FAIL on the empty tab list. A gate that cannot fail is worse than none.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { requireDevServesThisCheckout as __devGuard, requireThisTree as __treeGuard } from './_serves-this-tree.mjs'
import { fileURLToPath as __f2p } from 'node:url'
import { dirname as __dn, resolve as __rs } from 'node:path'
const __ROOT = __rs(__dn(__f2p(import.meta.url)), '..')

const argOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const BASE = String(argOf('--url', 'http://localhost:5173')).replace(/\/+$/, '')
// Measure THIS checkout, or measure nothing (exit 75 = NOT MEASURED; see _serves-this-tree.mjs).
await __devGuard(BASE, __ROOT, 'SMOKE-STUDIO')
const BUDGET_MS = Number(process.env.SMOKE_BUDGET_MS || 20000)

// Deep walker — SHADOW DOM DOES NOT PIERCE. A flat querySelectorAll lies about this component, and a
// probe that cannot see inside a shadow root reports "empty" for a perfectly healthy studio.
const DEEP = `window.__q=(s)=>{const o=[],z=new Set();const w=r=>{if(!r||z.has(r))return;z.add(r);
 for(const e of r.querySelectorAll('*')){if(e.matches&&e.matches(s))o.push(e);if(e.shadowRoot)w(e.shadowRoot);}};w(document);return o;}`

const t0 = Date.now()
const fail = (msg, detail) => {
  console.error(`SMOKE-STUDIO: FAIL — ${msg}`)
  if (detail) console.error(detail)
  process.exit(1)
}

// Reachability is NOT a product failure. Exit 2 so a caller can tell "dev server is down" from
// "the studio is broken" — conflating them is how a gate gets muted for being flaky.
let probe
try { probe = await fetch(BASE + '/', { redirect: 'follow' }) } catch { probe = null }
if (!probe || !probe.ok) {
  console.error(`SMOKE-STUDIO: dev server not reachable at ${BASE} — is \`bun run dev\` running?`)
  process.exit(2)
}
const html = await probe.text()

// ── assertion 1: / serves the STUDIO ─────────────────────────────────────────
if (!/<plugin-studio\b/.test(html)) {
  fail(`${BASE}/ does not serve <plugin-studio>.`,
    '  The dev root must mount the capability-5 studio element. Three different staging pages have\n' +
    '  occupied this route historically; each returned HTTP 200 while mounting no custom element.')
}
if (/One shared core|paste-anywhere maps|scroll the strip/i.test(html)) {
  fail(`${BASE}/ is serving a STAGING GALLERY, not the studio.`,
    '  That page is a chooser: it renders real-looking content and mounts nothing. See\n' +
    '  the project history (the staging surface was retired 2026-09-22).')
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const bad = []
const errs = []
page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(BASE, '')}`) })
page.on('pageerror', e => errs.push(String(e).slice(0, 160)))

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: BUDGET_MS })
// Wait for the tag to define rather than sleeping a fixed amount: the studio is ready when its
// element is registered, and polling that is both faster and stricter than a timer.
let defined = false
try {
  await page.waitForFunction(() => !!customElements.get('plugin-studio'), null, { timeout: BUDGET_MS })
  defined = true
} catch { /* handled below with the full diagnostic */ }

await page.evaluate(DEEP)
const state = await page.evaluate(() => ({
  present: !!document.querySelector('plugin-studio'),
  tabs: window.__q('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)').length,
}))

// ── assertion 2: the element mounts AND its tag is defined ───────────────────
if (!defined || !state.present) {
  await browser.close()
  fail(`<plugin-studio> ${!state.present ? 'is absent from the DOM' : 'never registered'}.`,
    '  A classic <script> pointed at a dev ES module fires onload SUCCESSFULLY and only then throws\n' +
    '  "Cannot use import statement outside a module" — the tag is never defined while the loader\n' +
    '  reports success. Gate mounting on customElements.whenDefined, never on script onload.\n' +
    (errs.length ? '  page errors:\n    ' + [...new Set(errs)].slice(0, 3).join('\n    ') : ''))
}

// ── assertion 3: the tab list is non-empty ───────────────────────────────────
if (state.tabs === 0) {
  await browser.close()
  fail('the studio mounted but has ZERO tabs.',
    '  It builds its tab list by fetching <tree-base>manifest.json. With no tree-base it falls back to\n' +
    '  a path relative to its own script URL, which does not exist under the dev server — so the shell\n' +
    '  renders EMPTY. Zero tabs is a PASS for any check that only looks for errors, which is why this\n' +
    '  assertion is explicit.\n' +
    (bad.length ? '  4xx/5xx:\n    ' + [...new Set(bad)].slice(0, 5).join('\n    ') : ''))
}

// ── assertion 5 (setup): activate ONE tab ────────────────────────────────────
// ★ SAMPLE SEVERAL TABS, AND MEASURE DEPTH — both of these were weaknesses in the first version of
// this gate, and both sat exactly where the reported bugs live.
//
// (a) TAB 0 ONLY WAS NOT ENOUGH. The original activated the first tab on the theory that one mount
//     exercises the whole resolver path. True for a RESOLVER bug — every tab fails together — but
//     false for a per-plugin failure. Big Picture was reported as not loading while tab 0
//     was fine, and this gate would have passed. Sampling a spread catches a single bad bundle
//     without paying for all 29 (~75s). SAMPLE_TABS stays small so the budget holds.
//
// (b) slot.children.length WAS ALWAYS 1 AND PROVED NOTHING. The slot holds exactly one child — the
//     mounted element — so counting it measures ATTACHMENT, not CONTENT. An element that registers
//     and renders nothing scored identically to one rendering 1,397 nodes. That is the precise
//     "mounts is not works" trap this file's own header warns about, encoded into the check anyway.
//     The fix is to walk INTO the mounted element (through its shadow root) and require real depth.
// ★ "TABS" INCLUDES THE STUDIO'S TREE ROWS (2026-09-24). plugin-studio's rail is an Explorer tree
// (src/StudioTree.vue), not VerticalTabsLayout tabs, so every selector here matches BOTH shapes:
// '.vtl-tab' (nested shells like doxa-maps-spa) and the tree's treeitems minus section headers (a
// section header only folds; it opens no plugin, so sampling one would report a false "no content").
const SAMPLE_TABS = Number(process.env.SMOKE_TABS || 4)
const MIN_DEPTH = Number(process.env.SMOKE_MIN_DEPTH || 5)

const idxs = []
for (let i = 0; i < Math.min(SAMPLE_TABS, state.tabs); i++) {
  // Spread across the rail rather than taking the first N: capability groups are ordered 5 -> 1, so
  // the first few tabs are all cap-5/4 composites and would never exercise a simple leaf element.
  idxs.push(Math.floor((i * state.tabs) / Math.min(SAMPLE_TABS, state.tabs)))
}

const results = []
for (const i of idxs) {
  await page.evaluate(DEEP)
  await page.evaluate((n) => { const t = window.__q('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)')[n]; if (t) t.click() }, i)
  // POLL until the pane has real content rather than sleeping a fixed amount. A fixed wait forces an
  // ugly trade: long enough for the slowest tab makes the gate too slow to run on every edit, and
  // short enough to be fast marks a slow-mounting tab BROKEN. That false positive is the worse
  // outcome — a gate that cries wolf gets switched off, which is strictly worse than no gate.
  // Polling costs the fast tabs almost nothing (they settle in a few hundred ms) and still bounds
  // the slow ones, so coverage and budget stop fighting each other.
  const deadline = Date.now() + Number(process.env.SMOKE_TAB_WAIT_MS || 6000)
  while (Date.now() < deadline) {
    await page.waitForTimeout(250)
    await page.evaluate(DEEP)
    const ready = await page.evaluate(() => {
      const p = window.__q('.ps-pane').find(x => !x.hasAttribute('hidden'))
      const host = p && p.querySelector('.ps-slot') && p.querySelector('.ps-slot').children[0]
      if (!host) return false
      const root = host.shadowRoot || host
      return root.querySelectorAll('*').length > 4
    })
    if (ready) break
  }
  await page.evaluate(DEEP)
  results.push(await page.evaluate((n) => {
    const tab = window.__q('.vtl-tab, .st-row[role=treeitem]:not(.st-sec)')[n]
    const label = (tab && tab.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)
    const p = window.__q('.ps-pane').find(x => !x.hasAttribute('hidden'))
    if (!p) return { label, none: true }
    const hint = p.querySelector('.ps-hint')
    const slot = p.querySelector('.ps-slot')
    // Walk INTO the mounted element, piercing shadow roots, and count real nodes.
    let depth = 0
    const host = slot && slot.children[0]
    if (host) {
      const seen = new Set()
      const walk = (r) => {
        if (!r || seen.has(r)) return
        seen.add(r)
        for (const e of r.querySelectorAll('*')) { depth++; if (e.shadowRoot) walk(e.shadowRoot) }
      }
      walk(host.shadowRoot || host)
    }
    return {
      label,
      tag: host ? host.tagName.toLowerCase() : '(none)',
      defined: host ? !!customElements.get(host.tagName.toLowerCase()) : false,
      depth,
      hint: hint ? hint.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '',
    }
  }, i))
}
const pane = results[0] || { none: true }

await browser.close()

// ── assertion 4: zero 4xx/5xx ────────────────────────────────────────────────
// Deliberately placed AFTER activation so it covers the mount path too — the double-slash 404 fired
// when a pane loaded its bundle, not on the initial document.
const uniq = [...new Set(bad)]
if (uniq.length) {
  fail(`${uniq.length} failed request(s) while loading the studio.`,
    '    ' + uniq.slice(0, 6).join('\n    ') +
    '\n\n  A doubled slash means a base was prefixed onto an already-rooted URL — see\n' +
    '  check:url-resolver and AP-a-base-prefix-must-never-be-applied-to-an-already-rooted-url.\n' +
    '  A relative /api/... means a global is missing (MAP_APP_API_URL); Vite answers it with\n' +
    '  SPA-fallback HTML at 200, so the component mounts and silently renders nothing.')
}

// ── assertion 5: the pane holds real content ─────────────────────────────────
const broken = results.filter(r =>
  r.none || /could not load|failed/i.test(r.hint || '') || !r.defined || r.depth < MIN_DEPTH)

if (broken.length) {
  const lines = broken.map(r => r.none
    ? `    [${r.label}] no pane became active`
    : `    [${r.label}] <${r.tag}> defined=${r.defined} depth=${r.depth}${r.hint ? ' — ' + r.hint : ''}`)
  fail(`${broken.length} of ${results.length} sampled tab(s) did not render real content.`,
    lines.join('\n') +
    '\n\n  "Mounts" and "works" are different assertions. An element can register and attach while its\n' +
    '  content never arrives — that is what a missing API base, a failed child import, or a resolver\n' +
    `  returning a 200 HTML page for a JS request looks like. depth is a count of real nodes INSIDE\n` +
    `  the mounted element (shadow roots pierced); anything under ${MIN_DEPTH} is an empty shell.`)
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
const depths = results.map(r => r.depth).join('/')
console.log(`SMOKE-STUDIO: PASS in ${secs}s — ${BASE}/ mounts <plugin-studio>, ${state.tabs} tab(s); sampled ${results.length} tab(s), node depth ${depths}; 0 failed requests.`)
console.log('  This is the DEV surface the build-time gates structurally cannot see: the built manifest')
console.log('  hands relative refs, so a base-join bug is invisible there and fatal here.')
