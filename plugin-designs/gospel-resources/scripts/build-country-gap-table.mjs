#!/usr/bin/env node
/**
 * build-country-gap-table.mjs — the country aggregate as an exportable table.
 *
 * WHY. gospel-by-country now carries 242 countries with real per-country counts, and the
 * map uses them for the choropleth and the "where the gap concentrates" sheet. But the
 * tables profile had no country table at all, so those numbers existed only inside the map
 * — readable, not exportable. A mobiliser deciding where to send a team cannot work from a
 * sheet they have to screenshot; the other seven tabs all offer CSV and JSON.
 *
 * It is DERIVED, not a second source. Every row is read out of gospel-by-country.json,
 * which is itself refreshed from the pin index, so this cannot drift from the map: the
 * coverage gate's clause C recomputes reach off the pins and would catch it if it did.
 *
 * WHAT THE COLUMNS SAY. Three different questions, because they disagree and each is
 * somebody's: how many groups have nothing (send translators), how many PEOPLE those are
 * (send broadcasters), and what SHARE of the country that is (Oceania is half unreached by
 * group and tiny by population). The curated columns are carried through as-is and left
 * null where this build does not know them — null, never zero, which would be a claim.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const SRC = resolve(REPO, 'data/tables/gospel-by-country.json')
const PINS = resolve(REPO, 'data/tables/people-group-pins.json')
const OUT = resolve(REPO, 'data/tables/country-gap.json')

const src = JSON.parse(readFileSync(SRC, 'utf8'))
const rows = (src.countries || [])
  .filter((c) => c.groups > 0)
  .map((c) => ({
    country: c.country || c.iso3,
    iso3: c.iso3,
    region: c.region || '',
    people_groups: c.groups,
    groups_with_nothing: c.no_resource,
    pct_with_nothing: c.pct_no_resource,
    people_with_nothing: c.pop_no_resource,
    groups_with_scripture: c.scripture,
    groups_with_film: c.film,
    band: c.band,
    growing_unreached: c.growing_unreached === undefined ? null : c.growing_unreached,
    deaths_day: c.deaths_day === undefined ? null : c.deaths_day,
    basis: c.from_pins_only ? 'pins only — no curated country analysis for this country' : 'pins, with curated country analysis',
  }))
  .sort((a, b) => b.groups_with_nothing - a.groups_with_nothing || b.people_with_nothing - a.people_with_nothing)

const columns = [
  { title: 'Country', field: 'country', type: 'string' },
  { title: 'ISO3', field: 'iso3', type: 'string' },
  { title: 'Region', field: 'region', type: 'string' },
  { title: 'People groups', field: 'people_groups', type: 'number' },
  { title: 'Groups with nothing', field: 'groups_with_nothing', type: 'number' },
  { title: '% with nothing', field: 'pct_with_nothing', type: 'number' },
  { title: 'People with nothing', field: 'people_with_nothing', type: 'number' },
  { title: 'Groups with Scripture', field: 'groups_with_scripture', type: 'number' },
  { title: 'Groups with film', field: 'groups_with_film', type: 'number' },
  { title: 'Band', field: 'band', type: 'string' },
  { title: 'Growing & unreached', field: 'growing_unreached', type: 'number' },
  { title: 'Est. deaths/day', field: 'deaths_day', type: 'number' },
  { title: 'Basis', field: 'basis', type: 'string' },
]

const tot = rows.reduce((a, r) => a + r.groups_with_nothing, 0)
const pop = rows.reduce((a, r) => a + r.people_with_nothing, 0)

/**
 * THIS TABLE IS ONE REFRESH BEHIND UNLESS SOMEBODY RUNS TWO SCRIPTS IN THE RIGHT ORDER.
 *
 * The counts above come from gospel-by-country.json, which does not compute them: it is
 * REFRESHED from the pin index by refresh-country-bands.mjs. So the chain is
 *     build-people-group-pins -> refresh-country-bands -> this script
 * and running this one before the refresh silently publishes the previous build's numbers.
 * Measured the day the GRN sweep finished: the pin index said 1,613 groups with nothing and
 * this table said 1,653 — the exact 40 groups the last batch had just lifted out of the gap,
 * still being counted as having nothing, on a table whose whole purpose is deciding where to
 * send people. Nothing failed. The snapshot guard was happy, because the ROW COUNT was right.
 *
 * An ordering rule that lives in someone's head is not a rule. The totals are derived from
 * the same pins either way, so they must match exactly, and a mismatch is always the stale
 * read rather than a real disagreement — which is why this aborts instead of warning.
 */
{
  const { pins } = JSON.parse(readFileSync(PINS, 'utf8'))
  const none = pins.filter((p) => p[6] === 0)
  const pinGroups = none.length
  const pinPeople = none.reduce((n, p) => n + (p[5] || 0), 0)
  if (pinGroups !== tot || pinPeople !== pop) {
    console.error('COUNTRY-GAP: ABORT — this table disagrees with the index the map draws.')
    console.error(`  pin index:   ${pinGroups.toLocaleString()} groups · ${pinPeople.toLocaleString()} people with nothing`)
    console.error(`  this table:  ${tot.toLocaleString()} groups · ${pop.toLocaleString()} people`)
    console.error('  gospel-by-country.json is stale. Run refresh-country-bands.mjs first —')
    console.error('  it is what carries the pin index into the source this reads.')
    process.exit(1)
  }
}
const byRegion = {}
for (const r of rows) {
  const e = (byRegion[r.region || '—'] ||= { groups: 0, none: 0 })
  e.groups += r.people_groups
  e.none += r.groups_with_nothing
}
const regionLine = Object.entries(byRegion)
  .map(([k, v]) => [k, v, v.groups ? (100 * v.none) / v.groups : 0])
  .sort((a, b) => b[2] - a[2])
  .map(([k, v, p]) => `${k} ${p.toFixed(1)}% (${v.none} of ${v.groups})`)
  .join(' · ')

writeSnapshot(
  OUT,
  `${JSON.stringify({
    columns,
    meta: {
      title: 'The gap by country',
      grain: 'one row per country that has at least one people group on this map',
      generated: new Date().toISOString().slice(0, 10),
      measured: `${rows.length} countries · ${tot.toLocaleString()} groups with nothing found · ${pop.toLocaleString()} people`,
      by_region: regionLine,
      three_questions: 'Groups with nothing, people with nothing, and the share of the country each represents. They rank differently on purpose — Papua New Guinea has the most groups and few people, China the reverse, and Oceania has the worst share of any region while being the smallest by population.',
      source: 'data/tables/gospel-by-country.json, which is itself refreshed from data/tables/people-group-pins.json — the same index the map draws, so this table and the map cannot disagree.',
      curated_columns: 'growing_unreached and deaths_day come from the curated country analysis and are null where it does not cover the country. Null, never zero: zero is a claim this build cannot make.',
    },
    rows,
  }, null, 1)}\n`,
  (j) => (j.rows || []).length,
  'country-gap rows',
)
console.log(`country-gap: ${rows.length} countries · ${tot.toLocaleString()} groups with nothing · ${pop.toLocaleString()} people`)
console.log(`  by region: ${regionLine}`)
