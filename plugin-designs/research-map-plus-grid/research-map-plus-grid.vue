<script setup>
/**
 * research-map-plus-grid.vue — Capability-4 composite: doxa-research-map + people-groups-grid
 * stacked to scroll. THE MOBILE SIBLING of dashboard-plus-grid.
 *
 * @element research-map-plus-grid
 * @description The monolithic 7-tab research map (cap-3) on top, the People Groups grid beneath,
 *   stacked via the shared StackLayout so the host page scrolls through both. Each child is
 *   composed by TAG + BUNDLE URL (the stack-demo `element`/`src` contract), so each one boots
 *   through its OWN bundle entry and stays individually embeddable.
 *
 * ── WHY THIS EXISTS AS A SEPARATE PLUGIN (decided 2026-09-22) ─────────────────────────────────
 * The first idea was ONE cap-4 plugin that SWAPS its top element by aspect ratio — research
 * dashboard on desktop, research map on mobile. That was reversed mid-decision:
 * "We made the wrong choice of saying that we should swap elements based on mobile and desktop...
 * That would be really complex. It'd be easier just to have two separate capability-4 plugins."
 *
 * So there are two plain composites and NEITHER knows about the other:
 *   - dashboard-plus-grid    = DESKTOP — research-dashboard + grid
 *   - research-map-plus-grid = MOBILE  — research map + grid   (this file)
 * Which one appears is chosen by aspect ratio AT THE SPA LEVEL, never inside a plugin.
 *
 * ★ WHY THE SPLIT IS ALSO THE BETTER ENGINEERING, not just the simpler one. A self-swapping
 *   element would be un-embeddable in any fixed context: deploy methods 1 (iframe) and 3
 *   (direct-JS) both place an element at a size the HOST controls, so an element that silently
 *   changes what it IS based on its own width gives an embedder no way to ask for the one they
 *   want. Two elements keep both independently embeddable.
 *
 * ★★ WHY THIS COMPOSES BY src AND DOES **NOT** BAKE ITS CHILDREN — the non-obvious part.
 *   dashboard-plus-grid IMPORTS its two children's .vue files directly and compiles them in. That
 *   works there because research-dashboard owns NO MAP (it is SVG charts). Doing the same with the
 *   research map would SILENTLY SHIP A BROKEN ELEMENT, because importing a child .vue BYPASSES its
 *   index.js — and doxa-research-map/index.js is where four load-bearing things happen:
 *     1. registerStrategies(import.meta.glob('./src/colors/*.js')) — its THREE bundle-private colour
 *        strategies (affinity-block, doxa-region, resource). Without them the map's colour modes are
 *        missing.
 *     2. app.provide('profileModules', import.meta.glob('./*.vue')) — the map is mounted through
 *        ProfileLoader, NOT as a bare component; with no registry it cannot resolve its own profile.
 *     3. createPinia() + createAppI18n() + provide('appI18n') — the same appContext pair whose
 *        absence caused BUG-VUE-I18N-CODE27 (a thrown setup() removes the subtree with an EMPTY
 *        SyntaxError, which cost the desktop sibling its Share / Zoom controls before it was found).
 *     4. mapboxgl.setRTLTextPlugin, installed once per page.
 *   The failure mode is the dangerous one: the build stays GREEN and the defect is a blank or
 *   half-coloured band at runtime. So: compose by tag+src, let the real bundle entry run.
 *   This also matches the standing rule for nesting maps (avoid the Mapbox peer + the one-shot
 *   customElements.define collision). Measured 2026-09-22: NO composite in this repo bakes a map
 *   component directly — every map is composed via its own bundle.
 *
 * ── THE ONE REAL DIFFERENCE FROM THE DESKTOP SIBLING ─────────────────────────────────────────
 * The grid's OWN search bar and filters are ENABLED here. In dashboard-plus-grid they are turned
 * OFF (show-search=false, show-filters=false) because the research dashboard's header owns those
 * controls and drives the grid through props — two search bars would be a duplicate. The research
 * map has NO such header, so switching them off here would leave the grid with no way to be
 * searched or filtered at all. The requirement: the grid's search bar + filters must be toggled
 * ON via prop. This is why the swap-inside-one-element idea was genuinely complex: the two top
 * elements do not merely look different, they imply OPPOSITE control ownership below.
 */
import { computed, reactive, watch, onMounted, onBeforeUnmount, getCurrentInstance, watchEffect, ref } from 'vue'
import { SUPPORTED_LOCALES, RTL_LOCALES, setRuntimeLocale, getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
import StackLayout from '@map/layouts/StackLayout.vue'
import { absoluteEmbedUrl } from '@map/utils/embedBase.js'
import { publishMapToken } from '@map/composables/useSharedMapToken.js'
import { useHostTokenUrl } from '@map/composables/useHostTokenUrl.js'

// ★ THE HOST'S INLINE STYLE MUST NOT LAND ON OUR ROOT.
// This SFC is mounted AS a custom element, so a style attribute the HOST page puts on the tag falls
// through onto this component's root element. MEASURED 2026-09-25 with a host style of
// "display:flex; position:relative; height:100%": that exact string appeared verbatim on the inner
// root div of this component — the gallery sets one on every tab, and on the Prayer Walk Planner
// the same fallthrough collapsed the plugin to 76px. The element's own :host rules are the contract
// for how it sizes itself; a host styling the TAG is styling the box, not our internals.
defineOptions({ inheritAttrs: false })


// ★ THE HOST'S OWN profile-config, WHICH THIS COMPOSITE USED TO THROW AWAY.
// It declared no props at all, so a partner's <research-map-plus-grid profile-config='{"tk":"..."}'>
// had its token dropped on the floor. On our own generated leaf that was invisible: the leaf page
// carries a BAKED token, assigns window.MAP_TOKEN, and the shared-token bridge hands it to the
// nested map. A partner page has no leaf and no baked token, so the JS embed — one of the two
// shipped embed methods — mounted a map that could not draw. MEASURED on a third-party origin
// before this: 'No Mapbox access token provided', 0 style and 0 tile requests, no canvas.
const props = defineProps({
  /** The host's JSON config, exactly as the embed snippet writes it. */
  profileConfig: { type: [String, Object], default: null },
})

const hostConfig = computed(() => {
  const raw = props.profileConfig
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  // A malformed attribute must not take the whole element down with it — the map half is more
  // useful token-less than the page is with a thrown setup().
  try { return JSON.parse(raw) } catch { return {} }
})

// Publish page-wide as well as threading it below. Threading covers THIS child deterministically;
// publishing covers any element on the page that mounted before the attribute was read, which is
// the shape the shared-token composable exists for.
const hostToken = computed(() => {
  const tk = hostConfig.value?.tk
  return typeof tk === 'string' && tk ? tk : ''
})
if (hostToken.value) publishMapToken(hostToken.value)
// ★ tokenUrl: A TOKEN SERVICE, NOT A TOKEN, AND ONLY ProfileLoader EVER READ IT (PM-tok). A host may
// name a URL to ASK for a key instead of pasting one. This composite bakes its children in rather than
// mounting them through ProfileLoader, so embedded BARE — one tag on a partner's page, which is the
// entire point of a composite — a tokenUrl-only config reached nobody: no token, "No Mapbox access
// token provided", 0 tiles, no canvas. With an outer ProfileLoader on the page it worked, because THAT
// fetched and published; the composite was passing an exam somebody else sat. The failure also wears
// the wrong face: it is identical to a missing `tk`, which IS threaded, so it reads as a host typo.
// Forwarded to the children too, so a child that outlives this fetch can still ask.
const hostTokenUrl = useHostTokenUrl(hostConfig, hostToken)


// ★ THE PROVIDER IS A HOST KNOB TOO, AND FORGETTING IT BREAKS THE KEYLESS CASE ENTIRELY.
// resolveMapProvider's ladder starts at profile-config.provider, and the child reads its OWN
// profile-config — the one this file writes. A host asking for <research-map-plus-grid
// profile-config='{"provider":"maplibre"}'> therefore got a child still on mapbox, which then
// demanded a token. MEASURED on a third-party origin before this: 'No Mapbox access token
// provided', 0 tiles, no canvas — for the exact configuration whose whole purpose is needing no
// token. Keyless at volume is the reason MapLibre support exists; a composite that drops the
// prop cancels it.
const hostProvider = computed(() => {
  const p = hostConfig.value?.provider
  return p === 'maplibre' || p === 'mapbox' ? p : ''
})

// ★ THE LOCALE THE HOST ASKED FOR, THREADED DOWN LIKE THE TOKEN AND THE PROVIDER.
// A composite is the only thing between a partner's `profile-config` and the elements that render
// the text, and this knob was not being passed: `{"lang":"ar"}` on the composite reached nothing,
// so the page stayed English however complete the catalogues were. MEASURED alongside the tk and
// provider holes, and the same shape of defect — a knob the snippet documents, read by nobody.
// setRuntimeLocale is called here as well as threaded, because the composite's OWN chrome is read
// through tStatic, and a composite sits above every ProfileLoader on the page rather than under one.
const hostLang = computed(() => {
  const l = String(hostConfig.value?.lang || hostConfig.value?.locale || '').split('-')[0].toLowerCase()
  return SUPPORTED_LOCALES.includes(l) ? l : ''
})
watchEffect(() => { if (hostLang.value) setRuntimeLocale(hostLang.value) })

// The host's people-group LIST (library/lists/), threaded down like the provider: into the map's
// profile-config and as the only key of the grid's.
const hostList = computed(() => (typeof hostConfig.value?.list === 'string' ? hostConfig.value.list : ''))

// ★ RTL IS A DIRECTION, NOT A TRANSLATION, and nothing was setting it here.
// createAppI18n reflects an RTL locale onto document.documentElement — right for a leaf page it
// owns, useless for an element dropped into somebody else's page, which is the case this composite
// exists for. A host that asks for Arabic through profile-config got Arabic WORDS in a
// left-to-right layout: readable glyphs in the wrong place, which reads as a styling quirk rather
// than the bug it is.
//
// Set on the custom-element HOST rather than on the layout inside it, deliberately: `dir` takes
// effect through the inherited CSS `direction`, and inheritance crosses shadow boundaries — so one
// attribute on the host covers this composite's own chrome AND every nested element beneath it,
// which is the half the audit found missing. Set and CLEARED, but only ever ours: a host page that already
// declares its own dir owns that decision.
const textDir = computed(() => {
  const l = hostLang.value || getRuntimeLocale() || detectLocale()
  return RTL_LOCALES.has(l) ? 'rtl' : 'ltr'
})
// ★ THE INSTANCE IS CAPTURED IN SETUP, NOT READ WHEN THIS RUNS, and that is the whole bug.
// getCurrentInstance() answers only while setup or a lifecycle hook is on the stack. reflectDir is
// called from BOTH — onMounted (where it works) and watch(textDir) (where there is no current
// instance, so the read returned null and nothing was reflected). So a host that set lang=ar before
// mount got dir=rtl correctly, and a host that SWITCHED to ar afterwards silently got nothing:
// first paint was right, which is exactly why this read as correct. Arabic then rendered in a
// left-to-right layout — the failure the comment above calls "a styling quirk rather than the bug
// it is". Measured in this tree before, under Vue 3.5.42, when research-map.vue's emitFilterState
// died the same way; the fix is its _selfInstance, and this is the same fix.
const _selfInstance = getCurrentInstance()
// ★ WE CLEAR ONLY THE DIRECTION WE SET. The line below used to be a one-way
// `if (rtl) setAttribute('dir','rtl')` with no else, so a reader who switched from an RTL locale to
// an LTR one (ar -> zh) kept a right-to-left layout for the rest of the session: Chinese laid out
// backwards, which reads as a broken page rather than a stale setting.
// The original reason for never clearing is still honoured, and is why this remembers rather than
// just removing: a host page that declares its OWN dir owns that decision, so the value found before
// we first wrote is restored verbatim, and removed only when there was none.
// ★ CAPTURED AT MOUNT, NOT AT FIRST WRITE. The capture used to sit inside the rtl branch, so it
// recorded whatever `dir` happened to be on the host the first time WE wrote — and if anything else
// had already set rtl by then, that value was recorded as "the page's own" and faithfully restored
// forever after. MEASURED on the Big Picture leaf: ar left rtl, and zh put rtl straight back.
// Reading it on the FIRST call instead, before any write of ours, is the only moment the attribute
// is certainly the page's and not ours.
let _hostDir = null
let _weSetDir = false
function reflectDir() {
  try {
    const host = _selfInstance?.proxy?.$el?.getRootNode?.()?.host
    if (!host || !host.setAttribute) return
    if (_hostDir === null) _hostDir = host.getAttribute('dir') || ''
    if (textDir.value === 'rtl') {
      host.setAttribute('dir', 'rtl')
      _weSetDir = true
    } else if (_weSetDir) {
      if (_hostDir) host.setAttribute('dir', _hostDir); else host.removeAttribute('dir')
      _weSetDir = false
    }
  } catch (_) { /* no host (SSR/tests) — nothing to reflect */ }
}
onMounted(reflectDir)
watch(textDir, reflectDir)

// The absolute url this composite is shared and iframed as. Built here rather than written as a
// literal because resolveEmbedBase() walks profileConfig.embedBaseUrl → window.MAP_EMBED_BASE_URL →
// the root this bundle derives from its OWN script url, so the link is right on doxa.life, on
// the live test host and in a dropped tree with nothing configured.
//
// It MUST be absolute, which is the non-obvious part. resolveShareUrl returns a tier-1 shareUrl
// VERBATIM (embedBase.js:95 — `return whole.trim()`, no resolution), and ShareButton feeds the same
// string into its embed snippet: <iframe src="{shareUrl}">. A relative value would look correct in
// the share LINK, because the browser resolves it against this page, and then 404 in the EMBED,
// because it resolves against the partner's page instead. Tier 1 is documented as "a WHOLE url" for
// exactly this reason.
// ★ THE `: leaf` BRANCH WAS THE BUG THE COMMENT ABOVE WARNS ABOUT. When no base resolves — a dev
// server, an ESM build, a tree whose script url does not match `<name>/<name>.js` — that expression
// returned a BARE RELATIVE PATH, tier 1 returned it verbatim, and the reader copied
// `research-map-plus-grid/research-map-plus-grid/index.html` from a page at http://127.0.0.1:5192/.
// absoluteEmbedUrl resolves against document.baseURI when there is no base, so it is never relative.
const SHARE_URL = absoluteEmbedUrl('research-map-plus-grid/research-map-plus-grid/index.html')

// One-screen height for the fixed-viewport research-map band. Same reasoning as
// dashboard-plus-grid's DASHBOARD_H: the research map is a FIXED-VIEWPORT app whose shell is a CSS
// grid with height:100% and a 1fr map hero plus inner-scroll regions. Rendered in a scroll-page
// section with NO definite height, height:100% collapses to its floor and its inner-scroll regions
// swallow the wheel, so the OUTER page never grows past it and the grid below is unreachable.
// Pinning min === max gives it a definite height to fill while the page keeps growing below.
// svh (small viewport height) avoids the mobile URL-bar jump — which matters MORE here than on the
// desktop sibling, because this composite is the mobile one.
// ★ AND IT ENDS ON THE FIRST SCREEN. 88svh assumes the band starts near the top of the window.
// Under a host page's header it does not: measured 2026-09-30 on DX Life at 390x844, the band ran
// from y132 to y875. The legend sheet's bottom and its COLLAPSED strip began 31px below the fold,
// so a reader who collapsed the legend could not reopen it without scrolling first. sizeBand() below
// shortens the band to what is visible beneath its own top (never more than 88svh). The fallback is
// the old 88svh. It is measured once, and again only when the WIDTH changes (a rotation), never on a
// height change: the URL bar showing and hiding must not resize the map.
const MAP_H = 'var(--sr-band-h, 88svh)'
function scrollParentOf(el) {
  for (let n = el.parentElement || el.getRootNode?.()?.host; n; n = n.parentElement || n.getRootNode?.()?.host) {
    const oy = getComputedStyle(n).overflowY
    if (oy === 'auto' || oy === 'scroll') return n
  }
  return null
}
let _bandWidth = 0
function sizeBand() {
  try {
    const host = _selfInstance?.proxy?.$el?.getRootNode?.()?.host
    if (!host || !host.style || typeof window === 'undefined') return
    const box = scrollParentOf(host)
    const bottom = Math.min(window.innerHeight, box ? box.getBoundingClientRect().bottom : window.innerHeight)
    const h = Math.floor(Math.min(bottom - Math.max(0, host.getBoundingClientRect().top), window.innerHeight * 0.88))
    // Below 320px the map is worse than a band that runs past the fold, so keep the fallback there.
    if (h >= 320) host.style.setProperty('--sr-band-h', h + 'px')
    else host.style.removeProperty('--sr-band-h')
    _bandWidth = window.innerWidth
  } catch (_) { /* no layout (SSR/tests): the 88svh fallback stands */ }
}
function onBandResize() { if (window.innerWidth !== _bandWidth) sizeBand() }

// src is resolved by the browser relative to THIS leaf page, which is served two levels deep
// (doxa-maps/research-map-plus-grid/research-map-plus-grid/index.html) — so go UP TWO to reach a
// sibling bundle's tree (doxa-maps/<bundle>/<bundle>.js). An off-by-one here is a 404 and a
// SILENTLY EMPTY section: StackLayout's .catch() deliberately leaves a failed section's host empty
// so the rest of the stack still renders, which means a wrong path costs you a band with NO error.
// `bun run check:composite-srcs` resolves every composite src against the built tree to catch it.
// ★ A DEV ENTRY AND A BUILT BUNDLE DO NOT LIVE AT THE SAME URL, so one literal cannot name both.
// In dev, vite serves each bundle's SOURCE entry at /plugin-designs/<bundle>/index.js; there is no
// <bundle>/<bundle>.js to reach, so '../../doxa-research-map/doxa-research-map.js' 404s and the
// section renders EMPTY (StackLayout's .catch() keeps the rest of the stack alive, which is exactly
// why an empty band is easy to miss). Same helper, same reasoning, as stack-demo.vue — which hit
// this first and wrote down that a literal '../..' "looks correct in review and is invisible to a
// gate that only ever checks the built tree", which is why check:composite-srcs passes on it.
// import.meta.env.DEV is statically replaced at build time, so the production branch is the ONLY
// one that survives into the IIFE: the built output is byte-identical to the literal it replaces.
const bundleSrc = (bundle, file) =>
  import.meta.env.DEV ? `/plugin-designs/${bundle}/index.js` : `../../${bundle}/${file}.js`

// ─── ONE FILTER STATE, TWO HALVES (decided 2026-09-25) ───────────────
// The composite owns the filter; the children report theirs upward and accept ours downward. The
// four facets are the HONEST OVERLAP between what a research map filters by and what a people-group
// grid filters by — region, religion, language, engagement. Country, bloc and cluster live on only
// one side, so linking them would mean inventing a meaning for the other; they stay local.
//
// ★ EACH CHILD STAYS INDEPENDENTLY EMBEDDABLE. Both directions travel as DOM CustomEvents and
// attributes, so a child mounted ALONE hears nothing and is handed nothing, and behaves exactly as
// it does today. That is the contract this composite was built on and the reason the halves are
// separate elements at all.
// ★ BOTH FORMS ARE KEPT ON PURPOSE. The grid filters by the wagf_region VALUE ('africa'); the map
// wants that same slug (its region highlight builds an ISO match from a slug-keyed map, and its
// legend tree node ids are `region:<slug>`), while the LABEL is what a human-facing surface would
// show. Keeping value and label together means neither half has to guess, and the reverse direction
// can hand the grid a slug derived from the label the map reports.
// ★ REGION CARRIES TWO FORMS AND THE OTHER TWO CARRY ONE — because that is what the halves
// actually speak, not because uniformity was worth the extra field. Region's slug is a THIRD string
// ('africa') that neither half's data carries as a label, so both forms have to travel. Religion
// and language link on the display NAME alone, and each half resolves that name itself: the map
// reverses RELIGION_FAMILIES to get its legend key, the grid runs the same shared table forward per
// row to derive `__religion_family`. The mapping lives in library/colors/religion.js and is copied
// nowhere, least of all here — a table beside the data is the thing that goes stale.
//
// ★ ONE SELECTION AT A TIME, BECAUSE THE MAP HAS ONE. MEASURED in mapStore: selectLanguage() nulls
// selectedRegion by design (Bug 13, mutually exclusive legend selections), and religion/language/
// region all end at the same applyDimFilter, so the map can light exactly one of the three. A
// composite that let the grid hold all three would put the two halves into a disagreement the map
// cannot resolve and the reader cannot see. So the composite mirrors the map's own exclusivity: a
// new facet replaces the previous one, exactly as clicking a second legend row does.
// ★ LANGUAGE CARRIES TWO FORMS NOW, FOR THE SAME REASON REGION ALWAYS DID.
// MEASURED against the live API: primary_language's LABEL is fully localized (zero names shared
// between en and ar) while its VALUE is the stable ISO 639-3 code (all 864 identical). The map's
// legend selects by NAME; the grid matches rows by VALUE. Carrying one form would have meant the
// link matching nothing the moment the grid's data followed the URL's language — and an empty
// intersection reads as "no results", not as a broken wire.
// `language.codes` is every ISO code the current language selection covers — one for a real
// language, many for a legend TIER like "Arabic". It is what lets gridLanguage() tell a coverable selection
// from an uncoverable one, instead of guessing from an empty code.
const linked = reactive({ region: { value: '', label: '' }, religion: '', language: { value: '', label: '', codes: [] } })

// ★ WHAT THE LIST IS SHOWING, so the map can go there (BUILD-GRID-SELECTION-FLIES-THE-MAP).
// The link ran one way: the map narrowed the grid, and the grid moved nothing. The grid already
// reports the slugs it is showing on every `groups-filtered`, so the honest wire is the one that
// already exists — no new control, and a grid mounted alone still emits into a room with no
// listener. This composite does not know where any people group IS; the map does, so it gets the
// slugs and frames them itself.
//
// CAPPED, and the cap is the point rather than a performance worry: a set this large is not a
// selection, it is "almost everything", and framing it would swing the camera to a world view that
// tells the reader nothing while moving a lot. Below the cap the set is specific enough that seeing
// where it sits is the whole value.
const FIT_MAX_SLUGS = 400
const gridSlugs = ref([])
function clearExcept(keep) {
  if (keep !== 'region' && (linked.region.value || linked.region.label)) { linked.region.value = ''; linked.region.label = '' }
  if (keep !== 'religion' && linked.religion) linked.religion = ''
  if (keep !== 'language' && (linked.language.value || linked.language.label)) { linked.language.value = ''; linked.language.label = ''; linked.language.codes = [] }
}
const slugify = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

// Guard against the echo: grid -> composite -> map -> composite -> grid. Each direction ignores an
// update that says what it already knows, so a round trip stops after one lap.
// ★ IGNORE OUR OWN ECHO. MEASURED: a map-filtered event set the region, pushToChildren wrote the
// grid's attribute, the grid re-filtered and emitted `groups-filtered` — whose activeFilters were
// still EMPTY at that instant — and the composite adopted that as "the reader cleared the filter",
// wiping the selection it had just applied. Both handlers fired, both did exactly what they were
// told, and the round trip cancelled itself in under a second. A push is not a user action, so the
// window in which we are pushing is a window in which children have nothing to tell us.
let pushing = false
function adopt(next) {
  if (!next) return
  // A PATCH, not a replacement: each half reports only the facets it owns a control for, so an
  // absent key means "no opinion" and must not clear a selection the other half just made.
  if (next.region && (next.region.value || next.region.label)) {
    const value = next.region.value || ''
    const label = next.region.label || ''
    if (value !== linked.region.value || label !== linked.region.label) {
      linked.region.value = value
      linked.region.label = label
      clearExcept('region')
    }
    return
  }
  if (next.religion) {
    if (next.religion !== linked.religion) { linked.religion = next.religion; clearExcept('religion') }
    return
  }
  if (next.language && (next.language.value || next.language.label)) {
    const v = next.language.value || ''
    const l = next.language.label || ''
    if (v !== linked.language.value || l !== linked.language.label) {
      linked.language.value = v
      linked.language.label = l
      // Every code the selection covers. The grid direction reports ONE real language, so this is
      // that one code; the map direction may report a grouping (see the note on the push below).
      linked.language.codes = Array.isArray(next.language.codes) ? next.language.codes : (v ? [v] : [])
      clearExcept('language')
    }
    return
  }
  // Nothing set anywhere in this report: the reader cleared whatever was active.
  if ('region' in next || 'religion' in next || 'language' in next) clearExcept(null)
}

// The grid already emits `groups-filtered` as a bubbling, composed CustomEvent — built for exactly
// this (see its header). Read the facets we link out of its activeFilters payload.
function onGridFiltered(ev) {
  if (pushing) return
  // The grid's activeFilters carry { value, label } per facet — exactly the two forms the two
  // halves need, which is why this reads both rather than picking one.
  // The slugs travel even when the facets are unchanged: a search term narrows the list without
  // touching any facet, and that is exactly a case where the reader wants the map to follow.
  const slugs = Array.isArray(ev?.detail?.slugs) ? ev.detail.slugs : []
  gridSlugs.value = slugs.length && slugs.length <= FIT_MAX_SLUGS ? slugs : []

  const active = ev?.detail?.activeFilters || {}
  const entry = active.wagf_region
  // Religion and language travel as the NAME, which for this grid is the option's label — the same
  // string the map reports for the same row. See the `linked` note for why the code stays home.
  const nameOf = (f) => (f && (f.label || f.value)) || ''
  adopt({
    region: { value: (entry && (entry.value ?? entry)) || '', label: (entry && entry.label) || '' },
    religion: nameOf(active.__religion_family),
    // The grid reports {value,label} per facet, which is exactly the two forms the halves need.
    language: { value: (active.primary_language && active.primary_language.value) || '', label: (active.primary_language && active.primary_language.label) || '' },
  })
}
function onMapFiltered(ev) {
  if (pushing) return
  // The map reports the canonical label; the grid needs the slug it filters by.
  const label = ev?.detail?.region || ''
  // The map reports religion as a NAME too (it decodes its own code before emitting), so both of
  // these cross unchanged — the translation happens inside the half that owns the vocabulary.
  adopt({
    region: { value: label ? slugify(label) : '', label },
    religion: ev?.detail?.religion || '',
    // The map sends three things: the name its legend selected by, the locale-stable ISO code when
    // there IS a single one, and every code the selection covers.
    language: {
      value: ev?.detail?.languageCode || '',
      label: ev?.detail?.language || '',
      codes: Array.isArray(ev?.detail?.languageCodes) ? ev.detail.languageCodes : [],
    },
  })
}

// ★ AN AXIS THIS GRID CANNOT EXPRESS MUST NOT NARROW IT TO NOTHING (measured: Languages >
// Language > "Arabic" took the grid 2,107 -> 0 in BOTH locales, reading as "no results").
//
// This line used to be `linked.language.value || linked.language.label`, and the fallback was the
// trap rather than the safety net. When the map reports a language TIER — "Arabic" — there is no
// single ISO code that means it (MEASURED on the live source: "Arabic" covers "Arabic, Sudanese",
// "Arabic, Levantine", "Arabic, Gulf" ... under many different codes), so the code arrives empty
// and the NAME was sent instead. The grid's valueMatches() normalises and compares whole values, so
// "Arabic" matches no row that reads "Arabic, Sudanese" — an empty grid, indistinguishable from a
// genuinely empty result.
//
// The three cases, and none of them may lie:
//   one code   -> send it. Locale-stable, and the grid filters exactly the selection.
//   many codes -> send NOTHING and leave the axis unfiltered. The map is narrowed, the grid is not,
//                 and the reader can see both — which is honest. Sending the tier NAME would show
//                 zero rows; sending one of the codes would show a fraction while looking correct.
//                 Both are worse than not narrowing on an axis we cannot yet express.
//   no codes   -> nothing is selected; send the label if there is one (the grid->map direction
//                 always carries a real, single language, so its label is a value the grid owns).
// The `many` case closes properly when filterSet goes multi-value (SPEC-DASHBOARD-KIT D1): the grid
// then takes the whole set and this becomes a real narrowing instead of an honest abstention.
function gridLanguage() {
  const codes = Array.isArray(linked.language.codes) ? linked.language.codes : []
  // ★ THE ABSTENTION IS OVER (SPEC-DASHBOARD-KIT D1). When the map reported a language TIER —
  // "Arabic", 23 ISO codes — there was no single value that meant it, so this left the axis
  // unfiltered: honest, and visibly incomplete, because the map narrowed and the grid did not.
  // The grid's valueMatches() now takes a LIST and matches OR-within-the-axis, so the whole
  // selection crosses as the codes it actually is. Still codes and never the tier NAME: the name
  // matches no row that reads "Arabic, Sudanese", which is what emptied the grid in the first
  // place.
  // `|`, not `,`: a language LABEL routinely contains a comma ("Arabic, Mesopotamian"), so a
  // comma-joined list is ambiguous with a single value. See valueMatches() in people-groups-grid.
  if (codes.length > 1) return codes.join('|')
  return linked.language.value || linked.language.label
}

let rootEl = null

// ★ PUSH THE STATE ONTO THE MOUNTED CHILDREN, DON'T JUST RE-COMPUTE THE SECTIONS.
// StackLayout applies `attrs` ONCE, when it creates each child element — that is its documented
// contract ("props in advance"). MEASURED: after the grid filtered to Africa the composite adopted
// the change and `sections` recomputed, and the map's profile-config attribute in the DOM still
// read externalFilters:{region:''} — because nothing re-applies attrs to an element that already
// exists. A computed that nobody re-reads is not a channel.
function pushToChildren() {
  if (!rootEl?.querySelector) return
  pushing = true
  // Release after the children have re-rendered and emitted, not synchronously.
  setTimeout(() => { pushing = false }, 1200)
  const map = rootEl.querySelector('doxa-research-map')
  if (map) {
    let cfg = {}
    try { cfg = JSON.parse(map.getAttribute('profile-config') || '{}') } catch (_) { cfg = {} }
    cfg.externalFilters = { region: linked.region.value, religion: linked.religion, language: linked.language.label, fitSlugs: gridSlugs.value }
    // ★ AND THE LOCALE. This rewrote the FILTERS and nothing else, so a live language switch moved
    // the composite's own chrome and never reached the panes: the outer element got the new
    // profile-config, this re-parsed the child's EXISTING attribute, and the boot `lang` survived
    // every push. MEASURED: the map stayed English on a live en->ar switch while the composite
    // around it changed. The leaf's own chain is fully reactive and was never at fault — it is
    // reactive to its own prop, and its prop was frozen.
    // BOTH KEYS, and `locale` is the one that decides. Every reader takes locale FIRST and falls
    // back to lang — ProfileLoader.vue:189 and people-groups-grid.vue:273/380 all read
    // `config.locale || config.lang`. Writing only `lang` is therefore correct exactly while no
    // child config carries a `locale`, and silently stops working the day one does: a stale locale
    // from a boot copy or a host-list path would shadow every fresh lang we push, forever. Writing
    // both keeps the two in step whatever put them there.
    if (hostLang.value) { cfg.lang = hostLang.value; cfg.locale = hostLang.value }
    map.setAttribute('profile-config', JSON.stringify(cfg))
  }
  const grid = rootEl.querySelector('people-groups-grid')
  if (grid) {
    grid.setAttribute('wagf-region', linked.region.value)
    grid.setAttribute('religion-family', linked.religion)
    // ★ THE CODE, NOT THE NAME. valueMatches compares the normalized value as well as the label,
    // so a stable ISO code matches in every locale while a display name only matches in the one it
    // was fetched in.
    grid.setAttribute('primary-language', gridLanguage())
    // The grid's three linked facets travel as their own attributes, but its LANGUAGE does not —
    // it reads that from profile-config, which this composite set only when a host list was
    // supplied, and never again. Same frozen-prop defect as the map above, one channel over.
    if (hostLang.value) {
      let gcfg = {}
      try { gcfg = JSON.parse(grid.getAttribute('profile-config') || '{}') } catch (_) { gcfg = {} }
      if (gcfg.lang !== hostLang.value || gcfg.locale !== hostLang.value) {
        gcfg.lang = hostLang.value
        gcfg.locale = hostLang.value
        grid.setAttribute('profile-config', JSON.stringify(gcfg))
      }
    }
  }
}
// A locale change has to reach the panes too; `linked` and `gridSlugs` only cover filter state.
watch(hostLang, pushToChildren)
watch(linked, pushToChildren, { deep: true })
// The slug set changes without any facet changing (a search term, a cleared filter), so it needs
// its own trigger — `linked` alone would leave the camera behind.
watch(gridSlugs, pushToChildren)

onMounted(() => {
  rootEl = getCurrentInstance()?.proxy?.$el?.getRootNode?.() || null
  rootEl?.addEventListener?.('groups-filtered', onGridFiltered)
  rootEl?.addEventListener?.('map-filtered', onMapFiltered)
  // After the first layout, so the host page's header has its height.
  requestAnimationFrame(sizeBand)
  window.addEventListener('resize', onBandResize)
})
onBeforeUnmount(() => {
  rootEl?.removeEventListener?.('groups-filtered', onGridFiltered)
  rootEl?.removeEventListener?.('map-filtered', onMapFiltered)
  window.removeEventListener('resize', onBandResize)
})

const sections = computed(() => [
  // No section title: the research map self-titles through its own chrome, so a StackLayout title
  // here would render the name twice — the duplicate-header bug rejected on the desktop
  // sibling (BUG-RESEARCH-DASHBOARD-HEADER-STACK-WRONG). One header per element.
  {
    key: 'map',
    element: 'doxa-research-map',
    src: bundleSrc('doxa-research-map', 'doxa-research-map'),
    // ★ profile-config IS MANDATORY FOR THIS CHILD, and omitting it was a real shipped defect
    // (found + fixed 2026-09-22 by READING the regenerated README screenshot, not by any gate).
    // doxa-research-map does not mount a component directly — its bundle entry mounts ProfileLoader,
    // which reads profile-config.profile to decide WHICH .vue in that bundle to load. With no
    // profile-config the element still MOUNTS and still reports its tag, so a deep walk counting
    // tags says "both children present" — but ProfileLoader renders its error state instead of the
    // map: "doxa-map: missing or invalid profile-config prop". The composite shipped with a broken
    // top half that every structural check passed.
    //
    // The shape below is copied from what the bundle's OWN generated leaf page sets (its
    // BASE_CONFIG), so this composite and the standalone leaf ask for the identical thing.
    // assetsBase is '../../assets' because this composite's leaf is served two levels deep, exactly
    // as the research map's own leaf is — same depth, same prefix.
    //
    // NOTE the grid child needs none of this: people-groups-grid mounts its component directly and
    // has no profile registry. "One child needs it" is not "both do", which is why the omission was
    // easy to miss.
    // ★ shareUrl: SHARE THIS COMPOSITE, NOT THE CHILD (BUG-SHARE-FROM-CAP4-COMPOSITE-LINKS-TO-ITS-
    // NESTED-CHILD, same defect found and fixed on the desktop sibling dashboard-plus-grid).
    // MEASURED here with share-roundtrip-smoke --browser chromium: this composite emitted
    // .../doxa-research-map/research-map/index.html and the gate reported "share URL reopened
    // <doxa-research-map>, not <research-map-plus-grid>". A recipient got the map alone and lost
    // the grid half.
    //
    // It has to be tier 1 (`shareUrl`), not tier 2 (`shareEmbedPath`): resolveShareUrl's ladder is
    // `embedPath || cfg?.shareEmbedPath`, and this child hardcodes a prop —
    // research-map.vue:2149 `:embed-path="'doxa-research-map/research-map/index.html'"` — so a prop
    // always outranks host config and tier 2 is unreachable from here. Tier 1 is documented as "a
    // WHOLE url the HOST supplies wins", which is exactly this situation.
    //
    // SHARE_URL is absolute and computed at the top of this file — see the note there for why a
    // relative value would pass the gate and still break the embed snippet.
    attrs: {
      'profile-config': JSON.stringify({
        profile: 'research-map',
        dataSource: 'pray-tools',
        instanceId: 'rmpg-research-map',
        // ★ NO FLY/CLUSTER TOOLBAR IN THE COMPOSITE (decided 2026-09-23).
        // LegendTools renders at top:14px centred on the legend column — the search bar's exact
        // slot — so on the Regions and Languages tabs (the legendTypes its predicate allows) it
        // reads as having REPLACED the search bar. In a stack whose bottom half is a grid the
        // reader is scanning, a fly-tour that moves the camera underneath fights the other half.
        // The standalone leaf keeps both; this is a per-host decision, which is why it is config.
        legendTools: false,
        // Thread the host's token through to the child. Spread so a host that supplies none
        // leaves the key ABSENT rather than empty: ProfileLoader's ladder is `config.tk ||
        // sharedToken`, and an empty string would be falsy anyway, but an absent key keeps the
        // child's own config identical to what its standalone leaf sets.
        ...(hostToken.value ? { tk: hostToken.value } : {}),
        ...(hostTokenUrl.value ? { tokenUrl: hostTokenUrl.value } : {}),
        ...(hostProvider.value ? { provider: hostProvider.value } : {}),
        ...(hostLang.value ? { lang: hostLang.value } : {}),
        ...(hostList.value ? { list: hostList.value } : {}),
        // The host's name for this map (the gallery's tab label), for the map-print header (mapPrintTemplate.js).
        ...(hostConfig.value?.mapTitle ? { mapTitle: hostConfig.value.mapTitle } : {}),
        // The composite's filter state, in the map's inbound shape. Absent keys are ignored there.
        externalFilters: { region: linked.region.value, religion: linked.religion, language: linked.language.label, fitSlugs: gridSlugs.value },
        assetsBase: '../../assets',
        shareUrl: SHARE_URL
      })
    },
    minHeight: MAP_H,
    maxHeight: MAP_H
  },
  // No title/sub on the grid either (BUILD-BIGPIC-DROP-REDUNDANT-SECTION-HEADERS): StackLayout only
  // renders .stl-sec-head when `title` is set, so omitting it removes the strip entirely.
  //
  // attrs = "props in advance" — set on the element BEFORE it mounts, per the StackLayout contract.
  // These three are written out EXPLICITLY even though true is the component's own default, so the
  // contrast with the desktop sibling is readable at the call site and a future default change
  // cannot silently strip the mobile controls. show-total stays on because, unlike the desktop
  // composite, no table above reports the count — this is the only total on the page.
  {
    key: 'grid',
    element: 'people-groups-grid',
    src: bundleSrc('people-groups-grid', 'people-groups-grid'),
    attrs: {
      'show-search': 'true', 'show-filters': 'true', 'show-total': 'true',
      ...(hostList.value ? { 'profile-config': JSON.stringify({ list: hostList.value }) } : {}),
      // The grid already accepts these as INPUTS (its header documents countryCode for exactly this
      // reason); driving them from the composite is the same channel, not a new one.
      'wagf-region': linked.region.value,
      'religion-family': linked.religion,
      'primary-language': gridLanguage(),
    }
  }
])
</script>

<template>
  <!-- No `title` and no #meta: StackLayout omits its own top bar entirely when neither is used, so
       the composite shows ONLY the nested elements' own chrome. -->
  <StackLayout :sections="sections" />
</template>

<style>
:host { display:block; width:100%; }
</style>
