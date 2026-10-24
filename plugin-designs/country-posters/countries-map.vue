<script setup>
/**
 * countries-map.vue — Application Profile: COUNTRIES MAP
 *
 * @element country-posters-map
 * @description The researcher's workbench retargeted from people groups to COUNTRIES — region
 *   polygons, region colours, the shared legend and 3-tier tree, clustering, geocoder search and
 *   the detail panel, all inherited by cloning research-map.vue rather than re-implementing it.
 *   Pane 1 of the country-posters bundle; pane 2 is the collapsible poster wall.
 *
 * ★ WHY THIS TAG EXISTS (added 2026-09-22). Without an `@description` the generator emits an
 * EMPTY description into manifest.json, and the cap-5 SPA then labels the tab with its generic
 * fallback — "experimental bundle". country-posters was the only bundle in the rail showing that
 * placeholder, so a Doxa inheritor browsing the app met a nameless tile. The prose header below
 * was always here; the generator reads the TAG, not the prose.
 *
 * A CLONE of research-map.vue (the researcher's workbench), identical in every
 * respect except THREE country-first parameters. This file is deliberately not a
 * re-implementation: reusing the profile verbatim is what gives this map the
 * region polygons, the region colors, the scroll-edge accessibility strips, the
 * geocoder, the clustering, the detail panel and the 3-tier tree for free.
 *
 * It reuses the region polygons, the region colours, the same legend and the same code as the regions
 * application profile, parameterized only so the default tab is the countries tab.
 *
 * THE THREE DIFFERENCES (search "COUNTRIES-MAP DIFFERENCE" to find them):
 *   1. The WAGF Regions tab is RELABELED "Countries" — same doxaRegion strategy,
 *      same doxa-regions legend, same polygons.
 *   2. activeTabId boots to 'doxa-regions' instead of falling through to Prayer.
 *   3. The legend's inner tier boots to 2 (Country) rather than 0 (Region).
 *
 * Everything else — the 7 tabs, clustering, fly-to, multi-field filters, the
 * Region→Block→Country tree from useWagfRegionsLegendData, the poster pipeline —
 * is inherited unchanged. When research-map gains a fix, re-clone and re-apply
 * these three edits rather than porting by hand.
 *
 * A PREVIOUS ATTEMPT AT THIS FILE was a 270-line hand-rolled map with its own
 * color strategy and its own 2-tier tree. It built and mounted, but it had no
 * scroll-edge strips, no country polygons and none of the workbench — because
 * imitation means CLONING THE PROFILE, not re-deriving its behaviour.
 *
 * profile-config shape:
 *   { "profile": "countries-map", "tk": "pk...", "dataSource": "pray-tools",
 *     "instanceId": "any-stable-id" }
 * Tabs are baked in — edit the ALL_TABS constant in this file to change them.
 */

import { inject, provide, ref, computed, onMounted, onBeforeUnmount, watch, markRaw, nextTick, toRef } from 'vue'
import { retryableAsyncComponent } from '@map/composables/retryableAsyncComponent.js'

// ─── Composables (framework) ─────────────────────────────────────────────────
import { useMapInstance }  from '@map/composables/useMapInstance.js'
// The SAME dataset the poster wall renders from, so a country's bbox has one source of truth
// rather than being copied through an attribute. Already in this bundle -- the wall imports it too.
import posterData from '@map/data/country-posters.json'
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
import { createPeopleGroupRecords } from '@map/lists/peopleGroupRecords.js'
import { experimentalExportsOn } from '@map/print/experimentalExports.js'
import { getApiBaseUrl } from '@map/api/apiBaseUrl.js'

// Shared data pipeline — lives in the library (@map/composables/useMapData.js).
import { useMapData }      from '@map/composables/useMapData.js'
import { useGeocoderSearch } from '@map/composables/useGeocoderSearch.js'

// PERF: useMapClustering pulls in MSTClusteringUtil + NetworkClusteringUtil +
// ClusterHelpers (~30 KB total). Clusters are off by default — defer the
// import + instantiation until the user toggles them on. See `getClustering()`
// below.

// PERF: useMapPoster pulls in the tile-stitch + PDF composition pipeline
// (~117 KB). It's only needed when the user opens the poster dialog. Defer
// the import until that happens — see `openPoster()` below.
let _posterPromise = null


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
function loadPoster() {
  if (!_posterPromise) {
    _posterPromise = import('@map/composables/poster/useMapPoster.js')
      // useMapPoster(getSourceMap) takes the map ACCESSOR, not an options object
      .then(m => m.useMapPoster(() => map.value))
  }
  return _posterPromise
}

// Shared legend pipeline — lives in the library (@map/composables/legends/useLegendData.js).
import { useLegendData }   from '@map/composables/legends/useLegendData.js'

// ─── Config + utils ──────────────────────────────────────────────────────────
import { mapDefaults }            from '@map/constants/mapDefaults.js'
import { getColorStrategy }       from '@map/colors/_registry.js'
import { RELIGION_FAMILIES, religionFamilyLabel } from '@map/colors/religion.js'
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
import HelpButton        from '@map/components/map-controls/HelpButton.vue'
import GeocoderComponent from '@map/components/map-controls/GeocoderComponent.vue'
import { resolveMapProvider, setProjectionOn } from '@map/composables/useMapProvider.js'
import ShareButton       from '@map/components/map-controls/ShareButton.vue'
import MapControlButton  from '@map/components/map-controls/MapControlButton.vue'

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

// PERF: PosterDialog only renders when the user opens the poster export
// flow. Async-import it so the dialog's deps don't load on every map boot.
const PosterDialog = retryableAsyncComponent(() => import('@map/components/poster/PosterDialog.vue'))

// ─── Shadow-DOM style injection ──────────────────────────────────────────────
// Labelled 'countries-map', its own name. This file began as a fork of research-map.vue and kept that
// file's label; a shared label lets whichever mounts last overwrite the other's sheet
// (check:shadow-style-labels-unique).
useShadowStyles(`
  /* ── Canonical geocoder + legend container CSS (clone of doxa-simple-map.vue
       lines 50-138) so tabs 1-3 render the geocoder + legend at the same
       400/360/280 px responsive widths the simple-map mfe uses. The
       --map-legend-width / --map-btn-size / --map-toolbar-gap / --map-font-md
       / --map-font-sm CSS vars are set by applyContainerScale() below. ── */
  /* Geocoder column matches the SemanticTreeLegend's .stl-panel — 8px from the START edge (logical, so it
     moves right under ar with the legend; a physical left:8px kept it left),
     width:380px — so the search bar and the legend stack as one column at
     the same x-edge (PPLR alignment). */
  /* Both engines' container class: MapLibre names it .maplibregl-ctrl-top-left, and with only the Mapbox
     selector the column got no position or width at all under MapLibre. */
  .mapboxgl-ctrl-top-left, .maplibregl-ctrl-top-left { top:12px!important;inset-inline-start:8px!important;width:380px!important;max-width:380px!important;z-index:1200!important; }
  .mapboxgl-ctrl-top-left .mapboxgl-ctrl, .maplibregl-ctrl-top-left .maplibregl-ctrl { margin:0!important;float:none!important; }
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
    .mapboxgl-ctrl-top-left, .maplibregl-ctrl-top-left { top:10px!important;left:3px!important;right:3px!important;width:calc(100% - 6px)!important;max-width:none!important; }
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
     elements like the site nav / hamburger menu (the geocoder pill once
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
    border-bottom:1px solid rgba(0,0,0,0.12);
    height:44px;
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
    gap:var(--spacing-3xl,28px);
    z-index:10;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;
    font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  }
  .rm-tab-bar::-webkit-scrollbar{display:none;width:0;height:0;}
  .rm-dark .rm-tab-bar { background:#2a332a;border-bottom-color:rgba(255,255,255,0.10); }
  /* Tab text on the WHITE bar: muted grey, darkening to the Material accent when
     active (was beige #F3F3F1 / #cbc5b9 for the old green bar — unreadable on white). */
  .rm-tab {
    background:none;border:none;padding:0;height:100%;
    font-family:inherit;
    font-size:14px;font-weight:500;
    color:#5f6368;
    cursor:pointer;
    border-bottom:2px solid transparent;
    white-space:nowrap;
    transition:color .12s,border-color .12s,background .12s;
  }
  .rm-tab:hover { color:#202124; }
  .rm-tab.active { color:#1a73e8;border-bottom-color:#1a73e8;font-weight:600; }
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
  .rm-dark .rm-tab { color:rgba(243,243,241,0.85); }
  .rm-dark .rm-tab:hover { color:#F3F3F1; }
  .rm-dark .rm-tab.active { color:#cbc5b9;border-bottom-color:#cbc5b9; }
  @media(max-width:767px){
    .rm-tab-bar { padding-inline:16px; scroll-padding-inline:16px; gap:16px; height:40px; }
    .rm-tab { font-size:13px; }
  }
  .rm-map-area { flex:1 1 0;position:relative;overflow:hidden; }
  .rm-map-canvas { position:absolute;inset:0; }
  /* MATERIAL LIGHT (2026-09-21). Was background #0f1216 / color #7c8cf8 — the FOURTH member of a
     family of identical unconditional loading overlays (.dsm-loading, .apg-loading, and the same
     rule in doxa-research-map). Each renders on EVERY load via v-if="!appReady", so a near-black
     flash was the first thing every visitor saw. Palette: surface #f3f3f1, muted #6d766e. */
  .rm-loading { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#f3f3f1;color:#6d766e;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;z-index:5; }
  /* Failure state, NOT a cover: modelled on cities-internet's .gm-err so anything the
     map did manage to render stays visible around it. A spinner that outlives the
     failure reads as "slow" and the user just waits; this says the map is gone. */
  .rm-error { position:absolute;top:50%;left:12px;right:12px;z-index:7;transform:translateY(-50%);text-align:center;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fecaca;background:rgba(15,18,22,.95);border:1px solid rgba(254,202,202,.28);border-radius:10px;padding:12px 14px;box-shadow:0 2px 10px rgba(0,0,0,.4); }
  .rm-badge { position:absolute;top:10px;right:10px;background:rgba(124,140,248,0.12);color:#7c8cf8;border:1px solid rgba(124,140,248,0.3);padding:3px 9px;border-radius:4px;font-size:11px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:none;z-index:50; }
  /* Mobile-only legend slot — desktop hides via @media */
  .rm-legend-mobile-slot { display:none; }
  @media(max-width:767px){
    .rm-legend-mobile-slot { display:block; }
    .rm-legend-desktop-slot { display:none; }
  }
  .map-scroll-edge { position:absolute;top:0;bottom:0;width:40px;z-index:2;touch-action:pan-y;pointer-events:auto;background:transparent; }
  .map-scroll-edge--left { left:0; }
  .map-scroll-edge--right { right:0; }
`, 'countries-map')

// ─── Config from ProfileLoader (provide/inject — never direct imports) ──────
const profileConfig = inject('profileConfig')

// ── SEARCH BAR IS MAPBOX-ONLY, AND ITS ABSENCE MUST NOT LEAVE A HOLE ─────────
// Same contract as doxa-research-map (the reference implementation), deliberately copied rather
// than re-invented. Decided 2026-09-24: the geocoder is DEFERRED to Mapbox, because
// GeocoderComponent's maplibre path still calls makeMapboxForwardGeocode(accessToken) — the search
// REQUEST goes to Mapbox whichever engine draws the tiles, so a keyless map with a search bar is
// not keyless and would bill the very key the maplibre option exists to avoid.
// MEASURED here before the change, built tree, both engines: the bar rendered at y=12 under mapbox
// and STILL rendered (y=0) under maplibre, with the legend pinned at 60 either way.
const cpMapProvider = resolveMapProvider(profileConfig)
const hasGeocoder = computed(() => {
  if (profileConfig?.value?.search === false) return false
  return cpMapProvider === 'mapbox'
})
// SemanticTreeLegend's --stl-top defaults to 60px, and that 60px exists ONLY to reserve room for a
// search bar above it. With no bar the legend must RISE into the vacated space instead of leaving a
// dead band — a requirement, not a preference. 14px matches the reference.
// How far the legend may rise depends on WHAT ELSE is in the strip the search bar vacated.
// LegendTools sits at top:14px on the tabs its predicate allows, so raising the legend to 14 there
// prints the toolbar across the legend's header — MEASURED on country-posters. Ask the toolbar's own
// exported predicate rather than re-typing its condition here, and stop just below it when it shows.
// A collision is worse than the gap this is meant to close, and 56px still recovers most of it.
const legendTopVar = computed(() => {
  if (hasGeocoder.value) return null
  return showsFlyTools(activeLegendType?.value ?? activeLegendType) ? '56px' : '14px'
})
const mapboxToken   = inject('mapboxToken')
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
  // The map-level ShareButton is GONE, not flagged off — country-posters-mfe.vue's
  // header owns sharing for this bundle. See the note at its former site in the
  // toolbar. This flag is kept only so the FEATURES shape stays stable for any
  // other consumer reading it.
  share:          false,
  hamburgerMenu:  false,  // canonical default — emit/listen mismatch + drawer surplus
  // Per QA building-round-1 R3 A4: clear the geocoder text on tab switch by
  // default; flip to true to preserve the previous tab's query when returning.
  geocoderPersistAcrossTabs: false
}

// ═══ THE COUNTRY APP IS **ONE** NESTED APPLICATION PROFILE ═══════════════════
//
// research-map.vue ships SEVEN tabs, and each tab IS a nested application profile
// (a colorStrategy + a legend type + its own tree). The country app needs exactly
// ONE of them — the WAGF Regions profile — and none of the other six.
//
// The countries app needs only the regions application profile, not every research-map tab: no tab bar,
// the regions tab reused, its legend opening on the countries tier.
//
// So ALL_TABS holds that ONE profile, and showTabBar is false — a tab bar with a
// single tab is chrome that does nothing. Everything else about the profile is
// inherited from research-map verbatim: the doxaRegion colors, the doxa-regions
// legend, the region polygons, the Region→Block→Country tree, the scroll-edge
// strips, the geocoder, the detail panel.
//
// The label is "Countries" rather than "Regions" because on this profile the
// country tier is the subject. i18nKey is dropped so the literal label wins
// instead of resolving back to the translated "Regions".
const ALL_TABS = [
  { id: 'doxa-regions', label: 'Countries', colorStrategy: 'doxaRegion', legend: 'doxa-regions', popup: 'pray', feature: 'doxaRegions' },
]
const TABS = ALL_TABS.filter(t => !t.feature || FEATURES[t.feature])
const tabs       = computed(() => TABS)
// NO TAB BAR. One profile, so there is nothing to switch between.
const showTabBar = computed(() => false)

// COUNTRIES-MAP DIFFERENCE #2 — boot on the Countries tab, not Prayer.
// ONE constant drives both places the opening tab is decided: this ref AND the
// onMounted initializer further down (which research-map hardcodes to tabs[0] and
// which runs LAST — so setting only the ref looks right in source and still boots
// on Prayer). Change the tab here and nowhere else.
const DEFAULT_TAB_ID = 'doxa-regions'   // the Countries tab
const activeTabId = ref(DEFAULT_TAB_ID)
const activeTab   = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? tabs.value[0])
const activeLegendType = computed(() => activeTab.value?.legend ?? 'default')
const activePopupAction = computed(() => activeTab.value?.popup ?? 'pray')

// Per-tab geocoder placeholder. The Language Families tab makes the search
// scope explicit ("Search language family, language, dialect/variety") so users
// know the search is wired to the legend's hierarchy. Other tabs use the
// default i18n placeholder ("Search people, place, language, religion").
const geocoderPlaceholder = computed(() => {
  if (activeTab.value?.id === 'language-families') {
    return 'Search language family, language, dialect/variety'
  }
  if (activeTab.value?.id === 'affinity-blocks') {
    return 'Search affinity bloc, cluster, people group'
  }
  if (activeTab.value?.id === 'doxa-regions') {
    return t('search.placeholderRegions')     // the one tab this profile mounts: localized
  }
  if (activeTab.value?.id === 'religion') {
    return 'Search religion, people group'
  }
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
  const btn = tabBar.value?.querySelector('.rm-tab.active')
  btn?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' })
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

// regionIdle (a region paint's idle value, kept DATA-DRIVEN) is the library's: useLegendMapBridge.js exports
// it and documents why, and every map paints idle with that one expression rather than its own copy.

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
provide('legendRows', legend.items)   // useLegendData returns `items` (there is no `rows`)
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

// ── legend ↔ map bridge (shared with doxa-research-map) ──────────────────────
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
// COUNTRIES-MAP DIFFERENCE #3 — boot the legend on the COUNTRY tier.
// REGIONS_TABS = [region(0), block(1), country(2)], so 2 is the Country tier.
// research-map boots doxa-regions on Region(0); this profile lands users on the
// country-level view they came for.
// The map opens on the COUNTRY level of the semantic-tree legend, not on its regions.
pplrInstance.activeTab.value = 2
function _defaultInnerTabForLegendType(t) {
  if (t === 'doxa-regions') return 2   // Country — the countries-map default tier
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
const LANG_TABS = [
  { id: 'family',   label: 'Lang Family',
    info: 'A language family is a group of languages descended from a common ancestor (e.g. Indo-European, Afro-Asiatic).' },
  { id: 'language', label: 'Language',
    info: 'A language is a system of communication used by a people (e.g. Arabic, Bengali, Hindi).' },
  { id: 'dialect',  label: 'Dialect/Variety',
    info: 'A dialect/variety is a regional or social form of a language (e.g. Arabic, Sudanese; Pakistan Sign Language).' },
]

// Affinity-block tab — mirrors PPLR's pplr-rop-tree.vue hierarchy (Affinity Block → Cluster → PG).
const { affinityTree } = useAffinityBlockLegendData(_langPgRef)
const AFFINITY_TABS = [
  { id: 'bloc',    label: 'Affinity Block',
    info: 'Affinity Block (field: rop1) — broadest grouping by cultural/linguistic/geographic kinship. 16 blocks total. Examples: Malay Peoples, South Asian Peoples, Deaf, Arab World.' },
  { id: 'cluster', label: 'Cluster',
    info: 'Cluster (field: imb_reg_of_people_2, ROP 2) — finer-grained grouping inside a bloc. 194 clusters total. Suffix "(Cluster)" appears on each row to distinguish from PG/PGIC. Example: Borneo-Kalimantan within Malay Peoples.' },
  { id: 'group',   label: 'People Group',
    info: 'People Group (field: imb_reg_of_people_25, ROP 2.5) — abstract ethnolinguistic identity, country-agnostic. Suffix "(PG)" on each row. 1,736 PGs total; 131 of them have rows in multiple countries (e.g. Deaf in 123 countries). Example: Abai Sungai (PG) is one ROP25 code regardless of where its people live.' },
  { id: 'pgic',    label: 'PG in Country',
    info: 'PGIC = People Group In Country (field: imb_reg_of_people_3 + country_code) — one row per (people group, country) pair. Suffix "(PGIC)" on each row. 2,106 rows total. Example: "Abai Sungai, Malaysia (PGIC)" is the Abai Sungai PG specifically as it exists in Malaysia.' },
]

// WAGF Regions tab — Region → Block → Country (3-tier). Each region has a unique color;
// selecting a region, block, or country dims/filters pins to that geographic scope and
// highlights the matching country polygons on the map.
const { regionsTree } = useWagfRegionsLegendData(_langPgRef)
const REGIONS_TABS = [
  { id: 'region',  label: 'WAGF Region',
    info: 'WAGF macro-region (e.g. "Asia", "Africa"). Color-coded on the map.' },
  { id: 'block',   label: 'WAGF Bloc',
    info: 'WAGF bloc — the organizational sub-grouping within each region (e.g. "South East Asia", "West Africa").' },
  { id: 'country', label: 'Country',
    info: 'Individual countries, listed by unreached-population size within their bloc.' },
]

// Flat legend data for prayer/adoption/engagement/religion tabs — converted to
// STL-compatible tree nodes so ALL tabs render through the same SemanticTreeLegend.
const flatLegend = useFlatLegendData(toRef(() => activeLegendType.value), RESEARCH_LEGEND_OPTIONS)
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
// The SAME export handler the desktop legend gets via @export, reaching the mobile sheet the
// same way @select does. Without it <LegendMobile>'s embedded SemanticTreeLegend rendered with
// exportEnabled defaulting to FALSE, so a phone reader could browse the countries and had no
// way to export a poster or a packet — measured 2026-09-24, the same gap fixed on
// my-upg-100-list, with the same two causes (no export wiring, and no :tabs so there was no
// selectable row to export in the first place).
// ⚠ RESPECTS EXPORT_FEATURE_ENABLED. The desktop passes :export-enabled="EXPORT_FEATURE_ENABLED",
// so providing unconditionally would give the phone an affordance the desktop deliberately
// hides whenever that flag is off.
provide('onLegendExport', EXPORT_FEATURE_ENABLED ? onExport : null)
// ★ EXPERIMENTAL ROLLOUT of the print standard on this map's legend (library/print/experimentalExports.js):
// the card deck for a selection shows only while the shared switch is on. This map pane is not one of the
// production print surfaces (those are the UPG 100 list, the Regions dashboard's country posters and the
// Country Posters wall), so the new export is flagged, and off restores the menu it had before.
const EXPERIMENTAL_EXPORTS = EXPORT_FEATURE_ENABLED && experimentalExportsOn(profileConfig)
provide('legendExportCards', EXPERIMENTAL_EXPORTS)
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
      setPinOpacity(m, null)
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
    setPinOpacity(m, null)
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
      // Dim via case expression — matched pins at 1.0, others at 0 (matches
      // applyDimFilter values).
      setPinOpacity(m, node.filter)
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
      setPinOpacity(m, null)
    }
    // Mirror region selection into mapStore (for geocoder / external sync).
    if (id.startsWith('region:')) mapStore.selectRegion?.(id.slice(7))
    // Highlight matching polygons using isoCodes (alpha-3) on iso_3166_1_alpha_3.
    // ★ NOT FOR region: ROWS. A region row also reaches selectRegion above -> the watcher ->
    // applyDimFilter, which paints from mapLayers.regionIsoMap: EVERY country in the region. node.isoCodes
    // comes from the legend's people-group walk, so it holds only countries WITH PINS; painting it too
    // left holes wherever a country has no group, depending on which writer ran last (upg100's drift
    // classification; research-map carries the same exemption). block: and country: rows keep painting
    // here, because nothing else paints them and the legend's list IS their scope.
    if (m && m.getLayer('regions-fill') && !id.startsWith('region:')) {
      const isoCodes = node.isoCodes || []
      if (isoCodes.length) {
        const isoArr = ['literal', isoCodes]
        m.setPaintProperty('regions-fill', 'fill-opacity', [
          'case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], 0.85, 0.15
        ])
        m.setPaintProperty('regions-border', 'line-color', [
          'case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], '#111827', 'rgba(60,60,80,0.15)'
        ])
        m.setPaintProperty('regions-border', 'line-width', [
          'case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], 2.5, 0.3
        ])
      } else {
        m.setPaintProperty('regions-fill', 'fill-opacity', regionIdle(0.7))
        m.setPaintProperty('regions-border', 'line-color', regionIdle('rgba(60,60,80,0.35)'))
        m.setPaintProperty('regions-border', 'line-width', regionIdle(0.6))
      }
    }
  }
}
// ── Pin opacity: ONE writer (the research-map pattern, applyPinOpacity) ─────────
// matchExpr dims to it (matched 1, others 0); null clears the dim. Two things it does that the 14 raw
// writes it replaces did not (a drift classification and a performance profile on research-map):
//  · READ BEFORE WRITE. One family click reached onSemanticTreeSelect AND the selectedFamily watcher ->
//    applyDimFilter, rewriting the same value 4+ times, each a per-feature re-upload. Compared as text
//    against the LIVE value (never a remembered one, which would go stale on a style reload).
//  · THE UNDIMMED VALUE IS DATA-DRIVEN (['case', ['has','uniqueId'], 1, 1]: every pin at 1, not one pixel
//    different). A constant 1 made the FIRST dim a one-off shader-variant compile mid-click; set once at
//    load, the compile happens then instead.
function setPinOpacity(m, matchExpr) {
  if (!m || !m.getLayer?.('language-family-pins')) return
  const value = matchExpr ? ['case', matchExpr, 1, 0] : ['case', ['has', 'uniqueId'], 1, 1]
  try {
    if (JSON.stringify(m.getPaintProperty('language-family-pins', 'circle-opacity')) === JSON.stringify(value)) return
    m.setPaintProperty('language-family-pins', 'circle-opacity', value)
    m.setPaintProperty('language-family-pins', 'circle-stroke-opacity', value)
    if (m.getLayer('language-family-pins-shadow')) m.setPaintProperty('language-family-pins-shadow', 'circle-opacity', value)
  } catch (_) { /* style still loading: the next call carries it */ }
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
const poster = ref(null)
async function openPoster() {
  if (!poster.value) poster.value = await loadPoster()
  showPoster.value = true
}

// ─── Export menu router (SemanticTreeLegend @export) ─────────────────────────
// EXPERIMENTAL — dormant behind the shared kill-switch (SHOW_EXPORT_BUTTON).
// The legend's Export menu emits 'export' with 'poster' | 'packet'.
// ⚠ THE KIND CARRIES ITS VARIANT ('packet:full' | 'packet:lightweight'), as the legend's packet submenu
// emits it. This compared against a bare 'packet', so the legend's Packet export on this map did nothing
// at all. Split first, exactly as upg-100-list's onLegendExport does.
function onExport(kind) {
  const [base, variant] = String(kind).split(':')
  if (base === 'poster') return openPoster()
  if (base === 'packet') return openPacket(variant === 'lightweight' ? 'lightweight' : 'full')
  if (base === 'cards' && EXPERIMENTAL_EXPORTS) return openPacket('cards')
}

// ─── Packet (printed through the shared renderer, like Simple Research's) ─────
// Defensive throughout: never throw uncaught into the UI; guard against double-run.
// The print standard's records provider for a selection on this map (one fetch per language).
const selectionRecords = createPeopleGroupRecords({
  apiBase: () => getApiBaseUrl(),
  lang: () => String(uiLocale.value || 'en').split('-')[0],
})
let _packetBusy = false
async function openPacket(variant = 'full') {
  if (_packetBusy) return
  _packetBusy = true
  try {
    // ★ THE PACKET PRINTS, AND IT PRINTS THROUGH THE SHARED RENDERER (product-lens audit card 2, and
    // the product rule: an export button opens the print dialog, never hands over a file). This
    // built a jsPDF document and downloaded packet.pdf while its poster sibling, two functions up,
    // already printed. The fix is NOT to wrap that PDF in a dialog — a PDF blob cannot go in the
    // <img> the in-place print frame uses, and every workaround (embed, object, the browser's own
    // viewer) prints on some engines and silently does nothing on others, which is the dead-button
    // class this file has already paid for twice.
    //
    // library/composables/usePosterPrints.js ALREADY has printPacket: the same pages, authored as HTML
    // with @page rules, printed in place. This map was running a private second implementation of a
    // shared product feature. Routing to it deletes the duplicate (jspdf itself stays: useMapPoster.toPdf
    // still brings it in for the poster, and the bundle grew with the HTML renderer), and
    // the packet gains the pages the shared renderer has that the local one never did (the life
    // calendar, the funnel, the prayer wheel — see packet-render.buildPacket's page order).
    const [{ usePosterPrints }, { defaultPosterSpec }, { useMapPoster }] = await Promise.all([
      import('@map/composables/usePosterPrints.js'),
      import('@map/constants/posterDefaults.js'),
      import('@map/composables/poster/useMapPoster.js'),
    ])

    // ★ THE PACKET IS THE SELECTION, not the first 50 loaded groups (a packet for "Asia" once printed Sudan).
    // library/maps/pin-selection.js reads the pins as DRAWN (their properties are derived: filled-in
    // language family, canonical region keys), so a row filter would pick a plausible WRONG subset.
    // This map has no dim expression, so the pins layer's own filter is the whole selection.
    const all = mapData.normalizedPeopleGroups.value || []
    let groups = all
    try {
      const { selectedPinIds } = await import('@map/maps/pin-selection.js')
      const m = map.value
      const filt = m && m.getLayer('language-family-pins') ? m.getFilter('language-family-pins') : null
      const ids = m ? selectedPinIds(m, { expressions: [filt].filter(Boolean) }) : null
      if (ids && ids.size) {
        const picked = all.filter((g) => ids.has(String(g.uniqueId ?? g.id ?? '')))
        // ids but no rows is an ID MISMATCH, not an empty selection: print everything and say so,
        // rather than a packet about nothing.
        if (picked.length) groups = picked
        else console.warn('[country-posters] packet: the selected pins matched no rows (id mismatch); printing the full list')
      } else if (ids) {
        groups = []   // a genuinely empty selection: the printer's own "no records" error says so
      }
    } catch (e) { console.warn('[country-posters] packet selection unavailable; printing the full list:', e?.message || e) }
    // Same 50-group cap as before: an overnight safety limit, not a design choice. The cover says so.
    const selectedTotal = groups.length
    if (groups.length > 50) groups = groups.slice(0, 50)

    // ★ AN EXPLICIT ADAPTER, because the two halves name the same fields differently and a mismatch
    // here is SILENT — the packet would print with blank names and empty photos rather than failing.
    // The renderer reads slug / name / population / religion / country_code, and usePosterPrints reads
    // image_url; this map's normalized rows carry country and imageUrl in camelCase. Mapped once, here,
    // where the difference is visible, rather than renaming either side's vocabulary.
    // ★ THE SELECTION'S RECORDS FROM THE PRINT STANDARD'S PROVIDER (lists/peopleGroupRecords.js), by
    // slug: every field the prints read (the country as ISO3 with its name beside it, the language and
    // reachedness the profile sentence is built from), in the reader's language. The rows mapped by hand
    // below put the country's NAME in country_code and carried no language, so every description ran
    // short; they remain only as the fallback when the API cannot be reached.
    let records = null
    try {
      const slugs = groups.map((g) => String(g.slug || '')).filter(Boolean)
      if (slugs.length) records = await selectionRecords({ type: 'pg_slugs', values: slugs })
    } catch (e) { console.warn('[country-posters] selection records unavailable; printing from the map rows:', e?.message || e) }
    if (!records || !records.length) records = groups.map((g) => ({
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
      country_code: g.countryIso || g.country_code || '',
      country_code_label: g.countryName || g.countryIsoLabel || g.country || '',
      image_url: g.imageUrl || g.image_url || '',
    }))

    // Page 1 keeps the LIVE map rather than a fetched poster: this half is the one that knows what is
    // currently on screen. The PNG this map already knows how to produce goes in as a data URL (the
    // print frame is a separate document; an object URL created here would be revoked out from under it)
    // through the composable's mapImage seam, which places it as the whole page.
    const spec = defaultPosterSpec({ widthIn: 8.27, heightIn: 11.69, dpi: 150, orientation: 'portrait' })
    spec.slots.title = { ...spec.slots.title, text: legendTitle.value || 'Doxa Map' }
    // ★ useLegendData returns `items`, not `rows`: `legend.rows` was undefined, so `|| []` handed the
    // renderer an empty list and this page printed its live map with no legend. Child tiers flattened in,
    // as research-map's poster does, so the printed legend names every band the map draws.
    const legendRows = (legend?.items?.value || [])
      .flatMap((it) => [it, ...(it.children || [])])
      .map((r) => ({ label: r.label, color: r.color }))
      .filter((r) => r.label)
    spec.slots.legend = { ...spec.slots.legend, rows: legendRows }
    // The live map, rasterised NOW (generated, not stored), becomes page 1 through the print standard's
    // mapImage seam, which places it as the whole page. It was handed over as a bare <img>, which the
    // page-1 layout no longer draws full page. The card deck has no map page, so it skips the render.
    let mapUrl = ''
    if (variant !== 'cards') try {
      const mapBlob = await useMapPoster(() => map.value).render(spec, 'png')
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = reject
        r.readAsDataURL(mapBlob)
      })
      mapUrl = dataUrl
    } catch (e) {
      // A cover without the map beats no packet — the same call the shared composable documents.
      console.warn('[country-posters] packet map page skipped:', e?.message || e)
    }

    const zone = {
      id: String(activeTab.value?.id || 'research-map'),
      label: (legendTitle.value || tabLabel(activeTab.value) || 'Doxa Map') + (selectedTotal > 50 ? ` — ${t('messages.nOfTotal', { n: 50, total: selectedTotal })}` : ''),
      zoneKey: String(activeTab.value?.id || 'research-map'),
    }
    const prints = usePosterPrints({
      records: () => records,
      lang: () => String(uiLocale.value || 'en').split('-')[0],
      label: () => zone.label,
      mapImage: () => mapUrl || null,
    })
    if (variant === 'cards') await prints.printCardDeck(zone)
    else await prints.printPacket(zone, { variant })
  } catch (err) {
    console.error('[country-posters] packet export failed:', err)
  } finally {
    _packetBusy = false
  }
}

// ─── Side-menu / dialog state ────────────────────────────────────────────────
const showSideMenu   = ref(false)
const showPoster     = ref(false)
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

// Theme-aware data-pin outline (Joshua Project uses a thin near-black outline
// that's barely visible; reverse-engineered).
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
        // PRE-WARM the shader variant here, while a large GeoJSON is loading anyway. highlightCountryByIso
        // turns these three paints DATA-DRIVEN on a click; the first time that costs a one-off shader
        // compile (measured on research-map: 5.5 s MapLibre / 11.1 s Mapbox under SwiftShader). Painting each
        // current value through a case with two identical branches keeps the look and moves the compile
        // off the gesture. All three, or the other two still compile on the click (simpleresearch).
        // "Already data-driven" means the value READS THE FEATURE somewhere, not merely that it is an
        // array: a zoom-only interpolate is an array and still compiles a variant on the first gesture
        // (simpleresearch). Anything keyed on a feature is left exactly as the layer wrote it.
        const readsFeature = (e) => Array.isArray(e) && (e[0] === 'get' || e[0] === 'has' || e[0] === 'feature-state' || e.some(readsFeature))
        for (const [layer, prop] of [['regions-fill', 'fill-opacity'], ['regions-border', 'line-color'], ['regions-border', 'line-width']]) {
          try {
            const v = map.value.getLayer(layer) && map.value.getPaintProperty(layer, prop)
            if (v != null && !readsFeature(v)) {
              map.value.setPaintProperty(layer, prop, ['case', ['in', ['get', 'iso_3166_1_alpha_3'], ['literal', []]], v, v])
            }
          } catch (_) { /* a style without the layer: nothing to warm */ }
        }
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
  // Re-assert the persisted theme's basemap lightPreset/theme on EVERY tab switch — defensive
  // so dark mode can't appear "not working" on any tab (bug-dark-mode-multi-tab). Cheap: it's
  // a config prop (no setStyle).
  mapTheme.applyTheme(map.value)
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
  // Re-color clusters (cluster paint depends on active strategy)
  clustering.refreshColors?.()
}

// ─── Legend → fly-to wiring ──────────────────────────────────────────────────
// LegendRows emits a window event when a row is clicked; we fly the map there.
// ─── "Show on map" FROM THE POSTER WALL ──────────────────────────────────────────────────────────
// ★ THIS LINK DID NOT EXIST. country-posters-mfe's onShowOnMap() switched to the Map view and
// returned, so the camera stayed at world view and nothing was selected -- as measured. The
// shell now records the requested country as a `select-country` ATTRIBUTE on this pane element and
// also announces it by event; both arrive here.
//
// RETAINED, because the request routinely arrives before this map can act on it. fitBounds needs a
// live map with a loaded style, and the first click happens while the pane is still coming up. The
// old failure mode in the sibling plugin was exactly this -- apply once against unready state, then
// discard with no record, so the user had to click twice. Here an early request is remembered in
// _pendingCountryId and drained when isMapReady flips.
let _pendingCountryId = null
let _selectCountryObserver = null

/** The ONE apply path. Returns true when the request was satisfied. */
function applySelectCountry(countryId) {
  // ★ DESELECT RESTORES THE VIEW. a second press measurably left the camera on India:
  // this branch used to clear the flag and return, so toggling OFF did nothing by construction.
  // PosterWall's button IS a toggle (it tracks lastShown and sends listId: null on the second
  // press), so a control the user can turn on but not off reads as broken even when the first
  // press worked. Restore the configured opening view -- the same values useMapInstance booted
  // with, so "off" means what it meant before anything was picked.
  if (!countryId) {
    _pendingCountryId = null
    if (isMapReady.value) {
      const c = profileConfig?.value?.center ?? mapDefaults.center ?? [20, 10]
      const z = profileConfig?.value?.zoom ?? mapDefaults.zoom ?? 1.8
      mapFly.flyToCoords?.({ longitude: c[0], latitude: c[1] }, z)
    }
    return true
  }
  const rec = (posterData.countries || []).find((c) => c.id === countryId || c.iso3 === countryId)
  // An id we cannot resolve is NOT a readiness problem -- retaining it would spin forever.
  if (!rec || !Array.isArray(rec.bbox) || rec.bbox.length !== 4) { _pendingCountryId = null; return true }
  if (!isMapReady.value) { _pendingCountryId = countryId; return false }   // not ready -- REMEMBER it
  const [w, sLat, e, n] = rec.bbox
  // The same call a legend row click makes, so the camera behaves identically however it was asked.
  mapFly.fitBounds?.([[w, sLat], [e, n]], 60)
  _pendingCountryId = null
  return true
}

function onSelectCountry(evt) { applySelectCountry(evt?.detail?.countryId ?? null) }

// Drain when the map becomes usable -- the half that makes retention real.
watch(isMapReady, (ready) => { if (ready && _pendingCountryId) applySelectCountry(_pendingCountryId) })

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

// Last-clicked highlight key per kind — clicking the same row again clears.
const _lastHL = { family: null, language: null, dialect: null, region: null, prayer: null, engagement: null, adoption: null }

function clearAllHighlights(m) {
  setPinOpacity(m, null)
  m.setFilter('language-family-pins', null)
  _syncHitboxFilter(m, null)
  mapLayers.syncGlowFilter(null)
  if (m.getLayer('regions-fill')) {
    m.setPaintProperty('regions-fill', 'fill-opacity', regionIdle(0.7))
    m.setPaintProperty('regions-fill', 'fill-outline-color', null)
  }
  if (m.getLayer('regions-border')) {
    m.setPaintProperty('regions-border', 'line-color', regionIdle('rgba(60,60,80,0.35)'))
    m.setPaintProperty('regions-border', 'line-width', regionIdle(0.6))
  }
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
    setPinOpacity(m, null)
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
      if (isoCodes.length) {
        const isoArr = ['literal', isoCodes]
        m.setPaintProperty('regions-fill', 'fill-opacity', [
          'case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], 0.85, 0.15
        ])
        m.setPaintProperty('regions-border', 'line-color', [
          'case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], '#111827', 'rgba(60,60,80,0.15)'
        ])
        m.setPaintProperty('regions-border', 'line-width', [
          'case', ['in', ['get', 'iso_3166_1_alpha_3'], isoArr], 2.5, 0.3
        ])
      } else {
        m.setPaintProperty('regions-fill', 'fill-opacity', regionIdle(0.7))
        m.setPaintProperty('regions-border', 'line-color', regionIdle('rgba(60,60,80,0.35)'))
        m.setPaintProperty('regions-border', 'line-width', regionIdle(0.6))
      }
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

    setPinOpacity(m, matchExpr)
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
    // The label is display only (the reader's language); the filter keys on the family letter.
    const node = { id: famLetter, label: religionFamilyLabel(famLetter), depth: 0 }
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

// ─── Clusters toolbar wiring ─────────────────────────────────────────────────
// LegendDesktop's Clusters checkbox writes to mapStore.showClusters. Research-mfe
// only ever uses the MST line-clustering algorithm (lines between pins), so we
// force-set the mode to 'mst' BEFORE enabling, regardless of what's in the
// store. The clusterMode watcher is kept as a no-op for forwards compat.
watch(() => mapStore.showClusters, async (on) => {
  if (on) {
    // Mode must be set before setEnabled() so the composable's _applyLineClustering
    // path is selected; otherwise it falls back to its internal default ('mapbox').
    await clustering.setMode?.('mst')
    // Replay any legend-row selection that was made *before* clustering was
    // enabled — keeps the first MST pass scoped to that slice.
    clustering.flushSelectionFilter?.()
    await clustering.setEnabled?.(true)
  } else {
    await clustering.setEnabled?.(false)
  }
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
    // Pre-warm the pins' opacity variant now, not on the first legend click (see setPinOpacity).
    setPinOpacity(map.value, null)
    // Initial-render override: doxa-regions tab → solid grey pins so they
    // don't blend into the matching-color polygon fill.
    if (activeTab.value?.id === 'doxa-regions' && map.value?.getLayer('language-family-pins')) {
      map.value.setPaintProperty('language-family-pins', 'circle-color', '#4b5563')
    }
    // Start prayer glow if landing on the prayer tab
    if (activeTab.value?.id === 'prayer') mapLayers.startPrayerGlow()
    // Hand the same dataset to clustering so MST/network can rebuild on toggle
    clustering.setData?.(normalizedPeopleGroups)
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
function applyContainerScale(width) {
  const el = rmRoot.value
  if (!el) return
  if (width >= 700) {
    el.style.setProperty('--map-btn-size',     '40px')
    el.style.setProperty('--map-toolbar-gap',  '8px')
    el.style.setProperty('--map-font-md',      '13px')
    el.style.setProperty('--map-font-sm',      '11px')
    // 380px matches SemanticTreeLegend's .stl-panel + the geocoder pill
    // (the pin-detail card was 400px and looked WIDER than the
    // language-family legend below it; unify to 380px so the swap reads
    // as same-card different-content).
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

onMounted(async () => {
  // uiStore.init() registers the page-level ResizeObserver that drives
  // updateBreakpoint() — without this, breakpoint stays at default 'desktop'
  // and uiStore.isMobile is permanently false even on mobile devices, so
  // any code branching on isMobile (LegendDesktop's internal LegendMobile
  // mount, mobile-only feature gates, etc.) runs the desktop path.
  // The CSS @media path on .rm-legend-mobile-slot still works either way,
  // but isMobile-driven branches don't.
  uiStore.init?.()
  // COUNTRIES-MAP DIFFERENCE #2 (boot half) — research-map forces tabs[0] (Prayer)
  // here on mount, which silently overrode the ref's initial value. THIS is the
  // line that decides the opening tab; setting the ref alone was not enough.
  activeTabId.value = DEFAULT_TAB_ID
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
  // The retained request, read from the ELEMENT rather than waited for: an attribute set before
  // this component existed is still here now. Then observe it, since the shell rewrites it on
  // every click. Both triggers end at applySelectCountry().
  {
    const host = mapContainer.value?.getRootNode?.()?.host
    if (host) {
      host.addEventListener('doxa:select-country', onSelectCountry)
      const requested = host.getAttribute('select-country')
      if (requested) applySelectCountry(requested)
      _selectCountryObserver = new MutationObserver(() => {
        applySelectCountry(host.getAttribute('select-country') || null)
      })
      _selectCountryObserver.observe(host, { attributes: true, attributeFilter: ['select-country'] })
    }
  }
  window.addEventListener('legend:highlight', onLegendHighlight)

  const dataPromise = mapData.loadData().catch(err => {
    console.error('[research-map] data load failed:', err)
    return { normalizedPeopleGroups: [] }
  })
  try {
    await initializeMap()
  } catch (err) {
    // `new mapboxgl.Map()` throws outright when the device has no WebGL context.
    console.error('[countries-map] Map failed to initialize —', err)
    mapError.value = String(err?.message || err)
    return
  }
  if (!map.value) {
    // The code has already concluded the map is dead — say so instead of leaving
    // the loading line up, which is indistinguishable from "still loading".
    console.error('[countries-map] Map failed to initialize — check token and container')
    mapError.value = t('messages.mapInitFailed')
    return
  }
  map.value.once('style.load', async () => {
    try {
      const { normalizedPeopleGroups } = await dataPromise
      await onMapReady(normalizedPeopleGroups)
    } catch (err) {
      console.error('[countries-map] onMapReady failed:', err)
      mapError.value = String(err?.message || err)
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('doxa:legend-row-click', onLegendRowClick)
  _selectCountryObserver?.disconnect()
  _selectCountryObserver = null
  mapContainer.value?.getRootNode?.()?.host?.removeEventListener('doxa:select-country', onSelectCountry)
  window.removeEventListener('legend:highlight', onLegendHighlight)
  if (_containerObserver) { _containerObserver.disconnect(); _containerObserver = null }
  poster.value?.cleanup?.()
  mapLayers.stopPrayerGlow()
  clustering.cleanup?.()
  selectedPin.cleanup?.()
  mapStore.unregisterMap(mapId)
  destroy()
})
</script>

<template>
  <div ref="rmRoot" :class="['rm-root', { 'rm-dark': isDark, 'dsm-dark': isDark }]">
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
      <div v-if="!appReady && !mapError" class="rm-loading">{{ t('messages.loadingNamed', { name: t('tabs.map') }) }}</div>
      <div v-if="mapError" class="rm-error">{{ t('messages.couldNotLoadNamed', { name: t('tabs.map') }) }} {{ mapError }}</div>
      <div ref="mapContainer" class="rm-map-canvas" />
      <div class="map-scroll-edge map-scroll-edge--left" />
      <div class="map-scroll-edge map-scroll-edge--right" />

      <!-- "RESEARCH" corner badge removed per qa.md R5 status flag (2026-04-27).
           Style class .rm-badge kept in shadow CSS in case future tabs want it. -->

      <!-- Geocoder search bar (top-left) — canonical clone from read-only
           simple-map mfe so tabs 1-3 stay visually identical. -->
      <GeocoderComponent
        ref="geocoderRef"
        v-if="appReady && map && hasGeocoder"
        :map-instance="map"
        :access-token="mapboxToken"
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
        <ZoomInButton      :map="map"          :is-dark="isDark" />
        <ZoomOutButton     :map="map"          :is-dark="isDark" />
        <LocationButton    :map="map"          :is-dark="isDark" />
        <FullscreenButton  :map-container="mapContainer" :is-dark="isDark" />
        <ThemeToggleButton :is-dark="isDark"    @toggle="handleToggleTheme" />
        <HelpButton        :is-dark="isDark" hosted />
        <!-- EXPORT, ALWAYS VISIBLE (KNOWN-BUGS NE-17). "Export poster…" lived only in the side drawer,
             whose opener is off by default (hamburgerMenu:false), so no reader could reach it; the
             legend's Export menu needs a row selected first. This is the same one-click toolbar control
             Simple Research uses, opening the same poster dialog. -->
        <MapControlButton  :is-dark="isDark" :title="t('controls.export_poster')" class="export-poster-btn"
          @click="openPoster">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
        </MapControlButton>
        <!-- ShareButton intentionally OMITTED; country-posters-mfe.vue's header owns
             sharing for this bundle, exactly as upg-100-mfe does for the 100-list.
             Rendering both gave the bundle TWO share affordances on one surface — the
             BUG-UPG100-DOUBLE-SHARE state the 100-list already fixed once, caught here
             by check:share-policy rather than by a reader seeing two buttons.
             REMOVED, not flag-gated: a `v-if="false"` button is dead code that still
             reads as an affordance to every reader and every counter. A map embedded
             WITHOUT the MFE header would add one back deliberately. -->
      </MapToolbar>

      <!-- Fly + Clusters floating toolbar — sibling of the legend card, mounted
           between MapToolbar and the side menu so its CSS namespace doesn't
           collide with anything. The component's own internal predicate
           (showAutoFlyButton) limits rendering to doxa-regions / language-family
           tabs, so this can stay declared unconditionally besides appReady. -->
      <LegendTools
        v-if="appReady"
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
            :open="_stlOpen"
            :export-enabled="EXPORT_FEATURE_ENABLED"
            :export-cards="EXPERIMENTAL_EXPORTS"
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

      <!-- Poster export modal -->
      <!-- PosterDialog's contract is v-model (visibility) + a getMap ACCESSOR. This passed :poster /
           :active-tab (props it does not declare) and neither of those, so its own v-if="visible"
           stayed false: "Export poster…" opened nothing, on both engines, since the dialog moved to
           the library. legend.items is a ref inside a plain object, so the template must unwrap it (useLegendData has no `rows`: reading it threw and the dialog never opened, NE-17). -->
      <PosterDialog
        v-if="showPoster"
        v-model="showPoster"
        :get-map="() => map"
        :legend-rows="legend.items.value || []"
      />
    </div>
  </div>
</template>
