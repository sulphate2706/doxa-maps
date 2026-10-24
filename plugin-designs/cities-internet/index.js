import { defineMapElement } from '@map/elements/defineMapElement.js'
/**
 * plugin-designs/cities-internet/index.js — bundle entry for CITIES WITH INTERNET.
 *
 * Registers ONE custom-element tag:
 *   <cities-internet-map profile-config='{"profile":"connectivity-list"}'></cities-internet-map>
 *
 * Same shape as country-posters/index.js — folder = bundle, each flat .vue = a
 * profile, `profile` is the FILENAME not the folder. ProfileLoader lives in @map
 * and cannot glob into a bundle folder, so the BUNDLE evaluates the glob and hands
 * the registry over via app.provide('profileModules').
 *
 * NO COLOR STRATEGIES registered here: this bundle currently ships a list profile
 * only. When the map profile lands it will need one, and it goes in src/colors/
 * where the registry auto-discovers it by filename.
 *
 * NO MAPBOX RTL PLUGIN either — nothing here renders a basemap yet. Adding the
 * plugin call before a map exists would be dead code implying a capability the
 * bundle does not have.
 */

// Evaluated by Vite at build time relative to THIS file, so it captures only this
// bundle's profiles.
const profileModules = import.meta.glob('./*.vue')

function buildCitiesInternetElement() {
  return defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
      // Per-instance Pinia + i18n so multiple embeds on one page never bleed state.
  },
})
}

const CitiesInternetElement = buildCitiesInternetElement()

// Guarded: customElements.define() is one-shot per tag per page session, so an
// IIFE loaded twice would throw without this.
if (typeof customElements !== 'undefined') {
  if (!customElements.get('cities-internet-map')) {
    customElements.define('cities-internet-map', CitiesInternetElement)
  }
}

export default CitiesInternetElement
