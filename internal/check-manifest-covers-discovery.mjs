#!/usr/bin/env node
/**
 * check-manifest-covers-discovery.mjs — every DISCOVERED bundle must appear in the built manifest.
 *
 * THE DEFECT THIS CATCHES (found 2026-09-22 by comparing the dev and built manifests, not by any gate):
 *     discovered bundles ........ 19
 *     bundles in manifest ....... 19          <- the counts MATCH
 *     discovered but MISSING .... 1  key-cities
 *     in manifest, not real ..... 1  template-bundle
 * `key-cities` had its compiled key-cities.js on disk but ZERO profile leaf directories, so its four
 * profiles vanished from manifest.json and from the studio's tab list. A tree under review
 * silently omitted a whole plugin.
 *
 * ★ WHY EVERY EXISTING GATE PASSED — this is the interesting part, and the reason for a new file:
 *   - the settled-tree LEAF FLOOR counts index.html recursively (44, floor 40). A bundle that loses
 *     ALL its leaves while another keeps extras stays comfortably above the floor.
 *   - check:embed-targets asserts every target the manifest LISTS exists on disk. It cannot see a
 *     bundle the manifest never listed — an omission is invisible to a check that iterates the list.
 *   - a BUNDLE COUNT comparison would also have passed: 19 == 19, because one bundle was effectively
 *     swapped for another. Counting is not covering.
 * The only way to catch an omission is to compare the manifest against the INDEPENDENT source of
 * truth — the scanner — rather than against itself.
 *
 * ★ `template-bundle` IS EXCLUDED BY DESIGN, NOT BY ACCIDENT. discover.mjs:111 filters it by name:
 *     n !== 'template-bundle'
 * It is the scaffold a new plugin is copied from, so it correctly is not a plugin. This gate therefore
 * only fails on the DISCOVERED-BUT-MISSING direction. The reverse (a manifest entry the scanner does
 * not return) is reported as a WARNING, because stale build output is real but is healed by the next
 * full build, whereas a missing plugin is silently absent from the product.
 *
 * NEGATIVE-TESTED: removing any bundle from manifest.json makes this FAIL naming it; restoring passes.
 * A run that discovers fewer than MIN_BUNDLES FAILS rather than passing vacuously.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverSpaRegistry } from './plugin-gallery/discover.mjs'
import { TREE_NAME } from './_tree-name.mjs'
import { isWebBuilt } from './plugin-targets.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
const MIN_BUNDLES = Number(process.env.MIN_BUNDLES || 10)

if (!existsSync(MANIFEST)) {
  console.error(`MANIFEST-COVERS: FAIL — public/${TREE_NAME}/manifest.json does not exist.`)
  console.error('  Run `bun run build` first; there is nothing to compare against.')
  process.exit(1)
}

let registry
try { registry = discoverSpaRegistry() }
catch (e) {
  console.error('MANIFEST-COVERS: FAIL — the scanner threw: ' + e.message)
  process.exit(1)
}

// Vacuous guard: "0 discovered" must never read as "0 problems".
if (registry.length < MIN_BUNDLES) {
  console.error(`MANIFEST-COVERS: FAIL — only ${registry.length} bundle(s) discovered (expected >= ${MIN_BUNDLES}).`)
  console.error('  The scanner is broken or plugin-designs/ is empty. Refusing to pass vacuously.')
  process.exit(1)
}

// ★ THE BUILD HAS A THIRD INPUT, AND OMITTING IT MADE THIS GATE CRY WOLF ON ITS FIRST REAL RUN.
// The first version of this file compared the SCANNER against the MANIFEST and reported any
// difference as a defect. It immediately "found" key-cities — discovered with 4 profiles, absent from
// the manifest — which looked exactly like the silent-omission bug it was written for, and survived a
// full rebuild, which made it look persistent and real.
//
// It is neither. vite.doxa-maps-build-config.json sets `gatedProfiles: ["key-cities"]`, and
// generate-tree.mjs:154 filters on it:
//     const isBundleDir = (name) => !name.startsWith('_') && !name.startsWith('.')
//                                   && !DEST_CONFIG.gatedProfiles.includes(name)
// So a bundle can be legitimately DISCOVERED (it is on disk with an index.js) and legitimately
// EXCLUDED (the config says do not publish it). The scanner answers "what exists"; the config answers
// "what ships". Comparing the first against the manifest without consulting the second asserts an
// invariant that was never true.
//
// This matters more than the bug it fixes: a gate that reports a deliberate configuration as a defect
// gets switched off, and a switched-off gate protects nothing. Read the same config the build reads.
let gated = []
try {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
  gated = Array.isArray(cfg.gatedProfiles) ? cfg.gatedProfiles.map(String) : []
} catch { gated = [] }

// ★ AND A FOURTH: a bundle whose every profile targets something other than the web (Rudder:
// desktop + widget) is built by desktop:build, never into the tree. generate-tree and run-parallel
// skip it through the same isWebBuilt(); read it here too, or its deliberate absence reads as the
// silent-omission bug this gate exists for.
const nonWeb = registry.filter(b => !isWebBuilt(join(ROOT, 'plugin-designs', b.bundle))).map(b => b.bundle)
gated = [...gated, ...nonWeb]

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const listed = new Map((manifest.bundles || []).map(b => [b.bundle, (b.profiles || []).length]))
const found = new Map(
  registry
    .filter(b => !gated.includes(b.bundle))
    .map(b => [b.bundle, new Set(b.items.map(i => i.profile)).size])
)
const gatedPresent = registry.filter(b => gated.includes(b.bundle)).map(b => b.bundle)

const missingBundles = [...found.keys()].filter(b => !listed.has(b))
const orphanBundles = [...listed.keys()].filter(b => !found.has(b))

// A bundle can be listed and still be short PROFILES — the same silent-omission shape one level down,
// so check it too rather than stopping at bundle identity.
const shortProfiles = []
for (const [bundle, n] of found) {
  if (!listed.has(bundle)) continue
  if (listed.get(bundle) < n) shortProfiles.push({ bundle, listed: listed.get(bundle), found: n })
}

console.log(`MANIFEST-COVERS: ${found.size} publishable bundle(s) discovered, ${listed.size} listed in the manifest.`)
if (gatedPresent.length) {
  console.log(`  gated by config (present on disk, deliberately NOT published): ${gatedPresent.join(', ')}`)
}

if (orphanBundles.length) {
  console.log(`  note: ${orphanBundles.length} manifest entr(y/ies) the scanner does not return: ${orphanBundles.join(', ')}`)
  console.log('        Stale build output — healed by the next full build. Not a failure.')
}

if (missingBundles.length || shortProfiles.length) {
  console.error('\nMANIFEST-COVERS: FAIL — the built manifest does not cover everything the scanner finds:')
  for (const b of missingBundles) {
    console.error(`  ✗ ${b} — discovered with ${found.get(b)} profile(s), ENTIRELY ABSENT from manifest.json`)
  }
  for (const s of shortProfiles) {
    console.error(`  ✗ ${s.bundle} — discovered ${s.found} profile(s), manifest lists only ${s.listed}`)
  }
  console.error(
    '\n  A plugin missing from the manifest is missing from the STUDIO: the tab list is built from this\n' +
    '  file, so the plugin silently does not exist for anyone reviewing the product. Counting bundles\n' +
    '  would not have caught it — one bundle can be swapped for another and the totals still match.\n' +
    '  Usual cause: the bundle has its compiled .js but no profile leaf directories, so generate-tree\n' +
    '  emitted nothing for it. A full `bun run build` regenerates both; a per-bundle vite build does not.'
  )
  process.exit(1)
}

console.log('MANIFEST-COVERS: PASS — every discovered bundle and profile appears in the built manifest.')
console.log('  This compares the manifest against the SCANNER, not against itself: a check that iterates')
console.log('  the manifest can never notice something the manifest forgot to list.')
