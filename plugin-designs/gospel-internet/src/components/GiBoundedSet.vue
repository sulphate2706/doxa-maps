<script setup>
/**
 * GiBoundedSet.vue — the BOUNDED SET: reached groups inside the circle, unreached outside.
 *
 * The chart makes exactly one claim — which side of the line a group is on — so position
 * carries no other meaning: no gradient, no ranking, no distance. The centered-set target
 * is the chart that makes the opposite claim, and keeping them visually distinct is the
 * point of having both. Layout maths is in @map/components/charts/boundedSet.js, pure and testable without
 * mounting this.
 *
 * SVG RATHER THAN THE MAP ENGINE, which is the opposite of GiTree's call and for a reason
 * that does not contradict it. GiTree uses MapLibre because a language tree is thousands of
 * nodes that must stay readable through zoom, and SVG keeps every node in the page at every
 * zoom. This has no zoom, no labels and no camera: it is a static scatter of ~2,100 dots
 * under the default list. If it is ever pointed at the full 9,858-row table the honest fix
 * is to aggregate, not to reach for the GPU.
 *
 * ⚠ REACHED-NESS IS NOT IN THE DASHBOARD ROWS. They describe internet and language access.
 * `reached` lives in near-neighbors.json (EvangelicalLevel >= 2%, the IMB definition), so
 * this loads that table and joins on (name, iso3) — the pair measured at 994/1009. A group
 * that does not join is UNKNOWN, and is reported as unknown rather than being drawn outside
 * the circle: "we could not match it" and "it is unreached" are different facts, and only
 * one of them is about the group.
 */
import { ref, computed, onMounted } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { formatCount } from '@map/utils/formatCount.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { loadNearRows, indexFor } from '../nearRows.js'
import { layoutBoundedSet, boundedSetTally } from '@map/components/charts/boundedSet.js'
import GiBoundedSetMap from './GiBoundedSetMap.vue'

const T = useGiT()
const board = useBoardState()
const rows = ref(null)
const failed = ref('')

// The near-neighbours table, fetched once. Duplicated from upg-neighbor's nearData.js on
// purpose rather than imported across plugins: a cross-plugin import couples two bundles
// that ship separately. When the rings work is promoted to library/, this collapses into
// the promoted loader and this comment goes with it.
onMounted(async () => {
  try { rows.value = await loadNearRows(board.profileConfig?.value || {}) }
  catch (e) {
    // FAILS VISIBLY. A bounded set drawn from a table that did not load would be a circle
    // with everything outside it, which is a claim rather than an error.
    failed.value = String(e?.message || e)
  }
})

const joined = computed(() => {
  if (!rows.value) return []
  return (board.filtered?.value || []).map((g) => {
    const i = indexFor(rows.value.byKey, g)
    return { id: g.slug || g.people_group, label: g.people_group,
      reached: i < 0 ? undefined : rows.value.rows[i].reached }
  })
})

const layout = computed(() => layoutBoundedSet(joined.value, { r: 120, spread: 260 }))
const tally = computed(() => boundedSetTally(layout.value))
// formatCount, not toLocaleString(): a bare toLocaleString follows the READER'S BROWSER,
// so one page could print 2,074 here and 2.074 in the panel beside it. formatCount holds
// en-US in one place until the numerals question is ruled on.
// The `|| 0` stays: formatCount FORMATS and deliberately does not decide what empty means —
// Number(undefined) is NaN, so handing it a missing count would print "NaN" where this has
// always printed 0. The locale source changes; the empty policy does not.
const fmt = (n) => formatCount(Number(n) || 0)

useShadowStyles(
  // padding-block-start clears the centre tab strip (absolutely positioned at top:10px), which
  // was overlapping the top of the dot cloud by about 20px. overflow:hidden so a tall caption
  // can never push the figure out of its pane the way the legend did on the centered set.
  '.gbs{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;padding:46px 10px 10px;box-sizing:border-box;overflow:hidden;background:#f3f3f1}' +
  '.gbs-fig{position:relative;flex:1 1 0%;align-self:stretch;min-height:240px;min-width:0}' +
  '.gbs-ring{fill:none;stroke:#3b463d;stroke-width:1.5}' +
  '.gbs-in{fill:#92b195}.gbs-out{fill:#6d766e;opacity:.65}' +
  '.gbs-cross-halo{stroke:var(--gbs-bg,#f3f3f1);stroke-width:7;stroke-linecap:square}' +
  '.gbs-cross-ink{stroke:#3b463d;stroke-width:3;stroke-linecap:square}' +
  '.gbs-cap{margin-block-start:8px;color:#3b463d;font-size:13px;text-align:center;max-width:46ch}' +
  '.gbs-warn{color:#6d766e;font-size:12px;margin-block-start:4px}',
  'gi-bounded-set',
)
</script>

<template>
  <div class="gbs">
    <p v-if="failed" class="gbs-cap">
      {{ T('gospelInternet.bounded.failed', 'The reached/unreached table could not be loaded, so this chart is not drawn.') }}
      <span class="gbs-warn" dir="ltr">{{ failed }}</span>
    </p>
      <!-- LOADING IS NOT EMPTY. The table is 2.6 MB, and until it arrives the joined set is
           legitimately zero — so without this the panel drew a chart of nothing and captioned it
           with a confident 0. A reader cannot tell that from a real answer of none, which is the
           same defect as a join failure reported as a fact about a people. -->
      <p v-else-if="!rows" class="gbs-cap" aria-live="polite">
        {{ T('gospelInternet.loadingTable', 'Loading the table…') }}
      </p>
    <template v-else-if="rows">
      <!-- The whiteboard map replaces the static figure: the reader can pan and zoom, and group
           names appear once they are close enough for the names to be readable. The chart still
           claims one thing — which side of the line a group is on — so nothing here encodes
           distance or rank. The PRINTED component stays SVG; paper has no zoom. -->
      <div class="gbs-fig"><GiBoundedSetMap :groups="joined" /></div>
      <p class="gbs-cap">
        {{ T('gospelInternet.bounded.caption', 'Inside the circle: reached. Outside: unreached.') }}
        <b dir="ltr">{{ fmt(tally.inside) }} / {{ fmt(tally.outside) }}</b>
      </p>
      <p v-if="tally.unknown" class="gbs-warn">
        {{ T('gospelInternet.bounded.unknown', 'Not drawn, because their reached status did not match this table:') }}
        <b dir="ltr">{{ fmt(tally.unknown) }}</b>
      </p>
    </template>
  </div>
</template>
