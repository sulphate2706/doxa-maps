/**
 * plugin-designs/country-map/index.js
 *
 * Bundle entry — registers <doxa-country-map>.
 *
 * Usage from a host page (a DX-life country page is the first consumer):
 *   <script src="/dx-maps/country-map/country-map.js"></script>
 *   <doxa-country-map profile-config='{"profile":"country-map","countryCodes":["TCD"],"colorByPrayer":true}'></doxa-country-map>
 *
 * ONE tag, unlike doxa-simple-map's two: there is no legacy name to keep working, because nothing
 * has ever embedded this map on its own. Adding a second alias now would create the back-compat
 * problem rather than solve one.
 */
import { defineMapElement } from '@map/elements/defineMapElement.js'
import { registerStrategies } from '@map/colors/_registry.js'

// Evaluated by Vite relative to THIS file, so it captures only this bundle's profiles, and handed
// to ProfileLoader via app.provide('profileModules') — the Q3 contract, same as every bundle.
const profileModules = import.meta.glob('./*.vue')

// Bundle-private colour strategies. Empty today: this bundle draws with the shared region palette
// and the prayer strategy the library already registers.
registerStrategies(import.meta.glob('./src/colors/*.js', { eager: true }))

const DoxaCountryMapElement = defineMapElement({ profileModules, configureApp: () => {} })

if (typeof customElements !== 'undefined' && !customElements.get('doxa-country-map')) {
  customElements.define('doxa-country-map', DoxaCountryMapElement)
}

export default DoxaCountryMapElement
