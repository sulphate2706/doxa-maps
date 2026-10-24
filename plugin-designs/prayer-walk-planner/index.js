/**
 * plugin-designs/prayer-walk-planner/index.js
 *
 * Bundle entry for PRAYER WALK PLANNER — an experimental capability-1 plugin.
 *
 * Usage from a host page:
 *   <script src="/dx-maps/prayer-walk-planner/prayer-walk-planner.js"></script>
 *   <prayer-walk-planner></prayer-walk-planner>
 *
 * ★ MOUNTS THE ROOT SFC DIRECTLY — no ProfileLoader. Same choice golden-path-check and
 * doxa-vision-card make, and for the same reason: this plugin draws its own MapLibre
 * instance via @map/composables/useMapInstance.js with provider:'maplibre' — it needs NO
 * Mapbox token, NO dataSource/colorSet wiring, and NO multi-profile switching (ProfileLoader
 * exists to parse profile-config JSON and route to one of several flat .vue screens — this
 * bundle ships exactly one screen and reads nothing from a profile-config attribute).
 * Routing it through ProfileLoader would add three Pinia stores and a config parser this
 * component never uses — see golden-path-check/index.js's header for the concrete failure
 * that mistake causes (a thrown setup() removes the whole shadow-DOM subtree silently).
 *
 * ★ CLIENT-SIDE API, NOT A BACKEND. The site is JAMstack with no server API of its own, so the
 * only API this tool can offer is CLIENT SIDE. The root
 * component defineExpose()s addPolygon/deletePolygon/selectPolygon/print/list methods.
 * Because this bundle mounts the SFC AS the defineCustomElement root (not nested under
 * ProfileLoader), Vue's custom-element bridge surfaces those exposed methods directly on the
 * DOM element instance — `document.querySelector('prayer-walk-planner').addPolygon(...)`
 * works with no further wiring. See prayer-walk-planner.vue's header for the full surface.
 */

import { defineCustomElement } from 'vue'
import PrayerWalkPlanner from './prayer-walk-planner.vue'
import { createAppI18n } from '@map/i18n/index.js'

// ★ configureApp WITHOUT changing the mounting shape. This bundle deliberately mounts the
// SFC AS the custom-element root so Vue's bridge surfaces its defineExpose()d client-side
// API on the DOM element (a JAMstack site: the only API it can offer is client side).
// That decision and i18n are ORTHOGONAL — the second argument takes configureApp whichever
// component is the root, so this keeps addPolygon/print/listPolygons on the element.
//
// ⚠ IT IS REQUIRED, not cosmetic. Any shared component that calls useI18n() — ShareButton
// does — THROWS in setup() without it, and this file's own header records what that costs:
// "a thrown setup() removes the whole shadow-DOM subtree silently." Measured 2026-09-24:
// adding <ShareButton> with no i18n installed produced a SyntaxError at runtime, the whole
// toolbar rendered its other five buttons and the share button simply did not exist —
// while check:share-policy, which counts <ShareButton> in SOURCE, stayed green.
const PrayerWalkPlannerElement = defineCustomElement(PrayerWalkPlanner, {
  configureApp(app) {
    const i18n = createAppI18n()
    app.use(i18n)
    app.provide('appI18n', i18n)
  }
})

if (typeof customElements !== 'undefined' && !customElements.get('prayer-walk-planner')) {
  customElements.define('prayer-walk-planner', PrayerWalkPlannerElement)
}

export default PrayerWalkPlannerElement
