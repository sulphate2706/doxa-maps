#!/usr/bin/env node
/**
 * check-dashboard-geocoder-provider.mjs — a dashboard running on MapLibre must not call Mapbox.
 *
 * THE CONTRACT: a partner who selects MapLibre has selected the keyless engine precisely so that no
 * Mapbox key and no Mapbox traffic is involved. One request to api.mapbox.com sends that visitor's
 * IP to Mapbox and breaks the promise, whatever the page looks like afterwards.
 *
 * ★ WHAT THIS MEASURED, AND IT IS NOT WHERE THE AUDIT POINTED. studio's Mapbox-globals audit named
 * DashboardSearchHeader.vue, which did preload api.mapbox.com/.../mapbox-gl-geocoder.min.js
 * unconditionally and never passed `provider` to the GeocoderComponent it mounts — both now fixed.
 * But that component is NOT MOUNTED by this dashboard (research-dashboard.vue:23 says so in as many
 * words), so fixing it changes nothing here. The four requests this leaf actually makes under
 * ?provider=maplibre are all from the GENERATED LEAF PAGE's own tags:
 *
 *     mapbox-gl.css · mapbox-gl.js · mapbox-gl-geocoder.css · mapbox-gl-geocoder.min.js
 *
 * i.e. the leaf ships Mapbox GL and the Mapbox geocoder to every visitor regardless of the engine
 * it was asked for. That is the leaf GENERATOR's doing, not this plugin's, and it is why this gate
 * was kept out of gates:post until the generator stopped hard-linking the engine (2026-09-25: the leaf
 * now loads only the engine its provider asks for). It is wired into gates:post in that same landing,
 * and still names the exact URLs when it fails.
 *
 * ★ ZERO IS THE ASSERTION, not "it rendered". A build that quietly kept the Mapbox geocoder would
 * look identical: the bars appear, suggestions work, nothing errors. Only the request log tells the
 * truth, which is why this counts requests rather than looking at the page.
 *
 * ★ CORRECTED 2026-09-26, after a browser check reported "0 search bars on both engines" and it was the CHECK
 * that was wrong, not the product. Two separate mistakes, both of them mine:
 *
 *   1. UNDER MAPLIBRE, NO SEARCH BAR IS THE CONTRACT — not a hollow pass and not a failure.
 *      research-map.vue: `hasGeocoder = mapProvider === 'mapbox'`, and research-map.instances.json
 *      says it in words: "Under maplibre the search bar is deliberately ABSENT — GeocoderComponent's
 *      maplibre path still geocodes through Mapbox, so shipping it would bill the very key this
 *      instance exists to avoid". The previous revision had just been taught that a bar-less leaf is
 *      a hollow pass, and applied that lesson to the one engine where ABSENCE IS THE POINT. An
 *      absent bar is in fact the STRONGEST form of this gate's own assertion: a search that cannot
 *      be typed into cannot send anyone's IP to Mapbox.
 *      So the rule is now conditional rather than hardcoded, because a keyless geocoder may ship
 *      one day and this gate should not have to be rewritten when it does: if maplibre renders NO
 *      bar, that is recorded and passes; if it renders one, it must WORK and still make zero
 *      Mapbox requests. Either way the zero is what is asserted.
 *
 *   2. THE MAPBOX RUN WAS NEVER GIVEN A TOKEN, so it could not have rendered a bar either. The leaf
 *      bakes BAKED_TOKEN = "" and nothing else supplies one, so mapbox-gl cannot construct a Map,
 *      `map` stays null, and the bar's `v-if="appReady && map && hasGeocoder"` never fires. Note the
 *      mechanism: an explicit ?provider=mapbox does NOT fall back to maplibre (explicitMapProvider
 *      reads the URL first) — the engine is Mapbox, it simply has no key. A gate that fails a
 *      product for a key the gate did not provide is measuring its own environment.
 *      It now takes MAPBOX_TOKEN from the env (or vite.doxa-maps-build-config.json `token`, the
 *      same ladder check:experimental-shelf uses) and supplies it on BOTH documented rungs — the
 *      host global (window.MAP_TOKEN, injected before navigation the way check:auto-engine does)
 *      and the ?tk= URL param — as two separate cases. See the CASES block below for why two.
 *      With no token the
 *      mapbox half is NOT MEASURED — reported as a SKIP line so run-parallel prints ⊘ rather than
 *      counting it as a pass, because an always-taken skip is indistinguishable from an unwired
 *      gate unless the runner says so.
 *
 * ★ WHY THE MAP PROBE ASKS THE ENGINE AND NOT THE DOM (2026-09-26, the second correction in a
 * day). This gate reported "NO map constructed" on a leaf where a browser check then measured 1 Mapbox map, 2
 * GL canvases and 3 search inputs, on BOTH token rungs. The product was never at fault; the
 * detection was. A DOM walk for a canvas is a chain of assumptions — every shadow root open, the
 * canvas carrying the class expected, existing by the time it is looked for — and when any link
 * breaks it reports ABSENCE, which is indistinguishable from a broken product. It now hooks the
 * engine's own Map.prototype.setStyle through both globals, which cannot be wrong about the DOM
 * because it never looks at it, and widens the bar selector to what a reader would call a search
 * box. Both borrowed from the token-rung probe (tokrung.mjs).
 *
 * THE LESSON, recorded because it is the second time in two days that a probe accused a working
 * product: a measurement that yields ZERO when its own assumption is wrong will always blame the
 * thing it is measuring. Where a positive control exists that measures correctly, copy the control.
 *
 * ASSERTIONS, on the built tree:
 *   maplibre   ZERO requests to api.mapbox.com. (Measured with or without a token.)
 *              If a bar is present it must produce suggestions; if it is absent, that is the
 *              documented contract and is recorded as such.
 *   mapbox     TWICE, once per token rung: a map CONSTRUCTS, the bar is PRESENT, and typing
 *              produces suggestions. Requires a token; without one this half is skipped, never
 *              failed. Mapbox traffic is expected here and not asserted on — but rejected
 *              RESPONSES are recorded, because "21 requests and no map" is otherwise ambiguous
 *              between a token never seen, a token refused, and a map that failed for its own
 *              reasons, and those three have different owners.
 *
 * NEVER PRINTS THE TOKEN. Only its presence is reported.
 *
 * Exit: 0 pass or SKIP (no built tree, no browser, no data, no token) · 1 fail.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'DASHBOARD-GEOCODER-PROVIDER'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const skip = (why) => { console.log(`${TAG}: SKIP — ${why}`); process.exit(0) }

const { TREE_NAME } = await import(join(ROOT, 'internal', '_tree-name.mjs'))
const MANIFEST = join(ROOT, 'public', TREE_NAME, 'manifest.json')
if (!existsSync(MANIFEST)) skip('no built manifest (run `bun run tree` first).')
let chromium
try { ({ chromium } = await import('../../../internal/lib/playwright-guarded.mjs')) } catch { skip('playwright is not installed.') }

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
// The token ladder every other browser gate here uses: env first, then the build config. Presence
// is reported; the value never is.
const TOKEN = (() => {
  if (process.env.MAPBOX_TOKEN) return process.env.MAPBOX_TOKEN
  try { return JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8')).token || '' } catch { return '' }
})()
// ★ A LEAF THAT MOUNTS THE SEARCH BAR, or the suggestion half proves nothing (2026-09-26: the
// research-dashboard leaf renders no bar, so every run passed with "search bars: 0" — a hollow PASS).
// Default: the research map, which mounts the library GeocoderComponent. --leaf <bundle>/<profile>.
const leafArg = (() => { const i = process.argv.indexOf('--leaf'); return i >= 0 ? process.argv[i + 1] : 'doxa-research-map/research-map' })()
const [wantBundle, wantProfile] = leafArg.split('/')
const bundle = (manifest.bundles || []).find((b) => b.bundle === wantBundle)
const profile = bundle && (bundle.profiles || []).find((p) => p.iframeUrl && (!wantProfile || p.profile === wantProfile))
if (!profile) skip(`the manifest declares no ${leafArg} leaf to load.`)

const freePort = () => new Promise((ok) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
})
const PORT = await freePort()
const TREE = `http://127.0.0.1:${PORT}/${TREE_NAME}`
const LEAF = `${TREE}/${String(profile.iframeUrl).replace(/^\.\//, '')}`
const tree = spawn(process.execPath, ['internal/serve-strict.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' })
const cleanup = () => { try { tree.kill() } catch { /* already gone */ } }
await new Promise((r) => setTimeout(r, 900))
if (!await fetch(`${TREE}/manifest.json`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false)) {
  cleanup(); skip('could not serve the built tree locally.')
}
const { requireThisTree } = await import(join(ROOT, 'internal', '_serves-this-tree.mjs'))
await requireThisTree(TREE, ROOT, TAG)

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })
const fails = []
const lines = []
try {
  // ★ THE MAPBOX HALF IS MEASURED ON BOTH TOKEN RUNGS, AND THAT IS A DELIBERATE EXPERIMENT.
  // gates:post at 1a761741 WITH a token: the mapbox half reported "NO map constructed", 21
  // requests to api.mapbox.com, 0 bars — while a separate probe of THIS leaf at
  // ?provider=mapbox&tk=<same token> constructed a Mapbox map. The suggested cause was that the
  // generated leaf overwrites the window.MAP_TOKEN this gate sets in addInitScript.
  //
  // IT DOES NOT. research-map/index.html reads it at line 70 (`HOST_TOKEN = window.MAP_TOKEN`) and
  // every assignment after it — lines 71, 109, 150 — is guarded by `!window.MAP_TOKEN`, so a
  // host-set value is read and never replaced. studio read the same lines independently. The
  // hypothesis is the obvious one and the source does not support it.
  //
  // So rather than switch channels on a mechanism nobody can point at, the gate now measures BOTH:
  // the host global that partners use, and the ?tk= URL rung. If both construct, the earlier
  // failure was this gate's and is gone. If ONLY ?tk= constructs, that is a PRODUCT defect on the
  // host-global rung — the one an embedding partner reaches for — and the gate will say so by
  // name instead of leaving a one-line change to look like a fix.
  //
  // The maplibre case carries NO token by either route: resolveMapProvider's `auto` rung reads a
  // token as "use Mapbox", and a present token is exactly the variable this gate holds at zero.
  const CASES = [{ id: 'maplibre', provider: 'maplibre', rung: 'none' }]
  if (TOKEN) CASES.push(
    { id: 'mapbox/window.MAP_TOKEN', provider: 'mapbox', rung: 'global' },
    { id: 'mapbox/?tk=', provider: 'mapbox', rung: 'url' },
  )
  for (const c of CASES) {
    const engine = c.provider
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const mapboxCalls = []
    // ★ STATUSES TOO, not just counts. "21 requests and no map" is ambiguous between a token that
    // was never seen, one that was REJECTED, and a map that failed for an unrelated reason — and
    // the three have different owners. A 401 says the key, not the code.
    const mapboxBad = []
    page.on('request', (r) => { const u = r.url(); if (u.includes('api.mapbox.com')) mapboxCalls.push(u) })
    page.on('response', (r) => { if (r.url().includes('api.mapbox.com') && r.status() >= 400) mapboxBad.push(r.status()) })
    if (c.rung === 'global') await page.addInitScript((tk) => { window.MAP_TOKEN = tk }, TOKEN)
    // ★ ASK THE ENGINE, NOT THE DOM, WHETHER A MAP EXISTS. See the header note; borrowed from
    // the token-rung probe (tokrung.mjs), which measured this leaf correctly while this gate did not. Both globals
    // are hooked because the leaf loads only the engine its provider asks for.
    await page.addInitScript(() => {
      window.__mapsBuilt = { mapbox: 0, maplibre: 0 }
      const hook = (name) => {
        let real
        Object.defineProperty(window, name, {
          configurable: true,
          get: () => real,
          set: (gl) => {
            real = gl
            try {
              const Ctor = gl && gl.Map
              if (Ctor && !Ctor.__counted) {
                Ctor.__counted = true
                const setStyle = Ctor.prototype.setStyle
                Ctor.prototype.setStyle = function (...a) {
                  window.__mapsBuilt[name === 'mapboxgl' ? 'mapbox' : 'maplibre']++
                  return setStyle.apply(this, a)
                }
              }
            } catch (_) { /* a hook must never be the reason a page fails */ }
          },
        })
      }
      hook('mapboxgl'); hook('maplibregl')
    })
    const url = `${LEAF}?provider=${engine}` + (c.rung === 'url' ? `&tk=${encodeURIComponent(TOKEN)}` : '')
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(20000)

    const search = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const seen = new Set(); const hits = []
      const walk = (root) => {
        if (!root || seen.has(root)) return
        seen.add(root)
        for (const el of root.querySelectorAll('*')) {
          // ★ WIDER THAN THE PLUGIN'S OWN CLASS. This matched only
          // input.mapboxgl-ctrl-geocoder--input and reported 0 bars on a leaf carrying three
          // visible search inputs. Whether the miss was the class or the shadow walk cannot be told
          // from here, and that is the point: a selector narrow enough that one wrong assumption
          // yields ZERO accuses the product of being broken when it is only wrong about a name.
          if (el.matches && el.matches(
            'input.mapboxgl-ctrl-geocoder--input, input.maplibregl-ctrl-geocoder--input,'
            + ' .mapboxgl-ctrl-geocoder input, .maplibregl-ctrl-geocoder input,'
            + ' input[type="search"], input[placeholder*="Search" i]')) hits.push(el)
          if (el.shadowRoot) walk(el.shadowRoot)
        }
      }
      // Did an engine actually construct a map? A canvas is the one artefact both engines share,
      // and it tells "the bar was removed" apart from "there was never a map to hang it on".
      // The engine hook is the answer; the canvas walk stays only as a second opinion, so an engine
      // that stops routing through setStyle degrades to the old behaviour instead of accusing the
      // product.
      const built = window.__mapsBuilt || {}
      let mapReady = !!(built.mapbox || built.maplibre)
      if (!mapReady) for (const root of seen) { if (root.querySelector && root.querySelector('canvas.mapboxgl-canvas, canvas.maplibregl-canvas, .mapboxgl-map canvas, .maplibregl-map canvas')) { mapReady = true; break } }
      if (!hits.length) return { bars: 0, suggestions: 0, mapReady }
      const input = hits[0]
      input.focus()
      input.value = 'Afar'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 40; i++) {
        await sleep(500)
        const root = input.getRootNode()
        const n = root.querySelectorAll('.mapboxgl-ctrl-geocoder .suggestions li, .maplibregl-ctrl-geocoder .suggestions li, .suggestions li').length
        if (n) return { bars: hits.length, suggestions: n, mapReady }
      }
      return { bars: hits.length, suggestions: 0, mapReady }
    })
    await page.close()

    const bad = mapboxBad.length ? ` · REJECTED responses: ${mapboxBad.length} (${[...new Set(mapboxBad)].join(', ')})` : ''
    lines.push(`  · ${c.id.padEnd(22)} api.mapbox.com requests: ${mapboxCalls.length} · map: ${search.mapReady ? 'yes' : 'NO'} · search bars: ${search.bars} · suggestions for "Afar": ${search.suggestions}${bad}`)

    if (engine === 'maplibre') {
      // THE HEADLINE. One request sends the visitor's IP to Mapbox and breaks the keyless promise,
      // whatever the page looks like afterwards.
      if (mapboxCalls.length) {
        fails.push(`[${c.id}] the leaf made ${mapboxCalls.length} request(s) to api.mapbox.com:`)
        for (const u of [...new Set(mapboxCalls)].slice(0, 8)) fails.push(`      ${u.slice(0, 150)}`)
      }
      // A bar is OPTIONAL here and its absence is the documented contract (see the header). What is
      // NOT optional is that a bar, if present, works — otherwise a future keyless geocoder could
      // ship broken and this gate would read it as a clean zero.
      if (!search.bars) {
        lines.push('    (no search bar under maplibre — the documented contract: research-map.vue hasGeocoder = provider === \'mapbox\', because GeocoderComponent\'s maplibre path still geocodes through Mapbox. An absent bar is the strongest form of the zero above.)')
      } else if (!search.suggestions) {
        fails.push('under maplibre a search bar rendered but typing produced no suggestions — if a keyless geocoder now ships it has to work, not merely be quiet.')
      }
    } else {
      // MAPBOX: the bar is the feature this profile was built around, and it must still work.
      // `mapReady` separates "the bar was removed" from "the map never constructed", which are
      // different bugs with the same symptom — and the second one is how this gate misread itself.
      if (!search.bars) {
        const rung = c.rung === 'global' ? 'the HOST GLOBAL rung (window.MAP_TOKEN, what an embedding partner sets)' : 'the ?tk= URL rung'
        if (!search.mapReady) {
          fails.push(mapboxBad.length
            ? `[${c.id}] NO map constructed and ${mapboxBad.length} api.mapbox.com response(s) came back ${[...new Set(mapboxBad)].join('/')} — the token reached Mapbox and was REFUSED. That is the key, not the code.`
            : `[${c.id}] NO map constructed, via ${rung}, with a token supplied and no rejected responses. The leaf never overwrites a host-set window.MAP_TOKEN (index.html:70 reads it, :71/:109/:150 are all guarded), so if the other rung constructs and this one does not, this is a PRODUCT defect on the rung partners use — not this gate.`)
        } else {
          fails.push(`[${c.id}] the map constructed but rendered NO search bar — hasGeocoder or the GeocoderComponent mount is broken.`)
        }
      } else if (!search.suggestions) {
        fails.push(`[${c.id}] the search bar rendered but typing produced no suggestions.`)
      }
    }
  }
} catch (err) {
  fails.push(`the measurement itself failed: ${err && err.message}`)
} finally {
  await browser.close().catch(() => {})
  cleanup()
}

for (const l of lines) console.log(l)
if (fails.length) {
  console.log(`\n${TAG}: FAIL`)
  for (const f of fails) console.log(`  ✗ ${f}`)
  process.exit(1)
}
if (!TOKEN) {
  // Half-measured is not a pass. run-parallel reads a `TAG: SKIP` line and prints ⊘, so the wave
  // cannot report this as one of N gates that graded something. Exit 0: nothing FAILED.
  console.log(`${TAG}: SKIP — maplibre measured and clean; the mapbox half needs a key and none was supplied.`)
  console.log('  Set MAPBOX_TOKEN in the environment, or `token` in vite.doxa-maps-build-config.json, to measure it.')
  process.exit(0)
}
console.log(`${TAG}: PASS — MapLibre calls Mapbox zero times, and Mapbox searches on both token rungs.`)
