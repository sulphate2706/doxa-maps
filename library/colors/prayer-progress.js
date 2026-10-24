/**
 * Prayer Progress Color Strategy
 *
 * Three-tier coloring based on prayer coverage:
 *   RED    = Needs Prayer        (peoplePraying === 0 or null)
 *   ORANGE = Has Prayer          (0 < peoplePraying < FULL_PRAYER_THRESHOLD)
 *   GREEN  = Full Prayer Coverage (peoplePraying >= FULL_PRAYER_THRESHOLD)
 *
 * QA Session Round 2 A1: `people_praying` null = 0 = "not prayed for".
 * When someone prays, people_praying updates to a positive integer → orange.
 * When enough people pray (>= threshold) → green.
 */

export const PROPERTY_KEY = 'peoplePraying'

/**
 * Number of people praying required for "Full Prayer Coverage".
 * Set to match the platform's prayer goal (144 people per people group).
 * Adjust this constant to change the green threshold.
 */
export const FULL_PRAYER_THRESHOLD = 144

export const PALETTE = {
  noPrayer:   '#f03b2d', // Red — Needs Prayer (default)
  hasPrayer:  '#f0c64a', // Yellow — Has Prayer (partial); the site's prayer-status yellow
  fullPrayer: '#22c55e'  // Green — Full Prayer Coverage
}

export const PRAYER_COLORS = PALETTE

export const LABELS = {
  noPrayer:   'Needs Prayer',
  hasPrayer:  'Has Prayer',
  fullPrayer: 'Has Full Prayer Coverage'
}

export const PRAYER_LABELS = LABELS

/**
 * Determine prayer level: 'noPrayer' | 'hasPrayer' | 'fullPrayer'
 * @param {Object} properties - Feature properties
 * @returns {'noPrayer'|'hasPrayer'|'fullPrayer'}
 */
export function getPrayerLevel(properties) {
  const peoplePraying = properties?.peoplePraying ?? properties?._raw?.people_praying ?? null
  const count = Number(peoplePraying) || 0
  if (count >= FULL_PRAYER_THRESHOLD) return 'fullPrayer'
  if (count > 0) return 'hasPrayer'
  return 'noPrayer'
}

/**
 * Determine prayer color based on feature properties.
 * @param {Object} properties - Feature properties
 * @returns {string} Color hex code
 */
export function getPrayerColor(properties) {
  return PALETTE[getPrayerLevel(properties)]
}

/**
 * Check if a people group has any prayer (partial or full).
 * @param {Object} properties - Feature properties
 * @returns {boolean}
 */
export function checkHasPrayer(properties) {
  const peoplePraying = properties?.peoplePraying ?? properties?._raw?.people_praying ?? null
  return peoplePraying !== null && peoplePraying > 0
}

/**
 * Check if a people group has full prayer coverage.
 * @param {Object} properties - Feature properties
 * @returns {boolean}
 */
export function checkHasFullPrayer(properties) {
  return getPrayerLevel(properties) === 'fullPrayer'
}

/**
 * Strategy-aligned getter — uniform name across all per-strategy modules.
 */
export function getColor(properties) {
  return getPrayerColor(properties)
}

/**
 * Build Mapbox color expression for prayer progress (3-tier).
 * @param {{ colorSource?: 'properties'|'feature-state' }} [options]
 *   'properties'    — reads from GeoJSON feature properties (initial load)
 *   'feature-state' — reads from Mapbox feature-state (polling updates, per-pin)
 */
export function applyColor({ colorSource = 'properties' } = {}) {
  const valueExpr = colorSource === 'feature-state'
    ? ['feature-state', 'peoplePraying']
    : ['get', 'peoplePraying']

  return [
    'case',
    // peoplePraying >= FULL_PRAYER_THRESHOLD → Green (full prayer coverage)
    ['>=', valueExpr, FULL_PRAYER_THRESHOLD],
    PALETTE.fullPrayer,
    // peoplePraying > 0 → Orange (has prayer, partial)
    ['>', valueExpr, 0],
    PALETTE.hasPrayer,
    // Default: null / 0 → Red (needs prayer)
    PALETTE.noPrayer
  ]
}

// Back-compat alias — some callers use the buildColorExpression name.
export const buildColorExpression = applyColor

export default {
  name: 'Prayer Progress',
  propertyKey: PROPERTY_KEY,
  palette: PALETTE,
  colors: PALETTE,
  labels: LABELS,
  threshold: FULL_PRAYER_THRESHOLD,
  getColor,
  applyColor,
  buildColorExpression,
  getPrayerLevel,
  getPrayerColor,
  checkHasPrayer,
  checkHasFullPrayer
}
