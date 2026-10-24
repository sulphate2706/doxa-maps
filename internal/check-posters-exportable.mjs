#!/usr/bin/env node
// check-posters-exportable — every poster a reader can ask for ships in a printable form.
//
// ★ THE DEFECT (2026-09-29). With posterSources on, the tree shipped only the 28 zone sources.
// The 176 city-* and 174 country-* posters have no source, so their export said "poster not
// found (404)": 350 of 378 posters could not be printed. generate-tree now ships each poster
// ONCE in its lightest printable form, the .html source where one exists, else the .webp.
// This gate keeps it that way.
//
// With posterSources or bundlePosters on, every poster id (from data/posters, and every wall
// card in the tree's previews/) must have, in <tree>/assets/posters:
//   <id>.webp  that really is a WebP (RIFF....WEBP), or
//   <id>.html  that really is a poster source (its `class="stage"` element),
// so a placeholder or a host's fallback page cannot pass for one.
// With both off, posters are not shipped on purpose and export refuses honestly: SKIP
// (check:poster-degrades covers that case).
//
// Static: reads files, starts nothing. Exit 0 pass or skip, 1 fail.
import { existsSync, openSync, readSync, closeSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cfg = JSON.parse(readFileSync(join(REPO, 'vite.doxa-maps-build-config.json'), 'utf8'))
if (cfg.posterSources !== true && cfg.bundlePosters !== true) {
  console.log('POSTERS-EXPORTABLE: SKIP — posterSources and bundlePosters are off, so posters are not shipped (export refuses honestly)')
  process.exit(0)
}

const assets = join(REPO, 'public', TREE_NAME, 'assets')
const posters = join(assets, 'posters')
if (!existsSync(posters)) {
  console.error(`POSTERS-EXPORTABLE: FAIL — ${posters} is missing; run \`bun run tree\``)
  process.exit(1)
}

const stem = (f) => f.replace(/\.(webp|html)$/, '')
const ids = new Set(readdirSync(join(REPO, 'data', 'posters')).filter((f) => /\.(webp|html)$/.test(f)).map(stem))
const previews = join(assets, 'previews')
if (existsSync(previews)) for (const f of readdirSync(previews)) if (f.endsWith('.webp')) ids.add(stem(f))

const isWebp = (path) => {
  const fd = openSync(path, 'r')
  const b = Buffer.alloc(12)
  try { readSync(fd, b, 0, 12, 0) } finally { closeSync(fd) }
  return b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'
}
const isSource = (path) => readFileSync(path, 'utf8').includes('class="stage"')

const missing = []
const bad = []
let webp = 0
let html = 0
for (const id of [...ids].sort()) {
  const w = join(posters, `${id}.webp`)
  const h = join(posters, `${id}.html`)
  if (existsSync(w)) { if (isWebp(w)) { webp += 1; continue } bad.push(`${id}.webp is not a WebP image`) }
  if (existsSync(h)) { if (isSource(h)) { html += 1; continue } bad.push(`${id}.html is not a poster source (no class="stage")`) }
  if (!existsSync(w) && !existsSync(h)) missing.push(id)
}

if (missing.length || bad.length) {
  console.error(`POSTERS-EXPORTABLE: FAIL — ${missing.length} poster(s) with nothing printable, ${bad.length} not what they claim, of ${ids.size}`)
  for (const id of missing.slice(0, 20)) console.error(`  missing  ${id} (neither .webp nor .html in ${TREE_NAME}/assets/posters)`)
  for (const b of bad.slice(0, 20)) console.error(`  bad      ${b}`)
  process.exit(1)
}
console.log(`POSTERS-EXPORTABLE: PASS — all ${ids.size} posters print: ${html} from their source (.html), ${webp} from a raster (.webp)`)
