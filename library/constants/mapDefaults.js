/**
 * mapDefaults.js — Default map initialization settings
 *
 * These are the defaults applied to every map instance.
 * App-profiles can override any of these values.
 *
 * Token: NEVER hardcode here. Components read it via inject('mapboxToken')
 * (ProfileLoader provides it from the profile-config `tk` prop); generated
 * pages resolve it at runtime through the token ladder — build-config
 * `tokenUrl` / window.MAP_TOKEN_URL (see vite.doxa-maps-build-config.json).
 */

export const mapDefaults = {
  // SEAMLESS THEME default — the single Mapbox **Standard** style. Light/dark is a
  // `lightPreset` config flip (useMapTheme.js), NOT a second style document. Booting on
  // light-v11 here would force a setStyle() on the first dark toggle (Standard ≠ light-v11),
  // which wipes/races the custom layers and leaves the prayer-glow "ghost rings" behind
  // (the prayer-glow ghost-rings bug). Keep this Standard so any profile falling back to
  // mapDefaults.style is seamless-safe by default. Profiles boot via mapTheme.bootStyle().
  style:      'mapbox://styles/mapbox/standard',
  center:     [20, 10],   // [lng, lat] — centered on Africa/Middle East
  zoom:       1.8,
  minZoom:    0.5,
  // No hard zoom-IN limit by design: overlapping
  // pins must always be zoomable-apart and clickable. 22 = Mapbox GL's engine maximum
  // (effectively uncapped). A profile may still pass a lower maxZoom via profileConfig.
  maxZoom:    22,
  pitch:      20,         // default tilt in degrees (0 = flat, 60 = steep); extra vertical space on mobile
  bearing:    0,          // rotation in degrees (0 = north up)
  projection: 'mercator',
  // Feedback #2+#4 REDO (/ and /pray): at full zoom-out the same continent used
  // to appear on both edges (the world tiled). The PRIOR fix
  // (renderWorldCopies:false + a maxBounds single-world cap) REGRESSED infinite
  // maps — it collapsed to one non-wrapping world and cut Oceania in half.
  // CORRECT FIX: KEEP renderWorldCopies:true (infinite left/right scroll so
  // trans-antimeridian people groups stay continuous) and cap zoom-out with a
  // DYNAMIC, aspect-aware minZoom FLOOR computed per-viewport in
  // useMapInstance.js (see computeWorldMinZoom). The floor guarantees one world
  // always at least fills the viewport width, so a location is never shown
  // twice — without any maxBounds and without disabling world copies.
  renderWorldCopies: true
  // NO maxBounds: the map pans infinitely. computeWorldMinZoom is what stops
  // zoom-out at one world copy. A profile may still pass an explicit maxBounds
  // through profileConfig to cap a specific map.
}

/**
 * Layer z-order (insert new layers in this order using beforeId)
 * background → raster → fill → line → symbol → popup
 */
export const LAYER_ORDER = [
  'background',
  'raster',
  'country-fill',
  'region-fill',
  'people-group-line',
  'people-group-symbol',
  'cluster-circle',
  'cluster-count',
  'popup'
]

export default {
  mapDefaults,
  LAYER_ORDER
}
