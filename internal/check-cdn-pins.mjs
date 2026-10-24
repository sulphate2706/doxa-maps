#!/usr/bin/env node
/**
 * check-cdn-pins — every runtime third-party script/stylesheet is an EXACT version with an integrity hash.
 *
 * CRITIC-5 (2026-09-26): maplibre-gl@5 and maplibre-gl-geocoder@1 were floating ranges, and no runtime
 * loader set `integrity`, so a CDN could serve any bytes to every partner's visitors unnoticed.
 * library/constants/cdn.js is now the one registry; loaders set integrity + crossorigin from it.
 *
 * OFFLINE (default, in gates:post): in shipped code (library/, plugin-designs/ except scripts/,
 *   internal/generate-tree.mjs) no jsDelivr/unpkg/esm.sh/api.mapbox.com JS or CSS URL is a floating
 *   range (@7, @1.2, latest), and every such URL is either in the registry or on the reviewed list below.
 * --online: also re-fetches every registry URL and requires its sha384 to equal the pinned hash.
 * EXIT 0 pass · 1 fail · 75 (online) network unavailable
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CDN } from '../library/constants/cdn.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ONLINE = process.argv.includes('--online')
// Loaded through something other than a <script>/<link> tag, so integrity cannot apply; pinned exactly.
const REVIEWED = new Map([
  ['https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js', 'fetched by the engine (setRTLTextPlugin)'],
  ['https://cdn.jsdelivr.net/npm/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js', 'fetched by the engine (setRTLTextPlugin)'],
])
const known = new Set(Object.values(CDN).map((e) => e.url))
const URL_RE = /https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|api\.mapbox\.com\/mapbox-gl-js)\/[^\s'"`)<>]+?\.(?:m?js|css)\b/g
const FLOATING = /@(?:\d+|\d+\.\d+|latest|next)\/|@\^|@~/

const files = execFileSync('git', ['ls-files', '--', 'library', 'plugin-designs', 'internal/generate-tree.mjs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => /\.(m?js|vue|html)$/.test(f) && !/\/scripts\//.test(f) && !/\/index\.html$/.test(f) && !/^plugin-designs\/[^/]+\/data\//.test(f))
let bad = 0
const seen = new Map()
for (const f of files) {
  const src = execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
  for (const m of src.matchAll(URL_RE)) {
    const u = m[0]
    if (!seen.has(u)) seen.set(u, f)
    if (FLOATING.test(u)) { bad++; console.log(`  FAIL  ${f}: floating version ${u}`) }
    else if (!known.has(u) && !REVIEWED.has(u)) { bad++; console.log(`  FAIL  ${f}: not in library/constants/cdn.js (no integrity): ${u}`) }
  }
}
console.log(`CDN-PINS: ${seen.size} distinct runtime CDN url(s) in shipped code; registry holds ${known.size}.`)
if (ONLINE) {
  for (const [k, e] of Object.entries(CDN)) {
    let got = ''
    try { const r = await fetch(e.url); if (!r.ok) throw new Error('HTTP ' + r.status); got = 'sha384-' + createHash('sha384').update(Buffer.from(await r.arrayBuffer())).digest('base64') }
    catch (err) { console.log(`CDN-PINS: NOT MEASURED — ${e.url}: ${err.message}`); process.exit(75) }
    const ok = got === e.integrity
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${k}: ${ok ? 'bytes match the pinned hash' : `served ${got}, pinned ${e.integrity}`}`)
  }
}
if (bad) { console.log(`CDN-PINS: FAIL — ${bad} problem(s).`); process.exit(1) }
console.log(`CDN-PINS: PASS — every runtime CDN script/stylesheet is an exact version${ONLINE ? ', and every pinned hash matches what the CDN serves' : ' with an integrity hash'}.`)
