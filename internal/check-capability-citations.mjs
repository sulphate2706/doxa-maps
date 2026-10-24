#!/usr/bin/env node
/**
 * check-capability-citations.mjs — a doc that names a bundle as "capability N" must match the manifest.
 *
 * THE BUG THIS EXISTS TO PREVENT (real, and found TWICE in two different artifacts)
 * README.md captioned `doxa-vision-card` as "Capability 1 — a single-element plugin". It is not one:
 * it ships doxa-vision-card.instances.json with TWO instances, so discover.mjs types it
 * PARAMETERIZED and manifest.json records type "parameterized" — capability 2.
 *
 * ★ THE SAME ERROR HAD ALREADY BEEN FOUND AND FIXED SOMEWHERE ELSE. internal/verify-5-capabilities.mjs
 * carries its own note: it "had been reporting '5/5 capability levels' while sampling cap-2 TWICE and
 * cap-1 NEVER", and switched its cap-1 representative to all-people-groups. That fix landed in the
 * GATE and never reached the README. Two artifacts encoding one fact, with nothing forcing agreement
 * — the same shape as the .dsm-loading CSS pair, the writer-vs-client token path, and the doc that
 * quotes package.json. Fixing one copy is not fixing the fact.
 *
 * WHY THE MANIFEST IS THE AUTHORITY
 * `capability = 5 - PROFILE_TIER`, and the tier is what the BUILD computed from the folder's real
 * shape (an *.instances.json makes it parameterized; a meta.json `type` declares tiers 3/4/5).
 * manifest.json is that computation's output, so it cannot disagree with what ships. Prose can.
 *
 * ★ WHY A FOLDER'S APPARENT SIMPLICITY IS THE TRAP: doxa-vision-card looks like the lightest thing in
 * the repo — no map engine, mounts instantly, one small .vue. Everything about it reads "cap-1"
 * EXCEPT the one file that decides the tier. The gate looks at that file's consequence, not the vibe.
 *
 * WHAT IT CHECKS
 * Every `![Capability N — ... (bundle-name)]` caption and every "CAP N" section that names a
 * `plugin-designs/<bundle>/` path, resolved against manifest.json's declared type.
 *
 * NEGATIVE-TESTED: pointing the cap-1 caption back at doxa-vision-card makes this FAIL naming the
 * bundle, its claimed tier and its real one; restoring all-people-groups returns PASS. A run that
 * parses fewer than MIN_EXPECTED citations FAILS rather than passing vacuously.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const README = join(ROOT, 'README.md')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')

// ★ WIDENED 2026-09-22 TO documentation/ AS WELL AS README.md.
//
// This file's own header names the failure it exists to prevent: "Two artifacts encoding one fact,
// with nothing forcing agreement — fixing one copy is not fixing the fact." It then guarded exactly
// ONE artifact. Measured: planting `doxa-vision-card is the capability 1 exemplar` into
// documentation/reference.md PASSED both this gate and check:capability-exemplars — the precise
// error this file was built to catch, sitting one directory outside its scan.
//
// documentation/ currently states the tier CORRECTLY (reference-capability-exemplars.md types it
// `parameterized`, and reference.md:52 warns that "folder's apparent simplicity does not decide its
// tier"), so this widening is not fixing a live defect — it is closing the hole that let the same
// defect recur unnoticed in a second place.
//
// NOT COVERED, and it cannot be: the /plugin-designer SKILL carries the same stale citation and
// lives outside this repo, so no gate here can reach it. That is why the fix is an edit outside this repo; the
// repo's job is to hold the checkable half (see BUILD-PLUGIN-DESIGNER-SKILL-MEANS-REAL-WORK).
const DOC_DIR = join(ROOT, 'documentation')
const DOC_FILES = existsSync(DOC_DIR)
  ? readdirSync(DOC_DIR).filter(f => f.endsWith('.md')).map(f => join(DOC_DIR, f))
  : []

if (!existsSync(README) || !existsSync(MANIFEST)) {
  console.log('CAPABILITY-CITATIONS: SKIP — README.md or manifest.json not present.')
  process.exit(0)
}

// capability = 5 - PROFILE_TIER (internal/plugin-gallery/discover.mjs). Machine key -> capability.
const CAP_OF_TYPE = {
  'single': 1,
  'parameterized': 2, 'preset-element': 2,
  'monolithic': 3, 'multi-view-element': 3,
  'nested-elements-mfe': 4, 'composite-element': 4,
  'nested-mfe-spa': 5, 'app-shell': 5,
}

const mf = JSON.parse(readFileSync(MANIFEST, 'utf8'))
// A bundle's capability = the HIGHEST tier any of its profiles declares (a composite bundle may
// also ship its plain leaves; the bundle is cited by its top tier).
const capOfBundle = new Map()
for (const b of (mf.bundles || [])) {
  let best = 0
  for (const p of (b.profiles || [])) {
    const c = CAP_OF_TYPE[p.type]
    if (c && c > best) best = c
  }
  if (best) capOfBundle.set(b.bundle, best)
}

// Every scanned artifact, concatenated with a file marker so a finding can name its source.
// README stays first so its citations are reported in the same order as before.
const SOURCES = [README, ...DOC_FILES]
const doc = SOURCES.map(f => `\n<!-- FILE:${f.replace(ROOT + '/', '')} -->\n` + readFileSync(f, 'utf8')).join('\n')

// `![Capability N — ... (bundle)](...)` — the caption form that names its subject in parentheses.
const CAPTION = /!\[Capability\s+(\d)\s*[—-][^\]]*\(([a-z0-9-]+)\)\]/gi

// `### CAP N — …` down to the next `### ` heading, then every `plugin-designs/<bundle>/` inside it.
// ★ SPLIT RATHER THAN REGEX-SCAN. The first version used /^###\s+CAP\s+(\d)\b([\s\S]*?)(?=^###\s|\Z)/gim
// and matched ZERO sections — `\Z` is not JavaScript (that is Python/PCRE), and under the `m` flag
// the fallback `$` matches every LINE end, so each section body truncated to its first line. The
// run still printed "5 citation(s) parsed" because the count included entries the matcher never
// resolved. ★ A GATE THAT REPORTS A NUMBER IT DID NOT VERIFY is the exact failure this file's
// MIN_EXPECTED guard exists to prevent, so the guard has to count REAL matches.
const sections = doc.split(/^###\s+/m).slice(1)

const citations = []
for (const m of doc.matchAll(CAPTION)) citations.push({ claimed: +m[1], bundle: m[2], where: 'caption' })
for (const body of sections) {
  const head = body.match(/^CAP\s+(\d)\b/)
  if (!head) continue
  const claimed = +head[1]
  for (const p of body.matchAll(/plugin-designs\/([a-z0-9-]+)\//g)) {
    citations.push({ claimed, bundle: p[1], where: `CAP ${claimed} section` })
  }
}

// A matcher that finds almost nothing reads exactly like a clean pass (see check-quoted-scripts).
const MIN_EXPECTED = 5
console.log(`CAPABILITY-CITATIONS: ${citations.length} citation(s) parsed from README.md; ` +
            `${capOfBundle.size} bundle(s) typed in manifest.json.`)
if (citations.length < MIN_EXPECTED) {
  console.error(`\nCAPABILITY-CITATIONS: FAIL — only ${citations.length} parsed (expected >= ${MIN_EXPECTED}).`)
  console.error('  The MATCHER is broken, not the README. Fix the regex before trusting this result.')
  process.exit(1)
}

const wrong = [], unknown = []
for (const c of citations) {
  const actual = capOfBundle.get(c.bundle)
  if (actual === undefined) { unknown.push(c); continue }
  if (actual !== c.claimed) wrong.push({ ...c, actual })
}

for (const u of unknown) {
  console.log(`  i not a built bundle, skipped: ${u.bundle} (cited as cap-${u.claimed} in ${u.where})`)
}

if (wrong.length) {
  console.error(`\nCAPABILITY-CITATIONS: FAIL — ${wrong.length} citation(s) disagree with the manifest:`)
  for (const w of wrong) {
    console.error(`  ✗ ${w.bundle} cited as CAPABILITY ${w.claimed} (${w.where}) ` +
                  `but the manifest types it capability ${w.actual}`)
  }
  console.error(
    '\n  The manifest is what the BUILD computed from the folder\'s real shape — an *.instances.json\n' +
    '  makes a bundle parameterized (cap-2) however simple it looks, and a meta.json `type` declares\n' +
    '  tiers 3/4/5. Prose can drift from that; the manifest cannot. Update the DOC.\n' +
    '  (This exact error was fixed once in verify-5-capabilities.mjs and never reached the README.)'
  )
  process.exit(1)
}
console.log('CAPABILITY-CITATIONS: PASS — every cited capability matches the manifest.')
