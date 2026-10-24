<!--
  LocationButton.vue — Flies the map to the user's current location via the
  browser geolocation API. Falls back to the world-overview default if the
  user denies permission, the API isn't available, or the request times out.

  Props:
    map          — the live mapboxgl.Map instance (Object, required)
    isDark       — theme flag forwarded from parent
    center       — fallback center [lng, lat] if geolocation fails
    zoom         — fallback zoom if geolocation fails
    userZoom     — zoom level when the user's location is granted (default 10)
-->
<script setup>
import { useI18n } from 'vue-i18n'
import MapControlButton from './MapControlButton.vue'

const { t } = useI18n()

const props = defineProps({
  map:      { type: Object,  default: null },
  isDark:   { type: Boolean, default: false },
  center:   { type: Array,   default: () => [20, 10] },
  zoom:     { type: Number,  default: 1.8 },
  userZoom: { type: Number,  default: 10 }
})

function flyToDefault() {
  props.map?.flyTo({ center: props.center, zoom: props.zoom, duration: 1200 })
}

function resetView() {
  if (!props.map) return
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    flyToDefault()
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { longitude, latitude } = pos.coords
      if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
        props.map.flyTo({ center: [longitude, latitude], zoom: props.userZoom, duration: 1500 })
      } else {
        flyToDefault()
      }
    },
    () => flyToDefault(),                                      // permission denied / error
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
  )
}
</script>

<template>
  <MapControlButton data-control="location" :is-dark="isDark" :title="t('buttons.resetView')" @click="resetView">
    <!-- Location / map-pin SVG -->
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
         fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>
    </svg>
  </MapControlButton>
</template>
