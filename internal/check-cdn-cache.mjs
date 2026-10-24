// check-cdn-cache.mjs — the container's /cdn cache rules (deployment/cloud/cdn-cache.mjs), measured over real HTTP.
// Serves a throwaway tree with the SAME function admin.mjs uses and checks, per kind of URL:
//   moving (manifest.json, an index page, a bundle's entry script) → max-age=300 + ETag, and a 304 on If-None-Match;
//   hashed (a content hash in the name) → a year + immutable;  data (a table, a font) → max-age=3600 + ETag;
//   a changed file (a new publish) → a NEW ETag, so a stale If-None-Match gets 200 with the new bytes.
// Run: bun internal/check-cdn-cache.mjs   (exit 1 on any failure)
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serveTreeFile, cacheClass } from '../deployment/cloud/cdn-cache.mjs'

const root = mkdtempSync(join(tmpdir(), 'cdn-cache-'))
const put = (rel, body) => { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, body); return f }
put('dx-maps/manifest.json', '{"bundles":[]}')
put('dx-maps/doxa-simple-map/doxa-simple-map.js', 'console.log(1)')
put('dx-maps/doxa-simple-map/simple/index.html', '<!doctype html>')
put('dx-maps/assets/tables/countries.json', '[]')
put('dx-maps/assets/fonts/oswald-400.woff2', 'font')
put('dx-maps/assets/chunk-3f9a1c2b.js', 'x')

const server = Bun.serve({ port: 0, fetch(req) {
  const rel = decodeURIComponent(new URL(req.url).pathname)
  return serveTreeFile(req, join(root, rel), rel, { 'access-control-allow-origin': '*' })
} })
const base = `http://127.0.0.1:${server.port}`
const fails = []
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg) }

const CASES = [
  ['/dx-maps/manifest.json', 'moving', 'public, max-age=300'],
  ['/dx-maps/doxa-simple-map/doxa-simple-map.js', 'moving', 'public, max-age=300'],
  ['/dx-maps/doxa-simple-map/simple/index.html', 'moving', 'public, max-age=300'],
  ['/dx-maps/assets/tables/countries.json', 'data', 'public, max-age=3600'],
  ['/dx-maps/assets/fonts/oswald-400.woff2', 'data', 'public, max-age=3600'],
  ['/dx-maps/assets/chunk-3f9a1c2b.js', 'hashed', 'public, max-age=31536000, immutable'],
]
for (const [path, cls, cc] of CASES) {
  expect(cacheClass(path) === cls, `${path} is ${cls}`)
  const r = await fetch(base + path)
  const etag = r.headers.get('etag')
  expect(r.status === 200 && r.headers.get('cache-control') === cc, `${path} → 200, cache-control "${cc}" (got ${r.status}, "${r.headers.get('cache-control')}")`)
  expect(!!etag && r.headers.get('access-control-allow-origin') === '*', `${path} carries an ETag and CORS`)
  const r2 = await fetch(base + path, { headers: { 'if-none-match': etag } })
  expect(r2.status === 304 && (await r2.text()) === '', `${path} with If-None-Match → 304, empty body (got ${r2.status})`)
}

// a publish rewrites the file: the ETag changes, so a browser holding the old one gets the new bytes
const m = '/dx-maps/manifest.json'
const old = (await fetch(base + m)).headers.get('etag')
const f = put('dx-maps/manifest.json', '{"bundles":[{"bundle":"new"}]}')
utimesSync(f, new Date(), new Date(Date.now() + 5000))
const after = await fetch(base + m, { headers: { 'if-none-match': old } })
expect(after.status === 200 && after.headers.get('etag') !== old && (await after.text()).includes('new'), 'after a publish, the old ETag gets 200 + the new bytes')

server.stop(true)
rmSync(root, { recursive: true, force: true })
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1) }
console.log('\nall cdn cache rules hold')
