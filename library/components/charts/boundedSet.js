/**
 * boundedSet.js — the bounded-set layout: reached INSIDE the circle, unreached OUTSIDE.
 *
 * The point of a bounded set is the BOUNDARY: a group is in or it is out, and the
 * picture should make that binary obvious rather than pretty. So position carries no
 * meaning here beyond the side of the line — there is no gradient, no distance, no
 * ranking. That is the whole claim the chart makes, and the centered-set target is
 * the chart that makes the opposite one.
 *
 * ⚠ REACHED-NESS IS NOT IN THE DASHBOARD ROWS. gospel-internet rows describe internet
 * and language access; `reached` lives in near-neighbors.json (EvangelicalLevel >= 2%,
 * the IMB definition). So the caller joins, and this module takes the answer as a
 * ★ AND UNKNOWN IS COUNTED, NOT HIDDEN. A printed page has no hover, so a category the reader
 * cannot see is a category the reader will assume is zero. Every consumer of this layout must ink
 * the unknown tally, which is why boundedSetTally returns it rather than leaving it derivable.
 *
 * boolean it does not second-guess. A group whose reached-ness is UNKNOWN is its own
 * outcome — it is not quietly counted as unreached, because "we did not find it" and
 * "it is outside" are different facts and only one of them is about the group.
 *
 * Pure. No Vue, no DOM, no fetch — the layout is testable without mounting anything.
 */

/** Deterministic 0..1 from a string, so a group sits in the same place on every render. */
function hash01(s) {
  let h = 2166136261
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/**
 * Lay groups out around a circle of radius `r` centred at (cx, cy).
 *
 * Inside points are placed within 0.92r so they never graze the boundary; outside
 * points sit between 1.12r and `spread`. The gap on each side is deliberate — a dot
 * ON the line would be the one thing a bounded set cannot express.
 */
export function layoutBoundedSet(groups, { cx = 0, cy = 0, r = 100, spread = 220, key = (g) => g.id } = {}) {
  const inside = []
  const outside = []
  const unknown = []
  for (const g of groups || []) {
    const id = key(g)
    const a = hash01(id) * Math.PI * 2
    const t = hash01(id + '|r')
    if (g.reached === true) {
      const rad = Math.sqrt(t) * r * 0.92
      inside.push({ ...g, id, x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad, side: 'in' })
    } else if (g.reached === false) {
      const rad = r * 1.12 + t * (spread - r * 1.12)
      outside.push({ ...g, id, x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad, side: 'out' })
    } else {
      unknown.push({ ...g, id, side: 'unknown' })
    }
  }
  return { inside, outside, unknown, cx, cy, r }
}

/** The counts a caption should quote. `unknown` is reported, never folded into `outside`. */
export function boundedSetTally(layout) {
  return {
    inside: layout.inside.length,
    outside: layout.outside.length,
    unknown: layout.unknown.length,
    total: layout.inside.length + layout.outside.length + layout.unknown.length,
  }
}
