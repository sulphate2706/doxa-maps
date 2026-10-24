<script setup>
/**
 * doxa-simple-map.vue — Application Profile: Doxa Simple Map
 *
 * @description The simple world map, shipped as three presets off ONE prop table —
 *   Prayer, Engagement and Adoption. Pins, geocoder search and a legend, with no dashboard
 *   chrome: the smallest thing that is still a real map, and the capability-2 reference for
 *   how one bundle serves many parameterized elements.
 *
 * Direct clone of doxa-simple-map-component/MapComponent.vue initialization pattern.
 * Reads profile-config via inject() from ProfileLoader.
 * Shadow DOM safe: all CSS via useShadowStyles, geocoder CSS injected at runtime.
 */

import { inject, provide, ref, computed, onMounted, onBeforeUnmount, watch, toRef, markRaw, toRaw } from 'vue'
import { retryableAsyncComponent } from '@map/composables/retryableAsyncComponent.js'
import { useI18n } from 'vue-i18n'
import { RTL_LOCALES } from '@map/i18n/index.js'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { useMapData } from '@map/composables/useMapData.js'
import { useMapLayers, PIN_STROKE_WIDTH_LIGHT, buildDarkRingWidth } from '@map/composables/useMapLayers.js'
import { useMapTheme, THEME_TOGGLE, FIXED_BASEMAP } from '@map/composables/useMapTheme.js'
import { applyStylePaint } from '@map/styles/registry.js'
import { useSelectedPin } from '@map/composables/useSelectedPin.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { DataSourceManager } from '@map/utils/DataSourceManager.js'
import { getLanguageFamilyColor } from '@map/colors/language-family.js'
import { buildColorExpression, getColorStrategy, COLOR_MODES } from '@map/colors/_registry.js'
import { FULL_PRAYER_THRESHOLD } from '@map/colors/prayer-progress.js'
import { mapDefaults } from '@map/constants/mapDefaults.js'
import LegendDesktop   from '@map/components/legends/LegendDesktop.vue'
const LegendMobile = retryableAsyncComponent(() => import('@map/components/legends/LegendMobile.vue'))
import SemanticTreeLegend from '@map/components/legends/SemanticTreeLegend.vue'
import { createPplrInstance, provideInstance } from '@map/composables/usePplrInstance.js'
import { useLegendData as useFlatLegendData } from '@map/composables/legends/useLegendData.js'
import { useMapFly } from '@map/composables/useMapFly.js'
import { useCountryOutline, resolveCountryIso } from '@map/composables/useCountryOutline.js'
import { setProjectionOn } from '@map/composables/useMapProvider.js'
import SideMenuDrawer    from '@map/components/SideMenuDrawer.vue'
// ─── Map control components ───────────────────────────────────────────────────
// Each button is imported individually so the profile can compose any subset
// and bind them explicitly to its own map instance.  In a multi-map profile
// you would place a separate <MapToolbar> + button set for each map.
import MapToolbar        from '@map/components/map-controls/MapToolbar.vue'
import ZoomInButton      from '@map/components/map-controls/ZoomInButton.vue'
import ZoomOutButton     from '@map/components/map-controls/ZoomOutButton.vue'
import LocationButton    from '@map/components/map-controls/LocationButton.vue'
import FullscreenButton  from '@map/components/map-controls/FullscreenButton.vue'
import ThemeToggleButton from '@map/components/map-controls/ThemeToggleButton.vue'
import HelpButton        from '@map/components/map-controls/HelpButton.vue'
import HamburgerButton   from '@map/components/map-controls/HamburgerButton.vue'
import GeocoderComponent from '@map/components/map-controls/GeocoderComponent.vue'
import ShareButton       from '@map/components/map-controls/ShareButton.vue'
// By path, not through map-controls/index.js: the barrel would pull the 'mapInfo' catalogue area into
// every bundle that imports a control.
import MapInfoButton     from '@map/components/map-controls/MapInfoButton.vue'
import MapInfo           from '@map/components/info/MapInfo.vue'
import { mapInfoFor }    from './src/mapInfo.js'

// ─── Shadow DOM style injection ──────────────────────────────────────────────
useShadowStyles(`
  .dsm-root { position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden; }
  .dsm-tab-bar { flex:0 0 auto;display:flex;align-items:center;background:#fff;border-bottom:2px solid #e0e0e0;box-shadow:0 2px 4px rgba(0,0,0,.08);height:48px;padding:0 12px;gap:4px;z-index:10; }
  .dsm-tab { background:none;border:none;padding:0 20px;height:100%;font-size:14px;font-weight:500;color:#555;cursor:pointer;border-bottom:3px solid transparent;transition:color .15s,border-color .15s,background .15s;white-space:nowrap; }
  .dsm-tab:hover { background:rgba(52,152,219,.06);color:#3498db; }
  .dsm-tab.active { color:#3498db;border-bottom-color:#3498db;background:rgba(52,152,219,.06); }
  .dsm-map-area { flex:1 1 0;position:relative;overflow:hidden; }
  /* ROUNDED CORNERS REACH THE CANVAS. The host page rounds this element; a WebGL canvas is
     promoted to its own compositing layer and is not reliably clipped by an ancestor's radius
     (Firefox shows square corners under a rounded slot), so the radius is inherited all the way
     down to the canvas instead of relying on the ancestor clip alone. */
  .dsm-root, .dsm-map-area, .dsm-map-canvas,
  .dsm-map-canvas .mapboxgl-canvas-container, .dsm-map-canvas .mapboxgl-canvas,
  .dsm-map-canvas .maplibregl-canvas-container, .dsm-map-canvas .maplibregl-canvas { border-radius: var(--map-radius-corners, var(--map-radius, 0px)); }
  /* PAINT-TIME CLIP. border-radius alone is applied to a COMPOSITED child (the WebGL canvas)
     only once the engine builds a mask layer for it, so on a real GPU the corners go square the
     moment the map finishes loading. clip-path clips at paint time regardless of compositing,
     so the rounding holds before and after the canvas appears. */
  /* Clip the map AREA only. Clipping the canvas or its container breaks Mapbox's own
     transforms and the map renders grey, so the rounding stops one level above it. */
  .dsm-map-area { clip-path: inset(0 round var(--map-radius-corners, var(--map-radius, 0px))); }
  .dsm-map-canvas { position:absolute;inset:0; }
  .dsm-loading { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#f3f3f1;color:#6d766e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;z-index:5; }  /* dark like the research map's cover: the basemap under it is night from frame one, so a light cover was the only "flash" left */
  /* Failure state, NOT a cover: modelled on cities-internet's .gm-err so anything the
     map did manage to render stays visible around it. A spinner that outlives the
     failure reads as "slow" and the user just waits; this says the map is gone. */
  .dsm-error { position:absolute;top:50%;left:12px;right:12px;z-index:7;transform:translateY(-50%);text-align:center;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#7f1d1d;background:rgba(255,255,255,.94);border:1px solid rgba(127,29,29,.25);border-radius:10px;padding:12px 14px;box-shadow:0 2px 10px rgba(0,0,0,.16); }
  .dsm-dark .dsm-error { color:#fecaca;background:rgba(19,25,32,.95);border-color:rgba(254,202,202,.28); }

  /* ── Light mode: geocoder ── */
  /* Search bar matches legend width EXACTLY via the shared --map-legend-width
     CSS variable (set by applyContainerScale). Responsive at same breakpoints. */
  /* Outer control container: positioned 10px from top + left of the map area
     (matches legend's 10px left inset). Locked to legend width. The Mapbox
     default 10px child margin is NEUTRALIZED here by our positioning —
     without this override the geocoder would nest-indent another 10px. */
  /* Both engines' class (keyless is MapLibre), and the reading-start side, so Arabic puts the column on the right. */
  .mapboxgl-ctrl-top-left, .maplibregl-ctrl-top-left { top:10px!important;inset-inline-start:10px!important;width:var(--map-legend-width,340px)!important;max-width:var(--map-legend-width,340px)!important;z-index:1200!important; }
  .mapboxgl-ctrl-top-left .mapboxgl-ctrl, .maplibregl-ctrl-top-left .maplibregl-ctrl { margin:0!important;float:none!important; }
  /* Geocoder pill: inherit Mapbox's DEFAULT height + icon positions. Only
     override width + rounded border + shadow. This keeps the search-icon
     and X-button perfectly aligned by Mapbox's own calibrated CSS. */
  .mapboxgl-ctrl-geocoder { width:100%!important;max-width:100%!important;min-width:0!important;border-radius:20px!important;box-shadow:0 2px 8px rgba(0,0,0,0.15)!important;background:#fff; }
  .mapboxgl-ctrl-geocoder--input { border-radius:20px!important; }
  /* Keep the clear (X) button visible whenever the input has text, not just
     while focused. Mapbox's default only shows X on focus, so after picking
     a search result on mobile (tap → input blurs) the X vanished until the
     user tapped BACK into the input. :has + :not(:placeholder-shown) detects
     a non-empty input. */
  .mapboxgl-ctrl-geocoder:has(.mapboxgl-ctrl-geocoder--input:not(:placeholder-shown)) .mapboxgl-ctrl-geocoder--button { display:block!important; }
  /* Clear (X) button — hidden until typing (sibling :has rule flips it on), no visible
     box (stock gives it a white bg), and the X icon absolutely centred at a fixed 16px so
     it's identical on mobile and desktop (stock uses 20px/margin-top:8px below 640px,
     16px/margin-top:3px above — which left the X lower on mobile). */
  .mapboxgl-ctrl-geocoder--button { display:none!important;top:50%!important;bottom:auto!important;transform:translateY(-50%)!important;margin:0!important;padding:0!important;width:24px!important;height:24px!important;background:transparent!important;border:none!important;box-shadow:none!important; }
  .mapboxgl-ctrl-geocoder--button .mapboxgl-ctrl-geocoder--icon-close { position:absolute!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%)!important;margin:0!important;width:16px!important;height:16px!important; }
  /* Suggestions dropdown — higher limit (20) can produce a tall list;
     cap height + add overflow-y so the user can scroll through all matches
     (e.g. many people-groups under "India"). Visible scrollbar styling. */
  .mapboxgl-ctrl-geocoder--suggestions { z-index:1200!important;position:absolute;max-height:60vh!important;overflow-y:auto!important; }
  .suggestions { border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-height:60vh!important;overflow-y:auto!important; }
  .mapboxgl-ctrl-geocoder--suggestions::-webkit-scrollbar,
  .suggestions::-webkit-scrollbar { width:8px; }
  .mapboxgl-ctrl-geocoder--suggestions::-webkit-scrollbar-thumb,
  .suggestions::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.3);border-radius:4px; }
  .mapboxgl-ctrl-geocoder--suggestions::-webkit-scrollbar-track,
  .suggestions::-webkit-scrollbar-track { background:rgba(0,0,0,0.05); }

  /* ── DOXA custom suggestion rows — bold labels + compact meta ─────── */
  /* GeocoderComponent.renderSuggestion() produces <div class="dg-main">
     Name</div><div class="dg-meta"><span class="dg-field">…</span>…</div> */
  .dg-main { font-weight:500;font-size:13px;color:#222;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px; }
  .dg-main strong { font-weight:700;overflow:hidden;text-overflow:ellipsis; }
  .dg-meta { margin-top:2px;display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11px;color:#555;line-height:1.35; }
  .dg-field strong { font-weight:600;color:#333;margin-inline-end:2px; }
  /* Round 16 — labeled category tag replacing the old emoji prefixes. */
  .dg-tag { flex:none;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#3b463d;background:rgba(59,70,61,0.10);border-radius:4px;padding:1px 5px;line-height:1.5;white-space:nowrap; }
  .dg-agg-label { overflow:hidden;text-overflow:ellipsis; }
  .dg-count { flex:none;font-size:11px;font-weight:600;color:#73a17f; }
  /* Dark theme variants */
  .dsm-dark .dg-main { color:#F3F3F1; }
  .dsm-dark .dg-meta { color:rgba(243,243,241,0.7); }
  .dsm-dark .dg-field strong { color:#F3F3F1; }
  .dsm-dark .dg-tag { color:#cfe3d6;background:rgba(115,161,127,0.22); }
  .dsm-dark .dg-count { color:#9fd0ab; }
  @media(max-width:767px){
    /* Mobile: centered full-width pill. Search-bar height (exactly 35px, desktop AND
       mobile) is now owned by the shared GeocoderComponent.vue injection
       'geocoder-height-35' — no per-profile @media height hack (replaces
       bug-searchbar-mobile-height). */
    /* The phone search band (a header strip that holds the pill) is owned by GeocoderComponent. */
  }

  /* ── Dark mode: root class drives all child overrides ── */
  .dsm-dark .mapboxgl-ctrl-geocoder { background:#4e594f!important;border:1px solid rgba(255,255,255,0.14)!important;box-shadow:0 2px 8px rgba(0,0,0,0.4)!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--input { color:#F3F3F1!important;background:transparent!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--input::placeholder { color:rgba(243,243,241,0.65)!important; }
  /* X (clear) button — the SVG <svg> AND its wrapper <button> both need
     dark-mode styling or Mapbox's default white fill bleeds through. */
  .dsm-dark .mapboxgl-ctrl-geocoder .mapboxgl-ctrl-geocoder--icon { fill:rgba(243,243,241,0.75)!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--button { background:transparent!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--icon-close { fill:rgba(243,243,241,0.75)!important; }
  .dsm-dark .mapboxgl-ctrl-geocoder--button:hover .mapboxgl-ctrl-geocoder--icon-close { fill:#F3F3F1!important; }
  /* Suggestions dropdown — every wrapper level needs explicit dark bg.
     Mapbox uses UL.suggestions > LI > A; the default .active / .selected
     class on the top match keeps a light bg without these overrides. */
  .dsm-dark .suggestions { background:#3b463d!important;border:1px solid rgba(255,255,255,0.12)!important; }
  .dsm-dark .suggestions > li { background:transparent!important; }
  .dsm-dark .suggestions > li > a { background:transparent!important;color:#F3F3F1!important; }
  .dsm-dark .suggestions > li.active > a,
  .dsm-dark .suggestions > li.selected > a,
  .dsm-dark .suggestions > li:hover > a,
  .dsm-dark .suggestions > li > a:hover,
  .dsm-dark .suggestions > li > a:focus { background:rgba(255,255,255,0.1)!important;color:#F3F3F1!important; }
  /* DOXA custom row bits inside dark mode — re-assert in case the row-<a>
     sets a color that our .dg-* spans inherit from. */
  .dsm-dark .dg-main { color:#F3F3F1!important; }
  .dsm-dark .dg-meta { color:rgba(243,243,241,0.75)!important; }
  .dsm-dark .dg-field strong { color:#F3F3F1!important; }

  /* When the geocoder is disabled (FEATURES.geocoder=false), the legend
     reflows up to fill the freed top slot — matches the geocoder pill
     position (top:10px) instead of clearing it (top:54px). */
  .dsm-root.dsm-no-geocoder .legend-container,
  .dsm-root.dsm-no-geocoder .legend-container.collapsed { top: 10px !important; }
  .dsm-root.dsm-no-geocoder .stl-panel { top: 10px !important; }
  .dsm-root.dsm-no-geocoder .stl-reopen { top: 10px !important; }

  /* Desktop/mobile legend slot toggle */
  .dsm-legend-mobile-slot { display:none; }
  @media(max-width:767px){
    .dsm-legend-mobile-slot { display:block; }
    .dsm-legend-desktop-slot { display:none; }
  }
  /* Left/right scroll edges for mobile — transparent strips that allow
     page scrolling via touch-action:pan-y on the map edges. */
  /* Exactly as wide as the control column: button + its 3px edge margin on both sides. */
  .map-scroll-edge { position:absolute;top:0;bottom:0;width:calc(var(--map-btn-size,32px) + 6px);z-index:2;touch-action:pan-y;pointer-events:auto;background:transparent; }
  .map-scroll-edge--left { left:0; }
  .map-scroll-edge--right { right:0; }

  /* ── Fullscreen ── */
  :host(:fullscreen) { width:100vw!important;height:100vh!important;display:block!important; }
  :host(:fullscreen) .dsm-root { position:fixed;inset:0; }
  :host(:-webkit-full-screen) { width:100vw!important;height:100vh!important;display:block!important; }
  :host(:-webkit-full-screen) .dsm-root { position:fixed;inset:0; }

  /* ── Help modal ── */
  .dsm-help-overlay { position:absolute;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:2000; }
  .dsm-help-modal { background:#2a332a;color:#F3F3F1;border-radius:12px;padding:28px 32px;max-width:420px;width:90%;position:relative;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;z-index:2001; }
  .dsm-help-modal h2 { margin:0 0 12px;font-size:18px;font-weight:600; }
  .dsm-help-modal p { margin:0 0 10px;font-size:14px;line-height:1.6;color:#ccc; }
  .dsm-help-modal p:last-of-type { margin-bottom:0; }
  .dsm-help-close { position:absolute;top:12px;inset-inline-end:14px;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:4px 6px;border-radius:4px; }
  .dsm-help-close:hover { background:rgba(255,255,255,0.12); }
`, 'doxa-simple-map')

// ─── i18n ─────────────────────────────────────────────────────────────────────
const { t, te, locale } = useI18n()

// ─── Mapbox basemap localisation ──────────────────────────────────────────────
// On Mapbox Standard / Streets styles, common label layers carry per-locale
// name fields (name_ar, name_de, name_en, name_fr, …). Setting the text-field
// expression to `['get', 'name_' + locale]` switches country/place/state names
// without reloading the style.
const MAPBOX_LABEL_LAYERS = [
  'country-label',
  'state-label',
  'settlement-major-label',
  'settlement-minor-label',
  'place-label',
  'continent-label',
  'water-point-label',
  'water-line-label',
]

function applyBasemapLocale(loc) {
  const m = map?.value
  if (!m) return
  for (const layerId of MAPBOX_LABEL_LAYERS) {
    if (!m.getLayer(layerId)) continue
    try {
      m.setLayoutProperty(layerId, 'text-field', ['coalesce',
        ['get', 'name_' + loc],
        ['get', 'name_en'],
        ['get', 'name'],
      ])
    } catch (e) {
      // Layer may not support name_* in this style — skip silently
    }
  }
}

const isRTL = computed(() => RTL_LOCALES.has(locale.value))

// ─── Feature flags (baked into this profile) ─────────────────────────────────
// Keep the underlying code in the repo; flip these to re-enable on a per-profile
// basis. Other application profiles may set these true and still work.
//   hamburgerMenu      — side menu drawer + hamburger button
//   infoButton         — "About this map" help modal trigger
//   overlapDensity     — dim non-matched pins to 0.08 when a legend filter is
//                        active (causes overlap-density bleed that can wash out
//                        orange pins). OFF here.
//   darkPinBorder      — dark stroke on active pins in light mode. Previously
//                        needed to compensate for density bleed; irrelevant
//                        without overlapDensity.
const FEATURES = {
  hamburgerMenu: false,
  infoButton:    false,  // before enabling: the help modal needs role="dialog" + aria-modal + Escape + focus trap/return (A11Y-AUDIT-PRAYER-PROGRESS-CONNECTIVITY.md)
  overlapDensity: false,
  darkPinBorder:  false,
  // Geocoder search bar feature-flagged OFF on simple-map: research-map keeps
  // its geocoder; only the simple-map pages on home/pray/adopt should NOT show
  // search. Flip to true to restore. Wraps the <GeocoderComponent v-if> in the
  // template.
  geocoder:      false,
  // Disabled: no thicker stroke / enlarged radius / pulse animation when a
  // legend row is selected. Matched pins stay at base-layer style; non-
  // matched pins dim via 'case' opacity.
  activeOverlayEmphasis: false,
}

// ─── Config from ProfileLoader ────────────────────────────────────────────────
const profileConfig = inject('profileConfig')
const mapboxToken   = inject('mapboxToken')
const dataSource    = inject('dataSource')

// ─── Tabs child prop ──────────────────────────────────────────────────────────
const DEFAULT_TABS = [
  { id: 'prayer', label: 'Prayer', colorStrategy: 'prayer', legend: 'prayer', popup: 'prayer' }
]
const tabs       = computed(() => profileConfig?.value?.tabs ?? DEFAULT_TABS)
// A built-in tab reads its label from tabs.<id> in the reader's language. A label the HOST passed in
// profileConfig.tabs is the host's own words and is shown as given.
const DEFAULT_LABELS = Object.fromEntries(DEFAULT_TABS.map((d) => [d.id, d.label]))
const tabLabel = (tab) => ((!tab.label || tab.label === DEFAULT_LABELS[tab.id]) && te('tabs.' + tab.id)) ? t('tabs.' + tab.id) : tab.label
// With 2+ tabs (the research page passes three) the bar is a tablist: a screen reader announces each
// button as a tab and which one is selected. The underline marks the active tab by shape, not only colour.
const showTabBar = computed(() => tabs.value.length > 1)

// ─── Tab state ────────────────────────────────────────────────────────────────
const activeTabId = ref(null)
const activeTab   = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? tabs.value[0])
// ─── "What can this map do?" carried by the map ───────────────────────────────
// The map's own info (src/mapInfo.js, per preset). In the gallery the gallery answers the ⓘ control; on
// any other page the control asks for the map's own popup ('standalone'), mounted beside the toolbar.
// A host's profile-config info:false removes the ⓘ.
const ownInfo   = computed(() => (profileConfig?.value?.info === false ? null : mapInfoFor(tabs.value)))
const infoLocal = ref(false)

// ─── Share embed path (ID→URL table owned by this profile) ────────────────────
// This is ONE parameterized profile rendering 3 maps chosen by tab id, so the
// share/embed URL must resolve from the ACTIVE tab — otherwise every simple map
// would share the same page. Passed to ShareButton via :embed-path.
// These point at the preconfigured-INSTANCE pages the build emits from
// simple-map.instances.json, TREE-RELATIVE: <bundle>/<profile>/<id>/index.html.
// ShareButton joins them to the tree root the bundle derives from its own script
// url (library/utils/embedBase.js), so the link works wherever the tree is hosted
// — never a hardcoded /js/doxa-maps/… (404s on doxa.life's /js/doxa-maps-build/).
const SHARE_EMBED_BY_ID = {
  prayer:     'doxa-simple-map/doxa-simple-map/prayer/index.html',
  engagement: 'doxa-simple-map/doxa-simple-map/engagement/index.html',
  adoption:   'doxa-simple-map/doxa-simple-map/adoption/index.html'
}
// Unknown tab id (a host-authored tab set) → this profile's base page.
const shareEmbedPath = computed(() =>
  SHARE_EMBED_BY_ID[activeTab.value?.id]
  || 'doxa-simple-map/doxa-simple-map/index.html')

// Maps tab legend key → LegendComponent legendType prop
const legendTypeMap = { prayer: 'prayer', engagement: 'engagement', adoption: 'adoption' }
const activeLegendType = computed(() => legendTypeMap[activeTab.value?.legend] ?? 'prayer')

// Maps tab `popup` config → PeopleGroupDetail `action` prop.
// 'adoption' → Adopt button (→ /adopt/<slug>/?source=doxalife on current origin)
// anything else → Pray button (→ https://pray.doxa.life/<slug>?source=doxalife&utm_source=<utmSource|agwm>)
const activePopupAction = computed(() => activeTab.value?.popup === 'adoption' ? 'adopt' : 'pray')

// ─── Map ID ───────────────────────────────────────────────────────────────────
// Prefer instanceId from profile-config (set in WordPress embed) for deterministic isolation.
// Falls back to a random ID if not provided (safe for single-map pages).
const injectedInstanceId = inject('instanceId', null)
const mapId = (injectedInstanceId?.value || injectedInstanceId) || ('doxa-simple-map-' + Math.random().toString(36).slice(2, 7))
// Re-provide mapId so children (LegendComponent, etc.) can inject it for window event scoping
provide('mapId', mapId)
// Resolves the active tab's strategy → color for a given feature, used by
// useSelectedPin.js so the selection-pin matches the underlying dot color.
// simple-map tab strategyKeys are 'engagement',
// 'adoption', 'prayer' — mapping to COLOR_MODES below.
provide('getActivePinColor', (properties) => {
  const sk = activeTab.value?.colorStrategy
  const mode = sk === 'engagement' ? COLOR_MODES.ENGAGEMENT
            : sk === 'adoption'   ? COLOR_MODES.ADOPTION
            : COLOR_MODES.PRAYER_PROGRESS
  return getColorStrategy(mode)?.getColor?.(properties) ?? '#1a1a1a'
})

// ─── SemanticTreeLegend (STL) — shared panel for all flat tabs ─────────────
const pplrInstance = createPplrInstance()
provideInstance(pplrInstance)
pplrInstance.theme.value = 'light'

const flatLegend = useFlatLegendData(toRef(() => activeLegendType.value))
function _flatItemsToStlNodes(items) {
  const out = []
  for (const item of items) {
    out.push({
      id: item.key, label: item.label, color: item.color,
      count: item.count ?? 0, pop: item.population ?? 0,
      filter: item.filterKey ? ['==', ['get', '_flat_filter'], item.filterKey] : null,
      children: [],
    })
    for (const c of (item.children || [])) {
      out.push({
        id: c.key, label: c.label, color: c.color,
        count: c.count ?? 0, pop: c.population ?? 0,
        filter: c.filterKey ? ['==', ['get', '_flat_filter'], c.filterKey] : null,
        children: [],
      })
    }
  }
  return out
}
const legendNodes = computed(() => _flatItemsToStlNodes(flatLegend.items.value))
const legendTitle = computed(() => t('legend.titleBar.legend'))
// Prayer progress bar (header of the prayer legend). The payload
// is null on every non-prayer tab → no bar. Passed as a prop to the desktop STL
// below AND provide()d so the MOBILE sheet's embedded <SemanticTreeLegend>
// (LegendMobile.vue, untouched) picks it up via inject('legendProgress') — one
// wiring for desktop, mobile and embeds. STL also retitles itself "Progress".
const legendProgress = flatLegend.progress
provide('legendProgress', legendProgress)
// From the catalog (legend.colLabel.*), which every locale already translates. This was
// hard-coded English, the one column header left in English in the ar/zh/ru/hi embeds.
const legendColumnLabel = computed(() => {
  const type = activeLegendType.value
  return t('legend.colLabel.' + (['prayer', 'engagement', 'adoption'].includes(type) ? type : 'status'))
})
const _stlOpen = computed(() => uiStore.legendState !== 'collapsed')
function _onStlOpenChange(open) {
  if (open) uiStore.openLegend()
  else uiStore.collapseLegend()
}
function onSemanticTreeSelect(node) {
  if (!node) {
    const t = activeLegendType.value
    if (t === 'prayer')     uiStore.setPrayerFilter(null)
    else if (t === 'engagement') uiStore.setEngagementFilter(null)
    else if (t === 'adoption')   uiStore.setAdoptionFilter(null)
    return
  }
  const t = activeLegendType.value
  if (t === 'prayer')     uiStore.setPrayerFilter(node.id)
  else if (t === 'engagement') uiStore.setEngagementFilter(node.id)
  else if (t === 'adoption')   uiStore.setAdoptionFilter(node.id)

  // — uniform legend-row camera. node.filter is a _flat_filter
  // placeholder for simple-map's prayer/engagement/adoption tabs, so we
  // synthesize the real match expression via buildMatchExpr (same one
  // applyLegendFilter uses for the dim path).
  const matchExpr = buildMatchExpr(t, node.id)
  if (matchExpr) {
    mapFly.zoomToLegendRow?.(node, { matchExpr })
  }
}

// Provide the legend-select handler so the MOBILE legend wires to it too.
// LegendMobile.vue injects 'onSemanticTreeSelect' with a NO-OP default
// (inject('onSemanticTreeSelect', () => {})), so without this provide mobile
// row-clicks never reached the dim/restore path — select/deselect was dead on
// mobile while desktop (the explicit @select binding at the <SemanticTreeLegend>)
// worked. Mirrors the working research-map.vue:885 pattern.
provide('onSemanticTreeSelect', (node) => onSemanticTreeSelect(node))

const mapContainer = ref(null)
const dsmRoot = ref(null)

// ─── Container-based responsive scaling ──────────────────────────────────────
// Watches the component's root element width via ResizeObserver and sets CSS
// custom properties that button + legend components consume. This ensures
// correct sizing when the map is embedded in a small slot on desktop
// (viewport media queries alone can't detect container size).
//
// Breakpoints (desktop only — mobile media queries handle ≤767px viewport):
//   ≥ 700 px → full size  (btn 40 px, font-md 13 px, font-sm 11 px)
//   500–699 px → medium   (btn 36 px, font-md 12 px, font-sm 10 px)
//   < 500 px  → compact   (btn 32 px, font-md 11 px, font-sm 10 px)
//
// Minimums: button 32 px, text 10 px — below that text would wrap or disappear.
let _containerObserver = null
function applyContainerScale(width) {
  const el = dsmRoot.value
  if (!el) return
  // Corner roundedness: the HOST PAGE decides when it rounds the element (the site publishes
  // --map-radius from its slot); we only supply a default for a bare embed. Writing it
  // unconditionally would be an inline style and would override the page.
  if (!getComputedStyle(el).getPropertyValue('--map-radius').trim()) {
    el.style.setProperty('--map-radius',    '16px')
    el.style.setProperty('--map-radius-sm', '8px')
  }
  if (width >= 700) {
    el.style.setProperty('--map-btn-size',       '40px')
    el.style.setProperty('--map-toolbar-gap',    '8px')
    el.style.setProperty('--map-font-md',        '13px')
    el.style.setProperty('--map-font-sm',        '11px')
    el.style.setProperty('--map-legend-width',   '380px')
  } else if (width >= 500) {
    el.style.setProperty('--map-btn-size',       '36px')
    el.style.setProperty('--map-toolbar-gap',    '6px')
    el.style.setProperty('--map-font-md',        '12px')
    el.style.setProperty('--map-font-sm',        '10px')
    el.style.setProperty('--map-legend-width',   '360px')
  } else {
    el.style.setProperty('--map-btn-size',       '32px')
    el.style.setProperty('--map-toolbar-gap',    '5px')
    el.style.setProperty('--map-font-md',        '11px')
    el.style.setProperty('--map-font-sm',        '10px')
    el.style.setProperty('--map-legend-width',   '280px')
  }
}

// ─── Ready flag (controlled by us, not useMapInstance) ───────────────────────
const appReady = ref(false)
// Set when map init concludes it has failed. appReady alone cannot express this:
// it is false both while loading AND forever after a failure, so the loading
// overlay outlived every failure. Same `err` shape cities-internet already uses.
const mapError = ref(null)

// ─── Stores ───────────────────────────────────────────────────────────────────
const mapStore  = inject('mapStore')
const dataStore = inject('dataStore')
const uiStore   = inject('uiStore')
const mapTheme  = useMapTheme(uiStore)
// The simple map is always the dark (night) look — prayer, engagement and adoption share it.
mapTheme.setLook('dark')
// loc-012: feed the active locale into the bulk/list data fetch so the data the
// search bar searches comes back in the selected language — the same `lang` param
// the people-group detail fetch uses (PeopleGroupDetail.vue). null → API default.
const _apiLocale = (() => { const v = inject('lang', null)?.value; return (v && v !== 'en') ? v : null })()
const dsm       = new DataSourceManager({ locale: _apiLocale, profileConfig })

// ─── Map instance ─────────────────────────────────────────────────────────────
const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken: mapboxToken.value,
  // Boot the basemap on the persisted theme (shared useMapTheme) so a reload while
  // dark doesn't paint a light map under a dark UI.
  style: mapTheme.bootStyle(),
  config: mapTheme.bootConfig,   // pin lightPreset BEFORE the first frame (no day→night boot flash)
  center: [20, 10],
  zoom: 1.8,
  pitch:   profileConfig?.value?.pitch   ?? mapDefaults.pitch,
  bearing: profileConfig?.value?.bearing ?? mapDefaults.bearing,
  // Per-map zoom constraints: each map (simple, prayer)
  // defines its own min/max in profile-config so users don't get lost zooming
  // too far, and precise locations stay obfuscated. Falls back to mapDefaults.
  minZoom: profileConfig?.value?.minZoom ?? mapDefaults.minZoom,
  maxZoom: profileConfig?.value?.maxZoom ?? mapDefaults.maxZoom
})

const mapData = useMapData({
  mapId,
  dataSourceId: dataSource.value,
  dataSourceManager: dsm,
  dataStore,
  markRaw: (v) => v
})

const mapLayers = useMapLayers({
  getMap: () => map.value,
  mapId,
  getLanguageFamilyColor,
  getNormalizedPeopleGroups: () => mapData.normalizedPeopleGroups.value || []
})

// ─── Fly composable (an earlier fix — uniform legend-row camera) ─────────────
const mapFly = useMapFly({
  getMap: () => map.value,
  mapId,
  mapStore,
  defaultCenter: [20, 10],
  defaultZoom:   1.8
})

// ─── Country-outline composable (geoBoundaries ADM0 on country search) ───────
const countryOutline = useCountryOutline(() => map.value)

// ─── GO marker (selected pin highlight) ───────────────────────────────────────
const selectedPin = useSelectedPin({
  getMap: () => map.value,
  // Pass the active-tab colour resolver as an OPTION (not via inject). A Vue 3
  // component cannot inject its own provide, so inject('getActivePinColor') was
  // always null and the selected dot fell back to GO_ORANGE (#1a1a1a) black.
  getActivePinColor: (properties) => {
    const sk = activeTab.value?.colorStrategy
    const mode = sk === 'engagement' ? COLOR_MODES.ENGAGEMENT
              : sk === 'adoption'   ? COLOR_MODES.ADOPTION
              : COLOR_MODES.PRAYER_PROGRESS
    return getColorStrategy(mode)?.getColor?.(properties) ?? '#1a1a1a'
  }
})

// Stored so theme-swap can re-add layers after setStyle() clears them
let _lastNormalizedGroups = []

// ─── Image preloader — warms the browser cache for all people group photos ────
function preloadPeopleGroupImages(groups) {
  if (!groups?.length) return
  const PLACEHOLDER = 'NoImageAvailable'
  const urls = []
  const seen = new Set()

  for (const pg of groups) {
    let url = pg.imageUrl
    // If no direct URL or it's the placeholder, try JP fallback
    if (!url || url.includes(PLACEHOLDER)) {
      if (pg.peopleId3) {
        url = `https://joshuaproject.net/assets/media/profiles/photos/p${pg.peopleId3}.jpg`
      } else {
        continue // no usable URL — skip
      }
    }
    if (seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }

  if (!urls.length) return

  // Preload in idle-time batches so map render is not delayed
  let index = 0
  const BATCH = 25

  function loadBatch(deadline) {
    while (index < urls.length) {
      // Stop if the browser needs the thread back (requestIdleCallback path)
      if (deadline?.timeRemaining && deadline.timeRemaining() < 4) break
      const img = new Image()
      img.src = urls[index++]
    }
    if (index < urls.length) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(loadBatch, { timeout: 2000 })
      } else {
        setTimeout(loadBatch, 150)
      }
    }
  }

  // Delay first batch by 1 s so the map tiles finish loading first
  if (typeof requestIdleCallback !== 'undefined') {
    setTimeout(() => requestIdleCallback(loadBatch, { timeout: 3000 }), 1000)
  } else {
    setTimeout(() => {
      for (let i = 0; i < BATCH && index < urls.length; i++) {
        const img = new Image(); img.src = urls[index++]
      }
      if (index < urls.length) setTimeout(loadBatch, 150)
    }, 1000)
  }

}

// ─── Map controls ─────────────────────────────────────────────────────────────
// Store GETTER, not uiStore.theme raw — isDarkTheme honours the THEME_TOGGLE flag
// so a persisted theme:'dark' cannot drag the chrome back to dark. (Same bug as
// research-map.vue had.)
const isDark = computed(() => uiStore.isDarkTheme)

// `isDarkBasemap` = is the BASEMAP dark? DISTINCT from isDark (= is the CHROME dark).
// With THEME_TOGGLE off the basemap is PINNED to night/default while the chrome is
// forced light, so anything drawn ON the map (pin rings, widths, glows) must follow
// THIS, not the chrome. Keying pin strokes off isDark gave them the LIGHT-basemap
// treatment (thin hairline, dark ring on no-prayer pins) while sitting on a DARK
// map — which is why this map's pins looked flat yellow with no white ring while
// the research map looked right. Same fix already applied in research-map.vue.
const isDarkBasemap = computed(() =>
  THEME_TOGGLE ? uiStore.isDarkTheme : FIXED_BASEMAP.lightPreset === 'night')
watch(isDark, (dark) => { pplrInstance.theme.value = dark ? 'dark' : 'light' }, { immediate: true })

// ─── The Prayer look without a key ────────────────────────────────────────────
// On Mapbox this map is Standard at lightPreset 'night': near-black navy sea, slate land, rose
// borders — the "dark green" look this map must keep. Without a token the engine
// is MapLibre and the basemap is OpenFreeMap `fiord`, which is slate-blue everywhere (sea #38435c,
// land #45516e: 13 units apart, and blue-grey borders). These colours are MEASURED from the Mapbox
// render, not chosen: pixels of this leaf at its own world view on Mapbox (main 4ca2dcf9) read ocean
// #03112d / #020f2c, land #323f52, forest #2c3e3c / #32403a, and a 1px country border #c95d74.
// Our pins and glow are the same on both engines.
// ⚠ fiord draws no forest below zoom 10 (landcover_wood minzoom), so the faint green cast Mapbox
// shows on the Amazon and Congo at world view cannot be reproduced by recolouring; it appears once
// a reader zooms in.
// Layer ids are fiord's; applyStylePaint skips any the loaded style lacks, so a wrong guess is a
// no-op, never a throw.
const KEYLESS_NIGHT_PAINT = [
  { layer: 'background',            prop: 'background-color', value: '#323f52' },
  { layer: 'water',                 prop: 'fill-color',       value: '#03112d' },
  { layer: 'waterway',              prop: 'line-color',       value: '#0b1a36' },
  { layer: 'landcover_ice_shelf',   prop: 'fill-color',       value: '#3b4a5e' },
  { layer: 'landuse_residential',   prop: 'fill-color',       value: '#3a475b' },
  { layer: 'park',                  prop: 'fill-color',       value: '#2f403c' },
  { layer: 'landcover_wood',        prop: 'fill-color',       value: '#2c3e3c' },
  { layer: 'building',              prop: 'fill-color',       value: 'hsla(215,30%,15%,0.65)' },
  { layer: 'boundary_country_z0-4', prop: 'line-color',       value: '#c95d74' },
  { layer: 'boundary_country_z5-',  prop: 'line-color',       value: '#c95d74' },
  // Crisp and opaque: at 0.75 over fiord's blur the rose read as a faint mauve (#5b4659 against
  // the reference #934f66, measured side by side).
  { layer: 'boundary_country_z0-4', prop: 'line-opacity',     value: 1 },
  { layer: 'boundary_country_z5-',  prop: 'line-opacity',     value: 1 },
  { layer: 'boundary_country_z0-4', prop: 'line-blur',        value: 0 },
  { layer: 'boundary_country_z5-',  prop: 'line-blur',        value: 0 },
  // Country names light over a dark halo, as on the reference (fiord's are grey-blue).
  ...['place_country_major', 'place_country_minor', 'place_country_other'].flatMap((layer) => [
    { layer, prop: 'text-color',      value: '#dde1e7' },
    { layer, prop: 'text-halo-color', value: 'rgba(3,17,45,0.85)' },
  ]),
  { layer: 'boundary_state',        prop: 'line-color',       value: 'hsla(345,45%,60%,0.3)' },
]
// MapLibre only (it has no Standard config to set, the same test useMapTheme uses), and only on
// the DARK basemap: MapLibre's light style (liberty) shares ids like `water` and `background`.
function paintKeylessNight(m) {
  if (!m || typeof m.setConfigProperty === 'function' || !isDarkBasemap.value) return
  applyStylePaint(m, KEYLESS_NIGHT_PAINT)
  // fiord writes country names in capitals; the reference is mixed case. Layout, not paint, so it
  // is not in the list above; the same skip-if-absent rule applies.
  for (const id of ['place_country_major', 'place_country_minor', 'place_country_other']) {
    try { if (m.getLayer(id)) m.setLayoutProperty(id, 'text-transform', 'none') } catch (_) {}
  }
}
// SEAMLESS theme: the basemap lightPreset follows uiStore.theme reactively. NO setStyle
// reload → pins/glow never wiped, no flash, instant toggle.
watch(() => uiStore.theme, () => mapTheme.applyTheme(map.value))

// Theme-aware data-pin outline (Joshua Project uses a thin near-black outline
// that's barely visible; reverse-engineered).
// In dark mode the outline goes white so pins stay visible against dark
// basemaps. Boot style is light-v11, so the initial circle-stroke-color
// in addLanguageFamilyLayer is already 'rgba(0,0,0,0.45)' — this watcher
// just flips it on theme toggle.
function _applyPinStroke() {
  const m = map.value
  if (!m || !m.getLayer('language-family-pins')) return
  // Theme-aware subtle ring: DARK → white (all); LIGHT → has-prayer white, need-prayer dark.
  const stroke = isDarkBasemap.value
    ? '#ffffff'
    : ['case', ['>', ['to-number', ['get', 'peoplePraying'], 0], 0], '#ffffff', '#1f2937']
  m.setPaintProperty('language-family-pins', 'circle-stroke-color', stroke)
  // Thicken the white ring in DARK mode so intentionally-black pins (unmapped langs,
  // Sign Language, Deaf, Unknown) stay visible on the night basemap; keep the light
  // hairline. buildDarkRingWidth applies the active colour-strategy's exceptions
  // (prayer RED no-prayer pins stay thin). Colours unchanged — width only.
  m.setPaintProperty('language-family-pins', 'circle-stroke-width',
    isDarkBasemap.value ? buildDarkRingWidth(activeTab.value?.colorStrategy) : PIN_STROKE_WIDTH_LIGHT)
}
// Re-run on theme toggle AND tab switch (the prayer exception depends on the active tab).
watch(isDarkBasemap, _applyPinStroke, { immediate: false })
// ALSO re-run on tab switch: buildDarkRingWidth() applies the ACTIVE colour-strategy's
// exceptions (e.g. prayer's no-prayer RED pins stay thin), so the ring must be
// recomputed when the tab changes. research-map.vue already had this watcher;
// simple-map was missing it, so a tab switch left stale ring widths.
watch(() => activeTab.value?.id, _applyPinStroke)

/** Called by MapToolbar when the theme toggle button is clicked. */
function handleToggleTheme() {
  // Seamless: flip the theme + re-light the Standard basemap (day↔night) via setConfigProperty.
  // No setStyle reload, so nothing is torn down or re-added — the toggle is instant.
  mapTheme.swapTheme(map.value)
}

// ─── Search: people-group result handler ─────────────────────────────────────
// When the user selects a DOXA people-group result from the geocoder,
// Mapbox's built-in result-handling already flies the map to `feature.center`.
// We ALSO open the people-group detail popup via uiStore.selectPeopleGroup()
// and expand the legend (mobile) / dispatch the open-event (desktop) — mirrors
// the pin-click UX in useMapEvents.attachPinClickHandler.
function handlePeopleGroupResult(feature) {
  if (!feature || !uiStore) return
  // A people-group pick is "clicking elsewhere" — drop any country outline.
  countryOutline.clearCountry()
  uiStore.selectPeopleGroup(feature)
  if (uiStore.isMobile && uiStore.legendState === 'collapsed') {
    uiStore.setLegendState('open')
  }
  if (!uiStore.isMobile) {
    window.dispatchEvent(new CustomEvent('dxm:openDesktopLegend', { detail: { mapId } }))
  }
  // Highlight the matching pin on the map (ACTIVE_LAYER filter)
  try {
    const uid = feature?.properties?.uniqueId
    const m = map.value
    if (uid && m?.getLayer(ACTIVE_LAYER)) {
      m.setFilter(ACTIVE_LAYER, ['==', 'uniqueId', uid])
    }
  } catch (e) {
    // Highlight is a nice-to-have — a failure here shouldn't break the search flow
  }
}

// Clearing the search bar (X button) must also clear the selection + dim that
// was set by the last people-group result. Without this, the previously-selected
// pin stayed highlighted and all other pins stayed dim + animated indefinitely.
function handleSearchClear() {
  if (!uiStore) return
  // Drop the country boundary outline drawn by a country search pick.
  countryOutline.clearCountry()
  uiStore.selectPeopleGroup(null)   // closes popup + Go-pin highlight (via useSelectedPin watcher)
  try {
    const m = map.value
    if (m?.getLayer(ACTIVE_LAYER)) {
      m.setFilter(ACTIVE_LAYER, ['==', 'uniqueId', ''])
    }
  } catch (e) { /* no-op */ }
  clearAggregateFilter()
  if (!_currentFilter.key) {
    applyLegendFilter(null, null)
  }
}

// ─── Search: aggregate (country / language / religion) result handler ────────
// When the user picks a DOXA aggregate (e.g. "🌍 India (851)"), dim every pin
// EXCEPT those in the aggregate's member list, then fitBounds on the matching
// pins so they're all visible without being over-zoomed.
//
// No individual pin is highlighted — user clicks pins one-by-one afterwards
// to open popups. ACTIVE_LAYER is cleared here to make that work cleanly.
function handleAggregateResult(evt) {
  if (!evt || !map.value) return
  const { memberIds, bounds } = evt
  if (!Array.isArray(memberIds) || !memberIds.length) return

  const m = map.value

  // Country pick → draw the country boundary OUTLINE (geoBoundaries ADM0) and
  // fit to its bbox. Any other aggregate kind drops a prior outline so it only
  // ever shows for the live country selection.
  if (evt.kind === 'country') {
    const iso = resolveCountryIso(evt, mapData.normalizedPeopleGroups.value || [])
    if (iso) countryOutline.showCountry(iso)
  } else {
    countryOutline.clearCountry()
  }
  // Clear any single-pin highlight from a prior people-group search
  if (m.getLayer(ACTIVE_LAYER)) {
    m.setFilter(ACTIVE_LAYER, ['==', 'uniqueId', ''])
  }
  uiStore.selectPeopleGroup(null)  // close popup if open

  // Apply a per-feature case on the base layer: matched pins keep the tab's
  // color strategy; non-matched pins render as solid muted gray (theme-aware).
  const baseColor = getBaseColorExpr()
  const caseColor = [
    'case',
    ['in', ['get', 'uniqueId'], ['literal', memberIds]],
    baseColor,
    mutedGray()
  ]
  const caseOpacity = [
    'case',
    ['in', ['get', 'uniqueId'], ['literal', memberIds]],
    0.9,
    0.35
  ]
  // Stroke is the issue on dark mode: the default white ring on dim pins
  // glows against the dark basemap. Drop stroke to 0 on non-matched pins so
  // they read as flat gray dots, keeping the ring only on matched pins.
  const caseStrokeOpacity = [
    'case',
    ['in', ['get', 'uniqueId'], ['literal', memberIds]],
    1,
    0
  ]
  if (m.getLayer('language-family-pins')) {
    m.setPaintProperty('language-family-pins', 'circle-color',          caseColor)
    m.setPaintProperty('language-family-pins', 'circle-opacity',        caseOpacity)
    m.setPaintProperty('language-family-pins', 'circle-stroke-opacity', caseStrokeOpacity)
  }
  _aggregateFilterActive = true

  // Camera. A COUNTRY pick keeps its outline + bbox fit. Any other aggregate
  // (e.g. searching "Islam" → a globe-spanning religion) routes through the shared
  // robust legend-row camera so it eases to a stable world overview instead of a
  // snapping fitBounds — same fix (densest-bin center + no-copy zoom + easeTo) as
  // the legend rows, via the matched member pins.
  if (evt.kind === 'country' && Array.isArray(bounds) && bounds.length === 4) {
    const [minLng, minLat, maxLng, maxLat] = bounds
    try {
      m.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 6, duration: 1200 })
    } catch (e) { /* fitBounds can throw on degenerate single-point bounds */ }
  } else {
    mapFly.zoomToLegendRow?.({}, { matchExpr: ['in', ['get', 'uniqueId'], ['literal', memberIds]] })
  }
}

// The pins' resting opacity: the value the library creates the layer with (useMapLayers'
// language-family-pins). Every path that clears a filter restores this, so a cleared map looks
// exactly like a fresh one.
const PIN_REST_OPACITY = 1

// Un-apply the aggregate filter so the map returns to normal colors.
let _aggregateFilterActive = false
function clearAggregateFilter() {
  if (!_aggregateFilterActive) return
  const m = map.value
  if (!m?.getLayer('language-family-pins')) return
  m.setPaintProperty('language-family-pins', 'circle-color',          getBaseColorExpr())
  m.setPaintProperty('language-family-pins', 'circle-opacity',        PIN_REST_OPACITY)
  m.setPaintProperty('language-family-pins', 'circle-stroke-opacity', 1)
  _aggregateFilterActive = false
}

// ─── Breakpoint detection (matches reference app: window.innerWidth) ──────────
// Uses window.innerWidth directly — more reliable than container size for
// initial load in Shadow DOM where the container can briefly report 0px.
function _onBreakpointResize() {
  uiStore.updateBreakpoint(window.innerWidth)
}

onMounted(() => {
  uiStore.updateBreakpoint(window.innerWidth)
  if (uiStore.isMobile) uiStore.collapseLegend()
  else uiStore.openLegend()
  window.addEventListener('resize', _onBreakpointResize)
  // Container-size observer — sets CSS vars for responsive button/font scaling
  if (dsmRoot.value) {
    applyContainerScale(dsmRoot.value.offsetWidth)
    _containerObserver = new ResizeObserver(entries => {
      for (const entry of entries) applyContainerScale(entry.contentRect.width)
    })
    _containerObserver.observe(dsmRoot.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', _onBreakpointResize)
  _containerObserver?.disconnect()
  _containerObserver = null
})

const showHelpPopup  = ref(false)
const showSideMenu   = ref(false)

// ─── Keep the Mapbox Map OUT of Vue's reactive Proxy ─────────────────────────
// useMapInstance keeps the Map in a plain ref(), which deep-wraps it: every internal
// read/write inside Mapbox (style, painter, transform) then pays the Proxy get/set trap,
// and a render scheduled through the Proxy (ANY map.value.* call → triggerRepaint) draws
// the whole frame — and every frame it re-schedules until the map idles — through it.
// Measured (internal/long-frames-probe.mjs --profile): Vue's `get`/`set` traps were the
// two top self-time frames of the IDLE prayer map. Swap the raw instance back into the
// shared ref, marked raw so the ref never re-wraps it; useMapInstance's own map.value
// reads keep working. The ref must pass through null first: a ref compares against the
// RAW value it already holds, so re-assigning markRaw(toRaw(map.value)) alone is a
// no-op and the Proxy stays (verified against Vue 3.5). Synchronous, so nothing renders
// in between. Proper home: `shallowRef(null)` in useMapInstance.js — then this is a no-op.
function unwrapMap() {
  const raw = map.value ? toRaw(map.value) : null
  if (!raw || raw === map.value) return          // already raw (shallowRef upstream)
  map.value = null
  map.value = markRaw(raw)
}

// ─── Reload map ───────────────────────────────────────────────────────────────
async function handleReloadMap() {
  showSideMenu.value = false
  appReady.value = false
  destroy()
  await initializeMap()
  if (!map.value) return
  unwrapMap()
  const dataPromise = mapData.loadData().catch(() => ({ normalizedPeopleGroups: [] }))
  map.value.once('load', async () => {
    const { normalizedPeopleGroups } = await dataPromise
    await onMapReady(normalizedPeopleGroups)
  })
}

// ─── Tab switch ───────────────────────────────────────────────────────────────
function switchTab(tabId) {
  if (tabId === activeTabId.value) return
  activeTabId.value = tabId
  const tab = tabs.value.find(t => t.id === tabId)
  if (!tab || !map.value) return
  // Re-assert the pinned night look on every tab switch (config prop only, no reload).
  mapTheme.applyTheme(map.value)
  const strategyKey = tab.colorStrategy
  const colorMode =
    strategyKey === 'engagement' ? COLOR_MODES.ENGAGEMENT :
    strategyKey === 'adoption'   ? COLOR_MODES.ADOPTION :
    strategyKey === 'prayer'     ? COLOR_MODES.PRAYER_PROGRESS :
    COLOR_MODES.PRAYER_PROGRESS
  if (map.value.getLayer('language-family-pins')) {
    const colorExpr = buildColorExpression(colorMode)
    map.value.setPaintProperty('language-family-pins', 'circle-color', colorExpr)
    // Keep active + pulse layer colors in sync with base layer
    if (map.value.getLayer(ACTIVE_LAYER)) {
      map.value.setPaintProperty(ACTIVE_LAYER, 'circle-color', colorExpr)
    }
    PULSE_LAYERS.forEach(layerId => {
      if (map.value.getLayer(layerId)) {
        map.value.setPaintProperty(layerId, 'circle-color', colorExpr)
      }
    })
  }
  // Re-apply the theme-aware ring for the NEW tab's colour-strategy (so the prayer
  // RED-no-prayer thin-ring exception turns on/off as you enter/leave the prayer tab).
  _applyPinStroke()
  if (tab.id === 'prayer' || tab.colorStrategy === 'prayer') mapLayers.startPrayerGlow()
  else mapLayers.stopPrayerGlow()
}

// ─── Legend filter → dim/highlight pins ──────────────────────────────────────
// Layer stack (bottom → top):
//   language-family-pins-pulse  ← subtle breathing ring, below ALL pins (never overlaps dots)
//   language-family-pins        ← base layer, dimmed to 0.08 when filter active
//   language-family-pins-active ← matched pins on top: full opacity + theme-aware stroke
//
// Dim opacity is 0.08 — low enough that even dense cluster overlap can't fake a real pin.
// Pulse is opacity-only animation (0 → 0.28 sine wave) to avoid per-frame expression rebuilds.
// Stroke is white (#fff) on dark mode, near-black (#111) on light mode for clear contrast.

const ACTIVE_LAYER = 'language-family-pins-active'
const PULSE_LAYER  = 'language-family-pins-pulse'
const HITBOX_LAYER = 'language-family-pins-hitbox'

// Mirror a Mapbox filter expression to the invisible hitbox layer so dimmed
// (low-opacity) pins are no longer hit-testable. Pass `null` to restore the
// full-dataset hitbox (every pin selectable again).
function _syncHitboxFilter(m, filter) {
  if (m?.getLayer(HITBOX_LAYER)) {
    try { m.setFilter(HITBOX_LAYER, filter) } catch (_) {}
  }
}

let _pulseRaf      = null
let _pulsePhase    = 0
let _currentFilter = { type: null, key: null }

/**
 * 4 staggered pulse layers removed — per-feature modulo expressions on setFilter
 * caused visible lag on every legend click. Rolling wave deferred to future
 * WebGL custom layer implementation.
 */
const PULSE_BUCKET_COUNT = 1  // kept for future reference
const PULSE_LAYERS = [PULSE_LAYER]

// Pins slightly smaller — tighter at low zoom, comfortable at high zoom
const RADIUS_EXPR = [
  'interpolate', ['linear'], ['zoom'],
  0, 2.2, 2, 2.5, 4, 3, 5, 3.5, 6, 4.5, 7, 5.5, 8, 7, 10, 10, 12, 13, 14, 16
]

// Selected pins grow ~30% at every zoom stop — visible-without-overwhelming "pop".
// Used by ACTIVE_LAYER so matched/selected pins stand out from the dimmed base.
const ACTIVE_RADIUS_EXPR = [
  'interpolate', ['linear'], ['zoom'],
  0, 2.9, 2, 3.3, 4, 4, 5, 4.6, 6, 6, 7, 7.2, 8, 9, 10, 13, 12, 17, 14, 21
]

// Pulse ring ≈ 2× dot diameter (2× radius from center) — never "3-4× the dot"
const PULSE_RADIUS_EXPR = [
  'interpolate', ['linear'], ['zoom'],
  0, 4.4, 2, 5, 4, 6, 5, 7, 6, 9, 7, 11, 8, 14, 10, 20, 12, 26, 14, 32
]

/** 1–2px stroke — subtle at low zoom, slightly wider at high zoom */
const ACTIVE_STROKE_EXPR = [
  'interpolate', ['linear'], ['zoom'],
  0, 1, 6, 1.5, 12, 2
]

/**
 * Per-tier pulse ring color.
 * notEngaged / notAdopted use near-black pins → use a visible mid-tone
 * so the ring is distinguishable on both dark and light map backgrounds.
 */
const PULSE_COLORS = {
  prayer:     { noPrayer: '#f03b2d', hasPrayer: '#f0c64a', fullPrayer: '#27ae60' },
  engagement: { notEngaged: '#5c6bc0', hasEngagement: '#7c3aed' },
  adoption:   { notAdopted: '#78909c', hasAdoption: '#0d9488' }
}

/**
 * "Dark pin" filters — notEngaged and notAdopted use a near-black fill (#1a1a2e).
 * On ANY background a dark stroke is invisible → force white ring for those.
 * All other pins are colored (red/orange/green/purple/teal) → use theme stroke.
 */
const DARK_PIN_KEYS = new Set(['notEngaged', 'notAdopted'])

/**
 * Muted neutral used for NON-matched base pins when a legend filter is active
 * AND overlapDensity is OFF. A solid gray avoids the transparency-stacking
 * density bleed that washes out orange pins at overlaps.
 *
 * Light mode: light-gray reads as dimmed on the white basemap.
 * Dark mode:  darker gray reads as dimmed on the dark basemap (a light gray
 *             on dark mode renders almost WHITE and draws the eye — wrong).
 */
const MUTED_GRAY_LIGHT = '#b9bfc6'
const MUTED_GRAY_DARK  = '#4b5360'
function mutedGray() { return isDark.value ? MUTED_GRAY_DARK : MUTED_GRAY_LIGHT }

/**
 * Returns the base layer's full color expression for the currently active
 * tab's colorStrategy. Used to restore the base layer after a filter clears.
 */
function getBaseColorExpr() {
  const tab = activeTab.value
  const mode =
    tab?.colorStrategy === 'engagement' ? COLOR_MODES.ENGAGEMENT :
    tab?.colorStrategy === 'adoption'   ? COLOR_MODES.ADOPTION :
    COLOR_MODES.PRAYER_PROGRESS
  return buildColorExpression(mode)
}

function getFilterStrokeColor(filterType, filterKey) {
  // After round 5 the 'notEngaged' / 'notAdopted' pins are red (#e74c3c),
  // not near-black, so the DARK_PIN_KEYS exception that forced a white
  // outline for those keys no longer matches its original intent. All
  // filtered ACTIVE_LAYER overlays now use the same theme-aware stroke.
  return getStrokeColor()
}

/**
 * Returns stroke color for the current map theme.
 * With darkPinBorder feature OFF (default on doxa-simple-map), always returns
 * white — the pin stays visible without needing a dark ring in light mode.
 */
function getStrokeColor() {
  // Theme-aware subtle ring: DARK → white (all); LIGHT → has-prayer white, need-prayer dark.
  return isDark.value
    ? '#ffffff'
    : ['case', ['>', ['to-number', ['get', 'peoplePraying'], 0], 0], '#ffffff', '#1f2937']
}

/** Build the Mapbox filter expression for a given filter type + key */
function buildMatchExpr(filterType, filterKey) {
  if (filterType === 'prayer') {
    const pp = ['coalesce', ['to-number', ['get', 'peoplePraying'], 0], 0]
    if (filterKey === 'noPrayer')   return ['<=', pp, 0]
    if (filterKey === 'hasPrayer')  return ['all', ['>', pp, 0], ['<', pp, FULL_PRAYER_THRESHOLD]]
    if (filterKey === 'fullPrayer') return ['>=', pp, FULL_PRAYER_THRESHOLD]
  } else if (filterType === 'engagement') {
    const ev = ['get', 'engagementStatus']
    if (filterKey === 'hasEngagement') return ['any', ['==', ev, true], ['==', ev, 1]]
    if (filterKey === 'notEngaged')    return ['all', ['!=', ev, true], ['!=', ev, 1]]
  } else if (filterType === 'adoption') {
    const av = ['get', 'adoptionStatus']
    if (filterKey === 'hasAdoption') return ['any', ['==', av, true], ['==', av, 1]]
    if (filterKey === 'notAdopted')  return ['all', ['!=', av, true], ['!=', av, 1]]
  }
  return null
}

/**
 * Add single pulse layer BELOW language-family-pins.
 */
function initPulseLayer() {
  const m = map.value
  if (!m || m.getLayer(PULSE_LAYER)) return
  // Source must exist before we can add a layer referencing it
  if (!m.getSource('language-families')) return
  m.addLayer({
    id: PULSE_LAYER,
    type: 'circle',
    source: 'language-families',
    filter: ['==', 'uniqueId', ''],
    paint: {
      'circle-radius':  PULSE_RADIUS_EXPR,
      'circle-color':   '#ffffff',
      'circle-opacity': 0,
      // One render per write (see startPulse): no 300 ms default transition tail.
      'circle-opacity-transition': { duration: 0, delay: 0 }
    }
  }, 'language-family-pins')  // renders BELOW base pins
}

/** Add the active (selected-on-top) overlay layer; must be called after pins source exists */
function initActiveLayer() {
  if (!FEATURES.activeOverlayEmphasis) return
  const m = map.value
  if (!m) return
  // Source and base layer must exist before we add layers referencing them
  if (!m.getSource('language-families') || !m.getLayer('language-family-pins')) return

  // Pulse layer goes below pins, so init it first
  initPulseLayer()

  if (m.getLayer(ACTIVE_LAYER)) return
  const colorExpr = m.getPaintProperty('language-family-pins', 'circle-color')
                 ?? buildColorExpression(COLOR_MODES.PRAYER_PROGRESS)
  m.addLayer({
    id: ACTIVE_LAYER,
    type: 'circle',
    source: 'language-families',
    filter: ['==', 'uniqueId', ''],
    paint: {
      'circle-radius':         ACTIVE_RADIUS_EXPR,  // ~30% larger than base — "pop" on select
      'circle-color':          colorExpr,
      'circle-stroke-color':   getStrokeColor(),
      'circle-stroke-width':   ACTIVE_STROKE_EXPR,
      'circle-opacity':        1,
      'circle-stroke-opacity': 1
    }
  })
  // ACTIVE_LAYER is added last → naturally above all other layers
}

/** Stop rAF loop and hide pulse ring */
function stopPulse() {
  if (_pulseRaf) { cancelAnimationFrame(_pulseRaf); _pulseRaf = null }
  const m = map.value
  if (m?.getLayer(PULSE_LAYER)) {
    m.setFilter(PULSE_LAYER, ['==', 'uniqueId', ''])
    m.setPaintProperty(PULSE_LAYER, 'circle-opacity', 0)
  }
}

/**
 * Simple scalar sine pulse — single layer, one setPaintProperty per STEP.
 * Smooth slow wave: 0.175 rad/step at 12 steps/s ≈ 3 s cycle (same wave the old
 * 0.035 rad/frame gave at 60 fps). Throttled like the prayer glow in useMapLayers:
 * every paint write re-renders the whole style, so writing at rAF rate never let the
 * map idle. Uses plain sin so the ring fades in and out continuously — no strobing.
 */
const WAVE_PEAK      = 0.40
const PULSE_STEP_MS  = 1000 / 12
const PULSE_STEP_RAD = 0.175

function startPulse(matchFilter, hexColor) {
  stopPulse()
  const m = map.value
  if (!m?.getLayer(PULSE_LAYER)) return
  m.setFilter(PULSE_LAYER, matchFilter)
  m.setPaintProperty(PULSE_LAYER, 'circle-color', hexColor)
  _pulsePhase = 0
  let last = -Infinity
  ;(function tick(now = performance.now()) {
    if (now - last < PULSE_STEP_MS) { _pulseRaf = requestAnimationFrame(tick); return }
    last = now
    _pulsePhase += PULSE_STEP_RAD
    const opacity = ((Math.sin(_pulsePhase) + 1) / 2) * WAVE_PEAK
    m.setPaintProperty(PULSE_LAYER, 'circle-opacity', opacity)
    _pulseRaf = requestAnimationFrame(tick)
  })()
}

function clearActiveLayer() {
  stopPulse()
  const m = map.value
  if (m?.getLayer(ACTIVE_LAYER)) m.setFilter(ACTIVE_LAYER, ['==', 'uniqueId', ''])
}

/**
 * Dim/highlight pins when a legend filter card is clicked.
 * - Base: 0.08 opacity — dense overlaps can't fake a solid dot
 * - Pulse ring: subtle breathing in the tier's own color, rendered BELOW all pins
 * - Active layer: matched pins at full opacity + theme-aware contrast stroke (top of stack)
 */
function applyLegendFilter(filterType, filterKey) {
  const m = map.value
  if (!m || !m.getLayer('language-family-pins')) return

  if (!filterKey) {
    _currentFilter = { type: null, key: null }
    m.setPaintProperty('language-family-pins', 'circle-color', getBaseColorExpr())
    m.setPaintProperty('language-family-pins', 'circle-opacity', PIN_REST_OPACITY)
    m.setPaintProperty('language-family-pins', 'circle-stroke-opacity', 1)
    _syncHitboxFilter(m, null)
    mapLayers.syncGlowFilter(null)
    clearActiveLayer()
    return
  }

  const matchExpr = buildMatchExpr(filterType, filterKey)
  if (!matchExpr) {
    _currentFilter = { type: null, key: null }
    m.setPaintProperty('language-family-pins', 'circle-color', getBaseColorExpr())
    m.setPaintProperty('language-family-pins', 'circle-opacity', PIN_REST_OPACITY)
    m.setPaintProperty('language-family-pins', 'circle-stroke-opacity', 1)
    _syncHitboxFilter(m, null)
    mapLayers.syncGlowFilter(null)
    clearActiveLayer()
    return
  }

  _currentFilter = { type: filterType, key: filterKey }

  // FEATURES.activeOverlayEmphasis OFF (default): dim non-matched pins on
  // the base layer via a 'case' expression — no overlay, no pulse, no
  // thicker stroke. Matched pins stay at the same style as unfiltered.
  if (!FEATURES.activeOverlayEmphasis) {
    m.setPaintProperty('language-family-pins', 'circle-color', getBaseColorExpr())
    m.setPaintProperty('language-family-pins', 'circle-opacity',
      ['case', matchExpr, 1, 0.06])
    m.setPaintProperty('language-family-pins', 'circle-stroke-opacity',
      ['case', matchExpr, 1, 0.06])
    // Restrict the invisible hitbox layer to the matched bucket so dimmed
    // (low-opacity) pins are no longer hit-testable. Without this the user
    // can tap an apparent empty area to select a near-invisible pin.
    _syncHitboxFilter(m, matchExpr)
    mapLayers.syncGlowFilter(matchExpr)
    return
  }

  // Legacy overlay-based emphasis path (kept behind the flag).
  if (FEATURES.overlapDensity) {
    m.setPaintProperty('language-family-pins', 'circle-opacity', 0.08)
    m.setPaintProperty('language-family-pins', 'circle-stroke-opacity', 0.05)
  } else {
    m.setPaintProperty('language-family-pins', 'circle-color', mutedGray())
    m.setPaintProperty('language-family-pins', 'circle-opacity', 0.85)
    m.setPaintProperty('language-family-pins', 'circle-stroke-opacity', 0)
  }

  if (m.getLayer(ACTIVE_LAYER)) {
    m.setFilter(ACTIVE_LAYER, matchExpr)
    m.setPaintProperty(ACTIVE_LAYER, 'circle-stroke-color', getFilterStrokeColor(filterType, filterKey))
  }

  const pulseColor = PULSE_COLORS[filterType]?.[filterKey] ?? '#888888'
  startPulse(matchExpr, pulseColor)
}

// Re-apply the legend selection recolor when the user toggles dark/light mode.
// BUG FIX (bug-legend-theme-swap-grey-pins): the old partial re-assert set the WHOLE
// 'language-family-pins' layer to a flat mutedGray() whenever a filter was active. That
// is only correct for the legacy overlay path (activeOverlayEmphasis ON), where the base
// layer IS muted and matched pins are drawn on ACTIVE_LAYER. In the DEFAULT path
// (activeOverlayEmphasis OFF — the live config) the base layer must keep
// getBaseColorExpr() and dim NON-matched pins via circle-opacity; flattening it to
// mutedGray() greyed the MATCHED pins too. So when a filter is active, re-run the FULL
// applyLegendFilter() — it re-applies the complete, theme-correct recolor (base color +
// opacity dim + matched ACTIVE_LAYER stroke + glow/hitbox/pulse) for whichever path is on.
watch(isDark, () => {
  const m = map.value
  if (!m) return
  if (_currentFilter.key) {
    applyLegendFilter(_currentFilter.type, _currentFilter.key)
  }
})

watch(() => uiStore.prayerFilter,     (k) => applyLegendFilter('prayer',     k))
watch(() => uiStore.engagementFilter, (k) => applyLegendFilter('engagement', k))
watch(() => uiStore.adoptionFilter,   (k) => applyLegendFilter('adoption',   k))

// ─── Post-map-load setup (cloned from MapComponent.onMapReady) ────────────────
async function onMapReady(normalizedPeopleGroups) {
  // Register map with store
  mapStore.registerMap(mapId, map.value)
  // Apply the persisted theme's lightPreset now the Standard style has loaded, so a
  // reload while dark was selected boots the NIGHT basemap (no light-under-dark desync).
  // (bug-ghost-rings-standard-style — Option B.)
  mapTheme.applyTheme(map.value)

  // Projection — safe guard
  try {
    // ★ WAS UNGUARDED: a bare string THROWS on MapLibre, so this line could error the page.
    setProjectionOn(map.value, 'mercator')   // per-engine shape: library/useMapProvider (C2)
  } catch (e) {
  }

  // Add people group pins
  if (normalizedPeopleGroups?.length) {
    _lastNormalizedGroups = normalizedPeopleGroups
    const firstTab = tabs.value[0]
    const initMode =
      firstTab?.colorStrategy === 'engagement' ? COLOR_MODES.ENGAGEMENT :
      firstTab?.colorStrategy === 'adoption'   ? COLOR_MODES.ADOPTION :
      COLOR_MODES.PRAYER_PROGRESS
    mapLayers.addLanguageFamilyLayer(normalizedPeopleGroups, initMode)
    // On a DARK boot the theme-watcher (immediate:false) hasn't run — apply the dark
    // ring (white colour + THICK width) now, else black pins are left with the light
    // hairline on the night basemap. _applyPinStroke handles both themes + the prayer
    // exception, and sets the ring width as well as the colour.
    _applyPinStroke()
    // SHELVED: idle preloader caused slow startup — re-enable when pray-tools API is active
    // and only for groups that have confirmed valid image URLs
    // preloadPeopleGroupImages(normalizedPeopleGroups)
  } else {
  }

  // Initialize GO marker highlight layer (after language-families source is added)
  selectedPin.initialize()

  // Add active (selected-on-top) layer after pins source exists
  initActiveLayer()

  // Apply basemap locale (translates country/place names on the tiles).
  applyBasemapLocale(locale.value)

  // Mark app ready → v-if gates open, legend mounts
  mapStore.setMapReady(mapId)
  appReady.value = true

  // Start prayer glow if initial tab is prayer
  if (activeTab.value?.id === 'prayer' || activeTab.value?.colorStrategy === 'prayer') {
    mapLayers.startPrayerGlow()
  }
}

// Live-switch basemap labels if locale changes during the session
// (page usually reloads on Polylang switch, but this keeps things robust).
watch(locale, (loc) => applyBasemapLocale(loc))

// ─── "What can this map do?" is on its way ────────────────────────────────────
// The control column (with its ⓘ on top) renders only at appReady, after the style AND the people-group
// data, which can take tens of seconds on a slow phone. So at mount this map tells the gallery's MapInfo
// that a control is COMING, and the MapInfo waits for the map rather than a clock, instead of showing its
// floating ⓘ and swapping it out later. A known failure (mapError) or an unmount withdraws the promise, so
// the floating ⓘ shows at once: there is always a way to open the popup. With no MapInfo (a standalone
// page) nothing answers and nothing changes.
function announceInfoPending(pending) {
  const el = dsmRoot.value
  if (!el) return
  try { el.dispatchEvent(new CustomEvent('dxmaps:mapinfo-pending', { bubbles: true, composed: true, detail: { pending } })) } catch { /* no CustomEvent */ }
}
// A MapInfo that mounted after this map asked into the void; it announces itself, and we answer again.
const reannounceInfoPending = () => { if (!appReady.value && !mapError.value) announceInfoPending(true) }
watch(mapError, (e) => { if (e) announceInfoPending(false) })

// ─── Lifecycle — cloned from MapComponent.mounted ─────────────────────────────
onMounted(async () => {
  announceInfoPending(true)
  window.addEventListener('dxmaps:mapinfo-host', reannounceInfoPending)
  activeTabId.value = tabs.value[0]?.id ?? 'prayer'
  // Initial breakpoint — will be refined immediately by ResizeObserver below
  uiStore.updateBreakpoint(window.innerWidth)

  // 1. Start data loading immediately (runs in parallel with map init)
  const dataPromise = mapData.loadData().catch(err => {
    console.error('[doxa-simple-map] Data load failed:', err)
    return { normalizedPeopleGroups: [] }
  })

  // 2. Initialize map (returns before 'load' fires)
  // ★ A PANE RELEASED WHILE ITS MAP IS STILL STARTING IS A CANCEL, NOT A FAILURE. This map is a heavy
  // gallery tab: switching away empties its slot. initializeMap then returns SILENTLY (useMapInstance's
  // liveness checks) and leaves map.value null, which this reported as "Map failed to initialize —
  // check token and container": a console ERROR blaming the token for a tab switch (measured on
  // a phone in Arabic, switched away 150 and 500 ms in: 2 runs in 10; 0 when the map was
  // left to start). Nobody is waiting for this map any more, so return quietly. A mounted pane that
  // really fails still logs.
  const released = () => !mapContainer.value || !mapContainer.value.isConnected
  try {
    await initializeMap()
  } catch (err) {
    if (released()) return
    // `new mapboxgl.Map()` throws outright when the device has no WebGL context.
    console.error('[doxa-simple-map] Map failed to initialize —', err)
    mapError.value = String(err?.message || err)
    return
  }
  unwrapMap()

  if (!map.value) {
    if (released()) return
    console.error('[doxa-simple-map] Map failed to initialize — check token and container')
    mapError.value = t('simpleMap.initFailed')
    return
  }
  // Every style (re)load, not once: a later setStyle would otherwise bring fiord's blue back.
  map.value.on('style.load', () => paintKeylessNight(map.value))

  // 3. After 'style.load': add layers, register, set ready.
  //    Using style.load (fires when style JSON + sprites are ready) instead of
  //    'load' (fires after all tiles render) — pins are GeoJSON so they don't
  //    need tiles, this saves 1-4 seconds on first paint.
  map.value.once('style.load', async () => {
    try {
      const { normalizedPeopleGroups } = await dataPromise
      await onMapReady(normalizedPeopleGroups)
    } catch (err) {
      console.error('[doxa-simple-map] onMapReady failed:', err)
      mapError.value = String(err?.message || err)
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('dxmaps:mapinfo-host', reannounceInfoPending)
  if (!appReady.value) announceInfoPending(false)
  mapLayers.stopPrayerGlow()
  clearActiveLayer()
  mapStore.unregisterMap(mapId)
  selectedPin.cleanup()
  destroy()
})
</script>

<template>
  <div
    ref="dsmRoot"
    class="dsm-root"
    :class="{ 'dsm-dark': isDark, 'dsm-rtl': isRTL, 'dsm-no-geocoder': !FEATURES.geocoder }"
    :dir="isRTL ? 'rtl' : 'ltr'"
  >

    <!-- In-map tab bar (only when 2+ tabs) -->
    <div v-if="showTabBar" class="dsm-tab-bar" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="dsm-tab"
        :class="{ active: activeTabId === tab.id }"
        :aria-selected="activeTabId === tab.id ? 'true' : 'false'"
        @click="switchTab(tab.id)"
      >
        {{ tabLabel(tab) }}
      </button>
    </div>

    <!-- Map area -->
    <div class="dsm-map-area">
      <div v-if="!appReady && !mapError" class="dsm-loading">{{ t('simpleMap.loading') }}</div>
      <div v-if="mapError" class="dsm-error">{{ t('allPeopleGroups.loadError') }} {{ mapError }}</div>
      <div ref="mapContainer" class="dsm-map-canvas" />

      <!-- Geocoder search bar — added to top-left first so hamburger floats right of it.
           Supplements Mapbox's place results with DOXA people-group / country /
           language / religion matches via the localGeocoder option (see
           GeocoderComponent + useEntitySearch composable). When the user picks
           a people-group result we open the detail popup in addition to the
           default flyTo behavior. -->
      <GeocoderComponent
        v-if="FEATURES.geocoder && appReady && map"
        :map-instance="map"
        :access-token="mapboxToken"
        :is-dark="isDark"
        :data-source-id="dataSource"
        @people-group-result="handlePeopleGroupResult"
        @aggregate-result="handleAggregateResult"
        @clear="handleSearchClear"
      />

      <!-- Hamburger menu toggle — feature-flagged off on doxa-simple-map.
           With flag off, the search bar alone fills the top-left slot. -->
      <HamburgerButton
        v-if="FEATURES.hamburgerMenu && appReady && map"
        :map="map"
        :is-open="showSideMenu"
        :is-dark="isDark"
        @toggle="showSideMenu = !showSideMenu"
      />

      <!-- Side menu drawer — only rendered when hamburger feature is on -->
      <SideMenuDrawer
        v-if="FEATURES.hamburgerMenu && appReady"
        :is-open="showSideMenu"
        :is-dark="isDark"
        @close="showSideMenu = false"
        @reload-map="handleReloadMap"
      />

      <!-- Desktop legend: STL for list view, LegendDesktop only for detail mode -->
      <div class="dsm-legend-desktop-slot">
        <LegendDesktop
          v-if="appReady && uiStore.legendMode === 'detail' && uiStore.selectedPeopleGroup"
          :legend-type="activeLegendType"
          :popup-action="activePopupAction"
          :initially-collapsed="false"
          :is-dark="isDark"
        />
        <!-- v-show MUST sit on a wrapper <div> (element root), NOT on the
             <SemanticTreeLegend> component: its template root is a fragment
             (single .stl-panel + a trailing comment), so a runtime directive on
             the component silently no-ops (Vue warn: "non-element root node") and
             broke the legend select/deselect round-trip (pins never restored).
             Mirrors the WORKING research-map pattern (research-map.vue:2282). -->
        <div v-show="!(uiStore.legendMode === 'detail' && uiStore.selectedPeopleGroup)">
          <SemanticTreeLegend
            v-if="appReady"
            :nodes="legendNodes"
            :tabs="null"
            :title="legendTitle"
            :hideTabs="true"
            :columnLabel="legendColumnLabel"
            :progress="legendProgress"
            :open="_stlOpen"
            @select="onSemanticTreeSelect"
            @update:open="_onStlOpenChange"
          />
        </div>
      </div>
      <!-- Mobile legend: bottom-sheet with LegendMobile (matches research map) -->
      <div class="dsm-legend-mobile-slot">
        <LegendMobile
          v-if="appReady"
          :legend-type="activeLegendType"
          :popup-action="activePopupAction"
          :is-dark="isDark"
        />
      </div>

      <!-- Left/right scroll edges for mobile page scrolling -->
      <div class="map-scroll-edge map-scroll-edge--left" />
      <div class="map-scroll-edge map-scroll-edge--right" />

      <!-- Map controls — each button is an explicit instance bound to THIS map.
           MapToolbar is a layout-only shell (positioned column + slot).
           Binding :map="map" here guarantees that in a multi-map profile
           these buttons operate ONLY on their own map instance. -->
      <!-- :has-geocoder mirrors the FEATURES.geocoder flag so the toolbar
           collapses its mobile top offset when no search pill is rendered.
           When the flag is flipped back on, the toolbar reserves space
           below the geocoder again with no further changes here. -->
      <!-- Round, spaced controls (the library default) at every width: the grouped square card reads
           too compact, on phones most of all.
           The TOP control is "What can this map do?": it opens the gallery's MapInfo for this tab,
           which then hides its own floating button. It renders only where a MapInfo answers it, so a
           standalone page (DX Life's home, the leaf) has no dead button. -->
      <MapToolbar v-if="appReady" :has-geocoder="FEATURES.geocoder">
        <MapInfoButton     :is-dark="isDark" :standalone="!!ownInfo" @standalone="(on) => (infoLocal = on)" />
        <ZoomInButton      :map="map"          :is-dark="isDark" />
        <ZoomOutButton     :map="map"          :is-dark="isDark" />
        <LocationButton    :map="map"          :is-dark="isDark" />
        <FullscreenButton  :map-container="mapContainer" :is-dark="isDark" />
        <ThemeToggleButton :is-dark="isDark"   @toggle="handleToggleTheme" />
        <!-- Share / embed control. Gets the ACTIVE tab's tree-relative instance page
             (shareEmbedPath above), so prayer/engagement/adoption each share their
             own standalone page; a host-supplied profileConfig.shareUrl still wins. -->
        <ShareButton       :is-dark="isDark" :embed-path="shareEmbedPath" />
        <!-- "About this map" info button — feature-flagged off on this profile -->
        <HelpButton v-if="FEATURES.infoButton" :is-dark="isDark" @open-help="showHelpPopup = true" />
      </MapToolbar>
      <!-- The map's own "What can this map do?" popup, only where no host answers its ⓘ control (an embed, a
           standalone preset page). A sibling of the toolbar, so the control's announce reaches it. -->
      <MapInfo v-if="infoLocal && ownInfo" trigger="control" popup-only v-bind="ownInfo" :locale="locale" />

      <!-- Help popup modal -->
      <div v-if="showHelpPopup" class="dsm-help-overlay" @click.self="showHelpPopup = false">
        <div class="dsm-help-modal">
          <button class="dsm-help-close" :aria-label="t('buttons.close')" @click="showHelpPopup = false">×</button>
          <h2>{{ t('buttons.aboutThisMap') }}</h2>
          <p>{{ t('simpleMap.help.what') }}</p>
          <p>{{ t('simpleMap.help.how') }}</p>
          <p>{{ t('simpleMap.help.source') }} <strong dir="ltr">pray.doxa.life</strong>.</p>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.dsm-root { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; }
.dsm-tab-bar { flex: 0 0 auto; display: flex; align-items: center; background: #fff; border-bottom: 2px solid #e0e0e0; box-shadow: 0 2px 4px rgba(0,0,0,.08); height: 48px; padding: 0 12px; gap: 4px; z-index: 10; }
.dsm-tab { background: none; border: none; padding: 0 20px; height: 100%; font-size: 14px; font-weight: 500; color: #555; cursor: pointer; border-bottom: 3px solid transparent; transition: color .15s, border-color .15s, background .15s; white-space: nowrap; }
.dsm-tab:hover  { background: rgba(52,152,219,.06); color: #3498db; }
.dsm-tab.active { color: #3498db; border-bottom-color: #3498db; background: rgba(52,152,219,.06); }
.dsm-map-area   { flex: 1 1 0; position: relative; overflow: hidden; }
.dsm-map-canvas { position: absolute; inset: 0; }
.dsm-loading    { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #f3f3f1; color: #6d766e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; z-index: 5; }
.dsm-error      { position: absolute; top: 50%; left: 12px; right: 12px; z-index: 7; transform: translateY(-50%); text-align: center; font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #7f1d1d; background: rgba(255,255,255,.94); border: 1px solid rgba(127,29,29,.25); border-radius: 10px; padding: 12px 14px; box-shadow: 0 2px 10px rgba(0,0,0,.16); }
</style>
