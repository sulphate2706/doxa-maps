<script setup>
import { dataUrl, glFor, exposeMap, releaseMap, setProjectionFor } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { tStatic } from '@map/i18n/index.js'
/**
 * pplr-rop-tree.vue — ROP hierarchy: Affinity Bloc → Cluster → People Group → PGIC.
 *
 * SemanticTreeLegend drives the first 3 levels (bloc/cluster/PG).
 * PGIC is a separate floating panel (21k items, search-based or selected-PG-based).
 * Pins are colored by Affinity Bloc. Each level sorts by pin count desc.
 */
import { inject, onMounted, onBeforeUnmount, ref, computed, shallowRef, watch } from 'vue'
import { resolveNamedStyle } from '@map/styles/registry.js'
import { resolveMapProvider } from '@map/composables/useMapProvider.js'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { addCountryPolygons, setCountryPolygonTheme, POPUP_CSS, COUNTRY_FS_URL, COUNTRY_FS_FIELDS, FullscreenToggleControl, makePinIndicator, bindFuzzyPinClick, escHtml } from '../utils/pplrMap.js'
import SemanticTreeLegend from '@map/components/legends/SemanticTreeLegend.vue'
import MapboxGeocoder from '../components/MapboxGeocoder.vue'
import PinDetailCard from '../components/PinDetailCard.vue'
import LoadingGlobe from '../components/LoadingGlobe.vue'
import { createPplrInstance, provideInstance } from '@map/composables/usePplrInstance.js'

// ── Per-map instance store (Mediator pattern: ties legend, geocoder, map together) ──
const pplrInstance = createPplrInstance('rop-tree')
provideInstance(pplrInstance)

// Registry names resolve per engine, so the Dark/Satellite/Light switch works under MapLibre too.
const mapProvider = resolveMapProvider(inject('profileConfig', null))
const mapboxToken = inject('mapboxToken')
const mapContainer = ref(null)
const profileRoot  = ref(null)   // FullscreenControl target — fullscreens the .profile so chrome stays visible
const t = usePplrT()
const tShared = useOptionalT()   // unqualified: tabs.* is a shared area
const status = ref(t('pplr.status.loading'))
const PIN_LAYER = 'rop-pins'

const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken:  mapboxToken.value,
  style:        'ink',   // named: dark-v11 under Mapbox, OpenFreeMap dark under MapLibre
  center:       [25, 18],
  zoom:         1.6,
  projection:   'mercator'  // pinned at construct time — see useMapInstance projection arg
})

// ── Affinity Bloc colors ──────────────────────────────────────────────────────
const BLOC_COLORS = {
  A001: '#f59e0b', A017: '#94a3b8', A002: '#ef4444', A003: '#8b5cf6',
  A019: '#06b6d4', A004: '#f43f5e', A006: '#3b82f6', A007: '#10b981',
  A008: '#14b8a6', A009: '#6366f1', A010: '#22c55e', A005: '#ec4899',
  A012: '#a78bfa', A011: '#84cc16', A013: '#facc15', A018: '#e11d48',
  A015: '#0ea5e9',
}
function blocColor(code) { return BLOC_COLORS[code] || '#6b7280' }

// ── Settings ──────────────────────────────────────────────────────────────────
const showSettings = ref(false)
const DATA_SOURCES = [
  { label: 'ROP tree', url: 'rop-tree.json',
    fields: ['code', 'name', 'clusters[].code', 'clusters[].name', 'clusters[].groups[].code', 'clusters[].groups[].entries[]'] },
  { label: 'PG pins', url: 'pg-points.json',
    fields: ['code', 'name', 'rop1', 'rop2', 'rop3', 'rop25', 'iso3', 'country', 'imb', 'jp', 'religion', 'language'] },
  { label: 'Country polygons', url: COUNTRY_FS_URL, fields: COUNTRY_FS_FIELDS },
]

// ── Data ──────────────────────────────────────────────────────────────────────
const treeData  = shallowRef([])
const pgData    = shallowRef(null)
const mapLoaded = ref(false)
const ropTreeBuilt = shallowRef([])  // Frozen tree, built ONCE in onMounted to avoid 21k recompute on every dep change

// Pin counts per ROP level (from pg-points)
const blocCounts    = ref({})
const clusterCounts = ref({})
// Population per ROP level (from pg-points pop field, if present)
const blocPops      = ref({})
const clusterPops   = ref({})
const pgPops        = ref({})
const hasPop        = ref(false)

// PGIC lookup: rop25 → { name, country, pop }
const pgicLookup = ref({})

// ── Projection + basemap ──────────────────────────────────────────────────────
const projection     = ref('mercator')  // default: mercator
const showBasemap    = ref(false)
const currentBasemap = ref('dark')
const BASEMAPS = [
  { key: 'dark',      label: 'Dark',      url: 'ink' },
  { key: 'satellite', label: 'Satellite', url: 'hybrid' },
  { key: 'light',     label: 'Light',     url: 'paper' },
]

// ── ROP tree (4 generations: Affinity Bloc → People Cluster → ROP25 → ROP3byCountry)
// Tab N = Generation N (1-indexed in user-facing numbering — see QA defining-constrained-problem1).
// SemanticTreeLegend renders the first 3 generations inline; the 4th (PGIC / 21k items)
// is handled by a separate floating panel (too many nodes for the inline tree).
// Short tab labels keep all 4 chips on a single row. The "i" tooltip carries the full meaning.
// computed + the reactive shared-key t: tStatic reads a window global, so a computed over it would freeze too
const ROP_TABS = computed(() => [
  { id: 'affinity', label: tShared('tabs.bloc'),
    info: 'Affinity Bloc — top-level grouping of related people groups (e.g. Arab Peoples). 17 blocs total.' },
  { id: 'cluster',  label: tShared('tabs.cluster'),
    info: 'People Cluster — subdivision within an Affinity Bloc (e.g. Maghrebi Arab inside Arab Peoples). 292 clusters.' },
  { id: 'rop25',    label: 'ROP25',
    info: 'People Group level — a distinct ethnolinguistic identity (e.g. Algerian Arab). ~13k groups.' },
  { id: 'rop3xc',   label: tShared('tabs.pgic'),
    topLimit: 200,
    info: 'ROP3 × Country (PGIC) — same ethnolinguistic group in a specific country (e.g. Algerian Arab in France). 21k records. Showing top 200 by population — use the geocoder to find the rest.' },
])

// Build the ropTree ONCE from the now-loaded data (called from onMounted after pg-points
// + pgicLookup are ready). Avoids the previous behavior where the computed re-allocated
// 13k PG nodes × ~50 PGIC children each on every reactive dep change → tab-switch lag.
function buildRopTreeOnce() {
  if (!treeData.value.length) { ropTreeBuilt.value = []; return }
  const lookup = pgicLookup.value
  ropTreeBuilt.value = [...treeData.value]
    .sort((a, b) => (blocCounts.value[b.code] || 0) - (blocCounts.value[a.code] || 0))
    .map(bloc => ({
      id:       `bloc:${bloc.code}`,
      label:    bloc.name || bloc.code,
      color:    blocColor(bloc.code),
      count:    blocCounts.value[bloc.code] || 0,
      pop:      blocPops.value[bloc.code] || 0,
      filter:   ['==', ['get', 'rop1'], bloc.code],
      children: [...(bloc.clusters || [])]
        .sort((a, b) => (clusterCounts.value[b.code] || 0) - (clusterCounts.value[a.code] || 0))
        .map(cl => ({
          id:       `cl:${cl.code}`,
          label:    cl.name || cl.code,
          color:    blocColor(bloc.code),
          count:    clusterCounts.value[cl.code] || 0,
          pop:      clusterPops.value[cl.code] || 0,
          filter:   ['==', ['get', 'rop2'], cl.code],
          children: [...(cl.groups || [])]
            .sort((a, b) => b.entries.length - a.entries.length)
            .map(g => ({
              id:       `pg:${g.code}`,
              label:    g.name || g.code,
              color:    blocColor(bloc.code),
              count:    g.entries.length,
              pop:      pgPops.value[g.code] || 0,
              filter:   ['==', ['get', 'rop3'], g.code],
              pgicIds:  g.entries,
              // Tab 4: PGIC children — built from pgicLookup (rop25 → name + country)
              children: g.entries.map(geoId => {
                // Some rop-tree.json entries don't have matching rows in
                // pg-points.geojson — show them as "Unmapped · <code>" so the
                // user sees the rop25 ID with context, not a bare number
                // (a bare number reads as an error).
                const info = lookup[geoId]
                const label = info
                  ? (info.country ? `${info.name} · ${info.country}` : info.name)
                  : `Unmapped · ${geoId}`
                return {
                  id:     `pgic:${geoId}`,
                  label,
                  color:  blocColor(bloc.code),
                  count:  1,
                  pop:    info?.pop || 0,
                  filter: ['==', ['get', 'rop25'], geoId],
                }
              }),
            })),
        })),
    }))
}

// Read-only accessor for template + child components
const ropTree = computed(() => ropTreeBuilt.value)

// ── Local search index for the geocoder (flattened tree + kind tags) ──────────
const KIND_LABELS = {
  bloc:    'Affinity Bloc',
  cluster: 'People Cluster',
  pg:      'ROP25',
  pgic:    'ROP3 × Country',
  country: 'Country',
}

const localIndex = computed(() => {
  const out = []
  // Blocs / clusters / PGs
  for (const bloc of ropTree.value) {
    out.push({ ...bloc, kind: 'bloc',    depth: 0 })
    for (const cl of bloc.children) {
      out.push({ ...cl, kind: 'cluster', depth: 1 })
      for (const pg of cl.children) {
        // Strip pgic children from the searchable PG entry (keep index light)
        out.push({ id: pg.id, label: pg.label, color: pg.color, count: pg.count, pop: pg.pop,
                   filter: pg.filter, kind: 'pg', depth: 2 })
      }
    }
  }
  // Top PGICs by population (cap at 2k for snappy search)
  const pgicEntries = Object.entries(pgicLookup.value)
    .sort((a, b) => (b[1].pop || 0) - (a[1].pop || 0))
    .slice(0, 2000)
  for (const [geoId, info] of pgicEntries) {
    out.push({
      id:     `pgic:${geoId}`,
      label:  info.country ? `${info.name} · ${info.country}` : info.name,
      kind:   'pgic',
      depth:  3,
      filter: ['==', ['get', 'rop25'], geoId],
      pop:    info.pop || 0,
    })
  }
  // Distinct countries
  if (pgData.value) {
    const seen = new Set()
    for (const f of pgData.value.features) {
      const c = f.properties.country, iso = f.properties.iso3
      if (c && iso && !seen.has(iso)) {
        seen.add(iso)
        out.push({
          id:     `country:${iso}`,
          label:  c,
          kind:   'country',
          depth:  0,
          filter: ['==', ['get', 'iso3'], iso],
        })
      }
    }
  }
  return out
})

// ── Legend selection handler ───────────────────────────────────────────────────
// Selecting a row filters which pins are visible (and flies to them). It does
// NOT change pin visual style — the user explicitly asked us to keep base
// pin appearance on selection (no halos, no size change, no pulse).
function onRopLegendSelect(node) {
  if (!node) {
    map.value?.setFilter(PIN_LAYER, null)
    return
  }
  if (node.filter) {
    map.value?.setFilter(PIN_LAYER, node.filter)
  }
  flyToNode(node)
}

// ── Detail-card "Fly to pin" handler ──────────────────────────────────────────
function onPinLocate(p) {
  if (!map.value || p?.lng == null || p?.lat == null) return
  map.value.stop()
  map.value.flyTo({ center: [p.lng, p.lat], zoom: 6.5, duration: 1200 })
}

// Resolve detail-card accent color from the pinned PG's affinity bloc
const detailColor = computed(() => {
  const p = pplrInstance.pinDetail.value
  return p ? blocColor(p.rop1) : '#73A17F'
})

// ── Geocoder place-pick: fly to the place geometry ────────────────────────────
function onGeocoderPlace(p) {
  if (!map.value) return
  map.value.stop()
  if (p.bbox) {
    map.value.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: 60, maxZoom: 7, duration: 1200 })
  } else if (p.center) {
    map.value.flyTo({ center: p.center, zoom: 6.5, duration: 1200 })
  }
}

// ── Map interaction ───────────────────────────────────────────────────────────
function flyToNode(node) {
  if (!pgData.value || !mapLoaded.value || !map.value) return
  const id = node.id
  let field, value
  if (id.startsWith('bloc:'))         { field = 'rop1';  value = id.slice(5) }
  else if (id.startsWith('cl:'))      { field = 'rop2';  value = id.slice(3) }
  else if (id.startsWith('pg:'))      { field = 'rop3';  value = id.slice(3) }
  else if (id.startsWith('pgic:'))    { field = 'rop25'; value = id.slice(5) }
  else if (id.startsWith('country:')) { field = 'iso3';  value = id.slice(8) }
  else return
  const lngs = [], lats = []
  for (const f of pgData.value.features) {
    if (f.properties[field] === value) {
      lngs.push(f.geometry.coordinates[0])
      lats.push(f.geometry.coordinates[1])
    }
  }
  if (!lngs.length) return
  // Cancel any in-progress camera animation BEFORE starting a new one. Without
  // this, fast row-switching stacks animations and the camera looks like it's
  // mid-zoom when pins for the new selection finally render.
  map.value.stop()
  if (lngs.length === 1) {
    map.value.flyTo({ center: [lngs[0], lats[0]], zoom: 6.5, duration: 1200 })
    return
  }
  map.value.fitBounds([
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)]
  ], { padding: 60, maxZoom: 6, duration: 1200 })
}

// ── Projection / basemap ──────────────────────────────────────────────────────
function toggleProjection() {
  projection.value = projection.value === 'globe' ? 'mercator' : 'globe'
  if (map.value) setProjectionFor(map.value, projection.value)
}

function setBasemap(key) {
  if (key === currentBasemap.value) { showBasemap.value = false; return }
  currentBasemap.value = key
  pplrInstance.theme.value = key === 'light' ? 'light' : 'dark'  // sync chrome theme
  showBasemap.value = false
  const style = BASEMAPS.find(b => b.key === key)?.url
  if (!style || !map.value) return
  map.value.once('style.load', () => { setupLayers(); setProjectionFor(map.value, projection.value) })
  // diff:false skips Mapbox's "try-to-diff-the-style" path which logs an
  // "Unimplemented: setSprite" warning whenever sprite sheets differ between
  // dark-v11 and light-v11. We re-add all our layers in setupLayers anyway,
  // so a full rebuild is correct and avoids the noisy warning.
  map.value.setStyle(resolveNamedStyle(style, mapProvider).style, { diff: false })
}

// Quick light/dark toggle — flips between dark-v11 and light-v11 directly
function toggleTheme() {
  setBasemap(currentBasemap.value === 'dark' ? 'light' : 'dark')
}

// Retry: full page reload — last resort if loading is genuinely stuck.
function reload() { window.location.reload() }

// ── Pin-click indicator (a marker icon hovering over the selected pin) ──────
const pinIndicator = makePinIndicator()
// Hide indicator whenever the pin-detail card closes (X button, Esc, or
// programmatic clear) — the legend is back, no pinned pin to point at.
watch(() => pplrInstance.pinDetail.value, p => { if (!p) pinIndicator.hide() })

// ── Geocoder → map sync ────────────────────────────────────────────────────
// The legend writes to instance.selection on row click AND fires @select; the
// geocoder ONLY writes to instance.selection (no event). Without this watch,
// geocoder picks set the store but never reach setFilter / flyTo. Watching
// the store closes that loop. setFilter is idempotent so the legend's @select
// path overlapping is harmless.
watch(() => pplrInstance.selection.value, sel => {
  if (!map.value) return
  if (sel?.filter) onRopLegendSelect(sel)
  else if (!sel)   onRopLegendSelect(null)
})

// ── Map layers ────────────────────────────────────────────────────────────────
function setupLayers() {
  if (!pgData.value || !map.value) return
  addCountryPolygons(map.value, { theme: pplrInstance.theme.value })
  if (!map.value.getSource('rop-pgs')) {
    map.value.addSource('rop-pgs', { type: 'geojson', data: pgData.value, cluster: false })
    const matchExpr = ['match', ['get', 'rop1'],
      ...Object.entries(BLOC_COLORS).flatMap(([k, v]) => [k, v]),
      '#6b7280'
    ]
    map.value.addLayer({
      id: PIN_LAYER, type: 'circle', source: 'rop-pgs',
      paint: {
        'circle-color': matchExpr,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 4, 12, 7],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#0d1117',
        'circle-stroke-width': 0.5,
      }
    })
    // Fuzzy click — 8px hit-radius around the pin so they're easier to tap
    bindFuzzyPinClick(map.value, PIN_LAYER, ({ features }) => {
      const f = features[0]
      const lng = f.geometry.coordinates[0]
      const lat = f.geometry.coordinates[1]
      pplrInstance.pinDetail.value = { ...f.properties, lng, lat }
      pinIndicator.show(map.value, [lng, lat], { color: blocColor(f.properties.rop1) })
    })
  }
}

function popupHtml(p) {
  const d = v => (v == null || v === 'None' || v === '' || v === '*') ? '—' : escHtml(v)
  return `<div class="pplr-popup">
    <h3>${d(p.name)}<small>${d(p.country)}</small></h3>
    <table>
      <tr><td>${escHtml(t('pplr.popup.affinityBloc'))}</td><td><b>${d(p.rop1)}</b></td></tr>
      <tr><td>${escHtml(t('pplr.popup.cluster'))}</td><td><b>${d(p.rop2)}</b></td></tr>
      <tr><td>${escHtml(t('pplr.popup.peopleGroup'))}</td><td><b>${d(p.rop3)}</b></td></tr>
      <tr><td>PEID</td><td><code>${d(p.peid)}</code></td></tr>
      <tr><td>IMB PGID</td><td><code>${d(p.imb)}</code></td></tr>
      <tr><td>JP Code</td><td><code>${d(p.jp)}</code></td></tr>
      <tr><td>${escHtml(t('pplr.popup.religion'))}</td><td>${d(p.religion)}</td></tr>
      <tr><td>${escHtml(t('pplr.popup.language'))}</td><td>${d(p.language)}</td></tr>
    </table>
  </div>`
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  await initializeMap()
  exposeMap(map.value)
  if (!map.value) {
    // The map did not construct (e.g. provider=mapbox with no token; useMapInstance logs why). Say so
    // and stop: everything below needs a map, and map.value.on() threw into the mounted hook.
    status.value = tStatic('messages.mapUnavailable')   // a shared key: usePplrT would prefix it with pplr.
    return
  }

  // Navigation: zoom +/- (Mapbox built-in) + custom fullscreen toggle.
  // See FullscreenToggleControl in pplrMap.js for why we don't use
  // mapboxgl.FullscreenControl with a non-map container.
  if (map.value) {
    map.value.addControl(new (glFor(map.value)).NavigationControl({ showCompass: false, visualizePitch: false }), 'bottom-right')
    map.value.addControl(new FullscreenToggleControl(profileRoot.value), 'bottom-right')
  }

  // Load tree structure immediately (small file)
  const treeResp = await fetch(dataUrl('rop-tree.json'))
  treeData.value = await treeResp.json()

  map.value.on('load', async () => {
    // The constructor's projection:'mercator' is only a request: on Mapbox the style's own projection
    // (globe) wins, so the map booted as a globe while this view's state and button said Mercator, and
    // the first "Switch to Globe" click did nothing (C2). The style is ready here, on both
    // engines, so apply the state to the map.
    setProjectionFor(map.value, projection.value)
    try {
      // Globe centering: shift the map's logical center right of the legend
      // so the globe doesn't render beneath the 380px legend column.
      // Padding is also respected by flyTo / fitBounds for selection animations.
      map.value.setPadding({ left: 380, top: 0, right: 0, bottom: 0 })
      addCountryPolygons(map.value, { theme: pplrInstance.theme.value })

      status.value = t('pplr.status.loadingPins')
      const resp = await fetch(dataUrl('pg-points.json'))
      const fc   = await resp.json()
      pgData.value = fc

      // Aggregate counts + population per ROP level
      const bc = {}, cc = {}, bp = {}, cp = {}, pp = {}
      let totalPop = 0
      for (const feat of fc.features) {
        const r1 = feat.properties.rop1, r2 = feat.properties.rop2, r3 = feat.properties.rop3
        const p  = feat.properties.pop || feat.properties.population || 0
        if (r1) { bc[r1] = (bc[r1] || 0) + 1; bp[r1] = (bp[r1] || 0) + p }
        if (r2) { cc[r2] = (cc[r2] || 0) + 1; cp[r2] = (cp[r2] || 0) + p }
        if (r3) { pp[r3] = (pp[r3] || 0) + p }
        totalPop += p
      }
      blocCounts.value    = bc
      clusterCounts.value = cc
      blocPops.value      = bp
      clusterPops.value   = cp
      pgPops.value        = pp
      hasPop.value        = totalPop > 0

      // PGIC lookup (rop25 → name, country, pop)
      const lkp = {}
      for (const feat of fc.features) {
        const id = feat.properties.rop25
        if (id && !lkp[id]) {
          lkp[id] = {
            name: feat.properties.name,
            country: feat.properties.country,
            pop: feat.properties.pop || feat.properties.population || 0,
          }
        }
      }
      pgicLookup.value = lkp

      // Build the tree ONCE here, not via reactive computed (avoids 21k recompute lag)
      buildRopTreeOnce()

      setupLayers()

      const peidCount = fc.features.filter(f => f.properties.peid != null).length
      mapLoaded.value = true
      status.value = t('pplr.status.readyRop', { pins: fc.features.length.toLocaleString(), peid: peidCount.toLocaleString() })
    } catch (err) {
      status.value = t('pplr.status.error', { message: err.message })
    }
  })
})
onBeforeUnmount(() => { releaseMap(map.value); pinIndicator.destroy(); destroy() })

const TREE_POPUP_CSS = POPUP_CSS + `
.pplr-popup h3 small { display: block; color: #6b7280; font-weight: 400; font-size: 11px; margin-top: 2px; }
`
</script>

<template>
  <div ref="profileRoot" class="profile" :data-theme="pplrInstance.theme.value">
    <!-- Stays mounted until BOTH the basemap canvas AND the PG pin layer are
         ready, so it never disappears before the pins populate. -->
    <LoadingGlobe v-if="!isMapReady || !mapLoaded" :label="status" @retry="reload" />

    <!-- Decoupled geocoder, top-left, sits above the legend; shares instance store -->
    <div class="geocoder-slot">
      <MapboxGeocoder
        :local-index="localIndex"
        :kind-labels="KIND_LABELS"
        :mapbox-token="mapboxToken"
        :placeholder="t('pplr.ui.search')"
        @place="onGeocoderPlace"
      />
    </div>

    <!-- Pin-detail card replaces legend when a pin is clicked -->
    <PinDetailCard
      v-if="pplrInstance.pinDetail.value"
      :color="detailColor"
      @locate="onPinLocate"
    />

    <!-- Reusable legend: Affinity Bloc → People Cluster → ROP25 → ROP3 × Country -->
    <SemanticTreeLegend
      v-else
      :nodes="ropTree"
      :tabs="ROP_TABS"
      :title="t('pplr.ui.ropHierarchy')"
      @select="onRopLegendSelect"
    />

    <div ref="mapContainer" class="map" />
    <div class="status">{{ status }}</div>
    <div class="header-pill">{{ t('pplr.pill.ropTree') }}</div>

    <!-- Toolbar — rounded pill controls -->
    <div class="map-toolbar">
      <button class="toolbar-btn round" :title="tShared(currentBasemap === 'dark' ? 'buttons.switchToLightMode' : 'buttons.switchToDarkMode')" :aria-label="tShared(currentBasemap === 'dark' ? 'buttons.switchToLightMode' : 'buttons.switchToDarkMode')"
        @click="toggleTheme">
        <svg v-if="currentBasemap === 'dark'" width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="toolbar-btn round" :title="tShared(projection === 'globe' ? 'mapui.disableGlobe' : 'mapui.enableGlobe')" :aria-label="tShared(projection === 'globe' ? 'mapui.disableGlobe' : 'mapui.enableGlobe')"
        @click="toggleProjection">
        <span class="toolbar-icon">{{ projection === 'globe' ? '🌐' : '🗺' }}</span>
      </button>
      <div class="basemap-wrap">
        <button class="toolbar-btn round" :title="t('pplr.ui.baseMap')"
          @click="showBasemap = !showBasemap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M3 7l9-4 9 4-9 4-9-4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M3 12l9 4 9-4M3 17l9 4 9-4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </button>
        <div v-if="showBasemap" class="basemap-panel">
          <div class="basemap-title">{{ t('pplr.ui.baseMap') }}</div>
          <button v-for="b in BASEMAPS" :key="b.key" class="basemap-opt"
            :class="{ active: currentBasemap === b.key }"
            @click="setBasemap(b.key)">{{ b.label }}</button>
        </div>
      </div>
      <div class="settings-wrap">
        <button class="toolbar-btn round" :title="t('pplr.ui.dataSources')" @click="showSettings = !showSettings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
            <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.6A7 7 0 0 0 7.5 6.8l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2.1 1.2L10 21h4l.4-2.6a7 7 0 0 0 2.1-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
        </button>
        <div v-if="showSettings" class="settings-panel">
          <div class="settings-header">{{ t('pplr.ui.dataSources') }}</div>
          <div v-for="src in DATA_SOURCES" :key="src.url" class="settings-src">
            <div class="settings-src-label">{{ src.label }}</div>
            <div class="settings-src-url">{{ src.url }}</div>
            <div class="settings-fields">
              <span v-for="f in src.fields" :key="f" class="settings-field">{{ f }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <component is="style">{{ TREE_POPUP_CSS }}</component>
  </div>
</template>

<style scoped>
.profile { width: 100%; height: 100%; position: relative; }
.map     { width: 100%; height: 100%; }
.loading {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: #0f1216; color: #94a3b8; font: 13px sans-serif; z-index: 1;
}
/* Status + header pills: positioned to underlap the legend (380px wide) and
   clear the Mapbox attribution at the very bottom. Cap width below legend
   width so the right edge never sticks out from behind the legend. */
.status {
  position: absolute; bottom: 32px; left: 12px;
  background: rgba(13,17,23,0.92); color: #86efac; border: 1px solid #30363d;
  font: 11px ui-monospace, monospace; padding: 6px 12px; border-radius: 4px; z-index: 2;
  max-width: 340px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.header-pill {
  position: absolute; bottom: 64px; left: 12px;
  background: rgba(13,17,23,0.92); color: #c9d1d9; border: 1px solid #30363d;
  font: 11px system-ui; padding: 6px 12px; border-radius: 999px; z-index: 2;
  max-width: 340px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Geocoder slot — sits above the legend, matches its 380px width ─────────── */
.geocoder-slot {
  position: absolute; top: 12px; left: 8px; width: 380px; z-index: 5;
}
@media (max-width: 640px) {
  .geocoder-slot { width: 92vw; max-width: 380px; left: 8px; }
}

/* ── Light-mode chrome overrides — applied when basemap is light-v11 ─────── */
.profile[data-theme="light"] .toolbar-btn {
  background: rgba(255,255,255,0.96); border-color: #d0d7de; color: #57606a;
  box-shadow: 0 3px 10px rgba(31,35,40,0.12);
}
.profile[data-theme="light"] .toolbar-btn:hover {
  background: #f6f8fa; color: #3b463d; border-color: #3b463d;
}
.profile[data-theme="light"] .toolbar-btn.round { background: #ffffff; }
.profile[data-theme="light"] .toolbar-btn.round:hover {
  background: #f6f8fa; box-shadow: 0 5px 14px rgba(59,70,61,0.2);
}
.profile[data-theme="light"] .basemap-panel,
.profile[data-theme="light"] .settings-panel {
  background: rgba(255,255,255,0.98); border-color: #d0d7de;
  box-shadow: 0 6px 20px rgba(31,35,40,0.15);
}
.profile[data-theme="light"] .basemap-title,
.profile[data-theme="light"] .settings-src-label {
  color: #3b463d; border-color: #d8dee4;
}
.profile[data-theme="light"] .basemap-opt { color: #57606a; }
.profile[data-theme="light"] .basemap-opt:hover { background: #f6f8fa; color: #1f2328; }
.profile[data-theme="light"] .basemap-opt.active { border-color: #3b463d; color: #3b463d; }
.profile[data-theme="light"] .status {
  background: rgba(255,255,255,0.95); border-color: #d0d7de; color: #1a7f37;
}
.profile[data-theme="light"] .header-pill {
  background: rgba(255,255,255,0.95); border-color: #d0d7de; color: #1f2328;
}
.profile[data-theme="light"] .loading { background: #f6f8fa; color: #57606a; }
.profile[data-theme="light"] .settings-src-url {
  background: #f6f8fa; border-color: #d0d7de; color: #57606a;
}
.profile[data-theme="light"] .settings-field { background: #eaeef2; color: #1f2328; }

/* ── Toolbar ─────────────────────────────────────────────────────────────────── */
.map-toolbar {
  position: absolute; top: 12px; right: 12px; z-index: 5;
  display: flex; flex-direction: column; gap: 4px; align-items: flex-end;
}
.toolbar-btn {
  display: flex; align-items: center; gap: 5px;
  background: rgba(13,17,23,0.92); color: #8b949e;
  border: 1px solid #30363d; border-radius: 6px;
  font: 11px ui-monospace, monospace; padding: 5px 10px;
  cursor: pointer; white-space: nowrap;
  transition: color 0.12s, border-color 0.12s, background 0.12s, transform 0.12s,
              box-shadow 0.12s;
}
.toolbar-btn:hover { color: #c9d1d9; border-color: #73A17F; }

/* Rounded variant — DOXA-style 36px circular chips */
.toolbar-btn.round {
  width: 36px; height: 36px; padding: 0;
  border-radius: 50%;
  justify-content: center;
  background: #161b22;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
}
.toolbar-btn.round:hover {
  background: #1c2333; transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(59,70,61,0.25);
}
.toolbar-icon { font-size: 13px; line-height: 1; }
.toolbar-label { font-size: 10px; letter-spacing: 0.04em; }
.basemap-wrap, .settings-wrap { position: relative; }
.basemap-panel, .settings-panel {
  position: absolute; top: calc(100% + 4px); right: 0;
  background: rgba(13,17,23,0.97); border: 1px solid #30363d; border-radius: 6px;
  padding: 8px; min-width: 130px; z-index: 10;
  display: flex; flex-direction: column; gap: 3px;
}
.basemap-title {
  font: 600 10px ui-monospace, monospace; color: #73A17F;
  text-transform: uppercase; letter-spacing: 0.06em;
  padding: 0 4px 4px; border-bottom: 1px solid #21262d; margin-bottom: 2px;
}
.basemap-opt {
  background: transparent; border: 1px solid transparent; border-radius: 4px;
  color: #8b949e; font: 11px system-ui; padding: 4px 8px; cursor: pointer; text-align: left;
}
.basemap-opt:hover { background: #161b22; color: #c9d1d9; }
.basemap-opt.active { border-color: #73A17F; color: #73A17F; }
.settings-panel { min-width: 300px; max-width: 420px; max-height: 50vh; overflow-y: auto; }
.settings-header {
  font: 600 11px ui-monospace, monospace; color: #c9d1d9;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 4px 4px 8px; margin-bottom: 6px;
  border-bottom: 1px solid #21262d;
}
.profile[data-theme="light"] .settings-header { color: #1f2328; border-bottom-color: #d8dee4; }
.settings-src { margin-bottom: 8px; }
.settings-src-label {
  font: 600 9px ui-monospace, monospace; color: #73A17F;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;
}
.settings-src-url {
  font: 10px ui-monospace, monospace; color: #6e7681; word-break: break-all;
  background: #161b22; border: 1px solid #21262d; border-radius: 3px; padding: 3px 5px; margin-bottom: 3px;
}
.settings-fields { display: flex; flex-wrap: wrap; gap: 2px; }
.settings-field {
  font: 10px ui-monospace, monospace; background: #21262d; color: #c9d1d9; border-radius: 3px; padding: 1px 4px;
}

</style>
