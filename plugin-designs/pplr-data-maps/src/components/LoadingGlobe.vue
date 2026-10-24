<script setup>
/**
 * LoadingGlobe — rotating-globe SVG used as the universal loading state.
 *
 * Stays mounted while a profile is loading ANY stage (basemap tiles, PG pins,
 * country polygons, etc.). The label updates as the profile progresses so the
 * user sees "Loading basemap" → "Loading pins" → "Adding layers" rather than
 * a single stuck spinner. If 30 seconds pass with no progress (`stuck` flips
 * true via `stuckAfterMs`), a "Retry" button appears.
 *
 * Usage:
 *   <LoadingGlobe v-if="!isReady" :label="loadingStage" @retry="retry" />
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { usePplrT } from '../composables/usePplrT.js'

const props = defineProps({
  label:       { type: String, default: '' },   // empty = the translated "Loading map"
  stuckAfterMs:{ type: Number, default: 30000 },
})
const emit = defineEmits(['retry'])
const t = usePplrT()

const stuck = ref(false)
let stuckTimer = null

function armStuckTimer() {
  if (stuckTimer) clearTimeout(stuckTimer)
  stuck.value = false
  stuckTimer = setTimeout(() => { stuck.value = true }, props.stuckAfterMs)
}

onMounted(armStuckTimer)
onBeforeUnmount(() => stuckTimer && clearTimeout(stuckTimer))
// Re-arm whenever the label changes — that's a sign the profile made progress.
watch(() => props.label, armStuckTimer)

function onRetry() {
  stuck.value = false
  armStuckTimer()
  emit('retry')
}
</script>

<template>
  <div class="lg-frame" role="status" aria-live="polite">
    <svg class="lg-globe" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="lg-grad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#92b195" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#3b463d" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill="url(#lg-grad)" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="#73A17F" stroke-width="2"/>
      <ellipse cx="32" cy="32" rx="26" ry="10" fill="none" stroke="#73A17F" stroke-width="1.4" opacity="0.7"/>
      <ellipse cx="32" cy="32" rx="14" ry="26" fill="none" stroke="#73A17F" stroke-width="1.4" opacity="0.7"/>
      <line x1="6" y1="32" x2="58" y2="32" stroke="#73A17F" stroke-width="1.2" opacity="0.45"/>
      <line x1="32" y1="6" x2="32" y2="58" stroke="#73A17F" stroke-width="1.2" opacity="0.45"/>
    </svg>
    <span class="lg-text">{{ label || t('pplr.ui.loadingMap') }}</span>
    <button v-if="stuck" class="lg-retry" type="button" @click="onRetry">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-3-6.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <polyline points="21 4 21 11 14 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      {{ t('pplr.ui.retry') }}
    </button>
  </div>
</template>

<style scoped>
.lg-frame {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px;
  background: #0f1216;
  z-index: 1;
}
.lg-globe {
  width: 64px; height: 64px;
  animation: lg-spin 1.6s linear infinite;
  filter: drop-shadow(0 4px 14px rgba(115,161,127,0.35));
}
@keyframes lg-spin { to { transform: rotate(360deg); } }
.lg-text {
  color: #73A17F; opacity: 0.85;
  font: 600 12px ui-monospace, monospace;
  letter-spacing: 0.08em; text-transform: uppercase;
}
.lg-retry {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 6px; padding: 6px 12px;
  background: #161b22; color: #c9d1d9;
  border: 1px solid #73A17F; border-radius: 999px;
  font: 600 11px system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.lg-retry:hover { background: #73A17F; color: #0d1117; }
</style>
