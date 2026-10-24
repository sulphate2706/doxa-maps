#!/usr/bin/env node
/**
 * check-pin-hint-floor.mjs — the pin-hint pill is placed at the map's bottom on a page that scrolls, and
 * still kept above the fold on a full-screen app page.
 *
 * The defect it guards: PinHint's clamp floored the pill at the viewport fold on EVERY page. On a partner
 * home page, where the map is a block in a scrolling page, a map whose bottom was below the fold at load
 * had its pill lifted to mid-map, re-set by the settle timers, and left there after a scroll.
 *
 * ASSERTS (headless, on library/components/hints/pinHintFloor.js and PinHint.vue's source):
 *   1. scrolling page, map bottom below the fold → no lift (the pill stays at the map's bottom); also a map
 *      ENTIRELY below the fold, at load, with its bottom in view and scrolled past → no lift at any scroll;
 *   2. full-screen page, pill under the fold → lifted above it (today's behaviour kept);
 *   3. the legend sheet and the licence credit still lift the pill on a scrolling page;
 *   4. pageScrolls() tells a longer page from a full-screen one, and fails safe (false) on bad input;
 *   4b. an INNER scroller around the map (html/body at 100%) counts as a scrolling page, across shadow roots;
 *       a scroller whose content fits does not;
 *   5. PinHint's clampIntoView takes its floor from pillFloor(), not from window.innerHeight, treats a map wholly
 *      above or below the viewport as on a scrolling page, and drops a stale lift when the pill goes off screen.
 * --self-test plants each defect (the old fold-everywhere floor, a pageScrolls that never says yes, the
 * old source line) and must see each one refused.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const F = await import(pathToFileURL(join(ROOT, 'library/components/hints/pinHintFloor.js')).href)
const SRC = readFileSync(join(ROOT, 'library/components/hints/PinHint.vue'), 'utf8')

// The clamp's arithmetic, as PinHint.vue does it: lift = overflow + 8 when the pill's bottom passes the floor.
const liftFor = (pillBottom, floor) => { const o = Math.round(pillBottom - floor); return o > 0 ? o + 8 : 0 }
const doc = (scrollHeight) => ({ scrollingElement: { scrollHeight } })

function audit({ pillFloor, pageScrolls }, src) {
  const bad = []
  // 1. DX Life's measured case at 1440: fold 900, map 450..1230, the pill's bottom 12px above the map's.
  const scrolls = pageScrolls(doc(3200), { innerHeight: 900 })
  const l1 = liftFor(1218, pillFloor({ viewportH: 900, scrolls }))
  if (l1 !== 0) bad.push(`a scrolling page lifts the pill ${l1}px off the map's bottom (the fold is not an obstacle there)`)
  // 1b. DX Life /pray at 1440: the map ENTIRELY below the fold (map 1103..1867, fold 900). The pill's bottom
  // (12px above the map's) must get NO lift from the fold at scrollY 0, with the map's bottom in view, or past it.
  for (const [scrollY, label] of [[0, 'at load'], [967, 'with the map bottom in view'], [2067, 'scrolled past']]) {
    const l = liftFor(1855 - scrollY, pillFloor({ viewportH: 900, scrolls }))
    if (l !== 0) bad.push(`a map below the fold lifts the pill ${l}px ${label} (scrollY ${scrollY})`)
  }
  // 2. A full-screen app page at 390×844: the pill 16px under the fold is lifted clear of it.
  const s2 = pageScrolls(doc(844), { innerHeight: 844 })
  const l2 = liftFor(860, pillFloor({ viewportH: 844, scrolls: s2 }))
  if (l2 !== 24) bad.push(`a full-screen page lifts the pill ${l2}px, expected 24 (16 over the fold + 8)`)
  // 3. Obstacles still count on a scrolling page.
  const l3 = liftFor(1218, pillFloor({ viewportH: 900, scrolls: true, sheetTop: 1150 }))
  if (l3 !== 76) bad.push(`the legend sheet lifts the pill ${l3}px on a scrolling page, expected 76`)
  const l3b = liftFor(1218, pillFloor({ viewportH: 900, scrolls: true, creditTop: 1200 }))
  if (l3b !== 26) bad.push(`the licence credit lifts the pill ${l3b}px on a scrolling page, expected 26`)
  // 4b. An INNER scroller: the document does not scroll (html/body at 100%), a container around the map does.
  const node = (oy, sh, ch, parent = null, host = null) => { const n = { nodeType: 1, oy, scrollHeight: sh, clientHeight: ch, parentElement: parent }; n.getRootNode = () => (host ? { host } : n); return n }
  const winStyle = { innerHeight: 900, getComputedStyle: (n) => ({ overflowY: n.oy }) }
  const scroller = node('auto', 3200, 900)
  const mapBox = node('hidden', 764, 764, scroller)
  const pillEl = node('visible', 19, 19, mapBox)
  if (pageScrolls(doc(900), winStyle, pillEl) !== true) bad.push('an inner scroller around the map is not seen as a scrolling page')
  const fits = node('auto', 900, 900); const pill2 = node('visible', 19, 19, node('hidden', 900, 900, fits))
  if (pageScrolls(doc(900), winStyle, pill2) !== false) bad.push('a scroller whose content fits is taken for a scrolling page')
  const outerScroller = node('scroll', 2400, 900)
  const shadowHost = node('visible', 900, 900, outerScroller)
  const inShadow = node('visible', 19, 19, null, shadowHost)
  if (pageScrolls(doc(900), winStyle, inShadow) !== true) bad.push('the walk does not cross a shadow root to the scroller outside it')
  // The inner-scroller page at 1440 with the map below the fold: lift 0 at every scroll.
  const s4 = pageScrolls(doc(900), winStyle, pillEl)
  for (const y of [0, 967, 2067]) { const l = liftFor(1855 - y, pillFloor({ viewportH: 900, scrolls: s4 })); if (l !== 0) bad.push(`an inner-scroller page lifts the pill ${l}px at scroll ${y}`) }
  // 4. pageScrolls on its own.
  if (pageScrolls(doc(900), { innerHeight: 900 }) !== false) bad.push('pageScrolls says a full-screen page scrolls')
  if (pageScrolls(doc(901), { innerHeight: 900 }) !== false) bad.push('pageScrolls counts a 1px rounding overflow as a scroll')
  if (pageScrolls(null, null) !== false) bad.push('pageScrolls does not fail safe without a document')
  // 5. The component uses it.
  const body = (src.match(/function clampIntoView\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
  if (!body) bad.push('PinHint.vue has no clampIntoView() to read')
  else {
    if (!/pillFloor\(\{[^}]*scrolls:\s*offPage \|\| pageScrolls\(document, window, el\)/.test(body)) bad.push('clampIntoView does not take its floor from pillFloor({ … scrolls: offPage || pageScrolls(document, window, el) … })')
    if (!/const offPage = !!hr && \(hr\.top >= window\.innerHeight \|\| hr\.bottom <= 0\)/.test(body)) bad.push('clampIntoView does not treat a map wholly above or below the viewport as on a scrolling page')
    if (!/if \(!onScreen\.value \|\| !paneActive\.value\) \{ el\.style\.removeProperty\('--pin-hint-lift'\); return \}/.test(body)) bad.push('clampIntoView keeps a stale lift when the pill goes off screen')
    if (/Math\.min\(\s*window\.innerHeight/.test(body)) bad.push('clampIntoView still floors on window.innerHeight directly')
  }
  return bad
}

const real = { pillFloor: F.pillFloor, pageScrolls: F.pageScrolls }
const problems = audit(real, SRC)

if (process.argv.includes('--self-test')) {
  if (problems.length) { console.error('PIN-HINT-FLOOR SELF-TEST: FAIL — the real code already fails; fix that first.\n' + problems.map((p) => '  ✗ ' + p).join('\n')); process.exit(1) }
  const poisons = [
    ['the fold on every page (the old floor)', { ...real, pillFloor: ({ viewportH, sheetTop = Infinity, creditTop = Infinity }) => Math.min(viewportH, sheetTop, creditTop) }, SRC],
    ['a page that never scrolls', { ...real, pageScrolls: () => false }, SRC],
    ['a page that always scrolls', { ...real, pageScrolls: () => true }, SRC],
    ['obstacles dropped on a scrolling page', { ...real, pillFloor: (o) => (o.scrolls ? Infinity : F.pillFloor(o)) }, SRC],
    ['an inner scroller ignored (document only)', { ...real, pageScrolls: (d, w) => F.pageScrolls(d, w) }, SRC],
    ['no shadow-root crossing', { ...real, pageScrolls: (d, w, el) => { let e = el; while (e) { const oy = w && w.getComputedStyle ? w.getComputedStyle(e).overflowY : ''; if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1) return true; e = e.parentElement } return F.pageScrolls(d, w) } }, SRC],
    ['a stale lift kept off screen', real, SRC.replace("if (!onScreen.value || !paneActive.value) { el.style.removeProperty('--pin-hint-lift'); return }", 'if (!onScreen.value || !paneActive.value) return')],
    ['the off-page rule dropped', real, SRC.replace('scrolls: offPage || pageScrolls(document, window, el)', 'scrolls: pageScrolls(document, window, el)')],
    ['the old source line', real, SRC.replace(/const floor = pillFloor\([^\n]*\n/, 'const floor = Math.min(window.innerHeight, sheetFloor(r), creditFloor(r))\n')],
  ]
  let missed = 0
  for (const [name, fns, src] of poisons) { const caught = audit(fns, src).length > 0; console.log(`  ${name}: ${caught ? 'caught' : 'NOT CAUGHT'}`); if (!caught) missed++ }
  if (missed) { console.error(`PIN-HINT-FLOOR SELF-TEST: FAIL — ${missed} poison(s) not caught.`); process.exit(1) }
  console.log(`PIN-HINT-FLOOR SELF-TEST: PASS — all ${poisons.length} planted defects refused.`); process.exit(0)
}
if (problems.length) { console.error('PIN-HINT-FLOOR: FAIL\n' + problems.map((p) => '  ✗ ' + p).join('\n')); process.exit(1) }
console.log('PIN-HINT-FLOOR: PASS — a scrolling page keeps the pill at the map\'s bottom; a full-screen page still lifts it above the fold; sheet and credit still lift it; PinHint uses pillFloor().')
