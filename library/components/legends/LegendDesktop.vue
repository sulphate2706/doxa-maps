<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, inject, toRef } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it. The English stays as the fallback.
const T = (key, en) => tStatic(key) || en
import { useI18n } from 'vue-i18n'
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { useLegendData } from '../../composables/legends/useLegendData.js'
import { retryableAsyncComponent } from '../../composables/retryableAsyncComponent.js'
import LegendRows from './LegendRows.vue'
import PeopleGroupDetail from '../PeopleGroupDetail.vue'
import ApproxPinNote from './ApproxPinNote.vue'
import LegendCollapseCaret from './LegendCollapseCaret.vue'
import { buildColocationIndex, colocatedWith } from '../../utils/colocation.js'
// Async-import the heavier branches so the boot bundle stays lean.
const LegendMobile = retryableAsyncComponent(() => import('./LegendMobile.vue'))
// Language-family tab is now handled by <SemanticTreeLegend> mounted directly
// in research-map.vue as a standalone sibling (PPLR's panel chrome owns its
// positioning + collapse-to-pill). LegendDesktop only renders the other tabs
// (Prayer / Engagement / Adoption / Doxa Regions) via LegendRows.
import { RESEARCH_LEGEND_OPTIONS } from '../../composables/legends/researchLegendOptions.js'

const { t } = useI18n()

useShadowStyles(`
/* ── Container — the card.
   The LegendRows grid owns left/right padding via its caret + trailing
   columns. The card itself only adds top/bottom breathing space via
   .legend-content, and clips rounded corners via overflow:hidden. ── */
/* Transition: only the dimensions that actually change between expanded
   and collapsed. Using 'all' would also animate top/left/position and cause
   layout thrash on state flips. Emphasized-decelerate curve mirrors
   Material Design 3 snap-open, settle-closed feel. */
/* top/left/width aligned to SemanticTreeLegend's .stl-panel (top:60px,
   left:8px, width:380px) so the LegendDesktop card and the SemanticTreeLegend
   sit at exactly the same position+size — no visible jump when the user
   clicks a pin and the detail panel swaps in over the language-family legend
   The cap is the MAP's height (100%), never the window's (100vh): a window-height cap followed a phone's URL bar.
   */
.legend-container{position:absolute;top:60px;inset-inline-start:8px;width:var(--map-legend-width,380px);max-height:calc(100% - 80px);background:#fff;border-radius:var(--map-radius,16px);box-shadow:0 2px 8px rgba(0,0,0,0.12),0 1px 3px rgba(0,0,0,0.08);z-index:1000;overflow:hidden;display:flex;flex-direction:column;transition:width 200ms cubic-bezier(0.2,0,0,1),max-height 200ms cubic-bezier(0.2,0,0,1),min-width 200ms cubic-bezier(0.2,0,0,1),border-radius 200ms linear,box-shadow 200ms linear;will-change:width,max-height;}
/* ── DESKTOP TYPE SCALE for the LegendRows-based card (2026-09-16: larger, more
   readable desktop legends). The semantic-tree panel's scale lives in SemanticTreeLegend.vue
   (it renders without this card on some maps). Size only, never layout. ── */
.legend-container .lrg-title{font-size:15px;}
.legend-container .lrg-header-col{font-size:11px;}
.legend-container .lrg-name{font-size:15px;}
.legend-container .lrg-badge-inner{font-size:12px;}

/* Collapsed: pill imitates SemanticTreeLegend's .stl-reopen —
   rounded pill (999px radius), dark background, subtle border,
   floating shadow, uppercase monospace font. Hover lifts + glows.
   Name track auto-sizes to fit title text. */
/* ── Reopen pill (collapsed state) — mirrors STL .stl-reopen ── */
.legend-reopen{position:absolute;inset-inline-start:8px;top:60px;z-index:1000;display:inline-flex;align-items:center;gap:8px;background:#0d1117;border:1px solid #30363d;border-radius:999px;color:#c9d1d9;cursor:pointer;height:36px;padding:0 14px 0 12px;box-shadow:0 4px 14px rgba(0,0,0,0.25);font:600 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:0.06em;max-width:320px;transition:color 0.12s,background 0.12s,border-color 0.12s,transform 0.12s,box-shadow 0.12s;}
.legend-reopen:hover{color:#fff;background:#1c2333;border-color:#73A17F;box-shadow:0 6px 20px rgba(59,70,61,0.25);transform:translateY(-1px);}
.legend-reopen-icon{color:#73A17F;flex-shrink:0;}
.legend-reopen-label{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:none;letter-spacing:0;font:600 12px system-ui,sans-serif;}
.legend-reopen-caret{color:#6e7681;flex-shrink:0;}
.legend-reopen:hover .legend-reopen-caret{color:#c9d1d9;}
.legend-reopen-light{background:#ffffff;border-color:#d0d7de;color:#1f2328;box-shadow:0 4px 16px rgba(31,35,40,0.18);}
.legend-reopen-light:hover{background:#f6f8fa;border-color:#3b463d;color:#3b463d;box-shadow:0 6px 20px rgba(59,70,61,0.2);}
.legend-reopen-light .legend-reopen-icon{color:#3b463d;}
.legend-reopen-light .legend-reopen-caret{color:#57606a;}
/* Collapsed pill light mode — mirrors STL's .stl-reopen[data-theme="light"] */

/* Card-level collapse caret — rendered into the #title-caret slot of
   LegendRows. Matches SemanticTreeLegend's .stl-collapse-btn look:
   22x20px, rounded-rect, subtle dark bg + border, right-chevron SVG
   that rotates 180deg when expanded. */
/* Light mode caret — mirrors STL's [data-theme="light"] .stl-collapse-btn */
.legend-container:not(.legend-dark) .legend-collapse-caret{background:rgba(208,215,222,0.4);border-color:#d0d7de;color:#57606a;}
.legend-container:not(.legend-dark) .legend-collapse-caret:hover{background:rgba(59,70,61,0.12);border-color:#3b463d;color:#3b463d;}

/* Detail-mode close button — top-right of the card */
.detail-close-btn{position:absolute;top:10px;inset-inline-end:10px;background:none;border:none;padding:4px;cursor:pointer;color:#888;display:flex;align-items:center;justify-content:center;z-index:20;transition:color 0.2s ease;}
.detail-close-btn:hover{color:#333;}

/* Detail-mode collapse caret — top-left of the card, mirrors the inline
   .legend-collapse-caret used by the data-view title row. Sits at z-index
   above the PeopleGroupDetail sticky header (.detail-header z-index:10) so
   it is always tappable even when the detail panel scrolls. The button is
   only rendered in the detail-mode template branch (see <template> below). */
/* The detail-mode collapse control was an INVISIBLE 28x28 hit target (transparent fill, no
   border, transparent colour) sitting over the panel's own corner. Keeping it invisible is
   deliberate: making it suddenly visible is a look change nobody asked for. The slot keeps the
   position and the 28x28 target; the shared caret inside it supplies the semantics the old
   bare <button> lacked — aria-expanded, a direction-aware label, a focus ring. */
.detail-collapse-slot{position:absolute;top:10px;inset-inline-start:10px;z-index:20;width:28px;height:28px;display:flex;align-items:center;justify-content:center;}
.detail-collapse-slot .legend-collapse-caret{background:transparent;border-color:transparent;color:transparent;width:28px;height:28px;}
.detail-collapse-slot .legend-collapse-caret:focus-visible{outline:2px solid #73A17F;outline-offset:2px;}
/* Inside the detail panel: leave a 32px left gutter on the title text so the
   absolute-positioned .detail-collapse-btn at top:10px/left:10px does not
   overlap the people-group name. Targets the .pg-name-lead inside any
   .people-group-detail (which itself is rendered as a child of
   .legend-content). Right gutter clears the .detail-close-btn the same way. */
.legend-container .people-group-detail .pg-name-lead{padding-inline-start:28px;padding-inline-end:32px;}

/* ── Content — no padding; left/right AND top/bottom are handled by the
   LegendRows grid (caret + trailing columns + .lrg-items padding 12px 0).
   Double-padding here would push the collapsed title row out of the
   collapsed card. Title row stays visible when collapsed; data rows +
   controls are hidden via .collapsed state below. ── */
.legend-content{padding:0;overflow-y:auto;overflow-x:hidden;flex:1;max-height:650px;display:flex;flex-direction:column;min-height:0;}
.legend-content.no-padding{padding:0;}

/* When collapsed, hide everything EXCEPT the title inside LegendRows.
   The title row stays visible; column labels (UPGS/POPULATION) are hidden
   so the collapsed state shows only "Legend" — feedback 2026-04-21. */
/* Tab-4 lang-fam tree height parity with tabs 1-3 (qa.md R6 + R8 A2).
   Clamp to the same 36px pill when collapsed, hide column headers like
   LegendRows does, AND disable position:sticky on the title row — sticky
   creates its own stacking context that breaks the parent .legend-container's
   border-radius clip, leaving the collapsed pill with a sharp-cut right edge. */

/* SemanticTreeLegend (PPLR-ported) collapse parity — preserve the rounded-pill
   collapse-to-circle aesthetic from before. Hide everything below the titlebar
   so only the title (containing our caret + "Legend"/breadcrumb) shows.
   The .stl-inner border + box-shadow is also removed in collapsed state so the
   inner doesn't double up on the .legend-container's pill chrome. */
.legend-section-label{padding:8px 12px 4px;font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;}
.legend-dark .legend-section-label{color:rgba(243,243,241,0.55);}

/* Desktop slim rows — scoped to .legend-container so mobile (.legend-mobile-sheet)
   keeps its 44px tap targets. Original desktop rows were 36px tall with 6px
   pill padding — too clunky in QA review (2026-04-27). */
.legend-container .lrg-row,
.legend-container .lft-row{min-height:24px;}
.legend-container .lrg-item-inner,
.legend-container .lft-item-inner{min-height:24px;padding:2px 0;}

/* ── Items ── */
.legend-items-container{display:flex;flex-direction:column;gap:4px;}
.legend-item{padding:6px 10px;border-radius:4px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--map-font-md,13px);transition:all 0.2s;}
.legend-item-clickable{cursor:pointer;}
.legend-item-clickable:hover{transform:translateX(4px);box-shadow:0 2px 4px rgba(0,0,0,0.1);}
.legend-item-selected{outline:2px solid #333;outline-offset:2px;}
.legend-item-text{flex:1;font-weight:500;color:#333;}
.legend-item-count{font-size:var(--map-font-sm,11px);color:#555;background:rgba(0,0,0,0.08);padding:2px 7px;border-radius:10px;min-width:40px;text-align:end;margin-inline-end:4px;}
.legend-item-population{font-size:var(--map-font-sm,11px);color:#555;background:rgba(0,0,0,0.08);padding:2px 7px;border-radius:10px;min-width:52px;text-align:end;margin-inline-end:4px;}
.legend-export-btn{background:none;border:none;cursor:pointer;font-size:15px;padding:0 4px;}
.legend-tree-item{display:flex;flex-direction:column;gap:4px;}
.legend-tree-parent{display:flex;align-items:center;gap:6px;}
.legend-tree-caret{width:16px;height:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform 0.2s;font-size:12px;color:#666;}
.legend-tree-caret.expanded{transform:rotate(90deg);}
.legend-tree-child{margin-inline-start:20px;display:flex;gap:6px;}
.legend-tree-caret-placeholder{width:16px;}
.legend-item-child{font-size:12px;}

/* ── Stats header ── */
.legend-stats-header{display:flex;align-items:center;padding:4px 0;background:#fff;border-bottom:1px solid rgba(0,0,0,0.07);font-weight:600;font-size:10px;color:#777;text-transform:uppercase;letter-spacing:0.4px;position:sticky;top:0;z-index:10;}
.legend-stats-label{flex:1;min-width:0;padding:0 10px;}
/* Stats column values — 10px right padding aligns with header's last-of-type gap
   and gives a clean breathing space against the card's right edge. */
.legend-stats-value{width:58px;text-align:end;flex-shrink:0;font-family:'Courier New',monospace;padding-inline-end:10px;white-space:pre;}
.legend-footer{display:flex;align-items:center;padding:5px 0;border-top:1px solid rgba(0,0,0,0.07);font-size:11px;font-weight:600;color:#555;background:#fff;}
.legend-footer-label{flex:1;padding-inline-start:10px;color:#777;}
.legend-footer-value{width:56px;text-align:end;padding-inline-end:10px;font-family:'Courier New',monospace;}

/* ── Scrollbar ── */
.legend-content::-webkit-scrollbar{width:4px;}
.legend-content::-webkit-scrollbar-track{background:transparent;}
.legend-content::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.18);border-radius:4px;}
.legend-content::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.3);}

/* ── Dark mode ── */
.legend-dark{background:#3b463d!important;border:1px solid rgba(255,255,255,0.10)!important;box-shadow:0 4px 16px rgba(0,0,0,0.5)!important;}
.legend-dark .legend-content{background:#3b463d;}
/* Dark mode caret already matches STL defaults (dark bg + light text).
   Override only the hover glow to use the kingdom green accent. */
.legend-dark .legend-collapse-caret{background:rgba(110,118,129,0.15);border-color:#30363d;color:#8b949e;}
.legend-dark .legend-collapse-caret:hover{color:#c9d1d9;background:rgba(59,70,61,0.18);border-color:#73A17F;}
.legend-dark .detail-close-btn{color:rgba(243,243,241,0.75)!important;}
.legend-dark .detail-close-btn:hover{color:#F3F3F1!important;}
.legend-dark .legend-stats-header{background:#2a332a!important;color:rgba(243,243,241,0.65)!important;border-bottom-color:rgba(255,255,255,0.1)!important;}
.legend-dark .legend-footer{background:#2a332a!important;border-top-color:rgba(255,255,255,0.1)!important;color:rgba(243,243,241,0.75)!important;}
.legend-dark .legend-footer-label{color:rgba(243,243,241,0.65)!important;}
.legend-dark .legend-item-text{color:#F3F3F1!important;}
.legend-dark .legend-item-count{background:rgba(255,255,255,0.12)!important;color:rgba(243,243,241,0.9)!important;}
.legend-dark .legend-item-population{background:rgba(255,255,255,0.12)!important;color:rgba(243,243,241,0.9)!important;}
.legend-dark .legend-item-selected{outline-color:rgba(255,255,255,0.5)!important;}
.legend-dark .legend-tree-caret{color:rgba(243,243,241,0.7)!important;}
.legend-dark .legend-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);}

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .legend-container, .legend-reopen, .legend-collapse-caret, .legend-collapse-caret svg { transition: none !important; animation: none !important; }
}
`, 'legend-component')

const props = defineProps({
  legendType: {
    type: String,
    required: true
  },
  initiallyCollapsed: {
    type: Boolean,
    default: false
  },
  isDark: {
    type: Boolean,
    default: false
  },
  /**
   * Primary action button rendered in the pin-detail popup.
   * 'pray'  → "Pray for them" → pray.doxa.life/<slug>?source=doxalife&utm_source=<utmSource|agwm>
   * 'adopt' → "Adopt"          → /adopt/<slug>/?source=doxalife on current origin
   */
  popupAction: {
    type: String,
    default: 'pray',
    validator: (v) => ['pray', 'adopt', 'none'].includes(v)
  },
  /**
   * Disable collapse/expand caret for single-tier legends.
   * When true, hides the caret UI but keeps underlying functionality intact.
   */
  disableCollapse: {
    type: Boolean,
    default: false
  }
})

// Initialize Pinia stores — injected from ProfileLoader (instance-scoped)
const mapStore = inject('mapStore')
const dataStore = inject('dataStore')
const uiStore = inject('uiStore')

// ── Data-driven legend (universal for all legend types) ─────────────────────
const legendTypeRef = toRef(props, 'legendType')
const {
  items: legendDataItems, columns: legendColumns, title: legendDataTitle,
  activeFilter, setFilter, totalCount, totalPopulation,
  progress: legendProgress,   // prayer-only header bar payload (null otherwise)
  fmtPop, fmtCount
} = useLegendData(legendTypeRef, RESEARCH_LEGEND_OPTIONS)

// LegendFamilyTree consumes the raw normalized people-groups (not pre-aggregated).
// research-map.vue provides the array via inject('normalizedPeopleGroups').
const normalizedPeopleGroupsRef = inject('normalizedPeopleGroups', null)
const peopleGroupsForFamilyTree = computed(() => {
  if (normalizedPeopleGroupsRef?.value?.length) return normalizedPeopleGroupsRef.value
  const out = []
  for (const id in dataStore.sources) {
    const src = dataStore.sources[id]
    if (src?.features?.length) out.push(...src.features)
  }
  return out
})

// (SemanticTreeLegend tree adapter moved up to research-map.vue — it mounts
// the legend as a standalone sibling for the language-family tab.)

// Instance ID — injected from doxa-simple-map (provided per <doxa-map> instance)
// Used to scope window events so multiple maps on the same page don't interfere
const mapId = inject('mapId', null)

// Platform detection
const isMobile = computed(() => uiStore.isMobile)

// Legend mode (prayer progress ↔ people group detail)
const legendMode = computed(() => uiStore.legendMode)
const selectedPeopleGroup = computed(() => uiStore.selectedPeopleGroup)
// APPROXPIN: the other groups on the selected pin's coordinate, from the roster THIS map draws.
const colocation = computed(() => buildColocationIndex(peopleGroupsForFamilyTree.value))
const selectedShared = computed(() => (selectedPeopleGroup.value ? colocatedWith(colocation.value, selectedPeopleGroup.value) : []))

// Reactive data
const isCollapsed = ref(props.initiallyCollapsed)

// Refs for DOM elements
const legendItemsContainer = ref(null)

// Named handler for window event — must be stored to allow removeEventListener
let _onOpenDesktopLegend = null

// NOTE: auto-fly + cluster state and the .legend-controls toolbar moved to
// LegendTools.vue (mounted as a sibling in research-map.vue) per UX 2026-04-27.
// The legend card no longer owns showSpeedSelector / showClusterSettings /
// autoFlyIndex / autoFlyTimer / flySpeed / showClusters / clusterMode.
const developerMode = computed(() => mapStore.developerMode)

// Legend title — implements header title swap based on legend state and selection
// (G) When legend is COLLAPSED → display "Legend"
// (G) When legend is OPEN → display the map's configured title prop (e.g. "Engagement Progress")
// (H) When a people group is selected → display ONLY the people group name
// (H) When nothing is selected → revert to map title or "Legend" if collapsed
const legendTitle = computed(() => {
  // (H) When a people group is selected in detail mode
  if (legendMode.value === 'detail' && selectedPeopleGroup.value) {
    return selectedPeopleGroup.value.properties?.name || t('legend.header.peopleGroupFallback')
  }

  // (G) When legend is COLLAPSED → show "Legend"
  if (isCollapsed.value) {
    return t('legend.header.collapsed')
  }

  // (G) When legend is OPEN → show the legend data title (e.g., "Prayer Progress", "Engagement Progress")
  return legendDataTitle.value
})

// NOTE: speedLabel / flyInterval / showAutoFlyButton predicate moved to
// LegendTools.vue along with the toolbar UI.

// Toggle legend collapse — always honors the user gesture, including while a
// people-group is selected (detail mode). The collapse caret + reopen pill
// are the only intentional collapse affordances; the detail-close-btn (X)
// clears the selection separately and never triggers a collapse.
function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

// Auto-expand only on the FIRST transition into detail mode so the user sees
// what they just picked. Tracking the previous mode lets the user manually
// collapse afterwards (and have that stick) — legendMode does not change
// again until selection is cleared, so this watcher will not refire and
// stomp on the user's choice.
watch(legendMode, (mode, prevMode) => {
  if (mode === 'detail' && prevMode !== 'detail' && isCollapsed.value) {
    isCollapsed.value = false
  }
})

// Handle row click from LegendRowGroup
function handleRowFilterClick(filterKey) {
  setFilter(filterKey)
}

// Export selection
function exportSelection(item, event) {
  event.stopPropagation()
  // TODO: Implement export functionality
}

// NOTE: All auto-fly + cluster handlers (toggleAutoFly / startAutoFly /
// stopAutoFly / scheduleNextFly / flyToCurrentItem / setSpeed /
// toggleSpeedSelector / setClusterMode / toggleClusters) moved to
// LegendTools.vue. The card no longer drives the tour cadence.

// Lifecycle hooks
onMounted(() => {
  if (window.innerWidth < 768) {
    isCollapsed.value = true
  }
  // Auto-open desktop legend when a pin is clicked and legend is collapsed.
  // Only respond to events from OUR map instance (matched by mapId).
  // This prevents multiple <doxa-map> embeds on the same page from opening each other's legends.
  _onOpenDesktopLegend = (e) => {
    if (mapId && e.detail?.mapId && e.detail.mapId !== mapId) return
    isCollapsed.value = false
  }
  window.addEventListener('dxm:openDesktopLegend', _onOpenDesktopLegend)
})

onBeforeUnmount(() => {
  if (_onOpenDesktopLegend) {
    window.removeEventListener('dxm:openDesktopLegend', _onOpenDesktopLegend)
  }
})
</script>

<template>
  <!-- Mobile: Use bottom sheet legend -->
  <LegendMobile v-if="isMobile" :legendType="legendType" :popupAction="popupAction" :isDark="isDark" :disableCollapse="disableCollapse" />

  <!-- Desktop: ONE table, NO separate header bar.
       The legend title ("Prayer Progress" etc.) is rendered by LegendRows as
       the first row of the same grid as the data rows. The card-level
       collapse caret is injected into the LegendRows #title-caret slot so
       it lives in the grid's caret column (col 1) — aligned with the title
       row, and using the same padding track as all row-level carets.
       See documentation/legend-spec.md. -->
  <!-- Collapsed pill — identical to STL's .stl-reopen -->
  <button v-else-if="isCollapsed"
    :class="['legend-reopen', { 'legend-reopen-light': !isDark }]"
    :title="T('aria.expandLegend', 'Expand legend')"
    @click="isCollapsed = false">
    <svg class="legend-reopen-icon" width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M2 4h8M2 6h8M2 8h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
    <span class="legend-reopen-label">{{ legendDataTitle }}</span>
    <svg class="legend-reopen-caret" width="8" height="8" viewBox="0 0 12 12" fill="none">
      <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <!-- Expanded legend card -->
  <div v-else :class="['legend-container', { 'legend-dark': isDark }]">
    <!-- Detail-mode collapse caret — only rendered when a people-group is
         selected (LegendRows + its #title-caret slot are not on screen in
         this branch). Lives at top-left, mirroring the caret position in
         data-view, so collapse is always one tap away regardless of mode. -->
    <!-- The detail-mode collapse control, third copy of the same caret and carrying the same two
         gaps. Same shared control, positioned by .detail-collapse-slot. -->
    <span v-if="legendMode === 'detail'" class="detail-collapse-slot">
      <LegendCollapseCaret :open="!isCollapsed" :t="t" @toggle="toggleCollapse" />
    </span>
    <button
      v-if="legendMode === 'detail'"
      class="detail-close-btn"
      @click.stop="uiStore.selectPeopleGroup(null)"
      :aria-label="t('aria.backToLegend')"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>

    <div class="legend-content" :class="{ 'no-padding': legendColumns.length > 0 }">
      <template v-if="legendMode === 'detail' && selectedPeopleGroup">
        <PeopleGroupDetail
          :peopleGroup="selectedPeopleGroup"
          :hideHeader="true"
          :dark="isDark"
          :action="popupAction"
        />
        <ApproxPinNote :shared="selectedShared" :dark="isDark" />
      </template>
      <template v-else-if="legendType === 'language-family'"></template>
      <LegendRows
        v-else
        :title="legendTitle"
        :items="legendDataItems"
        :columns="legendColumns"
        :activeFilter="activeFilter"
        :isDark="isDark"
        :hideColumnHeader="false"
        :showFooter="false"
        :disableCollapse="true"
        :totalCount="totalCount"
        :totalPopulation="totalPopulation"
        :fmtPop="fmtPop"
        :fmtCount="fmtCount"
        :progress="legendProgress"
        @filter-click="handleRowFilterClick"
      >
        <template #title-caret>
          <!-- The caret is the shared control now: it carries aria-expanded and the RTL arrow,
               neither of which this copy had. State stays here; only the rendering moved. -->
          <LegendCollapseCaret :open="!isCollapsed" :t="t" @toggle="toggleCollapse" />
        </template>
      </LegendRows>
      <ApproxPinNote v-if="legendMode !== 'detail'" :dark="isDark" />
    </div>
  </div>

</template>

<style scoped>
/* All legend styles are injected via useShadowStyles above so they survive
   shadow-DOM isolation and don't collide with scoped data-v-* selectors.
   Do NOT re-declare .legend-container / .legend-content / .lrg-* here. */
</style>