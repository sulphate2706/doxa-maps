#!/usr/bin/env node
/**
 * check-ported-globals-identical — a refactor that must change NOTHING it emits.
 *
 * Several shadow-root components carry their own copy of DX Life's base/_globals.scss rules, because
 * page CSS cannot reach into a shadow root. The copies were MEASURED as byte-identical where they
 * overlap (the Cyrillic stack 3x, strong{font-weight:500} 2x, scrollbar-gutter:stable 2x), so
 * extracting them into library/styles/portedGlobals.js is DEDUPLICATION, not a fix — and the proof
 * obligation is therefore unusual: the ported rules must be emitted IDENTICALLY before and after, or
 * the refactor is wrong. Only those rules are compared (see portedBlock); the rest of each stylesheet
 * belongs to its component and is free to change.
 *
 * ★ IT EXECUTES THE COMPONENT'S SETUP AND CAPTURES THE REAL ARGUMENT. It does NOT read source text.
 * The first version of this harness hashed the SOURCE of the useShadowStyles(...) call, and that was
 * a defect that made the gate useless for its one job: this refactor's whole purpose is to REPLACE a
 * string literal with a function call, so the source text changes by construction. A text-hash gate
 * fails on a perfect refactor and cannot tell that apart from a broken one — it measures the
 * ARTIFACT (how the CSS is spelled) when the property under test is the OUTPUT (what the browser
 * receives). It failed exactly that way on first run, on a refactor later proven correct.
 *
 * So: parse the SFC, stub every import, run the <script setup> body, and keep the first argument
 * handed to useShadowStyles. That string is what gets injected into the shadow root. Hash THAT.
 * No browser is launched and none is needed — the CSS is assembled in plain JS at setup time.
 *
 *     node internal/check-ported-globals-identical.mjs --write   (baseline)
 *     node internal/check-ported-globals-identical.mjs           (compare)
 *     node internal/check-ported-globals-identical.mjs --from <git-ref>
 *         evaluate the components AS OF a git ref instead of the working tree — which is how the
 *         pre-refactor baseline is recovered after the fact, without checking anything out.
 *
 * ⚠ WHITESPACE IS NORMALISED, declarations are NOT. A run of spaces or a newline between
 * declarations cannot change rendering, and the concatenation seams legitimately move when a literal
 * becomes a call. Selectors, properties, values and RULE GROUPING all survive normalisation — so
 * splitting one grouped rule into two separate rules is still reported as a change, which is correct:
 * it is the same CSS to a browser, but it is not the same stylesheet, and this gate's contract is
 * "unchanged", not "equivalent".
 *
 * Exit 0 pass · 1 fail · 75 NOT MEASURED (a component could not be evaluated — never reported as a
 * pass, because an unevaluated component proves nothing at all).
 */
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parse } from '@vue/compiler-sfc'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const BASELINE = join(HERE, 'fixtures', 'ported-globals-baseline.json')

// The files under refactor. regions-dashboard's two are listed as OWNED ELSEWHERE: the harness
// records them too, so regions can migrate against the same baseline rather than inventing one.
// ★ `owned:false` means RECORDED, NOT GATED. regions-dashboard's two files port the same globals and
// belong to another agent; capturing their hashes lets them migrate against this same baseline
// instead of inventing one. But they must not be able to FAIL my run — a gate that goes red on a
// file its owner is mid-edit trains everyone to ignore it. They are reported, never enforced.
// Both currently evaluate only partially (they read props and coerce objects at setup time, which
// the stubs do not model); that is a gap in the harness, NOT evidence about their CSS, and it is
// reported as NOT MEASURED rather than quietly skipped.
const FILES = [
  { path: 'library/components/regions/GoalCard.vue', owned: true },
  { path: 'library/components/regions/RegionSectionCard.vue', owned: true },
  { path: 'plugin-designs/regions-dashboard/region-dashboards.vue', owned: true },
  { path: 'plugin-designs/regions-dashboard/regions-list.vue', owned: true },
]
const OWNED = new Set(FILES.filter((f) => f.owned).map((f) => f.path))

const args = process.argv.slice(2)
const fromRef = (() => {
  const i = args.indexOf('--from')
  return i >= 0 ? args[i + 1] : null
})()

/** Read a file from the working tree, or from a git ref when --from is given. */
function readSource(rel) {
  if (!fromRef) {
    const p = join(REPO, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  try {
    return execFileSync('git', ['show', `${fromRef}:${rel}`], { cwd: REPO, encoding: 'utf8' })
  } catch {
    return null
  }
}

// ★ ONLY THE PORTED BLOCK IS HASHED (2026-09-29). The contract is that the PORTED rules reach the browser
// unchanged. The gate used to hash each component's WHOLE stylesheet, so unrelated CSS work in these files
// (regions adding position:relative to a :host rule) failed it and could pass only by re-baselining someone
// else's guard. The hash now covers exactly what library/styles/portedGlobals.js emits, found in the EXECUTED
// CSS: every cyrillicHeading rule and every strongMedium rule WITH the selectors in front of it (GoalCard
// scopes strong to '.rd-goal '), and every scrollbar-gutter declaration with the selector of the rule holding
// it. A changed, dropped or re-targeted ported rule still fails; nothing else in the stylesheet can. A file
// whose block comes out EMPTY fails (its ported rules were dropped), and --write refuses to baseline one:
// a hash of nothing guards nothing.
const PORTED = await import('../library/styles/portedGlobals.js')
const norm = (x) => String(x).replace(/\s+/g, ' ').trim()
function portedBlock(css) {
  const frags = []
  const cy = norm(PORTED.cyrillicHeading('.x')); const cyBody = cy.slice(cy.indexOf('{'))
  const strong = norm(PORTED.strongMedium()); const gutter = norm(PORTED.scrollbarGutter())
  const selectorOf = (open) => css.slice(css.lastIndexOf('}', open) + 1, open).trim()
  for (let i = css.indexOf(cyBody); i >= 0; i = css.indexOf(cyBody, i + 1)) frags.push(`cyrillic ${selectorOf(i)}${cyBody}`)
  for (let i = css.indexOf(strong); i >= 0; i = css.indexOf(strong, i + 1)) frags.push(`strong ${selectorOf(i)} ${strong}`)
  for (let i = css.indexOf(gutter); i >= 0; i = css.indexOf(gutter, i + 1)) frags.push(`gutter ${selectorOf(css.lastIndexOf('{', i))} { ${gutter} }`)
  return frags
}

/**
 * Execute a component's <script setup> far enough to capture its useShadowStyles argument.
 *
 * Every import is stubbed with a Proxy that returns a callable no-op for any name, EXCEPT
 * useShadowStyles (captured) and portedGlobals (loaded for real — its output is the thing under
 * test). Vue's own reactivity/lifecycle functions are stubbed too: nothing mounts, so onMounted
 * never fires and no DOM is touched.
 *
 * @returns {{css: string}|{error: string}}
 */
async function emittedCss(src, rel) {
  const { descriptor, errors } = parse(src, { filename: rel })
  if (errors.length) return { error: `SFC parse: ${errors[0].message}` }
  const block = descriptor.scriptSetup || descriptor.script
  if (!block) return { error: 'no <script> block' }

  let captured = null
  const globals = await import('../library/styles/portedGlobals.js').catch(() => null)

  // A stub that tolerates any shape a component might use it in: called, constructed, or
  // property-accessed. defineProps/defineEmits are compiler macros, so they must return something
  // indexable rather than undefined.
  // ★ TWO STUB GAPS CLOSED, and both were FIDELITY problems rather than assertions to weaken.
  // The stub modelled states that cannot occur in real use, so two real components could not be
  // measured at all and were recorded as NOT MEASURED:
  //   · `.value` was undefined. A component reading an INJECTED ref — cfg.value.regionSlug on
  //     region-dashboards.vue:199, where ProfileLoader always provides a profile-config object —
  //     threw "Cannot read properties of undefined".
  //   · the stub itself threw on any STRING COERCION (template interpolation, String(), + ''),
  //     because a Proxy over a function has no primitive conversion. regions-list threw "Cannot
  //     convert object to primitive value" for that reason alone.
  // `.value` is now the EMPTY STRING, which is the one shape that serves both real cases honestly:
  // a locale ref's .value IS a string, so `${locale.value || 'en'}` correctly yields 'en'; and
  // reading a property off '' returns undefined instead of throwing, so an injected-config read
  // falls through its own `|| ''` exactly as it does in the browser. Symbol.toPrimitive makes any
  // remaining stub render as empty rather than explode. Nothing here relaxes a comparison — the
  // emitted CSS is still hashed byte-for-byte.
  const anyFn = () => new Proxy(function () {}, {
    get: (t, k) => {
      if (k === 'value') return ''
      if (k === Symbol.toPrimitive) return () => ''
      return anyFn()
    },
    apply: () => anyFn(),
  })
  const stubModule = (spec) => new Proxy({}, {
    get(_t, name) {
      if (name === 'useShadowStyles') return (css) => { captured = css }
      if (globals && name in globals) return globals[name]
      return anyFn()
    },
  })

  // Rewrite `import ... from 'x'` into a binding off a stub, and drop the macros the SFC compiler
  // would normally handle. Everything else runs as written — including the string concatenation and
  // the portedGlobals calls, which is the entire point.
  let code = block.content
    .replace(/^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (m, clause, spec) => {
      const ns = clause.match(/^\*\s+as\s+(\w+)$/)
      if (ns) return `const ${ns[1]} = __stub(${JSON.stringify(spec)});`
      const named = clause.match(/\{([\s\S]*)\}/)
      const def = clause.replace(/\{[\s\S]*\}/, '').replace(/,\s*$/, '').trim()
      let out = ''
      if (def) out += `const ${def} = __stub(${JSON.stringify(spec)});`
      if (named) {
        // ⚠ `import { A as B }` is NOT destructuring syntax — the rename operator there is `:`.
        // Rewriting the clause verbatim produced a SyntaxError on the first real file that used it.
        const bindings = named[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2'))
          .join(', ')
        out += `const {${bindings}} = __stub(${JSON.stringify(spec)});`
      }
      return out || `__stub(${JSON.stringify(spec)});`
    })
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')

  const fn = new Function('__stub', '__macros', `
    const { defineProps, defineEmits, defineExpose, defineOptions, withDefaults } = __macros;
    ${code}
  `)
  try {
    fn(stubModule, {
      defineProps: anyFn(), defineEmits: anyFn(), defineExpose: anyFn(),
      defineOptions: anyFn(), withDefaults: anyFn(),
    })
  } catch (e) {
    return { error: `setup threw: ${e.message}` }
  }
  if (typeof captured !== 'string') return { error: 'useShadowStyles was never called with a string' }
  return { css: captured.replace(/\s+/g, ' ').trim() }
}

const now = {}
const blocks = {}
const unmeasured = []       // owned files that failed to evaluate — these BLOCK
const unmeasuredOther = []  // recorded-only files — these are reported, never blocking
for (const { path: f } of FILES) {
  const src = readSource(f)
  if (src === null) { now[f] = null; continue }
  const r = await emittedCss(src, f)
  if (r.error) {
    ;(OWNED.has(f) ? unmeasured : unmeasuredOther).push(`${f}: ${r.error}`)
    continue
  }
  blocks[f] = portedBlock(r.css)
  now[f] = blocks[f].length ? createHash('sha256').update(blocks[f].join('\n')).digest('hex').slice(0, 16) : '(no ported rule)'
}

if (args.includes('--write')) {
  if (unmeasured.length) {
    console.error('PORTED-GLOBALS: refusing to write a baseline with unevaluated components:')
    for (const u of unmeasured) console.error(`  ! ${u}`)
    process.exit(75)
  }
  const empty = FILES.filter((x) => x.owned && blocks[x.path] && !blocks[x.path].length).map((x) => x.path)
  if (empty.length) {
    console.error('PORTED-GLOBALS: refusing to write a baseline — these files emit no ported rule, so a hash would guard nothing:')
    for (const e of empty) console.error(`  ! ${e}`)
    process.exit(1)
  }
  writeFileSync(BASELINE, JSON.stringify({
    _why: 'Hashes of the PORTED BLOCK of each component\'s emitted CSS (captured by EXECUTING its setup): every rule or declaration library/styles/portedGlobals.js emits, with its selectors. Unrelated CSS in these files does not move them; a changed, dropped or re-targeted ported rule does.',
    _source: fromRef ? `git ref ${fromRef}` : 'working tree',
    hashes: now,
  }, null, 2) + '\n')
  console.log(`PORTED-GLOBALS: baseline written (${fromRef ? 'from ' + fromRef : 'working tree'})`)
  for (const { path: f, owned } of FILES) {
    if (now[f] === undefined) continue
    console.log(`  ${now[f] || '(absent)'}  ${f}${blocks[f] ? `  (${blocks[f].length} ported rule(s))` : ''}${owned ? '' : '   [recorded only — regions owns it]'}`)
  }
  for (const u of unmeasuredOther) console.log(`  (not measured)      ${u}`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.log('PORTED-GLOBALS: SKIP — no baseline; run with --write before refactoring')
  process.exit(0)
}

// ⚠ NOT MEASURED is not a pass. A component that failed to evaluate carries no evidence either way,
// and reporting it green is how a gate ends up certifying a file it never read.
if (unmeasured.length) {
  console.error('PORTED-GLOBALS: NOT MEASURED (exit 75) — these components could not be evaluated, so')
  console.error('  this run says NOTHING about whether the CSS changed. Not a pass, not a fail.')
  for (const u of unmeasured) console.error(`  ! ${u}`)
  process.exit(75)
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8')).hashes
const fails = []
let compared = 0
for (const { path: f } of FILES) {
  if (base[f] === undefined || base[f] === null) continue
  if (now[f] === undefined) continue  // recorded-only and unevaluated — reported above, not enforced
  compared++
  if (base[f] !== now[f]) {
    fails.push(`${f}\n      before: ${base[f]}\n      after:  ${now[f]}\n      the PORTED BLOCK changed: a portedGlobals.js rule was edited, dropped, added or re-targeted\n      (the rest of the stylesheet is not compared). What this run found:\n${blocks[f].map((b) => `        ${b}`).join('\n') || '        (nothing — every ported rule is gone)'}`)
  }
}
if (fails.length) {
  console.error('PORTED-GLOBALS: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
for (const u of unmeasuredOther) console.log(`PORTED-GLOBALS: note — not measured (recorded only, not gated): ${u}`)
console.log(`PORTED-GLOBALS: PASS — the ported block of ${compared} component(s) is identical to the baseline (only portedGlobals.js output is compared; the rest of each stylesheet is free to change).`)
