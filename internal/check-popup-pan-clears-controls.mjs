#!/usr/bin/env node
/**
 * check-popup-pan-clears-controls — the popup auto-pan reserves the map's bottom control band, so a
 * popup that clears the CLIP is also clear of the things that take the click.
 *
 * ★ THE BUG THIS GUARDS, measured in a browser at 390 on a 366x732 map. The pan fitted the popup
 * inside the CONTAINER and stopped there. The attribution and the pin hint are painted over the
 * canvas and accept pointer events, so both NER pins panned, both popups ended fully inside the
 * frame (cut 0), and a real click on Full Profile did NOTHING — at y~701 the top element was
 * div.maplibregl-ctrl-attrib-inner on one pin and span.pin-hint-pill on the other. Two pins that
 * looked fixed and were not: a cut-height check cannot see this, because the cut really was zero.
 *
 * Attribution is a LICENCE TERM of the basemap, so raising the popup above it is not available to
 * us. The usable frame is simply shorter than the container, and the fit test has to say so.
 *
 * ★ IT RUNS THE SHIPPED FUNCTION, NOT A COPY. panPlanFor is not exported — it lives inside the SFC
 * — so the source is read and the function evaluated with `new Function`, the same way
 * check-optional-t-equivalence reaches useOptionalT. A re-typed copy of the arithmetic would pass
 * forever while the component drifted, which is the one failure a geometry gate must not have.
 *
 * ★ AND IT ASSERTS THE GEOMETRY, NOT THE RETURN VALUE. Re-deriving the expected number from the
 * same formula would be a self-consistent oracle: an error that shifted both sides would stay
 * invisible. So each case states where the popup ENDS UP and requires that to clear the band.
 *
 * Exit 0 pass · 1 fail · 2 the function could not be found (never a silent pass).
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'library/components/maps/RegionCountryMap.vue')
const src = readFileSync(SRC, 'utf8')

// The whole function body, from its signature to the closing brace at column 0.
const m = src.match(/function panPlanFor\(\{[\s\S]*?\n\}/)
if (!m) {
  console.error('POPUP-PAN-CONTROLS: NOT MEASURED — panPlanFor was not found in RegionCountryMap.vue.')
  console.error('  It may have been renamed or moved. Point this gate at it rather than deleting the gate:')
  console.error('  a geometry rule with no test is how the bottom-control bug shipped the first time.')
  process.exit(2)
}
let panPlanFor
try { panPlanFor = new Function(`${m[0]}\nreturn panPlanFor`)() } catch (e) {
  console.error(`POPUP-PAN-CONTROLS: NOT MEASURED — panPlanFor did not evaluate: ${e.message}`)
  process.exit(2)
}

// POPUP_OFFSET is the component's own gap between pin and popup; read it rather than assume 12.
const offMatch = src.match(/const POPUP_OFFSET = (\d+)/)
const OFFSET = offMatch ? Number(offMatch[1]) : 12

let bad = 0
const ok = (cond, what) => { if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`) }

/**
 * Where the popup's far edge lands after the plan is applied.
 * A positive plan moves the PIN down the screen and the popup opens ABOVE it; a negative plan moves
 * the pin up and the popup opens BELOW. Stated here from the geometry, independently of panPlanFor.
 */
function popupBottomAfter({ containerH, popupH, pinY, bottomInset }) {
  const dy = panPlanFor({ containerH, popupH, pinY, offset: OFFSET, bottomInset })
  const pin = pinY + dy
  return { dy, bottom: dy > 0 ? pin - OFFSET : pin + popupH + OFFSET }
}

// ── 1. THE MEASURED CASE. NER at 390: a 366x732 map, a ~452px popup, a pin in the lower half.
{
  const c = { containerH: 732, popupH: 452, pinY: 345 }
  const band = 44
  const withoutBand = popupBottomAfter({ ...c, bottomInset: 0 })
  const withBand = popupBottomAfter({ ...c, bottomInset: band })
  ok(withoutBand.bottom > 732 - band,
    `without the band reserved the popup ends at ${Math.round(withoutBand.bottom)}, inside the control strip — the bug`)
  ok(withBand.bottom <= 732 - band + 0.5,
    `with the band reserved it ends at ${Math.round(withBand.bottom)}, clear of a ${band}px strip`)
}

// ── 2. THE BAND HEIGHT IS NOT HARD-CODED ANYWHERE. It is measured at runtime, so the rule has to
// hold across the range the bottom chrome really occupies.
//
// ★ THE RANGE IS WIDER THAN THE ATTRIBUTION, and guessing it was my mistake. This list stopped at
// 120px, described as "far beyond anything observed". Then the band was MEASURED in a browser at
// 390: the attribution is only 44px (y678..722), but the PIN-HINT PILL wraps to several lines and
// is 118px tall (y577..699) — an effective band of about 150px while the hint is showing, a quarter
// again beyond the ceiling I had invented. At 1440 the same two are 24px and 38px.
// So the sweep now runs past what has been measured rather than past what I expected, and 200px is
// deliberately unreasonable: the point is that the RULE holds for any band, since the only number
// the component ever uses is the one it measures at runtime.
for (const band of [0, 24, 35, 38, 44, 57, 70, 90, 118, 120, 150, 200]) {
  const { bottom } = popupBottomAfter({ containerH: 732, popupH: 452, pinY: 345, bottomInset: band })
  ok(bottom <= 732 - band + 0.5, `band ${String(band).padStart(3)}px: popup ends at ${Math.round(bottom)}, clear of ${732 - band}`)
}

// ── 2b. THE MEASURED WORST CASE, and the one width where it does NOT fit. With the pin hint
// showing at 390 the band is ~150px, so the popup needs 464 + 150 = 614px of container. Below that
// the pan must REFUSE (plan 0) rather than move the camera to no purpose — the popup stays clipped,
// which is the honest failure, instead of becoming a clipped popup AND a jumped map.
// 296px of container is a real case: a 320px viewport with 12px margins on a host page.
{
  const band = 150
  for (const [containerW, containerH, shouldFit] of [[320, 640, true], [296, 592, false], [390, 780, true]]) {
    const dy = panPlanFor({ containerH, popupH: 452, pinY: Math.round(containerH * 0.47), offset: OFFSET, bottomInset: band })
    const fits = (452 + OFFSET) <= containerH - band
    ok(fits === shouldFit, `${containerW}px wide (container ${containerH}) with the hint showing: ${fits ? 'fits' : 'does not fit'}`)
    if (!fits) ok(dy === 0, `  and an unfittable frame plans NO pan (${dy}) rather than a partial one`)
  }
}

// ── 3. WHAT MUST NOT CHANGE. The band only ever removes space; it must never start a pan that the
// old code would not have made, and never move a popup that already fits.
{
  ok(panPlanFor({ containerH: 780, popupH: 452, pinY: 390, offset: OFFSET, bottomInset: 0 })
     === panPlanFor({ containerH: 780, popupH: 452, pinY: 390, offset: OFFSET }),
    'bottomInset 0 is identical to the behaviour before this rule existed')
  ok(panPlanFor({ containerH: 732, popupH: 452, pinY: 600, offset: OFFSET, bottomInset: 44 }) === 0,
    'a pin whose anchor already fits is not moved (measured: pan 0 in both arms on those pins)')
  ok(panPlanFor({ containerH: 500, popupH: 480, pinY: 250, offset: OFFSET, bottomInset: 44 }) === 0,
    'a popup taller than the USABLE frame refuses rather than jumping the camera to no purpose')
  ok(panPlanFor({ containerH: 732, popupH: 452, pinY: 345, offset: OFFSET, bottomInset: -50 })
     === panPlanFor({ containerH: 732, popupH: 452, pinY: 345, offset: OFFSET }),
    'a negative inset is clamped, never widening the frame beyond the container')
  for (const bad of [NaN, undefined, null]) {
    ok(panPlanFor({ containerH: 732, popupH: 452, pinY: bad, offset: OFFSET, bottomInset: 44 }) === 0,
      `an unmeasurable pin (${String(bad)}) plans no pan rather than NaN`)
  }
}

// ── 4. EVERY WIDTH THIS COMPONENT RENDERS AT still resolves. Container height is 2x width below
// 768px (aspect-ratio 1/2) and max(780, 16/9) at or above it, so a phone is TALLER relative to its
// width, not shorter. With the band reserved the popup must still fit at all of them.
for (const w of [320, 360, 390, 414, 767, 768, 1024, 1440]) {
  const containerH = w < 768 ? 2 * w : Math.max(780, Math.round(w * 9 / 16))
  const { bottom } = popupBottomAfter({ containerH, popupH: 452, pinY: Math.round(containerH * 0.47), bottomInset: 57 })
  ok(bottom <= containerH - 57 + 0.5, `${String(w).padStart(4)}px wide (container ${containerH}): popup clears the band`)
}

if (bad) {
  console.error(`\nPOPUP-PAN-CONTROLS: FAIL — ${bad} case(s). The pan no longer guarantees the popup's buttons`)
  console.error('are clear of the map\'s bottom controls, so a click on them can land on the attribution instead.')
  process.exit(1)
}
console.log('\nPOPUP-PAN-CONTROLS: PASS — the pan clears the bottom control band at every width and band height tested.')
