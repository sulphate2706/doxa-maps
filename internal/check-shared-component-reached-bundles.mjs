#!/usr/bin/env node
/**
 * check-shared-component-reached-bundles — a shared fix is only as deployed as the last rebuild
 * of every bundle that consumes it.
 *
 * THE DEFECT THIS CATCHES. library/ is the single source of truth, but EVERY BUNDLE SHIPS ITS OWN
 * COMPILED COPY of the components it imports. So a one-line fix in a shared component is live in
 * whichever bundles happened to be rebuilt afterwards, and silently absent from the rest. Nothing
 * detects it: every other gate measures the RENDERED BEHAVIOUR OF ONE LEAF, and a leaf whose
 * bundle is stale renders the old behaviour perfectly.
 *
 * MEASURED 2026-09-24, two independent instances in one week:
 *   - PosterWall hover outline (landed a7f57c1): present in my-upg-100-list, ABSENT from
 *     key-cities, country-posters and regions-dashboard — 3 of 4 consumers stale.
 *   - SemanticTreeLegend legend.a11y keys: present in 4 bundles, ABSENT from research-dashboard —
 *     so a legend there still ships nameless carets while check:a11y-button-names passes 791/791,
 *     because that gate only sees the caret on leaves where an expandable branch happens to render.
 * The second one was nobody's active work. It had simply been sitting there.
 *
 * ★ IT ASSERTS A MARKER STRING, NOT A TIMESTAMP OR A HASH. Comparing mtimes says "this bundle is
 * older" and produces noise on every unrelated rebuild; comparing hashes cannot work at all,
 * because a bundle legitimately differs from the library source it compiled. The question that
 * actually matters is narrower and answerable: DOES THE BUILT BUNDLE CONTAIN THIS SPECIFIC CHANGE?
 * A distinctive literal from the change answers exactly that, and it is the same technique used to
 * prove a bundle is not stale after a rebuild.
 *
 * ⚠ THE MARKER MUST SURVIVE MINIFICATION. A CSS rule, a translation key or a user-visible string
 * does; a variable name, a comment or whitespace does not. Markers are declared in MARKERS below
 * with the commit that introduced them, so a reader can tell whether a red line means "not rebuilt"
 * or "this marker was legitimately removed and the entry is stale".
 *
 * Usage: node internal/check-shared-component-reached-bundles.mjs
 *   SKIPs when the built tree is absent.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DOXA_REPO || resolve(HERE, '..')
const TREE = resolve(REPO, `public/${TREE_NAME}`)

// Each entry: a change that landed in a SHARED component, and a string that proves a built bundle
// contains it. `source` is where the marker must also still exist — if it does not, the marker is
// stale and the gate says so rather than failing every bundle.
const MARKERS = [
  {
    id: 'posterwall-hover-outline',
    component: 'library/components/poster/PosterWall.vue',
    marker: 'outline:2px solid #2f6fdb',
    landed: 'a7f57c1',
    why: 'the blue hover outline on poster cards',
  },
  {
    id: 'legend-a11y-keys',
    component: 'library/components/legends/SemanticTreeLegend.vue',
    marker: 'legend.a11y',
    landed: 'c4c60a4 and earlier',
    why: 'accessible names + aria-expanded on the legend row caret and clear chip',
  },
  {
    // A CONTROL-FLOW fix has no literal to grep, so this entry uses REGEX markers (see `has` below).
    // The built shape keeps its structure through minification even though names change:
    //   unguarded  const o=e.getRootNode();if(!(o instanceof ShadowRoot))
    //   guarded    if(!e)return;const o=e.getRootNode();if(!(o instanceof ShadowRoot))
    // The `instanceof ShadowRoot))return` tail pins it to ensureEngineCSS: useShadowStyles has its
    // own `if(!n)return;const i=n.getRootNode();if(!(i instanceof ShadowRoot)||…` — which matched the
    // first version of this regex and would have counted a rebuilt bundle as fixed WITHOUT the guard.
    // The trailing `)return` is ensureEngineCSS's early exit; useShadowStyles continues with `||`.
    // Proven both ways on a rebuilt doxa-simple-map: guarded source matches, guard stripped does not.
    id: 'map-unmount-guard',
    component: 'library/composables/useMapInstance.js',
    sourceRe: /if \(!element\) return\n\s*const root = element\.getRootNode\(\)/,
    builtRe: /if\(!([\w$]+)\)return;const ([\w$]+)=\1\.getRootNode\(\);if\(!\(\2 instanceof ShadowRoot\)\)return/,
    // ★ NOT EVERY CONSUMER COMPILES THE GUARDED FUNCTION. ensureEngineCSS is only called by
    // initializeMap; a bundle that imports pieces of useMapInstance (ensureEngineScript, engineGlobal…)
    // but never initializeMap gets it TREE-SHAKEN AWAY, so the guard can never appear there — and the
    // race cannot happen there either. Reported by upg100 (my-upg-100-list) 2026-09-25: 3 of 12
    // bundles were false negatives. `staleRe` is the UNGUARDED shape: a bundle is MISSING the fix only
    // if it still compiles ensureEngineCSS without the guard; with neither shape it is NOT AFFECTED.
    staleRe: /const ([\w$]+)=([\w$]+)\.getRootNode\(\);if\(!\(\1 instanceof ShadowRoot\)\)return/g,
    marker: 'if (!element) return (ensureEngineCSS)',
    landed: '2026-09-25',
    why: 'a map whose pane unmounts mid-initialise no longer throws "reading getRootNode" (check-map-unmount-mid-init)',
  },
  {
    // The RTL text plugin now installs for MapLibre too, from useMapInstance at the moment an engine
    // exists (a bundle entry runs before a lazily-injected MapLibre). The built marker is the keyless
    // jsDelivr URL, a string literal that survives minification. staleRe is initializeMap's own error
    // message: a bundle that compiles initializeMap WITHOUT the URL is stale; a bundle that compiles
    // neither is not affected (it never boots a map).
    id: 'rtl-text-maplibre',
    component: 'library/composables/useMapInstance.js',
    sourceRe: /installRtlTextPlugin\(gl\)/,
    builtRe: /cdn\.jsdelivr\.net\/npm\/@mapbox\/mapbox-gl-rtl-text/,
    staleRe: /GL JS script to your page/g,
    marker: 'installRtlTextPlugin(gl) (MapLibre RTL shaping)',
    landed: '2026-09-25',
    why: 'Arabic, Hebrew and Persian map labels are shaped on MapLibre (keyless) maps, not drawn as disconnected glyphs',
  },
  {
    // Basemap place names follow the reader's language (maps/localize-labels.js), applied from
    // useMapInstance on every style.load. The built marker is the coalesce expression's literal
    // prefix, which survives minification; staleRe is initializeMap's own error string (same logic
    // as rtl-text-maplibre: a bundle that compiles initializeMap without the marker is stale).
    id: 'basemap-labels-localized',
    component: 'library/composables/useMapInstance.js',
    sourceRe: /localizeBasemapLabels\(map\.value, readerLang\(\)\)/,
    builtRe: /\["coalesce",\["get","name:"/,
    staleRe: /GL JS script to your page/g,
    marker: 'localizeBasemapLabels(map.value, readerLang()) (basemap labels localized)',
    landed: '2026-09-25',
    why: 'country, city and street names on the basemap render in the reader\'s language (Mapbox setLanguage, MapLibre name:<lang>)',
  },
]
// A marker is a literal (`marker`, matched with includes) unless the entry supplies regexes.
const inSource = (m, src) => (m.sourceRe ? m.sourceRe.test(src) : src.includes(m.marker))
const inBuilt = (m, js) => (m.builtRe ? m.builtRe.test(js) : js.includes(m.marker))
// With a staleRe: does the bundle compile the OLD shape — an occurrence NOT immediately preceded by
// the guard? (The guarded form contains the old shape as a substring, hence the look-behind.)
const hasStale = (m, js) => {
  if (!m.staleRe) return true
  for (const x of js.matchAll(new RegExp(m.staleRe.source, 'g'))) if (!/return;$/.test(js.slice(Math.max(0, x.index - 24), x.index))) return true
  return false
}

if (!existsSync(TREE)) {
  console.log(`SHARED-REACHED-BUNDLES: SKIP — no built tree at ${TREE}.`)
  console.log('  Build first (bun run tree). Absence is not a pass.')
  process.exit(0)
}

// WHICH BUNDLES CONSUME A COMPONENT IS DERIVED, NOT LISTED. A hardcoded consumer list goes stale
// the moment someone adopts a shared component, and a gate that silently stops covering a new
// consumer is worse than no gate. Resolve it from the imports instead.
const consumersOf = (componentPath) => {
  const name = componentPath.split('/').pop()              // PosterWall.vue
  const out = new Set()
  const designs = resolve(REPO, 'plugin-designs')
  if (!existsSync(designs)) return out
  const walk = (dir, depth = 0) => {
    if (depth > 4) return
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('.')) continue
      const p = join(dir, e)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (!/\.(vue|js|mjs)$/.test(e)) continue
      let text
      try { text = readFileSync(p, 'utf8') } catch { continue }
      // ⚠ REQUIRE AN ACTUAL IMPORT, NOT A MENTION. This was a plain substring test, and a
      // substring cannot tell an import from a comment ABOUT the component.
      // MEASURED 2026-09-25: it reported research-dashboard as a stale consumer of
      // SemanticTreeLegend for three ticks, and I routed that "drift" to its owner as work to do.
      // It was a FALSE POSITIVE. research-dashboard imports the component ZERO times and mentions
      // it four times in PROSE — DashboardFacetRail.vue:3 says "the floating @map
      // SemanticTreeLegend is DROPPED", with the root cause it was dropped for. A bundle that
      // deliberately removed a component is CORRECT to lack its translation keys; the gate was
      // reading the comment explaining the removal as evidence of use.
      // A gate that manufactures work for another agent is worse than one that misses drift.
      const importPath = componentPath.replace(/^library\//, '@map/')
      const stem = name.replace(/\.vue$/, '')
      const isImport = new RegExp(
        // import ... from '<path or .../Name.vue>'  |  import('<...>')
        `(?:import[^;\\n]*?from\\s*|import\\s*\\(\\s*)['"\`][^'"\`]*(?:${
          importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        }|/${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.vue)['"\`]`,
      ).test(text)
      if (isImport) {
        // the BUNDLE is the first directory under plugin-designs/
        const rel = p.slice(designs.length + 1)
        out.add(rel.split('/')[0])
      }
    }
  }
  walk(designs)
  return out
}

console.log('SHARED-REACHED-BUNDLES')
const fails = []
const staleMarkers = []

for (const m of MARKERS) {
  const srcPath = resolve(REPO, m.component)
  if (!existsSync(srcPath)) {
    staleMarkers.push(`${m.id}: source ${m.component} no longer exists`)
    continue
  }
  const src = readFileSync(srcPath, 'utf8')
  if (!inSource(m, src)) {
    // THE MARKER IS GONE FROM SOURCE. That is a stale ENTRY, not a stale bundle — failing every
    // consumer here would blame the bundles for a change that was legitimately reverted.
    staleMarkers.push(`${m.id}: marker "${m.marker}" is no longer in ${m.component} — `
      + 'the change was reverted or reworded; update or drop this entry')
    continue
  }

  const consumers = [...consumersOf(m.component)].sort()
  const have = []
  const missing = []
  const unbuilt = []
  const unaffected = []
  for (const bundle of consumers) {
    const built = join(TREE, bundle, `${bundle}.js`)
    if (!existsSync(built)) { unbuilt.push(bundle); continue }
    const js = readFileSync(built, 'utf8')
    if (inBuilt(m, js)) have.push(bundle)
    else if (hasStale(m, js)) missing.push(bundle)
    else unaffected.push(bundle)
  }

  console.log(`  ${m.id} — ${m.why}`)
  console.log(`    landed ${m.landed}; ${have.length} of ${have.length + missing.length} built `
    + `consumer(s) carry it${unaffected.length ? ` (${unaffected.length} not affected)` : ''}${unbuilt.length ? `, ${unbuilt.length} not built` : ''}`)
  if (have.length) console.log(`    ✓ ${have.join(', ')}`)
  if (missing.length) console.log(`    ✗ ${missing.join(', ')}`)
  if (unbuilt.length) console.log(`    · not built: ${unbuilt.join(', ')}`)
  if (unaffected.length) console.log(`    – not affected (the changed code is not compiled in): ${unaffected.join(', ')}`)

  if (missing.length) {
    fails.push(`${m.id}: ${missing.length} bundle(s) do NOT carry "${m.why}" — ${missing.join(', ')}`)
  }
}

if (staleMarkers.length) {
  console.log('\n  marker entries needing attention (NOT bundle failures):')
  for (const s of staleMarkers) console.log(`    · ${s}`)
}

if (fails.length) {
  console.error(`\nSHARED-REACHED-BUNDLES: FAIL — ${fails.length} shared change(s) have not reached every consumer.`)
  for (const f of fails) console.error('  - ' + f)
  console.error('\n  THIS IS A REBUILD, NOT A CODE CHANGE. The fix is already in library/; each bundle')
  console.error('  ships its own COMPILED copy, so a shared change is only as deployed as the last')
  console.error('  rebuild of each consumer. Rebuild the named bundles:')
  console.error('    BUNDLE=<name> bun x vite build && bun run tree')
  console.error('\n  Every other gate measures the rendered behaviour of ONE leaf, and a leaf whose')
  console.error('  bundle is stale renders the OLD behaviour perfectly — so they all stay green.')
  process.exit(1)
}
console.log('\nSHARED-REACHED-BUNDLES: PASS — every tracked shared change reached every built consumer.')
