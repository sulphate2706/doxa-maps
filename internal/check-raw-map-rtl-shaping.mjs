#!/usr/bin/env node
/**
 * check-raw-map-rtl-shaping — the RAW maps (built with `new gl.Map`, not useMapInstance) must
 * shape Arabic, Hebrew and Persian place names.
 *
 * gospel's check-gospel-rtl-shaping.mjs (b9dd5545) established the method on resources-map; this
 * is the same gate for the other raw maps: cities-internet/connectivity-map (both engines) and
 * key-cities/cities-map (Mapbox-only; gated, so it has no leaf page and is mounted on a
 * same-origin host page). Read that file's header for the full reasoning; the load-bearing parts:
 *
 *   - WHY IT MATTERS TO EVERYONE: these maps do not localise basemap labels, so each place is drawn
 *     in its OWN script. Over the Middle East most labels are Arabic/Persian/Hebrew for EVERY
 *     viewer in every UI language. Unshaped = disconnected glyphs in the wrong order.
 *   - IT PANS FIRST: the shaper registers lazily and reads 'deferred' at a world view. Only after
 *     RTL labels are really on screen does 'loaded' mean they went through the shaper. No RTL label
 *     on screen is NOT MEASURED, never PASS.
 *   - ONE property definition per engine global does both the map hook and the poison: two
 *     addInitScript defineProperty calls on one global silently replace each other.
 *
 * WHY THE FIX HAS TO BE IN THE MAP, NOT THE ENTRY: bundle entries used to call setRTLTextPlugin at
 * load time, which only worked because every leaf <head> preloaded mapbox-gl.js. The engine is now
 * injected lazily (ensureEngineScript), after the entry has run, so the call has to follow the
 * engine global and precede `new gl.Map`: installRtlTextPlugin(gl) from library/maps/rtl-text.js.
 *
 * --poison neuters setRTLTextPlugin in the page (the real pre-fix state) and must be caught on
 * every measured row. Exit: 0 pass · 1 fail · 2 not measured.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { serveReaped } from './_serve-reaped.mjs'
import { TREE_NAME } from './_tree-name.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.RTL_RAW_PORT || 5394)
const POISON = process.argv.includes('--poison')
const TK = process.env.MAPBOX_TOKEN || JSON.parse(readFileSync(resolve(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8')).token || ''
const BASE = `http://127.0.0.1:${PORT}/${TREE_NAME}`
/* Arabia: the densest concentration of rendered Arabic on the basemap. */
const RTL_VIEW = { center: [39.2, 24.5], zoom: 5 }

const HOST_PATH = `${TREE_NAME}/key-cities/__rtl-host.html`
const TARGETS = [
  ...['mapbox', 'maplibre'].map((provider) => ({
    name: 'cities-internet', provider,
    url: `${BASE}/cities-internet/connectivity-map/index.html?provider=${provider}&lang=ar` + (provider === 'mapbox' ? `&tk=${TK}` : ''),
  })),
  { name: 'key-cities', provider: 'mapbox', url: `http://127.0.0.1:${PORT}/${HOST_PATH}`, host: true },
]
const HOST_HTML = `<!DOCTYPE html><html lang="ar"><head><meta charset="utf-8"></head><body style="margin:0">
<script src="/${TREE_NAME}/key-cities/key-cities.js"></script>
<key-cities-map profile-config='{"profile":"cities-map","tk":"${TK}","lang":"ar"}' style="display:block;height:800px"></key-cities-map>
</body></html>`

const srv = serveReaped(resolve(ROOT, 'public'), PORT)
await new Promise((r) => setTimeout(r, 2500))
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

const INSTALL = (poison) => {
  const define = (name) => {
    let v
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => v,
      set: (g) => {
        v = g
        if (!g) return
        if (poison && g.setRTLTextPlugin) g.setRTLTextPlugin = () => {}
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
for (const t of TARGETS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(INSTALL, POISON)
  if (t.host) await page.route(/__rtl-host\.html/, (r) => r.fulfill({ contentType: 'text/html', body: HOST_HTML }))
  let r
  try {
    await page.goto(t.url, { waitUntil: 'networkidle', timeout: 90000 })
    await page.waitForTimeout(8000)
    r = await page.evaluate(async (view) => {
      const m = window.__MAP
      if (!m) return { err: 'the page never constructed a map' }
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
      // Wait for the style before moving: an unloaded style answers ZERO features.
      for (let i = 0; i < 60 && !m.isStyleLoaded(); i++) await sleep(500)
      m.jumpTo(view)
      await new Promise((res) => { m.once('idle', res); setTimeout(res, 15000) })
      let names = []
      for (let i = 0; i < 30; i++) {
        names = m.queryRenderedFeatures()
          .filter((f) => f.layer && f.layer.type === 'symbol')
          .map((f) => String((f.properties && (f.properties.name || f.properties.name_en)) || ''))
          .filter(Boolean)
        if (names.some((n) => /[؀-ۿݐ-ݿ֐-׿]/.test(n))) break
        await sleep(1000)
      }
      // the engine that built THIS map, not whichever global happens to exist
      const g = (window.maplibregl && m instanceof window.maplibregl.Map) ? window.maplibregl : window.mapboxgl
      return {
        rtl: names.filter((n) => /[؀-ۿݐ-ݿ֐-׿]/.test(n)),
        symbols: names.length,
        status: g && g.getRTLTextPluginStatus ? g.getRTLTextPluginStatus() : 'NO STATUS API',
      }
    }, RTL_VIEW)
  } catch (e) {
    r = { err: String(e.message).slice(0, 90) }
  }
  await page.close()
  results.push({ ...t, ...r })
}
await browser.close()
srv.stop()

let bad = 0, unmeasured = 0
for (const r of results) {
  const tag = `${r.name} ${r.provider}`
  if (r.err) { console.error(`  ${tag}: NOT MEASURED — ${r.err}`); unmeasured++; continue }
  if (!r.rtl.length) {
    console.error(`  ${tag}: NOT MEASURED — no RTL label rendered at the test view (${r.symbols} symbols); the gate cannot see the defect here.`)
    unmeasured++; continue
  }
  const sample = r.rtl.slice(0, 3).join(', ')
  if (r.status !== 'loaded') {
    console.error(`  ${tag}: FAIL — ${r.rtl.length} RTL labels on screen (${sample}) but the shaper is '${r.status}'. These labels are drawn unshaped.`)
    bad++; continue
  }
  console.log(`  ok   ${tag} — ${r.rtl.length}/${r.symbols} rendered labels are RTL (${sample}), shaper loaded`)
}
const measured = results.length - unmeasured
if (POISON) {
  if (unmeasured) { console.error(`RAW-RTL --poison: NOT MEASURED — ${unmeasured} row(s) had nothing to judge, so the self-test proves nothing for them.`); process.exitCode = 2 }
  else if (bad === measured) { console.log(`RAW-RTL --poison: ${bad}/${measured} rows caught with the plugin neutered.`); console.log('RAW-RTL: SELF-TEST PASS — the check fails as designed.') }
  else { console.error('RAW-RTL: SELF-TEST FAIL — a neutered shaper still passed.'); process.exitCode = 1 }
} else if (bad) {
  console.error(`RAW-RTL: FAIL — ${bad} of ${results.length} row(s) draw RTL place names unshaped.`)
  console.error('  Fix: installRtlTextPlugin(gl) from library/maps/rtl-text.js, right after the engine global')
  console.error('  resolves and BEFORE new gl.Map.')
  process.exitCode = 1
} else if (unmeasured) {
  console.error(`RAW-RTL: NOT MEASURED — ${unmeasured} of ${results.length} row(s) could not be judged.`); process.exitCode = 2
} else console.log(`RAW-RTL: PASS — cities-internet (both engines) and key-cities shape RTL place names.`)
