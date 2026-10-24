<script setup>
/**
 * LifeCalendar — a ~100-year life in weeks: 52 columns x 100 rows, 5,200 cells.
 *
 * PRINT FIRST. This lands on US Letter in a print frame with no interaction (upg100): no hover, no
 * tooltip, no transition. Every number that matters is inked, and nothing is revealed by pointing
 * at it. Sizes are in px because the packet frame is a fixed 816x1056 canvas, not a fluid page.
 *
 * Ink matches the shipping packet exactly (packet-render.js:147-152) rather than a new palette:
 * #d8d3c4 cell border on #fff, #1b1a17 text. A reader must not be able to tell which page came from
 * the component and which from the renderer.
 */
import { computed } from 'vue'
import { anchorPlacement, cellCount, scatterCells, topCells } from './packetCharts.js'

const props = defineProps({
  rows: { type: Number, default: 100 },
  columns: { type: Number, default: 52 },
  /**
   * ★ OPTIONAL AND DELIBERATELY UN-DEFAULTED, and the reason is upg100's, kept in their words:
   * the packet prints for a reader we do not know, so shading their life would be a guess presented
   * as fact. An empty grid is the honest version and still lands the point — 5,200 boxes is a whole
   * life on one page. Supply { week, label } only when a real age is known.
   */
  anchor: { type: Object, default: null },
  /** Every string is passed in; this component writes no prose, because the packet prints in every locale we ship. */
  labels: { type: Object, default: () => ({}) },
  seed: { type: String, default: '' },
  /** Cells to shade, when used as a plain "weeks lived" grid. The share page uses ShareCalendar. */
  shaded: { type: Number, default: 0 },
  /**
   * WHERE the shaded cells sit: 'scatter' (the default, unchanged) or 'top'.
   *
   * ★ THE TWO ANSWER DIFFERENT QUESTIONS, which is why this is a prop and not a fix. 'scatter'
   * says "these weeks fall somewhere in a life and we do not know where" — honest for weeks lived.
   * 'top' makes the grid a MAGNITUDE a reader can measure against its own frame: 32 cells scattered
   * across 5,200 are invisible confetti, while 32 stacked from the corner are an obvious sliver.
   * A share page wants 'top'; a life page wants 'scatter'. Default stays 'scatter' so no existing
   * caller moves.
   */
  fill: { type: String, default: 'scatter' },
  /**
   * Rows to mark as a distinct band from row 1 — the printed calendar highlights Jesus' 33 years
   * this way. 0 draws no band. Rows, not cells, because the band is read along the year axis and a
   * cell count would drift with the column width.
   */
  highlightRows: { type: Number, default: 0 },
})

const total = computed(() => cellCount(props.rows, props.columns))
// The band in CELLS, derived from ROWS so it tracks the column count rather than a fixed number.
// Clamped to the grid: a highlightRows larger than the grid marks the whole grid rather than
// overflowing into a class nothing renders.
const highlightBand = computed(() => Math.min(total.value, Math.max(0, Math.round(props.highlightRows)) * props.columns))

const shadedSet = computed(() => (props.shaded > 0 ? (props.fill === 'top' ? topCells(total.value, props.shaded) : scatterCells(total.value, props.shaded, props.seed)) : new Set()))
const placedAnchor = computed(() => anchorPlacement(props.anchor, total.value))
const anchorIndex = computed(() => placedAnchor.value.index)
</script>

<template>
  <figure class="lcal">
    <figcaption v-if="labels.title" class="lcal__title">{{ labels.title }}</figcaption>
    <p v-if="labels.lede" class="lcal__lede">{{ labels.lede }}</p>
    <div
      class="lcal__grid"
      :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)` }"
      role="img"
      :aria-label="labels.gridLabel || labels.title || ''"
    >
      <i
        v-for="i in total"
        :key="i"
        class="lcal__c"
        :class="{
          'lcal__c--on': shadedSet.has(i - 1),
          'lcal__c--anchor': anchorIndex === i - 1,
          'lcal__c--band': highlightBand > 0 && i <= highlightBand,
        }"
      />
    </div>
    <p v-if="anchor && anchor.label && anchorIndex >= 0" class="lcal__foot">{{ anchor.label }}</p>
    <!-- An anchor that cannot be drawn is NAMED. Omitting it silently is indistinguishable, on
         paper, from having chosen not to mark it. -->
    <p v-else-if="placedAnchor.reason" class="lcal__unplaced" role="alert">
      {{ labels.anchorUnplaced || 'anchor week not drawn' }}: {{ anchor.week }} ({{ placedAnchor.reason }}, grid is {{ total }} weeks)
    </p>
    <p v-if="labels.foot" class="lcal__foot">{{ labels.foot }}</p>
  </figure>
</template>

<style scoped>
.lcal { margin: 0; color: var(--pk-ink, #1b1a17); }
.lcal__title { font: 700 40px Georgia, serif; margin: 0 0 2px; }
.lcal__lede, .lcal__foot { font: 400 12px Georgia, serif; margin: 6px 0 0; }
.lcal__grid { display: grid; grid-auto-rows: 13px; gap: 2px; width: 100%; }
.lcal__c { display: block; width: 100%; height: 100%; border: 1px solid var(--pk-rule, #d8d3c4); border-radius: 1px; background: #fff; }
.lcal__c--on { background: var(--pk-on, #2f6d4f); border-color: var(--pk-on, #2f6d4f); }
/* The highlight band (the printed calendar marks Jesus' 33 years this way). An OUTLINE, not a
   fill: the band and the shaded cells must be readable at the same time, and two fills in one
   32x32px cell are indistinguishable in print. Drawn under --on so a shaded cell inside the band
   still reads as shaded. */
.lcal__c--band { border-color: var(--pk-band, #b08968); }
.lcal__c--band.lcal__c--on { border-color: var(--pk-on, #2f6d4f); }
/* The anchor is a RING, never a fill: it marks a position without claiming the cell's meaning. */
.lcal__c--anchor { border-color: var(--pk-ink, #1b1a17); border-width: 2px; }
.lcal__unplaced { font: 700 12px Georgia, serif; color: #8a1c1c; margin: 6px 0 0; }
@media print { .lcal__c { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
