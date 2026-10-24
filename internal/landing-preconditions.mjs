#!/usr/bin/env node
/**
 * landing-preconditions — what must be true of a commit BEFORE it reaches main. Run by `main-capture scan`
 * (via .main-capture/prepush) inside the lock, on the exact commit about to be pushed; any failure REFUSES
 * the landing. A check beside the push can be skipped; a precondition of the push cannot.
 *
 * WHY (2026-09-25): check:composite-freshness found SEVEN composites stale on main — their committed
 * bundles were not what their source builds. Cause: a fleet rebuild (d49b6c80) ran in a worktree that had
 * not merged the dx-maps rename, so it wrote the OLD folder (public/doxa-maps/) and left public/dx-maps/
 * stale; later landings resolved artifact conflicts by taking one side and rebuilding only a subset.
 * Every one of those landings passed its own checks. Nothing refused them.
 *
 * PRECONDITIONS, in order (cheap first):
 *   0. NO MERGE MARKERS  no file in the COMMIT (public/ included) holds a conflict marker. d6bf410a put them
 *              into 10 built files under public/ and every other precondition passed; a built bundle with
 *              markers throws on load while its SRI still matches. --markers-self-test proves the scan refuses.
 *   1. CLEAN   the working tree equals HEAD for everything the checks read — otherwise they would judge
 *              files that are not in the commit.
 *   2. ONE FOLDER  public/ holds exactly the configured tree (vite.doxa-maps-build-config.json "name") and
 *              README.md. A build made under a different tree name writes a different folder: refused.
 *   2b. TREE   regenerating the tree (generate-tree) changes 0 files: a meta.json change must reach the
 *              leaf pages, not only the source.
 *   3. SRI     every leaf's baked integrity matches the bundle it loads (check:sri).
 *   3c. SIZE   every shipped bundle is under the 1,500,000-byte ceiling (verify-bundles-shipped).
 *   3b. MOUNTS  every capability-4/5 composite mounts headless in en and ar (check:composites-mount).
 *   4. FRESH   every composite rebuilds to exactly its committed bytes (check:composite-freshness).
 *
 * USAGE  node internal/landing-preconditions.mjs          exit 0 = may land · 1 = refused
 *        node internal/landing-preconditions.mjs --markers-self-test   proves step 0 refuses a conflict
 *        DOXA_SKIP_FRESHNESS=1 skips (4) — for a DRY check only; main-capture scan never sets it.
 */
// ★ STEP 0 PRINTS BEFORE ANYTHING CAN WAIT (2026-09-29). A scan once sat 10+ minutes in state S before
// printing step 1, with no build running under it, and the log could not say where. So the first line
// is written before any child is started, every child has a deadline, and each step prints its time.
// ESM hoists imports, so this is the earliest this module can speak; the imports below read no disk.
process.stdout.write(`LANDING-PRECONDITIONS: start — pid ${process.pid}, node ${process.version}\n`)
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { bundleGraph, areasForBundle } from './i18n-areas.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const refuse = (why, detail = '') => {
  console.error(`LANDING-PRECONDITIONS: REFUSED — ${why}`)
  if (detail) console.error(detail.split('\n').map((l) => '  ' + l).join('\n'))
  process.exit(1)
}
// Every child gets a deadline and an EMPTY stdin: a child that waits on its input (or on a lock) fails
// loudly, by name, instead of holding the landing lock with nothing in the log. 20 minutes covers the
// freshness rebuild, the one step that legitimately takes that long; git steps get 3.
const T0 = Date.now()
const since = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`
function run(cmd, args, timeoutMs = 20 * 60 * 1000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: process.env, input: '', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 })
  if (r.error && r.error.code === 'ETIMEDOUT') {
    refuse(`${cmd} ${args.slice(0, 3).join(' ')} did not finish in ${Math.round(timeoutMs / 1000)}s`,
      `It was killed at ${since()}. If this repeats, run main-capture diag on the child before it is killed.`)
  }
  return r
}
const git = (args) => run('git', args, 3 * 60 * 1000)

// 0. NO MERGE MARKERS — scanned in the COMMIT's tree (git grep), so public/ and every file is covered,
// whatever the working tree holds. Markers are built from char codes so this file never contains one.
const OPEN = String.fromCharCode(60).repeat(7), MID = String.fromCharCode(61).repeat(7), CLOSE = String.fromCharCode(62).repeat(7)
function markerFiles(ref) {
  const g = git(['grep', '-I', '-l', '-E', '-e', `^(${OPEN}( |$)|${MID}$|${CLOSE}( |$))`, ref, '--'])
  if (g.status > 1) refuse('could not scan the commit for merge markers', g.stderr.trim())
  return g.stdout.split('\n').filter(Boolean).map((l) => l.replace(new RegExp('^' + ref + ':'), ''))
}
if (process.argv.includes('--markers-self-test')) {
  // A throwaway commit object (no branch, no working-tree change) holding one built file with a textbook
  // conflict; the scan must name it.
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: ROOT, encoding: 'utf8', input: `a\n${OPEN} HEAD\nmine\n${MID}\ntheirs\n${CLOSE} other\n` }).stdout.trim()
  const tree = spawnSync('git', ['mktree'], { cwd: ROOT, encoding: 'utf8', input: `100644 blob ${blob}\tpoison.js\n` }).stdout.trim()
  const pub = spawnSync('git', ['mktree'], { cwd: ROOT, encoding: 'utf8', input: `040000 tree ${tree}\tpublic\n` }).stdout.trim()
  const commit = spawnSync('git', ['commit-tree', pub, '-m', 'marker self-test'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  const hits = markerFiles(commit)
  if (hits.includes('public/poison.js')) { console.log('LANDING-PRECONDITIONS: markers self-test PASS — a conflict in a public/ file is refused.'); process.exit(0) }
  console.error('LANDING-PRECONDITIONS: markers self-test FAIL — a textbook conflict under public/ was not found.'); process.exit(1)
}
const markers = markerFiles('HEAD')
if (markers.length) refuse(`${markers.length} file(s) in this commit hold merge-conflict markers`,
  markers.slice(0, 10).join('\n') + '\nFor a BUILT file: take either side, REBUILD it, commit the rebuild. Never `git add -A public` mid-merge.')
console.log(`LANDING-PRECONDITIONS: 0 markers — no file in the commit holds a merge-conflict marker (${since()})`)

// 1. CLEAN
const dirty = git(['status', '--porcelain', '--', 'public', 'plugin-designs', 'library', 'internal', 'vite.config.js', 'vite.doxa-maps-build-config.json', 'package.json'])
if (dirty.status !== 0) refuse('could not read git status')
if (dirty.stdout.trim()) refuse('the working tree differs from the commit being landed — the checks would judge files that are not in it', dirty.stdout.trim().split('\n').slice(0, 8).join('\n'))
console.log(`LANDING-PRECONDITIONS: 1 clean — the working tree is the commit being landed (${since()})`)

// 2. ONE FOLDER, and it is the configured one
// What LANDS is the commit, so read public/ from HEAD, not from the disk: a gitignored, untracked leftover
// (a pre-rename public/assets/ in an older worktree) refused a clean README-only landing (repo, 2026-09-25).
const tree = git(['ls-tree', '--name-only', 'HEAD', 'public/'])
if (tree.status !== 0) refuse('could not read public/ from HEAD')
const entries = tree.stdout.split('\n').filter(Boolean).map((l) => l.replace(/^public\//, '')).sort()
const want = ['README.md', TREE_NAME].sort()
if (JSON.stringify(entries) !== JSON.stringify(want)) {
  const extra = entries.filter((e) => !want.includes(e)), missing = want.filter((e) => !entries.includes(e))
  refuse(`public/ must hold exactly ${want.join(' + ')} (the tree name comes from vite.doxa-maps-build-config.json)`,
    [extra.length ? `extra: ${extra.join(', ')} — e.g. a build made under an OLD tree name writes its old folder` : '', missing.length ? `missing: ${missing.join(', ')}` : ''].filter(Boolean).join('\n'))
}
console.log(`LANDING-PRECONDITIONS: 2 one folder — public/ = README.md + ${TREE_NAME}/ (${since()})`)

// 2b. TREE — regenerating the tree changes nothing. fix:sri rehashes leaves but does not carry a
// <profile>.meta.json change (pinHint, a label, the mobile flag) into the leaf pages' BASE_CONFIG: PPLR's
// pinHint:false sat invisible in the tree until a later landing happened to regenerate it. The generator is
// deterministic (a clean tree regenerates to 0 changed files), so a stale leaf config or a stale integrity
// both show up here as a diff, in ~3 s.
const regen = run(process.execPath, ['internal/generate-tree.mjs'], 5 * 60 * 1000)
if (regen.status !== 0) refuse('the tree generator failed', (regen.stdout + regen.stderr).trim().split('\n').slice(-6).join('\n'))
const drift = git(['status', '--porcelain', '--', 'public'])
if (drift.status !== 0) refuse('could not read git status after regenerating the tree')
if (drift.stdout.trim()) refuse('regenerating the tree changes the commit: a meta.json or config change reached the source without reaching public/',
  drift.stdout.trim().split('\n').slice(0, 10).join('\n') + '\nRun `bun run tree` (and `bun run fix:sri` if a bundle changed), commit public/, and land again.')
console.log(`LANDING-PRECONDITIONS: 2b tree — regenerating it changes 0 files (${since()})`)

// 3. SRI
const sri = run(process.execPath, ['internal/sri-consistency-check.mjs'])
if (sri.status !== 0) refuse('check:sri failed', (sri.stdout + sri.stderr).trim().split('\n').slice(-6).join('\n'))
console.log(`LANDING-PRECONDITIONS: 3 sri — every leaf loads the bundle its integrity names (${since()})`)

// 3c. SIZE — every shipped bundle is under the ceiling (verify-bundles-shipped). It lived only inside
// `verify`, in gates:post, so a landing that grew a bundle past 1,500,000 bytes landed and THEN went red
// (694b00991, country-posters at 1,662,962). Here it runs on the rebuilt tree, before the push. ~0.2 s.
const size = run(process.execPath, ['library/scripts/research/verify-bundles-shipped.mjs'])
if (size.status !== 0) refuse('a shipped bundle is over the size ceiling or missing (verify-bundles-shipped)', (size.stdout + size.stderr).trim().split('\n').filter((l) => /✗|FAIL|FATAL/.test(l)).slice(0, 8).join('\n'))
console.log(`LANDING-PRECONDITIONS: 3c size — every shipped bundle is under the ceiling (${since()})`)

// 3b. MOUNTS — every capability-4/5 composite mounts headless in en and ar without a setup/watcher/mount
// error (check:composites-mount, ~20 s). 08f89f55 left Big Picture and Simple Research BLANK while every
// other check passed; a landing that blanks a composite is now refused.
const mounts = run(process.execPath, ['internal/check-composites-mount.mjs'])
if (mounts.status !== 0) refuse('a composite no longer mounts (check:composites-mount)', (mounts.stdout + mounts.stderr).trim().split('\n').filter((l) => /FAIL|✗|Error/.test(l)).slice(0, 8).join('\n'))
console.log(`LANDING-PRECONDITIONS: 3b mounts — every composite mounts in en and ar (${since()})`)

// 4. FRESH
if (process.env.DOXA_SKIP_FRESHNESS === '1') {
  console.log('LANDING-PRECONDITIONS: 4 fresh — SKIPPED (DOXA_SKIP_FRESHNESS=1; dry check only, never set by main-capture scan)')
} else {
  // SCOPE: what can this landing have made stale? A change to shared code (library/, the build config, the
  // dependencies) reaches ANY bundle — measured 2026-09-25: one Arabic catalogue edit in library/i18n left 12
  // of 25 bundles stale, most of them not composites, and a composite-only check saw none of it. Otherwise:
  // every composite, plus each bundle whose own folder the landing touched.
  const base = git(['merge-base', 'HEAD', `origin/${process.env.MAIN_CAPTURE_BRANCH || process.env.LANDING_BRANCH || 'development'}`]).stdout.trim()
  const changed = base ? git(['diff', '--name-only', base, 'HEAD']).stdout.split('\n').filter(Boolean) : []
  // ★ A library/ change no longer means EVERY bundle. It means every bundle whose SOURCE GRAPH contains a
  // changed file, or that reads a changed i18n area: measured, a one-file library fix reached 1 of 24
  // bundles, and rebuilding all 24 cost ~10 min per landing round. Only the build itself (config,
  // dependencies, the tree generator) can reach every bundle, so only that still means --all.
  const pkgDepsChanged = () => {
    if (!changed.includes('package.json') || !base) return false
    const deps = (ref) => { try { const j = JSON.parse(git(['show', `${ref}:package.json`]).stdout); return JSON.stringify([j.dependencies, j.devDependencies]) } catch { return '' } }
    return deps(base) !== deps('HEAD')
  }
  // The build config reaches every bundle only through a key the BUILD reads. dropin (where sync-dropin copies
  // to) and the "//" comment keys build nothing: a dropin.dest fix verified every bundle, ~10 min, for nothing.
  const buildCfgChanged = () => {
    const CFG = 'vite.doxa-maps-build-config.json'
    if (!changed.includes(CFG) || !base) return false
    const keys = (ref) => {
      try {
        const j = JSON.parse(git(['show', `${ref}:${CFG}`]).stdout)
        for (const k of Object.keys(j)) if (k === 'dropin' || k.startsWith('//')) delete j[k]
        return JSON.stringify(j)
      } catch { return null }
    }
    const a = keys(base), b = keys('HEAD')
    return a === null || b === null || a !== b
  }
  const everything = !base || pkgDepsChanged() || buildCfgChanged() || changed.some((f) => /^(vite\.config\.js$|bun\.lockb?$)/.test(f))
  const libChanged = changed.filter((f) => f.startsWith('library/'))
  const shared = everything || libChanged.length > 0
  const own = new Set(changed.map((f) => (f.match(/^plugin-designs\/([^/]+)\//) || [])[1]).filter(Boolean))
  if (!everything && libChanged.length) {
    const libSet = new Set(libChanged)
    const areas = new Set(libChanged.map((f) => (f.match(/^library\/i18n\/locales\/[^/]+\/([^/]+)\.json$/) || [])[1]).filter(Boolean))
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public', TREE_NAME, 'manifest.json'), 'utf8'))
    // ★ EVERY SHIPPED BUNDLE, NOT ONLY THE MANIFEST'S. A bundle the tree ships but does not list (template-bundle)
    // was never in scope, so a library change it imports left it stale with no landing to rebuild it; a final
    // all-bundle freshness run found it weeks of library changes behind. Shipped = a plugin with an index.js
    // whose built <bundle>/<bundle>.js is in the tree.
    const shipped = readdirSync(resolve(ROOT, 'plugin-designs')).filter((d) => existsSync(resolve(ROOT, 'plugin-designs', d, 'index.js'))
      && existsSync(resolve(ROOT, 'public', TREE_NAME, d, d + '.js')))
    const candidates = [...new Set([...manifest.bundles.map((b) => b.bundle), ...shipped])]
    for (const bundle of candidates) {
      if (!existsSync(resolve(ROOT, 'plugin-designs', bundle, 'index.js'))) continue
      const graph = bundleGraph(ROOT, bundle).map((f) => f.slice(ROOT.length + 1))
      if (graph.some((f) => libSet.has(f)) || (areas.size && areasForBundle(ROOT, bundle).areas.some((a) => areas.has(a)))) own.add(bundle)
    }
  }
  const scope = everything ? ['--all'] : (own.size ? ['--bundles', [...own].sort().join(',')] : [])
  console.log(`LANDING-PRECONDITIONS: 4 fresh — scope: ${everything ? 'EVERY bundle (the build itself changed' + (base ? '' : '; no merge-base') + ')' : (shared ? 'the bundles this library change reaches' : 'composites') + (own.size ? ': ' + [...own].sort().join(', ') : '')}`)
  // ★ ONE PASS PER TREE, NOT ONE PER SCAN. This check rebuilds every bundle in its scope (~10 min for
  // --all), and it used to run INSIDE the merge-queue lock, so a build-owner landing held main for 30+ min
  // while every other landing queued (2026-09-25). The verdict is a function of the committed tree and the
  // scope, so a PASS is recorded against both; the landing script runs this precondition BEFORE taking the
  // lock, and the scan inside the lock finds the record and does not rebuild again. A different tree or a
  // wider scope has no record and is checked in full. The record lives in the repo's own git dir.
  const treeId = git(['rev-parse', 'HEAD^{tree}']).stdout.trim()
  const stampDir = resolve(ROOT, git(['rev-parse', '--git-common-dir']).stdout.trim(), 'doxa-fresh')
  // The scope can be a long bundle list now, and a filename has a length limit: hash it.
  const scopeKey = scope.length ? createHash('sha1').update(scope.join(' ')).digest('hex').slice(0, 16) : 'composites'
  const stamp = resolve(stampDir, `${treeId}.${scopeKey}`)
  if (treeId && existsSync(stamp)) {
    console.log(`LANDING-PRECONDITIONS: 4 fresh — this exact tree (${treeId.slice(0, 10)}) already passed at this scope, ${readFileSync(stamp, 'utf8').trim()}`)
    console.log('LANDING-PRECONDITIONS: PASS — this commit may land.')
    process.exit(0)
  }
  const fresh = run(process.execPath, ['internal/check-composite-freshness.mjs', ...scope])
  if (fresh.status !== 0) refuse(
    'a committed composite is not what its source builds (stale consumers).\n' +
    'README rule 5: ONE agent owns the full build. If your change touches library/ or anything compiled into\n' +
    'other plugins, do not rebuild everyone yourself: commit it on your branch and hand the landing to the\n' +
    'build owner ("please land <branch>@<sha>: library change, consumers need rebuilding"). If only YOUR\n' +
    'own plugin is stale, rebuild just it: BUNDLE=<name> bun x vite build && bun run tree && bun run fix:sri.',
    (fresh.stdout + fresh.stderr).trim().split('\n').filter((l) => /✗|STALE|FAIL/.test(l)).slice(0, 8).join('\n'))
  console.log('LANDING-PRECONDITIONS: 4 fresh — every composite rebuilds to its committed bytes')
  if (treeId) { mkdirSync(stampDir, { recursive: true }); writeFileSync(stamp, `${new Date().toISOString()} (commit ${git(['rev-parse', '--short', 'HEAD']).stdout.trim()})\n`) }
}
console.log('LANDING-PRECONDITIONS: PASS — this commit may land.')
