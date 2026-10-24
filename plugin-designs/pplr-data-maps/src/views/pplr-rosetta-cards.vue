<script setup>
/**
 * pplr-rosetta-cards.vue — Mapbox map of PGs with cross-system-ID popups.
 *
 * Color pins by which IDs are present:
 *   gold = JP + IMB + WCD all present
 *   blue = JP + IMB
 *   purple = IMB only
 *   pink = JP only
 *   gray = neither
 *
 * The 5 sample PGs from rosetta-sample.json are highlighted with larger pins.
 * Click any pin → popup with full Rosetta table.
 */
import { inject, onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { glFor, exposeMap, releaseMap, whenGeojsonDrawn } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'
import { tStatic, formatList } from '@map/i18n/index.js'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { addCountryPolygons, loadOnce, popupForPG, POPUP_CSS, escHtml } from '../utils/pplrMap.js'
import LoadingGlobe from '../components/LoadingGlobe.vue'
import DataSourcesDropdown from '../components/DataSourcesDropdown.vue'

const DATA_SOURCES = [
  { label: 'PG pins (PG-in-country)', url: 'pg-points.json',
    fields: ['code', 'name', 'country', 'iso3', 'rop25', 'imb', 'jp', 'wcd', 'rosetta'] },
  { label: 'Rosetta sample (5 PGs)', url: 'rosetta-sample.json',
    fields: ['joshuaProjectCode', 'imb', 'wcd', 'name', 'country', 'language'] },
]

const mapboxToken = inject('mapboxToken')
const mapContainer = ref(null)
const t = usePplrT()
const status = ref(t('pplr.status.loading'))
const dataReady = ref(false)
function reload() { window.location.reload() }

const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken:  mapboxToken.value,
  style:        'ink',   // named: dark-v11 under Mapbox, OpenFreeMap dark under MapLibre
  center:       [50, 22],
  zoom:         1.8
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
      status.value = t('pplr.status.loadingPgData')
      await addCountryPolygons(map.value)

      status.value = t('pplr.status.loadingPinsRosetta')
      const [pgFc, rosetta] = await Promise.all([
        loadOnce('pg-points.json'),
        loadOnce('rosetta-sample.json')
      ])

      // Mark Rosetta sample PGs (match by joshuaProjectCode)
      const rosKeys = new Set(rosetta.map(r => String(r.joshuaProjectCode || '')))
      pgFc.features.forEach(f => {
        f.properties.rosetta = rosKeys.has(String(f.properties.jp || '')) ? 1 : 0
        const has = (v) => v != null && v !== 'None' && v !== '' && v !== '*'
        const hasJP = has(f.properties.jp), hasIMB = has(f.properties.imb), hasWCD = has(f.properties.wcd)
        f.properties.idTier = hasJP && hasIMB && hasWCD ? 'all' :
                               hasJP && hasIMB         ? 'jp_imb' :
                                         hasIMB        ? 'imb' :
                               hasJP                   ? 'jp' : 'none'
      })

      map.value.addSource('pgs', { type: 'geojson', data: pgFc })

      // All PG pins (small, color by ID-tier)
      map.value.addLayer({
        id: 'pgs-pin',
        type: 'circle',
        source: 'pgs',
        filter: ['==', ['get', 'rosetta'], 0],
        paint: {
          'circle-color': ['match', ['get', 'idTier'],
            'all',    '#fbbf24',
            'jp_imb', '#3b82f6',
            'imb',    '#a78bfa',
            'jp',     '#ec4899',
                      '#6b7280'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 5, 12, 8],
          'circle-stroke-color': '#0d1117',
          'circle-stroke-width': 0.8,
          'circle-opacity': 0.85
        }
      })

      // Rosetta sample (5 stars — slightly larger than base pins so they
      // stand out, but zoom-interpolated so they don't dominate the whole
      // map at low zoom levels: at full size they were far bigger than every
      // other pin and turned the zoomed-out map yellow.
      map.value.addLayer({
        id: 'rosetta-pin',
        type: 'circle',
        source: 'pgs',
        filter: ['==', ['get', 'rosetta'], 1],
        paint: {
          'circle-color': '#fbbf24',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4, 6, 7, 12, 11],
          'circle-stroke-color': '#fbbf24',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 0.5,
          'circle-opacity': 0.95
        }
      })

      const handleClick = e => {
        const f = e.features[0]
        const p = f.properties
        const has = v => v != null && v !== 'None' && v !== '' && v !== '*'
        const sample = rosetta.find(r => String(r.joshuaProjectCode || '') === String(p.jp || ''))

        const missingIds = [
          !has(p.jp)  && 'JoshuaProject',
          !has(p.imb) && 'IMB People',
          !has(p.wcd) && 'WCD',
        ].filter(Boolean)

        const rosettaRow = sample
          ? `<tr><td>Rosetta ★</td><td><b style="color:#d97706">${escHtml(t('pplr.rosetta.samplePg'))}</b></td></tr>`
          : ''
        const missingNote = missingIds.length
          ? `<tr><td colspan="2" style="padding-top:6px;font-size:10px;color:#6b7280;font-style:italic">
               ${escHtml(t('pplr.rosetta.missingIds', { ids: formatList(missingIds) }))}
             </td></tr>`
          : ''
        new (glFor(map.value)).Popup({ maxWidth: '360px' })
          .setLngLat(f.geometry.coordinates)
          .setHTML(popupForPG(p, rosettaRow + missingNote))
          .addTo(map.value)
      }
      map.value.on('click', 'pgs-pin', handleClick)
      map.value.on('click', 'rosetta-pin', handleClick)
      map.value.on('mouseenter', 'pgs-pin', () => map.value.getCanvas().style.cursor = 'pointer')
      map.value.on('mouseleave', 'pgs-pin', () => map.value.getCanvas().style.cursor = '')
      map.value.on('mouseenter', 'rosetta-pin', () => map.value.getCanvas().style.cursor = 'pointer')
      map.value.on('mouseleave', 'rosetta-pin', () => map.value.getCanvas().style.cursor = '')

      status.value = t('pplr.status.readyRosetta', { pins: pgFc.features.length, samples: rosKeys.size })
      // keep the LoadingGlobe up until the pins are actually drawn, not merely added
      await whenGeojsonDrawn(map.value)
      dataReady.value = true
    } catch (e) {
      status.value = t('pplr.status.error', { message: e.message })
    }
  })
})
onBeforeUnmount(() => { releaseMap(map.value); destroy() })

const LEGEND = computed(() => [
  { color: '#fbbf24', label: t('pplr.rosetta.legend.all') },
  { color: '#3b82f6', label: 'JP + IMB' },
  { color: '#a78bfa', label: t('pplr.rosetta.legend.imbOnly') },
  { color: '#ec4899', label: t('pplr.rosetta.legend.jpOnly') },
  { color: '#6b7280', label: t('pplr.rosetta.legend.neither') },
])
</script>

<template>
  <div class="profile">
    <LoadingGlobe v-if="!isMapReady || !dataReady" :label="status" @retry="reload" />
    <div ref="mapContainer" class="map" />
    <div class="status">{{ status }}</div>
    <div class="header-pill">{{ t('pplr.pill.rosetta') }}</div>
    <div class="legend">
      <div class="title">{{ t('pplr.legendTitle.idCoverage') }}</div>
      <div v-for="l in LEGEND" :key="l.label" class="row">
        <span class="dot" :style="{ background: l.color }" />{{ l.label }}
      </div>
    </div>
    <div class="map-toolbar">
      <DataSourcesDropdown :sources="DATA_SOURCES" />
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
  background: rgba(13,17,23,0.92); color: #fcd34d; border: 1px solid #30363d;
  font: 11px ui-monospace, monospace; padding: 6px 12px; border-radius: 4px; z-index: 2;
}
.header-pill {
  position: absolute; top: 12px; left: 12px;
  background: rgba(13,17,23,0.92); color: #c9d1d9; border: 1px solid #30363d;
  font: 12px system-ui; padding: 8px 14px; border-radius: 999px; z-index: 2;
}
/* Legend shifted down to clear the new top-right toolbar (data sources gear) */
.legend {
  position: absolute; top: 56px; right: 12px; z-index: 2;
  background: rgba(13,17,23,0.94); color: #c9d1d9; border: 1px solid #30363d;
  border-radius: 6px; padding: 10px 14px; min-width: 160px;
}
.legend .title { font: 600 11px system-ui; color: #fcd34d; margin-bottom: 6px;
  text-transform: uppercase; letter-spacing: 0.04em; }
.legend .row { display: flex; align-items: center; gap: 8px; font: 11px system-ui; padding: 2px 0; }
.legend .dot { width: 12px; height: 12px; border-radius: 50%; }
.map-toolbar { position: absolute; top: 12px; right: 12px; z-index: 5; }
</style>
