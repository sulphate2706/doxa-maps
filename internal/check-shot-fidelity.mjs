#!/usr/bin/env node
/**
 * check-shot-fidelity.mjs — warn when this machine cannot RENDER what the screenshots must SHOW.
 *
 * THE BUG THIS EXISTS TO PREVENT (real, 2026-09-21)
 * `bun run shots` reported `OK` for all 13 README screenshots. Every one loaded, mounted, and
 * produced zero console errors and zero HTTP>=400. Then I actually LOOKED at one: every sidebar
 * icon was a tofu box (□) and the locale switcher read "□□ English".
 *
 * ★ THE GENERATOR CANNOT SEE THIS. It asserts the page LOADED, not that it looks right — element
 * counts, console errors and HTTP status are all perfect when a glyph falls back to tofu. This is
 * the same class as check:shots (a stale screenshot looks exactly like a current one): the failure
 * is VISUAL and every programmatic signal says fine.
 *
 * WHAT IT ACTUALLY IS — AND WHY THAT MATTERS FOR THE FIX
 * Measured, not assumed: the DOM contains 27 correct emoji codepoints (🇺🇸 🧩 🔗 🗂) and
 * `fc-list | grep -ic emoji` returns 0 against 115 installed fonts. So the MARKUP IS CORRECT and a
 * real user's browser renders these fine. The defect belongs to the SHOT MACHINE, not the product.
 * That distinction decides the fix: install a font on the shooter — never "remove the emoji",
 * which would damage the shipped UI to satisfy a screenshot box.
 *
 * FIVE BUNDLES render emoji (doxa-maps-spa, doxa-research-map, doxa-simple-map, plugin-studio,
 * country-posters), and TWO of them were ALREADY in the README. So this silently degraded shipped
 * images before anyone shot the studio.
 *
 * WHY A WARNING AND NOT A HARD FAIL
 * Installing a font needs a network fetch of a binary onto this box — a product decision, not something
 * a screenshot refresh should do quietly. Until that is decided, failing the gate would block work
 * on a condition the operator cannot clear. So this REPORTS loudly and exits 0 by default; pass
 * --strict (or set SHOT_FIDELITY_STRICT=1) to make it blocking once a font is installed.
 *
 * ★ THE POINT IS THAT THE CONDITION IS NEVER AGAIN INVISIBLE. `bun run shots` printing 13x OK gave
 * no hint; this prints the reason the images will look wrong BEFORE they are committed.
 *
 * NEGATIVE-TESTED: with 0 emoji fonts present it REPORTS (and with --strict, EXITS 1). Point
 * FC_LIST at a stub that lists an emoji font and it PASSES.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STRICT = process.argv.includes('--strict') || process.env.SHOT_FIDELITY_STRICT === '1'

/** Bundles whose SOURCE renders emoji — these are the shots a missing font degrades. */
function emojiBundles() {
  const dir = join(ROOT, 'plugin-designs')
  if (!existsSync(dir)) return []
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u
  const hits = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || /^[_.]/.test(e.name)) continue
    const bdir = join(dir, e.name)
    for (const f of readdirSync(bdir)) {
      if (!f.endsWith('.vue')) continue
      const src = readFileSync(join(bdir, f), 'utf8')
      // Ignore the ★ used in this repo's doc-comments; look for real pictographic emoji.
      const body = src.replace(/★/g, '')
      if (EMOJI.test(body) || /\bemoji\b/.test(body)) { hits.push(e.name); break }
    }
  }
  return hits
}

/** Does this machine have ANY emoji-capable font? */
function emojiFontCount() {
  try {
    const out = execFileSync(process.env.FC_LIST || 'fc-list', [], { encoding: 'utf8' })
    return out.split('\n').filter((l) => /emoji/i.test(l)).length
  } catch {
    return null   // fc-list unavailable — cannot assess
  }
}

/**
 * Source files that request a Mapbox-hosted TILESET (`mapbox://mapbox.*`).
 *
 * ★ SECOND FIDELITY CLASS, found the same way as the first — by LOOKING at a screenshot
 * (2026-09-21). deploy3-research-dashboard.png shows a completely BLANK GREY map pane. The shot
 * reported OK: the page loaded, 1083 elements rendered, the legend and hint text painted. Only the
 * tiles were missing.
 *
 * WHY, measured rather than guessed: the shared pk. token is URL-restricted to doxa.life. Against
 * `mapbox://mapbox.country-boundaries-v1` — Referer doxa.life -> 200 (3/3), 127.0.0.1 -> 403,
 * no referer -> 403. The STYLE endpoint (styles/v1/mapbox/light-v11) returns 200 from EVERY origin,
 * which is exactly why most maps paint normally here and only the tileset-backed choropleth blanks.
 * A first reading of "style 200 / tileset 403 everywhere" looked like a missing tileset SCOPE;
 * re-testing with the doxa.life referer disproved that. Restriction, not scope.
 *
 * ★ THE COST OF NOT CATCHING THIS WAS NOT THE BLANK IMAGE. It was that a previous reader measured
 * "ZERO <canvas>" on this page and concluded the surface OWNS NO MAP — inverting a symptom into an
 * architectural fact, then relaxing the shot's readiness check to match. The defect got promoted to
 * a design note. Naming the condition explicitly is what stops that.
 */
function restrictedTilesetFiles() {
  const out = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (/^(node_modules|[_.])/.test(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(vue|js|mjs)$/.test(e.name)) continue
      if (/mapbox:\/\/mapbox\./.test(readFileSync(p, 'utf8'))) out.push(p.slice(ROOT.length + 1))
    }
  }
  walk(join(ROOT, 'plugin-designs'))
  walk(join(ROOT, 'library'))
  return out
}

/**
 * Map bundles whose BASEMAP comes only from Mapbox tiles — i.e. that render a blank void when
 * the token cannot fetch tilesets from this origin.
 *
 * ★ THE THIRD FIDELITY CLASS, and the widest (measured 2026-09-21 by looking at cap2-*.png).
 * All three doxa-simple-map shots show data dots floating on an empty dark field: no coastlines,
 * no country fills, no labels. `bun run shots` reported OK for every one — the page loads, the
 * element mounts, the legend and controls paint, the data layer is correct.
 *
 * ★ WHY IT IS INVISIBLE TO EVERY OTHER SIGNAL: the Mapbox STYLE DOCUMENT returns 200 from every
 * origin, so the map genuinely initialises. Only the TILESETS are restricted —
 * mapbox-streets-v8 (the basemap itself), mapbox-bathymetry-v2, country-boundaries-v1 all return
 * 403 off doxa.life and 200 with its referer. A booted map showing its own UI and its own data
 * looks like a working map; only the GEOGRAPHY is absent.
 *
 * ★ AND IT EXPLAINS A NEAR-MISDIAGNOSIS worth keeping: cap4-upg100-list.png paints coastlines and
 * country fills perfectly, which made the blank cap-2 maps look like a per-bundle bug. It is not —
 * my-upg-100-list SHIPS ITS OWN world-adm0.geojson and draws geography from self-hosted data
 * instead of tiles. Three bundles do that and survive; the other eight do not.
 *
 * NOTE the dark basemap in those shots is DELIBERATE, not a theme violation: useMapTheme's
 * lookForStrategy() keeps prayer/adoption/engagement on the night preset by design ("light and
 * darkness"), and only affinity/region/language go light. The missing TILES are the defect.
 */
function tileDependentMapBundles() {
  const dir = join(ROOT, 'plugin-designs')
  if (!existsSync(dir)) return []
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || /^[_.]/.test(e.name)) continue
    const bdir = join(dir, e.name)
    let usesMap = false, selfHosted = false
    const scan = (d) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (/^(node_modules|[_.])/.test(f.name)) continue
        const p = join(d, f.name)
        if (f.isDirectory()) { scan(p); continue }
        if (!/\.(vue|js|mjs)$/.test(f.name)) continue
        const src = readFileSync(p, 'utf8')
        if (/useMapInstance|mapbox-gl|bootStyle/.test(src)) usesMap = true
        if (/adm0/.test(src)) selfHosted = true
      }
    }
    scan(bdir)
    if (usesMap && !selfHosted) out.push(e.name)
  }
  return out
}

/**
 * ★ ASK THE TOKEN, DO NOT ASSERT ABOUT IT (added 2026-09-23).
 *
 * The two tileset findings below used to fire whenever any file referenced a `mapbox://` tileset,
 * and printed a hardcoded "127.0.0.1 -> 403" as though it were a live measurement. It WAS one, on
 * 2026-09-21, against the token that shipped then. The baked token has since been swapped
 * (commit 1b6316a) to one that is NOT URL-restricted, and the old sentences kept printing —
 * warning about a blank void while the shots came out fully painted.
 *
 * A gate that states a measured fact must re-measure it, or it becomes a confident lie at exactly
 * the moment someone fixes the thing it describes. So: fetch one real tile with the token the
 * bundles actually ship, sending no Referer, which is precisely what this shot machine does. 200
 * means the tileset findings do not apply and are suppressed; 403 means they do.
 *
 * Network failure is NOT treated as 403. An offline box cannot distinguish "restricted" from
 * "unreachable", and reporting a restriction that may not exist is the failure being fixed here.
 */
async function tilesetReachability() {
  let token = ''
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
    if (typeof cfg.token === 'string' && cfg.token.startsWith('pk.')) token = cfg.token
  } catch { /* no build config — fall through to unknown */ }
  if (!token) return { state: 'unknown', why: 'no pk. token baked in vite.doxa-maps-build-config.json' }
  const url = 'https://api.mapbox.com/v4/mapbox.country-boundaries-v1/3/4/3.vector.pbf?access_token=' + token
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (r.status === 200) return { state: 'reachable', why: 'country-boundaries-v1 -> 200 with no Referer, on the baked token' }
    if (r.status === 401 || r.status === 403) return { state: 'restricted', why: `country-boundaries-v1 -> ${r.status} with no Referer` }
    return { state: 'unknown', why: `country-boundaries-v1 -> HTTP ${r.status}` }
  } catch (e) {
    return { state: 'unknown', why: `tile probe did not complete (${e?.name || 'error'}) — offline is not a restriction` }
  }
}

const bundles = emojiBundles()
const fonts = emojiFontCount()
const tiles = await tilesetReachability()
const tilesetFiles = tiles.state === 'reachable' ? [] : restrictedTilesetFiles()
const tileBundles = tiles.state === 'reachable' ? [] : tileDependentMapBundles()
const findings = []   // every condition reports; no early exit hides a later one

console.log(`SHOT-FIDELITY: ${bundles.length} bundle(s) render emoji; emoji fonts on this box: ` +
            `${fonts === null ? 'UNKNOWN (no fc-list)' : fonts}`)
console.log(`SHOT-FIDELITY: Mapbox tilesets are ${tiles.state.toUpperCase()} from this box — ${tiles.why}.`)
if (tiles.state === 'reachable') {
  console.log('  So the tileset findings do not apply: shots taken here get a real basemap, not a blank void.')
} else {
  console.log(`  ${tilesetFiles.length} file(s) source a Mapbox-hosted tileset (mapbox://mapbox.*), which a`)
  console.log('  URL-restricted token cannot fetch off its allowed origin.')
}

if (fonts === null) {
  console.log('  i fc-list not available — cannot verify glyph coverage. Screenshots UNASSESSED.')
}

if (tileBundles.length) {
  findings.push([
    '',
    'SHOT-FIDELITY: these map bundles draw their GEOGRAPHY from Mapbox tiles only, so they shoot',
    'as a blank void when the token cannot fetch tilesets from this origin:',
    `  ${tileBundles.join(', ')}`,
    '',
    '  The STYLE document returns 200 everywhere (so the map boots, the legend and controls paint,',
    '  and the data layer is correct) while the TILESETS are refused. A booted map showing its own',
    '  UI and its own data looks like a working map — only the coastlines and country fills are',
    `  gone. Measured this run: ${tiles.why}.`,
    '',
    '  Bundles that ship their own world-adm0.geojson are UNAFFECTED, which is why one cap-4 shot',
    '  looks perfect beside four blank ones. That contrast is a red herring, not a per-bundle bug.',
  ].join('\n'))
}

if (tilesetFiles.length) {
  findings.push([
    '',
    'SHOT-FIDELITY: a tileset-backed map pane can shoot BLANK while the page reports OK.',
    `  files sourcing a mapbox:// tileset: ${tilesetFiles.join(', ')}`,
    '',
    `  Measured THIS RUN against country-boundaries-v1 with the baked token: ${tiles.why}.`,
    '  The STYLE endpoint returns 200 from every origin, so every map BOOTS and only the TILES are',
    '  missing — which is why this first looked like "that surface has no map".',
    '',
    '  ★ It is NOT a missing tileset scope (re-tested with the doxa.life referer, which passes)',
    '  and NOT a code defect. Either shoot these panes from an allowed origin, or add the shot',
    '  origin to the token\'s URL restrictions at Mapbox.',
  ].join('\n'))
}

if (bundles.length && fonts === 0) {
  findings.push([
    '',
    'SHOT-FIDELITY: this machine has NO emoji font, so every emoji renders as a tofu box (□).',
    `  affected bundles: ${bundles.join(', ')}`,
    '',
    '  The MARKUP IS CORRECT — the DOM carries the right codepoints and a real browser renders',
    '  them. This is a property of the SHOT MACHINE. So the fix is to install a font here',
    '  (e.g. fonts-noto-color-emoji), NEVER to remove emoji from the product to please a',
    '  screenshot box.',
    '',
    '  `bun run shots` CANNOT catch this: it checks that pages load, and a tofu glyph loads',
    '  perfectly — 0 console errors, 0 HTTP>=400, full element counts.',
  ].join('\n'))
}

if (findings.length) {
  const msg = findings.join('\n')
  if (STRICT) { console.error(msg); process.exit(1) }
  console.log(msg)
  process.exit(0)
}

console.log('SHOT-FIDELITY: PASS — an emoji font is present and no tileset-backed pane is at risk; ' +
            'shots render what they are meant to show.')
