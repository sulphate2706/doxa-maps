#!/usr/bin/env node
/**
 * check-gospel-whiteboard — the geometry the set charts depend on once they are drawn on a map.
 *
 * Three properties, each with the arm that would catch its own defect. None of them is about
 * whether the chart renders; all three are about it rendering something TRUE.
 *
 *  1. THE BOUNDED SET'S GAP SURVIVES PROJECTION. Inside points sit within 0.92r and outside
 *     beyond 1.12r, and nothing may land on the boundary — a dot on the line is the one thing a
 *     bounded set cannot express. Asserted on PROJECTED coordinates. Note what the arm below
 *     found: the projection is conformal, so it preserves the ratio EXACTLY and a narrowed gap
 *     survives just as a wide one does. The boundary cannot be eroded by the projection, only by
 *     someone editing the constants — which is therefore what the arm poisons.
 *  2. THE DRAWING STAYS INSIDE THE MERCATOR CLAMP. Shape does not degrade with extentFraction —
 *     the projection is the exact inverse of the renderer's transform, measured at 0.000% aspect
 *     error, and an earlier claim of mine that it did was an artefact of my own harness. What
 *     does bite is latitude: engines clamp near 85 degrees.
 *  3. A RADIUS IN MAP UNITS DOUBLES WITH EVERY ZOOM LEVEL. circle-radius is screen pixels, so a
 *     boundary that does not scale is correct at one zoom and wrong at every other.
 *
 * ★ THE CEILING IS A PROPERTY OF extentFraction ALONE, not of a chart's extent: the scale is
 * extentFraction/extent and the outermost point is at u = extent, so the product is always
 * extentFraction. A consumer cannot buy headroom against the clamp by choosing a bigger extent,
 * and one assertion covers every chart.
 */
import { layoutBoundedSet } from '../library/components/charts/boundedSet.js'
import { degreesToPixelRadius, dishRadiusDegrees, toFeatureCollection, centeredSetFeatures }
  from '../plugin-designs/gospel-internet/src/setChartFeatures.js'
import { layoutCenteredSet, ringRadii } from '../library/components/charts/centeredSet.js'
import { whiteboardProjection } from '../library/maps/whiteboard-projection.js'

const fail = []
const ok = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail.push(label) }
}
const R2D = 180 / Math.PI
// TRUE Web Mercator screen space: x is proportional to LONGITUDE ALONE. An earlier version of
// this used lng*cos(lat), a plate-carree correction the renderer never applies, and it
// manufactured a distortion that does not exist. Keep x = lng.
const screen = (lng, lat) => [lng, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R2D]

console.log('GOSPEL-WHITEBOARD')

// ── 1. the boundary gap, on projected coordinates ───────────────────────────
const R = 120, SPREAD = 260
function gapMargins(extentFraction, inner = 0.92, outer = 1.12) {
  const p = whiteboardProjection({ extent: SPREAD, extentFraction })
  const d = (u, v) => { const [lng, lat] = p(u, v); const [x, y] = screen(lng, lat); return Math.hypot(x, y) }
  let bMin = Infinity, bMax = -Infinity, inMax = -Infinity, outMin = Infinity
  for (let i = 0; i < 720; i++) {
    const a = i / 720 * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a)
    const b = d(c * R, s * R); bMin = Math.min(bMin, b); bMax = Math.max(bMax, b)
    inMax = Math.max(inMax, d(c * R * inner, s * R * inner))
    outMin = Math.min(outMin, d(c * R * outer, s * R * outer))
  }
  return { inside: bMin - inMax, outside: outMin - bMax }
}
const m = gapMargins(0.17)
ok('bounded: no inside point reaches the boundary', m.inside > 0, `margin ${m.inside.toFixed(3)}`)
ok('bounded: no outside point reaches the boundary', m.outside > 0, `margin ${m.outside.toFixed(3)}`)
// ★ THE ARM, AND WHAT WRITING IT TAUGHT ME. My first version narrowed the gap to 0.999/1.001 and
// expected the margins to go negative. THEY DID NOT — they stayed positive at 0.028. The
// projection is conformal, so it preserves the RATIO exactly; a gap of a tenth of a percent
// survives projection just as a gap of eight percent does. There is no distortion for a narrow
// gap to be eaten by.
// That means "the gap survives projection" is very nearly a tautology, and a check resting on it
// alone would look like a guard while testing almost nothing. What CAN actually fail is the
// ORDERING of the constants — someone editing 0.92/1.12 to the wrong side of 1 — so that is what
// the arm poisons. Recorded rather than quietly swapped, because the fact that narrowing is safe
// is itself worth knowing: it says the boundary cannot be eroded by the projection, only by us.
const inverted = gapMargins(0.17, 1.01, 0.99)
ok('bounded: inverting the constants FAILS (so the guard is not inert)',
  inverted.inside <= 0 || inverted.outside <= 0,
  `inverted margins ${inverted.inside.toFixed(3)} / ${inverted.outside.toFixed(3)}`)
const narrow = gapMargins(0.17, 0.999, 1.001)
ok('bounded: a narrowed gap still survives, because the projection preserves ratios exactly',
  narrow.inside > 0 && narrow.outside > 0, `margins ${narrow.inside.toFixed(3)} / ${narrow.outside.toFixed(3)}`)

// ── 2. the latitude ceiling ─────────────────────────────────────────────────
const EXTENT_C = 30 + 9 * 22
const feats = centeredSetFeatures(
  layoutCenteredSet([{ id: 'a', label: 'A', ring: 10 }], { innerR: 30, ringGap: 22 }).placed,
  ringRadii({ innerR: 30, ringGap: 22 }), {})
const { maxAbsLat } = toFeatureCollection(feats, whiteboardProjection({ extent: EXTENT_C }))
ok('centered: the drawing stays inside the Mercator clamp', maxAbsLat < 85, `max |lat| ${maxAbsLat.toFixed(2)}`)
// THE ARM: the ceiling is extentFraction's, so a wide one must breach it
const wide = whiteboardProjection({ extent: EXTENT_C, extentFraction: 0.95 })(0, EXTENT_C)[1]
ok('the clamp CAN be breached by extentFraction alone (so the guard is not inert)',
  Math.abs(wide) > 85, `|lat| ${Math.abs(wide).toFixed(2)} at fraction 0.95`)
// and it does not depend on the extent
const lats = [100, 228, 260, 1000].map((e) => Math.abs(whiteboardProjection({ extent: e })(0, e)[1]))
ok('the ceiling is extentFraction\'s alone, not the extent\'s',
  Math.max(...lats) - Math.min(...lats) < 1e-6, lats.map((l) => l.toFixed(3)).join(' '))

// ── 3. a map-unit radius doubles per zoom ───────────────────────────────────
const deg = dishRadiusDegrees(R, whiteboardProjection({ extent: SPREAD }))
const expr = degreesToPixelRadius(deg)
const [, , , z0, r0, z1, r1] = expr
ok('dish: the radius is a zoom expression, not a constant', Array.isArray(expr) && expr[0] === 'interpolate')
ok('dish: it uses exponential base 2, which is what doubling per zoom requires',
  expr[1][0] === 'exponential' && expr[1][1] === 2)
ok('dish: its stops scale by exactly 2^(z1-z0)',
  Math.abs(r1 / r0 - Math.pow(2, z1 - z0)) / Math.pow(2, z1 - z0) < 1e-9,
  `${r0.toFixed(2)}px at z${z0}`)

if (fail.length) {
  console.log(`\nGOSPEL-WHITEBOARD: FAIL — ${fail.length}: ${fail.join(', ')}`)
  process.exit(1)
}
console.log('\nGOSPEL-WHITEBOARD: PASS — the gap, the clamp and the scaling all hold, and each arm can fail')
