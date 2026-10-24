#!/usr/bin/env node
/**
 * check-dxlife-untouched.mjs — evidence for the ZERO DX-LIFE EDITS standing law.
 *
 * ★ WHY THIS IS NOT `git status` (a real false-pass, 2026-09-20)
 *   I verified the invariant for several ticks with:
 *       cd root-dx-life && git status --porcelain | wc -l     # -> 0
 *   and reported that 0 to the Driver as proof. root-dx-life IS NOT A GIT REPOSITORY — it is a
 *   plain directory clone. `git status` prints "fatal: not a git repository" to STDERR and nothing
 *   to stdout, so `wc -l` counts 0. THE CHECK RETURNED THE PASS VALUE *BECAUSE IT FAILED*.
 *   Identical in shape to the settled-tree churn bug (bfs rejected the argument, stderr discarded,
 *   wc -l counted an empty stream): A COMMAND'S ERROR PATH PRODUCING THE PASS VALUE THROUGH AN
 *   UNCHECKED PIPE. A safety invariant is the worst possible place for that.
 *
 * ★ WHAT THIS DOES INSTEAD — a VCS-INDEPENDENT WITNESS.
 *   Walks the clone and records (path, size, mtime) for every file into a baseline JSON. On later
 *   runs it DIFFS against that baseline and reports added / removed / modified. No VCS required,
 *   so it cannot be defeated by the tree not being a repo.
 *
 *   FIRST RUN writes the baseline and says so plainly — it does NOT claim the tree is unmodified,
 *   because a baseline taken now can only prove "unchanged SINCE NOW". Honest framing matters more
 *   than a green line: this gate earns its value over time, not on its first invocation.
 *
 * USAGE
 *   node internal/check-dxlife-untouched.mjs           # create or verify the baseline
 *   DXLIFE=/path/to/clone node internal/check-dxlife-untouched.mjs
 * EXIT 0 unchanged (or baseline created) · 1 drift detected · 2 clone not found
 */
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLONE = process.env.DXLIFE || resolve(HERE, '..', '..', '..', 'root-dx-life')
const STORE = resolve(HERE, '..', '..', '_qa-cycle', '_scratch-coordinator', 'dxlife-baseline.json')

if (!existsSync(CLONE)) {
  console.error(`DXLIFE-UNTOUCHED: clone not found at ${CLONE} — nothing to check.`)
  process.exit(2)
}

const SKIP = new Set(['node_modules', '.git', '.output', '.nuxt', 'dist'])
const snap = {}
;(function walk(dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    try {
      const st = statSync(p)
      snap[p.slice(CLONE.length + 1)] = `${st.size}:${Math.round(st.mtimeMs)}`
    } catch { /* unreadable file — skip rather than fail the invariant check */ }
  }
})(CLONE)

const n = Object.keys(snap).length
if (!existsSync(STORE)) {
  mkdirSync(dirname(STORE), { recursive: true })
  writeFileSync(STORE, JSON.stringify({ created: new Date().toISOString(), clone: CLONE, files: snap }, null, 0))
  console.log(`DXLIFE-UNTOUCHED: BASELINE CREATED — ${n} files recorded at ${CLONE}.`)
  console.log('  This run proves NOTHING about the past; it establishes the reference point.')
  console.log('  From here on, any add/remove/modify under that tree will be reported.')
  process.exit(0)
}

const base = JSON.parse(readFileSync(STORE, 'utf8')).files
const added = Object.keys(snap).filter((k) => !(k in base))
const removed = Object.keys(base).filter((k) => !(k in snap))
const changed = Object.keys(snap).filter((k) => k in base && base[k] !== snap[k])

console.log(`DXLIFE-UNTOUCHED: ${n} files walked · +${added.length} -${removed.length} ~${changed.length}`)
if (added.length || removed.length || changed.length) {
  console.error('DXLIFE-UNTOUCHED: FAIL — the read-only clone CHANGED:')
  for (const f of added.slice(0, 5)) console.error(`  ADDED    ${f}`)
  for (const f of removed.slice(0, 5)) console.error(`  REMOVED  ${f}`)
  for (const f of changed.slice(0, 5)) console.error(`  MODIFIED ${f}`)
  console.error('  ZERO DX-LIFE EDITS is a standing law. Investigate before doing anything else.')
  process.exit(1)
}
console.log('DXLIFE-UNTOUCHED: PASS — no file added, removed or modified since the baseline.')
