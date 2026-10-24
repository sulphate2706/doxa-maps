import { defineMapElement } from '@map/elements/defineMapElement.js'
/**
 * pplr-data-maps / index.js — bundle entry (emits pplr-data-maps.js), defines <pplr-data-maps>.
 *
 * The standard ProfileLoader shape (see doxa-simple-map/index.js): the glob captures this
 * folder's one profile, pplr-data-maps.vue; its ten views live in src/views/. The Mapbox RTL
 * text plugin is registered once here: many PG names are Arabic, Urdu or Hebrew.
 */

const profileModules = import.meta.glob('./*.vue')

// RTL text plugin (Arabic/Hebrew/Persian shaping): installed by useMapInstance through
// library/maps/rtl-text.js, on BOTH engines, before every map is constructed. Do not re-add a
// hand-rolled mapboxgl-only block here -- it was a strict subset of that call.

const El = defineMapElement({ profileModules })
if (typeof customElements !== 'undefined' && !customElements.get('pplr-data-maps')) customElements.define('pplr-data-maps', El)
