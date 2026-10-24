<script setup>
/**
 * DataSourcesDropdown — gear-icon button that opens a panel listing the
 * data sources powering the current map (URL + queried fields per source).
 *
 * Used by every map profile that exposes data-source provenance, factored
 * out 2026-05-02 to stop copy-pasting ~50 lines of toolbar+panel CSS per
 * profile. Each profile passes `:sources="DATA_SOURCES"` and slots this
 * component into its toolbar.
 */
import { ref } from 'vue'
import { usePplrT } from '../composables/usePplrT.js'

defineProps({
  /** Array of { label, url, fields[] } */
  sources: { type: Array, default: () => [] },
})

const open = ref(false)
const t = usePplrT()
function toggle() { open.value = !open.value }
</script>

<template>
  <div class="dsd-wrap">
    <button class="toolbar-btn round" type="button" :title="t('pplr.ui.dataSources')" @click="toggle">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.6A7 7 0 0 0 7.5 6.8l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2.1 1.2L10 21h4l.4-2.6a7 7 0 0 0 2.1-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
    </button>
    <div v-if="open" class="dsd-panel">
      <div class="dsd-header">{{ t('pplr.ui.dataSources') }}</div>
      <div v-for="src in sources" :key="src.url" class="dsd-src">
        <div class="dsd-src-label">{{ src.label }}</div>
        <div class="dsd-src-url">{{ src.url }}</div>
        <div v-if="src.fields?.length" class="dsd-fields">
          <span v-for="f in src.fields" :key="f" class="dsd-field">{{ f }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dsd-wrap { position: relative; }
.toolbar-btn.round {
  width: 36px; height: 36px; padding: 0;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: #161b22; color: #8b949e;
  border: 1px solid #30363d; cursor: pointer;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
}
.toolbar-btn.round:hover { background: #1c2333; color: #c9d1d9; border-color: #73A17F; }
.dsd-panel {
  position: absolute; top: calc(100% + 4px); right: 0;
  background: rgba(13,17,23,0.97); color: #c9d1d9;
  border: 1px solid #30363d; border-radius: 8px;
  font: 12px system-ui; padding: 12px 16px;
  min-width: 320px; max-width: 420px; max-height: 60vh; overflow-y: auto;
  z-index: 10;
}
.dsd-header {
  font: 600 11px ui-monospace, monospace; color: #c9d1d9;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0 4px 8px; margin-bottom: 6px;
  border-bottom: 1px solid #21262d;
}
.dsd-src { margin-bottom: 8px; }
.dsd-src:last-child { margin-bottom: 0; }
.dsd-src-label {
  font: 600 9px ui-monospace, monospace; color: #73A17F;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;
}
.dsd-src-url {
  font: 10px ui-monospace, monospace; color: #6e7681; word-break: break-all;
  background: #161b22; border: 1px solid #21262d; border-radius: 3px;
  padding: 3px 5px; margin-bottom: 3px;
}
.dsd-fields { display: flex; flex-wrap: wrap; gap: 2px; }
.dsd-field {
  font: 10px ui-monospace, monospace; background: #21262d;
  color: #c9d1d9; border-radius: 3px; padding: 1px 4px;
}
</style>
