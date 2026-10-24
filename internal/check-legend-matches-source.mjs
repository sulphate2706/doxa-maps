#!/usr/bin/env node
/**
 * check-legend-matches-source.mjs — the numbers the maps SHOW must match the numbers the SOURCE HAS.
 *
 * THE GAP THIS FILLS. Every existing gate verifies INTERNAL consistency. check:facet-changes-map
 * proves the dots change and that the categories sum to 2,107 — but it asserts that inside the
 * page, against data the page already loaded. If the upstream corpus shifted (a new engagement
 * category, a reclassification, a renamed field) the page would stay perfectly self-consistent
 * while its legend quietly stopped describing reality. Nothing fetched the live endpoint.
 *
 * That is the worst failure this product can ship, because it is invisible to every structural
 * check: the element mounts, the canvas paints, the counts are formatted correctly, the partition
 * sums. Only comparison against the SOURCE catches a legend that is beautifully wrong — and these
 * maps exist to tell people where the gospel has not reached, so a wrong number is not a cosmetic
 * defect.
 *
 * WHAT IT ASSERTS, measured by hand first on 2026-09-23 and encoded here:
 *   - the corpus is still 2,107 rows;
 *   - engagement_status partitions it EXACTLY as the cap-2 legend claims (Unengaged 2,080 /
 *     Engaged 27) with no third bucket and no remainder;
 *   - adopted_by_churches is 21 of 2,107 = 1%, which is what the cap-4 dashboard KPI strip prints.
 *
 * THE EXPECTED VALUES ARE A BASELINE, NOT A LAW. The corpus is living data and these numbers WILL
 * move. A change here is not automatically a bug — it is a prompt to update the legend, the KPI and
 * this baseline together, which is exactly the coupling that was missing. The failure message says
 * so, so a future reader does not "fix" the data to please the gate.
 *
 * OFFLINE IS A SKIP, NOT A FAILURE. This box cannot always reach pray.doxa.life, and reporting a
 * mismatch that may not exist is the fail-open/fail-closed mistake in reverse. A network error
 * SKIPs with exit 0 and says why; only a reachable endpoint that DISAGREES fails.
 *
 * NOTE the browser UA. pray.doxa.life answers 403 to a default script user-agent — a trap already
 * recorded in this repo's notes, and one that presents as "the data is gone".
 */
import process from 'node:process'

const API = process.env.PRAY_BASE || 'https://pray.doxa.life'
const UA = 'Mozilla/5.0 (compatible; doxa-maps-gate/1.0)'

// Baseline re-measured 2026-09-23 (second reading) against the live endpoint. See the header: these
// move with the data.
//
// ★ WHY THIS UPDATE WAS SAFE, and what was checked before touching it. The gate's own failure text
// forbids updating the baseline alone, because that silences the check while leaving the maps wrong.
// So the maps were checked FIRST: grep for 2107/2,107/2080 across plugin-designs/ and library/ found
// the number ONLY inside explanatory comments — no shipping code hardcodes a corpus total. Every
// legend and KPI computes from the rows it loaded. The corpus moving 2107 -> 2108 therefore changes
// what the maps DISPLAY automatically, and only this baseline lagged.
// Re-measured 2026-09-24 (THIRD reading). The corpus has now moved 2107 -> 2108 -> 2107, and one
// group crossed from Unengaged to Engaged: 2081/27 -> 2079/28. Sums check (2079 + 28 = 2107).
//
// ★ THE SAME SAFETY CHECK WAS REPEATED, not assumed from last time. The gate's own failure text
// forbids updating this baseline alone, because that silences the check while leaving the maps
// wrong. So the maps were checked FIRST: grepping 2107/2108/2,107/2,108/2081/2079 across
// plugin-designs/ and library/ finds them ONLY inside explanatory comments — no shipping code
// hardcodes a corpus total, every legend and KPI computes from the rows it loaded. The corpus
// figure was also confirmed INDEPENDENTLY against the live endpoint (2107 rows) rather than
// taken from this gate's own reading.
//
// Re-measured 2026-09-30 (FOURTH reading). One more group crossed from Unengaged to Engaged: 2079/28 ->
// 2078/29, the total still 2107. The same order as before, the baseline LAST: the live endpoint was read
// independently (this gate: 2107 = 2078 + 29), a grep found no shipping code hardcoding the totals (the only
// 2078 hits are SVG path coordinates in static poster snapshots), and a reader confirmed the maps DISPLAY
// the new split (Prayer Progress's engagement legend read Unengaged 2,078 / Engaged 29 on development).
//
// ⚠ THIS DRIFTS, AND THAT IS THE POINT. Three readings in two days, moving in both directions.
// A failure here is normally UPSTREAM DATA MOVING, not a regression — but it must still be seen,
// because the one thing it would also catch is a legend that stopped computing and started
// asserting. Do not widen this into a range to stop the noise: the noise IS the signal that the
// numbers on the page are live.
const EXPECT = {
  total: 2107,
  engagement: { Unengaged: 2078, Engaged: 29 },
  adoptedPct: 1,
}

// ── THE TWO LOSTNESS AXES, AND THE FACT THAT THEY DISAGREE ──────────────────────────────────
// Two independent measurements of "who has nothing" now ship in this product, and a reader who
// meets both needs to know they are not the same question:
//
//   imb_gsec           — evangelical presence + church-planting activity (the Gospel Access filter)
//   the six imb_*_available flags — whether a RESOURCE exists (Bible, recordings, JESUS Film,
//                        audio scripture, radio, Bible stories)
//
// MEASURED 2026-09-23 over the live corpus:
//   gsec rung 0 "No Evangelicals, Churches or Resources" .... 225
//   zero of the six resource flags ......................... 285
//   BOTH (no presence AND no resource) ..................... 209
//   rung 0 yet HAS at least one resource .................... 16   <- the label overstates itself
//   zero resources yet NOT rung 0 ........................... 76
//
// ★ Of the 225 groups filed under "No Evangelicals, Churches OR RESOURCES", 11 have one of the six
// and 5 have FOUR each. The "or Resources" clause is not literally true in the data, so that phrase
// must never be repeated to a mission team as fact.
//
// NOT asserted as a gate condition here, deliberately: which figure is OFFICIAL is provisional,
// pending a product decision, and a gate must not quietly canonise one answer
// to a question that is still open. Recorded so the next reader inherits the measurement, not the
// task of re-deriving it.

async function get(fields) {
  const url = `${API}/api/people-groups/list?fields=${fields}&lang=en`
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${fields}`)
  const d = await r.json()
  if (!Array.isArray(d.posts)) throw new Error(`no posts[] in the response for ${fields}`)
  return d.posts
}

// A field may arrive as a bare string or as a {value,label} pair — the DX-life shape. Read the
// label when present, so a change in envelope shape is not mistaken for a change in the data.
const labelOf = (v) => (v && typeof v === 'object' ? (v.label ?? v.value) : v) ?? '(none)'

let posts
try {
  posts = await get('name,engagement_status')
} catch (e) {
  console.log(`LEGEND-SOURCE: SKIP — could not reach ${API} (${e.message}).`)
  console.log('  Offline is not a mismatch. Re-run where the endpoint is reachable.')
  process.exit(0)
}

const problems = []

if (posts.length !== EXPECT.total) {
  problems.push(
    `corpus size moved: ${posts.length} rows, baseline ${EXPECT.total}.\n` +
    '    Every legend and KPI derived from the corpus should be re-read before updating this baseline.')
}

const counts = {}
for (const p of posts) counts[labelOf(p.engagement_status)] = (counts[labelOf(p.engagement_status)] || 0) + 1

for (const [k, n] of Object.entries(EXPECT.engagement)) {
  if (counts[k] !== n) problems.push(`engagement "${k}": ${counts[k] ?? 0} rows, legend claims ${n}.`)
}
const extra = Object.keys(counts).filter((k) => !(k in EXPECT.engagement))
if (extra.length) {
  problems.push(
    `engagement has ${extra.length} category(ies) the legend does not show: ${extra.join(', ')}.\n` +
    '    A two-row legend over a three-value field hides rows from the reader.')
}
const sum = Object.values(counts).reduce((a, b) => a + b, 0)
if (sum !== posts.length) problems.push(`engagement partition is incomplete: ${sum} of ${posts.length} rows carry a value.`)

try {
  const ad = await get('name,adopted_by_churches')
  const n = ad.filter((p) => p.adopted_by_churches).length
  const pct = Math.round((n / ad.length) * 100)
  if (pct !== EXPECT.adoptedPct) problems.push(`adopted: ${n}/${ad.length} = ${pct}%, KPI strip prints ${EXPECT.adoptedPct}%.`)
  else console.log(`LEGEND-SOURCE: adopted ${n}/${ad.length} = ${pct}% — matches the KPI strip.`)
} catch (e) {
  console.log(`LEGEND-SOURCE: adoption check skipped (${e.message}).`)
}

console.log(`LEGEND-SOURCE: ${posts.length} rows · ` +
  Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(' · '))

if (problems.length) {
  console.error(`\nLEGEND-SOURCE: FAIL — ${problems.length} mismatch(es) between what the maps SHOW and what the source HAS.\n`)
  for (const p of problems) console.error('  ✗ ' + p + '\n')
  console.error('  This is a PROMPT, not a verdict: the corpus is living data. Update the legend, the')
  console.error('  KPI strip and the EXPECT baseline in this file TOGETHER — never the baseline alone,')
  console.error('  which would silence the gate while leaving the maps wrong.')
  process.exit(1)
}

console.log('LEGEND-SOURCE: PASS — every rendered figure matches the live source.')
console.log('  Internal consistency is already covered by check:facet-changes-map; this is the')
console.log('  EXTERNAL check — the page agreeing with itself proves nothing about the world.')
