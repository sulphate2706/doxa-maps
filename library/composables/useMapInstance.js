/**
 * useMapInstance.js — Map Initialization Composable
 *
 * Manages a single Mapbox GL map instance lifecycle.
 * Scoped by mapId — safe to use multiple times on the same page.
 *
 * SHADOW DOM NOTES:
 *
 * 1. Container ID: Mapbox's `new mapboxgl.Map({ container: 'id' })` uses
 *    document.getElementById() which CANNOT cross shadow boundaries.
 *    Always pass the actual DOM element via a Vue template ref.
 *
 * 2. CSS timing: The Mapbox GL CSS <link> loads asynchronously. If Mapbox
 *    initializes before the CSS is applied, _detectMissingCSS fires and the
 *    canvas is sized to 0. This composable injects the CSS into the shadow
 *    root and waits for it to load before creating the Map instance.
 *
 * 3. Canvas resize: Even with correct CSS, the canvas may init at the wrong
 *    size if the container layout settles after initialization. map.resize()
 *    is called on the load event to correct this.
 *
 * Usage:
 *   const containerRef = ref(null)
 *   const { map, isMapReady, initializeMap, destroy } = useMapInstance({ containerRef, accessToken, ... })
 *   onMounted(() => initializeMap())
 */

import { ref, shallowRef, inject, watch } from 'vue'
import { useEdgeScrollAffordance } from './useEdgeScrollAffordance.js'

// ─── Engine registry (provider → CDN script + css + global) ──────────────────
// The map engine is loaded as a page global (CDN <script>). Profiles / index.html
// may preload it; if absent we inject it here. Mapbox is the default — its URLs
// match the existing <script> tags so nothing double-loads or changes.
// URLs and their integrity hashes come from ONE place (library/constants/cdn.js): exact versions, SRI.
const ENGINES = {
  mapbox:   { global: 'mapboxgl',   js: CDN.mapboxGlJs.url,   css: CDN.mapboxGlCss.url },
  maplibre: { global: 'maplibregl', js: CDN.maplibreGlJs.url, css: CDN.maplibreGlCss.url },
}

// THE ENGINE'S OWN CONTROL LABELS ("Zoom in", "Toggle attribution", the gesture hints…) in the reader's
// language. Both engines take a `locale` map of their UI strings at construction; without one they stay
// English under ar/es (row 30). Strings live in library/i18n/locales/<lc>/mapui.json. The keys are
// the engines' own; an engine ignores the ones it does not use. EXPORTED for the maps built RAW
// (new gl.Map outside this composable, e.g. gospel-resources, cities-internet): pass
// `locale: engineUiLocale(lang, provider)` to their constructor, or their controls stay English.
const ENGINE_UI_KEYS = {
  'Map.Title': 'map', 'Marker.Title': 'marker', 'Popup.Close': 'closePopup',
  'NavigationControl.ZoomIn': 'zoomIn', 'NavigationControl.ZoomOut': 'zoomOut', 'NavigationControl.ResetBearing': 'resetBearing',
  'AttributionControl.ToggleAttribution': 'toggleAttribution', 'AttributionControl.MapFeedback': 'mapFeedback',
  'FullscreenControl.Enter': 'enterFullscreen', 'FullscreenControl.Exit': 'exitFullscreen',
  'GeolocateControl.FindMyLocation': 'findMyLocation', 'GeolocateControl.LocationNotAvailable': 'locationNotAvailable',
  'GlobeControl.Enable': 'enableGlobe', 'GlobeControl.Disable': 'disableGlobe',
  'CooperativeGesturesHandler.WindowsHelpText': 'ctrlScroll', 'CooperativeGesturesHandler.MacHelpText': 'cmdScroll',
  'CooperativeGesturesHandler.MobileHelpText': 'twoFingers',
  // Mapbox's names for the same gesture hints
  'ScrollZoomBlocker.CtrlMessage': 'ctrlScroll', 'ScrollZoomBlocker.CmdMessage': 'cmdScroll', 'TouchPanBlocker.Message': 'twoFingers',
}
export function engineUiLocale(lang, provider) {
  const out = {}
  for (const [engineKey, ours] of Object.entries(ENGINE_UI_KEYS)) {
    const v = tStatic(`mapui.${ours}`, lang)
    if (v) out[engineKey] = v
  }
  // The logo's label names its own engine ("Mapbox homepage" / "MapLibre logo"): one key, two meanings.
  const logo = tStatic(provider === 'maplibre' ? 'mapui.maplibreLogo' : 'mapui.mapboxHomepage', lang)
  if (logo) out['LogoControl.Title'] = logo
  return out
}

// ONE MAPBOX WORDMARK PER PAGE: every map instance renders its own logo, so a
// page composing several maps stacks duplicates. First live instance keeps the
// logo (Mapbox attribution satisfied once per document); later ones hide theirs
// and release the claim on destroy so the badge never disappears entirely.
function claimLogo(mapInstance) {
  if (typeof window === 'undefined') return
  const w = window
  const hide = () => {
    try {
      const el = mapInstance.getContainer().querySelector('.mapboxgl-ctrl-logo, .maplibregl-ctrl-logo')
      if (el) el.style.display = 'none'
    } catch (_) {}
  }
  if (w.__doxaLogoOwner && w.__doxaLogoOwner !== mapInstance) { mapInstance.once('load', hide); hide(); return }
  w.__doxaLogoOwner = mapInstance
  mapInstance.once('remove', () => { if (w.__doxaLogoOwner === mapInstance) w.__doxaLogoOwner = null })
}

const MAPBOX_CSS_URL = ENGINES.mapbox.css
// Free basemap for MapLibre (no token). Deliberately NOT the hand-tuned Mapbox
// style — see the provider notes; a MapLibre map looks different by design.
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
// The dark counterpart. `fiord` rather than `dark`: side by side at world zoom, `dark` is
// near-black land against near-black water while fiord separates them and keeps labels legible
// in both Latin and native script — the same reasoning recorded in library/styles/registry.js.
const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/fiord'

// Named styles: the 12-style pack. A profile-config style of 'ink' /
// 'midnight-glow' / … resolves per engine here; raw URLs pass through.
import { resolveNamedStyle, applyStylePaint } from '../styles/registry.js'
import { resolveMapProvider, explicitMapProvider } from './useMapProvider.js'
import { CDN, pinElement } from '../constants/cdn.js'
import { installRtlTextPlugin } from '../maps/rtl-text.js'
import { localizeBasemapLabels } from '../maps/localize-labels.js'
import { tStatic } from '../i18n/index.js'

/**
 * The live engine global for a provider, or undefined if not yet loaded.
 * EXPORTED for the profiles that build their map RAW (new gl.Map) instead of through this
 * composable — my-upg-100-list is one. They still need the RIGHT engine for the selected provider,
 * and the alternative is a second copy of the ENGINES table living in a profile, which is how two
 * copies of one fact drift apart. Borrow the loader; do not re-declare the registry.
 */
export function engineGlobal(provider) {
  const name = ENGINES[provider]?.global || ENGINES.mapbox.global
  return typeof window !== 'undefined' ? window[name] : undefined
}

/**
 * The engine's stylesheet URL, for the one case the loader above cannot serve:
 * a map living inside a SHADOW ROOT.
 *
 * ★ WHY THIS EXISTS. ensureEngineScript appends the stylesheet to document.head, and a
 * document stylesheet DOES NOT CROSS A SHADOW BOUNDARY — so a profile that renders its map in a
 * shadow root has to inject its own copy, and until now it did that by writing the URL out a
 * second time. The two copies drifted: upg-100-list pinned v3.3.0 while every production loader
 * moved to v3.24.0.
 *
 * MEASURED 2026-09-24 on the live upg-100-list leaf, which is what the version skew actually costs:
 * mapboxgl.version 3.24.0 running against v3.3.0 CSS, .mapboxgl-canvas-container computed
 * position:STATIC where Mapbox declares it absolute, .mapboxgl-canary at display:block (that
 * canary is Mapbox's OWN unstyled-detector), Mapbox's "missing CSS declarations" warning firing,
 * and 0 markers — because a canvas container with no positioning context gives every
 * absolutely-positioned child, .mapboxgl-marker included, nothing to anchor to. It showed as the
 * polygons, the map colours and the pins all missing.
 *
 * Returns null for an engine with no stylesheet, so callers can skip injection rather than
 * inject undefined.
 */
export function engineStylesheetUrl(provider) {
  return (ENGINES[provider] || ENGINES.mapbox).css || null
}

/**
 * Ensures the engine's CDN <script> (+ head css) is loaded for the provider.
 * Idempotent — resolves immediately if the global already exists (preloaded via
 * index.html), otherwise injects the script and awaits its load event.
 */
export async function ensureEngineScript(provider) {
  const cfg = ENGINES[provider] || ENGINES.mapbox
  if (engineGlobal(provider)) return                 // already loaded — no-op
  if (typeof document === 'undefined') return

  if (!document.querySelector(`link[href="${cfg.css}"]`)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = cfg.css
    pinElement(link, cfg.css)
    document.head.appendChild(link)
  }

  const existing = document.querySelector(`script[src="${cfg.js}"]`)
  if (existing) {
    if (engineGlobal(provider)) return
    await new Promise(resolve => {
      existing.addEventListener('load',  resolve, { once: true })
      existing.addEventListener('error', resolve, { once: true })
    })
    return
  }

  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = cfg.js
    pinElement(s, cfg.js)
    s.async = false
    s.addEventListener('load',  resolve, { once: true })
    s.addEventListener('error', () => reject(new Error(`[useMapInstance] Failed to load ${provider} engine script`)), { once: true })
    document.head.appendChild(s)
  })
}

/**
 * Injects the engine's GL CSS into the shadow root that contains the given
 * element, then waits for it to finish loading.
 *
 * - Skips if the element is in the regular document (no shadow root).
 * - Skips if the CSS link is already present and loaded (idempotent).
 * - Always resolves — never hangs (2 s timeout fallback).
 */
// EXPORTED (2026-09-25) for the profiles that build their map RAW (new gl.Map) instead of through
// useMapInstance: cities-internet/connectivity-map and gospel-resources/resources-map. They never
// injected the engine stylesheet into their shadow root, so Mapbox's CSS canary reported "missing
// CSS declarations" (verify-map-paint) and controls/markers had no stylesheet to position them.
// Borrow this, with engineStylesheetUrl(provider); do not copy it.
export async function ensureEngineCSS(element, cssUrl) {
  // An unmounted pane hands us null (see initializeMap's liveness checks); nothing to style.
  if (!element) return
  const root = element.getRootNode()
  if (!(root instanceof ShadowRoot)) return   // light DOM — wrapper <link> is enough

  const timeout = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  // Already present — check if loaded via `sheet` or wait for event
  const existing = root.querySelector(`link[href="${cssUrl}"]`)
  if (existing) {
    // `sheet` is set synchronously once the stylesheet is parsed — reliable check
    if (existing.sheet) return
    // Attach listeners BEFORE checking again to avoid a race where load fires
    // between our check and adding the listener
    await Promise.race([
      new Promise(resolve => {
        existing.addEventListener('load',  resolve, { once: true })
        existing.addEventListener('error', resolve, { once: true })
      }),
      timeout(2000)
    ])
    return
  }

  // Create link element and attach listeners BEFORE inserting into DOM,
  // so we cannot miss the load event even if the browser resolves it synchronously
  const link = document.createElement('link')
  link.rel  = 'stylesheet'
  link.href = cssUrl
  pinElement(link, cssUrl)

  await Promise.race([
    new Promise(resolve => {
      link.addEventListener('load',  resolve, { once: true })
      link.addEventListener('error', resolve, { once: true })
      root.prepend(link)   // insert AFTER attaching listeners
    }),
    timeout(2000)
  ])
}

/**
 * Effective style for the MapLibre engine. A mapbox:// style needs a token and
 * the Mapbox engine, so it is ignored here — an explicit http(s) style URL is
 * honored, otherwise a free OpenFreeMap basemap is used.
 *
 * ★ THE FALLBACK IS THEME-AWARE, AND IT HAS TO BE (2026-09-24).
 * A Standard-based profile does not name a registry style at all: useMapTheme.bootStyle() hands
 * back the raw `mapbox://styles/mapbox/standard` URL and the DARKNESS lives in the config
 * ({ basemap: { lightPreset: 'night' } }), which is a Mapbox-only mechanism. This function used to
 * collapse every mapbox:// style to ONE light constant, so flipping provider turned the research
 * map from its familiar dark look into a LIGHT one — MEASURED by screenshotting it, not by
 * any error: both maps mount, both paint, both report success. Interoperability had "worked" while
 * the product looked like a different product.
 * Reading the preset the Mapbox side would have applied keeps the two engines telling the same
 * story: night/dusk get `fiord` (blue-toned dark), everything else keeps liberty.
 */
function maplibreStyle(style, lightPreset) {
  if (typeof style === 'string' && /^https?:\/\//.test(style)) return style
  return (lightPreset === 'night' || lightPreset === 'dusk') ? OPENFREEMAP_DARK_STYLE : OPENFREEMAP_STYLE
}

// ─── Aspect-aware zoom-out floor (Feedback #2+#4 REDO) ───────────────────────
// We KEEP renderWorldCopies:true (infinite horizontal scroll) and instead cap
// zoom-out with a DYNAMIC minZoom floor computed from the viewport. The floor
// guarantees one world always at least fills the container WIDTH, so the user
// can never zoom out far enough to see a repeated world copy — no maxBounds, no
// disabling of world copies. Ported from FORGE doxa-maps computeWorldMinZoom.
const MERCATOR_NORTH       = 85.0511   // Web-Mercator north pole limit (±85.0511°)
const MIN_ZOOM_FLOOR       = -2        // Mapbox allows negative minZoom since v1.6.1 (PR #9028)
const FALLBACK_MIN_ZOOM    = 0         // used only when W/H not ready (corrected on first resize)
const DEFAULT_SOUTH_CUTOFF = -60       // Antarctica crop line (FLOOR-CALC INPUT ONLY)

/**
 * Web-Mercator normalized Y fraction: 0 at +85.0511° (north), 1 at -85.0511°.
 * Measures how tall a latitude band is in the projected (square) world.
 */
function mercatorY(lat) {
  return (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) / Math.PI) / 2
}

/**
 * Computes the ASPECT-AWARE zoom-out floor (worldPx(z) = 512·2^z, tileSize 512):
 *
 *   zWidth  = log2(W / 512)              — zoom where one world fills the WIDTH.
 *       For any zoom >= zWidth the world is at least as wide as the viewport, so
 *       a second copy can never appear. Allowed to go NEGATIVE (legal since
 *       Mapbox v1.6.1) so narrow phones can still zoom out to one full world.
 *   zHeight = log2(H / (512 · bandFrac)) — zoom where the latitude-CROPPED world
 *       (north +85.0511°, south `southCutoff`) fills the HEIGHT. Cropping the
 *       empty Antarctic band (bandFrac < 1) lets portrait phones zoom out to see
 *       the populated world without the dead space forcing over-zoom-out. The
 *       crop is a FLOOR-CALC INPUT ONLY — no maxBounds, no visual clip.
 *
 * FLOOR = max(zWidth, zHeight): the less-zoomed-out (higher) of the two binds.
 * Because the result is always >= zWidth, the map can never reveal duplicate
 * worlds. Clamped to [-2, maxZoom-1]; returns a sane fallback when W/H not ready.
 */
function computeWorldMinZoom(W, H, maxZoom, southCutoff) {
  if (!W || W <= 0 || !H || H <= 0) return FALLBACK_MIN_ZOOM   // size not ready yet
  const zWidth   = Math.log2(W / 512)
  const bandFrac = mercatorY(southCutoff) - mercatorY(MERCATOR_NORTH)   // south=-60 → ~0.71
  const zHeight  = Math.log2(H / (512 * bandFrac))
  const floor    = Math.max(zWidth, zHeight)
  // Allow NEGATIVE (do NOT Math.max(0,…)); never within 1 zoom of maxZoom.
  return Math.max(MIN_ZOOM_FLOOR, Math.min(floor, (maxZoom ?? 18) - 1))
}

export function useMapInstance({
  containerRef,
  accessToken,
  style,
  // config: the Mapbox `config` constructor option — { <fragmentId>: {…} }, e.g. a Standard
  // style's { basemap: { lightPreset: 'night' } } — or a FUNCTION returning it, re-evaluated on
  // every initializeMap() so a reload boots on the theme of that moment. Mapbox applies it to
  // the style's imports BEFORE the first frame, which setConfigProperty (a no-op until
  // 'style.load') cannot do — see useMapTheme.bootConfig. Styles without imports ignore it;
  // NOT forwarded to MapLibre. Default undefined → byte-for-byte the previous behaviour.
  config           = undefined,
  // provider: 'mapbox' | 'maplibre' | unset ('auto', see useMapProvider.js). Selects the GL engine.
  //
  // ★ LEFT UNSET, THE PAGE DECIDES — THAT IS WHAT MAKES ONE SWITCH FLIP EVERY MAP.
  // This used to default to the LITERAL 'mapbox'. resolveMapProvider has long supported a
  // page-level switch (profile-config.provider → ?provider= → window.MAP_PROVIDER), but a literal
  // default meant the switch only reached a map whose bundle happened to pass `provider` through —
  // MEASURED: 3 of the 11 bundles that mount a map. The other 8 silently pinned Mapbox no matter
  // what the page asked for, which is the opposite of a switch: it LOOKED global and was not.
  // Resolving here instead moves the decision to the one place every map already goes through, so
  // a partner running thousands of embeds sets ONE value and the whole tree follows.
  // An explicit caller still wins outright (prayer-walk-planner pins 'maplibre' deliberately), and
  // with no switch set, resolveMapProvider decides 'auto': MapLibre, whether or not a token is
  // available. This call's accessToken authenticates a map that asked for Mapbox; it never chooses one.
  provider         = undefined,
  center           = [20, 10],
  zoom             = 2,
  // ★ bounds / fitBoundsOptions: frame a BOX at construction instead of a centre+zoom.
  // Mapbox honours these only in the constructor, and that is the whole point of exposing them
  // rather than letting a caller do `fitBounds` after style load. MEASURED 2026-09-24 on one page,
  // one box, one engine (v3.24.0), via _probe-fit-at-construction-vs-after-load.mjs:
  //   constructor bounds  -> zoom 3.210   (getProjection() reports 'mercator' at t=0)
  //   fitBounds post-load -> zoom 2.777   (getProjection() reports 'globe')
  // Same box, same padding, same maxZoom, same 1200x780 frame: 0.433 zoom apart, which is 1.35x
  // linear scale. Mapbox v3 resolves a constructor `bounds` while the camera is still mercator and
  // applies the style's globe afterwards, so the camera keeps the tighter mercator fit. A post-load
  // fitBounds is resolved with the globe already active and pulls BACK, because a sphere shows more
  // planet at a given zoom. Neither is a bug of ours; they are two different framings, and a clone
  // has to take the one the reference page takes. Ignored by Mapbox when absent, so this is inert
  // for every existing caller.
  bounds           = undefined,
  fitBoundsOptions = undefined,
  // minZoom: a profile may PIN a value (e.g. 0.5). It is treated as a LOWER
  // bound only — the composable raises it to the aspect-aware floor whenever the
  // viewport is wide enough that the pinned value would reveal a duplicate world.
  // A pinned value is therefore never lowered, only raised. Leave it undefined to
  // get the pure dynamic floor.
  minZoom          = undefined,
  // ★ skipWorldFloor: a GLOBE host opts out of the desktop no-duplicate-world minZoom floor.
  // That floor exists to stop a wide mercator viewport showing the world twice; on the globe
  // projection there is no second world -- the planet is a sphere -- so the floor only steals
  // zoom-out range (measured: it pinned the dashboard at ~1.45 when the whole point of a globe
  // is pulling back to see it whole). The pinned minZoom (or the engine floor) still applies.
  skipWorldFloor   = false,
  maxZoom          = 18,
  pitch            = 0,
  bearing          = 0,
  renderWorldCopies = true,         // KEEP infinite worlds — zoom-out is capped by the dynamic floor
  // showEdgeBorders: the gray "you can scroll past this map" edge strips.
  // Was previously referenced only in a COMMENT while the behaviour was
  // unconditional; it is a real flag as of 2026-07-30. DEFAULT TRUE so every
  // existing profile is byte-for-byte unchanged. Set false where a map fills the
  // viewport and there is nothing to scroll to.
  showEdgeBorders  = true,
  // southCutoff: south latitude (deg) used ONLY to size the cropped world band
  // for the HEIGHT term of the floor. FLOOR-CALC INPUT ONLY — never maxBounds.
  southCutoff       = DEFAULT_SOUTH_CUTOFF,
  // maxBounds: NO default, NO derivation — the map pans infinitely. A profile may
  // still pass an explicit [[w,s],[e,n]] to cap a specific map.
  maxBounds         = undefined
}) {
  // shallowRef: the Mapbox Map must never be deep-reactive. A ref() wraps it in a Proxy,
  // every internal read/write inside Mapbox pays the trap, and a render scheduled through
  // the proxy re-renders whole frames through it (internal/long-frames-probe.mjs --profile:
  // Vue get/set 2.7 s of idle self-time before the profiles started unwrapping the map).
  const map        = shallowRef(null)
  const isMapReady = ref(false)
  // Holds the dynamic-minZoom resize handler so destroy() can remove it.
  let _onResize    = null
  // Cancels the debounced zoom-floor snap (anti-strobe) so destroy() leaves no pending timer.
  let _clearSnap   = null
  // Holds the gray side-edge touch handlers so destroy() can remove them.
  let _detachEdgeBorders = null

  // Resolve the engine ONCE, here, so every branch below (script, style, controls) agrees.
  // profile-config.provider is per-ELEMENT and outranks the page switch; inject() is only legal
  // during setup(), which is where every caller invokes this — guarded so a non-setup caller
  // degrades to the page switch instead of throwing.
  let _pcForProvider = null
  try { _pcForProvider = inject('profileConfig', null) } catch { /* called outside setup */ }
  // 'auto' decided it (nobody asked for an engine): it may still change once, below, if the token it
  // counted on was a token SERVICE that answers with nothing.
  const autoProvider = !provider && !explicitMapProvider(_pcForProvider)
  provider = provider || resolveMapProvider(_pcForProvider, { token: accessToken })
  let isMaplibre = provider === 'maplibre'
  // Start the engine download during setup, not when initializeMap runs after mount: a measured waterfall had
  // the engine requested only after the component tree had rendered. initializeMap awaits the same script
  // (ensureEngineScript is idempotent) and reports a failure there; it is swallowed here.
  if (typeof document !== 'undefined') ensureEngineScript(provider).catch(() => {})

  // THE READER'S LANGUAGE, for the basemap's place names (maps/localize-labels.js). ProfileLoader
  // provides it as a ref ('lang'); an element without ProfileLoader falls back to its profile-config
  // locale, then the page (?lang= / <html lang>). Resolved here because inject() is setup-only.
  let _langRef = null
  try { _langRef = inject('lang', null) } catch { /* called outside setup */ }
  const readerLang = () => {
    const v = _langRef && typeof _langRef === 'object' && 'value' in _langRef ? _langRef.value : _langRef
    if (typeof v === 'string' && v) return v
    const pc = _pcForProvider && typeof _pcForProvider === 'object' && 'value' in _pcForProvider ? _pcForProvider.value : _pcForProvider
    if (pc && (pc.locale || pc.lang)) return String(pc.locale || pc.lang)
    try {
      const q = new URLSearchParams(location.search)
      return q.get('lang') || q.get('locale') || document.documentElement.lang || 'en'
    } catch { return 'en' }
  }

  async function initializeMap() {
    // Resolve a NAMED style ('ink', 'satellite', …) for this engine; raw URLs
    // and undefined keep their existing behavior (see library/styles/registry.js).
    // 'auto' picked Mapbox on a token service still answering: wait for it. No token after all → MapLibre,
    // keyless, which is what 'auto' means without a token (a map that cannot draw is not a fallback).
    if (autoProvider && !isMaplibre && !accessToken && typeof window !== 'undefined' && window.__doxaMapTokenPending) {
      await window.__doxaMapTokenPending
      if (!containerRef.value) return
      if (!(typeof window.MAP_TOKEN === 'string' && window.MAP_TOKEN)) { provider = 'maplibre'; isMaplibre = true }
    }
    const _named = resolveNamedStyle(style, provider)
    const effectiveStyle = _named.style || style
    if (!containerRef.value) {
      console.error('containerRef.value is null — call initializeMap() inside onMounted()')
      return
    }

    // ★ LIVENESS AFTER EVERY AWAIT. initializeMap is async, and its component can unmount while it
    // waits — a studio tab switch, a composite swapping views. Vue then nulls containerRef, and the
    // next line that touched it threw "Cannot read properties of null (reading 'getRootNode')"
    // (found 1 run in 4 by check:studio-all, 2026-09-25; made deterministic by
    // internal/check-map-unmount-mid-init.mjs, which holds the engine script and switches away).
    // An unmounted pane is normal, not an error, so these returns are SILENT.
    const gone = () => !containerRef.value

    // Load the selected engine (no-op if index.html preloaded it).
    await ensureEngineScript(provider)
    if (gone()) return
    const gl = engineGlobal(provider)
    if (!gl) {
      console.error(`[useMapInstance] ${isMaplibre ? 'maplibregl' : 'mapboxgl'} is not available. `
        + `Add the ${isMaplibre ? 'MapLibre' : 'Mapbox'} GL JS script to your page.`)
      return
    }

    // RTL labels (Arabic, Hebrew, Persian) need the RTL text plugin on THIS engine. Installed here,
    // at the one moment every map is guaranteed to have its engine, because a bundle entry runs
    // before a lazily-injected MapLibre exists. Idempotent and lazy (see maps/rtl-text.js).
    installRtlTextPlugin(gl)

    // ─── API Key validation (Mapbox only — MapLibre + OpenFreeMap need no token) ──
    if (!isMaplibre) {
      // Reusable fallback: a host that can't thread a per-instance token (e.g. a BAKED composite that
      // mounts a map component directly, with no ProfileLoader / profile-config wrapper) may expose the
      // token once as `window.MAP_TOKEN`. Any map on the page then finds it. Per-instance accessToken
      // still wins; this only fills the gap when none was passed.
      // A token service still answering (profile-config.tokenUrl, see fetchMapToken): wait for it.
      if (!accessToken && typeof window !== 'undefined' && window.__doxaMapTokenPending) {
        await window.__doxaMapTokenPending
        if (gone()) return
      }
      if (!accessToken && typeof window !== 'undefined' && typeof window.MAP_TOKEN === 'string' && window.MAP_TOKEN) {
        accessToken = window.MAP_TOKEN
      }
      if (!accessToken) {
        // ONE warn per page, not an error per map: the UI already says "Map unavailable", and a page with
        // several maps logged this 7x as console.error, which breaks the 0-errors bar (TKWARN).
        if (typeof window !== 'undefined' && !window.__doxaNoTokenWarned) {
          window.__doxaNoTokenWarned = true
          console.warn('No Mapbox access token provided. Pass "tk" in profile-config JSON or set window.MAP_TOKEN.')
        }
        return
      }
      if (!accessToken.startsWith('pk.')) {
        console.error('Mapbox token looks invalid (expected "pk." prefix). Got:', accessToken.slice(0, 10) + '...')
        return
      }
    }

    // Wait for the engine CSS inside the shadow root before creating the Map.
    // Without this, _detectMissingCSS fires and the canvas initializes at 0px.
    await ensureEngineCSS(containerRef.value, isMaplibre ? ENGINES.maplibre.css : MAPBOX_CSS_URL)
    if (gone()) return

    // Wait one animation frame so the browser has laid out the container.
    // Mapbox reads clientWidth/clientHeight at init — if layout hasn't settled
    // yet the canvas initializes at 0×0 and nothing renders.
    await new Promise(resolve => requestAnimationFrame(resolve))
    if (gone()) return

    // ─── Dimension diagnostics ───────────────────────────────────────
    const el = containerRef.value
    const w = el.clientWidth
    const h = el.clientHeight
    if (w === 0 || h === 0) {
      console.error(`[useMapInstance] Container has ZERO dimensions (${w}×${h}). Map will be invisible. Check that parent elements have CSS sizing.`)
      // Log parent chain for debugging
      let parent = el.parentElement
      let depth = 0
      while (parent && depth < 5) {
        parent = parent.parentElement
        depth++
      }
    }

    // TODO(INT-future): Mapbox's create-web-app uses VITE_MAPBOX_ACCESS_TOKEN.
    // See intel/discovery-reports/W1A-mapbox-create-web-app-bp.md for rationale.
    // Rename deferred: MFEs reference the current name; needs a coordinated update.
    const token = accessToken
    if (!isMaplibre) gl.accessToken = token

    // ─── Effective zoom-out floor ────────────────────────────────────
    // floor = the aspect-aware no-duplicate-world minZoom. A profile-pinned
    // `minZoom` is honored only as a LOWER bound (raised to the floor when the
    // viewport is wide enough that the pinned value would show a second world);
    // it is never lowered. With no pin we use the pure floor. The not-ready
    // fallback is corrected by style.load + the first resize event.
    // DESKTOP-ONLY restriction (coder directive 2026-06-22): the no-duplicate-
    // world floor is a desktop concern. Mobile/tablet (< 1024px) are free to zoom
    // out as far as Mapbox allows (down to MIN_ZOOM_FLOOR), so on those viewports
    // floorFor releases the floor entirely. Centralized here so _onResize picks it
    // up automatically on an orientation/breakpoint flip into mobile.
    const isDesktop = () => typeof window !== 'undefined' && window.innerWidth >= 1024
    const floorFor = (W, H) => {
      if (skipWorldFloor) return (typeof minZoom === 'number') ? minZoom : MIN_ZOOM_FLOOR
      if (!isDesktop()) return MIN_ZOOM_FLOOR   // mobile/tablet — no floor
      const f = computeWorldMinZoom(W, H, maxZoom, southCutoff)
      return (typeof minZoom === 'number') ? Math.max(minZoom, f) : f
    }
    const initialMinZoom = floorFor(el.clientWidth, el.clientHeight)

    // Resolve the day/night hint ONCE, before the engine branch, so both engines read the same
    // decision. `config` may be a function (re-evaluated per init, so a reload boots on the
    // theme of that moment) — call it the same way the Mapbox branch does.
    const _bootPreset = _named.lightPreset
      || (() => { try { const c = typeof config === 'function' ? config() : config; return c?.basemap?.lightPreset } catch { return undefined } })()

    if (isMaplibre) {
      // MapLibre branch — free OpenFreeMap basemap, NO access token. Shares the
      // GL-JS Map option surface; only the token/style differ from Mapbox.
      map.value = new gl.Map({
        container: containerRef.value,   // real DOM element — never a string ID in shadow DOM
        // The preset the MAPBOX side would have applied — from the named registry entry, else
        // from the boot config a Standard profile passes. Either way it is the app's own
        // day/night decision, not a guess made here. (Computed above the branch: the Mapbox
        // branch's own `initialConfig` is scoped to that branch and is NOT visible here.)
        style: maplibreStyle(effectiveStyle, _bootPreset),
        locale: engineUiLocale(readerLang(), 'maplibre'),
        center,
        zoom,
        minZoom: initialMinZoom,
        maxZoom,
        pitch,
        bearing,
        dragRotate: false,
        renderWorldCopies,
        // bounds OVERRIDE center/zoom in Mapbox's own option handling, so both can be passed.
        ...(bounds ? { bounds, ...(fitBoundsOptions ? { fitBoundsOptions } : {}) } : {}),
        ...(maxBounds ? { maxBounds } : {}),
        attributionControl: true,   // Mapbox's own attribution on every map
        // Phones: logo and attribution both bottom-right, so the bottom-left corner stays free
        // for the people-group image in the detail sheet.
        logoPosition: (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 767px)').matches) ? 'bottom-right' : 'bottom-left'
      })
      claimLogo(map.value)
      // Probe hook: the container element carries its map so gates can read live config (no global).
      try { containerRef.value.__doxaMap = map.value } catch (_) {}
    } else {
      // Fragment config for THIS boot (a thunk re-reads the theme on every re-init).
      const initialConfig = typeof config === 'function' ? config() : config
      map.value = new gl.Map({
        accessToken: token,              // BP #1 from W1A — per-instance token; avoids last-writer-wins on multi-embed pages
        container: containerRef.value,   // real DOM element — never a string ID in shadow DOM
        style: effectiveStyle,
        locale: engineUiLocale(readerLang(), 'mapbox'),
        // Pins a Standard basemap's lightPreset/theme BEFORE its first frame; without it the
        // schema default 'day' paints one LIGHT frame before any setConfigProperty can run.
        ...(initialConfig ? { config: initialConfig } : {}),
        center,
        zoom,
        minZoom: initialMinZoom,
        maxZoom,
        pitch,
        bearing,
        dragRotate: false,           // disorienting north-drift: no right-click+drag bearing change (desktop)
        touchPitch: false,           // no two-finger pitch on touch devices
        renderWorldCopies,           // true → infinite worlds; zoom-out capped by the dynamic floor
        // NOTE: cooperativeGestures (the two-finger-to-zoom requirement) was REMOVED
        // per coder directive 2026-06-24 — one-finger interaction must work normally.
        // The single-finger page-scroll escape is now the gray side-edge affordance
        // wired below (showEdgeBorders): the .map-scroll-edge gutters flash gray while
        // touching the map and are scrollable to move the page past the map.
        // bounds OVERRIDE center/zoom in Mapbox's own option handling, so both can be passed.
        ...(bounds ? { bounds, ...(fitBoundsOptions ? { fitBoundsOptions } : {}) } : {}),
        ...(maxBounds ? { maxBounds } : {}),  // only if a profile explicitly supplied bounds
        attributionControl: true,   // Mapbox's own attribution on every map
        // Phones: logo and attribution both bottom-right, so the bottom-left corner stays free
        // for the people-group image in the detail sheet.
        logoPosition: (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 767px)').matches) ? 'bottom-right' : 'bottom-left'
      })
      claimLogo(map.value)
      // Probe hook: the container element carries its map so gates can read live config (no global).
      try { containerRef.value.__doxaMap = map.value } catch (_) {}
    }

    // ── TILE 403 → A NAMED DIAGNOSIS, NOT A SILENT VOID ────────────────────────────────────
    // The failure this exists for, measured 2026-09-21: a Mapbox token that is URL-RESTRICTED to
    // one domain still returns 200 for the STYLE document and the FONTS, and 403 only for the
    // TILESETS. The element mounts at full height, the legend and labels paint, the data layer
    // paints — and the basemap silently never arrives. It reads as a rendering bug in our code.
    // It is not: it is one Mapbox account setting.
    //
    // Nothing listened for it. GL-JS fires `error` with e.status on every failed tile request, so
    // the information was always there; no one asked. That gap cost real debugging hours and is
    // exactly what an inheritor deploying to a NEW domain will hit first.
    //
    // ONE MESSAGE PER MAP. A blank basemap produces a 403 for every tile in the viewport — dozens
    // per second while panning — so an unguarded console.error would bury the page in noise and
    // train the reader to ignore it.
    try {
      let toldTileAuth = false
      map.value.on('error', (e) => {
        const status = e?.error?.status ?? e?.status
        const url = String(e?.error?.url || e?.sourceId || '')
        if (status !== 401 && status !== 403) return          // other errors: leave to the engine
        if (toldTileAuth) return
        toldTileAuth = true
        console.error(
          `[doxa-maps] Mapbox returned ${status} for a TILE request while the style loaded fine. ` +
          'That is a URL RESTRICTION on the access token, not a bad token and not a bug in this map. ' +
          `Add this page's origin (${typeof location !== 'undefined' ? location.origin : 'this origin'}) ` +
          'to the token\'s URL restrictions in the Mapbox account. ' +
          'The map will keep its data layer and stay blank underneath until then.' +
          (url ? ` First failing request: ${url.slice(0, 120)}` : '')
        )

        // ── CONSOLE ONLY — NO ON-SCREEN BANNER ──────────────────────────────────────────
        // An earlier version of this handler also appended a `.dx-tile-auth-note` corner
        // banner to the map container. REMOVED: the map must not show a popup saying the
        // basemap tiles are blocked.
        //
        // WHY THE INSTRUCTION IS RIGHT, so nobody re-adds it. The banner reported an
        // OPERATOR problem (one account setting, on one deployment origin) to the END USER,
        // who can do nothing about it and did not ask. It rendered on every map, on every
        // load, in the product itself — turning a deployment note into a permanent piece of
        // the UI. The console message below reaches exactly the person who can act, and only
        // when they go looking. That is the right audience for a configuration diagnosis.
        //
        // If a future failure genuinely needs to be shown to a user, it must be a failure the
        // USER can resolve, and it belongs in the profile's own status/empty-state affordance
        // — not injected into the map container from a shared composable.
      })
    } catch (_) { /* an engine without .on() must never break map creation */ }

    // Belt-and-suspenders to dragRotate:false — kills the two-finger twist→rotate
    // handler so the north bearing can never drift on any input method. Present on
    // both engines.
    try { map.value.touchZoomRotate.disableRotation() } catch (_) { /* engine may differ */ }

    // ─── Edge scroll-affordance strips (custom page-scroll "scrollbar") ─────────
    // The .map-scroll-edge strips (left + right, every profile: pointer-events auto,
    // touch-action pan-y) are always-present INVISIBLE hit-boxes. The gray indicator
    // (a 36px gradient at the very page edge) appears when:
    //   • you SCROLL the map — on the PRIMARY side only (RIGHT on desktop via wheel,
    //     LEFT on mobile via a one-finger drag): the side with the most whitespace;
    //   • you HOVER a strip (desktop) or TOUCH a strip (mobile) — on THAT strip, so
    //     either edge can be summoned where you reach for it. A HOVERED strip is
    //     pinned: it never auto-hides (even while you scroll) until you leave it.
    // MOBILE scrolls the page natively via the strip's touch-action: pan-y. DESKTOP
    // has NO grab/click+drag-to-scroll (removed per coder 2026-06-24) — the strip is a
    // hover indicator only; user-select:none on strips+buttons still blocks any stray
    // text selection. Desktop map click+drag (Mapbox pan) never lights it.
    // Visibility toggles via OPACITY (not a background swap) so it fades, never hard-
    // flashes, and the hit-box stays live the whole time. (coder 2026-06-24)
    // The implementation was LIFTED to library/composables/useEdgeScrollAffordance.js
    // (2026-07-30) so panes that are NOT maps can use it too — a tree-node/whiteboard
    // pane traps the page scroll exactly the same way a Mapbox canvas does. The
    // behaviour here is unchanged: same strips, same primary side, same hover-pin.
    _detachEdgeBorders = useEdgeScrollAffordance(
      containerRef.value?.parentElement || null,
      { enabled: showEdgeBorders },
    )

    // ─── Keep the aspect-aware floor in sync on resize / orientation flip ──
    // Recompute from the live container W AND H and setMinZoom so the floor
    // always tracks max(one-world-fills-width, cropped-world-fills-height) — never
    // two worlds at once, but low enough on tall/portrait phones to see the whole
    // world. Portrait↔landscape flips which term binds; if the new floor is above
    // the current zoom, snap up so the camera stays within the floor.
    // A11Y / PHOTOSENSITIVITY (BUG-RESIZE-STROBE): this handler runs on EVERY Mapbox/MapLibre
    // 'resize' event, and map.resize() itself emits one. When a container is being dragged
    // (a resizable dashboard section, a window-edge drag) the height — and therefore the
    // computed floor — changes on every animation frame, so the unguarded `setZoom(floor)`
    // re-snapped the camera ~60x/sec and re-rendered the whole globe: visible strobing, a
    // seizure risk for photosensitive users. Two guards, both required:
    //   1. IDEMPOTENCE — only touch minZoom when the floor actually CHANGED. A pure width
    //      drag, or any resize that leaves the floor alone, now costs nothing.
    //   2. DEBOUNCE the camera snap — clamping the zoom is a visible camera move, so it must
    //      happen ONCE when the size settles, never mid-drag. The floor itself is applied
    //      immediately (cheap, non-visual); only the snap waits.
    let _lastFloor = initialMinZoom
    let _snapT = null
    _onResize = () => {
      const m = map.value
      if (!m) return
      const floor = floorFor(el.clientWidth, el.clientHeight)
      if (floor !== _lastFloor) {
        _lastFloor = floor
        m.setMinZoom(floor)
      }
      // Defer the visible clamp until the resize stream goes quiet.
      if (m.getZoom() < floor) {
        if (_snapT) clearTimeout(_snapT)
        _snapT = setTimeout(() => {
          _snapT = null
          const mm = map.value
          if (!mm) return
          const f = floorFor(el.clientWidth, el.clientHeight)
          // jumpTo, not setZoom: no easing/animation, so the correction lands in a single
          // frame instead of tweening (another motion source for reduced-motion users).
          if (mm.getZoom() < f) { try { mm.jumpTo({ zoom: f }) } catch (_) { mm.setZoom(f) } }
        }, 150)
      } else if (_snapT) {
        // the drag brought us back inside the floor — cancel the pending correction
        clearTimeout(_snapT); _snapT = null
      }
    }
    _clearSnap = () => { if (_snapT) { clearTimeout(_snapT); _snapT = null } }
    // Mapbox fires 'resize' after map.resize(); also listen to window resize +
    // orientationchange so panel toggles / breakpoints / device rotation recompute.
    map.value.on('resize', _onResize)
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', _onResize)
      window.addEventListener('orientationchange', _onResize)
    }

    map.value.on('style.load', () => {
      // Basemap place names in the reader's language — re-applied on EVERY style load, so a later
      // setStyle() (a theme switch) cannot drop it. Plugin label layers are never touched.
      if (map.value) localizeBasemapLabels(map.value, readerLang())
      // ── NAMED-STYLE PAINT PATCH (e.g. 'galaxy': blue water on a black ground) ──────────────
      // style.load is the ONLY correct moment: setPaintProperty before the style document has
      // parsed throws, and re-applying here also survives a later setStyle() — the event fires
      // again, so a style swap cannot silently drop the patch.
      // Nothing happens for styles with no `paint` in the registry, so every existing map is
      // byte-for-byte unchanged.
      if (_named.paint && map.value) {
        const hit = applyStylePaint(map.value, _named.paint)
        // Log what the LOADED style actually had — layer ids differ between Mapbox and MapLibre
        // and have moved across Mapbox style versions, so this is the only trustworthy record
        // of which ids are real. A patch that matched nothing is a silent no-op otherwise.
        console.info('[useMapInstance] style paint applied (' + provider + '):', hit.join(', ') || 'NONE MATCHED')
      }
      // Resize after style.load in a rAF: container layout may not have settled yet,
      // especially when the panel was hidden (display:none) at startup.
      requestAnimationFrame(() => {
        map.value?.resize()
        // Recompute the floor now the container has a real width/height (init may
        // have used the not-ready fallback).
        if (map.value) map.value.setMinZoom(floorFor(el.clientWidth, el.clientHeight))
        isMapReady.value = true
      })
    })
  }

  function destroy() {
    if (map.value) {
      // Tear down the dynamic-minZoom handlers (mirrors registration above).
      if (_onResize) {
        map.value.off('resize', _onResize)
        if (typeof window !== 'undefined') {
          window.removeEventListener('resize', _onResize)
          window.removeEventListener('orientationchange', _onResize)
        }
        _onResize = null
      }
      // Drop any pending debounced zoom-floor snap so it can never fire on a dead map.
      if (_clearSnap) { try { _clearSnap() } catch (_) {} _clearSnap = null }
      // Tear down the gray side-edge touch handlers (mirrors registration above).
      if (_detachEdgeBorders) { _detachEdgeBorders(); _detachEdgeBorders = null }
      // ★ RELEASE THE LOGO CLAIM HERE, not only from the 'remove' listener. The listener below
      // (`mapInstance.once('remove', ...)`) can only fire if this line is reached, so it cannot be
      // the guarantee that the global is cleared — it is a consequence of the guarantee. Heap
      // snapshots found window.__doxaLogoOwner -> Map -> div.rm-map-canvas -> ShadowRoot -> app,
      // pinning an entire unmounted app, precisely because remove() had not run. Clearing the claim
      // before removing means the global is dropped even if remove() itself throws part-way.
      try {
        const w = typeof window !== 'undefined' ? window : null
        if (w && w.__doxaLogoOwner === map.value) w.__doxaLogoOwner = null
      } catch (_) { /* a locked-down window is not a reason to skip the teardown below */ }
      const dead = map.value
      map.value.remove()
      // The container kept __doxaMap after teardown, holding the whole dead map (GL context, sources,
      // tiles) reachable from the DOM. Clear it only if it is still this instance's.
      try { if (containerRef && containerRef.value && containerRef.value.__doxaMap === dead) containerRef.value.__doxaMap = null } catch (_) {}
      map.value = null
      isMapReady.value = false
    }
  }

  // A live language switch (the gallery re-sets profile-config.locale; ProfileLoader's 'lang' ref
  // follows) re-labels a map that is already on screen — no reload, no style swap.
  if (_langRef && typeof _langRef === 'object' && 'value' in _langRef) {
    try { watch(_langRef, () => { if (map.value && isMapReady.value) localizeBasemapLabels(map.value, readerLang()) }) } catch { /* outside setup */ }
  }

  return { map, isMapReady, initializeMap, destroy }
}
