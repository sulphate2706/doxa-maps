<script setup>
import { dataUrl } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'
/**
 * pplr-d3-tree.vue — ROP People-Affinity-Cluster sunburst.
 *
 * Capped at depth-2 (Affinity Bloc + Cluster) instead
 * of including the 13k+ People Group leaves at depth 3. SVG sunbursts top
 * out around 1k arcs before scroll-zoom gets unresponsive; depth 2 is ~309
 * arcs, which keeps wheel-zoom snappy. The PG-level data is still surfaced
 * elsewhere (ROP Tree map + Semantic Trees explorer).
 *
 * Uses the shared SemanticSunburst component (same render path as future
 * sunbursts; the prior bespoke implementation in this file was rewritten on
 * 2026-05-02 to use SemanticSunburst's wheel-zoom + drag-pan + perf-tuned
 * label visibility).
 */
import { onMounted, ref } from 'vue'
import SemanticSunburst from '../components/SemanticSunburst.vue'
import LoadingGlobe from '../components/LoadingGlobe.vue'

const tree = ref(null)
const t = usePplrT()
const status = ref(t('pplr.status.loadingRop'))
const showSettings = ref(false)
function reload() { window.location.reload() }

const BLOC_COLORS = {
  A001: '#f59e0b', A017: '#94a3b8', A002: '#ef4444', A003: '#8b5cf6',
  A019: '#06b6d4', A004: '#f97316', A006: '#3b82f6', A007: '#10b981',
  A008: '#14b8a6', A009: '#6366f1', A010: '#22c55e', A005: '#ec4899',
  A012: '#a78bfa', A011: '#84cc16', A013: '#fb923c', A018: '#e11d48',
  A015: '#0ea5e9',
}

const DATA_SOURCES = [
  { label: 'ROP hierarchy', url: 'rop-tree.json',
    fields: ['code', 'name', 'clusters[].code', 'clusters[].name', 'clusters[].groups[].entries[]'] },
]

onMounted(async () => {
  try {
    const resp = await fetch(dataUrl('rop-tree.json'))
    const flat = await resp.json()
    // d3.hierarchy shape — leaves carry the value (PG count) so cluster arcs
    // get sized correctly even though the leaves themselves aren't drawn at
    // maxDepth=2.
    tree.value = {
      name: 'PPLR', code: 'root',
      children: flat.map(bloc => ({
        name: bloc.name, code: bloc.code,
        children: bloc.clusters.map(cl => ({
          name: cl.name, code: cl.code,
          children: cl.groups.map(g => ({ name: g.name, code: g.code, value: g.entries.length })),
        })),
      })),
    }
    const total = flat.reduce((a, b) => a + b.clusters.reduce((c, d) => c + d.groups.reduce((e, f) => e + f.entries.length, 0), 0), 0)
    status.value = t('pplr.status.readyD3', { entries: total.toLocaleString() })
  } catch (e) {
    status.value = t('pplr.status.error', { message: e.message })
  }
})
</script>

<template>
  <div class="profile">
    <LoadingGlobe v-if="!tree" :label="t('pplr.status.loadingRop')" @retry="reload" />
    <template v-else>
      <SemanticSunburst
        :tree="tree"
        :color-map="BLOC_COLORS"
        center-label="PPLR"
        :depth-labels="['','Affinity Bloc','People Cluster','PG (not rendered)']"
        :max-depth="2"
      />
      <div class="header-pill">{{ t('pplr.pill.sunburst') }}</div>
      <div class="status">{{ status }}</div>
      <div class="map-toolbar">
        <div class="settings-wrap">
          <button class="toolbar-btn round" :title="t('pplr.ui.dataSources')" @click="showSettings = !showSettings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
              <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.6A7 7 0 0 0 7.5 6.8l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2.1 1.2L10 21h4l.4-2.6a7 7 0 0 0 2.1-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            </svg>
          </button>
          <div v-if="showSettings" class="settings-panel">
            <div class="settings-header">{{ t('pplr.ui.dataSources') }}</div>
            <div v-for="src in DATA_SOURCES" :key="src.url" class="settings-src">
              <div class="settings-src-label">{{ src.label }}</div>
              <div class="settings-src-url">{{ src.url }}</div>
              <div class="settings-fields">
                <span v-for="f in src.fields" :key="f" class="settings-field">{{ f }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.profile {
  width: 100%; height: 100%; position: relative;
  background: #0d1117; color: #c9d1d9;
  font-family: system-ui, -apple-system, sans-serif;
}
.header-pill {
  position: absolute; top: 12px; left: 12px;
  background: rgba(13,17,23,0.92); color: #c9d1d9; border: 1px solid #30363d;
  font: 11px system-ui; padding: 6px 12px; border-radius: 999px; z-index: 2;
}
.status {
  position: absolute; bottom: 12px; left: 12px;
  background: rgba(13,17,23,0.92); color: #86efac; border: 1px solid #30363d;
  font: 11px ui-monospace, monospace; padding: 6px 12px; border-radius: 4px; z-index: 2;
}
.map-toolbar {
  position: absolute; top: 12px; right: 12px; z-index: 5;
  display: flex; flex-direction: column; gap: 4px;
}
.toolbar-btn.round {
  width: 36px; height: 36px; padding: 0;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: #161b22; color: #8b949e;
  border: 1px solid #30363d; cursor: pointer;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
}
.toolbar-btn.round:hover { background: #1c2333; color: #c9d1d9; border-color: #73A17F; }
.settings-wrap { position: relative; }
.settings-panel {
  position: absolute; top: calc(100% + 4px); right: 0;
  background: rgba(13,17,23,0.97); color: #c9d1d9;
  border: 1px solid #30363d; border-radius: 8px;
  font: 12px system-ui; padding: 12px 16px;
  min-width: 280px; max-width: 380px; z-index: 10;
}
.settings-header {
  font: 600 11px ui-monospace, monospace; color: #c9d1d9;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0 4px 8px; margin-bottom: 6px;
  border-bottom: 1px solid #21262d;
}
.settings-src { margin-bottom: 8px; }
.settings-src-label {
  font: 600 9px ui-monospace, monospace; color: #73A17F;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;
}
.settings-src-url {
  font: 10px ui-monospace, monospace; color: #6e7681; word-break: break-all;
  background: #161b22; border: 1px solid #21262d; border-radius: 3px;
  padding: 3px 5px; margin-bottom: 3px;
}
.settings-fields { display: flex; flex-wrap: wrap; gap: 2px; }
.settings-field {
  font: 10px ui-monospace, monospace; background: #21262d;
  color: #c9d1d9; border-radius: 3px; padding: 1px 4px;
}
</style>
