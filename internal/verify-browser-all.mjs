#!/usr/bin/env node
/**
 * verify-browser-all.mjs — run every BROWSER gate over the built tree, in one command.
 *
 * WHY THIS EXISTS. library/scripts/research/verify-all.mjs already solved this for the DATA guards,
 * and its header states the principle better than I can paraphrase it: "Scattered, they are worth
 * much less than they look: nobody knows the list, so nobody runs them, and a guard nobody runs is
 * documentation." That file has ZERO references to playwright or public/doxa-maps — it is the data
 * half. The BROWSER half had no equivalent.
 *
 * ★ MEASURED 2026-09-22: all seven browser gates were ORPHANS — each had a package.json script, and
 * NOT ONE was invoked by any other script. They were reachable only by someone who already knew the
 * name to type, which is precisely the person who does not need the list. This repo has already
 * been bitten by exactly this: the Gate-1 acceptance test existed, worked, and was invoked by
 * nothing, so it "could never report anything" (IDEA-SIX-INTERNAL-SCRIPTS-ARE-UNREACHABLE). An
 * orphan gate is worse than a missing one, because it LOOKS like coverage on the board.
 *
 * ★ EVERY GATE LISTED HERE WAS RUN BEFORE IT WAS LISTED. That rule is inherited deliberately from
 * the same card: "do not mass-wire ... Adding scripts for programs I have not executed would put
 * unvalidated entries in the hand-off surface." Results on 2026-09-22, against the built tree:
 *   check:nav-reachable      PASS  2 cap-5 shells reach their rail at 414px
 *   check:a11y-button-names  PASS  332/332 buttons have an accessible name across 19 leaves
 *   verify:gate1             PASS  13/13 acceptance assertions against 2107 LIVE records
 *   verify:5-caps            PASS  all 5 capability levels mount, render, error-free
 *   smoke:embeds             PASS  43/43 leaf pages mount cleanly
 *   verify:map-paint         PASS  11/11 map leaves paint a real canvas under SwiftShader
 *
 * ★ I EXCLUDED smoke:share HERE AND THAT WAS WRONG — corrected 2026-09-22, two ticks later.
 * The original note read: "it takes required arguments (--url / --plugin-gallery) and its gallery
 * mode reads /__plugin-gallery/registry.json, which only the VITE DEV SERVER serves". Every clause
 * is true and the CONCLUSION did not follow. I had tested exactly two invocations — bare (exit 2,
 * usage) and --plugin-gallery (needs vite) — and never tried --url, which the script's own header
 * documents FIRST. It runs perfectly against the static tree: measured 8/8 pass, each Share button
 * reopening the correct custom element with a live canvas.
 *
 * That is the same shape as AP-a-plausible-disposition-recorded-without-checking-it, found in my
 * own work: a not-applicable verdict is more durable than a wrong bug report, because it closes the
 * question. It cost this suite its highest-consequence surface for two ticks — a share URL is the
 * one artefact a partner pastes into an email, and it fails SILENTLY.
 *
 * It now runs as `smoke:share-all`, a script carrying its own 8 --url flags plus --browser chromium
 * (Firefox headless has no WebGL on this box, so the default engine stops — see
 * BUG-SHARE-SMOKE-FIREFOX-DEFAULT-FALSE-FAILURES). The 8 leaves are the set derived by grepping
 * plugin-designs for ShareButton, not a guess.
 *
 * Still not covered here: `--plugin-gallery` mode, which genuinely does need the vite dev server.
 *
 * PRECONDITIONS (asserted, not assumed): a built tree, and a static server on the BASE port. Both
 * are checked up front so a missing server reports as a SETUP problem rather than six mystery
 * failures.
 *
 * Exit 0 = every gate passed. Exit 1 = at least one failed (each named, with its output tail).
 * Exit 2 = preconditions unmet (no tree / no server) — distinguishable from a real failure.
 */
import { spawnSync } from 'node:child_process'
import { servesThisTree } from './_serves-this-tree.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'

// Each entry was executed on 2026-09-22 with the result recorded above. `why` is what the gate
// actually protects, so a failure here tells a reader what broke without opening the file.
const GATES = [
  { script: 'verify:5-caps',            why: 'all 5 capability levels mount and render' },
  { script: 'smoke:embeds',             why: 'every shipped leaf page mounts its element' },
  { script: 'verify:map-paint',         why: 'every map leaf paints a real canvas' },
  // verify:map-paint proves SOME engine painted. This is the only gate that asserts the MAPBOX
  // engine drew: the canvas class plus rendered features, per curated production tab. Exits 75
  // rather than failing when the sandbox token's tileset entitlement blocks the measurement.
  { script: 'check:mapbox-drew',        why: 'the Mapbox engine drew on every production map tab (75 without a real token)' },
  // verify:map-paint proves a canvas painted; this proves the gospel map's PINS are on it
  // and answer a tap. It also scans every link in the index against the screened-publisher
  // list, which is a doctrine boundary rather than a rendering one.
  { script: 'verify:gospel-map',        why: 'the gospel map renders its pins, answers a tap, and links only screened publishers' },
  // verify:gospel-map counts pins, which paint with no token at all. This one is the only
  // gate that measures the BASEMAP, in a real cross-origin iframe, on the baked token.
  { script: 'check:embed-basemap',      why: "the gospel map's basemap paints in a third-party iframe on its own baked token" },
  { script: 'verify:gate1',             why: 'the Gate-1 chain filters live data end to end' },
  { script: 'check:a11y-button-names',  why: 'every visible button has an accessible name' },
  { script: 'check:nav-reachable',      why: 'a phone can open the cap-5 tab rail' },
  { script: 'smoke:share-all',          why: 'every Share button emits a URL that reopens the right element' },
  // ★ The only gate here that measures ONE component in TWO hosts. It exists because a popover can
  // be perfectly anchored standalone and 256px adrift inside the cap-5 shell, and no single-host
  // gate above can tell those apart — the defect lives in the host's ancestor chain, not the
  // component. See internal/check-fixed-anchoring.mjs.
  { script: 'check:fixed-anchoring',    why: 'the filter dropdown stays anchored in BOTH hosts, not just standalone' },
  // Same family as the gate above, and found the same week: the cap-5 shell's pane geometry breaks a
  // plugin that is perfect standalone. Here .vtl-host was inset:0 with overflow:visible, so 2586px of
  // mounted grid was unreachable and a real wheel gesture moved 0px. Asserts with a WHEEL, not with
  // scrollHeight — scrollHeight > innerHeight was the FALSE PASS that closed this bug twice.
  { script: 'check:shell-scroll',       why: 'a wheel gesture in the cap-5 shell actually reaches the grid below the dashboard' },
  // It crashed on load for four days (a missing import) and nothing noticed, because it ran only by hand.
  // In this list, the one-command suite runs it; check:no-free-identifiers now reads internal/ as well.
  { script: 'smoke:legend-info',        why: "the UPG-100 legend's info buttons speak the reader's language" },
  // The engine rule since 2026-09-28: the default ('auto') is MapLibre whether or not a token is present.
  // Case 2, a host token alone, is the one no other gate measured. First run, on 5b05f019e in the
  // browser slot: 1 no token -> maplibre, 0 Mapbox requests, 2,076 colours; 2 host token alone ->
  // maplibre, 0 Mapbox requests, 2,107 colours; 3 ?provider=mapbox + the token -> mapbox, carrying it.
  { script: 'check:auto-engine',        why: 'the default engine is MapLibre with or without a host token; provider mapbox draws Mapbox with it' },
  // The runtime half of "the engine it was asked for, or a visible failure": 2 providers x 3 load states
  // on gospel's resources map, PASS on 5b05f019e. Its --poison run cannot fail by design (the six runtime
  // cases would need the defect rebuilt into a bundle); the arm that can is check:no-silent-engine's
  // --self-test, a source gate in gates:post.
  { script: 'check:engine-contract',    why: "gospel's resources map uses the engine it was asked for, or fails visibly" },
  { script: 'check:control-inset',      why: 'the band the popup pan reserves is the band the map controls really occupy, on both engines' },
]

// ── PRECONDITION 1: a built tree ────────────────────────────────────────────
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
if (!existsSync(MANIFEST)) {
  console.error(`BROWSER-ALL: SETUP — no public/${TREE_NAME}/manifest.json. Run \`bun run build\` first.`)
  process.exit(2)
}
let bundleCount = 0
try { bundleCount = (JSON.parse(readFileSync(MANIFEST, 'utf8')).bundles || []).length } catch { /* reported below */ }
if (bundleCount < 2) {
  console.error(`BROWSER-ALL: SETUP — manifest lists ${bundleCount} bundle(s); the tree looks empty or truncated.`)
  process.exit(2)
}

// ── PRECONDITION 2: a server on BASE ────────────────────────────────────────
// Every gate here fetches over HTTP. Without this check a missing server yields six identical
// timeouts and looks like six broken gates.
try {
  const r = await fetch(`${BASE}/${TREE_NAME}/manifest.json`, { signal: AbortSignal.timeout(5000) })
  // ★ 503 IS A DIFFERENT DIAGNOSIS FROM "no server", and saying so is the whole point of the code
  // below. serve-strict.mjs returns 503 while public/doxa-maps/manifest.json is absent, because a
  // build rm -rf's that tree at its START — so a gate running then reads an EMPTY tree and reports
  // a confident wrong answer. Measured: verify-shell-scroll said "could not find the
  // dashboard-plus-grid tab" twice in ten minutes during a swarm rebuild, which reads exactly like
  // a real regression and cost three ticks. Without this branch the aggregator blamed a missing
  // server, sending the reader to start one that was already running.
  if (r.status === 503) {
    console.error('BROWSER-ALL: NOT MEASURED — the built tree is mid-build.')
    console.error(`  ${BASE} answered 503: public/${TREE_NAME}/manifest.json is absent, which is what a`)
    console.error('  build looks like from the outside (clean rm -rf\'s the tree before rebuilding it).')
    console.error('  Anything measured now is a PHANTOM. Wait for the build and re-run; do NOT record')
    console.error('  this as a product finding. Check with: bun run check:settled')
    process.exit(2)
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  // ★ ANSWERING IS NOT THE SAME QUESTION AS SERVING THIS TREE. This used to stop at "something
  // replied", and on this machine 4173 was held by an unrelated process from a DIFFERENT
  // worktree. The gospel-resources gate adopted it and spent three runs reporting on a build
  // that was not the one on disk — a PASS, then a mount timeout that read exactly like a
  // regression in untouched code. Every gate below would inherit the same lie, so the
  // aggregator refuses rather than hand six gates the wrong tree.
  const tree = await servesThisTree(BASE, ROOT)
  if (!tree.ok) {
    console.error('BROWSER-ALL: NOT MEASURED — the server is not serving this checkout.')
    console.error(`  ${tree.why}`)
    console.error('  Anything measured against it is about someone else\'s build. Point BASE_URL at')
    console.error('  your own server, or stop the foreign one and run: bun run serve')
    process.exit(2)
  }
} catch (e) {
  console.error(`BROWSER-ALL: SETUP — nothing serving ${BASE} (${String(e.message).slice(0, 40)}).`)
  console.error('  Start one first:  bun run serve       # serve-strict.mjs on 4173, --directory public')
  console.error('  Or point elsewhere: BASE_URL=http://host:port bun run verify:browser-all')
  process.exit(2)
}

// A token is optional: the map gates need one to paint, the chrome gates do not. Fetch once and
// share it, rather than letting six gates each pay for the round trip.
// ★ "TOKEN PRESENT" USED TO MEAN "A STRING WAS OBTAINED", NOT "A TOKEN THAT WORKS", and the two
// differ. The only source here was https://doxa.life/api/maps/token, which serves a token
// URL-RESTRICTED to doxa.life: measured 2026-09-23, a tile request without that Referer returns 403,
// so every basemap renders blank while the pins draw fine — the exact symptom reported: the pins
// loading, but not the underlying map. This banner still said "(token present)".
//
// Order matters: the BUILD CONFIG token is tried first because it is the one that works from a local
// gate (measured: config token 200, endpoint token 403, same request). It is a `pk.` public key baked
// deliberately (ruled 2026-09-21), protected by URL restrictions rather than secrecy;
// check:public-hygiene allows pk. and fails the build on sk./tk.. The endpoint stays as a fallback
// because a future config may legitimately carry no baked token.
//
// The token is then VALIDATED with one tile request, so the banner reports what was measured rather
// than what was fetched. A gate that computes a value and reports it without checking it is the
// defect family this repo keeps finding; the banner is no different.
let token = process.env.MAPBOX_TOKEN || ''
if (!token) {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
    if (typeof cfg.token === 'string' && cfg.token.trim()) token = cfg.token.trim()
  } catch { /* fall through to the endpoint */ }
}
if (!token) {
  try {
    const r = await fetch('https://doxa.life/api/maps/token', { signal: AbortSignal.timeout(8000) })
    if (r.ok) token = (await r.json()).token || ''
  } catch { /* the chrome gates still run; the map gates will say so themselves */ }
}
let tokenNote = 'NO TOKEN — map gates may report blank'
if (token) {
  try {
    const t = await fetch(
      `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/1/1/1.vector.pbf?access_token=${token}`,
      { signal: AbortSignal.timeout(8000) })
    tokenNote = t.ok
      ? 'token present and serves tiles'
      : `token present but tiles ${t.status} — URL-restricted? basemaps will be blank`
  } catch {
    tokenNote = 'token present, tile check unreachable (offline?)'
  }
}

console.log(`BROWSER-ALL: ${GATES.length} gate(s) over ${bundleCount} bundle(s) at ${BASE}` +
            ` (${tokenNote})\n`)

const results = []
for (const g of GATES) {
  process.stdout.write(`  … ${g.script.padEnd(24)} ${g.why}\n`)
  const t0 = Date.now()
  const r = spawnSync('bun', ['run', g.script], {
    cwd: ROOT, encoding: 'utf8', timeout: 900000,
    env: { ...process.env, MAPBOX_TOKEN: token, BASE_URL: BASE },
  })
  const secs = Math.round((Date.now() - t0) / 1000)
  const out = ((r.stdout || '') + (r.stderr || '')).trim()
  // THREE outcomes, not two (upg100 found the same bug in check:packets-all): exit 75 is NOT MEASURED —
  // no browser slot, a server mid-build — and must never count as a failure or as a pass.
  const ok = r.status === 0
  const unmeasured = r.status === 75
  results.push({ ...g, ok, unmeasured, secs, tail: out.split('\n').filter(Boolean).slice(-3).join('\n') })
  console.log(`  ${ok ? '✓' : unmeasured ? '⊘' : '✗'} ${g.script.padEnd(24)} ${ok ? 'PASS' : unmeasured ? 'NOT MEASURED' : 'FAIL'} (${secs}s)`)
}

const failed = results.filter(r => !r.ok && !r.unmeasured)
const notMeasured = results.filter(r => r.unmeasured)
console.log(`\nBROWSER-ALL: ${results.length - failed.length - notMeasured.length}/${results.length} gate(s) passed` +
  (notMeasured.length ? `, ${notMeasured.length} NOT MEASURED (${notMeasured.map(r => r.script).join(', ')}).` : '.'))
// An unmeasured gate is not a pass: with no failures but any NOT MEASURED, exit 75 (INCOMPLETE, as
// check:gospel-all does), so a runner buckets it NOT MEASURED instead of green.
if (!failed.length && notMeasured.length) process.exit(75)

if (failed.length) {
  console.error('\nFAILED:')
  for (const f of failed) {
    console.error(`  ✗ ${f.script} — ${f.why}`)
    for (const line of f.tail.split('\n')) console.error(`      ${line}`)
  }
  console.error('\n  Re-run one on its own to see its full output:  bun run <script>')
  process.exit(1)
}

console.log('BROWSER-ALL: PASS — every browser gate over the built tree is green.')
console.log('  NOT covered here: smoke:share (needs the vite dev server, not a static tree) and the')
console.log('  DATA guards (`bun run verify` / `verify:full`, which own the corpus side).')
