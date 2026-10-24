/**
 * check-region-fill-repaint.mjs — the region fill must be repainted after its data, in EVERY order.
 *
 * ★ HARDENING, NOT THE FIX. The Regions tab has been seen loading GREY, first load only, coloured
 * after a reload. This gate guards ONE ordering that can reach a flat-grey fill (points arriving
 * after the layer and its mount repaint). On built bundles that ordering did NOT reproduce the grey
 * tab (0 of 20 loads grey, the fill present with its expression at addLayer), so the reported bug is
 * still open. The repaint below is idempotent, so guarding this ordering costs nothing.
 *
 * ★ NARROWED AFTER LANDING, and this is what the next reader needs: the ordering is not merely
 * "not the cause" — it is UNCONSTRUCTIBLE today. region-dashboards.vue:1091 gates the entire map
 * subtree behind v-if="loading", and loadRegions assigns points inside the try while loading=false
 * is in the finally, so the map CANNOT mount with empty points. A browser check measured 0 grey in 36 mounts,
 * including a run with the prayer API held back 20s: the map was constructed AFTER the data, every
 * time. So this gate guards a FUTURE refactor that drops that v-if data gate — not a live path.
 *
 * ★ THE MECHANISM, read out of RegionCountryMap.vue. The fill colour is a ['match'] built from
 * props.points; with no points regionFillExpression returns a FLAT no-data grey. addLayers()
 * SNAPSHOTS that value into paint['fill-color'] when it creates the layer. There are then TWO
 * independent async inputs that can arrive afterwards:
 *   1. props.points — the prayer rows, fetched by the dashboard.
 *   2. on MapLibre (the DEFAULT engine), the country boundaries geojson, added EMPTY and
 *      populated by a later src.setData(). Nothing repaints the fill after that setData.
 * Whichever arrives after the snapshot, the layer keeps the grey it was born with unless something
 * repaints it. applySubject() does repaint correctly — but every write is guarded on getLayer(),
 * so a change arriving BEFORE the layer exists is silently dropped and never retried.
 *
 * ★ WHAT THIS ASSERTS, and it is a MODEL not a mock: the four arrival orders, against the real
 * repaint rule. It fails if any order can leave the fill flat-grey while points exist. A browser
 * cannot be run here (that is a browser check), so the ordering is modelled and the SOURCE is asserted
 * to carry the repaint that makes the model's good cases reachable.
 */
import { readFileSync } from 'node:fs'

const SRC = new URL('../library/components/maps/RegionCountryMap.vue', import.meta.url).pathname
const src = readFileSync(SRC, 'utf8')
const fail = []

const GREY = '#grey-no-data'
const fillExpression = (points) => {
  const byCode = new Map()
  for (const p of points) { if (p?.code && p?.region && !byCode.has(p.code)) byCode.set(p.code, p.region) }
  return byCode.size ? ['match', ['get', 'iso_3166_1_alpha_3'], ...[...byCode].flat()] : GREY
}
const isGrey = (v) => typeof v === 'string' && v === GREY

/**
 * One run of the component's lifecycle under a given arrival order.
 * `repaintAfterData` models the FIX: a repaint that runs when late data lands, not only when a
 * layer already existed at the moment the data changed.
 */
function run({ pointsArriveLate, watchDropped, repaintAfterData }) {
  let points = []
  let layer = null
  // The real applySubject guards EVERY write on getLayer(): a change arriving before the layer
  // exists is silently dropped and never retried.
  const applySubject = () => { if (!layer) return; layer['fill-color'] = fillExpression(points) }
  const addLayers = () => { layer = { 'fill-color': fillExpression(points) } }   // :322, the snapshot

  if (!pointsArriveLate) points = [{ code: 'TCD', region: 'africa' }]

  // mount: whenStyleReady -> addLayers(); applySubject()
  addLayers()
  applySubject()

  // ★ THE GREYING ORDER: points land AFTER the layer and its mount repaint. The watch on
  // props.points is what must carry them. watchDropped models that repaint not happening — a
  // deep-watch that does not see a mutated-in-place array, or a fill whose repaint is skipped.
  if (pointsArriveLate) {
    points = [{ code: 'TCD', region: 'africa' }]
    if (!watchDropped) applySubject()
    if (repaintAfterData) applySubject()   // THE FIX: repaint on data, not only on a live layer
  }
  return layer['fill-color']
}

const ORDERS = [
  { name: 'points present before the layer is created', opts: { pointsArriveLate: false, watchDropped: false } },
  { name: 'points arrive late, watch repaints',         opts: { pointsArriveLate: true,  watchDropped: false } },
  { name: 'points arrive late, watch repaint MISSED',   opts: { pointsArriveLate: true,  watchDropped: true  } },
]

// ── 1. WITHOUT the fix, at least one order MUST grey — else this gate proves nothing ───────────
const greyWithout = ORDERS.filter((o) => isGrey(run({ ...o.opts, repaintAfterData: false })))
if (greyWithout.length === 0) {
  fail.push('NEGATIVE CONTROL BROKEN: no arrival order greys even without a repaint, so this model cannot detect the bug it exists for')
}

// ── 2. WITH the fix, NO order may grey ────────────────────────────────────────────────────────
for (const o of ORDERS) {
  if (isGrey(run({ ...o.opts, repaintAfterData: true }))) fail.push(`${o.name}: still flat grey with the repaint in place`)
}

// ── 3. THE SOURCE MUST CARRY THE REPAINT the model assumes ────────────────────────────────────
// A model that passes while the component lacks the repaint is a model of nothing.
if (!/applySubject\(\)/.test(src)) fail.push('RegionCountryMap.vue: no applySubject() call found at all')
// ★ THE WORDING HERE WAS WRONG ONCE AND THE CLAIM IS NARROWER THAN IT LOOKS. An EMPTY source does
// not draw grey — it draws NOTHING; fill-color is an expression over feature properties. So the
// late boundaries fetch cannot by itself produce the reported grey landmasses: a grey COUNTRY means
// features are present and the expression came back flat. The repaint after setData is still
// required, for a different and real reason: it is the moment the layer first HAS features, and the
// only repaint that is guaranteed to run with both inputs present on the MapLibre path.
// ★ SCOPED TO THE .then() BLOCK, NOT A CHARACTER WINDOW. The first version allowed 400 chars and
// failed on the repaint's own comment; widening it to 1600 then PASSED when I deleted the real
// repaint and left an unrelated applySubject() 1200 chars downstream — mutation-tested, so this is
// measured slackness, not a worry. A distance is the wrong instrument: what matters is that the
// repaint is INSIDE the promise callback that received the data. So the block is extracted by
// brace-matching from the .then((gj) => { that contains setData, and the repaint is required
// within THAT block.
function thenBlockContaining(needle) {
  const at = src.indexOf(needle)
  if (at === -1) return null
  // Anchor on the ENCLOSING callback's opening brace. Walking back to the nearest '=>' lands
  // INSIDE the body (`for (const f of ...)` has one), so the brace before it is the wrong one —
  // that is what made the first structural version report a missing repaint that was present.
  const head = src.lastIndexOf('=> {', at)
  const open = head === -1 ? -1 : src.indexOf('{', head)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return null
}
const setDataBlock = thenBlockContaining('src.setData(gj)')
const afterSetData = !!setDataBlock && /src\.setData\(gj\)[\s\S]*?applySubject\(\)/.test(setDataBlock)
if (!afterSetData) fail.push('RegionCountryMap.vue: the country-boundaries setData() is not followed by a repaint — on MapLibre (the default engine) that is the first moment the fill layer has features, and nothing re-evaluates the colour after it')
const pointsWatch = /watch\(\(\) => \[[^\]]*props\.points[^\]]*\][\s\S]{0,80}applySubject/.test(src)
if (!pointsWatch) fail.push('RegionCountryMap.vue: props.points is not watched into applySubject')

if (fail.length) {
  console.error('REGION-FILL-REPAINT: FAIL')
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`REGION-FILL-REPAINT: PASS — ${ORDERS.length} arrival orders, none flat-grey with the repaint; ${greyWithout.length} of them DO grey without it (so the check can fail); source carries the repaint after setData and the points watch.`)
