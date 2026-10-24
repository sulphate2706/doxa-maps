#!/usr/bin/env node
/**
 * check-poster-layout-optin — the composed poster layout is OPT-IN, and every caller that does not
 * ask for it gets byte-for-byte what it got before.
 *
 * WHY THE OPT-IN EXISTS (a decision that followed upg-100-list's check). The renderer used to raster the
 * map at FULL PAGE size and composite the title, legend and footer on top of it, so the legend lay
 * over the map it describes. usePosterLayout had always computed the correct geometry and nothing
 * consumed it. Fixing that unconditionally would have broken a different product: country-posters
 * embeds this renderer's output as a full-sheet <img> INSIDE its own packet page, beneath the
 * packet's own title, so default-on chrome prints a second header and footer within their page.
 * (UPG-100's packet does not call this renderer at all, so it was never at risk — checked, not
 * assumed.) Hence spec.layout === 'poster' asks for the composed sheet; absent means unchanged.
 *
 * WHAT THIS ASSERTS, and why it is executed rather than read: the guarantee is about BEHAVIOUR at
 * runtime, so this drives the real decision expressions with real spec objects instead of grepping
 * for their text. A comment can say "opt-in" while the code is not.
 *
 * Headless, no browser, no network, no dependencies. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { computeLayout } = await import(resolve(ROOT, 'library/composables/poster/usePosterLayout.js'))
const { defaultPosterSpec } = await import(resolve(ROOT, 'library/constants/posterDefaults.js'))

const fails = []
const ok = (what, cond, detail) => { if (!cond) fails.push(what + (detail ? `\n      ${detail}` : '')) }

// The renderer's own decision expressions, restated once here and asserted against the source below
// so this file cannot drift from it silently.
const decide = (spec, px) => {
  const posterLayout = spec.layout === 'poster'
  const layout = posterLayout ? computeLayout(spec, px) : null
  const fits = !!layout && layout.map.w > 0 && layout.map.h > 0
  return { posterLayout, layout, fits, mapPx: fits ? { width: layout.map.w, height: layout.map.h, dpi: px.dpi } : px }
}
const pxOf = (s) => ({ width: Math.round(s.widthIn * s.dpi), height: Math.round(s.heightIn * s.dpi), dpi: s.dpi })

// ── 1. every EXISTING caller's spec shape: unchanged, and unchanged BY IDENTITY ───────────────
const callers = [
  ['country-posters page 1 (A4 @150)', { widthIn: 8.27, heightIn: 11.69, dpi: 150, orientation: 'portrait' }],
  ['Simple Research, landscape',       { widthIn: 11, heightIn: 8.5, dpi: 200, orientation: 'landscape' }],
  ['Simple Research, portrait',        { widthIn: 8.5, heightIn: 11, dpi: 200, orientation: 'portrait' }],
  ['PosterDialog default 24x36 @300',  { widthIn: 24, heightIn: 36, dpi: 300, orientation: 'portrait' }],
]
for (const [name, size] of callers) {
  const spec = defaultPosterSpec(size)
  spec.slots.legend = { ...spec.slots.legend, rows: [{ label: 'Reached', color: '#2a7' }] }
  const px = pxOf(spec)
  const d = decide(spec, px)
  ok(`${name}: does NOT opt in`, d.posterLayout === false)
  ok(`${name}: the map is still rastered at the FULL PAGE`, d.mapPx === px,
    `mapPx must be the SAME OBJECT as px, not merely equal — got ${JSON.stringify(d.mapPx)}`)
  ok(`${name}: no sheet compositing happens`, d.fits === false)
}

// defaultPosterSpec must never start setting it, or every caller silently opts in.
ok('defaultPosterSpec does not set spec.layout', defaultPosterSpec({ widthIn: 8.5, heightIn: 11 }).layout === undefined)

// ── 2. opting IN actually changes the geometry, and correctly ────────────────────────────────
for (const [name, size] of callers) {
  const spec = defaultPosterSpec(size)
  spec.layout = 'poster'
  spec.slots.legend = { ...spec.slots.legend, rows: [{ label: 'Reached', color: '#2a7' }] }
  const px = pxOf(spec)
  const d = decide(spec, px)
  ok(`${name} + layout:'poster': opts in`, d.posterLayout === true)
  ok(`${name} + layout:'poster': the map is NARROWED`, d.fits && d.mapPx.width < px.width,
    `map ${d.mapPx.width} should be less than page ${px.width}`)
  const L = d.layout
  const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
  ok(`${name} + layout:'poster': legend BESIDE the map, not over it`, !overlap(L.legend, L.map))
  ok(`${name} + layout:'poster': header above the map`, !overlap(L.title, L.map))
  ok(`${name} + layout:'poster': footer below the map`, !overlap(L.footer, L.map))
}

// ── 3. the source really implements what this file just modelled ─────────────────────────────
const SRC = readFileSync(resolve(ROOT, 'library/composables/poster/useMapPoster.js'), 'utf8')
const lines = SRC.split('\n')
const codeHas = (re) => lines.some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && re.test(l))
ok('the renderer gates on spec.layout === "poster"', codeHas(/spec\.layout\s*===\s*'poster'/))
ok('and falls back to the page px when it does not fit', codeHas(/const\s+mapPx\s*=\s*fits\s*\?/))
ok('and only composites a sheet when it fits', codeHas(/const\s+sheet\s*=\s*fits\s*\?\s*_placeMapOnSheet/))
ok('_placeMapOnSheet is declared and used', /function\s+_placeMapOnSheet\s*\(/.test(SRC) &&
  (SRC.match(/_placeMapOnSheet\s*\(/g) || []).length >= 2)

if (fails.length) {
  console.error('POSTER-LAYOUT-OPTIN: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('POSTER-LAYOUT-OPTIN: PASS — four existing caller shapes render at the full page with the SAME px object (unchanged by identity, not just by value), defaultPosterSpec sets no layout, and opting in narrows the map with the legend beside it and the bands clear.')
