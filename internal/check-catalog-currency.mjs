#!/usr/bin/env node
/**
 * check-catalog-currency.mjs — is the LIVE catalog serving what we have BUILT?
 *
 * THE BLIND SPOT THIS FILLS. `check:catalog-identity` hashes each live bundle and compares it to
 * the CATALOG'S OWN manifest integrity — deliberately, per its own header: "COMPARE AGAINST THE
 * CATALOG'S OWN MANIFEST, NOT THE LOCAL ONE." That proves the served tree is INTERNALLY
 * CONSISTENT. It can never prove the served tree is CURRENT: a catalog three publishes behind is
 * perfectly self-consistent and passes with a clean PASS.
 *
 * Measured 2026-09-21, which is why this exists: after baking the Mapbox token locally,
 * `check:catalog-identity` reported "17 of 17 identity-proven — PASS" while the live leaf still
 * served `BAKED_TOKEN = ""`, i.e. every map on the platform was still broken. Two gates, two
 * questions:
 *
 *     check:catalog-identity   is the live catalog consistent WITH ITSELF?   (tamper / corruption)
 *     check:catalog-currency   is the live catalog the SAME BUILD as ours?   (staleness)
 *     …and, since 2026-09-22, is anything we built ABSENT from it?           (loss)
 *
 * Neither of the first two subsumes the other. A tampered catalog fails identity and passes
 * currency; a stale one passes identity and fails currency.
 *
 * ★ THE THIRD QUESTION USED TO BELONG TO NOBODY. A bundle that 404s live was counted "unreachable"
 * and skipped, and unreachable never gated the exit — so a catalog with an ENTIRE PLUGIN DELETED
 * passed with exit 0 (proven by experiment; see the MISSING ≠ UNREACHABLE note below). That is the
 * exact guarantee Card 1 Step 1 asks for — "merge all bundles so nothing is LOST" — and it fell
 * between two gates that each answered their own question correctly.
 *
 * SKIPs (exit 0) only when the catalog could not be REACHED AT ALL — an offline box must not fail
 * a build. A 4xx is not an offline condition: it is the server telling us the file is not there.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { requirePublishedTreeUrl } from './_published-base.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const BASE = (argOf('--base', '') || requirePublishedTreeUrl('CATALOG-CURRENCY')).replace(/\/+$/, '')
const TIMEOUT = Number(argOf('--timeout', 25000))

const sha384 = (buf) => 'sha384-' + createHash('sha384').update(buf).digest('base64')

const localManifestPath = join(ROOT, 'public', TREE_NAME, 'manifest.json')
if (!existsSync(localManifestPath)) {
  console.log(`CATALOG-CURRENCY: SKIP — no local build (public/${TREE_NAME}/manifest.json missing). Run \`bun run build\`.`)
  process.exit(0)
}
const local = JSON.parse(readFileSync(localManifestPath, 'utf8'))
const localBundles = new Map()
for (const b of local.bundles || []) {
  // VERIFIED against the real manifest shape 2026-09-21: integrity sits at bundle.integrity
  // (bundle keys are bundle/scriptUrl/output/integrity/elements/profiles). It is NOT under
  // profiles[].embed — that object holds only `iframe` and `script` snippet strings.
  if (b.integrity) localBundles.set(b.bundle, b.integrity)
}
if (!localBundles.size) {
  console.error('CATALOG-CURRENCY: FAIL — parsed 0 integrity values from the local manifest; the matcher is broken.')
  process.exit(1)
}

const fetchBuf = async (url) => {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow' })
    if (!r.ok) return { err: `HTTP ${r.status}` }
    return { buf: Buffer.from(await r.arrayBuffer()) }
  } catch (e) {
    return { err: String(e.message || e).slice(0, 60) }
  } finally { clearTimeout(t) }
}

// ── MISSING ≠ UNREACHABLE ─────────────────────────────────────────────────────────────────────
// ★ THE HOLE THIS CLOSES (measured 2026-09-22). Every local bundle that failed to fetch used to be
// counted `unreachable` and skipped, and `unreachable` never gated the exit. PROVEN by deleting one
// whole bundle from a copy of the catalog and pointing this gate at it:
//     CATALOG-CURRENCY: 17 current · 0 STALE · 1 unreachable (of 18 local bundles)
//     CATALOG-CURRENCY: PASS      ← exit 0, with an entire plugin missing from the catalog
// That is precisely the failure Card 1 Step 1 exists to prevent ("merge all bundles so nothing is
// LOST"), and no gate owned it: catalog-identity proves the live bytes are self-consistent, this
// check proves they are the same BUILD — neither asked "is anything absent?". The tell was in the
// PASS text itself: "every REACHABLE live bundle". A qualifier inside a success message is a
// description of what the check does not cover.
//
// A 404 is a STATEMENT FROM THE SERVER that the bundle is not there — that is a publish defect, not
// a network condition, so it FAILS. A connection error / timeout / DNS failure is an environment
// condition and still counts as unreachable, preserving the offline SKIP below (an offline box must
// never fail a build).
const stale = []; const matched = []; const missing = []; let unreachable = 0
for (const [bundle, wantIntegrity] of localBundles) {
  const { buf, err } = await fetchBuf(`${BASE}/${bundle}/${bundle}.js`)
  if (err) {
    // Record the URL that was actually probed. An earlier version stored only a name and let the
    // printer rebuild the path, which produced a mangled URL for leaf entries
    // (…/index.html/…/index.html.js) — a wrong URL in a failure message sends the reader hunting
    // for a file that was never requested.
    if (/^HTTP 4\d\d/.test(err)) missing.push({ bundle, url: `${BASE}/${bundle}/${bundle}.js`, err })
    else unreachable++                                           // the network says it couldn't ask
    continue
  }
  const got = sha384(buf)
  if (got === wantIntegrity) matched.push(bundle)
  else stale.push({ bundle, want: wantIntegrity.slice(0, 22), got: got.slice(0, 22) })
}

// OFFLINE SKIP. Only when NOTHING could be asked — i.e. every bundle failed at the network layer
// and none came back as a 4xx. A single 404 means the server IS answering, so we are online and a
// missing bundle is a real finding, not an environment condition.
if (unreachable === localBundles.size && missing.length === 0) {
  console.log(`CATALOG-CURRENCY: SKIP — catalog unreachable at ${BASE} (${unreachable} bundle(s)). Offline is not a failure.`)
  process.exit(0)
}

// ── LEAF PAGES TOO, and this half is not optional ─────────────────────────────────────────────
// Measured 2026-09-21: baking the Mapbox token changed 37 LEAF HTML pages and ZERO .js bundles
// (BAKED_TOKEN is emitted by generate-tree into each leaf, never into the bundle). A bundle-only
// currency check therefore reported "17 current, 0 STALE — PASS" while every live leaf still
// served BAKED_TOKEN = "" and every map on the platform was broken.
// The lesson generalises: generate-tree owns the leaf pages, vite owns the bundles, and a publish
// can change EITHER independently. Checking one proves nothing about the other.
const leafStale = []; let leafMatched = 0; let leafUnreachable = 0
for (const b of local.bundles || []) {
  const profile = b.profiles?.[0]?.profile
  if (!profile) continue
  const rel = `${b.bundle}/${profile}/index.html`
  const localPath = join(ROOT, 'public', TREE_NAME, rel)
  if (!existsSync(localPath)) continue
  const { buf, err } = await fetchBuf(`${BASE}/${rel}`)
  // Same MISSING-vs-UNREACHABLE split as the bundle loop above: a 4xx is the server telling us the
  // leaf page is not published, which is a loss; anything else is an environment condition.
  if (err) {
    if (/^HTTP 4\d\d/.test(err)) missing.push({ bundle: rel, url: `${BASE}/${rel}`, err })
    else leafUnreachable++
    continue
  }
  const want = sha384(readFileSync(localPath))
  const got = sha384(buf)
  if (want === got) leafMatched++
  else leafStale.push({ rel, want: want.slice(0, 22), got: got.slice(0, 22) })
}
console.log(`CATALOG-CURRENCY: leaves — ${leafMatched} current · ${leafStale.length} STALE · ${leafUnreachable} unreachable`)
for (const s of leafStale) console.error(`  ✗ ${s.rel}\n      local  ${s.want}…\n      live   ${s.got}…`)
stale.push(...leafStale.map(s => ({ bundle: s.rel, want: s.want, got: s.got })))

console.log(`CATALOG-CURRENCY: ${matched.length} current · ${stale.length} STALE · ` +
            `${missing.length} MISSING · ${unreachable} unreachable (of ${localBundles.size} local bundles)`)

// MISSING is reported before STALE because it is the worse finding: a stale bundle serves old code,
// an absent one serves nothing at all, and the remedy differs (re-publish vs. work out what dropped
// it from the merge).
if (missing.length) {
  console.error(`\nCATALOG-CURRENCY: FAIL — ${missing.length} locally-built bundle(s) are ABSENT from the live catalog:`)
  for (const m of missing) console.error(`  ✗ ${m.bundle}\n      ${m.url} → ${m.err}`)
  console.error(
    '\n  Something was LOST between the build and the catalog — the merge dropped it, or the publish\n' +
    '  never included it. This is the guarantee Card 1 Step 1 asks for ("merge all bundles so nothing\n' +
    '  is lost"). Re-run the publish and assert the resulting bundle SET, not just the changed files:\n' +
    `    rsync -a --delete public/${TREE_NAME}/ <catalog>/app/${TREE_NAME}/   # --delete mirrors removals\n` +
    '  then confirm every local bundle name appears live before pushing.'
  )
  process.exit(1)
}

if (stale.length) {
  for (const s of stale) console.error(`  ✗ ${s.bundle}\n      local  ${s.want}…\n      live   ${s.got}…`)
  console.error('\n  The live catalog is BEHIND this build. Publish per')
  console.error('  _qa-cycle/03-deployment-cycle/delegation/RUNBOOK-publish-bundles-to-catalog.md')
  console.error(`  (rsync public/${TREE_NAME}/ into the catalog, then push with -c http.postBuffer=524288000).`)
  process.exit(1)
}
console.log('CATALOG-CURRENCY: PASS — every local bundle is present live and matches this build.')
