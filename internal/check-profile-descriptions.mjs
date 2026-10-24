#!/usr/bin/env node
/**
 * check-profile-descriptions.mjs — every shipped profile must say what it is.
 *
 * WHY (measured 2026-09-22)
 * 15 of 26 profiles shipped with an EMPTY `description` in manifest.json. In the plugin-studio —
 * the surface a Doxa inheritor opens to learn what exists — those rendered as a bare
 * "bundle · <tag>" and nothing else:
 *
 *     doxa-research-map · <doxa-research-map>
 *
 * while `stack-demo`, a demo bundle, explained itself fully. The hand-off was inverted: the least
 * important artifact was the best documented. The built gallery was 15 empty / 11 populated, and
 * the cap-5 SPA fell back to labelling such a tab "experimental bundle".
 *
 * ★ WHY A GATE AND NOT JUST THE FIX. The repo already validates `@element` — but only against a
 * MALFORMED value. An ABSENT `@description` fails silently: the generator writes '', every gate
 * passes, and the defect only appears to a human who opens the studio and reads. That is the worst
 * shape for a hand-off property, because the north star ("develop a plugin and see it live") means
 * NEW PLUGINS ARRIVE OFTEN — each one a fresh chance to regress this with no signal. A fix without
 * a gate is a fix with a half-life.
 *
 * THE TRAP THAT MOTIVATES THE IMPLEMENTATION: read the MANIFEST, not the sources.
 * The description reaches users through manifest.json. Re-deriving it here by parsing .vue headers
 * would mean reimplementing generate-tree's TAG_RE — and that is exactly the mistake that hid two
 * of the 15: a hand-written copy of that regex reported "13 extractable, 0 problems" while the real
 * rule (which requires a leading `*` on the line) extracted nothing from two HTML-comment headers.
 * ★ CHECK THE ARTIFACT THE CONSUMER READS, never a reimplementation of how it was produced.
 *
 * NEGATIVE-TESTED: blanking one description in manifest.json makes this FAIL naming that profile,
 * EXIT=1; restoring it returns PASS. A manifest with zero profiles FAILS (vacuous-pass guard)
 * rather than passing for lack of anything to check.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')

// A description shorter than this is a placeholder, not an explanation. Calibrated against the
// REAL corpus rather than a guess (measured 2026-09-22): shortest genuine description 62 chars,
// median 81, longest 192. 25 therefore sits well clear of every legitimate entry while still
// catching a one-word stub. The bar is deliberately low — this gate catches ABSENCE, it does not
// grade prose, and a gate that argues about writing quality gets disabled.
const MIN_CHARS = 25

// Vacuous-pass guard. If the manifest is missing or empty this gate must FAIL, because "no
// profiles to check" is indistinguishable from "the build did not run" — and a gate that passes
// when it measured nothing is worse than no gate (this repo has already been bitten by exactly
// that shape in the settled-tree check).
const MIN_EXPECTED_PROFILES = 20

if (!existsSync(MANIFEST)) {
  console.error(`PROFILE-DESCRIPTIONS: FAIL — no manifest.json at public/${TREE_NAME}/.`)
  console.error('  This gate reads the BUILT manifest (the artifact consumers actually read).')
  console.error('  Run `bun run build` first; an absent manifest is a failure, not a pass.')
  process.exit(1)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
} catch (e) {
  console.error(`PROFILE-DESCRIPTIONS: FAIL — manifest.json does not parse: ${e.message}`)
  process.exit(1)
}

const bundles = Array.isArray(manifest.bundles) ? manifest.bundles : []
const offenders = []
let checked = 0

for (const b of bundles) {
  const bundleName = b.name || b.bundle || '(unnamed bundle)'
  for (const p of (b.profiles || [])) {
    checked++
    const desc = String(p.description || '').trim()
    if (desc.length >= MIN_CHARS) continue
    offenders.push({
      id: `${bundleName}/${p.profile}`,
      file: p.file || `${p.profile}.vue`,
      bundle: bundleName,
      why: desc.length === 0 ? 'empty' : `only ${desc.length} chars`,
    })
  }
}

console.log(`PROFILE-DESCRIPTIONS: ${checked} profile(s) across ${bundles.length} bundle(s), ` +
            `${checked - offenders.length} described.`)

if (checked < MIN_EXPECTED_PROFILES) {
  console.error(`\nPROFILE-DESCRIPTIONS: FAIL — only ${checked} profile(s) found, expected at least ` +
                `${MIN_EXPECTED_PROFILES}.`)
  console.error('  This is the VACUOUS-PASS GUARD. Too few profiles means the manifest is stale or')
  console.error('  the build was interrupted, so a green result here would certify nothing.')
  process.exit(1)
}

if (offenders.length) {
  console.error(`\nPROFILE-DESCRIPTIONS: FAIL — ${offenders.length} profile(s) ship without an explanation:`)
  for (const o of offenders) {
    console.error(`  ✗ ${o.id}  (${o.why})  → plugin-designs/${o.bundle}/${o.file}`)
  }
  console.error(
    '\n  Add a JSDoc @description tag to the profile\'s .vue header. THE TAG, NOT THE PROSE:\n' +
    '  generate-tree matches /^\\s*\\*\\s*@([\\w-]+)\\s+(.+?)\\s*$/gm, so the line MUST begin with an\n' +
    '  asterisk — a rich prose header with no tag extracts to an empty string. If the file uses an\n' +
    '  HTML comment (<!-- … -->) rather than JSDoc, write the line as "* @description …" anyway.\n' +
    '\n' +
    '  Say what the plugin IS and what a reader would use it for, in one or two sentences. This text\n' +
    '  is what a new developer sees in the plugin-studio, the gallery, and the SPA\'s Experimental\n' +
    '  rail — it is the hand-off, not decoration.'
  )
  process.exit(1)
}

console.log('PROFILE-DESCRIPTIONS: PASS — every shipped profile explains what it is.')
