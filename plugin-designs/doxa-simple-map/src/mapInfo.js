// What "What can this map do?" says about Prayer Progress. The map carries it, so the ⓘ works wherever the
// map is embedded; a host (the gallery) only adds placement. The keys are the library catalogue's
// ('mapInfo' area, all 11 locales).
//
// PER PRESET. The text describes the prayer map, so it belongs to a map that shows the PRAYER tab: the
// full profile (all three tabs, prayer first) and the prayer preset. The engagement and adoption presets
// show only their own tab and have no text of their own yet, so they have no info, and no ⓘ renders
// there: no wrong copy and no untranslated text.
const PRAYER = {
  storageKey: 'prayer-map',
  leadKey: 'mapInfo.tab.prayer-map.lead',
  takeawayKey: 'mapInfo.tab.prayer-map.takeaway',
  // The approximate-location caveat, kept here where a reader who asks will always find it, whether or not
  // the map shows its own pin note. The same catalogue string that note uses.
  noteKey: 'pins.approximate',
  // No strategyKey yet, on purpose: the strategy text lives in one catalogue area for every map, so naming it
  // here would ship all maps' strategies inside this bundle. An embed shows the intro + the note; the strategy
  // follows once the catalogue is loaded per locale on demand.
  examples: [],
}

/** The map's info for the tabs it shows, or null when it has none. */
export function mapInfoFor(tabs) {
  return (tabs || []).some((t) => t && t.id === 'prayer') ? PRAYER : null
}
