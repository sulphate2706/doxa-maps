#!/usr/bin/env node
/**
 * build-points.mjs — the COMPACT point file All People Groups renders from.
 *
 *   node library/scripts/people-groups/build-points.mjs
 *   reads  data/people-groups/people-groups-slim.json   (12,379 rows × 22 keys, ~7.5 MB)
 *   writes data/people-groups/people-groups-points.json (only the 10 fields the map uses)
 *
 * WHY. The map downloaded and parsed the whole slim file — every column, as one object per row — to
 * draw ten fields. That, plus waiting on the live prayer API before drawing anything, is most of why
 * the map seemed not to load at all, or took a very long time. This file keeps the same rows and
 * values in column order, with the repetitive strings (country, religion, evangelical level,
 * language) stored once in dictionaries and referenced by index, and coordinates at 3 decimals
 * (~100 m, far below a pin's size at any zoom this map shows).
 *
 * Deterministic: same input, byte-identical output. Re-run after refreshing the slim file.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SRC = resolve(ROOT, 'data/people-groups/people-groups-slim.json')
const OUT = resolve(ROOT, 'data/people-groups/people-groups-points.json')

const slim = JSON.parse(readFileSync(SRC, 'utf8'))
const dicts = { country: [], religion: [], evangelical: [], language: [] }
const idx = { country: new Map(), religion: new Map(), evangelical: new Map(), language: new Map() }
const ref = (k, v) => { const s = String(v || ''); let i = idx[k].get(s); if (i === undefined) { i = dicts[k].length; dicts[k].push(s); idx[k].set(s, i) } return i }
const r3 = (x) => Math.round(Number(x) * 1000) / 1000

const rows = []
for (const r of slim.rows || []) {
  const lat = Number(r.Lat), lng = Number(r.Long)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue
  rows.push([
    r3(lng), r3(lat),
    r.GSEC === '' || r.GSEC == null ? null : Number(r.GSEC),
    String(r.ROP3Code || ''),
    String(r.Name || ''),
    ref('country', r.CountryName),
    Number(r.Population) || 0,
    ref('language', r.LanguageName),
    ref('religion', r.ReligionName),
    ref('evangelical', r.EvangelicalLevel),
  ])
}
const out = {
  meta: { ...(slim.meta || {}), derivedFrom: 'people-groups-slim.json via library/scripts/people-groups/build-points.mjs', rows: rows.length },
  cols: ['lng', 'lat', 'gsec', 'rop3', 'name', 'country', 'population', 'language', 'religion', 'evangelical'],
  dicts,
  rows,
}
writeFileSync(OUT, JSON.stringify(out))
console.log(`people-groups-points.json: ${rows.length} rows, ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB`)
