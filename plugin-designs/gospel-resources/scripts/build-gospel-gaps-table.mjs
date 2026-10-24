#!/usr/bin/env node
/**
 * build-gospel-gaps-table.mjs — the groups with NOTHING found, in an exportable form.
 *
 * WHAT WAS MISSING. Every table in this bundle lists what EXISTS. The map can now filter
 * to the gap and rank its 40 largest, but 40 is a preview and a map is not something you
 * can hand to a prayer group or work through in a spreadsheet. There was no exportable
 * list of what is missing.
 *
 * The existing "Gaps and Opportunities" table is not that list and cannot become it: it
 * is one row per people group across the curated 2,106-record set, so it cannot see the
 * 3,457 groups the pins now know have nothing. It keeps its own job — bridge-language
 * analysis for the groups it does cover — and this sits beside it.
 *
 * WHAT "NOTHING FOUND" MEANS, and the reason every row carries its own provenance: it
 * means absent from the pools THIS build checked, never that nothing exists. The checked
 * and unchecked pools travel per row so an exported CSV cannot be read as a finding about
 * the world — audio in particular has never been searched for ANY group here.
 *
 * SIGN LANGUAGES ARE FLAGGED because "no Scripture" means something different for them: a
 * text pool was never the right place to look. Sorted by population, because a mobiliser
 * reading this is choosing where to go.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const PINS = resolve(REPO, 'data/tables/people-group-pins.json')
const COUNTRY = resolve(REPO, 'data/tables/gospel-by-country.json')
const SLIM = resolve(REPO, 'data/people-groups/people-groups-slim.json')
const OUT = resolve(REPO, 'data/tables/gospel-gaps.json')

const { codes, pins } = JSON.parse(readFileSync(PINS, 'utf8'))
// Country NAMES come from the SAME source the pins do. gospel-by-country knows 170
// countries and the boundaries file 162, while the pins span 242 — so both left rows
// printing a raw ISO3: "CHE" for Switzerland, plus Canada, Taiwan, Timor-Leste, Mexico
// and Argentina. An exported CSV with a bare code in the country column is materially
// worse than one without it.
// people-groups-slim.json carries CountryName on every row and is where the pins were
// built from, so its coverage matches by construction rather than by luck. The curated
// gospel-by-country names still win where it has one — they are the reviewed spelling.
let byIso = {}
const slimRows = (() => {
  const d = JSON.parse(readFileSync(SLIM, 'utf8'))
  if (Array.isArray(d)) return d
  for (const v of Object.values(d)) if (Array.isArray(v) && v[0] && typeof v[0] === 'object') return v
  return []
})()
for (const r of slimRows) {
  const a = String(r.ISOAlpha3 || '').trim()
  const n = String(r.CountryName || '').trim()
  if (a && n && !byIso[a]) byIso[a] = n
}
try {
  // curated spellings override
  for (const c of JSON.parse(readFileSync(COUNTRY, 'utf8')).countries || []) if (c.iso3 && c.country) byIso[c.iso3] = c.country
} catch { /* the slim names already cover every pin */ }

const rows = []
for (const [name, lat, lng, iso3, code, pop, tier] of pins) {
  if (tier !== 0) continue
  const c = codes[code] || {}
  rows.push({
    people_group: name,
    country: byIso[iso3] || iso3,
    iso3,
    language: c.l || '',
    iso639_3: code || '',
    population: pop || 0,
    sign_language: c.sg === 1 ? 'yes' : '',
    // WHICH KIND OF GAP THIS IS. "1,845 groups have nothing" is four situations wearing one
    // number and they need four different responses — the map says so on screen, and an
    // exported copy of this table could not say it at all until now. Order matters: a code
    // can be both a sign language and private-use (every private-use code here IS one), so
    // the more actionable label wins and the meta says they overlap.
    gap_kind:
      !code ? 'no language code — no pool can index it'
      : c.sg === 1 ? 'sign language — pools are key-gated, an access problem'
      : /^q[a-t][a-z]$/.test(code) ? 'private-use code — no pool can index it'
      : !/\bgrn\b/.test(c.ck || '') ? 'GRN not yet swept — the crawl is still running'
      : 'every reachable pool checked — the real translation gap',
    // A group with NO ISO 639-3 code cannot be looked up in any pool at all — nothing was
    // searched because there was nothing to search WITH. Two blank cells would read as an
    // oversight; this says why. One row is in this state: Arab, Gazan, 2.33M people.
    checked_pools: c.ck || (code ? '' : 'no language code in the source — no lookup possible'),
    unchecked_pools: c.un || (code ? '' : 'no language code in the source — no lookup possible'),
    lat,
    lng,
  })
}
rows.sort((a, b) => b.population - a.population || a.people_group.localeCompare(b.people_group))

const people = rows.reduce((n, r) => n + r.population, 0)
const signRows = rows.filter((r) => r.sign_language).length
const doc = {
  meta: {
    title: 'Where Nothing Was Found',
    grain: 'one row per people group with no Scripture, film or Door43 resource in the pools this build checked',
    the_finding: `${rows.length.toLocaleString()} people groups, ${people.toLocaleString()} people. ${signRows} of them speak a sign language.`,
    not_proof_of_absence: 'ABSENT FROM THE POOLS CHECKED, never proof that nothing exists. Each row carries its own checked_pools and unchecked_pools so an exported copy cannot be read as a claim about the world.',
    audio_never_checked: 'AUDIO HAS NEVER BEEN SEARCHED FOR ANY GROUP ON THIS MAP. GRN is the main audio-gospel pool and needs credentials this build does not have, so for an oral culture the most relevant resource is the one pool nobody has looked in.',
    sign_languages: 'A sign language cannot be served by a text translation at all, so a text pool was never the right place to look for the rows flagged sign_language.',
    gap_kind_note: 'Four situations share this table and only the last is a translation problem. Sign language and private-use OVERLAP COMPLETELY here — every private-use code in this gap is a sign language — so filtering to gap_kind="sign language" alone understates the Deaf share; add the private-use rows to get the true figure. The "GRN not yet swept" rows will resolve themselves as the crawl proceeds and are not evidence of absence.',
    doctrine_boundary: 'Only sources publishing the 66-book canon are searched. Watchtower/JW, Seventh-day Adventist, LDS and other added-canon publishers are excluded by rule, which is why some languages they do publish in appear here.',
    no_believer_data: 'This table describes PUBLISHED RESOURCES only. It carries no church, believer or meeting-point data and must never gain any.',
  },
  columns: [
    { title: 'People group', field: 'people_group', type: 'string' },
    { title: 'Country', field: 'country', type: 'string' },
    { title: 'Language', field: 'language', type: 'string' },
    { title: 'ISO 639-3', field: 'iso639_3', type: 'string' },
    { title: 'Population', field: 'population', type: 'number' },
    { title: 'Sign language', field: 'sign_language', type: 'string' },
    { title: 'Kind of gap', field: 'gap_kind', type: 'string' },
    { title: 'Pools checked', field: 'checked_pools', type: 'string' },
    { title: 'Pools NOT checked', field: 'unchecked_pools', type: 'string' },
  ],
  rows,
}
writeFileSync(OUT, JSON.stringify(doc))
console.log(`rows ${rows.length}  people ${people.toLocaleString()}  sign-language rows ${signRows}`)
console.log(`wrote ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB)`)
