<script setup>
/**
 * GiCenteredSet.vue — the CENTERED-SET TARGET. The cross at the middle, every unreached
 * group placed on a ring by its closeness to a REACHED neighbour, arrows pointing inward.
 *
 * The opposite claim from the bounded set: there the only fact is which side of a line a
 * group is on, here there is no line and the whole content is distance.
 *
 * THE RINGS ARE READ, NOT DERIVED. `ring` and `ringNb` are columns on near-neighbors.json,
 * computed by the upg-neighbor build. This plugin does not recompute them even though it
 * could: the ring rule encodes a contested judgement — whether "dialect" means an ISO code
 * or an Ethnologue-strict level — that belongs to the data owner. Two implementations would
 * not error, they would quietly disagree, and the symptom would be two charts on one
 * dashboard showing different centres.
 *
 * FOUR OUTCOMES, REPORTED AS FOUR. Placed (1-10), the centre (ring 0, reached), no relation
 * found (ring -1), and not in the source at all — which this component counts at the join,
 * because a table cannot carry a row it does not have. They are shown separately because
 * folding any of them together turns a gap in our knowledge into a claim about a people.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { formatCount } from '@map/utils/formatCount.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { loadNearRows, indexFor } from '../nearRows.js'
import { layoutCenteredSet, ringTally, inwardArrow, ringRadii } from '@map/components/charts/centeredSet.js'
import GiRingLegend from './GiRingLegend.vue'
import GiCenteredSetMap from './GiCenteredSetMap.vue'
import FullscreenButton from '@map/components/map-controls/FullscreenButton.vue'
import { NARROW_MAX } from '../breakpoints.js'

const T = useGiT()
const board = useBoardState()
const near = ref(null)
// Which ring the reader has asked about. null = none; the chart dims the others rather than
// hiding them, because a ring with no dots left would read as a ring with no groups.
const activeRing = ref(null)
// ★ ON A NARROW PANE THE TARGET IS THE MAIN VIEW. Side by side there is room for both, but
// stacked the decoder is a tall card that pushes the chart off the screen — the reader asked to
// see the target and got a glossary. So below the breakpoint the legend starts CLOSED behind a
// toggle. It is not hidden: the control names it, and opening is one tap.
const narrow = ref(false)
// ★ STARTS CLOSED, LIKE THE MAP'S AND THE TREE'S. This was `ref(true)`, so the centered set was the
// one view whose decoder covered the drawing before the reader had asked for it — and on the chart
// where seeing the target matters most. GiMap and GiTree already read the same profile-config knob
// (`legend: 'open'`) and default closed, so this was the odd one out rather than a considered
// difference. A host that wants it open says so; the reader opens it with one tap; and `chosen`
// below still protects whichever they pick from being undone by a resize.
const legendOpen = ref(board.profileConfig.value?.legend === 'open')
let mq = null
// ★ A DELIBERATE CHOICE SURVIVES A RESIZE. The first version of this set legendOpen from the
// breakpoint on EVERY width change, so a reader who opened the decoder on a phone lost it on
// rotation, and one who closed it on desktop had it reopened by dragging the window. The resize
// would be undoing their decision rather than responding to it.
// This is the same defect I had already fixed in the other plugin's legend today and then wrote
// again here, because the two legends are separate implementations of one control. That is the
// case for promoting the control rather than a reason to be more careful.
let chosen = null                                     // null = the reader has not decided yet
function applyWidth(m) {
  narrow.value = m.matches
  // ★ WIDTH NO LONGER OPENS THE LEGEND, IT ONLY CLOSES IT. This read `!m.matches`, so on mount at a
  // desktop width it set legendOpen back to TRUE and the closed default above was dead on arrival —
  // changing the ref alone would have looked right in review and shipped nothing. A wide window is
  // not a request to cover the chart; it is only the absence of the reason to force the legend shut.
  // So: narrow still closes it, wide leaves whatever the default or the host asked for, and `chosen`
  // still wins outright once the reader has decided.
  if (chosen != null) { legendOpen.value = chosen; return }
  if (m.matches) legendOpen.value = false
}
function setLegendOpen(v) { chosen = v; legendOpen.value = v }
onMounted(() => {
  try {
    // The same width the BOARD collapses at (NARROW_MAX). If these two ever disagree again,
    // the board keeps its side panels while the chart has already given up on room — which is
    // exactly the 768px failure.
    mq = window.matchMedia(`(max-width: ${NARROW_MAX - 1}px)`)
    applyWidth(mq)
    mq.addEventListener?.('change', applyWidth)
  } catch (_) { /* no matchMedia: stay wide, which is the layout that always fits */ }
})
onBeforeUnmount(() => { try { mq?.removeEventListener?.('change', applyWidth) } catch (_) {} })
// The panel element, so full screen shows the chart AND its legend rather than one of them.
const panelEl = ref(null)

const failed = ref('')

onMounted(async () => {
  try { near.value = await loadNearRows(board.profileConfig?.value || {}) }
  catch (e) { failed.value = String(e?.message || e) }
})

// Unmatched groups never become a ring. A join miss is a fact about our data, not about
// the group, so it is counted here and captioned rather than drawn at the outer edge.
const prepared = computed(() => {
  if (!near.value) return { groups: [], unmatched: 0 }
  let unmatched = 0
  const groups = []
  for (const g of board.filtered?.value || []) {
    const i = indexFor(near.value.byKey, g)
    if (i < 0) { unmatched++; continue }
    const r = near.value.rows[i]
    const nb = r.ringNb >= 0 ? near.value.rows[r.ringNb] : null
    groups.push({ id: g.slug || g.people_group, label: g.people_group, ring: r.ring,
      neighborId: nb ? nb.name : null })
  }
  return { groups, unmatched }
})

const layout = computed(() => layoutCenteredSet(prepared.value.groups, { innerR: 30, ringGap: 22 }))
const tally = computed(() => ringTally(layout.value))
// ★ COUNTED FROM THE LAYOUT, NOT FROM WHAT IS DRAWN. layout.placed is every group that HAS a ring,
// which is a fact about the data; the number of pins actually rendered depends on the fill mode and,
// in the dense mode, reads differently at different zooms. Captioning the drawn count would give a
// total that changes as the reader zooms — true at every instant and misleading overall.
const placedTotal = computed(() => layout.value.placed.length)
const radii = computed(() => ringRadii({ innerR: 30, ringGap: 22 }))
// The arrow carries its group's ring so the dimming can tell them apart. inwardArrow returns
// geometry and the neighbour it names, not the ring — reading a.ring off it would have been
// undefined for every arrow, and `undefined !== activeRing` is true, so selecting any ring
// would have dimmed EVERY arrow rather than all but one. Attached here, where the group is
// still in hand, instead of widening the shared module regions is promoting to library.
const arrows = computed(() => layout.value.placed
  .map((p) => { const a = inwardArrow(p, { innerR: 30 }); return a && { ...a, ring: p.ring } })
  .filter(Boolean).slice(0, 400))
// formatCount, not toLocaleString(): a bare toLocaleString follows the READER'S BROWSER,
// so one page could print 2,074 here and 2.074 in the panel beside it. formatCount holds
// en-US in one place until the numerals question is ruled on.
// The `|| 0` stays: formatCount FORMATS and deliberately does not decide what empty means —
// Number(undefined) is NaN, so handing it a missing count would print "NaN" where this has
// always printed 0. The locale source changes; the empty policy does not.
const fmt = (n) => formatCount(Number(n) || 0)

useShadowStyles(
  // ROW, NOT COLUMN, and overflow hidden. Stacked in a centred column the legend — a 360px card
  // with a 3x3 grid of 44px cells and four footer lines — is taller than the pane on its own, so
  // the chart was pushed out of view entirely and the whole panel overflowed its host: it showed
  // the legend covering the row below and the caption drawn over the page tabs.
  // Every child gets min-height/min-width 0, because a flex item's default minimum is its CONTENT
  // size — without it an item never shrinks below its natural height and the container overflows
  // however little room it has.
  // padding-block-start clears the centre tab strip, which is absolutely positioned at top:10px
  // and was covering the top of both charts.
  '.gcs{position:absolute;inset:0;display:flex;flex-direction:row;align-items:stretch;gap:10px;' +
    'padding:46px 10px 10px;box-sizing:border-box;overflow:hidden;background:#f3f3f1}' +
  // position:relative, because the map inside is position:absolute;inset:0 and would otherwise
  // resolve against the PANEL — covering the legend beside it. The bounded set's figure already
  // had this; the centered one did not, which is the kind of difference two files drift into
  // when the same rule is written twice.
  // min-height in the narrow column: a flex child with auto content can resolve to zero height,
  // which is what a 0x0 chart is, as measured at 390px.
    // flex-basis 0, not auto. The map inside is position:absolute, so the figure has NO intrinsic
  // width to be sized from — with basis auto it asks for its content, the content is nothing, and
  // the legend beside it takes the column. The figure measured 39px across while the
  // decoder card had the rest. Growing from zero makes the figure take the remaining space
  // whatever it happens to contain.
  // min-width is a FLOOR, not 0. The shipped CSS was right and the figure was still 39px wide:
  // flex:1 1 0% lets it GROW from nothing, but min-width:0 also lets it be CRUSHED to nothing,
  // and the decoder card's own content width wins that contest. The figure now refuses to go
  // below a usable size and the card shrinks or scrolls instead — the chart is the main view.
  '.gcs-fig{position:relative;flex:1 1 0%;align-self:stretch;min-width:280px;min-height:240px;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}' +
  '.gcs-aside{flex:0 1 340px;min-width:0;min-height:0;overflow:auto;display:flex;align-items:flex-start}' +
  '.gcs-aside .grl{min-width:0}' +
  '.gcs-legend-toggle{width:100%;padding:6px 10px;border:1px solid #d1d4cd;border-radius:8px;' +
    'background:#fff;color:#3b463d;font:inherit;font-size:12.5px;cursor:pointer;text-align:start}' +
  '@media (max-width:900px){.gcs{flex-direction:column;overflow:auto}' +
    '.gcs-aside{overflow:visible;align-self:stretch;flex:0 0 auto;flex-direction:column;gap:6px}' +
    '.gcs-aside.collapsed{max-height:44px}}' +
  '.gcs svg{max-width:100%;max-height:100%}' +
  '.gcs-ring{fill:none;stroke:#d1d4cd;stroke-width:1}' +
  '.gcs-arrow{stroke:#92b195;stroke-width:.6;opacity:.5}' +
  '.gcs-dim{opacity:.12}' +
  '.gcs-dot{fill:#6d766e}.gcs-cross{stroke:#3b463d;stroke-width:3;stroke-linecap:square}' +
  '.gcs-cap{margin-block-start:8px;color:#3b463d;font-size:13px;text-align:center;max-width:52ch}' +
  '.gcs-warn{color:#6d766e;font-size:12px;margin-block-start:4px;max-width:52ch;text-align:center}',
  'gi-centered-set',
)
</script>

<template>
  <div class="gcs" ref="panelEl">
    <p v-if="failed" class="gcs-cap">
      {{ T('gospelInternet.centered.failed', 'The neighbour table could not be loaded, so this chart is not drawn.') }}
      <span class="gcs-warn" dir="ltr">{{ failed }}</span>
    </p>
      <!-- LOADING IS NOT EMPTY. The table is 2.6 MB, and until it arrives the joined set is
           legitimately zero — so without this the panel drew a chart of nothing and captioned it
           with a confident 0. A reader cannot tell that from a real answer of none, which is the
           same defect as a join failure reported as a fact about a people. -->
      <p v-else-if="!near" class="gcs-cap" aria-live="polite">
        {{ T('gospelInternet.loadingTable', 'Loading the table…') }}
      </p>
    <template v-else-if="near">
      <div class="gcs-fig">
        <!-- The figure is the whiteboard map, not SVG: pan, zoom and labels are required
             that appear as you zoom in, and the engine gives tiling and label collision that an
             SVG version would have to reimplement. The PRINTED component stays SVG — a sheet has
             no zoom and no hover, so the two media genuinely want different renderers. -->
        <GiCenteredSetMap :groups="prepared.groups" :active-ring="activeRing"
                          @select="activeRing = $event" />
      </div>
      <div class="gcs-aside" :class="{ collapsed: narrow && !legendOpen }">
        <button v-if="narrow" type="button" class="gcs-legend-toggle"
                :aria-expanded="String(legendOpen)" @click="setLegendOpen(!legendOpen)">
          <!-- Existing keys only. A new "hide" string would have meant a new catalogue entry in
               eleven locales, owned by another tab, landing in another batch — a cross-owner
               dependency bought for one word. aria.collapseLegend already exists everywhere and
               says exactly this, and rings.title is the panel's own name. -->
          {{ legendOpen ? T('aria.collapseLegend', 'Collapse legend')
                        : T('gospelInternet.rings.title', 'What the rings mean') }}
        </button>
        <!-- ★ @fullscreen WAS NOT BOUND. The legend declares emits ['select','fullscreen'] and
             renders a labelled, focusable full-screen button; only select was wired, so the
             button rendered, looked right and did nothing. It is a required behaviour, and it is the
             half-wired-config shape: the visible half worked, so nothing looked broken.
             The handler delegates to the SHARED fullscreen implementation rather than calling
             requestFullscreen here. That is not ceremony: iOS Safari does not implement
             requestFullscreen on arbitrary elements and silently fails, so the shared control
             carries a pseudo-fullscreen fallback that a second implementation would omit — and
             would omit invisibly, on the one platform hardest to test. -->
        <GiRingLegend v-show="!narrow || legendOpen" :groups="prepared.groups" :unmatched="prepared.unmatched"
                      :active-ring="activeRing" :panel="panelEl" @select="activeRing = $event"
                      />
      </div>
      <!-- ★ THE POSITIVE TOTAL COMES FIRST, and it is the TRUE one, not a count of what happens to be
           drawn at this zoom. In the dense mode the same groups render as an arc of colour when zoomed
           out and as separate pins when zoomed in; a caption derived from what is currently visible
           would change as the reader moved, which is exactly the way a chart misleads without ever
           being wrong. The three clauses after it account for every group NOT on a ring, so the
           paragraph reads as one reconciliation rather than four unrelated numbers. -->
      <p v-if="placedTotal || tally.centre || tally.unplaced || prepared.unmatched" class="gcs-warn">
        <span v-if="placedTotal">{{ T('gospelInternet.centered.shown', 'People groups on the rings:') }} <b dir="ltr">{{ fmt(placedTotal) }}</b>. </span>
        <span v-if="tally.centre">{{ T('gospelInternet.centered.reached', 'Already reached, so at the centre:') }} <b dir="ltr">{{ fmt(tally.centre) }}</b>. </span>
        <span v-if="tally.unplaced">{{ T('gospelInternet.centered.unplaced', 'No relation found, so not placed:') }} <b dir="ltr">{{ fmt(tally.unplaced) }}</b>. </span>
        <span v-if="prepared.unmatched">{{ T('gospelInternet.centered.unmatched', 'Not in the neighbour table at all, so not drawn:') }} <b dir="ltr">{{ fmt(prepared.unmatched) }}</b>.</span>
      </p>
    </template>
  </div>
</template>
