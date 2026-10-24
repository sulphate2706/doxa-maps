<script setup>
/**
 * VisionFunnel — the inverted triangle: all peoples → unreached → frontier, and where a list sits.
 *
 * ★ STEPS AND OVERLAYS ARE DIFFERENT THINGS, and this is the whole design.
 * A funnel's rhetoric is containment: of all peoples these are unreached, of those these are
 * frontier. That reading is only honest while each step is a SUBSET of the one above. DOXA is not:
 * of its 2,107 groups 2,082 are unreached and 1,745 are frontier, so 362 — one group in six — are
 * not frontier at all. Drawn as a fourth nested band it would misstate 17.2% of the list with a
 * clean shape and no error of any kind.
 *
 * So steps stack, and overlays are drawn as BRACKETS BESIDE the steps they reach into, never inside
 * them. The component asks packetCharts.overlayPlacement() whether an overlay is a slice rather
 * than deciding for itself, and refuses to render one as a band when it is not.
 *
 * PRINT FIRST (upg100): no hover, no tooltip. Every number is inked, including each overlay's parts.
 *
 * RTL: the triangle is vertically directional — it narrows downward — so it is NOT mirrored; a
 * scaleX flip would reverse nothing meaningful and invert any text inside it. What does need to
 * mirror is the label and bracket side, which is why those use logical properties (inset-inline,
 * text-align: start) rather than left/right.
 */
import { computed } from 'vue'
import { assertNested, assertOnePublisher, bracketSpan, overlayCaption, shareOfLists } from './packetCharts.js'

const props = defineProps({
  /** Strictly nested, outermost first: [{ id, label, groups, population, source }] */
  steps: { type: Array, required: true },
  /** NOT slices: [{ id, label, groups, population, within: { stepId: count } }] */
  overlays: { type: Array, default: () => [] },
  highlight: { type: String, default: '' },
  /** { index, total } — K is unsettled (27 or 29), so it is passed in and nothing is asserted about it. */
  ofK: { type: Object, default: null },
  labels: { type: Object, default: () => ({}) },
})

/** Refuses rather than drawing a plausible picture: a printed funnel cannot be corrected. */
const problem = computed(() => {
  try {
    assertOnePublisher(props.steps)
    assertNested(props.steps)
    return null
  } catch (e) { return e.message }
})

const W = 520, STEP_H = 74, PAD = 10
const maxGroups = computed(() => Math.max(1, ...props.steps.map((s) => Number(s.groups) || 0)))

/** Each step is a trapezoid whose width is proportional to its count. */
const bands = computed(() => props.steps.map((s, i) => {
  const next = props.steps[i + 1]
  const wTop = (Number(s.groups) || 0) / maxGroups.value * W
  const wBot = next ? (Number(next.groups) || 0) / maxGroups.value * W : wTop * 0.55
  const y = PAD + i * STEP_H
  const cx = PAD + W / 2
  return {
    id: s.id, label: s.label, groups: s.groups, population: s.population, y, h: STEP_H,
    points: [
      [cx - wTop / 2, y], [cx + wTop / 2, y],
      [cx + wBot / 2, y + STEP_H], [cx - wBot / 2, y + STEP_H],
    ].map((p) => p.join(',')).join(' '),
  }
}))

const height = computed(() => PAD * 2 + props.steps.length * STEP_H)

/**
 * An overlay's bracket spans the steps it reaches into. It is positioned BESIDE the funnel, so it
 * can cross two steps without asserting that either contains it.
 */
const placed = computed(() => props.overlays.map((o) => ({ o, span: bracketSpan(o, props.steps) })))

const brackets = computed(() => placed.value.filter((x) => x.span).map(({ o, span }) => ({
  ...overlayCaption(o, props.steps),
  label: o.label,
  population: o.population,
  y: PAD + span.from * STEP_H,
  h: (span.to - span.from + 1) * STEP_H,
  isHighlight: o.id === props.highlight,
})))

/**
 * Overlays we cannot place. Named in ink rather than dropped: an overlay whose `within` is missing
 * or names an unknown step has no known relationship to the steps, and silently omitting it loses
 * its groups from the page with nothing to say so.
 */
const unplaced = computed(() => placed.value.filter((x) => !x.span).map(({ o }) => o))

const ofKText = computed(() => {
  const k = props.ofK ? shareOfLists(props.ofK.index, props.ofK.total) : null
  return k ? { ...k, percent: k.percent.toFixed(1) } : null
})
</script>

<template>
  <figure class="vf">
    <p v-if="problem" class="vf__error" role="alert">{{ problem }}</p>
    <template v-else>
      <figcaption v-if="labels.title" class="vf__title">{{ labels.title }}</figcaption>
      <div class="vf__body">
        <svg class="vf__svg" :viewBox="`0 0 ${W + PAD * 2} ${height}`" role="img" :aria-label="labels.title || ''">
          <polygon v-for="(b, i) in bands" :key="b.id" :points="b.points" class="vf__band" :style="{ opacity: 0.45 + i * 0.18 }" />
          <!-- Brackets sit OUTSIDE the polygons. An overlay is never painted inside a step, because
               being inside a step is exactly the claim it cannot make. -->
          <g v-for="b in brackets" :key="b.id">
            <rect :x="2" :y="b.y + 2" :width="4" :height="b.h - 4" class="vf__bracket" :class="{ 'vf__bracket--hi': b.isHighlight }" />
          </g>
        </svg>
        <ul class="vf__steps">
          <li v-for="b in bands" :key="b.id" class="vf__step">
            <b>{{ b.label }}</b> — {{ b.groups }}
          </li>
        </ul>
      </div>
      <!-- The overlay's parts, as text. upg100: an unexplained band on paper tells a reader nothing. -->
      <ul class="vf__overlays">
        <li v-for="b in brackets" :key="b.id" class="vf__overlay" :class="{ 'vf__overlay--hi': b.isHighlight }">
          <b>{{ b.label }}</b> — {{ b.total }}<template v-for="p in b.parts" :key="p.stepId">, {{ p.groups }} {{ (labels.steps && labels.steps[p.stepId]) || p.stepId }}</template>
          <span v-if="!b.isSlice && labels.notASlice" class="vf__caveat"> {{ labels.notASlice }}</span>
        </li>
      </ul>
      <p v-for="o in unplaced" :key="o.id" class="vf__unplaced" role="alert">
        {{ o.label || o.id }} — {{ o.groups }}{{ labels.unplaced ? ' · ' + labels.unplaced : ' · cannot be placed: no `within` naming a step in this funnel' }}
      </p>
      <p v-if="ofKText" class="vf__ofk">{{ labels.ofK || '' }} {{ ofKText.index }} / {{ ofKText.total }} · {{ ofKText.percent }}%</p>
    </template>
  </figure>
</template>

<style scoped>
.vf { margin: 0; color: var(--pk-ink, #1b1a17); }
.vf__title { font: 700 40px Georgia, serif; margin: 0 0 6px; }
.vf__body { display: flex; gap: 14px; align-items: flex-start; }
.vf__svg { flex: 1 1 auto; max-width: 100%; }
.vf__band { fill: var(--pk-on, #2f6d4f); stroke: #fff; stroke-width: 1; }
.vf__bracket { fill: var(--pk-rule, #d8d3c4); }
.vf__bracket--hi { fill: var(--pk-ink, #1b1a17); }
.vf__steps, .vf__overlays { list-style: none; margin: 0; padding: 0; }
.vf__step, .vf__overlay, .vf__ofk { font: 400 12px Georgia, serif; margin-top: 4px; text-align: start; }
.vf__overlay--hi { font-weight: 700; }
.vf__caveat { opacity: 0.8; }
.vf__unplaced { font: 700 12px Georgia, serif; color: #8a1c1c; margin-top: 4px; text-align: start; }
.vf__error { font: 700 13px Georgia, serif; color: #8a1c1c; border: 2px solid #8a1c1c; padding: 8px; }
@media print { .vf__band, .vf__bracket { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
