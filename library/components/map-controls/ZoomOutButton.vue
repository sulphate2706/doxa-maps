<!--
  ZoomOutButton.vue — Decrements the map zoom level by one step.

  Props:
    map      — the live mapboxgl.Map instance (Object, required)
    isDark   — theme flag forwarded from parent
    disabled — grey out + block the click when the camera is already at the minZoom
               floor. useMapInstance computes that floor from the container aspect, so
               on a short panel zoomOut() would otherwise be a silent no-op; disabling
               makes "at the limit" legible instead of looking like a dead button.
-->
<script setup>
import { useI18n } from 'vue-i18n'
import MapControlButton from './MapControlButton.vue'

const { t } = useI18n()

const props = defineProps({
  map:      { type: Object, default: null },
  isDark:   { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})

function zoomOut() {
  if (props.disabled) return
  // Discrete one-step zoom — see the note in ZoomInButton.vue.
  props.map?.zoomOut()
}
</script>

<template>
  <MapControlButton data-control="zoom-out" :is-dark="isDark" :disabled="disabled" :title="t('buttons.zoomOut')" @click="zoomOut">
    <span style="font-size:22px;line-height:1;font-weight:600;">−</span>
  </MapControlButton>
</template>
