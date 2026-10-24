#!/usr/bin/env node
/**
 * check-list-selection — what the vertical legend emits, and the zones a region tree forgets. Headless.
 *
 * ★ WHY THIS IS IN internal/ AND NOT _qa-cycle/. It began as a _qa-cycle probe, which is GITIGNORED
 * in this repo (.gitignore:113) — so it ran green on my disk and would NOT have landed with the
 * component. studio caught that while staging: "the 13 assertions are not in either commit". I had
 * reported them as evidence for code that was about to ship untested, which is the same failure this
 * whole file guards against — a green result measured somewhere other than where it matters.
 * A probe proves something once. A registered check keeps proving it.
 */
// What the vertical legend emits, and the zones a region tree forgets.
//
// The second half is the one that matters most: four joinable UPG-100 zones are absent from
// zone-regions.json today, one of them the consumer's largest at 100 groups. A region-grouped tree
// drops them with no error and no empty state — just a shorter tree — so this asserts they survive.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { leavesOf, zoneIdsIn, withUnassigned, selectedId, UNASSIGNED_ID } from '../library/components/legends/listSelection.js'
// ★ TWO ROOTS, DELIBERATELY, BECAUSE ONLY TWO OF THE THREE FILES MOVED. zone-regions.json and
// groupings.json now live in data/tables/ — the shared asset pool the tree copies into
// public/dx-maps/assets/tables/ — because gospel's legend renders IN THE BROWSER and needs them at
// runtime; a build-time import path would not reach the bundle. admin-to-list.json stays in the
// plugin, provisional, pending a product decision on the "zones fold" regeneration, so it is read
// from the old root. Collapsing these to one constant silently breaks whichever file is not where you pointed.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const TABLES = join(REPO, 'data', 'tables')
const PLUGIN_DATA = join(REPO, 'plugin-designs', 'my-upg-100-list', 'data')
const readJson = (f) => JSON.parse(readFileSync(join(f === 'admin-to-list.json' ? PLUGIN_DATA : TABLES, f), 'utf8'))
let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

const TREE = [{
  id: 'asia', label: 'Asia', depth: 0,
  children: [
    { id: 'z1', label: 'Zone 1', zoneKey: 'Z1' },
    { id: 'sub', label: 'Sub', depth: 1, children: [{ id: 'z2' }, { id: 'z3' }] },
  ],
}]
// The real gap, named as it appears in the data.
const MISSING = [
  'asia-china-guizhou-province',
  'asia-china-xinjiang-uyghur-autonomous-region',
  'asia-india-bihar',
]
// asia-india-madhya-pradesh WAS here and is now FILED. The filing change hit this arm, and the
// red was reported instead of the pinned expectation being edited to turn the change green: editing
// another owner's pinned expectation to make one's own change green is precisely the move that hollows
// out a guard. The data and this fixture landed TOGETHER, the only ordering where neither side is red
// in between.


ok(leavesOf(TREE[0]).map((l) => l.id).join(',') === 'z1,z2,z3', 'leavesOf walks NESTED children, not one level')
ok([...zoneIdsIn(TREE)].sort().join(',') === 'z1,z2,z3', 'zoneIdsIn collects every leaf id in the tree')

// ── the emit contract ───────────────────────────────────────────────────────────────────────────
ok(selectedId({ id: 'z1' }) === 'z1', 'a LEAF emits its zone id')
ok(selectedId({ id: 'asia' }) === 'asia', 'a REGION row emits the region id — the consumer expands it, where the join lives')
ok(selectedId(null) === null, 'and a CLEARED selection emits null, so a filter can be dropped')
ok(typeof selectedId({ id: 'z1' }) === 'string',
  'the value is a STRING, so it survives ?zone=, profile-config and a deep link')

// ── never drop a zone ───────────────────────────────────────────────────────────────────────────
const all = ['z1', 'z2', 'z3', ...MISSING]
const withBucket = withUnassigned(TREE, all, 'Unassigned')
ok(withBucket.length === TREE.length + 1, 'zones absent from the tree get an explicit bucket')
const bucket = withBucket[withBucket.length - 1]
// Counted from MISSING, never written as a literal: the gap CHANGES (upg100 filed one while I was
// writing this), and a hardcoded 4 here turns every legitimate data fix into a puzzling red in an
// arm that is not even about the data.
ok(bucket.id === UNASSIGNED_ID && bucket.children.length === MISSING.length,
  `and all ${MISSING.length} missing zones are in it`)
ok(bucket.children.map((c) => c.id).includes('asia-china-xinjiang-uyghur-autonomous-region'),
  'including xinjiang — the consumer\'s largest zone at 100 groups, which a region tree loses silently')
ok(bucket.children.every((c) => c.id && c.zoneKey),
  'each is a SELECTABLE leaf, not a lump — a reader wants xinjiang, not "the ones nobody filed"')
ok(withUnassigned(TREE, ['z1', 'z2', 'z3']).length === TREE.length,
  'CONTROL: no bucket appears when nothing is missing')
ok(withUnassigned(TREE, null).length === TREE.length && withUnassigned(TREE, []).length === TREE.length,
  'CONTROL: omitting the zone set leaves the tree untouched, so this is additive')

// NEG CONTROL: the drop this exists to prevent must be detectable.
const naive = TREE   // what a region-grouped tree gives you, unaugmented
ok(!zoneIdsIn(naive).has('asia-china-xinjiang-uyghur-autonomous-region'),
  'NEG CONTROL: the unaugmented tree really does omit xinjiang, so the bucket is not decoration')

// ── a region sweep is NOT a zone sweep (gospel-resources) ───────────────────────────────────
// ★ The consequence of the bucket that neither of us should leave implicit: ticking every REGION
// still does not select every ZONE, because the unfiled zones have no region BY DEFINITION.
// Nothing on screen would say so — the reader just gets a smaller total, which is the exact
// silent-wrong-answer shape the bucket exists to end. So if a "select all" is ever added it must
// sweep ZONES, not regions, or it inherits the bug. Pinned here so the wrong one cannot ship
// quietly; gospel pins the mirror of it on the expansion side.
const regionRows = withBucket.filter((n) => n.id !== UNASSIGNED_ID)
const byRegionSweep = zoneIdsIn(regionRows)
ok(byRegionSweep.size < all.length,
  'selecting every REGION reaches fewer zones than exist — a region sweep is not a zone sweep')
ok(!byRegionSweep.has('asia-china-xinjiang-uyghur-autonomous-region'),
  'and the 100 groups it misses are xinjiang\'s, so a "select all" over regions must be over zones')
ok(zoneIdsIn(withBucket).size === all.length,
  'sweeping the WHOLE tree, bucket included, does reach all of them — what the bucket buys')

// ── a zone with no members stays SELECTABLE (gospel: 16 of 33 resolve today) ────────────────────
// Of the 33 zones, members resolve for 16; 5 await a wagf field and 9 have no selector anywhere.
// Those zones must render as EMPTY, not vanish — same reason as the bucket. A tree that hides what
// it cannot resolve tells the reader the zone does not exist, when the truth is that we cannot
// currently join it. Nothing here filters on member count, and this fails if anything starts to.
const EMPTYZONE = [{ id: 'asia', label: 'Asia', depth: 0, children: [{ id: 'z9', label: 'Zone 9', zoneKey: 'Z9', members: [] }] }]
ok(leavesOf(EMPTYZONE[0]).map((l) => l.id).join(',') === 'z9',
  'a zero-member zone is still a LEAF, so a reader can select it and see an empty result')
ok(selectedId(leavesOf(EMPTYZONE[0])[0]) === 'z9', 'and it still emits its own id')
ok(withUnassigned(EMPTYZONE, ['z9']).length === EMPTYZONE.length,
  'presence is by ID, not by member count, so an unresolvable zone is not ALSO dumped in the bucket')

// ── the gap is REAL TODAY, not just real in a fixture (gospel-resources) ───────────────────
// ★ EVERY ASSERTION ABOVE RUNS AGAINST A FIXTURE. That proves the MODULE behaves, and it proves the
// fixture models a gap — it does not prove the gap still exists in the data we ship. So the negative
// control above could stay green forever while the bucket quietly became dead code, or while a FIFTH
// zone went missing and nobody heard. That is the same failure in a new costume: evidence that lives
// somewhere other than where the thing it describes lives. gospel named it — find out where your
// evidence lives — after catching the identical shape in their own work.
//
// This does NOT resolve the three disagreeing lists (33 in zone-regions, 12 reachable via
// admin-to-list, 14 in groupings, disagreeing in BOTH directions). That is a data-ownership question,
// provisional, pending a product decision, and picking a winner here would be exactly the silent join
// this repo refuses. It only compares the region tree's own source against the joinable set and RECORDS the
// difference, so the disagreement cannot drift without someone being told.
const regionOf = readJson('zone-regions.json')          // the region tree's source: zone id -> region
const adminToList = readJson('admin-to-list.json')      // admin name -> zone id; its VALUES are joinable
const filed = new Set(Object.keys(regionOf))
const joinable = new Set(Object.values(adminToList).map(String))
const realGap = [...joinable].filter((id) => !filed.has(id)).sort()
// ★ WHAT THIS GAP COUNTS, AND WHAT IT DOES NOT. `joinable` is admin-to-list's VALUES — zones
// reachable by an admin-area join. That is NOT the same as every printable zone, so this arm can
// only ever report a LOWER BOUND on unfiled zones. upg100 proved the difference costs something:
// checking the property rather than the four names they were handed, they found deaf-old-world,
// deaf-new-world-asia-pacific, asia-india-uttarakhand and asia-india-west-bengal also unfiled,
// and none of the four is an admin-to-list value, so none of them appears in realGap. Two were
// then filed; the deaf pair look deliberate (there is a "deaf": "exempt" umbrella key). Stated
// here because a gap number that is quietly a lower bound reads exactly like a complete one.

ok(realGap.length > 0,
  realGap.length > 0
    ? `the region tree really does omit ${realGap.length} joinable zone(s) TODAY — the bucket is load-bearing in the shipped data, not only in the fixture`
    : 'INERT ARM: every joinable zone is now filed under a region, so this check no longer measures anything. That is not a pass. Re-derive the bucket against the current data or DELETE it and its component — do not leave a green arm guarding nothing.')
ok(realGap.join(',') === MISSING.join(','),
  realGap.join(',') === MISSING.join(',')
    ? 'and it is exactly the four this check names, so the fixture above models the shipped data rather than a story about it'
    : `THE GAP MOVED — re-derive. shipped now: [${realGap.join(', ')}] but this check asserts: [${MISSING.join(', ')}]. A zone ADDED here is groups that just became unreachable; a zone REMOVED got filed and the fixture is stale. Either way the numbers in the commit body are no longer true.`)
// ── the zones that got FILED stay filed (RG12) ─────────────────────────────────────
// The gap arms watch the BAD direction. Filing is the good one, and it is exactly as revertible:
// drop a key from zone-regions and those groups leave the region tree again, silently, with the
// bucket the only thing still carrying them. Two of these three were never visible to the gap arms
// at all (see the coverage note below), so without this they could be unfiled with nothing to say so.
const FILED = ['asia-india-madhya-pradesh', 'asia-india-uttarakhand', 'asia-india-west-bengal']
for (const z of FILED) {
  ok(filed.has(z), filed.has(z)
    ? `${z} is filed under a region, so it reaches readers through the tree and not only the bucket`
    : `${z} IS NO LONGER FILED — it was given a region and has lost it, so its groups are back to being reachable only through the unassigned bucket. That is the silent direction: no error, just a shorter region tree.`)
}

ok(joinable.has('asia-china-xinjiang-uyghur-autonomous-region') && !filed.has('asia-china-xinjiang-uyghur-autonomous-region'),
  'xinjiang specifically: joinable in admin-to-list, absent from zone-regions — its 100 groups are reachable ONLY through the bucket')

// ── the id ambiguity that is masked by a data coincidence (gospel-resources) ────────────────
// ★ REGION IDS AND ZONE IDS SHARE ONE NAMESPACE. selectedId emits one bare string with no kind, and
// the two sets OVERLAP in the shipped data. gospel found it while wiring and I re-measured it here
// rather than taking the report: 33 zone ids, 7 region ids, intersection exactly {europe}, whose
// region is itself. So `europe` cannot tell a consumer whether the Europe REGION row was clicked
// (expand to every European zone) or the Europe ZONE leaf (filter to that one).
//
// It is not live today ONLY because region `europe` contains exactly one zone, so both readings give
// the same set. That is a coincidence in the data, not a property of the design, and it is the same
// shape as the inert arm above: something green because reality currently happens to agree with it.
// The arm below is therefore the alarm, not the fix — the consumer builds the tree, so only the
// consumer can namespace its region rows, and gospel is doing that.
const zonesAll = new Set(Object.keys(regionOf))
const regionsAll = new Set(Object.values(regionOf).map(String))
const collide = [...zonesAll].filter((id) => regionsAll.has(id)).sort()
ok(collide.join(',') === 'europe',
  collide.join(',') === 'europe'
    ? 'region ids and zone ids share one namespace and collide on exactly {europe} — measured, not assumed'
    : `THE COLLIDING IDS CHANGED — re-derive. shipped now: [${collide.join(', ') || 'none'}], this check asserts: [europe]. Every id in both sets is one a consumer cannot disambiguate from the emitted string alone.`)
for (const id of collide) {
  const members = Object.keys(regionOf).filter((z) => String(regionOf[z]) === id)
  ok(members.length === 1,
    members.length === 1
      ? `and region '${id}' still contains exactly one zone, so both readings of '${id}' give the same set — the ambiguity is MASKED, not absent`
      : `THE '${id}' AMBIGUITY IS NOW LIVE: region '${id}' contains ${members.length} zones (${members.join(', ')}), so emitting the bare id '${id}' means either that whole region or the single zone of the same name, and the two now differ. Nothing on screen would say which — the reader just gets a smaller set. The consumer that BUILDS the tree must namespace its region rows (region:${id}) and leave leaves bare; this component cannot know which rows are regions.`)
}

console.log(fails ? `\nLIST-SELECTION: ${fails} FAIL(s)` : '\nLIST-SELECTION: serialisable ids out, and no joinable zone can be dropped')
process.exit(fails ? 1 : 0)
