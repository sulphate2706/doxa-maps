/**
 * _serves-this-tree.mjs — a browser gate must prove the server it talks to is THIS build.
 *
 * THE FAILURE THIS EXISTS FOR, MEASURED. Browser gates here default to
 * http://127.0.0.1:4173 and adopt whatever answers 200 on it. On this machine that port was
 * held by an unrelated process belonging to a different worktree, and the gospel-resources
 * gate spent three runs reporting on a build that was not the one on disk — first a PASS,
 * then a mount timeout that looked exactly like a regression in code that had nothing to do
 * with it. A gate that can report on the wrong tree is worse than no gate: it produces
 * confident findings about code nobody changed, and hides real ones.
 *
 * "Answers 200" and "is serving this checkout" are different questions. This asks the second.
 *
 * THE FINGERPRINT is public/<TREE_NAME>/manifest.json, which generate-tree rewrites on every
 * build and which names every bundle and profile in the tree. If the bytes served differ
 * from the bytes on disk, it is a different build — a different worktree, or a stale server
 * someone forgot to restart, both of which produce the same lie.
 *
 * Deliberately NOT fatal on its own: the caller decides whether to start its own server
 * instead, or to skip. What it must never do is quietly continue.
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { TREE_NAME, TREE_NAME_RE } from './_tree-name.mjs'

const MANIFEST = `${TREE_NAME}/manifest.json`

/**
 * @param {string} base  e.g. http://127.0.0.1:4173 (a trailing /<TREE_NAME>/ is tolerated)
 * @param {string} repo  absolute path to the repo root
 * @param {{assets?: string[]}} [opts]  data files this gate JUDGES (tree-relative, e.g.
 *        'assets/tables/doxa-gospel-access.json'); their served bytes must equal disk too
 * @returns {Promise<{ok:boolean, why:string}>}
 */
export async function servesThisTree(base, repo, { assets = [] } = {}) {
  let local
  try {
    local = createHash('sha256').update(readFileSync(resolve(repo, 'public', MANIFEST))).digest('hex')
  } catch {
    return { ok: false, why: `no local public/${MANIFEST} to compare against — build the tree first` }
  }
  const root = String(base).replace(/\/+$/, '').replace(new RegExp(`/${TREE_NAME_RE}$`), '')
  const r = await fetch(`${root}/${MANIFEST}`).catch(() => null)
  if (!r || !r.ok) return { ok: false, why: `nothing serving ${MANIFEST} at ${root}` }
  const served = createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')
  if (served !== local) {
    return { ok: false, why: `${root} serves a DIFFERENT build than public/ — another worktree, or a server that needs restarting` }
  }
  // ★ THE MANIFEST DESCRIBES BUNDLES, NOT DATA. MEASURED 2026-09-25 (gospel): verify:gospel-map adopted
  // another worktree's server on :4173 and reported PASS — the three worktrees' manifests were
  // byte-identical because the change under test was a DATA asset (doxa-gospel-access.json), which the
  // manifest never mentions; a planted jw.org link went undetected. So a gate whose subject is a data
  // file DECLARES it (paths relative to the tree, e.g. 'assets/tables/doxa-gospel-access.json') and its
  // served bytes are compared with disk too. Any difference is a different tree for THIS gate.
  for (const rel of assets) {
    let disk
    try { disk = readFileSync(resolve(repo, 'public', TREE_NAME, rel)) } catch {
      return { ok: false, why: `no local public/${TREE_NAME}/${rel} to compare against — build the tree first` }
    }
    const a = await fetch(`${root}/${TREE_NAME}/${rel}`).catch(() => null)
    if (!a || !a.ok) return { ok: false, why: `${root} serves a DIFFERENT build — ${rel} is not served there (${a ? a.status : 'no answer'})` }
    const got = Buffer.from(await a.arrayBuffer())
    if (!got.equals(disk)) {
      return { ok: false, why: `${root} serves a DIFFERENT build — the manifest matches but ${rel} does not (another worktree's data, or a stale server)` }
    }
  }
  return { ok: true, why: assets.length ? `same build, and ${assets.length} declared data file(s) byte-identical` : 'same build' }
}


/**
 * Start a short-lived static server over THIS checkout, so a gate whose default port belongs
 * to another worktree can still MEASURE instead of skipping.
 *
 * Skipping was the honest thing to do once the mismatch was visible, but a gate that skips on
 * every wave is a gate nobody is running: check:provider-switch and check:packet-browser both
 * went quiet the moment the guard landed, because their default ports (4173, 4898) are held by
 * other worktrees on this box. Serving our own tree costs a few hundred milliseconds and gives
 * the gate the one thing it needs — a server it can prove is this build.
 *
 * @param {string} dir  absolute directory to serve (public/, or the repo root)
 * @returns {Promise<{origin:string, stop:() => void}|null>}  null when no server could be started
 */
export async function serveThisTree(dir) {
  const { spawn } = await import('node:child_process')
  for (let attempt = 0; attempt < 5; attempt++) {
    // An ephemeral high port, re-rolled on collision — two agents doing this at once must not
    // fight over one number.
    const port = 20000 + Math.floor(Math.random() * 20000)
    const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir],
      { stdio: 'ignore', detached: false })
    const origin = `http://127.0.0.1:${port}`
    let up = false
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 100))
      up = await fetch(origin + '/', { signal: AbortSignal.timeout(500) }).then((r) => r.ok).catch(() => false)
    }
    if (up) {
      // unref so a caller that forgets to stop() still exits — a gate that hangs on its own
      // helper is a worse failure than the one it was written to catch.
      child.unref()
      return { origin, stop: () => { try { child.kill() } catch { /* already gone */ } } }
    }
    try { child.kill() } catch { /* nothing to kill */ }
  }
  return null
}

/**
 * The same check, as a one-liner a gate can put right after it resolves its base URL.
 *
 * ★ EXIT 75, NOT 1. A gate pointed at another worktree's server has NOT MEASURED this build — it
 * has not found a defect in it. flock uses 75 for the same idea (EX_TEMPFAIL) and the wave runner
 * already reports 75 as ⊘ rather than ✗, so one code means "not measured" everywhere in this repo.
 * Exiting 1 here would turn a mis-pointed probe into a red product gate, which is the failure this
 * whole family of checks exists to prevent.
 *
 * @param {string} base   origin (or any URL on it) that should serve public/
 * @param {string} repo   absolute path to the repo root
 * @param {string} label  the gate's own name, for the message
 */
export async function requireThisTree(base, repo, label, { assets = [] } = {}) {
  let origin = String(base || '')
  // A gate that loads file:// URLs is reading THIS checkout by construction — there is no server to
  // be wrong about, so the guard stays silent rather than inventing a precondition.
  if (!/^https?:/i.test(origin)) return { ok: true, why: 'not an http target' }
  // ★ ONLY LOCAL SERVERS. The defect this guards is several worktrees sharing one machine's ports.
  // A gate aimed at a DEPLOYED site (verify-map-paint defaults to the live host) is asking a
  // different question on purpose — "does production match what we built" is a deploy check, not a
  // mis-pointed probe — and enforcing local identity there would make it permanently unmeasured.
  // MEASURED while rolling this out: that gate reported NOT MEASURED against the live site, which
  // is the guard being wrong rather than the gate.
  try {
    const host = new URL(origin).hostname
    if (!/^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$)/.test(host)) return { ok: true, why: 'remote target, not a worktree port' }
  } catch { /* unparseable — fall through to the content check */ }
  try { origin = new URL(origin).origin } catch { /* already an origin, or unusable — pass through */ }
  const verdict = await servesThisTree(origin, repo, { assets })
  if (/DIFFERENT build/.test(verdict.why)) {
    console.log(`${label}: NOT MEASURED — ${verdict.why}`)
    console.log('  Point this gate at a server for THIS checkout (bun run serve) and re-run.')
    process.exit(75)
  }
  return verdict
}


/**
 * The same guard for gates that READ A CHECKOUT instead of talking to a server.
 *
 * check-tabs-localized and check-poster-prints read library/ source from DOXA_REPO, which exists
 * so a gate can be pointed at ANOTHER repo on purpose. That is also exactly how a leaked env var
 * from someone else's shell makes a gate grade their tree while reporting as ours. So pointing
 * elsewhere is an explicit opt-in (DOXA_REPO_MEASURE_OTHER=1); without it the gate exits 75.
 *
 * @param {string} repoPath  the checkout the gate is about to read
 * @param {string} repo      this gate's own repo root
 * @param {string} label     the gate's name, for the message
 */
export function requireThisRepo(repoPath, repo, label) {
  const real = (p) => { try { return realpathSync(p) } catch { return String(p) } }
  if (real(repoPath) === real(repo)) return { ok: true, why: 'this checkout' }
  if (process.env.DOXA_REPO_MEASURE_OTHER === '1') {
    console.log(`${label}: measuring ANOTHER checkout on purpose (DOXA_REPO_MEASURE_OTHER=1): ${repoPath}`)
    return { ok: true, why: 'explicit opt-in' }
  }
  console.log(`${label}: NOT MEASURED — DOXA_REPO points at ${repoPath}, not this checkout (${repo}).`)
  console.log('  Unset DOXA_REPO, or set DOXA_REPO_MEASURE_OTHER=1 if measuring that checkout is the intent.')
  process.exit(75)
}

/**
 * For a gate handed a FILE to render: refuse a file that lives inside a DIFFERENT git checkout.
 * A file outside any checkout (a /tmp or _qa-cycle output) cannot be attributed and is allowed,
 * with a note; one inside another worktree is that worktree's build, not ours.
 */
export function requirePathInThisCheckout(file, repo, label) {
  const real = (p) => { try { return realpathSync(p) } catch { return String(p) } }
  let dir = dirname(real(file))
  while (dir && dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) {
      if (real(dir) === real(repo)) return { ok: true, why: 'inside this checkout' }
      console.log(`${label}: NOT MEASURED — ${file} belongs to another checkout (${dir}), not this one (${repo}).`)
      process.exit(75)
    }
    dir = dirname(dir)
  }
  console.log(`${label}: note — ${file} is outside any checkout, so which build produced it cannot be checked.`)
  return { ok: true, why: 'outside any checkout' }
}


/**
 * The same guard for gates aimed at a VITE DEV SERVER, which has no built manifest to fingerprint.
 *
 * A dev server serves this repo's SOURCE, so identity is the source itself: ask it for a few of this
 * checkout's library files with Vite's `?raw` query (the file's exact text, as an ES module string)
 * and compare byte for byte. A dev server rooted in another worktree with different code answers
 * differently, or 403s the path — either way it is NOT MEASURED (exit 75). One serving identical code
 * is, by definition, measuring the same thing. Unreachable is left to the gate's own handling.
 * Remote (non-loopback) targets are not checked, as in requireThisTree.
 */
const DEV_FINGERPRINT = ['library/layouts/VerticalTabsLayout.vue', 'library/composables/useMapInstance.js', 'library/composables/useShadowStyles.js']
export async function requireDevServesThisCheckout(base, repo, label, files = DEV_FINGERPRINT) {
  let origin
  try { origin = new URL(String(base)).origin } catch { return { ok: true, why: 'not a URL' } }
  if (!/^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$)/.test(new URL(origin).hostname)) return { ok: true, why: 'remote target' }
  const refuse = (why) => {
    console.log(`${label}: NOT MEASURED — the dev server at ${origin} is not serving THIS checkout's source (${why}).`)
    console.log('  Start `bun x vite --port <yours> --strictPort` in this worktree and pass that URL.')
    process.exit(75)
  }
  for (const rel of files) {
    let local
    try { local = readFileSync(resolve(repo, rel), 'utf8') } catch { continue }
    const r = await fetch(`${origin}/${rel}?raw`, { signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (!r) return { ok: false, why: 'unreachable' }
    if (!r.ok) refuse(`${rel} → HTTP ${r.status}`)
    // A plain fetch (not a module import) gets the file's TEXT served directly; an import-style
    // request gets it wrapped as `export default "…"`. Accept both shapes — the first version only
    // parsed the wrapped one and refused this very checkout's own dev server (measured 2026-09-25).
    const body = await r.text()
    const m = body.match(/^export default ("(?:[^"\\]|\\.)*")/s)
    let served = body
    if (m) { try { served = JSON.parse(m[1]) } catch { served = null } }
    if (served !== local) refuse(`${rel} differs`)
  }
  return { ok: true, why: 'same source' }
}
