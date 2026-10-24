/**
 * whenStyleReady.js — run once the map's style has loaded (immediately if it already has).
 *
 * MapLibre throws "Style is not done loading" from setProjection before that, and setProjectionOn
 * swallows the throw, so the lenses that set 'mercator' right after initializeMap() never got it on
 * MapLibre (measured, C2: lang-cluster, send-map, the bloom cockpit's MapCell). Mapbox accepts it early,
 * which is why this only showed on one engine.
 */
export function whenStyleReady(map, fn) {
  if (!map) return
  if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) fn()
  else map.once('style.load', fn)
}
