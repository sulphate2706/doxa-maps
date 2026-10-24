<template>
  <div
    class="legend-row-group"
    :class="isDark ? 'lrg-dark' : 'lrg-light'"
  >
    <!-- ONE grid table. First column is an invisible caret column — it doubles
         as the card's left padding AND as the rendering column for every
         row-level caret (title caret via #title-caret slot, child-expand
         carets on tree rows). A matching trailing column on the right of
         the same width provides symmetric right padding without the card
         needing its own left/right padding. See documentation/legend-spec.md. -->
    <div class="lrg-items" :style="{ '--lrg-grid-cols': gridCols }" ref="itemsContainer">

      <!-- Title row — first row of the table. Caret slot in col 1, title in
           col 2, column headers auto-placed into remaining tracks. -->
      <div v-if="!hideColumnHeader && (title || columns.length)" class="lrg-title-row">
        <span class="lrg-title-caret-slot"><slot name="title-caret" /></span>
        <span class="lrg-title">{{ displayTitle }}</span>
        <span v-for="col in columns" :key="col.key" class="lrg-header-col">{{ col.label }}</span>
        <!-- Prayer progress bar — second line of the (sticky) header row, spanning
             the pill columns. Rendered only when a progress payload exists (prayer
             legend); the title above then reads "Progress". Clicking a span selects
             the matching row through the SAME filter-click the rows emit. -->
        <LegendProgressBar
          v-if="progressData"
          class="lrg-progress"
          :covered="progressData.covered"
          :total="progressData.total"
          :segments="progressData.segments"
          :is-dark="isDark"
          :fmt-count="fmtCount"
          @select-segment="key => $emit('filter-click', key)"
        />
      </div>

      <!-- Data rows — colored pills, clickable. The .lrg-item / .lrg-item-inner
           wrappers are present for LegendMobile.vue CSS compatibility; on
           desktop they are display:contents so the subgrid is flat. -->
      <template v-for="item in items" :key="item.key">
        <div class="lrg-row" :data-lrg-filter-key="item.filterKey">
          <button
            v-if="item.children && item.children.length && !disableCollapse"
            class="lrg-caret"
            :class="{ expanded: !collapsed[item.key] }"
            @click.stop="toggleCollapse(item.key)"
            aria-label="Toggle children"
          >
            <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <!-- Empty col-1 placeholder keeps subgrid flat for non-tree rows. -->
          <span v-else class="lrg-caret-placeholder" aria-hidden="true"></span>

          <div
            class="lrg-item"
            :class="{ selected: activeFilter === item.filterKey }"
            @click="$emit('filter-click', item.filterKey)"
          >
            <div class="lrg-item-inner" :style="{ backgroundColor: item.color, '--lrg-item-color': item.color }">
              <span class="lrg-name">{{ item.label }}</span>
              <span v-for="col in columns" :key="col.key" class="lrg-badge">
                <span class="lrg-badge-inner">
                  {{ col.key === 'population' ? fmtPop(item.population) : fmtCount(item.count) }}
                </span>
              </span>
            </div>
          </div>
        </div>

        <!-- Children rows -->
        <template v-if="item.children && item.children.length && !collapsed[item.key]">
          <div v-for="child in item.children" :key="child.key" class="lrg-row lrg-row-child" :data-lrg-filter-key="child.filterKey">
            <span class="lrg-caret-placeholder" aria-hidden="true"></span>
            <div
              class="lrg-item"
              :class="{ selected: activeFilter === child.filterKey }"
              @click="$emit('filter-click', child.filterKey)"
            >
              <div class="lrg-item-inner" :style="{ backgroundColor: child.color, '--lrg-item-color': child.color }">
                <span class="lrg-name">{{ child.label }}</span>
                <span v-for="col in columns" :key="col.key" class="lrg-badge">
                  <span class="lrg-badge-inner">
                    {{ col.key === 'population' ? fmtPop(child.population) : fmtCount(child.count) }}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- Footer totals (only when columns exist AND showFooter true).
           doxa-simple-map passes showFooter=false. -->
      <div v-if="columns.length && showFooter" class="lrg-footer">
        <span class="lrg-footer-caret-slot" aria-hidden="true"></span>
        <span class="lrg-footer-label">{{ t('legend.footer.total') }}</span>
        <span v-for="col in columns" :key="col.key" class="lrg-footer-value">
          {{ col.key === 'population' ? fmtPop(totalPopulation) : fmtCount(totalCount) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, computed, ref, watch, nextTick, inject, unref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import LegendProgressBar from './LegendProgressBar.vue'

const { t } = useI18n()

useShadowStyles(`
/* ── LegendRows — single flat grid with an invisible caret column.
   Spec: documentation/legend-spec.md. One parent grid (.lrg-items) with subgrid
   children (.lrg-title-row, .lrg-row, .lrg-footer). Col 1 is the caret
   column (doubles as the legend's left padding); last col is a matching
   trailing track (right padding). Both are --lrg-caret-col wide so the
   legend is visually symmetric without any outer left/right padding. ── */
.legend-row-group{--lrg-caret-col:30px;display:flex;flex-direction:column;height:100%;min-height:0;}

/* The grid + scroll container. Tracks:
   [caret --lrg-caret-col] [name 1fr] [UPGS auto] [POPULATION auto] [trailing --lrg-caret-col].
   Title row + every data row is a subgrid of these tracks.
   align-content:start — CRITICAL: without this, grid auto-rows STRETCH to
   fill flex:1 parent. Packing rows to the top keeps them at natural height. */
/* No top padding here — the sticky .lrg-title-row owns that space via its
   own padding-top so its white/dark bg covers what would otherwise be a
   transparent gutter that scrolled rows leak through (2026-04-27). */
.lrg-items{display:grid;grid-template-columns:var(--lrg-grid-cols, var(--lrg-caret-col) minmax(80px,1fr) auto auto var(--lrg-caret-col));grid-auto-rows:auto;align-content:start;column-gap:6px;row-gap:6px;padding:0 0 12px;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none;}
.lrg-items::-webkit-scrollbar{display:none;width:0;height:0;}

/* Title row — first row of the table. Plain (not colored). Shares tracks.
   Col 1 = title caret slot, col 2 = title text, cols 3+ = column headers.
   position:sticky keeps it visible when the user scrolls long row lists
   (qa.md frozen-header request 2026-04-27). */
/* padding-top:12px is INSIDE the sticky element so the white/dark bg
   covers the gutter that would otherwise be transparent. line-height:1.2
   on the title (not 1) so cap-letter ascenders / G aren't clipped. */
.lrg-title-row{display:grid;grid-template-columns:subgrid;grid-column:1 / -1;align-items:center;padding:12px 0 6px;position:sticky;top:0;z-index:5;background:#fff;}
.lrg-dark .lrg-title-row{background:#3b463d;}
.lrg-title-caret-slot{grid-column:1;align-self:center;display:flex;align-items:center;justify-content:center;line-height:1;}
.lrg-title{grid-column:2;align-self:center;font-weight:600;font-size:13px;line-height:1.2;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lrg-header-col{align-self:center;text-align:center;white-space:nowrap;font-size:10px;line-height:1.3;color:#888;text-transform:uppercase;letter-spacing:0.3px;font-weight:700;}
/* Prayer progress bar — 2nd implicit row of the title-row subgrid, spanning the
   pill columns (2 / -2) so it lines up with the rows beneath. The subgrid has no
   row-gap of its own, hence the margin. */
.lrg-progress{grid-column:2 / -2;margin-top:6px;}

/* Data row — subgrid of .lrg-items. Caret lives in col 1 (real grid cell,
   not absolute); the pill spans cols 2 to -2 so the trailing column stays
   empty as right padding. */
.lrg-row{display:grid;grid-template-columns:subgrid;grid-column:1 / -1;align-items:center;}
.lrg-row-child{margin-inline-start:0;}

/* .lrg-item and .lrg-item-inner are layout-transparent on desktop so the
   subgrid stays flat. LegendMobile.vue overrides these at higher specificity
   so mobile keeps its own block layout. */
.lrg-item{display:contents;cursor:pointer;}
.lrg-item-inner{display:grid;grid-template-columns:subgrid;grid-column:2 / -2;align-items:center;border-radius:6px;min-height:36px;padding:6px 0;transition:opacity 0.15s ease;}
.lrg-item-inner:hover{opacity:0.92;}
.lrg-item.selected .lrg-item-inner{outline:2px solid rgba(0,0,0,0.25);outline-offset:-2px;}

/* Caret — real grid cell in col 1, centered. Zero padding per spec: the
   column width IS the padding, the caret just sits in the middle of it. */
.lrg-caret{grid-column:1;justify-self:center;align-self:center;width:10px;height:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;background:none;border:none;padding:0;transition:transform 0.2s ease;outline:none;-webkit-tap-highlight-color:transparent;opacity:0.85;}
.lrg-caret:focus{outline:none;}
.lrg-caret.expanded{transform:rotate(90deg);}

/* Empty col-1 slot on non-tree rows — keeps subgrid flat without rendering
   anything visible. */
.lrg-caret-placeholder{grid-column:1;display:block;}

/* Name — first pill column (col 2 of parent grid, col 1 of the subgrid). */
.lrg-name{grid-column:1;padding:0 0 0 8px;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* Badges — auto-placed into the remaining subgrid tracks. Centered in track.
   Background darkens the row color by 28% (mix with #000) so white badge text
   stays readable on bright rows like the engagement-tab "Engaged" green. The
   previous mix used currentColor (which is white in light mode), so on bright
   rows it LIGHTENED the badge — wrong direction. */
.lrg-badge{display:flex;align-items:center;justify-content:center;}
.lrg-badge-inner{display:inline-block;background:color-mix(in srgb, var(--lrg-item-color, #888), #000 28%);border-radius:8px;padding:2px 10px;font-size:11px;font-weight:600;font-family:'Courier New',monospace;white-space:nowrap;min-width:32px;text-align:center;}

/* Footer — col 1 empty (matches caret column), col 2 label, trailing values. */
.lrg-footer{display:grid;grid-template-columns:subgrid;grid-column:1 / -1;align-items:center;padding:5px 0;border-top:1px solid rgba(0,0,0,0.07);font-size:11px;font-weight:600;color:#555;background:#fff;position:sticky;bottom:0;}
.lrg-footer-caret-slot{grid-column:1;}
.lrg-footer-label{grid-column:2;color:#777;}
.lrg-footer-value{text-align:center;font-family:'Courier New',monospace;}

/* ── Light mode ── text over colored pills is white. Badge text gets the
   same shadow as the label so the count/pop digits stay readable on bright
   backgrounds (engagement-tab "Engaged" green was unreadable without it). */
.lrg-light .lrg-name{color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.35);}
.lrg-light .lrg-badge-inner{color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.4);}
.lrg-light .lrg-caret{color:#666;}

/* ── Dark mode ── */
.lrg-dark .lrg-name{color:#F3F3F1;text-shadow:0 1px 2px rgba(0,0,0,0.4);}
.lrg-dark .lrg-badge-inner{color:#F3F3F1;text-shadow:0 1px 2px rgba(0,0,0,0.4);}
.lrg-dark .lrg-caret{color:rgba(243,243,241,0.75);}
.lrg-dark .lrg-title{color:#F3F3F1;}
.lrg-dark .lrg-header-col{color:rgba(243,243,241,0.65);}
.lrg-dark .lrg-footer{background:#2a332a;border-top-color:rgba(255,255,255,0.1);color:rgba(243,243,241,0.75);}
.lrg-dark .lrg-footer-label{color:rgba(243,243,241,0.65);}

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .lr-row, .lr-swatch { transition: none !important; animation: none !important; }
}
`, 'legend-row-group')

const props = defineProps({
  /** Table title — rendered as the name-column text of the first (header) row */
  title:             { type: String,  default: '' },
  /** Array of LegendItem: { key, label, color, count?, population?, filterKey?, children?: [] } */
  items:             { type: Array,   required: true },
  /** Column definitions: [{ key: 'count'|'population', label, width }] */
  columns:           { type: Array,   default: () => [] },
  /** Currently active filter key (highlighted row) */
  activeFilter:      { type: String,  default: null },
  /** Dark mode flag */
  isDark:            { type: Boolean, default: false },
  /** Hide the built-in header row (parent renders its own title outside LegendRows) */
  hideColumnHeader:  { type: Boolean, default: false },
  /** Show totals footer */
  showFooter:        { type: Boolean, default: false },
  totalCount:        { type: Number,  default: 0 },
  totalPopulation:   { type: Number,  default: 0 },
  fmtPop:            { type: Function, default: v => String(v || 0) },
  fmtCount:          { type: Function, default: v => String(v || 0) },
  /** Disable collapse/expand carets for tree items */
  disableCollapse:   { type: Boolean, default: false },
  /**
   * Prayer progress payload for the header bar — { covered, total, segments } from
   * useLegendData(...).progress. null → no bar (every non-prayer legend). Falls back
   * to inject('legendProgress') so a host that only provide()s it (the profile root,
   * for the mobile sheet) still gets the bar without threading a prop.
   */
  progress:          { type: Object,  default: null }
})

defineEmits(['filter-click'])

// Progress payload: explicit prop wins, else the provided one (may be a ref/computed).
const injectedProgress = inject('legendProgress', null)
const progressData = computed(() => props.progress ?? unref(injectedProgress) ?? null)
// Since 2026-09-16 the prayer legend's header says "Progress" (never "Legend").
const displayTitle = computed(() => progressData.value ? t('legend.progress.title') : props.title)

// Scroll-to-selected — universal across flat-legend tabs (prayer / engagement /
// adoption / religion), mirroring SemanticTreeLegend's tree-legend scroll. When
// the active filter changes (incl. from a search/geocoder result), bring the
// matching row into view. Scoped to this component's own scroll container so
// multiple legends on a page don't fight; retries across frames since the row
// may render a frame later.
const itemsContainer = ref(null)
// Scroll EVERY scrollable ancestor of the row (mobile nests .lrg-items inside the
// sheet's .legend-content) so the row lands ~8px below the top of whatever actually
// scrolls. getBoundingClientRect deltas, NOT row.offsetTop — offsetTop is relative to
// the nearest *positioned* ancestor, so when the container is static it included the
// header height and the scroll overshot by ~3 rows (the reported bug). Walking
// parentElement stays inside the shadow DOM, so this never scrolls the HOST page the
// way row.scrollIntoView() did (regression 554bf10).
function bringRowToTop(row) {
  let n = row.parentElement
  while (n) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
      const rr = row.getBoundingClientRect(), nr = n.getBoundingClientRect()
      n.scrollTop += (rr.top - nr.top) - 8
    }
    n = n.parentElement
  }
}
let lrgScrollGen = 0
watch(() => props.activeFilter, async (filterKey) => {
  if (!filterKey) return
  const gen = ++lrgScrollGen            // cancel earlier runs if the filter changes again
  const container = itemsContainer.value
  if (!container) return
  await nextTick()
  // Re-run ACROSS the mobile sheet's open animation (~300ms): the first search after a
  // collapsed-by-default page load fires this while the legend is still expanding, so an
  // early measurement is against the wrong height. Re-running as it settles corrects it;
  // when the legend is already open these passes are no-ops.
  const tryScroll = (attempt = 0) => {
    if (gen !== lrgScrollGen) return    // superseded by a newer filter
    const row = container.querySelector(`[data-lrg-filter-key="${CSS.escape(String(filterKey))}"]`)
    if (row) bringRowToTop(row)
    if (attempt < 6) setTimeout(() => tryScroll(attempt + 1), 70)
  }
  tryScroll(0)
})

const collapsed = reactive({})
function toggleCollapse(key) {
  collapsed[key] = !collapsed[key]
}

/**
 * Dynamic grid-template-columns string driven by the `columns` prop.
 * Shape: `[caret --lrg-caret-col] [name minmax(80px,1fr)] [badge auto × N] [trailing --lrg-caret-col]`.
 * The caret column doubles as the legend's left padding AND the rendering
 * track for every caret (title, row, child, footer). The trailing track
 * mirrors its width so left/right visual padding is symmetric.
 */
const gridCols = computed(() => {
  const badgeTracks = props.columns.map(() => 'auto').join(' ')
  return `var(--lrg-caret-col) minmax(80px, 1fr) ${badgeTracks} var(--lrg-caret-col)`
})
</script>

<style scoped>
/* All styles injected via useShadowStyles for shadow DOM compatibility. */
</style>
