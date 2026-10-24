#!/usr/bin/env node
/**
 * build-packet-fixtures — build every committed packet fixture, so check:packets-all has more
 * than one SHAPE to evaluate.
 *
 * THE GAP THIS CLOSES. check:packets-all reported "every generated packet renders, in every locale
 * present" and passed on 11 packets — all of them the SAME ZONE (laos) in 11 locales, against 28
 * poster zones. The suite proved one zone's layout eleven times. Generating all 28 x 11 is a
 * network fetch per zone and ~100MB of artefacts, so the answer is not more zones: it is more
 * SHAPES, chosen where the layout can actually break, built from committed records with no network.
 *
 * ★ THE SHAPES ARE THE PAGE BOUNDARY. packet-render.js:76 sets PER_PAGE = 20, and pagination is
 * `for (start = 0; start < groups.length; start += PER_PAGE)`. laos has 95 groups and tibet 43 —
 * both mid-range, both remainder cases, so the boundary itself had NEVER been rendered:
 *   - exactly 20  : one full page. An off-by-one here yields 2 list pages, the second empty.
 *   - 21          : two pages, the second holding a SINGLE card.
 *   - 1           : the minimum a zone can have.
 * Each is derived by slicing the committed tibet fixture, so they are byte-deterministic and need
 * no API.
 *
 * ⚠ EACH BUILD OVERWRITES THE PREVIOUS ONE, which is the reason this script exists rather than a
 * line of shell. packet.mjs names its output for the ZONE, not the fixture, so four fixture builds
 * against one zone leave one file — and check:packets-all would go on seeing a single shape while
 * reporting success. Each output is renamed to its fixture's own name so all of them coexist and
 * every one gets evaluated.
 *
 * Usage: node internal/build-packet-fixtures.mjs
 */
import { existsSync, renameSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DOXA_REPO || resolve(HERE, '..')
const FIXTURES = resolve(REPO, 'library/scripts/posters/fixtures')
const OUT = resolve(REPO, 'library/scripts/posters/out/packets')
// Every fixture is built against this zone: the records come from the fixture, and the zone only
// supplies page 1's map. Keeping it constant means a shape difference is the ONLY variable.
const ZONE = 'asia-china-tibet-autonomous-region'
// ★ BUILT IN THEIR OWN DIRECTORY. packet.mjs writes <zone>.html into its output dir, and every fixture is built
// against the REAL Tibet zone; built straight into out/packets, each run overwrote the real Tibet packet and the
// rename then removed it, so check:packets-all reported a generated zone as missing. PACKET_OUT sends each build
// to a private directory; only the renamed fixture-<name>.html reaches out/packets.
const BUILD = join(OUT, '.fixture-build')

if (!existsSync(FIXTURES)) {
  console.log(`PACKET-FIXTURES: SKIP — no fixtures directory at ${FIXTURES}`)
  process.exit(0)
}

const fixtures = readdirSync(FIXTURES).filter((f) => /^records-.*\.json$/.test(f)).sort()
if (!fixtures.length) {
  console.log('PACKET-FIXTURES: SKIP — no records-*.json fixtures committed')
  process.exit(0)
}

console.log(`PACKET-FIXTURES: building ${fixtures.length} fixture(s)`)
const built = []
const failed = []

mkdirSync(OUT, { recursive: true })
mkdirSync(BUILD, { recursive: true })
for (const fx of fixtures) {
  const name = fx.replace(/^records-/, '').replace(/\.json$/, '')
  const res = spawnSync(process.execPath, [join(REPO, 'library/scripts/posters/packet.mjs')], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, PACKET_RECORDS: join(FIXTURES, fx), ONLY: ZONE, PACKET_OUT: BUILD },
  })
  const produced = join(BUILD, `${ZONE}.html`)
  if (res.status !== 0 || !existsSync(produced)) {
    // The ERROR line, not the last line: Node ends a crash with its version banner, so the last line
    // of a TDZ ReferenceError read "Node.js v20.20.2" and named nothing.
    const lines = (res.stderr || res.stdout || '').trim().split('\n')
    failed.push(`${fx}: ${lines.find((l) => /\b\w*Error\b/.test(l)) || lines.slice(-1)[0] || 'no output'}`)
    console.log(`  ✗ ${fx}`)
    continue
  }
  // Rename BEFORE the next build, or the next one overwrites it — see the warning above.
  const dest = join(OUT, `fixture-${name}.html`)
  renameSync(produced, dest)
  built.push(`fixture-${name}.html`)
  console.log(`  ✓ ${fx} -> fixture-${name}.html`)
}

try { rmSync(BUILD, { recursive: true, force: true }) } catch { /* best effort */ }

if (failed.length) {
  console.error(`\nPACKET-FIXTURES: FAIL — ${failed.length} fixture(s) did not build`)
  for (const f of failed) console.error('  - ' + f)
  process.exit(1)
}
console.log(`\nPACKET-FIXTURES: ${built.length} packet(s) built. Run check:packets-all to evaluate them.`)
