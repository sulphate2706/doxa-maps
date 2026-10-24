#!/usr/bin/env node
/**
 * refresh-country-bands.mjs — recolour the choropleth from the pins it is drawn under.
 *
 * THE CONTRADICTION. gospel-by-country supplies `band` and `no_resource`, which fill every
 * country polygon on the map. Those were computed on 2026-08-01 over the curated
 * 2,106-record set. The pins drawn ON TOP of that fill come from the 12,379-pin index. The
 * two disagreed for 135 of 170 countries, and the worst cases are not close:
 *
 *   PNG  coloured "critical" from ONE curated group, under 831 pins (56.4% bare -> high)
 *   USA  coloured "covered" from three groups, under 623 pins (7.1% bare -> partial)
 *   PHL  coloured "covered" from one group, under 156 pins (17.9% bare -> partial)
 *   IDN  "critical" from 36 groups, under 669 pins (48.0% -> high)
 *
 * A reader sees the colour first and the dots second. Telling them a country is covered
 * while plotting bare groups across it, or critical on the evidence of a single group, is
 * the map arguing with itself — and the fill is the louder half.
 *
 * WHAT IS REFRESHED: groups, no_resource, pop_no_resource, scripture, film, pct_no_resource
 * and band — everything the pins are authoritative for, under the SAME band rule as before
 * (critical >=60%, high >=30%, partial >0, covered 0).
 *
 * WHAT IS KEPT: growing_unreached, deaths_day and growth come from the curated country
 * analysis over a narrower set and cannot be derived from the pins. The country sheet
 * already labels them as coming from a different basis, so they stay exactly as they are.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSnapshot } from './_snapshot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/tables/gospel-by-country.json')

const pins = JSON.parse(readFileSync(resolve(REPO, 'data/tables/people-group-pins.json'), 'utf8'))
const j = JSON.parse(readFileSync(OUT, 'utf8'))

// Real names, from the same source the pins are built from. A row labelled "CAN" would
// render "CAN" as the country sheet's title; people-groups-slim carries CountryName and
// UNm49Region per group, so there is no reason to show a code.
const M49 = { 2: 'Africa', 9: 'Oceania', 19: 'Americas', 142: 'Asia', 150: 'Europe' }
const nameOf = {}
const regionOf = {}
try {
  const raw = JSON.parse(readFileSync(resolve(REPO, 'data/people-groups/people-groups-slim.json'), 'utf8'))
  const rows = Array.isArray(raw) ? raw : Object.values(raw).find(Array.isArray)
  for (const r of rows || []) {
    const i = r.ISOAlpha3
    if (!i) continue
    if (!nameOf[i] && r.CountryName) nameOf[i] = String(r.CountryName).trim()
    // UNm49Region is a NUMERIC code, and the five that appear are exactly the UN M49
    // top-level regions. Verified before trusting it: only 2/9/19/142/150 occur, every
    // country maps to exactly ONE of them (0 conflicts across 12,379 groups), and the five
    // sum to 12,379 — the whole corpus. So the code is resolvable to a real name, and "19"
    // on its own is not.
    if (!regionOf[i] && r.UNm49Region) regionOf[i] = M49[String(r.UNm49Region).trim()] || ''
  }
} catch { /* names are a nicety; the bands are the point */ }

const agg = {}
for (const [, , , iso3, code, pop, tier] of pins.pins) {
  if (!iso3) continue
  const e = (agg[iso3] = agg[iso3] || { groups: 0, none: 0, popNone: 0, scripture: 0, film: 0 })
  const v = pins.codes[code] || {}
  e.groups++
  if (tier === 0) { e.none++; e.popNone += pop || 0 }
  // Text Scripture from any checked pool, matching what the country sheet counts.
  if (v.s || (v.au && /text/.test(v.au.m || ''))) e.scripture++
  if (v.f) e.film++
}

const band = (p) => (p >= 60 ? 'critical' : p >= 30 ? 'high' : p > 0 ? 'partial' : 'covered')

// ═══ COUNTRIES THE PINS TOUCH BUT THE TABLE NEVER HAD ═════════════════════════════════
// The first version of this script only UPDATED rows that already existed, and the table
// came from the curated 2,106-record set. So 60 countries carrying pins had no row at all
// and could never be coloured — 150 groups with nothing found, invisible to the country
// view. Canada 20, Ghana 15, Timor-Leste 13, Australia 7.
// They are added with the pin-derived fields only. The curated columns are set to null
// rather than zero: this build does not know a growth rate for them, and zero is a claim.
const known = new Set(j.countries.map((c) => c.iso3))
let added = 0
for (const [iso3, e] of Object.entries(agg)) {
  if (known.has(iso3) || !e.groups) continue
  j.countries.push({
    iso3,
    country: nameOf[iso3] || iso3,
    region: regionOf[iso3] || '',
    groups: 0, no_resource: 0, pop_no_resource: 0, scripture: 0, film: 0,
    growing_unreached: null, deaths_day: null, growth: null, curated_groups: null,
    pct_no_resource: 0, band: 'covered',
    from_pins_only: true,
  })
  added++
}

let moved = 0, missing = 0
for (const c of j.countries) {
  const e = agg[c.iso3]
  if (!e || !e.groups) { missing++; continue }
  const pct = Math.round((1000 * e.none) / e.groups) / 10
  const b = band(pct)
  if (c.band !== b) moved++
  /* THE CURATED BASIS MUST SURVIVE THIS LINE.
   *
   * `groups` arrives from the curated country analysis and is overwritten here with the pin
   * count, which is correct — the map draws pins, and the band must agree with them. What
   * was NOT correct is that the curated number was simply lost, and the country sheet went
   * on reading `groups` to tell the reader how much narrower the curated basis was. After
   * this line the two are equal by construction, so that sentence read "covers 391 of these
   * 391 groups — a narrower set than the pins" for all 242 countries. Always false, and
   * false about the one thing it existed to qualify.
   *
   * The real numbers were recoverable from the commit that introduced this overwrite
   * (China 158 of 391, India 856 of 2,146) and are restored on the rows. Recorded once and
   * never touched again: the pins change every build, the curated analysis does not. */
  if (c.curated_groups === undefined) {
    /* Only where a curated row actually exists. A first pass backfilled this from c.groups
     * unconditionally and handed the 72 countries with NO curated analysis a basis equal to
     * their pin count — inventing the very number the footnote is there to qualify. null
     * means "there is no curated set here", and the sheet hides the two figures for it. */
    c.curated_groups = c.growing_unreached != null || c.deaths_day != null ? c.groups : null
  }
  c.groups = e.groups
  c.no_resource = e.none
  c.pop_no_resource = e.popNone
  c.scripture = e.scripture
  c.film = e.film
  c.pct_no_resource = pct
  c.band = b
  // Backfilled on every row, not only new ones: region was empty on all 170 originals.
  if (!c.region && regionOf[c.iso3]) c.region = regionOf[c.iso3]
}

j.stats = {
  ...(j.stats || {}),
  refreshed: new Date().toISOString().slice(0, 10),
  basis: 'data/tables/people-group-pins.json — the same index the pins are drawn from, so the fill and the dots cannot disagree.',
  caveat: 'NO RESOURCE means not found in the pools checked — eBible, PNG.Bible, Arclight/JESUS Film, Door43 and Faith Comes By Hearing. GRN audio, api.bible, DBL and progress.bible are unchecked; absence here is never proof that nothing exists.',
  curated_columns: 'growing_unreached, deaths_day and growth come from the curated country analysis over a narrower set and are NOT derived from the pins. A row flagged from_pins_only carries null for all three, because this build does not know them — null, never zero, which would be a claim.',
}

writeSnapshot(OUT, `${JSON.stringify(j, null, 1)}\n`, (x) => (x.countries || []).length, 'countries')
console.log(`COUNTRY-BANDS: ${j.countries.length} countries, ${added} newly added from the pins, ${moved} changed band, ${missing} had no pins and were left alone.`)
