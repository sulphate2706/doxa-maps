#!/usr/bin/env node
/**
 * check-selector-fields — every field a zone SELECTOR reads must be in every FETCH that evaluates it.
 *
 * THE DEFECT THIS CATCHES, measured 2026-09-28. The UPG-100 packet fetch requested
 * slug,name,country_code,population,religion,image_url while SIX of the 27 printable zones select on
 * wagf fields it never asked for (west-africa / east-africa / central-africa via wagf_block, europe via
 * wagf_region, southern-africa-islands and oceania-indonesia via unions of them). evaluate() matched
 * NOTHING, so those packets printed EMPTY — while the SAME selectors resolved correctly on the map,
 * whose fetch had carried both fields all along. One file, two fetches, two field sets, nothing
 * comparing them.
 *
 * ★ oceania-indonesia IS WHY THIS IS A GATE AND NOT A NOTE. Its union still matched country_code IDN,
 * so it did not print empty — it printed a PLAUSIBLE packet silently missing every Oceania group. An
 * empty packet is caught on page one; a packet quietly 40% short is not. Same asymmetry gospel measured
 * the same day joining admin-to-list.json: 514 of 1009 rows matched and THREE whole zones vanished while
 * every surviving zone still looked populated. A result that returns HALF looks like a smaller dataset.
 *
 * ★ FIELDS ARE READ FROM THE EVALUATOR, NOT FROM A TABLE IN THIS FILE. A hardcoded type→field map is a
 * second source of truth and drifts silently the day a case is edited. This parses selector-evaluator.js
 * and collects the `r.<field>` reads inside each `case '<type>':` block, so a new field in a case is
 * picked up without touching this gate. It is also how the non-obvious ones are caught: deaf_predicate
 * reads wagf_region AND slug AND name; affinity_bloc reads rop1. Neither is guessable from the name.
 *
 * ⚠ LIMIT, stated so a green run is not over-read: it matches `const fields = '…'` string literals. A
 * fetch that builds its field list dynamically is NOT checked, and is reported as UNCHECKED rather than
 * passed — absence of evidence is not evidence.
 *
 * --self-test plants a wagf_block selector against a fetch missing the field. Exit 0 clean · 1 findings.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── the evaluator's own field reads, per selector type ──────────────────────────────────────────
export function fieldsByType(evaluatorSrc) {
  const out = new Map()
  // Split on `case '<type>':` and read each block up to the next case.
  const re = /case\s+'([a-z_]+)'\s*:\s*\{/g
  const marks = []
  let m
  while ((m = re.exec(evaluatorSrc))) marks.push({ type: m[1], at: m.index })
  for (let i = 0; i < marks.length; i++) {
    const body = evaluatorSrc.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : evaluatorSrc.length)
    const fields = new Set()
    for (const f of body.matchAll(/\br\.([a-zA-Z_][\w]*)/g)) fields.add(f[1])
    out.set(marks[i].type, fields)
  }
  return out
}

/** Every field a selector tree needs, following union/nested selectors. */
export function fieldsForSelector(sel, byType, acc = new Set()) {
  if (!sel || typeof sel !== 'object') return acc
  const t = sel.type
  if (t && byType.has(t)) for (const f of byType.get(t)) acc.add(f)
  for (const child of sel.selectors || []) fieldsForSelector(child, byType, acc)
  return acc
}

/** `const fields = 'a,b,c'` / `const _fields = '…'` occurrences, with their line. */
export function fetchFieldLists(src) {
  const out = []
  for (const m of src.matchAll(/const\s+_?fields\s*=\s*'([^']*)'/g)) {
    out.push({ line: src.slice(0, m.index).split('\n').length, fields: new Set(m[1].split(',').map((s) => s.trim()).filter(Boolean)) })
  }
  // A dynamically-built list is reported, never silently passed. ⚠ The lookahead must reject a
  // literal that is merely INDENTED differently — an earlier version matched the same
  //  lines it had already parsed and reported them as dynamic, which would have
  // trained a reader to ignore the ⊘ marker. Anchor on the assignment actually not being a quote.
  for (const m of src.matchAll(/const\s+_?fields\s*=\s*([^'\s])/g)) {
    out.push({ line: src.slice(0, m.index).split('\n').length, dynamic: true })
  }
  return out
}

// ── SELF-TEST ───────────────────────────────────────────────────────────────────────────────────
const EVAL_FIXTURE = `
  switch (selector.type) {
    case 'country_code': { for (const r of rows) { if (r.country_code === want) {} } }
    case 'wagf_block':   { for (const r of rows) { if (r.wagf_block === want) {} } }
    case 'deaf_predicate': { for (const r of rows) { if (containsDeaf(r.slug) || containsDeaf(r.name)) { if (regions.has(r.wagf_region)) {} } } }
  }`
const CASES = [
  ['reads wagf_block from the evaluator', () => fieldsByType(EVAL_FIXTURE).get('wagf_block').has('wagf_block'), true],
  ['deaf_predicate reads 3 fields, not 1', () => fieldsByType(EVAL_FIXTURE).get('deaf_predicate').size, 3],
  ['union follows its children', () => {
    const t = fieldsByType(EVAL_FIXTURE)
    return [...fieldsForSelector({ type: 'union', selectors: [{ type: 'wagf_block' }, { type: 'country_code' }] }, t)].sort().join(',')
  }, 'country_code,wagf_block'],
  ['BAD  a fetch missing wagf_block is caught', () => {
    const t = fieldsByType(EVAL_FIXTURE)
    const need = fieldsForSelector({ type: 'wagf_block' }, t)
    const have = fetchFieldLists("const fields = 'slug,name,country_code';")[0].fields
    return [...need].filter((f) => !have.has(f)).join(',')
  }, 'wagf_block'],
  ['GOOD a fetch carrying it passes', () => {
    const t = fieldsByType(EVAL_FIXTURE)
    const need = fieldsForSelector({ type: 'wagf_block' }, t)
    const have = fetchFieldLists("const fields = 'slug,wagf_block';")[0].fields
    return [...need].filter((f) => !have.has(f)).length
  }, 0],
  ['a DYNAMIC field list is flagged, not passed', () => fetchFieldLists('const fields = buildFields();')[0].dynamic, true],
]

if (process.argv.includes('--self-test')) {
  let ok = 0
  for (const [name, run, want] of CASES) {
    let got
    try { got = run() } catch (e) { got = `ERR ${e.message}` }
    const pass = got === want
    console.log(`  ${pass ? '✓' : '✗'} ${name}  -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`)
    if (pass) ok++
  }
  console.log(ok === CASES.length
    ? `SELECTOR-FIELDS SELF-TEST: PASS — ${ok}/${CASES.length}`
    : `SELECTOR-FIELDS SELF-TEST: FAIL — ${ok}/${CASES.length}`)
  process.exit(ok === CASES.length ? 0 : 1)
}

// ── RUN ─────────────────────────────────────────────────────────────────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DESIGNS = join(ROOT, 'plugin-designs')
let bad = 0, unchecked = 0

for (const bundle of existsSync(DESIGNS) ? readdirSync(DESIGNS) : []) {
  const dir = join(DESIGNS, bundle)
  if (!statSync(dir).isDirectory()) continue
  const evalPath = join(dir, 'data/selector-evaluator.js')
  const clustersPath = join(dir, 'data/clusters.json')
  if (!existsSync(evalPath) || !existsSync(clustersPath)) continue

  const byType = fieldsByType(readFileSync(evalPath, 'utf8'))
  const c = JSON.parse(readFileSync(clustersPath, 'utf8'))
  const zones = ['lists', 'deaf_lists', 'asia_lists'].flatMap((k) => c[k] || [])

  const need = new Map()   // field -> the zones that need it
  for (const z of zones) for (const f of fieldsForSelector(z.selector, byType)) {
    if (!need.has(f)) need.set(f, [])
    need.get(f).push(z.id)
  }

  // Every .vue in the bundle that both fetches AND evaluates.
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.vue'))) {
    const src = readFileSync(join(dir, file), 'utf8')
    if (!/selector-evaluator|evaluate\(/.test(src)) continue
    for (const fetchDef of fetchFieldLists(src)) {
      const where = `${relative(ROOT, join(dir, file))}:${fetchDef.line}`
      if (fetchDef.dynamic) { console.log(`  ⊘ ${where}  field list is built dynamically — UNCHECKED, not passed`); unchecked++; continue }
      const missing = [...need.keys()].filter((f) => !fetchDef.fields.has(f))
      for (const f of missing) {
        console.log(`  ✗ ${where}  does not request '${f}', needed by: ${need.get(f).slice(0, 4).join(', ')}${need.get(f).length > 4 ? ` (+${need.get(f).length - 4})` : ''}`)
        bad++
      }
    }
  }
}

if (bad) {
  console.log(`SELECTOR-FIELDS: FAIL — ${bad} fetch/selector mismatch(es). A zone whose selector field is absent resolves to NOBODY, or worse, to HALF.`)
  process.exit(1)
}
console.log(`SELECTOR-FIELDS: PASS — every selector's fields are requested by every fetch that evaluates them${unchecked ? `, ${unchecked} dynamic list(s) unchecked` : ''}.`)
process.exit(0)
