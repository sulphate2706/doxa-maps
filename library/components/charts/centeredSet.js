/**
 * centeredSet.js — the CENTERED-SET TARGET: the cross at the centre, every unreached group
 * placed on a ring by how close it is to a REACHED neighbour, arrows pointing inward.
 *
 * The opposite claim from the bounded set. There the only fact is which side of a line a
 * group is on; here there is no line at all, and the whole content is DISTANCE — which is
 * why the two charts must not look alike.
 *
 * THE RINGS ARE DATA, NOT A DERIVATION. Ring membership is computed at build time by the
 * upg-neighbor build and written into near-neighbors.json as plain COLUMNS on every row:
 * `ring` and `ringNb` (the row index of the reached group that sets it).
 *
 * FOUR OUTCOMES, AND THEY ARE FOUR DIFFERENT FACTS — this is the whole reason the module
 * does not simply bucket everything it cannot place:
 *   ring 1-10  placed, at that distance from the centre; ringNb names the group that places it
 *   ring 0     REACHED. Not unplaced — this group IS the centre, and drawing it as missing
 *              data would report the best outcome as an absence.
 *   ring -1    unreached, no relation found. Genuinely unplaced (11 rows fleet-wide).
 *   no row     not in the source at all. The table cannot carry a row it does not have, so
 *              the CONSUMER counts this at the join and footnotes it — it never reaches here.
 * An earlier build conflated the first two under `ring 0`, and an earlier draft of this file
 * described a separate `rings[u]` map; both notes are kept because the difference matters to
 * anyone decoding the table by hand. An earlier draft of this file described a separate `rings[u]`
 * map; that was the shape before the data owner flattened it, and the note is kept because
 * the difference matters to anyone decoding the table by hand.
 * This module does not re-derive it, and that is deliberate rather than lazy: the ring rule
 * encodes a contested judgement (whether "dialect" means an ISO code or an Ethnologue-strict
 * level) that is the data owner's to make. A second implementation here would be a second
 * answer, and the first symptom would be two charts quietly disagreeing.
 *
 * ★ THE ARROW AND THE RADIUS MUST NAME THE SAME NEIGHBOUR. `ringNb` is the reached row
 * that SET the ring. `links[u][0]` is a different thing — the nearest neighbour on the older
 * E-scale ordering, sorted by believers and distance. They can disagree. Reading the radius
 * from one and the arrow from the other draws a group at ring 3 with an arrow pointing at its
 * ring-8 neighbour, and nothing on screen says so. So this takes both from `rings`.
 *
 * Pure: no Vue, no DOM, no fetch.
 */

/** Rings 1..9 are the dialect/language/family x same/near/different matrix; 10 is beyond. */
export const RING_MIN = 1
export const RING_MAX = 10

/** Deterministic 0..1 from a string, so a group keeps its angle between renders. */
function hash01(s) {
  let h = 2166136261
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/**
 * Place groups on their rings.
 *
 * `groups` are { id, ring, neighborId? }. A group whose ring is absent or outside 1..10 is
 * UNPLACED and returned separately — never defaulted onto the outer ring, because "we do not
 * know how close this group is" and "this group is very far" are different facts and only one
 * of them is about the group. The outermost ring is a real answer and must not double as a
 * bin for missing data.
 */
export const RING_REACHED = 0
export const RING_NO_RELATION = -1

export function layoutCenteredSet(groups, { cx = 0, cy = 0, innerR = 26, ringGap = 24 } = {}) {
  const placed = []
  const unplaced = []
  const centre = []
  for (const g of groups || []) {
    const ring = Number(g?.ring)
    if (ring === RING_REACHED) { centre.push({ ...g, at: 'centre' }); continue }
    if (ring === RING_NO_RELATION) { unplaced.push({ ...g, reason: 'no relation found' }); continue }
    if (!Number.isInteger(ring) || ring < RING_MIN || ring > RING_MAX) {
      unplaced.push({ ...g, reason: g?.ring == null ? 'no ring' : `ring ${g.ring} out of range` })
      continue
    }
    const a = hash01(String(g.id)) * Math.PI * 2
    const r = innerR + (ring - 1) * ringGap
    placed.push({ ...g, ring, angle: a, r, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return { placed, centre, unplaced, cx, cy, innerR, ringGap, radii: ringRadii({ innerR, ringGap }) }
}

/** The radius of each ring, so the chart and its gridlines cannot drift apart. */
export function ringRadii({ innerR = 26, ringGap = 24 } = {}) {
  const out = []
  for (let i = RING_MIN; i <= RING_MAX; i++) out.push({ ring: i, r: innerR + (i - 1) * ringGap })
  return out
}

/** How many groups sit on each ring, including rings with none. `centre` and `unplaced` are
 * reported separately and are never added into a ring. */
export function ringTally(layout) {
  const counts = new Map()
  for (let i = RING_MIN; i <= RING_MAX; i++) counts.set(i, 0)
  for (const p of layout.placed) counts.set(p.ring, counts.get(p.ring) + 1)
  return { counts, placed: layout.placed.length, centre: layout.centre.length, unplaced: layout.unplaced.length }
}

/**
 * The inward arrow for a group: from the group to the centre, stopping at `innerR` so the
 * head does not cover the cross. Returns null when there is no neighbour recorded — an arrow
 * with no named neighbour would imply a relationship the data does not carry.
 */
export function inwardArrow(p, { cx = 0, cy = 0, innerR = 26 } = {}) {
  if (!p || p.neighborId == null) return null
  const len = Math.hypot(p.x - cx, p.y - cy)
  if (!len) return null
  // Stop short of the centre by innerR, so the head points at the cross without covering it.
  const t = innerR / len
  return { x1: p.x, y1: p.y, x2: cx + (p.x - cx) * t, y2: cy + (p.y - cy) * t, neighborId: p.neighborId }
}
