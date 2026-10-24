/**
 * rings.js — the centered-set target: how close each unreached group sits to a REACHED group.
 *
 * Pure functions over UPG-neighbor's decoded rows (nearData.js field names), so the build, gospel's
 * chart and upg100's packet all place a group the same way. Rings, inner to outer:
 *   1-3  same DIALECT       (same LanguageCode, ISO 639-3)        × culture same / near / different
 *   4-6  same LANGUAGE      (same LanguageName root, "Arabic, Egyptian" -> arabic)   × culture
 *   7-9  same FAMILY        (same LanguageFamily)                 × culture
 *   10   geography only     (same country, or within nearKm)
 *   0    no relation found
 * Culture: same = same ROP25 people (`ethne`), near = same ROP2 people cluster, different = otherwise.
 *
 * These are PROXIES. The source has no level below ISO 639-3, so "dialect" is the ISO code and
 * "language" is the shared name root. IMB's people taxonomy stands in for culture.
 */

export const RINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
export const NEAR_KM = 600
const HALF_KM = 500

export const langRoot = (name) => String(name || '').split(',')[0].trim().toLowerCase()

const RAD = Math.PI / 180
export function km(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

const culture = (u, r) => (u.ethne && u.ethne === r.ethne ? 1 : u.cluster && u.cluster === r.cluster ? 2 : 3)

/** The ring between one unreached group u and one reached group r: 1..10, or 0 for no relation. */
export function ringOf(u, r, { nearKm = NEAR_KM } = {}) {
  if (u.lang && u.lang === r.lang) return culture(u, r)
  const root = langRoot(u.langName)
  if (root && root === langRoot(r.langName)) return 3 + culture(u, r)
  if (u.family && u.family === r.family) return 6 + culture(u, r)
  return (u.iso3 && u.iso3 === r.iso3) || km(u, r) <= nearKm ? 10 : 0
}

/** Index the reached groups once, so closestReached only scans real candidates. */
export function indexReached(reached) {
  const add = (m, k, g) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(g) }
  const idx = { all: reached, lang: new Map(), root: new Map(), family: new Map() }
  for (const g of reached) { add(idx.lang, g.lang, g); add(idx.root, langRoot(g.langName), g); add(idx.family, g.family, g) }
  return idx
}

// Among neighbors in the same ring: more believers first, discounted by distance (halved at ~500 km),
// the same gravity UPG-neighbor ranks its links by.
const gravity = (u, r) => (r.believers || 0) / (1 + (km(u, r) / HALF_KM) ** 2)

/**
 * The closest reached neighbor of u: the lowest ring, ties broken by gravity.
 * Returns { ring, neighbor } — ring 0 and neighbor null when nothing relates.
 */
export function closestReached(u, idx, opts = {}) {
  const pools = [idx.lang.get(u.lang), idx.root.get(langRoot(u.langName)), idx.family.get(u.family)]
  let best = null, bestRing = 0, bestScore = -1
  const consider = (r) => {
    if (r === u) return
    const ring = ringOf(u, r, opts)
    if (!ring) return
    const s = gravity(u, r)
    if (!best || ring < bestRing || (ring === bestRing && s > bestScore)) { best = r; bestRing = ring; bestScore = s }
  }
  // The first pool with any member decides the band (dialect < language < family); scan it only.
  const pool = pools.find((p) => p && p.length)
  for (const r of pool || idx.all) consider(r)
  return { ring: bestRing, neighbor: best }
}

/**
 * Per-ring counts for any set of groups (a UPG-100 list, a fork's own set):
 * { 1: n, …, 10: n, none: n }. `none` = no relation found; it is never a ring.
 */
export function ringCounts(groups, ringFor) {
  const out = Object.fromEntries([...RINGS, 'none'].map((r) => [r, 0]))
  for (const g of groups) { const r = ringFor(g); out[r >= 1 && r <= 10 ? r : 'none']++ }
  return out
}
