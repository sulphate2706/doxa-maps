/**
 * check-embed-basemap-paints.mjs — the basemap really paints, in a real third-party iframe,
 * on the token the page actually ships with.
 *
 * WHY THIS EXISTS. Every browser probe in this repo forced a Mapbox token onto the page
 * (`?tk=`, or `window.MAP_TOKEN`) from a shared file. That token is domain-restricted, which is
 * restricted and 403s on the basemap and country boundaries. The leaf pages BAKE a different
 * token, which is not restricted and works. So every probe measured a basemap that was broken only
 * because the probe broke it — and passed anyway, because it went on to count PINS, which are
 * drawn from our own GeoJSON and paint with no token at all.
 *
 * The consequence is that "the map renders" has never actually been measured. A pin count is
 * not a basemap. This check exists to make that claim measurable, and it deliberately does
 * NOT force a token: it loads the page exactly as a stranger's browser would.
 *
 * IT IS A REAL EMBED. The leaf is served on one port and the host page on another, so the
 * iframe is genuinely cross-origin — the same relationship a third-party site has to it.
 *
 * IT CAN FAIL, AND IS SHOWN TO. A check that cannot fail proves nothing, so every run also
 * loads the SAME page with the restricted token forced on, and requires that run to fail the
 * basemap test. If the negative control passes, the check reports that it proved nothing
 * rather than reporting success — a broken detector must never read as a green result.
 *
 * Evidence is taken two independent ways, because either alone has a failure mode:
 *   1. NETWORK — Mapbox tile/style responses, counted by status. 401/403 is decisive.
 *   2. PIXELS  — colour variety in a slice of the canvas. A page can 200 on everything and
 *                still paint nothing, and a screenshot is the only witness to that.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { serveReaped } from './_serve-reaped.mjs'
import { servesThisTree } from './_serves-this-tree.mjs'
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PUBLIC = resolve(REPO, 'public')

const LEAF = `${TREE_NAME}/gospel-resources/resources-map/index.html`
// EMBED_BASEMAP_PORT pins the port — used to prove the identity guard below (occupy it with another
// tree's server first; the gate must refuse rather than measure that tree).
const leafPort = Number(process.env.EMBED_BASEMAP_PORT) || (5810 + Math.floor(Math.random() * 60))
const hostPort = leafPort + 1

/** Mapbox endpoints that actually draw the map. Telemetry is not evidence of anything. */
const isBasemap = (u) =>
  /api\.mapbox\.com\/(styles|v4|fonts|tilesets)|tiles\.mapbox\.com/.test(u) &&
  !/events\.mapbox\.com/.test(u)

/* Reaped on signals as well as on the happy path. This gate used to kill its two servers
   only at the end, which is fine until the end is not reached: when the box ran low on
   memory it killed gate processes mid-run and their servers were orphaned, holding memory
   and making the next kill likelier. Measured both ways before this changed — the old
   spawn survived a SIGTERM to its parent, this one does not. */
const serve = (dir, port) => serveReaped(dir, port)

async function waitFor(url, ms = 20000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if ((await fetch(url).catch(() => null))?.ok) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

/* A third-party page: nothing but an iframe, served from another origin. */
const hostDir = mkdtempSync(resolve(tmpdir(), 'gr-embed-'))
writeFileSync(
  resolve(hostDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>third-party host</title>
<body style="margin:0;background:#f3f3f1">
<iframe id="f" src="http://127.0.0.1:${leafPort}/${LEAF}" style="width:1100px;height:760px;border:0"></iframe>
</body>`,
)

const leafSrv = serve(PUBLIC, leafPort)
const hostSrv = serve(hostDir, hostPort)
const stop = () => {
  leafSrv.stop()
  hostSrv.stop()
}

if (!(await waitFor(`http://127.0.0.1:${leafPort}/${LEAF}`)) || !(await waitFor(`http://127.0.0.1:${hostPort}/index.html`))) {
  console.error('EMBED-BASEMAP: NOT MEASURED — a server did not come up.')
  stop()
  process.exit(75)   // a precondition, not a product failure (was 1, which read as a red gate)
}
// ★ THE PORT IS RANDOM, NOT OS-ASSIGNED: if another agent's server already holds it, ours fails to
// start and waitFor() above succeeds against THEIRS. Prove the leaf server is this build.
// Measure THIS build, or measure nothing (exit 75 = NOT MEASURED; see a9550858 / _serves-this-tree.mjs).
{
  // servesThisTree (not requireThisTree) so this gate stops ITS OWN two servers before exiting.
  const t = await servesThisTree(`http://127.0.0.1:${leafPort}`, REPO)
  if (/DIFFERENT build/.test(t.why)) { console.log('EMBED-BASEMAP: NOT MEASURED — ' + t.why); stop(); process.exit(75) }
}

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
})

/**
 * @param {string|null} forceToken  null = the page's OWN baked token (the real case).
 */
async function run(forceToken) {
  /* The init script MUST be installed on the CONTEXT, not the page: the leaf lives in a
     cross-origin iframe, and a page-level init script never reaches it. Installing it on the
     page made both runs use the baked token and the check correctly reported that it had
     proved nothing — which is the only reason this was caught rather than shipped as a pass. */
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 } })
  const page = await ctx.newPage()
  if (forceToken) {
    /* THE CONTROL HAS TO WORK AT THE NETWORK LAYER. Setting window.MAP_TOKEN does nothing to
       this leaf: it injects `tk` straight into the element's profile-config, and the window
       global is only a fallback for leaves that do not. That is worth knowing on its own —
       this page is immune to the forced-token hazard by construction — but it means the only
       way to ask "what if the token were the restricted one" is to rewrite the token on the
       requests themselves. */
    await ctx.route(/api\.mapbox\.com|tiles\.mapbox\.com/, async (route) => {
      const u = new URL(route.request().url())
      if (u.searchParams.has('access_token')) u.searchParams.set('access_token', forceToken)
      await route.continue({ url: u.toString() })
    })
  }
  const net = { ok: 0, denied: 0, other: 0 }
  page.on('response', (r) => {
    if (!isBasemap(r.url())) return
    const s = r.status()
    if (s === 401 || s === 403) net.denied++
    else if (s >= 200 && s < 300) net.ok++
    else net.other++
  })
  await page.goto(`http://127.0.0.1:${hostPort}/index.html`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(12000)

  const frame = page.frames().find((f) => f.url().includes('resources-map'))
  if (!frame) return { net, pixels: null, reason: 'the iframe never loaded the leaf' }

  /* A slice well away from the sheet and the controls, so we sample map, not chrome. */
  const seen = await frame.evaluate(() => (window.MAP_TOKEN || '').slice(0, 24) || '(none on window)')
  const shot = await page.screenshot({ clip: { x: 60, y: 180, width: 700, height: 420 } })
  const png = shot
  await page.close()
  await ctx.close()
  return { net, png, seen }
}

const real = await run(null)
const forcedTokenPath = '/tmp/mbtk'
let restricted = ''
try { restricted = readFileSync(forcedTokenPath, 'utf8').trim() } catch { /* control simply cannot run */ }
const control = restricted ? await run(restricted) : null

/* Pixel variety, measured in-browser so no image library is needed. */
const shotPage = await browser.newPage()
async function variety(png) {
  if (!png) return 0
  return shotPage.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    c.getContext('2d').drawImage(img, 0, 0)
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const seen = new Set()
    for (let i = 0; i < d.length; i += 4) {
      seen.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3))
    }
    return seen.size
  }, png.toString('base64'))
}

const realColours = await variety(real.png)
const ctlColours = control ? await variety(control.png) : null
if (process.env.EMBED_SHOTS) {
  const { writeFileSync: wf } = await import('node:fs')
  if (real.png) wf(`${process.env.EMBED_SHOTS}/embed-baked.png`, real.png)
  if (control && control.png) wf(`${process.env.EMBED_SHOTS}/embed-restricted.png`, control.png)
  console.log(`  shots written to ${process.env.EMBED_SHOTS}`)
}
await browser.close()
stop()

/* A painted basemap has many colours; a blank ground has a handful. */
const COLOUR_FLOOR = 40
const realPaints = real.net.denied === 0 && real.net.ok > 0 && realColours >= COLOUR_FLOOR

console.log(`EMBED-BASEMAP: cross-origin iframe, leaf on :${leafPort} inside a host on :${hostPort}.`)
console.log(`  baked token      tiles ${real.net.ok} ok / ${real.net.denied} denied · ${realColours} distinct colours`)
if (control) {
  console.log(`  restricted token tiles ${control.net.ok} ok / ${control.net.denied} denied · ${ctlColours} distinct colours`)
  console.log(`  token the frame used: baked="${real.seen}"  control="${control.seen}"`)
}

if (!control) {
  console.error(`EMBED-BASEMAP: NOT MEASURED — ${forcedTokenPath} is absent, so the negative control could not run.`)
  console.error('  Without a control this check cannot be shown to fail, and a result it cannot')
  console.error('  fail on is not evidence. Refusing to report a pass.')
  process.exit(1)
}

const controlFails = control.net.denied > 0 || ctlColours < COLOUR_FLOOR
if (!controlFails) {
  console.error('EMBED-BASEMAP: PROVED NOTHING — the restricted token painted a basemap too,')
  console.error('  so this check cannot tell a working token from a broken one. Fix the control')
  console.error('  before trusting any pass it reports.')
  process.exit(1)
}

if (!realPaints) {
  console.error('EMBED-BASEMAP: FAIL — the page does NOT paint a basemap on its own baked token')
  console.error(`  in a third-party iframe (${real.net.denied} denied tile response(s), ${realColours} colours).`)
  console.error('  Pins can still draw here: they come from our GeoJSON and need no token, which is')
  console.error('  exactly why a pin count must never be read as "the map renders".')
  process.exit(1)
}

console.log('EMBED-BASEMAP: PASS — the basemap paints on the baked token in a third-party iframe,')
console.log('  and the same page with the restricted token forced on fails, so the check discriminates.')
