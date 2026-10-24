<script setup>
/**
 * BoundedSet — a circle with REACHED groups inside it and unreached outside.
 *
 * Promoted from gospel-internet's GiBoundedSet, which keeps the fetching and the board state; this
 * takes already-joined groups as a prop so any consumer can draw the same figure. The layout itself
 * is unchanged and shared — library/components/charts/boundedSet.js, one implementation.
 *
 * ★ UNKNOWN IS ITS OWN CATEGORY AND IS COUNTED IN INK. A group whose reached-ness did not join is
 * not drawn outside the circle, because "outside" means unreached and we do not know that. It is
 * reported instead. This matters more in print than on screen: a printed page has no hover, and a
 * category the reader cannot see is a category the reader will assume is zero.
 *
 * ★ NO SEED PROP, DELIBERATELY (gospel). Position is hashed from the group's own id, so a group
 * lands in the same place on every render, in every process, forever — two printings of one packet
 * are identical and a reader comparing last month's sheet to this month's sees real movement rather
 * than reshuffling. A seed would silently rescramble every dot while the data was unchanged.
 *
 * ★ AND THE BOUNDARY GAP IS NOT NEGOTIABLE (gospel): inside points stay within 0.92r, outside
 * beyond 1.12r, because a dot sitting ON the line is the one thing a bounded set cannot express.
 * To fit a page, shrink the whole figure — never compress the gap.
 */
import { computed } from 'vue'
import { layoutBoundedSet, boundedSetTally } from './boundedSet.js'

const props = defineProps({
  /** [{ id, label, reached }] — reached undefined means UNKNOWN, which is not the same as false. */
  groups: { type: Array, required: true },
  radius: { type: Number, default: 120 },
  spread: { type: Number, default: 260 },
  /** Every string is passed in; this component writes no prose. */
  labels: { type: Object, default: () => ({}) },
  dotRadius: { type: Number, default: 2.2 },
})

const layout = computed(() => layoutBoundedSet(props.groups, { r: props.radius, spread: props.spread }))
const tally = computed(() => boundedSetTally(layout.value))
const box = computed(() => Math.round(props.spread * 1.08))
</script>

<template>
  <figure class="bset">
    <svg class="bset__svg" :viewBox="`${-box} ${-box} ${box * 2} ${box * 2}`" role="img" :aria-label="labels.aria || ''">
      <circle class="bset__ring" cx="0" cy="0" :r="radius" />
      <circle v-for="p in layout.outside" :key="p.id" class="bset__out" :cx="p.x" :cy="p.y" :r="dotRadius" />
      <circle v-for="p in layout.inside" :key="p.id" class="bset__in" :cx="p.x" :cy="p.y" :r="dotRadius" />
    </svg>
    <figcaption class="bset__cap">
      {{ labels.caption || '' }}
      <b dir="ltr">{{ tally.inside }} / {{ tally.outside }}</b>
    </figcaption>
    <!-- Printed, not hidden behind a v-if on truthiness alone: when unknown is 0 the line is
         omitted, but whenever there IS an unknown it is named and counted. -->
    <p v-if="tally.unknown" class="bset__warn">
      {{ labels.unknown || '' }} <b dir="ltr">{{ tally.unknown }}</b>
    </p>
  </figure>
</template>

<style scoped>
.bset { margin: 0; display: flex; flex-direction: column; align-items: center; color: var(--pk-ink, #3b463d); }
.bset__svg { max-width: 100%; }
.bset__ring { fill: none; stroke: var(--pk-ink, #3b463d); stroke-width: 1.5; }
.bset__in { fill: var(--pk-in, #92b195); }
.bset__out { fill: var(--pk-out, #6d766e); opacity: 0.65; }
.bset__cap { margin-block-start: 8px; font: 400 13px Georgia, serif; text-align: center; max-width: 46ch; }
.bset__warn { font: 400 12px Georgia, serif; color: var(--pk-out, #6d766e); margin-block-start: 4px; }
@media print { .bset__in, .bset__out, .bset__ring { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
