#!/usr/bin/env node
/**
 * check-zoning-declared — a project list's ZONING is consistent with what its author DECLARED.
 *
 * WHY THIS EXISTS, and why it is a declaration-checker rather than a rule-checker. UPG-100 is becoming a
 * PATTERN: any project list (7000 / 4700 / 3000 / 2000 / 700) gets its own ~100-group clusters, zoned by
 * an agent who is not the author of this code. Zoning is human judgement — geography first, balanced with
 * language — so a gate cannot decide whether a zoning is GOOD. What it can decide is whether the zoning
 * matches what the author said it would be, which turns "did I zone this right?" from a browser question
 * into an exit code.
 *
 * ★ EVERY OBVIOUS RULE I WOULD HAVE WRITTEN FROM INTUITION FAILED THE REFERENCE IMPLEMENTATION, measured
 * against the live 28 zones and 2,107 records on 2026-09-27. That is the reason this file is shaped the
 * way it is:
 *
 *   "every group in exactly one zone"      → 112 groups are in two. 110 are the DEAF BLOC, and that is
 *                                            design-approved (legend-tree.js:151, slice 08): an affinity
 *                                            bloc's members also live in a geographic zone. Per-zone
 *                                            equality holds; only a naive GLOBAL sum over-counts. So the
 *                                            rule is "at most one GEOGRAPHIC zone", with blocs declared.
 *   "no group is unzoned"                  → 11 are, all Japan/China/Mongolia, and plausibly deliberate.
 *                                            A gate cannot tell a deliberate exclusion from a silent drop.
 *                                            Hence expected_orphans: the author states them, and the gate
 *                                            fails on a CHANGE rather than on their existence.
 *   "no two zones overlap"                 → 2 non-bloc overlaps exist (cocos-malays, andorrans) because
 *                                            "Scattered / Diaspora" overlaps the regions it scatters
 *                                            across. Declared, pending a product decision.
 *
 * A gate that fails on the only correct example of the thing it checks teaches people to disable it.
 *
 * ⚠ AND TWO OF THESE ASSERTIONS WOULD HAVE CAUGHT THIS CYCLE'S REAL DEFECTS BEFORE A BROWSER DID.
 * A1 (every zone resolves to ≥1 group) is exactly the state `deaf` and the five wagf zones were in when
 * the packet generator skipped them with "no groups resolved" — six of 28 zones silently producing
 * nothing, found only by generating all 28 and reading the log. A4 (every selector type is supported)
 * is the other: selector-evaluator THROWS on an unknown type, which surfaces at render time on one
 * zone's page rather than at build time on the whole set.
 *
 * Usage: node internal/check-zoning-declared.mjs [--list upg-100] [--records <file>]
 *        node internal/check-zoning-declared.mjs --self-test
 *
 * Exit 0 pass · 1 fail · 75 NOT MEASURED (no records source — "found nothing" is not "found nothing wrong")
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DOXA_REPO || resolve(HERE, '..')
const TAG = 'ZONING-DECLARED'

const argv = process.argv.slice(2)
const SELF_TEST = argv.includes('--self-test')
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
}
const LIST = flag('list', 'upg-100')

// ── the five assertions, as pure functions so --self-test can exercise them without any data ──────────

/** A1 — a zone that resolves to nothing is a broken selector, not an empty region. */
export function findEmptyZones(zoneSlugs) {
  return [...zoneSlugs].filter(([, slugs]) => !slugs || slugs.length === 0).map(([id]) => id)
}

/** A2 — at most one GEOGRAPHIC zone per group. Bloc zones are a declared second partition. */
export function findGeographicOverlaps(zoneSlugs, blocIds) {
  const bloc = new Set(blocIds || [])
  const owners = new Map()
  for (const [id, slugs] of zoneSlugs) {
    if (bloc.has(id)) continue
    for (const s of slugs) {
      if (!owners.has(s)) owners.set(s, [])
      owners.get(s).push(id)
    }
  }
  return [...owners].filter(([, zs]) => zs.length > 1).map(([slug, zones]) => ({ slug, zones }))
}

/** A3 — the orphan set must EQUAL the declared one. Both directions matter (see below). */
export function diffOrphans(actual, declared) {
  const a = new Set(actual); const d = new Set(declared || [])
  return {
    // A new orphan is a group that silently stopped being zoned — the failure this gate exists for.
    unexpected: [...a].filter((s) => !d.has(s)).sort(),
    // ★ AND A *RESOLVED* ORPHAN FAILS TOO, which is deliberate and non-obvious. If a declared orphan is
    // now zoned, that is good news and a STALE DECLARATION: leaving it listed means the next real drop of
    // that same group passes silently. A declaration that is not maintained stops being evidence.
    stale: [...d].filter((s) => !a.has(s)).sort(),
  }
}

/** A4 — every selector type must be one the evaluator supports (it throws at render time otherwise). */
export function findUnsupportedSelectors(selectorsById, supported) {
  const ok = new Set(supported)
  const bad = []
  const walk = (id, sel) => {
    if (!sel || !sel.type) { bad.push({ id, type: '(none)' }); return }
    if (!ok.has(sel.type)) bad.push({ id, type: sel.type })
    if (sel.type === 'union') for (const s of sel.selectors || []) walk(id, s)
  }
  for (const [id, sel] of selectorsById) walk(id, sel)
  return bad
}

/** A5 — a zone wildly over the page budget is usually a selector that matched too much. */
export function findOversizedZones(zoneSlugs, maxGroups) {
  if (!(maxGroups > 0)) return []
  return [...zoneSlugs]
    .filter(([, slugs]) => (slugs?.length || 0) > maxGroups)
    .map(([id, slugs]) => ({ id, count: slugs.length }))
}

// ── self-test ─────────────────────────────────────────────────────────────────────────────────────────
if (SELF_TEST) {
  // ★ PROVE EACH ASSERTION FIRES AND THAT IT IGNORES THE DECLARED CASES. A gate whose assertions have
  // never matched anything is indistinguishable from a gate with an inverted condition, and three of
  // these five are subtle enough that "it passed on the real data" is not evidence they work.
  const fails = []
  const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails.push(msg) }

  ok(findEmptyZones([['a', ['x']], ['b', []]]).join() === 'b', 'A1 flags an empty zone, not a full one')
  ok(findEmptyZones([['a', ['x']]]).length === 0, 'A1 passes when every zone resolves')

  const zs = [['geo1', ['p', 'q']], ['geo2', ['q']], ['deaf', ['p', 'q']]]
  ok(findGeographicOverlaps(zs, ['deaf']).map((o) => o.slug).join() === 'q',
    'A2 flags the geographic overlap and EXEMPTS the declared bloc (this is the deaf double-count)')
  ok(findGeographicOverlaps(zs, []).length === 2,
    'A2 WITHOUT the bloc declaration flags both — so the exemption is doing the work, not the regex')

  const d1 = diffOrphans(['new', 'known'], ['known'])
  ok(d1.unexpected.join() === 'new' && d1.stale.length === 0, 'A3 flags a NEW orphan')
  const d2 = diffOrphans([], ['known'])
  ok(d2.stale.join() === 'known' && d2.unexpected.length === 0,
    'A3 also flags a RESOLVED orphan as a stale declaration — an unmaintained declaration is not evidence')
  ok(diffOrphans(['known'], ['known']).unexpected.length === 0, 'A3 passes on an exact match')

  const sup = ['country_code', 'union']
  ok(findUnsupportedSelectors([['z', { type: 'wagf_block' }]], sup)[0].type === 'wagf_block',
    'A4 flags an unsupported type')
  ok(findUnsupportedSelectors([['z', { type: 'union', selectors: [{ type: 'nope' }] }]], sup)
    .some((b) => b.type === 'nope'), 'A4 descends INTO a union — southern-africa-islands is one')
  ok(findUnsupportedSelectors([['z', null]], sup)[0].type === '(none)', 'A4 flags a missing selector')

  ok(findOversizedZones([['big', new Array(300).fill('x')]], 200)[0].count === 300, 'A5 flags an oversized zone')
  ok(findOversizedZones([['ok', new Array(120).fill('x')]], 200).length === 0, 'A5 passes a large-but-sane zone')

  if (fails.length) {
    console.error(`\n${TAG} --self-test: FAIL — ${fails.length} case(s) wrong.`)
    process.exit(1)
  }
  console.log(`\n${TAG} --self-test: PASS — all five assertions fire on a real violation and stay quiet on `
    + 'the declared exceptions.')
  process.exit(0)
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────────────
const DATA = join(REPO, 'plugin-designs', 'my-upg-100-list', 'data')
const declPath = join(DATA, LIST === 'upg-100' ? 'zoning-declarations.json' : `zoning-declarations.${LIST}.json`)
if (!existsSync(declPath)) {
  console.log(`${TAG}: NOT MEASURED — no declarations at ${declPath}.`)
  console.log('  A list without declarations cannot be checked against them. Copy upg-100\'s and fill it in.')
  process.exit(75)
}
const decl = JSON.parse(readFileSync(declPath, 'utf8'))

// Records: the same source everything else uses. NOT fetched here — a gate that needs the network is a
// gate that SKIPs in CI, which is how check:packets-all went unevaluated on every build for weeks.
// ★ THE COMMITTED FIXTURE IS THE DEFAULT, the live cache only an override.
// ⚠ IT USED TO DEFAULT TO library/scripts/posters/out/_records.json, WHICH IS GITIGNORED
// (.gitignore:94) — so on a clean checkout this gate exited 75 and reported NOT MEASURED forever,
// which is indistinguishable from an unwired gate. studio measured exactly that before wiring it into
// gates:post (L13U) and correctly refused to take it. A gate that cannot run in CI protects nothing;
// this tree has been here before with check:packets-all, which SKIPped on every build for weeks.
// data/people-groups/zoning-records.json carries slug + every field a selector reads — 2,107 records,
// ~300 KB — so the gate measures on a clean tree with no network and no generation step.
const DEFAULT_RECORDS = join(REPO, 'data/people-groups/zoning-records.json')
const LIVE_CACHE = join(REPO, 'library/scripts/posters/out/_records.json')
const recordsPath = flag('records', existsSync(LIVE_CACHE) ? LIVE_CACHE : DEFAULT_RECORDS)
if (!existsSync(recordsPath)) {
  console.log(`${TAG}: NOT MEASURED — no records at ${recordsPath}.`)
  console.log('  The committed fixture is data/people-groups/zoning-records.json; pass --records <file>')
  console.log('  to use another. Exit 75 rather than 0: "found no records" is not "found nothing wrong".')
  process.exit(75)
}
const rawRecords = JSON.parse(readFileSync(recordsPath, 'utf8'))
// The fixture wraps its rows so it can carry its own provenance; the live cache is a bare array.
const records = Array.isArray(rawRecords) ? rawRecords : (rawRecords.records || [])

const clusters = JSON.parse(readFileSync(join(DATA, 'clusters.json'), 'utf8'))
const { buildLegendNodes, leafZones } = await import(pathToFileURL(join(DATA, 'legend-tree.js')).href)
const { evaluate } = await import(pathToFileURL(join(DATA, 'selector-evaluator.js')).href)

// Selectors by id, exactly as generate.mjs:2801-2808 and packet.mjs's allZones do it — leaves do not
// carry one, and `deaf`'s is implicit.
const selectorsById = new Map()
for (const k of ['lists', 'asia_lists', 'uncovered_lists']) {
  for (const z of clusters[k] || []) selectorsById.set(z.id, z.selector)
}
selectorsById.set('deaf', { type: 'affinity_bloc', rop1: 'A017' })

const zones = leafZones(buildLegendNodes(clusters, { records: null }))
const zoneSlugs = []
for (const z of zones) {
  const sel = selectorsById.get(z.id)
  let slugs = []
  if (sel?.type === 'pg_slugs') slugs = sel.values || []
  else if (sel) { try { slugs = [...evaluate(sel, records)] } catch (_) { slugs = [] } }
  zoneSlugs.push([z.id, slugs])
}

const SUPPORTED = ['country_code', 'country_codes', 'wagf_block', 'wagf_region', 'union', 'deaf_predicate',
  'affinity_bloc', 'pg_slugs']
const covered = new Set(zoneSlugs.flatMap(([, s]) => s))
const actualOrphans = records.map((r) => r.slug).filter((s) => s && !covered.has(s))

const declaredOverlaps = new Set((decl.known_geographic_overlaps?.slugs || []).map((o) => o.slug || o))
const empty = findEmptyZones(zoneSlugs)
const overlaps = findGeographicOverlaps(zoneSlugs, decl.bloc_zones?.ids).filter((o) => !declaredOverlaps.has(o.slug))
const orphanDiff = diffOrphans(actualOrphans, decl.expected_orphans?.slugs)
const unsupported = findUnsupportedSelectors(selectorsById, SUPPORTED)
const oversized = findOversizedZones(zoneSlugs, decl.page_budget?.max_groups)

console.log(TAG)
console.log(`  list ${LIST} · ${zones.length} zone(s) · ${records.length} record(s) · ${covered.size} covered`)
console.log(`  declared: ${(decl.bloc_zones?.ids || []).length} bloc zone(s), `
  + `${(decl.expected_orphans?.slugs || []).length} expected orphan(s), `
  + `${declaredOverlaps.size} known overlap(s)`)

const problems = []
if (empty.length) problems.push(`A1 ${empty.length} zone(s) resolve to NO groups: ${empty.join(', ')}`)
if (overlaps.length) {
  problems.push(`A2 ${overlaps.length} group(s) in two GEOGRAPHIC zones and not declared: `
    + overlaps.slice(0, 8).map((o) => `${o.slug} [${o.zones.join(' + ')}]`).join('; '))
}
if (orphanDiff.unexpected.length) {
  problems.push(`A3 ${orphanDiff.unexpected.length} NEW orphan(s) — in the list, in no zone, not declared: `
    + orphanDiff.unexpected.slice(0, 12).join(', '))
}
if (orphanDiff.stale.length) {
  problems.push(`A3 ${orphanDiff.stale.length} declared orphan(s) are now ZONED, so the declaration is `
    + `stale — remove them or the next real drop passes silently: ${orphanDiff.stale.slice(0, 12).join(', ')}`)
}
if (unsupported.length) {
  problems.push(`A4 ${unsupported.length} zone(s) use a selector type the evaluator does not support: `
    + unsupported.map((b) => `${b.id}(${b.type})`).join(', '))
}
if (oversized.length) {
  problems.push(`A5 ${oversized.length} zone(s) exceed the declared page budget `
    + `(${decl.page_budget?.max_groups}): ` + oversized.map((o) => `${o.id}=${o.count}`).join(', '))
}

if (problems.length) {
  console.error(`\n${TAG}: FAIL — ${problems.length} problem(s).`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('\n  Each of these is EITHER a zoning defect OR a declaration that needs updating, and the')
  console.error('  gate cannot tell which — that is the author\'s call. What it can guarantee is that the')
  console.error('  zoning and the declaration have not drifted apart silently.')
  process.exit(1)
}
console.log(`${TAG}: PASS — the zoning matches every declaration: no empty zone, no undeclared geographic `
  + 'overlap, the orphan set is exactly as declared, every selector type is supported, no zone over budget.')
