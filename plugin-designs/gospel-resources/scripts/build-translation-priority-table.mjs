/**
 * build-translation-priority-table.mjs — groups that can HEAR the gospel but cannot READ it.
 *
 * WHY THIS TABLE EXISTS SEPARATELY FROM THE GAP TABLE. "Where nothing was found" answers
 * where to send a first messenger. It does not answer the question a Bible translation
 * organisation actually starts from, which is the opposite shape: where has someone already
 * been, where is the gospel already audible — a recording, the JESUS Film, a Bible video,
 * Words of Life — and there is still no TEXT in the language. Those groups are not in the
 * gap table at all, because they are not tier 0. They were unreachable as a list until now:
 * the map can filter to them, but a filter cannot be exported, sorted or handed to a
 * committee, and this is exactly the kind of list that gets handed to a committee.
 *
 * WHAT "NO TEXT" MEANS HERE, EXACTLY. No text Scripture in the pools this build checks —
 * eBible, PNG.Bible, Door43 (excluding Open Bible Stories, which is a story set and not a
 * translation), a Faith Comes By Hearing fileset carrying text, or Scripture Earth. It is
 * NOT a claim that no text exists anywhere. The largest rows are varieties like Western
 * Punjabi, Wu Chinese and Egyptian Arabic where a recording plainly exists and a text in
 * that same variety is genuinely contested, so the columns carry the pools checked and the
 * pools not checked on every row — an exported CSV that loses the caveat is worse than no
 * CSV, because the caveat is the part a spreadsheet strips first.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const PINS = resolve(REPO, 'data/tables/people-group-pins.json')
const GAPS = resolve(REPO, 'data/tables/gospel-gaps.json')
const OUT = resolve(REPO, 'data/tables/translation-priority.json')

const { codes, pins } = JSON.parse(readFileSync(PINS, 'utf8'))

/* Country names, resolved the way the gap table resolves them, so the two agree. */
const countryName = {}
try {
  for (const r of JSON.parse(readFileSync(GAPS, 'utf8')).rows || []) {
    if (r.iso3 && r.country) countryName[r.iso3] = r.country
  }
} catch { /* names are a nicety; the ISO3 column carries the fact */ }

/** Text Scripture, from any pool that publishes text. Open Bible Stories is not one. */
const hasTextScripture = (c) =>
  !!c.s ||
  !!(c.au && /text/.test(c.au.m || '')) ||
  !!c.se ||
  (c.d || []).some((d) => !/^Open Bible Stories/.test(d.s || ''))

/** Something a person can hear or watch in their own language. */
const canHear = (c) => !!c.ga || !!(c.au && /audio/.test(c.au.m || '')) || !!c.f || !!c.bv

const rows = []
for (const p of pins) {
  const [name, lat, lng, iso3, code, pop, tier] = p
  if (tier === 0 || !code) continue
  const c = codes[code]
  if (!c || c.sg === 1 || !canHear(c) || hasTextScripture(c)) continue

  /* Name what they DO have, and where it is, so a row is actionable without the map. */
  const has = []
  const links = []
  if (c.au && /audio/.test(c.au.m || '')) { has.push('audio Scripture'); links.push(c.au.u) }
  if (c.ga) { has.push('gospel audio (Words of Life)'); links.push(c.ga.u) }
  if (c.f) { has.push('the JESUS Film'); links.push(c.f) }
  if (c.bv) { has.push('Bible video'); links.push(c.bv.u) }

  rows.push({
    people_group: name,
    country: countryName[iso3] || iso3,
    iso3,
    language: c.l || '',
    iso639_3: code,
    population: pop || 0,
    can_hear: has.join(', '),
    first_link: links[0] || '',
    checked_pools: c.ck || '',
    unchecked_pools: c.un || '',
    lat,
    lng,
  })
}
rows.sort((a, b) => b.population - a.population)

const people = rows.reduce((n, r) => n + r.population, 0)
const langs = new Set(rows.map((r) => r.iso639_3)).size

writeSnapshot(
  OUT,
  `${JSON.stringify(
    {
      meta: {
        title: 'Translation priority — can hear it, no text found',
        source:
          'data/tables/people-group-pins.json — the same index the map draws, so this table ' +
          'and the map cannot disagree.',
        generated: new Date().toISOString().slice(0, 10),
        groups: rows.length,
        languages: langs,
        people,
        definition:
          'A people group with recorded audio, the JESUS Film, a Bible video or Words of Life ' +
          'in their language, and NO text Scripture found in the pools checked. "Not found" is ' +
          'a statement about those pools, never a claim that no text exists — several of the ' +
          'largest rows are varieties where a recording plainly exists and a text in that same ' +
          'variety is contested. The checked and unchecked pools are on every row for that reason.',
      },
      columns: [
        { title: 'People group', field: 'people_group', type: 'string' },
        { title: 'Country', field: 'country', type: 'string' },
        { title: 'Language', field: 'language', type: 'string' },
        { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
        { title: 'Population', field: 'population', type: 'number' },
        { title: 'Can already hear', field: 'can_hear', type: 'string' },
        { title: 'Link', field: 'first_link', type: 'url' },
        { title: 'Pools checked', field: 'checked_pools', type: 'string' },
        { title: 'Pools not checked', field: 'unchecked_pools', type: 'string' },
      ],
      rows,
    },
    null,
    1,
  )}\n`,
  (j) => (j.rows || []).length,
  'translation-priority row(s)',
)
console.log(
  `translation-priority: ${rows.length} group(s) · ${langs} language(s) · ${people.toLocaleString()} people`,
)
console.log(`wrote ${OUT}`)
