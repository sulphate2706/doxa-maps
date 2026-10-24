/**
 * zone-sheet-print.js — a UPG-100 zone's map sheet, GENERATED in the browser at the click (the print
 * standard: generate, store only previews). One helper for every surface that prints a zone (the map's
 * legend and packets, the poster wall), so they cannot draw the "same" sheet two ways.
 *
 * The zone and its pins come from zone-sheet.js — the SAME assignment generate.mjs makes — the geometry
 * from the full-resolution boundaries generate.mjs draws, and the drawing from the library's generator.
 *
 *   const zoneSheet = makeZoneSheet({ allRecords, assetsBase: () => base, profileConfig })
 *   usePosterPrints({ …, sheet: zoneSheet })        // (item, format) -> html
 *
 * Library imports are RELATIVE, not `@map/…`: the same file runs under the bundler, Node and the
 * browser-equivalence check (bun), and only a relative path resolves identically in all three.
 */
import { upg100Zones, assignPins, seriesFacts } from './zone-sheet.js'
import { resolveZoneGeometry } from './zone-geometry.js'
import { zonesForList } from './zones-for-list.js'
import { resolvePeopleGroupList } from '../../../library/lists/peopleGroupList.js'

// `date` pins the stamp printed on the sheet (default: today) — how a check reproduces a sheet exactly.
export function makeZoneSheet({ allRecords, assetsBase, profileConfig, date = null }) {
  return async function zoneSheet(item, format) {
    const { generateSheet, loadBoundaries } = await import('../../../library/packet/posterSheets.js')
    const [{ ISO3_NAME }, records, bounds] = await Promise.all([
      import('../../../library/data/iso3-name.js'), allRecords(), loadBoundaries(assetsBase()),
    ])
    const zones = upg100Zones(zonesForList(resolvePeopleGroupList(profileConfig)), records)
    const zone = zones.find((z) => z.id === (item && item.id))
    if (!zone) return ''          // a selection or an unknown id has no zone sheet; the caller falls through
    const pins = assignPins(zones, records).get(zone.zoneKey) || []
    const zoneFC = resolveZoneGeometry(zone, { records, ...bounds })
    // ★ THE PACKET'S PAGE 1 IS THE FULL UPG-100 POSTER (2026-10-02), not the map-only sheet: the letter-size
    // poster with its title, the scripture banner, the three-column header and the footer. The packet asks
    // for 'packet'; this series answers with the full letter sheet, which is the same 1500x1941 page.
    const page1 = format === 'packet'
    return generateSheet({
      zone, pins, zoneFC, format: page1 ? 'letter' : format, ...(page1 ? { sparse: false } : {}), seriesId: 'upg100', ISO3_NAME, adm0: bounds.adm0, adm1Ind: bounds.adm1Ind, adm1Chn: bounds.adm1Chn,
      series: { ...seriesFacts(zones), index: zones.indexOf(zone) + 1 }, date, assetsBase: assetsBase(),
    })
  }
}
