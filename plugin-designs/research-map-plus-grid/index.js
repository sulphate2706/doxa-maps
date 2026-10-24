/**
 * research-map-plus-grid / index.js — Bundle entry (Capability-4 nested-elements-mfe, COMPOSED variant).
 *
 * ONE folder -> ONE bundle -> ONE element:
 *   <research-map-plus-grid> — stacks the doxa-research-map (cap-3) above the people-groups-grid
 *   (cap-2). THE MOBILE SIBLING of <dashboard-plus-grid>.
 *
 * Usage — direct-JS (method 3):
 *   <script src=".../research-map-plus-grid/research-map-plus-grid.js"></script>
 *   <research-map-plus-grid></research-map-plus-grid>
 *
 * ── WHY THIS ENTRY IS SMALL (and why that is correct here) ───────────────────
 * dashboard-plus-grid's entry must install Pinia + i18n itself, because that composite IMPORTS its
 * children's .vue files directly and therefore bypasses their bundle entries — the appContext they
 * would normally get has to be recreated by hand (BUG-VUE-I18N-CODE27).
 *
 * THIS composite does the opposite: it composes by TAG + BUNDLE URL through StackLayout, so each
 * child is injected as its OWN built bundle and boots through its OWN index.js. That means
 * doxa-research-map/index.js still runs — and with it the four things a direct .vue import would
 * have silently dropped: registerStrategies() for its three bundle-private colour strategies,
 * provide('profileModules') for the ProfileLoader mount, its own Pinia + i18n pair, and
 * setRTLTextPlugin. Re-installing them here would be redundant at best and a second Pinia at worst.
 *
 * The root component itself only renders StackLayout and calls no useI18n(), so it needs no
 * configureApp. Keep it that way: if this element ever grows chrome of its own that calls
 * useI18n(), add the createPinia() + createAppI18n() + provide('appI18n') trio exactly as
 * dashboard-plus-grid/index.js does — a thrown setup() removes the subtree with an EMPTY
 * SyntaxError and NO build failure.
 */
import { defineCustomElement } from 'vue'
import ResearchMapPlusGrid from './research-map-plus-grid.vue'

const ResearchMapPlusGridElement = defineCustomElement(ResearchMapPlusGrid)

if (typeof customElements !== 'undefined') {
  // One-shot-define safety: register ONLY this bundle's own tag, and only if free. The child tags
  // (<doxa-research-map>, <people-groups-grid>) are registered by THEIR bundles when StackLayout
  // injects them — never re-register another bundle's tag here.
  if (!customElements.get('research-map-plus-grid')) {
    customElements.define('research-map-plus-grid', ResearchMapPlusGridElement)
  }
}

export default ResearchMapPlusGridElement
