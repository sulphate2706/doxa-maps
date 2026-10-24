#!/usr/bin/env node
/**
 * check-no-repo-pb-hooks.mjs — no PocketBase hooks (pb_hooks, *.pb.js) may live in the repo.
 *
 * WHY: the cloud container pulls this repo every few seconds. A PocketBase hook is server-side JS; one pushed
 * by any plugin writer would run on the team backend within seconds, which is the rogue-writer hole the
 * roundtable test closed. The container never points PocketBase at the repo (--hooksDir is outside the
 * pulled tree; the one team sign-in hook is baked into the image and pinned, in the repo-root Dockerfile).
 * This gate keeps anyone from adding a hooks folder that LOOKS like it would run, or that a later recipe
 * change could start running.
 *
 * HOW: every tracked path; a self-test on every run (a poisoned list must fail), so the gate cannot go blind.
 */
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.DOXA_REPO || join(dirname(fileURLToPath(import.meta.url)), '..')

export const offending = (paths) => paths.filter((p) => /(^|\/)pb_hooks(\/|$)/.test(p) || /\.pb\.(js|ts)$/.test(p))

if (offending(['README.md', 'backend/pocketbase/pb_hooks/x.pb.js', 'a/b.pb.ts']).length !== 2) {
  console.error('✗ check:no-repo-pb-hooks self-test failed: the matcher went blind'); process.exit(1)
}
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean)
const bad = offending(tracked)
if (bad.length) {
  console.error(`✗ PocketBase hooks in the repo (server-side JS must never ride the live pull):\n${bad.map((p) => '  ' + p).join('\n')}`)
  console.error('  The team sign-in hook is baked into the image (the repo-root Dockerfile); anything else needs a design review.')
  process.exit(1)
}
console.log(`✓ no PocketBase hooks among ${tracked.length} tracked files`)
