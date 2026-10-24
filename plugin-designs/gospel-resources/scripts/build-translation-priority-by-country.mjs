/**
 * build-translation-priority-by-country.mjs — where to SEND a translation team.
 *
 * WHY THIS IS NOT THE COUNTRY GAP TABLE. `country-gap` aggregates the groups with NOTHING —
 * where to send a first messenger. This aggregates the opposite population: groups that can
 * already hear the gospel and still have no text to read. They are not in that table at all,
 * because none of them is tier 0, and a country can rank high here while looking well served
 * there.
 *
 * TWO COLUMNS THAT DISAGREE, ON PURPOSE. Nigeria and the DRC hold the most LANGUAGES in this
 * set — 221 and 103 — which is the translation workload. China and Pakistan hold the most
 * PEOPLE — 218 and 195 million — across far fewer languages. Which number matters depends
 * entirely on whether you are funding translators or broadcasters, so both are here and
 * neither is chosen for the reader. Sorted by people because that is the commoner question,
 * not because it is the truer one.
 *
 * The caveat travels with the data: "no text found" means not found in the pools checked, and
 * the per-row table carries the checked and unchecked pools for exactly that reason. An
 * aggregate cannot carry them row by row, so it says so in its meta and in a column that
 * survives a CSV export.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const SRC = resolve(REPO, 'data/tables/translation-priority.json')
const OUT = resolve(REPO, 'data/tables/translation-priority-by-country.json')

const src = JSON.parse(readFileSync(SRC, 'utf8'))

const by = new Map()
for (const r of src.rows || []) {
  const iso3 = r.iso3 || ''
  if (!iso3) continue
  let e = by.get(iso3)
  if (!e) {
    e = { iso3, country: r.country || iso3, groups: 0, languages: new Set(), people: 0, largest: '', largestPop: 0 }
    by.set(iso3, e)
  }
  e.groups += 1
  e.languages.add(r.iso639_3)
  e.people += r.population || 0
  if ((r.population || 0) > e.largestPop) {
    e.largestPop = r.population || 0
    e.largest = r.people_group || ''
  }
}

const rows = [...by.values()]
  .map((e) => ({
    country: e.country,
    iso3: e.iso3,
    groups: e.groups,
    languages: e.languages.size,
    people: e.people,
    largest_group: e.largest,
    largest_group_population: e.largestPop,
    basis: 'no text Scripture found in the pools checked',
  }))
  .sort((a, b) => b.people - a.people)

writeSnapshot(
  OUT,
  `${JSON.stringify(
    {
      meta: {
        title: 'Translation priority by country — can hear it, no text found',
        source: `data/tables/translation-priority.json, itself built from the pin index — so this
          table, that one and the map cannot disagree.`.replace(/\s+/g, ' '),
        generated: new Date().toISOString().slice(0, 10),
        countries: rows.length,
        groups: rows.reduce((n, r) => n + r.groups, 0),
        people: rows.reduce((n, r) => n + r.people, 0),
        definition:
          'People groups with recorded audio, the JESUS Film, a Bible video or Words of Life ' +
          'in their language and NO text Scripture found in the pools checked, aggregated to ' +
          'the country a team would be sent to. "Not found" is a statement about those pools, ' +
          'never a claim that no text exists; the per-group table carries the checked and ' +
          'unchecked pools on every row.',
        two_columns_note:
          'groups and languages answer different questions from people. Nigeria and the DRC ' +
          'lead on languages, which is the translation workload; China and Pakistan lead on ' +
          'population across far fewer languages. Neither is ranked for you.',
      },
      columns: [
        { title: 'Country', field: 'country', type: 'string' },
        { title: 'ISO3', field: 'iso3', type: 'string' },
        { title: 'Groups', field: 'groups', type: 'number' },
        { title: 'Languages', field: 'languages', type: 'number' },
        { title: 'People', field: 'people', type: 'number' },
        { title: 'Largest group', field: 'largest_group', type: 'string' },
        { title: 'Its population', field: 'largest_group_population', type: 'number' },
        { title: 'Basis', field: 'basis', type: 'string' },
      ],
      rows,
    },
    null,
    1,
  )}\n`,
  (j) => (j.rows || []).length,
  'translation-priority-by-country row(s)',
)
console.log(
  `translation-priority-by-country: ${rows.length} countries · ` +
    `${rows.reduce((n, r) => n + r.groups, 0)} groups · ` +
    `${rows.reduce((n, r) => n + r.people, 0).toLocaleString()} people`,
)
console.log(`wrote ${OUT}`)
