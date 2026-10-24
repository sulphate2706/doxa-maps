<script>
/**
 * Does the Fly + Clusters toolbar render for this legend type?
 * Single source of truth — see the note beside showAutoFlyButton.
 * @param {string} legendType
 * @returns {boolean}
 */
export function showsFlyTools(legendType) {
  return legendType === 'doxa-regions'
      || legendType === 'language-family'
      || legendType === 'language-families'
}
</script>
<script setup>
/**
 * LegendTools.vue — Fly + Clusters floating toolbar
 *
 * Decoupled sibling of LegendDesktop. Mounts ABOVE the legend card as a
 * pill-shaped, horizontally-centered floating toolbar (~10px above the card).
 *
 * Why a sibling (and not a child of LegendDesktop)?
 *   - Per UX 2026-04-27 the toolbar is NOT a legend component; the legend card's
 *     CSS (border-radius clip, .collapsed display:none rules, dark-mode container
 *     overrides) was fighting the toolbar styling. By mounting it as a peer of
 *     <LegendDesktop> in research-map.vue and giving it its own useShadowStyles
 *     namespace, none of those legend selectors reach this component.
 *
 * Inputs:
 *   - legendType: drives the showAutoFlyButton predicate (only doxa-regions
 *     and language-family[ies] tabs render this toolbar).
 *   - isDark: applied as the .lt-dark class so the pill picks up dark surfaces.
 *
 * State source: mapStore (injected). All flight + cluster state lives there.
 *
 * Emits:
 *   - 'legend-row-fly' — mirror of the cadence event LegendDesktop used to fire
 *     internally for each scheduled fly tick (kept for forward-compat; the
 *     parent profile listens through mapStore).
 */
import { ref, computed, inject, onBeforeUnmount, toRef } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it. The English stays as the fallback.
const T = (key, en) => tStatic(key) || en
import { useI18n } from 'vue-i18n'
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { useLegendData } from '../../composables/legends/useLegendData.js'
import { RESEARCH_LEGEND_OPTIONS } from '../../composables/legends/researchLegendOptions.js'
// .lt-overlay is a TRANSPARENT click-catcher, so a too-small one looks like nothing at all — but
// it still fails: inside the cap-5 shell contain:layout on .vtl-content clips it to the content
// pane (measured 1024x793 @ (256,107) at 1280x900), so clicking the rail or header does NOT
// dismiss the popup it is supposed to close. Same mechanism as the visible scrims.
import { useViewportScrim } from '../../utils/viewportScrim.js'

// Decoupled CSS — its own namespace ('legend-tools'), so none of the
// legend-component selectors apply here. The card CSS (.legend-container, the
// .collapsed display:none cascade, the .legend-dark overrides) cannot reach
// this component's classes because they all start with the .lt- prefix.
useShadowStyles(`
/* ── Floating-toolbar shell ──
   Pill-shaped wrapper, absolutely positioned ABOVE the legend card. Horizontally
   centered over the legend card by anchoring the left edge to the card origin
   (10px) + half the legend width, then translating back -50%. ── */
.lt-root{position:absolute;top:14px;inset-inline-start:calc(10px + var(--map-legend-width,340px) / 2);transform:translateX(-50%);z-index:1050;display:flex;gap:8px;align-items:center;flex-wrap:nowrap;background:transparent;pointer-events:auto;}
.lt-root:dir(rtl){transform:translateX(50%);}
@media(max-width:767px){
  /* Mobile uses the bottom-sheet legend; toolbar is hidden on phones. */
  .lt-root{display:none;}
}

/* ── Pill button group — same visual language as the previous in-card toolbar
   but with its own selectors so legend CSS can't bleed in. ── */
.lt-btn-group{position:relative;display:inline-flex;align-items:stretch;background:#fff;border:1px solid #e5e7eb;border-radius:9999px;overflow:visible;box-shadow:0 2px 8px rgba(0,0,0,0.12),0 1px 3px rgba(0,0,0,0.08);}
.lt-btn{display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:transparent;border:none;cursor:pointer;font-size:12px;font-weight:600;color:#374151;border-radius:9999px 0 0 9999px;transition:background 0.15s;}
.lt-btn:last-child{border-radius:0 9999px 9999px 0;}
.lt-btn:hover{background:rgba(59,130,246,0.08);}
.lt-btn.active{background:var(--dx-accent-weak, rgba(146,177,149,0.18));color:var(--dx-text, #3b463d);}
.lt-btn-icon{font-size:13px;line-height:1;}
.lt-btn-text{font-size:12px;line-height:1;}
.lt-side-btn{display:inline-flex;align-items:center;justify-content:center;padding:0 10px;background:transparent;border:none;border-left:1px solid #e5e7eb;cursor:pointer;color:#6b7280;border-radius:0 9999px 9999px 0;transition:background 0.15s;}
.lt-side-btn:hover{background:rgba(59,130,246,0.08);color:#374151;}
.lt-side-icon{font-size:13px;line-height:1;}
.lt-checkbox{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1.5px solid #9ca3af;border-radius:3px;background:#fff;transition:border-color 0.15s;}
.lt-checkbox.checked{border-color:#3498db;background:#fff;}

/* ── Dropdown popups (speed selector + cluster settings) ── */
.lt-popup{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.10);z-index:1100;min-width:160px;padding:4px 0;}
.lt-popup-row{display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:12px;color:#374151;cursor:pointer;transition:background 0.12s;}
.lt-popup-row:hover{background:rgba(59,130,246,0.08);}
.lt-popup-row.active{background:var(--dx-accent-weak, rgba(146,177,149,0.18));color:var(--dx-text, #3b463d);font-weight:600;}
.lt-popup-icon{font-size:13px;}
.lt-overlay{position:fixed;inset:0;z-index:1099;background:transparent;}

/* ── Dark mode (own namespace — no .legend-dark cross-talk) ── */
.lt-dark .lt-btn-group{background:#2a332a;border-color:rgba(255,255,255,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.4);}
.lt-dark .lt-btn{color:rgba(243,243,241,0.85);}
.lt-dark .lt-btn:hover{background:rgba(255,255,255,0.06);}
.lt-dark .lt-btn.active{background:rgba(124,140,248,0.18);color:#7c8cf8;}
.lt-dark .lt-side-btn{border-left-color:rgba(255,255,255,0.12);color:rgba(243,243,241,0.7);}
.lt-dark .lt-side-btn:hover{background:rgba(255,255,255,0.06);color:#F3F3F1;}
.lt-dark .lt-popup{background:#2a332a;border-color:rgba(255,255,255,0.12);}
.lt-dark .lt-popup-row{color:rgba(243,243,241,0.85);}
.lt-dark .lt-popup-row:hover{background:rgba(255,255,255,0.06);}
.lt-dark .lt-popup-row.active{background:rgba(124,140,248,0.18);color:#7c8cf8;}

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .legend-tools, .lt-btn, .lt-panel { transition: none !important; animation: none !important; }
}
`, 'legend-tools')

const props = defineProps({
  legendType: { type: String, required: true },
  isDark:     { type: Boolean, default: false }
})

const emit = defineEmits(['legend-row-fly'])

const { t } = useI18n()

// Stores from ProfileLoader (instance-scoped Pinia)
const mapStore = inject('mapStore')

// Legend data feeds the auto-fly tour cadence — same source LegendDesktop used
// to read internally before the toolbar moved out.
const legendTypeRef = toRef(props, 'legendType')
const { items: legendDataItems, setFilter } = useLegendData(legendTypeRef, RESEARCH_LEGEND_OPTIONS)

// Local UI state — popup visibility + auto-fly cursor.
const showSpeedSelector  = ref(false)
const showClusterSettings = ref(false)
const { scrimRef, scrimStyle } = useViewportScrim(showClusterSettings)
const autoFlyIndex = ref(0)
const autoFlyTimer = ref(null)

// Store-derived computeds for paint
const isAutoFlying        = computed(() => mapStore.isAutoFlying)
const isGuidedTourActive  = computed(() => mapStore.isGuidedTourActive)
const flySpeed            = computed(() => mapStore.flySpeed)
const showClusters        = computed(() => mapStore.showClusters)

// Predicate: only render the toolbar on tabs that need fly + clusters.
// EXPORTED because HOSTS need the same answer. This toolbar is absolutely positioned at top:14px,
// centred on the legend column — the SEARCH BAR's slot. When a host drops the search bar (the
// maplibre case) and raises its legend into the vacated space, the two land on the same pixels and
// the toolbar prints over the legend's header. MEASURED on country-posters: legend raised to 14,
// Fly/Clusters drawn across the "WAGF REGIONS" title.
// A host must therefore be able to ask "will the toolbar be there?" before deciding how far to
// raise. Re-typing this condition at each call site is how two copies of one rule drift apart, so
// the rule lives here, once, and showAutoFlyButton uses the same function.
const showAutoFlyButton = computed(() => showsFlyTools(props.legendType))

const speedLabel = computed(() => {
  const labels = { slow: t('buttons.speedOption.slow'), normal: t('buttons.speedOption.normal'), fast: t('buttons.speedOption.fast') }
  return labels[flySpeed.value] || t('buttons.speedOption.normal')
})

const flyInterval = computed(() => {
  const intervals = { slow: 8000, normal: 5000, fast: 3000 }
  return intervals[flySpeed.value] || 5000
})

// ── Speed controls ──────────────────────────────────────────────────────────
function toggleSpeedSelector() {
  showSpeedSelector.value = !showSpeedSelector.value
  if (showSpeedSelector.value) showClusterSettings.value = false
}
function setSpeed(speed) {
  mapStore.setFlySpeed(speed)
  setTimeout(() => { showSpeedSelector.value = false }, 300)
}

// ── Cluster controls ────────────────────────────────────────────────────────
function toggleClusters() { mapStore.toggleClusters() }
function setClusterMode(mode) {
  mapStore.setClusterMode(mode)
  setTimeout(() => { showClusterSettings.value = false }, 500)
}

// ── Auto-fly tour ───────────────────────────────────────────────────────────
function toggleAutoFly() {
  if (isAutoFlying.value) {
    stopAutoFly()
  } else {
    if (isGuidedTourActive.value) { /* stop guided tour when wired */ }
    startAutoFly()
  }
}
function startAutoFly() {
  if (legendDataItems.value.length === 0) return
  autoFlyIndex.value = 0
  mapStore.startAutoFly([])
  flyToCurrentItem()
  scheduleNextFly()
}
function stopAutoFly() {
  if (autoFlyTimer.value) { clearTimeout(autoFlyTimer.value); autoFlyTimer.value = null }
  mapStore.stopAutoFly()
}
function scheduleNextFly() {
  autoFlyTimer.value = setTimeout(() => {
    if (!isAutoFlying.value) return
    autoFlyIndex.value = (autoFlyIndex.value + 1) % legendDataItems.value.length
    flyToCurrentItem()
    scheduleNextFly()
  }, flyInterval.value)
}
function flyToCurrentItem() {
  const item = legendDataItems.value[autoFlyIndex.value]
  if (!item) return
  setFilter(item.filterKey)
  // Mirror the cadence event LegendDesktop used to fire internally so any
  // listener wired to LegendTools at the parent gets notified per tick.
  emit('legend-row-fly', { index: autoFlyIndex.value, filterKey: item.filterKey })
}

onBeforeUnmount(() => {
  if (autoFlyTimer.value) clearTimeout(autoFlyTimer.value)
})
</script>

<template>
  <div v-if="showAutoFlyButton" :class="['lt-root', { 'lt-dark': isDark }]">
    <!-- Auto Fly button group -->
    <div class="lt-btn-group">
      <button
        class="lt-btn"
        :class="{ active: isAutoFlying }"
        @click.stop="toggleAutoFly"
        :title="isAutoFlying ? t('buttons.stopFlight') : t('buttons.startAutoFly')"
      >
        <span class="lt-btn-icon">✈️</span>
        <span class="lt-btn-text">{{ isAutoFlying ? 'Stop' : 'Fly' }}</span>
      </button>
      <button
        class="lt-side-btn"
        @click.stop="toggleSpeedSelector"
        :title="t('buttons.speedLabel') + ' ' + speedLabel"
      >
        <span class="lt-side-icon">⏱️</span>
      </button>
      <div v-if="showSpeedSelector" class="lt-popup" @click.stop>
        <div class="lt-popup-row" :class="{ active: flySpeed === 'slow'   }" @click="setSpeed('slow')">{{ t('buttons.speedOption.slow') }}</div>
        <div class="lt-popup-row" :class="{ active: flySpeed === 'normal' }" @click="setSpeed('normal')">{{ t('buttons.speedOption.normal') }}</div>
        <div class="lt-popup-row" :class="{ active: flySpeed === 'fast'   }" @click="setSpeed('fast')">{{ t('buttons.speedOption.fast') }}</div>
      </div>
    </div>

    <!-- Clusters button group -->
    <div class="lt-btn-group">
      <button
        class="lt-btn"
        :class="{ active: showClusters }"
        @click.stop="toggleClusters"
        :title="t('buttons.showClusters')"
      >
        <span class="lt-checkbox" :class="{ checked: showClusters }">
          <svg v-if="showClusters" width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 6l3 3 5-6" stroke="#3498db" stroke-width="2" fill="none"/>
          </svg>
        </span>
        <span class="lt-btn-text">{{ T('controls.clusters', 'Clusters') }}</span>
      </button>
      <button
        class="lt-side-btn"
        @click.stop="showClusterSettings = !showClusterSettings"
        :title="t('buttons.clusterSettings')"
      >
        <span class="lt-side-icon">⚙️</span>
      </button>
      <div v-if="showClusterSettings" class="lt-popup" @click.stop>
        <div class="lt-popup-row active" @click="setClusterMode('mst')">
          <span class="lt-popup-icon">⌬</span>
          <span>{{ T('controls.mst_full_name', 'Minimum Spanning Tree') }}<br><small style="opacity:0.7;font-weight:400">{{ T('controls.mst_hint', 'click a legend row to cluster only that group') }}</small></span>
        </div>
      </div>
      <div v-if="showClusterSettings" ref="scrimRef" :style="scrimStyle" class="lt-overlay" @click.stop="showClusterSettings = false"></div>
    </div>
  </div>
</template>

<style scoped>
/* All styles injected via useShadowStyles (namespace 'legend-tools') above so
   they survive shadow-DOM isolation. Keep this block intentionally empty. */
</style>
