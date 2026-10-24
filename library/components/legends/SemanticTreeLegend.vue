<script setup>
/**
 * SemanticTreeLegend — reusable hierarchical legend for any one-to-many semantic tree.
 *
 * EXACT CLONE of the upstream PPLR module
 * (a direct clone by design; only the API is trimmed). Only difference vs.
 * upstream is the <style scoped> block converted to useShadowStyles() so the CSS
 * lands inside doxa-research-mfe's shadow root.
 *
 * Decoupled from map and geocoder; communicates via the shared per-instance store
 * (Mediator Pattern) when one is provided. Falls back to local state when standalone.
 *
 * Tree node shape:
 *   { id, label, color?, count?, pop?, filter?, info?, children?: TreeNode[] }
 */
import { ref, computed, watch, nextTick, inject, unref } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in.
const T = (key, en) => tStatic(key) || en
import { useOptionalI18n } from '@map/composables/useOptionalT.js'
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { useInstance } from '../../composables/usePplrInstance.js'
import LegendProgressBar from './LegendProgressBar.vue'
import ApproxPinNote from './ApproxPinNote.vue'
import { pointOf, nameOf } from '../../utils/colocation.js'
// .stl-export-backdrop is an invisible click-catcher ("captures the next click"), so when it is
// clipped nothing LOOKS wrong — but inside the cap-5 shell contain:layout on .vtl-content limits
// it to the content pane (measured 1024x793 @ (256,107) at 1280x900), so a click on the rail or
// header fails to close the export menu.
// ★ NOT VERIFIED THROUGH THE UI, and honestly so: this backdrop sits behind the
// SHOW_EXPORT_BUTTON kill-switch (const SHOW_EXPORT_BUTTON = false below), so the menu that owns
// it cannot be opened in the shipped studio. The containment was measured at this component's own
// mount point (.stl-panel, same 256,107 origin as every other pane child) and the fix is the same
// one proven on .dt-scrim / .lt-overlay / .modal-scrim; it is correct-if-enabled, not observed.
import { useViewportScrim } from '../../utils/viewportScrim.js'

// ★ i18n IS OPTIONAL IN A LIBRARY COMPONENT. useI18n() THROWS on a host that never installed
// vue-i18n, and seven bundles here do not. Unguarded, this legend renders NOTHING on such a host —
// the failure that blanked people-groups-grid via library FilterDropdown (fixed in 6603dc17).
// Same shape of fix as PinHint.vue and PosterWall.vue.
// The fallback humanizes the key's last segment, so a bare host sees readable English
// ("legend.columns.name" -> "Name") rather than a raw key. `te` answers false so every caller
// falls through to its own default — which is what the defaultTab and columnLabel paths expect.
const humanizeKey = (k) => String(k).split('.').pop()
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
// C4: the guard is library/composables/useOptionalI18n now. humanizeKey stays the fallback -- NOT the
// catalogue -- so a bare host still reads 'Name' for legend.columns.name, and `te` still answers false
// so defaultTab and columnLabel keep falling through to their own defaults.
const { t, te, locale: i18nLocale } = useOptionalI18n('', { fallback: (k) => humanizeKey(k) })

// Translate a tab's display name from the `tabs.<key>` catalog, keyed by the
// tab's stable `i18nKey` (preferred) or `id`. Falls back to the hardcoded
// English `label` when no catalog entry exists — so untranslated/dynamic tabs
// (e.g. generated "Generation N") render unchanged. Active locale comes from
// profile-config.lang via ProfileLoader (loc-002 keystone).
function tabLabel(tab) {
  const key = 'tabs.' + (tab?.i18nKey || tab?.id)
  return tab && te(key) ? t(key) : (tab?.label ?? '')
}

// THE INFO TEXT IS THE PART A NON-ENGLISH READER NEEDS MOST, and it was the one part
// that never went through the catalog. `tab.info` rendered RAW in all three places it
// appears (the button's title=, and the popover body), so a Spanish reader saw a
// translated tab chip beside an English explanation of what that chip means. Measured
// 2026-09-24 on the served upg-100-list leaf: ?lang=es changed 2 of 76 rendered strings
// ("POPULATION" -> "POBLACIÓN") and left all three legend tabs AND all three info
// popovers in English — the locale switch works, the strings were simply never in a
// catalog. This affordance was asked for specifically (the tab's own small information
// button explaining what a UPG-100 list is), which is exactly the sentence a reader who
// does not read English cannot use.
//
// Same shape as tabLabel: `legend.tabInfo.<i18nKey|id>`, te() guard, falling back to the
// hardcoded English `info` so a tab with no catalog entry renders unchanged rather than
// blank. PER KEY, so a half-finished translation shows its finished entries.
function tabInfo(tab) {
  const key = 'legend.tabInfo.' + (tab?.i18nKey || tab?.id)
  if (tab && te(key)) return t(key)
  // `info` doubles as a FLAG on tabs whose text has moved into the catalogue (`info: true` marks
  // "this tab has an explanation" for the button's v-if). Only a string is a fallback; anything
  // else would otherwise render as the word "true" in the popover.
  return typeof tab?.info === 'string' ? tab.info : ''
}

const props = defineProps({
  nodes:   { type: Array,  default: () => [] },
  // APPROXPIN standing note (card BUILD-APPROXIMATE-PIN-NOTICE: every map that shows people-group
  // pins says plainly that a dot is a locality). null = decide from the map's own data: shown when the
  // injected dataStore holds named Point features. true/false overrides, for a leaf that already says it.
  pinNote: { type: Boolean, default: null },
  tabs:    { type: Array,  default: null },
  // WHICH GENERATION THE LEGEND OPENS ON. Index into `tabs`; 0 (the top of the
  // tree) is the default, which is what every existing profile already gets.
  // Added for country-posters, whose legend must open on the COUNTRY level rather
  // than the region level above it:
  //   on open, the legend shows the country level, not the regions above it.
  // A profile cannot do this from outside without it: `expandedIds` is internal
  // state that resets on every `nodes` change, and activeTab is a computed over
  // either the shared instance or local state. Clamped to the real tab count below,
  // so an out-of-range value degrades to the top generation rather than blanking.
  defaultTab: { type: Number, default: 0 },
  columns: { type: Array,  default: () => ['count', 'pop'] },
  title:   { type: String, default: 'Legend' },
  hideTabs: { type: Boolean, default: false },
  columnLabel: { type: String, default: '' },
  open: { type: Boolean, default: null },
  // Per-app-profile feature flag. Off by default so existing profiles are
  // unchanged; a profile opts in by passing :export-enabled. Gates the
  // top-right Export affordance (UX scaffold only — no export yet).
  exportEnabled: { type: Boolean, default: false },
  // Which prayer resources the host can print for the selection. 'cards' (the card deck) is OPT-IN: a
  // host that does not handle it must not show a menu item that does nothing. Poster and packet stay on.
  exportCards: { type: Boolean, default: false },
  // Prayer progress payload for the header bar — { covered, total, segments } from
  // useLegendData(...).progress. null → no bar (every non-prayer legend). Falls back
  // to inject('legendProgress') so the mobile sheet's embedded legend (LegendMobile →
  // this component) gets the bar from the profile's provide() without a prop.
  progress: { type: Object, default: null },
})

const emit = defineEmits(['select', 'update:open', 'export'])

const instance = useInstance()

// ── Prayer progress bar (header) ───────────────────────────────────────────────
// Explicit prop wins, else the provided payload (a ref/computed from the profile).
const injectedProgress = inject('legendProgress', null)
const progressData = computed(() => props.progress ?? unref(injectedProgress) ?? null)
// The prayer legend's header says "Progress" (never "Legend") —
// on the desktop title bar, the mobile sheet title and the collapsed reopen pill.
const displayTitle = computed(() => progressData.value ? t('legend.progress.title') : props.title)
const stlIsDark = computed(() => (instance?.theme.value || 'dark') === 'dark')
const pinDataStore = inject('dataStore', null)
const drawnPeopleGroups = inject('normalizedPeopleGroups', null)
// A people-group pin is a row (or GeoJSON feature) with a name AND a position. The rows the map draws are
// asked first; the dataStore cache is the fallback (it can hold raw API rows or GeoJSON features).
const isPin = (r) => !!(r && nameOf(r) && pointOf(r))
const showPinNote = computed(() => {
  if (props.pinNote !== null) return props.pinNote
  if (drawnPeopleGroups?.value?.length) return drawnPeopleGroups.value.slice(0, 20).some(isPin)
  const sources = pinDataStore?.sources || {}
  for (const id in sources) if ((sources[id]?.features || []).slice(0, 20).some(isPin)) return true
  return false
})
// A click on a bar span selects the matching legend row through the SAME handler
// the row uses (selectNode → emit('select') → the profile's filter/camera path).
function findNodeById(nodes, id) {
  for (const n of nodes || []) {
    if (n?.id === id) return n
    const f = n?.children?.length ? findNodeById(n.children, id) : null
    if (f) return f
  }
  return null
}
function selectSegment(key) {
  const node = findNodeById(safeNodes.value, key)
  if (node) selectNode(node)
}

// ── Tree traversal ─────────────────────────────────────────────────────────────
function treeMaxDepth(nodes, d = 0) {
  if (!nodes?.length) return d
  return Math.max(...nodes.map(n => treeMaxDepth(n.children ?? [], d + 1)))
}
function collectAtDepth(nodes, target, curr = 0) {
  if (curr === target) return nodes.slice()
  return nodes.flatMap(n => collectAtDepth(n.children ?? [], target, curr + 1))
}
function findAncestorChain(nodes, targetId, chain = []) {
  for (const node of nodes) {
    if (node.id === targetId) return chain
    if (node.children?.length) {
      const found = findAncestorChain(node.children, targetId, [...chain, node])
      if (found) return found
    }
  }
  return null
}
function collectAllDescendantIds(node, out = new Set()) {
  if (!node?.children?.length) return out
  for (const c of node.children) {
    out.add(c.id)
    collectAllDescendantIds(c, out)
  }
  return out
}

// ── Derived ────────────────────────────────────────────────────────────────────
// NULL-SAFE TREE (research-map tab crash, 2026-09-16): ONE malformed API record
// producing a null node used to kill the whole legend — and with it the map —
// on the People Groups / Regions / Languages / Religions tabs (TypeError:
// reading 'label' of null). Sanitize ONCE at the prop boundary: drop falsy
// nodes recursively and warn, so a data hole degrades to a missing row instead
// of a dead map.
function pruneNullNodes(nodes, path = 'root') {
  if (!Array.isArray(nodes)) return []
  const out = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') {
      try { console.warn('[SemanticTreeLegend] dropped null node under', path) } catch (_) {}
      continue
    }
    out.push(n.children?.length ? { ...n, children: pruneNullNodes(n.children, n.label || n.id || path) } : n)
  }
  return out
}
const safeNodes = computed(() => pruneNullNodes(props.nodes))

const treeDepth = computed(() => treeMaxDepth(safeNodes.value))

const tabList = computed(() => {
  const src = props.tabs ?? []
  const len = src.length || (treeDepth.value + 1)
  return Array.from({ length: len }, (_, i) =>
    src[i] ?? { id: `gen${i+1}`, label: `Generation ${i + 1}` }
  )
})

// ── State ─────────────────────────────────────────────────────────────────────
// Seeded from defaultTab so a profile can open on a deeper generation. Default 0
// keeps every existing profile exactly as it was.
const localActiveTab = ref(Math.max(0, props.defaultTab | 0))
const expandedIds    = ref(new Set())
const localSelected  = ref(null)
const panelOpen      = ref(props.open !== null ? props.open : true)
const showInfoForTab = ref(null)
const exportMenuOpen = ref(false)  // top-right Export dropdown (behind SHOW_EXPORT_BUTTON)
// Whether the UPG-100 item has revealed its two variants. Separate from exportMenuOpen so closing
// the whole menu also collapses the submenu — see the watch below; a submenu left open would
// re-appear expanded the next time the reader opens Export, having forgotten why it was open.
const packetOpen = ref(false)
const { scrimRef, scrimStyle } = useViewportScrim(exportMenuOpen)
// Feature flag: show the Export affordance. Gated here in the SHARED legend so
// one switch covers every bundle. It was false by an earlier coder decision;
// the button came back on the 100-list legend (2026-07-31), and the
// export path is functional (the menu emits 'export' with 'poster' | 'packet',
// and a profile wires @export to a real download).
// A profile STILL has to opt in with :export-enabled="true" — this flag only
// stops it being force-hidden.
//
// ON since 2026-09-24. It was held OFF with the note "until the export packet is
// finished: the button currently produces a broken packet" — that precondition is
// now met. The packet renderer (library/packet/packet-render.js) is shared by the
// build-time generator and the browser export, so both produce the same document,
// and it is gated at the rendered layer by check:packet-render (8 sheets -> 8
// letter-portrait pages, map painted, Mark 5 in full, 12 wheel segments).
// The packet is generated ON CLICK, never shipped: one is ~3.5 MB and 28 zones
// would add ~100 MB to a repo that already had a publish blocked at 74 MB.
const SHOW_EXPORT_BUTTON = true
const sortBy         = ref(null)   // null = default (pop desc), 'count' | 'pop'
const sortDir        = ref('desc') // 'desc' | 'asc'

// ⚠ THE STORE USED TO WIN UNCONDITIONALLY, which made `defaultTab` dead for every profile
// that shares an instance. instance.activeTab starts at 0 and 0 is indistinguishable from
// "the user chose tab 0", so a profile passing :default-tab="1" still opened on tab 0.
// MEASURED 2026-09-24: my-upg-100-list opened on Region at desktop AND mobile, which is exactly
// the first reported problem with this legend.
// Now the store only wins once something has ACTUALLY chosen a tab — a tab click, or a node
// selection that moves the legend to that node's generation (usePplrInstance sets the flag).
// Until then the profile's declared landing tab applies, which is what the prop always meant.
const activeTab = computed({
  get: () => {
    if (props.hideTabs) return 0
    if (instance && !instance.activeTabTouched?.value) {
      return Math.min(Math.max(0, props.defaultTab | 0), Math.max(0, tabList.value.length - 1))
    }
    return instance ? instance.activeTab.value : localActiveTab.value
  },
  set: v => {
    if (props.hideTabs) return
    if (instance) {
      instance.activeTab.value = v
      if (instance.activeTabTouched) instance.activeTabTouched.value = true
    } else {
      localActiveTab.value = v
    }
  },
})

const selectedNode = computed({
  get: () => instance ? instance.selection.value : localSelected.value,
  set: v => {
    if (instance) instance.selection.value = v
    else          localSelected.value = v
  },
})

const selectedId = computed(() => selectedNode.value?.id || null)

// Scroll container for the legend rows — used to bring a freshly-selected row
// (e.g. from a People-Group search result) into view without the user scrolling.
const rowsContainer = ref(null)

watch(() => props.open, (v) => {
  if (v !== null) panelOpen.value = v
})

watch(() => safeNodes.value, () => {
  // ★ A DATA REFRESH IS NOT A DESELECTION (WAGF Regions on Simple Research, 2026-09-28). The
  // polygon highlight landed 51-85 ms after the click and was wiped 433-667 ms later, leaving no row
  // marked and every region at full colour — which reads exactly like a legend not connecting with
  // the map, and is worse, because it connected and then undid itself.
  //
  // This watcher fires on the IDENTITY of the nodes array, and every tree here is a computed that
  // returns a NEW array on each evaluation. So any late async that touches a dependency — pins still
  // arriving, a lazily loaded layer, a refresh — rebuilt the array with IDENTICAL CONTENT and this
  // reset cancelled the user's selection. The reset itself is right for genuinely new data; what was
  // wrong is that it could not tell one case from the other.
  //
  // So ask whether the selected row still EXISTS. If it does, re-point at the new object and leave the
  // tab and the expansion alone: nothing about the reader's state has become invalid. If it is gone,
  // the reset below is correct and the deselect is honest.
  const keepId = selectedNode.value?.id || null
  if (keepId) {
    const survivor = findNodeById(safeNodes.value, keepId)
    // Re-pointed, not kept: the old object belongs to the discarded array, and holding it would make
    // the highlight compare against a node the tree no longer contains.
    if (survivor) { selectedNode.value = survivor; return }
  }
  // Falls back to defaultTab, not a hardcoded 0 — otherwise a profile that opens on
  // a deeper generation silently reverts to the top the first time its nodes change.
  // ⚠ AND THE STORE ONLY COUNTS ONCE IT HAS BEEN TOUCHED. This read `instance?.activeTab.value`
  // and kept it whenever it was `a number >= 0` — but the store's INITIAL value is 0, which
  // satisfies that test, so defaultTab lost here too. Same root cause as the getter above.
  const touched = instance ? instance.activeTabTouched?.value : false
  const ext = touched ? instance?.activeTab.value : undefined
  const base = Math.min(Math.max(0, props.defaultTab | 0), Math.max(0, tabList.value.length - 1))
  const next = (typeof ext === 'number' && ext >= 0) ? ext : base
  // ⚠ WRITE PAST THE SETTER. This ran `activeTab.value = next`, and the setter marks the store
  // TOUCHED — but a nodes-change reset is not a user choice, so that flipped the sentinel on
  // mount and made defaultTab lose again, one layer down. Measured: the fix appeared to do
  // nothing until this line changed. Set the store directly and leave `touched` alone.
  if (instance) {
    instance.activeTab.value = next
    if (!touched && instance.activeTabTouched) instance.activeTabTouched.value = false
  } else {
    localActiveTab.value = next
  }
  expandedIds.value = new Set()
  selectedNode.value = null
  emit('select', null)
}, { deep: false })

let _lastInternalId = null
if (instance) {
  watch(() => instance.selection.value, sel => {
    if (sel?.id === _lastInternalId) return
    if (!sel) { _lastInternalId = null; return }
    _lastInternalId = sel.id
    const chain = findAncestorChain(safeNodes.value, sel.id) || []
    if (typeof sel.depth === 'number') {
      activeTab.value = Math.min(sel.depth, tabList.value.length - 1)
    }
    // Expand ALL ancestors of the selection (not just from the active tab down)
    // so a selected row in a collapsed sub-branch actually enters visibleRows —
    // otherwise the scroll-to-selected watcher can't find its DOM row.
    const newExp = new Set()
    chain.forEach(p => newExp.add(p.id))
    expandedIds.value = newExp
    emit('select', sel)
  })
}

// ── Sort ───────────────────────────────────────────────────────────────────────
function defaultSort(a, b) {
  const pd = (b.pop ?? 0) - (a.pop ?? 0)
  return pd !== 0 ? pd : (b.count ?? 0) - (a.count ?? 0)
}

const byActiveSort = computed(() => {
  if (!sortBy.value) return defaultSort
  const key = sortBy.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return (a, b) => (((a[key] ?? 0) - (b[key] ?? 0)) * dir)
})

function clickSortHeader(key) {
  if (sortBy.value === key) {
    if (sortDir.value === 'desc') sortDir.value = 'asc'
    else { sortBy.value = null; sortDir.value = 'desc' }
  } else {
    sortBy.value = key
    sortDir.value = 'desc'
  }
}

// ── Visible rows ───────────────────────────────────────────────────────────────
const tabResults = ref([])
const tabLoading = ref(false)

let _pendingTab = -1
function ensureTabComputed(tab) {
  if (tabResults.value[tab]) { tabLoading.value = false; return }
  tabLoading.value = true
  _pendingTab = tab
  setTimeout(() => {
    if (_pendingTab !== tab) return
    const result = [...collectAtDepth(safeNodes.value, tab)].sort(byActiveSort.value)
    const next = [...tabResults.value]
    next[tab] = result
    tabResults.value = next
    tabLoading.value = false
  }, 0)
}

watch(activeTab, t => ensureTabComputed(t), { immediate: true })
watch(() => [safeNodes.value, sortBy.value, sortDir.value], () => {
  tabResults.value = []
  ensureTabComputed(activeTab.value)
}, { deep: false })

const topNodesAll = computed(() => tabResults.value[activeTab.value] || [])
const topNodes = computed(() => {
  const limit = tabList.value[activeTab.value]?.topLimit
  return limit ? topNodesAll.value.slice(0, limit) : topNodesAll.value
})
const topNodesOverflow = computed(() => {
  const limit = tabList.value[activeTab.value]?.topLimit
  if (!limit) return 0
  return Math.max(0, topNodesAll.value.length - limit)
})

function buildRows(out, nodes, relDepth, parent, ancestors) {
  for (const node of nodes) {
    if (!node) continue
    out.push({ node, relDepth, parent, ancestors })
    if (expandedIds.value.has(node.id) && node.children?.length) {
      buildRows(out, [...node.children].sort(byActiveSort.value), relDepth + 1, node, [...ancestors, node])
    }
  }
}

const visibleRows = computed(() => {
  const out = []
  buildRows(out, topNodes.value, 0, null, [])
  for (let i = 0; i < out.length; i++) {
    const row = out[i]
    const segs = []
    for (let L = 0; L < row.relDepth; L++) {
      const ancAtL = row.ancestors[L]
      let trunkContinues = false
      for (let j = i + 1; j < out.length; j++) {
        const next = out[j]
        if (next.relDepth <= L) break
        if (next.relDepth === L + 1 && next.ancestors[L] === ancAtL) {
          trunkContinues = true; break
        }
        if (next.relDepth > L + 1 && next.ancestors[L] === ancAtL) {
          continue
        }
      }
      if (L === row.relDepth - 1) {
        let hasLaterSibling = false
        for (let j = i + 1; j < out.length; j++) {
          const next = out[j]
          if (next.relDepth < row.relDepth) break
          if (next.relDepth === row.relDepth && next.parent === row.parent) {
            hasLaterSibling = true; break
          }
        }
        segs.push(hasLaterSibling ? 'tee' : 'elbow')
      } else {
        segs.push(trunkContinues ? 'pipe' : 'blank')
      }
    }
    row.trunks = segs
  }
  return out
})

const hasSel   = computed(() => selectedId.value !== null)
const hasCount = computed(() => props.columns.includes('count'))
const hasPop   = computed(() => props.columns.includes('pop'))

const selectedDescendants = computed(() => {
  if (!selectedNode.value) return new Set()
  return collectAllDescendantIds(selectedNode.value)
})

const parentBreadcrumb = computed(() => {
  const sel = selectedNode.value
  if (!sel) return null
  const chain = findAncestorChain(safeNodes.value, sel.id)
  if (!chain || !chain.length) return null
  const parent = chain[chain.length - 1]
  const parentDepth = chain.length - 1
  const tabName = tabList.value[parentDepth]?.label || 'Parent'
  return { node: parent, tabName, depth: parentDepth }
})

// ── Actions ────────────────────────────────────────────────────────────────────
function selectNode(node) {
  if (selectedId.value === node.id) {
    _lastInternalId = null
    selectedNode.value = null
    emit('select', null)
  } else {
    _lastInternalId = node.id
    selectedNode.value = node
    emit('select', node)
  }
}
function toggleExpand(id, e) {
  e?.stopPropagation()
  const s = new Set(expandedIds.value)
  const collapsing = s.has(id)
  collapsing ? s.delete(id) : s.add(id)
  expandedIds.value = s
  if (collapsing && selectedNode.value) {
    const chain = findAncestorChain(safeNodes.value, selectedNode.value.id)
    if (chain && chain.some(a => a.id === id)) {
      _lastInternalId = null
      selectedNode.value = null
      emit('select', null)
    }
  }
}
// Drill UP the tree: re-root the legend on the breadcrumb parent shown in the
// header (e.g. drilled into "Telugu" on the Language tab → click "Dravidian" →
// jump to the Lang Family tab with Dravidian selected and the map filtered to
// the whole family).
//
// The active-tab switch MUST happen here. The internal selection watcher that
// adjusts the tab from sel.depth is guarded out for internally-originated
// selections (sel.id === _lastInternalId), and the external mapStore→selection
// bridge also skips re-applying a same-kind+label selection — so neither path
// moves the tab. We switch it explicitly to the parent's generation depth.
// Works for any tree tab (language-family / WAGF-regions / affinity) since it
// reuses the same parentBreadcrumb + selectNode mechanism.
function upToParent() {
  const bc = parentBreadcrumb.value
  if (!bc?.node) return
  // Switch to the parent's generation tab first so the parent row is visible
  // and highlighted on its own tab (selectNode highlights by id, and the
  // parent only appears in that tab's rows). Clear any child-tab expansion so
  // the parent tab opens clean — mirrors the geocoder-reveal flow's behavior.
  if (!props.hideTabs && typeof bc.depth === 'number') {
    activeTab.value = bc.depth
  }
  expandedIds.value = new Set()
  // selectNode toggles off if the same id is already selected; the breadcrumb
  // parent is never the current selection, so this always selects the parent
  // and emits @select, which drives the map filter to the parent's scope.
  selectNode(bc.node)
}
function switchTab(idx) {
  if (activeTab.value === idx) {
    showInfoForTab.value = showInfoForTab.value === idx ? null : idx
    return
  }
  activeTab.value = idx
  expandedIds.value = new Set()
  _lastInternalId = null
  selectedNode.value = null
  showInfoForTab.value = null
  emit('select', null)
}
function deselect(e) {
  e?.stopPropagation()
  _lastInternalId = null
  selectedNode.value = null
  emit('select', null)
}
function showInfo(idx, e) {
  e?.stopPropagation()
  showInfoForTab.value = showInfoForTab.value === idx ? null : idx
}
// Export affordance — the menu options emit('export', kind) to the profile.
function toggleExportMenu(e) {
  e?.stopPropagation()
  exportMenuOpen.value = !exportMenuOpen.value
}
// Fire the chosen export kind up to the profile, then close the menu. The profile does the render.
// ⚠ THE PACKET KINDS NOW CARRY THEIR VARIANT — 'packet:full' / 'packet:lightweight' — while 'poster'
// and a bare 'packet' are unchanged, so an older consumer that only understands 'poster' | 'packet'
// keeps working and a new one can split on the colon. Widening the EXISTING string beats adding a
// second emit: one event means a consumer cannot handle half the menu.
function emitExport(kind) {
  exportMenuOpen.value = false
  packetOpen.value = false
  emit('export', kind)
}
// The Export button only exists while a row is selected; if the selection is
// cleared (deselect / tab switch / nodes change) the menu must not linger.
watch(selectedId, id => { if (!id) { exportMenuOpen.value = false; packetOpen.value = false } })
// Closing the menu collapses the submenu, so it never re-opens pre-expanded.
watch(exportMenuOpen, open => { if (!open) packetOpen.value = false })

// Bring the selected row into view when the selection changes (e.g. a People-Group
// search result highlights a row that may be scrolled off-screen).
//
// Scroll EVERY scrollable ancestor of the row (mobile nests .stl-rows inside the
// sheet's .legend-content, so one scroller isn't enough) so the row lands ~8px below
// the top of whatever actually scrolls. We use getBoundingClientRect deltas, NOT
// row.offsetTop: offsetTop is relative to the nearest *positioned* ancestor — .stl-rows
// is position:static, so offsetTop included the header height above it and the scroll
// overshot by ~3 rows (the exact bug). Walking parentElement stays INSIDE the shadow
// DOM (its top element's parentElement is null at the shadow root), so this never
// scrolls the host page the way row.scrollIntoView() did (regression 554bf10).
function bringRowToTop(row) {
  let n = row.parentElement
  while (n) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
      const rr = row.getBoundingClientRect(), nr = n.getBoundingClientRect()
      n.scrollTop += (rr.top - nr.top) - 8
    }
    n = n.parentElement
  }
}
let stlScrollGen = 0
watch(selectedId, async id => {
  if (!id) return
  const gen = ++stlScrollGen            // cancel earlier runs if the selection changes again
  const container = rowsContainer.value
  if (!container) return
  await nextTick()
  // Re-run ACROSS the mobile sheet's open animation (~300ms). On mobile the legend is
  // collapsed by default; the FIRST search after a page load opens it (a height
  // transition) AND fires this watcher — so an early measurement is against the
  // collapsed/animating container and the row lands wrong (the "first search after
  // reload, mobile only" bug). Re-running as it settles corrects it; when the legend is
  // already open these passes are no-ops (the row is already at the top).
  const tryScroll = (attempt = 0) => {
    if (gen !== stlScrollGen) return    // superseded by a newer selection
    const row = container.querySelector(`[data-stl-node-id="${CSS.escape(String(id))}"]`)
    if (row) bringRowToTop(row)
    if (attempt < 6) setTimeout(() => tryScroll(attempt + 1), 70)
  }
  tryScroll(0)
})

// ── Formatters ─────────────────────────────────────────────────────────────────
// The app's locale (a ref or a string, depending on how the host installed i18n); undefined lets Intl
// use the browser's, which is what toLocaleString() did before.
function numLocale() {
  const l = i18nLocale && (i18nLocale.value ?? i18nLocale)
  return typeof l === 'string' && l ? l : undefined
}
// ★ COMPACT IN THE READER'S NOTATION. This was `toFixed(1) + 'M'` / `+ 'k'`: English abbreviations with
// an English decimal point on every Population cell in every locale. Intl's compact notation writes each
// language's own form (ru "1,2 млн", de "1,2 Mio.", ar "1.2 مليون", zh "123.5万").
// ⚠ SIZED TO THE COLUMN, which is fixed (--stl-num-w: 60px at 10.5px mono, 70px at 13px). The local forms are
// longer than "12.3M": with one decimal everywhere de reached "123,5 Mio." (10 chars) — past both widths on
// the region rows, whose sums run to hundreds of millions. So one decimal only below 10 million, where it
// carries real information; whole units above. Worst case measured over all 11 locales: 8 Latin chars.
function fmtPop(n) {
  if (!n) return '—'
  if (n >= 1e3) {
    return new Intl.NumberFormat(numLocale(), { notation: 'compact', maximumFractionDigits: n >= 1e6 && n < 1e7 ? 1 : 0 }).format(n)
  }
  return n.toLocaleString(numLocale())
}
function fmtCount(n) { return n != null ? n.toLocaleString(numLocale()) : '—' }

function rowClasses(row) {
  return {
    selected:   selectedId.value === row.node.id,
    descendant: hasSel.value && selectedDescendants.value.has(row.node.id),
    child:      row.relDepth > 0,
    leaf:       !row.node.children?.length,
  }
}

// CSS — verbatim from PPLR's <style scoped>, injected into shadow root.
useShadowStyles(`
.stl-inner {
  --stl-pad-x:    10px;
  --stl-gap:       6px;
  --stl-caret-w:  14px;
  --stl-dot-w:     8px;
  --stl-num-w:    60px;   /* fits "POPULATION" (~59px) at the 9px header scale; desktop overrides below */
  --stl-x-w:      22px;
  flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column;
  background: #161b22; border: 1px solid #30363d;
  border-radius: var(--map-radius, 16px);
  box-shadow: 0 6px 24px rgba(0,0,0,0.45);
  overflow: hidden;
}
.stl-panel {
  /* --stl-top: the panel's offset from the map's top edge. The 60px default reserves room for a
     search bar ABOVE the legend, which most consumers (research-map's geocoder) still have. A
     profile that has REMOVED its search bar sets --stl-top on the legend's wrapper so the panel
     rises into the vacated space instead of keeping a dead gap (UPG-100 removed its search bar,
     so its legend moves up). The max-height
     mirrors it so a raised panel gains the same room at the bottom it gained at the top. */
  position: absolute; inset-inline-start: 8px; top: var(--stl-top, 60px); width: var(--map-legend-width, 380px); z-index: 4;
  display: flex; flex-direction: column;
  max-height: calc(100% - var(--stl-top, 60px) - 12px);
  transition: transform 0.25s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s;
  pointer-events: auto;
}
.stl-panel.closed { transform: translateX(-100%); opacity: 0; pointer-events: none; }
/* RTL: the panel sits at the inline START (the right), so it slides off to the right and its collapse
   arrow points the other way. Additive :dir(rtl) overrides, as in VerticalTabsLayout. */
.stl-panel.closed:dir(rtl) { transform: translateX(100%); }
.stl-collapse-btn:dir(rtl) svg { transform: rotate(0deg); }
/* Derived from --stl-top for the same reason as the base rule above: a fixed 72px here overflowed
   whenever the profile's real offset was larger (UPG-100 sets 58px + a 12px bottom margin = 70px of
   required clearance, against 72px only by luck; at --stl-top:8px it wasted 64px of panel height). */
.stl-panel.fit-content { max-height: calc(100% - var(--stl-top, 60px) - 12px); }
.stl-titlebar {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; flex-shrink: 0;
  border-bottom: 1px solid #21262d;
  min-height: 32px;
}
.stl-tb-caret-slot { display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.stl-tb-caret-slot:empty { display: none; }
/* Prayer progress bar IN the header: the titlebar wraps to a second line that the
   bar fills edge to edge (line 1: caret + "Progress" [+ export]; line 2: the bar). */
.stl-titlebar.has-progress { flex-wrap: wrap; row-gap: 7px; }
.stl-progress { flex: 1 1 100%; min-width: 0; }
.stl-tb-title,
.stl-tb-eyebrow {
  font: 600 10px ui-monospace, monospace;
  color: #73A17F; text-transform: uppercase; letter-spacing: 0.07em;
  flex-shrink: 0;
}
.stl-tb-eyebrow { color: #6e7681; font-size: 9px; letter-spacing: 0.08em; }
.stl-tb-dot {
  width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 0 0 3px rgba(115,161,127,0.15);
}
.stl-tb-text {
  flex: 1; min-width: 0;
  font: 600 12px system-ui; color: #e6edf3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Clickable header breadcrumb — drill UP the tree onto the parent. Styled to
   read as part of the titlebar (transparent, inherits header layout) but with
   hover/focus affordances that mark it interactive. Accent uses the legend's
   green family (#73A17F); no brown tones. */
.stl-tb-up {
  flex: 1; min-width: 0;
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  margin: -2px -4px; padding: 2px 6px 2px 4px;
  cursor: pointer; text-align: start;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.stl-tb-up:hover { background: rgba(115,161,127,0.10); border-color: rgba(115,161,127,0.35); }
.stl-tb-up:focus-visible {
  outline: none;
  border-color: #73A17F;
  box-shadow: 0 0 0 2px rgba(115,161,127,0.30);
}
.stl-tb-up .stl-tb-text {
  flex: 1; min-width: 0;
  font: 600 12px system-ui; color: #e6edf3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.stl-tb-up:hover .stl-tb-text { color: #fff; }
.stl-tb-up-icon { color: #73A17F; flex-shrink: 0; }
.stl-panel[data-theme="light"] .stl-tb-up:hover {
  background: rgba(59,70,61,0.08); border-color: rgba(59,70,61,0.3);
}
.stl-panel[data-theme="light"] .stl-tb-up:focus-visible {
  border-color: #3b463d; box-shadow: 0 0 0 2px rgba(59,70,61,0.25);
}
.stl-panel[data-theme="light"] .stl-tb-up .stl-tb-text { color: #1f2328; }
.stl-panel[data-theme="light"] .stl-tb-up-icon { color: #3b463d; }
.stl-tabs-wrap { flex-shrink: 0; }
.stl-tabs {
  display: flex; flex-wrap: nowrap; gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #21262d;
  overflow-x: auto;
  scrollbar-width: none;
}
.stl-tabs::-webkit-scrollbar { display: none; }
.stl-tab-chip {
  display: inline-flex; align-items: stretch; flex-shrink: 0;
  background: #1c2333; border: 1px solid #30363d; border-radius: 6px;
  overflow: hidden; transition: border-color 0.12s, box-shadow 0.12s;
}
.stl-tab-chip:hover { border-color: #484f58; }
.stl-tab-chip.active {
  background: #3b463d; border-color: #73A17F;
  box-shadow: 0 0 0 2px rgba(115,161,127,0.22), 0 1px 4px rgba(59,70,61,0.4);
}
.stl-tab {
  display: inline-flex; align-items: center;
  background: transparent; border: none;
  color: #8b949e; font: 600 10px ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 4px 8px; cursor: pointer; white-space: nowrap;
  min-height: 24px;   /* 24px tap target (WCAG 2.5.8); measured 22px at 390 */
}
.stl-tab:hover { color: #c9d1d9; }
.stl-tab-chip.active .stl-tab { color: #fff; }
.stl-tab-info {
  background: rgba(110,118,129,0.15); border: none; border-inline-start: 1px solid #30363d;
  color: #6e7681; cursor: pointer;
  width: 24px; min-height: 24px; padding: 0; font: 700 9px ui-monospace, monospace;   /* was 18x22 */
}
.stl-tab-info:hover { background: rgba(59,70,61,0.2); color: #73A17F; }
.stl-tab-chip.active .stl-tab-info {
  border-inline-start-color: rgba(0,0,0,0.3); color: #fff;
  background: rgba(0,0,0,0.2);
}
.stl-info-pop {
  margin: 2px 8px 6px; padding: 7px 10px;
  background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
  font: 11px system-ui; color: #c9d1d9; line-height: 1.45;
}
.stl-col-hdr,
.stl-row {
  display: flex; align-items: center; gap: var(--stl-gap);
  padding: 0 var(--stl-pad-x);
}
.stl-col-hdr {
  height: 26px; flex-shrink: 0;
  background: #0d1117; border-bottom: 1px solid #21262d;
}
.stl-hdr-name {
  flex: 1; min-width: 0;
  font: 700 11px ui-monospace, monospace;
  color: #8b949e; text-transform: uppercase; letter-spacing: 0.04em;
}
/* Center-aligned UUPGs/Pop column header: centred rather than right-aligned,
   so the header label sits on the same
   x-center as the numeric value below; reduces eye drift across rows). */
.stl-hdr-num {
  width: var(--stl-num-w); text-align: center; flex-shrink: 0;
  font: 600 9px ui-monospace, monospace;
  color: #6e7681; text-transform: uppercase; letter-spacing: 0.05em;
  background: transparent; border: none; cursor: pointer;
  padding: 0; transition: color 0.1s;
  display: inline-flex; align-items: center; justify-content: center; gap: 3px;
}
.stl-hdr-num:hover { color: #c9d1d9; }
/* WCAG 2.5.8 at EVERY pointer, not only coarse: a 24x24 hit area that adds no box (the f29b8151 pattern). */
.stl-hdr-num{position:relative;}.stl-hdr-num::after{content:'';position:absolute;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);}
/* WCAG 2.5.8 Target Size (Minimum), AA = 24x24 CSS px. Scoped to (pointer:coarse):
   2.5.8 governs touch ergonomics, and these are SHARED components sitting on maps this
   change does not own -- a finger gets the bigger target, the mouse keeps the density
   those owners designed. min-height states the 24 rather than deriving it from a font. */
/* min-height ONLY. The width is var(--stl-num-w), a layout variable the header's columns are
   aligned on; forcing a min-width here would push those columns apart to fix a height. */
@media (pointer:coarse) { .stl-hdr-num { min-height: 24px; } }
.stl-hdr-num.active { color: #73A17F; }
.stl-sort-arrow { font-size: 8px; }
.stl-rows { flex: 1; overflow-y: auto; padding-bottom: 6px; }
.stl-rows::-webkit-scrollbar { width: 6px; }
.stl-rows::-webkit-scrollbar-track { background: transparent; }
.stl-rows::-webkit-scrollbar-thumb { background: #21262d; border-radius: 3px; }
.stl-rows::-webkit-scrollbar-thumb:hover { background: #30363d; }
.stl-empty {
  padding: 20px 12px; text-align: center;
  font: 11px system-ui; color: #484f58;
}
.stl-loading {
  display: inline-flex; align-items: center; gap: 8px;
  width: 100%; justify-content: center;
  color: #73A17F;
}
.stl-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(115,161,127,0.25);
  border-top-color: #73A17F;
  animation: stl-spin 0.7s linear infinite;
}
@keyframes stl-spin { to { transform: rotate(360deg); } }
.stl-overflow {
  padding: 8px 10px; margin: 4px 0 0;
  background: #0d1117; border-top: 1px dashed #30363d;
  text-align: center; font: 10px system-ui; color: #6e7681;
}
.stl-overflow-hint { color: #73A17F; }
.stl-row {
  min-height: 27px;
  cursor: pointer; transition: opacity 0.12s, background 0.1s;
  border-bottom: 1px solid rgba(33,38,45,0.45);
}
.stl-row:last-child { border-bottom: none; }
.stl-row:hover { background: rgba(255,255,255,0.04); }
.stl-row.child .stl-name { color: #adbac7; }
.stl-row.leaf .stl-name { font-style: italic; }
.stl-rows.has-sel .stl-row:not(.selected):not(.descendant) { opacity: 0.30; }
.stl-rows.has-sel .stl-row:not(.selected):not(.descendant):hover { opacity: 0.6; }
.stl-rows.has-sel .stl-row.descendant { opacity: 1; }
.stl-rows.has-sel .stl-row.selected {
  opacity: 1;
  background: rgba(255,255,255,0.05);
  box-shadow:
    inset 3px 0 0 0 var(--row-color, #73A17F),
    inset 0 0 0 1px rgba(255,255,255,0.05),
    0 0 14px -2px var(--row-color, rgba(115,161,127,0.4));
}
.stl-panel[data-theme="light"] .stl-rows.has-sel .stl-row.selected {
  background: rgba(255,255,255,0.7);
  box-shadow:
    inset 3px 0 0 0 var(--row-color, #3b463d),
    inset 0 0 0 1px rgba(0,0,0,0.04),
    0 0 14px -2px var(--row-color, rgba(59,70,61,0.35));
}
.stl-caret-sp   { width: var(--stl-caret-w); flex-shrink: 0; }
.stl-dot-sp     { width: var(--stl-dot-w); flex-shrink: 0; }
.stl-x-slot     {
  width: var(--stl-x-w); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.stl-trunk { position: relative; flex-shrink: 0; width: 12px; align-self: stretch; }
.stl-trunk-pipe::before {
  content: ''; position: absolute;
  inset-inline-start: 5px; top: 0; bottom: 0; width: 1px;
  background: var(--trunk-color, #6e7681);
  opacity: 0.45;
}
.stl-trunk-tee::before {
  content: ''; position: absolute;
  inset-inline-start: 5px; top: 0; bottom: 0; width: 1px;
  background: var(--trunk-color, #6e7681);
  opacity: 0.45;
}
.stl-trunk-tee::after {
  content: ''; position: absolute;
  inset-inline-start: 5px; top: 50%; height: 1px; width: 7px;
  background: var(--trunk-color, #6e7681);
  opacity: 0.55;
}
.stl-trunk-elbow::before {
  content: ''; position: absolute;
  inset-inline-start: 5px; top: 0; height: 50%; width: 1px;
  background: var(--trunk-color, #6e7681);
  opacity: 0.45;
}
.stl-trunk-elbow::after {
  content: ''; position: absolute;
  inset-inline-start: 5px; top: calc(50% - 0.5px); height: 1px; width: 7px;
  background: var(--trunk-color, #6e7681);
  opacity: 0.55;
}
.stl-row.selected .stl-trunk-pipe::before,
.stl-row.selected .stl-trunk-tee::before,
.stl-row.selected .stl-trunk-tee::after,
.stl-row.selected .stl-trunk-elbow::before,
.stl-row.selected .stl-trunk-elbow::after,
.stl-row.descendant .stl-trunk-pipe::before,
.stl-row.descendant .stl-trunk-tee::before,
.stl-row.descendant .stl-trunk-tee::after,
.stl-row.descendant .stl-trunk-elbow::before,
.stl-row.descendant .stl-trunk-elbow::after {
  opacity: 0.85;
}
.stl-caret {
  background: none; border: none; padding: 0; cursor: pointer;
  color: #6e7681; width: var(--stl-caret-w); height: var(--stl-caret-w); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 3px;
  /* A 24px tap target that keeps the caret's 14px footprint: the box grows by 10px and a -5px margin
     on every side gives the space back, so the tree's indentation (also --stl-caret-w) is unchanged. */
  box-sizing: border-box; width: 24px; height: 24px; margin: -5px;
}
.stl-caret svg { transition: transform 0.15s; }
.stl-caret.open svg { transform: rotate(90deg); }
.stl-caret:hover { color: #c9d1d9; background: rgba(255,255,255,0.06); }
.stl-dot {
  width: var(--stl-dot-w); height: var(--stl-dot-w); border-radius: 50%; flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.4);
}
.stl-row.selected .stl-dot {
  box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 0 0 3px rgba(115,161,127,0.25);
}
.stl-name {
  flex: 1; min-width: 0;
  font: 11.5px system-ui, sans-serif; color: #e6edf3;
  white-space: normal; word-wrap: break-word; overflow-wrap: break-word;
  line-height: 1.3;
}
/* Center-aligned numeric data — paired with center-aligned header above. */
.stl-num {
  width: var(--stl-num-w); text-align: center; flex-shrink: 0;
  font: 10.5px ui-monospace, monospace; color: #8b949e;
  font-variant-numeric: tabular-nums;
}
.stl-row.selected .stl-num { color: #e6edf3; }
.stl-x-chip {
  background: rgba(110,118,129,0.12); border: none; border-radius: 50%;
  color: #6e7681; cursor: pointer;
  width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.12s, background 0.12s;
}
.stl-x-chip:hover { color: #c9d1d9; background: rgba(110,118,129,0.25); }
.stl-collapse-btn {
  background: rgba(110,118,129,0.15); border: 1px solid #30363d; border-radius: 5px;
  color: #8b949e; cursor: pointer;
  width: 22px; height: 20px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.1s, background 0.1s, transform 0.18s;
}
.stl-collapse-btn:hover { color: #c9d1d9; background: rgba(59,70,61,0.18); border-color: #73A17F; }
.stl-collapse-btn svg { transition: transform 0.18s; transform: rotate(180deg); }
.stl-reopen {
  position: absolute; inset-inline-start: 8px; top: 60px; z-index: 3;
  display: inline-flex; align-items: center; gap: 8px;
  background: #0d1117; border: 1px solid #30363d;
  border-radius: 999px;
  color: #c9d1d9; cursor: pointer;
  height: 36px;
  padding: 0 14px 0 12px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  font: 600 11px ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.06em;
  max-width: 320px;
  transition: color 0.12s, background 0.12s, border-color 0.12s, transform 0.12s, box-shadow 0.12s;
}
.stl-reopen:hover {
  color: #fff; background: #1c2333; border-color: #73A17F;
  box-shadow: 0 6px 20px rgba(59,70,61,0.25);
  transform: translateY(-1px);
}
.stl-reopen-icon { color: #73A17F; flex-shrink: 0; }
.stl-reopen-label {
  display: inline-flex; align-items: center; gap: 6px;
  min-width: 0; max-width: 200px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-transform: none; letter-spacing: 0;
  font: 600 12px system-ui, sans-serif;
}
.stl-reopen-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.4);
}
.stl-reopen-caret { color: #6e7681; flex-shrink: 0; }
.stl-reopen:hover .stl-reopen-caret { color: #c9d1d9; }
@media (max-width: 640px) {
  /* ⚠ TWO BUGS LIVED IN THIS ONE LINE, and both are the same mistake: a number that has to agree
     with another number, written out twice.

     1. THE CAP MEASURED THE WRONG BOX. calc(100vh - 72px) sizes the panel against the VIEWPORT,
        while the panel is positioned inside the MAP (position:absolute within .upg-map{inset:0}).
        Those agree only when the map fills the screen — true of every standalone leaf, false the
        moment a host puts a header above the map or content below it, which is how the element is
        actually embedded. 100% is the map's own box, the same reference the desktop rule uses.
     2. THE OFFSET AND THE CAP DISAGREED. top:64px with max-height:calc(... - 72px) subtracts a
        constant that has nothing to do with the offset above it. --stl-top makes one value drive
        both, so they cannot drift apart again.

     MEASURED 2026-09-24 at 390px in a 420px-tall host: the panel ran 38px past the bottom of the
     map: the UPG-100 list's legend overflowed the map's height. */
  .stl-panel { width: 92vw; max-width: 380px; --stl-top: 64px; }
  .stl-reopen { top: 64px; }
}
.stl-panel[data-theme="light"] .stl-inner {
  background: #ffffff; border-color: #d0d7de;
  box-shadow: 0 6px 24px rgba(31, 35, 40, 0.12);
}
.stl-panel[data-theme="light"] .stl-titlebar { border-color: #d8dee4; }
.stl-panel[data-theme="light"] .stl-tb-title,
.stl-panel[data-theme="light"] .stl-tb-eyebrow { color: #3b463d; }
.stl-panel[data-theme="light"] .stl-tb-eyebrow { color: #57606a; }
.stl-panel[data-theme="light"] .stl-tb-text { color: #1f2328; }
.stl-panel[data-theme="light"] .stl-collapse-btn {
  background: rgba(208,215,222,0.4); border-color: #d0d7de; color: #57606a;
}
.stl-panel[data-theme="light"] .stl-collapse-btn:hover {
  background: rgba(59,70,61,0.12); border-color: #3b463d; color: #3b463d;
}
.stl-panel[data-theme="light"] .stl-tabs { border-color: #d8dee4; }
.stl-panel[data-theme="light"] .stl-tab-chip { background: #f6f8fa; border-color: #d0d7de; }
.stl-panel[data-theme="light"] .stl-tab { color: #57606a; }
.stl-panel[data-theme="light"] .stl-tab:hover { color: #1f2328; }
.stl-panel[data-theme="light"] .stl-tab-chip.active {
  background: #3b463d; border-color: #3b463d;
  box-shadow: 0 0 0 2px rgba(59,70,61,0.18);
}
.stl-panel[data-theme="light"] .stl-tab-chip.active .stl-tab { color: #fff; }
.stl-panel[data-theme="light"] .stl-tab-info {
  background: rgba(208,215,222,0.4); border-color: #d0d7de; color: #57606a;
}
.stl-panel[data-theme="light"] .stl-info-pop { background: #f6f8fa; border-color: #d0d7de; color: #1f2328; }
.stl-panel[data-theme="light"] .stl-col-hdr { background: #f6f8fa; border-color: #d8dee4; }
.stl-panel[data-theme="light"] .stl-hdr-name,
.stl-panel[data-theme="light"] .stl-hdr-num { color: #57606a; }
.stl-panel[data-theme="light"] .stl-hdr-num:hover { color: #3b463d; }
.stl-panel[data-theme="light"] .stl-hdr-num.active { color: #3b463d; }
.stl-panel[data-theme="light"] .stl-rows::-webkit-scrollbar-thumb { background: #d0d7de; }
.stl-panel[data-theme="light"] .stl-rows::-webkit-scrollbar-thumb:hover { background: #afb8c1; }
.stl-panel[data-theme="light"] .stl-empty,
.stl-panel[data-theme="light"] .stl-overflow {
  color: #57606a; background: #f6f8fa; border-color: #d8dee4;
}
.stl-panel[data-theme="light"] .stl-overflow-hint { color: #3b463d; }
.stl-panel[data-theme="light"] .stl-row { border-color: rgba(208,215,222,0.5); }
.stl-panel[data-theme="light"] .stl-row:hover { background: rgba(59,70,61,0.04); }
.stl-panel[data-theme="light"] .stl-row.child .stl-name { color: #57606a; }
.stl-panel[data-theme="light"] .stl-name { color: #1f2328; }
.stl-panel[data-theme="light"] .stl-num { color: #57606a; }
.stl-panel[data-theme="light"] .stl-row.selected .stl-num { color: #1f2328; }
.stl-panel[data-theme="light"] .stl-caret { color: #57606a; }
.stl-panel[data-theme="light"] .stl-caret:hover { background: rgba(59,70,61,0.08); color: #3b463d; }
.stl-reopen[data-theme="light"] {
  background: #ffffff; border-color: #d0d7de; color: #1f2328;
  box-shadow: 0 4px 16px rgba(31,35,40,0.18);
}
.stl-reopen[data-theme="light"]:hover {
  background: #f6f8fa; border-color: #3b463d; color: #3b463d;
  box-shadow: 0 6px 20px rgba(59,70,61,0.2);
}
.stl-reopen[data-theme="light"] .stl-reopen-icon { color: #3b463d; }
.stl-reopen[data-theme="light"] .stl-reopen-caret { color: #57606a; }
.stl-panel[data-theme="light"] .stl-x-chip { color: #57606a; border-color: rgba(208,215,222,0.6); }
.stl-panel[data-theme="light"] .stl-x-chip:hover { color: #1f2328; background: rgba(208,215,222,0.3); border-color: #afb8c1; }

/* ── Export affordance (trailing end of the titlebar) ───────────────────────
   margin-inline-start:auto pins it to the TRAILING edge — right in LTR, left in
   RTL — whether the titlebar shows the plain title (flex-shrink:0) or the flex:1
   breadcrumb button. (The comment said margin-left and "the right edge" after
   the rule itself had already been made logical; prose that names the physical
   side is how a reader talks themselves back into a physical property.) */
.stl-export { margin-inline-start: auto; position: relative; flex-shrink: 0; }
.stl-export-btn {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(110,118,129,0.15); border: 1px solid #30363d; border-radius: 6px;
  color: #c9d1d9; cursor: pointer;
  height: 22px; padding: 0 8px;
  font: 600 10px ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.05em;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}
.stl-export-btn:hover { color: #fff; background: rgba(59,70,61,0.25); border-color: #73A17F; }
.stl-export-btn.open { color: #fff; background: #3b463d; border-color: #73A17F; box-shadow: 0 0 0 2px rgba(115,161,127,0.22); }
.stl-export-btn:focus-visible { outline: none; border-color: #73A17F; box-shadow: 0 0 0 2px rgba(115,161,127,0.3); }
.stl-export-label { line-height: 1; }
/* Backdrop sits below the menu, above the panel — captures the next click. */
.stl-export-backdrop { position: fixed; inset: 0; z-index: 9; }
.stl-export-menu {
  position: absolute; inset-inline-end: 0; top: calc(100% + 6px); z-index: 10;
  min-width: 168px;
  display: flex; flex-direction: column;
  background: #0d1117; border: 1px solid #30363d; border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 4px; overflow: hidden;
}
.stl-export-item {
  display: flex; align-items: center; gap: 8px;
  background: transparent; border: none; border-radius: 5px;
  padding: 7px 8px; width: 100%; text-align: start;
  color: #6e7681; cursor: not-allowed;
  font: 600 11px system-ui, sans-serif;
}
.stl-export-item[disabled] { opacity: 0.55; }
/* ★ THE SUBMENU FLOWS BELOW ITS TRIGGER, IT IS NOT POSITIONED OVER IT. .stl-export-menu is a flex
   COLUMN, so a block placed after the packet button sits underneath it by document order — no
   absolute positioning, nothing to overlap. This matters because the equivalent disclosure on the
   card deck did cover its own label on mobile: that one hangs at top:100% out of its card, where a
   short viewport leaves it nowhere to go. A panel that grows its parent cannot cover its parent. */
.stl-export-caret { flex-shrink: 0; font-size: 9px; opacity: 0.7; transition: transform 0.15s; }
.stl-export-caret.is-open { transform: rotate(180deg); }
.stl-export-sub {
  display: flex; flex-direction: column; gap: 2px;
  margin: 2px 0 2px 6px; padding-inline-start: 6px;
  border-inline-start: 1px solid #30363d;   /* inline-start, so it mirrors under RTL */
}
/* The explainer is the only place a reader meets the idea, so it wraps rather than truncating —
   a clipped definition is worse than none. */
.stl-export-note {
  margin: 2px 0 4px; padding: 0 2px;
  font: 400 10px/1.45 system-ui, sans-serif; color: #8b949e; white-space: normal;
}
.stl-export-subitem { font-weight: 500; padding-block: 5px; }
.stl-panel[data-theme="light"] .stl-export-sub { border-inline-start-color: #d0d7de; }
.stl-panel[data-theme="light"] .stl-export-note { color: #57606a; }
.stl-export-lock { color: #6e7681; flex-shrink: 0; }
.stl-export-item-label { flex: 1; min-width: 0; }
.stl-export-soon {
  flex-shrink: 0;
  font: 700 8px ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.06em;
  color: #6e7681; background: rgba(110,118,129,0.15);
  border-radius: 4px; padding: 2px 5px;
}
/* Light-theme overrides */
.stl-panel[data-theme="light"] .stl-export-btn {
  background: rgba(208,215,222,0.4); border-color: #d0d7de; color: #57606a;
}
.stl-panel[data-theme="light"] .stl-export-btn:hover { color: #3b463d; background: rgba(59,70,61,0.12); border-color: #3b463d; }
.stl-panel[data-theme="light"] .stl-export-btn.open { color: #fff; background: #3b463d; border-color: #3b463d; }
.stl-panel[data-theme="light"] .stl-export-menu { background: #ffffff; border-color: #d0d7de; box-shadow: 0 8px 24px rgba(31,35,40,0.18); }
.stl-panel[data-theme="light"] .stl-export-item { color: #57606a; }
.stl-panel[data-theme="light"] .stl-export-lock { color: #57606a; }
.stl-panel[data-theme="light"] .stl-export-soon { color: #57606a; background: rgba(208,215,222,0.5); }
/* ── DESKTOP TYPE SCALE: larger legend type on desktop, so the data reads more easily.
   Desktop panel only — the
   mobile sheet (.legend-mobile-sheet) keeps its own compact sizes. Size only, never layout;
   the base rules above stay as the mobile/default scale. ── */
.stl-panel:not(.legend-mobile-sheet *) .stl-tb-title,
.stl-panel:not(.legend-mobile-sheet *) .stl-tb-text { font-size: 14px; }
.stl-panel:not(.legend-mobile-sheet *) .stl-tb-eyebrow { font-size: 11px; }
.stl-panel:not(.legend-mobile-sheet *) .stl-tab { font-size: 12px; }
.stl-panel:not(.legend-mobile-sheet *) .stl-hdr-name { font-size: 13px; }
.stl-panel:not(.legend-mobile-sheet *) .stl-hdr-num { font-size: 10px; }
.stl-panel:not(.legend-mobile-sheet *) .stl-name { font-size: 15px; }
.stl-panel:not(.legend-mobile-sheet *) .stl-num { font-size: 13px; }
/* The numeric columns must grow with the type: "POPULATION" at 10px is ~65px, ~76px with
   its sort arrow; "139.0M" at 13.5px is ~49px. A fixed 44px column let the header collide
   with "UUPGs" and let values spill into the neighbouring column. */
.stl-panel:not(.legend-mobile-sheet *) .stl-inner { --stl-num-w: 70px; }   /* the vars live on .stl-inner */
.stl-panel:not(.legend-mobile-sheet *) .stl-hdr-num,
.stl-panel:not(.legend-mobile-sheet *) .stl-num { white-space: nowrap; }
.stl-panel:not(.legend-mobile-sheet *) .stl-info-pop { font-size: 13px; }
.stl-panel:not(.legend-mobile-sheet *) .stl-empty,
.stl-panel:not(.legend-mobile-sheet *) .stl-overflow { font-size: 12.5px; }

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .stl-panel, .stl-collapse-btn svg, .stl-row, .stl-reopen, .stl-chip { transition: none !important; animation: none !important; }
  /* The spinner MEANS "loading". Stopped dead it is a static ring that says nothing, so it is
     slowed to a step crawl: still visibly working, no smooth spin. */
  .stl-spinner { animation: stl-spin 2.4s steps(8, end) infinite !important; }
}
`, 'semantic-tree-legend')
</script>

<template>
  <div class="stl-panel" :class="{ closed: !panelOpen, 'fit-content': hideTabs }" :data-theme="instance?.theme.value || 'dark'">
    <div class="stl-inner">

      <div class="stl-titlebar" :class="{ 'has-progress': !!progressData }">
        <!-- #title-caret slot — parent (e.g., LegendMobile) injects its own
             caret here so it's vertically aligned with the title text via
             flex align-items:center. Falls through to PPLR's default
             .stl-collapse-btn when no slot is provided (desktop). -->
        <span class="stl-tb-caret-slot"><slot name="title-caret" /></span>
        <!--
          ★ aria-label MIRRORS title, and aria-expanded reports the STATE (2026-09-21).
          This button's only content is an <svg> caret, so with `title` alone its accessible name
          was EMPTY — a screen reader announced "button". title is a TOOLTIP, not an accessible
          name: unreliably announced and never surfaced to touch users.
          Caught by check:a11y-button-names, which measures the RENDERED DOM: a source grep cannot
          answer this (132 `<button>` hits here, most with visible text, which IS a valid name).
          aria-expanded matters because this is a DISCLOSURE control — without it AT announces the
          action but not whether the panel is currently open.
        -->
        <button
          v-if="!$slots['title-caret']"
          class="stl-collapse-btn"
          :class="{ closed: !panelOpen }"
          :title="panelOpen ? t('aria.collapseLegend') : t('aria.expandLegend')"
          :aria-label="panelOpen ? t('aria.collapseLegend') : t('aria.expandLegend')"
          :aria-expanded="String(panelOpen)"
          @click="panelOpen = !panelOpen; emit('update:open', panelOpen)">
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <template v-if="parentBreadcrumb && selectedNode">
          <span class="stl-tb-eyebrow">{{ parentBreadcrumb.tabName }}</span>
          <!-- Clickable breadcrumb: drills UP the tree onto the parent
               family/group. Keyboard-focusable button with aria-label; Enter/
               Space activate natively. -->
          <button type="button" class="stl-tb-up"
            :title="t('legend.a11y.goUp', { label: parentBreadcrumb.node.label })"
            :aria-label="t('legend.a11y.goUp', { label: parentBreadcrumb.tabName + ' ' + parentBreadcrumb.node.label })"
            @click.stop="upToParent">
            <svg class="stl-tb-up-icon" width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 7.5L6 4.5L9 7.5" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span v-if="parentBreadcrumb.node.color" class="stl-tb-dot"
              :style="{ background: parentBreadcrumb.node.color }"></span>
            <span class="stl-tb-text" :title="parentBreadcrumb.node.label">{{ parentBreadcrumb.node.label }}</span>
          </button>
        </template>
        <template v-else>
          <span class="stl-tb-title">{{ displayTitle }}</span>
        </template>

        <!-- Export affordance — top-right of the titlebar. Gated by the shared
             SHOW_EXPORT_BUTTON kill-switch (currently false), the per-app-profile
             feature flag AND a current row selection. The path is functional:
             the menu items emit('export', kind) and profiles wire @export to a
             working Poster/Packet PDF download — flip the kill-switch to ship it. -->
        <div v-if="SHOW_EXPORT_BUTTON && exportEnabled && selectedNode" class="stl-export">
          <button type="button" class="stl-export-btn"
            :class="{ open: exportMenuOpen }"
            :aria-expanded="exportMenuOpen ? 'true' : 'false'"
            aria-haspopup="menu"
            :title="t('legend.exportSelection')"
            :aria-label="t('legend.exportSelection')"
            @click.stop="toggleExportMenu">
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 1.5V9M7 1.5L4.2 4.3M7 1.5L9.8 4.3" stroke="currentColor"
                stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 9.5V11.5C2 12.05 2.45 12.5 3 12.5H11C11.55 12.5 12 12.05 12 11.5V9.5"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <span class="stl-export-label">{{ t('legend.exportButton') }}</span>
          </button>

          <template v-if="exportMenuOpen">
            <!-- Click-away backdrop closes the menu without a global listener. -->
            <div ref="scrimRef" :style="scrimStyle" class="stl-export-backdrop" @click.stop="exportMenuOpen = false"></div>
            <div class="stl-export-menu" role="menu">
              <button type="button" class="stl-export-item" role="menuitem" @click.stop="emitExport('poster')">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <rect x="2" y="1.5" width="8" height="9" rx="1" stroke="currentColor" stroke-width="1.3"/>
                  <path d="M4 4.5H8M4 6.5H8M4 8.5H6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                </svg>
                <span class="stl-export-item-label">{{ t('legend.export.poster') }}</span>
              </button>
              <!-- The CARD DECK for the selection: one prayer card per people group (the same deck the
                   poster walls print). Opt-in per host, see exportCards. -->
              <button v-if="exportCards" type="button" class="stl-export-item" role="menuitem" @click.stop="emitExport('cards')">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <rect x="1.5" y="2.5" width="6" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/>
                  <rect x="4.5" y="1.5" width="6" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/>
                </svg>
                <span class="stl-export-item-label">{{ t('buttons.cardDeck') }}</span>
              </button>
              <!-- ★ THE PACKET ITEM IS A DISCLOSURE, NOT A PRINT. Clicking it no longer prints
                   immediately, because there are now two packets it could mean. It EXPLAINS what a
                   UPG 100 list is — the item is the only place a reader meets the idea — and reveals
                   the two variants beneath.
                   Same one-open-at-a-time shape as the card deck's size row in PosterWall: a single
                   ref holding which item is open, so a second disclosure here later cannot leave two
                   panels open at once. Deliberately NOT a <select>: a native dropdown collides with
                   other dropdowns on the host page, which is the constraint that shaped the other
                   one too. -->
              <button type="button" class="stl-export-item" role="menuitem"
                :aria-expanded="String(packetOpen)" @click.stop="packetOpen = !packetOpen">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M3 1.5H7.5L9.5 3.5V10.5H3V1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                  <path d="M7.5 1.5V3.5H9.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                  <path d="M4.5 6H8M4.5 8H7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                </svg>
                <span class="stl-export-item-label">{{ t('legend.export.packet') }}</span>
                <span class="stl-export-caret" :class="{ 'is-open': packetOpen }" aria-hidden="true">▾</span>
              </button>
              <div v-if="packetOpen" class="stl-export-sub" role="group" :aria-label="t('legend.export.packetAria')">
                <p class="stl-export-note">{{ t('legend.export.packetExplain') }}</p>
                <button type="button" class="stl-export-item stl-export-subitem" role="menuitem"
                  @click.stop="emitExport('packet:full')">
                  <span class="stl-export-item-label">{{ t('legend.export.packetFull') }}</span>
                </button>
                <button type="button" class="stl-export-item stl-export-subitem" role="menuitem"
                  @click.stop="emitExport('packet:lightweight')">
                  <span class="stl-export-item-label">{{ t('legend.export.packetLightweight') }}</span>
                </button>
              </div>
            </div>
          </template>
        </div>

        <!-- Prayer progress bar — header line 2 (prayer legend only), bar only: the counts
             live in the rows below. Hover / focus a span for its popover; click selects
             the matching row (selectSegment). -->
        <LegendProgressBar
          v-if="progressData"
          class="stl-progress"
          :show-text="false"
          :covered="progressData.covered"
          :total="progressData.total"
          :segments="progressData.segments"
          :is-dark="stlIsDark"
          :fmt-count="fmtCount"
          @select-segment="selectSegment"
        />
      </div>

      <div v-if="!hideTabs" class="stl-tabs-wrap">
        <div class="stl-tabs">
          <div v-for="(tab, idx) in tabList" :key="tab.id"
            class="stl-tab-chip" :class="{ active: activeTab === idx }">
            <button class="stl-tab" @click="switchTab(idx)">{{ tabLabel(tab) }}</button>
            <button v-if="tab.info" class="stl-tab-info" :title="tabInfo(tab)"
              @click="showInfo(idx, $event)">i</button>
          </div>
        </div>
        <div v-if="showInfoForTab !== null && tabList[showInfoForTab]?.info" class="stl-info-pop">
          {{ tabInfo(tabList[showInfoForTab]) }}
        </div>
      </div>

      <div class="stl-col-hdr">
        <span class="stl-caret-sp"></span>
        <span class="stl-dot-sp"></span>
        <span class="stl-hdr-name">{{ columnLabel || (hideTabs ? title : (tabLabel(tabList[activeTab]) || t('legend.columns.name'))) }}</span>
        <button v-if="hasCount" class="stl-hdr-num"
          :class="{ active: sortBy === 'count' }"
          :title="t('legend.sortByUpgs')"
          @click="clickSortHeader('count')">
          {{ t('legend.columns.upgs') }}
          <span v-if="sortBy === 'count'" class="stl-sort-arrow">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
        </button>
        <button v-if="hasPop" class="stl-hdr-num"
          :class="{ active: sortBy === 'pop' }"
          :title="t('legend.sortByPop')"
          @click="clickSortHeader('pop')">
          {{ t('legend.columns.population') }}
          <span v-if="sortBy === 'pop'" class="stl-sort-arrow">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
        </button>
        <span class="stl-x-slot"></span>
      </div>

      <div class="stl-rows" :class="{ 'has-sel': hasSel }" ref="rowsContainer">
        <div v-for="row in visibleRows" :key="row.node.id"
          class="stl-row" :class="rowClasses(row)"
          :data-stl-node-id="row.node.id"
          :style="{
            '--trunk-color': (row.parent?.color || '#6e7681'),
            '--row-color':   (row.node.color   || '#73A17F'),
          }"
          @click="selectNode(row.node)">
          <span v-for="(seg, i) in row.trunks" :key="`tr${i}`"
            class="stl-trunk" :class="`stl-trunk-${seg}`"></span>
          <!-- ★ AN ICON-ONLY DISCLOSURE NEEDS A NAME AND A STATE. This button held a 9x9 <svg> and
               nothing else — no text, no aria-label, not even a title — so assistive technology
               announced "button" seven times per legend with no indication of what any of them
               did. check:a11y-button-names found 14 visible nameless buttons across two leaves and
               these are all of them: country-posters-mfe COMPOSES countries-map, so it is the same
               seven counted twice. Naming them here fixes every bundle that renders this legend,
               which is the point of it living in library/.
               aria-expanded comes with it, because a name alone tells a screen-reader user what
               the control is for and still not whether the branch is open. -->
          <button v-if="row.node.children?.length"
            class="stl-caret" :class="{ open: expandedIds.has(row.node.id) }"
            :aria-expanded="expandedIds.has(row.node.id) ? 'true' : 'false'"
            :aria-label="t(expandedIds.has(row.node.id) ? 'legend.a11y.collapseRow' : 'legend.a11y.expandRow', { label: row.node.label })"
            @click.stop="toggleExpand(row.node.id, $event)">
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.6"
                stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span v-else class="stl-caret-sp"></span>
          <span v-if="row.node.color" class="stl-dot" :style="{ background: row.node.color }"></span>
          <span v-else class="stl-dot-sp"></span>
          <span class="stl-name">{{ row.node.label }}</span>
          <span v-if="hasCount" class="stl-num">{{ fmtCount(row.node.count) }}</span>
          <span v-if="hasPop"   class="stl-num">{{ fmtPop(row.node.pop) }}</span>
          <span class="stl-x-slot">
            <!-- The same defect, latent: this one carries a `title`, and a title is a TOOLTIP —
                 unreliably announced and never shown to touch users — so its accessible name was
                 also empty. It escaped the gate only because it renders while a row is SELECTED
                 and the sweep measured an unselected legend. Hardcoded English besides, on a
                 component whose every other string is translated. -->
            <button v-if="selectedId === row.node.id"
              class="stl-x-chip"
              :title="t('legend.a11y.clearSelection')"
              :aria-label="t('legend.a11y.clearSelection')"
              @click.stop="deselect($event)">
              <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </span>
        </div>

        <div v-if="tabLoading && !visibleRows.length" class="stl-empty stl-loading">
          <span class="stl-spinner"></span>
          <span>{{ T('legend.loadingRows', 'Loading {label}…').replace('{label}', tabList[activeTab]?.label || 'rows') }}</span>
        </div>
        <div v-else-if="!visibleRows.length && nodes.length === 0" class="stl-empty">{{ T('legend.loadingData', 'Loading data…') }}</div>
        <div v-else-if="!visibleRows.length" class="stl-empty">{{ t('legend.noDataAtThisLevel') }}</div>
        <div v-if="topNodesOverflow > 0" class="stl-overflow">
          {{ T('legend.showingTop', 'Showing top {n} of {m}')
               .replace('{n}', tabList[activeTab].topLimit.toLocaleString())
               .replace('{m}', topNodesAll.length.toLocaleString()) }} —
          <span class="stl-overflow-hint">{{ T('legend.useGeocoderHint', 'use the geocoder above to find the rest') }}</span>
        </div>
      </div>
      <ApproxPinNote v-if="showPinNote" :dark="stlIsDark" />
    </div>
  </div>

  <button v-if="!panelOpen"
    class="stl-reopen"
    :data-theme="instance?.theme.value || 'dark'"
    :title="t('aria.expandLegend')"
    :aria-label="t('aria.expandLegend')"
    @click="panelOpen = true; emit('update:open', true)">
    <svg class="stl-reopen-icon" width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M2 4h8M2 6h8M2 8h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
    <span class="stl-reopen-label">
      <template v-if="selectedNode">
        <span v-if="selectedNode.color" class="stl-reopen-dot"
          :style="{ background: selectedNode.color }"></span>
        {{ selectedNode.label }}
      </template>
      <template v-else>{{ displayTitle }}</template>
    </span>
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" class="stl-reopen-caret">
      <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
</template>

<style scoped>
/* All runtime styles injected via useShadowStyles for shadow DOM compatibility. */
</style>
