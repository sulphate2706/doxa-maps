#!/usr/bin/env node
/**
 * check-script-flags-reachable.mjs — a flag a package.json script advertises must actually reach it.
 *
 * THE DEFECT THIS CATCHES, proven by experiment rather than reasoned about:
 *
 *     "_t1": "node /tmp/argtest.mjs"                          $ bun run _t1 --self-test
 *                                                               ARGV: ["--self-test"]
 *     "_t2": "node /tmp/argtest.mjs   # a trailing comment"    $ bun run _t2 --self-test
 *                                                               ARGV: []
 *
 * This repo documents its scripts with inline `#` comments — a genuinely good habit, and 36 scripts
 * use it. But `bun run <script> <args>` APPENDS the arguments to the command string, so when the
 * command ends in a comment the appended flag lands INSIDE that comment and the shell discards it.
 * No error. No warning. The script simply runs in its default mode and reports success.
 *
 * ★ WHY THIS IS WORSE THAN AN ORDINARY BUG. Two of the affected scripts are `--self-test` flags, and
 * a `--self-test` IS THE NEGATIVE TEST — the thing that proves a gate is capable of failing. Running
 * `bun run check:facet-cascade --self-test` printed the normal PASS and exited 0, which reads as
 * "the negative test passed" when what actually happened is "the negative test never ran". So the
 * mechanism that certifies a gate can fail was itself silently not running: a gate that cannot fail,
 * hiding behind a flag that cannot arrive. Measured 2026-09-22; invoking node directly proved the
 * gate was fine (13 assertions failed correctly under the reverted cascade) and only the INVOCATION
 * was broken.
 *
 * WHAT IT ASSERTS. For every script whose inline comment advertises a `--flag`, that flag must be
 * reachable — meaning the command must NOT end with a comment. The fix is to put the comment BEFORE
 * the executable part is impossible in a shell string, so the practical fixes are:
 *   - drop the inline comment from scripts that take arguments (move the prose to the gate's header,
 *     where it is closer to the code anyway), or
 *   - give the script a dedicated sibling entry (`check:x:self-test`) that hardcodes the flag, which
 *     also makes the negative test discoverable in `bun run` output rather than buried in prose.
 * The second is usually better: a negative test nobody can find is a negative test nobody runs.
 *
 * SCOPE NOTE: this checks what the REPO PROMISES, not every possible argument. A script with no
 * advertised flag is not flagged, because passing an undocumented argument is the caller's business.
 *
 * NEGATIVE-TESTED: appending an inline comment to a flag-taking script makes this fail by name.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {}

const SPLIT = /\s+#\s/
const offenders = []
let advertising = 0

for (const [name, raw] of Object.entries(scripts)) {
  const body = String(raw)
  if (!SPLIT.test(body)) continue
  const [cmd, ...rest] = body.split(SPLIT)
  const comment = rest.join(' # ')

  // A flag is "advertised" when the COMMENT names it. Backticked forms count — `--self-test` in
  // prose is still a promise to the reader that they can pass it.
  const flags = [...new Set([...comment.matchAll(/--[a-z][a-z0-9-]+/g)].map((m) => m[0]))]
    // `--bind`, `--directory` etc. appear in comments that merely quote the command itself; only
    // treat a flag as advertised if the COMMAND does not already carry it.
    .filter((f) => !cmd.includes(f))
  if (!flags.length) continue

  advertising++
  offenders.push({ name, flags, cmd: cmd.trim() })
}

if (offenders.length) {
  console.error('SCRIPT-FLAGS: FAIL — ' + offenders.length + ' script(s) advertise a flag that cannot reach them.\n')
  for (const o of offenders) {
    console.error(`  "${o.name}" advertises ${o.flags.join(' ')}`)
    console.error(`      ${o.cmd.slice(0, 96)}${o.cmd.length > 96 ? '…' : ''}`)
    console.error(`      …followed by an inline # comment, so \`bun run ${o.name} ${o.flags[0]}\` appends`)
    console.error('      the flag INSIDE the comment and the shell drops it. The script runs in its')
    console.error('      default mode and exits 0, which looks exactly like success.\n')
  }
  console.error('  FIX: give the flag its own script entry that hardcodes it, e.g.')
  console.error(`        "${offenders[0].name}:${offenders[0].flags[0].replace(/^--/, '')}": "${offenders[0].cmd} ${offenders[0].flags[0]}"`)
  console.error('  A dedicated entry also makes the mode discoverable in `bun run`, instead of being')
  console.error('  documented only in prose that nobody greps.')
  console.error('\n  ★ Two of these are --self-test flags. A --self-test IS the proof that a gate can')
  console.error('  fail, so a --self-test that never runs is a gate certifying itself.')
  process.exit(1)
}

console.log(`SCRIPT-FLAGS: PASS — ${Object.keys(scripts).length} scripts checked, 0 advertise an unreachable flag.`)
console.log('  `bun run <script> <args>` appends arguments to the command string, so a trailing inline')
console.log('  `#` comment swallows them silently. Scripts that take flags must not end in a comment.')
