<!--
  ShareButton.vue — Non-technical share modal for the map toolbar.

  Redesigned to match consumer-grade UX from YouTube, Spotify, Canva, and
  Google Maps. Two tabs, share FIRST (shareable pages P3):

    1. "Share this page" — the link to exactly what the reader is looking at (the page's own
       address, with its tab, where the page owns its address) + one-click copy. It is what a
       person who presses Share expects: something to send to someone.
    2. "Embed" — for putting the map on ANOTHER website: what embedding is and why it helps, the
       multiplication steps, then the code with size presets.

  The word "iframe" never appears in any user-visible text. The embed tab
  leads with a plain-English description, then shows the code below.

  Props:
    isDark    — theme flag forwarded from parent
    embedPath — this map's standalone embed page, TREE-RELATIVE
                (`<bundle>/<profile>/index.html`); resolved by utils/embedBase.js

  Popover closes on:
    - Click outside (shadow-DOM-aware via composedPath)
    - Escape key
    - Re-click the share button
-->
<script setup>
import { ref, computed, inject, unref, provide } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it. The English stays as the fallback.
const T = (key, en) => tStatic(key) || en
import { useI18n } from 'vue-i18n'
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { resolveShareUrl, resolvePublicBase, resolveEmbedBase } from '../../utils/embedBase.js'
import { publicLeafUrl, publicScriptCode } from '../../utils/publicEmbed.js'
import { urlOwnerOf } from '../../composables/useViewAddress.js'
import MapControlButton from './MapControlButton.vue'
import MapControlMenu from './MapControlMenu.vue'

/* ------------------------------------------------------------------ */
/* Shadow-DOM styles                                                   */
/* ------------------------------------------------------------------ */
useShadowStyles(`
/* ---- share button: a thin, slowly turning rainbow ring behind the round button ---- */
.share-wrap{position:relative;display:inline-block;border-radius:50%;}
.share-wrap::before{content:'';position:absolute;inset:-2px;border-radius:50%;padding:2px;pointer-events:none;
  background:conic-gradient(#ff6b6b,#ffd166,#6bd67b,#4dabf7,#9775fa,#f783ac,#ff6b6b);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;
  opacity:0.6;animation:share-ring-turn 5s linear infinite;}
.share-wrap:hover::before{opacity:0.95;}
/* ROUNDED-SQUARE header form (design rule, 2026-09-30): the wrap and its rotating ring take the vertical
   tabs' radius, so a circular ring can never wrap a square button. --vtl-radius is the one shared var. */
.share-wrap--rounded-square,.share-wrap--rounded-square::before{border-radius:var(--vtl-radius,8px);}
/* The ring itself rotates, so the colours travel around the button in every browser. */
@keyframes share-ring-turn{to{transform:rotate(360deg);}}
@media(prefers-reduced-motion:reduce){.share-wrap::before{animation:none;}}
.share-steps{margin:0 0 12px;padding:0 0 0 15px;list-style:'- ';font:14px/1.55 system-ui,sans-serif;color:#c9d1d9;}
.share-steps li{margin:0 0 3px;padding-inline-start:3px;}
.share-steps li:last-child{font-weight:600;color:#92b195;}
.share-pop.light .share-steps{color:#3b463d;}
.share-pop.light .share-steps li:last-child{color:#3b463d;}
/* ---- popover shell ---- */
/* ---- popover shell (imitates SemanticTreeLegend .stl-inner) ---- */
.share-pop{
  font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:13px;
  color:#e6edf3;
}
.share-pop.light{color:#1f2328;}

/* ---- tabs ---- */
.share-tabs{
  display:flex;
  gap:0;
  padding:0 16px;
  margin-top:8px;
  border-bottom:1px solid rgba(255,255,255,0.08);
}
.share-pop.light .share-tabs{border-bottom:1px solid rgba(0,0,0,0.08);}
.share-tab{
  padding:6px 0;
  margin-inline-end:20px;
  font-size:12.5px;
  font-weight:600;
  background:none;border:none;
  color:inherit;opacity:0.5;
  cursor:pointer;
  border-bottom:2px solid transparent;
  transition:opacity 0.15s,border-color 0.2s;
  font-family:inherit;
  white-space:nowrap;
}
.share-tab:hover{opacity:0.75;}
.share-tab.active{
  opacity:1;
  border-bottom-color:#4a90d9;
}
.share-pop.light .share-tab.active{
  border-bottom-color:#1a73e8;
}

/* ---- tab body ---- */
.share-body{
  padding:12px 16px 14px 16px;
}

/* ---- Share Link tab ---- */
.share-url-box{
  display:flex;
  align-items:center;
  gap:0;
  background:rgba(0,0,0,0.22);
  border:1px solid rgba(255,255,255,0.08);
  border-radius:10px;
  overflow:hidden;
}
.share-pop.light .share-url-box{
  background:rgba(0,0,0,0.035);
  border:1px solid rgba(0,0,0,0.10);
}
.share-url-text{
  flex:1;
  padding:11px 14px;
  font-size:13px;
  color:#b0b8c8;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  -webkit-user-select:all;
  user-select:all;
}
.share-pop.light .share-url-text{color:#555;}

/* ---- primary CTA button ---- */
.share-primary-btn{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  width:100%;
  padding:12px 0;
  margin-top:14px;
  background:#4a90d9;
  border:none;
  border-radius:10px;
  color:#fff;
  font-size:14.5px;
  font-weight:600;
  cursor:pointer;
  transition:background 0.15s,transform 0.1s;
  font-family:inherit;
}
.share-primary-btn:hover{background:#3d7ec5;}
.share-primary-btn:active{transform:scale(0.98);}
.share-primary-btn.copied{
  background:#2ea44f;
}
.share-pop.light .share-primary-btn{
  background:#1a73e8;
}
.share-pop.light .share-primary-btn:hover{
  background:#1565c0;
}
.share-pop.light .share-primary-btn.copied{
  background:#2ea44f;
}

/* ---- social row ---- */
.share-social-row{
  display:flex;
  align-items:center;
  gap:10px;
  margin-top:16px;
  padding-top:14px;
  border-top:1px solid rgba(255,255,255,0.06);
}
.share-pop.light .share-social-row{
  border-top:1px solid rgba(0,0,0,0.06);
}
.share-social-label{
  font-size:12px;
  opacity:0.45;
  font-weight:500;
  margin-inline-end:auto;
  white-space:nowrap;
}
.share-social-btn{
  width:36px;height:36px;
  border-radius:50%;
  border:1px solid rgba(255,255,255,0.10);
  background:rgba(255,255,255,0.06);
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;
  color:inherit;
  transition:background 0.15s,border-color 0.15s;
}
.share-social-btn:hover{
  background:rgba(255,255,255,0.12);
  border-color:rgba(255,255,255,0.18);
}
.share-pop.light .share-social-btn{
  border:1px solid rgba(0,0,0,0.10);
  background:rgba(0,0,0,0.03);
}
.share-pop.light .share-social-btn:hover{
  background:rgba(0,0,0,0.07);
  border-color:rgba(0,0,0,0.16);
}

/* ---- Embed tab ---- */
.share-embed-desc{
  font-size:13.5px;
  line-height:1.55;
  opacity:0.72;
  margin-bottom:16px;
}

.share-size-pills{
  display:flex;
  gap:8px;
  margin-bottom:14px;
}
.share-size-pill{
  padding:6px 14px;
  border-radius:20px;
  border:1px solid rgba(255,255,255,0.12);
  background:transparent;
  color:inherit;
  font-size:12.5px;
  font-weight:500;
  cursor:pointer;
  transition:background 0.15s,border-color 0.15s;
  font-family:inherit;
}
.share-size-pill:hover{
  background:rgba(255,255,255,0.06);
}
.share-size-pill.active{
  background:rgba(74,144,217,0.18);
  border-color:rgba(74,144,217,0.45);
  color:#7ab8f5;
}
.share-pop.light .share-size-pill{
  border:1px solid rgba(0,0,0,0.12);
}
.share-pop.light .share-size-pill:hover{
  background:rgba(0,0,0,0.04);
}
.share-pop.light .share-size-pill.active{
  background:rgba(26,115,232,0.10);
  border-color:rgba(26,115,232,0.40);
  color:#1a73e8;
}

.share-code-box{
  background:rgba(0,0,0,0.28);
  border:1px solid rgba(255,255,255,0.06);
  border-radius:10px;
  padding:12px 14px;
  font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;
  font-size:11.5px;
  line-height:1.5;
  color:#a0aab8;
  word-break:break-all;
  white-space:pre-wrap;
  /* ★ NO SCROLLBAR — THE MENU SHOWS THE WHOLE SNIPPET (2026-09-23: the share menu opens fully
     expanded, with no scroll bar).
     Was max-height:90px + overflow-y:auto, which clipped a ~4-line embed snippet to about two and
     a half lines and put a scrollbar inside a popover. That is the wrong trade for THIS content:
     the box exists to be READ and COPIED in one glance, and user-select:all below means the whole
     snippet is selected by a single click -- a scrollport actively fights that gesture, because
     the selection extends into content the reader never saw.
     height:auto lets the snippet size itself; the popover is short-lived and anchored, so the few
     extra lines cost nothing. If a future snippet ever grows genuinely long, cap the POPOVER and
     let it scroll as one surface -- do not reintroduce a scrollport around the code box alone. */
  height:auto;
  -webkit-user-select:all;
  user-select:all;
}
.share-pop.light .share-code-box{
  background:rgba(0,0,0,0.035);
  border:1px solid rgba(0,0,0,0.08);
  color:#444;
}

/* ---- copy code button (secondary style) ---- */
.share-secondary-btn{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  width:100%;
  padding:11px 0;
  margin-top:12px;
  background:rgba(255,255,255,0.08);
  border:1px solid rgba(255,255,255,0.12);
  border-radius:10px;
  color:#e0e4ec;
  font-size:14px;
  font-weight:600;
  cursor:pointer;
  transition:background 0.15s,border-color 0.15s,transform 0.1s;
  font-family:inherit;
}
.share-secondary-btn:hover{
  background:rgba(255,255,255,0.13);
  border-color:rgba(255,255,255,0.18);
}
.share-secondary-btn:active{transform:scale(0.98);}
.share-secondary-btn.copied{
  background:rgba(46,164,79,0.16);
  border-color:rgba(46,164,79,0.35);
  color:#5cd680;
}
.share-pop.light .share-secondary-btn{
  background:rgba(0,0,0,0.04);
  border:1px solid rgba(0,0,0,0.12);
  color:#333;
}
.share-pop.light .share-secondary-btn:hover{
  background:rgba(0,0,0,0.07);
}
.share-pop.light .share-secondary-btn.copied{
  background:rgba(46,164,79,0.10);
  border-color:rgba(46,164,79,0.30);
  color:#2ea44f;
}

/* ---- responsive: align with MapToolbar's layout convention ----
   The research-map profile uses @media(max-width:767px) and positions the
   search bar at top:10, left:10, right:10. The geocoder pill renders ~60px
   tall on mobile, so its bottom edge is ~70px. MapToolbar sits at top:80
   (10px gap below search). We mirror MapToolbar exactly so the popover's
   top edge aligns with the top of the '+' button.
   right:52 = MapToolbar right(10) + button-width(36) + 6px breathing room. */
`, 'share-button')

const { t, tm, rt } = useI18n()

const props = defineProps({
  isDark: { type: Boolean, default: false },
  embedPath: { type: String, default: '' },
  // 'round' (default) is the map-control form. 'rounded-square' is the dashboard HEADER form: the
  // trigger button AND its rainbow ring take --vtl-radius (the vertical tabs' radius) instead of 50%,
  // so a header Share button matches the header ⓘ and the tabs. Every existing consumer keeps 'round'.
  shape: { type: String, default: 'round' }
})

/* ---- state ---- */
const rootEl = ref(null)
const isOpen = ref(false)
const popoverEl = ref(null)
const btnEl = ref(null)
const activeTab = ref('page')          // 'page' | 'embed'
const pageUrl = ref('')                // "Share this page": read when the menu opens (see pageLink)
const linkCopied = ref(false)
const embedCopied = ref(false)
const embedSize = ref('medium')        // 'small' | 'medium' | 'large'
const embedKind = ref('url')           // 'url' | 'iframe' | 'script': the Embed tab's three codes
const scriptState = ref({ loading: false })   // the JavaScript code from the public manifest: { code } | { missing } | { failed }

const sizePresets = {
  small:  { label: 'Small',  height: 400 },
  medium: { label: 'Medium', height: 600 },
  large:  { label: 'Large',  height: 800 }
}

// The size names, each key written out so the catalogue gate sees it.
const sizeLabel = (k) => ({ small: T('share.size_small', 'Small'), medium: T('share.size_medium', 'Medium'), large: T('share.size_large', 'Large') })[k] || k

/* ---- computed ---- */
/* The standalone embed page this map is shared/iframed as — resolved by
   utils/embedBase.js (its header documents the full ladder). In short:
   (1) profileConfig.shareUrl — a WHOLE url the HOST supplies wins (the dev
       plugin gallery passes its own #/<bundle>/<profile>[/<instance>] deep link);
   (2) the `embedPath` prop — the PROFILE owns an ID→URL table and passes the
       active instance's page (parameterized profiles keyed by active tab id) —
       or the app-profile config (provided by ProfileLoader as 'profileConfig')
       via profile-config.shareEmbedPath. Paths are TREE-RELATIVE
       (`<bundle>/<profile>/index.html`) and join the embed base:
       profileConfig.embedBaseUrl → window.MAP_EMBED_BASE_URL → the root the
       built bundle derives from its OWN script url — so a dropped tree shares
       working links on the plugin gallery, doxa.life or any CDN with no config.
       Absolute urls pass through; a leading '/' is legacy root-relative;
   (3) the page's own location — each map builds to a self-contained page
       ("Share shares THE MAP"), so with nothing configured the current page IS
       the correct embed url. */
const profileConfig = inject('profileConfig', null)
const shareUrl = computed(() => resolveShareUrl({
  embedPath: props.embedPath,
  profileConfig: unref(profileConfig) || null,
}))

/* ★ EMBED THIS PLUGIN, FROM THE PUBLIC SITE (shareable pages P3b). The Embed tab's three codes are for the plugin
   whose Share was pressed (its own page; its own bundle + element), even nested in Plugin Studio, Deep Research or
   Posterverse, and they point at the tree's PUBLIC address (resolvePublicBase: the build's shareBaseUrl), never a dev
   server or the page's own host. With no public address configured, the tree this bundle loaded from stands in. */
const embedBase = computed(() => resolvePublicBase(unref(profileConfig) || null) || resolveEmbedBase(unref(profileConfig) || null))
const embedPathOf = () => props.embedPath || (unref(profileConfig) || {}).shareEmbedPath || ''
// URL: the plugin's own generated page, and nothing else: never the app page it is shown in. With no base (the dev
// server, where modules are not bundled) or no tree-relative path, it is '' and the tab shows the plain note.
const leafUrl = computed(() => publicLeafUrl(embedBase.value, embedPathOf()))
const embedSnippet = computed(() => {
  const h = sizePresets[embedSize.value].height
  return '<iframe src="' + leafUrl.value + '" width="100%" height="' + h + '" style="border:none; border-radius:12px;" allowfullscreen></iframe>'
})
// JavaScript: the plugin's embed.script from the public manifest, read once the Embed tab opens. "missing" means the
// public site does not carry this plugin yet, so the tab shows a plain note instead of codes that would 404.
function loadScriptCode() {
  if (scriptState.value.code || scriptState.value.loading) return
  scriptState.value = { loading: true }
  publicScriptCode(embedBase.value, embedPathOf()).then((r) => { scriptState.value = r })
}
const embedText = computed(() => embedKind.value === 'url' ? leafUrl.value
  : embedKind.value === 'iframe' ? embedSnippet.value : (scriptState.value.code || ''))
const EMBED_KINDS = ['url', 'iframe', 'script']
const kindLabel = (k) => ({ url: T('share.kind_url', 'URL'), iframe: T('share.kind_iframe', 'Iframe'), script: T('share.kind_script', 'JavaScript') })[k]
// One plain sentence per code, for a reader who has never embedded anything.
const kindHint = (k) => ({
  url: T('share.url_hint', 'A link to open the map on its own page.'),
  iframe: T('share.iframe_hint', 'Put the map in your page, in a frame.'),
  script: T('share.script_hint', 'Load the map straight into your page, with no frame.'),
})[k]

/* ★ SHARE THIS PAGE. Where the page OWNS its address (useViewAddress: urlOwner 'app' on our own pages,
   'host' on DX Life), the address bar already names the exact view (the tab, and the filters), so the
   link is the page's own URL, read when the menu opens and again at copy time, since the reader can
   switch tabs in between. The owner is this map's own profile-config, or the nearest element above it,
   across shadow roots, whose profile-config names one: a map nested in the gallery is told nothing, and
   the gallery is the page. On a partner's page (no owner) the address is the partner's, so the link is
   this map's own page, as before. */
const cfgOf = (c) => { if (typeof c !== 'string') return c || null; try { return JSON.parse(c) } catch { return null } }
function pageOwner() {
  if (urlOwnerOf(cfgOf(unref(profileConfig)))) return true
  for (let n = rootEl.value; n; ) {
    n = n.parentNode || n.host
    if (n && n.nodeType === 1 && urlOwnerOf(cfgOf(n.profileConfig ?? n.getAttribute('profile-config')))) return true
  }
  return false
}
// A leaf page reads a token from ?tk= and leaves it in its address, so the page link drops it: a reader must
// never send a credential by pressing Share. The URL is rewritten only when tk is there, so every other link is
// the address exactly as it stands.
function pageLink() {
  try {
    if (pageOwner() && window.location.href) {
      const u = new URL(window.location.href)
      if (u.searchParams.has('tk')) { u.searchParams.delete('tk'); return u.href }
      return window.location.href
    }
  } catch { /* no window */ }
  return shareUrl.value
}

/* ---- actions ---- */
function toggle() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    activeTab.value = 'page'
    pageUrl.value = pageLink()
    linkCopied.value = false
    embedCopied.value = false
    embedKind.value = 'url'
  }
}

function close() {
  isOpen.value = false
}

/* Copy that works EVERYWHERE (maintainer bug 2026-07-11: on file:// the button did nothing —
   navigator.clipboard exists only in secure contexts (https/localhost). Fallback: the
   classic hidden-textarea + execCommand path, which insecure contexts still support. */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

async function copyLink() {
  pageUrl.value = pageLink()
  if (await copyText(pageUrl.value)) {
    linkCopied.value = true
    setTimeout(() => { linkCopied.value = false }, 2000)
  }
}

async function copyEmbed() {
  if (embedText.value && await copyText(embedText.value)) {
    embedCopied.value = true
    setTimeout(() => { embedCopied.value = false }, 2000)
  }
}

/* ------------------------------------------------------------------ */
/* Anchoring OFF a map — the "menu opens off the right edge" fix        */
/* ------------------------------------------------------------------ */
/*
  ★ REPORTED TWICE (2026-09-22): on the research dashboard the share menu opened down and to the
  RIGHT of the share button, and the share button sits at the very top right of the page, so
  down-to-the-right is OFF the page.

  THE ROOT CAUSE IS AN ABSENT ANCHOR, NOT A WRONG ALIGNMENT CHOICE — measured, and it is a
  DIFFERENT bug from the FilterDropdown one it superficially resembles. That one was a
  position:fixed popover whose viewport frame was stolen by `contain:layout paint` on an ancestor.
  This menu is not fixed at all. MapControlMenu.place() reads an INJECTED `mapToolbar`:

      const tb = toolbar?.el?.value, area = host.value
      if (!tb || !area) { style.value = {}; return }          // <-- this branch

  `provide('mapToolbar')` comes from MapToolbar.vue, and in the research dashboard MapToolbar is
  rendered by DashboardMapPanel — a SIBLING of the top bar, not an ancestor of it. inject() walks
  the COMPONENT TREE, so a ShareButton mounted in the top bar resolves the fallback `null`, place()
  returns an EMPTY style, and `.mcm{position:absolute}` with no top/right falls back to its STATIC
  position: immediately below-and-right of a button already at the far top-right. Off the page,
  exactly as reported. Nothing was ever choosing "right" — nothing was choosing anything.

  SO THE FIX IS TO GIVE IT AN ANCHOR, not to add a second placement scheme. When no toolbar is
  provided, this button provides one pointing at its OWN wrapper, and marks that wrapper as the
  containing area. MapControlMenu's existing measured logic then does the whole job unchanged:
  it compares the anchor's centre to the area's centre, opens on the INNER side, and clamps the
  width to what fits. A share button at the top right is right-of-centre, so the menu opens to the
  LEFT — which is what was asked for, arrived at by measurement rather than by hardcoding a
  side that would then be wrong for a left-hand placement.

  WHY `inject` FIRST AND `provide` ONLY AS A FALLBACK: on a real map this component must keep
  behaving byte-identically — the toolbar is the correct anchor there, and the menu should still
  align to the control COLUMN, not to one button in it. This only engages where the injection
  genuinely resolves to nothing, so no map profile changes.
*/
const providedToolbar = inject('mapToolbar', null)
const selfAnchor = ref(null)
// Re-provide UNCONDITIONALLY so the value is stable for the child's inject(); `el` stays null when
// a real toolbar was found, and MapControlMenu keeps using that toolbar instead. `standalone` tells
// MapControlMenu this anchor is ONE button outside any map (a page header), placed beside the button
// inside the viewport, at open time (MapControlMenu.placeBeside).
provide('mapToolbar', providedToolbar || { el: selfAnchor, standalone: true })
const hasOwnAnchor = !providedToolbar

/*
  ★ THE ANCHOR IS THE BUTTON, AND NOTHING IS DECIDED AT RENDER TIME (shareable pages P3). This used to tag
  `el.offsetParent || el.parentElement` as the menu's area DURING RENDER (a function ref, so it ran before
  MapControlMenu latched its area). Before layout offsetParent is null, so the tag fell on the button's
  immediate parent: in a header with a narrow, unpositioned wrapper (measured on the UPG-100 list page: .hdr-btns) the menu
  measured against that wrapper, clamped to its 200px floor, and was positioned against the header above
  it: far to the left, and narrow (reported 2026-10-03). Now the button only names itself;
  MapControlMenu resolves where the menu lives and where it goes when it OPENS, with layout known.
*/
function bindAnchor(el) {
  rootEl.value = el || null
  selfAnchor.value = hasOwnAnchor && el ? el : null
}

/* Placement, stacking, outside-click and Escape live in MapControlMenu (shared by every
   control menu); this button only toggles `isOpen`. */
</script>

<template>
  <!-- :ref is a FUNCTION, deliberately: the anchor must be set before MapControlMenu's mounted hook
       reads it (a child mounts before its parent). See bindAnchor() in <script>. -->
  <div :ref="bindAnchor" class="share-wrap" :class="{ 'share-wrap--rounded-square': shape === 'rounded-square' }" data-share-root>
    <MapControlButton
      ref="btnEl"
      data-control="share"
      :is-dark="isDark"
      :active="isOpen"
      :shape="shape"
      :title="t('buttons.share')"
      @click="toggle"
    >
      <!-- Share icon: box with upward arrow (iOS / Material standard) -->
      <svg xmlns="http://www.w3.org/2000/svg"
           width="18" height="18" viewBox="0 0 24 24"
           fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>
        <polyline points="16 6 12 2 8 6"/>
        <line x1="12" y1="2" x2="12" y2="15"/>
      </svg>
    </MapControlButton>

    <!-- =================== Menu (shared MapControlMenu owns placement + chrome) =================== -->
    <MapControlMenu :open="isOpen" :title="t('buttons.share')" :is-dark="isDark" @close="close">
    <div ref="popoverEl" class="share-pop" :class="{ light: !isDark }">
      <!-- Tabs: sharing the PAGE first (what a person pressing Share expects), Embed second -->
      <div class="share-tabs" role="tablist">
        <button
          class="share-tab" role="tab" data-share-tab="page"
          :class="{ active: activeTab === 'page' }" :aria-selected="String(activeTab === 'page')"
          @click="activeTab = 'page'"
        >{{ T('share.tab_page', 'Share this page') }}</button>
        <button
          class="share-tab" role="tab" data-share-tab="embed"
          :class="{ active: activeTab === 'embed' }" :aria-selected="String(activeTab === 'embed')"
          @click="activeTab = 'embed'; loadScriptCode()"
        >{{ T('share.tab_embed', 'Embed') }}</button>
      </div>

      <!-- ===== Tab 1: Share this page ===== -->
      <div v-if="activeTab === 'page'" class="share-body">
        <div class="share-embed-desc">{{ T('share.page_hint', 'A link that opens this exact page for whoever you send it to.') }}</div>
        <!-- URL display -->
        <div class="share-url-box">
          <div class="share-url-text" data-share-url>{{ pageUrl }}</div>
        </div>

        <!-- Copy Link primary CTA -->
        <button
          class="share-primary-btn"
          :class="{ copied: linkCopied }"
          @click="copyLink"
        >
          <!-- Copy / Check icon -->
          <svg v-if="!linkCopied" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {{ linkCopied ? T('share.copied', 'Copied!') : T('share.copy_link', 'Copy link') }}
        </button>
      </div>

      <!-- ===== Tab 2: Embed (for another website): THIS plugin, from the public site ===== -->
      <div v-if="activeTab === 'embed'" class="share-body">
        <!-- What embedding is and why it helps, in plain words, before any code -->
        <div class="share-embed-desc">
          {{ T('share.embed_what', 'Embedding puts this live map inside your own website, so your visitors can explore it and pray without leaving your site. It stays up to date by itself.') }}
        </div>
        <!-- The multiplication path, one line each -->
        <ul class="share-steps">
          <li v-for="(step, i) in tm('buttons.shareSteps')" :key="i">{{ rt(step) }}</li>
        </ul>
        <!-- Not on the public site yet (or no page of its own to point at): one plain note instead of codes that would
             404 or that would embed the app around it -->
        <div v-if="scriptState.missing || !leafUrl" class="share-embed-desc" data-embed-note>
          {{ T('share.not_public', "This map isn't on the public site yet. Its embed codes will appear here once it's released.") }}
        </div>
        <template v-else>
          <!-- Three ways, one at a time: a link, a frame, or straight into the page -->
          <div class="share-size-pills" role="tablist">
            <button
              v-for="k in EMBED_KINDS" :key="k" type="button" role="tab"
              class="share-size-pill" :data-embed-kind="k"
              :class="{ active: embedKind === k }" :aria-selected="String(embedKind === k)"
              @click="embedKind = k"
            >{{ kindLabel(k) }}</button>
          </div>
          <div class="share-embed-desc">{{ kindHint(embedKind) }}</div>
          <!-- Iframe: its height -->
          <div v-if="embedKind === 'iframe'" class="share-size-pills">
            <button
              v-for="(preset, key) in sizePresets"
              :key="key"
              class="share-size-pill"
              :class="{ active: embedSize === key }"
              @click="embedSize = key"
            >{{ sizeLabel(key) }}</button>
          </div>
          <!-- JavaScript: read from the public site when this tab opens -->
          <div v-if="embedKind === 'script' && !scriptState.code" class="share-embed-desc">
            {{ scriptState.failed ? T('share.public_failed', "Couldn't reach the public site just now. Try again in a moment.") : T('share.script_loading', 'Reading the public site…') }}
          </div>
          <div v-else class="share-code-box" data-embed-code>{{ embedText }}</div>
          <!-- One Copy button -->
          <button
            v-if="embedText"
            class="share-secondary-btn"
            :class="{ copied: embedCopied }"
            @click="copyEmbed"
          >
            <svg v-if="!embedCopied" width="15" height="15" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <svg v-else width="15" height="15" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            {{ embedCopied ? T('share.copied', 'Copied!') : (embedKind === 'url' ? T('share.copy_link', 'Copy link') : T('share.copy_code', 'Copy code')) }}
          </button>
        </template>
      </div>
    </div>
    </MapControlMenu>
  </div>
</template>
