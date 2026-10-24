import { defineMapElement } from '@map/elements/defineMapElement.js'
/**
 * plugin-designs/regions-dashboard/index.js
 *
 * Bundle entry — registers the regions-dashboard web component.
 *
 * This bundle ships the 2-tab Regions element as three flat profiles:
 *   regions-list.vue       — tab 1, "Regions List"
 *   region-dashboards.vue  — tab 2, "Region Dashboards"
 *   regions-mfe.vue        — the COMPOSITE that carries the SELECT VIEW switcher over both
 *                            tabs and forwards tab 1's selection to tab 2
 *
 * The composite nests the two tabs as <regions-dashboard> custom elements of this SAME bundle,
 * each with its own `profile` — so one download serves all three, exactly as my-upg-100-list's
 * upg-100-mfe does. That is why the glob below must keep matching every flat .vue here.
 *
 * Usage from a host page:
 *   <script src="/doxa-maps/regions-dashboard/regions-dashboard.js"></script>
 *   <regions-dashboard profile-config='{"profile":"regions-mfe"}'></regions-dashboard>
 *
 * `profile` must match a flat .vue filename in this folder (without the .vue).
 * The profile-config attribute is parsed by ProfileLoader (in @map).
 */

// ─── Bundle-private profile registry ─────────────────────────────────────────
// import.meta.glob is evaluated by Vite at build time relative to THIS file, so it
// captures only this bundle's profiles — flat .vue files sitting directly here, no
// profiles/ subfolder. Handed to ProfileLoader via app.provide('profileModules', ...).
const profileModules = import.meta.glob('./*.vue')

/**
 * Build the defineCustomElement-wrapped class for this bundle.
 * Each instance gets its own Pinia + i18n — isolation that matters if multiple
 * <regions-dashboard> embeds ever share one page.
 */
function buildRegionsDashboardElement() {
  return defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
      // Install i18n AND hand the instance to ProfileLoader by reference, the way
      // doxa-simple-map/index.js:84-86 does. app.use() alone is not enough: createAppI18n()
      // resolves its locale ONCE from <html lang>, and every generated leaf page bakes
      // lang="en", so the element was permanently English no matter what the host asked for.
      // ProfileLoader drives appI18n.global.locale.value from profile-config.locale (its
      // "established contract", ProfileLoader.vue:148-169) — but only if appI18n is PROVIDED.
      // MEASURED before this line: with a Spanish catalogue present in the bundle and es set,
      // every string still rendered English, and silently, because the t() shim falls back to
      // its key rather than throwing.
  },
})
}

const RegionsDashboardElement = buildRegionsDashboardElement()

// Guard prevents "already registered" errors when this IIFE is loaded twice.
if (typeof customElements !== 'undefined') {
  if (!customElements.get('regions-dashboard')) {
    customElements.define('regions-dashboard', RegionsDashboardElement)
  }
}

export default RegionsDashboardElement
