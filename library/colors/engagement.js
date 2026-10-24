/**
 * Engagement Color Strategy
 *
 * Binary: Red (not engaged) / Neon green (has engagement).
 * Reads `engagementStatus` (boolean) normalized from `people_committed > 0`.
 * Transparent circles — overlap accumulates darker.
 *
 * Sourced from doxa-research-mfe (research wins on drift).
 */

export const PROPERTY_KEY = 'engagementStatus'

export const PALETTE = {
  notEngaged:    '#f03b2d', // Red — unified with PRAYER_COLORS.noPrayer
  hasEngagement: '#22c55e'  // Neon green — high contrast against unengaged pins (UX request 2026-04-26)
}

export const ENGAGEMENT_COLORS = PALETTE

export const LABELS = {
  notEngaged:    'Unengaged',
  hasEngagement: 'Engaged'
}

export const ENGAGEMENT_LABELS = LABELS

export function getColor(properties) {
  const val = properties.engagementStatus ?? properties._raw?.people_committed
  const engaged = val === true || val === 1 || (typeof val === 'number' && val > 0)
    || (typeof val === 'object' && val?.value)
  return engaged ? PALETTE.hasEngagement : PALETTE.notEngaged
}

export function applyColor({ colorSource = 'properties' } = {}) {
  const valueExpr = colorSource === 'feature-state'
    ? ['feature-state', 'engagementStatus']
    : ['get', 'engagementStatus']

  // engagementStatus is a boolean stored as 0/1 or true/false
  return [
    'case',
    ['==', valueExpr, true], PALETTE.hasEngagement,
    ['==', valueExpr, 1],    PALETTE.hasEngagement,
    PALETTE.notEngaged
  ]
}

export const buildColorExpression = applyColor

export default {
  name: 'Engagement Progress',
  propertyKey: PROPERTY_KEY,
  palette: PALETTE,
  colors: PALETTE,
  labels: LABELS,
  getColor,
  applyColor,
  buildColorExpression
}
