/**
 * useBoard.js — the board's ONE shared state, provided to every panel (SPEC-DASHBOARD-KIT section 5.1,
 * level 1: panels never talk to each other; they read and write one injected bus).
 *
 * Built FROM the kit: the bus is library/composables/useSelectionBus.js, unchanged. What is here is the
 * thin glue the kit does not have yet — data loading, view presets and query-param URL state (kit D2,
 * decided, not built) — written to the contract so each piece can be swapped for the kit's when it lands.
 *
 * Provides 'giBoard': { bus, all, filtered, meta, loading, error, view, sort, openSlug, listId, ... }.
 */
import { ref, shallowRef, computed, watch, inject, provide, markRaw } from 'vue'
import { createSelectionBus } from '@map/composables/useSelectionBus.js'
import { resolveAssetsBase, resolveShareUrl } from '@map/utils/embedBase.js'
import { applyPeopleGroupList, resolvePeopleGroupList, LIST_DEFAULT } from '@map/lists/peopleGroupList.js'
import * as M from './model.js'

export const EMBED_PATH = 'gospel-internet/board/index.html'

export function useBoard() {
  const profileConfig = inject('profileConfig', ref(null))
  const cfg = () => profileConfig.value || {}

  const bus = createSelectionBus()
  bus.configureHierarchy({ facetRail: M.FACET_RAIL })

  const all = shallowRef([])
  const bySlug = shallowRef(new Map())
  const meta = shallowRef({})
  const countries = shallowRef({})           // iso3 -> { messaging, top_messaging, in_app_feed, social, social_month }
  const readiness = shallowRef({ meta: {}, byIso: new Map() })   // translation readiness, per language
  const loading = ref(true)
  const error = ref('')
  const listId = computed(() => resolvePeopleGroupList(profileConfig.value))
  const listIsDefault = computed(() => listId.value === LIST_DEFAULT)

  const view = ref('board')
  const sort = ref({ key: 'population', dir: -1 })
  const openSlug = ref('')                 // the group in the detail drawer ('' = closed)
  // ── the centre panel: the geographic map or the language tree (loaded on first use) ───────────────
  const centre = ref('tree')                // people come for the language tree; the map is one tap away
  const tree = shallowRef(null)              // indexTree(doc) + { meta }
  const resources = shallowRef(null)         // { meta, rows } — gospel links for the board's languages
  const treeNode = ref('')                   // the tree node the board is narrowed to ('' = none)
  let treeLoading = null

  // Every panel's row set. The filterSet reads inside rowMatchesFilters are reactive, so this recomputes
  // on any facet change; searchTerm is read explicitly for the same reason.
  const filtered = computed(() => {
    const term = bus.searchTerm.value
    for (const k of Object.keys(bus.filterSet)) void bus.filterSet[k]
    return M.filterRows(all.value, bus, M.FACET_ACC, term)
  })
  const sorted = computed(() => M.sortRows(filtered.value, sort.value))
  const openRow = computed(() => (openSlug.value && bySlug.value.get(openSlug.value)) || null)

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const base = resolveAssetsBase(cfg())
      const [res, rres] = await Promise.all([fetch(`${base}/tables/gospel-internet.json`), fetch(`${base}/tables/gospel-internet-readiness.json`).catch(() => null)])
      if (!res.ok) throw new Error(`gospel-internet.json HTTP ${res.status}`)
      const doc = await res.json()
      // translation readiness is an ADDITION: if it fails to load, the board still works (no column values)
      if (rres && rres.ok) {
        const rd = await rres.json()
        readiness.value = markRaw({ meta: rd.meta || {}, byIso: new Map((rd.rows || []).map((r) => [r.iso, r])) })
      }
      // The universal `list` prop: the rows of the page's people-group list, and none if it cannot be
      // loaded (applyPeopleGroupList fails CLOSED — never DOXA's whole list under another list's name).
      const rows = await applyPeopleGroupList(M.normalizeRows(doc), profileConfig.value)
      for (const r of rows) {
        const x = readiness.value.byIso.get(r.iso639_3)
        // The column RANKS languages WITHOUT a New Testament (the translation question): a language that has
        // one scored 5 (its Bible counted as Scripture) and sorted to the top, the opposite of what a
        // translation team needs. Blank sorts last; the drawer still shows the signals.
        r.open_data = x && !x.nt ? x.signals : null
        r.open_grammar = x && x.grammar ? x.grammar : ''
        r.open_scripture_books = x ? x.scripture_books : null
        r.open_wikipedia = x ? x.wikipedia : ''
        r.open_speech_hours = x ? x.speech_hours : null
        r.open_benchmark = x ? x.benchmark : ''
      }
      meta.value = markRaw(doc.meta || {})
      countries.value = markRaw(doc.countries || {})
      all.value = markRaw(rows)
      bySlug.value = markRaw(new Map(rows.map((r) => [r.slug, r])))
    } catch (e) {
      error.value = String(e?.message || e)
    } finally {
      loading.value = false
    }
  }

  async function loadTree() {
    if (tree.value) return tree.value
    if (!treeLoading) {
      const base = resolveAssetsBase(cfg())
      treeLoading = Promise.all(['gospel-internet-tree.json', 'gospel-internet-resources.json'].map((f) =>
        fetch(`${base}/tables/${f}`).then((r) => { if (!r.ok) throw new Error(`${f} HTTP ${r.status}`); return r.json() })))
        .then(([t, res]) => {
          tree.value = markRaw({ ...M.indexTree(t), meta: t.meta || {} })
          resources.value = markRaw(res)
          applyPendingTree()
          return tree.value
        })
        .catch((e) => { treeLoading = null; throw e })
    }
    return treeLoading
  }
  // The centre panels, in the required order. This is a LIST rather than
  // a pair because the previous form — `mode === 'tree' ? 'tree' : 'map'` — silently
  // resolved every unknown id to the map. Adding a panel to the tab strip without adding
  // it here would have rendered the map under the new tab's label: no error, no empty
  // state, just the wrong panel wearing the right name. An unknown id is now a WARNING
  // and the default, which is how this codebase already treats an unknown people-group
  // list (peopleGroupList.js: fall back to the default and say so once).
  const CENTRE_PANELS = ['tree', 'bounded', 'centered', 'map']
  const warnedCentre = new Set()
  function setCentre(mode) {
    if (CENTRE_PANELS.includes(mode)) {
      centre.value = mode
    } else {
      if (!warnedCentre.has(mode)) {
        warnedCentre.add(mode)
        console.warn(`[gospel-internet] unknown centre panel "${mode}", showing "${CENTRE_PANELS[0]}". Known: ${CENTRE_PANELS.join(', ')}`)
      }
      centre.value = CENTRE_PANELS[0]
    }
    if (centre.value === 'tree') loadTree().catch((e) => { error.value = String(e?.message || e) })
  }
  /**
   * Narrow the board to one tree node: the rows whose language is at or below it. It goes through the
   * EXISTING language facet as a multi-value filter (D1), so every panel, count and export follows by the
   * bus's one predicate; the node id is remembered only to show and share which node it was.
   */
  let treeSetKey = ''
  function setTreeNode(id) {
    const ix = tree.value
    if (!id || !ix || !ix.byId.has(id)) { treeNode.value = ''; treeSetKey = ''; if (id === '') bus.setFilter('language', null); return }
    const onBoard = new Set(all.value.map((r) => r.iso639_3))
    const isos = [...ix.isos.get(id)].filter((i) => onBoard.has(i)).sort()
    treeNode.value = id
    // No language of this node is on the list: narrow to nothing rather than silently to everything.
    const value = isos.length ? isos : ['(none)']
    treeSetKey = value.join('|')
    bus.setFilter('language', value)
  }
  // Another control changed or cleared the language facet: the node no longer describes the scope.
  watch(() => { const v = bus.filterSet.language; return v == null ? '' : [].concat(v).join('|') }, (k) => {
    if (treeNode.value && k !== treeSetKey) { treeNode.value = ''; treeSetKey = '' }
  })
  let pendingTree = ''
  // A ?tree= link applies only once BOTH the tree and the rows are loaded, whichever arrives last:
  // setTreeNode keeps the node's languages that are on the board, and with no rows yet that is the empty
  // set, so the grid restored to 0 ("6 of 2,107" before a reload, 0 after).
  function applyPendingTree() {
    if (!pendingTree || !tree.value || !all.value.length) return
    setTreeNode(pendingTree)
    pendingTree = ''
  }

  // ── views are PRESETS over the one bus ────────────────────────────────────────────────────────────
  function setView(v, { keepFilters = false } = {}) {
    const next = M.VIEWS.includes(v) ? v : 'board'
    view.value = next
    const preset = M.viewPreset(next)
    if (!keepFilters) {
      bus.clearFilters()
      for (const [k, val] of Object.entries(preset.filters)) bus.setFilter(k, val)
    }
    sort.value = { ...preset.sort }
  }

  function openGroup(slug, { select = true } = {}) {
    openSlug.value = slug || ''
    // Opening a group is an explicit pick, so it SELECTS (and the selection camera moves once). Hover
    // never does this — see useSelectionBus D3.
    if (select && slug) bus.setSelection([slug])
  }
  function closeGroup() { openSlug.value = '' }

  // ── URL state: ?view=&access=&band=&country=&province=&language=&group= (read always) ─────────────
  // WRITTEN only when the host opts in (profile-config urlState:'query', set by our own leaf pages).
  // A partner embedding the element on their page did not ask us to rewrite their address bar.
  const writeUrl = computed(() => cfg().urlState === 'query')
  function readUrl() {
    if (typeof location === 'undefined') return
    const q = M.parseQuery(location.search)
    const hostView = cfg().view
    setView(q.view !== 'board' ? q.view : (M.VIEWS.includes(hostView) ? hostView : 'board'))
    // The host's profile-config `filters` narrow the preset; URL FILTER params are read by the kit's
    // useShareableView (board.vue), except Gospel Resources' ?codes= / ?code=, which are this board's.
    const hostFilters = cfg().filters && typeof cfg().filters === 'object' ? cfg().filters : {}
    for (const [k, v] of Object.entries(hostFilters)) if (k in M.FACET_ACC) bus.setFilter(k, v)
    const codes = [...new URLSearchParams(location.search).getAll('codes'), ...new URLSearchParams(location.search).getAll('code')].length ? q.filters.language : null
    if (codes) bus.setFilter('language', codes)
    const group = q.group || cfg().group || ''
    if (group) pendingGroup = group
    // the URL wins, then the embed knob (profile-config panel: 'map'), then the default: the tree
    const panel = q.panel || (cfg().panel === 'map' ? 'map' : 'tree')
    if (q.tree) pendingTree = q.tree
    if (q.groups && q.groups.length) pendingSelection = q.groups
    setCentre(panel)
  }
  let pendingGroup = ''
  let pendingSelection = null
  watch(all, () => {
    if (pendingGroup && bySlug.value.has(pendingGroup)) openGroup(pendingGroup)
    pendingGroup = ''
    // ?groups= arrives SELECTED (ringed, framed by the camera), the same peoples Gospel Resources would
    // draw for that link; slugs not on this list are dropped, never guessed
    if (pendingSelection) { bus.setSelection(pendingSelection.filter((s) => bySlug.value.has(s))); pendingSelection = null }
    applyPendingTree()
  })
  function syncUrl() {
    if (!writeUrl.value || typeof history === 'undefined') return
    let keep = location.search
    // A tree node is shared as ?tree=<glottocode> ALONE: its language list (hundreds of codes for a big
    // family) made links that break in chat apps and SMS, the field's channel. The
    // kit writes `language` from the bus; this writer runs after it (flush:'post') and removes it while a
    // node is active. On load, ?tree= restores the node, which re-applies its languages itself.
    if (treeNode.value) { const q = new URLSearchParams(keep); q.delete('language'); keep = q.toString() ? '?' + q.toString() : '' }
    const qs = M.buildQuery({ view: view.value, filterSet: bus.filterSet, group: openSlug.value, keep,
      panel: centre.value, tree: treeNode.value, filters: false })
    const next = location.pathname + (qs ? '?' + qs : '') + location.hash
    if (next !== location.pathname + location.search + location.hash) {
      try { history.replaceState(history.state, '', next) } catch (_) { /* sandboxed */ }
    }
  }
  watch([view, openSlug, centre, treeNode, () => JSON.stringify(bus.filterSet)], syncUrl, { flush: 'post' })

  /** A link to one group, for "Copy link to this group" — the board's own page, ?group=<slug>. */
  function groupLink(slug) {
    const base = resolveShareUrl({ embedPath: EMBED_PATH, profileConfig: cfg() })
    try {
      const u = new URL(base, typeof location !== 'undefined' ? location.href : 'https://example.invalid/')
      u.searchParams.set('group', slug)
      if (!listIsDefault.value) u.searchParams.set('list', listId.value)
      return u.href
    } catch (_) { return base + '?group=' + encodeURIComponent(slug) }
  }

  const board = {
    bus, all, bySlug, filtered, sorted, meta, countries, readiness, loading, error, listId, listIsDefault,
    view, sort, openSlug, openRow, profileConfig,
    centre, CENTRE_PANELS, tree, resources, treeNode, setCentre, setTreeNode, loadTree,
    load, setView, openGroup, closeGroup, readUrl, groupLink,
  }
  provide('giBoard', board)
  return board
}

export function useBoardState() {
  const b = inject('giBoard', null)
  if (!b) throw new Error('[gospel-internet] a panel was mounted outside the board (no giBoard provided)')
  return b
}
