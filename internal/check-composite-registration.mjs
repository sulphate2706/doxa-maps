#!/usr/bin/env node
/**
 * check-composite-registration.mjs — a composite that bakes a leaf's .vue must register everything
 * that leaf's own entry file registers.
 *
 * THE DEFECT THIS CATCHES. In the cap-5 shell the Region donut, the country bars and the Place tree
 * rendered ENTIRELY GREY, while the identical build was correct standalone.
 *
 * The mechanism, which matters more than the symptom: a cap-4 composite imports the sibling
 * component directly —
 *     plugin-designs/dashboard-plus-grid/dashboard-plus-grid.vue:18
 *       import ResearchDashboard from '../research-dashboard/research-dashboard.vue'
 * — which takes the COMPONENT and skips `research-dashboard/index.js`, the file that actually
 * assembles the bundle (Pinia, i18n, colour strategies, customElements.define). The composite's own
 * index.js therefore RE-DECLARES all of that by hand: a manual copy of another file that nothing
 * keeps in sync. That is precisely how the strategies leg was lost — the file already documented
 * this bypass FOR i18n and fixed only that one leg.
 *
 * ★ WHY IT IS SILENT, and why a gate is the right answer. `getColorStrategy()` falls back to
 * language-family for an unregistered mode rather than throwing; research-dashboard/index.js says so
 * in its own comment: "the failure is silent … grey swatches, whereas a named import fails loudly at
 * build time." So a missing registration produces a PLAUSIBLE WRONG PICTURE — charts that look like
 * a data problem rather than a wiring problem. It was found by READING AN IMAGE; every number passed.
 *
 * WHAT IT ASSERTS. For each bundle whose root .vue imports a sibling bundle's .vue, every strategy
 * key registered in the SIBLING's index.js must also be registered in the COMPOSITE's index.js.
 *
 * A composite that registers nothing while its sibling registers nothing is fine, and so is a
 * composite whose sibling has no index.js. The rule is about DRIFT between two lists that are meant
 * to agree, not about any absolute requirement to register.
 *
 * ★ A FALSE POSITIVE THIS DELIBERATELY AVOIDS: big-picture also bakes a sibling .vue
 * (people-groups-grid) and registers ZERO strategies — and that is CORRECT, because neither file
 * references colorFor / getColorStrategy / mapbox. A first pass that flagged "bakes a sibling AND
 * registers nothing" called it a second instance of the bug; measuring actual usage showed it is
 * not one. Hence the comparison is sibling-list vs composite-list, never "must be non-empty".
 *
 * Parses both files as TEXT. Importing them would evaluate `import.meta.glob` (Vite-only) and throw
 * under plain node — see documentation/reference.md. Text parsing keeps this hermetic: no build, no
 * browser, no network.
 *
 * NEGATIVE-TESTED: deleting a key from the composite's registerStrategies fails by name.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DESIGNS = join(ROOT, 'plugin-designs')

// The keys inside `registerStrategies({ a: x, b: y })`. Comments are stripped first: these files
// discuss the registration at length, and a naive scan matches the prose describing the fix.
// ★ BRACE-MATCH, do not regex the argument. The real call is
//     registerStrategies({
//       './affinity-block.js': { default: affinityBlock },
//       './doxa-region.js':    { default: doxaRegion },
//     })
// — QUOTED keys with NESTED objects. A `\{([\s\S]*?)\}` stopped at the first inner `}` and a
// `[A-Za-z_$][\w$]*\s*:` key pattern never matched a quoted path, so the first version of this gate
// extracted NOTHING and cheerfully reported "no composite bakes a sibling that registers
// strategies" — while its own negative test also passed, because deleting a key from a set that was
// always empty changes nothing. A gate that cannot fail, caught only because the PASS text made a
// claim ("no pairs exist") that I knew to be false.
function strategyKeys(file) {
  if (!existsSync(file)) return null
  // ★ DO NOT PRE-STRIP COMMENTS HERE. A `/\/\*[\s\S]*?\*\//g` pass deleted 2,953 of 4,102
  // characters of research-dashboard/index.js — 72% of the file, INCLUDING the call this function
  // exists to find — because the file's prose contains sequences the non-greedy block pattern spans
  // across. The gate then reported "no composite bakes a sibling that registers strategies", which
  // is a confident claim about the whole repo derived from having parsed nothing.
  //
  // It is not needed anyway: we locate the CALL (`registerStrategies(`) and then brace-match its
  // argument, so a mention inside a comment only matters if it is written as an invocation. The
  // import line is excluded by requiring the `(`.
  //
  // ★ THE PROCESS LESSON, recorded because it cost four rounds: every earlier fix was verified
  // against dashboard-plus-grid/index.js, which survives stripping, and never against
  // research-dashboard/index.js, which does not. Both files are needed for a single comparison, and
  // testing the half that already worked proved nothing each time. When a gate compares A to B,
  // assert on A AND B before believing any fix.
  const src = readFileSync(file, 'utf8')
  // ★ FIND THE CALL, NOT THE IMPORT. The first textual occurrence of "registerStrategies" is the
  // import line — `import { registerStrategies } from '@map/colors/_registry.js'` — whose own brace
  // is the next `{`, so an indexOf-then-next-brace walk parses the IMPORT and returns its single
  // identifier. research-dashboard/index.js came back empty for exactly this reason while
  // dashboard-plus-grid/index.js parsed correctly, purely because its two lines sit differently.
  // Same code, two files, opposite answers — the tell that the match was positional luck.
  // Require a `(` after the name so only an invocation matches.
  const call = src.match(/registerStrategies\s*\(/)
  if (!call) return new Set()
  const at = call.index
  const open = src.indexOf('{', at)
  if (open < 0) return new Set()
  let depth = 0
  let end = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (!depth) { end = i; break } }
  }
  if (end < 0) return new Set()
  const body = src.slice(open + 1, end)
  // Only TOP-LEVEL keys: a nested `{ default: x }` must not contribute "default" as a strategy.
  const keys = new Set()
  let d = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') d++
    else if (body[i] === '}') d--
    else if (d === 0) {
      const rest = body.slice(i)
      const m = rest.match(/^(['"])([^'"]+)\1\s*:|^([A-Za-z_$][\w$]*)\s*:/)
      if (m) { keys.add(m[2] || m[3]); i += m[0].length - 1 }
    }
  }
  return keys
}

const bundles = readdirSync(DESIGNS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name)

/**
 * ★ THE SIDE EFFECTS A BAKED COMPOSITE MUST REPEAT, beyond the strategy keys.
 *
 * An entry file does five things. FOUR OF THEM FAIL SILENTLY if a composite forgets them, which is
 * why counting on "it renders" is no evidence the entry's work was done:
 *
 *   createPinia()            silent — state simply is not shared
 *   createAppI18n()          silent — an empty SyntaxError, and the subtree vanishes
 *   registerStrategies()     silent — getColorStrategy() FALLS BACK instead of throwing, so the
 *                                     charts paint grey and read as a data problem
 *   installRtlTextPlugin()   silent — Arabic/Hebrew/Persian labels render REVERSED. Measured: the
 *                                     composite shipped mapbox-gl-rtl-text 0 times while both leaf
 *                                     bundles shipped it once. Arab World (99 rows) and
 *                                     Persian-Median (49) are in scope, so that is a WRONG NAME.
 *   provide('profileModules') LOUD  — an explicit throw, and the ONLY one safe to omit, because a
 *                                     baked composite does not use ProfileLoader.vue at all.
 *
 * So `provide` is deliberately NOT in this list: requiring it would fail a composite that is
 * correct. The rule is "repeat what silently disappears", not "repeat everything".
 *
 * Matched as CALLS (name followed by `(`) so an import line does not count as a use — the same trap
 * that made the strategy parser read the import instead of the invocation.
 */
const SILENT_SIDE_EFFECTS = ['createPinia', 'createAppI18n', 'installRtlTextPlugin']

function calledEffects(file) {
  if (!existsSync(file)) return null
  const src = readFileSync(file, 'utf8')
  const out = new Set()
  for (const name of SILENT_SIDE_EFFECTS) {
    // Strip the import line for THIS name, then look for a real call.
    const withoutImport = src.replace(new RegExp(`^import[^\\n]*\\b${name}\\b[^\\n]*$`, 'gm'), '')
    if (new RegExp(`\\b${name}\\s*\\(`).test(withoutImport)) out.add(name)
  }
  return out
}

const errs = []
let comparisons = 0

for (const b of bundles) {
  const dir = join(DESIGNS, b)
  const vues = readdirSync(dir).filter((f) => f.endsWith('.vue'))
  if (!vues.length) continue

  // Which sibling bundles does this one bake directly?
  const siblings = new Set()
  for (const v of vues) {
    const src = readFileSync(join(dir, v), 'utf8')
    for (const m of src.matchAll(/from\s+'\.\.\/([\w-]+)\/[^']*\.vue'/g)) siblings.add(m[1])
  }
  if (!siblings.size) continue

  const mine = strategyKeys(join(dir, 'index.js'))
  if (mine === null) continue // no entry file of its own; nothing to compare

  const myEffects = calledEffects(join(dir, 'index.js')) || new Set()

  for (const s of siblings) {
    const theirs = strategyKeys(join(DESIGNS, s, 'index.js'))
    const theirEffects = calledEffects(join(DESIGNS, s, 'index.js')) || new Set()
    if (theirs === null) continue // sibling has no entry file; nothing to inherit

    // 1 — strategy keys
    if (theirs.size) {
      comparisons++
      const missing = [...theirs].filter((k) => !mine.has(k))
      if (missing.length) {
        errs.push(
          `${b} bakes ${s}/${s}.vue but does not register: ${missing.join(', ')}\n` +
          `      ${s}/index.js registers   [${[...theirs].join(', ')}]\n` +
          `      ${b}/index.js registers   [${[...mine].join(', ')} ]`
        )
      }
    }

    // 2 — the silent side effects. Same rule, wider surface: whatever the LEAF entry calls and
    // whose absence would not announce itself, the composite must call too.
    if (theirEffects.size) {
      comparisons++
      const missingFx = [...theirEffects].filter((k) => !myEffects.has(k))
      if (missingFx.length) {
        errs.push(
          `${b} bakes ${s}/${s}.vue but never calls: ${missingFx.map((f) => f + '()').join(', ')}\n` +
          `      ${s}/index.js calls   [${[...theirEffects].join(', ')}]\n` +
          `      ${b}/index.js calls   [${[...myEffects].join(', ')} ]\n` +
          '      Each of these fails SILENTLY when missing — no error, no warning, just a wrong\n' +
          '      picture. installRtlTextPlugin was absent exactly this way and reversed every\n' +
          '      Arabic, Hebrew and Persian label in the cap-5 shell.'
        )
      }
    }
  }
}

if (errs.length) {
  console.error(`COMPOSITE-REG: FAIL — ${errs.length} composite(s) drifted from the leaf they bake.\n`)
  errs.forEach((e) => console.error('  ' + e + '\n'))
  console.error('  Importing a sibling .vue takes the COMPONENT and skips that bundle\'s index.js,')
  console.error('  where the strategies are registered. The composite re-declares them by hand, so')
  console.error('  the two lists drift and nothing says so — getColorStrategy() falls back to')
  console.error('  language-family instead of throwing, which paints GREY CHARTS that read as a data')
  console.error('  problem rather than a wiring one.')
  console.error('\n  The durable fix is not another hand-copy: export the registration from the leaf')
  console.error('  entry as one named function and have both entry files call it.')
  process.exit(1)
}

if (!comparisons) {
  console.log('COMPOSITE-REG: PASS — no composite bakes a sibling that registers strategies.')
  console.log('  Nothing to compare today. This is a real pass, not a skip: the walk ran over every')
  console.log('  bundle and found no leaf/composite pair where drift is possible.')
} else {
  console.log(`COMPOSITE-REG: PASS — ${comparisons} leaf/composite pair(s); every strategy the leaf`)
  console.log('  registers is also registered by the composite that bakes it.')
  console.log('  A composite registering nothing while its leaf registers nothing is fine — the rule')
  console.log('  is about DRIFT between two lists meant to agree, not about registering per se.')
}
