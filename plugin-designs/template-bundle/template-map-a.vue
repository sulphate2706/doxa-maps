<script setup>
/**
 * template-map-a.vue — example profile "A": a minimal REAL map. Copy this.
 *
 * @description Minimal working map: one data layer from data/, one translated string, both engines.
 * @profile     template-map-a
 * @bundle      template-bundle
 * @element     template-bundle
 *
 * This file sits DIRECTLY in the bundle folder, NOT in a profiles/ subfolder. Its filename without
 * `.vue` is the profile name a host requests:
 *
 *   <template-bundle profile-config='{"profile":"template-map-a"}'></template-bundle>
 *
 * WHAT A NEW MAP GETS BY COPYING THIS (every piece is the library's, so it behaves like the others):
 *   - the ENGINE, the LOCALE (+ right-to-left) and the Mapbox TOKEN are the page's universal props
 *     (documentation/reference-universal-props.md). useMapInstance reads the engine; ProfileLoader
 *     gives the locale, `dir`, and the token (inject('mapboxToken')). Nothing is hard-coded here.
 *   - WITH NO TOKEN it runs on keyless MapLibre, so a first copy works with no account at all.
 *   - one DATA layer from this bundle's own data/ folder (a static import ships it inside the bundle,
 *     so it loads on any host with no extra request);
 *   - its TEXT from the catalogue: every string a reader sees is a key in
 *     library/i18n/locales/<lc>/template.json (title, and the two error lines), in all eleven locales;
 *     t() runs IN THE TEMPLATE, so the words follow a host that changes the language after mount. A
 *     label computed once at setup (`const title = t('template.title')`) stays in the first language
 *     forever; an error keeps its KEY in state (errorKey), not its English sentence;
 *   - label fonts and emissive paint that are right on either engine (labelFont, emissivePaint).
 *   - a pin colour from THIS bundle's src/colors/colors.json: your own code is a RELATIVE import;
 *     @map/... is only for the shared library. Edit the hex and rebuild to recolour.
 * Replace data/places.geojson with your own points, rename the title key, and you have your map.
 */
import { inject, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { resolveMapProvider, emissivePaint } from '@map/composables/useMapProvider.js'
import { labelFont } from '@map/maps/label-font.js'
import colors from './src/colors/colors.json'
import places from './data/places.geojson?raw'

const { t } = useI18n()
const profileConfig = inject('profileConfig', null)
const mapboxToken = inject('mapboxToken', ref(''))

// The page's engine choice (profile-config provider → ?provider= → window.MAP_PROVIDER). With no
// token, Mapbox cannot draw at all, so a keyless page gets MapLibre. (Once the library's AUTO default
// lands, resolveMapProvider does this itself and this line can go.)
const asked = resolveMapProvider(profileConfig)
const provider = asked === 'mapbox' && !mapboxToken.value ? 'maplibre' : asked

const mapEl = ref(null)
// The KEY of what went wrong, not its words: the template translates it, in whatever language is
// current when it is shown. errorDetail is the engine's own message, passed in as a value.
const errorKey = ref('')
const errorDetail = ref('')
const { map, initializeMap, destroy } = useMapInstance({
  containerRef: mapEl,
  accessToken: mapboxToken.value,
  provider,
  // Under MapLibre, useMapInstance swaps this mapbox:// style for its free (OpenFreeMap) basemap.
  style: 'mapbox://styles/mapbox/light-v11',
  center: [40, 15],
  zoom: 1.4,
})

function addPlaces(m) {
  m.addSource('places', { type: 'geojson', data: JSON.parse(places) })
  m.addLayer({
    id: 'places-dots', type: 'circle', source: 'places',
    paint: { 'circle-radius': 7, 'circle-color': colors.pins.selected, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, ...emissivePaint(m) },
  })
  m.addLayer({
    id: 'places-labels', type: 'symbol', source: 'places',
    layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', ...labelFont(m, { weight: 'medium' }) },
    paint: { 'text-color': '#3b463d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  })
}

onMounted(async () => {
  try { await initializeMap() } catch (e) { errorKey.value = 'template.mapFailed'; errorDetail.value = String(e?.message || e); return }
  const m = map.value
  if (!m) { errorKey.value = 'template.engineMissing'; return }
  // add the data once the style is ready (it may already be, so do not wait for an event that passed)
  if (m.isStyleLoaded()) addPlaces(m)
  else m.once('load', () => addPlaces(m))
})
onBeforeUnmount(() => destroy())
</script>

<template>
  <div class="tpl-map">
    <div ref="mapEl" class="tpl-map__canvas"></div>
    <div class="tpl-map__title">{{ t('template.title') }}</div>
    <div v-if="errorKey" class="tpl-map__error" role="alert">{{ t(errorKey, { detail: errorDetail }) }}</div>
  </div>
</template>

<style scoped>
.tpl-map { position: relative; width: 100%; height: 100%; min-height: 360px; }
.tpl-map__canvas { position: absolute; inset: 0; }
.tpl-map__title {
  position: absolute; top: 12px; inset-inline-start: 12px; z-index: 2;
  background: #ffffff; color: #3b463d; border: 1px solid #d1d4cd; border-radius: 8px;
  padding: 6px 10px; font: 600 14px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
.tpl-map__error { position: absolute; bottom: 12px; inset-inline-start: 12px; z-index: 2; color: #b3412f; background: #fff; padding: 6px 10px; border-radius: 6px; }
</style>
