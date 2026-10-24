#!/usr/bin/env node
/**
 * sri-consistency-check.mjs — assert every leaf's baked SRI MATCHES the bundle it loads.
 *
 * ★ WHY THIS EXISTS — it caught a REAL live breakage on 2026-09-20 (after the fact).
 *   The publish gate already asserted that every manifest bundle RESOLVES (the .js exists).
 *   That is NOT enough. A tree can have every file present and still be internally
 *   INCONSISTENT, and publishing it breaks the element in production.
 *
 *   THE MECHANISM (know this before you "just rebuild one bundle"):
 *     `BUNDLE=x bun x vite build`  rewrites  public/doxa-maps/x/x.js
 *     but the leaf page  public/doxa-maps/x/x/index.html  carries a BAKED
 *     integrity="sha384-..." that the per-bundle build does not touch.
 *   Two things re-bake it. `bun run fix:sri` (internal/fix-sri.mjs) rewrites the hashes and
 *   NOTHING else. `bun run tree` (internal/generate-tree.mjs) re-bakes them as a side effect of
 *   regenerating every page from source. NEITHER needs the full build — an earlier version of
 *   this comment said generate-tree "runs ONLY in the full build", which is false (it is its own
 *   script) and is exactly why agents kept reaching for the destructive rebuild.
 *   So a single-bundle build leaves the bundle NEWER than its leaf. Publish that pair and
 *   the browser refuses to execute the script:
 *     "Failed to find a valid digest in the 'integrity' attribute for resource ..."
 *   The element then never registers — customElements.get() is false, no shadow root,
 *   blank element. It looks exactly like a catastrophic bundle failure. It is not: the
 *   bundle is fine, the HASHES simply disagree.
 *
 *   PAINFUL IRONY worth remembering: the instruction "use BUNDLE=x vite build instead of
 *   bun run build, to avoid clobbering the shared output tree" is what CAUSED this. The
 *   safety advice created a different hazard. The fix is not to ban single-bundle builds —
 *   it is to make sure an inconsistent tree can never SHIP.
 *
 * ★ WHAT THIS CHECK CANNOT SEE — a DELETED leaf (so never run it alone before a publish).
 *   This script walks the leaves that EXIST and asserts each one's baked hash matches its
 *   bundle. It asserts NOTHING about how many leaves there should be. A leaf that no longer
 *   exists is simply not checked — the gate passes because there is nothing left to disagree.
 *   So a tree gutted by a per-bundle `BUNDLE=x vite build` (which empties OTHER bundles' leaf
 *   index.html) returns a confident PASS here while being unpublishable.
 *   The leaf COUNT is settled-tree-gate.mjs's signal 4 (leaves >= MIN_LEAVES). The two checks
 *   are complementary and the publish runbook runs BOTH:
 *       bun run check:settled && bun run check:sri
 *   Named by the grid-palette agent, 2026-09-20, after a five-sample poll watched leaves climb
 *   0 -> 58 mid-build; a single sample of a moving tree cannot tell "destroyed" from "rebuilding".
 *
 *   NOT the same thing as the 5-minute SRI CACHE trap documented in the publish runbook.
 *   That one is TRANSIENT (republishing the same bundle inside the 300s max-age serves a
 *   stale .js against a fresh integrity) and resolves itself. THIS one is PERMANENT —
 *   the bytes on disk genuinely disagree, and waiting changes nothing.
 *
 * USAGE
 *   node internal/sri-consistency-check.mjs [treeDir]     # default public/doxa-maps
 * Exits 1 listing every mismatch, so the publish gate aborts under `set -e`.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { TREE_NAME } from './_tree-name.mjs'

const TREE = process.argv[2] || `public/${TREE_NAME}`
if (!existsSync(TREE)) {
  console.error('SRI-CONSISTENCY: tree not found: ' + TREE)
  process.exit(2)
}

function sri(file) {
  return 'sha384-' + createHash('sha384').update(readFileSync(file)).digest('base64')
}

// Walk every generated leaf page and check the <script src integrity> pair it declares.
function leafPages(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) leafPages(p, out)
    else if (e.name === 'index.html') out.push(p)
  }
  return out
}

const pages = leafPages(TREE)
let checked = 0
const bad = []
const missing = []

for (const page of pages) {
  const html = readFileSync(page, 'utf8')
  // Every <script src="..." integrity="sha384-..."> on the page (order-independent attrs).
  const tags = html.match(/<script\b[^>]*>/g) || []
  for (const tag of tags) {
    const src = (tag.match(/\bsrc="([^"]+)"/) || [])[1]
    const want = (tag.match(/\bintegrity="(sha384-[^"]+)"/) || [])[1]
    if (!src || !want) continue
    if (/^https?:|^\/\//.test(src)) continue // third-party (e.g. mapbox CDN) — not ours to verify
    const file = resolve(dirname(page), src)
    if (!existsSync(file)) { missing.push(page + ' -> ' + src); continue }
    checked++
    const got = sri(file)
    if (got !== want) {
      bad.push({ page, src, want: want.slice(0, 26), got: got.slice(0, 26) })
    }
  }
}

console.log('SRI-CONSISTENCY: checked ' + checked + ' script reference(s) across ' + pages.length + ' leaf page(s).')

if (missing.length) {
  console.error('\nSRI-CONSISTENCY: ' + missing.length + ' referenced script(s) DO NOT EXIST:')
  for (const m of missing.slice(0, 10)) console.error('  ' + m)
}

if (bad.length) {
  console.error('\nSRI-CONSISTENCY: FAIL — ' + bad.length + ' leaf/bundle pair(s) DISAGREE:')
  for (const b of bad) {
    console.error('  ' + b.page)
    console.error('      loads : ' + b.src)
    console.error('      leaf wants: ' + b.want + '...')
    console.error('      bundle is : ' + b.got + '...')
  }
  console.error('\n  CAUSE: a single-bundle `BUNDLE=x bun x vite build` rewrote the .js without')
  console.error('         re-baking the hash into the leaf that loads it.')
  console.error('  FIX  : bun run fix:sri        # rewrites ONLY the disagreeing hashes (~0.4s, writes')
  console.error('                               # only the offending pages, leaves the tree settled)')
  console.error('         …then re-run this check. Do NOT publish until it passes.')
  console.error('')
  console.error('  ★ DO NOT reach for `bun run build` here. This message used to prescribe exactly')
  console.error(`    that, and it is the destructive remedy: its first step DELETES public/${TREE_NAME}/,`)
  console.error('    tearing the tree out from under every other agent reading it (measured 3+ times,')
  console.error('    incl. a 461-file phantom deletion and several false "element did not mount"')
  console.error('    diagnoses). A full rebuild cannot fix anything here that rehashing does not —')
  console.error('    the bundles are already built; only the recorded hashes disagree.')
  console.error('    `bun run tree` also re-bakes them correctly, but it rewrites 1234 files under')
  console.error('    public/ every run (measured), which fails your neighbours\' check:settled for 45s')
  console.error('    and re-reads .vue SOURCE — so on a shared branch it bakes in whatever another')
  console.error('    agent has half-finished. Prefer fix:sri; use tree when you actually want the')
  console.error('    pages regenerated from source.')
  process.exit(1)
}

if (missing.length) process.exit(1)
console.log('SRI-CONSISTENCY: PASS — every leaf\'s baked integrity matches the bundle it loads.')
