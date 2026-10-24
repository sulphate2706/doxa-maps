<script setup>
/**
 * board.vue — THE GOSPEL x INTERNET BOARD.
 *
 * @description For every remaining people group: what gospel resources exist in a language they use, and how much of their country (or Indian state) is online to receive them.
 *
 * One board for sending gospel resources through the internet, embeddable by partners.
 *
 * How this board is built, and what it refuses to say: ./README.md
 *
 * THE SHELL, built on the dashboard kit: the selection bus (library useSelectionBus, filter / selection /
 * hover), the layout engine (library useDashboardLayout: three drag handles, keyboard operable,
 * persisted under this board's OWN key), and one polite live region (kit D5: mandatory chrome). The
 * panels — facet rail, map, charts, grid, drawer — are plugin-local glue to the kit contract until their
 * kit landings reach main; each file names the landing that replaces it.
 *
 * VIEWS are presets over the one bus, never separate state: Board, Nothing in own language (the 369 as
 * a front door, largest first), India & China by province.
 *
 * HONESTY (section 13), as standing chrome rather than a line someone can forget: pins are approximate;
 * internet figures are the country's (or state's); "found in the sources checked", never "reached"; no
 * engagement, no one-works-here. Sources are named from the table's own meta.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, getCurrentInstance } from 'vue'
import { useDashboardLayout } from '@map/composables/useDashboardLayout.js'
import { useShareableView } from '@map/composables/useShareableView.js'
import { SHARE_FACETS } from './src/model.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { listLabel } from '@map/lists/peopleGroupList.js'
import { useBoard } from './src/useBoard.js'
import { useGiT } from './src/useGiT.js'
import GiFacetRail from './src/components/GiFacetRail.vue'
import GiMap from './src/components/GiMap.vue'
import GiBoundedSet from './src/components/GiBoundedSet.vue'
import GiCenteredSet from './src/components/GiCenteredSet.vue'
import GiCharts from './src/components/GiCharts.vue'
import GiGrid from './src/components/GiGrid.vue'
import GiDrawer from './src/components/GiDrawer.vue'
import GiTree from './src/components/GiTree.vue'
import GiResources from './src/components/GiResources.vue'
import GiCombos from './src/components/GiCombos.vue'
import { isNarrowWidth } from './src/breakpoints.js'

const T = useGiT()
const board = useBoard()
const { bus } = board
// ── INTEROP OUT: every committed selection leaves as a DOM event another element or the host page can
// take (SPEC-DASHBOARD-KIT 5.3, level 2): bubbling + composed, so it crosses the shadow boundary; CODES,
// never labels (slugs, ISO 639-3, ISO 3166 alpha-3); debounced so a range drag sends one event. The host
// is found through the instance captured HERE, in setup: getCurrentInstance() in a watcher is null, and
// that is exactly how Simple Research's map -> grid event silently never fired.
const selfInstance = getCurrentInstance()
let selTimer = null
watch(() => bus.selectionVersion.value, () => {
  if (selTimer) clearTimeout(selTimer)
  selTimer = setTimeout(() => {
    selTimer = null
    const host = selfInstance?.proxy?.$el?.getRootNode?.()?.host
    if (!host) return
    const slugs = [...bus.selectionSet]
    const rows = slugs.map((s) => board.bySlug.value.get(s)).filter(Boolean)
    host.dispatchEvent(new CustomEvent('gospel-internet:selection', { bubbles: true, composed: true, detail: {
      slugs, languages: [...new Set(rows.map((r) => r.iso639_3))], countries: [...new Set(rows.map((r) => r.iso3))],
      list: board.listId.value,
    } }))
  }, 150)
})
onBeforeUnmount(() => { if (selTimer) clearTimeout(selTimer) })

// The URL / host preset (view, facets, centre panel, group) is applied BEFORE the first render, so the
// board opens already in its state: no flash of the default view, and the first render mounts the panel
// the preset asks for (the language tree included) where a headless mount check can see it.
board.readUrl()
// SHARE LINKS FROM THE KIT (useShareableView, query mode): the filters and the typed search live in the
// URL under the board's published names (?access= ?band= ?country= …, the alias map keeps links already
// shared working), restored on every load, written ONLY on our own leaves (urlState:'query') so a
// partner's address bar is never rewritten. facetKeys is explicit: its default reads nothing on a cold load.
useShareableView(bus, { mode: 'query', write: board.profileConfig.value?.urlState === 'query', facetKeys: SHARE_FACETS })

// ── responsive: one panel at a time under the shared breakpoint (ResizeObserver on the shell, not @container: a
// container query cannot target the container itself, which is unreliable inside a shadow root) ──────
const shell = ref(null)
const isNarrow = ref(false)
const mobilePanel = ref('map')
let ro = null
onMounted(() => {
  if (shell.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(([e]) => { isNarrow.value = isNarrowWidth(e.contentRect.width) })
    ro.observe(shell.value)
  }
  board.load()
})
onBeforeUnmount(() => { try { ro && ro.disconnect() } catch (_) {} })

// The kit's layout engine, under THIS board's key (landing 2's namespacing), grid mode.
const { startFacetResize, startRailResize, startTableResize, onResizeKeydown, facetW, railW, tableH } = useDashboardLayout({
  shellRef: shell, bus, isNarrow, storageKey: 'gi-board-layout-v1',
  defaults: { facetW: 264, railW: 360, tableH: '38%' },
})

// ── the headline: the board's question answered in one line, for the list in view ───────────────────
const headline = computed(() => {
  const all = board.all.value
  const zero = all.filter((r) => r.access_detail === 'none')
  const online = zero.filter((r) => r.internet_band === 'yes').length
  return { total: all.length, zero: zero.length, online }
})
const fmt = (n) => (Number(n) || 0).toLocaleString()
const listChip = computed(() => board.listIsDefault.value ? '' : listLabel(board.listId.value, (k) => T(k, '')))

const VIEW_TABS = computed(() => [
  { id: 'board', label: T('gospelInternet.view.board', 'Board') },
  { id: 'zero', label: T('gospelInternet.view.zero', 'Nothing in own language') },
  { id: 'province', label: T('gospelInternet.view.province', 'India & China by province') },
  { id: 'platforms', label: T('gospelInternet.view.platforms', 'Platforms') },
])
const MOBILE_TABS = computed(() => [
  { id: 'map', label: T('gospelInternet.panel.map', 'Map') },
  { id: 'facets', label: T('gospelInternet.panel.filters', 'Filters') },
  { id: 'grid', label: T('gospelInternet.panel.grid', 'Groups') },
  { id: 'charts', label: T('gospelInternet.panel.charts', 'Charts') },
])
// The centre shows the geographic map or the language tree; the tree (its own whiteboard map) is built
// on first use and then kept, so switching back and forth costs nothing after the first time.
const treeEver = ref(false)
// The geographic map mounts the same way, on first show: the board opens on the tree, and a hidden map
// still built a second WebGL context, its tiles and 1,700 pins on every open (it froze /embed-test when
// several heavy cards mounted together). Once shown it stays mounted, so switching back is instant.
const mapEver = ref(false)
const boundedEver = ref(false)
const centeredEver = ref(false)
watch(() => board.centre.value, (c) => {
  if (c === 'tree') treeEver.value = true
  if (c === 'map') mapEver.value = true
  if (c === 'bounded') boundedEver.value = true
  if (c === 'centered') centeredEver.value = true
}, { immediate: true })
// The tab order is Language tree, Bounded set, Centered set, then Map. The centered-set
// target waited for its data rather than shipping as an empty tab; ring and ringNb are
// columns on near-neighbors.json now, so it is here.
const CENTRE_TABS = computed(() => [
  { id: 'tree', label: T('gospelInternet.centre.tree', 'Language tree') },
  { id: 'bounded', label: T('gospelInternet.centre.bounded', 'Bounded set') },
  { id: 'centered', label: T('gospelInternet.centre.centered', 'Centered set') },
  { id: 'map', label: T('gospelInternet.centre.map', 'Map') },
])
// the table under the centre: the people groups, or the gospel resources for their languages
const tableTab = ref('groups')
const TABLE_TABS = computed(() => [
  { id: 'groups', label: T('gospelInternet.table.groups', 'People groups') },
  { id: 'resources', label: T('gospelInternet.table.resources', 'Gospel resources') },
])
const scoped = computed(() => Object.keys(bus.filterSet).length > 0 || !!bus.searchTerm.value)
function resetAll() { board.setView('board'); bus.setSearch(''); bus.clearSelection(); board.closeGroup() }

// ── the polite live region (kit D5): one region, always rendered, starts empty, visually hidden (never
// display:none), debounced 700 ms, silent on arrival — it reports CHANGES, never its own mount ─────────
const live = ref('')
let liveTimer = null
let arrived = false
watch(() => [board.filtered.value.length, board.all.value.length], ([n, total]) => {
  if (!total) return
  if (!arrived) { arrived = true; return }
  if (liveTimer) clearTimeout(liveTimer)
  liveTimer = setTimeout(() => {
    live.value = T('dashboard.results_live', '{count} of {total} {unit} shown',
      { count: fmt(n), total: fmt(total), unit: T('gospelInternet.charts.unitGroups', 'people groups') })
  }, 700)
})

const sourcesLine = computed(() => (board.meta.value.sources || []).join(' · '))

useShadowStyles(
  // THE FLOOR LIVES ON :host, NOT ON .gb — the house pattern (research-map 320px,
  // people-groups 420px, big-picture 480px all put it here). It IS a collapse guard: :host
  // was only display:block, so an embed that gives the element no height would leave
  // .gb{height:100%} resolving against an auto-height parent and render nothing at all.
  // On the host it still guards that case, while a shell that sizes its own pane can
  // override it from outside; on .gb it could only ever push the element past its pane and
  // hand the host a second scrollbar over the tab strip.
  ':host{display:block;width:100%;height:100%;min-height:640px}' +
  // min-height:0, NOT a pixel floor. With height:100% a floor taller than the pane makes the
  // element overflow its host, so the HOST scrolls the whole plugin — tab strip included — and
  // the reader gets a second scrollbar that hides the tabs. Every inner grid area already
  // carries min-height:0 for the same reason; the root was the one that did not. The standalone
  // leaf gives the element a definite height (position:fixed; inset:0), so nothing collapses.
  '.gb{--gb-bg:#f3f3f1;position:relative;box-sizing:border-box;width:100%;height:100%;min-height:0;display:grid;background:var(--gb-bg);color:#3b463d;' +
  'grid-template-columns:var(--facet-w,264px) minmax(0,1fr) var(--rail-w,360px);' +
  'grid-template-rows:auto auto auto minmax(0,1fr) var(--table-h,38%);' +
  // The charts rail runs the full height beside the map AND the table: sized to the map row alone it was
  // ~300px and clipped its four charts.
  'grid-template-areas:"top top top" "combos combos combos" "note note note" "facets map rail" "facets grid rail";' +
  'font:13px/1.35 Roboto,-apple-system,"Segoe UI",sans-serif;overflow:hidden}' +
  '.gb-top{grid-area:top;display:flex;align-items:center;flex-wrap:wrap;gap:10px 16px;padding:10px 14px;background:#fff;border-bottom:1px solid #d1d4cd}' +
  '.gb-title{margin:0;font-size:17px;font-weight:700;letter-spacing:.005em}' +
  '.gb-sub{font-size:12.5px;color:#6d766e;margin-top:2px}' +
  '.gb-sub b{color:#7d3b30}' +
  '.gb-tabs{display:inline-flex;gap:4px;padding:3px;border-radius:9px;background:#f3f3f1;border:1px solid #d1d4cd}' +
  '.gb-tab{border:0;background:none;color:#3b463d;border-radius:6px;padding:5px 12px;min-height:28px;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer}' +
  '.gb-tab[aria-pressed="true"]{background:#3b463d;color:#fff}' +
  '.gb-tab:focus-visible,.gb-reset:focus-visible,.gb-mtab:focus-visible{outline:2px solid #92b195;outline-offset:2px}' +
  '.gb-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:#e3ece2;color:#3b463d;font-size:12px;font-weight:600}' +
  '.gb-reset{border:1px solid #d1d4cd;background:#fff;color:#3b463d;border-radius:6px;padding:4px 10px;min-height:28px;font:inherit;font-size:12.5px;cursor:pointer}' +
  '.gb-spacer{flex:1}' +
  '.gb-note{grid-area:note;padding:5px 14px;font-size:11.5px;color:#5d665f;background:#f9faf8;border-bottom:1px solid #e1e4de}' +
  '.gb-facets{grid-area:facets;min-height:0;border-inline-end:1px solid #d1d4cd}' +
  '.gb-map{grid-area:map;min-height:0;position:relative}' +
  '.gb-rail{grid-area:rail;min-height:0;border-inline-start:1px solid #d1d4cd}' +
  '.gb-grid{grid-area:grid;min-height:0;border-top:1px solid #d1d4cd;display:flex;flex-direction:column}' +
  '.gb-table-body{flex:1;min-height:0}' +
  '.gb-table-body > *{height:100%}' +
  '.gb-map > *:not(.gb-seg){position:absolute;inset:0}' +
  '.gb-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid #d1d4cd;border-radius:8px;background:#fff}' +
  '.gb-seg button{border:0;background:none;color:#3b463d;border-radius:6px;padding:4px 12px;min-height:26px;font:inherit;font-size:12.5px;cursor:pointer}' +
  '.gb-seg button[aria-pressed="true"]{background:#3b463d;color:#fff}' +
  '.gb-seg button:focus-visible{outline:2px solid #92b195;outline-offset:1px}' +
  '.gb-centre-tabs{position:absolute;inset-block-start:10px;left:50%;transform:translateX(-50%);z-index:8;box-shadow:0 2px 8px rgba(0,0,0,.10)}' +
  '.gb-table-tabs{margin:6px 10px 0;align-self:flex-start}' +
  '.gb-state{position:absolute;inset:0;display:grid;place-items:center;z-index:40;background:rgba(243,243,241,.7);font-size:14px;color:#6d766e;pointer-events:none}' +
  '.gb-state.err{color:#7d3b30;pointer-events:auto}' +
  '.gb-rz{position:relative;z-index:6;touch-action:none}' +
  '.gb-rz::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);border-radius:999px;background:transparent;transition:background .15s}' +
  '.gb-rz:hover::after,.gb-rz:focus-visible::after{background:#92b195}' +
  '.gb-rz:focus-visible{outline:2px solid #92b195;outline-offset:1px}' +
  '.gb-rz-facet{grid-area:facets;justify-self:end;align-self:stretch;width:8px;margin-inline-end:-4px;cursor:col-resize}' +
  '.gb-rz-rail{grid-area:rail;justify-self:start;align-self:stretch;width:8px;margin-inline-start:-4px;cursor:col-resize}' +
  '.gb-rz-table{grid-area:map;align-self:end;justify-self:stretch;height:8px;margin-bottom:-4px;cursor:row-resize}' +
  '.gb-rz-facet::after,.gb-rz-rail::after{width:3px;height:34px}' +
  '.gb-rz-table::after{width:34px;height:3px}' +
  '.gb-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
  // narrow: one panel at a time, a segmented control, no drag handles
  '.gb.narrow{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto auto minmax(0,1fr);' +
  'grid-template-areas:"top" "combos" "note" "mtabs" "panel"}' +
  '.gb.narrow .gb-facets,.gb.narrow .gb-map,.gb.narrow .gb-rail,.gb.narrow .gb-grid{grid-area:panel;border:0}' +
  '.gb-mtabs{grid-area:mtabs;display:flex;gap:4px;padding:6px 10px;background:#fff;border-bottom:1px solid #d1d4cd}' +
  '.gb-mtab{flex:1;border:1px solid #d1d4cd;background:#fff;color:#3b463d;border-radius:6px;min-height:32px;font:inherit;font-size:12.5px;cursor:pointer}' +
  '.gb-mtab[aria-pressed="true"]{background:#3b463d;border-color:#3b463d;color:#fff}' +
  '@media (prefers-reduced-motion: reduce){.gb-rz::after{transition:none}}',
  'gi-board',
)
</script>

<template>
  <div ref="shell" class="gb" :class="{ narrow: isNarrow }" data-plugin="gospel-internet"
       :data-rows="board.all.value.length" :data-in-scope="board.filtered.value.length" :data-view="board.view.value"
       :data-loading="board.loading.value ? '1' : '0'">
    <header class="gb-top">
      <div>
        <h1 class="gb-title">{{ T('gospelInternet.title', 'Gospel access through the internet') }}</h1>
        <div v-if="headline.total" class="gb-sub" data-headline>
          {{ T('gospelInternet.headline.a', '{zero} of {total} people groups have nothing found in their own language;', { zero: fmt(headline.zero), total: fmt(headline.total) }) }}
          <b>{{ T('gospelInternet.headline.b', '{online} of them live in countries where 60% or more use the internet.', { online: fmt(headline.online) }) }}</b>
        </div>
      </div>
      <span class="gb-spacer"></span>
      <div class="gb-tabs" role="group" :aria-label="T('gospelInternet.view.aria', 'View')">
        <button v-for="v in VIEW_TABS" :key="v.id" type="button" class="gb-tab" :aria-pressed="board.view.value === v.id ? 'true' : 'false'"
                :data-view-tab="v.id" @click="board.setView(v.id)">{{ v.label }}</button>
      </div>
      <span v-if="listChip" class="gb-chip" :title="T('gospelInternet.listChip', 'People-group list, chosen by this page')">{{ listChip }}</span>
      <button v-if="scoped" type="button" class="gb-reset" @click="resetAll">{{ T('controls.reset_all', 'Reset all') }}</button>
    </header>
    <GiCombos />
    <p class="gb-note" data-notice="standing">
      {{ T('gospelInternet.notice.standing', 'Dots are approximate: a dot marks a people group, not a town. Internet figures are the country\'s, or the Indian state\'s, never the group\'s. "Found" means found in the sources checked.') }}
      <span v-if="sourcesLine"> {{ T('gospelInternet.notice.sources', 'Sources:') }} {{ sourcesLine }}.</span>
    </p>

    <div v-if="isNarrow" class="gb-mtabs" role="group" :aria-label="T('gospelInternet.view.aria', 'View')">
      <button v-for="p in MOBILE_TABS" :key="p.id" type="button" class="gb-mtab" :aria-pressed="mobilePanel === p.id ? 'true' : 'false'" @click="mobilePanel = p.id">{{ p.label }}</button>
    </div>

    <div v-show="!isNarrow || mobilePanel === 'facets'" class="gb-facets"><GiFacetRail /></div>
    <div v-show="!isNarrow || mobilePanel === 'map'" class="gb-map">
      <GiMap v-if="mapEver" v-show="board.centre.value === 'map'" />
      <GiTree v-if="treeEver" v-show="board.centre.value === 'tree'" />
      <GiBoundedSet v-if="boundedEver" v-show="board.centre.value === 'bounded'" />
      <GiCenteredSet v-if="centeredEver" v-show="board.centre.value === 'centered'" />
      <div class="gb-seg gb-centre-tabs" role="group" :aria-label="T('gospelInternet.centre.aria', 'Show')">
        <button v-for="c in CENTRE_TABS" :key="c.id" type="button" :aria-pressed="board.centre.value === c.id ? 'true' : 'false'"
                :data-centre-tab="c.id" @click="board.setCentre(c.id)">{{ c.label }}</button>
      </div>
    </div>
    <div v-show="!isNarrow || mobilePanel === 'charts'" class="gb-rail"><GiCharts /></div>
    <div v-show="!isNarrow || mobilePanel === 'grid'" class="gb-grid">
      <div class="gb-seg gb-table-tabs" role="tablist" :aria-label="T('gospelInternet.table.aria', 'Table')">
        <button v-for="t in TABLE_TABS" :key="t.id" type="button" role="tab" :aria-selected="tableTab === t.id ? 'true' : 'false'"
                :aria-pressed="tableTab === t.id ? 'true' : 'false'" :data-table-tab="t.id" @click="tableTab = t.id">{{ t.label }}</button>
      </div>
      <div class="gb-table-body">
        <GiGrid v-show="tableTab === 'groups'" />
        <GiResources v-if="tableTab === 'resources'" />
      </div>
    </div>

    <template v-if="!isNarrow">
      <div class="gb-rz gb-rz-facet" role="separator" aria-orientation="vertical" tabindex="0"
           :aria-label="T('aria.resizeFiltersRail', 'Resize filters rail')" :aria-valuenow="facetW" aria-valuemin="160" aria-valuemax="420"
           @pointerdown="startFacetResize" @keydown="onResizeKeydown('facet', $event)"></div>
      <div class="gb-rz gb-rz-rail" role="separator" aria-orientation="vertical" tabindex="0"
           :aria-label="T('aria.resizeChartsRail', 'Resize charts rail')" :aria-valuenow="railW" aria-valuemin="200" aria-valuemax="520"
           @pointerdown="startRailResize" @keydown="onResizeKeydown('rail', $event)"></div>
      <div class="gb-rz gb-rz-table" role="separator" aria-orientation="horizontal" tabindex="0"
           :aria-label="T('aria.resizeTable', 'Resize table height')" :aria-valuenow="parseInt(tableH, 10)" aria-valuemin="12" aria-valuemax="70"
           @pointerdown="startTableResize" @keydown="onResizeKeydown('table', $event)"></div>
    </template>

    <GiDrawer />

    <div v-if="board.loading.value" class="gb-state" role="status">{{ T('grid.loading', 'Loading…') }}</div>
    <div v-else-if="board.error.value" class="gb-state err" role="alert">{{ T('gospelInternet.loadError', 'The board\'s data did not load.') }} {{ board.error.value }}</div>
    <div class="gb-live" role="status" aria-live="polite" aria-atomic="true">{{ live }}</div>
  </div>
</template>
