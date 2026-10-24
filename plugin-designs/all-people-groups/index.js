import { defineMapElement } from '@map/elements/defineMapElement.js'
/**
 * plugin-designs/all-people-groups/index.js
 *
 * Bundle entry for the ALL PEOPLE GROUPS map — every people group on earth
 * (peoplegroups.org, 12,379 group×country rows) around the DOXA set.
 *
 * Usage from a host page:
 *   <script src="/doxa-maps/all-people-groups/all-people-groups.js"></script>
 *   <all-people-groups profile-config='{"profile":"all-people-groups"}'></all-people-groups>
 */

const profileModules = import.meta.glob('./*.vue')

const AllPeopleGroupsElement = defineMapElement({ profileModules })

if (typeof customElements !== 'undefined' && !customElements.get('all-people-groups')) {
  customElements.define('all-people-groups', AllPeopleGroupsElement)
}

export default AllPeopleGroupsElement
