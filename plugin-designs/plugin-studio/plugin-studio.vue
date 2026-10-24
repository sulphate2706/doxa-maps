<!--
  plugin-studio.vue — the Category-5 (nested-mfe-spa / app-shell) DEVELOPER STUDIO.

  * @description The developer's viewing surface: a sidebar that is the composability ladder
    grouped by CAPABILITY (5 down to 1), listing every element each tier holds. Click a row and
    that element mounts in the main slot with its embed snippet beside it — the one place to see
    every plugin work, ordered by what it can do.

  ONE element, <plugin-studio>, renders a VERTICAL-TAB layout whose sidebar is the composability
  ladder grouped by CAPABILITY (5 → 1). Under each capability heading it lists every element that
  tier holds; clicking a row nests that element in the main slot. Directly under each composite's
  row, its full composition tree is drawn indented, so a defect can be pinned on the exact nested
  element responsible. This is the DX viewing surface:
  the spot to SEE every plugin element work, in one place, ordered by capability, with the embed
  snippet for each — so a developer (or a reviewer) can review each element and give feedback.

  ★ WHY AN ELEMENT, NOT A PAGE. Every plugin in this system is a compiled Vue custom element, so
    it supports all five deployment methods (iframe · script-tag/custom-element · direct-JS
    props/events · nested-in-another-element · nested-SPA) and can compose. The studio is itself a
    plugin, so it too is a real element (<plugin-studio>), NOT an index.html page. A page could
    only be iframed (one method) and could never be nested as a tab of another cap-5 shell.

  HOW IT NESTS EACH ELEMENT. ONE way, for every row: inject the bundle's .js once (guarded), then
  create its REAL tag in an empty Vue-unmanaged slot. There is NO iframe mode. The studio protects
  the bundles and shows the ELEMENTS — a framed page would be a different deployment method wearing
  the studio's clothes, and could never demonstrate nesting.

  ★ THE IFRAME MODE THAT USED TO LIVE HERE, AND WHY IT IS GONE. Map rows were framed to dodge a
    one-shot customElements.define collision. MEASURED 2026-09-22: 19 distinct tags across 19
    bundles, ZERO claimed twice — the collision cannot occur in this tree, and two map elements were
    proven to coexist in one document. What IS real is the browser's WebGL context budget, so that
    is what the code now guards (see HEAVY_ELEMENTS): heavy rows are DESTROYED on deactivate
    instead of being hidden, keeping at most one live map context.

  The tab manifest is fetched at runtime from the built tree's manifest.json (so the studio stays
  correct as bundles change), grouped by capability via the manifest's baked tier; a compact baked
  fallback keeps it working under file:// or if the fetch fails. treeBase is derived by index.js
  from the running script URL (two levels up), overridable via tree-base="" or profile-config.

  ★ SHARED SHELL. The top bar + capability-grouped vertical rail + content frame are the ONE shared
    beautiful layout, VerticalTabsLayout (library/layouts) — the same shell doxa-maps-spa uses. The
    studio supplies the grouped rail model + owns the content area (the embed toolbar + the panes
    with their direct-element mount machinery).

  NO re-import of any nested plugin's components and NO re-registration of a tag another bundle
  owns — the only tag this bundle defines is <plugin-studio> (see index.js).
-->
<template>
  <!-- The SHELL (top bar + capability-grouped vertical rail + content frame) is the ONE shared
       beautiful layout, VerticalTabsLayout (library/layouts). The studio supplies the grouped rail
       model + owns everything in the content area: the embed bar (as #toolbar) and the per-element
       panes with their direct-element mount + heavy-row teardown machinery. -->
  <VerticalTabsLayout
    :title="heading || tr('title')"
    :dir="uiDir"
    :nav-label="tr('navLabel')"
    :labels="{ toggleList: tr('toggleList'), openViews: tr('openViews'), expandList: tr('expandList'), collapseList: tr('collapseList'), collapse: tr('collapse') }"
    :header="!headerHidden"
    :active="activeKey"
    @update:active="select">

    <!-- #rail: the Explorer tree (src/StudioTree.vue) — capability sections, each composite folding
         to show what it is made of. The layout keeps the rail frame (collapse, drawer, slim strip). -->
    <template #rail="{ collapsed, expand, pick }">
      <StudioTree :sections="treeSections" :active="activeKey" :collapsed="collapsed" :expand="expand" :pick="pick"
        :strings="{ filterPlaceholder: tr('filterPlaceholder'), collapseAll: tr('collapseAll'), noMatch: tr('noMatch'), treeLabel: tr('navLabel'), openSection: tr('openSection'), part: tr('part') }" />
    </template>

    <!-- #brand: the studio's logo mark (a plug/puzzle glyph — "plugin studio"), left of the title.
         Self-drawn SVG, green accent to match the admin shell; no external asset (offline safe). -->
    <template #brand>
      <span class="ps-logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#92b195" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 3v3M14 3v3M7 6h10v5a5 5 0 0 1-10 0V6Z" />
          <path d="M12 16v5" />
        </svg>
      </span>
      <!-- ON A PHONE the layout hides the header's #meta slot (its 56px bar has no room for it), and the
           "Hide header" button in #meta went with it, so a phone could not collapse the header at all. This
           copy shows only at phone width, pinned to the header's end corner; the one in #meta serves wider
           screens. The floating "Show header" button below brings the header back, as on a desktop. -->
      <button type="button" class="ps-hide-header-phone" :title="tr('hideHeader')" :aria-label="tr('hideHeader')"
        @click="setHeaderHidden(true)"><span aria-hidden="true">⌃</span></button>
    </template>

    <!-- #meta: the bundle/element count + an i18n locale toggle. The studio previews LOCALISED
         elements, so a locale switch lets a developer see each element in another language. Reuses
         app-wrapper-material/languages.js (persisted, offline, no dep) — same switcher as the SPA. -->
    <template #meta>
      <span class="ps-count">{{ countLabel }}</span>
      <span class="ps-locale">
        <button type="button" class="ps-locale-btn" :aria-expanded="String(localeOpen)"
          :aria-label="tr('changeLanguage')" @click="localeOpen = !localeOpen; engineOpen = false; settingsOpen = false">
          <span class="ps-flag">{{ activeLang.flag }}</span>
          <span class="ps-locale-name">{{ activeLang.nativeName }}</span>
          <span class="ps-dots" aria-hidden="true">⋮</span>
        </button>
        <ul class="ps-locale-menu" v-if="localeOpen" role="listbox">
          <li v-for="l in switcherLangs" :key="l.code" role="option" :aria-selected="String(l.code === locale)">
            <button type="button" class="ps-locale-opt" :class="{ active: l.code === locale }" @click="setLocale(l.code)">
              <span class="ps-flag">{{ l.flag }}</span>
              <span class="ps-locale-name">{{ l.nativeName }}</span>
              <span class="ps-locale-en">{{ l.name }}</span>
            </button>
          </li>
        </ul>
      </span>
      <!-- THE HEADER SETS THE PROPS EVERY PLUGIN GETS (2026-09-25): language (above), the map
           ENGINE, and — under Settings — the Mapbox token or the URL it comes from. Each is kept in THIS
           browser (localStorage), handed to every pane as its profile-config prop, and published on the
           window for maps nested inside composites; changing one re-mounts the maps. -->
      <span class="ps-locale ps-engine">
        <button type="button" class="ps-locale-btn" :aria-expanded="String(engineOpen)"
          :aria-label="tr('mapEngine')" :title="tr('mapEngine')" @click="engineOpen = !engineOpen; localeOpen = false; settingsOpen = false">
          <span aria-hidden="true">🗺</span>
          <span class="ps-locale-name">{{ engineLabel }}</span>
          <span class="ps-dots" aria-hidden="true">⋮</span>
        </button>
        <ul class="ps-locale-menu" v-if="engineOpen" role="listbox" :aria-label="tr('mapEngine')">
          <li v-for="e in engines" :key="e.id || 'default'" role="option" :aria-selected="String(e.id === userProvider)">
            <button type="button" class="ps-locale-opt" :class="{ active: e.id === userProvider }" @click="setProvider(e.id)">
              <span class="ps-locale-name">{{ e.label }}</span>
              <span class="ps-locale-en">{{ e.note }}</span>
            </button>
          </li>
        </ul>
      </span>
      <span class="ps-token">
        <button type="button" class="ps-locale-btn ps-token-btn" :aria-expanded="String(settingsOpen)"
          :title="tokenStatus" @click="settingsOpen = !settingsOpen; localeOpen = false; engineOpen = false">
          <span class="ps-locale-name">{{ tr('mapboxToken') }}</span>
          <span class="ps-token-dot" :class="'is-' + tokenSource" aria-hidden="true"></span>
        </button>
        <form v-if="settingsOpen" class="ps-token-panel" @submit.prevent="applyToken">
          <p class="ps-token-head">{{ tr('mapToken') }}</p>
          <label class="ps-token-label">{{ tr('tokenPaste') }}
            <input class="ps-token-input" v-model.trim="tokenDraft" placeholder="MAPBOX_PUBLIC_TOKEN…" autocomplete="off" spellcheck="false" />
          </label>
          <label class="ps-token-label">{{ tr('tokenUrlLabel') }}
            <input class="ps-token-input" v-model.trim="urlDraft" type="url" placeholder="https://doxa.life/api/maps/token" autocomplete="off" spellcheck="false" />
          </label>
          <div class="ps-token-row">
            <button type="submit" class="ps-token-apply" :disabled="tokenBusy">{{ tr('tokenApply') }}</button>
            <button type="button" class="ps-token-clear" @click="clearToken">{{ tr('tokenClear') }}</button>
          </div>
          <p class="ps-token-status" :class="{ err: !!tokenErr }" role="status">{{ tokenErr || tokenStatus }}</p>
          <p class="ps-token-note">{{ tr('tokenStoredHere') }}</p>
        </form>
      </span>
      <!-- COLLAPSE THE HEADER: the plugin takes the full height (as the Research Gallery does), and the
           floating button below brings the header back — the header is the props panel, so it must be
           one click away. The choice is remembered in this browser. -->
      <button type="button" class="ps-locale-btn ps-hide-header" :title="tr('hideHeader')" :aria-label="tr('hideHeader')"
        @click="setHeaderHidden(true)">
        <span aria-hidden="true">⌃</span>
        <span class="ps-locale-name">{{ tr('hideHeader') }}</span>
      </button>
    </template>

    <!-- Toolbar strip: the active element's identity and copy-embed. Kept to ONE line on purpose —
         the plugin is what the studio is for, so it gets the rest of the main area. (A "Composed of"
         panel used to sit here; it was removed 2026-09-24 because it took the plugin's space.
         Composition lives in the rail, indented under each composite.) -->
    <template #toolbar>
      <div class="ps-toolbar" v-if="active">
        <div class="ps-bar">
          <div class="ps-bar-t">
            <b>{{ active.label }}</b>
            <span class="ps-bar-sub">{{ active.bundle }} · &lt;{{ active.tag }}&gt;<span v-if="active.description"> · {{ active.description }}</span></span>
          </div>
          <button type="button" class="ps-btn" :aria-expanded="String(embedOpen)"
            @click="embedOpen = !embedOpen" v-if="active.embed">{{ tr('copyEmbed') }}</button>
        </div>

        <div class="ps-embed" v-if="embedOpen && active.embed">
          <label>{{ tr('scriptEmbed') }}
            <button type="button" class="ps-btn" @click="copyText(active.embed, $event.target)">{{ tr('copy') }}</button>
          </label>
          <textarea readonly :value="active.embed"></textarea>
        </div>
      </div>
    </template>

    <!-- EVERY pane mounts its plugin's REAL custom element — there is no iframe mode. Each plugin
         is a compiled Vue custom element, so the studio embeds the element itself rather than a
         page wrapped around it; that is what makes a row reviewable AND nestable.

         TWO LIFETIMES, and the difference is the WebGL context budget, not cosmetics:
           light rows (v-show) stay mounted once loaded, so switching back is instant and state
             survives. This is deliberate — do not "simplify" it to v-if.
           heavy rows (v-if, row.heavy — the map elements) are DESTROYED on deactivate. Removing
             the host node runs the element's onBeforeUnmount → map.remove(), which releases the
             GPU context (measured: canvas count 1→0 and webglcontextlost fired). Without this,
             every map ever visited would hold a live context until the browser silently dropped
             the OLDEST one and an old tab went blank with no error. -->
    <!-- The way back when the header is collapsed: always visible, top corner, above every plugin. -->
    <button v-if="headerHidden" type="button" class="ps-show-header" :title="tr('showHeader')" :aria-label="tr('showHeader')"
      @click="setHeaderHidden(false)">
      <span aria-hidden="true">⌄</span> {{ tr('showHeader') }}
    </button>
    <div class="ps-stage">
      <section
        v-for="row in flatRows" :key="row.key" class="ps-pane"
        v-show="row.key === activeKey" :hidden="row.key !== activeKey">

        <template v-if="!row.heavy || row.key === activeKey">
          <div class="ps-slot" :ref="el => setSlot(row.key, el)"></div>
          <div v-if="row.state === 'loading'" class="ps-hint">{{ tr('loading', { name: row.label }) }}</div>
          <div v-else-if="row.state === 'error'" class="ps-hint err">
            {{ tr('couldNotLoad', { name: row.label }) }}<br /><small>{{ row.error }}</small>
          </div>
        </template>
      </section>
      <div class="ps-hint" v-if="!activeKey">{{ tr('chooseElement') }}</div>
    </div>
  </VerticalTabsLayout>
</template>

<script>
import { defineComponent, inject } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import VerticalTabsLayout from '@map/layouts/VerticalTabsLayout.vue'
import StudioTree from './src/StudioTree.vue'
import { LANGUAGES, loadLocale, saveLocale, getLanguage, normaliseLocale } from '@map/layouts/app-wrapper-material/languages.js'
import { publishMapToken, clearMapToken } from '@map/composables/useSharedMapToken.js'
import { loadScriptOnce, whenTagDefined } from '@map/utils/embedScript.js'
import { readViewKeys, writeViewKeys, onAddressChange, urlOwnerOf, commitUrl, ownAddress } from '@map/composables/useViewAddress.js'

// The reader's own map token / token-service URL. localStorage only: never written into the build,
// never sent anywhere but Mapbox (the token) or the URL the reader typed (the service).
const TOKEN_KEY = 'plugin-studio:mapbox-token'
const TOKEN_URL_KEY = 'plugin-studio:mapbox-token-url'
const HEADER_KEY = 'plugin-studio:header-hidden'     // '1' = collapsed
const PROVIDER_KEY = 'plugin-studio:map-provider'   // 'mapbox' | 'maplibre' | '' (each map's own default)
function readStored(k) { try { return (typeof window !== 'undefined' && window.localStorage.getItem(k)) || '' } catch (_) { return '' } }
function writeStored(k, v) { try { if (v) window.localStorage.setItem(k, v); else window.localStorage.removeItem(k) } catch (_) { /* storage unavailable */ } }

// Only the studio's CONTENT-AREA styles remain here; the shell (top bar + rail + body) is now the
// shared VerticalTabsLayout (which self-injects its own CSS). Kept as an injected string so the studio
// content is styled even when this component is nested as a child element (see useShadowStyles).
const PS_SHADOW_CSS = `
:host { display:block; position:relative; height:var(--plugin-studio-height, 85vh); min-height:480px; }
:host([hidden]) { display:none; }
.ps-logo { display:inline-flex; align-items:center; }
.ps-logo svg { display:block; }
.ps-count { color:#6d766e; }
/* THE HEADER'S MENUS SIT ABOVE EVERY PLUGIN (2026-09-25: the Mapbox token menu was not on top;
   it slid under the plugins). The header row and the pane area are siblings with no stacking context
   of their own, so a menu at z-index 30 competed with each plugin's own chrome (a filter bar at 55, a drawer
   at 1000) and lost. The header now stacks above the content, and the pane area is ISOLATED: whatever
   z-index a plugin uses stays inside its pane. */
.vtl-top { position:relative; z-index:3; }
.vtl-body { isolation:isolate; }
.ps-token { position:relative; display:inline-flex; }
.ps-show-header { position:fixed; top:8px; inset-inline-end:8px; z-index:2147483000; display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border:1px solid #d1d4cd; border-radius:999px; background:rgba(255,255,255,.94); color:#3b463d; font:600 12px system-ui, sans-serif; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.18); }
.ps-show-header:hover, .ps-show-header:focus-visible { background:#ffffff; outline:2px solid #92b195; }
.ps-hide-header-phone { display:none; }
@media (max-width:760px) { .ps-hide-header-phone { display:inline-flex; position:fixed; top:6px; inset-inline-end:8px; z-index:4; align-items:center; justify-content:center; width:44px; height:44px; padding:0; border:1px solid #d1d4cd; border-radius:var(--vtl-radius,8px); background:#d1d4cd; color:#3b463d; font:18px/1 system-ui, sans-serif; cursor:pointer; } }
.ps-token-dot { width:8px; height:8px; border-radius:50%; background:#b8bdb4; }
.ps-token-dot.is-yours, .ps-token-dot.is-url { background:#92b195; }
.ps-token-dot.is-built { background:#c9b36a; }
.ps-token-dot.is-none { background:#d27a6a; }
.ps-token-panel { position:absolute; top:100%; inset-inline-end:0; margin-top:4px; z-index:30; width:min(340px, 90vw); display:flex; flex-direction:column; gap:8px; padding:12px; border:1px solid #d1d4cd; border-radius:10px; background:#ffffff; box-shadow:0 12px 32px rgba(0,0,0,.25); color:#3b463d; font-size:12px; }
.ps-token-label { display:flex; flex-direction:column; gap:4px; }
.ps-token-input { font:inherit; font-size:12px; padding:6px 8px; border:1px solid #d1d4cd; border-radius:7px; background:#f8f8f6; color:#3b463d; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
.ps-token-row { display:flex; gap:8px; }
.ps-token-apply, .ps-token-clear { font:inherit; font-size:12px; padding:5px 12px; border-radius:7px; border:1px solid #d1d4cd; background:#d1d4cd; color:#3b463d; cursor:pointer; }
.ps-token-apply { background:#92b195; border-color:#92b195; color:#fff; }
.ps-token-apply:disabled { opacity:.6; cursor:progress; }
.ps-token-status { margin:0; }
.ps-token-head { margin:0; font-weight:600; font-size:12px; }
.ps-token-status.err { color:#b3412f; }
.ps-token-note { margin:0; color:#6d766e; }
.ps-locale { position:relative; display:inline-flex; }
.ps-locale-btn { display:inline-flex; align-items:center; gap:6px; font:inherit; font-size:12px; padding:4px 9px; border:1px solid #d1d4cd; border-radius:8px; background:#d1d4cd; color:#3b463d; cursor:pointer; }
.ps-locale-btn:hover { background:#d1d4cd; }
.ps-flag { font-size:13px; line-height:1; }
.ps-locale-name { max-width:11ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ps-token-btn .ps-locale-name { max-width:none; }   /* "Mapbox token" is read in full: it names the prop */
.ps-dots { color:#6d766e; }
.ps-locale-menu { position:absolute; top:100%; right:0; margin-top:4px; z-index:30; min-width:180px; list-style:none; padding:6px; border:1px solid #d1d4cd; border-radius:10px; background:#ffffff; box-shadow:0 12px 32px rgba(0,0,0,.5); max-height:320px; overflow:auto; }
.ps-locale-opt { display:flex; align-items:center; gap:8px; width:100%; text-align:left; font:inherit; font-size:13px; padding:7px 9px; border:0; border-radius:7px; background:none; color:#3b463d; cursor:pointer; }
.ps-locale-opt:hover { background:#d1d4cd; color:#3b463d; }
.ps-locale-opt.active { background:#d1d4cd; color:#3b463d; }
.ps-locale-opt.active .ps-locale-name { color:#92b195; }
.ps-locale-en { margin-left:auto; font-size:11px; color:#6d766e; }
.ps-toolbar { display:flex; flex-direction:column; gap:8px; padding:10px 12px 0; }
.ps-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ps-bar-t { flex:1 1 auto; min-width:0; }
.ps-bar-t b { font-size:15px; color:#3b463d; }
.ps-bar-sub { display:block; font-size:12px; color:#6d766e; }
.ps-btn { font:inherit; font-size:12px; padding:5px 10px; border:1px solid #d1d4cd; border-radius:8px; background:#d1d4cd; color:#3b463d; cursor:pointer; white-space:nowrap; }
.ps-btn:hover { background:#d1d4cd; }
.ps-embed { display:flex; flex-direction:column; gap:6px; padding:8px; border:1px solid #d1d4cd; border-radius:8px; background:#f3f3f1; }
.ps-embed label { font-size:12px; color:#6d766e; display:flex; justify-content:space-between; align-items:center; }
.ps-embed textarea { width:100%; height:58px; font:11px/1.35 ui-monospace,Menlo,monospace; border:1px solid #d1d4cd; border-radius:6px; background:#ffffff; color:#3b463d; padding:6px; resize:vertical; }
.ps-stage { position:absolute; inset:10px 12px 12px; border:1px solid #d1d4cd; border-radius:10px; overflow:hidden; background:#f3f3f1; }
/* ★ THE PANE OWNS THE SCROLL (BUG-STILL-CANNOT-SCROLL-DOWN-TO-THE-GRID, measured 2026-09-22).
   A scroll-stack composite (dashboard-plus-grid: an 88svh dashboard band + the people-groups grid
   below it) mounted here measured scrollHeight 3380 / clientHeight 769 — 2611px of real, mounted,
   populated content that NO element could scroll to, because this pane was position:absolute;
   inset:0 with the default overflow:visible inside a .ps-stage that is overflow:hidden.
   Document scrollHeight was 900, exactly === clientHeight, so a wheel gesture had nothing to move.
   The identical composite is PERFECT standalone (document 2960/900, wheel reaches 2060) because its
   generated leaf gives the DOCUMENT the scroll — a host that pins the pane to viewport height has
   to own that scroll itself.
   auto, not scroll: only a pane whose content really exceeds its box gets a scrollbar, so the map
   tabs stay scrollbar-free (see the dvh floor note below, which is what makes that true). */
.ps-pane { position:absolute; inset:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; --profile-min-h:0; }
/* NOT absolute-inset: that pinned the mount point to the pane's height and re-created the same trap
   one level down (an absolutely positioned child cannot grow a scroll container). min-height:100%
   keeps a fixed-viewport map filling the pane while letting a taller composite grow it. */
.ps-slot { position:relative; min-height:100%; }
/* ★ THE dvh FLOOR, NEUTRALISED FOR HOSTED ELEMENTS (measured 2026-09-22, caught by the regression
   check on this very fix — my first version of the rule above was WRONG about this).
   I claimed a fixed-viewport map "fills this box exactly, so auto is a no-op for it". It is not.
   doxa-research-map ships .profile-loader { height:100%; min-height:100dvh }, and those two resolve
   against DIFFERENT bases: height:100% against the pane (769px here, because the pane sits inside a
   .ps-stage inset by the studio chrome), min-height:100dvh against the VIEWPORT (900px). The floor
   wins, the element is 131px taller than its container, and overflow:auto then correctly reported a
   scrollbar on a map tab that should never have one — a real regression my reasoning had ruled out.
   The dvh floor is deliberate and must stay for the STANDALONE leaf, where it fixes the opposite
   bug (BUG-UPG100-NESTED-ELEMENTS-ZERO-HEIGHT: min-height:100% against a body with no definite
   height collapses to 0). It is only wrong HERE, where the pane is a definite box shorter than the
   viewport. So neutralise it on the hosted subtree rather than editing the map: a direct child of a
   studio pane is bounded by the PANE. A taller-than-viewport scroll-stack composite is unaffected —
   it grows past this floor on its own content, which is what makes the grid reachable.

   ★ AND --profile-min-h:0 ON THE PANE, which is the half that actually does the work. Sizing the
   host is NOT enough, and measuring proved it: the host correctly became 769px while the pane still
   overflowed by exactly 131px, because .profile-loader lives INSIDE the map's SHADOW ROOT at
   min-height:100dvh and a host-page SELECTOR cannot reach into a shadow tree. Inherited properties
   CAN, so ProfileLoader.vue now reads min-height:var(--profile-min-h, 100dvh) and this pane sets it
   to 0 — the floor keeps its default everywhere else, including every standalone leaf where it
   still fixes BUG-UPG100.
   ★ NOT overflow:clip, which I tried first and MEASURED as wrong: it bounded the map (good) but
   ALSO bounded the scroll-stack composite, whose host box is the pane height while its content is
   3380px — so the grid became unreachable again and the gate went straight back to 0px scrolled.
   One blanket rule cannot serve both; the variable targets the actual culprit instead. */
.ps-slot > * { min-height:0; max-height:none; }
.ps-hint { position:absolute; inset:0; display:grid; place-items:center; text-align:center; color:#6d766e; font-size:13px; padding:20px; }
.ps-hint.err { color:#f87171; }
.ps-hint small { color:#6d766e; }
`

// Reader-facing capability names, most-composed first (5 → 1). Mirrors generate-gallery's
// CAP_LABEL so the studio speaks the same vocabulary as the built gallery + the docs.
const CAP_LABEL = {
  5: 'App shell · nested-mfe-spa',
  4: 'Composite element',
  3: 'Multi-view element',
  2: 'Preset element',
  1: 'Single element'
}
// Composition tier (machine key) → capability number. 5 = app-shell … 1 = single.
const PT = { 'nested-mfe-spa': 0, 'nested-elements-mfe': 1, 'monolithic': 2, 'parameterized': 3, 'single': 4 }
const capFor = (t) => (PT[t] != null ? 5 - PT[t] : 1)
// Rail row icon per capability: LOCAL inline SVG names (app-wrapper-material/icons.js), not emoji.
// These were emoji until 2026-09-24, and on a box with no emoji font (measured: this one) every rail
// row led with an empty tofu box — the first thing a developer saw on every plugin.
// Machine names of the five tiers — technical terms, shown untranslated after the localised tier name
// in a section header's tooltip (the localised names live in studio.json cap1…cap5).
const MACHINE_TYPE = { 5: 'nested-mfe-spa', 4: 'nested-elements-mfe', 3: 'monolithic', 2: 'parameterized', 1: 'single' }
const CAP_ICON = { 5: 'monitor', 4: 'tree', 3: 'layers', 2: 'grid', 1: 'embed' }

// MAP ELEMENTS. These own a live WebGL context, so they are the rows the studio DESTROYS on
// deactivate (see HEAVY_ELEMENTS use in the template + select()). They are NOT iframed: every
// element in this tree mounts directly by its real tag, which is the whole point of the studio.
//
// ★ WHY THERE IS NO LONGER AN IFRAME MODE. Map rows used to render in a lazy iframe to dodge a
//   one-shot customElements.define collision. That hazard was MEASURED away (2026-09-22): the tree
//   has 19 distinct tags across 19 bundles and ZERO tags claimed by two bundles, so injecting every
//   bundle into one document registers 19 distinct tags and collides with nothing. Two map elements
//   were then proven to coexist in one real document (both defined, both populated, first map
//   unaffected). The guard was right when written; the naming discipline made it unnecessary.
//
// ★ WHAT REPLACED IT. The real cost of direct mounting is the browser's WebGL context budget
//   (commonly ~8-16). Exceeding it prints "Too many active WebGL contexts" and silently kills the
//   OLDEST context — getContext() never returns null and no event fires on the NEW canvas, so a
//   previously-visited map would go blank with no error anywhere. Panes are kept alive by v-show,
//   so 13 directly-mounted maps would hit that ceiling. Hence these rows use v-if and are torn down
//   on deactivate; everything else keeps v-show so tab switching stays instant and state survives.
// ★ THIS LIST IS MEASURED, NOT GUESSED — and it is NOT the old iframe list. The first version of
//   this set was the old IFRAME_ELEMENTS copied across, which answered a DIFFERENT question: "which
//   bundles wanted their own document?" A row is heavy if its element holds a live WebGL CONTEXT,
//   which a tag name cannot tell you: six tags NOT in the old list still held a canvas after a full
//   29-tab sweep (dashboard-plus-grid, research-dashboard-map, demo-map, all-people-groups,
//   country-posters-map, key-cities-map) because they embed maps as nested CHILDREN. Counting
//   canvases only inside the ACTIVE pane said "1" and looked clean; counting them across the whole
//   document said 7. Measure the document, not the pane.
//   To re-derive after adding a bundle: sweep every tab, then count canvases per pane document-wide.
const HEAVY_ELEMENTS = new Set([
  // map elements proper
  'doxa-research-map', 'doxa-simple-map', 'cities-internet-map', 'gospel-resources-map',
  'my-upg-100-list-map', 'doxa-map', 'doxa-maps-spa',
  // composites that NEST a map, so they own a context too (measured, see above)
  'dashboard-plus-grid', 'research-dashboard-map', 'demo-map', 'all-people-groups',
  'country-posters-map', 'key-cities-map', 'research-map-plus-grid',
  // gospel-internet-board owns up to TWO contexts (its map and the language-tree whiteboard).
  // A profile can also declare "heavy": true in its .meta.json, which the manifest carries (below).
  'gospel-internet-board'
])

// SUPERSEDED BUNDLES — built, still embeddable, but NOT shown in the studio. big-picture is a dark
// header of search + four filters over the people-groups grid with the grid's own (identical)
// controls switched off: to a developer it is the grid a second time under a misleading name
// (2026-09-24: the people-groups grid must not appear twice as a clone of itself). The real Big Picture is dashboard-plus-grid (the app shell's first tab), and
// doxa-maps-spa's NOT_EXPERIMENTAL already hides big-picture for the same reason.
const STUDIO_HIDDEN = new Set(['big-picture'])

// THE STUDIO'S OWN WORDS, in every locale the switcher offers (library/i18n/locales/<lc>/studio.json,
// held to the same key parity as every other catalog by check:i18n-parity). The studio has no
// vue-i18n instance — it is a shell, not a ProfileLoader plugin — so it looks strings up directly
// and falls back to English per key. Before this, choosing a language translated the plugins
// but left the studio's own chrome in English.
const STUDIO_STRINGS = {}
for (const [path, mod] of Object.entries(import.meta.glob('../../library/i18n/locales/*/studio.json', { eager: true, import: 'default' }))) {
  const m = path.match(/locales\/([^/]+)\/studio\.json$/)
  if (m) STUDIO_STRINGS[m[1]] = mod
}

// DISPLAY NAMES — what a row is CALLED. Display only: the row key, the URL hash, the stored last-tab and
// the <tag> under the name are unchanged, so links and memory keep working. AUTO-DETECTED (never
// hardcoded): the plugin's own <profile>.meta.json label, carried by the manifest; failing that, a
// readable name made from its ids ("Gospel Internet · Board"), never a bare profile id (a row once read
// just "board"). DISPLAY_NAME is an OVERRIDE only, and empty unless a label must differ from the meta.
const DISPLAY_NAME = {}
const humanize = (id) => String(id).split(/[-_]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
function rowLabel(bundle, p) {
  const key = bundle + '/' + p.profile
  if (DISPLAY_NAME[key]) return DISPLAY_NAME[key]
  // A meta label often ends in an aside for the reader of the JSON ("Research Gallery (vertical-tab app
  // shell: …)"); the rail shows the name before it.
  const own = typeof p.label === 'string' ? p.label.replace(/\s*\([^()]*\)\s*$/, '').trim() : ''
  if (own) return own
  return p.profile === bundle ? humanize(bundle) : humanize(bundle) + ' · ' + humanize(p.profile)
}



// Corner widgets: a round chat-style bubble; open, a small panel above it (a bottom sheet on a phone).
const WIDGET_CSS = `
[data-studio-widgets]{position:fixed;z-index:2147483647;display:flex;flex-direction:column;gap:10px;pointer-events:none}
[data-studio-widgets] > *{pointer-events:auto}
[data-studio-widgets="bottom-right"]{bottom:max(16px,env(safe-area-inset-bottom));right:max(16px,env(safe-area-inset-right));align-items:flex-end}
[data-studio-widgets="bottom-left"]{bottom:max(16px,env(safe-area-inset-bottom));left:max(16px,env(safe-area-inset-left));align-items:flex-start}
[data-studio-widgets="top-right"]{top:max(16px,env(safe-area-inset-top));right:max(16px,env(safe-area-inset-right));align-items:flex-end}
[data-studio-widgets="top-left"]{top:max(16px,env(safe-area-inset-top));left:max(16px,env(safe-area-inset-left));align-items:flex-start}
[data-widget]{display:flex;flex-direction:column;align-items:inherit;gap:10px}
[data-studio-widgets^="top"] [data-widget]{flex-direction:column-reverse}
[data-widget-panel]{display:none;position:relative;width:360px;max-width:calc(100vw - 32px);height:min(480px,calc(100vh - 110px));height:min(480px,calc(100dvh - 110px - env(safe-area-inset-top) - env(safe-area-inset-bottom)));border-radius:16px;overflow:hidden;background:#0b0f14;box-shadow:0 12px 40px rgba(0,0,0,.35)}
[data-widget-panel][data-open]{display:block}
[data-widget-bubble]{position:relative;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:1px solid #334155;border-radius:999px;background:#0f172a;color:#e5e7eb;font:600 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3)}
[data-widget-bubble]:focus-visible{outline:3px solid #7dd3fc;outline-offset:3px}
[data-wb-icon]{display:grid;place-items:center;flex:none;color:#38bdf8}
[data-wb-icon] svg,[data-wb-chev] svg{width:20px;height:20px;display:block}
[data-wb-dot],[data-wb-chev]{display:none;flex:none}
[data-wb-dot]{position:absolute;top:1px;right:1px;width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 2px #0f172a}
[data-widget-bubble][aria-expanded="true"] [data-wb-chev]{display:block}
[data-widget-bubble][aria-expanded="true"] [data-wb-icon]{display:none}
[data-widget-bubble][data-listening="true"]{border-color:#ef4444;background:#1f0f12;animation:studio-widget-pulse 1.4s ease-out infinite}
[data-widget-bubble][data-listening="true"] [data-wb-dot]{display:block}
[data-widget-bubble][data-listening="true"] [data-wb-icon]{color:#6b7280}
[data-widget-bubble][data-speaking="true"] [data-wb-icon]{color:#4ade80;animation:studio-widget-speak .5s ease-in-out infinite alternate}
@keyframes studio-widget-pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.55)}70%{box-shadow:0 0 0 12px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
@keyframes studio-widget-speak{from{transform:scale(1)}to{transform:scale(1.18)}}
@media (prefers-reduced-motion:reduce){[data-widget-bubble][data-listening="true"],[data-widget-bubble][data-speaking="true"] [data-wb-icon]{animation:none}}
@media (max-width:480px){
  [data-studio-widgets^="bottom"]{bottom:max(8px,env(safe-area-inset-bottom))}
  [data-studio-widgets$="right"]{right:max(8px,env(safe-area-inset-right))}
  [data-studio-widgets$="left"]{left:max(8px,env(safe-area-inset-left))}
  [data-widget-panel]{width:calc(100vw - 16px);max-width:none;height:60vh;height:60dvh}
}`
const WIDGET_ICON_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/></svg>'
const WIDGET_ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
// The bubble: a mic in a small circle (a chevron while its panel is open), a red dot while it records. It shows
// no text: its name is its accessible label and tooltip, so it takes the corner and nothing more.
const WIDGET_PILL = '<span data-wb-dot aria-hidden="true"></span><span data-wb-icon>' + WIDGET_ICON_OPEN + '</span><span data-wb-chev>' + WIDGET_ICON_CLOSE + '</span>'

export default defineComponent({
  name: 'PluginStudio',
  // A host's attributes (style="height:…", class, id) belong on the <plugin-studio> HOST, not on the
  // layout inside it. Falling through, a host's inline style also landed on the shell root — the trap
  // that made the Prayer Walk Planner 76px tall in the gallery. Everything the layout needs (dir,
  // title, labels) is bound explicitly below.
  inheritAttrs: false,
  components: { VerticalTabsLayout, StudioTree },
  props: {
    treeBase: { type: String, default: '' },
    profileConfig: { type: [String, Object], default: '' },
    // The map engine, as an attribute as well as a profile-config key — the studio previews map
    // plugins, so a host showing it to partners wants to flip both at once. Forwarded to every pane
    // below; an unrecognised value is ignored there rather than passed on.
    provider: { type: String, default: '' },
    // NOT `title` — that name collides with the NATIVE HTMLElement.title property.
    // defineCustomElement maps every prop to an attribute, and `title` already exists on every
    // element (the tooltip), so Vue warned on EVERY mount:
    //     [Vue warn]: Custom element prop "title" conflicts with an existing property on the
    //     element and will overwrite it.
    // Benign in effect — nothing here wants a tooltip — but console noise is not free: a warning
    // repeated on every mount is where a real error goes to hide, and this repo has already paid
    // for that once (a thrown setup() silently removed three buttons behind ignorable noise).
    // Renaming the PROP is safe because nothing outside ever set it: no host passes title=, no
    // profile-config reads cfg.title, and the value is only forwarded to VerticalTabsLayout — an
    // ordinary Vue component, never a custom element, so its own `title` prop has no collision.
    // Empty = the localised "Plugin Studio" (studio.json `title`); a host may still set its own.
    heading: { type: String, default: '' },
    tokenUrl: { type: String, default: '' },
    tk: { type: String, default: '' }
  },
  setup() {
    // Inject the studio's content-area CSS into the shadow root (the shell CSS now belongs to the
    // shared VerticalTabsLayout, which self-injects). Idempotent-by-key; the shell + this content
    // together render the full studio inside its shadow DOM.
    useShadowStyles(PS_SHADOW_CSS, 'plugin-studio')
    const injectedBase = inject('psTreeBase', '')
    return { injectedBase }
  },
  data() {
    return {
      activeKey: '',
      embedOpen: false,
      // i18n locale switcher (reuses app-wrapper-material/languages.js — persisted, offline, no dep).
      // ★ THE HOST'S LOCALE FIRST. A host that embeds the studio with profile-config.locale (the
      // library's contract, read by ProfileLoader) was ignored: the switcher seeded from localStorage /
      // the browser, and every pane was handed THAT — check:host-locale-contract measured 0 Arabic
      // characters with locale:"ar" against 2077 at ?lang=ar. Ladder, as in i18n/index.js detectLocale:
      // profile-config locale/lang → ?lang= / ?locale= → the reader's saved switcher choice → browser.
      // A host- or URL-given locale is NOT persisted: it is the host's choice, not the reader's.
      locale: this.initialLocale(),
      localeOpen: false,
      // Map token control — the reader's own entry, persisted in localStorage (never in the build).
      settingsOpen: false,
      headerHidden: readStored(HEADER_KEY) === '1',
      engineOpen: false,
      userProvider: readStored(PROVIDER_KEY),
      tokenBusy: false,
      tokenErr: '',
      tokenDraft: readStored(TOKEN_KEY),
      urlDraft: readStored(TOKEN_URL_KEY),
      userTk: readStored(TOKEN_KEY),
      userTokenUrl: readStored(TOKEN_URL_KEY),
      fetchedTk: '',
      bakedTk: '',
      hostProvider: '',
      // EVERY locale the library carries, not the public site's six: the studio exists to exercise props.
      switcherLangs: LANGUAGES,
      // rows keyed by "<bundle>/<profile>"; each carries its resolved nesting state.
      rows: [],         // flat list built from the manifest (grouped for display via `groups`)
      // raw manifest bundles, kept ONLY so composeGroups() can read each bundle's `composes` list —
      // rows[] already dropped that field on the way to a flat row, and re-fetching the manifest a
      // second time just to read one property would be silly.
      manifestBundles: []
    }
  },
  computed: {
    cfg() {
      let pc = this.profileConfig
      if (typeof pc === 'string') { try { pc = pc ? JSON.parse(pc) : {} } catch { pc = {} } }
      return pc && typeof pc === 'object' ? pc : {}
    },
    base() {
      const raw = (this.treeBase || this.cfg.treeBase || this.injectedBase || '').trim()
      if (!raw) return ''
      return raw.replace(/\/+$/, '') + '/'
    },
    flatRows() { return this.rows },
    // Group the flat rows by capability, ordered 5 → 1, dropping empty tiers.
    groups() {
      const byCap = {}
      for (const r of this.rows) (byCap[r.cap] = byCap[r.cap] || []).push(r)
      return [5, 4, 3, 2, 1]
        .filter(c => byCap[c] && byCap[c].length)
        .map(c => ({ cap: c, label: CAP_LABEL[c] || ('capability ' + c), rows: byCap[c] }))
    },
    // The RAIL MODEL the Explorer tree (src/StudioTree.vue) paints: ONE list, highest capability to
    // lowest (2026-09-24: everything in the studio ordered from highest capability to lowest, the
    // composition shown in the capability sidebar so the interoperability and the elements that go
    // into each plugin can be understood, and all of it collapsible).
    //
    //   CAP 5 → CAP 1 sections. Every plugin has exactly ONE canonical node (depth 0) in its own tier,
    //   and a composite's parts hang under it (depth 1+), ordered by capability at each level, folded
    //   until opened.
    //
    // ★ HOW THE REPEATS STAY ONE IDENTITY. A part node carries `target` = the canonical row key, so
    //   people-groups-grid under dashboard-plus-grid opens the SAME pane as its own CAP 2 entry and
    //   highlights both. afe6abe removed the first rail folders because six independent nodes for one
    //   plugin left no single name to report it by; a node that only TARGETS the canonical row has no
    //   identity of its own, so nesting and the one-name rule coexist.
    treeSections() {
      // ★ LAID OUT LIKE plugin-designs/ (2026-09-26): one FOLDER per BUNDLE, its ELEMENTS inside,
      // bundles grouped by their HIGHEST capability (5 → 1) and sorted by name within a group. A bundle
      // with one element is shown as that element (a folder of one is noise). A composite's parts still
      // hang under its element, folded, each TARGETING its canonical row (one identity per plugin).
      const treeOf = new Map(this.compositionTrees.map(t => [t.nodes[0].selects, t]))
      const byBundle = new Map()
      for (const r of this.rows) { if (!byBundle.has(r.bundle)) byBundle.set(r.bundle, []); byBundle.get(r.bundle).push(r) }
      // ★ EVERY PLUGIN IS CAPABILITY 1-5 (2026-09-27, replacing the Experimental section added
      // earlier the same day): each bundle sits in the section of its highest capability. A bundle
      // whose .meta.json "stage" is not production says so on its own rows instead; the gallery reads the
      // same field.
      const bundles = [...byBundle.entries()].map(([bundle, rows]) => ({ bundle, rows, cap: Math.max(...rows.map(r => r.cap)) }))
      const groups = [5, 4, 3, 2, 1].map(cap => ({ cap, group: bundles.filter(b => b.cap === cap).sort((x, y) => x.bundle.localeCompare(y.bundle)) }))
      return groups.map(({ cap, group }) => {
        if (!group.length) return null
        const nodes = []
        const pushElement = (r, depth, parent) => {
          const t = treeOf.get(r.key)
          nodes.push({
            id: r.key, parent, depth, label: r.label, desc: (r.stage === 'production' ? '' : this.tr('stageExperimental') + ' · ') + 'cap ' + r.cap + ' · ' + r.tag, icon: r.icon, target: r.key, canonical: true,
            kids: t ? t.nodes[0].kids : 0, title: r.label + ' · <' + r.tag + '> · CAP ' + r.cap + ' ' + this.tr('cap' + r.cap)
          })
          if (!t) return
          const nid = (id) => (id === 0 ? r.key : r.key + '>' + id)
          for (const n of t.nodes.slice(1)) {
            nodes.push({
              id: nid(n.id), parent: nid(n.ancestors[n.ancestors.length - 1]), depth: depth + n.depth,
              label: n.label, part: !!n.part, target: n.selects || '', canonical: false,
              icon: n.part ? 'dots' : (CAP_ICON[n.cap] || 'embed'),
              desc: n.part ? this.tr('noStandalone') : 'cap ' + n.cap + ' · ' + n.tag,
              kids: n.kids || 0,
              title: n.part ? n.label + ' · ' + this.tr('partOf', { name: r.label })
                : n.label + ' · <' + n.tag + '> · CAP ' + n.cap + ' ' + this.tr('cap' + n.cap)
            })
          }
        }
        for (const b of group) {
          const rows = [...b.rows].sort((x, y) => y.cap - x.cap || x.label.localeCompare(y.label))
          if (rows.length === 1) { pushElement(rows[0], 0, ''); continue }
          const fid = 'bundle:' + b.bundle
          nodes.push({
            id: fid, parent: '', depth: 0, label: b.bundle, desc: this.tr('elementsCount', { n: rows.length }),
            icon: 'folder', target: rows[0].key, canonical: false, folder: true, kids: rows.length,
            title: b.bundle + ' · plugin-designs/' + b.bundle + '/ · ' + rows.length + ' ' + this.tr('elements')
          })
          for (const r of rows) pushElement(r, 1, fid)
        }
        return { id: 'cap-' + cap, cap, label: this.tr('cap' + cap), title: this.tr('cap' + cap) + ' · ' + (MACHINE_TYPE[cap] || ''), icon: CAP_ICON[cap] || 'embed', nodes }
      }).filter(Boolean)
    },
    // ★ ONE TREE PER COMPOSITE, built ENTIRELY from the manifest's `composes` edges — no bundle names
    // or child lists live in this file, so a new composite appears here with zero edits.
    //
    // Depth is FULL. The acceptance test is
    // "can I point at a defect and NAME the single element responsible" — and a defect in the grid
    // inside big-picture inside this studio is two levels down, so a depth-1 list could not name it.
    // A child is expanded only when it is itself a composite (CAP 4+) whose bundle declares edges; a
    // leaf PROFILE of a composite bundle (country-posters/countries-map) is a leaf. `path` guards a
    // cycle, so a manifest that ever declares A→B→A costs one row, not a hung rail.
    //
    // A ref that resolves to no published plugin (big-picture's bp-research-header) is KEPT as a
    // `part` row pointing at its parent. The worked example is exactly this split: Big
    // Picture = research header on top + people-groups grid below, and a reviewer must be able to say
    // which half is broken. Dropping the part would hide half of that answer; it cannot be a link to its
    // own page because it has none, so it opens the composite it lives in.
    compositionTrees() {
      const out = []
      // Every node records `ancestors` (the ids of the nodes above it) and, if anything was nested
      // under it, `kids` — which is what lets the rail fold each level independently.
      const walk = (row, depth, path, nodes, ancestors) => {
        const b = this.manifestBundles.find(x => x.bundle === row.bundle)
        const refs = (row.cap >= 4 && b && b.composes) || []
        const kids = []
        const parts = []
        const seen = new Set()
        for (const ref of refs) {
          const child = this.resolveRef(ref, row.bundle)
          if (!child) { parts.push(ref); continue }
          if (child.key === row.key || seen.has(child.key)) continue
          seen.add(child.key)
          kids.push(child)
        }
        kids.sort((a, b2) => b2.cap - a.cap || a.label.localeCompare(b2.label))
        for (const k of kids) {
          const node = { id: nodes.length, label: k.label, tag: k.tag, cap: k.cap, selects: k.key, depth: depth + 1, ancestors, kids: 0 }
          nodes.push(node)
          const before = nodes.length
          if (!path.has(k.key)) walk(k, depth + 1, new Set([...path, k.key]), nodes, [...ancestors, node.id])
          node.kids = nodes.filter((n, i) => i >= before && n.depth === depth + 2).length
        }
        // Unpublished parts have no tier, so they sort LAST — below every capability — and open the
        // composite they live in.
        for (const ref of parts) nodes.push({ id: nodes.length, label: ref, part: true, selects: row.key, depth: depth + 1, ancestors, kids: 0 })
      }
      for (const b of this.manifestBundles) {
        if (!b.composes || !b.composes.length || STUDIO_HIDDEN.has(b.bundle)) continue
        // The composite's own row: its highest-capability profile (rows are sorted cap desc).
        // plugin-studio has no row (it never lists itself), so it has no tree either: every row of
        // this rail already IS its composition.
        const own = this.rows.find(r => r.bundle === b.bundle)
        if (!own) continue
        const nodes = [{ id: 0, label: own.label, tag: own.tag, cap: own.cap, selects: own.key, depth: 0, ancestors: [] }]
        walk(own, 0, new Set([own.key]), nodes, [0])
        nodes[0].kids = nodes.filter(n => n.depth === 1).length
        if (nodes.length > 1) out.push({ bundle: b.bundle, nodes })
      }
      return out
    },
    active() { return this.rows.find(r => r.key === this.activeKey) || null },
    // ★ SAY WHAT IS BEING COUNTED (2026-09-23). This read "18 bundles · 27 elements" while the
    // manifest holds 19 and 28, because rowsFromManifest skips the studio itself — it cannot be one
    // of its own tabs. The arithmetic was always right; the LABEL was ambiguous, and it sat beside a
    // golden-path self-test that reports 19/28 from the same manifest. Two authoritative surfaces
    // disagreeing by one, with nothing on either saying why, is how a reader stops trusting both.
    // "listed here" is the whole fix: it names the population, so the difference from the catalog
    // total reads as a deliberate exclusion rather than an off-by-one.
    // The token every pane gets, in precedence order: the reader's pasted token, a token fetched from
    // the reader's token URL, a token the HOST passed (tk attribute / profile-config), and last the
    // token built into the page (window.MAP_TOKEN, baked at build time).
    effectiveTk() {
      return this.userTk || this.fetchedTk || this.tk || this.cfg.tk || this.bakedTk || ''
    },
    effectiveProvider() {
      // Case-insensitive, as resolveMapProvider is: a host's provider="MapLibre" was dropped here.
      const p = String(this.userProvider || this.provider || this.cfg.provider || '').toLowerCase().trim()
      return p === 'maplibre' || p === 'mapbox' ? p : ''
    },
    engines() {
      return [
        { id: '', label: this.tr('engineDefault'), note: '' },
        { id: 'mapbox', label: 'Mapbox', note: this.tr('engineMapboxNote') },
        { id: 'maplibre', label: 'MapLibre', note: this.tr('engineMaplibreNote') },
      ]
    },
    engineLabel() {
      return this.userProvider === 'mapbox' ? 'Mapbox' : this.userProvider === 'maplibre' ? 'MapLibre' : this.tr('engineDefault')
    },
    tokenSource() {
      if (this.userTk) return 'yours'
      if (this.fetchedTk) return 'url'
      if (this.tk || this.cfg.tk || this.bakedTk) return 'built'
      return 'none'
    },
    tokenStatus() {
      if (this.effectiveProvider === 'maplibre') return this.tr('tokenNotNeeded')
      if (this.tokenSource === 'yours') return this.tr('tokenSourceYours')
      if (this.tokenSource === 'url') return this.tr('tokenSourceUrl', { url: this.userTokenUrl })
      if (this.tokenSource === 'built') return this.tr('tokenSourceBuilt')
      return this.tr('tokenSourceNone')
    },
    countLabel() {
      const nb = new Set(this.rows.map(r => r.bundle)).size
      return this.tr('countLabel', { bundles: nb, elements: this.rows.length })
    },
    activeLang() { return getLanguage(this.locale) || { code: this.locale, flag: '🌐', nativeName: this.locale } },
    // Right-to-left for a right-to-left language (languages.js marks Arabic dir:'rtl'), which is what
    // switches on VerticalTabsLayout's :dir(rtl) mirror (5e7f73d0), which doxa-maps-spa turns on
    // the same way. Without this the mirror compiled into the studio but never applied.
    uiDir() { return (this.activeLang && this.activeLang.dir) === 'rtl' ? 'rtl' : 'ltr' }
  },
  mounted() {
    // Read once: after applyToken sets window.MAP_TOKEN it would no longer be "the page's own".
    this.bakedTk = (typeof window !== 'undefined' && window.MAP_TOKEN) || ''
    // The HOST's own engine switch, kept so "each map's own" restores it instead of deleting it.
    this.hostProvider = (typeof window !== 'undefined' && typeof window.MAP_PROVIDER === 'string') ? window.MAP_PROVIDER : ''
    this.publishProvider()   // a host provider (attribute/profile-config) reaches nested maps too, chosen or not
    if (this.userTk) this.publishToken()
    else if (this.userTokenUrl || this.tokenUrl || this.cfg.tokenUrl) {
      // A token from a URL arrives AFTER the first pane mounted; re-mount so that pane gets it too.
      this.fetchToken(this.userTokenUrl || this.tokenUrl || this.cfg.tokenUrl)
        .then((t) => { if (t && t !== this.fetchedTk) { this.fetchedTk = t; this.publishToken(); this.remountPanes() } })
        .catch(() => {})
    }
    this.loadManifest()
    // Back / Forward re-open the tab the address names; they never write (useViewAddress.js says why).
    this._offAddress = onAddressChange(({ tab }) => {
      const key = this.keyOfTab(tab)
      if (key) this.select(key, { fromHistory: true })
      else if (this.rows.length) this.select(this.rows[0].key, { fromHistory: true })
    })
    // A nested composite's own choice (its open pane, its place) is announced up to here and written beside ?tab=,
    // while this page owns its address. Only pane and place: the tab is Studio's own.
    this._offOwn = ownAddress(this.$el, () => urlOwnerOf(this.cfg))
  },
  // The corner-widget hosts live on window.__doxaStudioWidgets so a HOT UPDATE remounts Studio onto
  // the same hosts and a live widget (Rudder) keeps its state. A real unmount must release them, or
  // the hosts and every widget element in them stay pinned on the page after Studio is gone.
  beforeUnmount() {
    // FIRST, before the hot-update return below: a remounted Studio adds its own listener, and a kept one would
    // re-apply every Back twice.
    if (this._offAddress) { this._offAddress(); this._offAddress = null }
    if (this._offOwn) { this._offOwn(); this._offOwn = null }
    if (import.meta.hot) return
    const W = window.__doxaStudioWidgets
    if (W && W.hosts) for (const h of Object.values(W.hosts)) { try { h.remove() } catch (_) {} }
    delete window.__doxaStudioWidgets
  },
  methods: {
    // ── MAP TOKEN ────────────────────────────────────────────────────────────────────────────────
    // A token service answers with JSON ({token|tk|accessToken}) or a bare string — the same contract
    // the leaf pages' token ladder accepts. Only a PUBLIC token (pk.…) is ever used: this page is public.
    async fetchToken(url) {
      if (!/^https?:\/\//i.test(url)) throw new Error('not an http(s) URL')
      let res
      try { res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' }) } catch (e) {
        throw new Error('the request was blocked or the server did not answer (cross-origin rules can do this)')
      }
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const text = (await res.text()).trim()
      let tok = text
      try { const j = JSON.parse(text); tok = (j && (j.token || j.tk || j.accessToken)) || (typeof j === 'string' ? j : '') } catch { /* a bare token string */ }
      tok = String(tok || '').trim()
      if (tok.startsWith('sk.')) throw new Error(this.tr('tokenSecret'))
      if (!tok.startsWith('pk.')) throw new Error(this.tr('tokenNotPk'))
      return tok
    },
    async applyToken() {
      this.tokenErr = ''
      const tk = this.tokenDraft, url = this.urlDraft
      if (tk.startsWith('sk.')) { this.tokenErr = this.tr('tokenSecret'); return }
      if (tk && !tk.startsWith('pk.')) { this.tokenErr = this.tr('tokenNotPk'); return }
      this.tokenBusy = true
      try {
        let fetched = ''
        if (!tk && url) {
          try { fetched = await this.fetchToken(url) } catch (e) { this.tokenErr = this.tr('tokenUrlFailed', { why: e.message }); return }
        }
        this.userTk = tk
        this.userTokenUrl = tk ? '' : url
        this.fetchedTk = fetched
        writeStored(TOKEN_KEY, this.userTk)
        writeStored(TOKEN_URL_KEY, this.userTokenUrl)
        this.publishToken()
        this.remountPanes()
        this.settingsOpen = false
      } finally { this.tokenBusy = false }
    },
    // Collapse / restore the header (the props panel). Remembered in this browser.
    setHeaderHidden(v) {
      this.headerHidden = !!v
      this.settingsOpen = false; this.engineOpen = false; this.localeOpen = false
      writeStored(HEADER_KEY, v ? '1' : '')
    },
    setProvider(id) {
      this.engineOpen = false
      if (id === this.userProvider) return
      this.userProvider = id
      writeStored(PROVIDER_KEY, id)
      this.publishProvider()
      this.remountPanes()
    },
    // Maps nested inside a composite fall back to window.MAP_PROVIDER (resolveMapProvider's ladder:
    // profile-config.provider → ?provider= → window.MAP_PROVIDER), so the choice is published there too.
    publishProvider() {
      if (typeof window === 'undefined') return
      if (this.effectiveProvider) window.MAP_PROVIDER = this.effectiveProvider
      else if (this.hostProvider) window.MAP_PROVIDER = this.hostProvider
      else if ('MAP_PROVIDER' in window) delete window.MAP_PROVIDER
    },
    clearToken() {
      this.tokenDraft = ''; this.urlDraft = ''; this.tokenErr = ''
      this.userTk = ''; this.userTokenUrl = ''; this.fetchedTk = ''
      writeStored(TOKEN_KEY, ''); writeStored(TOKEN_URL_KEY, '')
      this.publishToken()
      this.remountPanes()
    },
    // Maps nested INSIDE a composite read window.MAP_TOKEN rather than their parent's profile-config,
    // so the effective token is published there too (and the page's own token restored on clear).
    publishToken() {
      if (typeof window === 'undefined') return
      // Through useSharedMapToken, never `delete`: deleting removed its bridge for good (U3).
      if (this.effectiveTk) { publishMapToken(this.effectiveTk); if (window.MAP_TOKEN !== this.effectiveTk) window.MAP_TOKEN = this.effectiveTk }
      else clearMapToken()
    },
    // Release every mounted pane (frees its map) and re-mount the one on screen with the new token;
    // the others pick it up when they are next selected.
    remountPanes() {
      for (const row of this.rows) if (row.mounted) this.releaseRow(row)
      const active = this.active
      if (active) this.$nextTick(() => { if (this.activeKey === active.key) this.mountElement(active) })
    },
    // Localised studio string: current locale → English → the key itself; {name}-style placeholders.
    tr(key, vars) {
      const base = (this.locale || 'en').split('-')[0]
      let str = (STUDIO_STRINGS[this.locale] || {})[key] || (STUDIO_STRINGS[base] || {})[key] || (STUDIO_STRINGS.en || {})[key] || key
      if (vars) for (const k in vars) str = str.split('{' + k + '}').join(String(vars[k]))
      return str
    },
    // Resolve one `composes` entry to a studio row. The manifest's refs are NOT one shape: an
    // element TAG, a "<bundle>/<profile>" row KEY, a BUNDLE name whose tag differs,
    // or a bare SIBLING profile name (gospel-resources composes "resources-map", "data-tables" — its
    // own profiles). Try sibling → key → tag → bundle; first match wins. null = published nowhere.
    resolveRef(ref, fromBundle) {
      return (fromBundle && this.rows.find(r => r.key === fromBundle + '/' + ref)) ||
        this.rows.find(r => r.key === ref) ||
        this.rows.find(r => r.tag === ref) ||
        this.rows.find(r => r.bundle === ref) || null
    },
    setSlot(key, el) { if (el) this._slots = Object.assign(this._slots || {}, { [key]: el }) },
    // Switch preview language. languages.js's contract: switching = re-setting profile-config.locale
    // on the mounted element. Persist, then re-set it on the element this pane already holds. Every
    // pane now carries a real element, so there is ONE path here — no per-mode branch.
    initialLocale() {
      let pc = this.profileConfig
      if (typeof pc === 'string') { try { pc = pc ? JSON.parse(pc) : {} } catch { pc = {} } }
      let q = ''
      try { const u = new URLSearchParams(window.location.search); q = u.get('lang') || u.get('locale') || '' } catch { /* no window */ }
      const given = (pc && (pc.locale || pc.lang)) || q
      return given ? normaliseLocale(given) : loadLocale()
    },
    // ONE builder for a pane's profile-config, used by the mount AND by a language switch. The switch
    // used to rebuild it by hand with only profile/instanceId/locale/tk — dropping tokenUrl, provider
    // and treeBase, so switching language flipped a maplibre pane back to mapbox.
    paneConfig(row, locale) {
      const pc = { profile: row.profile, instanceId: 'ps-' + row.key.replace(/\//g, '-'), locale }
      if (this.effectiveTk) pc.tk = this.effectiveTk
      const tokenUrl = this.userTokenUrl || this.tokenUrl || this.cfg.tokenUrl
      if (tokenUrl) pc.tokenUrl = tokenUrl
      if (this.effectiveProvider) pc.provider = this.effectiveProvider
      if (this.base) pc.treeBase = this.base
      return pc
    },
    setLocale(code) {
      this.locale = code
      this.localeOpen = false
      saveLocale(code)
      try {
        // EVERY mounted pane, not only the one on screen: a kept-alive pane showed the old language
        // when the reader came back to it.
        for (const row of this.rows) {
          if (!row.mounted) continue
          const slot = this._slots && this._slots[row.key]
          const el = slot && slot.firstElementChild
          if (el && el.setAttribute) el.setAttribute('profile-config', JSON.stringify(this.paneConfig(row, code)))
        }
      } catch { /* non-fatal: the switcher still persists + updates the UI */ }
    },
    resolve(ref) {
      const raw = String(ref)
      // AN ALREADY-ABSOLUTE REF IS RETURNED UNTOUCHED — prefixing it produced a double slash and
      // 404'd EVERY tab. Measured 2026-09-22 after tree-base was introduced for the dev server:
      //     404 /__plugin-gallery//plugin-designs/big-picture/index.js
      //                          ^^ base + an already-rooted path
      // and the studio showed "Could not load <every plugin>" on all 29 tabs. The built tree hands
      // RELATIVE refs (bundle/profile/index.html), so concatenation was always safe there and the
      // assumption went unnoticed; the dev manifest hands ROOTED ones (/plugin-designs/..., /__leaf/...).
      // A URL that already starts at the root needs no base by definition, so this is the correct
      // rule for both trees rather than a dev-only special case.
      if (/^(https?:)?\/\//.test(raw) || raw.startsWith('/')) return raw
      const r = raw.replace(/^\.\//, '')
      // Join through exactly one slash: `base` is normalised to a trailing "/" by base(), but a
      // caller-supplied tree-base may not be, and that is precisely how the 404 above was born.
      if (this.base) return this.base.replace(/\/+$/, '') + '/' + r
      return '../' + r     // sibling bundle folders are one level up from this bundle's folder
    },
    // Build the studio rows from the built tree's manifest.json. Each profile becomes one row,
    // its capability read from the baked tier (manifest profile.type) → capFor. Falls back to the
    // baked compact registry (index.js provides window.__psBaked) under file:// or on fetch fail.
    loadManifest() {
      const useModel = (m) => {
        this.manifestBundles = (m && m.bundles) || []
        this.rows = this.rowsFromManifest(m)
        this.setupWidgets()
        this.route()
      }
      const baked = (typeof window !== 'undefined' && window.__psBaked) || null
      if (typeof fetch === 'function' && typeof location !== 'undefined' && location.protocol !== 'file:') {
        // Route through resolve() so the single-slash join + absolute-ref rule apply here too;
        // building this URL independently is how the two paths drifted apart in the first place.
        const url = this.base ? this.resolve('manifest.json') : '../manifest.json'
        fetch(url, { cache: 'no-cache' })
          .then(r => (r.ok ? r.json() : null))
          .then(m => useModel(m || baked || { bundles: [] }))
          .catch(() => useModel(baked || { bundles: [] }))
      } else {
        useModel(baked || { bundles: [] })
      }
    },
    rowsFromManifest(m) {
      const out = []
      for (const b of (m.bundles || [])) {
        // never list the studio itself as one of its own tabs
        if (b.bundle === 'plugin-studio' || STUDIO_HIDDEN.has(b.bundle)) continue
        for (const p of (b.profiles || [])) {
          // ★ MOUNT ONLY A TAG THE BUNDLE DEFINES. A profile's `element` is copied from its @element
          // JSDoc, and that can name a tag nothing defines: country-posters-mfe's says
          // <country-posters-mfe>, while the bundle defines only <country-posters-map> (and gospel's
          // did the same until 5418a79c). Trusting it put "never registered" on a working plugin.
          // `elements` is what the bundle's index.js actually registers, so it is the authority.
          const defined = (b.elements && b.elements.length) ? b.elements : null
          const tag = (p.element && (!defined || defined.includes(p.element)) ? p.element : null)
            || (defined && defined[0]) || p.element || b.bundle
          const cap = capFor(p.type || 'single')
          // A heavy row owns a live WebGL context, so it is torn down on deactivate rather than
          // hidden. Keyed by tag OR bundle so a bundle whose profiles differ still resolves.
          const heavy = HEAVY_ELEMENTS.has(tag) || HEAVY_ELEMENTS.has(b.bundle) || p.heavy === true
          out.push({
            key: b.bundle + '/' + p.profile,
            bundle: b.bundle,
            // production | experimental, from the bundle's .meta.json via the manifest (never a list here)
            stage: b.stage === 'production' ? 'production' : 'experimental',
            label: rowLabel(b.bundle, p),
            // The REAL profile id, handed to the element in profile-config. Never the label: a display
            // name would mount <doxa-maps-spa> with profile "Research Gallery", which it does not have.
            profile: p.profile,
            tag,
            cap,
            icon: CAP_ICON[cap] || 'embed',
            description: p.description || '',
            // CORNER WIDGET (BUILD-CORNER-WIDGET-CLASS): a profile whose .meta.json declares
            // "widget": { "corner": ... } is mounted once in a fixed corner of the Studio, not in a pane.
            widget: (p.widget && ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(p.widget.corner)) ? p.widget.corner : '',
            heavy,
            bundleJs: b.scriptUrl || (b.bundle + '/' + b.bundle + '.js'),
            embed: (p.embed && p.embed.script) || '',
            // runtime nesting state
            mounted: false, state: 'idle', error: ''
          })
        }
      }
      // stable: capability desc, then bundle, then label
      out.sort((a, b) => b.cap - a.cap || a.bundle.localeCompare(b.bundle) || a.label.localeCompare(b.label))
      return out
    },
    // ★ WHICH TAB OPENS, in priority order. The studio used to open on "select an element from the
    // list" instead of a tab. It opens the first tab, remembers in localStorage the tab you were on,
    // and a reload goes back to that tab.
    //
    //   1. ?tab=          — the view address (useViewAddress.js): a reload and a SENT link open it
    //   2. the URL hash   — the old shareable form (#bundle/profile); rewritten to ?tab= on first paint
    //   3. localStorage   — what you were last looking at, so a reload is not a fresh start
    //   4. the first row  — never leave the pane empty
    //
    // The first select() is a REPLACE (first paint); a reader's click is a PUSH (one Back step), written only
    // where this page owns its address (urlOwner 'app', baked into our own leaf page; a partner's page and a
    // framed leaf only read).
    //
    // Called once after the manifest lands, so `rows` is populated and every candidate can be
    // checked against it. A remembered key whose bundle was renamed or removed simply fails that
    // check and falls through to the first row — a stale key must never render an empty pane, which
    // is the very state this replaces.
    route() {
      const first = { firstPaint: true }
      const asked = this.keyOfTab(readViewKeys(typeof location !== 'undefined' ? location.search : '').tab)
      if (asked) { this.select(asked, first); return }
      const h = (typeof location !== 'undefined' && location.hash || '').replace(/^#\/?/, '')
      if (h && this.rows.some(r => r.key === h)) {
        this.select(h, first)
        // The old #bundle/profile link now reads as ?tab=; its hash goes, so the address has ONE form.
        if (urlOwnerOf(this.cfg) === 'app') commitUrl({ hash: '' })
        return
      }
      const remembered = this.readLastTab()
      if (remembered && this.rows.some(r => r.key === remembered)) { this.select(remembered, first); return }
      if (this.rows.length) this.select(this.rows[0].key, first)
    },
    // ★ A ROW'S TAB ID. A row key is "<bundle>/<profile>", and the address takes plain ids only (no "/"), so the tab
    // WRITTEN is "<bundle>__<profile>": stable, since a profile name another bundle adopts later cannot make a sent
    // link mean a different row. READ: that form, or a bare profile name while it names exactly one row (a typed
    // ?tab=poster-styles), else '' (the default tab opens).
    tabIdOf(key) { return String(key || '').replace('/', '__') },
    keyOfTab(id) {
      if (!id) return ''
      const full = id.includes('__') ? id.replace('__', '/') : ''
      if (full && this.rows.some(r => r.key === full)) return full
      const byProfile = this.rows.filter(r => r.key.split('/')[1] === id)
      return byProfile.length === 1 ? byProfile[0].key : ''
    },
    // Storage is keyed per HOST (pathname), because two cap-5 shells served from one origin would
    // otherwise fight over a single key and each reload would yank the other's tab.
    // ★ EVERY ACCESS IS GUARDED: localStorage THROWS on access in private mode and when storage is
    // disabled by policy, and an exception here would abort setup() and silently remove the whole
    // subtree — the studio would render blank rather than degrade. Remembering a tab is a
    // convenience; it must never be able to break the shell.
    storageKey() {
      const path = (typeof location !== 'undefined' && location.pathname) || ''
      return 'dx-studio-tab:' + path
    },
    readLastTab() {
      try { return window.localStorage.getItem(this.storageKey()) || '' } catch (_) { return '' }
    },
    writeLastTab(key) {
      try { window.localStorage.setItem(this.storageKey(), key) } catch (_) { /* storage unavailable */ }
    },
    select(key, { fromHistory = false, firstPaint = false } = {}) {
      // ★ BAIL BEFORE TOUCHING STATE if `key` names no real row. A composition-folder's TOP row can be
      // a SYNTHETIC head (see compositionTrees) for a composite that cannot list itself as one of its own
      // tabs (plugin-studio nesting <plugin-studio> would be infinite regress — same reasoning
      // doxa-maps-spa's NOT_EXPERIMENTAL already documents). Setting activeKey to a dead key BEFORE this
      // guard would blank the content pane (flatRows has no matching entry to render) with the "Choose
      // an element" hint also gone — a real, if minor, regression a synthetic row must never cause.
      if (!this.rows.some(r => r.key === key)) return
      // A corner widget is never mounted in a pane (one live instance, in its corner): picking it in the
      // rail opens its corner instead.
      const wrow = this.rows.find(r => r.key === key)
      if (wrow && wrow.widget) { this.openWidget(wrow, true); return }
      const prevKey = this.activeKey
      this.activeKey = key
      this.embedOpen = false
      // Release the outgoing HEAVY pane first, so at most one live map exists at a time. Its v-if
      // subtree is about to be torn down by the re-render anyway; resetting the row's state here is
      // what makes it re-mount correctly next time it is selected (a stale mounted:true would leave
      // an empty slot forever, because mountElement is skipped for an already-mounted row).
      if (prevKey && prevKey !== key) {
        const prev = this.rows.find(r => r.key === prevKey)
        if (prev && prev.heavy && prev.mounted) this.releaseRow(prev)
      }
      const row = this.rows.find(r => r.key === key)
      if (!row) return
      // Remember it AFTER confirming the row exists, so a bad key is never written back — otherwise
      // one stray select() would poison the next reload with a key that fails route()'s check.
      this.writeLastTab(key)
      // The view address: a reader's choice is a push, the first paint a replace, Back/Forward never writes.
      if (!fromHistory) writeViewKeys({ tab: this.tabIdOf(key) }, { owner: urlOwnerOf(this.cfg), push: !firstPaint, el: this.$el })
      // A heavy row's slot only exists after the v-if subtree renders, so wait a tick before
      // mounting into it — on the first activation the ref is null at this point.
      if (!row.mounted) this.$nextTick(() => { if (this.activeKey === row.key) this.mountElement(row) })
    },
    // Destroy a pane's nested element. Removing the host node runs the element's disconnected
    // lifecycle (onBeforeUnmount → map.remove()), which is what actually frees the GPU context —
    // verified by canvas count 1→0 and a webglcontextlost event, not merely by the node vanishing.
    releaseRow(row) {
      try {
        const slot = this._slots && this._slots[row.key]
        if (slot) slot.innerHTML = ''
      } catch { /* the row is reset either way; a failed cleanup must not wedge navigation */ }
      if (this._slots) delete this._slots[row.key]
      row.mounted = false
      row.state = 'idle'
      row.error = ''
    },
    // ── CORNER WIDGETS ────────────────────────────────────────────────────────────────────────────────
    // One fixed host per corner, created on document.body and kept in a PAGE-LEVEL singleton
    // (window.__doxaStudioWidgets), outside Vue's tree: a Studio hot update or remount finds the same host
    // and the same mounted element, so a widget like Rudder keeps its live state across HMR. Collapsed to a
    // button by default; the open state is remembered per widget.
    widgetStore() {
      if (!window.__doxaStudioWidgets) window.__doxaStudioWidgets = { hosts: {}, els: {} }
      return window.__doxaStudioWidgets
    },
    widgetHost(corner) {
      const W = this.widgetStore()
      if (!document.getElementById('studio-widget-css')) {
        const st = document.createElement('style')
        st.id = 'studio-widget-css'
        st.textContent = WIDGET_CSS
        document.head.appendChild(st)
      }
      if (W.hosts[corner] && W.hosts[corner].isConnected) return W.hosts[corner]
      const h = document.createElement('div')
      h.setAttribute('data-studio-widgets', corner)
      document.body.appendChild(h)
      W.hosts[corner] = h
      return h
    },
    setupWidgets() {
      for (const row of this.rows.filter(r => r.widget)) {
        const W = this.widgetStore()
        const host = this.widgetHost(row.widget)
        let box = host.querySelector(`[data-widget="${row.key}"]`)
        if (!box) {
          box = document.createElement('div')
          box.setAttribute('data-widget', row.key)
          const panel = document.createElement('div')
          panel.setAttribute('data-widget-panel', '')
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.setAttribute('data-widget-bubble', '')
          // A catalogue label per widget ("widget:<row key>"), not the row key (a review found the button read
          // the raw "rudder-voice"). Falls back to the row label for a widget with no key yet. The bubble is
          // an icon, so the label is its accessible name and tooltip.
          const wk = 'widget:' + row.key
          const wl = this.tr(wk)
          btn.setAttribute('aria-label', wl !== wk ? wl : row.label)
          btn.title = btn.getAttribute('aria-label')
          btn.setAttribute('aria-expanded', 'false')
          btn.innerHTML = WIDGET_PILL
          btn.addEventListener('click', () => this.openWidget(row, !panel.hasAttribute('data-open')))
          box.appendChild(panel); box.appendChild(btn); host.appendChild(box)
        }
        if (W.els[row.key] && !box.querySelector(row.tag)) box.querySelector('[data-widget-panel]').appendChild(W.els[row.key])
        let open = false
        try { open = localStorage.getItem('plugin-studio:widget-open:' + row.key) === '1' } catch (_) {}
        if (open) this.openWidget(row, true)
      }
    },
    openWidget(row, open) {
      const host = this.widgetHost(row.widget)
      const box = host.querySelector(`[data-widget="${row.key}"]`)
      if (!box) { this.setupWidgets(); return }
      const panel = box.querySelector('[data-widget-panel]')
      const btn = box.querySelector('[data-widget-bubble]')
      // Collapsing only hides the panel: the element stays mounted, so a recording keeps going and the
      // transcript stays where it was.
      if (open) panel.setAttribute('data-open', ''); else panel.removeAttribute('data-open')
      btn.setAttribute('aria-expanded', open ? 'true' : 'false')
      try { localStorage.setItem('plugin-studio:widget-open:' + row.key, open ? '1' : '0') } catch (_) {}
      const W = this.widgetStore()
      if (!open || W.els[row.key]) return
      loadScriptOnce(this.resolve(row.bundleJs)).then(() => whenTagDefined(row.tag)).then(() => {
        if (W.els[row.key]) return
        const el = document.createElement(row.tag)
        el.setAttribute('profile-config', JSON.stringify(this.paneConfig(row, this.locale)))
        // A widget that knows the corner variant (Rudder does) drops its full-page header and chrome.
        el.setAttribute('variant', 'widget')
        if (this.base) el.setAttribute('tree-base', this.base.replace(/\/+$/, ''))
        el.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;overflow-y:auto;overscroll-behavior:contain;'
        // LIVE MIC, VISIBLE WHEN COLLAPSED: a widget that emits `recording` (Rudder does) turns its bubble
        // red, pulsing, with a dot while it listens, so closing the panel never hides that the mic is on.
        // Its mic lights only while speech is detected (`activity`), so a collapsed Rudder still shows it is
        // hearing the reader; the words themselves show in the panel.
        const pill = box.querySelector('[data-widget-bubble]')
        el.addEventListener('recording', (e) => {
          const on = !!(Array.isArray(e.detail) ? e.detail[0] : e.detail)
          pill.setAttribute('data-listening', on ? 'true' : 'false')
          if (!on) pill.setAttribute('data-speaking', 'false')
        })
        el.addEventListener('activity', (e) => {
          const a = (Array.isArray(e.detail) ? e.detail[0] : e.detail) || {}
          if (pill.getAttribute('data-listening') !== 'true') return
          pill.setAttribute('data-speaking', a.speaking ? 'true' : 'false')
        })
        W.els[row.key] = el
        panel.appendChild(el)
      }).catch((e) => { panel.textContent = (e && e.message) || String(e) })
    },
    mountElement(row) {
      row.mounted = true
      row.state = 'loading'
      const jsUrl = this.resolve(row.bundleJs)
      // Gate the mount on the TAG being registered, not on the script's onload — onload fires even
      // when the bundle then fails to execute (see loadScriptOnce), which would hand us an inert
      // HTMLUnknownElement and an empty pane reporting 'ready'.
      loadScriptOnce(jsUrl).then(() => whenTagDefined(row.tag)).then(() => {
        // Everything below is per-nested-plugin machinery; a throw here (bad tag name, a nested
        // element that blows up in its connectedCallback, a serialise failure) must NOT crash the
        // studio — it lands in THIS row's error pane. Hence the try/catch around the DOM mount, on
        // top of the .catch() that already handles a failed SCRIPT load.
        try {
          // A heavy row may have been deactivated (and released) while its bundle loaded. Mounting
          // into a torn-down pane would leak exactly the context this design exists to bound, so
          // drop the mount and let the next select() redo it cleanly.
          if (row.heavy && this.activeKey !== row.key) { row.mounted = false; row.state = 'idle'; return }
          const slot = this._slots && this._slots[row.key]
          if (!slot) { row.state = 'error'; row.error = 'no slot'; return }
          slot.innerHTML = ''
          const el = document.createElement(row.tag)
          // Include the current preview locale so a pane mounted before any language switch already
          // renders in the studio's active language (ProfileLoader reads profile-config.locale).
          // tk/tokenUrl ride along here now that map rows mount directly — this is the token ladder
          // the removed iframe src used to carry as a query param.
          // ★ AND THE ENGINE, for the same reason tk rides along. resolveMapProvider's ladder starts
          // at profile-config.provider, and a pane reads the config THIS file writes — so a studio
          // embedded with provider=maplibre showed mapbox panes and, on a keyless host, panes that
          // asked for a token. MEASURED on a foreign origin: 19 requests to api.mapbox.com for a
          // maplibre request. Validated to the two known engines so a typo cannot select a third.
          // PASS THE TREE BASE DOWN — a nested cap-5 shell cannot guess it.
          // doxa-maps-spa carries its OWN hardcoded, TREE-RELATIVE tab list (doxa-maps-spa.vue:265-312,
          // e.g. 'doxa-research-map/research-map/index.html') and resolves it against ITS treeBase,
          // which it derives from its own script URL when nobody supplies one. Mounted here that guess
          // was empty, so resolve() took the '../' fallback and requested
          //     404 /doxa-research-map/doxa-research-map.js
          // — a path above the leaf, at the server root. Measured on the live studio 2026-09-22; three
          // bundles 404'd this way. Non-fatal (the tab still rendered from its fallback list) which is
          // exactly why it survived: a silent 404 behind a working screen.
          // We know the correct base because it is the one WE resolved against, so hand it over rather
          // than letting the child re-derive it. doxa-maps-spa reads cfg.treeBase (:519) ahead of its
          // own guess, so this lands through the existing config path with no new prop.
          // (All of the above is built in ONE place, paneConfig(), shared with setLocale.)
          el.setAttribute('profile-config', JSON.stringify(this.paneConfig(row, this.locale)))
          // …and as a plain `tree-base` ATTRIBUTE, for elements that take the base that way instead of
          // through profile-config (golden-path-check does, deliberately — it has no ProfileLoader).
          // Without it that check guessed the tree from the PAGE URL, which in the studio is the page
          // root, and read /manifest.json: a 404 and an empty self-test. Unused attributes are inert.
          if (this.base) el.setAttribute('tree-base', this.base.replace(/\/+$/, ''))
          el.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;'
          slot.appendChild(el)
          row.state = 'ready'
        } catch (e) {
          row.state = 'error'
          row.error = 'mount failed: ' + ((e && e.message) || String(e))
        }
      }).catch((e) => {
        row.state = 'error'
        row.error = (e && e.message) || String(e)
      })
    },
    copyText(text, btn) {
      const ok = () => { const t = btn.textContent; btn.textContent = this.tr('copied'); setTimeout(() => { btn.textContent = t }, 1200) }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, () => {})
      else {
        try { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); ok() } catch { /* ignore */ }
      }
    }
  }
})
</script>

<style>
/* ★ THE HOST HAS A HEIGHT OF ITS OWN (same rule as doxa-maps-spa). A custom element is display:inline
   by default and the shell inside it is absolutely positioned, so pasting the published embed snippet
   into a page rendered a fully mounted studio 0px tall — measured 2026-09-24. A default, not a lock:
   the page's own style="height:…" or --plugin-studio-height wins, which is how the leaf page fills
   the viewport. Mirrored in PS_SHADOW_CSS above. */
:host { display: block; position: relative; height: var(--plugin-studio-height, 85vh); min-height: 480px; }
:host([hidden]) { display: none; }
/* The shell (top bar + rail + body) is the shared VerticalTabsLayout. Only the studio's own
   content-area styles remain here; mirror of PS_SHADOW_CSS above. Keep the two in sync.
   Reskinned to the dx-life admin tokens (neutral surfaces, green #92b195 accent) to match the shell. */
.ps-logo { display: inline-flex; align-items: center; }
.ps-logo svg { display: block; }
.ps-count { color: #6d766e; }
/* THE HEADER'S MENUS SIT ABOVE EVERY PLUGIN (2026-09-25: the Mapbox token menu was not on top;
   it slid under the plugins). The header row and the pane area are siblings with no stacking context
   of their own, so a menu at z-index 30 competed with each plugin's own chrome (a filter bar at 55, a drawer
   at 1000) and lost. The header now stacks above the content, and the pane area is ISOLATED: whatever
   z-index a plugin uses stays inside its pane. */
.vtl-top { position:relative; z-index:3; }
.vtl-body { isolation:isolate; }
.ps-token { position:relative; display:inline-flex; }
.ps-show-header { position:fixed; top:8px; inset-inline-end:8px; z-index:2147483000; display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border:1px solid #d1d4cd; border-radius:999px; background:rgba(255,255,255,.94); color:#3b463d; font:600 12px system-ui, sans-serif; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.18); }
.ps-show-header:hover, .ps-show-header:focus-visible { background:#ffffff; outline:2px solid #92b195; }
.ps-hide-header-phone { display:none; }
@media (max-width:760px) { .ps-hide-header-phone { display:inline-flex; position:fixed; top:6px; inset-inline-end:8px; z-index:4; align-items:center; justify-content:center; width:44px; height:44px; padding:0; border:1px solid #d1d4cd; border-radius:var(--vtl-radius,8px); background:#d1d4cd; color:#3b463d; font:18px/1 system-ui, sans-serif; cursor:pointer; } }
.ps-token-dot { width:8px; height:8px; border-radius:50%; background:#b8bdb4; }
.ps-token-dot.is-yours, .ps-token-dot.is-url { background:#92b195; }
.ps-token-dot.is-built { background:#c9b36a; }
.ps-token-dot.is-none { background:#d27a6a; }
.ps-token-panel { position:absolute; top:100%; inset-inline-end:0; margin-top:4px; z-index:30; width:min(340px, 90vw); display:flex; flex-direction:column; gap:8px; padding:12px; border:1px solid #d1d4cd; border-radius:10px; background:#ffffff; box-shadow:0 12px 32px rgba(0,0,0,.25); color:#3b463d; font-size:12px; }
.ps-token-label { display:flex; flex-direction:column; gap:4px; }
.ps-token-input { font:inherit; font-size:12px; padding:6px 8px; border:1px solid #d1d4cd; border-radius:7px; background:#f8f8f6; color:#3b463d; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
.ps-token-row { display:flex; gap:8px; }
.ps-token-apply, .ps-token-clear { font:inherit; font-size:12px; padding:5px 12px; border-radius:7px; border:1px solid #d1d4cd; background:#d1d4cd; color:#3b463d; cursor:pointer; }
.ps-token-apply { background:#92b195; border-color:#92b195; color:#fff; }
.ps-token-apply:disabled { opacity:.6; cursor:progress; }
.ps-token-status { margin:0; }
.ps-token-head { margin:0; font-weight:600; font-size:12px; }
.ps-token-status.err { color:#b3412f; }
.ps-token-note { margin:0; color:#6d766e; }
.ps-locale { position: relative; display: inline-flex; }
.ps-locale-btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 12px; padding: 4px 9px; border: 1px solid #d1d4cd; border-radius: 8px; background: #d1d4cd; color: #3b463d; cursor: pointer; }
.ps-locale-btn:hover { background: #d1d4cd; }
.ps-flag { font-size: 13px; line-height: 1; }
.ps-locale-name { max-width: 11ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-token-btn .ps-locale-name { max-width: none; }
.ps-dots { color: #6d766e; }
.ps-locale-menu { position: absolute; top: 100%; right: 0; margin-top: 4px; z-index: 30; min-width: 180px; list-style: none; padding: 6px; border: 1px solid #d1d4cd; border-radius: 10px; background: #ffffff; box-shadow: 0 12px 32px rgba(0,0,0,.5); max-height: 320px; overflow: auto; }
.ps-locale-opt { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit; font-size: 13px; padding: 7px 9px; border: 0; border-radius: 7px; background: none; color: #3b463d; cursor: pointer; }
.ps-locale-opt:hover { background: #d1d4cd; color: #3b463d; }
.ps-locale-opt.active { background: #d1d4cd; color: #3b463d; }
.ps-locale-opt.active .ps-locale-name { color: #92b195; }
.ps-locale-en { margin-left: auto; font-size: 11px; color: #6d766e; }
.ps-toolbar { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 0; }
.ps-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ps-bar-t { flex: 1 1 auto; min-width: 0; }
.ps-bar-t b { font-size: 15px; color: #3b463d; }
.ps-bar-sub { display: block; font-size: 12px; color: #6d766e; }
.ps-btn { font: inherit; font-size: 12px; padding: 5px 10px; border: 1px solid #d1d4cd; border-radius: 8px; background: #d1d4cd; color: #3b463d; cursor: pointer; white-space: nowrap; }
.ps-btn:hover { background: #d1d4cd; }
.ps-embed { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid #d1d4cd; border-radius: 8px; background: #f3f3f1; }
.ps-embed label { font-size: 12px; color: #6d766e; display: flex; justify-content: space-between; align-items: center; }
.ps-embed textarea { width: 100%; height: 58px; font: 11px/1.35 ui-monospace, Menlo, monospace; border: 1px solid #d1d4cd; border-radius: 6px; background: #ffffff; color: #3b463d; padding: 6px; resize: vertical; }
.ps-stage { position: absolute; inset: 10px 12px 12px; border: 1px solid #d1d4cd; border-radius: 10px; overflow: hidden; background: #f3f3f1; }
/* Keep in sync with the injected copy above (BUG-STILL-CANNOT-SCROLL-DOWN-TO-THE-GRID). THE PANE
   OWNS THE SCROLL: a scroll-stack composite mounted here measured scrollHeight 3380 / clientHeight
   769 — 2611px of mounted, populated content no element could scroll to, because this pane was
   position:absolute; inset:0 with the default overflow:visible inside an overflow:hidden stage.
   auto, not scroll: a fixed-viewport map fills the box exactly and gets NO scrollbar, so the map
   tabs are untouched. */
.ps-pane { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; --profile-min-h: 0; }
/* NOT absolute-inset: that pinned the mount point to the pane's height and re-created the trap one
   level down. min-height:100% keeps a map filling the pane while letting a taller composite grow it. */
.ps-slot { position: relative; min-height: 100%; }
/* THE dvh FLOOR, NEUTRALISED FOR HOSTED ELEMENTS — keep in sync with the injected copy above.
   doxa-research-map ships .profile-loader { height:100%; min-height:100dvh }: height:100% resolves
   against the 769px pane, min-height:100dvh against the 900px VIEWPORT, so the floor made a map tab
   131px taller than its container and overflow:auto correctly grew a scrollbar on it. The floor is
   right for the standalone leaf and wrong only here, where the pane is a definite shorter box.
   --profile-min-h:0 on the pane is the half that does the work: the floor is inside the map's SHADOW
   ROOT, which no host-page selector can reach, but a custom property DOES inherit across that
   boundary. overflow:clip was tried and measured wrong — it also clipped the tall composite. */
.ps-slot > * { min-height: 0; max-height: none; }
.ps-hint { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: #6d766e; font-size: 13px; padding: 20px; }
.ps-hint.err { color: #f87171; }
.ps-hint small { color: #6d766e; }
</style>
