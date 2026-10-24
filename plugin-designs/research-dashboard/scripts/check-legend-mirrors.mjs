#!/usr/bin/env node
/**
 * check-legend-mirrors.mjs — the legends must MIRROR, and their labels must not become values.
 *
 * the Arabic survey on main 52eeb0db: the research-dashboard legends sat on the wrong edge with
 * ENGLISH text — 70 of 85 letters Latin — in Big Picture and in the Research Gallery. Two faults
 * that look like one, and they fail in opposite directions if you fix them carelessly.
 *
 * ── 1. A PHYSICAL INSET DOES NOT MIRROR ──────────────────────────────────────────────────────
 * `right:8px` pins a box to the physical right edge in every locale, so in Arabic it stays where an
 * English reader expects it while everything around it flips. The logical property is the fix, and
 * `inset-inline-start:auto` / `inset-inline-end:auto` is part of the pair rather than decoration:
 * it cancels a physical inset inherited from a control container, which otherwise stretches the box
 * across the map once the other edge moves.
 * Two surfaces are asserted because they are the two the survey named, and one of them — the
 * research-map geocoder column — exists ONLY to share an edge with the legend beside it. A shared
 * edge that one of the pair honours and the other does not is worse than no alignment: it reads as
 * a broken layout rather than as a choice.
 *
 * ── 2. THE LABEL IS PROJECTED; THE VALUE IS NOT ──────────────────────────────────────────────
 * The English in that legend was NOT chrome. `s.key` is a facet VALUE, and for the religion donut
 * it is a family name DERIVED in English by library/colors/religion.js — the same table
 * people-groups-grid re-derives per row so the two ends byte-match. So the obvious fix, translating
 * the strings, is the dangerous one: it would work in English and match nothing in Arabic,
 * SILENTLY, because an empty intersection reads as "no results". That is the language-link defect
 * one facet over, and it cost a card to learn the first time.
 * So this gate asserts BOTH halves: that the visible text is projected, AND that the projection did
 * not leak into the value — data-key still carries the raw key, and RELIGION_FAMILIES is still the
 * English table every consumer compares against.
 *
 * NEGATIVE-TESTED: a physical inset on either surface fails 1; binding data-key to the projection,
 * or dropping the projection from the visible text, fails 2; translating a RELIGION_FAMILIES value
 * fails 2 naming the link it would break.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'LEGEND-MIRRORS'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const fails = []
const notes = []
/* Every .vue/.js under the two source roots — the importer sweep needs a file list, and building it
 * here keeps arm 5 from trusting a hardcoded list of "the files that could import this". */
function sources(dir = null, acc = []) {
  const base = dir || ROOT
  let entries = []
  try { entries = readdirSync(base, { withFileTypes: true }) } catch (_) { return acc }
  for (const e of entries) {
    const full = join(base, e.name)
    const rel = full.slice(ROOT.length + 1)
    if (/(^|\/)(node_modules|dist|public|\.git)(\/|$)/.test(rel)) continue
    if (dir === null && !/^(plugin-designs|library)$/.test(e.name)) continue
    if (e.isDirectory()) sources(full, acc)
    else if (/\.(vue|js|mjs)$/.test(e.name)) acc.push(rel)
  }
  return acc
}

const read = (rel) => { const p = join(ROOT, rel); return existsSync(p) ? readFileSync(p, 'utf8') : null }

// ── 1. logical insets on the two surfaces the survey named ───────────────────────────────────
const SURFACES = [
  { rel: 'plugin-designs/research-dashboard/src/components/dashboards/DashboardMapPanel.vue',
    sel: '.rd-legend-map', want: 'inset-inline-end', what: 'the map legend' },
  { rel: 'plugin-designs/doxa-research-map/research-map.vue',
    sel: '.mapboxgl-ctrl-top-left', want: 'inset-inline-start',
    what: 'the geocoder column, which exists to share an edge with the legend below it' },
]
for (const { rel, sel, want, what } of SURFACES) {
  const src = read(rel)
  if (!src) { fails.push(`1  ${rel} is missing — this gate is blind to ${what}.`); continue }
  const rule = new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(src)
  if (!rule) { fails.push(`1  ${rel}: no ${sel} rule found — it moved or was renamed, and this gate cannot see ${what}.`); continue }
  const body = rule[1]
  const physical = [...body.matchAll(/(^|[;{\s])(left|right)\s*:/g)].map((m) => m[2])
  if (physical.length) {
    fails.push(`1  ${rel}: ${sel} uses the PHYSICAL inset(s) ${[...new Set(physical)].join(', ')} — ${what} will not mirror under ar, so it lands on the edge an English reader expects while everything around it flips.`)
  }
  if (!body.includes(want)) {
    fails.push(`1  ${rel}: ${sel} has no ${want} — ${what} has nothing anchoring it to the reading direction.`)
  }
  const other = want === 'inset-inline-end' ? 'inset-inline-start' : 'inset-inline-end'
  if (!new RegExp(`${other}\\s*:\\s*auto`).test(body)) {
    fails.push(`1  ${rel}: ${sel} sets ${want} without ${other}:auto. The pair is what cancels a physical inset inherited from a control container; without it the box stretches across the map once the anchored edge moves.`)
  }
}
if (!fails.some((f) => f.startsWith('1'))) notes.push(`insets: ${SURFACES.length} surface(s) anchored to the reading direction, both halves of the pair present`)

// ── 2a. the visible text is projected, the wire is not ───────────────────────────────────────
{
  const rel = 'plugin-designs/research-dashboard/src/components/dashboards/DashboardChartsRail.vue'
  const src = read(rel)
  if (!src) fails.push(`2  ${rel} is missing.`)
  else {
    const li = /<span v-for="s in chart\.geometry"[\s\S]*?<\/span>\n/.exec(src)
    if (!li) fails.push(`2  ${rel}: the legend item markup moved — this gate is blind to what it renders.`)
    else {
      const m = li[0]
      if (!/class="rd-lt">\{\{ legendLabel\(/.test(m)) {
        fails.push(`2  ${rel}: the legend's visible text is not projected through legendLabel() — a derived English facet value renders untranslated in all eleven locales.`)
      }
      // ★ EVERY data-key IN THE FILE, not just this one. A first version checked only the legend
      // item, and a mutation test aimed at it silently hit a DIFFERENT :data-key — the donut
      // segment — and the gate stayed green while a projection sat on a wire. There are three
      // (segment, legend item, bar), all of them values the bus compares, and a check that guards
      // one of three is a check whose own negative test can miss.
      const keyBinds = [...src.matchAll(/:data-(?:key|facet)="([^"]*)"/g)]
      if (keyBinds.length < 3) fails.push(`2  ${rel}: expected at least 3 :data-key/:data-facet bindings (segment, legend item, bar) and found ${keyBinds.length} — the markup moved and this gate is guarding less than it thinks.`)
      for (const b of keyBinds) {
        if (/legendLabel\(|religionFamilyLabel\(|tStatic\(/.test(b[1])) {
          fails.push(`2  ${rel}: a PROJECTION is bound to a wire attribute (${b[0]}). The value is what the bus and the grid compare; a localized one works in English and matches NOTHING in Arabic, silently, because an empty intersection reads as "no results". Labels are for readers; values cross boundaries.`)
        }
      }
      if (!/:data-key="s\.key"/.test(m)) {
        fails.push(`2  ${rel}: the legend item's data-key no longer carries the RAW key.`)
      }
      if (!fails.some((f) => f.startsWith('2'))) notes.push('charts legend: text projected, data-key still the canonical value')
    }
  }
}

// ── 2b. the table itself was not translated ──────────────────────────────────────────────────
{
  const rel = 'library/colors/religion.js'
  const src = read(rel)
  if (!src) fails.push(`2  ${rel} is missing.`)
  else {
    const tbl = /export const RELIGION_FAMILIES = \{([\s\S]*?)\}/.exec(src)
    if (!tbl) fails.push(`2  ${rel}: RELIGION_FAMILIES not found.`)
    else {
      const values = [...tbl[1].matchAll(/'[A-Z]':\s*'([^']+)'/g)].map((m) => m[1])
      const nonAscii = values.filter((v) => /[^\x20-\x7E]/.test(v))
      if (nonAscii.length) {
        fails.push(`2  ${rel}: RELIGION_FAMILIES has been TRANSLATED (${nonAscii.join(', ')}). These are VALUES: the dashboard puts them on the selection bus and people-groups-grid re-derives them per row. Localized, the link works in English and matches nothing elsewhere. Translate religionFamilyLabel's catalogue entries instead.`)
      }
      if (!/export function religionFamilyLabel/.test(src)) {
        fails.push(`2  ${rel}: religionFamilyLabel() is gone, so there is no way to show a family name to a reader without translating the value.`)
      }
      if (!fails.some((f) => f.includes('RELIGION_FAMILIES has been'))) notes.push(`religion table: ${values.length} values still canonical English, projection available`)
    }
  }
}

// ── 2c. the projection has something to project ──────────────────────────────────────────────
{
  const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'pt', 'ro', 'ru', 'zh']
  const en = read('library/i18n/locales/en/religion.json')
  if (!en) fails.push('2  library/i18n/locales/en/religion.json is missing — religionFamilyLabel() would fall back to English everywhere, which is the defect it exists to fix.')
  else {
    const names = Object.keys(JSON.parse(en).family || {})
    if (!names.length) fails.push('2  en/religion.json has no `family` entries.')
    for (const loc of LOCALES) {
      const j = read(`library/i18n/locales/${loc}/religion.json`)
      if (!j) { fails.push(`2  ${loc}/religion.json is missing.`); continue }
      const missing = names.filter((n) => !(JSON.parse(j).family || {})[n])
      if (missing.length) fails.push(`2  ${loc}/religion.json is missing ${missing.length} family name(s): ${missing.join(', ')}`)
    }
    if (!fails.some((f) => f.includes('religion.json'))) notes.push(`catalogue: ${names.length} family names in all ${LOCALES.length} locales`)
  }
}

// ── 3. THE INVERTED DEPENDENCY, AND THE NO-LEGEND FALLBACK (kit landing 4b) ───────────────────
// The rail and the chips used to IMPORT useTreeLegendColors / useTreeLegendLabels — the DOXA
// palettes and the People code tables, which are research-specific and stay in plugin-designs.
// That import is what stopped the rail from being able to move into the kit at all: a library
// component importing a plugin composable is what check:no-cross-plugin-imports refuses. The shell
// now supplies both as dashboardConfig.legend, so the panels declare what they need and the research
// plugin keeps owning its colours.
//
// ★ WHAT THIS ARM DOES AND DOES NOT DO, stated because the difference matters. It drives the
// FALLBACK EXPRESSIONS lifted out of the SFC — so "no legend yields a neutral swatch and a raw
// value" is measured, not assumed — and it asserts the imports are gone. It does NOT mount the
// component: mounting an SFC here needs the Vite/no-op-renderer harness check:composites-mount
// carries, and a no-op renderer cannot show a colour anyway, so a mount would prove only "it did
// not throw" at the cost of a dev server in a gate that otherwise runs in milliseconds. The
// rendered result is the browser QA step's, on the NEEDS-EYES row for this landing.
{
  const RAIL = 'library/components/dashboards/DashboardFacetRail.vue'   // moved by kit landing 4c-3
  const CHIP = 'library/components/dashboards/DashboardFilterChips.vue'   // moved by kit landing 4c-2
  for (const [rel, what] of [[RAIL, 'the facet rail'], [CHIP, 'the chip bar']]) {
    const src = read(rel)
    if (!src) { fails.push(`3  ${rel} is missing.`); continue }
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    if (/from '\.\.\/\.\.\/composables\/useTreeLegend(Colors|Labels)\.js'/.test(code)) {
      fails.push(`3  ${what} still imports a useTreeLegend* composable. Those are the research palettes; a kit component importing them is the library-to-plugin dependency that stops this file from moving at all.`)
    }
    if (!/legend/.test(code)) fails.push(`3  ${what} never reads cfg.legend, so the shell has nothing to hand it.`)
  }
  // Drive the rail's two fallbacks with NO legend at all.
  const railSrc = read(RAIL) || ''
  const neutral = /const KIT_NEUTRAL_SWATCH = '(#[0-9a-fA-F]{3,8})'/.exec(railSrc)
  const cFor = /const colorFor = (\(\.\.\.a\)[^\n]*)/.exec(railSrc)
  const lFor = /const legendLabelFor = (\([^\n]*)/.exec(railSrc)
  if (!neutral || !cFor || !lFor) {
    fails.push('3  could not lift the rail\'s no-legend fallbacks (KIT_NEUTRAL_SWATCH, colorFor, legendLabelFor) — a consumer that supplies no legend would get whatever this gate can no longer see.')
  } else {
    const legend = { value: null }
    const KIT_NEUTRAL_SWATCH = neutral[1]
    const colorFor = new Function('legend', 'KIT_NEUTRAL_SWATCH', `return ${cFor[1]}`)(legend, KIT_NEUTRAL_SWATCH)
    const legendLabelFor = new Function('legend', `return ${lFor[1]}`)(legend)
    if (colorFor('religion', 'religion', 'M', '') !== KIT_NEUTRAL_SWATCH) {
      fails.push('3  with no legend the rail does not fall back to its neutral swatch — an unconfigured dashboard should look PLAIN, not coloured by accident.')
    }
    if (legendLabelFor('affinity_bloc', 'A012') !== 'A012') {
      fails.push('3  with no legend the rail does not pass the raw value through as its label — a consumer with no code tables must see the code, not blank.')
    }
    // And the research palette's own NEUTRAL must NOT be imported to get that value.
    // ★ COMMENT-STRIPPED, and this is the FIFTH time I have written this hole. The comment beside
    // KIT_NEUTRAL_SWATCH explains the decision by NAMING the research NEUTRAL, so testing the raw
    // source reported a coupling that does not exist — my own documentation failing my own check.
    // I had already fixed this shape four times in other gates and still wrote the raw-source
    // version here, which says the fix belongs in a habit rather than in each gate: every text
    // search over source strips comments first, without thinking about it.
    const railCode = railSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    if (/NEUTRAL/.test(railCode.replace(/KIT_NEUTRAL_SWATCH/g, ''))) {
      fails.push('3  the rail references the research palette\'s NEUTRAL. Coupling the kit\'s neutral to the research one re-creates the dependency this landing removes; they happen to match today and must stay independent.')
    }
    if (!fails.some((f) => f.startsWith('3'))) notes.push(`no-legend fallback: neutral ${KIT_NEUTRAL_SWATCH} and raw values, with the research imports gone`)
  }
}

// ── 4. THE ROLLUP BUCKET: SENTINEL KEY, TRANSLATED LABEL (kit landing 4c-1) ───────────────────
// aggregate()'s topN tail becomes `{ key: 'Other', other: true }`, and that English word was
// rendered directly in both rails, in every locale. check:i18n-keys-exist could not see it because
// there was no T() call to inspect — the string was never a lookup, it was a KEY being used as a
// LABEL. Found while assessing 4c, and fixed before the module moved, because unfixed it would have
// been exported to every future dashboard the moment this became kit code.
// Both halves are asserted, and they pull in opposite directions: the KEY must stay English (the
// rail tests it to make the row inert, and the charts rail refuses to filter on it — a localized key
// would make the bucket clickable in Arabic on a value no row carries), while the LABEL must not be.
{
  const AGG = 'library/composables/useFacetAggregation.js'
  const src = read(AGG)
  if (!src) notes.push(`${AGG}: not present yet (kit landing 4c-1 not applied) — skipped`)
  else {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const k = /export const OTHER_KEY = '([^']*)'/.exec(code)
    if (!k) fails.push(`4  ${AGG}: no OTHER_KEY export — the sentinel and its label have no single owner, which is how they drift.`)
    else if (k[1] !== 'Other') fails.push(`4  OTHER_KEY is ${JSON.stringify(k[1])}. It is a SENTINEL: the rail tests it to make the bucket inert and the charts rail refuses to filter on it, so changing it silently makes the bucket clickable on a value no row carries.`)
    if (!/export const otherLabel = \(\) =>[\s\S]{0,120}tStatic\('dashboard\.other'\)/.test(code)) {
      fails.push(`4  ${AGG}: otherLabel() does not read dashboard.other, so the bucket renders English in every locale.`)
    }
    // the catalogue has to hold it, in every locale
    const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'pt', 'ro', 'ru', 'zh']
    const missing = LOCALES.filter((l) => { const j = read(`library/i18n/locales/${l}/dashboard.json`); return !j || !JSON.parse(j).other })
    if (missing.length) fails.push(`4  dashboard.other is missing in ${missing.length} locale(s): ${missing.join(', ')}`)
    // and the render sites must project rather than print the key
    const rail = read('library/components/dashboards/DashboardFacetRail.vue') || ''   // moved by kit landing 4c-3
    if (!/label: d\.other \? otherLabel\(\) : d\.key/.test(rail)) {
      fails.push('4  the facet rail does not project the bucket label — it renders the sentinel, so every locale reads "Other".')
    }
    if (!/facet, value: d\.key/.test(rail)) {
      fails.push('4  the facet rail no longer carries d.key as the row VALUE. The value is what inertness is tested against; projecting it would make the bucket filterable.')
    }
    if (!fails.some((f) => f.startsWith('4'))) notes.push(`rollup bucket: key stays ${JSON.stringify(k[1])}, label reads dashboard.other in all ${LOCALES.length} locales`)
  }
}

// ── 5. THE MOVED CHIP BAR: THE FILE IS ACTUALLY GONE, AND ITS DEFAULT RESOLVER IS DRIVEN ──────
// Kit landing 4c-2 moves DashboardFilterChips.vue into library/components/dashboards/. Two things
// can go wrong in a "move" and only one of them is visible by reading the new file:
//   (a) the old copy survives, so the tree holds two chip bars that drift apart — the failure this
//       repo has already paid for with useNeighborT/usePplrT at Jaccard 0.82;
//   (b) the kit's UNCONFIGURED behaviour is wrong, which nobody notices because every dashboard in
//       this tree supplies a resolver. the gospel-internet board is the consumer that will not, at first.
// So the arm asserts the move is complete and then LIFTS the default out of the source and RUNS it,
// the same way arm 3 drives the rail's fallbacks. Not a mount: a no-op renderer cannot show a chip,
// and the rendered result is the browser QA step's.
{
  const NEW = 'library/components/dashboards/DashboardFilterChips.vue'
  const OLD = 'plugin-designs/research-dashboard/src/components/dashboards/DashboardFilterChips.vue'
  const BARREL = 'plugin-designs/research-dashboard/src/components/dashboards/index.js'
  const src = read(NEW)
  if (!src) {
    fails.push(`5  ${NEW} is missing — the kit component the barrel now points at does not exist.`)
  } else {
    if (read(OLD)) fails.push(`5  ${OLD} still exists. A move that leaves the original behind is a COPY, and two chip bars over one filterSet drift apart the moment one is edited.`)
    // ★ THIS ASSERTION INVERTED WHEN THE SHIM WINDOW CLOSED, and the inversion is the point rather
    // than an edit. While the one-cycle shim existed, the thing that could break was an importer of
    // the barrel failing to resolve, so the arm REQUIRED the re-export. Now that the shim is retired
    // the risk is the opposite and larger: a re-export creeping back makes the plugin barrel look
    // like the owner of a library component, which is exactly how check:filter-multivalue ended up
    // reading a shim instead of the panel it was written to guard, and passing vacuously.
    // A one-cycle shim that nobody retires is permanent, so the gate now holds the window closed.
    const barrel = read(BARREL) || ''
    const barrelCode = barrel.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    for (const moved of ['DashboardFilterChips', 'DashboardFacetRail', 'DashboardBreadcrumb']) {
      if (new RegExp(`export[^\\n]*${moved}`).test(barrelCode)) {
        fails.push(`5  ${BARREL} re-exports ${moved}, which lives in library/components/dashboards/. The one-cycle shim is retired: importers read '@map/components/dashboards/${moved}.vue' directly, and a barrel re-export makes the plugin look like the owner of a kit component.`)
      }
      // And nobody may still be reading it through the barrel or from the path it left.
      for (const rel of sources()) {
        const src = read(rel); if (!src) continue
        const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        // ★ ONE IMPORT STATEMENT AT A TIME. The first version used `import … ${moved} …
        // [\s\S]{0,200}? from '…'`, and that span CROSSED INTO THE NEXT STATEMENT: after the fix,
        // research-dashboard.vue reads `import DashboardFacetRail from '@map/…'` immediately followed
        // by a braced import ending `from './src/components/dashboards'`, so the regex started at the
        // CORRECT line and found the barrel path two statements later. It reported the file it had
        // just been fixed in. Third unbounded-span false positive I have written today (the others
        // walked a brace match past a callback-less watch() and read a chip label's own name as
        // prose), so the shape is the lesson: never let a span cross a statement boundary — bound it
        // with a negative lookahead for the next statement keyword.
        const IMPORTS = /\bimport\b(?:(?!\bimport\b)[\s\S])*?\bfrom\s*'([^']*)'/g
        let stmt
        while ((stmt = IMPORTS.exec(code))) {
          const spec = stmt[0]
          const path = stmt[1]
          if (!new RegExp(`\\b${moved}\\b`).test(spec)) continue
          const viaBarrel = /components\/dashboards$/.test(path)
          const viaOldPath = new RegExp(`plugin-designs[^']*${moved}\\.vue$`).test(path)
          if (viaBarrel || viaOldPath) {
            fails.push(`5  ${rel} still imports ${moved} from '${path}'. It moved to library/components/dashboards/ — import it from '@map/components/dashboards/${moved}.vue'.`)
          }
        }
      }
    }
    // Comments first: this file's own notes name cfg.legend and useTreeLegendLabels.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    if (/from '\.\.\//.test(code) || /useTreeLegend/.test(code)) {
      fails.push('5  the kit chip bar imports something relative or research-specific. A library component reaching back into plugin-designs is what check:no-cross-plugin-imports refuses, and it is the one thing 4b removed to make this move possible.')
    }
    for (const dead of ['dataStore', 'searchSourceId']) {
      if (new RegExp(`inject\\(\\s*'${dead}'`).test(code)) {
        fails.push(`5  the kit chip bar still injects '${dead}', which existed only to build useTreeLegendLabels. An unused inject is a claim about the host: a new dashboard would provide it before finding out it is never read.`)
      }
    }
    const lf = /const labelFor = (\([^\n]*)/.exec(src)
    if (!lf) {
      fails.push('5  could not lift `const labelFor` out of the kit chip bar, so its unconfigured behaviour is whatever this gate can no longer see. Keep it one expression.')
    } else {
      // The chip joins a multi-value filter with library/i18n's formatList. It is LIFTED from index.js exactly
      // as the chip's own expression is, so the gate drives the shipped list grammar, not a re-typed copy.
      const i18nSrc = read('library/i18n/index.js') || ''
      const flStart = i18nSrc.indexOf('const listFormats = new Map()')
      const flEnd = i18nSrc.indexOf('\n}\n', i18nSrc.indexOf('export function formatList')) + 2
      const formatList = new Function('getRuntimeLocale', 'detectLocale',
        `${i18nSrc.slice(flStart, flEnd).replace('export function', 'function')}\nreturn formatList`)(() => '', () => 'en')
      const make = (cfg) => new Function('cfg', 'formatList', `return ${lf[1]}`)(cfg, formatList)
      const bare = make({})
      if (bare('affinity_bloc', 'A012') !== 'A012') {
        fails.push('5  with NO resolver the kit chip bar does not pass a scalar value through — a dashboard that has not wired its code tables must see the code, not blank.')
      }
      if (bare('religion', ['Islam', 'Hinduism']) !== 'Islam or Hinduism') {
        fails.push(`5  with NO resolver a MULTI-VALUE filter (spec D1) renders as ${JSON.stringify(String(bare('religion', ['Islam', 'Hinduism'])))} instead of a joined list. Configured and unconfigured must differ in whether CODES RESOLVE, never in punctuation — a comma-jammed "A012,A013" reads as a rendering bug rather than as missing configuration.`)
      }
      const wired = make({ legend: { labelFor: () => 'SUPPLIED' } })
      if (wired('affinity_bloc', 'A012') !== 'SUPPLIED') {
        fails.push('5  a supplied cfg.legend.labelFor does not win over the default, so a dashboard that configures its labels would still show raw codes.')
      }
      if (!fails.some((f) => f.startsWith('5'))) notes.push('kit chip bar: moved with no copy left behind, no dead injects, and its no-resolver default passes scalars through and joins lists')
    }
  }
}

for (const n of notes) console.log('  · ' + n)
if (fails.length) {
  console.error(`\n${TAG}: FAIL`)
  for (const f of fails) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`${TAG}: PASS — the legends mirror, and their labels never became their values.`)
