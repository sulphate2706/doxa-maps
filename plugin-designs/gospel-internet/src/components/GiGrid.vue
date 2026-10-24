<script setup>
// What this instance put on window, recorded AS IT IS SET so unmount can tell its own values
// from another instance's. Two of these can share a page; clearing by NAME alone would let the
// second unmount delete the first's live hooks.
const ownGlobals = Object.create(null)
function setGlobal(name, value) {
  try { window[name] = value; ownGlobals[name] = value } catch (_) {}
}
/**
 * GiGrid.vue — the grid under the map: one row per people group in scope, sortable, selectable, with a
 * column picker and the CSV export.
 *
 * ★ GLUE to the kit's table contract (DashboardDataTable is kit landing 5): selection is the bus's
 * (checkbox = toggleSelect, row click = open + select one), hover is the bus's (row hover -> the pin is
 * outlined; a pin hovered on the map lights its row), the row set is the board's `sorted` — the same
 * filtered rows the map and the charts read. Windowed rendering: only the rows in view are in the DOM,
 * so 2,107 rows cost ~30 row elements.
 *
 * CSV (glue to kit useCsvExport, landing 3 + ef74b8ca): selection > filter > all; the columns that are
 * ON, in their order, raw codes (never translated); header on line 1, provenance LAST with sources,
 * list, filters and date; clipboard first (works in a sandboxed iframe), then a file download.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { buildColumns } from '../columns.js'
import { buildCsv, exportScope, safeHref, gospelResourcesLink, GROUPS_LINK_CAP, DETAIL_FILL, DETAIL_RIM, BAND_COLOR } from '../model.js'
import { resolveShareUrl } from '@map/utils/embedBase.js'

const T = useGiT()
const board = useBoardState()
const { bus } = board

const columns = computed(() => buildColumns(T))
const shown = ref(null)        // Set of keys ON; null until columns are known
const on = computed(() => shown.value || new Set(columns.value.filter((c) => !c.hidden).map((c) => c.key)))
const visibleCols = computed(() => columns.value.filter((c) => on.value.has(c.key)))
function toggleCol(key) {
  const s = new Set(on.value)
  s.has(key) ? s.delete(key) : s.add(key)
  if (s.size) shown.value = s
}
const pickerOpen = ref(false)

const rows = computed(() => board.sorted.value)
const total = computed(() => board.all.value.length)
const selCount = computed(() => { void bus.selectionVersion.value; return bus.selectionSet.size })
const isSel = (slug) => { void bus.selectionVersion.value; return bus.selectionSet.has(slug) }
const hover = computed(() => bus.hoverKey.value)

function sortBy(c) {
  const cur = board.sort.value
  board.sort.value = cur.key === c.key ? { key: c.key, dir: -cur.dir } : { key: c.key, dir: c.num ? -1 : 1 }
}
const ariaSort = (c) => board.sort.value.key !== c.key ? 'none' : board.sort.value.dir > 0 ? 'ascending' : 'descending'

// ── windowing ─────────────────────────────────────────────────────────────────────────────────────
const ROW_H = 32
const scroller = ref(null)
const scrollTop = ref(0)
const viewH = ref(400)
const first = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - 6))
const last = computed(() => Math.min(rows.value.length, Math.ceil((scrollTop.value + viewH.value) / ROW_H) + 6))
const slice = computed(() => rows.value.slice(first.value, last.value))
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
  try { if (window.__giLastCsv === ownGlobals.__giLastCsv) delete window.__giLastCsv } catch (_) {}
  try { if (window.__giExportStatus === ownGlobals.__giExportStatus) delete window.__giExportStatus } catch (_) {}
// A new scope starts at the top: row 900 of the old scope means nothing in the new one.
watch(() => board.filtered.value, () => { if (scroller.value) scroller.value.scrollTop = 0; scrollTop.value = 0 })

// An opened group scrolls into the grid (from a pin click), once — never on hover.
watch(() => board.openSlug.value, (slug) => {
  if (!slug || !scroller.value) return
  const i = rows.value.findIndex((r) => r.slug === slug)
  if (i < 0) return
  const top = i * ROW_H
  if (top < scroller.value.scrollTop || top > scroller.value.scrollTop + viewH.value - ROW_H * 2) scroller.value.scrollTop = Math.max(0, top - ROW_H * 2)
})

function onRowKey(e, r) {
  if (e.key === 'Enter') board.openGroup(r.slug)
  else if (e.key === ' ') { e.preventDefault(); bus.toggleSelect(r.slug) }
}
const cell = (c, r) => (c.show ? c.show(r) : r[c.key] ?? '')

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────
const status = ref('')
function csvText() {
  const { scope, rows: picked } = exportScope(board.all.value, board.sorted.value, bus.selectionSet)
  const filters = Object.entries(bus.filterSet).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`).join('; ') || 'none'
  const src = (board.meta.value.sources || []).join('; ')
  const date = (board.meta.value.inputs_generated && board.meta.value.inputs_generated['doxa-gospel-access']) || ''
  const provenance = `# Gospel x Internet export — scope: ${scope} (${picked.length}); list: ${board.listId.value}; filters: ${filters}` +
    `${bus.searchTerm.value ? '; search: ' + bus.searchTerm.value : ''}; data: ${date}; sources: ${src}` +
    '; internet figures are the country\'s (or the Indian state\'s), never the group\'s; state/province is approximate'
  const cols = visibleCols.value.map((c) => ({ key: c.key, header: c.header, csv: c.csv }))
  return { csv: buildCsv(picked, cols, { provenance }), n: picked.length }
}
function exportCsv() {
  const { csv, n } = csvText()
  let clipboard = false, downloaded = false
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(csv).catch(() => {}); clipboard = true } } catch (_) {}
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'gospel-internet.csv'; a.style.display = 'none'
    document.body.appendChild(a); a.click(); downloaded = true
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove() } catch (_) {} }, 200)
  } catch (_) {}
  try { setGlobal('__giLastCsv', csv); setGlobal('__giExportStatus', { rows: n, clipboard, downloaded }) } catch (_) {}
  status.value = T('gospelInternet.grid.exported', '{n} rows exported (copied and downloaded).', { n: n.toLocaleString() })
  setTimeout(() => { status.value = '' }, 4000)
}
// INTEROP OUT, as a link: the selected peoples, opened in Gospel Resources' map (its ?groups= contract).
const gospelLink = computed(() => {
  void bus.selectionVersion.value
  if (!bus.selectionSet.size) return ''
  const cfg = board.profileConfig.value || {}
  const base = resolveShareUrl({ embedPath: 'gospel-resources/resources-map/index.html', profileConfig: { ...cfg, shareUrl: '' } })
  return gospelResourcesLink(base, bus.selectionSet, { list: board.listIsDefault.value ? '' : board.listId.value, lang: cfg.lang || cfg.locale || '' })
})
const gospelCapped = computed(() => { void bus.selectionVersion.value; return bus.selectionSet.size > GROUPS_LINK_CAP })
const exportLabel = computed(() => selCount.value ? T('dashboard.export_selection', 'Export this selection') : T('dashboard.export_csv', 'Export CSV'))
const fmt = (n) => (Number(n) || 0).toLocaleString()

useShadowStyles(
  '.gig{display:flex;flex-direction:column;height:100%;min-height:0;background:#fff;color:#3b463d;font:13px/1.3 Roboto,-apple-system,"Segoe UI",sans-serif}' +
  '.gig-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 10px;border-bottom:1px solid #d1d4cd;background:#f3f3f1}' +
  '.gig-count{font-weight:600;font-variant-numeric:tabular-nums}' +
  '.gig-search{flex:1 1 180px;max-width:320px;border:1px solid #d1d4cd;border-radius:6px;padding:5px 9px;font:inherit;font-size:12.5px;background:#fff;color:#3b463d}' +
  '.gig-btn{border:1px solid #d1d4cd;background:#fff;color:#3b463d;border-radius:6px;padding:4px 10px;min-height:28px;font:inherit;font-size:12.5px;cursor:pointer}' +
  '.gig-btn:hover{border-color:#92b195}' +
  'a.gig-btn{text-decoration:none;display:inline-flex;align-items:center}' +
  '.gig-btn.primary{background:#3b463d;border-color:#3b463d;color:#fff}' +
  '.gig-btn:focus-visible,.gig-th button:focus-visible,.gig-tr:focus-visible{outline:2px solid #92b195;outline-offset:1px}' +
  '.gig-status{font-size:12px;color:#4f6b52}' +
  '.gig-picker{position:relative}' +
  '.gig-menu{position:absolute;inset-block-end:calc(100% + 4px);inset-inline-end:0;z-index:20;background:#fff;border:1px solid #d1d4cd;border-radius:8px;' +
  'box-shadow:0 6px 20px rgba(0,0,0,.12);padding:6px;max-height:320px;overflow:auto;min-width:230px}' +
  '.gig-menu label{display:flex;gap:7px;align-items:center;padding:3px 6px;min-height:24px;font-size:12.5px;cursor:pointer}' +
  '.gig-scroll{flex:1;min-height:0;overflow:auto;position:relative;scrollbar-width:thin}' +
  '.gig-table{display:grid;min-width:max-content}' +
  '.gig-head{position:sticky;top:0;z-index:3;display:flex;background:#fff;border-bottom:1px solid #d1d4cd}' +
  '.gig-th,.gig-td{box-sizing:border-box;padding:0 8px;display:flex;align-items:center;min-width:0;flex:none}' +
  '.gig-th{height:34px;font-size:11.5px;font-weight:700;color:#6d766e;text-transform:uppercase;letter-spacing:.02em}' +
  '.gig-th button{all:unset;cursor:pointer;display:flex;gap:4px;align-items:center;width:100%;min-height:24px}' +
  '.gig-td{height:32px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
  '.gig-td > span{overflow:hidden;text-overflow:ellipsis}' +
  '.gig-td.num,.gig-th.num{justify-content:flex-end;font-variant-numeric:tabular-nums}' +
  '.gig-tr{display:flex;position:absolute;inset-inline:0;border-bottom:1px solid #eef0ec;cursor:pointer;background:#fff}' +
  '.gig-tr:hover,.gig-tr.hov{background:#f6efe2}' +
  '.gig-tr.sel{background:#e3ece2}' +
  '.gig-tr.open{box-shadow:inset 3px 0 0 #3b463d}' +
  '.gig-sticky{position:sticky;inset-inline-start:0;z-index:1;background:inherit;font-weight:600}' +
  '.gig-chk{width:40px;justify-content:center}' +   // 24 px of content inside the 8 px side padding: room for the hit area
  '.gig-chk input{width:15px;height:15px;margin:0;cursor:pointer;accent-color:#3b463d}' +
  '.gig-hit{display:inline-flex;flex:none;align-items:center;justify-content:center;width:24px;min-width:24px;height:24px;cursor:pointer}' +
  '.gig-dot{width:10px;height:10px;border-radius:50%;box-sizing:border-box;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2);flex:none;margin-inline-end:6px}' +
  '.gig-sw{width:10px;height:10px;border-radius:2px;flex:none;margin-inline-end:6px;opacity:.85}' +
  '.gig-td a{color:#4f6b52}' +
  '.gig-empty{padding:24px;text-align:center;color:#6d766e}',
  'gi-grid',
)
</script>

<template>
  <section class="gig" data-region="grid" :aria-label="T('gospelInternet.grid.aria', 'People groups in scope')">
    <div class="gig-bar">
      <span class="gig-count" data-grid-total>{{ T('gospelInternet.grid.count', '{n} of {total} people groups', { n: fmt(rows.length), total: fmt(total) }) }}</span>
      <input class="gig-search" type="search" :value="bus.searchTerm.value" @input="bus.setSearch($event.target.value)"
             :placeholder="T('grid.search_people_or_countries', 'Search people groups or countries…')"
             :aria-label="T('grid.search_people_or_countries', 'Search people groups or countries…')" />
      <button v-if="selCount" type="button" class="gig-btn" @click="bus.clearSelection()">{{ T('buttons.clearSelection', 'Clear selection') }} ({{ fmt(selCount) }})</button>
      <a v-if="gospelLink" class="gig-btn" :href="gospelLink" target="_blank" rel="noopener" data-open-gospel
         :title="gospelCapped ? T('gospelInternet.grid.openCapped', 'Opens the first {n} selected.', { n: fmt(GROUPS_LINK_CAP) }) : ''">{{ T('gospelInternet.grid.openInGospel', 'Open in Gospel Resources') }}</a>
      <span class="gig-status" role="status">{{ status }}</span>
      <span style="flex:1"></span>
      <div class="gig-picker">
        <button type="button" class="gig-btn" :aria-expanded="pickerOpen ? 'true' : 'false'" @click="pickerOpen = !pickerOpen">{{ T('gospelInternet.grid.columns', 'Columns') }}</button>
        <div v-if="pickerOpen" class="gig-menu" role="group" :aria-label="T('gospelInternet.grid.columns', 'Columns')">
          <label v-for="c in columns" :key="c.key"><input type="checkbox" :checked="on.has(c.key)" @change="toggleCol(c.key)" /> {{ c.label }}</label>
        </div>
      </div>
      <button type="button" class="gig-btn primary" data-export-csv @click="exportCsv">{{ exportLabel }}</button>
    </div>

    <div ref="scroller" class="gig-scroll" @scroll="scrollTop = $event.target.scrollTop" role="table" :aria-rowcount="rows.length + 1">
      <div class="gig-table">
        <div class="gig-head" role="row">
          <div class="gig-th gig-chk" role="columnheader"><span class="gig-visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">{{ T('dashboard.selected', 'Selected') }}</span></div>
          <div v-for="c in visibleCols" :key="c.key" class="gig-th" :class="{ num: c.num, 'gig-sticky': c.sticky }" :style="{ width: c.w + 'px' }"
               role="columnheader" :aria-sort="ariaSort(c)">
            <button type="button" @click="sortBy(c)">{{ c.label }}<span aria-hidden="true">{{ board.sort.value.key === c.key ? (board.sort.value.dir > 0 ? '▲' : '▼') : '' }}</span></button>
          </div>
        </div>
        <div :style="{ height: rows.length * ROW_H + 'px', position: 'relative' }" role="rowgroup">
          <div v-for="(r, i) in slice" :key="r.slug" class="gig-tr" role="row" tabindex="0"
               :class="{ sel: isSel(r.slug), hov: hover === r.slug, open: board.openSlug.value === r.slug }"
               :style="{ top: (first + i) * ROW_H + 'px' }" :data-slug="r.slug"
               @click="board.openGroup(r.slug)" @keydown="onRowKey($event, r)"
               @mouseenter="bus.setHover(r.slug)" @mouseleave="bus.setHover(null)">
            <div class="gig-td gig-chk" role="cell" @click.stop>
              <!-- a 24 px hit area around the 15 px box (WCAG 2.5.8 target size) -->
              <label class="gig-hit"><input type="checkbox" :checked="isSel(r.slug)" :aria-label="T('gospelInternet.grid.selectRow', 'Select {name}', { name: r.people_group })" @change="bus.toggleSelect(r.slug)" /></label>
            </div>
            <div v-for="c in visibleCols" :key="c.key" class="gig-td" :class="{ num: c.num, 'gig-sticky': c.sticky }" :style="{ width: c.w + 'px' }" role="cell">
              <span v-if="c.dot" class="gig-dot" :style="{ background: DETAIL_FILL[r.access_detail], borderColor: DETAIL_RIM[r.access_detail] }" aria-hidden="true"></span>
              <span v-if="c.swatch" class="gig-sw" :style="{ background: BAND_COLOR[r.internet_band] }" aria-hidden="true"></span>
              <a v-if="c.url && safeHref(r[c.key])" :href="safeHref(r[c.key])" target="_blank" rel="noopener noreferrer" @click.stop>{{ c.linkText || r[c.key] }}</a>
              <span v-else-if="!c.url" :title="String(cell(c, r))"><bdi>{{ cell(c, r) }}</bdi></span>
            </div>
          </div>
        </div>
        <div v-if="!rows.length && !board.loading.value" class="gig-empty">{{ T('gospelInternet.grid.empty', 'No people groups match these filters.') }}</div>
      </div>
    </div>
  </section>
</template>
