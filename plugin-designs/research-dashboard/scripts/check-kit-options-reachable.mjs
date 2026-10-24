#!/usr/bin/env node
/**
 * check-kit-options-reachable.mjs — an option a kit composable accepts must actually be USED.
 *
 * WRITTEN BECAUSE I NEARLY SHIPPED ONE. Kit landing 3 gave useSelectionCamera a `coords` option so
 * a dashboard whose rows spell their coordinate differently could say so. It was accepted in the
 * destructured signature and never passed on to selectionBounds — so a caller could set it,
 * type-check clean, build clean, and watch it do nothing at all.
 *
 * THAT IS THE WORST SHAPE A MISSING FEATURE CAN TAKE, and this tree has paid for it before: a
 * defineProps on a component the custom element never binds, documented at length in
 * research-dashboard.vue. An option that cannot be observed to work is worse than no option,
 * because it READS as supported. Nobody files a bug against a knob they assume they misused.
 *
 * It matters more for the kit than it did for one dashboard. The whole promise of SPEC-DASHBOARD-KIT
 * is "a config produces a working dashboard", and every landing adds parameters whose only job is to
 * be honoured. A parameter that is merely present turns that promise into a guess.
 *
 * WHAT IT CHECKS: for each shared composable below, every name destructured from the options object
 * must appear somewhere in the function body other than its own declaration. Renamed and defaulted
 * forms are handled; a name used only inside its own default expression does not count.
 *
 * NOT A TYPE CHECKER. It cannot tell a wrongly-used option from a rightly-used one — only a
 * completely unused one, which is the failure that is invisible from outside.
 *
 * NEGATIVE-TESTED: deleting the `coords` argument from the selectionBounds call fails it naming the
 * option and the composable; deleting the option itself passes (an option that does not exist makes
 * no promise).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'KIT-OPTIONS-REACHABLE'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
// The kit's shared composables, in extraction order. Each new landing adds its file here.
const FILES = [
  'library/composables/useSelectionBus.js',
  'library/composables/useDashboardLayout.js',
  'library/composables/useSelectionCamera.js',
  'library/composables/useCsvExport.js',
]
const fails = []
const notes = []
let checked = 0

for (const rel of FILES) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) { notes.push(`${rel}: not present yet (its landing has not happened) — skipped`); continue }
  const src = readFileSync(p, 'utf8')
  // Every exported function whose single parameter is a destructured options object.
  for (const m of src.matchAll(/export function (\w+)\(\s*\{([\s\S]*?)\}\s*\)\s*\{/g)) {
    const [, fn, params] = m
    // The body: from the end of the signature to the end of the file is enough — a name used
    // anywhere after the signature is used. Narrower slicing risks a false accusation.
    // ★ COMMENTS STRIPPED, AND THIS IS THE FOURTH TIME I HAVE WRITTEN THIS HOLE. The first version
    // read the raw body, and the comment I had just written next to the fixed call site says
    // "`coords` IS PASSED HERE" — so the mutant that removed the actual argument left the gate
    // green. Every check I write that searches source for a token has to strip comments first,
    // because the comment explaining the code is the most likely place for that token to also
    // appear. A check its own documentation can satisfy is not a check.
    const body = src.slice(m.index + m[0].length)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    // ★ COMMENTS OUT OF THE SIGNATURE FIRST, THEN SPLIT. Splitting the raw text on commas cut
    // through the PROSE of the comments documenting each option, and the fragments came back as
    // option names — the gate solemnly reported that useCsvExport accepts `and` and never uses it.
    // A parser that reads its own documentation as data produces findings nobody can act on, which
    // is a different way of being unusable from the comment-satisfies-the-assertion hole two lines
    // up. Both are the same root cause: comments are text, and every text search has to say so.
    const paramSrc = params
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    // Split the destructuring at top-level commas only, so a default like `() => true` survives.
    const parts = []
    let depth = 0, cur = ''
    for (const ch of paramSrc) {
      if ('([{'.includes(ch)) depth++
      else if (')]}'.includes(ch)) depth--
      if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
    }
    parts.push(cur)
    for (const raw of parts) {
      // strip comments, then read the local binding name: `a`, `a = d`, `a: b`, `a: b = d`
      const decl = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
      if (!decl) continue
      const nameM = /^([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?/.exec(decl)
      if (!nameM) continue
      const local = nameM[2] || nameM[1]
      checked++
      if (new RegExp(`(?<![\\w$.])${local.replace('$', '\\$')}(?![\\w$])`).test(body)) continue
      fails.push(`${rel}: ${fn}() accepts \`${local}\` and never uses it. A caller can set it, type-check clean, build clean, and watch it do nothing — which reads as supported. Either honour it or remove it.`)
    }
  }
}

console.log(`  · ${checked} option(s) across ${FILES.filter((f) => existsSync(join(ROOT, f))).length} shared composable(s)`)
for (const n of notes) console.log('  · ' + n)
if (fails.length) {
  console.error(`\n${TAG}: FAIL`)
  for (const f of fails) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`${TAG}: PASS — every option the kit accepts is honoured somewhere.`)
