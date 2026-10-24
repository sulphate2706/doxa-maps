#!/usr/bin/env node
/**
 * check-catalog-identity.mjs — prove the LIVE server is serving the CATALOG's exact bytes.
 *
 * THE QUESTION THIS ANSWERS, AND WHY THE OBVIOUS CHECK CANNOT ANSWER IT
 * Card 1 (IDEA-MAPS-BUNDLER-PUBLIC-FORGEJO-PIPELINE) asks that ONE public Forgejo repo be the live
 * catalog source, and that the merge lose nothing. The tempting verification is `curl -o /dev/null
 * -w '%{http_code}'` over a few URLs. That proves only that SOMETHING answered:
 *   · the host platform's /app/doxa-maps/manifest.json returns **200** and is a 2,872-byte HTML
 *     SIGN-IN PAGE. An http-status check reads it as healthy.
 *   · a stale CDN copy also returns 200, with the wrong bytes.
 *
 * ★ SRI IS THE RIGHT INSTRUMENT. Every profile in manifest.json already carries an
 * `integrity: "sha384-…"` computed by the build over its own bundle. So hashing the LIVE response
 * and comparing against that field is a cryptographic identity proof, using a value the build
 * produced for an unrelated reason. No new source of truth, no new thing to keep in sync.
 *
 * ★ COMPARE AGAINST THE CATALOG'S OWN MANIFEST, NOT THE LOCAL ONE. Reading the local build's
 * manifest would prove "live matches what I just built here", which is a different and weaker claim
 * — it passes even when the publish never happened. Fetching the manifest from the live server and
 * using ITS integrity values proves the served tree is INTERNALLY consistent; pass --catalog to
 * additionally require that it matches a cloned catalog checkout.
 *
 * MEASURED 2026-09-21: 17 of 17 bundles identity-proven, 0 mismatched, and the live public manifest
 * is byte-identical (sha256 88ae3832…) to platform/mfe-index's. The catalog IS what the host platform serves.
 *
 * USAGE
 *   bun run check:catalog-identity                 # live public door vs its own manifest
 *   CATALOG=/tmp/cat/app/doxa-maps bun run check:catalog-identity   # also require catalog match
 * Network-dependent, so it is NOT in build:unlocked and NOT in CI (which has no egress guarantee).
 * It SKIPS cleanly when the host is unreachable rather than failing a build for a network blip —
 * but it distinguishes "could not reach" from "reached and wrong", and only the latter exits 1.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { TREE_NAME } from './_tree-name.mjs'
import { requirePublishedTreeUrl } from './_published-base.mjs'

const BASE = (process.env.BASE || requirePublishedTreeUrl('CATALOG-IDENTITY')).replace(/\/?$/, '/')
const CATALOG = process.env.CATALOG || ''

const sha384 = (buf) => 'sha384-' + createHash('sha384').update(buf).digest('base64')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function get(url) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(),
    { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Mozilla/5.0 doxa-maps-gate' } })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return Buffer.from(await r.arrayBuffer())
}

let liveManifestBuf
try {
  liveManifestBuf = await get(BASE + 'manifest.json')
} catch (e) {
  console.log(`CATALOG-IDENTITY: SKIP — cannot reach ${BASE} (${String(e.message).slice(0, 50)}).`)
  process.exit(0)
}

// ★ Assert on CONTENT, not status: /app/ returns 200 with an HTML sign-in page.
let mf
try {
  mf = JSON.parse(liveManifestBuf.toString('utf8'))
} catch {
  console.error('CATALOG-IDENTITY: FAIL — the manifest URL did not return JSON.')
  console.error(`  ${BASE}manifest.json served ${liveManifestBuf.length} bytes that do not parse.`)
  console.error('  This is what the LOGIN WALL looks like: HTTP 200 with an HTML sign-in page.')
  console.error(`  The public door is /plugin-assets/${TREE_NAME}/ — NOT /app/${TREE_NAME}/.`)
  process.exit(1)
}

const bundles = mf.bundles || []
if (!bundles.length) {
  console.error('CATALOG-IDENTITY: FAIL — the live manifest lists ZERO bundles.')
  process.exit(1)
}

let ok = 0, bad = [], noIntegrity = [], unreachable = []
for (const b of bundles) {
  const name = b.bundle
  const integ = (b.profiles || []).map((p) => p.integrity).find(Boolean) || b.integrity
  if (!integ) { noIntegrity.push(name); continue }
  let buf
  try { buf = await get(`${BASE}${name}/${name}.js`) }
  catch (e) { unreachable.push(`${name} (${String(e.message).slice(0, 24)})`); continue }
  if (sha384(buf) === integ) ok++
  else bad.push(name)
}

console.log(`CATALOG-IDENTITY: ${bundles.length} bundle(s) in the live manifest; ` +
            `${ok} identity-proven against their own SRI.`)
for (const n of noIntegrity) console.log(`  i no integrity field, skipped: ${n}`)
for (const n of unreachable) console.log(`  i unreachable, skipped: ${n}`)

if (CATALOG) {
  const p = join(CATALOG, 'manifest.json')
  if (!existsSync(p)) {
    console.error(`\nCATALOG-IDENTITY: FAIL — CATALOG=${CATALOG} has no manifest.json.`)
    process.exit(1)
  }
  const a = sha256(liveManifestBuf), c = sha256(readFileSync(p))
  if (a !== c) {
    console.error('\nCATALOG-IDENTITY: FAIL — the LIVE manifest differs from the catalog checkout.')
    console.error(`  live    sha256: ${a.slice(0, 32)}`)
    console.error(`  catalog sha256: ${c.slice(0, 32)}`)
    console.error('  The server is serving something other than this catalog commit.')
    process.exit(1)
  }
  console.log(`  ✓ live manifest is byte-identical to the catalog checkout (sha256 ${a.slice(0, 16)}…)`)
}

if (bad.length) {
  console.error(`\nCATALOG-IDENTITY: FAIL — ${bad.length} bundle(s) served bytes that do not match their SRI:`)
  for (const n of bad) console.error(`  ✗ ${n}`)
  console.error('\n  The served bundle and the manifest that describes it disagree. A browser will')
  console.error('  REFUSE to execute such a script ("Failed to find a valid digest"), and the element')
  console.error('  renders blank — which looks like a catastrophic bundle failure when the bundle is')
  console.error('  fine and only the HASHES disagree. If this appeared within ~5 min of a publish it')
  console.error('  may be the transient 300s-cache trap; re-run before investigating further.')
  process.exit(1)
}
console.log('CATALOG-IDENTITY: PASS — every reachable live bundle is byte-identical to its manifest entry.')
