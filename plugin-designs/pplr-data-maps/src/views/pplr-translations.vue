<script setup>
import { dataUrl, glFor, exposeMap, releaseMap, whenGeojsonDrawn } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'
import { tStatic } from '@map/i18n/index.js'
/**
 * pplr-translations.vue — PG name in all 17 locales.
 *
 * Pin click → PinDetailCard sidebar (scrollable) — same pattern as ROP-tree
 * and Language-Families profiles. Replaced the old mapboxgl.Popup which
 * couldn't fit all 17 locales without a scrollbar inside the popup.
 */
import { inject, onMounted, onBeforeUnmount, ref, computed, watch } from 'vue'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { addCountryPolygons, POPUP_CSS, FullscreenToggleControl, makePinIndicator, bindFuzzyPinClick } from '../utils/pplrMap.js'
import PinDetailCard from '../components/PinDetailCard.vue'
import LoadingGlobe from '../components/LoadingGlobe.vue'
import { createPplrInstance, provideInstance } from '@map/composables/usePplrInstance.js'

const pplrInstance = createPplrInstance('translations')
provideInstance(pplrInstance)

const mapboxToken = inject('mapboxToken')
const mapContainer = ref(null)
const profileRoot  = ref(null)
const t = usePplrT()
const status = ref(t('pplr.status.loading'))
const PIN_LAYER = 'trans-pins'

const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken:  mapboxToken.value,
  style:        'ink',   // named: dark-v11 under Mapbox, OpenFreeMap dark under MapLibre
  center:       [70, 22],
  zoom:         2,
  projection:   'mercator',
})

// ── Pin-click indicator ─────────────────────────────────────────────────────
const pinIndicator = makePinIndicator()
watch(() => pplrInstance.pinDetail.value, p => { if (!p) pinIndicator.hide() })

function onPinLocate(p) {
  if (!map.value || p?.lng == null || p?.lat == null) return
  map.value.stop()
  map.value.flyTo({ center: [p.lng, p.lat], zoom: 6, duration: 1200 })
}

const detailColor = computed(() => '#a78bfa')  // tab's accent purple
const dataReady = ref(false)
function reload() { window.location.reload() }

const showSettings = ref(false)
const DATA_SOURCES = [
  { label: 'PG pins (PG-in-country)', url: 'pg-points.json',
    fields: ['code', 'name', 'country', 'iso3', 'rop25', 'language', 'n_en…n_de (17 locales)'] },
  { label: 'Country polygons (live)', url: 'PPLR FeatureServer · aCountry',
    fields: ['GENCalpha3', 'ISOalpha2', 'CtryNm', 'ctryNmDisp'] },
]

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
    try {
      map.value.setPadding({ left: 380, top: 0, right: 0, bottom: 0 })
      status.value = t('pplr.status.loadingPgData')
      addCountryPolygons(map.value, { theme: pplrInstance.theme.value })

      status.value = t('pplr.status.loadingPins')
      const resp = await fetch(dataUrl('pg-points.json'))
      const fc = await resp.json()

      map.value.addSource('trans-pgs', { type: 'geojson', data: fc, cluster: false })
      map.value.addLayer({
        id: PIN_LAYER, type: 'circle', source: 'trans-pgs',
        paint: {
          'circle-color': '#a78bfa',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 4, 12, 7],
          'circle-opacity': 0.85,
          'circle-stroke-color': '#0d1117',
          'circle-stroke-width': 0.6,
        },
      })

      bindFuzzyPinClick(map.value, PIN_LAYER, ({ features }) => {
        const f = features[0]
        const lng = f.geometry.coordinates[0]
        const lat = f.geometry.coordinates[1]
        pplrInstance.pinDetail.value = { ...f.properties, lng, lat }
        pinIndicator.show(map.value, [lng, lat], { color: '#a78bfa' })
      })

      status.value = t('pplr.status.readyTranslations', { pins: fc.features.length.toLocaleString() })
      // keep the LoadingGlobe up until the pins are actually drawn, not merely added
      await whenGeojsonDrawn(map.value)
      dataReady.value = true
    } catch (err) {
      status.value = t('pplr.status.error', { message: err.message })
    }
  })
})

onBeforeUnmount(() => { releaseMap(map.value); pinIndicator.destroy(); destroy() })
</script>

<template>
  <div ref="profileRoot" class="profile" :data-theme="pplrInstance.theme.value">
    <LoadingGlobe v-if="!isMapReady || !dataReady" :label="status" @retry="reload" />

    <!-- Pin-detail card with all 17 locales scrollable -->
    <PinDetailCard
      v-if="pplrInstance.pinDetail.value"
      :color="detailColor"
      @locate="onPinLocate"
    />

    <div ref="mapContainer" class="map" />
    <div class="status">{{ status }}</div>
    <div class="header-pill">{{ t('pplr.pill.translations', { n: 17 }) }}</div>

    <!-- Toolbar — single-button (data sources) for now; this profile doesn't
         expose theme / projection / basemap toggles since it's locale-focused. -->
    <div class="map-toolbar">
      <div class="settings-wrap">
        <button class="toolbar-btn round" :title="t('pplr.ui.dataSources')" :aria-label="t('pplr.ui.dataSources')" @click="showSettings = !showSettings">
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

    <component is="style">{{ POPUP_CSS }}</component>
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
.status {
  position: absolute; bottom: 32px; left: 12px;
  background: rgba(13,17,23,0.92); color: #c4b5fd; border: 1px solid #30363d;
  font: 11px ui-monospace, monospace; padding: 6px 12px; border-radius: 999px; z-index: 2;
  max-width: 340px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.header-pill {
  position: absolute; bottom: 64px; left: 12px;
  background: rgba(13,17,23,0.92); color: #c9d1d9; border: 1px solid #30363d;
  font: 11px system-ui; padding: 6px 12px; border-radius: 999px; z-index: 2;
  max-width: 340px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Toolbar (data sources only on this profile) ─────────────────────────── */
.map-toolbar {
  position: absolute; top: 12px; right: 12px; z-index: 5;
  display: flex; flex-direction: column; gap: 4px; align-items: flex-end;
}
.toolbar-btn.round {
  width: 36px; height: 36px; padding: 0;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: #161b22; color: #8b949e;
  border: 1px solid #30363d; cursor: pointer;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
  transition: color 0.12s, background 0.12s, transform 0.12s, box-shadow 0.12s;
}
.toolbar-btn.round:hover {
  background: #1c2333; color: #c9d1d9; border-color: #73A17F;
  transform: translateY(-1px); box-shadow: 0 5px 14px rgba(59,70,61,0.25);
}
.settings-wrap { position: relative; }
.settings-panel {
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
.settings-src { margin-bottom: 8px; }
.settings-src:last-child { margin-bottom: 0; }
.settings-src-label {
  font: 600 9px ui-monospace, monospace; color: #73A17F;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;
}
.settings-src-url {
  font: 10px ui-monospace, monospace; color: #6e7681; word-break: break-all;
  background: #161b22; border: 1px solid #21262d; border-radius: 3px;
  padding: 3px 5px; margin-bottom: 3px;
}
.settings-fields { display: flex; flex-wrap: wrap; gap: 2px; }
.settings-field {
  font: 10px ui-monospace, monospace; background: #21262d;
  color: #c9d1d9; border-radius: 3px; padding: 1px 4px;
}
</style>
