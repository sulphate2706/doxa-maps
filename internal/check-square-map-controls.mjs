#!/usr/bin/env node
// check-square-map-controls.mjs — `bun run check:square-map-controls`. Source-only, headless, no network.
//
// The square map-control variant: is it the ENGINE'S card, and does nothing else move?
//
// Square controls were asked for as an OPTION beside the round ones. The key fact that shaped
// the implementation is that the square look is not a design of DX-life's at all: their CountryMap.vue
// adds mapboxgl.NavigationControl + FullscreenControl and overrides NOTHING, so what he admired is the
// ENGINE'S DEFAULT grouped card. That makes the target published and exact rather than a matter of
// taste -- so this check reads the engine's own stylesheet out of node_modules and compares our ported
// values against it. A port checked against its SOURCE cannot drift with my memory of it.
//
// AND IT ASSERTS THE BLAST RADIUS, which is the half a visual review cannot see: round is the default
// and no consumer opts in, so all nine maps that use MapToolbar render exactly as before.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Each copy of this repo grades ITS OWN tree (check:no-abs-paths, 2026-09-24).
const REPO = process.env.DOXA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rd = (p) => readFileSync(join(REPO, p), 'utf8')

let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

const TOOLBAR_SRC = rd('library/components/map-controls/MapToolbar.vue')
const BUTTON      = rd('library/components/map-controls/MapControlButton.vue')

// ★ CSS ASSERTIONS READ THE STYLESHEET, NOT THE FILE. The first run of this check went red on
// "we do not adopt 29px" -- because the prop's own doc comment QUOTES the engine's rule, 29px and all.
// A comment is not a declaration, and a checker that cannot tell them apart will keep finding the
// documentation it is standing on. So the CSS tests run against the text actually passed to
// useShadowStyles; the prop and template tests still read the whole file, which is where they live.
function shadowCss(src) {
  const at = src.indexOf('useShadowStyles(')
  const open = src.indexOf('`', at)
  const close = src.indexOf('`', open + 1)
  return open < 0 || close < 0 ? '' : src.slice(open + 1, close)
}
const TOOLBAR = shadowCss(TOOLBAR_SRC)
if (!TOOLBAR.trim()) { console.log('  FAIL - could not extract MapToolbar\'s stylesheet; nothing below was measured'); process.exit(1) }

// ── 1. the ENGINE is the oracle, read from node_modules ─────────────────────────────────────────
const ENGINE = 'node_modules/maplibre-gl/dist/maplibre-gl.css'
if (existsSync(join(REPO, ENGINE))) {
  const css = rd(ENGINE).replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = (sel) => {
    const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))
    return m ? m[1].replace(/\s+/g, ' ').trim() : null
  }
  const group  = rule('.maplibregl-ctrl-group')
  const filled = rule('.maplibregl-ctrl-group:not(:empty)')
  const divider = rule('.maplibregl-ctrl-group button+button')
  console.log(`\n  the engine's own rules, read from ${ENGINE}:`)
  console.log(`    group    { ${group} }`)
  console.log(`    filled   { ${filled} }`)
  console.log(`    divider  { ${divider} }`)

  const radius = (group || '').match(/border-radius:\s*([^;]+)/)
  ok(!!radius && radius[1].trim() === '4px', `the engine's group radius is 4px, and ours is too`)
  ok(/border-radius:\s*4px;/.test(TOOLBAR), 'our .map-toolbar--square carries border-radius:4px')

  const ring = (filled || '').match(/box-shadow:\s*([^;]+)/)
  ok(!!ring, 'the engine states a ring on a non-empty group')
  ok(/box-shadow:\s*0 0 0 2px rgba\(0, 0, 0, 0\.1\)/.test(TOOLBAR),
    `our ring matches the engine's 0 0 0 2px rgba(0,0,0,.1) (engine: ${ring && ring[1]})`)

  ok(/border-top:\s*1px solid #ddd/.test(TOOLBAR),
    `our divider matches the engine's 1px solid #ddd (engine: ${divider})`)

  // ★ the ONE value deliberately NOT ported
  const btn = rule('.maplibregl-ctrl-group button')
  const eng = (btn || '').match(/height:\s*(\d+)px/)
  ok(!!eng && eng[1] === '29', `the engine sizes its buttons ${eng && eng[1]}px`)
  ok(!new RegExp('height:\\s*29px').test(TOOLBAR) && !new RegExp('width:\\s*29px').test(TOOLBAR),
    'and we DO NOT adopt 29px -- the variant takes the SHAPE and leaves the SIZE, so the touch target is not cut')
  ok(/--map-btn-size/.test(TOOLBAR), 'our size still comes from --map-btn-size')
} else {
  console.log(`\n  NOT MEASURED against the engine: ${ENGINE} is absent, so the ported values were not compared to their source.`)
  fails++   // a missing oracle is not a pass
}

// ── 2. the grouped card is a CONTAINER, not a radius swap ───────────────────────────────────────
ok(/\.map-toolbar--square\s*\{[^}]*gap:\s*0/.test(TOOLBAR), 'the square toolbar sets gap:0 -- one panel, not a spaced column')
ok(/\.map-toolbar--square\s*\{[^}]*background:\s*#fff/.test(TOOLBAR), 'the PANEL owns the background')
ok(/\.map-toolbar--square \.mcb[^{]*\{[^}]*background:\s*transparent/.test(TOOLBAR), 'and the buttons own none of it')
ok(/\.map-toolbar--square \.mcb[^{]*\{[^}]*box-shadow:\s*none/.test(TOOLBAR), 'the buttons drop their own shadow, so there is one ring not N')
ok(/\.map-toolbar--square > \* \+ \*\s*\{[^}]*border-top/.test(TOOLBAR),
  'the divider is on the toolbar CHILDREN, so it still lands where two different control types meet')
ok(/\.map-toolbar--square \.hbg-ctrl\s*\{[^}]*margin:\s*0/.test(TOOLBAR),
  "the hamburger wrapper's 10px margin is zeroed -- it would otherwise tear the panel apart")

// ★ no overflow:hidden, and the reason is a focus ring
ok(!/\.map-toolbar--square\s*\{[^}]*overflow:\s*hidden/.test(TOOLBAR),
  'the square panel does NOT use overflow:hidden -- it would clip a focus ring on any inner button')
ok(/:first-child[^{]*\{[^}]*border-radius:\s*4px 4px 0 0/.test(TOOLBAR) &&
   /:last-child[^{]*\{[^}]*border-radius:\s*0 0 4px 4px/.test(TOOLBAR),
  'outer corners come from first/last child rounding instead, which is the engine\'s own mechanism')
ok(/:only-child[^{]*\{[^}]*border-radius:\s*4px/.test(TOOLBAR), 'and a lone control is rounded on all four corners')

// ── 2b. THE PANEL SURVIVES THE PHONE, which it did not at first ────────────────────────
// A media query adds NO specificity, so the mobile `.map-toolbar { gap: 6px }` is (0,1,0) exactly like
// `.map-toolbar--square { gap: 0 }` and, coming later, WON -- a square toolbar fell back to six
// separate buttons inside one ringed panel on every phone. The --no-geocoder pair is (0,2,0) and
// outranked the variant whatever the order, so it needs the two-class answer.
{
  const mq = TOOLBAR.indexOf('@media (max-width: 767px)')
  ok(mq > -1, 'the mobile media block is present')
  const mobile = mq > -1 ? TOOLBAR.slice(mq) : ''
  ok(/\.map-toolbar--square[^{]*\{[^}]*gap:\s*0/.test(mobile),
    'the square variant re-states gap:0 INSIDE the mobile block, so the phone rule cannot outrank it')
  ok(/\.map-toolbar--square\.map-toolbar--no-geocoder[^{]*\{[^}]*gap:\s*0/.test(mobile),
    'and answers the (0,2,0) --no-geocoder pair with the two-class form')
  const sqGap = TOOLBAR.indexOf('.map-toolbar--square {')
  ok(sqGap > -1 && sqGap < mq, 'CONTROL: the base square rule really does come BEFORE the media block, which is why the override is needed at all')
}

// ── 2c. NO CHILD BRINGS ITS OWN OUTLINE ──────────────────────────────────────────
// ShareButton is not a .mcb -- it wraps its button in .share-wrap with border-radius:50% and a
// conic-gradient ring on ::before -- so the button rules missed it and it kept a round rainbow halo
// inside the square panel. Found by a browser check at 390, not by this gate.
ok(/\.map-toolbar--square \.share-wrap \{[^}]*border-radius:\s*0/.test(TOOLBAR),
  'the square panel flattens .share-wrap, which is a div and not a .mcb')
ok(/\.map-toolbar--square \.share-wrap::before \{[^}]*display:\s*none/.test(TOOLBAR),
  "and suppresses its conic-gradient ring -- in this variant the PANEL owns the outline")
ok(/\.share-wrap\{[^}]*border-radius:50%/.test(readFileSync(join(REPO, 'library/components/map-controls/ShareButton.vue'), 'utf8').replace(/\s+/g, '')) ||
   /border-radius:\s*50%/.test(readFileSync(join(REPO, 'library/components/map-controls/ShareButton.vue'), 'utf8')),
  'CONTROL: ShareButton really does carry a 50% radius of its own, so the two rules above are not decorative')

// ── 3. forced colours, which the round buttons never had ────────────────────────────────────────
ok(/@media \(forced-colors: active\)/.test(TOOLBAR), 'the square variant ships a forced-colors block')
ok(/ButtonText/.test(TOOLBAR), 'using ButtonText, so the ring and dividers survive a replaced palette')

// ── 4. the standalone per-button override ───────────────────────────────────────────────────────
ok(/shape:\s*\{ type: String,\s*default: 'round' \}/.test(BUTTON), "MapControlButton's shape defaults to 'round'")
ok(/\.mcb--square\{ border-radius:4px; \}/.test(BUTTON), 'a standalone square takes the engine\'s 4px corners')
ok(/'mcb--square': shape === 'square'/.test(BUTTON), 'and the class is bound to the prop')

// ── 5. BLAST RADIUS: round is the default and nobody opted in ────────────────────────────────────
ok(/controls:\s*\{ type: String, default: 'round' \}/.test(TOOLBAR_SRC), "MapToolbar's controls prop defaults to 'round'")
const CONSUMERS = [
  ['doxa-simple-map', 'plugin-designs/doxa-simple-map/doxa-simple-map.vue', 8],
  ['resources-map', 'plugin-designs/gospel-resources/resources-map.vue', 5],
  ['upg-100-list', 'plugin-designs/my-upg-100-list/upg-100-list.vue', 6],
  ['countries-map', 'plugin-designs/country-posters/countries-map.vue', 5],
  ['DashboardMapPanel', 'plugin-designs/research-dashboard/src/components/dashboards/DashboardMapPanel.vue', 2],
  ['demo-map', 'plugin-designs/demo-map/demo-map.vue', 5],
  ['connectivity-map', 'plugin-designs/cities-internet/connectivity-map.vue', 5],
  ['research-map', 'plugin-designs/doxa-research-map/research-map.vue', 7],
  ['all-people-groups', 'plugin-designs/all-people-groups/all-people-groups.vue', 1],
]
let optedIn = 0
for (const [name, path] of CONSUMERS) {
  const src = rd(path)
  const m = src.match(/<MapToolbar[^>]*controls=/)
  if (m) { optedIn++; console.log(`     ${name} opts in`) }
}
ok(optedIn === 0, `none of the ${CONSUMERS.length} MapToolbar consumers passes controls=, so every one renders exactly as before (${optedIn} opted in)`)

// ── 6. THE GEOMETRY, for a browser check to confirm ──────────────────────────────────────────────
// A square toolbar is SHORTER, because the gaps become dividers. That is the one measurable knock-on:
// MapControlMenu's matchToolbar limits a menu to the toolbar column's height.
const BTN = 32, GAP_DESKTOP = 8, GAP_MOBILE = 6
console.log('\n  toolbar column height, round vs square (button 32px; ring is box-shadow, so outside layout):')
for (const [name, , n] of CONSUMERS) {
  const round = n * BTN + (n - 1) * GAP_DESKTOP
  const square = n * BTN + (n - 1) * 1          // 1px dividers replace the 8px gaps
  console.log(`    ${String(n).padStart(2)} control(s)  ${name.padEnd(18)} round ${String(round).padStart(3)}px   square ${String(square).padStart(3)}px   shorter by ${round - square}px`)
}
const five = { round: 5 * BTN + 4 * GAP_DESKTOP, square: 5 * BTN + 4 }
ok(five.square < five.round,
  `a 5-control toolbar goes ${five.round}px -> ${five.square}px, so a matchToolbar menu gets ${five.round - five.square}px shorter -- a browser check should confirm the menu still fits its content`)
console.log(`    at mobile gap ${GAP_MOBILE}px a 5-control toolbar is ${5 * BTN + 4 * GAP_MOBILE}px round vs ${five.square}px square`)

// ── 7. NEG CONTROLS ─────────────────────────────────────────────────────────────────────────────
ok(!/\.map-toolbar\s*\{[^}]*border-radius/.test(TOOLBAR),
  'NEG CONTROL: the DEFAULT .map-toolbar has no border-radius, so the square rules are genuinely scoped to the variant')
ok(/border-radius:\s*50%/.test(BUTTON),
  'NEG CONTROL: the round button is still a 50% circle -- the default was not quietly changed')
ok(!/controls === 'round'/.test(TOOLBAR_SRC),
  'NEG CONTROL: nothing branches on round, so round is the ABSENCE of the square class rather than a second code path')

console.log(fails ? `\nSQUARE-CONTROLS: ${fails} FAIL(s)` : '\nSQUARE-CONTROLS: the variant matches the engine\'s own rules, keeps our touch target, and changes no consumer')
process.exit(fails ? 1 : 0)
