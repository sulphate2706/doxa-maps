#!/usr/bin/env node
/**
 * check-backlog-refs.mjs — a card may not point at a card that does not exist.
 *
 * THE DEFECT THIS CATCHES. `depends_on` is the board's readiness mechanism: a card is ready when
 * its dependencies are done. A dependency naming a card that is NOT IN THE BACKLOG can never be
 * done, so the card can never become ready — and nothing says so. It reads as ordinary blocked
 * work forever.
 *
 * MEASURED 2026-09-24, three dangling references across the builder backlog:
 *   IDEA-SLIM-MAP-SEARCHBAR-HOW-DO-FILTERS-FIT          <- BUILD-PEOPLE-GROUP-SEARCH-…depends_on
 *   IDEA-REGIONS-DASHBOARD-REVERSE-ENGINEER-DXLIFE      <- two regions cards' depends_on
 *   PRINCIPLE-MAPS-ARE-SECONDARY-LISTS-AND-GRIDS-ARE-PRIMARY  <- two cards' parent
 * The first one matters most: that card is status:todo and waiting on something unfindable.
 * The last is cited by the loop prompt itself as an open card ("PRINCIPLE-MA"), so a reader is
 * being pointed at work that has no record.
 *
 * ★ SEVERITY IS NOT UNIFORM, so this gate grades it. A dangling `depends_on` on an OPEN card is a
 * FAILURE — that card is unreachable. A dangling `parent`, or a dangling anything on a card that is
 * already done, is REPORTED but does not fail: losing a parent is a filing problem, not a blocked
 * one, and failing on it would only teach people to delete the reference rather than restore the
 * card. Naming the difference is the point.
 *
 * ⚠ IT ONLY CHECKS REFERENCES THAT LOOK LIKE CARD IDS. Fields like `parent` also legitimately hold
 * prose in some cards ("the regions epic"), and treating those as broken links would drown the
 * real ones. The shape is SCREAMING-KEBAB, 9+ chars — the convention every id in this board uses.
 *
 * Usage: node internal/check-backlog-refs.mjs
 *   SKIPs when _qa-cycle is absent (it lives outside every repo, by design).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const QA = process.env.QA_CYCLE || resolve(HERE, '..', '..', '_qa-cycle')
if (!existsSync(QA)) {
  console.log('BACKLOG-REFS: SKIP — _qa-cycle not present (expected in CI; it is in no repo).')
  console.log('  This gate reads the AGENTIC BACKLOGS, which live outside the repo and are not')
  console.log('  cloned with it. Absence is expected; it is NOT a pass.')
  process.exit(0)
}

const PHASES = ['01-ideation-research', '02-builder-cycle', '03-deployment-cycle']
const REF_FIELDS = ['parent', 'depends_on', 'blocks', 'supersedes', 'supersedes_mechanism_of']
// The id convention every card in this board follows. Prose in a `parent` field must NOT match.
const ID_SHAPE = /^[A-Z][A-Z0-9-]{8,}$/

const cards = []
for (const phase of PHASES) {
  const p = join(QA, phase, 'backlog.json')
  if (!existsSync(p)) continue
  const j = JSON.parse(readFileSync(p, 'utf8'))
  for (const c of j.cards || []) cards.push({ ...c, _phase: phase })
}
if (!cards.length) {
  console.log('BACKLOG-REFS: SKIP — no cards found in any phase backlog.')
  process.exit(0)
}

const ids = new Set(cards.map((c) => c.id))
const OPEN = new Set(['todo', 'doing', 'in-progress', 'blocked'])

const blocking = []   // dangling depends_on on an OPEN card — the card can never become ready
const noted = []      // everything else dangling — filing debt, reported not failed

for (const c of cards) {
  const f = c.fields || {}
  for (const key of REF_FIELDS) {
    const raw = f[key] !== undefined ? f[key] : c[key]
    if (!raw) continue
    for (const ref of (Array.isArray(raw) ? raw : [raw])) {
      if (typeof ref !== 'string' || !ID_SHAPE.test(ref)) continue
      if (ids.has(ref)) continue
      const entry = { from: c.id, key, ref, status: c.status || '(none)' }
      if (key === 'depends_on' && OPEN.has(String(c.status || '').toLowerCase())) blocking.push(entry)
      else noted.push(entry)
    }
  }
}

console.log(`BACKLOG-REFS: ${cards.length} card(s) across ${PHASES.length} backlog(s), `
  + `${REF_FIELDS.length} reference field(s) checked.`)
if (noted.length) {
  console.log(`  ${noted.length} dangling reference(s) that do NOT block anything:`)
  for (const n of noted) console.log(`    ${n.from} [${n.status}] .${n.key} -> ${n.ref}`)
  console.log('    Filing debt: a lost parent or a stale link on a finished card. Restore the card')
  console.log('    or drop the reference — but do not delete it just to quiet this line.')
}

if (blocking.length) {
  console.error(`\nBACKLOG-REFS: FAIL — ${blocking.length} OPEN card(s) depend on a card that does not exist.`)
  for (const b of blocking) {
    console.error(`  ✗ ${b.from} [${b.status}] depends_on ${b.ref}`)
  }
  console.error('\n  A dependency that is not in the backlog can never be done, so these cards can')
  console.error('  never become ready — and nothing says so. They read as ordinary blocked work.')
  console.error('  Fix: restore the missing card, or remove the dependency if it is obsolete.')
  process.exit(1)
}
console.log('BACKLOG-REFS: PASS — every open card\'s dependencies name a card that exists.')
