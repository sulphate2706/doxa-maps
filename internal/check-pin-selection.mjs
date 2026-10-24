#!/usr/bin/env node
/**
 * check-pin-selection — the shared source reader understands BOTH engines, and says so when it cannot read.
 *
 * ★ WHY THIS EXISTS, and it is a specific bug rather than a principle. library/maps/pin-selection.js
 * reads a GeoJSON source's features to answer "which pins does this expression select" — it backs
 * zoomToLegendRow (the camera fit on a legend row click) for research-map, country-posters and
 * doxa-simple-map, and the research map's prayer packet. It was written against Mapbox, where
 * `source._data` IS the GeoJSON. maplibre-gl wraps it:
 *
 *     this._data = typeof options.data === 'string' ? { url: options.data } : { geojson: options.data }
 *
 * so `data.features` was undefined and the reader returned an EMPTY LIST on MapLibre — the keyless
 * engine the public builds use. Measured on 2026-09-28: a language-family selection and a
 * prayer selection both logged "0 pin(s) selected" with the pins plainly on screen.
 *
 * ★ THE FAILURE MODE IS WHY A TEST IS THE ONLY GUARD. Every caller is written to NO-OP when it finds no
 * features — deliberately, so a legend row for an off-screen region degrades quietly rather than
 * throwing. So the engine bug produced no error, no console line and no visual difference except a
 * camera that did not move. Nothing but an assertion on both shapes can see it.
 *
 * WHAT IT ASSERTS, with no browser and no map:
 *   1. the MAPBOX shape (raw FeatureCollection on _data) reads its features;
 *   2. the MAPLIBRE shape ({ geojson }) reads the SAME features — the regression that shipped;
 *   3. a REMOTE source ({ url }) returns [] and WARNS — "cannot read" is a different fact from "found
 *      none", and collapsing them is how the first bug hid;
 *   4. the serialize() fallback still works, and a missing source is [] rather than a throw;
 *   5. selectedPinIds ANDs its expressions and returns ids, so the reader and the evaluator agree.
 *
 * Headless, no network. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'PIN-SELECTION'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { readSourceFeatures, selectedPinIds, matchesExpression } =
  await import(resolve(ROOT, 'library/maps/pin-selection.js'))

const FEATURES = [
  { type: 'Feature', properties: { uniqueId: 'a', languageFamily: 'Afro-Asiatic' }, geometry: { type: 'Point', coordinates: [1, 1] } },
  { type: 'Feature', properties: { uniqueId: 'b', languageFamily: 'Indo-European' }, geometry: { type: 'Point', coordinates: [2, 2] } },
  { type: 'Feature', properties: { uniqueId: 'c', languageFamily: 'Afro-Asiatic' }, geometry: { type: 'Point', coordinates: [3, 3] } },
]
const COLLECTION = { type: 'FeatureCollection', features: FEATURES }
const mapWith = (src) => ({ getSource: (id) => (id === 'pins' ? src : null) })

const fails = []
const eq = (what, got, want) => { if (got !== want) fails.push(`${what}: got ${got}, expected ${want}`) }

// 1 + 2 — the two engines must agree, which is the whole point
eq('mapbox shape (_data = FeatureCollection)', readSourceFeatures(mapWith({ _data: COLLECTION }), 'pins').length, 3)
eq('maplibre shape (_data = { geojson })', readSourceFeatures(mapWith({ _data: { geojson: COLLECTION } }), 'pins').length, 3)

// 3 — a remote source: empty AND loud
const warned = []
const realWarn = console.warn
console.warn = (...a) => warned.push(a.join(' '))
const remote = readSourceFeatures(mapWith({ _data: { url: 'https://example.invalid/pins.json' } }), 'pins')
console.warn = realWarn
eq('remote ({ url }) returns no features', remote.length, 0)
if (!warned.some((w) => w.includes('remote'))) fails.push('remote ({ url }): returned [] SILENTLY — "cannot read" must not look like "found none"')

// 4 — fallbacks
eq('serialize() fallback', readSourceFeatures(mapWith({ serialize: () => ({ data: COLLECTION }) }), 'pins').length, 3)
eq('missing source', readSourceFeatures(mapWith(null), 'pins').length, 0)
eq('single Feature (not a collection)', readSourceFeatures(mapWith({ _data: FEATURES[0] }), 'pins').length, 1)

// 5 — the reader and the evaluator agree, on both shapes
for (const [label, src] of [['mapbox', { _data: COLLECTION }], ['maplibre', { _data: { geojson: COLLECTION } }]]) {
  const ids = selectedPinIds(mapWith(src), {
    sourceId: 'pins',
    expressions: [['==', ['get', 'languageFamily'], 'Afro-Asiatic']],
  })
  eq(`${label}: selectedPinIds narrows to the matching pins`, [...ids].sort().join(','), 'a,c')
  const all = selectedPinIds(mapWith(src), { sourceId: 'pins', expressions: [] })
  eq(`${label}: no expressions means every pin, not none`, all.size, 3)
}
eq('expressions are ANDed', matchesExpression(['all', ['==', ['get', 'uniqueId'], 'a'], ['==', ['get', 'languageFamily'], 'Indo-European']], FEATURES[0].properties), false)

// ── PACKETSEL: the prayer count is LIVE, so the packet must read feature-state ──────────────────
// RQ3(b): the packet's "Has Prayer" selection showed 50 of 997 where the legend row said 699.
// The legend is right. Polling writes each pin's current count with setFeatureState() and
// prayer-progress.js:94 colours from ['feature-state','peoplePraying']; the GeoJSON property is
// whatever was true at page load. Reading the property selects the wrong people to pray for, which is
// the one thing this packet exists to get right.
const HAS_PRAYER = ['>', ['to-number', ['feature-state', 'peoplePraying'], 0], 0]
// 'a' has prayer only in the live state, 'b' only in the stale property, 'c' in neither.
const PRAY_FEATURES = [
  { type: 'Feature', properties: { uniqueId: 'a', peoplePraying: 0 }, geometry: { type: 'Point', coordinates: [1, 1] } },
  { type: 'Feature', properties: { uniqueId: 'b', peoplePraying: 12 }, geometry: { type: 'Point', coordinates: [2, 2] } },
  { type: 'Feature', properties: { uniqueId: 'c', peoplePraying: 0 }, geometry: { type: 'Point', coordinates: [3, 3] } },
]
const STATE = { a: { peoplePraying: 7 } }
const prayMap = {
  getSource: (id) => (id === 'pins' ? { _data: { type: 'FeatureCollection', features: PRAY_FEATURES } } : null),
  getFeatureState: ({ id }) => STATE[id] || {},
}
eq('feature-state selects the LIVE prayer count, not the loaded one',
  [...selectedPinIds(prayMap, { sourceId: 'pins', expressions: [HAS_PRAYER] })].sort().join(','), 'a')
eq('the stale property alone does NOT select a pin',
  selectedPinIds(prayMap, { sourceId: 'pins', expressions: [HAS_PRAYER] }).has('b'), false)
// A map with no feature-state at all (no polling yet) must still select on the loaded property rather
// than collapsing to nothing — a packet printed before the first poll is thinner, never empty.
const noState = { getSource: prayMap.getSource }
eq('no getFeatureState -> property expression still works',
  [...selectedPinIds(noState, { sourceId: 'pins', expressions: [['>', ['to-number', ['get', 'peoplePraying'], 0], 0]] })].join(','), 'b')
eq('feature-state on a map that has none is undefined, not a throw',
  matchesExpression(HAS_PRAYER, PRAY_FEATURES[1].properties, undefined), false)
eq('a source that throws on getFeatureState degrades instead of aborting the print',
  selectedPinIds({ getSource: prayMap.getSource, getFeatureState: () => { throw new Error('no such source') } },
    { sourceId: 'pins', expressions: [HAS_PRAYER] }).size, 0)

if (fails.length) {
  console.error(`${TAG}: FAIL`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — both engine shapes read the same features, a remote source says so rather than looking empty, selectedPinIds agrees with the reader, and the prayer count is read LIVE from feature-state rather than frozen at load.`)
