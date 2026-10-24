#!/usr/bin/env node
/**
 * verify-map-paint.mjs — prove a map LEAF ACTUALLY PAINTS, not just that it lays out.
 *
 * ★ WHY THIS EXISTS (the constraint it removed, 2026-09-20)
 *   For most of this project the standing rule was "the VPS has no WebGL, so judge maps by
 *   'data loads, 0 404s'". That rule was WRONG — or rather, it was a property of ONE browser
 *   launch, not of the machine. The MCP-managed Playwright browser genuinely has no GL
 *   (canvas.getContext('webgl') returns null, and Mapbox logs "unable to create webgl context"),
 *   but a repo-local Chromium launched with the SwiftShader flags below reports:
 *       WebGL 2.0 (OpenGL ES 3.0 Chromium)
 *       ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
 *   and every map paints with ZERO console errors.
 *
 *   The lesson worth keeping: "Chromium has WebGL" is a claim about a LAUNCH CONFIGURATION,
 *   not about Chromium. Two agents disagreed about this and BOTH were right about different
 *   browsers. Check the launch, not the platform.
 *
 * ★ WHAT A FULL-SIZE CANVAS DOES NOT PROVE
 *   Mapbox CREATES the <canvas> at full size and only THEN tries for a GL context. So
 *   "canvas is 1440x900" is evidence of LAYOUT, never of PAINT. This script separates them:
 *   it asserts a LIVE GL context on the canvas, zero console errors, and that Mapbox emitted
 *   its attribution (which it only does once tiles are actually loading).
 *
 * USAGE
 *   node internal/verify-map-paint.mjs                        # the default leaf set, live
 *   node internal/verify-map-paint.mjs <url> [<url> ...]      # explicit leaves
 *   BASE=http://localhost:8080 node internal/verify-map-paint.mjs   # a locally served tree
 *
 * Exits non-zero if any leaf fails, so it can become a gate.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { requirePublishedTreeUrl } from './_published-base.mjs'

// The SwiftShader launch. Without these a headless Chromium here has NO GL context at all.
const GL_ARGS = [
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--no-sandbox',
]

const BASE = process.env.BASE || requirePublishedTreeUrl('VERIFY-MAP-PAINT')
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(BASE, ROOT, 'MAP-PAINT')
// ★ WIDENED 2026-09-22 — 4 of 12 map profiles were covered, now 11.
// The four originals were the ones that happened to be under investigation when this file was
// written. Measuring the manifest showed 12 profiles carry isMap=true, so EIGHT painted leaves
// were ungated — including BOTH cap-4 composites, and dashboard-plus-grid is tab-1 of the cap-5
// SPA. A paint gate that skips the flagship view is a gate over the easy cases.
// Every leaf added below was run through this script first and PASSED before being listed; a gate
// must start green, or it gets disabled and protects nothing.
//
// my-upg-100-list/poster-wall IS NOT LISTED, and the reason CHANGED on 2026-09-24.
// This block used to read: "correctly flagged isMap — makeHiddenMap() constructs a real gl.Map,
// built ON DEMAND during poster export, off-screen at left:-9999px, so at page load there is no
// canvas". Every clause was true of the SOURCE and false of the RUNNING PRODUCT: that function
// had ZERO call sites. It was the only caller of loadPoster(), EXPORT_SPEC was never read, and
// the whole chain was unreachable — a hidden-map export pipeline from before export took the
// shipped .webp or rasterised posters/<id>.html in the browser.
// The profile was flagged isMap only because isMapLeaf() in generate-tree.mjs is a REGEX over
// FILE TEXT: the engine handle inside the dead function matched it. So this gate was excluding a
// profile on the strength of code that never ran, with a justification that read as a measured
// product fact. Deleting the dead chain flipped the manifest to isMap=false, which is correct —
// the poster wall is a wall of cards, not a map. It is absent now because it IS NOT A MAP, not
// because it is a map this gate cannot see. Its poster path is covered by
// check:poster-print-fallback and check:poster-raster.
const DEFAULT_LEAVES = [
  'gospel-resources/resources-map/index.html',
  'cities-internet/connectivity-map/index.html',
  'doxa-research-map/research-map/index.html',
  'all-people-groups/all-people-groups/index.html',
  // added 2026-09-22, each verified PASS before listing
  'country-posters/countries-map/index.html',
  'dashboard-plus-grid/dashboard-plus-grid/index.html',
  'demo-map/demo-map/index.html',
  'doxa-simple-map/doxa-simple-map/index.html',
  'my-upg-100-list/upg-100-list/index.html',
  'my-upg-100-list/upg-100-mfe/index.html',
  'research-dashboard/research-dashboard/index.html',
  // added 2026-09-25 (the regions map was never painted by this gate), verified PASS local and live
  'regions-dashboard/region-dashboards/index.html',
  'regions-dashboard/regions-mfe/index.html',
]

const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_LEAVES.map((p) => BASE.replace(/\/$/, '') + '/' + p)

const browser = await chromium.launch({ headless: true, args: GL_ARGS })

// Fail fast + loudly if the GL flags stopped working, rather than reporting every map as broken.
const probe = await browser.newPage()
const gl = await probe.evaluate(() => {
  const c = document.createElement('canvas')
  const g = c.getContext('webgl2') || c.getContext('webgl')
  if (!g) return null
  const d = g.getExtension('WEBGL_debug_renderer_info')
  return { version: g.getParameter(g.VERSION), renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?' }
})
await probe.close()
if (!gl) {
  console.error('MAP-PAINT: FAIL — no WebGL context even WITH the SwiftShader flags.')
  console.error('  This is an ENVIRONMENT failure, not a map failure. Do not report the maps as broken.')
  await browser.close()
  process.exit(2)
}
console.log('MAP-PAINT: GL ok —', gl.version, '/', gl.renderer)

/**
 * ★ SAY WHICH TREE WAS MEASURED (2026-09-25) — this gate defaults to the DEPLOYED site, and a
 * failure line that does not say so reads as "your code is broken" when it means "your code is
 * not deployed yet". MEASURED TWICE IN ONE DAY, both times wrongly: resources-map and
 * connectivity-map both reported FAIL ("the stylesheet is ABSENT here") against the live test host
 * while the fix for exactly that defect was sitting, verified, on disk. Served locally, the
 * same gate passed all 13 leaves.
 *
 * The identity guard cannot close this. requireThisTree fingerprints manifest.json to catch the
 * WRONG WORKTREE on a localhost port, and it deliberately returns ok for a remote target — a
 * deployment is not a worktree, and lagging behind HEAD is its normal state, not a fault. So the
 * guard is right and the OUTPUT was the thing at fault: the one number needed to tell the two
 * failures apart was never on screen.
 */
const LOCAL = /^https?:\/\/(localhost|127\.|\[?::1\]?)/i.test(BASE)
console.log(
  `MAP-PAINT: measuring ${LOCAL ? 'THIS TREE' : 'the DEPLOYED site'} — ${BASE}` +
    (LOCAL ? '' : ' (set BASE=http://127.0.0.1:<port>/doxa-maps to measure local work)'),
)

/**
 * ★ CLASSIFY CONSOLE ERRORS, DO NOT COUNT THEM (2026-09-21) — the same correction made to
 * verify-5-capabilities.mjs, for the same measured reason. This gate barred on
 * `errors.length === 0`, which fails a map that paints perfectly whenever the ENVIRONMENT is
 * imperfect. Two named external causes, both observed:
 *   · LADDER FALLTHROUGH — the token ladder is designed to try rungs in order; an earlier rung
 *     failing while a later one succeeds is the design working.
 *   · MAPBOX 403 — the shared pk. token is URL-restricted to doxa.life, so tileset requests 403
 *     from any other origin and Mapbox then throws its own internal errors BECAUSE of them.
 * Anything UNRECOGNISED still fails by name, and this file already asserts `!r.asksForToken`,
 * which is the terminal "no token at all" case — so exhaustion is still caught independently.
 */
const TOKEN = (process.env.MAPBOX_TOKEN || '').trim()
if (TOKEN) console.log(`MAP-PAINT: token supplied (${TOKEN.length} chars) — maps can reach their style.`)
else console.log('MAP-PAINT: NO token — leaves that depend on the ladder may not mount at all.')

const ENVIRONMENTAL = [
  { name: 'ladder-fallthrough', re: /Access to fetch at .*\/api\/maps\/token|\/api\/maps\/token/i },
  { name: 'mapbox-403',         re: /\b403\b|Failed to load resource|api\.mapbox\.com\/mapbox-gl-js|^qt\b|^\s*at https:\/\/api\.mapbox\.com/i },
]
const splitErrors = (lines) => {
  const env = [], real = []
  for (const l of lines) {
    const hit = ENVIRONMENTAL.find((c) => c.re.test(l))
    if (hit) env.push(`${hit.name}: ${l.slice(0, 60)}`); else real.push(l)
  }
  return { env, real }
}

// Opt-in viewport for a phone pass (GATE_VIEWPORT=390x844); the default is unchanged.
const GATE_VIEWPORT = (() => { const m = /^(\d+)x(\d+)$/.exec(process.env.GATE_VIEWPORT || ''); return m ? { width: +m[1], height: +m[2] } : null })()
let bad = 0
for (const url of urls) {
  const name = url.split(`/${TREE_NAME}/`)[1] || url
  const page = await browser.newPage({ viewport: GATE_VIEWPORT || { width: 1280, height: 800 } })
  const errors = []
  // ⚠ THE STYLESHEET COMPLAINT IS A WARNING, NOT AN ERROR, so filtering to type()==='error' above
  // meant this gate could never see it. Mapbox emits "This page appears to be missing CSS
  // declarations for Mapbox GL JS" from _detectMissingCSS() — its own verdict that the rules its
  // controls and markers depend on did not reach the map. MEASURED 2026-09-24 on upg-100-list while
  // the shadow root was injecting a v3.3.0 stylesheet against v3.24.0 JS: the warning fired and the
  // gate reported PASS, because nothing was listening for it.
  const cssWarnings = []
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error') errors.push(t.slice(0, 160))
    if (/missing CSS declarations/i.test(t)) cssWarnings.push(t.slice(0, 120))
  })

  // ★ CARRY A TOKEN IF ONE IS OFFERED (2026-09-21) — the same wiring verify-5-capabilities.mjs
  // already has, and for the same reason: without it this gate cannot pass while the
  // /api/maps/token outage stands, because the element never mounts at all. Classifying the
  // console noise was necessary but NOT sufficient — a gate that can never pass is still a gate
  // that gets ignored. Unset, behaviour is unchanged, so a real token-plumbing break still shows.
  //   MAPBOX_TOKEN=$(curl -s <endpoint> | jq -r .token) bun run verify:map-paint
  // Both channels are needed: ?tk= reaches the TOP-LEVEL element's profile-config, while a
  // composite's NESTED children read the window.MAP_TOKEN global instead.
  if (TOKEN) await page.addInitScript((t) => { window.MAP_TOKEN = t }, TOKEN)
  const target = TOKEN ? url + (url.includes('?') ? '&' : '?') + 'tk=' + encodeURIComponent(TOKEN) : url

  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: 90000 })
  } catch (e) {
    console.error('  FAIL ' + name + ' — navigation: ' + String(e.message).slice(0, 70))
    bad++; await page.close(); continue
  }
  // Tiles need real time over the network; a short wait reports false failures.
  await page.waitForTimeout(15000)

  const r = await page.evaluate(() => {
    // ★ SHADOW DOM DOES NOT PIERCE — walk NESTED roots recursively (fixed 2026-09-20).
    //   A cap-4/cap-5 COMPOSITE mounts child custom elements, each with its OWN shadow root,
    //   so the map canvas lives one (or more) levels DOWN. A single-level
    //   `shadowRoot.querySelector('canvas')` can never see it and reports a perfectly working
    //   map as "no canvas". That false negative cost three wrong diagnoses of upg-100-mfe:
    //   "the Map tab is unwired", then "the pane has zero height" — while live measurement
    //   through nested roots showed a 1280x800 canvas with a live GL context the whole time.
    //   Flat leaves were unaffected, which is exactly why the blind spot survived: the gate
    //   passed the four single-level leaves and only lied about composites.
    const deep = (root, sel, out = []) => {
      out.push(...root.querySelectorAll(sel))
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deep(el.shadowRoot, sel, out)
      return out
    }
    const host = [...document.querySelectorAll('*')].find((e) => e.tagName.includes('-') && e.shadowRoot)
    const sr = host && host.shadowRoot
    if (!sr) return { shadow: false }
    // Prefer a canvas that actually HAS a GL context, at any depth.
    const canvases = deep(sr, 'canvas')
    const cv = canvases.find((c) => c.getContext('webgl2') || c.getContext('webgl')) || canvases[0] || null
    // Read ONLY user-visible copy: shadowRoot.textContent includes the injected <style>,
    // which has produced false "unavailable"/"error" matches before.
    const clone = document.createElement('div')
    for (const c of sr.children) if (c.tagName !== 'STYLE') clone.appendChild(c.cloneNode(true))
    clone.querySelectorAll('style').forEach((s) => s.remove())
    const text = clone.textContent.replace(/\s+/g, ' ').trim()
    return {
      shadow: true,
      canvas: cv ? cv.width + 'x' + cv.height : null,
      depth: canvases.length,
      // THE load-bearing assertion: a live GL context, not merely a sized canvas.
      glContext: cv ? !!(cv.getContext('webgl2') || cv.getContext('webgl')) : false,
      // Mapbox only emits attribution once tiles are actually loading. Search nested roots too:
      // in a composite the attribution control lives beside the canvas, inside the CHILD's root.
      attribution: /mapbox|openstreetmap/i.test(text) || deep(sr, '.mapboxgl-ctrl-attrib').length > 0,
      asksForToken: /paste|access token|pk\./i.test(text),
      // ⚠ THE ENGINE'S STYLESHEET MUST ACTUALLY APPLY, and nothing above could tell you whether it
      // did. Every assertion so far is satisfied by a map whose CSS never landed: the canvas is
      // sized, GL is live, tiles load, attribution renders — and the pins are GONE, because an
      // unstyled .mapboxgl-canvas-container computes position:STATIC instead of ABSOLUTE and every
      // absolutely-positioned child loses its anchor. That is a basemap with none of our data on it,
      // which is exactly what was reported while this gate reported PASS.
      //
      // MEASURED 2026-09-24 on upg-100-list: mapboxgl.version 3.24.0 running against a v3.3.0
      // stylesheet injected into the shadow root, canvas-container position:static, 0 markers.
      //
      // ★ DO NOT ASSERT ON THE URL OR THE VERSION STRING. Those are the ARTIFACT; a matching URL
      // proves nothing about whether the rules reached the map — a document stylesheet does not
      // cross a shadow boundary at all, so it can 200 and still style nothing.
      //
      // USE MAPBOX'S OWN TEST, which is the one thing guaranteed to track the stylesheet it ships.
      // Map._setupContainer() inserts a hidden div.mapboxgl-canary and _detectMissingCSS() warns
      // unless its computed background-color is exactly "rgb(250, 128, 114)" — the salmon set by
      // `.mapboxgl-canary{background-color:salmon}` in mapbox-gl.css, and by nothing else. Reading
      // the same property is reading Mapbox's verdict rather than a proxy for it.
      //
      // ⚠ I FIRST WROTE THIS AGAINST position:absolute ON .mapboxgl-canvas-container AND IT WAS
      // WRONG — v3.24.0 declares only cursor and touch-action for that element, so position:static
      // is its CORRECT computed value and the assertion would have failed every healthy map. The
      // canary's display was equally meaningless (block is the div default; the real rule is the
      // background colour). Verified against the shipped v3.24.0 CSS and JS, not assumed.
      //
      // Null (not false) when there is no canary — an engine that ships none, e.g. maplibre —
      // so "could not measure" never reads as a pass.
      cssApplied: (() => {
        const el = deep(sr, '.mapboxgl-canary')[0]
        if (!el) return null
        return getComputedStyle(el).backgroundColor === 'rgb(250, 128, 114)'
      })(),
    }
  })

  const { env, real } = splitErrors(errors)
  // cssApplied === false is a REAL failure; null means there was no container to measure, which the
  // shadow/glContext clauses already cover — do not fail twice for one cause.
  // TWO INDEPENDENT READINGS OF ONE PROPERTY, because each catches what the other misses.
  // The canary catches a stylesheet that is ENTIRELY ABSENT. Mapbox's own warning catches the
  // subtler case this gate was written for — a stylesheet that loaded but does not match the
  // running JS — which the canary CANNOT see, since `.mapboxgl-canary{background-color:salmon}`
  // is identical in v3.3.0 and v3.24.0. Measured: with the version skew restored, canary salmon
  // (assertion silent) while the warning fired. Asserting only the canary would have been a
  // false green on the exact defect that motivated it.
  const cssOk = r.cssApplied !== false && cssWarnings.length === 0
  const ok = r.shadow && r.glContext && r.attribution && !r.asksForToken && cssOk && real.length === 0
  if (ok) {
    console.log('  PASS ' + name + ' — canvas ' + r.canvas + ', live GL, attribution, '
      + (r.cssApplied === true ? 'engine CSS applied, ' : '') + '0 unclassified errors'
      + (env.length ? ` (${env.length} environmental ignored)` : ''))
  } else {
    bad++
    console.error('  FAIL ' + name)
    if (!r.shadow) console.error('       no shadow root / element never mounted')
    if (r.shadow && !r.glContext) console.error('       canvas ' + r.canvas + ' but NO live GL context — laid out, did not paint')
    if (r.shadow && !r.attribution) console.error('       no Mapbox/OSM attribution — tiles likely never loaded')
    if (r.cssApplied === false || cssWarnings.length) {
      console.error('       the engine STYLESHEET did not properly apply:')
      if (r.cssApplied === false) {
        console.error('         · mapbox-gl\'s canary is not salmon — the stylesheet is ABSENT here')
      }
      if (cssWarnings.length) {
        console.error('         · mapbox-gl warned: "' + cssWarnings[0] + '"')
        console.error('           (its own _detectMissingCSS verdict — the rules its controls,')
        console.error('            geocoder and markers depend on did not all reach the map)')
      }
      console.error('       The basemap can still paint correctly while the chrome around it is')
      console.error('       misplaced, which is why every other assertion here stays green.')
      console.error('       Usual cause: the stylesheet was added to document.head for a map that')
      console.error('       lives in a SHADOW ROOT — a document stylesheet does not cross a shadow')
      console.error('       boundary — or its version does not match the running JS.')
    }
    if (r.asksForToken) console.error('       UI is asking for a Mapbox token (host /api/maps/token not served)')
    // Keep the exemption's blast radius VISIBLE even on a failure — a silent exemption is how a
    // gate quietly stops testing anything.
    if (env.length) console.error(`       i ${env.length} environmental error(s) ignored -> ${env[0]}`)
    for (const e of real.slice(0, 3)) console.error('       console: ' + e)
  }
  await page.close()
}

await browser.close()
if (bad) {
  console.error('\nMAP-PAINT: FAIL — ' + bad + ' of ' + urls.length + ' leaves did not paint.')
  if (!LOCAL) {
    console.error(
      '  Measured ' + BASE + ' — the DEPLOYED site, which lags this checkout. Before treating a\n' +
        '  failure as a code defect, re-run against the local build; a fix that is committed but\n' +
        '  not yet published fails here for a reason that has nothing to do with the code.',
    )
  }
  process.exit(1)
}
console.log('\nMAP-PAINT: PASS — all ' + urls.length + ' leaves paint.')
