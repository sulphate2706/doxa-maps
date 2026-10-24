/**
 * templates.js: every poster template the library can print, one entry per CONFIGURATION.
 *
 * A configuration is one template at one setting (a map sheet at 3 × 3, a packet in its lightweight
 * variant, a card deck on postcard stock). Its NAME is the stable id a person gives an agent ("use
 * map-sheet.country.3x3"), so a name is never renamed once published; a retired configuration keeps
 * its name and is marked legacy.
 *
 * Each entry says where its renderer lives in library/ and, when the gallery can draw it, how:
 * render(ctx) draws the template from the LIBRARY with the sample data, so a library change shows up in
 * the gallery the next time it opens. It returns either a poster's HTML (a map sheet: an <svg> the poster
 * rasteriser lifts) or a printable DOCUMENT as { html, page, width, height } (a deck, a packet: HTML pages,
 * whose first page becomes the thumbnail, src/pageThumb.js) or a ready image as { image } (panels drawn from
 * the shared panel geometry, src/panelsSvg.js). Entries the gallery cannot draw yet
 * say so (render: null) and the card shows the wall's "preview unavailable" placeholder; the details
 * dialog states which part is missing, rather than a picture of something else.
 *
 * Where the library already has the list (card stocks), it is DERIVED here, never retyped.
 */
import { STOCK } from '@map/packet/card-render.js'

// The sample every map sheet is drawn with: one real country from the data the country wall ships,
// mid-sized (34 groups), on the standard sheet tier, with full outlines, so each sheet shows every part.
export const SAMPLE_COUNTRY_ID = 'country-npl'

// The library's poster formats (library/packet/poster-render.js FORMATS). The generator is served as a
// pinned asset, not bundled, so its table cannot be imported here; check:poster-design-catalogue reads
// FORMATS from the source and fails when the two disagree.
// In the gallery's order: the 3 × 3 country sheet first, then the large sizes, then the rest. The large SIDE-LANE
// sheets name a whole country's groups beside the map. India is the one large-sheet country (countrySheet.js
// LARGE_SHEETS) and prints at 5 × 8 ft ONLY, so it samples that card (withheld, so the card shows the sentence). No
// country prints at 66x66 or 36x60 today: those two are drawn with the largest drawable countries (China, Sudan) to
// show the template, and their details say so (missing: noCountryAtSize). Names never change (src/catalogue-names.json).
export const SHEET_FORMATS = {
// `size` is the printed size as data (src/sizeText.js names it in the reader's language): inches, side lanes, paper.
  '3x3': { size: { dims: [36, 36] }, px: [1500, 1500] },
  // experimental: still being designed, or no drawable preview; Styles lists these in a collapsed Experimental group.
  '60x96': { size: { dims: [60, 96], lanes: true }, px: [2500, 4000], sample: 'country-ind', experimental: true },
  '66x66': { size: { dims: [66, 66], lanes: true }, px: [2750, 2750], sample: 'country-chn', missing: 'posterDesign.missing.noCountryAtSize', experimental: true },
  '36x60': { size: { dims: [36, 60], lanes: true }, px: [1500, 2500], sample: 'country-sdn', missing: 'posterDesign.missing.noCountryAtSize', experimental: true },
  '3x4': { size: { dims: [36, 48] }, px: [1500, 2000], legacy: true },
  letter: { size: { paper: 'letter' }, px: [1500, 1941] },
  packet: { size: { paper: 'letter', packetPage: true }, px: [1500, 1941] },
}

// Families are the sections of the Styles tab, in reading order. The keys are written out, never
// assembled, so the catalogue checks and the i18n area build can see each one.
export const FAMILY_KEYS = {
  mapSheet: 'posterDesign.family.mapSheet',
  upgZone: 'posterDesign.family.upgZone',
  packet: 'posterDesign.family.packet',
  cards: 'posterDesign.family.cards',
  wall: 'posterDesign.family.wall',
  mapPrint: 'posterDesign.family.mapPrint',
}

function sheetEntry(format) {
  const f = SHEET_FORMATS[format]
  return {
    name: format === 'packet' ? 'map-sheet.packet-page' : `map-sheet.country.${format}`,
    family: 'mapSheet',
    labelKey: format === 'packet' ? 'posterDesign.tpl.mapSheetPacketPage' : 'posterDesign.tpl.mapSheetCountry',
    size: f.size,
    px: f.px,
    legacy: !!f.legacy,
    ...(f.experimental ? { experimental: true } : {}),
    ...(f.missing ? { missing: f.missing } : {}),
    renderer: 'library/packet/posterSheets.js generateCountrySheet → library/packet/poster-render.js',
    settings: { format },
    sample: f.sample || SAMPLE_COUNTRY_ID,
    render: (ctx) => ctx.countrySheet(format, f.sample || SAMPLE_COUNTRY_ID),
  }
}

// UPG100's zone posters, drawn from the LIBRARY COPY of UPG100's zone code (library/packet/upg100Zones/, kept equal to
// the plugin's own by check:upg100-zone-copy). They carry UPG100's own design names (`plugin`), so a drawn card here
// replaces that plugin's no-preview card, and the names never change. The sample zone is one of UPG100's real zones.
export const SAMPLE_ZONE_ID = 'middle-east-core'
const ZONE_RENDERER = 'library/packet/upg100Zones/zone-sheet-print.js makeZoneSheet → library/packet/posterSheets.js generateSheet'
function zoneEntry(format) {
  const f = SHEET_FORMATS[format]
  const page1 = format === 'packet'
  return {
    name: page1 ? 'upg100-territory-packet.page-1' : `upg100-territory-poster.${format}`,
    family: 'upgZone',
    labelKey: page1 ? 'posterDesign.tpl.upgZonePacket' : 'posterDesign.tpl.upgZonePoster',
    plugin: 'my-upg-100-list',
    size: f.size,
    px: f.px,
    renderer: ZONE_RENDERER,
    settings: { format },
    sample: SAMPLE_ZONE_ID,
    render: (ctx) => ctx.zoneSheet(format, SAMPLE_ZONE_ID),
  }
}

/** @returns {Array<object>} every configuration, in the gallery's order. */
export function listConfigurations() {
  return [
    ...Object.keys(SHEET_FORMATS).map(sheetEntry),
    ...['letter', '3x3', '3x4', 'packet'].map(zoneEntry),
    ...['full', 'lightweight'].map((variant) => ({
      name: `packet.${variant}`,
      family: 'packet',
      labelKey: variant === 'full' ? 'posterDesign.tpl.packetFull' : 'posterDesign.tpl.packetLightweight',
      size: { paper: 'letter' },
      renderer: 'library/packet/packet-render.js buildPacket (VARIANTS)',
      settings: { variant },
      sample: SAMPLE_COUNTRY_ID,
      // Page 1 of the packet (its map page) as the thumbnail; ctx.packetDocument builds it.
      render: (ctx) => ctx.packetDocument(variant),
    })),
    ...Object.entries(STOCK).map(([id, s]) => ({
      name: `cards.${id}`,
      family: 'cards',
      labelKey: 'posterDesign.tpl.cards',
      stock: s,
      size: { dims: [s.w, s.h] },
      renderer: 'library/packet/card-render.js createCardRenderer (STOCK)',
      settings: { stock: id },
      sample: SAMPLE_COUNTRY_ID,
      // The first card of the sample's deck; ctx.cardDeck builds the whole deck the wall would print.
      render: (ctx) => ctx.cardDeck(id),
    })),
    {
      name: 'wall.bless-panels',
      family: 'wall',
      labelKey: 'posterDesign.tpl.blessPanels',
      size: { dims: [60, 96], panels: 3 },
      renderer: 'library/components/poster/panelSheets.js planPanels (the sheets, joins and content boxes); the cards are drawn by plugin-designs/wall-of-people-groups/src/blessPoster.js',
      settings: { size: '60x96', joinFill: 'glue' },
      sample: null,
      // The panel geometry of the ladder's 5 × 8 ft size, with the card rows as a layout (src/panelsSvg.js).
      render: (ctx) => ctx.panels('60x96'),
      missing: 'posterDesign.missing.bless',
    },
    {
      name: 'map-print.dialog',
      family: 'mapPrint',
      labelKey: 'posterDesign.tpl.mapPrint',
      size: { any: true },   // the reader picks one from the shared ladder (library/constants/posterSizes.js)
      renderer: 'library/components/poster/PosterDialog.vue + library/composables/useMapPoster.js',
      settings: {},
      sample: null,
      render: null,
      experimental: true,   // no preview: it prints the live map the reader is looking at
      missing: 'posterDesign.missing.mapPrint',
    },
  ]
}
