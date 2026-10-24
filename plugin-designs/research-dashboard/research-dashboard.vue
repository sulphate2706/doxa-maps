<script setup>
/**
 * @description Coordinated-Multiple-Views research dashboard for 10/40-window UPGs (live pray.doxa.life): docked facet rail + map-as-hero + linked table/charts, brushing-and-linking over one in-memory store.
 * @profile     research-dashboard
 * @bundle      research-dashboard
 * @element     research-dashboard-map
 *
 * DOXA-LIB-2 thin profile: the page composition + grid CSS + a CONFIG import. All logic
 * (bus, store, FACET_ACC, filteredRows, KPI math, CSV, hash, responsive) lives in the shared
 * library via useDashboardShell(config); the panels come from @map/components/dashboards and
 * read their per-dashboard data from inject('dashboardConfig'). Behaviour is identical to the
 * original research-dashboard — only the duplication was hoisted into the library.
 *
 * RESEARCH-FILTERS (DX-life clone): DashboardResearchFilters sits between the topbar and the
 * KPI strip as header-1 (search bar) + header-2 (the expand-filters dropdown SET — ONE row,
 * horizontal-scroll on overflow). It is a THIN ADAPTER over the SHARED, parameterized
 * @map/components/search/SearchFilterHeader.vue (cloned from the DX-life research page's
 * UupgsList filter block), coupling it to the selection bus: the search bar → bus.setSearch,
 * a dropdown pick → bus.setFilter(facetKey, label). Every linked panel (table/map/charts/
 * facet-rail/KPIs) honors bus.searchTerm via the shared makeSearchMatcher, so searching AND
 * filtering re-derive the whole surface with no panel edits. config.researchFilters +
 * config.searchKeys drive which axes show + what the text search matches. The geocoder-based
 * DashboardSearchHeader (DOXA-LIB-3) remains available in the kit but is not mounted here.
 */
import { computed, watch, inject, ref, unref, onMounted, onBeforeUnmount } from 'vue'
import { tStatic, formatList } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it. The English stays as the fallback, so a missing key degrades to what
// shipped rather than to a key name.
const T = (key, en) => tStatic(key) || en
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { useDashboardShell, fmt } from './src/composables/useDashboardShell.js'
import { useDashboardLayout } from '@map/composables/useDashboardLayout.js'
// The facet rail is a KIT component now (landing 4c-3) and is imported from the library directly.
// The plugin barrel re-exported it for one cycle so the move and the import change were separate
// landings; that shim is gone, so this is the only line that names its location.
import DashboardFacetRail from '@map/components/dashboards/DashboardFacetRail.vue'
import {
  DashboardTopBar,
  DashboardResearchFilters,
  DashboardMapPanel,
  DashboardDataTable,
  DashboardChartsRail,
  DashboardDetailDrawer,
} from './src/components/dashboards'
import config from './dashboard.config.js'

// ── HOST OVERRIDES ───────────────────────────────────────────────────────────────────────────
// `config` above is a STATIC import, so until now nothing a host passed could reach the dashboard's
// own settings. That made the new `provider` option settable IN SOURCE but not reachable by an
// EMBEDDER — real, and unusable, which is the same presence-vs-reachability trap as a nav control
// that exists off-canvas. "Hot-swappable" has to mean a partner can choose without a rebuild.
//
// profileConfig is the channel every other plugin already uses for exactly this
// (doxa-simple-map.vue:275, poster-wall.vue:45), so this adds no new mechanism — it just stops the
// dashboard from being the one plugin that ignores it.
//
// SHALLOW MERGE, HOST WINS, and shallow is deliberate: the static config's nested objects (facets,
// columns, charts) are a coherent set that a partial override would corrupt. What a host legitimately
// sets is top-level scalars — `provider`, `mapStyle`, a title. A deep merge would invite half-replaced
// facet maps, which fail far from the edit.
// ★ ONE DELIBERATE EXCEPTION TO "SHALLOW", MEASURED 2026-09-22. `map` is merged ONE LEVEL DEEP.
// The reasoning above is sound for facets/columns/charts — a coherent set a partial override would
// corrupt — but it produced a REAL, reachable bug for `map`, which is not that kind of object. It
// is a BAG OF INDEPENDENT SCALARS (mapStyle, geoFacet, noDataColor, selectedColor, outlineColor,
// heartbeatThreshold), each read separately as `cfg.map?.x || default`. Under a purely shallow
// merge, a host passing the single key it cares about —
//     { map: { heartbeatThreshold: 40 } }
// — REPLACES the whole object, silently dropping mapStyle:'paper' and reverting the basemap. So
// the one override a host is most likely to write was the one that broke the map. That is the same
// presence-vs-reachability trap this block was added to close, one level down.
//
// Scoped to `map` ONLY, and deliberately NOT a generic deep merge: the original warning about
// half-replaced facet maps still stands for every other key.
const hostConfig = inject('profileConfig', ref(null))

// ── HOW AN EMBEDDER SETS THE HEARTBEAT THRESHOLD (and why this is NOT a defineProps) ─────────
// ★ MEASURED, and the obvious answer was WRONG. The instinct is to add
// `defineProps({ heartbeatThreshold })` here so a partner can write
// `<research-dashboard-map heartbeat-threshold="40">`. THAT PROP WOULD NEVER BE POPULATED. The
// custom element registered by index.js is ProfileLoader — not this component — and ProfileLoader
// renders the profile as `<component :is="ProfileComponent" />` (library/ProfileLoader.vue:244)
// with NO props bound. A prop declared here is unreachable from the tag: it would read as
// configurable, type-check clean, build clean, and silently never fire. That is the exact
// presence-vs-reachability trap described above, and adding the prop would have re-created it
// while looking like the fix for it.
//
// THE REAL, ALREADY-WORKING ATTRIBUTE PATH is ProfileLoader's `profile-config` JSON string
// (library/ProfileLoader.vue:39), which it parses and provide()s as 'profileConfig' — the very
// channel `hostConfig` reads above. So an embedder writes:
//
//   <research-dashboard-map
//     profile-config='{"profile":"research-dashboard","map":{"heartbeatThreshold":40}}'>
//   </research-dashboard-map>
//
// and cap-2 instances.json entries set the same thing under their `props` block. No new mechanism
// is needed — but it only became USABLE with the one-level `map` merge below, because until then
// that exact snippet also wiped mapStyle:'paper'.
const mergedConfig = computed(() => {
  const h = unref(hostConfig)
  if (!h || typeof h !== 'object') return config
  const merged = { ...config, ...h }
  if (h.map && typeof h.map === 'object') merged.map = { ...config.map, ...h.map }
  return merged
})

// ── PAGE-SCROLL LAYOUT MODE (BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID) ─────────────────────────────
// ★ THE BUG THIS EXISTS FOR, after four wrong diagnoses that each blamed something nearer the
// cursor. This dashboard is a FIXED-VIEWPORT app: .rd-shell is a CSS grid with height:100% whose
// last row is the table at var(--table-h,34%), and the table scrolls INTERNALLY. Standalone that is
// right. But the cap-4 composite stacks it ABOVE a people-groups grid and expects the PAGE to
// scroll, pinning this band to 88svh so height:100% resolves. At a 900px viewport that makes the
// table 269px over 54834px of rows — so a wheel anywhere in the lower third lands on the table,
// which has 54 thousand pixels of its own to consume and never passes anything upward. MEASURED:
// the same gesture moved the page 2311px lower down and 300px over the dashboard. The grid below
// was unreachable by the gesture readers actually make.
//
// It is a LAYOUT MISMATCH, not a CSS property — two philosophies stacked. overscroll-behavior does
// not help (it governs chaining OUT of an element that has bottomed out; this one never bottoms
// out), and it was tried and reverted at b40fd5b.
//
// In page-scroll mode the shell stops being one screen tall and the table stops being an internal
// scrollport: rows render at full height and the PAGE carries them. There is then nothing under the
// cursor competing for the wheel.
//
// ★ WHY THIS RIDES profileConfig AND NOT A NEW PROP — see the heartbeat-threshold note above: the
// registered custom element is ProfileLoader, which renders the profile with NO props bound, so a
// defineProps here would type-check, build clean, and never fire. profile-config is the proven
// channel. A host opts in with:
//   <research-dashboard-map profile-config='{"profile":"research-dashboard","layout":"page-scroll"}'>
// Default is unset, so every existing embed keeps the fixed-viewport behaviour byte-for-byte.
const pageScroll = computed(() => unref(hostConfig)?.layout === 'page-scroll')

// The assembler: creates+provides the bus/data/config, computes the linked surface.
// Passed the MERGED config so a host-set `provider` reaches DashboardMapPanel via
// inject('dashboardConfig'). With no host config this is byte-for-byte the previous behaviour.
const { bus, data, kpis, exporter, responsive, filteredRows } = useDashboardShell(mergedConfig.value)

// ── ★ ANNOUNCE THE RESULT OF A FILTER (the dashboard's largest screen-reader gap) ─────────────
// THE DEFECT, measured 2026-09-26: this element contained exactly ONE role="status" (the table's
// selection pill) and ZERO aria-live regions. That is the specific way a cross-filtering dashboard
// fails a screen-reader user, and it is invisible to everyone else: the whole POINT of
// brushing-and-linking is that acting on ONE control changes a number somewhere ELSE. A sighted
// user picks "Islam" in the left rail and watches 2,107 become 693 in the KPI strip, the map and
// the table. A screen-reader user presses the same control, hears the control's own state change,
// and is told NOTHING about the 1,414 rows that just left the board. The filter worked; the
// feedback never existed.
//
// WHY IT LIVES IN THE SHELL AND NOT IN A PANEL. Six surfaces change on every brush (KPI strip,
// map, table, charts, chips, breadcrumb). A live region per panel would announce the same event
// up to six times, which is worse than silence — screen readers queue polite announcements, so the
// user would wait through five repetitions before reaching the next control. The shell is the one
// place that is above all six and mounted exactly once.
//
// POLITE, not assertive: this is a result, not an alert. `aria-atomic` so the whole sentence is
// re-read rather than the changed word alone ("693" announced by itself is not information).
//
// ★ THE NODE MUST EXIST BEFORE IT HAS TEXT. A live region that is INSERTED already containing its
// message is frequently not announced at all — the accessibility tree has to be observing the node
// when the text changes. So the element is always rendered and starts EMPTY; it is never v-if'd,
// never v-show'd, and never unmounted. (This is also why it is not inside any of the v-show'd
// region cells above.)
const liveMessage = ref('')
let liveTimer = null
let liveArmed = false
// Debounced, for the same reason useSelectionCamera debounces the camera: typing in the search box
// re-derives filteredRows on every keystroke, and an un-debounced polite region would queue one
// announcement PER CHARACTER and then read them all back in order. 700ms is past a normal typing
// cadence, so the user hears the settled answer once.
const LIVE_DEBOUNCE_MS = 700
function announce() {
  const shown = filteredRows.value.length
  const all = (data.rows.value || []).length
  // fmt() is the shell's own formatter. NUMERALS ARE HELD — this is deliberately the same
  // en-US grouping every visible surface already prints, so the announcement and the KPI strip
  // can never read as two different numbers.
  const unit = T('dashboard.groups', 'groups')
  let msg = T('dashboard.results_live', '{count} of {total} {unit} shown')
    .replace('{count}', fmt(shown)).replace('{total}', fmt(all)).replace('{unit}', unit)
  // The active filters, named. "693 of 2,107 groups shown" on its own does not say WHY, and the
  // chips that carry that answer are exactly what a screen-reader user cannot glance at.
  const active = Object.keys(bus.filterSet)
  if (active.length) {
    // CONJUNCTION: these are separate facets that all hold at once — Religion AND Affinity Bloc AND
    // Country — each one narrowing the set further. Read aloud, so the connector is the difference
    // between a list and a sentence in most locales.
    const names = formatList(active.map((k) => mergedConfig.value.facets?.[k]?.label || k), { type: 'conjunction' })
    msg += ' · ' + T('dashboard.filters_live', 'Filters: {list}').replace('{list}', names)
  }
  const q = (bus.searchTerm?.value || '').trim()
  if (q) msg += ' · ' + T('dashboard.search_live', 'Search: {term}').replace('{term}', q)
  liveMessage.value = msg
}
watch(
  // Every input that can move the count, in one key. filteredRows is the truth (it already folds
  // facets AND the tiered search), and the filter/search keys are included so that a change which
  // happens to leave the count identical — swapping one 693-row facet for another — still speaks.
  () => [filteredRows.value.length, JSON.stringify(bus.filterSet), bus.searchTerm?.value || ''].join('|'),
  () => {
    // ★ DO NOT SPEAK ON ARRIVAL. The first settled value is the page loading, not the user doing
    // something, and an element that announces itself the moment it mounts is noise a screen-reader
    // user cannot prevent — on an embed with several elements it is noise several times over. The
    // region arms itself after the first data-driven settle, so it only ever reports a CHANGE.
    if (!liveArmed) { liveArmed = true; return }
    clearTimeout(liveTimer)
    liveTimer = setTimeout(announce, LIVE_DEBOUNCE_MS)
  }
)
// A pending announcement must not outlive the element. Unmounting a dashboard mid-debounce (the
// SPA swaps tabs, a composite is torn down) would otherwise fire announce() against a dead
// instance — the same unmount-race class the map panel already guards.
onBeforeUnmount(() => clearTimeout(liveTimer))

// ── OUTWARD FILTER SIGNAL ────────────────────────────────────────────────────────────────
// WHY THIS EXISTS (measured 2026-09-22). This component was a SEALED BOX: zero defineProps,
// zero defineEmits. Its bus comes from createSelectionBus() inside useDashboardShell — a
// PER-INSTANCE factory, never provide()d and never on window — so nothing outside could observe
// a filter change. Measured consequence in the cap-4 composite: the dashboard reacted correctly
// (rows 22→21 on search, 21→6 on a facet pick) while the people-groups-grid BELOW it stayed at a
// byte-identical 24 cards every time. The grid was not broken; nobody was telling it anything.
//
// The sibling composite already does this correctly — big-picture's header declares
// `defineEmits(['research-filter'])` and the parent binds the result onto the grid's props. This
// mirrors that contract so the two cap-4 composites work the same way.
//
// PIGGYBACKS ON A PROVEN REACTIVE HOOK: useDashboardShell already runs
// `watch(() => ({ ...bus.filterSet }), syncHash, { deep: true })` to serialize filters into the
// URL hash, so filterSet is known to be reactive in exactly this shape. searchTerm is a separate
// ref and needs its own source in the watch.
const emit = defineEmits(['dashboard-filter'])

watch(
  () => ({ filters: { ...bus.filterSet }, q: bus.searchTerm?.value || '' }),
  ({ filters, q }) => emit('dashboard-filter', { filterSet: filters, searchTerm: q }),
  { deep: true }
)

// row-store flags for the template (auto-unwrapped in bindings)
const rowCount = data.total
const isLoading = data.loading
const loadError = data.error

// responsive flags + collapsible dock + segmented mobile view (from the shell)
const { shell, isNarrow, slimRail, slimFacet, mobileView, SEG, tableCollapsed, facetCollapsed, railCollapsed,
  setView, showFacets, showMap, showTable, showCharts } = responsive

// Drag-resize + persistence engine (desktop-only). Owns --facet-w / --rail-w / --table-h on the
// shell root; restores the saved layout on mount, persists on drag-end, and reset() (fired by the
// TopBar's "Align Dashboard" button via bus.emit('resetLayout')) snaps back to the exact defaults.
// Defaults MUST match the CSS spine below (facet 248, rail 312, table 34%) so an untouched board is
// pixel-identical and the responsive slim-rail classes keep working until the user drags.
const { startFacetResize, startRailResize, startTableResize, startShellResize, onResizeKeydown, facetW, railW, tableH, mapH, shellH } = useDashboardLayout({
  shellRef: shell,
  bus,
  isNarrow,
  // ★ BUG-TABLE-RESIZE-HANDLE-DOES-NOTHING: in page-scroll mode --table-h is force-set to `auto`
  // by the stylesheet and no longer drives any layout (see the pageScroll note above); the
  // composable needs to know so the table-axis handle can drive --rd-map-h instead.
  pageScroll,
  // ★ NAMESPACED PER DASHBOARD (kit landing 2). This was the single constant every dashboard
  // shared, which was harmless while there was only one and becomes a collision the moment a page
  // carries two — each would read and write the other's divider positions. config.id is the
  // profile's own identity, so a second dashboard on the same page gets its own drawer without its
  // author having to know this key exists. useDashboardLayout reads the old shared key once, so no
  // reader loses the layout they had.
  storageKey: 'rd-dashboard-layout:' + (mergedConfig.value?.id || 'default'),
  // MUST mirror the `:host` --facet-w/--rail-w defaults, or reset() would snap the rails to a
  // different balance than a fresh load shows. Tree wider than charts — see the rail-balance note.
  // mapH mirrors the page-scroll CSS fallback 40svh (~360px at a 900px viewport — see
  // BUG-DASHBOARD-BAND-GROWS-ENORMOUS: 58svh left the default band taller than one viewport;
  // 40svh is the value that makes chrome(137px) + map(X) + table(X+32px bar) sum to <=900px).
  // ★ NO LOCAL defaults OVERRIDE — deliberately. This line used to pass its own copy of the
  // numbers ({ mapH:360, shellH:720 }), which silently OVERRODE the composable's DEFAULTS via the
  // { ...DEFAULTS, ...options.defaults } merge. Result, measured 2026-09-23: the composable said
  // mapH 260 / shellH 502, this line said 360 / 720, the bundle carried BOTH, and this one won --
  // so two height-reclaim passes changed the shell by exactly nothing while every CSS fallback
  // moved. The one-quantity-one-owner rule, third costume: a duplicated DEFAULT is still a second
  // owner. The composable's DEFAULTS (useDashboardLayout.js:98, with the row arithmetic comment)
  // is the single home; anything this host needs to differ must be a conscious, single-key
  // override with a reason, never a full mirrored copy that drifts.
})

// KPI strip — generic formatting per kind (mirrors the original inline strip).
function kpiText(k) {
  if (k.kind === 'pct') return k.value
  if (k.kind === 'distinct') return k.value || '—'
  return fmt(k.value)   // count + sum
}

// sticky export bar — only when a selection exists. Uses the ALL-FIELDS async path, same as the
// table header's Export CSV button, so both doors emit the identical full-width record.
// `selectionVersion` is the reactive handle on the (deliberately non-reactive) selectionSet —
// see the performance contract in useSelectionBus.js. Touch it or this never updates.
const selCount = computed(() => { bus.selectionVersion?.value; return bus.selectionSet ? bus.selectionSet.size : 0 })
function exportSelection() { exporter.exportCsvAsync() }
function clearSelection() { bus.clearSelection() }
function toggleFacet() { bus.emit('toggleFacet', !facetCollapsed.value) }
function toggleRail()  { bus.emit('toggleRail',  !railCollapsed.value) }
function onBarClick(e) {
  const el = e.target && e.target.closest && e.target.closest('[data-bar-export],[data-bar-clear]')
  if (!el) return
  if (el.hasAttribute('data-bar-export')) exportSelection(); else clearSelection()
}

// The grid spine — injected into the shadow root (scoped <style> is dropped in the
// defineCustomElement build). Verbatim from the original research-dashboard.
useShadowStyles(`
  /* ── DX-LIFE PALETTE TOKENS (card BUILD-DASHBOARD-PALETTE-DRIFT-TOKENIZE) ──
     THE ONE PLACE the dashboard's colours are decided. Every panel must resolve its colour
     through a token below — no raw hex in a component. The drift this fixes: 69 blue-grey
     literals (line/muted/surface/text blue-greys) had accumulated across 8 standalone-
     authored panels, so the dashboard rendered a COOLER palette than the light shell hosting
     it. Nobody chose that; each panel simply invented its own hex.

     Values are the live DX-life site's material-light palette, taken FROM THE SITE rather than
     re-invented here — which is what stops an embedded dashboard reading cooler than the page
     hosting it.
     LIGHT ONLY — there is no dark mode in this product and none may be added.

     ★ SCOPE: this law governs UI CHROME — panels, cards, type, borders, controls; everything
     whose colour comes from a token above. It does NOT govern BASEMAP TILES. The map panel
     renders a dark basemap ('galaxy' — black ground, blue water, set in dashboard.config.js),
     and that is DELIBERATE, not drift: a basemap is imagery the
     data is drawn ON, chosen for choropleth contrast, not a surface the UI is themed with. A
     dark map inside light chrome is the intended composition. Do not "fix" it to match the
     palette, and do not cite it as precedent for darkening any chrome.

     --dx-scroll-thumb is a DELIBERATE neutral, not a sage: it must read between line and muted
     on both white and surface, which a sage tint does not do. It is named, therefore chosen. */
  :host{ display:block; width:100%; height:100%; min-height:560px; box-sizing:border-box;
    --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px;
    --dx-surface:#f3f3f1; --dx-elevated:#ffffff; --dx-text:#3b463d; --dx-muted:#6d766e;
    --dx-line:#d1d4cd; --dx-accent:#92b195; --dx-scroll-thumb:#c4c8c0;
    --dx-accent-weak:rgba(146,177,149,.18); --dx-hover:rgba(59,70,61,.06);
    /* --rd-* are the dashboard's semantic aliases; they RESOLVE to the tokens above so a panel
       written against either name inherits the same palette. */
    --rd-accent:#e67e22; --rd-info:#2b6cb0;
    --rd-line:var(--dx-line); --rd-bg:var(--dx-surface);
    --rd-ink:var(--dx-text); --rd-muted:var(--dx-muted); --rd-panel:var(--dx-elevated);
    --rd-primary:var(--dx-accent);
    /* ── RAIL BALANCE (card BUILD-REBALANCE-THE-TWO-SIDEBARS) ────────────────────────────
       The charts rail used to be 312px against the tree rail's 248px — the CHARTS rail was
       64px WIDER than the tree, so the CHART sidebar looked LARGER than the TREE sidebar.
       That was backwards for the content:
       the tree carries long multi-word labels (bloc/cluster/region names) that must read on
       ONE line, while the charts carry a donut plus a legend that can wrap.
       So the widths SWAP ROLES: the tree takes the wider column, the charts the narrower.
       The pair still sums to 560px, so the centre map cell is unchanged. */
    /* ★ SYMMETRIC SIDEBARS: the charts rail is as wide as the tree rail, which puts the map in the
       exact centre. rail 264 -> 296 = facet width; equal flanks centre the middle column by
       construction. */
    --facet-w:296px; --rail-w:296px;
    /* ── ★ ONE EDGE GUTTER FOR THE WHOLE HEADER STACK ────────────────────────────────────
       (card BUILD-THE-FOUR-HEADERS-ARE-ONE-CENTRED-STACK: one edge padding for every band, so
       everything lines up.)
       MEASURED BEFORE at 1600x900: topbar padding 14px, filters band 14px, KPI strip 16px. The
       KPI band was inset 2px further than the two bands above it, so the stack's left edge was a
       2px staircase rather than a line. Nobody chose that — each band picked its own number
       (.rd-stats reached for the generic --s4 spacing step, the other two were hand-set to 14).
       --rd-edge is now the single source; all three bands resolve it, so they cannot drift again
       and a consumer can retune the whole stack's margin with one value. */
    --rd-edge:14px;
    /* ── ★ STATS-ROW HEIGHT, TOKENIZED (card BUILD-SLIM-THE-THREE-HEADERS) ─────────────────
       Asked 2026-09-23: the three headers can be slimmer — not a
       super tall big picture dashboard, but one visible all at once. The goal is an
       AFFORDANCE (the people-groups grid peeking below the fold), not a size limit, so this is a
       density pass, not a deletion.
       MEASURED at 1440x900: the KPI strip's own content (.kpi — a single baseline row, .n at
       15px/800 beside .l at 10px) is 18px tall, centred via align-items:center inside a grid row
       FIXED at 42px by .rd-shell's grid-template-rows — 24px of that 42 is empty space around an
       18px line, the largest untouched margin of the three header bands (the topbar and filters
       band were both already driven to a specified floor in earlier cards; see their own notes).
       30px keeps 6px of breathing room above and below the 18px content — visibly padded, not
       clipped — and recovers 12px with zero information loss.
       Tokenized (not a bare literal) because 42px is repeated in THREE places that must stay in
       sync — the default row template below, .rd-table-collapsed's, and .rd-narrow's — the same
       failure mode --rd-edge was introduced to prevent for the horizontal gutter. */
    /* ★ HEIGHT RECLAIM 2026-09-23: topbar 52->44, stats 30->26. Both are now VARS so a host can
       tune them without editing three grid-template-rows declarations that must agree. */
    --rd-topbar-h:38px;
    --rd-stats-h:22px;
    --fs-xs:10px; --fs-sm:11px; --fs-md:12px; --fs-lg:13px; --fs-xl:16px;
    --r-lg:10px; --r-md:6px; --r-pill:999px; }
  .profile-loader{ width:100%; height:100%; }
  /* ★ min-height:INHERIT, NOT 560px. The floor exists so a host that gives the element no height at
     all still renders a usable dashboard instead of collapsing to nothing — a real guard, worth
     keeping. But stated as a constant it also applied inside a height-BOUNDED host, where it made this
     grid taller than the pane holding it and handed the gallery's .dms-pane a second scrollbar that
     scrolled the tab strip out of view (doxa-maps-spa.vue, the pinned cssText). Inheriting defers the
     decision to :host, which is the only box that knows: the gallery pins the element with an inline
     min-height:0 and this resolves to 0, so the grid fills the pane exactly; a naive page leaves :host
     at its own 560px and the guard is unchanged. Inheritance crosses the shadow boundary, so this
     reads the host's computed value and needs no attribute or class to switch on. */
  .rd-shell{ position:relative; display:grid; width:100%; height:100%; min-height:inherit; box-sizing:border-box;
    grid-template-columns: var(--facet-w,296px) minmax(0,1fr) var(--rail-w,296px);
    grid-template-rows: var(--rd-topbar-h,38px) auto var(--rd-stats-h,22px) 1fr var(--table-h,34%);
    grid-template-areas: "topbar topbar topbar" "filters filters filters" "stats stats stats" "facets map rail" "facets table rail";
    gap:1px; background:var(--rd-line, #d1d4cd); container-type:inline-size;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    color:var(--rd-ink, #3b463d); }
  .rd-shell > [data-region="topbar"]{ grid-area:topbar; min-width:0; }
  .rd-shell > [data-region="filters"]{ grid-area:filters; min-width:0; }
  .rd-shell > [data-region="stats"]{ grid-area:stats; min-width:0; }
  .rd-shell > [data-region="facets"]{ grid-area:facets; min-width:0; min-height:0; }
  .rd-shell > [data-region="map"]{ grid-area:map; min-width:0; min-height:0; overflow:hidden; position:relative; }
  .rd-shell > [data-region="table"]{ grid-area:table; min-width:0; min-height:0; overflow:hidden; }
  .rd-shell > [data-region="rail"]{ grid-area:rail; min-width:0; min-height:0; }
  .rd-rail{ display:flex; flex-direction:column; min-height:0; height:100%; background:var(--rd-bg, #f3f3f1); }
  .rd-rail > [data-region="charts-rail"]{ flex:1 1 auto; min-height:0; }
  /* Table collapsed → the grid+footer hide but the table HEADER BAR stays docked under the map,
     still showing the live matched count and the Export CSV button (card
     BUILD-CSV-EXPORT-MOVE-TO-TABLE-HEADER-ALL-FIELDS). The row shrinks to the bar's height
     instead of 0, so the map still takes back nearly the whole cell via its 1fr. */
  .rd-shell.rd-table-collapsed{ grid-template-rows:var(--rd-topbar-h,38px) auto var(--rd-stats-h,22px) 1fr var(--table-bar-h,30px); }
  /* Facet/rail collapse — override the COLUMN template (not the --*-w vars) so collapse wins
     over a dragged inline width, exactly like the table row-template above. Map is minmax(0,1fr)
     and self-resizes via DashboardMapPanel's ResizeObserver → map.resize(). */
  .rd-shell.rd-facet-collapsed{ grid-template-columns:0 minmax(0,1fr) var(--rail-w,296px); }
  .rd-shell.rd-rail-collapsed{ grid-template-columns:var(--facet-w,296px) minmax(0,1fr) 0; }
  .rd-shell.rd-facet-collapsed.rd-rail-collapsed{ grid-template-columns:0 minmax(0,1fr) 0; }
  /* Always-reachable edge carets pinned to the map, toggle each rail (desktop only). */
  .rd-edge-caret{ position:absolute; top:50%; transform:translateY(-50%); z-index:6; width:16px;
    height:46px; display:flex; align-items:center; justify-content:center; padding:0; cursor:pointer;
    border:1px solid var(--dx-line,#d1d4cd); background:var(--dx-elevated,#fff); color:var(--dx-text,#3b463d);
    border-radius:5px; font-size:11px;
    line-height:1; box-shadow:0 1px 4px rgba(0,0,0,.14); }
  .rd-edge-caret:hover{ background:var(--dx-hover,rgba(59,70,61,.06)); }
  .rd-edge-facet{ inset-inline-start:5px; } .rd-edge-rail{ inset-inline-end:5px; }
  /* (the floating .rd-table-restore pill is retired — the table's own always-docked header bar
     carries the chevron, the live count and Export CSV while collapsed) */
  /* Medium-width niceties. These keep the SAME rail balance as the defaults above (tree wider
     than charts) — slim-facet used to drop the tree to 196px against a 240px charts rail, which
     re-created the inverted proportion this card fixed, just at a smaller screen size. The tree
     gives up less because it is the rail whose labels must not wrap. */
  .rd-shell.rd-slim-rail{ --rail-w:228px; }
  .rd-shell.rd-slim-facet{ --facet-w:250px; }
  /* Desktop drag-resize handles (useDashboardLayout). Thin, transparent until hover/active; each is
     a grid item pinned to the edge of its cell so no pixel offsets are needed. Straddle the 1px grid
     gap via a small negative margin for a comfortable hit target. Never rendered on narrow/mobile. */
  .rd-rz{ position:relative; z-index:6; background:transparent; touch-action:none; transition:background .15s; }
  .rd-rz::after{ content:''; position:absolute; background:transparent; border-radius:var(--r-pill,999px); transition:background .15s; }
  /* Logical margins: the grid mirrors under dir=rtl (grid-template-columns + justify-self both
     follow the inline direction), so a physical margin-right put the handle's 4px overhang on the
     wrong side of its own column in Arabic. the gospel-internet board already used the logical pair. */
  .rd-rz-facet{ grid-area:facets; justify-self:end; align-self:stretch; width:8px; margin-inline-end:-4px; cursor:col-resize; }
    .rd-rz-rail{ grid-area:rail; justify-self:start; align-self:stretch; width:8px; margin-inline-start:-4px; cursor:col-resize; }
  .rd-rz-table{ grid-area:map; align-self:end; justify-self:stretch; height:8px; margin-bottom:-4px; cursor:row-resize; }
  .rd-rz-facet::after, .rd-rz-rail::after{ top:50%; left:50%; transform:translate(-50%,-50%); width:3px; height:34px; }
  .rd-rz-table::after{ top:50%; left:50%; transform:translate(-50%,-50%); width:34px; height:3px; }
  /* ── SHELL HANDLE (page-scroll mode only) — the boundary between the WHOLE research-dashboard
     element and whatever a host stacks below it (BUG-SHELL-HANDLE-BOUND-TO-WRONG-DIVIDER: this is
     the control that resizes the height of the page, which a previous
     pass mistakenly bound to .rd-rz-table above instead). Positioned OUTSIDE the grid (the shell is
     already position:relative) rather than given a grid-area, because it must span all THREE
     columns (facets + map/table + rail) regardless of their widths, and no single grid-area does
     that without also claiming cells .rd-rz-table already owns. Pinned to the shell's own bottom
     edge — not the table cell's — so it tracks whichever row happens to be last. Grid-mode has no
     concept of "the element's own height" (the shell IS the viewport there), so this handle only
     ever renders in .rd-page-scroll — see the template's v-show. */
  .rd-rz-shell{ position:absolute; left:0; right:0; bottom:0; height:10px; margin-bottom:-5px; cursor:row-resize; }
  .rd-rz-shell::after{ top:50%; left:50%; transform:translate(-50%,-50%); width:48px; height:3px; }
  .rd-rz:hover::after{ background:var(--rd-accent,#e67e22); }
  .rd-rz:active{ background:color-mix(in srgb, var(--rd-accent,#e67e22) 18%, transparent); }
  .rd-rz:active::after{ background:var(--rd-accent,#e67e22); }
  /* Keyboard focus ring (tabindex="0" makes these real operable widgets, not just a mouse
     affordance) — same accent as hover/active so keyboard and mouse read as one visual language. */
  .rd-rz:focus-visible{ outline:2px solid var(--rd-accent,#e67e22); outline-offset:1px; }
  .rd-rz:focus-visible::after{ background:var(--rd-accent,#e67e22); }
  /* ★ BAND 4 OF THE CENTRED STACK — the PROGRESS header (UPGs / scope / population / reach /
     countries / unreached / unadopted). Two changes, both from the one-centred-stack card:
       - padding now resolves --rd-edge instead of --s4, so its gutter matches the topbar and the
         filters band exactly (it was 16 against their 14 — measured).
       - justify-content:safe center, so the KPI tiles read as a centred group like the bands
         above rather than a left-justified run. MEASURED BEFORE: the 6 tiles spanned x=16..852
         inside a 1600px band — i.e. they occupied the left half and left ~750px of white space on
         the right, which is the "justified left" described in the report.
     safe matters here as much as on the filter row: this band is overflow-x:auto, and plain
     centring on an overflowing scroller pushes the first tile to a negative, unreachable offset. */
  .rd-stats{ display:flex; align-items:center; gap:var(--s5,24px); height:100%; padding:0 var(--rd-edge,14px);
    justify-content:center; justify-content:safe center;
    background:var(--rd-panel,#fff); overflow-x:auto; box-sizing:border-box; }
  .rd-stats .kpi{ display:flex; align-items:baseline; gap:6px; white-space:nowrap; }
  .rd-stats .kpi .n{ font-weight:800; font-size:15px; color:var(--rd-ink, #3b463d); transition:color .2s; }
  .rd-stats .kpi .l{ font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:var(--rd-muted, #6d766e); }
  .rd-stats .kpi .d{ color:var(--rd-accent,#e67e22); font-weight:700; font-size:11px; }
  /* ── PAGE-SCROLL MODE — see the pageScroll note in the script block. Opt-in via
     profile-config layout:page-scroll; unset everywhere else, so existing embeds are unchanged.

     Three changes, each undoing one thing that makes this a fixed-viewport app:
       height:auto        — the shell stops being exactly as tall as its host band
       --table-h:auto     — the last grid row sizes to its rows instead of taking 34% of a screen
       map gets a real px height — a 1fr map row with no definite parent height collapses, which
                            is the ORIGINAL defect the 88svh pin was introduced to avoid; giving
                            the map an explicit height keeps it while freeing the table.
     The table's own overflow is released to visible in this mode, which is the actual fix: with
     no internal scrollport under the cursor there is nothing to capture the wheel.

     ★ --rd-shell-h vs --rd-map-h (BUG-SHELL-HANDLE-BOUND-TO-WRONG-DIVIDER). Two INDEPENDENT
     variables, answering two different questions, where there used to be only one:
       --rd-shell-h = the ELEMENT's own total height (map + table combined) — the NEW bottom
                      handle (.rd-rz-shell) is the only thing that writes this.
       --rd-map-h   = the map's SHARE of that total — the existing map/table divider
                      (.rd-rz-table) writes this, redistributing within --rd-shell-h without
                      changing it (useDashboardLayout.js clamps mapH so it can never exceed the
                      shell budget). Every derived measurement below (table budget, facets/rail
                      span) now roots in --rd-shell-h so the total stays the single source of
                      truth and the two handles cannot fight over the same pixels. */
  /* ★ THE SHELL TOTAL NOW DERIVES FROM THE TABLE, NOT THE OTHER WAY ROUND (regression I introduced
     in a693865 and it was caught immediately: "the height of the table is smaller now, but that
     introduced a GAP, a grey spot ... which also broke the ability to resize the table").
     WHAT I BROKE. The design was one budget with two consumers: --rd-shell-h was the total, and the
     table's keyhole was DERIVED as shell - map - bar - foot. Capping the keyhole at 7 rows replaced
     that derivation with an independent constant, so the table stopped answering to the shell. The
     shell kept asserting its old ~720px total while the table gave back 118px, and since nothing
     else consumed the slack it showed up as dead space — the grey spot. The resize handle broke for
     the same reason: it writes --rd-shell-h, which the table no longer reads, so dragging moved a
     number that nothing downstream obeyed.
     THE FIX IS TO RESTORE ONE SOURCE OF TRUTH, but pointing the other way: the TABLE's seven rows
     are now the declared quantity and --rd-shell-h is COMPUTED from it (map + bar + rows + foot).
     Both handles keep working because both still write inputs to that sum: the map/table divider
     writes --rd-map-h, and the shell handle writes --rd-shell-h, which overrides this default.
     ★ The var indirection matters: an explicit --rd-shell-h from the drag still wins, so this is a
     DEFAULT, not a lock. That is what keeps the resize alive rather than pinning the element. */
  /* ★ THE MAP ROW MUST NOT BE 1fr IN PAGE-SCROLL — this is the grey gap, found by measurement.
     The base grid (line 290) sets the map row to 1fr, which is right in FIXED-VIEWPORT: the shell
     has a real bounded height and 1fr means "take what is left". In PAGE-SCROLL the shell is
     height:auto, so there is no fixed total to divide — 1fr instead becomes "stretch to whatever
     the content implies", and the map ELEMENT is separately pinned to --rd-map-h. The row grows,
     the element does not, and the difference paints as dead space between the map and the table.
     MEASURED in a fresh context: shell 849 while its parts sum to 602 — a 117px gap, exactly the
     "grey spot between the height of the map" reported twice.
     Pinning the row to the SAME var the element uses makes row and element one quantity again, so
     the slack cannot exist. Both drags keep working because both write that var (or --rd-shell-h,
     which the table's keyhole below derives from). */
  /* ★ THE GREY GAP BETWEEN MAP AND TABLE = THE 1fr ROW STRETCHING PAST ITS PINNED OCCUPANT.
     The base grid gives the map row 1fr, which is correct in fixed-viewport (a real bounded total
     to divide) and wrong in page-scroll, where the shell is height:auto: 1fr then stretches to
     whatever the content implies while the map ELEMENT stays pinned at --rd-map-h. The row grows,
     the element does not, and the difference paints as dead space above the table — reported by
     three separate times. Pinning the ROW to the same var the ELEMENT uses makes them
     one quantity, so the slack cannot exist; the table row goes auto for the same reason.
     ★ HISTORY, so this does not get reverted on a false signal again: this exact rule was applied
     earlier today and reverted when a probe reported "no shell" — the real cause was a DEAD DEV
     SERVER, not this CSS. Verified this time against a live server with a screenshot. */
  .rd-shell.rd-page-scroll{ height:auto; --table-h:auto;
    grid-template-rows: var(--rd-topbar-h,38px) auto var(--rd-stats-h,22px) var(--rd-map-h,340px) auto; }
  /* ★ COLLAPSE GIVES ITS SPACE TO THE MAP: collapsing the table must collapse DOWN and grow the map.
     It used to collapse UP and leave white space under the collapsed table. The base .rd-table-collapsed template still says 1fr for the
     map row, and 1fr cannot grow in an auto-height shell -- there is no fixed total to divide -- so
     the freed space pooled under the bar as white nothing. In page-scroll the collapsed map takes
     the SAME shell budget the open state uses, minus only the bar: the one-owner derivation again,
     so collapse/expand and both drag handles all move the same quantity instead of fighting.
     Both the ROW and the ELEMENT get the height, for the same reason they share --rd-map-h when
     open: two owners of one height is the bug this file keeps re-learning. */
  .rd-shell.rd-page-scroll.rd-table-collapsed{
    grid-template-rows: var(--rd-topbar-h,38px) auto var(--rd-stats-h,22px)
      calc(var(--rd-shell-h, 562px) - var(--table-bar-h,30px)) var(--table-bar-h,30px); }
  .rd-shell.rd-page-scroll.rd-table-collapsed > [data-region="map"]{
    height:calc(var(--rd-shell-h, 562px) - var(--table-bar-h,30px)); }
  .rd-shell.rd-page-scroll > [data-region="map"]{ height:var(--rd-map-h, 340px); overflow:hidden; }
  .rd-shell.rd-page-scroll > [data-region="table"]{ overflow:visible; }
  .rd-shell.rd-page-scroll .rd-table-wrap{ height:auto; }
  /* ★ THE TABLE KEEPS AN INTERNAL SCROLL, BUT A GENEROUS ONE — and that is the whole fix.
     MEASURED, both extremes are wrong. Pinned to 34% of one screen it is a ~269px keyhole over
     54834px of rows, so it captures every wheel event and the page moves 300px where it should
     move 3000. Released to overflow:visible it renders all 54834px and the grid below lands at
     y=57777 — reachable in principle, useless in practice. Two failures of the same trade.
     A tall bounded panel is neither: 62svh is ~558px at a 900px viewport, roughly double the old
     keyhole, so the table is genuinely usable on its own, while the section stays about one screen
     and the page still scrolls past to the grid. The wheel does get consumed while the cursor is
     inside the table, which is correct and expected for a scrollable panel — the difference is the
     panel is now large enough that a user reads it deliberately rather than falling into it. */
  /* ── ★ CAPPED TO MATCH THE MAP ROW, NOT A ROUND FRACTION OF THE SCREEN (BUG-DASHBOARD-BAND-
     GROWS-ENORMOUS, same card as the facets/rail rule below). The original 62svh cap sized the
     INNER SCROLLPORT only; the table's HEADER BAR (.rd-table-bar, the count + Export CSV strip)
     sits on top of it and is not part of that budget, so the OUTER table CELL was always
     header-bar-height taller than the map row beside it. MEASURED at 1440x900 (prior to the
     40svh default below): bar 32px, grid 558px, cell 590px against a 522px map row — a stair-step
     the "visible on one desktop page" invariant does not allow. calc() derives the
     grid's budget from --rd-map-h MINUS the bar's own rendered height, so the two rows land at
     the SAME total and can never drift apart again the way a second hardcoded svh number could.
     --rd-table-bar-h is a var, not a literal, so DashboardDataTable can correct it if the bar's
     height ever changes without this rule going stale. --rd-table-max-h remains the escape hatch
     for a host wanting a different table budget entirely (it wins over the calc() via the
     var()'s own fallback).
     ★ THE DEFAULT ALSO DROPPED 58svh -> 40svh (this file + useDashboardLayout.js's mapH default,
     kept in lockstep per that file's own comment). MEASURED, matching this composite ONLY: even
     with the header-bar fix above, chrome(137px: topbar 52 + filters 55 + stats 30) + map(522px)
     + table(554px) summed to 1213px against a 900px viewport — internal/check-fits-the-screen.mjs
     clause A FAILs above 900px, and B/C then fail too because a fixed test cursor lands on the
     dashboard's own internal scrollers instead of the open page below it (the band is still
     taller than where the gesture happens). 40svh (~360px at 900px) brings chrome + map(360) +
     table(392) to ~889px, clearing all three clauses with an 11px margin. The resize handle
     (useDashboardLayout's mapH drag) still lets a large-monitor user drag it back up afterward —
     this only changes what a FIRST LOAD shows.
     ★ RE-ROOTED IN --rd-shell-h (BUG-SHELL-HANDLE-BOUND-TO-WRONG-DIVIDER). The table's budget used
     to be map-h minus the bar, which made the map/table divider ALSO the element's total-height
     control (growing the map grew the total, since nothing capped it). Now the table's budget is
     the SHELL's total minus whatever the map is currently taking minus the bar — so dragging the
     map/table divider (which changes --rd-map-h, never --rd-shell-h) redistributes between the two
     rows while their SUM stays exactly --rd-shell-h. Fallback 80svh mirrors useDashboardLayout.js's
     shellH default (720px ≈ 2×40svh at 900px) — the map+table combined budget --rd-map-h alone used
     to imply, so first paint is unchanged.
     ★ ALSO SUBTRACTS --rd-table-foot-h NOW — MEASURED, a real gap this exposed. The table cell has
     THREE stacked children (.rd-table-bar, .rd-grid, .rd-foot — the "Σ" summary row,
     DashboardDataTable.vue's height:28px), but the old formula only ever budgeted for the bar. That
     was invisible before this card: with nothing else depending on map-h + table-cell summing to an
     exact number, the extra 28px just meant the table cell was quietly 28px taller than the map row
     beside it. It became visible the moment facets/rail needed to span EXACTLY map+table (below) —
     without this term they undershot by the footer's height, leaving them 28-30px short of the
     table's real bottom edge, i.e. the sidebar grey-gap bug this card is fixing. --rd-table-foot-h
     is a var (not a literal) for the same reason --rd-table-bar-h is: DashboardDataTable can correct
     it if the footer's height ever changes, without this rule going stale. */
  /* ★ SEVEN DATA ROWS BY DEFAULT, with the arithmetic done explicitly: the table shows SEVEN
     people-group rows at its default height, chrome NOT counted: adding the filter field makes 8 rows'
     height, the footer 9, and the table's header 10. 7 is DATA ROWS.
     ★ STATED IN ROWS, NOT PIXELS, deliberately. The old formula derived the keyhole by subtraction
     (shell - map - bar - foot), so the row count was whatever fell out — MEASURED 300px = 11 rows,
     not 7. Deriving from --rd-table-rows x --rd-table-row-h means the promise is the declaration:
     change the row height and 7 rows stays 7 rows. --rd-table-max-h remains the escape hatch for a
     host that wants an explicit pixel cap.
     GOAL CONTEXT: "we are trying to RECLAIM HEIGHT." 7 rows is 182px against today's 300px keyhole,
     so this alone returns 118px of the ~147px available. */
  .rd-shell.rd-page-scroll .rd-grid{
    max-height:var(--rd-table-max-h, calc(var(--rd-shell-h, 562px) - var(--rd-map-h, 340px) - var(--rd-table-bar-h, 32px) - var(--rd-table-foot-h, 28px))); }
  /* ── FACETS/RAIL COLUMNS BOUNDED IN PAGE-SCROLL MODE (BUG-DASHBOARD-BAND-GROWS-ENORMOUS) ──────
     THE ROOT CAUSE, one level up from the table rule above. .rd-facets/.rd-rail are authored
     height:100%, which is correct in the FIXED-VIEWPORT grid (rows sum to a real, bounded
     height) but resolves to INTRINSIC content height once page-scroll sets --table-h:auto — the
     grid's rows are no longer a fixed sum, so "100%" cascades into "as tall as my content wants".
     MEASURED at 1440x900 with all 5 tree sections open: .fr-body clientHeight === scrollHeight
     === 2117px — its OWN overflow-y:auto never engaged, because it was never actually
     constrained, and the whole .rd-shell measured 2325px. Collapsing sections by default (see
     DashboardFacetRail's open state) hides the symptom on first paint; re-opening even two or
     three trees reproduces the same unbounded growth, because nothing upstream of the scroller
     was ever fixed. This rule is that fix: give the two side columns a real cap so their own
     internal scrollbars do the job they were built for, exactly like the table row above them.
     Reuses --rd-map-h (the same explicit height the map row already pins in this mode) rather
     than inventing a third height variable — the three regions read as one bounded row. This
     selector is scoped to .rd-page-scroll only; the fixed-viewport grid already has a bounded
     row via 1fr/34% and never reaches it. */
  /* ★ CORRECTED 2026-09-23 — THE CAP WAS RIGHT, THE HEIGHT IT CHOSE WAS NOT.
     Capping at --rd-map-h bounded the side columns to the MAP's height, so the rail stopped at the
     map's bottom edge and the table below it sat outside the sidebars entirely. MEASURED at
     1440x900: facets 297..657 (h=360, identical to the map), table 658..1050. The sidebar ended
     where the table began.

     ★ ASKED FOR FOUR TIMES, and each earlier pass adjusted the rail's CONTENTS
     instead of its BOUND: "the sidebars are supposed to pass the bottom of the map down to the
     bottom of the table, so they span the full sides of the map AND the table — you have a map and
     table in the middle surrounded by sidebars."

     The grid already expresses exactly that: grid-template-areas is "facets map rail" /
     "facets table rail", so facets and rail SPAN BOTH ROWS by construction. This one max-height
     was overriding a layout that was already correct — which is why adjusting what the rail
     CONTAINED never fixed it.

     Bounding to the two spanned rows instead of the map row keeps the original intent (a real cap,
     so .fr-body's own overflow-y:auto finally engages rather than the column growing without
     limit — the 2117px unbounded case below) while restoring the span. The rail's scrollbar now
     appears when its content exceeds map+table, not when it exceeds the map alone.

     ★ CORRECTED AGAIN, SAME DAY — "let the grid do the bounding" measured FALSE. min-height:0 +
     overflow:hidden with NO max-height reintroduced the original bug in a new shape: MEASURED with
     4 of 5 trees open by default (the correction, see DashboardFacetRail's
     OPEN_BY_DEFAULT), the map ROW TRACK itself grew to 1627px (gridTemplateRows became
     "52px 55px 30px 1627px 390px") and the whole band hit 2159px. Root cause: the map/table ROW
     TRACKS are 1fr/auto (line 275, --table-h:auto in this mode) — flexible tracks that size to
     their TALLEST occupant. --rd-map-h is set on the [data-region="map"] CHILD's own height, not on
     the grid track, so it bounds the map element without bounding the TRACK; a spanning sidebar with
     no cap of its own is exactly the kind of taller occupant that stretches a flexible track. CSS
     Grid does not intrinsically bound a spanning item to what its co-occupants explicitly request —
     only to what the TRACK resolves to, and an unbounded occupant is part of that resolution.
     So the cap has to live on facets/rail after all, computed as map + table (both budgets this file
     already owns) rather than map alone — that is what actually matches "span the map AND the
     table". +1px absorbs the 1px grid gap between the two rows this element spans.
     ★ THE ORIGINAL VERSION OF THIS COMMENT CLAIMED reusing --rd-table-max-h here "keeps the two in
     lockstep by construction" — THAT WAS AN ASSERTION, NOT A MEASUREMENT, AND IT WAS FALSE.
     MEASURED (BUG-SHELL-HANDLE-BOUND-TO-WRONG-DIVIDER, sampled once per second for 16s on the
     built dashboard-plus-grid composite, not a single post-load snapshot — a single snapshot had
     already missed this same defect twice): facets/rail sat a STABLE -62px above table.bottom on
     every sample. --rd-table-max-h (line 434) caps the table's INNER scrollport only (.rd-grid);
     the table's OUTER cell is that plus its header bar AND its "Σ" summary footer — two elements
     this formula never accounted for — so "the two budgets already owned" were never actually the
     same number. The two were never in lockstep; nothing here recomputed either at runtime, so the
     old -62px was permanent on every load, not a timing artifact.
     ★ THE FIX: re-root BOTH this rule and the table rule (line 434) in ONE shared variable,
     --rd-shell-h, instead of deriving the sidebar span from a second, independently-drifting
     estimate. map-h + table-cell(bar + grid-max-h + foot) now sums to EXACTLY --rd-shell-h BY
     CONSTRUCTION (table-max-h at line 434 is defined as shell-h - map-h - bar-h - foot-h, so
     bar-h + foot-h + table-max-h = shell-h - map-h, and adding map-h back cancels it algebraically
     — not just on this data set, for any value of any of the four terms). This also means the
     sidebars automatically track the NEW shell handle (.rd-rz-shell) the same tick it moves, with
     no separate wiring. RE-VERIFIED after this fix: -2px (grid-gap/border rounding) on every one of
     17 samples across 16s, and check:fits-screen clause A (force-expand every facet section) still
     shows growth=0px against its 24px tolerance — the cap still stops the flexible map/table row
     TRACKS from stretching to an uncapped sidebar's content height (CSS Grid does not intrinsically
     bound a spanning item to its co-occupants — see the CORRECTED AGAIN note above); only the
     NUMBER the cap computes was wrong, not the need for a cap at all. */
  .rd-shell.rd-page-scroll > [data-region="facets"],
  .rd-shell.rd-page-scroll > [data-region="rail"]{ min-height:0; overflow:hidden;
    /* ★ FALLBACK UNIFIED AT 502px (was 80svh = 720px). Two rules read --rd-shell-h and their
       FALLBACKS disagreed: the table keyhole fell back to 502px (seven rows) while this cap fell
       back to 720px. Nothing sets the var at rest, so the sidebars believed the shell was 119px
       taller than the table did -- the spanning columns stretched the auto table row to fit, and
       the surplus painted as the grey band reported between/under map and table, and
       made a divider drag look broken (the row would not follow, the slack just moved).
       ONE QUANTITY, ONE OWNER applies to fallbacks too: same var, same fallback, everywhere. */
    max-height:calc(var(--rd-shell-h, 562px) + 1px); }

  /* ★ THE ELEMENT MUST SIZE TO ITS CONTENT IN PAGE-SCROLL. The symptom: a large grey gap between the
     map and the table, with the map overflowing into the people-group grid, so the dashboard did not
     read as one element above the grid.
     MEASURED in the cap-5 shell at 1440x900: INSIDE the dashboard everything was tight (map bottom
     536, table top 537, gap 1px, table flush with .rd-shell at 899) while the HOST element measured
     3510px tall — 2611px of empty element below the content. That empty tail is the grey gap, and
     it is what pushes the people-groups grid down and makes the two elements look like they
     overlap rather than stack.
     CAUSE: :host carries height:100%, which is right in the FIXED-VIEWPORT host (the pane gives it
     a real bounded height to fill) but wrong in page-scroll, where the ancestor is a tall scroller
     and 100% of it is thousands of px. The shell inside already switched to height:auto for exactly
     this reason (line 361); the HOST never did, so the element kept claiming the scroller's height
     no matter how short its content was.
     A host cannot see its own .rd-page-scroll class (that lives on a descendant), so the switch is
     keyed on the same pageScroll flag via a host attribute the template sets. height:auto + the
     min-height dropped: in page-scroll the content IS the height.

     ★ SCOPE, HONESTLY: this is NOT reachable from dashboard-plus-grid, which imports this file as a
     plain Vue COMPONENT (dashboard-plus-grid.vue:19) rather than mounting <research-dashboard> as a
     custom element -- there is no shadow host for :host to match there, and MEASURED, that composite
     stacks correctly anyway (dashboard section 0..864, grid section 864..3031, gap 0). The rule
     applies where research-dashboard IS mounted as its own element, which includes the studio's new
     per-composite folders. Kept because the reasoning holds and the cost is one attribute; labelled
     UNPROVEN because no host has yet been measured before-and-after through this path. */
  :host([data-page-scroll="true"]){ height:auto; min-height:0; }

  .rd-shell.rd-narrow{ grid-template-columns:1fr; grid-template-rows:var(--rd-topbar-h,38px) auto var(--rd-stats-h,22px) minmax(0,1fr) 46px;
    grid-template-areas:"topbar" "filters" "stats" "body" "seg"; }
  .rd-shell.rd-narrow > [data-region]{ grid-area:body; min-width:0; min-height:0; }
  .rd-shell.rd-narrow > [data-region="topbar"]{ grid-area:topbar; }
  .rd-shell.rd-narrow > [data-region="filters"]{ grid-area:filters; }
  .rd-shell.rd-narrow > [data-region="stats"]{ grid-area:stats; }
  .rd-seg{ grid-area:seg; display:none; }
  .rd-shell.rd-narrow .rd-seg{ display:flex; }
  .rd-seg button{ flex:1; border:0; background:var(--dx-elevated,#fff); border-top:1px solid var(--rd-line,#d1d4cd); font-size:12px; font-weight:700; color:var(--dx-muted,#6d766e); cursor:pointer; }
  .rd-seg button.on{ color:var(--rd-ink, #3b463d); box-shadow:inset 0 -3px 0 var(--rd-accent,#e67e22); }
  /* VISUALLY HIDDEN, NOT display:none. display:none (and visibility:hidden, and width/height:0 with
     overflow visible) removes the node from the ACCESSIBILITY tree too, which would silence the one
     region that exists to be heard. The clip-path + 1px box is the standard visually-hidden recipe:
     the node keeps a real box, stays in the a11y tree, and paints nothing. white-space:nowrap stops
     a long sentence from forcing a scrollbar on the shell while it is clipped. */
  .rd-sr-live{ position:absolute; width:1px; height:1px; margin:-1px; padding:0; border:0;
    overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
  .rd-exportbar{ position:absolute; left:0; right:0; bottom:0; display:flex; align-items:center; gap:10px; padding:8px 14px;
    background:var(--rd-ink, #3b463d); color:#fff; z-index:50; box-shadow:0 -2px 10px #0003; animation:rd-slideup .2s ease; }
  .rd-exportbar .sp{ flex:1; } .rd-exportbar b{ font-size:13px; }
  .rd-exportbar button{ border:0; border-radius:6px; padding:6px 14px; font-weight:700; font-size:12px; cursor:pointer; }
  .rd-exportbar .x-go{ background:var(--rd-accent,#e67e22); color:#fff; } .rd-exportbar .x-clr{ background:#ffffff22; color:#fff; }
  @keyframes rd-slideup{ from{ transform:translateY(100%); } to{ transform:translateY(0); } }
  @media (prefers-reduced-motion: reduce){ .rd-shell *{ transition:none !important; animation:none !important; } }
  /* A11Y / PHOTOSENSITIVITY (BUG-RESIZE-STROBE): while a divider is being dragged the grid tracks
     change every frame. Any transition on a descendant would be restarted every frame and never
     reach its end state, which reads as flicker. useDashboardLayout sets data-rd-resizing for the
     duration of the drag; kill all motion underneath it and re-enable on drag end. */
  .rd-shell[data-rd-resizing] *{ transition:none !important; animation:none !important; }
  /* Dragging over the map/table would otherwise start a text selection and repaint the selection
     highlight each frame — another flashing source. */
  .rd-shell[data-rd-resizing]{ user-select:none; -webkit-user-select:none; cursor:inherit; }

  /* ── Thin overlay scrollbars (BUILD-MATERIAL-THIN-OVERLAY-SCROLLBARS) ──
     Material-light palette. Transparent track so the bar sits flush to the panel edge and costs
     no visual space; low-contrast thumb that darkens on hover. Applied to every scroll region in
     the shell so the rails, table and charts all match. */
  .rd-shell, .rd-shell *{ scrollbar-width:thin; scrollbar-color:var(--dx-scroll-thumb, #c4c8c0) transparent; }
  .rd-shell ::-webkit-scrollbar{ width:8px; height:8px; }
  .rd-shell ::-webkit-scrollbar-track{ background:transparent; }
  .rd-shell ::-webkit-scrollbar-thumb{ background:var(--dx-scroll-thumb, #c4c8c0); border-radius:8px; }
  .rd-shell ::-webkit-scrollbar-thumb:hover{ background:#9aa197; }
  .rd-shell ::-webkit-scrollbar-corner{ background:transparent; }
`, 'rd-shell-layout')

// ★ MIRROR pageScroll ONTO THE HOST ELEMENT (BUG-DASHBOARD-ELEMENT-CLAIMS-SCROLLER-HEIGHT).
// :host carries height:100%, which the fixed-viewport host needs and the page-scroll host must
// NOT have — in a tall scroller, 100% is thousands of px, so the element kept a 2611px empty tail
// below its own content (MEASURED in the cap-5 shell: content ended at 899, host measured 3510).
// A host cannot be selected by a class on its own descendant, so the flag is reflected outward as
// an attribute and the :host([data-page-scroll="true"]) rule above switches to height:auto.
// Reflected rather than passed as a prop because pageScroll is already derived inside this
// component; a second prop would be a second source of truth that can disagree with the first.
onMounted(() => {
  const host = shell.value && shell.value.getRootNode && shell.value.getRootNode().host
  if (!host) return
  const sync = (on) => host.setAttribute('data-page-scroll', on ? 'true' : 'false')
  sync(unref(pageScroll))
  watch(() => unref(pageScroll), sync)
})
</script>

<template>
  <div ref="shell" class="rd-shell"
       :class="{ 'rd-narrow': isNarrow, 'rd-slim-rail': slimRail, 'rd-slim-facet': slimFacet, 'rd-table-collapsed': tableCollapsed, 'rd-facet-collapsed': facetCollapsed, 'rd-rail-collapsed': railCollapsed, 'rd-page-scroll': pageScroll }"
       :data-row-count="rowCount" :data-loading="isLoading ? '1' : '0'" :data-error="loadError || ''" :data-narrow="isNarrow ? '1' : '0'">
    <DashboardTopBar />
    <DashboardResearchFilters />
    <div class="rd-stats" data-region="stats" data-sub="stat-strip">
      <div class="kpi" v-for="k in kpis" :key="k.id">
        <span class="n" :data-kpi="k.id">{{ k.kind === 'count' && isLoading ? '…' : kpiText(k) }}</span>
        <span class="l">{{ k.label }}</span>
        <span v-if="k.delta" class="d" data-kpi-delta>↓{{ fmt(k.delta) }}</span>
      </div>
    </div>
    <DashboardFacetRail v-show="showFacets" />
    <div class="rd-cell-map" data-region="map" v-show="showMap">
      <DashboardMapPanel />
<!-- (the floating "▴ Show table" restore button is gone: the table's own header bar — with its
           chevron, live count and Export CSV — now stays docked under the map while collapsed) -->
      <button v-if="!isNarrow" class="rd-edge-caret rd-edge-facet" type="button" data-toggle-facet
              :title="facetCollapsed ? T('dashboard.show_filters', 'Show filters') : T('dashboard.hide_filters', 'Hide filters — grow the map')"
              @click="toggleFacet">{{ facetCollapsed ? '▸' : '◂' }}</button>
      <button v-if="!isNarrow" class="rd-edge-caret rd-edge-rail" type="button" data-toggle-rail
              :title="railCollapsed ? T('dashboard.show_charts', 'Show charts') : T('dashboard.hide_charts', 'Hide charts — grow the map')"
              @click="toggleRail">{{ railCollapsed ? '◂' : '▸' }}</button>
    </div>
    <!-- The table CELL stays mounted+visible when collapsed; DashboardDataTable hides only its own
         grid+footer and keeps its header bar (count + Export CSV) docked below the map. -->
    <div class="rd-cell-table" data-region="table" v-show="showTable"><DashboardDataTable /></div>
    <aside class="rd-rail" data-region="rail" v-show="showCharts">
      <DashboardDetailDrawer />
      <DashboardChartsRail />
    </aside>
    <!-- Desktop drag-resize handles — never on narrow/mobile; the map/table divider also hides
         while the table is collapsed (nothing to resize). @pointerdown starts the drag.
         ★ KEYBOARD A11Y: `title` is a TOOLTIP, not an accessible name (this repo's own
         check:a11y-button-names comment says so), and a role="separator" with no tabindex is not
         focusable — so none of these three were keyboard-operable. tabindex="0" + aria-label +
         @keydown (Arrow keys step, Home/End jump to the clamp extremes) makes each one a real
         operable widget; aria-valuenow/min/max report the LIVE ref the pointer-drag path already
         owns, so the two input methods can never disagree about the current value. -->
    <div v-show="!isNarrow && !facetCollapsed" class="rd-rz rd-rz-facet" data-resize="facet"
         role="separator" aria-orientation="vertical" tabindex="0"
         :title="T('aria.resizeFiltersRailHint', 'Drag or use arrow keys to resize the filters rail')" :aria-label="T('aria.resizeFiltersRail', 'Resize filters rail')"
         :aria-valuenow="facetW" aria-valuemin="160" aria-valuemax="420"
         @pointerdown="startFacetResize" @keydown="onResizeKeydown('facet', $event)"></div>
    <div v-show="!isNarrow && !railCollapsed" class="rd-rz rd-rz-rail" data-resize="rail"
         role="separator" aria-orientation="vertical" tabindex="0"
         :title="T('aria.resizeChartsRailHint', 'Drag or use arrow keys to resize the charts rail')" :aria-label="T('aria.resizeChartsRail', 'Resize charts rail')"
         :aria-valuenow="railW" aria-valuemin="200" aria-valuemax="520"
         @pointerdown="startRailResize" @keydown="onResizeKeydown('rail', $event)"></div>
    <!-- ★ FIXED (BUG-SHELL-HANDLE-BOUND-TO-WRONG-DIVIDER): this handle is the MAP/TABLE SPLIT
         ONLY, in both modes — it must never change the element's overall height, which is now the
         NEW .rd-rz-shell handle's job below. In page-scroll mode it still drives --rd-map-h (the
         map's SHARE of --rd-shell-h, not the total — see the CSS note above .rd-shell.rd-page-scroll),
         because --table-h is force-set to `auto` and no longer drives any layout — see the
         PAGE-SCROLL AXIS SWITCH note in useDashboardLayout.js.
         ★ THE ONE HANDLE WHOSE NAME NEVER REACHED THE CATALOGUE. Its four siblings above and
         below read their title and aria-label through T(); these two were RAW ENGLISH literals,
         so this separator announced itself in English in all 11 locales while the handles on
         either side of it translated. It survived review because each half looks correct in
         isolation — the ternary is right, the strings are right, and only the MISSING T( is
         wrong. Two keys per handle, the same shape as the siblings: the *Hint is the tooltip,
         the plain key is the accessible name. -->
    <div v-show="!isNarrow && !tableCollapsed" class="rd-rz rd-rz-table" data-resize="table"
         role="separator" aria-orientation="horizontal" tabindex="0"
         :title="pageScroll ? T('aria.resizeMapTableSplitHint', 'Drag or use arrow keys to resize the map/table split') : T('aria.resizeTableHint', 'Drag or use arrow keys to resize the table')"
         :aria-label="pageScroll ? T('aria.resizeMapTableSplit', 'Resize map/table split') : T('aria.resizeTable', 'Resize table height')"
         :aria-valuenow="pageScroll ? mapH : (parseFloat(tableH) || 34)"
         :aria-valuemin="pageScroll ? 220 : 12" :aria-valuemax="pageScroll ? 1400 : 70"
         @pointerdown="startTableResize" @keydown="onResizeKeydown('table', $event)"></div>
    <!-- ★ THE NEW HANDLE (BUG-SHELL-HANDLE-BOUND-TO-WRONG-DIVIDER) — a bar at the SHELL's own
         bottom edge, spanning all three columns, on the boundary between the whole
         research-dashboard element and whatever a host stacks below it (e.g. the people-groups
         grid in dashboard-plus-grid.vue). This is what actually answers "resize the height of the
         page": it is the ONLY handle that writes --rd-shell-h. Page-scroll only — grid-mode has no
         concept of the element's own height (the shell IS the viewport there, sized by its host
         band), so there is nothing for this handle to do outside page-scroll. -->
    <div v-show="!isNarrow && pageScroll" class="rd-rz rd-rz-shell" data-resize="shell"
         role="separator" aria-orientation="horizontal" tabindex="0"
         :title="T('aria.resizeDashboardHeightHint', `Drag or use arrow keys to resize the dashboard's height`)"
         :aria-label="T('aria.resizeDashboardHeight', 'Resize dashboard height')"
         :aria-valuenow="shellH" aria-valuemin="400" aria-valuemax="2600"
         @pointerdown="startShellResize" @keydown="onResizeKeydown('shell', $event)"></div>
    <!-- ★ THE POLITE LIVE REGION (see the announce() block in the script). ALWAYS RENDERED and
         starting EMPTY — no v-if, no v-show, never inside a collapsible cell: a live region that
         is inserted already carrying its message is routinely not announced, because the
         accessibility tree has to be watching the node when the text changes. It is visually
         hidden rather than display:none, because display:none removes it from the accessibility
         tree as well and would silence it for the very users it exists for. -->
    <div class="rd-sr-live" data-live-region role="status" aria-live="polite" aria-atomic="true">{{ liveMessage }}</div>
    <div class="rd-seg" data-segmented @click="setView">
      <button v-for="s in SEG" :key="s.k" :class="{ on: mobileView === s.k }" data-view-btn :data-view="s.k">{{ s.l }}</button>
    </div>
    <div v-if="selCount" class="rd-exportbar" data-export-bar @click="onBarClick">
      <b>{{ selCount }} {{ T('dashboard.selected', 'Selected') }}</b><span class="sp"></span>
      <button class="x-clr" data-bar-clear>{{ T('controls.clear', 'Clear') }}</button>
      <!-- The glyph stays a glyph and the words come from the catalogue — one spelling of this
           action across the dashboard, not two. -->
      <button class="x-go" data-bar-export>{{ T('dashboard.export_csv', 'Export CSV') }} ↓</button>
    </div>
  </div>
</template>
