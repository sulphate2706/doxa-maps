#!/usr/bin/env node
/**
 * check-tiered-points — the whiteboard layer, proven by a chart that is NOT a tree.
 *
 * ★ THE FIXTURE IS THE POINT. A shared layer designed against ONE consumer is a tree with the word
 * "generic" written on it, and this repo produced three of those today. So the subject here is
 * gospel-internet's CENTERED SET, spec'd by its own author: ~2,100 group points on 10 concentric
 * rings, 3 tiers (band / ring / group), priority = population so the biggest names win a collision,
 * and NO EDGES AT ALL. The last part is what makes it evidence rather than decoration — if the layer
 * draws this chart with no links layer anywhere, then edges really are separable from the whiteboard
 * and not load-bearing in it.
 *
 * ★ AND IT IS EXERCISED, NOT GREPPED. The map is a recording fake: every addSource/addLayer/on call is
 * captured, so these assertions are about what the module DOES, not about what its source says. A
 * regex over the file would pass on a module that never called addLayer.
 *
 * Headless, no browser, no engine. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { addTieredPointLayers } = await import(resolve(ROOT, 'library/charts/whiteboard/tiered-points.js'))
const { whiteboardProjection } = await import(resolve(ROOT, 'library/maps/whiteboard-projection.js'))

const fails = []
const ok = (what, cond, detail = '') => { if (!cond) fails.push(`${what}${detail ? `\n      ${detail}` : ''}`) }

// ── gospel's centered set, laid out the way they describe it: innerR 30, ringGap 22, 10 rings ─────
const INNER = 30, GAP = 22, RINGS = 10
const project = whiteboardProjection({ extent: INNER + (RINGS - 1) * GAP })
const features = []
let n = 0
for (let ring = 0; ring < RINGS; ring++) {
  const r = INNER + ring * GAP
  const count = 40 + ring * 37                       // ~2,100 across the ten rings
  for (let i = 0; i < count; i++) {
    // deterministic angle from the id, as gospel's layout is: same id, same place, every render.
    const a = ((i * 2654435761) % 360) * Math.PI / 180
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: project(r * Math.cos(a), r * Math.sin(a)) },
      properties: { id: `g${n++}`, label: `Group ${n}`, tier: 'group', k: 1000 + (n % 997), ring } })
  }
  features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: project(r, 0) },
    properties: { id: `ring${ring}`, label: `Ring ${ring + 1}`, tier: 'ring', k: 100000 + ring } })
}
for (const [i, b] of ['dialect', 'language', 'family', 'nearby-only'].entries()) {
  features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: project(0, -(INNER + i * GAP)) },
    properties: { id: `band${i}`, label: b, tier: 'band', k: 900000 + i } })
}
const data = { type: 'FeatureCollection', features }

// ── a recording fake map ─────────────────────────────────────────────────────────────────────────
const makeMap = () => {
  const m = { sources: [], layers: [], handlers: [], filters: {} }
  m.addSource = (id, spec) => m.sources.push({ id, spec })
  m.addLayer = (spec) => m.layers.push(spec)
  m.on = (ev, layer, fn) => m.handlers.push({ ev, layer, fn })
  m.off = (ev, layer, fn) => { m.handlers = m.handlers.filter((h) => !(h.ev === ev && h.layer === layer && h.fn === fn)) }
  m.setFilter = (id, f) => { m.filters[id] = f }
  m.removeLayer = (id) => { m.layers = m.layers.filter((l) => l.id !== id) }
  m.removeSource = (id) => { m.sources = m.sources.filter((s) => s.id !== id) }
  return m
}

const TIERS = [
  { tier: 'band', minzoom: 0, weight: 'bold', offset: 1.1 },
  { tier: 'ring', minzoom: 3.6 },
  { tier: 'group', minzoom: 5.6, muted: true },
]
const map = makeMap()
let clicked = null, hovered = 'unset'
const h = addTieredPointLayers(map, {
  sourceId: 'cs', data, tiers: TIERS,
  colorExpr: ['get', 'colour'], radiusExpr: 3,
  onClick: (id) => { clicked = id }, onHover: (id) => { hovered = id },
})

ok('the point collection is added once, promoted on its id',
  map.sources.length === 1 && map.sources[0].spec.promoteId === 'id')
ok('~2,100 group points plus 10 ring labels plus 4 band labels', features.length > 2000 && features.length < 2300,
  `built ${features.length}`)
// ★ NO EDGES: the whole argument for this fixture.
ok('NOTHING creates a line layer — edges are separable, not load-bearing',
  map.layers.every((l) => l.type !== 'line'))
ok('one SYMBOL layer per tier, and no more', map.layers.filter((l) => l.type === 'symbol').length === TIERS.length)
for (const t of TIERS) {
  const l = map.layers.find((x) => x.id === `cs-lab-${t.tier}`)
  ok(`tier "${t.tier}" gets its own layer at its own minzoom`, l && l.minzoom === t.minzoom,
    l ? `minzoom ${l.minzoom}, expected ${t.minzoom}` : 'layer missing')
  ok(`tier "${t.tier}" resolves collisions by priority`, l && JSON.stringify(l.layout['symbol-sort-key']) === JSON.stringify(['get', 'k']))
}
ok('a dish is NOT invented when the caller asks for none', !map.layers.some((l) => l.id === 'cs-dish'))
ok('paint expressions are passed through unread — the layer has no opinion about colour',
  JSON.stringify(map.layers.find((l) => l.id === 'cs-dots').paint['circle-color']) === JSON.stringify(['get', 'colour']))

// ── selection and hover are FILTERS, and hover cannot move a camera because nothing here can ─────
h.setSelected('g7'); h.setHovered('g9')
ok('selection is a filter on its own layer', JSON.stringify(map.filters['cs-sel']) === JSON.stringify(['==', ['get', 'id'], 'g7']))
ok('hover is a filter on its own layer', JSON.stringify(map.filters['cs-hover']) === JSON.stringify(['==', ['get', 'id'], 'g9']))
ok('the module never calls a camera method', ['flyTo', 'easeTo', 'jumpTo', 'fitBounds'].every((k) => map[k] === undefined))
const fire = (ev) => map.handlers.filter((x) => x.ev === ev).forEach((x) => x.fn({ features: [{ properties: { id: 'g42' } }] }))
fire('click'); ok('a click reports the id it was given', clicked === 'g42')
fire('mousemove'); ok('a hover reports the id it was given', hovered === 'g42')
map.handlers.filter((x) => x.ev === 'mouseleave').forEach((x) => x.fn())
ok('leaving clears the hover rather than leaving it stuck', hovered === '')

// ── the dish IS available for the bounded set, without a new layer type ──────────────────────────
const m2 = makeMap()
addTieredPointLayers(m2, { sourceId: 'bs', data, tiers: [TIERS[0]], dish: { filter: ['==', ['get', 'tier'], 'band'], radiusExpr: 40 } })
ok("the bounded set's boundary circle is the same dish layer, not a new type",
  m2.layers.some((l) => l.id === 'bs-dish' && l.type === 'circle'))

// ── destroy leaves nothing behind ────────────────────────────────────────────────────────────────
h.destroy()
ok('destroy removes every layer it added', map.layers.length === 0)
ok('destroy removes the source', map.sources.length === 0)
ok('destroy detaches its handlers', map.handlers.length === 0)

if (fails.length) {
  console.error('TIERED-POINTS: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`TIERED-POINTS: PASS — ${features.length} points of a NON-TREE chart (gospel's centered set) render through the `
  + 'shared layer with no line layer anywhere, one label layer per tier at its own zoom, and selection and hover as filters.')
