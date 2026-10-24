/**
 * frame-target.js — what camera move frames a set of points, decided purely so it can be tested.
 *
 * ★ EVERY NUMBER HERE WAS TUNED AND NONE OF THEM WAS WRITTEN DOWN. Extracted from gospel-internet's
 * GiTree, whose maintainer inherited the file and had to reverse-engineer intent from structure: there
 * is no "this took measuring" note anywhere in it. They named this function as the one to pin. So the
 * values move here with their reasons attached, and a test asserts them, because the next person
 * should not have to guess what a 60 was for.
 *
 * ★ THE REDUCED-MOTION BRANCH IS A DIFFERENT CALL, NOT A FASTER ONE. Under reduced motion the camera
 * JUMPS; it does not animate with duration 0. A refactor that "simplifies" this to easeTo({duration:0})
 * is NOT equivalent — it is an animation of zero length, and the engines do not treat the two the same.
 * This is the specific thing gospel asked to have pinned hardest.
 *
 * ★ AND A SINGLE POINT TAKES A DIFFERENT BRANCH FROM A SET. fitBounds on a degenerate box — one point,
 * or a subtree of coincident points — has no extent to fit, so it zooms to nothing. A one-language
 * family is a real case, not a pathological one, so it is centred at a floor zoom instead. Collapsing
 * these two branches is the other thing gospel flagged.
 *
 * Pure: no map, no refs, no DOM. The caller applies the returned instruction.
 */

/**
 * @param {Array<[number, number]>} coords lng/lat pairs to frame
 * @param {Object} [o]
 * @param {boolean} [o.reducedMotion]  jump instead of animating
 * @param {number}  [o.currentZoom]    used as the floor for a single point, so framing never zooms OUT
 * @param {number}  [o.padding]        px of breathing room around a fitted box
 * @param {number}  [o.maxZoom]        how far a fit may zoom IN on a tight cluster
 * @param {number}  [o.duration]       animation ms when motion is allowed
 * @param {number}  [o.pointZoom]      floor zoom for the single-point branch
 * @param {number}  [o.epsilon]        below this extent (degrees) a box counts as a single point
 * @returns {null | { kind: 'point', center: [number, number], zoom: number, duration: number, essential: true }
 *                 | { kind: 'bounds', bounds: [[number, number], [number, number]], padding: number,
 *                     maxZoom: number, duration: number, essential: true }}
 *          null when there is nothing to frame — the caller must then leave the camera ALONE rather
 *          than moving it somewhere neutral, which is a motion the reader did not ask for.
 */
export function frameTarget(coords, {
  reducedMotion = false,
  currentZoom = 0,
  // 60px: the fitted box is a SUBTREE, and its outermost nodes carry labels that extend beyond the
  // point itself. Without padding the edge labels are clipped by the viewport they were just fitted to.
  padding = 60,
  // 8: a family of one or two languages fits at a zoom where the tapestry around it is gone and the
  // reader loses where they are. The cap keeps the neighbourhood in frame.
  maxZoom = 8,
  // 900ms: long enough to read as a movement between two places rather than a cut.
  duration = 900,
  // 6: never zoom OUT to frame a single point — max() with the current zoom below.
  pointZoom = 6,
  epsilon = 1e-4,
} = {}) {
  if (!Array.isArray(coords) || !coords.length) return null
  let w = 180, s = 90, e = -180, n = -90
  for (const c of coords) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue
    w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1])
  }
  if (!(e >= w && n >= s)) return null
  const ms = reducedMotion ? 0 : duration
  if (e - w < epsilon && n - s < epsilon) {
    return { kind: 'point', center: [w, s], zoom: Math.max(currentZoom, pointZoom), duration: ms, essential: true }
  }
  return { kind: 'bounds', bounds: [[w, s], [e, n]], padding, maxZoom, duration: ms, essential: true }
}

/**
 * Apply an instruction to a map. Kept beside the decision so the JUMP-vs-ANIMATE rule has exactly one
 * implementation: duration 0 means jumpTo, never easeTo with a zero duration.
 */
export function applyFrame(map, target) {
  if (!map || !target) return false
  try {
    if (target.kind === 'point') {
      if (target.duration) map.easeTo({ center: target.center, zoom: target.zoom, duration: target.duration, essential: true })
      else map.jumpTo({ center: target.center, zoom: target.zoom })
      return true
    }
    map.fitBounds(target.bounds, {
      padding: target.padding, maxZoom: target.maxZoom, duration: target.duration, essential: true,
    })
    return true
  } catch (_) {
    // A degenerate frame never breaks the board.
    return false
  }
}

export default frameTarget
