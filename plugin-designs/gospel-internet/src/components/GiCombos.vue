<script setup>
/**
 * GiCombos.vue — the strip under the title: WHAT IS SELECTED (the kit's DashboardFilterChips, each
 * chip removable) and a row of COMBINATIONS worth running, each with its live count.
 *
 * A combination is just a set of facet values on the one bus, so it drives every panel at once: the
 * map, the language tree, the charts, both tables and the CSV. The counts are computed with the bus's
 * own predicate over the rows of the current list, so a combination never promises groups it will not
 * show. They are the mobiliser's questions, answered by the data we hold:
 *   - where a digital approach could work now (nothing in their language, a country mostly online);
 *   - where audio and film can travel online (they hear but cannot read, and the country is online);
 *   - where it must go another way (nothing in their language, and the country mostly offline);
 *   - which channel would carry it (nothing in their language, in a WhatsApp or Telegram country);
 *   - where a Deaf bridge exists; the two countries that hold half the roster.
 */
import { computed, provide } from 'vue'
import { createSelectionBus } from '@map/composables/useSelectionBus.js'
import DashboardFilterChips from '@map/components/dashboards/DashboardFilterChips.vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { formatList } from '@map/i18n/index.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { filterRows, label, FACET_RAIL } from '../model.js'

const T = useGiT()
const board = useBoardState()
const { bus } = board
const fmt = (n) => (Number(n) || 0).toLocaleString()

// ── the kit's chips, fed through the kit's two inject keys (SPEC-DASHBOARD-KIT 5.1) ─────────────────
const names = computed(() => {
  const country = {}, language = {}
  for (const r of board.all.value) { country[r.iso3] = r.country; language[r.iso639_3] = r.language }
  return { country, language }
})
const CODED = { access_level: 'level', access_detail: 'detail', band: 'band', way_in: 'wayIn' }
function labelOne(key, v) {
  if (CODED[key]) return label(T, CODED[key], v)
  if (key === 'country') return names.value.country[v] || v
  if (key === 'language') return names.value.language[v] || v
  return v
}
function labelFor(key, value) {
  // a tree node narrows by its language codes: name the node, not a list of 120 codes
  if (key === 'language' && board.treeNode.value && board.tree.value) {
    const n = board.tree.value.byId.get(board.treeNode.value)
    if (n) return n.n
  }
  // DISJUNCTION, from the matcher rather than from what reads better: useSelectionBus.js:299 tests
  // `cur.includes(value)` and toggleFilterValue ADDS to the list, so two values on one facet WIDEN the
  // result set. "Africa and Asia" would claim the opposite of what the filter does — and a chip saying
  // ALL while the data shows ANY is worse than a comma, because a comma is merely ambiguous where
  // "and" is confidently wrong.
  return formatList([].concat(value).map((v) => labelOne(key, v)), { type: 'disjunction' })
}
provide('selectionBus', bus)
// ★ THE FACET LABELS ARE A COMPUTED, NOT A LITERAL. Evaluated once inside provide() they froze in
// the boot language: T() runs at setup, the object is handed to the consumer, and a live switch to
// Arabic left every facet name in English. check:frozen-labels cannot see this — the call sites ARE
// keyed and the keys DO resolve; what is wrong is WHEN they were read. A computed re-evaluates when
// the locale ref changes, so the same keys now follow the reader.
const facets = computed(() => ({
    access_level: { label: T('gospelInternet.facet.access', 'Access in their own language') },
    access_detail: { label: T('gospelInternet.col.access', 'In own language') },
    band: { label: T('gospelInternet.facet.band', 'Country internet use') },
    region: { label: T('gospelInternet.facet.region', 'Region') },
    country: { label: T('gospelInternet.facet.country', 'Country') },
    province: { label: T('gospelInternet.facet.province', 'India and China: state or province') },
    language: { label: T('gospelInternet.facet.language', 'Language') },
    religion: { label: T('gospelInternet.facet.religion', 'Religion') },
    way_in: { label: T('gospelInternet.facet.wayIn', 'Way in when nothing is in their language') },
    messaging: { label: T('gospelInternet.facet.messaging', 'Top messaging app (country)') },
}))
provide('dashboardConfig', {
  // A getter, so a consumer reading .facets re-reads the computed rather than a snapshot of it.
  get facets() { return facets.value },
  facetRail: FACET_RAIL,
  legend: { labelFor },
})

// ── the combinations ────────────────────────────────────────────────────────────────────────────────
const COMBOS = computed(() => [
  { id: 'digital-now', label: T('gospelInternet.combos.digitalNow', 'Nothing in their language, country 60%+ online'), filters: { access_detail: 'none', band: 'yes' } },
  { id: 'audio-online', label: T('gospelInternet.combos.audioOnline', 'Hear but cannot read, country online'), filters: { access_detail: 'hear', band: ['yes', 'partial'] } },
  { id: 'offline-gap', label: T('gospelInternet.combos.offlineGap', 'Nothing in their language, country mostly offline'), filters: { access_detail: 'none', band: ['no', 'nodata'] } },
  { id: 'whatsapp', label: T('gospelInternet.combos.whatsapp', 'Nothing in their language, WhatsApp country'), filters: { access_detail: 'none', messaging: ['WhatsApp Messenger', 'WhatsApp Business'] } },
  { id: 'telegram', label: T('gospelInternet.combos.telegram', 'Nothing in their language, Telegram country'), filters: { access_detail: 'none', messaging: 'Telegram Messenger' } },
  { id: 'deaf', label: T('gospelInternet.combos.deaf', 'A Deaf bridge exists'), filters: { way_in: 'deaf' } },
  { id: 'india-china-gap', label: T('gospelInternet.combos.indiaChinaGap', 'India and China: nothing in their language'), filters: { country: ['IND', 'CHN'], access_detail: 'none' } },
])
// live counts, over the rows of the current list, with a scratch bus (the board's own is not touched)
const counts = computed(() => {
  const out = {}
  const rows = board.all.value
  for (const c of COMBOS.value) {
    const b = createSelectionBus()
    for (const [k, v] of Object.entries(c.filters)) b.setFilter(k, v)
    out[c.id] = filterRows(rows, b).length
  }
  return out
})
const same = (a, b) => JSON.stringify([].concat(a ?? []).slice().sort()) === JSON.stringify([].concat(b ?? []).slice().sort())
const activeCombo = computed(() => {
  const keys = Object.keys(bus.filterSet)
  return COMBOS.value.find((c) => keys.length === Object.keys(c.filters).length
    && Object.entries(c.filters).every(([k, v]) => same(bus.filterSet[k], v)))?.id || ''
})
function run(c) {
  if (activeCombo.value === c.id) { bus.clearFilters(); return }
  bus.clearFilters()
  for (const [k, v] of Object.entries(c.filters)) bus.setFilter(k, v)
}
const scoped = computed(() => Object.keys(bus.filterSet).length > 0)

useShadowStyles(
  '.gic2{grid-area:combos;display:flex;align-items:center;gap:10px;padding:6px 14px;background:#fff;border-bottom:1px solid #d1d4cd;' +
  'min-width:0;font:12.5px/1.3 Roboto,-apple-system,"Segoe UI",sans-serif;color:#3b463d}' +
  '.gic2-h{flex:none;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#6d766e}' +
  // The selection side is BOUNDED at 40% (the placeholder ran under "Try a combination"), but only
  // its chips and placeholder clip: they scroll or ellipsize. No overflow here and no min-width:0, so the
  // flex:none label sets the minimum width and is never cut ('YOUR S…' at 390, the zh/ru/hi/ar labels at 1280).
  '.gic2-sel{display:flex;align-items:center;gap:6px;flex:0 1 auto;max-width:40%}' +
  '.gic2-none{color:#9aa19b;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}' +
  '.gic2-try{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 auto;overflow-x:auto;scrollbar-width:thin}' +
  '.gic2-c{flex:none;display:inline-flex;align-items:center;gap:6px;border:1px solid #d1d4cd;background:#f3f3f1;color:#3b463d;border-radius:999px;' +
  'padding:3px 10px;min-height:26px;font:inherit;cursor:pointer;white-space:nowrap}' +
  '.gic2-c:hover{border-color:#92b195}' +
  '.gic2-c[aria-pressed="true"]{background:#3b463d;border-color:#3b463d;color:#fff}' +
  '.gic2-c:focus-visible{outline:2px solid #92b195;outline-offset:1px}' +
  '.gic2-n{font-variant-numeric:tabular-nums;font-weight:700}' +
  '.gic2-c[disabled]{opacity:.45;cursor:default}',
  'gi-combos',
)
</script>

<template>
  <div class="gic2" data-region="combos">
    <div class="gic2-sel">
      <span class="gic2-h">{{ T('gospelInternet.combos.selection', 'Your selection') }}</span>
      <DashboardFilterChips v-if="scoped" />
      <span v-else class="gic2-none" :title="T('gospelInternet.combos.none', 'Everything — pick a filter or a combination')">{{ T('gospelInternet.combos.none', 'Everything — pick a filter or a combination') }}</span>
    </div>
    <div class="gic2-try" role="group" :aria-label="T('gospelInternet.combos.try', 'Try a combination')">
      <span class="gic2-h">{{ T('gospelInternet.combos.try', 'Try a combination') }}</span>
      <button v-for="c in COMBOS" :key="c.id" type="button" class="gic2-c" :data-combo="c.id"
              :aria-pressed="activeCombo === c.id ? 'true' : 'false'" :disabled="!counts[c.id]"
              @click="run(c)">
        <span>{{ c.label }}</span><span class="gic2-n">{{ fmt(counts[c.id]) }}</span>
      </button>
    </div>
  </div>
</template>
