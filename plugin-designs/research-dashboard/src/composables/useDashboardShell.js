/**
 * useDashboardShell.js — the config-driven dashboard assembler (DOXA-LIB-2 foundation).
 *
 * Does generically what research-dashboard.vue's <script setup> did by hand: create one
 * brushing-and-linking selection bus, load the single in-memory row store, derive the
 * (formerly copy-pasted) FACET_ACC accessor map from config.facets, compute the linked
 * filteredRows + KPI strip + CSV exporter + shareable hash URL + responsive layout flags,
 * and provide() the bus/data/config so every panel injects instead of hard-coding.
 *
 * The next dashboard becomes a thin app-profile that passes a config object — no pasted
 * filter loops, no pasted accessor maps, no pasted KPI math. Declare the config once; the
 * shell wires the whole CMV (coordinated-multiple-views) surface.
 *
 *   const { bus, data, FACET_ACC, filteredRows, kpis, exporter, responsive } = useDashboardShell(config)
 *
 * Provides (inject keys for panels):
 *   - 'selectionBus'   → the pub/sub bus (filterSet + selectionSet + on/emit/setFilter/toggleSelect)
 *   - 'dashboardData'  → the row store ({ rows, rowStore, total, loading, error, stats, load })
 *   - 'dashboardConfig'→ the profile config (facets, facetRail, kpis, columns, charts, detail, search, title)
 * (mapboxToken is provided upstream by ProfileLoader; panels inject it directly.)
 *
 * Logic moved VERBATIM from research-dashboard.vue — filter predicate, KPI math, ResizeObserver
 * responsive switch, collapsible table dock, segmented mobile view, and the location.hash sync.
 * Only the SOURCE of the per-dashboard constants changed: from hard-coded → config.
 */
import { exactMatches, fuzzyMatches, resolveFuzzyValues } from '@map/components/search/fuzzy.js'
import { provide, inject, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { createSelectionBus } from '@map/composables/useSelectionBus.js'
import { useDashboardData } from '@map/composables/useDashboardData.js'
import { useCsvExport } from '@map/composables/useCsvExport.js'
import { useShareableView } from '@map/composables/useShareableView.js'
import { buildSearchAccessors, makeSearchMatcher, filterRowsBySearch } from '@map/composables/useDashboardSearch.js'
import { formatCount } from '@map/utils/formatCount.js'
import { useTreeLegendLabels } from './useTreeLegendLabels.js'
import { useTreeLegendColors } from './useTreeLegendColors.js'
import { DataSourceManager } from '@map/api/DataSourceManager.js'
import sourcesConfig from '@map/api/sources.json'
import { tStatic, getRuntimeLocale } from '@map/i18n/index.js'

// tiny lodash-free mapValues: { k: v } -> { k: fn(v, k) }
const mapValues = (obj, fn) =>
  Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, fn(v, k)]))

// number formatter (same as the old inline `fmt`); exported for the profile's KPI strip.
export const fmt = (n) => (n === null || n === undefined ? '—' : formatCount(n))

// ── THE SHARED SEARCH LIVES IN library/composables/useDashboardSearch.js ─────────────────────
// It was extracted there by kit landing 4a and these three functions were left DEFINED here as
// well — code-identical copies, about 3KB, including the Fuse.js matcher. Nothing had diverged yet,
// but the comment that used to sit here said the whole point of ONE declaration is that "the
// searchable text can never drift from what the panels show", and two copies is how that drift
// starts. This file now imports them like every other consumer; the definitions live in one place.
/**
 * Generic KPI computation driven by config.kpis. Each kpi def declares a `kind`:
 *   count    → row count of the filtered scope (+ optional delta = hidden-by-filter count)
 *   sum      → Σ Number(row[field])
 *   pct      → round( rows.filter(test).length / rows.length * 100 )%  ('—' when empty)
 *   distinct → size of the set produced by an accessor (via config.facets[field][via], e.g. geoIso)
 * Mirrors the old statTotal/statPop/statPctUnreached/statCountries/statPraying/statAdoptedPct
 * computeds — only the definitions now come from config instead of being hand-written.
 */
function computeKpis(defs, filtered, all, FACET_ACC, config) {
  return (defs || []).map((k) => {
    let value
    let delta
    if (k.kind === 'count') {
      value = filtered.length
      if (k.showDelta) delta = Math.max(0, all.length - filtered.length)
    } else if (k.kind === 'sum') {
      value = filtered.reduce((s, r) => s + (Number(r[k.field]) || 0), 0)
    } else if (k.kind === 'pct') {
      value = filtered.length
        ? Math.round((filtered.filter(k.test).length / filtered.length) * 100) + '%'
        : '—'
    } else if (k.kind === 'distinct') {
      const acc = k.via ? config?.facets?.[k.field]?.[k.via] : FACET_ACC[k.field]
      const set = new Set()
      filtered.forEach((r) => { const v = acc ? acc(r) : r[k.field]; if (v) set.add(v) })
      value = set.size
    }
    return { id: k.id, label: k.label, kind: k.kind, value, delta }
  })
}

/**
 * Responsive layout flags via a ResizeObserver (shadow-DOM-reliable, unlike @container which
 * targets descendants not the container itself). Three steps so the map stays the hero:
 *   <760 single-column + segmented control; <980 slim facet rail; <1180 slim charts/detail rail.
 * Also owns the collapsible table dock (DataTable chevron emits 'toggleTable') and the
 * segmented mobile view switch. Extracted VERBATIM from research-dashboard.vue.
 */
function useResponsiveShell(bus) {
  const shell = ref(null)
  const isNarrow = ref(false)
  const slimRail = ref(false)
  const slimFacet = ref(false)
  const mobileView = ref('map')
  // Getters, for the same reason dashboard.config.js uses them: this array is built before the
  // locale is necessarily known, and a resolved string would freeze the first locale seen.
  const SEG = [
    { k: 'map',    get l() { return tStatic('dashboard.map') || 'Map' } },
    { k: 'facets', get l() { return tStatic('dashboard.filters') || 'Filters' } },
    { k: 'table',  get l() { return tStatic('dashboard.table') || 'Table' } },
    { k: 'charts', get l() { return tStatic('dashboard.charts') || 'Charts' } },
  ]
  let ro = null

  const tableCollapsed = ref(false)
  const facetCollapsed = ref(false)   // left filters rail collapsed → map grows
  const railCollapsed  = ref(false)   // right charts rail collapsed → map grows

  onMounted(() => {
    if (shell.value) {
      ro = new ResizeObserver(() => {
        const w = shell.value.clientWidth
        isNarrow.value = w < 760
        slimRail.value = w >= 760 && w < 1180
        slimFacet.value = w >= 760 && w < 980
      })
      ro.observe(shell.value)
    }
    // collapsible table dock (P5): DataTable's chevron emits 'toggleTable'
    if (bus) bus.on('toggleTable', (v) => { tableCollapsed.value = !!v })
    if (bus) bus.on('toggleFacet', (v) => { facetCollapsed.value = !!v })
    if (bus) bus.on('toggleRail',  (v) => { railCollapsed.value  = !!v })
  })
  onBeforeUnmount(() => ro && ro.disconnect())

  function setView(e) { const el = e.target.closest('[data-view]'); if (el) mobileView.value = el.getAttribute('data-view') }
  const showFacets = computed(() => !isNarrow.value || mobileView.value === 'facets')
  const showMap = computed(() => !isNarrow.value || mobileView.value === 'map')
  const showTable = computed(() => !isNarrow.value || mobileView.value === 'table')
  const showCharts = computed(() => !isNarrow.value || mobileView.value === 'charts')

  return {
    shell, isNarrow, slimRail, slimFacet, mobileView, SEG, tableCollapsed, facetCollapsed, railCollapsed,
    setView, showFacets, showMap, showTable, showCharts,
  }
}

// The shareable view-state hash moved to library/composables/useShareableView.js (persona card
// BUILD-SHAREABLE-FILTERED-TABLES). It was private to this file, so exactly one dashboard in the fleet
// could produce a share link; nothing in it was research-specific except its address. This dashboard
// supplies the one thing that is: labelFor, for the display-only *slug.

export function useDashboardShell(config) {
  // One brushing-and-linking bus, provided to every panel (publisher + subscriber).
  const bus = createSelectionBus()

  // Teach the bus this profile's facet hierarchy, derived from config.facetRail[].drill, so that
  // clearing a parent facet cascade-clears its descendants on EVERY clear path (tree rail /
  // dropdowns / chip ✕ / Clear All all route through bus.setFilter). Without this, a child
  // predicate outlives its parent and silently ANDs an empty result — see the HIERARCHY CONTRACT
  // in useSelectionBus.js. Configured before any panel can emit a filter.
  bus.configureHierarchy(config)

  // The single in-memory row store — one fetch on mount. (useDashboardData reads the shared
  // @map/config/sources.json activeSource + getApiBaseUrl; config.data may carry overrides.)
  const data = useDashboardData(config.data)

  // THE single former-duplicated FACET_ACC, derived ONCE from config.facets (facetKey -> get).
  const FACET_ACC = mapValues(config.facets, (f) => f.get)

  // Free-text search (header-1 search bar) — ONE shared matcher (buildSearchAccessors +
  // makeSearchMatcher), reused by every panel so the searchable text never drifts.
  const matchSearch = makeSearchMatcher(bus, buildSearchAccessors(config))

  // linked scope: rows surviving every active facet predicate AND the text search (panels fade the rest).
  const filteredRows = computed(() => {
    const rows = data.rows.value || []
    const keys = Object.keys(bus.filterSet)
    const hasText = !!(bus.searchTerm?.value || '').trim()
    if (!keys.length && !hasText) return rows
    const faceted = keys.length
      // ONE predicate, owned by the bus (SPEC-DASHBOARD-KIT D1). This line was the seventh copy
      // of `a(r) === filterSet[k]`; with multi-value filters the copies would have disagreed.
      ? rows.filter((r) => bus.rowMatchesFilters(r, FACET_ACC))
      : rows
    // Tiered search over the faceted scope: exact first, fuzzy only if exact finds nothing.
    return filterRowsBySearch(faceted, matchSearch)
  })

  // linked KPI strip — recomputes on every brush.
  const kpis = computed(() => computeKpis(config.kpis, filteredRows.value, data.rows.value || [], FACET_ACC, config))

  // responsive flags + collapsible table dock + segmented mobile view.
  const responsive = useResponsiveShell(bus)

  // ── dataStore adapter (GAP B) — DataSourceManager-normalized (DASH-FIX-2) ──
  // The header's GeocoderComponent bars (DOXA-LIB-3) run useEntitySearch over an
  // injected `dataStore` to surface local people-group / country / language /
  // religion / affinity-bloc / cluster / region suggestions. The MAP profiles get
  // that dataStore from useMapData, which normalizes each raw API row through
  // DataSourceManager — producing the rich feature shape useEntitySearch.buildIndex
  // reads (countryName, affinityBlock[+Label], cluster[+Label], peopleGroup[+Label],
  // wagfRegion/wagfBlock[+Label], religion[+Name], language, _raw).
  //
  // The previous hand-rolled adapter mapped only a few facet accessors, so its
  // features were MISSING the affinity/cluster/PG/region label fields → the
  // geocoder's blocs / clusters / people-groups / families / dialects aggregates
  // never populated and the dashboard dropdown read WORSE than research-map's.
  // FIX: normalize the dashboard's already-loaded raw rows through the SAME
  // DataSourceManager the map uses (reusing the rows we already fetched — no second
  // network request), so useEntitySearch builds an IDENTICAL index and the dropdown
  // results CLONE research-map's. Keyed under the active source id + provided as
  // `searchSourceId` so the bars pass :data-source-id (mirrors research-map's
  // geocoder wiring, GeocoderComponent :data-source-id).
  // Use the SAME source the rows were loaded from (data.sourceId — honors
  // config.data.source, defaults to sourcesConfig.activeSource) so the geocoder's
  // normalization config matches the loaded rows and the bars pass the matching
  // :data-source-id. Never desyncs the row source from the search source.
  const searchSourceId = data.sourceId || sourcesConfig.activeSource
  const searchSourceCfg = sourcesConfig.sources?.[searchSourceId] || {}
  // It only normalizes rows already narrowed to the page's list (useDashboardData), but it carries the
  // config like every other manager, so nothing it ever loads can skip the list.
  let _pc = null
  try { _pc = inject('profileConfig', null) } catch (_) { /* outside setup */ }
  const dsm = new DataSourceManager({ profileConfig: _pc })
  const geoFeatures = computed(() => {
    const rows = data.rows.value || []
    if (!rows.length) return []
    // normalizeData() consumes AND frees its `rawData` (sets it to null when done);
    // hand it a shallow copy so the dashboard's own row store is never mutated/cleared.
    dsm.rawData = rows.slice()
    dsm.normalizeData(searchSourceCfg)
    return dsm.normalizedData
  })
  // Shape matches what useEntitySearch expects: dataStore.sources[id].features.
  // `features` is a getter over the computed so useEntitySearch's reactive index
  // rebuilds when the rows load.
  const dataStore = { sources: { [searchSourceId]: { get features() { return geoFeatures.value } } } }

  // selection > filter > all CSV exporter (clipboard-primary, sandbox-safe). `dataOpts` carries the
  // profile's source so the exporter's lazy ALL-FIELDS fetch hits the SAME source the rows came from.
  // `labelFor` resolves People CODES to names in the provenance COMMENT line only — constructed
  // here, below `dataStore`, because the resolver reads the normalized features it exposes.
  // Data columns are unaffected (see useCsvExport.buildCsv).
  const { labelFor } = useTreeLegendLabels(config, dataStore, searchSourceId)
  // The exporter selects rows with the BUS's predicate, not a copy of it (D1).

  // shareable view-state hash URL -- below labelFor on purpose: the hash's display-only slugs
  // resolve through the SAME code->name resolver the chips and the CSV provenance line use.
  useShareableView(bus, { labelFor })
  const exporter = useCsvExport({ rowStore: data.rowStore, rows: data.rows, selectionSet: bus.selectionSet, filterSet: bus.filterSet, FACET_ACC, dataOpts: config.data, labelFor, rowMatches: bus.rowMatchesFilters })

  // ★ THE RESEARCH LEGEND, HANDED TO THE PANELS AS DATA (kit landing 4b).
  // The facet rail and the chip bar used to IMPORT useTreeLegendColors and useTreeLegendLabels
  // directly. Those two files are the DOXA palettes and the People code tables — research-specific
  // by this kit's own reckoning, and they stay in plugin-designs. A library component importing
  // them would be a library-to-plugin dependency, which check:no-cross-plugin-imports rightly
  // refuses, so the rail could never have become kit code by moving alone.
  // So the dependency inverts: the panels declare what they need (two functions) and the SHELL
  // supplies it. The shell is the right supplier because it is the only thing that already has the
  // config, the dataStore and the source id these composables require, and because a composable
  // cannot be called at config-module scope.
  // It goes on dashboardConfig rather than through a new inject key, per section 5.1 of the spec: a
  // panel that needs a new capability gets a new CONFIG key, never a new channel. Merged rather than
  // assigned, so a profile that supplies its own `legend` wins and is not silently overwritten.
  const { colorFor } = useTreeLegendColors()
  if (!config.legend) config.legend = { colorFor, labelFor }

  provide('selectionBus', bus)
  provide('dashboardData', data)
  provide('dashboardConfig', config)
  provide('dataStore', dataStore)
  provide('searchSourceId', searchSourceId)

  // ★ A LOCALE CHANGE MUST REFETCH, not just re-render — the country, religion and region labels
  // come from the API's ?lang=, so without this the chrome switches language and every DATA label
  // keeps the language of first paint. Same rule and same shape as region-dashboards.vue:680,
  // which learned it the same way. Guarded on a real change so the mount fetch is not doubled.
  let _lastLang = null
  // inject() ONLY works during setup — calling it inside the watch callback would warn on every
  // tick and return null, so the ref is captured HERE and only READ later. This file already does
  // the same for profileConfig, for the same reason.
  let _langRef = null
  try { _langRef = inject('lang', null) } catch (_) { /* called outside setup */ }
  const _langNow = () => (_langRef && _langRef.value) || getRuntimeLocale() || ''
  watch(_langNow, (next) => {
    if (next === _lastLang) return
    _lastLang = next
    data.load()
  })

  onMounted(() => { _lastLang = _langNow(); data.load() })

  return { bus, data, FACET_ACC, filteredRows, kpis, exporter, responsive }
}
