<script setup>
/**
 * DataTable — RDASH phase 3: Excel-style virtualized table bound to filterSet, multi-sort,
 * row multi-select writing to selectionSet.
 *
 * HAND-ROLLED (no AG Grid): the starter-kit node_modules is a symlink into the frozen doxa-life
 * tree, so `npm install ag-grid-community` would write to a read-only source AND breaks the
 * no-install guardrail. The plan's own §LIBRARIES names a headless/zero-CSS table as the
 * persecution-safe escape hatch — this is that: pure Vue + windowed virtualization for the 2,106
 * rows, own CSS via useShadowStyles (shadow-DOM safe), ARIA grid/sort roles, footer aggregation,
 * 'N selected' pill. Same functional contract as AG Grid for the verify (sort row-order + aria-sort,
 * checkbox -> selectionSet).
 */
import { inject, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { buildSearchAccessors, makeSearchMatcher, filterRowsBySearch } from '@map/composables/useDashboardSearch.js'
import { useCsvExport } from '@map/composables/useCsvExport.js'
import { formatCount } from '@map/utils/formatCount.js'
import { useTreeLegendLabels } from '../../composables/useTreeLegendLabels.js'
import { tStatic } from '@map/i18n/index.js'
import { fillParams } from '@map/composables/useOptionalT.js'

// This table's chrome, read out of the catalogue. tStatic and not useI18n, for the reason the rest
// of this tree gives: these components mount inside custom elements that install no i18n plugin,
// and an unguarded useI18n() throws on the way in and takes the whole panel with it.
// The English stays as the fallback argument, so a key that is missing degrades to what shipped.
const T = (key, en) => tStatic(key) || en
const sortTitle = (column) => T('dashboard.sort_by_column_hint', 'Sort this table by {column} — shift-click to add a second column. Sorting orders the table only; the cards keep their own order.').replace('{column}', column)

const dash = inject('dashboardData', null)
const bus = inject('selectionBus', null)
const cfg = inject('dashboardConfig', {})

const lbl = (v) => (v === null || v === undefined ? '' : (typeof v === 'object' ? (v.label ?? v.value ?? '') : v))
const num = (v) => { if (typeof v === 'number') return v; const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n }
// Empty stays '' here, and '' still falls through to "0" — formatCount only punctuates.
const fmt = (n) => (n === null || n === undefined ? '' : formatCount(n))

const COLUMNS = computed(() => cfg.columns || [])

// Per-column flex WEIGHT from dashboard.config.js `columns[].w` (default 1, so a config without
// weights behaves exactly as before). `flex: <w> 1 0` keeps flex-basis at 0 — the row still fills
// the width at any viewport — while changing only how that width is SHARED.
//
// WHY: every column was `flex:1 1 0`, i.e. "ignore content, split evenly". Measured live, all eight
// were exactly 106px at 1440 and 86px at 1280, so "People Group" ellipsised while "Praying" had room
// to spare; at 1280 THREE headers were cut. Weights, not pixel widths: a fixed px column breaks at
// some viewport you did not test, a weight degrades proportionally everywhere.
//
// ★ min-width IS WHAT MAKES HORIZONTAL SCROLL POSSIBLE AT ALL (card BUILD-TABLE-HORIZONTAL-
// SCROLL-AND-FULLSCREEN). `flex:<w> 1 0` alone can NEVER overflow: flex-basis 0 plus a shrink
// factor means every column collapses to whatever the container offers, so scrollWidth always
// equals clientWidth and an `overflow-x:auto` scrollport has nothing to scroll. Adding
// overflow-x without a floor is a scrollbar that never appears.
//
// The floor is per-column and derived from the HEADER, because the header is the thing the
// The requirement is to stop abbreviating: a column must never be narrower than its own full title.
// `col.minW` (dashboard.config.js) overrides; otherwise it is measured from the label's
// character count. Body cells may still ellipsise — a people-group NAME can be arbitrarily
// long and sizing columns to the longest cell would push the table to several thousand px.
const COL_MIN_FALLBACK = 90
// ★ 9.9px/CHAR IS MEASURED, NOT GUESSED — and the first guess was wrong in the direction that
// silently defeats the feature. An estimate of 7.1px/char put the summed floor at 675px against
// an 878px scrollport, so min-width never bound, scrollWidth equalled clientWidth, and the
// scrollbar could not appear at ANY width. Measured live at 1440 by cloning each header out of
// flex flow and reading its intrinsic width (internal probe, 2026-09-23):
//
//   People Group 103px/12ch (8.58)   Country 65/7 (9.29)   Region  58/6 (9.67)
//   Language      78px/ 8ch (9.75)   Religion 67/8 (8.38)  Population 85/10 (8.50)
//   Praying       63px/ 7ch (9.00)   Engagement 97/10 (9.70)
//
// Worst case is 9.75px/char, so 9.9 covers every current label with a little headroom; +12px
// reserves the sort indicator, which appears only when a column is engaged but must not reflow
// the header when it does. Summed floor = 742px + 30px checkbox.
//
// ★ THAT FLOOR IS BELOW THE 1440px SCROLLPORT ON PURPOSE. At 1440 the eight columns genuinely
// fit and there is nothing to scroll — forcing a scrollbar there would invent a defect. This
// floor bites at NARROW widths (1280 and below), which is exactly where the header truncation
// that was objected to was happening.
const PX_PER_CHAR = 9.9
const SORT_INDICATOR_PX = 12
function colMin(col) {
  const m = Number(col && col.minW)
  if (Number.isFinite(m) && m > 0) return m
  const label = String((col && col.label) || '')
  if (!label) return COL_MIN_FALLBACK
  return Math.ceil(label.length * PX_PER_CHAR) + SORT_INDICATOR_PX
}
function colFlex(col) {
  const w = Number(col && col.w)
  // flex-basis stays 0 so the WEIGHTS still govern how surplus width is shared (the measured
  // decision above is untouched); min-width only sets the floor below which sharing stops and
  // the row overflows instead. At a wide viewport nothing changes — every column is already
  // above its floor, so this is inert until the table is actually too narrow.
  return { flex: `${Number.isFinite(w) && w > 0 ? w : 1} 1 0`, minWidth: colMin(col) + 'px' }
}
// The flex LINE must be allowed to exceed the scrollport, or the row would wrap/shrink instead
// of overflowing. Sum of the floors + the 30px checkbox column = the narrowest the table can be.
const rowMinW = computed(() => COLUMNS.value.reduce((s, c) => s + colMin(c), 30))
const rowMinStyle = computed(() => ({ minWidth: rowMinW.value + 'px' }))
// facet-key -> row accessor, so a filterSet entry narrows the table (phases 5/6 populate filterSet).
const FACETS = Object.fromEntries(Object.entries(cfg.facets || {}).map(([k, f]) => [k, f.get]))

const allRows = computed(() => (dash?.rows?.value) || [])
const filterSet = bus?.filterSet || {}
const selectionSet = bus?.selectionSet

function matchFacet(r, key, val) {
  const acc = FACETS[key]; if (!acc) return true
  const rv = acc(r)
  return Array.isArray(val) ? val.includes(rv) : rv === val
}
const matchSearch = makeSearchMatcher(bus, buildSearchAccessors(cfg))
const filtered = computed(() => {
  const keys = Object.keys(filterSet)
  const hasText = !!(bus?.searchTerm?.value || '').trim()
  if (!keys.length && !hasText) return allRows.value
  const faceted = allRows.value.filter((r) => keys.every((k) => matchFacet(r, k, filterSet[k])))
  return filterRowsBySearch(faceted, matchSearch)
})

/**
 * ── multi-sort (shift-click stacks; per-column 3-state none->asc->desc->none) ──
 *
 * ★ SORT IS VIEW-LOCAL, AND THAT IS A DECISION, NOT AN OVERSIGHT
 * (card BUG-TABLE-SORT-DOES-NOT-REACH-THE-GRID).
 *
 * The measured symptom was real: sorting Population asc/desc moved THIS table's first row
 * Abai Sungai -> Kensiu -> Luwu while the grid's first card stayed Abai Sungai, with the filter
 * chips constant throughout. The card asked the right question before proposing a channel —
 * should sort be SHARED state at all? — and the answer comes from the contract, not from taste.
 *
 * IT IS NOT A SYMMETRIC DISAGREEMENT BETWEEN TWO PEERS. The grid is a SEPARATE BUNDLE
 * (plugin-designs/people-groups-grid) composed beside this dashboard. It is a props/events
 * component, not a bus subscriber: it takes `query` + `activeFilters` in and emits
 * `groups-filtered` back out. It has NO sort control of its own and NO prop to receive one —
 * its only .sort() call orders facet LABELS, never rows. So "share the sort" is not wiring up an
 * existing capability that got disconnected; it is building a sort feature inside another bundle,
 * adding a prop to its public surface, and adding a channel to useSelectionBus — three files, two
 * of them owned by other authors, for a behaviour nobody has asked to see.
 *
 * FILTERS AND SEARCH ARE DIFFERENT, and the distinction is the reason this is not special
 * pleading: a filter changes WHICH rows exist, so two views disagreeing about it means they are
 * showing different data — a correctness bug. Sort changes only the ORDER of the same rows, so a
 * table ranked by population beside a grid ranked as the API returned them is two presentations
 * of one identical set. Nothing is hidden and no number disagrees.
 *
 * THE CARD'S REAL POINT STANDS THOUGH: today it is "neither", which is the worst of the three,
 * because nothing tells the user which it is. The cure for `neither` is to make the local choice
 * LEGIBLE rather than to plumb a channel — hence the `data-sort-scope="view-local"` marker on the
 * grid and the header tooltip below, which say plainly that sorting orders THIS table. That way a
 * user who sorts does not form an expectation about the grid that the product will not keep.
 *
 * IF A FUTURE RULING WANTS SHARED SORT, it needs all three of: a sort channel on
 * useSelectionBus, a `sort` prop on people-groups-grid, and a row comparator inside that grid.
 * Do not add the bus channel alone — a channel with no subscriber is the "neither" state again,
 * only now with more code.
 */
const sortState = ref([])  // [{ key, dir:'asc'|'desc' }] — LOCAL to this table by design (above)
function onSort(col, ev) {
  const shift = !!(ev && ev.shiftKey)
  const i = sortState.value.findIndex((s) => s.key === col.key)
  if (i < 0) { sortState.value = (shift ? [...sortState.value] : []).concat({ key: col.key, dir: 'asc' }) }
  else if (sortState.value[i].dir === 'asc') { const ns = [...sortState.value]; ns[i] = { key: col.key, dir: 'desc' }; sortState.value = ns }
  else { sortState.value = shift ? sortState.value.filter((s) => s.key !== col.key) : [] }
}
function ariaSort(col) { const s = sortState.value.find((x) => x.key === col.key); return s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none' }
const sorted = computed(() => {
  const ss = sortState.value; if (!ss.length) return filtered.value
  const plan = ss.map((s) => ({ col: COLUMNS.value.find((c) => c.key === s.key), dir: s.dir === 'asc' ? 1 : -1 }))
  return filtered.value.slice().sort((a, b) => {
    for (const { col, dir } of plan) {
      let av = col.get(a), bv = col.get(b)
      if (av === null || av === undefined || av === '') av = col.type === 'num' ? -Infinity : ''
      if (bv === null || bv === undefined || bv === '') bv = col.type === 'num' ? -Infinity : ''
      if (av < bv) return -1 * dir; if (av > bv) return 1 * dir
    }
    return 0
  })
})

// ── selection views: "show only selected" + "selected first" ────────────────────────────────
// Deliberately NOT written into filterSet: selection is ephemeral session state while filters
// are shareable view config (they serialize to the URL hash), so folding a transient pick into
// a filter would leak it into a shared link. These are view toggles layered ON TOP of the
// filter pipeline. Declared here because the pipeline below consumes them.
const onlySelected = ref(false)
const selectedFirst = ref(false)
function toggleOnlySelected() { onlySelected.value = !onlySelected.value }
function toggleSelectedFirst() { selectedFirst.value = !selectedFirst.value }

// `selectionVersion` is the reactive handle on the (deliberately non-reactive) selectionSet —
// see the performance contract in useSelectionBus.js. Every computed reading the set calls this.
const selVer = () => { if (bus && bus.selectionVersion) return bus.selectionVersion.value; return 0 }

// Pipeline: filtered -> sorted -> visibleRows (selection views) -> windowRows (virtualization).
// The views sit HERE, between sort and virtualization, so the window slices the post-view list
// and 'show only selected' genuinely removes rows instead of just hiding painted ones.
const visibleRows = computed(() => {
  let list = sorted.value
  if (onlySelected.value) {
    selVer()
    list = list.filter((r) => selectionSet && selectionSet.has(r.slug))
  }
  if (selectedFirst.value) {
    selVer()
    // Prepended sort key, stable within each group: composes with the user's column sort
    // instead of overriding it (selected rows float to the top, order otherwise preserved).
    const sel = [], rest = []
    for (const r of list) (selectionSet && selectionSet.has(r.slug) ? sel : rest).push(r)
    list = sel.concat(rest)
  }
  return list
})

// ── windowed virtualization (2,106 rows; render only the visible slice) ──
const ROW_H = 26
const scrollTop = ref(0)
const viewH = ref(360)
const scroller = ref(null)
let ro = null
// scrollLeft is tracked for ONE reason: the footer is a sibling of the scrollport, not a child,
// so it does not move when the grid scrolls sideways and the Σ total would drift out from under
// the Population column. Mirroring the offset onto the footer keeps the summary aligned.
const scrollLeft = ref(0)
function onScroll(e) { scrollTop.value = e.target.scrollTop; scrollLeft.value = e.target.scrollLeft }
const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - 6))
const visCount = computed(() => Math.ceil(viewH.value / ROW_H) + 12)
const windowRows = computed(() => visibleRows.value.slice(start.value, start.value + visCount.value))
const padTop = computed(() => start.value * ROW_H)
const padBot = computed(() => Math.max(0, (visibleRows.value.length - (start.value + windowRows.value.length)) * ROW_H))
onMounted(() => {
  if (scroller.value) {
    viewH.value = scroller.value.clientHeight || 360
    ro = new ResizeObserver(() => { viewH.value = scroller.value.clientHeight || viewH.value })
    ro.observe(scroller.value)
  }
  // keep the chevron glyph in sync when the table is toggled from OUTSIDE this component
  // (e.g. the profile's floating "▴ Show table" restore control emits toggleTable=false).
  if (bus) bus.on('toggleTable', (v) => { collapsed.value = !!v })
  // a map pin click (or other panel) selects a PG -> scroll the virtualized table to it + highlight.
  if (bus) bus.on('focusRow', ({ slug } = {}) => {
    if (!slug || !scroller.value) return
    // index into the RENDERED list (visibleRows), not `sorted` — with a selection view active
    // the two differ, and a `sorted` index would scroll to the wrong offset.
    const idx = visibleRows.value.findIndex((r) => r.slug === slug)
    if (idx >= 0) scroller.value.scrollTop = Math.max(0, idx * ROW_H - (viewH.value / 2))
  })
})
// Esc listener on the DOCUMENT, not the wrapper: a keydown only reaches an element that holds
// focus, and in fullscreen the focus is usually still on the button that opened it or on nothing
// at all. Registered once for the component's life rather than toggled with isFull — a listener
// that adds and removes itself is one more thing to leak, and the handler already no-ops when
// the table is not fullscreen.
onMounted(() => { if (typeof document !== 'undefined') document.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => {
  ro && ro.disconnect(); clearTimeout(_toastT)
  if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown)
})

// ── selection (writes to selectionSet via the bus) ──────────────────────────────────────────
const selCount = computed(() => { selVer(); return selectionSet ? selectionSet.size : 0 })
const isSel = (r) => !!(selectionSet && selectionSet.has(r.slug))
// Row renders read through this so the version dep is registered in the render effect.
const selTick = computed(() => selVer())

/**
 * Selection model — the Windows-Explorer semantics formalized in Järvi & Parent,
 * "One Way to Select Many" (ECOOP 2016). Explorer's rules are chosen over Finder's because
 * Finder's anchor placement is documented there as producing user-visible asymmetries.
 *
 *   plain click       → select ONLY this row; anchor = row
 *   ctrl/cmd + click  → toggle THIS row, keep the rest; anchor = row (ctrl DOES move the anchor);
 *                       mode = 'select' if the row was unselected, else 'deselect'
 *   shift + click     → REPLACE the selection with range(anchor → row); anchor stays PINNED
 *   ctrl+shift+click  → ADD (or, in deselect mode, SUBTRACT) range(anchor → row); anchor pinned
 *
 * `anchorSlug` is a STABLE SLUG, never a row index: the grid is virtualized AND sortable, so an
 * index would silently point at a different people group after a re-sort or a DOM recycle.
 *
 * `baseSelection` is the selection as it stood when the anchor was set. Every shift+click
 * recomputes `base ⊕ range` from scratch instead of diffing against the previous range, which
 * makes shift+click idempotent: dragging a range back SHRINKS it and restores what was there
 * before, rather than leaving rows stranded (the Finder bug the paper calls out).
 */
const anchorSlug = ref(null)
const anchorMode = ref('select')      // 'select' | 'deselect' — set by ctrl+click, read by ctrl+shift
let baseSelection = new Set()         // plain Set, non-reactive: pure bookkeeping

function setAnchor(slug, mode) {
  anchorSlug.value = slug
  anchorMode.value = mode
  baseSelection = new Set(selectionSet)
}
// Range over the CURRENTLY VISIBLE order (filtered + sorted + selection views) — the order the
// user actually sees on screen, never the underlying dataset order.
function rangeSlugs(fromSlug, toSlug) {
  const list = visibleRows.value
  const i = list.findIndex((r) => r.slug === fromSlug)
  const j = list.findIndex((r) => r.slug === toSlug)
  if (i < 0 || j < 0) return []
  const [lo, hi] = i <= j ? [i, j] : [j, i]
  const out = []
  for (let k = lo; k <= hi; k++) out.push(list[k].slug)
  return out
}

/**
 * ONE selection gesture = ONE bulk commit. Never loops toggleSelect(): that is precisely the
 * 20-second freeze (BUG-TABLE-BATCH-SELECTION-FREEZES-20S) — 2,107 synchronous map rebuilds.
 */
function applyClick(slug, ev) {
  if (!bus || !slug) return
  const ctrl = !!(ev && (ev.ctrlKey || ev.metaKey))
  const shift = !!(ev && ev.shiftKey)

  if (shift && anchorSlug.value) {
    const range = rangeSlugs(anchorSlug.value, slug)
    if (!range.length) return
    if (ctrl) {
      // ctrl+shift: apply the range ON TOP of the base snapshot, honoring the ctrl mode.
      const next = new Set(baseSelection)
      if (anchorMode.value === 'deselect') for (const s of range) next.delete(s)
      else for (const s of range) next.add(s)
      bus.setSelection(next)
    } else {
      // plain shift: the range REPLACES the selection (Explorer/Finder rule).
      bus.setSelection(range)
    }
    return   // anchor stays pinned so the next shift+click re-extends from the same pivot
  }

  if (ctrl) {
    const willSelect = !selectionSet.has(slug)
    setAnchor(slug, willSelect ? 'select' : 'deselect')
    bus.toggleSelect(slug)
    // re-snapshot AFTER the toggle so a following ctrl+shift extends from the post-toggle state
    baseSelection = new Set(selectionSet)
    return
  }

  // plain click → this row only
  setAnchor(slug, 'select')
  bus.setSelection([slug])
  baseSelection = new Set(selectionSet)
}

// Event delegation on the stable scroll container: per-row @click is unreliable in a
// defineCustomElement bundle when the v-for is virtualized (frequently patched). The container
// receives the bubbled click; resolve the clicked row via data-slug, then apply the gesture.
//
// The CHECKBOX CELL is the exception: it always TOGGLES one row and never clears the rest
// (AG Grid / Helios convention — the checkbox is the "add to selection" affordance, the row
// body is the "replace selection" affordance).
function onGridClick(e) {
  const t = e.target
  if (!t || !t.closest) return
  const rowEl = t.closest('.rd-row')
  if (!rowEl || !bus) return
  const slug = rowEl.getAttribute('data-slug')
  if (!slug) return
  if (t.closest('.rd-td.chk')) {
    // Checkbox column. A MODIFIER always wins: shift must extend the range and ctrl must
    // toggle-with-anchor-move on the checkbox exactly as it does on the row body, or this
    // 30px-wide column becomes a dead zone where the keyboard is silently ignored — the
    // branch below is modifier-blind, so without this line a shift+click on a checkbox is
    // just a plain additive toggle (BUILD-TABLE-PRO-SELECTION-SHIFT-CTRL).
    if (e.shiftKey || e.ctrlKey || e.metaKey) { applyClick(slug, e); return }
    // Unmodified: plain toggle, selection preserved; still moves the anchor (ctrl-like).
    setAnchor(slug, selectionSet.has(slug) ? 'deselect' : 'select')
    bus.toggleSelect(slug)
    baseSelection = new Set(selectionSet)
    return
  }
  applyClick(slug, e)
}
// shift+click natively extends the browser's TEXT selection, smearing blue highlight across
// rows. preventDefault on mousedown kills the range extension at source while leaving the
// click event (and ordinary text copy/paste without shift) completely intact.
function onGridMouseDown(e) {
  if (e.shiftKey && e.target && e.target.closest && e.target.closest('.rd-row')) e.preventDefault()
}

// Header checkbox scope = the CURRENT FILTER (AG Grid's selectAll:'filtered'). Selecting rows
// the user has filtered away is the classic bulk-action footgun.
const allVisibleSelected = computed(() => {
  selVer()
  const f = filtered.value
  if (!f.length) return false
  for (const r of f) if (!selectionSet.has(r.slug)) return false
  return true
})
// Tri-state: some-but-not-all → indeterminate. Derived, never stored.
const someVisibleSelected = computed(() => {
  selVer()
  if (allVisibleSelected.value) return false
  for (const r of filtered.value) if (selectionSet.has(r.slug)) return true
  return false
})
function toggleAll() {
  if (!bus) return
  const slugs = filtered.value.map((r) => r.slug)
  // ONE bulk commit each way — this is the fix for the 20s freeze.
  if (allVisibleSelected.value) bus.deselectMany(slugs)
  else bus.selectMany(slugs)
  anchorSlug.value = null
  baseSelection = new Set(selectionSet)
}
function clearSel() {
  bus && bus.clearSelection()
  anchorSlug.value = null
  baseSelection = new Set()
}

// `indeterminate` is a JS-only property on <input type=checkbox> — there is no HTML attribute
// and it cannot be set from CSS — so bind the element and drive it imperatively. The browser
// then exposes aria-checked="mixed" itself, which is why we do NOT hand-set aria-checked.
const allChkEl = ref(null)
function setAllChkEl(el) { allChkEl.value = el || null }
watch([someVisibleSelected, allChkEl], () => {
  if (allChkEl.value) allChkEl.value.indeterminate = someVisibleSelected.value
}, { immediate: true })

// A range/anchor defined over one row order is meaningless in another — drop it when the user
// re-sorts or the visible set changes underneath them. (Not watched on `selectionSet` itself:
// selecting is exactly when the anchor must SURVIVE.)
//
// Watch a cheap ORDER FINGERPRINT, never `filtered` itself. Watching the computed directly
// compares ARRAY IDENTITY, and on the filtered path `filtered` allocates a NEW array on every
// re-evaluation (the no-filter path returns `allRows.value` unchanged, which is why this only
// ever bit with a search/facet active). Committing a selection re-runs the chain, yields a
// fresh array, and nulls the anchor the very click just set — the gesture ate its own anchor.
// Measured with trusted events at 1440x1200: with a search term active, click row 3 then
// shift+click row 8 gave 1 -> 1 (no range at all); it now gives the correct 1 -> 6.
//
// `filtered.value.length` is O(1) and changes whenever the filter/search genuinely narrows the
// set; sort + the two view toggles cover every other reorder. A same-length filter swap is the
// one case this misses — far cheaper than hashing 2,107 slugs on every selection commit, which
// would put real work back on the hot path the performance contract exists to protect.
watch(
  [sortState, () => filtered.value.length, onlySelected, selectedFirst],
  () => { anchorSlug.value = null },
)

// "Show only selected" with nothing selected would render an empty grid and look broken —
// drop back to the full view automatically when the selection is cleared.
watch(selCount, (n) => { if (!n) onlySelected.value = false })

// ── collapsible bottom dock (P5): chevron emits to the root, which shrinks the table grid row so the
//    map grows. Root is the source of truth for the grid; we mirror the state locally for the chevron. ──
const collapsed = ref(false)
function toggleDock() { collapsed.value = !collapsed.value; bus && bus.emit('toggleTable', collapsed.value) }

/**
 * ── FULLSCREEN (card BUILD-TABLE-HORIZONTAL-SCROLL-AND-FULLSCREEN) ──────────────────────────
 *
 * ★ WHY THIS SHIPS WITH THE SEVEN-ROW CAP AND NOT AFTER IT. The table now shows seven data rows
 * by default to reclaim vertical space. A deliberately small table is only
 * an honest trade if the reader can get a big one on demand; without an escape hatch the cap is
 * just a downgrade. The cap and its release are one change.
 *
 * ★ WHY NOT library/components/map-controls/FullscreenButton.vue. It was read first, as the card
 * required. It does not fit, for three reasons and none of them are style: (1) it resolves its
 * target as `mapContainer.getRootNode().host` — the SHADOW HOST — so pointed at anything in this
 * dashboard it would fullscreen the whole dashboard element (map + charts + table), which is the
 * opposite of "open up the TABLE"; (2) it renders MapControlButton, a 40px circular control built
 * to float over a map canvas, wrong on a flat text toolbar; (3) it depends on vue-i18n, which
 * this bundle does not use. Making it fit means adding a target prop and a chromeless variant to
 * a component with SEVEN map consumers to serve one non-map caller — a parameterization that
 * earns its place only once a second table wants it. So this stays LOCAL to this bundle.
 *
 * ★ CSS PSEUDO-FULLSCREEN, NOT THE FULLSCREEN API — and that is a correctness choice here, not a
 * shortcut. requestFullscreen() promotes the element to the browser's top layer, where it is
 * detached from the page's cascade: the inherited CSS custom properties this table is built on
 * (--dx-line, --dx-surface, --rd-primary, --dx-text) still resolve, but the element is no longer
 * inside .rd-shell, so `.rd-shell.rd-page-scroll .rd-grid { max-height: 7 rows }` STOPS matching
 * in one direction and the sticky header's containing block changes in another. Pinning the
 * wrapper with position:fixed keeps the element exactly where it is in the tree, so every one of
 * those rules keeps applying and we override precisely the two we mean to. It also keeps working
 * inside an iframe embed without an allow="fullscreen" attribute, which is how this dashboard is
 * actually delivered to a host page.
 */
const isFull = ref(false)
const wrapEl = ref(null)
// ★ NATIVE FULLSCREEN, NOT A FIXED OVERLAY: in full screen there was no way to exit it or to export
// the CSV. The bar with BOTH buttons is inside this
// wrap, so structurally they should have been visible -- but position:fixed inside a shadow root
// resolves against any transformed/contained ANCESTOR, not the viewport, and in the cap-5 shell
// that pinned the "fullscreen" wrap to a pane whose top sat above the visible area: the bar (and
// its Exit + Export CSV) rendered off-screen. The leaf host has no such ancestor, which is why
// every leaf measurement passed while the shell was broken -- the two-host rule again.
// element.requestFullscreen() is the wheel the platform ships: the browser guarantees viewport
// coverage regardless of ancestor transforms, supplies ESC natively, and fires fullscreenchange
// so our button state can follow EVERY exit path (ESC, F11, another element taking fullscreen)
// instead of only our own toggle. The .is-full class stays as the styling hook and as the
// fallback when the API is unavailable (iframes without allowfullscreen).
function _syncFull() {
  // ★ SHADOW BOUNDARY: document.fullscreenElement retargets to the outermost shadow HOST, and
  // host.contains(innerNode) is false across the boundary -- so the naive check reported "not
  // fullscreen" while the browser was visibly fullscreen (measured: fullscreenElement had the
  // custom element's empty className, and the button state never flipped). The real element is on
  // the wrap's OWN root: getRootNode().fullscreenElement pierces exactly one level, which is where
  // this wrap lives.
  const w = wrapEl.value
  const root = w && w.getRootNode ? w.getRootNode() : document
  const fsEl = (root && root.fullscreenElement) || document.fullscreenElement
  isFull.value = !!(fsEl && w && (fsEl === w || (fsEl.contains && fsEl.contains(w))))
}
if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', _syncFull)
onBeforeUnmount(() => { if (typeof document !== 'undefined') document.removeEventListener('fullscreenchange', _syncFull) })
function toggleFull() {
  const el = wrapEl.value
  if (el && el.requestFullscreen) {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}) }
    else { el.requestFullscreen().then(_syncFull).catch(() => { isFull.value = true }) }  // fallback: the old overlay
    // isFull follows via fullscreenchange; the collapsed-expand below still applies either way
    if (!isFull.value && collapsed.value) { collapsed.value = false; bus && bus.emit('toggleTable', false) }
    return
  }
  isFull.value = !isFull.value
  // Entering while collapsed would show a fullscreen HEADER BAR and nothing else. The user
  // asked for the table, so expand it — and tell the shell, which owns the grid row, or the
  // shell would still think the table is docked shut when we exit.
  if (isFull.value && collapsed.value) { collapsed.value = false; bus && bus.emit('toggleTable', false) }
  // The ResizeObserver already recomputes viewH from the new clientHeight, which is what drives
  // visCount — so the virtualizer fills the taller keyhole without any extra wiring here.
}
// Esc is the fullscreen contract every user already knows; without it a pseudo-fullscreen
// overlay is a trap, since there is no browser-supplied exit the way the native API gives one.
function onKeydown(e) {
  if (e.key !== 'Escape') return
  // Native fullscreen: delegate to the API so EVERY consumer of fullscreenchange stays in sync.
  // (A real user's ESC is handled by the browser itself; this path serves tests and the overlay
  // fallback, where no browser exit exists and a trapped user was the original defect.)
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}) ; return }
  if (isFull.value) isFull.value = false
}

// ── footer aggregation ──
const sumPop = computed(() => filtered.value.reduce((s, r) => s + (num(r.population) || 0), 0))
const rowCount = computed(() => filtered.value.length)

// ── CSV export (card BUILD-CSV-EXPORT-MOVE-TO-TABLE-HEADER-ALL-FIELDS) ──
// Moved here from the dashboard topbar: the button exports THIS table, so it belongs on this
// table's header bar. The bar is deliberately rendered OUTSIDE the collapse, so the live count +
// this button stay docked under the map when the grid is hidden.
// The exporter honors selection > filter > all and fetches the ALL-FIELDS record lazily.
// labelFor resolves People CODES to names in the export's provenance COMMENT line only — the data
// columns are untouched.
const { labelFor: csvLabelFor } = useTreeLegendLabels(cfg, inject('dataStore', null), inject('searchSourceId', null))
const csv = dash && bus
  ? useCsvExport({ rowStore: dash.rowStore, rows: dash.rows, selectionSet: bus.selectionSet, filterSet: bus.filterSet, FACET_ACC: FACETS, dataOpts: cfg.data, labelFor: csvLabelFor,
      // The table already narrows the screen with this exact matcher (see visibleRows); handing it to the
      // exporter is what makes the download agree with what the reader is looking at.
      searchFilter: (list) => filterRowsBySearch(list, matchSearch) })
  : null
const exportToast = ref('')
const exporting = ref(false)
let _toastT = null
async function onExport() {
  if (!csv || exporting.value) return
  exporting.value = true
  try {
    const r = await csv.exportCsvAsync()
    // The counts keep going through fmt(), which groups digits the way the locale does; only the
    // words around them come from the catalogue. Interpolated rather than concatenated, because the
    // order of "rows", "fields" and the outcome is not the same in every language.
    const how = r.downloaded ? T('dashboard.export_done', 'exported')
      : r.clipboard ? T('dashboard.export_copied', 'copied to clipboard')
      : T('dashboard.export_ready', 'ready')
    exportToast.value = fillParams(T('dashboard.export_toast', '✓ {rows} rows × {fields} fields {how}'),
      { rows: fmt(r.rows), fields: r.fields, how })
  } catch (e) {
    exportToast.value = T('dashboard.export_failed', '✕ Export failed')
  } finally {
    exporting.value = false
    clearTimeout(_toastT); _toastT = setTimeout(() => { exportToast.value = '' }, 3200)
  }
}
// Warm the all-fields cache on hover so the first real click is already wide (and keeps its
// clipboard user-activation instead of spending it on the network round-trip).
function onExportHover() { csv && csv.prefetchExportFields() }

useShadowStyles(`
  .rd-table-wrap{ display:flex; flex-direction:column; height:100%; min-height:0; background:#fff; font-size:12px; }
  /* position:relative establishes the containing block for .rd-bar-hint, which centres itself
     against THIS bar rather than some distant positioned ancestor. Adding it changes nothing
     else: the bar is still a flex row in normal flow at the same size. */
  .rd-table-bar{ position:relative; display:flex; align-items:center; gap:10px; padding:4px 10px; border-bottom:1px solid var(--dx-line, #d1d4cd); flex:0 0 auto; }
  .rd-table-bar .ttl{ font-weight:700; color:var(--rd-ink, #3b463d); } .rd-table-bar .ct{ color:var(--dx-muted, #6d766e); }
  .rd-dock{ all:unset; cursor:pointer; flex:0 0 auto; width:20px; height:20px; line-height:20px; text-align:center; border-radius:4px;
    color:var(--rd-muted, #6d766e); font-size:12px; }
  .rd-dock:hover{ background:var(--rd-bg, #f3f3f1); color:var(--rd-accent,#e67e22); }
  /* selection-count badge — the standard tint/ink/border badge recipe, resolved through the
     sage tokens instead of the blue tint-set it was authored with: weak accent fill,
     primary ink, hairline border. */
  .rd-pill{ display:inline-flex; align-items:center; gap:6px; font-weight:700; font-size:11px; padding:3px 9px; border-radius:999px;
    background:var(--dx-accent-weak, rgba(146,177,149,.18)); color:var(--dx-text, #3b463d); border:1px solid var(--dx-line, #d1d4cd); }
  .rd-pill button{ all:unset; cursor:pointer; color:var(--dx-text, #3b463d); opacity:.7; } .rd-pill button:hover{ opacity:1; }
  /* Selection VIEW toggles (only-selected / selected-first). Deliberately slim + quiet: they sit
     beside the count pill but must not compete with Export CSV for attention. Material-light DX
     palette — surface #f3f3f1, border #d1d4cd, ink #3b463d, primary #92b195 when engaged. */
  .rd-table-bar .rd-vtog{ all:unset; box-sizing:border-box; cursor:pointer; flex:0 0 auto; user-select:none;
    font-size:10px; font-weight:700; letter-spacing:.2px; color:var(--dx-muted,#6d766e);
    background:var(--dx-surface,#f3f3f1); border:1px solid var(--dx-line,#d1d4cd);
    border-radius:var(--r-pill,999px); padding:3px 9px; line-height:14px; white-space:nowrap; }
  .rd-table-bar .rd-vtog:hover{ color:var(--dx-text,#3b463d); border-color:#b9bdb4; }
  .rd-table-bar .rd-vtog.on{ color:#2b352c; background:var(--rd-primary,#92b195); border-color:#84a487; }
  .rd-table-bar .rd-vtog:focus-visible{ outline:2px solid #6d8a70; outline-offset:2px; }
  /* pushes the export cluster to the right edge of the bar (the pill used to hold margin-left:auto) */
  .rd-bar-sp{ flex:1 1 auto; }
  /* The centred explainer.
     ★ ABSOLUTE, NOT A FLEX ITEM — measured, not assumed. The first attempt put it between two
     flex spacers, which centres it in the LEFTOVER space, not in the BAR: measured 55px off
     centre at both 1440px and 1280px, because the left cluster (dock/title/count/selection
     controls) and the right cluster (toast/Export CSV) have different widths. Absolute
     positioning at left:50% + translateX(-50%) is relative to the bar itself, so the clusters
     cannot drag it.
     Out of flow means it adds ZERO height by construction — the hard constraint.
     pointer-events:none so it can never intercept a click meant for a control beneath it. */
  .rd-bar-hint{ position:absolute; left:50%; transform:translateX(-50%);
    max-width:38%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    pointer-events:none; color:var(--dx-muted, #6d766e); font-size:12px; }
  /* Hidden where the clusters would collide with it — at narrow widths there is no free middle. */
  @media (max-width: 1100px){ .rd-bar-hint{ display:none; } }
  /* ★ THE BAR IS A SELECTION TOOLBAR WHILE A SELECTION EXISTS (the 1280px flood, measured: with
     one row selected the bar wrapped to 43px and pushed a control out of it -- the
     "flooded with buttons that overflow"). The centred hint and the selection cluster cannot both
     fit a 666px middle column, and the hint is the one carrying redundant information there: its
     count already lives in the selection pill. It yields exactly while a selection exists and
     returns the moment the selection clears -- state-scoped, so the resting bar is unchanged.
     (The 1100px media rule above is the same idea keyed on width; this one is keyed on state.) */
  .rd-table-wrap:not([data-sel-count="0"]) .rd-bar-hint{ display:none; }
  /* ★ MEASURED AT 1280 (the selection flood, second cause): hiding the hint was not enough -- the
     in-flow title and count are separate children, and squeezed to 48px the title wrapped
     INTERNALLY ("People"/"Groups" on two lines), growing the bar to 43px and tumbling the spacer.
     While a selection exists they say nothing the bar does not already say -- the pill carries the
     selection count and the composite's own section header above the table already reads "People
     Groups" -- so they yield with the hint and return on clear. After: every child on one 32px
     line at 1280, zero overflow. */
  .rd-table-wrap:not([data-sel-count="0"]) .ttl,
  .rd-table-wrap:not([data-sel-count="0"]) .ct{ display:none; }
  .ttl{ white-space:nowrap; }  /* and the title may never two-line itself, selection or not */
  /* Export CSV — lives on THIS bar now (moved from the dashboard topbar). Material-light DX palette:
     primary #92b195 surface, deep ink label, border #d1d4cd. Stays visible while collapsed. */
  .rd-table-bar .rd-csv{ display:inline-flex; align-items:center; gap:6px; flex:0 0 auto; cursor:pointer; user-select:none;
    font-size:11px; font-weight:700; letter-spacing:.2px; color:#2b352c; background:var(--rd-primary,#92b195);
    border:1px solid #84a487; border-radius:var(--r-md,6px); padding:4px 11px; }
  .rd-table-bar .rd-csv:hover{ background:#84a487; color:#1f271f; }
  .rd-table-bar .rd-csv:focus-visible{ outline:2px solid #6d8a70; outline-offset:2px; }
  .rd-table-bar .rd-csv.busy{ opacity:.65; cursor:progress; }
  .rd-table-bar .rd-csv-n{ background:#ffffff66; border-radius:var(--r-pill,999px); padding:0 6px; font-size:10px; }
  .rd-table-bar .rd-toast{ flex:0 0 auto; font-size:11px; font-weight:700; color:#33603f; background:#eaf3ec;
    border:1px solid #c3dbc7; border-radius:var(--r-md,6px); padding:3px 9px; white-space:nowrap; }
  /* Thin overlay scrollbars on the virtualized grid. The table scrolls BOTH axes, so the corner
     is made transparent too or it renders as a grey notch against the sticky header
     (BUILD-MATERIAL-THIN-OVERLAY-SCROLLBARS). */
  /* ★ BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID — the real cause, found 2026-09-22 after three wrong
     diagnoses that all blamed the map. MEASURED in the cap-5 shell: a ten-tick wheel (3000px) with
     the cursor over the dashboard moved the outer .ps-pane only 300px, while THIS element's
     scrollTop went 0 -> 2606. The wheel was never reaching the pane because it was being consumed
     here: a virtualized table whose scrollHeight is 54834px inside a clientHeight of ~207px. That
     is normal scroll-chaining — a nested scrollport eats wheel events until it hits its own end and
     only then passes the remainder to its parent. With 54 THOUSAND pixels of table it never hits
     the end, so in practice the pane never scrolls and the grid below stays unreachable.

     overscroll-behavior:contain does NOT stop this element scrolling; it stops it CHAINING. The
     defect it fixes is the opposite direction from the one on .vtl-host (which uses the same
     property to stop a bottomed-out pane scrolling the document behind it).

     ★ WHY THE MAP LOOKED GUILTY and was not: the Mapbox canvas sits at y≈370 while the measuring
     gesture is at y=420, so the wheel lands BELOW the map, on the table. scrollZoom was a plausible
     culprit, and syncScrollZoomToHost genuinely did sample a layout-dependent condition on fixed
     timeouts, so fixing that felt like fixing this. It was a real race and a real fix — just not
     this bug. Verify the element under the cursor before blaming the one nearby. */
  /* ★ overscroll-behavior is deliberately LEFT AT ITS DEFAULT (auto). A previous fix for
     BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID set it to contain here, which is exactly backwards: contain
     stops a scroll that bottoms out in this element from CHAINING to the parent, and chaining to the
     parent is the behaviour that lets the page keep moving once the table is exhausted. Setting it
     made the trap tighter, not looser. Measured: no change at all to the symptom, because the table
     has 54834px of content and never bottoms out in the first place.

     The wheel target here was verified by instrumenting the event rather than by geometry — a
     capture-phase listener reporting event.composedPath() at the cursor. getBoundingClientRect had
     reported this element well below the cursor and was misleading; the dispatched path
     (rd-td -> rd-row -> rd-grid) is authoritative. Use the event path when the two disagree. */
  .rd-grid{ flex:1 1 auto; min-height:0; overflow:auto; position:relative;
    scrollbar-width:thin; scrollbar-color:var(--dx-scroll-thumb, #c4c8c0) transparent; }
  .rd-grid::-webkit-scrollbar{ width:8px; height:8px; }
  .rd-grid::-webkit-scrollbar-track{ background:transparent; }
  .rd-grid::-webkit-scrollbar-thumb{ background:var(--dx-scroll-thumb, #c4c8c0); border-radius:8px; }
  .rd-grid::-webkit-scrollbar-thumb:hover{ background:#9aa197; }
  .rd-grid::-webkit-scrollbar-corner{ background:transparent; }
  /* ★ STICKY ON THE VERTICAL AXIS ONLY, AND THAT IS CORRECT. position:sticky pins against the
     SCROLLPORT, so with top:0 and no left, the header stays put while scrolling DOWN and
     travels sideways with the body while scrolling RIGHT — which is exactly what a header must
     do, or the labels would detach from the columns they name.
     The one thing that breaks is the BACKGROUND: a sticky element paints only its own box, so if
     the header were narrower than the scrolled content the rows would show through beside it as
     the user scrolls right. min-width matches the rows' own floor so the header spans the whole
     scrollable width and the sticky band stays opaque end to end. */
  .rd-thead{ position:sticky; top:0; z-index:2; display:flex; width:100%; background:var(--dx-surface, #f3f3f1); border-bottom:1px solid var(--dx-line, #d1d4cd); }
  /* padding 4px 4px, not 3px 8px — two reasons, both from the standards reference.
     (1) SPACE: measured at 1280 the eight columns need 721px of pure content against ~727px of column
     space, so 16px of horizontal padding per column (128px total) is unaffordable. Trimming to 8px/col
     recovers 64px and takes the shortfall from 122px to 58px. The reference is explicit that when space
     is tight you cut PADDING AND CHROME FIRST, never type size.
     (2) GRID: 3px was off the 4px spacing grid (the reference's 'never use 3, 5, 7, 10, 13, 15px').
     HONEST LIMIT: this IMPROVES 1280, it does not solve it — 8 text columns genuinely do not fit there.
     Closing that gap is a product call (drop a column at narrow widths, or scroll horizontally), not a
     CSS one. At 1440 the table already fits with 0 of 8 truncated. */
  /* ★ NO ELLIPSIS ON THE HEADER: the table shows FULL headers, never abbreviated ones.
     text-overflow:ellipsis DESTROYS information with no way to
     recover it — the reader cannot widen a truncated word, and 'Engageme…' is not a column name.
     Horizontal scroll PRESERVES it: the full text always exists and is always reachable. This is
     the same trade already applied to the chart legends (nowrap + overflow-x:auto) in the commit
     that capped this table at seven rows; the two surfaces deliberately use ONE mechanism rather
     than each inventing its own.
     overflow stays HIDDEN rather than visible: the floor from colMin() guarantees the label fits,
     so nothing is clipped in practice, and hidden keeps a pathological config (a 40-character
     label with an explicit narrow minW) from painting over the next column. */
  .rd-th{ flex:1 1 0; min-width:0; padding:4px 4px; font-weight:700; color:var(--dx-text, #3b463d); cursor:pointer; user-select:none; white-space:nowrap; overflow:hidden; }
  .rd-th.num{ text-align:end; } .rd-th.chk{ flex:0 0 30px; cursor:default; text-align:center; padding:6px 0; }
  /* sort indicator — the glyph carries the meaning; colour only needs to read as ACTIVE
     against the muted header row, so it takes primary ink rather than a hue of its own. */
  .rd-th .ind{ font-size:9px; color:var(--dx-text, #3b463d); margin-inline-start:3px; }
  /* ★ THE ROW WIDTH IS SHARED, NEVER INTRINSIC — and getting this wrong is invisible in the
     numbers. Two facts had to be reconciled:
     (1) min-width ALONE DOES NOT CREATE OVERFLOW. A block-level flex container inside the
         scrollport is width:auto, so it fills the scrollport and no more; .rd-grid's scrollWidth
         measured exactly its clientWidth (878 = 878, canScrollX FALSE) with the floors in place.
     (2) width:max-content DOES create the overflow, but sizes EVERY ROW TO ITS OWN CONTENT, so a
         row holding "Lao People's Democratic Republic" lays out wider than the row above it. That
         is not a table, it is a stack of independent flex lines: SCREENSHOT-VERIFIED ragged, with
         Country/Region/Language stepping left and right on consecutive rows while the header —
         correctly aligned — disagreed with all of them. The measurement even said so and I read
         past it: scrollWidth was 969 at the top of the list and 1051 after scrolling, i.e. the
         table's own width depended on which rows happened to be rendered.
     The resolution is an EXPLICIT shared width, the same number on every row: min-width is the
     summed floor (rowMinStyle, applied inline to head/rows/footer alike) and width:100% makes the
     row fill the scrollport when the scrollport is the wider of the two. Nothing is intrinsic, so
     all rows resolve identically and the column grid holds at every scroll offset. */
  .rd-row{ display:flex; width:100%; height:26px; line-height:16px; border-bottom:1px solid var(--dx-surface, #f3f3f1); align-items:center; }
  .rd-row:hover{ background:var(--dx-surface, #f3f3f1); } .rd-row.sel{ background:#fff7ec; box-shadow:inset 3px 0 0 #e67e22; }
  .rd-td{ flex:1 1 0; min-width:0; padding:0 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--dx-text, #3b463d); }
  .rd-td.num{ text-align:end; font-variant-numeric:tabular-nums; } .rd-td.chk{ flex:0 0 30px; text-align:center; padding:0; }
  /* ★ THE FOOTER IS A SEPARATE SCROLLPORT and has to be told to follow. .rd-foot is a SIBLING of
     .rd-grid, not a child, so scrolling the grid right does not move it — the Σ total would slide
     out of alignment with the Population column the moment the table scrolled. overflow:hidden +
     a matching min-width child lets us translate it in lockstep from the scroll handler, which is
     what keeps the summary row under its own column at every scroll offset. */
  .rd-foot{ flex:0 0 auto; display:flex; border-top:2px solid var(--dx-line, #d1d4cd); background:var(--dx-surface, #f3f3f1); font-weight:700; height:28px; align-items:center; color:var(--dx-text, #3b463d); overflow:hidden; }
  .rd-foot .rd-td{ color:var(--dx-text, #3b463d); }
  .rd-foot-inner{ display:flex; align-items:center; height:100%; width:100%; flex:0 0 auto; }
  /* ── FULLSCREEN (pseudo, CSS-only — see toggleFull() for why not requestFullscreen) ──────────
     position:fixed takes the wrapper out of the shell's grid row without moving it in the TREE,
     so every inherited token and every ancestor rule still applies and we override only what we
     mean to. z-index sits just under the max a browser honours, above the map's own controls. */
  .rd-table-wrap:fullscreen{ background:var(--dx-elevated,#fff); overflow:auto; }
  .rd-table-wrap:fullscreen .rd-grid{ max-height:none !important; }
  .rd-table-wrap.is-full{ position:fixed; top:0; left:0; right:0; bottom:0; z-index:2147483646;
    height:100dvh; width:100vw; box-shadow:0 0 0 100vmax rgba(59,70,61,.22); }
  /* ★ THE OVERRIDE THAT ACTUALLY DOES THE WORK. The shell caps this element at seven rows via
     .rd-shell.rd-page-scroll .rd-grid{ max-height: calc(var(--rd-table-rows,7) * ...) }, which
     lives in research-dashboard.vue and keeps matching while we are fixed-positioned (we never
     left the tree). Without this line the wrapper would go fullscreen and the grid inside it
     would stay 182px tall in a 900px box. The value none, rather than a pixel, so EXIT restores by
     simply dropping the class — the seven-row promise is re-derived from its own declaration,
     never copied into a second number that could drift from it. */
  /* ★ MEASURED, NOT ASSUMED — the first attempt at this rule LOST and the probe caught it.
     .rd-table-wrap.is-full .rd-grid is two classes; the shell's cap is
     .rd-shell.rd-page-scroll .rd-grid, which is THREE. Specificity 0-2-0 vs 0-3-0, so the
     seven-row cap won and fullscreen rendered a 900px box containing a 182px table — the exact
     failure the comment above warns about, produced by the fix for it. Measured: wrapH went
     244 -> 900 while grid clientH stayed 182.
     Repeating .is-full raises this to 0-3-0 AND, being more specific than the shell rule at equal
     class count, wins on source order only if this sheet is later — which is not guaranteed
     across two shadow roots. !important is the honest tool here: this is a deliberate, scoped
     override of a known cap, not a specificity war with an unknown author. */
  .rd-table-wrap.is-full .rd-grid{ max-height:none !important; }
  /* The fullscreen toggle itself — same slim, quiet toolbar face as the selection view toggles,
     so the bar reads as one set of controls rather than a button bolted on. */
  .rd-table-bar .rd-fs{ all:unset; box-sizing:border-box; cursor:pointer; flex:0 0 auto; user-select:none;
    font-size:10px; font-weight:700; letter-spacing:.2px; color:var(--dx-muted,#6d766e);
    background:var(--dx-surface,#f3f3f1); border:1px solid var(--dx-line,#d1d4cd);
    border-radius:var(--r-pill,999px); padding:3px 9px; line-height:14px; white-space:nowrap; }
  .rd-table-bar .rd-fs:hover{ color:var(--dx-text,#3b463d); border-color:#b9bdb4; }
  .rd-table-bar .rd-fs.on{ color:#2b352c; background:var(--rd-primary,#92b195); border-color:#84a487; }
  .rd-table-bar .rd-fs:focus-visible{ outline:2px solid #6d8a70; outline-offset:2px; }
`, 'rd-datatable')
</script>

<template>
  <div ref="wrapEl" class="rd-table-wrap" :class="{ 'is-full': isFull }" :data-sel-count="selCount"
       :data-fullscreen="isFull ? '1' : '0'">
    <!-- Header bar — ALWAYS rendered, collapsed or not. The count + Export CSV are the two
         controls that must stay docked under the map when the grid is hidden. -->
    <div class="rd-table-bar" :data-collapsed="collapsed ? '1' : '0'">
      <button class="rd-dock" :title="collapsed ? T('dashboard.expand_table', 'Expand table') : T('dashboard.collapse_table', 'Collapse table — grow the map')"
              data-table-dock :aria-expanded="collapsed ? 'false' : 'true'" @click="toggleDock">{{ collapsed ? '▴' : '▾' }}</button>
      <span class="ttl">{{ T('legend.titleBar.peopleGroups', 'People Groups') }}</span>
      <span class="ct" data-table-count>{{ fmt(rowCount) }} {{ rowCount === 1 ? T('dashboard.group', 'group') : T('dashboard.groups', 'groups') }}</span>
      <!-- role=status so assistive tech announces the count as the selection changes. -->
      <!-- ★ NO CLEAR BUTTON IN THIS BAR (on the selection flood, 2026-09-23: "it does not
           need to give me a Clear Selected button in the header because the FOOTER of the page
           already gives me that"). One action, one home; this pill is a status readout only.
           ★ VERIFIED WHAT ACTUALLY CLEARS, rather than repeating the premise: no literal footer
           clear exists in THIS component -- the surviving clear paths are the thead master
           checkbox (un-checking it deselects all rows) and the detail drawer's close
           (DashboardDetailDrawer.vue:104 calls bus.clearSelection()). Both remain, so removing
           the header x removes a DUPLICATE, not the capability. clearSel() stays defined for the
           bus and any future caller. This also deletes the one control in the cluster that read
           as "a button that doesn't make sense" -- a bare x with no label. -->
      <span v-if="selCount" class="rd-pill" data-sel-pill role="status">
        <span>{{ fmt(selCount) }} {{ T('dashboard.selected', 'Selected') }}</span>
      </span>
      <!-- Selection VIEWS — separated from the pill because they mutate the VIEW, not the
           selection. Only meaningful once something is selected, so they appear with it. -->
      <template v-if="selCount">
        <button class="rd-vtog" :class="{ on: onlySelected }" data-only-selected
                :aria-pressed="onlySelected ? 'true' : 'false'"
                :title="T('dashboard.only_selected_hint', 'Show only the selected people groups')" @click="toggleOnlySelected">{{ T('dashboard.only_selected', 'Only selected') }}</button>
        <button class="rd-vtog" :class="{ on: selectedFirst }" data-selected-first
                :aria-pressed="selectedFirst ? 'true' : 'false'"
                :title="T('dashboard.selected_first_hint', 'Float the selected people groups to the top, keeping your column sort')" @click="toggleSelectedFirst">{{ T('dashboard.selected_first', 'Selected first') }}</button>
      </template>
      <span class="rd-bar-sp"></span>
      <!--
        ★ NO EXPLANATORY HINT HERE (reported, 2026-09-22: "there does not need to be this text in the
        table header / Filtering or selecting above updates this list").

        The text read "Filtering or selecting above updates this list". Its history is worth keeping
        because it records a judgement that got REVERSED rather than a mistake: v1 put it in a second
        header above the grid, the request was for it to ride the EXISTING bar instead, and it was
        centred by absolute positioning against the bar (flex spacers split the LEFTOVER space, so
        the hint landed 55px off centre at 1440px and 1280px because the left and right clusters
        differ in width). All of that was right, and the text still had to go.

        THE REASON IT GOES: the behaviour it described is the one thing on this surface that needs no
        description. Filter above, the list below changes — the user sees the count move the moment
        they act. A caption narrating visible feedback is chrome that costs attention on every view
        to explain something learned once, and never again.

        Keep .rd-bar-hint's CSS: it is the centring recipe, and re-deriving it would repeat the
        55px-off-centre measurement. If a future caption genuinely earns its place, reuse the class.
      -->

      <span v-if="exportToast" class="rd-toast" data-export-toast>{{ exportToast }}</span>
      <!-- Fullscreen. Sits in the RIGHT cluster beside Export CSV because both act on the table
           as a whole, where the left cluster's controls act on the SELECTION. Rendered outside
           the v-if="selCount" block: unlike the view toggles this is useful with nothing
           selected, which is most of the time. -->
      <button class="rd-fs" :class="{ on: isFull }" data-table-fullscreen
              :aria-pressed="isFull ? 'true' : 'false'"
              :title="isFull ? T('dashboard.fs_exit_hint', 'Exit full screen (Esc) — back to seven rows')
                             : T('dashboard.fs_open_hint', 'Open this table full screen')"
              :aria-label="isFull ? T('dashboard.fs_exit', 'Exit full screen') : T('dashboard.fs_open', 'Open table full screen')"
              @click="toggleFull">{{ (isFull ? '⤡ ' : '⤢ ') + T('buttons.toggleFullscreen', 'Full screen') }}</button>
      <span class="rd-csv" :class="{ busy: exporting }" role="button" tabindex="0" data-csv-btn
            :aria-busy="exporting ? 'true' : 'false'"
            :title="selCount ? T('dashboard.export_selected_hint', 'Export all fields — selected people groups: {n}').replace('{n}', fmt(selCount))
                             : T('dashboard.export_all_hint', 'Export all fields — people groups: {n}').replace('{n}', fmt(rowCount))"
            @click="onExport" @mouseenter="onExportHover" @focus="onExportHover"
            @keydown.enter.prevent="onExport" @keydown.space.prevent="onExport">
        {{ exporting ? '…' : '↓' }} {{ T('dashboard.export_csv', 'Export CSV') }}<span v-if="selCount" class="rd-csv-n">{{ selCount }}</span>
      </span>
    </div>

    <!-- data-sort-scope records the RULING (card BUG-TABLE-SORT-DOES-NOT-REACH-THE-GRID) in a form
         a gate or a future reader can query: sort is deliberately view-local, not an unfinished
         bus channel. The reasoning lives on `sortState` in <script>. -->
    <div v-show="!collapsed" ref="scroller" class="rd-grid" role="grid" aria-multiselectable="true"
         data-sort-scope="view-local"
         :data-sort-by="sortState.map((s) => s.key + ':' + s.dir).join(',')"
         :aria-rowcount="visibleRows.length + 1" @scroll="onScroll" @click="onGridClick" @mousedown="onGridMouseDown">
      <!-- :style min-width — the flex line must be free to exceed the scrollport, or the row
           shrinks to fit and there is nothing to scroll. Head, body and footer all carry the
           SAME floor for the same reason they all carry the same flex weight: three different
           widths would mean three different column grids. -->
      <div class="rd-thead" role="row" :style="rowMinStyle">
        <div class="rd-th chk" style="cursor:pointer" :title="(allVisibleSelected ? T('dashboard.deselect_all', 'Deselect all') : T('dashboard.select_all', 'Select all')) + ' ' + fmt(rowCount)" @click="toggleAll">
          <!-- tri-state: `indeterminate` is a JS-only property (no HTML attribute), so it is set
               via a ref callback; the browser then reports aria-checked="mixed" for us. -->
          <input type="checkbox" :checked="allVisibleSelected" :ref="setAllChkEl"
                 :aria-label="allVisibleSelected ? T('aria.deselectAllRows', 'Deselect all rows') : T('aria.selectAllRows', 'Select all rows')" tabindex="-1" style="pointer-events:none" />
        </div>
        <!-- :style flex weight — see dashboard.config.js `columns[].w`. Header, body and FOOTER must
             all carry the same weight or the summary row drifts out of alignment with its columns. -->
        <!-- `title` states the SCOPE of the sort, because scope is the one thing a sort arrow
             cannot show. Sorting orders THIS table only (see the sortState note in <script>);
             saying so on the control is what turns a silent local choice into an honest one. -->
        <div v-for="col in COLUMNS" :key="col.key" class="rd-th" :class="{ num: col.type === 'num' }"
             :style="colFlex(col)"
             :title="sortTitle(col.label)"
             role="columnheader" :aria-sort="ariaSort(col)" :data-col="col.key" @click="onSort(col, $event)"
             tabindex="0" @keydown.enter.prevent="onSort(col, $event)" @keydown.space.prevent="onSort(col, $event)">
          {{ col.label }}<span class="ind">{{ ariaSort(col) === 'ascending' ? '▲' : ariaSort(col) === 'descending' ? '▼' : '' }}</span>
        </div>
      </div>

      <div :style="{ height: padTop + 'px' }"></div>
      <!-- `selTick` is read in the row key-path so the render effect subscribes to
           selectionVersion (selectionSet itself is a plain, non-reactive Set). -->
      <div v-for="(r, i) in windowRows" :key="r.slug" class="rd-row" :class="{ sel: selTick >= 0 && isSel(r) }" role="row"
           :data-slug="r.slug" :aria-selected="isSel(r) ? 'true' : 'false'"
           :style="rowMinStyle"
           :aria-rowindex="start + i + 2">
        <div class="rd-td chk" role="gridcell">
          <input type="checkbox" class="rd-rowchk" :checked="isSel(r)" :aria-label="'Select ' + r.name" tabindex="-1" style="pointer-events:none" />
        </div>
        <div v-for="col in COLUMNS" :key="col.key" class="rd-td" :class="{ num: col.type === 'num' }"
             :style="colFlex(col)" role="gridcell">
          {{ col.type === 'num' ? fmt(col.get(r)) : col.get(r) }}
        </div>
      </div>
      <div :style="{ height: padBot + 'px' }"></div>
    </div>

    <div v-show="!collapsed" class="rd-foot" role="row">
      <!-- DERIVED from COLUMNS, not hardcoded. It used to be a fixed run of nine <div>s, which
           silently assumed both the column COUNT and their ORDER: adding or reordering a column in
           dashboard.config.js would have slid the Σ population figure under the wrong heading with
           nothing to catch it. Now each footer cell is the same v-for carrying the same flex weight,
           so the summary row cannot drift out of alignment with the columns above it. -->
      <!-- translateX mirrors the grid's scrollLeft: the footer is a SIBLING of the scrollport,
           so without this the Σ population total stays put while its column scrolls away. -->
      <div class="rd-foot-inner" :style="[rowMinStyle, { transform: 'translateX(' + (-scrollLeft) + 'px)' }]">
        <div class="rd-td chk"></div>
        <div v-for="(col, i) in COLUMNS" :key="'f-' + col.key" class="rd-td"
             :class="{ num: col.type === 'num' }" :style="colFlex(col)">
          <!-- ★ "groups" WAS THE LAST ENGLISH WORD IN THIS TABLE (KA3, ?lang=ar): the footer read
               "Σ 2,107 groups" on an Arabic page. dashboard.groups already ships in all eleven locales
               (ar "مجموعة"), so this is a call site that never read its own catalogue -- no new
               string, no new key. Singular/plural is written the same way as the header count at
               L794 -- the two say the same thing about the same number and would otherwise disagree at
               one row. Σ and the numeral stay as they are: NUMERALS ARE HELD. -->
          <template v-if="i === 0">Σ {{ fmt(rowCount) }} {{ rowCount === 1 ? T('dashboard.group', 'group') : T('dashboard.groups', 'groups') }}</template>
          <template v-else-if="col.key === 'population'">{{ fmt(sumPop) }}</template>
        </div>
      </div>
    </div>
  </div>
</template>
