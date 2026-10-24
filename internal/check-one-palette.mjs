#!/usr/bin/env node
/**
 * check-one-palette.mjs — map, legend and charts must colour the same value the same way.
 *
 * THE DEFECT THIS PROTECTS AGAINST. `useDashboardAggregations.js` used to declare two PRIVATE
 * palettes the map had never seen, and picked chart colours with:
 *
 *     colorFor(key, i) => REGION_COLORS[key] || CATEGORICAL[i % CATEGORICAL.length]
 *
 * Two failures came out of that, and the second is a correctness bug rather than a taste one:
 *   1. near-misses — 'Africa' was #e74c3c in a chart and #ff2e2e on the map; Latin America was
 *      orange in one and yellow in the other. A near-miss reads as a rendering artefact, which is
 *      worse than an obvious mismatch because nobody files it;
 *   2. religion coloured BY ARRAY INDEX. No religion key existed in the private table, so every
 *      religion fell through to CATEGORICAL[i] — its position in a list sorted BY COUNT. Counts
 *      move when you cross-filter, so a religion CHANGED COLOUR AS YOU FILTERED. Measured: Islam
 *      and Hinduism swapped, Buddhism and Christianity swapped. Colour carrying no meaning.
 *
 * That was fixed by deleting both private palettes and reading every hex from the same colour
 * strategy modules the map paints with (`library/colors/`, auto-discovered by `_registry.js`).
 *
 * ★ SO WHY A GATE, IF IT IS ALREADY FIXED. Because the fix is a DELETION plus a convention, and
 * nothing enforces a convention. The next person adding a facet writes a lookup table because it is
 * the obvious thing to do, and the divergence returns silently — no error, no crash, just two
 * surfaces disagreeing about what blue means. The failure mode of this bug class is that it looks
 * fine.
 *
 * ★ WHY IT READS THE BUILT BUNDLES AND NOT THE SOURCE. `library/colors/_registry.js` discovers
 * strategies with `import.meta.glob`, a VITE BUILD-TIME feature — plain `node` cannot import it (it
 * throws "(intermediate value).glob is not a function"; see the gate-authoring section in
 * documentation/reference.md). So this gate parses the palettes out of the SOURCE modules as the
 * expected set, then asserts those exact hexes survived into the SHIPPED bundles. That also makes
 * it a test of the glob resolution itself: if the registry ever silently discovers nothing, the
 * bundles lose the palette and this fails, where a source-only check would still pass.
 *
 * WHAT IT ASSERTS:
 *   1. every strategy module's palette hexes appear in the built bundle of each consumer, so map,
 *      legend and chart are all drawing from the same set;
 *   2. the consumers declare NO private palette of their own — a literal hex table inside a
 *      dashboard composable is the exact shape that caused this;
 *   3. no consumer colours a categorical value by ARRAY INDEX (`[i % …]`, `[idx % …]`), the defect
 *      that made a religion change colour under cross-filtering.
 *
 * PRECONDITION: a built tree. Skips loudly (not silently) when `public/doxa-maps` is absent, the way
 * CI sees it — a gate that passes when it did not run is the failure mode this repo keeps hitting.
 *
 * NEGATIVE-TESTED: reintroducing a private `const CATEGORICAL = ['#...']` into the aggregations
 * composable fails assertion 2 by name; an `[i % CATEGORICAL.length]` lookup fails assertion 3.
 */
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COLORS = join(ROOT, 'library/colors')
const BUILT = join(ROOT, `public/${TREE_NAME}`)

if (!existsSync(BUILT)) {
  console.error(`ONE-PALETTE: SKIP — no built tree at public/${TREE_NAME}. Run \`bun run build\` first.`)
  console.error('  Reported as a SKIP with a non-silent message rather than a pass: a gate that')
  console.error('  reports success when it never ran is worse than no gate.')
  process.exit(0)
}

/**
 * The hexes of the PALETTE export ONLY: from `export const PALETTE` to its matching closing brace, and
 * only inside string literals. It used to match every hex from the export to the END OF THE FILE,
 * comments included, so a later note such as "REJECTED #AF7AC5, scored 2.95, under the 3.0 floor"
 * (affinity-block.js) obliged every consumer to ship a colour rejected on WCAG grounds.
 * Returns null when the module has no PALETTE export.
 */
export function paletteHexes(src) {
  const at = src.indexOf('export const PALETTE')
  if (at < 0) return null
  const open = src.indexOf('{', at), openArr = src.indexOf('[', at)
  const start = [open, openArr].filter((i) => i >= 0).sort((a, b) => a - b)[0]
  if (start === undefined) return []
  const close = { '{': '}', '[': ']' }[src[start]]
  let depth = 0, i = start, quote = null
  const strings = []
  let cur = ''
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1]
    if (quote) {
      if (c === '\\') { cur += c + n; i++; continue }
      if (c === quote) { strings.push(cur); cur = ''; quote = null; continue }
      cur += c; continue
    }
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === src[start]) depth++
    else if (c === close && --depth === 0) break
  }
  return [...new Set(strings.flatMap((t) => [...t.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase())))]
}

/**
 * The strategy palettes in one colors folder: library/colors/, or a bundle's own
 * plugin-designs/<bundle>/src/colors/ (bundle-private strategies merge OVER the library set for that
 * bundle — see that folder's README). Filename → key as the registry names it is not needed here; the
 * file stem is the key both places use.
 */
export function collectStrategies(dir) {
  const out = {}
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js') || f.startsWith('_') || f.startsWith('.') || f === 'index.js') continue
    const hexes = paletteHexes(readFileSync(join(dir, f), 'utf8'))
    if (hexes && hexes.length) out[f.replace(/\.js$/, '')] = hexes
  }
  return out
}

if (process.argv.includes('--self-test')) {
  // A bundle's PRIVATE palette (src/colors/<mode>.js) must be seen, not only library/colors/ (the gate was
  // blind to it: upg100's census, BUG-CHECK-ONE-PALETTE-BLIND-TO-PRIVATE-PALETTES).
  const tmp = mkdtempSync(join(tmpdir(), 'one-palette-'))
  writeFileSync(join(tmp, 'religion.js'), "export const PALETTE = { islam: '#010203', hinduism: '#040506' }\n")
  writeFileSync(join(tmp, '_skip.js'), "export const PALETTE = { x: '#999999' }\n")
  const seen = JSON.stringify(collectStrategies(tmp))
  rmSync(tmp, { recursive: true, force: true })
  if (seen !== JSON.stringify({ religion: ['#010203', '#040506'] })) { console.error(`ONE-PALETTE: SELF-TEST FAIL — a planted private palette read as ${seen}`); process.exit(1) }
  const src = [
    "export const PALETTE = {",
    "  a: '#112233', // not #445566 (a comment inside the export)",
    "  /* nor #778899 */ b: \"#aabbcc\",",
    "}",
    "// REJECTED #af7ac5, scored 2.95, under the 3.0 floor",
    "export const OTHER = { c: '#ddeeff' }",
  ].join('\n')
  const got = paletteHexes(src).join(',')
  if (got !== '#112233,#aabbcc') { console.error(`ONE-PALETTE: SELF-TEST FAIL — read ${got}, want #112233,#aabbcc`); process.exit(1) }
  console.log('ONE-PALETTE: SELF-TEST PASS — only the PALETTE export\'s string values are read; comments and later code are not; a bundle\'s private src/colors/ palette is seen.')
  process.exit(0)
}

// ── the expected palettes, read from the strategy modules the MAP uses ────────────────────────
// The library set, and per bundle its own src/colors/ strategies merged over it (same key overrides).
const strategies = collectStrategies(COLORS)
const privateOf = (bundle) => collectStrategies(join(ROOT, 'plugin-designs', bundle, 'src', 'colors'))

// ── the consumers that must agree ─────────────────────────────────────────────────────────────
const CONSUMERS = [
  { name: 'research-dashboard', bundle: 'research-dashboard/research-dashboard.js' },
  { name: 'dashboard-plus-grid', bundle: 'dashboard-plus-grid/dashboard-plus-grid.js' },
]
const SOURCES = [
  'plugin-designs/research-dashboard/src/composables/useDashboardAggregations.js',
  // kit landing 4c-1 split the generic counting half out of the file above. Its palettes STAYED, so
  // this gate's subject did not move — but the new module is scanned too, so a private palette
  // added to kit code in future is caught on the same rule rather than escaping into the library.
  'library/composables/useFacetAggregation.js',
  'plugin-designs/research-dashboard/src/composables/useTreeLegendColors.js',
]

const errs = []

// 1 — the shipped bundles carry the strategy palettes
let checkedPairs = 0
for (const c of CONSUMERS) {
  const p = join(BUILT, c.bundle)
  if (!existsSync(p)) { errs.push(`bundle missing: ${c.bundle} — build is incomplete, so this gate cannot judge it.`); continue }
  const js = readFileSync(p, 'utf8').toLowerCase()
  for (const [strat, hexes] of Object.entries({ ...strategies, ...privateOf(c.name) })) {
    const missing = hexes.filter((h) => !js.includes(h))
    checkedPairs++
    // A consumer need not use EVERY strategy, but if it uses one at all it must use the whole
    // palette — a partial match is the near-miss case (some values shared, others re-invented).
    if (missing.length && missing.length !== hexes.length) {
      errs.push(
        `${c.name} carries only ${hexes.length - missing.length}/${hexes.length} of the "${strat}" palette.\n` +
        `      missing: ${missing.slice(0, 6).join(' ')}${missing.length > 6 ? ' …' : ''}\n` +
        '      A PARTIAL palette is the near-miss case: some values agree with the map and others\n' +
        '      were re-invented locally, which reads as a rendering artefact rather than a bug.'
      )
    }
  }
}

// 2 + 3 — the consumers declare no palette and key no colour by index
for (const rel of SOURCES) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) continue
  const src = readFileSync(p, 'utf8')
  // Strip comments first: this very defect is DESCRIBED at length in those files' headers, and a
  // naive scan matches the description and fails on the documentation of the fix. (Two gates this
  // week reported on their own prose; see check-no-orphan-gates.)
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const table = code.match(/const\s+[A-Z_]*(?:PALETTE|COLORS|CATEGORICAL)[A-Z_]*\s*=\s*[[{][^;]*#[0-9a-fA-F]{6}/)
  if (table) {
    errs.push(
      `${rel} declares a PRIVATE palette.\n` +
      `      ${table[0].replace(/\s+/g, ' ').slice(0, 84)}…\n` +
      '      Every hex must come from library/colors/ via the registry, so the map, the legend and\n' +
      '      the charts cannot drift apart. This is the exact shape that produced the original bug.'
    )
  }

  const byIndex = code.match(/\[\s*(?:i|idx|index)\s*%[^\]]*\]/)
  if (byIndex) {
    errs.push(
      `${rel} picks a colour by ARRAY INDEX: ${byIndex[0]}\n` +
      '      A categorical colour must be keyed by the VALUE. Index position depends on sort order,\n' +
      '      and these lists are sorted BY COUNT — so cross-filtering silently reassigns colours and\n' +
      '      the colour stops meaning anything.'
    )
  }
}

if (errs.length) {
  console.error('ONE-PALETTE: FAIL\n')
  errs.forEach((e) => console.error('  ' + e + '\n'))
  process.exit(1)
}

const names = Object.keys(strategies)
console.log(`ONE-PALETTE: PASS — ${names.length} strategy palette(s) (${names.join(', ')}) checked across`)
console.log(`  ${CONSUMERS.length} built bundle(s) and ${SOURCES.length} source consumer(s); ${checkedPairs} bundle/palette pair(s).`)
console.log('  No private palettes, no index-keyed colours. Read from the BUILT bundles on purpose:')
console.log('  the registry uses import.meta.glob, so this also proves the glob actually resolved —')
console.log('  a source-only check would still pass if the registry silently discovered nothing.')
