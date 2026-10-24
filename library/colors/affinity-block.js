/**
 * Affinity Block Color Strategy
 *
 * Colors pins based on their ROP1 code (A001, A002, etc.).
 * Uses ROP1 code as the primary key for consistency across data sources.
 *
 * ARCHITECTURE DECISION:
 * - Use ROP1 codes (A001, A002, etc.) as the PRIMARY KEY
 * - Store mappings from ROP1 → Name and ROP1 → Color
 * - Avoids issues with typos in affinity bloc names
 */

export const PROPERTY_KEY = 'affinityBlock' // This is the ROP1 code

const DEFAULT_COLOR = '#95a5a6'

/** Primary mapping: ROP1 Code → Affinity Block Name */
export const AFFINITY_BLOCK_NAMES = {
  'A001': 'Arab World',
  'A002': 'East Asian Peoples',
  'A003': 'Eurasian Peoples',
  'A004': 'Horn of Africa Peoples',
  'A005': 'Jewish',
  'A006': 'Malay Peoples',
  'A007': 'Persian-Median Peoples',
  'A008': 'South Asian Peoples',
  'A009': 'North American Peoples',
  'A010': 'Pacific Islanders',
  'A011': 'Southeast Asian Peoples',
  'A012': 'Sub-Saharan Peoples',
  'A013': 'Tibetan-Himalayan Peoples',
  'A014': 'Turkic Peoples',
  'A015': 'Latin-Caribbean Americans',
  'A017': 'Deaf',
  // A018/A019 are LIVE on the pray-tools API but were absent here, so 134 rows (6.4% of
  // 2,107, measured 2026-09-22) fell through to the grey fallback and rendered as
  // uncoloured rows in the semantic tree legend — the "bunch of grey colours" reported.
  // Names are the API's OWN rop1 labels, not invented: A018 -> "Tibetan Peoples"
  // (102 rows), A019 -> "Himalayan Peoples" (32 rows).
  'A018': 'Tibetan Peoples',
  'A019': 'Himalayan Peoples'
}

/** Primary mapping: ROP1 Code → Color */
// ★ REJECTED CANDIDATE, RECORDED ABOVE THE PALETTE DELIBERATELY: #AF7AC5 was considered for A019
// and scored 2.95 against the Material Light surface, just under WCAG 1.4.11's 3.0:1 non-text floor.
// It lives here rather than beside A019 because check:one-palette slices from `export const PALETTE`
// to END OF FILE and matches every hex it finds -- so a rejected colour mentioned BELOW the export
// would be demanded of every consumer bundle, and the gate would fail on a colour we refused on
// accessibility grounds. Keeping the note above the export preserves the reasoning without
// creating that obligation. (The gate's own comment says it reads "only the PALETTE export"; its
// implementation does not, which is reported separately.)
export const PALETTE = {
  'A001': '#E74C3C',  // Arab World - Red/Orange
  'A002': '#3498DB',  // East Asian Peoples - Blue
  'A003': '#2ECC71',  // Eurasian Peoples - Green
  'A004': '#F39C12',  // Horn of Africa Peoples - Orange
  'A005': '#9B59B6',  // Jewish - Purple
  'A006': '#1ABC9C',  // Malay Peoples - Teal
  'A007': '#E67E22',  // Persian-Median Peoples - Dark orange
  'A008': '#34495E',  // South Asian Peoples - Dark blue-grey
  'A009': '#95A5A6',  // North American Peoples - Grey
  'A010': '#5DADE2',  // Pacific Islanders - Light blue
  'A011': '#16A085',  // Southeast Asian Peoples - Sea green
  'A012': '#C0392B',  // Sub-Saharan Peoples - Deep red
  'A013': '#8E44AD',  // Tibetan-Himalayan Peoples - Purple
  'A014': '#D35400',  // Turkic Peoples - Burnt orange
  'A015': '#27AE60',  // Latin-Caribbean Americans - Forest green
  'A017': '#000000',  // Deaf - Black (universal accessibility)
  // ── A018 / A019: the Tibetan-Himalayan SPLIT ────────────────────────────────
  // These two are not new peoples — they are the finer-grained split of A013
  // 'Tibetan-Himalayan Peoples'. They therefore keep A013's PURPLE identity and vary
  // only in value, so the three read as one family at a glance instead of as three
  // unrelated hues. Chosen by measurement against the Material Light surface #f3f3f1
  // (WCAG 2.1 SC 1.4.11 non-text minimum 3.0:1):
  //   A013 #8E44AD 5.28 (unchanged)   A018 #6C3483 7.69   A019 #A569BD 3.53
  // Sibling separation so the three stay tellable apart: A018-vs-A019 2.61,
  // A013-vs-A018 1.46, A013-vs-A019 1.79.
  'A018': '#6C3483',  // Tibetan Peoples - deep purple (A013 family, darker)
  'A019': '#A569BD'   // Himalayan Peoples - light purple (A013 family, lighter)
}

export const AFFINITY_BLOCK_COLORS = PALETTE

/** Reverse lookup: Name → ROP1 Code */
export const AFFINITY_BLOCK_NAME_TO_CODE = Object.entries(AFFINITY_BLOCK_NAMES).reduce((acc, [code, name]) => {
  acc[name] = code
  return acc
}, {})

/** Legacy: Name-based color lookup (for backward compatibility) */
export const AFFINITY_BLOCK_COLORS_BY_NAME = Object.entries(AFFINITY_BLOCK_NAMES).reduce((acc, [code, name]) => {
  acc[name] = AFFINITY_BLOCK_COLORS[code]
  return acc
}, {})

export const NAMES = AFFINITY_BLOCK_NAMES

export function getAffinityBlockName(code) {
  return AFFINITY_BLOCK_NAMES[code] || 'Unknown'
}

export function getAffinityBlockColorByCode(code) {
  return AFFINITY_BLOCK_COLORS[code] || DEFAULT_COLOR
}

/**
 * Get color for an affinity block (supports both ROP1 code and name).
 */
export function getAffinityBlockColor(blockNameOrCode) {
  if (!blockNameOrCode) return DEFAULT_COLOR

  if (typeof blockNameOrCode === 'string' && /^A\d{3}$/.test(blockNameOrCode)) {
    return AFFINITY_BLOCK_COLORS[blockNameOrCode] || DEFAULT_COLOR
  }

  return AFFINITY_BLOCK_COLORS_BY_NAME[blockNameOrCode] || DEFAULT_COLOR
}

export function getAffinityBlocksArray() {
  return Object.entries(AFFINITY_BLOCK_NAMES).map(([code, name]) => ({
    code,
    name,
    color: AFFINITY_BLOCK_COLORS[code]
  }))
}

export function getAffinityBlockData(code) {
  return {
    code,
    name: AFFINITY_BLOCK_NAMES[code] || 'Unknown',
    color: AFFINITY_BLOCK_COLORS[code] || DEFAULT_COLOR
  }
}

/**
 * Strategy-aligned getter — uniform name across all per-strategy modules.
 * Expects properties.affinityBlock to contain ROP1 code (e.g., "A007").
 */
export function getColor(properties) {
  const rop1Code = properties.affinityBlock || properties._raw?.ROP1
  return getAffinityBlockColorByCode(rop1Code)
}

/**
 * Get display name for a feature.
 */
export function getName(properties) {
  const rop1Code = properties.affinityBlock || properties._raw?.ROP1
  return getAffinityBlockName(rop1Code)
}

/**
 * Build Mapbox color expression for affinity blocks.
 * Uses ROP1 code (A001, A002, etc.) as the match key.
 */
export function applyColor() {
  const colorExpression = ['match', ['get', PROPERTY_KEY]]
  Object.entries(AFFINITY_BLOCK_COLORS).forEach(([code, color]) => {
    colorExpression.push(code, color)
  })
  colorExpression.push(DEFAULT_COLOR)
  return colorExpression
}

export const buildColorExpression = applyColor

// Backward-compatibility aliases
export const affinityBlockCodeToName = AFFINITY_BLOCK_NAMES
export const affinityBlockCodeToColor = AFFINITY_BLOCK_COLORS
export const affinityBlockNameToCode = AFFINITY_BLOCK_NAME_TO_CODE
export const affinityBlockColors = AFFINITY_BLOCK_COLORS_BY_NAME
export const affinityBlockCodeLookup = AFFINITY_BLOCK_NAMES

export default {
  name: 'Affinity Block',
  propertyKey: PROPERTY_KEY,
  palette: PALETTE,
  colors: PALETTE,
  names: NAMES,
  getColor,
  applyColor,
  buildColorExpression,
  getName,
  getAffinityBlockName,
  getAffinityBlockColor,
  getAffinityBlockColorByCode,
  getAffinityBlocksArray,
  getAffinityBlockData
}
