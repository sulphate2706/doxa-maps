/**
 * plugin-designs/bible-posters/index.js
 *
 * Bundle entry for the Bible Posters generator (Posterverse → Experimental).
 * Folder name = bundle name = tag. One flat profile: bible-posters.vue.
 * Builds to public/dx-maps/bible-posters/bible-posters.js.
 *
 * This plugin has NO map — it is a text/poster generator — so it registers no colour strategies and
 * needs no Mapbox token; it honours only the reader's LOCALE (interface language) through the provided
 * i18n instance, exactly like every other plugin.
 *
 *   <script src="/dx-maps/bible-posters/bible-posters.js"></script>
 *   <bible-posters profile-config='{"profile":"bible-posters","locale":"ar"}'></bible-posters>
 */
import { defineMapElement } from '@map/elements/defineMapElement.js'

const profileModules = import.meta.glob('./*.vue')

const BiblePostersElement = defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
    // defineMapElement already installs Pinia + i18n and provides the i18n instance to ProfileLoader
    // (that is how a host sets the interface language). This hook is only for extra app-level provides;
    // Bible Posters needs none.
  },
})

if (typeof customElements !== 'undefined' && !customElements.get('bible-posters')) {
  customElements.define('bible-posters', BiblePostersElement)
}

export default BiblePostersElement
