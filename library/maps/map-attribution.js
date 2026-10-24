/**
 * map-attribution — the credit the tiles on THIS map actually ask for, as plain text.
 *
 * ★ WHY THIS IS READ AND NOT DECLARED. The poster footer defaulted to '© Mapbox © OpenStreetMap',
 * which is a licence statement, so it must be true. Under the fleet's MapLibre default Mapbox serves
 * nothing and OpenFreeMap serves everything, and any poster carrying that default credited a company
 * with no involvement while omitting the three parties whose licences actually apply.
 *
 * ★ AND IT CANNOT BE READ FROM THE STYLE. Checked against the live style 2026-09-28:
 * tiles.openfreemap.org/styles/liberty declares TWO sources and NEITHER carries an `attribution`
 * field. The credit lives in the TileJSON the vector source points at
 * (tiles.openfreemap.org/planet), which the engine fetches and merges into the SOURCE OBJECT once it
 * loads. So `map.getStyle().sources[id].attribution` is null and `map.getSource(id).attribution` is
 * the real answer — the style is the request, the source is what came back. This reads both and
 * prefers the live source, because a style that DOES declare one should still be honoured.
 *
 * The TileJSON value is HTML with anchors and entities; a poster footer is text, so it is flattened
 * rather than escaped-and-printed. Returns '' when nothing can be read, and the CALLER keeps its own
 * fallback — printing an empty attribution is the one outcome that is never acceptable.
 */

const ENTITIES = { '&copy;': '©', '&amp;': '&', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Flatten one attribution value (HTML or plain) to trimmed, single-spaced text. */
export function attributionToText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')                                   // anchors carry the link, not the credit
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every distinct credit the map's sources ask for, joined into one line.
 *
 * @param {Object} map  a mapboxgl/maplibregl Map instance
 * @returns {string} plain text, or '' when the map cannot be read
 */
export function attributionTextFromMap(map) {
  if (!map || typeof map.getStyle !== 'function') return '';
  let style;
  try { style = map.getStyle(); } catch (_) { return ''; }   // getStyle throws before the style loads
  const sources = (style && style.sources) || {};
  const seen = [];
  for (const id of Object.keys(sources)) {
    // The live source first: it is the one the TileJSON was merged into.
    let live = null;
    try { live = typeof map.getSource === 'function' ? map.getSource(id) : null; } catch (_) { live = null; }
    const text = attributionToText((live && live.attribution) || sources[id].attribution);
    if (text && !seen.includes(text)) seen.push(text);
  }
  return seen.join(' ');
}
