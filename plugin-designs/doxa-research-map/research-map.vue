<script setup>
/**
 * research-map.vue — Application Profile: Research Map
 *
 * @description The researcher's workbench: every piece a missiologist, demographer or
 *   ethnographer needs to produce a publishable map — clustering, fly-to navigation,
 *   multi-field filters, the language-family legend, a detail panel and large-format poster
 *   export, all in one capability-3 monolithic element.
 *
 * The "researcher's workbench" archetype. Composes every framework piece a
 * subject-matter expert (missiologist, demographer, ethnographer) needs to
 * produce a publishable map: clustering, fly-to navigation, multi-field
 * filters, language-family legend, detail panel, and large-format poster
 * export.
 *
 * profile-config shape (minimal for research-map):
 *   {
 *     "profile":   "research-map",
 *     "tk":        "MAPBOX_PUBLIC_TOKEN",
 *     "dataSource": "pray-tools",
 *     "instanceId": "any-stable-id"
 *   }
 * Tabs are NOT configurable from outside this profile — they're baked in.
 * To change them, edit the TABS constant in this file.
 *
 * BAKED-IN TABS — the ALL_TABS constant below (7 declared; TABS = the ones whose FEATURES
 * flag is on, 6 live as of 2026-09-16 — Adoption is behind a flag). Labels as shown:
 *   1. Prayer         (prayerProgress / prayer)
 *   2. Adoption       (adoption / adoption)                     [feature-flagged]
 *   3. Engagement     (engagement / engagement)                 [separator after]
 *   4. People Groups  (affinityBlock / affinity-block)
 *   5. Regions        (doxaRegion / doxa-regions)
 *   6. Languages      (languageFamily / language-families)
 *   7. Religions      (religion / religion)
 * This is a MULTI-VIEW element (one app profile, several screens switched inside one .vue;
 * machine key "monolithic" in research-map.meta.json) — see documentation/reference.md "Profile types".
 */

import { getCurrentInstance, inject, provide, ref, computed, onMounted, onBeforeUnmount, watch, markRaw, toRaw, nextTick, toRef } from 'vue'
import MapPrintProgress from '@map/components/poster/MapPrintProgress.vue'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { retryableAsyncComponent } from '@map/composables/retryableAsyncComponent.js'

// ─── Composables (framework) ─────────────────────────────────────────────────
import { useMapInstance }  from '@map/composables/useMapInstance.js'
import { resolveMapProvider, providerLabel, providerFor, setProjectionOn } from '@map/composables/useMapProvider.js'
import { useMapLayers, PIN_STROKE_WIDTH_LIGHT, buildDarkRingWidth } from '@map/composables/useMapLayers.js'
import { useMapTheme, THEME_TOGGLE, FIXED_BASEMAP } from '@map/composables/useMapTheme.js'
import { useMapEvents }    from '@map/composables/useMapEvents.js'
import { useMapFly }       from '@map/composables/useMapFly.js'
import { useSelectedPin }  from '@map/composables/useSelectedPin.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { useCountryOutline, resolveCountryIso } from '@map/composables/useCountryOutline.js'
import { FULL_PRAYER_THRESHOLD } from '@map/colors/prayer-progress.js'
import { useI18n } from 'vue-i18n'
import { SUPPORTED_LOCALES } from '@map/i18n/index.js'

// Shared data pipeline — lives in the library (@map/composables/useMapData.js).
import { useMapData }      from '@map/composables/useMapData.js'
import { useGeocoderSearch } from '@map/composables/useGeocoderSearch.js'

// PERF: useMapClustering pulls in MSTClusteringUtil + NetworkClusteringUtil +
// ClusterHelpers (~30 KB total). Clusters are off by default — defer the
// import + instantiation until the user toggles them on. See `getClustering()`
// below.

// PERF: useMapPoster pulls in the tile-stitch + PDF composition pipeline
// (~117 KB). It is imported on the first "Export poster" click — see `openPoster()` below.


// ── Geocoder search logic moved to @map/composables/useGeocoderSearch.js ──────
// The geocoder-clear guard (_geoBeingCleared + clearGeocoderProgrammatic) and the
// legend:reveal-selected emitter now live in the shared composable. The composable
// returns clearGeocoderProgrammatic (used below by onSemanticTreeSelect / switchTab
// / applyDimFilter) plus the three template handlers.

// Mirror setFilter to the invisible hitbox layer so click targets stay in sync.
// Kept profile-local — onSemanticTreeSelect / applyDimFilter / clearAllHighlights
// all call it (the composable carries its own private copy for the PG handler).
function _syncHitboxFilter(m, filter) {
  if (m?.getLayer('language-family-pins-hitbox')) {
    try { m.setFilter('language-family-pins-hitbox', filter) } catch (_) {}
  }
}

// ── SCROLL-ZOOM vs PAGE-SCROLL (BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID, the mobile
// research-map-plus-grid pair). Ported verbatim from DashboardMapPanel.vue (proven fix,
// 2026-09-22/23), which had this and this component did not — this component is the
// map research-map-plus-grid hosts via <doxa-research-map> in a StackLayout `.stl-sec-fill`
// band, and MEASURED in the cap-5 shell (mobile width) its wheel never reached .dms-pane: the
// canvas sat at composedPath()[0] and scrollZoom stayed enabled because nothing here ever
// disabled it. Mapbox calls preventDefault() on every wheel over its canvas to zoom, which is
// correct for a fixed-viewport leaf and wrong once this map is embedded in a scroll-page
// composite (a wheel that never reaches the document/ancestor cannot scroll to whatever is
// stacked below the map). Same detection as the dashboard panel: is there a scrollABLE
// ancestor (walking the COMPOSED tree, hopping shadow boundaries via `.host`) or does the
// document itself scroll? Either one means release scroll-zoom back to the page; neither
// means keep it (the standalone fixed-viewport leaf, where wheel-zoom is expected). Nothing
// is lost either way — the toolbar zoom buttons and double-click/pinch zoom still work.
function _syncScrollZoomToHost(m) {
  if (!m || !m.scrollZoom) return
  try {
    const doc = document.documentElement
    const docScrolls = doc.scrollHeight > window.innerHeight + 4
    const host = (m.getContainer && m.getContainer()) || null
    const ancestorScrolls = host ? !!findScrollportAncestor(host) : false
    // ★ THE MAP KEEPS THE GESTURE. THE EDGE STRIPS ARE THE WAY PAST IT.
    // Required 2026-09-24: "two finger scrolling on the map should allow me to interact with the
    // map, but instead it just scrolls down past the map and does not interact with the map —
    // that's what the scroll side bars are there for, to let me interact with the map AND have a
    // way to scroll down past the map."
    //
    // This used to disable scroll-zoom whenever the page or an ancestor could scroll, which is
    // ALWAYS true in the research-map-plus-grid composite (a map with a grid stacked under it).
    // MEASURED before this change, wheel over the centre of the map in that composite:
    // scrollY 0 -> 480 and the camera never moved. The map was inert exactly where it is the
    // main control.
    //
    // It was not a careless choice — it fixed BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID, where the map
    // ate every wheel and the grid below was unreachable. But that bug had already been solved a
    // second way: the .map-scroll-edge gutters (useEdgeScrollAffordance, pointer-events:auto,
    // touch-action:pan-y) are a dedicated page-scroll lane down both sides, and the note at the
    // Map constructor says so outright — "the single-finger page-scroll escape is NOW the gray
    // side-edge affordance". With the strips in place, releasing the wheel as well made the map
    // non-interactive and left the strips redundant. Two fixes for one bug, and the second one
    // silently undid the feature.
    //
    // So: keep scroll-zoom ON, and let the strips carry the page.
    //
    // ★ THE TWO SCROLL PROBES THAT USED TO SIT HERE ARE GONE, AND THE COMMENT THAT KEPT THEM WAS
    // WRONG. It said docScrolls/ancestorScrolls were still computed because "the edge affordance
    // keys its gray indicator off the same question". This profile has no such indicator and never
    // calls useEdgeScrollAffordance: its .map-scroll-edge strips are background:transparent lanes
    // that are always present (see the rules near the bottom of this stylesheet). They were
    // function-local consts, computed and discarded — the comment described a consumer that does
    // not exist here, which is worse than no comment, because it makes dead code look load-bearing.
    // _findScrollportAncestor STAYS: it is still used to pick a second ResizeObserver target below.
    m.scrollZoom.enable()
  } catch (_) { /* an engine without scrollZoom must never break the panel */ }
}

// Shared legend pipeline — lives in the library (@map/composables/legends/useLegendData.js).
import { useLegendData }   from '@map/composables/legends/useLegendData.js'

// ─── Config + utils ──────────────────────────────────────────────────────────
import { mapDefaults }            from '@map/constants/mapDefaults.js'
import { getColorStrategy }       from '@map/colors/_registry.js'
import { RELIGION_FAMILIES }      from '@map/colors/religion.js'
import { tStatic } from '@map/i18n/index.js'

// This map's own chrome, read out of the catalogue. tStatic and not useI18n: this component is the
// root of a custom element, where useI18n() cannot resolve its injection and throws.
const T = (key, en) => tStatic(key) || en
import { DataSourceManager }      from '@map/utils/DataSourceManager.js'
import sourcesConfig              from '@map/api/sources.json'

// ─── Components ──────────────────────────────────────────────────────────────
import LegendDesktop  from '@map/components/legends/LegendDesktop.vue'
// LegendTools — Fly + Clusters floating toolbar. Mounted as a SIBLING of the
// legend (not a child) so its CSS lives in its own useShadowStyles namespace
// and doesn't fight the legend card's selectors. Per UX 2026-04-27.
import LegendTools    from '@map/components/legends/LegendTools.vue'
import { showsFlyTools } from '@map/components/legends/LegendTools.vue'
// PERF: LegendMobile only renders below the @media(max-width:767px) breakpoint.
// Defer the import so desktop users never load it.
const LegendMobile = retryableAsyncComponent(() => import('@map/components/legends/LegendMobile.vue'))

// Map toolbar — canonical modular pattern from the read-only simple-map mfe.
// MapToolbar is the slot-wrapper; the individual button components are children.
// Tabs 1-3 (engagement / prayer / adoption) are exact clones of simple-map and
// must mount this exact button set in this exact order.
import MapToolbar        from '@map/components/map-controls/MapToolbar.vue'
import ZoomInButton      from '@map/components/map-controls/ZoomInButton.vue'
import ZoomOutButton     from '@map/components/map-controls/ZoomOutButton.vue'
import LocationButton    from '@map/components/map-controls/LocationButton.vue'
import FullscreenButton  from '@map/components/map-controls/FullscreenButton.vue'
import ThemeToggleButton from '@map/components/map-controls/ThemeToggleButton.vue'
import HamburgerButton   from '@map/components/map-controls/HamburgerButton.vue'
import GeocoderComponent from '@map/components/map-controls/GeocoderComponent.vue'
import ShareButton       from '@map/components/map-controls/ShareButton.vue'
import MapControlButton  from '@map/components/map-controls/MapControlButton.vue'
// "What can this map do?", as the top control. By path like the rest: the map-controls barrel would pull
// the whole 'mapInfo' catalogue area into this bundle.
import MapInfoButton     from '@map/components/map-controls/MapInfoButton.vue'

// PERF: SideMenuDrawer is unused in the current research-map template (the
// ResearchMapSideMenu sibling renders the actual menu). Removed entirely from
// the boot path until something needs it.
// import SideMenuDrawer from '@map/components/SideMenuDrawer.vue'

// PERF: PeopleGroupDetail (~115 KB with its CSS bundle) only renders after
// the user clicks a pin. Async-import it so it stays off the critical boot.
const PeopleGroupDetail = retryableAsyncComponent(() => import('@map/components/PeopleGroupDetail.vue'))

// New components written in this same wave:
import ResearchMapSideMenu    from '@map/components/ResearchMapSideMenu.vue'
import ResearchMapFilterPanel from '@map/components/ResearchMapFilterPanel.vue'
import SemanticTreeLegend     from '@map/components/legends/SemanticTreeLegend.vue'
// Per-app-profile feature flag: surface the SemanticTreeLegend Export
// affordance (Poster/Packet) for this profile. UX scaffold only — the menu
// options are locked "coming soon" stubs. Flip to false to hide it here.
const EXPORT_FEATURE_ENABLED = true
// Per-map mediator instance (PPLR-ported). createPplrInstance + provideInstance
// give the SemanticTreeLegend its selection/activeTab/theme refs via inject().
import { createPplrInstance, provideInstance } from '@map/composables/usePplrInstance.js'
// langTree adapter — converts our normalized people-groups into the generic
// {id,label,color,count,pop,filter,children} shape SemanticTreeLegend takes.
import { useLanguageFamilyLegendData } from '@map/composables/legends/useLanguageFamilyLegendData.js'
// affinityTree adapter — parallel to langTree, produces the same {id,label,color,count,pop,filter,children}
// shape from rop1 (affinity bloc) + imb_reg_of_people_2 (cluster) + people group, so the SAME
// SemanticTreeLegend instance can render either depending on activeLegendType.
import { useAffinityBlockLegendData } from '@map/composables/legends/useAffinityBlockLegendData.js'
import { useWagfRegionsLegendData }   from '@map/composables/legends/useWagfRegionsLegendData.js'
import { useLegendMapBridge, findNodeInTree, buildFlatLegendMatchExpr, regionIdle } from '@map/composables/legends/useLegendMapBridge.js'
import { useLegendData as useFlatLegendData } from '@map/composables/legends/useLegendData.js'
import { RESEARCH_LEGEND_OPTIONS } from '@map/composables/legends/researchLegendOptions.js'
import { findScrollportAncestor } from '@map/utils/scrollport.js'



// ─── Shadow-DOM style injection ──────────────────────────────────────────────
useShadowStyles(`
  /* ── Canonical geocoder + legend container CSS (clone of doxa-simple-map.vue
       lines 50-138) so tabs 1-3 render the geocoder + legend at the same
       400/360/280 px responsive widths the simple-map mfe uses. The
       --map-legend-width / --map-btn-size / --map-toolbar-gap / --map-font-md
       / --map-font-sm CSS vars are set by applyContainerScale() below. ── */
  /* Geocoder column matches the SemanticTreeLegend's .stl-panel — inset-inline-start:8px,
     width:380px — so the search bar and the legend stack as one column at
     the same x-edge (PPLR alignment). */
  /* The search pill is exactly as wide as the legend below it: both follow --map-legend-width. */
  /* ★ LOGICAL, so the search bar and the legend mirror TOGETHER (studio's legend sweep).
     This column exists to sit at the same x-edge as SemanticTreeLegend's .stl-panel — that is the
     whole point of the alignment recorded above. The legend already moves under ar; this rule
     pinned the search bar with a physical left, so in Arabic the two came apart and the bar was
     left stranded on the side the legend had vacated. A shared edge that only one of the pair
     honours is worse than no alignment: it reads as a broken layout rather than a choice.
     inset-inline-end:auto comes with it to cancel the engine's own physical inset on this
     container, which would otherwise stretch the column across the map once the start edge moves. */
  .mapboxgl-ctrl-top-left { top:12px!important;inset-inline-start:8px!important;inset-inline-end:auto!important;width:var(--map-legend-width,380px)!important;max-width:var(--map-legend-width,380px)!important;z-index:1200!important; }
  .mapboxgl-ctrl-top-left .mapboxgl-ctrl { margin:0!important;float:none!important; }
  /* Pill geometry + PPLR-matched focus ring. border-radius
     999px matches PPLR's .pgc-input-wrap; focus-within ring uses PPLR's
     accent rgba(59,70,61,0.18) so the search bar reads as one column with
     the SemanticTreeLegend below it. Input font-size:13px / placeholder
     12px mirror PPLR's typography. */
  .mapboxgl-ctrl-geocoder { width:100%!important;max-width:100%!important;min-width:0!important;border-radius:999px!important;box-shadow:0 2px 8px rgba(0,0,0,0.15)!important;background:#fff;transition:box-shadow 0.12s,border-color 0.12s; }
  .mapboxgl-ctrl-geocoder:focus-within { box-shadow:0 2px 8px rgba(0,0,0,0.15),0 0 0 3px rgba(59,70,61,0.18)!important; }
  .mapboxgl-ctrl-geocoder--input { border-radius:999px!important;font-size:13px!important; }
  .mapboxgl-ctrl-geocoder--input::placeholder { font-size:12px!important; }
  .mapboxgl-ctrl-geocoder:has(.mapboxgl-ctrl-geocoder--input:not(:placeholder-shown)) .mapboxgl-ctrl-geocoder--button { display:block!important; }
  /* Clear (X) button. (a) Hidden until the user types — the sibling :has rule above flips
     it to display:block only when the input is non-empty. (b) No visible box: transparent
     background, no border/shadow/padding. (c) The X icon centred both ways regardless of
     search-bar height — the stock geocoder pinned the button + icon with a fixed top:8px,
     so a shorter bar pushed the X below centre (worse on mobile where the icon is larger). */
  .mapboxgl-ctrl-geocoder--button { display:none!important;top:50%!important;bottom:auto!important;transform:translateY(-50%)!important;margin:0!important;padding:0!important;width:24px!important;height:24px!important;background:transparent!important;border:none!important;box-shadow:none!important; }
  /* Fix the icon to ONE size + absolute-centre it so the X is identical on mobile and
     desktop — stock CSS uses 20px/margin-top:8px below 640px but 16px/margin-top:3px above,
     which is why the X sat lower on mobile than desktop. */
  .mapboxgl-ctrl-geocoder--button .mapboxgl-ctrl-geocoder--icon-close { position:absolute!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%)!important;margin:0!important;width:16px!important;height:16px!important; }
  .mapboxgl-ctrl-geocoder--suggestions { z-index:1200!important;position:absolute;max-height:60vh!important;overflow-y:auto!important; }
  .suggestions { border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-height:60vh!important;overflow-y:auto!important; }
  .mapboxgl-ctrl-geocoder--suggestions::-webkit-scrollbar,
  .suggestions::-webkit-scrollbar { width:8px; }
  .mapboxgl-ctrl-geocoder--suggestions::-webkit-scrollbar-thumb,
  .suggestions::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.3);border-radius:4px; }
  .mapboxgl-ctrl-geocoder--suggestions::-webkit-scrollbar-track,
  .suggestions::-webkit-scrollbar-track { background:rgba(0,0,0,0.05); }
  .dg-main { font-weight:500;font-size:13px;color:#222;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px; }
  .dg-main strong { font-weight:700;overflow:hidden;text-overflow:ellipsis; }
  .dg-meta { margin-top:2px;display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11px;color:#555;line-height:1.35; }
  .dg-field strong { font-weight:600;color:#333;margin-inline-end:2px; }
  /* Round 16 — labeled category tag replacing the old emoji prefixes. */
  .dg-tag { flex:none;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#3b463d;background:rgba(59,70,61,0.10);border-radius:4px;padding:1px 5px;line-height:1.5;white-space:nowrap; }
  .dg-agg-label { overflow:hidden;text-overflow:ellipsis; }
  .dg-count { flex:none;font-size:11px;font-weight:600;color:#73a17f; }
  .dsm-dark .dg-tag { color:#cfe3d6;background:rgba(115,161,127,0.22); }
  .dsm-dark .dg-count { color:#9fd0ab; }
  /* Geocoder section divider headers — non-clickable visual labels */
  .suggestions li:has(.dg-section-header-item) > a { pointer-events:none!important;cursor:default!important;background:none!important;padding:4px 10px 2px!important; }
  .dg-section-header-item { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#9ca3af;padding:2px 0; }
  .dsm-dark .dg-section-header-item { color:rgba(243,243,241,0.45); }
  @media(max-width:767px){
    /* The phone search band (a header strip that holds the pill) is owned by GeocoderComponent. */
    /* Search-bar height (exactly 35px, desktop AND mobile) is now owned by the shared
       GeocoderComponent.vue injection 'geocoder-height-35' — no per-profile @media
       height hack needed (replaces bug-searchbar-mobile-height). */
  }

  /* ── Dark mode for the geocoder pill + suggestions dropdown — clone of
       doxa-simple-map.vue:99-124. Selectors keyed on .dsm-dark (mirrored on
       .rm-root by the isDark binding). Without these rules the geocoder stays
       white in dark mode (qa.md Round 3 Q4). ── */
  .dsm-dark .mapboxgl-ctrl-geocoder { background:#4e594f!important;border:1px solid rgba(255,255,255,0.14)!important;box-shadow:0 2px 8px rgba(0,0,0,0.4)!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder:focus-within { box-shadow:0 2px 8px rgba(0,0,0,0.4),0 0 0 3px rgba(115,161,127,0.22)!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--input { color:#F3F3F1!important;background:transparent!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--input::placeholder { color:rgba(243,243,241,0.65)!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder .mapboxgl-ctrl-geocoder--icon { fill:rgba(243,243,241,0.75)!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--button { background:transparent!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--icon-close { fill:rgba(243,243,241,0.75)!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--button:hover .mapboxgl-ctrl-geocoder--icon-close { fill:#F3F3F1!important; }
  .dsm-dark .suggestions { background:#3b463d!important;border:1px solid rgba(255,255,255,0.12)!important; }
  .dsm-dark .suggestions > li { background:transparent!important; }
  .dsm-dark .suggestions > li > a { background:transparent!important;color:#F3F3F1!important; }
  .dsm-dark .suggestions > li.active > a,
  .dsm-dark .suggestions > li.selected > a,
  .dsm-dark .suggestions > li:hover > a,
  .dsm-dark .suggestions > li > a:hover,
  .dsm-dark .suggestions > li > a:focus { background:rgba(255,255,255,0.1)!important;color:#F3F3F1!important; }
  .dsm-dark .dg-main { color:#F3F3F1!important; }
  .dsm-dark .dg-meta { color:rgba(243,243,241,0.75)!important; }
  .dsm-dark .dg-field strong { color:#F3F3F1!important; }

  /* isolation:isolate forces .rm-root to form its own stacking context so
     internal z-indexes (geocoder 1200, legend 1000, toolbar 10) compare only
     against each other and do NOT leak out to compete with page-level
     elements like the site nav / hamburger menu (the geocoder pill otherwise
     rendered above the page menu). Without
     this, the host element doesn't establish a stacking context and the
     internal 1200 wins against any page elements with z-index < 1200. */
  .rm-root { position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;background:#ffffff;color:#1f2937;isolation:isolate; }
  .rm-root.rm-dark { background:#1a1a2e;color:#F3F3F1; }

  /* Tab bar: MATERIAL WHITE surface (was #4e594f dark green-grey to match the
     doxa-life site header — changed 2026-07-29 per the design: all chrome light,
     only the BASEMAP keeps its dark colour strategy). Poppins 500.
     The 3.5rem-rounded card corner from .rounded-xlg on the host <DoxaMapSlot>
     clips the bar's top-left, so padding-left keeps "Prayer" fully visible. */
  .rm-tab-bar {
    flex:0 0 auto;display:flex;align-items:center;
    background:#ffffff;
    /* No rule under the tabs: the header and the map read as one surface. */
    height:44px;
    /* The tab bar IS the card's top edge: it carries the same top corners as the card so the
       header flows into the rounding with no pale sliver left behind by a square corner. */
    border-top-left-radius:var(--map-radius, 0px);
    border-top-right-radius:var(--map-radius, 0px);
    /* Inline padding clears the rounded slot corner so the first tab
       ("Prayer") doesn't sit under the curve. Desktop bumps the start side
       to 36px because .rounded-xlg eats a much larger chunk of the
       top-left corner than the standard 16px gutter; end side stays 16px.
       Mobile @media block below resets both sides back to 16px since the
       mobile slot uses a smaller radius and the existing 16px is correct
       there (desktop only). Active-tab
       scrollIntoView still uses 16px scroll-padding which is fine — the
       tab is already visible, just nudged by the static padding. */
    padding-inline-start:36px;
    padding-inline-end:16px;
    scroll-padding-inline:16px;
    /* Spacing is tuned, not computed: at the common desktop width this value happens to land
       the fourth tab on the page's centre line, under the link above it, and still leaves room
       after the last tab for more. Nothing here depends on which tab that is, so reordering or
       renaming tabs changes nothing but the spacing that a future eye may want to re-tune. */
    gap:44px;
    z-index:10;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;
    font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  }
  .rm-tab-bar::-webkit-scrollbar{display:none;width:0;height:0;}
  .rm-dark .rm-tab-bar { background:#2a332a; }
  /* Tab text on the WHITE bar: muted grey, darkening to the Material accent when
     active (was beige #F3F3F1 / #cbc5b9 for the old green bar — unreadable on white). */
  /* A tab is its word with a STAGE under it: an 8px rectangle, 8px below the text, as wide as
     the word. The stage is always in the layout (transparent when inactive) so selecting a tab
     never shifts the row. Doxa sage marks the selection — the greener end of the brand scale;
     the grey-greens above it read as dull. */
  .rm-tab {
    background:none;border:none;padding:0;height:100%;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;
    font-family:inherit;
    font-size:15px;font-weight:600;
    color:#9aa19b;
    cursor:pointer;
    white-space:nowrap;
    transition:color .12s;
  }
  .rm-tab::after {
    content:'';display:block;align-self:stretch;height:4px;border-radius:2px;
    background:transparent;transition:background .12s;
  }
  .rm-tab:hover { color:#3b463d; }
  .rm-tab.active { color:#3b463d;font-weight:700; }
  .rm-tab.active::after { background:#73A17F; }
  /* Separator: thin vertical bar between simple-map-style tabs (Prayer/Adoption/
     Engagement) and research-only tabs (Languages/Affinity Blocks/Religion).
     Sits at ~50% height so it reads as a divider, not as a tall border. */
  .rm-tab-sep {
    flex: 0 0 1px;
    align-self: center;
    width: 1px;
    height: 50%;
    /* dark divider for the white bar (was rgba(255,255,255,.7) for the green bar) */
    background: rgba(0, 0, 0, 0.18);
    pointer-events: none;
  }
  .rm-dark .rm-tab.active { color:#92b195; }
  .rm-dark .rm-tab { color:rgba(243,243,241,0.55); }
  .rm-dark .rm-tab:hover { color:#F3F3F1; }
  .rm-dark .rm-tab.active { color:#cbc5b9;border-bottom-color:#cbc5b9; }
  @media(max-width:767px){
    .rm-tab-bar { padding-inline:16px; scroll-padding-inline:16px; gap:16px; height:40px; }
    .rm-tab { font-size:13px; }
  }
  .rm-map-area { flex:1 1 0;position:relative;overflow:hidden; }
  /* ROUNDED CORNERS REACH THE CANVAS. The host page rounds this element; a WebGL canvas is
     promoted to its own compositing layer and is not reliably clipped by an ancestor's radius
     (Firefox shows square corners under a rounded slot), so the radius is inherited all the way
     down to the canvas instead of relying on the ancestor clip alone. */
  .rm-root, .rm-map-area, .rm-map-canvas,
  .rm-map-canvas .mapboxgl-canvas-container, .rm-map-canvas .mapboxgl-canvas,
  .rm-map-canvas .maplibregl-canvas-container, .rm-map-canvas .maplibregl-canvas { border-radius: var(--map-radius-corners, var(--map-radius, 0px)); }
  /* PAINT-TIME CLIP. border-radius alone is applied to a COMPOSITED child (the WebGL canvas)
     only once the engine builds a mask layer for it, so on a real GPU the corners go square the
     moment the map finishes loading. clip-path clips at paint time regardless of compositing,
     so the rounding holds before and after the canvas appears. */
  /* Clip the map AREA only. Clipping the canvas or its container breaks Mapbox's own
     transforms and the map renders grey, so the rounding stops one level above it. */
  .rm-map-area { clip-path: inset(0 round var(--map-radius-corners, var(--map-radius, 0px))); }

  /* ★ PRINTING THE PAGE COLLAPSED THE MAP AND THREW ITS CHROME UPWARD (DRV1650-SR-POSTER-EXPORT:
     "clicking print breaks the CSS: the map controls + legend jump upward").
     NOT the Export->poster path — that prints an off-screen iframe whose body is one <img> with its own
     @page, which this plugin's CSS cannot reach. This is the BROWSER's own print of the live page.
     THE MECHANISM, from the cascade rather than a screenshot: .rm-root is position:absolute;inset:0 with
     no positioned ancestor, so its containing block is the INITIAL one -- the viewport on screen, the PAGE
     BOX in print. .rm-map-area takes all its height from that root via flex:1 1 0, and .rm-map-canvas plus
     every overlay (legend, badges, scroll edges) is absolute;inset:0 inside it. In a paged medium the root
     no longer resolves to a viewport height, the flex child collapses toward zero, and everything pinned
     inside it stacks at the top. That is the jump.
     THE FIX IS TO STOP BEING ABSOLUTE WHEN THERE IS NO VIEWPORT: in print the root flows in normal
     document order and the map area is given an explicit height, so its absolutely-positioned children
     have a real box to sit in. The map keeps a printable size instead of a sliver.
     Overlays that describe INTERACTION rather than content are hidden: a scroll affordance, a provider
     badge and a loading veil mean nothing on paper, and the scroll edges would print as grey bars.
     The legend STAYS -- it is the key to what the map shows, and printing a choropleth without it prints
     an unreadable picture. */
  @media print {
    .rm-root { position:static; inset:auto; overflow:visible; height:auto; }
    .rm-map-area { flex:0 0 auto; height:60vh; min-height:0; overflow:visible; clip-path:none; }
    .map-scroll-edge, .rm-provider-badge, .rm-loading { display:none !important; }
  }
  .rm-map-canvas { position:absolute;inset:0; }

  /* ★ PRINT: GIVE THE MAP AREA A HEIGHT, OR EVERYTHING ANCHORED TO IT RISES.
     .rm-map-area is flex:1 1 0 — it has no height of its own and fills a viewport-height ancestor.
     Print layout has no viewport height, so that box collapses toward its content height, and the
     toolbar and legend (position:absolute against it) move UP with its top edge. That is the reported
     print breakage (the map controls and legend jump upward), and it needs no print
     stylesheet to cause — the browser's DEFAULT print styles are enough, because nothing here declared
     one. A profile with no @media print rules is not neutral in print; it is unspecified.
     A definite height restores the anchor. This does not change what the poster prints — that is a
     separate document in its own frame (printInPlace) — it stops the LIVE page deforming while the
     dialog is open. */
  @media print {
    .rm-map-area { flex: 0 0 auto; height: 100vh; min-height: 0; }
  }
  /* MATERIAL LIGHT (2026-09-21). Was background #0f1216 / color #7c8cf8 — same unconditional
     loading overlay as .dsm-loading, .apg-loading and countries-map's .rm-loading. Rendered on
     every load via v-if="!appReady", so it was the first surface a visitor saw.
     Palette: surface #f3f3f1, muted #6d766e. */
  .rm-loading { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#f3f3f1;color:#6d766e;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;z-index:5; }
  /* Failure state, NOT a cover: modelled on cities-internet's .gm-err so anything the
     map did manage to render stays visible around it. A spinner that outlives the
     failure reads as "slow" and the user just waits; this says the map is gone. */
  .rm-error { position:absolute;top:50%;left:12px;right:12px;z-index:7;transform:translateY(-50%);text-align:center;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fecaca;background:rgba(15,18,22,.95);border:1px solid rgba(254,202,202,.28);border-radius:10px;padding:12px 14px;box-shadow:0 2px 10px rgba(0,0,0,.4); }
  /* inset-inline-end, not right: this badge is pinned to the READING edge, so under ar it belongs on
     the left. .map-scroll-edge--left/right below stay physical on purpose — those are literal screen
     edges for a scroll affordance and do not mirror. */
  .rm-badge { position:absolute;top:10px;inset-inline-end:10px;background:rgba(124,140,248,0.12);color:#7c8cf8;border:1px solid rgba(124,140,248,0.3);padding:3px 9px;border-radius:4px;font-size:11px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:none;z-index:50; }
  /* Engine badge — bottom-left, unobtrusive. Colour differs per engine so a
     side-by-side comparison is readable at a glance. */
  .rm-provider-badge { position:absolute;bottom:8px;inset-inline-start:8px;z-index:50;pointer-events:none;padding:2px 8px;border-radius:999px;font:600 10px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.04em;color:#fff;background:rgba(30,41,59,0.72);border:1px solid rgba(255,255,255,0.18);backdrop-filter:blur(2px); }
  .rm-provider-badge[data-provider="mapbox"] { background:rgba(37,99,235,0.78);border-color:rgba(147,197,253,0.5); }
  .rm-provider-badge[data-provider="maplibre"] { background:rgba(5,150,105,0.80);border-color:rgba(110,231,183,0.5); }
  /* Mobile-only legend slot — desktop hides via @media */
  .rm-legend-mobile-slot { display:none; }
  @media(max-width:767px){
    .rm-legend-mobile-slot { display:block; }
    .rm-legend-desktop-slot { display:none; }
    /* The engine badge stays off phones. The legend sheet there spans the map's bottom edge and
       covered the end of the badge (it read "MapLibr"), and the map's credit already names the engine. */
    .rm-provider-badge { display:none; }
  }
  /* Exactly as wide as the control column: button + its 3px edge margin on both sides. */
  .map-scroll-edge { position:absolute;top:0;bottom:0;width:calc(var(--map-btn-size,32px) + 6px);z-index:2;touch-action:pan-y;pointer-events:auto;background:transparent; }
  .map-scroll-edge--left { left:0; }
  .map-scroll-edge--right { right:0; }
`, 'research-map')

// ─── Config from ProfileLoader (provide/inject — never direct imports) ──────
const profileConfig = inject('profileConfig')
const mapboxToken   = inject('mapboxToken')
// Map engine: profile-config.provider → window.MAP_PROVIDER → 'mapbox' (default).
const mapProvider     = resolveMapProvider(profileConfig)

// ── SEARCH BAR + FLY/CLUSTER TOOLS ARE PROVIDER- AND HOST-DEPENDENT ──────────
// ★ WHY MAPLIBRE GETS NO SEARCH BAR AT ALL (decided 2026-09-23).
// The point of the maplibre provider is to run KEYLESS — a partner with thousands of sites swaps
// one prop and stops paying for a Mapbox key. But GeocoderComponent's maplibre path still calls
// makeMapboxForwardGeocode(accessToken) (GeocoderComponent.vue:526): the geocoding REQUEST goes to
// Mapbox whichever engine draws the tiles. So shipping the search bar under maplibre would keep
// billing the exact key the option exists to avoid, while LOOKING free. Under mapbox it stays —
// it is the fully-featured search this profile was built around.
// A host may also switch it off explicitly (`search: false`) without changing engine.
const hasGeocoder = computed(() => {
  if (profileConfig?.value?.search === false) return false
  return mapProvider === 'mapbox'
})

// ★ NO SEARCH BAR MEANS THE LEGEND RISES, NOT A DEAD GAP.
// SemanticTreeLegend's --stl-top defaults to 60px, and that 60px exists ONLY to reserve room for a
// search bar above it. Leaving it when the bar is gone is the empty band that was reported.
// 14px matches .lt-root's own top, so the legend lands where the search bar's top edge was.
// How far the legend may rise depends on WHAT ELSE is in the strip the search bar vacated.
// LegendTools sits at top:14px on the tabs its predicate allows, so raising the legend to 14 there
// prints the toolbar across the legend's header — MEASURED on country-posters. Ask the toolbar's own
// exported predicate rather than re-typing its condition here, and stop just below it when it shows.
// A collision is worse than the gap this is meant to close, and 56px still recovers most of it.
// Declared ABOVE legendTopVar, which reads it. A computed body is lazy so a later const would have
// resolved at runtime, but this file already carries a TDZ gate's worth of scars (check:setup-order):
// position is cheaper to keep honest than to reason about.
const showLegendTools = computed(() => profileConfig?.value?.legendTools !== false)
const legendTopVar = computed(() => {
  if (hasGeocoder.value) return null
  // ★ ASK WHETHER THE TOOLBAR IS RENDERED, NOT WHETHER THE LEGEND TYPE ALLOWS ONE. showsFlyTools() is
  // a statement about the legend TYPE; showLegendTools is whether this profile draws them at all. The
  // composite — which is what the reader calls "Simple Research" — passes legendTools:false because
  // Fly + Clusters are a leaf-only tool (see the note on showLegendTools). So on the Regions and
  // Languages tabs it reserved 56px for a toolbar it never draws, and only those two tabs, because
  // they are exactly the set showsFlyTools() returns true for. Every other tab took the 14px branch
  // and looked right, which is why it was reported as two tabs misbehaving.
  // MEASURED at 1440x900 on main e1d0bc20: the band from the map's top edge (y 44) to the
  // legend card (y 100) is 56px of EMPTY map on both tabs, with no LegendTools anywhere in the strip.
  // So the gap was dead space, not a toolbar the reader had not registered.
  const toolsShown = showLegendTools.value && showsFlyTools(activeLegendType?.value ?? activeLegendType)
  return toolsShown ? '56px' : '14px'
})

// ★ FLY + CLUSTERS ARE A LEAF-ONLY TOOL. LegendTools renders at top:14px centred on the legend
// column — the search bar's exact slot — so inside a COMPOSITE it appears to replace the search
// bar rather than accompany it. The composite (research-map-plus-grid, the "Simple Research" pair)
// is a reading surface: its map is one half of a stack, and a fly-tour that moves the camera under
// a grid the reader is scanning fights the other half. Default stays true so the standalone leaf
// is untouched; the composite passes legendTools:false.
const mapProviderName = providerLabel(mapProvider)
const dataSource    = inject('dataSource')
const colorSet      = inject('colorSet')
const injectedInstanceId = inject('instanceId', null)

// ─── Active locale (Layer-1 API data + Layer-2 UI chrome) ────────────────────
// The host Nuxt page passes its @nuxtjs/i18n locale via profile-config.locale.
// We use it as the authoritative locale for BOTH the map's UI i18n and the
// API `lang` param, so /fr/research shows French chrome AND French API data
// without depending on <html lang> read-timing in detectLocale(). When the
// host passes nothing, createAppI18n()'s detectLocale() fallback still applies.
const activeLocale = (() => {
  const l = profileConfig?.value?.locale
  return (l && SUPPORTED_LOCALES.includes(l)) ? l : null
})()
const { locale: uiLocale, t, te } = useI18n()
if (activeLocale) uiLocale.value = activeLocale

// Translate a layer-tab's display name from the `tabs.<key>` catalog (keyed by
// the tab's `i18nKey` or `id`), falling back to its hardcoded English `label`
// when no catalog entry exists. Mirrors SemanticTreeLegend.tabLabel (loc-003).
function tabLabel(tab) {
  const key = 'tabs.' + (tab?.i18nKey || tab?.id)
  return tab && te(key) ? t(key) : (tab?.label ?? '')
}

// Stores — instance-scoped Pinia, supplied by ProfileLoader
const mapStore  = inject('mapStore')
const dataStore = inject('dataStore')
const uiStore   = inject('uiStore')
const mapTheme  = useMapTheme(uiStore)

// ─── Tabs (HARDCODED for this profile) ───────────────────────────────────────
// This profile is self-contained: tabs are NOT read from profileConfig or
// inject('tabs'). The host's profile-config shrinks to { profile, tk,
// dataSource, instanceId }. To change the tabs, edit this constant.
//
// SOURCE OF TRUTH — this ALL_TABS constant IS the tab config for this profile.
//
// KEY CONTRACTS:
//   colorStrategy: keys come from the strategy registry (@map/colors/_registry.js),
//     auto-derived from filenames — library/colors/*.js supplies prayerProgress,
//     adoption, engagement, languageFamily, religion; this bundle's src/colors/*.js
//     adds affinityBlock, doxaRegion, resource (see index.js registerStrategies call).
//   legend: keys are the legendType values handled by
//     @map/composables/legends/useLegendData.js (TITLE_KEYS + normalizeLegendType) —
//     prayer, adoption, engagement, affinity-block, doxa-regions, language-family.
// FEATURES — flip to true to re-enable a tab. The Doxa Regions tab is
// feature-flagged OFF per UX request 2026-04-27 (kept in code so the wiring
// stays warm; flip `doxaRegions: true` to bring it back).
const FEATURES = {
  doxaRegions:    true,
  adoption:       false,  // Adoption tab hidden per UX request; wiring kept warm (flip to true to restore)
  share:          true,   // Share button enabled — parameterized share control on every map
  hamburgerMenu:  false,  // canonical default — emit/listen mismatch + drawer surplus
  // Per QA building-round-1 R3 A4: clear the geocoder text on tab switch by
  // default; flip to true to preserve the previous tab's query when returning.
  geocoderPersistAcrossTabs: false
}

// Tab order: Prayer → Adoption → Engagement → Language Families
// Adoption swapped before Engagement so
// the order reads as the user-flow ladder Prayer → Adopt → Engage rather
// than the previous alphabetical Engagement-before-Adoption.)
// No `label:` here: tabLabel() reads tabs.<i18nKey|id> behind a te() guard, and all seven keys
// resolve in all eleven locales, so an English label could never render — it was a second copy of
// each name that could only drift from the catalogue. The sub-tab tables lost theirs the same way.
const ALL_TABS = [
  { id: 'prayer',            colorStrategy: 'prayerProgress', legend: 'prayer',            popup: 'pray',  feature: null            },
  { id: 'adoption',          colorStrategy: 'adoption',       legend: 'adoption',          popup: 'adopt', feature: 'adoption'      },
  { id: 'engagement',        colorStrategy: 'engagement',     legend: 'engagement',        popup: 'pray',  feature: null,           sepAfter: true },
  { id: 'affinity-blocks',   colorStrategy: 'affinityBlock',  legend: 'affinity-block',    popup: 'pray',  feature: null            },
  { id: 'doxa-regions',      colorStrategy: 'doxaRegion',     legend: 'doxa-regions',      popup: 'pray',  feature: 'doxaRegions',  i18nKey: 'regions' },
  { id: 'language-families', colorStrategy: 'languageFamily', legend: 'language-family',   popup: 'pray',  feature: null            },
  { id: 'religion',          colorStrategy: 'religion',       legend: 'religion',          popup: 'pray',  feature: null            }
]
const TABS = ALL_TABS.filter(t => !t.feature || FEATURES[t.feature])
const tabs       = computed(() => TABS)
const showTabBar = computed(() => true)

const activeTabId = ref(null)
const activeTab   = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? tabs.value[0])
// Basemap look follows the active tab: prayer → night, everything else → day (monochrome).
// Re-evaluated whenever the tab changes, including when the tab list arrives after boot.
mapTheme.setLook(mapTheme.lookFor(activeTab.value?.colorStrategy))
watch(() => activeTab.value?.colorStrategy, (strategy) => mapTheme.setLook(mapTheme.lookFor(strategy), map.value))
const activeLegendType = computed(() => activeTab.value?.legend ?? 'default')
const activePopupAction = computed(() => activeTab.value?.popup ?? 'pray')

// Per-tab geocoder placeholder. The four tiered tabs name their own tiers, so the reader can see
// the search is wired to the legend's hierarchy rather than to the map at large; the flat tabs fall
// through to the default placeholder. Empty string means "no opinion" — GeocoderComponent then uses
// its own i18n default, which is why an unresolved key returns '' rather than English.
const GEOCODER_PLACEHOLDER_KEY = {
  'language-families': 'search.tabPlaceholder.languageFamilies',
  'affinity-blocks':   'search.tabPlaceholder.affinityBlocks',
  'doxa-regions':      'search.tabPlaceholder.regions',
  'religion':          'search.tabPlaceholder.religion',
}
const geocoderPlaceholder = computed(() => {
  const key = GEOCODER_PLACEHOLDER_KEY[activeTab.value?.id]
  if (key && te(key)) return t(key)
  return ''  // empty → GeocoderComponent falls back to i18n default
})

// Search context (Round 16) — maps the active legend tab to the category the
// unified search bar should surface FIRST. The three people-centric color tabs
// (prayer / adoption / engagement) share the people-groups context since they
// all paint people-group pins. null → useEntitySearch uses its default order.
const TAB_SEARCH_CONTEXT = {
  'affinity-blocks':   'people-groups',
  'prayer':            'people-groups',
  'adoption':          'people-groups',
  'engagement':        'people-groups',
  'language-families': 'language',
  'doxa-regions':      'regions',
  'religion':          'religion',
}
const geocoderContext = computed(() => TAB_SEARCH_CONTEXT[activeTab.value?.id] || '')

// ─── Map ID + container refs ─────────────────────────────────────────────────
// Per-instance map ID. Each <doxa-map> on the page MUST have a unique value so
// shared composables (mapStore, dataStore, clustering) don't bleed state
// across instances. Prefer the host-supplied `instanceId`; otherwise fall back
// to a 12-char random suffix that is collision-resistant for tens of instances.
const mapId = (injectedInstanceId?.value || injectedInstanceId) ||
  ('research-map-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8))
provide('mapId', mapId)

const rmRoot       = ref(null)
const tabBar       = ref(null)
const geocoderRef  = ref(null)

// Auto-center the active tab on switch so users always see what they tapped,
// even when the tab bar overflows the visible width (qa.md R8 spec).
// Per-tab legend tier memory: switching tabs saves the outgoing tab's
// legend state and restores the incoming tab's prior state (default
// 'collapsed' on first visit). Replaces the iter-3 always-collapse-on-
// switch behavior, which the user found jarring — they want returning
// to a tab to restore whatever tier (collapsed / open / fullyOpen) they
// last had it at.
const _tabLegendState = new Map()
watch(() => activeTabId?.value, async (newTabId, oldTabId) => {
  if (oldTabId !== undefined && newTabId !== oldTabId) {
    // Save outgoing tab's current state under the OLD tab id.
    if (oldTabId) _tabLegendState.set(oldTabId, uiStore.legendState)
    // Restore incoming tab's state (collapsed default for first visit).
    const restored = _tabLegendState.get(newTabId) || (uiStore.isMobile ? 'collapsed' : 'open')
    if (restored === 'fullyOpen')   uiStore.fullyOpenLegend?.()
    else if (restored === 'open')   uiStore.openLegend?.()
    else                             uiStore.collapseLegend?.()
  }
  await nextTick()
  // ★ SCROLL THE TAB BAR, NOT THE PAGE. This was
  //     btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  // and 'nearest' does not mean "do not scroll the page" — it means "scroll every scrollable
  // ancestor the least amount needed", and the HOST PAGE is an ancestor. MEASURED in the embed
  // sweep: a partner page carrying this map below the fold jumps to y≈640 the moment it mounts, on
  // a phone, where Simple Research is the default tab. The reader asked for nothing; the page moved
  // under them.
  // Centre the button INSIDE its own strip instead — the same shape as SemanticTreeLegend's
  // bringRowToTop, which scrolls the container it found rather than asking the platform to walk
  // ancestors. An element that only ever writes its own scrollLeft cannot move anybody's page.
  const bar = tabBar.value
  const btn = bar?.querySelector('.rm-tab.active')
  if (bar && btn && bar.scrollWidth > bar.clientWidth + 1) {
    const br = bar.getBoundingClientRect(), tr = btn.getBoundingClientRect()
    const target = bar.scrollLeft + (tr.left - br.left) - (br.width - tr.width) / 2
    const max = bar.scrollWidth - bar.clientWidth
    const left = Math.max(0, Math.min(max, target))
    if (typeof bar.scrollTo === 'function') bar.scrollTo({ left, behavior: 'smooth' })
    else bar.scrollLeft = left
  }
})
const mapContainer = ref(null)
const appReady     = ref(false)
// Set when map init concludes it has failed. appReady alone cannot express this:
// it is false both while loading AND forever after a failure, so the loading
// overlay outlived every failure. Same `err` shape cities-internet already uses.
const mapError     = ref(null)

// Manual zoom-in ceiling for the research map. COMMIT-LOG #8: the prior cap of 7
// sat below the cluster-break threshold so overlapping pins could never separate
// enough to be clickable; 10 still didn't give dense clusters room to spread.
// coder directive (2026-06-22): lift the cap to 18 so users can zoom deep into a
// dense cluster and click *between* overlapping pins. clusterMaxZoom (6) stays
// well below this, preserving the COMMIT-LOG #8 declustering-headroom invariant.
// NOTE: this trades away some of the location-obfuscation the low cap provided
// (street-level framing is now reachable) — accepted per explicit coder request.
// The zoom-IN cap below is pinned to this value; profile-config canNOT override it.
// Design decision: no hard zoom-in limit, so overlapping pins can ALWAYS be
// zoomed apart and clicked. 22 = Mapbox GL's engine
// maximum, i.e. there is no effective hard limit. Still NOT overridable from
// profile-config — a page must not re-impose a LOWER cap (that would re-block
// declustering, the exact bug this pin prevents). Future feature: auto-scatter
// overlapping pins so deep zoom isn't even required.
const RESEARCH_MAX_ZOOM = 22

// ─── Map instance (shadow-DOM safe — element ref, never string ID) ───────────
const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken:  mapboxToken.value,
  provider:     mapProvider,   // 'mapbox' (default) | 'maplibre'
  style:        profileConfig?.value?.style ?? mapTheme.bootStyle(),  // persisted-theme boot (shared)
  config:       mapTheme.bootConfig,   // pin lightPreset BEFORE the first frame (no day→night boot flash)
  center:       profileConfig?.value?.center  ?? mapDefaults.center ?? [20, 10],
  zoom:         profileConfig?.value?.zoom    ?? mapDefaults.zoom   ?? 1.8,
  pitch:        profileConfig?.value?.pitch   ?? mapDefaults.pitch  ?? 0,
  bearing:      profileConfig?.value?.bearing ?? mapDefaults.bearing?? 0,
  // Per-map zoom constraints (feedback #1 /pray): the research map defines its
  // own min/max in profile-config so users don't get lost zooming too far, and
  // precise locations stay obfuscated. Falls back to mapDefaults.
  minZoom:      profileConfig?.value?.minZoom ?? mapDefaults.minZoom ?? 0.5,
  // Zoom-in cap. PINNED to RESEARCH_MAX_ZOOM (18) per coder directive so the
  // camera CAN reach street level inside a dense cluster — letting overlapping
  // pins separate enough to be clicked between. Deliberately NOT overridable
  // from profile-config: an injected maxZoom (e.g. the page once passed 7)
  // would re-cap zoom-in and re-block declustering, which is the exact bug
  // this pin prevents. minZoom stays config-driven; only the IN cap is locked.
  maxZoom:      RESEARCH_MAX_ZOOM
})

// ─── Data composable ─────────────────────────────────────────────────────────
// Lean instantiation — no lookups, no detectLocale. The shared DSM handles
// {value,label} from pray-tools natively; raw codes fall through unchanged.
const dsm = new DataSourceManager({ sourcesConfig, locale: activeLocale, profileConfig })
const mapData = useMapData({
  mapId,
  dataSourceId:      dataSource.value,
  dataSourceManager: dsm,
  dataStore,
  markRaw:           (v) => v
})

// ─── Country search highlight — REUSE the WAGF Regions country feature ───────
// A country search result paints the `regions-fill`/`regions-border` polygon
// highlight the Regions tab uses (selected country at fill-opacity 0.30, dark
// border; all others dimmed). It ALSO draws the country boundary OUTLINE via
// useCountryOutline (country-boundaries-v1) — the regions-fill layer is hidden
// off the Regions tab, so the outline (tab-independent) is what makes the country
// polygon visible on every tab (card country-polygon-all-maps). No network fetch:
// useCountryOutline now reuses the same boundaries tileset, not geoBoundaries GeoJSON.
// Regions are lazy-loaded on this profile, so ensure the layer exists first,
// then force it visible (country search stays on the current tab — d7e741b — so
// the polygon layers, normally hidden off the Regions tab, must be shown here).
// ★ EVERY region paint write goes through this, or the pre-warm above is undone the first time a
// highlight is cleared. Found by cross-reading the country-posters port (73438b43b), which
// wraps all eighteen of its clears while mine still wrote nine RAW constants — a raw value makes the
// property constant again, so the next highlight recompiles the shader variant the pre-warm exists to
// have already compiled. Measurement showed 0 ms on a fresh tab; a reader who clears a selection first was
// paying it again, which no run so far has exercised.
// regionIdle now comes from the library (useLegendMapBridge), which already called it — this file
// was defining a copy and then passing it in. See check:region-paint-single-source.

async function highlightCountryByIso(iso3) {
  const code = String(iso3 || '').trim().toUpperCase()
  if (code.length !== 3) return
  await ensureRegionsLoaded()
  const m = map.value
  if (!m || !m.getLayer('regions-fill')) return
  m.setLayoutProperty('regions-fill',   'visibility', 'visible')
  m.setLayoutProperty('regions-border', 'visibility', 'visible')
  const isoArr = ['literal', [code]]
  m.setPaintProperty('regions-fill', 'fill-opacity', [
    'case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], 0.30, 0.02
  ])
  m.setPaintProperty('regions-border', 'line-color', [
    'case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], '#111827', 'rgba(60,60,80,0.15)'
  ])
  m.setPaintProperty('regions-border', 'line-width', [
    'case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], 2.5, 0.3
  ])
  // Pins must stay above the freshly-shown polygon.
  if (m.getLayer('language-family-pins')) m.moveLayer('language-family-pins')
}

// Reverse highlightCountryByIso: reset the regions polygon paint to default and
// re-hide it when we're not on the Regions tab (a country search may have shown
// it cross-tab). Used when the user picks a non-country result or clears search.
// ─── Layers composable ───────────────────────────────────────────────────────
const mapLayers = useMapLayers({
  getMap: () => map.value,
  mapId,
  // Color comes from the active tab's strategy (looked up at paint time)
  getLanguageFamilyColor: (langFam) => {
    const strat = getColorStrategy(activeTab.value?.colorStrategy)
    return strat?.colors?.[langFam] ?? strat?.fallback ?? '#7c8cf8'
  },
  getNormalizedPeopleGroups: () => mapData.normalizedPeopleGroups.value || []
})

// ─── Events composable (click → detail, hover → cursor) ──────────────────────
// Wired via useMapLayers internally, but we also keep an explicit handle for
// custom event hookups (e.g., poster-mode disables click handlers).
const mapEvents = useMapEvents({
  getMap: () => map.value,
  mapId,
  getLanguageFamilyColor: () => '#7c8cf8',
  getNormalizedPeopleGroups: () => mapData.normalizedPeopleGroups.value || []
})

// ─── Fly composable ──────────────────────────────────────────────────────────
const mapFly = useMapFly({
  getMap: () => map.value,
  mapId,
  mapStore,
  defaultCenter: profileConfig?.value?.center ?? [20, 10],
  defaultZoom:   profileConfig?.value?.zoom   ?? 1.8
})

// ─── Selected-pin composable (animated GO marker on selection) ───────────────
// Watches uiStore.selectedPeopleGroup; when set, swaps the dot to neon orange
// AND floats an animated GO pin above it. Highlight layer attaches itself to
// the `language-families` source created by useMapLayers, so initialize()
// must be called AFTER that source has been added (i.e. inside onMapReady).
// Pass the active-tab colour resolver IN as an option (not via provide/inject):
// useSelectedPin runs in THIS component, and a Vue 3 component cannot inject its own
// provide, so the provide('getActivePinColor', …) below could never reach it — the
// selected dot/marker fell back to black ('#1a1a1a'). Resolving it here makes the
// highlight follow the underlying dot colour on the very first boot click, with no
// tab switch required.
const selectedPin = useSelectedPin({
  getMap: () => map.value,
  getActivePinColor: (properties) => {
    const strat = getColorStrategy(activeTab.value?.colorStrategy ?? 'languageFamily')
    return strat?.getColor?.(properties) ?? '#1a1a1a'
  }
})

// ─── Clustering composable (lazy) ────────────────────────────────────────────
// Modes: 'mapbox' (native circle clustering) | 'mst' | 'network' | 'off'.
// Instantiated on first user toggle (mapStore.showClusters → true) — keeps the
// MST/Network algorithm bundle off the boot path for the common case where
// clustering stays off.
let _clusteringInstance = null
let _clusteringPromise = null
function getClustering() {
  if (_clusteringInstance) return Promise.resolve(_clusteringInstance)
  if (!_clusteringPromise) {
    _clusteringPromise = import('@map/composables/useMapClustering.js').then(m => {
      _clusteringInstance = m.useMapClustering({
        getMap: () => map.value,
        mapId,
        mapStore,
        getPeopleGroups: () => mapData.normalizedPeopleGroups.value || [],
        getClusterColor: () => getColorStrategy(activeTab.value?.colorStrategy)?.fallback ?? '#7c8cf8'
      })
      return _clusteringInstance
    })
  }
  return _clusteringPromise
}
// Lightweight stand-in so existing call-sites (refreshColors / applyFilters /
// setData / cleanup) work whether or not clustering has been instantiated.
const clustering = {
  setData(d)        { _clusteringInstance?.setData?.(d) },
  applyFilters(f)   { _clusteringInstance?.applyFilters?.(f) },
  refreshColors()   { _clusteringInstance?.refreshColors?.() },
  cleanup()         { _clusteringInstance?.cleanup?.() },
  async setEnabled(on) { (await getClustering()).setEnabled?.(on) },
  async setMode(m)     { (await getClustering()).setMode?.(m) },
  // Per-selection filter — keep a deferred copy so we can re-push to the
  // composable the moment it instantiates (e.g. when the user enables clusters
  // *after* clicking a legend row). Sync calls become no-ops cleanly.
  _pendingSelectionFilter: null,
  setSelectionFilter(filter) {
    this._pendingSelectionFilter = filter || null
    if (_clusteringInstance?.setSelectionFilter) {
      _clusteringInstance.setSelectionFilter(filter)
    }
  },
  flushSelectionFilter() {
    if (_clusteringInstance?.setSelectionFilter) {
      _clusteringInstance.setSelectionFilter(this._pendingSelectionFilter)
    }
  }
}

// ─── Legend data composable ──────────────────────────────────────────────────
// Builds legend rows from the loaded GeoJSON aggregated by the active tab's
// `legend` key. LegendDesktop / LegendMobile read these via inject('legendRows')
// (provided below).
const legend = useLegendData({
  mapId,
  dataStore,
  legendType: activeLegendType
})
// ★ REMOVED: provide('legendRows', legend.rows). useLegendData returns `items`, never `rows`, so
// this provided undefined from the day it was written, and nothing in the repo injects 'legendRows'
// — LegendDesktop and LegendMobile read the `legend` key instead, which is what the comment above
// used to claim was happening. the same line was found in countries-map, where it was not
// merely dead: it made Export poster throw (NE-17, their d6916e05e). A provide that is undefined and
// a comment that describes a contract nobody implements are worse together than either alone, so
// both go. If a consumer ever needs these rows, it should provide legend.items and say so then.
// SemanticTreeLegend (and LegendFamilyTree.legacy) need raw normalized
// people-groups, not pre-aggregated legendRows. mapData owns the normalized
// array; expose to descendants.
provide('normalizedPeopleGroups', mapData.normalizedPeopleGroups)

// Country boundary OUTLINE (country-boundaries-v1) painted on a country search
// pick. Unlike highlightCountryByIso (which uses regions-fill — only visible on
// the Regions tab), this tileset is available on EVERY tab, so the country
// outline shows regardless of the active tab (card country-polygon-all-maps).
const countryOutline = useCountryOutline(() => map.value)

// Per-map "instance" mediator store, ported word-for-word from PPLR's
// SemanticTreeLegend pattern. Each <doxa-map> custom element gets its own
// instance; SemanticTreeLegend reads/writes selection + activeTab + theme
// via inject.
const pplrInstance = createPplrInstance(mapId)
provideInstance(pplrInstance)

// ── legend ↔ map bridge (shared with country-posters) ────────────────────────
// The four handlers below were byte-identical in both 811-line twins. They now live in the library,
// so a fix reaches both maps instead of one — three defects had already landed in one twin and not
// the other before this existed. Everything is PASSED IN, so this call has to sit after
// countryOutline and pplrInstance: the declarations it replaces were hoisted and ran before either
// existed, which a composable call cannot do.
const _legendBridge = useLegendMapBridge({
  map, activeTab, countryOutline, regionIdle, mapFly, pplrInstance, mapId,
})
const clearCountryHighlight = _legendBridge.clearCountryHighlight
const _flatItemsToStlNodes = _legendBridge.flatItemsToStlNodes
const onLegendRowClick = _legendBridge.onLegendRowClick
const _bridgeSelection = _legendBridge.bridgeSelection

// ── Geocoder → map search (shared composable) ────────────────────────────────
// The kind-switch, the per-kind Mapbox filter-expression builder, the 6 byte-
// identical legend branches (family/language/dialect/affinity-bloc/cluster/
// people-group), the clear-guard and the rich "dim every other pin" people-group
// handler all live in @map/composables/useGeocoderSearch.js now. What stays here:
// the profile-specific divergent routers (country/region/religion camera + outline
// logic) passed via legendRouters, and clearAllHighlights (touches profile-only
// layers). clearGeocoderProgrammatic is returned for reuse by onSemanticTreeSelect
// / switchTab / applyDimFilter (declared below; routers are hoisted).
const {
  onPeopleGroupResult,
  onAggregateResult,
  onClear,
  clearGeocoderProgrammatic,
} = useGeocoderSearch({
  map, geocoderRef, clustering, mapStore, uiStore, mapLayers, pplrInstance,
  onSemanticTreeSelect, switchTab, activeTabId, clearAllHighlights,
  clearCountryHighlight, mapId,
  legendRouters: { country: routeCountry, region: routeRegion, religion: routeReligion },
})
// Default the SemanticTreeLegend internal tab per outer-tab (legend type):
//   • language-families → 1 (Language)  — users know "Language" better than "Language Family"
//   • affinity-blocks   → 0 (Bloc)      — users know affinity blocks better than clusters
// Reset on every outer-tab change so switching between Languages and Affinity
// Blocks lands on the right inner tab regardless of where the previous tab left it.
pplrInstance.activeTab.value = 1
function _defaultInnerTabForLegendType(t) {
  if (t === 'affinity-block') return 0   // Bloc
  if (t === 'language-family') return 1   // Language
  return 0
}
watch(activeLegendType, (t) => {
  pplrInstance.activeTab.value = _defaultInnerTabForLegendType(t)
})

// ── langTree + tabs + select handler for SemanticTreeLegend ─────────────────
// PPLR's component is mounted as a standalone sibling of the map (its own
// .stl-panel chrome handles positioning, collapse-to-pill, theme). We feed it
// the langTree directly here instead of routing through LegendDesktop.
const _langPgRef = { get value() { return mapData.normalizedPeopleGroups.value || [] } }
const { langTree } = useLanguageFamilyLegendData(_langPgRef)
// ★ THE TAB TEXT LIVES IN THE CATALOGUE, NOT HERE. SemanticTreeLegend renders these through
// tabLabel()/tabInfo(), which read `tabs.<id>` and `legend.tabInfo.<id>` behind a te() guard. The
// labels resolved in all eleven locales, but not one legend.tabInfo key existed — so every
// non-English reader got a translated tab chip beside an English explanation of what that chip
// means, which is the one sentence a reader who does not read English cannot do without. The keys
// are now written, so the English explanations are gone from here rather than kept as fallbacks
// that can never fire: a second copy of a string drifts from the catalogue silently.
//
// `info: true` still marks WHICH tabs carry an explanation — the legend gates the little "i" button
// on that flag, so dropping the field outright would remove the affordance instead of translating it.
const LANG_TABS = [
  { id: 'family',   info: true },
  { id: 'language', info: true },
  { id: 'dialect',  info: true },
]

// Affinity-block tab — mirrors PPLR's pplr-rop-tree.vue hierarchy (Affinity Block → Cluster → PG).
const { affinityTree } = useAffinityBlockLegendData(_langPgRef)
// The source fields behind each tier, kept here because the reader-facing text in the catalogue
// deliberately drops them: bloc = rop1 (16 blocks); cluster = imb_reg_of_people_2, ROP 2 (194);
// group = imb_reg_of_people_25, ROP 2.5 (1,736 PGs, 131 of them in more than one country);
// pgic = imb_reg_of_people_3 + country_code (2,106 rows). Row suffixes "(Cluster)"/"(PG)"/"(PGIC)"
// come from the legend data, not from these labels.
const AFFINITY_TABS = [
  { id: 'bloc',    info: true },
  { id: 'cluster', info: true },
  { id: 'group',   info: true },
  { id: 'pgic',    info: true },
]

// WAGF Regions tab — Region → Block → Country (3-tier). Each region has a unique color;
// selecting a region, block, or country dims/filters pins to that geographic scope and
// highlights the matching country polygons on the map.
const { regionsTree } = useWagfRegionsLegendData(_langPgRef)
const REGIONS_TABS = [
  { id: 'region',  info: true },
  { id: 'block',   info: true },
  { id: 'country', info: true },
]

// Flat legend data for prayer/adoption/engagement/religion tabs — converted to
// STL-compatible tree nodes so ALL tabs render through the same SemanticTreeLegend.
const flatLegend = useFlatLegendData(toRef(() => activeLegendType.value), RESEARCH_LEGEND_OPTIONS)
// Prayer progress bar (header of the Prayer tab's legend; added 2026-09-16). null on
// every other tab → no bar. Passed as a prop to the desktop STL AND provide()d so the
// MOBILE sheet's embedded <SemanticTreeLegend> (LegendMobile.vue, untouched) picks it
// up via inject('legendProgress'). STL also retitles itself "Progress" when present.
const legendProgress = flatLegend.progress
provide('legendProgress', legendProgress)
// Computed bindings the template feeds into the single <SemanticTreeLegend>.
// ALL tabs (flat + semantic) now render through STL.
const _isFlatTab = computed(() => ['prayer', 'engagement', 'adoption', 'religion'].includes(activeLegendType.value))
const legendNodes = computed(() => {
  if (_isFlatTab.value) return _flatItemsToStlNodes(flatLegend.items.value)
  if (activeLegendType.value === 'affinity-block') return affinityTree.value
  if (activeLegendType.value === 'doxa-regions')   return regionsTree.value
  return langTree.value
})
const legendInnerTabs = computed(() => {
  if (_isFlatTab.value) return null
  if (activeLegendType.value === 'affinity-block') return AFFINITY_TABS
  if (activeLegendType.value === 'doxa-regions')   return REGIONS_TABS
  return LANG_TABS
})
const legendHideTabs = computed(() => _isFlatTab.value)
const legendColumnLabel = computed(() => {
  if (activeLegendType.value === 'religion') return t('legend.colLabel.religion')
  if (activeLegendType.value === 'prayer') return t('legend.colLabel.prayer')
  if (activeLegendType.value === 'engagement') return t('legend.colLabel.engagement')
  if (activeLegendType.value === 'adoption') return t('legend.colLabel.adoption')
  if (_isFlatTab.value) return t('legend.colLabel.status')
  return ''
})
const _stlOpen = computed(() => uiStore.legendState !== 'collapsed')
function _onStlOpenChange(open) {
  if (open) uiStore.openLegend()
  else uiStore.collapseLegend()
}
const legendTitle = computed(() => {
  if (_isFlatTab.value) return t('legend.titleBar.legend')
  if (activeLegendType.value === 'affinity-block') return t('legend.titleBar.peopleGroups')
  if (activeLegendType.value === 'doxa-regions')   return t('legend.titleBar.wagfRegions')
  return t('legend.titleBar.languages')
})
// PPLR's onLegendSelect verbatim semantics: setFilter(node.filter) on select,
// setFilter(null) on null. Plus mirror to mapStore for back-compat with the
// rest of the app (geocoder, popup, fly-to all read mapStore.selected*).
// Provided to LegendMobile so its embedded <SemanticTreeLegend> can wire
// @select to the same handler as the desktop instance — without this,
// mobile row-clicks updated only instance.selection (shared via inject)
// and never reached mapStore.selectFamily → applyDimFilter, so the
// dim-on-select / restore-on-deselect path never ran.
provide('onSemanticTreeSelect', (node) => onSemanticTreeSelect(node))
// Resolves the active tab's strategy → color for a given feature, used by
// useSelectedPin.js so the selection-pin matches the underlying dot color
// research-mfe tab strategyKeys already
// match COLOR_MODES values directly, so no mapping needed.
provide('getActivePinColor', (properties) => {
  const strat = getColorStrategy(activeTab.value?.colorStrategy ?? 'languageFamily')
  return strat?.getColor?.(properties) ?? '#1a1a1a'
})
// — flat-tab nodes carry a placeholder ['==', ['get','_flat_filter'], key]
// filter that never matches real features, so we synthesize the real match
// expression for the camera here. Tree-tab nodes carry usable Mapbox filters
// already (fam:/lang:/dial: + region:/block:/country: + bloc:/cluster:/pg:/pgic:),
// so this returns null for them and zoomToLegendRow falls back to node.filter.
// ─── ONE WRITER FOR THE REGION POLYGONS ──────────────────────────────────────
// ★ MEASURED (main 373b7979b): a single WAGF row click produced NINE regions-* paint writes —
// fill-opacity, line-color and line-width, three times each inside ~110 ms — because two paths painted
// the same highlight from DIFFERENT sources: onSemanticTreeSelect from node.isoCodes, applyDimFilter
// from mapLayers.regionIsoMap, each triggering the other through mapStore. Two sources for one visual
// is not just wasted work; it is how they drift, and it already cost a debugging cycle when we had to
// establish WHICH of them had cleared the highlight.
//
// ★ AND THE IDLE STATE IS DATA-DRIVEN ON PURPOSE. Measurement showed the row click compiling a new shader
// variant: 5.5 s on MapLibre, 11.1 s on Mapbox (SwiftShader), because that click was the first moment
// these three properties stopped being constants. Same defect as the pins, same fix: the idle value is
// ['case', ['has', 'iso_3166_1_alpha_3'], x, x] — both branches identical, so not one pixel changes —
// and the variant therefore compiles when the layer is ADDED rather than mid-gesture.
//
// The compare is asked of the MAP, not of a remembered key, so a layer torn down and re-added cannot
// leave a skip holding a paint that is no longer there.
const REGION_IDLE_FILL  = ['case', ['has', 'iso_3166_1_alpha_3'], 0.7, 0.7]
const REGION_IDLE_COLOR = ['case', ['has', 'iso_3166_1_alpha_3'], 'rgba(60,60,80,0.35)', 'rgba(60,60,80,0.35)']
const REGION_IDLE_WIDTH = ['case', ['has', 'iso_3166_1_alpha_3'], 0.6, 0.6]
// Make the region paints data-driven WITHOUT changing what they show: each property is read back and
// re-written wrapped in a case whose two branches are the value it already had. A property the layer
// does not define is skipped rather than invented, and one already wrapped is left alone.
function prewarmRegionPaint(m) {
  if (!m || !m.getLayer('regions-fill')) return
  // Was a THIRD local copy of the idle expression, under a different name — byte-identical body.
  // The library's regionIdle replaces it exactly.
  const wrap = regionIdle
  // ★ SKIP WHAT IS ALREADY DATA-DRIVEN, and note the test is not "is it an array". The country-posters port wrote
  // their copy to skip any array, reasoning that an expression is already data-driven so there is no
  // variant to warm. That is right for this layer — line-color arrives as a match on a feature property
  // — but it is right by accident: a ZOOM expression like ['interpolate',['linear'],['zoom'],…] is also
  // an array and is NOT data-driven, so skipping it would leave that property to compile its variant on
  // the first gesture and produce exactly the partial pre-warm this is trying to avoid.
  // The property that matters is whether the expression reads the FEATURE. Wrapping one that already
  // does is pointless anyway — it would rewrite a region-coloured match into a case around it, which is
  // what my first version did.
  const readsFeature = (e) => Array.isArray(e)
    && (e[0] === 'get' || e[0] === 'has' || e[0] === 'feature-state' || e.some(readsFeature))
  // ★ AND A ZOOM EXPRESSION MUST NOT BE WRAPPED, WHICH IS THE OPPOSITE OF WHAT THE NOTE ABOVE ARGUED.
  // I reasoned that a zoom interpolate is an array but not data-driven, so skipping it would leave a
  // variant to compile on the first gesture — true, and beside the point, because the wrap is not legal.
  // useMapLayers.js:319 already carries the rule, written for the pin ring: zoom interpolation is kept
  // by putting the 'case' in the interpolate OUTPUTS; "the reverse (zoom nested inside a 'case') is what
  // breaks the layer, so don't do that." ['case', cond, ['interpolate',['linear'],['zoom'],…], …] is
  // exactly that reverse. Mapbox then classifies the property as composite and reaches for an
  // interpolation factor the expression cannot supply — the class of
  //   this.expression.interpolationFactor is not a function
  // a run saw it once on Mapbox at L54, on the clear → other-row path. A missed pre-warm costs a frame; an
  // illegal paint costs the layer, so when the two rules disagree this one wins.
  //
  // the country-posters port skips ANY array and is immune to this by accident; the difference between us
  // was never about zoom expressions being data-driven, it was about which mistake is recoverable.
  const readsZoom = (e) => Array.isArray(e) && (e[0] === 'zoom' || e.some(readsZoom))
  const warm = (layer, prop) => {
    if (!m.getLayer(layer)) return
    const cur = m.getPaintProperty(layer, prop)
    if (cur === undefined || cur === null) return
    if (readsFeature(cur) || readsZoom(cur)) return
    m.setPaintProperty(layer, prop, wrap(cur))
  }
  try {
    warm('regions-fill', 'fill-opacity')
    warm('regions-border', 'line-color')
    warm('regions-border', 'line-width')
  } catch (_) { /* style still loading - the first real paint carries it */ }
}

function paintRegionScope(m, isoCodes) {
  if (!m || !m.getLayer('regions-fill')) return
  // ★ CANONICAL FIRST, OR THE COMPARE BELOW IS A LIE (measured at L43: still 9 writes per click, not 3).
  // The two sources build the same region from different lists — node.isoCodes and
  // mapLayers.regionIsoMap[slug] — and they do not agree on ORDER. The measurement had already shown that in
  // the very first stack trace ("a case over ['IND',…]" then "a case over ['MYS',…], a different
  // literal order") and I wrote a JSON-string compare anyway, which can never match two orderings of
  // the same set. Sorting and de-duplicating makes the expression a function of the SET, which is what
  // the two callers actually agree on.
  //
  // It is also a test: if the write count does not drop to 3, the two sources disagree about WHICH
  // countries are in the region, which is a data defect this compare would otherwise have hidden.
  const list = Array.isArray(isoCodes)
    ? [...new Set(isoCodes.filter(Boolean).map((c) => String(c).toUpperCase()))].sort()
    : []
  const isoArr = ['literal', list]
  const fill  = list.length ? ['case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], 0.85, 0.15] : REGION_IDLE_FILL
  const color = list.length ? ['case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], '#111827', 'rgba(60,60,80,0.15)'] : REGION_IDLE_COLOR
  const width = list.length ? ['case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], 2.5, 0.3] : REGION_IDLE_WIDTH
  const put = (layer, prop, value) => {
    if (!m.getLayer(layer)) return
    if (JSON.stringify(m.getPaintProperty(layer, prop)) === JSON.stringify(value)) return
    m.setPaintProperty(layer, prop, value)
  }
  try {
    put('regions-fill', 'fill-opacity', fill)
    put('regions-border', 'line-color', color)
    put('regions-border', 'line-width', width)
  } catch (_) { /* style still loading — the next paint carries it */ }
}
function onSemanticTreeSelect(node) {
  const m = map.value
  // — uniform legend-row camera: any non-null row click moves
  // the camera to fit its scope, derived from live pin coords. Flat-tab nodes
  // need the real match expression synthesized (their node.filter is a
  // _flat_filter placeholder); tree-tab nodes use node.filter directly.
  if (node) {
    const flatExpr = _isFlatTab.value
      ? buildFlatLegendMatchExpr(node, activeLegendType.value)
      : null
    // doxa-regions tab → fit polygon (sparse regions like Oceania should
    // zoom TO the region, not OUT to span its few scattered pins).
    const isRegionsTab = activeTab.value?.id === 'doxa-regions'
    const flyOpts = flatExpr ? { matchExpr: flatExpr } : {}
    if (isRegionsTab) flyOpts.regionPolygonSource = 'regions'
    mapFly.zoomToLegendRow?.(node, Object.keys(flyOpts).length ? flyOpts : undefined)
  }
  if (!node) {
    // Flat tabs: clear filter directly
    if (_isFlatTab.value) {
      const t = activeLegendType.value
      if (t === 'prayer')     uiStore.setPrayerFilter(null)
      else if (t === 'engagement') uiStore.setEngagementFilter(null)
      else if (t === 'adoption')   uiStore.setAdoptionFilter(null)
      else if (t === 'religion')   uiStore.setReligionFilter(null)
    }
    if (m && m.getLayer('language-family-pins')) {
      try { m.setFilter('language-family-pins', null) } catch (_) {}
      _syncHitboxFilter(m, null)
      applyPinOpacity(m, null)
      mapLayers.syncGlowFilter(null)
    }
    // Reset region polygon highlight when deselecting on the WAGF Regions tab.
    if (m && m.getLayer('regions-fill')) {
      m.setPaintProperty('regions-fill', 'fill-opacity', regionIdle(0.7))
      m.setPaintProperty('regions-border', 'line-color', regionIdle('rgba(60,60,80,0.35)'))
      m.setPaintProperty('regions-border', 'line-width', regionIdle(0.6))
    }
    if (mapStore.selectedFamily)   mapStore.selectFamily(null)
    if (mapStore.selectedLanguage) mapStore.selectLanguage(null)
    if (mapStore.selectedDialect)  mapStore.selectDialect?.(null)
    if (mapStore.selectedRegion)   mapStore.selectRegion?.(null)
    clearGeocoderProgrammatic()
    return
  }
  // Flat tabs (prayer/adoption/engagement/religion): directly set the uiStore
  // filter (no toggle — STL already handles select/deselect internally).
  // The existing watchers on uiStore.*Filter call applyDimFilter to dim pins.
  if (_isFlatTab.value) {
    const t = activeLegendType.value
    if (t === 'prayer')     uiStore.setPrayerFilter(node.id)
    else if (t === 'engagement') uiStore.setEngagementFilter(node.id)
    else if (t === 'adoption')   uiStore.setAdoptionFilter(node.id)
    else if (t === 'religion')   uiStore.setReligionFilter(node.id)
    return
  }
  if (m && m.getLayer('language-family-pins') && node.filter) {
    try { m.setFilter('language-family-pins', node.filter) } catch (_) {}
    _syncHitboxFilter(m, node.filter)
    applyPinOpacity(m, null)
    mapLayers.syncGlowFilter(node.filter)
  }
  // Mirror selection into mapStore (loop-safe via legend's _lastInternalId).
  const id = String(node.id || '')
  if (id.startsWith('fam:'))      mapStore.selectFamily?.(node.label)
  else if (id.startsWith('lang:')) mapStore.selectLanguage?.(node.label)
  else if (id.startsWith('dial:')) {
    mapStore.selectDialect?.({ key: id.slice(5), originalLabels: node.originalLabels || [] })
  }
  // Affinity-block tab — apply deep dim (0.06) on non-matching pins, parity
  // with research-map's applyDimFilter for language-family. The SemanticTree-
  // Legend's pplrInstance.selection drives the legend row highlight; the dim
  // here drives the map visual. node.filter is the per-tier Mapbox match
  // expression built by useAffinityBlockLegendData.
  else if (id.startsWith('bloc:') || id.startsWith('cluster:') || id.startsWith('pg:') || id.startsWith('pgic:')) {
    if (m && m.getLayer('language-family-pins') && node.filter) {
      // Drop any prior setFilter from a previous tab interaction so all pins render.
      try { m.setFilter('language-family-pins', null) } catch (_) {}
      // Mirror the match expression onto the invisible hitbox layer so
      // dimmed (opacity-0) pins are not selectable. Without this the
      // hitbox stays full-size for every pin and the user can tap an
      // apparent empty area to select a hidden pin.
      _syncHitboxFilter(m, node.filter)
      // Dim via the one writer: matched pins at the slider's scale, others at 0.
      applyPinOpacity(m, node.filter)
      mapLayers.syncGlowFilter(node.filter)
    }
  }
  // WAGF Regions tab — filter pins to the selected region/block/country and highlight
  // matching country polygons. node.filter is one of:
  //   region:  ['==', ['get', 'doxaRegion'], regionSlug]
  //   block:   ['==', ['get', 'wagfBlock'],  blockSlug]
  //   country: ['==', ['get', 'countryIso'], isoAlpha3]
  // node.isoCodes carries alpha-3 ISOs; polygon highlight uses iso_3166_1_alpha_3 property.
  else if (id.startsWith('region:') || id.startsWith('block:') || id.startsWith('country:')) {
    if (m && m.getLayer('language-family-pins') && node.filter) {
      try { m.setFilter('language-family-pins', node.filter) } catch (_) {}
      _syncHitboxFilter(m, node.filter)
      applyPinOpacity(m, null)
    }
    // Mirror region selection into mapStore (for geocoder / external sync).
    if (id.startsWith('region:')) mapStore.selectRegion?.(id.slice(7))
    // Highlight matching polygons using isoCodes (alpha-3) on iso_3166_1_alpha_3.
    // ★ ONE SOURCE, NOT JUST ONE WRITER. A region: click has TWO painters — this line, from
    // node.isoCodes, and the canonical path it triggers one line above (selectRegion -> the store
    // watcher -> applyDimFilter, which paints from mapLayers.regionIsoMap). Canonicalising the list
    // made them comparable; it could not make them EQUAL, because the two sets are different by
    // construction:
    //   · node.isoCodes comes from useWagfRegionsLegendData, which builds its regions by walking the
    //     PEOPLE-GROUP LIST — so it holds only countries that have pins.
    //   · regionIsoMap comes from regionsData.isoToRegion — every country assigned to the region.
    // So a region highlight painted from the legend has HOLES wherever a country has no unreached
    // group in the current list, and which version you saw depended on which writer ran last.
    // The dataset is the right answer for "highlight the countries belonging to this region", so
    // region: rows defer to it and stop painting here.
    //
    // block: and country: rows keep painting from node.isoCodes, because nothing else paints them —
    // only region: reaches selectRegion above — and for those two the legend's own list IS the scope.
    if (!id.startsWith('region:')) paintRegionScope(m, node.isoCodes || [])
  }
}
// Theme bridge: keep the SemanticTreeLegend in sync with the app's dark-mode
// state (driven by uiStore.theme via the isDark computed defined later).
watch(() => uiStore.theme, (t) => { pplrInstance.theme.value = (t === 'dark' ? 'dark' : 'light') }, { immediate: true })

// ── Selection bridge: mapStore → pplrInstance.selection ──────────────────────
// Geocoder picks (and any other external mutators) write to mapStore. The
// SemanticTreeLegend reads instance.selection to highlight + auto-expand the
// matching row. This watcher projects mapStore changes onto the instance using
// id strings that match the langTree node ids (fam:X / lang:X__Y / dial:X__Y__Z).
// findAncestorChain inside the legend uses these ids to resolve actual nodes
// in props.nodes; the bridge only needs to pass id+label+depth — not the full
// node object.
//
// Loop guard: when the legend itself emits @select, LegendDesktop dispatches
// legend:highlight → research-map.applyDimFilter → mapStore.selectXxx (no-op
// if already set). The bridge watcher then fires with the same selection,
// but the SemanticTreeLegend's _lastInternalId guard catches the round-trip.
watch(() => mapStore.selectedFamily, (key) => {
  if (!key) return _bridgeSelection('fam', null)
  const node = findNodeInTree(langTree.value, n => n.id.startsWith('fam:') && n.label === key)
  if (node) _bridgeSelection('fam', { ...node, depth: 0 })
})
watch(() => mapStore.selectedLanguage, (key) => {
  if (!key) return _bridgeSelection('lang', null)
  // Match by label across all language nodes — the geocoder gives us "Arabic"
  // without a family prefix, so we look up the first matching language node
  // (sorted by population, so the most-populated family wins; usually correct).
  const node = findNodeInTree(langTree.value, n => n.id.startsWith('lang:') && n.label === key)
  if (node) _bridgeSelection('lang', { ...node, depth: 1 })
})
watch(() => mapStore.selectedDialect, (dialect) => {
  if (!dialect?.key) return _bridgeSelection('dial', null)
  // Dialect mapStore keys already include the family prefix
  // ("family__baseLang__dialect"); langTree dialect ids prepend "dial:".
  const fullId = `dial:${dialect.key}`
  const node = findNodeInTree(langTree.value, n => n.id === fullId)
  if (node) _bridgeSelection('dial', { ...node, depth: 2 })
})
// WAGF Regions — bridge mapStore.selectedRegion → SemanticTreeLegend.
// regionKey is the wagf_region VALUE (e.g. 'south_asia'), which matches the
// 'region:south_asia' node id in regionsTree.
watch(() => mapStore.selectedRegion, (key) => {
  if (!key) return _bridgeSelection('region', null)
  const node = findNodeInTree(regionsTree.value, n => n.id === `region:${key}`)
  if (node) _bridgeSelection('region', { ...node, depth: 0 })
})

// ─── Poster composable (lazy) ────────────────────────────────────────────────
// Instantiated only when the user opens the poster dialog. The composable +
// off-screen Mapbox instance + PDF pipeline are ~117 KB; keep them off the
// critical boot path.
// ★ ONE CLICK, ONE FILE (BUILD-SIMPLE-RESEARCH-EXPORT-ZERO-CLICK). The report: "there's an export
// button on the simple dashboard ... get it working". Measured 2026-09-25, leaf AND gallery: clicking
// "Export poster…" produced NOTHING — no dialog, no file in 60s, no error. Two bugs stacked: the
// template passed the poster dialog a `poster` prop it does not have and omitted its v-model and
// required getMap, so it mounted invisible; and the old loader called useMapPoster({ sourceMap, … })
// with an OBJECT where the shared composable takes a FUNCTION, so a render would have thrown anyway.
// Now the button does the export itself, through the SHARED poster path (useMapPoster → render →
// print), with a sensible print default: the current view on US Letter portrait at 200 DPI, the
// legend title and rows, and a source/date footer. One click, one dialog, the poster in the preview.
// The legend rows a poster prints, from the ONE composable that actually has them.
//
// ★ useLegendData RETURNS `items`, NOT `rows`. Both poster paths below read `legend.rows.value`,
// which is undefined, so `|| []` silently handed the renderer an empty list — and useMapPoster skips
// the legend slot entirely when there are no rows. That is why the exported poster had no legend:
// not a layout problem but an empty array, arriving through a fallback that could never be anything
// else. The booklet path had no second source at all, so ITS legend was empty unconditionally.
//
// Children are flattened in because a prayer legend is a parent plus two child tiers, and a printed
// legend that shows only the parents describes bands the map does not draw.
function posterLegendRows(preferFlat) {
  const flat = preferFlat ? (flatLegend.items.value || []) : []
  const src = flat.length ? flat : (legend?.items?.value || [])
  return src
    .flatMap((it) => [it, ...(it.children || [])])
    .map((r) => ({ label: r.label, color: r.color }))
    .filter((r) => r.label)
}

const posterBusy = ref(false)
// The loading screen (MapPrintProgress): the title it names and the renderer's progress while it works.
const printTitle = ref('')
const printProgress = ref(null)
async function openPoster() {
  if (posterBusy.value) return
  posterBusy.value = true
  try {
    const [{ useMapPoster }, { mapPrintSpec, packetScriptureLine }, { printImageBlob }, { loadPacketStrings }] = await Promise.all([
      import('@map/composables/poster/useMapPoster.js'),
      import('@map/composables/poster/mapPrintTemplate.js'),
      import('@map/composables/printInPlace.js'),
      import('@map/packet/packetStrings.js'),
    ])
    const exporter = useMapPoster(() => map.value)
    // The loading screen follows the renderer's own progress for as long as this print runs.
    stopPrintWatch = watch(() => exporter.progress.value, (p) => { printProgress.value = p ? { ...p } : null }, { immediate: true, deep: true })
    // ★ THE SHARED MAP-PRINT TEMPLATE (mapPrintTemplate.js): landscape Letter, a header with the MAP's name and
    // the view as its subtitle, the legend as a side panel, and a footer line from the prayer packet's final page.
    // The map's name comes from the host (profile-config mapTitle, e.g. the gallery's tab label); without one the
    // view on screen ("Prayer", "Religion"…) is the title, as before.
    const view = tabLabel(activeTab.value) || legendTitle.value || 'Doxa Map'
    const mapTitle = String(profileConfig?.value?.mapTitle || '').trim()
    const title = mapTitle || view
    printTitle.value = title
    // Direction follows the MAP's language, not the host page's: an English map on an Arabic page stays LTR.
    const lang = String(uiLocale.value || 'en').split('-')[0]
    const dir = ['ar', 'fa', 'he', 'ur'].includes(lang) ? 'rtl' : 'ltr'
    // loadPacketStrings never rejects (a copy it cannot use gives the English table), but its fetch has no timeout:
    // a stalled network must not hold the export, so after 3 s the sheet prints without the prayer line.
    const strings = await Promise.race([loadPacketStrings(resolveAssetsBase(profileConfig?.value)), new Promise((r) => setTimeout(() => r(null), 3000))])
    const scripture = packetScriptureLine(strings, lang)
    // Credit the tiles actually drawn: OpenFreeMap on MapLibre, Mapbox otherwise (C3: ask the library).
    const onMaplibre = providerFor(map.value) === 'maplibre'
    const date = new Date().toISOString().slice(0, 10)
    const spec = mapPrintSpec({
      title, subtitle: mapTitle ? view : '', dir,
      legendRows: posterLegendRows(true), legendTitle: legendTitle.value,
      footerLeft: scripture || 'pray.doxa.life', footerRight: scripture ? `pray.doxa.life · ${date}` : date,
      attribution: onMaplibre ? '© OpenFreeMap © OpenMapTiles © OpenStreetMap' : '© Mapbox © OpenStreetMap',
    })
    const blob = await exporter.render(spec, 'png')
    // ★ THE DIALOG, NOT A DOWNLOAD (ruled 2026-09-28: an export-poster button must open the
    // print dialog with a poster preview, never hand over a file). This used to call _downloadBlob,
    // so the reader got a PNG in their downloads folder with no preview, no paper size and no way to
    // print it without opening it somewhere else first. printImageBlob puts the rendered poster on a
    // sheet of exactly the spec's size and raises the dialog over the map — the preview IS the poster.
    // The same in-place frame the earlier ruling settled on: no pop-up, no blocker, and it
    // works when an agent triggers it without a user gesture.
    const printed = printImageBlob(blob, {
      labels: { print: T('wall.hud.printNow', 'Print'), close: T('buttons.close', 'Close') },
      widthIn: spec.widthIn ?? 8.5,
      heightIn: spec.heightIn ?? 11,
      title,
      alt: title,
    })
    // An unopenable frame (sandboxed or detached host) is reported, not silently swallowed: a button
    // that looks like it worked and did nothing is the defect this whole path has already had once.
    if (!printed) console.error('[research-map] poster print: the host blocked the print frame')
  } catch (err) {
    console.error('[research-map] poster export failed:', err)
  } finally {
    if (stopPrintWatch) { stopPrintWatch(); stopPrintWatch = null }
    printProgress.value = null
    posterBusy.value = false
  }
}
let stopPrintWatch = null
// The toolbar's export label, WITH its ellipsis. The ellipsis was stripped while this button handed
// over a file directly; it now opens the print dialog, which is exactly what an ellipsis promises.
const exportPosterLabel = computed(() => String(t('controls.export_poster') || 'Export poster…'))

// ─── Export menu router (SemanticTreeLegend @export) ─────────────────────────
// EXPERIMENTAL — dormant behind the shared kill-switch (SHOW_EXPORT_BUTTON).
// ★ THE KIND CARRIES A VARIANT: 'poster' | 'packet:full' | 'packet:lightweight'. The legend widened
// its existing event rather than adding a second one, and this router still tested the whole string
// for 'packet' — so both submenu items fell through every branch and the Packet export did nothing
// at all. Split the variant off first, exactly as upg-100-list's onLegendExport does. A bare
// 'packet' keeps working and still means the full packet, so an older emitter does not break.
function onExport(kind) {
  const [base, variant] = String(kind).split(':')
  if (base === 'poster') return openPoster()
  if (base === 'packet') return openPacket(variant || 'full')
}
// ★ THE PHONE HAD NO EXPORT AT ALL, AND THE KILL-SWITCH ONLY COVERED THE DESKTOP.
// LegendDesktop takes :export-enabled="EXPORT_FEATURE_ENABLED", so turning that flag off hid the
// desktop menu — but LegendMobile is OPT-IN BY CONSTRUCTION: its exportEnabled is
// `typeof inject('onLegendExport') === 'function'` (LegendMobile.vue:393), and this profile provided
// nothing. So a reader on a phone had no way to export a poster or a packet, while the same map on a
// desktop did. country-posters already carries the guarded line; this is the missing half here.
// Providing it UNGUARDED would be the other error — the phone would then keep an affordance the
// desktop deliberately hides whenever the flag is off, which is the bug exp's card names.
provide('onLegendExport', EXPORT_FEATURE_ENABLED ? onExport : null)

// ★ THE PHONE HAD NO EXPORT AT ALL. The desktop legend gets :export-enabled and @export in the
// template, but LegendMobile does not read props from here — it reaches for an injected handler, and
// decides whether to offer the control at all by whether one exists: mobileExportEnabled is
// `typeof onLegendExport === 'function'` (LegendMobile.vue:412-413). Nothing provided it here, so a
// reader on a phone saw no poster and no packet, while the same map on a desktop offered both. Not a
// leak — an absence, which is why it never showed up as a broken control.
//
// ⚠ IT MUST CARRY EXPORT_FEATURE_ENABLED, not just the function. The desktop passes that flag, so
// providing unconditionally would hand the phone an affordance the desktop deliberately hides when
// the flag is off. Passing null when it is off is what makes the mobile sheet hide the control,
// because "is there a handler" IS the mobile switch. Same shape as countries-map.vue, which fixed
// this first (its comment records the same two causes on my-upg-100-list).
provide('onLegendExport', EXPORT_FEATURE_ENABLED ? onExport : null)

// ─── Packet export (printed, multi-page: map + a card per people group) ──────
// Lazy-loaded on first use, the same pattern openPoster() uses. Defensive throughout: never throw
// uncaught into the UI; guard against double-run.
// ★ A REF, NOT A PLAIN LET, AND THAT IS THE WHOLE DEFECT. This guarded re-entrancy correctly and could
// not tell the reader anything, because a non-reactive binding drives no UI. Its sibling openPoster()
// has had `posterBusy` as a ref wired to :active/:disabled/:aria-busy since it was written — so the
// FASTER action showed a busy state and the SLOWER one (dynamic imports, a map render, then a card per
// people group) showed none. One path was given feedback and its sibling was never looked at; upg100
// found the identical shape on their own surface the same day.
// Widened by me today: providing onLegendExport gave the legend's Export menu a mobile entry point,
// so there is now a second way into this path.
const packetBusy = ref(false)
// The legend's Export menu reaches BOTH builds, so it reports either one. Provided rather than passed
// because the mobile sheet's legend is mounted by LegendMobile, not by this template.
const exportBusy = computed(() => posterBusy.value || packetBusy.value)
provide('legendExportBusy', exportBusy)
// Neither export hands over a file any more: the poster prints through printImageBlob and the packet
// through the shared usePosterPrints.printPacket, so the download helper that served packet.pdf is gone.
async function openPacket(variant = 'full') {
  if (packetBusy.value) return
  packetBusy.value = true
  try {
    // ★ THE PACKET PRINTS, AND IT PRINTS THROUGH THE SHARED RENDERER (audit card 2, and
    // the standing rule: an export button opens the print dialog, never hands over a file). This
    // built a jsPDF document and downloaded packet.pdf while its poster sibling, two functions up,
    // already printed. The fix is NOT to wrap that PDF in a dialog — a PDF blob cannot go in the
    // <img> the in-place print frame uses, and every workaround (embed, object, the browser's own
    // viewer) prints on some engines and silently does nothing on others, which is the dead-button
    // class this file has already paid for twice.
    //
    // library/composables/usePosterPrints.js ALREADY has printPacket: the same pages, authored as HTML
    // with @page rules, printed in place. This map was running a private second implementation of a
    // shared product feature. Routing to it deletes the duplicate, and the packet gains the pages the
    // shared renderer has that the local one never did (the life calendar, the funnel, the prayer
    // wheel — see packet-render.buildPacket's page order).
    //
    // ⚠ THIS USED TO CLAIM IT DROPPED JSPDF FROM THE BUNDLE. It does not, and I checked the built
    // artifact only after saying so: jspdf arrives through useMapPoster.toPdf, which this map still
    // uses for the poster, so it was never this path's to remove. The bundle in fact GREW about 131 KB
    // (983,264 -> 1,117,687 on L42) because the shared HTML renderer is inlined — each bundle is a
    // single .js with no code splitting, so the dynamic imports above are build-time inlined, not lazy.
    // Correct on the record here because the wrong sentence was copied verbatim into country-posters.
    const [{ usePosterPrints }, { defaultPosterSpec }, { useMapPoster }, { selectedPinIds }] = await Promise.all([
      import('@map/composables/usePosterPrints.js'),
      import('@map/constants/posterDefaults.js'),
      import('@map/composables/poster/useMapPoster.js'),
      import('@map/maps/pin-selection.js'),
    ])

    // ★ THE PACKET PRINTS WHAT THE READER IS LOOKING AT (PACKETSEL). It printed the first 50 of every
    // people group whatever was selected — a reader who had narrowed the map to one language family
    // got a packet about somebody else. The rows now come from the pins currently SELECTED: the
    // layer's own filter says which pins render, `_pinMatchExpr` says which of those are lit (the
    // affinity tab dims rather than filters), and a pin at opacity 0 is not what the reader sees.
    //
    // Asked of the MAP's features, not of the rows, and that distinction is the whole reason this
    // lives in library/maps/pin-selection.js: pin properties are DERIVED from rows — useMapLayers
    // fills languageFamily in when the API returns null and canonicalizes doxaRegion onto the
    // palette's key forms — so evaluating a pin filter against a raw row is wrong in a way that never
    // throws. The features the map holds are where the two vocabularies agree.
    const all = mapData.normalizedPeopleGroups.value || []
    const active = [map.value?.getFilter?.('language-family-pins') || null, _pinMatchExpr].filter(Boolean)
    let groups = all
    if (active.length) {
      const ids = selectedPinIds(map.value, { expressions: active })
      const picked = all.filter((g) => ids.has(String(g.uniqueId ?? g.id ?? '')))
      // A selection that matches no ROW is an id mismatch, not an empty selection — print the whole
      // list rather than silently shipping a packet about nothing, and say so.
      if (picked.length) groups = picked
      else console.warn(`[research-map] packet: ${ids.size} pin(s) selected but no rows matched; printing the full list`)
    }
    // The cap is an overnight safety limit, not a design choice — so when it bites, the packet says so
    // on its cover rather than quietly being a different packet than the reader asked for.
    const selectedTotal = groups.length
    if (groups.length > 50) {
      console.warn(`[research-map] packet truncated ${groups.length} → 50 people groups`)
      groups = groups.slice(0, 50)
    }

    // ★ AN EXPLICIT ADAPTER, because the two halves name the same fields differently and a mismatch
    // here is SILENT — the packet would print with blank names and empty photos rather than failing.
    // The renderer reads slug / name / population / religion / country_code, and usePosterPrints reads
    // image_url; this map's normalized rows carry country and imageUrl in camelCase. Mapped once, here,
    // where the difference is visible, rather than renaming either side's vocabulary.
    const records = groups.map((g) => ({
      slug: String(g.slug || g.uniqueId || g.id || ''),
      name: g.name,
      population: g.population,
      // ★ THE DISPLAY NAME, NOT THE CODE, and the order is the whole point. The card prints these two
      // straight into the page — flat(g.religion) and flat(g.country_code) — so they are read by a
      // person, not matched by a machine. DataSourceManager normalizes `religion` to the CODE and puts
      // the readable form in `religionName` (it does the same for country: countryIso is the code,
      // countryName the label). Reading religion first would have printed MSN under a people group's
      // name, and the field name country_code invites exactly that mistake on the country line.
      // Checked against the normalizer rather than guessed: library/api/DataSourceManager.js:357-358.
      religion: g.religionName || g.religionLabel || g.religion || '',
      country_code: g.countryName || g.countryIsoLabel || g.country || g.countryIso || '',
      image_url: g.imageUrl || g.image_url || '',
    }))

    // Page 1 keeps the LIVE map rather than a fetched poster: this half is the one that knows what is
    // currently on screen. It goes over through the print standard's `mapImage` seam, which PLACES IT
    // AS THE WHOLE PAGE. It used to be handed across as a bare <img> in `mapSvg`, raw markup the
    // renderer interpolated — and the page-1 redesign no longer draws that full page, so the live map
    // arrived shrunk inside a layout built for a sheet. A data URL rather than an object URL, because
    // the print frame is a separate document and an object URL created here would be revoked out from
    // under it. The render is skipped for a deck, which has no map page — this map's legend menu only
    // ever asks for 'full' or 'lightweight', so that arm is a guard against a future caller rather
    // than a path taken today.
    const spec = defaultPosterSpec({ widthIn: 8.27, heightIn: 11.69, dpi: 150, orientation: 'portrait' })
    spec.slots.title = { ...spec.slots.title, text: legendTitle.value || 'Doxa Map' }
    spec.slots.legend = { ...spec.slots.legend, rows: posterLegendRows(true), title: legendTitle.value }
    let mapUrl = ''
    if (variant !== 'cards') try {
      const mapBlob = await useMapPoster(() => map.value).render(spec, 'png')
      mapUrl = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = reject
        r.readAsDataURL(mapBlob)
      })
    } catch (e) {
      // A cover without the map beats no packet — the same call the shared composable documents.
      console.warn('[research-map] packet map page skipped:', e?.message || e)
    }

    const baseLabel = legendTitle.value || tabLabel(activeTab.value) || 'Doxa Map'
    const zone = {
      id: String(activeTab.value?.id || 'research-map'),
      // ★ NO ENGLISH WORD ON A LOCALIZED COVER. I wrote "50 of 214" today and it renders that "of" in
      // all eleven locales — my own leak, on the cover of a document whose whole point is that a reader
      // in their language can pray from it. The slash needs no translation, and it is not a guess: zh's
      // professional translation of legend.progress.short renders exactly this relationship as
      // "{covered} / {total}". The word IS available per locale there (ar "من", ru "из", fr "sur"), but that
      // key carries "· {pct}%" with it, so reusing it would mean either a wrong suffix or slicing a
      // translated string on a separator that may not survive translation.
      // Wrapped in U+2066/U+2069 isolates, the convention the ar catalogue already uses for numeric
      // ranges (five times, e.g. "⁦30–59%⁩"): without them the pair reorders against Arabic text
      // beside it and reads as "214 / 50". NUMERALS ARE HELD, so the digits stay as they are.
      label: selectedTotal > groups.length ? `${baseLabel} — ⁦${groups.length} / ${selectedTotal}⁩` : baseLabel,
      zoneKey: String(activeTab.value?.id || 'research-map'),
    }
    const prints = usePosterPrints({
      records: () => records,
      lang: () => String(uiLocale.value || 'en').split('-')[0],
      label: () => zone.label,
      mapImage: () => mapUrl || null,
    })
    await prints.printPacket(zone, { variant })
  } catch (err) {
    console.error('[research-map] packet export failed:', err)
  } finally {
    packetBusy.value = false
  }
}

// ─── Side-menu / dialog state ────────────────────────────────────────────────
const showSideMenu   = ref(false)
const selectedFeature = computed(() => mapStore.selectedFeature)

// ─── Theme toggle (clone of doxa-simple-map.vue:368-395) ─────────────────────
// `isDark` is derived from uiStore.theme so it stays in sync with the canonical
// store action. handleToggleTheme flips uiStore.theme + swaps the Mapbox style
// + re-adds the language-family pins layer because setStyle() wipes custom
// layers. The toolbar toggle button calls handleToggleTheme via @toggle.
// ── TWO SEPARATE "is it dark?" QUESTIONS — do not conflate them ──────────────
// `isDark` = is the UI CHROME dark? Derived from the store GETTER so it honours
// the THEME_TOGGLE flag (flag off => chrome is LIGHT even if a previous session
// persisted theme:'dark'). Reading uiStore.theme raw here was a bug.
const isDark = computed(() => uiStore.isDarkTheme)

// `isDarkBasemap` = is the BASEMAP dark? With THEME_TOGGLE off the basemap is
// PINNED to night/default (see useMapTheme.FIXED_BASEMAP), so it is dark even
// though the chrome is light. Anything drawn ON the map (pin rings, glows,
// outlines) must follow THIS, not the chrome — otherwise pins get their
// light-basemap treatment (thin hairline + dark ring on no-prayer pins) while
// sitting on a dark map, which reads as dim/washed-out.
// REGRESSION THIS FIXES (2026-07-29): the yellow prayer dots lost their
// bright white outer ring and stopped looking like emitted light.
const isDarkBasemap = computed(() =>
  THEME_TOGGLE ? uiStore.isDarkTheme : FIXED_BASEMAP.lightPreset === 'night')

// Theme-aware data-pin outline. Joshua Project
// uses a thin near-black outline that's barely visible; reverse-engineered.
// In dark mode the outline goes white so pins stay visible against dark
// basemaps. Boot style is light-v11, so the initial circle-stroke-color
// in addLanguageFamilyLayer is already 'rgba(0,0,0,0.45)' — this watcher
// just flips it on theme toggle.
function _updatePinStroke() {
  const m = map.value
  if (!m || !m.getLayer('language-family-pins')) return
  // Theme-aware subtle ring (coder): DARK mode → subtle WHITE ring on ALL pins (no dark
  // line in dark). LIGHT mode → has-prayer pins white, need-prayer (red) pins a subtle DARK
  // ring (#1f2937) for contrast on the white basemap.
  // NOTE: follows the BASEMAP, not the chrome (see isDarkBasemap) — the pins sit
  // ON the map, so a dark basemap needs the white ring even when the UI is light.
  const stroke = isDarkBasemap.value
    ? '#ffffff'
    : ['case', ['>', ['to-number', ['get', 'peoplePraying'], 0], 0], '#ffffff', '#1f2937']
  m.setPaintProperty('language-family-pins', 'circle-stroke-color', stroke)
  // Thicken the white ring in DARK mode so intentionally-black pins (unmapped langs,
  // Sign Language, Deaf, Unknown) stay visible on the night basemap; keep the light
  // hairline. buildDarkRingWidth applies the colour-strategy's exceptions (e.g. prayer
  // RED no-prayer pins stay thin). Colours unchanged — width only.
  m.setPaintProperty('language-family-pins', 'circle-stroke-width',
    isDarkBasemap.value ? buildDarkRingWidth(activeTab.value?.colorStrategy) : PIN_STROKE_WIDTH_LIGHT)
}
watch(isDarkBasemap, _updatePinStroke, { immediate: false })
watch(() => activeTab.value?.id, _updatePinStroke)
// SEAMLESS theme: the basemap lightPreset follows uiStore.theme reactively (single source of
// truth). NO setStyle reload → pins/glow/regions are never wiped, no flash, works on every tab.
watch(() => uiStore.theme, () => mapTheme.applyTheme(map.value))
function handleToggleTheme() {
  // Seamless: flip the theme + re-light the Standard basemap (day↔night) via setConfigProperty.
  // No setStyle reload, so nothing is torn down or re-added — the toggle is instant.
  mapTheme.swapTheme(map.value)
}

// ─── Lazy regions-layer loader ───────────────────────────────────────────────
// PERF: doxa-regions-with-geo.json is ~6.4 MB decoded. Loading + parsing it
// eagerly in onMapReady was adding ~3-4s to the boot of every tab — even when
// the user never visits the Doxa Regions tab. We now lazy-load on first
// activation and cache the result.
const _regionsLoaded = ref(false)
let _regionsLoadingPromise = null
async function ensureRegionsLoaded() {
  if (_regionsLoaded.value) return
  if (_regionsLoadingPromise) return _regionsLoadingPromise
  _regionsLoadingPromise = (async () => {
    try {
      const regionsData = await mapData.loadRegionsData?.()
      if (regionsData && map.value) {
        mapLayers.addRegionsLayer?.(regionsData, 'doxa-regions')
        // ★ PRE-WARM HERE, which is the only moment that helps. These layers are added on first visit
        // to the Regions tab, and measurement showed the first ROW click paying 5.5 s (MapLibre) / 11.1 s
        // (Mapbox) of shader compile because that click was when their paint first became data-driven.
        // Making the paint data-driven at layer-add moves that compile here, where a 6.4 MB GeoJSON is
        // already loading, instead of into the middle of a gesture.
        //
        // WARNING IT WRAPS WHAT THE LAYER ALREADY PAINTS, and does NOT paint the cleared state. The
        // first version called paintRegionScope(map.value, []) — the CLEARED look, flat grey borders at
        // width 0.6. addRegionsLayer does not start there: it sets line-color to the region-coloured
        // match expression and line-width 1 (useMapLayers). So pre-warming with the cleared values
        // silently repainted every border grey and thinner the moment the layer appeared — a visible
        // change nobody asked for, and invisible to both things being measured at the time, a timing
        // check and a write count.
        // Reading each property back and re-writing it wrapped in an identical-branch case keeps the
        // appearance exactly as the layer defined it while still making the property data-driven, which
        // is all the shader variant depends on.
        prewarmRegionPaint(map.value)
        // Hide regions on non-Doxa-Regions tabs so they don't show through.
        if (map.value.getLayer('regions-fill') && activeTab.value?.id !== 'doxa-regions') {
          map.value.setLayoutProperty('regions-fill',   'visibility', 'none')
          map.value.setLayoutProperty('regions-border', 'visibility', 'none')
        }
        // Pins must render above the freshly-added regions polygon.
        if (map.value.getLayer('language-family-pins')) {
          map.value.moveLayer('language-family-pins')
        }
      }
      _regionsLoaded.value = true
      // PERF: Mapbox now owns the geometry as a GeoJSON source; drop our JS
      // reference so the ~30 MB of parsed objects can be garbage-collected.
      mapData.regionsData.value = null
    } catch (err) {
      console.warn('[research-map] regions layer failed:', err)
    } finally {
      _regionsLoadingPromise = null
    }
  })()
  return _regionsLoadingPromise
}

// ─── Tab switching ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  if (tabId === activeTabId.value) return
  activeTabId.value = tabId
  uiStore.setActiveTab?.(tabId)
  // Clear the geocoder text on every map-tab switch so the previous tab's
  // search query doesn't leak across tabs (qa-buildinng-round-1 Bug 11).
  // clearGeocoderProgrammatic uses its internal _geoBeingCleared to skip the legend-
  // deselect side effect — pure text reset. Flip the FEATURES flag to keep
  // search queries across tabs (either behaviour is acceptable; clear-on-switch
  // stays the default per A4).
  if (!FEATURES.geocoderPersistAcrossTabs) clearGeocoderProgrammatic()
  const tab = tabs.value.find(t => t.id === tabId)
  if (!tab || !map.value) return
  // The basemap look follows the tab (prayer → night, others → day); config prop only, no reload.
  mapTheme.setLook(mapTheme.lookFor(tab.colorStrategy), map.value)
  // Lazy-load regions GeoJSON the first time the user lands on this tab.
  if (tab.id === 'doxa-regions') void ensureRegionsLoaded()

  const strat = getColorStrategy(tab.colorStrategy)
  if (map.value.getLayer('language-family-pins') && strat?.buildColorExpression) {
    // On the Doxa Regions tab, the pins would otherwise be colored using the
    // doxaRegion strategy — same color as the polygon they sit on, so they
    // visually disappear. Force blood-red instead so pins pop against the
    // colored region fills (per UX request 2026-04-26).
    const pinColor = tab.id === 'doxa-regions' ? '#a30000' : strat.buildColorExpression()
    map.value.setPaintProperty('language-family-pins', 'circle-color', pinColor)
    clearAllHighlights(map.value)
    // Prayer glow: start on prayer tab, stop on all others
    if (tab.id === 'prayer') mapLayers.startPrayerGlow()
    else mapLayers.stopPrayerGlow()
    // Region polygons only belong on the Doxa Regions tab. On every other tab,
    // hide the fill + border outright so they don't bleed through and so the
    // pins remain the visual focus (UX request 2026-04-26).
    const showRegions = tab.id === 'doxa-regions'
    if (map.value.getLayer('regions-fill')) {
      map.value.setLayoutProperty('regions-fill',   'visibility', showRegions ? 'visible' : 'none')
      map.value.setLayoutProperty('regions-border', 'visibility', showRegions ? 'visible' : 'none')
    }
    // Reaffirm pin z-index: pins must always render above the regions polygon.
    // Mapbox `moveLayer(id)` without a beforeId moves it to the top of the stack.
    if (map.value.getLayer('language-family-pins')) {
      map.value.moveLayer('language-family-pins')
    }
  }
  // Nothing to re-aggregate by hand: useLegendData exposes `items` as a COMPUTED, so the legend
  // re-derives from the new lens on its own. This used to call legend.refresh?.(), which the
  // composable has never defined — the optional call made a no-op look like a step.
  // Re-color clusters (cluster paint depends on active strategy)
  clustering.refreshColors?.()
}

// ─── Legend → fly-to wiring ──────────────────────────────────────────────────
// LegendRows emits a window event when a row is clicked; we fly the map there.
// LegendFamilyTree emits 'legend:highlight' with { kind, pinIds, coords[], familyKey, languageKey }.
// Compute bounds from coords[] and fit the map. Fall back to flyTo on the
// centroid when there's only a handful of points (so a single-pin family
// doesn't zoom into the moon).
function onLegendHighlight(evt) {
  const detail = evt?.detail
  if (!detail) return

  // Dim non-matching pins for visual distinction.
  // - kind=family   → keep only pins whose languageFamily matches; dim the rest
  // - kind=language → keep only pins whose primary_language label matches; dim the rest
  // - kind=region   → keep only pins whose doxaRegion matches; dim the rest
  // Click again on the same row to clear (handled by family/language store below).
  applyDimFilter(detail)

  if (!detail.coords?.length) return
  const coords = detail.coords
  if (coords.length === 1) {
    mapFly.flyToCoords?.({ longitude: coords[0][0], latitude: coords[0][1] }, 3)
    return
  }
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  // Cap zoom-in. Region rows = continent framing; family/language rows = sub-continent.
  const maxZoom = detail.kind === 'region' ? 2.2 : 3
  mapFly.fitBounds?.([[minLng, minLat], [maxLng, maxLat]], 60, { maxZoom })
}

// ─── ONE WRITER FOR PIN OPACITY ──────────────────────────────────────────────
// ★ THE SLIDER AND THE LEGEND DIMMING DO NOT COMPETE, THEY COMPOSE.
// Two features want this one paint property: the side menu's dim slider (fade the individual pins
// while clustering is on, so the clusters read) and legend dimming (hide everything that is not the
// selected row). Written as two owners they would overwrite each other — the slider would erase
// dimming, or dimming would erase the slider, depending on click order. So there is exactly one
// writer and the value is the PRODUCT: opacity = slider × (1 for a matched pin, 0 for a dimmed one).
// The slider scales the whole layer; dimming still dims relative to it; neither silently wins.
//
// The slider was inert before this (mapStore never declared clusterPinOpacity, so dragging it
// changed a number nobody read) — the same defect as the clustering picker beside it, and found
// while fixing that one.
let _pinMatchExpr = null            // the current dim expression, or null for "show everything"
function pinBaseAlpha() {
  // The slider only applies while clustering is actually drawing — it is hidden in the side menu
  // when clustering is off, and applying it then would dim a map with nothing to dim FOR.
  const on = mapStore?.showClusters && (mapStore?.clusteringMode || 'off') !== 'off'
  const a = Number(mapStore?.clusterPinOpacity)
  return on && Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1
}
// matchExpr: an expression to dim by, null to clear dimming, undefined to re-apply what is current
// (which is what the slider's watcher needs — it changes the scale, not the selection).
// ★ THE UNDIMMED VALUE IS DATA-DRIVEN TOO, AND THAT IS THE WHOLE POINT (reported bug: "the research map
// isn't connecting with the legend"; a CPU profile). A legend click on a big affinity
// row appeared to do nothing for ~2 s. It was not the echo guard, not the legend's DOM (34 rows before,
// 34 after) and not expression evaluation (the JS filter scan over 2,106 features against a 700-id list
// measures 14 ms). It was ONE task of 3.2-3.5 s whose self time was getShaderParameter + getProgram-
// Parameter: the GPU compiling a NEW SHADER VARIANT, because this was the first moment circle-opacity
// stopped being a constant and became a per-feature expression. The second click was cheap — the
// program was cached — which is exactly the signature of a one-time compile.
//
// So the fix is not to make the expression smaller; it is to stop the FIRST SELECTION being the moment
// the variant is needed. With no selection the value is now ['case', ['has','uniqueId'], a, a] — both
// branches identical, so not one pixel changes, but circle-opacity is data-driven from the first paint
// and the program compiles during boot alongside every other one. A selection then only re-uploads
// attribute values, which is the cheap path.
//
// The trade, stated: boot compiles one more program (tens of ms on a real GPU; measurement showed seconds
// only because that box rasterises on the CPU via SwiftShader). Paying it at load beats freezing the
// map mid-gesture, and the variant was going to be compiled on first interaction anyway.
function applyPinOpacity(m, matchExpr) {
  if (matchExpr !== undefined) _pinMatchExpr = matchExpr || null
  if (!m || !m.getLayer?.('language-family-pins')) return
  const a = pinBaseAlpha()
  // ['has','uniqueId'] reads a feature property, which is what makes it data-driven; both outcomes are
  // `a`, so a pin without the property renders exactly as before.
  const value = _pinMatchExpr ? ['case', _pinMatchExpr, a, 0] : ['case', ['has', 'uniqueId'], a, a]
  // ★ ONE WRITE PER DISTINCT VALUE. Measurement counted circle-opacity rewritten 4-8 times for a single click
  // (+1.52, +1.57, +1.94, +5.17 s): the selection handler, the glow sync and the slider watcher all end
  // up here, and each write re-uploads the per-feature attribute. Every writer already routes through
  // this function, so the collapse belongs here and nowhere else. Compared as text because the value is
  // an expression tree; at a few hundred ids that is microseconds against a re-upload.
  try {
    // Asked of the MAP, not of a remembered key. A remembered one would go stale the moment the layer
    // is torn down and re-added (setStyle wipes custom layers — this file has done that before) and the
    // skip would then hold a dim that is no longer painted. Reading the live value cannot be stale, and
    // if an engine normalises the expression differently the compare simply misses and we write, which
    // is the old behaviour rather than a wrong one.
    if (JSON.stringify(m.getPaintProperty('language-family-pins', 'circle-opacity')) === JSON.stringify(value)) return
    m.setPaintProperty('language-family-pins', 'circle-opacity', value)
    m.setPaintProperty('language-family-pins', 'circle-stroke-opacity', value)
    if (m.getLayer('language-family-pins-shadow')) {
      m.setPaintProperty('language-family-pins-shadow', 'circle-opacity', value)
    }
  } catch (_) { /* style still loading — the next apply will carry it */ }
}
watch(() => [mapStore?.clusterPinOpacity, mapStore?.clusteringMode, mapStore?.showClusters],
  () => applyPinOpacity(map.value))

// Last-clicked highlight key per kind — clicking the same row again clears.
const _lastHL = { family: null, language: null, dialect: null, region: null, prayer: null, engagement: null, adoption: null }

function clearAllHighlights(m) {
  applyPinOpacity(m, null)
  m.setFilter('language-family-pins', null)
  _syncHitboxFilter(m, null)
  mapLayers.syncGlowFilter(null)
  // Through the one writer, so "cleared" and "idle" are the same expression rather than two spellings
  // of it — and so the idle state stays DATA-DRIVEN and the shader variant stays compiled.
  paintRegionScope(m, [])
  if (m.getLayer('regions-fill')) m.setPaintProperty('regions-fill', 'fill-outline-color', null)
  _lastHL.family = _lastHL.language = _lastHL.dialect = _lastHL.region = null
  _lastHL.prayer = _lastHL.engagement = _lastHL.adoption = null
  if (uiStore.prayerFilter)     uiStore.setPrayerFilter(null)
  if (uiStore.engagementFilter) uiStore.setEngagementFilter(null)
  if (uiStore.adoptionFilter)   uiStore.setAdoptionFilter(null)
  if (uiStore.religionFilter)   uiStore.setReligionFilter(null)
  // Highlights gone — clustering goes back to the full dataset on next pass.
  clustering.setSelectionFilter(null)
  // Clear mapStore legend selections so LegendFamilyTree removes the selected
  // row indicator + row dimming (QA R2 A1 / R4 A3).
  if (mapStore.selectedFamily)   mapStore.selectFamily(null)
  if (mapStore.selectedLanguage) mapStore.selectLanguage(null)
  if (mapStore.selectedDialect)  mapStore.selectDialect(null)
  // Flat-tab rows (prayer/engagement/adoption/religion) and tree rows are
  // tracked separately on pplrInstance.selection — clearing the uiStore
  // filters above does NOT cascade into pplrInstance, so without this the
  // legend row stays visually selected while the map filter clears, leaving
  // the UI inconsistent. Reset the legend-row selection directly so a clear
  // anywhere (toggle-off, empty-map tap, programmatic) leaves both the map
  // and the legend in matching states.
  try {
    if (pplrInstance && pplrInstance.selection && pplrInstance.selection.value) {
      pplrInstance.selection.value = null
    }
  } catch (_) { /* no-op */ }
}

// Same-tick dedupe — a single legend-row click fires applyDimFilter TWICE on
// tabs 1-3 (once from the uiStore.{prayer,engagement,adoption}Filter watcher,
// once from the legend:highlight window event dispatched by LegendDesktop).
// Without this guard the second call sees `_lastHL[kind] === expectedValue`
// and trips the "same row → clear" toggle path, so the user has to click twice
// to dim. Tracking the last (kind|value, timestamp) within ~80 ms collapses
// the duplicate calls so a single click dims on the first try (qa.md UX bug
// 2026-04-27).
let _lastApplyKey = null
let _lastApplyTs  = 0
function applyDimFilter(detail) {
  const m = map.value
  if (!m || !m.getLayer('language-family-pins')) return
  let property, expectedValue, kind
  if (detail.kind === 'family') {
    kind = 'family'; property = 'languageFamily'; expectedValue = detail.familyKey
  } else if (detail.kind === 'language') {
    kind = 'language'; property = 'language'; expectedValue = detail.languageKey
  } else if (detail.kind === 'region') {
    kind = 'region'; property = 'doxaRegion'; expectedValue = detail.regionKey
  } else if (detail.kind === 'prayer') {
    kind = 'prayer'; property = detail.property || 'peoplePraying'; expectedValue = detail.expectedValue
  } else if (detail.kind === 'engagement') {
    kind = 'engagement'; property = detail.property || 'engagementStatus'; expectedValue = detail.expectedValue
  } else if (detail.kind === 'adoption') {
    kind = 'adoption'; property = detail.property || 'adoptionStatus'; expectedValue = detail.expectedValue
  } else if (detail.kind === 'religion') {
    kind = 'religion'; property = detail.property || 'religion'; expectedValue = detail.expectedValue
  } else if (detail.kind === 'dialect') {
    kind = 'dialect'; property = 'language'; expectedValue = detail.dialectKey || ''
  } else {
    clearAllHighlights(m)
    clearGeocoderProgrammatic()
    for (const k of Object.keys(_lastHL)) _lastHL[k] = null
    _lastApplyKey = null; _lastApplyTs = 0
    return
  }
  // Same-tick dedupe: collapse the watcher + event-handler double-fire.
  const now = Date.now()
  const callKey = `${kind}|${expectedValue}`
  if (_lastApplyKey === callKey && (now - _lastApplyTs) < 80) {
    return
  }
  _lastApplyKey = callKey
  _lastApplyTs = now

  // Toggle: same row clicked AGAIN (after the dedupe window) → clear highlight.
  if (_lastHL[kind] === expectedValue) {
    clearAllHighlights(m)
    clearGeocoderProgrammatic()
    _lastApplyKey = null; _lastApplyTs = 0
    return
  }
  for (const k of Object.keys(_lastHL)) _lastHL[k] = null
  _lastHL[kind] = expectedValue

  // Mirror the selection into mapStore so the legend can paint a "selected"
  // class on the matching row. `_lastHL` is local to this profile; the legend
  // reads `mapStore.selectedFamily / selectedRegion / selectedLanguage` to
  // know which row to highlight visually (qa.md row-selection-indicator).
  if (kind === 'family')   mapStore.selectFamily?.(expectedValue)
  else if (kind === 'region') mapStore.selectRegion?.(expectedValue)
  else if (kind === 'language') mapStore.selectLanguage?.(expectedValue)
  else if (kind === 'dialect') mapStore.selectDialect?.({ key: expectedValue, originalLabels: detail.originalLabels || [] })

  // Constrain MST/network clustering to just the selected slice so the
  // graph doesn't re-build across the full 2,069-pin dataset on every click.
  // `property` is already the correct pin field for each kind.
  clustering.setSelectionFilter({ property, value: expectedValue })

  if (kind === 'region') {
    // Doxa Regions tab: don't dim pins. Instead, FILTER the pin source so only
    // pins inside the selected region render (Mapbox `setFilter`). Pins stay
    // fully opaque + on top of polygons. This matches the API-style "fetch
    // only pins within that region" UX request (2026-04-26).
    m.setFilter('language-family-pins', ['==', ['get', 'doxaRegion'], expectedValue])
    _syncHitboxFilter(m, ['==', ['get', 'doxaRegion'], expectedValue])
    applyPinOpacity(m, null)
    if (m.getLayer('regions-fill')) {
      // Build a match expression on iso_3166_1_alpha_3 (vector tile property) to
      // highlight only the countries belonging to the selected WAGF region.
      // regionIsoMap keys are slugs ('asia'); expectedValue is also a slug, so the
      // direct lookup hits. The normalized fallback stays for defensive matching.
      const rMap = mapLayers.regionIsoMap?.value || {}
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '')
      const ev = norm(expectedValue)
      let isoCodes = rMap[expectedValue] || []
      if (!isoCodes.length) {
        for (const [k, v] of Object.entries(rMap)) {
          if (norm(k) === ev) { isoCodes = v; break }
        }
      }
      paintRegionScope(m, isoCodes)
    }
  } else {
    // Family / language / prayer / engagement / adoption: keep all pins
    // rendered on the visible pins layer (no source-filter so the bucket
    // can still be styled / sorted), but dim the non-matching ones via a
    // circle-opacity `case` expression.
    m.setFilter('language-family-pins', null)

    // Build the per-kind match expression. Prayer compares against a numeric
    // bucket (noPrayer=0 / hasPrayer=(0,FULL_PRAYER_THRESHOLD) / fullPrayer
    // >=THRESHOLD); engagement/adoption compare against a boolean.
    let matchExpr
    if (kind === 'prayer') {
      const valueExpr = ['to-number', ['get', property]]
      if (expectedValue === 'noPrayer') {
        matchExpr = ['==', valueExpr, 0]
      } else if (expectedValue === 'fullPrayer') {
        matchExpr = ['>=', valueExpr, FULL_PRAYER_THRESHOLD]
      } else if (expectedValue === 'hasPrayer') {
        matchExpr = ['all',
          ['>',  valueExpr, 0],
          ['<',  valueExpr, FULL_PRAYER_THRESHOLD]
        ]
      } else {
        matchExpr = ['==', ['get', property], expectedValue]
      }
    } else if (kind === 'engagement') {
      // engagementStatus is a boolean on the feature (see useMapLayers.js).
      // 'hasEngagement' → true, 'notEngaged' → false.
      const want = expectedValue === 'hasEngagement'
      matchExpr = ['==', ['get', property], want]
    } else if (kind === 'adoption') {
      const want = expectedValue === 'hasAdoption'
      matchExpr = ['==', ['get', property], want]
    } else if (kind === 'religion') {
      // expectedValue is a family letter (C/M/H/B/E/J/S/N/O/U). Match against
      // the first character of the religion code on each pin.
      matchExpr = ['==',
        ['slice', ['coalesce', ['get', property], ''], 0, 1],
        expectedValue
      ]
    } else if (detail.filterExpr) {
      // The new SemanticTreeLegend ships pre-built Mapbox filter expressions
      // on each tree node. When a legend click fires legend:highlight, the
      // adapter forwards detail.filterExpr verbatim — no rebuild needed.
      matchExpr = detail.filterExpr
    } else if (kind === 'language') {
      // Two grouping patterns:
      //   comma-inverted: "Arabic" matches "Arabic" exact OR "Arabic, Shihhi" (prefix "Arabic,")
      //   suffix-grouped: "Sign Language" matches "Pakistan Sign Language" (contains " Sign Language")
      matchExpr = ['any',
        ['==', ['get', property], expectedValue],
        ['==', ['slice', ['get', property], 0, expectedValue.length + 1], expectedValue + ','],
        ['in', ' ' + expectedValue, ['get', property]]
      ]
    } else if (kind === 'dialect') {
      // Exact match against the original API label(s) stored on the dialect row.
      // originalLabels e.g. ["Arabic, Sudanese"] or ["Pakistan Sign Language"].
      const labels = detail.originalLabels || []
      if (labels.length === 1) {
        matchExpr = ['==', ['get', property], labels[0]]
      } else if (labels.length > 1) {
        matchExpr = ['in', ['get', property], ['literal', labels]]
      } else {
        // Fallback: shouldn't happen, but guard against empty labels array.
        matchExpr = ['==', ['get', property], expectedValue]
      }
    } else {
      // family
      matchExpr = ['==', ['get', property], expectedValue]
    }

    applyPinOpacity(m, matchExpr)
    // Restrict the invisible hitbox layer to the matched bucket so dimmed
    // (opacity-0) pins are no longer hit-testable. Without this the user
    // can tap on apparent empty space and select a hidden pin, and the
    // generic map-click handler sees a queryRenderedFeatures hit on the
    // hidden pin and skips its own clear path inconsistently.
    _syncHitboxFilter(m, matchExpr)
    mapLayers.syncGlowFilter(matchExpr)
    if (m.getLayer('regions-fill')) {
      m.setPaintProperty('regions-fill', 'fill-opacity', regionIdle(0.20))
      m.setPaintProperty('regions-border', 'line-color', regionIdle('rgba(60,60,80,0.35)'))
      m.setPaintProperty('regions-border', 'line-width', regionIdle(0.6))
    }
  }
}

// ─── Profile-specific legend routers (geocoder aggregate tail) ───────────────
// The shared geocoder logic (kind-switch, filter builder, the 6 byte-identical
// legend branches, clear-guard, rich PG handler, clear body) lives in
// useGeocoderSearch() — wired above. These three routers are the genuinely
// DIVERGENT branches (country/region/religion) that reach into profile-only
// camera/outline/region-tree state; they are passed in via legendRouters and the
// composable invokes them, then runs clearGeocoderProgrammatic() + the legend
// reveal itself. ctx carries { map, filterLayerId, clearGeocoder,
// emitLegendReveal, property, value }.

// Religion search → route through onSemanticTreeSelect, the SAME handler a legend
// row-click uses (it sets religionFilter AND moves the camera via the robust
// zoomToLegendRow). Sub-types ("Animism") roll up to the family letter (the
// legend row's id). Mirrors the affinity-bloc branch in the composable.
function routeReligion(evt, { map: m, filterLayerId }) {
  const value = evt.label
  try { m.setFilter(filterLayerId, null) } catch (_) {}
  const famLetter = Object.keys(RELIGION_FAMILIES).find(k => RELIGION_FAMILIES[k] === value)
  if (famLetter) {
    const node = { id: famLetter, label: value, depth: 0 }
    const applyReligionSel = () => {
      try { m.setFilter(filterLayerId, null) } catch (_) {}
      onSemanticTreeSelect(node)
      if (pplrInstance && pplrInstance.selection) pplrInstance.selection.value = node
    }
    if (activeTabId.value !== 'religion') switchTab('religion')
    // ALWAYS defer to nextTick (even when already on the religion tab) so our
    // robust zoomToLegendRow fires AFTER the geocoder's synchronous default flyTo
    // and wins the race — otherwise the geocoder's bbox fit would snap first and
    // not be overridden. This is what makes the region/affinity search paths smooth.
    nextTick(applyReligionSel)
  }
}

// WAGF Region/Block search → select the matching legend row (region OR block tier
// — "South Asia" is a WAGF Block, a depth-1 node) and dim the region polygons,
// mirroring a legend row click. Find the REAL regionsTree node so
// onSemanticTreeSelect (region:/block: branch) gets its node.filter + node.isoCodes
// (member-country alpha-3) for the polygon dim. The geocoder does NOT carry a
// region code, so match the tree node by its label.
function routeRegion(evt, { map: m, filterLayerId }) {
  const value = evt.label
  const _rnorm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
  // regionsTree labels carry a tier suffix — "Asia (Region)", "South East Asia
  // (Bloc)" (useWagfRegionsLegendData lines 189/201) — that the geocoder label
  // does NOT have. Strip it before normalizing or the match always fails.
  const _stripTier = (s) => String(s || '').replace(/\s*\((?:Region|Bloc)\)\s*$/i, '')
  const wantLabel = _rnorm(value)
  const applyRegionSel = () => {
    // Drop the harsh pin setFilter applied earlier — we want dim, not hide.
    try { m.setFilter(filterLayerId, null) } catch (_) {}
    const node = findNodeInTree(regionsTree.value, n =>
      (n.id.startsWith('region:') || n.id.startsWith('block:')) && _rnorm(_stripTier(n.label)) === wantLabel)
    if (node) {
      onSemanticTreeSelect(node)
      if (pplrInstance && pplrInstance.selection) pplrInstance.selection.value = node
    }
  }
  if (activeTabId.value !== 'doxa-regions') {
    switchTab('doxa-regions')
    Promise.resolve(ensureRegionsLoaded()).finally(() => nextTick(applyRegionSel))
  } else {
    applyRegionSel()
  }
}

// Country geography pick → STAY on the current tab. A search pick must NEVER
// auto-swap the active tab (2026-06-22 coder report: a country pick used to yank
// the user onto the WAGF Regions tab). The pin/cluster filter on `countryName`
// was already applied by the composable, so the active tab's data is now scoped to
// this country; all that's left is to zoom the camera + highlight the country.
function routeCountry(evt) {
  if (Array.isArray(evt.bounds) && evt.bounds.length === 4) {
    const [minLng, minLat, maxLng, maxLat] = evt.bounds
    mapFly.fitBounds?.([[minLng, minLat], [maxLng, maxLat]], 60)
  } else if (Array.isArray(evt.center) && evt.center.length === 2) {
    mapFly.flyTo?.(evt.center)
  }
  // Highlight the country by REUSING the Regions polygon feature (regions-fill
  // /regions-border) instead of the old bolted-on outline. Resolve the
  // aggregate → alpha-3 ISO from the pin data (locale-independent).
  const iso = resolveCountryIso(evt, mapData.normalizedPeopleGroups.value || [])
  if (iso) void highlightCountryByIso(iso)
  // Outline the country via country-boundaries-v1 — but NOT on the Regions tab.
  // The coder found the outline a "weird blue border" there (the regions-fill
  // polygon already highlights the country on that tab). Keep it on the OTHER
  // tabs (people-groups/language/religion/…) where regions-fill is hidden, so
  // the country polygon is still visible cross-tab (card country-polygon-all-maps).
  if (iso && activeTab.value?.id !== 'doxa-regions') countryOutline.showCountry(iso)
  // On the Regions tab, select the COUNTRY itself in the legend. The Regions
  // legend IS 3-tier (REGIONS_TABS: WAGF Region → WAGF Bloc → Country), so the
  // searched country exists as a real leaf node (id 'country:region__block__ISO',
  // label = country name, filter on countryIso, isoCodes:[iso]). Selecting it via
  // onSemanticTreeSelect dims JUST that country's polygon and highlights its row
  // (SemanticTreeLegend's ancestor-expand surfaces the row under its region/bloc).
  // regionsTree is lazy → ensure loaded and defer to nextTick so it lands after settle.
  if (iso && activeTab.value?.id === 'doxa-regions') {
    const applyCountrySel = () => {
      const country = findNodeInTree(regionsTree.value, n =>
        n.id.startsWith('country:') && (n.isoCodes || []).includes(iso))
      if (country) {
        onSemanticTreeSelect(country)
        if (pplrInstance && pplrInstance.selection) pplrInstance.selection.value = country
      }
    }
    Promise.resolve(ensureRegionsLoaded()).finally(() => nextTick(applyCountrySel))
  }
}

// ─── Filter sync — ResearchMapFilterPanel writes to mapStore.filters ─────────
// useMapLayers + useMapClustering subscribe to mapStore.filters and re-render
// the source / cluster layers when they change.
watch(() => mapStore.filters, () => {
  mapLayers.applyFilters?.(mapStore.filters)
  clustering.applyFilters?.(mapStore.filters)
}, { deep: true })

// ─── HOST-DRIVEN FILTERS, AND THE EVENT THAT REPORTS OUR OWN ────────────────
// A cap-4 composite owns ONE filter state and feeds both halves; this is that map's half of the
// contract (BUILD-LINKED-FILTERING, 2026-09-25: "interoperability within themselves").
// Shape is deliberately the SMALL overlap between what this map filters by and what a people-group
// grid filters by — region, religion, language, engagement. Anything else a host sends is ignored
// rather than guessed at.
//
// ★ A STANDALONE MAP MUST BEHAVE EXACTLY AS BEFORE. Nothing here runs unless a host actually sends
// `externalFilters`, and the event below is a DOM CustomEvent that a page with no listener simply
// never hears. No parent, no change.
// Region only, deliberately: it is the one facet whose values the two halves can exchange without
// inventing a meaning. The map filters religion and language by the canonical strings its own data
// carries, and a people-group grid filters them by slugs from a different table; linking those
// would mean guessing a mapping, and a wrong link is worse than an honest gap.
let applyingExternal = false

// ─── FIT THE MAP TO A SET OF PEOPLES: state, declared here on purpose ────────
// These belong with applyFitSlugs() further down, and that is where they used to be. They cannot
// live there: the watcher immediately below is `immediate: true`, so it runs DURING setup and
// calls applyFitSlugs(raw.fitSlugs) — while a `let`/`const` further down the file is still in its
// temporal dead zone. `function applyFitSlugs` hoists; its constants do not, and reading
// _lastFitKey threw `Cannot access '_lastFitKey' before initialization`, which killed the whole
// setup and blanked the map. Anything an immediate watcher can reach must be declared above it.
const FIT_PADDING_PX      = 70
const FIT_MAX_ZOOM        = 5.5   // several peoples: stop at regional framing, never street level
const SINGLE_ROW_ZOOM     = 6     // one people group: its coordinate is a country-scale centroid
const DEGENERATE_SPAN_DEG = 0.01  // a cluster this tight is a point by another route
const WIDE_SPAN_DEG       = 110   // past this the set wraps the globe; frame the world instead
const WORLD_ZOOM          = 1.45
const FLY_DURATION_MS     = 900
let _lastFitKey = ''

watch(() => profileConfig?.value?.externalFilters, (raw) => {
  if (!raw || typeof raw !== 'object' || !mapStore) return
  applyingExternal = true
  try {
    // ★ AN EMPTY VALUE THE HOST DID NOT SET MUST NOT CLEAR WHAT THIS PAYLOAD JUST LIT. This is the
    // The report "the research map isn't connecting with the legend" on the WAGF Regions tab, found by
    // a stack trace (l40): the highlight painted at +51 ms and was wiped at +438 ms by
    // clearAllHighlights, reached from applyDimFilter({kind:null}) through the selectedRegion watcher —
    // so selectedRegion had gone FALSY while externalRegion still read "asia".
    //
    // The round trip is what did it. A row click emits map-filtered, the composite pushes the state
    // back down as externalFilters, and that payload carries EVERY key it knows — region:"asia" AND
    // language:"". This handler then set the region and, one line later, "cleared" a language that was
    // never set. mapStore.selectLanguage() nulls selectedRegion by design (exclusive selection, Bug 13)
    // and it does so even when its argument is null, so selectLanguage(null) is a clear-everything in
    // disguise. The map was undoing its own selection 0.4 s after the reader made it.
    //
    // So an empty incoming value is a NO-OP unless that dimension is actually lit. A genuine host clear
    // still clears (the dimension is lit, the new value is empty), and a genuine host SELECTION still
    // swaps exclusively, which is the behaviour Bug 13 asked for. Guarded on both axes rather than only
    // the one that bit: region and language are symmetric here, and fixing one leaves the mirror image.
    if ('region' in raw) {
      const region = raw.region || null
      if (region || mapStore.selectedRegion) mapStore.selectRegion?.(region)
    }

    // ★ RELIGION LINKS AT THE FAMILY, AND THE KEY↔NAME MAPPING IS THE ONE BOTH HALVES ALREADY USE.
    // MEASURED, and the measurement changed the design twice:
    //   1. This map's records carry religion as a 1-3 char CODE (BLA, CPR, E, MSN) and a people-group
    //      grid filters by a display name, so the two vocabularies do not meet at the raw religion.
    //   2. `mapStore.filters.religions`, which the filter panel writes, is read by NOTHING — the
    //      `mapLayers.applyFilters?.()` it was meant to reach is called but never implemented, so a
    //      link routed through it would have set state and dimmed no pin. Verified by searching the
    //      tree for a definition: there is none.
    // What DOES filter this map by religion is the legend's own flat tab, keyed by the FIRST LETTER
    // of the code — `uiStore.religionFilter`, watched below into applyDimFilter. And that letter's
    // display name comes from RELIGION_FAMILIES in library/colors/religion.js, the same module the
    // people-groups grid imports to derive its own `__religion_family` axis. So the canonical name
    // and the key are two views of ONE shared table that neither half copies: the grid turns a code
    // into a family name through it, and this reverse lookup turns that family name back into the
    // key this map filters by. No table is written here, and a change to that module moves both
    // halves at once. `routeReligion` below already does this exact lookup for geocoder searches.
    if ('religion' in raw) {
      const name = String(raw.religion || '').trim()
      const letter = name
        ? Object.keys(RELIGION_FAMILIES).find((k) => String(RELIGION_FAMILIES[k]).toLowerCase() === name.toLowerCase())
        : ''
      if (!name) {
        if (uiStore.religionFilter) uiStore.setReligionFilter(null)
      } else if (letter) {
        // Switch first so the legend shows the selected row, then set the filter on the next tick —
        // the tab watcher clears highlights on its way in, and routeReligion defers for the same reason.
        if (activeTabId.value !== 'religion') switchTab('religion')
        nextTick(() => uiStore.setReligionFilter(letter))
      }
      // A name that is not one of the ten families is left alone rather than guessed at: dimming
      // every pin because the host said something this map cannot express is worse than doing nothing.
    }

    // ★ FIT THE CAMERA TO WHAT THE LIST IS SHOWING (BUILD-GRID-SELECTION-FLIES-THE-MAP).
    // The link ran one way: a choice on the map narrowed the grid, and a choice in the grid moved
    // nothing — a reader who filtered the list to 83 peoples had no idea where they were. The
    // composite sends the slugs its grid is currently showing and this map frames them, using the
    // coordinates it already holds. Slugs and not a bbox because the composite has no coordinates;
    // this half is the one that knows where anything is.
    //
    // CAMERA POLICY COPIED, DELIBERATELY, from research-dashboard's useSelectionCamera.js, which
    // worked all of this out for the desktop pair: a single row has a zero-area bbox and would fit
    // at street level for what is really a country-scale centroid; several rows in one place are
    // the same problem by another route; and a selection spanning most of the globe animates the
    // wrong way around the antimeridian if framed literally. The right end state is ONE shared
    // composable in library/, not two copies — but a library move cannot be landed from this lane
    // under the current rule, so it is cited rather than imported, and a move later should delete
    // this block rather than leave a third copy.
    //
    // ⚠ MOTION SAFETY. Readers may be photosensitive, and a camera that re-animates on every
    // keystroke of a search box is exactly the strobe class this repo has already paid for. One
    // move per settled set: an identical slug set never re-flies, and a reduced-motion preference
    // JUMPS (duration 0) rather than easing — same destination, no traversal.
    if ('fitSlugs' in raw) applyFitSlugs(raw.fitSlugs)

    // Language needs no translation — MEASURED, this map's own vocabulary is display names
    // ('Abai Sungai', 'Afar', 'Afrikaans'), the same strings a people-group grid shows for
    // primary_language. Verified rather than assumed, because religion just above is the counter-example.
    //
    // ★ THE MAP'S SELECTIONS ARE MUTUALLY EXCLUSIVE AND THAT IS NOT OURS TO OVERRIDE. selectLanguage
    // nulls selectedRegion by design (Bug 13), so region and language cannot both be lit here. The
    // composite mirrors that exclusivity in its own state rather than letting the two halves disagree.
    if ('language' in raw) {
      const language = raw.language || null
      if (language || mapStore.selectedLanguage) mapStore.selectLanguage?.(language)
    }
  } finally {
    // Release on the NEXT tick, not synchronously: the watchers below fire after this one, and
    // releasing too early lets our own echo travel back out as if the reader had filtered here.
    nextTick(() => { applyingExternal = false })
  }
}, { deep: true, immediate: true })

// VERIFICATION HANDLE — the same contract as DashboardMapPanel's window.__rdashMap and
// resources-map's window.__grMap. A linked filter is a STATE claim ("the other half adopted it"),
// and every DOM proxy for it that I tried was either tab-specific or a selector guess: the honest
// way to check is to read the state itself. Reports the composite-driven facet only.
//
// ★ EACH HOOK IS ALSO HELD LOCALLY, so the unmount path can release ONLY WHAT IS STILL OURS.
// Two of these maps can share a page (research-map-plus-grid composes one beside a grid, and the
// gallery can show another): B mounts and overwrites A's hooks, then A unmounts. An unconditional
// delete would strip the hooks belonging to the map still on screen, and it would report a verify
// hook missing on a map that is perfectly healthy — a false failure costing more to chase than this
// costs to write. Declared out here rather than inside the block below because a const inside it is
// invisible to onBeforeUnmount. Same pattern gospel used in d3597f3d1.
let _hookFilterState = null
let _hookPinOpacity = null
let _hookClusterDraw = null
let _hookVocabulary = null
if (typeof window !== 'undefined') {
  window.__researchMapFilterState = _hookFilterState = () => ({
    selectedRegion: mapStore?.selectedRegion || '',
    externalRegion: profileConfig?.value?.externalFilters?.region || '',
    religionFamily: RELIGION_FAMILIES[uiStore?.religionFilter] || '',
    selectedLanguage: mapStore?.selectedLanguage || '',
  })
  // The VOCABULARY this map filters by, read off its own normalized records. A composite that wants
  // to drive this map has to speak these exact strings, and the only honest way to know them is to
  // ask the data rather than to write a table beside it and hope the two stay in step.
  // `religionFamily` is DERIVED, not stored: the family is the first letter of the code, named by
  // RELIGION_FAMILIES — the same table, run the same direction, as the grid's `__religion_family`
  // accessor. That is what makes the two vocabularies comparable, and comparing them is how the
  // linking is checked rather than assumed (see scripts/check-linked-vocabulary.mjs).
  // WHAT THIS MAP IS ACTUALLY DRAWING for clustering. The output is painted on the CANVAS, so no
  // DOM assertion can tell a native circle cluster from an MST web from nothing at all — and "the
  // state changed" is exactly the kind of evidence that let an inert control ship in the first
  // place. So this reports, per clustering layer, whether it EXISTS, whether it is VISIBLE, and how
  // many features are actually RENDERED right now. Layers are found by prefix rather than from a
  // list, so a clustering layer added later shows up here without anyone remembering to add it.
  // Same shape and purpose as the two handles beside it.
  // THE PIN LAYER'S ACTUAL OPACITY EXPRESSION, for the same reason as the handle below: the slider
  // and legend dimming COMPOSE into one paint property, and "the store value changed" is not evidence
  // that they composed. Returns whatever GL is holding — a number when nothing is dimmed, a ['case',…]
  // when something is.
  window.__researchMapPinOpacity = _hookPinOpacity = () => {
    try { return map.value?.getPaintProperty?.('language-family-pins', 'circle-opacity') ?? null } catch (_) { return null }
  }

  window.__researchMapClusterDraw = _hookClusterDraw = () => {
    const m = map.value
    const out = {}
    try {
      for (const l of (m?.getStyle?.()?.layers || [])) {
        if (!/^(mapbox-clusters|cluster-lines)/.test(l.id)) continue
        let rendered = 0
        try { rendered = m.queryRenderedFeatures({ layers: [l.id] }).length } catch (_) { rendered = -1 }
        out[l.id] = { visibility: (l.layout && l.layout.visibility) || 'visible', rendered }
      }
    } catch (_) { /* style not ready — an empty report is the honest answer */ }
    return out
  }

  window.__researchMapVocabulary = _hookVocabulary = (field) => {
    const rows = mapData?.normalizedPeopleGroups?.value || []
    const seen = new Set()
    for (const r of rows) {
      if (field === 'religionFamily') {
        const name = RELIGION_FAMILIES[String(r?.religion || '').charAt(0)]
        if (name) seen.add(name)
        continue
      }
      const v = r && r[field]
      if (typeof v === 'string' && v) seen.add(v)
    }
    return [...seen].sort()
  }
}

// ★ THE INSTANCE IS CAPTURED IN SETUP, BECAUSE A WATCHER IS NOT SETUP.
// This read getCurrentInstance() INSIDE the function, and the function is only ever called from a
// watcher callback (just below). Vue only returns an instance during setup — from a watcher it is
// null — so `host` was null on every call, emitFilterState returned at the guard, and the
// `map-filtered` event this map owes its composite was NEVER dispatched. The whole map -> grid
// direction was dead.
//
// It looked verified because the check that "proved" it DISPATCHED THE EVENT ITSELF and then
// asserted the grid reacted. That tested the composite's listener and the grid, which do work; it
// never tested the one line that emits. A synthetic event cannot prove an emitter fires — it
// replaces it.
//
// Captured here, at setup top level, and resolved to the host lazily so it also survives being
// called before mount.
const _selfInstance = getCurrentInstance()
function selfHostElement() {
  try { return _selfInstance?.proxy?.$el?.getRootNode?.()?.host || null } catch (_) { return null }
}

// Report OUR filter state upward, so a composite can drive its other half with it.
function emitFilterState() {
  if (applyingExternal || typeof window === 'undefined') return
  const host = selfHostElement()
  if (!host) return
  // Report in the vocabulary a HOST speaks: the family NAME, not the legend's letter key. Same
  // shared RELIGION_FAMILIES table the inbound direction reads, used the other way round.
  const religionName = RELIGION_FAMILIES[uiStore?.religionFilter] || ''
  // ★ LANGUAGE TRAVELS AS A CODE AS WELL AS A NAME, because the NAME moves with the locale.
  // MEASURED against the live API: primary_language's LABEL is fully localized (864 names in en,
  // 864 in ar, ZERO shared) while its VALUE is the stable ISO 639-3 code (864 shared, identical).
  // Region already links on a slug and religion on a family letter; language was the one facet
  // still linking on a display name, so the moment the grid's data followed the URL's language the
  // link would have matched nothing in Arabic — silently, because an empty intersection looks like
  // "no results" rather than a broken wire.
  //
  // This tree has paid for exactly this once before: deriveLanguageFamily in useMapData carries a
  // comment about the 2026-06-22 locale colour bug, where deriving a family from the localized
  // label collapsed every pin onto one bucket. Same trap, one facet over.
  //
  // The NAME still goes out because this map's own legend selects by name; the CODE goes out for
  // anyone matching rows. Both halves get the form they can actually use.
  // ★ THE LOOKUP HAS TO MATCH THE WAY THE LEGEND BUILT THE LABEL (measured on main 49992a5d:
  // MapLibre, BOTH locales, Languages > Language > "Arabic" -> languageCode:"" -> grid 2,107 -> 0).
  //
  // WHAT I GOT WRONG. This found a row whose language LABEL equals the selected name with `===`.
  // A language node's label is NOT a label any row carries: useLanguageFamilyLegendData builds the
  // tree family > language > dialect, and the LANGUAGE tier's label is a BASE NAME derived by
  // splitting the API label at the comma. MEASURED against the live source (2,107 rows, all 2,107
  // carrying primary_language as {value,label}): there is NO row whose label is "Arabic". What
  // exists is "Arabic, Sudanese", "Arabic, Levantine", "Arabic, Gulf", ... So the exact match could
  // never hit, in any locale — which is why it failed identically in en and ar, and why the
  // locale fix that prompted this code was right about the DISEASE and wrong about this line.
  //
  // This is the derived-value trap, one tier down from where I last wrote it up: a value that
  // crosses a component boundary must exist on a row, or the two ends are comparing different
  // things. "Arabic" is a GROUPING the legend invented; `primary_language.label` is a FIELD.
  //
  // So the rows are matched the way the legend's own node matches pins — base, comma-prefix,
  // space-suffix — rather than by a fourth hand-typed rule that can drift from the other three.
  const langName = mapStore?.selectedLanguage || ''
  // A dialect is a language selection too, and it was emitting nothing at all: the watcher below
  // did not observe selectedDialect, so drilling to the deepest tier left the grid on the previous
  // state. Its originalLabels ARE exact API labels, so it is the one unambiguous case.
  const dialect = mapStore?.selectedDialect || null
  const dialectLabels = Array.isArray(dialect?.originalLabels) ? dialect.originalLabels.map((s) => String(s).trim()).filter(Boolean) : []
  // Read the records here rather than assuming a `rows` in scope — check:no-free-identifiers caught
  // exactly that on its first outing against this very edit, which is the class of bug it is for.
  const langRows = mapData?.normalizedPeopleGroups?.value || []
  const rowLangLabel = (r) => {
    const l = r && (r.language ?? r.primary_language)
    return String((l && typeof l === 'object' ? l.label : l) || '').trim()
  }
  // The legend node's own predicate, in JS. Keep these three arms in step with the `filter`
  // expression in useLanguageFamilyLegendData.js — they are the same rule, and a fourth spelling
  // of it is how this broke in the first place.
  const matchesLanguage = (lab, base) =>
    lab === base || lab.startsWith(base + ',') || lab.includes(' ' + base)
  const selectedRows = dialectLabels.length
    ? langRows.filter((r) => dialectLabels.includes(rowLangLabel(r)))
    : (langName ? langRows.filter((r) => matchesLanguage(rowLangLabel(r), langName.trim())) : [])
  // ★ ONE CODE ONLY WHEN THERE IS ONE. "Arabic" covers many ISO 639-3 codes (apd, acm, ayl, ...),
  // so there is no single value that means it, and inventing one would filter the grid to a
  // fraction of the selection while looking like it worked. Emitting '' is the honest answer, and
  // the composite's job is then to NOT narrow on an axis it cannot express (fail OPEN) rather than
  // to narrow to nothing. The full set travels alongside for any consumer that can use a set.
  const langCodes = [...new Set(selectedRows
    .map((r) => String(r?._raw?.primary_language?.value || (r?.language && typeof r.language === 'object' ? r.language.value : '') || '').trim())
    .filter(Boolean))]
  const langCode = langCodes.length === 1 ? langCodes[0] : ''

  const detail = {
    region: mapStore?.selectedRegion || '',
    religion: religionName,
    // ★ A DIALECT'S NAME COMES FROM ITS LABELS, NOT ITS KEY (a measured case: this reported
    // ", Afro-Asiatic__Arabic__Sudanese"). `selectedDialect.key` is the TREE NODE ID —
    // family__baseLang__dialect — and the watcher fifteen lines above says so in as many words;
    // I read that comment and then used the key as a display name anyway. Worse, selectedLanguage
    // is empty by the time a dialect is active, so the template produced a leading comma and an
    // internal identifier: a string no reader could make sense of, in the one slot meant for a
    // human name.
    // dialectLabels are the ORIGINAL API labels the legend grouped ("Arabic, Sudanese"), so they
    // are both the right words and already in the reader's locale. The first is the display name;
    // when a dialect groups several labels the whole list is the honest answer, because that is
    // what the selection covers.
    language: dialectLabels.length ? dialectLabels.join(' · ') : langName,
    languageCode: langCode,
    // ADDITIVE: every code the selection covers, so a consumer with multi-value filtering can
    // narrow correctly where a single code cannot express the selection. Existing listeners that
    // only read `languageCode` are unaffected.
    languageCodes: langCodes,
  }
  // ★ AN EMPTY REPORT AFTER A NON-EMPTY ONE IS AMBIGUOUS, SO IT IS NOT SENT IMMEDIATELY.
  // measured at 52eeb0db: coalescing worked — one event per click — and in 3 of 4 runs
  // that one event was EMPTY, so the grid stayed at 2,107. The cascade behind a dialect click
  // passes through a fully-cleared state: mapStore.selectLanguage() sets selectedDialect = null
  // BEFORE it sets the language, and the clear was the last write my watcher saw. The settle timer
  // then fired in the gap and read nothing.
  //
  // MY FIRST FIX WAS A TIMEOUT, AND A TIMEOUT WAS THE WRONG KIND OF ANSWER. 60ms was enough in my
  // seat and not under headless swiftshader, which is the same fixed-sleep mistake I have now made
  // three times: a duration tuned on one machine is a measurement of that machine. Lengthening it
  // would move the failure, not remove it.
  //
  // So the condition is SEMANTIC. "Everything is empty" immediately after a non-empty report is
  // exactly what a mid-cascade read looks like AND exactly what a genuine clear looks like, and
  // nothing in the payload tells them apart — but TIME does, cheaply and in the safe direction:
  // re-read a few times, and take the first answer that is not empty. A real clear stays empty
  // through every re-read and is reported a few tens of ms later, which no reader can perceive; a
  // transient fills in and is reported correctly. The retries are bounded so a clear can never be
  // swallowed, only delayed.
  const isEmpty = !detail.region && !detail.religion && !detail.language && !detail.languageCode
  if (isEmpty && _lastEmitWasFilled) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    if (!_emptyWaitStartedAt) _emptyWaitStartedAt = now
    if (now - _emptyWaitStartedAt < EMPTY_SETTLE_CEILING_MS) {
      // Still inside the window in which an empty read is more likely to be the cascade than the
      // reader. Re-read rather than believe it; the condition that ends this is the state becoming
      // non-empty, not a count running out.
      clearTimeout(_emitTimer)
      _emitTimer = setTimeout(emitFilterState, EMIT_SETTLE_MS)
      return
    }
    // The ceiling passed and it is still empty: the reader cleared it. Report that.
  }
  _emptyWaitStartedAt = 0
  _lastEmitWasFilled = !isEmpty
  host.dispatchEvent(new CustomEvent('map-filtered', { detail, bubbles: true, composed: true }))
}

// ★ ONE EVENT PER SETTLED SELECTION (a measured case: a dialect click narrowed the grid in
// only ONE of four runs, with a correct languageCode in all four).
//
// THE CAUSE IS A BURST MEETING A GUARD. Clicking a dialect does not change one store value; it
// clears the language, sets the family and sets the dialect, across ticks, so the watcher below
// fired three or four times and this element dispatched three or four map-filtered events for one
// click. The composite ignores anything that arrives while it is pushing state INTO its children —
// a guard it needs, because the grid re-emits during a push and the round trip would otherwise
// cancel the very selection just made — and that window is 1.2 seconds. So whether the LAST event
// in the burst, the one carrying the settled state, arrived inside or outside the window was
// timing. Three runs lost it; one did not.
//
// Coalescing here is the fix that belongs to this file: the other end's guard is correct, and the
// burst is what this element should not have been sending. One click, one event, nothing to drop.
// A short window rather than nextTick because the cascade crosses ticks (the legend bridge does
// async work); 60ms is far below the 1.2s guard and below what a reader perceives as a delay.
let _emitTimer = null
const EMIT_SETTLE_MS = 60
// How many times an all-empty read may be re-taken before it is believed. Bounded on purpose: a
// genuine clear must always get through, and the worst case here is EMPTY_RETRIES * EMIT_SETTLE_MS
// of delay on a clear — about a fifth of a second, well under what a reader notices, and far below
// the composite's own 1.2s push window so it cannot collide with that.
// ★ A CEILING ON BELIEVING A CLEAR — NOT A GUESS AT HOW LONG THE CASCADE TAKES.
// measured at 835ec1ac: the retry budget catches the transient on MapLibre and NOT
// reliably on Mapbox (and not at all in ar/mapbox), because 3 x 60ms is still a duration I picked
// without being able to measure the thing it has to outlast. That is the THIRD time I have tuned a
// number on one machine for this one defect, so the number's JOB changes rather than its value.
//
// Before: "wait long enough for the cascade to finish" — unknowable from here, and wrong on any
// machine slower than mine. Now: "keep re-reading until the state is non-empty, and if it is STILL
// empty after this long, the reader really did clear it." Too long merely delays a clear by an
// amount no one perceives; too short reintroduces the bug. So it errs generous, and it stays under
// the composite's 1.2s push window so the two cannot interact.
const EMPTY_SETTLE_CEILING_MS = 900
let _emptyWaitStartedAt = 0
// Whether the LAST report actually carried a selection. Only then is an empty read suspicious: on
// first load, or after a clear that has already been reported, empty is simply the truth.
let _lastEmitWasFilled = false
function emitFilterStateSettled() {
  // ★ THE ECHO GUARD MUST BE READ WHEN THE CHANGE HAPPENS, NOT WHEN THE TIMER FIRES.
  // measured: a region row click emitted {region:"asia"} and then an EMPTY event, on both
  // engines. It passed only because the composite's 1.2s push window happened to swallow the
  // second one — a pass that depends on a swallow is not a pass.
  //
  // THE CAUSE IS MINE, AND IT IS THE COALESCING I ADDED. emitFilterState has always opened with
  // `if (applyingExternal) return`: when the HOST pushes state down through externalFilters, the
  // store changes, and reporting that back up is an echo of the host's own instruction. That guard
  // worked because the emit ran SYNCHRONOUSLY inside the watcher, while the flag was still set.
  // Debouncing moved the emit 60ms later — and applyingExternal is released on nextTick, long
  // before that — so by the time the emit ran the flag was false and the echo went out. I fixed a
  // burst and broke a guard that depended on the burst's timing, which is the cost of changing WHEN
  // something runs without re-reading what else depended on when.
  //
  // So the decision is taken here, at schedule time, where the flag still means what it says: a
  // change that arrived from the host is not a change the reader made, and is not reported back.
  if (applyingExternal) return
  _emptyWaitStartedAt = 0    // a fresh user action restarts the window
  clearTimeout(_emitTimer)
  _emitTimer = setTimeout(emitFilterState, EMIT_SETTLE_MS)
}
onBeforeUnmount(() => clearTimeout(_emitTimer))
// selectedDialect joins the sources: it is the deepest tier of the Language tree and a genuine
// language selection, but it was not observed here, so drilling from "Arabic" to "Arabic, Sudanese"
// changed the map and left the grid reporting the tier above. `.key` rather than the object,
// because the store replaces it wholesale and a deep watch here would re-emit on every re-render.
watch(() => [mapStore?.selectedRegion, mapStore?.selectedLanguage, mapStore?.selectedDialect?.key, uiStore?.religionFilter],
  () => emitFilterStateSettled())

// ─── Universal-legend (LegendRows) → applyDimFilter bridge ───────────────────
// LegendRows / useLegendData routes row-clicks through mapStore.selectFamily()
// or mapStore.selectRegion() (NO `legend:highlight` window event). Synthesize
// the same payload shape that LegendFamilyTree emits, so applyDimFilter — and
// the cluster-selection-filter pushed inside it — runs uniformly for both
// language-families and doxa-regions tabs.
watch(() => mapStore.selectedRegion, (key) => {
  if (key) applyDimFilter({ kind: 'region', regionKey: key, coords: [] })
  else applyDimFilter({ kind: null })
})
// Legend selections are mutually exclusive (Bug 13). When the user swaps from
// family → language, mapStore.selectLanguage() also nulls selectedFamily — but
// the watcher mustn't fire applyDimFilter({kind:null}) for that cascade clear,
// because clearAllHighlights() would erase the new language selection. The
// guard: only run the kind:null clear when EVERY level is null.
watch(() => mapStore.selectedFamily, (key) => {
  if (key) applyDimFilter({ kind: 'family', familyKey: key, coords: [] })
  else if (!mapStore.selectedLanguage && !mapStore.selectedDialect) applyDimFilter({ kind: null })
})
watch(() => mapStore.selectedLanguage, (key) => {
  if (key) applyDimFilter({ kind: 'language', languageKey: key, coords: [] })
  else if (!mapStore.selectedFamily && !mapStore.selectedDialect) applyDimFilter({ kind: null })
})
watch(() => mapStore.selectedDialect, (dialect) => {
  if (dialect?.key) applyDimFilter({ kind: 'dialect', dialectKey: dialect.key, originalLabels: dialect.originalLabels || [], coords: [] })
  else if (!mapStore.selectedFamily && !mapStore.selectedLanguage) applyDimFilter({ kind: null })
})

// LegendRows row-clicks on the prayer / engagement / adoption tabs route through
// useLegendData → uiStore.set{Prayer,Engagement,Adoption}Filter — they do NOT
// dispatch the `legend:highlight` window event the family tree uses. Synthesize
// the same payload shape here so applyDimFilter dims non-matching pins on every
// row click. (Filter keys: prayer → noPrayer | hasPrayer | fullPrayer;
// engagement → notEngaged | hasEngagement; adoption → notAdopted | hasAdoption.)
watch(() => uiStore.prayerFilter, (key) => {
  if (key) applyDimFilter({ kind: 'prayer', property: 'peoplePraying', expectedValue: key, coords: [] })
  else applyDimFilter({ kind: null })
})
watch(() => uiStore.engagementFilter, (key) => {
  if (key) applyDimFilter({ kind: 'engagement', property: 'engagementStatus', expectedValue: key, coords: [] })
  else applyDimFilter({ kind: null })
})
watch(() => uiStore.adoptionFilter, (key) => {
  if (key) applyDimFilter({ kind: 'adoption', property: 'adoptionStatus', expectedValue: key, coords: [] })
  else applyDimFilter({ kind: null })
})
watch(() => uiStore.religionFilter, (key) => {
  if (key) applyDimFilter({ kind: 'religion', property: 'religion', expectedValue: key, coords: [] })
  else applyDimFilter({ kind: null })
})

// ─── FIT THE MAP TO A SET OF PEOPLES ─────────────────────────────────────────
// Its constants and the _lastFitKey guard are declared ABOVE the externalFilters watcher, not here
// beside applyFitSlugs() — see the note there.

function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch (_) { return false }
}

function applyFitSlugs(slugs) {
  const list = Array.isArray(slugs) ? slugs.filter((s) => typeof s === 'string' && s) : []
  // An identical set must not re-animate: the grid re-emits on every keystroke and every re-render,
  // and re-flying to the same place is motion with no information in it.
  const key = list.length ? `${list.length}:${list[0]}:${list[list.length - 1]}` : ''
  if (key === _lastFitKey) return
  _lastFitKey = key
  if (!list.length) return

  const want = new Set(list)
  const rows = mapData?.normalizedPeopleGroups?.value || []
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity, n = 0
  for (const r of rows) {
    if (!r || !want.has(r.slug)) continue
    // The live API returns coordinates as STRINGS, so every read goes through Number() — a raw
    // string compare orders "9.5" above "78.2" and silently produces a wrong bbox.
    const lng = Number(r.longitude ?? r.lng)
    const lat = Number(r.latitude ?? r.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
    n++
  }
  if (!n) return                    // nothing this map holds — say nothing rather than fly nowhere

  const spanLng = maxLng - minLng
  const spanLat = maxLat - minLat
  const centre = { longitude: (minLng + maxLng) / 2, latitude: (minLat + maxLat) / 2 }
  const point = spanLng > WIDE_SPAN_DEG ? { c: centre, z: WORLD_ZOOM }
    : (n === 1 || (spanLng < DEGENERATE_SPAN_DEG && spanLat < DEGENERATE_SPAN_DEG))
      ? { c: { longitude: minLng, latitude: minLat }, z: SINGLE_ROW_ZOOM }
      : null

  // ★ REDUCED MOTION DRIVES THE MAP DIRECTLY, and that is not belt-and-braces.
  // MEASURED with the browser's prefers-reduced-motion: reduce set: the framing move still
  // animated for ~5s on MapLibre and ~6.7s on Mapbox — essentially the same as without it, where a
  // jump is ~0ms. So the preference was being honoured in THIS file and thrown away downstream:
  // useMapFly's flyToCoords(coords, zoom) takes NO options argument at all, so the `{ duration: 0 }`
  // I was passing it went nowhere. (fitBounds does accept one; flyToCoords does not — a difference
  // between two neighbours in one file, invisible at the call site.)
  //
  // A photosensitive reader is the whole reason this branch exists, so it no longer depends on
  // whether a helper happens to forward an option: it calls the engine's own jump. The eased paths
  // are unchanged and still go through mapFly, so ordinary motion keeps one owner.
  const m = map.value
  if (prefersReducedMotion() && m) {
    try {
      if (point) m.jumpTo({ center: [point.c.longitude, point.c.latitude], zoom: point.z })
      else m.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM, duration: 0 })
      return
    } catch (_) { /* fall through to the eased path rather than not moving at all */ }
  }

  if (point) { mapFly.flyToCoords?.(point.c, point.z); return }
  mapFly.fitBounds?.([[minLng, minLat], [maxLng, maxLat]], FIT_PADDING_PX, { maxZoom: FIT_MAX_ZOOM, duration: FLY_DURATION_MS })
}

// ─── Clusters wiring: TWO CONTROLS, ONE STATE ────────────────────────────────
// This map has two ways to ask for clustering and they used to disagree:
//
//   LegendDesktop's "Clusters" CHECKBOX  -> mapStore.showClusters
//   the side menu's four-way PICKER      -> mapStore.clusteringMode (Off/Native/MST/Network)
//
// The checkbox force-set 'mst' "regardless of what's in the store", and the picker wrote to a
// property mapStore never declared — so choosing Native drew nothing, and had it worked, one tick
// of the checkbox would have snapped it back to MST anyway. MEASURED as inert; the
// second half is what makes fixing only the picker the wrong fix, because the control would have
// worked until the reader touched the other one.
//
// Now clusteringMode IS the state ('off' means disabled) and the checkbox is a view of it: ticking
// it keeps whatever the reader picked, promoting only 'off' to 'mst' so the checkbox alone still
// behaves exactly as it documented. The two can no longer show different things.
//
// The guard is not ceremony: each watcher writes the other's field, so without it one click runs
// the whole teardown-and-redraw twice — visible as a flash, and twice the work on a 2,100-pin map.
let _applyingCluster = false
async function applyClusterState() {
  if (_applyingCluster) return
  _applyingCluster = true
  try {
    const mode = mapStore.clusteringMode || 'off'
    if (mode === 'off') {
      if (mapStore.showClusters) mapStore.showClusters = false
      await clustering.setEnabled?.(false)
      return
    }
    if (!mapStore.showClusters) mapStore.showClusters = true
    // Mode must be set before setEnabled() so the composable selects the right path; otherwise it
    // falls back to its own internal default ('mapbox') and the reader's choice is lost.
    await clustering.setMode?.(mode)
    // Replay any legend-row selection made BEFORE clustering was enabled — keeps the first pass
    // scoped to that slice.
    clustering.flushSelectionFilter?.()
    await clustering.setEnabled?.(true)
  } finally {
    _applyingCluster = false
  }
}

watch(() => mapStore.showClusters, async (on) => {
  if (_applyingCluster) return
  // The checkbox only decides ON or OFF; WHICH clustering is the picker's business, and 'mst' is
  // the default this map has always used when nobody has picked anything.
  if (on && (!mapStore.clusteringMode || mapStore.clusteringMode === 'off')) mapStore.clusteringMode = 'mst'
  else if (!on && mapStore.clusteringMode !== 'off') mapStore.clusteringMode = 'off'
  await applyClusterState()
})

watch(() => mapStore.clusteringMode, async () => {
  if (_applyingCluster) return
  await applyClusterState()
})

// ─── Lifecycle ───────────────────────────────────────────────────────────────
async function onMapReady(normalizedPeopleGroups) {
  mapStore.registerMap(mapId, map.value)
  setProjectionOn(map.value, 'mercator')   // per-engine shape: library/useMapProvider (C2)
  // Apply the persisted theme's lightPreset now the Standard style has loaded, so a
  // reload while dark was selected boots the NIGHT basemap (no light-under-dark desync).
  // (bug-ghost-rings-standard-style — Option B.)
  mapTheme.applyTheme(map.value)

  if (normalizedPeopleGroups?.length) {
    // NOTE: do NOT mirror into a second `dataStore.sources['research-map-pins']`
    // entry here — useMapData's `dataStore.cacheSourceData()` already stores
    // the same dataset under `dataStore.sources[dataSourceId].features`, and a
    // second copy doubles every legend count (e.g. Unengaged 2069 → 4138).

    mapLayers.addLanguageFamilyLayer(
      normalizedPeopleGroups,
      activeTab.value?.colorStrategy ?? 'languageFamily'
    )
    // Initial-render override: doxa-regions tab → solid grey pins so they
    // don't blend into the matching-color polygon fill.
    if (activeTab.value?.id === 'doxa-regions' && map.value?.getLayer('language-family-pins')) {
      map.value.setPaintProperty('language-family-pins', 'circle-color', '#4b5563')
    }
    // ★ INSTALL THE DATA-DRIVEN OPACITY NOW, WHICH IS WHAT ACTUALLY PRE-WARMS THE SHADER. The layer is
    // added with a CONSTANT "circle-opacity": 1 (see addLanguageFamilyLayer), and applyPinOpacity is
    // otherwise first reached from a legend click — so without this line the expression shape below is
    // only ever the CLEARED state and the first selection is still the moment the variant is compiled,
    // which is the 3.2-3.5s freeze seen in profiling. Found by reading the built bundle rather than the
    // source: the addLayer constant is right there in the shipped JS.
    // matchExpr is left UNDEFINED on purpose — "re-apply what is current" — so a selection already
    // restored from a share-link hash is preserved instead of being cleared at boot.
    applyPinOpacity(map.value)
    // Start prayer glow if landing on the prayer tab
    if (activeTab.value?.id === 'prayer') mapLayers.startPrayerGlow()
    // Hand the same dataset to clustering so MST/network can rebuild on toggle
    clustering.setData?.(normalizedPeopleGroups)
    // No build step: `items` is a computed over the same data, so the legend appears when the data
    // does. This used to call legend.build?.(normalizedPeopleGroups) against a method that does not
    // exist; ?.() swallowed it, so a line that read like initialisation did nothing at all.
    // Selected-pin highlight + GO marker — must come after the language-families
    // source exists (added by addLanguageFamilyLayer above).
    selectedPin.initialize()
  }

  // PERF: doxa-regions GeoJSON is 6.4 MB decoded. If the user lands on the
  // Doxa Regions tab (the default), defer the load until the browser is idle
  // so the initial map paint + pin render aren't blocked by JSON.parse().
  if (activeTab.value?.id === 'doxa-regions') {
    const schedule = (typeof window !== 'undefined' && window.requestIdleCallback)
      ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => setTimeout(cb, 800)
    schedule(() => { void ensureRegionsLoaded() })
  }

  // Empty-map-click intentionally does nothing. The legend selection is
  // sticky — only the same row re-tapped or the legend close button clears
  // it. (Spec change from earlier "click-off clears" behavior; users found
  // the auto-clear surprising when they tapped the map just to inspect.)

  // Apply the theme-aware pin ring on BOOT (the isDark/tab watchers are not
  // immediate, so without this the dark thick ring only appeared after the first
  // tab switch — coder: "white ring shows up only after I swap tabs").
  _updatePinStroke()

  mapStore.setMapReady(mapId)
  appReady.value = true
}

// ─── Container-scale ResizeObserver (clone of doxa-simple-map.vue:240-267) ──
// Sets the responsive CSS vars (--map-btn-size, --map-toolbar-gap,
// --map-font-md, --map-font-sm, --map-legend-width) based on host width so
// the geocoder pill, toolbar buttons, and legend card all scale together.
let _containerObserver = null
// ResizeObserver for _syncScrollZoomToHost — LAYOUT-DEPENDENT, so observe rather than guess when
// the scrollport settles (a lazy-mounted host has no final height at any fixed timeout; see the
// comment on _syncScrollZoomToHost above). Torn down in onBeforeUnmount.
let _scrollZoomObserver = null
// Its window-'resize' twin, declared out here for the same reason the observer is: both are created
// after onMounted's `await initializeMap()`, which is past the point where a lifecycle hook can
// still attach. The observer was already torn down below; the listener was not, because its
// onBeforeUnmount sat beside the code that added it and was silently never registered.
let _resyncScrollZoom = null
function applyContainerScale(width) {
  const el = rmRoot.value
  if (!el) return
  // Corner roundedness: the host page decides when it rounds the element (the site publishes
  // --map-radius from its slot); supply a default only for a bare embed, never overriding it.
  if (!getComputedStyle(el).getPropertyValue('--map-radius').trim()) {
    el.style.setProperty('--map-radius', '16px')
    el.style.setProperty('--map-radius-sm', '8px')
  }
  if (width >= 700) {
    el.style.setProperty('--map-btn-size',     '40px')
    el.style.setProperty('--map-toolbar-gap',  '8px')
    el.style.setProperty('--map-font-md',      '13px')
    el.style.setProperty('--map-font-sm',      '11px')
    // One width for the legend, the pin-detail card and the geocoder pill
    // A 400px detail card over a 380px legend read as two
    // cards. SemanticTreeLegend's .stl-panel follows this variable too.
    // 400px (was 380) since the desktop type scale widened the numeric
    // columns; keeps "Full Prayer Coverage" on one line (2026-09-16).
    el.style.setProperty('--map-legend-width', '380px')
  } else if (width >= 500) {
    el.style.setProperty('--map-btn-size',     '36px')
    el.style.setProperty('--map-toolbar-gap',  '6px')
    el.style.setProperty('--map-font-md',      '12px')
    el.style.setProperty('--map-font-sm',      '10px')
    el.style.setProperty('--map-legend-width', '360px')
  } else {
    el.style.setProperty('--map-btn-size',     '32px')
    el.style.setProperty('--map-toolbar-gap',  '5px')
    el.style.setProperty('--map-font-md',      '11px')
    el.style.setProperty('--map-font-sm',      '10px')
    el.style.setProperty('--map-legend-width', '280px')
  }
}

// ★ THE ⓘ CONTROL IS COMING, SO SAY SO BEFORE THE GALLERY DRAWS ITS FLOATING ONE. The control column
// renders only at appReady, after the style AND the people-group data, and a slow phone gets there late.
// At mount this map tells the gallery's MapInfo that a control is on its way, and the MapInfo waits for
// the map rather than flashing its floating ⓘ and swapping it out. A failure (mapError) or an unmount
// withdraws the promise, so the floating ⓘ shows at once and the popup can always be opened. With no
// MapInfo (a standalone page) nothing answers and nothing changes. This is Prayer Progress's contract.
function announceInfoPending(pending) {
  const el = rmRoot.value
  if (!el) return
  try { el.dispatchEvent(new CustomEvent('dxmaps:mapinfo-pending', { bubbles: true, composed: true, detail: { pending } })) } catch { /* no CustomEvent */ }
}
// A MapInfo that mounted after this map asked into the void; it announces itself, and we answer again.
const reannounceInfoPending = () => { if (!appReady.value && !mapError.value) announceInfoPending(true) }
watch(mapError, (e) => { if (e) announceInfoPending(false) })
// ★ THE PRAYER LINE'S TABLE IS FETCHED AFTER THE MAP MOUNTS, when the browser is idle, not when a print starts: the
// print waits at most 3 s for it (openPoster), and on a slow phone network a fetch begun at the tap missed that window
// (the line dropped in 1 of 2 runs). loadPacketStrings caches the promise, so the print reads it at once; it
// never rejects, and a failed fetch is retried by the print. 48 KB gzipped, once per page.
onMounted(() => {
  const prefetch = () => import('@map/packet/packetStrings.js').then(({ loadPacketStrings }) => loadPacketStrings(resolveAssetsBase(profileConfig?.value))).catch(() => {})
  if (typeof window !== 'undefined' && window.requestIdleCallback) window.requestIdleCallback(prefetch, { timeout: 8000 }); else setTimeout(prefetch, 2000)
})

onMounted(() => {
  announceInfoPending(true)
  window.addEventListener('dxmaps:mapinfo-host', reannounceInfoPending)
})
onBeforeUnmount(() => {
  window.removeEventListener('dxmaps:mapinfo-host', reannounceInfoPending)
  if (!appReady.value) announceInfoPending(false)
})

onMounted(async () => {
  // uiStore.init() registers the page-level ResizeObserver that drives
  // updateBreakpoint() — without this, breakpoint stays at default 'desktop'
  // and uiStore.isMobile is permanently false even on mobile devices, so
  // any code branching on isMobile (LegendDesktop's internal LegendMobile
  // mount, mobile-only feature gates, etc.) runs the desktop path.
  // The CSS @media path on .rm-legend-mobile-slot still works either way,
  // but isMobile-driven branches don't.
  uiStore.init?.()
  activeTabId.value = tabs.value[0]?.id ?? 'doxa-regions'
  if (uiStore.isMobile) uiStore.collapseLegend?.()
  else uiStore.openLegend?.()
  // Container-scale: set CSS vars now + observe future resizes.
  if (rmRoot.value) {
    applyContainerScale(rmRoot.value.getBoundingClientRect().width)
    if (typeof ResizeObserver !== 'undefined') {
      _containerObserver = new ResizeObserver(entries => {
        for (const entry of entries) applyContainerScale(entry.contentRect.width)
      })
      _containerObserver.observe(rmRoot.value)
    }
  }
  // First tab ("Prayer") visible at the LEFT on mount — no auto-scroll-to-end.
  // User explicitly preferred this over the previous "scroll-to-end" default
  // (UX 2026-04-27). The active-tab scrollIntoView watcher above still keeps
  // tapped tabs visible if the bar overflows.
  window.addEventListener('doxa:legend-row-click', onLegendRowClick)
  window.addEventListener('legend:highlight', onLegendHighlight)

  const dataPromise = mapData.loadData().catch(err => {
    console.error('[research-map] data load failed:', err)
    return { normalizedPeopleGroups: [] }
  })
  // ★ A PANE RELEASED WHILE ITS MAP IS STILL STARTING IS A CANCEL, NOT A FAILURE. When the reader
  // switches tab, the gallery releases this element. initializeMap then returns SILENTLY (see
  // useMapInstance's liveness checks) and leaves map.value null. This handler reported that as "Map
  // failed to initialize — check token and container", so a console ERROR landed in whichever tab was
  // open by then and blamed the token for a tab switch (measured 2026-09-29, a phone in Arabic,
  // 2 runs in 3). The pane is gone, so nobody is waiting for a map: return quietly.
  const released = () => !mapContainer.value || !mapContainer.value.isConnected
  try {
    await initializeMap()
  } catch (err) {
    if (released()) return
    // `new mapboxgl.Map()` throws outright when the device has no WebGL context.
    console.error('[research-map] Map failed to initialize —', err)
    mapError.value = String(err?.message || err)
    return
  }
  if (released()) return
  // Keep the Mapbox Map OUT of Vue's reactive Proxy. useMapInstance holds it in a plain
  // ref() (deep-reactive): every internal read/write inside Mapbox then pays the Proxy
  // get/set trap, and a render scheduled through the Proxy (any map.value.* call →
  // triggerRepaint, re-scheduling itself until the map idles) draws whole frames through
  // it. Measured (internal/long-frames-probe.mjs --profile): Vue's `get`/`set` traps were
  // the two top self-time frames of the IDLE research map. Swap the raw instance back into
  // the shared ref, marked raw so it is never re-wrapped. The ref must pass through null
  // first: a ref compares against the RAW value it already holds, so re-assigning
  // markRaw(toRaw(map.value)) alone is a no-op and the Proxy stays (verified against Vue
  // 3.5). Synchronous — nothing renders in between. Proper home: `shallowRef(null)` in
  // useMapInstance.js — then this is a no-op.
  {
    const raw = map.value ? toRaw(map.value) : null
    if (raw && raw !== map.value) { map.value = null; map.value = markRaw(raw) }
  }
  if (!map.value) {
    // The code has already concluded the map is dead — say so instead of leaving
    // the loading line up, which is indistinguishable from "still loading".
    // The console line stays English: it is for whoever is debugging. What the READER sees comes
    // from the catalogue, and says what to do rather than naming the internals that failed.
    console.error('[research-map] Map failed to initialize — check token and container')
    mapError.value = t('dashboard.map_init_failed')
    return
  }
  map.value.once('style.load', async () => {
    try {
      const { normalizedPeopleGroups } = await dataPromise
      await onMapReady(normalizedPeopleGroups)
    } catch (err) {
      console.error('[research-map] onMapReady failed:', err)
      mapError.value = String(err?.message || err)
    }
  })
  // See _syncScrollZoomToHost above (BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID, mobile pair).
  _syncScrollZoomToHost(map.value)
  _resyncScrollZoom = () => _syncScrollZoomToHost(map.value)
  try {
    _scrollZoomObserver = new ResizeObserver(_resyncScrollZoom)
    const host = (map.value.getContainer && map.value.getContainer()) || null
    if (host) _scrollZoomObserver.observe(host)
    const port = host ? findScrollportAncestor(host) : null
    if (port) _scrollZoomObserver.observe(port)
    if (document.body) _scrollZoomObserver.observe(document.body)
  } catch (_) { /* no ResizeObserver: the initial call above still answers for a static page */ }
  window.addEventListener('resize', _resyncScrollZoom)
})

// ★ THE MAP IS TORN DOWN NO MATTER WHAT ELSE FAILS. heap snapshots (leak-722ac7789) found
// every unmounted research map still alive, held by window.__doxaLogoOwner -> Map -> div.rm-map-canvas
// -> ShadowRoot -> app, and that global is released only when the map's 'remove' event fires. So a
// single throw anywhere in this hook stranded the entire application in memory, one copy per mount.
// Two of the steps below were unguarded calls into other composables, which is a dependency on other
// people's code never changing shape — the same assumption that made legend.rows return undefined.
// Each step is now isolated, and destroy() runs from a finally so it cannot be skipped. The globals
// this component owns are dropped here too: whoever sets a window key is responsible for unsetting
// it, and setup is not the place to assume an unmount will be tidy.
onBeforeUnmount(() => {
  const step = (fn) => { try { fn() } catch (err) { console.warn('[research-map] teardown step failed', err) } }
  try {
    step(() => window.removeEventListener('doxa:legend-row-click', onLegendRowClick))
    step(() => window.removeEventListener('legend:highlight', onLegendHighlight))
    step(() => { if (_containerObserver) { _containerObserver.disconnect(); _containerObserver = null } })
    step(() => { if (_scrollZoomObserver) { _scrollZoomObserver.disconnect(); _scrollZoomObserver = null } })
    step(() => { if (_resyncScrollZoom) { window.removeEventListener('resize', _resyncScrollZoom); _resyncScrollZoom = null } })
    step(() => mapLayers.stopPrayerGlow?.())
    step(() => mapLayers.cleanup?.())
    step(() => clustering.cleanup?.())
    step(() => selectedPin.cleanup?.())
    step(() => mapStore.unregisterMap?.(mapId))
    // Every verify hook this component plants is an arrow closing over it, so each one left behind
    // keeps the component, its shadow root and the whole app alive (leak-722ac7789). They are
    // released as a set: they are installed as a set, and releasing three of four leaks just as much
    // as releasing none. Each is checked before deleting so a later mount's hook is never removed.
    // Written out one per line, not looped over an array of names, SO THE CHECK CAN READ IT.
    // check-window-globals-released matches `delete window.__x`; a computed `delete window[k]` is
    // invisible to it, and a release a checker cannot see is worth as much as no release at all the
    // day someone deletes three of the four. Legibility to the tool is the point here, not brevity.
    // Identity-checked: release only the hooks THIS instance installed, so unmounting one map on a
    // two-map page cannot strip the hooks of the one still running. Written one key per line, not
    // looped, so check-window-globals-released can read both the delete and the comparison.
    step(() => {
      if (typeof window === 'undefined') return
      if (window.__researchMapFilterState === _hookFilterState) delete window.__researchMapFilterState
      if (window.__researchMapPinOpacity === _hookPinOpacity) delete window.__researchMapPinOpacity
      if (window.__researchMapClusterDraw === _hookClusterDraw) delete window.__researchMapClusterDraw
      if (window.__researchMapVocabulary === _hookVocabulary) delete window.__researchMapVocabulary
    })
  } finally {
    destroy()
  }
})
</script>

<template>
  <div ref="rmRoot" :class="['rm-root', { 'rm-dark': isDark, 'dsm-dark': isDark }]">
    <MapPrintProgress :visible="posterBusy" :kind="exportPosterLabel" :title="printTitle" :progress="printProgress" />
    <!-- 10-tab bar -->
    <div v-if="showTabBar" ref="tabBar" class="rm-tab-bar">
      <template v-for="tab in tabs" :key="tab.id">
        <button
          class="rm-tab"
          :class="{ active: activeTabId === tab.id }"
          @click="switchTab(tab.id)"
        >{{ tabLabel(tab) }}</button>
        <div v-if="tab.sepAfter" class="rm-tab-sep" aria-hidden="true" />
      </template>
    </div>

    <div class="rm-map-area">
      <div v-if="!appReady && !mapError" class="rm-loading">{{ T('dashboard.map_loading', 'Research map loading…') }}</div>
      <div v-if="mapError" class="rm-error">{{ T('allPeopleGroups.loadError', 'The map could not be loaded.') }} {{ mapError }}</div>
      <div ref="mapContainer" class="rm-map-canvas" />
      <div class="map-scroll-edge map-scroll-edge--left" />
      <div class="map-scroll-edge map-scroll-edge--right" />

      <!-- Engine badge (bottom-left) — shows which GL engine rendered this map. -->
      <!-- Provider badge only when the engine is NOT Mapbox: Mapbox already renders its own
           wordmark bottom-left, and two badges there read as a bug (reported 2026-09-16). -->
      <div v-if="mapProvider !== 'mapbox'" class="rm-provider-badge" :data-provider="mapProvider">{{ mapProviderName }}</div>

      <!-- "RESEARCH" corner badge removed per qa.md R5 status flag (2026-04-27).
           Style class .rm-badge kept in shadow CSS in case future tabs want it. -->

      <!-- Geocoder search bar (top-left) — canonical clone from read-only
           simple-map mfe so tabs 1-3 stay visually identical. -->
      <GeocoderComponent
        ref="geocoderRef"
        v-if="appReady && map && hasGeocoder"
        :map-instance="map"
        :access-token="mapboxToken"
        :provider="mapProvider"
        :data-source-id="dataSource"
        :is-dark="isDark"
        :placeholder="geocoderPlaceholder"
        :active-context="geocoderContext"
        @people-group-result="onPeopleGroupResult"
        @aggregate-result="onAggregateResult"
        @clear="onClear"
      />

      <!-- Hamburger menu trigger — feature-flagged OFF per UX 2026-04-27. -->
      <HamburgerButton
        v-if="FEATURES.hamburgerMenu && appReady && map"
        :map="map"
        :is-open="showSideMenu"
        :is-dark="isDark"
        @toggle="showSideMenu = !showSideMenu"
      />

      <!-- Map toolbar (right rail) — canonical button set + ordering. -->
      <MapToolbar v-if="appReady && map" :has-geocoder="hasGeocoder">
        <!-- The TOP control is "What can this map do?". It opens the gallery's MapInfo for this tab, which
             then hides its own floating button. It renders only where a MapInfo answers it, so a standalone
             page (DX Life's research page, the leaf) has no dead button. -->
        <MapInfoButton     :is-dark="isDark" />
        <ZoomInButton      :map="map"          :is-dark="isDark" />
        <ZoomOutButton     :map="map"          :is-dark="isDark" />
        <LocationButton    :map="map"          :is-dark="isDark" />
        <FullscreenButton  :map-container="mapContainer" :is-dark="isDark" />
        <ThemeToggleButton :is-dark="isDark"    @toggle="handleToggleTheme" />
        <!-- EXPORT, ONE CLICK, ALWAYS VISIBLE (BUILD-SIMPLE-RESEARCH-EXPORT-ZERO-CLICK). The only
             export control used to live in the side drawer's footer, which is CLOSED by default
             (translated off-screen), so a file took two clicks at best — and then nothing arrived.
             This control sits in the toolbar every reader sees and exports the current view as a
             print poster on the first click; busy while it renders, so a second click cannot
             double-fire. -->
        <MapControlButton  :is-dark="isDark" :active="posterBusy" :disabled="posterBusy"
          :title="exportPosterLabel" class="export-poster-btn" :aria-busy="posterBusy ? 'true' : 'false'"
          @click="openPoster">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
        </MapControlButton>
        <!-- Share button hidden behind FEATURES.share (glitch — PR gate). All
             ShareButton code kept warm; flip FEATURES.share=true to restore. -->
        <ShareButton       v-if="FEATURES.share" :is-dark="isDark" :embed-path="'doxa-research-map/research-map/index.html'" />
      </MapToolbar>

      <!-- Fly + Clusters floating toolbar — sibling of the legend card, mounted
           between MapToolbar and the side menu so its CSS namespace doesn't
           collide with anything. The component's own internal predicate
           (showAutoFlyButton) limits rendering to doxa-regions / language-family
           tabs, so this can stay declared unconditionally besides appReady. -->
      <LegendTools
        v-if="appReady && showLegendTools"
        :legend-type="activeLegendType"
        :is-dark="isDark"
      />

      <!-- Side-menu drawer (filter, cluster toggle, poster button) -->
      <ResearchMapSideMenu
        v-if="appReady"
        :is-open="showSideMenu"
        @close="showSideMenu = false"
        @open-poster="openPoster"
      >
        <ResearchMapFilterPanel />
      </ResearchMapSideMenu>

      <!-- Legend — ALL tabs render through SemanticTreeLegend. Flat tabs
           (prayer/adoption/engagement/religion) pass hideTabs to suppress the
           inner tab strip. LegendDesktop only renders for the people-group
           detail panel (pin click → PeopleGroupDetail swap). -->
      <div class="rm-legend-desktop-slot" :style="legendTopVar ? { '--stl-top': legendTopVar } : null">
        <LegendDesktop
          v-if="appReady && uiStore.legendMode === 'detail' && uiStore.selectedPeopleGroup"
          :legend-type="activeLegendType"
          :popup-action="activePopupAction"
          :initially-collapsed="false"
          :is-dark="isDark"
        />
        <div v-show="!(uiStore.legendMode === 'detail' && uiStore.selectedPeopleGroup)">
          <SemanticTreeLegend
            v-if="appReady"
            :nodes="legendNodes"
            :tabs="legendInnerTabs"
            :title="legendTitle"
            :hideTabs="legendHideTabs"
            :columnLabel="legendColumnLabel"
            :progress="legendProgress"
            :open="_stlOpen"
            :export-enabled="EXPORT_FEATURE_ENABLED"
            @select="onSemanticTreeSelect"
            @export="onExport"
            @update:open="_onStlOpenChange"
          />
        </div>
      </div>
      <div class="rm-legend-mobile-slot">
        <LegendMobile
          v-if="appReady"
          :legend-type="activeLegendType"
          :popup-action="activePopupAction"
          :is-dark="isDark"
        />
      </div>

      <!-- People-group detail (opens on pin click via mapStore.selectedFeature) -->
      <PeopleGroupDetail
        v-if="appReady && selectedFeature"
        :feature="selectedFeature"
        :action="activePopupAction"
        :dark="isDark"
        @close="mapStore.selectFeature(null)"
      />

    </div>
  </div>
</template>
