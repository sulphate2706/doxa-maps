/**
 * indiaStateSheet.js — one Indian state's or union territory's map sheet, GENERATED in the browser at the click,
 * the same print standard as a country's (@map/packet/countrySheet.js): no sheet is stored, only previews.
 *
 * A state poster is a country poster one level down. Its people groups come from the shared state table
 * (library/data/indiaStates.js: each state's slugs), its outline from the ADM1 boundaries the renderer
 * already loads (boundaries/gb-IND-ADM1.geojson, matched on shapeName), and its text from the `indiaState`
 * series (series.json), so it never calls itself one of the Country Maps.
 *
 *   const sheet = makeIndiaStateSheet({ records, assetsBase: () => base, states })
 *   <PosterWall :sheet="sheet" />          // (item, format) -> html, '' when it cannot be drawn
 *
 * ONE PATH: the wall's state cards draw through this and nothing else (check:country-sheet-one-path).
 */

// The states that get a poster: those with people groups listed, in the wall's own order (most groups first,
// then by name), so a sheet's "map N of M" matches the card's place on the wall.
export function statesWithPosters(states) {
  return (states || []).filter((s) => s && s.count > 0)
    .slice().sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'en'))
}

export function stateSeries(states, state) {
  const tier = statesWithPosters(states)
  const index = tier.findIndex((s) => s.id === state?.id) + 1
  if (!index) return undefined
  return { totalGroups: tier.reduce((a, s) => a + s.count, 0), totalLists: tier.length, index }
}

// The zone the renderer draws. `provinceLabel` makes the title the state's own name, and the header's
// "Administrative Areas" row lists it (the renderer never says "province" for India).
export function stateZone(state, color) {
  return {
    id: state.id, zoneKey: state.id, label: state.name, provinceLabel: state.name, provinces: [state.name],
    count: state.count, color,
  }
}

// The renderer knows a zone's OWN ADM1 shapes by `listId === zone.id`; the served file carries UPG-100's zone
// ids there. So it gets a COPY with this state's feature re-tagged (the cached collection is shared, never
// mutated), plus the stamped zone geometry. null when the state's outline is not in the file.
export function stateGeometry(zone, adm1Ind, shapeName) {
  const feats = (adm1Ind && adm1Ind.features) || []
  const own = feats.filter((f) => f.properties && f.properties.shapeName === shapeName)
  if (!own.length) return null
  const adm1 = { ...adm1Ind, features: feats.map((f) => (own.includes(f) ? { ...f, properties: { ...f.properties, listId: zone.id } } : f)) }
  const zoneFC = {
    type: 'FeatureCollection',
    features: own.map((f) => ({
      type: 'Feature',
      properties: { ...f.properties, listId: zone.id, zoneKey: zone.zoneKey, zoneColor: zone.color, zoneLabel: zone.label },
      geometry: f.geometry,
    })),
  }
  return { adm1, zoneFC }
}

/**
 * @param {object} o
 *   records     (selector) => Promise<rows[]>   the shared provider; asked for the state's slugs
 *   assetsBase  () => string                    where boundaries/ is served from
 *   states      () => states[] | null           the state table's entries (library/data/indiaStates.js)
 *   region      the WAGF region the hue comes from (India's: 'Asia'), so a state prints in India's hue
 * @returns {(item, format) => Promise<string>}
 */
export function makeIndiaStateSheet({ records, assetsBase, states, region = 'Asia' }) {
  return async function indiaStateSheet(item, format) {
    const all = states() || []
    const state = all.find((s) => s.id === (item && item.id))
    if (!state || !state.count) return ''
    const [{ generateSheet, loadBoundaries, pinsFrom, countryRegionColor }, { ISO3_NAME }, rows] = await Promise.all([
      import('@map/packet/posterSheets.js'), import('@map/data/iso3-name.js'),
      records({ type: 'pg_slugs', values: state.slugs }),
    ])
    if (!rows || !rows.length) return ''
    const bounds = await loadBoundaries(assetsBase())
    const zone = stateZone(state, countryRegionColor(region))
    const geo = stateGeometry(zone, bounds.adm1Ind, state.shapeName)
    if (!geo) return ''              // no outline to draw: fall through to the stored preview, never a guessed map
    return generateSheet({
      zone, pins: pinsFrom(rows), zoneFC: geo.zoneFC, format, seriesId: 'indiaState', ISO3_NAME,
      adm0: bounds.adm0, adm1Ind: geo.adm1, adm1Chn: bounds.adm1Chn,
      series: stateSeries(all, state), assetsBase: assetsBase(),
    })
  }
}
