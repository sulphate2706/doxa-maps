<script setup>
/**
 * FlatLegend — non-tree, single-tab companion to SemanticTreeLegend.
 *
 * For datasets with a flat color taxonomy (e.g. religion groups, country
 * clusters, simple binary states) — anything that doesn't need the tabbed
 * generation drill-down. Same chrome (rounded corners, dark/light theme,
 * collapse-to-chip under the search bar) as SemanticTreeLegend so the two
 * read as siblings, not separate widgets.
 *
 * Item shape:
 *   { key: string, label: string, color: string, count?: number, filter?: any }
 *
 * Selection emits `@select` with the item or null. The parent map is
 * responsible for `setFilter` — this component does not touch the map.
 *
 * Mediator store hookup: optional. If `usePplrInstance.useInstance()` returns
 * a store, FlatLegend reads `instance.theme.value` for [data-theme] styling
 * and writes selection back to `instance.selection.value`.
 */
import { ref, computed } from 'vue'
import { useInstance } from '@map/composables/usePplrInstance.js'
import { usePplrT } from '../composables/usePplrT.js'
import { tStatic } from '@map/i18n/index.js'

const props = defineProps({
  items:    { type: Array,  default: () => [] },
  title:    { type: String, default: 'Legend' },
  showCount:{ type: Boolean, default: true },
})

const emit = defineEmits(['select'])

const instance = useInstance()
const t = usePplrT()
const collapsed = ref(false)

const theme = computed(() => instance?.theme.value || 'dark')

const selectedKey = computed(() => {
  const sel = instance?.selection.value
  if (!sel) return null
  // Selection from this legend uses the item.key as its id; from the geocoder it
  // may use a 'rel:<key>' prefix. Tolerate both.
  if (typeof sel.id === 'string' && sel.id.startsWith('rel:')) return sel.id.slice(4)
  return sel.id || sel.key || null
})

function pick(item) {
  const isSame = selectedKey.value === item.key
  if (isSame) {
    if (instance) instance.selection.value = null
    emit('select', null)
    return
  }
  const node = {
    id:     `rel:${item.key}`,
    label:  item.label,
    color:  item.color,
    filter: item.filter,
    kind:   'religion',
  }
  if (instance) instance.selection.value = node
  emit('select', node)
}

function clearSel() {
  if (instance) instance.selection.value = null
  emit('select', null)
}
</script>

<template>
  <div class="fl-panel" :class="{ collapsed }" :data-theme="theme" v-show="!collapsed">
    <div class="fl-titlebar">
      <!-- The shared aria keys (11 locales); a shared key, so tStatic (t() would prefix it with pplr.). -->
      <button type="button" class="fl-collapse-btn" :title="tStatic('aria.collapseLegend')" :aria-label="tStatic('aria.collapseLegend')"
              @click="collapsed = true">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
          <polyline points="14,18 8,12 14,6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="fl-title">{{ title }}</div>
      <button v-if="selectedKey" class="fl-clear" :title="t('pplr.ui.clearSelectionEsc')" @click="clearSel">×</button>
    </div>
    <div class="fl-rows" :class="{ 'has-sel': !!selectedKey }">
      <button
        v-for="item in items"
        :key="item.key"
        class="fl-row"
        :class="{ selected: selectedKey === item.key }"
        :data-row-id="item.key"
        :style="{ '--row-color': item.color }"
        @click="pick(item)"
      >
        <span class="fl-dot" :style="{ background: item.color }" />
        <span class="fl-label">{{ item.label }}</span>
        <span v-if="showCount && item.count != null" class="fl-count">{{ item.count.toLocaleString() }}</span>
      </button>
    </div>
  </div>

  <button v-if="collapsed"
          class="fl-reopen"
          :data-theme="theme"
          :title="t('pplr.ui.openLegend')"
          @click="collapsed = false">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <polyline points="9,18 15,12 9,6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>{{ t('pplr.ui.legend') }}</span>
  </button>
</template>

<style scoped>
.fl-panel {
  position: absolute; top: 60px; left: 8px; width: 320px;
  background: rgba(13,17,23,0.96); color: #c9d1d9;
  border: 1px solid #30363d; border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  z-index: 4; font: 12px system-ui, sans-serif;
  max-height: calc(100% - 80px);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.fl-panel[data-theme="light"] {
  background: rgba(255,255,255,0.97); color: #1f2328;
  border-color: #d0d7de;
  box-shadow: 0 8px 24px rgba(31,35,40,0.18);
}

/* Title bar */
.fl-titlebar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #21262d;
}
.fl-panel[data-theme="light"] .fl-titlebar { border-bottom-color: #d8dee4; }
.fl-collapse-btn {
  background: transparent; border: none; cursor: pointer;
  color: #8b949e; padding: 2px 4px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  min-width: 24px; min-height: 24px;   /* a 24 px target (WCAG 2.5.8); it measured 19×15 */
}
.fl-collapse-btn:hover { color: #c9d1d9; background: rgba(115,161,127,0.12); }
.fl-panel[data-theme="light"] .fl-collapse-btn { color: #57606a; }
.fl-panel[data-theme="light"] .fl-collapse-btn:hover { color: #1f2328; background: #f6f8fa; }
.fl-title {
  flex: 1;
  font: 600 11px ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: #73A17F;
}
.fl-panel[data-theme="light"] .fl-title { color: #3b463d; }
.fl-clear {
  background: transparent; border: none; cursor: pointer;
  color: #8b949e; font-size: 16px; line-height: 1; padding: 2px 6px;
  border-radius: 4px;
}
.fl-clear:hover { background: #ef4444; color: #fff; }
.fl-panel[data-theme="light"] .fl-clear { color: #57606a; }

/* Rows */
.fl-rows { overflow-y: auto; padding: 4px; }
.fl-row {
  width: 100%;
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: transparent; border: none; cursor: pointer;
  color: inherit; text-align: left;
  font: 12px system-ui, sans-serif;
  border-radius: 6px;
  transition: opacity 0.12s, background 0.12s;
}
.fl-row:hover { background: rgba(115,161,127,0.08); }
.fl-panel[data-theme="light"] .fl-row:hover { background: #f6f8fa; }
.fl-rows.has-sel .fl-row { opacity: 0.3; }
.fl-rows.has-sel .fl-row.selected {
  opacity: 1;
  background: rgba(255,255,255,0.05);
  box-shadow:
    inset 3px 0 0 0 var(--row-color, #73A17F),
    inset 0 0 0 1px rgba(255,255,255,0.05);
}
.fl-panel[data-theme="light"] .fl-rows.has-sel .fl-row.selected {
  background: rgba(0,0,0,0.04);
  box-shadow:
    inset 3px 0 0 0 var(--row-color, #3b463d),
    inset 0 0 0 1px rgba(0,0,0,0.05);
}
.fl-dot { width: 11px; height: 11px; border-radius: 50%; }
.fl-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fl-count {
  font: 11px ui-monospace, monospace;
  color: #6e7681;
}
.fl-panel[data-theme="light"] .fl-count { color: #57606a; }

/* Collapsed chip — sibling of the panel, sits where the search-bar's bottom edge is */
.fl-reopen {
  position: absolute; top: 60px; left: 8px; z-index: 3;
  height: 36px; border-radius: 999px;
  background: rgba(13,17,23,0.96); color: #c9d1d9;
  border: 1px solid #30363d;
  padding: 0 14px 0 10px;
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  font: 600 11px ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.05em;
  box-shadow: 0 4px 14px rgba(0,0,0,0.35);
}
.fl-reopen[data-theme="light"] {
  background: rgba(255,255,255,0.97); color: #1f2328; border-color: #d0d7de;
  box-shadow: 0 4px 14px rgba(31,35,40,0.15);
}
.fl-reopen:hover { border-color: #73A17F; }
</style>
