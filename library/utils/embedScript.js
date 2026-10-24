/**
 * embedScript — load another bundle's script and wait for its element to register.
 *
 * ★ WHAT AN APP SHELL DOES. A capability-5 plugin nests other plugins, so it needs three things:
 * work out the tree root it was served from, load a bundle's `.js` exactly once, and wait for the
 * custom element to actually exist before mounting it. Both shells in this repo — the Research
 * Gallery (`doxa-maps-spa`) and the Plugin Studio (`plugin-studio`) — had their own copy of all
 * three, identical in code (DEDUP-AUDIT.md, 2026-09-28: 33 lines, the only cross-plugin cluster
 * that is identical, closes over nothing, and spans one owner's plugins).
 *
 * Moved verbatim; the comments below are the originals, because each records a measurement.
 *
 * ★ "EXACTLY ONCE" WAS ONLY EVER TRUE INSIDE ONE BUNDLE, AND THAT IS THE BUG THIS FILE NOW FIXES.
 * An earlier version of this header claimed that sharing `_loaded` here meant "two shells on one
 * page ... now the second one reuses the first's promise". That was wrong, and the reason is the
 * packaging, not the code: every plugin ships as a self-contained IIFE with `inlineDynamicImports`,
 * so THIS MODULE IS COMPILED SEPARATELY INTO EACH BUNDLE and a module-scoped `const _loaded = {}`
 * is one cache PER BUNDLE, not per page. MEASURED on origin/main's shipped tree 2026-09-28:
 * 11 built bundles each carry their own copy.
 *
 * What that cost, and why it was invisible: every entry file guards its registration with
 * `if (!customElements.get(tag)) customElements.define(tag, …)`, so the second load did NOT throw.
 * It fetched from the HTTP cache (so the network panel looked innocent), then EXECUTED THE WHOLE
 * BUNDLE a second time — a second Vue, a second vue-i18n, a second pinia, ~375 KiB gzip of work for
 * doxa-research-map — and only at the very end declined to define the tag it had just built
 * everything for. Nothing warned. The page simply ran twice as much script as it needed.
 * Worse than the waste: if the two URLs are different VERSIONS of the same plugin, whichever
 * executed first owns the tag and the other is silently discarded.
 *
 * So the cache now lives on the PAGE (`globalThis`), which is the only scope that matches the
 * claim. See `registry()` for why the key is versioned.
 */

/**
 * The page-wide registry. Bundles cannot share a module, but they all share one global object.
 *
 * ★ THE KEY CARRIES A VERSION ON PURPOSE. A page can mix bundles built weeks apart, so an old
 * bundle and a new one must never read each other's registry through a shape either of them does
 * not expect. A changed shape therefore gets a NEW key, and the two generations fall back to a
 * cache each — today's behaviour, which merely wastes work — instead of one of them misreading the
 * other's and skipping a load that never happened. Separate is recoverable; corrupt is not.
 *
 * `globalThis` rather than `window` so this file is loadable under node, where the gates run it.
 */
const REGISTRY_KEY = '__dxMapsScriptRegistry1'

function registry() {
  const g = typeof globalThis !== 'undefined' ? globalThis : self
  return g[REGISTRY_KEY] || (g[REGISTRY_KEY] = { loaded: Object.create(null), owners: Object.create(null) })
}

/**
 * Resolve to the absolute URL the browser will actually request.
 *
 * ★ THIS IS WHAT MAKES TWO SHELLS AGREE. They do not pass the same string: StackLayout anchors a
 * sibling bundle to the tree root first (resolveBundleSrc), VerticalTabsLayout passes the row's src
 * untouched, and a host page may configure an absolute CDN URL. `/dx-maps/x/x.js` and
 * `https://host/dx-maps/x/x.js` are one file and must be one cache entry, so the KEY is the
 * resolved href — not the string the caller happened to hold.
 */
function absoluteHref(url) {
  try {
    if (typeof document !== 'undefined' && document.baseURI) return new URL(url, document.baseURI).href
    if (typeof location !== 'undefined' && location.href) return new URL(url, location.href).href
  } catch (_) { /* a non-URL string (a test stub, a bare name): key it as given */ }
  return url
}

/**
 * A <script> for this exact file that somebody else already put in the document.
 *
 * ★ WHY ADOPT ONE INSTEAD OF IGNORING IT. The registry only helps bundles that contain this
 * version of this file. A page can also carry a bundle built BEFORE it, or a host page that writes
 * its own <script> tag for a plugin — neither will ever touch `registry().loaded`. Reading the DOM
 * is the one signal that is true regardless of who did the loading.
 *
 * We cannot know whether a foreign tag has finished executing (a script that already ran will never
 * fire another onload), so adopting it resolves immediately. That is SAFE HERE FOR A CHECKED
 * REASON, not by assumption: every caller in this repo follows loadScriptOnce with a wait on the
 * custom element itself — doxa-maps-spa.vue:1405 and plugin-studio.vue:1138/1178 chain
 * whenTagDefined(), StackLayout.vue:244 and VerticalTabsLayout.vue:736 chain their own
 * waitForDefine() — and that wait, with its timeout, is the authoritative answer to "can I mount
 * this yet". Resolving early hands the question to the component that can actually answer it.
 * A NEW CALLER MUST KEEP THAT PAIRING; loadScriptOnce alone has never been proof the tag exists,
 * which is the point the dev-server note below was written for.
 */
function existingScriptFor(href) {
  if (typeof document === 'undefined' || !document.querySelectorAll) return null
  const tags = document.querySelectorAll('script[src]')
  for (let i = 0; i < tags.length; i++) if (tags[i].src === href) return tags[i]
  return null
}

/**
 * Load a bundle exactly once per URL PER PAGE; resolves after its script has executed.
 *
 * ★ A CLASSIC SCRIPT FIRES onload AND THEN FAILS, for a dev-server bundle. Measured 2026-09-22:
 *   pointing a plain <script> at a dev entry (/plugin-designs/<bundle>/index.js, a real ES MODULE)
 *   fires onload — so a loader watching onload reports SUCCESS — and only THEN throws "Cannot use
 *   import statement outside a module" as an ASYNC page error. The tag is never defined,
 *   document.createElement(tag) yields an inert HTMLUnknownElement, and the pane sits empty while its
 *   own state reads 'ready'. onload is structurally incapable of seeing this, so it is not a usable
 *   success signal by itself — which is why every mount below also waits on whenTagDefined().
 *
 *   The built tree ships IIFEs, where a classic tag is correct, so this only ever bites under the dev
 *   server — exactly the surface a developer works on. Rule: a rooted /plugin-designs/ entry (or any
 *   .../index.js) is a dev ES module; everything else is a built IIFE.
 *   MEASURED a second time, independently, on stack-demo's dev leaf 2026-09-22 (StackLayout, before it
 *   used this file): 0 failed requests, and yet customElements.get('research-dashboard-map') === false
 *   with 0 rows rendered. VerticalTabsLayout's private copy LACKED this rule until it moved here, so a
 *   bundle nested through it on the dev server never defined its tag.
 *
 *   ⚠ The module test runs against the URL THE CALLER GAVE, not the resolved href: `/plugin-designs/…`
 *   is root-relative and absolutising it first would destroy the very prefix being matched.
 *
 * An empty url is a no-op: a <script src=""> would re-fetch the page itself.
 *
 * SRI is optional (attrs.integrity). An adopted foreign tag keeps whatever integrity IT was given —
 * we do not restate ours on someone else's element, because the bytes it loaded were already
 * checked, or already not, before we ever saw it.
 */
export function loadScriptOnce(url, attrs) {
  if (!url) return Promise.resolve()
  const reg = registry()
  const href = absoluteHref(url)
  if (reg.loaded[href]) return reg.loaded[href]
  if (existingScriptFor(href)) return (reg.loaded[href] = Promise.resolve())
  reg.loaded[href] = new Promise((ok, fail) => {
    const s = document.createElement('script')
    s.src = url
    if (/^\/plugin-designs\//.test(url) || /\/index\.js(\?|$)/.test(url)) s.type = 'module'
    if (attrs) for (const k in attrs) if (attrs[k]) s.setAttribute(k, attrs[k])
    s.onload = () => ok()
    s.onerror = () => { delete reg.loaded[href]; fail(new Error('failed to load ' + url)) }
    document.head.appendChild(s)
  })
  return reg.loaded[href]
}

/**
 * Record which bundle a tag came from, and say so when two disagree.
 *
 * ★ THIS IS A DIAGNOSTIC, NOT A GUARD, and deliberately so. `customElements.define` is one-shot per
 * page: by the time a second bundle gets here the first has already won, and there is nothing left
 * to prevent — the damage was done at build time by two bundles shipping the same element. What was
 * missing is that NOBODY SAID SO. The guarded define (`if (!customElements.get(tag))`) swallows the
 * collision so completely that a page can render the wrong version of a plugin and look healthy.
 *
 * Call it after the tag is confirmed defined, with the URL it was loaded from. Same URL twice is the
 * normal case (two shells nesting the same leaf) and is silent.
 */
export function claimTag(tag, url) {
  if (!tag) return
  const reg = registry()
  const href = url ? absoluteHref(url) : ''
  if (!href) return
  const prev = reg.owners[tag]
  if (!prev) { reg.owners[tag] = href; return }
  if (prev === href) return
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[dx-maps] <' + tag + '> is shipped by two bundles on this page: ' + prev +
      ' defined it, ' + href + ' executed and was discarded. The page is running the first one.')
  }
}

// Wait for a tag to ACTUALLY register. loadScriptOnce resolving is not proof the element exists (see
// above), and a module script's define() runs only after its import graph settles, so the tag can
// appear a tick or two after onload. customElements.whenDefined is the browser's own authoritative
// answer; the timeout turns a never-registered tag into THIS tab's error overlay rather than a silent
// blank pane that claims to be ready.
export function whenTagDefined(tag, ms) {
  if (typeof customElements === 'undefined') return Promise.resolve()
  if (customElements.get(tag)) return Promise.resolve()
  return Promise.race([
    customElements.whenDefined(tag),
    new Promise((_, fail) => setTimeout(() => {
      if (customElements.get(tag)) return
      fail(new Error('<' + tag + '> never registered (bundle loaded but defined no element)'))
    }, ms || 15000))
  ])
}

/**
 * The tree root this shell was served from, with a trailing slash, or '' when it cannot be known.
 *
 * ⚠ READS document.currentScript, so it is only valid AT MODULE EVALUATION TIME. Call it once at the
 * top of an entry file (`const TREE_BASE = deriveTreeBase()`), never later — `currentScript` is null
 * once the script has finished executing, and a late call silently returns ''.
 */
export function deriveTreeBase() {
  try {
    const cur = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || ''
    if (!cur) return ''
    // Strip the trailing "<bundle>/<bundle>.js" → the tree root, with trailing slash.
    const root = cur.replace(/[^/]+\/[^/]+$/, '')
    return root.replace(/\/+$/, '') + '/'
  } catch { return '' }
}
