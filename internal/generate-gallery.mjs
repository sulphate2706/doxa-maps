/**
 * generate-gallery.mjs — THE plugin gallery: one generator, two modes.
 * (No shebang on purpose: vite.config.js imports this module through Vite's config bundler,
 * which prepends a shim to every bundled file — a shebang below line 1 is a syntax error there.)
 *
 *   renderGallery(model, { mode: 'build' })   public/__gallery/index.html — ARCHIVED beside the
 *                                             root, written by `bun run gallery` (last step of
 *                                             `bun run build`) from public/<tree>/manifest.json.
 *   renderGallery(model, { mode: 'dev' })     what `bun run dev` serves at /__gallery — the same
 *                                             page over a manifest-shaped model of plugin-designs/
 *                                             (see internal/plugin-gallery/dev-plugin.mjs).
 *
 * ★ THIS IS NO LONGER THE ROOT PAGE (2026-09-22). In BOTH trees `/` now mounts <plugin-studio>,
 * the cap-5 developer studio; this gallery is the archived bundle index at /__gallery. The module
 * stays because it is load-bearing, not for the page alone: the dev plugin imports renderGallery()
 * and readBuildConfig(), and it computes the manifest-shaped model both trees render.
 *
 * public/ holds assets/ (data), <tree>/ (the bundle folders + manifest.json), the generated root
 * page (the studio host, written by internal/generate-tree.mjs) and __gallery/ — this page, which
 * lists every bundle → profile → instance the manifest declares and
 * mounts the chosen one. It is GENERATED — never hand-edited — as a single static file: inline
 * CSS, inline vanilla JS, every path relative, so the same file works from any static host,
 * under a subpath (the website serves it at /embed/doxa-maps-build/index.html) and from file://.
 *
 * At runtime the page fetches <tree>/manifest.json so it stays correct when bundles change; a
 * compact copy of the manifest is baked in as the fallback (file://, or the fetch fails). Embed
 * snippets are re-derived from the manifest fields with the template generate-tree uses; this
 * script checks the derivation against every manifest snippet and bakes any that differ, so the
 * fallback is exact without carrying the snippets twice.
 *
 * The chosen map mounts exactly like its leaf page: same peer engine (Mapbox, or MapLibre for a
 * provider:'maplibre' instance), same profile-config (assetsBase, dataSource, instanceId or the
 * instance props), window.MAP_APP_API_URL, and the same token ladder — profile-config tk →
 * ?tk= on this page's URL → the paste-once localStorage token → baked token → window.MAP_TOKEN_URL
 * → the configured tokenUrl → same-origin /api/maps/token → ask once.
 *
 * Deep link: #/<bundle>/<profile>[/<instance>]. Actions: Open page (the leaf page), Copy embed
 * (the manifest's embed.iframe / embed.script).
 *
 * What mode 'dev' changes — and nothing else: the loader imports the bundle's dev entry
 * (scriptUrl = /plugin-designs/<bundle>/index.js, an ES module Vite serves) instead of adding an
 * IIFE script tag; the live model is fetched from the dev route (<tree> = __plugin-gallery); and
 * the header carries the composability ladder with its "?" popovers (kind explanations + the
 * "Start here" primer). The popovers stay out of the built page on purpose: they add ~8 KB of
 * text to a 22 KB page and explain the source tree, which a visitor of the served root never sees.
 *
 * Usage:  node internal/generate-gallery.mjs      (`bun run gallery` — last step of `bun run build`)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PROFILE_TIER, TYPE_DISPLAY, detectProfileType } from './plugin-gallery/discover.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Composition tier → capability number (5 = app-shell/nested-mfe-spa … 1 = single-element).
// The plugin studio is itself the nested-mfe-spa (capability 5) — the reserved app-shell key.
// cap = 5 - PROFILE_TIER (nested-mfe-spa:0→5 · nested-elements-mfe:1→4 · monolithic:2→3 ·
// parameterized:3→2 · single:4→1). Unknown → 1 (single, the safe floor).
export const CAP_OF = (type) => (PROFILE_TIER[type] != null ? 5 - PROFILE_TIER[type] : 1)

// Build-mode: the manifest carries no composition tier, so read it from source the way the
// dev discovery does (explicit <profile>.meta.json → an *.instances.json means parameterized →
// single). Returns { "<bundle>/<profile>": "<machine key>" }. Pure best-effort: a missing tree
// or unreadable folder just yields {} and every profile falls back to capability 1.
export function readSourceTiers(appDir = join(ROOT, 'plugin-designs')) {
  const out = {}
  if (!existsSync(appDir)) return out
  let dirs = []
  try { dirs = readdirSync(appDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { return out }
  for (const bundle of dirs) {
    const dir = join(appDir, bundle)
    let files = []
    try { files = readdirSync(dir) } catch { continue }
    const hasInstances = files.some((f) => /\.instances\.json$/i.test(f))
    for (const f of files) {
      if (!f.endsWith('.vue')) continue
      const profile = f.replace(/\.vue$/, '')
      try {
        const t = detectProfileType(dir, profile, '', [], hasInstances)
        out[bundle + '/' + profile] = t.type
      } catch { /* leave unlisted → capability 1 */ }
    }
  }
  return out
}

// Same fields the tree generator bakes into every leaf page (vite.doxa-maps-build-config.json).
export function readBuildConfig() {
  let cfg = {}
  try { cfg = JSON.parse(readFileSync(join(ROOT, 'vite.doxa-maps-build-config.json'), 'utf8')) } catch { /* defaults */ }
  const str = (k) => (typeof cfg[k] === 'string' ? cfg[k].trim() : '')
  let tokenUrl = str('tokenUrl')
  if (!tokenUrl) {
    try {
      const src = JSON.parse(readFileSync(join(ROOT, 'library/api/sources.json'), 'utf8'))
      const v = src?._meta?.mapboxTokenUrl || src?.mapboxTokenUrl
      if (typeof v === 'string' && v.trim()) tokenUrl = v.trim()
    } catch { /* fall through */ }
  }
  return {
    name: str('name') || TREE_NAME,
    title: str('displayTitle') || TREE_NAME,
    tokenUrl: tokenUrl || 'window.MAP_TOKEN_URL',
    token: str('token'),
    apiBaseUrl: str('apiBaseUrl').replace(/\/+$/, ''),
    assetsBaseUrl: str('assetsBaseUrl').replace(/\/+$/, ''),
    qaWidget: cfg.qaWidget !== false,
  }
}

// ── Shared with the page (injected by source, so Node and the browser run the same code) ──
// The embed snippets exactly as generate-tree writes them into the manifest: profile → iframe +
// script, instance → iframe only. b/p/x are the compact records below.
function snip(b, p, x) {
  var u = (x || p).u, tag = (x && x.e) || p.e || b.e[0] || b.b
  var r = { iframe: '<iframe src="' + u + '?utm_source=YOUR_SOURCE" width="100%" height="600" style="border:none;border-radius:12px;" allowfullscreen></iframe>' }
  if (!x) r.script = '<script src="' + b.s + '"' + (b.i ? ' integrity="' + b.i + '" crossorigin="anonymous"' : '') + '><\/script>\n<' + tag + " profile-config='" + JSON.stringify({ profile: p.p, tk: 'YOUR_MAPBOX_TOKEN', utmSource: 'YOUR_SOURCE' }) + "'></" + tag + '>'
  return r
}
// Manifest → compact registry: [{b,s,i,e,p:[{p,e,u,d,em?,in?:[{id,t,a,pr,e,u,em?}]}]}].
// lean = drop every embed snippet the page can re-derive with snip() (the baked fallback);
// the live manifest keeps its snippets verbatim.
// tierMap (build mode): { "<bundle>/<profile>": "<machine key>" } from readSourceTiers, used
// when the manifest profile carries no `type`. c = capability number (1–5); the SPA groups
// and sorts by it (5 → 1). Dev mode passes profiles that already carry `sp.type`.
export function compact(m, lean, tierMap) {
  tierMap = tierMap || {}
  // Composition tier → capability number, self-contained so the browser copy of this function
  // (shipped via src(compact) and re-run on the live manifest) needs no import. 5 = app-shell
  // (nested-mfe-spa) … 1 = single. The model may bake `sp.type`; else tierMap resolves it.
  var PT = { 'nested-mfe-spa': 0, 'nested-elements-mfe': 1, 'monolithic': 2, 'parameterized': 3, 'single': 4 }
  var capFor = function (t) { return PT[t] != null ? 5 - PT[t] : 1 }
  return (m.bundles || []).map(function (src) {
    var b = { b: src.bundle, s: src.scriptUrl || '', i: src.integrity || '', e: src.elements || [], p: [] }
    b.p = (src.profiles || []).map(function (sp) {
      var type = sp.type || tierMap[src.bundle + '/' + sp.profile] || 'single'
      var c = capFor(type)
      var p = { p: sp.profile, e: sp.element || '', u: sp.iframeUrl || '', d: sp.description || '', c: c }
      var em = sp.embed || {}, d = snip(b, p, null)
      if (!lean || em.iframe !== d.iframe || em.script !== d.script) p.em = em
      var ins = (sp.instances || []).map(function (sx) {
        var x = { id: sx.id, t: sx.title || sx.id, a: sx.apiBaseUrl || '', pr: sx.props || {}, e: sx.element || '', u: sx.iframeUrl || '' }
        var xe = sx.embed || {}, xd = snip(b, p, x)
        if (!lean || xe.iframe !== xd.iframe) x.em = xe
        return x
      })
      if (ins.length) p.in = ins
      return p
    })
    return b
  })
}
// Function source for the page. The dev server loads this module through Vite's config bundler,
// whose printer may turn the '<\/script>' literal above back into '</script>' — inside an inline
// script that would end the element early, so the escape is restored here (a no-op under node).
const src = (fn) => fn.toString().replace(/<\/script/gi, '<\\/script')

// ── mode 'dev' only: the composability ladder + its "?" popovers ────────────────────────────
// Vocabulary is the validated set from documentation/reference.md "Profile types": head words are
// established terms (custom element, preset, multi-view, composite, app shell); the coined words
// stay as a.k.a. Popover strings are HTML (innerHTML) — tags are escaped.
const LADDER_CSS = String.raw`:root{--acc:#1a73e8}@media(prefers-color-scheme:dark){:root{--acc:#64b5f6}}
.ladder{position:relative;margin-left:auto;display:flex;align-items:center;gap:6px;white-space:nowrap}
.rung{display:inline-flex;align-items:center;gap:4px}.rname{font:500 12px/1 ui-monospace,Menlo,monospace}
.arrow{color:var(--mut);font-size:12px;padding:0 1px}
.q{width:18px;height:18px;padding:0;border-radius:50%;font:700 11px/1 system-ui,sans-serif;color:var(--mut);background:var(--bg);display:inline-grid;place-items:center}
.start{font:600 10.5px/1 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--acc);background:var(--bg);border-radius:999px;padding:4px 9px;margin-right:4px}
.q:hover,.q[aria-expanded=true],.start:hover,.start[aria-expanded=true]{color:var(--acc);border-color:var(--acc);background:var(--bg)}
.explain{position:absolute;top:calc(100% + 8px);right:0;width:420px;max-width:calc(100vw - 32px);max-height:70vh;overflow:auto;z-index:40;background:var(--bg);border:1px solid var(--bd);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.14);padding:12px 14px;font-size:13px;line-height:1.45;text-align:left;white-space:normal}
.explain h3{margin:0 0 5px;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.explain h4{margin:8px 0 3px;font-size:13px}
.explain .tier{font:700 10px/1 system-ui,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:var(--mut)}
.explain p{margin:0 0 6px}.explain .aka{font-size:11.5px;color:var(--mut);margin:-2px 0 6px}
.explain .how{margin:0 0 6px;font-size:12.5px}.explain .how summary{cursor:pointer;color:var(--acc);font-weight:600;font-size:12px}.explain .how p{margin:6px 0 0;color:var(--mut)}
.explain .ex{color:var(--mut);font-size:12px}
@media(max-width:1280px){.ladder{display:none}}
`
const LADDER_HTML = '<nav class="ladder" id="ladder" aria-label="Composability ladder" v-pre></nav>'
const LADDER_JS = String.raw`<script>
(function () {
  var PRIMER = [
    { title: 'Element',
      def: 'A custom HTML tag this repo invents, such as &lt;doxa-map&gt;: the browser learns it once, then you can paste it into any page as often as you like. Each pasted tag is one live copy, called an instance. (People also say &quot;web component&quot;.)',
      how: 'The bundle index.js turns the shared ProfileLoader into an element class with defineCustomElement and registers the tag once with customElements.define.',
      ex: '&lt;doxa-map profile-config=&#39;{&quot;profile&quot;:&quot;doxa-simple-map&quot;}&#39;&gt;&lt;/doxa-map&gt;' },
    { title: 'App profile (mounting file)',
      def: 'One flat .vue file in plugin-designs/&lt;bundle&gt;/ that defines a whole map app — the main component of that map. The settings written on the tag (profile-config) name which app profile to load, and the shared ProfileLoader picks it. In class-and-object terms: the element class is the class, each tag on a page is an instance, and the app profile is the screen that instance loads.',
      how: 'Most repos need one such main file per app. ${TREE_NAME} builds hundreds of maps from one shared library, so every map gets its own app profile — the folder plugin-designs/ is where they sit. The five kinds on this ladder are the five shapes those files come in.',
      ex: 'plugin-designs/doxa-simple-map/doxa-simple-map.vue' }
  ];
  var LADDER = [
    { label: 'single-element', tier: 4, title: 'Single element', aka: 'single',
      def: 'One app profile, one map: paste its tag into any page, once or many times, and set it up right there in profile-config. The smallest kind and the default — no preset table, no tabs, no nested maps.',
      how: 'A flat .vue with no &lt;profile&gt;.meta.json beside it and no *.instances.json in the bundle folder. Machine key: single.',
      ex: 'cities-internet/connectivity-map.vue → &lt;cities-internet-map&gt; · gospel-resources/resources-map.vue' },
    { label: 'preset-element', tier: 3, title: 'Preset element', aka: 'parameterized · prop-many-elements',
      def: 'One app profile plus a small table of named presets (&lt;name&gt;.instances.json). Each row is one ready-made map with its settings baked in and gets its own embed page and sidebar entry — same code, same tag.',
      how: 'The bundle folder holds &lt;name&gt;.instances.json ({&quot;instances&quot;:[{id,title,props}]}); the build writes one embed page per row at &lt;bundle&gt;/&lt;profile&gt;/&lt;id&gt;/index.html. Machine key: parameterized. Not this if the versions need different code — make another app profile.',
      ex: 'doxa-simple-map.vue + simple-map.instances.json → Prayer / Engagement / Adoption' },
    { label: 'multi-view-element', tier: 2, title: 'Multi-view element', aka: 'monolithic · monolithic-mfe',
      def: 'One app profile that holds several screens you switch between — tabs or steps — all written in one .vue and shown as one element, one screen at a time. Keeping them in one file is on purpose.',
      how: 'Declared, never guessed: &lt;profile&gt;.meta.json {&quot;type&quot;:&quot;monolithic&quot;} (or &quot;multi-view-element&quot;); the .vue owns its own switcher. Not this if the pieces are other app profiles (composite) or all panels show at once (single).',
      ex: 'doxa-research-map/research-map.vue — six tabs in one &lt;doxa-research-map&gt;' },
    { label: 'composite-element', tier: 1, title: 'Composite element', aka: 'nested-elements-mfe',
      def: 'An app profile whose template places the maps of other app profiles together — stacked or side by side, such as a map and a poster wall — and ships the result as one new element. One tag embeds the whole set.',
      how: 'Declared: &lt;profile&gt;.meta.json {&quot;type&quot;:&quot;nested-elements-mfe&quot;,&quot;composes&quot;:[…]} (or &quot;composite-element&quot;); the .vue creates each child tag with its own profile-config on the pane layout (layouts/pane-wrapper). Not this if the screens are written inside one file (multi-view).',
      ex: 'my-upg-100-list/upg-100-mfe.vue — Map pane + Prayer Lists pane, one Share button' },
    { label: 'app-shell', tier: 0, title: 'App shell', aka: 'nested-mfe-spa · container application · root config · host',
      def: 'The outer frame of a whole app — sidebar, header, navigation — that loads any of the other four kinds inside it and switches between them without a page reload. The only rung that is a page, not an element: what a visitor actually opens.',
      how: 'Today both shells are HTML pages, not .vue app profiles: layouts/app-wrapper-material/index.html and this plugin gallery (internal/generate-gallery.mjs, one generator for the dev root and public/index.html). Machine key nested-mfe-spa (or app-shell) is reserved for a future .vue shell.',
      ex: 'this plugin gallery · the Doxa Maps SPA' }
  ];
  var ladder = document.getElementById('ladder'), openQ = null;
  var pop = document.createElement('div'); pop.className = 'explain'; pop.hidden = true; pop.setAttribute('role', 'dialog');
  function closePop() { pop.hidden = true; if (openQ) { openQ.setAttribute('aria-expanded', 'false'); openQ = null } }
  function showPop(btn, html) { if (openQ === btn) { closePop(); return } closePop(); openQ = btn; btn.setAttribute('aria-expanded', 'true'); pop.innerHTML = html; pop.hidden = false }
  function howBlock(t) { return '<details class="how"><summary>For builders — how to recognise it</summary><p>' + t + '</p></details>' }
  function kindHtml(r) { return '<h3>' + r.title + ' <span class="tier">tier ' + r.tier + ' · ' + r.label + '</span></h3><p>' + r.def + '</p><div class="aka">a.k.a. ' + r.aka + '</div>' + howBlock(r.how) + '<div class="ex">e.g. ' + r.ex + '</div>' }
  function primerHtml() { return '<h3>Start here <span class="tier">the two words every rung uses</span></h3>' + PRIMER.map(function (p) { return '<h4>' + p.title + '</h4><p>' + p.def + '</p>' + howBlock(p.how) + '<div class="ex">e.g. ' + p.ex + '</div>' }).join('') }
  var start = document.createElement('button'); start.className = 'start'; start.type = 'button'; start.textContent = 'Start here'; start.setAttribute('aria-expanded', 'false');
  start.setAttribute('aria-label', 'What is an element? What is an app profile?'); start.onclick = function (e) { e.stopPropagation(); showPop(start, primerHtml()) }; ladder.appendChild(start);
  LADDER.forEach(function (r, i) {
    if (i) { var a = document.createElement('span'); a.className = 'arrow'; a.textContent = '→'; ladder.appendChild(a) }
    var rung = document.createElement('span'); rung.className = 'rung';
    var nm = document.createElement('span'); nm.className = 'rname'; nm.textContent = r.label;
    var q = document.createElement('button'); q.className = 'q'; q.type = 'button'; q.textContent = '?'; q.setAttribute('aria-label', 'What is a ' + r.title.toLowerCase() + '?'); q.setAttribute('aria-expanded', 'false');
    q.onclick = function (e) { e.stopPropagation(); showPop(q, kindHtml(r)) };
    rung.appendChild(nm); rung.appendChild(q); ladder.appendChild(rung);
  });
  ladder.appendChild(pop);
  document.addEventListener('click', function (e) { if (!ladder.contains(e.target)) closePop() });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop() });
})();
</script>
`

/**
 * The whole page from a manifest-shaped model (schema doxa-maps-manifest@1: bundles → profiles →
 * instances, with scriptUrl / iframeUrl / embed / integrity). Pure: no I/O, no globals.
 *
 * @param {object} model   the manifest (build) or the dev model (dev-plugin.mjs galleryModel)
 * @param {object} opts    mode 'build' | 'dev'; title; tree — the folder the live manifest is
 *                         fetched from (<tree>/manifest.json) and that relative refs resolve
 *                         against (build: the tree name; dev: the route prefix, refs absolute);
 *                         tokenUrl / token / apiBaseUrl / assetsBaseUrl / qaWidget — the build
 *                         config fields every leaf page bakes (readBuildConfig)
 */
export function renderGallery(model, opts = {}) {
  const { mode = 'build', title = TREE_NAME, tree = TREE_NAME, tokenUrl = 'window.MAP_TOKEN_URL', token = '', apiBaseUrl = '', assetsBaseUrl = '', qaWidget = true, tierMap = {} } = opts
  const dev = mode === 'dev'
  const baked = compact(model, true, tierMap)
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c')
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  // The one line the two modes load a bundle with: the built IIFE (SRI-checked) vs the dev entry.
  const loader = dev
    ? `function bundle(b) { return import(rel(b.s)) }`
    : `function bundle(b) { return once(rel(b.s), 'js', b.i ? { integrity: b.i, crossOrigin: 'anonymous' } : {}) }`

  return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="data:,">
<style>
:root{--bg:#fff;--bg2:#f6f7f9;--bg3:#eceef2;--bd:#e2e5ea;--fg:#15181d;--mut:#667085;--err:#d13c3c}
@media(prefers-color-scheme:dark){:root{--bg:#111318;--bg2:#181b21;--bg3:#232730;--bd:#2b3038;--fg:#eef0f3;--mut:#9aa3b2;--err:#ff7b7b}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;height:100vh}
header{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--bd)}
header b{font-size:15px}.n{color:var(--mut);font-size:12px}
#menu{display:none;margin-left:auto}
button,.btn{font:inherit;font-size:12px;padding:5px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg2);color:var(--fg);cursor:pointer;text-decoration:none;white-space:nowrap}
button:hover,.btn:hover{background:var(--bg3)}
.body{flex:1 1 auto;display:flex;min-height:0}
nav{flex:0 0 270px;overflow:auto;border-right:1px solid var(--bd);padding:6px 0 20px}
.gh{padding:12px 14px 4px;font-weight:600;font-size:13px;display:flex;justify-content:space-between;gap:8px}.gh span{color:var(--mut);font-weight:400}
.row{display:block;width:100%;text-align:left;border:0;border-radius:0;background:none;padding:6px 14px;font-size:13px;line-height:1.3;white-space:normal}
.row.in{padding-left:28px}.row code{display:block;font-size:11px;color:var(--mut)}
.row:hover{background:var(--bg2)}.row[aria-current=true]{background:var(--bg3);font-weight:600}
main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;padding:10px 12px 12px;gap:8px}
.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bar .t{flex:1 1 auto;min-width:0}.bar b{font-size:15px}.s{display:block;font-size:12px;color:var(--mut)}
code{font-family:ui-monospace,Menlo,monospace}
#embed{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--bd);border-radius:8px;background:var(--bg2)}
#embed label{font-size:12px;color:var(--mut);display:flex;justify-content:space-between;align-items:center}
#embed textarea{width:100%;height:58px;font:11px/1.35 ui-monospace,Menlo,monospace;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--fg);padding:6px;resize:vertical}
#slot{flex:1 1 auto;position:relative;min-height:240px;border:1px solid var(--bd);border-radius:10px;overflow:hidden;background:var(--bg2)}
#slot>*{position:absolute;inset:0;width:100%;height:100%;display:block;border:0}
.hint{display:grid;place-items:center;padding:20px;text-align:center;color:var(--mut);font-size:13px}
.hint.err{color:var(--err)}
.hint input{font:12px ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);width:min(320px,70vw)}
/* Capability tiers (5 → 1): the vertical-tab sections of the nested-mfe-spa sidebar. */
.tier{padding:12px 14px 2px;display:flex;align-items:baseline;gap:7px}
.tier .cap{font:700 10px/1 system-ui,sans-serif;letter-spacing:.5px;color:var(--bg);background:var(--mut);border-radius:999px;padding:3px 7px}
.tier .tl{font-weight:600;font-size:12px}.tier .td{color:var(--mut);font-size:11px;margin-left:auto}
#app{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
[hidden]{display:none!important}
@media(max-width:700px){.body{flex-direction:column}nav{flex:0 0 auto;max-height:45vh;border-right:0;border-bottom:1px solid var(--bd)}#menu{display:inline-block}}
${dev ? LADDER_CSS : ''}</style>
</head>
<body>
<!-- The ${TREE_NAME} nested-mfe-spa (capability 5, the reserved app-shell): a Vue single-page app
     whose sidebar is the composability ladder rendered as vertical tabs (capability 5 → 1),
     each row mounting that plugin's custom element in the one slot. This SAME page is the
     served studio root (public/index.html) AND the Capacitor mobile-app entry (webDir: public).
     Vue drives the shell; the map elements mount imperatively into #slot (they own their DOM). -->
<div id="app">
<header>
  <b>${esc(title)}</b><span class="n">{{ countLabel }}</span>${dev ? LADDER_HTML : ''}
  <button id="menu" type="button" aria-controls="nav" aria-expanded="true" @click="navOpen = !navOpen">Maps</button>
</header>
<div class="body">
  <nav id="nav" aria-label="Maps · sorted by capability 5 → 1" v-show="navOpen">
    <div class="grp" v-for="grp in groups" :key="grp.cap">
      <div class="tier"><span class="cap">CAP {{ grp.cap }}</span><span class="tl">{{ grp.label }}</span><span class="td">{{ grp.rows.length }}</span></div>
      <!-- data-k EXPOSES THE ROW IDENTITY TO THE DOM. A Vue :key is a RECONCILIATION HINT and is NOT
           rendered as an attribute — a distinction that had smoke:gallery failing on a working page.
           That gate reads row.dataset.k to confirm a deep link selected the row it asked for; with no
           such attribute it read undefined and reported "deep link resolved to undefined".
           MEASURED 2026-09-22: data-k appeared ZERO times in this generator and zero times in the
           built page, while the gallery itself mounts its elements correctly — a false RED, which is
           as corrosive as a false green because it gets the gate switched off.
           Asserting on the rendered LABEL instead would be worse: it couples a machine check to
           display text, so renaming a profile would break the gate. Identity belongs in the DOM.
           NOTE: this markup lives inside a TEMPLATE LITERAL — no backticks anywhere in this comment,
           or the literal ends here and the rest of the file is parsed as code. -->
      <button v-for="r in grp.rows" :key="r.key" :data-k="r.key" type="button" class="row" :class="{ in: r.kind === 'instance' }"
              :aria-current="String(activeKey === r.key)" @click="go(r.key)">
        <span>{{ r.label }}</span><code>&lt;{{ r.tag }}&gt;</code>
      </button>
    </div>
  </nav>
  <main>
    <div class="bar">
      <div class="t"><b>{{ ttl }}</b><span class="s">{{ sub }}</span></div>
      <a class="btn" :href="openHref" target="_blank" rel="noopener" v-show="openHref">Open page</a>
      <button type="button" v-show="hasSel" :aria-expanded="String(embedOpen)" @click="embedOpen = !embedOpen">Copy embed</button>
    </div>
    <div id="embed" v-show="embedOpen && hasSel">
      <label>iframe embed <button type="button" @click="copyText(embedIframe, $event.target)">Copy</button></label>
      <textarea readonly :value="embedIframe"></textarea>
      <div v-show="embedScript"><label>script embed <button type="button" @click="copyText(embedScript, $event.target)">Copy</button></label>
      <textarea readonly :value="embedScript"></textarea></div>
    </div>
    <div id="slot" ref="slot"><div class="hint">Choose a map from the list.</div></div>
  </main>
</div>
</div>
<script>
(function () {
  var TREE = ${json(tree)}, TOKEN_SRC = ${json(tokenUrl)}, BAKED_TOKEN = ${json(token)}, API_BASE = ${json(apiBaseUrl)}, ASSETS_BASE = ${json(assetsBaseUrl)}, QA = ${json(qaWidget)};
  var DEFAULT_TOKEN_URL = '/api/maps/token';
  var BAKED = ${json(baked)};
  var snip = ${src(snip)};
  var compact = ${src(compact)};
  // Peer engines, the same tags every leaf page carries; loaded once, before the bundle.
  var PEERS = {
    mapbox: { css: ['https://api.mapbox.com/mapbox-gl-js/v3.24.0/mapbox-gl.css', 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.css'],
              js: ['https://api.mapbox.com/mapbox-gl-js/v3.24.0/mapbox-gl.js', 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.min.js'] },
    maplibre: { css: ['https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.css'], js: ['https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js'] }
  };
  var $ = function (id) { return document.getElementById(id) };
  // The map custom elements mount imperatively into this slot (they own their own DOM and must
  // not be re-rendered by Vue); the Vue app writes its ref here after mount. Falls back to the
  // element id so the loader works even before the app boots.
  var slotEl = function () { return (window.__spa && window.__spa.slot) || $('slot') };
  var TIER_MAP = ${json(tierMap)};   // "<bundle>/<profile>" → composition tier, for live re-compact
  // THIS PAGE'S OWN DIRECTORY. A host may serve the folder at /…/doxa-maps-build (no trailing
  // slash); the browser would then resolve every relative ref against the PARENT directory and
  // drop the folder name, so bundles 404. Derive the directory explicitly and build refs from it.
  var BASE = (function () {
    var p = location.pathname || '/';
    return /\.[a-z0-9]+$/i.test(p) ? p.replace(/[^/]*$/, '') : p.replace(/\/*$/, '') + '/';
  })();
  // ★ THE TREE ROOT AS ONE ABSOLUTE URL — derive it ONCE, never re-join TREE by hand.
  // TREE is PAGE-RELATIVE and its value differs per surface ('../doxa-maps' in the built tree,
  // '__plugin-gallery' in dev), so a bare TREE + '/x' join is only accidentally right. It was right
  // in the built tree (where the '../' climbs out of /__gallery/) and WRONG in dev, where it asked
  // for /__gallery/__plugin-gallery/manifest.json. MEASURED 2026-09-22, both servers running:
  //     dev   /__gallery/__plugin-gallery/manifest.json ... 404   (what the page asked for)
  //     dev   /__plugin-gallery/manifest.json ............. 200   (what it meant)
  //     built /doxa-maps/manifest.json .................... 200
  // rel() never had the bug because it always anchored to BASE. Resolving through the URL parser
  // (rather than string-joining) also collapses the '../' properly for BOTH surfaces at once.
  // Resolve TREE *against* the page's own directory — do NOT string-join it onto BASE. TREE may be
  // ROOTED ('/__plugin-gallery' in dev), and 'BASE + TREE' would glue it on to yield
  // /__gallery//__plugin-gallery, which 404s just as surely as the original bug. Passing BASE as
  // the base URL lets the URL parser apply the right rule per shape: a rooted TREE replaces the
  // path, a '../' TREE climbs out of /__gallery/, and a bare name resolves beside it.
  var TREE_URL = new URL(TREE, new URL(BASE, location.href)).href.replace(/\/+$/, '');
  // ASSETS live INSIDE the tree (public/<tree>/assets), which is what every leaf page points at:
  // a leaf at /<tree>/<bundle>/<profile>/ bakes assetsBase "../../assets" -> /<tree>/assets. So
  // anchor to TREE_URL, not to this PAGE's directory.
  // This was BASE + 'assets' — correct only while the gallery WAS the root page, where the two
  // coincide. Since the gallery moved to /__gallery it asked for /__gallery/assets/... MEASURED
  // on the built tree with the page at /__gallery/:
  //     /__gallery/assets/vendor/vue/vue.global.prod.js ... 404   (what the page asked for)
  //     /doxa-maps/assets/vendor/vue/vue.global.prod.js ... 200   (where it lives)
  // It degraded quietly rather than blanking — loadVue() falls back to the jsDelivr CDN — so the
  // page still worked while silently losing the portable/offline/no-CDN property the vendored
  // copy exists to provide. The dev server passes assetsBaseUrl explicitly, so this is the
  // built-tree half of the same fix its comment already documents.
  var ASSETS = ASSETS_BASE || TREE_URL + '/assets';
  var REG = BAKED, active = null, seq = 0, loaded = {}, fetchedToken = '';
  var narrow = function () { return window.matchMedia && window.matchMedia('(max-width:700px)').matches };

  // Manifest refs are relative to the tree root; this page sits one level above it. Refs are
  // anchored to BASE (above) so they resolve the same with or without a trailing slash.
  function rel(u) { return /^([a-z]+:|\/)/i.test(u) ? u : BASE + TREE + '/' + u.replace(/^\.\//, '') }
  function qp(name) { try { return new URLSearchParams(location.search).get(name) || '' } catch (e) { return '' } }
  function hint(msg, err) { var slot = slotEl(); var d = document.createElement('div'); d.className = 'hint' + (err ? ' err' : ''); d.textContent = msg; slot.innerHTML = ''; slot.appendChild(d); return d }
  function assign(t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k] } return t }

  function once(url, kind, attrs) {
    if (loaded[url]) return loaded[url];
    loaded[url] = new Promise(function (ok, fail) {
      var el = document.createElement(kind === 'css' ? 'link' : 'script');
      if (kind === 'css') { el.rel = 'stylesheet'; el.href = url } else { el.src = url; assign(el, attrs || {}) }
      el.onload = function () { ok() }; el.onerror = function () { delete loaded[url]; fail(new Error('failed to load ' + url)) };
      document.head.appendChild(el);
    });
    return loaded[url];
  }
  function peer(provider) {
    var p = PEERS[provider] || PEERS.mapbox, chain = Promise.resolve();
    p.css.forEach(function (u) { once(u, 'css') });
    p.js.forEach(function (u) { chain = chain.then(function () { return once(u, 'js') }) });
    return chain;
  }
  ${loader}

  // Resolve a deep-link key ("<bundle>/<profile>[/<instance>]") against the live registry.
  function find(parts) {
    for (var i = 0; i < REG.length; i++) if (REG[i].b === parts[0]) {
      var b = REG[i];
      for (var j = 0; j < b.p.length; j++) if (b.p[j].p === parts[1]) {
        var p = b.p[j];
        if (parts.length < 3) return { b: b, p: p, x: null };
        for (var k = 0; k < (p.in || []).length; k++) if (p.in[k].id === parts[2]) return { b: b, p: p, x: p.in[k] };
      }
    }
    return null;
  }

  // Same profile-config the leaf page bakes (profile page: profile + dataSource + instanceId;
  // instance page: its props), plus the host-supplied share URL of that leaf page.
  function mount(b, p, x, tag) {
    var cfg = x ? assign({ assetsBase: ASSETS }, x.pr) : { profile: p.p, dataSource: 'pray-tools', instanceId: b.b + '-' + p.p, assetsBase: ASSETS };
    if (QA) cfg.qa = true;
    cfg.shareUrl = new URL(rel((x || p).u), location.href).href;
    // ★ HAND THE TREE ROOT DOWN — an element that fetches the manifest cannot guess it from here.
    // A cap-5 shell derives its tree root from location.pathname when nothing is passed, which is
    // right on its own <tree>/<bundle>/<profile>/ leaf page and WRONG in this gallery, where the
    // path belongs to the PAGE, not the element. doxa-maps-spa's relative fallback is '../', so
    // from /__gallery/ it asked for /manifest.json. MEASURED by the smoke:gallery gate:
    //     ✗ doxa-maps-spa/doxa-maps-spa   data: 404 http://localhost:5173/manifest.json
    // The SPA's OWN nested-mount path already sets both of these for exactly this reason; this
    // gallery was the one mount path that never learned the lesson. Set both, because not every
    // element reads profile-config (an element mounting its own SFC has no ProfileLoader above it
    // and takes tree-base as a prop); an element that declares neither ignores both.
    cfg.treeBase = TREE_URL;
    window.MAP_APP_API_URL = (x && x.a) || API_BASE;
    var provider = cfg.provider === 'maplibre' ? 'maplibre' : 'mapbox', my = ++seq;
    hint(provider === 'maplibre' ? 'loading map…' : 'loading token…');
    peer(provider).then(function () { return bundle(b) }).then(function () {
      if (my !== seq) return;
      resolveToken(cfg, provider === 'maplibre', function (token) {
        if (my !== seq) return;
        try {
          var c = token ? assign({}, cfg, { tk: token }) : cfg;
          var el = document.createElement(tag); el.setAttribute('profile-config', JSON.stringify(c));
          el.setAttribute('tree-base', TREE_URL);   // see cfg.treeBase above — both, for both kinds of element
          var slot = slotEl(); slot.innerHTML = ''; slot.appendChild(el);
        } catch (e) { hint(e && e.message ? e.message : String(e), true) }
      });
    }).catch(function (e) { if (my === seq) hint('Failed to load ' + b.b + ': ' + (e && e.message ? e.message : e), true) });
  }

  // Mapbox token resolution — the leaf pages' ladder, in precedence order:
  //   1. prop (config.tk)  2. ?tk= on this page's URL (stored once for every page of the tree)
  //   3. baked token — then, none found, a token ENDPOINT is fetched, first answer wins:
  //   4. window.MAP_TOKEN_URL  5. configured TOKEN_SRC  6. same-origin /api/maps/token — else ask once.
  function resolveToken(cfg, tokenFree, done) {
    if (tokenFree) return done('');
    var stored = ''; try { stored = localStorage.getItem('MAPS_STAGING_TK') || '' } catch (e) {}
    var urlTk = qp('tk'); if (urlTk) { try { localStorage.setItem('MAPS_STAGING_TK', urlTk) } catch (e) {} }
    var directToken = cfg.tk || urlTk || stored || BAKED_TOKEN || fetchedToken;
    if (directToken) return done(directToken);
    function askToken(prefix) {
      var d = hint('', true);
      d.innerHTML = (prefix ? '<div></div>' : '') + '<div>map needs a Mapbox token — <input id="tkIn" type="password" placeholder="paste pk.… (stays in this browser)"> <button id="tkGo" type="button">use it</button></div>';
      if (prefix) d.firstChild.textContent = prefix;
      $('tkGo').onclick = function () { var v = ($('tkIn').value || '').trim(); if (!v) return; try { localStorage.setItem('MAPS_STAGING_TK', v) } catch (e) {} done(v) };
    }
    var candidates = [];
    function addCandidate(u) { if (u && candidates.indexOf(u) === -1) candidates.push(u) }
    addCandidate(window.MAP_TOKEN_URL);
    addCandidate(TOKEN_SRC && TOKEN_SRC !== 'window.MAP_TOKEN_URL' ? TOKEN_SRC : '');
    addCandidate(DEFAULT_TOKEN_URL);
    function extractToken(data) { if (typeof data === 'string') return data.trim(); if (data && typeof data === 'object') return data.token || data.tk || data.accessToken || ''; return '' }
    function fetchToken(i, errors) {
      if (i >= candidates.length) return askToken('Token fetch failed from ' + candidates.join(', ') + ' — set window.MAP_TOKEN_URL or pass ?tk=. (' + errors.join(' | ') + ')');
      var url = candidates[i];
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
        return (r.headers.get('content-type') || '').indexOf('json') !== -1 ? r.json() : r.text();
      }).then(function (data) {
        var tk = extractToken(data); if (!tk) throw new Error(url + ' → no token in response');
        fetchedToken = tk; done(tk);
      }).catch(function (e) { errors.push(e && e.message ? e.message : String(e)); return fetchToken(i + 1, errors) });
    }
    fetchToken(0, []);
  }

  function copyText(text, btn) {
    var ok = function () { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t }, 1200) };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () {}); else {
      try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); ok() } catch (e) {}
    }
  }

  // ── The capability ladder for the sidebar headings (5 → 1), reader-facing names ──
  var CAP_LABEL = { 5: 'App shell · nested-mfe-spa', 4: 'Composite element', 3: 'Multi-view element', 2: 'Preset element', 1: 'Single element' };
  // REG → tab groups keyed by capability, most-composed first (5 → 1). Each group lists every
  // profile (and its preset instances) as one row; a bundle contributes rows to the tier of each
  // profile it holds, so one bundle can appear under several capability headings.
  function toGroups() {
    var byCap = {};
    REG.forEach(function (b) {
      (b.p || []).forEach(function (p) {
        var cap = p.c || 1, tag = p.e || b.e[0] || b.b;
        (byCap[cap] = byCap[cap] || []).push({ key: b.b + '/' + p.p, kind: 'profile', label: p.p, tag: tag, bundle: b.b });
        (p.in || []).forEach(function (x) {
          byCap[cap].push({ key: b.b + '/' + p.p + '/' + x.id, kind: 'instance', label: x.t, tag: x.e || tag, bundle: b.b });
        });
      });
    });
    return [5, 4, 3, 2, 1].filter(function (c) { return byCap[c] && byCap[c].length }).map(function (c) {
      return { cap: c, label: CAP_LABEL[c] || ('capability ' + c), rows: byCap[c] };
    });
  }

  function bootVue(Vue) {
    var app = Vue.createApp({
      data: function () {
        return {
          groups: toGroups(), activeKey: '', navOpen: true, embedOpen: false,
          ttl: 'Choose a map', sub: '', openHref: '', hasSel: false, embedIframe: '', embedScript: ''
        };
      },
      computed: {
        countLabel: function () {
          var nb = REG.length, np = 0, ni = 0;
          REG.forEach(function (b) { np += (b.p || []).length; (b.p || []).forEach(function (p) { ni += (p.in || []).length }) });
          return nb + ' bundles · ' + np + ' profiles · ' + ni + ' instances';
        }
      },
      methods: {
        go: function (key) { location.hash = '#/' + key.split('/').map(encodeURIComponent).join('/') },
        copyText: copyText,
        rebuild: function (m) { if (m) { try { REG = compact(m, false, TIER_MAP) } catch (e) { REG = BAKED } } this.groups = toGroups(); this.route(); },
        route: function () { var h = (location.hash || '').replace(/^#\/?/, ''); if (h) this.select(h); },
        select: function (key) {
          var parts = key.split('/').map(function (s) { try { return decodeURIComponent(s) } catch (e) { return s } });
          var hit = find(parts); this.activeKey = parts.join('/');
          if (!hit) { this.ttl = 'No such map'; this.sub = key; this.openHref = ''; this.hasSel = false; this.embedOpen = false; hint('No such map: ' + key, true); return; }
          var b = hit.b, p = hit.p, x = hit.x, tag = (x && x.e) || p.e || b.e[0] || b.b;
          this.ttl = x ? x.t : p.p; this.sub = b.b + ' · <' + tag + '>' + (p.d ? ' · ' + p.d : '');
          this.openHref = rel((x || p).u); this.hasSel = true; this.embedOpen = false;
          var em = x ? (x.em || snip(b, p, x)) : (p.em || snip(b, p, null));
          this.embedIframe = em.iframe || ''; this.embedScript = em.script || '';
          if (narrow()) this.navOpen = false;
          mount(b, p, x, tag);
        }
      },
      mounted: function () {
        var self = this;
        window.__spa = { slot: this.$refs.slot, app: this };
        window.addEventListener('hashchange', function () { self.route() });
        try { window.matchMedia('(max-width:700px)').addEventListener('change', function (e) { if (!e.matches) self.navOpen = true }) } catch (e) {}
        // Live manifest first (the page stays right when bundles change); baked copy is the fallback.
        if (typeof fetch === 'function' && location.protocol !== 'file:') {
          fetch(TREE_URL + '/manifest.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null })
            .then(function (m) { self.rebuild(m) }, function () { self.route() });
        } else { self.route(); }
      }
    });
    app.config.compilerOptions.isCustomElement = function () { return true }; // map tags are custom elements
    app.mount('#app');
  }

  // Vue drives the shell (the nested-mfe-spa). Self-hosted first (portable / offline / no-CDN),
  // then a CDN fallback; if neither loads, degrade to a plain rendered list so the page never
  // blanks. once() resolves the tree-relative ASSETS path the same way every leaf page does.
  function loadVue() {
    if (window.Vue) return Promise.resolve(window.Vue);
    var local = ASSETS + '/vendor/vue/vue.global.prod.js';
    var cdn = 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js';
    return once(local, 'js').then(function () { return window.Vue }, function () {
      return once(cdn, 'js').then(function () { return window.Vue });
    });
  }
  loadVue().then(function (Vue) {
    if (Vue) bootVue(Vue);
    else fallbackRender();
  }).catch(function () { fallbackRender(); });

  // No-Vue degrade: render the same capability-sorted list with plain DOM so a map is still
  // reachable (parse-safe, dependency-free). Rare — Vue is vendored in the tree.
  function fallbackRender() {
    var host = $('app'); if (!host) return;
    function paint() {
      var nav = host.querySelector('#nav'); if (!nav) return;
      nav.innerHTML = '';
      toGroups().forEach(function (g) {
        var h = document.createElement('div'); h.className = 'tier'; h.textContent = 'CAP ' + g.cap + ' · ' + g.label; nav.appendChild(h);
        g.rows.forEach(function (r) {
          var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'row' + (r.kind === 'instance' ? ' in' : '');
          btn.textContent = r.label; btn.onclick = function () { location.hash = '#/' + r.key.split('/').map(encodeURIComponent).join('/') };
          nav.appendChild(btn);
        });
      });
    }
    function route() {
      var h = (location.hash || '').replace(/^#\/?/, ''); if (!h) return;
      var parts = h.split('/').map(function (s) { try { return decodeURIComponent(s) } catch (e) { return s } });
      var hit = find(parts); if (hit) mount(hit.b, hit.p, hit.x, (hit.x && hit.x.e) || hit.p.e || hit.b.e[0] || hit.b.b); else hint('No such map: ' + h, true);
    }
    window.__spa = { slot: $('slot') };
    if (typeof fetch === 'function' && location.protocol !== 'file:') {
      fetch(TREE_URL + '/manifest.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null })
        .then(function (m) { if (m) { try { REG = compact(m, false, TIER_MAP) } catch (e) { REG = BAKED } } paint(); route(); }, function () { paint(); route(); });
    } else { paint(); route(); }
    window.addEventListener('hashchange', route);
  }
})();
</script>
${dev ? LADDER_JS : ''}</body>
</html>
`
}

// ── CLI: the ARCHIVED gallery, public/__gallery/index.html ──────────────────────────────────
//
// ★ THE ROOT PAGE IS THE STUDIO NOW; THE GALLERY IS ARCHIVED BESIDE IT (2026-09-22).
// THE DIRECTION: back up and ARCHIVE what is old instead of editing it. What is needed is a
// functional Plugin Studio with every plugin working, not the old staging index.html pages that
// get in the way.
//
// The BUILT tree now behaves exactly like the DEV server (internal/plugin-gallery/dev-plugin.mjs,
// which made this move first): `/` mounts <plugin-studio>, and the gallery stays reachable at the
// explicit /__gallery for anyone who wants a bundle index. Identical routes in both trees is the
// point — a developer who learns `/` in dev must not find a different product in the built tree.
//
// ARCHIVED, NOT DELETED — deliberately. This module is NOT dead code and must not be removed:
// it also exports renderGallery()/readBuildConfig(), which the dev plugin imports, and it computes
// the manifest-shaped model. Deleting it breaks `bun run dev` and `bun run build`. So the page it
// writes simply MOVES one level down; nothing about how it is built changes.
//
// WHY `tree` GAINS A '../': the gallery's runtime refs (rel() and the two manifest fetches) are
// RELATIVE to the page. Moving the page from public/index.html into public/__gallery/index.html
// puts it one level deeper, so the same string must climb back out to reach public/<tree>/.
// Without this the archived page fetches /__gallery/doxa-maps/manifest.json and renders EMPTY —
// the identical failure mode the studio hit in dev when its tree-base was missing.
function main() {
  const CFG = readBuildConfig()
  const manifestPath = join(ROOT, 'public', CFG.name, 'manifest.json')
  if (!existsSync(manifestPath)) { console.error(`[generate-gallery] missing ${manifestPath} — run \`bun run tree\` first`); process.exit(1) }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const tierMap = readSourceTiers()   // "<bundle>/<profile>" → composition tier (the manifest carries none)
  const html = renderGallery(manifest, { mode: 'build', title: CFG.title, tree: '../' + CFG.name, tokenUrl: CFG.tokenUrl, token: CFG.token, apiBaseUrl: CFG.apiBaseUrl, assetsBaseUrl: CFG.assetsBaseUrl, qaWidget: CFG.qaWidget, tierMap })
  const baked = compact(manifest, true, tierMap)
  const nProfiles = baked.reduce((n, b) => n + b.p.length, 0)
  const nInstances = baked.reduce((n, b) => n + b.p.reduce((k, p) => k + (p.in ? p.in.length : 0), 0), 0)
  const nOverrides = baked.reduce((n, b) => n + b.p.reduce((k, p) => k + (p.em ? 1 : 0) + (p.in || []).filter(x => x.em).length, 0), 0)
  // ARCHIVED OUT OF public/ (decision, card BUILD-OUTPUT-IS-ONE-FOLDER): public/ holds only the
  // output folder + README.md, and the studio at <tree>/index.html is the front page. The last
  // generated copy is kept in the umbrella's _qa-cycle/archive/. This still renders on request, into a
  // directory you name — never into public/.
  const oi = process.argv.indexOf('--out')
  const outDir = oi >= 0 && process.argv[oi + 1] ? resolve(process.argv[oi + 1]) : null
  if (!outDir) {
    console.log('[generate-gallery] ARCHIVED — not written. The gallery is no longer part of the build or of public/;')
    console.log('  the Plugin Studio (<tree>/index.html) is the front page. To render it anyway: bun run gallery -- --out <dir>')
    return
  }
  if (outDir === resolve(ROOT, 'public') || outDir.startsWith(resolve(ROOT, 'public') + '/')) {
    console.error('[generate-gallery] refusing to write into public/ — it holds only the output folder.'); process.exit(1)
  }
  const dir = outDir
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), html)
  console.log(`[generate-gallery] ${dir}/index.html (ARCHIVED rendering) — ${(html.length / 1024).toFixed(1)} KB · ${baked.length} bundle(s) · ${nProfiles} profile(s) · ${nInstances} instance(s) · ${nOverrides} embed snippet(s) baked verbatim (the rest re-derive)`)
}
// Runs only as a script; importing it (the dev plugin does) has no side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
