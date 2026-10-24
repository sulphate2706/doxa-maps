<!--
  ZoomInButton.vue — Increments the map zoom level by one step.

  Props:
    map      — the live mapboxgl.Map instance (Object, required)
    isDark   — theme flag forwarded from parent
    disabled — grey out + block the click when the camera is already at maxZoom.
               Declared EXPLICITLY (rather than relying on attribute fallthrough
               reaching MapControlButton's own prop) so the contract is visible to
               callers and survives any future inheritAttrs change.
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

function zoomIn() {
  if (props.disabled) return
  // Mapbox's discrete one-step zoom (a single bounded easing), NOT a continuous
  // per-frame camera loop — keep it that way (see BUG-RESIZE-STROBE).
  props.map?.zoomIn()
}
</script>

<template>
  <MapControlButton data-control="zoom-in" :is-dark="isDark" :disabled="disabled" :title="t('buttons.zoomIn')" @click="zoomIn">
    <span style="font-size:20px;line-height:1;font-weight:600;">+</span>
  </MapControlButton>
</template>
