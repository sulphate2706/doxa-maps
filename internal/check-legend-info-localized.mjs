#!/usr/bin/env node
// check-legend-info-localized — the legend's INFO POPOVERS must translate, in the
// real served page, not in a reimplementation of the lookup.
//
// ★ WHY THIS EXISTS BESIDE check:tabs-localized. That gate proves the dynamic-key
// mechanism reaches tabs.json — genuinely valuable, and it passes. But it tests SEVEN
// HARDCODED research-map tabs and it REIMPLEMENTS tabLabel() inside page.evaluate with
// catalogs fed in by hand. So it proves "tab localization works, for these seven",
// which is not the same claim as "this profile's tabs are localized". The UPG-100
// legend's three tabs were absent from tabs.json entirely and that gate stayed green.
//
// ⚠ AND IT NEVER LOOKED AT `info` AT ALL. SemanticTreeLegend rendered `tab.info` RAW in
// all three places it appears (the button's title=, and the popover body) while the tab
// LABEL beside it went through the catalog. Measured 2026-09-24 on the served leaf:
// ?lang=es changed 2 of 76 rendered strings ("POPULATION" -> "POBLACIÓN") and left all
// three tabs AND all three info popovers in English. The mechanism worked; the strings
// were never catalogued. This affordance was named specifically — the tab carries a small
// information button that explains what a UPG-100 list is — which is exactly the sentence a reader who does not read English cannot use.
//
// ⚠ IT RENDERS THE REAL PAGE. A catalog-only check cannot tell a shipped translation
// from a dead one, and a reimplemented lookup cannot tell you the component actually
// calls it. This opens the served leaf, switches locale the way a reader does (?lang=),
// CLICKS each info button and reads the popover that paints.
//
// ⚠ WAIT FOR THE FLUSH. showInfo() sets a ref; reading the DOM in the same tick as the
// click finds no popover and reads as "the affordance is broken". Measured: the first
// version of this probe reported "(no popover)" in every locale against a working build.
//
// Usage: node internal/check-legend-info-localized.mjs <leafUrl> [locales]
import { chromium } from './lib/playwright-guarded.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { TREE_NAME } from './_tree-name.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES = join(REPO, 'library/i18n/locales')

const URL_ = process.argv[2] || process.env.LEGEND_URL
const ROOT = _resolvePath(_dirnamePath(fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(URL_, ROOT, 'LEGEND-INFO-LOCALIZED')
if (!URL_) {
  // 75, not 0: nothing was measured, and a 0 here reads as ✓ to the wave runner (the rule stated above).
  console.log('LEGEND-INFO-LOCALIZED: NOT MEASURED (exit 75) — no leaf url given.')
  console.log(`  Pass one, or set LEGEND_URL. Serve the TREE ROOT (public/${TREE_NAME}) and point`)
  console.log('  at a profile whose legend carries per-tab info buttons, e.g.')
  console.log('  my-upg-100-list/upg-100-list/index.html')
  process.exit(75)
}
const UNDER_TEST = (process.argv[3] || 'es,ar,zh').split(',').map((s) => s.trim()).filter(Boolean)

const legendCat = (loc) => {
  const p = join(LOCALES, loc, 'legend.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

// Read each locale's info popovers from the REAL page, clicking every info button.
async function readLegend(page, url, lang) {
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  await page.goto(`${url}?lang=${lang}`, { waitUntil: 'load', timeout: 45000 })
  await page.waitForTimeout(9000)
  const walkFn = () => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out) }
      return out
    }
    return walk(document)
  }
  const count = await page.evaluate(`(${walkFn.toString()})().filter(e => (e.className||'').toString().includes('stl-tab-info')).length`)
  const pops = []
  for (let i = 0; i < count; i++) {
    await page.evaluate(`(${walkFn.toString()})().filter(e => (e.className||'').toString().includes('stl-tab-info'))[${i}]?.click()`)
    // ⚠ showInfo() sets a ref — read AFTER Vue flushes, or every popover reads empty.
    await page.waitForTimeout(400)
    pops.push(await page.evaluate(`(() => { const el = (${walkFn.toString()})().find(e => (e.className||'').toString().includes('stl-info-pop')); return el ? (el.innerText||'').trim() : '' })()`))
  }
  const tabs = await page.evaluate(`(${walkFn.toString()})().filter(e => (e.className||'').toString().includes('stl-tab-chip')).map(c => (c.innerText||'').trim().split('\\n')[0]).filter(Boolean)`)
  return { tabs, pops, errs }
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const seen = {}
try {
  for (const loc of ['en', ...UNDER_TEST]) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
    seen[loc] = await readLegend(page, URL_, loc)
    await page.close()
  }
} finally {
  await browser.close()
}

const en = seen.en
const fails = []

// PRECONDITION: this page must actually HAVE the affordance, or every assertion below
// is vacuous. A leaf whose bundle failed to execute renders zero tabs with zero page
// errors — the stale-SRI signature — and would otherwise pass as "nothing untranslated".
if (!en.pops.length) {
  console.error('\nLEGEND-INFO-LOCALIZED: FAIL — no info buttons rendered at all in English.')
  console.error('  Either this profile has no per-tab info affordance (wrong url), or the bundle')
  console.error('  did not execute. A stale SRI hash refuses the script SILENTLY, with no page')
  console.error(`  error and zero tabs — run \`bun run tree\` after \`BUNDLE=<n> bun x vite build\`.`)
  console.error(`  tabs rendered: ${JSON.stringify(en.tabs)}   page errors: ${en.errs.length}`)
  process.exit(1)
}

// THE LOAD-BEARING ASSERTION. A chosen locale must CHANGE the info text — that is the
// difference between a translation that ships and one that merely exists on disk.
const separable = {}
for (const loc of UNDER_TEST) {
  const s = seen[loc]
  if (!s.pops.length) { fails.push(`${loc}: no info popovers rendered (English had ${en.pops.length})`); continue }
  if (s.pops.length !== en.pops.length) {
    fails.push(`${loc}: ${s.pops.length} info popover(s), English had ${en.pops.length}`)
  }
  // NEVER BLANK. The whole point of a per-key fallback is that an untranslated key
  // shows English rather than nothing.
  const blank = s.pops.filter((t) => !t.trim()).length
  if (blank) fails.push(`${loc}: ${blank} info popover(s) rendered BLANK — the fallback should show English`)
  // Count how many DIFFER from English. Zero means the catalog is not reached: either
  // the entries are missing, or the component renders the raw prop as it used to.
  const diff = s.pops.filter((t, i) => t && en.pops[i] && t !== en.pops[i]).length
  separable[loc] = diff
  const cat = legendCat(loc)
  const catKeys = cat && cat.tabInfo ? Object.keys(cat.tabInfo).length : 0
  if (catKeys > 0 && diff === 0) {
    fails.push(`${loc}: legend.json declares ${catKeys} tabInfo key(s) but NOT ONE info popover `
      + 'differs from English — the catalog is present and unreached (the raw-prop bug)')
  }
  if (s.errs.length) fails.push(`${loc}: ${s.errs.length} page error(s): ${s.errs[0]}`)
}

console.log('LEGEND-INFO-LOCALIZED')
console.log(`  leaf       : ${URL_}`)
console.log(`  info popups: ${en.pops.length} (English)`)
console.log(`  tabs       : ${en.tabs.join(' · ')}`)
for (const loc of UNDER_TEST) {
  const s = seen[loc]
  console.log(`  ${loc.padEnd(10)}: ${separable[loc] ?? 0}/${s.pops.length} info text(s) differ from English, `
    + `${s.pops.filter((t) => !t.trim()).length} blank   tabs: ${s.tabs.join(' · ')}`)
}

if (fails.length) {
  console.error(`\nLEGEND-INFO-LOCALIZED: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nLEGEND-INFO-LOCALIZED: PASS — choosing a locale changes the rendered info text, so '
  + 'the legend\'s explanations reach the reader in their own language, never blank.')
