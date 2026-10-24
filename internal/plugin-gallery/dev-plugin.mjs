/**
 * dev-plugin.mjs — the Vite dev-only plugin that serves the plugin gallery.
 *
 * Routes:  GET /                                  the plugin gallery: internal/generate-gallery.mjs
 *                                                 renderGallery(model, { mode: 'dev' }) over
 *                                                 galleryModel(discoverSpaRegistry())
 *          GET /__plugin-gallery/manifest.json    that model, manifest-shaped (the page fetches it live)
 *          GET /__plugin-gallery/registry.json    the discovery registry, machine-readable (smoke tools)
 *          GET /assets/<rel>  (and /__plugin-gallery/assets/<rel>)  shared asset root (see resolveDevAsset)
 * Wire-up: plugins: [vue(), cssInjectedByJsPlugin(), autoSpaDevPlugin(token)] in vite.config.js.
 * Verify:  bun run smoke:gallery  (internal/plugin-gallery-smoke.mjs — every element must boot)
 */
import { resolve, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { REPO_ROOT, discoverSpaRegistry } from './discover.mjs'
import { readBuildConfig, renderGallery } from '../generate-gallery.mjs'
import { TREE_NAME } from '../_tree-name.mjs'
import { profileMetaFields, bundleStage, bundleVisibility } from '../profile-meta.mjs'

// ─── DEV plugin gallery ──────────────────────────────────────────────────────
// `bun x vite` (dev) serves the plugin gallery at `/` — the same page `bun run build`
// writes to public/index.html — over every profile DISCOVERED across plugin-designs/*/.
// Choosing a map lazy-imports that bundle's dev entry (registering its custom element)
// and mounts it, with the dev Mapbox token (VITE_MAPBOX_TOKEN) as the baked rung of
// the token ladder so maps just work. Dev-only (apply:'serve'); the build is untouched.

// Shared asset root for the dev plugin gallery. Data-driven profiles (connectivity-map,
// resources-map, cities-map, poster walls, tables) fetch `assetsBase + '/tables/*.json'`
// and `'/boundaries/*.geojson'`. publicDir is false ON PURPOSE (a bundle build must never
// inline public/), so dev has to serve the asset tree explicitly, the way the built site
// does: public/assets first (exactly what generate-tree ships), else the tracked data/ source, else the per-bundle source
// of truth plugin-designs/<bundle>/data/<rel> when public/ has been cleaned.
const DEV_ASSET_MIME = {
  '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.pdf': 'application/pdf',
}
export function resolveDevAsset(rel, root = REPO_ROOT) {
  const isFile = (p) => existsSync(p) && statSync(p).isFile()
  // The built copy lives INSIDE the output folder (public/<tree>/assets) — public/ holds nothing else
  // since BUILD-OUTPUT-IS-ONE-FOLDER. The data/ fallback below keeps a fresh clone working unbuilt.
  // data/<rel> FIRST: it is the tracked source of truth that the built copy mirrors. Serving the built copy
  // first meant a data/ edit showed OLD data under the dev server until someone rebuilt (73 files have
  // both; found by the multiplayer dev-server spike, 2026-09-26). A dev server shows the source.
  const source = resolve(root, 'data', rel)
  if (isFile(source)) return source
  // The built copy (public/<tree>/assets) still answers for what exists only there: files generate-tree
  // derives rather than copies.
  const shipped = resolve(root, 'public', TREE_NAME, 'assets', rel)
  if (isFile(shipped)) return shipped
  const profiles = resolve(root, 'plugin-designs')
  for (const name of readdirSync(profiles)) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    const cand = resolve(profiles, name, 'data', rel)
    if (isFile(cand)) return cand
  }
  return null
}

// The manifest-shaped model (schema doxa-maps-manifest@1: bundles → profiles → instances)
// the gallery renders, from the discovery registry. Bundles and profiles are ordered
// alphabetically, as generate-tree orders the manifest; a preset profile keeps its own
// row above its instances, exactly as the built page lists it.
//   scriptUrl  the bundle's dev entry — the page imports it (no IIFE exists under the dev server)
//   iframeUrl  this gallery's own deep link — the only page under the dev server that shows
//              exactly this map (the built leaf pages do not exist here); Open page and the
//              maps' Share button use it, so a shared link reopens the same map
//   embed      the snippets the build will write (generate-tree's template, tree-relative;
//              integrity only exists after a build), so Copy embed previews what ships
function readComposes(bundle, profile) {
  try {
    const meta = JSON.parse(readFileSync(resolve(REPO_ROOT, 'plugin-designs', bundle, `${profile}.meta.json`), 'utf8'))
    return Array.isArray(meta?.composes) ? meta.composes.map(String).filter(Boolean) : []
  } catch { return [] }
}

export function galleryModel(reg) {
  const iframe = (u) => `<iframe src="${u}?utm_source=YOUR_SOURCE" width="100%" height="600" style="border:none;border-radius:12px;" allowfullscreen></iframe>`
  // A REAL DEV LEAF, not a hash deep-link into the gallery.
  //
  // THIS USED TO BE `'/#/' + parts.join('/')` — a hash route into the gallery PAGE. That was
  // coherent while `/` WAS the gallery, but the studio nests map profiles in a lazy iframe pointed
  // at exactly this URL (plugin-studio.vue:25, mode 'iframe'), so every map tab was iframing the
  // gallery. The staging blurb — "One shared core, one build, many paste-anywhere maps..." —
  // rendered INSIDE each plugin pane, and the studio was reported as still loading an HTML page
  // with that text for each plugin. It was: the gallery, recursively, once per map tab.
  //
  // `/__leaf/<bundle>/<profile>[/<instance>]` instead serves a minimal page that mounts ONE element
  // and nothing else — the dev equivalent of the built tree's <bundle>/<profile>/index.html, which
  // is what this URL means in production. Same contract, so the studio behaves identically in both.
  const link = (...parts) => '/__leaf/' + parts.map(encodeURIComponent).join('/')
  // GATED bundles (vite.doxa-maps-build-config.json `gatedProfiles`, e.g. key-cities) are withheld
  // from every public surface the BUILD emits. The dev model listed them anyway, so the studio and the
  // Research Gallery's Experimental shelf showed under the dev server — which is what DX runs first
  // after cloning — a plugin the built tree deliberately hides. Same rule here, so dev == built.
  let gated = new Set()
  // Read from the config file itself, as generate-tree does: readBuildConfig() returns a projection
  // that does not carry gatedProfiles.
  try {
    const cfg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'vite.doxa-maps-build-config.json'), 'utf8'))
    if (Array.isArray(cfg.gatedProfiles)) gated = new Set(cfg.gatedProfiles.map(String))
  } catch { /* no config: gate nothing */ }
  const bundles = [...reg].filter((b) => !gated.has(b.bundle)).sort((a, b) => a.bundle.localeCompare(b.bundle)).map((b) => {
    const scriptUrl = `/plugin-designs/${b.bundle}/index.js`
    const presets = new Map()   // profile → its preset instances (empty for every other kind)
    const typeOf = new Map()    // profile → composition tier machine key (single … nested-mfe-spa)
    for (const it of b.items) {
      if (!presets.has(it.profile)) presets.set(it.profile, [])
      if (!typeOf.has(it.profile)) typeOf.set(it.profile, it.type)
      if (it.type === 'parameterized') presets.get(it.profile).push(it)
    }
    const profiles = [...presets.keys()].sort().map((profile) => {
      const p = {
        profile, file: `${profile}.vue`, description: '', element: b.tag,
        type: typeOf.get(profile) || 'single',
        ...profileMetaFields(resolve(REPO_ROOT, 'plugin-designs', b.bundle), profile),   // same as the built manifest
        iframeUrl: link(b.bundle, profile), scriptUrl,
        embed: {
          iframe: iframe(`./${b.bundle}/${profile}/index.html`),
          script: `<script src="./${b.bundle}/${b.bundle}.js"></script>\n<${b.tag} profile-config='${JSON.stringify({ profile, tk: 'YOUR_MAPBOX_TOKEN', utmSource: 'YOUR_SOURCE' })}'></${b.tag}>`,
        },
      }
      const instances = presets.get(profile).map((it) => ({
        id: it.id, title: it.label, apiBaseUrl: it.apiBaseUrl || '',
        props: { profile, ...(it.props || {}) }, element: b.tag,
        iframeUrl: link(b.bundle, profile, it.id),
        embed: { iframe: iframe(`./${b.bundle}/${profile}/${it.id}/index.html`) },
      }))
      if (instances.length) p.instances = instances
      return p
    })
    // COMPOSITION EDGES, the same source and shape generate-tree publishes: the union of every
    // profile's <profile>.meta.json `composes`, at bundle level, omitted when none. This model used
    // to drop them, so under the dev server — which is what a laptop runs — the studio's
    // Composed-of panel and composition trees were silently empty for every composite.
    const composes = [...new Set([...presets.keys()].flatMap((profile) => readComposes(b.bundle, profile)))]
    return { bundle: b.bundle, scriptUrl, integrity: '', elements: [b.tag], stage: bundleStage(profiles), ...(bundleVisibility(profiles) === 'public' ? { visibility: 'public' } : {}), ...(composes.length ? { composes } : {}), profiles }
  })
  return {
    schema: 'doxa-maps-manifest@1', generatedFrom: 'plugin-designs/*/*.vue (dev discovery)', embedBase: '.',
    bundleCount: bundles.length, profileCount: bundles.reduce((n, b) => n + b.profiles.length, 0), bundles,
  }
}

// ── ONE PART OF A LEAF URL ───────────────────────────────────────────────────────────────────
// /__leaf/<bundle>/<profile>[/<instance>] parts are written INTO the leaf page: its <title> and the
// element's profile-config='…' attribute. Refusing only `..` and `/` let a quote or a tag through, so a
// crafted link broke out of the attribute on a publicly reachable dev server. Every bundle folder,
// profile id and instance id in the tree has this shape (the address keys' own pattern,
// library/composables/useViewAddress.js), so anything else is refused before it reaches either sink;
// it also rules out `..` and `/`. check:dev-leaf-escape proves both directions.
export const LEAF_PART = /^[A-Za-z0-9][\w-]{0,63}$/

// For an HTML text node or a quoted attribute value.
export const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// ── THE PRODUCTION EMBED URL, ANSWERED BY THE DEV SERVER ─────────────────────────────────────
// The manifest advertises, and a person copies, tree-relative embed URLs of the shape
// `<bundle>/<profile>/index.html` and `<bundle>/<profile>/<instance>/index.html` — served in
// production out of public/<treeName>/. The dev server had NO route for that shape; it served its
// leaf stand-in at `/__leaf/<bundle>/<profile>[/<instance>]` only.
//
// REPORTED 2026-09-23: an embed URL, copied and opened against a dev server —
//     http://localhost:5174/doxa-simple-map/doxa-simple-map/prayer/index.html
// — did not work. The leaf is real (that exact path serves 200 from the built tree) and
// the embed is healthy (it mounts at 700px in a real iframe). The dev server simply had no route.
//
// ★ AND IT FAILED SILENTLY, which is the part that costs hours. With no route, Vite's SPA fallback
// answers an unknown path with the STUDIO'S HTML at status 200. The reader asks for one map and
// receives a different, entirely working page, with no 404 and nothing in the console. That is the
// same four-surface class as the two other bugs fixed the same day (a manifest 404 returning HTML;
// a ../../ child path that 404'd only from a deeper leaf) — see the assetsBaseUrl and
// MAP_APP_API_URL notes below, both of which are that shape.
//
// The fix REWRITES onto the existing `/__leaf/` renderer rather than copying it. Two renderers
// would drift, and the entire point of the route is that one embed URL renders the SAME thing in
// both environments — a second copy would quietly make that false.
//
// Both prefixes are accepted because both are real:
//   /doxa-simple-map/doxa-simple-map/prayer/index.html              bare, tree-relative — what the
//                                                                   manifest's `./<b>/<p>/…` snippet
//                                                                   becomes when pasted at the root
//                                                                   (this is the URL that was used)
//   /doxa-maps/doxa-simple-map/doxa-simple-map/prayer/index.html    prefixed — the built tree's own
//                                                                   path under public/<treeName>/
// `treeName` comes from the build config (`name`, default 'doxa-maps'), never hardcoded, so renaming
// the output folder cannot silently strand this route.
//
// Returns the rewritten `/__leaf/…` path, or '' when the URL is not an embed leaf URL (the common
// case — every other request must fall through untouched).
export function leafRewrite(path, treeName = TREE_NAME) {
  if (!path.endsWith('/index.html')) return ''
  let segs = path.slice(0, -'/index.html'.length).split('/').filter(Boolean)
  if (segs[0] === treeName) segs = segs.slice(1)          // tolerate the tree-prefixed form
  // <bundle>/<profile> or <bundle>/<profile>/<instance>. Anything else is not a leaf URL; let it
  // fall through to Vite rather than guess (a wrong guess here would shadow a real page).
  if (segs.length < 2 || segs.length > 3) return ''
  // Traversal guard BEFORE the segments are re-joined into a URL the leaf route will parse. The
  // leaf route guards again on its own decoded segments; this one stops an encoded `..` from ever
  // being formed into the rewritten path.
  for (const s of segs) {
    let d = s
    try { d = decodeURIComponent(s) } catch { return '' }
    if (!d || d === '.' || d === '..' || d.includes('/') || d.includes('\\')) return ''
  }
  return '/__leaf/' + segs.join('/')
}

// urlOwner 'app' (library/composables/useViewAddress.js) for a dev page that is OURS, the rule generate-tree bakes
// into the built leaf: its shell writes ?tab=, so a clicked tab survives a reload and a copied link opens it. A
// FRAMED page drops it: a partner page may iframe a leaf (the iframe embed), and a history push from an iframe
// lands in the top page's Back stack. (Plugin Studio mounts its rows directly; its panes are unowned by paneConfig.) Write the element unowned and put this classic script right after it; it runs
// before the deferred module script upgrades the element. `<` is escaped: profile/instance come from the URL.
export function ownIfTopScript(cfg = {}) {
  const owned = JSON.stringify(JSON.stringify({ ...cfg, urlOwner: 'app' })).replace(/</g, '\\u003c')
  return `<script>try{if(window.self===window.top)document.currentScript.previousElementSibling.setAttribute('profile-config',${owned})}catch(e){}</script>`
}

export function autoSpaDevPlugin(token = '') {
  // One generator for both galleries (internal/generate-gallery.mjs), driven by the same build
  // config the built page bakes. What dev changes: the model comes from discovery, the live
  // model route stands in for <tree>/manifest.json, shared assets come from this server's
  // /assets route, and the .env token is the baked rung of the token ladder.
  const page = () => {
    const cfg = readBuildConfig()
    return renderGallery(galleryModel(discoverSpaRegistry()), {
      // ★ `/__plugin-gallery`, ABSOLUTE — the SAME move, and the same fix, as assetsBaseUrl below.
      // `tree` is the folder the live manifest is fetched from and that relative refs resolve
      // against. It was '__plugin-gallery' (relative), correct only while the gallery WAS the root
      // page. The gallery now lives at /__gallery, so the relative form resolves one level deeper.
      // MEASURED 2026-09-22 on the running dev server:
      //     /__plugin-gallery/manifest.json ............. 200
      //     /__gallery/__plugin-gallery/manifest.json ... 404
      // Naming it absolutely makes the value independent of the page depth the gallery sits at —
      // which is the whole reason assetsBaseUrl was made absolute in the same move. The built tree
      // passes '../<name>' for the same reason; both now resolve to the real tree root.
      mode: 'dev', title: cfg.title, tree: '/__plugin-gallery', tokenUrl: cfg.tokenUrl, token: token || cfg.token,
      // ★ ABSOLUTE, NOT RELATIVE — the gallery no longer lives at the root.
      // This was '' (relative), which was correct while the gallery WAS the root page: a map asked
      // for assets/tables/x.json and got /assets/tables/x.json. The gallery has since moved to
      // /__gallery so the studio can own /, and the same relative path now resolves one level deeper
      // to /__gallery/assets/... — which 404s. MEASURED 2026-09-22 on the running dev server:
      //     /assets/tables/internet-by-country.json ............. 200
      //     /__gallery/assets/tables/internet-by-country.json ... 404
      // Nothing failed at move time; the breakage only appears when a map FETCHES, and it surfaces as
      // "JSON.parse: unexpected end of data" rather than as a 404, because Vite answers an unknown
      // path with HTML. The dev server serves the asset tree at /assets/ (see resolveDevAsset), so
      // naming it absolutely makes the value independent of whatever page depth the gallery sits at.
      apiBaseUrl: cfg.apiBaseUrl, assetsBaseUrl: '/assets', qaWidget: cfg.qaWidget,
    })
  }
  const json = (res, body, status = 200) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.end(JSON.stringify(body))
  }
  return {
    name: 'doxa-auto-spa',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawPath = (req.url || '').split('?')[0]
        // NEVER THE REPOSITORY ITSELF. Vite serves the project root, so a reachable dev server answered
        // /.git/… with 200 — the whole history, and any credential in the remote URL (multiplayer spike,
        // 2026-09-26). These routes run before Vite's own checks, so the refusal is here.
        let _decoded = rawPath
        try { _decoded = decodeURIComponent(rawPath) } catch { /* keep raw */ }
        if (/(^|\/)\.(git|env)(\/|$)|(^|\/)\.(merge-queue|main-capture)(\/|$)/i.test(_decoded)) { res.statusCode = 404; return res.end() }
        // A production embed URL (`<bundle>/<profile>[/<instance>]/index.html`) is rewritten onto
        // the `/__leaf/` route BEFORE any branch runs, so the existing leaf renderer answers it
        // unchanged — see leafRewrite above for why the dev server must know this shape at all.
        // The rewrite is applied to `path` (which every branch reads) and to `req.url` (so anything
        // downstream sees a consistent request); never via server.middlewares.handle(), which
        // replays this same middleware and would loop.
        let treeName = TREE_NAME
        try { treeName = readBuildConfig()?.name || treeName } catch { /* keep the default */ }
        const rewritten = leafRewrite(rawPath, treeName)
        const path = rewritten || rawPath
        if (rewritten) req.url = rewritten + (req.url || '').slice(rawPath.length)
        // THE SCRIPT EMBED, TOO (repo, 2026-09-28): the copyable snippet `./<b>/<b>.js` 404'd on the dev
        // server for every production map while the iframe snippet worked through leafRewrite. The bundle
        // IIFE only exists BUILT, so it is served from public/<tree>/ — bare or tree-prefixed, like the
        // leaf. Not built yet: a plain 404 that says so, never Vite's HTML fallback.
        const iife = /^\/(?:([^/]+)\/)?([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\.js$/.exec(rawPath)
        if (iife && iife[2] === iife[3] && (!iife[1] || iife[1] === treeName)) {
          const file = resolve(REPO_ROOT, 'public', treeName, iife[2], iife[2] + '.js')
          if (existsSync(file)) {
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
            res.setHeader('Cache-Control', 'no-cache')
            return res.end(readFileSync(file))
          }
          if (existsSync(resolve(REPO_ROOT, 'plugin-designs', iife[2]))) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            return res.end(`${iife[2]}.js is only produced by a build: run \`bun run build\` (or BUNDLE=${iife[2]} bun x vite build), then reload.`)
          }
        }
        // /assets/* — see resolveDevAsset. A miss is a REAL 404, never Vite's HTML
        // fallback: HTML-for-JSON made three maps die silently at JSON.parse before
        // they ever created a map, with no console error and no error card.
        // <tree>/assets/* too: a plugin nested in a cap-5 shell resolves its assets against the tree base
        // the shell hands it (plugin-studio passes /__plugin-gallery/), exactly as it would against
        // <tree>/assets in the built tree. Only /assets/ was served, so every nested data table 404'd.
        //
        // ★ AND ANY /__leaf/…/assets/* (2026-09-25, reported from a laptop dev server: no boundary polygons
        // on Big Picture, Regions, UPG-100, Cities, Gospel). A dev leaf page is /__leaf/<bundle>/<profile>,
        // and a plugin that falls back to the PAGE-RELATIVE './assets' asks for /__leaf/<bundle>/assets/…
        // — which the leaf route below answered with its own HTML at HTTP 200. JSON.parse then failed and
        // the map drew with no polygons, no previews, no tables. The built leaf never hits this: its page
        // hands the element assetsBase "../../assets". Serving the pool at every such prefix makes the
        // page-relative default resolve in dev exactly as it does in the tree (/<tree>/assets included).
        const leafAsset = /^\/__leaf\/(?:[^/]+\/){0,3}assets\//.exec(path)
        const assetPrefix = path.startsWith('/assets/') ? '/assets/'
          : path.startsWith('/__plugin-gallery/assets/') ? '/__plugin-gallery/assets/'
          : path.startsWith(`/${treeName}/assets/`) ? `/${treeName}/assets/`
          : leafAsset ? leafAsset[0] : ''
        if (assetPrefix) {
          let rel = ''
          try { rel = decodeURIComponent(path.slice(assetPrefix.length)) } catch { rel = '' }
          if (!rel || rel.split('/').includes('..')) { res.statusCode = 400; return res.end('bad asset path') }
          const file = resolveDevAsset(rel)
          if (!file) return json(res, { error: 'asset not found', asset: rel, looked: [`public/${TREE_NAME}/assets/`, 'data/', 'plugin-designs/*/data/'] }, 404)
          res.statusCode = 200
          res.setHeader('Content-Type', DEV_ASSET_MIME[extname(file).toLowerCase()] || 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-cache')
          return res.end(readFileSync(file))
        }
        // Machine-readable, the same discovery the page renders: the registry (kinds + items,
        // read by the smoke tools) and the manifest-shaped model (what the page fetches live).
        // /__dev-sha — WHICH COMMIT THIS DEV SERVER IS SERVING, read at request time (a shared dev server
        // follows main, so its answer changes under it). "<sha>" or "<sha>+dirty" when the checkout has
        // local edits. Every check aimed at a dev server prints this first, as gates print tree identity.
        if (path === '/__dev-sha') {
          const git = (...a) => spawnSync('git', a, { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim()
          const sha = git('rev-parse', 'HEAD')
          const dirty = git('status', '--porcelain', '--untracked-files=no', '--', 'library', 'plugin-designs', 'internal', 'vite.config.js', 'package.json') ? '+dirty' : ''
          res.statusCode = sha ? 200 : 500
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          return res.end((sha || 'unknown') + dirty + '\n')
        }
        if (path === '/__plugin-gallery/registry.json' || path === '/__plugin-gallery/manifest.json') {
          let reg
          try { reg = discoverSpaRegistry() } catch (e) { return json(res, { error: String(e) }, 500) }
          return json(res, path.endsWith('/manifest.json') ? galleryModel(reg) : reg)
        }
        // ── `/__leaf/<bundle>/<profile>[/<instance>]` — ONE element, nothing else ────────────
        // The dev stand-in for the built tree's <bundle>/<profile>/index.html. The studio's iframe
        // panes point here (see the link() note above); without it they fell through to Vite's SPA
        // fallback and rendered `/` — i.e. the whole studio/gallery — inside every map tab.
        // Deliberately minimal: no chrome, no prose, no gallery. Just the tag, its bundle entry, and
        // the baked token, so what mounts here is the element and only the element.
        if (path.startsWith('/__leaf/')) {
          const parts = path.slice('/__leaf/'.length).split('/').filter(Boolean).map(s => {
            try { return decodeURIComponent(s) } catch { return '' }
          })
          const [bundle, profile, instance] = parts
          // These land in a filesystem-ish URL and in the page's HTML below: LEAF_PART shapes only.
          if (!bundle || !profile || parts.some(s => !LEAF_PART.test(s))) {
            res.statusCode = 400; return res.end('bad leaf path')
          }
          let reg
          try { reg = discoverSpaRegistry() } catch (e) { return json(res, { error: String(e) }, 500) }
          const entry = reg.find(b => b.bundle === bundle)
          if (!entry) {
            // A plugin folder's own /plugin-designs/<x>/index.html arrives here as bundle 'plugin-designs'
            // (leafRewrite reads any <a>/<b>/index.html as <bundle>/<profile>). A fresh reader followed the
            // README's "an index.html for previewing it" to exactly that URL, so name the page that exists.
            const named = reg.find(b => b.bundle === profile)
            const hint = named
              ? `this plugin's own page is /__leaf/${named.bundle}/${named.items?.[0]?.profile || named.bundle}`
              : "a plugin's own page is /__leaf/<plugin>/<profile>; every plugin is listed at /__plugin-gallery/manifest.json"
            return json(res, { error: 'unknown bundle', bundle, hint }, 404)
          }
          const tag = entry.tag
          // One config read for BOTH globals, so the token and the API base can never disagree about
          // which config they came from.
          let leafCfg = {}
          try { leafCfg = readBuildConfig() || {} } catch { leafCfg = {} }
          const leafTok = token || leafCfg.token || ''
          const apiBase = leafCfg.apiBaseUrl || ''
          // profile-config carries the same shape the built leaves pass, so a profile/instance
          // renders the SAME view here as in production rather than the bundle's default.
          // assetsBase too, as the built leaf's BASE_CONFIG carries it ("../../assets" there; root-absolute
          // here, because a /__leaf/ URL's depth differs from the tree's and the pool is served at /assets).
          const leafPc = instance ? { profile, instanceId: instance, assetsBase: '/assets' } : { profile, assetsBase: '/assets' }
          const pc = JSON.stringify(leafPc)
          // The composition tier of THIS profile, read from the same discovery the gallery uses.
          // `nested-elements-mfe` (cap-4) is the StackLayout scroll-stack tier — see the style note
          // below. An unknown profile falls through to the fixed-viewport leaf, the safe default.
          const scrollPage = (entry.items || []).some(
            it => it.profile === profile && it.type === 'nested-elements-mfe')
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          return res.end([
            '<!DOCTYPE html>',
            `<html lang="en"><head><meta charset="UTF-8" /><title>${escHtml(bundle)} · ${escHtml(profile)}</title>`,
            '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
            '<link rel="icon" href="data:,">',
            leafTok ? `<script>window.MAP_TOKEN=${JSON.stringify(leafTok)};</script>` : '',
            // ★ MAP_APP_API_URL IS NOT OPTIONAL — without it every dashboard renders EMPTY in dev.
            // The BUILT leaves bake `window.MAP_APP_API_URL = "https://pray.doxa.life"`; these dev
            // pages baked only the Mapbox token, so the dashboards fell back to a RELATIVE
            // `/api/people-groups/list?...`. Vite answers an unknown path with SPA-fallback HTML at
            // HTTP 200, so the fetch "succeeds", JSON.parse fails or yields nothing, and the facet
            // rail renders ZERO rows with no console error and no error card. Measured 2026-09-22:
            // 8 such 404/fallback requests during one studio sweep. That reads as a broken component
            // and is really a missing global — the worst kind of dev-only divergence, and exactly the
            // four-surface class (see REFERENCE-the-four-surface-contract.md).
            apiBase ? `<script>window.MAP_APP_API_URL=${JSON.stringify(apiBase)};</script>` : '',
            // ── FIXED-VIEWPORT LEAF vs SCROLL-PAGE LEAF ────────────────────────────────────────
            // The BUILT tree makes exactly this distinction (internal/generate-tree.mjs, `scrollPage`)
            // and this dev leaf did NOT — it served the fixed-viewport style to EVERY bundle. That is
            // the whole of BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID-UNDER-THE-DASHBOARD: the three-file fix
            // for BUG-DASHBOARD-CANT-SCROLL-DOWN landed in the built tree only, so the dev URL that
            // actually gets tested was never covered and still traps the composite.
            //
            // WHY `height:100%` ON BODY IS THE TRAP, and why scrollHeight LIES about it. A definite
            // height + `overflow:visible` lets content SPILL (so scrollHeight inflates — measured 3531
            // against a 900 viewport) WITHOUT creating a scrollport, so the viewport has nothing to
            // scroll. The research-dashboard's own inner `overflow:auto` regions then swallow every
            // wheel event. MEASURED 2026-09-22 on this leaf: 12 wheel events of 600px moved the page
            // 0px while 2,631px of content sat below the fold. A geometry check calls that "scrollable";
            // only a real wheel exposes it.
            //
            // A cap-4 composite (nested-elements-mfe) is a StackLayout scroll-stack, so the DOCUMENT
            // must own the scroll: `min-height` (a floor, not a cage) + explicit `overflow-y:auto`,
            // and the element takes its NATURAL height so the page grows and the grid below is
            // reachable. Every other tier keeps the fixed-viewport leaf — a map IS the page.
            scrollPage
              ? '<style>html{height:100%;}html,body{margin:0;padding:0;background:#f3f3f1;}' +
                'body{min-height:100%;overflow-y:auto;}' +
                // min-height in VIEWPORT units, never percent: a percentage resolves against body's
                // auto height and collapses to 0 (BUG-UPG100-NESTED-ELEMENTS-ZERO-HEIGHT). 100dvh
                // depends on no ancestor and stays a floor, so the page can still grow past it.
                `${tag}{display:block;width:100%;min-height:100dvh;}</style>`
              : '<style>html,body{margin:0;padding:0;height:100%;background:#f3f3f1;}' +
                // 100svh (100% as the fallback), not 100vh: a phone's 100vh is taller than the view while the address
                // bar shows, so the page scrolls by the bar and the app seems to resize; --profile-min-h:0 opts out of
                // ProfileLoader's 100dvh floor. The same rule as generate-tree's fixed-viewport leaf.
                `${tag}{display:block;width:100%;height:100%;height:100svh;--profile-min-h:0;}</style>`,
            '</head><body>',
            // tree-base ON THE LEAF TOO — cap-5 shells nested here fetch a manifest of their own.
            // doxa-maps-spa (like plugin-studio) discovers its tabs from the tree's manifest.json and
            // resolves it RELATIVE to its own page when no base is given. On a /__leaf/ URL that
            // resolved to /__leaf/manifest.json and 400'd. Harmless (both shells carry a baked
            // fallback list) but it silently degrades the tab list to the fallback instead of the
            // live 19-bundle tree. Passing the base makes a nested shell see exactly what the top
            // level sees. Elements that ignore tree-base simply drop an unknown attribute.
            `<${tag} tree-base="/__plugin-gallery" profile-config='${pc}'></${tag}>`,
            ownIfTopScript(leafPc),
            `<script type="module" src="/plugin-designs/${bundle}/index.js"></script>`,
            '</body></html>',
          ].filter(Boolean).join('\n'))
        }
        // ── `/` MOUNTS THE PLUGIN STUDIO, NOT THE STAGING GALLERY ────────────────────────────
        // THE DIRECTION (2026-09-22): the dev server opens a Plugin Studio that gives access to all
        // the plugins in one place, without text that takes up space; and the generated staging
        // pages are no longer needed, because the Plugin Studio replaces those index.html files.
        //
        // WHY THIS ROUTE HAD TO EXIST AT ALL. The dev server previously served ONLY the gallery at
        // `/`, and had no route for a bundle leaf — so `bun run dev` could not show the cap-5 studio
        // by any URL. Opening `/` showed plugins wrapped in per-bundle frames behind a wall of
        // explanatory prose, which reasonably read as none of the elements working. They
        // were working; the page was a CHOOSER presenting itself as the product.
        //
        // WHY MOUNT THE TAG RATHER THAN REDIRECT TO A LEAF: plugin-studio is a real cap-5
        // defineCustomElement element, so the honest dev surface is the element itself, loaded
        // through its own index.js — the same path the built bundle takes. That keeps HMR working
        // (Vite transforms the .vue on demand) and keeps registerStrategies/profileModules/Pinia
        // intact, which baking or iframing would bypass.
        //
        // The gallery is NOT deleted — it is still generated for the built tree and is still
        // load-bearing for the manifest. It simply stops being what a developer lands on. It stays
        // reachable at an explicit URL for anyone who wants the bundle index.
        if (path === '/' || path === '/index.html') {
          // Same resolution order the gallery uses: the .env/VITE_MAPBOX_TOKEN value passed into
          // autoSpaDevPlugin(token), else the build config's baked token. readBuildConfig() is
          // called HERE rather than reusing page()'s `cfg` — that const lives inside the page()
          // arrow function, so it is not in scope in this middleware (an earlier version referenced
          // it and the dev server 500'd with "cfg is not defined").
          // One config read for BOTH globals (see the leaf route above for why the API base matters).
          let devCfg = {}
          try { devCfg = readBuildConfig() || {} } catch { devCfg = {} }
          const devTok = token || devCfg.token || ''
          const devApiBase = devCfg.apiBaseUrl || ''
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          return res.end([
            '<!DOCTYPE html>',
            '<html lang="en"><head><meta charset="UTF-8" />',
            '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
            `<title>${TREE_NAME} plugin studio</title>`,
            '<link rel="icon" href="data:,">',
            // The token ladder's baked rung, exactly as the built leaves receive it, so maps paint
            // in dev without anyone appending ?tk=.
            devTok ? `<script>window.MAP_TOKEN=${JSON.stringify(devTok)};</script>` : "",
            // Same reason as the leaf route above: without MAP_APP_API_URL the dashboards nested in
            // the studio fetch a relative /api/... that Vite answers with HTML at 200, so they mount
            // and then show nothing. The value comes from the SAME build config the built leaves use,
            // so dev and built agree by construction rather than by a second hard-coded copy.
            devApiBase ? `<script>window.MAP_APP_API_URL=${JSON.stringify(devApiBase)};</script>` : "",
            // No chrome, no prose: the element fills the viewport. "Without a lot of text garb
            // that takes up so much space" is a layout requirement, so the host page contributes
            // ZERO text — every pixel belongs to the studio element.
            '<style>html,body{margin:0;padding:0;height:100%;background:#f3f3f1;}',
            'plugin-studio{display:block;width:100%;height:100%;height:100svh;--profile-min-h:0;}</style>',
            '</head><body>',
            // tree-base IS REQUIRED IN DEV — without it the studio mounts EMPTY.
            // The studio builds its tab list at runtime by fetching `<base>manifest.json`, and with
            // no base it falls back to '../manifest.json' RELATIVE TO ITS SCRIPT URL. In dev the
            // script is /plugin-designs/plugin-studio/index.js, so that resolves to
            // /plugin-designs/manifest.json — which does not exist. The shell then renders with zero
            // rows: 31 shadow descendants, no nested plugin tags. (Measured exactly that before this
            // line existed; the symptom reads as "no elements in the studio", not as a failed fetch.)
            // The dev server's manifest lives on its own route instead, serving the SAME
            // manifest-shaped model the built tree bakes (19 bundles / 30 profiles), so pointing the
            // studio at it gives dev the same tab list production has.
            '<plugin-studio tree-base="/__plugin-gallery"></plugin-studio>',
            ownIfTopScript(),
            '<script type="module" src="/plugin-designs/plugin-studio/index.js"></script>',
            '</body></html>',
          ].filter(Boolean).join('\n'))
        }
        // The staging gallery, kept but DEMOTED to an explicit opt-in URL.
        if (path !== '/__gallery' && path !== '/__gallery/') return next()
        let html
        try { html = page() }
        catch (e) { console.error(`[plugin-gallery] ${e && e.stack ? e.stack : e}`); return next() }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(html)
      })
    },
  }
}
