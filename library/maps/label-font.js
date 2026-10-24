/**
 * label-font.js — a text-font the map's own glyph server actually serves.
 *
 * A symbol layer names its font by string, and the ENGINE's glyph server must have that exact name.
 * Mapbox serves DIN Offc Pro, Arial Unicode MS and Open Sans. OpenFreeMap, the basemap under
 * provider=maplibre, serves Noto Sans only. MEASURED 2026-09-25: a MapLibre layer asking for
 * 'DIN Offc Pro Medium' or MapLibre's default ('Open Sans Regular, Arial Unicode MS Regular') gets
 * a 404 on the glyph request and draws NO text, silently: no error, no warning, the circles still
 * render. check:experimental-shelf caught it on upg-neighbor and prayer-walk-planner; the same
 * hard-coded name sat in useMapClustering, so cluster counts were blank on every MapLibre map.
 *
 * Spread into a layer's layout:
 *   layout: { 'text-field': …, ...labelFont(map, { weight: 'bold', mapbox: ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'] }) }
 *
 * Under Mapbox the result is EXACTLY what the caller passed (or nothing, which keeps the style's
 * default), so a Mapbox map renders byte-identically to before this helper existed.
 */
const MAPLIBRE_FONT = { regular: 'Noto Sans Regular', medium: 'Noto Sans Bold', bold: 'Noto Sans Bold' }

function isMaplibreMap(map) {
  return typeof window !== 'undefined' && !!window.maplibregl && map instanceof window.maplibregl.Map
}

/**
 * @param {object} map           the map the layer is added to
 * @param {object} [opts]
 * @param {'regular'|'medium'|'bold'} [opts.weight='regular']  used under MapLibre
 * @param {string[]} [opts.mapbox]  the fonts to keep under Mapbox; omit to use the style default
 * @returns {{ 'text-font'?: string[] }}
 */
export function labelFont(map, { weight = 'regular', mapbox } = {}) {
  if (isMaplibreMap(map)) return { 'text-font': [MAPLIBRE_FONT[weight] || MAPLIBRE_FONT.regular] }
  return Array.isArray(mapbox) && mapbox.length ? { 'text-font': mapbox } : {}
}
