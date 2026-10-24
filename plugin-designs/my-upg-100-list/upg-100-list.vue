<script setup>
/**
 * upg-100-list.vue — my-upg-100-list · slice 04t THE 26-ZONE POLYGON TAPESTRY
 *
 * @description A personal unreached-people-groups list painted as true boundary polygons —
 *   all 26 affinity zones drawn at once from a single Mapbox fill source, with the shared
 *   nested semantic tree legend driving the colours. The map half of the my-upg-100-list
 *   bundle, whose companion profile is the printable poster wall.
 *
 * Upgrade of slice 04b (which colored PINS) → true BOUNDARY polygons:
 *   - consumes the forge-shared <SemanticTreeLegend> (v2, nested 26-row tree) —
 *     does NOT rebuild a legend (§1a / S04t-D4)
 *   - paints ALL 26 zones at once via ONE Mapbox fill source + a single
 *     ['match', ['get','zoneKey'], …] expression (§1d, heap-safe)
 *       · regional (13) + deaf (1) → ADM0 country polygons (data/adm0/world-adm0.geojson)
 *       · asia (12) → ADM1 state-cluster polygons (gb-IND-ADM1 / gb-CHN-ADM1)
 *   - row-click ISOLATES one zone (hide other 25, fly to bounds), re-click restores
 *     the full tapestry (§1e / S04t-D5) — polygon form of slice 05.
 *
 * Heap safety (Vue+Mapbox budget): geojson held markRaw/shallowRef, ADM0/ADM1
 * data lazy-import()-ed, ONE source + match paint (not 26 layers), theme toggle
 * via a single setStyle(style,{diff:false}).
 */
import { inject, provide, ref, shallowRef, markRaw, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
// The page's people-group LIST (library/lists/): every people-group fetch below keeps only its groups.
// resolvePeopleGroupList/listInfo/LIST_DEFAULT are for the PACKET'S FUNNEL page, which must state the
// total of the list the packet was actually drawn from — see packetFunnel().
import {
  applyPeopleGroupList, resolvePeopleGroupList, listInfo, LIST_DEFAULT,
} from '@map/lists/peopleGroupList.js'
import { retryableAsyncComponent } from '@map/composables/retryableAsyncComponent.js'
import SemanticTreeLegend from '@map/components/legends/SemanticTreeLegend.vue'
// The shared mobile bottom-sheet. Fed this profile's own tree through the `nodes`
// override so the mobile legend is the SAME component every other map uses.
import LegendMobile from '@map/components/legends/LegendMobile.vue'
// 09b-9 legend-light-mode: the shared SemanticTreeLegend is ALREADY theme-aware —
// it renders :data-theme="instance?.theme.value || 'dark'" and ships a complete
// [data-theme="light"] stylesheet (SemanticTreeLegend.vue:488-692). It stayed dark
// here only because THIS profile never created/provided a pplrInstance, so
// useInstance() returned null and the legend fell back to 'dark'. We create + provide
// an instance and drive instance.theme from isDark — the SAME mechanism research-map
// uses (the QA cited research-map.vue:159,570). Zero blast radius: the shared
// component is untouched; the other 2 apps that don't provide an instance still get
// the 'dark' fallback unchanged. (Chosen over the QA's app-scoped useShadowStyles
// override per QA §1c "try scoped-CSS first; report which" — using the component's
// own built-in light theme avoids duplicating ~60 CSS rules that would drift.)
import { createPplrInstance, provideInstance } from '@map/composables/usePplrInstance.js'
// slice 13 §1a: pin-click → detail side panel. CONSUME the shared
// PeopleGroupDetail (never edit src/). Lazy so its ~115 KB only loads on the
// first pin click — exactly the research-map pattern (research-map.vue:193).
// retryableAsyncComponent, NOT raw defineAsyncComponent: Vue CACHES a rejected
// loader promise, so one dropped chunk request would kill the panel for the
// life of the page (card BUG-LAZY-PLUGIN-DEATH-ON-A-SINGLE-FAILED-IMPORT).
// The component reads inject('uiStore') (provided by
// ProfileLoader) + useI18n() (installed by this bundle's index.js), and drives
// its OWN visibility/close via uiStore.selectPeopleGroup(feature|null) — it has
// NO @close emit, so we gate the panel on uiStore.selectedPeopleGroup and let
// its built-in close button clear the store.
const PeopleGroupDetail = retryableAsyncComponent(() => import('@map/components/PeopleGroupDetail.vue'))
// Shared map-control components (CONSUME — never edit src/). Same set + ordering
// the research-map mounts (research-map.vue:1838-1845). MapToolbar is the slot
// wrapper that self-positions top-right; the buttons are its children.
import MapToolbar        from '@map/components/map-controls/MapToolbar.vue'
// The shared base button — the batch/select control uses this instead of a
// hand-rolled <button>, so it is the same size and shape as every other control.
import MapControlButton  from '@map/components/map-controls/MapControlButton.vue'
import ZoomInButton      from '@map/components/map-controls/ZoomInButton.vue'
import ZoomOutButton     from '@map/components/map-controls/ZoomOutButton.vue'
import LocationButton    from '@map/components/map-controls/LocationButton.vue'
import FullscreenButton  from '@map/components/map-controls/FullscreenButton.vue'
import ThemeToggleButton from '@map/components/map-controls/ThemeToggleButton.vue'
// 09b-search-reuse-geocoder §1(b): CONSUME the shared geocoder search UI the
// research-map already mounts (top-left, ABOVE the legend, mobile-friendly,
// wraps mapbox-gl-geocoder). It builds its OWN localGeocoder from
// inject('dataStore') via useGeoSearch — it has NO localGeocoder prop — so we
// feed it by populating dataStore.sources (cacheSourceData) with a unified PG +
// zone + territory record list (data/search-index.js → buildGeocoderFeed). The
// component emits `people-group-result`; the profile branches on the synthetic
// `__upgKind` to route PG→detail / zone→fitBounds / territory→fitBounds. Never
// edits src/ (zero blast radius — md5 unchanged). (research-map.vue:141,1815.)
import GeocoderComponent from '@map/components/map-controls/GeocoderComponent.vue'
import { resolveMapProvider } from '@map/composables/useMapProvider.js'
import { ensureEngineScript, engineGlobal, ensureEngineCSS, engineStylesheetUrl } from '@map/composables/useMapInstance.js'
// Shapes Arabic / Persian / Hebrew BASEMAP labels. A raw map inherits nothing from the bundle
// entry, so this profile has to install it itself — see the call site below for why the entry's
// registration only ever worked by accident.
import { installRtlTextPlugin } from '@map/maps/rtl-text.js'
import { resolveNamedStyle } from '@map/styles/registry.js'
// ★ NO DIRECT clusters.json IMPORT ANY MORE — every zone read goes through listZones() so the legend, the
// list, the selectors and the packet all see the SAME zones for whatever list is showing. The named-import
// tree-shaking this line used to protect now lives in zones-for-list.js, which keeps a static named import
// for exactly that reason.
// ⚠ FOUR SITES READ THE ZONES, not one. allLists()'s own note promised the `list` swap would be "a one-line
// change instead of an audit"; it was four, found by grepping the IDENTIFIER rather than trusting the note:
// allLists, bootstrapLegend (which also attaches selectors), and two legend rebuilds that pass the whole
// object so a `clusters.` grep misses them. Recorded so the next reader greps too.
import { zonesForList } from './data/zones-for-list.js'
import { normalizeRecords, extractRecords } from './data/normalize.js'
import { evaluate as evaluateSelector } from './data/selector-evaluator.js'
import { makeZoneSheet } from './data/zone-sheet-print.js'
import { createPeopleGroupRecords, PRINT_FIELDS } from '@map/lists/peopleGroupRecords.js'
import { useI18n } from 'vue-i18n'
// The in-place print helper: a hidden same-page iframe, NOT window.open(). A popup
// is blockable and drops the user out of the map; the iframe opens the print dialog
// right here. Shared so the packet, the poster and the card deck all print the same way.
import { usePosterPrints } from '@map/composables/usePosterPrints.js'
import { buildLegendNodes, leafZones, zonesWithSelectors, DEAF_SELECTOR, REGION_KEY } from './data/legend-tree.js'
// Legend rows named in the reader's language: tier-A zones by their country (zone-title.js), the Deaf
// row by its bloc name. Both modules are already in this bundle for the packet's localizedZone().
import { zoneTitle, countryLabelIndex } from './data/zone-title.js'
import { countryName } from '@map/utils/countryName.js'
// Errors a reader sees carry their catalogue key; errorText() shows them in the reader's language.
// Strings only this map shows live in their own area, upgMap.json, so no other bundle carries them.
import { keyedError, errorText } from '@map/i18n/keyedError.js'
// A list of names joined the reader's way ('A, B and C' / 'A、B和C' / 'A و B'), not with a hardcoded ', '.
// The locale is passed from the i18n ref (packetLang), so the HUD's list re-renders on a language switch.
import { formatList } from '@map/i18n/index.js'
// The packet's text table, served and integrity-pinned rather than bundled (library/packet/packetStrings.js).
import { loadPacketStrings } from '@map/packet/packetStrings.js'
import { resolveAllZones } from './data/zone-geometry.js'
// slice 09b-9 §3 (L18/L29 FIX): the per-zone color OVERRIDE map. zone-colors.json
// holds the region-inherited tapestry (purple ME, red Africa, green
// Europe, orange Oceania, yellow LatAm, deaf #18ffff). colorForZone(zoneKey,
// leafColorFallback) lets the IDLE tapestry-fill paint that strategy WITHOUT a
// click — override wins, else the deterministic leafColor() rainbow fallback.
import { colorForZone } from './data/zone-colors.js'
// 09b shift-select tool §1(b): name→count resolver. Pure data + pure fns; the
// clicked tapestry feature carries shapeName (ADM1) OR iso3 (ADM0) and this maps
// either to { key, name, count } from admin-counts/membership (NEVER edits them).
import { resolveTerritory, buildCountryNameMap, formatClipboard, ADM1_COUNTS, ISO3_NAME } from './data/territory-counts.js'
import { selectionCsv, selectionClipboard, selectionCsvFileName, regroupable, settleWithin, asReaderError, selectionTitleNames, overPhoneCeiling } from './data/selection-export.js'
import { isPhonePrint } from '@map/composables/printInPlace.js'
import visionFunnel from '../../data/people-groups/vision-funnel.json'
import { upgTotal, countInSentence } from './data/upg-total.js'
// 09b-search-bar §1(a-c): unified search index (PG + zone + territory) + the
// tokenized contains matcher. Pure data + pure fns; this profile builds the rows
// from the live records (PG), the legend leafZones (zone), and admin-counts +
// ISO3 names (territory), then matches per keystroke. No shared-src edit — the PG
// search consumes the SAME live records useGeoSearch would; we extend the result
// set to zones + territories per the QA (a unified {label,kind,target} list).
// 09b-search-reuse-geocoder §1(b): buildGeocoderFeed unifies PG + zone +
// territory into the record list the SHARED GeocoderComponent's useGeoSearch
// indexes. (matchSearch/buildSearchIndex retained for the headless gate handle.)
import { buildSearchIndex, buildGeocoderFeed, matchSearch } from './data/search-index.js'

const mapboxToken   = inject('mapboxToken', ref(''))
const profileConfig = inject('profileConfig', ref(null))

// ★ THE KEY FOR THE PER-INSTANCE TEST HANDLES (AUDIT34 card 9). The bare window.__UPG_MAP__ /
// __UPG_SELECT__ are last-writer-wins: two copies of this map on one page and the second mount
// overwrites the first, so a gate driving "the" map drives whichever mounted last.
// The embedder's own instanceId when it set one — the same field poster-wall.vue:55 keys on —
// falling back to the profile name.
// ⚠ TWO COPIES WITH NO instanceId AND THE SAME PROFILE STILL COLLIDE. That is the honest limit of
// what the embed contract gives us: nothing in it distinguishes them. Stated rather than papered
// over with a counter, because a key that changes between mounts would be worse than one that
// repeats — a gate could not name the instance it wants.
// A function, not a computed: it is read twice inside the map-ready path, never rendered.
// The exact objects THIS instance put on window, so teardown can identity-check before deleting a
// shared named slot — the last mount wins that slot, so a blind delete would strip a live sibling's
// handle. Captured at assignment rather than rebuilt, so they cannot drift from what was published.
let _mySearchHandle = null, _myMapHandle = null, _mySelectHandle = null

function testHandleKey() {
  return profileConfig.value?.instanceId || profileConfig.value?.profile || 'upg-100-list'
}

// ── THIS PROFILE BUILDS ITS MAP RAW, SO IT HAS TO HONOUR THE SWITCH ITSELF ───
// Every other map bundle reaches the provider switch for free because useMapInstance resolves it.
// This one calls `new gl.Map` directly (see onMounted), so it was the ONE map the switch could not
// move: MEASURED at ?provider=maplibre it still loaded Mapbox and made 19 requests to
// api.mapbox.com while five sibling leaves swapped cleanly.
// The engine loader is IMPORTED from useMapInstance rather than re-declared here — a second copy of
// the ENGINES table in a profile is how two copies of one fact drift apart.
const upgProvider  = resolveMapProvider(profileConfig)
const isMaplibre   = upgProvider === 'maplibre'
// The geocoder is deferred to Mapbox by decision (2026-09-24): GeocoderComponent's maplibre
// path still calls makeMapboxForwardGeocode(accessToken), so the SEARCH REQUEST goes to Mapbox
// whichever engine draws the tiles — a keyless map with a search bar is not keyless.
const hasGeocoder  = computed(() => {
  if (profileConfig?.value?.search === false) return false
  return upgProvider === 'mapbox'
})

// EDGE SCROLL AFFORDANCE — the gray accessibility side bars that tell you the page
// scrolls PAST the map. Feature-flagged per embed, because it is a promise: a map
// with nothing beneath it must not advertise a scroll escape that goes nowhere.
// Host override: <my-upg-100-list-map edge-scroll-affordance="false">, or
// config.edgeScrollAffordance. Defaults TRUE here because this profile is the first
// to get a pane column (map on top, poster wall below).
const EDGE_SCROLL_AFFORDANCE = computed(() => {
  const v = profileConfig.value?.edgeScrollAffordance
  return v === undefined || v === null ? true : !(v === false || v === 'false')
})
// 09b-search-reuse-geocoder §1(b): the Pinia dataStore ProfileLoader provides
// (ProfileLoader.vue:103). The SHARED GeocoderComponent injects this same store
// and reads dataStore.sources[*].features through useGeoSearch. We push our
// unified feed into it via cacheSourceData so the shared search lights up.
const dataStore = inject('dataStore', null)
const GEOCODER_SOURCE = 'upg-search'
// slice 13 §1c: the canonical Pinia uiStore, provided by ProfileLoader
// (ProfileLoader.vue:98-101). PeopleGroupDetail injects the SAME store, so the
// panel opens when we call uiStore.selectPeopleGroup(feature) and hides itself
// when its close button calls uiStore.selectPeopleGroup(null). Template gates on
// uiStore.selectedPeopleGroup. Default {} so a stray standalone mount can't crash.
const uiStore = inject('uiStore', null)

const mapEl       = ref(null)
// Set to the translated "Loading data…" as soon as t() exists (below useI18n) — before first render,
// so no reader ever sees an English placeholder while the map engine downloads.
const status      = ref('')
// P3-1: the MAP CELL's own error. Distinct from `status` (the small bottom-right
// telemetry badge): this is the user-facing "the map is unavailable" notice drawn
// INSIDE the map cell, so a tile/token/WebGL failure degrades to a missing map
// rather than a blank app. Mirrors gospel-resources' `err` + .gm-err.
const mapError    = ref('')
const legendNodes = shallowRef([])          // nested 26-row tree for SemanticTreeLegend
const selectedKey = ref(null)               // currently isolated zoneKey (or null)
// Reactive mirror of `map` for the control components (they take :map as a prop and
// need reactivity to mount once the instance exists). `map` itself stays a plain
// `let` for the imperative draw/layer code below.
const mapRef      = shallowRef(null)
const isDark      = ref(false)              // 09b light-default: boot style is light-v11 (see onMounted)

// 09b-9 legend-light-mode: per-map instance store. SemanticTreeLegend injects this
// (useInstance) and reads instance.theme for its :data-theme binding. We provide it
// at mount and keep instance.theme in lock-step with isDark so the legend follows the
// basemap: boot isDark=false → theme 'light' → legend light; toggle dark → 'dark' →
// the component's own (default) dark chrome. Seed 'light' to match the light boot.
const pplrInstance = createPplrInstance('my-upg-100-list')
pplrInstance.theme.value = 'light'          // boot is light-v11 (isDark=false)
provideInstance(pplrInstance)

// ── 09b shift-select tool: reactive batch-selection state ────────────────────
// selectedTerritories is an ORDERED list of { key, name, count, kind } (insertion
// order = the intended click order → the clipboard reads in that order). A plain
// Set would lose order; an array gives ordered names + cheap toggle by `key`.
const selectedTerritories = ref([])         // [{ key, name, count, kind }]
const selTotal = computed(() =>             // live running UUPG total (null counts = 0)
  selectedTerritories.value.reduce((a, t) => a + (Number(t.count) || 0), 0))
const selCount = computed(() => selectedTerritories.value.length)
const copyFlash = ref('')                    // transient "Copied!" / "Copy failed" label
let countryNameMap = null                    // iso3→label, built from live records

// ── R1.2 PIVOT (2026-06-11): MOBILE-FRIENDLY "Batch Select" mode ──────
// The selection INPUT GESTURE is a visible toggle button + plain taps — NO
// shift/ctrl/meta (touch devices have no modifier keys; D-8 removes them). When
// batchMode is ON a plain tap on a map `tapestry-fill` feature OR a legend row
// toggles that territory/zone in/out of selectedTerritories (a″/a‴). When OFF a
// plain tap is the existing single-zone isolate (a‴, unchanged). Leaving batch
// mode KEEPS the selection STATE so Copy/color still work (D-7); Clear empties it.
//
// R1.4 (L4 fix — batch selection is ONE button, and its UI shows only once that
// button is selected): the map-rail .upg-rail-batch is the
// ONLY entry point (the always-visible HUD .upg-batch-btn is GONE), and ALL batch
// chrome — HUD, legend row markers, the amber map highlight — renders ONLY while
// batchMode is ON (progressive disclosure). The kept selection is invisible out
// of batch mode and re-reveals on re-entry.
const batchMode = ref(false)
function setBatchMode(on) {
  const next = on === undefined ? !batchMode.value : !!on
  if (next === batchMode.value) return next    // idempotent: repeat sets don't churn
  batchMode.value = next
  if (map) map.getCanvas().style.cursor = ''   // reset hover cursor on mode flip
  // Warm the people-group records so Copy / Export CSV run from cache inside the tap (see selectionRecordsLoad).
  if (next) selectionRecordsLoad().catch(() => {})
  // R1.4: show/hide ALL batch chrome (map highlight + legend markers) in the SAME
  // pass as the mode flip — no frame where the mode and its chrome disagree.
  refreshSelectionPaint()
  return next
}
function toggleBatchMode() { setBatchMode() }

// R1.3 (j) + R1.4: DOM-settle pass for the legend's multi-row markers across
// batch-mode flips and theme swaps (setBatchMode already ran the synchronous
// refreshSelectionPaint pass; this nextTick re-mark catches the legend re-render).
// Both passes are idempotent reads of CURRENT state, so rapid flips converge on
// the last state — no stale markers (the L4 "glitchy" class).
watch([batchMode, isDark], () => { nextTick(() => markLegendBatchRows()) })

// Toggle a resolved territory (from a map feature OR a legend zone) in/out of the
// ordered selection. Shared by the map-tap and legend-row batch paths so both feed
// the SAME union (D-6). `t` is a { key, name, count, kind } identity.
function toggleTerritory(t) {
  if (!t) return
  const list = selectedTerritories.value
  const idx = list.findIndex((x) => x.key === t.key)
  if (idx >= 0) selectedTerritories.value = list.filter((_, i) => i !== idx) // toggle OFF
  else selectedTerritories.value = [...list, t]                              // toggle ON
  if (idx < 0 && t.kind === 'adm1') indiaStates().catch(() => {})             // warm India's table for Copy / CSV
  refreshSelectionPaint()
  copyFlash.value = ''
}

// ── 09b shift-select R1.1 (g/h): selection COLOR ─────────────────────────────
// 8 preset swatches (Okabe–Ito palette — distinct + colorblind-aware, per the
// R1.1 decision row) + a custom hex input. Picking a color PREVIEW-recolors the
// selected territories on the map (the dedicated upg-sel-fill layer repaints —
// the base tapestry / zone-colors.json stay CLEAN until the operator applies the
// pasted payload via toolB, per the R1.1 "live recolor scope" default) and the
// clipboard payload gains the trailing " · #hex" that toolB parses.
const SWATCHES = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999']
const selectedColor = ref('')                // '' = no color picked (amber default style)
const hexDraft = ref('')                     // the custom-hex input model

function setSelectionColor(c) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(c || '').trim())
  if (!m) return
  const hex = '#' + m[1].toLowerCase()
  selectedColor.value = selectedColor.value === hex ? '' : hex // re-pick toggles off
  refreshSelectionPaint()
}
function onHexInput() {
  if (/^#?[0-9a-fA-F]{6}$/.test(hexDraft.value.trim())) setSelectionColor(hexDraft.value)
}

// ── 09b-search-reuse-geocoder: search state ──────────────────────────────────
// The hand-rolled input/dropdown is GONE (§1a) — the SHARED <GeocoderComponent>
// owns the input now. `geocoderRef` is the component's exposed ref (mirrors
// research-map.vue:415). searchIndex (the headless matcher) is kept ONLY to back
// the window.__UPG_SEARCH__ test handle so the firefox gate can drive a
// deterministic select without keystroke timing; SEARCH_LIMIT caps it.
const geocoderRef = ref(null)                // <GeocoderComponent> exposed ref

// Search parameterization — the SAME two props research-map uses to give each of
// its instances a distinct personality (research-map.vue:420-449). There the pair
// is computed from the active legend tab; this profile is single-taxonomy (no tab
// bar), so its context is constant.
//
// 'people-groups' orders the result groups blocs → clusters → peopleGroups first
// (useSearch.js ORDER_BY_CONTEXT), which matches this list's zone/territory/PG
// model. Without it the prop defaulted to '' → ALL_GROUPS ordering, i.e. the
// generic list rather than this map's own — the drift the rebuild spec flagged.
// The legend names the MAP, not just the taxonomy — with several maps in one app
// "Legend" alone does not say which one you are looking at.

// ★ NAME THE LEGEND'S DEPTH TABS. Without a `tabs` prop SemanticTreeLegend falls through to
// `src[i] ?? { id: 'gen'+(i+1), label: 'Generation '+(i+1) }` (SemanticTreeLegend.vue:157) — a
// placeholder that exists only so the tab strip has something to render. This bundle shipped with
// it, so the legend read "GENERATION 1 / 2 / 3" above a list of regions. A UUPG list has no notion
// of a generation, so the label described nothing and invited the reading that the tabs FILTER the
// map by some cohort. They do not: a tab is a DEPTH LEVEL of this tree, which is why selecting a
// node jumps to its depth (`activeTab = Math.min(sel.depth, …)`, same file:232).
//
// The three levels, read from data/legend-tree.js rather than guessed: regions are assembled at
// :302 by grouping leaves under regionFor(); zones are the middle nodes (Frontier Asia (uncovered)
// at :245, India at :199, Deaf (affinity bloc A017) at :159); leaves are the individual prayer
// zones each pin belongs to. Shape and `info` wording follow AFFINITY_TABS/REGIONS_TABS in
// country-posters/countries-map.vue:836, the established precedent — `info` renders both as the
// chip's title tooltip and as a popover (SemanticTreeLegend.vue:1125-1130).
//
// ★ THE IDS ARE DELIBERATELY BUNDLE-SCOPED, and that was MEASURED, not stylistic. tabLabel()
// (SemanticTreeLegend.vue:39) resolves `tabs.<id>` against the shared i18n catalog FIRST and only
// falls back to the English `label` when no entry exists — so a tab id is a GLOBAL namespace. The
// first version of this list used id:'region', and the legend rendered "WAGF Region" instead of
// "Region", because library/i18n/locales/en/tabs.json:17 already maps that key to the
// country-posters taxonomy. id:'group' collides the same way (→ "People Group", correct here only
// by coincidence — the catalog means the ROP-2.5 sense, not this bundle's). Prefixed ids own no
// catalog entry, so the labels below are what render. If these tabs are ever translated, add
// `upg100Region`/`upg100Zone`/`upg100Group` to tabs.json rather than reusing a generic key.
// ★ "Zone" RENAMED, ORDER DELIBERATELY UNCHANGED (2026-09-23).
// A reader does not know what "zones" means — the thing the map paints IS
// a UPG-100 list (27 of them); "zone" was our internal word leaking into the UI.
// So the LABEL now names what it shows. Region stays as what it actually is: a way
// to SORT those lists by world area when you want that.
//
// ⚠ DO NOT REORDER THESE TO MAKE THE LIST TAB OPEN FIRST. Tab INDEX is coupled to
// tree DEPTH in the shared legend: `activeTab = Math.min(sel.depth, …)` and again
// on breadcrumb (SemanticTreeLegend ~231 and ~418). The tree nests region(0) →
// zone(1) → group(2), so moving zone to index 0 would make selecting a zone jump
// to the Region tab. Seven profiles share that component.
// Opening on the list tab is done the way the codebase already provides for it:
// `:default-tab="1"` at the call site — the prop country-posters added for exactly
// this ("it opens to the country's semantic level in the legend").
//
// The catalog entries this note used to ask for now EXIST: tabs.upg100Region /
// tabs.upg100Zone and legend.tabInfo.upg100Region / legend.tabInfo.upg100Zone, in all 11 locales
// with exactly the text that used to be inline here. So the labels are bound, not hardcoded.
//
// ★ A COMPUTED, NOT A const ARRAY. t() is destructured at :391, BELOW this point, so a plain
// const could not call it at all — and even hoisted it would freeze the labels at whatever locale
// was active when the module evaluated. The host switches language at runtime (ProfileLoader
// drives appI18n.global.locale), so the labels have to re-evaluate: a computed reads t() on
// access, which is what makes a mid-session locale switch reach the legend tabs.
const LEGEND_TABS = computed(() => [
  { id: 'upg100Region', label: t('tabs.upg100Region'),
    info: t('legend.tabInfo.upg100Region') },
  { id: 'upg100Zone',   label: t('tabs.upg100Zone'),
    info: t('legend.tabInfo.upg100Zone') },
  // ★ THE 'People Group' TAB WAS REMOVED BECAUSE IT COULD NEVER RENDER ANYTHING — measured, not
  // a matter of taste. SemanticTreeLegend renders tab N as collectAtDepth(nodes, N), so a tab's
  // index IS a tree depth. This legend's tree is exactly TWO levels deep: 9 regions -> 28 lists.
  // MEASURED 2026-09-25 by expanding every caret on the Region tab — 37 rows, 9 at indent 0 and
  // 28 at indent 1, deepest level 1. There is no level 2, so tab index 2 resolved to an empty set
  // and the panel rendered its "No data at this level" empty state with the tab ACTIVE.
  // The legend does not need a People Group tab; the reason is
  // that clicking it showed nothing at all.
  // ⚠ IF PEOPLE-GROUP ROWS ARE EVER WANTED BACK, a third tab is not the mechanism — the tree would
  // need a third level (list -> group). Re-adding the tab without deepening the data reproduces
  // exactly this empty state.
])
// The generation the legend OPENS on: index 1 = the UPG-100 Lists tab. A reader
// should meet the lists first and reach for Region only to sort them.
const LEGEND_DEFAULT_TAB = 1

const geocoderContext = 'people-groups'
let searchIndex = []                         // [{ label, kind, target, _hay }] (gate handle)
const SEARCH_LIMIT  = 8

let map = null
let tapestry = null                         // markRaw FeatureCollection (all 26 zones)
let leafZoneList = []                       // flat [{ id, zoneKey, color, selector }]
let matchColorExpr = null                   // cached ['match', …] fill-color expression
let _detachEdges = null                      // useEdgeScrollAffordance teardown
let addPinLayers = null                     // set in onMounted (closes over pinFC); re-used by theme re-add

// Config-only, fail-closed: base comes solely from config, NO default host.
const API_BASE = (typeof window !== 'undefined' && window.MAP_APP_API_URL)
  || import.meta.env.VITE_API_BASE_URL
  || ''

// Prayer-packet printing (legend Export > Prayer packet). The ACTION lives in the
// shared usePosterPrints composable — it prints through a hidden same-page iframe,
// so the dialog opens in this tab rather than a popup a browser may block. The
// packet's locale follows the app's, so a reader gets it in their own language.
const { locale: packetLocale, t } = useI18n()
// The first status a reader sees. Set in a watcher, not once at setup, so a language switch while the
// map is still loading re-resolves it; the first real status replaces it and the watcher then leaves it.
let loadingText = ''
// Watched through packetLang(), not packetLocale itself: the host may install i18n with a plain-string
// locale (see packetLang), and watch() on a non-ref is an invalid source that never fires.
watch(() => packetLang(), () => {
  if (status.value === '' || status.value === loadingText) status.value = loadingText = t('legend.loadingData')
}, { immediate: true })

// ★ THE LEGEND SPEAKS THE READER'S LANGUAGE. Its rows were clusters.json's English labels and its
// section rows the English grouping keys, while the packet printed from the same row was localized
// (localizedZone): السودان on paper, 'Sudan' on screen. Region sections go through REGION_KEY (the
// table the wall uses too); tier-A zones through zoneTitle, preferring the records' own localized
// country_code_label once they are loaded; the Deaf row through its bloc name. A zone the generator
// declines (tier B/C) keeps its hand-written label, as on every other surface.
// A function, not a const: DEAF_COUNT and packetLang are declared further down and are read per call.
function legendOpts(records) {
  const strings = { zone_affinity_A017: t('poster.zone_deaf') }
  const byCode = records ? countryLabelIndex(records) : undefined
  return {
    deafCount: DEAF_COUNT,
    ...(records ? { records } : {}),
    title: (zone) => zoneTitle(zone, strings, { byCode, countryName, locale: packetLang() }),
    regionTitle: (english) => (REGION_KEY[english] ? t(`poster.${REGION_KEY[english]}`) : english),
  }
}
// ★ AND RE-BUILT WHEN THE LANGUAGE CHANGES. The tree above is built once and STORED, so a runtime switch
// (ProfileLoader drives the i18n locale mid-session) left every region and zone name in the boot language
// while the chrome around it changed — a frozen label that check:frozen-labels cannot see, because t()
// runs inside a function. One builder for all three build sites remembers the last records, and a watch
// on the locale rebuilds the tree, relabels the flat zone list IN PLACE (colours and selectors stay), and
// refreshes the search feed built from those labels.
let legendRecords = null
function buildLegend(records) {
  if (records !== undefined) legendRecords = records
  return buildLegendNodes(listZones(), legendOpts(legendRecords))
}
watch(() => packetLang(), () => {
  if (!legendNodes.value.length) return
  legendNodes.value = buildLegend()
  const fresh = new Map(leafZones(legendNodes.value).map((l) => [l.id, l.label]))
  for (const z of leafZoneList) if (fresh.has(z.id)) z.label = fresh.get(z.id)
  if (searchRecords) buildSearch(searchRecords)
})
// ⚠ IT WAS A HARDCODED ENGLISH LITERAL, and SemanticTreeLegend passes `title` through RAW —
// the caller owns localizing it. MEASURED 2026-09-25 on the live Chinese render: the legend
// header read "My UPG 100 List — Legend" in full English inside an otherwise localized panel,
// beside translated tabs (区域 · UPG-100 名单) and a translated column header (人口).
// The gift policy is explicit — beautiful: no clipped text, no placeholders, no English
// leaking — and an English title on the mobile showcase is exactly that.
// ★ THE HOUSE STYLE FOR A PROPER NOUN INSIDE A TRANSLATED PHRASE ALREADY EXISTS in this catalog:
// "Doxa Regions" renders as "Doxa 区域" / "مناطق Doxa" / "Регионы Doxa" — the identifier stays
// Latin, the frame translates. "UPG 100" is treated the same way rather than transliterated, so
// this follows a convention demonstrated across 11 locales instead of inventing terminology.
// COMPUTED, not a constant: a locale change must move it. A `const` captured at setup would keep
// the mounting language forever, which is the subtler half of the same bug.
// The plugin's display name, "UPG 100 List Posters" (2026-09-30). upgMap ships only in this bundle, so the rename
// rebuilds one bundle; the old shared legend.title.upg100List stays for a batched shared-area cleanup.
const LEGEND_TITLE = computed(() => t('upgMap.displayName'))
const BATCH_SELECT_TITLE = computed(() => t('legend.title.batchSelect'))
// ★ THE SEARCH PLACEHOLDER WAS THE LAST ENGLISH STRING ON THE ARABIC SCREEN. The ?lang=ar
// screenshot was clean except for this one hardcoded literal.
// ⚠ A computed, and declared HERE rather than beside geocoderContext, because t() is not
// initialised until line 359 — a const at 339 would capture the fallback and never re-evaluate
// when the locale changes.
// NO NEW TERMINOLOGY: composed from wording this product already ships and has already approved —
// search.kinds.peopleGroup for the group, tabs.upg100Zone for what this plugin calls a "zone"
// (its legend names them "UPG-100 Lists" / "قوائم UPG-100" / "UPG-100 名单"), and
// search.kinds.region for the territory. That is why this could be translated and the UUPGs
// column header could not: there, no source existed for the acronym.
const geocoderPlaceholder = computed(() => t('search.upg100Placeholder'))
const DEAF_COUNT = 123

// Shadow-root CSS. (No backticks inside this string — a stray backtick closes the
// JS template literal and silently blanks the whole stylesheet. Burned us 3×.)
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
// The shared gray edge-strip affordance (lifted out of useMapInstance 2026-07-30 so
// non-useMapInstance profiles like this one can use it).
import { useEdgeScrollAffordance } from '@map/composables/useEdgeScrollAffordance.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { loadIndiaStates } from '@map/data/indiaStates.js'
// Reads a GeoJSON source's features WITHOUT touching the engine-private _data, whose shape differs
// between MapLibre and Mapbox (see openPgDetail).
import { readSourceFeatures } from '@map/maps/pin-selection.js'
useShadowStyles(
  // ★ isolation:isolate CONFINES THE MAP AREA'S LAYERS (2026-09-30), the containing layer Simple Research's and the
  // country map's .rm-root already have. Without it the legend sheet's z-index 1000 competed directly with the
  // gallery's round ☰ (z 15) in the shell's stacking context and painted over it on the Map view. Isolated,
  // the whole map area stacks as one layer and the ☰ sits above it, sheet included, as on those maps. It is on
  // the MAP root only: the poster wall's modal scrim lives in the other pane, outside this layer, and keeps
  // covering the ☰ (raising the ☰ instead would have put it over that modal).
  '.upg-root{position:absolute;inset:0;background:#0a1410;color:#e5e7eb;isolation:isolate;' +
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.upg-map{position:absolute;inset:0}' +
  // P3-1 graceful degrade: the map-cell error notice. Centred in the map cell and
  // pointer-events:none so it never swallows clicks meant for the legend/toolbar
  // overlays that sit above it. z-index stays BELOW the legend (.stl-panel) and the
  // toolbar so the surviving UI always wins the stacking contest — the point of the
  // fix is that the list stays usable while only the map is gone.
  '.upg-map-err{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);' +
  'z-index:1;pointer-events:none;text-align:center;padding:0 24px;' +
  "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#9aa7b8}" +
  '.upg-map-err strong{display:block;font-size:14px;color:#cbd5e1;margin-bottom:4px}' +
  // Edge scroll-affordance hit-boxes — same geometry research-map uses. They are
  // INVISIBLE by default (background:transparent); the shared composable paints the
  // gray gradient and toggles opacity. touch-action:pan-y IS the mechanism that
  // lets a vertical drag scroll the PAGE while Mapbox keeps the centre.
  '.map-scroll-edge{position:absolute;top:0;bottom:0;width:40px;z-index:2;' +
  'touch-action:pan-y;pointer-events:auto;background:transparent}' +
  '.map-scroll-edge--left{left:0}' +
  '.map-scroll-edge--right{right:0}' +
  // Desktop panel vs mobile bottom-sheet — exactly one is visible. Breakpoint
  // matches research-map's .rm-legend-*-slot (767px) so the whole map stack
  // flips at the same width instead of drifting per profile.
  // ★ The search bar above the legend was REMOVED from this profile, so the legend rises into the
  // vacated space (2026-09-23: with the search bar removed, the legend moves
  // up so that no gap is left where the search bar used to be). --stl-top is the shared
  // SemanticTreeLegend's offset-from-map-top; 8px matches its own left inset. Other profiles keep
  // the 60px default because they still have their search bar.
  '.upg-legend-desktop-slot{--stl-top:8px}' +
  '.upg-legend-mobile-slot{display:none}' +
  '@media(max-width:767px){' +
    '.upg-legend-mobile-slot{display:block}' +
    '.upg-legend-desktop-slot{display:none}' +
    // The bottom-sheet owns the people-group card on mobile — see the
    // .upg-detail-desktop-slot comment in the template.
    '.upg-detail-desktop-slot{display:none}}' +
  // ★ THE MAP CREDITS ARE A LICENCE TERM, AND THIS BADGE SAT ON THEM. bottom:10px + right:10px is the
  // corner both engines put their attribution in, and at z-index 5 the badge won every hit point of
  // '© OpenStreetMap' on both engines in en and ar; in Arabic the list panel mirrors onto that corner
  // too, so it also covered the panel's pin note (measured on 29634ed07, card
  // FIX-UPG100-STATUS-BADGE-COVERS-THE-MAP-ATTRIBUTION).
  // --upg-credit-floor is the top of the credit band: 30px, the tallest single-line credit (the Mapbox
  // wordmark, 23px + its 6px margin; the attribution line and the compact "i" are shorter), plus the
  // lift LegendMobile already gives the engine corners on a phone (the collapsed sheet, or the
  // gallery's menu button), read from the same two variables so whatever stacks on it moves with them.
  // The badge sits above that floor at the INLINE END: the right in English, the left in Arabic, where
  // the panel is not. z-index 1 keeps it under the engine corners (z 2-3), so a credit that grows (the
  // compact "i" expanded on a narrow map) paints over the badge, never under it; and it takes no clicks.
  '.upg-root{--upg-credit-floor:calc(max(min(var(--legend-sheet-h,0px),48px),var(--map-fab-clearance,0px)) + 30px)}' +
  // ★ ON A PHONE THE CREDIT IS NOT DOWN HERE (2026-09-30). LegendMobile moves both engines' bottom corners
  // to the TOP of the map below 768px (its own query, repeated here), so the band leaves the floor and
  // what stacks on it (the batch HUD; the badge is hidden on a phone) sits over the sheet and the round
  // menu button alone, 30px lower than before.
  '@media(max-width:767.98px){.upg-root{--upg-credit-floor:max(min(var(--legend-sheet-h,0px),48px),var(--map-fab-clearance,0px))}}' +
  '.upg-status{position:absolute;bottom:calc(var(--upg-credit-floor) + 6px);inset-inline-end:10px;z-index:1;' +
  'pointer-events:none;font:10px/1 ui-monospace,monospace;color:#9aa7b8;background:rgba(10,14,21,.82);' +
  'padding:6px 10px;border-radius:8px}' +
  // On a phone the collapsed legend sheet owns the bottom edge, and the badge always sat UNDER it (at 390,
  // 0 of its 15 points visible, both engines, en and ar), so it was never seen there. That stays true, now
  // on purpose instead of by accident: lifting it above the sheet would put new chrome on the phone map.
  '@media(max-width:767px){.upg-status{display:none}}' +
  // slice 13 §1c: detail-panel wrapper. The SemanticTreeLegend lives top-LEFT
  // (.stl-panel left:8px) in THIS profile and the MapToolbar floats top-RIGHT;
  // so the detail panel slides in from the RIGHT edge, starting below the
  // toolbar (top:60px) so it clears the control rail (D-1 adapted: the QA
  // assumed legend top-right, but here it is top-left — right-side avoids the
  // legend collision and the controls). PeopleGroupDetail brings its own inner
  // CSS via useShadowStyles; this wrapper only positions + frames it.
  '.upg-detail-panel{position:absolute;top:60px;right:8px;bottom:10px;width:340px;' +
  'max-width:calc(100vw - 16px);z-index:6;background:#fff;border-radius:12px;' +
  'box-shadow:0 8px 28px rgba(0,0,0,.45);overflow:hidden;display:flex;' +
  'flex-direction:column;animation:upgPanelIn .18s ease}' +
  '.upg-detail-panel.dark{background:#1a1a2e}' +
  '@keyframes upgPanelIn{from{transform:translateX(16px);opacity:0}' +
  'to{transform:translateX(0);opacity:1}}' +
  '@media(max-width:480px){.upg-detail-panel{top:auto;left:8px;right:8px;' +
  'width:auto;height:55vh}}' +
  // ── 09b shift-select tool: the land-division HUD (sits ABOVE the status badge,
  // at the same inline end, so it follows the badge off the credit band: the badge's
  // top is the floor + 6 + its 22px, and 2px more is the gap this HUD always kept).
  // Shows "N territories · TOTAL UUPG" live + a Copy/Clear bar that
  // only appears when something is selected. (No backticks anywhere in this string
  // — a stray one closes the JS template literal and blanks the whole stylesheet.)
  // The shown-zone chip: centred above the same floor the HUD uses (the two never show together: batch
  // mode feeds the selection union, not the isolate). A pill-sized button, 40px tall, so the × is a
  // finger's target on a phone; the name ellipsises rather than pushing the chip wider than the map.
  '.upg-shown{position:absolute;bottom:calc(var(--upg-credit-floor) + 12px);left:50%;transform:translateX(-50%);z-index:6;' +
  'display:inline-flex;align-items:center;gap:10px;max-width:calc(100% - 120px);min-height:40px;box-sizing:border-box;' +
  'padding:0 6px 0 16px;border:1px solid rgba(110,231,183,.45);border-radius:999px;background:rgba(10,20,16,.92);' +
  'color:#e5e7eb;font:600 13px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}' +
  '.upg-shown-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.upg-shown-x{display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;height:28px;' +
  'border-radius:50%;background:rgba(255,255,255,.16);font-size:18px;line-height:1}' +
  '.upg-shown:focus-visible{outline:2px solid #6ee7b7;outline-offset:2px}' +
  '.upg-hud{position:absolute;bottom:calc(var(--upg-credit-floor) + 30px);inset-inline-end:10px;z-index:6;min-width:150px;' +
  'font:11px/1.35 ui-monospace,monospace;color:#e5e7eb;' +
  'background:rgba(10,20,16,.92);border:1px solid rgba(110,231,183,.35);' +
  'border-radius:10px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.4)}' +
  '.upg-hud-head{display:flex;align-items:baseline;gap:6px;white-space:nowrap}' +
  '.upg-hud-total{font-size:15px;font-weight:700;color:#6ee7b7}' +
  // margin-inline-start, not margin-left: this pushes the band to the TRAILING end of the flex row
  // .upg-hud-head, which is the left in Arabic. Same class as the legend/table conversions.
  '.upg-hud-band{margin-inline-start:auto;font-size:9px;color:#9aa7b8}' +
  '.upg-hud-band.ok{color:#6ee7b7}' +
  '.upg-hud-names{margin-top:5px;max-height:84px;overflow:auto;font-size:10px;' +
  'color:#cbd5e1;line-height:1.45;word-break:break-word}' +
  '.upg-hud-actions{display:flex;gap:6px;margin-top:7px}' +
  // R1.2 mobile sizing: Copy/Clear are ≥40px tap targets (was 6px padding ~24px).
  '.upg-hud-btn{flex:1;cursor:pointer;border:1px solid rgba(110,231,183,.4);' +
  'background:rgba(16,185,129,.18);color:#d1fae5;font:12px/1 ui-monospace,monospace;' +
  'padding:0 10px;min-height:40px;border-radius:8px}' +
  '.upg-hud-btn:hover{background:rgba(16,185,129,.32)}' +
  // R1.4 (L4): the full-width HUD .upg-batch-btn is GONE — the map-rail
  // .upg-rail-batch (below) is the SINGLE batch entry point, and the whole HUD
  // only renders while batch mode is ON (progressive disclosure).
  '.upg-hud-btn.clear{background:rgba(148,163,184,.12);border-color:rgba(148,163,184,.4);' +
  'color:#cbd5e1}' +
  '.upg-hud-flash{margin:4px 0 2px;font-size:11px;line-height:1.3;color:#6ee7b7;min-height:14px}' +
  '.upg-hud-hint{margin-top:4px;font-size:9px;color:#64748b}' +
  // R1.1 (g): the color-picker row — 8 preset swatches + a custom hex input.
  // (Still no backticks anywhere in this string — the burned-3x rule.)
  '.upg-hud-swatches{display:flex;gap:6px;margin-top:7px;align-items:center;flex-wrap:wrap}' +
  // R1.2 mobile sizing: swatches are ≥40px tap targets (was 18px — too small for
  // touch). The colored chip stays visually compact via an inset box-shadow ring
  // while the hit-area fills the 40px button.
  '.upg-swatch{width:40px;height:40px;border-radius:9px;cursor:pointer;padding:0;' +
  'border:1px solid rgba(255,255,255,.3)}' +
  '.upg-swatch.active{outline:2px solid #fff;outline-offset:1px}' +
  '.upg-hex{width:84px;min-height:40px;background:rgba(148,163,184,.12);' +
  'border:1px solid rgba(148,163,184,.4);color:#cbd5e1;' +
  'font:12px/1 ui-monospace,monospace;padding:0 8px;border-radius:8px}' +
  // R1.2 mobile sizing: at ≤480px the HUD spans the bottom edge (above the status
  // badge) so the Batch button + swatches + Copy never overlap the legend/toolbar.
  '@media(max-width:480px){.upg-hud{left:8px;right:8px;min-width:0;bottom:calc(var(--upg-credit-floor) + 30px);' +
  'max-height:48vh;overflow:auto}}' +
  // ── Batch Select toggle — the ONLY local rule left is the emerald ON state ───
  // ARCHIVED 2026-07-30: this profile used to hand-roll the whole button skin
  // (~14 rules duplicating .mcb: size, radius, shadow, hover, active-press, dark).
  // That duplicate is DELETED — the button is now a shared <MapControlButton>, so
  // size/shape/hover/dark all come from the library and it lines up with its
  // neighbours. Two bugs came from the duplicate:
  //   1. it declared min-width/min-height:40px, a FLOOR the shared 36px mobile rule
  //      could not override, so on mobile every other control shrank and this one
  //      did not;
  //   2. it was not a .mcb, so MapToolbar's own '.map-toolbar .mcb{width:32px}'
  //      slimming never applied to it — the rail slims to 32px and this button
  //      stayed 40px, which is the "larger + not in line + wrong spacing" report.
  // Kept: the emerald ON state. The shared .mcb.active is a blue tint; batch mode
  // is a MODE, not a momentary toggle, so it wants a louder signal. Scoped to this
  // button only, and it overrides nothing structural.
  '.map-toolbar .mcb.upg-batch-on{background:#10b981!important;color:#04241a!important;' +
  'box-shadow:0 0 0 2px rgba(52,211,153,.45),0 1px 4px rgba(0,0,0,0.2)!important}' +
  '.map-toolbar .mcb.upg-batch-on.dark{border-color:#34d399!important}' +
  // ── R1.3 (j): legend MULTI-SELECT marker (batch mode). The SHARED legend only
  // paints ONE .selected row (its internal single selectedId). In batch mode the
  // the reader selects 2+ rows, so the profile marks EVERY legend row that maps to a
  // selected zone with .upg-batch-row (applied profile-side by markLegendBatchRows
  // — we never edit the shared component). Emerald left-rail + tint so multiple
  // rows clearly read as selected at once; the dot gets an emerald ring.
  '.upg-batch-row{position:relative;background:rgba(16,185,129,.16)!important;' +
  'opacity:1!important;box-shadow:inset 3px 0 0 0 #10b981}' +
  '.upg-batch-row .stl-name{color:#065f46!important;font-weight:700}' +
  '.stl-panel[data-theme="dark"] .upg-batch-row .stl-name,' +
  '.upg-batch-row.dark .stl-name{color:#6ee7b7!important}' +
  '.upg-batch-row .stl-dot{box-shadow:0 0 0 2px #10b981}' +
  // ── 09b-search-reuse-geocoder §1(b): position the SHARED mapbox-gl-geocoder
  // ABOVE the legend. The component addControl()s itself into the map's top-left
  // ctrl stack; the legend (.stl-panel, also top-left) is positioned lower (top
  // offset + lower z) so the geocoder pill sits ABOVE it. This clones research-
  // map's geocoder column rules (research-map.vue:183-228) — the geocoder pill +
  // suggestions + dark mode — so tabs render visually identical. (No backticks in
  // this string — a stray one closes the JS template literal and blanks the CSS.)
  // The top-left ctrl group holds the geocoder; give it width + a top offset and
  // push the legend panel DOWN so it clears the geocoder pill.
  // Size the CONTAINER, never the pill — the pill fills it via the shared
  // 'geocoder-skin' rule in GeocoderComponent.vue, and the shared skin also owns
  // the mobile edge-to-edge rule. Sizing the pill directly (what this profile used
  // to do: width:min(360px,calc(100vw - 96px)) with an unsized container) is why it
  // rendered narrower than research-map and kept a 96px dead margin on phones.
  // Colour / radius / shadow / focus-ring / font-size are the library's too.
  // Do NOT re-add skin or fill rules here — change the library.
  '.mapboxgl-ctrl-top-left{top:12px!important;left:8px!important;width:380px!important;' +
  'max-width:380px!important;z-index:1200!important}' +
  '.mapboxgl-ctrl-top-left .mapboxgl-ctrl{margin:0!important;float:none!important}' +
  // Push the legend panel BELOW the geocoder pill (legend is top-left here too) —
  // ★ BUT ONLY IF THE PILL ACTUALLY RENDERED (2026-09-23, reported repeatedly: with the search
  // bar removed, the legend must move up — no gap where the search bar used to
  // be). MEASURED in both hosts with a real token: the standalone leaf mounts the geocoder
  // (top 12, h 35) and the legend belongs at 58; the cap-5 shell mounts NO geocoder at all, and
  // an unconditional 58px stranded the legend below a pill that was not there — the dead gap the
  // reports kept naming. One host cannot be fixed by breaking the other, so the offset is
  // conditional on the pill EXISTING: default raised to 8px (matching .stl-panel's own left
  // inset), pushed down only when a rendered geocoder is actually in the tree.
  // ★ SET --stl-top, DO NOT SET top DIRECTLY. The library caps the panel at
  // calc(100% - var(--stl-top, 60px) - 12px) (SemanticTreeLegend.vue:605), so the offset and the
  // height cap MUST come from one value. Overriding top alone moved the panel down while the cap
  // kept subtracting the OLD offset, and the two silently disagreed.
  // MEASURED 2026-09-24, upg-100-list hosted in a 420px-tall frame at 390px wide: top resolved to
  // 58px while max-height resolved to calc(100% - 20px), so the panel ran to 458px in a 420px map
  // and HUNG 38px PAST THE BOTTOM OF THE MAP — exactly 58 - 20. Same 38px at a 560px frame, because
  // the error is the offset mismatch, not the map's size. Reported 2026-09-24: the UPG-100 list
  // legend on the map overflowed beyond the height of the map.
  // ⚠ WHY THIS IS INVISIBLE ON EVERY PUBLISHED LEAF: a standalone leaf gives the map the FULL
  // viewport, and a panel that overflows a full-height map is still inside the screen. It only
  // shows when a host makes the map SHORTER than the viewport, which is how the element is really
  // embedded. Verify in a constrained host, never on the bare leaf.
  '.stl-panel{--stl-top:8px!important}' +
  '.upg-root:has(.mapboxgl-ctrl-geocoder) .stl-panel{--stl-top:58px!important}' +
  // ★ …AND IT ENDS ABOVE THE CREDIT BAND WHERE A CREDIT SHARES ITS CORNER. The panel sits at the inline
  // START, 12px off the map's bottom. In Arabic that is the bottom-RIGHT, the corner both engines keep
  // their attribution in (they do not mirror it), so the panel lay over the top of the credit line; on
  // Mapbox in English it is the bottom-LEFT, over the Mapbox wordmark (5 of 15 hit points visible,
  // measured on 29634ed07). Those two cases give up the credit band (the same 30px as
  // --upg-credit-floor); MapLibre in English has no credit in that corner, so its panel is unchanged.
  // Same max-height formula as SemanticTreeLegend's own cap, one term longer, so --stl-top still drives both.
  // ⚠ DESKTOP SLOT ONLY. The phone's bottom sheet renders a .stl-panel too, and '100%' there is the 48px
  // collapsed sheet: 48 - 8 - 12 - 30 is negative, the panel collapsed to nothing and the sheet lost its
  // "My UPG 100 List" title on Mapbox (measured at 390 on the first build of this fix, then scoped here).
  '[dir="rtl"] .upg-legend-desktop-slot .stl-panel,.upg-root:has(.mapboxgl-ctrl-logo) .upg-legend-desktop-slot .stl-panel{' +
    'max-height:calc(100% - var(--stl-top,60px) - 12px - 30px)!important}' +

  // ── RTL: WHAT THE LIBRARY DOES NOT DO ──────────────────────────────────────
  // ⚠ THE TWO POSITION RULES THAT USED TO LIVE HERE ARE GONE, deleted deliberately rather than left as a
  // belt-and-braces duplicate. c79aae95 converts BOTH physical insets in SemanticTreeLegend to
  // logical ones — :619 .stl-panel and :925 .stl-reopen are now `inset-inline-start: 8px` — so the panel
  // and its reopen button mirror for EVERY profile, not just this one. Two mechanisms doing one job is
  // worse than either: the next reader cannot tell which is load-bearing, and deleting the wrong one
  // looks safe.
  // WHAT REMAINS BELOW IS ONLY WHAT c79aae95 DOES NOT COVER — verified by reading it, twice:
  //   · .upg-detail-panel is THIS file's own CSS (:449), not a legend class. The library cannot reach it,
  //     and it must swap or it collides with the now-mirrored legend on the other side.
  //   · content DIRECTION. c79aae95 has ZERO occurrences of direction:rtl or unicode-bidi. It mirrors the
  //     panel's POSITION; these set its CONTENT direction, which is a different property. repo reported
  //     BOTH symptoms — "the panel is on the left" AND "the rows stay LTR" — so dropping these would fix
  //     the first and silently restore the second.
  //     ⚠ AND THIS PAIR MAY YET BECOME REDUNDANT: the argument is that dir on .profile-loader
  //     (ProfileLoader.vue:282) inherits into the legend, since `direction` is an inherited property that
  //     crosses the shadow boundary. That is plausible, and a library rule was declined without a
  //     measurement — correctly. The rows on Simple Research and Prayer Progress, which
  //     have NO override, get read after landing 5. If they read RTL there, DELETE the two rules below too.
  // ── the original finding, kept because it explains the shape ────────────────
  // Reported via repo, 2026-09-26, from the README's Arabic picture: under ?lang=ar the legend
  // panel stayed on the LEFT and the map controls sat on top of its top-left corner.
  //
  // ★ THE CAUSE IS ONE COMPONENT BEING RTL-AWARE AND ITS NEIGHBOUR NOT. MapToolbar.vue:42 already uses
  // `inset-inline-end: 3px`, a LOGICAL property, so under dir=rtl it correctly mirrors to the LEFT.
  // SemanticTreeLegend.vue:619 uses `position:absolute; left:8px` — a PHYSICAL property, which ignores
  // dir entirely. So the toolbar moves left, the panel never leaves, and they land on top of each other.
  // The overlap is not a z-index or spacing bug; it is two coordinate systems disagreeing.
  //
  // ⚠ THIS IS A WORKAROUND FOR A LIBRARY DEFECT, SAID PLAINLY RATHER THAN QUIETLY PAPERED OVER.
  // The real fix is one character class in SemanticTreeLegend — `left:8px` -> `inset-inline-start:8px` —
  // which would mirror for EVERY profile automatically. That file is library/, so under rule 5B it is
  // the library's to change; reported. Until then every other profile with an RTL locale has this same
  // collision, and this override fixes only this one.
  //
  // Scoped to [dir=rtl] so the LTR layout is untouched: ProfileLoader.vue:282 binds dir on the
  // .profile-loader wrapper from RTL_LOCALES, so this activates exactly when the document says so.
  // The detail panel is the legend's mirror image (it sits top-RIGHT in LTR), so it has to swap too or
  // the two would trade places and collide on the other side.
  '[dir="rtl"] .upg-detail-panel{right:auto!important;left:8px!important}' +
  // ★ THE TWO LEGEND-CONTENT RULES THAT USED TO SIT HERE ARE DELETED (2026-09-27), and they were NOT
  // equally provisional — one was redundant and the other was DEAD, which is worth separating because
  // only one of them was ever doing anything.
  //
  //   '[dir="rtl"] .stl-panel,[dir="rtl"] .stl-panel *{direction:rtl}'
  // REDUNDANT. It matched real elements (.stl-panel appears 69 times in SemanticTreeLegend) but the
  // library gets there on its own: it uses the :dir(rtl) PSEUDO-CLASS (:645-646), which reads the
  // INHERITED direction rather than needing a declaration, and CSS `direction` inherits across the
  // shadow boundary. Measured at main 4ca2dcf9 (row 56b): Simple Research and
  // Prayer Progress, which carry NO override at all, compute direction rtl on their legend rows under
  // ?lang=ar. A rule whose effect is indistinguishable from its absence on two other profiles is not
  // load-bearing here either.
  //
  //   '[dir="rtl"] .stl-panel .stl-count,[dir="rtl"] .stl-panel .stl-pop{direction:ltr;unicode-bidi:isolate}'
  // ⚠ DEAD CSS, and it always was. The library's count and population cells are `.stl-num` (:1314-1315).
  // `.stl-count` and `.stl-pop` DO NOT EXIST — `git grep` finds those two class names nowhere in
  // library/ or any other plugin, only inside this override. So this rule matched zero elements from the
  // day it was written, and the verified digit order ("694", "1,413" keeping their order under ar)
  // was always the library's doing, never this file's.
  // ★ THE LESSON IS ABOUT THE EVIDENCE, NOT THE CSS: this rule was written to fix a real bidi problem,
  // was believed to have fixed it, and was cited as the reason the numbers read correctly — while
  // matching nothing. A style rule fails SILENTLY when its selector is wrong; it does not warn, and the
  // page looks right if something else is already handling it. The only way to know a rule works is to
  // check that its selector exists, which is a different act from looking at the rendered page.
  // (Both were deleted as provisional; recorded here that one of the two was
  // never provisional but inert, so nobody re-adds it believing it once worked.)
  // ⚠ AND THE REOPEN BUTTON, which I missed on my first pass and repo caught. SemanticTreeLegend has
  // TWO physical `left:8px` rules, not one: :619 for the panel and :921 for .stl-reopen, the button that
  // brings the panel back after it is collapsed. Mirroring only the panel would leave the button on the
  // opposite side from the thing it opens — a worse state than the original bug, because it looks
  // deliberate.
  // The lesson: a sweep for other physical insets was requested but not run before reporting. `grep -nE '(^|[^-])(left|right):' library/components/legends/*.vue`.
  // Geocoder suggestion metadata layout (clone — bold field labels for PG rows).
  '.dg-main{font:13px/1.3 ui-monospace,monospace}' +
  '.dg-meta{margin-top:2px;font-size:11px;color:#475569;display:flex;flex-wrap:wrap;gap:8px}' +
  '.dg-field strong{font-weight:700}' +
  '.dg-section-header-item{padding:4px 8px;font:10px/1.2 ui-monospace,monospace;' +
  'letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;pointer-events:none}' +
  // ARCHIVED 2026-07-30 — the local dark-mode geocoder skin lived here. It is now
  // in GeocoderComponent.vue ('geocoder-skin'), which honours BOTH the
  // `geocoder-dark` class (set from the isDark prop) and a `.dsm-dark` ancestor,
  // so this map gets the same sage pill every other map does. The archived values
  // were: background #0a1410, border rgba(110,231,183,.30) mint, input #e5e7eb —
  // a palette no other profile used. Kept in this comment as the record of what
  // was replaced; do not restore them.
  ''
)

// ── tapestry paint: ONE source, ONE match expression ────────────────────────
function buildMatchColorExpr(zones) {
  // ['match', ['get','zoneKey'], key1,color1, key2,color2, …, fallback]
  // slice 09b-9 §3 (L18/L29 FIX): each arm's color now resolves through
  // colorForZone(zoneKey, leafColor) — the SAME source the strategy
  // lives in (zone-colors.json) — so the IDLE tapestry paints the region-inherited
  // shades (no rainbow, no click needed). z.color (the deterministic leafColor HSL)
  // is the FALLBACK when a zone has no override yet. deaf (#18ffff) is one of those
  // overrides, so its handling is preserved through the same path.
  const arms = []
  for (const z of zones) { arms.push(z.zoneKey, colorForZone(z.zoneKey, z.color)) }
  // F2-D3: visible neutral fallback (#9ca3af) — the old #334155 dark slate was
  // invisible on the dark-v11 basemap and made unmatched pins/fills vanish.
  return ['match', ['get', 'zoneKey'], ...arms, '#9ca3af']
}

function ensureLayers() {
  // ⚠ GUARD ON THE LAYERS, NOT ONLY THE SOURCE — "the source exists" and "the layers exist" are two
  // properties, and this function's job is the second one. The old guard was
  // `if (map.getSource('tapestry')) return`, which returns and adds NOTHING whenever the source
  // survives while the layers are gone. That state is real: a style reload wipes LAYERS, and a source
  // can be present without them.
  //   ⚠ THIS IS NOT THE CAUSE OF THE BLANK ENGLISH README SHOT, though it was first diagnosed as one.
  // A measurement settled it: the leaf paints 9.5-16.5 s after load and the screenshot tool waited 7 s.
  // A timeout, not a defect. The earlier chain — source-survives-layers, half-built style, en/ar
  // divergence — explained the symptom without being true of it.
  //   THE GUARD BUG IS STILL REAL, on its own merits and on a different path: setStyle() (the
  // light/dark toggle) wipes LAYERS, and a source can outlive them, so the old guard returns having
  // added nothing. That is why paintAll is re-armed on 'style.load' at :1625 — the re-add is a real
  // code path, and this guard could silently no-op it.
  //   ensureSelectionLayers():652 already had the right shape (source AND getLayer) — the correct
  // pattern was in this file and these two functions did not copy it. addPinLayers had the same bug.
  if (map.getSource('tapestry') && map.getLayer('tapestry-fill') && map.getLayer('tapestry-line')) return
  if (!map.getSource('tapestry')) map.addSource('tapestry', { type: 'geojson', data: tapestry })
  // 09b light-default L-D2: the neon cyber palette runs hot on white. ensureLayers
  // is called on the initial draw AND on every post-setStyle theme re-add, so we
  // read isDark.value HERE (JS state, not a map expression) to pick per-theme
  // opacity. DARK is unchanged (the showcase): deaf 0.45 / others 0.65. LIGHT is
  // lowered (deaf 0.30 / others 0.45) so the neon reads as an accent, not garish —
  // the bright tapestry-LINE outline carries the glow on light either way.
  const deafOpacity   = isDark.value ? 0.45 : 0.30
  const othersOpacity = isDark.value ? 0.65 : 0.45
  // ⚠ EACH LAYER IS GUARDED SEPARATELY, because the two can be lost independently — and addLayer
  // THROWS on an id that already exists, which would abort this function and skip everything after it.
  // A half-built style is exactly the state this fix exists for, so it must not be made worse by
  // re-adding a survivor.
  if (!map.getLayer('tapestry-fill')) {
    map.addLayer({
      id: 'tapestry-fill',
      type: 'fill',
      source: 'tapestry',
      paint: {
        'fill-color': matchColorExpr,
        'fill-opacity': ['case', ['==', ['get', 'zoneKey'], 'deaf'], deafOpacity, othersOpacity],
      },
    })
  }
  if (!map.getLayer('tapestry-line')) {
    map.addLayer({
      id: 'tapestry-line',
      type: 'line',
      source: 'tapestry',
      // F2-D2: brighter, thicker outline gives contrast on dark without washing out light.
      paint: { 'line-color': matchColorExpr, 'line-width': 1.2, 'line-opacity': 0.9 },
    })
  }

  // ★ THE REAL READINESS SIGNAL. onLegendSelect() returns early unless map.getLayer('tapestry-fill')
  // exists, so a "Show on map" request that arrives before this function runs cannot hold a
  // selection however correctly it was delivered. This is the third layer of the same defect --
  // apply once against unready state, then discard -- and this is the point where the state is
  // finally ready. Drains any request retained by applySelectZone().
  if (_pendingZoneId) {
    const id = _pendingZoneId
    nextTick(() => { if (_pendingZoneId === id) applySelectZone(id) })
  }
}

// ── 09b shift-select tool: selection highlight layers (D-2) ──────────────────
// A DEDICATED fill+line pair on the SAME tapestry source, painted only for the
// currently-selected territories — visually DISTINCT from the zone-isolate style
// (which re-filters the base tapestry-fill). Bright amber outline + light tint so
// the operator sees the running land-division grow. The match is by shapeName
// (ADM1) OR iso3 (ADM0) so countries and admins both highlight from one filter.
function ensureSelectionLayers() {
  if (!map || !map.getSource('tapestry')) return
  if (map.getLayer('upg-sel-fill')) return
  // start filtered to nothing (false) until a selection exists
  map.addLayer({
    id: 'upg-sel-fill', type: 'fill', source: 'tapestry',
    filter: ['boolean', false],
    paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.28 },
  })
  map.addLayer({
    id: 'upg-sel-line', type: 'line', source: 'tapestry',
    filter: ['boolean', false],
    paint: { 'line-color': '#fbbf24', 'line-width': 2.4, 'line-opacity': 0.95 },
  })
}

// Build the Mapbox filter expr matching every selected territory by its identity
// prop (shapeName for adm1, iso3 for adm0). Empty selection → ['boolean', false].
function selectionFilterExpr() {
  const adm1 = [], adm0 = [], zones = []
  for (const t of selectedTerritories.value) {
    if (t.kind === 'adm1') adm1.push(t.name)
    else if (t.kind === 'adm0') adm0.push(t.key.slice(5)) // strip 'adm0:'
    else if (t.kind === 'zone') zones.push(t.key.slice(5)) // strip 'zone:' → zoneKey
  }
  const parts = []
  if (adm1.length) parts.push(['in', ['get', 'shapeName'], ['literal', adm1]])
  if (adm0.length) parts.push(['in', ['get', 'iso3'], ['literal', adm0]])
  // R1.2 D-6: legend rows ride as kind 'zone' → highlight every tapestry feature
  // whose zoneKey is in the selected-zone set (one union with map territories).
  if (zones.length) parts.push(['in', ['get', 'zoneKey'], ['literal', zones]])
  if (!parts.length) return ['boolean', false]
  return parts.length === 1 ? parts[0] : ['any', ...parts]
}

// Re-apply the selection filter to the highlight layers (idempotent; safe to call
// after every toggle AND after a setStyle theme re-add wipes the layers).
// R1.1 (g): when the operator has picked a color, the selection layers PAINT that
// color (live preview recolor — fill opacity rises so the hue actually reads as
// the territory's new color); with no pick they keep the amber selection style.
function refreshSelectionPaint() {
  // R1.3 (j) / R1.4: legend markers FIRST, outside the map-layer guard — the
  // legend lives outside the map, so markers stay honest even in the post-
  // setStyle window where upg-sel-fill doesn't exist yet (paintAll re-runs the
  // layer half on style.load). Every union/mode mutation flows through here.
  markLegendBatchRows()
  if (!map || !map.getLayer('upg-sel-fill')) return
  // R1.4 progressive disclosure: the amber/preview map highlight is batch chrome
  // — out of batch mode it filters to nothing (the selection STATE is kept, D-7).
  const expr = batchMode.value ? selectionFilterExpr() : ['boolean', false]
  map.setFilter('upg-sel-fill', expr)
  map.setFilter('upg-sel-line', expr)
  const c = selectedColor.value
  map.setPaintProperty('upg-sel-fill', 'fill-color', c || '#f59e0b')
  map.setPaintProperty('upg-sel-fill', 'fill-opacity', c ? 0.55 : 0.28)
  map.setPaintProperty('upg-sel-line', 'line-color', c || '#fbbf24')
}

// ── R1.2 PIVOT: batch-MODE click handler on tapestry-fill (NO modifier keys) ──
// batch mode ON  → a PLAIN tap TOGGLES the clicked territory in selectedTerritories
//                  (a″ — the mobile gesture; identical for mouse + touch).
// batch mode OFF → a PLAIN tap on the map fill clears any batch selection (§1e
//                  click-empty reset); the legend row-click still drives single-
//                  zone isolate independently (a‴). NO shiftKey/ctrlKey/metaKey
//                  branch — touch devices have no modifier keys (D-8).
// The resolver maps the clicked feature → { key, name, count } regardless of ADM0/ADM1.
let _tapestrySelectHandler = null
let _tapestryCursorBound = false
function attachTapestrySelect() {
  if (!map || !map.getLayer('tapestry-fill')) return
  // Re-bind cleanly across setStyle re-adds: drop the prior layer-scoped handler
  // first so a dark/light toggle never stacks duplicate click listeners (which
  // would toggle a territory twice and cancel the selection).
  if (_tapestrySelectHandler) {
    try { map.off('click', 'tapestry-fill', _tapestrySelectHandler) } catch (_) {}
  }
  _tapestrySelectHandler = (e) => {
    const f = e && e.features && e.features[0]
    if (!f) return
    if (batchMode.value) {
      // BATCH-SELECT (toggle) — plain tap, no modifier key required.
      const t = resolveTerritory(f.properties, { nameMap: countryNameMap })
      if (!t) { console.warn('[batch-select] clicked feature has no shapeName/iso3', f.properties); return }
      if (t.count == null) console.warn('[batch-select] no UUPG count for territory', t.name, f.properties)
      toggleTerritory(t)
    }
    // R1.4: OUT of batch mode a plain map-fill tap is a NO-OP for the selection.
    // (It used to clearSelection() — that silently nuked the D-7 kept selection
    // the moment the operator tapped the map after "Done", one of the L4 glitches.)
    // The legend row-click still drives single-zone isolate independently (a‴);
    // Clear inside the batch HUD is the only way to empty the selection.
  }
  map.on('click', 'tapestry-fill', _tapestrySelectHandler)
  if (!_tapestryCursorBound) {
    // Hover affordance only signals "tappable to add" while batch mode is ON.
    map.on('mouseenter', 'tapestry-fill', () => {
      if (map) map.getCanvas().style.cursor = batchMode.value ? 'crosshair' : ''
    })
    map.on('mouseleave', 'tapestry-fill', () => {
      if (map) map.getCanvas().style.cursor = ''
    })
    _tapestryCursorBound = true
  }
}

// ── 09b §1(e): clear the batch selection ─────────────────────────────────────
function clearSelection() {
  selectedTerritories.value = []
  copyFlash.value = ''
  selectedColor.value = ''   // R1.1: a fresh selection starts color-less (clean state)
  hexDraft.value = ''
  refreshSelectionPaint()
}


// ── R1.2 PIVOT (D-8): the Ctrl/Cmd-C + Escape keyboard handler is REMOVED — the
// brief asked to drop modifier-key gestures for mobile parity. The on-screen HUD
// buttons (≥40px tap targets) are the ONLY selection-action surface, and no code
// path depends on a keyboard modifier.
// Those buttons are Prayer List / Poster Map / Clear (:2856-2860). This comment
// used to name "Copy + Clear"; Copy went with fc93847bb, which is the same commit
// that orphaned the copySelection/legacyCopy pair deleted just above.

// ── 09b-search-bar §1(a/c): build the unified index once records are loaded ──
// PG rows come from the LIVE records (slug+name+lat/lng) — the same record set
// useGeoSearch consumes; zone rows from the legend leafZones; territory rows
// from admin-counts (ADM1) + ISO3 names (ADM0 countries). countryNameMap (built
// from the live records) gives the exact country label the legend shows.
let searchRecords = null                      // the records the feed was last built from (see the locale watch)
function buildSearch(records) {
  searchRecords = records
  // (i) Feed the SHARED GeocoderComponent: unify PG + zone + territory into ONE
  //     record list and cache it under our source so useGeoSearch (inside the
  //     component) indexes it. Zones/territories ride as synthetic records with a
  //     centroid (from boundsFor) + a `__upgKind` discriminator. centroidFor lets
  //     the data module stay DOM/Mapbox-free (pure fns) — the profile owns geometry.
  if (dataStore && typeof dataStore.cacheSourceData === 'function') {
    const feed = buildGeocoderFeed({
      records,
      leafZones: leafZoneList,
      adm1Counts: ADM1_COUNTS,
      iso3Names: ISO3_NAME,
      countryNameMap,
      centroidFor: (pred) => {
        const b = boundsFor(pred)
        if (!b) return null
        return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]
      },
    })
    // markRaw inside cacheSourceData keeps this large array out of reactivity.
    dataStore.cacheSourceData(GEOCODER_SOURCE, { normalizedData: feed })
  }

  // (ii) Build the headless matcher index — TEST-ONLY (backs window.__UPG_SEARCH__
  //      so the firefox gate drives a deterministic select). The live search UI is
  //      the shared GeocoderComponent; this is just a programmatic shim for proofs.
  searchIndex = buildSearchIndex({
    records,
    leafZones: leafZoneList,
    adm1Counts: ADM1_COUNTS,
    iso3Names: ISO3_NAME,
    countryNameMap,
  })
  if (typeof window !== 'undefined') {
    window.__UPG_SEARCH__ = {
      size: () => searchIndex.length,
      counts: () => {
        const c = { pg: 0, zone: 0, territory: 0 }
        for (const e of searchIndex) c[e.kind] = (c[e.kind] || 0) + 1
        return c
      },
      query: (q) => matchSearch(searchIndex, q, { limit: SEARCH_LIMIT }).map((e) => ({ label: e.label, kind: e.kind, target: e.target })),
      // drive a real select from the gate (PG / zone / territory) to prove fly-to.
      // Routes through the SAME flyToTarget the geocoder result handler uses.
      select: (q) => {
        const r = matchSearch(searchIndex, q, { limit: SEARCH_LIMIT })[0]
        if (!r) return null
        flyToTarget(r.target)
        return { label: r.label, kind: r.kind, target: r.target }
      },
      // P0 triage handles (LESSON-03): prove the geocoder feed reached the
      // dataStore AND the live localGeocoder closure matches it. Test-only.
      feedSize: () => {
        const s = dataStore && dataStore.sources && dataStore.sources[GEOCODER_SOURCE]
        return (s && Array.isArray(s.features) && s.features.length) || 0
      },
      localGeocoder: (q) => {
        const g = geocoderRef.value && geocoderRef.value.geocoder
        const fn = g && g.options && g.options.localGeocoder
        if (!fn) return null
        return fn(q).map((f) => f && f.place_name)
      },
    }
    // Mirrored per instance, same reason and shape as __UPG_MAPS__ (AUDIT34 card 9).
    _mySearchHandle = window.__UPG_SEARCH__
    ;(window.__UPG_SEARCHES__ ||= {})[testHandleKey()] = window.__UPG_SEARCH__
  }
}

// ── 09b-search-reuse-geocoder §1(c): the SHARED GeocoderComponent emits
// `people-group-result` for any selected row (our feed is all place_type
// 'people-group'). Branch on the synthetic `__upgKind` we threaded through the
// record → properties so the SAME fly handlers fire as the old dropdown:
//   no kind / 'pg' → flyTo + open detail   ·   zone → fitBounds   ·   terr → fitBounds.
// This mirrors research-map.vue:1410 (onGeocoderPeopleGroupResult) but keeps THIS
// profile's zone/territory targets (which the DOXA schema can't express).
function onGeocoderResult(feature) {
  const props = (feature && feature.properties) || {}
  const kind = props.__upgKind
  if (kind === 'zone') {
    flyToZone(props.__zoneId)
  } else if (kind === 'territory') {
    flyToTerritory(props.__shapeName)
  } else {
    // Real PG: fly to its point + open the shared PeopleGroupDetail (slice-13).
    const geom = feature && feature.geometry
    const c = geom && Array.isArray(geom.coordinates) ? geom.coordinates : null
    if (c && Number.isFinite(c[0]) && Number.isFinite(c[1]) && map) {
      map.flyTo({ center: [c[0], c[1]], zoom: 6, duration: 800 })
    }
    openPgDetail(props.slug)
  }
}

// AGGREGATE picks (country / language-family / language / dialect / religion).
// The shared geocoder searches ALL DOXA categories, not just this list's pins, so
// these arrive even though the profile's own feed only supplies PG/zone/territory.
// NOTE the payload is {kind,label,count,memberIds} — a plain object, NOT a GeoJSON
// feature — so it must not be routed into onGeocoderResult, which reads
// feature.properties/.geometry and would silently fall through to the PG branch.
//
// This profile is a CURATED 100-list, not the full research surface: it has no
// legend tab to swap and no aggregate polygons to outline. So the honest behaviour
// is to frame whichever of THIS list's pins belong to the picked aggregate, and do
// nothing when none do (rather than fake a match or blank the map).
function onGeocoderAggregate(agg) {
  if (!agg || !map) return
  const ids = new Set(agg.memberIds || [])
  if (!ids.size) return
  // Frame the pins of THIS list that belong to the picked aggregate. Reads the
  // live 'upg' source rather than a module-scoped copy — pinFeatures is local to
  // the loader closure, and querySourceFeatures is the canonical way to ask the
  // map what it currently holds.
  let members = []
  try {
    members = map.querySourceFeatures('upg').filter((f) => {
      const p = f.properties || {}
      return ids.has(p.slug) || ids.has(p.id) || ids.has(p.peopleGroupId)
    })
  } catch { return }                          // source not added yet — no-op
  if (!members.length) return                 // nothing of this list matched → leave the view alone
  let minX = 180, minY = 90, maxX = -180, maxY = -90, hit = false
  for (const f of members) {
    const c = f.geometry && f.geometry.coordinates
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue
    if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0]
    if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1]
    hit = true
  }
  if (hit) map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: 800, maxZoom: 6 })
}

// X (clear) — the spec's Bug 1: the geocoder's X emits but resets NOTHING, so the
// parent owns the reset. The old clone drifted into a partial reset that orphaned
// state; keep this one aligned with what THIS profile actually sets, namely the
// isolate filter and the detail panel.
function onGeocoderClear() {
  onLegendSelect(null)                        // canonical un-isolate (restores 26-zone tapestry)
  if (uiStore && typeof uiStore.selectPeopleGroup === 'function') {
    uiStore.selectPeopleGroup(null)           // close the detail panel / bottom-sheet card
  }
}

// Shared select path for the test handle — mirrors onGeocoderResult's routing by
// the headless target shape ({ type, slug/zoneId/shapeName }).
function flyToTarget(t) {
  if (!t || !map) return
  if (t.type === 'pg') {
    if (Number.isFinite(t.lng) && Number.isFinite(t.lat)) {
      map.flyTo({ center: [t.lng, t.lat], zoom: 6, duration: 800 })
    }
    openPgDetail(t.slug)
  } else if (t.type === 'zone') {
    flyToZone(t.zoneId)
  } else if (t.type === 'territory') {
    flyToTerritory(t.shapeName)
  }
}

// PG select → open the shared PeopleGroupDetail panel (S-D3). Reuses slice-13's
// selectedPG mechanism: find the live pin feature for this slug and hand it to
// uiStore.selectPeopleGroup (the SAME call attachPinHandlers makes on a pin click).
function openPgDetail(slug) {
  if (!slug || !uiStore || typeof uiStore.selectPeopleGroup !== 'function') return
  // ⚠ NOT `src._data.features` — THE TWO ENGINES STORE _data DIFFERENTLY, and the old read was
  // silently broken under MapLibre. Cited from both bundles, same constructor in each:
  //   mapbox-gl v3.24.0   this._data = i.data                                  (the raw value)
  //   maplibre-gl         this._data = "string"==typeof i.data ? {url:…} : {geojson: i.data}
  // So `._data.features` resolves under Mapbox and is UNDEFINED under MapLibre — whereupon `|| []`
  // made it an empty list, find() returned undefined, `if (f)` was false, and CLICKING A PIN OPENED
  // NOTHING with no error of any kind. Same defect class as sr's landed MapLibre source-read bug.
  // readSourceFeatures falls back to the public serialize(), which both engines expose.
  const feats = readSourceFeatures(map, 'upg')
  const f = feats.find((x) => x.properties && x.properties.slug === slug)
  if (f) uiStore.selectPeopleGroup(f)
}

// Zone fly-to: fitBounds of every tapestry feature whose zoneKey === zoneId. This
// is the SAME bounds path the legend-isolate uses (boundsFor), but it ONLY moves
// the camera — it does NOT re-filter the tapestry (search != isolate), so the
// shift-select / isolate / pin handlers are untouched (§1d).
function flyToZone(zoneId) {
  if (!zoneId || !map || !tapestry) return
  const b = boundsFor((f) => f.properties && f.properties.zoneKey === zoneId)
  if (b) map.fitBounds(b, { padding: 40, duration: 800, maxZoom: 6 })
}

// Territory fly-to: fitBounds of the admin (props.shapeName === name) OR country
// (props.iso3 === name) polygon. The territory target.shapeName holds an ADM1
// name OR an ISO3 — match either on the tapestry source so countries + admins
// both fly from one path. Camera-only (no source/filter edit).
function flyToTerritory(name) {
  if (!name || !map || !tapestry) return
  const b = boundsFor((f) => {
    const p = f.properties || {}
    return p.shapeName === name || p.iso3 === name
  })
  if (b) map.fitBounds(b, { padding: 40, duration: 800, maxZoom: 6 })
}

// 09b-search-reuse-geocoder §1(a): the keyboard nav (↑/↓/Enter/Esc) + clear are
// GONE — the SHARED GeocoderComponent / mapbox-gl-geocoder owns them now
// (built-in keyboard nav, clear-X, and mobile behavior). No hand-rolled handlers.

// Compute bounds of all features matching a predicate (no turf dep).
function boundsFor(pred) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90, hit = false
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      hit = true
      return
    }
    for (const c of coords) visit(c)
  }
  for (const f of tapestry.features) {
    if (pred(f)) visit(f.geometry.coordinates)
  }
  return hit ? [[minX, minY], [maxX, maxY]] : null
}

// ── §1e row-click ISOLATE (S04t-D5) ─────────────────────────────────────────
// The legend's `select` emits the clicked node (or null). A leaf has a zoneKey;
// a parent (asia / india / china) isolates the SET of its descendant leaves.
function descendantKeys(node) {
  const keys = new Set()
  const walk = (n) => {
    if (n.children && n.children.length) n.children.forEach(walk)
    else keys.add(n.zoneKey ?? n.id)
  }
  walk(node)
  return keys
}

let _isolatedNode = null                     // last isolated node, for re-apply after setStyle

// R1.2 D-6: when batch mode is ON, a legend row TOGGLES its zone(s) into the SAME
// selection union as the map territories (one mode, one union — supersedes the
// separate slice-06 mechanism). A leaf carries a zoneKey; a parent (asia/india/
// china) toggles the SET of its descendant leaves. Each descendant rides as kind
// 'zone' keyed 'zone:<zoneKey>' so selectionFilterExpr highlights every tapestry
// feature with that zoneKey. Returns true if it handled the select (batch mode).
function toggleZoneSelection(node) {
  const keys = [...descendantKeys(node)]
  if (!keys.length) return
  // node label for the clipboard name; per-zone count from the legend node when
  // the node IS a single leaf, else split each descendant leaf's own count.
  const leaves = []
  const walk = (n) => {
    if (n.children && n.children.length) n.children.forEach(walk)
    else leaves.push(n)
  }
  walk(node)
  // toggle semantics: if EVERY descendant zone is already selected, remove them
  // all (toggle OFF); otherwise add the missing ones (toggle ON).
  const sel = selectedTerritories.value
  const have = new Set(sel.filter((t) => t.kind === 'zone').map((t) => t.key))
  const allIn = leaves.every((l) => have.has('zone:' + (l.zoneKey ?? l.id)))
  if (allIn) {
    const drop = new Set(leaves.map((l) => 'zone:' + (l.zoneKey ?? l.id)))
    selectedTerritories.value = sel.filter((t) => !drop.has(t.key))
  } else {
    const add = leaves
      .filter((l) => !have.has('zone:' + (l.zoneKey ?? l.id)))
      .map((l) => ({
        key: 'zone:' + (l.zoneKey ?? l.id),
        name: l.label || l.id,
        count: Number(l.count) || 0,
        kind: 'zone',
      }))
    selectedTerritories.value = [...sel, ...add]
  }
  refreshSelectionPaint()
  copyFlash.value = ''
}

// ── R1.3 (j): mark EVERY legend row that is part of the batch union ──────────
// The shared SemanticTreeLegend is single-select (it paints one .selected row by
// its internal selectedId). In batch mode the operator picks 2+ rows, so the
// profile decorates the legend itself: a row is "batch-selected" when ALL of its
// descendant leaf zoneKeys are in the current union (the SAME allIn rule
// toggleZoneSelection uses to add/remove). We match a visible row to a legend
// node by the rendered label text (the row's .stl-name), walking legendNodes to
// resolve that node's descendant zoneKeys. Profile-side ONLY — we never edit the
// shared component; we just toggle a profile class on rows inside the shadow root.
function selectedZoneKeySet() {
  const s = new Set()
  for (const t of selectedTerritories.value) {
    if (t.kind === 'zone') s.add(t.key.slice(5)) // strip 'zone:' → bare zoneKey
  }
  return s
}
// label → descendant zoneKey set, built from the live legend tree.
function legendLabelDescendants() {
  const byLabel = new Map()
  const walk = (n) => {
    const keys = descendantKeys(n) // Set of leaf zoneKey ?? id
    if (n.label) byLabel.set(n.label, keys)
    if (n.children && n.children.length) n.children.forEach(walk)
  }
  for (const n of legendNodes.value) walk(n)
  return byLabel
}
function markLegendBatchRows() {
  // Resolve the legend host inside this profile's shadow root.
  if (typeof document === 'undefined') return
  const host = document.querySelector('my-upg-100-list-map')
  const root = (host && host.shadowRoot) || document
  const rows = root.querySelectorAll('.stl-row')
  if (!rows.length) return
  // R1.4 progressive disclosure (L4): the multi-row markers are batch chrome —
  // batch OFF clears EVERY marker, no matter what selection state is kept (D-7).
  // (Pre-R1.4 the markers stayed alive whenever any zone was selected, leaving
  // stale emerald rows fighting the single-select isolate chrome — the glitch.)
  if (!batchMode.value) {
    rows.forEach((r) => r.classList.remove('upg-batch-row'))
    return
  }
  const sel = selectedZoneKeySet()
  const byLabel = legendLabelDescendants()
  const dark = isDark.value
  rows.forEach((r) => {
    const nameEl = r.querySelector('.stl-name')
    const label = nameEl ? nameEl.textContent.trim() : ''
    const keys = label && byLabel.get(label)
    // a row is batch-selected when it has descendant zoneKeys AND every one of
    // them is in the union (matches toggleZoneSelection's allIn add/remove rule).
    const on = !!(keys && keys.size && [...keys].every((k) => sel.has(k)))
    r.classList.toggle('upg-batch-row', on)
    r.classList.toggle('dark', on && dark)
  })
}

// Re-mark whenever the union, batch mode, OR theme changes; also re-mark when the
// legend re-renders its rows (expand/collapse/sort/tab swap rebuild the row DOM,
// which would drop our profile class). A MutationObserver on the rows container
// re-applies the markers after every legend re-render. nextTick lets Vue flush the
// legend DOM before we query it.
let _legendRowObserver = null
function watchLegendRows() {
  if (typeof document === 'undefined' || _legendRowObserver) return
  const host = document.querySelector('my-upg-100-list-map')
  const root = (host && host.shadowRoot) || document
  const container = root.querySelector('.stl-rows')
  if (!container) return // legend not mounted yet; retried from onMounted poll
  _legendRowObserver = new MutationObserver(() => {
    // re-apply on the next frame so the row list has settled.
    requestAnimationFrame(() => markLegendBatchRows())
  })
  _legendRowObserver.observe(container, { childList: true, subtree: true })
}

// LegendMobile routes row taps through an INJECTED callback rather than an emit
// (it owns its SemanticTreeLegend internally, so there is no event to bind from
// here). Providing it wires the mobile sheet to the same handler the desktop
// legend's @select uses — without this, mobile rows render but tap dead.
provide('onSemanticTreeSelect', onLegendSelect)
// The SAME handler the desktop legend gets via @export. Provided rather than passed as a
// prop because <LegendMobile> renders several levels down inside the shell, which is also
// why onSemanticTreeSelect above is provided. Without this the mobile sheet rendered its
// SemanticTreeLegend with exportEnabled defaulting to FALSE, so a phone reader could browse
// the lists and had no way to print a packet or a poster — the half of this profile without
// which the map is not usable.
provide('onLegendExport', onLegendExport)
provide('legendExportCards', true)   // the card deck prints for the selected list

// ── LEGEND EXPORT (top-right of the legend titlebar) ────────────────────────
// The shared legend emits 'export' with 'poster' | 'packet' for the currently
// SELECTED node — the requirement: select one and its print options appear at
// the top right of the legend; without that the map is not usable.
//
// Poster serves the SAME pre-rendered artefact the poster wall downloads — one
// file, so the legend, the wall and the preview can never show three different
// things.
//
// ★ PACKET IS GENERATED IN THE BROWSER, ON CLICK — never shipped as an asset.
// One packet is ~3.5 MB (photos dominate); 28 zones would add ~100 MB to a repo
// that ALREADY had a publish blocked at a 74 MB asset tree. Generating on click
// costs zero repository bytes, and the photos come from URLs the records already
// carry. The requirement: instead of fetching the poster from
// the public folder, the client generates the poster in real time
// at the click, so it does not cost megabytes of storage.
//
// The pages themselves come from library/packet/packet-render.js — the SAME module
// the build-time generator uses, so the printed packet and the generated one cannot
// drift. The card asked for exactly that: reuse, do not grow a fourth print path.
// ★ PRINT STRAIGHT FROM THE MAP — without it the map is not usable.
// Select a UPG-100 list in the legend and its print options appear at the legend's top right.
//
// ⚠ THE POSTER PATH USED TO HAND-ROLL AN <a download> OF THE .webp, which was wrong twice:
// it SILENTLY DOWNLOADED a file (ruled out 2026-09-23 — "no silent file download as the
// default action"), and it had no fallback, so for the lists whose .webp is not shipped it
// saved a 404. The wall had a correct implementation the whole time; it was private to
// PosterWall.vue, so this surface could not reach it. It now lives in usePosterPrints
// (printPoster) and BOTH surfaces call the one copy — which is what the card asked for:
// "reuse the existing three print actions rather than growing a fourth implementation."
// ★ THE LEGEND'S EXPORT PATH GETS THE BUSY STATE TOO. The selection HUD's buttons were given one
// after a report that pressing them showed no sign of work; THIS surface — the legend's Export ▾ →
// Poster / Packet — had none either and was never looked at. It does the same slow work: two dynamic
// import()s, a map-SVG fetch, a funnel fetch, then a multi-sheet render. Found by sweeping for the
// CLASS of the reported bug rather than the instance, which is the whole point of doing that.
// `busyAction` is declared below, and that is safe: provide() at :1276 only passes the reference,
// and this body runs on a click long after setup has finished.
async function onLegendExport(kind) {
  const zoneId = selectedKey.value;
  if (!zoneId) return;                     // the button only shows with a selection
  // ★ THE KIND NOW CARRIES ITS VARIANT: 'packet:full' | 'packet:lightweight'. A bare 'packet' still
  // works and still means the full packet, so nothing that emits the old string breaks — the legend
  // WIDENED its existing event rather than adding a second one, because two events would let a
  // consumer handle half the menu and look fine.
  const [base, variant] = String(kind).split(':');
  // Guard re-entry the way the HUD does: a second click while a print is building would run two
  // renders over one print frame.
  if (batchBusy.value) return;
  batchBusy.value = true;
  busyAction.value = base === 'packet' ? 'packet' : base === 'cards' ? 'cards' : 'poster';
  try {
    if (base === 'packet') { await printPrayerPacket(zoneId, variant || 'full'); return; }
    // The legend selects by KEY, while the print actions label by item — hand over the zone
    // object so the print dialog's title says the list's name rather than its slug.
    // Same resolution printPrayerPacket uses, so both print actions name the list identically.
    const zone = printableZones().find((z) => z.id === zoneId) || { id: zoneId };
    // The card deck for the selected list: the same deck the poster wall prints, one card per group.
    // Only a PRINTABLE zone has a deck: a parent row (Asia, a region) carries no selector of its own, so
    // it returns quietly — the same call printPrayerPacket makes — rather than surfacing an evaluator error.
    if (base === 'cards') {
      const printable = printableZones().find((z) => z.id === zoneId);
      if (printable) await packetPrints.printCardDeck(await localizedZone(printable));
      return;
    }
    await packetPrints.printPoster(zone);
  } finally {
    // Cleared on EVERY exit path including the early `return` inside the try — a throw would
    // otherwise leave the surface permanently busy and the menu dead.
    batchBusy.value = false;
    busyAction.value = '';
  }
}

// Build and print a zone's prayer packet without leaving the page.
// PAGE ORDER IS THE PRODUCT SPEC: map · people groups 20/page with photos ·
// 12 prayer points · prayer wheel.
// ── THE PRAYER PACKET: the SHARED action ────────────────────────────────────
// This was a second hand-maintained copy of the packet print — its own renderer
// import, its own strings fetch, its own language resolution — beside the card
// deck's, which was consolidated first. Two copies of one fact drift.
//
// It now delegates to library/composables/usePosterPrints.js. What stays HERE is
// what genuinely cannot be shared: resolving which people groups are in a list
// (the people-groups API, the selector evaluator, and the pg_slugs special case
// that 12 of the 27 lists need), and where this bundle's posters are served from.
const packetPrints = usePosterPrints({
  // The print HUD's messages in the reader's language (vue-i18n's t takes the count for plurals).
  t: (key, params, n) => (typeof n === 'number' ? t(key, params, n) : t(key, params)),
  records: (zone) => packetRecords(zone),
  lang: () => packetLang(),
  label: (zone) => zone?.label || zone?.id || '',
  // Where THIS bundle serves its posters from. printPoster needs it to find
  // posters/<id>.webp and, when that is not shipped, posters/<id>.html to rasterise.
  // Resolved here rather than inside the shared action, which knows nothing about a
  // bundle's asset layout — the same seam printPacket uses for its map svg.
  assetsBase: () => resolveAssetsBase(profileConfig.value),
  // The table the zone sheets were labelled from, so the composable's page-1 lift names the countries
  // in the packet's language — the ONE lift path; this profile no longer keeps a second one of its own.
  iso3Names: () => ISO3_NAME,
  // The zone's sheet GENERATED at the click (zoneSheet, below) — for the Poster print and the packet's
  // page 1. An arrow, because zoneSheet is declared after this call (a direct reference is a TDZ throw).
  sheet: (item, format) => zoneSheet(item, format),
  // The near-neighbours table for the FULL packet's bounded/centered back page — fetched from the
  // SAME served asset pool the posters come from, so an embedded copy of this bundle prints the
  // same page as the dev tree. null on any failure: the packet prints without the page rather
  // than not printing.
  sets: () => fetch(`${resolveAssetsBase(profileConfig.value)}/tables/near-neighbors.json`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null),
  downloadPrefix: 'doxa-upg-100',
});

// ⚠ BRIDGE THE PROGRESS BACK TO THE SURFACE THIS MAP ACTUALLY SHOWS.
// The composable reports through its own exportState; this profile has no HUD for
// that and displays `status` instead. Without this watcher the packet would print
// SILENTLY — no "building…", and a failure would vanish with nothing said — which
// is the mechanism working while the feedback does not.
// ⚠ CLEARED BY IDENTITY, NOT BY READING THE PROSE. This used to clear the status when it matched /packet/i —
// true of the English message only. With the messages now translated (the print composable localizes them
// through `t`), that test would never match in ten languages and the status would stick. So the line this
// watcher wrote is remembered and cleared exactly — the same rule flashRef follows above.
let printStatus = ''
watch(packetPrints.exportState, (st) => {
  if (!st) { if (printStatus && status.value === printStatus) status.value = ''; printStatus = ''; hudProgress.value = ''; return; }
  if (st.phase === 'error') {
    printStatus = ''; hudProgress.value = '';
    hudSay(t('messages.packetFailed', { reason: st.message }), 5000);
    return;
  }
  printStatus = st.phase === 'done' ? '' : `${st.message}…`;
  status.value = printStatus;
  hudProgress.value = printStatus;
});

// BUNDLE-SPECIFIC: who is in this list. ⚠ pg_slugs BYPASSES the shared evaluator —
// it intentionally THROWS on that type, and 12 of the 27 lists use it. Same
// special-case the map and the poster wall apply, so all three agree about
// membership.
// ★ THE LIBRARY'S RECORDS PROVIDER (lists/peopleGroupRecords.js) — this was the THIRD hand-written copy
// of the same fetch (fields, list membership, normalisation, the pg_slugs case). Its fields already carry
// what the profile description needs (primary_language, imb_gsec) and the selector inputs (wagf_region,
// wagf_block, rop1); pg_slugs is understood by the provider and every other selector goes through this
// profile's evaluator. Sorted in the packet's language, as before.
const recordsFor = createPeopleGroupRecords({
  apiBase: () => API_BASE,
  lang: () => packetLang(),
  profileConfig,
  evaluate: (selector, records) => evaluateSelector(selector, records),
});
async function packetRecords(zone) {
  if (!API_BASE) throw keyedError('wall.hud.noApi', 'no people-groups service is configured');
  return recordsFor(zone.selector);
}
// The zone's sheet, generated at the click, for the legend's Poster and the packet's page 1.
const zoneSheet = makeZoneSheet({ allRecords: () => recordsFor.all(), assetsBase: () => resolveAssetsBase(profileConfig.value), profileConfig });

// BUNDLE-SPECIFIC: WHERE this bundle serves its map sheets. Which file to prefer and how to place it on
// page 1 are the renderer's (R.mapSheetFiles, R.liftMap): the map-only vertical sheet first, then the
// poster. Absent is fine — page 1 then says the map is missing rather than printing blank.
// ⚠ res.ok IS CHECKED. The old body read .text() on any response, so a 404 page was searched for an
// <svg> as if it were a poster.
// ⚠ A TRANSIENT STATUS CLEARS BY IDENTITY, NOT BY ITS ENGLISH PREFIX. Each of these messages used to be
// cleared by `if (status.value.startsWith('Packet failed'))` — a guard that reads the PROSE. The moment
// the prose is translated (the universal-props change, 2026-09-26) that guard stops matching and
// the status never clears in any non-English locale: a stuck error message, in ten languages, from a fix
// that looked purely cosmetic. Same family as counting prayer points by matching the English word
// "prayer". So compare against the exact string we set instead — locale-independent by construction.
function flashRef(target, text, ms) {
  target.value = text;
  setTimeout(() => { if (target.value === text) target.value = ''; }, ms);
}
const flashStatus = (text, ms) => flashRef(status, text, ms);
// ★ A BATCH ACTION SPEAKS WHERE A PHONE CAN SEE IT. .upg-status is display:none below 768px (the legend sheet owns
// the bottom edge there), so a message written only to it was invisible on a phone: a reader tapped Prayer List
// and nothing visible happened. hudSay writes the same text to the batch HUD's line (.upg-hud-flash, a polite
// live region, visible at every width) as well as to the status badge.
const hudSay = (text, ms) => { flashStatus(text, ms); flashRef(copyFlash, text, ms); };
// The print's progress ("fetching people groups…", "printing 905 people groups…"), mirrored into the HUD for the
// same reason; the HUD shows it whenever no flash is up.
const hudProgress = ref('');

// `variant` selects WHICH packet — 'full' (map, life calendar, %-evangelical grid, triangle,
// profiles, sets, points, wheel) or 'lightweight' (map, triangle, profiles, points, wheel).
// Defaults to 'full', so every caller that does not pass one prints exactly what it printed before.
async function printPrayerPacket(zoneId, variant = 'full') {
  const zone = printableZones().find((z) => z.id === zoneId);
  if (!zone) return;
  // ★ THE TITLE IN THE READER'S LANGUAGE, WHERE IT CAN BE GENERATED. A one-country zone's title is that
  // country's name, which Intl supplies in every language (zone-title.js tier A); every other zone keeps
  // its hand-written label, because a region's name is not a list of its countries. The title prints on
  // page 1, heads every profile page and names the document.
  // Page 1's map is the shared composable's: it lifts this zone's sheet (assetsBase) and names the
  // countries in the packet's language (iso3Names) — the same path the wall prints through.
  const titled = await localizedZone(zone);
  await packetPrints.printPacket(titled, { variant, funnel: await packetFunnel() });
}

// The zone as the packet should print it: a tier-A zone's generated title in the packet's language, or
// the zone unchanged. Loaded lazily, like the packet renderer, so the map pays nothing until a print.
async function localizedZone(zone) {
  try {
    const [{ zoneTitle }, { countryName }, strings] = await Promise.all([
      import('./data/zone-title.js'),
      import('@map/utils/countryName.js'),
      loadPacketStrings(resolveAssetsBase(profileConfig.value)),
    ]);
    // the packet's own strings for this language, English per key where a block lacks one — the same
    // fallback the renderer applies (an affinity-bloc zone such as Deaf is named from them)
    const block = { ...(strings.en || {}), ...(strings[packetLang()] || {}) };
    const title = zoneTitle(zone, block, { countryName, locale: packetLang() });
    return title ? { ...zone, label: title } : zone;
  } catch { return zone; }            // a title that cannot be generated keeps the hand-written one
}

// Every list across all three cluster buckets, flattened.
//
// ★ THE ONE SEAM THE `list` PROP WILL FEED. Decided 2026-09-26: UPG-100 is the mass
// prayer mobiliser — a GENERATOR that takes a list in and puts posters, packets and cards out, so a
// partner can generate their own. Every list-consuming path in this profile goes through THIS
// function (allLists -> selectedLists, printPrayerPacket, the legend, the funnel), so when the
// universal `list` prop lands (Tier A: profile-config.list / ?list= / window.MAP_LIST,
// default 'doxa') it replaces the body here and nothing else moves. Do not read `clusters` directly
// anywhere else; that is what makes the swap a one-line change instead of an audit.
// ★ AND THIS IS THAT SWAP, taken 2026-09-27 — the body, exactly as the note above predicted, with the
// static `clusters` import left untouched so its tree-shaking survives (zones-for-list.js keeps the named
// import for that reason). resolvePeopleGroupList reads config.list / ?list= / window.MAP_LIST, so a
// partner already choosing a LIST now also gets that list's ZONES.
// ⚠ RESOLVED PER CALL, NOT ONCE AT SETUP. `profileConfig` is injected at :126 — after the import block —
// so a module-level `const clusters = zonesForList(...)` throws on the temporal dead zone. It is also more
// correct per call: profileConfig is a ref a host can change, and the list can arrive later than setup.
// Cheap, because zonesForList is a registry lookup returning a shared object, not a build.
function listZones() {
  return zonesForList(resolvePeopleGroupList(profileConfig));
}

function allLists() {
  const z = listZones();
  return [...(z.lists || []), ...(z.asia_lists || []),
    ...(z.uncovered_lists || [])];
}

// Every zone a reader can PICK — the legend's leaves — as the object the print actions need.
//
// ★ allLists() IS 27 AND THE LEGEND IS 28. It spreads the three geographic buckets and cannot see
// `deaf`, which the legend shows as one row (the two deaf_lists collapse into a single affinity-bloc
// leaf). Every place that turned a picked id back into a zone went through allLists(), so Deaf was
// unreachable from all of them, silently: the Prayer packet returned on `if (!zone)`, the poster
// titled itself by its slug, a selection containing Deaf dropped it in `.filter(Boolean)`, and the
// packet count read 27 while 28 packets exist.
// The 27 keep EXACTLY the catalogue objects they had; only a leaf the catalogue lacks is added, as the
// legend's own leaf carrying its selector (legend-tree.js zonesWithSelectors). One enumeration for
// every pick, so the four sites cannot disagree about which zones exist.
function printableZones() {
  const base = allLists();
  const have = new Set(base.map((z) => z.id));
  return [...base, ...zonesWithSelectors(listZones(), { deafCount: DEAF_COUNT })
    .filter((z) => !have.has(z.id))];
}

// ── THE PAGE-2 FUNNEL CONTEXT ───────────────────────────────────────────────
// What the packet's funnel page needs that the packet itself cannot know: the nested IMB/network
// steps, how many lists the catalogue holds, and how many groups are in no list at all.
//
// ★ IT READS, IT DOES NOT COUNT. The four steps come verbatim from
// data/people-groups/vision-funnel.json, which build-vision-funnel.mjs generates from the IMB CSV
// and the live network list and which ALREADY drives the Vision Card. Re-deriving them here would
// give the same fact two sources that drift apart.
//
// ⚠ K AND THE UNASSIGNED COUNT ARE MEASURED FROM THE CATALOGUE AT CALL TIME, NEVER TYPED. Measured
// 2026-09-26: K = 27 (13 + 12 + 2 buckets) with per-list counts from 8 to 118, against a brief that
// said "~30 lists of 50-100" — only about half sit in that band, so no copy here claims it. The
// 27 lists account for 2,086 of the 2,107, leaving 21 in no list; the footnote states that plainly
// rather than letting a partner discover it by adding up rows.
// ⚠ IT IS LIST-AWARE, AND IT HAS TO BE — THIS WAS A LIVE WRONG NUMBER, not a future risk. This
// profile already honours the universal `list` prop: applyPeopleGroupList() filters the rows at all
// four fetch sites, including packetRecords (:1258), and the membership files are on disk. So under
// ?list=frontier-500k the packet's rows are the 71 DOXA groups that are Project 700 — while the
// funnel, which took its denominator from the last step of vision-funnel.json, printed
// "of the 2,107". Off by a factor of 30, with nothing on the page looking broken.
// Measured 2026-09-26 from data/people-groups/lists/*.json (counts.doxa, what a Tier A map shows):
//   frontier-500k  71 · frontier 1,745 · unengaged 1,929 · unreached 2,082 · doxa (default) 2,107
//
// ★ THREE NUMBERS WERE WRONG, NOT ONE, because all three were derived from DOXA's total:
//   listTotal  — the share's denominator;
//   unassigned — the footnote's "N are in no list", computed as listTotal minus the assigned sum;
//   listCount  — 27, which is a property of the UPG-100 ZONE CATALOGUE, not of the active list. The
//                zones partition DOXA; they do not partition frontier.
// So under a non-default list this states only what it can prove: the real total from the membership
// file, and NO listCount and NO unassigned — funnelPage omits the share line and the footnote rather
// than print a plausible wrong one. Half a fraction is not a fact.
async function packetFunnel() {
  try {
    const raw = (await import('../../data/people-groups/vision-funnel.json')).default;
    if (!raw || !Array.isArray(raw.steps) || !raw.steps.length) return null;

    const listId = resolvePeopleGroupList(profileConfig);
    const doxaTotal = Number(raw.steps[raw.steps.length - 1].groups) || 0;

    // THE DEFAULT LIST is the one the zone catalogue actually describes, so it is the only one that
    // can honestly claim "1 of K lists".
    //
    // ⚠ `unassigned` IS DELIBERATELY NOT SUPPLIED ANY MORE, and taking it out is the point. It printed
    // "21 of the 2,107 are not yet in any list", derived as doxaTotal minus the sum of the DECLARED
    // `count` fields — a claim about clusters.json's BOOKKEEPING, not about membership. Measured
    // 2026-09-26 while trying to verify it, and neither available figure survives:
    //   · resolving every selector against the packet records gives 418 in no geographic list, not 21;
    //   · but that cache carries only 12 fields (no wagf_region, no wagf_block), so 13 of the 27
    //     selectors cannot resolve against it at all, and deaf_predicate matches 0 of the 123 deaf
    //     records that ARE there.
    // Both numbers describe the FIXTURE, not the product. And the question is ill-posed besides:
    // clusters.json has FOUR buckets — the two deaf lists (61 + 62 groups) are excluded from
    // allLists(), and summing all 29 gives 2,209 against a total of 2,106, so the deaf lists OVERLAP
    // the geographic ones. They are a second, cross-cutting partition, which means "in no list" has no
    // single answer until someone says which partition is meant.
    // A confident figure that cannot be defended is exactly the defect class removed from other
    // surfaces; this one was introduced here. funnelPage already falls back to the
    // provenance-only footnote when unassigned is absent, so the page simply stops claiming it.
    // Carded as a product question: 27 geographic / 29 counting deaf, and whether "Central Asia + Pakistan"
    // (55 groups, contiguous, poster-walled as a real region) is a prayer list rather than a residual.
    if (listId === LIST_DEFAULT) {
      // printableZones, not allLists: the count prints on page 1 ("one of N") and at the triangle's
      // tip, and allLists() is 27 while the legend offers — and the generator builds — 28 packets.
      return { ...raw, listCount: printableZones().length, listTotal: doxaTotal };
    }

    // A NON-DEFAULT LIST: read its own DOXA-side total from the membership file the build writes.
    // counts.doxa is precisely "how many of this list DOXA carries", i.e. what a Tier A map shows.
    // If it cannot be read, the share line is omitted — the steps above it are still true.
    let listTotal = 0;
    try {
      const base = resolveAssetsBase(profileConfig.value);
      const res = await fetch(`${base}/people-groups/lists/${listId}.json`);
      if (res.ok) {
        const m = await res.json();
        listTotal = Number(m?.counts?.doxa) || (Array.isArray(m?.slugs) ? m.slugs.length : 0);
      }
    } catch (_) { /* leave listTotal 0 -> no share line */ }

    return { ...raw, listTotal, listId, listLabel: (listInfo(listId) || {}).label || listId };
  } catch (_) {
    // A missing funnel file omits page 2 rather than failing the packet — see buildPacket.
    return null;
  }
}

// ── BATCH SELECTION MAKES A PACKET OR A POSTER ──────────────────────────────
// The batch tool was reported very buggy, and recolouring regions is not what is wanted —
// the batch selection tool should let a reader create their own poster or prayer packet from
// their own selection. So the selection is an INPUT to the two artefacts this app already
// builds, and neither of these grows a third pipeline: both end in printPrayerPacket /
// packetPrints.printPoster, the same calls the legend and the poster wall make.
const batchBusy = ref(false);
// WHICH action is running: 'packet' | 'poster' | ''. Separate from batchBusy (which gates BOTH
// buttons against a double-run) so only the button the reader actually pressed changes its label —
// greying both and relabelling both would say the app is doing two things when it is doing one.
const busyAction = ref('');

// The zones behind the current selection. selectedTerritories holds 'zone:<id>' keys, and the
// list objects carry the selectors the packet needs; resolve back to those rather than
// re-deriving membership from the map, which would be a second source of truth.
function selectedLists() {
  // ⚠ SELECTION ORDER, NOT CATALOGUE ORDER. This used to be
  //     allLists().filter((l) => want.has(l.id))
  // which returns the lists in clusters.json order and silently DISCARDS the order the reader chose —
  // even though selectedTerritories is documented at :186 as "an ORDERED list … (insertion order)".
  // Measured (main 52eeb0db): selecting Laos, then West Africa,
  // then Europe produced a packet headed "West Africa + Laos + Europe", because west-africa is index 0
  // in the catalogue and laos is index 4. Reproduced exactly from the data.
  // It matters because the label's whole job is to "name the territories they actually chose rather than
  // inventing a title for their selection" (the comment on selectionAsList). A cover that reorders the
  // reader's own choices is inventing a title, quietly.
  const ids = selectedTerritories.value
    .filter((t) => t.kind === 'zone')
    .map((t) => String(t.key).replace(/^zone:/, ''));
  const byId = new Map(printableZones().map((l) => [l.id, l]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// A SYNTHETIC LIST standing for the whole selection, so every existing action works unchanged.
// ⚠ ITS SELECTOR IS A pg_slugs UNION, NOT A LIST OF SELECTORS. 12 of the 27 lists already use
// pg_slugs and the evaluator THROWS on that type, so the selection is resolved to concrete slugs
// HERE — once, against one fetch of the people-groups list — and handed on as the type every
// consumer already handles. Resolving per zone would refetch the whole catalogue per zone and
// still leave the caller to merge.
// The packet's own string block for the reader's locale, per-KEY fallback to English exactly as
// packet.mjs and packet-render do it — a half-translated block must not blank a key that en has.
// Not memoised here: loadPacketStrings caches a SUCCESS itself, and memoising the merged block would pin an
// English-only fallback (a transient fetch failure) for the rest of the session.
async function packetStrings() {
  const all = await loadPacketStrings(resolveAssetsBase(profileConfig.value));
  return { ...(all.en || {}), ...(all[packetLang()] || {}) };
}
/** `{a}` / `{b}` / `{n}` interpolation; null when the pattern is missing so the caller can default. */
function fillJoin(pattern, params) {
  if (!pattern) return null;
  return String(pattern).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

// ★ COUNTRIES SELECTED ON THE MAP RESOLVE TOO — they did not, which is why selecting countries
// and pressing Prayer list reported zero UPGs and refused to generate (reported 2026-09-28, mobile).
// selectedTerritories holds THREE kinds: 'zone' (a legend row), 'adm0' (a country tapped on the map,
// key 'adm0:<ISO3>') and 'adm1' (an India state / China province, key 'adm1:<name>'). selectedLists()
// keeps ONLY 'zone', so tapping countries produced an EMPTY list and selectionAsList threw
// 'nothing selected' — while the HUD, which sums t.count straight off the selection, cheerfully
// showed a correct non-zero total. TWO SOURCES OF TRUTH FOR ONE SELECTION is why it read as a
// nonsense error rather than an empty state: the app said 87 and the generator said zero.
// The adm0 key already carries the ISO3, which IS `country_code` on a people-group row, so a country
// selection becomes a country_codes selector the evaluator already handles. No new selector type.
function selectedCountryCodes() {
  return selectedTerritories.value
    .filter((t) => t.kind === 'adm0')
    .map((t) => String(t.key).replace(/^adm0:/, ''))
    .filter(Boolean);
}
// ⚠ ADM1 CANNOT RESOLVE, AND THAT IS A DATA FACT, NOT AN OVERSIGHT. A people-group row has
// country_code but no province field, so there is nothing to match an India state or Chinese
// province against — the evaluator has no adm1 case at all. Counting them silently into the country
// union would print a packet for the whole COUNTRY while the reader had selected one STATE, which is
// the "plausible packet that is quietly wrong" failure we keep finding. So they are reported, not
// absorbed.
function selectedAdm1Names() {
  return selectedTerritories.value
    .filter((t) => t.kind === 'adm1')
    .map((t) => t.name || String(t.key).replace(/^adm1:/, ''));
}

// ── THE SELECTION'S PEOPLE, detected ONCE for every action (packet, cards, Copy, Export CSV) ─────────
// The records load once per language and are CACHED: batch mode prefetches them when it turns on, so a
// Copy tap builds its text from cache and writes it inside the tap's user activation (a clipboard write
// after a network wait is refused, on phones above all). A failed load is dropped so the next try refetches.
let _selRecords = null;   // { lang, promise }
const RECORDS_TIMEOUT_MS = 30000;   // the people-group list: abort a request that has not answered by then
const COPY_WAIT_MS = 8000;          // Copy waits this long for the people groups, then copies the territories alone
// Any load failure without a catalogue key (the timeout's abort, a dropped network) reads as the stall does.
const stillLoading = () => keyedError('upgMap.peopleStillLoading', 'the people groups are still loading, try again in a moment');
const readerError = (e) => asReaderError(e, stillLoading);
function selectionRecordsLoad() {
  const lang = packetLang();
  if (_selRecords && _selRecords.lang === lang) return _selRecords.promise;
  if (!API_BASE) return Promise.reject(keyedError('wall.hud.noApi', 'no people-groups service is configured'));
  const fields = PRINT_FIELDS;   // the print standard's one field list (lists/peopleGroupRecords.js)
  // A STALLED request must not hold the cache forever: it aborts after RECORDS_TIMEOUT_MS, rejects, and the catch
  // below drops it, so the next action fetches again.
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), RECORDS_TIMEOUT_MS) : 0;
  const promise = (async () => {
    const resp = await fetch(`${API_BASE}/api/people-groups/list?fields=${fields}&lang=${lang}`, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .finally(() => clearTimeout(timer));
    if (!resp.ok) throw keyedError('wall.hud.fetchFailed', 'could not load the people groups ({status})', { status: resp.status });
    return normalizeRecords(await applyPeopleGroupList(extractRecords(await resp.json()), profileConfig));
  })().catch((e) => { throw readerError(e); });
  _selRecords = { lang, promise };
  promise.catch(() => { if (_selRecords && _selRecords.promise === promise) _selRecords = null; });
  return promise;
}

// { records, from: Map(slug → the selected territories that contain it), missing: adm1 names } in the
// SELECTION'S order: a zone's groups, then a country's, each record once. Territory names are the HUD's own
// (selectedTerritories[].name), the same names the clipboard's first line carries.
// ★ INDIA'S STATES AND UNION TERRITORIES resolve through the served table (data/people-groups/india-states.json,
// library/data/indiaStates.js), fetched only once a state is selected. Any other ADM1 (China's provinces) has no
// table yet, so it stays `missing` and is NAMED to the reader, never silently dropped.
function indiaStates() { return loadIndiaStates(resolveAssetsBase(profileConfig.value)); }
async function selectionPeople() {
  const lists = selectedLists();
  const codes = selectedCountryCodes();
  let adm1 = selectedAdm1Names();
  let india = null;
  if (adm1.length) {
    try { india = await indiaStates(); } catch (_) { india = null; }   // unreachable table: every state stays missing
    if (india) adm1 = adm1.filter((n) => !india.byShapeName.has(n));
  }
  const indiaCount = india ? selectedTerritories.value.filter((t) => t.kind === 'adm1' && india.byShapeName.has(t.name)).length : 0;
  if (!lists.length && !codes.length && !indiaCount) {
    // Name WHY when the only thing selected is a province — "nothing selected" would be a lie the
    // reader can see is false.
    if (adm1.length) throw keyedError('upgMap.selectionAdm1NoData', 'no people-group data for {names} — select the country instead', { names: formatList(adm1, { locale: packetLang() }) });
    throw keyedError('upgMap.nothingSelected', 'nothing is selected');
  }
  const records = await selectionRecordsLoad();
  const { evaluate } = await import('./data/selector-evaluator.js');
  const bySlug = new Map(records.map((r) => [r.slug, r]));
  const byId = new Map(printableZones().map((l) => [l.id, l]));
  const from = new Map();
  const add = (slug, name) => {
    const at = from.get(slug);
    if (!at) from.set(slug, [name]);
    else if (!at.includes(name)) at.push(name);
  };
  for (const t of selectedTerritories.value) {
    if (t.kind === 'zone') {
      const l = byId.get(String(t.key).replace(/^zone:/, ''));
      if (!l) continue;
      const slugs = l.selector && l.selector.type === 'pg_slugs' ? (l.selector.values || []) : evaluate(l.selector, records);
      for (const s of slugs) add(s, t.name);
    } else if (t.kind === 'adm0') {
      for (const s of evaluate({ type: 'country_codes', values: [String(t.key).replace(/^adm0:/, '')] }, records)) add(s, t.name);
    } else if (t.kind === 'adm1' && india) {
      const st = india.byShapeName.get(t.name);
      if (st) for (const s of st.slugs) add(s, t.name);
    }
  }
  return { records: [...from.keys()].map((s) => bySlug.get(s)).filter(Boolean), from, missing: adm1 };
}

async function selectionAsList() {
  const lists = selectedLists();
  const { from } = await selectionPeople();
  const zoneNames = (await Promise.all(lists.map(localizedZone))).map((l) => l.label || l.id);
  // Zones, countries AND the states that brought people (data/selection-export.js says why the states matter).
  const names = selectionTitleNames(zoneNames, selectedTerritories.value, from,
    () => keyedError('wall.hud.noRecords', 'that list has no people groups to print'));
  const S = await packetStrings();
  const join2 = (a, b) => fillJoin(S.zone_join, { a, b }) ?? `${a} + ${b}`;
  const label = names.length <= 3
    ? names.reduce(join2)
    : fillJoin(S.zone_join_more, { a: names.slice(0, 2).reduce(join2), n: names.length - 2 })
      ?? `${names.slice(0, 2).join(' + ')} +${names.length - 2} more`;
  return { id: 'selection', label, count: from.size,
    selector: { type: 'pg_slugs', values: [...from.keys()] } };
}

// ── COPY + EXPORT CSV (restored 2026-09-30; see data/selection-export.js for WHY and the formats) ────────
// COPY starts SYNCHRONOUSLY: the text is a promise handed to ClipboardItem, which Safari and Chrome accept
// inside the tap even when the people groups are still loading. Where that is refused it falls back to
// writeText, then to the textarea path. A selection whose people groups cannot be detected (a province)
// still copies the territory lines that data/apply-grouping.mjs needs, and the flash says what was left out.
function selectionNote(missing) {
  return missing && missing.length
    ? t('upgMap.selectionAdm1NoData', { names: formatList(missing, { locale: packetLang() }) }) : '';
}
function copySelection() {
  const sel = selectedTerritories.value;
  if (!sel.length) return;
  const color = selectedColor.value;
  let count = null, note = '';
  const STALLED = {};
  const text = settleWithin(selectionPeople(), COPY_WAIT_MS, STALLED).then((p) => {
    if (p === STALLED) { note = t('upgMap.peopleStillLoading'); return selectionClipboard(sel, { color }); }
    count = p.records.length; note = selectionNote(p.missing);
    return selectionClipboard(sel, { color }, selectionCsv(p.records, p.from, { color }));
  }, (e) => { note = errorText(readerError(e), t); return selectionClipboard(sel, { color }); });
  text.then((v) => { try { window.__UPG_LAST_CLIPBOARD__ = v } catch (_) {} });
  // A selection apply-grouping cannot regroup in one go (a mix of kinds, or a legend zone) still copies; the
  // flash says so, so a partner does not hand an agent a line it will refuse.
  const warn = regroupable(sel) ? '' : t('upgMap.copyNotRegroupable');
  writeClipboard(text).then((ok) => {
    const done = (count == null ? t('upgMap.copiedTerritoriesOnly', { reason: note.slice(0, 90) })
      : t('upgMap.copiedSelection', { count }) + (note ? ' · ' + note.slice(0, 90) : '')) + (warn ? ' · ' + warn : '');
    flashRef(copyFlash, ok ? done : t('messages.copyFailed'), ok && (note || warn) ? 6000 : 3000);
  });
}
async function writeClipboard(textPromise) {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (nav && nav.clipboard && nav.clipboard.write && typeof ClipboardItem !== 'undefined') {
    try {
      await nav.clipboard.write([new ClipboardItem({ 'text/plain': textPromise.then((v) => new Blob([v], { type: 'text/plain' })) })]);
      return true;
    } catch (_) { /* refused (e.g. no promise support): the next paths */ }
  }
  const text = await textPromise;
  try {
    if (nav && nav.clipboard && nav.clipboard.writeText) { await nav.clipboard.writeText(text); return true; }
  } catch (_) { /* no permission or no activation left: the textarea path */ }
  return legacyCopy(text);
}
// textarea + execCommand('copy'): a non-secure context has no navigator.clipboard at all.
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (_) { return false; }
}
// EXPORT CSV downloads the same CSV Copy carries. A UTF-8 byte-order mark leads the file so a spreadsheet
// reads the diacritics and non-Latin names as UTF-8 rather than guessing a legacy code page.
async function exportSelectionCsv() {
  if (batchBusy.value) return;
  batchBusy.value = true;
  busyAction.value = 'csv';
  try {
    const p = await selectionPeople();
    const color = selectedColor.value;
    const csv = selectionCsv(p.records, p.from, { color });
    try { window.__UPG_LAST_CSV__ = csv } catch (_) {}
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = selectionCsvFileName(selectedTerritories.value.map((x) => x.name).join(' '));
    a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 400);
    const note = selectionNote(p.missing);
    flashRef(copyFlash, t('upgMap.csvSaved', { count: p.records.length }) + (note ? ' · ' + note.slice(0, 90) : ''), note ? 6000 : 3000);
  } catch (e) {
    flashRef(copyFlash, t('upgMap.csvFailed', { reason: errorText(readerError(e), t).slice(0, 90) }), 5000);
  } finally { batchBusy.value = false; busyAction.value = ''; }
}

// A selection too big for a phone's print (data/selection-export.js has the measurement) starts nothing and says so.
// The same platform test the print path uses (isPhonePrint: a phone or tablet prints the page, with a phone's memory).
const ON_PHONE = isPhonePrint();
function phoneTooBig(count) {
  if (!overPhoneCeiling(count, ON_PHONE)) return false;
  hudSay(t('poster.phoneLimitAll'), 6000);
  return true;
}

async function makeSelectionPacket() {
  if (batchBusy.value) return;
  batchBusy.value = true;
  busyAction.value = 'packet';
  try {
    const sel = await selectionAsList();
    if (phoneTooBig(sel.count)) return;
    // The packet's map page is per-zone artwork; a multi-zone selection has no single poster to
    // lift it from, so it prints a cover WITHOUT the map rather than one zone's map standing in
    // for all of them. A packet with no sheet says so on page 1.
    const lists = selectedLists();
    // mapId: the one list's sheet stands in only when there IS one list; null means no sheet at all.
    const mapId = lists.length === 1 ? lists[0].id : null;
    // ⚠ "1 OF 27 LISTS" IS FALSE FOR A CUSTOM SELECTION — it is not one of the catalogue's lists at
    // all. The NARROWING is still true and still the point, and "N of the 2,107" stays exactly true
    // because N is the selection's own row count. So a multi-list selection keeps the funnel steps
    // and drops listCount, which funnelPage already treats as "omit the share line". Same judgement
    // the map above makes: print nothing rather than something that reads true and is not.
    const funnel = await packetFunnel();
    await packetPrints.printPacket({ ...sel, mapId }, {
      funnel: funnel && lists.length === 1 ? funnel : (funnel ? { ...funnel, listCount: 0 } : null),
    });
  } catch (e) {
    hudSay(t('messages.selectionPacketFailed', { reason: errorText(e, t).slice(0, 90) }), 5000);
  } finally { batchBusy.value = false; busyAction.value = ''; }
}

// The card deck for whatever is selected — the same people the selection's Prayer list prints (one card
// each), through the shared print standard.
async function makeSelectionCards() {
  if (batchBusy.value) return;
  batchBusy.value = true;
  busyAction.value = 'cards';
  try {
    const sel = await selectionAsList();
    if (phoneTooBig(sel.count)) return;
    await packetPrints.printCardDeck(sel);
  } catch (e) {
    hudSay(t('upgMap.selectionCardsFailed', { reason: errorText(e, t).slice(0, 90) }), 5000);
  } finally {
    batchBusy.value = false;
    busyAction.value = '';
  }
}

async function makeSelectionPoster() {
  if (batchBusy.value) return;
  batchBusy.value = true;
  busyAction.value = 'poster';
  try {
    const lists = selectedLists();
    // ⚠ A POSTER IS PRE-RENDERED ARTWORK PER ZONE, so unlike the packet a tapped COUNTRY has no
    // poster to print and never will — there is no file to fetch. Say that, rather than the
    // "nothing selected" this used to throw while the reader was looking at their own highlighted
    // selection on the map. The packet is the thing that works for a country selection, so point at it.
    if (!lists.length) {
      if (selectedCountryCodes().length || selectedAdm1Names().length) {
        throw keyedError('upgMap.selectionPosterNeedsZone', 'posters exist per territory on the legend — use Prayer list for a map selection');
      }
      throw keyedError('upgMap.nothingSelected', 'nothing is selected');
    }
    // ⚠ A POSTER IS PRE-RENDERED PER ZONE — there is no artwork for an arbitrary union, and
    // generating one would be the new pipeline the brief rules out. With one zone selected this
    // is exactly the wall's poster; with several, say so plainly instead of silently printing
    // the first zone's poster as though it covered the selection.
    if (lists.length > 1) {
      hudSay(t('messages.posterOneTerritory', { count: lists.length }), 5000);
      return;
    }
    if (phoneTooBig(lists[0].count)) return;
    await packetPrints.printPoster(lists[0]);
  } catch (e) {
    hudSay(t('messages.selectionPosterFailed', { reason: errorText(e, t).slice(0, 90) }), 5000);
  } finally { batchBusy.value = false; busyAction.value = ''; }
}

// The packet follows the app's locale so a reader gets it in their own language;
// packet-strings.json falls back PER KEY, so a half-finished translation renders
// its finished keys rather than blanking.
function packetLang() {
  // useI18n()'s locale can be a plain string or a ref depending on how the host
  // installed it, so normalise rather than assume.
  const l = packetLocale && (packetLocale.value ?? packetLocale);
  return (typeof l === 'string' && l) || 'en';
}

// ★ IT REPORTS WHETHER IT ACTED. Returns true when the selection was applied, false when it bailed.
//
// WHY: a silent `return` on a precondition is INDISTINGUISHABLE AT THE RENDERED LAYER from the
// request never arriving (2026-09-26). The "Show on map" interop bug had
// three layers stacked under one symptom — an element event with no replay, an id resolved against
// unloaded legendNodes, and THIS function no-op'ing on a missing layer — and each fix looked
// sufficient because all three produced the same nothing. Two were fixed by retaining the request;
// this one is the third, and it will grow a fourth layer for whoever comes next unless the applier
// says when it did not apply.
//
// ⚠ THE EARLY RETURN STAYS, and it stays SILENT of side effects — it is a documented readiness gate
// (see the comment at :630, "THE REAL READINESS SIGNAL"), and other code relies on it bailing rather
// than throwing or queueing. Returning a boolean is the smallest change that makes the bail
// OBSERVABLE without changing when it happens: a caller that cares can retain and retry, and the two
// callers that do not (paintAll's re-apply, the un-isolate at :945) are unaffected by a value they
// ignore.
function onLegendSelect(node) {
  if (!map || !map.getLayer('tapestry-fill')) return false
  // R1.2 D-6: in batch mode the legend feeds the selection union, NOT the isolate.
  // (node is non-null on a row tap; the legend emits null when a row is re-tapped
  // to deselect — in batch mode that null is a no-op, the union persists.)
  if (batchMode.value) {
    if (node) toggleZoneSelection(node)
    // TRUE: batch mode HANDLED the request — it fed the union, which is the correct behaviour here
    // rather than a failure to isolate. A caller retrying because it read `false` would toggle the
    // zone back OUT of the union, so this distinction is load-bearing, not cosmetic.
    return true
  }
  if (!node) {
    // restore the full 26-zone tapestry
    _isolatedNode = null
    selectedKey.value = null
    map.setFilter('tapestry-fill', null)
    map.setFilter('tapestry-line', null)
    // restore FULL opacity to match the new visible-dots baseline (BUG-UPG100-DOTS 2026-09-19)
    map.setPaintProperty('upg-pins', 'circle-opacity', 1)
    return true                                // the un-isolate IS the action; it succeeded
  }
  _isolatedNode = node
  const keys = [...descendantKeys(node)]
  selectedKey.value = keys.length === 1 ? keys[0] : (node.id ?? null)
  const inSet = ['in', ['get', 'zoneKey'], ['literal', keys]]
  map.setFilter('tapestry-fill', inSet)
  map.setFilter('tapestry-line', inSet)
  // dim pins outside the isolated zone(s)
  if (map.getLayer('upg-pins')) {
    map.setPaintProperty('upg-pins', 'circle-opacity',
      ['case', ['in', ['get', 'zoneKey'], ['literal', keys]], 0.95, 0.05])
  }
  const b = boundsFor((f) => keys.includes(f.properties.zoneKey))
  if (b) map.fitBounds(b, { padding: 40, duration: 700, maxZoom: 6 })
  // EXPLICIT, not an implicit undefined: the isolate was applied. An implicit fall-through returns
  // undefined, which is falsy, so a caller checking the result would read the SUCCESS path as a
  // failure and retry — the opposite of the bug this return value exists to expose.
  return true
}

// ── ONE paint entrypoint (P0 4188af3d / LESSON-03 L7+L10) ────────────────────
// BOTH the cold boot AND the post-setStyle theme re-add paint through THIS
// function. Two divergent paths was the L7 bug class: the toggle path worked,
// the boot path stranded. Every helper inside is idempotent (guards on
// getSource()/getLayer()), so over-calling is safe; under-calling is the bug.
function paintAll() {
  if (!map) return
  // ★ IT PAINTS WHAT IS READY, rather than refusing until everything is. The old guard was
  // `if (!map || !tapestry) return`, which meant the PINS could not be drawn until the boundaries had
  // been fetched AND parsed — and a baseline trace showed the parse, not the network, is the
  // 5.6-6.4 s cost. The pins need only the 68 KB records list. Every step below is idempotent and
  // guards its own source and layers, so calling this twice (once with pins only, once when the
  // tapestry lands) adds each thing exactly once.
  // ⚠ tapestry STAYS WHOLE-OR-NULL. This does not paint a partial tapestry; it simply does not block
  // the pins on one. boundsFor(), the search index and the telemetry keep their invariant.
  if (typeof addPinLayers === 'function') addPinLayers()
  if (!tapestry) return                        // territories not resolved yet — pins are up, come back
  ensureLayers()                               // tapestry fill + line
  // 09b shift-select: re-add the selection highlight layers + re-bind the
  // shift-click handler + re-apply the current selection paint so a user's
  // in-progress land division survives a dark/light toggle.
  ensureSelectionLayers()
  attachTapestrySelect()
  refreshSelectionPaint()
  // Re-apply the current isolation filter if a zone is isolated (setStyle drops
  // setFilter state along with the layers it was applied to). No-op at boot.
  if (selectedKey.value && map.getLayer('tapestry-fill')) {
    onLegendSelect(_isolatedNode)
  }
}

// ── light/dark toggle (ThemeToggleButton @toggle) ───────────────────────────
// map.setStyle() WIPES every custom source + layer, so after the basemap swaps
// we MUST re-paint everything inside the style.load callback — exactly what
// research-map does (research-map.vue:988-1008). setStyle ALWAYS re-fires
// 'style.load', so (unlike the boot path) once('style.load') is safe here.
function handleToggleTheme() {
  if (!map) return
  isDark.value = !isDark.value
  // 09b-9 legend-light-mode: drive the shared legend's theme off the basemap. The
  // legend reads instance.theme.value for its :data-theme, so keeping it in lock-step
  // with isDark makes the legend chrome follow light↔dark with the map underneath.
  pplrInstance.theme.value = isDark.value ? 'dark' : 'light'
  // ★ RESOLVE THE STYLE FOR THE ENGINE IN USE, as the boot path already does below. These two
  // were hardcoded mapbox:// URLs, which MapLibre cannot load at all — so the map booted fine
  // under ?provider=maplibre and then went blank the first time a reader touched the theme
  // toggle. The registry names the same INTENT for both engines: 'paper' is light (mapbox
  // light-v11 / OpenFreeMap positron), 'ink' is dark (dark-v11 / OpenFreeMap dark).
  //
  // Behaviour-preserving on Mapbox, and that is checkable rather than asserted: resolveNamedStyle
  // returns byte-identical URLs to the literals this replaces — 'paper' -> light-v11,
  // 'ink' -> dark-v11. Only the MapLibre branch changes, from an unloadable URL to a real one.
  //
  // The `||` fallbacks keep the old literals as a last resort if a name ever stops resolving,
  // matching the boot path's own guard rather than inventing a second policy.
  map.setStyle(isDark.value
    ? (resolveNamedStyle('ink', upgProvider).style || 'mapbox://styles/mapbox/dark-v11')
    : (resolveNamedStyle('paper', upgProvider).style || 'mapbox://styles/mapbox/light-v11'))
  map.once('style.load', paintAll)
}

// ── slice 13 §1b: pin-click → detail panel + hover cursor ────────────────────
// Factored into its own fn (called from addPinLayers, which runs on the initial
// draw AND on every post-setStyle theme re-add) so the click + cursor handlers
// survive a dark/light toggle. Click → uiStore.selectPeopleGroup(feature): the
// store stamps selectedPeopleGroup (the template v-if) and flips legendMode →
// 'detail'. The shared PeopleGroupDetail injects the same store, reads the
// feature's .properties, fetches /detail, and closes itself via
// selectPeopleGroup(null). useMapEvents.js:205-247 is the canonical pattern.
let _pinHandlersAttached = false
function attachPinHandlers() {
  // Bound to the invisible 'upg-pins-hit' twin, not the drawn 'upg-pins': the twin keeps the tap target
  // the dots had before they were drawn smaller at world zoom (see addPinLayers).
  if (!map || !map.getLayer('upg-pins-hit')) return
  // Mapbox keeps its own per-layer listener list; after setStyle the layer is a
  // fresh object so re-binding is correct. Guard only the cursor leak below.
  map.on('click', 'upg-pins-hit', (e) => {
    // ★ IN BATCH MODE A PIN TAP IS A TERRITORY TAP. The same tap also reaches the 'tapestry-fill' listener
    // (attachTapestrySelect), which toggles the territory under the finger. Opening the pin's detail sheet
    // as well covered the whole batch HUD on a phone (Copy, CSV and Clear hidden), and in a dense state
    // almost every tap lands on a pin. So batch mode opens no sheet; outside it, pins behave as before.
    if (batchMode.value) return
    const f = e && e.features && e.features[0]
    if (!f) return
    if (uiStore && typeof uiStore.selectPeopleGroup === 'function') {
      uiStore.selectPeopleGroup(f)   // opens panel (selectedPeopleGroup + legendMode='detail')
    }
  })
  map.on('mouseenter', 'upg-pins-hit', () => { if (map) map.getCanvas().style.cursor = batchMode.value ? 'crosshair' : 'pointer' })
  map.on('mouseleave', 'upg-pins-hit', () => { if (map) map.getCanvas().style.cursor = '' })
  _pinHandlersAttached = true
}

// ── CROSS-PANE SELECTION: "Show on map" from the poster wall ────────────────
// The wall dispatches a window event; the app-shell scrolls to this pane and
// re-dispatches 'doxa:select-zone' ON THIS ELEMENT. We listen here rather than
// on window so the shell decides which pane is the target — several embeds on
// one page therefore never cross-talk.
//   detail.listId = a zoneKey to select, or NULL to deselect.
let _selectZoneHandler = null;
// ★ A REQUEST THAT ARRIVES TOO EARLY IS NOW REMEMBERED, NOT DROPPED.
// Measured: the FIRST "Show on map" on a poster card did nothing, while a SECOND
// one after the map had loaded isolated the zone and fitted the camera. So the listener and the
// handler both work -- the first request simply died before this component was ready for it.
// There were two ways for it to die and the fix has to survive both, which is why it retains the
// request rather than trying to attach the listener sooner:
//   1. the listener is attached at the END of an async onMounted, after 5 awaits, and only
//      `if (host)` -- an element dispatch before that has no replay and is gone;
//   2. even once attached, the zone id is resolved against legendNodes, which is populated by the
//      data fetch. Before that, findLegendNode returns nothing and the old code did
//      `if (node) onLegendSelect(node)` with no else -- discarded silently, with no record that
//      anything had been asked for.
// Retaining covers both without depending on which one fired.
let _pendingZoneId;                     // undefined = nothing outstanding
let _selectZoneObserver = null;         // watches the retained `select-zone` attribute

/** The ONE apply path. Returns true when the request was satisfied (or was a deselect). */
// ★ THE APPLY REPORTS ITS OWN OUTCOME. A timeline proved delivery works (attribute written
// t=4106, and main already reads it at registration t=4763) and a headless test proved the lookup
// works (asia-india-rajasthan -> "Northwest India", 37 legend keys). So the failure is DOWNSTREAM of
// onLegendSelect and invisible: nothing throws, and "selected but not visibly selected" is
// indistinguishable at the rendered layer from "never selected". Writing the outcome onto the HOST
// makes it readable by an existing 50 ms poll, with no CDP and no new instrument.
// ★ NAMESPACED: the host element is SHARED SURFACE. A partner page
// embedding this custom element could reasonably own an attribute called `data-select-zone-state`,
// and a diagnostic has no business squatting a generic name on someone else's element. The
// data-doxa- prefix makes the owner obvious and the collision risk nil.
// Renamed AFTER a re-shoot rather than before, deliberately: the probe polls these names, and
// renaming mid-flight would have burned a measurement instead of costing a few minutes.
function _markZoneState(state, zoneId) {
  try {
    const h = mapEl.value?.getRootNode?.()?.host;
    if (!h) return;
    h.setAttribute('data-doxa-select-zone-state', state);
    if (zoneId) h.setAttribute('data-doxa-select-zone-applied', String(zoneId));
  } catch (_) { /* never let a diagnostic break the apply */ }
}

function applySelectZone(zoneId) {
  if (!zoneId) { onLegendSelect(null); _pendingZoneId = undefined; _markZoneState('cleared', ''); return true; }
  const node = findLegendNode(legendNodes.value, zoneId);
  if (!node) { _pendingZoneId = zoneId; _markZoneState('unresolved', zoneId); return false; }   // not ready -- REMEMBER it
  const applied = onLegendSelect(node);
  // selectedKey (:163, "currently isolated zoneKey (or null)") is this component's own record of the
  // isolation, so 'applied-but-no-selection' means the path was REACHED and its EFFECT lost -- a
  // different bug from delivery, and the one the timeline points at.
  // ★ I first wrote selectedZoneKey here, which does not exist; the try/catch would have swallowed
  // the ReferenceError and reported 'applied' every time. A diagnostic that cannot report failure is
  // worse than none. main's check:no-free-identifiers (6b05f513) now catches this class.
  // ★ IF THE EFFECT DID NOT TAKE, THE REQUEST IS STILL OUTSTANDING. A re-shoot on 27eed341
  // read exactly this state twice, 13 ms apart, with the right id -- so the node WAS found and
  // onLegendSelect WAS called, and the selection still did not hold. The cause is onLegendSelect's
  // own first line: `if (!map || !map.getLayer('tapestry-fill')) return`. It bails silently when the
  // map's tapestry layer is not up, which at t=4.9s it was not. So the readiness signal was never
  // legendNodes or mapRef -- it is THE LAYER, and the old code cleared _pendingZoneId here as though
  // the work were done. Keeping it means ensureLayers() can drain it the moment the layer exists.
  // ★ THE COMPATIBILITY FALLBACK IS GONE, and this is the promised cleanup rather than a change of
  // behaviour. onLegendSelect now returns an EXPLICIT boolean on all four of its paths — false when
  // the tapestry layer is not up, true for batch mode (it fed the union), true for the un-isolate
  // (the un-isolate IS the action) and true on success. So there is no path that yields undefined,
  // and the `typeof applied === 'boolean'` capability check it guarded can never fall through.
  //
  // WHY IT EXISTED AT ALL, kept as the reason not to reintroduce the inference: I used to read
  // !selectedKey.value as "it failed". That is a proxy for "did it ISOLATE", not for "did it work",
  // and the two differ in exactly the two paths above — batch mode and the un-isolate both leave
  // selectedKey unset while having succeeded. Retaining on that would have re-applied the zone and
  // toggled it back OUT of the selection union. That was caught before it bit anyone, and
  // the boolean was added so the applier could be ASKED instead of inferred from.
  if (!applied) { _pendingZoneId = zoneId; _markZoneState('applied-but-no-selection', zoneId); return false; }
  // ★ CLEAR THE RETAINED REQUEST ON SUCCESS. Every FAILING path above sets _pendingZoneId and the
  // no-op path clears it, but this one — the one that WORKED — left it set. So a request that was
  // retained once stayed outstanding forever, and ensureLayers()'s drain re-applied it on every later
  // call. For a zone already isolated that re-entry runs onLegendSelect again, which TOGGLES the
  // isolation back OFF: the reader sees "Show on map" select the zone and then silently lose it, which
  // is exactly the PRODUCTION-MATRIX symptom ("switches to the Map view but selects no zone").
  // The retain/drain machinery was right; the release was missing.
  _pendingZoneId = undefined;
  _markZoneState('applied', zoneId);
  return true;
}

function _onSelectZone(ev) {
  const zoneId = ev?.detail?.listId ?? null;
  // REUSE THE CANONICAL SELECT PATH. onLegendSelect(node) is what a legend row
  // tap and the search bar already call: it isolates the zone, DIMS everything
  // outside it, and fits the camera. "Show on map" should behave exactly as if
  // that result had been chosen in the search bar.
  //
  // Writing a second selection path here would have diverged from the legend and
  // the search bar the first time any of them changed — so this resolves the zone
  // to the SAME legend node object and hands it to the SAME function.
  // null => onLegendSelect(null), the canonical un-isolate that restores the full
  // tapestry. That is what makes the wall's green toggle honest.
  applySelectZone(zoneId);
}

// Depth-first lookup of a legend node by zoneKey/id. The tree is now grouped into
// regional sections, so the target is a CHILD of a section rather than top-level.
function findLegendNode(nodes, key) {
  for (const n of (nodes || [])) {
    if ((n.zoneKey || n.id) === key) return n;
    const hit = n.children && findLegendNode(n.children, key);
    if (hit) return hit;
  }
  return null;
}

// ★ A SHOWN ZONE CAN BE CLEARED FROM THE MAP ITSELF (2026-09-30, from a phone: after "Show on map" there
// was no way back). The only way out was re-tapping the same legend row, inside a collapsed sheet on a
// phone. While a zone is isolated (and batch mode is off), a chip names it with an × that restores every
// zone through the same path the wall's own deselect takes (applySelectZone(null)).
const shownZone = computed(() => {
  if (!selectedKey.value || batchMode.value) return null
  const n = findLegendNode(legendNodes.value, selectedKey.value)
  return (n && n.label) || String(selectedKey.value)
})
function clearShownZone() { applySelectZone(null) }


// P3-1: build the curated legend tree + wire each leaf's selector. Pure and
// synchronous — `clusters` is a static JSON import, so this needs no map, no token
// and no network, which is exactly why it must run before the map guards. Also
// seeds `leafZoneList` + `matchColorExpr`, which the map paint path consumes later
// (both are plain module-scope `let`s, so building them early is free).
// Idempotent: re-running it just rebuilds the same tree from the same static input.
function bootstrapLegend() {
  // ⚠ THE SAME ZONES allLists() USES, via listZones(), and this is the SECOND site — the note on
  // allLists promised the `list` swap would be "a one-line change instead of an audit" and that was not
  // quite true: this function reads the cluster buckets DIRECTLY to attach selectors. Left on the static
  // import it would have built the legend from UPG-100's zones while the list showed another list's, and
  // the two would disagree with nothing reporting it. Found by grepping for `clusters.` rather than by
  // trusting the convention comment.
  const z = listZones()
  const nodes = buildLegend(null)
  legendNodes.value = nodes
  leafZoneList = leafZones(nodes)
  const byId = {}
  for (const l of z.lists || []) byId[l.id] = l.selector
  for (const a of z.asia_lists || []) byId[a.id] = a.selector
  // slice 09b-6 §1a: the 7 Frontier-Asia uncovered zones (country_codes → ADM0).
  for (const u of z.uncovered_lists || []) byId[u.id] = u.selector
  byId['deaf'] = DEAF_SELECTOR
  for (const z of leafZoneList) z.selector = byId[z.id]
  matchColorExpr = buildMatchColorExpr(leafZoneList)
}

// P3-1: degraded-path enrichment. The legend's second column is `pop`, which only
// exists once the live records are folded in — a plain fetch with no map dependency.
// Called ONLY from the map-guard early returns, so the healthy path (which fetches
// the same records as part of its pipeline) never double-fetches.
// Fails soft on purpose: if the API is unreachable too, the counts-only legend built
// by bootstrapLegend() stays on screen rather than being torn down by a throw.
async function enrichLegendFromRecords() {
  if (!API_BASE) return
  try {
    const fields = 'slug,name,country_code,wagf_region,wagf_block,rop1,population,latitude,longitude'
    // ★ THE READER'S LANGUAGE. This was `&lang=en` while the two packet fetches above already used
    // packetLang(), and the records it builds are NOT internal bookkeeping: countryNameMap feeds
    // resolveTerritory(), so these names are what the reader sees on territory labels and in the
    // legend. Same defect as poster-wall.vue's card-3 fetch, one file over, found while fixing it.
    const resp = await fetch(`${API_BASE}/api/people-groups/list?fields=${fields}&lang=${packetLang()}`, { cache: 'no-store' })
    if (!resp.ok) throw new Error(`list ${resp.status}`)
    const records = normalizeRecords(await applyPeopleGroupList(extractRecords(await resp.json()), profileConfig))
    countryNameMap = buildCountryNameMap(records)
    legendNodes.value = buildLegend(records)
  } catch (_) { /* counts-only legend is the honest fallback; keep it rendered */ }
}

onMounted(async () => {
  // ── P3-1: NON-MAP UI FIRST, BEFORE ANY MAP GUARD ─────────────────────────────
  // The legend/list is CURATED data (clusters.json — a static import, line 67) and
  // needs no Mapbox instance, no token and no network. But it used to be built ~130
  // lines BELOW the `if (!gl) return` guard, so a missing/blocked mapbox-gl left
  // `legendNodes` at [] and BOTH legends failed their own `v-if="legendNodes.length"`.
  // With the toolbar/geocoder also (correctly) gated on `mapRef`, the whole surface
  // collapsed to ~10 nodes: an empty .upg-map over .upg-root's dark background, which
  // reads as "the app is broken" rather than "the map is unavailable" — and the user
  // lost the entire curated list, which never needed a map at all.
  //
  // NOTE the card named `v-if="mapRef"` as the sole gate. Measured, that is only half:
  // the legends are gated on `legendNodes.length`, NOT on mapRef, so unhiding the
  // mapRef subtree alone would still have rendered an EMPTY legend. The blank screen
  // needs BOTH the early return (data never built) and the mapRef gate (controls
  // hidden) to explain it. Sibling poster-wall.vue survives the same early return
  // precisely because its content does not depend on state onMounted populates.
  bootstrapLegend()
  // Load the engine the PROVIDER selects, not the one this file used to assume.
  try { await ensureEngineScript(upgProvider) } catch (_) { /* fall through to the !gl notice below */ }
  // ★ THE PANE MAY BE GONE BY NOW. Both shells (Posterverse, the Research Gallery) DESTROY a heavy pane on
  // deactivate, so a switch while the engine loads nulls mapEl, and `new gl.Map({ container: null })` threw
  // "Invalid type: 'container' must be a String or HTMLElement". An unmounted pane is normal, so return silently:
  // the same guard library/composables/useMapInstance.js keeps after every await (check:map-unmount-mid-init).
  if (!mapEl.value) return
  // ★ NEVER SWITCH ENGINES SILENTLY. This read `engineGlobal(upgProvider) || window.mapboxgl`, and that
  // fallback can ONLY fire when the requested provider is 'maplibre' and MapLibre failed to load —
  // engineGlobal already resolves mapbox's own global for the mapbox case (useMapInstance.js:115 falls back
  // to ENGINES.mapbox.global only for an UNKNOWN provider name, not for a missing engine). So the `||`
  // silently handed back MAPBOX to a page that asked for the KEYLESS engine, breaking the keyless contract
  // that research-map.instances.json documents.
  // ⚠ AND THE FALLBACK COULD NOT EVEN WORK: `gl.accessToken = token` a few lines below is gated on
  // `if (!isMaplibre)`, so a maplibre request that fell through to Mapbox would get Mapbox WITHOUT a token
  // — 401s on every tile instead of a legible failure. Two defects in one expression.
  // Found by a read of the regions map. Same shape in all three raw-map
  // plugins.
  const gl = engineGlobal(upgProvider)
  // ★ SHAPE RTL BASEMAP LABELS — HERE, not in index.js, and not after the map exists.
  // This profile builds its map RAW (`new gl.Map` below) instead of going through
  // useMapInstance, so it inherits none of the entry's side effects. It appeared to work only
  // because the leaf head PRELOADED the Mapbox peer, which made an entry-time registration land
  // in time; that preload is being removed, and with the engine injected lazily an index.js
  // call runs before `gl` exists and does nothing at all.
  //
  // ⚠ IT IS NOT A UI-LANGUAGE FEATURE, which is why it matters more than it looks. A basemap
  // draws each place in its OWN script, so over the Middle East, Iran and Israel MOST labels are
  // Arabic, Persian or Hebrew for EVERY viewer in EVERY UI language. Unshaped, they render
  // reversed — a WRONG NAME for exactly the groups this map is about — and it fails silently:
  // no error, no warning, just mirrored text that reads as a font problem to anyone who does not
  // know the script. Arab World and Persian-Median are both in scope here.
  //
  // Idempotent: Mapbox throws if the plugin is set twice in a session and the helper swallows it,
  // so this is safe alongside any other caller on the same page.
  if (gl) installRtlTextPlugin(gl)
  const token = mapboxToken?.value || profileConfig?.value?.tk || ''
  // Degraded exits: keep the terse telemetry in `status`, put the human-readable
  // notice in the MAP CELL, and still enrich the legend with live population data
  // (a plain fetch — it needs no map). The list stays fully usable without tiles.
  if (!gl) {
    // FAIL VISIBLY AND NAME THE ENGINE. The old copy said "The map engine" — true but undiagnosable:
    // a reader could not tell whether the keyless engine they asked for was even attempted. It now says
    // WHICH engine, so a partner who set ?provider=maplibre and sees "MapLibre did not load" knows their
    // request was honoured and the script is the problem, rather than suspecting a silent downgrade.
    // A console.warn too, because the on-screen notice is for the reader and this line is for whoever is
    // debugging the embed.
    console.warn(`[upg-100-list] ${upgProvider} engine global is missing — refusing to substitute another `
      + 'engine. A page that asked for the keyless engine must not silently receive the token-gated one.')
    status.value = `⚠ ${t('messages.engineNotLoaded')}`
    mapError.value = t('messages.engineNotLoadedDetail', { engine: isMaplibre ? 'MapLibre' : 'Mapbox' })
    enrichLegendFromRecords()
    return
  }
  // ★ A TOKEN IS A MAPBOX REQUIREMENT, NOT A MAP REQUIREMENT. This gate returned early whenever
  // there was no token, which under maplibre would have refused to draw a map that needs no
  // token at all — turning the keyless option into a blank cell. MapLibre skips it entirely.
  if (!isMaplibre) {
    if (!token) {
      status.value = `⚠ ${t('messages.noMapboxToken')}`
      mapError.value = t('messages.noMapboxTokenDetail')
      enrichLegendFromRecords()
      return
    }
    gl.accessToken = token
  }
  // P0 fix (LESSON-03 L4): mapbox-gl.css must live INSIDE the shadow root —
  // the host page's <link> cannot penetrate it. Without it the geocoder's
  // .mapboxgl-ctrl-top-left container is position:static and the search pill
  // renders in-flow BELOW the map instead of top-left above the legend. The
  // custom MapToolbar buttons never needed mapbox ctrl CSS, so this profile
  // skipped it until the shared GeocoderComponent (a real mapbox ctrl) arrived.
  // Mirrors src/composables/useMapInstance.js ensureMapboxCSS (idempotent).
  // ⚠ MAPBOX ONLY. This ran unconditionally, so a keyless maplibre embed still pulled a
  // stylesheet from api.mapbox.com — token-free and harmless to render, but wrong-engine
  // leakage on a page whose whole point is having no Mapbox dependency. It was the last
  // mapbox-under-maplibre reference in this profile, carried as a named exemption in the
  // maplibre-embed gate; guarding it lets that exemption be deleted and enforced instead.
  // MapLibre ships its own ctrl CSS via ensureEngineScript, so nothing is lost.
  // ★ THE LIBRARY'S ensureEngineCSS, NOT A HAND-ROLLED COPY (2026-09-27).
  // Mapbox logged "missing CSS declarations" on the BUILT leaf and in the gallery, and the
  // cause was this block, not a missing <link>:
  //   (a) it only ran when the map element was inside a ShadowRoot — `root instanceof ShadowRoot` — so on
  //       a standalone leaf, where the element is in LIGHT DOM, no stylesheet was ensured at all; and
  //   (b) even in the shadow case it FIRED AND FORGOT, so `new gl.Map` could run before the sheet parsed.
  //       Mapbox checks its declarations AT CONSTRUCTION, which is exactly when the warning appears.
  // ensureEngineCSS handles both DOM cases (light DOM returns early because the wrapper <link> covers it)
  // and AWAITS the load/error event with a 2s cap, so construction happens after the sheet is live.
  // ⚠ AND IT TAKES THE PROVIDER'S OWN URL rather than 'mapbox' hardcoded — the old line asked the registry
  // for mapbox's stylesheet even under MapLibre, guarded by !isMaplibre. Passing upgProvider means the
  // guard is unnecessary: a maplibre page gets maplibre's sheet (or none) and never touches
  // api.mapbox.com, which is the keyless contract the maplibre-embed gate enforces.
  // MEASURED as the difference from cities-internet, which does not warn: connectivity-map.vue:398-399
  // calls exactly this pair and this profile called neither.
  try {
    const css = engineStylesheetUrl(upgProvider)
    if (css) await ensureEngineCSS(mapEl.value, css)
  } catch (_) { /* a stylesheet must never stop the map painting */ }
  if (!mapEl.value) return   // gone while the stylesheet loaded (see the guard after ensureEngineScript)
  // The legacy shadow-root injection stays ONLY as the belt to that braces: ensureEngineCSS returns early
  // for light DOM on the assumption a wrapper <link> exists, and a partner embedding the custom element
  // directly may have no wrapper at all. Harmless when ensureEngineCSS already added the same href — both
  // paths check for it by href before inserting.
  try {
    const shadow = !isMaplibre && mapEl.value && mapEl.value.getRootNode()
    if (shadow instanceof ShadowRoot) {
      // ★ ASK THE REGISTRY FOR THE URL; DO NOT WRITE IT OUT AGAIN. This line used to hardcode
      // v3.3.0 while every production loader (generate-tree's baked <script>, useMapInstance,
      // generate-gallery) had moved to v3.24.0 — so the map ran NEW JS against OLD CSS.
      // MEASURED on the live leaf: mapboxgl.version 3.24.0, the only mapbox stylesheet reaching
      // the shadow root v3.3.0, .mapboxgl-canvas-container position:STATIC where Mapbox declares
      // it absolute, .mapboxgl-canary display:block, and 0 markers. A canvas container with no
      // positioning context leaves every absolutely-positioned child — the pins — with nothing to
      // anchor to. Reported: the map's polygons, colours and pins were not showing up.
      // The comment at the top of this file already says the engine loader is imported rather than
      // re-declared "because a second copy of one fact drifts"; the stylesheet URL was that second
      // copy, and it drifted.
      const MAPBOX_CSS = engineStylesheetUrl('mapbox')
      if (MAPBOX_CSS && !shadow.querySelector(`link[href="${MAPBOX_CSS}"]`)) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = MAPBOX_CSS
        shadow.prepend(link)
      }
    }
  } catch (_) { /* CSS injection is best-effort; map still works without it */ }
  map = new gl.Map({
    container: mapEl.value,
    // 'paper' is the registry's near-white minimal entry — mapbox light-v11 paired with
    // OpenFreeMap positron — so the two engines show the same intent instead of this file
    // hardcoding one engine's URL. Falls back to the literal if the name ever stops resolving.
    style: resolveNamedStyle('paper', upgProvider).style || 'mapbox://styles/mapbox/light-v11',
    center: [35, 20], zoom: 1.5, projection: 'mercator',
  })
  mapRef.value = map                         // expose the reactive instance to the controls

  // Wire the edge scroll strips. This profile builds its map RAW (new gl.Map)
  // instead of via useMapInstance, so nothing wires them for it — hence the
  // explicit call. The wrapper passed is the strips' PARENT (.upg-root), which is
  // what the composable queries; handing it the wrong ancestor is how simple-map's
  // strips ended up rendering-but-inert (F30).
  _detachEdges = useEdgeScrollAffordance(mapEl.value?.parentElement || null, {
    enabled: EDGE_SCROLL_AFFORDANCE.value,
  })
  // 09b-6 §1g: expose the map instance for the Playwright-Firefox visual gate so
  // it can assert tapestry fill features via map.queryRenderedFeatures (no visual
  // diffing — a reviewer eyeballs the PNGs). Test-only handle; harmless in prod.
  // ★ ALSO KEYED BY INSTANCE, because the bare handle is LAST-WRITER-WINS: embed two copies of this
  // map on one page and the second mount overwrites the first, so a gate driving "the" map silently
  // drives whichever happened to mount last (AUDIT34 card 9).
  // ⚠ THE BARE HANDLE IS KEPT AND STILL POINTS AT THE LAST MOUNT, deliberately. Every existing
  // consumer reads window.__UPG_MAP__ directly — internal/check-map-data-painted.mjs plus ~10 call
  // sites across data/visual-gate.mjs and data/palette-preview.mjs — and those are browser gates
  // that are not mine to rewrite. Removing it would break them to fix a case they never hit, since
  // a gate page mounts exactly one copy. The registry is ADDITIVE: a caller that knows which
  // instance it wants can ask for it; a caller that does not keeps today's behaviour.
  if (typeof window !== 'undefined') {
    window.__UPG_MAP__ = map
    _myMapHandle = map
    ;(window.__UPG_MAPS__ ||= {})[testHandleKey()] = map
  }

  // R1.2 PIVOT: NO keyboard listener (D-8 — modifier-key gestures removed for
  // mobile parity). Expose a tiny test handle so the firefox gate can drive batch
  // mode + the selection synthetically (the live map fires layer-scoped clicks the
  // gate replays) and read back the running total + the exact clipboard string.
  window.__UPG_SELECT__ = {
    get list() { return selectedTerritories.value.map((t) => ({ ...t })) },
    get total() { return selTotal.value },
    get count() { return selCount.value },
    get color() { return selectedColor.value },                 // R1.1 gate probe
    get batchMode() { return batchMode.value },                 // R1.2 gate probe
    setColor: (c) => setSelectionColor(c),                      // R1.1 gate hook
    // R1.2 (f′): let the gate ENTER batch mode without a real button tap, then
    // replay plain (no-modifier) clicks to prove the button-driven gesture works.
    setBatchMode: (on) => setBatchMode(on),
    clipboardText: () => formatClipboard(selectedTerritories.value, { color: selectedColor.value }),
    clear: () => clearSelection(),
    // resolve+toggle a feature's properties exactly as a plain batch-mode tap
    // would, for deterministic headless proof (the gate also replays a real map
    // click event — no shiftKey).
    toggleByProps: (props) => {
      const t = resolveTerritory(props, { nameMap: countryNameMap })
      if (!t) return null
      toggleTerritory(t)
      return { ...t }
    },
    // ── R1.3 (f″) gate test handles ────────────────────────────────────────────────
    // Toggle a LEGEND ROW by its visible label exactly as a batch-mode legend tap
    // would — resolves the label to its legend node, then routes through
    // toggleZoneSelection (the SAME union path a real row tap uses). Returns the
    // node's descendant zoneKeys (count) so the gate can recompute the expected
    // map-highlight feature count independently.
    // ⚠ THIS IS THE BATCH-UNION TEST HANDLE, NOT A CLICK SIMULATOR — it calls toggleZoneSelection() directly,
    // so OUTSIDE batch mode it toggles a union nobody is displaying and the isolate filter stays
    // undefined. Measured exactly that, which raised whether it should isolate for a
    // single select.
    // IT SHOULD NOT, and widening it would be worse than the narrowness. A REAL click goes through
    // onLegendSelect(), which branches on batchMode — isolate when off, feed the union when on. If this
    // handle isolated on its own it would no longer EXERCISE that branch, and a gate built on it could go
    // green while the real click path was broken. A test handle that does more than the UI hides the UI.
    // So: use a real click to test isolation (the row-45 test A does, and it passes), and use this only
    // to drive batch selection. The name says Toggle, and toggling the union is what it does.
    toggleLegendRow: (label) => {
      const find = (nodes) => {
        for (const n of nodes) {
          if (n.label === label || n.id === label) return n
          if (n.children && n.children.length) {
            const hit = find(n.children); if (hit) return hit
          }
        }
        return null
      }
      const node = find(legendNodes.value)
      if (!node) return null
      toggleZoneSelection(node)
      return { label: node.label, zoneKeys: [...descendantKeys(node)] }
    },
    // The set of legend-row labels currently carrying the profile multi-select
    // class (.upg-batch-row) — lets the gate assert BOTH rows read as selected at
    // once (the headline R1.3 (j) acceptance), reading the live DOM not a number.
    markedLegendRows: () => {
      if (typeof document === 'undefined') return []
      const h = document.querySelector('my-upg-100-list-map')
      const r = (h && h.shadowRoot) || document
      return [...r.querySelectorAll('.stl-row.upg-batch-row .stl-name')].map((e) => e.textContent.trim())
    },
    // Count tapestry features the map highlight (upg-sel-fill) currently matches —
    // the union A∪B size the gate compares against the independent Node Σ of rows.
    highlightFeatureCount: () => {
      if (!map || !tapestry || !map.getLayer('upg-sel-fill')) return -1
      const sel = new Set()
      const adm1 = new Set(), adm0 = new Set()
      for (const t of selectedTerritories.value) {
        if (t.kind === 'zone') sel.add(t.key.slice(5))
        else if (t.kind === 'adm1') adm1.add(t.name)
        else if (t.kind === 'adm0') adm0.add(t.key.slice(5))
      }
      let n = 0
      for (const f of tapestry.features) {
        const p = f.properties || {}
        if (sel.has(p.zoneKey) || adm1.has(p.shapeName) || adm0.has(p.iso3)) n++
      }
      return n
    },
    // expose the resolved zoneKeys for a legend label (independent Σ helper).
    zoneKeysForRow: (label) => {
      const find = (nodes) => {
        for (const n of nodes) {
          if (n.label === label || n.id === label) return n
          if (n.children && n.children.length) { const h = find(n.children); if (h) return h }
        }
        return null
      }
      const node = find(legendNodes.value)
      return node ? [...descendantKeys(node)] : null
    },
  }
  // Mirrored per instance, same reason and same additive shape as __UPG_MAPS__ above.
  _mySelectHandle = window.__UPG_SELECT__
  ;(window.__UPG_SELECTS__ ||= {})[testHandleKey()] = window.__UPG_SELECT__

  // Legend tree + selectors are already built (bootstrapLegend() at the top of
  // onMounted, before the map guards — P3-1). Nothing to do here.

  try {
    // ── FETCH the heavy geojson at runtime — do NOT import() it ──────────────
    // These three files are 3.8 MB of boundary coordinates. They were written as
    // dynamic import()s on the reasoning that this "keeps the payload out of the
    // synchronous module-init path" — but the production build is a single-file
    // IIFE with `inlineDynamicImports: true`, so EVERY dynamic import is inlined.
    // Measured: 2.74 MB of the 4.18 MB bundle (66%) was raw coordinate floats.
    // This is the same trap vite.config already documents for jspdf.
    //
    // A real fetch keeps them out of the bundle entirely: the shell, the view
    // tabs and the poster wall become interactive immediately, and the boundaries
    // stream in afterwards while the user can already navigate. They also become
    // HTTP-cacheable, which an inlined payload never is.
    status.value = t('messages.loadingBoundaries')
    const boundaryUrl = (f) => `${resolveAssetsBase(profileConfig.value)}/boundaries/${f}`
    const getJSON = (f) => fetch(boundaryUrl(f)).then((r) => {
      if (!r.ok) throw new Error(`boundary fetch ${r.status} ${f}`)
      return r.json()
    })

    // ★ THE API REQUEST IS ISSUED NOW, NOT AFTER THE BOUNDARIES. Measured 2026-09-26: this chain was
    // strictly serial — `await Promise.all([3 boundaries])` and only THEN `await fetch(API)` — so
    // 3,549 KB of geojson (world-adm0 1,866 + gb-IND-ADM1 1,628 + gb-CHN-ADM1 54) had to download AND
    // JSON.parse before the API request was even sent. The first paint measured 9.5-16.5 s.
    // Starting the fetch here overlaps the two; nothing below needs the boundaries to BUILD the URL.
    // ⚠ NOT awaited here — the promise is created and awaited further down, so a rejection surfaces at
    // the same place in the same try/catch as before. Creating it early changes WHEN the request goes
    // out, not where its failure lands.
    if (!API_BASE) {
      // Fail closed — no data host configured (window.MAP_APP_API_URL / VITE_API_BASE_URL).
      throw new Error('No API base configured — set window.MAP_APP_API_URL or VITE_API_BASE_URL. Failing closed (no default host).')
    }
    const _fields = 'slug,name,country_code,wagf_region,wagf_block,rop1,population,latitude,longitude'
    // ⚠ NO `cache: 'no-store'`. It forced a full re-download of ~870 KB on every reload, including a
    // hard refresh during development, and this list changes on the order of days — not within a
    // session. The default HTTP cache honours whatever the API's own headers say, which is the
    // server's call to make rather than this client's. A reader who needs today's data gets it from
    // the API's cache headers; a reader reloading a page gets an instant map.
    // ★ THE READER'S LANGUAGE (card 3, 2026-09-28). This is the MAIN records fetch — the rows it
    // returns become the pins, their popups and the list, so `&lang=en` here meant the map's own
    // people-group names stayed English under ?lang=ar while the interface around them mirrored
    // and translated. The three fetches in this file now all read packetLang().
    const recordsPromise = fetch(`${API_BASE}/api/people-groups/list?fields=${_fields}&lang=${packetLang()}`)
      .then((r) => { if (!r.ok) throw new Error(`list ${r.status}`); return r.json() })

    // ★ ALL THREE BOUNDARY DOWNLOADS START HERE and none is awaited yet. They are held as promises so
    // the records (68 KB) can be awaited first and the PINS drawn while these 3.6 MB are still being
    // fetched and — the real cost — parsed by MapLibre's workers.
    // ⚠ CREATED BEFORE ANY await, NOT AFTER. An earlier version put one of these under a Promise.all
    // and it overlapped nothing: a promise created after an await starts only once that await
    // resolves, so the code read as parallel and behaved strictly serially.
    const boundaryPromises = {
      adm0: getJSON('world-adm0-web.geojson'),
      adm1Chn: getJSON('gb-CHN-ADM1.geojson'),
      // 1,628 KB, and only the India pg_slugs zones need it.
      adm1Ind: getJSON('gb-IND-ADM1-web.geojson'),
    }

    // ── live records WITH rop1 + population (full record; LESSON L3 / slice 04u) ──
    // population resolves the deaf A017 row AND the legend's second column; one
    // full fetch, no per-slice field subsets.
    //
    // ★ THE RECORDS ARE AWAITED BEFORE THE BOUNDARIES, so the pins can be drawn while MapLibre is still
    // parsing 3.6 MB of GeoJSON. A baseline trace (main ccc2b1bb, tokenless MapLibre, software
    // GL) overturned an earlier profile: every key byte arrives by 1.2-2.9 s, but the first
    // territory draws 5.6-6.4 s LATER, and only ~2.6 s of that gap is main-thread long tasks. The rest
    // is MapLibre's WORKERS parsing and tiling the boundaries. I had profiled file sizes and request
    // order — the artifact — and concluded the download was the cost; on localhost those 3.6 MB arrive
    // in ~230 ms. Reordering requests was never going to reach 3 s because PARSING is the bottleneck.
    // The pins need none of it: they are built from `records` (lat/lng) and slugToZone, and the
    // selector evaluate() at the pin build maps slugs to zone keys without touching any geometry.
    // 68 KB, arriving at ~2.9 s cold.
    status.value = countInSentence(t, 'messages.fetchingUupgs', upgTotal(visionFunnel), packetLang())   // the funnel's total, never a literal
    const records = normalizeRecords(await applyPeopleGroupList(extractRecords(await recordsPromise), profileConfig))
    // 09b shift-select §1(b): build iso3→display-name from the LIVE records so an
    // ADM0 country click resolves to the exact label the legend shows (the ADM0
    // geojson features carry only iso3 — no name). Falls back to ISO3_NAME inside
    // the resolver for any iso3 the records don't cover.
    countryNameMap = buildCountryNameMap(records)

    // Re-shape the legend tree WITH records so every node carries `pop` (slice
    // 04u §1b). Selectors/colors/counts are unchanged; only `pop` is added.
    legendNodes.value = buildLegend(records)


    // ── pins layer (kept from 04b, now stamped with zoneKey for isolate dim) ──
    // build slug→zoneKey using the same selectors (first match wins; regional before asia)
    const pinFeatures = []
    const slugToZone = {}
    const { evaluate } = await import('./data/selector-evaluator.js')
    // BUG-A FIX (§1a): the Asia rows carry a `pg_slugs` selector the evaluator
    // intentionally THROWS on. The old loop called evaluate() on every zone, so the
    // first Asia zone threw → the whole pin build aborted in the catch → zero pins.
    // Mirror legend-tree.js:60-66: special-case pg_slugs (slug ∈ selector.values)
    // BEFORE evaluate(), and wrap each zone so one bad selector can never abort all pins.
    for (const z of leafZoneList) {
      if (z.selector && z.selector.type === 'pg_slugs') {
        for (const s of (z.selector.values || [])) if (!(s in slugToZone)) slugToZone[s] = z.zoneKey
      } else {
        try {
          for (const s of evaluate(z.selector, records)) if (!(s in slugToZone)) slugToZone[s] = z.zoneKey
        } catch (e) {
          console.warn('zone selector skipped', z.id, e && e.message)
        }
      }
    }
    for (const r of records) {
      const lat = Number(r.latitude), lng = Number(r.longitude)
      if (!isFinite(lat) || !isFinite(lng)) continue
      // slice 13 §1d / D-3: stamp the fields PeopleGroupDetail reads off the
      // FEATURE properties so the panel header + Country/Population rows render
      // INSTANTLY on click, before the /detail fetch resolves:
      //   • name        → header + name-lead   (.properties.name)
      //   • slug        → detail fetch key + pray/adopt links (.properties.slug)
      //   • population  → "Population" stat     (.properties.population)
      //   • countryName → "Country" stat        (countryName is the unified label
      //                    the component prefers; normalize.js exposes the decoded
      //                    label under country_code_label, value under country_code)
      //   • country     → fallback country value (.properties.country)
      // language/religion are NOT in the /list fetch — the component shows '—'
      // for those until the /detail fetch (which DOES return them) resolves; the
      // component's computeds read religion/language off feature props only, so
      // those two stay em-dash here (acceptable per the QA em-dash fallback).
      pinFeatures.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          slug: r.slug,
          zoneKey: slugToZone[r.slug] || '',
          name: r.name || r.slug || '',
          population: r.population ?? 0,
          countryName: r.country_code_label || '',
          country: r.country_code || '',
        },
      })
    }
    const pinFC = markRaw({ type: 'FeatureCollection', features: pinFeatures })

    // Pin layer add, factored out so BOTH the initial draw() and the post-setStyle
    // theme re-add (handleToggleTheme) can call it. Idempotent: guards getSource('upg').
    addPinLayers = () => {
      // ⚠ SAME BUG, SAME FIX as ensureLayers():606 — guard on the LAYER, not only the source. The old
      // `if (map.getSource('upg')) return` adds nothing whenever the source survives a style reload
      // while 'upg-pins' does not. NOT the cause of the blank English README shot (that was a 7 s
      // screenshot wait against a 9.5-16.5 s first paint — measured); this is the
      // setStyle/theme-toggle path, where the re-add is real and could silently no-op.
      if (map.getSource('upg') && map.getLayer('upg-pins') && map.getLayer('upg-pins-hit')) return
      if (!map.getSource('upg')) map.addSource('upg', { type: 'geojson', data: pinFC })
      if (!map.getLayer('upg-pins')) map.addLayer({
        id: 'upg-pins', type: 'circle', source: 'upg', paint: {
          // BUG-UPG100-DOTS-HARD-TO-SEE (2026-09-19): the previous floor (2.5px @ low zoom,
          // 0.6px semi-transparent WHITE stroke) was still hard to see — a translucent white
          // halo disappears on a LIGHT basemap. Fix, in three parts: a larger radius floor
          // (2.5 -> 4px at zoom 1), a SOLID DARK stroke halo that reads on both light and dark
          // basemaps, and full fill opacity.
          // A mapbox circle layer has ONE stroke, so the halo IS the whole outline — there is
          // no inner ring. (This comment used to claim "a thin white inner ring"; no such
          // property was ever added, and a reader who believed it would go looking for a
          // second layer that does not exist. Verified live 2026-09-21: the map reports
          // stroke-color rgba(15,20,25,0.9), opacity 1, stroke-width 1.2->2 across zoom.)
          // ★ ENLARGED AT LOW ZOOM (BUG-UPG100-DOTS-HARD-TO-SEE). Was 1,4 -> 4,6 -> 8,9.
          // THE ASYMMETRY THAT MAKES THIS LIST DIFFERENT: all-people-groups draws ~12,379 dots, so
          // small marks are correct there — density itself carries the signal, and a big dot would
          // merge into a blob. This map draws ONE HUNDRED. At world zoom those 100 marks are alone
          // on a whole planet, so the same 4px radius that reads as dense there reads as almost
          // nothing here. Sized for the count, not copied from the sibling: 6px at z=1 (+50%),
          // tapering back to the original 9px by z=8, where geography supplies the context and the
          // dots no longer need to carry it alone.
          // ★ REVERTED TOWARD THE SIBLINGS (2026-09-23: the dots were far too big, larger than
          // the dots on most of the other maps, and nobody had asked for that size).
          // That report is right and this was my overcorrection: an earlier pass raised z=1 from 4 to 6 to fix
          // "hard to see", reasoning that 100 marks alone on a planet need more presence than
          // all-people-groups' 12,379. The reasoning was sound but the amount was not — at 6 this map
          // became the LARGEST of the set (all-people-groups is 2.2 at z=0, 3.4 at z=4), so it read as
          // wrong rather than as emphasised. 5 keeps a deliberate step above the dense map without
          // breaking the family; the halo below is what actually carries visibility at world zoom.
          // ★ SMALL WHEN ZOOMED OUT, AS THE REST OF THE FAMILY (2026-09-30: on a phone at world zoom the
          // pins read as far too large). The reasoning above counted ONE HUNDRED dots; this
          // map draws every group of every list, 2,107 of them (the status line says so). The ramp's
          // first stop was z=1, and MapLibre clamps below the first stop, so a phone's whole-world view
          // (z ≈ 0.5-1.2) drew 2,107 dots at the full 5 px + a 1.8 px halo (≈ 14 px across): India
          // and Africa became solid blobs. Now it starts at z=0, between all-people-groups (2.2) and
          // the library's standard ramp (3), and grows back to the SAME 9 px by z=8, so a zoomed-in
          // view is unchanged: ≈ 7.6 px across at a phone's world view, about a third of the area.
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2.6, 2, 3.2, 4, 4.5, 6, 6.5, 8, 9],
          'circle-color': matchColorExpr, 'circle-opacity': 1,
          // Solid dark outer halo = the visibility win (frames every dot on any basemap).
          // Widened in step with the radius so the halo stays a frame, not a smudge: a 1.2px ring
          // around a 6px dot is proportionally thinner than around a 4px one, which would have
          // spent the size increase and lost the contrast that made small dots findable at all.
          // The halo shrinks with the dot at world zoom (a 1.8 px ring around a 2.6 px dot would BE the
          // dot), but stays solid and dark: here the dots sit on fills of their own zone's hue, and the
          // halo is what separates one from the other. Unchanged from z=8.
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 4, 1.4, 8, 2],
          'circle-stroke-color': 'rgba(15,20,25,0.9)',
        },
      })
      // ★ THE TAP TARGET DID NOT SHRINK WITH THE DOT (2026-09-30). Mapbox and MapLibre hit-test a circle
      // at its radius + stroke, and the pin click was bound to the drawn layer, so the smaller dot above
      // would have taken the tap target down with it (≈ 7 → 4 px radius at world zoom). This invisible
      // twin keeps the ramps the drawn layer had until then, and the click + cursor bind to it
      // (attachPinHandlers): a tap selects exactly what it selected before; only the drawing changed.
      // Both opacities are 0, so the engines skip the draw but still query the features (the library's
      // pin hitbox layers rely on the same). The STROKE opacity matters: its default is an opaque black ring.
      if (!map.getLayer('upg-pins-hit')) map.addLayer({
        id: 'upg-pins-hit', type: 'circle', source: 'upg', paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 4, 6.5, 8, 9],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 1.8, 8, 2],
          'circle-opacity': 0, 'circle-stroke-opacity': 0,
        },
      })
      // slice 13 §1b: wire the pin-click + hover-cursor handlers HERE so they
      // re-attach on every layer (re)creation — the 'upg-pins' layer is wiped +
      // re-added in handleToggleTheme after setStyle (04t-fix2), so attaching
      // inside addPinLayers guarantees the panel still opens after a dark/light
      // toggle. Idempotent guard mirrors getSource('upg') above.
      attachPinHandlers()
    }

    // ★ PAINT THE PINS NOW, before the boundaries are awaited. This is the whole point of the reorder:
    // something useful on screen at ~3 s instead of 7-9 s. It uses the SAME readiness rule as the boot
    // gate below (style loaded, or wait for it) — the map may not have finished its style yet, and
    // addSource/addLayer require a loaded style.
    // ⚠ FIRE-AND-FORGET, NOT AWAITED. The boundary await below must not be delayed by waiting on the
    // style; if the style is slow the pins simply appear a little later, and the boot gate repaints
    // everything regardless. paintAll is idempotent, so the two paths cannot double-add.
    const paintPinsEarly = () => { try { paintAll() } catch (e) { console.warn('early pin paint skipped', e && e.message) } }
    if (map.isStyleLoaded()) paintPinsEarly()
    else map.once('style.load', paintPinsEarly)

    // ── NOW the boundaries, and the territories behind the pins ───────────────
    // ★ EVERYTHING ABOVE THIS LINE NEEDS ONLY THE 68 KB RECORDS LIST. The boundary await sits HERE so
    // the pin layer can be added while MapLibre's workers are still parsing 3.6 MB of GeoJSON —
    // A baseline trace showed the first territory drawing 5.6-6.4 s after the last key byte
    // arrived, and only ~2.6 s of that is main-thread work. Parsing is the bottleneck, not the network,
    // so putting SOMETHING useful on screen means drawing what does not need parsing.
    // (This replaced a two-pass-zones plan, which would still have waited on world-adm0.)
    status.value = t('messages.loadingBoundaries')
    const [adm0, adm1Chn] = await Promise.all([boundaryPromises.adm0, boundaryPromises.adm1Chn])
    const adm1Ind = await boundaryPromises.adm1Ind

    // ── resolve all 26 zones → ONE tapestry FeatureCollection ────────────────
    // ⚠ `tapestry` IS ASSIGNED ONLY WHEN ALL 27 ZONES ARE RESOLVED — whole or null, never partial. It
    // backs boundsFor() (fly-to and zone framing), the search index and the status telemetry, so a
    // half-built tapestry would answer a reader's search or click with wrong bounds and missing hits.
    // Drawing the pins early does not touch it: the pin layer is its own source.
    const { tapestry: fc, perZone } = resolveAllZones(leafZoneList, { records, adm0, adm1Ind, adm1Chn })
    tapestry = markRaw(fc)

    // 09b-search-bar §1(a/c) + 09b-search-reuse-geocoder: build the unified
    // search index + the geocoder feed. P0 fix (LESSON-03 L3): this MUST run
    // AFTER `tapestry = markRaw(fc)` — the geocoder feed's centroidFor calls
    // boundsFor(), which iterates tapestry.features; calling it before the
    // tapestry exists threw "can't access property 'features', tapestry is null"
    // into the pipeline catch, killing tapestry + pins + search (blank-ish UI).
    buildSearch(records)

    // ── boot paint gate (P0 4188af3d / LESSON-03 L7+L10+L31) ─────────────────
    // BUG-1 (04t) taught us addSource/addLayer require the STYLE to be loaded —
    // but its gate `if (map.isStyleLoaded()) draw(); else map.once('style.load',
    // draw)` had a STRANDING window: isStyleLoaded() requires style JSON + sprite
    // + ALL tiles, while the 'style.load' EVENT fires at style-JSON-parse and
    // never re-fires until setStyle. On a cold network the data pipeline lands
    // inside that window → isStyleLoaded()=false AND style.load already fired →
    // the initial paint never ran (no polygons/pins until a theme toggle).
    //
    // L31 REGRESSION (P0 4188af3d again): the L10 fix armed 'style.load' AND
    // 'idle' on the (false) belief that "idle is GUARANTEED to fire later." It is
    // NOT. This whole gate runs AFTER the async data pipeline (lazy geojson
    // imports + a multi-second /people-groups fetch of 2106 records). On most
    // reloads the basemap settles — both 'style.load' AND 'idle' fire — BEFORE
    // the fetch resolves. By the time we attach the once() listeners here the map
    // is already idle and quiescent: neither event re-fires (mapbox only emits
    // 'idle' on the TRANSITION into idle), so the listeners hang forever and the
    // first paint never runs. The theme toggle's setStyle is what finally re-fires
    // 'style.load' → paintAll → polygons+pins appear. That is the exact symptom.
    //
    // FIX: keep the event listeners as the FAST path, but add a bounded
    // isStyleLoaded() poll as the REAL safety net — it does not depend on any
    // event re-firing, so it heals the already-settled-before-we-armed window.
    // paintAll is idempotent; whichever path wins first cancels the rest.
    let _paintArmed = true
    const paintNow = () => {
      if (!_paintArmed) return
      _paintArmed = false
      map.off('style.load', paintNow)
      map.off('idle', paintNow)
      paintAll()
    }
    if (map.isStyleLoaded()) {
      paintNow()
    } else {
      // fast path: paint the instant either event fires…
      map.once('style.load', paintNow)
      map.once('idle', paintNow)
      // …but never trust the events to fire — poll the actual style state so a
      // map that already reached idle before we got here still paints.
      const _poll = setInterval(() => {
        // map may be torn down (unmount / HMR) mid-poll — bail cleanly.
        if (!_paintArmed || !map) { clearInterval(_poll); return }
        let ready = false
        try { ready = map.isStyleLoaded() } catch (_) { clearInterval(_poll); return }
        if (ready) { clearInterval(_poll); paintNow() }
      }, 120)
      // hard stop so a destroyed map (HMR / unmount) never leaves a live timer.
      setTimeout(() => clearInterval(_poll), 15000)
    }

    // ★ DENOMINATOR IS DERIVED, NOT HARDCODED (2026-09-21). This read `${resolved}/26` and shipped
    // "27/26 zones" — a count exceeding its own total, visible in two README screenshots. 26 was
    // the leaf count BEFORE slice 09b-6 added the Frontier-Asia `uncovered_lists`; the literal was
    // never updated, so the badge drifted the moment the data grew. perZone has exactly one entry
    // per zone ATTEMPTED, so its size tracks leafZoneList automatically and can never disagree
    // again. Measured from clusters.json: 13 regional + 12 asia + 2 uncovered + 1 deaf = 28.
    // ★ THE DENOMINATOR COUNTS ZONES THAT SHOULD PAINT, NOT ZONES ATTEMPTED (2026-09-21).
    // Deriving it from perZone.size fixed the impossible "27/26" but left a PERMANENT 27/28,
    // which reads as "one zone is broken" — and I carded it as a bug on exactly that reading.
    // It is not. resolveAllZones DELIBERATELY excludes the `deaf` zone from the region-fill
    // tapestry and records 0 for it: its A017 affinity selector double-stamps land already owned
    // by the 13 geographic zones (16 of oceania-indonesia's 18 Pacific ISO3 alone), which showed
    // deaf twice and underlapped every other region. deaf remains complete in the LIST, the LEGEND
    // and the PINS — only the polygon fill is withheld.
    // So a by-design exclusion was being displayed as a shortfall. Counting only zones that are
    // MEANT to have geometry makes the badge report 27/27 when everything is healthy, and drop
    // below its total ONLY when a zone genuinely fails to resolve. Verified: 28 leaves - 1 deaf
    // = 27 expected, 27 resolved.
    const paintable = [...perZone.entries()].filter(([key]) => key !== 'deaf')
    const resolved = paintable.filter(([, n]) => n >= 1).length
    status.value = t('messages.mapStatusCounts', { polys: tapestry.features.length, zones: resolved, total: paintable.length, pins: pinFeatures.length })
  } catch (e) {
    // The reader gets a sentence in their language; the cause (a boundary 404, a missing API base —
    // developer configuration text) goes to the console, where the person who can fix it looks.
    console.warn('[upg-100-list] map data failed:', e)
    status.value = '⚠ ' + t('upgMap.mapDataFailed')
  }

  // R1.3 (j): once the legend tree paints its rows, start the MutationObserver
  // that re-applies the batch-row markers after every legend re-render, and do an
  // initial mark. The legend mounts on legendNodes.length (post data pipeline), so
  // poll briefly until .stl-rows exists, then hand off to the observer.
  let _legendTries = 0
  const startLegendWatch = () => {
    const host = typeof document !== 'undefined' && document.querySelector('my-upg-100-list-map')
    const root = (host && host.shadowRoot) || (typeof document !== 'undefined' ? document : null)
    const container = root && root.querySelector('.stl-rows')
    if (container) {
      watchLegendRows()
      markLegendBatchRows()
      return
    }
    if (_legendTries++ < 40) setTimeout(startLegendWatch, 250) // up to ~10s
  }
  startLegendWatch()

  // Attach the cross-pane selection listener on THIS custom element. The shell
  // re-dispatches 'doxa:select-zone' here after scrolling to the map pane, so
  // "Show on map" on a poster card selects and flies to that zone.
  {
    const host = mapEl.value?.getRootNode?.()?.host
    if (host) {
      _selectZoneHandler = _onSelectZone
      host.addEventListener('doxa:select-zone', _selectZoneHandler)
      // ★ THE RETAINED REQUEST, read from the ELEMENT rather than waited for.
      // The shell also records the selection as a `select-zone` ATTRIBUTE on this element. An
      // attribute survives custom-element upgrade and is readable whenever we get here, so a
      // request made before this line ran is still available instead of having been dispatched
      // into nothing. That is what makes the FIRST click work; the event above remains the live
      // path for a map that is already up, so both triggers end at applySelectZone().
      const requested = host.getAttribute('select-zone')
      if (requested) applySelectZone(requested)
      // And react to later writes, since the shell sets the attribute on every click.
      _selectZoneObserver = new MutationObserver(() => {
        applySelectZone(host.getAttribute('select-zone') || null)
      })
      _selectZoneObserver.observe(host, { attributes: true, attributeFilter: ['select-zone'] })
    }
  }
})

// When the legend data finally lands, satisfy anything that was asked for too early. This is the
// half that makes retention real -- without it the request is remembered and never applied.
//
// ★ ON nextTick, AND NOT AS A PRECAUTION. The race is a known one in this
// file: watch([batchMode, isDark]) at :222 calls markLegendBatchRows() on nextTick, and this watcher
// would otherwise fire PRE-FLUSH -- so the selection would be applied against the legend rows that
// are about to be replaced by the re-render from these very legendNodes, and its row highlight
// could be stomped. That failure is invisible in the worst way: "the selection happened but you
// cannot see it" looks identical at the rendered layer to "the selection never happened", which is
// the bug this whole change exists to fix. Draining after the flush lets the rows exist and be
// marked first.
// ★ DRAIN ON EITHER READINESS SIGNAL, AND RE-READ THE ATTRIBUTE RATHER THAN THE BOOKKEEPING.
// Measured: legendNodes populated at t=1017 and the request at t=4106, so a legendNodes-change
// drain can never re-fire for it. Re-reading the host attribute makes the outcome independent of
// which hook fired when, which is the whole reason state was chosen over an event.
const _hostEl = () => { try { return mapEl.value?.getRootNode?.()?.host || null } catch (_) { return null } }
watch([legendNodes, mapRef], () => {
  nextTick(() => {
    const requested = _hostEl()?.getAttribute('select-zone') || _pendingZoneId || null
    if (requested) applySelectZone(requested)
  })
})

onBeforeUnmount(() => {
  _selectZoneObserver?.disconnect();
  _selectZoneObserver = null;
  if (_selectZoneHandler) {
    const host = mapEl.value?.getRootNode?.()?.host;
    host?.removeEventListener('doxa:select-zone', _selectZoneHandler);
    _selectZoneHandler = null;
  }
  // R1.2: no keydown listener to remove (modifier-key gestures dropped, D-8).
  // R1.3: tear down the legend-row observer.
  if (_legendRowObserver) { try { _legendRowObserver.disconnect() } catch (_) {} _legendRowObserver = null }
  // Detach the edge strips BEFORE map.remove(): the composable holds a window
  // 'scroll' listener, which would outlive this component and leak on every
  // pane/profile swap.
  if (_detachEdges) { try { _detachEdges() } catch (_) {} _detachEdges = null }
  if (map) { map.remove(); map = null }
  tapestry = null

  // ── RELEASE EVERY WINDOW GLOBAL THIS PROFILE SET ────────────────────────────
  // ★ A window key holding a closure PINS THE WHOLE APP after unmount — the component, its shadow
  // root and everything they reference — measured at roughly 10 MB per mount. The test handles below
  // close over searchIndex, the map and selectedTerritories, so each one is a full retention path.
  // ⚠ SIX GLOBALS, NOT THREE. Each named handle has a paired per-instance REGISTRY
  // (__UPG_SEARCH__/__UPG_SEARCHES__, __UPG_MAP__/__UPG_MAPS__, __UPG_SELECT__/__UPG_SELECTS__), and
  // releasing only the named half leaves the registry holding the same closure — the leak survives
  // in the copy nobody was looking at. Release the SET.
  // ⚠ AND THE TWO HALVES NEED OPPOSITE HANDLING, which is why this is not one loop:
  //   · a NAMED handle is a single slot the last mount overwrites, so deleting it blindly would strip
  //     a LIVE sibling's handle. Identity-check: clear it only if it is still MINE.
  //   · a REGISTRY entry is keyed by instance, so my key is always mine to delete — and deleting the
  //     whole registry would strip the siblings.
  // One delete per line, deliberately: the gate reads these statements, and a loop over a key list
  // would release correctly and still be reported as a leak.
  if (typeof window !== 'undefined') {
    const k = testHandleKey()
    try {
      if (window.__UPG_SEARCHES__) delete window.__UPG_SEARCHES__[k]
      if (window.__UPG_MAPS__) delete window.__UPG_MAPS__[k]
      if (window.__UPG_SELECTS__) delete window.__UPG_SELECTS__[k]
      if (window.__UPG_SEARCH__ === _mySearchHandle) delete window.__UPG_SEARCH__
      if (window.__UPG_MAP__ === _myMapHandle) delete window.__UPG_MAP__
      if (window.__UPG_SELECT__ === _mySelectHandle) delete window.__UPG_SELECT__
      // Copy / Export CSV's last text (the gates read them back); released with the rest of this map's hooks.
      delete window.__UPG_LAST_CLIPBOARD__
      delete window.__UPG_LAST_CSV__
    } catch (_) { /* a frozen or cross-origin window must not break teardown */ }
  }
})
</script>

<template>
  <div class="upg-root">
    <div ref="mapEl" class="upg-map"></div>
    <!-- P3-1 graceful degrade: the tile/token failure is scoped to the MAP CELL.
         Everything else on this surface (legend, list, batch HUD) renders from the
         curated clusters.json and stays usable. Do NOT fake a map and do NOT hide
         the error — surface it exactly where the map would have been, the same way
         gospel-resources/resources-map.vue does with .gm-err. -->
    <div v-if="mapError" class="upg-map-err">
      <strong>{{ t('messages.mapUnavailable') }}</strong>{{ mapError }}
    </div>
    <!-- Edge scroll-affordance strips (the accessibility side bars). They live as
         direct siblings of the map container inside .upg-root — that element is the
         wrapper handed to useEdgeScrollAffordance in onMounted. (A strip placed in
         some other ancestor is silently INERT: it renders but never lights. That is
         the live bug in simple-map, F30.)
         NOTE this profile builds its map RAW via `new gl.Map` rather than through
         useMapInstance, so nothing wires the strips for it — the composable is
         called explicitly. That is why adding the markup alone was not enough.
         The gray gradient, hover-pin and touch-action:pan-y all come from the
         shared composable — nothing profile-local.
         Gated on EDGE_SCROLL_AFFORDANCE: a map with nothing beneath it to scroll to
         must NOT advertise a scroll escape. -->
    <template v-if="EDGE_SCROLL_AFFORDANCE">
      <div class="map-scroll-edge map-scroll-edge--left" />
      <div class="map-scroll-edge map-scroll-edge--right" />
    </template>
    <!-- 09b-search-reuse-geocoder §1(b): the SHARED <GeocoderComponent> — the
         SAME search UI research-map mounts (top-left, ABOVE the legend, mobile-
         friendly mapbox-gl-geocoder). CONSUMED, never edited (src/ md5 unchanged).
         It adds itself to the map via addControl(map, 'top-left'); the legend
         (.stl-panel, also top-left, lower z) sits BELOW it. It builds its own
         localGeocoder from inject('dataStore') (we fed it in buildSearch via
         cacheSourceData), emits `people-group-result` → onGeocoderResult, which
         branches on the synthetic __upgKind to fly PG / zone / territory. Gated on
         mapRef so it only mounts once the map instance exists; mobile-friendliness
         + keyboard nav + clear-X are all inherited from the component.
         P0 fix (LESSON-03 L2): access-token must NOT use `.value` here — the
         template auto-unwraps refs, so `mapboxToken?.value` was undefined and the
         geocoder got '' → its mounted hook threw "Cannot create a client without
         an access token", aborting Vue's post-flush mounted queue → legend +
         controls mounted DEAD (the blank-UI failure). Script scope keeps
         `.value`; template scope must not. -->

    <GeocoderComponent
      v-if="mapRef && hasGeocoder"
      ref="geocoderRef"
      :map-instance="mapRef"
      :access-token="mapboxToken || profileConfig?.tk || ''"
      :data-source-id="GEOCODER_SOURCE"
      :is-dark="isDark"
      :placeholder="geocoderPlaceholder"
      :active-context="geocoderContext"
      @people-group-result="onGeocoderResult"
      @aggregate-result="onGeocoderAggregate"
      @clear="onGeocoderClear"
    />
    <!-- Shared control rail — same set + ordering as research-map. MapToolbar
         self-positions top-right; the status badge sits at the bottom inline end, above the
         map credits (no collision).
         Gated on mapRef so the buttons only mount once the map instance exists. -->
    <MapToolbar v-if="mapRef" :has-geocoder="hasGeocoder">
      <ZoomInButton      :map="mapRef"         :is-dark="isDark" />
      <ZoomOutButton     :map="mapRef"         :is-dark="isDark" />
      <LocationButton    :map="mapRef"         :is-dark="isDark" />
      <FullscreenButton  :map-container="mapEl" :is-dark="isDark" />
      <ThemeToggleButton :is-dark="isDark"      @toggle="handleToggleTheme" />
      <!-- ★ NO MAP-LEVEL SHARE BUTTON HERE (2026-09-23, reported twice): there was a share
           button on the map AND a share button in the header of the website — two separate
           share buttons, and the one on the map is not needed.
           The composite upg-100-mfe.vue:217 already mounts a ShareButton in the header, and that is
           the one to keep — it shares the whole cap-4 element, whereas this one shared only the map
           half, so the duplicate was also the less useful of the two.
           ★ REMOVED HERE, NOT IN THE SHARED COMPONENT: the share control is per-map policy, not a
           global. Prayer Progress is the map intended for embedding on other people's sites and MUST
           keep its own map-level button. A map that is only ever seen inside a composite (this one)
           does not need one; a map that is embedded standalone does. -->
      <!-- ShareButton intentionally omitted; the mfe header owns sharing for this bundle. -->
      <!-- R1.3 (i) + R1.4 (L4): the Batch Select toggle lives IN THE MAP CONTROLS
           RAIL and is THE SINGLE batch entry point (the HUD button is gone) — a
           profile-LOCAL button slotted as a peer of the shared controls (we
           consume the rail's slot host but do NOT edit any shared map-controls
           src). It mirrors the .mcb sizing (round 40px, --map-btn-size) so it
           lines up with Zoom/Location/Fullscreen/Theme, and carries the SAME
           toggleBatchMode logic R1.2 built. Active = filled emerald (D-9).
           aria-pressed + title="Batch Select" for a11y + the gate's G-rail query
           (which targets this .upg-rail-batch, distinct from .mcb). -->
      <!-- Uses the SHARED MapControlButton, exactly like the five buttons above it.
           This was a hand-rolled <button class="upg-rail-batch mcb-shaped"> that
           re-implemented .mcb locally — which is why it rendered LARGER than its
           neighbours and sat out of line: its local rule added min-width/min-height:
           40px on top of width/height, and that floor overrode the shared 36px
           mobile rule, so every other control shrank and this one did not.
           MapControlButton already provides isDark/title/active/disabled + a slot,
           so nothing had to be added to the library. -->
      <MapControlButton
        :is-dark="isDark"
        :active="batchMode"
        :class="{ 'upg-batch-on': batchMode }"
        :aria-pressed="batchMode ? 'true' : 'false'"
        :title="BATCH_SELECT_TITLE"
        @click="toggleBatchMode"
      >
        <!-- checklist / layered-squares glyph (D-9), matches the shared
             BatchSelectButton icon language; emerald when batch mode is ON. -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
      </MapControlButton>
    </MapToolbar>
    <!-- DESKTOP legend. Hidden below the mobile breakpoint, where <LegendMobile>
         (the shared bottom-sheet) takes over — the same split research-map uses.
         Previously this rendered at ALL widths and was the only legend, so on a
         phone the profile had a desktop panel and no bottom sheet. -->
    <div class="upg-legend-desktop-slot">
      <SemanticTreeLegend
        v-if="legendNodes.length"
        :nodes="legendNodes"
        :tabs="LEGEND_TABS"
        :default-tab="LEGEND_DEFAULT_TAB"
        :columns="['count', 'pop']"
        :title="LEGEND_TITLE"
        :export-enabled="true"
        :export-cards="true"
        @select="onLegendSelect"
        @export="onLegendExport"
      />
    </div>

    <!-- MOBILE legend — the SHARED bottom-sheet, fed this profile's own tree via
         the `nodes` override (library/components/legends/LegendMobile.vue). Without
         that override it would derive the research map's language-family taxonomy
         from injected people-group data, which this curated list does not have.
         legendType is a non-'default' sentinel so it takes the SemanticTreeLegend
         branch rather than the flat LegendRows fallback. -->
    <div class="upg-legend-mobile-slot">
      <LegendMobile
        v-if="legendNodes.length"
        legend-type="upg-100"
        :nodes="legendNodes"
        :tabs="LEGEND_TABS"
        :default-tab="LEGEND_DEFAULT_TAB"
        :columns="['count', 'pop']"
        column-label="UPG100"
        :title="LEGEND_TITLE"
        :is-dark="isDark"
        popup-action="pray"
      />
    </div>
    <!-- slice 13 §1c: pin-click → people-group detail side panel. Gated on
         uiStore.selectedPeopleGroup (set by attachPinHandlers → selectPeopleGroup).
         The shared PeopleGroupDetail injects the SAME uiStore and clears the
         selection via its own close button (handleClose → selectPeopleGroup(null)),
         which collapses this v-if. No @close emit exists on the component, so
         store-driven visibility IS the close mechanism. .upg-detail-panel +
         .pg-detail-root are the selectors the firefox visual gate queries. -->
    <!-- DESKTOP ONLY. On mobile the shared <LegendMobile> bottom-sheet already
         swaps itself to PeopleGroupDetail on the SAME uiStore.selectedPeopleGroup,
         so rendering this panel too showed the people-group card TWICE for one pin
         click. Research-map avoids the clash by keying its two surfaces off
         DIFFERENT stores (legend = uiStore.selectedPeopleGroup, its own panel =
         mapStore.selectedFeature); this profile routes both through uiStore, so the
         breakpoint is what keeps them mutually exclusive — same 767px split as
         .upg-legend-*-slot. -->
    <div class="upg-detail-desktop-slot">
      <div
        v-if="uiStore && uiStore.selectedPeopleGroup"
        class="upg-detail-panel pg-detail-root"
        :class="{ dark: isDark }"
      >
        <PeopleGroupDetail
          :peopleGroup="uiStore.selectedPeopleGroup"
          :dark="isDark"
          action="pray"
        />
      </div>
    </div>
    <!-- R1.4 (L4 — single button + progressive disclosure): the land-
         division HUD renders ONLY while batch mode is ON. The map-rail
         .upg-rail-batch (above, in the MapToolbar) is the SINGLE batch entry
         point — the old always-visible HUD .upg-batch-btn is gone. Inside batch
         mode: hint, then running total + names + swatches + Copy/Clear once ≥1
         territory/zone is selected. .upg-hud / .upg-hud-total / .upg-hud-btn are
         the selectors the firefox gate reads. Band turns green in the 50–100
         UUPG curation band. -->
    <!-- The shown zone, named, with the × that shows every zone again (clearShownZone). -->
    <button v-if="shownZone" type="button" class="upg-shown" :aria-label="t('buttons.clearSelection') + ': ' + shownZone"
      :title="t('buttons.clearSelection')" @click="clearShownZone">
      <span class="upg-shown-name">{{ shownZone }}</span><span class="upg-shown-x" aria-hidden="true">×</span>
    </button>
    <div v-if="batchMode" class="upg-hud">
      <div class="upg-hud-hint">
        {{ t('messages.tapTerritoriesHint') }}
      </div>
      <!-- ★ THE HUD'S MESSAGE LINE SITS AT THE TOP, not under the buttons: on a phone the first-visit PinHint toast
           sits over the HUD's bottom edge, and a line down there was covered ("This needs a desktop or laptop
           computer." read as "This needs a"). Copy's flash, the phone ceiling's notice, failures and the print's
           progress all appear here (hudSay / hudProgress). -->
      <div v-if="selCount" class="upg-hud-flash" role="status" aria-live="polite">{{ copyFlash || hudProgress }}</div>
      <div v-if="selCount" class="upg-hud-head">
        <!-- ★ A LABEL FORM ("Territories: {count}"), NOT A PLURAL KEY. This was
             `territor{{ selCount === 1 ? 'y' : 'ies' }}` — English pluralisation welded
             into the template. A vue-i18n plural key was proposed instead; it would
             be WORSE. Tested: with no pluralRules registered, vue-i18n v9
             applies an English-shaped choice (count===1 ? 0 : 1) to EVERY locale, so ru
             with 3 forms supplied picks wrong at 1, 2 and 21 — confidently wrong grammar
             that LOOKS translated. Real plural support needs a pluralRules map at
             createI18n, a library change nobody asked for. The label form sidesteps
             agreement entirely and is correct in all 11 today. -->
        <span>{{ t('messages.territoriesSelected', { count: selCount }) }} ·</span>
        <span class="upg-hud-total">{{ selTotal }} UUPG</span>
        <!-- TWO KEYS, not a ternary over one: these are two
             STATES of one label, and a locale may not phrase "in range" and "out of range" as a tick
             plus the same words. The ✓ lives in the catalogue string so a locale can drop it. -->
        <span class="upg-hud-band" :class="{ ok: selTotal >= 50 && selTotal <= 100 }">
          {{ selTotal >= 50 && selTotal <= 100 ? t('messages.bandInRange') : t('messages.bandOutOfRange') }}
        </span>
      </div>
      <div v-if="selCount" class="upg-hud-names">{{ formatList(selectedTerritories.map(t => t.name), { locale: packetLang() }) }}</div>
      <!-- ★ RECOLOUR IS BACK (2026-09-30), beside the actions that build from the selection. The batch tool
           exists so that when the people-group data changes, partners can redraw the zones and re-derive
           their people groups: the colour previews on the map (the upg-sel-fill layer repaints; the base map
           stays clean) and travels in Copy's first line as " · #hex", which data/apply-grouping.mjs applies
           to the regrouped zone. 8 Okabe–Ito swatches (colour-blind aware) + a custom hex. -->
      <div v-if="selCount" class="upg-hud-swatches" role="group" :aria-label="t('upgMap.selectionColourGroup')">
        <button v-for="c in SWATCHES" :key="c" type="button"
          class="upg-swatch" :class="{ active: selectedColor === c }" :aria-pressed="selectedColor === c ? 'true' : 'false'"
          :data-color="c" :style="{ background: c }"
          :title="t('upgMap.selectionColour', { hex: c })" :aria-label="t('upgMap.selectionColour', { hex: c })"
          @click="setSelectionColor(c)"></button>
        <input v-model="hexDraft" class="upg-hex" placeholder="#hex" spellcheck="false"
          :aria-label="t('upgMap.customColour')" @change="onHexInput" @keyup.enter="onHexInput" />
      </div>
      <!-- The make-row BUILDS what this app already makes from exactly what was picked (printPrayerPacket /
           printPoster / the card deck); the data-row below EXPORTS the selection itself. -->
      <!-- ★ THE BUTTON SAYS WHAT IT IS DOING. Reported from mobile 2026-09-28: pressing these gave
           no sign of progress. batchBusy only DISABLED them, and a disabled button is visually
           indistinguishable from an unresponsive one — so a reader on a phone taps, sees the label
           unchanged, and taps again. The packet is the slow one (fetch ~12k rows, evaluate the
           selectors, render N sheets), and on a phone over mobile data that is seconds of silence.
           `busyAction` names WHICH action is running so only that button changes, rather than both
           going grey and neither explaining itself. -->
      <div v-if="selCount" class="upg-hud-actions">
        <button class="upg-hud-btn make" :class="{ 'is-busy': busyAction === 'packet' }" :disabled="batchBusy"
          @click="makeSelectionPacket">{{ busyAction === 'packet' ? t('buttons.working') : t('buttons.prayerList') }}</button>
        <button class="upg-hud-btn make" :class="{ 'is-busy': busyAction === 'poster' }" :disabled="batchBusy"
          @click="makeSelectionPoster">{{ busyAction === 'poster' ? t('buttons.working') : t('buttons.posterMap') }}</button>
        <button class="upg-hud-btn make" :class="{ 'is-busy': busyAction === 'cards' }" :disabled="batchBusy"
          @click="makeSelectionCards">{{ busyAction === 'cards' ? t('buttons.working') : t('buttons.cardDeck') }}</button>
      </div>
      <!-- COPY + EXPORT CSV: the selection's territories (apply-grouping's line) and its people groups
           (data/selection-export.js). A second row, so six buttons never squeeze into one on a phone. -->
      <div v-if="selCount" class="upg-hud-actions">
        <button class="upg-hud-btn copy" @click="copySelection">{{ t('upgMap.copySelection') }}</button>
        <button class="upg-hud-btn csv" :class="{ 'is-busy': busyAction === 'csv' }" :disabled="batchBusy"
          @click="exportSelectionCsv">{{ busyAction === 'csv' ? t('buttons.working') : t('upgMap.exportCsv') }}</button>
        <button class="upg-hud-btn clear" @click="clearSelection">{{ t('buttons.clearSelection') }}</button>
      </div>
    </div>
    <div class="upg-status">{{ status }}</div>
  </div>
</template>
