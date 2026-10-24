#!/usr/bin/env node
/**
 * check-reduced-motion-jumps.mjs — with prefers-reduced-motion, the grid→map framing must JUMP.
 *
 * ★ A READER OF THIS MAP IS PHOTOSENSITIVE. This is not a polish item: a camera that sweeps the globe every
 * time a list is filtered is the strobe class this repo has already paid for once.
 *
 * THE DEFECT, measured in a real browser with the preference set: the framing move still
 * animated for ~5.0s on MapLibre and ~6.7s on Mapbox — indistinguishable from no preference at all,
 * where a jump is ~0ms. The preference WAS being read correctly in research-map.vue and then thrown
 * away one layer down: useMapFly's `flyToCoords(coords, zoom)` takes NO options argument, so the
 * `{ duration: 0 }` being passed to it went nowhere. Its neighbour `fitBounds(bounds, padding,
 * options)` does accept one — two functions in one file, different signatures, and nothing at the
 * call site to show it.
 *
 * ★ WHY THIS RUNS WITHOUT A BROWSER, WHICH IS THE POINT. it was found by watching movestart →
 * moveend for six seconds; only a real browser can do that, and only occasionally. What can be checked any
 * time, in milliseconds, is the DECISION: given the preference, which camera call does the code
 * make? So this lifts the real camera block out of the SFC, runs it against a mocked matchMedia and
 * a recording map, and asserts the call that comes out.
 *
 * It cannot prove the engine honours duration 0 — that is the browser half. It proves we ASK for a jump,
 * which is the half that was wrong.
 *
 * ASSERTIONS:
 *   reduced motion ON   the engine's own jumpTo / fitBounds(duration:0) is called, and the eased
 *                       helper (mapFly) is NOT — a single eased call is the whole bug.
 *   reduced motion OFF  the eased path is used, so ordinary motion is unchanged.
 *   one row / a tight cluster / a globe-spanning set all take their own branch under both.
 *
 * Exit: 0 pass · 1 fail · 2 the camera block could not be found (reported, never silently skipped).
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSFC } from '@vue/compiler-sfc'

const TAG = 'REDUCED-MOTION-JUMPS'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FILE = join(ROOT, 'plugin-designs', 'doxa-research-map', 'research-map.vue')

const src = readFileSync(FILE, 'utf8')
const { descriptor } = parseSFC(src, { filename: FILE })
const script = (descriptor.scriptSetup || descriptor.script || {}).content || ''

// The block is delimited by its own banner comments, so a refactor that moves it renames the
// markers with it rather than leaving this gate quietly reading the wrong lines.
const START = 'const FIT_PADDING_PX'
const END = '// ─── Clusters wiring: TWO CONTROLS, ONE STATE'
// indexOf from the START, not from 0: an identical-looking line can appear earlier in a file this
// size, and a block that runs from the right start to the wrong end parses into nonsense.
const a = script.indexOf(START)
const b = a >= 0 ? script.indexOf(END, a) : -1
if (a < 0 || b < 0 || b < a) {
  console.log(`${TAG}: FAIL — could not find the camera block in research-map.vue (markers moved?).`)
  process.exit(2)
}
const block = script.slice(a, b)
if (!/function applyFitSlugs/.test(block) || !/function prefersReducedMotion/.test(block)) {
  console.log(`${TAG}: FAIL — the block found does not contain applyFitSlugs and prefersReducedMotion.`)
  process.exit(2)
}

/** Build the block with its collaborators injected, so the REAL code runs against fakes. */
function makeCamera({ reduce }) {
  const calls = []
  const rec = (name) => (...args) => calls.push({ name, args })
  const map = { value: { jumpTo: rec('map.jumpTo'), fitBounds: rec('map.fitBounds'), easeTo: rec('map.easeTo'), flyTo: rec('map.flyTo') } }
  const mapFly = { flyToCoords: rec('mapFly.flyToCoords'), fitBounds: rec('mapFly.fitBounds'), flyTo: rec('mapFly.flyTo') }
  const rows = []
  const mapData = { normalizedPeopleGroups: { value: rows } }
  const win = { matchMedia: (q) => ({ matches: reduce && /prefers-reduced-motion/.test(q) }) }
  // eslint-disable-next-line no-new-func
  const factory = new Function('map', 'mapData', 'mapFly', 'window', `${block}\n;return { applyFitSlugs, prefersReducedMotion }`)
  const api = factory(map, mapData, mapFly, win)
  return { ...api, calls, rows }
}

const cases = [
  { name: 'several peoples', rows: [
      { slug: 'a', longitude: 10, latitude: 5 }, { slug: 'b', longitude: 14, latitude: 9 }, { slug: 'c', longitude: 12, latitude: 7 },
    ], slugs: ['a', 'b', 'c'] },
  { name: 'one people', rows: [{ slug: 'a', longitude: 10, latitude: 5 }], slugs: ['a'] },
  { name: 'tight cluster', rows: [
      { slug: 'a', longitude: 10, latitude: 5 }, { slug: 'b', longitude: 10.001, latitude: 5.001 },
    ], slugs: ['a', 'b'] },
  { name: 'globe-spanning', rows: [
      { slug: 'a', longitude: -170, latitude: -40 }, { slug: 'b', longitude: 170, latitude: 60 },
    ], slugs: ['a', 'b'] },
]

const fails = []
const lines = []
for (const c of cases) {
  for (const reduce of [true, false]) {
    const cam = makeCamera({ reduce })
    cam.rows.push(...c.rows)
    cam.applyFitSlugs(c.slugs)
    const names = cam.calls.map((k) => k.name)
    const easedUsed = names.some((n) => n.startsWith('mapFly.'))
    const jumped = names.some((n) => n === 'map.jumpTo')
      || cam.calls.some((k) => k.name === 'map.fitBounds' && k.args[1] && k.args[1].duration === 0)
    lines.push(`  · ${c.name.padEnd(16)} reduce=${String(reduce).padEnd(5)} → ${names.join(', ') || '(no camera call)'}`)

    if (!names.length) { fails.push(`${c.name} (reduce=${reduce}) made no camera call at all.`); continue }
    if (reduce) {
      if (!jumped) fails.push(`${c.name}: with reduced motion the code did not ask for a jump — it called ${names.join(', ')}.`)
      if (easedUsed) fails.push(`${c.name}: with reduced motion it still used the EASED helper (${names.filter((n) => n.startsWith('mapFly.')).join(', ')}) — a single eased call is the whole defect.`)
    } else {
      if (!easedUsed) fails.push(`${c.name}: without the preference the eased path should be used, got ${names.join(', ')} — ordinary motion must be unchanged.`)
    }
  }
}

for (const l of lines) console.log(l)
if (fails.length) {
  console.log(`\n${TAG}: FAIL`)
  for (const f of fails) console.log(`  ✗ ${f}`)
  console.log('\n  Readers may be photosensitive. A camera that sweeps on every filter is the defect.')
  process.exit(1)
}
console.log(`${TAG}: PASS — reduced motion asks the engine to jump on every branch, and ordinary motion is untouched.`)
