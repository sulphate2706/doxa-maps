// cdn-cache.mjs — how the container serves a file from the published tree (/cdn/… and the subdomain apps).
// "Publish once, updates everywhere" needs browsers to notice a publish within minutes, so:
//   MOVING  — URLs whose bytes change on a publish under the same name (manifest.json, runtime-config.js,
//             every HTML page, the bundles' entry scripts, COMMIT): max-age=300, then revalidate.
//   HASHED  — a content hash in the file name (name-3f9a1c2b.js, name.3f9a1c2b.css): the bytes never change
//             under that name, so a year + immutable. (The tree has none today; the rule is ready for them.)
//   DATA    — everything else (tables, boundaries, previews, fonts, vendor): max-age=3600, then revalidate.
// Every response carries an ETag (size + mtime; each publish writes a new build folder, so it changes on
// publish), and a matching If-None-Match gets a 304 with no body.
import { statSync } from 'node:fs'

const HASHED = /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i
const MOVING = /(^|\/)(manifest\.json|runtime-config\.js|COMMIT|[^/]+\.html?)$/i

export function cacheClass(relPath) {
  const p = relPath.replace(/^\/+/, '')
  if (HASHED.test(p)) return 'hashed'
  if (MOVING.test(p)) return 'moving'
  // a bundle's entry script sits beside its folder name: <bundle>/<bundle>.js (and its .css)
  const m = p.match(/(?:^|\/)([^/]+)\/\1\.(js|css)$/)
  if (m) return 'moving'
  return 'data'
}

export const CACHE_CONTROL = {
  moving: 'public, max-age=300',
  hashed: 'public, max-age=31536000, immutable',
  data: 'public, max-age=3600',
}

export function etagFor(file) {
  const s = statSync(file)
  return `"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`
}

// Serves `file` (already resolved and checked to exist) for `req`; relPath is the path inside the tree.
export function serveTreeFile(req, file, relPath, baseHeaders = {}) {
  const etag = etagFor(file)
  const headers = { ...baseHeaders, 'cache-control': CACHE_CONTROL[cacheClass(relPath)], etag }
  const inm = req.headers.get('if-none-match')
  if (inm && inm.split(',').map((t) => t.trim().replace(/^W\//, '')).includes(etag)) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(Bun.file(file), { headers })
}
