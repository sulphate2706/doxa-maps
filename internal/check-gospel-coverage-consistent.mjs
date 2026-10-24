#!/usr/bin/env node
/**
 * check-gospel-coverage-consistent.mjs — the gospel-resources surfaces must agree.
 *
 * WHY THIS EXISTS. The same defect was found by hand THREE times in one flight, and each
 * time it was invisible until someone compared two surfaces:
 *   1. the country sheet listed 36 groups for Indonesia while the map drew 669 pins there,
 *      because the sheet read a curated 2,106-record subset and the map read the pins;
 *   2. the resource table silently dropped 506 real resources across 377 languages,
 *      because its generator skipped any code no pin speaks — in a table titled
 *      "every link";
 *   3. resources attached to `und` ("Undetermined") told 14 people groups there was
 *      Scripture in a language the record explicitly does not identify.
 * None of these threw. Every page rendered. Only a comparison caught them, so the
 * comparison is now a gate rather than a habit.
 *
 * WHAT IT ASSERTS, all static — no browser, no server, runs in well under a second:
 *   A. no ISO 639-3 special/reserved code carries a resource (und/mul/mis/zxx/qaa-qtz);
 *   B. every code carrying a resource has a language NAME — an unnamed code renders as a
 *      bare ISO in the table and tells a reader nothing;
 *   C. the resource table's reach columns match an independent recount off the pins;
 *   D. the table covers EVERY code that has a resource — the "every link" claim;
 *   E. every resource_url in the table exists in the pin index, so the table cannot
 *      invent a link the map does not hold;
 *   F. each pin's tier agrees with the URLs its code actually carries;
 *   I. a row's TYPE agrees with the host it points at — Film only on jesusfilm.org or
 *      arc.gt, Bible Stories only on door43 and only under that name, Scripture never on
 *      a film host. Clause H catches the one mislabel that actually shipped; this catches
 *      the general shape, because the 70-row defect was invisible for seven ticks
 *      precisely because NOTHING compared a row's label to where it points. Audited at
 *      the time of writing: 3,550 rows, 0 violations — so this is a guard, not a fix.
 *   H. nothing named "Open Bible Stories" is TYPED as Scripture. OBS is 50 illustrated
 *      narratives drawn from the canon, not a translation, and this repo's standing rule
 *      is that the two are never blurred. It broke silently: owner disambiguation changed
 *      the label to "Open Bible Stories (OBS-TLF)" and the type test was an exact ===
 *      match, so 70 story sets were typed Scripture and stayed that way for seven ticks.
 *      An exact match against a label that can grow a suffix is the whole defect.
 *   G. no URL is plain http. Every host we ship serves https directly and redirects
 *      http there anyway, so a plain link only buys a redirect hop and a downgraded
 *      scheme in a field worker's browser. 1,237 of them shipped that way until the
 *      normalisation moved to the point where a URL ENTERS the index — doing it
 *      per-source had left the 120 curated links behind, since fill-never-overwrite
 *      preserves those and they never passed through a fetcher.
 *
 * ★ SELF-TEST: run with --poison to inject each defect in memory and confirm the clause
 * catches it. A check that has never been shown to fail proves nothing, and five of the
 * six clauses here are asserting a NEGATIVE, which is exactly the shape that passes
 * vacuously when the data it reads is empty or mis-keyed.
 */
import { readFileSync } from 'node:fs'
import { hasReadableScripture } from '../plugin-designs/gospel-resources/gospel-resource-rows.js'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POISON = process.argv.includes('--poison')
let poisonStale = false
let poisonTable = false
let poisonGapKind = false

const read = (p) => JSON.parse(readFileSync(resolve(REPO, p), 'utf8'))
let pins, table, verif
try {
  pins = read('data/tables/people-group-pins.json')
  table = read('data/tables/gospel-resource-links.json')
  try { verif = read('data/tables/gospel-link-verification.json') } catch { verif = null }
} catch (e) {
  console.error(`COVERAGE-CONSISTENT: SKIP — inputs missing (${e.message}).`)
  console.error('  Run: node plugin-designs/gospel-resources/scripts/build-people-group-pins.mjs')
  process.exit(0)
}

const codes = { ...pins.codes }
let rows = pins.pins
let trows = table.rows

// A gate that reads an empty corpus passes every negative clause while measuring nothing.
if (!rows?.length || !trows?.length || !Object.keys(codes).length) {
  console.error('COVERAGE-CONSISTENT: FAIL — an input is empty; every clause below would pass vacuously.')
  process.exit(1)
}

if (POISON) {
  // one injected defect per clause, in memory only
  codes.und = { l: 'Undetermined', d: [{ s: 'Open Bible Stories', u: 'https://example.invalid/und' }] }   // A
  codes.zzq = { l: '', s: 'http://ebible.org/zzq/' }                                                      // B + G
  trows = [{ ...trows[0], people_groups: (trows[0].people_groups || 0) + 999 },                           // C
           { ...trows[0], resource: 'Open Bible Stories (X)', type: 'Scripture' },                        // H
           { ...trows[0], type: 'Film', resource_url: 'https://ebible.org/xyz/' },                        // I
           ...trows.slice(1, -1),
           { ...trows[trows.length - 1], resource_url: 'https://example.invalid/invented' }]              // E
  rows = [[...rows[0].slice(0, 6), 2], ...rows.slice(1)]                                                  // F (forced tier 2)
  codes.zzj = { l: 'Both at once', z: 'https://zume.training/en', za: { u: 'https://zume.training/pus', l: 'Pashto', n: 'x' } } // J
  codes.zzk = { l: 'Ships a known-dead link', f: 'https://jesusfilm.org/watch/jesus/4101' }                                     // K
  poisonStale = true                                                                                                             // L
  codes.zzm = { l: 'Claims a pool nobody swept for it', ck: 'ebible, grn', s: 'https://ebible.org/zzm/' }      // M
  poisonTable = true                                                                                          // N
  poisonGapKind = true                                                                                        // O
}

const SPECIAL = (c) => c === 'und' || c === 'mul' || c === 'mis' || c === 'zxx' || (c >= 'qaa' && c <= 'qtz')
const hasRes = (v) => !!(v && (v.s || v.f || v.au || v.bv || v.se || v.ga || (v.d && v.d.length)))
const fails = []
const add = (clause, msg) => fails.push(`  [${clause}] ${msg}`)

// A — no resource on a code that is not a language
for (const [c, v] of Object.entries(codes)) {
  if (SPECIAL(c) && hasRes(v)) add('A', `${c} is an ISO reserved code and carries a resource`)
}
// B — a code with a resource must be named
for (const [c, v] of Object.entries(codes)) {
  if (hasRes(v) && !String(v.l || '').trim()) add('B', `${c} carries a resource but has no language name`)
}
// C — reach columns recounted off the pins
const groups = {}, speakers = {}
for (const r of rows) { groups[r[4]] = (groups[r[4]] || 0) + 1; speakers[r[4]] = (speakers[r[4]] || 0) + (r[5] || 0) }
let cBad = 0
for (const t of trows) {
  if ((groups[t.iso639_3] || 0) !== t.people_groups) cBad++
  else if ((speakers[t.iso639_3] || 0) !== t.speakers) cBad++
}
if (cBad) add('C', `${cBad} table row(s) disagree with a pin recount of people_groups/speakers`)
// D — every code with a resource is represented in the table
const inTable = new Set(trows.map((t) => t.iso639_3))
const missing = Object.keys(codes).filter((c) => hasRes(codes[c]) && !inTable.has(c))
if (missing.length) add('D', `${missing.length} code(s) carry a resource but appear in no table row (e.g. ${missing.slice(0, 3).join(', ')})`)
// E — the table cannot invent a URL
const known = new Set()
for (const v of Object.values(codes)) {
  if (v.s) known.add(v.s); if (v.f) known.add(v.f); if (v.z) known.add(v.z); if (v.za) known.add(v.za.u); if (v.au) known.add(v.au.u); if (v.bv) known.add(v.bv.u); if (v.gp) known.add(v.gp.u); if (v.se) known.add(v.se.u); if (v.ga) known.add(v.ga.u)
  for (const d of v.d || []) known.add(d.u)
}
const invented = trows.filter((t) => t.resource_url && !known.has(t.resource_url))
if (invented.length) add('E', `${invented.length} table URL(s) exist in no pin record (e.g. ${invented[0].resource_url})`)
// I — type must agree with the host
const FILM_HOST = /(^|\.)(jesusfilm\.org|arc\.gt)$/i
const hostOf = (u) => (/^https?:\/\/([^/]+)/i.exec(u || '') || [, ''])[1].toLowerCase()
const typeBad = []
for (const t of trows) {
  const h = hostOf(t.resource_url)
  if (!h) continue
  const film = FILM_HOST.test(h)
  if (t.type === 'Film' && !film) typeBad.push(`Film on ${h}`)
  else if (t.type === 'Scripture' && film) typeBad.push(`Scripture on film host ${h}`)
  else if (t.type === 'Bible Stories' && !/(^|\.)git\.door43\.org$/i.test(h)) typeBad.push(`Bible Stories on ${h}`)
  else if (t.type === 'Bible Stories' && !/^Open Bible Stories/.test(t.resource || '')) typeBad.push(`Bible Stories named "${t.resource}"`)
  // Training is a COURSE, and the only publisher of it here is Zume. Without this the
  // type fell through every branch above and was checked by nothing at all.
  else if (t.type === 'Discipleship training' && !/(^|\.)zume\.training$/i.test(h)) typeBad.push(`Discipleship training on ${h}`)
  else if (/(^|\.)zume\.training$/i.test(h) && t.type !== 'Discipleship training') typeBad.push(`${t.type} on zume.training`)
  // Audio Scripture is published here by exactly one host. Without this the type fell
  // through every branch above and was checked by nothing, the same hole training had.
  else if (t.type === 'Audio Scripture' && !/(^|\.)bible\.is$/i.test(h)) typeBad.push(`Audio Scripture on ${h}`)
  // bible.is serves BOTH: a fileset may carry audio, text or both, so the honest set of
  // types on this host is two, not one. It stays a CLOSED set - anything else here is a
  // mislabel - and 'Audio Scripture' on any other host is still wrong.
  else if (/(^|\.)bible\.is$/i.test(h) && t.type !== 'Audio Scripture' && t.type !== 'Scripture' && t.type !== 'Bible video') typeBad.push(`${t.type} on bible.is`)
  // knowgod.com serves exactly one type here: a gospel presentation. A closed set again.
  else if (t.type === 'Gospel presentation' && !/(^|\.)knowgod\.com$/i.test(h)) typeBad.push(`Gospel presentation on ${h}`)
  else if (/(^|\.)knowgod\.com$/i.test(h) && t.type !== 'Gospel presentation') typeBad.push(`${t.type} on knowgod.com`)
  else if (t.type === 'Bible video' && !/(^|\.)bible\.is$/i.test(h)) typeBad.push(`Bible video on ${h}`)
  else if (t.type === 'Audio Scripture' && !/(^|\.)bible\.is$/i.test(h)) typeBad.push(`Audio Scripture on ${h}`)
}
if (typeBad.length) add('I', `${typeBad.length} row(s) whose type disagrees with their host (e.g. ${typeBad[0]})`)

// H — a story set must never be typed as Scripture
const misTyped = trows.filter((t) => /open bible stories/i.test(t.resource || '') && /^scripture$/i.test(t.type || ''))
if (misTyped.length) add('H', `${misTyped.length} row(s) named "Open Bible Stories" are typed as Scripture (e.g. ${misTyped[0].language})`)

// G — no plain-http URL
const httpUrls = []
for (const [c, v] of Object.entries(codes)) {
  for (const u of [v.s, v.f, v.z, v.za && v.za.u, v.au && v.au.u, v.bv && v.bv.u, v.gp && v.gp.u, v.se && v.se.u, v.ga && v.ga.u, ...(v.d || []).map((d) => d.u)]) {
    if (u && /^http:\/\//i.test(u)) httpUrls.push(`${c} ${u}`)
  }
}
if (httpUrls.length) add('G', `${httpUrls.length} plain-http URL(s) (e.g. ${httpUrls[0]})`)

// F — tier agrees with the URLs the code holds
let fBad = 0
for (const r of rows) {
  const v = codes[r[4]] || {}
  /* The SAME predicate the builder tiers with, imported rather than restated — this arm compared
     `v.s` alone and so reported 2,001 disagreements against a corrected tier, which is a gate
     defending the bug it exists to catch. */
  const readable = hasReadableScripture(v)
  const want = readable && v.f ? 2 : (readable || v.f || (v.d && v.d.length) || v.au || v.bv || v.se || v.ga) ? 1 : 0
  if (want !== r[6]) fBad++
}
if (fBad) add('F', `${fBad} pin(s) carry a tier that disagrees with their code's URLs`)

// J — an approximate match must never sit alongside a confirmed one on the same code.
// The map styles them differently and says different things, so a code holding both would
// render the qualified claim and the confirmed one as if they were the same resource, and
// the qualification is the entire point of keeping them apart.
const both = Object.entries(codes).filter(([, v]) => v.z && v.za).map(([c]) => c)
if (both.length) add('J', `${both.length} code(s) carry BOTH a confirmed and an approximate training link (e.g. ${both[0]})`)
// An approximate entry must still be a real, complete record rather than a bare URL.
const thin = Object.entries(codes).filter(([, v]) => v.za && !(v.za.u && v.za.l && v.za.n)).map(([c]) => c)
if (thin.length) add('J', `${thin.length} approximate entr(ies) missing a url, language or note (e.g. ${thin[0]})`)

// K — verification must actually cover what is shipped, and nothing shipped may be known
// dead. The previous table matched TWO of 3,605 links because its keys were written http://
// and against a URL shape the index had since replaced; the map showed "unchecked" on links
// that had in fact been verified and nobody could tell that from never-looked-at. A coverage
// floor is the only thing that makes that failure loud.
if (verif && verif.links) {
  const V = verif.links
  const shipped = new Set()
  for (const v of Object.values(codes)) {
    if (v.s) shipped.add(v.s)
    if (v.f) shipped.add(v.f)
    if (v.z) shipped.add(v.z)
    if (v.za && v.za.u) shipped.add(v.za.u)
    if (v.au && v.au.u) shipped.add(v.au.u)
    if (v.bv && v.bv.u) shipped.add(v.bv.u)
    if (v.se && v.se.u) shipped.add(v.se.u)
    if (v.ga && v.ga.u) shipped.add(v.ga.u)
    if (v.gp && v.gp.u) shipped.add(v.gp.u)
    for (const d of v.d || []) if (d.u) shipped.add(d.u)
  }
  // EVERY shipped URL must be in the record, not 95% of them. The floor was set at 95%
  // and that is exactly how two known-dead links got back in: dropping them removed them
  // from the corpus, the next verification run never saw them, and 2 missing out of 3,768
  // is 99.9% — comfortably above a 95% floor and completely wrong. "Verify before you
  // ship it" does not have a tolerance.
  const unknownToRecord = [...shipped].filter((u) => !V[u])
  if (unknownToRecord.length) {
    add('K', `${unknownToRecord.length} shipped URL(s) appear in no verification record (e.g. ${unknownToRecord[0]}) — run scripts/verify-gospel-links.mjs`)
  }
  const dead = [...shipped].filter((u) => V[u] && V[u].state === 'broken')
  if (dead.length) add('K', `${dead.length} shipped URL(s) are recorded BROKEN and must not ship (e.g. ${dead[0]})`)
}

// L — the verification record must be FRESH, and every shipped URL must carry a stamp.
// "Link checked" is a claim about the present tense. A table that silently stops being
// re-run keeps making that claim on evidence that may be a year old, and every clause
// above would still pass: they check that the record is CONSISTENT, never that it is
// current. A dead link is exactly the failure a field worker hits, so the check that the
// record is recent is not bookkeeping.
// Re-running is cheap and resumable now (VERIFY_MAX_AGE_H skips what is already fresh),
// so this failing is an instruction, not an obstacle.
if (verif && verif.links) {
  const V = verif.links
  const MAX_AGE_DAYS = Number(process.env.VERIFY_MAX_AGE_DAYS || 45)
  const shipped2 = new Set()
  for (const v of Object.values(codes)) {
    if (v.s) shipped2.add(v.s)
    if (v.f) shipped2.add(v.f)
    if (v.z) shipped2.add(v.z)
    if (v.za && v.za.u) shipped2.add(v.za.u)
    if (v.au && v.au.u) shipped2.add(v.au.u)
    if (v.bv && v.bv.u) shipped2.add(v.bv.u)
    if (v.se && v.se.u) shipped2.add(v.se.u)
    if (v.ga && v.ga.u) shipped2.add(v.ga.u)
    if (v.gp && v.gp.u) shipped2.add(v.gp.u)
    for (const d of v.d || []) if (d.u) shipped2.add(d.u)
  }
  const unstamped = [...shipped2].filter((u) => V[u] && !V[u].at)
  if (unstamped.length) {
    add('L', `${unstamped.length} shipped URL(s) carry no check date (e.g. ${unstamped[0]}) — rerun scripts/verify-gospel-links.mjs`)
  }
  let oldest = Infinity
  let oldestUrl = ''
  for (const u of shipped2) {
    const at = V[u] && V[u].at ? Date.parse(V[u].at) : NaN
    if (!Number.isFinite(at)) continue
    if (at < oldest) { oldest = at; oldestUrl = u }
  }
  const nowMs = poisonStale ? Date.now() + (MAX_AGE_DAYS + 10) * 86400000 : Date.now()
  if (Number.isFinite(oldest)) {
    const days = (nowMs - oldest) / 86400000
    if (days > MAX_AGE_DAYS) {
      add('L', `the oldest shipped link was last checked ${days.toFixed(0)} days ago (${oldestUrl}), past the ${MAX_AGE_DAYS}-day limit — rerun VERIFY_MAX_AGE_H=24 node scripts/verify-gospel-links.mjs`)
    }
  }
}

/* ── M: a named pool was really searched FOR THAT CODE ───────────────────────────────────
   The `checked` line on a group's sheet is what tells a reader whether "nothing found"
   means anything. GRN is swept a batch at a time at the crawl delay their robots.txt asks
   for, so most codes have not been reached yet — and the build briefly claimed grn for 110
   codes it had never looked at, because the pass that normalises provenance ran before the
   fetchers that create those codes. A pool named here must be one this code was actually
   searched in. */
{
  let grnSeen = null
  try {
    const j = read('data/tables/grn-index.json')
    grnSeen = new Set([...Object.keys(j.byIso || {}), ...(j.none || [])])
  } catch { /* no snapshot yet: the claim cannot be made either, checked below */ }
  const liars = []
  for (const [c, v] of Object.entries(codes)) {
    if (!v || v.sg === 1) continue
    if (!/\bgrn\b/.test(String(v.ck || ''))) continue
    if (!grnSeen || !grnSeen.has(c)) liars.push(c)
  }
  if (liars.length) {
    add('M', `${liars.length} code(s) name grn as checked though the sweep never decided them (e.g. ${liars.slice(0, 3).join(', ')}) — the provenance pass must run AFTER every fetcher attaches`)
  }
}

/* ── N: a shipped table's "has anything" column agrees with the pin tier ─────────────────
   THE COMPLEMENT TO THE SOURCE-LEVEL GATE, and the reason it exists: the same drift has now
   appeared SIX times, each spelled differently — negated fields on a "none" line, a positive
   hasAny over a mapped row, a predicate in a build script, a column nobody refreshed at all.
   A source pattern has to guess how the next one will be written. This does not: it compares
   the shipped ANSWER against the tier, so it catches the seventh however it is phrased.

   Measured when written: people-group-resources.any_resource_found disagreed on 194 rows and
   its no_resource_found pair contradicted ITSELF on 7 more, because no pass had ever touched
   either column.

   A code with no pin is SKIPPED, not guessed. The tier lives on pins, so an unpinned code
   cannot be judged this way — judging it anyway produced a false finding on `ajp` the first
   time this was run, which is the failure mode this repo keeps meeting. */
{
  const hasPin = new Set()
  const reached = new Set()
  for (const r of rows) {
    if (!r[4]) continue
    hasPin.add(r[4])
    if (r[6] !== 0) reached.add(r[4])
  }
  const TABLES = [
    ['gaps-and-opportunities', 'heart_iso639_3', 'heart_has_any'],
    ['people-group-resources', 'iso639_3', 'any_resource_found'],
    ['deaf-gap', 'iso639_3', 'has_any_resource'],
  ]
  for (const [file, codeKey, anyKey] of TABLES) {
    let t
    try { t = read(`data/tables/${file}.json`) } catch { continue }
    const off = []
    for (const r of t.rows || []) {
      const c = r[codeKey]
      if (!c || !(c in codes) || !hasPin.has(c)) continue
      const said = poisonTable ? !(r[anyKey] === true) : r[anyKey] === true
      if (said !== reached.has(c)) off.push(c)
    }
    if (off.length) {
      add('N', `${file}.${anyKey} disagrees with the pin tier on ${off.length} row(s) (e.g. ${off.slice(0, 3).join(', ')}) — rerun scripts/refresh-legacy-resource-flags.mjs`)
    }
  }
}

/* ── O: every gap row is classified, and the classification means what it says ───────────
   "1,845 groups have nothing" is four situations wearing one number, and the map and the
   exported table each state the split. They did not agree: the table tested sign language
   first, the map tested private-use first, so 47 Deaf groups landed in different buckets and
   the Deaf share read 136 in one place and 183 in the other. Both were internally consistent
   and they told different stories, which is worse than one of them simply being wrong.

   This holds the table to three things a reader depends on: every tier-0 group appears
   exactly once, every row carries a kind, and a sign language is ALWAYS labelled as one —
   never as an unindexable code — because being Deaf is the actionable fact and every
   private-use code in this gap belongs to a sign language anyway. */
{
  let t
  try { t = read('data/tables/gospel-gaps.json') } catch { t = null }
  if (t) {
    const tier0 = rows.filter((r) => r[6] === 0).length
    const gapRows = (t.rows || []).length
    if (tier0 !== gapRows) {
      add('O', `the gap table has ${gapRows} row(s) but ${tier0} pin(s) are tier 0 — one of them is stale`)
    }
    const unclassified = (t.rows || []).filter((r) => (poisonGapKind ? true : !r.gap_kind)).length
    if (unclassified) add('O', `${unclassified} gap row(s) carry no gap_kind`)
    const mislabelled = (t.rows || []).filter((r) => {
      const c = codes[r.iso639_3]
      return c && c.sg === 1 && !/sign language/.test(r.gap_kind || '')
    })
    if (mislabelled.length) {
      add('O', `${mislabelled.length} sign-language row(s) are not labelled as sign languages (e.g. ${mislabelled.slice(0, 3).map((r) => r.iso639_3).join(', ')}) — the Deaf share of the gap will read low`)
    }
  }
}

const clauses = new Set(fails.map((f) => f.slice(3, 4)))
if (POISON) {
  // D is included deliberately: it is the clause that would have caught the 506
  // resources dropped from a table titled "every link", and the most valuable clause is
  // the worst one to leave unproven. The injected codes above (und, zzq) are absent from
  // the table, so they poison D as well as A and B.
  const want = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']
  const caught = want.filter((c) => clauses.has(c))
  console.log(`COVERAGE-CONSISTENT --poison: ${caught.length}/${want.length} clause(s) caught their injected defect (${caught.join(',')})`)
  if (caught.length !== want.length) {
    console.error(`  MISSED: ${want.filter((c) => !clauses.has(c)).join(',')} — those clauses cannot fail and prove nothing.`)
    process.exit(1)
  }
  console.log('COVERAGE-CONSISTENT: SELF-TEST PASS — every poisoned clause fails as designed.')
  process.exit(0)
}

if (fails.length) {
  console.error(`COVERAGE-CONSISTENT: FAIL — ${fails.length} problem(s):`)
  for (const f of fails.slice(0, 20)) console.error(f)
  process.exit(1)
}
console.log(`COVERAGE-CONSISTENT: PASS — ${rows.length} pins, ${Object.keys(codes).length} codes, ${trows.length} table rows agree.`)
// Name every clause. A summary that lists four of nine reads as a narrower check than it
// is, and the next reader calibrates their trust on this line rather than the source.
console.log('  A no resource on an ISO reserved code   B every resourced code is named')
console.log('  C reach recounted off the pins          D every resourced code is in the table')
console.log('  E no table URL the pins do not hold     F pin tiers match their code\'s URLs')
console.log('  G no plain-http URL                     H no story set typed as Scripture')
console.log('  I row type agrees with its host    J approximate never reads as confirmed')
console.log('  K every shipped link is verified, and none known-broken ships')
console.log('  L the verification record is current, not merely consistent')
console.log('  M a pool named as checked was really searched for that code')
console.log('  N a table\'s has-anything column agrees with the pin tier')
console.log('  O every gap row is classified, and a sign language says so')
