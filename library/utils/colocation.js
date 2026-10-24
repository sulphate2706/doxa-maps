/**
 * colocation.js — which people groups share ONE coordinate on a map (APPROXPIN, 2026-09-26).
 *
 * A people-group pin is a representative point, not an address, and some pins ARE THE SAME POINT:
 * measured on the Doxa roster: 2,107 groups on 2,048 distinct coordinates, 108 groups on
 * a point shared with another (41 pairs, 6 triples, 2 quadruples). Saying "approximate" hides that; naming
 * the co-located groups is the only version a reader can check. The index is built from THE ROSTER THE MAP
 * DRAWS (every map's roster differs), never hardcoded.
 */
const KEY = (lat, lng) => `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`

/** Read [lat, lng] from a roster row or a GeoJSON feature; null when it has no usable position. */
export function pointOf(r) {
  if (!r) return null
  const c = r.geometry && r.geometry.coordinates
  const p = r.properties || r
  const lat = c ? c[1] : (p.latitude ?? p.lat), lng = c ? c[0] : (p.longitude ?? p.lng ?? p.lon)
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat !== '' && lng !== '' ? [Number(lat), Number(lng)] : null
}
export const nameOf = (r) => { const p = (r && (r.properties || r)) || {}; return p.name || p.peopleName || p.PeopNameInCountry || '' }

/** Build once per roster: Map<coordinate key, names[]>, plus `byName` (name -> [[lat, lng, key]]). */
export function buildColocationIndex(rows) {
  const idx = new Map()
  const byName = new Map()
  for (const r of rows || []) {
    const pt = pointOf(r); const n = nameOf(r)
    if (!pt || !n) continue
    const k = KEY(pt[0], pt[1])
    if (!idx.has(k)) idx.set(k, [])
    idx.get(k).push(n)
    if (!byName.has(n)) byName.set(n, [])
    byName.get(n).push([pt[0], pt[1], k])
  }
  idx.byName = byName
  return idx
}

/**
 * The roster key for a selected pin. A click hands over the RENDERED feature, whose geometry the engine
 * rebuilt from tile coordinates, so it is close to the roster's point but not equal to it at six decimals
 * (row 46: a four-group point never matched). So the pin is resolved to its ROSTER ROW by name, and
 * when a name repeats (the same people in several countries) to the nearest of those rows. Only a name the
 * roster does not know falls back to the pin's own coordinate.
 */
function keyFor(idx, row) {
  const pt = pointOf(row)
  const cands = idx.byName && idx.byName.get(nameOf(row))
  if (cands && cands.length) {
    if (cands.length === 1 || !pt) return cands[0][2]
    let best = cands[0], d = Infinity
    for (const c of cands) { const dd = (c[0] - pt[0]) ** 2 + (c[1] - pt[1]) ** 2; if (dd < d) { d = dd; best = c } }
    return best[2]
  }
  return pt ? KEY(pt[0], pt[1]) : null
}

/** The OTHER groups on this row's point ([] when the point is not shared). */
export function colocatedWith(idx, row) {
  if (!idx) return []
  const k = keyFor(idx, row); if (!k) return []
  const me = nameOf(row)
  const all = idx.get(k) || []
  const others = all.filter((n) => n !== me)
  return all.length > 1 ? [...new Set(others)] : []
}
