#!/usr/bin/env bun
/**
 * check-poster-render-pinned — the map-sheet generator a browser loads at print time is the one this repo
 * pinned, and anything else is refused BEFORE it runs.
 *
 * The generator is served (assets/lib/poster-render.js) and imported at print time rather than bundled.
 * Code loaded that way executes on partner pages, so it is integrity-pinned like every embed: the bundle
 * carries its sha384 (library/packet/poster-render.integrity.js) and posterSheets runs it only on a match.
 *
 * Two-sided:
 *   · the pin equals the sha384 of the source AND of the served copy (a stale pin names the fix);
 *   · a TAMPERED copy is refused, and its code never executes (a planted side effect stays unset);
 *   · the GENUINE copy loads and draws a real sheet.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = new URL('..', import.meta.url).pathname
const pinOf = (t) => `sha384-${createHash('sha384').update(t, 'utf8').digest('base64')}`
let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++ }

const source = readFileSync(join(REPO, 'library/packet/poster-render.js'), 'utf8')
const served = readFileSync(join(REPO, 'public/dx-maps/assets/lib/poster-render.js'), 'utf8')
const { POSTER_RENDER_SHA384, NE_PLACES_SHA384, POSTER_RENDER_GLOBAL_SHA384 } = await import(join(REPO, 'library/packet/poster-render.integrity.js'))
const { globalVariant } = await import(join(REPO, 'library/scripts/posters/pin-poster-render.mjs'))
ok(POSTER_RENDER_SHA384 === pinOf(source),
  `the pin matches library/packet/poster-render.js${POSTER_RENDER_SHA384 === pinOf(source) ? '' : ' — run: node library/scripts/posters/pin-poster-render.mjs'}`)
ok(pinOf(served) === pinOf(source), 'the served copy (assets/lib/poster-render.js) is the pinned file')
const placesSrc = readFileSync(join(REPO, 'library/scripts/posters/data/ne-places.json'), 'utf8')
const placesServed = readFileSync(join(REPO, 'public/dx-maps/assets/boundaries/ne-places.json'), 'utf8')
ok(NE_PLACES_SHA384 === pinOf(placesSrc) && pinOf(placesServed) === pinOf(placesSrc),
  'the capitals-and-cities pin matches its source and the served copy (boundaries/ne-places.json)')

const { generateSheet, countryZone } = await import(join(REPO, 'library/packet/posterSheets.js'))
// region is REQUIRED, not decorative: countryZone colours the sheet from it, and omitting it made
// this gate render the fallback teal and log '[posterSheets] region undefined is not in
// POSTER_REGIONS' on every run. Chad is Africa in library/data/country-posters.json, so this pins
// the real hued path rather than the fallback -- which is the path that actually ships.
const zone = countryZone({ id: 'country-tcd', iso3: 'TCD', label: 'Chad', count: 1, region: 'Africa' })
// Probe pins spread across Chad, so the sheet's view holds real capitals and cities (one pin frames too
// small an area for any place to fall inside it, and the places check below would see nothing).
const pins = [[12.1, 15.0], [13.8, 20.8], [9.1, 18.4], [17.9, 19.1], [8.6, 16.1]]
  .map(([lat, lng], i) => ({ name: `Probe ${i + 1}`, lat, lng, slug: `probe-${i}`, country_code: 'TCD', population: 1000 }))

// TAMPERED: the pinned file plus one line that would run on import.
const tmp = mkdtempSync(join(tmpdir(), 'poster-pin-'))
try {
  mkdirSync(join(tmp, 'lib'), { recursive: true })
  writeFileSync(join(tmp, 'lib/poster-render.js'), `globalThis.__POSTER_TAMPERED_RAN__ = true;\n${source}`)
  let refused = null
  try { await generateSheet({ zone, pins, format: '3x3', seriesId: 'country', assetsBase: pathToFileURL(tmp).href }) }
  catch (e) { refused = String(e?.message || e) }
  ok(!!refused && /integrity/.test(refused), `a tampered generator is refused${refused ? ` ("${refused.slice(0, 70)}…")` : ' — IT WAS NOT'}`)
  ok(globalThis.__POSTER_TAMPERED_RAN__ !== true, 'and its code never executed')
} finally { rmSync(tmp, { recursive: true, force: true }) }

// GENUINE: the served copy loads and draws.
const adm0 = JSON.parse(readFileSync(join(REPO, 'public/dx-maps/assets/boundaries/world-adm0.geojson'), 'utf8'))
const html = await generateSheet({ zone, pins, format: '3x3', seriesId: 'country', adm0,
  assetsBase: pathToFileURL(join(REPO, 'public/dx-maps/assets')).href, date: '2026-09-29' })
ok(typeof html === 'string' && html.length > 10000 && /<svg\b/.test(html), `the pinned generator loads and draws a sheet (${html.length} bytes)`)

// THE PLACES TABLE, two-sided: a tampered table is NOT used (the sheet equals one drawn with no places),
// and the genuine one IS (its sheet differs) — so the check can see the places at all.
{
  const base = { zone, pins, format: '3x3', seriesId: 'country', adm0, date: '2026-09-29' }
  const none = await generateSheet({ ...base, assetsBase: pathToFileURL(join(REPO, 'public/dx-maps/assets')).href, nePlaces: [] })
  const tmp2 = mkdtempSync(join(tmpdir(), 'places-pin-'))
  try {
    mkdirSync(join(tmp2, 'lib'), { recursive: true }); mkdirSync(join(tmp2, 'boundaries'), { recursive: true })
    writeFileSync(join(tmp2, 'lib/poster-render.js'), source)
    const doctored = JSON.parse(placesSrc); doctored.places = doctored.places.map((q) => ({ ...q, name: 'Forged' }))
    writeFileSync(join(tmp2, 'boundaries/ne-places.json'), JSON.stringify(doctored))
    const tampered = await generateSheet({ ...base, assetsBase: pathToFileURL(tmp2).href })
    ok(tampered === none && !tampered.includes('Forged'), 'a tampered capitals-and-cities table is not used — the sheet draws no city dots')
  } finally { rmSync(tmp2, { recursive: true, force: true }) }
  ok(html !== none, 'the genuine table IS used (its sheet differs from one with no places)')
}

// THE CLASSIC-SCRIPT COPY (strict-CSP pages load it with <script integrity>): pinned, served as the tree
// writes it, and — run as a real classic script — the SAME generator: its sheet is byte-identical to the
// module's for the same inputs. (The <script> path itself needs a browser; that half is a browser check.)
{
  const classic = globalVariant(source)
  const servedClassic = readFileSync(join(REPO, 'public/dx-maps/assets/lib/poster-render.global.js'), 'utf8')
  ok(POSTER_RENDER_GLOBAL_SHA384 === pinOf(classic) && pinOf(servedClassic) === pinOf(classic),
    'the classic-script copy matches its pin and the served copy (lib/poster-render.global.js)')
  const sandbox = {}
  new Function('globalThis', classic)(sandbox)
  const mod = await import(join(REPO, 'library/packet/poster-render.js'))
  const series = { totalGroups: 1, totalLists: 1, index: 1 }
  const SERIES_DEF = JSON.parse(readFileSync(join(REPO, 'library/scripts/posters/series.json'), 'utf8')).country
  const { ISO3_NAME } = await import(join(REPO, 'library/data/iso3-name.js'))
  const make = (f) => f({ env: { FORMAT: '3x3', POSTER_DATE: '2026-09-29' }, SERIES_DEF, ISO3_NAME, adm0, series: { ...series } })
  const fc = { type: 'FeatureCollection', features: [] }
  const a = (await make(sandbox.DoxaPosterRender.createPosterGenerator).renderPoster(zone, pins, fc)).html
  const b = (await make(mod.createPosterGenerator).renderPoster(zone, pins, fc)).html
  ok(a === b && a.length > 10000, `run as a classic script it draws the module's sheet byte for byte (${a.length} bytes)`)
}

// THE PACKET TEXT (library/packet/packetStrings.js), served at lib/packet-strings.json and pinned. Two-sided:
// the GENUINE served copy loads every language, and a TAMPERED one is refused — the print falls back to the
// bundled English block, so the forged text never reaches a print document.
{
  const { PACKET_STRINGS_SHA384 } = await import(join(REPO, 'library/packet/poster-render.integrity.js'))
  const stringsSrc = readFileSync(join(REPO, 'library/scripts/posters/packet-strings.json'), 'utf8')
  const servedStrings = join(REPO, 'public/dx-maps/assets/lib/packet-strings.json')
  ok(PACKET_STRINGS_SHA384 === pinOf(stringsSrc),
    `the packet-strings pin matches its source${PACKET_STRINGS_SHA384 === pinOf(stringsSrc) ? '' : ' — run: node library/scripts/posters/pin-poster-render.mjs'}`)
  ok(existsSync(servedStrings) && pinOf(readFileSync(servedStrings, 'utf8')) === pinOf(stringsSrc),
    'the served copy (assets/lib/packet-strings.json) is the pinned file')
  const { loadPacketStrings } = await import(join(REPO, 'library/packet/packetStrings.js'))
  const genuine = await loadPacketStrings(pathToFileURL(join(REPO, 'public/dx-maps/assets')).href)
  const langs = Object.keys(genuine).filter((k) => k !== '_meta')
  ok(langs.length === 11 && genuine.zh?.zone_affinity_A017 === JSON.parse(stringsSrc).zh.zone_affinity_A017,
    `the genuine served copy loads all ${langs.length} languages`)
  const tmp3 = mkdtempSync(join(tmpdir(), 'strings-pin-'))
  const warn = console.warn; console.warn = () => {}
  try {
    mkdirSync(join(tmp3, 'lib'), { recursive: true })
    const forged = JSON.parse(stringsSrc); forged.zh.zone_affinity_A017 = 'FORGED'
    writeFileSync(join(tmp3, 'lib/packet-strings.json'), JSON.stringify(forged, null, 2) + '\n')
    const tampered = await loadPacketStrings(pathToFileURL(tmp3).href)
    ok(!JSON.stringify(tampered).includes('FORGED') && Object.keys(tampered).join() === 'en'
      && tampered.en.zone_affinity_A017 === JSON.parse(stringsSrc).en.zone_affinity_A017,
      'a tampered packet-strings table is refused — the print falls back to the bundled English block')
    const absent = await loadPacketStrings(pathToFileURL(join(tmp3, 'nowhere')).href)
    ok(Object.keys(absent).join() === 'en', 'an unserved table falls back to English rather than failing the print')
  } finally { console.warn = warn; rmSync(tmp3, { recursive: true, force: true }) }
}

if (fails) { console.log(`POSTER-RENDER-PINNED: FAIL (${fails})`); process.exit(1) }
console.log('POSTER-RENDER-PINNED: PASS — the served generator and places table are the pinned ones, a tampered generator is refused unrun, a tampered table is not used, and the genuine copies draw')
