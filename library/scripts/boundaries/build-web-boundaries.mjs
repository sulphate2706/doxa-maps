#!/usr/bin/env node
/**
 * build-web-boundaries.mjs — the INTERACTIVE-map copies of the boundary files: small enough to parse
 * fast, with every feature, every island and every property kept.
 *
 *   node library/scripts/boundaries/build-web-boundaries.mjs
 *
 * WHY. ~3.6 MB of boundary GeoJSON was measured (world-adm0 1.9 MB, gb-IND-ADM1 1.6 MB) costing
 * 5–6 s of MapLibre worker parsing before the first territory draws, on every page of every
 * partner site. A web map drawn at zoom 1–7 needs a fraction of those vertices. The FULL files stay
 * as they are: posters and print use them, and so does every build-time point-in-polygon.
 *
 * HOW (mapshaper, pinned below; fetched with npx, it is not a repo dependency):
 *   -explode        split each multi-part feature into its parts, so every island is its own shape
 *   -simplify visvalingam weighted percentage=P keep-shapes
 *                   topology-preserving (shared borders stay shared); keep-shapes stops any shape
 *                   from vanishing, which, after the explode, means no island is ever dropped
 *                   (without the explode, keep-shapes guards only whole features: 572 parts -> 240)
 *   -dissolve KEY copy-fields=...   put each feature back together, same properties
 *   precision=0.0001                ~11 m, far below a pixel at the zooms these files are drawn at
 *
 * VALIDATED, the run FAILS otherwise: the same feature count, the same keys, the same polygon-part
 * count (no dropped island), and the same property names and values on every feature.
 * MEASURED: the world file goes from 1,866 KB to 383 KB (134 KB gzipped) with all 162 features and all
 * 572 polygon parts; India's from 1,796 KB to 227 KB with all 36 and all 452. A second run writes
 * identical bytes.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const MAPSHAPER = 'mapshaper@0.6.121'
const UPG = 'plugin-designs/my-upg-100-list/data'
const JOBS = [
  // src, out, dissolve key, the other properties, simplification percentage
  { src: `${UPG}/adm0/world-adm0.geojson`, out: `${UPG}/adm0/world-adm0-web.geojson`, key: 'iso3', copy: ['shapeGroup', 'shapeName'], pct: '8%' },
  { src: 'data/boundaries/gb-IND-ADM1-full.geojson', out: 'data/boundaries/gb-IND-ADM1-full-web.geojson', key: 'shapeName', copy: ['iso3', 'shapeGroup', 'shapeISO'], pct: '10%' },
  // UPG-100's curated partition: `listId` is load-bearing (zone-geometry.js), so it must survive.
  { src: `${UPG}/gb-IND-ADM1.geojson`, out: `${UPG}/gb-IND-ADM1-web.geojson`, key: 'shapeName', copy: ['iso3', 'shapeGroup', 'listId'], pct: '10%' },
  // gb-CHN-ADM1.geojson is 56 KB (12 provinces): already web-sized, no copy made.
]

const fail = (m) => { console.error('build-web-boundaries: FAIL — ' + m); process.exit(1) }
const parts = (fc) => fc.features.reduce((t, f) => t + (f.geometry.type === 'Polygon' ? 1 : f.geometry.coordinates.length), 0)

for (const j of JOBS) {
  const src = join(ROOT, j.src), out = join(ROOT, j.out)
  execFileSync('npx', ['--yes', MAPSHAPER, src, '-explode',
    '-simplify', 'visvalingam', 'weighted', `percentage=${j.pct}`, 'keep-shapes',
    '-dissolve', j.key, `copy-fields=${j.copy.join(',')}`,
    '-o', out, 'format=geojson', 'precision=0.0001'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const a = JSON.parse(readFileSync(src, 'utf8')), b = JSON.parse(readFileSync(out, 'utf8'))
  if (a.features.length !== b.features.length) fail(`${j.out}: ${b.features.length} features, source has ${a.features.length}`)
  const byKey = new Map(b.features.map((f) => [f.properties[j.key], f]))
  for (const f of a.features) {
    const g = byKey.get(f.properties[j.key])
    if (!g) fail(`${j.out}: lost ${j.key}=${f.properties[j.key]}`)
    for (const [k, v] of Object.entries(f.properties)) if (g.properties[k] !== v) fail(`${j.out}: ${f.properties[j.key]}.${k} is ${JSON.stringify(g.properties[k])}, source ${JSON.stringify(v)}`)
  }
  if (parts(a) !== parts(b)) fail(`${j.out}: ${parts(b)} polygon parts, source has ${parts(a)} (an island was dropped)`)
  const kb = (p) => Math.round(statSync(p).size / 1024)
  console.log(`${j.out}: ${kb(src)} KB -> ${kb(out)} KB · ${b.features.length} features · ${parts(b)} parts · properties identical`)
}
