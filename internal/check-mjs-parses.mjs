#!/usr/bin/env node
/**
 * check-mjs-parses.mjs — every build script must PARSE before the build runs it.
 *
 * THE DEFECT THIS CATCHES, hit twice within ten minutes on 2026-09-22 by two different agents:
 * a BACKTICK inside a `//` comment that sits INSIDE a template literal of generated browser JS.
 * The backtick closes the literal early and the parser then reads prose as code, failing hundreds
 * of lines away from the edit:
 *
 *     // ... so a bare `TREE + '/x'` is only accidentally right
 *     SyntaxError: Unexpected identifier 'TREE'        ← reported at :386, cause is the comment
 *
 * ★ WHY check:template-literal DOES NOT CATCH IT, and why that is not a bug in that gate. It scans
 * for backticks inside `/* … *\/` CSS comments — the shadow-CSS shape. A `//` comment inside a
 * generated-JS literal is a DIFFERENT GRAMMAR. Proven by controlled negative test: injecting
 * `// a bare \`TREE\` reference` into internal/generate-tree.mjs — a file that gate explicitly
 * lists — left it reporting PASS, while `node --check` failed immediately. The rule was right and
 * the implementation covered a narrower case than the rule stated.
 *
 * ★ WHY A PARSER AND NOT A WIDER REGEX. The CSS-comment scanner works because CSS comments have one
 * unambiguous form. JavaScript does not: a backtick can be legal inside a string, a regex, a nested
 * template, or a comment that is itself inside a template. Any pattern precise enough to catch the
 * bad case would false-positive on the legal ones — and a gate that cries wolf gets skipped, which
 * is worse than this gap. The parser already knows all of that, so ask it.
 *
 * WHAT IT ASSERTS: every internal/*.mjs parses as an ES module. Nothing more. It is deliberately
 * not a lint — it answers one question, the one that stops a build.
 *
 * WHY IT BELONGS EARLY. `bun run build` runs check:template-literal as step 1 precisely so a broken
 * literal fails in a second rather than after minutes of compilation. This closes the other half of
 * that promise for the 70 scripts the build itself is made of. It is fast (a parse, no execution)
 * and hermetic: no network, no browser, no built tree.
 *
 * ★ IT PARSES, IT DOES NOT IMPORT. Importing would EXECUTE module top-level code — these scripts
 * read files, spawn browsers and hit the network at import time. A syntax check must not have side
 * effects.
 *
 * NEGATIVE-TESTED: injecting a backtick into a `//` comment inside a literal in generate-tree.mjs
 * fails by name with the file and line, where check:template-literal reports PASS.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'internal')

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => !f.startsWith('_tmp-'))   // scratch probes are transient by construction
  .sort()

if (!files.length) {
  console.error('MJS-PARSE: FAIL — found 0 .mjs files under internal/.')
  console.error('  A gate with nothing to assert is not passing; it is not running.')
  process.exit(1)
}

// Under bun, process.execPath is bun, and `bun --check` RUNS the script instead of parsing it (a cloud
// build hung 18+ min inside check-link-rot-sample.mjs). Parse with a real node, or refuse to guess.
let NODE = process.execPath
if (process.versions.bun) {
  NODE = 'node'
  try { execFileSync(NODE, ['--version'], { stdio: 'pipe' }) } catch {
    console.error('MJS-PARSE: FAIL — running under bun and no `node` on PATH; this gate needs node --check (bun --check executes).')
    process.exit(1)
  }
}

const broken = []
for (const f of files) {
  const p = join(DIR, f)
  try {
    // `node --check` is the same parser the build uses, so a pass here means the build will at
    // least get past parsing. It does not execute the module.
    execFileSync(NODE, ['--check', p], { stdio: 'pipe' })
  } catch (e) {
    const out = String(e.stderr || e.stdout || e.message)
    // node --check prints: <path>\n<offending source line>\n<caret>\n\nSyntaxError: <msg>
    const msg = (out.match(/SyntaxError: .*/) || ['SyntaxError (message not captured)'])[0]
    const line = (out.match(/:(\d+)\n/) || out.match(/\((\d+):\d+\)/) || [])[1]
    broken.push({ f, msg: msg.slice(0, 120), line })
  }
}

if (broken.length) {
  console.error(`MJS-PARSE: FAIL — ${broken.length} of ${files.length} build script(s) do not parse.\n`)
  for (const b of broken) {
    console.error(`  internal/${b.f}${b.line ? ':' + b.line : ''}`)
    console.error(`      ${b.msg}`)
  }
  console.error('\n  ★ The usual cause is a BACKTICK inside a // comment that sits inside a template')
  console.error('  literal of generated code. The backtick closes the literal and the parser reads')
  console.error('  the prose as code, so the reported line is far from the real edit — look for a')
  console.error('  code term wrapped in backticks in a comment, not at the line named above.')
  console.error('  check:template-literal will NOT find it: that gate reads CSS comments, which is a')
  console.error('  different grammar. Both gates are needed.')
  console.error('\n  Find every instance in one pass rather than iterating — node --check reports')
  console.error('  only the FIRST, and each rebuild to surface the next costs minutes:')
  console.error("      grep -n '^\\s*//.*`' internal/<file>.mjs")
  process.exit(1)
}

console.log(`MJS-PARSE: PASS — ${files.length} build script(s) parse as ES modules.`)
console.log('  Parses only; never imports, because these scripts read files, spawn browsers and hit')
console.log('  the network at import time and a syntax check must have no side effects.')
console.log('  Complements check:template-literal rather than replacing it: that one reads CSS')
console.log('  comments in shadow-CSS literals, this one asks the parser about whole modules.')
