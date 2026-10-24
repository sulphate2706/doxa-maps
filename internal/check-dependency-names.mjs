#!/usr/bin/env node
/**
 * check-dependency-names.mjs — every declared dependency must be a REAL package name.
 *
 * WHY (a P0 found 2026-09-22 by cloning the repo and running the documented first command)
 * `bun install` FAILED in a fresh clone:
 *
 *     error: GET https://registry.npmjs.org/@deployment%2fcapacitor%2fcli - 405
 *     error: @deployment/capacitor/cli@7 failed to resolve
 *
 * The rename of `capacitor/` → `deployment/capacitor/` had done a blind string replace that also
 * rewrote three NPM PACKAGE NAMES: @capacitor/{android,cli,core} became @deployment/capacitor/*,
 * which do not exist on npm. A folder rename reached into a namespace it had no business touching.
 *
 * ★ THE SHAPE THIS GUARDS — AN INHERITOR-ONLY FAILURE. The local tree worked PERFECTLY, because
 * node_modules/@capacitor/* had been installed BEFORE the rename. Every build passed, every gate
 * passed, `check:no-abs-paths` scanned 783 files and passed. The breakage lived ONLY in the
 * DECLARED names, so it was invisible to everyone except someone installing from scratch — which
 * is precisely the person the north star is about ("the path Doxa inherits").
 *
 * WHAT IT CHECKS, and why this is enough to catch that class OFFLINE:
 *   1. the declared name resolves under node_modules/, and
 *   2. the installed package's OWN `name` field equals the declared key.
 * A corrupted name fails (1) because nothing was ever installed under it. A name that resolves to
 * a DIFFERENT package fails (2) — the case a path-based check alone would miss.
 *
 * WHY NOT JUST RUN `bun install` IN CI. That needs a network and a clean cache to be meaningful,
 * and a warm lockfile hides exactly this defect. This runs in milliseconds, offline, against the
 * tree as it stands. It does NOT replace the clone test — see the note at the foot of the
 * standalone-gate table — it makes the cheap half of it automatic.
 *
 * NEGATIVE-TESTED: renaming a declared dependency to a nonexistent scope makes this FAIL naming
 * the key; restoring it returns PASS. A package.json with no dependencies FAILS (vacuous guard).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let pkg
try {
  pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
} catch (e) {
  console.error(`DEPENDENCY-NAMES: FAIL — cannot read package.json (${String(e.message).slice(0, 60)}).`)
  process.exit(1)
}

const declared = []
for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, range] of Object.entries(pkg[section] || {})) declared.push({ section, name, range })
}

// Vacuous guard: "0 dependencies" must never read as "0 problems".
const MIN_DECLARED = 5
if (declared.length < MIN_DECLARED) {
  console.error(`DEPENDENCY-NAMES: FAIL — only ${declared.length} declared dependency(ies) ` +
                `(expected >= ${MIN_DECLARED}). package.json is empty or unreadable; refusing to pass vacuously.`)
  process.exit(1)
}

const problems = []
let verified = 0
let uninstalled = 0

for (const { section, name, range } of declared) {
  const pj = join(ROOT, 'node_modules', name, 'package.json')
  if (!existsSync(pj)) {
    // Not installed. That is the CORRUPTED-NAME signature when node_modules is otherwise populated:
    // nothing could ever have been installed under a name that does not exist upstream.
    uninstalled++
    problems.push({ section, name, range, why: 'declared but NOT INSTALLED — is this a real package name?' })
    continue
  }
  let real
  try { real = JSON.parse(readFileSync(pj, 'utf8')).name } catch { real = null }
  if (real !== name) {
    problems.push({ section, name, range, why: `resolves to a package whose own name is ${JSON.stringify(real)}` })
    continue
  }
  verified++
}

console.log(`DEPENDENCY-NAMES: ${declared.length} declared, ${verified} verified against node_modules.`)

// If node_modules is absent entirely, this gate cannot judge — say so rather than fail or pass.
if (uninstalled === declared.length) {
  console.log('DEPENDENCY-NAMES: SKIP — node_modules/ is empty or absent, so nothing can be cross-checked.')
  console.log('  Run `bun install` first. An absent tree is not evidence either way.')
  process.exit(0)
}

if (problems.length) {
  console.error(`\nDEPENDENCY-NAMES: FAIL — ${problems.length} declared dependency(ies) do not check out:`)
  for (const p of problems) console.error(`  ✗ ${p.section}: ${p.name}@${p.range}\n      ${p.why}`)
  console.error(
    '\n  A declared name that does not exist upstream breaks `bun install` in a FRESH CLONE while\n' +
    '  working perfectly here, because the real package is already in node_modules from before the\n' +
    '  change. Check whether a rename or a search-and-replace rewrote a package name: that is how\n' +
    '  @capacitor/cli became @deployment/capacitor/cli (2026-09-22).'
  )
  process.exit(1)
}

console.log('DEPENDENCY-NAMES: PASS — every declared dependency is a real, correctly-named package.')
