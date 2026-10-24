#!/usr/bin/env node
/**
 * check-done-evidence.mjs — a card may not reach status:done with NO evidence.
 *
 * WHY (2026-09-21)
 * Two quality cards were status:done with an EMPTY bluf. Both turned out genuinely done — but
 * only because I opened a browser and read the source. A board-wide count then found 18 done
 * cards carrying NEITHER a bluf NOR any fields: a status word and nothing else.
 *
 * ★ THE HAND-OFF IS THE POINT. The Doxa team will read this board to learn what exists. A card
 * reading "done" with no evidence cannot be reconciled against the code at all — they cannot
 * tell a shipped deliverable from an abandoned one someone closed. This flight found SIX cards
 * whose stated status disagreed with reality; an evidence-less card is the unfalsifiable case.
 *
 * WHAT COUNTS AS EVIDENCE (deliberately generous — this is a floor, not a style guide)
 * EITHER a non-empty `bluf` OR a non-empty `fields` object. Both are free to write at the moment
 * the work is fresh, which is the only moment the evidence is cheap and accurate.
 *
 * BASELINE, NOT A CLIFF
 * The 10 pre-existing offenders are allow-listed by id. A gate that fails on day one for history
 * nobody can fix gets disabled, and then it protects nothing. This fails ONLY on a NEW one — the
 * same shape as check-label-joins, which allow-lists two known occurrences.
 * ★ TO CLEAR AN ENTRY: add real evidence to the card, then delete its id here. The list should
 * only ever shrink; a PR that grows it is doing the thing this gate exists to stop.
 *
 * NEGATIVE-TESTED: adding a fresh done card with no bluf/fields makes this FAIL naming it,
 * EXIT=1; removing it returns PASS.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ★ DEPTH 2, NOT 1 — and that is deliberate but load-bearing. Every sibling gate in internal/
// resolves ROOT one level up (the repo). This one goes TWO levels up, because the backlogs it
// checks live in `_qa-cycle/`, which is AGENTIC SCRATCH OUTSIDE THE REPO — tracked by no git
// repository, and never cloned with the studio.
//
// THE HAND-OFF DEFECT THIS GUARD FIXES (measured 2026-09-22). On this machine _qa-cycle happens
// to sit beside the repo, so the gate passes. An inheritor who clones ONLY the studio has no
// sibling _qa-cycle — and the gate did NOT fail there. It printed
//     "0 card(s) across 3 backlog(s), 0 done" ... "PASS"
// and exited 0. A VACUOUSLY GREEN gate is worse than no gate: it certifies nothing while looking
// healthy, which is exactly the failure shape this repo keeps re-learning.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const QA = join(ROOT, '_qa-cycle')

if (!existsSync(QA)) {
  console.log('DONE-EVIDENCE: SKIP — no _qa-cycle/ beside this repo, so there are no backlogs to check.')
  console.log('  This gate reads the AGENTIC BACKLOGS, which live outside the repo and are not cloned')
  console.log('  with it. Absence is expected for anyone who checked out the studio on its own; it is')
  console.log('  NOT a pass. Run it from a workspace that has _qa-cycle/ as a sibling of this repo.')
  process.exit(0)
}

const BACKLOGS = [
  '01-ideation-research/backlog.json',
  '02-builder-cycle/backlog.json',
  '03-deployment-cycle/backlog.json',
]

// Pre-existing, from before the rule. Verified 2026-09-21. SHRINK ONLY.
// ★ THE BASELINE IS NOW EMPTY, and that is the strongest state this gate can be in.
// All ten exemptions had since gained evidence — the gate reported every one of them
// as STALE on 2026-09-24 — so the list was pure dead weight: ten ids that exempted
// nothing while implying ten cards still owed a record.
// An EMPTY set is not an unset one: every done card must now carry evidence, with no
// exemptions, and the gate fails outright for a single card that does not. Keeping
// `{ ... }` full of satisfied ids would mean the same today and quietly permit a
// regression the moment someone "reused" an entry.
// If a genuinely un-reconstructable card ever needs an exemption, add its id here WITH
// the reason — and the gate will tell you the day it becomes stale.
const BASELINE = new Set([
])
let checked = 0, done = 0
const offenders = []
const staleBaseline = []

for (const rel of BACKLOGS) {
  const p = join(QA, rel)
  if (!existsSync(p)) continue
  let cards
  try { cards = JSON.parse(readFileSync(p, 'utf8')).cards || [] } catch { continue }
  for (const c of cards) {
    checked++
    if (c.status !== 'done') continue
    done++
    const hasBluf = String(c.bluf || '').trim().length > 0
    const hasFields = c.fields && Object.keys(c.fields).length > 0
    // ★ THE BOARD USES TWO CARD SCHEMAS, and this gate only knew one. Older cards carry
    // `bluf` + `fields`; a second family carries `one_line` (what was done), `why`, and
    // `verify` (the artifact and how it was checked). MEASURED 2026-09-24 across 443 done
    // cards: 40 carry `verify` and 41 carry `one_line`, and ALL THREE cards this gate was
    // failing had one or both — with named probes, assertion counts and negative tests.
    // They were among the best-evidenced cards on the board.
    // `verify` is if anything the STRONGER signal: it names how the claim was checked,
    // which is exactly what "evidence" means here. Demanding a redundant `bluf` alongside
    // it would have taught the next agent to pad the field the checker reads rather than
    // write the record — the gate training the behaviour it exists to prevent.
    const hasVerify = String(c.verify || '').trim().length > 0
    const hasOneLine = String(c.one_line || '').trim().length > 0
    if (hasBluf || hasFields || hasVerify || hasOneLine) {
      // A baselined id that now HAS evidence is stale — report it so the list shrinks.
      if (BASELINE.has(c.id)) staleBaseline.push(`${c.id} (${rel})`)
      continue
    }
    if (BASELINE.has(c.id)) continue
    offenders.push(`${c.id} (${rel})`)
  }
}

console.log(`DONE-EVIDENCE: ${checked} card(s) across ${BACKLOGS.length} backlog(s), ${done} done, ` +
            `${BASELINE.size} baselined.`)
for (const s of staleBaseline) {
  console.log(`  i BASELINE NOW STALE — ${s} has evidence; remove its id from check-done-evidence.mjs`)
}

if (offenders.length) {
  console.error(`\nDONE-EVIDENCE: FAIL — ${offenders.length} card(s) are done with NO evidence in any field:`)
  for (const o of offenders) console.error(`  ✗ ${o}`)
  console.error(
    '\n  Add ONE of: `bluf` or `one_line` saying what was done, `verify` naming how it was checked,\n' +
    '  or a `fields` entry naming the artifact. Any ONE of the four is enough — the point is a\n' +
    '  record a reader can reconcile against the code, not a particular field name.\n' +
    '  it was verified. Write it now, while the work is fresh — reconstructing it later produces a\n' +
    '  plausible story indistinguishable from a real record.'
  )
  process.exit(1)
}
console.log('DONE-EVIDENCE: PASS — every done card carries evidence (bluf, one_line, verify or fields).')
