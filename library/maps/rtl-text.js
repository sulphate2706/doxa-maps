/**
 * rtl-text.js — load the RTL text plugin ONCE per page, for Mapbox AND MapLibre.
 *
 * WHY THIS IS A SHARED FUNCTION AND NOT A COPY-PASTE BLOCK. Every bundle entry that boots a map
 * needs this, and the block was duplicated into each `index.js` by hand. A baked cap-4 composite
 * imports its child's `.vue` directly and therefore never runs the child's entry, so it has to
 * re-declare everything the entry does — and `dashboard-plus-grid` re-declared Pinia, i18n and the
 * colour strategies but NOT this one.
 *
 * MEASURED in the shipped bundles 2026-09-22:
 *     research-dashboard.js ....... 1 occurrence of mapbox-gl-rtl-text
 *     doxa-research-map.js ........ 1
 *     dashboard-plus-grid.js ...... 0   <- the composite
 * So Arabic, Hebrew and Persian labels render REVERSED inside the cap-5 shell and correctly
 * standalone. That is not cosmetic for this product: Arab World (99 rows) and Persian-Median
 * (49 rows) are in scope, and a reversed label is a WRONG NAME for exactly the groups the map is
 * about. It also fails silently — no error, no console warning, just mirrored text that looks like
 * a font problem to anyone who does not read the script.
 *
 * ★ THE GENERAL RULE THIS EXISTS TO SERVE: a composite that BAKES a child's `.vue` inherits nothing
 * from that child's entry file; a composite that COMPOSES by tag + bundle URL boots the child
 * through its own entry and inherits everything. `stack-demo` and `research-map-plus-grid` compose,
 * which is why they were never affected. Only `dashboard-plus-grid` bakes.
 *
 * Four of the five entry side effects fail SILENTLY (Pinia, i18n, colour strategies, this one); only
 * `provide('profileModules')` throws, and it is the one that is safe to omit — structurally, because
 * a baked composite does not use ProfileLoader.vue. So "it renders" is no evidence that an entry's
 * work was done.
 *
 * Idempotent by construction: Mapbox throws if the plugin is set twice in a session, and that throw
 * is swallowed here, so calling this from several entries on one page is safe.
 */

// ONE PLUGIN, TWO ENGINES, TWO SOURCES. Mapbox keeps its own CDN (unchanged). MapLibre gets the same
// plugin package from jsDelivr — keyless and NOT api.mapbox.com, so a keyless page (provider
// maplibre) still makes zero Mapbox requests (check:gallery-embed:maplibre enforces that).
export const RTL_PLUGIN_URLS = {
  mapbox: 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js',
  maplibre: 'https://cdn.jsdelivr.net/npm/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js'
}
const RTL_PLUGIN_URL = RTL_PLUGIN_URLS.mapbox   // kept for readers grepping the old name

// ★ MAPLIBRE WAS NEVER COVERED (2026-09-25). This used to check window.mapboxgl only, so every
// MapLibre map — every keyless embed — drew Arabic, Hebrew and Persian labels as disconnected,
// reversed glyphs. Measured on the Prayer Walk Planner's printed Arabic sheet. A second gap sat under
// it: bundle entries call this at LOAD time, before useMapInstance has injected a MapLibre engine,
// so even an engine-aware version found nothing to install into. useMapInstance now also calls it
// the moment an engine global exists, which is what makes it reach every map.
function isMaplibre(gl) { return !!gl && typeof window !== 'undefined' && gl === window.maplibregl }

/**
 * Install the RTL text plugin, lazily, on the given engine — or on whichever engine globals exist.
 * Idempotent: safe from several entries and from every map init on one page.
 * @param {object} [engine]  window.mapboxgl or window.maplibregl; omitted = both, if present
 * @returns {boolean} true when this call installed it
 */
export function installRtlTextPlugin(engine) {
  if (typeof window === 'undefined') return false
  const engines = engine ? [engine] : [window.maplibregl, window.mapboxgl].filter(Boolean)
  let installed = false
  for (const gl of engines) {
    if (!gl || !gl.setRTLTextPlugin) continue
    try {
      if (isMaplibre(gl)) {
        // MapLibre: (url, lazy) → Promise. Guard on status: a second call rejects.
        if (gl.getRTLTextPluginStatus && gl.getRTLTextPluginStatus() !== 'unavailable') continue
        const r = gl.setRTLTextPlugin(RTL_PLUGIN_URLS.maplibre, true)
        if (r && r.catch) r.catch(() => {})
      } else {
        // `true` = LAZY: fetch the plugin only when RTL text is actually encountered, so a map
        // with no RTL labels pays nothing.
        gl.setRTLTextPlugin(RTL_PLUGIN_URLS.mapbox, null, true)
      }
      installed = true
    } catch (_) {
      // Already set in this session. Expected whenever two entries run on one page — not an error.
    }
  }
  return installed
}

/**
 * Make sure the plugin is LOADED (not merely registered) before a single frame is captured — a
 * print or snapshot takes one frame, and a lazily-loaded plugin can still be in flight when it
 * does. MapLibre only (Mapbox has no status API); resolves after at most ~5s either way.
 */
export async function ensureRtlTextPlugin(gl) {
  if (!gl || !isMaplibre(gl) || !gl.getRTLTextPluginStatus) return
  try {
    // Not registered yet → register EAGERLY. Already registered lazily ('deferred') → it loads on the
    // first RTL label this map draws, so just wait for it below.
    if (gl.getRTLTextPluginStatus() === 'unavailable') await gl.setRTLTextPlugin(RTL_PLUGIN_URLS.maplibre, false)
    for (let i = 0; i < 50 && !['loaded', 'error'].includes(gl.getRTLTextPluginStatus()); i++) await new Promise(r => setTimeout(r, 100))
  } catch (_) { /* shaping is a nicety; the map still renders */ }
}

export default installRtlTextPlugin
