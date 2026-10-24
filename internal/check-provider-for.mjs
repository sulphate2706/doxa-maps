#!/usr/bin/env node
/* check-provider-for.mjs — run as `bun run check:provider-for`. Source-only, headless, ~0.1s.
   Placed in internal/ by explicit decision for this one gate: it spans
   library/ plus three separate plugins, so no single plugin's scripts/ folder owns it. */
// C3: do the library helpers behave like the raw-global code they replace, on BOTH engine shapes AND
// on the ambiguous case that is neither?
//
// Same condition the shepherd set for C2: an equivalence gate, old pattern vs new, both engines. The
// three migrated sites, verbatim in shape from main 1a761741:
//   A1 pplrData.js:115        window.maplibregl && window.maplibregl.Map && map instanceof window.maplibregl.Map ? 'maplibre' : 'mapbox'
//   A2 research-map.vue:1322  !!(window.maplibregl && map.value instanceof window.maplibregl.Map)
//   B  all-people-groups:298  mapProvider === 'maplibre' ? window.maplibregl : window.mapboxgl
//
// ★ THE AMBIGUOUS CASE IS THE POINT OF THIS GATE, and it nearly cost a silent behaviour change.
// My first plan was to rewrite A1 and A2 in terms of the EXISTING isMapboxMap(). That is wrong in a
// way no per-engine test would have caught: both originals test for MAPLIBRE and fall through to
// mapbox/false, so a stub, a destroyed map, or a page where neither global loaded reads as 'mapbox'.
// An isMapboxMap() rewrite inverts the fall-through to 'maplibre'/true — changing what a diagnostic
// field reports and which attribution a poster PRINTS. Hence providerFor() returns undefined and each
// call site keeps its own default visible. Changing a default is not a curation migration.
//
// ★ AND THE PREMISE I HAD WRONG BEFORE THAT: I recorded in SPEC-LIBRARY-CURATION that "engineFor
// returns a NAME". It does not — it returns the engine NAMESPACE OBJECT (`return ml` / `return mb`).
// Two of my four bucket-D "must not migrate" conclusions rested on that false premise. Corrected in
// the spec; the lesson is that a helper's RETURN TYPE is a fact to read, not to infer from its name.
import { readFileSync } from 'node:fs'
import { providerFor, engineFor, isMapboxMap } from '../library/composables/useMapProvider.js'

// ★ engineGlobal CANNOT BE IMPORTED HERE, and the workaround matters. It lives in useMapInstance.js,
// whose import chain reaches library/i18n/index.js, which calls `import.meta.glob` -- a VITE
// transform, so plain Node throws "(intermediate value).glob is not a function". C2's gate never hit
// this because useMapProvider.js has no such chain.
// So this EXTRACTS AND EXECUTES engineGlobal's REAL SOURCE LINES rather than a paraphrase of them.
// Re-typing a three-line function into this gate would test my copy, and a copy silently drifts from
// the thing it stands for -- the same trap as a tool copied to a new filename that no-ops and exits 0.
// CDN is stubbed because engineGlobal reads only `.global` from the ENGINES table; the urls are
// irrelevant to it, which is checkable in the extracted text printed below on failure.
const umiSrc = readFileSync(new URL('../library/composables/useMapInstance.js', import.meta.url), 'utf8')
const enginesBlock = /const ENGINES = \{[\s\S]*?\n\}/.exec(umiSrc)
const engineGlobalSrc = /export function engineGlobal\(provider\) \{[\s\S]*?\n\}/.exec(umiSrc)
if (!enginesBlock || !engineGlobalSrc) {
  console.error('  FAIL - could not extract ENGINES / engineGlobal from useMapInstance.js -- the gate is NOT MEASURED, not passing')
  process.exit(2)
}
const engineGlobal = new Function(
  'const CDN = { mapboxGlJs:{url:""}, mapboxGlCss:{url:""}, maplibreGlJs:{url:""}, maplibreGlCss:{url:""} };\n'
  + enginesBlock[0] + ';\n'
  + engineGlobalSrc[0].replace(/^export /, '') + ';\n'
  + 'return engineGlobal;'
)()

let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

class MapboxMap {}
class MaplibreMap {}
globalThis.window = { mapboxgl: { Map: MapboxMap }, maplibregl: { Map: MaplibreMap } }

// the THREE old patterns, as they stood
const oldA1 = (map) => (window.maplibregl && window.maplibregl.Map && map instanceof window.maplibregl.Map ? 'maplibre' : 'mapbox')
const oldA2 = (map) => !!(window.maplibregl && map instanceof window.maplibregl.Map)
const oldB  = (provider) => (provider === 'maplibre' ? window.maplibregl : window.mapboxgl)
// the NEW expressions, exactly as they now read at the call sites
const newA1 = (map) => providerFor(map) || 'mapbox'
const newA2 = (map) => providerFor(map) === 'maplibre'
const newB  = (provider) => engineGlobal(provider)

// ── 1. A1 and A2 across every map shape, INCLUDING neither ──────────────────────────────────────
const CASES = [
  ['a Mapbox map', new MapboxMap()],
  ['a MapLibre map', new MaplibreMap()],
  ['AMBIGUOUS: a plain object that is neither', {}],
  ['AMBIGUOUS: null', null],
  ['AMBIGUOUS: undefined', undefined]
]
for (const [label, map] of CASES) {
  ok(oldA1(map) === newA1(map), `A1 ${label}: old "${oldA1(map)}" === new "${newA1(map)}"`)
  ok(oldA2(map) === newA2(map), `A2 ${label}: old ${oldA2(map)} === new ${newA2(map)}`)
}

// ── 2. B across every provider name, including the unrecognised one ─────────────────────────────
for (const p of ['maplibre', 'mapbox', 'auto', '', undefined, 'nonsense']) {
  ok(oldB(p) === newB(p), `B provider=${JSON.stringify(p)}: both resolve to the same namespace (${oldB(p) === window.maplibregl ? 'maplibregl' : 'mapboxgl'})`)
}

// ── 3. THE INVERSION THIS GATE EXISTS TO PREVENT ────────────────────────────────────────────────
// Documented as an executable claim, not as prose: isMapboxMap() is NOT a drop-in for these sites.
const wouldHaveBeen = (map) => (isMapboxMap(map) ? 'mapbox' : 'maplibre')
ok(wouldHaveBeen({}) !== oldA1({}),
  `PROOF: the isMapboxMap() rewrite I nearly shipped disagrees with the original on the ambiguous case (it says "${wouldHaveBeen({})}", the original says "${oldA1({})}")`)
ok(wouldHaveBeen(new MapboxMap()) === oldA1(new MapboxMap()) && wouldHaveBeen(new MaplibreMap()) === oldA1(new MaplibreMap()),
  'and it agrees on BOTH real engines -- which is exactly why a per-engine-only gate would have passed it')

// ── 4. return TYPES, since inferring one from a name is what went wrong ─────────────────────────
ok(typeof providerFor(new MaplibreMap()) === 'string', 'providerFor returns a STRING name')
ok(providerFor(new MaplibreMap()) === 'maplibre' && providerFor(new MapboxMap()) === 'mapbox', 'and the right one per engine')
ok(providerFor({}) === undefined, 'and undefined for neither -- never a guessed default')
ok(engineFor(new MaplibreMap()) === window.maplibregl, 'engineFor returns the NAMESPACE OBJECT, not a name (the premise I had backwards)')
ok(typeof engineGlobal('maplibre') === 'object', 'engineGlobal returns a namespace OBJECT from a name')
ok(/ENGINES\[provider\]\?\.global \|\| ENGINES\.mapbox\.global/.test(engineGlobalSrc[0]),
  'CONTROL: the EXTRACTED source really is the mapbox-defaulting version -- this is what makes the bucket-C fallback finding true, and it is read from the file, not remembered')

// ── 5. NEG CONTROLS: the comparisons above must be capable of failing ───────────────────────────
ok(oldA1(new MaplibreMap()) !== oldA1(new MapboxMap()), 'NEG CONTROL: A1 discriminates the two engines at all')
ok(oldB('maplibre') !== oldB('mapbox'), 'NEG CONTROL: B discriminates the two namespaces at all')
const brokenNewA1 = () => 'mapbox'   // a helper that always says mapbox
ok(!CASES.every(([, m]) => oldA1(m) === brokenNewA1(m)),
  'NEG CONTROL: a helper that always answered "mapbox" would FAIL this gate -- so passing means something')

console.log(fails ? `\nC3-EQUIVALENCE: ${fails} FAIL(s)` : '\nC3-EQUIVALENCE: all three migrated sites match the raw-global code they replace, on both engines and on every ambiguous input')
process.exit(fails ? 1 : 0)
