<script setup>
/**
 * MapPanel — RDASH phase 7: all-regions/all-countries choropleth (shaded by UPG count) + magnitude
 * bubbles, linked to filterSet/selectionSet. Reuses read-only @map useMapInstance (no edits). The
 * choropleth is a feature-state-free match on iso_3166_1_alpha_3 over country-boundaries-v1; clicking
 * a country brushes filterSet (table+charts+KPI+tree narrow); filterSet dims non-matching countries.
 * Shadow-DOM safe — useMapInstance injects Mapbox GL CSS into the root; styles via useShadowStyles.
 */
import { inject, ref, computed, onMounted, onBeforeUnmount, watch, unref } from 'vue'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { resolveMapProvider, setProjectionOn } from '@map/composables/useMapProvider.js'
import { useMapFly } from '@map/composables/useMapFly.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { tStatic } from '@map/i18n/index.js'

// This panel's chrome, read out of the catalogue. tStatic and not useI18n, for the reason the rest
// of this tree gives: these components mount inside custom elements that install no i18n plugin,
// and an unguarded useI18n() throws on the way in and takes the whole panel with it.
const T = (key, en) => tStatic(key) || en
// Table selection -> map camera. The table never touches the map: it commits to the bus,
// this composable watches bus.selectionVersion and flies ONCE per settled change.
import { useSelectionCamera } from '@map/composables/useSelectionCamera.js'
// ── Map controls — REUSED from the shared library, not hand-rolled. MapToolbar is a
//    layout-only positioned column; each button binds :map explicitly so it can only ever
//    drive THIS panel's instance (the multi-map contract in map-controls/README.md).
//    Deliberately a MINIMAL subset (zoom in / zoom out): the dashboard cell is small and
//    the space budget is tight, so location/fullscreen/theme/share stay out.
import MapToolbar from '@map/components/map-controls/MapToolbar.vue'
import ZoomInButton from '@map/components/map-controls/ZoomInButton.vue'
import ZoomOutButton from '@map/components/map-controls/ZoomOutButton.vue'
import { lbl } from '@map/composables/useFacetAggregation.js'
import { buildSearchAccessors, makeSearchMatcher, filterRowsBySearch } from '@map/composables/useDashboardSearch.js'
// ── THE PRAYER COLOUR STRATEGY, REUSED NOT RE-DERIVED ──
// applyColor() returns the SAME 3-tier expression the prayer map paints with, keyed off the
// FULL_PRAYER_THRESHOLD that library/colors/prayer-progress.js owns. Importing it here means the
// dot a prayer filter leaves on the map can never disagree with the level the filter selected —
// one threshold, one owner. (The dashboard facet already reuses getPrayerLevel for the same reason.)
import { applyColor as prayerColorExpr } from '@map/colors/prayer-progress.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { findScrollportAncestor } from '@map/utils/scrollport.js'

const dash = inject('dashboardData', null)
const bus = inject('selectionBus', null)
const mapboxToken = inject('mapboxToken', ref(''))
const cfg = inject('dashboardConfig', {})
// The host's parsed profile-config, used ONLY to resolve the assets base for the keyless country
// boundaries on the MapLibre path (see addLayers). Same channel every other plugin already reads;
// resolveAssetsBase degrades correctly when it is null, so a host that provides nothing still
// resolves the tree from this bundle's own script URL.
const profileConfig = inject('profileConfig', ref(null))
const filterSet = bus?.filterSet || {}

const FACET_ACC = Object.fromEntries(Object.entries(cfg.facets || {}).map(([k, f]) => [k, f.get]))
// shared free-text search predicate (header-1) — one source of truth with the shell + other panels.
const matchSearch = makeSearchMatcher(bus, buildSearchAccessors(cfg))
const filteredRows = computed(() => {
  const rows = dash?.rows?.value || []
  const keys = Object.keys(filterSet)
  const hasText = !!(bus?.searchTerm?.value || '').trim()
  if (!keys.length && !hasText) return rows
  const faceted = rows.filter((r) => bus.rowMatchesFilters(r, FACET_ACC))
  return filterRowsBySearch(faceted, matchSearch)
})
// Geo join is config-driven: geoFacet selects the facet whose `geoIso` accessor yields the ISO-3 join
// value (e.g. 'IND') for the choropleth, and whose `get` accessor yields the filter label (e.g. 'India').
const geoFacet = cfg.map?.geoFacet || 'country_code'
const geoIso = cfg.facets?.[geoFacet]?.geoIso || ((r) => { const c = r[geoFacet]; return c && c.value ? c.value : null })
const geoLabelOf = FACET_ACC[geoFacet] || ((r) => lbl(r[geoFacet]))
// ISO3 -> {count, label}. Country code value is alpha-3 (e.g. 'IND').
const isoToLabel = computed(() => {
  const m = new Map()
  for (const r of (dash?.rows?.value || [])) { const iso = geoIso(r); if (iso) m.set(iso, geoLabelOf(r) || iso) }
  return m
})
const countryCounts = computed(() => {
  const m = new Map()
  for (const r of filteredRows.value) { const iso = geoIso(r); if (iso) m.set(iso, (m.get(iso) || 0) + 1) }
  return m
})

const mapContainer = ref(null)
// ── MAP PROVIDER: choosable, Mapbox by default ──────────────────────────────
// The aim is interoperability: every Mapbox component keeps working, so Mapbox compatibility never
// breaks, while the unified research dashboard also runs on MapLibre. Both engines must work.
//
// So this is DUAL-SUPPORT, not a migration, and the change is deliberately ADDITIVE: `provider`
// defaults to 'mapbox', so with no config the behaviour is byte-for-byte what it was. Nothing
// Mapbox-shaped can regress, because nothing changes until a host opts in.
//
// WHY IT GOES THROUGH dashboardConfig: that is how every other dashboard setting already arrives
// (facets, search, columns), so a host sets it the same way it sets everything else, and the cap-4
// composites can pass it down without a new mechanism.
//
// ★ WHAT MAKES THE SWAP CHEAP: useMapInstance already accepts provider:'mapbox'|'maplibre'
// (useMapInstance.js:231-232), already loads the matching engine + CSS, and resolveNamedStyle(style,
// provider) in library/styles/registry.js already maps every named style to BOTH engines — the
// maplibre side pointing at keyless OpenFreeMap URLs. The plumbing existed; it was simply never
// reachable from here, because this call passed neither `provider` nor `style`.
//
// ★ THE TOKEN IS NOT DROPPED WHEN provider='maplibre'. accessToken stays wired: MapLibre ignores
// it, and keeping it means flipping the prop back to 'mapbox' is a one-word change with nothing
// else to restore. That is what "hot-swappable" has to mean to be worth anything.
// ★ READ BOTH LEVELS, for the same reason `style` below does. This originally read ONLY
// `cfg.provider`, while every other map setting (mapStyle, bins, geoFacet, colorRamp) lives under
// `cfg.map`. A host that put `provider` where the rest of its map config already sits got NO
// error and NO swap — the map silently stayed on Mapbox and the config looked correct. That is
// the exact failure the note on `style` below names: a setting silently ignored because it sat
// one level off is worse than no setting. `cfg.map.provider` is the spelling to prefer; the
// top-level one is kept working so nothing already using it breaks.
// ★ THREE LEVELS, MOST SPECIFIC FIRST — and the middle one is new.
// This used to be `cfg.provider === 'maplibre' ? 'maplibre' : 'mapbox'`, which collapsed every
// other answer to Mapbox and therefore silently OUTRANKED the page-level switch that the rest of
// the tree honours: a partner flipping one value watched this dashboard stay on Mapbox with no
// indication why. But dashboard.config.js pins provider:'mapbox' DELIBERATELY — for
// Mapbox Standard's native starfield globe — so that default must survive
// untouched. Both hold if the page switch sits BETWEEN the per-element config and the bundle's
// shipped preference:
//   1. profile-config.provider — this embed, decided by whoever mounted the element
//   2. ?provider= / window.MAP_PROVIDER — the page, i.e. "swap every map on this site"
//   3. dashboard.config.js — this bundle's shipped default (Mapbox, as set above)
// With no switch set, resolveMapProvider decides 'auto': with a token step 2 does not fire and the
// shipped default holds; with NO token it answers 'maplibre', because Mapbox cannot draw without one.
const mapProvider = computed(() => {
  const fromElement = profileConfig?.value?.provider
  if (fromElement === 'maplibre' || fromElement === 'mapbox') return fromElement
  if (resolveMapProvider(null) === 'maplibre') return 'maplibre'
  const p = cfg.map?.provider || cfg.provider
  return p === 'maplibre' ? 'maplibre' : 'mapbox'
})
// Derived once so the source/layer branches in addLayers read the SAME decision the engine was
// loaded with — a second inline `cfg.provider === …` test is how the two drift apart.
const isMaplibreProvider = computed(() => mapProvider.value === 'maplibre')

// The country boundaries (384 KB) are fetched as soon as the panel exists, not from the style-load
// handler: there the download waited for the whole basemap style and so ran after it, not beside it
// (the network waterfall: requested at 10.4 s of a 12.5 s load). The handler awaits this same promise.
let boundariesPromise = null
function countryBoundaries() {
  if (!boundariesPromise) {
    boundariesPromise = fetch(`${resolveAssetsBase(profileConfig.value)}/boundaries/world-adm0-web.geojson`)
      .then((r) => r.json())
      .then((gj) => {
        for (const f of gj.features || []) {
          if (f.properties && f.properties.iso3) f.properties.iso_3166_1_alpha_3 = f.properties.iso3
        }
        return gj
      })
    boundariesPromise.catch(() => { boundariesPromise = null }) // a failed download is retried next time
  }
  return boundariesPromise
}

const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer, accessToken: unref(mapboxToken) || (mapboxToken && mapboxToken.value) || '',
  // ★ ZOOMED OUT BY DEFAULT, WITH REAL ZOOM-OUT RANGE: the map opens zoomed out, with its edges truly
  // at the edges, so there is more zoom-out distance to work with. zoom 1.45 -> 1.1 opens on the
  // whole sphere; minZoom 1 -> 0.5 plus skipWorldFloor gives the zoom-out gesture somewhere to
  // go. The floor being skipped is the mercator "no duplicate world" rule, which is meaningless
  // on a globe -- a sphere HAS no second world to show. Flat mercator keeps the floor.
  center: [28, 18], zoom: 1.1, minZoom: 0.5, skipWorldFloor: true,
  provider: mapProvider.value,
  // A named style resolves per-provider via the registry; leaving it unset keeps each engine's own
  // default, which is what shipped before this change.
  // Read from BOTH cfg.mapStyle (the original top-level spelling, kept for hosts already using
  // it) and cfg.map.mapStyle (where every other map setting — bins, geoFacet — already lives).
  // A setting that is silently ignored because it sat one level off is worse than no setting.
  ...(cfg.map?.mapStyle || cfg.mapStyle ? { style: cfg.map?.mapStyle || cfg.mapStyle } : {}),
})
// Shared library camera helper — one fly/fitBounds implementation for the whole studio.
const mapFly = useMapFly({
  getMap: () => map.value,
  mapId: 'rdash-map',
  defaultCenter: [28, 18],
  defaultZoom: 1.45,
})
// ── Table selection -> camera (selecting a row in the table zooms the map there) ──
// Frames the selection off the FULL row store, not filteredRows — matching selectedGeo()
// below, so the camera always frames exactly the pins the selection pen draws (a row can be
// selected and then filtered out of scope; the pen deliberately keeps showing it).
// Gated on isMapReady so a selection made during boot can't fly a half-built camera.
// Motion safety lives inside the composable: ONE debounced animation per settled selection,
// never per frame, and a jump (duration 0) under prefers-reduced-motion.
let stopSelectionCamera = null
stopSelectionCamera = useSelectionCamera({
  bus,
  mapFly,
  getMap: () => map.value,
  getRowStore: () => dash?.rowStore?.value,
  isEnabled: () => isMapReady.value,
})
let added = false
// Container-size watcher: Mapbox only re-reads its canvas size on window resize / its own
// 'resize' event, so when the LAYOUT changes the cell (e.g. the table collapses and this map's
// grid row grows), the canvas keeps its old size → a gray gap. A ResizeObserver on the map
// container calls map.resize() on ANY container-size change, so the canvas always fills its cell.
// General-correct (not table-specific): also covers window/rail/facet reflow. rAF-coalesced.
let containerRO = null
// The scroll-zoom resync observer and its window listener. Both are CREATED inside onMounted,
// which is async — so they are declared out here and torn down by the one top-level
// onBeforeUnmount below. A lifecycle hook registered after that callback's first `await` never
// attaches to this instance (Vue has no active instance by then), so the teardown cannot live
// next to the code that creates these; it has to live in a hook registered during setup.
let scrollRO = null
let scrollResync = null
let offToggleTable = null
// Holders for the three verify hooks planted on window when the map is built, so the unmount path
// can release ONLY the ones this instance installed. Two dashboards can share a page (the Big
// Picture composite beside a gallery instance); B overwrites A's hooks, then A unmounts, and an
// unconditional delete would strip the hooks of the dashboard still on screen — a browser check would see a
// missing hook on a healthy map. Declared here because the assignments live inside the map-build
// function and a const there is invisible to onBeforeUnmount.
let _hookRdashMap = null
let _hookClickAt = null
let _hookPinAt = null
let offLayoutResizing = null
let _resizeRaf = 0
// BUG-RESIZE-STROBE (photosensitive-seizure risk): while a section divider is being DRAGGED the
// container changes size every frame. map.resize() makes MapLibre emit its own 'resize', which
// useMapInstance handles by recomputing the aspect-aware zoom FLOOR from the container height and
// calling setMinZoom/setZoom. On a vertical drag the height — and therefore the floor — moved every
// frame, so the camera was re-snapped ~60x/sec and the whole globe re-rendered: visible strobing.
// While `liveResize` is true we skip map.resize() entirely (the canvas is stretched by CSS, which
// is cheap and flicker-free) and run ONE real resize on drag end.
let liveResize = false
function scheduleMapResize() {
  if (liveResize || _resizeRaf) return
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = 0
    const m = map.value
    if (m && typeof m.resize === 'function') { try { m.resize() } catch (_) {} }
  })
}
// Drag start/end from useDashboardLayout. On end, do the single expensive pass that was
// suppressed for the whole drag, plus one delayed pass for the grid/transition settle.
function setLiveResize(on) {
  const next = !!on
  if (next === liveResize) return
  liveResize = next
  if (liveResize) {
    if (_resizeRaf) { cancelAnimationFrame(_resizeRaf); _resizeRaf = 0 }
    return
  }
  scheduleMapResize()
  setTimeout(scheduleMapResize, 180)
}

// ── THE CHOROPLETH RAMP — why it is PALE and no longer grey→black ──────────────────────────
// (card BUILD-MAP-STYLE-MUST-BE-BEAUTIFUL-AND-MATCH-THE-PALETTE)
//
// Reported: it is hard to see the pins, hard to see the actual dots, because they
// are blue, and grey on blue makes them really hard to see.
//
// THAT IS A PINCER, AND MEASURING IT IS WHAT LOCATES THE FIX. The two layers that make a dot
// visible fail at OPPOSITE ends of the OLD grey→black ramp. Measured 2026-09-22 against each
// old bin as actually composited (fill-opacity 0.78 over the light basemap):
//
//   old bin    navy dot #1a237e      white ring #fff
//   #f2f2f2         12.15                 1.09   <- ring invisible
//   #e0e0e0         10.71                 1.24   <- ring invisible
//   #b0b0b0          7.36                 1.80
//   #808080          4.82                 2.75
//   #404040          2.45                 5.41   <- dot fading
//   #000000          1.13                11.73   <- dot INVISIBLE
//
// There is NO bin where both work, and around the mid-greys both are weak at once — which is
// exactly "grey on blue makes it really hard to see". No fixed pin colour can win against a
// ramp that sweeps through the pin's own value range. So the RAMP must yield: it is the only
// free variable left. This is the cartographic rule, not a preference — the basemap belongs
// BELOW the thematic symbols (UCGIS CV-03-007, Visual Hierarchy), and CARTO ships Positron as
// "a light gray map, good for POINT data" for precisely this reason.
//
// THE TRADE, STATED HONESTLY. A pale ramp carries LESS information than grey→black: adjacent
// bins sit at 1.12–1.17 contrast, so ranking six tints by eye is harder than ranking grey to
// black. We are spending choropleth precision to buy pin legibility, which is the right trade
// because the pin is the thing you CLICK — but it is a real trade. The density signal is not
// lost: it is carried by the bubble layer, which already encodes population.
//
// ── ★ THE HUE IS NOT GREEN, AND THAT IS THE POINT ─────────────────────────────────────────
// (card DECIDE-THE-MAP-MUST-NOT-MAKE-LOSTNESS-LOOK-GOOD)
//
// Reported: it does not make sense for the tiles to be green, because green means good while it
// is not good to be lost, and the darkest spots are where the most lost people are at... it
// should not make it look green and nice that these nations are so lost."
//
// WHAT WAS WRONG, and it was not a taste call. The bins ran pale green → saturated green as the
// count of UNREACHED PEOPLE GROUPS rises, so the deepest, richest green marked the places with
// the MOST LOST PEOPLE. And the hue was not incidental: '#92b195' is the product ACCENT, used in
// 48 places as --brand, the selected-tab underline and the active-row marker — the colour this
// product uses to mean GOOD/SELECTED. It had been run up the lostness axis. The ramp above was
// derived by interpolating surface → accent, which bought palette coherence and fixed a real
// contrast defect, and never asked WHAT THE COLOUR SAYS.
//
// The vision is explicit that FAR means "the farthest, 99.9%-lost places... eyes to see where
// the Kingdom isn't, and be SENT there". The dark end of this ramp is not a high value — it is
// where people are who have never heard. A palette tuned for comfort ANAESTHETISES the exact
// response the map exists to provoke. Beautiful is still the goal: the artwork of a LAMENT,
// not of a garden. Cartography agrees and names the trap — lightness carries ORDER while hue
// carries MEANING, so green is a statement rather than a default, and PolicyViz documents the
// value-judgement problem directly ("more/darker is better").
// THE FINDING THIS ENCODES: a palette tuned for comfort anaesthetises the very response the
// map exists to provoke, so the dark end must read as lament rather than as achievement.
//
// ── ★ WHY THIS RAMP AND NOT THE TWO THAT WERE HANDED OVER ────────────────────────────────
// Two candidates arrived pre-measured: EMBER (worst pin 7.04) and CLAY (7.03), both said to
// clear the 7:1 floor. RE-MEASURED, THEY DO NOT. Those numbers were composited over PURE WHITE.
// The style this panel actually sets is `paper` → OpenFreeMap Positron / Mapbox light-v11, and
// Positron's background layer paints rgb(242,243,240) = #f2f3f0. On the ground that really
// paints, every ramp drops about 0.2:
//       EMBER 6.86   CLAY 6.84   (both FAIL)   ·   old green 7.09 (only just passed)
// Composited over #ffffff the same code reproduces 7.04 / 7.03 / 7.29 exactly, which is how the
// discrepancy was confirmed rather than guessed. Measuring against a ground that does not ship
// is the whole failure: it is invisible while candidates are only compared to EACH OTHER, and
// shows up only against the absolute floor.
//
// ★ AND THE REAL LEVER WAS NEVER DARKNESS. The card framed this as structural — "a hue that
// reads as grave must go DARK, and darkness is what kills contrast" — and three earlier
// candidates failed that way (clay 4.85, ember 4.05, violet 4.28). But WCAG contrast is driven
// by relative luminance, which LIGHTNESS dominates; CHROMA is very nearly free. Solved across
// hue 30–50° at chroma 0.06–0.12, every restrained candidate lands at 7.15–7.20 — the muted
// ones measure the SAME as the saturated ones. So "lament, not fire alarm" costs nothing in
// contrast. It was always affordable; nobody had separated the two variables.
//
// ── ★ SHADES OF RED — SO INDIA READS AS A HEART ───────────────────────────────────────────
// (card BUILD-SHADES-OF-RED-FOR-THE-DARKEST-PLACES)
//
// Asked: the darkest spots should be RED, in SHADES OF RED. God's heart beats loudest
// for the darkest places, and shades of red capture what the ramp is meant to say about
// God's heart, because THAT WILL CAUSE INDIA TO LOOK LIKE A HEART."
//
// THE IMAGE IS THE SPEC. India holds the densest concentration of unreached peoples on earth, so
// a red that deepens with the count renders that concentration as a heart. This is the same
// correction as the green fix carried one step further: not merely "stop saying GOOD", but
// positively say WHOSE heart this is. Red is the hue that does that.
//
// ★ AND THIS RAMP IS THE ANSWER TO A CONSTRAINT, NOT A FREE CHOICE. A red dark enough to look
// like blood cannot coexist with a dark navy pin. MEASURED, the dark red this phrasing naturally
// suggests ('#b8383f' endpoint) collapses the pin to 3.33 — the dot is swallowed on the very
// countries the map most needs you to click. Grey, offered as the alternative, fails too (5.32).
// So the ramp stays LIGHT and spends its budget on CHROMA instead: a vivid coral-red that is
// unmistakably RED while keeping the pin legible. The heart GLOWS rather than darkens.
//
// ★ A HYPOTHESIS WORTH RECORDING BECAUSE IT WAS WRONG. The expectation going in was that chroma
// is nearly free, so saturation could be raised without cost. MEASURED at fixed lightness, hue
// 25°, it is not — contrast falls monotonically as chroma rises:
//     L=0.70   C=0.04 → 6.06   C=0.08 → 5.96   C=0.12 → 5.81   C=0.16 → 5.66   C=0.20 → 5.36
// Chroma is CHEAP in the muted clay range and genuinely COSTLY toward red. The earlier
// "chroma is free" finding (below) was true within the range it was measured and does not
// generalise. Both statements are kept because the difference between them is the lesson:
// measure the range you are actually in.
//
// WHAT THIS RAMP IS. OKLCh hue ~31-34°, carrying real chroma (0.028 → 0.134) so it reads as red
// rather than as the clay it replaces. The 6-step scale runs from the product SURFACE '#f3f3f1'
// — which is also NO_DATA, so the ground is unchanged and lightness still carries the ORDER —
// down to the most saturated red endpoint that still clears the floor; the 5 DATA bins are the
// five steps BELOW the surface, so an empty country still reads as "the page" rather than as a
// sixth bin. Steps are interpolated in OKLab, so the lightness intervals are perceptually EVEN
// (sRGB interpolation bunches the midtones and would make two adjacent bins look alike).
//
// ┌─ SUPERSEDED 2026-09-22 — THIS TABLE DESCRIBES A RAMP AND A PIN THAT NO LONGER SHIP ────────┐
// │ Kept because the REASONING below is still the reason the ramp is ordered by lightness, but │
// │ every NUMBER in it is stale: both variables it measured have since changed. The pin is no  │
// │ longer navy (it is orange '#ef6c00') and the ramp is no longer this pale coral (it ends at │
// │ the label red '#cd2027'). For the CURRENT measured table see the BIN_COLORS note below —   │
// │ effective pin visibility 2.77 / 2.07 / 1.83 / 2.31 / 3.00 / 4.16, worst bin2 1.83.         │
// │ ★ The 7:1 floor cited here is NOT the standard the shipped pin meets, and pretending it is │
// │ would be the dishonest reading: a light-on-light orange pin cannot reach 7:1 against a red  │
// │ ramp, which is exactly why the white stroke became load-bearing instead. Do not quote these │
// │ numbers as if they were current, and do not "restore" the 7:1 target without re-reading the │
// │ BIN_COLORS note, which explains why that target belonged to the navy era.                  │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
// HISTORICAL. MEASURED, navy pin '#1a237e' composited at fill-opacity 0.78 over #f2f3f0, against
// the PALE CORAL ramp that this file shipped before the heartbeat-red change:
//
//   NO_DATA #f3f3f1 11.91
//   #f8e0da 10.80 · #fccec4 9.82 · #febbad 8.85 · #ffa797 7.92 · #ff9380 7.07
//
// WORST DATA BIN WAS 7.07, below the 7.20 the ashen-clay ramp reached; that regression was
// deliberate and bought the hue that was asked for while still clearing the 7:1 floor that was
// the constraint AT THE TIME. It remained well above the green this replaced (1.13).
//
// REJECTED, each measured rather than argued:
//   dark red   '#b8383f' endpoint — worst 3.33. The pin disappears. This is the one to re-read
//              if anyone asks "why isn't it darker": darkness is what the pin cannot survive.
//   grey       '#8e8e8e' endpoint — worst 5.32, and it says nothing about whose heart it is.
//   maroon/violet/deep ember — 4.85 / 4.05 / 4.28 in earlier rounds, same cause.
//
// The other two paint paths were measured too, and neither had been checked before: buildPaint()
// repaints at 0.92 for in-filter countries and 0.12 for dimmed ones. Worst pin at 0.92 is 6.46
// (the old green was 6.40 on the same path) and at 0.12 is 11.02. ★ The 0.92 path is the true
// worst case for EVERY ramp including the old one, and it sits below 7 — noted here because it
// is a PRE-EXISTING condition this change improves rather than introduces, so the next person
// measures it instead of rediscovering it and blaming the hue.
//
// THE THREE CONSTRAINTS, each verified rather than asserted:
//   1. ★ RETIRED WITH THE NAVY PIN. This read "navy pin ≥ 7:1 on every bin at 0.78 — worst 7.07.
//      PASS." It was a NAVY-ERA constraint and it no longer describes the product: the pin is now
//      orange, and a light-on-light orange CANNOT reach 7:1 against a red ramp at any tuning
//      (swept; the worst case saturates near 1.98). The constraint did not get quietly lowered —
//      it got REPLACED by one that matches the two-band pin that actually ships: effective
//      visibility = max(orange disc, white stroke) on every bin, worst 1.83 at bin2. Anyone
//      tempted to "restore 7:1" should read the BIN_COLORS note first — doing so means either
//      giving back a navy pin or giving up the label red.
//   2. no red-vs-green dependence (8% of men have that deficiency, and red-green is exactly the
//      bad-good pairing a designer reaches for here). ★ THIS CONSTRAINT BINDS HARDEST NOW THAT
//      THE RAMP IS ACTUALLY RED — a red ramp that ordered by HUE would be unreadable for those
//      8%, and would be the worst possible outcome of this card. It does not: the lightness run
//      is strictly monotonic (0.964 → 0.925 → 0.888 → 0.850 → 0.811 → 0.773), and simulated
//      under both deuteranopia and protanopia the bin luminances stay strictly decreasing. The
//      ORDER is carried by lightness alone; the red is meaning laid on top of it, never the
//      encoding. That is also why the ramp may not be darkened to "look more serious" — doing
//      so compresses this lightness run as well as killing the pin.
//   3. the accent '#92b195' must not appear. It does not, and no bin is even NEAR it: the accent
//      sits at OKLCh hue 148° and the nearest chromatic bin is 113° away. Checked as a hue
//      DISTANCE, not just an exact-hex match — a near-miss reads as a rendering artefact, which
//      is worse than an obvious clash because nobody files it.
//
// TO RE-MEASURE: contrast every ramp stop against all three pin targets under both CVD
// simulations, and re-solve for the darkest stop that still clears 7:1 COMPOSITED OVER THE
// REAL BASEMAP. Compositing over pure white is what made the two handed-over candidates
// look like they passed.
//
// Still fully config-driven via cfg.map.bins — a host can restore any ramp it wants.
//
// ── THE RAMP IS TWO INDEPENDENT FACTS: COLOURS (below) and THRESHOLDS (resolved after) ──────
// These were ONE array until the heartbeat-threshold card split them, and the split is the point.
// The five hexes are a MEASURED, dataset-independent answer to the contrast constraints argued at
// length above — they do not change when the data changes. The five EDGES are the opposite: pure
// dataset assumption (~2000 people groups), and they MUST change when the data changes. Fusing
// them meant a host could not move a threshold without restating every hex, which silently
// reverts the contrast work; and could not restyle without restating every edge. Separate arrays,
// zipped at the end, so each can be set alone.
// ── ★ THE HEARTBEAT RED, AND WHY THE RAMP COULD FINALLY DARKEN ────────────────────────────
// (card BUILD-HEARTBEAT-ZONES-IN-LABEL-RED)
//
// Asked: a darker red, a brighter red — the red people use on labels to make
// it look like a brand — the brand red people put on peanut butter jars. Like that
// heart red, because those are the HEARTBEAT ZONES."
//
// THE SPEC IS A REAL, MEASURABLE COLOUR FAMILY, not a vibe. Sampled in OKLCh, the reds actually
// printed on jar labels cluster tightly:
//     Campbell's/Coca-Cola #d2232a L.557 C.208 H25.8 · Heinz #d21f26 L.555 C.210 H26.2
//     fire-engine #ce2029 L.548 C.206 H25.5 · classic label red #c8102e L.530 C.207 H22.3
// So "label red" = L 0.53-0.57, C ~0.20, H 22-27. The new top bin '#cd2027' lands at
// L 0.546 / C 0.205 / H 26.0 — inside that cluster, between Heinz and fire-engine. That is the
// whole derivation: the spec named a brand family, and the family has coordinates.
//
// ★ WHY THIS DARKENING IS NOW LEGAL WHEN THE NOTE ABOVE FORBADE IT. The paragraph above says the
// ramp "may not be darkened to look more serious" because darkness kills the navy pin — and that
// was TRUE WHILE THE PIN WAS NAVY. Contrast is driven by relative luminance, so a DARK pin needs a
// LIGHT ground. The pin is now ORANGE (see the pin note below), which is a LIGHT symbol, and a
// light symbol wants a DARK ground. The constraint did not get violated, it INVERTED. The report's
// two asks — a deeper red and an orange pin — are not in tension; each is what makes the other
// affordable. This is why both changed in one commit: splitting them would have shipped a broken
// intermediate state in either order.
//
// MEASURED (fill-opacity 0.78 over Positron's real background #f2f3f0), effective pin visibility
// is max(orange fill, white stroke) because the pin is a sandwich and either band can carry it:
//     no-data 2.77 · bin1 2.07 · bin2 1.83 · bin3 2.31 · bin4 3.00 · bin5 4.16
// ★ WORST IS bin2 AT 1.83, AND ITS LOCATION IS THE FINDING. The fill carries the pale end and the
// stroke carries the dark end; they cross at bin2 where neither is strong. That V is structural —
// every orange has it, merely shifted, because the ramp must sweep THROUGH the pin's own luminance
// somewhere. Swept across all true oranges and all plausible ramps, the worst case saturates at
// 1.92-1.98 and will not move. Tuning stopped there rather than spending more darkness on a number
// that does not respond; the remaining budget went to the actual spec, the label red.
//
// THE ORDER IS STILL CARRIED BY LIGHTNESS ALONE, which is what keeps the red honest:
//     0.849 > 0.774 > 0.697 > 0.621 > 0.546   (every step >= 0.05, so no two bins look alike)
// Simulated: deuteranopia 0.853>0.781>0.707>0.634>0.563, protanopia 0.820>0.730>0.635>0.537>0.434
// — both STRICTLY DECREASING, so the ramp reads for the 8% of men with a red-green deficiency.
// Accent '#92b195' is still absent and still far away: nearest bin is 116.5° distant in hue.
//
// Re-measure/re-solve: the solver used here is reproduced in the card's notes (OKLab ramp build +
// WCAG contrast over the composited Positron ground + Machado CVD matrices).
//
// ── ★ WIDENED 2026-09-23 (card P0, reported) + NAMED RAMP REGISTRY ────────────────────────────
// The 60-149 red was the same red as the heartbeat zone, so the red shades are spaced further
// apart to tell the bands apart, and a grey-to-black scale is registered as a backdrop so the
// ramp can swap from red to black.
//
// ★ THE RAMP WAS ALREADY MATHEMATICALLY EVEN, AND HE WAS STILL RIGHT — that tension is the
// finding, not a contradiction to argue with. Measured in plain sRGB Euclidean distance, the old
// bin4->bin5 step (60.0) LOOKED like the biggest jump in the ramp. That measurement was lying:
// RGB distance is not a perceptual metric, and re-measured in CIEDE2000 (the correct delta) the
// OLD ramp's steps were 8.57 / 8.74 / 9.28 / 9.96 — a MONOTONICALLY GROWING but still fairly
// TIGHT band. Once deep into saturated red, hue and chroma stop carrying much extra information;
// nearly all the ramp's perceptual "space" was being spent on lightness alone, evenly, which is
// exactly why two adjacent dark bins read as "the same red" even though no bin technically
// repeats another.
//
// THE FIX: widen the total range (paler start, darker end) and re-map the five stops onto
// NON-UNIFORM lightness steps, so the TOP of the ramp — where the reported complaint actually
// lives — gets more separation than a linear spread would give it. Hue drifts slightly toward
// the label-red family's lower end (H 35 -> 27, still inside the jar-label cluster this ramp was
// built to match) and chroma rises further at the dark end, both legal moves per the "chroma is
// cheap in this range" finding above.
//
//   OLD (dE2000)   #f6beb3->#ef9d8e 8.57 · #ef9d8e->#e57a6c 8.74 · #e57a6c->#da544a 9.28 · #da544a->#cd2027 9.96
//   NEW (dE2000)   #f4cec4->#ecaea1 8.83 · #ecaea1->#e08678 10.37 · #e08678->#ce544b 13.14 · #ce544b->#b10010 15.17
//
// ★ THE BIN NAMED IN THAT REPORT (bin4->bin5, 60-149 vs the heartbeat zone) GOES FROM dE2000=9.96 TO
// 15.17 — a 52% larger perceptual step, and now the LARGEST step in the ramp (as it should be: the
// heartbeat zone is the one bin that must never be mistaken for its neighbour). Every other step
// grew too, so nothing else got relatively worse.
//
// ★ THE PIN-VISIBILITY CONSTRAINT (the load-bearing one — see the note above) DID NOT REGRESS.
// Re-measured the same way (orange fill vs white stroke, max of the two, composited at
// fill-opacity 0.78 over the real Positron ground #f2f3f0):
//   OLD worst  1.83 (bin2)   NEW worst  1.84 (bin2)   — statistically the same floor.
// Every OTHER bin's pin visibility improved or held (bin5 in particular: 4.16 -> 5.53, because a
// darker red gives the light pin more room). The border (fill-outline-color #6d766e) was already
// weak at the dark end (old worst 1.13 at bin5) and stayed weak but did not get worse (new 1.18).
//
// Re-verified CVD-safe (deuteranopia + protanopia luminance strictly decreasing) and accent-free
// (#92b195 nearest hue distance grew slightly, to 112-121°, still nowhere close).
//
// ★ THE HONEST LIMIT: this is a NUMERICAL widening, verified by CIEDE2000/WCAG/CVD math, not a
// human looking at a painted map (this box has no WebGL — see the report). The numbers say the
// separation is real and larger; whether it now READS as "clearly distinct" is a product decision.
//
// ── ★ GREYSCALE — A SWAPPABLE BACKDROP, NOT A DEFAULT ─────────────────────────────────────────
// Asked: a grey scale backdrop from grey to black, in case the ramp swaps from red to
// black scale — an OPTION to reach for, not a reversal of the red decision above
// (BUILD-SHADES-OF-RED-FOR-THE-DARKEST-PLACES) or of the earlier grey->black rejection (see the
// "why it is PALE and no longer grey->black" note at the top of this file — that history is
// about the OLD pale-coral ramp fighting a NAVY pin; it does not bind here, because greyscale is
// opt-in config, not a default this ramp reverts to).
//
// Same discipline as the red ramp: non-uniform OKLCh lightness steps (paler start, near-black
// end), re-measured rather than eyeballed.
//   dE2000 steps: #e8e8e8->#a9a9a9 15.65 · #a9a9a9->#6f6f6f 20.26 · #6f6f6f->#3a3a3a 18.59 ·
//                 #3a3a3a->#060606 14.69
//   pin visibility worst 1.96 (bin2) — slightly ABOVE the red ramp's 1.84 floor, i.e. no worse.
//   CVD-safe (achromatic — colour-blindness cannot affect an achromatic ramp by construction).
//
// ── ★ SELECTION — cfg.map.colorRamp, THE SAME PATTERN AS mapStyle ─────────────────────────────
// A ramp is selected by NAME (mirrors library/styles/registry.js's STYLE_REGISTRY), not by a host
// pasting five hexes. `cfg.map.colorRamp` resolves through RAMP_PRESETS, defaulting to
// 'heartbeat-red' so a host with no config renders byte-identical to before this change.
// `cfg.map.bins` (a complete ramp incl. edges) still wins outright if set — that escape hatch is
// unchanged and sits ABOVE this one in resolveBins().
// ★ WHY THE REGISTRY IS DECLARED INSIDE THIS const, NOT ABOVE IT AS ITS OWN STATEMENT. The
// heartbeat-threshold gate (internal/check-heartbeat-threshold.mjs) extracts the live resolver by
// slicing this SOURCE FILE from this declaration's own opening text onward — a declaration ABOVE
// that marker is invisible to the sliced region and throws ReferenceError inside the gate's own
// eval. (Do not literally spell out the marker string in a comment above it — the gate's indexOf
// would then match the comment instead of the real declaration, which is the bug this note fixes.)
// An IIFE keeps RAMP_PRESETS named and referenceable (for anything that wants to introspect the
// available ramp names) while keeping the whole selection INSIDE the region the gate executes, so
// the gate always runs against the exact resolver that ships, not a stale stand-in for it.
const BIN_COLORS = (() => {
  const RAMP_PRESETS = {
    'heartbeat-red': ['#f4cec4', '#ecaea1', '#e08678', '#ce544b', '#b10010'],
    // ★ BIN 1 DARKENED #e8e8e8 -> #c9c9c9: Bangladesh appeared not to show as a polygon. It WAS rendering -- queryRenderedFeatures returned the BGD polygon painted
    // #e8e8e8 -- but against the #f3f3f1 no-data surface that is a 1.06 contrast ratio at 0.78
    // opacity: a 1-4-group country was pixel-identical to an empty one. The ramp's first step
    // must be separated from NO-DATA at least as clearly as from bin 2, or the lowest bin
    // silently reads as "not in the data" (ColorBrewer sequential ramps assume no competing
    // no-data fill on the same canvas; when there is one, start the ramp a step darker).
    greyscale: ['#c9c9c9', '#a9a9a9', '#6f6f6f', '#3a3a3a', '#060606'],
  }
  return RAMP_PRESETS[cfg.map?.colorRamp] || RAMP_PRESETS['heartbeat-red']
})()

// ── HEARTBEAT ZONES: the thresholds, resolved from config ────────────────────────────────────
// A HEARTBEAT ZONE is a country in the TOP bin — "the most people groups in them". The edge is
// cfg.map.heartbeatThreshold (default 150, see dashboard.config.js for the full why). Everything
// here is derived so that a host can set ONE number and get a coherent ramp.
const HEARTBEAT_DEFAULTS = { heartbeatThreshold: 150, binThresholds: [5, 20, 60], mode: 'fixed', quantile: 0.1 }

// Format a bin's label from its own edges, so a moved threshold RELABELS the legend. A hard-coded
// label set was the second half of the same bug: change the edge and the legend keeps saying
// '150+' while the map bins at 40, which is worse than no legend because it is confidently wrong.
// ★ THE TOP BIN IS NAMED, NOT JUST NUMBERED. The unbounded bin is the HEARTBEAT ZONE — the
// the word used for it ("those are the heartbeat zones", "God's heart beats loudest for the
// darkest places"). It gets the name appended to its count so the legend teaches what the deepest
// red MEANS rather than only how many people groups it takes to get there; the number stays first
// because the number is what the swatch actually encodes. Derived here, at the only place a label
// is produced, so a host that moves heartbeatThreshold relabels correctly and CANNOT end up with
// the name on a bin that is no longer the top one.
function binLabel(lo, hi) {
  if (!Number.isFinite(hi)) return `${lo}+ · ${T('dashboard.heartbeat_zone', 'heartbeat zone')}`
  return hi - 1 <= lo ? `${lo}` : `${lo}–${hi - 1}`
}

// Rescale the three lower edges when only the heartbeat threshold moves. The defaults sit at
// 1/30, 2/15 and 2/5 of 150; preserving those RATIOS keeps the ramp's shape (a long tail of small
// counts, a short head of large ones) at any dataset size, instead of collapsing every country
// into one bin. Edges are deduped+sorted so a small threshold cannot produce a non-monotonic ramp.
// ★ EDGES START AT 2, NOT 1 — a MEASURED correction, not a style choice. `colorFor` tests
// `count < b.upTo`, so an edge of 1 makes a bin NO count can ever reach: the ramp silently loses a
// colour stop and paints in 4 bands while the legend advertises 5. Rescaling to a small threshold
// (40) produced exactly that dead `1 <1` bin. 2 is the lowest reachable boundary (it captures
// count 1), so clamping there keeps all five bands paintable at any threshold.
const MIN_EDGE = 2
function rescaleEdges(threshold) {
  const ratios = HEARTBEAT_DEFAULTS.binThresholds.map((t) => t / HEARTBEAT_DEFAULTS.heartbeatThreshold)
  const raw = ratios.map((r) => Math.max(MIN_EDGE, Math.round(r * threshold)))
  return monotonic(raw, threshold)
}
// Force a strictly-ascending, in-range edge list. Shared by every path so no mode can emit a
// non-monotonic ramp (which would make an earlier bin shadow a later one and paint nonsense).
function monotonic(edges, threshold) {
  const out = []
  for (const e of edges) {
    const v = Math.max(e, out.length ? out[out.length - 1] + 1 : MIN_EDGE)
    if (v < threshold) out.push(v)
  }
  return out
}

// 'quantile' mode (OPT-IN, never the default): derive the edges from the counts actually present,
// so an unknown dataset self-scales. Returns null when there is too little data to be meaningful,
// and the caller falls back to the fixed edges — a derived ramp from 3 countries is noise.
function quantileEdges(counts, q) {
  const vals = [...counts].filter((n) => n > 0).sort((a, b) => a - b)
  if (vals.length < 8) return null
  const at = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * vals.length)))]
  // +1 on the top quantile: `at()` returns a VALUE PRESENT in the data, and edges are exclusive
  // (`count < upTo`), so using it raw would push the very countries at that value OUT of the
  // heartbeat bin — the opposite of "the top q% are heartbeat zones".
  const top = at(1 - q) + 1
  const lower = [0.25, 0.5, 0.75].map((p) => at(p))
  // Through the SAME monotonic() clamp as every other path, so quantile cannot emit the dead
  // `1 <1` bin that the rescale path did. A skewed count distribution (most countries at 1-2)
  // collapses several quantiles onto the same value, which is precisely when that bug appears.
  return { threshold: top, edges: monotonic(lower, top) }
}

// Resolve the final bins. PRECEDENCE, most explicit first:
//   1. cfg.map.bins          — a complete ramp, honoured verbatim (the pre-existing escape hatch)
//   2. cfg.map.binThresholds — explicit lower edges + heartbeatThreshold
//   3. heartbeatThreshold    — one number; lower edges rescale to keep the ramp's shape
//   4. nothing               — the historical 5/20/60/150 ramp, byte-identical
function resolveBins(counts) {
  if (Array.isArray(cfg.map?.bins) && cfg.map.bins.length) return cfg.map.bins
  const m = cfg.map || {}
  let threshold = Number(m.heartbeatThreshold) > 0 ? Number(m.heartbeatThreshold) : HEARTBEAT_DEFAULTS.heartbeatThreshold
  let edges = null
  if (m.heartbeatMode === 'quantile') {
    const q = quantileEdges(counts || [], Number(m.heartbeatQuantile) > 0 ? Number(m.heartbeatQuantile) : HEARTBEAT_DEFAULTS.quantile)
    if (q) { threshold = q.threshold; edges = q.edges }
  }
  if (!edges) {
    edges = Array.isArray(m.binThresholds) && m.binThresholds.length
      ? [...new Set(m.binThresholds.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < threshold))].sort((a, b) => a - b)
      : (Number(m.heartbeatThreshold) > 0 ? rescaleEdges(threshold) : HEARTBEAT_DEFAULTS.binThresholds)
  }
  const ups = [...edges, threshold, Infinity].slice(0, BIN_COLORS.length)
  while (ups.length < BIN_COLORS.length) ups.splice(ups.length - 1, 0, ups[ups.length - 2] + 1)
  let lo = 1
  return ups.map((upTo, i) => { const b = { upTo, c: BIN_COLORS[i], l: binLabel(lo, upTo) }; lo = upTo; return b })
}

// COMPUTED, not a const, because 'quantile' mode reads the counts that are actually loaded and
// those arrive asynchronously. In the default 'fixed' mode this never recomputes to a different
// value — resolveBins ignores its argument unless the host opted into quantile — so the common
// path is unchanged. applyPaint() already re-runs on data change, so the legend and the fill stay
// in agreement automatically.
const BINS = computed(() => resolveBins([...countryCounts.value.values()]))
// No-data countries sit at the Material Light SURFACE token, so an empty country reads as
// "the page", not as a sixth data bin. (Was '#f2f2f2', an off-palette near-white.)
const NO_DATA = cfg.map?.noDataColor || '#f3f3f1'
function colorFor(count) {
  if (!count) return NO_DATA
  const bins = BINS.value
  for (const b of bins) { if (count < b.upTo) return b.c }
  return bins[bins.length - 1].c
}
// in-map legend (P5): the choropleth bins, shown bottom-right over the map.
// ── ★ THE LEGEND MUST SHOW WHAT THE MAP PAINTS, NOT THE RAW HEX ──────────────────────────────
// The swatch used to render `b.c` directly. The MAP never paints that colour: the choropleth fill
// composites at fill-opacity 0.78 over Positron's background #f2f3f0, so every swatch was showing
// a colour that appears nowhere on the map.
//
// MEASURED 2026-09-23, chip-vs-actual-fill in CIEDE2000-scale dE:
//     #f4cec4 -> #f4d6ce   dE  4.07
//     #ecaea1 -> #edbdb2   dE  7.53
//     #e08678 -> #e49e92   dE 11.93
//     #ce544b -> #d6776f   dE 17.13
//     #b10010 -> #bf3541   dE 21.14
//
// ★ THE ERROR GROWS WITH THE BIN, AND AT THE TOP IT IS THE SIZE OF A WHOLE BIN STEP. The gap
// between the top two bins is 25.45 as painted; the legend's own error on the heartbeat bin is
// 21.14. So a reader comparing the two darkest swatches was comparing two colours neither of which
// was on the map — which is a strong candidate for the report that "60-149 red is the same
// red as the heartbeat zone", independent of the ramp itself.
//
// Compositing here rather than dropping the opacity on the map: 0.78 is deliberate (it lets the
// basemap's country borders and labels read THROUGH the choropleth), and this file's own notes
// measure pin contrast AT 0.78. The legend is the half that was lying.
const LEGEND_BG = '#f2f3f0'      // Positron's background — the surface the fill composites over
const LEGEND_FILL_ALPHA = 0.78   // must track the fill-opacity used by the choropleth layer

function asPainted(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return hex                       // non-hex (a css var, a name): leave it alone
  const c = m[1], bg = LEGEND_BG.slice(1)
  const mix = (i) => {
    const f = parseInt(c.slice(i * 2, i * 2 + 2), 16)
    const b = parseInt(bg.slice(i * 2, i * 2 + 2), 16)
    return Math.round(LEGEND_FILL_ALPHA * f + (1 - LEGEND_FILL_ALPHA) * b)
  }
  return '#' + [0, 1, 2].map((i) => mix(i).toString(16).padStart(2, '0')).join('')
}

const LEGEND_BINS = computed(() => BINS.value.map((b) => ({ c: asPainted(b.c), l: b.l })))
// Selection "pen": ring drawn over the currently-selected PG pin(s). Config-driven
// (cfg.map.selectedColor).
//
// ── ★ THIS MOVED FROM NEON-ORANGE TO NAVY, AND IT HAD TO ──────────────────────────────────
// A COLLISION NOBODY ASKED ABOUT, FOUND BY MEASURING. The default was '#ff6a00' — chosen back
// when pins were NAVY, so an orange ring was maximally distinct from the thing it ringed. Turning
// the PIN orange silently destroyed that: '#ef6c00' vs '#ff6a00' is 3.4° apart in hue at 1.07
// contrast, i.e. the SELECTED state would have become invisible — a working feature broken as a
// side effect of a colour preference, and exactly the kind of regression that ships unnoticed
// because nothing errors. The pin colour and the selection colour are COUPLED; changing one
// without re-solving the other is the bug.
//
// NAVY IS THE ANSWER, AND THE PIN MOVE IS WHAT FREED IT. '#1a237e' is the colour the pin just
// vacated, so it is already a product-standard token and already proven to sit on this ramp.
// Measured against every candidate, it wins on every axis at once:
//     vs the orange pin 4.30 · hue distance 138° · worst vs any bin 3.18
//     (cyan 1.13-1.34 vs pin · indigoA700 1.85 · purple800 3.05 — all worse on at least one)
// So the two symbols now split the palette cleanly: warm ORANGE says "a people group is here",
// cool NAVY says "this is the one you selected", and neither can be mistaken for the red ground.
const SEL_COLOR = cfg.map?.selectedColor || '#1a237e'
function buildPaint() {
  const counts = countryCounts.value
  const colorPairs = []; const opacityIsos = []
  counts.forEach((cnt, iso) => { colorPairs.push(iso, colorFor(cnt)); opacityIsos.push(iso) })
  const fillColor = colorPairs.length ? ['match', ['get', 'iso_3166_1_alpha_3'], ...colorPairs, NO_DATA] : NO_DATA
  const anyFilter = Object.keys(filterSet).length > 0
  const fillOpacity = anyFilter && opacityIsos.length
    ? ['match', ['get', 'iso_3166_1_alpha_3'], ...opacityIsos.flatMap((i) => [i, 0.92]), 0.12]
    : 0.78
  return { fillColor, fillOpacity }
}
// ── ★ THE DOT MUST SAY WHICH ONES HAVE PRAYER (card BUG-PRAYER-FILTER-NOT-APPLYING-TO-THE-MAP) ──
// Reported: sorting by has-prayer needs to show which ones have prayer and which one…
// The dots were not changing based on that filter.
//
// MEASURED FIRST, and the measurement moved the fix. The filter was NOT broken: selecting
// "Has Prayer" already narrowed the rd-bubbles source 2107 -> 689 features, exactly matching the
// dropdown's own tally, disjoint from "Needs Prayer" (1418), and round-tripping on clear. What was
// broken is that `circle-color` was the flat literal '#ef6c00' — read back off the LIVE layer with
// getPaintProperty, which returned the bare string, not an expression. So every dot was the same
// orange whether it had prayer or not: the map answered a prayer question with no prayer
// information in it, and the remaining dots looked identical to the ones shown before. That is
// why a working filter reads as "not applying".
//
// ★ WHY THIS IS CONDITIONAL AND NOT A GLOBAL RECOLOUR. The orange is not arbitrary — it is a
// a product decision with a contrast analysis attached (see the long note on the layer's paint block:
// hue 48.1°, the darkest true orange, chosen to survive the pale choropleth bins, with the white
// stroke load-bearing beneath it). Painting every dot by prayer at all times would silently discard
// that work and change every OTHER view of this map. So: orange remains the pin's identity, and the
// 3-tier prayer ramp takes over ONLY while the prayer axis is the active question. The colour
// appears exactly when the user asks for it, and nothing else regresses.
const PRAYER_FACET = 'prayer_level'
function prayerAxisActive() { return Object.prototype.hasOwnProperty.call(filterSet, PRAYER_FACET) }

// ★ PIN STYLE IS CONFIG, NOT A LITERAL (card BUILD-EXPOSE-PIN-STYLE-AS-CONFIG).
// The pin fill and its stroke were hardcoded here while the SELECTION ring beside them already read
// `cfg.map?.selectedColor` — so half the pin styling was parameterised and half was not, with no
// reason for the split. These follow the same shape: a config read with the CURRENT value as the
// fallback, so a config that sets neither renders byte-for-byte as before.
//
// WHY IT MATTERS BEYOND TIDINESS: the heartbeat threshold was made a variable so this dashboard can
// point at a dataset that is not these 2107 people groups. A different corpus can want a different
// pin — the orange was chosen against THIS choropleth, and its legibility is a property of the pair,
// not of the colour. Leaving the pin hardcoded would have made the dashboard reusable in its data
// and fixed in its palette.
//
// THE WHITE STROKE IS LOAD-BEARING, not decoration: it is what carries the pin over the dark bins
// where the orange fill falls to ~1.03 contrast, and it is what stopped the pins reading as "eyes".
// Overriding it is allowed, but a host that sets it to the fill colour will reproduce that defect.
// ★ VERIFIED: the DEFAULTS. A built run with no config reports circle-color #ef6c00 and
// circle-stroke-color #ffffff — byte-identical to the literals these replaced, so nothing
// regressed. NOT VERIFIED IN A BROWSER: that an OVERRIDE takes effect. Two attempts to inject
// profile-config at runtime left the defaults in place, and that is expected rather than a bug —
// like SEL_COLOR beside it, this is a setup-time const, so config must be present when the element
// UPGRADES, and I could not prove my injection beat that moment. The channel itself is proven by
// check:heartbeat, which exercises cfg.map.heartbeatThreshold — but statically, against
// dashboard.config.js, never through a live attribute. Treat the override as untested until an
// embedder or a gate drives it for real.
const PIN_COLOR = cfg.map?.pinColor || '#ef6c00'
const PIN_STROKE = cfg.map?.pinStrokeColor || '#ffffff'

function bubbleColor() {
  // applyColor() reads ['get','peoplePraying'] — the property bubbleGeo() now emits.
  return prayerAxisActive() ? prayerColorExpr({ colorSource: 'properties' }) : PIN_COLOR
}
function applyPaint() {
  const m = map.value; if (!m || !m.getLayer('rd-choropleth')) return
  const { fillColor, fillOpacity } = buildPaint()
  m.setPaintProperty('rd-choropleth', 'fill-color', fillColor)
  m.setPaintProperty('rd-choropleth', 'fill-opacity', fillOpacity)
  // bubbles source refresh
  const src = m.getSource('rd-bubbles')
  if (src) src.setData(bubbleGeo())
  // ★ RE-APPLY THE DOT COLOUR. The layer is created ONCE, so its paint is a snapshot of whatever
  // bubbleColor() returned at addLayer() time. Without this line the ramp would only ever appear if
  // a prayer filter happened to be active before the map was built — which is never, on first load.
  if (m.getLayer('rd-bubble-layer')) m.setPaintProperty('rd-bubble-layer', 'circle-color', bubbleColor())
}
// `peoplePraying` RIDES ALONG ON EVERY FEATURE. It is what the prayer colour expression reads
// (['get','peoplePraying']), and without it the expression silently evaluates every dot to the
// "needs prayer" default — a map that is confidently wrong rather than obviously broken.
// The field arrives either flat (`4`) or as a {value,label} object, exactly as the prayer FACET
// in dashboard.config.js already handles it; the same two-shape coercion is applied here so the
// COLOUR and the FILTER can never read the row differently.
function prayingOf(r) {
  const n = r?.people_praying
  const raw = n && typeof n === 'object' ? n.value : n
  return Number(raw) || 0
}
function bubbleGeo() {
  return {
    type: 'FeatureCollection',
    features: filteredRows.value.filter((r) => Number(r.latitude) && Number(r.longitude))
      .map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(r.longitude), Number(r.latitude)] }, properties: { pop: Number(r.population) || 0, slug: r.slug || '', name: r.name || '', peoplePraying: prayingOf(r) } })),
  }
}
// Selection-pen geojson: the currently-selected PG(s) from the bus's selectionSet. Sourced from the
// full row store (not filteredRows) so the pen stays visible even when the row is filtered out of scope.
// Empty when nothing is selected → the highlight layer renders nothing.
function selectedGeo() {
  const sel = bus?.selectionSet
  const rows = dash?.rows?.value || []
  if (!sel || !sel.size) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: rows.filter((r) => sel.has(r.slug) && Number(r.latitude) && Number(r.longitude))
      .map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(r.longitude), Number(r.latitude)] }, properties: { slug: r.slug || '', name: r.name || '' } })),
  }
}
function refreshSelected() {
  const m = map.value; if (!m) return
  const src = m.getSource('rd-bubble-selected')
  if (src) src.setData(selectedGeo())
}
function addLayers() {
  const m = map.value; if (!m || added) return
  added = true
  // ── COUNTRY POLYGONS: the choropleth's source, PER PROVIDER ─────────────────────────────────
  // ★ THIS IS WHY THE MapLibre SWAP IS NOT ONE CONFIG LINE. The choropleth read from
  // `mapbox://mapbox.country-boundaries-v1`, a Mapbox-hosted VECTOR TILESET. MapLibre cannot
  // fetch a mapbox:// URL at all — it throws
  //     Fetch API cannot load mapbox://mapbox.country-boundaries-v1. URL scheme "mapbox" is not supported
  // and then renders the basemap perfectly with NO choropleth on it. MEASURED, not predicted:
  // the first MapLibre screenshot showed a correct black-and-blue galaxy map on which every
  // landmass was uniform black while the legend still advertised five populated bins. It looked
  // like a deliberate dark style. The primary data layer was simply missing.
  //
  // So the swap needs a KEYLESS equivalent, and the tree already ships one:
  // assets/boundaries/world-adm0.geojson (162 ADM0 features), already staged by generate-tree
  // and already consumed by three other plugins (upg-100-list, connectivity-map,
  // resources-map) through the same resolveAssetsBase helper. No new asset, no new dependency.
  //
  // ★ THE KEY BRIDGE, AND WHY IT IS DONE HERE RATHER THAN IN THE EXPRESSIONS. The tileset names
  // the ISO field `iso_3166_1_alpha_3`; the geojson names it `iso3`. Six separate places read
  // that field — buildPaint's fill-color AND fill-opacity match expressions, the click handler,
  // the hover handler, and the queryRenderedFeatures path. Branching each of them would be six
  // chances to miss one, and a missed one fails silently (a `match` on an absent property just
  // falls through to its default, i.e. renders as no-data). Instead the property is normalized
  // ONCE, as the data is loaded, so every downstream expression keeps reading the single name it
  // always read and the Mapbox path stays byte-for-byte unchanged.
  if (!m.getSource('rd-countries')) {
    if (isMaplibreProvider.value) {
      // Add EMPTY first, then setData after the fetch: addLayer below must run synchronously to
      // keep this layer underneath the pins (layer order is insertion order). An awaited fetch
      // here would put the choropleth on TOP of every bubble.
      m.addSource('rd-countries', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      countryBoundaries()
        .then((gj) => {
          const src = map.value && map.value.getSource('rd-countries')
          if (src) src.setData(gj)
        })
        .catch((e) => console.warn('[rdash] country boundaries failed to load', e))
    } else {
      m.addSource('rd-countries', { type: 'vector', url: 'mapbox://mapbox.country-boundaries-v1' })
    }
  }
  const { fillColor, fillOpacity } = buildPaint()
  m.addLayer({ id: 'rd-choropleth', type: 'fill', source: 'rd-countries',
    // 'source-layer' applies to VECTOR TILE sources only. On a geojson source MapLibre rejects
    // the layer outright ("does not need a source-layer"), so it is set for Mapbox alone.
    ...(isMaplibreProvider.value ? {} : { 'source-layer': 'country_boundaries' }),
    // COUNTRY BORDERS. The outline was '#ffffff', which was legible only because the fill
    // underneath ran to black. On a pale ramp a white border measures 1.11–1.84 — it would
    // vanish and the map would read as one undifferentiated wash. The Material Light MUTED
    // token holds up across the whole ramp instead: re-measured on the HEART RED ramp against
    // the real Positron ground, 4.23 / 3.83 / 3.49 / 3.14 / 2.81 / 2.51 (no-data → darkest
    // bin), so every border stays visible.
    // This is the second-order cost of paling the fill, fixed rather than shipped.
    paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity, 'fill-outline-color': cfg.map?.outlineColor || '#6d766e' } })
  m.addSource('rd-bubbles', { type: 'geojson', data: bubbleGeo() })
  // ── PG pins: NAVY dot + WHITE ring (history: BUG-DEAF-PIN-COLOUR-ORANGE-IS-UNREADABLE) ──
  // HISTORY, kept because it is why the pin is NOT orange and NOT semi-transparent. The pins
  // were once '#e67e22' at circle-opacity 0.6. The alpha was the real fault: at 0.6 the pin
  // composited with whatever bin sat underneath, so it rendered a DIFFERENT colour in every
  // country and measured 1.18-1.22 over the mid-greys - essentially invisible. Orange was
  // never a hue problem; it was an opacity bug. Both lessons still bind: the pin is ONE fixed
  // colour at FULL opacity, everywhere.
  //
  // ★ SUPERSEDED 2026-09-22 — THE PIN IS NO LONGER NAVY. This paragraph used to read "WHAT IT IS
  // NOW. Fill '#1a237e'... worst case 7.07", and both halves are now false: the fill is the orange
  // '#ef6c00' (see the layer below) and those contrast figures measured a pale coral ramp that no
  // longer ships. Kept only so the NAVY-ERA rejections stay readable:
  //   '#0d47a1' (Blue 900) - too light.
  //   Tinting the pin per bin - reintroduces the original alpha fault. ★ STILL BINDING.
  //   Reverting to orange (once ruled out) - ★ NO LONGER TRUE. That held while the ramp was PALE
  //     and the pin navy; against the new red ramp the pin moved to orange, which supersedes it.
  //     Navy did not lose on contrast - it was freed to become the SELECTION ring, which had to
  //     move because an orange ring on an orange pin measured 1.07. See SEL_COLOR.
  //
  // NOTE FOR DARK STYLES. This product is Material LIGHT only (no prefers-color-scheme:dark
  // in this bundle), so only the light pairing ships. A genuinely dark style would swap the
  // two stroke colours, not change the fill.
  // ── ★ WHITE RING + A SMALLER ZOOMED-OUT FOOTPRINT ──
  // (card BUG-ALL-PINS-TURNED-NAVY-ONLY-DEAF-SHOULD-BE)
  //
  // Asked: keep the blue dots. Do not revert to orange; add WHITE RINGS around
  // the blue dots so that they do not look like a heat map. The white ring should not
  // underlap each other — ALL the white rings should be visible when you zoom out. And the
  // dots [could] be a little bit smaller when you zoom out... That way we will not have a
  // lot of complicated logic." That last clause is a DESIGN INSTRUCTION: a zoom-scaled
  // radius, NOT clustering. No clustering is added here.
  //
  // WHY THE OLD NUMBERS READ AS A HEAT MAP. The halo already existed, but it spent the
  // low-zoom budget backwards: at z1 the halo was r=4.5 (a 9px footprint) while the white
  // band was only 4.5 - (2.4 + 1) = 1.1px. So neighbouring pins overlapped LONG before the
  // white was thick enough to read as a separator, and a dense region merged into one navy
  // mass. The fix is one idea in two moves: SHRINK the whole footprint at low zoom (fewer
  // collisions) while GROWING the white band's share of it (visible separation).
  //
  // z1:  navy r=1.6 (+0 ring) inside a white r=3.4  -> band 1.8px, footprint 6.8px (was 9)
  // z6:  navy r=5.0 (+0 ring) inside a white r=7.4  -> band 2.4px, footprint 14.8px
  // The band is now ABOVE 1px at every zoom in the ramp, so it survives rasterisation at the
  // zoomed-out view where the heat map was seen. The footprint at z1 drops 24%, which
  // gives the pins a slightly smaller spread when zoomed out.
  //
  // The dark 1px ring on the navy dot is REMOVED: its job was to separate navy from the
  // near-white halo, but a true white ring already does that at 13.2:1, and at r=1.6 a 1px
  // dark ring was over half the dot's visible area — that is what made a zoomed-out pin look
  // muddy rather than navy. Halo colour moves from '#f3f3f1' (Material surface) to a literal
  // '#fff' at full opacity, because WHITE rings were asked for and 0.95 alpha over a
  // grey choropleth bin was rendering them off-white.
  //
  // HIT-TESTING is unchanged: 'rd-bubble-layer' keeps its id — onBubbleClick, onMapClick's
  // pin-guard and the __rdashPinAt verify hook all query it by name. As of 2026-09-22 it is the
  // ONLY bubble layer: 'rd-bubble-halo' was deleted when the pin collapsed to one circle with a
  // white stroke (see the long note below). Note the hit target shrinks with the dot at low zoom;
  // __rdashPinAt already queries a +/-7px bbox, which still covers the z1 footprint — and the
  // footprint GREW slightly (r 1.6 -> 2.2 at z1), so the existing bbox remains sufficient.
  // ── ★ THE PIN IS NOW SELF-CONTAINED (card BUILD-MAP-STYLE-MUST-BE-BEAUTIFUL) ──────────
  // The white ring used to depend on the GROUND for its visibility, and measured only
  // 1.09–1.24 against the light bins — so on pale countries the ring vanished and the dots
  // merged into the "heat map" look that was reported. Paling the ramp (above) fixes the
  // DOT but makes that worse, not better: the ring's contrast vs the current ramp is 1.11–1.87.
  //
  // THE RESOLUTION IS TO STOP ASKING THE GROUND TO DO THE RING'S JOB. The ring's real job is
  // DOT-FROM-DOT separation, and that number is ground-independent and excellent:
  //     white ring vs navy dot = 13.24:1
  // Adding a thin NAVY OUTER EDGE on the halo closes the last gap — the pin becomes a
  // navy/white/navy sandwich that carries its own contrast, so it reads identically on the
  // palest and the darkest bin, and on any basemap a host swaps in. Nothing about the pin
  // depends on the choropleth any more, which is what ends the recurring pin-colour argument.
  //
  // Blue dots + white rings are the settled design (blue dots, not orange, each with a WHITE RING) —
  // unchanged here. Radii are unchanged too, so the zoomed-out spacing is preserved: z1 navy r=1.6 inside white r=3.4
  // (1.8px band), z6 navy r=5.0 inside white r=7.4 (2.4px band).
  //
  // HIT-TESTING unchanged: 'rd-bubble-layer' keeps its id and stays the TOP layer; the halo
  // is a separate NON-interactive layer beneath it and must not be queried.
  // ── ★ ONE CIRCLE WITH A WHITE STROKE — NOT A NAVY/WHITE/NAVY SANDWICH ──────────────────────
  // (the symptom: the pins looked like eyes, which read as unsettling)
  //
  // THE SANDWICH WAS THE BUG, and the comment above described it accurately without noticing what
  // it draws. Read outward from the centre at z1 the old construction was:
  //     navy disc r=1.6  →  white field r=3.4  →  navy stroke 0.6px
  // dark centre, light middle, dark rim. That is the anatomy of an eye — pupil, sclera, iris
  // outline — and it is why a bullseye is NAMED after one. Concentric rings sharing a centre are
  // exactly the pattern the visual system fuses into a single object; sighting equipment exploits
  // the same involuntary alignment. The inner disc sat at 47% of the halo radius at z1, squarely in
  // the proportion that reads as a PUPIL rather than as a dot with a border. Worst when zoomed out,
  // which is where a world map lives.
  //
  // THE OUTER NAVY BAND IS THE SPECIFIC CULPRIT: it closes the iris. Without it the same colours
  // read as an ordinary pin. So the fix removes a band rather than changing a colour.
  //
  // MATCHES THE MAPBOX IDIOM, which is ONE layer with a stroke, not two stacked circles. The style
  // spec draws `circle-stroke-width` OUTSIDE `circle-radius`, so a single layer already produces
  // disc-plus-ring; the old code hand-rolled that and collected a third colour band for the
  // trouble. Scaling the stroke with zoom (1.2 → 2) is the documented way to stop the ring
  // swallowing the fill when circles are small and dense at low zoom. Cartographic practice agrees:
  // Axis Maps and the ICA Commission both call for casings on symbols that OVERLAP rather than a
  // global opaque halo, and Esri names halos the single biggest cost in marker drawing performance
  // — we were paying that on a second full circle layer across every point. THE FINDING: a
  // casing that SCALES WITH ZOOM is what stops dense low-zoom rings swallowing their own fill,
  // and a global opaque halo costs more than it buys.
  //
  // ★ THE TWO RULINGS THIS PRESERVES — do not undo either:
  //   1. ONE FIXED COLOUR AT FULL OPACITY. Pins were once '#e67e22' at circle-opacity 0.6; the
  //      alpha was the real fault, compositing each pin with whatever bin sat beneath it so it
  //      rendered a different colour per country at 1.18–1.22 contrast. Never reintroduce pin
  //      alpha, never tint per bin.
  //   2. WHITE RINGS so the field does not read as a heat map, and all rings stay visible when
  //      zoomed out. Still here — it is now the stroke instead of a second layer. ★ The ring is
  //      now LOAD-BEARING rather than merely separating: it is what carries the pin on the dark
  //      bins, where the orange fill falls to 1.03-1.35. Removing it does not cost tidiness, it
  //      costs the pin.
  // ★ STALE LINE REMOVED 2026-09-22. This used to read "Navy #1a237e measures 11.91 / ... / 7.07
  // across the ramp... but the pin did not [change]." The pin HAS now changed — it is '#ef6c00' —
  // so that sentence had become the exact kind of confidently-wrong comment this file warns about
  // elsewhere. Current measured table lives in the BIN_COLORS note: effective visibility
  // 2.77 / 2.07 / 1.83 / 2.31 / 3.00 / 4.16, worst bin2 1.83.
  //
  // WHAT IS GIVEN UP, stated honestly: the outer navy band gave the white ring a hard boundary on
  // ANY ground, so over the palest bin the ring blends into the background. The ring's job is
  // separating pins from EACH OTHER (it still does that) while the DISC carries pin-vs-ground.
  //
  // ★ "MEASURE THE PALE END BEFORE CALLING THIS SETTLED" — DONE 2026-09-22, and the answer is that
  // the two bands SWAPPED ROLES when the pin went orange. Against the pale bins the white ring is
  // weak (1.11-1.48) but the orange disc is strongest there (2.77/2.07); against the dark bins the
  // disc collapses (1.03) and the ring takes over (2.31/3.00/4.16). Neither band is sufficient
  // alone and each covers the other's failure, which is why BOTH must stay. The old worry — the
  // pale end — is the end the orange disc handles best, so it is no longer the risk; the real
  // worst case moved to bin2 (1.83), where the two bands cross over.
  //
  // HIT-TESTING: 'rd-bubble-layer' keeps its id and is now the ONLY bubble layer, so every
  // click/hover handler bound to that id is unaffected. 'rd-bubble-halo' no longer exists.
  m.addLayer({ id: 'rd-bubble-layer', type: 'circle', source: 'rd-bubbles',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.2, 6, 5.5],
      // ── ★ THE PIN IS ORANGE (Material Orange 800 '#ef6c00') ──────────────────────────────
      // Asked: the pin colour is currently blue and might be better orange —
      // the orange colour was preferred. Stated as a preference held with some doubt, so it was
      // MEASURED rather than simply applied — and the measurement changed what shipped with it.
      //
      // WHY '#ef6c00' AND NOT A BRIGHTER ORANGE. The optimiser's literal top answer was '#bf360c',
      // which scores best by NOT BEING ORANGE: at OKLCh hue 35.4° it sits in the ramp's own red
      // family and reads as brown. Rejected on spec, not on score — orange was asked for.
      // True oranges are hue 48-64°; '#ef6c00' is hue 48.1°, the DARKEST end of that range, which
      // is what buys contrast against the pale bins while still reading unmistakably orange.
      // Lighter oranges ('#ff9800' h64, '#ffa000') lose the pale end: worst effective 1.55 vs 1.83.
      //
      // ★ THE OLD RULE AGAINST ORANGE IS NOT BEING IGNORED — IT IS BEING SATISFIED. The history
      // note above says pins "were once '#e67e22' at circle-opacity 0.6" and that the alpha, not
      // the hue, was the fault: at 0.6 the pin composited with whatever bin sat beneath it and
      // rendered a different colour per country at 1.18-1.22. That rule stands and is honoured
      // here — this pin is ONE fixed colour at FULL opacity, never tinted per bin. The
      // later "do not revert it to orange" was given while the ramp was pale and the pin navy;
      // orange has now been explicitly asked for against the new red ramp, which supersedes it.
      //
      // WORST CASE IS bin2 AT 1.83 (see the BIN_COLORS note for the full table and why the V is
      // structural). The white stroke below is LOAD-BEARING, not decoration: it carries the pin on
      // bins 3-5 where the orange fill falls to 1.03-1.35. Do not remove it.
      // ★ CONDITIONAL — see bubbleColor(). Orange is still the pin's identity; the 3-tier prayer
      // ramp replaces it ONLY while the prayer axis is the active question.
      'circle-color': bubbleColor(), 'circle-opacity': 1,
      'circle-stroke-color': PIN_STROKE,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 2],
      'circle-stroke-opacity': 1,
    } })
  // selection pen — a prominent neon ring over the selected PG pin(s), drawn ABOVE the normal bubbles.
  m.addSource('rd-bubble-selected', { type: 'geojson', data: selectedGeo() })
  m.addLayer({ id: 'rd-bubble-selected', type: 'circle', source: 'rd-bubble-selected',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 6, 11], 'circle-color': SEL_COLOR, 'circle-opacity': 0.18,
      'circle-stroke-width': 3, 'circle-stroke-color': SEL_COLOR, 'circle-stroke-opacity': 0.95 } })
  m.on('click', 'rd-choropleth', onMapClick)
  m.on('click', 'rd-bubble-layer', onBubbleClick)
  m.on('mouseenter', 'rd-choropleth', () => { m.getCanvas().style.cursor = 'pointer' })
  m.on('mouseleave', 'rd-choropleth', () => { m.getCanvas().style.cursor = '' })
  m.on('mouseenter', 'rd-bubble-layer', () => { m.getCanvas().style.cursor = 'pointer' })
  m.on('mouseleave', 'rd-bubble-layer', () => { m.getCanvas().style.cursor = '' })
  try {
    window.__rdashMap = _hookRdashMap = m
    // verify hook: simulate a country click at a lng/lat (query the choropleth at that point)
    window.__rdashClickAt = _hookClickAt = (lng, lat) => {
      const pt = m.project([lng, lat])
      const feats = m.queryRenderedFeatures(pt, { layers: ['rd-choropleth'] })
      if (feats && feats[0]) { onMapClick({ features: feats }); return feats[0].properties && feats[0].properties.iso_3166_1_alpha_3 }
      return null
    }
    // verify hook: select the PG pin nearest a lng/lat (small bbox query around the projected point)
    window.__rdashPinAt = _hookPinAt = (lng, lat) => {
      const pt = m.project([lng, lat])
      const feats = m.queryRenderedFeatures([[pt.x - 7, pt.y - 7], [pt.x + 7, pt.y + 7]], { layers: ['rd-bubble-layer'] })
      if (feats && feats[0]) { onBubbleClick({ features: [feats[0]] }); return feats[0].properties && feats[0].properties.slug }
      return null
    }
  } catch (_) { /* verify hook */ }
  applyProjection()
  // ★ THE GALAXY, THE WAY MAPBOX DOES IT: the starfield follows Mapbox's own method. Mapbox GL renders space and the starfield ENGINE-SIDE via the fog
  // API -- documented at docs.mapbox.com/mapbox-gl-js/guides/globe/ ("stars and atmosphere are
  // customized with the fog property"). These are their documented example values with one
  // change: space-color is pure black, not grey. star-intensity
  // 0..1 is the engine's own star layer -- no canvas, no custom code, the actual Mapbox stars.
  // Guarded: MapLibre has no setFog (its equivalent is the sky spec), so on that provider this is
  // a silent no-op and the plain black container behind the transparent sphere carries the void.
  try {
    if (typeof m.setFog === 'function') m.setFog({
      'color': 'rgb(186, 210, 235)',        // lower-atmosphere haze at the horizon
      'high-color': 'rgb(36, 92, 223)',     // upper atmosphere
      'horizon-blend': 0.02,
      'space-color': '#000000',             // the void — black, not grey
      'star-intensity': 0.6,
    })
  } catch (_) { /* an engine without fog keeps the container background instead */ }
  // selection pen: rebuild the highlight source whenever the selectionSet changes (toggle on/off).
  if (bus) bus.on('select', refreshSelected)
  refreshSelected()
  // pin focus -> fly the map to that people group (deepest drill level)
  if (bus) bus.on('focusRow', ({ slug } = {}) => {
    if (!slug) return
    const r = (dash?.rows?.value || []).find((x) => x.slug === slug)
    const mm = map.value
    if (mm && r && Number(r.latitude) && Number(r.longitude)) { try { mm.flyTo({ center: [Number(r.longitude), Number(r.latitude)], zoom: 5.5, duration: 1200 }) } catch (_) {} }
  })
}
function onMapClick(e) {
  // if a PG pin is under the cursor, let onBubbleClick SELECT it — don't also filter the country
  const m = map.value
  if (m && e.point) {
    const pins = m.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: ['rd-bubble-layer'] })
    if (pins && pins.length) return
  }
  const f = e.features && e.features[0]; if (!f || !bus) return
  const iso = f.properties && f.properties.iso_3166_1_alpha_3
  const label = isoToLabel.value.get(iso)
  if (!label) return
  bus.setFilter(geoFacet, filterSet[geoFacet] === label ? null : label)
  bus.emit('mapFocus', { facet: geoFacet, value: label })
}
// PG pin click -> SELECT the people group (selectionSet) + broadcast focus so the table scrolls/highlights.
function onBubbleClick(e) {
  const f = e.features && e.features[0]; if (!f || !bus) return
  const slug = f.properties && f.properties.slug
  if (!slug) return
  bus.toggleSelect(slug)
  bus.emit('focusRow', { slug, name: f.properties && f.properties.name })
}

// ── SCROLL-ZOOM vs PAGE-SCROLL (BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID-UNDER-THE-DASHBOARD) ──────
// ★ HISTORY, superseded — see the note directly above syncScrollZoomToHost() below for the
// CURRENT behaviour (scroll-zoom stays on unconditionally) and why the precondition this section
// describes no longer holds now that the map row has a bounded height (--rd-map-h). Kept because
// findScrollportAncestor is still here and a future host-shape could need the gate again.
// Mapbox GL calls preventDefault() on EVERY wheel event over its canvas to run scroll-zoom. That
// is correct for a map that IS the page (the fixed-viewport leaves), and fatal for a map embedded
// in a SCROLL-PAGE composite: the wheel never reaches the document, so the page cannot scroll to
// whatever is stacked BELOW the dashboard. MEASURED 2026-09-22 on the dashboard-plus-grid dev
// leaf: cursor over .kpi scrolled 600px; cursor over mapboxgl-canvas scrolled 0px with
// defaultPrevented=true, with 2,631px of grid sitting below the fold and unreachable.
//
// The .map-scroll-edge strips are the TOUCH answer (a pan-y drag at either edge scrolls the page
// while the map keeps the centre), and they are now rendered — but they do NOT release a DESKTOP
// wheel at the centre of the canvas, which is exactly where a mouse naturally sits. So on a
// scroll-page the wheel must belong to the PAGE.
//
// WHY DETECT RATHER THAN HARD-DISABLE: this panel ships inside BOTH kinds of host — the
// standalone research-dashboard leaf (fixed viewport, where wheel-zoom is the expected and
// desirable behaviour) and the cap-4 composites (a scroll-stack). The document's own scrollability
// is the honest discriminator: a fixed-viewport leaf pins html/body to one screen, so there is
// nothing to scroll and scroll-zoom stays ON; a scroll-page grows past the viewport, so the wheel
// is handed back. NOTHING IS LOST EITHER WAY — the MapToolbar zoom buttons and double-click/
// pinch zoom all still work, so a scroll-page map remains fully zoomable without trapping a wheel.
// ── ★ THE DOCUMENT IS NOT ALWAYS THE SCROLLPORT (measured 2026-09-22, in the cap-5 shell) ──────
// The version below asked `document.documentElement.scrollHeight > innerHeight`, which is the right
// question ONLY when the page itself is what scrolls. Inside the cap-5 shell (plugin-studio /
// doxa-maps-spa) the document is pinned to one screen and an ANCESTOR ELEMENT owns the scroll:
//
//   ancestor chain from .pgg-root upward, dashboard-plus-grid tab, 1600x900:
//     div.stl              oy=visible  ch=769   sh=2838   over=2069
//     div.ps-slot          oy=visible  ch=769   sh=2838   over=2069
//     section.ps-pane      oy=auto     ch=769   sh=2838   over=2069   <- the real scrollport
//     div.ps-stage         oy=hidden   ch=769   sh=769
//     ...
//     document             sh=900  ch=900                             <- says "nothing scrolls"
//
// So canPageScroll computed FALSE, scroll-zoom stayed ENABLED, and the map ate every wheel — with
// 2,069px of grid mounted below the fold and unreachable. Proven at the event level: the wheel at
// (800,600) lands on `canvas.mapboxgl-canvas`, and .ps-pane.scrollTop stays 0 after a real
// mouse.wheel, while a programmatic `scrollTop = 800` moves it to 800. The scroller was never
// broken; the gesture was being consumed before it arrived.
//
// This is why three earlier fixes to the CONTAINERS were each correct and changed nothing: they
// made the page scrollable, and the wheel still never reached it.
//
// The honest discriminator is therefore "is there a scrollable ANCESTOR?", not "does the document
// scroll?" — the document is just one possible answer, and in an embedded host it is the wrong one.
// ★ SUPERSEDED BY --rd-map-h (BUG-MAP-ZOOM-BROKEN-BY-THE-SCROLL-FIX, reported from use 2026-09-23).
// The blanket disable above was written when a scroll-stack composite pinned this band to ONE
// SCREEN (88svh, then a bare 100%) — under THAT layout the map row filled the whole scrollable
// pane, so ANY wheel over the map was, structurally, the ONLY wheel gesture available in the
// lower two-thirds of the page: there was no "off the map" for the cursor to reach. Disabling
// zoom there was the only way to hand the page anything to scroll with at all.
//
// research-dashboard's own page-scroll mode (.rd-page-scroll, card BUG-CANNOT-SCROLL-DOWN-TO-
// THE-GRID) changed that precondition: the map row is now pinned to a BOUNDED, explicit height
// (var(--rd-map-h,58svh) ≈ 522px at 900px tall), not the whole pane. Once the map has a real,
// finite height, the cursor naturally leaves its bounds the moment a user scrolls past it — the
// map is a REGION of the page now, not the whole scrollable surface. So the two goals that used
// to conflict (zoom over the map, scroll to reach the grid) no longer compete for the same input.
//
// Reported 2026-09-23: zooming in and out on the map does not work. The scrolling is causing
// that to change. The requirement is fixed-viewport semantics inside the bounded map region:
// wheel OVER the map zooms; wheel BELOW it (outside the map's own box) scrolls. MEASURED: with
// scrollZoom force-disabled, a wheel over the canvas landed as a no-op in BOTH directions —
// defaultPrevented stayed false (so Mapbox never intercepted it) AND the ancestor pane's
// scrollTop never moved either (composedPath shows the map's own bounded box consumes the event
// without forwarding it) — a dead zone under the cursor, which reads exactly as "zoom is broken".
//
// So scroll-zoom now stays ON unconditionally. The ancestor-scroll detection this function used
// to gate on (findScrollportAncestor, kept below for provenance/re-use) is no longer read here;
// nothing calls this function with intent to disable. If a FUTURE host reintroduces a map region
// that spans its entire scrollable content (the original precondition), re-enable the gate THERE
// rather than reviving a global disable — the defect was in an unbounded map row, not in zoom.
function syncScrollZoomToHost(m) {
  if (!m || !m.scrollZoom) return
  try { m.scrollZoom.enable() } catch (_) { /* an engine without scrollZoom must never break the panel */ }
}

onMounted(async () => {
  if (isMaplibreProvider.value) countryBoundaries().catch(() => {})
  await initializeMap()
  const m = map.value; if (!m) return
  if (m.isStyleLoaded()) addLayers(); else m.on('load', addLayers)
  // ★ HISTORY, superseded — see the note above syncScrollZoomToHost()'s definition. This used to
  // be three setTimeouts, then a ResizeObserver-driven re-check of "does an ancestor scroll?",
  // because THAT answer used to decide whether to disable scroll-zoom. It no longer does — the
  // function just enables scroll-zoom unconditionally now — so this call and the observer below
  // are harmless idempotent housekeeping rather than a live decision. Left wired (cheap, and the
  // observer may again be useful if a future host reintroduces the unbounded-map-row precondition)
  // rather than torn out, but do not read `resync` as gating anything today.
  syncScrollZoomToHost(m)
  scrollResync = () => syncScrollZoomToHost(m)
  try {
    scrollRO = new ResizeObserver(scrollResync)
    const host = (m.getContainer && m.getContainer()) || null
    if (host) scrollRO.observe(host)
    const port = host ? findScrollportAncestor(host) : null
    if (port) scrollRO.observe(port)
    if (document.body) scrollRO.observe(document.body)
  } catch (_) { /* no ResizeObserver: the initial call above still answers for a static page */ }
  window.addEventListener('resize', scrollResync)
  // Keep the zoom buttons' enabled state in step with the live camera. 'zoom' fires only during
  // an actual zoom; 'zoomend' catches the settle. Both just set two booleans (no camera writes).
  m.on('zoom', syncZoomLimits)
  m.on('zoomend', syncZoomLimits)
  // The minZoom FLOOR is aspect-aware, so it moves when the cell is resized: re-read the limits
  // after a resize or the zoom-out button could stay greyed once the panel grows. Read-only —
  // this handler calls no camera method, so it adds nothing to the resize work per frame.
  m.on('resize', syncZoomLimits)
  syncZoomLimits()
  // also guard: style may already be loaded by the time we attach
  m.on('idle', () => { if (!added && m.isStyleLoaded()) addLayers() })
  // watch the map container for size changes (table collapse/expand, rail reflow, window) and
  // resize the canvas so it always fills its cell — this is the real fix for the gray gap.
  if (typeof ResizeObserver !== 'undefined' && mapContainer.value) {
    containerRO = new ResizeObserver(scheduleMapResize)
    containerRO.observe(mapContainer.value)
  }
  // Keep the legend clear of the attribution. Mapbox swaps between the expanded strip and
  // the compact "i" button as the map's WIDTH crosses its own breakpoint, so re-measure on
  // every panel resize, not just once. 'idle' catches the control's first paint.
  // syncAttribClearance attaches its own ResizeObserver to the attribution control the first
  // time it finds it; these events just make sure it gets a chance to run. 'idle' covers the
  // control's first paint, 'resize' covers the expanded <-> compact swap on width changes.
  syncAttribClearance()
  m.on('idle', syncAttribClearance)
  m.on('resize', syncAttribClearance)
  // Belt-and-suspenders: the RO observes the container, but when the table cell toggles
  // display:none (v-show) the grid reflow can land a frame before the observer notices, so
  // the 1fr map row grows without the canvas following → the reported gray gap. Resize
  // explicitly the moment collapse state flips (rAF now + one delayed pass for the settle).
  if (bus && typeof bus.on === 'function') {
    offToggleTable = bus.on('toggleTable', () => { scheduleMapResize(); setTimeout(scheduleMapResize, 280) })
    // suppress per-frame canvas resizes for the duration of a divider drag (anti-strobe)
    offLayoutResizing = bus.on('layoutResizing', setLiveResize)
  }
})
onBeforeUnmount(() => {
  // These hooks are closures over this component (and one is the Map itself), so leaving any of them
  // on window pins the whole app after unmount — measured exactly that (leak-722ac7789).
  // Released as a set: __rdashPinAt was the one that showed up in the snapshot, but __rdashMap holds
  // the map and retains strictly more, and clearing only the reported one would have left the larger
  // retainer in place and looked fixed.
  // Identity-checked, and one key per line rather than a loop, so check-window-globals-released can
  // read both the delete and the comparison. Releasing only what this instance installed is what
  // keeps a two-dashboard page from losing the live one's hooks when the other unmounts.
  try {
    if (typeof window !== 'undefined') {
      if (window.__rdashPinAt === _hookPinAt) delete window.__rdashPinAt
      if (window.__rdashClickAt === _hookClickAt) delete window.__rdashClickAt
      if (window.__rdashMap === _hookRdashMap) delete window.__rdashMap
    }
  } catch (_) { /* a locked-down window is not worth failing an unmount over */ }
  // Drop the pending selection fly FIRST: its debounce timer outlives the component, and a
  // camera call against a destroyed map throws. Same discipline as _clearSnap in useMapInstance.
  try { stopSelectionCamera && stopSelectionCamera() } catch (_) {} stopSelectionCamera = null
  try { offToggleTable && offToggleTable() } catch (_) {} offToggleTable = null
  try { offLayoutResizing && offLayoutResizing() } catch (_) {} offLayoutResizing = null
  if (containerRO) { try { containerRO.disconnect() } catch (_) {} containerRO = null }
  if (scrollRO) { try { scrollRO.disconnect() } catch (_) {} scrollRO = null }
  if (scrollResync) { try { window.removeEventListener('resize', scrollResync) } catch (_) {} scrollResync = null }
  if (attribRO) { try { attribRO.disconnect() } catch (_) {} attribRO = null } attribEl = null
  if (_resizeRaf) { cancelAnimationFrame(_resizeRaf); _resizeRaf = 0 }
  // Detach the zoom-limit listeners before destroy() so they can never run on a dead map.
  try {
    const m = map.value
    if (m) {
      m.off('zoom', syncZoomLimits); m.off('zoomend', syncZoomLimits); m.off('resize', syncZoomLimits)
      m.off('idle', syncAttribClearance); m.off('resize', syncAttribClearance)
    }
  } catch (_) {}
  try { destroy && destroy() } catch (_) {}
})
watch([filteredRows, isMapReady], applyPaint)

// ── Zoom-limit state for the control buttons ──
// useMapInstance keeps an aspect-aware minZoom FLOOR that tracks the container height, so on a
// short dashboard cell map.zoomOut() can be silently clamped to a no-op. Mirror the live limits
// into refs so the buttons DISABLE at the ends — a greyed button reads as "at the limit" instead
// of a dead control, and it gives the verification a deterministic thing to assert on.
//
// PHOTOSENSITIVITY (BUG-RESIZE-STROBE): this is event-driven, NOT a polling/rAF loop. It listens
// to Mapbox's own 'zoom'/'zoomend' (which only fire while a zoom is actually in flight) and writes
// two booleans. It never calls resize(), setZoom, setMinZoom or any camera method, so it cannot
// feed back into _onResize's debounced floor-snap — the strobe path is untouched.
const canZoomIn = ref(true)
const canZoomOut = ref(true)
function syncZoomLimits() {
  const m = map.value
  if (!m) return
  // Small epsilon: Mapbox parks a clamped camera a hair off the exact limit.
  const z = m.getZoom()
  canZoomIn.value = z < m.getMaxZoom() - 0.01
  canZoomOut.value = z > m.getMinZoom() + 0.01
}

// ── ATTRIBUTION CLEARANCE (licence-critical) ───────────────────────────────────
// The legend must never cover Mapbox's "(c) Mapbox (c) OpenStreetMap Improve this map"
// credit — visible attribution is required by the Mapbox ToS and the OSM ODbL.
//
// A FIXED offset is not safe here, because the thing being cleared CHANGES SIZE at a
// breakpoint we do not control: on a narrow map Mapbox collapses the attribution into a
// compact round "i" button that is 24px tall, TALLER than the 20px expanded strip. A
// clearance tuned at 1440 was 2px short at 1024 and the boxes touched again.
// So we MEASURE the real control and publish its height as --rd-attrib-clear.
// Read-only: we only ever read the control's rect and set a variable on our own wrapper.
const mapWrap = ref(null)
let attribRO = null
let attribEl = null
function syncAttribClearance() {
  const wrap = mapWrap.value; if (!wrap) return
  let h = 0
  try {
    const root = wrap.getRootNode?.()
    const el = (root && root.querySelector)
      ? root.querySelector('.mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-attrib')
      : null
    if (el) {
      // Measure the strip the control OCCUPIES measured from the PANEL'S BOTTOM EDGE —
      // not the control's own height. Mapbox gives the control a margin inside
      // .mapboxgl-ctrl-bottom-right (10px for the compact button), so height alone
      // undercounts the reserved space by exactly that margin and the legend still
      // clipped the button's top by 2px at 1024px even with the height measured correctly.
      // Panel-bottom-minus-control-top is margin-inclusive and therefore self-correcting.
      const cr = el.getBoundingClientRect()
      const wr = wrap.getBoundingClientRect()
      h = Math.max(cr.height || 0, wr.bottom - cr.top)
      // OBSERVE THE CONTROL ITSELF, not just our panel. Mapbox collapses the credit into
      // the compact "i" button AFTER first paint, and that transition changes the CONTROL's
      // height while the PANEL's size never moves — so a panel-only ResizeObserver never
      // fires and we would stay pinned to the stale expanded measurement (measured live:
      // clearance stuck at 20px while the button was really 24px, and the boxes touched).
      if (attribEl !== el && typeof ResizeObserver !== 'undefined') {
        if (attribRO) { try { attribRO.disconnect() } catch (_) {} }
        attribEl = el
        attribRO = new ResizeObserver(syncAttribClearance)
        attribRO.observe(el)
      }
    }
  } catch (_) { /* pre-paint / detached */ }
  // Floor at the expanded-strip height so we degrade to a sane gap if the control
  // is not in the DOM yet, and cap it so a freak measurement cannot eat the panel.
  const clear = Math.min(Math.max(Math.ceil(h) || 20, 20), 72)
  wrap.style.setProperty('--rd-attrib-clear', clear + 'px')
}

// ── RDASH-ENHANCE: GLOBE (default) <-> MERCATOR projection toggle ──
const projection = ref('globe')
// ★ THE TWO ENGINES DISAGREE ON THIS ONE CALL, AND THE CATCH HID IT: the symptom was a flat map where
// a globe was expected. Mapbox GL takes setProjection('globe') -- a bare string. MapLibre v5 takes
// setProjection({ type: 'globe' }) -- an object. Passing a string to MapLibre throws, the empty
// catch below swallowed it, and the map silently fell back to flat mercator with NO console error.
// That is why this appeared the moment the dashboard moved to provider:'maplibre': the default was
// still 'globe' and the request simply stopped arriving.
// Try the object form first (MapLibre, and harmless to attempt), then the string (Mapbox). The catch
// stays because a provider without ANY projection support must degrade rather than break the panel --
// but it now catches a genuine unsupported-engine case instead of masking a shape mismatch.
function applyProjection() {
  const m = map.value
  // ★ WAS PROBING BY EXCEPTION: it tried the object form, let it THROW on Mapbox, then fell back to
  // the string. That reached the right end state but by throwing on every Mapbox call, and it asked
  // the engine by trial instead of by identity. The helper instance-tests instead (C2).
  setProjectionOn(m, projection.value)
}
// The pill's accessible name: the action, from the catalogue, in the reader's language. Both keys
// ship in all eleven locales, so this never falls back to English.
const projName = computed(() => (projection.value === 'globe'
  ? T('mapui.disableGlobe', 'Disable globe')
  : T('mapui.enableGlobe', 'Enable globe')))

function toggleProjection() { projection.value = projection.value === 'globe' ? 'mercator' : 'globe'; applyProjection() }

// ── RDASH-ENHANCE: fly-to on selection. Any facet brush (tree node / chart slice / region / row)
//    flies the map to fit the in-scope people groups; a pin focus flies to that PG (deeper drill). ──
//
// ╔═ BUG-CAMERA-FLIES-TO-NORTH-POLE-ON-FLAT-FACETS (reported, 2026-09-22) ════════════════════╗
// "when I click unengaged status it just goes to the north pole. Deaf people, it just goes to
// the north pole... it needs to take you to the highest concentration location geographically,
// not to the North Pole."
//
// ── WHAT WAS MEASURED (live API, 2,107 rows, pray.doxa.life, 2026-09-22) ──
// The old code fitBounds()'d the raw min/max bbox of the in-scope rows. For the Unengaged
// facet (2,080 of 2,107 rows) that bbox measured:
//     W -176.18  S -36.85  E 178.48  N 78.22     → 354.7 deg of lng, 115.1 deg of lat
// Run through the REAL MapLibre 5.6 in a real WebGL browser, fitBounds resolved that box to:
//     center [1.15, 41.15]  zoom 2.06   (globe projection; identical center under mercator)
// and map.project([lng, 90]) put the NORTH POLE at screen y=99 in an 800px-tall viewport —
// i.e. the pole is genuinely in frame, occupying the top third, which is precisely what the
// the report describes. The densest data cell (75E/15N) was shoved to x=939, onto the right
// limb of the globe where the sphere foreshortens it into an unreadable sliver.
//
// ── WHAT THE BUG IS *NOT* (both hypotheses tested and DISPROVED) ──
//  1. NOT a degenerate/empty-bounds fallback to something like [0, 90]. fitBounds threw no
//     error, hit no fallback, and returned a perfectly valid finite center. cameraForBounds()
//     agreed with fitBounds() exactly. There is no degenerate path being taken here at all.
//  2. NOT "the bbox center is the pole". The bbox center latitude is 20.69 — nowhere near a
//     pole. The camera still ends up at 41.15.
//
// ── THE ACTUAL ROOT CAUSE (two effects stacking) ──
//  a. A min/max bbox is an OUTLIER statistic. 61 of 2,080 unengaged rows (2.9%) lie north of
//     41N, and a couple reach 78.22N — yet those few rows drag the entire frame ~23 deg north.
//     The MEDIAN unengaged row sits at 18.08N. The camera was framing the tail, not the mass.
//  b. Vertical fitting is NON-LINEAR in latitude (Mercator-family y). So the northern half of
//     a tall box eats disproportionate screen height, pulling the resolved center (41.15) well
//     north of the box's own midpoint (20.69). On the GLOBE projection — which is the panel's
//     default (see `projection` above, initialised to 'globe') — that northward tilt is what
//     swings the pole into view and rolls the equatorial data mass off to the limb. This is
//     why it is tied to the globe/flat setting: flat shows the same bad center, but a
//     sphere makes it look like you flew to the Arctic.
//
// ── THE FIX: frame the CONCENTRATION, and make a pole unreachable by construction ──
// We fit a PERCENTILE-TRIMMED box (P10..P90 on each axis) instead of the raw extent, and we
// anchor the camera on the MEDIAN point. Measured on the same live rows, trimming collapses
// the latitude span from 115.1 to 32.8 deg, and the resulting fit centers at [45.91, 16.87]
// with the north pole at screen y = -138 — OFF-SCREEN. Verified by rendering the real 2,080
// points: the South-Asia cluster is large and legible and no pole appears.
//
// Why the MEDIAN as the anchor: of the candidates measured for "highest concentration",
//     median lng 75.25 -> 73% of rows within +/-45 deg   ← best
//     3x3 densest-bin centroid 78.51 -> 70%
//     densest 15-deg bin 82.50 -> 68%
//     trimmed midpoint 45.91 -> 68%
// The median also wins on properties, not just this dataset: it is the SAME cheap statistic on
// both axes, it is by definition an actual data latitude, and it therefore CANNOT be a pole
// unless a majority of the selection genuinely sits at a pole. That is the structural guarantee
// the card asked for — the degenerate path cannot resolve to a pole because the pole is never
// a candidate value, rather than being fenced off by an after-the-fact clamp.
//
// ── WHAT WAS REJECTED ──
//  • Clamping the resolved center latitude (e.g. to +/-60). Treats the symptom: the camera
//    would stop showing the pole but would still be framing the outlier tail rather than the
//    concentration, so "deaf people" would land in empty ocean instead of empty Arctic.
//  • A k-means / DBSCAN densest-cluster search. Genuinely better framing for multi-lobe sets,
//    but it is O(n*k*i) on every facet click, non-deterministic without a seed, and this runs
//    on a 2,107-row set behind a 260ms debounce in a dashboard cell. Percentile trim + median
//    is one sort per axis, fully deterministic, and measured sufficient.
//  • Reusing useMapFly's _robustLngExtent (which already does trim + densest-bin). It solves
//    only LONGITUDE — its latitude handling is still (minLat+maxLat)/2, i.e. exactly the
//    outlier-driven statistic that causes THIS bug. It is also module-private. Fixing the
//    library's latitude path is the right follow-up, but it is a shared-surface change across
//    every map profile and does not belong in a P0 panel fix.
//
// Antimeridian: the trim is applied to longitudes unwrapped at their largest circular gap, so
// a Pacific set holding both -176 and +178 reads as one contiguous ~6-deg span rather than a
// false 355-deg span. Same technique the library uses; see useMapFly.js _robustLngExtent.
// ╚═════════════════════════════════════════════════════════════════════════════════════════╝

// Fraction trimmed off EACH tail before framing. 0.10 was chosen against the live data: it is
// aggressive enough to drop the Arctic tail that caused this bug (115.1 -> 32.8 deg of lat) while
// still keeping 80% of the selection inside the frame. Anything visible outside the box is not
// hidden — it simply does not get a vote on where the camera points.
const FIT_TRIM = 0.10
// Sanity floor: trimming is pointless (and can over-crop) on a handful of rows, where every row
// is already "the concentration". Below this we frame the full extent.
const FIT_TRIM_MIN_ROWS = 12

// Usable [lng, lat] for a row, or null. Number.isFinite — NOT truthiness: the old code's
// `Number(r.latitude) && Number(r.longitude)` silently discarded every row sitting exactly on
// the equator or the prime meridian. Rejects only the exact 0,0 pair, which is the null-island
// sentinel a failed geocode degrades into, plus out-of-range junk.
function coordOf(r) {
  const x = Number(r.longitude), y = Number(r.latitude)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x === 0 && y === 0) return null
  if (y < -90 || y > 90 || x < -180 || x > 180) return null
  return [x, y]
}

// Value at fraction p of a sorted numeric array (p=0.5 is the median). Nearest-rank, so the
// result is always an ACTUAL observed value — never an interpolated coordinate that no row
// occupies, which is what keeps the median anchor physically meaningful.
function pctl(sorted, p) {
  if (!sorted.length) return NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[i]
}

// Longitudes unwrapped at their largest circular gap, so a set straddling the antimeridian
// becomes monotonic and its span/percentiles are meaningful. Returns values that may exceed
// 180; fitBounds accepts and wraps those correctly.
function unwrapLngs(xs) {
  const s = xs.slice().sort((a, b) => a - b)
  const n = s.length
  if (n < 2) return s
  let gap = -1, gapIdx = 0
  for (let i = 0; i < n; i++) {
    const next = (i + 1 < n) ? s[i + 1] : s[0] + 360
    const g = next - s[i]
    if (g > gap) { gap = g; gapIdx = i }
  }
  const start = (gapIdx + 1) % n
  const out = new Array(n)
  for (let k = 0; k < n; k++) {
    let v = s[(start + k) % n]
    if (k > 0 && v < out[k - 1]) v += 360
    out[k] = v
  }
  return out
}

/**
 * Camera target for a set of rows, framed on where the rows CONCENTRATE.
 *
 * @returns {null | { bounds:[[w,s],[e,n]], center:[lng,lat] }}
 *          null when no row has usable coordinates — the caller must then hold position.
 *          `center` is the median point and is always an anchor the fit is re-centred on, so
 *          a lopsided (multi-lobe) selection still points at its densest lobe.
 */
function boundsOf(rows) {
  const pts = []
  for (const r of rows) { const c = coordOf(r); if (c) pts.push(c) }
  if (!pts.length) return null

  const lats = pts.map((p) => p[1]).sort((a, b) => a - b)
  const lngs = unwrapLngs(pts.map((p) => p[0]))

  // Below the floor, or for a single point, trimming would throw away real signal.
  const t = pts.length >= FIT_TRIM_MIN_ROWS ? FIT_TRIM : 0
  const s = pctl(lats, t), n = pctl(lats, 1 - t)
  const w = pctl(lngs, t), e = pctl(lngs, 1 - t)
  const center = [pctl(lngs, 0.5), pctl(lats, 0.5)]

  // Degenerate box (one point, or a co-located cluster): fitBounds would resolve it at maxZoom.
  // Hand back a zero-area box centred on the median and let the caller's maxZoom cap the zoom.
  if (!(e > w) || !(n > s)) return { bounds: [[center[0], center[1]], [center[0], center[1]]], center }

  return { bounds: [[w, s], [e, n]], center }
}

function flyToFiltered() {
  const m = map.value; if (!m) return
  if (!Object.keys(filterSet).length) { try { m.flyTo({ center: [28, 18], zoom: 1.45, duration: 1000 }) } catch (_) {} ; return }
  const t = boundsOf(filteredRows.value)
  // No usable coordinates in scope: HOLD POSITION. Deliberately not a reset-to-world — an
  // unrequested snap-back is motion the user did not ask for (same rule useSelectionCamera
  // follows for an empty selection).
  if (!t) return
  try {
    m.fitBounds(t.bounds, { padding: 70, duration: 1200, maxZoom: 5.5 })
    // Re-anchor on the median AFTER the fit. fitBounds derives its center from the box, which
    // for a two-lobe selection (e.g. West Africa + South Asia) is the empty gap between the
    // lobes; setCenter moves the camera onto the mass without changing the zoom the fit chose.
    // Safe against the pole by construction: the median latitude is an observed row latitude.
    m.setCenter(t.center)
  } catch (_) { /* fitBounds throws on degenerate bounds — never break the dashboard */ }
}
let _flyT = null
watch(() => JSON.stringify(filterSet), () => { clearTimeout(_flyT); _flyT = setTimeout(flyToFiltered, 260) })

useShadowStyles(`
  .rd-mapwrap{ position:relative; width:100%; height:100%; min-height:0; background:var(--dx-line, #d1d4cd); }
  /* ★ THE GALAXY IS THE CONTAINER, NOT THE TILES (correcting the first attempt): the target is a
     spherical globe on a black background — the galaxy — with blue oceans like the Mapbox map, and
     land that is NOT black. On a globe projection the sphere does not fill
     the canvas; the corners show the CONTAINER's background. So space lives here: a deep radial
     wash behind the sphere, while the tiles keep their normal daylight colours. Scoped to
     [data-projection="globe"] so flat mercator keeps the neutral ground — space behind a flat
     rectangle would read as a mistake. */
  /* Plain BLACK behind the sphere, not grey.
     On Mapbox the engine paints its own space + stars over the whole canvas via fog, so this only
     shows on engines without fog support (MapLibre), where black is the honest fallback. */
  .rd-mapwrap[data-projection="globe"]{ background:#000; }
  .rd-mapwrap .rd-mapc{ position:absolute; inset:0; }
  .rd-proj{ position:absolute; inset-inline-end:8px; top:var(--rd-proj-top,8px); z-index:3; font-size:11px; font-weight:700; cursor:pointer; user-select:none;
    background:#1a1a2ecc; color:#fff; border:1px solid #ffffff33; border-radius:6px; padding:4px 9px; backdrop-filter:blur(4px); }
  .rd-proj:hover{ background:#1a1a2e; }
  /* ★ TOUCH TARGET: 24px, STATED, AT EVERY WIDTH. Measured on a phone (390x844) this rendered
     74x23 — one pixel under WCAG 2.5.8 AA. The fix is to name the 24, not to add padding: the
     height is padding PLUS a line box the renderer derives from the font, and padding arithmetic
     lands at 23.7px, which rounds to the same failure.
     ★ AND IT MUST NOT BE BEHIND pointer:coarse. The first fix scoped this to a coarse pointer,
     reasoning that a mouse does not need a touch floor. That was wrong twice over: 2.5.8 is a
     TARGET SIZE criterion, not a touch criterion, so it applies to the desktop pointer too — and
     the media query meant phones passed at 34px while desktop stayed at 73.5x23, the same one-pixel
     failure, now invisible to a phone sweep. Measured again at 1440x900 by upg100 (2a2ea36e). One
     rule, every width, no query to be right about. */
  /* ★ AND min-WIDTH now that the word is gone. The 24 used to come for free from the text
     ("🌐 Globe" measured 74px wide); a glyph-only pill is about 29px with its padding, which passes,
     but only by accident of the font. Stating both axes keeps 2.5.8 AA true if the glyph changes. */
  /* ★ border-box, AND THE TOOLBAR BELOW IS DERIVED FROM THIS HEIGHT RATHER THAN RE-TUNED TO MATCH IT.
     The 24px touch target above was declared as a CONTENT height, and nothing in this shadow root
     sets box-sizing globally — it appears exactly once, on .rd-legend-map. So the rendered box was
     24 + 4+4 padding + 1+1 border = 34px at top:8, ending at y=42, while .rd-zoomtools starts at
     top:34. The two controls overlapped by 8px, and the toolbar's z-index:10 against this element's
     z-index:3 drew the zoom button OVER the projection toggle. The measurement in the comment above
     dates it exactly: at 74x23 this box ended at y=31 and cleared the toolbar, so it was the
     touch-target fix itself that created the collision.
     border-box makes 24 mean twenty-four, and --rd-proj-h hands that number to the toolbar so the
     two cannot drift apart again. An agreement between two rules should be stated once, not tuned
     in two places that no one thinks to check together. */
  .rd-proj{ min-height:var(--rd-proj-h,24px); min-width:24px; box-sizing:border-box;
    display:inline-flex; align-items:center; justify-content:center; }
  /* Zoom cluster. MapToolbar defaults to top:6px on the inline-end edge, which is exactly where
     the Globe/Flat pill already sits, so drop this instance below it. 34px clears the pill
     (top:8px + roughly 22px tall) with a small breathing gap.
     SPECIFICITY: MapToolbar ships .map-toolbar and .map-toolbar .mcb rules at the SAME
     specificity as a plain .rd-zoomtools override, and both stylesheets are injected into the
     same shadow root — so a tie would be resolved by injection ORDER, which is not something
     this panel controls. Doubling the class (.rd-zoomtools.rd-zoomtools) raises specificity so
     these win deterministically, without !important and without editing the shared toolbar. */
  .rd-zoomtools.rd-zoomtools{ top:calc(var(--rd-proj-top,8px) + var(--rd-proj-h,24px) + var(--rd-ctl-gap,6px)); gap:4px; }
  /* Economical use of space: 26px instead of the toolbar's standard 32px. The dashboard map is
     one cell among many, so the controls stay present but visually quiet. Also match the light
     dashboard surface/border tokens so the cluster reads as part of this panel. */
  .rd-zoomtools.rd-zoomtools .mcb{
    width:26px; height:26px;
    border:1px solid var(--rd-line,#d1d4cd); color:var(--dx-text,#3b463d); box-shadow:0 1px 2px rgba(0,0,0,0.10);
  }
  .rd-zoomtools.rd-zoomtools .mcb:hover:not(:disabled){ background:var(--dx-surface,#f3f3f1); box-shadow:0 1px 4px rgba(0,0,0,0.14); }
  /* MapToolbar's own mobile breakpoint re-asserts top/gap and a 36px button, so restate here. */
  @media(max-width:767px){
    .rd-zoomtools.rd-zoomtools{ top:calc(var(--rd-proj-top,8px) + var(--rd-proj-h,24px) + var(--rd-ctl-gap,6px)); gap:4px; }
    .rd-zoomtools.rd-zoomtools .mcb{ width:26px; height:26px; }
  }
  /* LEGEND vs ATTRIBUTION — a LICENCE constraint, not a taste call.
     Mapbox pins its own .mapboxgl-ctrl-attrib ("(c) Mapbox (c) OpenStreetMap Improve this map")
     to the map's BOTTOM-RIGHT, and both the Mapbox ToS and the OpenStreetMap ODbL require that
     credit to stay VISIBLE. This legend used to sit at right:8px/bottom:8px — the identical
     anchor — so it painted straight over the credit and the two read as one garbled strip
     (BUG-MAP-LEGEND-OVERLAPS-MAPBOX-ATTRIBUTION, live-verified at 1440x900).
     The fix RAISES THE LEGEND, and never touches the attribution: nothing here hides, shrinks
     or restyles .mapboxgl-ctrl-attrib. --rd-attrib-clear is the reserved strip along the bottom
     edge that the credit line owns; the legend's bottom edge starts above it.
     Bottom-LEFT was not available when this was written (a caption held that corner; it has since
     been removed, so the corner is free if a future control needs it).
     Stays on the right so the legend sits beside the choropleth it explains. */
  .rd-mapwrap{ --rd-attrib-clear:26px; --rd-proj-h:24px; --rd-proj-top:8px; --rd-ctl-gap:6px; }
  /* ★ LOGICAL, NOT PHYSICAL (the Arabic survey). A physical right:8px pins this to the right
     edge in every locale, so in Arabic the legend stayed where an English reader expects it while
     everything around it mirrored. inset-inline-end puts it at the END of the reading direction —
     right in English, left in Arabic — which is the pattern cities-internet already uses for its
     own legend and control rail. inset-inline-start:auto is part of the pair, not decoration: it
     cancels any physical left inherited from a control container, which is what otherwise
     stretches the box across the map once the end edge moves.
     NO BACKTICKS IN THIS COMMENT: it lives inside a shadow-CSS template literal, where a backtick
     ends the literal and everything after it is read as code. I wrote three here and broke the
     file's parse; check:sfc-parse and check:no-free-identifiers both caught it. */
  .rd-legend-map{ position:absolute; inset-inline-end:8px; inset-inline-start:auto; bottom:calc(var(--rd-attrib-clear,26px) + 8px); z-index:2;
    background:#ffffffe8; border:1px solid var(--rd-line, #d1d4cd);
    border-radius:var(--r-md,6px); padding:6px 8px; backdrop-filter:blur(3px); box-sizing:border-box; max-width:148px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .rd-legend-map .lg-h{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:var(--rd-muted, #6d766e); margin-bottom:4px; }
  /* align-items:flex-start (not center) + a wrapping text span: the top bin's label is now
     '150+ · heartbeat zone', which is longer than the 148px card. Centred flex items shrink
     below their content width instead of wrapping, so the longest — and most important — label
     was the one that clipped. The swatch keeps a fixed size and the TEXT takes the second line. */
  .rd-legend-map .lg-row{ display:flex; align-items:flex-start; gap:6px; font-size:10px; color:var(--dx-text, #3b463d); line-height:1.5; }
  .rd-legend-map .lg-row > span:last-child{ min-width:0; overflow-wrap:break-word; }
  .rd-legend-map .lg-sw{ margin-top:2px; }
  /* Legend swatches carry the PALE choropleth ramp, which measures only 1.26-2.16 against
     this card's white background — so the swatch outline is doing the work of making the
     chip visible at all. The old 'rgba(0,0,0,.08)' hairline was far too faint for that.
     The Material Light BORDER token gives every swatch a definite edge on white. */
  .rd-legend-map .lg-sw{ width:11px; height:11px; border-radius:2px; flex:0 0 auto; border:1px solid var(--rd-line, #d1d4cd); }
  /* ── EDGE SCROLL STRIPS — the page-scroll escape from a wheel-capturing map ──────────────
     BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID-UNDER-THE-DASHBOARD. Mapbox GL calls preventDefault()
     on every wheel event over its canvas (scroll-zoom), so inside a scroll-page composite like
     dashboard-plus-grid the wheel NEVER reaches the document and the page cannot scroll to the
     grid below. MEASURED 2026-09-22 on the dev leaf: cursor over .kpi scrolled 600px, cursor
     over mapboxgl-canvas scrolled 0px with defaultPrevented=true. The map hero spans the middle
     of the band, so the reader's cursor lands on it and scrolling feels completely dead.
     These are the SAME always-present invisible hit-boxes doxa-simple-map, research-map,
     countries-map and upg-100-list already render; useMapInstance ALREADY calls
     useEdgeScrollAffordance(containerRef.parentElement) with showEdgeBorders defaulting to true,
     but it querySelector's '.map-scroll-edge' and this panel rendered none — so it found zero
     edges and returned its no-op. Adding the two strips activates the existing machinery.
     touch-action:pan-y is the mechanism (a vertical drag scrolls the PAGE natively while the map
     keeps the centre); the composable paints the gray gradient so the affordance is discoverable.
     Width matches research-map's: the zoom-button gutter, so it never eats usable map. */
  .map-scroll-edge{ position:absolute; top:0; bottom:0; width:calc(var(--map-btn-size,32px) + 6px);
    z-index:2; touch-action:pan-y; pointer-events:auto; background:transparent; }
  .map-scroll-edge--left{ left:0; }
  .map-scroll-edge--right{ right:0; }
`, 'rd-mappanel')
</script>

<template>
  <div ref="mapWrap" class="rd-mapwrap" data-sub="map" :data-projection="projection">
    <div ref="mapContainer" class="rd-mapc" data-map-canvas></div>
    <!-- Edge scroll strips. They must be SIBLINGS of the map container inside .rd-mapwrap,
         because useMapInstance hands useEdgeScrollAffordance exactly containerRef.parentElement
         (= this wrapper) and the composable querySelector's them from there. A strip placed
         INSIDE .rd-mapc would be under the Mapbox canvas and never receive the pointer. -->
    <div class="map-scroll-edge map-scroll-edge--left" />
    <div class="map-scroll-edge map-scroll-edge--right" />
    <!-- Minimal control cluster: zoom in / zoom out only. Reused library components; :map binds
         each button to THIS panel's instance. Both use Mapbox's discrete zoomIn()/zoomOut() step,
         so a click is one bounded easing — never a per-frame camera loop. -->
    <MapToolbar class="rd-zoomtools" :has-geocoder="false" data-map-zoom-controls>
      <ZoomInButton :map="map" :disabled="!canZoomIn" />
      <ZoomOutButton :map="map" :disabled="!canZoomOut" />
    </MapToolbar>
    <!-- ★ THE ICON IS THE LABEL, because the word could not be translated without inventing one.
         a browser check saw "🌐 Globe" in Arabic on ?lang=ar (KA3, 3d64bcad): hardcoded English chrome on a
         localized map. "Globe" has no catalogue entry and "Flat" has none in any of the eleven
         locales, so translating the visible text meant either authoring ten new strings for a
         two-state toggle or leaving nine locales reading English. The catalogue DOES already ship
         mapui.enableGlobe / mapui.disableGlobe in all eleven — as the ACTION, which is what a button
         should announce anyway — so the accessible name and the tooltip come from there and the
         visible pill carries the glyph alone. A reader now sees no English, and a screen reader hears
         the action in their own language rather than the state in someone else's.
         The label names what the click DOES, not where you are: in globe mode the button turns the
         globe off. -->
    <!-- ★ KEYBOARD, not just focus. This announces itself as a button and takes tab focus, so a reader
         using the keyboard lands on it and nothing happens — role and tabindex promise an activation
         this had no handler for (WCAG 2.1.1). A real <button> would give it for free; this is a span
         because the pill is positioned inside the map chrome, so the promise has to be kept by hand.
         .prevent on space stops the page scrolling underneath the press. -->
    <span class="rd-proj" role="button" tabindex="0" data-proj-toggle @click="toggleProjection"
          @keydown.enter.prevent="toggleProjection" @keydown.space.prevent="toggleProjection"
          :title="projName" :aria-label="projName">
      <span aria-hidden="true">{{ projection === 'globe' ? '🌐' : '▭' }}</span>
    </span>
    <div class="rd-legend-map" data-map-legend :aria-label="T('aria.upgCountLegend', 'UPG count legend')">
      <!-- ★ COMPOSED FROM TWO EXISTING CATALOGUE ENTRIES, not from new wording. This legend title
           was the last piece of English chrome here that could be translated without inventing a
           phrase in ten languages: legend.columns.upgs and dashboard.country both already ship in
           all eleven locales, and a slash-joined pair of them says exactly what the column is. The
           English shifts from "UPGs / country" to "UUPGs / Country", which is the tree's own
           spelling of both words everywhere else. -->
      <div class="lg-h">{{ T('legend.columns.upgs', 'UUPGs') }} / {{ T('dashboard.country', 'Country') }}</div>
      <div v-for="b in LEGEND_BINS" :key="b.l" class="lg-row">
        <span class="lg-sw" :style="{ background: b.c }"></span><span>{{ b.l }}</span>
      </div>
    </div>
  </div>
</template>
