#!/usr/bin/env node
/**
 * check-shot-freshness.mjs — catch a README screenshot that no longer shows the shipped UI.
 *
 * THE BUG THIS EXISTS TO PREVENT (real, 2026-09-21)
 * The 12 PNGs in documentation/readme-images/ were dated Sep 20 while FIVE .vue sources were newer —
 * including two I had changed that same flight (people-groups-grid's visible-filters fix and
 * doxa-simple-map's light loading overlay). The README showed a UI THAT NO LONGER EXISTED and
 * nothing in the routine noticed, because A STALE SCREENSHOT LOOKS EXACTLY LIKE A CURRENT ONE.
 * There is no error, no 404, no failing test — just a picture quietly telling a lie to whoever
 * the project is handed to.
 *
 * WHAT IT COMPARES, AND WHY THAT IS THE RIGHT PAIR
 * Each shot captures a BUILT LEAF, so the honest comparison is the BUNDLE it renders versus the
 * PNG. Comparing raw .vue sources instead would be both noisy (an unrelated plugin's edit would
 * fail every shot) and WRONG — a source edit that has not been built is not yet in any leaf, so
 * the screenshot is still accurate. Using the bundle also covers NESTED children for free: a
 * composite's bundle is rebuilt whenever a child changes (that is what check:composite enforces),
 * so cap-4/cap-5 shots go stale exactly when their children do.
 *
 * DERIVED, NOT HARDCODED
 * The shot->bundle mapping is parsed out of readme-shots.mjs itself: every `await shot('name',
 * `/${TREE_NAME}/<bundle>/...`)` names its bundle in the URL. Add a shot and this follows; a
 * hardcoded table would drift silently, which is the failure mode the whole file is about.
 * Shots whose path is not a leaf of the tree (the synthetic iframe host) are REPORTED as skipped
 * rather than dropped — an unchecked shot must be visible, not invisible.
 *
 * CONTENT FIRST, CLOCKS ONLY AS A FALLBACK. readme-shots writes shot-bundles.json: for each shot,
 * the sha256 of the bundle it was taken from. A matching hash means the picture shows exactly the
 * bundle built now; a different one means it is stale. No date is involved, so a clone, a rebase
 * or a retake that came out byte-identical cannot fool it. Shots with no record yet fall back to:
 *
 * WHICH CLOCK: GIT, NOT THE FILESYSTEM, for any file that is committed and unmodified.
 * This compared mtimes, and a clone (or a new worktree) writes files in whatever order git checks
 * them out — so every fresh checkout failed, pristine main included (11 shots "2s behind" their
 * bundles). A gate that cannot pass on a clone teaches the recipient to ignore it. A committed,
 * clean file is dated by its last commit; a file with local edits (or no git at all, e.g. a
 * tarball) falls back to its mtime, because then the working copy IS the newest version.
 *
 * NEGATIVE-TESTED: appending a byte to public/<tree>/doxa-simple-map/doxa-simple-map.js makes
 * this FAIL naming exactly the three cap2-* shots (their recorded hash no longer matches);
 * reverting it returns it to PASS. A bare `touch` does not fail it: it changes no content.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME, TREE_NAME_RE } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS_SRC = join(ROOT, 'internal', 'readme-shots.mjs')
const OUT = join(ROOT, 'documentation', 'readme-images')
const BUILT = join(ROOT, 'public', TREE_NAME)

if (!existsSync(SHOTS_SRC) || !existsSync(OUT)) {
  console.log('SHOT-FRESHNESS: SKIP — readme-shots.mjs or documentation/readme-images/ not present.')
  process.exit(0)
}

const SHOT_BUNDLES = join(OUT, 'shot-bundles.json')
const recorded = existsSync(SHOT_BUNDLES) ? JSON.parse(readFileSync(SHOT_BUNDLES, 'utf8')) : {}

// Dirty = modified or untracked under the two trees compared. null = git unavailable -> mtimes only.
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
let dirty = null
try {
  dirty = new Set(git('status', '--porcelain', '--', `public/${TREE_NAME}`, 'documentation/readme-images')
    .split('\n').filter(Boolean).map((l) => resolve(ROOT, l.slice(3).replace(/^"|"$/g, ''))))
} catch { /* not a git checkout */ }
function stamp(file) {
  if (dirty && !dirty.has(file)) {
    try {
      const ct = git('log', '-1', '--format=%ct', '--', file).trim()
      if (ct) return { ms: Number(ct) * 1000, by: 'commit' }
    } catch { /* fall through */ }
  }
  return { ms: statSync(file).mtimeMs, by: 'mtime' }
}

// Parse `await shot('name', '/path/...')` — the generator is the source of truth for its own map.
const src = readFileSync(SHOTS_SRC, 'utf8')
// Paths are written either as '...' or as `/${TREE_NAME}/...` (the tree name comes from the build
// config); accept both and resolve the placeholder, or a template-literal shot would be silently skipped.
const shots = [...src.matchAll(/shot\(\s*'([^']+)'\s*,\s*(['`])([^'`]*)\2/g)]
  .map(m => ({ name: m[1], path: m[3].replace(/\$\{TREE_NAME\}/g, TREE_NAME) }))
// FLOOR: every `await shot(` call must be parsed, or the gate would silently check fewer shots than
// exist (it did: after the TREE_NAME codemod it compared 2 of 26 and passed). Mismatch = NOT MEASURED.
{
  const calls = src.split('\n').filter((l, i, a) => /await shot\(/.test(l) && !/shot-floor: dynamic/.test(a[i - 1] || '')).length
  if (shots.length !== calls) {
    console.error(`SHOT-FRESHNESS: NOT MEASURED — parsed ${shots.length} of ${calls} shot( calls in readme-shots.mjs; the matcher is out of date with the file.`)
    process.exit(75)
  }
}

const stale = [], missing = [], skipped = []
let checked = 0

for (const { name, path } of shots) {
  const png = join(OUT, name + '.png')
  if (!existsSync(png)) { missing.push(name); continue }

  const m = path.match(new RegExp(`^/${TREE_NAME_RE}/([^/]+)/`))
  if (!m) { skipped.push(`${name} (path ${path} is not a /${TREE_NAME}/ leaf)`); continue }

  const bundle = join(BUILT, m[1], `${m[1]}.js`)
  if (!existsSync(bundle)) { skipped.push(`${name} (bundle ${m[1]} not built)`); continue }

  checked++
  // FIRST CHOICE: content, not clocks. readme-shots records the sha256 of the bundle each picture
  // was taken from. Same hash = the picture shows exactly this bundle, however old either file's
  // date. A different hash = the bundle changed since, so the picture is stale. This also covers
  // a retake that came out byte-identical, which no clock can see: git dates an unchanged PNG by
  // its old commit, and the gate called a correct, just-taken picture stale.
  const rec = recorded[name]
  if (rec && rec.bundle === m[1]) {
    const now = createHash('sha256').update(readFileSync(bundle)).digest('hex')
    if (now !== rec.sha256) stale.push(`${name}.png was shot from a different ${m[1]} bundle than the one built now`)
    continue
  }
  // FALLBACK, for a shot with no record yet: clocks.
  const b = stamp(bundle), p = stamp(png)
  if (b.ms > p.ms) {
    stale.push(`${name}.png is OLDER than the bundle it shows (${m[1]}) — ` +
               `${Math.round((b.ms - p.ms) / 1000)}s behind (bundle by ${b.by}, png by ${p.by})`)
  }
}

console.log(`SHOT-FRESHNESS: ${shots.length} shot(s) declared, ${checked} compared against their bundle.`)
for (const s of skipped) console.log(`  i SKIPPED ${s}`)

if (missing.length || stale.length) {
  if (missing.length) {
    console.error(`\nSHOT-FRESHNESS: FAIL — ${missing.length} declared shot(s) have NO png:`)
    for (const m of missing) console.error(`  ✗ ${m}.png`)
  }
  if (stale.length) {
    console.error(`\nSHOT-FRESHNESS: FAIL — ${stale.length} screenshot(s) predate the UI they show:`)
    for (const s of stale) console.error(`  ✗ ${s}`)
  }
  console.error('\n  Fix: `node internal/readme-shots.mjs` (it fetches its own token server-side).')
  console.error('  A stale screenshot looks exactly like a current one — that is why this is a gate.')
  process.exit(1)
}
console.log('SHOT-FRESHNESS: PASS — every screenshot shows the bundle that is built now.')
