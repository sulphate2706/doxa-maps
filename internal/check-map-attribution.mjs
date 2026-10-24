#!/usr/bin/env node
/**
 * check-map-attribution — the credit line names the basemap of the engine that actually drew the map.
 *
 * WHY (licence credit, row 28 at ccc2b1bb): addMapAttribution always credited "Mapbox ·
 * © OpenStreetMap". Under MapLibre the tiles are OpenFreeMap's (OpenMapTiles on OpenStreetMap), so
 * gospel-resources, key-cities and cities-internet credited Mapbox, which served nothing, and omitted
 * the OpenMapTiles credit. Headless: the real module against stand-in map classes and a minimal DOM.
 * EXIT 0 pass · 1 fail
 */
const made = []
globalThis.window = globalThis
globalThis.document = { createElement: () => { const el = { style: {}, className: '', innerHTML: '' }; made.push(el); return el } }
class MapboxMap { addControl(c) { this.ctrl = c.onAdd() } }
class MaplibreMap { addControl(c) { this.ctrl = c.onAdd() } }
window.mapboxgl = { Map: MapboxMap }
window.maplibregl = { Map: MaplibreMap }
const { addMapAttribution, attributionText, ATTRIBUTION_TEXT } = await import('../library/composables/useMapAttribution.js')
let bad = 0
const check = (name, ok, got) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ' — ' + got}`) }
const ml = new MaplibreMap(); addMapAttribution(ml, { boundaries: true })
check('MapLibre map credits OpenFreeMap, OpenMapTiles and OSM contributors', /OpenFreeMap/.test(ml.ctrl.innerHTML) && /OpenMapTiles/.test(ml.ctrl.innerHTML) && /OpenStreetMap contributors/.test(ml.ctrl.innerHTML), ml.ctrl.innerHTML)
check('MapLibre map does NOT credit Mapbox', !/Mapbox/.test(ml.ctrl.innerHTML), ml.ctrl.innerHTML)
const mb = new MapboxMap(); addMapAttribution(mb, { boundaries: true })
check('Mapbox map credits Mapbox and OpenStreetMap', /Mapbox/.test(mb.ctrl.innerHTML) && /OpenStreetMap/.test(mb.ctrl.innerHTML), mb.ctrl.innerHTML)
check('both credit geoBoundaries', /geoBoundaries/.test(ml.ctrl.innerHTML) && /geoBoundaries/.test(mb.ctrl.innerHTML), '')
const nb = new MaplibreMap(); addMapAttribution(nb, { boundaries: true, basemap: false })
check('basemap:false leaves only the boundaries credit', !/OpenFreeMap|Mapbox/.test(nb.ctrl.innerHTML), nb.ctrl.innerHTML)
check('print text for maplibre names OpenMapTiles, not Mapbox', /OpenMapTiles/.test(attributionText('maplibre')) && !/Mapbox/.test(attributionText('maplibre')), attributionText('maplibre'))
check('ATTRIBUTION_TEXT (existing importers) is unchanged', ATTRIBUTION_TEXT === 'Boundaries: geoBoundaries (geoboundaries.org) · © Mapbox © OpenStreetMap', ATTRIBUTION_TEXT)
if (bad) { console.log(`MAP-ATTRIBUTION: FAIL — ${bad} case(s).`); process.exit(1) }
console.log('MAP-ATTRIBUTION: PASS — the credit names the basemap of the engine that drew the map.')
