#!/usr/bin/env node
/**
 * check-poster-attribution — the poster footer credits whoever actually served the tiles.
 *
 * The footer is a LICENCE statement, so it has to be true rather than merely present.
 * posterDefaults ships '© Mapbox © OpenStreetMap'; under the fleet's MapLibre default Mapbox serves
 * nothing, OpenFreeMap serves everything, and any poster carrying the default credited a company
 * with no involvement while omitting the three parties whose licences apply.
 *
 * ★ THE FIXTURE IS THE REAL THING, and it is the reason this check exists in this shape. Fetched
 * 2026-09-28: tiles.openfreemap.org/styles/liberty declares two sources and NEITHER has an
 * `attribution` field, so reading the style alone returns nothing. The credit lives in the TileJSON
 * at tiles.openfreemap.org/planet, as HTML with anchors and a &copy; entity, which the engine merges
 * into the SOURCE object after it loads. A check written against a tidy invented style would have
 * passed while the real map printed the wrong credit.
 *
 * Headless, no network, no browser, no dependencies. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { attributionTextFromMap, attributionToText } = await import(resolve(ROOT, 'library/maps/map-attribution.js'))

const fails = []
const eq = (what, got, want) => { if (got !== want) fails.push(`${what}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
const ok = (what, cond, detail) => { if (!cond) fails.push(what + (detail ? `\n      ${detail}` : '')) }

// The exact string tiles.openfreemap.org/planet returns.
const OFM_TILEJSON_HTML =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
const OFM_TEXT = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap'

const fakeMap = ({ sources, live }) => ({
  getStyle: () => ({ sources }),
  getSource: (id) => (live && Object.prototype.hasOwnProperty.call(live, id) ? live[id] : undefined),
})

// 1. the real shape: style declares nothing, the loaded source carries the TileJSON credit
{
  const map = fakeMap({
    sources: { ne2_shaded: { type: 'raster' }, openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    live: { ne2_shaded: {}, openmaptiles: { attribution: OFM_TILEJSON_HTML } },
  })
  eq('the OpenFreeMap credit is read from the LOADED source, not the style', attributionTextFromMap(map), OFM_TEXT)
  ok('and it no longer says Mapbox', !attributionTextFromMap(map).includes('Mapbox'))
}

// 2. a Mapbox map still credits Mapbox — this must not become "always OpenFreeMap"
{
  const map = fakeMap({
    sources: { composite: { type: 'vector' } },
    live: { composite: { attribution: '<a href="https://www.mapbox.com/about/maps/">© Mapbox</a> <a href="http://www.openstreetmap.org/copyright">© OpenStreetMap</a>' } },
  })
  eq('a Mapbox-served map credits Mapbox', attributionTextFromMap(map), '© Mapbox © OpenStreetMap')
}

// 3. a style that DOES declare attribution is honoured (the source is preferred, not required)
{
  const map = fakeMap({ sources: { s: { type: 'raster', attribution: 'Tiles by Someone' } }, live: {} })
  eq('a style-declared attribution is used when there is no live source', attributionTextFromMap(map), 'Tiles by Someone')
}
{
  const map = fakeMap({
    sources: { s: { type: 'raster', attribution: 'the stale request' } },
    live: { s: { attribution: 'what actually came back' } },
  })
  eq('the LOADED source wins over the style declaration', attributionTextFromMap(map), 'what actually came back')
}

// 4. repeated credits collapse; several distinct ones all survive
{
  const map = fakeMap({
    sources: { a: {}, b: {}, c: {} },
    live: { a: { attribution: '© OpenStreetMap' }, b: { attribution: '© OpenStreetMap' }, c: { attribution: 'geoBoundaries' } },
  })
  eq('the same credit twice is printed once', attributionTextFromMap(map), '© OpenStreetMap geoBoundaries')
}

// 5. it must never invent, and never throw — an empty answer hands the caller back its fallback
{
  eq('no map -> empty', attributionTextFromMap(null), '')
  eq('a map with no getStyle -> empty', attributionTextFromMap({}), '')
  eq('sources with no attribution -> empty', attributionTextFromMap(fakeMap({ sources: { a: {} }, live: { a: {} } })), '')
  const throwing = { getStyle: () => { throw new Error('style not loaded') } }
  eq('getStyle throwing before load -> empty, not a crash', attributionTextFromMap(throwing), '')
  const badSource = { getStyle: () => ({ sources: { a: {} } }), getSource: () => { throw new Error('nope') } }
  eq('getSource throwing -> empty, not a crash', attributionTextFromMap(badSource), '')
}

// 6. flattening: a footer is text, and entities must not print raw
{
  eq('anchors are removed', attributionToText('<a href="x">© OpenStreetMap</a>'), '© OpenStreetMap')
  eq('&copy; becomes ©', attributionToText('&copy; OpenMapTiles'), '© OpenMapTiles')
  eq('whitespace collapses', attributionToText('  a   \n  b '), 'a b')
  ok('no markup survives', !/[<>]/.test(attributionToText(OFM_TILEJSON_HTML)))
  ok('no undecoded entity survives', !/&[a-z]+;/i.test(attributionToText(OFM_TILEJSON_HTML)))
}

// 7. the renderer must actually consult it, and must keep the spec's value as a fallback.
{
  const SRC = readFileSync(resolve(ROOT, 'library/composables/poster/useMapPoster.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('the renderer imports the helper', /import\s*\{[^}]*attributionTextFromMap[^}]*\}\s*from/.test(SRC))
  ok('and calls it with the live source map', /attributionTextFromMap\s*\(\s*sourceMap\s*\)/.test(SRC))
  // The spread `...(spec.slots?.footer || {})` contains a brace, so a [^}] class stops short of the
  // property it is looking for and reports the opposite of the truth.
  ok('the derived credit reaches the footer slot', /footer\s*:\s*\{[\s\S]{0,160}?attribution\s*:\s*credit/.test(SRC))
  ok('an empty credit falls back to the spec rather than printing nothing',
    /credit\s*\?[\s\S]{0,240}?:\s*spec/.test(SRC),
    'a licence footer may never be blank')
}

if (fails.length) {
  console.error('POSTER-ATTRIBUTION: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('POSTER-ATTRIBUTION: PASS — the credit is read from the LOADED source (where the TileJSON lands) rather than the style or a constant, HTML and entities are flattened for print, duplicates collapse, a Mapbox map still says Mapbox, and an unreadable map falls back instead of printing a blank licence line.')
