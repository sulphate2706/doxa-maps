#!/usr/bin/env node
/**
 * check-filter-multivalue.mjs — OR-within-key, AND-across-keys, and ONE predicate that says so.
 *
 * SPEC-DASHBOARD-KIT D1. `filterSet[key]` may hold an array meaning "any of these"; keys still
 * AND together. This gate exists because the change is four lines of behaviour sitting on top of a
 * rule that was WRITTEN OUT SEVEN TIMES.
 *
 * THE DANGER D1 CREATED, which is the whole reason this is gated rather than reviewed:
 * `a(r) === filterSet[k]` appeared in the shell's filteredRows, the facet rail twice, the map
 * panel, the table, the charts rail and the CSV exporter. Seven copies of a one-character rule are
 * survivable. The moment the rule grows an array case, six of the seven keep comparing an array
 * with `===`, every one of them quietly matches NOTHING, and the panels disagree with each other
 * about what is on screen — the facet rail printing counts for a scope the map and table no longer
 * render, which is a number a reader acts on before clicking. So D1 is not only "arrays are
 * allowed"; it is "there is one function that answers *does this row match*, and every panel calls
 * it". This gate asserts the second half, because only the second half can be silently undone.
 *
 * WHAT IT CHECKS:
 *   A. BEHAVIOUR, by running the real bus: an array ORs within the key; keys AND; a one-element
 *      array stores as the scalar it means; an EMPTY array clears rather than matching nothing;
 *      toggleFilterValue adds, removes, and clears on the last value; the cascade still fires.
 *   B. NO SURVIVING COPIES: `=== filterSet[k]` / `=== bus.filterSet[k]` must not appear in any
 *      panel. One allowed exception, named: useCsvExport's parameter default, which exists so a
 *      caller predating D1 does not throw.
 *   C. THE HASH round-trips a list, including a value that CONTAINS a comma — a delimiter that can
 *      also occur inside a value is not a delimiter.
 *   D. THE GRID'S END matches the same way: valueMatches() takes a list and ORs it, so the two
 *      implementations of one rule cannot drift into disagreeing.
 *
 * NOT CHECKED, because it is deliberately NOT part of D1: a plain click still REPLACES rather than
 * adds. D1 gives the bus the capability; making a rail row additive on an unmodified click would
 * change what every existing click does to the flagship, which is a product decision and not this
 * one. The array path is reached programmatically today (the composite's language code set).
 *
 * NEGATIVE-TESTED: restoring `=== filterSet[k]` in any panel fails B naming the file; making
 * facetMatches use `includes` on a scalar fails A; dropping the comma from escapeValue's reserved
 * set fails C. No browser.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'FILTER-MULTIVALUE'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const fails = []
const notes = []
const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${what} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }

// ── A. the real bus, exercised ───────────────────────────────────────────────────────────────
const BUS = join(ROOT, 'library/composables/useSelectionBus.js')
if (!existsSync(BUS)) { console.log(`${TAG}: SKIP — no ${BUS.replace(ROOT + '/', '')} (kit landing 1 not applied).`); process.exit(0) }
const { createSelectionBus } = await import(BUS)
{
  const bus = createSelectionBus()
  bus.configureHierarchy({ facetRail: [{ id: 'place', drill: ['region', 'block', 'country'] }] })
  bus.setFilter('religion', ['Islam', 'Hinduism'])
  eq('A array is stored as an array', bus.filterSet.religion, ['Islam', 'Hinduism'])
  eq('A OR within the key (member)', bus.facetMatches('Hinduism', bus.filterSet.religion), true)
  eq('A OR within the key (non-member)', bus.facetMatches('Jewish', bus.filterSet.religion), false)
  eq('A isFilterActive sees into the array', bus.isFilterActive('religion', 'Islam'), true)

  bus.setFilter('region', 'Asia')
  const ACC = { religion: (r) => r.religion, region: (r) => r.region }
  eq('A AND across keys (both hold)', bus.rowMatchesFilters({ religion: 'Islam', region: 'Asia' }, ACC), true)
  eq('A AND across keys (one fails)', bus.rowMatchesFilters({ religion: 'Islam', region: 'Africa' }, ACC), false)
  eq('A a key with no accessor is skipped, not failed', bus.rowMatchesFilters({ religion: 'Islam', region: 'Asia' }, { religion: ACC.religion }), true)

  bus.setFilter('religion', ['Islam'])
  eq('A a one-element array stores as the scalar it means', bus.filterSet.religion, 'Islam')
  bus.setFilter('religion', [])
  eq('A an EMPTY array CLEARS rather than matching nothing', 'religion' in bus.filterSet, false)

  bus.setFilter('tags', 'a'); bus.toggleFilterValue('tags', 'b')
  eq('A toggle adds', bus.filterSet.tags, ['a', 'b'])
  bus.toggleFilterValue('tags', 'b')
  eq('A toggle removes, collapsing to the scalar', bus.filterSet.tags, 'a')
  bus.toggleFilterValue('tags', 'a')
  eq('A toggling the last value clears the key', 'tags' in bus.filterSet, false)

  // The hierarchy contract must still hold with arrays in play.
  bus.setFilter('region', ['Asia', 'Africa']); bus.setFilter('block', 'South Asia'); bus.setFilter('country', 'IND')
  bus.setFilter('region', null)
  eq('A clearing a multi-value parent still cascades', Object.keys(bus.filterSet).sort(), [])
  notes.push('bus: OR within a key, AND across keys, empty array clears, cascade intact')
}

// ── B. no surviving copies of the predicate ──────────────────────────────────────────────────
{
  const PANELS = [
    'plugin-designs/research-dashboard/src/composables/useDashboardShell.js',
    // Follows the file (kit landing 3). Left at the plugin path this would have read the
    // re-export shim, found no predicate to object to, and PASSED VACUOUSLY — a gate going quiet
    // about the thing it guards, which is worse than one that fails.
    'library/composables/useCsvExport.js',
    'library/components/dashboards/DashboardFacetRail.vue',   // follows the file (kit landing 4c-3)
    'plugin-designs/research-dashboard/src/components/dashboards/DashboardMapPanel.vue',
    'plugin-designs/research-dashboard/src/components/dashboards/DashboardChartsRail.vue',
  ]
  for (const rel of PANELS) {
    const p = join(ROOT, rel)
    if (!existsSync(p)) { fails.push(`B  ${rel} is missing — this gate is blind to it.`); continue }
    for (const [i, line] of readFileSync(p, 'utf8').split('\n').entries()) {
      if (/^\s*(\/\/|\*)/.test(line)) continue                       // a comment quoting the old rule is fine
      if (!/===\s*(bus\.)?filterSet\[/.test(line)) continue
      // ★ THE EXEMPTION THAT USED TO SIT HERE IS GONE, AND IT WAS WRONG. It allowed
      // useCsvExport's default rowMatches to keep `=== filterSet[k]`, reasoning that the default only
      // "keeps a pre-D1 caller working". MEASURED: there is no such caller. DashboardDataTable and
      // DashboardDetailDrawer both use that default, so it was the LIVE path for two of three callers,
      // and a multi-value filter made the export match nothing at all. An exemption is a claim about
      // who is affected; this one was never checked, and the gate stayed green over a real defect on
      // the file it was pointed at. The default is array-aware now, so nothing needs excusing.
      fails.push(`B  ${rel}:${i + 1} still compares with === against filterSet — with an array that matches NOTHING, and this panel would disagree with the others about what is on screen.\n      ${line.trim().slice(0, 140)}`)
    }
  }
  if (!fails.some((f) => f.startsWith('B'))) notes.push(`panels: ${PANELS.length} checked, no surviving copy of the predicate`)
}

// ── C. the hash round-trips a list, commas and all ───────────────────────────────────────────
{
  const src = readFileSync(join(ROOT, 'library/composables/useShareableView.js'), 'utf8')
  const esc = /const escapeValue = (\(s\) =>[^\n]*)/.exec(src)
  const unesc = /const unescapeValue = (\(s\) =>[^\n]*)/.exec(src)
  if (!esc || !unesc) fails.push('C  could not lift escapeValue/unescapeValue from useShareableView.js — the hash format moved and this gate is blind to it.')
  else {
    const escapeValue = new Function('return ' + esc[1])()
    const unescapeValue = new Function('return ' + unesc[1])()
    for (const list of [['apd', 'acm', 'ayl'], ['Arabic, Sudanese'], ['Islam', 'Hinduism'], ['a+b', 'c;d']]) {
      const back = list.map(escapeValue).join(',').split(',').map(unescapeValue)
      eq(`C hash round-trip ${JSON.stringify(list)}`, back, list)
    }
    if (!fails.some((f) => f.startsWith('C'))) notes.push('hash: a list round-trips, including a value that contains a comma')
  }
}

// ── D. the grid ORs the same way ─────────────────────────────────────────────────────────────
{
  const src = readFileSync(join(ROOT, 'plugin-designs/people-groups-grid/people-groups-grid.vue'), 'utf8')
  const m = /function valueMatches\(vl, selection\) \{([\s\S]*?)\n\}/.exec(src)
  const n = /const norm = ([^\n]*)/.exec(src)
  if (!m || !n) fails.push('D  could not lift valueMatches/norm from people-groups-grid.vue — the grid matcher moved.')
  else {
    const valueMatches = new Function('norm', `return function valueMatches(vl, selection) {${m[1]}\n}`)(new Function('return ' + n[1])())
    const row = { value: 'acm', label: 'Arabic, Mesopotamian' }
    eq('D grid matches a member of the list', valueMatches(row, { value: 'apd|acm|ayl' }), true)
    eq('D grid rejects a non-member', valueMatches(row, { value: 'apd|ayl' }), false)
    eq('D grid still matches a single value', valueMatches(row, { value: 'acm' }), true)
    // ★ THIS ASSERTION IS THE ONE THAT EARNED ITS KEEP. The first D1 draft split the selection on
    // `,` and broke label matching outright — 40% of live language labels are comma-inverted, so
    // the selection was chopped in half and matched nothing. Asserting a behaviour you are KEEPING
    // is what caught it; asserting only the behaviour you are adding would have shipped it.
    eq('D grid still matches on the LABEL, commas and all', valueMatches(row, { value: 'Arabic, Mesopotamian' }), true)
    eq('D an empty selection matches nothing', valueMatches(row, { value: '' }), false)
    if (!fails.some((f) => f.startsWith('D'))) notes.push('grid: valueMatches ORs a list, and a single value takes the path it always did')
  }
}

// ── E. the shared SEARCH is declared once, like the predicate ─────────────────────────────────
// Arm B above exists because a copied predicate lets one panel disagree with the others about what
// is on screen. The free-text SEARCH is the same hazard with a different name, and it had already
// happened: kit landing 4a extracted buildSearchAccessors / makeSearchMatcher / filterRowsBySearch
// into library/composables/useDashboardSearch.js and LEFT THEM DEFINED in
// plugin-designs/research-dashboard/src/composables/useDashboardShell.js as well — code-identical
// copies, ~4.3KB including the Fuse.js matcher. Nothing had diverged, so nothing failed; the rail
// simply ran one copy while the shell's KPIs and three panels ran the other. That is the shape this
// repo already paid for at Jaccard 0.82 with useNeighborT/usePplrT.
// So: ONE module declares them, and nobody may import them from the shell.
{
  const SEARCH_FNS = ['buildSearchAccessors', 'makeSearchMatcher', 'filterRowsBySearch']
  const SHELL = 'plugin-designs/research-dashboard/src/composables/useDashboardShell.js'
  const HOME = 'library/composables/useDashboardSearch.js'
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const read = (rel) => { const f = join(ROOT, rel); return existsSync(f) ? readFileSync(f, 'utf8') : null }
  // Every .vue/.js under the two source roots, so the importer sweep cannot rely on a hardcoded list
  // of "the files that might import this" — which is the assumption that let 4a's copies survive.
  const sources = (dir = null, acc = []) => {
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
  const homeSrc = read(HOME)
  if (!homeSrc) fails.push(`E  ${HOME} is missing — the shared search has no home.`)
  else for (const fn of SEARCH_FNS) {
    if (!new RegExp(`export function ${fn}\\b`).test(strip(homeSrc))) {
      fails.push(`E  ${HOME} does not export ${fn} — the module that is supposed to own it does not declare it.`)
    }
  }
  const shellSrc = read(SHELL)
  if (shellSrc) for (const fn of SEARCH_FNS) {
    if (new RegExp(`export function ${fn}\\b`).test(strip(shellSrc))) {
      fails.push(`E  ${SHELL} DEFINES ${fn}, which ${HOME} owns. Two copies of the search mean two answers to "what does this term match", and the panels split between them.`)
    }
  }
  for (const rel of sources()) {
    const src = read(rel); if (!src || rel === SHELL) continue
    const code = strip(src)
    const IMPORTS = /\bimport\b(?:(?!\bimport\b)[\s\S])*?\bfrom\s*'([^']*)'/g
    let m
    while ((m = IMPORTS.exec(code))) {
      if (!/useDashboardShell/.test(m[1])) continue
      const named = SEARCH_FNS.filter((fn) => new RegExp(`\\b${fn}\\b`).test(m[0]))
      if (named.length) {
        fails.push(`E  ${rel} imports ${named.join(', ')} from the shell. They live in ${HOME} — import them from '@map/composables/useDashboardSearch.js'.`)
      }
    }
  }
  if (!fails.some((f) => f.startsWith('E'))) notes.push('shared search: declared once in library, and no panel reads it through the shell')
}

for (const n of notes) console.log('  · ' + n)
if (fails.length) {
  console.error(`\n${TAG}: FAIL`)
  for (const f of fails) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`${TAG}: PASS — one predicate, OR within a key, AND across keys, and both ends of the link agree.`)
