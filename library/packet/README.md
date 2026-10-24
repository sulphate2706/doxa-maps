# The print standard — prayer resources for any set of people groups

Any map in this library can print four prayer resources for whatever its reader picked — a UPG-100
list, a country, a region, a selection on the map:

| Resource | What it is |
|---|---|
| **Poster** | the set's map sheet, printed on letter paper as a vector page |
| **Card deck** | one prayer card per people group, in five card stocks |
| **Prayer list** | the prayer packet: full detail (map, triangle, life calendar, % evangelical, profiles, bounded + centered sets, prayer wheel, prayer points) or lightweight (map, triangle, a worksheet of every group, wheel, points) |

**Everything is generated at the click, in the reader's language.** Nothing a reader prints is stored;
only the previews on a poster wall are stored files, because a wall shows many at once.

## Where it is production, where it is experimental

**Production** (always on): the **UPG 100 list** (its legend exports, selection HUD and poster wall), the
**Regions dashboard's country posters**, and the **Country Posters wall**.

**Experimental** (one switch, `library/print/experimentalExports.js`): any other map whose legend already
has an Export menu may offer the same exports — the card deck, the packet — only while
`experimentalExportsOn(profileConfig)` is true. Turn it off per page (`experimentalExports: false` in
profile-config), per visit (`?exports=off`), per site (`window.DOXA_EXPERIMENTAL_EXPORTS = false`) or
everywhere (`EXPERIMENTAL_EXPORTS_DEFAULT`); off restores the menu the map had before. The legend shows
the Card Deck item only when told to (`:export-cards`, or `provide('legendExportCards', …)` for the
mobile sheet), so a map that does not handle it never shows a dead button.

## Adopting it in a map — three pieces

```js
import { usePosterPrints } from '@map/composables/usePosterPrints.js'
import { createPeopleGroupRecords } from '@map/lists/peopleGroupRecords.js'
import { getApiBaseUrl } from '@map/api/apiBaseUrl.js'

// 1. RECORDS — the people of a set, by selector (one fetch per language, shared by every item)
const recordsFor = createPeopleGroupRecords({ apiBase: () => getApiBaseUrl(), lang: () => locale, profileConfig })

// 2. THE PRINTS — an item is { id, label } plus whatever your records/sheet functions need
const prints = usePosterPrints({
  records: (item) => recordsFor({ type: 'country', values: [item.iso3] }),
  lang: () => locale,
  assetsBase: () => assetsBase,
  sheet: (item, format) => mySheet(item, format),   // 3. optional: the generated map sheet
})

prints.printPacket(item, { variant: 'full' })   // or 'lightweight'
prints.printCardDeck(item)
prints.printPoster(item)
```

Or hand the same options to `<PosterWall>` as props (`:records`, `:sheet`, `item-count-key`, …) and the
wall renders every card's Poster / Prayer list / Cards buttons itself. A wall that passes no `records`
shows only the poster, rather than buttons that fail.

### Selectors (`peopleGroupRecords.js`)

| Selector | Picks |
|---|---|
| `{ type: 'country', values: ['TCD'] }` | the groups of those countries (ISO3) |
| `{ type: 'pg_slugs', values: [...] }` | exactly those groups — a selection, a custom list |
| `{ type: 'field', field: 'wagf_region', values: ['africa'] }` | any field's value |
| anything else | your `evaluate(selector, records)` (the UPG-100 selector language) |

An unknown selector selects **nothing**, never everything.

### The map sheet (`posterSheets.js`)

`generateSheet({ zone, pins, zoneFC, format, seriesId, ISO3_NAME, adm0, adm1Ind, adm1Chn, series })`
draws a sheet with **the same generator the Node script runs** (`poster-render.js`). Formats: `3x4`,
`3x3` (wall posters), `letter` (the poster print), `packet` (the map-only sheet for a packet's page 1).
`loadBoundaries(assetsBase)` fetches the full-resolution boundaries it draws from.
`generateCountrySheet({ country, records, assetsBase, ISO3_NAME, format, series })` does all of it for
one country. A UPG-100 zone: `plugin-designs/my-upg-100-list/data/zone-sheet-print.js`.

Page 1 of a packet takes the first of: an explicit `mapSvg`, `sheet(item, 'packet')`, `mapImage(item)`
(a raster of a live map), a stored sheet under `assetsBase`. With none, it says the map is missing.

## What proves it

| Gate | Asserts |
|---|---|
| `check:people-group-records` | a selector picks exactly its set, two-sided |
| `check:poster-browser-equiv` | a sheet generated in the browser is byte-identical to the Node generator's |
| `check:packet-a1-structure`, `check:packet-variants` | both packets' page order and contents |
| `check:map-labels`, `check:plural-forms`, `check:i18n-*` | every word in the reader's language |
