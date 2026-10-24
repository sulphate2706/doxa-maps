/**
 * setChartFeatures.js — the set charts as TIERED POINTS, in abstract coordinates.
 *
 * The shared whiteboard layer draws a point FeatureCollection where each feature carries an id,
 * a label, a tier and a priority `k`, and stages its label layers by tier and zoom. This turns
 * my two layouts into that shape. It decides WHICH features exist, what tier each belongs to and
 * how they rank against each other — which is mine — and it does NOT project.
 *
 * ★ COORDINATES OUT ARE ABSTRACT (u, v), NOT DEGREES, AND THAT IS DELIBERATE. Converting to
 * lng/lat is a PROJECTION, not a scale: the whiteboard's inverse-Mercator shrinks the degree
 * height as you move out so the map's own 1/cos(lat) stretch cancels it. A linear scale skips
 * that cancellation and the error grows outward — 1.0154x at 10 degrees, 1.0642x at 20, 1.1547x
 * at 30. For concentric rings that renders as vertical OVALS, worst at the outer ring where the
 * labels sit, and it looks plausible enough to waste an afternoon on. So the caller passes these
 * through the shared projection with the chart's extent; this module never guesses at degrees.
 *
 * Extents (the caller's one number): centered set 228 = innerR 30 + 9 x ringGap 22; bounded 260.
 */
import { ringInfo } from './ringInfo.js'

/** Tier names, outermost-first in label priority: bands read zoomed out, groups zoomed in. */
export const TIERS = { BAND: 'band', RING: 'ring', GROUP: 'group' }

/**
 * The centered-set target as tiered points.
 *
 * `placed` are laid-out groups ({ id, label, ring, x, y }); `radii` is ringRadii()'s output, so
 * the ring and band labels sit on the SAME radii the chart draws rather than on a second
 * calculation that could drift from it.
 *
 * `k` is the priority the shared layer sorts labels by. Groups rank by population, so when two
 * names collide the bigger people wins — a reader zoomed out should see the names that carry the
 * most people, not whichever happened to be drawn first. Bands and rings outrank every group.
 */
export function centeredSetFeatures(placed, radii, { bandLabel, ringLabel, population } = {}) {
  const out = []
  for (const p of placed || []) {
    out.push({ id: p.id, label: p.label, tier: TIERS.GROUP, ring: p.ring,
      k: Number(population?.(p) ?? 0), u: p.x, v: p.y })
  }
  // One label per ring, placed on the ring itself at a fixed angle so it does not wander between
  // renders. Rings outrank groups; the inner rings outrank the outer, because a reader zooming in
  // meets them in that order.
  for (const { ring, r } of radii || []) {
    const info = ringInfo(ring)
    if (!info) continue
    out.push({ id: `ring-${ring}`, label: ringLabel?.(ring) ?? `Ring ${ring}`, tier: TIERS.RING,
      ring, k: 1e9 - ring, u: 0, v: -r })
  }
  // One label per band, at the outer edge of the band's own rings.
  const bands = new Map()
  for (const { ring, r } of radii || []) {
    const info = ringInfo(ring)
    if (!info) continue
    const cur = bands.get(info.band)
    if (!cur || r > cur) bands.set(info.band, r)
  }
  for (const [band, r] of bands) {
    out.push({ id: `band-${band}`, label: bandLabel?.(band) ?? band, tier: TIERS.BAND,
      k: 2e9, u: 0, v: -r })
  }
  return out
}

/**
 * The bounded set as tiered points, plus the boundary circle as a dish.
 *
 * ★ THE GAP EITHER SIDE OF THE BOUNDARY IS THE CHART'S ONE CLAIM and it must survive projection:
 * inside points sit within 0.92r, outside beyond 1.12r, and nothing may land ON the line — a dot
 * on the boundary is the one thing a bounded set cannot express. The dish radius is the boundary
 * itself, so the caller projects all three consistently or the gap closes on one side.
 */
export function boundedSetFeatures(layout, { label, population } = {}) {
  const out = []
  for (const side of ['inside', 'outside']) {
    for (const p of layout?.[side] || []) {
      out.push({ id: p.id, label: label?.(p) ?? p.label, tier: TIERS.GROUP, side,
        k: Number(population?.(p) ?? 0), u: p.x, v: p.y })
    }
  }
  return { features: out, dish: { u: layout?.cx ?? 0, v: layout?.cy ?? 0, r: layout?.r ?? 0 } }
}

/**
 * Project abstract (u, v) features into a GeoJSON point collection for the whiteboard layer.
 *
 * `project` is the shared whiteboardProjection for this chart's extent. It is passed in rather
 * than built here so the chart and its checks use ONE projection instance, and so this module
 * still owes nothing to a coordinate system it does not define.
 *
 * ⚠ THE LATITUDE CEILING IS THE REAL LIMIT, not shape. The projection is the exact inverse of
 * the renderer's transform, so a circle stays a circle at every extentFraction — measured at
 * 0.000% aspect error. What DOES bite is how close to the pole the drawing lands: at extent 260
 * the outermost point reaches 52 degrees at the default 0.17, 77 at 0.35, 83 at 0.45, and Web
 * Mercator is undefined at the poles with engines clamping near 85. So a caller that widens
 * extentFraction to let readers zoom out further runs into the clamp, not into distortion.
 * `maxAbsLat` reports it so a check can assert the drawing stays inside that range.
 */
export function toFeatureCollection(features, project) {
  let maxAbsLat = 0
  const out = []
  for (const f of features || []) {
    const [lng, lat] = project(f.u, f.v)
    if (Math.abs(lat) > maxAbsLat) maxAbsLat = Math.abs(lat)
    const { u, v, ...props } = f
    out.push({ type: 'Feature', id: f.id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props })
  }
  return { collection: { type: 'FeatureCollection', features: out }, maxAbsLat }
}

/**
 * A radius in DEGREES for the dish, from a radius in layout units.
 *
 * The dish is a circle-radius in the paint, so it needs the projection's scale rather than a
 * projected point. project.K is exposed for exactly this; deriving it by projecting two points
 * and subtracting would be right along the equator and wrong everywhere else.
 */
export function dishRadiusDegrees(r, project) {
  return Number(r || 0) * (project?.K ?? 0) * 360
}

/**
 * A zoom expression that keeps a radius fixed in MAP units while the paint wants PIXELS.
 *
 * ★ circle-radius IS SCREEN PIXELS, and for the bounded set's boundary that is the wrong unit.
 * A fixed pixel radius stays the same size on screen while the dots spread out from under it as
 * the reader zooms — the circle would be right at exactly one zoom level and wrong at every
 * other, with the inside/outside reading silently inverting for dots near the edge.
 *
 * The world is 512 x 2^zoom pixels across 360 degrees, so pixels-per-degree doubles with every
 * zoom level — measured exactly 2.000000 between adjacent levels. An exponential-base-2
 * interpolation therefore tracks map units exactly rather than approximately, with two stops.
 */
export function degreesToPixelRadius(degrees, { minZoom = 0, maxZoom = 22 } = {}) {
  const px = (z) => Number(degrees || 0) * 512 * Math.pow(2, z) / 360
  return ['interpolate', ['exponential', 2], ['zoom'], minZoom, px(minZoom), maxZoom, px(maxZoom)]
}

export function crossFeature(project, { arm = 13, cx = 0, cy = 0 } = {}) {
  // ★ +v IS NORTH, NOT DOWN. The projection computes Y = 0.5 - v*K, so a LARGER v is a HIGHER
  // latitude. An earlier version named its parts "upper" and "lower" on the screen convention
  // where +y goes down, and therefore drew the LONG arm upward — an inverted cross, which is a
  // different symbol rather than a cosmetic slip. Named by compass here so the mistake cannot be
  // made silently again: `north` is toward the top of the drawing.
  const H = arm * 2.2
  const north = cy + H * 0.35          // the short arm, above the bar
  const south = cy - H * 0.65          // the long arm, below it
  const barV = cy + H * 0.18           // the bar sits high, nearer the top than the middle
  const barHalf = arm * 0.62
  const vert = [[cx, north], [cx, south]].map(([u, v]) => project(u, v))
  const horiz = [[cx - barHalf, barV], [cx + barHalf, barV]].map(([u, v]) => project(u, v))
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { part: 'v' }, geometry: { type: 'LineString', coordinates: vert } },
      { type: 'Feature', properties: { part: 'h' }, geometry: { type: 'LineString', coordinates: horiz } },
    ],
  }
}

/**
 * Draw the cross on a whiteboard map, as a LINE layer over the points.
 *
 * ★ line-cap AND line-join ARE LAYOUT, NOT PAINT. Put either in `paint` and addLayer THROWS, and if
 * the call sits inside a silent try/catch the chart simply renders without its cross — which is how
 * this went missing once already. The failure is reported rather than swallowed for the same reason.
 */
export function addCrossLayer(map, project, id, { arm = 13, color = '#3b463d', width = 3 } = {}) {
  try {
    if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(id)) map.removeSource(id)
    map.addSource(id, { type: 'geojson', data: crossFeature(project, { arm }) })
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'square', 'line-join': 'miter' },
      paint: { 'line-color': color, 'line-width': width },
    })
    return true
  } catch (e) {
    console.warn(`[set-charts] the cross layer "${id}" did not draw:`, e && e.message)
    return false
  }
}
