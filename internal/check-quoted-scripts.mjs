#!/usr/bin/env node
/**
 * check-quoted-scripts.mjs — a doc that QUOTES package.json must still match package.json.
 *
 * THE BUG THIS EXISTS TO PREVENT (real, twice)
 * documentation/README-SECTION-3-cli-commands.md reproduces the `scripts` block verbatim so a reader can
 * see every command without opening package.json. It carries its own warning two lines above the
 * block: "If you edit package.json, re-transcribe this block — a doc that QUOTES a config is
 * claiming to be ground truth, and this one had silently stopped being it."
 *
 * It then silently stopped being it AGAIN. Two entries had drifted on 2026-09-21:
 *   - `cap:sync` still showed `bunx cap sync android` — the exact command that does not exist in
 *     this environment (exit 127) and that package.json had ALREADY been fixed away from.
 *   - `build:unlocked` was missing `check:public-hygiene` and `check:label-joins`. That is the
 *     worst shape of this defect: a reader auditing what the build verifies would conclude the
 *     SECRET-SCAN is not in the chain. An omission in a quoted list is invisible — there is no
 *     wrong character to notice, just a step that is not there.
 *
 * ★ WHY A GATE AND NOT A BETTER WARNING. The file already had the warning, written by someone who
 * had just been burned, and the warning did not work — because re-transcribing by hand is exactly
 * the kind of mechanical task a human or an agent skips when the edit felt unrelated. The rule was
 * enforced only by remembering. This is the same failure the library-index gate was built for:
 * a documented invariant with no mechanism behind it is a wish.
 *
 * WHY COMPARE AGAINST package.json AND NOT A SNAPSHOT
 * package.json is the thing that RUNS. The doc is the copy. So the authority is unambiguous and
 * the fix direction is always "update the doc" — never the reverse.
 *
 * WHAT IT TOLERATES DELIBERATELY
 *   - Trailing ` # comment` in a package.json body: several scripts carry an inline explanation
 *     that the doc block reasonably omits. Compared against the code half only.
 *   - JSON escaping (\" in the doc's fenced block) and a trailing comma.
 *   - Entries the doc chooses NOT to quote: this checks the ones it DOES quote, so the doc can
 *     stay a curated subset. It reports the count so shrinkage is visible.
 *
 * ★ THE MATCHER MUST NOT SILENTLY MATCH NOTHING. The first version of this regex required each
 * line to END in a quote (`"$`). Nine of the ten entries end in `",` — a trailing comma — so it
 * matched exactly ONE (`phone`, the last entry, the only one without a comma) and reported
 * "0 drifted". That is a pass that means nothing, and it looks identical to a real clean run.
 * (My first guess at the cause was "the block is indented"; it is NOT indented — checking rather
 * than assuming is what found the trailing comma. A plausible explanation for a broken measurement
 * is still a fabricated one until verified.)
 * Hence MIN_EXPECTED below: too few matches is itself a FAILURE, not a quiet success.
 *
 * NEGATIVE-TESTED: reverting `cap:sync` in the doc to `bunx cap sync android` makes this FAIL
 * naming that entry and showing both sides; restoring it returns PASS. Breaking the regex so it
 * matches < MIN_EXPECTED also FAILs rather than passing vacuously.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'package.json')
const DOC = join(ROOT, 'documentation', 'README-SECTION-3-cli-commands.md')

// The doc quoted 10 entries when this gate was written. If the matcher suddenly finds far fewer,
// the matcher is broken, not the doc.
const MIN_EXPECTED = 6

if (!existsSync(DOC)) {
  console.log('QUOTED-SCRIPTS: SKIP — documentation/README-SECTION-3-cli-commands.md not present.')
  process.exit(0)
}

const scripts = JSON.parse(readFileSync(PKG, 'utf8')).scripts || {}
const doc = readFileSync(DOC, 'utf8')

// Indent-tolerant: the block is inside a fenced code block and is indented.
const RE = /^[ \t]*"([a-z0-9:_-]+)":\s+"(.*?)",?[ \t]*$/gm

const drift = [], unknown = []
let quoted = 0

for (const m of doc.matchAll(RE)) {
  const name = m[1]
  const shown = m[2].replace(/\\"/g, '"').replace(/,$/, '').trim()
  if (!(name in scripts)) { unknown.push(name); continue }
  quoted++
  const real = scripts[name]
  const realCode = real.split(/\s{2,}#/)[0].trim()   // drop an inline ` # …` explanation
  if (shown !== real.trim() && shown !== realCode) drift.push({ name, shown, real: realCode })
}

console.log(`QUOTED-SCRIPTS: ${quoted} quoted entr(ies) compared against package.json.`)

if (quoted < MIN_EXPECTED) {
  console.error(`\nQUOTED-SCRIPTS: FAIL — only ${quoted} entries matched (expected >= ${MIN_EXPECTED}).`)
  console.error('  The MATCHER is broken, not the doc. A checker that matches almost nothing')
  console.error('  reports "0 drifted" and looks exactly like a clean pass — fix the regex in')
  console.error('  internal/check-quoted-scripts.mjs before trusting this result.')
  process.exit(1)
}

if (unknown.length) {
  console.log(`  i quoted but not in package.json (ignored): ${unknown.join(', ')}`)
}

if (drift.length) {
  console.error(`\nQUOTED-SCRIPTS: FAIL — ${drift.length} quoted script(s) no longer match package.json:`)
  for (const d of drift) {
    console.error(`\n  ✗ ${d.name}`)
    console.error(`      doc  : ${d.shown}`)
    console.error(`      real : ${d.real}`)
  }
  console.error('\n  package.json is what RUNS; the doc is the copy — update the DOC to match.')
  console.error('  An omitted step in a quoted list is invisible: there is no wrong character to')
  console.error('  notice, just a check the reader believes is not in the chain.')
  process.exit(1)
}
console.log('QUOTED-SCRIPTS: PASS — every quoted script matches package.json.')
