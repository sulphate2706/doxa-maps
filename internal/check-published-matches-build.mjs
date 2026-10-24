#!/usr/bin/env node
/**
 * check-published-matches-build — what readers are served must be what we built.
 *
 * THE DEFECT THIS CATCHES, and it has cost more agent-hours than any bug in the tree.
 * Every gate in this repo measures the LOCAL build. Nothing measured the PUBLISHED one. So the
 * whole board can be green for weeks while readers are served a months-old bundle, and the only
 * detector is a human noticing something looks wrong.
 *
 * MEASURED 2026-09-24: live my-upg-100-list.js was 485,665 bytes against 678,837 built — 193KB and
 * many merges behind. Live LACKED the legend tab labels, LACKED the a11y keys, LACKED
 * v3.24.0/mapbox-gl.css and still HAD v3.3.0. Every other bundle was stale too (country-posters
 * -194KB, research-dashboard -98KB, gospel-resources larger than local, i.e. not even the same
 * lineage).
 *
 * ★ THE EXPENSIVE PART IS NOT THE STALENESS, IT IS THE PHANTOM BUGS. A stale publish manufactures
 * bug reports that cannot be reproduced. Three separate reports this week — print buttons
 * truncated to "Pr...", the legend showing "Generation 1/2/3" instead of the real tab names, the
 * pin hint saying "red dot" instead of "coloured dot" — were ALL fixed in main and ALL still
 * visible live. Each read as a regression against a card marked done. Two of them consumed most of
 * a tick to diagnose, and the diagnosis was the same sentence every time.
 *
 * ⚠ IT COMPARES THE SRI HASH, NOT THE BYTE SIZE. manifest.json already carries a sha384 per
 * bundle, which is the identity the browser itself enforces; two different builds can coincide in
 * length, and a size check would call that a match. Size is reported only to make a mismatch
 * legible ("193KB behind" reads better than two hashes).
 *
 * ⚠ IT IS A NETWORK GATE, so it SKIPs rather than fails when the published host is unreachable.
 * A gate that goes red on someone's flaky wifi teaches people to ignore it. Absence of evidence is
 * reported as a SKIP with the reason.
 *
 * Usage: node internal/check-published-matches-build.mjs [bundle ...]
 *   PUBLISHED_BASE=<url>  where the published tree lives
 *   Defaults to every bundle in the local manifest.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { requirePublishedTreeUrl } from './_published-base.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DOXA_REPO || resolve(HERE, '..')
const PUBLISHED_BASE = (process.env.PUBLISHED_BASE
  || requirePublishedTreeUrl('PUBLISHED-MATCHES-BUILD')).replace(/\/$/, '')
const TREE = resolve(REPO, `public/${TREE_NAME}`)
const MANIFEST = join(TREE, 'manifest.json')

if (!existsSync(MANIFEST)) {
  console.log(`PUBLISHED-MATCHES-BUILD: SKIP — no local manifest at ${MANIFEST}.`)
  console.log('  Build the tree first (bun run tree). Absence is not a pass.')
  process.exit(0)
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const all = (manifest.bundles || []).filter((b) => b.bundle && b.output)
const picked = process.argv.slice(2).length
  ? all.filter((b) => process.argv.slice(2).includes(b.bundle))
  : all

if (!picked.length) {
  console.log('PUBLISHED-MATCHES-BUILD: SKIP — no bundles selected from the manifest.')
  process.exit(0)
}

const sri = (buf) => 'sha384-' + createHash('sha384').update(buf).digest('base64')
const kb = (n) => (n / 1024).toFixed(0) + 'KB'

// One reachability probe before the sweep. If the host is down we SKIP once, rather than
// reporting every bundle as a separate failure of the same cause.
let hostUp = false
try {
  const r = await fetch(PUBLISHED_BASE + '/manifest.json', { signal: AbortSignal.timeout(15000) })
  hostUp = r.ok || r.status === 404   // 404 still proves the host answers
} catch { /* handled below */ }
if (!hostUp) {
  console.log(`PUBLISHED-MATCHES-BUILD: SKIP — ${PUBLISHED_BASE} is not answering.`)
  console.log('  This gate needs the network. Unreachable is NOT a pass: it means the published')
  console.log('  tree was never compared, so a stale publish would go unnoticed right now.')
  process.exit(0)
}

console.log('PUBLISHED-MATCHES-BUILD')
console.log(`  published : ${PUBLISHED_BASE}`)
console.log(`  built     : ${TREE}`)

const stale = []
const unreachable = []
let matched = 0

for (const b of picked) {
  const localPath = resolve(REPO, 'public', b.output)
  if (!existsSync(localPath)) { unreachable.push(`${b.bundle}: no local build at ${b.output}`); continue }
  const localBuf = readFileSync(localPath)
  const localHash = sri(localBuf)

  const url = `${PUBLISHED_BASE}/${b.bundle}/${b.bundle}.js`
  let liveBuf = null
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!r.ok) { unreachable.push(`${b.bundle}: published copy returned HTTP ${r.status}`); continue }
    liveBuf = Buffer.from(await r.arrayBuffer())
  } catch (e) {
    unreachable.push(`${b.bundle}: fetch failed — ${String(e.message).slice(0, 60)}`)
    continue
  }
  const liveHash = sri(liveBuf)

  if (liveHash === localHash) {
    matched++
    console.log(`  ✓ ${b.bundle} — published copy is the built copy (${kb(localBuf.length)})`)
  } else {
    const delta = liveBuf.length - localBuf.length
    console.log(`  ✗ ${b.bundle} — published ${kb(liveBuf.length)} vs built ${kb(localBuf.length)}`
      + ` (${delta > 0 ? '+' : ''}${kb(delta)})`)
    stale.push({ bundle: b.bundle, live: liveBuf.length, local: localBuf.length, delta })
  }
}

console.log(`\n  ${matched} of ${picked.length} bundle(s) match; ${stale.length} stale; `
  + `${unreachable.length} could not be compared`)
for (const u of unreachable) console.log(`    · ${u}`)

if (stale.length) {
  console.error(`\nPUBLISHED-MATCHES-BUILD: FAIL — ${stale.length} published bundle(s) are NOT what we built.`)
  for (const s of stale) {
    console.error(`  ✗ ${s.bundle}: readers get ${kb(s.live)}, we built ${kb(s.local)}`
      + ` (${s.delta > 0 ? '+' : ''}${kb(s.delta)})`)
  }
  console.error('\n  Every other gate in this repo measures the LOCAL tree, so they stay green while')
  console.error('  readers are served something else. The expensive part is not the staleness: it is')
  console.error('  that a stale publish MANUFACTURES BUG REPORTS THAT CANNOT BE REPRODUCED. Three')
  console.error('  reports this week (truncated print buttons, "Generation 1/2/3" legend tabs, the')
  console.error('  "red dot" pin hint) were all fixed in main and all still visible live, and each')
  console.error('  one read as a regression against a card marked done.')
  console.error('\n  FIX: publish. That is a COORDINATOR action — deploy:dev runs a full build whose')
  console.error(`  first step deletes public/${TREE_NAME}/ and tears the tree out from under every`)
  console.error('  other agent, which is why the build guard refuses it without BUILD_ALLOW=1.')
  process.exit(1)
}
console.log('\nPUBLISHED-MATCHES-BUILD: PASS — every compared bundle is byte-identical to the build.')
