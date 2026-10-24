#!/usr/bin/env node
/**
 * check-no-orphan-gates.mjs — a gate that nothing can run is not a gate.
 *
 * THE DEFECT THIS CATCHES. `internal/verify-shell-scroll.mjs` was written, negative-tested, and
 * proved a real reported bug with hard numbers (2586px of mounted grid, a real wheel gesture
 * moving 0px). Then it sat unreachable: no `package.json` entry, no importer. It would never have
 * run again. The repo has already carded this once —
 * BUILD-BROWSER-GATES-WERE-ALL-ORPHANS-ONE-COMMAND-RUNS-THEM — and it recurred anyway, because
 * writing a gate and REGISTERING a gate are two separate acts and only the first feels like work.
 *
 * ★ THE DISTINCTION THIS GATE HAS TO GET RIGHT, or it becomes noise nobody reads: not every
 * unreferenced file in internal/ is a lost gate.
 *   - `vite-plugin-strip-shadow-css-comments.mjs` is imported by vite.config.js — it runs on every
 *     build. Reachable.
 *   - `long-frames-probe.mjs` is imported by two library composables. Reachable.
 *   - `mobile-sheet-probe.mjs`, `theme-flash-probe.mjs`, `readme-shots-fix.mjs` are DATED ONE-SHOT
 *     DIAGNOSTICS (Sept 17/21) written to answer one question about a bug that is now fixed. They
 *     are history, not decay — deleting them would throw away a reproduction recipe, and wiring them
 *     up would add three checks nobody wants run.
 * So the rule is not "everything must be wired". The rule is: a file that PRESENTS ITSELF as a gate
 * must be runnable, and a file that is a one-shot probe must SAY SO. Anything else is ambiguous, and
 * ambiguity is exactly how a real gate hides among abandoned scripts.
 *
 * HOW A FILE DECLARES ITS INTENT (either is enough):
 *   - be referenced from package.json scripts, or imported by something that is; or
 *   - carry `@one-shot` in its header comment, naming it a diagnostic that is not expected to run
 *     again. The tag is cheap to add and makes the author state which kind of thing they wrote.
 *
 * WHAT IT ASSERTS: every internal/*.mjs whose name or header marks it as a gate (check-*, verify-*,
 * smoke-*, or a header containing "GATE") is either reachable or explicitly tagged @one-shot; and every
 * check:/verify:/smoke: SCRIPT is run by a standing chain (by exact name), declared on demand with a
 * reason, or in the shrink-only baseline of 2026-09-29's orphans (the second arm, below); and every
 * gate-shaped FILE under plugin-designs/ or library/ is run by path from a script or another file's code
 * (comments stripped), tagged @one-shot, or in that baseline's `files` list.
 *
 *   node internal/check-no-orphan-gates.mjs            check (the chain arm's self-test runs first, every time)
 *   node internal/check-no-orphan-gates.mjs --shrink   drop baselined scripts since chained, declared or deleted
 *   node internal/check-no-orphan-gates.mjs --init     write the orphan baseline, only if none exists
 *   node internal/check-no-orphan-gates.mjs --init-files  add the `files` list, only if the baseline has none
 *
 * NEGATIVE-TESTED: removing the check:shell-scroll entry from package.json makes this fail by name.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgRaw = readFileSync(join(ROOT, 'package.json'), 'utf8')

const files = readdirSync(join(ROOT, 'internal')).filter((f) => f.endsWith('.mjs'))

const SELF = 'check-no-orphan-gates.mjs'

/**
 * A file is reachable if package.json names it, or if some OTHER source file imports it.
 *
 * ★ THE EXCLUSION OF THIS FILE IS LOad-BEARING, not tidiness. First version of this gate listed
 * `theme-flash-probe.mjs` in its own header as an example of a dated diagnostic — then grepped for
 * importers, found ITSELF, and declared the file reachable. The gate written to catch orphans made
 * an orphan pass, by citing it. A gate must never be its own witness.
 *
 * Same family as the `@one-shot` bug found in the same run: the tag-detection matched this file's
 * own prose explaining what the tag means, so the gate reported "1 tagged @one-shot" when no file
 * had ever been tagged. Both defects come from reading EVIDENCE out of DOCUMENTATION. Where a gate
 * must describe the thing it checks, it has to exclude its own text from the check.
 */
function reachable(base) {
  if (pkgRaw.includes(base)) return 'package.json'
  try {
    const hits = execSync(
      `grep -rl -- ${JSON.stringify(base.replace(/\.mjs$/, ''))} --include=*.mjs --include=*.js --include=*.ts . 2>/dev/null | grep -v node_modules | grep -v "internal/${base}" | grep -v "internal/${SELF}" || true`,
      { cwd: ROOT, encoding: 'utf8' }
    ).trim()
    if (hits) return hits.split('\n')[0]
  } catch {}
  return null
}

const orphans = []
let checked = 0
let tagged = 0

for (const f of files) {
  const src = readFileSync(join(ROOT, 'internal', f), 'utf8')
  const header = src.slice(0, 2600)

  // Does this file present itself as a GATE (something meant to run repeatedly)?
  const looksLikeGate = /^(check|verify|smoke)-/.test(f) || /\bGATE\b|\bgate for\b/i.test(header)
  if (!looksLikeGate) continue
  checked++

  // The tag must be a MARKER on its own line (` * @one-shot  <reason>`), not the string appearing
  // anywhere in prose. This gate's own header discusses `@one-shot` at length, and a loose test
  // counted that discussion as a tag — reporting "1 tagged" when nothing had ever been tagged.
  // Requiring line-start-plus-comment-prefix makes the tag a deliberate act instead of a word.
  if (/^\s*(?:\*|\/\/)\s*@one-shot\b/m.test(header) && f !== SELF) { tagged++; continue }
  const via = reachable(f)
  if (!via) orphans.push(f)
}

if (orphans.length) {
  console.error(`NO-ORPHAN-GATES: FAIL — ${orphans.length} gate(s) exist but nothing can run them.\n`)
  for (const f of orphans) {
    console.error(`  internal/${f}`)
  }
  console.error('\n  A gate nobody can invoke is a file, not a check. Pick one:')
  console.error('    1. add a package.json script (and, if it needs a browser, an entry in the GATES')
  console.error('       array of internal/verify-browser-all.mjs so the one-command suite runs it);')
  console.error('    2. or add `@one-shot` to its header if it was a diagnostic for a single bug and')
  console.error('       is kept only as a reproduction recipe.')
  console.error('\n  This already happened once (card BUILD-BROWSER-GATES-WERE-ALL-ORPHANS). It recurs')
  console.error('  because writing a gate and registering it are separate acts, and only the first')
  console.error('  one feels like the work.')
  process.exit(1)
}

// ── THE SAME QUESTION FOR GATE FILES OUTSIDE internal/ (2026-09-29) ─────────────────────────
// The walk above reads internal/ only, so a plugin's own gate that nobody registered was invisible:
// on 2026-09-29 six plugin-local check-*.mjs files were referenced by nothing. Every TRACKED file under
// plugin-designs/ or library/ named check-/verify-/smoke-*.mjs must be run by PATH from a package.json
// script, or referenced from another file's CODE, or carry @one-shot, or sit in the shrink-only baseline
// (orphan-checks-baseline.json `files`) for its owner.
// ⚠ PATHS, AND CODE ONLY. A basename counts only where no other gate file shares it:
// library/scripts/research/verify-map-paint.mjs shares its name with internal/verify-map-paint.mjs, which
// is what verify:map-paint runs, so a name match let one registration vouch for a different file. And
// comments are stripped first: a file mentioned in prose is not run by it (the lesson recorded above).
export function outerOrphans({ gateFiles, scriptCmds, codeByFile, oneShot = new Set(), baseline = [] }) {
  const base = (p) => p.slice(p.lastIndexOf('/') + 1)
  const count = new Map()
  for (const p of gateFiles) count.set(base(p), (count.get(base(p)) || 0) + 1)
  const out = []
  for (const p of gateFiles) {
    if (!/^(plugin-designs|library)\//.test(p) || oneShot.has(p)) continue
    const unique = count.get(base(p)) === 1
    const hit = (text) => text.includes(p) || (unique && text.includes(base(p)))
    if (hit(scriptCmds)) continue
    if ([...codeByFile].some(([f, code]) => f !== p && hit(code))) continue
    out.push(p)
  }
  const bl = new Set(baseline)
  return { unreached: out, fresh: out.filter((p) => !bl.has(p)), gone: [...bl].filter((p) => !out.includes(p)) }
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
{
  // Self-test on planted cases: each rule must be able to fail.
  const files = ['plugin-designs/a/scripts/check-x.mjs', 'plugin-designs/b/scripts/check-y.mjs', 'internal/verify-z.mjs', 'library/s/verify-z.mjs']
  const run = (scripts, code) => outerOrphans({ gateFiles: files, scriptCmds: scripts, codeByFile: new Map(code) }).fresh
  const allWired = 'node plugin-designs/a/scripts/check-x.mjs && node plugin-designs/b/scripts/check-y.mjs && node library/s/verify-z.mjs'
  const cases = [
    ['everything registered by path passes', run(allWired, []), 0],
    ['a plugin gate nobody runs fails', run('node plugin-designs/a/scripts/check-x.mjs && node library/s/verify-z.mjs', []), 1],
    ['a gate run from another file\'s code passes', run('node plugin-designs/a/scripts/check-x.mjs && node library/s/verify-z.mjs', [['internal/all.mjs', "spawn('node', ['plugin-designs/b/scripts/check-y.mjs'])"]]), 0],
    ['a gate only MENTIONED in a comment fails', run('node plugin-designs/a/scripts/check-x.mjs && node library/s/verify-z.mjs', [['internal/all.mjs', stripComments('// see check-y.mjs')]]), 1],
    ['a shared basename cannot vouch for the other file', run('node plugin-designs/a/scripts/check-x.mjs && node plugin-designs/b/scripts/check-y.mjs && node internal/verify-z.mjs', []), 1],
  ]
  const bad = cases.filter(([, got, want]) => (want === 0) !== (got.length === 0))
  if (bad.length) { for (const [n, got] of bad) console.error(`  ✗ self-test: ${n} -> ${JSON.stringify(got)}`); console.error('NO-ORPHAN-GATES: SELF-TEST FAILED — the file arm cannot be trusted'); process.exit(1) }
}
{
  const gateFiles = execSync('git ls-files -- internal plugin-designs library', { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter((p) => /\/(check|verify|smoke)-[^/]*\.mjs$/.test(p) && !p.includes('/data/'))
  const scriptCmds = Object.values(JSON.parse(pkgRaw).scripts || {}).join('\n')
  const codeFiles = execSync('git ls-files -- "*.mjs" "*.js" "*.vue"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((p) => p && !p.includes('node_modules'))
  const codeByFile = new Map(codeFiles.map((p) => { try { return [p, stripComments(readFileSync(join(ROOT, p), 'utf8'))] } catch { return [p, ''] } }))
  const oneShot = new Set(gateFiles.filter((p) => { try { return /^\s*(?:\*|\/\/)\s*@one-shot\b/m.test(readFileSync(join(ROOT, p), 'utf8').slice(0, 2600)) } catch { return false } }))
  const ORPHANS_REL_F = 'internal/fixtures/orphan-checks-baseline.json'
  const bl = (() => { try { return JSON.parse(readFileSync(join(ROOT, ORPHANS_REL_F), 'utf8')) } catch { return null } })()
  const v = outerOrphans({ gateFiles, scriptCmds, codeByFile, oneShot, baseline: bl?.files || [] })
  if (process.argv.includes('--init-files') || process.argv.includes('--shrink')) {
    if (bl && (process.argv.includes('--shrink') || !bl.files)) {
      const files = process.argv.includes('--init-files') && !bl.files ? v.unreached : (bl.files || []).filter((p) => !v.gone.includes(p))
      writeFileSync(join(ROOT, ORPHANS_REL_F), JSON.stringify({ ...bl, files: files.sort() }, null, 1) + '\n')
      console.log(`NO-ORPHAN-GATES: file baseline ${process.argv.includes('--init-files') ? 'written' : 'shrunk'}: ${files.length} file(s)`)
    }
  }
  console.log(`  gate files      : ${gateFiles.length} tracked; outside internal/, ${v.unreached.length} run by nothing (${(bl?.files || []).length - v.gone.length} baselined for their owners)`)
  if (v.fresh.length && !process.argv.includes('--init-files')) {
    console.error(`NO-ORPHAN-GATES: FAIL — ${v.fresh.length} gate file(s) outside internal/ that nothing runs:`)
    for (const p of v.fresh) console.error(`  ✗ ${p}`)
    console.error('  Register it by PATH in a package.json script (and chain it), or tag @one-shot if it was a one-bug diagnostic.')
    process.exit(1)
  }
}

// ── SECOND, DISTINCT QUESTION: does it RUN? ────────────────────────────────
// Reachable and wired are not the same property, and conflating them is how 70 of
// 100 check:* scripts came to sit outside every gate wave without anyone noticing —
// including this gate itself. A script entry means a human CAN run it; membership in
// gates:pre/gates:post means it runs on every build.
//
// This REPORTS rather than fails, deliberately. Most unwired gates are correctly
// hand-run: they need a served tree (check:mobile, check:shots), a device, a token,
// or an argument (check:packet-render takes a path). Failing the build on those
// would be wrong and the gate would be disabled within a day.
//
// ⚠ AND SOME MUST NEVER BE WIRED, which "it passes when I run it" cannot tell you.
// check:settled asserts the tree is QUIET — no builder running, no recent churn — so
// it fails inside a build BY DESIGN. Measured 2026-09-24: it passed twice standalone,
// was wired on that evidence, and failed the very next build (29/30). The test for
// wave membership is not "does it pass" but "is its assertion compatible with running
// mid-build". What it must not do is
// stay silent — a gate that could run and does not is indistinguishable from one
// that is broken, which is the exact failure verify-shell-scroll had.
//
// ★ SO IT IS A DECISION NOW, NOT A REPORT (2026-09-29). Reported, the list only grew: 87 check/verify/
// smoke scripts sat outside every chain, and that day two of them hid real defects. check:i18n-never-
// translated was unchained while a dead key, identical in all 11 catalogues, stayed on development for
// hours; check:auto-engine asserted a retired engine rule and nothing ran it. Every check:/verify:/smoke:
// script must now be one of:
//   REACHED    run by a standing chain: gates:pre, gates:post, the browser suite's GATES, the build, or
//              anything those `bun run` in turn;
//   ON DEMAND  named in internal/fixtures/on-demand-checks.json WITH its reason (check:settled's is above);
//   BASELINED  in internal/fixtures/orphan-checks-baseline.json, the orphans found that day, for their
//              owners to chain, declare or delete. That list only shrinks (--shrink).
// A new script that is none of these FAILS, so "not chained" is something someone decided and wrote down.
//
// ⚠ REACHED MEANS BY EXACT NAME. This arm's first form, and the census that prompted the change, tested
// `waves.includes(name)`, a substring: check:hardcoded-english read as run because
// check:hardcoded-english:self-test is in gates:pre. A gate's self-test is not the gate.
const ON_DEMAND_REL = 'internal/fixtures/on-demand-checks.json'
const ORPHANS_REL = 'internal/fixtures/orphan-checks-baseline.json'
const IS_CHECK = /^(check|verify|smoke):/

/** Script names a command runs: `bun run <name>` (or npm/pnpm/yarn), and run-parallel's list after ` -- `. */
function namesRunBy(cmd, scripts) {
  const out = new Set([...String(cmd).matchAll(/\b(?:bun|npm|pnpm|yarn)\s+run\s+([^\s;&|)"']+)/g)].map((m) => m[1]))
  if (/run-parallel/.test(cmd) && cmd.includes(' -- ')) for (const t of cmd.split(' -- ')[1].split(/\s+/)) out.add(t)
  return [...out].filter((n) => Object.prototype.hasOwnProperty.call(scripts, n))
}

/** The verdict, pure so the self-test can drive it: which checks are unreached and undeclared. */
export function unchainedChecks({ scripts, suite, onDemand = {}, baseline = [] }) {
  const roots = ['gates:pre', 'gates:post', ...suite, ...Object.keys(scripts).filter((k) => /^(pre|post)?build(:|$)/.test(k))]
  const reached = new Set()
  const queue = roots.filter((r) => Object.prototype.hasOwnProperty.call(scripts, r))
  for (const r of queue) reached.add(r)
  while (queue.length) for (const n of namesRunBy(scripts[queue.pop()], scripts)) if (!reached.has(n)) { reached.add(n); queue.push(n) }
  const checks = Object.keys(scripts).filter((k) => IS_CHECK.test(k))
  const base = new Set(baseline)
  const unreached = checks.filter((k) => !reached.has(k))
  return {
    checks, unreached,
    fresh: unreached.filter((k) => !(k in onDemand) && !base.has(k)),
    // An on-demand entry with no reason, or naming a script that no longer exists, is not a decision.
    badDeclared: Object.entries(onDemand).filter(([k, why]) => !String(why || '').trim() || !(k in scripts)).map(([k]) => k),
    // Baselined entries since chained, declared or deleted: fine, and --shrink tidies them.
    gone: [...base].filter((k) => reached.has(k) || k in onDemand || !(k in scripts)),
  }
}

// ── self-test, on every run: each rule proven able to fail on a planted case ──
{
  const S = (extra = {}) => ({ 'gates:pre': 'node internal/run-parallel.mjs --label=pre -- check:a check:b:self-test',
    'gates:post': 'node internal/run-parallel.mjs --label=post -- check:agg', 'check:a': 'node a', 'check:b': 'node b',
    'check:b:self-test': 'node b --self-test', 'check:agg': 'bun run check:c && bun run check:d', 'check:c': 'node c',
    'check:d': 'node d', ...extra })
  const cases = [
    ['a chained tree passes', { scripts: { ...S(), 'check:b': 'node b' }, suite: [], baseline: ['check:b'] }, 0],
    ['a new check in no chain fails', { scripts: S({ 'check:new': 'node n' }), suite: [], baseline: ['check:b'] }, 1],
    ['the same check in a chain passes', { scripts: S({ 'check:new': 'node n', 'gates:post': 'node internal/run-parallel.mjs --label=post -- check:agg check:new' }), suite: [], baseline: ['check:b'] }, 0],
    ['a gate chained only through its :self-test fails', { scripts: S(), suite: [], baseline: [] }, 1],
    ['a check the browser suite lists passes', { scripts: S({ 'check:e': 'node e' }), suite: ['check:e'], baseline: ['check:b'] }, 0],
    ['a declared on-demand check passes', { scripts: S({ 'check:f': 'node f' }), suite: [], onDemand: { 'check:f': 'needs a device' }, baseline: ['check:b'] }, 0],
  ]
  let ok = true
  for (const [name, input, want] of cases) {
    const got = unchainedChecks(input).fresh.length
    if ((want === 0) !== (got === 0)) { ok = false; console.error(`  ✗ self-test: ${name} -> ${got} unchained`) }
  }
  if (unchainedChecks({ scripts: S({ 'check:f': 'node f' }), suite: [], onDemand: { 'check:f': ' ' }, baseline: ['check:b'] }).badDeclared.length !== 1) {
    ok = false; console.error('  ✗ self-test: an on-demand entry with no reason was accepted')
  }
  if (!ok) { console.error('NO-ORPHAN-GATES: SELF-TEST FAILED — the chain arm cannot be trusted'); process.exit(1) }
}

const pkg = JSON.parse(pkgRaw)
const suiteSrc = readFileSync(join(ROOT, 'internal/verify-browser-all.mjs'), 'utf8')
const suite = [...(suiteSrc.split('const GATES = [')[1] || '').split('\n]')[0].matchAll(/script:\s*'([^']+)'/g)].map((m) => m[1])
const readJson = (rel, d) => { try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) } catch { return d } }
const onDemand = readJson(ON_DEMAND_REL, { checks: {} }).checks || {}
const orphanBase = readJson(ORPHANS_REL, null)
if (process.argv.includes('--init') || process.argv.includes('--shrink')) {
  const v = unchainedChecks({ scripts: pkg.scripts, suite, onDemand, baseline: orphanBase?.unreached || [] })
  const init = process.argv.includes('--init')
  if (init && orphanBase) { console.error(`NO-ORPHAN-GATES: --init refused, ${ORPHANS_REL} exists (use --shrink)`); process.exit(1) }
  const keep = init ? v.unreached.filter((k) => !(k in onDemand)) : orphanBase.unreached.filter((k) => !v.gone.includes(k))
  writeFileSync(join(ROOT, ORPHANS_REL), JSON.stringify({ ...(orphanBase || {}), about: 'check/verify/smoke scripts that no standing chain ran on 2026-09-29 and that nobody had declared on-demand. Each owner chains it, declares it in on-demand-checks.json with a reason, or deletes it. This list only shrinks (--shrink).', unreached: keep.sort() }, null, 1) + '\n')
  console.log(`NO-ORPHAN-GATES: orphan baseline ${init ? 'written' : 'shrunk'}: ${keep.length} script(s)`)
  process.exit(0)
}
const verdict = unchainedChecks({ scripts: pkg.scripts, suite, onDemand, baseline: orphanBase?.unreached || [] })
console.log(`  chains          : ${verdict.checks.length - verdict.unreached.length}/${verdict.checks.length} check/verify/smoke `
  + `script(s) reached by exact name; ${Object.keys(onDemand).length} declared on demand; `
  + `${(orphanBase?.unreached || []).length - verdict.gone.length} baselined for their owners`
  + (verdict.gone.length ? ` (${verdict.gone.length} since settled; tidy with --shrink)` : ''))
if (verdict.fresh.length || verdict.badDeclared.length) {
  console.error(`NO-ORPHAN-GATES: FAIL — ${verdict.fresh.length} script(s) that no chain runs and nobody declared`
    + (verdict.badDeclared.length ? `, ${verdict.badDeclared.length} on-demand entr(y/ies) with no reason or no script` : ''))
  for (const k of verdict.fresh) console.error(`  ✗ ${k}`)
  for (const k of verdict.badDeclared) console.error(`  ✗ ${k} (in ${ON_DEMAND_REL})`)
  console.error('  Chain it (gates:pre / gates:post, or the browser suite once it has run), or declare it in')
  console.error(`  ${ON_DEMAND_REL} with the reason it must run by hand.`)
  process.exit(1)
}

console.log(`NO-ORPHAN-GATES: PASS — ${checked} gate-shaped file(s); all reachable (${tagged} tagged @one-shot).`)
console.log('  Reachable means named in package.json or imported by something that is. The @one-shot')
console.log('  tag exists so a dated diagnostic can be KEPT as a reproduction recipe without either')
console.log('  masquerading as a live check or being deleted for tidiness.')
