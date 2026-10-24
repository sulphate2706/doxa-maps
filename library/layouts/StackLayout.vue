<!--
  StackLayout.vue — a brand-neutral, shared SCROLL-STACK layout for grouping elements top-to-bottom.

  ★ WHY THIS EXISTS (the second shared layout, alongside VerticalTabsLayout). VerticalTabsLayout shows
    ONE element at a time (tabs, fixed-viewport panes). StackLayout does the OPPOSITE: it renders ALL of
    its elements STACKED VERTICALLY, each at its NATURAL height, so the whole thing grows the page and the
    HOST page scrolls through them — exactly how a normal host page flows.
    Use it to GROUP two (or more) elements on top of each other and embed the group on a page you scroll.

  ★ SAME NESTED-ELEMENT CONTRACT as VerticalTabsLayout (so a shell composes other element-plugins). Pass
    :sections="[{ key, title?, sub?, element, src?, attrs? }]". For each section:
      element : a custom-element tag to render, e.g. "research-dashboard-map"
      src?    : a bundle URL to inject (once, deduped) if `element` isn't registered yet
      attrs?  : a map of attributes/props set on the element BEFORE it mounts ("props in advance")
      title?  : an optional section heading rendered above the element (omit for a bare stack)
    A section can INSTEAD carry no `element` and use the #section-<key> slot (or the default slot) for
    host-rendered content — `element` is an ALTERNATIVE, not a replacement.

  ★ EAGER, NOT LAZY (the deliberate difference from tabs). Because the whole point is to scroll through
    everything, every section's element mounts on FIRST RENDER (not on activation). If you only want the
    visible ones to load, that's the tabs layout's job; a scroll-stack shows all.

  ★ THE LAYOUT OWNS THE SCROLL — the elements do NOT. This is the scroll-page contract: a
    plugin dropped in a section only needs ROOM to display at full height; it never needs its own
    scrollbar. The root is `display:flow-root` with NO fixed height and NO `position:absolute; inset:0`
    — so it takes its content's natural height and the PARENT PAGE scrolls through everything. Each
    nested element is given `display:block; width:100%` and whatever height IT wants (a 900px dashboard
    makes the page 900px taller). Because many of our plugins ship their own `position:absolute; inset:0`
    / `height:100%` (they were authored to fill a fixed-viewport tab pane), the host pane is defensive:
    it is `position:relative` and DEMOTES an absolutely/fixed-positioned direct child back to
    `position:static` so it lays out in the flow instead of collapsing the section to 0px. For such a
    self-sizing element that still can't measure its own height in flow, pass :min-section-height (or a
    section's own `minHeight`) to reserve room. Optionally cap a section with :max-section-height to give
    a genuinely tall element an inner scroll instead of an endless page (default: no cap = pure page
    scroll — a normal host page's flow).

  ★ EMBEDDING A LAYOUT INSIDE A LAYOUT (scroll-page in the cap-5 main). The cap-5 SPA's shell is
    VerticalTabsLayout (sidebar + a FIXED-VIEWPORT content frame whose pane is `position:absolute;
    inset:0`). A raw StackLayout dropped straight into that pane would be clipped by the inset overlay,
    so the page can't grow. The proven layout-inside-a-layout path is therefore the IFRAME LEAF: a tab
    is registered `mode:'iframe'` and its leaf page renders THIS layout at document root, where the
    document itself owns the scroll. dashboard-plus-grid does exactly this (a cap-5 tab whose leaf is a
    StackLayout) — scroll-page inside the vertical-tabs main, proven end to end.

  ★ SHADOW-DOM SAFE. Like VerticalTabsLayout, this is typically imported as a CHILD of a customElement
    root, so its <style> would be dropped from the shadow root. It injects its critical CSS via
    useShadowStyles() at setup(). Keep STL_SHADOW_CSS and the <style> mirror in sync.

  Slots: #brand / #meta (an optional top bar — omitted entirely if neither is used) · #section-<key>
  (host content for a section without `element`) · #default (a trailing host area at the bottom).
-->
<template>
  <div class="stl">
    <header class="stl-top" v-if="$slots.brand || $slots.meta || title">
      <span class="stl-brand"><slot name="brand" /></span>
      <b class="stl-title" v-if="title">{{ title }}</b>
      <span class="stl-meta"><slot name="meta" /></span>
    </header>

    <div class="stl-stack">
      <section
        v-for="sec in sections" :key="sec.key" class="stl-sec"
        :class="{ 'stl-sec-fill': hasDefiniteHeight(sec) }"
        :style="sectionStyle(sec)">
        <div class="stl-sec-head" v-if="sec.title">
          <b class="stl-sec-title">{{ sec.title }}</b>
          <span class="stl-sec-sub" v-if="sec.sub">{{ sec.sub }}</span>
        </div>
        <!-- element-bearing section → a host pane the element is mounted into imperatively. -->
        <div v-if="sec.element" class="stl-host" :ref="el => registerHost(sec.key, el)"></div>
        <!-- otherwise → host-rendered content via a per-section slot. -->
        <div v-else class="stl-slot"><slot :name="'section-' + sec.key" /></div>
      </section>
      <div class="stl-tail"><slot /></div>
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { bundleTreeRoot } from '@map/utils/embedBase.js'
import { loadScriptOnce, claimTag } from '@map/utils/embedScript.js'

// ★ ANCHOR A SIBLING-BUNDLE src TO THE TREE ROOT, NOT TO A GUESSED DEPTH.
// THE BUG (reported, the console text verbatim):
//     Could not load <doxa-research-map> from ../../doxa-research-map/doxa-research-map.js
// A composite declares its children as `src: '../../<bundle>/<bundle>.js'`. That literal is correct
// from a ONE-deep leaf and wrong from a TWO-deep one, and the generator emits both:
//     /doxa-maps/research-map-plus-grid/research-map-plus-grid/index.html          ../../ -> /doxa-maps/            200
//     /doxa-maps/research-map-plus-grid/research-map-plus-grid/default/index.html  ../../ -> /doxa-maps/research-map-plus-grid/  404
// MEASURED live: both leaves serve 200, the child script 404s only from the deeper one. So a
// hardcoded relative path encodes an ASSUMPTION ABOUT THE HOST'S DEPTH that the host does not
// control and cannot see — the classic relative-path failure, and the reason it survived: the
// shallow leaf (which every gate happened to exercise) is genuinely fine.
// THE FIX: find the tree root from the document's own URL — everything up to and including the
// /doxa-maps/ segment — and rebuild the path from there. Depth-independent by construction rather
// than tuned, so adding a third leaf depth later cannot reintroduce this.
// Anything already absolute, protocol-relative or root-relative is passed through untouched; if no
// /doxa-maps/ segment is found (a foreign mount) the original string is returned, so this can only
// ever fix a path, never break one that was already working.
// eslint-disable-next-line no-undef
const TREE_SEGMENT = (typeof __DOXA_TREE_NAME__ !== 'undefined' ? __DOXA_TREE_NAME__ : 'doxa-maps').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function resolveBundleSrc(url) {
  if (!url || /^(https?:)?\/\//.test(url) || url.startsWith('/')) return url
  const bare = url.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '')
  // (1) The document is somewhere inside the tree — anchor on its own /<tree>/ segment. The name is
  // baked in at build time (vite define __DOXA_TREE_NAME__, from the build config), never a literal:
  // a hardcoded '/doxa-maps/' here broke every composite's nested bundles on a renamed tree.
  const m = new RegExp('^(.*/' + TREE_SEGMENT + '/)').exec(window.location.pathname)
  if (m) return m[1] + bare
  // (2) THE DOCUMENT IS NOT INSIDE THE TREE AT ALL, so there is no segment to anchor on.
  // Reported: <plugin-studio> mounts at the SERVER ROOT (/index.html) in both
  // trees, and from there this function's only anchor was missing, so it returned the literal
  // '../../doxa-research-map/doxa-research-map.js' unchanged. The browser resolved that against
  // '/' — where '../' cannot climb — and requested /doxa-research-map/doxa-research-map.js:
  //     404, and StackLayout's .catch() reported "Could not load <doxa-research-map>".
  // MEASURED on the built tree: the SAME composite opened at its own leaf renders perfectly, which
  // is why this survived — every gate and every screenshot used a leaf URL, and the studio is the
  // one host that is not one.
  // The answer is the tree root the BUNDLE ITSELF was served from. bundleTreeRoot() reads this
  // bundle's own script URL (rollup rewrites import.meta.url to document.currentScript.src in the
  // IIFE build), so it is a FACT about where the code came from rather than a guess about where the
  // page is — which is the lesson stack-demo.vue already wrote down after this same defect appeared
  // for the third time: "resolve at RUNTIME from something that knows which tree is serving."
  // It returns null in dev ESM and for any layout that is not <name>/<name>.js, so it never guesses.
  const root = bundleTreeRoot()
  if (root) return String(root).replace(/\/+$/, '') + '/' + bare
  // (3) Nothing knowable — return the original untouched. Together with (1) coming first, this
  // keeps every path that worked before byte-identical: this function can still only ever fix a
  // path, never break one.
  return url
}

// Inject a bundle script exactly once per URL, through the ONE shared loader (library/utils/embedScript.js:
// the dedupe cache, the dev-server ES-module rule, the empty-url no-op). Only the src resolution is this
// layout's own: a sibling-bundle src is anchored to the tree root first (resolveBundleSrc above).
function injectScriptOnce(rawUrl) {
  return loadScriptOnce(resolveBundleSrc(rawUrl))
}

function waitForDefine(tag, timeoutMs = 5000) {
  if (typeof customElements === 'undefined') return Promise.resolve()
  if (customElements.get(tag)) return Promise.resolve()
  if (customElements.whenDefined) {
    return Promise.race([
      customElements.whenDefined(tag),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout waiting for <' + tag + '>')), timeoutMs))
    ])
  }
  return Promise.resolve()
}

// Mirror of the <style> block for the shadow root (kept comment/interp-free for the strip plugin).
const STL_SHADOW_CSS = `
.stl { display:flow-root; width:100%; min-height:100%; background:#f3f3f1; color:#3b463d; font-family:'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased; --stl-accent:#92b195; --stl-border:#d1d4cd; --stl-elevated:#ffffff; --stl-muted:#6d766e; }
.stl-top { display:flex; align-items:center; gap:10px; padding:11px 16px; border-bottom:1px solid var(--stl-border); background:#ffffff; position:sticky; top:0; z-index:5; }
.stl-brand { display:inline-flex; align-items:center; }
.stl-brand:empty { display:none; }
.stl-title { font-size:15px; font-weight:600; letter-spacing:-0.01em; color:#3b463d; }
.stl-meta { color:var(--stl-muted); font-size:12px; margin-inline-start:auto; display:inline-flex; align-items:center; gap:8px; }
.stl-stack { display:flex; flex-direction:column; }
.stl-sec { display:flex; flex-direction:column; min-width:0; border-bottom:1px solid var(--stl-border); }
.stl-sec:last-child { border-bottom:0; }
.stl-sec-head { padding:12px 16px 8px; display:flex; align-items:baseline; gap:10px; }
.stl-sec-title { font-size:13px; font-weight:600; letter-spacing:.02em; color:#3b463d; }
.stl-sec-sub { font-size:12px; color:var(--stl-muted); }
.stl-host { display:block; width:100%; min-width:0; position:relative; }
.stl-host > * { display:block; width:100%; }
.stl-host > *[style*="absolute"], .stl-host > *[style*="fixed"] { position:static !important; inset:auto !important; }
.stl-slot { display:block; width:100%; }
.stl-tail:empty { display:none; }
.stl-sec-fill { position:relative; overflow:hidden; }
.stl-sec-fill > .stl-host, .stl-sec-fill > .stl-slot { position:absolute; inset:0; overflow:hidden; }
.stl-sec-fill > .stl-host > *, .stl-sec-fill > .stl-slot > * { height:100%; }
.stl, .stl * { scrollbar-width:thin; scrollbar-color:#c4c8c0 transparent; }
.stl ::-webkit-scrollbar { width:8px; height:8px; }
.stl ::-webkit-scrollbar-track { background:transparent; }
.stl ::-webkit-scrollbar-thumb { background:#c4c8c0; border-radius:8px; }
.stl ::-webkit-scrollbar-thumb:hover { background:#9aa197; }
.stl ::-webkit-scrollbar-corner { background:transparent; }
`

export default defineComponent({
  name: 'StackLayout',
  props: {
    // [{ key, title?, sub?, element?, src?, attrs? }] — rendered top-to-bottom, all eager.
    sections: { type: Array, default: () => [] },
    // Optional top-bar title (omit for a bare stack with no header).
    title: { type: String, default: '' },
    // Optional per-section max height (e.g. '70vh') → that section gets an inner scroll instead of an
    // unbounded page. Default '' = no cap, pure page scroll (a normal host page's flow).
    maxSectionHeight: { type: String, default: '' },
    // Optional default MIN height for every section (e.g. '60vh') → reserves room for a self-sizing
    // element that ships its own fixed layout and can't measure its natural height in flow. A section
    // can override per-item with its own `minHeight`. Default '' = no floor (pure natural height).
    minSectionHeight: { type: String, default: '' }
  },
  setup() {
    useShadowStyles(STL_SHADOW_CSS, 'stack-layout')
  },
  data() {
    return { _hosts: {}, _mounted: {} }
  },
  mounted() {
    // Eager: mount every element-bearing section on first render (scroll-through shows all).
    for (const sec of (this.sections || [])) {
      if (sec.element) this.mountSection(sec)
    }
  },
  methods: {
    registerHost(key, el) { if (el) this._hosts[key] = el },
    // Per-section wrapper style: an optional inner-scroll cap (maxHeight) and/or a reserved floor
    // (minHeight, per-section override → layout default). Returns null when neither applies so a plain
    // section stays pure natural-height page-flow.
    sectionStyle(sec) {
      const s = {}
      const max = sec.maxHeight || this.maxSectionHeight
      const min = sec.minHeight || this.minSectionHeight
      // A definite-height section (min===max) is a fixed BAND: it must NOT get an inner section scroll —
      // the nested element (via .stl-sec-fill) fills it and owns any inner scroll, and the PAGE scrolls
      // past it. Only a cap-WITHOUT-a-matching-floor gets the maxHeight inner-scroll (`overflow:auto`).
      const definite = !!(max && min && max === min)
      if (max) { s.maxHeight = max; if (!definite) s.overflow = 'auto' }
      if (min) s.minHeight = min
      return Object.keys(s).length ? s : null
    },
    // A section is "definite-height" when it pins BOTH a floor and a cap to the SAME value (min===max):
    // its height is fixed, not natural. Such a section adds `.stl-sec-fill` so its host/slot + the nested
    // element stretch to fill it — the escape hatch for a fixed-viewport plugin (e.g. the research
    // dashboard) that ships `height:100%` and needs a definite parent height to resolve against, while
    // the OUTER page still grows below the section so page-scroll reaches the next section.
    hasDefiniteHeight(sec) {
      const max = sec.maxHeight || this.maxSectionHeight
      const min = sec.minHeight || this.minSectionHeight
      return !!(max && min && max === min)
    },
    mountSection(sec) {
      if (this._mounted[sec.key]) return
      this._mounted[sec.key] = true
      const host = this._hosts[sec.key]
      if (!host) return
      injectScriptOnce(sec.src)
        .then(() => waitForDefine(sec.element))
        .then(() => {
          // Name the bundle this tag actually came from, so a page carrying two bundles that both
          // ship <sec.element> says so once instead of silently running whichever executed first.
          claimTag(sec.element, resolveBundleSrc(sec.src))
          if (!customElements.get(sec.element)) return
          const el = document.createElement(sec.element)
          const attrs = sec.attrs || {}
          for (const k in attrs) {
            const val = attrs[k]
            // props-in-advance: set as a property AND an attribute (custom elements read either).
            try { el[k] = val } catch { /* ignore */ }
            try { el.setAttribute(k, val == null ? '' : String(val)) } catch { /* ignore invalid attr name */ }
          }
          host.innerHTML = ''
          host.appendChild(el)
        })
        // ★ A FAILED SECTION MUST SAY SO (BUG-SIMPLE-RESEARCH-GREY-PANE, reported four times).
        // The rest of the stack still renders — that part was always right, and is why this catch
        // is per-section rather than around the whole loop. What was wrong is that it left the host
        // EMPTY and silent, so a composite whose children all failed rendered as a blank rectangle
        // with nothing in the console at this site. MEASURED under the dev server: <research-map-
        // plus-grid> mounted (count 1) with BOTH children 404 — 794px of pure grey and no message.
        // An empty band inside a working page is indistinguishable from a broken app, and it hid
        // this defect through four separate reports.
        //
        // The message is deliberately plain text in the host rather than a thrown error: throwing
        // here would abort the other sections, which is the one behaviour this catch exists to
        // prevent. Styling stays inline because the host is the consumer's node, not ours.
        .catch((e) => {
          const why = (e && e.message) || String(e)
          console.error('[StackLayout] section "' + sec.key + '" failed to mount <' +
            sec.element + '>' + (sec.src ? ' from ' + sec.src : '') + ': ' + why)
          try {
            host.innerHTML = ''
            const d = document.createElement('div')
            d.setAttribute('role', 'status')
            // overflow-wrap + break-word, because the payload is a URL: a long unbroken path
            // otherwise runs straight out of the card (measured — it overflowed the 1024px pane).
            // box-sizing + max-width:100% keep the card inside the host: the host can be narrower
            // than the message, and without these the margin is ADDED to a 100% width and the text
            // runs off the pane (measured — the URL escaped the 1024px pane twice before this).
            d.style.cssText = 'box-sizing:border-box;max-width:100%;' +
              'padding:16px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
              'color:#6d766e;background:#fff;border:1px solid #d1d4cd;border-radius:8px;margin:12px 0;' +
              'overflow-wrap:anywhere;word-break:break-word'
            d.textContent = 'Could not load <' + sec.element + '>' +
              (sec.src ? ' from ' + sec.src : '') + ' — ' + why
            host.appendChild(d)
          } catch { /* host detached mid-flight: nothing to report into */ }
        })
    }
  }
})
</script>

<style>
/* Mirror of STL_SHADOW_CSS for dev / light-DOM readability. Keep the two in sync.
   Brand-neutral default dark theme; consumers override via the --stl-* custom properties. */
.stl { display:flow-root; width:100%; min-height:100%; background:#f3f3f1; color:#3b463d; font-family:'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased; --stl-accent:#92b195; --stl-border:#d1d4cd; --stl-elevated:#ffffff; --stl-muted:#6d766e; }
.stl-top { display:flex; align-items:center; gap:10px; padding:11px 16px; border-bottom:1px solid var(--stl-border); background:#ffffff; position:sticky; top:0; z-index:5; }
.stl-brand { display:inline-flex; align-items:center; }
.stl-brand:empty { display:none; }
.stl-title { font-size:15px; font-weight:600; letter-spacing:-0.01em; color:#3b463d; }
.stl-meta { color:var(--stl-muted); font-size:12px; margin-inline-start:auto; display:inline-flex; align-items:center; gap:8px; }
.stl-stack { display:flex; flex-direction:column; }
.stl-sec { display:flex; flex-direction:column; min-width:0; border-bottom:1px solid var(--stl-border); }
.stl-sec:last-child { border-bottom:0; }
.stl-sec-head { padding:12px 16px 8px; display:flex; align-items:baseline; gap:10px; }
.stl-sec-title { font-size:13px; font-weight:600; letter-spacing:.02em; color:#3b463d; }
.stl-sec-sub { font-size:12px; color:var(--stl-muted); }
.stl-host { display:block; width:100%; min-width:0; position:relative; }
.stl-host > * { display:block; width:100%; }
.stl-host > *[style*="absolute"], .stl-host > *[style*="fixed"] { position:static !important; inset:auto !important; }
.stl-slot { display:block; width:100%; }
.stl-tail:empty { display:none; }
.stl-sec-fill { position:relative; overflow:hidden; }
.stl-sec-fill > .stl-host, .stl-sec-fill > .stl-slot { position:absolute; inset:0; overflow:hidden; }
.stl-sec-fill > .stl-host > *, .stl-sec-fill > .stl-slot > * { height:100%; }
.stl, .stl * { scrollbar-width:thin; scrollbar-color:#c4c8c0 transparent; }
.stl ::-webkit-scrollbar { width:8px; height:8px; }
.stl ::-webkit-scrollbar-track { background:transparent; }
.stl ::-webkit-scrollbar-thumb { background:#c4c8c0; border-radius:8px; }
.stl ::-webkit-scrollbar-thumb:hover { background:#9aa197; }
.stl ::-webkit-scrollbar-corner { background:transparent; }
</style>
