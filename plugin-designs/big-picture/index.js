/**
 * big-picture / index.js — Bundle entry (Capability-4 nested-elements-mfe).
 *
 * ONE folder -> ONE bundle -> THREE custom elements:
 *   1. <bp-big-picture>     — the COMPOSITE. Nests the research header (top) + the REAL cap-2
 *                             people-groups grid (below) and wires them via props/events. Registered
 *                             FIRST so discover.mjs (reads the FIRST customElements.define in
 *                             source) treats this as the bundle's headline tag.
 *   2. <bp-research-header> — the Cat-1 SHARED-control header (SearchBar + 4 FilterDropdowns),
 *                             ALSO registered standalone => individually embeddable; drives a grid
 *                             via `research-filter` { query, wagfRegion, wagfBlock, rop1, religion }.
 *   3. <people-groups-grid> — the REAL Cat-2 grid (same component the people-groups-grid bundle
 *                             ships — NO fork), ALSO registered standalone. Set
 *                             show-search="false"/show-filters="false" to drive it via props.
 *
 * All three register in one synchronous tick; the composite is listed first ONLY so discover.mjs
 * names the bundle after it. Each element is its own root wrapped with defineCustomElement, so the
 * built IIFE renders anywhere HTML+JS runs (the grid fetches live people-groups from pray.doxa.life).
 *
 * Usage — composite (direct-JS, method 3):
 *   <script src=".../big-picture/big-picture.js"></script>
 *   <bp-big-picture></bp-big-picture>
 *
 * Usage — header + grid alone, wired by a host page (also method 3):
 *   <bp-research-header id="h"></bp-research-header>
 *   <people-groups-grid id="t" show-search="false" show-filters="false"></people-groups-grid>
 *   <script>
 *     h.addEventListener('research-filter', e => {
 *       const { query, wagfRegion, wagfBlock, rop1, religion } = e.detail
 *       query      ? t.setAttribute('query',       query)      : t.removeAttribute('query')
 *       wagfRegion ? t.setAttribute('wagf-region', wagfRegion) : t.removeAttribute('wagf-region')
 *       wagfBlock  ? t.setAttribute('wagf-block',  wagfBlock)  : t.removeAttribute('wagf-block')
 *       rop1       ? t.setAttribute('rop1',        rop1)       : t.removeAttribute('rop1')
 *       religion   ? t.setAttribute('religion',    religion)   : t.removeAttribute('religion')
 *     })
 *   </script>
 */

import { defineCustomElement } from 'vue'
import BigPicture from './big-picture.vue'
import ResearchHeader from './src/components/BpResearchHeader.vue'
// The REAL cap-2 grid component (no fork) — registered here so it is individually embeddable
// from THIS bundle too, exactly as the people-groups-grid bundle registers it.
import PeopleGroupsGrid from '../people-groups-grid/people-groups-grid.vue'

const BigPictureElement     = defineCustomElement(BigPicture)
const ResearchHeaderElement = defineCustomElement(ResearchHeader)
const PeopleGroupsGridElement = defineCustomElement(PeopleGroupsGrid)

if (typeof customElements !== 'undefined') {
  // Composite FIRST — this is the discover.mjs headline-tag signal.
  if (!customElements.get('bp-big-picture'))     customElements.define('bp-big-picture', BigPictureElement)
  // Nested elements standalone — individually embeddable.
  if (!customElements.get('bp-research-header')) customElements.define('bp-research-header', ResearchHeaderElement)
  if (!customElements.get('people-groups-grid')) customElements.define('people-groups-grid', PeopleGroupsGridElement)
}

export default BigPictureElement
