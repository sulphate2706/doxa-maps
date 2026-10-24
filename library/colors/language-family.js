/**
 * Language Family Color Strategy
 *
 * Colors pins based on their language family.
 * Sourced from doxa-research-mfe (research wins on drift).
 *
 * Drift note (vs simple-map):
 *   - simple-map had 'Sign language' (lowercase) as alias key with same hex.
 *     Research solves this via canonicalFamilyName() — case-folded lookup —
 *     so legend doesn't emit duplicate rows.
 *   - simple-map's 'Unknown' = '#0098FF' (bright blue), research = '#000000'.
 *     Research wins (UX 2026-04-27: unmapped → black).
 *   - simple-map's getLanguageFamilyColor fell back to '#95a5a6';
 *     research falls back to '#000000'. Research wins.
 */

export const PROPERTY_KEY = 'languageFamily'

const DEFAULT_COLOR = '#000000' // Unmapped / null / undefined → black (UX 2026-04-27)

/**
 * Language Family Color Palette
 * Single source of truth for language family colors.
 */
export const PALETTE = {
  // ── Top 6 major families ─────────────────────────────────────────────────
  'Indo-European': '#e74c3c',      // RED
  'Dravidian': '#ff9800',          // BRIGHT ORANGE
  'Afro-Asiatic': '#27ae60',       // GREEN
  'Sino-Tibetan': '#3498db',       // BLUE
  'Niger-Congo': '#9b59b6',        // PURPLE
  'Unclassified': '#95a5a6',       // GREY

  // ── Africa ───────────────────────────────────────────────────────────────
  'Nilo-Saharan': '#e91e63',
  'Khoe-Kwadi': '#00bcd4',

  // ── Southeast Asia & Pacific ─────────────────────────────────────────────
  'Austro-Asiatic': '#00bcd4',
  'Kra-Dai': '#8e44ad',
  'Austronesian': '#ff69b4',
  'Hmong-Mien': '#f44336',

  // ── Central Asia & Caucasus ──────────────────────────────────────────────
  'Turkic': '#ffc107',
  'Nakh-Daghestanian': '#009688',
  'Mongolic': '#795548',
  'Uralic': '#607d8b',
  'Tungusic': '#4caf50',

  // ── East Asia ────────────────────────────────────────────────────────────
  'Japonic': '#ff5722',

  // ── Americas ─────────────────────────────────────────────────────────────
  'Cariban': '#673ab7',
  'Tupian': '#03a9f4',
  'Tucanoan': '#8bc34a',
  'Maipurean': '#ffc107',
  'Panoan': '#cddc39',
  'Guajiboan': '#9e9e9e',
  'Chibchan': '#ff7043',
  'Quechuan': '#ab47bc',
  'Jean': '#26a69a',
  'Harákmbut': '#7e57c2',
  'Nambikwara': '#42a5f5',
  'Muran': '#66bb6a',
  'Karajá': '#ffa726',
  'Bororoan': '#ef5350',
  'Arauan': '#5c6bc0',
  'Yanomaman': '#26c6da',
  'Yaguan': '#d4e157',
  'Witotoan': '#78909c',
  'Zamucoan': '#8d6e63',
  'Puinavean': '#aed581',
  'Barbacoan': '#4db6ac',
  'Eyak-Athabaskan': '#7986cb',

  // ── Oceania & other ──────────────────────────────────────────────────────
  'Trans-New Guinea': '#ba68c8',
  'Andamanese': '#4dd0e1',

  // ── Live-but-unmapped families (MEASURED 2026-09-22, pray-tools 2,107 rows) ──
  // These resolved on live data but had no palette entry, so they fell to the grey
  // NEUTRAL in the semantic tree legend. Small but real: 8 rows total.
  // Contrast vs the Material Light surface #f3f3f1 (3.0:1 non-text floor):
  //   Atlantic-Congo 6.36 · Mande 3.31
  // Both are African families, so both sit in the Niger-Congo purple / warm-earth
  // neighbourhood their relatives already occupy rather than taking an unrelated hue.
  // NOTE 'Tai-Kadai' is NOT listed here: it is the modern name for the family this
  // palette already calls 'Kra-Dai' (#8e44ad). It is handled as an ALIAS in
  // canonicalFamilyName() — giving it its own hex would paint one family two colours.
  'Atlantic-Congo': '#7D3C98',
  'Mande': '#B9770E',

  // ── Special categories ───────────────────────────────────────────────────
  'Sign Language': '#212121',
  'Creole': '#9575cd',
  'Mixed language': '#a1887f',
  'Language isolate': '#90a4ae',
  // Null/unknown family bucket — case-different upstream values fold to this
  // single canonical key via canonicalFamilyName(). Keep just one entry so
  // the legend's seed loop doesn't emit multiple zero-count rows.
  'Unknown': '#000000'
}

export const LANGUAGE_FAMILY_COLORS = PALETTE

export function getLanguageFamilyColor(familyName) {
  // Unmapped / null / undefined family → black (per UX 2026-04-27).
  return PALETTE[familyName] || DEFAULT_COLOR
}

// Case-fold lookup so upstream values that differ only in case
// ("Sign Language" vs "Sign language") collapse onto one canonical key
// (the proper-case spelling stored in PALETTE).
const _LANG_FAMILY_ALIAS = (() => {
  const norm = (s) => String(s || '').toLowerCase().trim()
  const map = {}
  for (const k of Object.keys(PALETTE)) map[norm(k)] = k
  return map
})()

/**
 * SYNONYMS — upstream spellings that name a family the PALETTE already holds under a
 * different name. These are NOT new colours: giving a synonym its own hex would paint
 * one family two colours, which is the same class of defect as colouring by array index.
 *
 * MEASURED on live pray-tools data (2,107 rows, 2026-09-22):
 *   'Tai-Kadai' — the modern linguistic name for 'Kra-Dai' (already #8e44ad). 1 row.
 *   'None'      — the API's literal no-family value; belongs in the existing 'Unknown'
 *                 bucket, which is the palette's designated null family. 1 row.
 * Keyed lower-case; resolved before the case-fold lookup so a synonym wins.
 */
const _LANG_FAMILY_SYNONYM = {
  'tai-kadai': 'Kra-Dai',
  'none': 'Unknown',
}

export function canonicalFamilyName(raw) {
  if (!raw) return 'Unknown'
  const trimmed = String(raw).trim()
  const lower = trimmed.toLowerCase()
  return _LANG_FAMILY_SYNONYM[lower] || _LANG_FAMILY_ALIAS[lower] || trimmed
}

export function getColor(properties) {
  return getLanguageFamilyColor(properties.languageFamily || properties._normalized?.languageFamily)
}

/**
 * Build Mapbox color expression for language families.
 */
export function applyColor() {
  const colorExpression = ['match', ['get', PROPERTY_KEY]]
  Object.entries(PALETTE).forEach(([family, color]) => {
    colorExpression.push(family, color)
  })
  colorExpression.push('#95a5a6') // Default (mapbox match fallback)
  return colorExpression
}

export const buildColorExpression = applyColor

// Backward-compatibility aliases
export const languageFamilyColors = PALETTE
export const defaultFamilyColor = '#95a5a6'

export default {
  name: 'Language Family',
  propertyKey: PROPERTY_KEY,
  palette: PALETTE,
  colors: PALETTE,
  getColor,
  applyColor,
  buildColorExpression,
  getLanguageFamilyColor,
  canonicalFamilyName
}
