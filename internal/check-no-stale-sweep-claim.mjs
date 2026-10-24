/**
 * check-no-stale-sweep-claim.mjs — a caveat that has stopped being true is a wrong number.
 *
 * THE BUG, THREE TIMES. The gospel surfaces carry a paragraph telling the reader how much
 * "nothing found" is worth: which pools were searched, and which were not. Twice already that
 * paragraph had to stop claiming a pool was unsearched — once when Faith Comes By Hearing was
 * added, once when GRN was reached through 5fish — and resources-map.vue carries a comment
 * saying so, written by whoever fixed it the second time.
 *
 * It happened a third time anyway. The GRN sweep ran a batch at a time at the ten-second crawl
 * delay 5fish asks for, and while it ran, every surface truthfully said "part of that pool is
 * still unread". The sweep finished. The sentence did not change. So the map went on telling
 * readers that the largest gospel-audio catalogue on it was only partly searched, on the one
 * paragraph whose entire job is calibrating trust in the gap. Nothing failed; nothing could.
 * It was found by reading a screenshot.
 *
 * WHY A GATE AND NOT MORE CARE. The comment asking for care was already there, in the file,
 * two lines above the stale sentence. Care is not a mechanism.
 *
 * THE RULE. The DATA decides whether the claim is allowed. If every language code the map
 * carries has been decided by the pool's index, then no surface may state in prose that part
 * of that pool is unread. If codes really are undecided, the claim is true and this passes —
 * so the check re-enables itself automatically the next time a slow pool starts sweeping.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG. A claim rendered under a v-if on the pending COUNT is
 * data-driven: it disappears on its own when the count reaches zero, which is the correct
 * construction and the one that should be copied. Flagging it would punish the fix. Lines
 * inside such a block are skipped, and the block is tracked by nesting rather than by
 * proximity, because a detector that cannot see how the expression is guarded reports the
 * wrong thing confidently — the failure this bundle has now met in a forced token, a
 * swallowed flag and a class extractor.
 *
 * Run with --poison to prove it can fail.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DIR = resolve(REPO, 'plugin-designs/gospel-resources')
const POISON = process.argv.includes('--poison')

/** Prose that asserts, in the present tense, that part of a pool has not been read. */
const CLAIMS = [
  /part of (?:that|this|it|the) pool is still unread/i,
  /part of it is still unread/i,
  /is being swept\b/i,
  /is swept a batch at a time/i,
  /so part of that pool is still unread/i,
  /still being crawled/i,
]

/** A guard whose value IS the pending count: the claim inside it cannot go stale. */
const PENDING_GUARD = /v-if="[^"]*\b(?:pending|notYetSwept|unswept)\b[^"]*"/

/* ── is the pool actually finished? ─────────────────────────────────────────────────────── */
const grn = JSON.parse(readFileSync(resolve(REPO, 'data/tables/grn-index.json'), 'utf8'))
const decided = new Set([...Object.keys(grn.byIso || {}), ...(grn.none || [])])
const { codes } = JSON.parse(readFileSync(resolve(REPO, 'data/tables/people-group-pins.json'), 'utf8'))

/* WHICH CODES THE CAVEAT IS ABOUT, and this is the whole subtlety.
 *
 * The sentence being judged calibrates "NOTHING FOUND". So the population it speaks for is the
 * gap: tier-0 pins, minus sign languages, which are skipped on purpose because GRN publishes
 * audio. The sweep ran against exactly that population and finished it.
 *
 * It did NOT ask GRN about the 3,202 codes that already carry a resource, and a first draft of
 * this check measured those instead — reporting 3,202 undecided and skipping, which would have
 * let the stale sentence stand. The wider number is real and belongs in its own caveat one day
 * (a Words of Life recording for a group that already has text is still worth surfacing), but
 * it is NOT what "nothing found" depends on, and conflating the two is how a check ends up
 * measuring something true and irrelevant. */
const { pins } = JSON.parse(readFileSync(resolve(REPO, 'data/tables/people-group-pins.json'), 'utf8'))
const carried = [...new Set(
  pins.filter((p) => p[6] === 0 && p[4] && codes[p[4]] && codes[p[4]].sg !== 1).map((p) => p[4]),
)]
const pending = carried.filter((c) => !decided.has(c))

if (pending.length) {
  console.log(
    `NO-STALE-SWEEP-CLAIM: SKIP — ${pending.length} of ${carried.length} gap code(s) are ` +
      'genuinely undecided, so a surface saying the pool is part-read is telling the truth.',
  )
  process.exit(0)
}

/* ── the claim is no longer allowed ─────────────────────────────────────────────────────── */
function offendersIn(src, label) {
  const out = []
  const lines = src.split('\n')
  let guard = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (guard > 0) {
      if (/<\/template>/.test(line)) guard--
      else if (/<template\b/.test(line)) guard++
      continue
    }
    if (/<template\b/.test(line) && PENDING_GUARD.test(line)) { guard = 1; continue }
    for (const re of CLAIMS) {
      if (re.test(line)) { out.push(`${label}:${i + 1}  ${line.trim().slice(0, 96)}`); break }
    }
  }
  return out
}

const surfaces = readdirSync(DIR).filter((f) => f.endsWith('.vue'))
if (!surfaces.length) {
  console.error('NO-STALE-SWEEP-CLAIM: no .vue surfaces found — the check would pass vacuously.')
  process.exit(1)
}

if (POISON) {
  const INJECT = '        crawl delay they ask for, so part of that pool is still unread.\n'
  let caught = 0
  for (const f of surfaces) {
    const poisoned = `${readFileSync(resolve(DIR, f), 'utf8')}\n${INJECT}`
    if (offendersIn(poisoned, f).length) caught++
    else console.error(`  NOT CAUGHT in ${f}`)
  }
  /* And the guarded form must NOT be caught, or the check punishes the correct construction. */
  const guarded =
    '        <template v-if="gapMakeup.pending">\n' +
    '          GRN is being swept, so part of that pool is still unread.\n' +
    '        </template>\n'
  const falsePositive = offendersIn(guarded, 'guarded-sample')
  if (caught === surfaces.length && !falsePositive.length) {
    console.log(`NO-STALE-SWEEP-CLAIM --poison: ${caught}/${surfaces.length} surface(s) caught the stale claim, and the data-driven form was not flagged.`)
    console.log('NO-STALE-SWEEP-CLAIM: SELF-TEST PASS — the check fails as designed.')
    process.exit(0)
  }
  if (falsePositive.length) console.error(`  FALSE POSITIVE on the guarded form: ${falsePositive[0]}`)
  console.error('NO-STALE-SWEEP-CLAIM: SELF-TEST FAIL.')
  process.exit(1)
}

const offenders = surfaces.flatMap((f) => offendersIn(readFileSync(resolve(DIR, f), 'utf8'), f))
if (offenders.length) {
  console.error(
    `NO-STALE-SWEEP-CLAIM: FAIL — every one of ${carried.length} gap code(s) has been decided, but ` +
      `${offenders.length} line(s) still tell the reader the pool is part-read:`,
  )
  for (const o of offenders) console.error(`  ${o}`)
  console.error('  Say the sweep finished, and name what is genuinely still unchecked. If you')
  console.error('  want a claim that expires on its own, render it under a v-if on the count.')
  process.exit(1)
}
console.log(
  `NO-STALE-SWEEP-CLAIM: PASS — all ${carried.length} gap code(s) decided, and no surface ` +
    `claims otherwise (${surfaces.length} file(s) checked).`,
)
