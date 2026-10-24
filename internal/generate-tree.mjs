#!/usr/bin/env node
/**
 * generate-tree.mjs — build the self-contained doxa-maps/ output tree.
 *
 * Runs AFTER the per-bundle vite builds (which emit app/doxa-maps/<bundle>/<bundle>.js).
 * It scans plugin-designs/<bundle>/*.vue, pulls the OPTIONAL JSDoc header tags from the
 * top of each profile, reads the custom-element tag(s) each bundle registers in its
 * index.js, then WRITES, into the doxa-maps/ tree:
 *
 *   doxa-maps/
 *     index.html              ← staging root: every bundle, tab strip, links out
 *     manifest.json           ← machine-readable index of all bundles + profiles
 *     <bundle>/
 *       <bundle>.js           ← the IIFE bundle (already emitted by vite)
 *       index.html            ← bundle staging: lists this bundle's profiles
 *       <profile>/
 *         index.html          ← standalone embeddable profile page
 *
 * Every generated HTML page is SELF-CONTAINED: no fetch() for the manifest, no
 * dev-server staging.js dependency. The bundle list + profile list are inlined at
 * build time. The profile page loads Mapbox CDN + the parent bundle IIFE and mounts
 * the web component; the Mapbox token is fetched at runtime from window.MAP_TOKEN_URL
 * (configured via tokenUrl in vite.doxa-maps-build-config.json).
 *
 * Destinations & name: both come from vite.doxa-maps-build-config.json — `name` sets the output
 * folder name (default "doxa-maps", independent of this bundler folder's own name),
 * `paths` lists extra folders to copy the whole tree into. The tree is always written
 * to ./app/<name>/ plus <path>/<name>/ for every entry in `paths`.
 *
 * Run standalone:  bun generate-tree.mjs    (expects vite build already ran)
 * Wired into:      bun run build            (runs after the per-bundle vite builds)
 */
import { CDN } from '../library/constants/cdn.js'
import { isWebBuilt } from './plugin-targets.mjs'
import {
  readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync,
  cpSync, rmSync, mkdtempSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { globalVariant } from '../library/scripts/posters/pin-poster-render.mjs'
// Bake the composition tier (capability machine-key) INTO the manifest so ANY consumer —
// the built gallery AND the plugin-studio cap-5 element — can group by capability 5→1
// without a separate tierMap. Previously the manifest carried no `type`, so a manifest-fed
// consumer (plugin-studio) mis-tiered every profile as cap-1 (single). Single source of truth.
import { detectProfileType } from './plugin-gallery/discover.mjs'
import { profileMetaFields, bundleStage, bundleVisibility, readProfileMeta, VISIBILITY } from './profile-meta.mjs'
import { TREE_NAME as CONFIGURED_TREE_NAME } from './_tree-name.mjs'
import { deriveComposedTiers } from './_composed-tiers.mjs'
import { syncAppShells } from './sync-app-shells.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_PROFILES = resolve(__dirname, '..', 'plugin-designs')
// The single build-config for this bundler (name, paths, embedBaseUrl, tokenUrl).
const BUILD_CONFIG_FILE = resolve(__dirname, '..', 'vite.doxa-maps-build-config.json')
const SOURCES = resolve(__dirname, '..', 'library/api/sources.json')

// The single build-config (vite.doxa-maps-build-config.json): `name` = output folder
// name (decoupled from this bundler folder, which stays doxa-maps); `paths` = extra
// copy destinations; `embedBaseUrl` = absolute base for embed snippets; `tokenUrl` =
// the token endpoint baked into every page. One file, read once here.
function readBuildConfig() {
  try {
    const cfg = JSON.parse(readFileSync(BUILD_CONFIG_FILE, 'utf8'))
    const name = (typeof cfg.name === 'string' && cfg.name.trim()) ? cfg.name.trim() : CONFIGURED_TREE_NAME
    const paths = Array.isArray(cfg.paths) ? cfg.paths.filter((p) => typeof p === 'string' && p.trim()) : []
    // Local, NON-committed sync override: `DOXA_SYNC_PATHS=/abs/dir[,/abs/dir2]` ALSO copies the
    // built tree into extra destinations (e.g. a local doxa-life checkout's public folder) without
    // hardcoding a machine-specific path into this shared config. Each dest gets <dir>/<name>/.
    if (process.env.DOXA_SYNC_PATHS) {
      for (const p of process.env.DOXA_SYNC_PATHS.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!paths.includes(p)) paths.push(p)
      }
    }
    // EMBED_BASE_URL overrides the committed embedBaseUrl, the same way DOXA_SYNC_PATHS extends paths:
    // a host that builds its own tree (maps-dev's /cdn build inherits the container env) bakes absolute
    // snippet URLs without a committed config change. It is the base WITHOUT the tree name
    // (https://<host>/cdn -> .../cdn/<name>/...). check-embed-targets-exist reads the same.
    const embedBaseUrl = ((process.env.EMBED_BASE_URL || '').trim()
      || (typeof cfg.embedBaseUrl === 'string' ? cfg.embedBaseUrl.trim() : '')).replace(/\/+$/, '')
    const tokenUrl = typeof cfg.tokenUrl === 'string' ? cfg.tokenUrl.trim() : ''
    // OPT-IN baked token (token ladder rung 3): a literal Mapbox token inlined into
    // every generated page. Empty by default — prefer tokenUrl (a URL, not a secret).
    // Only set this when you deliberately want the token to ship inside the folder.
    const token = typeof cfg.token === 'string' ? cfg.token.trim() : ''
    // Where the SHARED asset tree (previews, posters, boundaries) is served from.
    // Vite no longer copies public/ into every bundle (publicDir:false), so pages
    // must be told where the one shared copy lives. Empty = derive a RELATIVE path
    // per page depth (keeps a dropped folder self-contained under one web-root);
    // set it ABSOLUTE (https://maps.doxa.life/assets) when bundles are embedded on
    // partner sites or loaded by the mobile app, where relative cannot resolve.
    const assetsBaseUrl = (typeof cfg.assetsBaseUrl === 'string' ? cfg.assetsBaseUrl.trim() : '').replace(/\/+$/, '')
    // The data API every generated page points at, baked as window.MAP_APP_API_URL before the
    // bundle loads — the HOT-SWAPPABLE backend seam. Empty = same-origin. Set it to the live API
    // now (https://pray.doxa.life) and flip this ONE field to the self-hosted campaigns-server URL
    // once it runs on the host platform; every map repoints with no code change. A per-instance apiBaseUrl
    // in a *.instances.json still overrides this for that instance.
    const apiBaseUrl = (typeof cfg.apiBaseUrl === 'string' ? cfg.apiBaseUrl.trim() : '').replace(/\/+$/, '')
    // GATED profiles: bundle folder names withheld from the generated tree, staging pages and
    // manifest (governance — e.g. key-cities). Their .js still BUILDS via vite; they simply never
    // appear on any public surface the generator emits. convert.py gates the plugin index too.
    const gatedProfiles = Array.isArray(cfg.gatedProfiles) ? cfg.gatedProfiles.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []
    // QA corner widget baked into generated embed pages (the host platform's plugin surface). Default true.
    // Partner embeds use the copy-embed SNIPPET with their own config, so they never get this.
    const qaWidget = cfg.qaWidget !== false
    // Ship the 42 MB print-resolution posters/ inside the tree? DEFAULT FALSE. The wall renders
    // from previews/, so the tree stays visually complete without them; bundling both pushed the
    // tree to 74 MB and the catalog server refused the pack. Turn on only for a fully offline drop.
    const bundlePosters = cfg.bundlePosters === true
    // Ship every poster ONCE, in its lightest printable form: its SOURCE (<id>.html, which the
    // browser rasterises) if it has one, else its raster (<id>.webp). bundlePosters is a single
    // boolean over a directory holding both, so it could not express this — and "neither" is
    // what left export and print preview 404ing on a default drop. Implied by bundlePosters:true
    // (which ships both forms of every poster).
    const posterSources = cfg.posterSources === true || bundlePosters
    return { name, paths, embedBaseUrl, tokenUrl, token, assetsBaseUrl, apiBaseUrl, gatedProfiles, qaWidget, bundlePosters, posterSources }
  } catch {
    return { name: CONFIGURED_TREE_NAME, paths: [], embedBaseUrl: '', tokenUrl: '', token: '', assetsBaseUrl: '', apiBaseUrl: '', gatedProfiles: [], qaWidget: true, bundlePosters: false, posterSources: false }
  }
}
const DEST_CONFIG = readBuildConfig()
const TREE_NAME = DEST_CONFIG.name

/**
 * Where a generated page should fetch shared assets from.
 *
 * TREE-RELATIVE, NOT WEB-ROOT-RELATIVE (BUG-DATA-ASSETS-NOT-SHIPPED-TREE-NOT-PORTABLE,
 * 2026-09-20). Assets live INSIDE the tree at `<TREE_NAME>/assets/`, so a page nested
 * `depth` levels below the web-root is `depth - 1` levels below the TREE ROOT and climbs
 * that many times. The tree is then the complete shipping unit: whoever rsyncs ONLY
 * `<TREE_NAME>/` still gets the data, and the folder resolves identically under file://,
 * a foreign subpath, Cloudflare-Drop or Railway.
 *
 * The previous form climbed `depth` times to a SIBLING `assets/` at the web-root. That is
 * correct only when the publisher also ships that sibling — ours ships the tree alone, so
 * every data fetch 404'd (all-people-groups, gospel-resources, cities-internet, upg-100).
 * A leaf could never reach a shared folder ABOVE the tree once the tree moved.
 *
 * An absolute `assetsBaseUrl` still always wins — the only form that works for a bundle
 * embedded on a partner site or loaded inside the mobile app, where there is no tree to
 * climb within (the page is on a foreign origin).
 *
 * @param {number} depth  levels from the web-root: <tree>/<bundle>/<profile>/ = 3
 */
function assetsBaseFor(depth) {
  // depth is measured from the WEB-ROOT; the tree root is one level in, hence depth - 1.
  return DEST_CONFIG.assetsBaseUrl || `${'../'.repeat(Math.max(0, depth - 1))}assets`
}
// The staging TOP must not mention deployment orgs (doxa/GO/...). The visible
// title is the PRODUCT title (config displayTitle, default org-free), never the deployment TREE_NAME
// (TREE_NAME stays in URLs/paths where it is a folder name, not branding).
const DISPLAY_TITLE = (typeof DEST_CONFIG.displayTitle === 'string' && DEST_CONFIG.displayTitle.trim())
  ? DEST_CONFIG.displayTitle.trim() : TREE_NAME
// Base URL every intra-tree ref (manifest iframeUrl/scriptUrl) is built against.
// With embedBaseUrl set (e.g. "https://doxa.life/js"), refs are ABSOLUTE — the
// build-time override for known hosts / partner embeds. WITHOUT it, refs are
// RELATIVE to the tree root (".", i.e. "./bundle/profile/…") so the whole folder
// is POSITION-INDEPENDENT: file://, Cloudflare-Drop, a foreign subpath, or Railway
// all behave identically (drop-portability gate, internal/drop-portability-check.mjs).
// A leading-slash "/doxa-maps/…" was the Drop breakage — any subpath host resolves
// it against the host origin, not the tree, and every iframe/script 404s.
const EMBED_BASE = DEST_CONFIG.embedBaseUrl
  ? `${DEST_CONFIG.embedBaseUrl}/${TREE_NAME}`
  : '.'
const DEFAULT_ROOT = resolve(__dirname, '..', 'public', TREE_NAME)   // ./public/<name>

const HEADER_BYTES = 8192            // only scan the top of each file (header lives there)
const TAG_RE = /^\s*\*\s*@([\w-]+)\s+(.+?)\s*$/gm           // JSDoc `* @tag value` lines
const DEFINE_RE = /customElements\.define\(\s*['"]([^'"]+)['"]/g  // registered element tags

// SCAFFOLDS are source DX copies to start a plugin, not plugins: their SOURCE ships, their placeholder
// pages must not be published. Same by-name rule as internal/plugin-gallery/discover.mjs, so the built
// manifest lists exactly what the dev manifest lists (a blank template-map-a/b in the built studio was
// the only difference, found 2026-09-25). Not gatedProfiles: that list is governance (private data).
const SCAFFOLD_BUNDLES = ['template-bundle']
// ★ THE MAPBOX ENGINE URL, read from the ONE place that loads it (useMapInstance.js ENGINES.mapbox.js),
// so the embed snippet's preload can never point at a different version than the one the bundle
// requests — a mismatched preload is not used, and the engine would download twice.
const MAPBOX_GL_JS = CDN.mapboxGlJs.url   // the ONE registry the bundle's loader reads too (library/constants/cdn.js)
// An engine's script + stylesheet preloads, pinned as useMapInstance.js loads them (a preload is reused only
// when its URL and request mode match the later request).
const pinnedPreload = (e, as) => `<link rel="preload" as="${as}" href="${e.url}" integrity="${e.integrity}" crossorigin="anonymous">\n`
const enginePreload = (engine) => engine === 'mapbox'
  ? pinnedPreload(CDN.mapboxGlJs, 'script') + pinnedPreload(CDN.mapboxGlCss, 'style')
  : pinnedPreload(CDN.maplibreGlJs, 'script') + pinnedPreload(CDN.maplibreGlCss, 'style')

const isBundleDir = (name) => !name.startsWith('_') && !name.startsWith('.') && !DEST_CONFIG.gatedProfiles.includes(name) && !SCAFFOLD_BUNDLES.includes(name)

// ★ A GATED bundle's folder never stays in the tree. vite.config.js builds it into .gated/ already; this
// removes one that arrived anyway (an older build, or a landing that kept the tree's side of a conflict),
// so the tree this writes is clean whatever came before. check:gated-not-in-tree asserts the result.
for (const g of DEST_CONFIG.gatedProfiles) {
  const dir = join(DEFAULT_ROOT, g)
  if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); console.log(`[generate-tree] removed gated bundle folder ${TREE_NAME}/${g}/ from the tree`) }
}

// ★ CUSTOM-ELEMENT NAME RULE (HTML spec): lowercase, must contain a hyphen, no spaces.
// @element is NOT a comment — the build copies it VERBATIM into manifest.json and consumers feed
// it straight to document.querySelector(). Anything else is a downstream SyntaxError.
const VALID_TAG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/

/** Pull the optional JSDoc header tags from the top of a .vue/.js file. */
function extractHeaderTags(filePath) {
  const head = readFileSync(filePath, 'utf8').slice(0, HEADER_BYTES)
  const tags = {}
  for (const m of head.matchAll(TAG_RE)) {
    const key = m[1]
    if (!(key in tags)) tags[key] = m[2]   // first occurrence wins
  }

  // ★ VALIDATE @element AT THE ONE CHOKE POINT EVERY CONSUMER READS FROM.
  // Hit for real 2026-09-20: big-picture.vue declared
  //     @element  bp-big-picture (this composite) + bp-research-header + people-groups-grid (nested)
  // i.e. documentation where a SELECTOR was expected. generate-tree copied it verbatim into
  // manifest.json; embed-smoke fed it to querySelector; the resulting SyntaxError was reported by a
  // catch-all as "mount timeout", so a DATA DEFECT IN A COMMENT masqueraded as a BROKEN PLUGIN —
  // on the one bundle that is tab-1 of the cap-5 SPA. It had been failing that suite for as long as
  // the suite existed, and nothing pointed at the real cause.
  // THE GENERAL RULE: any annotation a BUILD copies into a MACHINE-READ artifact is an INTERFACE,
  // not a comment. If a human can write prose there and the build accepts it, the build is missing
  // a validator. Fail loudly and name the file, the value and the rule.
  if (typeof tags.element === 'string' && !VALID_TAG_RE.test(tags.element)) {
    console.error(`\n[generate-tree] INVALID @element in ${filePath}`)
    console.error(`  got:      ${JSON.stringify(tags.element)}`)
    console.error('  expected: ONE bare custom-element tag — lowercase, containing a hyphen, nothing else')
    console.error('            (e.g. "bp-big-picture"). It is copied verbatim into manifest.json and')
    console.error('            passed to document.querySelector() by embedders and the smoke suites.')
    console.error('  fix:      put the tag alone on the @element line; document what it nests in the')
    console.error('            description above it, or in @composes.')
    process.exit(1)
  }
  return tags
}

// A leaf DRAWS A MAP iff its .vue references a map engine. This is the signal that a page
// needs a map peer (Mapbox/MapLibre) + the Mapbox token ladder; a leaf without it is a grid,
// card, chart-table or data-list and must render TOKEN-FREE with NO peer (see mapPageHtml).
// UNLIKE composite-TIER classification (which the codebase refuses to infer from source, see
// discover.detectProfileType), this is an unambiguous POSITIVE dependency check, not a
// heuristic tag guess: a file that imports useMapInstance / touches window.mapboxgl / loads a
// mapbox-gl|maplibre-gl peer unquestionably intends to draw tiles. Whole-file scan (not just
// the header) because these references live in the <script setup> body, not the JSDoc header.
const MAP_ENGINE_RE = /useMapInstance|useMapProvider|mapbox-gl|maplibre-gl|window\.mapboxgl|window\.maplibregl/
function isMapLeaf(filePath) {
  try { return MAP_ENGINE_RE.test(readFileSync(filePath, 'utf8')) }
  catch { return false }
}

/**
 * Does a profile own a map ANYWHERE beneath its folder, not just in its own root .vue?
 *
 * WHY THIS EXISTS (measured 2026-09-22). isMapLeaf scans ONE FLAT FILE. That is correct for a
 * simple leaf, and wrong for a profile that splits itself into components. The case that proved
 * it: `research-dashboard.vue` has ZERO engine references (grep count 0) and is the only .vue in
 * its folder — yet the profile owns a real Mapbox map at
 * `src/components/dashboards/DashboardMapPanel.vue`, one directory deeper. So every existing
 * resolution step reported map=False and the generator emitted TOKEN_FREE for it.
 *
 * THE MEASURED CONSEQUENCE, and why it is worth fixing rather than documenting. A TOKEN_FREE leaf
 * calls `mount('')`, so the `tk: token` branch never runs and the element's profile-config carries
 * no token. The map then survives only on the leaf's `window.MAP_TOKEN = BAKED_TOKEN` fallback —
 * which the generated page itself guards with `if (BAKED_TOKEN && !window.MAP_TOKEN)`, i.e. it
 * YIELDS to any pre-existing global. A negative control confirmed the asymmetry: blanking
 * window.MAP_TOKEN broke `dashboard-plus-grid` ALONE; its eight siblings were untouched because
 * they inject `tk` directly. One bundle was a single rung short of every other.
 *
 * BOUNDED ON PURPOSE. Only `src/` is walked, and only .vue/.js/.mjs are read. A profile's map
 * lives in its component tree; walking the whole folder would drag in data/, fixtures and built
 * output for no signal and real cost on every build.
 */
const NESTED_SCAN_DIRS = ['src']
const NESTED_SCAN_EXT  = /\.(vue|js|mjs)$/
function ownsAMapDeeply(profileDir) {
  for (const sub of NESTED_SCAN_DIRS) {
    const root = join(profileDir, sub)
    if (!existsSync(root)) continue
    const stack = [root]
    while (stack.length) {
      const cur = stack.pop()
      let entries
      try { entries = readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        const p = join(cur, e.name)
        if (e.isDirectory()) { stack.push(p); continue }
        if (NESTED_SCAN_EXT.test(e.name) && isMapLeaf(p)) return true
      }
    }
  }
  return false
}

/**
 * Does THIS PROFILE reach a map through its own import graph?
 *
 * ★ PER PROFILE, NOT PER BUNDLE (BUG-FALSE-ISMAP-BAKES-403KB-MAPBOX-INTO-MAPLESS-LEAVES, fixed
 * 2026-09-25). ownsAMapDeeply() answers "is there a map ANYWHERE under this bundle's src/", and the
 * single-leaf branch used it for every profile — so a map-less sibling inherited map-ness from the
 * bundle: regions-dashboard/regions-list shows a list and no map, but src/RegionCountryMap.vue made
 * it isMap=true. Its leaf then baked the ~400 KB Mapbox engine it never uses, and since 4a6886d2 its
 * embed snippet also preloaded it. This follows the RELATIVE imports reachable from the profile's
 * own .vue (bounded to the bundle folder, .vue/.js/.mjs), so research-dashboard — whose map sits
 * several imports deep in src/components/dashboards/DashboardMapPanel.vue — still resolves true.
 * An explicit boolean `isMap` in <profile>.meta.json wins over the scan.
 */
const RELATIVE_IMPORT_RE = /(?:import[^'"`;]*?from\s*|import\s*\(\s*|import\s+)['"`](\.{1,2}\/[^'"`]+)['"`]/g
/**
 * ★ AND THE @map/ ALIAS TOO (BUG-ALIAS-IMPORT-HIDES-A-MAP, measured 2026-09-29).
 *
 * Following only RELATIVE imports is what made the regions-list fix above correct, and it is also
 * what made a map INVISIBLE once the component holding it moved into library/. MEASURED: the seven
 * curated production tabs, alias imports resolved and re-tested — exactly ONE is misclassified.
 * regions-dashboard/regions-mfe renders a real map through
 * @map/components/maps/RegionCountryMap.vue — that file matches MAP_ENGINE_RE (it imports
 * useMapInstance and useMapProvider), but region-dashboards.vue holds no engine token of its own,
 * so the profile resolved isMap=FALSE. The other five map tabs happen to carry an engine token in
 * their own files as well, which is why only this one shows the symptom.
 *
 * THE MEASURED CONSEQUENCE. check-mapbox-drew takes its targets from this flag, so it was silently
 * measuring 6 of the 7 tabs — omitting the one tab with an open map bug. A gate that cannot see a
 * page is worse than no gate, because its PASS reads as coverage.
 *
 * WHY THIS DOES NOT REOPEN THE regions-list FALSE POSITIVE. That bug came from asking "is there a
 * map anywhere under this BUNDLE", which let a map-less sibling inherit map-ness. This still walks
 * the PROFILE'S OWN import graph and only adds one more edge to it: an alias import is a real
 * import, exactly as a relative one is. regions-list imports no map component and still resolves
 * false — asserted in the self-test below, because that is the regression worth pinning.
 *
 * BOUNDED THE SAME WAY. Only the @map/ prefix (there is one alias and it is fixed, so no bundler
 * resolution is needed), only into library/, only .vue/.js/.mjs. An @map/ import that escapes
 * library/ via .. is refused by the same startsWith check the relative arm uses.
 *
 * ★ AND A STRICTER TEST ONCE INSIDE library/, BECAUSE MAP_ENGINE_RE IS TOO LOOSE THERE. It matches
 * the BARE STRING 'maplibre-gl', which in a shared library is mostly prose and CSS: comments, and
 * selectors like .maplibregl-ctrl-bottom-left. MEASURED while building this: 12+ library files match
 * it without using an engine at all. The one that bit: wall-of-people-groups (a D3 wall, no map)
 * imports src/wallD3.js, which imports library/constants/cdn.js — a pinned URL + SRI table that
 * merely NAMES the engine CDNs. Following that edge with the loose test flipped a map-less leaf to
 * isMap=true, which is the exact 400 KB regression the per-profile fix above was written to stop.
 * So inside library/ a file counts only if it really DEPENDS on an engine: it imports the package,
 * or calls useMapInstance()/useMapProvider, or touches a global map object. Plugin files keep the
 * original loose test, so no existing in-bundle classification moves.
 */
const Q = '[\'"\\x60]'   // a quote: ' " or a backtick, written by code point so this line stays backtick-free
const LIBRARY_ENGINE_RE = new RegExp(
  `from\\s*${Q}(?:maplibre-gl|mapbox-gl)${Q}` +           // import … from 'maplibre-gl'
  `|import\\s*\\(\\s*${Q}(?:maplibre-gl|mapbox-gl)${Q}` + // await import('mapbox-gl')
  '|useMapInstance\\s*\\(' +                              // the composable, actually called
  `|from\\s*${Q}[^'"\\x60]*useMapProvider` +              // … from '@map/composables/useMapProvider.js'
  '|window\\.(?:mapboxgl|maplibregl)' +
  '|new\\s+(?:mapboxgl|maplibregl)\\.Map')
const ALIAS_IMPORT_RE = /(?:import[^'"`;]*?from\s*|import\s*\(\s*|import\s+)['"`](@map\/[^'"`]+)['"`]/g
const ALIAS_ROOT = resolve(__dirname, '..', 'library')   // vite.config.js:180 — '@map' is exactly this
function profileReachesAMap(dir, file) {
  const seen = new Set()
  const stack = [join(dir, file)]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    let src
    try { src = readFileSync(f, 'utf8') } catch { continue }
    // A library file has to really depend on an engine; a plugin file keeps the original test.
    if ((f.startsWith(ALIAS_ROOT) ? LIBRARY_ENGINE_RE : MAP_ENGINE_RE).test(src)) return true
    const push = (base, root) => {
      if (!base.startsWith(root)) return                      // stay inside the tree we are allowed to walk
      for (const cand of [base, base + '.vue', base + '.js', base + '.mjs', join(base, 'index.js')]) {
        if (NESTED_SCAN_EXT.test(cand) && existsSync(cand) && statSync(cand).isFile()) { stack.push(cand); break }
      }
    }
    for (const m of src.matchAll(RELATIVE_IMPORT_RE)) push(resolve(dirname(f), m[1]), dir)
    for (const m of src.matchAll(ALIAS_IMPORT_RE)) push(resolve(ALIAS_ROOT, m[1].slice('@map/'.length)), ALIAS_ROOT)
  }
  return false
}
function metaIsMap(dir, profileName) {
  try {
    const meta = JSON.parse(readFileSync(join(dir, `${profileName}.meta.json`), 'utf8'))
    return typeof meta?.isMap === 'boolean' ? meta.isMap : null
  } catch { return null }
}

/**
 * Does a cap-4 composite (`nested-elements-mfe`) compose a child that paints a map?
 *
 * A cap-4 composite mounts its children as custom elements in ITS OWN document, so it
 * needs the map engine + token that the child would otherwise have got from its own
 * iframe leaf page. Map-ness is therefore INHERITED from the composed children.
 *
 * Resolution order, most-declared to most-forgiving:
 *   1. meta.json `composes: ["<bundle>/<profile>", …]` — the author's explicit statement of
 *      what this composite nests. Each entry is resolved to a sibling .vue and scanned.
 *   2. the composite's OWN source — a composite may still touch a map engine directly.
 *   3. ANY OTHER profile in the same bundle. A cap-4 composite composes siblings from its
 *      own bundle by construction (one download serves every pane), so if the bundle ships
 *      a map at all, a composite in it can mount one. This is the SAFE default: a spurious
 *      peer on a genuinely map-free composite costs one cached script, whereas a MISSING
 *      peer costs the whole view (no canvas is ever created) — so the failure modes are
 *      deliberately asymmetric.
 *
 * @param {string} dir          the bundle's plugin-designs directory
 * @param {string} profileName  the composite profile (e.g. 'upg-100-mfe')
 * @param {string} file         the composite's own .vue filename
 */
function composesAMapLeaf(dir, profileName, file) {
  // 1. explicit `composes` from <profile>.meta.json
  try {
    const metaPath = join(dir, `${profileName}.meta.json`)
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      const composes = Array.isArray(meta?.composes) ? meta.composes : []
      // Entries are "<bundle>/<profile>" or a bare "<profile>".
      //
      // CORRECTED 2026-09-22 — this previously did `.split('/').pop()`, DISCARDING the bundle
      // segment, then looked for the .vue inside THIS bundle's dir. For a composite that nests a
      // child from ANOTHER bundle that lookup silently missed: the file does not exist there, so
      // isMapLeaf returned false and the composite was classified map-free. Measured case:
      // dashboard-plus-grid composes "research-dashboard", which lives in its own sibling bundle
      // directory, not in dashboard-plus-grid/.
      //
      // Two fixes, and BOTH were needed — neither alone is sufficient:
      //   (a) resolve cross-bundle: try the sibling bundle dir before falling back to this one;
      //   (b) scan the resolved profile DEEPLY (ownsAMapDeeply), because research-dashboard's own
      //       .vue has zero engine refs while its map sits in src/components/dashboards/.
      // Fixing only (a) still yields map=false — verified by simulation before writing this.
      const bundlesRoot = dirname(dir)
      const resolveChild = (entry) => {
        const parts = String(entry).split('/').filter(Boolean)
        const profile = parts[parts.length - 1]
        const bundle = parts.length > 1 ? parts[parts.length - 2] : null
        // Candidate profile DIRECTORIES, most-specific first.
        const dirs = []
        if (bundle) dirs.push(join(bundlesRoot, bundle))
        dirs.push(dir)                       // same-bundle sibling (the historical assumption)
        dirs.push(join(bundlesRoot, profile))// a bare entry naming a bundle of the same name
        for (const d of dirs) {
          if (!existsSync(d)) continue
          if (isMapLeaf(join(d, `${profile}.vue`))) return true
          if (ownsAMapDeeply(d)) return true
        }
        return false
      }
      const named = composes.map((c) => String(c)).filter(Boolean)
      if (named.length) {
        return named.some(resolveChild)
      }
    }
  } catch (_) { /* malformed meta → fall through to the source scans */ }

  // 2. the composite's own source — flat file first, then its own component tree. The deep scan
  //    is what catches a profile whose root .vue is a pure layout and whose map lives in
  //    src/components/ (the research-dashboard shape).
  if (isMapLeaf(join(dir, file))) return true
  if (ownsAMapDeeply(dir)) return true

  // 3. any sibling profile in the same bundle
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.vue') && f !== file)
      .some((f) => isMapLeaf(join(dir, f)))
  } catch { return false }
}

/**
 * The RAW `composes` array a profile declares in its own <profile>.meta.json, or null when
 * the profile declares none / the file is absent / malformed. This is the same source
 * composesAMapLeaf reads (see its point 1) but returns the author's data itself rather than
 * a map-ness boolean derived from it — the manifest needs the edges, not just the verdict.
 */
function readComposes(dir, profileName) {
  try {
    const metaPath = join(dir, `${profileName}.meta.json`)
    if (!existsSync(metaPath)) return null
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    const composes = Array.isArray(meta?.composes) ? meta.composes.map((c) => String(c)).filter(Boolean) : []
    return composes.length ? composes : null
  } catch { return null }
}

/**
 * Extra profile-config keys a profile declares in its own <profile>.meta.json under
 * `config`, merged into the standalone leaf page's BASE_CONFIG. Returns {} when absent.
 *
 * WHY THIS EXISTS (BUG-DOTLESS-MAPS-SHOW-TAP-A-DOT-HINT): the shared PinHint is mounted
 * by ProfileLoader for every profile and opts out via profile-config `pinHint:false`
 * (see library/components/hints/PinHint.vue). But the standalone leaf's config was a
 * HARDCODED object here, so no profile could actually set that key — the documented
 * opt-out existed with no channel to reach it, which is why PinHint's own header could
 * record "an opt-out no profile has ever used". cities-internet/connectivity-map and
 * gospel-resources/resources-map shade COUNTRY POLYGONS and render no dots at all, yet
 * both showed "Tap a coloured dot" (MEASURED live, 2026-09-23) — a hint pointing at
 * something the reader cannot see makes a working map look broken.
 *
 * Declarative on purpose: the generator stays free of a per-profile special case, and
 * the same channel serves any future profile-config key without another edit here.
 * `profile`/`tk`/`assetsBase`/`instanceId` are generator-owned and cannot be overridden.
 */
const RESERVED_CONFIG_KEYS = new Set(['profile', 'tk', 'assetsBase', 'instanceId', 'dataSource'])

/**
 * The phone rule for a standalone leaf (SPEC-MOBILE-FLAG): the manifest entry's `mobile` flag, and the
 * name the desktop-only message gives the map. ProfileLoader reads both; absent for a phone-ready map,
 * so every other leaf page keeps the bytes it has. The name is the profile's display label without a
 * trailing "(…)" note, which is written for the Studio rail rather than for a reader.
 */
function mobileConfig(profile) {
  if (!profile.mobile) return {}
  const name = String(profile.label || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
  return { mobile: profile.mobile, ...(name ? { mobileLabel: name } : {}) }
}
function readProfileConfig(dir, profileName) {
  try {
    const metaPath = join(dir, `${profileName}.meta.json`)
    if (!existsSync(metaPath)) return {}
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    const cfg = meta?.config
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return {}
    const out = {}
    for (const [k, v] of Object.entries(cfg)) {
      if (RESERVED_CONFIG_KEYS.has(k)) {
        console.error(`[generate-tree] ${profileName}.meta.json: ignoring reserved config key "${k}"`)
        continue
      }
      out[k] = v
    }
    return out
  } catch { return {} }
}

/** Element tag names a bundle registers, read from its index.js (order preserved). */
function extractElements(indexJsPath) {
  if (!existsSync(indexJsPath)) return []
  const src = readFileSync(indexJsPath, 'utf8')
  const tags = []
  for (const m of src.matchAll(DEFINE_RE)) if (!tags.includes(m[1])) tags.push(m[1])
  return tags
}

/**
 * Mapbox token source baked into every generated page. Returns a plain string that is
 * either a JS global name ("window.MAP_TOKEN_URL") or a literal URL. Resolved SAFELY as
 * DATA in the page — never eval'd — so a literal URL can't produce a SyntaxError.
 * Precedence: vite.doxa-maps-build-config.json `tokenUrl` (the drop-anywhere absolute
 * URL — the ONE place a developer sets their token endpoint) → sources.json
 * `mapboxTokenUrl` → "window.MAP_TOKEN_URL". This single value flows into every
 * profile + instance index.html across the tree.
 */
function readTokenUrlExpr() {
  if (DEST_CONFIG.tokenUrl) return DEST_CONFIG.tokenUrl
  try {
    const src = JSON.parse(readFileSync(SOURCES, 'utf8'))
    const v = src?._meta?.mapboxTokenUrl || src?.mapboxTokenUrl
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch (_) { /* fall through */ }
  return 'window.MAP_TOKEN_URL'
}

// ── HTML escaping ────────────────────────────────────────────────────────────
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\u0022/g, '&quot;')   // \u0022, not a bare quote: template-literal-check reads a bare one as an open string

// ── Shared theme (dark, gem frames) ──────────────────────────────────────────
const BASE_CSS = `
:root {
  --bg:#0a0e15; --surf:#121a27; --surf2:#0e1623; --line:#223047;
  --ink:#eef2f7; --mut:#9aa7b8; --dim:#6b7787; --cy:#46d4ff; --vi:#b9a6f5; --gold:#ffc24b; --grn:#5ee0a0;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background:
    radial-gradient(1100px 480px at 82% -12%, rgba(70,212,255,.10), transparent 60%),
    radial-gradient(820px 460px at -8% 112%, rgba(185,166,245,.10), transparent 60%),
    var(--bg);
  color: var(--ink); font-family: var(--sans); min-height: 100%; -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
code { font-family: var(--mono); background:#1f2937; padding:1px 5px; border-radius:4px; color:var(--gold); }
header.forge { padding: 22px 28px 6px; }
header.forge h1 { font: 800 21px/1.2 var(--sans); letter-spacing:-.02em; }
header.forge h1 .ac { color: var(--cy); }
header.forge .sub { margin-top: 6px; font: 13px/1.55 var(--sans); color: var(--mut); max-width: 78ch; }
header.forge .crumb { margin-top: 10px; font: 12px/1 var(--mono); color: var(--dim); }
header.forge .crumb a { color: var(--cy); }
#count { display:block; margin-top:10px; color:var(--cy); font:12px/1 var(--mono); }
/* tab strip */
.tabstrip { position: sticky; top: 0; z-index: 5; display:flex; gap:10px;
  padding: 12px 28px; overflow-x:auto; scrollbar-width:thin;
  background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px);
  border-bottom:1px solid var(--surf2); }
.tabstrip::-webkit-scrollbar { height:8px; }
.tabstrip::-webkit-scrollbar-thumb { background:#243349; border-radius:8px; }
.tab { flex:0 0 auto; text-align:left; cursor:pointer; min-width:198px; display:block;
  background:var(--surf); border:1px solid var(--line); border-radius:12px; padding:11px 14px; color:inherit; transition:.15s; }
.tab:hover { border-color:#33455f; transform:translateY(-1px); }
.tab.active { border-color:var(--gem,var(--cy));
  background: color-mix(in srgb, var(--gem,var(--cy)) 12%, var(--surf));
  box-shadow: 0 0 0 1px var(--gem,var(--cy)) inset, 0 6px 20px rgba(0,0,0,.3); }
.tab .tname { font:700 13px/1.1 var(--sans); display:flex; align-items:center; gap:8px; }
.tab .dot { width:9px; height:9px; border-radius:50%; background:var(--gem,var(--cy)); box-shadow:0 0 8px var(--gem,var(--cy)); }
.tab .ttags { margin-top:6px; display:flex; flex-wrap:wrap; gap:4px; }
.tab .etag { font:9px/1 var(--mono); color:var(--vi); border:1px solid rgba(185,166,245,.4); border-radius:999px; padding:3px 7px; }
.tab .tfile { margin-top:6px; font:10px/1 var(--mono); color:var(--dim); }
/* gem grid */
.grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:18px; padding: 18px 28px 28px; }
.gem { --gem:var(--cy); --gem-rgb:70,212,255; position:relative; display:flex; flex-direction:column;
  padding:12px; background:var(--surf); border:1px solid var(--gem); border-radius:14px;
  box-shadow:0 0 26px rgba(var(--gem-rgb),.14); transition:.2s; }
.gem:hover { transform: translateY(-2px); box-shadow:0 0 34px rgba(var(--gem-rgb),.22); }
.gem .ghead { display:flex; align-items:center; gap:10px; padding:4px 6px 10px; }
.gem .gtag { font:800 14px/1 var(--mono); color:var(--gem); }
.gem .gkind { font:9px/1 var(--mono); color:var(--dim); border:1px solid var(--line); border-radius:999px; padding:3px 8px; }
.gem .gbody { border:1px solid var(--gem); border-radius:10px; background:#0d1622; padding:14px; min-height:96px; }
.gem .gbody .desc { font:12px/1.5 var(--sans); color:var(--mut); }
.gem .gbody .meta { margin-top:8px; font:10px/1.4 var(--mono); color:var(--dim); }
.gem .gcta { margin-top:12px; display:flex; gap:8px; }
.gem .gcta a { font:11px/1 var(--mono); color:var(--gem); border:1px solid var(--gem); border-radius:8px; padding:8px 12px; }
.gem .gcta a:hover { background: color-mix(in srgb, var(--gem) 14%, transparent); }
.empty { color:var(--dim); font:13px/1.6 var(--mono); padding: 30px 28px; }
.foot { padding:14px 28px 20px; font:11.5px/1.5 var(--mono); color:var(--dim); border-top:1px solid var(--surf2); }
.foot .scr { color: var(--vi); }
/* profile page: full-bleed map */
.mapwrap { position:fixed; inset:0; }
.mapwrap .bar { position:absolute; top:0; left:0; right:0; z-index:10; display:flex; align-items:center; gap:10px;
  padding:10px 16px; background: color-mix(in srgb, var(--bg) 80%, transparent); backdrop-filter: blur(8px);
  border-bottom:1px solid var(--surf2); font:12px/1 var(--mono); color:var(--mut); }
.mapwrap .bar a { color: var(--cy); }
.mapwrap .bar .tag { color: var(--gem, var(--cy)); font-weight:700; }
.mapwrap .slot { position:absolute; inset:0; }
.mapwrap .slot > * { position:absolute; inset:0; width:100%; height:100%; display:block; }
.mapwrap .err { position:absolute; inset:0; display:grid; place-items:center; padding:24px; text-align:center;
  color:#f87171; font:13px/1.6 var(--mono); }
`

const GEMS = ['#46d4ff', '#b9a6f5', '#5ee0a0', '#ffc24b', '#f472b6', '#f59e0b', '#34d399']
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) }

// ── The "doxa-maps" staging shell ────────────────────────────────────────────
// ONE staging design, emitted at every tree level (root + each bundle). It is a
// thin HTML shell that loads the shared, org-agnostic renderer (staging-forge.js,
// inlined at build time below) with a `window.FORGE` config telling it which tree
// level it is + where the manifest is. The renderer reads the semantic-tree
// manifest and draws `bundle → profile → instance` tabs, live map tiles, an
// architecture showcase, a desktop/mobile viewport toggle, and seamless
// scroll-to-hide of the tree. NO org / bundle / profile names are hardcoded here.
const FORGE_CSS = readForgeAsset('internal/staging-forge.css')
const FORGE_JS  = readForgeAsset('internal/staging-forge.js')
  // Built pages inline this as a CLASSIC script — import.meta is a parse error there.
  .replace(/\/\* DEV-HMR-START[\s\S]*?DEV-HMR-END \*\//, '/* dev-hmr stripped for built pages */')

// `rel` is repo-root-relative (this script lives in internal/, one level down).
function readForgeAsset(rel) {
  try { return readFileSync(resolve(__dirname, '..', rel), 'utf8') }
  catch { return '' }
}

/**
 * The shared doxa-maps staging page. Self-contained: CSS + renderer are
 * INLINED (no external fetch that could 404 on a static host), except the
 * manifest which the renderer fetches relative to the page.
 *
 * @param {object} o
 * @param {'root'|'bundle'} o.scope
 * @param {string}  o.title
 * @param {string}  o.subtitle
 * @param {string=} o.bundle       - when scope==='bundle'
 * @param {string=} o.crumbHref    - back link (bundle scope)
 * @param {string=} o.crumbLabel
 */
function forgeHtml(o) {
  const forgeConfig = {
    mode: 'built',
    scope: o.scope,
    // ONE manifest at the tree root is the single source of truth. Root page
    // reads ./manifest.json; a bundle page (one level deeper) reads ../manifest.json.
    manifestUrl: o.scope === 'root' ? './manifest.json' : '../manifest.json',
    bundle: o.bundle || null,
    // The tree links (open/view) in staging-forge are relative to the ROOT tree.
    // A bundle page sits one level in, so it must prefix root-relative hrefs with '../'.
    hrefBase: o.scope === 'root' ? './' : '../',
  }
  const crumb = o.crumbHref
    ? `<a class="ext" href="${esc(o.crumbHref)}">← ${esc(o.crumbLabel || 'back')}</a>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- THIS PAGE IS OURS. The only thing that knows a document belongs to the plugin is the page
       the generator writes, so it says so here. library/i18n reads it before reflecting an RTL
       locale on <html dir>; nothing else sets it, so a PARTNER page defaults to "not ours" and
       is never touched. Absence must mean restraint — an embedded plugin flipping a partner's
       whole <html> because a reader followed a ?lang=ar link is the bug this prevents. -->
  <script>window.MAP_OWNS_PAGE = true;</script>
  <title>${esc(o.title)}</title>
  <link rel="icon" href="data:,">
  <style>${FORGE_CSS}</style>
</head>
<body>
  <header class="top">
    <h1>${esc(o.title.replace(' \u00b7 staging',''))}<span class="ac">${o.scope === 'root' ? '' : ' / ' + esc(o.bundle || '')}</span></h1>
    <div class="sub">${esc(o.subtitle)}</div>
  </header>
  <div class="strip" id="frameInfo">loading\u2026</div>
  <div id="tokenBar" class="hidden"></div>
  <div id="shell">
    <nav id="treeNav" aria-label="semantic tree"></nav>
    <main id="stage"></main>
  </div>

  <script>window.FORGE = ${JSON.stringify(forgeConfig).replace(/</g,'\\u003c')};
  /* file:// contract: manifest inlined at build \u2014 no fetch needed to render. */
  window.FORGE.manifest = ${JSON.stringify(o.inlineManifest || null).replace(/</g,'\\u003c')};</script>
  <script>${FORGE_JS}</script>
</body>
</html>
`
}

// ── Page templates ───────────────────────────────────────────────────────────

/** Root staging page — the doxa-maps showing ALL bundles (scope='root'). */
function rootHtml(bundles, manifest) {
  return forgeHtml({
    inlineManifest: manifest,
    scope: 'root',
    title: `${DISPLAY_TITLE} · staging`,
    subtitle: 'one shared core → many self-contained, paste-anywhere map bundles',
  })
}

/**
 * THE WEB-ROOT PAGE — a thin host that mounts <plugin-studio> and nothing else.
 *
 * THE DIRECTION (2026-09-22): a functional Plugin Studio with every plugin working, and none of
 * the old staging index.html pages that get in the way.
 * The dev server made this move first (internal/plugin-gallery/dev-plugin.mjs); this is the same
 * page for the BUILT tree, so `/` is the studio in BOTH trees and a developer who learns one
 * does not meet a different product in the other.
 *
 * ★ WHY THE HOST MARKUP RATHER THAN A REDIRECT to the built leaf at
 *   <tree>/plugin-studio/plugin-studio/index.html: a redirect makes `/` a hop that then shows a
 *   DEEPER url, so the studio's own address stops being the root. Mounting the tag here makes `/`
 *   BE the studio. It is also the honest cap-5 surface: the studio is a real custom element, so
 *   the root page uses the same deployment method (direct-JS) any host site would.
 *
 * ★ WHY A CLASSIC <script>, NOT type="module" — THIS IS THE LOAD-BEARING DETAIL.
 *   index.js derives the tree root from `document.currentScript.src` (two levels up).
 *   document.currentScript is non-null ONLY during SYNCHRONOUS classic-script evaluation; for a
 *   module it is ALWAYS null. With a module tag the derivation silently returns '', the studio
 *   falls back to '../manifest.json' → /manifest.json → 404, and it renders with ZERO tabs — a
 *   blank shell that reads as "no elements in the studio", not as a failed fetch. (The dev server
 *   can use a module tag only because it passes tree-base explicitly.) The built leaf pages have
 *   always used a classic tag; this page matches them.
 *   tree-base is ALSO passed explicitly — belt and braces, and it makes the contract readable
 *   rather than implied by a regex two files away.
 *
 * ★ NO PROSE, NO CHROME: "without a lot of text garb that takes up so much space" is a layout
 *   requirement, so this page contributes ZERO text — every pixel belongs to the element.
 *   Material LIGHT only (#f3f3f1 surface): no dark-mode block. The page it replaces carried a
 *   prefers-color-scheme:dark rule, which is how the root could go dark against a light product.
 *
 * ★ window.MAP_APP_API_URL IS NOT OPTIONAL HERE — it is baked for the same reason every leaf page
 *   bakes it. library/api/apiBaseUrl.js getApiBaseUrl() reads ONLY this global (or the build-time
 *   VITE_API_BASE_URL); there is no profile-config path. Nested elements the studio mounts are
 *   REAL elements that fetch their own data, so without this they fall back to a same-origin URL
 *   that does not exist and every data-backed tab fails.
 *   MEASURED, not reasoned: the first version of this page omitted it, and activating the
 *   all-people-groups tab logged `[rest-api] Failed to load from pray-tools` while the IDENTICAL
 *   element on its own leaf page loaded fine. The element still MOUNTED and was `defined` — which
 *   is precisely why this was nearly missed. "The custom element mounted" is a WEAKER claim than
 *   "the plugin works"; a mounted element with no data is the failure that looks like success.
 */
function studioRootHtml(bakedToken, integrity = '') {
  // THE TREE'S FRONT PAGE (<tree>/index.html) — the decision in card
  // BUILD-PLUGIN-STUDIO-IS-THE-OUTPUT-FRONT-PAGE: the output is ONE folder, and opening it opens the
  // studio. It used to sit one level ABOVE the tree (public/index.html) with the staging-forge chooser
  // at <tree>/index.html; both are replaced by this. Relative paths, so the folder stays
  // position-independent (drop-portability): a domain root, a foreign subpath, or file://.
  const src = `./plugin-studio/plugin-studio.js`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- THIS PAGE IS OURS. The only thing that knows a document belongs to the plugin is the page
       the generator writes, so it says so here. library/i18n reads it before reflecting an RTL
       locale on <html dir>; nothing else sets it, so a PARTNER page defaults to "not ours" and
       is never touched. Absence must mean restraint — an embedded plugin flipping a partner's
       whole <html> because a reader followed a ?lang=ar link is the bug this prevents. -->
  <script>window.MAP_OWNS_PAGE = true;</script>
  <title>${esc(DISPLAY_TITLE)} plugin studio</title>
  <link rel="icon" href="data:,">
${bakedToken ? `  <script>window.MAP_TOKEN=${JSON.stringify(bakedToken)};</script>\n` : ''}${DEST_CONFIG.apiBaseUrl ? `  <script>window.MAP_APP_API_URL = ${JSON.stringify(DEST_CONFIG.apiBaseUrl)};</script>\n` : ''}  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #f3f3f1; }
    /* 100svh, not 100vh: on a phone 100vh is the LARGE viewport, taller than what shows while the address bar is
       up, so the page scrolls by the bar's height and the app seems to resize as the bar hides and shows. svh is
       the viewport with the bar shown and never changes; 100% first is the fallback where svh is unknown. The
       --profile-min-h:0 opts out of ProfileLoader's 100dvh floor, which would otherwise grow the element when
       the bar hides. */
    plugin-studio { display: block; width: 100%; height: 100%; height: 100svh; --profile-min-h: 0; }
  </style>
</head>
<body>
  <plugin-studio tree-base="."></plugin-studio>
  <script src="${src}"${integrity ? ` integrity="${integrity}" crossorigin="anonymous"` : ''}></script>
</body>
</html>
`
}

/** Bundle staging page — the doxa-maps showing THIS bundle's profiles (scope='bundle'). */
function bundleHtml(b, index, manifest) {
  return forgeHtml({
    inlineManifest: manifest,
    scope: 'bundle',
    bundle: b.bundle,
    title: `${DISPLAY_TITLE}`,
    subtitle: `${b.bundle} — one bundle, its profiles as paste-anywhere maps`,
    crumbHref: '../index.html',
    crumbLabel: 'all bundles',
  })
}

/**
 * Shared standalone map page — a BARE, full-page map (the shareable leaf of the tree).
 * Per the design: profile/instance pages are NOT staging — no header, no tabstrip, no
 * chrome. The map custom element fills the viewport so the browser URL (location.href)
 * shares THE MAP directly. Loads Mapbox CDN + the parent bundle IIFE, resolves the
 * token via the ladder below, then mounts the web component with `config`.
 * Params:
 *   opts.title      page <title>
 *   opts.tag        custom-element tag
 *   opts.config     profile-config object (tk added at runtime; a hardcoded config.tk
 *                   is the ladder's top "prop" rung)
 *   opts.jsSrc      relative URL to the bundle IIFE (../ for profile, ../../ for instance)
 *   opts.apiBaseUrl optional — baked as window.MAP_APP_API_URL before the bundle loads
 *   opts.tokenUrlExpr sources.json mapboxTokenUrl value (data-safe URL or global name)
 *   opts.bakedToken opt-in literal token baked from build-config (ladder rung 3)
 */
// The origins a map leaf touches, from the ONE registry the runtime reads (library/constants/cdn.js)
// plus useMapInstance's MapLibre style host. Origins only (preconnect wants an origin, not a file).
const ORIGIN = (u) => { try { return new URL(u).origin } catch { return '' } }
const ENGINE_ORIGIN = { mapbox: ORIGIN(CDN.mapboxGlJs.url), maplibre: ORIGIN(CDN.maplibreGlJs.url) }
const MAPLIBRE_STYLE_ORIGIN = 'https://tiles.openfreemap.org'   // useMapInstance.js OPENFREEMAP_STYLE/_DARK

/**
 * Which engine a map leaf will use, decided at BUILD time from the same inputs the runtime ladder reads
 * (see mapPageHtml's token block): profile-config.provider, then whether a token is derivable now — a
 * baked token, or a token endpoint (tokenUrl / window.MAP_TOKEN_URL). 'auto' with no token path is
 * MapLibre, keyless. The runtime can still be overridden by ?tk=/?provider=/window.MAP_PROVIDER/a stored
 * token; the hint follows the build default and the report names that miss case (one unused preconnect).
 */
function engineFor({ config }) {
  // CORRECTED 2026-09-29 (the shipping resolver was executed, and a network trace confirmed it on the wire):
  // a token no longer selects Mapbox. useMapProvider's default is MapLibre unless provider is EXPLICITLY
  // 'mapbox'. A browser check measured all 8 auto leaves — which DO carry a pray.doxa.life token endpoint — loading
  // MapLibre from jsdelivr cold. So the hint's engine is Mapbox ONLY when provider:'mapbox' is set; every
  // other case (auto, or provider:'maplibre') is MapLibre, regardless of any baked token / tokenUrl.
  return String((config && config.provider) || '').toLowerCase().trim() === 'mapbox' ? 'mapbox' : 'maplibre'
}

/**
 * Engine-aware resource hints for a map leaf's <head>. preconnect the token-implied engine origin, the
 * style host and the data origin; and, ONLY for the 'auto' leaf (which emits no engine <script> today),
 * preload the engine from cdn.js so it downloads alongside the bundle instead of after it. The 'maplibre'
 * and 'mapbox' branches already carry a static engine tag (mapPageHtml's peerBlock / the embed snippet),
 * so a preload there would double-fetch — those get preconnects only. Returns '' for a non-map leaf.
 */
function resourceHints({ isMapLibre, config, apiBaseUrl }) {
  const engine = engineFor({ config })
  const styleOrigin = engine === 'maplibre' ? MAPLIBRE_STYLE_ORIGIN : ENGINE_ORIGIN.mapbox
  const dataOrigin = ORIGIN(apiBaseUrl)   // '' when same-origin (no build apiBaseUrl): nothing to preconnect
  const origins = [...new Set([ENGINE_ORIGIN[engine], styleOrigin, dataOrigin].filter(Boolean))]
  const lines = origins.map((o) => `  <link rel="preconnect" href="${o}" crossorigin />`)
  // Preload the engine UNLESS the leaf already emits a static engine <script>. Only a provider:'maplibre'
  // leaf does (peerBlock); the 'auto' leaf and a provider:'mapbox' leaf emit no static tag (the Mapbox
  // static tags were removed 2026-09-25), so both benefit from a preload. URL+integrity+crossorigin from
  // cdn.js so it matches ensureEngineScript's tag exactly (a mismatched preload is not reused).
  if (!isMapLibre) {
    const gl = engine === 'maplibre' ? CDN.maplibreGlJs : CDN.mapboxGlJs
    lines.push(`  <link rel="preload" as="script" href="${gl.url}" integrity="${gl.integrity}" crossorigin="anonymous" />`)
  }
  return lines.length ? `  <!-- A9 hints: the map's origins, so DNS/TLS + the engine start with the bundle, not after it (engine = provider or the MapLibre default). -->\n${lines.join('\n')}\n` : ''
}

// Does this BUILT bundle .js reference a map engine? Read from public/<tree>/<bundle>/<bundle>.js with the
// same regex the source classifier uses — the directly verifiable A9-leaf-hint signal.
function oneBundleLoadsEngine(bundleName) {
  try { return MAP_ENGINE_RE.test(readFileSync(join(DEFAULT_ROOT, bundleName, `${bundleName}.js`), 'utf8')) }
  catch { return false }
}
// Element tag → owning bundle, built once from the scanned bundles so a composes entry that names a
// child by its ELEMENT tag (stack-demo composes "research-dashboard-map", whose bundle is
// "research-dashboard") resolves to the right bundle, not a non-existent dir.
let ELEMENT_TO_BUNDLE = null
function setElementToBundle(bundles) {
  ELEMENT_TO_BUNDLE = new Map()
  for (const b of bundles) for (const e of (b.elements || [])) ELEMENT_TO_BUNDLE.set(e, b.bundle)
}
// Does a leaf's PAGE end up loading an engine? True if its own bundle does, OR any bundle it `composes`
// does — the latter catches a composite whose engine lives in a lazily-fetched child (research-map-plus-grid
// composes doxa-research-map: its own bundle has 0 engine refs, the child's has 74). A `composes` entry is
// "<bundle>/<profile>", a bare bundle, or an element TAG — resolved to a bundle via ELEMENT_TO_BUNDLE, then
// the bundle's first segment. Verifiable from built files, so the gate can mirror it. Excludes a composite
// that composes only non-maps (big-picture).
function builtBundleLoadsEngine(bundleName, composes) {
  if (oneBundleLoadsEngine(bundleName)) return true
  for (const c of composes || []) {
    const tag = String(c).split('/').pop()
    const child = (ELEMENT_TO_BUNDLE && ELEMENT_TO_BUNDLE.get(tag)) || String(c).split('/')[0]
    if (child && child !== bundleName && oneBundleLoadsEngine(child)) return true
  }
  return false
}

function mapPageHtml(opts) {
  const { title, tag, config, jsSrc, apiBaseUrl, tokenUrlExpr, bakedToken, integrity, shellTokenFree, isMap, scrollPage, isComposite, bundleLoadsEngine } = opts
  const apiScript = apiBaseUrl
    ? `\n  <script>window.MAP_APP_API_URL = ${JSON.stringify(apiBaseUrl)};</script>`
    : ''
  // Bake the QA corner widget onto the host platform's embed surface (opt-out via build-config qaWidget:false).
  // urlOwner 'app' (library/composables/useViewAddress.js): this generated page is OURS, so its shell may write the
  // view address (?tab=…) for a reload and a sent link. Only the page's own config gets it, never an embed snippet
  // (embedCfg), so a partner's page is never written to; and a FRAMED page drops it at runtime (below).
  const pageConfig = { ...(DEST_CONFIG.qaWidget ? { ...config, qa: true } : config), urlOwner: 'app' }
  // PROVIDER-AWARE PAGE (see library/composables/useMapProvider.js): a profile or
  // instance whose config says provider:'maplibre' gets the MapLibre peer (token-
  // free, no Mapbox account) and SKIPS the token ladder entirely — the map mounts
  // immediately. Default stays Mapbox, byte-for-byte unchanged.
  const isMapLibre = !!(config && config.provider === 'maplibre')
  // DOES THIS LEAF ACTUALLY DRAW A MAP? (isMap, computed per-profile at scan time — a
  // leaf whose .vue references a map engine: useMapInstance/useMapProvider, mapbox-gl,
  // maplibre-gl, or window.mapboxgl/maplibregl. See scanBundles → isMapLeaf.)
  // A leaf that is NOT a map (a grid, a card, a chart table, a data list) must render
  // TOKEN-FREE and load NO map peer at all — otherwise a tokenless load hits the token
  // ladder, fetch-fails on the token endpoint (e.g. CORS on doxa.life/api/maps/token)
  // and NEVER creates the element: the styled #slot stays empty, so maps/dashboards look
  // broken to a first-time viewer. This is the CORRECT signal that supersedes the legacy
  // provider:'maplibre' hack authors used to force non-maps token-free (people-groups-grid,
  // doxa-vision-card, big-picture). `isMap` defaults to true when unspecified so any
  // caller that has not yet computed it keeps the original map-gated behaviour.
  const drawsMap = isMap === undefined ? true : !!isMap
  const notAMap = !drawsMap
  // SHELL PAGES ARE TOKEN-FREE. A cap-5 app-shell (nested-mfe-spa, e.g. <plugin-studio>) is
  // NOT a map — it is chrome that nests OTHER elements. Its nested MAP elements each render in
  // their own iframe leaf page, which runs its OWN token ladder. So the shell page itself must
  // NOT gate element creation on a Mapbox token: without this, a tokenless load fetch-fails on
  // the token endpoint (e.g. CORS on doxa.life/api/maps/token) and NEVER creates the element —
  // the styled ladder never appears. Token-free ⇒ mount immediately + load NO Mapbox peer.
  // shellOnly WINS over provider: a cap-5 app-shell paints no map itself, so it needs no peer
  // AT ALL — even if an instance carries provider:'maplibre' (a legacy way authors forced
  // token-free before shellTokenFree existed). Correct signal = the composition tier, not a
  // map provider that happens to be set on the shell's config. `notAMap` generalises this to
  // EVERY non-map leaf (cap-4 composites + cap-1/2/3 non-map leaves), not just cap-5 shells.
  const shellOnly = !!shellTokenFree || notAMap
  const tokenFree = isMapLibre || shellOnly
  // A9 leaf hints: give the browser the map's origins BEFORE the bundle
  // parses. Engine-aware, derived from the SAME inputs the runtime ladder reads (below), never
  // hardcoded: preconnect the token-implied engine + the style host + the data origin, and — only
  // where the leaf emits no engine <script> today (the 'auto' leaf) — preload the engine, its URL,
  // integrity and crossorigin from library/constants/cdn.js so it cannot drift from the runtime tag.
  // WHO GETS HINTS: any page whose OWN bundle loads a map engine — the directly verifiable signal
  // (`bundleLoadsEngine`, an engine reference in the built .js), NOT the leaf's `isMap` flag. A network
  // run found regions-mfe (isMap:false, 56 engine refs in its bundle) AND research-map-plus-grid
  // (isMap:false, own bundle 0 refs but composes doxa-research-map, 74 refs) opening cdn.jsdelivr.net +
  // tiles.openfreemap.org from the top page and getting no hints — my first cut keyed on isMap and missed
  // both, the same trap check:leaf-engine-per-provider's isMap gate fell into. bundleLoadsEngine is true
  // when the leaf's own bundle OR any bundle it composes loads an engine, so both composites are covered;
  // a composite that composes only non-maps (big-picture) stays out. A cap-5 nested-mfe-spa shell
  // (shellTokenFree) is excluded even if it references an engine: its maps render in their OWN iframe
  // leaves, which carry hints. A plain non-map leaf (a list/card) can SHARE a bundle with a map leaf
  // (connectivity-list rides the cities-internet bundle) — so the `isComposite &&` guard keeps the bundle
  // signal from over-hinting it: the engine only mounts in-page for a real map leaf (drawsMap) or a cap-4
  // composite (isComposite) that stacks a map child; a non-map, non-composite leaf never opens it.
  const drawsMapInPage = (drawsMap || (isComposite && bundleLoadsEngine)) && !shellTokenFree
  const hintBlock = drawsMapInPage ? resourceHints({ isMapLibre, config, apiBaseUrl }) : ''
  const peerBlock = shellOnly
    ? `<!-- NON-MAP leaf (app-shell / composite / grid / card / chart-table): NO map peer.
       This element draws no map tiles, so it needs no Mapbox/MapLibre engine and MUST NOT
       gate on a token. Any nested MAP (in a composite/shell) renders in its own iframe leaf,
       which loads its own map peer + token. A peer here would be dead weight + imply a gate. -->`
    : isMapLibre
    ? `<!-- MapLibre peer (token-free engine) loaded ONCE here; the custom element
       uses window.maplibregl directly (same versions as @map/composables/useMapInstance). -->
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
  <link href="${CDN.maplibreGlCss.url}" rel="stylesheet" integrity="${CDN.maplibreGlCss.integrity}" crossorigin="anonymous" />
  <script src="${CDN.maplibreGlJs.url}" integrity="${CDN.maplibreGlJs.integrity}" crossorigin="anonymous"></script>`
    : `<!-- NO STATIC ENGINE TAGS (2026-09-25). This leaf used to hard-link mapbox-gl.css, the
       geocoder css, mapbox-gl.js and the geocoder js from Mapbox's CDN, chosen at BUILD time —
       so a partner embedding it with ?provider=maplibre still sent every visitor's IP to Mapbox
       (4 requests per leaf, measured). The provider is chosen at RUNTIME (profile-config.provider
       → ?provider= → window.MAP_PROVIDER → auto), and the element's own runtime loaders load
       exactly that engine: ensureEngineScript / ensureEngineCSS (useMapInstance) and the
       geocoder's on-demand loader — the path composite leaves already run on. Gate:
       check:leaf-engine-per-provider (0 Mapbox requests under maplibre; Mapbox unchanged). -->`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- THIS PAGE IS OURS. The only thing that knows a document belongs to the plugin is the page
       the generator writes, so it says so here. library/i18n reads it before reflecting an RTL
       locale on <html dir>; nothing else sets it, so a PARTNER page defaults to "not ours" and
       is never touched. Absence must mean restraint — an embedded plugin flipping a partner's
       whole <html> because a reader followed a ?lang=ar link is the bug this prevents. -->
  <script>window.MAP_OWNS_PAGE = true;</script>
  <title>${esc(title)}</title>
  <link rel="icon" href="data:,">
${hintBlock}  ${peerBlock}
  <style>
    ${scrollPage
    ? `/* SCROLL-PAGE leaf (cap-4 nested-elements-mfe composite: a StackLayout scroll-stack). The DOCUMENT
       owns the scroll — the element takes its content's NATURAL height and grows the page, so a reader
       scrolls PAST one stacked section down to the next (BUG-DASHBOARD-CANT-SCROLL-DOWN). This is the
       OPPOSITE of the fixed-viewport map/single-element leaf below: NO position:fixed, NO inset:0,
       height:auto so the page can grow. See StackLayout.vue's "THE LAYOUT OWNS THE SCROLL" contract. */
    html { height: 100%; }
    html, body { margin: 0; background: #0a0e15; }
    body { min-height: 100%; overflow-y: auto; }
    /* MIN-HEIGHT IN VIEWPORT UNITS, NOT PERCENT (BUG-UPG100-NESTED-ELEMENTS-ZERO-HEIGHT).
       min-height:100% here resolved against BODY's computed height, which is auto (body only has
       min-height:100%, never a definite height) — and a percentage of auto collapses to 0. Any
       element whose own chrome is position:absolute / height:100% (upg-100-mfe -> .pane-col -> .pane)
       then measured 0 and the leaf looked empty. A viewport unit depends on NO ancestor and keeps the page
       growable (it is a MIN). svh, not dvh: dvh follows the mobile URL bar, so the slot (and its map)
       resized while the reader scrolled; svh never moves. 100vh first for a browser without svh. */
    #slot, ${esc(tag)} { position: static; inset: auto; width: 100%; min-height: 100vh; min-height: 100svh; display: block; }
    #status { position: fixed; inset: 0; z-index: 2; display: grid; place-items: center;
      padding: 24px; text-align: center; color: #9aa7b8;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
    #status.err { color: #f87171; }`
    : `/* BARE full-page map — no chrome. The custom element IS the page, so the
       browser URL shares the map itself.
       HEIGHT IN svh, NOT inset:0. A fixed box with inset:0 follows the phone's DYNAMIC viewport, so the map
       (and a legend sheet sized from it) changes height every time the address bar hides or shows. 100svh is
       the viewport WITH the bar shown and never changes; when the bar hides, the page background shows below
       instead of the map resizing. On a desktop svh = the viewport, so nothing moves there. The 100% before it
       is the fallback for a browser without svh, which would otherwise size the box to its content.
       --profile-min-h:0 opts out of ProfileLoader's 100dvh floor, which would grow the element again. */
    html, body { height: 100%; margin: 0; background: #0a0e15; }
    #slot, ${esc(tag)} { position: fixed; inset: 0 auto auto 0; width: 100%; height: 100%; height: 100svh; --profile-min-h: 0; display: block; }
    #status { position: fixed; inset: 0; z-index: 2; display: grid; place-items: center;
      padding: 24px; text-align: center; color: #9aa7b8;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
    #status.err { color: #f87171; }`}

    /* ── PRINT, BOTH LEAF SHAPES ────────────────────────────────────────────────────────────
       Two things every generated leaf got wrong on paper, because no generated page has ever
       carried an @media print rule (measured: 0 across the tree).

       The background is #0a0e15 — a dark page, printed. Browsers drop background colours by
       default, but a reader who ticks "Background graphics" to get the MAP also gets the page
       flooded black, and that is the reader who most wants the printout.

       #status is the LOADING OVERLAY: position:fixed, inset:0, over everything. On paper it is
       a full sheet reading "loading…" above the content that did in fact load. It is hidden
       only while it is NOT an error — an error still prints, because a blank sheet with the
       explanation suppressed is worse than a sheet that says what went wrong. */
    @media print {
      html, body { height: auto; background: #fff; }
      #status:not(.err) { display: none; }
      /* ★ RELEASE THE FIXED HOST, MEASURED (a print check on a035408e2). The leaf pins both the
         slot and the element with position:fixed; inset:0. A fixed element is painted once, on the
         first page, so the printed document was exactly ONE viewport: 900px tall, while the content
         continued to y=1753. Every plugin whose leaf is taller than a screen has been printing its
         top screenful and silently dropping the rest — the dashboard printed its stats and its map,
         then blank to the bottom of the sheet.
         min-height, not a released height alone: a full-bleed map leaf takes its SIZE from this rule,
         so height:auto with nothing else can leave the element a zero-height box and print an empty
         page — a worse failure than the one being fixed, and the discriminator is not isMap
         (region-dashboards is isMap:true and is a scrolling dashboard). The floor keeps a definite
         box for the map case while letting a taller document grow onto page two. */
      #slot, ${esc(tag)} { position: static; inset: auto; width: 100%; height: auto; min-height: 14cm; }
    }
  </style>
</head>
<body>
  <div id="slot"></div>
  <div id="status">${tokenFree ? 'loading…' : 'loading token…'}</div>
${apiScript}
  <!-- Bundle IIFE — registers the <${esc(tag)}> custom element. -->
  <script src="${esc(jsSrc)}"${integrity ? ` integrity="${esc(integrity)}" crossorigin="anonymous"` : ''}></script>

  <script>
    // Mapbox token resolution — the A3 ladder, in precedence order:
    //   1. prop            — a token hardcoded into this page's profile-config (config.tk)
    //   2. ?tk= URL param  — token carried in the shared link
    //   3. baked token     — opt-in literal token inlined at build time (build-config.token)
    //   A token from rungs 1-3 is used DIRECTLY (no network). Otherwise a token
    //   *endpoint* is resolved and fetched:
    //   4. window.MAP_TOKEN_URL override  5. configured TOKEN_SRC URL  6. same-origin /api/maps/token
    // TOKEN_SRC is treated as DATA, never eval'd: the literal "window.MAP_TOKEN_URL"
    // means "read that global"; anything else is used as a URL — so both a global
    // name and a plain URL are safe (no SyntaxError footgun).
    (function () {
      var slot = document.getElementById('slot');
      var status = document.getElementById('status');
      var BASE_CONFIG = ${JSON.stringify(pageConfig)};
      // Framed (the iframe embed on a partner's page): READ the address, never write it. A push inside a frame adds
      // entries to the partner page's own Back button (the joint session history).
      try { if (window.self !== window.top) delete BASE_CONFIG.urlOwner } catch (e) { delete BASE_CONFIG.urlOwner }
      // MapLibre map pages AND shell pages (app-shell / nested-mfe-spa) need NO token:
      // the ladder below is skipped entirely and the element mounts immediately.
      // (A leaf whose engine is MapLibre at RUNTIME joins them — see PROVIDER below.)
      var TOKEN_FREE = ${JSON.stringify(tokenFree)};
      // A token-free COMPOSITE still nests plugins, and a nested Mapbox map reads window.MAP_TOKEN
      // rather than this page's profile-config. With no baked token (the public copy), it must get
      // one from ?tk= or a pasted token, or be asked for one — see the rungs below.
      var NESTS_MAPS = ${JSON.stringify(!!isComposite && !isMapLibre)};
      var TOKEN_SRC = ${JSON.stringify(tokenUrlExpr)};
      var BAKED_TOKEN = ${JSON.stringify(bakedToken || '')};
      // Expose the baked token as window.MAP_TOKEN so a BAKED composite (a compiled element that mounts
      // a map component directly, with no ProfileLoader/profile-config wrapper) still finds a token —
      // useMapInstance falls back to window.MAP_TOKEN. No effect when BAKED_TOKEN is empty.
      // A token the HOST set before this page ran outranks the baked one (measured: it used to lose).
      var HOST_TOKEN = (typeof window.MAP_TOKEN === 'string' && window.MAP_TOKEN) || '';
      if (BAKED_TOKEN && typeof window !== 'undefined' && !window.MAP_TOKEN) { window.MAP_TOKEN = BAKED_TOKEN; }
      var DEFAULT_TOKEN_URL = '/api/maps/token';

      function fail(msg) { if (status) { status.className = 'err'; status.textContent = '⚠ ' + msg; } }
      // No token anywhere on the ladder → ask ONCE, store locally, remount. No dead ends.
      function askToken() {
        if (!status) return;
        status.className = 'err';
        status.innerHTML = 'map needs a Mapbox token — ' +
          '<input id="tkIn" type="password" placeholder="paste pk.… (stays in this browser)" ' +
          'style="font:12px ui-monospace,monospace;padding:6px 8px;border-radius:6px;border:1px solid #223047;background:#0e1623;color:#eef2f7;width:min(320px,70vw)"> ' +
          '<button id="tkGo" style="font:700 11px ui-monospace,monospace;padding:7px 12px;border-radius:999px;border:0;cursor:pointer;background:linear-gradient(90deg,#46d4ff,#b9a6f5);color:#0a0e15">use it</button>';
        var go = document.getElementById('tkGo');
        if (go) go.addEventListener('click', function () {
          var v = (document.getElementById('tkIn').value || '').trim();
          if (!v) return;
          try { localStorage.setItem('MAPS_STAGING_TK', v); } catch (e) {}
          mount(v);
        });
      }
      /* ★ RELEASE THE LOAD BACKDROP WHEN THE ELEMENT MOUNTS (BUG-GOSPEL-MAP-BLACK-RECTANGLE).
         html/body carry background:#0a0e15 so the light #status text (#9aa7b8) is readable while the
         bundle loads. That backdrop is LOAD-STATE CHROME, but it outlived its moment: any gap the
         mounted element does not cover shows it through, because every layer above body is
         transparent. On gospel-resources/resources-map that produced a 352x126 DARK RECTANGLE between
         the legend card and the detail panel — MEASURED rgb(8,12,18), i.e. the page background, NOT an
         unpainted canvas as first supposed. Clearing it here (the one place we already know the
         element is up) is a one-shot style write — no resize, no repaint loop. Keep it a one-shot
         write: do NOT turn this into a per-frame or per-event handler (a resize loop strobes the screen). */
      function done() {
        if (status && status.parentNode) { status.parentNode.removeChild(status); }
        document.documentElement.style.background = '#f3f3f1';
        document.body.style.background = '#f3f3f1';
      }

      function mount(token) {
        if (!token && !TOKEN_FREE) { return askToken(); }
        // Nested maps (a composite's children) read window.MAP_TOKEN, not this element's config.
        if (token && typeof window !== 'undefined' && !window.MAP_TOKEN) { window.MAP_TOKEN = token; }
        try {
          var cfg = token ? Object.assign({}, BASE_CONFIG, { tk: token }) : BASE_CONFIG;
          var el = document.createElement(${JSON.stringify(tag)});
          el.setAttribute('profile-config', JSON.stringify(cfg));
          slot.innerHTML = '';
          slot.appendChild(el);
          done();
        } catch (e) { fail(e && e.message ? e.message : String(e)); }
      }

      function qp(name) {
        try { return new URLSearchParams(location.search).get(name) || ''; }
        catch (e) { return ''; }
      }

      function extractToken(data) {
        if (typeof data === 'string') return data.trim();
        if (data && typeof data === 'object') return data.token || data.tk || data.accessToken || '';
        return '';
      }

      // Rungs 1-3b: an actual token → mount directly, no fetch.
      // 2b = localStorage: the paste-once store shared with the staging pages
      // (MAPS_STAGING_TK) — paste a token ONCE anywhere in the tree, every page uses it.
      var stored = '';
      try { stored = localStorage.getItem('MAPS_STAGING_TK') || ''; } catch (e) {}
      var urlTk = qp('tk');
      if (urlTk) { try { localStorage.setItem('MAPS_STAGING_TK', urlTk); } catch (e) {} }
      var directToken = (BASE_CONFIG && BASE_CONFIG.tk) || urlTk || stored || HOST_TOKEN || BAKED_TOKEN;
      // PROVIDER — the same ladder as resolveMapProvider (library/composables/useMapProvider.js):
      // profile-config.provider → ?provider= → window.MAP_PROVIDER → 'auto'. An explicit engine wins,
      // and 'auto' draws with MapLibre whether or not a token is available (the element decides that).
      // This page only decides whether to FIND a token first: when one is on offer (a rung above, a
      // host-set window.MAP_TOKEN, or a token endpoint) it resolves it, since place search uses it on
      // either engine; with none, it mounts at once, keyless: no token prompt, no request to Mapbox.
      var ASKED = String((BASE_CONFIG && BASE_CONFIG.provider) || qp('provider') || window.MAP_PROVIDER || '').toLowerCase().trim();
      var EXPLICIT = (ASKED === 'mapbox' || ASKED === 'maplibre') ? ASKED : '';
      var HAS_TOKEN = !!(directToken || (typeof window.MAP_TOKEN === 'string' && window.MAP_TOKEN));
      var HAS_ENDPOINT = !!(window.MAP_TOKEN_URL || (TOKEN_SRC && TOKEN_SRC !== 'window.MAP_TOKEN_URL'));
      if (EXPLICIT === 'maplibre' || (!EXPLICIT && !HAS_TOKEN && !HAS_ENDPOINT)) { TOKEN_FREE = true; }
      if (TOKEN_FREE) {
        if (directToken && typeof window !== 'undefined' && !window.MAP_TOKEN) { window.MAP_TOKEN = directToken; }
        mount('');
        // A token-free composite with no token anywhere: its content renders, but its nested maps
        // cannot. Ask once; the token is stored for the whole tree and the page reloads with it.
        // Only when Mapbox was ASKED for: under 'auto' the nested maps draw with MapLibre instead.
        if (NESTS_MAPS && !directToken && EXPLICIT === 'mapbox') {
          var bar = document.createElement('div');
          bar.id = 'status';
          bar.setAttribute('style', 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;padding:10px 12px;border-radius:10px;background:#0e1623;color:#eef2f7;font:13px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)');
          document.body.appendChild(bar);
          status = bar;
          askToken();
          var goBtn = document.getElementById('tkGo');
          if (goBtn) goBtn.addEventListener('click', function () {
            var v = (document.getElementById('tkIn').value || '').trim();
            if (v) { location.reload(); }
          });
        }
        return;
      }
      if (directToken) { return mount(directToken); }

      // Rungs 4-6: resolve the token ENDPOINT candidates and try them IN ORDER — the first
      // one that answers with a token wins. Order: window.MAP_TOKEN_URL override → the
      // configured TOKEN_SRC (an ABSOLUTE url, so a tree hosted on a CDN away from the API
      // still finds it) → same-origin /api/maps/token (dev, or the site hosting both).
      // A single hard-coded pick used to kill the page when its one url 404'd or was
      // blocked by CORS; a shared link must work wherever the tree is hosted.
      var candidates = [];
      function addCandidate(u) { if (u && candidates.indexOf(u) === -1) candidates.push(u); }
      addCandidate(window.MAP_TOKEN_URL);
      addCandidate(TOKEN_SRC && TOKEN_SRC !== 'window.MAP_TOKEN_URL' ? TOKEN_SRC : '');
      addCandidate(DEFAULT_TOKEN_URL);

      function fetchToken(i, errors) {
        if (i >= candidates.length) {
          // Every endpoint failed. Under 'auto' that means no token: draw with MapLibre, keyless.
          if (!EXPLICIT) { TOKEN_FREE = true; return mount(''); }
          // Mapbox was asked for: say which endpoints failed, and still offer the paste-once box.
          askToken();
          if (status) {
            var d = document.createElement('div');
            d.textContent = '⚠ Token fetch failed from ' + candidates.join(', ') + ' — set window.MAP_TOKEN_URL or pass ?tk=. (' + errors.join(' | ') + ')';
            status.insertBefore(d, status.firstChild);
          }
          return;
        }
        var url = candidates[i];
        return fetch(url)
          .then(function (r) {
            if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
            var ct = r.headers.get('content-type') || '';
            return ct.indexOf('json') !== -1 ? r.json() : r.text();
          })
          .then(function (data) {
            var tk = extractToken(data);
            if (!tk) throw new Error(url + ' → no token in response');
            mount(tk);
          })
          .catch(function (e) {
            errors.push(e && e.message ? e.message : String(e));
            return fetchToken(i + 1, errors);
          });
      }
      fetchToken(0, []);
    })();
  </script>
</body>
</html>
`
}

/**
 * Standalone profile page — the base parameterized profile (no preset props).
 * Lives at <bundle>/<profile>/index.html → bundle IIFE is one level up (../).
 */
function profileHtml(b, profile, tokenUrlExpr, bakedToken) {
  const tag = b.elements[0] || b.bundle
  return mapPageHtml({
    title: `${profile.profile} · ${b.bundle}`,
    tag,
    // Profile-declared keys first, so the generator-owned ones always win (they are
    // also filtered as reserved at read time — belt and braces, since a leaf whose
    // `profile` or `assetsBase` got overwritten would silently render the wrong thing).
    config: { ...(profile.extraConfig || {}), ...mobileConfig(profile), profile: profile.profile, dataSource: 'pray-tools', instanceId: `${b.bundle}-${profile.profile}`, assetsBase: assetsBaseFor(3) },
    jsSrc: `../${b.bundle}.js`,
    apiBaseUrl: DEST_CONFIG.apiBaseUrl,
    tokenUrlExpr,
    bakedToken,
    integrity: b.integrity,
    // A cap-5 app-shell (nested-mfe-spa) is chrome, not a map → token-free (see mapPageHtml).
    shellTokenFree: profile.type === 'nested-mfe-spa',
    isComposite: profile.type === 'nested-elements-mfe',
    // Whether this leaf actually draws map tiles (computed in scanBundles → isMapLeaf). A
    // non-map leaf renders token-free with no map peer; only a real map runs the token ladder.
    isMap: profile.isMap,
    // Whether this bundle's OWN built .js loads a map engine — the A9-leaf-hint signal (mapPageHtml).
    bundleLoadsEngine: builtBundleLoadsEngine(b.bundle, b.composes),
    // A cap-4 composite (nested-elements-mfe) is a StackLayout SCROLL-STACK: its leaf must let the
    // DOCUMENT own the scroll (height:auto, no position:fixed) so the page grows and a reader scrolls
    // PAST one section to the next. A fixed-viewport leaf traps a 100vh dashboard and nothing scrolls
    // (BUG-DASHBOARD-CANT-SCROLL-DOWN). Cap-5 (nested-mfe-spa) stays fixed — it is a tabs shell, not a
    // scroll-stack; any scroll-stack it hosts is its OWN iframe leaf, which gets this flag itself.
    scrollPage: profile.type === 'nested-elements-mfe',
  })
}

/**
 * Preconfigured-instance page — one preset render of a parameterized profile.
 * Lives at <bundle>/<profile>/<instance>/index.html → bundle IIFE is two levels up
 * (../../). The instance's preset props + apiBaseUrl are baked in.
 */
function instanceHtml(b, profile, inst, tokenUrlExpr, bakedToken) {
  const tag = inst.element || b.elements[0] || b.bundle
  return mapPageHtml({
    title: `${inst.title} · ${b.bundle}`,
    tag,
    // MERGE, never replace (a preset once lost its profile's pinHint:false): the profile's
    // <profile>.meta.json `config` first, then the instance's props over it. The rule is stated in
    // documentation/PRESET-PLUGIN-STANDARD.md and asserted by check:preset-config-merge.
    config: { assetsBase: assetsBaseFor(4), ...(profile.extraConfig || {}), ...mobileConfig(profile), ...inst.props },
    jsSrc: `../../${b.bundle}.js`,
    apiBaseUrl: inst.apiBaseUrl || DEST_CONFIG.apiBaseUrl,
    tokenUrlExpr,
    bakedToken,
    integrity: b.integrity,
    // Instance pages inherit the profile's shell-ness (an app-shell preset is still token-free).
    shellTokenFree: profile.type === 'nested-mfe-spa',
    isComposite: profile.type === 'nested-elements-mfe',
    // Instance pages inherit the profile's map-ness: a preset of a non-map leaf is still a
    // non-map (token-free, no peer); a preset of a real map still runs the token ladder.
    isMap: profile.isMap,
    // Same bundle as the profile page, so the same engine signal (A9-leaf-hint, mapPageHtml).
    bundleLoadsEngine: builtBundleLoadsEngine(b.bundle, b.composes),
    // A preset of a cap-4 composite scroll-stack is still a scroll page (see profileHtml).
    scrollPage: profile.type === 'nested-elements-mfe',
  })
}

/**
 * Read preconfigured instances declared in a `*.instances.json` next to a profile's
 * .vue. Returns [] when absent. Each instance becomes a nested standalone page. The
 * file shape: { profile, apiBaseUrl?, instances: [{ id, title?, props }] } where
 * `props` are merged into the profile-config (minus tk, which is fetched at runtime).
 */
function readInstances(dir, profileName, bundle, tag) {
  // Accept either <profileName>.instances.json or any *.instances.json in the folder.
  let file = join(dir, `${profileName}.instances.json`)
  if (!existsSync(file)) {
    const alt = readdirSync(dir).find((f) => f.endsWith('.instances.json'))
    if (!alt) return []
    file = join(dir, alt)
  }
  let cfg
  try {
    cfg = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`[generate-tree] bad instances json ${file}: ${e.message}`)
    return []
  }
  const apiBaseUrl = typeof cfg.apiBaseUrl === 'string' ? cfg.apiBaseUrl : ''
  const list = Array.isArray(cfg.instances) ? cfg.instances : []
  return list
    .filter((i) => i && typeof i.id === 'string' && i.id.trim())
    .map((i) => {
      const id = i.id.trim()
      const iframeUrl = `${EMBED_BASE}/${bundle}/${profileName}/${id}/index.html`
      const iframeEmbed =
        `<iframe src="${iframeUrl}?utm_source=YOUR_SOURCE" width="100%" height="600" ` +
        `style="border:none;border-radius:12px;" allowfullscreen></iframe>`
      return {
        id,
        title: typeof i.title === 'string' ? i.title : id,
        apiBaseUrl,
        // profile-config props (tk added at runtime); profile name always included.
        props: { profile: profileName, ...(i.props && typeof i.props === 'object' ? i.props : {}) },
        element: tag,
        iframeUrl,
        embed: { iframe: iframeEmbed },
        // A preset that OPENS on a lens with no GL map (upg-neighbor's flower-mesh is SVG) is still a
        // map element: its view-switcher reaches the map lenses, so it keeps isMap (engine, token
        // ladder). This tells the draw gates not to expect a canvas on first paint. Absent = true.
        ...(i.opensOnMap === false ? { opensOnMap: false } : {}),
      }
    })
}

// ── Scan plugin-designs → bundle records ───────────────────────────────────────
function scanBundles() {
  if (!existsSync(APP_PROFILES)) {
    console.error(`[generate-tree] no plugin-designs/ at ${APP_PROFILES}`)
    process.exit(1)
  }
  const PROTOTYPE_RE = /template|example|starter|sample|demo|clone/i
  const bundles = []
  // <profile>.meta.json `visibility` values this generator does not recognise. Collected across the
  // whole scan and reported together below, so an author fixing three typos sees three, not one.
  const visibilityErrors = []
  for (const entry of readdirSync(APP_PROFILES).sort()) {
    const dir = join(APP_PROFILES, entry)
    if (!isBundleDir(entry) || !statSync(dir).isDirectory()) continue
    // Not a web plugin (plugin-targets.mjs: targets without "web", e.g. Rudder): no leaf pages, no manifest
    // entry. desktop:build packages it.
    if (!isWebBuilt(dir)) continue

    const vueFiles = readdirSync(dir).filter((f) => f.endsWith('.vue')).sort()
    if (vueFiles.length === 0) continue

    // The custom-element tag this bundle registers (first one). Used in the
    // <script>-style embed snippet below.
    const bundleElements = extractElements(join(dir, 'index.js'))
    const tag = bundleElements[0] || entry

    // SUBRESOURCE INTEGRITY (sha384) of the built bundle IIFE. Vite has already
    // emitted it to DEFAULT_ROOT by the time generate-tree runs, so we can hash it
    // HERE and thread the value into every <script> tag we generate (standalone
    // pages + copy-paste embed snippets). A tampered / CDN-swapped bundle then fails
    // the browser's integrity check and is REFUSED. crossorigin="anonymous" is
    // required for the check to run on cross-origin (CDN) loads. Missing .js → null
    // → tags omit integrity (graceful, e.g. `bun run tree` before a build).
    let integrity = null
    try {
      integrity = 'sha384-' + createHash('sha384').update(
        readFileSync(join(DEFAULT_ROOT, entry, entry + '.js'))
      ).digest('base64')
    } catch { integrity = null }

    const profiles = vueFiles.map((file) => {
      const tags = extractHeaderTags(join(dir, file))
      const { description, file: fileTag, ...rest } = tags
      const profileName = file.replace(/\.vue$/, '')

      // Absolute-or-root-relative URLs so the snippets are paste-anywhere.
      // iframeUrl → the standalone profile page; scriptUrl → the bundle IIFE.
      const iframeUrl = `${EMBED_BASE}/${entry}/${profileName}/index.html`
      const scriptUrl = `${EMBED_BASE}/${entry}/${entry}.js`

      // Two ready-to-paste embed forms (mirrors ShareButton's iframe approach +
      // the direct web-component approach). profileConfig token comes from the
      // host at runtime (window.MAP_TOKEN_URL); the tk placeholder is a reminder.
      // ?utm_source teaches TRAFFIC ATTRIBUTION in every snippet (same pattern as
      // the YOUR_MAPBOX_TOKEN placeholder): the partner replaces YOUR_SOURCE and
      // every people-group click-through from their embed carries it (the popup
      // inherits the page URL's utm_source — see PeopleGroupDetail.utmSource()).
      const iframeEmbed =
        `<iframe src="${iframeUrl}?utm_source=YOUR_SOURCE" width="100%" height="600" ` +
        `style="border:none;border-radius:12px;" allowfullscreen></iframe>`
      // ★ THE SNIPPET MUST CARRY assetsBase + apiBaseUrl (BUG-EMBED-SCRIPT-SNIPPET-OMITS-…).
      // MEASURED 2026-09-20: pasting the old snippet onto a FOREIGN HOST PAGE mounted the element
      // (defined + shadow root + full height) and rendered NO MAP — two 404s, because relative asset
      // and API paths resolve against the HOST's document, not the bundle's.
      // THE ASYMMETRY, and why deploy-1 never had this problem: an IFRAME carries its OWN document
      // base, so the leaf page's relative paths resolve; a DIRECT-JS embed executes in the host's
      // document, so they do not. Same bundle, same snippet, different containing document.
      // Emit the CONFIGURED values when the build sets them (assetsBaseUrl / apiBaseUrl), otherwise a
      // PLACEHOLDER in the established style of YOUR_MAPBOX_TOKEN / YOUR_SOURCE — so the snippet stays
      // honest for a same-root drop and becomes CORRECT for a partner who fills them in.
      // ★ assetsBase goes in the PROFILE-CONFIG; the API base does NOT — it is a WINDOW GLOBAL.
      // Verified in library/api/apiBaseUrl.js: getApiBaseUrl() reads ONLY window.MAP_APP_API_URL or
      // the build-time VITE_API_BASE_URL. There is no profile-config path, so emitting an
      // `apiBaseUrl` key here would look correct and do NOTHING (measured: the data call still 404'd).
      // Same modular pattern as window.MAP_TOKEN_URL — a host-settable global, no rebuild needed.
      // ★ provider IS EMITTED EXPLICITLY, even though 'maplibre' is now the default anyway.
      // A key that merely restates the default looks redundant until you ask what the snippet is
      // FOR: it is the only thing a partner ever reads. Before this, no snippet mentioned provider
      // at all, so a host had no way to discover the choice existed — and when a token stopped
      // selecting Mapbox (2026-09-28), the hosts affected were exactly the ones who had pasted a
      // real token in here and could not see the lever that would give it back. Stating the
      // default is what makes the opt-in discoverable.
      const embedCfg = {
        profile: profileName,
        provider: 'maplibre',
        tk: 'YOUR_MAPBOX_TOKEN',
        utmSource: 'YOUR_SOURCE',
        assetsBase: DEST_CONFIG.assetsBaseUrl || 'YOUR_TREE_URL/assets',
      }
      const apiBase = DEST_CONFIG.apiBaseUrl || 'YOUR_API_BASE_URL'
      const scriptEmbedFor = (cfg, note) =>
        `<script>window.MAP_APP_API_URL=${JSON.stringify(apiBase)};<\/script>\n` +
        `<script src="${scriptUrl}"${integrity ? ` integrity="${integrity}" crossorigin="anonymous"` : ''}><\/script>\n` +
        `<!-- ${note} -->\n` +
        `<${tag} profile-config='${JSON.stringify(cfg)}'></${tag}>`
      // The notes depend on isMap, which is decided further down, so the snippets are built where the
      // embed object is (below). The Mapbox variant is the same element with "provider":"mapbox".
      const MAP_NOTE = 'MapLibre draws this map and needs no token. For Mapbox, paste this map\'s embed.scriptMapbox from manifest.json instead: it sets "provider":"mapbox" and preloads the Mapbox engine; fill "tk" with your token.'
      const PLAIN_NOTE = 'provider: "maplibre" is the default; change it to "mapbox" and fill tk to use Mapbox.'
      const MAPBOX_NOTE = 'Mapbox draws this map: fill "tk" with your Mapbox token.'

      // Preconfigured instances: ONE parameterized profile → N preset render
      // targets, declared in <something>.instances.json next to the .vue. Each
      // instance emits its own nested page (<profile>/<instance>/index.html) with
      // the preset props baked in. Distinct from tabs (many components → one el);
      // this splits one profile into many named, directly-embeddable variants.
      const instances = readInstances(dir, profileName, entry, tag)

      // Composition tier (capability machine-key), baked into the manifest so consumers group
      // by capability without a side tierMap. Explicit <profile>.meta.json {"type"} wins; else
      // an *.instances.json → parameterized; else single. (detectProfileType, same as the gallery.)
      const { type: profileType } = detectProfileType(dir, profileName, tag, [], instances.length > 0)

      // Does this page need a map ENGINE? Not "does this .vue call mapbox itself" — the
      // question the peer/token gate actually asks is "will a map be drawn IN THIS DOCUMENT".
      // The two composite tiers answer it DIFFERENTLY, and conflating them was
      // BUG-UPG100MFE-MAP-TAB-MOUNTS-NOTHING (2026-09-20):
      //
      //   cap-5 nested-mfe-spa      nests children as IFRAMES. Each child is its own leaf
      //                             PAGE with its own peer + its own token ladder, so the
      //                             shell document itself draws nothing and needs nothing.
      //                             → non-map, always.
      //
      //   cap-4 nested-elements-mfe nests children as CUSTOM ELEMENTS IN THIS SAME DOCUMENT
      //                             AND REALM (deliberately — one bundle download serves
      //                             every pane; see upg-100-mfe.vue "Why nested ELEMENTS").
      //                             There is no inner page to run a token ladder or load a
      //                             peer, so if ANY composed child paints a map, THIS page
      //                             must ship the engine and resolve a token. Marking it a
      //                             non-map emitted "NO map peer" → window.mapboxgl was
      //                             undefined → useMapInstance bailed at its
      //                             "mapboxgl is not available" guard and the map pane's
      //                             container was never created. The canvas was not hidden
      //                             or unsized; it never existed.
      //
      // So a cap-4 composite INHERITS map-ness from the siblings it composes. That is
      // derived from meta.json `composes` (and falls back to scanning the bundle's own
      // profiles), never from a per-leaf special case — the next author who composes a map
      // gets a working peer without knowing this rule exists.
      // A NON-composite profile is `|| ownsAMapDeeply(dir)` for the same reason a composite is:
      // a profile whose root .vue is a pure layout can still own a map in its own component
      // tree. research-dashboard is exactly that — zero engine refs in research-dashboard.vue,
      // a real Mapbox map in src/components/dashboards/DashboardMapPanel.vue — so the flat scan
      // alone marked its standalone leaf TOKEN_FREE and the page mounted with no token.
      //
      // The deep scan is bounded to src/ and to .vue/.js/.mjs, and it was negative-tested across
      // every bundle before being wired in: research-dashboard is the ONLY profile whose
      // classification it changes (flat=false → deep=true). Every other map bundle already
      // matched flat, and no genuinely map-free profile was flipped.
      const isMap = profileType === 'nested-mfe-spa'
        ? false
        : profileType === 'nested-elements-mfe'
          ? composesAMapLeaf(dir, profileName, file)
          : (metaIsMap(dir, profileName) ?? profileReachesAMap(dir, file))

      // An unrecognised `visibility` is collected, not coerced — see profile-meta.mjs VISIBILITY.
      const badVisibility = readProfileMeta(dir, profileName).visibilityInvalid
      if (badVisibility !== null) visibilityErrors.push(`${entry}/${profileName}: "${badVisibility}"`)

      return {
        profile: profileName,
        ...profileMetaFields(dir, profileName),   // stage / visibility / heavy / widget, shared with the dev manifest
        file,
        description: description || fileTag || '',
        element: tag,
        type: profileType,
        isMap,
        iframeUrl,
        scriptUrl,
        // ★ ENGINE PRELOAD, map snippets only (measured 2026-09-25, cold, 10 Mbps). A partner page that
        // pastes this snippet has no leaf page to fetch mapbox-gl.js, so the bundle requested it only
        // after it had downloaded, run and mounted: doxa-simple-map's engine started at 1.06 s, right
        // after its bundle (0.99 s); regions-mfe's at 2.67 s. A preload lets the ~480 KB engine download
        // alongside the bundle. It carries crossorigin + integrity because ensureEngineScript's <script> now
        // does too (library/constants/cdn.js): a preload is reused only when its request mode matches. Mapbox only: a non-map profile gets none, and a partner switching to
        // provider:"maplibre" is told to drop the line, since that engine must make zero Mapbox requests.
        // The default engine is 'auto' (Mapbox only with a token), so a partner with no token drops it too.
        embed: {
          iframe: iframeEmbed,
          // ★ THE DEFAULT SNIPPET PRELOADS THE DEFAULT ENGINE. It used to preload Mapbox, while its own
          // profile-config said provider "maplibre", and since 2026-09-28 only an explicit
          // provider:"mapbox" selects Mapbox. So an unedited paste downloaded the Mapbox engine on every
          // view, never used it, and made a Mapbox request from a keyless page. The default now preloads
          // MapLibre (script + stylesheet, pinned exactly as useMapInstance loads them, so the preloads
          // are reused), and Mapbox is its own snippet, scriptMapbox, chosen by provider. check:snippet-engine.
          script: isMap
            ? `<!-- MapLibre engine (the default), fetched early -->\n${enginePreload('maplibre')}` + scriptEmbedFor(embedCfg, MAP_NOTE)
            : scriptEmbedFor(embedCfg, PLAIN_NOTE),
          ...(isMap ? { scriptMapbox: `<!-- Mapbox engine, fetched early -->\n${enginePreload('mapbox')}` + scriptEmbedFor({ ...embedCfg, provider: 'mapbox' }, MAPBOX_NOTE) } : {}),
        },
        ...(instances.length ? { instances } : {}),
        // Extra profile-config keys from <profile>.meta.json `config` (e.g. pinHint:false).
        // GENERATOR-INTERNAL: stripped before the manifest is written (see writeManifestAndHtml)
        // so the published manifest shape is unchanged.
        extraConfig: readProfileConfig(dir, profileName),
        // Generator-internal, stripped with extraConfig at manifest assembly: the profile's OWN
        // composes. The published manifest hoists composes to the BUNDLE, which is right for its
        // consumers but useless for deriving a tier — a bundle's composite and its plain leaves would
        // all inherit the same edges. The tier is a property of the profile that declares them.
        composesOwn: readComposes(dir, profileName),
        // Generator-internal, stripped with the two above: what the snippets are built from, so the
        // composite pass below can rebuild them once every profile's isMap is known.
        _snippet: { cfg: embedCfg, build: scriptEmbedFor, mapNote: MAP_NOTE, mapboxNote: MAPBOX_NOTE },
        ...rest,
      }
    })

    // Representative-profile ordering (mirrors the app-shell SCAN): prototype-named
    // profiles sort LAST so the real production profile represents the bundle.
    profiles.sort((a, b) =>
      (PROTOTYPE_RE.test(a.profile) ? 1 : 0) - (PROTOTYPE_RE.test(b.profile) ? 1 : 0))

    // Bundle-level composition edges: the union of every profile's own <profile>.meta.json
    // `composes` (most bundles carry exactly one profile that declares it; my-upg-100-list is
    // the one bundle with several profiles, only one of which — upg-100-mfe — composes). Union,
    // not "first wins", so a future bundle with more than one composing profile still publishes
    // every edge. Read straight from vueFiles (not the `profiles` array above) so this stays the
    // ONE place `composes` is published — at the bundle level only, matching the manifest shape.
    // Omitted entirely when no profile in the bundle declares composes (no empty array).
    const bundleComposes = vueFiles.flatMap((file) => readComposes(dir, file.replace(/\.vue$/, '')) || [])
    const composesUnique = [...new Set(bundleComposes)]

    bundles.push({
      bundle: entry,
      // Absolute-or-root-relative URL to the bundle IIFE (paste-anywhere).
      scriptUrl: `${EMBED_BASE}/${entry}/${entry}.js`,
      output: `${TREE_NAME}/${entry}/${entry}.js`,
      integrity,
      elements: bundleElements,
      ...(composesUnique.length ? { composes: composesUnique } : {}),
      stage: bundleStage(profiles),
      // Only when public — absent means team (profile-meta.mjs), so today's manifests are unchanged.
      ...(bundleVisibility(profiles) === 'public' ? { visibility: 'public' } : {}),
      profiles,
    })
  }

  // ★ REFUSE AN UNKNOWN VISIBILITY. This field decides whether another team's dashboard lists the
  // plugin, and the safe default (team) is precisely why a typo must not be silent: the author has
  // written their opt-in, the manifest says private, and the plugin simply never appears anywhere —
  // a bug with no error to search for. Fail here, at the build that would have published it.
  if (visibilityErrors.length) {
    console.error('[tree] unknown `visibility` in a profile meta.json — expected ' + VISIBILITY.map((v) => `"${v}"`).join(' or ') + ':')
    for (const e of visibilityErrors) console.error(`        ${e}`)
    console.error('        Absent means "team". The generator will not guess which you meant.')
    process.exit(1)
  }
  return bundles
}

// ── Write the tree into a root, then fan out to all destinations ─────────────
function readDestinations() {
  const dests = [DEFAULT_ROOT]
  // Each entry in vite.doxa-maps-build-config.json `paths` is a folder that should CONTAIN
  // the <name>/ tree (so the full path is <entry>/<name>/).
  for (const p of DEST_CONFIG.paths) {
    dests.push(resolve(__dirname, '..', p, TREE_NAME))   // paths are relative to the BUNDLER ROOT (this script lives in internal/)
  }
  return dests
}

function writeManifestAndHtml(root, bundles, tokenUrlExpr, bakedToken) {
  setElementToBundle(bundles)   // for builtBundleLoadsEngine's tag→bundle resolution (A9 leaf hints)
  // ── DERIVE THE COMPOSITION TIER FROM THE EDGES, BEFORE ANYTHING READS THE MANIFEST ──────────
  // Every consumer downstream — the gallery's capFor, the studio rail, check:composite-embed-knobs —
  // trusts profile.type. Deriving here means a composite can no longer ship understated because its
  // author forgot a meta.json, and a stale meta can no longer disagree with the structure in silence.
  {
    const { conflicts, unresolved } = deriveComposedTiers(bundles)
    // FAILS rather than warns, now that the resolver understands all three vocabularies and the tree has
    // ZERO unresolved refs. While five were outstanding a warning was right — they turned out to be
    // correct data my resolver could not read, and failing would have blamed five authors for my gap.
    // With the count at 0, a new unresolved ref is a genuinely broken edge and silently weakens a tier.
    if (unresolved.length) {
      console.error(`[tree] ${unresolved.length} composes ref(s) resolve to nothing — a broken edge silently weakens a tier:`)
      for (const u of unresolved) console.error(`        ${u}`)
      console.error('        A ref may be "<bundle>/<profile>", a bare "<bundle>", or a registered element tag.')
      process.exit(1)
    }
    if (conflicts.length) {
      console.error('[tree] composition tier CONFLICT — a profile\'s meta.json disagrees with its own composes edges:')
      for (const c of conflicts) console.error(`        ${c}`)
      console.error('        Fix the meta.json or the composes list; the generator will not choose between them.')
      process.exit(1)
    }
  }

  // ★ A COMPOSITE THAT DRAWS ITS MAP THROUGH A CHILD GETS THE MAP SNIPPETS TOO. isMap is false on
  // research-map-plus-grid and regions-mfe, because their map is a child element, so they published no
  // engine preload and no Mapbox variant, though both draw a map and pass provider to it (pasted with
  // provider "mapbox" and a token, both draw on Mapbox: measured). Decided here, once every profile's
  // isMap exists, and from each profile's OWN composes, never the bundle's hoisted list: a bundle's
  // plain leaves (charts, data-tables, a poster wall) share that list and must stay plain. The gallery
  // shell (nested-mfe-spa) is left out until its passing of provider to its tabs is measured.
  // check:snippet-engine asserts the same rule on the written manifest.
  const isMapById = new Map()
  for (const b of bundles) for (const p of b.profiles) isMapById.set(`${b.bundle}/${p.profile}`, !!p.isMap)
  const reachesMap = (ref) => isMapById.get(ref) || [...isMapById].some(([k, v]) => v && k.startsWith(`${ref}/`))
  for (const b of bundles) for (const p of b.profiles) {
    if (p.isMap || p.type !== 'nested-elements-mfe' || !(p.composesOwn || []).some((r) => reachesMap(String(r)))) continue
    const s = p._snippet
    p.embed.script = `<!-- MapLibre engine (the default), fetched early -->\n${enginePreload('maplibre')}` + s.build(s.cfg, s.mapNote)
    p.embed.scriptMapbox = `<!-- Mapbox engine, fetched early -->\n${enginePreload('mapbox')}` + s.build({ ...s.cfg, provider: 'mapbox' }, s.mapboxNote)
  }

  const manifest = {
    schema: 'doxa-maps-manifest@1',
    generatedFrom: 'plugin-designs/*/*.vue',
    // The base URL all embed/script/iframe URLs below are built against. Set
    // embedBaseUrl in vite.doxa-maps-build-config.json to make these absolute; empty here
    // means they are root-relative (served from the site root).
    embedBase: EMBED_BASE,
    bundleCount: bundles.length,
    profileCount: bundles.reduce((n, b) => n + b.profiles.length, 0),
    // THE PAGE GLOBALS A LEAF PAGE BAKES, published for embeds that have no leaf page. A composed
    // surface (the cap-5 Research Gallery) mounted by `<script>` on a FOREIGN page runs in that
    // page's document, which carries neither window.MAP_APP_API_URL nor window.MAP_TOKEN — measured
    // 2026-09-24: 8 of 13 gallery tabs errored with the host's HTML in place of API JSON. The shell
    // reads this block as its default (a host attribute still wins). ADDITIVE: every key is optional
    // and old consumers ignore it. The token is the same opt-in public pk. every leaf already bakes.
    runtime: {
      ...(DEST_CONFIG.apiBaseUrl ? { apiBaseUrl: DEST_CONFIG.apiBaseUrl } : {}),
      ...(bakedToken ? { token: bakedToken } : {}),
    },
    // `extraConfig` is a GENERATOR-INTERNAL carrier (<profile>.meta.json `config` → the leaf
    // page's BASE_CONFIG) and is stripped here so the published manifest shape is unchanged.
    // Consumers read the manifest as a contract; a new key would be a silent schema change.
    bundles: bundles.map((b) => ({
      ...b,
      profiles: b.profiles.map(({ extraConfig, composesOwn, _snippet, ...p }) => p),
    })),
  }
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  // ★ A CORS-READABLE COPY for the Research Gallery, byte-identical, written in the SAME step so the
  // two can never diverge. The live static layer sends Access-Control-Allow-Origin on paths inside a
  // folder of the tree but not on the root manifest (measured 2026-09-25), so a partner page's
  // script embed of <doxa-maps-spa> reads this copy. See doxa-maps-spa.vue loadManifest.
  if (existsSync(join(root, 'doxa-maps-spa'))) {
    writeFileSync(join(root, 'doxa-maps-spa', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  }
  // THE FRONT PAGE IS THE STUDIO (see studioRootHtml). The staging-forge chooser that used to be
  // written here (rootHtml) is retired with it; nothing is written above the tree any more.
  // …with the studio bundle's integrity, written HERE: it used to be added only by fix:sri, so running
  // `bun run tree` after fix:sri stripped it again (found 2026-09-25).
  writeFileSync(join(root, 'index.html'), studioRootHtml(bakedToken, (bundles.find((b) => b.bundle === 'plugin-studio') || {}).integrity || ''))


  bundles.forEach((b) => {
    const bundleDir = join(root, b.bundle)
    mkdirSync(bundleDir, { recursive: true })
    // ── THE 19 BUNDLE CHOOSERS ARE NO LONGER EMITTED (2026-09-22) ─────────────────────────────
    // <tree>/<bundle>/index.html used to be a "staging-forge" chooser page listing that bundle's
    // profiles. MEASURED before removal: referenced by manifest.json exactly ZERO times, while the
    // 28 profile leaves one level deeper are referenced 28 times by embed.iframe (the IFRAME
    // deployment method — a shipped deliverable). So the choosers were reachable only by typing
    // their URL, mounted NO element, and returned a confident HTTP 200.
    //
    // ★ WHY THAT 200 WAS EXPENSIVE, not merely useless: probing a chooser is INDISTINGUISHABLE
    // from probing a broken feature. It cost a whole session (none of the elements seemed to
    // work — they did; the page was a chooser presenting itself as the product) and cost an
    // agent a false "the grid is completely inert" diagnosis. A page that answers 200 with no
    // element is a lying instrument, and deleting it removes a whole class of wrong answer.
    //
    // bundleHtml() is KEPT (unused here) on purpose: it is the scope='bundle' half of forgeHtml,
    // still exercised by the archived gallery's model, and removing it would be a second,
    // unrelated change riding along with this one.
    for (const p of b.profiles) {
      const profDir = join(bundleDir, p.profile)
      mkdirSync(profDir, { recursive: true })
      writeFileSync(join(profDir, 'index.html'), profileHtml(b, p, tokenUrlExpr, bakedToken))
      // Preconfigured instances → one nested page each, props baked in.
      for (const inst of (p.instances || [])) {
        const instDir = join(profDir, inst.id)
        mkdirSync(instDir, { recursive: true })
        writeFileSync(join(instDir, 'index.html'), instanceHtml(b, p, inst, tokenUrlExpr, bakedToken))
      }
    }
  })
}

function publicReadme(bundles) {
  const profiles = bundles.reduce((n, b) => n + b.profiles.length, 0)
  return `# public/ — the built output

This folder is GENERATED by \`bun run build\`; do not edit it by hand. It holds exactly one thing:

- **\`${TREE_NAME}/\`** — the output folder: ${bundles.length} plugin bundles and ${profiles} pages, self-contained.
  Copy this one folder to any web host (or open it from disk) and it works.
  - \`${TREE_NAME}/index.html\` — the front page: the Plugin Studio, every plugin in one place.
  - \`${TREE_NAME}/<plugin>/<plugin>.js\` — a plugin's bundle (a custom element; load it with a \`<script>\` tag).
  - \`${TREE_NAME}/<plugin>/<page>/index.html\` — a ready-made page for one plugin view (embed it in an \`<iframe>\`).
  - \`${TREE_NAME}/manifest.json\` — every plugin, page and embed snippet, machine-readable.
  - \`${TREE_NAME}/assets/\` — the data, fonts and images the plugins fetch at runtime.

The folder's name comes from \`name\` in \`vite.doxa-maps-build-config.json\`. Sources live in
\`plugin-designs/\`, \`library/\` and \`data/\`; \`rm -rf public/ && bun run build\` recreates all of this.
`
}

function main() {
  const bundles = scanBundles()
  // SUBRESOURCE INTEGRITY is computed inside scanBundles() (each bundle record carries
  // `integrity`), so it is available to the embed snippets AND the generated <script> tags.
  const tokenUrlExpr = readTokenUrlExpr()
  const bakedToken = DEST_CONFIG.token   // opt-in literal token (ladder rung 3); '' by default

  // 1. Fill in manifest + HTML on the DEFAULT root (where vite already emitted the .js).
  writeManifestAndHtml(DEFAULT_ROOT, bundles, tokenUrlExpr, bakedToken)

  // 2. Copy the completed default tree to every extra destination.
  const dests = readDestinations()
  // ── RUNTIME ASSETS: previews + boundaries ────────────────────────────────
  // These are deliberately NOT bundled. The build is a single-file IIFE with
  // `inlineDynamicImports: true`, so anything imported — even via a dynamic
  // import() — is inlined. That took the upg-100-list bundle to 6 MB: 1.8 MB of
  // poster previews plus 2.74 MB of boundary coordinates, all of it blocking the
  // map, the list view and the poster wall behind one parse.
  // Serving them as real files instead keeps the bundle at ~0.4 MB, lets the
  // browser cache them, and lets the shell become interactive immediately.
  // They must be COPIED here or a clean build drops them and the wall falls back
  // to text placeholders while the map fails to resolve its boundaries.
  {
    // STAGED IN A TEMP DIRECTORY, NOT public/assets (decision, card BUILD-OUTPUT-IS-ONE-FOLDER:
    // public/ holds only the output folder + README.md). This step still gathers the sources
    // (data/, plugin previews, the upg-100 boundaries) into one pool and copies the fetched
    // allowlist into <tree>/assets below; the pool itself is a build intermediate. The web-root
    // sibling it used to be was also a trap: it made a sibling-relative asset path resolve locally
    // while it 404'd live (library/utils/embedBase.js records that incident).
    const pubAssets = mkdtempSync(join(tmpdir(), `${TREE_NAME}-assets-`))
    // …and removed even if this script dies part-way: an 'exit' handler runs on a crash too. A pool left
    // behind by a failed build is ~50 MB in /tmp, and on a full disk (2026-09-25) that is what fails the NEXT build.
    const dropPool = () => { try { rmSync(pubAssets, { recursive: true, force: true }) } catch { /* already gone */ } }
    process.once('exit', dropPool)
    // EVERY profile's previews, not just the 100-list's. This was hardcoded to
    // my-upg-100-list, so country-posters shipped with zero thumbnails and its
    // whole wall fell back to "poster not generated yet" placeholders even though
    // 174 WebPs existed on disk. Any future poster app is picked up automatically.
    // Filenames are already app-prefixed (country-*.webp vs the zone keys), so one
    // flat folder cannot collide.
    {
      const profilesRoot = resolve(__dirname, '..', 'plugin-designs')
      const d = join(pubAssets, 'previews')
      let copied = 0
      for (const name of readdirSync(profilesRoot)) {
        if (name.startsWith('_') || name.startsWith('.')) continue
        const src = join(profilesRoot, name, 'assets', 'previews')
        if (!existsSync(src)) continue
        mkdirSync(d, { recursive: true })
        cpSync(src, d, { recursive: true })
        copied += readdirSync(src).length
      }
      if (copied) console.log(`[generate-tree] gathered ${copied} poster previews`)
    }
    const bDir = join(pubAssets, 'boundaries')
    mkdirSync(bDir, { recursive: true })
    const dataDir = resolve(__dirname, '..', 'plugin-designs', 'my-upg-100-list', 'data')
    for (const [from, to] of [
      [join(dataDir, 'adm0', 'world-adm0.geojson'), 'world-adm0.geojson'],
      [join(dataDir, 'gb-IND-ADM1.geojson'), 'gb-IND-ADM1.geojson'],
      [join(dataDir, 'gb-CHN-ADM1.geojson'), 'gb-CHN-ADM1.geojson'],
      // COMPLETE India ADM1 (36 units, geoBoundaries gbOpen, CC BY 2.5 IN; source + licence in its meta),
      // for maps that colour every state. The curated file above is UPG-100's 34-unit partition.
      [resolve(__dirname, '..', 'data', 'boundaries', 'gb-IND-ADM1-full.geojson'), 'gb-IND-ADM1-full.geojson'],
      // ★ AND THE ATTRIBUTION, because this pair list is what decides whether it TRAVELS. The India
      // ADM1 boundary is Creative Commons Attribution, so the credit has to reach the recipient with
      // the data; a file left in data/boundaries would never ship. Same trap as vendor/*/LICENSE.
      [resolve(__dirname, '..', 'data', 'boundaries', 'ATTRIBUTION'), 'ATTRIBUTION'],
      [resolve(__dirname, '..', 'data', 'boundaries', 'gb-IND-ADM1-full.meta.json'), 'gb-IND-ADM1-full.meta.json'],
      // WEB copies (library/scripts/boundaries/build-web-boundaries.mjs): every feature and island kept, about
      // a fifth of the bytes. The interactive maps fetch these; posters, print and build-time point-in-polygon
      // keep the full files above (REPORT-WEB-BOUNDARIES.md).
      [join(dataDir, 'adm0', 'world-adm0-web.geojson'), 'world-adm0-web.geojson'],
      [join(dataDir, 'gb-IND-ADM1-web.geojson'), 'gb-IND-ADM1-web.geojson'],
      [resolve(__dirname, '..', 'data', 'boundaries', 'gb-IND-ADM1-full-web.geojson'), 'gb-IND-ADM1-full-web.geojson'],
      // The capitals and cities a generated map sheet draws (Natural Earth 1:10m, public domain — no credit
      // to carry). Served here and fetched at PRINT time by library/packet/posterSheets.js, so the 170 KB is
      // paid by a reader who prints, not bundled into every page that can. The Node generator reads the
      // same file from its source.
      [resolve(__dirname, '..', 'library', 'scripts', 'posters', 'data', 'ne-places.json'), 'ne-places.json'],
    ]) if (existsSync(from)) cpSync(from, join(bDir, to))
    console.log('[generate-tree] gathered boundary geojson')
    // ★ THE MAP-SHEET GENERATOR, SERVED — not bundled. library/packet/poster-render.js is a pure module with
    // no imports; every bundle that can print a sheet imported it, and single-file builds inline an
    // import, so each carried ~65 KB for a print few readers make (country-posters crossed the 1.5 MB
    // ceiling on it). Served here verbatim, posterSheets imports it BY URL at the first print, once, cached
    // across maps. check:poster-browser-equiv asserts this copy is byte-identical to the source.
    const libDir = join(pubAssets, 'lib')
    mkdirSync(libDir, { recursive: true })
    cpSync(resolve(__dirname, '..', 'library', 'packet', 'poster-render.js'), join(libDir, 'poster-render.js'))
    // …and its CLASSIC-SCRIPT copy, for pages whose policy forbids blob: scripts (loaded with
    // <script integrity>), written by the same transform the pin is computed from.
    writeFileSync(join(libDir, 'poster-render.global.js'),
      globalVariant(readFileSync(resolve(__dirname, '..', 'library', 'packet', 'poster-render.js'), 'utf8')))
    // …and the packet/list/card TEXT in all 11 languages (~115 KB), for the same reason: every bundle that can
    // print inlined the whole table. library/packet/packetStrings.js fetches this copy at print time, checks
    // it against PACKET_STRINGS_SHA384, and falls back to the bundled English block if it cannot.
    cpSync(resolve(__dirname, '..', 'library', 'scripts', 'posters', 'packet-strings.json'), join(libDir, 'packet-strings.json'))

    // DATA LIVES IN data/, THE WEB-ROOT IS GENERATED (the D1 reorganization):
    // source-of-truth folders that used to sit ONLY inside public/ now live in
    // data/ and are copied into the served tree here, exactly like boundaries
    // above. Served paths are unchanged (public/assets/people-groups, /vendor),
    // so no runtime reference moves. public/ stays fully regenerable: rm -rf it
    // and `bun run build` rebuilds everything. The web-root holds only assets/,
    // <name>/ and the generated root page (internal/generate-gallery.mjs): the
    // vendored external bundles (data/external-bundles) were consumed by the
    // optional layouts/ shell alone, so they are no longer copied; the frame
    // policy is the serving host's (documentation/architecture/embeddability.md).
    const repoData = resolve(__dirname, '..', 'data')
    for (const [srcName, destRel] of [
      ['people-groups', join(pubAssets, 'people-groups')],
      ['vendor',        join(pubAssets, 'vendor')],
      ['posters',       join(pubAssets, 'posters')],
      ['tables',        join(pubAssets, 'tables')],
      // pplr — the PPLR data maps' derived datasets (plugin-designs/pplr-data-maps/scripts/build-data.mjs)
      ['pplr',          join(pubAssets, 'pplr')],
      // fonts/ + images/ — vendored faces and images the leaves fetch (see the staging notes
      // below). They used to live ONLY in public/assets; they are sources, so they live in data/.
      ['fonts',         join(pubAssets, 'fonts')],
      ['images',        join(pubAssets, 'images')],
    ]) {
      const src = join(repoData, srcName)
      if (!existsSync(src)) continue
      rmSync(destRel, { recursive: true, force: true })
      mkdirSync(destRel, { recursive: true })
      cpSync(src, destRel, { recursive: true })
    }
    console.log('[generate-tree] gathered data/ sources into the build pool (people-groups, vendor, posters, tables, pplr, fonts, images)')

    // ── THE TREE IS THE SHIPPING UNIT: stage the fetched assets INSIDE it ──────
    // BUG-DATA-ASSETS-NOT-SHIPPED-TREE-NOT-PORTABLE (2026-09-20). The web-root copy
    // above is a SIBLING of the tree; a publisher that rsyncs only `<TREE_NAME>/`
    // (ours does) never carries it, so every data fetch 404'd live and four elements
    // rendered a black page. Pages now resolve assets TREE-RELATIVE (assetsBaseFor),
    // so the data must live at `<TREE_NAME>/assets/` for the tree to be genuinely
    // self-contained and position-independent.
    //
    // ONLY WHAT IS FETCHED AT RUNTIME. This is an allowlist, not a mirror: the
    // web-root assets/ is 94 MB, dominated by posters (42 MB) and previews (10 MB)
    // that no leaf fetches over HTTP, plus the 16 MB people_groups.csv that nothing
    // reads (already in dropin.exclude). Copying all of it would bloat every deploy.
    // Each entry below is traceable to a literal fetch() in a .vue — add a row here
    // when an element starts fetching something new, or it will 404 in the tree.
    const treeAssets = join(DEFAULT_ROOT, 'assets')
    rmSync(treeAssets, { recursive: true, force: true })
    let staged = 0
    for (const rel of [
      // boundaries — choropleth geometry
      //   gospel-resources/resources-map.vue, cities-internet/connectivity-map.vue → world-adm0
      //   my-upg-100-list/upg-100-list.vue → all three (adm0 + IND/CHN adm1)
      'boundaries/world-adm0.geojson',
      'boundaries/gb-IND-ADM1.geojson',
      'boundaries/gb-CHN-ADM1.geojson',
      'boundaries/gb-IND-ADM1-full.geojson',        // all 36 states (Cities with Internet's NFHS layer)
      'boundaries/gb-IND-ADM1-full.meta.json',      // its source and licence, served beside it
      // ★ SECOND STAGE. The pair list above only gathers into the build POOL; THIS list decides what
      // reaches the tree. I added ATTRIBUTION to the pair list, ran the build, and it still did not ship
      // — a two-stage pipeline needs the entry in both. The India ADM1 boundary is Creative Commons
      // Attribution, so the credit must travel with the data.
      'boundaries/ATTRIBUTION',
      'boundaries/world-adm0-web.geojson',           // the web copies the interactive maps fetch
      'boundaries/gb-IND-ADM1-web.geojson',
      'boundaries/gb-IND-ADM1-full-web.geojson',
      // The map-sheet generator's two print-time fetches (library/packet/posterSheets.js): the capitals and
      // cities it draws, and the generator itself (sha384-pinned in poster-render.integrity.js). Both were
      // gathered into the pool above but, missing here, never reached the tree: a print would 404.
      'boundaries/ne-places.json',
      'lib/poster-render.js',
      'lib/poster-render.global.js',   // the classic-script copy, same generator (see the pool stage)
      'lib/packet-strings.json',       // the packet/list/card text, fetched at print time (packetStrings.js)
      // people-groups — all-people-groups.vue (the slim JSON only; NOT the 16 MB CSV,
      // which no element fetches and which dropin.exclude already withholds).
      'people-groups/people-groups-slim.json',
      // …and India's states and union territories with their people groups (data/people-groups/india-states.json),
      // fetched by library/data/indiaStates.js only when a state is needed (UPG-100's batch selection, Country
      // Posters' India section). sha384-pinned in library/data/indiaStates.integrity.js.
      'people-groups/india-states.json',
      // …and its compact cut (build-points.mjs): what all-people-groups actually fetches, 0.74 MB.
      'people-groups/people-groups-points.json',
      // pplr-data-maps — fetched through dataUrl() (src/utils/pplrData.js). pg-names.json loads
      // only when a pin's detail card opens.
      'pplr/pg-points.json',
      'pplr/pg-names.json',
      'pplr/coverage.json',
      'pplr/rop-tree.json',
      'pplr/pplr-geoid-family.json',
      'pplr/rosetta-sample.json',
      // vendor — DataTable/TabulatorTable inject Tabulator from assetsBase at runtime.
      'vendor/tabulator/tabulator.min.js',
      'vendor/tabulator/tabulator.min.css',
      // ★ AND THEIR LICENCES, because this list is what decides whether a notice TRAVELS. Both are MIT,
      // which requires the permission notice to be included with the software. Tabulator's minified .js
      // carried only a copyright line and its .css carried nothing; Vue's banner names MIT but omits the
      // permission text. Shipping the code without the notice is the gap, and an allowlist that omits
      // the LICENSE guarantees it stays open however carefully the file is vendored.
      'vendor/tabulator/LICENSE',
      // vendor/vue — the GALLERY SHELL's own Vue (generate-gallery.mjs loadVue()), not a bundle's.
      //
      // ★ ADDED 2026-09-22, and it had never been staged. generate-gallery.mjs:542 requests
      // `ASSETS + '/vendor/vue/vue.global.prod.js'` and this list shipped only vendor/tabulator,
      // so that request 404'd on every build there has ever been. It survived because loadVue()
      // degrades in three rungs — self-hosted, then the jsDelivr CDN, then a plain-DOM render —
      // and on any networked machine rung 2 silently covers for rung 1. The only symptom was a
      // 404 in `bun run smoke`, a gate nobody was running.
      //
      // WHY IT MATTERS ANYWAY: the comment above loadVue() promises "self-hosted first (portable /
      // offline / no-CDN)". Measured in a browser with no outbound network, the gallery fell all
      // the way through to the plain-DOM degrade — usable, but not the Vue shell, and the offline
      // claim was false. A tree dropped on a foreign host or opened over file:// is exactly the
      // case the self-hosted rung exists for.
      'vendor/vue/vue.global.prod.js',
      'vendor/vue/LICENSE',
    ]) {
      const from = join(pubAssets, rel)
      if (!existsSync(from)) { console.warn(`[generate-tree] WARN missing tree asset: assets/${rel}`); continue }
      const to = join(treeAssets, rel)
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
      staged++
    }
    // tables/*.json — the data-tables + map layers fetch these by name; ship the whole
    // (small, ~14 MB total on disk but only the fetched ones matter) folder MINUS the
    // internal-only files dropin.exclude already names, so a new table works with no
    // build change. Kept as a directory copy because the fetch name is dynamic
    // (`${assetsBase}/tables/${file}.json`).
    const TABLES_SKIP = new Set(['open-doors.json', 'platform-reachability.json', 'index.json'])
    const tablesSrc = join(pubAssets, 'tables')
    if (existsSync(tablesSrc)) {
      const tablesDest = join(treeAssets, 'tables')
      mkdirSync(tablesDest, { recursive: true })
      for (const f of readdirSync(tablesSrc)) {
        if (TABLES_SKIP.has(f)) continue
        cpSync(join(tablesSrc, f), join(tablesDest, f))
        staged++
      }
    }
    // people-groups/lists/*.json — the ?list= / profile-config `list` prop fetches the chosen list by name
    // (frontier-500k, frontier, unreached, unengaged), so the whole folder ships. Missing, every non-default
    // list 404'd on the built tree and drew 0 pins (measured at a71007f1).
    const listsSrc = join(pubAssets, 'people-groups', 'lists')
    if (existsSync(listsSrc)) {
      const listsDest = join(treeAssets, 'people-groups', 'lists')
      mkdirSync(listsDest, { recursive: true })
      for (const f of readdirSync(listsSrc)) { if (!f.endsWith('.json')) continue; cpSync(join(listsSrc, f), join(listsDest, f)); staged++ }
    }
    // previews/ + posters/ — the poster walls fetch these PER CARD, lazily, by id
    // (`${assetsBase}/previews/<id>.webp`, `${assetsBase}/posters/<id>.webp`), so the
    // name is dynamic and the whole folder ships. They are the bulk of the tree
    // (previews ~10 MB, posters ~42 MB) but both are really fetched and dropping
    // either is a VISIBLE regression, not a saving:
    //   previews → the my-upg-100-list / country-posters wall thumbnails. Without
    //              them every card falls back to a text placeholder (the reported
    //              "UPG-100 poster preview unavailable").
    //   posters  → the full-size download behind the wall's export button, which
    //              fails closed with "poster not found (404)" if absent.
    // Excluded on purpose instead: assets/people_groups.csv (16 MB, fetched by
    // nothing) and the internal-only tables above.
    // POSTERS ARE OPT-IN (bundlePosters, default false). MEASURED 2026-09-20: staging both dirs
    // made the tree 74 MB, which git-packed to 57 MiB and the catalog server REJECTED outright
    // ("remote end hung up"), so nothing could publish at all. The split that resolves it comes
    // from the components themselves: PosterWall renders the wall from previews/<id>.webp
    // (line 80) and only fetches posters/<id>.webp ON DEMAND behind the export button (line 159).
    // So previews (10 MB, 378 files) are what RENDER and must ship; full posters (42 MB) are
    // print-resolution originals needed only when a user actually exports one. Shipping previews
    // keeps every element visually complete in a dropped folder — the self-contained promise —
    // while an absolute assetsBaseUrl serves the originals on demand (the same escape hatch used
    // for partner-site and mobile embeds). Set bundlePosters:true to ship them anyway for a
    // fully offline drop, accepting the size.
    // ★ fonts/ MUST be staged (measured 2026-09-24). A leaf page resolves its assetsBase to
    // <tree>/assets, so a vendored @font-face at assets/fonts/... is fetched from INSIDE the
    // tree — and this staging step is an allowlist, so a dir absent from it 404s. The regions
    // clone vendors Bebas Neue (public/assets/fonts/bebas-neue, OFL) because DX-life serves
    // theirs without CORS; with fonts/ unstaged the face registered, requested
    // <tree>/assets/fonts/..., failed, and every heading silently rendered on the fallback.
    // document.fonts reported the face in 'error' status while a computed-style diff of the
    // two pages said 0 differences — both sides agreeing on a FALLBACK is not a match, and a
    // font that 404s is invisible to every check that reads font-family rather than asking
    // the engine whether the family is usable.
    // Small and self-contained: a woff2 pair is ~22KB, and the tree's self-contained promise
    // is exactly why it has to travel with it.
    // ★ images/ MUST be staged for the same reason fonts/ must (see the note above). The
    // regions clone copies DX-life's worldmap.svg watermark, which their UupgsList sets inline
    // as a background-image on its root (UupgsList.vue:451-454, background-size 60% /
    // background-position top / min-height 400px). A leaf resolves assetsBase to <tree>/assets,
    // so the URL is fetched from INSIDE the tree; with images/ absent from this allowlist it
    // 404s and the watermark is simply not there, with no error anywhere — the background just
    // does not paint, which is even quieter than the font failure was.
    // ★ posters/ CARRIES TWO VERY DIFFERENT PAYLOADS and bundlePosters is one boolean,
    // so it could only ever ship both or neither:
    //   <id>.webp  378 files, 40.9 MB — the print-resolution rasters. This is the weight
    //              that pushed the tree to 80MB and got the push rejected.
    //   <id>.html   28 files, the poster SOURCE the browser rasterises when no .webp is
    //              present (library/packet/poster-raster.js). 27 MB raw, 7 MB gzipped.
    // "Neither" is what a default drop got, and it is why BOTH full-size paths 404'd:
    // export fell back to fetching <id>.html and that was not shipped either, so the
    // fallback had nothing to fetch. posterSources ships the sources WITHOUT the rasters,
    // which is the only combination the old boolean could not express.
    // The code default stays FALSE (real weight is a per-deployment decision); the dx-maps config
    // turns it ON, because the prayer packet's map page fetches these and printed blank without them.
    // ★ SOURCES ALONE LEFT 350 OF 378 POSTERS UNPRINTABLE (2026-09-29). Only the 28 zone posters
    // have a source; the 176 city-* need OSM street tiles to regenerate (not reproducible offline,
    // see library/scripts/posters/publish-html.mjs) and the 174 country-* have none, so their
    // export said "poster not found (404)". So posterSources ships each poster ONCE: the source
    // where one exists (28, ~28 MB), the raster for the rest (350, ~37 MB). HTML is the heavy form
    // (~1 MB per source vs ~0.1 MB per raster), so generating sources for the 350 would have
    // multiplied the weight; and the rasters are the tracked data/posters/*.webp, byte-identical,
    // so git stores each once and the published tree adds ~0 new pack bytes.
    const posterExts = DEST_CONFIG.bundlePosters ? null                 // everything
      : (DEST_CONFIG.posterSources ? ['.html', '.webp'] : [])           // lightest form each / nothing
    const assetDirs = (posterExts === null || posterExts.length)
      ? ['previews', 'posters', 'fonts', 'images']
      : ['previews', 'fonts', 'images']
    for (const dirName of assetDirs) {
      const src = join(pubAssets, dirName)
      if (!existsSync(src)) { console.warn(`[generate-tree] WARN missing tree asset dir: assets/${dirName}`); continue }
      if (dirName === 'posters' && posterExts !== null) {
        // Selective copy: only the extensions this deployment asked for.
        mkdirSync(join(treeAssets, dirName), { recursive: true })
        let n = 0
        const files = readdirSync(src)
        // A poster with a source never also ships its raster (lightest printable form).
        const hasSource = new Set(files.filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -'.html'.length)))
        for (const f of files) {
          if (!posterExts.some((e) => f.endsWith(e))) continue
          if (f.endsWith('.webp') && hasSource.has(f.slice(0, -'.webp'.length))) continue
          cpSync(join(src, f), join(treeAssets, dirName, f))
          n += 1
        }
        staged += n
        continue
      }
      cpSync(src, join(treeAssets, dirName), { recursive: true })
      staged += readdirSync(src).length
    }
    if (DEST_CONFIG.bundlePosters) {
      console.log('[generate-tree] posters/ bundled in full (bundlePosters:true) — rasters + sources')
    } else if (DEST_CONFIG.posterSources) {
      console.log('[generate-tree] posters/ bundled once each (posterSources:true) — the .html source where one exists (rasterised in the browser), else the .webp')
    } else {
      console.log('[generate-tree] posters/ NOT bundled — the wall renders from previews; export and print need posterSources:true, bundlePosters:true, or an absolute assetsBaseUrl')
    }
    console.log(`[generate-tree] staged ${staged} runtime asset(s) → ${TREE_NAME}/assets (tree is self-contained)`)
    rmSync(pubAssets, { recursive: true, force: true })
  }

  // public/README.md — the one other entry public/ holds: what this folder is, in plain words.
  writeFileSync(join(DEFAULT_ROOT, '..', 'README.md'), publicReadme(bundles))

  for (const dest of dests) {
    if (dest === DEFAULT_ROOT) continue
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(DEFAULT_ROOT, dest, { recursive: true })
    console.log(`[generate-tree] copied ${TREE_NAME}/ → ${dest}`)
  }

  // The native app shells load THIS folder; keep their paths in step with the tree's name.
  for (const r of syncAppShells()) if (r.changed) console.log(`[generate-tree] app shell ${r.file}: ${r.notes.join('; ')}`)

  console.log(`[generate-tree] ${bundles.length} bundle(s), ` +
    `${bundles.reduce((n, b) => n + b.profiles.length, 0)} profile(s) → ${dests.length} destination(s)`)
}

main()
