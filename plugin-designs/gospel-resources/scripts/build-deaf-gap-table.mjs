#!/usr/bin/env node
/**
 * build-deaf-gap-table.mjs — the Deaf gap, rebuilt from the PINS.
 *
 * WHY IT IS BEING REBUILT. The table this replaces was derived from the curated
 * 2,106-record set and reported 73 sign languages, 120 people groups and 19.35M people.
 * The map draws 150 sign languages across 234 groups and 84.2M people. Two surfaces of one
 * dataset describing different universes, and the smaller one was the "Deaf Gap" tab — the
 * table a reader would export to decide where Deaf work is needed. It was missing more than
 * half of it.
 *
 * MEASURED NOW: 150 sign languages · 234 groups · 84.2M people, of which 136 languages /
 * 183 groups / 55.2M people have nothing found in any pool checked.
 *
 * THE BRIDGE RULE IS KEPT VERBATIM because it is the most important sentence here: a sign
 * language is bridged ONLY by another sign language. Text and audio in a spoken language do
 * not reach a Deaf community, so the "related variety" reasoning that applies to spoken
 * macrolanguages must never be applied to these rows.
 *
 * PRIVATE-USE CODES ARE COUNTED, NOT HIDDEN. 40 of these languages carry qaa-qtz codes,
 * which are private use in ISO 639-3 and are indexed by no resource pool on earth. A group
 * on such a code cannot be matched to a resource even if one exists, so "nothing found" for
 * them is a statement about the JOIN as much as about the world, and the row says so.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const PINS = resolve(REPO, 'data/tables/people-group-pins.json')
const BY_COUNTRY = resolve(REPO, 'data/tables/gospel-by-country.json')
const OUT = resolve(REPO, 'data/tables/deaf-gap.json')

const pins = JSON.parse(readFileSync(PINS, 'utf8'))
const { codes, pins: rows } = pins

let countryName = {}
try {
  const c = JSON.parse(readFileSync(BY_COUNTRY, 'utf8'))
  for (const r of c.rows || []) if (r.iso3) countryName[r.iso3] = r.country || r.iso3
} catch { countryName = {} }

const isPrivate = (c) => !!c && c.length === 3 && c >= 'qaa' && c <= 'qtz'
const out = []
const langs = new Set()
const nothingLangs = new Set()
let people = 0, nothingGroups = 0, nothingPeople = 0, privateCodes = new Set()

for (const [name, , , iso3, code, pop] of rows) {
  const v = codes[code]
  if (!(v && v.sg === 1)) continue
  langs.add(code)
  people += pop || 0
  if (isPrivate(code)) privateCodes.add(code)
  const hasFilm = !!v.f
  // Every pool, including Scripture Earth and GRN. No sign language carries either today —
  // GRN is deliberately skipped for them and Scripture Earth happens to have none — so this
  // is latent rather than live, which is exactly when it is cheap to fix.
  const hasAny = !!(v.s || v.f || v.au || v.bv || v.se || v.ga || (v.d && v.d.length))
  if (!hasAny) { nothingLangs.add(code); nothingGroups++; nothingPeople += pop || 0 }
  out.push({
    people_group: name,
    sign_language: v.l || '',
    iso639_3: code || '',
    countries: countryName[iso3] || iso3 || '',
    population: pop || 0,
    // A Deaf group is reached by SIGNED Scripture. Text is recorded because a Deaf reader
    // may use it, but it is never what makes the row "reached".
    signed_film: hasFilm ? v.f : '',
    has_signed_film: hasFilm,
    has_any_resource: hasAny,
    code_unmatchable: isPrivate(code),
    status: hasAny ? 'a resource exists in this sign language' : 'nothing found in the pools checked',
    note: isPrivate(code)
      ? 'This code is PRIVATE USE in ISO 639-3 (qaa-qtz). No resource pool indexes it, so a resource could exist and still never join to this row.'
      : '',
  })
}
out.sort((a, b) => Number(a.has_any_resource) - Number(b.has_any_resource) || b.population - a.population)

const fmt = (n) => n.toLocaleString('en-US')
// DataTable renders a { meta, columns, rows } document and `columns` IS the Tabulator
// definition — omit it and the table draws its header, its row count and its pagination
// over an empty body, which looks like a data problem and is not one.
const columns = [
  { title: 'People Group', field: 'people_group', type: 'string' },
  { title: 'Sign language', field: 'sign_language', type: 'string' },
  { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
  { title: 'Countries', field: 'countries', type: 'string' },
  { title: 'Population', field: 'population', type: 'number' },
  { title: 'Signed film', field: 'has_signed_film', type: 'boolean' },
  { title: 'Signed film link', field: 'signed_film', type: 'url' },
  { title: 'Has anything', field: 'has_any_resource', type: 'boolean' },
  { title: 'Code unlookupable', field: 'code_unmatchable', type: 'boolean' },
  { title: 'Status', field: 'status', type: 'string' },
  { title: 'Note', field: 'note', type: 'string' },
]

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify({
  columns,
  meta: {
    title: 'The Deaf Gap',
    grain: 'one row per Deaf people group',
    generated: new Date().toISOString().slice(0, 10),
    measured: `${langs.size} sign languages · ${out.length} people groups · ${fmt(people)} people. ` +
      `${nothingLangs.size} languages / ${nothingGroups} groups / ${fmt(nothingPeople)} people with NOTHING found.`,
    bridge_rule: 'A sign language is bridged ONLY by another sign language. Text and audio in a spoken language do not reach a Deaf community.',
    compounding_problem: `${privateCodes.size} of these languages carry PRIVATE-USE (qaa-qtz) codes outside ISO 639-3. No resource pool indexes a private-use code, so those groups cannot be matched to a resource even if one exists.`,
    what_is_unchecked: 'Deaf Bible Society and DOOR International, both key-gated. The open catalogues are exhausted: the JESUS Film lists 14 sign-language entries across 13 ISO codes and every one is already here, and Faith Comes By Hearing carries none.',
    source: 'data/tables/people-group-pins.json — the same index the map draws, so the two cannot disagree.',
  },
  rows: out,
}, null, 1)}\n`)

console.log(`deaf-gap: ${out.length} groups · ${langs.size} sign languages · ${fmt(people)} people`)
console.log(`  nothing found: ${nothingLangs.size} languages / ${nothingGroups} groups / ${fmt(nothingPeople)} people`)
console.log(`  private-use codes: ${privateCodes.size}`)
console.log(`wrote ${OUT}`)
