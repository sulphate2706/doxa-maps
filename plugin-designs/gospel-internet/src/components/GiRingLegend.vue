<script setup>
/**
 * GiRingLegend.vue — the DECODER for the centered-set target: what every ring means, how many
 * groups sit on it, and one real example, so nobody has to guess.
 *
 * Laid out as the grid the rings actually are (ringInfo.js): rows = how much language a group
 * shares with its closest reached neighbour (dialect / language / family), columns = how close
 * the culture is (same / near / different), ring 10 (nearby only) below, and the cross (reached)
 * above. Each cell is a button with a small target glyph that highlights ITS ring.
 *
 * EVERY CELL RENDERS, EVEN AT ZERO. Presence is by identity, never by count: under a list filter
 * several rings are legitimately empty, and a decoder that hid them would stop being a decoder.
 * THE FOOTER ACCOUNTS FOR EVERY GROUP the rings cannot show: the centre (reached), no relation
 * found (unplaced) and not in the table at all (counted by the chart at its join, passed in).
 *
 * Props:  groups     the chart's joined groups { ring, label, neighborId } (so counts match the chart)
 *         unmatched  groups the chart could not join at all
 *         activeRing the ring the chart is highlighting (1-10), or null
 * Emits:  select(ring | null), fullscreen
 */
import { ref, computed } from 'vue'
import FullscreenButton from '@map/components/map-controls/FullscreenButton.vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { formatCount } from '@map/utils/formatCount.js'
import { useGiT } from '../useGiT.js'
import { BANDS, CULTURES, CENTRE_COLOR, ringInfo, ringFor, ringSummary } from '../ringInfo.js'

const props = defineProps({
  // The element full screen should fill — the whole panel, so the chart and this legend go
  // together. Passed in because the legend does not own the panel it sits in.
  panel: { type: Object, default: null },
  groups: { type: Array, default: () => [] },
  unmatched: { type: Number, default: 0 },
  activeRing: { type: Number, default: null },
})
const emit = defineEmits(['select'])
const T = useGiT()
// formatCount, not toLocaleString(): a bare toLocaleString follows the READER'S BROWSER,
// so one page could print 2,074 here and 2.074 in the panel beside it. formatCount holds
// en-US in one place until the numerals question is ruled on.
// The `|| 0` stays: formatCount FORMATS and deliberately does not decide what empty means —
// Number(undefined) is NaN, so handing it a missing count would print "NaN" where this has
// always printed 0. The locale source changes; the empty policy does not.
const fmt = (n) => formatCount(Number(n) || 0)

const summary = computed(() => ringSummary(props.groups))
const open = ref(null)   // the ring whose explanation is expanded
const current = computed(() => props.activeRing ?? open.value)

function pick(ring) {
  const next = current.value === ring ? null : ring
  open.value = next
  emit('select', next)
}

// Literal keys, one call each, so check:i18n-keys-exist can read them (no computed key names).
const bandLabel = (b) => ({
  dialect: T('gospelInternet.rings.band.dialect', 'Same dialect'),
  language: T('gospelInternet.rings.band.language', 'Same language'),
  family: T('gospelInternet.rings.band.family', 'Same language family'),
  geography: T('gospelInternet.rings.band.geography', 'Nearby only'),
})[b]
const cultureLabel = (c) => ({
  same: T('gospelInternet.rings.culture.same', 'Same people'),
  near: T('gospelInternet.rings.culture.near', 'Near culture'),
  different: T('gospelInternet.rings.culture.different', 'Different culture'),
})[c]
const bandExplain = (b) => ({
  dialect: T('gospelInternet.rings.explain.dialect', 'A reached group speaks exactly the same language variety (the same ISO 639-3 code).'),
  language: T('gospelInternet.rings.explain.language', 'A reached group speaks another variety of the same language, e.g. Egyptian and Najdi Arabic.'),
  family: T('gospelInternet.rings.explain.family', 'The nearest shared language is only a related one, in the same language family.'),
  geography: T('gospelInternet.rings.explain.geography', 'No shared language at all: a reached group lives in the same country or within 600 km.'),
})[b]
const cultureExplain = (c) => ({
  same: T('gospelInternet.rings.explain.same', 'It is the same people, living somewhere else.'),
  near: T('gospelInternet.rings.explain.near', 'It is a different people in the same IMB people cluster.'),
  different: T('gospelInternet.rings.explain.different', 'It is a people from a different cluster.'),
})[c]

const cellName = (ring) => {
  const i = ringInfo(ring)
  return i.culture ? `${bandLabel(i.band)} · ${cultureLabel(i.culture)}` : bandLabel(i.band)
}
const detail = computed(() => {
  const r = current.value
  if (!r) return null
  const i = ringInfo(r)
  return { ring: r, info: i, name: cellName(r), band: bandExplain(i.band), culture: i.culture ? cultureExplain(i.culture) : '',
    count: summary.value.byRing[r].count, example: summary.value.byRing[r].example }
})

// A tiny target: 10 rings plus the cross, with THIS ring drawn in its colour.
const GLYPH_R = (ring) => 2.5 + ring * 1.15

useShadowStyles(
  '.grl{font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#3b463d;background:#fff;border:1px solid #d1d4cd;border-radius:10px;padding:10px;max-width:360px}' +
  '.grl-h{display:flex;align-items:center;gap:8px;margin-block-end:6px}.grl-h h3{margin:0;font-size:13px;flex:1}' +
  '.grl-fs{min-width:24px;min-height:24px;border:1px solid #d1d4cd;background:#fff;border-radius:6px;cursor:pointer;color:inherit}' +
  '.grl-intro{margin:0 0 8px;color:#6d766e}' +
  '.grl-centre{display:flex;align-items:center;gap:6px;margin-block-end:6px}' +
  '.grl-grid{display:grid;grid-template-columns:auto repeat(3,1fr);gap:3px;align-items:stretch}' +
  '.grl-col{font-size:11px;color:#6d766e;text-align:center;align-self:end}' +
  '.grl-row{font-size:11px;font-weight:600;align-self:center;padding-inline-end:4px}' +
  '.grl-cell{display:flex;flex-direction:column;align-items:center;gap:1px;min-height:44px;padding:3px;border:1px solid #e3e5e0;border-radius:6px;background:#fafaf8;cursor:pointer;color:inherit;font:inherit}' +
  '.grl-cell:hover{border-color:#92b195}.grl-cell[aria-pressed="true"]{border-color:#3b463d;box-shadow:0 0 0 2px rgba(59,70,61,.18);background:#fff}' +
  '.grl-cell .n{font-weight:600;font-variant-numeric:tabular-nums}.grl-cell .r{font-size:10px;color:#6d766e}' +
  '.grl-cell.zero .n{color:#9aa09a}' +
  '.grl-geo{grid-column:2 / span 3;flex-direction:row;justify-content:center;gap:8px}' +
  '.grl-detail{margin-block-start:8px;padding:8px;border-radius:8px;background:#f3f3f1}' +
  '.grl-detail b{display:block;margin-block-end:2px}.grl-detail p{margin:2px 0}' +
  '.grl-ex{color:#6d766e}' +
  '.grl-foot{margin-block-start:8px;color:#6d766e;font-size:11px}.grl-foot div{display:flex;justify-content:space-between;gap:8px}' +
  '.grl-src{margin-block-start:6px;font-size:10px;color:#9aa09a}',
  'gi-ring-legend',
)
</script>

<template>
  <section class="grl" :aria-label="T('gospelInternet.rings.title', 'What the rings mean')">
    <div class="grl-h">
      <h3>{{ T('gospelInternet.rings.title', 'What the rings mean') }}</h3>
      <!-- ★ THE SHARED CONTROL, NOT A GLYPH THAT EMITS. This was a hand-rolled button emitting
           `fullscreen`, and the parent never bound it — so it rendered, was focusable, was
           labelled, and did nothing. Rather than bind the emit, the button IS the shared
           FullscreenButton now: one control instead of two, and it brings the part a second
           implementation would have missed — iOS Safari does not implement requestFullscreen on
           arbitrary elements and fails silently, so the shared control carries a pseudo-fullscreen
           fallback. `panel` is the element to fill: the chart AND this legend, not one of them. -->
      <FullscreenButton :map-container="panel" />
    </div>
    <p class="grl-intro">{{ T('gospelInternet.rings.intro', 'Each unreached group sits on a ring by how close it is to its nearest reached group. The closer the ring, the more naturally the gospel can travel.') }}</p>

    <div class="grl-centre">
      <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true">
        <line x1="0" y1="-7" x2="0" y2="7" :stroke="CENTRE_COLOR" stroke-width="2.2" />
        <line x1="-5" y1="-2" x2="5" y2="-2" :stroke="CENTRE_COLOR" stroke-width="2.2" />
      </svg>
      <span>{{ T('gospelInternet.rings.centre', 'The cross: a reached group (2% or more evangelical).') }}</span>
    </div>

    <div class="grl-grid" role="group" :aria-label="T('gospelInternet.rings.title', 'What the rings mean')">
      <span></span>
      <span v-for="c in CULTURES" :key="c" class="grl-col">{{ cultureLabel(c) }}</span>
      <template v-for="b in BANDS" :key="b">
        <span class="grl-row">{{ bandLabel(b) }}</span>
        <button v-for="c in CULTURES" :key="b + c" type="button" class="grl-cell"
                :class="{ zero: !summary.byRing[ringFor(b, c)].count }"
                :aria-pressed="current === ringFor(b, c) ? 'true' : 'false'"
                :aria-label="cellName(ringFor(b, c)) + ': ' + fmt(summary.byRing[ringFor(b, c)].count)"
                @click="pick(ringFor(b, c))">
          <svg width="30" height="30" viewBox="-15 -15 30 30" aria-hidden="true">
            <circle v-for="k in 10" :key="k" cx="0" cy="0" :r="GLYPH_R(k)" fill="none"
                    :stroke="k === ringFor(b, c) ? ringInfo(k).color : '#e3e5e0'" :stroke-width="k === ringFor(b, c) ? 2.2 : 0.6" />
            <line x1="0" y1="-2.4" x2="0" y2="2.4" :stroke="CENTRE_COLOR" stroke-width="1" />
            <line x1="-1.6" y1="-0.8" x2="1.6" y2="-0.8" :stroke="CENTRE_COLOR" stroke-width="1" />
          </svg>
          <span class="n" dir="ltr">{{ fmt(summary.byRing[ringFor(b, c)].count) }}</span>
          <span class="r">{{ T('gospelInternet.rings.ring', 'Ring') }} <span dir="ltr">{{ ringFor(b, c) }}</span></span>
        </button>
      </template>
      <span class="grl-row">{{ bandLabel('geography') }}</span>
      <button type="button" class="grl-cell grl-geo" :class="{ zero: !summary.byRing[10].count }"
              :aria-pressed="current === 10 ? 'true' : 'false'"
              :aria-label="cellName(10) + ': ' + fmt(summary.byRing[10].count)" @click="pick(10)">
        <svg width="30" height="30" viewBox="-15 -15 30 30" aria-hidden="true">
          <circle v-for="k in 10" :key="k" cx="0" cy="0" :r="GLYPH_R(k)" fill="none"
                  :stroke="k === 10 ? ringInfo(10).color : '#e3e5e0'" :stroke-width="k === 10 ? 2.2 : 0.6" />
        </svg>
        <span class="n" dir="ltr">{{ fmt(summary.byRing[10].count) }}</span>
        <span class="r">{{ T('gospelInternet.rings.ring', 'Ring') }} <span dir="ltr">10</span></span>
      </button>
    </div>

    <div v-if="detail" class="grl-detail" aria-live="polite">
      <b>{{ T('gospelInternet.rings.ring', 'Ring') }} <span dir="ltr">{{ detail.ring }}</span> · {{ detail.name }}</b>
      <p>{{ detail.band }} <template v-if="detail.culture">{{ detail.culture }}</template></p>
      <p class="grl-ex" v-if="detail.example">
        {{ T('gospelInternet.rings.example', 'Example:') }} <bdi dir="ltr">{{ detail.example.label }}</bdi>.
        {{ T('gospelInternet.rings.closest', 'Closest reached group:') }} <bdi dir="ltr">{{ detail.example.neighbor }}</bdi>.
      </p>
      <p class="grl-ex" v-else>{{ T('gospelInternet.rings.none', 'No group in this view sits on this ring.') }}</p>
      <button type="button" class="grl-fs" @click="pick(detail.ring)">{{ T('gospelInternet.rings.showAll', 'Show all rings') }}</button>
    </div>

    <div class="grl-foot">
      <div><span>{{ T('gospelInternet.rings.footCentre', 'Reached, at the centre') }}</span><b dir="ltr">{{ fmt(summary.centre) }}</b></div>
      <div><span>{{ T('gospelInternet.rings.footUnplaced', 'No related reached group found, not placed') }}</span><b dir="ltr">{{ fmt(summary.unplaced) }}</b></div>
      <div><span>{{ T('gospelInternet.rings.footUnmatched', 'Not in the neighbour table, not drawn') }}</span><b dir="ltr">{{ fmt(unmatched) }}</b></div>
    </div>
    <p class="grl-src">{{ T('gospelInternet.rings.source', 'Reached = 2% or more evangelical, the IMB definition used by peoplegroups.org. Language and culture closeness are proxies from its language codes and people clusters.') }}</p>
  </section>
</template>
