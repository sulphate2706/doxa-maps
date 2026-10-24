/**
 * stack-demo / index.js — Bundle entry (Capability-4 nested-elements-mfe, STACK variant).
 *
 * ONE folder -> ONE bundle -> ONE headline element:
 *   <stack-demo> — the COMPOSITE. Uses the shared StackLayout to render two elements
 *                  (<research-dashboard-map> then <people-groups-grid>) STACKED top-to-bottom,
 *                  each at natural height, so the host page scrolls through both.
 *
 * The two nested elements are NOT bundled in here — StackLayout injects their bundles at runtime
 * (via each section's `src`, deduped), then mounts the element. This keeps stack-demo tiny and lets
 * it compose ANY already-published elements by tag + src. Registers <stack-demo> first so
 * discover.mjs names the bundle after it.
 *
 * Usage — direct-JS (method 3):
 *   <script src=".../stack-demo/stack-demo.js"></script>
 *   <stack-demo></stack-demo>
 * Or iframe its leaf page and let the host page scroll.
 */
import { defineCustomElement } from 'vue'
import StackDemo from './stack-demo.vue'

const StackDemoElement = defineCustomElement(StackDemo)

if (typeof customElements !== 'undefined') {
  if (!customElements.get('stack-demo')) customElements.define('stack-demo', StackDemoElement)
}

export default StackDemoElement
