#!/usr/bin/env node
/**
 * check-gated-not-in-tree — a GATED profile (the build config's gatedProfiles) never reaches the public tree.
 *
 * A gated bundle builds, but must appear on no public surface. generate-tree already left it out of the
 * manifest and the pages; its bundle file did not: public/<tree>/key-cities/key-cities.js was committed,
 * rebuilt into public/ by every landing that found it "stale", and copied by any host that serves or
 * drops in the tree folder whole. vite.config.js now builds a gated bundle into .gated/<tree>/ (ignored
 * by git), and this asserts the result where it matters: in the built tree.
 *
 * FAILS if, for any gated name: <tree>/<name>/ exists, manifest.json lists it as a bundle or a profile,
 * or any page in the tree references <name>/<name>.js. Data tables are NOT in scope: a table can be
 * shared with a public map (key-cities.json feeds Cities with Internet), so whether a dataset is public
 * is a separate decision, not a property of the gated bundle.
 * Two-sided: each arm is first run against a planted leak in a temporary copy.
 *
 * Node only, no browser. Exit 0 pass · 1 fail.
 */
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { TREE_NAME, GATED_PROFILES } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TREE = join(ROOT, 'public', TREE_NAME)

function htmlFiles(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) { if (f !== 'assets') htmlFiles(p, out) }
    else if (f.endsWith('.html')) out.push(p)
  }
  return out
}

export function gatedLeaks(treeDir, gated) {
  const out = []
  for (const g of gated) {
    if (existsSync(join(treeDir, g))) out.push(`${TREE_NAME}/${g}/ is in the tree (${readdirSync(join(treeDir, g)).join(', ') || 'empty'})`)
  }
  const mf = join(treeDir, 'manifest.json')
  if (existsSync(mf)) {
    const m = JSON.parse(readFileSync(mf, 'utf8'))
    for (const b of m.bundles || []) {
      if (gated.includes(b.bundle)) out.push(`manifest.json lists the gated bundle "${b.bundle}"`)
      for (const p of b.profiles || []) if (gated.includes(p.profile)) out.push(`manifest.json lists the gated profile "${p.profile}" (in ${b.bundle})`)
    }
  }
  if (existsSync(treeDir)) {
    for (const f of htmlFiles(treeDir)) {
      const s = readFileSync(f, 'utf8')
      for (const g of gated) if (s.includes(`${g}/${g}.js`)) out.push(`${f.slice(treeDir.length + 1)} references ${g}/${g}.js`)
    }
  }
  return out
}

const fails = []
if (!existsSync(join(TREE, 'manifest.json'))) {
  console.error(`GATED-NOT-IN-TREE: FAIL — no built tree at public/${TREE_NAME}/manifest.json`)
  process.exit(1)
}

// Planted leaks first, in a temporary tree: a gated bundle folder, a manifest entry, a page reference.
const probe = GATED_PROFILES[0] || 'gated-probe'
const tmp = mkdtempSync(join(tmpdir(), 'gated-probe-'))
try {
  const clean = { bundles: [{ bundle: 'open-map', profiles: [{ profile: 'open-map' }] }] }
  writeFileSync(join(tmp, 'manifest.json'), JSON.stringify(clean))
  if (gatedLeaks(tmp, [probe]).length) fails.push('SELF-TEST: a clean probe tree was reported as leaking')
  mkdirSync(join(tmp, probe)); writeFileSync(join(tmp, probe, `${probe}.js`), '/* planted */')
  if (!gatedLeaks(tmp, [probe]).some((l) => l.includes(`${probe}/ is in the tree`))) fails.push('SELF-TEST: a planted gated bundle folder was not caught')
  rmSync(join(tmp, probe), { recursive: true, force: true })
  writeFileSync(join(tmp, 'manifest.json'), JSON.stringify({ bundles: [...clean.bundles, { bundle: probe, profiles: [{ profile: probe }] }] }))
  if (!gatedLeaks(tmp, [probe]).some((l) => l.includes('manifest.json lists'))) fails.push('SELF-TEST: a planted manifest entry was not caught')
  writeFileSync(join(tmp, 'manifest.json'), JSON.stringify(clean))
  mkdirSync(join(tmp, 'open-map')); writeFileSync(join(tmp, 'open-map', 'index.html'), `<script src="../${probe}/${probe}.js"></script>`)
  if (!gatedLeaks(tmp, [probe]).some((l) => l.includes('references'))) fails.push('SELF-TEST: a planted page reference was not caught')
} finally { rmSync(tmp, { recursive: true, force: true }) }

// The real tree.
const leaks = gatedLeaks(TREE, GATED_PROFILES)
for (const l of leaks) fails.push(l)

if (fails.length) {
  console.error(`GATED-NOT-IN-TREE: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  console.error('  A gated bundle builds into .gated/ (vite.config.js); remove its folder from public/ and regenerate the tree.')
  process.exit(1)
}
console.log(`GATED-NOT-IN-TREE: PASS — ${GATED_PROFILES.length ? GATED_PROFILES.join(', ') : 'no gated profiles'}: no folder in public/${TREE_NAME}/, `
  + 'no manifest entry, no page reference (3 planted leaks each caught).')
