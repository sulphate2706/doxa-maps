#!/usr/bin/env node
/**
 * check-verification-tags.mjs — enforce POL-two-kinds-of-verification on the builder backlog.
 *
 * THE DEFECT THIS CATCHES. A card was closed `status: "done"` on an agent measurement, the Driver saw
 * the bug still happening, and the card had NO FIELD in which that disagreement could be recorded. So
 * the board said "done" and the product said "broken" and nothing in the data knew. It happened at
 * least twice before the policy existed:
 *   - duplicate badges: closed on LEAF-page evidence while the Driver was looking at the COMPOSITE;
 *   - filter dropdown: closed on the dashboard header while five more dropdowns live in the grid.
 *
 * ★ THE POINT IS NOT TO REQUIRE HUMAN SIGN-OFF. The Driver explicitly rejected that — "the backlog
 * would be entirely gated by humans and things would be super slow." An agent MAY close a card alone.
 * What this gate forbids is closing one ANONYMOUSLY, so that nobody can later ask "which of these did
 * a human actually look at?"
 *
 * ★ THE ASYMMETRY THIS ENCODES (Driver's own words): human verification is more reliable on VISUAL
 * bugs; agent verification is more reliable on NON-VISUAL bugs. A headless probe reads geometry, not
 * perception — it can measure that a menu is at dTop=4 and still be blind to it feeling wrong. So a
 * VISUAL card closed on agent evidence is a HYPOTHESIS; a STATE card closed on agent evidence is a
 * RESULT. The gate reports them separately rather than lumping them into one "done" number.
 *
 * WHAT IT ASSERTS:
 *   1. every done card carries fields.verification in {agent,human,both};
 *   2. no card claims human_verified without human_evidence — an agent must never grant human
 *      verification to itself, and a quote is what makes that auditable;
 *   3. a card with verification_conflict is NOT in status done (a conflict means reopen);
 *   4. (report-only) how many done cards are agent-only VISUAL — the unpaid-attention ledger.
 *
 * Assertion 4 never fails the build. It is a NUMBER TO WATCH, not a rule to obey; failing on it would
 * gate the board on human review, which is the exact thing the policy rejects.
 *
 * NEGATIVE-TESTED: deleting fields.verification from one done card fails assertion 1 by name; setting
 * human_verified with no human_evidence fails assertion 2; marking a conflict card done fails 3.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKLOG = join(ROOT, '../_qa-cycle/02-builder-cycle/backlog.json')

if (!existsSync(BACKLOG)) {
  // The _qa-cycle lives outside every repo the CI clones, so absence is EXPECTED there and must not
  // fail the build. Say so loudly rather than passing silently, or this gate becomes one that cannot
  // fail — the failure mode the repo has already been bitten by once.
  console.log('VERIFY-TAGS: SKIP — backlog.json not present (expected in CI; _qa-cycle is not cloned).')
  process.exit(0)
}

const b = JSON.parse(readFileSync(BACKLOG, 'utf8'))
const cards = b.cards || []
const done = cards.filter((c) => c.status === 'done')
const errs = []

// 1 — every done card names its verification kind
const untagged = done.filter((c) => !(c.fields && c.fields.verification))
if (untagged.length) {
  errs.push(
    `${untagged.length} done card(s) carry no fields.verification.\n` +
    '  A bare status:"done" cannot answer "did a human ever look at this?". Tag each one "agent",\n' +
    '  "human" or "both", and set verification_kind to "visual" or "state".\n' +
    untagged.slice(0, 8).map((c) => '    - ' + c.id).join('\n') +
    (untagged.length > 8 ? `\n    …and ${untagged.length - 8} more` : '')
  )
}

// 2 — human verification requires a quote; an agent must not self-grant it
const unquoted = cards.filter(
  (c) => c.fields && c.fields.human_verified && !String(c.fields.human_evidence || '').trim()
)
if (unquoted.length) {
  errs.push(
    `${unquoted.length} card(s) claim human_verified with no human_evidence.\n` +
    '  Only the Driver grants human verification, and the quote is what makes that checkable. Without\n' +
    '  it, an agent can quietly promote its own agent-verification into a human one — which would erase\n' +
    '  the single distinction this whole policy exists to preserve.\n' +
    unquoted.map((c) => '    - ' + c.id).join('\n')
  )
}

// 3 — a conflict is an open card, by definition
const wrongly = cards.filter((c) => c.fields && c.fields.verification_conflict && c.status === 'done')
if (wrongly.length) {
  errs.push(
    `${wrongly.length} card(s) are marked verification_conflict AND done.\n` +
    '  A conflict means a tool says fixed while the Driver says broken. That is not a done card; it is\n' +
    '  the strongest available signal that the probe measured the wrong surface. Reopen it.\n' +
    wrongly.map((c) => '    - ' + c.id).join('\n')
  )
}

if (errs.length) {
  console.error('VERIFY-TAGS: FAIL')
  errs.forEach((e) => console.error('  ' + e))
  process.exit(1)
}

// 4 — the ledger (report-only, never fails)
const agentVisual = done.filter((c) => c.fields.verification === 'agent' && c.fields.verification_kind === 'visual')
const agentState = done.filter((c) => c.fields.verification === 'agent' && c.fields.verification_kind === 'state')
const humanSeen = done.filter((c) => c.fields.human_verified)

console.log(`VERIFY-TAGS: PASS — ${done.length} done card(s), all tagged.`)
console.log(`  human-confirmed .............. ${humanSeen.length}`)
console.log(`  agent-only, STATE  (strong) .. ${agentState.length}  — counts, routing, file shapes; no human needed`)
console.log(`  agent-only, VISUAL (weak) .... ${agentVisual.length}  — ★ closed on geometry, never on perception`)
console.log('  The last number is the unpaid-attention ledger: cards a tool called fixed on a question')
console.log('  only an eye can settle. It is not an error — it is the list to hand the Driver when he')
console.log('  next says a bug is still there, before investigating anything from scratch.')
