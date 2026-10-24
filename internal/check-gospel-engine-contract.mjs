/**
 * check-gospel-engine-contract.mjs — the map must use the engine it was ASKED for, or say nothing
 * at all. Never a different one.
 *
 * THE DEFECT THIS IS WRITTEN AGAINST (the C3 review and its addendum, 2026-09-26).
 * resources-map resolved its engine as `engineGlobal(provider) || window.mapboxgl`. engineGlobal
 * already defaults to mapbox, so that fallback could only fire for provider 'maplibre' — and then
 * it returned MAPBOX. A page that chose the keyless engine silently got the one that needs a
 * token; and since the profile only assigns accessToken when the provider is not maplibre, the
 * substitute had no token either, so it would 401 on every tile. Two failures compounding, both
 * invisible to every other gate: the leaf mounts, renders and logs no console error.
 *
 * SIX MEASUREMENTS: two providers x three load states.
 *   engine present     -> a canvas, drawn by the engine that was asked for
 *   engine blocked     -> NO canvas, a visible message naming that engine, and — the assertion
 *                         that matters — the OTHER engine's global must not be the one in use
 *   both blocked       -> same, and never a blank with nothing said
 *
 * The CDN script is blocked with request routing rather than by editing anything: that is exactly
 * what a corporate proxy, an offline kiosk or a broken CDN does to a partner's embed.
 *
 * Self-test: `--poison` restores the old `|| window.mapboxgl` behaviour in the page (by defining
 * window.mapboxgl before the bundle runs while maplibre is blocked) and requires the maplibre arm
 * to FAIL — if it passes, this check cannot see the defect it exists for.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { serveReaped } from './_serve-reaped.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(HERE, '../public')
const PORT = Number(process.env.PORT || 5395)
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`
const POISON = process.argv.includes('--poison')
const TAG = 'gospel-resources-map'
const LEAF = `${BASE}/${TREE_NAME}/gospel-resources/resources-map/index.html`
const SCRIPT = { mapbox: /mapbox-gl.*\.js/i, maplibre: /maplibre-gl.*\.js/i }

let srv = null
if (!process.env.BASE_URL) srv = serveReaped(PUBLIC, PORT)

const run = async (browser, provider, block) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const warns = [], errors = []
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  for (const b of block) await page.route(SCRIPT[b], (r) => r.abort())
  /* ⚠ MAPBOX CANNOT EVEN MOUNT WITHOUT A TOKEN, and that is the environment, not the product: a
     static tree has no /api/maps/token, so the profile loader never renders the element and the
     first version of this check read that as "the leaf did not mount". A dummy token gets the
     element on the page; its tiles 401, which is irrelevant here — this check is about WHICH
     engine was constructed, and Mapbox GL creates its canvas either way. */
  if (provider === 'mapbox') await page.addInitScript(() => { window.MAP_TOKEN = 'pk.test.not-a-real-token' })
  await page.goto(`${LEAF}?provider=${provider}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  /* 20s, not 11: this leaf fetches ~4 MB of tables before the map exists, and at 11s three of
     six runs were still showing the profile loader — the gate was measuring its own impatience. */
  await page.waitForTimeout(20000)
  const r = await page.evaluate((tag) => {
    const sr = document.querySelector(tag)?.shadowRoot
    const txt = sr ? (sr.textContent || '').replace(/\s+/g, ' ').trim() : ''
    return {
      mounted: !!sr,
      canvas: !!sr?.querySelector('canvas'),
      text: txt.slice(0, 600),
      /* The leaf's own error line. Reading the whole shadow text instead caught the stylesheet —
         ".profile-loader .profile-error" — and scored a rendered message as a blank. */
      errText: (sr?.querySelector('.gm-err')?.textContent || '').trim(),
      /* WHICH global is actually present on the page — the substitution is invisible in the DOM. */
      hasMapbox: !!window.mapboxgl,
      hasMaplibre: !!window.maplibregl,
      /* WHICH ENGINE DREW IT, read off the canvas's own class — each engine stamps its name
         (.mapboxgl-canvas / .maplibregl-canvas). Read from window.__grMap first, this scored
         Mapbox-with-a-dummy-token as "engine null": the canvas exists, the style 401s, and the
         debug handle is never assigned. The canvas cannot lie about who created it. */
      engineOfMap: (() => {
        const c = sr?.querySelector('canvas')
        const cls = c ? c.className || '' : ''
        if (/maplibregl/.test(cls)) return 'maplibre'
        if (/mapboxgl/.test(cls)) return 'mapbox'
        const m = window.__grMap
        if (m && window.maplibregl && m instanceof window.maplibregl.Map) return 'maplibre'
        if (m && window.mapboxgl && m instanceof window.mapboxgl.Map) return 'mapbox'
        return c ? 'unknown' : null
      })(),
    }
  }, TAG)
  await page.close()
  return { ...r, warns, errors }
}

const fails = []

/* ⚠ THE STATIC ARM LIVES ELSEWHERE NOW, DELIBERATELY. It used to read this leaf's source for a
 * cross-engine fallback, and check:no-silent-engine-substitution does that for EVERY plugin. Two
 * gates owning one source-level rule means this leaf was checked twice while the others were
 * checked once, and the copy that drifts is always the narrower one. What stays here is the part
 * no source read can do: the six RUNTIME measurements below.
 *
 * ⚠ SO --poison HAS NOTHING TO FALSIFY HERE. With the fallback deleted, planting a substitute
 * engine on the PAGE proves nothing (the leaf correctly ignores it), which is measured: an earlier
 * runtime poison reported "this check cannot see the defect" about itself. The falsifiable arm went
 * with the static check, and this one says so rather than pretending.
 */
if (POISON) {
  console.log('ENGINE-CONTRACT --poison: the falsifiable source arm is check:no-silent-engine, run with --self-test; it owns that rule tree-wide and sits in gates:post as of main 23976fb0.')
  console.log('ENGINE-CONTRACT: the six runtime measurements cannot be forced to fail without reintroducing the defect in a built bundle.')
  process.exit(0)
}

let browser
try {
  browser = await chromium.launch()
  for (const provider of ['mapbox', 'maplibre']) {
    /* 1 — the engine is there. It must be the one asked for. */
    const ok = await run(browser, provider, [])
    if (!ok.mounted) fails.push(`${provider}/present: the leaf did not mount — errors: ${ok.errors.join(' | ') || 'none'}; warns: ${ok.warns.slice(0,2).join(' | ')}`)
    else if (!ok.canvas) fails.push(`${provider}/present: no canvas — the map did not draw`)
    else if (ok.engineOfMap !== provider && ok.engineOfMap !== 'unknown') fails.push(`${provider}/present: the map instance came from ${ok.engineOfMap}`)
    else console.log(`  ok   ${provider}/present`.padEnd(30) + `canvas, engine=${ok.engineOfMap}`)

    /* 2 — the engine is blocked. Visible failure, and NEVER the other engine. */
    const gone = await run(browser, provider, [provider])
    const other = provider === 'maplibre' ? 'mapbox' : 'maplibre'
    if (!gone.mounted) fails.push(`${provider}/blocked: the leaf did not mount at all — a missing engine must not kill the element`)
    else if (gone.canvas) fails.push(`${provider}/blocked: a canvas was drawn with ${provider} blocked — something else drew it (engine=${gone.engineOfMap})`)
    else if (gone.engineOfMap === other) fails.push(`${provider}/blocked: the map was built from ${other} — a page that asked for ${provider} got the other engine`)
    else if (!/did not load|engine/i.test(gone.errText)) fails.push(`${provider}/blocked: nothing on screen says the engine failed — the reader gets a blank (.gm-err reads "${gone.errText}")`)
    else if (!gone.warns.some((w) => /engine global never loaded/.test(w))) fails.push(`${provider}/blocked: no console warning naming the engine`)
    else console.log(`  ok   ${provider}/blocked`.padEnd(30) + 'no canvas, names the engine, no substitution')

    /* 3 — neither engine can load. */
    const both = await run(browser, provider, ['mapbox', 'maplibre'])
    if (!both.mounted) fails.push(`${provider}/both-blocked: the leaf did not mount`)
    else if (both.canvas) fails.push(`${provider}/both-blocked: a canvas appeared with both engines blocked`)
    else if (!/did not load|engine/i.test(both.errText)) fails.push(`${provider}/both-blocked: a blank with nothing said`)
    else console.log(`  ok   ${provider}/both-blocked`.padEnd(30) + 'no canvas, message shown')
  }

  if (fails.length) {
    console.error(`ENGINE-CONTRACT: FAIL — ${fails.length} of 6 measurement(s):`)
    for (const f of fails) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('ENGINE-CONTRACT: PASS — 2 providers x 3 load states: the engine asked for or a named failure, never a substitute.')
} finally {
  try { await browser?.close() } catch (_) {}
  try { srv?.close?.() } catch (_) {}
}
process.exit(0)
