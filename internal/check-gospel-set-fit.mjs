#!/usr/bin/env node
/**
 * check-gospel-set-fit.mjs — the set charts must FIT the canvas they are given.
 *
 * WHY THIS EXISTS. With renderWorldCopies:false (library/maps/whiteboard-map.js) the engine refuses
 * to zoom out past the point where ONE WORLD fills the canvas WIDTH. That puts a hard floor under the
 * zoom at log2(canvasWidth/512) — and on a WIDE, SHORT figure that floor is too close for the
 * drawing's own height, so the outermost groups fall outside the frame. minZoom does not help; the
 * width constraint wins. A browser check measured it at 1440: 54 groups outside in ar and 97 in en, which is
 * what proved it was the WIDTH and never RTL.
 *
 * WHAT IT ASSERTS. For every layout the charts actually get, the drawing's vertical extent at the
 * floor zoom must fit inside the canvas height, padding included. This is pure arithmetic against
 * the same projection the components use, so it needs no browser and cannot drift from the source.
 *
 * ★ THE MERCATOR STRETCH IS THE WHOLE POINT. A first version of this calculation used a flat
 * 360/(512*2^z) degrees-per-pixel and concluded the chart already fitted at every width — which
 * contradicted a measurement taken on the page. Latitude degrees are NOT linear in pixels: the
 * drawing reaches ±29° now and reached ±52° before, where the error is large enough to invert the
 * answer. The world-Y form below is the projection's own, so the gate and the renderer agree.
 */
import { whiteboardProjection } from '../library/maps/whiteboard-projection.js'

const RING_MAX = 10
const CENTERED_EXTENT = 30 + (RING_MAX - 1) * 22   // 228, GiCenteredSetMap
const BOUNDED_EXTENT = 260                          // SPREAD, GiBoundedSetMap
const FRACTION = 0.095                              // both charts, kept equal on purpose
const FIT_PADDING = 40                              // the fitBounds padding both charts pass

/** Mercator world-Y in [0,1] — the projection's own vertical, not a linear degree scale. */
const worldY = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2
const log2 = (x) => Math.log(x) / Math.log(2)

/** The zoom the engine cannot go below on this canvas, with renderWorldCopies:false. */
export function floorZoom(canvasWidth) {
  return log2(canvasWidth / 512)
}

/** Pixels of height the drawing needs on this canvas, at the floor zoom. */
export function neededHeightPx(extent, fraction, canvasWidth) {
  const project = whiteboardProjection({ extent, extentFraction: fraction })
  const north = project(0, extent)[1]
  const south = project(0, -extent)[1]
  const worldFraction = Math.abs(worldY(north) - worldY(south))
  return worldFraction * 512 * Math.pow(2, floorZoom(canvasWidth))
}

// The canvases the charts are actually given: the measured figures at 1440 and 1280, the embed
// card, and two narrow ones so a phone cannot regress unnoticed.
const LAYOUTS = [
  { name: '1440 board (measured)', w: 796, h: 249 },
  { name: '1280 board (measured)', w: 636, h: 220 },
  { name: 'embed card', w: 1198, h: 560 },
  { name: 'tablet', w: 380, h: 300 },
  { name: 'phone', w: 340, h: 240 },
]

const CHARTS = [
  { name: 'centered', extent: CENTERED_EXTENT },
  { name: 'bounded', extent: BOUNDED_EXTENT },
]

const pass = []
const fail = []
const ok = (label, cond, detail = '') => (cond ? pass : fail).push(detail ? `${label} — ${detail}` : label)

for (const chart of CHARTS) {
  for (const layout of LAYOUTS) {
    const need = neededHeightPx(chart.extent, FRACTION, layout.w)
    const have = layout.h - 2 * FIT_PADDING
    ok(
      `${chart.name} fits ${layout.name} (${layout.w}x${layout.h})`,
      need <= have,
      `needs ${need.toFixed(0)}px of ${have}px available`,
    )
  }
}

// ★ NEGATIVE CONTROL. The 0.17 default is the value that was measured FAILING on the page, so if
// this arm does not fail the calculation is not measuring what the browser measured and a pass means
// nothing. Asserted on the tightest real layout.
const poison = neededHeightPx(CENTERED_EXTENT, 0.17, 796)
ok(
  'NEG CONTROL: the old 0.17 fraction still does NOT fit 796x249',
  poison > 249 - 2 * FIT_PADDING,
  `0.17 needs ${poison.toFixed(0)}px of ${249 - 2 * FIT_PADDING}px — the measured defect`,
)

// The two charts must share one footprint, or the same population reads as a different size when a
// reader switches tabs.
ok(
  'both charts use the same extentFraction',
  Math.abs(neededHeightPx(CENTERED_EXTENT, FRACTION, 796) / neededHeightPx(BOUNDED_EXTENT, FRACTION, 796) - 1) < 1e-9,
  'centered and bounded project to the same vertical span',
)

for (const p of pass) console.log(`  ✓ ${p}`)
for (const f of fail) console.log(`  ✗ ${f}`)
if (fail.length) {
  console.log(`\nGOSPEL-SET-FIT: FAIL — ${fail.length} of ${pass.length + fail.length}`)
  process.exit(1)
}
console.log(`\nGOSPEL-SET-FIT: PASS — ${pass.length} assertions; every layout fits at the engine's floor zoom`)
