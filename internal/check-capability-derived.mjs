#!/usr/bin/env node
/**
 * check-capability-derived — every bundle lands on a real capability, 1-5, never 0.
 *
 * ★ THE DEFECT. Tiers 3-5 used to be AUTHORED ONLY: discover.mjs infers `single` and `parameterized`
 * and nothing else, so a composite whose author forgot a <profile>.meta.json shipped as capability 1.
 * research-dashboard did exactly that while nesting ten views. A missing file is indistinguishable
 * from a deliberate choice, so nothing failed and the understatement propagated into the manifest,
 * the gallery and the studio rail — every surface that claims a capability reads this one field.
 *
 * WHAT THIS ASSERTS, and why each half is here:
 *   1. Every profile resolves to a capability 1-5. A 0 or a null means some surface will render a
 *      tier that does not exist; that is exactly how the Research Gallery came to show as
 *      capability 0.
 *   2. A profile that composes anything derives cap-4, or cap-5 if it composes a cap-4 — and an
 *      EXPLICIT type must AGREE with that. The declaration stays authoritative; it is not
 *      overridden, it is checked. A meta that contradicts the structure means the meta or the
 *      composes list is stale, and choosing silently between them is how a tier rots.
 *
 * ★ TWO TRAPS THIS GATE EXISTS BECAUSE OF, both found by running the rule before writing it:
 *   - `composes` is PER-PROFILE at source and HOISTED TO THE BUNDLE in the manifest. Deriving from
 *     the bundle row applies a composite's edges to its plain sibling leaves: gospel-resources has one
 *     composite and four single leaves, and all four derived as cap-4. 11 false failures.
 *   - refs appear in THREE FORMS in the same field: 'bundle/profile', a bare 'bundle', and an ELEMENT
 *     TAG. Resolving only the first demoted plugin-studio from 5 to 4; not knowing the third left five
 *     refs "unresolved" and reported as possible typos when all five were correct.
 *   With both handled: 10 composing profiles, 10 agree, 0 disagree, on the tree as it stands.
 *
 * An UNRESOLVED ref now FAILS. It was only ever REPORTED because five were outstanding and they turned
 * out to be correct data this gate could not read — failing then would have blamed five authors for a
 * gap here. At zero, the reasoning inverts: a typo and a genuine non-composite child still look
 * identical from here, so the one thing that must not happen is quietly reading one as the other.
 *
 * Headless, no browser. Exit 0 pass · 1 fail.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { deriveComposedTiers } from './_composed-tiers.mjs'

const TAG = 'CAPABILITY-DERIVED'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PT = { 'nested-mfe-spa': 5, 'nested-elements-mfe': 4, monolithic: 3, parameterized: 2, single: 1 }
const fails = []

const mfPath = join(ROOT, 'public', TREE_NAME, 'manifest.json')
if (!existsSync(mfPath)) { console.log(`${TAG}: SKIP — no built tree at ${TREE_NAME}.`); process.exit(0) }
const manifest = JSON.parse(readFileSync(mfPath, 'utf8'))
const bundles = manifest.bundles || []

// ── 1. every profile has a real capability ─────────────────────────────────────────────────────
let checked = 0
for (const b of bundles) for (const p of b.profiles || []) {
  checked++
  const cap = PT[p.type]
  if (!cap) fails.push(`${b.bundle}/${p.profile}: type ${JSON.stringify(p.type)} is not one of the five tiers — every surface that shows a capability reads this.`)
}

// ── 2. a declared tier must agree with the edges it declares ────────────────────────────────────
// Uses the SHARED resolver (internal/_composed-tiers.mjs) rather than a second copy. Two implementations of a rule this
// fiddly — three ref vocabularies and a self-exclusion — would drift, and the drift would show up as a
// gate that passes a manifest the generator would refuse to write. What stays independent is the DATA:
// the gate rebuilds composesOwn from the <profile>.meta.json files on disk and checks the PUBLISHED
// manifest against them, so a manifest that no longer matches its own sources still fails.
const readMeta = (bundle, profile) => {
  const f = join(ROOT, 'plugin-designs', bundle, `${profile}.meta.json`)
  try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null } catch { return null }
}
let composing = 0
const probe = bundles.map((b) => ({
  ...b,
  profiles: (b.profiles || []).map((p) => {
    const meta = readMeta(b.bundle, p.profile)
    const own = Array.isArray(meta?.composes) ? meta.composes.map(String).filter(Boolean) : []
    if (own.length) composing++
    return { ...p, composesOwn: own.length ? own : null }
  }),
}))
const { conflicts, unresolved } = deriveComposedTiers(probe)
for (const c of conflicts) fails.push(`${c} — the meta.json or the composes list is stale.`)
for (const u of unresolved) fails.push(`${u}: composes ref resolves to nothing. A ref may be "<bundle>/<profile>", a bare "<bundle>", or a registered element tag.`)

console.log(`  · ${checked} profile(s) across ${bundles.length} bundle(s); ${composing} declare composes edges`)

if (fails.length) {
  console.error(`\n${TAG}: FAIL`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — every profile lands on a real tier 1-5, and every declared tier agrees with its own composes edges.`)
