// check-zone-census — every zone a USER CAN SELECT must have a poster.
//
// THE BUG CLASS THIS EXISTS FOR: a short count with no error. generate.mjs used to
// abort on the first bad zone (16 of 29 written, the rest silently unbuilt), and
// separately, tooling that enumerated clusters.json rather than the LEGEND warned
// that two zones were "MISSING" when nothing was missing — they are superseded and
// unreachable. Both look like success from a distance; only a census shows them.
//
// ★ ASK THE LEGEND, NOT THE DATA FILE. clusters.json carries 30 list definitions;
// the legend exposes 28 leaves. deaf-old-world and deaf-new-world-asia-pacific are
// collapsed into the unified `deaf` row (affinity bloc A017) — verified against
// live records: 63 + 60 = 123 = A017, zero groups on either side of the
// difference. They stay in clusters.json deliberately (three isolation-proof
// scripts assert deaf_lists.length === 2), but no user can reach them, so a poster
// for them is not a gap. Counting the file instead of the legend manufactures two
// phantom failures and hides real ones behind them.
//
// Usage: node internal/check-zone-census.mjs [postersDir]
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// DOXA_REPO still wins, unchanged. Only the FALLBACK moved: it was an absolute path to one
// author's worktree (/home/…/wt-packet), which check:no-abs-paths rejects outright — "a clone must
// work on any machine" — and that gate is inside build:unlocked, so the whole build went red for
// every builder, not just for whoever lacked that directory.
// The replacement is the idiom check-no-absolute-paths.mjs names in its own failure text, and the
// one every sibling script here uses: resolve from this file. The data it reads
// (plugin-designs/my-upg-100-list/data) is present in this repo, so the default now resolves for
// anyone who clones it, and a caller pointing at a different worktree still exports DOXA_REPO.
const REPO = process.env.DOXA_REPO
  || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(REPO, 'plugin-designs', 'my-upg-100-list', 'data')
const POSTERS = resolve(process.argv[2]
  || join(REPO, 'library', 'scripts', 'posters', 'out', 'posters'))

const clusters = JSON.parse(readFileSync(join(DATA, 'clusters.json'), 'utf8'))
const { buildLegendNodes, leafZones } = await import(pathToFileURL(join(DATA, 'legend-tree.js')).href)
const leaves = leafZones(buildLegendNodes(clusters, { records: null }))

if (!existsSync(POSTERS)) {
  console.log(`ZONE-CENSUS: SKIP — no posters at ${POSTERS} (run generate.mjs first).`)
  process.exit(0)
}
// ⚠ POSTERS ONLY. generate.mjs also writes PAPER sheets beside them (<zone>.packet.html, packet page 1;
// <zone>.letter.html), and counting those as posters would print "posters built: 56" for 28 zones.
const PAPER = /\.(packet|letter)\.html$/
const htmls = readdirSync(POSTERS).filter((f) => f.endsWith('.html'))
const built = new Set(htmls.filter((f) => !PAPER.test(f)).map((f) => f.slice(0, -5)))
const paperSheets = htmls.filter((f) => PAPER.test(f)).length
const missing = leaves.map((z) => z.id).filter((id) => !built.has(id))

// Definitions that exist in the data but are NOT reachable — reported as context,
// never as a failure, so the difference between "unbuilt" and "superseded" stays
// visible instead of being argued about every time someone counts.
const declared = new Set()
for (const k of ['lists', 'deaf_lists', 'asia_lists', 'uncovered_lists']) {
  for (const z of clusters[k] || []) declared.add(z.id)
}
const unreachable = [...declared].filter((id) => !leaves.some((z) => z.id === id))

console.log(`  selectable zones : ${leaves.length}`)
console.log(`  posters built    : ${built.size}${paperSheets ? `  (+ ${paperSheets} paper sheet(s), not counted)` : ''}`)
console.log(`  unreachable defs : ${unreachable.length}${unreachable.length ? ` (${unreachable.join(', ')}) — superseded, not a gap` : ''}`)

if (missing.length) {
  console.error(`\nZONE-CENSUS: FAIL — ${missing.length} selectable zone(s) have NO poster:`)
  for (const id of missing) console.error(`  - ${id}`)
  process.exit(1)
}
console.log(`\nZONE-CENSUS: PASS — every one of the ${leaves.length} selectable zones has a poster.`)
