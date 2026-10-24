/**
 * embedBase.js — Where THIS bundle's built tree is served from, resolved at runtime.
 *
 * WHY: the built tree (<root>/<bundle>/<bundle>.js + <bundle>/<profile>/index.html …) is
 * dropped onto many hosts — the dev plugin gallery, doxa.life under /js/doxa-maps-build/,
 * any CDN subpath. Share links + embed snippets must point INTO that tree wherever it
 * lands, so profiles declare their embed page TREE-RELATIVE (`<bundle>/<profile>/index.html`
 * or `<bundle>/<profile>/<instance>/index.html`) and this module supplies the tree root.
 * A hardcoded `/js/doxa-maps/…` 404s the moment the tree is served anywhere else.
 *
 * Tree root — derived from the bundle's OWN script URL. Rollup rewrites `import.meta.url`
 * in the IIFE build to `document.currentScript.src` (captured at script start, with a
 * `document.baseURI` fallback), so in a built bundle it is `<treeRoot>/<bundle>/<bundle>.js`
 * and the root is two path segments up. It is trusted ONLY when the last two segments look
 * like `<name>/<name>.js` (the layout generate-tree.mjs emits). In dev (ESM) it is this
 * module's own URL (`…/library/utils/embedBase.js`) and is rejected — the plugin gallery passes
 * a whole `shareUrl` instead.
 *
 * Embed base ladder — resolveEmbedBase(profileConfig):
 *   1. profileConfig.embedBaseUrl   — host-supplied per embed (`profile-config` JSON)
 *   2. window.MAP_EMBED_BASE_URL    — host-supplied page global, set before the IIFE loads
 *   3. bundleTreeRoot()             — derived from the script URL (a dropped tree works anywhere)
 *   4. ''                           — none known; a tree-relative path resolves against the page
 *
 * Share URL ladder — resolveShareUrl({ shareUrl, embedPath, profileConfig }):
 *   1. shareUrl | profileConfig.shareUrl — a WHOLE url from the host wins (plugin gallery deep link)
 *   2. embedPath | profileConfig.shareEmbedPath
 *        absolute http(s)             → passes through
 *        leading '/'                  → legacy root-relative: location.origin + path
 *        otherwise (tree-relative)    → embedBase + '/' + path when a base is known,
 *                                       else resolved against document.baseURI
 *   3. location.origin + location.pathname — the page itself ("Share shares THE MAP")
 *
 * Host usage (inject before the IIFE loads):
 *   <script>window.MAP_EMBED_BASE_URL = 'https://cdn.example.org/maps/doxa-maps';</script>
 *   <script src="https://cdn.example.org/maps/doxa-maps/doxa-simple-map/doxa-simple-map.js"></script>
 *
 * Pure JS, SSR-safe: every window/document access is guarded.
 */

// Evaluated ONCE at module init — inside the IIFE that is script start, while
// document.currentScript still points at the bundle's own <script> tag.
const SCRIPT_URL = import.meta.url

const stripSlashes = (s) => String(s || '').trim().replace(/\/+$/, '')

/**
 * The served root of the built tree, derived from the bundle's own script URL.
 * Returns null when that URL does not look like a built bundle (`…/<name>/<name>.js`),
 * e.g. the dev ESM module URL — never guess from an untrusted layout.
 * @returns {string|null} e.g. "https://doxa.life/js/doxa-maps-build/doxa-maps"
 */
export function bundleTreeRoot() {
  try {
    const href = String(SCRIPT_URL || '').split(/[?#]/)[0]
    // …/<dir>/<file>.js — the dir must equal the file's basename (generate-tree layout).
    const m = href.match(/^(.*)\/([^/]+)\/([^/]+)\.js$/)
    if (!m || m[2] !== m[3]) return null
    return m[1] || null
  } catch {
    return null
  }
}

/**
 * The base URL tree-relative embed pages are joined to (no trailing slash).
 * Ladder: profileConfig.embedBaseUrl → window.MAP_EMBED_BASE_URL → bundleTreeRoot() → ''.
 * @param {object|null} [profileConfig]  the parsed profile-config (already unref'd)
 * @returns {string}
 */
export function resolveEmbedBase(profileConfig) {
  const fromConfig = profileConfig?.embedBaseUrl
  if (typeof fromConfig === 'string' && fromConfig.trim()) return stripSlashes(fromConfig)
  if (typeof window !== 'undefined') {
    const fromHost = window.MAP_EMBED_BASE_URL
    if (typeof fromHost === 'string' && fromHost.trim()) return stripSlashes(fromHost)
  }
  return stripSlashes(bundleTreeRoot() || '')
}

/**
 * Where the SHARED asset pool (tables/, boundaries/) is served from — no trailing slash.
 *
 * ★ THE BUG THIS EXISTS TO END (measured 2026-09-23). Eleven profiles across six bundles each wrote
 * the same line: `profileConfig?.assetsBase || './assets'`. That default is correct on a standalone
 * leaf page, where the generated host passes `../../assets` and the tree root is two segments up. It
 * is WRONG the moment the element is nested in a cap-5 shell, because a RELATIVE path resolves
 * against the SHELL's page, not the child's. Proven in a browser against the built tree:
 *
 *     leaf  /doxa-maps/gospel-resources/resources-map/index.html ....... 0 failed requests
 *     shell /doxa-maps/doxa-maps-spa/doxa-maps-spa/index.html .......... 404 …/doxa-maps-spa/doxa-maps-spa/assets/tables/gospel-by-country.json
 *                                                                        404 …/doxa-maps-spa/doxa-maps-spa/assets/boundaries/world-adm0.geojson
 *
 * ★ WHY NO BUILD-TIME GATE COULD SEE IT. `'./assets'` is a VALID STRING in both hosts; only the host
 * decides what it resolves to. check-composite-srcs proves a nested `src:` exists on disk, which is a
 * different question. This class is visible only from a browser, in the shell, which is exactly the
 * two-host rule: a defect invisible in one host and fatal in the other.
 *
 * THE FIX IS IN THE CHILD, NOT THE SHELL. The shell already forwards `treeBase` and says so in its
 * own comment ("a nested shell cannot guess it, and guessing is what produced the original 404
 * class") — but no asset-reading profile ever read `treeBase`, so that lesson never reached them.
 * Teaching each child to derive its own absolute base keeps the shell generic: a NEW bundle that
 * fetches assets works nested on day one, with no edit to doxa-maps-spa.vue.
 *
 * Ladder (first hit wins):
 *   1. profileConfig.assetsBase — ABSOLUTE or root-relative only. A host that knows the answer wins,
 *      but a RELATIVE value is deliberately NOT trusted: that is the broken input this fixes, and
 *      honouring it would reintroduce the defect through the very config meant to cure it.
 *   2. profileConfig.treeBase + '/../assets'  — what the cap-5 shell already passes down.
 *   3. bundleTreeRoot() + '/../assets'        — derived from this bundle's own script URL, so a tree
 *      dropped on any host resolves correctly with no configuration at all.
 *   4. './assets'                             — the historical default; correct on a leaf page and
 *      the only sane answer when nothing above is knowable (a hand-written host). Under the dev
 *      server it is '/assets', where the dev server serves the pool.
 *
 * @param {object|null} [profileConfig]  the parsed profile-config (already unref'd)
 * @returns {string}
 */
export function resolveAssetsBase(profileConfig) {
  const fromConfig = profileConfig?.assetsBase
  if (typeof fromConfig === 'string' && fromConfig.trim()) {
    const v = stripSlashes(fromConfig)
    // Absolute (http://…) or root-relative (/…) is a real answer; './assets' or '../../assets' is
    // the ambiguous input whose meaning depends on the host, which is the whole problem.
    if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v
  }

  // The tree root is <root>/<bundle>/<bundle>.js, and the asset pool lives INSIDE the tree at
  // <root>/assets — generate-tree.mjs stages it there precisely so a dropped folder is
  // self-contained ("staged N runtime asset(s) -> doxa-maps/assets").
  //
  // ⚠ THIS SAID SIBLING AND COMPUTED <root>/../assets, WHICH IS ONE LEVEL TOO HIGH. The comment
  // justified it as "why the leaf page's generated value is '../../assets' (two up from
  // <tree>/<bundle>/<profile>/)" — but two up from <tree>/<bundle>/<profile>/ is <tree>, not the
  // tree's PARENT. The arithmetic was off by one and the prose made it look deliberate.
  //
  // MEASURED 2026-09-25 by publishing to the live catalog and reverting:
  //   leaf  .../doxa-maps/my-upg-100-list/upg-100-list/index.html + '../../assets'
  //                                     -> /plugin-assets/doxa-maps/assets   200  (what the leaf means)
  //   code  root '/plugin-assets/doxa-maps' + '/../assets'
  //                                     -> /plugin-assets/assets             404  (what this returned)
  // The UPG-100 map went from "195 polys · 27/27 zones · 2107 pins" to
  // "⚠ boundary fetch 404 world-adm0.geojson" — a basemap with none of our data on it.
  //
  // ⚠ AND IT IS INVISIBLE LOCALLY, which is why every gate stayed green. The dev web-root has BOTH
  // public/assets (a sibling) and public/doxa-maps/assets (inside), each holding the boundaries, so
  // the sibling path resolves on 127.0.0.1. The catalog publishes app/doxa-maps ONLY — there is no
  // sibling to find. A local run cannot distinguish the two answers; only the live prefix can.
  const root = stripSlashes(profileConfig?.treeBase || '') || stripSlashes(bundleTreeRoot() || '')
  if (root) {
    try {
      const base = typeof document !== 'undefined' ? document.baseURI : undefined
      return stripSlashes(new URL(root + '/assets', base).href)
    } catch {
      // A non-URL treeBase (a bare path) still yields a usable string by plain joining.
      return stripSlashes(root + '/assets')
    }
  }

  // Under the dev server (Vite: import.meta.env.DEV; false in every build) the pool is served at the
  // ROOT, /assets, and a dev page's own URL (/__leaf/<bundle>/<profile>) is not tree-shaped, so the
  // page-relative default missed it. The built tree keeps './assets' (position-independent).
  if (import.meta.env && import.meta.env.DEV) return '/assets'
  return './assets'
}

/**
 * The URL the Share button shows, copies and iframes. See the header for the ladder.
 * @param {object} [opts]
 * @param {string} [opts.shareUrl]       explicit whole url (beats everything)
 * @param {string} [opts.embedPath]      the profile's embed page — tree-relative, root-relative or absolute
 * @param {object|null} [opts.profileConfig]  the parsed profile-config (already unref'd)
 * @returns {string}
 */
/**
 * A TREE-RELATIVE leaf as an ABSOLUTE url — for a caller that must supply a whole url up front.
 *
 * ★ WHY THIS EXISTS: tier 1 of resolveShareUrl's ladder returns its input VERBATIM, by design, because
 * a host handing over a whole url has already decided. A composite that BUILDS a tier-1 url therefore
 * takes on tier 2's job, and two of them did it like this:
 *
 *     base ? base + '/' + leaf : leaf          // <- relative when no base resolves
 *
 * On any host where the tree root cannot be derived from the script url — a dev server, an ESM build,
 * a tree served from a path that does not match `<name>/<name>.js` — base is '' and that expression
 * yields a BARE RELATIVE PATH. Tier 1 then returns it unresolved, and the reader copies
 * `research-map-plus-grid/research-map-plus-grid/index.html` from a page at http://127.0.0.1:5192/,
 * a link that works on no other site.
 *
 * ★ AND IT LOOKS RIGHT IN THE ONE PLACE PEOPLE CHECK. A relative share LINK works when clicked, because
 * the browser resolves it against the current page; it is the EMBED that breaks, because an
 * <iframe src="…"> on a partner's site resolves against THEIR page. So the failure is invisible exactly
 * where it is tested and visible only where it ships.
 *
 * This is tier 2's resolution, made available to tier-1 builders: base when known, otherwise resolved
 * against document.baseURI, which yields the runtime origin. Never returns a relative string in a
 * browser.
 *
 * @param {string} leaf   tree-relative path, e.g. `<bundle>/<profile>/index.html`
 * @param {Object} [profileConfig]
 * @returns {string} an absolute url wherever a document exists; the leaf unchanged under SSR
 */
export function absoluteEmbedUrl(leaf, profileConfig = null) {
  const rel = String(leaf || '').trim().replace(/^\.\//, '')
  if (!rel) return ''
  if (/^https?:\/\//i.test(rel)) return rel
  const base = stripSlashes(resolveEmbedBase(profileConfig) || '')
  if (base) return base + '/' + rel
  if (typeof document !== 'undefined') {
    try { return new URL(rel, document.baseURI).href } catch { /* fall through */ }
  }
  return rel
}

/**
 * The tree's PUBLIC address, for the Share menu's Embed tab (no trailing slash). Its URL, Iframe and JavaScript codes
 * point here, so an embed follows the stable releases served there, never a dev server or the page's own host.
 * Ladder: profileConfig.shareBaseUrl → window.MAP_SHARE_BASE_URL → the build's shareBaseUrl (vite.doxa-maps-build-
 * config.json, baked as __DOXA_SHARE_BASE__) → '' (unset: the Embed tab keeps the tree the bundle was loaded from).
 * @param {object|null} [profileConfig]  the parsed profile-config (already unref'd)
 * @returns {string}
 */
export function resolvePublicBase(profileConfig) {
  // https only (an http base would give mixed-content codes on an https partner page), plus a local test server
  const ok = (v) => typeof v === 'string' && /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/i.test(v.trim())
  const fromConfig = profileConfig?.shareBaseUrl
  if (ok(fromConfig)) return stripSlashes(fromConfig)
  if (typeof window !== 'undefined' && ok(window.MAP_SHARE_BASE_URL)) return stripSlashes(window.MAP_SHARE_BASE_URL)
  // typeof-guarded: a build or a test that defines no __DOXA_SHARE_BASE__ reads '' instead of throwing
  return stripSlashes(typeof __DOXA_SHARE_BASE__ === 'string' ? __DOXA_SHARE_BASE__ : '')
}

export function resolveShareUrl({ shareUrl, embedPath, profileConfig } = {}) {
  const cfg = profileConfig || null
  const hasWindow = typeof window !== 'undefined'

  // (1) a whole url supplied by the host — the plugin gallery's own deep link, a CMS page, …
  const whole = shareUrl || cfg?.shareUrl
  if (typeof whole === 'string' && whole.trim()) return whole.trim()

  // (2) the profile's embed page
  const path = String(embedPath || cfg?.shareEmbedPath || '').trim()
  if (path) {
    if (/^https?:\/\//i.test(path)) return path
    if (path.startsWith('/')) return hasWindow ? window.location.origin + path : path
    const base = resolveEmbedBase(cfg)
    const rel = path.replace(/^\.\//, '')
    if (base) return base + '/' + rel
    if (typeof document !== 'undefined') {
      try { return new URL(rel, document.baseURI).href } catch { /* fall through */ }
    }
    return rel
  }

  // (3) the page itself — each map builds to a self-contained page.
  return hasWindow ? window.location.origin + window.location.pathname : ''
}
