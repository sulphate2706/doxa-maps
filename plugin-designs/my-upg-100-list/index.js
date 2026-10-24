import { defineMapElement } from '@map/elements/defineMapElement.js'
/**
 * plugin-designs/my-upg-100-list/index.js
 *
 * Bundle entry — registers the my-upg-100-list web component.
 *
 * Registers ONE custom-element tag:
 *   - <my-upg-100-list-map>   the bundle's tag (sibling of <research-map-embed>)
 *
 * Unlike simple-map (which carries a legacy <map-embed> alias for
 * back-compat), this is a brand-new profile — so there is NO legacy alias
 * (QA A1 / decision S0-D1, default: single tag).
 *
 * Usage from a host page:
 *   <script src="/app/my-upg-100-list.js"></script>
 *   <my-upg-100-list-map profile-config='{"profile":"upg-100-list","tk":"pk.YOUR_MAPBOX_TOKEN"}'></my-upg-100-list-map>
 *
 * The profile-config attribute is parsed by ProfileLoader (in @map).
 * `profile` must match a file in this bundle's profiles/ folder
 * (here: profiles/upg-100-list.vue).
 *
 * Profile registry — ProfileLoader lives inside @map and cannot use
 * import.meta.glob to reach into a bundle's folder. The bundle MUST evaluate
 * import.meta.glob('./*.vue') locally and hand the result to the
 * loader via app.provide('profileModules', ...).
 *
 * Mapbox RTL text plugin: registered ONCE at module init (before any map
 * constructs), lazy-loads when Arabic/Hebrew text appears on the basemap.
 */

// ─── Bundle-private profile registry ─────────────────────────────────────────
// import.meta.glob is evaluated by Vite at build time relative to THIS file —
// so it captures only this bundle's profiles. Handed to ProfileLoader via
// app.provide('profileModules', ...) below.
const profileModules = import.meta.glob('./*.vue')

// RTL text plugin (Arabic/Hebrew/Persian shaping): installed by useMapInstance through
// library/maps/rtl-text.js, on BOTH engines, before every map is constructed. Do not re-add a
// hand-rolled mapboxgl-only block here -- it was a strict subset of that call.

/**
 * Build the defineCustomElement-wrapped class for this bundle.
 *
 * Each instance gets its own Pinia + its own i18n via configureApp — that
 * isolation matters when multiple <my-upg-100-list-map> embeds share a page.
 */
function buildUpg100ListMapElement() {
  return defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
      // Hand the bundle's profile registry to ProfileLoader (Q3 contract).
      // ProfileLoader inject('profileModules')s this — see ProfileLoader.vue.
  },
})
}

const Upg100ListMapElement = buildUpg100ListMapElement()

// ─── Register the single tag name ────────────────────────────────────────────
// Guard prevents "already registered" errors when this IIFE is loaded twice.
if (typeof customElements !== 'undefined') {
  if (!customElements.get('my-upg-100-list-map')) {
    customElements.define('my-upg-100-list-map', Upg100ListMapElement)
  }
}

export default Upg100ListMapElement
