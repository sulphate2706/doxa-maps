#!/usr/bin/env node
/**
 * source-full-adm1.mjs — a COMPLETE ADM1 layer for one country, beside (never replacing) the curated file.
 *
 * WHY: the shipped boundaries/gb-IND-ADM1.geojson is UPG-100's 100-list PARTITION (34 of India's 36 units;
 * Mizoram and Nagaland excluded, and listId-tagged, see plugin-designs/my-upg-100-list/data/
 * source-boundaries.mjs). A map that colours EVERY state (Cities with Internet's NFHS-5 layer) had data for
 * 36 states and shapes for 34. This writes data/boundaries/gb-<ISO3>-ADM1-full.geojson, all units, from
 * geoBoundaries gbOpen, with the source and licence in a .meta.json beside it; generate-tree stages both.
 *
 * Schema { iso3, shapeGroup, shapeName, shapeISO } (the curated file's, minus the curation's listId).
 * Coordinates rounded to 3 decimals (~110 m, far finer than a state choropleth needs) and consecutive
 * duplicate points dropped, to keep the served file small.
 *
 * USAGE  node library/scripts/boundaries/source-full-adm1.mjs [ISO3=IND]      (network, build time only)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const ISO3 = (process.argv[2] || 'IND').toUpperCase()
const API = `https://www.geoboundaries.org/api/current/gbOpen/${ISO3}/ADM1/`

const meta = await (await fetch(API)).json()
const url = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL
const src = await (await fetch(url)).json()

const r = (n) => Math.round(n * 1000) / 1000
const ring = (pts) => {
  const out = []
  for (const [x, y] of pts) { const p = [r(x), r(y)]; const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p) }
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0].slice())
  return out.length >= 4 ? out : null
}
const poly = (rings) => { const rs = rings.map(ring).filter(Boolean); return rs.length ? rs : null }
const geom = (g) => {
  if (g.type === 'Polygon') { const p = poly(g.coordinates); return p && { type: 'Polygon', coordinates: p } }
  const ps = g.coordinates.map(poly).filter(Boolean)
  return ps.length ? { type: 'MultiPolygon', coordinates: ps } : null
}
const features = []
for (const f of src.features) {
  const g = geom(f.geometry)
  if (!g) throw new Error(`${f.properties.shapeName}: geometry vanished when rounded`)
  features.push({ type: 'Feature', properties: { iso3: ISO3, shapeGroup: f.properties.shapeGroup || ISO3, shapeName: f.properties.shapeName, shapeISO: f.properties.shapeISO || '' }, geometry: g })
}
if (String(features.length) !== String(meta.admUnitCount)) throw new Error(`expected ${meta.admUnitCount} units, got ${features.length}`)

const dir = resolve(ROOT, 'data/boundaries'); mkdirSync(dir, { recursive: true })
const out = resolve(dir, `gb-${ISO3}-ADM1-full.geojson`)
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }))
writeFileSync(resolve(dir, `gb-${ISO3}-ADM1-full.meta.json`), JSON.stringify({
  file: `gb-${ISO3}-ADM1-full.geojson`, units: features.length,
  source: 'geoBoundaries gbOpen (www.geoboundaries.org)', boundaryID: meta.boundaryID,
  boundarySource: meta.boundarySource, licence: meta.boundaryLicense, licenceSource: meta.licenseSource,
  yearRepresented: meta.boundaryYearRepresented, sourceUpdated: meta.sourceDataUpdateDate, fetchedFrom: url,
  processing: 'coordinates rounded to 3 decimals, consecutive duplicate points dropped (library/scripts/boundaries/source-full-adm1.mjs)',
  note: 'Complete ADM1. The curated gb-' + ISO3 + '-ADM1.geojson (the 100-list partition, listId-tagged) is a different file and is not replaced.',
}, null, 2) + '\n')
console.log(`${out}: ${features.length} units`)
