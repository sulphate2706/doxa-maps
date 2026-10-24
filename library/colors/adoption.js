/**
 * Adoption Color Strategy
 *
 * Binary: Red (not adopted) / Neon green (has adoption).
 * Reads `adoptionStatus` (boolean) normalized from `adopted_by_churches > 0`.
 * Transparent circles — overlap accumulates darker.
 *
 * Sourced from doxa-research-mfe (research wins on drift).
 */

export const PROPERTY_KEY = 'adoptionStatus'

export const PALETTE = {
  notAdopted:  '#f03b2d', // Red — unified with PRAYER_COLORS.noPrayer
  hasAdoption: '#22c55e'  // Bright green — easier to see on the adoption map
}

export const ADOPTION_COLORS = PALETTE

export const LABELS = {
  notAdopted: 'Needs Adoption',
  hasAdopted: 'Has Adoption'
}

export const ADOPTION_LABELS = LABELS

export function getColor(properties) {
  const val = properties.adoptionStatus ?? properties._raw?.adopted_by_churches
  const adopted = val === true || val === 1 || (typeof val === 'number' && val > 0)
    || (typeof val === 'object' && val?.value)
  return adopted ? PALETTE.hasAdoption : PALETTE.notAdopted
}

export function applyColor({ colorSource = 'properties' } = {}) {
  const valueExpr = colorSource === 'feature-state'
    ? ['feature-state', 'adoptionStatus']
    : ['get', 'adoptionStatus']

  return [
    'case',
    ['==', valueExpr, true], PALETTE.hasAdoption,
    ['==', valueExpr, 1],    PALETTE.hasAdoption,
    PALETTE.notAdopted
  ]
}

export const buildColorExpression = applyColor

export default {
  name: 'Adoption Progress',
  propertyKey: PROPERTY_KEY,
  palette: PALETTE,
  colors: PALETTE,
  labels: LABELS,
  getColor,
  applyColor,
  buildColorExpression
}
