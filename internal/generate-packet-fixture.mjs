#!/usr/bin/env node
// generate-packet-fixture — a small COMMITTED records subset, so CI can build a packet.
//
// ★ WHY THIS EXISTS. library/scripts/posters/out/ is gitignored — both the records cache
// and every generated packet — so on a clean checkout check:packets-all finds nothing and
// SKIPs. MEASURED 2026-09-24: CI runs that sweep on every build through gates:post, and it
// has SKIPped every time. Every packet assertion in this tree — the 12 prayer points, the
// wheel's 12 labels, page 1's geography paths, the print layer, the build stamp — has never
// once been evaluated in CI. A SKIP that is always taken is indistinguishable from an
// unwired gate, and the wave-membership census cannot tell them apart because membership
// measures INVOCATION, not EVALUATION.
//
// ★ WHY A FIXTURE RATHER THAN A LIVE FETCH. Building a real packet needs 2,107 records
// (887KB, live data that goes stale) and, with photos, ~95 CDN requests. Neither belongs in
// every CI run. This carries ONE zone's records — the smallest, Tibet at 43 slugs, 20KB —
// with image_url stripped so it can never reach for a photo.
//
// ★ AND IT IS DERIVED, NOT HAND-MAINTAINED. Membership comes from clusters.json, which IS
// committed, so this can be regenerated and content-compared (check:packet-fixture) exactly
// like the capability-exemplar table. A fixture nobody can verify is a fixture that rots.
//
// ⚠ IT IS NOT A SUBSTITUTE FOR REAL PACKETS. PACKET_RECORDS is opt-in and never the default:
// a fixture packet proves the RENDERER and the GATE work end to end, not that today's live
// data is sound. The 11-locale sweep against real records stays the real verification.
//
// Usage: node internal/generate-packet-fixture.mjs [--check]
//   (reads the live records cache; run after a normal `node library/scripts/posters/packet.mjs`)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, 'library/scripts/posters/out/_records.json')
const CLUSTERS = join(ROOT, 'plugin-designs/my-upg-100-list/data/clusters.json')
const OUT_DIR = join(ROOT, 'library/scripts/posters/fixtures')
const OUT = join(OUT_DIR, 'records-tibet.json')
// The smallest zone by slug count, so the fixture stays small. Its membership lives in
// clusters.json; if that zone is ever renamed this script fails loudly rather than
// silently emitting an empty fixture.
const ZONE = 'asia-china-tibet-autonomous-region'

const CHECK = process.argv.includes('--check')

if (!existsSync(CLUSTERS)) {
  console.log('PACKET-FIXTURE: SKIP — no clusters.json.')
  process.exit(0)
}
const clusters = JSON.parse(readFileSync(CLUSTERS, 'utf8'))
const zones = [...(clusters.lists || []), ...(clusters.asia_lists || []), ...(clusters.uncovered_lists || [])]
const zone = zones.find((z) => z && z.id === ZONE)
if (!zone || !zone.selector || zone.selector.type !== 'pg_slugs') {
  console.error(`PACKET-FIXTURE: FAIL — ${ZONE} is not a pg_slugs zone in clusters.json.`)
  console.error('  The fixture is keyed to that zone; pick another and update ZONE here.')
  process.exit(1)
}
const want = new Set(zone.selector.values || [])

// ── CHECK MODE: the committed fixture must still match clusters.json ────────
if (CHECK) {
  if (!existsSync(OUT)) {
    console.error(`PACKET-FIXTURE: FAIL — ${OUT.slice(ROOT.length + 1)} does not exist.`)
    console.error('  Fix: node internal/generate-packet-fixture.mjs (then commit it)')
    process.exit(1)
  }
  const have = JSON.parse(readFileSync(OUT, 'utf8'))
  const haveSlugs = new Set(have.map((r) => r.slug))
  const missing = [...want].filter((s) => !haveSlugs.has(s))
  const extra = [...haveSlugs].filter((s) => !want.has(s))
  const withPhotos = have.filter((r) => r.image_url).length
  console.log(`PACKET-FIXTURE: ${have.length} record(s) for ${ZONE}.`)
  const fails = []
  if (missing.length) fails.push(`${missing.length} slug(s) in clusters.json are absent: ${missing.slice(0, 4).join(', ')}`)
  if (extra.length) fails.push(`${extra.length} record(s) are no longer in the zone: ${extra.slice(0, 4).join(', ')}`)
  // image_url must stay stripped, or CI starts fetching ~43 photos from someone else's CDN.
  if (withPhotos) fails.push(`${withPhotos} record(s) still carry image_url — the fixture must never fetch photos`)
  if (fails.length) {
    console.error(`\nPACKET-FIXTURE: FAIL — ${fails.length} problem(s)`)
    for (const f of fails) console.error('  - ' + f)
    console.error('\n  Fix: node internal/generate-packet-fixture.mjs (then commit it)')
    process.exit(1)
  }
  console.log('PACKET-FIXTURE: PASS — the committed fixture matches clusters.json and fetches no photos.')
  process.exit(0)
}

// ── GENERATE ────────────────────────────────────────────────────────────────
if (!existsSync(CACHE)) {
  console.error('PACKET-FIXTURE: FAIL — no records cache to derive from.')
  console.error(`  Expected ${CACHE.slice(ROOT.length + 1)}.`)
  console.error('  Run a normal packet build first: node library/scripts/posters/packet.mjs')
  process.exit(1)
}
const recs = JSON.parse(readFileSync(CACHE, 'utf8'))
const subset = (Array.isArray(recs) ? recs : recs.records || []).filter((r) => r && want.has(r.slug))
if (subset.length !== want.size) {
  console.error(`PACKET-FIXTURE: FAIL — matched ${subset.length} of ${want.size} slug(s) in the cache.`)
  console.error('  The cache is stale or partial; re-run a full packet build and try again.')
  process.exit(1)
}
// STRIP image_url. A fixture that carries photo URLs would make CI fetch ~43 images from
// Joshua Project's CDN on every build, which is both slow and rude; the packet degrades to
// typographic cards, which is exactly what a fixture should exercise.
const lean = subset.map((r) => {
  const c = { ...r }
  delete c.image_url
  c.has_photo = false
  return c
})
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(lean))
const kb = (JSON.stringify(lean).length / 1024).toFixed(0)
console.log(`[packet-fixture] wrote ${OUT.slice(ROOT.length + 1)} — ${lean.length} records for ${ZONE}, ${kb}KB`)
