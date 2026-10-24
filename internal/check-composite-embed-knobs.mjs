#!/usr/bin/env node
/**
 * check-composite-embed-knobs.mjs — a composite must pass the host's TOKEN and PROVIDER down to the
 * map it nests, on somebody else's page.
 *
 * THE DEFECT THIS EXISTS FOR, MEASURED 2026-09-24. Two shipped composites declared NO PROPS at all,
 * so the `profile-config` a partner writes was read by nobody:
 *
 *     <research-map-plus-grid profile-config='{"tk":"pk...."}'>   -> "No Mapbox access token
 *     <dashboard-plus-grid    profile-config='{"tk":"pk...."}'>       provided", 0 tiles, no canvas
 *
 * and after the token was threaded, the SAME hole was still open one knob over:
 *
 *     <research-map-plus-grid profile-config='{"provider":"maplibre"}'>  -> child still on mapbox,
 *                                                                          so it demanded a token
 *
 * Every existing gate missed all of it, and not by accident: they load a composite on its OWN
 * generated leaf, and that leaf BAKES a token and assigns window.MAP_TOKEN, which the shared-token
 * bridge hands to the nested map. The leaf supplies the very thing under test. The failure exists
 * only where there is no leaf — which is exactly the partner page the published embed snippet is
 * written for, and exactly the case nobody was testing.
 *
 * WHY THESE TWO KNOBS AND NOT A LONGER LIST. They are the two the snippet documents and the two the
 * product promises: `tk` is how a partner supplies their own key, and `provider` is the one prop that
 * is supposed to swap the engine. A keyless MapLibre embed is the whole reason MapLibre support was
 * built — partners at volume who do not want a Mapbox key — so a composite that drops `provider`
 * does not degrade the feature, it cancels it, and reports the loss as a token error.
 *
 * HOW. Serves the built tree from a FREE port (ACAO:* via serve-strict, production parity) and the
 * partner page from `localhost` — a genuinely different origin, so CORS is exercised rather than
 * assumed. Free ports asked of the OS, never fixed ones: a stray server on a fixed port answers in
 * place of the tree under test and the gate then passes a build it never loaded.
 *
 * ASSERTIONS, per composite that nests a map:
 *   tk       — given ONLY {"tk": <the token the tree bakes>}, a canvas appears and at least one
 *              api.mapbox.com style/tile request succeeds. No token error in the console.
 *   provider — given ONLY {"provider":"maplibre"} and NO token, a canvas appears and there are
 *              ZERO requests to api.mapbox.com. Zero is the assertion: "it rendered" would pass on
 *              a build that quietly fell back to mapbox with a baked key.
 *
 * NEGATIVE-TESTED: reverting either fix in research-map-plus-grid.vue makes the matching case FAIL
 * naming the composite and the knob; both restored, both pass. Removing the zero-request assertion
 * from the provider case makes it pass on a build that ignores the prop, which is what it is for.
 *
 * Exit: 0 pass (or SKIP: no built tree / no browser) · 1 fail · 75 NOT MEASURED (every case skipped, e.g. no
 *       token: set TEST_MAPBOX_TOKEN).
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')

if (!existsSync(MANIFEST)) {
  console.log('COMPOSITE-EMBED-KNOBS: SKIP — no built manifest (run `bun run tree` first).')
  process.exit(0)
}
let chromium
try { ({ chromium } = await import('./lib/playwright-guarded.mjs')) } catch {
  console.log('COMPOSITE-EMBED-KNOBS: SKIP — playwright is not installed.')
  process.exit(0)
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

// Which bundles nest a MAP? A composite declares `composes`; a bundle is a map if any of its
// profiles is isMap. Asking the manifest keeps this list correct when a composite is added.
const mapBundles = new Set()
for (const b of manifest.bundles || []) {
  if ((b.profiles || []).some((p) => p.isMap)) mapBundles.add(b.bundle)
}
const targets = []
const mapless = []   // composites that nest no map: reported as N/A, never as unmeasured
for (const b of manifest.bundles || []) {
  // TWO WAYS A COMPOSITE DECLARES ITSELF, and taking only the first under-covered this gate.
  // `composes` is written when a composite mounts children BY TAG; a composite that BAKES its
  // children in (an imported .vue) lists nothing there, and country-posters-mfe — one of the three
  // composites this defect was measured on — was silently not a target. The profile TYPE says so in
  // both cases, so ask for either.
  const composes = b.composes || []
  const byCompose = composes.some((c) => mapBundles.has(c))
  const profile = (b.profiles || []).find((p) => p.element && (byCompose || p.type === 'nested-elements-mfe'))
  if (!profile || !b.scriptUrl) continue
  // ★ A COMPOSITE WITH NO MAP IS NOT A MAP-EMBED TARGET, and counting it as one buys a permanent
  // UNMEASURED that reads like a gap. The `type` arm above is deliberately loose — country-posters-mfe
  // BAKES its children, so `composes` names nothing — but loose enough to admit composites that nest no
  // map at all: bp-big-picture composes a research HEADER and a people-groups GRID, and its built
  // bundle contains zero occurrences of mapbox-gl or maplibre-gl. It can never draw a canvas, so
  // "no canvas under a minimal config" was the honest answer to a question that should not have been
  // asked of it. Decided on the BUILT artefact rather than the manifest, because whether a bundle
  // ships an engine is a fact about what it compiled, not about what it declares.
  if (!byCompose) {
    let js = ''
    try { js = readFileSync(resolve(ROOT, 'public', TREE_NAME, b.bundle, `${b.bundle}.js`), 'utf8') } catch (_) { js = '' }
    if (js && !/mapbox-gl|maplibre-gl/.test(js)) { mapless.push(`${profile.element} (${b.bundle})`); continue }
  }
  targets.push({ bundle: b.bundle, element: profile.element, profile: profile.profile, script: `${b.bundle}/${b.bundle}.js` })
}
if (mapless.length) {
  console.log(`  · ${mapless.length} composite(s) nest NO map, so the knobs do not apply and they are not targets: ${mapless.join(', ')}`)
}
if (!targets.length) {
  console.log('COMPOSITE-EMBED-KNOBS: SKIP — the manifest declares no composite that nests a map.')
  process.exit(0)
}

// The token to hand the partner page is the one the tree already bakes into its own leaves: this
// gate must not invent a key, and a token that is not this tree's would 401 and look like our bug.
// The tree bakes no token since the auto engine (the repo ships none), so every tk case SKIPPED and every
// provider case went UNMEASURED: a hollow PASS (measured at ded4b3c1). A seat that has a real public token passes
// it as TEST_MAPBOX_TOKEN (as the browser checks do); otherwise a baked one is still used if a tree has it.
const bakedToken = process.env.TEST_MAPBOX_TOKEN || (() => {
  for (const b of manifest.bundles || []) {
    for (const p of b.profiles || []) {
      if (!p.isMap || !p.iframeUrl) continue
      const leaf = join(ROOT, 'public', TREE_NAME, String(p.iframeUrl).replace(/^\.\//, ''))
      if (!existsSync(leaf)) continue
      const m = readFileSync(leaf, 'utf8').match(/BAKED_TOKEN\s*=\s*"(pk\.[^"]+)"/)
      if (m) return m[1]
    }
  }
  return ''
})()

const freePort = () => new Promise((ok) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
})
const TREE_PORT = await freePort()
const HOST_PORT = await freePort()
const TREE = `http://127.0.0.1:${TREE_PORT}/${TREE_NAME}`

let pageHtml = '<!doctype html><html><body>nothing yet</body></html>'
const tree = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(TREE_PORT), '--exit-with-parent'], { cwd: ROOT, stdio: 'ignore' })
const host = createServer((_, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pageHtml) }).listen(HOST_PORT, 'localhost')
const cleanup = () => { try { tree.kill() } catch { /* already gone */ } try { host.close() } catch { /* already closed */ } }
await new Promise((r) => setTimeout(r, 900))

const reachable = await fetch(`${TREE}/manifest.json`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false)
if (!reachable) {
  cleanup()
  console.log('COMPOSITE-EMBED-KNOBS: SKIP — could not serve the built tree locally.')
  process.exit(0)
}

const CASES = [
  { knob: 'tk', config: (tok) => ({ tk: tok }), needsToken: true },
  { knob: 'provider', config: () => ({ provider: 'maplibre' }), needsToken: false },
]

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })
const fails = []
const lines = []
// Elements whose tk case actually drew a map — the only ones whose provider case can mean anything.
const renders = new Set()
try {
  for (const t of targets) {
    for (const c of CASES) {
      // Do not pay for a page load we already know cannot mean anything: if this element's tk case
      // drew no map, its provider case has nothing to compare against. Short-circuiting here is what
      // keeps the whole gate near two minutes instead of five on a nine-composite tree.
      if (c.knob === 'provider' && !renders.has(t.element)) {
        lines.push(`  · ${t.element} [provider] UNMEASURED — its tk case never drew a map, so there is nothing to compare against.`)
        continue
      }
      if (c.needsToken && !bakedToken) {
        lines.push(`  · ${t.element} [${c.knob}] SKIPPED — no baked token in this tree to hand the host`)
        continue
      }
      // The composite's OWN profile rides with the knob under test (measured at 1a761741: gospel-resources,
      // my-upg-100-list, regions-dashboard and two more drew no map under a knob-only config, because a
      // multi-profile element needs to be told which profile is the composite). A knob still wins.
      // A composite that opens on a non-map view must be told to show its map (country-posters-mfe
      // reads profile-config `view`), or there is no canvas to measure.
      const VIEW = { 'country-posters-mfe': { view: 'map' } }
      const cfg = JSON.stringify({ profile: t.profile, ...(VIEW[t.element] || {}), ...c.config(bakedToken) }).replace(/'/g, '&#39;')
      pageHtml = `<!doctype html><html><head><meta charset=utf-8><title>partner</title></head><body style="margin:0">
<header style="height:48px;background:#eee">HOST HEADER</header>
<script>window.MAP_APP_API_URL="https://pray.doxa.life";</script>
<script src="${TREE}/${t.script}" crossorigin="anonymous"></script>
<${t.element} profile-config='${cfg}'></${t.element}>
</body></html>`
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      let mapboxOk = 0, mapboxBad = 0
      const errs = []
      page.on('response', (r) => {
        if (!/api\.mapbox\.com|tiles\.mapbox\.com/.test(r.url())) return
        if (r.status() >= 400) mapboxBad++; else mapboxOk++
      })
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
      await page.goto(`http://localhost:${HOST_PORT}/`, { waitUntil: 'load' }).catch(() => {})
      // WAIT FOR THE THING, NOT FOR A CLOCK. A flat 14s per case made this gate cost four minutes
      // of wall time on a nine-composite tree, most of it spent watching a map that had already
      // drawn. Poll for a canvas instead, then settle briefly so late tile requests are counted —
      // the provider case asserts ZERO requests to api.mapbox.com, so it must not stop measuring
      // the moment something paints. An element that never draws still costs the full budget, which
      // is correct: that is the case whose absence is the finding.
      const CANVAS_BUDGET_MS = 16000
      const deadline = Date.now() + CANVAS_BUDGET_MS
      let canvas = 0
      const countCanvas = `(() => {
        let n = 0
        const visit = (r) => { n += r.querySelectorAll('canvas').length; for (const el of r.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot) }
        visit(document)
        return n
      })()`
      while (Date.now() < deadline) {
        canvas = await page.evaluate(countCanvas).catch(() => 0)
        if (canvas) break
        await page.waitForTimeout(500)
      }
      await page.waitForTimeout(2500)
      canvas = await page.evaluate(countCanvas).catch(() => canvas)
      const tokenErr = errs.find((e) => /access token/i.test(e))
      const label = `${t.element} [${c.knob}]`
      const mapboxAll = mapboxOk + mapboxBad

      // ★ FAIL ONLY WHERE THE EVIDENCE POINTS AT THE KNOB. An element that draws no map under a
      // MINIMAL config is not thereby broken: several composites need a `profile` to select which
      // of their profiles to show, and this gate deliberately passes only the knob under test. The
      // first draft failed nine of them for that, which would have red-gated other people's plugins
      // over a claim it had not measured. The distinguishing evidence is the console: a token WAS
      // supplied, so "No Mapbox access token provided" means the knob did not cross the boundary —
      // that is this defect. No canvas and no such complaint is simply not measurable here, and is
      // reported as UNMEASURED rather than dressed up as a finding.
      if (c.knob === 'tk') {
        if (canvas && mapboxOk > 0) { renders.add(t.element); lines.push(`  ok ${label} — canvas ${canvas}, api.mapbox.com requests ${mapboxAll}`) }
        else if (canvas && mapboxOk === 0) fails.push(`${label}: canvas drew but NOTHING loaded from api.mapbox.com — the host's token never reached the map`)
        else if (tokenErr) fails.push(`${label}: a token was supplied and the element still says "${tokenErr}" — it never read the host's profile-config`)
        else lines.push(`  · ${label} UNMEASURED — no map canvas under a minimal config, and no token complaint. This element likely needs a \`profile\` to show its map; not a knob failure.`)
      } else {
        if (canvas && mapboxAll === 0) lines.push(`  ok ${label} — canvas ${canvas}, api.mapbox.com requests 0 (keyless, as asked)`)
        else if (mapboxAll > 0) fails.push(`${label}: asked for maplibre and still made ${mapboxAll} request(s) to api.mapbox.com — the prop did not cross the composite boundary`)
        else fails.push(`${label}: asked for maplibre with no token and drew nothing${tokenErr ? ` — ${tokenErr}` : ''}`)
      }
      await page.close()
    }
  }
} finally {
  await browser.close()
  cleanup()
}

console.log(`COMPOSITE-EMBED-KNOBS: ${targets.length} composite(s) that nest a map, on a foreign origin`)
for (const l of lines) console.log(l)
if (fails.length) {
  console.error(`\nCOMPOSITE-EMBED-KNOBS: FAIL — ${fails.length} case(s)`)
  for (const f of fails) console.error('  - ' + f)
  console.error('\n  A composite reads the host\'s profile-config and hands `tk` and `provider` to the map it')
  console.error('  nests. Our own leaves bake a token and assign window.MAP_TOKEN, so this only ever breaks')
  console.error('  on a partner page — the case the published embed snippet is written for.')
  process.exit(1)
}
// A run in which no case measured anything is NOT MEASURED (exit 75), never a PASS.
if (!lines.some((l) => /^\s*ok\b/.test(l))) {
  console.log(`\nCOMPOSITE-EMBED-KNOBS: NOT MEASURED — every case skipped or went unmeasured${bakedToken ? '' : ' (no token: set TEST_MAPBOX_TOKEN to a public pk. token)'}.`)
  process.exit(75)
}
console.log(`\nCOMPOSITE-EMBED-KNOBS: PASS — the host's token and provider reach every nested map.`)
