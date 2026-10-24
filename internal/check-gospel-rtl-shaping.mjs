#!/usr/bin/env node
/**
 * check-gospel-rtl-shaping — Arabic, Hebrew and Persian place names must be SHAPED.
 *
 * THE DEFECT. Mapbox and MapLibre cannot shape right-to-left scripts on their own; the
 * mapbox-gl-rtl-text plugin does it, and it has to be registered on the engine before the
 * first RTL label is drawn. Maps built through useMapInstance get that at line 416.
 * gospel-resources/resources-map builds its map RAW — `new gl.Map`, for the provider switch —
 * and in taking that path it opted out, exactly as it had opted out of the engine stylesheet.
 * Unshaped Arabic is not a subtly wrong font: the glyphs come out disconnected and in the
 * wrong order, which is unreadable to the people the map is for.
 *
 * WHY NOBODY REPORTED IT. This leaf does not localise basemap labels, so the style draws each
 * place in its OWN script — measured over Arabia, 57 of 61 rendered symbols are Arabic
 * (مصر, قطاع غزة, الأردن, السعودية) for EVERY viewer, whatever the UI language. An English
 * reader sees broken Arabic they cannot evaluate; an Arabic reader would have said something.
 *
 * WHAT THIS ASSERTS, AND WHY IT PANS FIRST. Registration alone is weak evidence: the plugin is
 * registered LAZILY, so a freshly loaded map reports 'deferred' whether or not the plugin can
 * actually be fetched and run. Status only becomes 'loaded' when the engine has encountered
 * real RTL text and pulled the shaper in. So the gate drives the map to Arabia, proves RTL
 * labels are genuinely on screen, and only then requires 'loaded' — the difference between
 * "someone called the setter" and "these labels went through a shaper".
 *   MEASURED: at the opening world-fit view Mapbox sits at 'deferred' with no RTL label
 *   rendered at that zoom. That is correct lazy behaviour, not a failure, and a gate that
 *   asserted 'loaded' without panning would have reported a false red on a working map.
 *
 * BOTH ENGINES, because the bug is per-engine and the leaf switches on ?provider=.
 *
 * Run with --poison to prove it can fail: the poison neuters setRTLTextPlugin in the page, which
 * reproduces the real pre-fix state — the plugin never registered — rather than a synthetic one.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { serveReaped } from './_serve-reaped.mjs'
import { TREE_NAME } from './_tree-name.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.RTL_SHAPE_PORT || 5393)
const POISON = process.argv.includes('--poison')
// ⚠ PARAMETERISED, not forked. This gate was routed to the other RAW-map owners
// (cities-internet, key-cities, upg-100-list, RegionCountryMap) — copying it would give each of
// them their own drifting copy of the pan-first logic and the poison arm, which are the two parts
// that took corrections to get right. The leaf is the only thing that differs.
//   node internal/check-gospel-rtl-shaping.mjs [--poison] [--leaf <TREE_NAME>/<bundle>/<profile>/index.html]
//
// ⚠ AND THE DEFAULT READS THE TREE NAME RATHER THAN SPELLING IT. The tree was renamed
// doxa-maps -> dx-maps; a default of "doxa-maps/..." 404s, and a probe reporting "0 problems"
// against a 404 reads exactly like success. The build config is the one place that knows.
const leafArg = process.argv.indexOf('--leaf')
const LEAF = (leafArg > -1 && process.argv[leafArg + 1])
  || process.env.RTL_SHAPE_LEAF
  || `${TREE_NAME}/gospel-resources/resources-map/index.html`
/* Arabia: the densest concentration of rendered Arabic on the basemap. */
const RTL_VIEW = { center: [39.2, 24.5], zoom: 5 }

const srv = serveReaped(resolve(ROOT, 'public'), PORT)
await new Promise((r) => setTimeout(r, 2500))

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

/**
 * ONE property definition per engine global, doing BOTH jobs.
 *
 * ⚠ THIS WAS THE GATE'S OWN FIRST BUG, and it is the reason the poison arm exists. The hook and
 * the poison were two separate addInitScript calls, each running Object.defineProperty on
 * window.mapboxgl — so the second SILENTLY REPLACED the first. The poison never applied, the
 * self-test reported the plugin loaded on a "poisoned" page, and had I read only the summary I
 * would have concluded the gate was too weak rather than that it had disabled itself.
 */
const INSTALL = (poison) => {
  const define = (name) => {
    let v
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => v,
      set: (g) => {
        v = g
        if (!g) return
        /* Reproduce the pre-fix state: the install call silently does nothing. */
        if (poison && g.setRTLTextPlugin) g.setRTLTextPlugin = () => {}
        /* Capture the Map the leaf builds, without the leaf exposing anything for tests. */
        if (g.Map && !g.__hooked) {
          g.__hooked = true
          const Orig = g.Map
          g.Map = function (...a) { const m = new Orig(...a); window.__MAP = m; return m }
          g.Map.prototype = Orig.prototype
          Object.setPrototypeOf(g.Map, Orig)
        }
      },
    })
  }
  define('mapboxgl'); define('maplibregl')
}

const results = []
for (const provider of ['mapbox', 'maplibre']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(INSTALL, POISON)
  let r
  try {
    await page.goto(`http://127.0.0.1:${PORT}/${LEAF}?provider=${provider}&lang=ar`, {
      waitUntil: 'networkidle', timeout: 90000,
    })
    await page.waitForTimeout(8000)
    r = await page.evaluate(async (view) => {
      const m = window.__MAP
      if (!m) return { err: 'the leaf never constructed a map' }
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
      /* ⚠ WAIT FOR THE STYLE BEFORE MOVING. Querying a map whose style has not finished loading
         returns ZERO features, which this gate would have read as "no RTL label rendered" — a
         NOT MEASURED on a perfectly good map. Measured: Mapbox reported 0 symbols on the first
         run for exactly this reason, while a slower probe of the same page saw 61. */
      for (let i = 0; i < 60 && !m.isStyleLoaded(); i++) await sleep(500)
      m.jumpTo(view)
      await new Promise((res) => { m.once('idle', res); setTimeout(res, 15000) })
      /* Tiles for the new view still arrive after 'idle'; poll until labels appear. */
      let names = []
      for (let i = 0; i < 30; i++) {
        names = m.queryRenderedFeatures()
          .filter((f) => f.layer && f.layer.type === 'symbol')
          .map((f) => String((f.properties && (f.properties.name || f.properties.name_en)) || ''))
          .filter(Boolean)
        if (names.some((n) => /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF]/.test(n))) break
        await sleep(1000)
      }
      const g = (window.maplibregl && window.maplibregl.getRTLTextPluginStatus)
        ? window.maplibregl : window.mapboxgl
      return {
        rtl: names.filter((n) => /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF]/.test(n)),
        symbols: names.length,
        status: g && g.getRTLTextPluginStatus ? g.getRTLTextPluginStatus() : 'NO STATUS API',
      }
    }, RTL_VIEW)
  } catch (e) {
    r = { err: String(e.message).slice(0, 90) }
  }
  await page.close()
  results.push({ provider, ...r })
}
await browser.close()
srv.stop()

let bad = 0
let unmeasured = 0
for (const r of results) {
  if (r.err) {
    console.error(`  ${r.provider}: NOT MEASURED — ${r.err}`)
    unmeasured++
    continue
  }
  /* No RTL text on screen means the gate cannot tell a shaped map from an unshaped one. That is
     NOT MEASURED, never a pass — the whole point of panning is to make the question answerable. */
  if (!r.rtl.length) {
    console.error(`  ${r.provider}: NOT MEASURED — no RTL label rendered at the test view ` +
      `(${r.symbols} symbols); the basemap changed and the gate can no longer see the defect.`)
    unmeasured++
    continue
  }
  const sample = r.rtl.slice(0, 3).join(', ')
  if (r.status !== 'loaded') {
    console.error(`  ${r.provider}: FAIL — ${r.rtl.length} RTL labels on screen (${sample}) ` +
      `but the shaper is '${r.status}'. These labels are drawn unshaped.`)
    bad++
    continue
  }
  console.log(`  ok   ${r.provider} — ${r.rtl.length}/${r.symbols} rendered labels are RTL ` +
    `(${sample}), shaper loaded`)
}

if (POISON) {
  if (bad === results.length) {
    console.log(`RTL-SHAPING --poison: ${bad}/${results.length} engines caught with the plugin neutered.`)
    console.log('RTL-SHAPING: SELF-TEST PASS — the check fails as designed.')
    process.exitCode = 0
  } else {
    console.error('RTL-SHAPING: SELF-TEST FAIL — the check cannot detect the bug it exists for.')
    process.exitCode = 1
  }
} else if (unmeasured) {
  console.error(`RTL-SHAPING: NOT MEASURED — ${unmeasured} of ${results.length} engines could not be judged.`)
  process.exitCode = 2
} else if (bad) {
  console.error(`RTL-SHAPING: FAIL — ${bad} of ${results.length} engines draw RTL place names unshaped.`)
  console.error('  Fix: installRtlTextPlugin(gl) from library/maps/rtl-text.js, right after the')
  console.error('  engine global resolves and BEFORE new gl.Map.')
  process.exitCode = 1
} else {
  console.log(`RTL-SHAPING: PASS — both engines shape RTL place names.`)
  process.exitCode = 0
}
