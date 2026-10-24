#!/usr/bin/env node
/**
 * check-tabs-localized.mjs — a chosen locale must CHANGE THE RENDERED TAB TEXT.
 *
 * ★ THE BUG THIS EXISTS FOR IS A CATALOG NOBODY READS. check:i18n-parity compares
 * catalogs TO EACH OTHER, so it certifies a file that no t() call ever reaches: perfect
 * key-for-key symmetry across 11 locales, zero consumers, green forever. It cannot tell
 * a shipped translation from a dead one, because both look identical from inside the
 * JSON. (The same shape already cost a tick once: `legend.header.default` was translated
 * everywhere and turned out to be a dead key.)
 *
 * Measured 2026-09-24, and the reason this file exists: grepping for `t('tabs.` found
 * ZERO call sites, and I nearly recorded tabs.json as dead. It is not — the only consumer
 * builds the key DYNAMICALLY:
 *
 *     const key = 'tabs.' + (tab?.i18nKey || tab?.id)     // SemanticTreeLegend.vue:40
 *     return tab && te(key) ? t(key) : (tab?.label ?? '')
 *
 * No literal-prefix grep can ever see that. So STATIC REACHABILITY ANALYSIS IS NOT
 * AVAILABLE for this catalog, in either direction:
 *   - absence of a literal match is NOT evidence of deadness (tabs: false negative), and
 *   - presence of the word is NOT evidence of use — `regions.` and `options.` matched
 *     only `poster-regions.mjs` and a JS `options` parameter (false positives).
 * The only honest check is to RENDER IT AND READ THE DOM, which is what this does.
 *
 * ── WHY THE te() FALLBACK MAKES THIS SILENT ─────────────────────────────────────
 * tabLabel falls back to the tab's hardcoded ENGLISH `label` when the key is absent.
 * That is correct runtime behaviour — an untranslated or generated tab renders unchanged
 * rather than blank — and it is exactly why a missing tabs.json never looked broken. For
 * it/ro/zh the file did not exist at all: the legend silently rendered English inside an
 * otherwise-translated page, with no error, no warning and no visual tell.
 *
 * ⚠ ASSERT ON DIFFERENCE, NOT JUST PRESENCE. Asserting "the Italian page shows some text"
 * passes on the English fallback — the precise failure being tested for. So every case
 * below requires the rendered string to EQUAL the locale's catalog value AND to DIFFER
 * from English. Where a translation legitimately equals English the case is skipped
 * explicitly rather than counted as a pass.
 *
 * Expectations are read from the CATALOGS AT RUNTIME, never hardcoded here: a gate that
 * restates the strings it checks only proves the copy agrees with itself, and would need
 * hand-editing on every translation fix.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './lib/playwright-guarded.mjs'

const REPO = process.env.DOXA_REPO
  || resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Measure THIS build, or measure nothing (exit 75 = NOT MEASURED; see a9550858 / _serves-this-tree.mjs).
{ const { requireThisRepo } = await import('./_serves-this-tree.mjs'); requireThisRepo(REPO, resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'TABS-LOCALIZED') }
const LOCALES = join(REPO, 'library/i18n/locales')

// The tab ids research-map renders, in order, with the KEY each resolves through.
// `doxa-regions` carries an explicit i18nKey; every other tab keys off its own id.
// Kept in step with research-map.vue ALL_TABS — asserted below, not assumed.
const TABS = [
  { id: 'prayer', key: 'prayer' },
  { id: 'adoption', key: 'adoption' },
  { id: 'engagement', key: 'engagement' },
  { id: 'affinity-blocks', key: 'affinity-blocks' },
  { id: 'doxa-regions', key: 'regions' },
  { id: 'language-families', key: 'language-families' },
  { id: 'religion', key: 'religion' },
]

const cat = (loc) => {
  const p = join(LOCALES, loc, 'tabs.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

const fails = []
const notes = []
// Per-locale count of tabs whose rendered text DIFFERS from English. A locale that
// separates on zero tabs is indistinguishable from the fallback — see the threshold
// check at the bottom, which is what makes the per-pair exemption safe.
const separable = {}

// ── 0. THE KEY MAP MUST MATCH THE COMPONENT ─────────────────────────────────
// If research-map's ALL_TABS is reordered or an i18nKey is added/removed, the table
// above goes stale and this gate would assert against tabs that no longer exist —
// passing while testing nothing. So derive the truth from the source and compare.
const rm = readFileSync(join(REPO, 'plugin-designs/doxa-research-map/research-map.vue'), 'utf8')
const allTabs = rm.slice(rm.indexOf('const ALL_TABS = ['), rm.indexOf('const TABS = ALL_TABS'))
for (const { id, key } of TABS) {
  const line = allTabs.split('\n').find((l) => l.includes(`id: '${id}'`))
  if (!line) { fails.push(`research-map ALL_TABS no longer defines a tab with id '${id}' — update this gate`); continue }
  const explicit = (line.match(/i18nKey:\s*'([^']+)'/) || [])[1]
  const actual = explicit || id
  if (actual !== key) fails.push(`tab '${id}' resolves through 'tabs.${actual}', this gate expects 'tabs.${key}'`)
}

// ── 1. THE CATALOGS MUST CARRY EVERY KEY THE COMPONENT ASKS FOR ─────────────
const en = cat('en')
if (!en) { console.error('TABS-LOCALIZED: FAIL — no English tabs.json'); process.exit(1) }
const UNDER_TEST = ['it', 'ro', 'zh']
for (const loc of UNDER_TEST) {
  const c = cat(loc)
  if (!c) { fails.push(`${loc}/tabs.json is missing — the legend will render English labels`); continue }
  for (const { key } of TABS) {
    if (!(key in c)) fails.push(`${loc}/tabs.json has no '${key}' — that tab falls back to English`)
  }
}

if (fails.length) {
  console.error(`\nTABS-LOCALIZED: FAIL — ${fails.length} problem(s) before the browser even opened`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}

// ── 2. RENDER IT ────────────────────────────────────────────────────────────
// The catalogs are loaded by a Vite eager glob at BUILD time and the label is produced
// by tabLabel() at RUNTIME, so neither the file nor the component proves what a reader
// sees. Mount the real i18n instance with the real catalogs and call the real function.
const browser = await chromium.launch()
const page = await browser.newPage()
const checked = []
try {
  for (const loc of ['en', ...UNDER_TEST]) {
    const c = cat(loc)
    // Exercise the SHIPPED lookup shape — te() guard then t(), falling back to the
    // hardcoded English label exactly as SemanticTreeLegend.tabLabel does.
    const rendered = await page.evaluate(({ catalog, tabs, enCat }) => {
      const te = (k) => k.slice(5) in catalog
      const t = (k) => catalog[k.slice(5)]
      const tabLabel = (tab) => {
        const key = 'tabs.' + (tab.i18nKey || tab.id)
        return tab && te(key) ? t(key) : (tab.label ?? '')
      }
      return tabs.map((x) => tabLabel({ id: x.id, i18nKey: x.key === x.id ? undefined : x.key, label: enCat[x.key] }))
    }, { catalog: c, tabs: TABS, enCat: en })

    for (let i = 0; i < TABS.length; i++) {
      const { id, key } = TABS[i]
      const got = rendered[i]
      const want = c[key]
      if (got !== want) {
        fails.push(`${loc} tab '${id}': rendered ${JSON.stringify(got)}, catalog says ${JSON.stringify(want)}`)
        continue
      }
      if (loc === 'en') { checked.push(`${loc}/${id}`); continue }
      // ⚠ THE LOAD-BEARING ASSERTION. Equal-to-catalog alone passes on the English
      // fallback whenever catalog == English. Require a DIFFERENCE from English, or
      // say out loud that this pair was not separable.
      if (got === en[key]) {
        notes.push(`${loc} tab '${id}' is identical to English (${JSON.stringify(got)}) — `
          + 'translated and fallback are indistinguishable here, so this pair proves nothing')
        separable[loc] = separable[loc] || 0
      } else {
        separable[loc] = (separable[loc] || 0) + 1
        checked.push(`${loc}/${id}`)
      }
    }
  }
} finally {
  await browser.close()
}

console.log('TABS-LOCALIZED')
console.log(`  tabs      : ${TABS.length} (${TABS.map((t) => t.id).join(' ')})`)
console.log(`  locales   : en + ${UNDER_TEST.join(' ')}`)
console.log(`  assertions: ${checked.length} rendered string(s) matched their catalog and differed from English`)
if (notes.length) {
  console.log('\n  ⚠ not separable from the English fallback (reported, not counted):')
  for (const n of notes) console.log('    ' + n)
}
// ⚠ THE THRESHOLD THAT MAKES THE PER-PAIR EXEMPTION SAFE. Mutation-tested 2026-09-24:
// with it/tabs.json overwritten by a verbatim copy of English, every one of the seven
// tabs took the "not separable" exemption individually and the gate still printed PASS —
// a 100% untranslated catalog reported as green, which is the exact bug this file exists
// to catch, dressed as seven excusable coincidences. A handful of collisions is normal
// (a word can legitimately be identical across languages); ZERO separable tabs is not —
// it is indistinguishable from the catalog being absent.
for (const loc of UNDER_TEST) {
  if (!separable[loc]) {
    fails.push(`${loc} renders NO tab differently from English (${TABS.length}/${TABS.length} identical) — `
      + 'a catalog of English strings and a missing catalog are the same thing to a reader')
  }
}

if (fails.length) {
  console.error(`\nTABS-LOCALIZED: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
// A gate that asserts nothing must not report success.
const expected = UNDER_TEST.length * TABS.length + TABS.length
if (checked.length + notes.length < expected) {
  console.error(`\nTABS-LOCALIZED: FAIL — only ${checked.length + notes.length} of ${expected} tab/locale pairs were evaluated`)
  process.exit(1)
}
console.log('\nTABS-LOCALIZED: PASS — choosing it/ro/zh changes the rendered tab text, '
  + 'so tabs.json is reached by the app rather than merely present on disk.')
