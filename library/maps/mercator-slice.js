/**
 * mercator-slice.js — cut a map's bounds into EQUAL-HEIGHT rows, which is not the same as equal degrees.
 *
 * ★ THE DEFECT THIS EXISTS FOR (Simple Research's poster export): the poster showed too much of
 * Antarctica and came out at the wrong, vertical aspect.
 *
 * The big-poster renderer stitches a grid of tiles, each rendered into an EQUAL-HEIGHT slot in the
 * output image. It chose each tile's latitude band by dividing the degree span evenly:
 *
 *     latStep = (ne.lat - sw.lat) / rows
 *
 * Web Mercator is not linear in latitude — screen y is proportional to ln(tan(pi/4 + lat/2)) — so equal
 * DEGREE bands are not equal SCREEN bands. MEASURED on a -60..75 view in 4 rows: the top band is 37.0%
 * of the true screen height and is drawn into 25% of the poster; the next is 19.7% drawn into 25%. Every
 * row is squeezed or stretched, which is the wrong aspect, and the high-latitude bands — where a degree
 * is worth the most pixels — are the most over-represented, which is where the excess Antarctica came from.
 *
 * Slicing in MERCATOR Y instead gives 25.0% per row exactly, because that IS the screen coordinate.
 *
 * ★ SAME MISTAKE, THIRD PLACE TODAY. A whiteboard chart nearly shipped with a linear scale into degrees,
 * and a measurement harness nearly reported a false threshold by correcting the wrong axis. Anything
 * that treats latitude as a screen coordinate is wrong; the conversion is one line and it belongs
 * somewhere shared rather than being rediscovered.
 */

/** Web Mercator's y for a latitude, in the same units the projection's x uses (radians of longitude). */
export const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))

/** The inverse: the latitude at a Mercator y. */
export const latAtMercatorY = (y) => (Math.atan(Math.sinh(y)) * 180) / Math.PI

/** Web Mercator is undefined at the poles; the engines clamp here, so clamp before projecting. */
export const MERCATOR_MAX_LAT = 85.051129

const clampLat = (lat) => Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat))

/**
 * Latitude bands of EQUAL RENDERED HEIGHT, north to south.
 * @param {number} southLat
 * @param {number} northLat
 * @param {number} rows
 * @returns {Array<[number, number]>} [southLat, northLat] per row, ordered north-first to match a
 *          top-to-bottom tile grid
 */
export function equalHeightLatBands(southLat, northLat, rows) {
  const n = Math.max(1, Math.floor(rows) || 1)
  const yN = mercatorY(clampLat(Math.max(southLat, northLat)))
  const yS = mercatorY(clampLat(Math.min(southLat, northLat)))
  const step = (yN - yS) / n
  const out = []
  for (let r = 0; r < n; r++) {
    const top = yN - r * step
    const bottom = yN - (r + 1) * step
    out.push([latAtMercatorY(bottom), latAtMercatorY(top)])
  }
  return out
}
