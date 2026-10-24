#!/usr/bin/env node
// check-label-key-coverage — an English-to-key lookup table must cover every label its companion
// table can produce.
//
// ★ WHAT THIS CAUGHT. poster-wall.vue translates its section headings by LOOKING THE KEY UP BY THE
// ENGLISH:
//     const REGION_OF  = { 'brazil': 'Americas', 'europe': 'Europe', ... }   // id   -> English
//     const REGION_KEY = { 'Middle East': 'region_middle_east', ... }        // English -> key
//     const regionLabel = (english) => { const key = REGION_KEY[english]
//                                        return key ? t(`poster.${key}`) : english }
// REGION_KEY had no entry for 'Americas' or 'Europe', and the fall-through arm returns the RAW
// ENGLISH. Both were reachable — four zone ids map to them — so two headings on the poster wall
// printed in English in all eleven locales. (upg100 found and fixed this in their own plugin; the
// gate exists so the next table cannot repeat it.)
//
// ⚠ WHY THE HARDCODED-ENGLISH GATE CANNOT SEE THIS. There it is one string that is a LOOKUP INDEX,
// not a rendered label, and the key is COMPUTED — `t('poster.' + key)` — so a scan that reads keys
// written literally at the call site finds nothing to check. Resolving arbitrary key expressions is
// a static-analysis problem. This gate does the one decidable part instead: two object literals in
// one file, where the values of the first are the keys of the second, and coverage is a set
// difference. Narrow on purpose.
//
// ⚠ THE VALUES, NOT THE KEYS, ARE WHAT MUST BE COVERED. Reading REGION_OF's keys (the zone ids)
// against REGION_KEY finds nothing wrong and feels like a check. The ids are never translated; it is
// the English on the right-hand side that reaches a reader.
//
// ⚠ AND A LITERAL ARGUMENT COUNTS AS PRODUCED. Three of poster-wall's nine headings never appear in
// REGION_OF at all — they are passed straight in, `regionLabel('China + Mongolia')`. A gate that
// reads only the table misses a third of the surface, and 'Other' is exactly the kind of catch-all
// that gets added last and keyed never.
//
// Reads real source. Headless, no browser, no network. Exit 0 pass · 1 fail.
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const fails = []
const ok = (cond, msg) => { if (!cond) fails.push(msg) }

// ── the tables this gate knows about ───────────────────────────────────────────────────────────
// Declared rather than discovered: a heuristic that hunted for "any two objects that look related"
// would be guessing about code it has never seen, and a wrong guess here reports a defect that is
// not there. Each entry names the file, the table that PRODUCES labels, the table that maps a label
// to a key, the helper that reads them, and the area those keys live in.
// `mapsFile` names the file the key table lives in when it is not `file` (the wall and the legend share
// one REGION_KEY in legend-tree.js). `producerFn` names a function whose ternary arms return labels
// directly (legend-tree's regionFor returns 'India' / 'China + Mongolia' / 'Other' without a helper call).
const TABLES = [
  {
    file: 'plugin-designs/my-upg-100-list/poster-wall.vue',
    produces: 'REGION_OF',
    mapsFile: 'plugin-designs/my-upg-100-list/data/legend-tree.js',
    maps: 'REGION_KEY',
    via: 'regionLabel',
    area: 'poster',
  },
  {
    // the legend's region rows: the same REGION_KEY, through buildLegendNodes' opts.regionTitle
    file: 'plugin-designs/my-upg-100-list/data/legend-tree.js',
    produces: 'REGION_OF',
    maps: 'REGION_KEY',
    via: 'regionTitleOf',
    producerFn: 'regionFor',
    area: 'poster',
  },
]

/** The body of `const NAME = { ... }`, to its MATCHING closing brace. Brace-balanced rather than "the first
 *  `}` at column 0": a table declared inside a function (legend-tree's REGION_OF) is indented, and a
 *  column-0 match would run on to the end of the function and read every later `: '…'` as a label. */
function objectBody(src, name) {
  const m = new RegExp(`const ${name}\\s*=\\s*\\{`).exec(src)
  if (!m) return null
  let depth = 1
  const start = m.index + m[0].length
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i)
  }
  return null
}
/** The labels a producer function returns from its ternary arms: `? 'India'` / `: 'Other'`. */
function producerLabels(src, fn) {
  const m = new RegExp(`const ${fn}\\s*=\\s*\\([^)]*\\)\\s*=>([\\s\\S]*?);\\n`).exec(src)
  return m ? [...m[1].matchAll(/[?:]\s*'([^']+)'/g)].map((x) => x[1]) : null
}
/** Quoted values on the right of a colon — the English labels a table produces. */
const valuesOf = (body) => new Set([...body.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]))
/** Quoted keys on the left of a colon — the English labels a table covers. */
const keysOf = (body) => new Set([...body.matchAll(/'([^']+)'\s*:/g)].map((m) => m[1]))

for (const t of TABLES) {
  if (!existsSync(resolve(ROOT, t.file))) {
    ok(false, `${t.file} is missing — a table this gate watches moved or was renamed`)
    continue
  }
  const src = read(t.file)
  if (t.mapsFile && !existsSync(resolve(ROOT, t.mapsFile))) {
    ok(false, `${t.mapsFile} is missing — the key table this gate watches moved or was renamed`)
    continue
  }
  const produces = objectBody(src, t.produces)
  const maps = objectBody(t.mapsFile ? read(t.mapsFile) : src, t.maps)
  // ★ A MISSING TABLE IS A BLIND GATE, NOT A PASS. If either object is renamed away, every set below
  // is empty and the coverage check passes while measuring nothing — the failure mode a gate must
  // never have. So absence is the loud case.
  if (!produces) { ok(false, `${t.file}: no \`const ${t.produces} = {\` — this gate has gone blind`); continue }
  if (!maps) { ok(false, `${t.file}: no \`const ${t.maps} = {\` — this gate has gone blind`); continue }

  const fromTable = valuesOf(produces)
  const fromCalls = new Set([...src.matchAll(new RegExp(`${t.via}\\('([^']+)'\\)`, 'g'))].map((m) => m[1]))
  let fromFn = []
  if (t.producerFn) {
    const got = producerLabels(src, t.producerFn)
    // the same blind-gate rule as the tables: a renamed producer must fail, not contribute nothing
    if (!got || !got.length) { ok(false, `${t.file}: no \`const ${t.producerFn} = (…) =>\` returning labels — this gate has gone blind`); continue }
    fromFn = got
  }
  const produced = new Set([...fromTable, ...fromCalls, ...fromFn])
  const covered = keysOf(maps)

  ok(produced.size > 0, `${t.file}: ${t.produces} yielded no labels at all — the shape it is parsed with no longer matches`)
  ok(covered.size > 0, `${t.file}: ${t.maps} yielded no keys at all — the shape it is parsed with no longer matches`)

  const uncovered = [...produced].filter((label) => !covered.has(label)).sort()
  ok(uncovered.length === 0,
    `${t.file}: ${t.maps} has no entry for ${uncovered.map((s) => `'${s}'`).join(', ')} — `
    + `${t.via}() falls through to the raw English, so ${uncovered.length === 1 ? 'that heading prints' : 'those headings print'} `
    + `in English in every locale`)

  // Covering a label with a key that does not exist is the same defect one step later: the lookup
  // succeeds, t() gets a key the catalogue has never heard of, and what the reader sees is a raw
  // key or the English again depending on the fallback.
  const locales = 'library/i18n/locales'
  const localeDirs = existsSync(resolve(ROOT, locales))
    ? readdirSync(resolve(ROOT, locales), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : []
  for (const [label, key] of [...maps.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)].map((m) => [m[1], m[2]])) {
    const missing = localeDirs.filter((loc) => {
      const p = resolve(ROOT, locales, loc, `${t.area}.json`)
      if (!existsSync(p)) return true
      try { return JSON.parse(readFileSync(p, 'utf8'))[key] === undefined } catch { return true }
    })
    ok(missing.length === 0,
      `${t.file}: ${t.maps}['${label}'] points at ${t.area}.${key}, which is missing in ${missing.join(', ')}`)
  }
}

// ── SELF-TEST ──────────────────────────────────────────────────────────────────────────────────
// ★ THE CHECK MUST BITE. A coverage test built on two regexes passes loudly when either stops
// matching — it compares two empty sets and calls it agreement. So the parsing is exercised on
// planted source whose answer is known, including the shape that actually shipped.
{
  const t = []
  const probe = (src, via) => {
    const p = objectBody(src, 'OF'), m = objectBody(src, 'KEY')
    if (!p || !m) return null
    const produced = new Set([...valuesOf(p), ...[...src.matchAll(new RegExp(`${via}\\('([^']+)'\\)`, 'g'))].map((x) => x[1])])
    return [...produced].filter((l) => !keysOf(m).has(l)).sort()
  }
  const COVERED = `const OF = {\n  'a': 'Africa', 'b': 'Asia',\n}\nconst KEY = {\n  'Africa': 'k_africa',\n  'Asia': 'k_asia',\n}\nlabel('Africa')\n`
  const GAP = `const OF = {\n  'a': 'Africa', 'b': 'Americas',\n}\nconst KEY = {\n  'Africa': 'k_africa',\n}\n`
  const VIA_CALL = `const OF = {\n  'a': 'Africa',\n}\nconst KEY = {\n  'Africa': 'k_africa',\n}\nlabel('Other')\n`
  t.push([JSON.stringify(probe(COVERED, 'label')) === '[]', 'a fully covered table reports nothing'])
  t.push([JSON.stringify(probe(GAP, 'label')) === '["Americas"]', 'a value with no key is reported'])
  // the shape that shipped: the gap was reachable only through a literal argument, never the table
  t.push([JSON.stringify(probe(VIA_CALL, 'label')) === '["Other"]', 'a label passed as a literal argument is reported'])
  // and the blind-gate case: a renamed table must not read as agreement
  t.push([objectBody(`const OTHER = {\n 'a': 'b',\n}`, 'OF') === null, 'a renamed table is detected, not silently skipped'])
  // an INDENTED table inside a function ends at its own brace, not at the function's
  const NESTED = `function f() {\n  const OF = {\n    'a': 'Africa',\n  };\n  const x = { label: 'Not a region' };\n}\n`
  t.push([JSON.stringify([...valuesOf(objectBody(NESTED, 'OF'))]) === '["Africa"]', 'an indented table is read to its own closing brace'])
  // a producer's ternary arms are labels; its startsWith() arguments are not
  const FN = `const regionFor = (id) =>\n  OF[id] || (id.startsWith('asia-in-') ? 'India'\n  : 'Other');\n`
  t.push([JSON.stringify(producerLabels(FN, 'regionFor')) === '["India","Other"]', 'a producer function yields its returned labels only'])
  t.push([producerLabels(FN, 'renamedFor') === null, 'a renamed producer is detected, not silently skipped'])
  const bad = t.filter(([pass]) => !pass)
  for (const [, msg] of bad) fails.push(`SELF-TEST: ${msg}`)
}

if (fails.length) {
  console.error('LABEL-KEY-COVERAGE: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`LABEL-KEY-COVERAGE: PASS — ${TABLES.length} lookup table(s): every label the companion table can produce, `
  + 'including the ones passed as literal arguments, has a key, and every key exists in every locale.')
