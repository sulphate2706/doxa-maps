/**
 * dev-server.mjs — the SHARED DEV SERVER every agent can check against (headless: curl-style fetches).
 *
 * One `bun run dev` on this machine follows origin/development (fast-forward, ~30 s) from a checkout that is
 * nobody's worktree, so it shows what a developer running the dev server on development sees. It answers
 * /__dev-sha with the commit it is serving.
 *
 * USE IT FOR: "does development work under the dev server", dev-parity checks, and waiting for a landing
 * to appear. DO NOT use it for an UNLANDED change (it does not have it): start a short-lived dev
 * server in your own worktree, or BUNDLE=<name> bun x vite build. Release/embed checks (SRI, manifest,
 * iframe/script cells) stay on the BUILT tree.
 *
 *   import { url, devSha, waitForSha } from './dev-server.mjs'
 *   await waitForSha('ce42977c')          // resolves once the server serves that commit (or a descendant)
 *   const r = await fetch(url('/assets/boundaries/world-adm0.geojson'))
 *
 * DOXA_DEV_URL overrides the address (default http://127.0.0.1:5190).
 * CLI: node internal/dev-server.mjs [--wait <sha>] [--timeout <s>]   prints the served sha.
 */
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEV_URL = (process.env.DOXA_DEV_URL || 'http://127.0.0.1:5190').replace(/\/+$/, '')
export const url = (path = '/') => DEV_URL + (path.startsWith('/') ? path : '/' + path)

/** The commit the dev server is serving ("<sha>" or "<sha>+dirty"), or '' when it does not answer. */
export async function devSha() {
  try {
    const r = await fetch(url('/__dev-sha'), { signal: AbortSignal.timeout(5000) })
    return r.ok ? (await r.text()).trim() : ''
  } catch { return '' }
}

/** Is `sha` the served commit or one of its ancestors? (Needs `sha` in this clone's object store.) */
function contains(served, sha) {
  const head = served.replace(/\+dirty$/, '')
  if (!head) return false
  if (head.startsWith(sha) || sha.startsWith(head)) return true
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return spawnSync('git', ['merge-base', '--is-ancestor', sha, head], { cwd: ROOT }).status === 0
}

/** Resolve with the served sha once it contains `sha`; reject after `timeoutMs`. */
export async function waitForSha(sha, { timeoutMs = 180000, everyMs = 5000 } = {}) {
  const until = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < until) {
    last = await devSha()
    if (last && contains(last, sha)) return last
    await new Promise((r) => setTimeout(r, everyMs))
  }
  throw new Error(`the shared dev server (${DEV_URL}) did not serve ${sha} within ${Math.round(timeoutMs / 1000)} s (serving ${last || 'nothing'})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--wait'), t = argv.indexOf('--timeout')
  try {
    const got = i >= 0 ? await waitForSha(argv[i + 1], { timeoutMs: (t >= 0 ? Number(argv[t + 1]) : 180) * 1000 }) : await devSha()
    if (!got) { console.log(`DEV-SERVER: ${DEV_URL} does not answer /__dev-sha`); process.exit(75) }
    console.log(`DEV-SERVER: ${DEV_URL} serves ${got}`)
  } catch (e) { console.log(`DEV-SERVER: ${e.message}`); process.exit(1) }
}
