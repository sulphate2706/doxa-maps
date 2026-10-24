#!/usr/bin/env node
/**
 * check-grid-merge-defaults — the people-group grid's merge props must DEFAULT to today's grid.
 *
 * ★ WHY THIS EXISTS, in sr's words: "every default reproduces today's grid exactly" is the whole
 * safety argument for merging three consumers onto one component, and it is exactly the kind of
 * claim that is true when written and false three props later. The grid ships in Big Picture,
 * Simple Research and the studio preview; a default that drifts moves all three at once, silently,
 * because nothing in those hosts passes the prop that changed.
 *
 * Parser-based, not grep: a regex cannot tokenise JavaScript, and a default is an AST node.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const GRID = join(dirname(fileURLToPath(import.meta.url)), '..',
  'plugin-designs', 'people-groups-grid', 'people-groups-grid.vue')
let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

const { parse: parseSfc } = await import('@vue/compiler-sfc')
const { parse: parseJs } = await import('@babel/parser')
const sfc = parseSfc(readFileSync(GRID, 'utf8'))
const ast = parseJs((sfc.descriptor.scriptSetup || sfc.descriptor.script).content, { sourceType: 'module' })

const defaults = new Map()
const walk = (n) => {
  if (!n || typeof n !== 'object') return
  if (n.type === 'CallExpression' && n.callee?.name === 'defineProps' && n.arguments[0]?.type === 'ObjectExpression') {
    for (const pr of n.arguments[0].properties) {
      const key = pr.key?.name || pr.key?.value
      const def = pr.value?.properties?.find((q) => (q.key?.name || q.key?.value) === 'default')
      defaults.set(key, def ? def.value : undefined)
    }
  }
  for (const k of Object.keys(n)) {
    const v = n[k]
    if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v)
  }
}
walk(ast.program)
const lit = (name) => { const n = defaults.get(name); return n && 'value' in n ? n.value : undefined }

ok(defaults.size > 0, `the grid declares ${defaults.size} props (the reader is not vacuous)`)

// ── the merge props, each defaulting to what the grid did BEFORE the merge ──────────────────────
ok(defaults.has('filtersToggle') && lit('filtersToggle') === 'button',
  "filtersToggle defaults to 'button' — the bordered pill with its count badge, which is what the three shipping hosts render today")
ok(defaults.has('backdrop') && lit('backdrop') === 'filters',
  "backdrop defaults to 'filters' — the watermark stays scoped to the filters block, as today")
ok(defaults.has('backdropFloor') && lit('backdropFloor') === '',
  'backdropFloor defaults to EMPTY, so no min-height is imposed: a floor is a LAYOUT change and must be asked for by name, never arrive inside a styling one (sr)')

// ★ THE FLOOR MUST NOT BE HARDCODED ANYWHERE IN THE BACKDROP. This is the defect sr caught: the
// regions treatment carries min-height:400px, and shipping it as part of 'root' would make an
// empty or heavily-filtered grid 400px tall with a world map behind it, inside a scroll stack.
const src = readFileSync(GRID, 'utf8')
ok(!/minHeight:\s*'400px'/.test(src),
  'the 400px floor is not hardcoded into the root backdrop')

// NEG CONTROL: the reader really does see defaults, so the arms above can fail.
ok(lit('profileConfig') === '', "NEG CONTROL: a known existing default still reads correctly (profileConfig '')")

console.log(fails ? `\nGRID-MERGE-DEFAULTS: ${fails} FAIL(s)` : '\nGRID-MERGE-DEFAULTS: every merge prop defaults to the pre-merge grid')
process.exit(fails ? 1 : 0)
