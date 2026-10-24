// verify-gospel-click-sheet.mjs — prove the COUNTRY-CLICK SHEET is correct without a GPU.
//
//   node plugin-designs/gospel-resources/scripts/verify-gospel-click-sheet.mjs   # exits 1 on failure
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// Clicking a country on the gospel map needs Mapbox TILES (WebGL), which headless
// Firefox on this VPS does not have. So the CLICK ITSELF cannot be driven here.
// But the click is two separate things:
//   1. THE SHEET CONTENT   what a click RESOLVES TO   <- verifiable, and this does it
//   2. THE TAP -> OPEN     the GPU-rendered gesture   <- needs a real device
// Leaving BOTH unverified because one is impossible is the lazy read. This closes half
// the gap and NAMES the half that remains.
//
// ═══ IT HAD STOPPED RUNNING AT ALL, AND THEN IT WAS CHECKING THE WRONG FILE ═
// Found 2026-09-25, by running it. It crashed with ENOENT on
//     app/doxa-maps/gospel-resources/assets/tables/people-group-resources.json
// a tree deleted when data moved out of public/. A gate that cannot start proves nothing,
// and nothing noticed, because nothing runs it.
//
// The dead path was the smaller half. Its other input was a private copy of by-country
// under plugin-designs/, and its people-group table was the CURATED 2,106-row subset —
// which resources-map.vue stopped fetching some time ago, saying so in its own comments:
// the country sheet is built from the PIN INDEX now, 12,379 groups. So even repaired, it
// would have verified two files the sheet no longer reads, and reported green about a
// surface it was no longer looking at. Both inputs are now the live ones.
//
// ═══ THE JOIN IS ISO3, NOT A NAME ═══════════════════════════════════════════
// The old country match was a SUBSTRING test against a comma-joined name blob, with a
// comment explaining that country names contain commas so splitting under-counted. That
// is the shape of bug this bundle refuses everywhere else: names collide, ISO codes do
// not. The pin index carries iso3 per pin, so the join is exact.
//
// WHAT IT ASSERTS:
//   - every country in the roster resolves to >=1 pin (the sheet would not be empty)
//   - every URL the sheet would render for those groups is absolute — never fabricated
//   - has_audio stays the STRING 'unknown' where the pool was never checked, never
//     collapsed to false, which would read as "no audio exists" (persecution-critical)
//
// PROVEN TO GO RED — the SELF-TEST corrupts each invariant in memory and requires the
// check to fail. A check that has never failed proves nothing.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resourceRows } from '../gospel-resource-rows.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const T = join(HERE, '..', '..', '..', 'data', 'tables')

const load = (p) => JSON.parse(readFileSync(join(T, p), 'utf8'))
const roster = load('gospel-by-country.json').countries
const { codes, pins } = load('people-group-pins.json')
/* Still shipped as the "Resources by People Group" TAB, so its URLs are still worth
   checking — but it is the table, not the sheet, and this no longer confuses the two. */
const legacyRows = load('people-group-resources.json').rows

const ABS = (v) => v == null || v === '' || /^https?:\/\//.test(String(v))

function check(rosterIn, pinsIn, codesIn, legacyIn) {
  const fail = []
  const byIso = new Set()
  for (const p of pinsIn) if (p[3]) byIso.add(p[3])

  let painted = 0, resolved = 0
  for (const c of rosterIn) {
    if (!c.iso3) { fail.push(`country with no iso3: ${c.country}`); continue }
    painted++
    if (byIso.has(c.iso3)) resolved++
    else fail.push(`country paints but resolves to ZERO pins: ${c.country} (${c.iso3})`)
  }

  /* Every link the sheet would actually render, through the one flattener the sheet uses. */
  let links = 0
  for (const [code, c] of Object.entries(codesIn)) {
    for (const r of resourceRows(c)) {
      links++
      if (!ABS(r.url)) fail.push(`${code}: ${r.type} link is not an absolute URL: ${JSON.stringify(r.url)}`)
    }
  }

  for (const r of legacyIn) {
    for (const k of ['scripture_url', 'film_url']) {
      if (!ABS(r[k])) fail.push(`${r.people_group}: ${k} is not an absolute URL: ${JSON.stringify(r[k])}`)
    }
    if (r.has_audio === false && r.checked_pools && !/\bgrn\b/i.test(String(r.checked_pools))) {
      fail.push(`${r.people_group}: has_audio===false although GRN was never checked (must be the STRING 'unknown')`)
    }
  }
  return { painted, resolved, links, fail }
}

const res = check(roster, pins, codes, legacyRows)
console.log(`[click-sheet] countries in roster: ${res.painted}`)
console.log(`[click-sheet] countries resolving to >=1 pin: ${res.resolved}`)
console.log(`[click-sheet] resource links the sheet would render: ${res.links}`)
console.log(`[click-sheet] link/honesty violations: ${res.fail.length}`)
res.fail.slice(0, 5).forEach((f) => console.log('   -', f))

// ── SELF-TEST: the guard must go RED on each corrupted invariant ──────────────
const firstCode = Object.keys(codes)[0]
const bad = [
  ['relative sheet link', check(roster, pins, { x: { l: 'X', s: 'not-a-url' } }, [])],
  ['legacy relative url', check(roster, pins, {}, [{ ...legacyRows[0], scripture_url: 'not-a-url' }])],
  ['audio collapsed to false', check(roster, pins, {}, [{ ...legacyRows[0], has_audio: false, checked_pools: 'ebible' }])],
  ['country resolving to no pin', check([...roster, { iso3: 'ZZZ', country: 'Nowhere' }], pins, {}, [])],
]
const redOk = bad.every(([, r]) => r.fail.length > 0)
for (const [what, r] of bad) if (!r.fail.length) console.log(`   ! SELF-TEST did not catch: ${what}`)
console.log(`[click-sheet] SELF-TEST (guard goes RED on ${bad.length} corruptions): ${redOk ? 'PASS' : 'FAIL'}`)

const green = res.fail.length === 0 && res.resolved > 0 && res.links > 0 && redOk
console.log(`[click-sheet] ${green ? 'GREEN' : 'RED'}  (first code sampled: ${firstCode})`)
console.log('[click-sheet] NOT VERIFIED HERE: the tap->open gesture on a GPU-rendered map. Needs a real device.')
process.exit(green ? 0 : 1)
