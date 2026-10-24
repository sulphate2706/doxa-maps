// admin.mjs — the container's internal router (127.0.0.1:5175), behind oauth2-proxy.
//   /cdn/*       the last good build (/data/cdn/current), PUBLIC (oauth2-proxy skips auth here)
//   /api-prod/*  PocketBase PROD, PUBLIC; only /api/ passes, never the /_/ dashboard, _superusers or _system collections
//   /pb/*        PocketBase DEV, signed-in; its /_/ dashboard only for OIDC_ADMIN_GROUPS. With PB_OIDC_CLIENT_SECRET,
//                its /api/ is PUBLIC (PocketBase signs people in itself), except _superusers and _system collections
//   /admin/build POST: build PRODUCTION_BRANCH now (OIDC_ADMIN_GROUPS only); /admin/status GET.
//                The public build also follows PRODUCTION_BRANCH by itself (CDN_AUTOBUILD_MINUTES, default 2).
//   SUBDOMAIN_APPS  public subdomain sites for published plugins, on a separate port (see below)
//   /admin/pb-signin-check  a page that signs in to the team PocketBase and shows who it thinks you are
// Groups come from oauth2-proxy's X-Forwarded-Groups, which it sets on signed-in routes only.
import { spawn } from 'node:child_process'
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import { serveTreeFile } from './cdn-cache.mjs'

const env = process.env
const ADMIN = (env.OIDC_ADMIN_GROUPS || '').split(',').map((g) => g.trim()).filter(Boolean)
const CDN = '/data/cdn/current'
let last = { state: 'idle' }

const groupsOf = (req) => (req.headers.get('x-forwarded-groups') || '').split(',').map((g) => g.trim())
// ACCESS=public (entry.sh): the Plugin Studio is open and nobody signs in, so X-Forwarded-Groups is whatever a
// visitor sends and is never read. The admin parts (/admin/, PocketBase's dashboard, _superusers) ask for
// ADMIN_USER / ADMIN_PASSWORD over HTTP Basic instead, compared in constant time.
const PUBLIC = env.ACCESS === 'public'
const ADMIN_USER = env.ADMIN_USER || 'admin'
const same = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
function passwordOk(req) {
  const h = req.headers.get('authorization') || ''
  if (!env.ADMIN_PASSWORD || !h.startsWith('Basic ')) return false
  const [user, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':')
  const userOk = same(user, ADMIN_USER), passOk = same(rest.join(':'), env.ADMIN_PASSWORD)
  return userOk && passOk
}
const isAdmin = (req) => (PUBLIC ? passwordOk(req) : ADMIN.length > 0 && groupsOf(req).some((g) => ADMIN.includes(g)))
const text = (s, status = 200) => new Response(s + '\n', { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
// Refusing an admin part: in public mode a 401 that makes the browser ask for the password; with the sign-in, 403.
const refuse = (msg) => (PUBLIC
  ? new Response(msg + '\n', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8', 'www-authenticate': 'Basic realm="dx-maps admin", charset="UTF-8"' } })
  : text(msg, 403))

// fetch() hands back the body DECOMPRESSED, so the upstream Content-Encoding and Content-Length no longer describe
// what is sent on: forwarding them made browsers try to gunzip plain HTML, and PocketBase's dashboard never rendered
// (measured 2026-09-29). And PocketBase redirects to its own root (/_ -> /_/), which is put back under the mount (/pb/_/).
// A backend path as the backend will read it: percent-decoded, runs of slashes collapsed. The admin gates run on
// THIS form, so /pb/%5F/ (PocketBase decodes it to /_/) meets the same check as /pb/_/ (studio, 2026-09-29).
// Encoded slashes or backslashes and undecodable input are refused: nothing legitimate sends them.
function backendPath(p) {
  if (/%2f|%5c/i.test(p) || p.includes('\\')) return null
  try { return decodeURIComponent(p).replace(/\/{2,}/g, '/') } catch { return null }
}

async function proxy(req, url, prefix, port) {
  // The path goes onto a FIXED origin and is never parsed as a URL itself: /pb//evil.example/x made a
  // protocol-relative URL, and the proxy fetched another host with the visitor's headers (studio, 2026-09-29).
  const rest = url.pathname.slice(prefix.length - 1)
  if (!rest.startsWith('/') || rest.startsWith('//') || backendPath(rest) === null) return text('bad path', 400)
  const target = new URL(`http://127.0.0.1:${port}`)
  target.pathname = rest
  target.search = url.search
  const r = await fetch(target, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body, redirect: 'manual' })
  const headers = new Headers(r.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  const loc = headers.get('location')
  if (loc) {
    const mount = prefix.slice(0, -1) // '/pb/' -> '/pb'
    const upstream = `http://127.0.0.1:${port}`
    const path = loc.startsWith(upstream) ? loc.slice(upstream.length) || '/' : loc
    if (path.startsWith('/') && !path.startsWith('//') && !path.startsWith(`${mount}/`)) headers.set('location', mount + path)
  }
  return new Response(r.body, { status: r.status, headers })
}

// One public build at a time (build-cdn.sh also holds a lock), started by an admin or by the watcher below.
function startBuild(by) {
  last = { state: 'building', by, branch: PROD, started: new Date().toISOString() }
  const child = spawn('bash', ['/app/repo/deployment/cloud/build-cdn.sh'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (d) => { log = (log + d).slice(-4000) })
  child.stderr.on('data', (d) => { log = (log + d).slice(-4000) })
  child.on('exit', (code) => {
    last = { state: code === 0 ? 'done' : code === 75 ? 'busy' : 'failed', by, branch: PROD, code, finished: new Date().toISOString(), tail: log.slice(-1500),
      commit: publishedCommit() }
  })
}
const publishedCommit = () => (existsSync('/data/cdn/COMMIT') ? readFileSync('/data/cdn/COMMIT', 'utf8').trim() : null)
// The production PocketBase's schema: the snapshot its migrations came from (pb-prod-migrations.sh), or 'empty'.
const prodSchema = () => { try { return basename(realpathSync('/data/pb-prod-migrations/current')) } catch { return null } }

// AUTO-BUILD: the public build follows PRODUCTION_BRANCH by itself (default main). The dev server follows
// BRANCH, the shared table; main moves only on a publish, so rebuilding on every move is the point. Debounced: build once the branch has held the same commit for CDN_AUTOBUILD_MINUTES
// (default 2; 0 = off, admin button only). A commit whose build failed is not retried automatically.
const PROD = env.PRODUCTION_BRANCH || 'main'
const AUTO_MIN = env.CDN_AUTOBUILD_MINUTES === undefined || env.CDN_AUTOBUILD_MINUTES === '' ? 2 : Number(env.CDN_AUTOBUILD_MINUTES)
const watch = { seen: null, since: 0, failed: null, error: null }
async function checkProduction() {
  const r = Bun.spawnSync(['git', '-C', '/app/repo', 'ls-remote', 'origin', `refs/heads/${PROD}`], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  const sha = r.success ? String(r.stdout).split(/\s/)[0] : ''
  watch.error = sha ? null : `cannot read branch '${PROD}' on origin`
  if (!sha) return
  if (sha !== watch.seen) { watch.seen = sha; watch.since = Date.now() }
  const published = publishedCommit()
  if (published && sha.startsWith(published)) return
  if (last.state === 'building' || watch.failed === sha) return
  if (Date.now() - watch.since < AUTO_MIN * 60000) return
  startBuild('auto')
  const poll = setInterval(() => { if (last.state !== 'building') { clearInterval(poll); if (last.state === 'failed') watch.failed = sha } }, 5000)
}
if (AUTO_MIN > 0) {
  setInterval(() => checkProduction().catch(() => {}), 30000)
  console.log(`[admin] public build follows ${PROD}, ${AUTO_MIN} min after it moves`)
}

// SUBDOMAIN APPS: a published plugin as its own public site, e.g. research-gallery.<domain> → the /cdn build
// of doxa-maps-spa. SUBDOMAIN_APPS = "host=bundle/profile,host2=bundle/profile". A SEPARATE server on its own
// port, reached by the proxy only for those hosts: it serves the published /cdn files and nothing else (no
// admin, no PocketBase, no dev server), so no sign-in is skipped anywhere else. "/" is the plugin's page with a
// <base href> at its real folder, so its relative links resolve exactly as they do on /cdn.
const SUBDOMAINS = Object.fromEntries((env.SUBDOMAIN_APPS || '').split(',').map((x) => x.trim()).filter(Boolean)
  .map((x) => x.split('=').map((y) => y.trim())).filter(([h, t]) => h && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(t || '')))
if (Object.keys(SUBDOMAINS).length) {
  Bun.serve({
    hostname: '0.0.0.0',
    port: Number(env.SUBDOMAIN_PORT || 5176),
    idleTimeout: 0,
    async fetch(req) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return text('read-only', 405)
      const target = SUBDOMAINS[(req.headers.get('host') || '').split(':')[0].toLowerCase()]
      if (!target) return text('not found', 404)
      const url = new URL(req.url)
      const headers = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300, stale-while-revalidate=86400' }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const leaf = join(CDN, 'dx-maps', target, 'index.html')
        if (!existsSync(leaf)) return text('this app is not published yet', 503)
        const html = readFileSync(leaf, 'utf8').replace(/<head([^>]*)>/i, `<head$1><base href="/dx-maps/${target}/">`)
        return new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } })
      }
      // /embed-test: every web plugin in this host's tree, embedded as JavaScript (deployment/cloud/embed-test.html,
      // read per request from the pulled checkout, so the page follows the branch without a restart).
      if (url.pathname === '/embed-test' || url.pathname === '/embed-test/') {
        const page = '/app/repo/deployment/cloud/embed-test.html'
        if (!existsSync(page)) return text('not found', 404)
        return new Response(readFileSync(page, 'utf8'), { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } })
      }
      const f = normalize(join(CDN, decodeURIComponent(url.pathname)))
      if (!f.startsWith(CDN + '/dx-maps/')) return text('not found', 404)
      const file = existsSync(f) && statSync(f).isDirectory() ? join(f, 'index.html') : f
      if (!existsSync(file)) return text('not found', 404)
      // cache by what the file is (cdn-cache.mjs): moving URLs revalidate in 5 min, with an ETag + 304
      return serveTreeFile(req, file, file.slice(CDN.length), { 'access-control-allow-origin': '*' })
    },
  })
  console.log(`[admin] subdomain apps: ${Object.entries(SUBDOMAINS).map(([h, t]) => `${h} → ${t}`).join(', ')}`)
}

Bun.serve({
  hostname: '127.0.0.1',
  port: 5175,
  // No idle cut-off: PocketBase's realtime stream (/pb/api/realtime) sits quiet while someone signs in in the
  // popup, and Bun's default (10 s) closed it before the sign-in result could arrive.
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url)
    const p = url.pathname
    // DEV_SERVER=off: there is no Plugin Studio at /, so send people to the public build.
    if (p === '/' && env.DEV_SERVER === 'off') return Response.redirect(new URL('/cdn/', url), 302)
    if (p.startsWith('/cdn/')) {
      const f = normalize(join(CDN, decodeURIComponent(p.slice(5))))
      if (!f.startsWith(CDN)) return text('bad path', 400)
      const file = existsSync(f) && statSync(f).isDirectory() ? join(f, 'index.html') : f
      if (!existsSync(file)) return text('not found', 404)
      // Was one day + a week's stale-while-revalidate for everything, with no ETag, so a publish took days to
      // reach a browser. Now by what the file is (cdn-cache.mjs), with an ETag and 304s.
      return serveTreeFile(req, file, file.slice(CDN.length), { 'access-control-allow-origin': '*' })
    }
    if (p.startsWith('/api-prod/')) {
      const bp = backendPath(p)
      if (bp === null) return text('bad path', 400)
      if (!p.startsWith('/api-prod/api/') || !bp.startsWith('/api-prod/api/')) return text('only /api/ is public', 403)
      // As on /pb: the superuser and every _system collection stay closed. No public client uses them (a platform security review).
      if (bp.startsWith('/api-prod/api/collections/_')) return text('for admins only', 403)
      return proxy(req, url, '/api-prod/', 8091)
    }
    if (p.startsWith('/pb/')) {
      const bp = backendPath(p)
      if (bp === null) return text('bad path', 400)
      if ((bp === '/pb/_' || bp.startsWith('/pb/_/')) && !isAdmin(req)) return refuse('the PocketBase dashboard is for admins')
      // The superuser (and every _system collection) is for admins only. oauth2-proxy never opens these
      // paths to the public (its skip routes exclude names starting with _), so the groups header is its own.
      if (bp.startsWith('/pb/api/collections/_') && !isAdmin(req)) return refuse('for admins only')
      return proxy(req, url, '/pb/', 8090)
    }
    // With the sign-in, oauth2-proxy guards every /admin/ path; in public mode the admin password does.
    if (PUBLIC && p.startsWith('/admin/') && !isAdmin(req)) return refuse('the admin pages ask for the admin password')
    // A one-click check of the team PocketBase sign-in (behind the site sign-in like every /admin/ path).
    if (p === '/admin/pb-signin-check') return new Response(Bun.file('/app/repo/deployment/cloud/pb-signin-check.html'), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    if (p === '/admin/status') return Response.json({ ...last, production: { branch: PROD, autoBuildMinutes: AUTO_MIN, head: watch.seen, published: publishedCommit(), prodSchema: prodSchema(), error: watch.error } })
    if (p === '/admin/build') {
      if (req.method !== 'POST') return text('POST only', 405)
      if (!isAdmin(req)) return refuse('builds are for team admins')
      if (last.state === 'building') return text('a build is already running', 409)
      startBuild('admin')
      return text('build started', 202)
    }
    return text('not found', 404)
  },
})
console.log('[admin] listening on 127.0.0.1:5175')
