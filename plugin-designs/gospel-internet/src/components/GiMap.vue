<script setup>
// What this instance put on window, recorded AS IT IS SET so unmount can tell its own values
// from another instance's. Two of these can share a page; clearing by NAME alone would let the
// second unmount delete the first's live hooks.
const ownGlobals = Object.create(null)
function setGlobal(name, value) {
  try { window[name] = value; ownGlobals[name] = value } catch (_) {}
}
/**
 * GiMap.vue — the board's map: countries shaded by internet band, India's states and China's provinces
 * outlined (and shaded on request), and one pin per people group.
 *
 * ONE ENGINE SWITCH. The engine comes from resolveMapProvider (profile-config provider / token), the
 * style from the style registry ('paper' = Mapbox light / OpenFreeMap positron), labels in the reader's
 * language, RTL shaping installed before `new Map`. Nothing below branches on the engine: every layer
 * and expression here is valid on both Mapbox GL and MapLibre (fill, line, circle; match/step/case;
 * feature-state with promoteId). No symbol layers, so no glyph font to 404 on OpenFreeMap.
 *
 * THE KIT'S THREE CHANNELS, and what each is allowed to do here (SPEC-DASHBOARD-KIT section 5.2, D3):
 *   filterSet    NARROWS — pins outside the scope FADE (never vanish), countries with no group in scope
 *                fade; clicking a country or province toggles that facet (a map region is a filter).
 *   selection    MARKS — a ring; and ONE camera move per committed change, debounced, a JUMP under
 *                reduced motion (glue to useSelectionCamera's contract until kit landing 3 reaches main).
 *   hoverKey     POINTS — an outline on the hovered pin, from the grid or the map. It never flies,
 *                never selects, never filters.
 *
 * HONESTY: a pin marks a people group, not a town, and its position is approximate (the legend says so, and
 * how many share a point); the band is the COUNTRY's figure; a state's NFHS-5 figure is the state's.
 */
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, markRaw, inject } from 'vue'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import MapToolbar from '@map/components/map-controls/MapToolbar.vue'
import ZoomInButton from '@map/components/map-controls/ZoomInButton.vue'
import ZoomOutButton from '@map/components/map-controls/ZoomOutButton.vue'
import ShareButton from '@map/components/map-controls/ShareButton.vue'
import HelpButton from '@map/components/map-controls/HelpButton.vue'
import { useBoardState, EMBED_PATH } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { createWhiteboardMap, reducedMotion } from '@map/maps/whiteboard-map.js'
import { ACCESS_DETAILS, BANDS, DETAIL_FILL, DETAIL_RIM, BAND_COLOR, label } from '../model.js'

const T = useGiT()
const board = useBoardState()
const { bus } = board
const injectedToken = inject('mapboxToken', null)   // tokenUrl / shared page token, via ProfileLoader

const mapEl = ref(null)
const mapRef = shallowRef(null)
const err = ref('')
const ready = ref(false)
// Province shading: 'zero' = groups with nothing found in their own language (from the rows in scope),
// 'women' / 'men' = NFHS-5 ever used the internet (India only; China has no verified provincial source).
const provinceMode = ref('zero')
// Legends start collapsed, one tap on "Legend" opens them; the embed knob legend:"open" opens them
const legendOpen = ref(board.profileConfig.value?.legend === 'open')
let unmounted = false
let adm1Table = null     // { [shapeName]: { women, men } } India, NFHS-5
const nfhsAttribution = ref('')

// ── pins ────────────────────────────────────────────────────────────────────────────────────────────
function pinFC() {
  const inScope = new Set(board.filtered.value.map((r) => r.slug))
  const feats = []
  for (const r of board.all.value) {
    if (!Number.isFinite(r.lng) || !Number.isFinite(r.lat)) continue
    feats.push({
      type: 'Feature',
      properties: { slug: r.slug, d: r.access_detail, pop: Number(r.population) || 0, m: inScope.has(r.slug) ? 1 : 0,
        // "Nothing in own language" draws on top: a hole must never hide under a dot.
        z: r.access_detail === 'none' ? 2 : 1 },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    })
  }
  return { type: 'FeatureCollection', features: feats }
}
const matchExpr = (table, fallback) => ['match', ['get', 'd'], ...ACCESS_DETAILS.flatMap((d) => [d, table[d]]), fallback]
// Sized by population on a square-root scale (area ~ people), clamped so a 100-person group is still a
// target and a 50-million group does not blanket a state.
// A zoom interpolate must be the TOP-LEVEL expression on both engines, so the ring and hover layers get
// their own (+k on every stop) rather than wrapping this one in a '+'.
const radiusPlus = (k) => ['interpolate', ['linear'], ['zoom'],
  1, ['interpolate', ['linear'], ['sqrt', ['get', 'pop']], 0, 2.2 + k, 1000, 3.4 + k, 7000, 6.5 + k],
  6, ['interpolate', ['linear'], ['sqrt', ['get', 'pop']], 0, 4 + k, 1000, 6.5 + k, 7000, 12 + k]]
const radius = radiusPlus(0)

function addPins(map) {
  map.addSource('gi-pins', { type: 'geojson', data: pinFC() })
  map.addLayer({ id: 'gi-pins', type: 'circle', source: 'gi-pins', paint: {
    'circle-radius': radius,
    'circle-color': matchExpr(DETAIL_FILL, '#92b195'),
    'circle-stroke-color': matchExpr(DETAIL_RIM, '#ffffff'),
    'circle-stroke-width': ['case', ['==', ['get', 'd'], 'none'], 2, 1],
    'circle-opacity': ['case', ['==', ['get', 'm'], 1], 0.95, 0.12],
    'circle-stroke-opacity': ['case', ['==', ['get', 'm'], 1], 1, 0.15],
  }, layout: { 'circle-sort-key': ['+', ['get', 'z'], ['get', 'm']] } })
  // selection ring (MARKS) and hover outline (POINTS): separate layers, so neither repaints the pins
  map.addLayer({ id: 'gi-pins-sel', type: 'circle', source: 'gi-pins', filter: ['in', ['get', 'slug'], ['literal', []]], paint: {
    'circle-radius': radiusPlus(4), 'circle-color': 'rgba(0,0,0,0)',
    'circle-stroke-color': '#3b463d', 'circle-stroke-width': 2.5,
  } })
  map.addLayer({ id: 'gi-pins-hover', type: 'circle', source: 'gi-pins', filter: ['==', ['get', 'slug'], ''], paint: {
    'circle-radius': radiusPlus(3), 'circle-color': 'rgba(0,0,0,0)',
    'circle-stroke-color': '#e8a33d', 'circle-stroke-width': 2.5,
  } })
  map.on('click', 'gi-pins', (e) => {
    const f = e.features && e.features[0]
    if (f) { e.originalEvent && (e.originalEvent.__giPin = true); board.openGroup(f.properties.slug) }
  })
  map.on('mousemove', 'gi-pins', (e) => {
    map.getCanvas().style.cursor = 'pointer'
    const f = e.features && e.features[0]
    if (f) bus.setHover(f.properties.slug)
  })
  map.on('mouseleave', 'gi-pins', () => { map.getCanvas().style.cursor = ''; bus.setHover(null) })
}

// ── countries by band (promoteId iso3, so the scope fade is a feature-state, not a re-upload) ─────────
const bandByIso = () => {
  const m = {}
  for (const r of board.all.value) m[r.iso3] = r.internet_band
  return m
}
function addCountries(map, adm0) {
  const bands = bandByIso()
  const fc = { type: 'FeatureCollection', features: (adm0.features || []).map((f) => ({
    type: 'Feature', geometry: f.geometry,
    properties: { iso3: f.properties.iso3, band: bands[f.properties.iso3] || '' },
  })) }
  map.addSource('gi-adm0', { type: 'geojson', data: fc, promoteId: 'iso3' })
  map.addLayer({ id: 'gi-adm0-fill', type: 'fill', source: 'gi-adm0', paint: {
    'fill-color': ['match', ['get', 'band'], ...BANDS.flatMap((b) => [b, BAND_COLOR[b]]), 'rgba(0,0,0,0)'],
    'fill-opacity': ['case', ['==', ['get', 'band'], ''], 0,
      ['boolean', ['feature-state', 'inScope'], true], 0.42, 0.1],
  } })
  map.addLayer({ id: 'gi-adm0-line', type: 'line', source: 'gi-adm0', paint: {
    'line-color': ['case', ['boolean', ['feature-state', 'picked'], false], '#3b463d', 'rgba(255,255,255,0.7)'],
    'line-width': ['case', ['boolean', ['feature-state', 'picked'], false], 1.6, 0.5],
  } })
  map.on('click', 'gi-adm0-fill', (e) => {
    if (e.originalEvent && e.originalEvent.__giPin) return
    if (map.queryRenderedFeatures(e.point, { layers: ['gi-pins', 'gi-adm1-fill'].filter((l) => map.getLayer(l)) }).length) return
    const iso = e.features && e.features[0] && e.features[0].properties.iso3
    if (iso && bands[iso]) bus.toggleFilterValue('country', iso)
  })
}

// ── India's states + China's provinces ───────────────────────────────────────────────────────────────
const ADM1_STEPS = ['#f3f3f1', '#e7c9c2', '#c98f83', '#a55a4b', '#7d3b30']   // zero-access groups: 0,1-2,3-5,6-10,11+
const NFHS_STEPS = ['#deebf7', '#9ecae1', '#6baed6', '#3182bd', '#08519c']   // Cities with Internet's ADM1 ramp
function adm1Fill(mode) {
  if (mode === 'women' || mode === 'men') {
    return ['case', ['==', ['typeof', ['get', mode]], 'number'],
      ['step', ['get', mode], NFHS_STEPS[0], 25, NFHS_STEPS[1], 40, NFHS_STEPS[2], 55, NFHS_STEPS[3], 70, NFHS_STEPS[4]],
      'rgba(0,0,0,0)']
  }
  return ['step', ['coalesce', ['feature-state', 'zero'], 0], 'rgba(0,0,0,0)', 1, ADM1_STEPS[1], 3, ADM1_STEPS[2], 6, ADM1_STEPS[3], 11, ADM1_STEPS[4]]
}
function addProvinces(map, ind, chn) {
  const feats = []
  for (const [iso3, geo] of [['IND', ind], ['CHN', chn]]) {
    for (const f of (geo && geo.features) || []) {
      const name = f.properties.shapeName
      const a = iso3 === 'IND' && adm1Table ? adm1Table[name] : null
      feats.push({ type: 'Feature', geometry: f.geometry, properties: {
        key: `${iso3}|${name}`, iso3, name, women: a && a.women != null ? a.women : null, men: a && a.men != null ? a.men : null,
      } })
    }
  }
  map.addSource('gi-adm1', { type: 'geojson', data: { type: 'FeatureCollection', features: feats }, promoteId: 'key' })
  map.addLayer({ id: 'gi-adm1-fill', type: 'fill', source: 'gi-adm1', paint: { 'fill-color': adm1Fill(provinceMode.value), 'fill-opacity': 0.78 } }, 'gi-pins')
  map.addLayer({ id: 'gi-adm1-line', type: 'line', source: 'gi-adm1', paint: {
    'line-color': ['case', ['boolean', ['feature-state', 'picked'], false], '#3b463d', 'rgba(59,70,61,0.45)'],
    'line-width': ['case', ['boolean', ['feature-state', 'picked'], false], 1.8, 0.6],
  } }, 'gi-pins')
  map.on('click', 'gi-adm1-fill', (e) => {
    if (e.originalEvent && e.originalEvent.__giPin) return
    if (map.queryRenderedFeatures(e.point, { layers: ['gi-pins'] }).length) return
    const p = e.features && e.features[0] && e.features[0].properties
    if (p) bus.toggleFilterValue('province', p.name)
  })
}
function setProvinceMode(mode) {
  provinceMode.value = mode
  const map = mapRef.value
  if (map && map.getLayer('gi-adm1-fill')) map.setPaintProperty('gi-adm1-fill', 'fill-color', adm1Fill(mode))
}

// ── scope -> map (one pass per committed filter change) ───────────────────────────────────────────────
let lastPicked = { country: [], province: [] }
function paintScope() {
  const map = mapRef.value
  if (!map || !ready.value) return
  try { map.getSource('gi-pins').setData(pinFC()) } catch (_) {}
  const inCountry = new Set()
  const zeroBy = {}
  for (const r of board.filtered.value) {
    inCountry.add(r.iso3)
    if (r.province && r.access_detail === 'none') zeroBy[`${r.iso3}|${r.province}`] = (zeroBy[`${r.iso3}|${r.province}`] || 0) + 1
  }
  const scoped = Object.keys(bus.filterSet).length > 0 || !!bus.searchTerm.value
  for (const iso of new Set(board.all.value.map((r) => r.iso3))) {
    try { map.setFeatureState({ source: 'gi-adm0', id: iso }, { inScope: !scoped || inCountry.has(iso) }) } catch (_) {}
  }
  if (map.getSource('gi-adm1')) {
    for (const f of provinceKeys) {
      try { map.setFeatureState({ source: 'gi-adm1', id: f }, { zero: zeroBy[f] || 0 }) } catch (_) {}
    }
  }
  // a picked country / province gets a dark outline (the facet made visible where it applies)
  const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])
  for (const iso of lastPicked.country) try { map.setFeatureState({ source: 'gi-adm0', id: iso }, { picked: false }) } catch (_) {}
  for (const k of lastPicked.province) try { map.setFeatureState({ source: 'gi-adm1', id: k }, { picked: false }) } catch (_) {}
  const pc = asList(bus.filterSet.country)
  const pp = asList(bus.filterSet.province).flatMap((n) => provinceKeys.filter((k) => k.endsWith('|' + n)))
  for (const iso of pc) try { map.setFeatureState({ source: 'gi-adm0', id: iso }, { picked: true }) } catch (_) {}
  for (const k of pp) try { map.setFeatureState({ source: 'gi-adm1', id: k }, { picked: true }) } catch (_) {}
  lastPicked = { country: pc, province: pp }
}
let provinceKeys = []
watch(() => board.filtered.value, paintScope)

// ── selection -> ring + camera (glue to kit useSelectionCamera: debounce 150, one move, jump if reduced) ──
const CAMERA = { DEBOUNCE: 150, DURATION: 1200, PADDING: 70, FIT_MAX_ZOOM: 5.5, SINGLE_ZOOM: 5.2, WIDE_SPAN: 110 }
let camTimer = null
function moveCamera(target) {
  const map = mapRef.value
  if (!map || !target) return
  // Read LIVE, never cached: the preference can change mid-session. Under it we JUMP: same destination,
  // zero traversal (jumpTo / fitBounds duration 0 — useMapFly.flyToCoords drops its options).
  const duration = reducedMotion() ? 0 : CAMERA.DURATION
  try {
    if (target.point) {
      const z = Math.max(map.getZoom(), CAMERA.SINGLE_ZOOM)
      if (duration === 0) map.jumpTo({ center: target.point, zoom: z })
      else map.flyTo({ center: target.point, zoom: z, duration, essential: true })
    } else {
      map.fitBounds(target.bounds, { padding: CAMERA.PADDING, maxZoom: CAMERA.FIT_MAX_ZOOM, duration, essential: true })
    }
  } catch (_) { /* degenerate bounds: never break the board */ }
}
function boundsOf(rows) {
  const pts = rows.filter((r) => Number.isFinite(r.lng) && Number.isFinite(r.lat) && !(r.lng === 0 && r.lat === 0))
  if (!pts.length) return null
  if (pts.length === 1) return { point: [pts[0].lng, pts[0].lat] }
  let w = 180, s = 90, e = -180, n = -90
  for (const r of pts) { w = Math.min(w, r.lng); e = Math.max(e, r.lng); s = Math.min(s, r.lat); n = Math.max(n, r.lat) }
  if (e - w > CAMERA.WIDE_SPAN) return { bounds: [[-150, -50], [170, 70]] }
  if (e - w < 0.01 && n - s < 0.01) return { point: [(w + e) / 2, (s + n) / 2] }
  return { bounds: [[w, s], [e, n]] }
}
watch(() => bus.selectionVersion.value, () => {
  const map = mapRef.value
  if (map && map.getLayer('gi-pins-sel')) map.setFilter('gi-pins-sel', ['in', ['get', 'slug'], ['literal', [...bus.selectionSet]]])
  if (camTimer) clearTimeout(camTimer)
  camTimer = setTimeout(() => {
    camTimer = null
    const rows = [...bus.selectionSet].map((s) => board.bySlug.value.get(s)).filter(Boolean)
    moveCamera(boundsOf(rows))       // an empty selection holds position: deselecting is not a navigation
  }, CAMERA.DEBOUNCE)
})
watch(() => bus.hoverKey.value, (k) => {
  const map = mapRef.value
  if (map && map.getLayer('gi-pins-hover')) map.setFilter('gi-pins-hover', ['==', ['get', 'slug'], k || ''])
})
// A view change frames its subject once (the province view: India and China).
watch(() => board.view.value, (v) => { if (v === 'province') moveCamera({ bounds: [[68, 8], [123, 45]] }) })

// ── mount ───────────────────────────────────────────────────────────────────────────────────────────
const assetsBase = () => resolveAssetsBase(board.profileConfig.value)
const getJson = (path) => fetch(`${assetsBase()}/${path}`).then((r) => { if (!r.ok) throw new Error(`${path} HTTP ${r.status}`); return r.json() })

onMounted(async () => {
  const adm0P = getJson('boundaries/world-adm0.geojson')
  const indP = getJson('boundaries/gb-IND-ADM1-full.geojson').catch(() => null)
  const chnP = getJson('boundaries/gb-CHN-ADM1.geojson').catch(() => null)
  const nfhsP = getJson('tables/internet-by-adm1.json').then((t) => {
    const by = {}
    for (const r of t.rows || []) {
      if (r.iso3 !== 'IND' || r.measure !== 'ever_used_internet' || r.area !== 'total' || !r.adm1) continue
      ;(by[r.adm1] ||= {})[r.sex] = r.value      // an absent cell stays absent: "no data", never 0
    }
    adm1Table = by
    nfhsAttribution.value = (t.meta && t.meta.sources && t.meta.sources.nfhs5 && t.meta.sources.nfhs5.attribution) || ''
  }).catch(() => { adm1Table = null })
  try {
    if (!mapEl.value) return
    // ★ THE FOUR OPTIONS ARE STATED, NEVER DEFAULTED. This is the ONE geographic caller — the three
    // whiteboard callers all pass whiteboard:true — and the library's defaults are the inverse of what
    // a real map needs (whiteboard:true, boundaries:false, centre [0,0], zoom 1), because it was
    // extracted for the whiteboard case. Leaning on defaults here meant a blank basemap and no
    // boundary attribution the moment the import moved. Stating them makes this call read the same
    // against either module.
    const made = await createWhiteboardMap(mapEl.value, board.profileConfig.value, {
      whiteboard: false, boundaries: true, center: [60, 20], zoom: 1.4,
      token: injectedToken?.value || '',
    })
    if (made.error) { err.value = T('messages.engineMissing', `The ${made.error} map engine did not load.`, { engine: made.error }); return }
    const map = made.map
    if (unmounted) { try { map.remove() } catch (_) {} return }
    mapRef.value = markRaw(map)
    const [adm0, ind, chn] = await Promise.all([adm0P, indP, chnP, nfhsP])
    if (unmounted) return
    // wait for the rows too: the band per country comes from the joined table
    if (board.loading.value) await new Promise((res) => { const stop = watch(() => board.loading.value, (l) => { if (!l) { stop(); res() } }) })
    addCountries(map, adm0)
    addPins(map)
    if (ind || chn) {
      addProvinces(map, ind, chn)
      provinceKeys = [...(ind ? ind.features.map((f) => `IND|${f.properties.shapeName}`) : []),
        ...(chn ? chn.features.map((f) => `CHN|${f.properties.shapeName}`) : [])]
    }
    ready.value = true
    paintScope()
    if (bus.selectionSet.size) moveCamera(boundsOf([...bus.selectionSet].map((s) => board.bySlug.value.get(s)).filter(Boolean)))
    else if (board.view.value === 'province') moveCamera({ bounds: [[68, 8], [123, 45]] })
    // test hook: what a probe needs to assert DATA drew, not just the basemap (PAINT GATES lesson)
    try {
      setGlobal('__giMap', map)
      setGlobal('__giState', () => ({
        provider: made.provider, pins: map.getSource('gi-pins') ? pinFC().features.length : 0,
        renderedPins: map.queryRenderedFeatures({ layers: ['gi-pins'] }).length,
        renderedCountries: map.queryRenderedFeatures({ layers: ['gi-adm0-fill'] }).length,
        provinces: provinceKeys.length, inScope: board.filtered.value.length,
        selected: [...bus.selectionSet], hover: bus.hoverKey.value,
      }))
    } catch (_) {}
  } catch (e) { err.value = String(e && e.message || e) }
})
// The engines only follow WINDOW resizes: a dragged rail, a toggled panel or an un-hidden map must
// resize the canvas too, or it stretches the old bitmap.
let ro = null
onMounted(() => {
  if (mapEl.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { try { mapRef.value && mapRef.value.resize() } catch (_) {} })
    ro.observe(mapEl.value)
  }
})
onBeforeUnmount(() => {
  // ★ RELEASE THE TEST HOOKS. Each pins whatever it closes over — a map instance pins its
  // canvas, its sources, and through them the whole app — so every mount that leaves one behind
  // leaks another copy, measured at roughly 10 MB each.
  // Released as a SET, not just the obvious one: a block that sets several and clears one leaks
  // the rest silently, and the named one is the one you remember. One delete per line, so the
  // released set is readable and greppable.
  // Identity-checked: only this instance's own value is cleared, so a second instance sharing the
  // page does not delete the first's live hooks on its way out.
  try { if (window.__giMap === ownGlobals.__giMap) delete window.__giMap } catch (_) {}
  try { if (window.__giState === ownGlobals.__giState) delete window.__giState } catch (_) {}
  try { ro && ro.disconnect() } catch (_) {}
  unmounted = true
  if (camTimer) clearTimeout(camTimer)
  try { mapRef.value && mapRef.value.remove() } catch (_) {}
})

const approxCount = computed(() => board.all.value.filter((r) => r.shares_point > 0).length)

useShadowStyles(
  '.gim{position:relative;width:100%;height:100%;overflow:hidden;background:#e9ece6}' +
  '.gim-map{position:absolute;inset:0}' +
  '.gim-err{position:absolute;top:45%;left:0;right:0;text-align:center;font-size:13px;color:#6d766e}' +
  '.gim-legend{position:absolute;inset-block-end:10px;inset-inline-start:10px;z-index:4;max-width:min(340px,calc(100% - 64px));' +
  'background:rgba(255,255,255,.96);color:#3b463d;border:1px solid #d1d4cd;border-radius:10px;padding:8px 10px;' +
  'font:12px/1.4 Roboto,-apple-system,"Segoe UI",sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.10)}' +
  '.gim-lh{display:flex;align-items:center;gap:8px;font-weight:600;font-size:12px;margin-bottom:4px}' +
  // a real 28px tap target (WCAG 2.5.8 wants 24): the glyph alone measured 16px
  '.gim-lh button{margin-inline-start:auto;border:0;background:none;color:#6d766e;cursor:pointer;font:inherit;display:inline-grid;place-items:center;width:28px;height:28px;padding:0;flex:none}' +
  '.gim-keys{display:flex;flex-wrap:wrap;gap:3px 10px;margin-bottom:6px}' +
  '.gim-key{display:inline-flex;align-items:center;gap:5px;font-size:11px}' +
  '.gim-dot{width:11px;height:11px;border-radius:50%;box-sizing:border-box;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2);flex:none}' +
  '.gim-sw{width:12px;height:10px;border-radius:2px;flex:none;opacity:.8}' +
  '.gim-seg{display:inline-flex;border:1px solid #d1d4cd;border-radius:6px;overflow:hidden;margin:2px 0 4px}' +
  '.gim-seg button{font:inherit;font-size:11px;padding:3px 8px;min-height:24px;border:0;background:#fff;color:#3b463d;cursor:pointer}' +
  '.gim-seg button[aria-pressed="true"]{background:#3b463d;color:#fff}' +
  '.gim-note{font-size:10.5px;color:#6d766e;margin-top:3px}' +
  '.gim-legend-min{position:absolute;inset-block-end:10px;inset-inline-start:10px;z-index:4;border:1px solid #d1d4cd;background:#fff;color:#3b463d;' +
  'border-radius:8px;padding:5px 10px;min-height:28px;font:600 12px Roboto,sans-serif;cursor:pointer}',
  'gi-map',
)
</script>

<template>
  <div class="gim" data-region="map">
    <div ref="mapEl" class="gim-map" :aria-label="T('gospelInternet.map.aria', 'Map of people groups, shaded by how much of each country uses the internet')" role="region"></div>
    <div v-if="err" class="gim-err" role="alert">{{ err }}</div>

    <MapToolbar v-if="mapRef">
      <ZoomInButton :map="mapRef" />
      <ZoomOutButton :map="mapRef" />
      <ShareButton :embed-path="EMBED_PATH" />
      <HelpButton hosted />
    </MapToolbar>

    <div v-if="legendOpen" class="gim-legend">
      <div class="gim-lh">
        <span>{{ T('gospelInternet.legend.pins', 'In their own language') }}</span>
        <button type="button" :aria-label="T('gospelInternet.legend.hide', 'Hide the legend')" @click="legendOpen = false">✕</button>
      </div>
      <div class="gim-keys">
        <span v-for="d in ACCESS_DETAILS" :key="d" class="gim-key">
          <span class="gim-dot" :style="{ background: DETAIL_FILL[d], borderColor: DETAIL_RIM[d] }"></span>{{ label(T, 'detail', d) }}
        </span>
      </div>
      <div class="gim-lh"><span>{{ T('gospelInternet.legend.band', 'Country internet use (World Bank)') }}</span></div>
      <div class="gim-keys">
        <span v-for="b in BANDS" :key="b" class="gim-key"><span class="gim-sw" :style="{ background: BAND_COLOR[b] }"></span>{{ label(T, 'band', b) }}</span>
      </div>
      <div class="gim-lh"><span>{{ T('gospelInternet.legend.provinces', 'India and China by province') }}</span></div>
      <div class="gim-seg" role="group" :aria-label="T('gospelInternet.legend.provinces', 'India and China by province')">
        <button type="button" :aria-pressed="provinceMode === 'zero'" @click="setProvinceMode('zero')">{{ T('gospelInternet.legend.modeZero', 'Nothing in own language') }}</button>
        <button type="button" :aria-pressed="provinceMode === 'women'" @click="setProvinceMode('women')">{{ T('gospelInternet.legend.modeWomen', 'Internet: women') }}</button>
        <button type="button" :aria-pressed="provinceMode === 'men'" @click="setProvinceMode('men')">{{ T('gospelInternet.legend.modeMen', 'Internet: men') }}</button>
      </div>
      <div v-if="provinceMode !== 'zero'" class="gim-note">{{ T('gospelInternet.legend.nfhs', 'India only: share of women or men aged 15-49 who have ever used the internet, by state. NFHS-5, 2019-21. China has no verified provincial source.') }} {{ nfhsAttribution }}</div>
      <div class="gim-note">{{ T('gospelInternet.notice.pins', 'A dot marks a people group, not a town. {n} groups share a point with another group.', { n: approxCount.toLocaleString() }) }}</div>
    </div>
    <button v-else type="button" class="gim-legend-min" @click="legendOpen = true">{{ T('gospelInternet.legend.show', 'Legend') }}</button>
  </div>
</template>
