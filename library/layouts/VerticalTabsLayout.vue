<!--
  VerticalTabsLayout.vue — a shared, brand-neutral vertical-tabs shell layout.

  ★ WHAT IT IS. A reusable app-shell layout: a top bar, a sectioned/foldered vertical rail, and a
    content frame. Brand-neutral by design — it bakes in NO product name, so any app can reuse it.
    Consumers inject their own branding via the `title` prop and the #brand / #meta / #toolbar slots.
    A real compiled Vue component with self-contained CSS and NO UI-framework dependency (no MUI /
    Vuetify / CDN) — it works out of the box and offline.

  ★ SHADOW-DOM SAFETY. When a consumer bundle compiles with vue({customElement:true}) and renders
    inside a shadow root, plugin-vue attaches each SFC's <style> to that component's own styles[] —
    but Vue only injects the ROOT custom element's styles[] into the shadow root; a CHILD component's
    styles[] are silently dropped (see composables/useShadowStyles.js). This layout is typically
    imported as a CHILD of a consumer's root SFC, so its <style> block alone would NOT reach the
    shadow root. It therefore injects its critical CSS via useShadowStyles() at setup() — correct in
    both light-DOM and shadow-DOM builds, idempotent-by-key (a double inject is harmless). The <style>
    block below is the same CSS for dev / light-DOM readability; keep the two in sync.

  ★ TWO SHAPES, ONE COMPONENT:
      - FLAT list:      pass :items="[{key,label,sub,emoji,icon,...}]"
      - GROUPED tiers:  pass :groups="[{key,label,badge,count,icon,folder,rows}]"
    A row/group may carry EITHER an `emoji` (a unicode glyph) OR an `icon` (a LOCAL icon name resolved
    to inline SVG — no CDN, offline safe). `icon` wins if both are set. A GROUP with `folder:true`
    (and optional `open:false`) renders a COLLAPSIBLE section (click the heading — chevron rotates); a
    plain group is an always-open labelled section (the "Subscriptions" style). A folder heading also
    shows the group's `badge` + `count` when given.
    Selection is controlled via v-model:active (the active item's `key`). The host owns pane content
    and mount logic — this component only paints the SHELL (top bar + rail + a content frame) and
    exposes slots so each app keeps its unique chrome + its own mount machinery:
      #brand    — left of the title (optional logo / icon; the consumer's branding lives here)
      #meta     — right side of the top bar (e.g. a count, a language switcher)
      #toolbar  — a full-width strip under the top bar, above the content (e.g. an action bar)
      #default  — the content pane(s); the host renders its own panes and toggles them on `active`
      #rail     — (optional) replaces the rail body below the collapse toggle, for a host whose
                  navigation is not a list of tabs. Slot props: collapsed (desktop slim state), expand(),
                  pick(key). plugin-studio uses it for its Explorer tree.

  ★ NESTED-ELEMENT HOSTING (opt-in, LAZY). A row/item may instead ask THIS layout to host a nested
    custom element for its tab — so a shell can compose other element-plugins as its tabs. Add to a
    row/item:
      element : a custom-element tag name to render for this tab, e.g. "people-groups-grid"
      src?    : a bundle URL to inject (once, deduped) if `element` isn't registered yet
      attrs?  : a map of attributes/props to set on the element BEFORE it mounts ("props in advance")
    When present, the layout mounts THAT element into the content frame for that tab, so the host needs
    no #default pane machinery. The #default slot still works for hosts that render their own panes —
    `element` is an ALTERNATIVE, not a replacement (a host can mix: element-rows get hosted panes, the
    rest fall through to #default).

    ▸ LAZY: a tab's element is mounted ONLY on FIRST activation (never eagerly). We track the set of
      activated keys; the pane for a key renders/mounts the first time that key becomes `active`, and
      after that it is KEPT ALIVE (v-show toggle) so re-selecting is instant and its state survives —
      but a tab the user never opens costs nothing (no bundle fetch, no element upgrade). If a row has
      `src`, the bundle is injected lazily (once per src) at first activation, and the element is
      created only after customElements.get(tag) resolves (injectScriptOnce + waitForDefine).

  ★ DEFAULT MATERIAL LIGHT THEME. The inlined token values are just colours, sourced from the live
    DX-life material palette (read-only): a light canvas (#f3f3f1 surface-default), white elevated
    chrome (#fff), brand-dark text (#3b463d), secondary-light borders (#d1d4cd), muted (#6d766e), and
    the sage brand-primary (#92b195) as the one accent. They ship as literals (a shadow-DOM custom
    element cannot import an app's design tokens — that is the boundary), so the rail looks finished
    out of the box with zero runtime dependency. A consumer can override the look via the CSS custom
    properties (--vtl-accent, --vtl-border, --vtl-elevated, --vtl-accented, --vtl-muted).

  The rail is keyboard-accessible (role="tablist", ArrowUp/Down + Home/End move focus & select), the
  active row is highlighted, and the whole thing is responsive.

  ★ OPTIONAL HEADER (`header` prop, default true). The top bar (#brand / title / #meta) is only
    rendered when `header` is true. Pass :header="false" for a sidebar-only, full-page element (e.g.
    embedded in a site that already has its own header — stacked headers look bad). #toolbar is
    unaffected (it lives in the content column, not the header). plugin-studio keeps its header; the
    DX-Maps SPA turns it off.

  ★ COLLAPSIBLE RAIL (desktop + mobile). A clearly-visible toggle at the top of the rail collapses it:
    - DESKTOP (≥760px): the rail shrinks to a SLIM ICON RAIL (icons stay clickable, labels/sections
      hide) and expands back. State is `railCollapsed`. The rail width animates via a single CSS custom
      property (--vtl-rail: 256px↔60px) with a `width` transition, and BOTH the rail and the content pane
      set `contain:layout paint` so the collapse never reflows a heavy mounted map/element in the content
      frame — a smooth, GPU-friendly 60fps transition rather than the per-frame layout thrash a
      flex-basis animation caused. Because a header-less element is nav + content only, a slim rail keeps
      every tab reachable rather than leaving a blank page.
    - MOBILE (<760px): the rail is an off-canvas DRAWER toggled open/closed via `navOpen` (the ☰ lives
      in the rail toggle too).

    ▸ STATE RECONCILIATION (the fix for the "extremely buggy" collapse). `navOpen` (mobile drawer) and
      `railCollapsed` (desktop slim rail) are two boolean state machines with different meanings on each
      side of the 760px breakpoint. A reactive `narrow` flag mirrors the media query via a resize
      listener; on every breakpoint crossing `reconcileForWidth()` snaps the flags into a coherent state
      (desktop → navOpen=true so the rail is always visible; mobile → navOpen=false + railCollapsed=false
      so the drawer starts closed and reopens full-width). The rail's visibility binds to the media-aware
      `railShown` computed (NOT raw navOpen), so a mobile-closed drawer can no longer hide the whole rail
      after a resize back to desktop — the previous broken-restore bug.
-->
<template>
  <!-- ★ NO CORNER CIRCLE. On a phone the ☰ lives in the phone bar ABOVE the pane, in both shell modes, so nothing
       covers plugin content and --map-fab-clearance / --map-fab-beside are not set: every reader of them
       (BackToTopButton, PinHint, LegendMobile, the grid) takes its own fallback. -->
  <div class="vtl" :class="{ 'nav-open': navOpen, 'rail-collapsed': railCollapsed, 'no-header': !header, 'has-phone-bar': phoneBarShown }">
    <header class="vtl-top" v-if="header">
      <button class="vtl-menu" type="button" :aria-expanded="String(navOpen)" @click="navOpen = !navOpen"
        :aria-label="label('toggleList')">☰</button>
      <span class="vtl-brand"><slot name="brand" /></span>
      <b class="vtl-title">{{ title }}</b>
      <span class="vtl-meta"><slot name="meta" /></span>
    </header>

    <!-- ★ THE PHONE BAR — the way to the rail AND to the language when there is no header.
         Header-off shells (the Research Gallery, Posterverse) have no .vtl-top, so on a phone this slim
         bar is their only chrome: ☰ at the inline START (right in ar, the edge the drawer opens from)
         and a #phone-end slot at the inline END, which the shell fills with its own language menu
         (library/components/ShellLanguageMenu.vue). It is a real grid row (.has-phone-bar), so the
         drawer and the pane both start below it and it never covers plugin content.
         44px: the ☰ and the menu ARE the bar's tap targets; a 40px bar would push their 44px hit
         areas into the pane. Rendered ONLY when narrow AND header-off (phoneBarShown), so desktop and
         every header-on consumer (plugin-studio) render exactly as before. It replaced the floating
         corner circle that did this job before (found 2026-09-22: header-off on a phone, every tab
         but the first was unreachable), and check:nav-reachable still presses it. -->
    <div v-if="phoneBarShown" class="vtl-pbar" :class="{ 'is-web': mode === 'web' }">
      <button class="vtl-phone-menu" type="button" :aria-expanded="String(navOpen)"
        @click="navOpen = !navOpen" :aria-label="label('toggleList')">☰</button>
      <span class="vtl-pbar-end"><slot name="phone-end" /></span>
    </div>

    <!-- ★ WEB MODE (shellMode, below) IS THE SAME BAR, minus the camera inset. Inside a website (DX Life) the shell
         is not at the top of the screen, so the bar takes no env(safe-area-inset-top) padding (.is-web); in an
         app it may sit under the notch, so it keeps it. One header either way, with the ☰ at its start and the
         language at its end. (A corner ☰ with no header was tried for web mode and rejected on a real phone.) -->

    <!-- Driving the shell's own scroller. It reads --map-fab-beside, which nothing sets now that there is no corner
         circle, so it sits at its plain inset. -->
    <BackToTopButton v-if="narrow" :target="activeHostEl"
      :labels="{ backToTop: T('actions.backToTop', 'Back to top') }" />

    <div class="vtl-body">
      <!-- Rail visibility is CSS-driven via `transform`, never v-show/display:none — a display:none element
           cannot animate, so the drawer must stay in the DOM and only slide. DESKTOP: the rail is always
           on-screen (translateX(0), or -196px as a slim icon rail when railCollapsed). MOBILE: the rail is
           an off-canvas drawer parked at translateX(-100%) and slid in by the `nav-open` class. Because it
           is never display:none, a mobile-closed drawer can no longer strand the rail after a resize back
           to desktop (the old cross-breakpoint bug). `aria-hidden` mirrors real visibility for a11y. -->
      <nav class="vtl-nav" :class="{ 'has-rail-end': railEndShown && !!$slots['rail-end'] }" :aria-label="navLabel" :aria-hidden="String(!railShown)"
        :role="$slots.rail ? null : 'tablist'" :aria-orientation="$slots.rail ? null : 'vertical'">
        <!-- THE HOST'S WAY HOME (optional). A host page that embeds this layout full-page (DX Life's
             /deep-research) has no header of its own there, so it hands in its homepage URL and label
             (homeHref / homeLabel) and the link sits here: directly above Collapse, the same box, in the
             rail on a desktop and at the top of the drawer on a phone. The URL is the HOST's, never a
             default, so an embed that passes none shows nothing and the layout stays embeddable anywhere. -->
        <a v-if="homeLink" class="vtl-home" :href="homeLink" target="_top" :aria-label="homeText"
          :title="railCollapsed && !narrow ? homeText : null">
          <span class="vtl-home-ic" aria-hidden="true" v-html="iconSvg('home')"></span>
          <span class="vtl-home-tx">{{ homeText }}</span>
        </a>
        <!-- Rail toggle: always visible, collapses the rail (slim icon rail on desktop; off-canvas
             drawer on mobile). The chevron points the way the click will move the rail. -->
        <button
          type="button" class="vtl-collapse"
          :aria-expanded="String(!railCollapsed)"
          :aria-label="railCollapsed ? label('expandList') : label('collapseList')"
          @click="toggleRail">
          <span class="vtl-collapse-ic" aria-hidden="true" v-html="iconSvg('chevron')"></span>
          <span class="vtl-collapse-tx">{{ label('collapse') }}</span>
        </button>

        <!-- #rail: a host that needs MORE than tabs (e.g. plugin-studio's tree) supplies the whole rail
             body. The layout keeps the frame — collapse toggle, drawer, slim strip — and hands the slot
             what it needs to cooperate with it. The nav drops role=tablist, since the slot brings its
             own role (a tree is not a tablist). -->
        <slot v-if="$slots.rail" name="rail" :collapsed="railCollapsed && !narrow" :expand="expandRail" :pick="pick" />
        <!-- GROUPED shape: labelled sections (always-open) or collapsible folders. -->
        <template v-else-if="groups && groups.length">
          <div class="vtl-grp" v-for="grp in groups" :key="grp.key">
            <!-- FOLDER heading = a button that toggles open/closed (chevron rotates). -->
            <button
              v-if="grp.folder" type="button" class="vtl-tier vtl-tier-btn"
              :aria-expanded="String(!isFolderClosed(grp))"
              @click="toggleFolder(grp.key)">
              <!-- NO section-header logo (the rule: logos only on the vertical TAB rows, never on the
                   section dividers). The folder chevron below is an affordance, not a logo, so it stays. -->
              <span class="vtl-cap" v-if="grp.badge">{{ grp.badge }}</span>
              <span class="vtl-tl">{{ grp.label }}</span>
              <span class="vtl-td" v-if="grp.count != null">{{ grp.count }}</span>
              <span class="vtl-chev" :class="{ open: !isFolderClosed(grp) }" aria-hidden="true" v-html="iconSvg('chevron')"></span>
            </button>
            <!-- SECTION heading = a static always-visible label (with optional badge/count). No logo here
                 either — section dividers are text-only; row icons live on the tabs below. -->
            <div v-else class="vtl-tier">
              <span class="vtl-cap" v-if="grp.badge">{{ grp.badge }}</span>
              <span class="vtl-tl">{{ grp.label }}</span>
              <span class="vtl-td" v-if="grp.count != null">{{ grp.count }}</span>
            </div>

            <div class="vtl-rows" v-show="!grp.folder || !isFolderClosed(grp)">
              <button
                v-for="row in grp.rows" :key="row.key" type="button" role="tab"
                class="vtl-tab" :class="{ active: row.key === active, disabled: row.disabled }"
                :aria-selected="String(row.key === active)"
                :aria-disabled="row.disabled ? 'true' : null"
                :tabindex="row.key === active ? 0 : -1"
                :ref="el => registerTab(row.key, el)"
                @click="pick(row.key)" @keydown="onKey($event)">
                <span class="vtl-tab-ic" aria-hidden="true" v-if="row.icon" v-html="iconSvg(row.icon)"></span>
                <span class="vtl-tab-emoji" aria-hidden="true" v-else-if="row.emoji">{{ row.emoji }}</span>
                <!-- Slim-rail fallback (desktop collapsed only): a row with NEITHER icon NOR emoji would
                     otherwise be an empty hit-target in the icon strip. Show the label's initial so a
                     general-library consumer that omits icons still gets a usable slim rail. -->
                <span class="vtl-tab-fallback" aria-hidden="true" v-else>{{ initial(row.label) }}</span>
                <span class="vtl-tab-text">
                  <span class="vtl-tab-label">{{ row.label }}<span class="vtl-tab-badge" v-if="row.badge">{{ row.badge }}</span></span>
                  <span class="vtl-tab-sub" v-if="row.sub"><span v-html="row.sub"></span></span>
                </span>
              </button>
            </div>
          </div>
        </template>

        <!-- FLAT shape: a single ungrouped list -->
        <template v-else>
          <button
            v-for="row in items" :key="row.key" type="button" role="tab"
            class="vtl-tab" :class="{ active: row.key === active, disabled: row.disabled }"
            :aria-selected="String(row.key === active)"
            :aria-disabled="row.disabled ? 'true' : null"
            :tabindex="row.key === active ? 0 : -1"
            :ref="el => registerTab(row.key, el)"
            @click="pick(row.key)" @keydown="onKey($event)">
            <span class="vtl-tab-ic" aria-hidden="true" v-if="row.icon" v-html="iconSvg(row.icon)"></span>
            <span class="vtl-tab-emoji" aria-hidden="true" v-else-if="row.emoji">{{ row.emoji }}</span>
            <span class="vtl-tab-fallback" aria-hidden="true" v-else>{{ initial(row.label) }}</span>
            <span class="vtl-tab-text">
              <span class="vtl-tab-label">{{ row.label }}</span>
              <span class="vtl-tab-sub" v-if="row.sub">{{ row.sub }}</span>
            </span>
          </button>
        </template>

        <!-- #rail-end: pinned to the BOTTOM of the desktop rail, where apps put account details. A
             header-off shell puts its language menu here (the same ShellLanguageMenu as the phone bar),
             so a desktop reader can change language with no header above the pane. Rendered only when
             WIDE AND header-off: a header-on consumer keeps its #toolbar menu (never two), and on a
             phone the bar's #phone-end carries it. `collapsed` tells the filler the rail is the 72px
             icon strip, so it shows the language code instead of its name. -->
        <div v-if="railEndShown && $slots['rail-end']" class="vtl-rail-end">
          <slot name="rail-end" :collapsed="railCollapsed" />
        </div>
      </nav>

      <main class="vtl-main">
        <!-- The #toolbar strip (locale switcher etc.) is part of the header chrome, so it renders ONLY
             when header is on. The rule: a header-off, sidebar-only element (doxa-maps-spa) inherits
             its language from the PARENT via the `language` prop and shows NO standalone locale dropdown;
             a header-on host (plugin-studio) DOES get the toolbar/locale dropdown. -->
        <slot name="toolbar" v-if="header" />
        <div class="vtl-content">
          <!-- Lazily-hosted nested elements: one pane per element-bearing row, rendered only after its
               tab has been activated once (v-if on activatedKeys), then kept alive (v-show) so its
               state survives tab switches. Each pane is an empty Vue-unmanaged div we mount the custom
               element into imperatively — Vue never manages the element's own shadow DOM. -->
          <section
            v-for="row in mountedElementRows" :key="row.key"
            class="vtl-host" v-show="row.key === active" :hidden="row.key !== active"
            :ref="el => { if (el) hostEls[row.key] = el; else delete hostEls[row.key] }">
            <div class="vtl-host-slot" :ref="el => setHostSlot(row.key, el)"></div>
            <div v-if="hostState[row.key] === 'loading'" class="vtl-host-hint">{{ T('messages.loadingNamed', 'Loading {name}…').replace('{name}', row.label) }}</div>
            <!-- ★ A LOST GL CONTEXT IS SHOWN, NOT SWALLOWED. The browser's WebGL budget is commonly
                 8-16 and this tree has 19 map-bearing profiles, so a reader who visits enough map
                 tabs crosses it. What the browser then does is the problem: it kills the OLDEST
                 context silently — getContext() never returns null and nothing fires on the NEW
                 canvas — so a map that worked a minute ago is simply blank when you go back to it.
                 This turns that into a visible, actionable state under either of the caps on row 107. -->
            <div v-else-if="hostState[row.key] === 'lost'" class="vtl-host-hint">
              {{ T('messages.mapContextLost', 'This map was unloaded to free graphics memory.') }}
              <button type="button" class="vtl-host-reload" @click="reloadHostElement(row.key)">
                {{ T('buttons.reloadMap', 'Reload Map') }}
              </button>
            </div>
            <div v-else-if="hostState[row.key] === 'error'" class="vtl-host-hint err">
              {{ T('messages.couldNotLoadNamed', 'Could not load {name}.').replace('{name}', row.label) }}<br><small>{{ hostError[row.key] }}</small>
            </div>
          </section>
          <!-- Host-owned panes (the SPA/studio render their own here). Always available. -->
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import BackToTopButton from '@map/components/BackToTopButton.vue'
import { tStatic } from '../i18n/index.js'

// This layout's chrome, read out of the catalogue. tStatic and not useI18n: it is the root of a
// custom element, where useI18n() cannot resolve its injection and throws. Exposed from setup()
// rather than kept at module scope, because an options-API template can only see what the component
// returns — a module-level const would compile and then render nothing.
const tr = (key, en) => tStatic(key) || en
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { icon as localIcon } from '@map/layouts/app-wrapper-material/icons.js'
import { loadScriptOnce, claimTag } from '@map/utils/embedScript.js'

// Inject a bundle script exactly once per URL, through the ONE shared loader (library/utils/embedScript.js).
// This layout's private copy lacked the dev-server ES-module rule, so a bundle nested through it under
// bun run dev loaded as a classic script, reported success, and never defined its tag.
const injectScriptOnce = (url) => loadScriptOnce(url)

// Wait until a custom element tag is defined (up to ~5s). If a src bundle was injected, its
// define() has already run by onload; this covers elements registered async after script exec.
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

// Injected into the shadow root at mount (see the header comment for the full why). Kept free of
// block comments and ${} substitutions so the build-time strip-shadow-css plugin ships it verbatim.
const VTL_SHADOW_CSS = `
/* STRUCTURAL DISPLAY — the !important is deliberate, not a hack. This layout's display mode is
   load-bearing: it CANNOT function as a block. As a library/ (high-bar) component it ships across
   all 5 deployment methods, and a host (app-shell direct-mount, WordPress, mobile webview) may force
   its own inline display onto the element. Declaring it non-overridable is the correct contract.
   grid-template-rows: auto 1fr = header takes its natural height, .vtl-body gets a DEFINITE
   remaining track — no dependence on in-flow children (nav/main are absolute for the rail slide). */
.vtl { position:absolute; inset:0; display:grid !important; grid-template-rows:auto 1fr; height:100%; width:100%; min-height:420px; background:#f3f3f1; color:#3b463d; font-family:'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased; --vtl-accent:#92b195; --vtl-border:#d1d4cd; --vtl-elevated:#ffffff; --vtl-accented:#d1d4cd; --vtl-muted:#6d766e; --vtl-rail:256px; }
/* HEADER-OFF (header=false, e.g. the cap-5 doxa-maps-spa): the .vtl-top element is NOT rendered, so
   .vtl-body becomes the ONLY grid child and auto-places into row 1 — the auto row — which has no
   content to size it and collapses to 0 (the 1fr row sits empty) → the same 0-height black screen.
   With no header there is only one region, so declare a single 1fr row and the body fills. */
.vtl.no-header { grid-template-rows:1fr; }
/* ...except on a phone, where the header-off layout has its slim bar (.vtl-pbar) as a real first row. */
.vtl.no-header.has-phone-bar { grid-template-rows:auto 1fr; }
/* MATERIAL APP BAR = 64px desktop / 56px mobile (2026-09-21), was 51px from 11px padding.
   Stated as an explicit min-height rather than left to padding arithmetic, so the number a
   reader sees is the number that renders. min-height keeps a wrapping title from clipping.
   ★ box-sizing:border-box IS LOAD-BEARING HERE. Without it this element is content-box, so
   min-height:64px MEASURED 81px live: 64 + 16px vertical padding + 1px border. A height stated
   in a comment is worth nothing if the box model adds to it — measure the rendered value, do not
   trust the declaration. (Found exactly that way: the probe read 81 against a 64 target.)
   THIS RULE EXISTS TWICE (VTL_SHADOW_CSS and the scoped style block); keep them identical. */
.vtl-top { flex:0 0 auto; display:flex; align-items:center; gap:10px; box-sizing:border-box; min-height:64px; padding:8px 16px; border-bottom:1px solid var(--vtl-border); background:#ffffff; }
.vtl-menu { display:none; font:16px/1 system-ui; color:#3b463d; background:#d1d4cd; border:1px solid #d1d4cd; border-radius:8px; padding:5px 10px; cursor:pointer; }
/* THE PHONE BAR (phoneBarShown = narrow AND header-off; it replaced the floating corner circle).
   A real grid row above .vtl-body (.has-phone-bar below), so the drawer and the pane both start under
   it and it never covers plugin content. 44px + the top safe area; the rule line is an INSET SHADOW,
   not a border, so the 44px is the whole bar and the ☰ is a full 44×44 target. Flex follows the
   writing direction, so in ar the ☰ sits at the right (where the drawer opens) and the #phone-end
   menu at the left, with no :dir override. THIS RULE EXISTS TWICE; keep the copies identical. */
.vtl-pbar { display:flex; align-items:center; gap:8px; box-sizing:border-box; height:calc(44px + env(safe-area-inset-top)); padding:env(safe-area-inset-top) calc(4px + env(safe-area-inset-right)) 0 calc(4px + env(safe-area-inset-left)); background:#ffffff; box-shadow:inset 0 -1px 0 var(--vtl-border); }
.vtl-phone-menu { flex:0 0 auto; width:44px; height:44px; display:inline-flex; align-items:center; justify-content:center; padding:0; margin:0; font:20px/1 system-ui; color:#3b463d; background:transparent; border:0; border-radius:8px; cursor:pointer; }
.vtl-phone-menu:hover { background:var(--vtl-accented); }
.vtl-phone-menu:focus-visible { outline:2px solid var(--vtl-accent); outline-offset:-2px; }
/* WEB MODE: the same bar, without the camera inset (the shell is not at the top of the screen in a website). */
.vtl-pbar.is-web { height:44px; padding-top:0; }
.vtl-pbar-end { margin-inline-start:auto; display:inline-flex; align-items:center; min-width:0; }
.vtl-menu:hover { background:#d1d4cd; }
.vtl-brand { display:inline-flex; align-items:center; }
.vtl-brand:empty { display:none; }
.vtl-title { font-size:15px; font-weight:600; letter-spacing:-0.01em; color:#3b463d; }
.vtl-meta { color:var(--vtl-muted); font-size:12px; margin-left:auto; display:inline-flex; align-items:center; gap:8px; }
/* GRID ROWS, not flex (BUG-EMBEDDED-PLUGIN-STUDIO-BLACK-SCREEN). The collapsible-rail design makes
   .vtl-nav and .vtl-main position:absolute (so the rail slides by transform without reflowing the
   heavy map sibling). That leaves .vtl-body with NO in-flow children → ZERO intrinsic height, so it
   could only fill via flex:1 from a flex parent. A host that forces display:block on .vtl (the
   app-shell direct-mounts cap-5 elements that way) made that flex inert → .vtl-body collapsed to 0
   → black screen. The auto/1fr grid on .vtl gives this row a DEFINITE height by construction, so
   it no longer depends on the parent's display mode NOR on in-flow children. Header-off
   (header=false) still works: the auto row collapses to 0 and 1fr takes the full height. */
.vtl-body { min-height:0; position:relative; display:flex; }
.vtl-nav { position:absolute; top:0; bottom:0; left:0; z-index:5; width:256px; box-sizing:border-box; overflow-y:auto; overflow-x:hidden; border-right:1px solid var(--vtl-border); padding:12px 12px 20px; background:#ffffff; scrollbar-width:thin; scrollbar-color:#c4c8c0 transparent; contain:layout paint; transform:translateX(0); transition:transform .2s cubic-bezier(.4,0,.2,1); will-change:transform; }
/* Thin OVERLAY scrollbar: transparent track so the bar costs no visual space and sits flush to
   the nav edge; low-contrast thumb that darkens on hover. Matches the research-dashboard rails. */
.vtl-nav::-webkit-scrollbar { width:8px; height:8px; }
.vtl-nav::-webkit-scrollbar-track { background:transparent; }
.vtl-nav::-webkit-scrollbar-thumb { background:#c4c8c0; border-radius:8px; }
.vtl-nav::-webkit-scrollbar-thumb:hover { background:#9aa197; }
.vtl-collapse, .vtl-home { display:flex; align-items:center; gap:8px; width:100%; box-sizing:border-box; margin:0 0 8px; padding:7px 10px; border:1px solid var(--vtl-border); border-radius:8px; background:#d1d4cd; color:var(--vtl-muted); font:inherit; font-size:12px; cursor:pointer; }
.vtl-collapse:hover, .vtl-home:hover { background:var(--vtl-accented); color:#3b463d; }
.vtl-collapse:focus-visible, .vtl-home:focus-visible { outline:2px solid var(--vtl-accent); outline-offset:-2px; }
.vtl-collapse-ic { flex:0 0 auto; display:inline-flex; transition:transform .16s ease; transform:rotate(180deg); }
.vtl-collapse-ic svg { width:16px; height:16px; }
.vtl-collapse-tx { white-space:nowrap; }
/* The host’s home link (homeHref) shares Collapse’s box through the selector lists above and below, so the
   two are the same size by construction and cannot drift apart. The house does not rotate or mirror. */
.vtl-home { text-decoration:none; }
.vtl-home-ic { flex:0 0 auto; display:inline-flex; }
.vtl-home-ic svg { width:16px; height:16px; }
.vtl-home-tx { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* THE RAIL'S BOTTOM SLOT (#rail-end: railEndShown = wide AND header-off, and a filler present). The nav
   becomes a column ONLY then, so every other rail lays out exactly as before. margin-top:auto parks the
   slot at the bottom while the tabs are short; sticky keeps it in view once they scroll. The nav's own
   bottom padding moves into the slot, so the sticky row sits flush with the rail's bottom edge. */
.vtl-nav.has-rail-end { display:flex; flex-direction:column; padding-bottom:0; }
.vtl-nav.has-rail-end > * { flex-shrink:0; }
.vtl-rail-end { margin-top:auto; position:sticky; bottom:0; padding:8px 0 12px; background:#ffffff; border-top:1px solid var(--vtl-border); }
.vtl-grp { margin-bottom:2px; }
.vtl-grp + .vtl-grp { margin-top:8px; padding-top:8px; border-top:1px solid var(--vtl-border); }
.vtl-tier { width:100%; padding:8px 8px 6px; display:flex; align-items:center; gap:8px; box-sizing:border-box; }
.vtl-tier-btn { border:0; background:none; color:inherit; font:inherit; cursor:pointer; text-align:left; border-radius:8px; }
.vtl-tier-btn:hover { background:var(--vtl-accented); }
.vtl-tier-btn:focus-visible { outline:2px solid var(--vtl-accent); outline-offset:-2px; }
.vtl-tier-ic { flex:0 0 auto; display:inline-flex; color:var(--vtl-muted); }
.vtl-tier-ic svg { width:15px; height:15px; }
.vtl-cap { font:700 10px/1 system-ui; letter-spacing:.4px; color:#052e16; background:var(--vtl-accent); border-radius:999px; padding:3px 7px; }
.vtl-tl { font-weight:600; font-size:11px; letter-spacing:.03em; text-transform:uppercase; color:var(--vtl-muted); }
.vtl-td { color:#6b6b6b; font-size:11px; margin-left:auto; }
.vtl-chev { margin-left:auto; display:inline-flex; color:var(--vtl-muted); transition:transform .16s ease; }
.vtl-chev svg { width:15px; height:15px; }
.vtl-chev.open { transform:rotate(90deg); }
.vtl-rows { display:flex; flex-direction:column; gap:1px; }
/* MATERIAL NAV-ROW METRICS (2026-09-21). Product decision: follow the familiar
   Material/YouTube list layout rather than custom styling readers are not used to.
   Measured before this change: 44px rows with an 8px radius.
     min-height:48px     the Material list-item height. min-height, not height, so a wrapping
                         label still grows instead of clipping.
     border-radius         var(--vtl-radius,8px) — SUPERSEDED THE FULL PILL (2026-09-23).
                         A 999px stadium (modelled on YouTube's active row) shipped first. It
                         was reversed after it was compared with the rest of the product:
                         nothing else in the app is that round. .vtl-collapse is 8px, the
                         filter toggles in @map/components/search are 8px, and 8px is already
                         the most common radius in this file. A 999px radius on a 48px row is a
                         stadium, which is why it reads as foreign beside everything else.
                         ★ DO NOT "RESTORE" THE PILL on the strength of the YouTube model
                         above. It is kept because it is true history, not because
                         it is current. The 48px Material row height is unaffected and stays.
   NOT VENDORED: the card's law is to imitate the metrics in our own CSS, never to add Quasar or
   MUI. Same clone-dont-edit rule the library follows everywhere else.
   THIS RULE EXISTS TWICE (VTL_SHADOW_CSS and the scoped style block) and the two copies must stay
   byte-identical — edit both or neither. */
.vtl-tab { display:flex; align-items:center; gap:11px; width:100%; min-height:48px; text-align:left; border:0; background:none; color:var(--vtl-muted); padding:8px 12px; cursor:pointer; border-radius:var(--vtl-radius,8px); font:inherit; margin:0; transition:background .13s ease,color .13s ease; }
.vtl-tab:hover { background:var(--vtl-accented); color:#3b463d; }
.vtl-tab:focus-visible { outline:2px solid var(--vtl-accent); outline-offset:-2px; }
.vtl-tab.active { background:var(--vtl-accented); color:#3b463d; font-weight:500; }
/* A DISABLED ROW (row.disabled, e.g. a desktop-only map on a phone) stays in the rail, greyed, with its badge
   still readable. The click still reaches the consumer, so it can say WHY the row does not open. */
.vtl-tab.disabled, .vtl-tab.disabled:hover { background:none; color:#a3a8a4; cursor:not-allowed; }
.vtl-tab.disabled .vtl-tab-ic, .vtl-tab.disabled .vtl-tab-emoji, .vtl-tab.disabled .vtl-tab-fallback { opacity:.45; }
.vtl-tab.active .vtl-tab-ic { color:var(--vtl-accent); }
.vtl-tab-ic { flex:0 0 auto; display:inline-flex; color:var(--vtl-muted); }
.vtl-tab-ic svg { width:20px; height:20px; }
.vtl-tab-emoji { font-size:17px; line-height:1; flex:0 0 auto; }
.vtl-tab-fallback { display:none; flex:0 0 auto; width:20px; height:20px; align-items:center; justify-content:center; font-size:12px; font-weight:600; color:var(--vtl-muted); background:var(--vtl-accented); border-radius:6px; }
.vtl-tab.active .vtl-tab-fallback { color:var(--vtl-accent); }
.vtl-tab-text { display:flex; flex-direction:column; min-width:0; }
.vtl-tab-label { font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:6px; }
.vtl-tab-badge { font:600 9px/1 system-ui; letter-spacing:.3px; text-transform:uppercase; color:var(--vtl-accent); border:1px solid var(--vtl-accent); border-radius:var(--vtl-radius,8px); padding:2px 5px; }
.vtl-tab-sub { font-size:11px; color:#6b6b6b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.vtl-tab-sub code { font-family:ui-monospace,Menlo,monospace; }
.vtl-tab.active .vtl-tab-sub { color:var(--vtl-muted); }
.vtl-main { position:absolute; top:0; bottom:0; right:0; left:256px; min-width:0; display:flex; flex-direction:column; }
/* ★ contain:layout, NOT layout paint (BUG-STILL-CANNOT-SCROLL-DOWN-TO-THE-GRID, measured
   2026-09-22). layout is the half that does the work the rail collapse needs — it isolates this
   subtree so sliding the rail never reflows a heavy mounted map. paint additionally CLIPS the
   subtree to this box, which silently swallowed every pixel a scroll-stack composite rendered below
   one viewport. The clipping now belongs to .vtl-host, which owns a real scrollbar, so the content
   is both contained AND reachable. Dropping paint costs the collapse nothing: paint never
   contributed reflow isolation, only clipping. */
.vtl-content { flex:1 1 auto; position:relative; min-height:0; }
/* ★ NO containment AT ALL on .vtl-content (BUG-FULLSCREEN-MODALS-UNDERSIZED-INSIDE-THE-CAP5-SHELL,
   measured 2026-09-23). contain:paint was dropped earlier for the scroll bug; contain:layout
   stayed -- but LAYOUT containment ALSO makes this element the containing block for every
   position:fixed descendant (CSS Containment spec), so all six modal scrims hosted in the shell
   (PosterDialog, DataTable .dt-scrim, LegendTools .lt-overlay, SemanticTreeLegend export
   backdrop, both poster-wall .modal-scrim) resolved inset:0 to the CONTENT PANE: measured, a
   fixed inset:0 probe here read x=256 w=1184 on a 1440 viewport, leaving the 256px nav rail
   uncovered and CLICKABLE behind an open modal. Visibly almost right, interactively wrong.
   The perf rationale it was kept for does not hold: when the nav collapses, this element's own
   width changes, and a width change re-lays-out the subtree with or without containment. */
/* ★ THE PANE OWNS THE SCROLL (BUG-STILL-CANNOT-SCROLL-DOWN-TO-THE-GRID). Measured in the cap-5
   shell: the dashboard-plus-grid composite mounted here reported scrollHeight 3380 / clientHeight
   769 — 2611px of real, mounted, populated content (the people-groups grid, h=2586) that NO element
   could scroll to, because this box was position:absolute; inset:0 with the default
   overflow:visible. The document itself measured scrollHeight 900 === clientHeight 900, so a
   wheel gesture anywhere had nothing to move and the page simply sat still.
   THIS IS A HOST GAP, NOT A PLUGIN BUG. The same composite is PERFECT standalone (document
   2960/900, wheel scrolls to 2060, grid reachable) because its generated leaf sets
   body{overflow-y:auto} — the document owns the scroll there. In this shell the pane is pinned to
   viewport height and no ancestor scrolls, so the layout must own it. generate-tree.mjs keeps cap-5
   leaves fixed-viewport on the reasoning that "any scroll-stack it hosts is its OWN iframe leaf" —
   but the studio documents "there is NO iframe mode": every tab mounts its REAL custom element
   directly into this pane. So the scroll has to land here.
   WHY THIS IS SAFE FOR THE FIXED-VIEWPORT MAP TABS, which are the majority. A map element ships
   position:absolute; inset:0 (or height:100%) and therefore fills this box exactly:
   scrollHeight === clientHeight, so auto yields NO scrollbar and NOTHING changes for them. Only a
   pane whose content genuinely exceeds one viewport — i.e. a StackLayout scroll-stack, which is the
   composite that is meant to scroll — gets one. auto is load-bearing; scroll would paint a dead
   scrollbar on all 19 map tabs.
   overscroll-behavior:contain stops a wheel that bottoms out here from chaining to the document. */
.vtl-host { position:absolute; inset:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; --profile-min-h:0; }
/* The slot is the element's mount point. It must NOT be position:absolute; inset:0 any more: that
   pinned it to the pane's height and re-created the exact trap one level down — an absolutely
   positioned child cannot grow a scroll container. min-height:100% keeps a fixed-viewport map
   filling the pane (the behaviour absolute-inset gave it) while letting a taller scroll-stack
   composite push the pane's scrollHeight past its clientHeight, which is what produces the
   scrollbar. */
.vtl-host-slot { position:relative; min-height:100%; }
/* ★ THE dvh FLOOR, NEUTRALISED FOR HOSTED ELEMENTS (measured 2026-09-22 in the studio, same layout
   shape). A hosted map ships .profile-loader { height:100%; min-height:100dvh }, and the two resolve
   against DIFFERENT bases: height:100% against this pane, min-height:100dvh against the VIEWPORT.
   Wherever the pane is shorter than the viewport (any header/toolbar chrome above it), the floor
   wins, the element overflows by exactly that chrome height, and the overflow-y:auto above then
   correctly paints a scrollbar on a fixed-viewport map that should never have one.
   The floor is DELIBERATE and must stay in the element (standalone it prevents a collapse to 0
   against an auto-height body). It is only wrong HERE, against a definite shorter pane. A genuine
   scroll-stack composite is unaffected: it exceeds the pane on its own content, not on this floor. */
.vtl-host-slot > * { min-height:0; max-height:none; }
.vtl-host-hint { position:absolute; inset:0; display:grid; place-items:center; text-align:center; color:var(--dx-muted, #6d766e); font-size:13px; padding:20px; }
.vtl-host-hint.err { color:#f87171; }
.vtl-host-reload { margin-block-start:10px; font:inherit; padding:4px 12px; border-radius:6px; cursor:pointer; background:var(--vtl-accent, #3b463d); color:#fff; border:none; }
.vtl-host-hint small { color:var(--dx-muted, #6d766e); }
/* MATERIAL MINI-VARIANT RAIL = 72px (2026-09-21), up from 60px.
   ★ THE COLLAPSE IS A TRANSLATE, NOT A WIDTH CHANGE — so FOUR numbers are coupled and must move
   together, which is precisely where a partial edit would break the layout:
     nav translate  -184px   the 256px rail slides left, leaving 256-184 = 72px visible
     main left       72px    the content pane starts exactly where the rail ends
     collapse pad   184px    pushes the toggle's icon into the 72px strip that stays on screen
                             (the #rail-end slot takes the same pad, so its menu sits in the strip too)
     tab pad        188px    the same for each row's icon (4px more, matching the old 196/200 pair)
   Change one without the others and the icons drift out of the visible strip or the content
   overlaps the rail. Old values were -196 / 60 / 196 / 200.
   THIS BLOCK EXISTS TWICE (VTL_SHADOW_CSS and the scoped style block); keep them byte-identical. */
.vtl.rail-collapsed .vtl-nav { transform:translateX(-184px); }
.vtl.rail-collapsed .vtl-main { left:72px; }
.vtl.rail-collapsed .vtl-collapse, .vtl.rail-collapsed .vtl-home { padding-left:184px; justify-content:flex-start; }
.vtl.rail-collapsed .vtl-collapse-ic { transform:rotate(0deg); }
.vtl.rail-collapsed .vtl-rail-end { padding-left:184px; }
.vtl.rail-collapsed .vtl-collapse-tx, .vtl.rail-collapsed .vtl-home-tx { display:none; }
.vtl.rail-collapsed .vtl-tab { padding-left:188px; gap:0; }
.vtl.rail-collapsed .vtl-tab-text { display:none; }
.vtl.rail-collapsed .vtl-tab-emoji { font-size:19px; }
.vtl.rail-collapsed .vtl-tab-fallback { display:inline-flex; }
.vtl.rail-collapsed .vtl-tier { padding-left:196px; }
.vtl.rail-collapsed .vtl-tl, .vtl.rail-collapsed .vtl-td, .vtl.rail-collapsed .vtl-cap, .vtl.rail-collapsed .vtl-chev { display:none; }
.vtl.rail-collapsed .vtl-grp + .vtl-grp { margin-top:6px; padding-top:6px; }
@media (max-width: 760px) {
  /* Material app bar is 56px on mobile, 64px on desktop — the desktop value is set above. */
  .vtl-top { min-height:56px; }
  .vtl-menu { display:inline-block; }
  .vtl-meta { display:none; }
  /* MOBILE = the SAME composited-transform model, taken to its full-off-canvas extreme: a full-width
     drawer that slides in/out via transform (never a layout property), so opening/closing the drawer
     never reflows the content. Content is full-width (left:0) and stays put; the drawer floats over it. */
  /* NO SHADOW WHILE CLOSED: parked at translateX(-100%), a 28px blur still bleeds into the screen along the start
     edge (measured at 390: the left 30px ~22 luminance levels darker). The shadow belongs to the OPEN drawer only. */
  .vtl-nav { z-index:20; width:256px; box-shadow:none; transform:translateX(-100%); }
  /* OPEN DRAWER ABOVE THE PLUGIN'S OWN LAYERS. Mounted content shares this stacking context, and
     plugins raise their chrome (the research dashboard's filter bar is z-index:55), so at z-index 20
     the open drawer had a plugin's filter row painted across it — measured 2026-09-25 at 390px.
     Only while OPEN on a phone: that is when the drawer is the one thing you can use, and desktop
     and plugin modal scrims keep their existing order.
     100000, not 1000: the phone legend sheet (LegendMobile) is z-index:1000, and a tie left DOM order to decide,
     so the legend drew over the open drawer. Every plugin layer sits below 100000; a MODAL's scrim (MapInfo,
     2147483000) still covers the drawer, as a modal should. */
  .vtl.nav-open .vtl-nav { transform:translateX(0); z-index:100000; box-shadow:0 0 28px rgba(0,0,0,.55); }
  .vtl-main { left:0; }
  /* The desktop slim-rail collapse has no meaning on a phone — reconcileForWidth() clears railCollapsed
     at this width, but neutralize its CSS too (belt-and-suspenders) so a full labelled drawer always
     shows: no partial slide, no icon-column padding, labels/sections visible. */
  .vtl.rail-collapsed .vtl-nav { transform:translateX(-100%); }
  .vtl.rail-collapsed.nav-open .vtl-nav { transform:translateX(0); }
  .vtl.rail-collapsed .vtl-main { left:0; }
  .vtl.rail-collapsed .vtl-collapse, .vtl.rail-collapsed .vtl-home { padding-left:10px; justify-content:flex-start; }
  .vtl.rail-collapsed .vtl-collapse-ic { transform:rotate(180deg); }
  .vtl.rail-collapsed .vtl-collapse-tx, .vtl.rail-collapsed .vtl-home-tx { display:inline; }
  .vtl.rail-collapsed .vtl-tab { padding-left:10px; gap:11px; }
  .vtl.rail-collapsed .vtl-tab-text { display:flex; }
  .vtl.rail-collapsed .vtl-tab-fallback { display:none; }
  .vtl.rail-collapsed .vtl-tier { padding-left:8px; }
  .vtl.rail-collapsed .vtl-tl, .vtl.rail-collapsed .vtl-td, .vtl.rail-collapsed .vtl-cap, .vtl.rail-collapsed .vtl-chev { display:inline; }
}

/* ★ RIGHT-TO-LEFT (ar). THIS BLOCK EXISTS TWICE (VTL_SHADOW_CSS and the scoped style block); keep them
   byte-identical. Everything above is written in PHYSICAL terms (left:0 rail, left:256px content,
   translateX(-…) slides), so an Arabic shell kept the rail on the left with LTR geometry (reported by
   studio for cell E, 2026-09-25). These are ADDITIVE overrides scoped by :dir(rtl), so an LTR consumer
   matches none of them and renders exactly as before. :dir() follows the dir attribute through the
   shadow boundary, so either a consumer setting dir="rtl" on the layout or an RTL host page flips it.
   translateX has no logical form, which is why this is a mirror block rather than logical properties. */
.vtl:dir(rtl) .vtl-nav { left:auto; right:0; border-right:0; border-left:1px solid var(--vtl-border); }
.vtl:dir(rtl) .vtl-main { left:0; right:256px; }
.vtl:dir(rtl) .vtl-tab, .vtl:dir(rtl) .vtl-tier-btn { text-align:right; }
.vtl:dir(rtl) .vtl-meta, .vtl:dir(rtl) .vtl-td, .vtl:dir(rtl) .vtl-chev { margin-left:0; margin-right:auto; }
.vtl:dir(rtl) .vtl-chev:not(.open) { transform:scaleX(-1); }
.vtl:dir(rtl) .vtl-collapse-ic svg { transform:scaleX(-1); }
.vtl.rail-collapsed:dir(rtl) .vtl-nav { transform:translateX(184px); }
.vtl.rail-collapsed:dir(rtl) .vtl-main { left:0; right:72px; }
.vtl.rail-collapsed:dir(rtl) .vtl-collapse, .vtl.rail-collapsed:dir(rtl) .vtl-home { padding-left:10px; padding-right:184px; }
.vtl.rail-collapsed:dir(rtl) .vtl-tab { padding-left:12px; padding-right:188px; }
.vtl.rail-collapsed:dir(rtl) .vtl-tier { padding-left:8px; padding-right:196px; }
.vtl.rail-collapsed:dir(rtl) .vtl-rail-end { padding-left:0; padding-right:184px; }
@media (max-width: 760px) {
  .vtl:dir(rtl) .vtl-nav { transform:translateX(100%); }
  .vtl.nav-open:dir(rtl) .vtl-nav { transform:translateX(0); }
  .vtl:dir(rtl) .vtl-main, .vtl.rail-collapsed:dir(rtl) .vtl-main { left:0; right:0; }
  .vtl.rail-collapsed:dir(rtl) .vtl-nav { transform:translateX(100%); }
  .vtl.rail-collapsed.nav-open:dir(rtl) .vtl-nav { transform:translateX(0); }
  .vtl.rail-collapsed:dir(rtl) .vtl-collapse, .vtl.rail-collapsed:dir(rtl) .vtl-home { padding-left:10px; padding-right:10px; }
  .vtl.rail-collapsed:dir(rtl) .vtl-tab { padding-left:12px; padding-right:10px; }
  .vtl.rail-collapsed:dir(rtl) .vtl-tier { padding-left:8px; padding-right:8px; }
}
/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree). Additive only. */
@media (prefers-reduced-motion: reduce) {
  .vtl-nav, .vtl-collapse-ic, .vtl-tab, .vtl-tier, .vtl-pbar, .vtl-phone-menu, .vtl-rail-end, .vtl-scrim { transition: none !important; animation: none !important; }
}
`

export default defineComponent({
  name: 'VerticalTabsLayout',
  components: { BackToTopButton },
  props: {
    // Controlled active key (v-model:active). Matches an item's / row's `key`.
    active: { type: String, default: '' },
    title: { type: String, default: '' },
    // FLAT shape: [{ key, label, sub?, emoji? }]
    items: { type: Array, default: () => [] },
    // GROUPED shape: [{ key, label, badge?, count?, rows: [{ key, label, sub?, emoji? }] }]
    // When `groups` is non-empty it takes precedence over `items`.
    groups: { type: Array, default: () => [] },
    navLabel: { type: String, default: 'Sections' },
    // The shell's own words, for a localised host: { toggleList, openViews, expandList, collapseList,
    // collapse, home }. Any key left out keeps its English default, so existing hosts are unchanged.
    labels: { type: Object, default: () => ({}) },
    // Start with the rail open (desktop). Auto-collapses on narrow screens after mount.
    initialNavOpen: { type: Boolean, default: true },
    // Render the top bar (#brand / title / #meta). Pass false for a sidebar-only, full-page element
    // (embedded where a host header already exists — stacked headers look bad). #toolbar is unaffected.
    header: { type: Boolean, default: true },
    // Start the desktop rail collapsed (slim icon rail). Off by default so the rail opens expanded.
    initialRailCollapsed: { type: Boolean, default: false },
    // The HOST's homepage, shown as a link above Collapse (see the template). Empty = no link, which is
    // every existing consumer. homeLabel is the host's own words; unset, labels.home, then English.
    homeHref: { type: String, default: '' },
    homeLabel: { type: String, default: '' },
    // ★ WHERE THIS SHELL LIVES, which decides its phone chrome when header is off:
    //   'app'  — it owns the screen (a Capacitor/standalone app, or a DX Maps leaf page): the 44px phone bar.
    //   'web'  — it sits in a website that has its own header: NO second bar; a corner ☰ + the language in the drawer.
    //   'auto' — the host element's shell-mode attribute if it has one, else app for Capacitor, display-mode
    //            standalone or a leaf (window.MAP_OWNS_PAGE), else web.
    shellMode: { type: String, default: 'auto' }
  },
  emits: ['update:active'],
  setup() {
    useShadowStyles(VTL_SHADOW_CSS, 'vertical-tabs-layout')
    return { T: tr }
  },
  data() {
    // _hostEls: the .vtl-host pane per tab key. The shell's scroller is the ACTIVE pane, and
    // there is one per mounted tab, so the back-to-top has to follow `active` rather than
    // binding a single ref. Not reactive-deep on purpose: these are DOM nodes.

    // _folderOverride: user toggles keyed by group key (true=open, false=closed). When a folder
    // key is absent here we fall back to the group's own `open` flag (default closed) — so a
    // folder authored with open:false starts collapsed and the user can still open it.
    //
    // Nested-element hosting (lazy): activatedKeys marks which element-rows have EVER been the active
    // tab (so their pane is rendered + element mounted); hostState/hostError track each pane's load.
    // A row not in activatedKeys is never rendered — the lazy contract (no visit → no cost).
    // ★ A PHONE STARTS CLOSED FROM THE FIRST RENDER. navOpen used to start as initialNavOpen (true) and only
    // mounted() closed it, so on a phone the first paint drew the drawer OPEN (.nav-open) and its transform
    // transition then slid it away (measured: on screen until ~0.75-1.6 s after load, both shells, app and
    // web). Reading the same media query here makes the first render already the phone's closed state, so
    // nothing animates; mounted() keeps tracking crossings as before.
    const narrowNow = (() => {
      try { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 760px)').matches } catch (_) { return false }
    })()
    return {
      navOpen: this.initialNavOpen && !narrowNow, railCollapsed: narrowNow ? false : this.initialRailCollapsed, _tabEls: {}, folderOverride: {},
      // `narrow` mirrors the (max-width:760px) media query as REACTIVE state, kept current by a resize
      // listener. It lets us reconcile the two boolean state machines (navOpen = mobile drawer,
      // railCollapsed = desktop slim rail) at the breakpoint and drive rail visibility correctly.
      narrow: narrowNow, _mql: null, _onMedia: null,
      activatedKeys: {}, hostState: {}, hostError: {}, _hostSlots: {}, _hostMounted: {},
      hostEls: {},
      // The resolved shellMode ('app' | 'web'), set at mount (it reads the host element and the platform).
      mode: 'app'
    }
  },
  computed: {
    /**
     * ★ ONE SOURCE OF TRUTH FOR EACH SLOT'S PLACE. The phone bar and the rail's bottom slot are the
     * same control in two places, and exactly one of them may show: the bar on a phone, the rail-end
     * on a desktop, and neither when a header is on (its #toolbar carries the menu). The template,
     * the grid row (.has-phone-bar) and check:shell-header all read these two, never a copy.
     */
    phoneBarShown() { return this.narrow && !this.header },
    railEndShown() { return !this.narrow && !this.header },
    /**
     * The element the back-to-top arrow scrolls. .vtl-host is the shell's scroller
     * (overflow-y:auto) and there is one PER TAB, so this follows `active` rather than binding a
     * single ref — otherwise the arrow would drive whichever pane happened to render last.
     *
     * ★ THE ARROW LIVES HERE, NOT IN THE PLUGINS, and that is forced rather than chosen: the
     * people-group grid has no scroller of its own (.pgg-root sets no overflow and .pgg-body has
     * no rule at all), so in this shell the thing that scrolls is OUTSIDE the plugin's shadow
     * root and the plugin cannot reach it. A plugin that DOES own its scroller — the regions
     * dashboard's .rd-scroll — mounts the same component itself and drives its own element.
     */
    activeHostEl() { return this.hostEls[this.active] || null },
    // Is the rail element visible at all? DESKTOP: always (it just shrinks when railCollapsed). MOBILE:
    // only when the off-canvas drawer is open (navOpen). Binding the rail's v-show to THIS (not raw
    // navOpen) prevents a mobile-closed drawer from hiding the rail after a resize back to desktop.
    railShown() { return this.narrow ? this.navOpen : true },
    // The home link's URL, or '' for none. A script URL is refused: the value can arrive through an
    // attribute or a JSON config, and a link that runs code is never a way home.
    homeLink() {
      const h = String(this.homeHref || '').trim()
      return (!h || /^(javascript|data|vbscript):/i.test(h.replace(/[\u0000- ]/g, ''))) ? '' : h
    },
    homeText() { return this.homeLabel || this.label('home') },
    // Every row/item flattened across whichever shape is in use (groups take precedence over items).
    allRows() {
      if (this.groups && this.groups.length) {
        const out = []
        for (const g of this.groups) for (const r of (g.rows || [])) out.push(r)
        return out
      }
      return this.items
    },
    // Flat ordered list of keys — drives keyboard nav.
    orderedKeys() { return this.allRows.map(r => r.key) },
    // Rows that ask THIS layout to host a nested custom element (have an `element` tag).
    elementRows() { return this.allRows.filter(r => r && r.element) },
    // Element rows that have been activated at least once — only these get a rendered/mounted pane
    // (the lazy contract: a never-visited tab is never in this list, so it costs nothing).
    mountedElementRows() { return this.elementRows.filter(r => this.activatedKeys[r.key]) }
  },
  watch: {
    shellMode() { this.resolveShellMode() },
    // Lazily activate an element-hosting tab the FIRST time it becomes active (mount on demand,
    // then keep alive). Non-element tabs are ignored here (the host renders those in #default).
    active: {
      immediate: true,
      handler(key) { this.activateElement(key) }
    }
  },
  mounted() {
    this.resolveShellMode()
    // Track the breakpoint reactively and RECONCILE state whenever we cross it — this is the fix for the
    // "extremely buggy" collapse: without it, `navOpen` (mobile drawer) and `railCollapsed` (desktop slim
    // rail) drifted out of the regime they were set in, and a mobile-closed drawer could hide the whole
    // desktop rail. On each change we snap the flags back into a coherent state for the new width.
    try {
      if (window.matchMedia) {
        this._mql = window.matchMedia('(max-width: 760px)')
        this.narrow = this._mql.matches
        this.reconcileForWidth()
        this._onMedia = (e) => { this.narrow = e.matches; this.reconcileForWidth() }
        // addEventListener is the modern API; addListener is the Safari<14 fallback.
        if (this._mql.addEventListener) this._mql.addEventListener('change', this._onMedia)
        else if (this._mql.addListener) this._mql.addListener(this._onMedia)
      }
    } catch { /* ignore — non-DOM/SSR guards */ }
    // The immediate `active` watcher may have run before the pane div existed; re-run for the current
    // active key now that the DOM is up, so an element-tab active at first render mounts.
    this.$nextTick(() => this.activateElement(this.active))
  },
  beforeUnmount() {
    try {
      if (this._mql && this._onMedia) {
        if (this._mql.removeEventListener) this._mql.removeEventListener('change', this._onMedia)
        else if (this._mql.removeListener) this._mql.removeListener(this._onMedia)
      }
    } catch { /* ignore */ }
    this._mql = null; this._onMedia = null
  },
  methods: {
    resolveShellMode() {
      const pick = (m) => (m === 'web' || m === 'app' ? m : null)
      let m = pick(this.shellMode)
      if (!m) {
        try {
          const root = this.$el && this.$el.getRootNode ? this.$el.getRootNode() : null
          const host = root && root.host
          m = pick(host && host.getAttribute ? host.getAttribute('shell-mode') : null)
        } catch (_) { /* no host element */ }
      }
      if (!m) {
        try {
          const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true
          m = window.Capacitor || standalone || window.MAP_OWNS_PAGE === true ? 'app' : 'web'
        } catch (_) { m = 'app' }
      }
      this.mode = m
    },
    registerTab(key, el) { if (el) this._tabEls[key] = el },
    // The rail toggle. On a narrow screen the rail is an off-canvas drawer, so the toggle closes the
    // drawer (navOpen). On desktop it collapses/expands the slim icon rail (railCollapsed, persisted
    // in component data). Reading matchMedia at click time keeps one toggle correct in both modes.
    isNarrow() { return this.narrow },
    // Snap the two boolean state machines into a coherent state for the CURRENT width. Called on mount and
    // on every breakpoint crossing. DESKTOP: the rail is always visible, so force navOpen=true (a stale
    // mobile-closed drawer must never hide the desktop rail). MOBILE: the rail is an off-canvas drawer that
    // should start CLOSED, and the desktop slim-rail collapse has no meaning here, so clear railCollapsed so
    // reopening the drawer always shows a full-width, labelled list.
    reconcileForWidth() {
      if (this.narrow) {
        this.navOpen = false
        this.railCollapsed = false
      } else {
        this.navOpen = true
      }
    },
    label(key) {
      const EN = { toggleList: 'Toggle list', openViews: 'Open the list of views', expandList: 'Expand list', collapseList: 'Collapse list', collapse: 'Collapse', home: 'Back to homepage' }
      return (this.labels && this.labels[key]) || EN[key]
    },
    // Open the desktop rail if it is in its slim state (a #rail host calls this when its slim-strip
    // icons are clicked: "show me that section" means the full rail). No-op when already open.
    expandRail() { if (!this.narrow && this.railCollapsed) this.railCollapsed = false },
    toggleRail() {
      if (this.narrow) this.navOpen = !this.navOpen
      else this.railCollapsed = !this.railCollapsed
    },
    setHostSlot(key, el) { if (el) { this._hostSlots[key] = el; this.$nextTick(() => this.mountHostElement(key)) } },
    // Mark an element-row activated (renders its pane) on first activation; mount happens once the
    // pane's slot div exists (setHostSlot → mountHostElement). Idempotent: re-activating is a no-op.
    activateElement(key) {
      if (!key) return
      const row = this.elementRows.find(r => r.key === key)
      if (!row) return                       // not an element-hosting tab
      if (!this.activatedKeys[key]) {
        this.activatedKeys = { ...this.activatedKeys, [key]: true }
        // Re-show: pick up any canvas created since the last look.
        this.$nextTick(() => this.watchContextLoss(key))
        this.hostState = { ...this.hostState, [key]: 'loading' }
      }
      // If the pane/slot already exists (re-activation, or pane rendered), ensure it is mounted.
      this.$nextTick(() => this.mountHostElement(key))
    },
    // Imperatively mount the row's custom element into its empty slot div — lazy-inject its bundle
    // first (deduped), wait for the tag to be defined, set `attrs` BEFORE append (props-in-advance),
    // then append. Runs once per key (guarded by _hostMounted).
    /**
     * Every canvas under a pane, INCLUDING inside shadow roots. The map's canvas belongs to the
     * plugin's own shadow tree, and webglcontextlost does not bubble — so a listener on the pane
     * would never hear it. The listener has to go on the canvas itself.
     */
    deepCanvases(root, out = []) {
      if (!root) return out
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'CANVAS') out.push(el)
        if (el.shadowRoot) this.deepCanvases(el.shadowRoot, out)
      }
      return out
    },
    /**
     * Idempotent: canvases appear asynchronously after the map boots, and a pane can be re-shown
     * many times, so this is safe to call repeatedly and marks what it has already bound.
     */
    watchContextLoss(key) {
      const slot = this._hostSlots[key]
      if (!slot) return
      for (const c of this.deepCanvases(slot)) {
        if (c.__vtlLossBound) continue
        c.__vtlLossBound = true
        c.addEventListener('webglcontextlost', () => {
          this.hostState = { ...this.hostState, [key]: 'lost' }
        }, { once: true })
      }
    },
    /** Tear the pane down and mount it again — the only way back from a lost context. */
    reloadHostElement(key) {
      const slot = this._hostSlots[key]
      if (slot) slot.innerHTML = ''
      this._hostMounted[key] = false
      this.hostState = { ...this.hostState, [key]: 'loading' }
      this.$nextTick(() => this.mountHostElement(key))
    },
    mountHostElement(key) {
      if (this._hostMounted[key]) return
      const row = this.elementRows.find(r => r.key === key)
      const slot = this._hostSlots[key]
      if (!row || !slot) return              // pane not in the DOM yet; a later tick will retry
      this._hostMounted[key] = true
      this.hostState = { ...this.hostState, [key]: 'loading' }
      injectScriptOnce(row.src)
        .then(() => waitForDefine(row.element))
        .then(() => {
          // See StackLayout: name the owning bundle so a duplicate-tag page is audible, not silent.
          claimTag(row.element, row.src)
          slot.innerHTML = ''
          const el = document.createElement(row.element)
          // props-in-advance: set each attr as BOTH a property (if upgraded) and an attribute, so the
          // element sees them at its first connectedCallback whether it reads props or attributes.
          const attrs = row.attrs || {}
          for (const k in attrs) {
            const v = attrs[k]
            const val = (v != null && typeof v === 'object') ? JSON.stringify(v) : String(v)
            try { el[k] = v } catch { /* not a settable prop; attribute below covers it */ }
            try { el.setAttribute(k, val) } catch { /* ignore invalid attr name */ }
          }
          el.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;'
          slot.appendChild(el)
          // The map's canvas does not exist yet — the element has only just connected. Bind on the
          // next frames as it boots, and again whenever the pane is re-activated, because a canvas
          // created later would otherwise never be watched. watchContextLoss is idempotent.
          for (const ms of [0, 250, 1500]) setTimeout(() => this.watchContextLoss(key), ms)
          this.hostState = { ...this.hostState, [key]: 'ready' }
        })
        .catch((e) => {
          this._hostMounted[key] = false     // allow a retry on next activation
          this.hostState = { ...this.hostState, [key]: 'error' }
          this.hostError = { ...this.hostError, [key]: (e && e.message) || String(e) }
        })
    },
    // Resolve a LOCAL icon name to its inline SVG string (app-wrapper-material/icons.js). Names come
    // from OUR nav model (never user input); unknown names fall back to the library's own default.
    iconSvg(name) { return name ? localIcon(name) : '' },
    // First visible character of a label, uppercased — the slim-rail fallback glyph for a row that has
    // neither `icon` nor `emoji`, so the collapsed icon strip never shows an empty hit-target.
    initial(label) { const s = (label || '').trim(); return s ? s.charAt(0).toUpperCase() : '•' },
    // A folder is closed unless the user toggled it open, or (no toggle yet) unless it was authored
    // with open:true. `grp.open === true` opens by default; anything else starts collapsed.
    isFolderClosed(grp) {
      const ov = this.folderOverride[grp.key]
      if (ov != null) return !ov
      return grp.open !== true
    },
    toggleFolder(key) {
      const cur = this.folderOverride[key]
      const grp = (this.groups || []).find(g => g.key === key)
      const wasOpen = cur != null ? cur : (grp && grp.open === true)
      this.folderOverride = { ...this.folderOverride, [key]: !wasOpen }
    },
    pick(key) {
      this.$emit('update:active', key)
      // On mobile, picking a tab closes the off-canvas drawer. On desktop navOpen must stay true (it gates
      // the desktop rail's visibility via railShown), so we only touch it when narrow.
      if (this.narrow) this.navOpen = false
    },
    // ArrowUp/Down cycle the rail; Home/End jump to the ends. Moves selection AND focus so a
    // keyboard user drives the shell exactly like a native tablist.
    onKey(e) {
      const keys = this.orderedKeys
      if (!keys.length) return
      const cur = keys.indexOf(this.active)
      let next = -1
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (cur + 1) % keys.length
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (cur - 1 + keys.length) % keys.length
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = keys.length - 1
      else return
      e.preventDefault()
      const key = keys[next]
      this.pick(key)
      this.$nextTick(() => { const el = this._tabEls[key]; if (el && el.focus) el.focus() })
    }
  }
})
</script>

<style>
/* Mirror of VTL_SHADOW_CSS for dev / light-DOM readability. Keep the two in sync.
   Default dark theme (values are just colours, overridable via the --vtl-* custom properties):
   neutral-900 canvas, a SOLID accented active row (not a gradient), subtle borders, green-400
   (#92b195) accent, inline SVG icons. */
/* STRUCTURAL DISPLAY — the !important is deliberate, not a hack. This layout's display mode is
   load-bearing: it CANNOT function as a block. As a library/ (high-bar) component it ships across
   all 5 deployment methods, and a host (app-shell direct-mount, WordPress, mobile webview) may force
   its own inline display onto the element. Declaring it non-overridable is the correct contract.
   grid-template-rows: auto 1fr = header takes its natural height, .vtl-body gets a DEFINITE
   remaining track — no dependence on in-flow children (nav/main are absolute for the rail slide). */
.vtl { position:absolute; inset:0; display:grid !important; grid-template-rows:auto 1fr; height:100%; width:100%; min-height:420px; background:#f3f3f1; color:#3b463d; font-family:'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased; --vtl-accent:#92b195; --vtl-border:#d1d4cd; --vtl-elevated:#ffffff; --vtl-accented:#d1d4cd; --vtl-muted:#6d766e; --vtl-rail:256px; }
/* HEADER-OFF (header=false, e.g. the cap-5 doxa-maps-spa): the .vtl-top element is NOT rendered, so
   .vtl-body becomes the ONLY grid child and auto-places into row 1 — the auto row — which has no
   content to size it and collapses to 0 (the 1fr row sits empty) → the same 0-height black screen.
   With no header there is only one region, so declare a single 1fr row and the body fills. */
.vtl.no-header { grid-template-rows:1fr; }
/* ...except on a phone, where the header-off layout has its slim bar (.vtl-pbar) as a real first row. */
.vtl.no-header.has-phone-bar { grid-template-rows:auto 1fr; }
/* MATERIAL APP BAR = 64px desktop / 56px mobile (2026-09-21), was 51px from 11px padding.
   Stated as an explicit min-height rather than left to padding arithmetic, so the number a
   reader sees is the number that renders. min-height keeps a wrapping title from clipping.
   ★ box-sizing:border-box IS LOAD-BEARING HERE. Without it this element is content-box, so
   min-height:64px MEASURED 81px live: 64 + 16px vertical padding + 1px border. A height stated
   in a comment is worth nothing if the box model adds to it — measure the rendered value, do not
   trust the declaration. (Found exactly that way: the probe read 81 against a 64 target.)
   THIS RULE EXISTS TWICE (VTL_SHADOW_CSS and the scoped style block); keep them identical. */
.vtl-top { flex:0 0 auto; display:flex; align-items:center; gap:10px; box-sizing:border-box; min-height:64px; padding:8px 16px; border-bottom:1px solid var(--vtl-border); background:#ffffff; }
.vtl-menu { display:none; font:16px/1 system-ui; color:#3b463d; background:#d1d4cd; border:1px solid #d1d4cd; border-radius:8px; padding:5px 10px; cursor:pointer; }
/* THE PHONE BAR (phoneBarShown = narrow AND header-off; it replaced the floating corner circle).
   A real grid row above .vtl-body (.has-phone-bar below), so the drawer and the pane both start under
   it and it never covers plugin content. 44px + the top safe area; the rule line is an INSET SHADOW,
   not a border, so the 44px is the whole bar and the ☰ is a full 44×44 target. Flex follows the
   writing direction, so in ar the ☰ sits at the right (where the drawer opens) and the #phone-end
   menu at the left, with no :dir override. THIS RULE EXISTS TWICE; keep the copies identical. */
.vtl-pbar { display:flex; align-items:center; gap:8px; box-sizing:border-box; height:calc(44px + env(safe-area-inset-top)); padding:env(safe-area-inset-top) calc(4px + env(safe-area-inset-right)) 0 calc(4px + env(safe-area-inset-left)); background:#ffffff; box-shadow:inset 0 -1px 0 var(--vtl-border); }
.vtl-phone-menu { flex:0 0 auto; width:44px; height:44px; display:inline-flex; align-items:center; justify-content:center; padding:0; margin:0; font:20px/1 system-ui; color:#3b463d; background:transparent; border:0; border-radius:8px; cursor:pointer; }
.vtl-phone-menu:hover { background:var(--vtl-accented); }
.vtl-phone-menu:focus-visible { outline:2px solid var(--vtl-accent); outline-offset:-2px; }
/* WEB MODE: the same bar, without the camera inset (the shell is not at the top of the screen in a website). */
.vtl-pbar.is-web { height:44px; padding-top:0; }
.vtl-pbar-end { margin-inline-start:auto; display:inline-flex; align-items:center; min-width:0; }
.vtl-menu:hover { background:#d1d4cd; }
.vtl-brand { display:inline-flex; align-items:center; }
.vtl-brand:empty { display:none; }
.vtl-title { font-size:15px; font-weight:600; letter-spacing:-0.01em; color:#3b463d; }
.vtl-meta { color:var(--vtl-muted); font-size:12px; margin-left:auto; display:inline-flex; align-items:center; gap:8px; }
/* GRID ROWS, not flex (BUG-EMBEDDED-PLUGIN-STUDIO-BLACK-SCREEN). The collapsible-rail design makes
   .vtl-nav and .vtl-main position:absolute (so the rail slides by transform without reflowing the
   heavy map sibling). That leaves .vtl-body with NO in-flow children → ZERO intrinsic height, so it
   could only fill via flex:1 from a flex parent. A host that forces display:block on .vtl (the
   app-shell direct-mounts cap-5 elements that way) made that flex inert → .vtl-body collapsed to 0
   → black screen. The auto/1fr grid on .vtl gives this row a DEFINITE height by construction, so
   it no longer depends on the parent's display mode NOR on in-flow children. Header-off
   (header=false) still works: the auto row collapses to 0 and 1fr takes the full height. */
.vtl-body { min-height:0; position:relative; display:flex; }
.vtl-nav { position:absolute; top:0; bottom:0; left:0; z-index:5; width:256px; box-sizing:border-box; overflow-y:auto; overflow-x:hidden; border-right:1px solid var(--vtl-border); padding:12px 12px 20px; background:#ffffff; scrollbar-width:thin; scrollbar-color:#c4c8c0 transparent; contain:layout paint; transform:translateX(0); transition:transform .2s cubic-bezier(.4,0,.2,1); will-change:transform; }
/* Thin OVERLAY scrollbar: transparent track so the bar costs no visual space and sits flush to
   the nav edge; low-contrast thumb that darkens on hover. Matches the research-dashboard rails. */
.vtl-nav::-webkit-scrollbar { width:8px; height:8px; }
.vtl-nav::-webkit-scrollbar-track { background:transparent; }
.vtl-nav::-webkit-scrollbar-thumb { background:#c4c8c0; border-radius:8px; }
.vtl-nav::-webkit-scrollbar-thumb:hover { background:#9aa197; }
.vtl-collapse, .vtl-home { display:flex; align-items:center; gap:8px; width:100%; box-sizing:border-box; margin:0 0 8px; padding:7px 10px; border:1px solid var(--vtl-border); border-radius:8px; background:#d1d4cd; color:var(--vtl-muted); font:inherit; font-size:12px; cursor:pointer; }
.vtl-collapse:hover, .vtl-home:hover { background:var(--vtl-accented); color:#3b463d; }
.vtl-collapse:focus-visible, .vtl-home:focus-visible { outline:2px solid var(--vtl-accent); outline-offset:-2px; }
.vtl-collapse-ic { flex:0 0 auto; display:inline-flex; transition:transform .16s ease; transform:rotate(180deg); }
.vtl-collapse-ic svg { width:16px; height:16px; }
.vtl-collapse-tx { white-space:nowrap; }
/* The host’s home link (homeHref) shares Collapse’s box through the selector lists above and below, so the
   two are the same size by construction and cannot drift apart. The house does not rotate or mirror. */
.vtl-home { text-decoration:none; }
.vtl-home-ic { flex:0 0 auto; display:inline-flex; }
.vtl-home-ic svg { width:16px; height:16px; }
.vtl-home-tx { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* THE RAIL'S BOTTOM SLOT (#rail-end: railEndShown = wide AND header-off, and a filler present). The nav
   becomes a column ONLY then, so every other rail lays out exactly as before. margin-top:auto parks the
   slot at the bottom while the tabs are short; sticky keeps it in view once they scroll. The nav's own
   bottom padding moves into the slot, so the sticky row sits flush with the rail's bottom edge. */
.vtl-nav.has-rail-end { display:flex; flex-direction:column; padding-bottom:0; }
.vtl-nav.has-rail-end > * { flex-shrink:0; }
.vtl-rail-end { margin-top:auto; position:sticky; bottom:0; padding:8px 0 12px; background:#ffffff; border-top:1px solid var(--vtl-border); }
.vtl-grp { margin-bottom:2px; }
.vtl-grp + .vtl-grp { margin-top:8px; padding-top:8px; border-top:1px solid var(--vtl-border); }
.vtl-tier { width:100%; padding:8px 8px 6px; display:flex; align-items:center; gap:8px; box-sizing:border-box; }
.vtl-tier-btn { border:0; background:none; color:inherit; font:inherit; cursor:pointer; text-align:left; border-radius:8px; }
.vtl-tier-btn:hover { background:var(--vtl-accented); }
.vtl-tier-btn:focus-visible { outline:2px solid var(--vtl-accent); outline-offset:-2px; }
.vtl-tier-ic { flex:0 0 auto; display:inline-flex; color:var(--vtl-muted); }
.vtl-tier-ic svg { width:15px; height:15px; }
.vtl-cap { font:700 10px/1 system-ui; letter-spacing:.4px; color:#052e16; background:var(--vtl-accent); border-radius:999px; padding:3px 7px; }
.vtl-tl { font-weight:600; font-size:11px; letter-spacing:.03em; text-transform:uppercase; color:var(--vtl-muted); }
.vtl-td { color:#6b6b6b; font-size:11px; margin-left:auto; }
.vtl-chev { margin-left:auto; display:inline-flex; color:var(--vtl-muted); transition:transform .16s ease; }
.vtl-chev svg { width:15px; height:15px; }
.vtl-chev.open { transform:rotate(90deg); }
.vtl-rows { display:flex; flex-direction:column; gap:1px; }
/* MATERIAL NAV-ROW METRICS (2026-09-21). Product decision: follow the familiar
   Material/YouTube list layout rather than custom styling readers are not used to.
   Measured before this change: 44px rows with an 8px radius.
     min-height:48px     the Material list-item height. min-height, not height, so a wrapping
                         label still grows instead of clipping.
     border-radius         var(--vtl-radius,8px) — SUPERSEDED THE FULL PILL (2026-09-23).
                         A 999px stadium (modelled on YouTube's active row) shipped first. It
                         was reversed after it was compared with the rest of the product:
                         nothing else in the app is that round. .vtl-collapse is 8px, the
                         filter toggles in @map/components/search are 8px, and 8px is already
                         the most common radius in this file. A 999px radius on a 48px row is a
                         stadium, which is why it reads as foreign beside everything else.
                         ★ DO NOT "RESTORE" THE PILL on the strength of the YouTube model
                         above. It is kept because it is true history, not because
                         it is current. The 48px Material row height is unaffected and stays.
   NOT VENDORED: the card's law is to imitate the metrics in our own CSS, never to add Quasar or
   MUI. Same clone-dont-edit rule the library follows everywhere else.
   THIS RULE EXISTS TWICE (VTL_SHADOW_CSS and the scoped style block) and the two copies must stay
   byte-identical — edit both or neither. */
.vtl-tab { display:flex; align-items:center; gap:11px; width:100%; min-height:48px; text-align:left; border:0; background:none; color:var(--vtl-muted); padding:8px 12px; cursor:pointer; border-radius:var(--vtl-radius,8px); font:inherit; margin:0; transition:background .13s ease,color .13s ease; }
.vtl-tab:hover { background:var(--vtl-accented); color:#3b463d; }
.vtl-tab:focus-visible { outline:2px solid var(--vtl-accent); outline-offset:-2px; }
.vtl-tab.active { background:var(--vtl-accented); color:#3b463d; font-weight:500; }
/* A DISABLED ROW (row.disabled, e.g. a desktop-only map on a phone) stays in the rail, greyed, with its badge
   still readable. The click still reaches the consumer, so it can say WHY the row does not open. */
.vtl-tab.disabled, .vtl-tab.disabled:hover { background:none; color:#a3a8a4; cursor:not-allowed; }
.vtl-tab.disabled .vtl-tab-ic, .vtl-tab.disabled .vtl-tab-emoji, .vtl-tab.disabled .vtl-tab-fallback { opacity:.45; }
.vtl-tab.active .vtl-tab-ic { color:var(--vtl-accent); }
.vtl-tab-ic { flex:0 0 auto; display:inline-flex; color:var(--vtl-muted); }
.vtl-tab-ic svg { width:20px; height:20px; }
.vtl-tab-emoji { font-size:17px; line-height:1; flex:0 0 auto; }
.vtl-tab-fallback { display:none; flex:0 0 auto; width:20px; height:20px; align-items:center; justify-content:center; font-size:12px; font-weight:600; color:var(--vtl-muted); background:var(--vtl-accented); border-radius:6px; }
.vtl-tab.active .vtl-tab-fallback { color:var(--vtl-accent); }
.vtl-tab-text { display:flex; flex-direction:column; min-width:0; }
.vtl-tab-label { font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:6px; }
.vtl-tab-badge { font:600 9px/1 system-ui; letter-spacing:.3px; text-transform:uppercase; color:var(--vtl-accent); border:1px solid var(--vtl-accent); border-radius:var(--vtl-radius,8px); padding:2px 5px; }
.vtl-tab-sub { font-size:11px; color:#6b6b6b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.vtl-tab-sub code { font-family:ui-monospace,Menlo,monospace; }
.vtl-tab.active .vtl-tab-sub { color:var(--vtl-muted); }
.vtl-main { position:absolute; top:0; bottom:0; right:0; left:256px; min-width:0; display:flex; flex-direction:column; }
/* ★ contain:layout, NOT layout paint (BUG-STILL-CANNOT-SCROLL-DOWN-TO-THE-GRID, measured
   2026-09-22). layout is the half that does the work the rail collapse needs — it isolates this
   subtree so sliding the rail never reflows a heavy mounted map. paint additionally CLIPS the
   subtree to this box, which silently swallowed every pixel a scroll-stack composite rendered below
   one viewport. The clipping now belongs to .vtl-host, which owns a real scrollbar, so the content
   is both contained AND reachable. Dropping paint costs the collapse nothing: paint never
   contributed reflow isolation, only clipping. */
.vtl-content { flex:1 1 auto; position:relative; min-height:0; }
/* ★ NO containment AT ALL on .vtl-content (BUG-FULLSCREEN-MODALS-UNDERSIZED-INSIDE-THE-CAP5-SHELL,
   measured 2026-09-23). contain:paint was dropped earlier for the scroll bug; contain:layout
   stayed -- but LAYOUT containment ALSO makes this element the containing block for every
   position:fixed descendant (CSS Containment spec), so all six modal scrims hosted in the shell
   (PosterDialog, DataTable .dt-scrim, LegendTools .lt-overlay, SemanticTreeLegend export
   backdrop, both poster-wall .modal-scrim) resolved inset:0 to the CONTENT PANE: measured, a
   fixed inset:0 probe here read x=256 w=1184 on a 1440 viewport, leaving the 256px nav rail
   uncovered and CLICKABLE behind an open modal. Visibly almost right, interactively wrong.
   The perf rationale it was kept for does not hold: when the nav collapses, this element's own
   width changes, and a width change re-lays-out the subtree with or without containment. */
/* ★ THE PANE OWNS THE SCROLL (BUG-STILL-CANNOT-SCROLL-DOWN-TO-THE-GRID). Measured in the cap-5
   shell: the dashboard-plus-grid composite mounted here reported scrollHeight 3380 / clientHeight
   769 — 2611px of real, mounted, populated content (the people-groups grid, h=2586) that NO element
   could scroll to, because this box was position:absolute; inset:0 with the default
   overflow:visible. The document itself measured scrollHeight 900 === clientHeight 900, so a
   wheel gesture anywhere had nothing to move and the page simply sat still.
   THIS IS A HOST GAP, NOT A PLUGIN BUG. The same composite is PERFECT standalone (document
   2960/900, wheel scrolls to 2060, grid reachable) because its generated leaf sets
   body{overflow-y:auto} — the document owns the scroll there. In this shell the pane is pinned to
   viewport height and no ancestor scrolls, so the layout must own it. generate-tree.mjs keeps cap-5
   leaves fixed-viewport on the reasoning that "any scroll-stack it hosts is its OWN iframe leaf" —
   but the studio documents "there is NO iframe mode": every tab mounts its REAL custom element
   directly into this pane. So the scroll has to land here.
   WHY THIS IS SAFE FOR THE FIXED-VIEWPORT MAP TABS, which are the majority. A map element ships
   position:absolute; inset:0 (or height:100%) and therefore fills this box exactly:
   scrollHeight === clientHeight, so auto yields NO scrollbar and NOTHING changes for them. Only a
   pane whose content genuinely exceeds one viewport — i.e. a StackLayout scroll-stack, which is the
   composite that is meant to scroll — gets one. auto is load-bearing; scroll would paint a dead
   scrollbar on all 19 map tabs.
   overscroll-behavior:contain stops a wheel that bottoms out here from chaining to the document. */
.vtl-host { position:absolute; inset:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; --profile-min-h:0; }
/* The slot is the element's mount point. It must NOT be position:absolute; inset:0 any more: that
   pinned it to the pane's height and re-created the exact trap one level down — an absolutely
   positioned child cannot grow a scroll container. min-height:100% keeps a fixed-viewport map
   filling the pane (the behaviour absolute-inset gave it) while letting a taller scroll-stack
   composite push the pane's scrollHeight past its clientHeight, which is what produces the
   scrollbar. */
.vtl-host-slot { position:relative; min-height:100%; }
/* ★ THE dvh FLOOR, NEUTRALISED FOR HOSTED ELEMENTS (measured 2026-09-22 in the studio, same layout
   shape). A hosted map ships .profile-loader { height:100%; min-height:100dvh }, and the two resolve
   against DIFFERENT bases: height:100% against this pane, min-height:100dvh against the VIEWPORT.
   Wherever the pane is shorter than the viewport (any header/toolbar chrome above it), the floor
   wins, the element overflows by exactly that chrome height, and the overflow-y:auto above then
   correctly paints a scrollbar on a fixed-viewport map that should never have one.
   The floor is DELIBERATE and must stay in the element (standalone it prevents a collapse to 0
   against an auto-height body). It is only wrong HERE, against a definite shorter pane. A genuine
   scroll-stack composite is unaffected: it exceeds the pane on its own content, not on this floor. */
.vtl-host-slot > * { min-height:0; max-height:none; }
.vtl-host-hint { position:absolute; inset:0; display:grid; place-items:center; text-align:center; color:var(--dx-muted, #6d766e); font-size:13px; padding:20px; }
.vtl-host-hint.err { color:#f87171; }
.vtl-host-reload { margin-block-start:10px; font:inherit; padding:4px 12px; border-radius:6px; cursor:pointer; background:var(--vtl-accent, #3b463d); color:#fff; border:none; }
.vtl-host-hint small { color:var(--dx-muted, #6d766e); }
/* MATERIAL MINI-VARIANT RAIL = 72px (2026-09-21), up from 60px.
   ★ THE COLLAPSE IS A TRANSLATE, NOT A WIDTH CHANGE — so FOUR numbers are coupled and must move
   together, which is precisely where a partial edit would break the layout:
     nav translate  -184px   the 256px rail slides left, leaving 256-184 = 72px visible
     main left       72px    the content pane starts exactly where the rail ends
     collapse pad   184px    pushes the toggle's icon into the 72px strip that stays on screen
                             (the #rail-end slot takes the same pad, so its menu sits in the strip too)
     tab pad        188px    the same for each row's icon (4px more, matching the old 196/200 pair)
   Change one without the others and the icons drift out of the visible strip or the content
   overlaps the rail. Old values were -196 / 60 / 196 / 200.
   THIS BLOCK EXISTS TWICE (VTL_SHADOW_CSS and the scoped style block); keep them byte-identical. */
.vtl.rail-collapsed .vtl-nav { transform:translateX(-184px); }
.vtl.rail-collapsed .vtl-main { left:72px; }
.vtl.rail-collapsed .vtl-collapse, .vtl.rail-collapsed .vtl-home { padding-left:184px; justify-content:flex-start; }
.vtl.rail-collapsed .vtl-collapse-ic { transform:rotate(0deg); }
.vtl.rail-collapsed .vtl-rail-end { padding-left:184px; }
.vtl.rail-collapsed .vtl-collapse-tx, .vtl.rail-collapsed .vtl-home-tx { display:none; }
.vtl.rail-collapsed .vtl-tab { padding-left:188px; gap:0; }
.vtl.rail-collapsed .vtl-tab-text { display:none; }
.vtl.rail-collapsed .vtl-tab-emoji { font-size:19px; }
.vtl.rail-collapsed .vtl-tab-fallback { display:inline-flex; }
.vtl.rail-collapsed .vtl-tier { padding-left:196px; }
.vtl.rail-collapsed .vtl-tl, .vtl.rail-collapsed .vtl-td, .vtl.rail-collapsed .vtl-cap, .vtl.rail-collapsed .vtl-chev { display:none; }
.vtl.rail-collapsed .vtl-grp + .vtl-grp { margin-top:6px; padding-top:6px; }
@media (max-width: 760px) {
  /* Material app bar is 56px on mobile, 64px on desktop — the desktop value is set above. */
  .vtl-top { min-height:56px; }
  .vtl-menu { display:inline-block; }
  .vtl-meta { display:none; }
  /* MOBILE = the SAME composited-transform model, taken to its full-off-canvas extreme: a full-width
     drawer that slides in/out via transform (never a layout property), so opening/closing the drawer
     never reflows the content. Content is full-width (left:0) and stays put; the drawer floats over it. */
  /* NO SHADOW WHILE CLOSED: parked at translateX(-100%), a 28px blur still bleeds into the screen along the start
     edge (measured at 390: the left 30px ~22 luminance levels darker). The shadow belongs to the OPEN drawer only. */
  .vtl-nav { z-index:20; width:256px; box-shadow:none; transform:translateX(-100%); }
  /* OPEN DRAWER ABOVE THE PLUGIN'S OWN LAYERS. Mounted content shares this stacking context, and
     plugins raise their chrome (the research dashboard's filter bar is z-index:55), so at z-index 20
     the open drawer had a plugin's filter row painted across it — measured 2026-09-25 at 390px.
     Only while OPEN on a phone: that is when the drawer is the one thing you can use, and desktop
     and plugin modal scrims keep their existing order.
     100000, not 1000: the phone legend sheet (LegendMobile) is z-index:1000, and a tie left DOM order to decide,
     so the legend drew over the open drawer. Every plugin layer sits below 100000; a MODAL's scrim (MapInfo,
     2147483000) still covers the drawer, as a modal should. */
  .vtl.nav-open .vtl-nav { transform:translateX(0); z-index:100000; box-shadow:0 0 28px rgba(0,0,0,.55); }
  .vtl-main { left:0; }
  /* The desktop slim-rail collapse has no meaning on a phone — reconcileForWidth() clears railCollapsed
     at this width, but neutralize its CSS too (belt-and-suspenders) so a full labelled drawer always
     shows: no partial slide, no icon-column padding, labels/sections visible. */
  .vtl.rail-collapsed .vtl-nav { transform:translateX(-100%); }
  .vtl.rail-collapsed.nav-open .vtl-nav { transform:translateX(0); }
  .vtl.rail-collapsed .vtl-main { left:0; }
  .vtl.rail-collapsed .vtl-collapse, .vtl.rail-collapsed .vtl-home { padding-left:10px; justify-content:flex-start; }
  .vtl.rail-collapsed .vtl-collapse-ic { transform:rotate(180deg); }
  .vtl.rail-collapsed .vtl-collapse-tx, .vtl.rail-collapsed .vtl-home-tx { display:inline; }
  .vtl.rail-collapsed .vtl-tab { padding-left:10px; gap:11px; }
  .vtl.rail-collapsed .vtl-tab-text { display:flex; }
  .vtl.rail-collapsed .vtl-tab-fallback { display:none; }
  .vtl.rail-collapsed .vtl-tier { padding-left:8px; }
  .vtl.rail-collapsed .vtl-tl, .vtl.rail-collapsed .vtl-td, .vtl.rail-collapsed .vtl-cap, .vtl.rail-collapsed .vtl-chev { display:inline; }
}

/* ★ RIGHT-TO-LEFT (ar). THIS BLOCK EXISTS TWICE (VTL_SHADOW_CSS and the scoped style block); keep them
   byte-identical. Everything above is written in PHYSICAL terms (left:0 rail, left:256px content,
   translateX(-…) slides), so an Arabic shell kept the rail on the left with LTR geometry (reported by
   studio for cell E, 2026-09-25). These are ADDITIVE overrides scoped by :dir(rtl), so an LTR consumer
   matches none of them and renders exactly as before. :dir() follows the dir attribute through the
   shadow boundary, so either a consumer setting dir="rtl" on the layout or an RTL host page flips it.
   translateX has no logical form, which is why this is a mirror block rather than logical properties. */
.vtl:dir(rtl) .vtl-nav { left:auto; right:0; border-right:0; border-left:1px solid var(--vtl-border); }
.vtl:dir(rtl) .vtl-main { left:0; right:256px; }
.vtl:dir(rtl) .vtl-tab, .vtl:dir(rtl) .vtl-tier-btn { text-align:right; }
.vtl:dir(rtl) .vtl-meta, .vtl:dir(rtl) .vtl-td, .vtl:dir(rtl) .vtl-chev { margin-left:0; margin-right:auto; }
.vtl:dir(rtl) .vtl-chev:not(.open) { transform:scaleX(-1); }
.vtl:dir(rtl) .vtl-collapse-ic svg { transform:scaleX(-1); }
.vtl.rail-collapsed:dir(rtl) .vtl-nav { transform:translateX(184px); }
.vtl.rail-collapsed:dir(rtl) .vtl-main { left:0; right:72px; }
.vtl.rail-collapsed:dir(rtl) .vtl-collapse, .vtl.rail-collapsed:dir(rtl) .vtl-home { padding-left:10px; padding-right:184px; }
.vtl.rail-collapsed:dir(rtl) .vtl-tab { padding-left:12px; padding-right:188px; }
.vtl.rail-collapsed:dir(rtl) .vtl-tier { padding-left:8px; padding-right:196px; }
.vtl.rail-collapsed:dir(rtl) .vtl-rail-end { padding-left:0; padding-right:184px; }
@media (max-width: 760px) {
  .vtl:dir(rtl) .vtl-nav { transform:translateX(100%); }
  .vtl.nav-open:dir(rtl) .vtl-nav { transform:translateX(0); }
  .vtl:dir(rtl) .vtl-main, .vtl.rail-collapsed:dir(rtl) .vtl-main { left:0; right:0; }
  .vtl.rail-collapsed:dir(rtl) .vtl-nav { transform:translateX(100%); }
  .vtl.rail-collapsed.nav-open:dir(rtl) .vtl-nav { transform:translateX(0); }
  .vtl.rail-collapsed:dir(rtl) .vtl-collapse, .vtl.rail-collapsed:dir(rtl) .vtl-home { padding-left:10px; padding-right:10px; }
  .vtl.rail-collapsed:dir(rtl) .vtl-tab { padding-left:12px; padding-right:10px; }
  .vtl.rail-collapsed:dir(rtl) .vtl-tier { padding-left:8px; padding-right:8px; }
}
/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree). Additive only. */
@media (prefers-reduced-motion: reduce) {
  .vtl-nav, .vtl-collapse-ic, .vtl-tab, .vtl-tier, .vtl-pbar, .vtl-phone-menu, .vtl-rail-end, .vtl-scrim { transition: none !important; animation: none !important; }
}
</style>
