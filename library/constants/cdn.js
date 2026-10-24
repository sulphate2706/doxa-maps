/**
 * cdn.js — EVERY third-party script and stylesheet a plugin loads at runtime, pinned to an EXACT version
 * with its Subresource Integrity hash (CRITIC-5, 2026-09-26).
 *
 * WHY. Floating ranges (maplibre-gl@5, maplibre-gl-geocoder@1) meant a CDN could serve any future release
 * to every partner's visitors, and with no integrity attribute nothing would notice a tampered file.
 * Each entry is loaded with `integrity` + `crossorigin="anonymous"` (every host here answers
 * Access-Control-Allow-Origin: *, measured), so the browser refuses a file whose bytes differ.
 *
 * TO BUMP A VERSION: change the url, recompute the hash, and run check:cdn-pins (it re-fetches every
 * url and compares):
 *   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
 *
 * Not here: the RTL text plugin, which the ENGINE fetches (setRTLTextPlugin), not a <script> tag, so
 * integrity cannot be applied; it is pinned to an exact version in library/maps/rtl-text.js.
 */
export const CDN = {
  mapboxGlJs:  { url: 'https://api.mapbox.com/mapbox-gl-js/v3.24.0/mapbox-gl.js',  integrity: 'sha384-tO0clamXONKwbiz7O6xJpUeyJbTSPugC+xM9clvfFvKTH3i8SmCawHGdf5quMWmZ' },
  mapboxGlCss: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.24.0/mapbox-gl.css', integrity: 'sha384-rp1X/jJ9MpWPef9OimfXhOaOc4Gzs87yQvF+ajwY6X2H4PTeHNycNlLWiWvj7ehV' },
  // ⚠ MapLibre stays on 5.x FOR NOW, knowingly: GHSA-jrc7-96c5-q579 (an XSS bypass in DOM.sanitize, reached
  // through a source's ATTRIBUTION string) affects every release <= 6.4.0, and 6.x is ESM-only (no UMD
  // `maplibregl` global), so upgrading is a loader migration, not a version bump. Exposure meanwhile:
  // the attribution strings rendered are those of the fixed basemap styles we configure and our own
  // sources, none reader- or partner-supplied, and SRI pins these exact bytes. A partner who passes a
  // style from an untrusted origin is exposed until the 6.x migration (tracked separately) lands.
  maplibreGlJs:  { url: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js',  integrity: 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp' },
  maplibreGlCss: { url: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css', integrity: 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK' },
  mapboxGeocoderJs:  { url: 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.min.js', integrity: 'sha384-Lx9WK8XhZk57czwxt6B6nyaDHB5Ayrcrsu4Fw4bCp/Ot/QLOsUZ0xYqLOpOOSXZw' },
  mapboxGeocoderCss: { url: 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.css',   integrity: 'sha384-1KNhwJNCQTr0DCi/5/OnQcFytgycxTahxNZaqKbAtqmY8bUhu26qxXqvDGXXwplS' },
  maplibreGeocoderJs:  { url: 'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-geocoder@1.9.4/dist/maplibre-gl-geocoder.min.js', integrity: 'sha384-RGV5vfoJd7alk8HE+71IyVfu19ciH1FKA15+AuXs6OeBM2npXrmTPFqG23yMiHXi' },
  maplibreGeocoderCss: { url: 'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-geocoder@1.9.4/dist/maplibre-gl-geocoder.css',    integrity: 'sha384-UkDpPApjTpHJHpcJiSNAmbobh30W0/dmt0DoKm4V8CWYRYvQ/Jhd/ijFz0tFdVnH' },
  // d3 for the PPLR maps and the Wall, which load it themselves (pplrData.js, wallD3.js) and keep it off
  // window.d3; listed so check:cdn-pins can verify their pin.
  d3: { url: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js', integrity: 'sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i' },
}

/** Set integrity + crossorigin on a <script>/<link> for a registry entry (no-op for an unknown url). */
export function pinElement(el, url) {
  const e = Object.values(CDN).find((x) => x.url === url)
  if (!e) return el
  el.integrity = e.integrity
  el.crossOrigin = 'anonymous'
  return el
}
