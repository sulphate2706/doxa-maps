#!/usr/bin/env node
/* check-region-paint-single-source.mjs — `bun run check:region-paint-single-source`.
 * Source-only, headless, no browser.
 *
 * ★ WHAT DRIFTS, AND WHY A GATE RATHER THAN A NOTE. Two production maps —
 * doxa-research-map/research-map.vue and country-posters/countries-map.vue — paint the doxa-regions
 * layers directly: 35 setPaintProperty('regions-fill'|'regions-border') calls between them, 10 in
 * one file and 25 in the other. Twenty-one of those pass their value through a helper, regionIdle,
 * that wraps it in the same ['case', ['has','iso_3166_1_alpha_3'], v, v] expression. The helper was
 * DEFINED SEPARATELY IN EACH PLUGIN while the library composable both maps already use
 * (useLegendMapBridge) took it as an injected dependency and called it itself.
 *
 * So the library owned the paint logic and not the helper, and the two copies could be edited apart
 * with nothing failing. The two maps would then paint the same "idle" state differently — a
 * difference no existing gate covers, because check:region-fill-repaint reads only
 * RegionCountryMap.vue, a different component.
 *
 * ★ WHAT THIS ASSERTS, AND THE LINE IT DOES NOT CROSS. It asserts the IDLE paint is single-sourced.
 * It does NOT demand that all 35 writes route through the library, because they legitimately should
 * not: the raw multi-line ['case', …] writes are HIGHLIGHT states (a matched region painted
 * differently from its neighbours) and fill-outline-color:null resets. Those differ by design and by
 * map. A gate that demanded uniformity there would be red on the day it was written, which is how a
 * gate earns the habit of being ignored.
 *
 * ⚠ THE FREQUENCY ASYMMETRY IS DELIBERATELY NOT ASSERTED. countries-map repaints the idle state more
 * often than research-map (15 helper calls vs 6) and has one dynamic regionIdle(v) the other lacks.
 * That is a real difference in WHEN each map repaints, and flattening it is how a map goes blank —
 * so this checks that they agree on WHAT idle looks like, never on how often they say it.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POISON = process.argv.includes('--poison')

const BRIDGE = 'library/composables/legends/useLegendMapBridge.js'
const CONSUMERS = [
  'plugin-designs/doxa-research-map/research-map.vue',
  'plugin-designs/country-posters/countries-map.vue',
]

let fails = 0
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} - ${msg}`); if (!cond) fails++ }
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

// Drop comment LINES so a sentence ABOUT regionIdle never counts as a definition. This gate has a
// sibling lesson behind it: a name inside a regex literal in a gate script was once counted as a
// definition, and the rule it informed would have been red on day one.
//
// ⚠ LINE-ORIENTED ON PURPOSE. The first draft of this used /\/\*[\s\S]*?\*\//g to strip block
// comments, and in a .vue file — which carries CSS and a template alongside the script — that ate
// whole regions INCLUDING the regionIdle declarations it was meant to find. Every "does not define
// its own regionIdle" assertion then passed while both files plainly defined it. A stripper that can
// delete the thing being measured turns the gate green by destroying its own evidence.
const decomment = (s) => s.split('\n')
  .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
  .join('\n')

// ── the idle expression, as the library builds it ────────────────────────────────────────────────
const IDLE_SHAPE = /\[\s*'case'\s*,\s*\[\s*'has'\s*,\s*'iso_3166_1_alpha_3'\s*\]\s*,\s*v\s*,\s*v\s*\]/

let bridgeSrc = read(BRIDGE)
if (POISON) {
  // Poison 1: a plugin re-introduces its own copy of the helper the library exports.
  bridgeSrc = bridgeSrc.replace(/export function regionIdle/, 'function regionIdle')
}
const bridge = decomment(bridgeSrc)

ok(existsSync(resolve(ROOT, BRIDGE)), `${BRIDGE} exists`)

// 1 ── the library must OWN and EXPORT the idle helper
const libExports = /export\s+(?:function\s+regionIdle\b|const\s+regionIdle\s*=)/.test(bridge)
ok(libExports, 'useLegendMapBridge exports regionIdle (the library owns the idle expression)')

const libBody = /regionIdle[\s\S]{0,200}?\['case'[\s\S]{0,120}?iso_3166_1_alpha_3/.test(bridge)
ok(libBody, "the library's regionIdle builds the ['case', ['has','iso_3166_1_alpha_3'], v, v] expression")

// 2 ── SINGLE SOURCE: no consumer may keep its own copy of a name it imports from the bridge.
//      This is the narrow shape — a file that IMPORTS module M must not also DEFINE a name M
//      exports. The broad version (any library export name redefined anywhere) was measured against
//      all 455 library export names and would be red on day one: colour-mode modules implement an
//      interface by name, and generic helpers collide.
for (const rel of CONSUMERS) {
  let src = read(rel)
  if (POISON) {
    // Poison 2: the plugin keeps a local regionIdle even though it imports from the bridge.
    src = src.replace(
      /(import\s*\{[^}]*\}\s*from\s*'[^']*useLegendMapBridge\.js')/,
      "$1\nconst regionIdle = (v) => ['case', ['has', 'iso_3166_1_alpha_3'], v, v]"
    )
  }
  const s = decomment(src)
  const name = rel.split('/').pop()

  const importsBridge = /import\s*\{[^}]*\}\s*from\s*'[^']*useLegendMapBridge\.js'/.test(s)
  ok(importsBridge, `${name} imports useLegendMapBridge`)

  const localDef = /^[ \t]*(?:export\s+)?(?:function\s+regionIdle\b|(?:const|let|var)\s+regionIdle\s*=)/m.test(s)
  ok(!localDef, `${name} does NOT define its own regionIdle (single source: the library's)`)

  // 3 ── every idle paint write in the consumer goes through the helper, never an inlined copy of
  //      the expression. Highlight writes are exempt by construction: they do not match IDLE_SHAPE,
  //      because that shape is specifically `v, v` — the same value on both branches, which is what
  //      makes it the IDLE state rather than a highlight.
  //      ⚠ Exempt only a line that CALLS regionIdle, never one that DEFINES it. A one-line
  //      `function regionIdle(v) { return [...] }` contains the name and the expression together, so
  //      a naive "skip lines mentioning regionIdle" hid exactly the definition this is hunting.
  const inlined = s.split('\n').filter((l, i) => {
    if (!IDLE_SHAPE.test(l)) return false
    const defines = /(?:function\s+regionIdle\b|(?:const|let|var)\s+regionIdle\s*=)/.test(l)
    const calls = /regionIdle\s*\(/.test(l) && !defines
    if (calls) return false
    return true // an inlined copy, or the local definition itself — both are findings
  })
  ok(inlined.length === 0,
    `${name} has no inlined copy of the idle expression${inlined.length ? ` (${inlined.length} line(s))` : ''}`)
}

// 4 ── the bridge must still RECEIVE regionIdle for one round (step 1 keeps the injected parameter,
//      so the swap is a pure deletion in the plugins plus an addition in the library). When the
//      parameter is finally dropped, this assertion is the one to delete with it.
ok(/function useLegendMapBridge\(\{[^}]*\bregionIdle\b/.test(bridge),
  'useLegendMapBridge still accepts regionIdle as a parameter (kept one round, so the swap stays reviewable)')

console.log(fails === 0
  ? '\ncheck:region-paint-single-source PASS'
  : `\ncheck:region-paint-single-source FAIL (${fails})`)
process.exit(fails ? 1 : 0)
