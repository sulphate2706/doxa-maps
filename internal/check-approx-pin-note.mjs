#!/usr/bin/env node
/**
 * check-approx-pin-note — people-group pins say what they are, in one shared wording (APPROXPIN). Headless.
 *
 * ASSERTS (1) library/utils/colocation.js: groups on the same coordinate find each other (pairs, triples),
 *   a lone point shares with nobody, rows without a position are ignored, and both roster rows and GeoJSON
 *   features are read; (2) ApproxPinNote renders the first sentence always, the named second sentence only
 *   for a shared point, never a raw coordinate, and in Arabic from the Arabic catalogue.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildColocationIndex, colocatedWith } from '../library/utils/colocation.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
const check = (name, ok, got) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ' — ' + JSON.stringify(got)}`) }

const rows = [
  { name: 'Godda', latitude: 12.843781, longitude: 75.247906 },
  { name: 'Koraga', latitude: '12.843781', longitude: '75.247906' },
  { type: 'Feature', properties: { name: 'Maila' }, geometry: { type: 'Point', coordinates: [75.247906, 12.843781] } },
  { name: 'Alone', latitude: 10, longitude: 10 },
  { name: 'NoPos', latitude: '', longitude: '' },
]
const idx = buildColocationIndex(rows)
check('three groups on one point find each other', colocatedWith(idx, rows[0]).sort().join() === 'Koraga,Maila', colocatedWith(idx, rows[0]))
check('a GeoJSON feature is matched to rows on the same point', colocatedWith(idx, rows[2]).sort().join() === 'Godda,Koraga', colocatedWith(idx, rows[2]))
check('a lone point shares with nobody', colocatedWith(idx, rows[3]).length === 0, colocatedWith(idx, rows[3]))
check('a row without a position is ignored', colocatedWith(idx, rows[4]).length === 0, colocatedWith(idx, rows[4]))
// A click hands over the RENDERED feature: the engine rebuilt its geometry from tile coordinates, so it is
// near the roster point but not equal to it: ~0.001 degree at low zoom (a browser check, row 46: a shared point that never matched).
const rendered = { type: 'Feature', properties: { name: 'Koraga' }, geometry: { type: 'Point', coordinates: [75.2486, 12.8431] } }
check('a rendered (tile-rounded) feature still finds its co-located groups', colocatedWith(idx, rendered).sort().join() === 'Godda,Maila', colocatedWith(idx, rendered))
// The same people in two countries: the nearest roster row wins, not the first.
const twin = buildColocationIndex([...rows, { name: 'Koraga', latitude: 40, longitude: 40 }, { name: 'Other', latitude: 40, longitude: 40 }])
const renderedFar = { type: 'Feature', properties: { name: 'Koraga' }, geometry: { type: 'Point', coordinates: [40.0007, 39.9994] } }
check('a repeated name resolves to the nearest roster point', colocatedWith(twin, renderedFar).join() === 'Other', colocatedWith(twin, renderedFar))
// The rows a map DRAWS are normalized people groups (name + latitude/longitude, no geometry), and every
// map built on useMapData must offer them to its legends: the prayer map did not, so its legends read the
// raw API cache and neither the shared-point sentence nor the standing note appeared (a browser check, row 46 at 835ec1ac).
const drawn = [{ name: 'A', latitude: 12.85, longitude: 75.25 }, { name: 'B', latitude: '12.85', longitude: '75.25' }]
const clickedA = { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Point', coordinates: [75.2504, 12.8497] } }
check('normalized rows (no geometry) index and match a clicked pin', colocatedWith(buildColocationIndex(drawn), clickedA).join() === 'B', colocatedWith(buildColocationIndex(drawn), clickedA))
const umd = readFileSync(join(ROOT, 'library/composables/useMapData.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check('useMapData provides the rows it draws to the legends', /provide\(\s*'normalizedPeopleGroups'\s*,\s*normalizedPeopleGroups\s*\)/.test(umd), 'no provide in useMapData')

const { createServer } = await import('vite')
const { default: vue } = await import('@vitejs/plugin-vue')
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [vue()], resolve: { alias: { '@map': join(ROOT, 'library') } } })
try {
  globalThis.__INTLIFY_JIT_COMPILATION__ = true
  const Note = (await server.ssrLoadModule('/library/components/legends/ApproxPinNote.vue')).default
  const { createSSRApp, h } = await import('vue')
  const { createI18n } = await import('vue-i18n')
  const { renderToString } = await import('vue/server-renderer')
  const render = async (lc, props) => {
    const pins = JSON.parse(readFileSync(join(ROOT, 'library/i18n/locales', lc, 'pins.json'), 'utf8'))
    const app = createSSRApp({ render: () => h(Note, props) })
    app.use(createI18n({ legacy: false, locale: lc, messages: { [lc]: { pins } } }))
    return (await renderToString(app)).replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim()
  }
  const one = await render('en', {})
  check('first sentence always', /not a town or a boundary/.test(one) && !/same point/.test(one), one)
  const two = await render('en', { shared: ['Koraga', 'Maila'] })
  // The names join by the locale's own list grammar (library/i18n formatList), not by an English comma.
  check('shared point names the others and counts all', /Koraga and Maila/.test(two) && /3 groups share/.test(two), two)
  check('never prints a raw coordinate', !/\d+\.\d{3,}/.test(one + two), one + two)
  const ar = await render('ar', { shared: ['Koraga'] })
  check('Arabic renders from the Arabic catalogue', /[؀-ۿ]/.test(ar) && /Koraga/.test(ar), ar)
  const ar2 = await render('ar', { shared: ['Koraga', 'Maila'] })
  check('Arabic joins the names with و, never an English comma inside Arabic prose', /Koraga وMaila/.test(ar2) && !/Koraga, Maila/.test(ar2), ar2)
} finally { await server.close() }
if (bad) { console.log(`APPROX-PIN-NOTE: FAIL — ${bad} case(s).`); process.exit(1) }
console.log('APPROX-PIN-NOTE: PASS — pins say what they are, and name the groups that share a point.')
