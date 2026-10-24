#!/usr/bin/env node
// check-aria-labels-localized — no control may announce a RAW I18N KEY, and the
// accessible names must change with the locale.
//
// ★ THE ONE STRING A SIGHTED TESTER NEVER SEES. Every other untranslated string in
// this tree got caught because somebody looked at the screen. aria-label is only ever
// spoken aloud, so it survived every visual QA pass. Measured 2026-09-24 on the served
// upg-100-list leaf: the legend's toggle button announced the literal string
// "aria.toggleLegend" — in English too, not just translated locales — because vue-i18n
// ECHOES THE KEY when a lookup misses and `toggleLegend` was absent from aria.json
// while its two siblings (backToLegend, closeDetailView) were present. Six call sites
// across LegendDesktop.vue and LegendMobile.vue, desktop AND mobile, every locale.
//
// A second instance in the same sweep had the opposite shape: SemanticTreeLegend's
// collapse button hardcoded 'Collapse legend' / 'Expand legend' with no t() at all, so
// it was correct English and untranslatable. One key missing FROM the catalog, one
// string never routed TO it — the gate below catches both, because it compares what is
// ANNOUNCED across locales rather than reading the source.
//
// ⚠ TWO ASSERTIONS, NOT ONE. "No raw keys" alone passes a hardcoded English label, and
// "labels differ across locales" alone passes a raw key (a key is identical in every
// locale — which is exactly why the SEPARABILITY floor below is per-locale).
//
// ⚠ A RAW KEY HAS A SHAPE NO HUMAN LABEL HAS: dotted, camelCase, no spaces. That is the
// whole detector, and it is locale-independent — it works on Arabic and Chinese pages
// where no English word list could.
//
// Usage: node internal/check-aria-labels-localized.mjs <leafUrl> [locales]
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const URL_ = process.argv[2] || process.env.ARIA_URL
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(URL_, ROOT, 'ARIA-LABELS-LOCALIZED')
if (!URL_) {
  console.log('ARIA-LABELS-LOCALIZED: SKIP — no leaf url given.')
  console.log('  Pass one, or set ARIA_URL. Serve the TREE ROOT (public/) and point at a leaf,')
  console.log(`  e.g. ${TREE_NAME}/my-upg-100-list/upg-100-list/index.html`)
  process.exit(0)
}
const UNDER_TEST = (process.argv[3] || 'es,ar,zh').split(',').map((s) => s.trim()).filter(Boolean)

// A raw vue-i18n key: starts lowercase, dotted, no whitespace. Human labels have spaces
// ("Zoom in") or are non-Latin; neither matches.
const RAW_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/

// How many accessible names MUST change when the locale changes. Measured on the
// upg-100-list leaf 2026-09-24: 6 of 13, desktop and mobile alike. The rest are map-
// engine controls (Mapbox's own zoom/fullscreen buttons) whose labels this tree does
// not own. Override for a leaf with a different control set.
const LOCALIZED_FLOOR = Number(process.env.ARIA_LOCALIZED_FLOOR || 6)

async function readLabels(browser, lang, viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  await page.goto(`${URL_}?lang=${lang}`, { waitUntil: 'load', timeout: 45000 })
  await page.waitForTimeout(9000)
  const labels = await page.evaluate(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out) }
      return out
    }
    // Shadow-piercing: these controls live several shadow roots deep.
    return walk(document)
      .filter((e) => e.getAttribute && e.getAttribute('aria-label') !== null)
      .map((e) => (e.getAttribute('aria-label') || '').trim())
  })
  await page.close()
  return { labels, errs }
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1500, height: 1000 }, mobile: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true },
]
const seen = {}
try {
  for (const vp of VIEWPORTS) {
    seen[vp.name] = {}
    for (const loc of ['en', ...UNDER_TEST]) {
      seen[vp.name][loc] = await readLabels(browser, loc, vp.viewport, vp.mobile)
    }
  }
} finally {
  await browser.close()
}

const fails = []
const report = []

for (const vp of VIEWPORTS) {
  const byLoc = seen[vp.name]
  const en = byLoc.en

  // PRECONDITION: a page with no aria-labels at all makes every assertion vacuous. A
  // bundle that failed to execute renders nothing with zero page errors (the stale-SRI
  // signature), and would otherwise read as "nothing untranslated".
  if (!en.labels.length) {
    fails.push(`${vp.name}: no aria-labels rendered at all — either the wrong url, or the `
      + 'bundle did not execute (a stale SRI hash refuses the script SILENTLY; run '
      + '`bun run tree` after `BUNDLE=<n> bun x vite build`)')
    continue
  }

  for (const loc of ['en', ...UNDER_TEST]) {
    const s = byLoc[loc]
    // ASSERTION 1 — NO RAW KEYS, in every locale INCLUDING English. A missing catalog
    // entry is announced as its own key name, which is gibberish to a screen reader.
    const raw = [...new Set(s.labels.filter((t) => RAW_KEY.test(t)))]
    if (raw.length) {
      fails.push(`${vp.name}/${loc}: ${raw.length} control(s) announce a RAW I18N KEY — `
        + `${JSON.stringify(raw)} — vue-i18n echoes the key when the lookup misses, so a `
        + 'screen reader reads the key name aloud')
    }
    // NEVER BLANK either: an empty aria-label is worse than none, it suppresses the
    // fallback to the element's own text.
    const blank = s.labels.filter((t) => !t).length
    if (blank) fails.push(`${vp.name}/${loc}: ${blank} EMPTY aria-label(s)`)
    if (s.errs.length) fails.push(`${vp.name}/${loc}: ${s.errs.length} page error(s): ${s.errs[0]}`)
  }

  // ASSERTION 2 — THE LOCALE MUST MOVE THEM. Raw-key-free is not the same as localized:
  // a hardcoded English label passes assertion 1 forever. At least one accessible name
  // must differ from English in each locale, or nothing on this surface is translated.
  for (const loc of UNDER_TEST) {
    const s = byLoc[loc]
    const diff = s.labels.filter((t, i) => en.labels[i] && t !== en.labels[i]).length
    if (s.labels.length && diff === 0) {
      fails.push(`${vp.name}/${loc}: NOT ONE of ${s.labels.length} aria-label(s) differs from `
        + 'English — the accessible names are hardcoded, not catalogued')
    }
    // ⚠ A FLOOR, NOT JUST "> 0". `diff === 0` alone is decoration: it prints a count and
    // only fails when EVERY label regresses. Measured 2026-09-24 — hardcoding ONE label
    // back to English dropped this from 6 to 5 and the gate still passed, which is the
    // exact shape ("a number printed but not asserted on") this tree keeps rediscovering.
    // The floor is the count that currently holds, so any single regression goes red.
    // RAISE IT when you localize more; never lower it to make a red build green.
    if (s.labels.length && diff < LOCALIZED_FLOOR) {
      fails.push(`${vp.name}/${loc}: only ${diff} of ${s.labels.length} aria-label(s) differ from `
        + `English, expected at least ${LOCALIZED_FLOOR} — a label that used to be catalogued `
        + 'has been hardcoded back to English (it leaves no raw key behind, so assertion 1 '
        + 'cannot see it)')
    }
    report.push(`  ${vp.name.padEnd(8)} ${loc.padEnd(3)}: ${diff}/${s.labels.length} differ from English, `
      + `${s.labels.filter((t) => RAW_KEY.test(t)).length} raw key(s), ${s.labels.filter((t) => !t).length} blank`)
  }
}

console.log('ARIA-LABELS-LOCALIZED')
console.log(`  leaf     : ${URL_}`)
console.log(`  labels   : ${seen.desktop?.en?.labels.length ?? 0} desktop / ${seen.mobile?.en?.labels.length ?? 0} mobile (English)`)
for (const line of report) console.log(line)

if (fails.length) {
  console.error(`\nARIA-LABELS-LOCALIZED: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nARIA-LABELS-LOCALIZED: PASS — no control announces a raw i18n key, none is blank, '
  + 'and choosing a locale changes what a screen reader says.')
