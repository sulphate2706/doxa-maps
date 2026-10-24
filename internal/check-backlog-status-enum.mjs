#!/usr/bin/env node
/**
 * check-backlog-status-enum.mjs — a card's `status` must be a machine-readable enum, not prose.
 *
 * THE DEFECT THIS CATCHES, and it was MY OWN reporting error for an entire flight. Cards were being
 * written with explanatory statuses:
 *
 *     "done — reconciled: big-picture + dashboard-plus-grid are current, unified-research-dashboard…"
 *     "blocked — Steps 1+3 DONE and re-verified 2026-09-22 at 19/19 bundles…"
 *     "ready"
 *
 * The prose is genuinely valuable — several of those strings carry measurements — but it made
 * `status` unqueryable. Every count I reported used `status !== 'done'`, which is FALSE for
 * `"done — reconciled: …"`, so finished cards kept being counted as open.
 *
 * MEASURED 2026-09-22 across the three phase backlogs: 130 of 395 cards carried a prose status, and
 * 71 of those were ALREADY DONE. Reported open was 176; the real number was 105. The P0 figure I had
 * been quoting every tick was 21; it was actually 14.
 *
 * ★ WHY THIS IS WORSE THAN AN ORDINARY OFF-BY-N. A backlog is a decision instrument — it answers
 * "what is left" and "is the remaining work human-gated". Inflating the open count makes a drained
 * board look stalled, which pushes toward manufacturing work rather than holding honestly. And the
 * error is self-concealing: every individual card reads correctly to a human, because the prose says
 * exactly what is true. Only the AGGREGATE is wrong.
 *
 * THE FIX PRESERVES THE PROSE. Migration moved it to `fields.status_detail` and normalised `status`
 * to the enum; 130/130 preserved, 0 lost. The explanation was never the problem — putting it in the
 * field that tooling reads was.
 *
 * WHAT IT ASSERTS: every card's `status` is ONE WORD from a closed set — the five workflow
 * states plus four terminal ones (superseded / deferred / decided / verified-already-true).
 * The point is not the particular words: it is that `status` stays machine-readable so the
 * open-count is right. Prose belongs in fields.status_detail.
 *
 * It deliberately does NOT require `status_detail` to exist. Most cards need no explanation, and
 * demanding one would turn a real check into paperwork that gets satisfied with filler.
 *
 * NEGATIVE-TESTED: setting one card's status back to "done — reconciled: …" fails by name.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const QA = join(ROOT, '../_qa-cycle')
const PHASES = ['01-ideation-research', '02-builder-cycle', '03-deployment-cycle']
// ★ THE ENUM WAS TOO NARROW, not the cards wrong. MEASURED 2026-09-24 across 633 cards:
// EIGHT distinct status values are in use and EVERY ONE IS A SINGLE WORD — there is no
// prose left anywhere in the field. The nine this gate was failing carried legitimate
// TERMINAL states the original enum simply predated: superseded (5), deferred (2),
// decided, verified-already-true.
//
// This gate exists to keep the AGGREGATE honest — "a prose status makes every open-count
// wrong while each card still READS correctly". A one-word terminal state serves that
// purpose perfectly; it is exactly what the 130-card migration was FOR. Rewriting nine
// accurate statuses to 'done' would have destroyed real distinctions (a SUPERSEDED card
// was replaced by another; a DEFERRED one was consciously postponed; neither was
// finished) to satisfy a list — losing information to make a checker green.
//
// OPEN vs CLOSED is the property that matters, and all four additions are CLOSED:
// open = todo + doing + in-progress (66), closed = done + these four (507), blocked (60).
const TERMINAL_EXTRA = ['superseded', 'deferred', 'decided', 'verified-already-true']
const ALLOWED = new Set(['todo', 'doing', 'in-progress', 'blocked', 'done', ...TERMINAL_EXTRA])

if (!existsSync(QA)) {
  // _qa-cycle lives outside every repo the CI clones, so absence is EXPECTED there. Say so loudly
  // rather than passing silently — a gate that reports success when it never ran is the failure
  // mode this repo has already been bitten by.
  console.log('BACKLOG-STATUS: SKIP — _qa-cycle not present (expected in CI; it is in no repo).')
  process.exit(0)
}

const offenders = []
let total = 0
const counts = {}

for (const ph of PHASES) {
  const p = join(QA, ph, 'backlog.json')
  if (!existsSync(p)) continue
  let cards
  try {
    cards = JSON.parse(readFileSync(p, 'utf8')).cards || []
  } catch (e) {
    console.error(`BACKLOG-STATUS: FAIL — ${ph}/backlog.json does not parse: ${e.message}`)
    process.exit(1)
  }
  for (const c of cards) {
    total++
    const s = String(c.status)
    counts[s] = (counts[s] || 0) + 1
    if (!ALLOWED.has(s)) offenders.push({ ph, id: c.id, s })
  }
}

if (!total) {
  console.error('BACKLOG-STATUS: FAIL — found 0 cards across three phase backlogs.')
  console.error('  A gate with nothing to assert is not passing; it is not running.')
  process.exit(1)
}

if (offenders.length) {
  console.error(`BACKLOG-STATUS: FAIL — ${offenders.length} of ${total} card(s) carry a non-enum status.\n`)
  for (const o of offenders.slice(0, 12)) {
    console.error(`  ${o.ph}  ${o.id}`)
    console.error(`      status: "${o.s.slice(0, 84)}${o.s.length > 84 ? '…' : ''}"`)
  }
  if (offenders.length > 12) console.error(`  …and ${offenders.length - 12} more`)
  console.error('\n  Allowed: ' + [...ALLOWED].join(' / '))
  console.error('  Keep the explanation — move it to fields.status_detail. The prose is valuable and')
  console.error('  often carries measurements; it just must not live in the field tooling filters on.')
  console.error('  A prose status makes every open-count wrong while each card still READS correctly,')
  console.error('  so the error hides in the aggregate: 130 of 395 cards once carried one, 71 of them')
  console.error('  already done, and the reported open count was 176 against a real 105.')
  process.exit(1)
}

console.log(`BACKLOG-STATUS: PASS — ${total} card(s), every status is a queryable enum.`)
const order = ['todo', 'doing', 'in-progress', 'blocked', 'done']
console.log('  ' + order.filter((k) => counts[k]).map((k) => `${k} ${counts[k]}`).join(' · '))
console.log('  Explanations live in fields.status_detail, which is not required — most cards need')
console.log('  none, and demanding one would turn this into paperwork satisfied with filler.')
