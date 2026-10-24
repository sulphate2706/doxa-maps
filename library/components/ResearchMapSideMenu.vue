<script setup>
/**
 * ResearchMapSideMenu.vue — Side drawer specific to the research-map profile.
 *
 * Hosts:
 *   - Cluster mode toggle (off / mapbox / mst / network)
 *   - Pin-opacity dim slider (visible only when clustering is on)
 *   - Slot for the multi-field filter panel (parent passes <ResearchMapFilterPanel />)
 *   - Poster export button (emits 'open-poster' — parent opens PosterDialog)
 *   - Reload-data button
 *
 * Reads/writes mapStore.clusteringMode and mapStore.clusterPinOpacity.
 * Does NOT touch the map directly — the useMapClustering composable in the
 * profile subscribes to those store fields.
 *
 * Props:
 *   isOpen        — drawer visible flag (parent owns)
 * Emits:
 *   close         — backdrop or X clicked
 *   open-poster   — poster button clicked
 *   reload-map    — reload-data button clicked
 *
 * Slot (default): filter UI (kept as a slot so other profiles can pass their
 * own filter component without forking this drawer).
 */

import { inject, computed } from 'vue'
import { useShadowStyles } from '../composables/useShadowStyles.js'

defineProps({
  isOpen: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'open-poster', 'reload-map'])

import { tStatic } from '@map/i18n/index.js'
// ★ THIS PANEL WAS ENGLISH IN ALL ELEVEN LOCALES. Measured on the composite under ?lang=ru: every
// Latin-script string left on the page belonged to this menu and its filter sibling — the map
// around them was fully translated. Read through tStatic rather than useI18n: these components are
// reachable from mounts that install no i18n plugin, and an unguarded useI18n() throws and takes
// the subtree with it (the defect that blanked people-groups-grid, fixed in 6603dc17). English
// stays as the last argument, so a missing key degrades to today's text rather than to a key name.
const L = (key, en) => tStatic('controls.' + key) || tStatic('dashboard.' + key) || en

const mapStore = inject('mapStore')
const uiStore  = inject('uiStore')

// ─── Cluster controls ────────────────────────────────────────────────────────
const CLUSTER_MODES = [
  { id: 'off',     label: L('off', 'Off'),         desc: L('off_desc', 'Show every pin individually')          },
  { id: 'mapbox',  label: L('native', 'Native'),   desc: L('native_desc', 'Mapbox circle clusters (fastest)')  },
  { id: 'mst',     label: L('mst', 'MST'),         desc: L('mst_desc', 'Minimum-spanning-tree affinity webs')  },
  { id: 'network', label: L('network', 'Network'), desc: L('network_desc', 'Nearest-neighbor connection lines') }
]
const clusterMode = computed({
  get: () => mapStore?.clusteringMode ?? 'off',
  set: (v) => { if (mapStore) mapStore.clusteringMode = v }
})
const pinOpacity = computed({
  get: () => mapStore?.clusterPinOpacity ?? 0.6,
  set: (v) => { if (mapStore) mapStore.clusterPinOpacity = Number(v) }
})

useShadowStyles(`
  .rm-side-backdrop { position:absolute;inset:0;background:rgba(0,0,0,0.45);z-index:1500;opacity:0;pointer-events:none;transition:opacity .18s; }
  .rm-side-backdrop.open { opacity:1;pointer-events:auto; }
  /* box-shadow lives on .open ONLY: when closed the drawer is translateX(100%) off
     the right edge, but a left-pointing shadow (-4px) bled back onto the map's right
     edge — the mystery "shadow on the right side". */
  .rm-side-drawer { position:absolute;top:0;right:0;bottom:0;width:340px;max-width:100vw;background:#171c23;color:#e7ebf0;border-left:1px solid #232a33;z-index:1600;transform:translateX(100%);transition:transform .22s ease;display:flex;flex-direction:column;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .rm-side-drawer.open { transform:translateX(0); box-shadow:-4px 0 16px rgba(0,0,0,0.4); }
  .rm-side-header { display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #232a33;flex:0 0 auto; }
  .rm-side-title { font-size:14px;font-weight:600;color:#e7ebf0;margin:0; }
  .rm-side-close { background:none;border:none;color:#a8b2bd;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:4px; }
  .rm-side-close:hover { color:#e7ebf0;background:rgba(255,255,255,0.06); }
  .rm-side-body { flex:1 1 auto;overflow-y:auto;padding:14px 18px; }
  .rm-section { margin-bottom:22px; }
  .rm-section h4 { margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#a8b2bd; }
  .rm-cluster-grid { display:grid;grid-template-columns:1fr 1fr;gap:6px; }
  .rm-cluster-btn { background:#232a33;border:1px solid #2c343f;color:#e7ebf0;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:12px;text-align:left;line-height:1.3; }
  .rm-cluster-btn:hover { background:#2c343f;border-color:#3a4250; }
  .rm-cluster-btn.active { background:rgba(124,140,248,0.16);border-color:#7c8cf8;color:#a8b8ff; }
  .rm-cluster-btn .label { display:block;font-weight:600;font-size:12px;margin-bottom:2px; }
  .rm-cluster-btn .desc  { display:block;font-size:10.5px;color:#a8b2bd; }
  .rm-slider-row { display:flex;align-items:center;gap:10px;margin-top:8px; }
  .rm-slider-row input[type=range] { flex:1; }
  .rm-slider-row .val { width:36px;text-align:right;font-variant-numeric:tabular-nums;color:#a8b2bd;font-size:11px; }
  .rm-side-footer { flex:0 0 auto;padding:12px 18px;border-top:1px solid #232a33;display:flex;flex-direction:column;gap:8px; }
  .rm-btn { display:flex;align-items:center;justify-content:center;gap:8px;background:#7c8cf8;border:none;color:#0f1216;padding:10px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600; }
  .rm-btn:hover { background:#9aa6ff; }
  .rm-btn.ghost { background:transparent;color:#a8b2bd;border:1px solid #2c343f; }
  .rm-btn.ghost:hover { background:#232a33;color:#e7ebf0; }

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .rmsm-root, .rmsm-item { transition: none !important; animation: none !important; }
}
`, 'research-map-side-menu')
</script>

<template>
  <div class="rm-side-backdrop" :class="{ open: isOpen }" @click="emit('close')" />
  <aside class="rm-side-drawer" :class="{ open: isOpen }" role="dialog" :aria-label="L('map_controls', 'Research map controls')">
    <header class="rm-side-header">
      <h3 class="rm-side-title">{{ L('research_controls', 'Research controls') }}</h3>
      <button class="rm-side-close" :aria-label="tStatic('buttons.close') || 'Close'" @click="emit('close')">×</button>
    </header>

    <div class="rm-side-body">
      <!-- Clustering ─────────────────────────────────────────────────── -->
      <div class="rm-section">
        <h4>{{ L('clustering', 'Clustering') }}</h4>
        <div class="rm-cluster-grid">
          <button
            v-for="m in CLUSTER_MODES"
            :key="m.id"
            class="rm-cluster-btn"
            :class="{ active: clusterMode === m.id }"
            @click="clusterMode = m.id"
          >
            <span class="label">{{ m.label }}</span>
            <span class="desc">{{ m.desc }}</span>
          </button>
        </div>
        <div v-if="clusterMode !== 'off'" class="rm-slider-row">
          <label for="rm-pin-op">{{ L('pin_dim', 'Pin dim') }}</label>
          <input
            id="rm-pin-op"
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            :value="pinOpacity"
            @input="pinOpacity = $event.target.value"
          />
          <span class="val">{{ Math.round(pinOpacity * 100) }}%</span>
        </div>
      </div>

      <!-- Filter panel slot ──────────────────────────────────────────── -->
      <div class="rm-section">
        <h4>{{ L('filters', 'Filters') }}</h4>
        <slot />
      </div>
    </div>

    <footer class="rm-side-footer">
      <button class="rm-btn" @click="emit('open-poster')">{{ L('export_poster', 'Export poster…') }}</button>
      <button class="rm-btn ghost" @click="emit('reload-map')">{{ L('reload_data', 'Reload data') }}</button>
    </footer>
  </aside>
</template>
