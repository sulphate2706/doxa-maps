/**
 * bless-india-posters / index.js — registers <bless-india-posters> (public, experimental).
 *
 * Shows our whole-India poster attempts, generated live (no stored rasters). The attempts ship in the
 * PUBLIC build for this plugin (the whole-country poster on Country Posters stays withheld; India
 * tab is not shipped). Also registers the 'blessIndia' poster type so the standard poster section and the
 * Poster Design catalogue can list + offer the same designs.
 */
import { defineCustomElement } from 'vue'
import BlessIndiaPosters from './bless-india-posters.vue'
import { registerPosterType } from '@map/components/poster/posterTypes.js'
import blessIndiaType from './src/blessIndiaPosterType.js'

registerPosterType('blessIndia', blessIndiaType)

const BlessIndiaPostersElement = defineCustomElement(BlessIndiaPosters)

if (typeof customElements !== 'undefined' && !customElements.get('bless-india-posters')) {
  customElements.define('bless-india-posters', BlessIndiaPostersElement)
}

export default BlessIndiaPostersElement
