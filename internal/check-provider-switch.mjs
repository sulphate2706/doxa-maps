// check-provider-switch — ?provider=maplibre must actually SWAP THE ENGINE.
//
// The bug this gates (BUG-UPG100-IGNORES-THE-PROVIDER-SWITCH): my-upg-100-list
// builds its map RAW with `new gl.Map` instead of going through useMapInstance, so
// the page-level switch — which resolves inside that composable — could not reach
// it. MEASURED at the time: five sibling leaves swapped cleanly while this one
// stayed on Mapbox and made 19 requests to api.mapbox.com.
//
// ★ IT COUNTS NETWORK REQUESTS BY HOST, not globals. `window.mapboxgl` can be
// present because a page preloads it, and a map can still be DRAWN by maplibre —
// or the reverse. What the switch is for is not loading a proprietary engine and
// not calling its tile servers, and only the request log shows that.
//
// Usage: node internal/check-provider-switch.mjs <leafUrl>
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './lib/playwright-guarded.mjs'
import { servesThisTree, serveThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ⚠ NOT named `URL` — that shadows the global URL constructor, so every
// `new URL(request.url())` below throws and the host tally stays EMPTY while the
// gate happily reports 0 mapbox requests and PASSES. Measured: it did exactly
// that, hiding 4 real requests to events.mapbox.com.
// ⚠ SKIP CLEANLY, IN THE FORM THE WAVE RUNNER RECOGNISES. This exited 2 on a missing
// argument, so it could never join a wave: run-parallel grades on the exit code and a
// bare `usage:` line would have turned every server-less build RED. It also had no
// default, so it only ever ran when somebody typed a URL — the same present-but-never-
// executed shape check:packets-all had. Default to the upg-100 leaf (the profile this
// gate was written for) and SKIP with a named verdict when nothing is served there.
const DEFAULT_LEAF = (process.env.BASE_URL || 'http://127.0.0.1:4173')
  + `/${TREE_NAME}/my-upg-100-list/upg-100-list/index.html`
let LEAF = process.argv[2] || DEFAULT_LEAF
let OWN_SERVER = null
{
  let reachable = false
  try {
    const res = await fetch(LEAF, { signal: AbortSignal.timeout(4000) })
    reachable = res.ok
  } catch { /* nothing served — that is a precondition, not a product failure */ }
  if (!reachable) {
    console.log(`PROVIDER-SWITCH: SKIP — nothing served at ${LEAF}.`)
    console.log('  Serve the built tree and re-run, e.g.:')
    console.log('    python3 -m http.server 4173 --directory public   (or set BASE_URL)')
    process.exit(0)
  }

  // ⚠ REACHABLE IS NOT THE SAME QUESTION AS MINE. Several worktrees of this repo run on one
  // machine and the default port belongs to whichever started first — measured 2026-09-24:
  // :4173 was another worktree's server, and an hour of probing reported on a build nobody
  // here had changed. This gate's whole verdict is a request tally from a page; a tally taken
  // from someone else's page is a confident statement about the wrong code.
  // A mismatch is a PRECONDITION, not a product failure, so it SKIPs (exit 0) like the
  // unreachable case above — but it says which, so nobody reads it as a pass.
  // The helper wants the ORIGIN that serves public/, not the leaf page — passing the page URL
  // makes it look for the manifest under the page's own path and report "nothing serving it",
  // which would SKIP every run for the wrong reason. (Measured: it did, on both servers.)
  const tree = await servesThisTree(new URL(LEAF).origin, REPO)
  // Only a genuine MISMATCH skips. "No manifest to compare" (an unbuilt checkout) is a
  // different precondition and the reachable check above already speaks for it — turning
  // that into a skip here would silence the gate on exactly the builds it should run on.
  if (/DIFFERENT build/.test(tree.why)) {
    // Don't skip if we can simply serve our own tree — a gate that skips on every wave is a
    // gate nobody runs, and on this box the default port belongs to another worktree.
    const own = await serveThisTree(resolve(REPO, 'public'))
    if (!own) {
      console.log('PROVIDER-SWITCH: SKIP — the server is not serving THIS build, and I could not start one.')
      console.log(`  ${tree.why}`)
      console.log('  Serve your own tree and re-run: bun run serve (then BASE_URL=http://127.0.0.1:PORT)')
      process.exit(0)
    }
    OWN_SERVER = own
    LEAF = own.origin + new URL(LEAF).pathname
    console.log(`  · ${tree.why}`)
    console.log(`  · serving this checkout on ${own.origin} instead, so the tally is about THIS build`)
  }
}

// A well-formed FAKE public token (never a real one): enough for the Mapbox engine to start and make its
// requests, which is all the comparison run needs. Requests that carry it are aborted, never sent.
const FAKE_TK = ['pk', Buffer.from(JSON.stringify({ u: 'provider-switch-check' })).toString('base64url'), 'c2ln'].join('.')

async function run(provider, token = '') {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } })
  if (token) {
    await pg.addInitScript((tk) => { window.MAP_TOKEN = tk }, token)
    await pg.route((u) => /(^|\.)mapbox\.com$/i.test(u.hostname) && u.searchParams.has('access_token'), (r) => r.abort())
  }
  const hosts = new Map()
  let unparsed = 0
  pg.on('request', (r) => {
    try {
      const h = new URL(r.url()).hostname
      if (!h) { unparsed += 1; return }
      hosts.set(h, (hosts.get(h) || 0) + 1)
    } catch { unparsed += 1 }
  })
  const errs = []
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  const url = provider ? `${LEAF}${LEAF.includes('?') ? '&' : '?'}provider=${provider}` : LEAF
  await pg.goto(url, { waitUntil: 'load', timeout: 45000 })
  await pg.waitForTimeout(12000)
  const globals = await pg.evaluate(() => ({
    mapbox: typeof window.mapboxgl !== 'undefined',
    maplibre: typeof window.maplibregl !== 'undefined',
  }))
  await b.close()
  const count = (needle) => [...hosts.entries()]
    .filter(([h]) => h.includes(needle)).reduce((a, [, n]) => a + n, 0)
  // Report what could NOT be parsed rather than swallowing it: a silently empty
  // tally is how this gate first passed while measuring nothing at all.
  return { mapboxReq: count('mapbox.com'), globals, errs, unparsed, total: [...hosts.values()].reduce((a, n) => a + n, 0) }
}

// ★ THE ENGINE CONTRACT. The default engine ('auto') is MapLibre, and since 2026-09-28 a token no longer
// chooses Mapbox; only an explicit provider does. So the Mapbox baseline is ?provider=mapbox WITH a (fake)
// host token, the switch run adds the same token and ?provider=maplibre, and a third run checks the
// no-token default is keyless. The default WITH a host token is check:auto-engine's case 2.
const def = await run('mapbox', FAKE_TK)
const ml = await run('maplibre', FAKE_TK)
const auto = await run(null)

// DERIVED from the leaf's own HTML, not a hardcoded number: count the distinct
// api.mapbox.com references the generated page carries, then allow a little slack
// because a stylesheet can be fetched more than once (the upg-100 leaf resolves 4
// distinct urls but issues 5 requests — one css is re-fetched). Hardcoding 5 would
// pass a leaf that legitimately preloads 4 and leaks 1 runtime call.
const pageHtml = await (await fetch(LEAF)).text()
const declared = new Set((pageHtml.match(/https:\/\/api\.mapbox\.com[^"')]+/g) || []))
const PRELOAD_ALLOWANCE = Number(process.env.PROVIDER_PRELOADS ?? (declared.size + 1))

console.log(`  page preloads     : ${declared.size} distinct api.mapbox.com url(s) in the leaf HTML`)
console.log(`  ?provider=mapbox  : ${def.mapboxReq} mapbox / ${def.total} total request(s)  `
  + `[mapboxgl=${def.globals.mapbox} maplibregl=${def.globals.maplibre}]`)
console.log(`  no token (auto)   : ${auto.mapboxReq} mapbox / ${auto.total} total request(s)  `
  + `[mapboxgl=${auto.globals.mapbox} maplibregl=${auto.globals.maplibre}]`)
console.log(`  ?provider=maplibre: ${ml.mapboxReq} mapbox / ${ml.total} total request(s)  `
  + `[mapboxgl=${ml.globals.mapbox} maplibregl=${ml.globals.maplibre}]`)

const fails = []
if (!ml.globals.maplibre) {
  fails.push('?provider=maplibre did not load the maplibre engine at all')
}
// The RESIDUAL SET is the leaf page's own <link>/<script> preloads — mapbox-gl and
// the geocoder, referenced in the generated index.html header. Those fire before any
// Vue code runs, so no runtime switch can suppress them; removing them is a separate
// concern (the page template), not this bug. What the switch must achieve is that NO
// RUNTIME request goes to Mapbox: measured 19 -> 5 on the upg-100 leaf, and all 5 are
// in the HTML. Asserting "fewer than default" would pass a half-fix at 18.
if (ml.mapboxReq > PRELOAD_ALLOWANCE) {
  fails.push(`?provider=maplibre made ${ml.mapboxReq} mapbox request(s), more than the `
    + `${PRELOAD_ALLOWANCE} page preloads — ${ml.mapboxReq - PRELOAD_ALLOWANCE} are RUNTIME `
    + 'calls the switch failed to redirect')
}
if (def.mapboxReq <= PRELOAD_ALLOWANCE) {
  fails.push(`the default run made only ${def.mapboxReq} mapbox request(s) — the map is probably `
    + 'not rendering, so this comparison proves nothing')
}
if (auto.mapboxReq > PRELOAD_ALLOWANCE) {
  fails.push(`the no-token default made ${auto.mapboxReq} mapbox request(s) — 'auto' must draw MapLibre, keyless, with no token`)
}
if (!def.total) fails.push('no requests were recorded at all — the tally is broken, not the page')
if (ml.errs.length) fails.push(`${ml.errs.length} page error(s) under maplibre: ${ml.errs[0]}`)

OWN_SERVER?.stop()

if (fails.length) {
  console.error(`\nPROVIDER-SWITCH: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`\nPROVIDER-SWITCH: PASS — maplibre loads and mapbox traffic drops `
  + `${def.mapboxReq} -> ${ml.mapboxReq}.`)
