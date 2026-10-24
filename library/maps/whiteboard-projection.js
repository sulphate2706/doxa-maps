/**
 * whiteboard-projection.js — abstract chart coordinates onto a map, undistorted.
 *
 * A whiteboard chart is laid out in its OWN units (the language tree in layout units, gospel's
 * centered set in ring radii) and then drawn by a map engine, which reads coordinates as lng/lat and
 * renders them through Web Mercator. This converts the one into the other.
 *
 * ★ IT IS NOT A SCALE FACTOR, AND THAT IS THE WHOLE REASON IT IS A MODULE. Mercator stretches
 * vertically by 1/cos(latitude), so a drawing mapped LINEARLY into degrees is rendered progressively
 * taller the further it sits from the equator: 1.0154x at 10 degrees, 1.0642x at 20, 1.1547x at 30.
 * A circle becomes an oval, and worse at the edges than the middle. This applies the INVERSE of
 * Mercator, so the degree-height it emits shrinks by exactly the amount the renderer will add back.
 * MEASURED on a unit circle at increasing distance from centre (height as a fraction of width):
 * 0.9996 at the centre, 0.9729, 0.8993, 0.7953, and 0.6794 at the outer edge — those numbers ARE the
 * correction, not an error in it, and they are what make the circle round on screen.
 *
 * ★ WHAT extentFraction CANNOT BREAK, AND WHAT IT CAN. Roundness is exact at EVERY value of it: this
 * is the exact inverse of the renderer's own transform, so a circle measured in MERCATOR space — the
 * space the map actually draws in — comes back at 0.000% warp whether the fraction is 0.17 or 0.95.
 * A consumer with a hard geometric invariant (gospel's bounded set needs an 0.92r/1.12r band that
 * nothing may sit on) does NOT have to defend it against this parameter.
 *
 * ★ MEASURE IT IN MERCATOR SPACE OR THE ANSWER IS NOISE. Treating lng/lat AS IF it were the screen
 * reports a warp that grows with the fraction — 17.5% at 0.17, 35.3% at 0.25, 62.9% at 0.35 — and none
 * of it is rendered. Those numbers are the CORRECTION doing its job, read in the wrong coordinate
 * system. Screen y is proportional to ln(tan(pi/4 + lat/2)), never to lat.
 *
 * ★ AND THERE IS A SECOND, SUBTLER WAY TO GET THE SPACE WRONG: correcting the X axis. Web Mercator's
 * screen x is proportional to LONGITUDE ALONE -- no cos(lat) term. That absence is not an oversight in
 * the formula, it is the reason the projection is conformal and the reason circles stay circles. A
 * reader who has just been told "it is a projection, not a scale" naturally reaches for the
 * plate-carree correction x = lng * cos(lat), which the renderer never performs, and then measures the
 * damage their own extra transform did. MEASURED here on a ring at extent 260: true Mercator gives
 * 0.000% warp at every fraction, while inserting cos(lat) into x invents 12.4% at 0.17, 23.8% at 0.25,
 * 39.8% at 0.35 and 56.5% at 0.45 -- a clean, plausible, monotonic table describing nothing.
 * (Both wrong spaces produce a table that GROWS with the fraction, and their magnitudes differ by which
 * wrong transform you picked, so the shape of the numbers cannot tell you which mistake you made. Only
 * comparing against x = lng, y proportional to ln(tan(pi/4 + lat/2)) can.)
 * This happened to a careful reader within an hour of the first correction, in the opposite direction:
 * first a projection mistaken for a scale, then an over-correction applying a transform that is not
 * there. If a measurement of this module ever reports a threshold, suspect the harness before the maths
 * -- roundness here cannot degrade, because it is the exact inverse of what the renderer does.
 *
 * ★ THE REAL CEILING IS LATITUDE, not roundness. The drawing's outermost point reaches |lat| 52 deg at
 * 0.17, 77 at 0.35, 83 at 0.45 and 89.7 at 0.95 — and Web Mercator is undefined at the poles, with the
 * engines clamping around 85. So the parameter's usable range is bounded by how close to the pole the
 * outermost point lands, not by any deformation of shape.
 *
 * ★ AND THAT CEILING BELONGS TO extentFraction ALONE — NOT to a chart's extent (gospel, measured, and
 * it kills the fix someone would reach for first). K = extentFraction / extent and the outermost point
 * sits at u = extent, so u*K = extentFraction whatever the extent is: |lat| is 52.070 at frac 0.17 for
 * extents 100, 228, 260 and 1000 alike, identical to three decimals. A consumer whose drawing hits the
 * clamp therefore gains NOTHING by choosing a smaller extent — extent is a unit choice, the fraction is
 * the whole ceiling. The useful corollary is that one assertion on extentFraction covers every chart;
 * no per-consumer latitude guard is needed.
 *
 * ★ EXTRACTED, NOT WRITTEN. This was private inside library/scripts/build-language-tree.mjs and would
 * have been copied the moment a second chart needed it — gospel's set charts were about to scale
 * linearly by one number, which renders concentric rings as ovals, worst at the outer ring where the
 * labels are. One rule, one place, before there are two copies rather than after.
 */

/**
 * How much of the Mercator square the drawing spans, per unit of its own extent.
 * ★ extentFraction DECIDES HOW FAR A READER CAN ZOOM OUT, which is why it is a parameter with a
 * measured default rather than a constant. The engines stop at zoom 0 (the whole square), so the
 * SMALLER the drawing, the more room there is below its opening view. At 0.68 there was about one
 * level of room to zoom further out; at 0.17 there are two.
 */
export function whiteboardScale(extent, extentFraction = 0.17) {
  return extentFraction / (extent || 1)
}

/**
 * @param {Object} o
 * @param {number} o.extent           the drawing's half-extent in its OWN units (its outermost point)
 * @param {number} [o.extentFraction] share of the Mercator square to span; see above
 * @returns {function(number, number): [number, number]} (u, v) -> [lng, lat], with `.K` (the scale)
 *          exposed because a caller that also sizes RADII in degrees needs the same factor.
 */
export function whiteboardProjection({ extent, extentFraction = 0.17 } = {}) {
  const K = whiteboardScale(extent, extentFraction)
  const project = (u, v) => {
    const X = 0.5 + u * K, Y = 0.5 - v * K
    const lng = (X - 0.5) * 360
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180 / Math.PI
    return [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]
  }
  project.K = K
  return project
}

export default whiteboardProjection
