/**
 * check-no-conflict-markers.mjs — nothing tracked may carry an unresolved merge.
 *
 * THE INCIDENT. A merge commit from this worktree landed the BUILT bundle
 * public/doxa-maps/gospel-resources/gospel-resources.js with 21 conflict markers in it —
 * both sides concatenated, 1.13 MB. The browser threw "Identifier Ge has already been
 * declared" and every gospel leaf rendered dead, while the SRI hash still matched, every
 * request still returned 200, and no probe could see an error.
 *
 * THE CAUSE WAS A LANDING SCRIPT, NOT A BAD MERGE. The loop resolved the one file it
 * expected to conflict and then ran `git add -A public`, which stages EVERY file under
 * public/ — including the ones still holding markers. A one-line convenience that turns a
 * conflict git correctly refused to guess at into a committed artefact.
 *
 * AND THE FIRST DIAGNOSIS WAS WRONG. I attributed the duplicate identifier to a module
 * imported twice and re-routed an import to "fix" it. That change was harmless but it was
 * not the cause; the rebuild that came with it is what repaired the file. A plausible cause
 * that a fix appears to confirm is the easiest kind of wrong answer, and the only defence is
 * a check that names the real condition.
 *
 * THE RULE, for a BUILT file especially: never hand-merge, never take both. Take either
 * side, REBUILD, commit the rebuild. Then run this before pushing.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const POISON = process.argv.includes('--poison')

/* Built from char codes so this file never contains a marker and never trips itself. */
const OPEN = String.fromCharCode(60).repeat(7)
const MID = String.fromCharCode(61).repeat(7)
const CLOSE = String.fromCharCode(62).repeat(7)
const MARKER = new RegExp('^(' + OPEN + '|' + MID + '$|' + CLOSE + ')', 'm')
const scan = (text) => MARKER.test(text)

if (POISON) {
  const fake = 'a\n' + OPEN + ' HEAD\nmine\n' + MID + '\ntheirs\n' + CLOSE + ' other\n'
  if (!scan(fake)) {
    console.error('NO-CONFLICT-MARKERS: SELF-TEST FAIL — a textbook conflict was not detected.')
    process.exit(1)
  }
  console.log('NO-CONFLICT-MARKERS: SELF-TEST PASS — a textbook conflict is detected.')
  process.exit(0)
}

const tracked = execSync('git ls-files -z', { cwd: REPO, maxBuffer: 1 << 28 })
  .toString('utf8').split(String.fromCharCode(0)).filter(Boolean)

const hits = []
for (const f of tracked) {
  let text
  try { text = readFileSync(resolve(REPO, f), 'utf8') } catch { continue }
  if (text.indexOf(String.fromCharCode(0)) >= 0) continue
  if (scan(text)) hits.push(f)
}

if (hits.length) {
  console.error('NO-CONFLICT-MARKERS: FAIL — ' + hits.length + ' tracked file(s) carry an unresolved merge:')
  for (const f of hits.slice(0, 10)) console.error('  ' + f)
  console.error('  For a BUILT file: take either side, REBUILD the bundle, commit the rebuild.')
  console.error('  Never "add -A" a directory mid-merge — it stages the markers with everything else.')
  process.exit(1)
}
console.log('NO-CONFLICT-MARKERS: PASS — ' + tracked.length + ' tracked file(s), none mid-merge.')
