#!/usr/bin/env node
/**
 * check-no-internal-codename.mjs — an INTERNAL CODE NAME may not ship.
 *
 * WHY. This repo is handed off to the Doxa team. During development it carried an internal code
 * name for the working style/coordinator mode; that name is not the product's name and means
 * nothing to an inheritor. The product is doxa-maps / the plugin studio. A code name surviving into
 * a shipped doc, script or bundle is a hand-off defect of the same family as an absolute path
 * (check:no-abs-paths): harmless to whoever wrote it, confusing to exactly the person who inherits
 * it — and invisible to every other gate, none of which read for vocabulary.
 *
 * ★ THE DISTINCTION THIS GATE MUST GET RIGHT, or it cries wolf and gets switched off. The code name
 * and the DEVELOPMENT MACHINE'S UNIX USERNAME are the same letters. They are not the same defect:
 *   - a code name in prose ("built in <name> style") is a BRAND LEAK — this gate's business;
 *   - the username inside a filesystem path (/home/<user>/…) is a PORTABILITY defect, and
 *     check:no-abs-paths already owns it, with better messages.
 * So a match that sits inside a unix-path context is handed to that gate, not double-reported here.
 * Overlapping gates that disagree about one string is how a repo learns to ignore both.
 *
 * ★ AND THE NUMERIC TRAP. "10x" is ordinary English for a multiplier — library/scripts/research
 * legitimately says a floor is "~10x above a modeled-lazy 5,050". Matching a bare "10x" would flag
 * correct prose forever. Only the FULL two-part name counts (the letters immediately followed by
 * the multiplier, with an optional space/underscore/hyphen between), plus the explicit
 * "<letters> style" phrasing the rule was stated in.
 *
 * ★ WHY THIS FILE IS NOT EXEMPT FROM ITSELF. The sibling check:no-orphan-gates documents the exact
 * bug of a gate that read EVIDENCE out of its own DOCUMENTATION and thereby cleared a file it
 * should have caught; check:no-abs-paths needs an ALLOW entry for its own header for the same
 * reason. Both are real fixes, but an exemption is a hole: a genuine leak pasted into the exempt
 * file would pass. This gate takes the other route — it never spells the forbidden string in its
 * own source. The pattern is assembled from fragments at run time, so there is nothing here to
 * match, and the gate scans itself on exactly the same terms as every other file. No ALLOW list.
 *
 * SCOPE: TRACKED FILES ONLY, via `git ls-files` — the set a clone actually receives. That excludes
 * node_modules, build scratch, and the agentic working tree (_qa-cycle/ is gitignored and ships in
 * no clone), without an ignore list to maintain.
 *
 * REPORTS EVERY HIT IN ONE PASS. Iterating one-at-a-time through a ~100s build is the expensive
 * failure mode, so this names all offending file:line at once.
 *
 * NEGATIVE-TESTED: planting the code name in a tracked shipped file makes this FAIL naming that
 * file and line, EXIT=1; removing it returns PASS, EXIT=0. A repo with too few tracked files FAILS
 * rather than passing vacuously.
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── THE NAME, ASSEMBLED — never written as a literal here (see the header note on self-exemption).
// Fragments so this source contains no matchable copy of the string it forbids.
const A = 'l' + 'k'            // the two letters
const B = '10' + 'x'           // the multiplier half
const SEP = '[ _-]?'           // "<A>10x", "<A> 10x", "<A>_10X", "<A>-10x" are all the same name

const PATTERNS = [
  [new RegExp(A + SEP + B, 'i'), 'internal code name'],
  // The rule as it was stated: "<name> style". Caught separately so the message can say which
  // form was found, and so a future rename of the first half does not silently drop this phrasing.
  [new RegExp(A + SEP + B + SEP + 'style', 'i'), 'internal code name ("… style")'],
]

// A match is NOT a brand leak when it is the unix username inside a path — that is
// check:no-abs-paths' job. Tested against the matched line, anchored on the path syntax
// (a slash before the name, or a `by=`/`user=` style assignment a tool stamped).
const PATH_CONTEXT = new RegExp('(?:/home/|/Users/|~/|\\bby=|\\buser(?:name)?=)' + A + SEP + B, 'i')

// Binary and generated files the name could appear in harmlessly or unavoidably.
const SKIP_EXT = /\.(png|jpe?g|webp|gif|ico|svg|woff2?|ttf|eot|pdf|zip|gz|mbtiles|pmtiles|lock)$/i

let tracked = []
try {
  tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
} catch (e) {
  console.error(`CODENAME: FAIL — could not list tracked files (${String(e.message).slice(0, 60)}).`)
  console.error('  This gate scans `git ls-files`, the set a clone actually receives.')
  process.exit(1)
}

// Vacuous guard: "0 tracked files" must never read as "0 problems". A gate that cannot fail is
// worse than no gate — this repo has shipped one that read 0 while 460 files changed.
const MIN_TRACKED = 50
if (tracked.length < MIN_TRACKED) {
  console.error(`CODENAME: FAIL — only ${tracked.length} tracked file(s) (expected >= ${MIN_TRACKED}).`)
  console.error('  Not a git checkout, or the listing is broken. Refusing to pass vacuously.')
  process.exit(1)
}

const hits = []
const deferred = []          // username-in-path matches, owned by check:no-abs-paths
let scanned = 0

for (const rel of tracked) {
  if (SKIP_EXT.test(rel)) continue
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) continue                                  // staged-deleted file
  let text
  try { text = readFileSync(abs, 'utf8') } catch { continue }      // binary
  if (text.includes('\0')) continue                             // binary that decoded anyway
  scanned++
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const [re, label] of PATTERNS) {
      if (!re.test(line)) continue
      const rec = { rel, line: i + 1, label, text: line.trim().slice(0, 110) }
      if (PATH_CONTEXT.test(line)) deferred.push(rec)
      else hits.push(rec)
      break
    }
  }
}

console.log(`CODENAME: ${scanned} tracked text file(s) scanned.`)

if (deferred.length) {
  console.log(`\nCODENAME: ${deferred.length} match(es) are the unix USERNAME inside a path, not a brand leak:`)
  for (const d of deferred.slice(0, 10)) console.log(`  · ${d.rel}:${d.line}  ${d.text}`)
  if (deferred.length > 10) console.log(`  … +${deferred.length - 10} more`)
  console.log('  Those are a PORTABILITY defect and belong to check:no-abs-paths, which reports them')
  console.log('  with better guidance. Not failed here, so the two gates cannot disagree.')
}

if (hits.length) {
  console.error(`\nCODENAME: FAIL — the internal code name appears in ${hits.length} shipped location(s):`)
  for (const h of hits) console.error(`  ✗ ${h.rel}:${h.line}  ${h.label}\n      ${h.text}`)
  console.error(
    '\n  This repo is handed to the Doxa team; an internal code name means nothing to them and is a\n' +
    `  hand-off defect. Remove it, or rewrite the sentence with the product name — ${TREE_NAME}, or\n` +
    '  "the plugin studio". Do not invent a replacement brand. If the match is a unix path, use a\n' +
    '  repo-relative path instead and check:no-abs-paths will stop reporting it too.'
  )
  process.exit(1)
}

console.log('CODENAME: PASS — no internal code name in any tracked file.')
console.log('  Scanning only tracked files means the agentic working tree (_qa-cycle/, gitignored)')
console.log('  is deliberately out of scope: it ships in no clone. Shipped surfaces are the subject.')
