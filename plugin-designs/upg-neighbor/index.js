import { defineMapElement } from '@map/elements/defineMapElement.js'
/**
 * upg-neighbor / index.js — bundle entry (emits upg-neighbor.js), defines <upg-neighbor>.
 *
 * The standard ProfileLoader shape (see doxa-simple-map/index.js): the glob captures this
 * folder's one profile, upg-neighbor.vue; its lenses live in src/. The five preset renders
 * are rows of upg-neighbor.instances.json, each opening a different lens via `view`.
 *
 * Mapbox RTL text plugin: registered ONCE at module init — several SEND targets (Urdu/Arabic) are RTL.
 */

const profileModules = import.meta.glob('./*.vue')

// RTL text plugin (Arabic/Hebrew/Persian shaping): installed by useMapInstance through
// library/maps/rtl-text.js, on BOTH engines, before every map is constructed. Do not re-add a
// hand-rolled mapboxgl-only block here -- it was a strict subset of that call.

const El = defineMapElement({ profileModules })
if (typeof customElements !== 'undefined' && !customElements.get('upg-neighbor')) customElements.define('upg-neighbor', El)
