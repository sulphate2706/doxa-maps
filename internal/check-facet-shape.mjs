#!/usr/bin/env node
/**
 * check-facet-shape — the facet gate's in-page source reader, tested headlessly on both engines' shapes.
 * Imports the SAME WALK string check:facet-changes-map injects (internal/lib/facet-walk.mjs), so a copy cannot
 * drift from what ships. No browser. Negative-tested by upg100: without the { geojson } unwrap it is 4/5.
 * EXIT 0 pass · 1 fail
 */
import { WALK } from './lib/facet-walk.mjs'
import { readSourceFeatures } from '../library/maps/pin-selection.js'

// ── SHAPE TEST (headless, no browser) ────────────────────────────────────────────────────────────
// ★ NEGATIVE-TESTS __srcFeatures AGAINST BOTH ENGINE SHAPES, in sr's check-pin-selection style.
// ⚠ NOT `--self-test`: that already means "run the browser gate with the bug put back, it MUST
// fail". This one never opens a browser, so it can run anywhere and in gates:pre.
// It evaluates the helper OUT OF THE WALK STRING ITSELF, so the thing tested is the thing injected
// into the page — a copy pasted here would pass while the shipped helper rotted.
const FC = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { slug: 'a' } },
                                                   { type: 'Feature', properties: { slug: 'b' } }] }
const srcFeatures = new Function(`${WALK}\nreturn __srcFeatures`)()
const mapWith = (src) => ({ getSource: (id) => (id === 'rd-bubbles' ? src : null) })
const cases = [
  ['mapbox shape   (_data = FeatureCollection)', () => srcFeatures(mapWith({ _data: FC }), 'rd-bubbles'), 2],
  ['maplibre shape (_data = { geojson })',       () => srcFeatures(mapWith({ _data: { geojson: FC } }), 'rd-bubbles'), 2],
  ['public fallback (no _data, serialize())',    () => srcFeatures(mapWith({ serialize: () => ({ data: FC }) }), 'rd-bubbles'), 2],
  // A REMOTE SOURCE MUST NOT READ AS EMPTY. null means "could not measure"; 0 would mean "the map
  // drew nothing", which is the finding this gate exists to report.
  ['remote  (_data = { url }) -> null, not 0',   () => srcFeatures(mapWith({ _data: { url: 'https://x.invalid/a.json' } }), 'rd-bubbles'), null],
  ['absent source -> null',                      () => srcFeatures(mapWith(null), 'rd-bubbles'), null],
  // ★ maplibre's THIRD shape. updateData() stores _data = { updateable } (maplibre-gl :49001). Nothing
  // calls updateData today, so this fixture is here to make ADOPTING it trip a test instead of blanking
  // the map: neither reader understands the shape, and the one thing both must not do is answer 0.
  ['maplibre updateData (_data = { updateable }) -> null, not 0',
    () => srcFeatures(mapWith({ _data: { updateable: new Map() } }), 'rd-bubbles'), null],
]
let ok = 0
let total = cases.length
for (const [name, run, want] of cases) {
  const got = run()
  const n = got === null || got === undefined ? null : got.length
  const pass = n === want
  console.log(`  ${pass ? '✓' : '✗'} ${name}  -> ${n === null ? 'null' : n + ' feature(s)'}`)
  if (pass) ok++
}
// ── THE TWO READERS MUST NOT DRIFT ───────────────────────────────────────────────────────────────
// This gate's helper (__srcFeatures, injected into the page) and the PRODUCT's reader
// (library/maps/pin-selection.js readSourceFeatures, used by the packet and zoomToLegendRow) answer the
// same question about the same private field, and they are two separate copies because one must be a
// string evaluated in a browser and the other an ES module. Nothing but this block holds them together.
//
// ★ ONE DIFFERENCE IS DELIBERATE AND IS ASSERTED AS SUCH, not waived. On a url-backed source the gate
// returns null ("cannot measure") while the product returns [] and warns. Both are right for their
// caller: a gate whose whole job is to distinguish "the map drew nothing" from "I could not look" must
// have a third answer, while a selection returning null would break the Set arithmetic every caller
// does on it. Pinning the fork here means the next person to touch either reader is told that it is a
// decision, and any OTHER disagreement is drift and fails.
const agree = [
  ['mapbox   (_data = FeatureCollection)', { _data: FC }, 2],
  ['maplibre (_data = { geojson })',       { _data: { geojson: FC } }, 2],
  ['serialize() fallback',                 { serialize: () => ({ data: FC }) }, 2],
  ['single Feature, not a collection',     { _data: { type: 'Feature', properties: { slug: 'a' } } }, 1],
  ['unrecognised shape ({ updateable })',  { _data: { updateable: new Map() } }, 0],
]
for (const [name, src, wantCount] of agree) {
  const a = srcFeatures(mapWith(src), 'rd-bubbles')
  const b = readSourceFeatures(mapWith(src), 'rd-bubbles')
  const na = a === null || a === undefined ? 0 : a.length
  const nb = b === null || b === undefined ? 0 : b.length
  const pass = na === nb && na === wantCount
  console.log(`  ${pass ? '✓' : '✗'} both readers agree: ${name}  -> gate ${na}, product ${nb}`)
  if (pass) ok++
  total++
}
{
  // The documented fork, asserted in BOTH directions so neither side can quietly adopt the other's.
  const src = { _data: { url: 'https://x.invalid/a.json' } }
  const a = srcFeatures(mapWith(src), 'rd-bubbles')
  const b = readSourceFeatures(mapWith(src), 'rd-bubbles')
  const pass = a === null && Array.isArray(b) && b.length === 0
  console.log(`  ${pass ? '✓' : '✗'} documented fork on a url source: gate null ("cannot measure"), product [] + warn`)
  if (pass) ok++
  total++
}
// ── AND NEITHER MAY BE SILENT ABOUT A SHAPE IT DOES NOT KNOW ────────────────────────────────────
// "Returns 0" and "returns 0 while saying it did not understand the payload" are different products.
// Only the second lets someone adopting updateData() find out from a console instead of from a map.
for (const [label, run] of [
  ['gate helper', () => srcFeatures(mapWith({ _data: { updateable: new Map() } }), 'rd-bubbles')],
  // A map whose getSource answers to ANY id: mapWith() only knows 'rd-bubbles', so asking it for a
  // fresh id returns no source at all and the reader exits before it can warn — the assertion would
  // have passed for the wrong reason on a reader that never warns. The fresh id is still needed,
  // because the warning is once-per-source by design.
  ['product reader', () => readSourceFeatures(
    { getSource: () => ({ _data: { updateable: new Map() } }) }, 'a-source-not-yet-warned-about')],
]) {
  const said = []
  const real = console.warn
  console.warn = (...a) => said.push(a.join(' '))
  try { run() } finally { console.warn = real }
  const pass = said.some((m) => /updateable/.test(m))
  console.log(`  ${pass ? '✓' : '✗'} ${label} names the unrecognised shape rather than failing silently`)
  if (pass) ok++
  total++
}

console.log(ok === total
  ? `FACET-SHAPE-TEST: PASS — ${ok}/${total}, both engine shapes measured, the gate's reader and the product's reader agree everywhere except their one documented fork, and neither is silent about a shape it does not know`
  : `FACET-SHAPE-TEST: FAIL — ${ok}/${total}`)
process.exit(ok === total ? 0 : 1)
