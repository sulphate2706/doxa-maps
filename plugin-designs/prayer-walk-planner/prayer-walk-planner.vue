<script setup>
/**
 * prayer-walk-planner.vue — root SFC, mounted directly as the custom element (see index.js).
 *
 * @description A simple polygon-drawing tool for planning prayer-walking routes.
 * Draw a polygon around a neighborhood/block, name it, batch-select the ones you're
 * printing today, and click Print to open an in-browser print dialog with one page
 * per selected zone — a title, its coordinates, and a satellite/vector snapshot of the
 * shape. Everything lives in localStorage. There is no backend — see the file header
 * in index.js for why, and README.md in this folder for the satellite-imagery research
 * (no keyless, terms-permitting satellite source qualified; this ships the keyless
 * MapLibre/OpenFreeMap VECTOR basemap instead, already proven keyless elsewhere in
 * this repo — library/styles/registry.js).
 *
 * ── CLIENT-SIDE API (why it exists: with a client-side API, an AGENT can be connected to
 * the prayer walk planner) ──────────────────────
 *
 * Two ways to reach it, both backed by the SAME reactive state:
 *
 *   1. Methods on the custom element itself (defineExpose, bridged by Vue because this
 *      SFC IS the defineCustomElement root — see index.js):
 *
 *        const el = document.querySelector('prayer-walk-planner')
 *        el.addPolygon(coords, title)   // coords: [[lng,lat], ...] ring, auto-closed if needed
 *        el.deletePolygon(id)
 *        el.selectPolygon(id, selected = true)
 *        el.clearSelection()
 *        el.listPolygons()              // -> [{ id, title, coords, createdAt, selected }]
 *        el.getPolygon(id)
 *        el.print(ids = null)           // null = print current selection
 *        el.startDrawing() / el.stopDrawing()
 *        el.resolvedInstanceId          // the id this element registered under (see 2.)
 *
 *   2. A discovery-friendly window global, keyed by instance so multiple embeds never
 *      collide — mirrors this repo's existing window.MAP_TOKEN / window.DOXA_SLOTS
 *      convention (documentation/reference.md). Every element registers itself here on
 *      mount and deregisters on unmount:
 *
 *        window.PrayerWalkPlanner.instances['<instanceId>']   // same method set as above
 *        window.PrayerWalkPlanner.first()                     // convenience: first live instance
 *
 *      instanceId defaults to a random id; set one explicitly via the `instance-id`
 *      attribute (`<prayer-walk-planner instance-id="my-walk"></prayer-walk-planner>`)
 *      for a predictable global key.
 *
 * Both surfaces are exercised by the same functions below — there is exactly one
 * source of truth (the `polygons` ref), so a human clicking buttons and an agent
 * calling methods can freely interleave.
 */
import { labelFont } from '@map/maps/label-font.js'
import { ref, shallowRef, reactive, computed, onMounted, onBeforeUnmount, nextTick, inject, watch } from 'vue'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { printDocument } from '@map/composables/printInPlace.js'
import { tStatic } from '@map/i18n/index.js'
import ShareButton from '@map/components/map-controls/ShareButton.vue'
import FullscreenButton from '@map/components/map-controls/FullscreenButton.vue'
import HelpButton from '@map/components/map-controls/HelpButton.vue'
import { resolveNamedStyle } from '@map/styles/registry.js'
import { ensureRtlTextPlugin } from '@map/maps/rtl-text.js'
import { localizeBasemapLabels } from '@map/maps/localize-labels.js'
import { translate, LOCALES } from './src/strings.js'

// ─── The host's attributes stay on the host ───────────────────────────────────
// ★ THE TINY MAP (measured 2026-09-25: 747x76 in the Research Gallery at 1280x800,
// and 390x0 on a phone, while the standalone leaf filled 1003x739). This SFC is mounted AS the
// custom-element root (index.js — that is what puts the client API on the element), so Vue's
// attribute fallthrough copied every non-prop attribute of <prayer-walk-planner> onto the root
// .pwp — including the gallery's inline style="display:block;position:absolute;inset:0;…". That
// inline display:block beat .pwp{display:flex}: the column stopped being a flex container, the body
// fell back to the height of the zone list's text, and the map got whatever was left. The leaf never
// showed it because its page styles the element through a stylesheet, not a style attribute.
// Host attributes (style, tree-base, profile-config) describe the HOST box; they must not restyle
// the component inside it. profile-config still reaches us — it is a declared prop.
defineOptions({ inheritAttrs: false })

// ─── Props ────────────────────────────────────────────────────────────────────
const props = defineProps({
  instanceId: { type: String, default: '' },
  // A host (the Research Gallery, a partner page) hands the language in profile-config, the same
  // contract every other plugin reads; `language` is the plain-attribute form.
  profileConfig: { type: [String, Object], default: '' },
  language: { type: String, default: '' }
})

// ─── Language ─────────────────────────────────────────────────────────────────
// Ladder, most authoritative first: `language` attribute → profile-config locale/lang (what the
// gallery forwards) → ?lang= / ?locale= → <html lang> → English. Never the browser's language:
// the page the planner sits on decides, as for every map in this repo.
const cfg = computed(() => {
  let pc = props.profileConfig
  if (typeof pc === 'string') { try { pc = pc ? JSON.parse(pc) : {} } catch { pc = {} } }
  return pc && typeof pc === 'object' ? pc : {}
})
function hostLocale() {
  try {
    const q = new URLSearchParams(location.search)
    const u = (q.get('lang') || q.get('locale') || '').split('-')[0].toLowerCase()
    if (LOCALES.includes(u)) return u
  } catch (_) { /* no window */ }
  try { return (document.documentElement.lang || '').split('-')[0].toLowerCase() } catch (_) { return '' }
}
const uiLocale = computed(() => {
  const want = String(props.language || cfg.value.locale || cfg.value.lang || hostLocale() || 'en').split('-')[0].toLowerCase()
  return LOCALES.includes(want) ? want : 'en'
})
const uiDir = computed(() => (uiLocale.value === 'ar' ? 'rtl' : 'ltr'))
const tr = (key, params) => translate(uiLocale.value, key, params)
const moreOpen = ref(false)   // the phone "More" menu
// PHONE: the zone list folds behind a ☰ button (test round 2 #8) and opens as a drawer over the
// map; on a wide screen it is the sidebar as before. It used to be simply hidden on a phone, so a
// walker could not see, select, rename or delete a zone there.
const listOpen = ref(false)
const zonesBtn = ref(null), zonesClose = ref(null)
function openZones() { listOpen.value = true; nextTick(() => zonesClose.value?.focus?.()) }
function closeZones() { listOpen.value = false; nextTick(() => zonesBtn.value?.focus?.()) }
function onZonesKey(e) { if (e.key === 'Escape' && listOpen.value) { e.preventDefault(); e.stopPropagation(); closeZones() } }

// The shared controls (Share, Full screen) label themselves through the vue-i18n instance index.js
// installs, which reads only the PAGE language. Inside the Research Gallery the language arrives in
// profile-config instead, so keep that instance on the planner's own locale.
const appI18n = inject('appI18n', null)
watch(uiLocale, (l) => {
  try { if (appI18n && appI18n.global) { if (typeof appI18n.global.locale === 'object') appI18n.global.locale.value = l; else appI18n.global.locale = l } } catch (_) { /* labels stay in the page language */ }
}, { immediate: true })

const INSTANCE_ID = props.instanceId || ('pwp-' + Math.random().toString(36).slice(2, 10))
const STORAGE_KEY = 'prayer-walk-planner:v1:' + INSTANCE_ID

// ─── State ────────────────────────────────────────────────────────────────────
// Each polygon: { id, title, coords: [[lng,lat],...] (closed ring), createdAt, selected }
const polygons = reactive([])
const drawing = ref(false)
const drawPoints = ref([])            // points of the polygon currently being drawn
const statusMsg = ref('')
const editingTitleId = ref(null)

// This profile's own standalone embed page, TREE-RELATIVE (<bundle>/<profile>/index.html),
// taken from the manifest entry rather than hand-composed. ShareButton joins it to the served
// tree root via utils/embedBase.js, so the link works wherever the tree is hosted — never a
// hardcoded /js/doxa-maps/…, which 404s on doxa.life's /js/doxa-maps-build/.
const SHARE_EMBED_PATH = 'prayer-walk-planner/prayer-walk-planner/index.html'

// SAY WHAT THE LINK CARRIES, ONCE, IN THE READER'S OWN WORDS. The link shares the PLANNER,
// not the drawn route — polygons live in localStorage and there is no backend, so a URL
// cannot carry them. Left unsaid, a reader reasonably assumes their zones travel with the
// link and discovers otherwise only after sending it. One line in the status strip that
// already exists, rather than a new surface.
function noteShareScope() {
  const msg = tr('shareScope')
  statusMsg.value = msg
  setTimeout(() => { if (statusMsg.value === msg) statusMsg.value = '' }, 6000)
}

const selectedCount = computed(() => polygons.filter(p => p.selected).length)

// ─── Persistence (localStorage — no backend, see file header) ─────────────────
function loadFromStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      polygons.splice(0, polygons.length, ...parsed.map(p => ({ ...p, selected: false })))
    }
  } catch (e) {
    console.error('[prayer-walk-planner] failed to load localStorage:', e)
  }
}
function saveToStorage() {
  try {
    // Persist without the transient `selected` flag — selection is a session concern.
    const plain = polygons.map(({ selected, ...rest }) => rest)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plain))
  } catch (e) {
    console.error('[prayer-walk-planner] failed to save localStorage:', e)
  }
}

// ─── Map ────────────────────────────────────────────────────────────────────
const mapContainer = ref(null)
const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  provider: 'maplibre',     // keyless — see README.md for the satellite research that ruled this in
  style: 'daylight',
  center: [0, 20],
  zoom: 2,
  showEdgeBorders: false
})

const DRAW_SRC = 'pwp-draw'
const POLY_SRC = 'pwp-polygons'

function ringClosed(coords) {
  if (coords.length < 3) return coords
  const [fx, fy] = coords[0]
  const [lx, ly] = coords[coords.length - 1]
  return (fx === lx && fy === ly) ? coords : [...coords, coords[0]]
}

function polygonsGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: polygons.map(p => ({
      type: 'Feature',
      id: p.id,
      properties: { id: p.id, title: p.title, selected: !!p.selected },
      geometry: { type: 'Polygon', coordinates: [ringClosed(p.coords)] }
    }))
  }
}

function drawGeoJSON() {
  const pts = drawPoints.value
  if (pts.length === 0) return { type: 'FeatureCollection', features: [] }
  const features = []
  features.push({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: pts }, properties: {} })
  if (pts.length >= 2) {
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} })
  }
  if (pts.length >= 3) {
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ringClosed(pts)] }, properties: { preview: true } })
  }
  return { type: 'FeatureCollection', features }
}

function refreshMapSources() {
  if (!map.value || !isMapReady.value) return
  const s1 = map.value.getSource(POLY_SRC)
  if (s1) s1.setData(polygonsGeoJSON())
  const s2 = map.value.getSource(DRAW_SRC)
  if (s2) s2.setData(drawGeoJSON())
}

function setupMapLayers() {
  if (!map.value) return
  map.value.addSource(POLY_SRC, { type: 'geojson', data: polygonsGeoJSON() })
  map.value.addLayer({
    id: 'pwp-polygons-fill', type: 'fill', source: POLY_SRC,
    paint: {
      'fill-color': ['case', ['get', 'selected'], '#92b195', '#6d766e'],
      'fill-opacity': ['case', ['get', 'selected'], 0.35, 0.18]
    }
  })
  map.value.addLayer({
    id: 'pwp-polygons-line', type: 'line', source: POLY_SRC,
    paint: {
      'line-color': ['case', ['get', 'selected'], '#3b463d', '#92b195'],
      'line-width': ['case', ['get', 'selected'], 3, 2]
    }
  })
  map.value.addLayer({
    id: 'pwp-polygons-label', type: 'symbol', source: POLY_SRC,
    layout: {
      ...labelFont(map.value),   // a font the engine's glyph server has (library/maps/label-font.js)
      'text-field': ['get', 'title'],
      'text-size': 12,
      'text-anchor': 'center'
    },
    paint: { 'text-color': '#3b463d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
  })

  map.value.addSource(DRAW_SRC, { type: 'geojson', data: drawGeoJSON() })
  map.value.addLayer({
    id: 'pwp-draw-fill', type: 'fill', source: DRAW_SRC,
    filter: ['==', '$type', 'Polygon'],
    paint: { 'fill-color': '#92b195', 'fill-opacity': 0.25 }
  })
  map.value.addLayer({
    id: 'pwp-draw-line', type: 'line', source: DRAW_SRC,
    filter: ['==', '$type', 'LineString'],
    paint: { 'line-color': '#3b463d', 'line-width': 2, 'line-dasharray': [2, 1] }
  })
  map.value.addLayer({
    id: 'pwp-draw-points', type: 'circle', source: DRAW_SRC,
    filter: ['==', '$type', 'Point'],
    paint: { 'circle-radius': 5, 'circle-color': '#3b463d', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 }
  })

  // Click-to-add-vertex while drawing; click-to-select a finished polygon otherwise.
  map.value.on('click', 'pwp-polygons-fill', (e) => {
    if (drawing.value) return   // drawing takes priority; ignore polygon-body clicks
    const id = e.features?.[0]?.properties?.id
    if (id != null) togglePolygonSelection(String(id))
  })
  map.value.on('click', (e) => {
    if (!drawing.value) return
    // Avoid double-adding when the click also hit the polygon-fill handler above.
    drawPoints.value = [...drawPoints.value, [e.lngLat.lng, e.lngLat.lat]]
    refreshMapSources()
  })
  map.value.on('dblclick', () => { if (drawing.value) finishDrawing() })
}

// ─── Drawing tool ───────────────────────────────────────────────────────────
function startDrawing() {
  if (drawing.value) return
  drawing.value = true
  drawPoints.value = []
  statusMsg.value = tr('clickToPlace')
  if (map.value) map.value.getCanvas().style.cursor = 'crosshair'
}
function stopDrawing() {
  drawing.value = false
  drawPoints.value = []
  statusMsg.value = ''
  if (map.value) map.value.getCanvas().style.cursor = ''
  refreshMapSources()
}
function finishDrawing() {
  if (drawPoints.value.length < 3) {
    statusMsg.value = tr('need3')
    return
  }
  const coords = ringClosed(drawPoints.value)
  const title = tr('zone', { n: polygons.length + 1 })
  addPolygonInternal(coords, title)
  drawing.value = false
  drawPoints.value = []
  if (map.value) map.value.getCanvas().style.cursor = ''
  const added = tr('added')
  statusMsg.value = added
  setTimeout(() => { if (statusMsg.value === added) statusMsg.value = '' }, 2000)
}

// ─── Polygon CRUD — the shared core both the UI buttons and the client-side API call ──
function addPolygonInternal(coords, title) {
  if (!Array.isArray(coords) || coords.length < 3) {
    throw new Error('[prayer-walk-planner] addPolygon needs at least 3 [lng,lat] points')
  }
  const id = 'zone-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
  polygons.push({
    id,
    title: title || tr('zone', { n: polygons.length + 1 }),
    coords: ringClosed(coords),
    createdAt: new Date().toISOString(),
    selected: false
  })
  saveToStorage()
  refreshMapSources()
  return id
}

function deletePolygonInternal(id) {
  const idx = polygons.findIndex(p => p.id === id)
  if (idx === -1) return false
  polygons.splice(idx, 1)
  saveToStorage()
  refreshMapSources()
  return true
}

function togglePolygonSelection(id, selected) {
  const p = polygons.find(p => p.id === id)
  if (!p) return false
  p.selected = (selected === undefined) ? !p.selected : !!selected
  refreshMapSources()
  return true
}

function clearSelectionInternal() {
  polygons.forEach(p => { p.selected = false })
  refreshMapSources()
}

// ─── Print — reuses the poster-wall print-preview-window mechanism ────────────
// (plugin-designs/my-upg-100-list/poster-wall.vue printPoster()): open a same-origin
// blank window (NO 'noopener' — that makes window.open() return null by spec, which
// silently kills the whole flow), document.write generated markup, and call
// window.print() on image/content load. Here the "poster" is generated per-zone HTML
// (title + coordinates + a small static map snapshot) rather than a fetched image,
// since each zone's content is dynamic and never pre-rendered.
function polygonCentroid(coords) {
  let x = 0, y = 0
  const n = coords.length
  for (const [lng, lat] of coords) { x += lng; y += lat }
  return [x / n, y / n]
}
function formatCoord(lng, lat) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return Math.abs(lat).toFixed(5) + '°' + ns + ', ' + Math.abs(lng).toFixed(5) + '°' + ew
}
function staticSnapshotUrl(coords) {
  // OpenFreeMap ships vector styles only (no static-image renderer of its own), so the
  // print snapshot is composed client-side from the SAME keyless MapLibre canvas via
  // getCanvas().toDataURL() at print time — see printInternal(). This helper stays for
  // the coordinate math the caller needs either way.
  return null
}

// The print map's page shape and resolution. 1200x1344 CSS px at pixelRatio 2 = a 2400x2688
// image: about 320 dpi across the 7.5in x 8.4in letter-portrait map frame, so house footprints
// and minor streets stay crisp on paper. The aspect IS the frame's (.snapshot on the sheet); 8.4in
// is what fills the page under the title band and above the charge/corners/credit lines.
const PRINT_W = 1200, PRINT_H = 1344, PRINT_PIXEL_RATIO = 2

// Street and place labels in the reader's language: the shared library/maps/localize-labels.js
// (the same behaviour every map now has; the print map is built raw, so it calls it directly).

// Arabic (and every RTL script) needs the RTL text plugin, and the print map must WAIT for it:
// it captures one frame, and a lazily-loaded plugin can still be in flight. The shared helper
// (library/maps/rtl-text.js) owns the URL and the engine logic; useMapInstance installs it lazily
// for the live map. Measured on the printed Arabic sheet 2026-09-25: without it, unshaped glyphs.
async function renderPrintMap(zone) {
  const gl = typeof window !== 'undefined' && window.maplibregl
  if (!gl) return null
  await ensureRtlTextPlugin(gl)
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const [lng, lat] of zone.coords) {
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
  }
  // Off-screen but LAID OUT: a display:none container has no size and renders nothing.
  const box = document.createElement('div')
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText = `position:fixed;left:-${PRINT_W * 3}px;top:0;width:${PRINT_W}px;height:${PRINT_H}px;pointer-events:none;`
  document.body.appendChild(box)
  let pm = null
  try {
    pm = new gl.Map({
      container: box,
      style: resolveNamedStyle('daylight', 'maplibre').style,   // OpenFreeMap liberty: roads + buildings, keyless
      bounds: [[minLng, minLat], [maxLng, maxLat]],
      fitBoundsOptions: { padding: 90, maxZoom: 18 },
      pixelRatio: PRINT_PIXEL_RATIO,
      interactive: false,
      attributionControl: false,   // the credit is printed as text on the sheet instead
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      preserveDrawingBuffer: true    // pre-v5 spelling of the same option; harmless on v5
    })
    await new Promise((res, rej) => { pm.once('load', res); pm.once('error', (e) => rej(e && e.error || e)); setTimeout(() => rej(new Error('style load timeout')), 30000) })
    localizeBasemapLabels(pm, uiLocale.value)
    // The zone on top: a light wash so the streets inside stay readable, a white casing and a
    // strong outline so the boundary survives a grey-scale office printer.
    pm.addSource('pwp-print-zone', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ringClosed(zone.coords)] } } })
    pm.addLayer({ id: 'pwp-print-fill', type: 'fill', source: 'pwp-print-zone', paint: { 'fill-color': '#92b195', 'fill-opacity': 0.12 } })
    pm.addLayer({ id: 'pwp-print-casing', type: 'line', source: 'pwp-print-zone', paint: { 'line-color': '#ffffff', 'line-width': 9 } })
    pm.addLayer({ id: 'pwp-print-line', type: 'line', source: 'pwp-print-zone', paint: { 'line-color': '#1f5f3a', 'line-width': 5 } })
    // Wait until every tile for this view has loaded AND painted.
    await new Promise((res) => { const done = () => { if (pm.loaded() && pm.areTilesLoaded()) res(); else pm.once('idle', done) }; pm.once('idle', done); setTimeout(res, 25000) })
    return await new Promise((res) => {
      pm.once('render', () => { try { res(pm.getCanvas().toDataURL('image/png')) } catch (_) { res(null) } })
      pm.triggerRepaint()
    })
  } finally {
    try { pm && pm.remove() } catch (_) { /* release the GL context either way */ }
    box.remove()
  }
}

async function printInternal(ids) {
  const targets = ids && ids.length
    ? polygons.filter(p => ids.includes(p.id))
    : polygons.filter(p => p.selected)
  if (targets.length === 0) {
    statusMsg.value = tr('selectOne')
    return { opened: false, count: 0 }
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))

  // ── PER-ZONE PRINT MAP: a PAGE-SHAPED, PRINT-RESOLUTION render of each zone ──────────────
  // The printed map was a ~10px sliver. Cause, measured 2026-09-25: print used to
  // fitBounds the LIVE map and snapshot its canvas, so the printed image was exactly the size
  // and shape of whatever the live map happened to be on screen: 747x76 inside the Research
  // Gallery, which is the sliver. Even full-page it was screen-resolution and screen-shaped.
  // Now each zone renders in its OWN temporary MapLibre instance: page-shaped, pixelRatio 2,
  // keyless OpenFreeMap vector tiles with roads and building footprints, the zone outline on top.
  // It never touches the reader's live map, and it is destroyed as soon as its pixels are taken,
  // so it costs one WebGL context for about a second.
  statusMsg.value = tr('preparing')
  const shots = {}
  for (const p of targets) {
    try { shots[p.id] = await renderPrintMap(p) } catch (e) {
      console.error('[prayer-walk-planner] print map failed for', p.title, e)
    }
    if (!shots[p.id]) delete shots[p.id]
  }
  if (statusMsg.value === tr('preparing')) statusMsg.value = ''

  const dateStr = esc(new Date().toLocaleDateString(uiLocale.value))
  // Coordinates are Latin digits and N/S/E/W inside possibly-RTL prose: isolate each one LTR, or the
  // bidi algorithm reorders it (measured on the Arabic sheet: "°41.03024E28.94888° ,N").
  const ltr = (t) => '<bdi dir="ltr">' + esc(t) + '</bdi>'
  const pages = targets.map((p) => {
    const [clng, clat] = polygonCentroid(p.coords)
    const pointList = p.coords.slice(0, -1).map(([lng, lat]) => ltr(formatCoord(lng, lat))).join(' &nbsp;&middot;&nbsp; ')
    const img = shots[p.id]
    return (
      '<section class="zone-page">' +
        '<header class="band"><h1>' + esc(p.title) + '</h1>' +
        '<p class="kicker">' + esc(tr('kicker', { c: '\u0000' })).replace('\u0000', ltr(formatCoord(clng, clat))) + '</p></header>' +
        (img ? '<figure class="mapframe"><img class="snapshot" src="' + img + '" alt="' + esc(tr('mapAlt', { title: p.title })) + '"></figure>' : '') +
        '<p class="charge">' + esc(tr('charge')) + '</p>' +
        '<p class="points"><b>' + esc(tr('corners')) + ':</b> ' + pointList + '</p>' +
        '<p class="footer">' + esc(tr('footer', { date: '\u0000' })).replace('\u0000', dateStr) + '</p>' +
      '</section>'
    )
  }).join('')

  const title = targets.length === 1 ? tr('docTitleOne') : tr('docTitleMany', { n: targets.length })
  // printDocument: the in-place frame on desktop, the page itself on a phone (printInPlace.js says why).
  const how = await printDocument(
    '<!DOCTYPE html><html lang="' + uiLocale.value + '" dir="' + uiDir.value + '"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
    '<style>' +
      // letter portrait explicitly -- size:auto lets the browser pick landscape (the same
      // defect the poster path fixed in 839b0c4); a walking sheet is a portrait document.
      '@page{size:letter portrait;margin:12mm}' +
      'html,body{margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#3b463d}' +
      // ONE ZONE = ONE PAGE a person carries on the walk: the section never splits, and the map
      // takes the page. 8.4in tall at the full 7.5in printable width, the same 1200:1344 shape
      // the print map is rendered at (PRINT_W/PRINT_H), so nothing is cropped or letterboxed.
      '.zone-page{page-break-after:always;break-inside:avoid;margin:0 auto}' +
      '.zone-page:last-child{page-break-after:auto}' +
      // The poster design language: a dark-green title band like the UPG poster header,
      // the map in a framed figure, quiet uppercase kickers -- material light palette only.
      '.band{background:#3b463d;color:#fff;border-radius:6px;padding:8px 14px;margin:0 0 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      'h1{font-size:20px;margin:0;letter-spacing:-0.01em}' +
      '.kicker{margin:2px 0 0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#d1d4cd}' +
      '.mapframe{margin:0;border:1px solid #d1d4cd;border-radius:4px;overflow:hidden}' +
      '.snapshot{display:block;width:100%;height:8.4in;object-fit:cover}' +
      '.charge{font-size:12px;line-height:1.45;color:#3b463d;margin:6px 0 0}' +
      '.points{font-size:9.5px;line-height:1.5;color:#6d766e;margin:4px 0 0}' +
      '.footer{margin-top:4px;font-size:9px;color:#6d766e;border-top:1px solid #d1d4cd;padding-top:4px}' +
    '</style></head><body>' + pages + '</body></html>',
    { labels: { print: tStatic('wall.hud.printNow') || 'Print', close: tStatic('buttons.close') || 'Close' } },
  )
  if (how === 'blocked') {
    statusMsg.value = tr('printUnavailable')
    return { opened: false, count: 0 }
  }
  return { opened: true, count: targets.length }
}

// ─── Public API (both surfaces call these) ─────────────────────────────────────
function addPolygon(coords, title) { return addPolygonInternal(coords, title) }
function deletePolygon(id) { return deletePolygonInternal(id) }
function selectPolygon(id, selected = true) { return togglePolygonSelection(id, selected) }
function clearSelection() { clearSelectionInternal() }
function listPolygons() { return polygons.map(p => ({ ...p })) }
function getPolygon(id) { const p = polygons.find(p => p.id === id); return p ? { ...p } : null }
function print(ids = null) { return printInternal(ids) }   // async: resolves once the dialog is raised
// The print-resolution PNG (data URL) for one zone, WITHOUT opening the print dialog: for an agent
// that wants to save or send the map, and for the gate that proves the print shows streets.
async function renderZoneMap(id) { const p = polygons.find(p => p.id === id); return p ? renderPrintMap(p) : null }

defineExpose({
  addPolygon, deletePolygon, selectPolygon, clearSelection,
  listPolygons, getPolygon, print, renderZoneMap,
  startDrawing, stopDrawing,
  // NOT `instanceId`: that name is already the element's PROP (the attribute a host sets, maybe
  // empty), and exposing a second member under it made Vue warn "Exposed property 'instanceId'
  // already exists on custom element". This is the RESOLVED id, the one the registry keys on.
  resolvedInstanceId: INSTANCE_ID
})

// ─── window global registry (discovery-friendly, mirrors window.DOXA_SLOTS etc.) ──
function registerGlobal() {
  if (typeof window === 'undefined') return
  const api = {
    addPolygon, deletePolygon, selectPolygon, clearSelection,
    listPolygons, getPolygon, print, renderZoneMap, startDrawing, stopDrawing,
    instanceId: INSTANCE_ID
  }
  window.PrayerWalkPlanner = window.PrayerWalkPlanner || { instances: {} }
  window.PrayerWalkPlanner.instances[INSTANCE_ID] = api
  window.PrayerWalkPlanner.first = () => {
    const keys = Object.keys(window.PrayerWalkPlanner.instances)
    return keys.length ? window.PrayerWalkPlanner.instances[keys[0]] : null
  }
}
function unregisterGlobal() {
  if (typeof window === 'undefined' || !window.PrayerWalkPlanner) return
  delete window.PrayerWalkPlanner.instances[INSTANCE_ID]
}

// ─── UI actions (buttons call the same core functions) ─────────────────────────
function onDrawClick() { drawing.value ? stopDrawing() : startDrawing() }
function onFinishClick() { finishDrawing() }
function onDeleteSelected() {
  const toDelete = polygons.filter(p => p.selected).map(p => p.id)
  toDelete.forEach(id => deletePolygonInternal(id))
}
function onSelectAll() { polygons.forEach(p => { p.selected = true }); refreshMapSources() }
function onClearSelection() { clearSelectionInternal() }
// Printing renders one off-screen map per selected zone and waits for its tiles: seconds, not a
// click. The button shows it is busy and cannot start a second print meanwhile.
const printBusy = ref(false)
async function onPrintClick() {
  if (printBusy.value) return
  printBusy.value = true
  try { await printInternal(null) } finally { printBusy.value = false }
}
function startRename(id) { editingTitleId.value = id }
function commitRename(id, value) {
  const p = polygons.find(p => p.id === id)
  if (p) { p.title = (value || '').trim() || p.title; saveToStorage(); refreshMapSources() }
  editingTitleId.value = null
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  loadFromStorage()
  // Register the client-side API BEFORE touching the map. An agent (or the
  // localStorage-backed polygon list / print flow) must work even if the map
  // engine itself fails to init — e.g. no WebGL context in a headless/CI
  // browser (documentation/reference.md: "there is no hardware WebGL... the
  // MCP/default browser here has no GL at all"). Drawing needs a live map to
  // pick coordinates from clicks, but addPolygon/deletePolygon/print/list do not.
  registerGlobal()
  await nextTick()
  try {
    await initializeMap()
    if (map.value) {
      map.value.on('load', () => { localizeBasemapLabels(map.value, uiLocale.value); setupMapLayers(); refreshMapSources() })
    }
  } catch (e) {
    console.error('[prayer-walk-planner] map failed to initialize — polygon list, localStorage and print still work:', e)
    statusMsg.value = tr('mapFailed')
  }
})
onBeforeUnmount(() => {
  unregisterGlobal()
  destroy()
})

useShadowStyles(
  ':host{display:block;position:relative;width:100%;height:100%;min-height:420px}' +
  '.pwp{position:absolute;inset:0;display:flex;flex-direction:column;background:#f3f3f1;color:#3b463d;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.pwp-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;' +
    'background:#fff;border-bottom:1px solid #d1d4cd;z-index:5}' +
  '.pwp-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:6px;' +
    'border:1px solid #d1d4cd;background:#fff;color:#3b463d;font-size:13px;font-weight:600;cursor:pointer}' +
  '.pwp-btn:hover{border-color:#92b195}' +
  '.pwp-btn.is-active{background:#92b195;border-color:#92b195;color:#fff}' +
  '.pwp-btn.is-accent{background:#92b195;border-color:#92b195;color:#fff}' +
  '.pwp-btn.is-accent:hover{opacity:.9}' +
  '.pwp-btn.busy{cursor:progress;opacity:.75}' +
  ".pwp-btn.busy::after{content:'';display:inline-block;width:.8em;height:.8em;margin-inline-start:.5em;vertical-align:-.1em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:pwp-spin .8s linear infinite}" +
  '@keyframes pwp-spin{to{transform:rotate(360deg)}}' +
  '@media (prefers-reduced-motion:reduce){.pwp-btn.busy::after{animation:none}}' +
  '.pwp-btn:disabled{opacity:.45;cursor:not-allowed}' +
  '.pwp-btn.is-danger{color:#8a3b3b;border-color:#e0c4c4}' +
  '.pwp-spacer{flex:1}' +
  '.pwp-more-btn{display:none}' +
  '.pwp-listops{display:contents}' +
  '.pwp-count{font-size:12px;color:#6d766e}' +
  '.pwp-status{padding:6px 12px;font-size:12px;color:#6d766e;background:#fff;border-bottom:1px solid #d1d4cd}' +
  '.pwp-body{position:relative;flex:1;min-height:0;display:flex}' +
  '.pwp-map{position:relative;flex:1;min-width:0}' +
  '.pwp-map-el{position:absolute;inset:0}' +
  '.pwp-map-controls{position:absolute;top:10px;right:10px;z-index:4;display:flex;flex-direction:column;gap:8px}' +
  '.pwp[dir=rtl] .pwp-map-controls{right:auto;left:10px}' +
  '.pwp-list{width:260px;flex-shrink:0;overflow-y:auto;background:#fff;border-inline-start:1px solid #d1d4cd;padding:8px}' +
  '.pwp-zones-btn,.pwp-list-head,.pwp-backdrop{display:none}' +
  '.pwp-list-empty{padding:16px 10px;font-size:12px;color:#6d766e}' +
  '.pwp-item{display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;margin-bottom:4px;' +
    'border:1px solid transparent;cursor:pointer}' +
  '.pwp-item:hover{background:#f3f3f1}' +
  '.pwp-item.is-selected{background:rgba(146,177,149,.18);border-color:#92b195}' +
  '.pwp-item-title{flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.pwp-item-title-input{flex:1;font-size:13px;font-weight:600;padding:2px 4px;border:1px solid #92b195;border-radius:4px}' +
  '.pwp-item-del{border:none;background:transparent;color:#8a3b3b;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px}' +
  '.pwp-item-del:hover{background:rgba(138,59,59,.12)}' +
  // PHONE: the list is a drawer from the reading-end edge, over the map, behind the ☰ Zones button.
  '@media (max-width:640px){' +
    '.pwp-list{display:none;position:absolute;inset-block:0;inset-inline-end:0;width:min(300px,86%);z-index:7;' +
      'box-shadow:0 0 24px rgba(0,0,0,.22);border-inline-start:none}' +
    '.pwp-list.is-open{display:block}' +
    '.pwp-list-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 2px 8px;' +
      'margin-bottom:6px;border-bottom:1px solid #eceee9;font-size:13px;font-weight:700}' +
    '.pwp-list-x{border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#6d766e;' +
      'min-width:36px;min-height:36px;border-radius:6px}' +
    '.pwp-backdrop{display:block;position:absolute;inset:0;z-index:6;background:rgba(20,28,22,.28)}' +
    '.pwp-zones-btn{display:inline-flex;order:-3}' +
  '}' +
  // PHONE: ONE ROW, SCROLLED SIDEWAYS, instead of a toolbar that wrapped to three rows (139px of a
  // 844px screen, measured 2026-09-25) above the map a walker is trying to read. Nothing is clipped:
  // the row scrolls, labels never truncate. The two actions a walk needs, Draw and Print, lead the
  // row so they are always on screen; the list-management buttons follow.
  '@media (max-width:640px){' +
    '.pwp-toolbar{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:8px 10px;gap:6px}' +
    '.pwp-toolbar::-webkit-scrollbar{display:none}' +
    '.pwp-toolbar>*{flex:0 0 auto}' +
    '.pwp-btn{white-space:nowrap;padding:8px 12px}' +
    '.pwp-spacer{display:none}' +
    '.pwp-draw{order:-2}.pwp-print{order:-1}' +
    // One row that FITS (Draw, Print, More, count) instead of a sideways scroll with no cue; the
    // three list actions open as their own full-width row under it.
    '.pwp-toolbar{flex-wrap:wrap;overflow:visible}' +
    '.pwp-more-btn{display:inline-flex}' +
    '.pwp-listops{display:none;flex-basis:100%;flex-wrap:wrap;gap:6px}' +
    '.pwp-listops.is-open{display:flex}' +
  '}'
)
</script>

<template>
  <div class="pwp" :dir="uiDir" :lang="uiLocale">
    <div class="pwp-toolbar">
      <!-- PHONE: the zone list's hamburger (hidden on a wide screen, where the list is a sidebar). -->
      <button ref="zonesBtn" type="button" class="pwp-btn pwp-zones-btn" :aria-expanded="listOpen ? 'true' : 'false'"
        aria-controls="pwp-zone-list" @click="listOpen ? closeZones() : openZones()">☰ {{ tr('zones', { n: polygons.length }) }}</button>
      <button type="button" class="pwp-btn pwp-draw" :class="{ 'is-active': drawing }"
        :aria-pressed="drawing" @click="onDrawClick">
        {{ drawing ? tr('drawing') : tr('draw') }}
      </button>
      <button v-if="drawing" type="button" class="pwp-btn is-accent"
        :disabled="drawPoints.length < 3" @click="onFinishClick">
        {{ tr('finish', { n: drawPoints.length }) }}
      </button>
      <!-- PHONE: these three collapse behind "More" (they ran past x=390 in a sideways row with no
           scroll cue, measured ka3). Desktop: the toggle is hidden and they sit inline as before. -->
      <button type="button" class="pwp-btn pwp-more-btn" :aria-expanded="moreOpen ? 'true' : 'false'" @click="moreOpen = !moreOpen">⋯ {{ tr('more') }}</button>
      <div class="pwp-listops" :class="{ 'is-open': moreOpen }" @click="moreOpen = false">
        <button type="button" class="pwp-btn is-danger" :disabled="selectedCount === 0"
          @click="onDeleteSelected" :aria-label="tr('deleteSelectedAria')">
          {{ tr('deleteSelected') }}
        </button>
        <button type="button" class="pwp-btn" :disabled="polygons.length === 0" @click="onSelectAll">
          {{ tr('selectAll') }}
        </button>
        <button type="button" class="pwp-btn" :disabled="selectedCount === 0" @click="onClearSelection">
          {{ tr('clearSelection') }}
        </button>
      </div>
      <div class="pwp-spacer"></div>
      <span class="pwp-count">{{ tr('countSelected', { n: selectedCount, total: polygons.length }) }}</span>
      <button type="button" class="pwp-btn is-accent pwp-print" :class="{ busy: printBusy }"
        :disabled="selectedCount === 0 || printBusy" :aria-busy="printBusy ? 'true' : 'false'"
        @click="onPrintClick" :aria-label="tr('printAria')">
        {{ tr('printSelected') }}
      </button>
      <!-- SHARE THE TOOL, NOT THE ROUTE — and that distinction is the whole reason this
           button took a second look rather than being added with the others.
           This profile was published, embeddable and reachable with NO sharing path by any
           mechanism, the last of the two check:share-policy recorded as 'debt-no-share'.
           The worry that held it back was real: a share link that silently drops the reader's
           drawn route arrives as an empty planner, and a button that reliably produces a blank
           map is worse than none, because it LOOKS like sharing worked.
           ★ The code answers it, so no ruling was needed. Polygons live in localStorage and
           there is NO BACKEND (see this file's header) — the route is device-local, so a URL
           CANNOT carry it. There is no design freedom to exercise: the shareable artefact is
           the planner itself, exactly as every other map shares its own page. The failure mode
           only exists if the link CLAIMS to carry the route, so the label says "tool" and the
           status line below says it in the reader's own words the first time it is used. -->
      <ShareButton :is-dark="false" :embed-path="SHARE_EMBED_PATH" @click="noteShareScope" />
    </div>
    <div v-if="statusMsg" class="pwp-status">{{ statusMsg }}</div>

    <div class="pwp-body">
      <div class="pwp-map">
        <div ref="mapContainer" class="pwp-map-el"></div>
        <!-- FULL SCREEN for the WHOLE planner (toolbar + map), not just the canvas: the shared
             FullscreenButton requests fullscreen on this element's custom-element host, and falls
             back to a CSS pseudo-fullscreen where the API does not exist (iOS Safari). A planner
             embedded in a partner page or the gallery can take the whole screen for drawing. -->
        <!-- The "?" asks the host for this map's help (doxa:help); it shows only where a host answers. -->
        <div class="pwp-map-controls"><FullscreenButton :map-container="mapContainer" /><HelpButton hosted /></div>
      </div>
      <div v-if="listOpen" class="pwp-backdrop" @click="closeZones"></div>
      <div id="pwp-zone-list" class="pwp-list" :class="{ 'is-open': listOpen }" @keydown="onZonesKey">
        <div class="pwp-list-head">
          <span>{{ tr('zones', { n: polygons.length }) }}</span>
          <button ref="zonesClose" type="button" class="pwp-list-x" :aria-label="tr('closeZones')" @click="closeZones">×</button>
        </div>
        <div v-if="polygons.length === 0" class="pwp-list-empty">
          {{ tr('emptyList') }}
        </div>
        <div v-for="p in polygons" :key="p.id" class="pwp-item"
          :class="{ 'is-selected': p.selected }" @click="togglePolygonSelection(p.id)">
          <input v-if="editingTitleId === p.id" class="pwp-item-title-input" type="text"
            :value="p.title" @click.stop
            @keydown.enter="commitRename(p.id, $event.target.value)"
            @blur="commitRename(p.id, $event.target.value)" autofocus />
          <span v-else class="pwp-item-title" @dblclick.stop="startRename(p.id)" :title="p.title">
            {{ p.title }}
          </span>
          <button type="button" class="pwp-item-del" @click.stop="deletePolygonInternal(p.id)"
            :aria-label="tr('deleteAria', { title: p.title })">
            {{ tr('delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
