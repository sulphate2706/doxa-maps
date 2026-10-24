/**
 * check-gospel-all.mjs — everything this bundle owns, in one command.
 *
 * WHY THIS EXISTS. gospel-resources has ten gates of its own and every one of them was
 * hand-run. That is how a dead bundle shipped: a duplicate module killed all five leaves,
 * and the one gate I happened to run that day was pointed at the map. `check:no-orphan-gates`
 * was right that they were all reachable — reachable is not the same as run.
 *
 * It is NOT wired into gates:pre/post on purpose. Three of these need a browser, the shared
 * wave holds browser gates under load, and a bundle owner should not be able to slow every
 * other agent's build by adding to a list they do not own. This is the bundle's own front
 * door instead: one command, honest about what it could not measure.
 *
 * STATIC FIRST, THEN BROWSER. The static gates are sub-second and catch most drift, so they
 * run first and a failure there stops the run before a browser is launched — there is no
 * point spending a scarce browser slot to confirm a table is inconsistent.
 *
 * NOT MEASURED IS NOT PASS. A browser gate that cannot get a slot exits 75 and is reported
 * as NOT MEASURED, never folded into the pass. Anything else would turn a busy machine into
 * a green tick.
 */
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SLOT = resolve(HERE, 'browser-slot.sh')

const STATIC = [
  ['check:no-conflict-markers', 'nothing tracked is mid-merge'],
  ['check:no-conflict-markers:poison', '...and that check can fail'],
  ['check:coverage-consistent', 'the surfaces agree about who has what'],
  ['check:coverage-consistent:poison', '...and that check can fail'],
  ['check:surfaces-read-the-tier', 'one place decides "this group has nothing"'],
  ['check:stale-sweep-claim', 'no caveat outliving its truth'],
  ['check:click-sheet', 'the country sheet resolves, links are absolute'],
  ['check:snapshot-guard', 'no fetcher writes around the guard'],
  ['check:gospel-tables-staged', 'every asset the map fetches is in the shipped tree'],
  ['check:gospel-clear-filter-url', 'Show all drops only the filter keys, not a partner\'s'],
]
const BROWSER = [
  ['check:leaves-mount', 'all five leaves actually mount'],
  ['check:leaves-mount:poison', '...and that check can fail'],
  ['check:composed-filters', 'the composite filters instead of navigating'],
  ['check:map-paints', 'the map puts pixels on the screen, not just features'],
  ['check:map-paints:poison', '...and that check can fail'],
]

const run = (script, viaSlot) => {
  const cmd = viaSlot ? SLOT : 'bun'
  const args = viaSlot ? ['bun', 'run', script] : ['run', script]
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8' })
  return { code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` }
}

const failed = []
const notMeasured = []
let passed = 0

for (const [script, what] of STATIC) {
  const r = run(script, false)
  if (r.code === 0) { passed++; console.log(`  ok   ${script.padEnd(34)} ${what}`) }
  else { failed.push([script, r.out.trim().split('\n').slice(-3).join(' | ')]); console.log(`  FAIL ${script.padEnd(34)} ${what}`) }
}
if (failed.length) {
  console.error(`\nGOSPEL-ALL: FAIL — ${failed.length} static gate(s); not launching a browser to confirm it.`)
  for (const [s, tail] of failed) console.error(`  ${s}: ${tail}`)
  process.exit(1)
}

for (const [script, what] of BROWSER) {
  const r = run(script, true)
  if (r.code === 0) { passed++; console.log(`  ok   ${script.padEnd(34)} ${what}`) }
  else if (r.code === 75) { notMeasured.push(script); console.log(`  --   ${script.padEnd(34)} NOT MEASURED (no browser slot)`) }
  else { failed.push([script, r.out.trim().split('\n').slice(-3).join(' | ')]); console.log(`  FAIL ${script.padEnd(34)} ${what}`) }
}

console.log('')
if (failed.length) {
  console.error(`GOSPEL-ALL: FAIL — ${failed.length} gate(s) red, ${passed} green, ${notMeasured.length} not measured.`)
  for (const [s, tail] of failed) console.error(`  ${s}: ${tail}`)
  process.exit(1)
}
if (notMeasured.length) {
  console.log(`GOSPEL-ALL: INCOMPLETE — ${passed} green, ${notMeasured.length} NOT MEASURED (${notMeasured.join(', ')}).`)
  console.log('  Not a pass. Re-run when a browser slot is free.')
  process.exit(75)
}
console.log(`GOSPEL-ALL: PASS — ${passed} gate(s), static and browser.`)
