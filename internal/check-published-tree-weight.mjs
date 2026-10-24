#!/usr/bin/env node
/**
 * check-published-tree-weight — the tree we publish has a weight, and nothing was watching it.
 *
 * THE DEFECT THIS CATCHES. A publish was ALREADY BLOCKED ONCE at a 74MB asset tree (the git host
 * rejected the pack). Nothing has measured the tree since. MEASURED 2026-09-25: public/assets is
 * 134MB, against the 94MB recorded when BUILD-POSTERS-GENERATE-ON-DEMAND-DROP-52MB was written —
 * it grew 40MB, and no one noticed, because size is the classic property that only becomes visible
 * when something refuses to accept it.
 *
 * ★ IT REPORTS THE SPLIT, NOT JUST A TOTAL, because the total cannot be acted on. Measured today:
 *     posters   70MB   28 zone HTML sources 28MB + 28 zone rasters 5.8MB
 *                      + 176 city-* 23MB + 174 country-* 14MB
 *     tables    24MB
 *     people-groups 23MB
 *     previews  10MB
 *   The zone half is REPRODUCIBLE (generate.mjs is token-free and makes no network call). The 176
 *   city posters are NOT — they fetch OSM street tiles at generation time, so their .webp must not
 *   be deleted, and publish-html.mjs deliberately skips them. A gate that reported only "134MB"
 *   would invite deleting exactly the wrong half.
 *
 * ⚠ AND RAW SIZE IS NOT THE SHIPPING COST. publish-html.mjs measured it with real git packs:
 * swapping the 28 zone rasters (5.0MB raw, ~5.0MB packed — webp is already compressed and git
 * cannot pack it further) for their HTML sources (21.4MB raw, 5.78MB packed — repetitive text) is
 * about +0.8MB PACKED. A net LOSS. Its own comment says "do not ship that swap and call it a
 * saving". So this gate reports raw bytes as a TREND SIGNAL, and says plainly that a raw number is
 * not a packed number.
 *
 * Thresholds are a CEILING WITH HEADROOM, not today's value pinned: a gate that fails on the next
 * legitimate asset teaches people to raise the number rather than read it.
 *
 * Usage: node internal/check-published-tree-weight.mjs
 *   TREE_WEIGHT_MAX_MB=<n>  override the ceiling
 */
import { existsSync, statSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DOXA_REPO || resolve(HERE, '..')
// The published weight is the OUTPUT FOLDER's assets (public/ holds only the output folder since
// BUILD-OUTPUT-IS-ONE-FOLDER; the old web-root public/assets is gone).
const ASSETS = resolve(REPO, `public/${TREE_NAME}/assets`)

if (!existsSync(ASSETS)) {
  console.log(`TREE-WEIGHT: SKIP — no asset tree at ${ASSETS}`)
  process.exit(0)
}

const MB = 1024 * 1024
// 160MB against 134MB measured: ~20% headroom. Far above today, far below anything that would
// repeat the 74MB publish rejection by surprise.
const MAX_MB = Number(process.env.TREE_WEIGHT_MAX_MB || 160)

const dirSize = (dir) => {
  let total = 0
  const walk = (d) => {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      try { total += statSync(p).size } catch { /* raced away */ }
    }
  }
  walk(dir)
  return total
}

const top = readdirSync(ASSETS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ name: e.name, bytes: dirSize(join(ASSETS, e.name)) }))
  .sort((a, b) => b.bytes - a.bytes)

const total = top.reduce((s, d) => s + d.bytes, 0)
const mb = (b) => (b / MB).toFixed(1)

console.log('TREE-WEIGHT')
console.log(`  public/${TREE_NAME}/assets : ${mb(total)}MB  (ceiling ${MAX_MB}MB)`)
for (const d of top.slice(0, 6)) console.log(`    ${d.name.padEnd(14)} ${mb(d.bytes).padStart(6)}MB`)

// The posters split is the actionable part — see the header. Reported whenever it exists.
const posters = join(ASSETS, 'posters')
if (existsSync(posters)) {
  const files = readdirSync(posters)
  const bucket = (pred) => {
    let n = 0, b = 0
    for (const f of files) {
      if (!pred(f)) continue
      n++
      try { b += statSync(join(posters, f)).size } catch { /* raced away */ }
    }
    return { n, b }
  }
  const city = bucket((f) => /^city-/.test(f) && f.endsWith('.webp'))
  const country = bucket((f) => /^country-/.test(f) && f.endsWith('.webp'))
  const zoneRaster = bucket((f) => f.endsWith('.webp') && !/^(city|country)-/.test(f))
  const zoneSource = bucket((f) => f.endsWith('.html'))
  console.log('  posters split :')
  console.log(`    city-*.webp     ${String(city.n).padStart(4)} files ${mb(city.b).padStart(6)}MB  NOT reproducible (needs OSM tiles) — do not delete`)
  console.log(`    country-*.webp  ${String(country.n).padStart(4)} files ${mb(country.b).padStart(6)}MB`)
  console.log(`    zone *.webp     ${String(zoneRaster.n).padStart(4)} files ${mb(zoneRaster.b).padStart(6)}MB  reproducible`)
  console.log(`    zone *.html     ${String(zoneSource.n).padStart(4)} files ${mb(zoneSource.b).padStart(6)}MB  reproducible (the browser-rasterise fallback)`)
  console.log('    ⚠ raw bytes, NOT packed. publish-html.mjs measured the swap of zone rasters for')
  console.log('      their HTML sources at about +0.8MB PACKED — a net LOSS, because webp is already')
  console.log('      compressed and repetitive HTML packs well. Do not read a raw saving as a shipped one.')
}

if (total > MAX_MB * MB) {
  console.error(`\nTREE-WEIGHT: FAIL — public/${TREE_NAME}/assets is ${mb(total)}MB, over the ${MAX_MB}MB ceiling.`)
  console.error('  A publish was already blocked once at a 74MB asset tree (the git host rejected the pack),')
  console.error('  and nothing has measured it since; it grew from 94MB to 134MB unnoticed.')
  console.error('  Before deleting anything, read the split above: the city posters are the heavy half')
  console.error('  AND the half that cannot be regenerated. The reproducible half is worth less than')
  console.error('  its raw size suggests once packed.')
  process.exit(1)
}
console.log(`\nTREE-WEIGHT: PASS — ${mb(total)}MB of ${MAX_MB}MB. This is a RAW measurement of what we `
  + 'publish, not a packed one, and it is a trend signal rather than a shipping cost.')
