/**
 * plugin-designs/golden-path-check/index.js
 *
 * Bundle entry for the GOLDEN PATH CHECK — the capability-1 self-test of the
 * develop-a-plugin-and-see-it-live path.
 *
 * Usage from a host page:
 *   <script src="/doxa-maps/golden-path-check/golden-path-check.js"></script>
 *   <golden-path-check></golden-path-check>
 *
 * Registers ONLY its own tag (one-shot-define safety: never re-register another bundle's tag,
 * never import another plugin's components).
 *
 * ★ MOUNTS THE ROOT SFC DIRECTLY — no ProfileLoader. This is the cap-1 pattern, and it is the
 * SAME choice doxa-vision-card makes. It is also a defect this plugin HIT and fixed, which is
 * worth recording because it is the first thing a new plugin author will get wrong:
 *
 *   The first version wrapped this element in ProfileLoader (copying all-people-groups, a MAP
 *   bundle) but omitted `app.use(createPinia())`. ProfileLoader creates uiStore/mapStore/
 *   dataStore in its setup(), so without Pinia its setup THREW — and a thrown setup() removes
 *   the subtree SILENTLY. The build stayed green, the manifest listed the bundle, and only
 *   `bun run smoke:embeds` caught it: "shadow DOM nearly empty (1 nodes)". That is exactly the
 *   failure Step 3b of the golden path exists to catch, and why the doc puts it BEFORE publish.
 *
 *   The fix is not "add Pinia". ProfileLoader exists to parse profile-config, resolve a profile
 *   .vue, and wire a token / dataSource / colorSet / stores — a MAP plugin's needs. This element
 *   draws no tiles, fetches no API and takes no token, so routing it through the loader would
 *   add three stores and a config parser to a component that wants none of them. A cap-1 element
 *   mounts its own SFC; reach for ProfileLoader when you actually need what it provides.
 */

import { defineCustomElement } from 'vue'
import GoldenPathCheck from './golden-path-check.vue'

const GoldenPathCheckElement = defineCustomElement(GoldenPathCheck)

if (typeof customElements !== 'undefined' && !customElements.get('golden-path-check')) {
  customElements.define('golden-path-check', GoldenPathCheckElement)
}

export default GoldenPathCheckElement
