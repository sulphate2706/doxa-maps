/**
 * plugin-designs/doxa-vision-card/index.js
 *
 * Bundle entry — registers the <doxa-vision-card> web component.
 *
 * Capability-1 (single element) showcase: one folder -> one bundle -> one
 * element. Unlike the map bundles (demo-map, doxa-simple-map, …) this does NOT
 * go through @map/ProfileLoader.vue — there is nothing to load, no nested SPA,
 * no map, no token. The element IS the root component, wrapped directly with
 * Vue's defineCustomElement, so the built IIFE is tiny and renders instantly
 * anywhere HTML+JS runs (iframe embed or direct-JS embed).
 *
 * Folder name = bundle name. This folder builds to exactly one output file:
 *   public/doxa-maps/doxa-vision-card/doxa-vision-card.js
 *
 * Usage from a host page:
 *   <script src=".../doxa-vision-card/doxa-vision-card.js"></script>
 *   <doxa-vision-card></doxa-vision-card>
 *   <!-- optional overrides -->
 *   <doxa-vision-card profile-config='{"accent":"#22d3ee","title":"…"}'></doxa-vision-card>
 */

import { defineCustomElement } from 'vue'
import VisionCard from './doxa-vision-card.vue'

// Root SFC -> custom element. Vue injects the root component's <style> block into
// the element's shadow DOM automatically, so no shadow-style helper is needed.
const VisionCardElement = defineCustomElement(VisionCard)

// One tag per bundle, named after the bundle. The guard prevents an
// "already registered" error if the IIFE is ever loaded twice on one page.
if (typeof customElements !== 'undefined' && !customElements.get('doxa-vision-card')) {
  customElements.define('doxa-vision-card', VisionCardElement)
}

export default VisionCardElement
