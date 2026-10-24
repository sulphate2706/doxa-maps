/**
 * sizes.js — the poster size ladder for Bible Posters, taken from the SHARED table.
 *
 * Consumes the centrally-owned ladder (library/constants/posterSizes.js, imported as
 * '@map/constants/posterSizes.js'); this plugin only SELECTS its subset of keys and keeps its own
 * locale-neutral dimension labels until the shared picker (with localized names) lands. The size table
 * is never edited here.
 *
 * A book is laid out on the FINISHED poster (width × height, portrait). `sheets` is the shared entry's
 * panel count; the multi-panel PRINT path (reusing library panelSheets.js) is a later milestone — the
 * fit MODEL uses the finished dimensions.
 */
import { POSTER_LADDER, resolvePosterSize } from '@map/constants/posterSizes.js'

// The 5 ladder keys this plugin offers (portrait; a whole book needs the large ones). 'paper' carries
// Letter inches in the shared table; sizing it to A4 for an A4 reader (via paperFor) is a later refinement.
const BIBLE_KEYS = ['paper', '36x36', '36x60', '66x66', '60x96']

// Locale-neutral DIMENSION labels (in/ft are unit symbols, like cm) so no English word leaks into a
// non-English UI. Swap for the shared picker's localized names when it lands.
const LABELS = {
  paper: '8.5 × 11 in',
  '36x36': '3 × 3 ft',
  '36x60': '3 × 5 ft',
  '66x66': '5.5 × 5.5 ft',
  '60x96': '5 × 8 ft',
}

export const BIBLE_POSTER_SIZES = BIBLE_KEYS.map((k) => {
  const e = resolvePosterSize(k) || POSTER_LADDER[k]
  return { id: k, key: k, label: LABELS[k], widthIn: e.inches.w, heightIn: e.inches.h, sheets: e.sheets.count }
})

export const SIZE_BY_ID = Object.fromEntries(BIBLE_POSTER_SIZES.map((s) => [s.id, s]))
export const DEFAULT_SIZE_ID = '36x60'
