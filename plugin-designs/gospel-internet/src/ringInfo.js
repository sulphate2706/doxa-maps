/**
 * ringInfo.js — what each ring of the centered-set target MEANS, in one place, so the chart and its
 * legend label, colour and explain a ring the same way.
 *
 * The rings are the data owner's (upg-neighbor writes `ring` onto near-neighbors.json). This file
 * only names them. Rings 1-9 are a 3 × 3 grid:
 *     rows    = how much LANGUAGE the group shares with its closest reached neighbour
 *               dialect (same ISO 639-3 code) · language (same language name) · family
 *     columns = how close the CULTURE is
 *               same (the same people) · near (the same IMB people cluster) · different
 * and ring 10 is geography only (same country, or within 600 km). Ring = 1 + 3 × row + column.
 *
 * Colour: one hue per language row, darkest for the same culture, so a reader sees both axes of
 * the grid in the swatch alone. Pure: no Vue, no DOM.
 */

export const BANDS = ['dialect', 'language', 'family']
export const CULTURES = ['same', 'near', 'different']

const HUES = { dialect: ['#1b5e20', '#43a047', '#a5d6a7'], language: ['#0d47a1', '#1e88e5', '#90caf9'],
  family: ['#4a148c', '#8e24aa', '#ce93d8'] }
export const GEO_COLOR = '#9e9e9e'
export const CENTRE_COLOR = '#3b463d'

/** { ring, band, culture, color } for ring 1..10, or null. */
export function ringInfo(ring) {
  const n = Number(ring)
  if (n === 10) return { ring: 10, band: 'geography', culture: null, color: GEO_COLOR }
  if (!Number.isInteger(n) || n < 1 || n > 9) return null
  const row = Math.floor((n - 1) / 3), col = (n - 1) % 3
  return { ring: n, band: BANDS[row], culture: CULTURES[col], color: HUES[BANDS[row]][col] }
}

/** The ring for a grid cell (band, culture); geography → 10. */
export function ringFor(band, culture) {
  if (band === 'geography') return 10
  return 1 + 3 * BANDS.indexOf(band) + CULTURES.indexOf(culture)
}

/**
 * Per-ring counts plus one real example per ring, from the chart's own joined groups
 * ({ ring, label, neighborId }), so the legend's numbers are the chart's numbers.
 */
export function ringSummary(groups) {
  const out = { centre: 0, unplaced: 0, byRing: {} }
  for (let r = 1; r <= 10; r++) out.byRing[r] = { count: 0, example: null }
  for (const g of groups || []) {
    const r = Number(g?.ring)
    if (r === 0) { out.centre++; continue }
    if (!(r >= 1 && r <= 10)) { out.unplaced++; continue }
    const b = out.byRing[r]
    b.count++
    if (!b.example && g.neighborId) b.example = { label: g.label, neighbor: g.neighborId }
  }
  return out
}
