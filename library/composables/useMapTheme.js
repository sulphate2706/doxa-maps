// useMapTheme.js — shared light/dark theme for every map profile.
//
// SEAMLESS theme switch (coder: "switching styles flashes + pins disappear — not seamless").
// Both light AND dark use the SINGLE Mapbox **Standard** style; the theme is just its
// `lightPreset` config (light = 'day', dark = 'night'). Flipping lightPreset via
// `map.setConfigProperty('basemap','lightPreset', …)` re-lights the basemap WITHOUT any
// setStyle reload — so custom layers (pins, prayer glow, regions) are NEVER wiped, there is
// NO rebuild, NO flash, and the toggle is instant. (This is the only seamless option:
// switching between two DIFFERENT style documents — e.g. light-v11 ↔ Standard — always
// forces a full Mapbox reload, which is what caused the flash + pins-disappearing.)
//
// Custom layers carry `*-emissive-strength: 1` (see useMapLayers) so they keep their true
// colour under the Standard 'night' lighting.
//
// Usage in a profile:
//   const mapTheme = useMapTheme(uiStore)
//   // map creation:  style: mapTheme.bootStyle()             // ALWAYS the Standard style
//   //                config: mapTheme.bootConfig             // pins lightPreset BEFORE the first frame
//   // after first style.load (onMapReady): mapTheme.applyTheme(map.value)   // sets day/night
//   //   (also arms the per-map 'style.load' + 'styledata' re-pin — see keepPinned)
//   // a profile watch(uiStore.theme) → applyTheme keeps it in sync; toggle just flips uiStore.
//   // toggle button: mapTheme.swapTheme(map.value)           // flips lightPreset, NO reload

export const STANDARD_STYLE = 'mapbox://styles/mapbox/standard'
// Back-compat aliases — the basemap is the single Standard style; light/dark is a lightPreset.
export const LIGHT_STYLE = STANDARD_STYLE
export const DARK_STYLE  = STANDARD_STYLE

// ─── FEATURE FLAG: THEME_TOGGLE ──────────────────────────────────────────────
// When FALSE (default): the light/dark THEME TOGGLE CONTROL is hidden, the UI
// chrome (controls, legend, search, drawer) is forced to LIGHT, and the BASEMAP
// is PINNED to the dark/colourful look (lightPreset 'night' + theme 'default').
//
// WHY THIS FLAG EXISTS: `uiStore.theme` used to drive BOTH the UI chrome AND the
// basemap lighting together, so you could not have light chrome over a dark map.
// This flag DECOUPLES them: `FIXED_BASEMAP` below is applied regardless of the UI
// theme, so the map keeps its dark-green colour strategy while everything else
// goes light.
//
// Set THEME_TOGGLE = true to restore the original user-switchable behaviour
// (toggle button returns, basemap follows the UI theme again). Nothing was deleted.
export const THEME_TOGGLE = false

// The basemap look that is pinned when THEME_TOGGLE is false. These are the exact
// values the ORIGINAL dark mode used, so the map is visually unchanged.
export const FIXED_BASEMAP = { lightPreset: 'night', theme: 'default' }
// The light look: the same Standard style lit by day in the monochrome (white) theme, so the
// pins stand out on every map that informs rather than prays. Prayer maps keep the night look (light and darkness).
export const LIGHT_BASEMAP = { lightPreset: 'day', theme: 'monochrome' }
// Which look a colour strategy asks for.
// Unknown strategy (tabs not loaded yet) → null: the current look is kept.
// Light (monochrome day) only for the informational trees: people (affinity blocs), regions,
// languages. Prayer, adoption, engagement and religion keep the night look.
export function lookForStrategy(strategy) { return !strategy ? null : (/affinity|region|language/i.test(String(strategy)) ? 'light' : 'dark') }

export function useMapTheme(uiStore) {
  // Single pending 'idle' re-assert guard (per map instance). Prevents stacking one
  // idle handler per toggle during a fast light<->dark burst — see applyTheme().
  let reassertPending = false
  // Maps whose basemap this composable already keeps pinned for life — see keepPinned().
  const pinned = new WeakSet()

  // True when dark is the persisted/active theme (localStorage fallback for the boot window).
  // FLAG OFF => always false, so a stale localStorage theme:'dark' from a previous
  // session can never drag the UI back to dark.
  function isDarkTheme() {
    if (!THEME_TOGGLE) return false
    if (uiStore?.theme === 'dark') return true
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('theme') === 'dark' }
    catch (e) { return false }  // sandboxed iframe → localStorage throws
  }

  // The Standard-style lightPreset for the current theme.
  function lightPreset() { return isDarkTheme() ? 'night' : 'day' }

  // The Standard 'basemap' config for the CURRENT theme — the SINGLE source of truth for
  // both the boot `config` (bootConfig) and every live re-pin (applyTheme), so the first
  // painted frame and a later re-assert can never disagree. Recomputed fresh on every call
  // (rapid toggles can't desync — last call wins).
  // The pinned look for this map instance: 'dark' (prayer) or 'light' (every other tab).
  // Set from the active tab's colour strategy at boot and on each tab switch (setLook).
  let look = 'dark'
  function lookFor(strategy) { return lookForStrategy(strategy) }
  function setLook(next, map) {
    if (next !== 'light' && next !== 'dark') return   // unknown → keep the current look
    look = next
    if (map) applyTheme(map)
  }
  function basemapConfig() {
    // FLAG OFF → the basemap is PINNED per look and does NOT follow the UI theme. This is
    // what lets the chrome stay light while a prayer map keeps its dark-green look and an
    // informational map its day-lit green look.
    if (!THEME_TOGGLE) return { ...(look === 'light' ? LIGHT_BASEMAP : FIXED_BASEMAP) }
    const dark = isDarkTheme()
    // lightPreset = day/night lighting. theme = the Standard colour theme: light mode uses
    // the LIGHTER, cleaner 'monochrome' theme (closer to a flat white map); dark keeps the
    // default colourful theme the coder loves. Both are config props, so the toggle stays
    // SEAMLESS (no setStyle, no reload, pins never wiped).
    return { lightPreset: dark ? 'night' : 'day', theme: dark ? 'default' : 'monochrome' }
  }

  // BOOT style — ALWAYS the Standard style. Pair it with bootConfig (below): the theme's
  // lightPreset has to travel in the Map constructor `config`, because setConfigProperty is a
  // silent no-op until 'style.load' (no 'basemap' fragment yet) — so applyTheme() alone can
  // only ever fix the basemap AFTER its first frame has been painted.
  function bootStyle() { return STANDARD_STYLE }

  // BOOT config — the Mapbox `config` constructor option, keyed by fragment id. Mapbox GL JS
  // v3 auto-wraps a root Standard style as the import 'basemap' and merges this into the
  // fragment's config BEFORE its first paint (verified v3.24.0: Map ctor → setStyle({config})
  // → initialConfig → fragment config; docs: "initial configuration options for the style
  // fragments"). Without it Standard boots on its schema default lightPreset 'day' and the
  // very first frame is LIGHT until onMapReady → applyTheme re-pins night — the boot flash.
  // Pass the FUNCTION (not its result) to useMapInstance so a map re-init (reload) re-reads
  // the theme of that moment.
  function bootConfig() { return { basemap: basemapConfig() } }

  // Current basemap config value as Mapbox reports it (a literal such as 'night'), or
  // undefined when it can't be read: no 'basemap' fragment yet, or a non-Mapbox engine.
  function readConfig(map, key) {
    try {
      return typeof map.getConfigProperty === 'function' ? map.getConfigProperty('basemap', key) : undefined
    } catch (_) { return undefined }
  }

  // Only a Mapbox GL map has the Standard-style config API. MapLibre (demo-map, or any
  // profile opened with ?provider=maplibre) has no setConfigProperty: pinning must be a
  // silent no-op there, never a warning per style mutation.
  function hasBasemapConfig(map) {
    return !!map && typeof map.setConfigProperty === 'function' && typeof map.getConfigProperty === 'function'
  }

  // Write the CURRENT theme's basemap config; returns true when something was written.
  // Skips values that already match (read back via getConfigProperty) unless `force`:
  // in v3.24.0 setConfigProperty is NOT free even for an identical value — it re-serialises
  // every config-dependent basemap layer and reloads the basemap source — so the defensive
  // applyTheme on every tab switch used to cost a full basemap re-layout (the "glitch"),
  // and the 'styledata' hook in keepPinned could otherwise never settle.
  function writeBasemap(map, force = false) {
    if (!hasBasemapConfig(map)) return false
    const want = basemapConfig()
    let wrote = false
    try {
      for (const [key, value] of Object.entries(want)) {
        if (!force && readConfig(map, key) === value) continue
        map.setConfigProperty('basemap', key, value)
        wrote = true
      }
    } catch (e) { console.warn('[useMapTheme] setConfigProperty failed:', e) }
    return wrote
  }

  // Keep the basemap pinned for the life of a map — armed ONCE per instance (WeakSet), by
  // the first applyTheme(map). This is the shared seam that re-asserts the pin after ANY
  // action, without every profile having to remember to call applyTheme:
  //  • 'style.load' — every style (re)load (setStyle / reload) rebuilds the 'basemap'
  //    fragment on Standard's schema defaults (day) unless it was given a config; re-pin
  //    here, before that style's first frame (Mapbox fires 'style.load' before it renders).
  //  • 'styledata'  — fires after every style mutation (legend row select → setPaintProperty/
  //    setFilter, tab switch, prayer-glow ticks, …). Costs two config read-backs and writes
  //    ONLY on drift, so it can never loop: a write makes the next read-back match.
  // Mapbox snapshots its listener list per dispatch, so arming inside the boot 'style.load'
  // handler (onMapReady) does not re-fire for that same event.
  function keepPinned(map) {
    if (pinned.has(map)) return
    pinned.add(map)
    if (!hasBasemapConfig(map)) return   // MapLibre: no Standard config to pin — arm nothing
    try {
      map.on('style.load', () => writeBasemap(map))
      map.on('styledata',  () => writeBasemap(map))
    } catch (_) { /* engine without an event API — nothing to arm */ }
  }

  // Apply the CURRENT theme's lightPreset to the basemap. Robust + idempotent: recomputes
  // the config fresh (rapid toggles can't desync — last call wins), arms keepPinned, and
  // re-applies on 'idle' after a real change. Call from onMapReady (boot) AND a watch(uiStore.theme).
  function applyTheme(map) {
    if (!map) return
    keepPinned(map)
    // Apply immediately so a single / slow toggle stays instant (no regression).
    const changed = writeBasemap(map)
    // FAST-TOGGLE GREY-FILM FIX: rapidly flipping lightPreset races the Standard
    // style's day<->night lighting transition; a toggle landing mid-transition can
    // leave a grey film over the country fills (the basemap gets stuck half-lit).
    // Re-assert the LATEST theme once the basemap settles ('idle') so the terminal
    // state ALWAYS wins, regardless of toggle speed (last-write-wins). During a fast
    // burst the map never goes idle until toggling stops, so this fires exactly once
    // at the end with the final theme. One pending re-assert is enough — guard against
    // stacking a handler per toggle. Only a call that actually WROTE can have started a
    // lighting transition, so an already-pinned map (tab switch) schedules nothing; the
    // re-assert itself is forced so a stuck transition is restarted by a real write.
    if (changed && !reassertPending) {
      reassertPending = true
      try {
        map.once('idle', () => { reassertPending = false; writeBasemap(map, true) })
      } catch (_) { reassertPending = false }
    }
  }

  // Toggle the theme: flip uiStore (the single source of truth), then re-light the basemap
  // via lightPreset. NO setStyle — custom layers persist, the prayer glow keeps running, no
  // rebuild/flash/ghost. Each profile also watches uiStore.theme → applyTheme as a sync
  // safety-net so the basemap can't drift out of sync across tabs / rapid toggles.
  function swapTheme(map) {
    uiStore.toggleTheme()
    applyTheme(map)
  }

  return { setLook, lookFor, STANDARD_STYLE, LIGHT_STYLE, DARK_STYLE, isDarkTheme, lightPreset, basemapConfig, bootStyle, bootConfig, applyTheme, swapTheme }
}
