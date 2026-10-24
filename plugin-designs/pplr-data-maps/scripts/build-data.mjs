#!/usr/bin/env node
/**
 * build-data.mjs — derives data/pplr/* from the PPLR-validate-data source's assets/data/.
 *
 * The source ships 78 MB of data (pg-points.geojson 23 MB, pg-names.jsonl 56 MB). The maps need
 * far less, so this writes what they read:
 *
 *   pg-points.json   every PG-in-country pin, WITHOUT the 17 n_* locale names, coords at 4 dp
 *   pg-names.json    { code: [17 locale names in LOCALES order] }, fetched only when a pin opens
 *   coverage.json    { iso3: { pgCount, localeSum } } over ALL aROP3ByCountry rows (the original
 *                    streamed a 6,000-row sample of pg-names.jsonl in the browser)
 *   rop-tree.json, pplr-geoid-family.json, rosetta-sample.json   copied as-is
 *
 * Usage: PPLR_SRC=<path to PPLR-validate-data-mfe> node plugin-designs/pplr-data-maps/scripts/build-data.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCALES = ['en','hi','bn','ar','zh_TW','fr','ru','ne','pt','es','ko','tl','zh_CN','id','gu','am','de']
const SRC = process.env.PPLR_SRC
if (!SRC) { console.error('set PPLR_SRC to the PPLR-validate-data-mfe folder'); process.exit(2) }
const IN = join(SRC, 'assets', 'data')
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'pplr')
mkdirSync(OUT, { recursive: true })

const round = (n) => Math.round(n * 1e4) / 1e4
const pts = JSON.parse(readFileSync(join(IN, 'pg-points.geojson'), 'utf8'))
const names = {}
const slim = pts.features.map((f) => {
  const props = {}
  for (const [k, v] of Object.entries(f.properties)) if (!k.startsWith('n_')) props[k] = v
  names[f.properties.code] = LOCALES.map((l) => f.properties['n_' + l] || '')
  return { type: 'Feature', geometry: { type: 'Point', coordinates: f.geometry.coordinates.map(round) }, properties: props }
})
writeFileSync(join(OUT, 'pg-points.json'), JSON.stringify({ type: 'FeatureCollection', features: slim }))
writeFileSync(join(OUT, 'pg-names.json'), JSON.stringify({ locales: LOCALES, names }))

const coverage = {}
const rl = createInterface({ input: createReadStream(join(IN, 'pg-names.jsonl')), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  let o
  try { o = JSON.parse(line) } catch { continue }
  if (o.source !== 'aROP3ByCountry' || !o.country) continue
  const s = coverage[o.country] || (coverage[o.country] = { pgCount: 0, localeSum: 0 })
  s.pgCount++
  for (const l of LOCALES) if (o['name_' + l]) s.localeSum++
}
writeFileSync(join(OUT, 'coverage.json'), JSON.stringify(coverage))

for (const f of ['rop-tree.json', 'pplr-geoid-family.json', 'rosetta-sample.json']) copyFileSync(join(IN, f), join(OUT, f))
console.log(`[pplr] ${slim.length} pins, ${Object.keys(names).length} name rows, ${Object.keys(coverage).length} countries → ${OUT}`)
