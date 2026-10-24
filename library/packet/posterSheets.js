/**
 * posterSheets.js — generate a map sheet IN THE BROWSER, at the moment it is asked for.
 *
 * The print standard's rule (2026-09-29): exports are generated, not stored; only true previews
 * are stored. The map sheet — a poster, or the map-only sheet on a packet's page 1 — used to exist only
 * if the Node generator had written it ahead of time. poster-render.js is that generator as a pure
 * factory; this module is its browser feed: it loads the series definitions and fetches the Natural Earth
 * places and boundaries from the served tree at the first print, and draws.
 *
 * What only the HOST knows, it passes: the zone, its pins, its geometry (a FeatureCollection — the same
 * resolveZoneGeometry output generate.mjs feeds), the ISO3 -> English name table the labels are drawn
 * from, and the series facts ("map 3 of 28"). A packet in another language relabels the drawn names
 * with packet-render's liftMap, exactly as it does for a stored sheet.
 *
 *   const html = await generateSheet({ zone, pins, zoneFC, format: 'packet', seriesId: 'upg100',
 *                                     ISO3_NAME, series: { totalGroups, totalLists, index } })
 */
import { POSTER_RENDER_SHA384, NE_PLACES_SHA384, POSTER_RENDER_GLOBAL_SHA384 } from './poster-render.integrity.js'
import { fetchPinned } from './sha384.js'

// ★ THE GENERATOR IS SERVED, NOT BUNDLED, AND IT IS INTEGRITY-PINNED. poster-render.js is served verbatim
// at <assets>/lib/poster-render.js (generate-tree) and loaded at the FIRST print: a single-file build
// inlines any import, so bundling it put ~65 KB into every map that can print a sheet (country-posters
// crossed the 1.5 MB ceiling). Code fetched at print time EXECUTES on partner pages, so it is pinned like
// every embed: its sha384 is baked into this bundle (poster-render.integrity.js), the text is fetched and
// hashed, and only a match is run — imported from a blob: URL of the VERIFIED text, never from the network
// URL a second time. A mismatch refuses to run and says so; the print falls back to what it can do without.
//
// ★ THE PAGE BASE IS CAPTURED WHEN THIS MODULE EVALUATES, not at print time: a single-page host that
// changes its URL between load and click would otherwise resolve the asset base against the wrong page,
// and a relative dynamic import would resolve against the BUNDLE's location instead of the page's.
const PAGE_BASE = globalThis.document?.baseURI || undefined
const abs = (u) => new URL(u, PAGE_BASE).href
// The classic-script path: the browser checks POSTER_RENDER_GLOBAL_SHA384 itself and refuses to run a
// file that does not match (onerror), so nothing unverified executes here either.
// A refused tag is tried ONCE more after a fetch with cache: 'reload' has refreshed the HTTP cache: a stale cached
// copy after a re-pin fails the browser's own check, exactly as it fails fetchPinned's (sha384.js says why).
function loadClassic(url) {
  if (globalThis.DoxaPosterRender?.createPosterGenerator) return Promise.resolve(globalThis.DoxaPosterRender.createPosterGenerator)
  const tag = () => new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = url
    el.integrity = POSTER_RENDER_GLOBAL_SHA384
    el.crossOrigin = 'anonymous'
    el.async = true
    el.onload = () => (globalThis.DoxaPosterRender?.createPosterGenerator
      ? resolve(globalThis.DoxaPosterRender.createPosterGenerator)
      : reject(new Error(`the sheet generator at ${url} loaded but did not define DoxaPosterRender`)))
    el.onerror = () => { el.remove(); reject(new Error(`the sheet generator at ${url} was refused (integrity or network) — not running it`)) }
    document.head.appendChild(el)
  })
  return tag().catch(async (first) => {
    try { await fetch(url, { cache: 'reload' }) } catch { throw first }
    return tag()
  })
}
const generatorCache = new Map()
function loadGenerator(assetsBase) {
  if (!assetsBase) return Promise.reject(new Error('no asset base to load the sheet generator from'))
  const url = abs(`${assetsBase}/lib/poster-render.js`)
  if (!generatorCache.has(url)) {
    const p = (async () => {
      // force-cache, and once more fresh on a mismatch (sha384.js fetchPinned says why); only a match runs.
      let text
      try { text = await fetchPinned(url, POSTER_RENDER_SHA384) }
      catch (e) { throw new Error(`the sheet generator at ${url} ${e?.message || e} — refusing to run it`) }
      const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
      try { return (await import(/* @vite-ignore */ blobUrl)).createPosterGenerator }
      catch (e) {
        // A page whose Content-Security-Policy forbids blob: scripts refuses the import of the VERIFIED text.
        // There, load the classic-script copy with <script integrity>, and the browser verifies it natively.
        // (An integrity FAILURE above never reaches here: it threw before any import was tried.)
        if (!globalThis.document?.createElement) throw e
        return loadClassic(abs(`${assetsBase}/lib/poster-render.global.js`))
      }
      finally { URL.revokeObjectURL(blobUrl) }
    })()
    p.catch(() => generatorCache.delete(url))
    generatorCache.set(url, p)
  }
  return generatorCache.get(url)
}

let shared = null
function loadShared() {
  shared ||= import('../scripts/posters/series.json').then((m) => ({ seriesAll: m.default || m }))
  shared.catch(() => { shared = null })
  return shared
}
// The Natural Earth capitals and cities, FETCHED at print time from the served tree (boundaries/
// ne-places.json) rather than bundled: 170 KB that only a reader who prints should pay for. Without an
// asset base, or on any failure, the sheet draws no city dots — the generator's own rule for absent data.
// PINNED like the generator (NE_PLACES_SHA384): the text is hashed before it is parsed, and a table that is
// not the pinned one is not used — the sheet then draws no city dots and says so in the console, rather
// than plotting capitals it cannot vouch for.
const placesCache = new Map()
function loadPlaces(assetsBase) {
  if (!assetsBase) return Promise.resolve([])
  const url = abs(`${assetsBase}/boundaries/ne-places.json`)
  if (!placesCache.has(url)) {
    const p = (async () => {
      let text
      try { text = await fetchPinned(url, NE_PLACES_SHA384) }
      catch (e) {
        if (!e?.integrity) throw e      // not served, or offline: a later print tries again (below)
        console.warn(`[posterSheets] ${url} failed its integrity check, also when fetched fresh — drawing no city dots`)
        return []
      }
      return JSON.parse(text).places || []
    })()
    // Wrong bytes stay refused for the session; a transient failure is forgotten, as in the other loaders.
    placesCache.set(url, p.catch(() => { placesCache.delete(url); return [] }))
  }
  return placesCache.get(url)
}

/**
 * @returns {Promise<string>} the sheet's full HTML document ('' when the zone cannot be drawn).
 *   format   '3x4' | '3x3' | 'letter' | 'packet' (map-only, for a packet's page 1)
 *   sparse   the poster's thumbnail layout (default: every format but 'packet'); false asks for the FULL
 *            poster — the facts, the two explainers and the networks — in any format
 *   seriesId a key of series.json ('upg100', 'country'); decides the poster's text and networks
 *   date     the stamp printed on the sheet (default today) — pass one to reproduce a sheet exactly
 */
export async function generateSheet({
  zone, pins = [], zoneFC = null, format = '3x4', seriesId = 'upg100', ISO3_NAME = {},
  adm0 = null, adm1Ind = null, adm1Chn = null, series = { totalGroups: 0, totalLists: 0, index: 1 }, date = null,
  assetsBase = null, nePlaces = null, sparse = format !== 'packet',
} = {}) {
  if (!zone || !zone.zoneKey) return ''
  const [{ seriesAll }, places, createPosterGenerator] = await Promise.all([
    loadShared(), nePlaces ? Promise.resolve(nePlaces) : loadPlaces(assetsBase), loadGenerator(assetsBase),
  ])
  const SERIES_DEF = seriesAll[seriesId] || seriesAll.upg100
  // ONE GENERATOR PER CALL. The factory's setup is cheap, and caching it by format (as this first did)
  // pinned the FIRST caller's data — its boundaries, its name table — onto every later sheet: a caller
  // without adm0 poisoned the cache for one with it. The inputs are the caller's, every time.
  const gen = createPosterGenerator({
    // ★ SPARSE FOR POSTERS, NEVER FOR THE PACKET -- exactly the split the two build scripts make.
    // `posters` generates with SPARSE=1 (the "thumbnail-worthy" layout: the bold facts row with the
    // UPG count and population set large, a bigger map, and the two vision columns dropped), and
    // `packets` does not. This env used to carry FORMAT and POSTER_DATE only, so EVERY sheet drawn
    // at the click -- UPG-100 and country alike -- fell back to the small facts table, while the
    // stored UPG-100 thumbnails showed the bold row. A reader saw one header on the card and got
    // another on the print. 'packet' is the one packet format (FORMATS: 3x4, 3x3, letter, packet),
    // so it alone keeps the full layout its packet pages were designed around.
    // `sparse` defaults to exactly that split; a caller may ask for the full poster in a poster format (the
    // UPG-100 packet's page 1 is its full letter poster).
    env: { FORMAT: format, ...(sparse ? { SPARSE: '1' } : {}), ...(date ? { POSTER_DATE: date } : {}) },
    SERIES_DEF, ISO3_NAME, adm0, adm1Ind, adm1Chn, nePlaces: places, series: { totalGroups: 0, totalLists: 0, index: 1, ...series },
  })
  const fc = zoneFC || { type: 'FeatureCollection', features: [] }
  const out = await gen.renderPoster(zone, pins, fc)
  return (out && out.html) || ''
}

// ── COUNTRIES ───────────────────────────────────────────────────────────────
// The world boundaries the Node generator reads (data/adm0/world-adm0.geojson) ship in the served tree
// as boundaries/world-adm0.geojson — the same file — so a sheet drawn here uses the same outlines.
// Fetched once per base, at the first print, never at page load.
const jsonCache = new Map()
function getJSON(url) {
  if (!jsonCache.has(url)) {
    const p = fetch(abs(url), { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${url.split('/').pop()} not found (${r.status})`)
      return r.json()
    })
    p.catch(() => jsonCache.delete(url))
    jsonCache.set(url, p)
  }
  return jsonCache.get(url)
}
export function loadAdm0(assetsBase) { return getJSON(`${assetsBase}/boundaries/world-adm0.geojson`) }
// The FULL-resolution set generate.mjs draws from (the map shows the lighter -web files; print does not):
// world ADM0, and the India and China ADM1 the Asia zones are made of. Same files, same bytes.
export async function loadBoundaries(assetsBase) {
  const [adm0, adm1Ind, adm1Chn] = await Promise.all([
    loadAdm0(assetsBase),
    getJSON(`${assetsBase}/boundaries/gb-IND-ADM1.geojson`),
    getJSON(`${assetsBase}/boundaries/gb-CHN-ADM1.geojson`),
  ])
  return { adm0, adm1Ind, adm1Chn }
}

// The zone generate.mjs builds in COUNTRY mode, and its geometry exactly as resolveZoneGeometry resolves
// a country zone: the country's own ADM0 polygon(s), stamped with the zone — present only when the
// country has groups (memberCountryCodes is empty otherwise).
// ★ ONE COUNTRY, ONE REGION HUE -- AND IT LIVES HERE BECAUSE BOTH PATHS MUST AGREE.
// Every country poster used to carry the same hardcoded teal while each 100-list sheet carried its
// own hue, which is the whole of the reported styling difference: a country sheet and a 100-list
// sheet render through the SAME 253-line <style> block in poster-render.js and their stylesheets
// are byte-identical except this one custom property. --zc drives the zone fill, the pin fill and
// the pin-number background, the three most visible things on a sheet.
//
// ⚠ IT MUST BE DEFINED ONCE, FOR THE BROWSER AND THE NODE GENERATOR BOTH. Putting the rule in
// generate.mjs alone broke check:poster-browser-equiv by exactly 26 bytes on country-npl -- the
// length of 'hsl(45, 72%, 56%)' over '#2bb', twice, because --zc is emitted at two places. The
// browser generates these sheets at click time from THIS module, so a rule the Node driver knows
// and the browser does not is two different posters for the same country. generate.mjs imports
// this; it does not keep a copy.
//
// The formula mirrors leafColor in the 100-list's legend-tree.js: an even hue spread at 72%/56%,
// comma-HSL because Mapbox paint expressions reject the slash syntax. It is restated rather than
// imported because library/ must not depend on plugin-designs/ -- the dependency runs the other
// way. If that rule changes there, change it here in the same commit.
//
// BY REGION, NOT BY COUNTRY INDEX: 173 countries over 360 degrees is ~2 degrees apart --
// indistinguishable, and meaningless on a poster seen alone with no sibling to be told apart from.
// A region is a grouping the reader already has, so Sudan and Chad reading as related is true.
//
// DECLARED, NOT DERIVED FROM WHATEVER A RUN HAPPENS TO CONTAIN: indexing into the regions present
// in one run would give a country one hue in a single-sheet render and another in a full build, so
// re-rendering would change the colour of a poster somebody had already printed. APPEND a new
// region; never reorder, which would change the hue of every region after the insertion.
export const POSTER_REGIONS = [
  'Africa',
  'Asia',
  'Europe',
  'Latin America & Caribbean',
  'Middle East',
  'North America & Non-Spanish Caribbean',
  'Oceania',
  'Other',
]

const COUNTRY_FALLBACK_COLOR = '#2bb'
// Once per region, not once per poster: an unlisted region covers every country in it, and a line
// per sheet would bury the one fact worth reading in a full 173-sheet build.
const warnedRegions = new Set()

/**
 * The hue for a country poster, from its region. An unrecognised region keeps the old teal rather
 * than being folded into 'Other': folding would silently give two regions the same hue and hide
 * that the list needs a line. It says so once, because a silent fallback is how one flat teal
 * survived on all 173 sheets in the first place.
 */
export function countryRegionColor(region) {
  const i = POSTER_REGIONS.indexOf(region)
  if (i < 0) {
    if (!warnedRegions.has(region)) {
      warnedRegions.add(region)
      console.warn(`[posterSheets] region ${JSON.stringify(region)} is not in POSTER_REGIONS, so its `
        + 'posters keep the old flat teal. APPEND it to that list — never reorder, which would change '
        + 'the hue of every region after the insertion.')
    }
    return COUNTRY_FALLBACK_COLOR
  }
  return `hsl(${Math.round((i * 360) / POSTER_REGIONS.length)}, 72%, 56%)`
}

export function countryZone({ id, iso3, label, count, region, adminAreas }) {
  return {
    id, zoneKey: id, label, count, color: countryRegionColor(region), adm0: [iso3], selector: { type: 'country_codes', values: [iso3] },
    // The facts row's "Administrative Areas" cell, when the caller knows it (India: "36 states and union territories");
    // without it the cell falls back to the country's name, as every country sheet has drawn it so far.
    ...(adminAreas ? { provinces: [adminAreas] } : {}),
  }
}
export function countryGeometry(zone, adm0, hasGroups) {
  const fc = { type: 'FeatureCollection', features: [] }
  if (!hasGroups || !adm0) return fc
  const want = new Set(zone.adm0 || [])
  for (const f of adm0.features || []) {
    if (!f.properties || !want.has(f.properties.iso3)) continue
    fc.features.push({ type: 'Feature', properties: { ...f.properties, zoneKey: zone.zoneKey, zoneColor: zone.color, zoneLabel: zone.label }, geometry: f.geometry })
  }
  return fc
}
// Records -> the generator's pins: every group with coordinates (the fields generate.mjs keeps).
export function pinsFrom(records) {
  const out = []
  for (const r of records || []) {
    const lat = Number(r.latitude), lng = Number(r.longitude)
    if (!isFinite(lat) || !isFinite(lng)) continue
    // image_url rides along for the large side-lane sheets, which put a real photo beside each name; every other
    // format ignores it, so their sheets are unchanged.
    out.push({ name: r.name || r.slug || '', lat, lng, slug: r.slug, country_code: r.country_code, population: r.population, image_url: r.image_url })
  }
  return out
}

/**
 * A country's sheet, generated now: its people groups (records, with coordinates) on its own outline.
 * @param country  { id, iso3, label, count } — one entry of library/data/country-posters.json
 */
export async function generateCountrySheet({ country, records, assetsBase, ISO3_NAME, format = 'letter', series, date = null }) {
  const zone = countryZone(country)
  // The FULL boundary set, as the Node driver passes it: a country beside India or China draws their
  // provinces too (outlines, names, sea-label land), and a sheet fed ADM0 alone differs from Node's.
  const { adm0, adm1Ind, adm1Chn } = await loadBoundaries(assetsBase)
  const zoneFC = countryGeometry(zone, adm0, (records || []).length > 0)
  return generateSheet({ zone, pins: pinsFrom(records), zoneFC, format, seriesId: 'country', ISO3_NAME, adm0, adm1Ind, adm1Chn, series, date, assetsBase })
}
