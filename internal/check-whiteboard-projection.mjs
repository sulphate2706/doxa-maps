#!/usr/bin/env node
/**
 * check-whiteboard-projection — the shared projection is byte-identical to the one it replaced, and it
 * keeps a circle ROUND on screen.
 *
 * TWO ARMS, FOR TWO DIFFERENT RISKS.
 *
 * ARM A — THE EXTRACTION MUST NOT MOVE THE LANGUAGE TREE. whiteboardProjection was lifted out of
 * library/scripts/build-language-tree.mjs, which is a BUILD-TIME artifact: if the maths shifted by a
 * rounding step, 4,000 coordinates would change, every diff of that file would be unreadable, and
 * nothing would look wrong. So the old private implementation is reproduced here verbatim as a
 * REFERENCE and the two are compared over a grid, exactly — not approximately.
 *
 * ARM B — THE DEFECT THE NAIVE VERSION WOULD HAVE SHIPPED, and the reason this is a module at all.
 * Mercator stretches vertically by 1/cos(latitude). A chart mapped LINEARLY into degrees is therefore
 * rendered taller the further it sits from the equator, so a circle becomes an OVAL, worst at the
 * edges. gospel's set charts are CONCENTRIC RINGS — the shape that shows it most and the one whose
 * outer ring carries the labels a reader compares. This asserts the thing that is actually wanted:
 * after the renderer's own stretch, a ring is still round, at the inner ring AND at the outer one.
 * Written because gospel was about to scale by one number, and it would have looked plausible.
 *
 * Headless, no browser, no map. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { whiteboardProjection } = await import(resolve(ROOT, 'library/maps/whiteboard-projection.js'))

const fails = []

// ── ARM A: the ORIGINAL, copied verbatim from build-language-tree.mjs before the extraction ──────
const referenceProjection = (ext, extentFraction) => {
  const K = extentFraction / ext
  return (u, v) => {
    const X = 0.5 + u * K, Y = 0.5 - v * K
    const lng = (X - 0.5) * 360
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180 / Math.PI
    return [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]
  }
}
let compared = 0, drift = null
for (const [ext, frac] of [[1, 0.17], [228, 0.17], [260, 0.17], [17.5, 0.17], [228, 0.08], [228, 0.34]]) {
  const ours = whiteboardProjection({ extent: ext, extentFraction: frac })
  const ref = referenceProjection(ext, frac)
  if (ours.K !== frac / ext) fails.push(`K differs for extent ${ext}, fraction ${frac}: ${ours.K} vs ${frac / ext}`)
  for (let u = -ext; u <= ext; u += ext / 8) {
    for (let v = -ext; v <= ext; v += ext / 8) {
      const a = ours(u, v), b = ref(u, v)
      compared++
      if ((a[0] !== b[0] || a[1] !== b[1]) && !drift) drift = { u, v, ext, frac, a, b }
    }
  }
}
if (drift) {
  fails.push(`the extracted projection DIFFERS from the one it replaced at (${drift.u}, ${drift.v}), `
    + `extent ${drift.ext}: got [${drift.a}], the original gives [${drift.b}]. Every built tree would move.`)
}

// ── ARM B: a ring stays round AFTER the renderer's own Mercator stretch ──────────────────────────
// Screen y is proportional to the Mercator y of a latitude, not to the latitude itself. So "round on
// screen" means the projected ring's extent in MERCATOR space is square — which is the only space in
// which the comparison means anything.
const mercY = (latDeg) => Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI / 180) / 2))
const roundness = (project, radius) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < 360; i++) {
    const a = (i * Math.PI) / 180
    const [lng, lat] = project(radius * Math.cos(a), radius * Math.sin(a))
    const y = mercY(lat)
    minX = Math.min(minX, lng); maxX = Math.max(maxX, lng)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  // lng degrees and mercator y are both linear in screen px, related by the same constant (pi/180),
  // so the ratio below is the rendered aspect ratio of the ring.
  return ((maxY - minY) / (Math.PI / 180)) / (maxX - minX)
}
// gospel's centered set: inner ring 30, outer ring 228 (innerR 30 + 9 x ringGap 22).
const project = whiteboardProjection({ extent: 228 })
for (const [name, r] of [['inner ring (30)', 30], ['mid ring (129)', 129], ['outer ring (228)', 228]]) {
  const ratio = roundness(project, r)
  if (Math.abs(ratio - 1) > 0.01) {
    fails.push(`${name} does not render round: aspect ${ratio.toFixed(4)} (1.0 is round). `
      + 'A ring drawn as an oval is the defect a LINEAR scale into degrees produces.')
  }
}
// ...and the control: a linear scale MUST fail the same assertion, or the assertion proves nothing.
const linear = (() => { const K = 0.17 / 228; const f = (u, v) => [u * K * 360, v * K * 360]; return f })()
if (Math.abs(roundness(linear, 228) - 1) <= 0.01) {
  fails.push('a LINEAR scale passes the roundness assertion, so the assertion cannot detect the defect '
    + 'it exists for — it is measuring nothing.')
}

if (fails.length) {
  console.error('WHITEBOARD-PROJECTION: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`WHITEBOARD-PROJECTION: PASS — identical to the implementation it replaced over ${compared} grid points, `
  + 'and a ring renders round at the inner, middle and outer radii while a linear scale does not.')
