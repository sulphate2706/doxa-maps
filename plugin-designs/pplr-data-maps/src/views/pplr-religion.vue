<script setup>
import { dataUrl, glFor, exposeMap, releaseMap, whenGeojsonDrawn, setProjectionFor } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { religionFamilyLabel } from '@map/colors/religion.js'
import { tStatic } from '@map/i18n/index.js'
/**
 * pplr-religion.vue — PG pins colored by primary religion.
 *
 * 9 religion groups (christian, islam, hindu, ethnic, buddhist, jewish, sikh, none, other).
 * Country polygons underneath. Click a pin for full popup. Legend top-right.
 * Uses the `rg` field pre-computed in pg-points.geojson.
 */
import { inject, onMounted, onBeforeUnmount, ref, computed, watch } from 'vue'
import { resolveNamedStyle } from '@map/styles/registry.js'
import { resolveMapProvider } from '@map/composables/useMapProvider.js'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { addCountryPolygons, POPUP_CSS, COUNTRY_FS_URL, COUNTRY_FS_FIELDS, FullscreenToggleControl, makePinIndicator, bindFuzzyPinClick, escHtml } from '../utils/pplrMap.js'
import MapboxGeocoder from '../components/MapboxGeocoder.vue'
import PinDetailCard from '../components/PinDetailCard.vue'
import FlatLegend from '../components/FlatLegend.vue'
import LoadingGlobe from '../components/LoadingGlobe.vue'
import { createPplrInstance, provideInstance } from '@map/composables/usePplrInstance.js'

const pplrInstance = createPplrInstance('religion')
provideInstance(pplrInstance)

// Registry names resolve per engine, so the Dark/Satellite/Light switch works under MapLibre too.
const mapProvider = resolveMapProvider(inject('profileConfig', null))
const mapboxToken = inject('mapboxToken')
const mapContainer = ref(null)
const profileRoot  = ref(null)   // FullscreenControl target — fullscreens .profile so chrome stays visible
const t = usePplrT()
const tShared = useOptionalT()   // unqualified: buttons.* and mapui.* are shared areas
const status = ref(t('pplr.status.loading'))
const PIN_LAYER = 'rel-pins'
const showSettings = ref(false)

const projection = ref('mercator')
const showBasemap = ref(false)
const currentBasemap = ref('dark')
const BASEMAPS = [
  { key: 'dark',      label: 'Dark',      url: 'ink' },
  { key: 'satellite', label: 'Satellite', url: 'hybrid' },
  { key: 'light',     label: 'Light',     url: 'paper' },
]
const pgData = ref(null)
const dataReady = ref(false)
function reload() { window.location.reload() }

function toggleProjection() {
  projection.value = projection.value === 'globe' ? 'mercator' : 'globe'
  if (map.value) setProjectionFor(map.value, projection.value)
}

function toggleTheme() {
  setBasemap(currentBasemap.value === 'dark' ? 'light' : 'dark')
}

function setBasemap(key) {
  if (key === currentBasemap.value) { showBasemap.value = false; return }
  currentBasemap.value = key
  pplrInstance.theme.value = key === 'light' ? 'light' : 'dark'
  showBasemap.value = false
  const style = BASEMAPS.find(b => b.key === key)?.url
  if (!style || !map.value) return
  map.value.once('style.load', () => { setupLayers(); setProjectionFor(map.value, projection.value) })
  // diff:false suppresses Mapbox's "Unimplemented: setSprite" warning between
  // dark-v11 and light-v11. We re-add layers in setupLayers anyway.
  map.value.setStyle(resolveNamedStyle(style, mapProvider).style, { diff: false })
}

function setupLayers() {
  if (!pgData.value || !map.value) return
  // Religion profile: polygons hidden on BOTH themes (no blue borders, in dark
  // mode too). Only pins + basemap show.
  addCountryPolygons(map.value, {
    fillColor: 'rgba(0,0,0,0)', fillOpacity: 0,
    lineColor: 'rgba(0,0,0,0)', lineOpacity: 0,
  })
  if (!map.value.getSource('rel-pgs')) {
    map.value.addSource('rel-pgs', { type: 'geojson', data: pgData.value, cluster: false })
    map.value.addLayer({
      id: PIN_LAYER, type: 'circle', source: 'rel-pgs',
      paint: {
        'circle-color': COLOR_EXPR,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 4, 12, 7],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#0d1117',
        'circle-stroke-width': 0.5
      }
    })
    bindFuzzyPinClick(map.value, PIN_LAYER, ({ features }) => {
      const f = features[0]
      const lng = f.geometry.coordinates[0]
      const lat = f.geometry.coordinates[1]
      pplrInstance.pinDetail.value = { ...f.properties, lng, lat }
      const groupColor = RELIGION_GROUPS.find(g => g.key === f.properties.rg)?.color || '#73A17F'
      pinIndicator.show(map.value, [lng, lat], { color: groupColor })
    })
  }
}

const DATA_SOURCES = [
  {
    label: 'PG-in-country pins',
    url: 'pg-points.json',
    fields: ['name', 'country', 'rg', 'religion', 'language', 'imb', 'jp']
  },
  {
    label: 'Country polygons — PPLR FeatureServer aCountry',
    url: COUNTRY_FS_URL,
    fields: COUNTRY_FS_FIELDS
  }
]

const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken:  mapboxToken.value,
  style:        'ink',   // named: dark-v11 under Mapbox, OpenFreeMap dark under MapLibre
  center:       [25, 18],
  zoom:         1.6,
  projection:   'mercator'  // pinned at construct time — no globe→mercator reproject flash
})

// Color palette:
//   - Christianity is the ONLY blue group (navy-ish)
//   - Ethnoreligion → pink (was purple)
//   - Judaism → purple (was cyan-blue; cannot share Christianity's hue)
//   - Buddhism stays gold (visually distinct from Islam's amber + Judaism's purple)
const RELIGION_GROUPS = [
  { key: 'christian', label: 'Christianity',    color: '#0ea5e9' },  // sky blue (only blue group)
  { key: 'islam',     label: 'Islam',           color: '#f59e0b' },  // amber
  { key: 'hindu',     label: 'Hinduism',        color: '#f97316' },  // orange
  { key: 'ethnic',    label: 'Ethnoreligion',   color: '#ec4899' },  // pink (was purple)
  { key: 'buddhist',  label: 'Buddhism',        color: '#fcd34d' },  // gold
  { key: 'jewish',    label: 'Judaism',         color: '#a855f7' },  // purple (was cyan-blue)
  { key: 'sikh',      label: 'Sikhism',         color: '#22c55e' },  // green
  { key: 'none',      label: 'Unaffiliated',    color: '#94a3b8' },  // light gray
  { key: 'other',     label: 'Other / Unknown', color: '#4b5563' },  // dark gray
]

// Shown in the reader's language through the shared religion catalogue; the key and the filter stay
// English. "Other / Unknown" is one bucket here, so it is named from both catalogue entries.
const groupLabel = (g) => (g.key === 'other'
  ? `${religionFamilyLabel('Other')} / ${religionFamilyLabel('Unknown')}`
  : religionFamilyLabel(g.label))

const COLOR_EXPR = [
  'match', ['get', 'rg'],
  ...RELIGION_GROUPS.flatMap(g => [g.key, g.color]),
  '#4b5563'
]

// Per-group pin counts → fed to FlatLegend so users can see distribution at a glance
const religionCounts = ref({})
const religionLegendItems = computed(() => RELIGION_GROUPS.map(g => ({
  key:   g.key,
  label: groupLabel(g),
  color: g.color,
  count: religionCounts.value[g.key] || 0,
  filter: ['==', ['get', 'rg'], g.key],
})))

function onLegendSelect(node) {
  if (!map.value) return
  if (!node) {
    map.value.setFilter(PIN_LAYER, null)
  } else if (node.filter) {
    map.value.setFilter(PIN_LAYER, node.filter)
  }
}

// ── Local search index — religions + countries (for the geocoder) ────────────
const religionLocalIndex = computed(() => {
  const out = RELIGION_GROUPS.map((g, i) => ({
    id:     `rel:${g.key}`,
    label:  groupLabel(g),
    color:  g.color,
    kind:   'religion',
    depth:  0,
    filter: ['==', ['get', 'rg'], g.key],
  }))
  if (pgData.value) {
    const seen = new Set()
    for (const f of pgData.value.features) {
      const c = f.properties.country
      if (c && !seen.has(c)) {
        seen.add(c)
        out.push({
          id:     `country:${f.properties.iso3 || c}`,
          label:  c,
          kind:   'country',
          depth:  0,
          filter: ['==', ['get', 'iso3'], f.properties.iso3],
        })
      }
    }
  }
  return out
})

const REL_KIND_LABELS = { religion: 'Religion', country: 'Country' }

// ── Pin-click indicator ─────────────────────────────────────────────────────
const pinIndicator = makePinIndicator()
watch(() => pplrInstance.pinDetail.value, p => { if (!p) pinIndicator.hide() })

// Geocoder selection only filters pin visibility — pin appearance stays the
// same as the base map (no halo, no pulse, no size change).
watch(() => pplrInstance.selection.value, sel => {
  if (!map.value) return
  if (!sel) {
    map.value.setFilter(PIN_LAYER, null)
  } else if (sel.filter) {
    map.value.setFilter(PIN_LAYER, sel.filter)
  }
})

function onGeocoderPlace(p) {
  if (!map.value) return
  map.value.stop()  // cancel in-flight animation so back-to-back picks don't stack
  if (p.bbox) {
    map.value.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: 60, maxZoom: 7, duration: 1200 })
  } else if (p.center) {
    map.value.flyTo({ center: p.center, zoom: 5, duration: 1200 })
  }
}

function onPinLocate(p) {
  if (!map.value || p?.lng == null || p?.lat == null) return
  map.value.stop()
  map.value.flyTo({ center: [p.lng, p.lat], zoom: 6, duration: 1200 })
}

const detailColor = computed(() => {
  const p = pplrInstance.pinDetail.value
  if (!p) return '#73A17F'
  return RELIGION_GROUPS.find(g => g.key === p.rg)?.color || '#4b5563'
})

function popupHtml(p) {
  const d = v => (v == null || v === 'None' || v === '' || v === '*') ? '—' : escHtml(v)
  const grp = RELIGION_GROUPS.find(g => g.key === p.rg)
  return `<div class="pplr-popup">
    <h3>${d(p.name)}<small>${d(p.country)}</small></h3>
    <table>
      <tr><td>${escHtml(t('pplr.popup.religion'))}</td><td><b style="color:${grp?.color || '#ccc'}">${d(p.religion)}</b></td></tr>
      <tr><td>${escHtml(t('pplr.popup.language'))}</td><td>${d(p.language)}</td></tr>
      <tr><td>IMB PGID</td><td><code>${d(p.imb)}</code></td></tr>
      <tr><td>JP Code</td><td><code>${d(p.jp)}</code></td></tr>
    </table>
  </div>`
}

onMounted(async () => {
  await initializeMap()
  exposeMap(map.value)
  if (!map.value) {
    // The map did not construct (e.g. provider=mapbox with no token; useMapInstance logs why). Say so
    // and stop: everything below needs a map, and map.value.on() threw into the mounted hook.
    status.value = tStatic('messages.mapUnavailable')   // a shared key: usePplrT would prefix it with pplr.
    return
  }
  if (map.value) {
    map.value.addControl(new (glFor(map.value)).NavigationControl({ showCompass: false, visualizePitch: false }), 'bottom-right')
    map.value.addControl(new FullscreenToggleControl(profileRoot.value), 'bottom-right')
  }
  map.value.on('load', async () => {
    // The constructor's projection:'mercator' is only a request: on Mapbox the style's own projection
    // (globe) wins, so the map booted as a globe while this view's state and button said Mercator, and
    // the first "Switch to Globe" click did nothing (C2). The style is ready here, on both
    // engines, so apply the state to the map.
    setProjectionFor(map.value, projection.value)
    try {
      // Legend now sits top-left under the search bar (~320px wide). Shift the
      // logical center right of that column so the world / globe isn't drawn
      // under the legend column.
      map.value.setPadding({ left: 320, top: 0, right: 0, bottom: 0 })
      status.value = t('pplr.status.loadingPolygons')
      addCountryPolygons(map.value, { theme: pplrInstance.theme.value })
      status.value = t('pplr.status.loadingPins')
      const resp = await fetch(dataUrl('pg-points.json'))
      pgData.value = await resp.json()
      setupLayers()
      const counts = {}
      pgData.value.features.forEach(f => { const g = f.properties.rg; counts[g] = (counts[g] || 0) + 1 })
      religionCounts.value = counts
      const dominant = RELIGION_GROUPS.reduce((a, b) => (counts[a.key] || 0) > (counts[b.key] || 0) ? a : b)
      // No "Ready" prefix: it was unclear and chewed up width.
      status.value = t('pplr.status.readyReligion', { pins: pgData.value.features.length.toLocaleString(), religion: groupLabel(dominant), count: (counts[dominant.key]||0).toLocaleString() })
      // keep the LoadingGlobe up until the pins are actually drawn, not merely added
      await whenGeojsonDrawn(map.value)
      dataReady.value = true
    } catch (err) {
      status.value = t('pplr.status.error', { message: err.message })
    }
  })
})
onBeforeUnmount(() => { releaseMap(map.value); pinIndicator.destroy(); destroy() })

const REL_CSS = POPUP_CSS + `
.pplr-popup h3 small { display: block; font-weight: 400; color: #6b7280; font-size: 11px; margin-top: 2px; }
`
</script>

<template>
  <div ref="profileRoot" class="profile" :data-theme="pplrInstance.theme.value">
    <LoadingGlobe v-if="!isMapReady || !dataReady" :label="status" @retry="reload" />
    <div ref="mapContainer" class="map" />
    <div class="status">{{ status }}</div>
    <div class="header-pill">{{ t('pplr.pill.religion') }}</div>

    <!-- Decoupled geocoder — searches religions + countries + places -->
    <div class="geocoder-slot">
      <MapboxGeocoder
        :local-index="religionLocalIndex"
        :kind-labels="REL_KIND_LABELS"
        :mapbox-token="mapboxToken"
        :placeholder="t('pplr.ui.search')"
        @place="onGeocoderPlace"
      />
    </div>

    <!-- Pin-detail card swaps in for the legend on pin click -->
    <PinDetailCard
      v-if="pplrInstance.pinDetail.value"
      :color="detailColor"
      @locate="onPinLocate"
    />

    <!-- FlatLegend (non-tree) — sits under the search bar like SemanticTreeLegend does on the other profiles -->
    <FlatLegend
      v-else
      :items="religionLegendItems"
      :title="t('pplr.ui.primaryReligion')"
      @select="onLegendSelect"
    />

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
        <button class="toolbar-btn round" :title="t('pplr.ui.baseMap')" @click="showBasemap = !showBasemap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M3 7l9-4 9 4-9 4-9-4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M3 12l9 4 9-4M3 17l9 4 9-4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </button>
        <div v-if="showBasemap" class="basemap-panel">
          <div class="basemap-title">{{ t('pplr.ui.baseMap') }}</div>
          <button v-for="b in BASEMAPS" :key="b.key" class="basemap-opt" :class="{ active: currentBasemap === b.key }" @click="setBasemap(b.key)">{{ b.label }}</button>
        </div>
      </div>
      <!-- Data sources — moved into the toolbar to match ROP-tree -->
      <div class="settings-wrap">
        <button class="toolbar-btn round" :title="t('pplr.ui.dataSources')" @click="showSettings = !showSettings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
            <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.6A7 7 0 0 0 7.5 6.8l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2.1 1.2L10 21h4l.4-2.6a7 7 0 0 0 2.1-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
        </button>
        <div v-if="showSettings" class="settings-panel toolbar-attached">
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

    <component is="style">{{ REL_CSS }}</component>
  </div>
</template>

<style scoped>
.profile { width: 100%; height: 100%; position: relative; }
.map     { width: 100%; height: 100%; }
.loading { position: absolute; inset: 0; display:flex; align-items:center; justify-content:center;
  background: #0f1216; color: #94a3b8; font: 13px sans-serif; z-index: 1; }
/* Lifted above Mapbox attribution; capped narrow so they don't dominate. */
.status {
  position: absolute; bottom: 32px; left: 12px;
  background: rgba(13,17,23,0.92); color: #86efac; border: 1px solid #30363d;
  font: 11px ui-monospace, monospace; padding: 6px 12px; border-radius: 4px; z-index: 2;
  max-width: 380px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.header-pill {
  position: absolute; bottom: 64px; left: 12px;
  background: rgba(13,17,23,0.92); color: #c9d1d9; border: 1px solid #30363d;
  font: 11px system-ui; padding: 6px 12px; border-radius: 999px; z-index: 2;
  max-width: 380px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Geocoder slot — narrowed to match the FlatLegend below it ────────────── */
.geocoder-slot {
  position: absolute; top: 12px; left: 8px; width: 320px; z-index: 5;
}
@media (max-width: 640px) {
  .geocoder-slot { width: calc(100vw - 16px); max-width: 320px; }
}

/* ── Light-mode chrome overrides ─────────────────────────────────────────── */
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
.profile[data-theme="light"] .settings-panel.toolbar-attached {
  background: rgba(255,255,255,0.98); border-color: #d0d7de;
  box-shadow: 0 6px 20px rgba(31,35,40,0.15); color: #1f2328;
}
.profile[data-theme="light"] .settings-src-url {
  background: #f6f8fa; border-color: #d0d7de; color: #57606a;
}
.profile[data-theme="light"] .settings-field { background: #eaeef2; color: #1f2328; }
.map-toolbar {
  position: absolute; top: 12px; right: 12px; z-index: 3;
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

.toolbar-btn.round {
  width: 36px; height: 36px; padding: 0;
  border-radius: 50%; justify-content: center;
  background: #161b22;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
}
.toolbar-btn.round:hover {
  background: #1c2333; transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(59,70,61,0.25);
}
.toolbar-icon { font-size: 13px; line-height: 1; }
.toolbar-label { font-size: 10px; letter-spacing: 0.04em; }
.basemap-wrap { position: relative; }
.basemap-panel {
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
  color: #8b949e; font: 11px system-ui; padding: 4px 8px;
  cursor: pointer; text-align: left;
}
.basemap-opt:hover { background: #161b22; color: #c9d1d9; }
.basemap-opt.active { border-color: #73A17F; color: #73A17F; }

/* ── Settings (data sources) — now a toolbar button, panel drops below ── */
.settings-wrap { position: relative; }
.settings-panel.toolbar-attached {
  position: absolute; top: calc(100% + 4px); right: 0;
  background: rgba(13,17,23,0.97); color: #c9d1d9;
  border: 1px solid #30363d; border-radius: 8px;
  font: 12px system-ui; padding: 12px 16px;
  min-width: 320px; max-width: 420px; max-height: 50vh; overflow-y: auto;
  z-index: 10;
}
.settings-header {
  font: 600 11px ui-monospace, monospace; color: #c9d1d9;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0 4px 8px; margin-bottom: 6px;
  border-bottom: 1px solid #21262d;
}
.profile[data-theme="light"] .settings-header { color: #1f2328; border-bottom-color: #d8dee4; }
.settings-src { margin-bottom: 10px; }
.settings-src:last-child { margin-bottom: 0; }
.settings-src-label {
  font: 600 10px ui-monospace, monospace; color: #73A17F;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;
}
.settings-src-url {
  font: 10px ui-monospace, monospace; color: #6e7681; word-break: break-all;
  background: #161b22; border: 1px solid #21262d; border-radius: 4px;
  padding: 4px 6px; margin-bottom: 4px;
}
.settings-fields { display: flex; flex-wrap: wrap; gap: 3px; }
.settings-field {
  font: 10px ui-monospace, monospace; background: #21262d;
  color: #c9d1d9; border-radius: 3px; padding: 1px 5px;
}
</style>
