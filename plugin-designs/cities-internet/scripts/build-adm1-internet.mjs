#!/usr/bin/env node
/**
 * build-adm1-internet.mjs — internet use by first-level administrative area (ADM1), from data.
 *
 *   node plugin-designs/cities-internet/scripts/build-adm1-internet.mjs
 *
 * READS   data/internet/nfhs5-internet-by-state.csv   India, NFHS-5 2019–21 (see data/internet/README.md)
 *         data/internet/adm1-crosswalk-IND.json       source names -> boundary shapeName (strict)
 *         data/boundaries/gb-IND-ADM1-full.geojson  the boundary file the map draws (all 36)
 * WRITES  data/tables/internet-by-adm1.json           served as assets/tables/internet-by-adm1.json
 *
 * THE TABLE IS GENERIC ON PURPOSE (other plugins reuse it). One row per
 * (iso3, adm1, measure, sex, area): no India-specific shape, so a second country or a second
 * measure is more rows, not a new format. `meta.boundaries[iso3]` names the geometry file and the
 * property its `adm1` joins on; `meta.measures` and `meta.sources` say what each number is.
 *
 * STRICT. The run FAILS when a source name is missing from the crosswalk, when a crosswalk target
 * is not a shapeName in the boundary file, or when a value is not a number in 0–100. A name is
 * never guessed. Source rows that have no geometry (crosswalk `adm1: null`) are KEPT, keyed by
 * their source name, and listed in meta.boundaries[iso3].missing, so nothing is silently dropped.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CSV = join(ROOT, 'data/internet/nfhs5-internet-by-state.csv')
const CROSSWALK = join(ROOT, 'data/internet/adm1-crosswalk-IND.json')
const BOUNDARY = join(ROOT, 'data/boundaries/gb-IND-ADM1-full.geojson')
const OUT = join(ROOT, 'data/tables/internet-by-adm1.json')

const fail = (msg) => { console.error('build-adm1-internet: FAIL — ' + msg); process.exit(1) }

// A quoted-field CSV reader (the NFHS file quotes names that contain commas).
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else if (c !== '\r') f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  const head = rows.shift()
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

const src = parseCsv(readFileSync(CSV, 'utf8'))
const crosswalk = JSON.parse(readFileSync(CROSSWALK, 'utf8')).map
const shapeNames = new Set(JSON.parse(readFileSync(BOUNDARY, 'utf8')).features.map((f) => f.properties.shapeName))

const SEX = { 'Women who have ever used the internet (%)': 'women', 'Men who have ever used the internet (%)': 'men' }
const AREAS = { total: 'nfhs5_total', urban: 'nfhs5_urban', rural: 'nfhs5_rural' }

const rows = []
const national = []
const missing = new Set()
for (const r of src) {
  const sex = SEX[r.indicator.replace(/^\d+\.\s*/, '')]
  if (!sex) fail(`unexpected indicator "${r.indicator}"`)
  const cw = crosswalk[r.state]
  if (!cw) fail(`"${r.state}" is not in data/internet/adm1-crosswalk-IND.json`)
  if (cw.adm1 && !shapeNames.has(cw.adm1)) fail(`crosswalk maps "${r.state}" to "${cw.adm1}", which is not a shapeName in gb-IND-ADM1-full.geojson`)
  if (!cw.adm1 && !cw.reason) fail(`crosswalk entry for "${r.state}" has no adm1 and no reason`)
  for (const [area, col] of Object.entries(AREAS)) {
    const raw = String(r[col] ?? '').trim()
    if (raw === '' || raw === '*' || raw === 'na') continue      // not reported for this cell
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || value > 100) fail(`"${r.state}" ${sex} ${area}: "${raw}" is not a share in 0–100`)
    const row = { iso3: 'IND', measure: 'ever_used_internet', sex, area, value, source: 'nfhs5', year: '2019-21' }
    if (cw.national) { national.push(row); continue }
    if (!cw.adm1) missing.add(r.state)
    rows.push({ ...row, adm1: cw.adm1 || null, adm1_name: r.state })
  }
}
if (!rows.length) fail('no rows (vacuous run)')

const out = {
  meta: {
    title: 'Internet use by first-level administrative area',
    grain: 'one row per iso3 x adm1 x measure x sex x area',
    measures: {
      ever_used_internet: {
        label: 'Ever used the internet',
        unit: '%',
        population: 'people aged 15–49, women and men asked separately',
        note: 'A survey SHARE OF PEOPLE (0–100). Not a subscription count: never put it on one scale with subscriptions per 100.',
      },
    },
    sources: {
      nfhs5: {
        name: 'National Family Health Survey 5 (NFHS-5), IIPS / Ministry of Health and Family Welfare, India',
        year: '2019-21',
        url: 'http://rchiips.org/nfhs/',
        via: 'https://github.com/pratapvardhan/NFHS-5 (CSV transcription of the state fact sheets)',
        licence: 'CC BY 4.0',
        attribution: 'NFHS-5 (IIPS/MoHFW) state fact sheets, via pratapvardhan/NFHS-5 (CC BY 4.0)',
      },
    },
    boundaries: {
      IND: {
        file: 'boundaries/gb-IND-ADM1-full.geojson',
        key: 'shapeName',
        licence: 'geoBoundaries gbOpen IND-ADM1-1811400 (DataMeet / ECI): CC BY 2.5 IN',
        missing: [...missing].sort(),
        missing_reason: 'no feature for it in the boundary file',
      },
    },
    national,
    generated_by: 'plugin-designs/cities-internet/scripts/build-adm1-internet.mjs',
  },
  rows,
}
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
const drawn = new Set(rows.filter((r) => r.adm1).map((r) => r.adm1)).size
console.log(`build-adm1-internet: ${rows.length} rows · IND ${drawn} ADM1 areas drawn · ${missing.size} without geometry (${[...missing].join(', ') || 'none'}) · national ${national.length} rows`)
