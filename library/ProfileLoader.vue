<script setup>
/**
 * ProfileLoader.vue — Application Profile Loader
 *
 * The ONLY component that reads the profile-config prop.
 * Parses it → resolves the profile name → dynamically loads the profile .vue file.
 * Everything else in the app is prop-free at the web component boundary.
 *
 * Usage:
 *   <doxa-map profile-config='{"profile":"example-map","tk":"MAPBOX_PUBLIC_TOKEN","instanceId":"my-map"}'></doxa-map>
 *
 * instanceId — optional. If omitted, a random ID is generated.
 * Used to isolate window events so multiple <doxa-map> embeds on the same page
 * never interfere with each other.
 */

import { computed, provide, inject, watchEffect, watch, ref, onMounted, onBeforeUnmount } from 'vue'
import { useSharedMapToken, publishMapToken, fetchMapToken } from './composables/useSharedMapToken.js'
import { retryableAsyncComponent } from './composables/retryableAsyncComponent.js'
import { SUPPORTED_LOCALES, RTL_LOCALES, setRuntimeLocale, localeFromUrl, loadLocale, localeChromeReady } from './i18n/index.js'
// QA corner: COMPILE-TIME gated (__DOXA_QA__, vite define). In public builds
// the flag is false → this whole branch (and the widget's code, including its
// platform references) is eliminated from the bundle. Platform builds
// (DOXA_QA=1) include it lazily.
const QaCorner = __DOXA_QA__
  ? retryableAsyncComponent(() => import('./components/qa/QaCorner.vue'))
  : null
import PinHint from './components/hints/PinHint.vue'
import LargerScreenNotice from './components/LargerScreenNotice.vue'
import { useScreenGate } from './composables/useScreenGate.js'
import { createHostFloor } from './elements/hostFloor.js'
import { useUIStore }   from './stores/uiStore.js'
import { useMapStore }  from './stores/mapStore.js'
import { useDataStore } from './stores/dataStore.js'
import sourcesConfig from './api/sources.json'

// ─── Props ───────────────────────────────────────────────────────────────────

const props = defineProps({
  /**
   * JSON string passed as an HTML attribute.
   * Shape: { profile, tk, instanceId?, dataSource?, tabs?, colorSet? }
   */
  profileConfig: {
    type: String,
    default: ''
  }
})

// ─── Parse profile-config ─────────────────────────────────────────────────────

// A HOST page's assetsBase, if this loader is running INSIDE another element (a cap-4
// composite pane). Undefined at the top level. See the inheritance note below.
const hostAssetsBase = inject('profileConfig', null)

const config = computed(() => {
  if (!props.profileConfig) return null
  let parsed
  try {
    parsed = JSON.parse(props.profileConfig)
  } catch (e) {
    console.error('[ProfileLoader] Invalid profile-config JSON:', props.profileConfig)
    return null
  }
  // ── assetsBase INHERITANCE (BUG-UPG100MFE-ASSET-PATH-DEPTH-404S, 2026-09-20) ──
  // `assetsBase` is a PAGE-scoped value: the generator computes it once per generated
  // index.html from that page's depth below the tree root, and every consumer
  // (PosterWall, DataTable, boundary fetches) reads it off profileConfig.
  //
  // A cap-4 nested-elements composite mounts its children as custom elements in the SAME
  // document, so a child has no leaf page of its own to be told the value by. If the host
  // forgets to forward it, the child falls back to its own './assets' default — which
  // resolves against the LEAF directory, one level too deep, and every asset 404s. That is
  // exactly how 27 preview images broke on upg-100-mfe while the same images loaded fine
  // from the sibling poster-wall leaf.
  //
  // Fixing only the one host would leave the trap armed for the next author, so the
  // inheritance is enforced HERE — the single choke point every element passes through.
  // An explicit assetsBase on the child still wins; this only fills an ABSENT one, and only
  // when there is a host to inherit from (at the top level there is nothing to inherit, so
  // the consumer's own './assets' default stands unchanged).
  if (parsed && parsed.assetsBase === undefined) {
    const inherited = hostAssetsBase?.value?.assetsBase
    if (typeof inherited === 'string' && inherited) parsed.assetsBase = inherited
  }
  return parsed
})

const profileModules = inject('profileModules', null)
if (!profileModules) {
  throw new Error('[ProfileLoader] No profileModules provided. Bundle entry must `app.provide("profileModules", import.meta.glob("./*.vue"))`')
}

// ★ A ONE-PROFILE BUNDLE ANSWERS A BARE TAG (DX Life drop-in, 2026-09-29). Every country page
// rendered `⚠️ Profile "" not found.` where its map should be: the host wrote <doxa-country-map>
// with no profile-config, profileName resolved to null, and the loader had nothing to load — while
// the element sat in the DOM at full size with 0 console errors and 0 failed requests, which is why
// it read as a blank map rather than a misconfiguration.
// For a bundle that registers exactly ONE profile there is no ambiguity to resolve: the only
// profile IS the answer, and requiring the host to name it makes a single-element bundle harder to
// embed than the paste-anywhere promise it exists for. 20 of the 25 bundles are single-profile (10 of the 17 that mount this loader).
// A bundle with SEVERAL profiles still requires the name — guessing there would silently mount the
// wrong surface, which is worse than the warning. So the fallback is conditional on the count, not
// on the name being absent.
const ONLY_PROFILE = (() => {
  const keys = Object.keys(profileModules || {})
  if (keys.length !== 1) return null
  const m = keys[0].match(/^\.\/(.+)\.vue$/)
  return m ? m[1] : null
})()

const profileName  = computed(() => config.value?.profile || ONLY_PROFILE || null)
// TOKEN: profile-config.tk FIRST, then the page global.
//
// WHY THE FALLBACK (root cause, measured 2026-09-21). A COMPOSITE leaf — a cap-4/cap-5 shell
// whose own root paints no tiles — is generated TOKEN_FREE, so its page calls mount('') and the
// `tk: token` assignment never runs. Intercepting setAttribute BEFORE Vue consumed it proved the
// prop is genuinely absent: profile-config arrives with keys profile/dataSource/instanceId/
// assetsBase and NO tk. This computed then produced '' and provided it to every child, so a map
// nested INSIDE the composite got an empty accessToken and logged
// "No Mapbox access token provided" — the error reported at dashboard-plus-grid.js:605.
//
// The generator's assumption was that a composite's nested maps each render in their OWN IFRAME
// LEAF running its own token ladder. That is false for dashboard-plus-grid: it has zero iframes
// and imports ResearchDashboard / PeopleGroupsGrid as COMPONENTS, so the nested map runs inside
// the shell page and depends on the token the shell withholds.
//
// STRICTLY ADDITIVE, which is why it is safe: 10 components inject 'mapboxToken', and today they
// all receive '' whenever tk is absent. After this they receive the real token instead. An empty
// string becoming a valid token cannot break a map that already worked. A per-instance tk STILL
// WINS, so an embed that threads its own token is unaffected.
//
// This does NOT make the generator's classifier correct — see
// BUG-COMPOSITE-LEAVES-ARE-TOKEN-FREE-BUT-NEST-REAL-MAPS for the deeper fix.
// ★ THE PAGE-LEVEL FALLBACK IS NOW REACTIVE, AND THAT IS THE WHOLE FIX.
// This ladder already read window.MAP_TOKEN — and it still could not rescue a nested map. MEASURED
// on the built tree: window.MAP_TOKEN IS set on the composite leaf while the nested child had NO
// search bar. window.MAP_TOKEN is a plain global, so inside a computed() it is not a reactive
// source: the generated composite leaf FETCHES its token, this computed evaluates to '' first,
// caches, and never re-runs because nothing reactive changed. sharedToken is a ref that updates
// when any element on the page publishes one, so a token that arrives LATE still reaches an element
// that mounted EARLY — which is the actual shape of the bug.
// Per-instance `tk` still wins, so an embed threading its own token is unaffected.
const sharedToken = useSharedMapToken()
const mapboxToken  = computed(() => {
  const fromConfig = config.value?.tk
  if (typeof fromConfig === 'string' && fromConfig) return fromConfig
  return sharedToken.value || ''
})

// SHARE WHAT THIS ELEMENT WAS GIVEN. An element handed a real `tk` publishes it page-wide, so a
// SIBLING or NESTED element that was handed none stops starting from nothing: a token belongs to
// the page, not to whichever component happened to receive it. Publishing
// is idempotent and ignores empties, so this cannot clobber a good token with a blank one.
watch(() => config.value?.tk, (tk) => { if (typeof tk === 'string' && tk) publishMapToken(tk) }, { immediate: true })
// A token-SERVICE URL in the profile-config (tokenUrl) is asked only when no token is at hand; its answer
// is published page-wide, so mapboxToken above (and every sibling) picks it up.
watch(() => config.value?.tokenUrl, (url) => {
  if (url && !config.value?.tk && !sharedToken.value) fetchMapToken(url)
}, { immediate: true })
// Default to the CONFIGURED active source from sources.json (e.g. 'pray-tools', the live API)
// — NOT a hardcoded 'doxa-csv'. A host/gem-frame that embeds the bundle without an explicit
// profile-config.dataSource (the platform case) was silently falling back to 'doxa-csv', whose
// RELATIVE CSV path 404s off the CDN origin → the map loaded but NO data fetch fired (looked
// like an "API access" problem; the API is actually CORS-open). Honoring sources.json's
// activeSource makes the bundle render live data by default on any host, while still letting a
// host override via profile-config.dataSource. (doxa-csv stays the final offline fallback.)
const dataSource   = computed(() => config.value?.dataSource || sourcesConfig.activeSource || 'doxa-csv')
const colorSet     = computed(() => config.value?.colorSet || 'default')
// QA corner widget: OPT-IN via profile-config.qa (default OFF). On for our own
// surfaces (SPA + plugins); OFF for partner embeds so no QA button appears on their sites.
const showQa       = computed(() => !!QaCorner && config.value?.qa === true)
// Conversion coach-mark: DEFAULT ON (opt-out via profile-config pinHint:false).
// Safe everywhere — PinHint self-gates on a map <canvas> existing in the shadow
// root, so list/table profiles never show it. See hints/PinHint.vue.
const showPinHint  = computed(() => config.value?.pinHint !== false)

// ─── Per-map language override (single keystone for ALL profiles) ─────────────
// `profile-config.locale` is the established contract — the host Nuxt page passes
// its @nuxtjs/i18n locale this way (see research-map.vue), used for both UI chrome
// and API `lang`. `lang` is accepted as an alias (the loc-002 card's wording).
// Setting it HERE activates every existing t() string per-map — geocoder, tabs,
// legend, search — for every profile, not just research-map. Validated against the
// shipped catalogs; an unknown/absent value leaves the i18n-detected default
// (document.documentElement.lang → 'en') untouched.
const lang = computed(() => {
  // ?lang= / ?locale= on the page is the last rung: an embed opened with ?lang=ar already got Arabic TEXT
  // (createAppI18n reads the URL) but this component's lang stayed '' so its dir and data language did not
  // follow. profile-config still wins.
  const raw = (config.value?.locale || config.value?.lang || localeFromUrl() || '').split('-')[0].toLowerCase()
  return SUPPORTED_LOCALES.includes(raw) ? raw : ''
})
// CRITICAL: this component is the ROOT of a defineCustomElement. vue-i18n's
// useI18n() CANNOT resolve its injection at the custom-element root — it throws
// "Need to install with `provide` function" and the entire map fails to mount
// (blank gem frames on staging). This is true even though plain inject() works
// at the root (profileModules below resolves fine). So instead of useI18n(), we
// take the i18n INSTANCE the bundle entry installed — handed to us by reference
// via provide('appI18n') — and drive its global locale directly. Descendant
// components (geocoder, legend, tabs, LanguageSelector) are NOT the CE root, so
// they keep using useI18n() normally. See documentation/DIAGNOSIS-emergency-staging-fix.md.
const appI18n = inject('appI18n', null)
watchEffect(() => {
  if (!lang.value) return
  if (appI18n) appI18n.global.locale.value = lang.value
  // And publish it for the plugin-free reader too. Driving appI18n covers every component that uses
  // t(); tStatic reads the URL and the document and would still say English. A bundle that installs
  // no i18n at all reaches this line and nothing else, which is the case it exists for.
  setRuntimeLocale(lang.value)
  // ★ THE HOST CHANNEL NEEDS ITS CATALOGUE FETCHED. When the build ships one locale, the preload in
  // i18n/index.js fires once at script evaluation from detectLocale() — which reads only the URL and
  // <html lang>. A locale arriving through profile-config gets here and nowhere else (that is the
  // whole point of the channel, and the comment below records that an earlier document-level fix
  // never saw it), so without this line a host-configured embed sets the locale, mirrors its
  // direction, and then renders English with no error. No-op when the locale is inlined, already
  // fetched, or unpinned — see loadLocale.
  loadLocale(appI18n, lang.value).catch(() => { /* stays on the English fallback */ })
})
// Effective locale for non-i18n descendants (the geocoder reads useI18n directly).
const effectiveLocale = computed(() => lang.value || appI18n?.global?.locale?.value || 'en')

// ── TEXT DIRECTION BELONGS TO THIS ELEMENT, NEVER TO THE PARTNER'S PAGE ──────
// An RTL locale has to mirror the plugin's layout, or Arabic text renders inside a
// left-to-right box: readable glyphs in the wrong place, which reads as a styling quirk
// rather than the bug it is.
//
// ⚠ IT USED TO BE SET ON document.documentElement (library/i18n/index.js, createAppI18n), and
// that was wrong twice over:
//   TARGET — an EMBEDDED widget writing <html dir> flips the PARTNER'S WHOLE PAGE. Their
//     headings, their nav, their footer. The old comment already worried about the host owning
//     that decision, but only guarded against CLEARING dir, not against setting it.
//   TIMING — it ran at createAppI18n() construction from detectLocale(), which reads only the
//     URL and <html lang>. A locale arriving later through profile-config — the channel a HOST
//     uses — never reached it. Measured: htmlDir null on every host-channel run, including
//     leaves whose chrome was fully Arabic.
// Binding it here fixes both: this is the plugin's own root, and effectiveLocale is the locale
// actually in force AFTER profile-config, so it re-evaluates when a host changes the language.
//
// A standalone leaf still gets <html dir> — but from the LEAF PAGE, which owns its document.
// This element cannot tell "I am the page" from "I am a widget", and guessing wrong is exactly
// the failure above, so it never touches the document at all.
const dirAttr = computed(() => (RTL_LOCALES.has(effectiveLocale.value) ? 'rtl' : 'ltr'))

// ─── On a phone (SPEC-MOBILE-FLAG) ───────────────────────────
// The rule lives in useScreenGate, shared with the composites that define their element without
// ProfileLoader (dashboard-plus-grid): a desktop-only profile is never mounted on a narrow screen, a
// larger-screens one mounts under a dismissible notice, and neither shows inside the Gallery.
const {
  blocked: blockedOnThisScreen,
  advise: adviseOnThisScreen,
  dismiss: dismissLargerScreenNotice,
  label: mobileLabel,
} = useScreenGate(config)

// ── HOLD THE TEXT FOR AN RTL LOCALE, NEVER THE MAP ──────────────────────────
// When the catalogue is fetched rather than inlined, a non-English reader sees English until it
// lands. For nine of the ten that is a re-render — the words change and nothing moves. For Arabic it
// is a LAYOUT FLIP: English left-to-right, then the whole chrome mirrors. So the text waits and the
// map does not.
//
// ⚠ NOT A v-if ON THE PROFILE. <component :is="ProfileComponent"> is the ENTIRE plugin, map
// included, so gating it would hold the one thing that must never wait. This is an ATTRIBUTE on the
// existing root and a scoped rule that hides named chrome classes — every component stays mounted,
// nothing is re-entered, and the map paints on its own schedule.
//
// ⚠ visibility, NOT display: the chrome keeps its box, so nothing reflows when the text appears. A
// reflow at swap time is the same defect as the flip, only quieter.
const localePending = ref(false)
watchEffect((onCleanup) => {
  const loc = effectiveLocale.value
  if (!RTL_LOCALES.has(loc)) { localePending.value = false; return }
  let live = true
  onCleanup(() => { live = false })
  localePending.value = true
  // Always resolves — on the catalogue, or on the timeout inside localeChromeReady.
  localeChromeReady(loc).finally(() => { if (live) localePending.value = false })
})

// ─── Instance ID ─────────────────────────────────────────────────────────────
// Optional in profile-config: { "instanceId": "my-map" }
// If not provided, a random ID is generated (stable for the element's lifetime).
// This ID scopes all cross-instance events so multiple <doxa-map> embeds never cross-talk.
const instanceId = computed(() =>
  config.value?.instanceId || ('doxa-map-' + Math.random().toString(36).slice(2, 9))
)

// ─── Profile Registry — provided by bundle entry ────────────────────────────
// The bundle entry (plugin-designs/<bundle>/index.js) MUST run
//   app.provide('profileModules', import.meta.glob('./*.vue'))
// because import.meta.glob cannot cross package boundaries — it must be
// evaluated by the bundle that owns the profile .vue files.

// (injected above, where profileName needs it to resolve a single-profile default.)

// ─── Async component — loads the resolved profile file ───────────────────────

const ProfileComponent = computed(() => {
  if (!profileName.value) return null
  const key = `./${profileName.value}.vue`
  if (!profileModules[key]) {
    console.error(`[ProfileLoader] Profile not found: "${profileName.value}". Available:`, Object.keys(profileModules))
    return null
  }
  // retryable: one ERR_NETWORK_CHANGED must not kill the profile for the page's life
  // (see @map/composables/retryableAsyncComponent.js).
  return retryableAsyncComponent(profileModules[key])
})

// ─── Provide parsed config to all descendants ────────────────────────────────
// Profile components and composables read these via inject() — no prop-drilling

provide('mapboxToken',   mapboxToken)
provide('dataSource',    dataSource)
provide('colorSet',      colorSet)
provide('profileConfig', config)
provide('instanceId',    instanceId)
provide('lang',          effectiveLocale)

// ─── Instance-scoped Pinia stores ────────────────────────────────────────────
// ProfileLoader runs inside the correct Vue app (each <doxa-map> gets its own
// createPinia() via entry.js configureApp). Calling useXxxStore() HERE resolves
// to THIS app's Pinia instance. We provide the store instances so all descendants
// can inject them — no direct useXxxStore() calls in children, eliminating
// getActivePinia() cross-bleed when multiple <doxa-map> elements share a page.
const uiStore   = useUIStore()
const mapStore  = useMapStore()
const dataStore = useDataStore()

// Restore the persisted theme HERE — synchronously in setup, before any profile
// renders or creates its map. This is the SHARED boot so every profile is fixed
// at once (not each remembering to call uiStore.init() in onMounted). Without it,
// a profile that doesn't call init() (e.g. doxa-simple-map) renders LIGHT while
// the map's bootStyle() reads localStorage 'dark' directly → UI/map theme desync
// on reload. Doing it pre-render also kills the brief light→dark flash on the
// profiles that DO hydrate later in onMounted. init() (onMounted) still runs for
// the ResizeObserver / matchMedia listeners; setTheme is idempotent so the re-apply
// is harmless. (staging bug, coder 2026-06-25: dark selected + reload → map dark, UI light.)
// Sandboxed iframe (no allow-same-origin, origin 'null') → localStorage EXISTS but THROWS
// SecurityError on access, so a bare typeof-guard isn't enough. try/catch → skip persisted theme.
try {
  const savedTheme = (typeof localStorage !== 'undefined') ? localStorage.getItem('theme') : null
  if (savedTheme) uiStore.setTheme?.(savedTheme)
} catch (e) { /* sandboxed: no persisted theme */ }

provide('uiStore',   uiStore)
provide('mapStore',  mapStore)
provide('dataStore', dataStore)

// ★ THE FLOOR NEVER EXCEEDS A SIZED HOST, and it is decided WITHOUT disturbing live content: measured once at mount,
// then only followed (library/elements/hostFloor.js, which says why, and check:host-floor, which pins it). The
// viewport floor below (min-height: 100svh) is for a host whose height comes from its CONTENT; a host SIZED from
// outside (DX Life's slot) is filled exactly, so its bottom (a map's legend) is never clipped.
const loaderEl = ref(null)
let hostRO = null
onMounted(() => {
  const el = loaderEl.value
  const host = el && el.getRootNode ? el.getRootNode().host : null
  if (!el || !host) return
  const floor = createHostFloor(el, host)
  floor.probeOnce()
  if (typeof ResizeObserver !== 'undefined') {
    hostRO = new ResizeObserver(() => floor.follow())
    hostRO.observe(host)
  }
})
onBeforeUnmount(() => { if (hostRO) { hostRO.disconnect(); hostRO = null } })
</script>

<template>
  <div ref="loaderEl" class="profile-loader" :class="{ 'has-screen-notice': adviseOnThisScreen }" :dir="dirAttr" :data-locale-pending="localePending ? '' : null">
    <!-- Error: no profile-config prop -->
    <div v-if="!config" class="profile-error">
      <p>⚠️ <strong>doxa-map</strong>: missing or invalid <code>profile-config</code> prop.</p>
      <p>Example: <code>profile-config='{"profile":"example-map","tk":"MAPBOX_PUBLIC_TOKEN"}'</code></p>
    </div>

    <!-- Error: profile name not found in registry -->
    <div v-else-if="!ProfileComponent" class="profile-error">
      <p>⚠️ Profile <strong>"{{ profileName }}"</strong> not found.</p>
    </div>

    <!-- A desktop-only map on a narrow screen: the message, and the profile is never mounted -->
    <LargerScreenNotice v-else-if="blockedOnThisScreen" mode="desktop-only" :label="mobileLabel" :locale="effectiveLocale" />

    <!-- Render the matched profile, under the larger-screens notice when it applies -->
    <template v-else>
      <LargerScreenNotice v-if="adviseOnThisScreen" mode="larger-screens" :locale="effectiveLocale" @dismiss="dismissLargerScreenNotice" />
      <component :is="ProfileComponent" />
    </template>

    <!-- QA corner widget (opt-in via profile-config.qa) — floats over any profile -->
    <component :is="QaCorner" v-if="ProfileComponent && showQa" />

    <!-- Conversion coach-mark (default on; self-gates on a map canvas) -->
    <PinHint v-if="ProfileComponent && showPinHint" />
  </div>
</template>

<style scoped>
/* ── the RTL chrome hold (see localePending above) ─────────────────────────────
   Text chrome is hidden while an RTL catalogue is in flight, so a reader never sees English
   left-to-right and then a mirror. NAMED CLASSES, not a blanket rule on descendants: two of the
   text-bearing components also carry the map (LegendMobile, RegionCountryMap), and hiding a map
   subtree is the one outcome this is supposed to prevent.

   :deep() because those elements belong to child components and this block is scoped.

   visibility keeps each box in the layout, so the text appearing causes no reflow. The state is
   always temporary — localeChromeReady resolves on the catalogue or on its own timeout — so there
   is no path where this leaves the chrome hidden. */
.profile-loader[data-locale-pending] :deep(.stl-tabs),
.profile-loader[data-locale-pending] :deep(.stl-title),
.profile-loader[data-locale-pending] :deep(.stl-rows),
.profile-loader[data-locale-pending] :deep(.legend-title),
.profile-loader[data-locale-pending] :deep(.legend-content),
.profile-loader[data-locale-pending] :deep(.legend-reopen-label),
.profile-loader[data-locale-pending] :deep(.lt-btn-text),
.profile-loader[data-locale-pending] :deep(.rd-topbar),
.profile-loader[data-locale-pending] :deep(.rd-exportbar) {
  visibility: hidden;
}

.profile-loader {
  /* Pass the host's rounded corners down. The host page rounds the custom element; this
     wrapper sits between the host and the profile, so without this every descendant —
     including the WebGL canvas, which its own compositing layer leaves unclipped —
     would inherit square corners and show through the rounded slot. */
  border-radius: var(--map-radius-corners, var(--map-radius, 0px));
  width: 100%;
  height: 100%;
  /* VIEWPORT-UNIT FLOOR (BUG-UPG100-NESTED-ELEMENTS-ZERO-HEIGHT). height:100% above resolves against
     the HOST — but a host sized only by min-height (the scroll-page leaf) computes height:auto, and a
     percentage of auto collapses to 0. This wrapper sits between the host and EVERY profile, so that
     one collapse zeroed every profile whose chrome is position:absolute/inset:0 (upg-100-mfe ->
     .pane-col -> .pane all measured 0 while the header still painted). A dvh floor depends on no
     ancestor, so the wrapper always has height; height:100% still wins whenever the host IS sized.

     ★ EXCEPT IT DOES NOT WIN, AND THAT IS WHY THIS IS NOW A VARIABLE (measured 2026-09-22,
     BUG-STILL-CANNOT-SCROLL-DOWN-TO-THE-GRID). height:100% and min-height:100dvh resolve against
     DIFFERENT bases: the former against the host, the latter against the VIEWPORT. So whenever the
     host is sized SHORTER than the viewport — any pane with chrome above it, e.g. the plugin-studio
     tab pane at 769px under a 900px viewport — the floor wins over the height, the wrapper is 131px
     taller than its host, and it overflows. A host that then turns on overflow-y:auto to let a tall
     composite scroll gets a spurious 131px scrollbar on every fixed-viewport map.
     It cannot be fixed from the host side: this wrapper is inside the element's SHADOW ROOT, where
     no host-page selector reaches. Inherited properties DO cross that boundary, so a custom property
     is the one lever a host has. Every standalone leaf keeps the floor that BUG-UPG100 needs. A host
     that has ALREADY given this element a definite height sets --profile-min-h:0 and opts out.

     ★ SMALL VIEWPORT (svh), NOT dvh (2026-10-02, measured on a phone). dvh FOLLOWS the mobile URL bar:
     scrolling collapses the bar, 100dvh grows, every map grew with it mid-scroll and its bottom legend
     sheet moved. svh is the viewport WITH the bar showing and never changes on scroll, so the floor is
     stable and the legend stays on screen. (A browser without svh falls back to 100vh, below.) */
  min-height: var(--profile-min-h, 100svh);
  position: relative;
}
/* THE LARGER-SCREENS NOTICE SITS IN FLOW, so the plugin below it must give up exactly its height:
   a column, the notice at its natural size, the profile taking the rest (min-height:0 lets it shrink
   instead of overflowing the host by the notice's height). Only while the notice shows. */
.profile-loader.has-screen-notice {
  display: flex;
  flex-direction: column;
}
.profile-loader.has-screen-notice > :not(.lsn-bar) {
  flex: 1 1 auto;
  min-height: 0;
  /* A profile whose ROOT is position:absolute; inset:0 would be laid out against this wrapper and paint
     over the bar, hiding the notice and its ×. While the bar shows, the root is held in flow as the
     column's second item; its own absolute children still anchor on it. No flagged profile has that
     shape today; this keeps the next one from needing a special case. */
  position: relative !important;
  inset: auto !important;
}

.profile-error {
  padding: 1rem;
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
}
@supports not (height: 100svh) {
  .profile-loader { min-height: var(--profile-min-h, 100vh); }
}
</style>
