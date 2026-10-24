#!/usr/bin/env node
// check-leaf-hints — a map leaf gives the browser its origins early; a non-map leaf carries no map hint.
//
// ★ WHY. A first visit to a map leaf ran serially: leaf HTML → the bundle (250–470 KiB gz, parsed) →
// only THEN the engine (from cdn.jsdelivr.net or api.mapbox.com) → the style host → tiles → data. Four
// origins, discovered one after another, none pre-connected — the shape behind A9's 3–5 s cold map
// (_qa-cycle/03-deployment-cycle/A9-MAP-LOAD-STATIC.md). generate-tree now emits, per MAP leaf, a
// preconnect for the engine + style + data origins and (on the 'auto' leaf, which carries no engine
// <script>) a preload of the engine, so DNS/TLS and the engine start alongside the bundle.
//
// This is the two-sided guard, matching check:leaf-engine-per-provider's stance (a non-map leaf loads no
// map peer). It reads the BUILT tree's leaf pages:
//   1. every MAP leaf (one that draws tiles — its page carries an engine peer or the "auto" no-tags note)
//      must carry the A9 preconnect hints;
//   2. no NON-MAP leaf (grid / card / chart-table / app-shell / composite: "NO map peer") may carry any
//      map-engine hint (preconnect to an engine/style origin, or an engine preload) — dead weight that
//      also implies a gate.
// A hint's origin must be one the code actually uses (library/constants/cdn.js + the MapLibre style host),
// so a stale origin cannot pass. Node only: reads files, starts nothing. Exit 0 pass/skip, 1 fail.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { CDN } from '../library/constants/cdn.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TREE = join(REPO, 'public', TREE_NAME)
if (!existsSync(TREE)) {
  console.log(`LEAF-HINTS: SKIP — no tree at ${TREE} (run bun run tree first)`)
  process.exit(0)
}

const ORIGIN = (u) => { try { return new URL(u).origin } catch { return '' } }
// The origins a hint may name, from the same registry the runtime reads + the MapLibre style host.
const ENGINE_ORIGINS = [ORIGIN(CDN.mapboxGlJs.url), ORIGIN(CDN.maplibreGlJs.url)]
const STYLE_ORIGINS = ['https://tiles.openfreemap.org', ORIGIN(CDN.mapboxGlJs.url)]
const MAP_ORIGINS = new Set([...ENGINE_ORIGINS, ...STYLE_ORIGINS].filter(Boolean))

const HINTS = 'A9 hints'
const ENGINE_RE = /useMapInstance|useMapProvider|mapbox-gl|maplibre-gl|window\.(?:mapboxgl|maplibregl)/

// The rule the generator applies (mapPageHtml → drawsMapInPage): a leaf gets A9 hints iff its OWN page
// loads a map engine — a real map leaf (`isMap`), OR a cap-4 `nested-elements-mfe` composite whose bundle
// mounts a map inline (`bundleLoadsEngine`) — and it is not a cap-5 `nested-mfe-spa` shell (its maps are
// iframe children). A plain non-map leaf that merely SHARES a bundle with a map leaf gets none. The gate
// reads the same authoritative facts: profile `type`/`isMap` from the manifest, and the built bundle. So
// the gate and the generator cannot drift.
const manifest = JSON.parse(readFileSync(join(TREE, 'manifest.json'), 'utf8'))
const engineBundles = new Map()
function oneBundleLoadsEngine(bundle) {
  if (!engineBundles.has(bundle)) {
    let hit = false
    try { hit = ENGINE_RE.test(readFileSync(join(TREE, bundle, `${bundle}.js`), 'utf8')) } catch { hit = false }
    engineBundles.set(bundle, hit)
  }
  return engineBundles.get(bundle)
}
// Element tag → owning bundle (mirrors generate-tree): a composes entry may name a child by element tag.
const elementToBundle = new Map()
for (const b of manifest.bundles || []) for (const e of (b.elements || [])) elementToBundle.set(e, b.bundle)
// This bundle OR any bundle it composes loads an engine (mirrors generate-tree's builtBundleLoadsEngine):
// catches a composite whose engine lives in a lazily-fetched child (research-map-plus-grid → doxa-research-map).
function bundleLoadsEngine(bundle, composes) {
  if (oneBundleLoadsEngine(bundle)) return true
  for (const c of composes || []) {
    const tag = String(c).split('/').pop()
    const child = elementToBundle.get(tag) || String(c).split('/')[0]
    if (child && child !== bundle && oneBundleLoadsEngine(child)) return true
  }
  return false
}
// Expected hint state per profile, and the leaf dirs it renders to (profile page + any instance pages).
const expect = new Map()   // "<bundle>/<profile>" -> boolean shouldHint
for (const b of manifest.bundles || []) {
  for (const p of b.profiles || []) {
    const shell = p.type === 'nested-mfe-spa'
    const composite = p.type === 'nested-elements-mfe'
    const shouldHint = (!!p.isMap || (composite && bundleLoadsEngine(b.bundle, b.composes))) && !shell
    expect.set(`${b.bundle}/${p.profile}`, shouldHint)
  }
}

// Every leaf index.html under the tree, mapped back to its "<bundle>/<profile>".
function leaves(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) leaves(p, out)
    else if (e === 'index.html') out.push(p)
  }
  return out
}
// rel is "<bundle>/<profile>[/<instance>]"; the profile key is the first two segments.
const keyOf = (rel) => rel.split('/').slice(0, 2).join('/')

const fails = []
let hinted = 0
let bare = 0
let unclassified = 0
for (const file of leaves(TREE)) {
  const html = readFileSync(file, 'utf8')
  const rel = file.slice(TREE.length + 1)
  const key = keyOf(rel)
  if (!expect.has(key)) { unclassified += 1; continue }   // a non-profile page (e.g. tree root) — not our subject
  const shouldHint = expect.get(key)
  const hasHints = html.includes(HINTS)
  const preconnects = [...html.matchAll(/<link rel="preconnect" href="([^"]+)"/g)].map((m) => m[1])
  const enginePreload = /<link rel="preload" as="script" href="([^"]+maplibre-gl[^"]*|[^"]+mapbox-gl[^"]*)"/.test(html)
  const mapHint = preconnects.some((o) => MAP_ORIGINS.has(o)) || enginePreload

  if (shouldHint) {
    if (!hasHints) fails.push(`${rel}: loads a map engine in its own page but has NO A9 hints`)
    else hinted += 1
    for (const o of preconnects) {
      if (!MAP_ORIGINS.has(o) && !/^https:\/\/[a-z0-9.-]+$/i.test(o)) fails.push(`${rel}: malformed preconnect origin ${o}`)
    }
  } else {
    if (mapHint || hasHints) fails.push(`${rel}: does not load a map engine in its own page, yet carries a map-engine hint`)
    else bare += 1
  }
}
const maps = hinted, nonMaps = bare

if (maps === 0) fails.push('no map leaves found in the tree: the classifier or the tree is wrong')

if (fails.length) {
  console.error(`LEAF-HINTS: FAIL — ${fails.length} problem(s)`)
  for (const f of fails.slice(0, 30)) console.error(`  ✗ ${f}`)
  if (fails.length > 30) console.error(`  … and ${fails.length - 30} more`)
  process.exit(1)
}
console.log(`LEAF-HINTS: PASS — ${maps} map leaf/leaves carry engine-aware hints; ${nonMaps} non-map leaf/leaves carry none`)
