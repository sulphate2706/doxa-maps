#!/usr/bin/env node
/**
 * serve-strict.mjs — serve public/ the way PRODUCTION serves it, not the way it is convenient.
 *
 * ★ THE DEFECT THIS EXISTS FOR, hit live 2026-09-23. `bun run serve` was
 * `python3 -m http.server`, which resolves a DIRECTORY request to its index.html. The live
 * test host's static layer does NOT:
 *
 *     /plugin-assets/doxa-maps/dashboard-plus-grid/dashboard-plus-grid/             -> 404 live, 200 local
 *     /plugin-assets/doxa-maps/dashboard-plus-grid/dashboard-plus-grid/index.html   -> 200 both
 *
 * So every headless verification could pass on a URL that 404s in production, and the divergence
 * was invisible until something was finally checked against the live site. It cost a false
 * "the publish failed, zero filters live" reading on a publish that was byte-for-byte correct.
 *
 * ★ WHY FIX THE SERVER RATHER THAN THE URLS. The repo is already production-correct: the manifest
 * ships 28/28 iframeUrl values ending in /index.html, and the gates use that form 82 times. Only
 * ad-hoc probes and one gate ever used the bare-directory form. So the exposure was never really
 * the URLs — it was that NOTHING LOCAL COULD CATCH a bad one. A local environment MORE PERMISSIVE
 * than production is a blind spot with a green light on it: every defect inside the permissive gap
 * passes locally by construction and can only be found in production, which is the worst place to
 * find it. Making local strict converts that class from "discovered live" to "impossible to commit".
 * A rule you have to REMEMBER fails under time pressure; a server that returns 404 does not.
 *
 * WHAT IT DOES, deliberately minimal:
 *   - serves files under public/ (or --directory) on 127.0.0.1 only;
 *   - a request for a DIRECTORY returns 404, exactly like the live layer — no index fallback,
 *     no redirect-to-index, no directory listing;
 *   - refuses to escape the served root (a .. traversal is 403, not a file read).
 *
 * LOOPBACK ONLY, inherited from the script this replaces: the bind was once 0.0.0.0, which
 * published the built tree on every interface of whatever machine ran a gate — measured answering
 * HTTP 200 on the box's PUBLIC IP while a browser gate was running. Override with HOST only if you
 * deliberately want another host to reach it.
 *
 * Usage: node internal/serve-strict.mjs [--port 4173] [--directory public] [--exit-with-parent]
 *   --exit-with-parent  for a gate that spawns this server: exit once the process that started it is gone.
 *                       A gate that crashes or is refused by the browser-slot guard cannot kill its child, and
 *                       on 2026-09-29 41 such servers had outlived their gates (279 MB, the oldest 5 days).
 *                       Opt-in, so a server someone deliberately left running is never taken down.
 */
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { resolve, join, extname, normalize } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME, TREE_NAME_RE } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }

const PORT = Number(process.env.PORT || argOf('--port', '4173'))
const HOST = process.env.HOST || '127.0.0.1'
const DIR = resolve(ROOT, argOf('--directory', 'public'))
if (argv.includes('--exit-with-parent')) {
  const parent = process.ppid
  setInterval(() => { if (process.ppid !== parent) process.exit(0) }, 2000).unref()
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.geojson': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.csv': 'text/csv; charset=utf-8', '.pbf': 'application/x-protobuf', '.txt': 'text/plain; charset=utf-8',
}

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

// ── REFUSE TO SERVE A TORN TREE (card BUILD-BROWSER-GATES-RACE-THE-BUILD-LOCK) ────────────────
// `bun run clean` rm -rf's public/doxa-maps at the START of every build, so a browser gate running
// during one reads an EMPTY tree and reports a confident wrong diagnosis. Measured: verify-shell-
// scroll said "could not find the dashboard-plus-grid tab" twice in ten minutes while a swarm
// rebuilt underneath it — a phantom failure that reads exactly like a real regression, and cost
// three ticks of this flight.
//
// ★ THE CHECK BELONGS IN THE SERVER, NOT IN EACH GATE. All nine browser gates fetch through here.
// Guarding one chokepoint means none of them can misread a torn tree and none of them needs
// editing — where "have every gate acquire the build lock" is nine changes plus a rule every FUTURE
// gate has to remember. Same reasoning as serving directories strictly: fix the thing they all pass
// through, rather than asking nine callers to be careful.
//
// A 503 is deliberate, not a 404: 404 means "this is not here", which a gate may reasonably report
// as a product defect. 503 with a named cause means "ask again later" and cannot be mistaken for a
// finding. Anything outside the bundle tree is unaffected.
const TREE = join(DIR, TREE_NAME)
const MANIFEST = join(TREE, 'manifest.json')
function treeIsTorn() {
  try { return !statSync(MANIFEST).isFile() } catch { return true }
}

createServer((req, res) => {
  let pathname
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch { return send(res, 400, 'bad request\n') }

  if (pathname.startsWith(`/${TREE_NAME}/`) && treeIsTorn()) {
    return send(res, 503, `tree is mid-build — public/${TREE_NAME}/manifest.json is absent.\n` +
      'A build rm -rf\'s this tree at its start, so anything measured now is a phantom.\n' +
      'Wait for the build to finish and retry; do NOT record this as a product finding.\n',
      { 'retry-after': '30' })
  }

  // Never let a request escape the served root. normalize() collapses .. before we join.
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  const file = join(DIR, rel)
  if (!file.startsWith(DIR)) return send(res, 403, 'forbidden\n')

  let st
  try { st = statSync(file) } catch { return send(res, 404, 'not found\n') }

  // ★ THE WHOLE POINT. A directory is a 404 here because it is a 404 in production. Do not add an
  // index fallback "for convenience" — the convenience is what hid a live defect for a full flight.
  if (st.isDirectory()) {
    return send(res, 404, 'not found — this server does not serve directory indexes, because the live\n' +
      'static layer does not either. Request the file explicitly:\n' +
      '  ' + pathname.replace(/\/*$/, '/') + 'index.html\n')
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': 'no-cache',
    // ★ CORS: the tree is PUBLIC STATIC ASSETS built to be embedded on OTHER sites (the
    // drop-anywhere contract). A cross-origin <script> tag loads fine without this, but the
    // composed surfaces (cap-4/cap-5) then FETCH manifest.json + assets/ -- and fetch()
    // enforces CORS, so on any third-party host the shell mounted and every manifest-composed
    // tab died with 'Could not load ...' (measured 2026-09-24 from a second local origin; the
    // LIVE test host's static layer has the same gap -- carded with the Traefik ready-fix).
    // ACAO:* is the standard for credential-less public assets; production parity is the
    // whole point of this server, so it must teach the same requirement.
    // LIVE_CORS=1 reproduces the LIVE static layer's rule instead (measured on the live test host 2026-09-25):
    // ACAO on every path INSIDE a folder of the tree, NOT on the tree-root manifest.json. Off by
    // default; check:gallery-embed --live-cors uses it to prove the gallery still boots cross-origin
    // under the rule partners actually get.
    ...(process.env.LIVE_CORS === '1' && new RegExp(`^/${TREE_NAME_RE}/manifest\\.json$`).test(pathname) ? {} : { 'access-control-allow-origin': '*' }),
  })
  createReadStream(file).pipe(res)
}).listen(PORT, HOST, () => {
  console.log(`serve-strict: http://${HOST}:${PORT} -> ${DIR.replace(ROOT + '/', '')}`)
  console.log('  directory requests return 404 (matching production). Ask for /index.html explicitly.')
  console.log(`  front page (the Plugin Studio): http://${HOST}:${PORT}/${TREE_NAME}/index.html`)
})
