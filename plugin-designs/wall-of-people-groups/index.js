/**
 * wall-of-people-groups / index.js — bundle entry (emits wall-of-people-groups.js), defines
 * <wall-of-people-groups>. The standard ProfileLoader shape: the glob captures this folder's one
 * profile; its components live in src/. The wall's components read the store as this.$store (the
 * original app's global property), so it is created here, per element, on the element's Pinia.
 */
import { defineMapElement } from '@map/elements/defineMapElement.js'
import { usePeopleGroupsStore } from './src/stores/peopleGroupsStore.js'

const profileModules = import.meta.glob('./*.vue')

const El = defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
    const store = usePeopleGroupsStore(pinia)
    store.loadFromLocalStorage()
    app.config.globalProperties.$store = store
  },
})
if (typeof customElements !== 'undefined' && !customElements.get('wall-of-people-groups')) customElements.define('wall-of-people-groups', El)
