<!--
  MapPrintProgress.vue — SHARED. The loading screen of a map print (mapPrintTemplate.js).

  ★ THE SAME HUD THE POSTER WALL SHOWS while it prepares a poster (the same card, bar and phase line), so a
  map print looks like the posters' prints rather than a button that goes quiet for a minute. It shows the
  renderer's own progress (useMapPoster's `progress.percent`), so a long render shows how far along it is. The
  renderer's phase MESSAGES are English developer strings, so they are not shown. Styles go in through useShadowStyles, because it renders inside the map's shadow root.
-->
<template>
  <div v-if="visible" class="mpp-scrim" role="status" aria-live="polite" :aria-label="kind">
    <div class="mpp-card">
      <div class="mpp-kind">{{ kind }}</div>
      <div class="mpp-title">{{ title }}</div>
      <div class="mpp-bar"><div class="mpp-fill" :style="{ width: pct + '%' }"></div></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useShadowStyles } from '../../composables/useShadowStyles.js'

const props = defineProps({
  visible:  { type: Boolean, default: false },
  kind:     { type: String, default: '' },
  title:    { type: String, default: '' },
  /** useMapPoster's progress: { percent, message } */
  progress: { type: Object, default: null },
})
// Never an empty bar while the renderer warms up: 3% until it reports.
const pct = computed(() => Math.max(3, Math.min(100, Number(props.progress?.percent) || 0)))

useShadowStyles(
  '.mpp-scrim{position:fixed;inset:0;z-index:1000;background:rgba(8,12,16,.55);display:grid;place-items:center;padding:22px}' +
  '.mpp-card{width:min(340px,100%);background:#fff;color:#0f1419;border-radius:14px;padding:20px 22px;' +
  'box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:center}' +
  '.mpp-kind{font-size:10px;text-transform:uppercase;letter-spacing:.1em;opacity:.55}' +
  '.mpp-title{margin:3px 0 14px;font-size:15px;font-weight:700;line-height:1.3}' +
  '.mpp-bar{height:5px;border-radius:99px;background:rgba(0,0,0,.10);overflow:hidden}' +
  '.mpp-fill{height:100%;background:#10b981;border-radius:99px;transition:width .25s ease}' +
  '@media (prefers-reduced-motion: reduce){.mpp-fill{transition:none}}'
)
</script>
