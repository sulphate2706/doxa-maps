/**
 * posterSizes.js — preset poster dimensions (US + ISO).
 *
 * Each preset gives:
 *   • inches      — natural unit for US sizes (and the unit jsPDF/svg2pdf accept)
 *   • mm          — natural unit for ISO sizes (also useful for print specs)
 *   • px300       — pre-computed pixel size at 300 DPI (for quick lookup)
 *   • category    — 'us' | 'iso'
 *   • orientation — natural orientation; the renderer can flip via PosterSpec
 *   • recommendedDpi — sane default DPI for the size
 *
 * Use `getPosterSize(id)` to fetch by id; iteration order follows POSTER_ORDER.
 *
 * @example
 *   const a3 = getPosterSize('a3');
 *   const spec = { widthIn: a3.inches.w, heightIn: a3.inches.h, dpi: 300, ... };
 */

const MM_PER_IN = 25.4;
const mmToIn = (mm) => mm / MM_PER_IN;
const inToMm = (i)  => i * MM_PER_IN;

function size(id, label, w, h, unit, category, orientation, recommendedDpi) {
  const inches = (unit === 'in')
    ? { w, h }
    : { w: round3(mmToIn(w)), h: round3(mmToIn(h)) };
  const mm = (unit === 'mm')
    ? { w, h }
    : { w: round1(inToMm(w)), h: round1(inToMm(h)) };
  const px300 = {
    w: Math.round(inches.w * 300),
    h: Math.round(inches.h * 300),
  };
  return { id, label, inches, mm, px300, category, orientation, recommendedDpi };
}

function round3(n) { return Math.round(n * 1000) / 1000; }
function round1(n) { return Math.round(n * 10)   / 10;   }

/**
 * @typedef {Object} PosterSize
 * @property {string} id
 * @property {string} label
 * @property {{ w: number, h: number }} inches
 * @property {{ w: number, h: number }} mm
 * @property {{ w: number, h: number }} px300
 * @property {'us'|'iso'} category
 * @property {'portrait'|'landscape'|'either'} orientation
 * @property {150|200|300} recommendedDpi
 */

/** @type {Record<string, PosterSize>} */
export const POSTER_SIZES = {
  // ─── US sizes ──────────────────────────────────────────────────────
  letter:  size('letter',  'Letter (8.5×11")',  8.5,  11,   'in', 'us', 'either',   300),
  tabloid: size('tabloid', 'Tabloid (11×17")',  11,   17,   'in', 'us', 'either',   300),
  '18x24': size('18x24',   '18 × 24"',          18,   24,   'in', 'us', 'portrait', 300),
  '24x36': size('24x36',   '24 × 36"',          24,   36,   'in', 'us', 'portrait', 300),
  '27x40': size('27x40',   '27 × 40"',          27,   40,   'in', 'us', 'portrait', 200),

  // ─── ISO sizes ─────────────────────────────────────────────────────
  a4: size('a4', 'A4 (210 × 297 mm)',          210,  297,  'mm', 'iso', 'either',   300),
  a3: size('a3', 'A3 (297 × 420 mm)',          297,  420,  'mm', 'iso', 'either',   300),
  a2: size('a2', 'A2 (420 × 594 mm)',          420,  594,  'mm', 'iso', 'portrait', 300),
  a1: size('a1', 'A1 (594 × 841 mm)',          594,  841,  'mm', 'iso', 'portrait', 200),
  a0: size('a0', 'A0 (841 × 1189 mm)',         841,  1189, 'mm', 'iso', 'portrait', 150),
};

/** Display order for UI dropdowns. */
export const POSTER_ORDER = [
  'letter', 'tabloid', '18x24', '24x36', '27x40',
  'a4', 'a3', 'a2', 'a1', 'a0',
];

/** Default for research-map posters. */
export const DEFAULT_POSTER_ID = '24x36';

/**
 * @param {string} id
 * @returns {PosterSize|null}
 */
export function getPosterSize(id) {
  return POSTER_SIZES[id] || null;
}

/**
 * @returns {PosterSize[]}
 */
export function listPosterSizes() {
  return POSTER_ORDER.map((id) => POSTER_SIZES[id]);
}

/**
 * @param {'us'|'iso'} category
 */
export function listByCategory(category) {
  return listPosterSizes().filter((s) => s.category === category);
}

// ─── THE POSTER-SIZE LADDER (every print surface, 2026-09-30) ────────────────────────────────────
// ONE table of the sizes a READER can pick for a poster, shared by every print surface (the poster
// walls, the map's export, Bless, the map-print template) through ONE print picker. It is separate from
// POSTER_SIZES above (the map exporter's US/ISO list), and written as plain literals, so a bundle that
// never imports it carries none of it.
//
// KEYS are WxH in INCHES (this file's existing convention: '24x36', '27x40'); they are dot-free, so
// they are safe in i18n key paths, URLs and stored choices. PORTRAIT ONLY: h ≥ w for every size (66x66
// is square). `sheets` is what a printer actually feeds, named exactly as panelSheets.js's planPanels()
// parameters, so a consumer passes it straight in: `count` sheets of sheetW × sheetH, stacked in
// `direction`, each overlapping the next by `joinIn` (glued), which gives the finished w × h.
// `photos` means a photo slot beside each name is ALLOWED at this size (there is room); which photos
// print is the renderer's call. `path` is how the size reaches paper: 'print' = the browser's own print
// (any home printer; a phone prints Letter/A4 only), 'pdf' = a print-shop PDF, one page per sheet at
// exact inches, since no phone and few home printers take 3-8 ft paper.
export const POSTER_LADDER = {
  paper:   { id: 'paper', inches: { w: 8.5, h: 11 }, paper: true,
             sheets: { sheetW: 8.5, sheetH: 11, count: 1, direction: 'vertical', joinIn: 0 }, photos: false, path: 'print' },
  '18x24': { id: '18x24', inches: { w: 18, h: 24 },
             sheets: { sheetW: 18, sheetH: 24, count: 1, direction: 'vertical', joinIn: 0 }, photos: false, path: 'pdf' },
  '36x36': { id: '36x36', inches: { w: 36, h: 36 },
             sheets: { sheetW: 36, sheetH: 36, count: 1, direction: 'vertical', joinIn: 0 }, photos: false, path: 'pdf' },
  '36x48': { id: '36x48', inches: { w: 36, h: 48 },
             sheets: { sheetW: 36, sheetH: 48, count: 1, direction: 'vertical', joinIn: 0 }, photos: false, path: 'pdf' },
  '36x60': { id: '36x60', inches: { w: 36, h: 60 },
             sheets: { sheetW: 36, sheetH: 60, count: 1, direction: 'vertical', joinIn: 0 }, photos: false, path: 'pdf' },
  '36x66': { id: '36x66', inches: { w: 36, h: 66 },
             sheets: { sheetW: 36, sheetH: 66, count: 1, direction: 'vertical', joinIn: 0 }, photos: false, path: 'pdf' },
  '66x66': { id: '66x66', inches: { w: 66, h: 66 },
             sheets: { sheetW: 36, sheetH: 66, count: 2, direction: 'horizontal', joinIn: 6 }, photos: true, path: 'pdf' },
  '60x96': { id: '60x96', inches: { w: 60, h: 96 },
             sheets: { sheetW: 60, sheetH: 36, count: 3, direction: 'vertical', joinIn: 6 }, photos: true, path: 'pdf' },
}
/** The picker's order, smallest first. Every size up to 36x66 is one sheet; 66x66 and 60x96 are glued. */
export const POSTER_LADDER_ORDER = ['paper', '18x24', '36x36', '36x48', '36x60', '36x66', '66x66', '60x96']
/** A size that still resolves (stored choices, today's defaults) but is NOT offered in the picker. */
export const POSTER_LADDER_LEGACY = {
  '24x36': { id: '24x36', inches: { w: 24, h: 36 },
             sheets: { sheetW: 24, sheetH: 36, count: 1, direction: 'vertical', joinIn: 0 }, photos: false, path: 'pdf' },
}
/** Older names for the same sizes (poster-render's FORMATS, Bless's PRESETS, the map exporter). */
export const POSTER_LADDER_ALIASES = {
  '3x3': '36x36', '3x3ft': '36x36', '3x5': '36x60', '3x5ft': '36x60',
  '3x4': '36x48', '3x4ft': '36x48', '5x8': '60x96', '5x8ft': '60x96',
  '2x3': '24x36', '2x3ft': '24x36', letter: 'paper', a4: 'paper',
}
/** A key, an alias or a legacy key → its ladder entry; null when unknown. */
export function resolvePosterSize(key) {
  const k = POSTER_LADDER_ALIASES[key] || key
  return POSTER_LADDER[k] || POSTER_LADDER_LEGACY[k] || null
}
// Countries that print on US Letter; everywhere else "Standard printer paper" means A4. Keyed by the
// REGION of a locale tag (en-US, es-MX); a tag without a region falls back to its language's usual paper.
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'CR', 'GT', 'PA', 'DO', 'PR', 'SV', 'NI', 'HN', 'BO'])
/** 'letter' or 'a4' for a locale tag (e.g. navigator.language). */
export function paperFor(localeTag) {
  const m = String(localeTag || '').match(/^([a-z]{2,3})(?:[-_]([A-Za-z]{2}))?/i)
  if (!m) return 'letter'
  if (m[2]) return LETTER_REGIONS.has(m[2].toUpperCase()) ? 'letter' : 'a4'
  return m[1].toLowerCase() === 'en' ? 'letter' : 'a4'
}
