#!/usr/bin/env node
/**
 * run-parallel.mjs — runs a SET OF INDEPENDENT verification steps concurrently instead of
 * one-at-a-time, and grades the set by exit code.
 *
 * WHY (measured 2026-09-23, on this box, `bun run` per step, load avg ~20):
 *   The 29 gates in build:unlocked cost 84.5s wall when chained with `&&`, but 21 of them
 *   finish in under 700ms — they are node-process-startup, not work. The chain's cost is
 *   the SUM of the steps while the machine sits on 7 idle cores. The two dominators
 *   (check:mjs-parse 26.9s, check:parse 18.7s) alone are 54% of the total, so every cheap
 *   gate behind them is pure queueing delay. Same shape for the 22 vite builds: 129.0s
 *   sequential, each writing to its OWN public/doxa-maps/<bundle>/ (vite.config.js sets
 *   outDir per bundle, emptyOutDir:false, and emits nothing outside it) — so they were
 *   never actually ordered, only serialized.
 *
 * ★ COVERAGE IS NOT REDUCED, AND THAT IS THE POINT. Every step that ran before still runs,
 *   as the same command, graded by the same exit code. Nothing is skipped, sampled,
 *   cached, or made conditional on what changed. The only thing that changes is WHEN each
 *   step starts. A speed-up that drops a gate is not a speed-up, it is a coverage cut with
 *   a stopwatch attached.
 *
 * ★ WHY IT REPORTS ALL FAILURES INSTEAD OF STOPPING AT THE FIRST
 *   An `&&` chain hides every failure after the first, so a build with three broken gates
 *   costs three full fix-and-rerun cycles to discover. Within one phase the steps are
 *   independent, so there is no reason to stop: this runs the whole set, prints every
 *   failure's full output, and exits 1. Ordering that DOES matter is still enforced —
 *   build:unlocked keeps `&&` BETWEEN phases, so a source gate still blocks the build, and
 *   the build still blocks the gates that read its output.
 *
 * ★ WHY THERE IS NO TIMEOUT HERE
 *   House rule: "A command killed by a short `timeout` is not a failure." A runner that
 *   imposed its own deadline would manufacture failures under exactly the load that makes
 *   parallelism worth having. Steps run to completion; the caller decides.
 *
 * ★ WHY PASSING OUTPUT IS SUPPRESSED (and --verbose exists)
 *   These gates print teaching prose AFTER their verdict. Interleaving 20 of those streams
 *   produces something no one can read, and the brief already warns that `| tail -1`
 *   inverts the signal. So: passing steps report one table line, failing steps report their
 *   ENTIRE captured output, unabridged. --verbose prints everything.
 *
 * USAGE
 *   node internal/run-parallel.mjs --label=pre  -- check:a check:b ...   # runs `bun run <name>`
 *   node internal/run-parallel.mjs --bundles                             # BUNDLE=<d> bun x vite build, for every plugin-designs/<d>/
 *   env: GATES_CONCURRENCY (default min(cpus,6)) · BUILD_CONCURRENCY (default 4)
 */
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { isWebBuilt } from './plugin-targets.mjs'
import { isBrowserGate as isBrowserGateAt } from './lib/browser-gates.mjs'
import { cpus } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const isBrowserGate = (name) => isBrowserGateAt(ROOT, name)
const VERBOSE = argv.includes('--verbose')
const BUNDLES = argv.includes('--bundles')
const labelArg = argv.find((a) => a.startsWith('--label='))
const LABEL = labelArg ? labelArg.slice('--label='.length) : BUNDLES ? 'bundles' : 'gates'

// everything after `--` (or every bare non-flag arg) is a step name
const dashdash = argv.indexOf('--')
const names = (dashdash === -1 ? argv : argv.slice(dashdash + 1)).filter((a) => !a.startsWith('--'))

/**
 * WHY TWO DIFFERENT DEFAULTS: a gate is one short-lived node process (startup-bound, ~cheap
 * RAM), while a vite build holds a whole rollup graph in memory. Measured on this box:
 * 15GB total with ~6GB available while other agents run browsers, and a vite build peaks
 * in the hundreds of MB — so 22-wide would swap the machine to death and report it as a
 * slow build. 4-wide is ~2GB and leaves the box usable for everyone else on it.
 */
const CONCURRENCY = Math.max(
  1,
  Number(
    BUNDLES
      ? process.env.BUILD_CONCURRENCY || 4
      : process.env.GATES_CONCURRENCY || Math.min(cpus().length, 6)
  ) || 1
)

// ★ TWO LOCKS, IN A FIXED ORDER, AND THAT IS NOT BELT-AND-BRACES — IT IS A NAME PROBLEM.
// The rendezvous must be ONE path for everyone or the queue is not a queue. The agents' own probe
// scripts take a lock whose filename carries an internal code name, and check:no-codename refuses
// (correctly) to let a repo we are handing over contain that word. So this takes BOTH: the repo's
// product-named lock, and whatever path the environment names — always in that order, so two
// processes can never take them in opposite orders and deadlock. Either file alone still
// serialises everything that uses it; taking both is what makes gates and hand-run probes queue
// against each other without the repo having to spell a name it must not ship.
// The slot files live in browser-slot.sh, which owns the rendezvous now. BROWSER_GATE_LOCK from a
// caller's environment is deliberately NOT consulted here any more: a single legacy lock taken
// alongside the slots would collapse two slots back into one, which is the queue this replaced.
// Agents' own wrappers should call internal/browser-slot.sh so everyone shares the same counter.
// ★ THE LOAD WAIT WAS COSTING MORE THAN IT SAVED. It was written at LOAD_MAX 12 when the risk was
// seven agents starting chrome at once; the FLOCK below is what actually prevents that — one
// browser gate at a time, across every agent on the box. The load check is belt-and-braces on top
// of a belt. MEASURED 2026-09-25 with several agents working: 1-min load sits at 36-50 all day, so
// 12 is unreachable and every browser gate simply waited out its full 900s cap before running
// anyway. That is a 15-minute tax per wave for a guard that never opens, and its practical effect
// is that people stop running browser gates. Raised to a level that still catches a genuinely
// wedged box, with a short cap so a wave is never held for long. Both still override by env.
// Scaled to the machine rather than a constant: a load of 40 means something different on 8 cores
// than on 64. Five runnable processes per core is busy-but-working; past that the box is thrashing
// and a browser gate would be measuring the thrash.
const LOAD_MAX = Number(process.env.LOAD_MAX || cpus().length * 5)
const QUIET_WAIT_MAX = Number(process.env.QUIET_WAIT_MAX || 120)
const HAS_FLOCK = spawnSync('sh', ['-c', 'command -v flock'], { stdio: 'ignore' }).status === 0
const LOCK_WAIT_S = Number(process.env.BROWSER_LOCK_WAIT || 900)
// EX_TEMPFAIL. Anything but 0 or 1, so it cannot be confused with a gate's own verdict.
const LOCK_BUSY_CODE = 75


/**
 * Hold a browser gate back while the box is already overloaded. Same threshold and cadence as
 * the shared wait-for-quiet.sh, so agents behave identically whichever entry point they use.
 * It PROCEEDS after the cap rather than failing: a gate that refuses to run is a coverage
 * loss, and load is a property of the machine, not of the code under test.
 */
let quietOnce = null
async function waitForQuiet(log) {
  // ONCE PER WAVE, not once per gate. The flock already guarantees one browser at a time, so
  // a per-step load wait just multiplies the same hold by the number of browser gates — with
  // four of them and a 900s cap that is an hour of a wave doing nothing on a busy box, which
  // is how a load fix turns into a reason to stop running gates.
  if (quietOnce) return quietOnce
  quietOnce = (async () => {
  let waited = 0
  for (;;) {
    const load = Number(String(readFileSync('/proc/loadavg', 'utf8')).split(' ')[0])
    if (!Number.isFinite(load) || load < LOAD_MAX) return
    if (waited >= QUIET_WAIT_MAX) {
      log(`  · load ${load} still above ${LOAD_MAX} after ${waited}s — proceeding anyway`)
      return
    }
    log(`  · load ${load} >= ${LOAD_MAX}, holding browser gates (${waited}s)`)
    await new Promise((r) => setTimeout(r, 15000))
    waited += 15
  }
  })()
  return quietOnce
}

/** @returns {{name:string, cmd:string, args:string[], env:Record<string,string>}[]} */
function buildSteps() {
  if (!BUNDLES) {
    if (!names.length) {
      console.error('run-parallel: no steps given. Pass script names after `--`.')
      process.exit(2)
    }
    return names.map((name) => {
      const step = { name, cmd: 'bun', args: ['run', name], env: {} }
      if (!isBrowserGate(name) || !HAS_FLOCK) return step
      // ★ ONE CHROME AT A TIME, ACROSS EVERY AGENT ON THIS BOX. Seven agents each running a
      // wave of their own put 7+ chrome-headless renders on one machine at once; measured
      // 2026-09-24, the box hit load 47 with 8GB of swap, and a browser gate that is swapping
      // does not measure the product, it measures the swap. The rendezvous is a COARSE flock
      // on one well-known path that every agent's tooling shares (bundler-3's
      // wait-for-quiet.sh takes the same lock), so this queues rather than dogpiles. -w 1200
      // caps the wait so a crashed holder cannot wedge a wave forever, and static gates —
      // parse, sri, hygiene, the twenty that are node-startup — are left completely free.
      // ★ A TWO-SLOT SEMAPHORE, NOT A MUTEX. One lock made every agent's browser proof wait behind
      // a single chrome — measured 2026-09-25, the queue sat 10-19 deep for hours. The constraint
      // is MEMORY (~300-500MB per headless chrome), not exclusivity, so browser-slot.sh runs as
      // many as the box can hold and refuses to start one when MemAvailable is below the floor.
      // It keeps the same exit-code contract: 75 means "not measured", never "failed".
      const args = [resolve(ROOT, 'internal/browser-slot.sh'), 'bun', 'run', name]
      return { ...step, browser: true, cmd: 'sh', args }
    })
  }
  // A bundle is a plugin-designs/<name>/ directory — the same selector build:unlocked used
  // (`for d in plugin-designs/*/`), so the SET of things built is identical.
  const dir = resolve(ROOT, 'plugin-designs')
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    // Not a web plugin (targets without "web", e.g. Rudder: desktop + widget): built by desktop:build only.
    .filter((e) => isWebBuilt(resolve(dir, e.name)))
    .map((e) => e.name)
    .sort()
    .map((name) => ({ name, cmd: 'bun', args: ['x', 'vite', 'build'], env: { BUNDLE: name } }))
}

// ★ ONLY A SEAT THAT MAY RUN A BROWSER RUNS BROWSER GATES (2026-09-26, project rule: browsers are one
// agent's; every other agent works headless). Elsewhere a browser gate is NOT MEASURED — never run, never
// counted as a failure, never counted as a pass. DOXA_BROWSER=1 marks the browser seat.
const BROWSER_SEAT = process.env.DOXA_BROWSER === '1'

async function runStep(step) {
  if (step.browser && !BROWSER_SEAT) {
    return { ...step, ms: 0, code: LOCK_BUSY_CODE, out: `  (browser gate on a headless seat: set DOXA_BROWSER=1 on the browser seat to measure it)` }
  }
  if (step.browser && existsSync('/proc/loadavg')) await waitForQuiet((m) => console.log(m))
  return new Promise((done) => {
    const started = Date.now()
    const child = spawn(step.cmd, step.args, {
      cwd: ROOT,
      env: { ...process.env, ...step.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const cap = (buf) => {
      out += buf
    }
    child.stdout.on('data', cap)
    child.stderr.on('data', cap)
    child.on('error', (err) => {
      // spawn itself failed (missing binary) — a real failure, not a gate verdict
      done({ ...step, ms: Date.now() - started, code: 127, out: String(err && err.message) })
    })
    child.on('close', (code) => done({ ...step, ms: Date.now() - started, code: code ?? 1, out }))
  })
}

async function main() {
  const steps = buildSteps()
  const t0 = Date.now()
  console.log(
    `▶ ${LABEL}: ${steps.length} step(s), ${CONCURRENCY} at a time ` +
      `(${cpus().length} cpus; override with ${BUNDLES ? 'BUILD_CONCURRENCY' : 'GATES_CONCURRENCY'})`
  )

  const queue = steps.slice()
  const results = []
  const worker = async () => {
    for (;;) {
      const step = queue.shift()
      if (!step) return
      const r = await runStep(step)
      results.push(r)
      // ★ A SKIP IS NOT A PASS, AND THIS PRINTED THEM IDENTICALLY. The grade is the exit
      // code, and a gate that declines to evaluate exits 0 — so "35/35 passed" read the
      // same whether 35 gates graded something or 17 did. MEASURED 2026-09-24: 18 of the
      // 35 steps in gates:post CAN skip, every one of them on a precondition (a served
      // tree, generated posters, a built manifest) that a fresh checkout does not have.
      // check:packets-all SKIPped on every CI build for exactly this reason and nobody
      // could see it, because the wave reported it green. An always-taken SKIP is
      // indistinguishable from an unwired gate unless the runner says so.
      // A gate that never ran because the browser lock stayed busy is UNMEASURED, not failed.
      // THREE OUTCOMES, never two. Exit 75 (EX_TEMPFAIL) from ANY step is NOT MEASURED: the gate could not
      // look (no browser seat, no slot, no built tree), which is neither a pass nor a failure. A gate that
      // exits 0 while announcing SKIP is also NOT MEASURED. Only any other non-zero exit is a FAIL.
      const unmeasured = r.code === LOCK_BUSY_CODE || (r.code === 0 && /(^|\n)\s*[A-Z][A-Z0-9-]*:\s*(SKIP|NOT MEASURED)\b/.test(r.out))
      r.bucket = unmeasured ? 'NOT MEASURED' : r.code === 0 ? 'PASS' : 'FAIL'
      console.log(
        `  ${unmeasured ? '⊘' : r.code !== 0 ? '✗' : '✓'} ${r.name.padEnd(26)} ${String(r.ms).padStart(7)}ms` +
          (r.code === 0 || unmeasured ? '' : `  exit ${r.code}`)
      )
      r.skipped = unmeasured
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, steps.length) }, worker))

  const wall = Date.now() - t0
  const serial = results.reduce((a, r) => a + r.ms, 0)
  const failed = results.filter((r) => r.bucket === 'FAIL')

  // A failure must be readable in full: these gates explain themselves in their output, and
  // a truncated explanation is how a real defect gets re-diagnosed as a flake.
  // ★ BRACED ON PURPOSE. Unbraced, this `else` bound to the INNER `if (r.out.trim())`, so without
  // --verbose a failed gate printed only its name and exit code, never why.
  if (VERBOSE) {
    for (const r of results) if (r.out.trim()) console.log(`\n───── ${r.name} ─────\n${r.out}`)
  } else {
    for (const r of failed) console.log(`\n───── FAILED: ${r.name} (exit ${r.code}) ─────\n${r.out}`)
  }

  // COUNT THE SKIPS IN THE SUMMARY, because the summary is the line a reader quotes and
  // the one that lands in a report. "35/35 passed" was true of a wave where a third of the
  // gates declined to look at anything.
  const skips = results.filter((r) => r.bucket === 'NOT MEASURED')
  const passed = results.filter((r) => r.bucket === 'PASS')
  console.log(
    `\n▶ ${LABEL}: PASS ${passed.length} · FAIL ${failed.length} · NOT MEASURED ${skips.length}  (of ${results.length})` +
      ` in ${(wall / 1000).toFixed(1)}s wall ` +
      `(${(serial / 1000).toFixed(1)}s of work — ${(serial / Math.max(wall, 1)).toFixed(1)}x)`
  )
  if (skips.length) {
    console.log(`  ⊘ NOT MEASURED: ${skips.map((s) => s.name).join(', ')}`)
    console.log('    Each could not look (no browser seat, no slot, or a missing precondition it names); not a pass, not a failure.')
  }
  if (failed.length) {
    console.error(`✗ ${LABEL}: ${failed.length} step(s) FAILED — ${failed.map((f) => f.name).join(', ')}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('run-parallel: crashed —', err)
  process.exit(1)
})
