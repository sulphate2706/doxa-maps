/**
 * DOXA Region Color Strategy
 *
 * Colors pins based on their DOXA / WAGF region.
 *
 * Drift note (vs simple-map):
 *   - simple-map's 'No WAGF Region/Bloc' = '#95a5a6' (grey),
 *     research = '#1a1a2e' (deep navy). Research wins.
 *
 * generateColorFromString fallback comes from utils/geoUtils.js — sister
 * subagent 1D owns that file. Cross-folder dep flagged.
 */

import { generateColorFromString } from '@map/utils/geoUtils.js'

export const PROPERTY_KEY = 'doxaRegion'

const DEFAULT_COLOR = '#0098FF' // Bright blue for null/undefined region
const FALLBACK_COLOR = '#95a5a6'

/**
 * DOXA Region Color Palette — defines colors for the 8 DOXA regions.
 */
export const PALETTE = {
  'Africa': '#ff2e2e',
  'Asia': '#1a8cff',
  'Europe': '#1ee05f',
  'Latin America & Caribbean': '#FFEB3B',
  'Middle East': '#a83dff',
  'No WAGF Region/Bloc': '#1a1a2e',
  'North America & Non-Spanish Caribbean': '#00e0bd',
  'Oceania': '#ff7f11'
}

export const DOXA_REGION_COLORS = PALETTE

/**
 * SLUG-keyed palette — the AUTHORITATIVE map for coloring.
 *
 * The pray-tools API returns wagf_region as { value: <slug>, label: <localized> }.
 * DSM stores the stable slug in properties.doxaRegion (e.g. 'asia', 'middle_east').
 * The label is localized per `lang` ("Africa" → "África" → "Afrique"), so keying
 * colors on the display name silently breaks in every non-English locale (only
 * "Asia" — spelled identically across es/fr — survives). Key on the slug instead.
 * Slugs verified against the live API (2026-06-22).
 */
export const SLUG_PALETTE = {
  'africa':                                '#ff2e2e',
  'asia':                                  '#1a8cff',
  'europe':                                '#1ee05f',
  'latin_america_&_caribbean':             '#FFEB3B',
  'middle_east':                           '#a83dff',
  'north_america_&_non-spanish_caribbean': '#00e0bd',
  'oceania':                               '#ff7f11',
  'na':                                    '#1a1a2e'  // No WAGF Region/Bloc
}

/** Color for a region by its stable slug (locale-independent). */
export function getRegionColorBySlug(slug) {
  if (!slug) return DEFAULT_COLOR
  return SLUG_PALETTE[String(slug).toLowerCase()] || FALLBACK_COLOR
}

/** Extended region aliases for flexible matching */
export const REGION_COLOR_ALIASES = {
  'Africa': '#ff2e2e',
  'East Asia': '#1a8cff',
  'Asia': '#1a8cff',
  'Eurasia': '#1ee05f',
  'Europe': '#1ee05f',
  'Latin America': '#FFEB3B',
  'Latin America & Caribbean': '#FFEB3B',
  'Caribbean': '#FFEB3B',
  'Middle East': '#a83dff',
  'North America': '#00e0bd',
  'North America (non-spanish)': '#00e0bd',
  'North America & Non-Spanish Caribbean': '#00e0bd',
  'Pacific': '#ff7f11',
  'Oceania': '#ff7f11',
  'South Asia': '#ff7f11',
  'No WAGF Region/Bloc': '#1a1a2e',
  'Unknown': '#0098FF'
}

/**
 * Get color for a region — falls back to a deterministic
 * generateColorFromString() so unmapped regions still render.
 */
export function getRegionColor(regionName) {
  if (!regionName) {
    return DEFAULT_COLOR
  }

  const color = REGION_COLOR_ALIASES[regionName]
  if (!color) {
    return generateColorFromString(regionName)
  }

  return color
}

export function getColor(properties) {
  // properties.doxaRegion is the stable slug (e.g. 'asia'), NOT the localized
  // label — color by slug so it survives language switches.
  const slug = properties.doxaRegion || properties._normalized?.doxaRegion
  return getRegionColorBySlug(slug)
}

/**
 * Build Mapbox color expression for DOXA regions.
 *
 * Matches on the stable slug stored in `doxaRegion` (e.g. 'asia') so the
 * expression keeps coloring correctly when the API returns localized labels.
 */
export function applyColor() {
  const colorExpression = ['match', ['get', PROPERTY_KEY]]
  Object.entries(SLUG_PALETTE).forEach(([slug, color]) => {
    colorExpression.push(slug, color)
  })
  colorExpression.push(FALLBACK_COLOR)
  return colorExpression
}

export const buildColorExpression = applyColor

export default {
  name: 'DOXA Region',
  propertyKey: PROPERTY_KEY,
  palette: PALETTE,
  colors: PALETTE,
  slugColors: SLUG_PALETTE,
  aliases: REGION_COLOR_ALIASES,
  fallback: FALLBACK_COLOR,
  getColor,
  applyColor,
  buildColorExpression,
  getRegionColor,
  getRegionColorBySlug
}
