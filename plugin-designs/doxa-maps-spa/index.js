/**
 * doxa-maps-spa / index.js — Bundle entry (Capability-5 nested-mfe-spa / app-shell).
 *
 * ONE folder -> ONE bundle -> ONE custom element: <doxa-maps-spa>.
 *
 * <doxa-maps-spa> is the OUTER app-shell of the whole DX-maps app: a vertical-tab layout whose
 * tab-1 is the Cat-4 Big Picture (mounted directly via its real <bp-big-picture> tag + the built
 * big-picture.js) and whose other tabs are every production research map, each nested as its OWN
 * full SPA via that map's standalone leaf page (iframe). See doxa-maps-spa.vue for the full why.
 *
 * ★ ONE-SHOT-DEFINE SAFETY: the ONLY tag this bundle registers is <doxa-maps-spa>. It NEVER
 *   imports another plugin's components and NEVER re-registers a tag another bundle owns. The
 *   nested maps register their own tags when THEIR IIFE loads (tab-1 loads big-picture.js at
 *   runtime; the iframe tabs run each map's own document). So loading this bundle beside any other
 *   bundle can never collide.
 *
 * ★ TREE BASE: to find each nested map's .js / leaf page, the shell needs the built tree's root
 *   URL. We derive it HERE, at IIFE load, from this script's own URL
 *   (.../doxa-maps/doxa-maps-spa/doxa-maps-spa.js) → two levels up = the tree root. That value is
 *   provided to the Vue app so the element self-locates from wherever the tree is served (any
 *   static host, a subpath, file://). A host can still override it with the tree-base="" attribute
 *   or profile-config.treeBase.
 *
 * Usage from a host page (direct-JS, deploy-method-3):
 *   <script src="/dx-maps/doxa-maps-spa/doxa-maps-spa.js"></script>
 *   <doxa-maps-spa></doxa-maps-spa>
 *   <!-- or pin the tree explicitly: -->
 *   <doxa-maps-spa tree-base="https://your-host/doxa-maps"></doxa-maps-spa>
 */

import { defineCustomElement } from 'vue'
import DoxaMapsSpa from './doxa-maps-spa.vue'
import { deriveTreeBase } from '@map/utils/embedScript.js'

// Capture the running <script>'s own URL synchronously at IIFE load, BEFORE any async runs, so
// document.currentScript is still this bundle's tag. Derive the tree root = two levels up
// (.../doxa-maps/doxa-maps-spa/doxa-maps-spa.js → .../doxa-maps/). Guarded for non-browser.
const TREE_BASE = deriveTreeBase()

const DoxaMapsSpaElement = defineCustomElement(DoxaMapsSpa, {
  configureApp(app) {
    // Hand the derived tree root to the component (props/attrs still override it).
    app.provide('dmsTreeBase', TREE_BASE)
  }
})

if (typeof customElements !== 'undefined' && !customElements.get('doxa-maps-spa')) {
  customElements.define('doxa-maps-spa', DoxaMapsSpaElement)
}

export default DoxaMapsSpaElement
