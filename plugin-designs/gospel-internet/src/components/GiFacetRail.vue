<script setup>
/**
 * GiFacetRail.vue — the left rail: every facet with its counts UNDER THE OTHER FACETS.
 *
 * ★ GLUE, NOT THE KIT'S RAIL. This board's facet rail is meant to come from the kit; it is not to be
 * re-implemented here. The kit's rail is landing 4 (simpleresearch moved it forward for this board);
 * until it reaches main this is the thinnest rail that honours its contract, and it is deleted the day
 * the kit's lands:
 *   - every write is bus.toggleFilterValue / setFilter (multi-value OR-within-key, D1; clearing cascades);
 *   - every count is model.facetCounts, which is the bus's own rowMatchesFilters with this facet's key
 *     left out — so the number beside an option IS the number of rows the map and grid show after the
 *     click (the "five numbers agree" invariant), not a second computation that could drift;
 *   - values are CODES; the label is looked up for display only.
 */
import { ref, computed } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { facetCounts, ACCESS_LEVELS, ACCESS_DETAILS, BANDS, DETAIL_FILL, DETAIL_RIM, BAND_COLOR, LEVEL_COLOR, label } from '../model.js'

const T = useGiT()
const board = useBoardState()
const { bus } = board

const LONG = 8          // long facets show their top N until expanded
const expanded = ref({})
const find = ref({ country: '', language: '' })

// Re-derive on any filter/search/data change. facetCounts reads filterSet through the bus predicate.
const tick = computed(() => { for (const k of Object.keys(bus.filterSet)) void bus.filterSet[k]; return [board.all.value, bus.searchTerm.value] })
const counts = (key, opts) => { void tick.value; return facetCounts(board.all.value, bus, key, { term: bus.searchTerm.value, ...opts }) }

const nameOf = computed(() => {
  const country = {}, language = {}
  for (const r of board.all.value) { country[r.iso3] = r.country; language[r.iso639_3] = r.language }
  return { country, language }
})

const sections = computed(() => {
  const out = []
  out.push({ id: 'access', title: T('gospelInternet.facet.access', 'Access in their own language'), groups: [
    { key: 'access_level', rows: counts('access_level', { order: ACCESS_LEVELS }), label: (v) => label(T, 'level', v), sw: (v) => ({ background: LEVEL_COLOR[v] }) },
    { key: 'access_detail', sub: true, rows: counts('access_detail', { order: ACCESS_DETAILS }), label: (v) => label(T, 'detail', v), dot: (v) => ({ background: DETAIL_FILL[v], borderColor: DETAIL_RIM[v] }) },
  ] })
  out.push({ id: 'band', title: T('gospelInternet.facet.band', 'Country internet use'), note: T('gospelInternet.facet.bandNote', 'The country\'s figure (World Bank), never the group\'s.'), groups: [
    { key: 'band', rows: counts('band', { order: BANDS }), label: (v) => label(T, 'band', v), sw: (v) => ({ background: BAND_COLOR[v] }) },
  ] })
  out.push({ id: 'way_in', title: T('gospelInternet.facet.wayIn', 'Way in when nothing is in their language'), groups: [
    { key: 'way_in', rows: counts('way_in', { order: ['bridge', 'candidate', 'deaf'] }), label: (v) => label(T, 'wayIn', v) },
  ] })
  out.push({ id: 'messaging', title: T('gospelInternet.facet.messaging', 'Top messaging app (country)'),
    note: T('gospelInternet.facet.messagingNote', 'Most downloaded in the country\'s Apple App Store: iOS only, a download rank, not use.'), long: true, groups: [
      { key: 'messaging', rows: counts('messaging'), label: (v) => v },
    ] })
  out.push({ id: 'region', title: T('gospelInternet.facet.region', 'Region'), groups: [
    { key: 'region', rows: counts('region'), label: (v) => v },
  ] })
  out.push({ id: 'country', title: T('gospelInternet.facet.country', 'Country'), find: 'country', long: true, groups: [
    { key: 'country', rows: counts('country'), label: (v) => nameOf.value.country[v] || v },
  ] })
  const prov = counts('province')
  if (prov.length) {
    out.push({ id: 'province', title: T('gospelInternet.facet.province', 'India and China: state or province'),
      note: T('gospelInternet.facet.provinceNote', 'Approximate: taken from the group\'s dot on the map, not from a town.'), long: true, groups: [
        { key: 'province', rows: prov, label: (v) => v },
      ] })
  }
  out.push({ id: 'language', title: T('gospelInternet.facet.language', 'Language'), find: 'language', long: true, groups: [
    { key: 'language', rows: counts('language'), label: (v) => `${nameOf.value.language[v] || v} (${v})` },
  ] })
  out.push({ id: 'religion', title: T('gospelInternet.facet.religion', 'Religion'), long: true, groups: [
    { key: 'religion', rows: counts('religion'), label: (v) => v },
  ] })
  return out
})

function visibleRows(sec, g) {
  let rows = g.rows
  const q = sec.find ? find.value[sec.find].trim().toLowerCase() : ''
  if (q) rows = rows.filter((r) => g.label(r.value).toLowerCase().includes(q) || String(r.value).toLowerCase() === q)
  // A picked value always shows, even past the fold — a filter the reader cannot see is a trap.
  if (sec.long && !expanded.value[sec.id] && !q) {
    const top = rows.slice(0, LONG)
    const picked = rows.filter((r) => bus.isFilterActive(g.key, r.value) && !top.includes(r))
    return top.concat(picked)
  }
  return rows
}
const isOn = (key, v) => { void tick.value; return bus.isFilterActive(key, v) }
const anyOn = (sec) => { void tick.value; return sec.groups.some((g) => g.key in bus.filterSet) }
function clearSection(sec) { for (const g of sec.groups) bus.setFilter(g.key, null) }
const fmt = (n) => (Number(n) || 0).toLocaleString()

useShadowStyles(
  '.gif{height:100%;overflow-y:auto;padding:10px 12px 18px;box-sizing:border-box;background:#fff;color:#3b463d;' +
  'font:13px/1.35 Roboto,-apple-system,"Segoe UI",sans-serif;scrollbar-width:thin}' +
  '.gif-sec{border-bottom:1px solid #e6e8e3;padding:9px 0 10px}' +
  '.gif-h{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:#3b463d}' +
  '.gif-clear{margin-inline-start:auto;border:0;background:none;color:#6d766e;font:inherit;font-size:11px;font-weight:500;text-transform:none;cursor:pointer;min-height:24px;padding:0 4px;text-decoration:underline}' +
  '.gif-note{font-size:11px;color:#6d766e;margin:-2px 0 6px}' +
  '.gif-find{width:100%;box-sizing:border-box;border:1px solid #d1d4cd;border-radius:6px;padding:5px 8px;font:inherit;font-size:12px;margin-bottom:5px;background:#f3f3f1;color:#3b463d}' +
  '.gif-opt{display:flex;align-items:center;gap:7px;width:100%;min-height:26px;padding:2px 6px;border:0;border-radius:6px;background:none;color:inherit;' +
  'font:inherit;text-align:start;cursor:pointer}' +
  '.gif-opt:hover{background:#f3f3f1}' +
  '.gif-opt:focus-visible{outline:2px solid #92b195;outline-offset:1px}' +
  '.gif-opt[aria-pressed="true"]{background:#e3ece2;font-weight:600}' +
  '.gif-opt.sub{padding-inline-start:20px;font-size:12.5px}' +
  '.gif-opt.zero{color:#9aa19b}' +
  '.gif-box{width:13px;height:13px;border:1.5px solid #6d766e;border-radius:3px;flex:none;box-sizing:border-box;display:grid;place-items:center;font-size:10px;line-height:1;color:#fff}' +
  '.gif-opt[aria-pressed="true"] .gif-box{background:#3b463d;border-color:#3b463d}' +
  '.gif-lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.gif-n{font-variant-numeric:tabular-nums;color:#6d766e;font-size:12px}' +
  '.gif-sw{width:10px;height:10px;border-radius:2px;flex:none}' +
  '.gif-dot{width:10px;height:10px;border-radius:50%;flex:none;box-sizing:border-box;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2)}' +
  '.gif-more{border:0;background:none;color:#4f6b52;font:inherit;font-size:12px;cursor:pointer;padding:3px 6px;min-height:24px;text-decoration:underline}',
  'gi-facets',
)
</script>

<template>
  <nav class="gif" :aria-label="T('gospelInternet.facet.aria', 'Filters')">
    <section v-for="sec in sections" :key="sec.id" class="gif-sec" :data-facet="sec.id">
      <h3 class="gif-h">
        <span>{{ sec.title }}</span>
        <button v-if="anyOn(sec)" type="button" class="gif-clear" @click="clearSection(sec)">{{ T('controls.clear', 'Clear') }}</button>
      </h3>
      <p v-if="sec.note" class="gif-note">{{ sec.note }}</p>
      <input v-if="sec.find" v-model="find[sec.find]" class="gif-find" type="search"
             :placeholder="T('gospelInternet.facet.find', 'Find…')" :aria-label="T('gospelInternet.facet.findIn', 'Find in {what}', { what: sec.title })" />
      <template v-for="g in sec.groups" :key="g.key">
        <button v-for="r in visibleRows(sec, g)" :key="g.key + ':' + r.value" type="button"
                class="gif-opt" :class="{ sub: g.sub, zero: !r.groups }"
                :aria-pressed="isOn(g.key, r.value) ? 'true' : 'false'"
                :data-value="r.value"
                @click="bus.toggleFilterValue(g.key, r.value)">
          <span class="gif-box" aria-hidden="true">{{ isOn(g.key, r.value) ? '✓' : '' }}</span>
          <span v-if="g.sw" class="gif-sw" :style="g.sw(r.value)" aria-hidden="true"></span>
          <span v-if="g.dot" class="gif-dot" :style="g.dot(r.value)" aria-hidden="true"></span>
          <span class="gif-lbl" :title="g.label(r.value)"><bdi>{{ g.label(r.value) }}</bdi></span>
          <span class="gif-n">{{ fmt(r.groups) }}</span>
        </button>
        <button v-if="sec.long && g.rows.length > LONG && !find[sec.find || '']" type="button" class="gif-more"
                @click="expanded[sec.id] = !expanded[sec.id]">
          {{ expanded[sec.id] ? T('gospelInternet.facet.fewer', 'Show fewer') : T('gospelInternet.facet.all', 'Show all {n}', { n: fmt(g.rows.length) }) }}
        </button>
      </template>
    </section>
  </nav>
</template>
