import { defineMapElement } from '@map/elements/defineMapElement.js'
import { registerPosterSectionElement } from '@map/elements/posterSectionElement.js'
/**
 * plugin-designs/country-posters/index.js
 *
 * Bundle entry — registers the country-posters web component.
 *
 * Registers ONE custom-element tag:
 *   - <country-posters-map>
 *
 * Usage from a host page:
 *   <script src="/app/country-posters.js"></script>
 *   <country-posters-map profile-config='{"profile":"countries-map","tk":"pk.YOUR_MAPBOX_TOKEN"}'></country-posters-map>
 *   <country-posters-map profile-config='{"profile":"country-poster-wall"}'></country-posters-map>
 *   <country-posters-map profile-config='{"profile":"country-poster-wall","countries":"IND,PAK,BGD"}'></country-posters-map>
 *     only those countries (ISO-3, or {code,name,count} records), FLAT, for a host's own region section
 *     (DX Life's /regions, 2026-09-30); `region: "Asia"` asks for one WAGF region; `columns`, `heading` optional.
 *
 * TWO PROFILES, ONE BUNDLE — the same shape as my-upg-100-list:
 *   countries-map.vue        the map; legend opens on the COUNTRY level
 *   country-poster-wall.vue  the poster grid, grouped by region, collapsible
 *
 * WHY A SEPARATE BUNDLE rather than two more profiles in my-upg-100-list:
 * Several application profiles are fine; every REUSABLE component belongs in the library.
 * PROFILES duplicate; COMPONENTS get promoted to library/ and parameterized. The
 * wall here is @map/components/poster/PosterWall.vue — the same component the
 * 100-list renders — differing only in data, taxonomy and copy.
 *
 * Profile registry — ProfileLoader lives inside @map and cannot use
 * import.meta.glob to reach into a bundle's folder. The bundle MUST evaluate
 * import.meta.glob('./*.vue') locally and hand the result to the loader via
 * app.provide('profileModules', ...).
 */

// ─── Bundle-private profile registry ─────────────────────────────────────────
const profileModules = import.meta.glob('./*.vue')

// ★ THE LOCAL COLOUR GLOB IS GONE (C1b). This bundle registered its own src/colors/*.js over the
// shared set; all three modules (doxa-region, affinity-block, resource) now live in library/colors/
// where _registry.js discovers them for every bundle, and src/colors/ holds no .js at all. The glob
// matched nothing, so leaving it would be dead code that reads as a deliberate override.

// RTL text plugin (Arabic/Hebrew/Persian shaping): installed by useMapInstance through
// library/maps/rtl-text.js, on BOTH engines, before every map is constructed. Do not re-add a
// hand-rolled mapboxgl-only block here -- it was a strict subset of that call.

/**
 * Each instance gets its own Pinia + i18n so multiple embeds on one page never
 * bleed state into each other.
 */
function buildCountryPostersElement() {
  return defineMapElement({ profileModules })
}

const CountryPostersElement = buildCountryPostersElement()

// Guard prevents "already registered" errors when this IIFE is loaded twice.
if (typeof customElements !== 'undefined') {
  if (!customElements.get('country-posters-map')) {
    customElements.define('country-posters-map', CountryPostersElement)
  }
}

// <dxm-poster-section>: one poster section (any poster type), the reusable element this bundle ships first.
registerPosterSectionElement()

export default CountryPostersElement
