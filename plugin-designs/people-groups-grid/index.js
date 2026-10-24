/**
 * people-groups-grid / index.js — Bundle entry (Capability-2 prop-table / preset-element).
 *
 * ONE folder -> ONE bundle -> ONE custom element: <people-groups-grid>.
 *
 * This is a COPY-ONLY migration of the DX-life people-groups grid (UupgsList.vue) into an
 * OWNED, self-contained custom element. It carries the Cat-2 contract:
 *   - By default it owns its search box + the four filter dropdowns.
 *   - show-search="false" / show-filters="false" turn those off so a parent header drives it
 *     via the query / wagf-region / wagf-block / rop1 / religion props.
 *   - It emits `groups-filtered` (Vue emit + native bubbling CustomEvent) so a host can react.
 *
 * Usage (direct-JS):
 *   <script src=".../people-groups-grid/people-groups-grid.js"></script>
 *   <people-groups-grid pray-base-url="https://pray.doxa.life"></people-groups-grid>
 *
 * Usage (externally driven, e.g. inside the Big-Picture Cat-4 shell):
 *   <people-groups-grid id="grid" show-search="false" show-filters="false"></people-groups-grid>
 *   <script>
 *     grid.addEventListener('groups-filtered', e => console.log(e.detail.total))
 *     grid.setAttribute('query', 'somali')
 *     grid.setAttribute('religion', 'Islam')
 *   </script>
 */
import { defineCustomElement } from 'vue'
import PeopleGroupsGrid from './people-groups-grid.vue'

const PeopleGroupsGridElement = defineCustomElement(PeopleGroupsGrid)

if (typeof customElements !== 'undefined') {
  if (!customElements.get('people-groups-grid')) {
    customElements.define('people-groups-grid', PeopleGroupsGridElement)
  }
}

export default PeopleGroupsGridElement
