/**
 * tabInfo.js — what each gallery tab's info button (library MapInfo) says and shows.
 *
 * Keyed by the gallery's TAB id. A tab with no entry gets no button. Each OWNER supplies its words and
 * example files; the example files are real, pre-generated output under the tree's assets folder, so the
 * popup opens instantly.
 *
 * ★ EVERY KEY IS IN THE 'mapInfo' AREA, as mapInfo.tab.<tabId>.<field>, and never in the map's own area.
 * The build gives each bundle only the catalogue areas its source names (internal/i18n-areas.mjs): a key
 * in 'regions' or 'upgMap' would either render blank here or, named literally in this file, pull that
 * map's WHOLE catalogue, in eleven locales, into the gallery bundle. upg100 owns 'mapInfo' and merges
 * every tab's translated strings into it. Name keys LITERALLY here: that is what the area scan reads.
 *
 * ★ pos PLACES THE BUTTON CLEAR OF THE MAP'S OWN CONTROLS (--map-info-top / --map-info-side, default
 * 12px each). The button sits at the END of the line (right in English, left in Arabic, see MapInfo),
 * which is also where most of these maps keep their zoom column; measured on 1440 captures in
 * en and ar (2026-09-29), 12px covered the zoom-in button on Prayer Progress, Cities and Gospel, Big
 * Picture's header buttons and Simple Research's tab bar. side 56px sits beside a zoom column; top
 * 46px / 56px clears Big Picture's 38px header bar / Simple Research's tab bar. Regions and UPG-100
 * open on a view-switch strip whose END holds their Share button, which the default covered exactly
 * (found by geometry, not visible in a screenshot: only Share's ring showed around the button).
 * pos.narrow overrides on a phone (the shell's `narrow`, max-width:760px), where the chrome differs:
 * Regions' and UPG-100's strip is full at its END (selector + Share) and empty at its START, so the
 * button goes to the start (placement 'top-left', which MapInfo resolves to the logical start, so
 * Arabic mirrors); Gospel's and Cities' legend panels span to 344px of 390, so their button takes the corner
 * above the zoom column. Measured with the same probe at 390 in en and ar.
 * ★ AN EXAMPLE'S FILES SHIP WITH IT. MapInfo drops an example whose lead image fails to load (quietly,
 * title and all), so a link can land before its files; but a popup is only worth opening once they are
 * in the tree, so land the two together.
 * ★ KEYS MUST NOT CONTAIN A DOT beyond the area separator: the gallery has no vue-i18n, so MapInfo
 * resolves through tStatic, which splits the path on "." and would never find a sentence-shaped key.
 */
// STRATEGY: each row names its strategy literally (strategyKey), in its OWN catalogue area (mapStrategy), which only
// this shell names, so the map bundles (which ship 'mapInfo' for their standalone ⓘ) do not carry every map's
// strategy in eleven languages. MapInfo reads <strategyKey>.bottom, then .p1, .p2 …
// until the first missing key, so a row's point count lives in the catalogue alone (the same count in all 11 locales).
// The lead is the introduction. A row with examples shows EXAMPLES | STRATEGY tabs; a row without goes straight to the
// strategy; where a strategy exists the takeaway is not shown (it would say the same thing twice).
// The UPG-100 zone's pre-generated packet ('full' variant) and card deck, shot once and shared: Simple
// Research's packet is the same renderer, method and variant (usePosterPrints.printPacket, 'full'), so it
// shows these pages too, CAPTIONED as an example zone, because their data is a UPG-100 zone and not a
// Simple Research selection.
const MEC = 'previews/examples/middle-east-core'
const MEC_PAGES = Array.from({ length: 12 }, (_, i) => `${MEC}/packet-p${String(i + 1).padStart(2, '0')}.webp`)
const MEC_CARDS = Array.from({ length: 70 }, (_, i) => `${MEC}/card-${String(i + 1).padStart(2, '0')}.webp`)

export const TAB_INFO = {
  'upg-100': {
    storageKey: 'upg-100',
    // ⓘ IN THE HEADER (the header-button rollout, 2026-09-30): the MFE's header draws it beside Share
    // (MapInfoButton, rounded-square), so the floating ⓘ stays off while that one is on screen (fail-open).
    trigger: 'control',
    pos: { side: '56px', narrow: { placement: 'top-left', side: '12px' } },
    leadKey: 'mapInfo.tab.upg-100.lead',
    strategyKey: 'mapStrategy.tab.upg-100',
    takeawayKey: 'mapInfo.tab.upg-100.takeaway',
    noteKey: 'pins.approximate',
    examples: [
      { kind: 'image', src: 'previews/middle-east-core.webp', full: 'posters/middle-east-core.html' },
      { kind: 'pages', pages: MEC_PAGES },
      { kind: 'deck', cards: MEC_CARDS },
    ],
  },
  'regions-dashboard': {
    storageKey: 'regions-dashboard',
    pos: { side: '56px', narrow: { placement: 'top-left', side: '8px' } },
    leadKey: 'mapInfo.tab.regions-dashboard.lead',
    strategyKey: 'mapStrategy.tab.regions-dashboard',
    // ⓘ IN THE HEADER, NOT FLOATING (the header rollout, 2026-09-30): the Regions header draws its own rounded-square
    // ⓘ beside Share (regions-mfe.vue), as Big Picture's does. trigger:'control' hands this MapInfo to it and
    // suppresses the floating ⓘ while it is on screen; the pos above stays as the fail-open fallback.
    trigger: 'control',
    takeawayKey: 'mapInfo.tab.regions-dashboard.takeaway',
    // The note names India as the one country without prints: no sheet, no geometry, and 855 people
    // groups, too many to fit one poster legibly (library/data/country-posters.json carries that
    // reason itself). China prints (a 3x4 sheet, 154 groups), so the note must not list it.
    noteKey: 'mapInfo.tab.regions-dashboard.note',
    // The Sudan poster, packet pages and card deck join when their shots are in the tree.
    examples: [],
  },
  'dashboard-plus-grid': {
    storageKey: 'dashboard-plus-grid',
    // ⓘ IN THE HEADER, NOT FLOATING (design rule, 2026-09-30). Big Picture draws its own ⓘ as a rounded-square
    // header button beside Share (DashboardTopBar), announcing itself through MapInfoButton's control
    // bridge. trigger:'control' hands this MapInfo to that header button and SUPPRESSES the floating ⓘ
    // whenever it is on screen (fail-open: the grace period keeps the floating one off while the composite
    // loads, so there is no flash, and it still shows if the header control never appears). The pos below
    // stays as the FALLBACK placement for that floating button (a leaf without the header control).
    trigger: 'control',
    // top 46px is the empty END of Big Picture's filter area at every width (1 row at 1440, 2 at 1024,
    // 3 at 800), but that bar is a positioned layer (z-index 55) painted above the button, which left it
    // unclickable (1440). raise lifts the BUTTON over the bar; the pointer stays under it.
    pos: { top: '46px', raise: true },
    leadKey: 'mapInfo.tab.dashboard-plus-grid.lead',
    strategyKey: 'mapStrategy.tab.dashboard-plus-grid',
    takeawayKey: 'mapInfo.tab.dashboard-plus-grid.takeaway',
    // Big Picture's export is a spreadsheet, so its example is a real excerpt of one (sr): the six
    // largest groups by population among those joinable locally, of the full list's 2,107. The column
    // headers are the live table's own words, COPIED verbatim from dashboard.json into mapInfo.col (all
    // eleven locales): naming dashboard.* here pulled the whole 'dashboard' area into this bundle
    // (+50 KB raw). If the table's headers are reworded, copy them again. Cell text stays untranslated
    // because the live table's cells are not translated either.
    examples: [{
      kind: 'table',
      columns: [{ key: 'mapInfo.col.peopleGroup' }, { key: 'mapInfo.col.country' },
        { key: 'mapInfo.col.region' }, { key: 'mapInfo.col.population' }],
      rows: [
        ['Hararghe Oromo', 'Ethiopia', 'Africa', 6355000],
        ['Gaaliin', 'Sudan', 'Middle East', 4520000],
        ['White Moor', 'Morocco', 'Middle East', 3120000],
        ['Baloch, Western', 'Iran', 'Middle East', 3035000],
        ['Baloch, Eastern', 'Pakistan', 'Asia', 2980000],
        ['Bhuiyar', 'India', 'Asia', 2925000],
      ],
      total: 2107,
    }],
  },
  'research-map-plus-grid': {
    storageKey: 'research-map-plus-grid',
    trigger: 'control',
    pos: { top: '56px', side: '56px' },
    leadKey: 'mapInfo.tab.research-map-plus-grid.lead',
    strategyKey: 'mapStrategy.tab.research-map-plus-grid',
    // No takeaway: this map's own view does not make a poster or a packet a reader can reach (its export
    // is behind the export switch), so the line that promised both is gone rather than reworded.
    noteKey: 'pins.approximate',
    // No example: the packet shown here was a UPG-100 zone's, not something this map's own view makes.
    examples: [],
  },
  'prayer-map': {
    storageKey: 'prayer-map',
    // The map draws the button as the top of its own control column (MapInfoButton); pos still places
    // this component's fallback button, shown whenever that control is not on screen.
    trigger: 'control',
    pos: { side: '56px' },
    leadKey: 'mapInfo.tab.prayer-map.lead',
    strategyKey: 'mapStrategy.tab.prayer-map',
    takeawayKey: 'mapInfo.tab.prayer-map.takeaway',
    noteKey: 'pins.approximate',
    examples: [],
  },
  'cities-internet': {
    storageKey: 'cities-internet',
    trigger: 'control',
    pos: { side: '56px', narrow: { side: '4px' } },
    leadKey: 'mapInfo.tab.cities-internet.lead',
    strategyKey: 'mapStrategy.tab.cities-internet',
    takeawayKey: 'mapInfo.tab.cities-internet.takeaway',
    noteKey: 'pins.approximate',
    examples: [],
  },
  'gospel-resources': {
    storageKey: 'gospel-resources',
    trigger: 'control',
    pos: { side: '56px', narrow: { side: '4px' } },
    leadKey: 'mapInfo.tab.gospel-resources.lead',
    strategyKey: 'mapStrategy.tab.gospel-resources',
    takeawayKey: 'mapInfo.tab.gospel-resources.takeaway',
    noteKey: 'pins.approximate',
    examples: [],
  },
}
