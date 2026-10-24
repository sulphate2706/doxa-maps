#!/usr/bin/env node
/**
 * check-snapshot-guard.mjs — every catalogue fetcher must write through the snapshot guard.
 *
 * WHY. A fetcher writes a snapshot built from a NETWORK read, and a network read has a bad
 * day. The dangerous case is not the run that throws — that leaves the old file alone — it
 * is the run that half-succeeds and writes anyway. Measured in this bundle: the FCBH fetcher
 * read video scope for 1,666 languages, was committed, then a later run during a rate-limit
 * produced 1,103 and silently overwrote the good file. Nothing failed and nothing warned.
 *
 * scripts/_snapshot-guard.mjs refuses a write that loses more than a tenth of the previous
 * snapshot. This check exists so the next fetcher someone adds cannot quietly skip it: a
 * guard that is easy to bypass is a guard that will be bypassed.
 *
 * THE ONE ALLOWED EXCEPTION is a checkpoint write in a resumable fetcher, which starts from
 * the existing file as a cache and can only grow. It must say so on the line above, with the
 * marker below, so the exemption is a deliberate statement rather than an oversight.
 *
 * Self-test: --poison injects a raw write and confirms this check fails on it.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(HERE, '..', 'plugin-designs/gospel-resources/scripts')
const POISON = process.argv.includes('--poison')
const MARKER = 'CHECKPOINT-WRITE-OK'

const files = readdirSync(DIR).filter((f) => /^fetch-.*\.mjs$/.test(f))
if (!files.length) {
  console.error('SNAPSHOT-GUARD-CHECK: FAIL — no fetch-*.mjs found; this check would pass vacuously.')
  process.exit(1)
}

const bad = []
let guarded = 0
let exempt = 0
for (const f of files) {
  let src = readFileSync(resolve(DIR, f), 'utf8')
  if (POISON && f === files[0]) src += '\nwriteFileSync(OUT, JSON.stringify(out))\n'
  const lines = src.split('\n')
  let usesGuard = false
  lines.forEach((line, i) => {
    if (/writeSnapshot\s*\(/.test(line)) usesGuard = true
    if (!/writeFileSync\s*\(\s*OUT\b/.test(line)) return
    // a checkpoint write must be declared on one of the three lines above it
    const above = lines.slice(Math.max(0, i - 4), i).join('\n')
    if (above.includes(MARKER)) { exempt++; return }
    bad.push(`${f}:${i + 1} writes OUT directly with writeFileSync and carries no ${MARKER} marker`)
  })
  if (usesGuard) guarded++
  else bad.push(`${f} never calls writeSnapshot() — its snapshot is unguarded`)
}

if (bad.length) {
  console.error(`SNAPSHOT-GUARD-CHECK: FAIL — ${bad.length} problem(s):`)
  for (const b of bad) console.error(`  ${b}`)
  if (POISON) {
    console.log('SNAPSHOT-GUARD-CHECK: SELF-TEST PASS — the injected raw write was caught.')
    process.exit(0)
  }
  process.exit(1)
}
if (POISON) {
  console.error('SNAPSHOT-GUARD-CHECK: SELF-TEST FAIL — an injected raw write was NOT caught; this check proves nothing.')
  process.exit(1)
}
console.log(`SNAPSHOT-GUARD-CHECK: PASS — ${guarded}/${files.length} fetcher(s) write through the guard; ${exempt} declared checkpoint write(s).`)
