#!/usr/bin/env node
/**
 * check-map-fly-reduced-motion — useMapFly honours prefers-reduced-motion for EVERY camera move, headless.
 *
 * A reader who asks the OS for reduced motion must not get flying/easing maps (a photosensitivity issue).
 * useMapFly decides it itself (cam()), so a caller cannot forget it; flyToCoords also honours caller
 * options (it used to take none, silently dropping a caller's { duration: 0 }).
 * Runs the real composable against a recording fake map, with matchMedia reporting reduce / no-preference.
 * USAGE  node internal/check-map-fly-reduced-motion.mjs      EXIT 0 pass · 1 fail
 */
let reduce = false
globalThis.window = { matchMedia: (q) => ({ matches: reduce && /prefers-reduced-motion:\s*reduce/.test(q) }), devicePixelRatio: 1 }
const { useMapFly } = await import('../library/composables/useMapFly.js')
const calls = []
const map = new Proxy({}, { get: (_, k) => (k === 'getZoom' ? () => 3 : (...a) => { calls.push({ fn: String(k), a }) }) })
const fly = useMapFly({ getMap: () => map })
let bad = 0
const check = (name, ok, got) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ' — got ' + JSON.stringify(got)}`) }
const run = (fn) => { calls.length = 0; fn(); return calls.slice() }
const B = [[0, 0], [10, 10]]

console.log('MAP-FLY-REDUCED-MOTION: the real useMapFly against a recording map (no browser)')
reduce = false
let c = run(() => fly.flyTo([1, 2], { zoom: 4 }))
check('motion allowed: flyTo animates', c[0]?.fn === 'flyTo', c)
c = run(() => fly.fitBounds(B))
check('motion allowed: fitBounds eases (duration > 0)', c[0]?.fn === 'fitBounds' && c[0].a[1].duration > 0, c)
c = run(() => fly.flyToCoords({ longitude: 1, latitude: 2 }, 5, { duration: 0 }))
check('flyToCoords passes caller options through ({ duration: 0 })', c[0]?.fn === 'flyTo' && c[0].a[0].duration === 0 && c[0].a[0].zoom === 5, c)

reduce = true
c = run(() => fly.flyTo([1, 2], { zoom: 4 }))
check('reduced motion: flyTo becomes jumpTo', c.length === 1 && c[0].fn === 'jumpTo' && c[0].a[0].zoom === 4, c)
c = run(() => fly.flyToCoords({ longitude: 1, latitude: 2 }))
check('reduced motion: flyToCoords becomes jumpTo', c.length === 1 && c[0].fn === 'jumpTo', c)
c = run(() => fly.fitBounds(B))
check('reduced motion: fitBounds is instant (animate:false, duration 0)', c[0]?.fn === 'fitBounds' && c[0].a[1].animate === false && c[0].a[1].duration === 0, c)
c = run(() => fly.resetView())
check('reduced motion: resetView makes no flyTo/easeTo', !c.some((x) => x.fn === 'flyTo' || x.fn === 'easeTo'), c)

if (bad) { console.log(`MAP-FLY-REDUCED-MOTION: FAIL — ${bad} case(s).`); process.exit(1) }
console.log('MAP-FLY-REDUCED-MOTION: PASS — every camera move in useMapFly is instant under reduced motion; caller options reach flyToCoords.')
