/**
 * useMapProvider.js — resolve the active map engine ("provider").
 *
 * Resolution order (first defined wins) — matches resolveMapProvider below EXACTLY:
 *   1. profile-config `provider`   — per-map, set in the profile-config JSON
 *   2. ?provider= in the page URL   — read here directly, so any generated leaf page can be
 *                                     flipped from the URL without the host doing anything
 *   3. window.MAP_PROVIDER          — host global, for a host that sets it programmatically
 *   4. 'auto'                       — the default: MapLibre. A token alone never selects Mapbox.
 *
 * Valid values: 'mapbox' | 'maplibre' | 'auto'. Anything else is treated as 'auto'.
 *
 * ★ 'auto' IS MAPLIBRE. The public repo carries NO Mapbox token, so a default of 'mapbox' gave every
 * keyless visitor a map that could not draw and a paste-a-token prompt. From 2026-09-25 'auto' asked
 * the token ladder (a token meant Mapbox); since 2026-09-28 it is MapLibre whether or not a token is
 * present — resolveMapProvider below has the reasoning. A map that wants Mapbox says so with
 * provider:'mapbox' (rungs 1-3), and a token then authenticates it: this element's profile-config
 * `tk`, or one published page-wide (window.MAP_TOKEN — the generated leaf's ?tk= / pasted / baked /
 * fetched rungs, the studio's ⚙ Settings, and any element handed a `tk` all land there, see
 * useSharedMapToken). Place search uses a token on either engine. An explicit provider always wins.
 *
 * documentation/how-to.md ("Swap the map engine") carries the same order; keep the two in sync, and
 * treat THIS function as the authority when they disagree.
 */

import { inject } from 'vue'

export const MAP_PROVIDERS   = ['mapbox', 'maplibre']
export const DEFAULT_PROVIDER = 'auto'

/** Unwrap a ref/computed to its config object; pass plain objects through. */
function unwrapConfig(profileConfig) {
  if (profileConfig && typeof profileConfig === 'object'
      && 'value' in profileConfig && !('provider' in profileConfig) && !('profile' in profileConfig)) {
    return profileConfig.value
  }
  return profileConfig
}

/**
 * Is a Mapbox token available to this map? The element's own `tk`, or the page-wide token
 * (window.MAP_TOKEN, which useSharedMapToken bridges to every element's published tk).
 */
export function hasMapToken(cfg) {
  // The embed snippets ship tk:"YOUR_MAPBOX_TOKEN" as a placeholder; an unfilled one is not a token.
  const real = (v) => typeof v === 'string' && !!v.trim() && !/^YOUR_/.test(v.trim())
  if (real(cfg?.tk)) return true
  // A token service to ask (profile-config.tokenUrl) counts: the element fetches it before the map starts.
  if (/^https?:\/\//i.test(String(cfg?.tokenUrl || ''))) return true
  if (typeof window === 'undefined') return false
  return real(window.MAP_TOKEN) || real(window.__doxaMapToken) || !!window.__doxaMapTokenPending
}

/**
 * Resolve the provider from a profile-config (object or ref) + window fallback.
 * Always returns a concrete engine ('mapbox' | 'maplibre'); 'auto' is decided here. `token` is a
 * token the caller holds outside the config (useMapInstance's accessToken); it no longer chooses the
 * engine (see below) and stays in the signature for the callers that pass one.
 * Pure — safe to call outside a Vue setup().
 */
export function resolveMapProvider(profileConfig, { token } = {}) {
  const cfg = unwrapConfig(profileConfig)
  // ★ AUTO IS MAPLIBRE. A TOKEN NO LONGER CHOOSES AN ENGINE (2026-09-28: MapLibre is the default
  // everywhere, on cost and on how it looks; Mapbox stays supported as an explicit choice).
  //
  // It used to read: explicit || (token present ? 'mapbox' : 'maplibre') — so merely HOLDING a
  // Mapbox token selected Mapbox. That conflated two different things: holding a token is a
  // capability, choosing Mapbox is a decision, and only the second belongs in this function.
  //
  // The token is still honoured for what it IS: with provider:'mapbox' it authenticates the map,
  // and the `token` argument stays in the signature because callers pass one they hold outside the
  // config. It simply no longer votes on the engine.
  //
  // WHO CHANGES: a host that pasted a real token into a published embed snippet and set no
  // provider. All 36 shipped snippets carry a tk placeholder and NO provider key, so that is the
  // whole migration surface. An UNFILLED snippet was already MapLibre — hasMapToken rejects
  // YOUR_-prefixed placeholders — and the DX Life branches pass no token at all.
  // To keep Mapbox, such a host adds "provider":"mapbox" to profile-config; ?provider=mapbox and
  // window.MAP_PROVIDER are unchanged.
  return explicitMapProvider(cfg) || 'maplibre'
}

/** The engine someone ASKED for (rungs 1-3), or '' when the default ('auto') decides. */
export function explicitMapProvider(profileConfig) {
  const cfg        = unwrapConfig(profileConfig)
  const fromConfig = cfg?.provider
  const fromUrl    = typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('provider') : undefined
  const fromWindow = typeof window !== 'undefined' ? window.MAP_PROVIDER : undefined
  const raw = String(fromConfig || fromUrl || fromWindow || DEFAULT_PROVIDER).toLowerCase().trim()
  return MAP_PROVIDERS.includes(raw) ? raw : ''
}

/** Human-readable engine label for a badge / UI. */
export function providerLabel(provider) {
  return provider === 'maplibre' ? 'MapLibre' : 'Mapbox'
}

/** Convenience for use inside a Vue setup() — injects the provided profileConfig. */
export function useMapProvider() {
  const profileConfig = inject('profileConfig', null)
  return resolveMapProvider(profileConfig)
}

/** True when this map instance is a Mapbox GL map (vs MapLibre). Per-instance runtime
 *  sniff — works even on dual-engine pages where both globals are loaded. */
export function isMapboxMap(map) {
  return typeof window !== 'undefined' && !!window.mapboxgl && map instanceof window.mapboxgl.Map
}

/**
 * The engine namespace that built THIS map: window.maplibregl or window.mapboxgl. Use it for
 * everything constructed alongside a map (Marker, Popup, a second Map, controls) instead of
 * the bare `mapboxgl` global.
 *
 * ★ WHY. Every generated leaf <head> used to load mapbox-gl.js statically, whatever the provider,
 * so a bare `new mapboxgl.Popup()` always found a global, even on a MapLibre map (where it
 * built a MAPBOX popup and attached it to a MapLibre map). Removing that static peer (a visitor-IP
 * leak to api.mapbox.com under MapLibre) turns each of those into a ReferenceError on the first
 * pin select or click, and the poster's hidden map into 'mapboxgl global not found'.
 * Asking the MAP which engine it is removes the dependency on what else the page loaded.
 * @param {object} map  the live map instance
 * @returns {object|undefined}  the engine namespace, or undefined when neither is loaded
 */
/**
 * The provider NAME that built THIS map: 'mapbox', 'maplibre', or undefined when neither global is
 * loaded or `map` is not a map at all.
 *
 * ★ WHY THIS EXISTS, given engineFor() is right above it. engineFor returns the engine NAMESPACE,
 * which is what you want for constructing things (Marker, Popup, a second Map). Two call sites want
 * the opposite: a NAME, to put in a diagnostic field and to choose an attribution string. They were
 * each doing their own `map instanceof window.maplibregl.Map` sniff, which is the raw-global coupling
 * C3 exists to remove — and `resolveMapProvider()` cannot serve them because it reads a CONFIG, not a
 * live map, so on a dual-engine page it answers about the wrong thing.
 *
 * ★ THE AMBIGUOUS CASE IS THE WHOLE REASON THIS RETURNS undefined RATHER THAN A DEFAULT. Both call
 * sites tested for MAPLIBRE and fell through to 'mapbox', so a stub, a destroyed map or a page where
 * neither global loaded read as 'mapbox'. A rewrite in terms of the existing isMapboxMap() would have
 * inverted that — falling through to 'maplibre' — and silently changed what a diagnostic reports and
 * which attribution a poster prints. Returning undefined forces each caller to keep its OWN default
 * visible at the call site, so the migration cannot quietly move a default. Changing a default is not
 * a curation migration.
 *
 * @param {object} map  the live map instance
 * @returns {'mapbox'|'maplibre'|undefined}
 */
export function providerFor(map) {
  if (typeof window === 'undefined') return undefined
  const ml = window.maplibregl, mb = window.mapboxgl
  if (ml && ml.Map && map instanceof ml.Map) return 'maplibre'
  if (mb && mb.Map && map instanceof mb.Map) return 'mapbox'
  return undefined
}

export function engineFor(map) {
  if (typeof window === 'undefined') return undefined
  const ml = window.maplibregl, mb = window.mapboxgl
  if (ml && ml.Map && map instanceof ml.Map) return ml
  if (mb && mb.Map && map instanceof mb.Map) return mb
  return mb || ml
}

/** Mapbox-Standard-only lighting paint props, per engine. MapLibre rejects layers whose
 *  paint carries unknown properties (the whole layer is dropped → invisible pins), so
 *  spread this instead of writing '<kind>-emissive-strength' literally.
 *
 *  ★ `kind` EXISTS BECAUSE THE CIRCLE CASE WAS NOT THE ONLY ONE. This helper was hardcoded to
 *  'circle', while fill, line and clustering layers still wrote the literal — so those layers kept
 *  being dropped by MapLibre for exactly the reason written above. MEASURED on countries-map by
 *  listening to the map's own `error` event, which is the ONLY place it surfaces:
 *      layers.regions-fill.paint.fill-emissive-strength: unknown property
 *      layers.regions-border.paint.line-emissive-strength: unknown property
 *  addLayer() does NOT throw for this — it accepts the call, emits an error event, and silently
 *  omits the layer. getLayer() then returns undefined and the map simply renders without it, which
 *  is why it read as "the fills do not paint" rather than as an error.
 *  @param {object} map   the live map instance
 *  @param {'circle'|'fill'|'line'} [kind='circle']
 */
/**
 * ── PROJECTION, PER ENGINE ───────────────────────────────────────────────────────────────────────
 * ONE place for an API that is shaped differently on each engine, gathered from 12 call sites across
 * 9 plugins (SPEC-LIBRARY-CURATION.md, candidate C2). The asymmetry:
 *
 *     Mapbox    getProjection() -> { name }                  setProjection('mercator')
 *     MapLibre  getProjection() -> { type } | undefined       setProjection({ type: 'mercator' })
 *
 * Passing the Mapbox shape to MapLibre THROWS. That is not hypothetical: it was measured on
 * regions-dashboard, where the throw aborted the camera fly so opening a region dashboard never
 * framed its region (the fix confirmed by eye, rows 13/14).
 *
 * WHAT THE 12 SITES DID BEFORE, and why one helper is worth it:
 *   · NINE passed a bare string, so on MapLibre the projection silently never changed. Eight wrapped
 *     it in try/catch and swallowed the throw; doxa-simple-map did NOT, so there it threw uncaught.
 *   · TWO had already solved it independently and differently — pplr-data-maps' setProjectionFor()
 *     (instance-tested, the shape adopted here) and regions-dashboard's pair (config-derived, which
 *     is weaker: it trusts what the page was configured with rather than what the map IS).
 *   · ONE probed by exception, trying the object form and falling back to the string on throw.
 *
 * THE ENGINE IS READ FROM THE INSTANCE, never from config. A page can be configured for one engine
 * and hold a map built by the other (a fallback, a second map, an auto-engine decision), and the
 * object-vs-string question is a fact about the INSTANCE.
 *
 * BOTH RETURN SOMETHING OBSERVABLE, on a plugin owner's argument: a precondition that bails without
 * recording that it bailed is indistinguishable, at the rendered layer, from the request never
 * arriving. setProjectionOn returns whether it applied; projectionOf returns null rather than
 * throwing. Callers that do not care may ignore it, and all 12 existing sites do.
 */

/** The current projection NAME on either engine, or null. Handles {name}, {type} and undefined. */
export function projectionOf(map) {
  try {
    const p = map && typeof map.getProjection === 'function' ? map.getProjection() : null
    return (p && (p.name || p.type)) || null
  } catch (_) { return null }
}

/**
 * Set the projection on either engine. Returns true when it applied, false when it could not —
 * a style that does not support the projection is a legitimate false, not an error.
 */
export function setProjectionOn(map, name) {
  if (!map || !name || typeof map.setProjection !== 'function') return false
  const ml = typeof window !== 'undefined' ? window.maplibregl : null
  const wantsObject = !!(ml && ml.Map && map instanceof ml.Map)
  try {
    map.setProjection(wantsObject ? { type: name } : name)
    return true
  } catch (_) {
    // The style cannot take it (Mapbox Standard pins some projections): keep the current one.
    return false
  }
}

export function emissivePaint(map, kind = 'circle') {
  return isMapboxMap(map) ? { [`${kind}-emissive-strength`]: 1 } : {}
}
