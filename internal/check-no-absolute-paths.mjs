#!/usr/bin/env node
/**
 * check-no-absolute-paths.mjs — no machine-specific path may enter the SOURCE tree.
 *
 * WHY (measured 2026-09-22)
 * The repo is currently clean: `git grep -lE '/home/[a-z0-9_-]+/'` over every tracked file returns
 * ZERO. That is a real hand-off property — a clone works on any machine, which is exactly what
 * "the path Doxa inherits" requires. But nothing enforced it. Proven by experiment: a
 * `/home/<user>/...` line planted in internal/settled-tree-gate.mjs passed check:public-hygiene,
 * check:parse and check:quoted-scripts. The tree was clean BY ACCIDENT, not by construction.
 *
 * ★ WHY THIS FAILURE IS THE WORST SHAPE FOR A HAND-OFF. An absolute path works PERFECTLY for the
 * person who wrote it and breaks only on someone else's machine — the inheritor, i.e. precisely the
 * person the north star is about. It is invisible to every test run by its author. The sibling
 * ideation tree already paid this cost: two docs cite `~/Workspace/dx/root-doxa-maps/...`, a root
 * that no longer exists, so a reader following them silently finds nothing.
 *
 * WHY NOT REUSE check:public-hygiene. It already detects /home/…, /Users/… and C:\Users\… — but it
 * walks a SERVED TREE, where node_modules never exists. Pointed at the repo root it produced 1,427
 * findings, essentially all from node_modules/.vite. Its scope is correct for its job; this is a
 * different job, so it gets a different (tiny) tool rather than a flag that weakens the first.
 *
 * SCOPE: TRACKED FILES ONLY, via `git ls-files`. That is the set a clone actually receives, and it
 * excludes node_modules, build output and local scratch without needing an ignore list to maintain.
 *
 * NEGATIVE-TESTED: planting a /home/… line in a tracked source file makes this FAIL naming the file
 * and line, EXIT=1; removing it returns PASS. A repo with no tracked files FAILS (vacuous guard).
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The patterns are the same three check:public-hygiene uses, kept deliberately identical so the two
// gates cannot disagree about what counts as a machine-specific path.
const PATTERNS = [
  [/\/home\/[a-z0-9_-]+\//i, 'local path (/home/…)'],
  [/\/Users\/[A-Za-z0-9_-]+\//, 'local path (/Users/…)'],
  [/[A-Z]:\\Users\\/, 'local path (C:\\Users\\…)'],
]

// Binary and generated files a path could appear in harmlessly or unavoidably.
const SKIP_EXT = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|eot|pdf|zip|gz|mbtiles|pmtiles|lock)$/i

// A tracked file may legitimately DISCUSS an absolute path — the anti-pattern log and this file's
// own header both quote one to explain the rule. An allow-list by path keeps the gate honest
// without letting the exemption spread: it names files, never patterns.
const ALLOW = new Set([
  'internal/check-no-absolute-paths.mjs',   // this file quotes the patterns it forbids
])

let tracked = []
try {
  tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
} catch (e) {
  console.error(`ABSOLUTE-PATHS: FAIL — could not list tracked files (${String(e.message).slice(0, 60)}).`)
  console.error('  This gate scans `git ls-files`, the set a clone actually receives.')
  process.exit(1)
}

// Vacuous guard: "0 tracked files" must never read as "0 problems".
const MIN_TRACKED = 50
if (tracked.length < MIN_TRACKED) {
  console.error(`ABSOLUTE-PATHS: FAIL — only ${tracked.length} tracked file(s) (expected >= ${MIN_TRACKED}).`)
  console.error('  Not a git checkout, or the listing is broken. Refusing to pass vacuously.')
  process.exit(1)
}

const hits = []
let scanned = 0
for (const rel of tracked) {
  if (SKIP_EXT.test(rel) || ALLOW.has(rel)) continue
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) continue          // staged-deleted file
  let text
  try { text = readFileSync(abs, 'utf8') } catch { continue }   // binary
  scanned++
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const [re, label] of PATTERNS) {
      if (re.test(lines[i])) { hits.push({ rel, line: i + 1, label, text: lines[i].trim().slice(0, 100) }); break }
    }
  }
}

console.log(`ABSOLUTE-PATHS: ${scanned} tracked text file(s) scanned.`)

if (hits.length) {
  console.error(`\nABSOLUTE-PATHS: FAIL — ${hits.length} machine-specific path(s) in tracked source:`)
  for (const h of hits.slice(0, 20)) console.error(`  ✗ ${h.rel}:${h.line}  ${h.label}\n      ${h.text}`)
  if (hits.length > 20) console.error(`  … +${hits.length - 20} more`)
  console.error(
    '\n  An absolute path works perfectly for whoever wrote it and breaks only on the inheritor\'s\n' +
    '  machine, so no test run by its author will catch it. Use a path relative to the repo root\n' +
    '  (resolve(dirname(fileURLToPath(import.meta.url)), \'..\')) or an env var. If a file must QUOTE\n' +
    '  a path to explain something, add it to ALLOW in this gate — by filename, never by pattern.'
  )
  process.exit(1)
}

console.log('ABSOLUTE-PATHS: PASS — no machine-specific path in any tracked file.')
