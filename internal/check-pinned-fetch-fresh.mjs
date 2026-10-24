#!/usr/bin/env bun
/**
 * check-pinned-fetch-fresh.mjs — a STALE cached copy of a pinned file never decides a print.
 *
 * THE DEFECT (2026-10-02, on a phone). The print-time files are pinned (poster-render.js, its classic copy,
 * packet-strings.json, ne-places.json, india-states.json) and fetched with cache: 'force-cache', which returns ANY
 * cached copy, however old. After a re-pin, a reader who had printed before kept the previous copy: it failed its pin
 * on every print and the print fell back without a word. Page 1 became the stored poster (the phone's packet), a
 * non-English packet would print in English, and India's state cards would be lost. library/packet/sha384.js
 * fetchPinned fetches force-cache first and, on a copy that is not served or does not match, ONCE more with cache:
 * 'reload'; every pinned loader calls it.
 *
 * A browser's HTTP cache is modelled: force-cache answers from it when it holds the URL, reload always asks the
 * server and refreshes it. The SERVER holds the current files (public/dx-maps/assets); the CACHE holds a stale copy.
 *   A. fetchPinned: a stale cached copy → the current text, after exactly one fresh refetch;
 *   B. a cached copy that matches is used as is: ONE request, force-cache (the fast, offline-friendly path stays);
 *   C. a server that also serves the wrong bytes → rejected, err.integrity, after one fresh refetch;
 *   D. a file that is not served → rejected (not an integrity failure);
 *   E. loadPacketStrings with a stale cached table → the full table in every language (not the English fallback);
 *   F. loadIndiaStates with a stale cached table → India's 36 states (not a rejection);
 *   G. generateSheet with a stale cached generator → a drawn sheet (not an integrity refusal);
 *   H. wiring: every pinned loader fetches through fetchPinned with its own pin, and none fetches its pinned file
 *      directly; the classic-script path refreshes the HTTP cache and retries a refused tag once.
 * `--self-test`: fetchPinned without its fresh refetch, one that never uses the cache, one that accepts a
 * mismatch, and a loader that fetches its pinned file directly must each FAIL.
 * Two-sided by hand at the change: the previous loaders (the pilot before this) fail E, F and G.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO = new URL('..', import.meta.url).pathname
const ASSETS = join(REPO, 'public/dx-maps/assets')
const SHA_SRC = join(REPO, 'library/packet/sha384.js')
const LOADERS = {
  'library/packet/posterSheets.js': ['POSTER_RENDER_SHA384', 'NE_PLACES_SHA384'],
  'library/packet/packetStrings.js': ['PACKET_STRINGS_SHA384'],
  'library/data/indiaStates.js': ['INDIA_STATES_SHA384'],
}
const PINNED_FILES = ['lib/poster-render.js', 'lib/packet-strings.json', 'boundaries/ne-places.json', 'people-groups/india-states.json']
const served = (p) => { const f = join(ASSETS, p); return existsSync(f) ? readFileSync(f, 'utf8') : null }
const asModule = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
const realFetch = globalThis.fetch

// The browser, modelled: { cached: path -> stale text } in the HTTP cache, { wrong: path -> text } served instead of
// the real file, { missing: [path] } not served at all.
function world(host, { cached = {}, wrong = {}, missing = [] } = {}) {
  const http = new Map(Object.entries(cached).map(([p, t]) => [`${host}/${p}`, t]))
  const requests = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (!url.startsWith(host + '/')) return realFetch(input, init)
    const path = url.slice(host.length + 1).split('?')[0]
    const mode = init.cache || 'default'
    requests.push({ path, mode })
    let text = null
    if (mode !== 'reload' && mode !== 'no-store' && http.has(url)) text = http.get(url)
    else {
      text = missing.includes(path) ? null : (path in wrong ? wrong[path] : served(path))
      if (text !== null) http.set(url, text)
    }
    return text === null ? new Response('not found', { status: 404 }) : new Response(text, { status: 200 })
  }
  return { requests }
}
const stale = (p) => `/* an older build */\n${served(p)}`

async function auditFetchPinned(shaSrc) {
  const fails = []
  const { fetchPinned, sha384 } = await asModule(shaSrc)
  if (typeof fetchPinned !== 'function') return ['A: library/packet/sha384.js exports no fetchPinned']
  const P = 'lib/packet-strings.json', current = served(P), pin = await sha384(current)
  // A
  { const w = world('https://a.test', { cached: { [P]: stale(P) } }); let got = null, err = null
    try { got = await fetchPinned(`https://a.test/${P}`, pin) } catch (e) { err = e }
    if (got !== current) fails.push(`A: a stale cached copy did not give the current file (${err ? `rejected: ${err.message}` : 'returned other bytes'})`)
    else if (w.requests.length !== 2 || w.requests[0].mode !== 'force-cache' || w.requests[1].mode !== 'reload') fails.push(`A: expected force-cache then ONE reload, got ${JSON.stringify(w.requests)}`) }
  // B
  { const w = world('https://b.test', { cached: { [P]: current } }); let got = null
    try { got = await fetchPinned(`https://b.test/${P}`, pin) } catch { /* reported below */ }
    if (got !== current || w.requests.length !== 1 || w.requests[0].mode !== 'force-cache') fails.push(`B: a matching cached copy should be used with ONE force-cache request, got ${JSON.stringify(w.requests)}`) }
  // C
  { const bad = current.replace('"en"', '"en" ') + ' '
    const w = world('https://c.test', { cached: { [P]: stale(P) }, wrong: { [P]: bad } }); let got = null, err = null
    try { got = await fetchPinned(`https://c.test/${P}`, pin) } catch (e) { err = e }
    if (got !== null || !err || err.integrity !== true) fails.push(`C: wrong bytes on the server were not refused as an integrity failure (${got !== null ? 'ACCEPTED' : err?.message})`)
    else if (w.requests.length !== 2) fails.push(`C: expected exactly one fresh refetch before refusing, got ${w.requests.length} request(s)`) }
  // D
  { world('https://d.test', { missing: [P] }); let err = null
    try { await fetchPinned(`https://d.test/${P}`, pin) } catch (e) { err = e }
    if (!err || err.integrity) fails.push(`D: an unserved file should reject as not served (${err ? err.message : 'it resolved'})`) }
  globalThis.fetch = realFetch
  return fails
}

async function auditLoaders() {
  const fails = []
  // E: the packet text
  { world('https://e.test', { cached: { 'lib/packet-strings.json': stale('lib/packet-strings.json') } })
    const { loadPacketStrings } = await import(join(REPO, 'library/packet/packetStrings.js'))
    const warn = console.warn; console.warn = () => {}
    const t = await loadPacketStrings('https://e.test').finally(() => { console.warn = warn })
    const src = JSON.parse(served('lib/packet-strings.json'))
    if (Object.keys(t).join() === 'en' || t.zh?.zone_affinity_A017 !== src.zh?.zone_affinity_A017) fails.push(`E: a stale cached packet-strings.json made the packet English (got languages: ${Object.keys(t).join(',')})`) }
  // F: India's states
  { world('https://f.test', { cached: { 'people-groups/india-states.json': stale('people-groups/india-states.json') } })
    const { loadIndiaStates } = await import(join(REPO, 'library/data/indiaStates.js'))
    let n = -1, err = null
    try { n = (await loadIndiaStates('https://f.test')).states.length } catch (e) { err = e }
    const want = JSON.parse(served('people-groups/india-states.json')).states.length
    if (n !== want) fails.push(`F: a stale cached india-states.json lost India's states (${err ? `rejected: ${err.message}` : `${n} of ${want}`})`) }
  // G: page 1's generator
  { world('https://g.test', { cached: { 'lib/poster-render.js': stale('lib/poster-render.js'), 'boundaries/ne-places.json': stale('boundaries/ne-places.json') } })
    const { generateSheet, countryZone } = await import(join(REPO, 'library/packet/posterSheets.js'))
    const zone = countryZone({ id: 'country-tcd', iso3: 'TCD', label: 'Chad', count: 1, region: 'Africa' })
    const pins = [[12.1, 15.0], [13.8, 20.8], [9.1, 18.4]].map(([lat, lng], i) => ({ name: `Probe ${i + 1}`, lat, lng, slug: `probe-${i}`, country_code: 'TCD', population: 1000 }))
    const adm0 = JSON.parse(served('boundaries/world-adm0.geojson'))
    let html = '', err = null
    const warn = console.warn; console.warn = () => {}
    try { html = await generateSheet({ zone, pins, format: '3x3', seriesId: 'country', adm0, assetsBase: 'https://g.test', date: '2026-09-29' }) } catch (e) { err = e }
    console.warn = warn
    if (!(typeof html === 'string' && /<svg\b/.test(html))) fails.push(`G: a stale cached generator stopped the sheet from drawing (${err ? err.message.slice(0, 110) : 'no sheet'})`) }
  globalThis.fetch = realFetch
  return fails
}

function auditWiring(srcOf) {
  const fails = []
  for (const [file, pins] of Object.entries(LOADERS)) {
    const s = srcOf(file)
    if (!/import \{[^}]*\bfetchPinned\b[^}]*\} from '[^']*sha384\.js'/.test(s)) fails.push(`H: ${file} does not import fetchPinned`)
    for (const pin of pins) if (!new RegExp(`fetchPinned\\([^)]*,\\s*${pin}\\)`).test(s)) fails.push(`H: ${file} does not fetch its ${pin} file through fetchPinned`)
    if (/fetch\(url,\s*\{\s*cache:\s*'force-cache'\s*\}\)/.test(s)) fails.push(`H: ${file} still fetches a pinned file directly with force-cache`)
  }
  const ps = srcOf('library/packet/posterSheets.js')
  const classic = (ps.match(/function loadClassic\(url\) \{[\s\S]*?\n\}/) || [''])[0]
  if (!/fetch\(url, \{ cache: 'reload' \}\)/.test(classic) || !/return tag\(\)\s*\n?\s*\}\)/.test(classic)) fails.push('H: the classic-script path does not refresh the HTTP cache and retry a refused tag once')
  for (const p of PINNED_FILES) if (served(p) === null) fails.push(`H: ${p} is not in the served tree (the gate would measure nothing)`)
  return fails
}

const shaSrc = readFileSync(SHA_SRC, 'utf8')
const read = (f) => readFileSync(join(REPO, f), 'utf8')
if (process.argv.includes('--self-test')) {
  const FOR = "for (const cache of ['force-cache', 'reload']) {"
  const poisons = [
    ['fetchPinned without its fresh refetch', () => auditFetchPinned(shaSrc.replace(FOR, "for (const cache of ['force-cache']) {")), /^A: /],
    ['fetchPinned that never uses the cache', () => auditFetchPinned(shaSrc.replace(FOR, "for (const cache of ['reload', 'reload']) {")), /^B: /],
    ['fetchPinned that accepts a mismatch', () => auditFetchPinned(shaSrc.replace('      if (got === pin) return text\n', '      return text\n')), /^C: /],
    ['a loader that fetches its pinned file directly', () => auditWiring((f) => (f === 'library/packet/packetStrings.js'
      ? read(f).replace('fetchPinned(url, PACKET_STRINGS_SHA384)', "(await fetch(url, { cache: 'force-cache' })).text()") : read(f))), /^H: library\/packet\/packetStrings\.js/],
  ]
  let missed = 0
  for (const [name, run, rx] of poisons) {
    const f = await run(); const hit = f.find((x) => rx.test(x))
    console.log(hit ? `✓ caught: ${name} -> ${hit}` : `✗ MISSED: ${name}${f.length ? ` (failed instead: ${f[0]})` : ''}`)
    if (!hit) missed++
  }
  if (missed) process.exitCode = 1
} else {
  const f = [...await auditFetchPinned(shaSrc), ...await auditLoaders(), ...auditWiring(read)]
  if (f.length) { for (const x of f) console.log('✗ ' + x); console.log(`FAIL check:pinned-fetch-fresh (${f.length})`); process.exitCode = 1 }
  else console.log('PASS check:pinned-fetch-fresh — a stale cached copy of a pinned file is refetched once, fresh: page 1 still draws, the packet keeps its language, India keeps its states; a matching cached copy is used as is; wrong bytes are refused; every pinned loader goes through fetchPinned')
}
