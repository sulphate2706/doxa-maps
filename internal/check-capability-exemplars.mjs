#!/usr/bin/env node
/**
 * check-capability-exemplars.mjs — the generated exemplar table must match the manifest.
 *
 * Companion to generate-capability-exemplars.mjs. That file's header explains WHY the table is
 * derived; this one makes the "derived, so it cannot drift" claim true by REGENERATING and
 * comparing, rather than trusting mtimes.
 *
 * ★ WHY CONTENT-COMPARE AND NOT MTIME. check:library-index compares mtimes, which is right there
 * (its generator scans library/ directly, so a source edit really does invalidate the output).
 * Here the input is manifest.json, which a full build REWRITES EVERY TIME even when nothing
 * changed — so an mtime rule would fail after every build for no reason, and a gate that cries
 * wolf gets switched off. Comparing regenerated CONTENT fails only when the answer actually moved.
 *
 * The same reasoning is why CI regenerates-and-diffs the library index instead of using mtimes:
 * a fresh checkout gives every file the same timestamp.
 *
 * NEGATIVE-TESTED: deleting a row from the table makes this FAIL showing the diff; regenerating
 * returns PASS. Deleting the file entirely also FAILs rather than silently skipping.
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'documentation', 'reference-capability-exemplars.md')
const GEN = join(ROOT, 'internal', 'generate-capability-exemplars.mjs')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')

if (!existsSync(MANIFEST)) {
  console.log('CAPABILITY-EXEMPLARS: SKIP — no manifest.json (nothing built yet).')
  process.exit(0)
}
if (!existsSync(OUT)) {
  console.error('CAPABILITY-EXEMPLARS: FAIL — documentation/reference-capability-exemplars.md does not exist.')
  console.error('  It is the authoritative answer to "which bundle is the capability-N example?",')
  console.error('  a question that has been answered wrongly in three separate artifacts.')
  console.error('  Fix: bun run capability-exemplars')
  process.exit(1)
}

const before = readFileSync(OUT, 'utf8')
execFileSync(process.execPath, [GEN], { stdio: 'pipe' })
const after = readFileSync(OUT, 'utf8')

if (before !== after) {
  // Restore what was committed so the check itself never mutates the tree.
  const { writeFileSync } = await import('node:fs')
  writeFileSync(OUT, before)
  const bl = before.split('\n'), al = after.split('\n')
  const diff = []
  for (let i = 0; i < Math.max(bl.length, al.length) && diff.length < 10; i++) {
    if (bl[i] !== al[i]) diff.push(`  line ${i + 1}\n    file: ${bl[i] ?? '(missing)'}\n    real: ${al[i] ?? '(missing)'}`)
  }
  console.error('\nCAPABILITY-EXEMPLARS: FAIL — the table disagrees with the manifest:')
  console.error(diff.join('\n'))
  console.error('\n  The manifest is what the BUILD computed from each folder\'s real shape.')
  console.error('  Fix: bun run capability-exemplars (then commit the regenerated file).')
  process.exit(1)
}

const rows = (after.match(/^\| `/gm) || []).length
console.log(`CAPABILITY-EXEMPLARS: PASS — ${rows} exemplar row(s) match the manifest.`)
