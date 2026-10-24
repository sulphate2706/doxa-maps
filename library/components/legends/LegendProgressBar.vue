<script setup>
/**
 * LegendProgressBar — the prayer legend's header progress bar.
 *
 * WHY (the README story): a global prayer movement needs to SEE
 * progress — how many people groups are covered in prayer out of the total, changing
 * live as people sign up. ONE shared component so every prayer map (simple map
 * prayer tab, research map Prayer tab, and embeds) shows the same bar.
 *
 * SPEC (refined 2026-09-16 — keep this in sync with the behaviour):
 *   1. The bar lives in the HEADER of the prayer legend, and the prayer legend's
 *      title becomes "Progress" (desktop title bar and the mobile sheet title both —
 *      via the shared components SemanticTreeLegend / LegendRows, never "Legend").
 *   2. Three colours = the three prayer legend rows (Has Prayer, Needs Prayer, Full
 *      Prayer Coverage) — the EXACT colours of the prayer colour strategy
 *      (library/colors/prayer-progress.js PALETTE) that the legend rows use.
 *   3. Geometry, left → right: [has-prayer span][needs-prayer span = the remainder].
 *      Full prayer coverage is NOT a third separate segment: it fills IN the
 *      has-prayer span from the left in the full-coverage colour (full ⊂ has prayer:
 *      "has prayer and full prayer coverage take up one slot combined, not
 *      duplicated"), so over time the full-coverage colour grows to fill the
 *      has-prayer span. useLegendData's three row counts are mutually EXCLUSIVE
 *      (usePrayerStatistics: partial excludes full; the scan fallback: has =
 *      0 < committed < 100), therefore hasSpan = has + full and fullFill = full.
 *      Widths are percentages of totalCount.
 *   4. Text line: covered/total + %, where covered = the has-prayer span.
 *   5. Compact — the header stays one or two lines; dark variant for the research map.
 *   6. Interactive + hoverable: hovering (and keyboard-focusing) a span shows what it
 *      is and its numbers ("Has Prayer · 658 · 31%") as a small popover that imitates
 *      the existing .stl-info-pop chrome (same font/colours, dark + light), plus a
 *      hover highlight on the span. A click on a span selects the matching legend row
 *      (the host wires @select-segment to the SAME handler its rows use).
 *      The typical legend rows stay right under the header.
 *
 * API:
 *   props { covered, total, segments, isDark, label, fmtCount }
 *     covered   Number  — the has-prayer span count (has + full). Drives the text + aria.
 *     total     Number  — totalCount of the legend (all people groups in the data source).
 *     segments  Array   — [{ key, label, count, color }] in LEFT→RIGHT draw order with
 *                         EXCLUSIVE counts (they sum to `total`). Every segment but the
 *                         LAST is drawn inside the covered span (so for prayer:
 *                         [fullPrayer, hasPrayer, noPrayer] → green fills the left of
 *                         the orange span, red is the remainder).
 *     isDark    Boolean — dark chrome (research map) vs light.
 *     label     String  — optional override of the accessible full sentence.
 *     fmtCount  Function— the legend's number formatter (defaults to toLocaleString).
 *   emits 'select-segment' (key) — the hovered/clicked segment's key (a legend row key).
 *
 * Accessibility: the visible text carries role="progressbar" + aria-valuenow/min/max
 * with the full sentence as its aria-label (a progressbar's children are presentational
 * in ARIA, so the role must NOT wrap the interactive segment buttons). Each segment is a
 * real <button> with its own aria-label, so keyboard users get the same popover.
 *
 * Styles are injected with useShadowStyles like every other legend component.
 * Payload builder: useLegendData(...).progress (library/composables/legends/useLegendData.js).
 */
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useShadowStyles } from '../../composables/useShadowStyles.js'

const { t } = useI18n()

useShadowStyles(`
/* ── LegendProgressBar (.lpb) — header progress bar of the prayer legend.
   One flex line: [track (flex:1)][compact text]. The popover is absolute, below
   the track, and imitates .stl-info-pop (SemanticTreeLegend) so it reads as
   part of the legend chrome. Dark is the STL default; .lpb-light mirrors the
   .stl-panel[data-theme="light"] palette. ── */
.lpb{position:relative;display:flex;align-items:center;gap:8px;min-width:0;width:100%;box-sizing:border-box;}
/* Hit area vs paint (WCAG 2.5.8, measured at 390: every segment was a 10px-tall button). The track is 24px
   tall so each segment button is a 24px target, but it paints only a 10px band: the track's background is
   a centred 10px strip and each segment clips its colour to its content box inside 7px of padding. The
   -7px margins keep the legend's layout exactly 10px tall, as before. */
.lpb-track{position:relative;flex:1 1 auto;min-width:60px;display:flex;height:24px;margin:-7px 0;overflow:hidden;}
/* The grey band, rounded, under the segments; the first and last segment round the bar's two ends (an
   elliptical radius 5px/12px leaves a 5px curve on the 10px painted band inside the 7px padding). */
.lpb-track::before{content:'';position:absolute;left:0;right:0;top:7px;height:10px;border-radius:5px;background:rgba(110,118,129,0.25);}
.lpb-seg{position:relative;}
.lpb-span:first-child .lpb-seg:first-child{border-top-left-radius:5px 12px;border-bottom-left-radius:5px 12px;}
.lpb-seg-rest,.lpb-span:last-child .lpb-seg:last-child{border-top-right-radius:5px 12px;border-bottom-right-radius:5px 12px;}
.lpb-span{display:flex;height:100%;min-width:0;flex:0 0 auto;}
.lpb-seg{appearance:none;-webkit-appearance:none;border:none;margin:0;padding:7px 0;box-sizing:border-box;background-clip:content-box !important;height:100%;display:block;flex:0 0 auto;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent;transition:filter 0.12s,box-shadow 0.12s;}
.lpb-seg-rest{flex:1 1 auto;}
.lpb-seg:focus{outline:none;}
/* Hover / keyboard-focus / active highlight — brighter + a 1px inset ring (inset
   shadows survive the track's overflow:hidden). */
.lpb-seg:hover,.lpb-seg:focus-visible,.lpb-seg.active{filter:brightness(1.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.65);}
.lpb-light .lpb-seg:hover,.lpb-light .lpb-seg:focus-visible,.lpb-light .lpb-seg.active{box-shadow:inset 0 0 0 1px rgba(0,0,0,0.35);}
/* The text — same mono/size family as the STL column headers, tabular digits. */
.lpb-text{flex:0 0 auto;font:600 10px ui-monospace,monospace;letter-spacing:0.02em;color:#8b949e;white-space:nowrap;font-variant-numeric:tabular-nums;line-height:1;}
.lpb-light .lpb-text{color:#57606a;}
/* Stacked layout: numbers centered above, bar full width below. */
.lpb-stacked{flex-direction:column;align-items:stretch;gap:6px;}
.lpb-stacked .lpb-text{order:1;text-align:center;font-size:12px;letter-spacing:0.03em;}
.lpb-stacked .lpb-track{order:2;width:100%;}
/* Popover — imitates .stl-info-pop (same font, colours, radius, border). */
.lpb-pop{position:absolute;top:calc(100% + 6px);left:0;z-index:10;padding:7px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;font:11px system-ui;color:#c9d1d9;line-height:1.45;white-space:nowrap;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.5);}
.lpb-light .lpb-pop{background:#f6f8fa;border-color:#d0d7de;color:#1f2328;box-shadow:0 8px 24px rgba(31,35,40,0.18);}
.lpb-pop-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-inline-end:6px;vertical-align:-1px;box-shadow:0 0 0 1px rgba(0,0,0,0.4);}
/* Collapsed mobile sheet (LegendMobile.vue) shows only the 48px title strip — the
   bar must not take a second header line there. Same-shadow-root rule, owned here
   so the sheet needs no knowledge of the bar. */
.legend-mobile-sheet.collapsed .lpb{display:none!important;}

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .lpb-seg { transition: none !important; animation: none !important; }
}
`, 'legend-progress-bar')

const props = defineProps({
  /** Has-prayer span count (has + full) — drives the text and the aria values. */
  covered:  { type: Number, default: 0 },
  /** totalCount of the legend (every people group in the data source). */
  total:    { type: Number, default: 0 },
  /** [{ key, label, count, color }] LEFT→RIGHT, exclusive counts; last = remainder. */
  segments: { type: Array,  default: () => [] },
  isDark:   { type: Boolean, default: false },
  /** Optional override of the accessible full sentence. */
  label:    { type: String, default: '' },
  /** The legend's number formatter (useLegendData.fmtCount / STL fmtCount). */
  fmtCount: { type: Function, default: (n) => (Number(n) || 0).toLocaleString() },
  /** Compact: the visible text is the percentage only ("31%") — used when the host lays the
   *  bar out on the legend's own columns and prints the counts in the numeric cells. */
  compact:  { type: Boolean, default: false },
  /** Stacked: the numbers sit centered ABOVE the bar and the bar spans the full width. */
  stacked:  { type: Boolean, default: false },
  /** Show the numbers text at all (the prayer legend shows the bar alone; counts are in its rows). */
  showText: { type: Boolean, default: true }
})

const emit = defineEmits(['select-segment'])

// ── Numbers ───────────────────────────────────────────────────────────────────
const pct = computed(() => props.total > 0 ? Math.round(props.covered / props.total * 100) : 0)
// Covered span width as % of the track (clamped — counts can lag a beat while
// /statistics resolves against the loaded-pin fallback).
const coveredPct = computed(() => props.total > 0 ? Math.min(100, Math.max(0, props.covered / props.total * 100)) : 0)
const spanSegs = computed(() => props.segments.slice(0, -1))
const restSeg  = computed(() => props.segments.length ? props.segments[props.segments.length - 1] : null)
// A span segment's width is relative to the SPAN (so the segments inside it sum to
// the span), which equals count/total of the track.
function segPctOfSpan(seg) {
  return props.covered > 0 ? Math.min(100, Math.max(0, (seg.count || 0) / props.covered * 100)) : 0
}
function segPct(seg) {
  return props.total > 0 ? Math.round((seg.count || 0) / props.total * 100) : 0
}

// ── Text (i18n: legend.progress.* in library/i18n/locales/<lc>/legend.json) ──
const fullText  = computed(() => props.label || t('legend.progress.covered', {
  covered: props.fmtCount(props.covered), total: props.fmtCount(props.total), pct: pct.value
}))
const shortText = computed(() => t('legend.progress.short', {
  covered: props.fmtCount(props.covered), total: props.fmtCount(props.total), pct: pct.value
}))
function segText(seg) {
  return t('legend.progress.segment', { label: seg.label, count: props.fmtCount(seg.count || 0), pct: segPct(seg) })
}

// ── Hover / focus popover ─────────────────────────────────────────────────────
const rootEl   = ref(null)
const popEl    = ref(null)
const segEls   = {}
const activeKey = ref(null)
const popLeft   = ref(0)
const activeSeg = computed(() => props.segments.find(s => s.key === activeKey.value) || null)
function setSegEl(key, el) { if (el) segEls[key] = el; else delete segEls[key] }
async function show(key) {
  activeKey.value = key
  await nextTick()
  // Anchor the popover at the segment's left edge, clamped inside the bar's width
  // so it never pokes out of the legend panel (whose .stl-inner clips overflow).
  const root = rootEl.value, seg = segEls[key], pop = popEl.value
  if (!root || !seg || !pop) return
  const rr = root.getBoundingClientRect(), sr = seg.getBoundingClientRect()
  const maxLeft = Math.max(0, rr.width - pop.offsetWidth)
  popLeft.value = Math.min(Math.max(0, sr.left - rr.left), maxLeft)
}
function hide() { activeKey.value = null }
</script>

<template>
  <div
    ref="rootEl"
    class="lpb"
    :class="[isDark ? 'lpb-dark' : 'lpb-light', { 'lpb-stacked': stacked }]"
    :data-covered="covered"
    :data-total="total"
    :data-pct="pct"
    @mouseleave="hide"
  >
    <div class="lpb-track">
      <!-- The covered (has-prayer) span: width = covered/total. Inside it the
           segments are drawn left→right, so for prayer the full-coverage colour
           fills the span from the left and the has-prayer colour completes it. -->
      <span class="lpb-span" :style="{ width: coveredPct + '%' }" :data-span-pct="coveredPct.toFixed(2)">
        <!-- An empty segment is not drawn: a zero-width button is an invisible tab stop, and it took the
             bar's rounded left end. -->
        <button
          v-for="seg in spanSegs.filter(s => segPctOfSpan(s) > 0)" :key="seg.key"
          type="button"
          class="lpb-seg"
          :class="{ active: activeKey === seg.key }"
          :style="{ width: segPctOfSpan(seg) + '%', background: seg.color }"
          :data-seg="seg.key"
          :data-count="seg.count || 0"
          :aria-label="segText(seg)"
          :ref="el => setSegEl(seg.key, el)"
          @mouseenter="show(seg.key)"
          @focus="show(seg.key)"
          @blur="hide"
          @click.stop="emit('select-segment', seg.key)"
        ></button>
      </span>
      <!-- The remainder (needs prayer) — fills whatever the span leaves. -->
      <button
        v-if="restSeg"
        type="button"
        class="lpb-seg lpb-seg-rest"
        :class="{ active: activeKey === restSeg.key }"
        :style="{ background: restSeg.color }"
        :data-seg="restSeg.key"
        :data-count="restSeg.count || 0"
        :aria-label="segText(restSeg)"
        :ref="el => setSegEl(restSeg.key, el)"
        @mouseenter="show(restSeg.key)"
        @focus="show(restSeg.key)"
        @blur="hide"
        @click.stop="emit('select-segment', restSeg.key)"
      ></button>
    </div>

    <span
      v-if="showText"
      class="lpb-text"
      role="progressbar"
      :aria-valuenow="covered"
      aria-valuemin="0"
      :aria-valuemax="total"
      :aria-valuetext="shortText"
      :aria-label="fullText"
      :title="fullText"
    >{{ compact ? pct + '%' : shortText }}</span>

    <div v-if="activeSeg" ref="popEl" class="lpb-pop" role="tooltip" :style="{ left: popLeft + 'px' }">
      <span class="lpb-pop-dot" :style="{ background: activeSeg.color }"></span>{{ segText(activeSeg) }}
    </div>
  </div>
</template>

<style scoped>
/* All styles injected via useShadowStyles for shadow DOM compatibility. */
</style>
