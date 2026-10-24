/**
 * countrySheet.js — a country's map sheet, GENERATED in the browser at the click.
 *
 * SHARED (@map/packet/countrySheet.js). Its callers are the regions dashboard's regions-list and the
 * Country Posters wall (country-poster-wall.vue), which used to define its own inline copy.
 *
 * ⚠ THE MOVE HERE WAS NEVER FINISHED, and it cost a real defect. This module's comment used to claim
 * two consumers -- the country-poster wall and <doxa-country-map> -- and a CENSUS of the tree found
 * it had NONE: nothing imported it at all. regions-list kept importing a byte-identical plugin-local
 * copy (src/country-sheet-print.js), and country-poster-wall.vue defines its own inline countrySheet
 * that calls generateCountrySheet directly. So this file was an ORPHAN wearing a comment that said
 * otherwise.
 * That mattered the moment the country poster's hue became data-driven: the region key was added
 * HERE, where nothing read it, while the copy regions-list actually imported went on building
 * `country` without a region -- so countryRegionColor(undefined) returned the old flat teal and
 * warned. The same country then printed HUED from Country Posters and TEAL from the Regions tab,
 * which is exactly the "two different posters for one country" the hue change exists to refuse.
 * The copy is deleted, and regions-list and the wall both import this (check:country-sheet-one-path
 * refuses a caller that draws a country sheet any other way). Do not re-copy it: a duplicate of this file is
 * indistinguishable from it until one of them is edited, and then it is a silent divergence.
 *
 * The print standard is generate, store only previews: no country sheet is shipped, and none should
 * be. MEASURED before this existed: data/posters holds 28 .html sheets and all 28 are ZONES, while
 * emit-countries.mjs writes only country-posters.json, whose `sheet` field is a PAPER SIZE ('3x3')
 * rather than a filename. So a packet's page-1 lift for a country asked for posters/country-<iso3>.html
 * and got a 404 for all 175 of them. This draws it instead.
 *
 * Same shape as my-upg-100-list's zone sheet (data/zone-sheet-print.js), deliberately, so the two
 * surfaces cannot draw the "same" sheet two ways:
 *
 *   const sheet = makeCountrySheet({ records, assetsBase: () => base })
 *   usePosterPrints({ …, sheet })               // (item, format) -> html
 *   <PosterWall :sheet="sheet" />
 *
 * The country case is simpler than the zone case: generateCountrySheet resolves the zone and its
 * geometry from the country entry itself, so there is no assignment step to keep in sync.
 */

/**
 * @param {object} o
 *   records     (selector) => Promise<rows[]>   the shared provider; this asks it for ONE country
 *   assetsBase  () => string                    where boundaries/ is served from
 * @returns {(item, format) => Promise<string>}  the sheet's HTML, or '' when it cannot be drawn
 */
/**
 * The sheet's SERIES facts, computed exactly as the Country Posters wall computes them
 * (country-poster-wall.vue): the tier is every country printed at the same sheet size, the total is
 * that tier's length, and the index is the country's position in it by id. So a country's printed
 * "map N of M" and "one of a ~M-map set" agree with the wall's print and with its own thumbnail.
 *
 * ★ WHY THIS EXISTS: without a series, generateCountrySheet falls back to totalLists 0, and every
 * Regions-tab print read "map 1 of 0" and "one of a 0-map set called the Country Maps" -- nonsense
 * on a printed poster, on the demo's showcase flow (Regions -> a country -> Poster Map). This was
 * not introduced by the one-definition change: the plugin-local copy regions-list used before it
 * passed no series either. The wall was never affected because it computes its own.
 *
 * Returns undefined when the item is not in the list (a host's country with no poster), so that row
 * keeps the renderer's own default rather than a fabricated position.
 *
 * A null sheet is a tier too: India (sheet null, too many groups for any paper size) is its own
 * 1-of-1 series. Skipping it gave India's sheet "map 1 of 0" on the Regions path and "map 1 of 1" on the
 * wall's old copy. Neither was visible then (the map-only packet page prints no series line, and India's
 * poster is gated), but any India sheet with a header would have shown it.
 * Every null-sheet country shares that ONE oversized series: a second would make India "map 1 of 2".
 * check:country-sheet-one-path fails when that happens, so it is decided, not drifted into.
 */
export function seriesFor(countries, item) {
  if (!item || !Array.isArray(countries)) return undefined
  const tier = countries.filter((x) => (x.sheet ?? null) === (item.sheet ?? null))
  const index = tier.findIndex((x) => x.id === item.id) + 1
  if (!index) return undefined
  return { totalGroups: tier.reduce((a, x) => a + (x.count || 0), 0), totalLists: tier.length, index }
}

/**
 * ★ COUNTRIES TOO LARGE FOR ANY PAPER SHEET print as ONE LARGE side-lane sheet instead (poster-render's 60x96 /
 * 66x66 / 36x60: every group named beside the map, crossing-free leaders). ONE source of truth for every caller (the
 * Country Posters wall, the Regions list), so one country never gets two answers. `desktopOnly`: its poster, list,
 * packet and cards are offered on a desktop or laptop only (a phone cannot draw a sheet that big).
 * The data (country-posters.json) still records why no PAPER sheet fits; this table is what prints instead.
 */
// India: 5 x 8 ft (60x96) ONLY, the size its whole-country layout is built and tuned for.
export const LARGE_SHEETS = { IND: { format: '60x96', formats: ['60x96'], desktopOnly: true } }
const largeOf = (item) => (item && LARGE_SHEETS[String(item.iso3 || '').toUpperCase()]) || null
/**
 * ★ WITHHELD: a whole-country poster that is NOT shipped yet, though the renderer can draw it. India's 855 groups do
 * not fit one poster legibly yet; a solution is in progress. Everywhere a reader could print or preview it, it is
 * withheld: makeCountrySheet draws nothing, largeSheet() is null (so every caller shows
 * messages.countryPosterTooMany, from the country's own unsupportedReason), and the callers withhold its list,
 * packet and cards with the same sentence. India's STATE and union-territory posters are separate cards
 * (`indiaState`) and are not affected. check:country-sheet-one-path fails if India's poster comes back unannounced.
 */
// WHAT of a whole country is withheld: its POSTER, and/or its ROWS (its prayer list, packet and cards).
// India's whole-country poster is withheld EVERYWHERE BY DEFAULT (it is not released yet). It prints only in an
// explicit PREVIEW context, which needs ALL of:
//  - the Vite DEV server (the pilot), whose element bootstrap sets globalThis.DXM_PREVIEW_UNRELEASED;
//  - an explicit OPT-IN on that page: ?preview=india in its URL, or localStorage 'dxm-preview' containing 'india'.
//    The pilot runs in dev mode, so dev mode alone must NOT show it (the pilot shows what the release shows).
// The whole read is gated on import.meta.env.DEV first, so every BUILT bundle compiles it away (the opt-in included):
// no page, URL, embed or console can print it from production. Its rows (about a thousand pages) stay withheld
// everywhere.
export const WITHHELD = { IND: { poster: true, rows: true, preview: true } }
export const PREVIEW_KEY = 'india'
export function previewOptedIn() {
  const has = (v) => String(v || '').split(',').map((x) => x.trim()).includes(PREVIEW_KEY)
  try { if (new URLSearchParams(globalThis.location?.search || '').getAll('preview').some(has)) return true } catch (_) { /* no URL */ }
  try { return has(globalThis.localStorage?.getItem('dxm-preview')) } catch (_) { return false }
}
export const previewUnreleased = () => Boolean(import.meta.env && import.meta.env.DEV && globalThis.DXM_PREVIEW_UNRELEASED === true && previewOptedIn())
const withheldOf = (item) => (item && !item.indiaState && WITHHELD[String(item.iso3 || '').toUpperCase()]) || null
// No caller can open it: the preview state is read HERE, never passed in (so a built bundle cannot print it).
export function posterWithheld(item) { const w = withheldOf(item); return Boolean(w?.poster) && !(w.preview && previewUnreleased()) }
export function rowsWithheld(item) { return Boolean(withheldOf(item)?.rows) }
/** The poster's withholding (the name Poster Design reads). */
export function sheetWithheld(item) { return posterWithheld(item) }
export function largeSheet(item) { return posterWithheld(item) ? null : largeOf(item) }
// The sheet format a request gets: a large-sheet country prints at the large size ASKED FOR when it has one (66x66,
// 36x60), else at its default (60x96); a packet's page 1 stays a page; every other country gets exactly what it asked.
export function sheetFormatFor(item, format) {
  const big = largeOf(item)   // the size rule itself, independent of withholding (it is what returns with the poster)
  if (!big || format === 'packet') return format
  return big.formats.includes(format) ? format : big.format
}

// The facts row's "Administrative Areas" cell for a large-sheet country whose divisions we know (India: its states and
// union territories, counted from the shared state table). English, like the rest of the sheet.
async function adminAreasFor(iso3, base) {
  if (iso3 !== 'IND') return undefined
  try {
    const { loadIndiaStates } = await import('@map/data/indiaStates.js')
    const n = ((await loadIndiaStates(base)).states || []).length
    return n ? `${n} states and union territories` : undefined
  } catch (_) { return undefined }   // the cell falls back to the country's name
}

export function makeCountrySheet({ records, assetsBase, countries = null }) {
  return async function countrySheet(item, format) {
    const iso3 = item && item.iso3
    if (!iso3) return ''                    // a selection or a row without a country: no sheet
    if (posterWithheld(item)) return ''     // a withheld poster (above): nothing is fetched or drawn
    // Lazy, like the zone sheet: the generator and the boundary loader are only pulled when a
    // reader actually prints, so they stay out of every wall's initial download.
    const { generateCountrySheet } = await import('@map/packet/posterSheets.js')
    const [{ ISO3_NAME }, rows] = await Promise.all([
      import('@map/data/iso3-name.js'),
      records({ type: 'country', values: [iso3] }),
    ])
    if (!rows || !rows.length) return ''    // nothing to pin: fall through rather than draw an empty country
    const big = largeSheet(item)
    const adminAreas = item.adminAreas || (big ? await adminAreasFor(String(iso3).toUpperCase(), assetsBase()) : undefined)
    return generateCountrySheet({
      // region travels: countryZone colours the sheet from it, and a country arriving without one
      // silently falls back to the old flat teal for that poster alone.
      country: { id: item.id, iso3, label: item.label, count: item.count, region: item.region, adminAreas },
      records: rows,
      assetsBase: assetsBase(),
      ISO3_NAME,
      format: sheetFormatFor(item, format),
      series: seriesFor(countries, item),
    })
  }
}
