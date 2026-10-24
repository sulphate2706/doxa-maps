<!--
  ThemeToggleButton.vue — Switches the app between light and dark mode.

  The component itself only emits `toggle`; the heavier work of swapping the
  Mapbox style and re-adding custom layers lives in the parent
  (doxa-simple-map.vue) where the layer references are available.

  Props:
    isDark — current theme state (controls icon: 🌙 = go dark, ☀️ = go light)

  Emits:
    toggle — fires on click; parent is responsible for calling
             uiStore.toggleTheme() and map.setStyle(...)
-->
<script setup>
import { useI18n } from 'vue-i18n'
import MapControlButton from './MapControlButton.vue'
// FEATURE FLAG (single source of truth in useMapTheme.js). When THEME_TOGGLE is
// false this control renders NOTHING — gating it HERE hides it from every profile
// at once (research-map + simple-map) without editing either profile.
import { THEME_TOGGLE } from '@map/composables/useMapTheme.js'

const { t } = useI18n()

defineProps({
  isDark: { type: Boolean, default: false }
})

defineEmits(['toggle'])
</script>

<template>
  <MapControlButton
    v-if="THEME_TOGGLE"
    data-control="theme"
    :is-dark="isDark"
    :title="isDark ? t('buttons.switchToLightMode') : t('buttons.switchToDarkMode')"
    @click="$emit('toggle')"
  >
    <span style="font-size:16px;line-height:1;">{{ isDark ? '☀️' : '🌙' }}</span>
  </MapControlButton>
</template>
