/**
 * pplrMap.js — shared helpers for PPLR validation profiles.
 *
 * Provides:
 *   - LOCALES, LOCALE_NAMES — the 17 locale keys and display names
 *   - COUNTRY_FS_URL, COUNTRY_FS_FIELDS — PPLR FeatureServer country polygon endpoint
 *   - loadOnce(path) — cached fetch returning JSON
 *   - addCountryPolygons(map) — fetches country polygons from PPLR FeatureServer (paginated)
 *   - addPGPoints(map, opts) — adds the PG-in-country pin layer (individual pins, no clustering)
 *   - popupForPG(props) — generic popup HTML for a PG feature
 *
 * Local data files (served from /assets/data/):
 *   pg-points.geojson      21,419 PG-in-country pins — code, name, rop1-3, rop25, iso3,
 *                           country, imb, jp, wcd, religion, rg, n_en…n_de (17 locales)
 *   rop-tree.json          ROP hierarchy: 17 blocs → 292 clusters → 13,065 PGs w/ entries[]
 *   rosetta-sample.json    5 sample PGs with all cross-system IDs
 *   pg-names-summary.json  per-source × locale fill-rate matrix
 *
 * Remote data (live — NOT bundled):
 *   PPLR FeatureServer aCountry  →  country polygons, paginated
 */

export const LOCALES = ['en','hi','bn','ar','zh_TW','fr','ru','ne','pt','es','ko','tl','zh_CN','id','gu','am','de']
export const LOCALE_NAMES = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', ar: 'Arabic', zh_TW: 'Chinese (Trad)',
  fr: 'French', ru: 'Russian', ne: 'Nepali', pt: 'Portuguese', es: 'Spanish',
  ko: 'Korean', tl: 'Tagalog', zh_CN: 'Chinese (Simp)', id: 'Indonesian',
  gu: 'Gujarati', am: 'Amharic', de: 'German'
}

// ── PPLR FeatureServer — country polygons (live, not bundled) ────────────────
import { dataUrl, glFor } from './pplrData.js'
import { tStatic } from '@map/i18n/index.js'

export const COUNTRY_FS_URL = 'https://services2.arcgis.com/S4ydGgujXcif36k3/arcgis/rest/services/aCountry/FeatureServer/0/query'
export const COUNTRY_FS_FIELDS = ['GENCalpha3', 'ISOalpha2', 'CtryNm', 'ctryNmDisp']
// PPLR renamed these fields upstream (measured 2026-09-25: GENCalpha3 is now GENCAlpha3, CtryNm is
// Name, ctryNmDisp is DisplayName). The query asks for the NEW names and each feature is given the
// OLD ones back, so every view that reads f.properties.GENCalpha3 keeps working unchanged.
const COUNTRY_FS_RENAMED = { GENCalpha3: 'GENCAlpha3', ISOalpha2: 'ISOAlpha2', CtryNm: 'Name', ctryNmDisp: 'DisplayName' }

const _cache = new Map()
export async function loadOnce(path) {
  if (_cache.has(path)) return _cache.get(path)
  const p = (async () => {
    // bare file names are this bundle's data files; anything with a scheme or slash is fetched as given
    const r = await fetch(/^(https?:)?\/|\//.test(path) ? path : dataUrl(path))
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
    return r.json()
  })()
  _cache.set(path, p)
  try { return await p } catch (e) { _cache.delete(path); throw e }
}

/**
 * Drop a single cached path or the entire cache. Call from a profile's
 * onBeforeUnmount when you want the next mount to re-fetch (frees the
 * 21k-feature pg-points GeoJSON ~10–15 MB; otherwise it persists for the
 * lifetime of the host page even when no profile holds it).
 */
export function clearLoadOnceCache(path) {
  if (path) _cache.delete(path)
  else _cache.clear()
}

function fetchCountryPolygons() {
  const CACHE_KEY = '__pplr_country_polygons__'
  if (_cache.has(CACHE_KEY)) return _cache.get(CACHE_KEY)

  const p = (async () => {
    const features = []
    let offset = 0
    let exceeded = true

    while (exceeded) {
      const params = new URLSearchParams({
        where: '1=1',
        returnGeometry: 'true',
        f: 'geojson',
        outFields: Object.values(COUNTRY_FS_RENAMED).join(','),
        resultRecordCount: '200',
        resultOffset: String(offset),
        maxAllowableOffset: '0.05'  // simplify geometry server-side; fine for world-scale choropleth
      })
      const resp = await fetch(`${COUNTRY_FS_URL}?${params}`)
      if (!resp.ok) throw new Error(`PPLR aCountry: HTTP ${resp.status}`)
      const data = await resp.json()
      // ArcGIS reports a bad query as HTTP 200 with { error }. Read as "no features", that
      // silently removed every country polygon from every view the day the schema changed.
      if (data.error) throw new Error(`PPLR aCountry: ${(data.error.details || []).join('; ') || data.error.message || data.error.code}`)
      for (const f of data.features || []) {
        const p = f.properties || (f.properties = {})
        for (const [oldName, newName] of Object.entries(COUNTRY_FS_RENAMED)) if (p[oldName] == null) p[oldName] = p[newName]
        features.push(f)
      }
      // f=geojson reports the flag under data.properties, not at the top level, so the old
      // check stopped after the first page: 200 of 251 countries. A full page means there may be more.
      exceeded = data.exceededTransferLimit === true || data.properties?.exceededTransferLimit === true
        || (data.features?.length || 0) >= 200
      offset += data.features?.length || 0
      if (!data.features?.length) break
    }

    return { type: 'FeatureCollection', features }
  })()

  _cache.set(CACHE_KEY, p)
  p.catch(() => _cache.delete(CACHE_KEY))
  return p
}

/**
 * Add country polygons from PPLR FeatureServer.
 *
 * Non-blocking by default: adds empty source+layers immediately so pin layers
 * added by the caller render on top. Data fills in via setData() when the
 * paginated fetch completes (typically 1-2 seconds).
 *
 * Pass `blocking: true` when the caller needs the full fc before proceeding
 * (e.g. pplr-coverage choropleth that must annotate feature properties).
 *
 * Returns { sourceId, dataReady: Promise<{ fc, sourceId }> }.
 * For blocking callers, await the returned promise directly.
 */
// Theme-aware paint presets. Light mode renders polygons fully invisible: on a light basemap the
// polygons' blue borders only add clutter, so neither fill nor line is drawn. Dark mode keeps the
// dark-gray fill + blue line.
export const POLYGON_PAINT = {
  dark:  { fillColor: '#1f2937',       fillOpacity: 0.35, lineColor: '#3b82f6',     lineOpacity: 0.5 },
  light: { fillColor: 'rgba(0,0,0,0)', fillOpacity: 0,    lineColor: 'rgba(0,0,0,0)', lineOpacity: 0 },
}

export function addCountryPolygons(map, {
  sourceId    = 'pplr-countries',
  fillColor   = '#1f2937',
  fillOpacity = 0.35,
  lineColor   = '#3b82f6',
  lineOpacity = 0.5,
  blocking    = false,
  theme       = null,   // 'dark' | 'light' — if set, overrides the four colors above
} = {}) {
  if (theme && POLYGON_PAINT[theme]) {
    ({ fillColor, fillOpacity, lineColor, lineOpacity } = POLYGON_PAINT[theme])
  }
  const emptyFc = { type: 'FeatureCollection', features: [] }

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'geojson', data: emptyFc, generateId: true })
  }
  if (!map.getLayer(`${sourceId}-fill`)) {
    map.addLayer({
      id: `${sourceId}-fill`,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': fillColor,
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], fillOpacity + 0.2, fillOpacity]
      }
    })
  }
  if (!map.getLayer(`${sourceId}-line`)) {
    map.addLayer({
      id: `${sourceId}-line`,
      type: 'line',
      source: sourceId,
      paint: { 'line-color': lineColor, 'line-width': 0.6, 'line-opacity': lineOpacity }
    })
  }

  // Hover highlight (feature-state)
  let hoverId = null
  map.on('mousemove', `${sourceId}-fill`, e => {
    if (!e.features.length) return
    if (hoverId !== null) map.setFeatureState({ source: sourceId, id: hoverId }, { hover: false })
    hoverId = e.features[0].id
    map.setFeatureState({ source: sourceId, id: hoverId }, { hover: true })
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', `${sourceId}-fill`, () => {
    if (hoverId !== null) map.setFeatureState({ source: sourceId, id: hoverId }, { hover: false })
    hoverId = null
    map.getCanvas().style.cursor = ''
  })

  // Fetch data; populate source when ready
  const dataReady = fetchCountryPolygons().then(fc => {
    if (map.getSource(sourceId)) map.getSource(sourceId).setData(fc)
    return { fc, sourceId }
  })

  if (blocking) return dataReady          // caller awaits full data
  dataReady.catch(e => console.warn('Country polygons failed to load:', e))
  return Promise.resolve({ sourceId, dataReady })  // caller gets control immediately
}

/**
 * Re-paint the country polygon layers for a given theme. Call after a
 * theme/basemap toggle that does NOT involve setStyle (when setStyle fires,
 * use the `theme` option on addCountryPolygons in your re-init instead).
 */
export function setCountryPolygonTheme(map, theme, sourceId = 'pplr-countries') {
  const p = POLYGON_PAINT[theme]
  if (!map || !p) return
  const fillId = `${sourceId}-fill`
  const lineId = `${sourceId}-line`
  if (map.getLayer(fillId)) {
    try {
      map.setPaintProperty(fillId, 'fill-color', p.fillColor)
      map.setPaintProperty(fillId, 'fill-opacity',
        ['case', ['boolean', ['feature-state', 'hover'], false], p.fillOpacity + 0.2, p.fillOpacity])
    } catch {}
  }
  if (map.getLayer(lineId)) {
    try {
      map.setPaintProperty(lineId, 'line-color', p.lineColor)
      map.setPaintProperty(lineId, 'line-opacity', p.lineOpacity)
    } catch {}
  }
}

/**
 * Bind a "fuzzy" click handler on a circle layer — Mapbox's default click
 * detection only hits the visible pixels of a 3-7px circle, which is hard on
 * touch + crowded zooms. We instead listen on the whole map and use
 * queryRenderedFeatures with a small bbox around the click point so the
 * effective hit-target is `tolerance × 2` pixels wide. No visual change to
 * the pin itself (base pins are deliberately not restyled).
 *
 * Cursor change still uses the direct mouseenter/mouseleave on the layer so
 * the cursor only goes pointer when the user is actually over a pin —
 * keeping the "fuzzy area" invisible.
 */
export function bindFuzzyPinClick(map, layerId, handler, { tolerance = 8 } = {}) {
  if (!map) return
  map.on('click', e => {
    const t = tolerance
    const bbox = [
      [e.point.x - t, e.point.y - t],
      [e.point.x + t, e.point.y + t],
    ]
    const features = map.queryRenderedFeatures(bbox, { layers: [layerId] })
    if (features.length) handler({ features, lngLat: e.lngLat })
  })
  map.on('mouseenter', layerId, () => map.getCanvas().style.cursor = 'pointer')
  map.on('mouseleave', layerId, () => map.getCanvas().style.cursor = '')
}

/**
 * Selected-pin indicator: a Mapbox marker with an SVG pin icon hovering over
 * the clicked point. Mirrors the pattern DOXA's research-mfe uses (a go
 * indicator that shows which pin is actually selected).
 * Returns a controller object the profile holds onto.
 *
 * Usage:
 *   const indicator = makePinIndicator()
 *   map.on('click', PIN_LAYER, e => {
 *     const { lng, lat } = e.lngLat
 *     indicator.show(map, [lng, lat], { color: '#73A17F' })
 *   })
 *   // and on close:
 *   indicator.hide()
 */
export function makePinIndicator() {
  let marker = null
  let el = null
  function ensureEl(color) {
    if (!el) {
      el = document.createElement('div')
      el.className = 'pplr-pin-indicator'
      el.style.cssText = 'pointer-events:none;width:30px;height:38px;transform:translateY(-12px);'
    }
    // Inline SVG so the icon ships with the bundle (no CDN). Color is the
    // selected row's color, falling back to brand green.
    el.innerHTML = `<svg viewBox="0 0 24 32" width="30" height="38" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 8 12 20 12 20s12-12 12-20C24 5.4 18.6 0 12 0z"
        fill="${color || '#73A17F'}" stroke="#ffffff" stroke-width="1.6"
        style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45))"/>
      <circle cx="12" cy="12" r="4.2" fill="#ffffff"/>
    </svg>`
  }
  return {
    show(map, lngLat, { color } = {}) {
      if (!map || !lngLat) return
      ensureEl(color)
      if (!marker) {
        marker = new (glFor(map)).Marker({ element: el, anchor: 'bottom' })
      }
      marker.setLngLat(lngLat).addTo(map)
    },
    hide() { marker?.remove() },
    destroy() { marker?.remove(); marker = null; el = null },
  }
}

/**
 * Add PG points as individual pins — no clustering.
 * Every pin is always visible regardless of zoom level.
 */
export async function addPGPoints(map, {
  path = 'pg-points.json',
  sourceId = 'pplr-pgs',
  circleColor = '#fbbf24'
} = {}) {
  const fc = await loadOnce(path)
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'geojson', data: fc, cluster: false })
  }
  if (!map.getLayer(`${sourceId}-pin`)) {
    map.addLayer({
      id: `${sourceId}-pin`,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-color': typeof circleColor === 'string' ? circleColor : '#fbbf24',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 4, 3.5, 8, 5.5, 14, 9],
        'circle-stroke-color': '#0d1117',
        'circle-stroke-width': 0.8,
        'circle-opacity': 0.88
      }
    })
  }
  map.on('mouseenter', `${sourceId}-pin`, () => map.getCanvas().style.cursor = 'pointer')
  map.on('mouseleave', `${sourceId}-pin`, () => map.getCanvas().style.cursor = '')

  return { fc, sourceId, pinLayerId: `${sourceId}-pin` }
}

/** Standard popup HTML for a PG feature (PG-in-country grain). */
// Every value interpolated into popup / suggestion HTML goes through this (CRITIC-3, the critic
// fact-check). The data is PPLR's baked JSON and, for place search, the Mapbox geocoding API, and
// setHTML() parses whatever it is handed; escaping costs nothing and closes the door.
export const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function popupForPG(p, extraRows = '') {
  const dash = v => (v == null || v === 'None' || v === '' ? '<span class="m">—</span>' : escHtml(v))
  // Labels in the page's language (tStatic falls back to English). Registry names (ROP3, ROP25,
  // JoshuaProject, IMB People, WCD) are identifiers and stay as they are.
  const L = (k) => escHtml(tStatic('pplr.popup.' + k))
  return `<div class="pplr-popup">
    <h3>${p.name ? escHtml(p.name) : L('noName')}</h3>
    <table>
      <tr><td>${L('country')}</td><td>${dash(p.country)} <code>${dash(p.iso3)}</code></td></tr>
      <tr><td>ROP3</td><td><code>${dash(p.rop3)}</code></td></tr>
      <tr><td>ROP25 (Ethne)</td><td><code>${dash(p.rop25)}</code></td></tr>
      <tr><td>JoshuaProject</td><td><code>${dash(p.jp)}</code></td></tr>
      <tr><td>IMB People</td><td><code>${dash(p.imb)}</code></td></tr>
      <tr><td>WCD</td><td><code>${dash(p.wcd)}</code></td></tr>
      <tr><td>${L('religion')}</td><td>${dash(p.religion)}</td></tr>
      <tr><td>${L('language')}</td><td>${dash(p.language)}</td></tr>
      ${extraRows}
    </table>
  </div>`
}

/** Shared popup CSS — inject once per profile via &lt;style&gt; tag. */
export const POPUP_CSS = `
.pplr-popup { font-family: system-ui, sans-serif; color: #0d1117; min-width: 240px; max-width: 320px; }
.pplr-popup h3 { font-size: 13px; font-weight: 600; margin: 0 0 8px; color: #1f2937; }
.pplr-popup table { width: 100%; border-collapse: collapse; font-size: 11px; }
.pplr-popup td { padding: 3px 6px; vertical-align: top; }
.pplr-popup td:first-child { color: #6b7280; font-weight: 500; width: 38%; }
.pplr-popup code { font: 11px ui-monospace, monospace; color: #1d4ed8; background: #eff6ff; padding: 1px 4px; border-radius: 3px; }
.pplr-popup .m { color: #9ca3af; font-style: italic; }
.mapboxgl-popup-content { padding: 12px 14px !important; border-radius: 6px !important; box-shadow: 0 4px 16px rgba(0,0,0,0.5) !important; }

/* ── Mapbox built-in controls (NavigationControl / FullscreenControl) — themed ── */
.mapboxgl-ctrl-group {
  background: rgba(13,17,23,0.92) !important;
  border: 1px solid #30363d !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 14px rgba(0,0,0,0.35) !important;
  overflow: hidden !important;
}
.mapboxgl-ctrl-group button {
  background: transparent !important;
  width: 32px !important;
  height: 32px !important;
  border: none !important;
  border-bottom: 1px solid rgba(48,54,61,0.6) !important;
}
.mapboxgl-ctrl-group button:last-child { border-bottom: none !important; }
.mapboxgl-ctrl-group button:hover {
  background: rgba(115,161,127,0.18) !important;
}
.mapboxgl-ctrl-group button .mapboxgl-ctrl-icon {
  /* Pure white — was invert(0.85) which read too gray against the dark chip. */
  filter: invert(1) !important;
}
.mapboxgl-ctrl-attrib { background: rgba(13,17,23,0.7) !important; }
.mapboxgl-ctrl-attrib a, .mapboxgl-ctrl-attrib { color: #adbac7 !important; }

/* Light-mode overrides — when host profile sets [data-theme="light"], Mapbox
   controls invert. We can't scope by theme since controls live outside our
   component tree, so we use a class on the map container set by the profile. */
.profile[data-theme="light"] .mapboxgl-ctrl-group {
  background: #ffffff !important;
  border-color: #d0d7de !important;
  box-shadow: 0 4px 14px rgba(31,35,40,0.15) !important;
}
.profile[data-theme="light"] .mapboxgl-ctrl-group button {
  border-bottom-color: rgba(208,215,222,0.6) !important;
}
.profile[data-theme="light"] .mapboxgl-ctrl-group button:hover {
  background: rgba(59,70,61,0.08) !important;
}
.profile[data-theme="light"] .mapboxgl-ctrl-group button .mapboxgl-ctrl-icon {
  filter: none !important;
}
`

/**
 * Custom Mapbox IControl that toggles fullscreen on a caller-supplied
 * container. Replaces mapboxgl.FullscreenControl, which has a known issue
 * where the icon does not flip back to "exit" when a non-map container is
 * fullscreened — the second click then re-requests fullscreen instead of
 * exiting.
 *
 * Usage:
 *   map.addControl(new FullscreenToggleControl(profileRoot.value), 'bottom-right')
 *
 * Behaviour: identical SVG to Mapbox's built-in (uses the same CSS classes
 * `mapboxgl-ctrl-fullscreen` / `mapboxgl-ctrl-shrink`), but the toggle
 * decision is driven purely by document.fullscreenElement so it stays in
 * sync regardless of how the user enters/exits fullscreen (button, ESC, F11).
 */
export class FullscreenToggleControl {
  constructor(container) { this._container = container }
  // Truthy-based check — works inside shadow DOM where strict equality with
  // document.fullscreenElement fails (the browser returns the shadow HOST,
  // not our inner element). Since the app only fullscreens one element, any
  // active fullscreen is unambiguously ours.
  _isFs() {
    if (document.fullscreenElement) return true
    const root = this._container?.getRootNode?.()
    return !!(root && root !== document && root.fullscreenElement)
  }
  onAdd(map) {
    this._map = map
    this._wrap = document.createElement('div')
    this._wrap.className = 'mapboxgl-ctrl mapboxgl-ctrl-group'
    this._btn = document.createElement('button')
    this._btn.type = 'button'
    this._btn.className = 'mapboxgl-ctrl-fullscreen'
    // The shared, translated name (buttons.toggleFullscreen), in the page's language when the map is
    // built. a browser check saw the English "Toggle fullscreen" in ar and zh on every PPLR map view.
    const label = tStatic('buttons.toggleFullscreen') || 'Toggle fullscreen'
    this._btn.setAttribute('aria-label', label)
    this._btn.title = label
    this._btn.innerHTML = '<span class="mapboxgl-ctrl-icon" aria-hidden="true"></span>'
    this._btn.addEventListener('click', () => this._toggle())
    this._sync = () => {
      this._btn.className = this._isFs() ? 'mapboxgl-ctrl-shrink' : 'mapboxgl-ctrl-fullscreen'
    }
    // Listen on both document and shadow root (whichever applies)
    document.addEventListener('fullscreenchange', this._sync)
    const root = this._container?.getRootNode?.()
    if (root && root !== document) root.addEventListener('fullscreenchange', this._sync)
    this._rootForCleanup = root
    this._wrap.appendChild(this._btn)
    return this._wrap
  }
  _toggle() {
    if (this._isFs()) {
      document.exitFullscreen?.()
    } else {
      this._container?.requestFullscreen?.()
    }
  }
  onRemove() {
    document.removeEventListener('fullscreenchange', this._sync)
    if (this._rootForCleanup && this._rootForCleanup !== document) {
      this._rootForCleanup.removeEventListener('fullscreenchange', this._sync)
    }
    this._wrap.parentNode?.removeChild(this._wrap)
  }
}
