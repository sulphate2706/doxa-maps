#!/usr/bin/env node
/**
 * check-upg-zone-joins.mjs — the two UPG-100 zone joins, each pinned WITH ITS COST.
 *
 * WHY THIS IS A REGISTERED CHECK AND NOT A SCRIPT I RAN ONCE. Both joins below were
 * verified by hand while they were written, and that verification lived nowhere: not
 * in a file, not in a gate, only in a terminal. A probe proves something once. The two
 * defects it guards are both SILENT — neither throws, neither renders an error, and
 * both return a well-formed answer that is simply smaller than the truth:
 *
 *   1. ADMIN NAMES NEED THEIR DIACRITICS FOLDED. admin-to-list.json writes `gujarat`;
 *      gospel-by-province-groups writes `Gujarāt` (also Karnātaka, Tamil Nādu,
 *      Uttarākhand, Jammu and Kashmīr, Haryāna). Lowercase alone joins 514 of 1009
 *      rows across 9 zones; folding joins 1009 across 12. The 50.9% is the dangerous
 *      number — every surviving zone still looks populated, just smaller.
 *
 *   2. THE SELECTOR EVALUATOR WANTS FLAT RECORDS. It reads `r.country_code === want`,
 *      a plain string, while the source shape is `{ value, label }` before normalize.js
 *      flattens it. Passing the object form matches nothing and returns an empty Set
 *      for EVERY zone, which reads as "these zones have no groups".
 *
   3. THE ZONE AND REGION ID SPACES OVERLAP. The legend emits ONE BARE STRING on one
 *      channel — a leaf emits its zone id, a region row emits the region's — and of 33 zone
 *      ids and 7 region ids exactly one name is shared, whose region is itself. Un-namespaced
 *      that string cannot say which row was clicked. It is harmless today ONLY because that
 *      region currently holds one zone, which is a fact about the data rather than a property
 *      of the design.
 *
 * EACH ARM IS CHECKED IN BOTH DIRECTIONS. The negative arms are the point: they record
 * what the fold and the flattening are BUYING, so a later reader asking "is this still
 * needed?" gets a number instead of a green tick. A check that can only go green when
 * the guard is present, and never demonstrates the guard's absence, is not evidence.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import evaluate from '../plugin-designs/my-upg-100-list/data/selector-evaluator.js'
import { buildZoneTree, zonesForSelection, isRegionId, regionOf, humanize, REGION_PREFIX }
  from '../plugin-designs/gospel-internet/src/zoneTree.js'
import { zonesByGroup, zonesBySelector, toSelectorRecord } from '../plugin-designs/gospel-internet/src/upgZones.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const D = 'plugin-designs/my-upg-100-list/data/'

const fail = []
const ok = (label, got, want) => {
  if (got === want) console.log(`  ✓ ${label}: ${got}`)
  else { console.log(`  ✗ ${label}: got ${got}, expected ${want}`); fail.push(label) }
}

console.log('UPG-ZONE-JOINS')

// ── 1. the province join, with and without the fold ─────────────────────────
const a2l = read(D + 'admin-to-list.json')
const prov = read('data/tables/gospel-by-province-groups.json').rows
const folded = zonesByGroup(a2l, prov)
ok('province join, folded — rows', folded.size, prov.length)
ok('province join, folded — zones', new Set(folded.values()).size, 12)

// the negative arm: what lowercase-only would cost, so the fold's value is recorded
const naive = new Map(Object.entries(a2l).map(([k, v]) => [k.trim().toLowerCase(), v]))
const naiveHits = prov.filter((r) => naive.get(String(r.province).trim().toLowerCase())).length
ok('province join, UNFOLDED — rows (the fold buys the difference)', naiveHits, 514)
if (naiveHits >= prov.length) {
  console.log('  ✗ the unfolded path no longer loses rows — this check can no longer fail; re-derive it')
  fail.push('fold arm is inert')
}

// ── 2. the selector join, flat records vs the object shape ──────────────────
const clusters = read(D + 'clusters.json')
const zoneLists = [...(clusters.lists || []), ...(clusters.deaf_lists || []), ...(clusters.asia_lists || [])]
const nn = read('data/tables/near-neighbors.json')
const ix = Object.fromEntries(nn.cols.map((c, i) => [c, i]))
const dec = (r, c) => (nn.dict[c] ? nn.dict[c][r[ix[c]]] : r[ix[c]])
const records = nn.rows.map((r, i) => toSelectorRecord(
  { iso3: dec(r, 'iso3'), name: dec(r, 'name'), langName: dec(r, 'langName'), bloc: dec(r, 'bloc') }, `nn-${i}`))

const flat = zonesBySelector(zoneLists, records, evaluate)
ok('selector join, FLAT — zones with members', [...flat.members.values()].filter((s) => s.size).length, 8)
ok('selector join — zones the evaluator rejects by design (pg_slugs)', flat.unanswerable.size, 12)

// the negative arm: the object shape must collapse to nothing, loudly recorded
const objShaped = nn.rows.map((r, i) => ({ slug: `nn-${i}`, country_code: { value: dec(r, 'iso3') } }))
const obj = zonesBySelector(zoneLists, objShaped, evaluate)
ok('selector join, OBJECT-shaped — zones with members (must be 0)',
  [...obj.members.values()].filter((s) => s.size).length, 0)

// ── 3. the zone/region id namespaces ────────────────────────────────────────
// The fixture gives the colliding region TWO zones ON PURPOSE. Today's data gives it one,
// so both readings of the bare id return the same set and a check built on the real table
// would pass without ever exercising the difference — it would be measuring the data, not
// the code. regions' check watches the shipped tables and fails if the colliding set moves;
// this pins the behaviour that makes a collision harmless when it arrives.
const ZR = {
  europe: 'europe',                 // the colliding name: a zone AND a region
  'europe-balkans': 'europe',       // the second zone today's data does not yet have
  'asia-india-gujarat': 'asia',
  brazil: 'latam',
}
// ?. and ?? -1 below are NOT defensive noise. Poisoning the namespace makes `region:asia`
// stop existing, and an unguarded `.count` THREW — the file died at the third assertion and
// the seven after it, including the one this section exists for, never ran. The crash still
// exited 1, so it read like the check catching the bug. A check that dies reports less than
// one that fails by name: guard the lookups so every arm runs and says what it saw.
const tree = buildZoneTree(ZR, { counts: { 'asia-india-gujarat': 7 } })
ok('tree: every region row is namespaced', tree.every((n) => n.id.startsWith(REGION_PREFIX)) ? 1 : 0, 1)
ok('tree: leaves stay bare', tree.flatMap((n) => n.children).every((c) => !isRegionId(c.id)) ? 1 : 0, 1)
ok('tree: a region rolls up its children counts', tree.find((n) => n.id === 'region:asia')?.count ?? -1, 7)
const asLeaf = zonesForSelection('europe', ZR)
const asRegion = zonesForSelection('region:europe', ZR)
ok('tree: the bare id means that ZONE only', asLeaf?.length ?? -1, 1)
ok('tree: the namespaced id expands to the REGION\'s zones', asRegion?.length ?? -1, 2)
// A SUMMARY ARM, AND THE WEAKEST ONE — kept for what it says, not for what it catches.
// Under a poisoned namespace the two readings still DIFFER (2 vs 0), both wrong, so this
// arm stays green while the two above it go red. The specific lengths are the guards; this
// line only states the property they add up to. Labelled honestly so nobody trusts it alone.
ok('tree: the two readings of the colliding name are not the same set (summary)',
  JSON.stringify(asLeaf) !== JSON.stringify(asRegion) ? 1 : 0, 1)
ok('tree: a bare id never reads as a region', (!isRegionId('europe') && regionOf('europe') === null) ? 1 : 0, 1)
const sweep = new Set(tree.flatMap((n) => zonesForSelection(n.id, ZR)))
ok('tree: sweeping every region reaches every FILED zone and no more', sweep.size, Object.keys(ZR).length)
ok('tree: there is no region-based "all" to misuse', zonesForSelection(null, ZR) === null ? 1 : 0, 1)
ok('tree: humanize is only a fallback label', humanize('asia-india-gujarat') === 'Asia India Gujarat' ? 1 : 0, 1)

if (fail.length) {
  console.log(`\nUPG-ZONE-JOINS: FAIL — ${fail.length} assertion(s): ${fail.join(', ')}`)
  process.exit(1)
}
console.log('\nUPG-ZONE-JOINS: PASS — both joins pinned in both directions, and the id namespaces cannot collapse')
