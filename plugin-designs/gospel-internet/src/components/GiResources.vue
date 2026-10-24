<script setup>
// What this instance put on window, recorded AS IT IS SET so unmount can tell its own values
// from another instance's. Two of these can share a page; clearing by NAME alone would let the
// second unmount delete the first's live hooks.
const ownGlobals = Object.create(null)
function setGlobal(name, value) {
  try { window[name] = value; ownGlobals[name] = value } catch (_) {}
}
/**
 * GiResources.vue — the second tab under the board: every gospel resource for the LANGUAGES of the people
 * groups in scope. Pick a family on the tree, a country on the map or a facet in the rail, and this lists
 * what already exists for those languages: type, scope, source, and the link.
 *
 * The rows are the screened links (gospel-resource-links.json, cut to the board's languages at
 * build). Scope is the board's: a language is listed when at least one group in scope speaks it, and the
 * "groups here" column counts those groups. CSV exports exactly what is listed.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { buildCsv, safeHref } from '../model.js'

const T = useGiT()
const board = useBoardState()
const fmt = (n) => (Number(n) || 0).toLocaleString()

onMounted(() => { board.loadTree().catch(() => {}) })

const groupsByIso = computed(() => {
  const m = new Map()
  for (const r of board.filtered.value) m.set(r.iso639_3, (m.get(r.iso639_3) || 0) + 1)
  return m
})
const sort = ref({ key: 'groups', dir: -1 })
const rows = computed(() => {
  const res = board.resources.value
  if (!res) return []
  const g = groupsByIso.value
  const out = res.rows.filter((r) => g.has(r.iso)).map((r) => ({ ...r, groups: g.get(r.iso) }))
  const { key, dir } = sort.value
  return out.sort((a, b) => key === 'groups' ? (a.groups - b.groups) * dir || a.language.localeCompare(b.language)
    : String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * dir)
})
const langsListed = computed(() => new Set(rows.value.map((r) => r.iso)).size)
const langsInScope = computed(() => groupsByIso.value.size)

const COLS = computed(() => [
  { key: 'language', label: T('gospelInternet.col.language', 'Language'), w: 190 },
  { key: 'type', label: T('gospelInternet.res.type', 'Type'), w: 150 },
  { key: 'resource', label: T('gospelInternet.res.resource', 'Resource'), w: 260 },
  { key: 'scope', label: T('gospelInternet.res.scope', 'Scope'), w: 190 },
  { key: 'source', label: T('gospelInternet.res.source', 'Source'), w: 170 },
  { key: 'groups', label: T('gospelInternet.res.groups', 'Groups here'), w: 100, num: true },
])
function sortBy(c) { sort.value = sort.value.key === c.key ? { key: c.key, dir: -sort.value.dir } : { key: c.key, dir: c.num ? -1 : 1 } }

// windowing, as the groups grid does
const ROW_H = 32
const scroller = ref(null)
const scrollTop = ref(0)
const viewH = ref(400)
const first = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - 6))
const slice = computed(() => rows.value.slice(first.value, Math.min(rows.value.length, Math.ceil((scrollTop.value + viewH.value) / ROW_H) + 6)))
let ro = null
onMounted(() => {
  if (scroller.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { viewH.value = scroller.value ? scroller.value.clientHeight : 400 })
    ro.observe(scroller.value)
  }
})
onBeforeUnmount(() => { try { ro && ro.disconnect() } catch (_) {} })
  // ★ RELEASE THE TEST HOOKS. Each pins whatever it closes over — a map instance pins its
  // canvas, its sources, and through them the whole app — so every mount that leaves one behind
  // leaks another copy, measured at roughly 10 MB each.
  // Released as a SET, not just the obvious one: a block that sets several and clears one leaks
  // the rest silently, and the named one is the one you remember. One delete per line, so the
  // released set is readable and greppable.
  // Identity-checked: only this instance's own value is cleared, so a second instance sharing the
  // page does not delete the first's live hooks on its way out.
  try { if (window.__giLastResourcesCsv === ownGlobals.__giLastResourcesCsv) delete window.__giLastResourcesCsv } catch (_) {}
watch(() => board.filtered.value, () => { if (scroller.value) scroller.value.scrollTop = 0; scrollTop.value = 0 })

const status = ref('')
function exportCsv() {
  const cols = [{ key: 'iso', header: 'iso639_3' }, { key: 'language', header: 'language' }, { key: 'type', header: 'type' },
    { key: 'resource', header: 'resource' }, { key: 'scope', header: 'scope' }, { key: 'source', header: 'source' },
    { key: 'url', header: 'url' }, { key: 'groups', header: 'groups_in_scope' }]
  const filters = Object.entries(board.bus.filterSet).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`).join('; ') || 'none'
  const csv = buildCsv(rows.value, cols, { provenance: `# Gospel x Internet resources export — list: ${board.listId.value}; filters: ${filters}${board.treeNode.value ? '; tree node: ' + board.treeNode.value : ''}; rows: ${rows.value.length}; source: gospel-resource-links (every link screened)` })
  try { navigator.clipboard && navigator.clipboard.writeText(csv).catch(() => {}) } catch (_) {}
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'gospel-internet-resources.csv'; a.style.display = 'none'
    document.body.appendChild(a); a.click(); setTimeout(() => { try { URL.revokeObjectURL(url); a.remove() } catch (_) {} }, 200)
  } catch (_) {}
  try { setGlobal('__giLastResourcesCsv', csv )} catch (_) {}
  status.value = T('gospelInternet.grid.exported', '{n} rows exported (copied and downloaded).', { n: fmt(rows.value.length) })
  setTimeout(() => { status.value = '' }, 4000)
}

useShadowStyles(
  '.gir{display:flex;flex-direction:column;height:100%;min-height:0;background:#fff;color:#3b463d;font:13px/1.3 Roboto,-apple-system,"Segoe UI",sans-serif}' +
  '.gir-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 10px;border-bottom:1px solid #d1d4cd;background:#f3f3f1}' +
  '.gir-count{font-weight:600;font-variant-numeric:tabular-nums}' +
  '.gir-note{font-size:11.5px;color:#6d766e}' +
  '.gir-btn{border:1px solid #3b463d;background:#3b463d;color:#fff;border-radius:6px;padding:4px 10px;min-height:28px;font:inherit;font-size:12.5px;cursor:pointer}' +
  '.gir-btn:focus-visible,.gir-th button:focus-visible{outline:2px solid #92b195;outline-offset:1px}' +
  '.gir-scroll{flex:1;min-height:0;overflow:auto;position:relative;scrollbar-width:thin}' +
  '.gir-table{display:grid;min-width:max-content}' +
  '.gir-head{position:sticky;top:0;z-index:3;display:flex;background:#fff;border-bottom:1px solid #d1d4cd}' +
  '.gir-th,.gir-td{box-sizing:border-box;padding:0 8px;display:flex;align-items:center;flex:none;min-width:0}' +
  '.gir-th{height:34px;font-size:11.5px;font-weight:700;color:#6d766e;text-transform:uppercase;letter-spacing:.02em}' +
  '.gir-th button{all:unset;cursor:pointer;display:flex;gap:4px;align-items:center;width:100%;min-height:24px}' +
  '.gir-td{height:32px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
  '.gir-td > *{overflow:hidden;text-overflow:ellipsis}' +
  '.gir-td.num,.gir-th.num{justify-content:flex-end;font-variant-numeric:tabular-nums}' +
  '.gir-tr{display:flex;position:absolute;inset-inline:0;border-bottom:1px solid #eef0ec;background:#fff}' +
  '.gir-td a{color:#4f6b52}' +
  '.gir-empty{padding:24px;text-align:center;color:#6d766e}',
  'gi-resources',
)
</script>

<template>
  <section class="gir" data-region="resources" :aria-label="T('gospelInternet.res.aria', 'Gospel resources for the languages in scope')">
    <div class="gir-bar">
      <span class="gir-count" data-resources-total>{{ T('gospelInternet.res.count', '{n} resources in {langs} of {all} languages in scope', { n: fmt(rows.length), langs: fmt(langsListed), all: fmt(langsInScope) }) }}</span>
      <span class="gir-note">{{ T('gospelInternet.res.note', 'A language with no row here has nothing found in the sources checked.') }}</span>
      <span style="flex:1"></span>
      <span role="status" class="gir-note">{{ status }}</span>
      <button type="button" class="gir-btn" data-export-resources @click="exportCsv">{{ T('dashboard.export_csv', 'Export CSV') }}</button>
    </div>
    <div ref="scroller" class="gir-scroll" role="table" :aria-rowcount="rows.length + 1" @scroll="scrollTop = $event.target.scrollTop">
      <div class="gir-table">
        <div class="gir-head" role="row">
          <div v-for="c in COLS" :key="c.key" class="gir-th" :class="{ num: c.num }" :style="{ width: c.w + 'px' }" role="columnheader"
               :aria-sort="sort.key !== c.key ? 'none' : sort.dir > 0 ? 'ascending' : 'descending'">
            <button type="button" @click="sortBy(c)">{{ c.label }}<span aria-hidden="true">{{ sort.key === c.key ? (sort.dir > 0 ? '▲' : '▼') : '' }}</span></button>
          </div>
        </div>
        <div :style="{ height: rows.length * ROW_H + 'px', position: 'relative' }" role="rowgroup">
          <div v-for="(r, i) in slice" :key="r.iso + '|' + r.url + '|' + (first + i)" class="gir-tr" role="row" :style="{ top: (first + i) * ROW_H + 'px' }">
            <div class="gir-td" :style="{ width: COLS[0].w + 'px' }" role="cell"><bdi :title="r.language">{{ r.language }} ({{ r.iso }})</bdi></div>
            <div class="gir-td" :style="{ width: COLS[1].w + 'px' }" role="cell"><span>{{ r.type }}</span></div>
            <div class="gir-td" :style="{ width: COLS[2].w + 'px' }" role="cell">
              <a v-if="safeHref(r.url)" :href="safeHref(r.url)" target="_blank" rel="noopener noreferrer" :title="r.resource"><bdi>{{ r.resource }}</bdi></a>
              <bdi v-else>{{ r.resource }}</bdi>
            </div>
            <div class="gir-td" :style="{ width: COLS[3].w + 'px' }" role="cell"><bdi :title="r.scope">{{ r.scope }}</bdi></div>
            <div class="gir-td" :style="{ width: COLS[4].w + 'px' }" role="cell"><span>{{ r.source }}</span></div>
            <div class="gir-td num" :style="{ width: COLS[5].w + 'px' }" role="cell">{{ fmt(r.groups) }}</div>
          </div>
        </div>
        <div v-if="board.resources.value && !rows.length" class="gir-empty">{{ T('gospelInternet.res.empty', 'Nothing found for the languages in scope.') }}</div>
        <div v-else-if="!board.resources.value" class="gir-empty">{{ T('grid.loading', 'Loading…') }}</div>
      </div>
    </div>
  </section>
</template>
