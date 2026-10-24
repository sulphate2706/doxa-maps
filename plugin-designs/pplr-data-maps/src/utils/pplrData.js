/**
 * pplrData.js — where this bundle's data files are served from.
 *
 * The maps were written against a page that served assets/data/ at the site root. Embedded, that
 * relative path resolves against the HOST page and 404s, so every fetch goes through dataUrl(),
 * which joins the tree's shared assets base (set once by the hub from resolveAssetsBase) with
 * pplr/<file>. The files are derived by ../scripts/build-data.mjs into data/pplr/.
 */
import { CDN, pinElement } from '@map/constants/cdn.js'
import { loadPinnedUmd } from '@map/utils/loadPinnedUmd.js'
import { providerFor, setProjectionOn } from '@map/composables/useMapProvider.js'
let base = './assets'
export function setDataBase(b) { if (b) base = String(b).replace(/\/+$/, '') }
export function dataUrl(file) { return base + '/pplr/' + file }

// d3 for the ROP Sunburst: PINNED, integrity-checked and kept OFF the host page's window
// (CRITIC-9 / CRITIC-5, the critic fact-check). It used to load d3@7 (a floating range, no SRI) as
// window.d3, overwriting a host page's own d3, or running on whatever d3 the host already had. Now one
// exact version with integrity + crossorigin, captured here (pplrD3()), and the host's window.d3
// put back exactly as it was.
let d3Lib = null
export function pplrD3() { return d3Lib }
// d3 7.9.0, pinned with SRI and kept off the host's window.d3: the shared loader
// (library/utils/loadPinnedUmd.js) that this file and the Wall each used to carry a copy of.
export function ensureD3() {
  if (d3Lib) return Promise.resolve(d3Lib)
  return loadPinnedUmd(CDN.d3, 'd3').then((d3) => (d3Lib = d3))
}

// The 17 locale names per PG, split out of pg-points so the first paint stays small. Loaded on
// the first pin that opens a detail card.
let namesPromise = null
export function loadNames() {
  if (!namesPromise) namesPromise = fetch(dataUrl('pg-names.json'))
    .then((r) => { if (!r.ok) throw new Error('pg-names.json ' + r.status); return r.json() })
    .catch((e) => { namesPromise = null; throw e })
  return namesPromise
}

// The geocoder is a page global too (the original page carried a <script> tag). Load it once, on
// first need, and pick it BY ENGINE, as library/components/map-controls/GeocoderComponent.vue does:
// the Mapbox plugin under provider=mapbox, MapLibre's under provider=maplibre. A hard-coded Mapbox
// script made this the only request to api.mapbox.com in the keyless (maplibre) gallery.
export const GEOCODER = {
  // Exact versions + integrity, from the one registry (library/constants/cdn.js, CRITIC-5).
  mapbox:   { js: CDN.mapboxGeocoderJs.url,   css: CDN.mapboxGeocoderCss.url,   global: 'MapboxGeocoder' },
  maplibre: { js: CDN.maplibreGeocoderJs.url, css: CDN.maplibreGeocoderCss.url, global: 'MaplibreGeocoder' },
}
const geocoderPromises = {}
export function ensureGeocoder(provider = 'mapbox') {
  const g = GEOCODER[provider] || GEOCODER.mapbox
  if (typeof window === 'undefined' || window[g.global]) return Promise.resolve()
  if (!geocoderPromises[provider]) geocoderPromises[provider] = new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = g.js
    pinElement(s, g.js)
    s.onload = () => res(); s.onerror = () => { delete geocoderPromises[provider]; rej(new Error('geocoder failed to load')) }
    document.head.appendChild(s)
  })
  return geocoderPromises[provider]
}

// The engine namespace that built THIS map (Popup, Marker, NavigationControl…). The views were
// written against the Mapbox global; under provider=maplibre that global does not exist and a
// `new mapboxgl.Popup` throws on the first pin click. Now the library's engineFor (one copy).
export { engineFor as glFor } from '@map/composables/useMapProvider.js'

// Resolves once every GeoJSON source on the map has LOADED and a frame has RENDERED after that,
// or after `timeoutMs` (a safety net, never a hang). The views flipped `dataReady` (which hides the
// LoadingGlobe) right after addSource(); the engine then still tiles tens of thousands of points in
// its worker, so the globe disappeared and the map sat EMPTY. Measured on the DX-life gallery: 0
// dots for 20 s, then 19,376 features from 30 s. Not 'idle': an animating map may never go idle.
export function whenGeojsonDrawn(map, timeoutMs = 45000) {
  return new Promise((resolve) => {
    if (!map) return resolve(false)
    let done = false
    const finish = (drawn) => { if (done) return; done = true; clearTimeout(timer); map.off('sourcedata', check); resolve(drawn) }
    const timer = setTimeout(() => finish(false), timeoutMs)
    const check = () => {
      try {
        const srcs = (map.getStyle() || {}).sources || {}
        const ids = Object.keys(srcs).filter((k) => srcs[k].type === 'geojson')
        if (ids.every((id) => map.isSourceLoaded(id))) { map.once('render', () => finish(true)); map.triggerRepaint() }
      } catch (_) { /* style mid-swap: wait for the next sourcedata */ }
    }
    map.on('sourcedata', check)
    check()
  })
}

// Switch projection on EITHER engine. The argument shape is engine-specific: Mapbox takes the name
// ('globe'), MapLibre 5 takes a specification object ({ type: 'globe' }). The views passed the bare
// string, so under provider=maplibre the Globe/Mercator toggle did nothing (or threw inside a
// style.load handler). Guarded: a style that cannot take the projection must not break the view.
// ★ NOW A DELEGATE. This function was the REFERENCE implementation -- the only one of the three
// patterns in the tree that was correct on both engines -- and library/useMapProvider's
// setProjectionOn is it, lifted verbatim (C2). Kept as a named export so this plugin's three views
// (pplr-religion, pplr-language-families, pplr-rop-tree) need no change at all, and so the name they
// already read stays meaningful. Delete it when those views import the library helper directly.
export function setProjectionFor(map, name) {
  return setProjectionOn(map, name)
}

// Verification handle (the gospel-resources __grState contract): what the ACTIVE view's map
// actually did, so a check can assert "loaded" rather than inferring it from missing requests.
// window.__pplrMap() -> { engine, loaded, styleLayers, pplrLayers }
let _exposedMap = null   // whose hook is on window, so releaseMap only clears its own
export function exposeMap(map) {
  if (typeof window === 'undefined' || !map) return
  _exposedMap = map
  let loaded = false
  map.once('load', () => { loaded = true })
  window.__pplrMap = () => {
    let layers = []
    try { layers = map.getStyle()?.layers || [] } catch (_) {}
    return {
      // C3: ask the library, not the globals. `|| 'mapbox'` keeps the ORIGINAL fall-through for a map
      // that is neither (stub, destroyed, neither global loaded) -- see providerFor's own note.
      engine: providerFor(map) || 'mapbox',
      // 'load' may already have fired before this listener was attached; a loaded style says so too
      loaded: loaded || !!(map.isStyleLoaded && map.isStyleLoaded()),
      styleLayers: layers.length,
      // sources this bundle added (not the basemap's): proof the view's own data reached the map
      dataSources: (() => { try { return Object.keys(map.getStyle()?.sources || {}).filter((k) => !/^(composite|mapbox|openmaptiles|natural_earth|ne2_shaded|maplibre)/i.test(k)).length } catch (_) { return 0 } })(),
    }
  }
}

// Release the hook on unmount (a closure on window pins the whole app after the view is gone; measured
// at ~10 MB per mount). Only if it is still THIS map's: another view may have exposed its own since.
export function releaseMap(map) {
  if (typeof window === 'undefined' || !map || _exposedMap !== map) return
  delete window.__pplrMap
  _exposedMap = null
}
