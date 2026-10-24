#!/usr/bin/env node
/**
 * check-control-inset-measured — bottomControlInset actually MEASURES the map's bottom controls.
 *
 * ★ WHY THIS EXISTS SEPARATELY FROM check:popup-pan-controls. That gate proves the ARITHMETIC: given
 * a band height, the pan clears it. This one proves the band height is real. The two halves fail
 * differently, and the second failure is the silent one: if this function returns 0 — a selector
 * typo, an engine that renames its control classes, a control that lives outside the container —
 * then panPlanFor is handed bottomInset 0, behaves exactly as it did before the fix, and
 * check:popup-pan-controls still passes every case, because its arithmetic is still correct.
 * The bug would be back and both gates would be green.
 *
 * So this asserts the measurement against a REAL DOM: the engine's own class names, the box model it
 * actually produces, and the cases that make a naive implementation wrong.
 *
 * ★ IT RUNS THE SHIPPED FUNCTION, not a copy. bottomControlInset is not exported — it lives inside
 * the SFC — so the source is read and evaluated in the page, the same reach
 * check:popup-pan-controls uses for panPlanFor. A re-typed copy would pass forever while the
 * component drifted, which is the one failure this gate must not have.
 *
 * Exit 0 pass · 1 fail · 2 the function could not be found · 75 no browser slot.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './lib/playwright-guarded.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'library/components/maps/RegionCountryMap.vue')
const src = readFileSync(SRC, 'utf8')

const m = src.match(/function bottomControlInset\(container\)[\s\S]*?\n\}/)
if (!m) {
  console.error('CONTROL-INSET: NOT MEASURED — bottomControlInset was not found in RegionCountryMap.vue.')
  console.error('  Renamed or moved? Re-point this gate rather than dropping it: without it, an inset that')
  console.error('  silently returns 0 restores the original bug while every other gate stays green.')
  process.exit(2)
}
const FN = m[0]

// A map container shaped like the real one: the engine's four corner containers, its attribution in
// the bottom-right, and our own pin hint. Sizes are CSS, so the browser computes the boxes.
const PAGE = (inner) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0}
  .map{position:relative;width:366px;height:732px;overflow:hidden}
  .maplibregl-ctrl-bottom-left{position:absolute;bottom:0;left:0;pointer-events:none}
  .maplibregl-ctrl-bottom-right{position:absolute;bottom:0;right:0;pointer-events:none}
  .maplibregl-ctrl{pointer-events:auto;margin:0}
  .maplibregl-ctrl-attrib{background:rgba(255,255,255,.5);padding:0 5px}
  .pin-hint-pill{position:absolute;bottom:8px;left:8px;height:24px;padding:0 10px}
</style></head><body><div class="map">${inner}</div></body></html>`

const ATTRIB = (text = '&copy; OpenStreetMap contributors') =>
  `<div class="maplibregl-ctrl-bottom-right"><details class="maplibregl-ctrl maplibregl-ctrl-attrib" open>
     <summary>i</summary><div class="maplibregl-ctrl-attrib-inner">${text}</div></details></div>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
let bad = 0
const ok = (cond, what) => { if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`) }

/** Evaluate the SHIPPED function against a page, and also report what the DOM says, independently. */
async function measure(inner) {
  await page.setContent(PAGE(inner))
  return page.evaluate(([fnSrc]) => {
    const fn = new Function(`${fnSrc}\nreturn bottomControlInset`)()
    const container = document.querySelector('.map')
    const box = container.getBoundingClientRect()
    // The independent answer: the highest top of anything that takes a pointer event down there.
    let top = Infinity
    for (const el of container.querySelectorAll('.maplibregl-ctrl, .pin-hint-pill')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && r.top < top) top = r.top
    }
    const expected = Number.isFinite(top) ? Math.max(0, Math.round(box.bottom - top)) : 0
    return { got: fn(container), expected }
  }, [FN])
}

// ── 1. THE ORDINARY CASE: one line of attribution. The inset must be positive and must match what
// the DOM independently says — not merely "some number", which a stub returning 1 would satisfy.
{
  const { got, expected } = await measure(ATTRIB())
  ok(got > 0, `a visible attribution reserves a band (${got}px), not 0 — the silent-failure case`)
  ok(got === expected, `and it equals what the DOM says (${got} vs ${expected})`)
}

// ── 2. NOTHING TO RESERVE. No controls at all must give exactly 0, so a map without chrome is not
// penalised and the pan behaves as it did before this rule existed.
{
  const { got } = await measure('')
  ok(got === 0, `no bottom controls reserves exactly 0 (${got})`)
}

// ── 3. A COLLAPSED CONTROL RESERVES NOTHING. An element present but zero-sized takes no click, and
// counting it would reserve the whole map height — the pan would then refuse every popup.
{
  const { got } = await measure('<div class="maplibregl-ctrl-bottom-right"><div class="maplibregl-ctrl" style="height:0;width:0"></div></div>')
  ok(got === 0, `a zero-sized control reserves nothing (${got})`)
}

// ── 4. THE TALLEST WINS, ACROSS CORNERS. Our pin hint sits bottom-LEFT while the attribution is
// bottom-RIGHT; the band has to cover whichever reaches higher, or the taller one still takes the
// click. Measured with a deliberately tall hint.
{
  const inner = ATTRIB() + '<div class="pin-hint-pill" style="height:80px"></div>'
  const { got, expected } = await measure(inner)
  ok(got === expected && got >= 80, `the taller of two corners wins (${got}px covers an 80px hint)`)
}

// ── 5. A WRAPPED ATTRIBUTION IS TALLER, AND THE INSET FOLLOWS IT. This is the case a hard-coded
// constant gets wrong: at 390 a long credit wraps to two lines and the band grows.
{
  const oneLine = await measure(ATTRIB())
  const wrapped = await measure(ATTRIB('&copy; OpenStreetMap contributors, &copy; OpenMapTiles, &copy; Natural Earth, and a long credit that wraps at this width'))
  ok(wrapped.got > oneLine.got, `a wrapped credit reserves more than one line (${wrapped.got} > ${oneLine.got})`)
  ok(wrapped.got === wrapped.expected, `and still equals the DOM (${wrapped.got} vs ${wrapped.expected})`)
}

// ── 6. A CONTROL OUTSIDE THE CONTAINER IS NOT OURS TO RESERVE. querySelectorAll is scoped to the
// container; a stray control elsewhere on the page must not inflate the band.
{
  await page.setContent(PAGE('') .replace('</body>', `${ATTRIB()}</body>`))
  const got = await page.evaluate(([fnSrc]) => {
    const fn = new Function(`${fnSrc}\nreturn bottomControlInset`)()
    return fn(document.querySelector('.map'))
  }, [FN])
  ok(got === 0, `a control outside the map container is ignored (${got})`)
}

// ── 7b. THE MAPBOX ENGINE'S CORNERS COUNT TOO. The component takes a provider prop and swaps
// engines, and the selector names BOTH prefixes — but every case above renders maplibre class names,
// so the `.mapboxgl-ctrl-bottom-*` half was never exercised. A typo there would be invisible: the map
// would draw, the pan would run, and on Mapbox the popup's buttons would sit under the attribution
// exactly as they did before the fix. Same page shape, mapbox class names.
{
  const mb = `<div class="mapboxgl-ctrl-bottom-right"><div class="mapboxgl-ctrl mapboxgl-ctrl-attrib" style="height:40px">
       <div class="mapboxgl-ctrl-attrib-inner">&copy; Mapbox</div></div></div>`
  await page.setContent(PAGE(mb))
  const r = await page.evaluate(([fnSrc]) => {
    const fn = new Function(`${fnSrc}\nreturn bottomControlInset`)()
    const container = document.querySelector('.map')
    const box = container.getBoundingClientRect()
    let top = Infinity
    for (const el of container.querySelectorAll('.mapboxgl-ctrl, .pin-hint-pill')) {
      const q = el.getBoundingClientRect()
      if (q.width > 0 && q.height > 0 && q.top < top) top = q.top
    }
    return { got: fn(container), expected: Number.isFinite(top) ? Math.max(0, Math.round(box.bottom - top)) : 0 }
  }, [FN])
  ok(r.got > 0, `a Mapbox attribution reserves a band (${r.got}px), not 0 — the provider swap is covered`)
  ok(r.got === r.expected, `and it equals what the DOM says (${r.got} vs ${r.expected})`)
}

// ── 7. NO CONTAINER AT ALL. A map mid-teardown must plan no pan rather than throw.
{
  const got = await page.evaluate(([fnSrc]) => {
    const fn = new Function(`${fnSrc}\nreturn bottomControlInset`)()
    return fn(null)
  }, [FN])
  ok(got === 0, `a null container returns 0 rather than throwing (${got})`)
}

await browser.close()
if (bad) {
  console.error(`\nCONTROL-INSET: FAIL — ${bad} case(s). The band the pan reserves is not the band the`)
  console.error('controls occupy, so a popup can be panned "clear" and still have its buttons covered.')
  process.exit(1)
}
console.log('\nCONTROL-INSET: PASS — the inset measures the real control band, in both engines\' corners.')
