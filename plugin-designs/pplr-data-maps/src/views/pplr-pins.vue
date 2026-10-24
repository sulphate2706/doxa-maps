<script setup>
/**
 * pplr-pins.vue — All 26,349 PG-in-country pins on Mapbox + country polygons.
 * Validates lat/long completeness and global PG distribution.
 * Individual pins at all zoom levels; click pin for full Rosetta popup; hover country for highlight.
 */
import { inject, onMounted, onBeforeUnmount, ref } from 'vue'
import { glFor, exposeMap, releaseMap, whenGeojsonDrawn } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'
import { formatCount } from '@map/utils/formatCount.js'   // counts stay fixed en-US: numerals are held, pending a product decision
import { tStatic } from '@map/i18n/index.js'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { addCountryPolygons, addPGPoints, popupForPG, POPUP_CSS } from '../utils/pplrMap.js'
import LoadingGlobe from '../components/LoadingGlobe.vue'

const mapboxToken = inject('mapboxToken')
const mapContainer = ref(null)
const t = usePplrT()
const status = ref(t('pplr.status.loading'))
const dataReady = ref(false)
function reload() { window.location.reload() }

const showSettings = ref(false)
const DATA_SOURCES = [
  { label: 'PG pins (PG-in-country)', url: 'pg-points.json',
    fields: ['code', 'name', 'country', 'iso3', 'rop1–3', 'rop25', 'imb', 'jp', 'wcd', 'religion', 'language', 'pop'] },
  { label: 'Country polygons (live)', url: 'PPLR FeatureServer · aCountry',
    fields: ['GENCalpha3', 'ISOalpha2', 'CtryNm', 'ctryNmDisp'] },
]

const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken:  mapboxToken.value,
  style:        'ink',   // named: dark-v11 under Mapbox, OpenFreeMap dark under MapLibre
  center:       [25, 18],
  zoom:         1.6
})

onMounted(async () => {
  await initializeMap()
  exposeMap(map.value)
  if (!map.value) {
    // The map did not construct (e.g. provider=mapbox with no token; useMapInstance logs why). Say so
    // and stop: everything below needs a map, and map.value.on() threw into the mounted hook.
    status.value = tStatic('messages.mapUnavailable')   // a shared key: usePplrT would prefix it with pplr.
    return
  }
  map.value.on('load', async () => {
    try {
      status.value = t('pplr.status.addingPolygons')
      await addCountryPolygons(map.value)
      status.value = t('pplr.status.addingPins')
      const { fc, pinLayerId } = await addPGPoints(map.value)

      map.value.on('click', pinLayerId, e => {
        const f = e.features[0]
        new (glFor(map.value)).Popup({ maxWidth: '340px' })
          .setLngLat(f.geometry.coordinates)
          .setHTML(popupForPG(f.properties))
          .addTo(map.value)
      })
      status.value = t('pplr.status.readyPins', { pins: formatCount(fc.features.length) })
      // keep the LoadingGlobe up until the pins are actually drawn, not merely added
      await whenGeojsonDrawn(map.value)
      dataReady.value = true
    } catch (e) {
      status.value = t('pplr.status.error', { message: e.message })
    }
  })
})
onBeforeUnmount(() => { releaseMap(map.value); destroy() })
</script>

<template>
  <div class="profile">
    <LoadingGlobe v-if="!isMapReady || !dataReady" :label="status" @retry="reload" />
    <div ref="mapContainer" class="map" />
    <div class="status">{{ status }}</div>
    <div class="header-pill">{{ t('pplr.pill.pins') }}</div>

    <div class="map-toolbar">
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

    <component is="style">{{ POPUP_CSS }}</component>
  </div>
</template>

<style scoped>
.profile { width: 100%; height: 100%; position: relative; }
.map     { width: 100%; height: 100%; }
.loading { position: absolute; inset: 0; display:flex; align-items:center; justify-content:center;
  background: #0f1216; color: #94a3b8; font: 13px sans-serif; z-index: 1; }
.status {
  position: absolute; bottom: 12px; left: 12px;
  background: rgba(13,17,23,0.92); color: #79c0ff; border: 1px solid #30363d;
  font: 11px ui-monospace, monospace;
  padding: 6px 12px; border-radius: 4px; z-index: 2;
}
.header-pill {
  position: absolute; top: 12px; left: 12px;
  background: rgba(13,17,23,0.92); color: #c9d1d9; border: 1px solid #30363d;
  font: 12px system-ui; padding: 8px 14px; border-radius: 999px; z-index: 2;
}

/* ── Toolbar (data sources only) ────────────────────────────────────────── */
.map-toolbar {
  position: absolute; top: 12px; right: 12px; z-index: 5;
  display: flex; flex-direction: column; gap: 4px;
}
.toolbar-btn.round {
  width: 36px; height: 36px; padding: 0;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: #161b22; color: #8b949e;
  border: 1px solid #30363d; cursor: pointer;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
}
.toolbar-btn.round:hover { background: #1c2333; color: #c9d1d9; border-color: #73A17F; }
.settings-wrap { position: relative; }
.settings-panel {
  position: absolute; top: calc(100% + 4px); right: 0;
  background: rgba(13,17,23,0.97); color: #c9d1d9;
  border: 1px solid #30363d; border-radius: 8px;
  font: 12px system-ui; padding: 12px 16px;
  min-width: 320px; max-width: 420px; z-index: 10;
}
.settings-header {
  font: 600 11px ui-monospace, monospace; color: #c9d1d9;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0 4px 8px; margin-bottom: 6px;
  border-bottom: 1px solid #21262d;
}
.settings-src { margin-bottom: 8px; }
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
