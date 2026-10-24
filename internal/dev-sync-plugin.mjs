/**
 * internal/dev-sync-plugin.mjs — `bun run dev` follows a shared branch, so a laptop sees teammates' landings.
 *
 * WHY: ten people each running `bun run dev` should see what the others landed on development without anyone
 * typing `git pull`: the dev server fast-forwards and Vite hot-reloads the changed files. It is the local
 * form of the cloud container's pull loop (deployment/cloud/entry.sh), MINUS the `reset --hard`: a laptop
 * holds someone's unsaved work, so this NEVER merges over local edits, never stashes, never resets.
 *
 * OPT-IN, ONE switch in .env.local: DX_SYNC_REMOTE = a remote name (origin) OR a repo URL (https://…/x.git),
 * e.g. to watch what cloud agents push. DX_SYNC_BRANCH defaults to development (the shared table; main is
 * production and moves only on a publish), DX_SYNC_INTERVAL to 5 seconds.
 * Unset = off: plain hot reload of local edits, as always. Every interval it fetches <remote> <branch>
 * (a URL needs no `git remote add`; private repos use your normal git credentials) and fast-forwards ONLY when
 * this checkout is on that branch, no tracked file is modified, and `git merge --ff-only` agrees.
 * Otherwise it logs once per new upstream commit ("development is N commits ahead, pull when ready") and reports
 * the state at /api/dev-sync for a Studio badge.
 *
 * DEV ONLY (`apply: 'serve'`).
 */
import { execFile } from 'node:child_process'

const git = (root, args) => new Promise((ok) => execFile('git', args,
  { cwd: root, timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
  (e, out, err) => {
    const all = String(err || e?.message || '').trim()
    ok({ ok: !e, out: String(out || '').trim(), err: all.split('\n')[0], errAll: all })
  }))

// A fetch refused for want of CREDENTIALS is not a network blip: it fails identically every interval until
// this laptop can read the repo. git runs with GIT_TERMINAL_PROMPT=0 (a prompt would hang the dev server), so
// with no credential helper it can only fail, and a bare "fetch-failed / remote: Unauthorized" read as a
// broken server. Measured on a fresh clone: the same fetch succeeded once credentials were supplied.
const AUTH_RE = /unauthori[sz]ed|authentication failed|could not read (username|password)|terminal prompts disabled|permission denied \(publickey|\b40[13]\b/i

// What the log and /api/dev-sync show: never the credentials of a https://user:token@host/… URL.
const shown = (remote) => remote.replace(/\/\/[^/@]*@/, '//')
const label = (remote, branch) => (remote.includes('/') ? `${branch} of ${shown(remote)}` : `${remote}/${branch}`)

// One timer per `bun run dev`, kept across Vite's own restarts (the config module is re-imported then).
const REG = (globalThis.__dxDevSync ||= { timer: null, running: false, status: { enabled: false } })

export async function syncOnce(root, remote, branch, log = { info() {}, warn() {} }) {
  if (REG.running) return REG.status
  REG.running = true
  try {
    const src = label(remote, branch)
    const s = { enabled: true, remote: shown(remote), branch, checkedAt: new Date().toISOString() }
    const f = await git(root, ['fetch', '-q', remote, branch])
    if (!f.ok) {
      const auth = AUTH_RE.test(f.errAll)
      const state = auth ? 'needs-credentials' : 'fetch-failed'
      const message = auth
        ? `dev-sync needs git credentials for ${shown(remote)} (a credential helper, or an SSH remote your key can read); git said: ${shown(f.err)}`
        : `could not fetch ${src}: ${shown(f.err)}`
      if (REG.status.state !== state || REG.status.message !== message) log.warn(`[dev-sync] ${message}`)
      return (REG.status = { ...s, state, message })
    }
    const up = (await git(root, ['rev-parse', 'FETCH_HEAD'])).out
    const head = (await git(root, ['rev-parse', 'HEAD'])).out
    const cur = (await git(root, ['symbolic-ref', '-q', '--short', 'HEAD'])).out
    const behind = Number((await git(root, ['rev-list', '--count', `HEAD..${up}`])).out || 0)
    const ahead = Number((await git(root, ['rev-list', '--count', `${up}..HEAD`])).out || 0)
    const dirty = (await git(root, ['status', '--porcelain', '--untracked-files=no'])).out !== ''
    Object.assign(s, { upstream: up, behind, ahead, dirty, currentBranch: cur || '(detached)' })
    if (behind === 0) return (REG.status = { ...s, state: 'up-to-date', message: `up to date with ${src}` })
    const why = cur !== branch ? `this checkout is on ${cur || 'a detached HEAD'}, not ${branch}`
      : dirty ? 'you have local edits'
      : ahead ? `you have ${ahead} local commit(s) that are not on ${src}` : ''
    const m = why ? null : await git(root, ['merge', '--ff-only', '-q', up])
    if (why || !m.ok) {
      const message = `${branch} is ${behind} commit(s) ahead; ${why || `fast-forward refused (${m.err})`}, so nothing was merged. Pull when ready.`
      if (REG.status.upstream !== up || REG.status.state !== 'behind') log.warn(`[dev-sync] ${message}`)
      return (REG.status = { ...s, state: 'behind', message })
    }
    log.info(`[dev-sync] fast-forwarded ${head.slice(0, 8)} → ${up.slice(0, 8)} (${behind} commit(s) from ${src})`)
    return (REG.status = { ...s, behind: 0, state: 'up-to-date', lastMerge: s.checkedAt, message: `fast-forwarded ${behind} commit(s) from ${src}` })
  } finally {
    REG.running = false
  }
}

export function devSyncPlugin(root, env = process.env) {
  const remote = env.DX_SYNC_REMOTE || ''
  const branch = env.DX_SYNC_BRANCH || 'development'
  const every = Math.max(2, Number(env.DX_SYNC_INTERVAL) || 5)
  return {
    name: 'dx-dev-sync',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/dev-sync', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(REG.status))
      })
      clearInterval(REG.timer)
      if (!remote) {
        REG.status = { enabled: false, message: 'off: set DX_SYNC_REMOTE (a remote name like origin, or a repo URL) in .env.local to follow a shared branch' }
        return
      }
      const log = server.config.logger
      log.info(`[dev-sync] following ${label(remote, branch)} every ${every}s (fast-forward only, never over local edits)`)
      const tick = () => syncOnce(root, remote, branch, log)
      REG.timer = setInterval(tick, every * 1000)
      REG.timer.unref?.()
      tick()
    },
  }
}
