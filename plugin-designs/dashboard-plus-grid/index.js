/**
 * dashboard-plus-grid / index.js — Bundle entry (Capability-4 nested-elements-mfe, BAKED variant).
 *
 * ONE folder -> ONE bundle -> ONE self-contained element:
 *   <dashboard-plus-grid> — bakes the research-dashboard + people-groups-grid components DIRECTLY into
 *   one compiled bundle (no runtime bundle injection) and stacks them via the shared StackLayout so the
 *   host page scrolls through both. This is "two elements baked together into one."
 *
 * Usage — direct-JS (method 3):
 *   <script src=".../dashboard-plus-grid/dashboard-plus-grid.js"></script>
 *   <dashboard-plus-grid></dashboard-plus-grid>
 */
import { defineCustomElement } from 'vue'
import { createPinia } from 'pinia'
import { createAppI18n } from '@map/i18n/index.js'
import { registerStrategies } from '@map/colors/_registry.js'
import { installRtlTextPlugin } from '@map/maps/rtl-text.js'
// ★ WAS A CROSS-PLUGIN RELATIVE IMPORT into another plugin's PRIVATE folder
// ('../doxa-research-map/src/colors/...'). Both modules now live in library/colors/ (C1), so this
// bundle no longer depends on doxa-research-map's internal layout -- which is the coupling the
// library exists to remove, and the reason this migration had four consumers rather than the two
// the spec counted.
import affinityBlock from '@map/colors/affinity-block.js'
import doxaRegion from '@map/colors/doxa-region.js'
import DashboardPlusGrid from './dashboard-plus-grid.vue'

// ─── THE SAME BYPASS AS THE i18n BUG BELOW, SECOND LEG (card BUILD-MAP-STYLE-...) ────────────
// The note below explains that importing research-dashboard.vue DIRECTLY bypasses
// plugin-designs/research-dashboard/index.js. That entry installs i18n — which was fixed — AND
// registers the two PROFILE-LOCAL colour strategies the dashboard needs (index.js:48). Only the
// i18n leg was fixed; this is the colour leg of the identical root cause.
//
// `affinityBlock` and `doxaRegion` are bundle-private to doxa-research-map, so without this the
// composite's registry simply does not contain them. MEASURED in the cap-5 shell 2026-09-22:
// the Region donut, the Top-countries bars and the Place tree swatches all rendered GREY, while
// the very same build rendered them correctly in the standalone host.
//
// THE FAILURE IS SILENT BY DESIGN, which is why it survived: getColorStrategy() falls back to
// language-family for an unregistered mode, and every consumer guards on propertyKey and
// returns a neutral instead of throwing. Nothing errors; the colour is just quietly absent.
//
// Imported EXPLICITLY, not via import.meta.glob — a cross-bundle relative glob resolves against
// THIS file and fails SILENTLY if it stops matching (zero strategies, grey swatches), whereas a
// named import fails loudly at build time. Registering the SAME modules means one palette, not
// a copied one.
registerStrategies({
  './affinity-block.js': { default: affinityBlock },
  './doxa-region.js': { default: doxaRegion },
})

// ★ THE FOURTH SIDE EFFECT OF research-dashboard/index.js, which this composite BAKES rather than
// composes — so none of that entry's work happens here unless it is repeated. Measured before this
// line existed: research-dashboard.js and doxa-research-map.js each shipped mapbox-gl-rtl-text once,
// dashboard-plus-grid.js shipped it ZERO times, so Arabic/Hebrew/Persian labels rendered reversed in
// the cap-5 shell and correctly standalone. Arab World (99 rows) and Persian-Median (49) are in
// scope, and a reversed label is a wrong NAME, not a style issue. It failed silently.
installRtlTextPlugin()

// ─── configureApp is NOT optional for a BAKED composite ──────────────────────
// BUG-VUE-I18N-CODE27-SYNTAXERROR-ON-EVERY-MOUNT. dashboard-plus-grid.vue imports
// research-dashboard.vue DIRECTLY, which bypasses plugin-designs/research-dashboard/index.js
// — and that entry, not the .vue, is where `app.use(createAppI18n())` lives. So the baked
// library components that call useI18n() (ShareButton, ZoomInButton, ZoomOutButton) landed in
// an appContext with no __VUE_I18N_SYMBOL__ and useI18n() threw I18nErrorCodes.NOT_INSTALLED
// (runtime code 27 — "Need to install with `app.use` function").
//
// The throw surfaces as a bare `SyntaxError` with an EMPTY message, which is badly misleading:
// vue-i18n builds every error through the message-compiler's createCompileError(), which does
// `new SyntaxError(...)`, and in a production build it passes no message table at all. Nothing
// is being parsed and nothing is being minified — read the CODE, not the error class.
//
// It was never cosmetic: setup() threw, so Vue aborted those three subtrees and the composite
// silently shipped WITHOUT its Share / Zoom in / Zoom out map controls, which cap-3 has.
//
// Installing the same Pinia + i18n pair the sibling entries install makes the baked children
// see exactly the appContext they would get when mounted through their own bundle entry.
const DashboardPlusGridElement = defineCustomElement(DashboardPlusGrid, {
  configureApp(app) {
    app.use(createPinia())
    const i18n = createAppI18n()
    app.use(i18n)
    // Same contract as the map bundles: the defineCustomElement ROOT cannot call useI18n()
    // (see ProfileLoader.vue), so any root-level locale driving goes through this instance.
    app.provide('appI18n', i18n)
  }
})

if (typeof customElements !== 'undefined') {
  if (!customElements.get('dashboard-plus-grid')) customElements.define('dashboard-plus-grid', DashboardPlusGridElement)
}

export default DashboardPlusGridElement
