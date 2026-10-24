<script setup>
import { dataUrl, glFor, exposeMap, releaseMap, whenGeojsonDrawn } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'
import { formatCount } from '@map/utils/formatCount.js'   // counts stay fixed en-US: numerals are held, pending a product decision
import { tStatic } from '@map/i18n/index.js'
/**
 * pplr-coverage.vue — Country choropleth: avg # of locales filled per PG in that country.
 *
 * Uses pg-points.geojson grouped by ISO3 to compute per-country PG count + avg
 * translation-completeness (using DisplayName_<loc> nullity check from pg-names.jsonl).
 *
 * For perf, computes coverage from the JSONL streamed first ~6000 records (covers
 * most countries, may underestimate sparser ones — flagged in the popup).
 */
import { inject, onMounted, onBeforeUnmount, ref } from 'vue'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { addCountryPolygons, addPGPoints, loadOnce, LOCALES, popupForPG, POPUP_CSS, escHtml } from '../utils/pplrMap.js'
import LoadingGlobe from '../components/LoadingGlobe.vue'
import DataSourcesDropdown from '../components/DataSourcesDropdown.vue'

const DATA_SOURCES = [
  { label: 'PG pins (PG-in-country)', url: 'pg-points.json',
    fields: ['code', 'iso3', 'country', 'n_en…n_de (17 locale name fields)'] },
  { label: 'Country polygons (live)', url: 'PPLR FeatureServer · aCountry',
    fields: ['GENCalpha3', 'ISOalpha2', 'CtryNm', 'ctryNmDisp'] },
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
  center:       [25, 18],
  zoom:         1.6
})

// Compute per-country: pg_count + avg locales filled
const countryStats = new Map()  // iso3 → { pgCount, localeSum, sampleN }

// Precomputed by scripts/build-data.mjs over ALL aROP3ByCountry rows of pg-names.jsonl (the
// original streamed a 6,000-row sample of that 56 MB file in the browser).
async function streamCoverage() {
  const r = await fetch(dataUrl('coverage.json'))
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const all = await r.json()
  for (const [iso, s] of Object.entries(all)) countryStats.set(iso, { pgCount: s.pgCount, localeSum: s.localeSum, sampleN: s.pgCount })
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
  map.value.on('load', async () => {
    try {
      status.value = t('pplr.status.loadingCoverage')
      await streamCoverage()
      status.value = t('pplr.status.loadingPolygons')
      const { fc, sourceId } = await addCountryPolygons(map.value, { fillOpacity: 0, blocking: true })

      // Add a choropleth fill layer above the base
      fc.features.forEach(f => {
        const iso = f.properties.GENCalpha3
        const s = iso ? countryStats.get(iso) : null
        f.properties.avgFilled = s ? s.localeSum / s.sampleN : null
        f.properties.pgCount = s ? s.pgCount : 0
      })
      // Replace the source data so feature properties carry coverage
      map.value.getSource(sourceId).setData(fc)
      // Verification handle (the gospel-resources __grState contract): how many country
      // polygons found a coverage row. A key mismatch paints every country the "no data" grey.
      if (typeof window !== 'undefined') window.__pplrCoverage = _coverageHook = () => ({
        polygons: fc.features.length,
        matched: fc.features.filter(f => f.properties.avgFilled != null).length,
        sampleUnmatched: fc.features.filter(f => f.properties.avgFilled == null).slice(0, 5).map(f => f.properties.GENCalpha3),
        rendered: map.value?.getLayer('choropleth') ? map.value.queryRenderedFeatures({ layers: ['choropleth'] }).length : 0,
      })

      map.value.addLayer({
        id: 'choropleth',
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': [
            'case', ['==', ['get', 'avgFilled'], null], 'rgba(31,41,55,0.4)',
            ['interpolate', ['linear'], ['get', 'avgFilled'],
              0,  '#7f1d1d',   // dark red — 0 locales
              4,  '#dc2626',   // red — 4
              8,  '#f59e0b',   // amber — 8
              12, '#84cc16',   // lime — 12
              17, '#22c55e'    // green — 17/17
            ]
          ],
          'fill-opacity': 0.7
        }
      }, `${sourceId}-line`)  // place under the line layer

      // Country popup
      map.value.on('click', 'choropleth', e => {
        const p = e.features[0].properties
        const html = `<div class="pplr-popup">
          <h3>${escHtml(p.CtryNm || p.ctryNmDisp || '—')}<small>${escHtml(p.GENCalpha3 || p.ISOalpha2 || '?')}</small></h3>
          <table>
            <tr><td>${escHtml(t('pplr.popup.pgCount'))}</td><td><b>${escHtml(p.pgCount || 0)}</b></td></tr>
            <tr><td>${escHtml(t('pplr.popup.avgLocalesFilled'))}</td><td>
              <b>${p.avgFilled != null ? p.avgFilled.toFixed(1) : '—'}</b> / 17</td></tr>
          </table>
        </div>`
        new (glFor(map.value)).Popup({ maxWidth: '300px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map.value)
      })

      status.value = t('pplr.status.addingPinsOnTop')
      const { pinLayerId } = await addPGPoints(map.value, { circleColor: '#fef3c7' })
      map.value.on('click', pinLayerId, e => {
        const f = e.features[0]
        new (glFor(map.value)).Popup({ maxWidth: '320px' })
          .setLngLat(f.geometry.coordinates).setHTML(popupForPG(f.properties)).addTo(map.value)
      })
      status.value = t('pplr.status.readyCoverage', { countries: countryStats.size, rows: formatCount([...countryStats.values()].reduce((n, c) => n + c.pgCount, 0)) })
      // keep the LoadingGlobe up until the pins are actually drawn, not merely added
      await whenGeojsonDrawn(map.value)
      dataReady.value = true
    } catch (e) {
      status.value = t('pplr.status.error', { message: e.message })
    }
  })
})
let _coverageHook = null
onBeforeUnmount(() => {
  releaseMap(map.value)
  // Release this view's own hook too (only if it is still ours).
  if (typeof window !== 'undefined' && window.__pplrCoverage === _coverageHook) delete window.__pplrCoverage
  destroy()
})

const SCALE = [
  { stop: '0',  color: '#7f1d1d', label: '0' },    // the legend title names the unit (pplr.legendTitle.avgLocales)
  { stop: '4',  color: '#dc2626', label: '' },
  { stop: '8',  color: '#f59e0b', label: '8' },
  { stop: '12', color: '#84cc16', label: '' },
  { stop: '17', color: '#22c55e', label: '17/17' },
]

const COV_POPUP_CSS = POPUP_CSS + `
.pplr-popup h3 small { font-weight: 400; color: #6b7280; margin-left: 6px; font-size: 11px; font-family: ui-monospace, monospace; }
`
</script>

<template>
  <div class="profile">
    <LoadingGlobe v-if="!isMapReady || !dataReady" :label="status" @retry="reload" />
    <div ref="mapContainer" class="map" />
    <div class="status">{{ status }}</div>
    <div class="header-pill">{{ t('pplr.pill.coverage') }}</div>
    <div class="legend">
      <div class="title">{{ t('pplr.legendTitle.avgLocales', { n: 17 }) }}</div>
      <div class="bar">
        <div v-for="s in SCALE" :key="s.stop" class="seg" :style="{ background: s.color }">
          <span v-if="s.label">{{ s.label }}</span>
        </div>
      </div>
    </div>
    <div class="map-toolbar">
      <DataSourcesDropdown :sources="DATA_SOURCES" />
    </div>
    <component is="style">{{ COV_POPUP_CSS }}</component>
  </div>
</template>

<style scoped>
.profile { width: 100%; height: 100%; position: relative; }
.map     { width: 100%; height: 100%; }
.loading { position: absolute; inset: 0; display:flex; align-items:center; justify-content:center;
  background: #0f1216; color: #94a3b8; font: 13px sans-serif; z-index: 1; }
.status {
  position: absolute; bottom: 12px; left: 12px;
  background: rgba(13,17,23,0.92); color: #86efac; border: 1px solid #30363d;
  font: 11px ui-monospace, monospace; padding: 6px 12px; border-radius: 4px; z-index: 2;
}
.header-pill {
  position: absolute; top: 12px; left: 12px;
  background: rgba(13,17,23,0.92); color: #c9d1d9; border: 1px solid #30363d;
  font: 12px system-ui; padding: 8px 14px; border-radius: 999px; z-index: 2;
}
/* Legend shifted down to clear the new top-right toolbar (data sources) */
.legend {
  position: absolute; top: 56px; right: 12px; z-index: 2;
  background: rgba(13,17,23,0.94); color: #c9d1d9; border: 1px solid #30363d;
  border-radius: 6px; padding: 8px 12px; min-width: 200px;
}
.map-toolbar { position: absolute; top: 12px; right: 12px; z-index: 5; }
.legend .title { font: 600 10px system-ui; color: #86efac; margin-bottom: 6px;
  text-transform: uppercase; letter-spacing: 0.04em; }
.legend .bar { display: flex; height: 22px; border-radius: 4px; overflow: hidden;
  border: 1px solid #30363d; }
.legend .seg { flex: 1; display: flex; align-items: center; justify-content: center;
  font: 10px ui-monospace, monospace; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
</style>
