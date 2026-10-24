#!/usr/bin/env node
/**
 * check-mercator-slice — a poster's tile rows must be equal on SCREEN, not equal in degrees.
 *
 * THE DEFECT: Simple Research's Export → poster showed far too much of Antarctica
 * and comes out at the wrong, vertical aspect.
 *
 * The big-poster renderer stitches tiles, each drawn into an EQUAL-HEIGHT slot of the output. It picked
 * each row's latitude band by dividing the degree span evenly — but screen height is proportional to
 * ln(tan(pi/4 + lat/2)), not to latitude. So equal degree bands are unequal screen bands, and painting
 * them into equal slots squeezes some and stretches others.
 *
 * ★ THE ASSERTION IS THE PROPERTY, AND THE CONTROL IS THE OLD CODE. Every band must occupy the same
 * share of the rendered height, AND the degree-linear slicing it replaced must FAIL that same check —
 * otherwise this passes on a tree where nothing was fixed.
 *
 * Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { equalHeightLatBands, mercatorY, latAtMercatorY, MERCATOR_MAX_LAT } =
  await import(resolve(ROOT, 'library/maps/mercator-slice.js'))

const fails = []
const shares = (bands, s, n) => {
  const tot = mercatorY(n) - mercatorY(s)
  return bands.map(([bs, bn]) => (mercatorY(bn) - mercatorY(bs)) / tot)
}

for (const [s, n, rows] of [[-60, 75, 4], [-85, 85, 6], [-10, 10, 3], [20, 60, 5], [-60, 75, 1]]) {
  const bands = equalHeightLatBands(s, n, rows)
  if (bands.length !== rows) { fails.push(`${rows} rows requested, ${bands.length} returned`); continue }
  const sh = shares(bands, s, n)
  const worst = Math.max(...sh.map((x) => Math.abs(x - 1 / rows)))
  if (worst > 1e-9) {
    fails.push(`bands of a ${s}..${n} view in ${rows} rows are not equal on screen: `
      + `shares ${sh.map((x) => (x * 100).toFixed(1) + '%').join(' ')}`)
  }
  // north-first, contiguous, and covering the whole span
  if (Math.abs(bands[0][1] - Math.max(s, n)) > 1e-9) fails.push(`first band does not start at the north edge (${s}..${n})`)
  if (Math.abs(bands[rows - 1][0] - Math.min(s, n)) > 1e-9) fails.push(`last band does not end at the south edge (${s}..${n})`)
  for (let i = 1; i < rows; i++) {
    if (Math.abs(bands[i][1] - bands[i - 1][0]) > 1e-9) fails.push(`bands ${i - 1}/${i} are not contiguous`)
  }
}

// ★ THE CONTROL: the degree-linear slicing this replaced MUST fail the same property.
const linearBands = (s, n, rows) => {
  const step = (n - s) / rows
  return Array.from({ length: rows }, (_, r) => [n - (r + 1) * step, n - r * step])
}
const linWorst = (() => {
  const sh = shares(linearBands(-60, 75, 4), -60, 75)
  return Math.max(...sh.map((x) => Math.abs(x - 0.25)))
})()
if (linWorst <= 1e-9) {
  fails.push('degree-linear slicing PASSES the equal-height assertion, so the assertion cannot detect '
    + 'the defect it exists for — it is measuring nothing.')
}

// The poles are undefined in Mercator; a world view must clamp rather than produce Infinity.
const polar = equalHeightLatBands(-90, 90, 4)
if (!polar.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b))) {
  fails.push('a -90..90 view produces non-finite bands; Mercator is undefined at the poles and must clamp')
}
if (Math.abs(polar[0][1]) > MERCATOR_MAX_LAT + 1e-6) fails.push('the north edge was not clamped to the Mercator limit')
if (Math.abs(latAtMercatorY(mercatorY(41.2)) - 41.2) > 1e-9) fails.push('mercatorY/latAtMercatorY are not inverses')

if (fails.length) {
  console.error('MERCATOR-SLICE: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`MERCATOR-SLICE: PASS — every tile row occupies an equal share of the RENDERED height across five `
  + `view/row combinations, degree-linear slicing fails the same check (worst band off by ${(linWorst * 100).toFixed(1)} `
  + 'points), and a polar view clamps instead of going infinite.')
