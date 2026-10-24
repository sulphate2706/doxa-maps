<script setup>
/**
 * GiCharts.vue — the right rail: FOUR charts, each answering one plain question about the groups shown,
 * chosen to show a newcomer the GAPS they would not otherwise see (2026-09-27: a reader can't
 * tell what they're saying"; "showcase the gaps ... the biggest, most helpful, clearest data"). Each
 * carries its question as the title, says what one bar is and what it counts, and ends in a one-line
 * takeaway computed from the same rows.
 *   1. What do they have in their own language?        one bar per level of access
 *   2. The largest people groups with nothing           the 8 biggest gaps, by name (click opens one)
 *   3. Could the internet carry it to those with nothing?  by how much of their country is online
 *   4. Which languages most need the New Testament?     languages with none found, by people who speak them
 * Dropped: a stacked access x band chart (five colours on four bars, no readable answer), a social
 * platform chart and a messaging-app chart (channels, not gaps: the facets and drawer carry them).
 * They follow the facets like every panel; a bar is a filter (click to narrow the board to it).
 */
import { ref, computed, onMounted } from 'vue'
import BarChart from '@map/components/charts/BarChart.vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { ACCESS_DETAILS, BANDS, DETAIL_FILL, BAND_COLOR, TREE_COLOR, label } from '../model.js'

const T = useGiT()
const board = useBoardState()
const { bus } = board
const measure = ref('groups')
const fmt = (v) => (Number(v) || 0).toLocaleString()
const count = (rs) => measure.value === 'people' ? rs.reduce((s, r) => s + (Number(r.population) || 0), 0) : rs.length
const unit = computed(() => measure.value === 'people' ? T('gospelInternet.charts.unitPeople', 'people') : T('gospelInternet.charts.unitGroups', 'people groups'))
const rows = computed(() => board.filtered.value)

// 1 ─ what they have in their own language
const SEG_COLOR = { ...DETAIL_FILL, none: '#7d3b30' }         // a white bar would vanish on white
const q1 = computed(() => ACCESS_DETAILS.map((d) => {
  const rs = rows.value.filter((r) => r.access_detail === d)
  return { label: label(T, 'detail', d), value: count(rs), color: SEG_COLOR[d], meta: { key: 'access_detail', value: d } }
}))
const q1take = computed(() => {
  const none = rows.value.filter((r) => r.access_detail === 'none').length
  return T('gospelInternet.charts.q1take', '{n} of {total} people groups shown have nothing found in their own language.', { n: fmt(none), total: fmt(rows.value.length) })
})

// 2 ─ could the internet carry it to those with nothing?
const zero = computed(() => rows.value.filter((r) => r.access_detail === 'none'))
const q2 = computed(() => BANDS.map((b) => {
  const rs = zero.value.filter((r) => r.internet_band === b)
  return { label: label(T, 'band', b), value: count(rs), color: BAND_COLOR[b], meta: { key: 'band', value: b } }
}))
const q2take = computed(() => {
  const online = zero.value.filter((r) => r.internet_band === 'yes').length
  return T('gospelInternet.charts.q2take', '{online} of the {n} with nothing live in countries where 60% or more use the internet.', { online: fmt(online), n: fmt(zero.value.length) })
})

// 2 ─ the largest people groups with nothing in their own language: the biggest gaps, by name
const TOP = 8
const gaps = computed(() => [...zero.value].sort((a, b) => (Number(b.population) || 0) - (Number(a.population) || 0)).slice(0, TOP))
const gapSeries = computed(() => gaps.value.map((r) => ({ label: `${r.people_group} (${r.iso3})`, value: Number(r.population) || 0, color: SEG_COLOR.none, meta: { open: r.slug } })))
const gapTake = computed(() => T('gospelInternet.charts.gapTake', 'These {k} alone are {people} people.', { k: fmt(gaps.value.length), people: fmt(gaps.value.reduce((s, r) => s + (Number(r.population) || 0), 0)) }))

// 4 ─ which languages most need the New Testament? (status per language comes from the language tree)
onMounted(() => { board.loadTree().catch(() => {}) })
const ntNeed = computed(() => {
  const ix = board.tree.value
  if (!ix) return []
  const by = new Map()
  for (const r of rows.value) {
    const node = ix.byId.get(ix.nodeOfIso.get(r.iso639_3))
    if (!node || node.st === 'g') continue
    const e = by.get(r.iso639_3) || { iso: r.iso639_3, name: r.language, st: node.st, people: 0 }
    e.people += Number(r.population) || 0
    by.set(r.iso639_3, e)
  }
  return [...by.values()].sort((a, b) => b.people - a.people)
})
const ntSeries = computed(() => ntNeed.value.slice(0, TOP).map((e) => ({ label: `${e.name} (${e.iso})`, value: e.people, color: TREE_COLOR[e.st], meta: { key: 'language', value: e.iso } })))
const ntTake = computed(() => T('gospelInternet.charts.ntTake', '{n} languages here have no New Testament found, spoken by {people} people.', { n: fmt(ntNeed.value.length), people: fmt(ntNeed.value.reduce((s, e) => s + e.people, 0)) }))

function onBar(row) {
  const m = row && row.meta
  if (!m) return
  if (m.open) board.openGroup(m.open)
  else bus.toggleFilterValue(m.key, m.value)
}

useShadowStyles(
  '.gic{display:flex;flex-direction:column;gap:4px;height:100%;overflow-y:auto;box-sizing:border-box;padding:10px 12px 16px;background:#fff;color:#3b463d;font:13px/1.35 Roboto,-apple-system,"Segoe UI",sans-serif;scrollbar-width:thin}' +
  // A flex column's children SHRINK by default: inside this scroll box they were squeezed instead of
  // scrolled, so the measure toggle collapsed to a 2px line and a caveat card was cut in half.
  '.gic > *{flex-shrink:0}' +
  '.gic-seg{align-self:flex-start;display:inline-flex;border:1px solid #d1d4cd;border-radius:6px;overflow:hidden;margin-bottom:4px}' +
  '.gic-seg button{font:inherit;font-size:12px;padding:4px 12px;min-height:26px;border:0;background:#fff;color:#3b463d;cursor:pointer}' +
  '.gic-seg button[aria-pressed="true"]{background:#3b463d;color:#fff}' +
  '.gic-seg button:focus-visible{outline:2px solid #92b195;outline-offset:-2px}' +
  '.gic-card{border-bottom:1px solid #e6e8e3;padding:4px 0 12px}' +
  '.gic-take{margin:4px 0 0;font-size:12.5px;font-weight:600;color:#3b463d}',
  'gi-charts',
)
</script>

<template>
  <aside class="gic" data-region="charts" :aria-label="T('gospelInternet.charts.aria', 'Charts')">
    <div class="gic-seg" role="group" :aria-label="T('gospelInternet.charts.measure', 'Count')">
      <button type="button" :aria-pressed="measure === 'groups'" @click="measure = 'groups'">{{ T('gospelInternet.charts.groups', 'Groups') }}</button>
      <button type="button" :aria-pressed="measure === 'people'" @click="measure = 'people'">{{ T('gospelInternet.charts.people', 'People') }}</button>
    </div>
    <div class="gic-card" data-chart="q1">
      <BarChart :series="q1" :unit="unit" :bar-height="18" :gap="6" :label-width="130"
                :title="T('gospelInternet.charts.q1title', 'What do they have in their own language?')"
                :subtitle="T('gospelInternet.charts.q1sub', 'One bar per level of access, for the people groups shown.')"
                :empty-text="T('gospelInternet.grid.empty', 'No people groups match these filters.')" @bar-click="onBar" />
      <p class="gic-take">{{ q1take }}</p>
    </div>
    <div class="gic-card" data-chart="gaps">
      <BarChart :series="gapSeries" :unit="T('gospelInternet.charts.unitPeople', 'people')" :bar-height="18" :gap="6" :label-width="130"
                :title="T('gospelInternet.charts.gapTitle', 'The largest people groups with nothing in their own language')"
                :subtitle="T('gospelInternet.charts.gapSub', 'The 8 biggest of those shown, by population. Click one to open it.')"
                :empty-text="T('gospelInternet.grid.empty', 'No people groups match these filters.')" @bar-click="onBar" />
      <p v-if="gaps.length" class="gic-take">{{ gapTake }}</p>
    </div>
    <div class="gic-card" data-chart="q2">
      <BarChart :series="q2" :unit="unit" :bar-height="18" :gap="6" :label-width="130"
                :title="T('gospelInternet.charts.q2title', 'Could the internet carry it to those with nothing?')"
                :subtitle="T('gospelInternet.charts.q2sub', 'People groups with nothing in their own language, by how much of their country is online.')"
                :caveats="[T('gospelInternet.charts.bandCaveat', 'Internet use is the country\'s figure (World Bank), never the group\'s.')]"
                :empty-text="T('gospelInternet.grid.empty', 'No people groups match these filters.')" @bar-click="onBar" />
      <p v-if="zero.length" class="gic-take">{{ q2take }}</p>
    </div>
    <div class="gic-card" data-chart="ntNeed">
      <BarChart :series="ntSeries" :unit="T('gospelInternet.charts.unitPeople', 'people')" :bar-height="18" :gap="6" :label-width="130"
                :title="T('gospelInternet.charts.ntTitle', 'Which languages most need the New Testament?')"
                :subtitle="T('gospelInternet.charts.ntSub', 'Languages of the groups shown with no New Testament found, by how many people speak them. Red: nothing at all; yellow: something, but no New Testament.')"
                :empty-text="T('grid.loading', 'Loading…')" @bar-click="onBar" />
      <p v-if="ntNeed.length" class="gic-take">{{ ntTake }}</p>
    </div>
  </aside>
</template>
