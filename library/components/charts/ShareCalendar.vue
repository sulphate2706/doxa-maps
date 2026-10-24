<script setup>
/**
 * ShareCalendar — the same 5,200-cell grid, shaded by a population-weighted share.
 *
 * ★ shareLabel IS REQUIRED AND HAS NO DEFAULT, on purpose. The shipped figure is the EVANGELICAL
 * share (christian-share.json: pctEvangelical 0.6133), and the brief says
 * "% Christian". IMB publishes no %-Christian column at all, so a true "% Christian" is not
 * computable from repo data (UPG100-RESEARCH-FINDINGS.md §3). This project has already retracted one
 * P0 that was two metrics wearing one name. A default here would let this component be the thing
 * that reintroduces the wrong word, so it renders a visible error instead of guessing.
 *
 * ★ AND share IS A FRACTION, NEVER A PERCENT. 0.6133 is a valid fraction (61.33%) and a valid
 * percent (0.61%) and nothing in the value separates them; read as a fraction it inks 3,189 cells
 * of 5,200 instead of 32, on paper, with no symptom but a darker page. Callers use
 * fractionFromPercent() so the unit is stated in the source line.
 */
import { computed } from 'vue'
import { shareCells, scatterCells, peoplePerCell } from './packetCharts.js'

const props = defineProps({
  rows: { type: Number, default: 100 },
  columns: { type: Number, default: 52 },
  share: { type: Number, required: true },
  shareLabel: { type: String, required: true },
  population: { type: Number, default: 0 },
  labels: { type: Object, default: () => ({}) },
  seed: { type: String, default: '' },
})

const cells = computed(() => shareCells(props.rows, props.columns, props.share))
const shadedSet = computed(() => scatterCells(cells.value.total, cells.value.filled, props.seed))
const perCell = computed(() => peoplePerCell(props.population, props.rows, props.columns))
const labelMissing = computed(() => !props.shareLabel || !String(props.shareLabel).trim())

/** The unrounded value, so the drawn integer never reads as precise. */
const exactText = computed(() => cells.value.exact.toFixed(2))
</script>

<template>
  <figure class="scal">
    <p v-if="labelMissing" class="scal__error" role="alert">
      ShareCalendar: shareLabel is required. This chart will not name its own metric.
    </p>
    <template v-else>
      <figcaption v-if="labels.title" class="scal__title">{{ labels.title }}</figcaption>
      <div
        class="scal__grid"
        :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)` }"
        role="img"
        :aria-label="labels.gridLabel || shareLabel"
      >
        <i v-for="i in cells.total" :key="i" class="scal__c" :class="{ 'scal__c--on': shadedSet.has(i - 1) }" />
      </div>
      <!-- Everything below is INKED. A printed page has no hover, so the overlay's numbers and the
           method have to be readable as text or the chart asserts something it never explains. -->
      <p class="scal__legend">
        <i class="scal__key scal__c--on" aria-hidden="true" /> {{ shareLabel }}
        — {{ cells.filled }} / {{ cells.total }}
        <span class="scal__exact">({{ exactText }})</span>
      </p>
      <p v-if="cells.roundedUpFromBelowOne" class="scal__note">{{ labels.belowOne || '' }}</p>
      <p v-if="cells.roundedToZero" class="scal__note">{{ labels.roundedToZero || '' }}</p>
      <p v-if="population" class="scal__foot">{{ labels.perCell || '' }} {{ Math.round(perCell) }}</p>
      <p v-if="labels.method" class="scal__foot">{{ labels.method }}</p>
    </template>
  </figure>
</template>

<style scoped>
.scal { margin: 0; color: var(--pk-ink, #1b1a17); }
.scal__title { font: 700 40px Georgia, serif; margin: 0 0 2px; }
.scal__grid { display: grid; grid-auto-rows: 13px; gap: 2px; width: 100%; }
.scal__c { display: block; width: 100%; height: 100%; border: 1px solid var(--pk-rule, #d8d3c4); border-radius: 1px; background: #fff; }
.scal__c--on { background: var(--pk-on, #2f6d4f); border-color: var(--pk-on, #2f6d4f); }
.scal__key { display: inline-block; width: 10px; height: 10px; }
.scal__legend, .scal__foot, .scal__note { font: 400 12px Georgia, serif; margin: 6px 0 0; }
/* The unrounded figure is smaller but never hidden: 32 is a rounding of 31.89 and must say so. */
.scal__exact { opacity: 0.75; }
.scal__error { font: 700 13px Georgia, serif; color: #8a1c1c; border: 2px solid #8a1c1c; padding: 8px; }
@media print { .scal__c { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
