<script setup>
/**
 * CenteredSetTarget — the cross at the centre, every unreached group on a ring by how close it is
 * to a REACHED neighbour, arrows pointing inward.
 *
 * Promoted from gospel-internet's GiCenteredSet; the layout is unchanged and shared
 * (library/components/charts/centeredSet.js). This takes joined groups as a prop and every label
 * from the caller, so the packet and the board draw the same figure from the same code.
 *
 * ★ FOUR THINGS THAT LOOK LIKE DETAIL AND ARE NOT (gospel's invariants, kept in their words):
 *
 * ring 0 IS REACHED, and it IS the centre. It is not unplaced, and drawing it as missing would say
 * the opposite of what it means.
 *
 * ring -1 IS "no relation found" AND IS NOT RING 10. The outermost ring is a measurement; no
 * relation is the absence of one. Collapsing them prints a group as "furthest" when the truth is
 * "we could not place it" — 11 rows fleet-wide, and every one of them would be a false statement.
 *
 * THE ARROW AND THE RADIUS MUST NAME THE SAME NEIGHBOUR. Both come from `rings`, never from
 * links[u][0], which is the older E-scale ordering and can disagree — that draws a ring-3 group with
 * an arrow at its ring-8 neighbour and nothing on the page says so. inwardArrow returns null when no
 * neighbour is recorded, and a null arrow is simply not drawn: an arrow is a CLAIM about a
 * relationship, so a guessed one is a fabricated claim.
 *
 * EVERY RING IS LISTED, INCLUDING EMPTY ONES. Under a filter several of the nine legitimately go to
 * zero, and a decoder that omits its empty rows stops being a decoder. Presence by identity, never
 * by count — the same rule the zone legend follows.
 *
 * ★ AND NO SEED: position is hashed from the group's own id, so two printings of one packet are
 * identical and a reader comparing sheets sees real movement rather than reshuffling.
 *
 * ★ A NOTE FOR WHOEVER BUILDS `labels.rings` — DO NOT PASS groupings.label AS A NAME. Measured on
 * the published file: those labels run 7 to 206 characters, and the long ones are the zone's MEMBER
 * LIST, not its name. Tibet's reads "Tibet Autonomous Region + Sichuan Province + Xinjiang Uyghur
 * Autonomous Region + Gansu Province + ..." — only 2 of the 14 carry no "+" list at all (Gujarāt,
 * and "Scattered / Diaspora"). Used as a heading on a printed sheet that sets a 206-character title.
 * The field is a DEFINITION and is genuinely useful where there is room to say what a zone contains;
 * for a name, humanise the slug, which is uniform by construction and tops out around 34 characters.
 * gospel found this and carries the two separately; this component asserts nothing about the words,
 * so the whole hazard lives at the call site, which is exactly why it is written down here.
 *
 * ★ THE AGREED RING VOCABULARY, for a caller building `labels.rings`. Settled between gospel and
 * exp and derived from exp's ringFor() rather than hand-numbered, so the numbering cannot drift
 * from the code that produces it. The screen legend already renders these words, so a printed sheet
 * using them cannot disagree with the screen:
 *
 *   1 Same dialect, same people      6 Same language, different culture
 *   2 Same dialect, near culture     7 Same family, same people
 *   3 Same dialect, different culture 8 Same family, near culture
 *   4 Same language, same people     9 Same family, different culture
 *   5 Same language, near culture   10 Nearby only
 *
 * ⚠ ONE CELL IS PROVISIONAL: "people" vs the brief's "culture" in column 1 is open on the Driver's
 * row 89. If he keeps "culture", exactly THREE cells change — 1, 4 and 7 — and nothing else: not
 * the numbering, not the columns, not the colours. That is why this map is written here as
 * VOCABULARY and is NOT a default: a default would bake a provisional word into every consumer that
 * forgot to pass one, and the component would become the thing that decided a Driver question. The
 * same reason ShareCalendar refuses to name its own metric.
 */
import { computed } from 'vue'
import { layoutCenteredSet, ringTally, inwardArrow, ringRadii, RING_MIN, RING_MAX } from './centeredSet.js'

const props = defineProps({
  /** [{ id, label, ring, neighborId }] — ring 1..10 placed, 0 reached/centre, -1 no relation. */
  groups: { type: Array, required: true },
  innerR: { type: Number, default: 26 },
  ringGap: { type: Number, default: 24 },
  showArrows: { type: Boolean, default: true },
  /** labels.rings is a map of ring number -> name, agreed once with the screen legend. */
  labels: { type: Object, default: () => ({}) },
  dotRadius: { type: Number, default: 2.2 },
})

const opts = computed(() => ({ innerR: props.innerR, ringGap: props.ringGap }))
const layout = computed(() => layoutCenteredSet(props.groups, opts.value))
const tally = computed(() => ringTally(layout.value))
const radii = computed(() => ringRadii(opts.value))
const arrows = computed(() => (props.showArrows
  ? layout.value.placed.map((p) => inwardArrow(p, opts.value)).filter(Boolean)
  : []))
const box = computed(() => Math.round((props.innerR + RING_MAX * props.ringGap) * 1.12))
/** Every ring, empty ones included. */
const rows = computed(() => radii.value.map(({ ring }) => ({
  ring,
  name: (props.labels.rings && props.labels.rings[ring]) || String(ring),
  count: tally.value.counts.get(ring) || 0,
})))
</script>

<template>
  <figure class="cset">
    <svg class="cset__svg" :viewBox="`${-box} ${-box} ${box * 2} ${box * 2}`" role="img" :aria-label="labels.aria || ''">
      <circle v-for="r in radii" :key="r.ring" class="cset__ring" cx="0" cy="0" :r="r.r" />
      <line v-for="(a, i) in arrows" :key="'a' + i" class="cset__arrow" :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2" />
      <circle v-for="p in layout.placed" :key="p.id" class="cset__dot" :cx="p.x" :cy="p.y" :r="dotRadius" />
      <!-- The cross. Drawn last so nothing overlaps it. -->
      <path class="cset__cross" :d="`M 0 ${-innerR * 0.55} V ${innerR * 0.55} M ${-innerR * 0.38} 0 H ${innerR * 0.38}`" />
    </svg>
    <figcaption class="cset__cap">{{ labels.caption || '' }} <b dir="ltr">{{ tally.placed }}</b></figcaption>
    <!-- centre, unplaced and unmatched are SEPARATE lines and never folded into a ring. -->
    <p v-if="tally.centre || tally.unplaced" class="cset__warn">
      <span v-if="tally.centre">{{ labels.reached || '' }} <b dir="ltr">{{ tally.centre }}</b>. </span>
      <span v-if="tally.unplaced">{{ labels.noRelation || '' }} <b dir="ltr">{{ tally.unplaced }}</b>.</span>
    </p>
    <ul class="cset__decoder">
      <li v-for="r in rows" :key="r.ring"><b dir="ltr">{{ r.ring }}</b> {{ r.name }} <b dir="ltr">{{ r.count }}</b></li>
    </ul>
  </figure>
</template>

<style scoped>
.cset { margin: 0; display: flex; flex-direction: column; align-items: center; color: var(--pk-ink, #3b463d); }
.cset__svg { max-width: 100%; }
.cset__ring { fill: none; stroke: var(--pk-rule, #d8d3c4); stroke-width: 1; }
.cset__arrow { stroke: var(--pk-out, #6d766e); stroke-width: 0.5; opacity: 0.55; }
.cset__dot { fill: var(--pk-out, #6d766e); }
.cset__cross { stroke: var(--pk-ink, #3b463d); stroke-width: 2.5; fill: none; }
.cset__cap { margin-block-start: 8px; font: 400 13px Georgia, serif; text-align: center; max-width: 46ch; }
.cset__warn { font: 400 12px Georgia, serif; color: var(--pk-out, #6d766e); margin-block-start: 4px; }
.cset__decoder { list-style: none; margin: 6px 0 0; padding: 0; font: 400 11px Georgia, serif; columns: 2; }
@media print { .cset__dot, .cset__ring, .cset__cross, .cset__arrow { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
