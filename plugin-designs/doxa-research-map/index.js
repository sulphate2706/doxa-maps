import { defineMapElement } from '@map/elements/defineMapElement.js'
/**
 * doxa-research-map / index.js — Bundle entry
 *
 * Vite multi-entry build target. Emits app/doxa-maps/doxa-research-map/doxa-research-map.js.
 *
 * Registers ONE custom-element tag that mounts ProfileLoader:
 *   - <doxa-research-map>   explicit tag matching the bundle name
 * The legacy <doxa-map> tag is owned by the doxa-simple-map bundle — this
 * bundle deliberately does not register it (see the registration comment below).
 *
 * The profile-config attribute is parsed by ProfileLoader (in @map). `profile`
 * must match a .vue file in this bundle's folder.
 *
 * Profile registry — Q3 contract from the migration plan: ProfileLoader lives
 * inside @map, so it cannot use import.meta.glob to reach into a bundle's
 * folder. The bundle evaluates import.meta.glob('./*.vue') HERE and
 * hands the result to the loader via app.provide('profileModules').
 */

// ─── Bundle-private profile registry ─────────────────────────────────────────
// import.meta.glob is evaluated by Vite at build time relative to THIS file —
// so it captures only this bundle's profiles.
const profileModules = import.meta.glob('./*.vue')

// ★ THE LOCAL COLOUR GLOB IS GONE (C1b). This bundle registered its own src/colors/*.js over the
// shared set; all three modules (doxa-region, affinity-block, resource) now live in library/colors/
// where _registry.js discovers them for every bundle, and src/colors/ holds no .js at all. The glob
// matched nothing, so leaving it would be dead code that reads as a deliberate override.

// RTL text plugin (Arabic/Hebrew/Persian shaping): installed by useMapInstance through
// library/maps/rtl-text.js, on BOTH engines, before every map is constructed. Do not re-add a
// hand-rolled mapboxgl-only block here -- it was a strict subset of that call.

/**
 * Build a fresh defineCustomElement-wrapped class. Each instance gets its own
 * Pinia + i18n so multiple embeds on the same page don't bleed state.
 */
function buildDoxaResearchMapElement() {
  return defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
      // Install i18n AND hand the instance to ProfileLoader by reference. The
      // defineCustomElement root cannot use useI18n() (see ProfileLoader.vue);
      // it drives locale through this provided instance instead.
  },
})
}

const DoxaResearchMapElement = buildDoxaResearchMapElement()

// ─── Register ONE tag — <doxa-research-map> ──────────────────────────────────
// IMPORTANT: this bundle deliberately does NOT register <doxa-map>. The legacy
// <doxa-map> tag is owned exclusively by the doxa-simple-map bundle. Why:
// customElements.define() is one-shot per tag per page session; if BOTH bundles
// registered <doxa-map>, an SPA user who visited /research first would have the
// research bundle's profileModules stuck on <doxa-map>, then any subsequent
// /home / /pray / /adopt navigation would render <doxa-map> with the research
// bundle's profile registry — which has 'research-map' but not 'doxa-simple-map',
// producing the "Profile not found" error. DoxaMapSlot already uses distinct
// tags per bundle (<doxa-map> vs <doxa-research-map>) — keep them disjoint here.
if (typeof customElements !== 'undefined') {
  if (!customElements.get('doxa-research-map')) {
    customElements.define('doxa-research-map', DoxaResearchMapElement)
  }
}

export default DoxaResearchMapElement
