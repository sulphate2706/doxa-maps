#!/usr/bin/env node
/**
 * settled-tree-gate.mjs — is the build output SAFE TO MEASURE OR PUBLISH right now?
 *
 * ★ WHY THIS IS A SCRIPT AND NOT A SHELL ONE-LINER (a silent gate failure, 2026-09-20)
 *   The documented gate was three shell checks. One of them was SILENTLY BROKEN for an entire
 *   session, and its failure mode was to always PASS:
 *
 *       find public/doxa-maps -newermt '-45 seconds' -type f | wc -l     # always printed 0
 *
 *   `find` on this box is **bfs 4.1.1**, a drop-in replacement that is STRICTER than GNU
 *   findutils: it REJECTS relative timestamps and demands ISO 8601. The error went to stderr,
 *   `wc -l` counted the empty stdout, and the gate reported "churn = 0" every single time —
 *   including when **460 files had changed in the last 45 seconds**.
 *
 *   A gate that cannot fail is worse than no gate: it grants false confidence at exactly the
 *   moment you need real information. This one very likely contributed to publishing an
 *   internally-inconsistent tree (see AP-single-bundle-vite-build-leaves-the-tree-internally-
 *   inconsistent) — the tree was believed quiet on the strength of a check that always passed.
 *
 *   Node's fs.statSync gives mtimes directly, with no shell quoting, no `find` dialect, and no
 *   silent-stderr failure mode. Hence a script.
 *
 * ★ THE OTHER TWO SIGNALS, and why all three are needed
 *   - PROCESS: count the ONE real builder (`bun run build:unlocked`) plus queued waiters.
 *     Never `pgrep -f 'bun run build'` — that matches the command TEXT, so wrapper shells and
 *     even the inspecting `ps` itself count. The same loose pattern reported 10/8/4/3 builders
 *     from identical machine state, and once cost six minutes waiting for phantom builds.
 *   - CHURN: no output file written recently (this file's job).
 *   - SHAPE: at least MIN_DIRS bundle directories. `clean` rm -rf's the output at the START of
 *     every build, so a concurrent build makes the tree transiently near-empty; dirs is the
 *     cheapest way to notice you are looking at a half-built tree.
 *   The lock SERIALIZES builds but does NOT DEDUPE them, so N queued agents = N full rebuilds:
 *   wait for the QUEUE to drain, not for "a build" to finish.
 *
 * USAGE
 *   node internal/settled-tree-gate.mjs                 # exits 0 if settled, 1 if not
 *   QUIET_SECONDS=90 MIN_DIRS=17 node internal/settled-tree-gate.mjs
 */
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { TREE_NAME } from './_tree-name.mjs'

const TREE = process.env.TREE || `public/${TREE_NAME}`
const QUIET_SECONDS = Number(process.env.QUIET_SECONDS || 45)
// ★ RAISED 2026-09-23 from 17 to 21, on this gate's OWN advice. It had been printing a NOTE on
// every green run — "the tree has outgrown its floors ... they still catch a CATASTROPHICALLY gutted
// tree but no longer a partial one" — and it was right: the tree now emits 25 directories, so a
// floor of 17 would pass a tree missing EIGHT of them. A wipe detector that only fires on a total
// wipe has quietly become a gate that cannot fail for the case it matters most in, because a
// PARTIAL tree is the one that produces a confident false measurement rather than an obvious one.
//
// 21 = the manifest's current bundle count, which is the number that grows when a plugin is added,
// and it leaves 4 directories of headroom against the 25 on disk (assets/ and the per-bundle dirs
// that are not manifest bundles). NOT derived from the live tree on purpose: a floor computed from
// what is there can never notice that something is missing.
const MIN_DIRS = Number(process.env.MIN_DIRS || 21)
// ★ RECALIBRATED 2026-09-22 from 50 to 40 — the ARCHITECTURE changed, not the health of the tree.
// The old floor was set when generate-tree.mjs also emitted a <bundle>/index.html CHOOSER page for
// every bundle. Those 19 pages were removed deliberately (they returned HTTP 200, mounted NOTHING,
// were referenced by the manifest ZERO times, and their stylesheet was literally named
// "staging-forge" — they are the duplicate staging surface that was to be archived). Removing
// them legitimately drops the recursive index.html count from 63 to 44.
//
// ★ WHY THIS EDIT MATTERS MORE THAN THE NUMBER: left at 50, a CORRECT tree fails this gate forever,
// and the cheapest way to make it green again is to restore the choosers — i.e. the stale floor
// would quietly pressure the next agent into undoing the change it was blocking. A floor that
// encodes a removed artifact does not protect the tree; it defends the old architecture.
//
// 40 keeps the original PURPOSE intact. The floor exists because a per-bundle `BUNDLE=x vite build`
// silently deletes every OTHER bundle's leaf (see the note at signal 4) — a partial-wipe leaves far
// fewer than 40. The expected healthy count is now 44: 1 root + 28 profile leaves + 15 instance
// leaves. Anything materially below that is the wipe this gate was built to catch.
//
// THE LOAD-BEARING CHECK IS NO LONGER THIS COUNT. What actually must not break is that every
// embed.iframe target in manifest.json still resolves — that is deployment method 1, one of only two
// of the five that are proven. Verified 2026-09-22: 43 iframe targets checked, 0 missing. Prefer
// check:embed-targets for that assertion; this floor is only a coarse wipe detector.
// ★ RAISED 2026-09-23 from 40 to 44, same reasoning as MIN_DIRS above: the tree emits 46 leaves, so
// a floor of 40 tolerated losing six of them silently. 44 keeps two leaves of headroom for a
// mid-build transient without tolerating a partial wipe. Still coarse by design — check:embed-targets
// remains the load-bearing assertion that every embed.iframe target actually resolves.
const MIN_LEAVES = Number(process.env.MIN_LEAVES || 44)

if (!existsSync(TREE)) {
  console.error('SETTLED-TREE: FAIL — tree does not exist: ' + TREE + ' (a build may be mid-clean)')
  process.exit(1)
}

// ── signal 1: processes ──────────────────────────────────────────────────────
// -x -f = match the EXACT full command line, so wrapper shells do not count.
function countExact(cmd) {
  try {
    const out = execSync('pgrep -x -f ' + JSON.stringify(cmd) + ' || true', { encoding: 'utf8' })
    return out.split('\n').filter(Boolean).length
  } catch { return 0 }
}
const builders = countExact('bun run build:unlocked')
const waiters = countExact('bun run build')

// ── signal 2: churn (the one that was silently broken) ───────────────────────
const cutoff = Date.now() - QUIET_SECONDS * 1000
let churn = 0
let newest = 0
;(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else {
      const m = statSync(p).mtimeMs
      if (m > newest) newest = m
      if (m > cutoff) churn++
    }
  }
})(TREE)

// ── signal 3: shape ──────────────────────────────────────────────────────────
const dirs = readdirSync(TREE, { withFileTypes: true }).filter((e) => e.isDirectory()).length

// ── signal 4: LEAF COUNT ─────────────────────────────────────────────────────
// ★ ADDED because a per-bundle `BUNDLE=x bun x vite build` does something worse than leave a stale
// SRI hash: it EMPTIES public/doxa-maps/ of every OTHER bundle's leaf index.html. An agent ran it
// five times as a compile check and silently deleted 62 leaf pages across 18 bundles — including
// the root index.html and manifest.json — in bundles it had never touched.
// Nothing caught it. check:sri only compares a leaf's baked hash to its bundle, so a leaf that no
// longer EXISTS is simply not checked — the gate passes because there is nothing left to disagree.
// dirs alone does not catch it either: the directories survive, only their index.html vanishes.
// (Full builds regenerate the leaves via `bun run tree`, which is why the damage kept healing
// itself and stayed invisible.)
const countLeaves = (dir) => {
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countLeaves(join(dir, e.name))
    else if (e.name === 'index.html') n++
  }
  return n
}
const leaves = countLeaves(TREE)

const quietFor = newest ? Math.round((Date.now() - newest) / 1000) : Infinity
const ok = builders === 0 && waiters === 0 && churn === 0 && dirs >= MIN_DIRS && leaves >= MIN_LEAVES

console.log(
  'SETTLED-TREE: builders=' + builders + ' waiters=' + waiters +
  ' churn(' + QUIET_SECONDS + 's)=' + churn +
  ' dirs=' + dirs + '/' + MIN_DIRS + ' leaves=' + leaves + '/' + MIN_LEAVES +
  ' quietFor=' + (quietFor === Infinity ? 'n/a' : quietFor + 's')
)

// ★ DRIFT WARNING — a floor that is never revisited decays silently while the tree grows.
// This gate deliberately keeps LOOSE floors rather than deriving strict ones from manifest.json
// the way check:drop does, because it runs DURING builds where a transiently empty tree is the
// expected input; a strict floor here would fail on every clean phase. Different regime, different
// tolerance — do NOT "fix" this to match check:drop.
// But loose must not mean STALE. If the settled tree has outgrown a floor by a wide margin, the
// floor has stopped constraining anything, so say so out loud instead of quietly passing.
// (MIN_LEAVES=50 / MIN_DIRS=17 were set when the tree had ~58 leaves / 19 dirs — commit edb935f.)
const DRIFT = Number(process.env.DRIFT_WARN || 1.35)
if (ok) {
  if (leaves >= MIN_LEAVES * DRIFT || dirs >= MIN_DIRS * DRIFT) {
    console.log(
      'SETTLED-TREE: NOTE — the tree has outgrown its floors (leaves ' + leaves + ' vs floor ' +
      MIN_LEAVES + ', dirs ' + dirs + ' vs floor ' + MIN_DIRS + '). They still catch a CATASTROPHICALLY ' +
      'gutted tree but no longer a partial one. Raise MIN_LEAVES/MIN_DIRS toward the current shape — ' +
      'keeping headroom for mid-build transients, which is why they are not derived.'
    )
  }
  console.log('SETTLED-TREE: PASS — safe to measure or publish.')
  process.exit(0)
}
console.error('SETTLED-TREE: FAIL — do NOT measure or publish this tree.')
if (builders) console.error('  a build is HOLDING the lock — wait for it')
if (waiters) console.error('  ' + waiters + ' build(s) QUEUED — each will re-run clean and rebuild everything; wait for the QUEUE to drain, not just the current build')
if (churn) console.error('  ' + churn + ' file(s) written in the last ' + QUIET_SECONDS + 's — something is still writing')
if (dirs < MIN_DIRS) console.error('  only ' + dirs + ' bundle dirs (expected >=' + MIN_DIRS + ') — likely mid-clean or a half-built tree')
if (leaves < MIN_LEAVES) console.error('  only ' + leaves + ' leaf index.html (expected >=' + MIN_LEAVES + ') — a per-bundle `BUNDLE=x vite build` empties OTHER bundles\' leaves; run a FULL build to regenerate them')
process.exit(1)
