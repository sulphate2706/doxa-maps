// countries-meta.js — a PORT of DX-life's config/countries-meta.ts (326 lines), the rollup
// source of truth behind /regions, /regions/<region> and /regions/<country>.
//
// WHY IT IS HERE AND NOT IN THE PLUGIN FOLDER: two named consumers already had their own
// copy of this grouping logic — plugin-designs/regions-dashboard/regions-list.vue (tab 1)
// and .../region-dashboards.vue (tab 2). Two copies of a rollup is two chances for the
// region page and the dashboard to disagree about the same number, which is exactly the
// failure this file's own header warns about on their side ("the region totals, the
// per-country rows and the map's in-region pins all agree").
//
// WHAT CHANGED IN THE PORT, and nothing else:
//   * TypeScript -> JavaScript. The interfaces become JSDoc; no logic was rewritten.
//   * `import { COUNTRIES } from '../app/utils/countries'` becomes library/data/countries.json,
//     which is their same 242-entry {value,label} array in their order.
// Everything else — slugify's replace chain, FULL_PRAYER_COVERAGE_COUNT, addToStats's
// conditions, fitView's WORLD_DIM/VIEW_W/VIEW_H/MAX_ZOOM/MIN_ZOOM/NEIGHBOUR_PADDING,
// lngExtent's largest-gap walk, WORLD_VIEW, and both sort orders — is theirs verbatim.
//
// THE TWO THINGS THE OLD COPIES GOT WRONG, both fixed by porting rather than patching:
//   1. They slugged a country from `g.name`, the LOCALIZED label off the API. Theirs slugs
//      from the canonical ENGLISH name (ENGLISH_NAME_BY_CODE), deliberately: their comment
//      says "a French page is still /fr/regions/india, not /fr/regions/inde". Since our
//      dashboard writes the slug into the URL hash, the old behaviour made a deep link
//      locale-dependent and so different from theirs.
//   2. They dropped center/zoom/bounds entirely ("minus the map bounds/zoom"), so our maps
//      derived their own frame. Theirs computes a fit view per country AND per region.

import COUNTRIES from '../data/countries.json'

/** Fields requested from the prayer API's people-groups list for these summaries. */
export const PEOPLE_GROUP_LIST_FIELDS = 'country_code,wagf_region,latitude,longitude,population,adopted_by_churches,people_committed,engagement_status'

/** A people group counts as fully covered once this many people commit to daily prayer. */
export const FULL_PRAYER_COVERAGE_COUNT = 100

/**
 * @typedef {Object} PeopleGroupLite
 * @property {{value:string,label:string}|null} [country_code]
 * @property {{value:string,label:string}|null} [wagf_region]
 * @property {string|number|null} [latitude]
 * @property {string|number|null} [longitude]
 * @property {string|number|null} [population]
 * @property {number|null} [adopted_by_churches]
 * @property {string|number|null} [people_committed]
 * @property {{value:string,label:string}|null} [engagement_status]
 */

/**
 * Map bounds [[west, south], [east, north]] framing a set of pins. East may exceed 180 when
 * the box crosses the antimeridian (e.g. Oceania), which Mapbox accepts as a continuous
 * longitude range.
 * @typedef {[[number,number],[number,number]]} MapBounds
 */

/**
 * Progress figures shared by country and region summaries: count (people groups), population,
 * adopted (by >=1 church), engaged (engagement_status 'engaged'), withPrayer (>=1 committed),
 * withFullPrayer (>=FULL_PRAYER_COVERAGE_COUNT), peopleCommitted (the total).
 * @typedef {{count:number,population:number,adopted:number,engaged:number,withPrayer:number,withFullPrayer:number,peopleCommitted:number}} ProgressStats
 */

// ISO-3 -> canonical English name, the basis for slugs. Sourced from the same country list
// the rest of the app uses so slugs stay consistent and locale-independent (a French page is
// still /fr/regions/india, not /fr/regions/inde).
const ENGLISH_NAME_BY_CODE = new Map(COUNTRIES.map(c => [c.value, c.label]))

export function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/['’.]/g, '') // drop apostrophes / periods (Côte d'Ivoire -> cote-divoire)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics -> single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
}

// Slug for a country code. Prefers the canonical English name; falls back to a provided
// label (and finally the raw code) for any code not in the master list.
export function countrySlug(code, fallbackLabel) {
  return slugify(ENGLISH_NAME_BY_CODE.get(code) || fallbackLabel || code)
}

// Slug for a WAGF region. Derived from the stable value rather than the localized label so
// every locale shares one URL (e.g. "middle_east" -> "middle-east"). No region -> "other".
export function regionSlug(value) {
  return slugify(value) || 'other'
}

// EXPORTED BEYOND THEIR SURFACE — the only two, and why. Theirs keeps toNumber and
// emptyStats module-private because their pages never need a cross-region total: DX-life has
// no "all regions" view. Ours does, because the no-selection chooser is one of the two
// sanctioned additions, and it needs a zero accumulator (emptyStats) to roll every region up
// and a coordinate parser (toNumber) for the map's points array. Nothing else is added, and
// no logic differs.
export function toNumber(value) {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0)
  return Number.isNaN(n) ? 0 : n
}

export function emptyStats() {
  return { count: 0, population: 0, adopted: 0, engaged: 0, withPrayer: 0, withFullPrayer: 0, peopleCommitted: 0 }
}

function addToStats(stats, p) {
  const committed = toNumber(p.people_committed)
  stats.count++
  stats.population += toNumber(p.population)
  if ((p.adopted_by_churches ?? 0) > 0) stats.adopted++
  if (p.engagement_status?.value === 'engaged') stats.engaged++
  if (committed > 0) stats.withPrayer++
  if (committed >= FULL_PRAYER_COVERAGE_COUNT) stats.withFullPrayer++
  stats.peopleCommitted += committed
}

function addPin(bounds, p) {
  const lat = typeof p.latitude === 'string' ? parseFloat(p.latitude) : p.latitude
  const lng = typeof p.longitude === 'string' ? parseFloat(p.longitude) : p.longitude
  if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    bounds.lats.push(lat)
    bounds.lngs.push(lng)
  }
}

function round(n) {
  return Math.round(n * 100) / 100
}

// Web-Mercator latitude in radians, used by the fit-bounds zoom math.
function latRad(lat) {
  const s = Math.sin((lat * Math.PI) / 180)
  return Math.log((1 + s) / (1 - s)) / 2
}

// Compute a map center + zoom that frames the given bounding box. Zooms out slightly beyond
// a tight fit so surrounding countries remain in view (the whole point of the country page's
// map). The viewport dimensions are an approximation of the map slot; exact framing isn't
// important because the map keeps its own pan/zoom controls.
function fitView(minLng, minLat, maxLng, maxLat) {
  const WORLD_DIM = 512
  const VIEW_W = 1000
  const VIEW_H = 560
  const MAX_ZOOM = 6
  const MIN_ZOOM = 1.6
  const NEIGHBOUR_PADDING = 0.6 // zoom out this much so neighbours stay visible

  const latFraction = Math.max((latRad(maxLat) - latRad(minLat)) / Math.PI, 1e-6)
  let lngDiff = maxLng - minLng
  if (lngDiff < 0) lngDiff += 360
  const lngFraction = Math.max(lngDiff / 360, 1e-6)

  const latZoom = Math.log2(VIEW_H / WORLD_DIM / latFraction)
  const lngZoom = Math.log2(VIEW_W / WORLD_DIM / lngFraction)

  let zoom = Math.min(latZoom, lngZoom, MAX_ZOOM) - NEIGHBOUR_PADDING
  zoom = Math.max(MIN_ZOOM, Math.min(zoom, MAX_ZOOM))

  return {
    center: [round((minLng + maxLng) / 2), round((minLat + maxLat) / 2)],
    zoom: round(zoom),
  }
}

// Longitude extent covering all pins along the shortest arc: sorts the longitudes, finds the
// largest gap between neighbours (including the wrap-around gap past 180), and spans
// everything else. When the extent crosses the antimeridian the east edge exceeds 180 so the
// range stays continuous.
function lngExtent(lngs) {
  const sorted = [...lngs].sort((a, b) => a - b)
  const last = sorted.length - 1
  let gapStart = last
  let maxGap = sorted[0] + 360 - sorted[last]
  for (let i = 0; i < last; i++) {
    const gap = sorted[i + 1] - sorted[i]
    if (gap > maxGap) {
      maxGap = gap
      gapStart = i
    }
  }
  if (gapStart === last) return [sorted[0], sorted[last]]
  return [sorted[gapStart + 1], sorted[gapStart] + 360]
}

// Default whole-world view for a set of records with no coordinates.
const WORLD_VIEW = { center: [20, 10], zoom: 1.8, bounds: null }

function viewFor(pins) {
  if (pins.lats.length === 0) return WORLD_VIEW
  const [west, east] = lngExtent(pins.lngs)
  const south = Math.min(...pins.lats)
  const north = Math.max(...pins.lats)
  return { ...fitView(west, south, east, north), bounds: [[west, south], [east, north]] }
}

/**
 * Group people-group records into one summary per country, sorted by name.
 * @param {PeopleGroupLite[]} posts
 */
export function summarizeCountries(posts) {
  const groups = new Map()

  for (const p of posts) {
    const code = p.country_code?.value
    if (!code) continue

    let g = groups.get(code)
    if (!g) {
      g = { name: p.country_code.label, region: { value: '', label: '' }, pins: { lats: [], lngs: [] }, stats: emptyStats() }
      groups.set(code, g)
    }
    // A few records carry no region; the country takes the first region seen.
    if (!g.region.value && p.wagf_region?.value) g.region = p.wagf_region
    addToStats(g.stats, p)
    addPin(g.pins, p)
  }

  const out = []
  for (const [code, g] of groups) {
    const view = viewFor(g.pins)
    out.push({
      slug: countrySlug(code, g.name),
      code,
      name: g.name,
      region: g.region,
      center: view.center,
      zoom: view.zoom,
      bounds: view.bounds,
      ...g.stats,
    })
  }

  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * Group people-group records into one summary per WAGF region, sorted by label. Each people
 * group rolls up under its country's region, so the region totals, the per-country rows and
 * the map's in-region pins all agree.
 * @param {PeopleGroupLite[]} posts
 */
export function summarizeRegions(posts) {
  const countries = summarizeCountries(posts)
  const regionSlugByCountry = new Map(countries.map(c => [c.code, regionSlug(c.region.value)]))

  const groups = new Map()

  for (const c of countries) {
    const slug = regionSlugByCountry.get(c.code)
    let g = groups.get(slug)
    if (!g) {
      g = { value: c.region.value, label: c.region.label, countries: [], pins: { lats: [], lngs: [] }, stats: emptyStats() }
      groups.set(slug, g)
    }
    g.countries.push(c)
  }

  for (const p of posts) {
    const code = p.country_code?.value
    if (!code) continue
    const g = groups.get(regionSlugByCountry.get(code))
    addToStats(g.stats, p)
    addPin(g.pins, p)
  }

  const out = []
  for (const [slug, g] of groups) {
    const view = viewFor(g.pins)
    out.push({
      slug,
      value: g.value,
      label: g.label,
      countryCount: g.countries.length,
      center: view.center,
      zoom: view.zoom,
      bounds: view.bounds,
      countries: g.countries,
      ...g.stats,
    })
  }

  out.sort((a, b) => a.label.localeCompare(b.label))
  return out
}
