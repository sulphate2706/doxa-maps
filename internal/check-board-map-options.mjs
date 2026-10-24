#!/usr/bin/env node
/**
 * check-board-map-options.mjs — the GEOGRAPHIC caller must state its map options, never inherit them.
 *
 * WHY THIS EXISTS. gospel-internet had its own copy of the map helper (src/boardEngine.js) whose
 * defaults were whiteboard:false / boundaries:true / centre [60,20] / zoom 1.4 — the values a real map
 * needs. The library's createWhiteboardMap was extracted for the WHITEBOARD case, so its defaults are
 * the exact inverse: whiteboard:true / boundaries:false / [0,0] / zoom 1. Adopting the library while
 * GiMap still relied on defaults would have hidden every basemap layer and dropped boundary
 * attribution — a blank map in production, from a change that reads like a pure de-duplication.
 *
 * ★ WHY A NEW GATE RATHER THAN check:gospel-whiteboard. I poisoned GiMap into whiteboard mode and
 * check:gospel-whiteboard still exited 0. It asserts chart GEOMETRY (projection, radii, the bounded
 * gap) and never imports a component, so it cannot see a call-site option. A pass from a check that
 * cannot fail is not evidence, so this asserts the thing that actually regresses.
 *
 * The rule: every createWhiteboardMap call must pass `whiteboard` EXPLICITLY. A whiteboard caller
 * passing true is inheriting nothing; the geographic caller passing false is stating its intent. Either
 * way the call reads the same against either module, which is what makes the de-duplication safe.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'plugin-designs/gospel-internet/src/components'
const CALL = /createWhiteboardMap\s*\(/g

const pass = []
const fail = []
const ok = (label, cond, detail = '') => (cond ? pass : fail).push(detail ? `${label} — ${detail}` : label)

/** The option object of a call, by brace matching from the call's opening paren. */
function callOptions(src, at) {
  let depth = 0
  let i = src.indexOf('(', at)
  const start = i
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) break }
  }
  return src.slice(start, i + 1)
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.vue'))
let calls = 0
for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8')
  for (const m of src.matchAll(CALL)) {
    calls++
    const args = callOptions(src, m.index)
    // `whiteboard:` must appear in the call itself, not be left to the module's default.
    ok(`${f}: createWhiteboardMap states whiteboard: explicitly`, /\bwhiteboard\s*:/.test(args),
      args.replace(/\s+/g, ' ').slice(0, 90))
    // A geographic caller (whiteboard:false) must also state boundaries, or it silently loses
    // boundary attribution to the library default of false.
    if (/\bwhiteboard\s*:\s*false/.test(args)) {
      ok(`${f}: the geographic caller states boundaries: explicitly`, /\bboundaries\s*:/.test(args))
    }
  }
}

ok('every call site was found and checked', calls >= 4, `${calls} call(s) across ${files.length} components`)

// NEG CONTROL: the matcher must actually be able to SEE a missing option, or every arm above is
// vacuous. Run it over a call that omits whiteboard and require it to be judged non-compliant.
const bad = "await createWhiteboardMap(el.value, cfg, { token: tk })"
ok('NEG CONTROL: a call omitting whiteboard: is detected',
  !/\bwhiteboard\s*:/.test(callOptions(bad, bad.indexOf('createWhiteboardMap'))))
// And a compliant call must NOT trip it, or the gate would just ban the helper.
const good = "await createWhiteboardMap(el.value, cfg, { whiteboard: false, boundaries: true, token: tk })"
ok('NEG CONTROL: a compliant call passes',
  /\bwhiteboard\s*:/.test(callOptions(good, good.indexOf('createWhiteboardMap'))))

for (const p of pass) console.log(`  ✓ ${p}`)
for (const f of fail) console.log(`  ✗ ${f}`)
if (fail.length) {
  console.log(`\nBOARD-MAP-OPTIONS: FAIL — ${fail.length} of ${pass.length + fail.length}`)
  process.exit(1)
}
console.log(`\nBOARD-MAP-OPTIONS: PASS — ${pass.length} assertions over ${calls} call sites`)
