#!/usr/bin/env node
/**
 * check-group-set-standard — a FORK's group set generates packets end-to-end.
 *
 * THE CONTRACT UNDER TEST (documentation/STANDARD-GROUP-SET.md in the plugin): a fork supplies ONE
 * FOLDER — clusters.json with a flat lists[] ({ id, label, selector, unlisted? }), records.json
 * (its own people rows, so no API), selector-evaluator.js (resolvable from the folder) — and points
 * the packet generator at it with DATA_DIR= and PACKET_OUT=. Nothing else. If that sentence stops
 * being true, this gate goes red before a fork finds out.
 *
 * ★ THE FIXTURE IS THE STANDARD'S FALSIFIER, deliberately synthetic (every slug and number is
 * invented — no real group data ships in a test fixture). It exercises exactly the generic shape:
 * FLAT lists[] (not upg100's bucketed one), an unlisted:true entry that must NOT generate, records
 * from the folder, and no posters directory — the map page must degrade to a cover, not kill the
 * run, because a fork's first run will not have posters yet.
 *
 * Written RED-FIRST: on the tree before the standard landed, packet.mjs knew only series.json
 * dataDirs, bucketed clusters, cached/API records and a fixed out/ — this test failed on all four.
 *
 * Headless, no network (NOPHOTOS + folder records). Exit 0 pass · 1 fail.
 */
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const FIXTURE = join(HERE, 'fixtures', 'toy-group-set')
const GEN = join(REPO, 'library', 'scripts', 'posters', 'packet.mjs')

const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }

// ⚠ OUTPUT GOES TO A TEMP DIR, NEVER THE REAL out/packets — toy packets landing beside the real 28
// would make check:packets-all count fiction as coverage.
const OUT = mkdtempSync(join(tmpdir(), 'toy-packets-'))
const env = {
  ...process.env,
  DATA_DIR: FIXTURE,
  PACKET_OUT: OUT,
  NOPHOTOS: '1',
  OFFLINE: '1',
}
const run = spawnSync('node', [GEN], { env, encoding: 'utf8', timeout: 120000 })
const outText = String(run.stdout || '') + String(run.stderr || '')

ok(run.status === 0,
  `the generator exited ${run.status} on the toy dataDir — a fork cannot generate at all.\n      tail: ${outText.trim().split('\n').slice(-4).join('\n            ')}`)

if (run.status === 0) {
  const files = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith('.html')).sort() : []
  // toy-hidden is unlisted:true — TWO packets, and the third's absence is as load-bearing as the
  // two's presence: an unlisted list that generates anyway is the reachability bug inverted.
  ok(files.includes('toy-north.html') && files.includes('toy-south.html'),
    `expected toy-north + toy-south packets, got: ${files.join(', ') || '(none)'}`)
  ok(!files.some((f) => f.startsWith('toy-hidden')),
    'the unlisted:true list generated a packet — unlisted must mean unlisted')

  for (const f of ['toy-north.html', 'toy-south.html']) {
    if (!files.includes(f)) continue
    const html = readFileSync(join(OUT, f), 'utf8')
    const groups = (html.match(/class="card"/g) || []).length
    const want = f === 'toy-north.html' ? 3 : 2
    ok(groups === want, `${f}: ${groups} group rows, expected ${want} — the folder's records.json did not drive the join`)
    // The synthetic names must actually print — a packet of the right COUNT with the wrong rows
    // would pass a bare count.
    ok(f !== 'toy-north.html' || /Alpha People/.test(html), 'toy-north is missing its own synthetic people')
    // No posters exist for the toy: the map page must be the documented cover, and the run must
    // not have died for it (already asserted by exit 0).
  }
}
rmSync(OUT, { recursive: true, force: true })

if (fails.length) {
  console.error('GROUP-SET-STANDARD: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('GROUP-SET-STANDARD: PASS — a one-folder synthetic fork generates exactly its listed packets (and not its unlisted one) from its own records, with no API, no posters and no series.json edit.')
