/**
 * research-dashboard / index.js — Bundle entry (DOXA-LIB-2)
 *
 * Vite multi-entry build target. Emits app/research-dashboard.js.
 *
 * Mirrors plugin-designs/doxa-research-map/index.js (same ProfileLoader plumbing).
 * Registers a SINGLE tag (UNCHANGED from the original profile — only the bundle folder
 * is now plural so it can host N dashboard profiles tomorrow):
 *   - <research-dashboard-map>   config-driven people-group research dashboard
 *
 * The dashboard mounts a Mapbox map in its center cell (Mapbox GL is loaded globally by
 * index.html and the token arrives via profile-config.tk), so the RTL-text plugin is
 * loaded once here, exactly like the map bundles.
 *
 * Profile registry — same Q3 contract as the map bundles: ProfileLoader lives in @map and
 * cannot import.meta.glob across the package boundary, so the bundle evaluates
 * import.meta.glob('./*.vue') HERE and hands the result to the loader via
 * app.provide('profileModules'). The library panels live in @map/components/dashboards and
 * are imported by the profile .vue — the glob only registers the profile screen(s).
 */

import { defineMapElement } from '@map/elements/defineMapElement.js'
import { registerStrategies } from '@map/colors/_registry.js'
import { installRtlTextPlugin } from '@map/maps/rtl-text.js'
// ★ WAS A CROSS-PLUGIN RELATIVE IMPORT into another plugin's PRIVATE folder
// ('../doxa-research-map/src/colors/...'). Both modules now live in library/colors/ (C1), so this
// bundle no longer depends on doxa-research-map's internal layout -- which is the coupling the
// library exists to remove, and the reason this migration had four consumers rather than the two
// the spec counted.
import affinityBlock from '@map/colors/affinity-block.js'
import doxaRegion from '@map/colors/doxa-region.js'

// ─── Bundle-private profile registry ─────────────────────────────────────────
const profileModules = import.meta.glob('./*.vue')

// ─── Bundle-private color strategies (card BUILD-STACKED-TREE-LEGEND) ────────
// The stacked tree legend colours its People and Place trees from the cap-3 research map's
// palettes, so the legend can never drift from the map's pins. Those two strategies are
// PROFILE-LOCAL to doxa-research-map (registered there by its own src/colors glob — see
// plugin-designs/doxa-research-map/index.js:38), so the dashboard bundle's registry does not
// contain them unless we register them here too.
//
// This MATTERS because the failure is silent: getColorStrategy() falls back to language-family
// for an unregistered mode, and useAffinityBlockLegendData.js:57 guards on propertyKey and
// returns {} — so without this, every People swatch would quietly be neutral grey and nothing
// would error. Registering the SAME modules means one palette, not a copied one.
//
// Imported EXPLICITLY rather than via import.meta.glob: a glob is resolved relative to this
// file by Vite and a cross-bundle relative glob that stops matching fails silently (zero
// strategies registered, grey swatches), whereas a named import fails loudly at build time.
registerStrategies({
  './affinity-block.js': { default: affinityBlock },
  './doxa-region.js': { default: doxaRegion },
})

// ─── Mapbox RTL text plugin — load ONCE before any map instance ──────────────
installRtlTextPlugin()

/**
 * Build a fresh defineCustomElement-wrapped class. Each instance gets its own Pinia + i18n
 * so multiple embeds on the same page don't bleed state.
 */
function buildDoxaResearchDashboardElement() {
  return defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
      // ★ HAND THE INSTANCE TO ProfileLoader, DON'T JUST INSTALL IT.
      // ProfileLoader is the root of this custom element, and vue-i18n's useI18n() cannot resolve
      // its injection at a custom-element root — so ProfileLoader takes the i18n INSTANCE by
      // reference through inject('appI18n') and drives its global locale from the host's
      // profile-config. With nothing provided under that key the inject returns null and the
      // watchEffect that applies the locale quietly does nothing.
      //
      // MEASURED with check:host-locale-contract: this leaf answered 0 Arabic characters against a
      // reference of 1,891 for the same page asked for in Arabic by URL. Not a missing catalogue and
      // not a missing i18n install — the install was here all along, one line short of being usable.
      // The sibling map entry (plugin-designs/doxa-research-map/index.js:66) has always provided it;
      // this entry's own header calls itself a mirror of that file, which is how the divergence
      // survived: the two read as the same plumbing until you diff them.
  },
})
}

const DoxaResearchDashboardElement = buildDoxaResearchDashboardElement()

// ─── Register ONE tag — <research-dashboard-map> ────────────────────────────
if (typeof customElements !== 'undefined') {
  if (!customElements.get('research-dashboard-map')) {
    customElements.define('research-dashboard-map', DoxaResearchDashboardElement)
  }
}

export default DoxaResearchDashboardElement
