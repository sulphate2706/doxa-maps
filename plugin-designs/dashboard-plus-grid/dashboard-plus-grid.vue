<script setup>
/**
 * dashboard-plus-grid.vue — Capability-4 composite: research-dashboard + people-groups-grid
 * BAKED INTO ONE self-contained element, stacked to scroll.
 *
 * @element dashboard-plus-grid
 * @description Both children are IMPORTED DIRECTLY (compiled into this ONE bundle — no runtime bundle
 *   injection, unlike stack-demo which pulls them via `src`). They render STACKED top-to-bottom via the
 *   shared StackLayout, so the host page scrolls through the rich Research Dashboard (facets + map +
 *   charts + table) and then the People Groups grid (live pray.doxa.life) as one continuous element.
 *   This is the "two elements baked together into one" element — embed <dashboard-plus-grid> anywhere.
 *
 * Same "import the REAL components, no fork" discipline as big-picture: the grid is the exact
 * people-groups-grid component; the dashboard is the exact research-dashboard component.
 */
import { reactive, provide, inject, ref, computed, watchEffect, watch, onMounted, getCurrentInstance } from 'vue'
import { SUPPORTED_LOCALES, RTL_LOCALES, setRuntimeLocale, getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
import { absoluteEmbedUrl } from '@map/utils/embedBase.js'
import { useSharedMapToken, publishMapToken } from '@map/composables/useSharedMapToken.js'
import { useHostTokenUrl } from '@map/composables/useHostTokenUrl.js'
import StackLayout from '@map/layouts/StackLayout.vue'
import LargerScreenNotice from '@map/components/LargerScreenNotice.vue'
import { useScreenGate } from '@map/composables/useScreenGate.js'
import ResearchDashboard from '../research-dashboard/research-dashboard.vue'
import PeopleGroupsGrid from '../people-groups-grid/people-groups-grid.vue'

// ★ THE HOST'S INLINE STYLE MUST NOT LAND ON OUR ROOT.
// This SFC is mounted AS a custom element, so a style attribute the HOST page puts on the tag falls
// through onto this component's root element. MEASURED 2026-09-25 with a host style of
// "display:flex; position:relative; height:100%": that exact string appeared verbatim on the inner
// root div of this component — the gallery sets one on every tab, and on the Prayer Walk Planner
// the same fallthrough collapsed the plugin to 76px. The element's own :host rules are the contract
// for how it sizes itself; a host styling the TAG is styling the box, not our internals.
defineOptions({ inheritAttrs: false })


// ── THE DASHBOARD → GRID LINK ────────────────────────────────────────────────────────────
// THE BUG THIS FIXES (reported from use; measured 2026-09-22). Selecting anything in the
// dashboard above did not filter the grid below. Measured: the dashboard reacted every time
// (rows 22→21 on search, 21→6 on the "Ethnoreligion" facet, 6→12 on a row select) while the
// grid stayed at a byte-identical 24 cards. Row COUNT alone would have been an ambiguous
// signal here — 24 is the grid's page size, so a correct re-filter can also read 24 — which is
// why the diagnosis rests on the row IDENTITY fingerprint being unchanged too.
//
// NEITHER HALF WAS BROKEN; THE LINK WAS ABSENT. The grid's receiving end already works
// (people-groups-grid.vue declares the filter props in defineProps and watches them all), and the dashboard
// now emits (`dashboard-filter`). This handler is the translation layer between them, because
// the two speak different vocabularies: the dashboard's bus keys are snake_case facet names
// from dashboard.config.js, the grid's props are camelCase.
//
// NOT EVERY DASHBOARD FACET MAPS. The config defines religion, religion_family, wagf_region,
// wagf_block, country_code, engagement_status, language_family, primary_language, affinity_bloc,
// cluster and people_group (plus rop1_name, a search-only projection that is not an axis at all)
// — but the grid accepts only its declared props. The unmapped ones are DROPPED rather
// than guessed at: pushing a value into a prop the grid filters differently would silently
// show the WRONG rows, which is worse than the honest current behaviour of not narrowing on
// that axis. Widening this map means adding real props to the grid first.
//
// ★ THE WORKED EXAMPLE, so the next author does not "helpfully" add the obvious-looking line.
// `religion_family` is NOT `religion`, even though the names invite it. Measured: clicking the
// facet "Hinduism 693" sets filterSet.religion_family = "Hinduism" (a family NAME, derived in
// dashboard.config.js from the FIRST LETTER of the religion code). The grid's `religion` prop
// matches the religion CODE/value (people-groups-grid.vue: propFilters → valueMatches). Mapping family→religion
// would compare "Hinduism" against codes and filter the grid to ZERO rows — a broken screen
// that looks like a data bug. A real religion_family filter needs a matching prop on the grid.
//
// ★ COUNTRY WAS THE FIFTH TO EARN ITS MAPPING (reported from use 2026-09-22: "when I click on
// India in the top countries nothing happens and the people groups grid just stays the same").
// That report was correct, and the cause was this map: `country_code` was one of the eight
// dropped facets, so the "Top countries" chart had no prop to reach and the grid could not
// react. The fix was NOT to guess a mapping — it was to add a real `countryCode` prop to the
// grid first, then map onto it, which is the procedure the paragraph above prescribes.
//
// It passes the same test religion_family FAILS. The test is "does the facet filter over the
// SAME field as the prop?":
//   religion_family → DERIVED (first letter of the religion code → "Hinduism"); no such field
//                     exists on a row. Still dropped.
//   country_code    → dashboard.config.js:80 is `get: (r) => lbl(r.country_code)`, the label of
//                     the very field the grid's filter reads. Same field, same rows.
// The label-vs-value gap that remains ("India" here, "IND" in the row) is absorbed by the
// grid's shared valueMatches() normaliser, which compares against value AND label. Verified on
// the live 2,107 rows: 175 countries, 100% populated, and zero normalisation collisions between
// any two of them. Seven facets remain deliberately unmapped, on the same rule.
// ★ THE TREE'S OWN AXES EARN THEIR MAPPINGS (card BUG-SEMANTIC-TREE-SIDEBAR-NOT-INTEROPERABLE-
// WITH-GRID). Reported from use: "the people place language, religion sidebar… is not working with
// interoperability between itself and with the people groups grid beneath it." Part of that was
// an affordance bug in the rail (fixed there), but part was real: the rail's People and Language
// trees filter on facet keys that had NO entry here, so a perfectly correct click could not
// narrow the grid. Each addition below was measured against the SAME field test, on the live
// 2,107 rows (2026-09-22) — never guessed.
//
//   affinity_bloc     -> rop1        SAFE, and it needs NO new prop. dashboard.config.js reads it
//                                    as code(r.rop1) — the CODE ('A008') of the very field the
//                                    grid's existing rop1 filter indexes (u.rop1). valueMatches()
//                                    compares the selection against value AND label, so either
//                                    spelling selects the same rows. Measured: 16 distinct blocs,
//                                    0 normalisation collisions on either side. This is the
//                                    country_code case exactly — same field, only the spelling
//                                    differs. (It once had a sibling facet `rop1` holding the
//                                    LABEL of the same object; that duplicate axis is gone — see
//                                    the FACET_TO_PROP note below.)
//   engagement_status -> engagement  SAFE. `get: (r) => lbl(r.engagement_status)` is the label of
//                                    u.engagement_status, already in the grid's fetch, a
//                                    {value,label} pair on 100% of rows. 2 distinct values, 0
//                                    collisions. Needs a new prop (added on the grid first).
//   primary_language  -> primaryLang SAFE WITH ONE MEASURED CAVEAT. `get: (r) =>
//                                    lbl(r.primary_language)` is the label of u.primary_language —
//                                    same field, nothing derived, 100% populated, 863 distinct.
//                                    The field was NOT in the grid's fetch list, so it was added
//                                    there (a missing field would have matched u.primary_language
//                                    === undefined and filtered to ZERO — the religion_family
//                                    failure arriving by a different route).
//                                    ★ THE CAVEAT, recorded rather than hidden: norm() strips case
//                                    and [\s_&-], and across all 863 values+labels there is
//                                    exactly ONE cross-collision — ISO code 'yom' (Yombe) vs the
//                                    LABEL 'Yom' (code 'pil'). Selecting the language "Yom" also
//                                    admits Yombe rows. One over-match in 863 is a far better
//                                    outcome than an axis that cannot filter at all, but it is a
//                                    real (small) imprecision, not a clean pass like country's
//                                    measured zero.
//
// STILL DELIBERATELY UNMAPPED, on the same rule that keeps religion_family out:
//   language_family — DERIVED. dashboard.config.js falls back to a langFamilyByIso lookup over
//                     the ISO code, so for 96% of rows the value exists on NO field of the row.
//                     There is nothing for a prop to compare against. Needs a real grid-side
//                     derivation before it could ever be mapped.
//   religion_family — DERIVED (first letter of the religion code -> "Hinduism"). The original
//                     worked example below; unchanged.
//   cluster / people_group — the fields (imb_reg_of_people_2 / _25) are real and collision-free,
//                     but they are NOT in the grid's fetch and each would need its own prop plus a
//                     widened field list. Left for a follow-up rather than bundled in here: they
//                     are the two DEEPEST tiers of the People tree, so they only become reachable
//                     after a user has already drilled twice, and the shallow tiers above them now
//                     work. Mapping them is mechanical, not risky — it is simply not yet measured.
const FACET_TO_PROP = {
  wagf_region:      'wagfRegion',
  wagf_block:       'wagfBlock',
  // THE People axis. There used to be a second entry here — facet key `rop1` — also pointing at
  // this prop, because the dashboard registered the People axis TWICE (a code facet for the tree,
  // a label facet for the dropdown). Collapsing both onto one prop is what made the GRID behave
  // correctly while the dashboard's own header still showed two rival controls, which is how the
  // defect survived: a downstream adapter masked half of it. The duplicate facet is now gone at
  // the source (dashboard.config.js), so ONE entry is both sufficient and honest.
  // Value is the bloc CODE ('A012'); the grid's valueMatches() compares against value AND label,
  // so it selects the same rows either spelling arrives in.
  affinity_bloc:    'rop1',
  religion:         'religion',
  country_code:     'countryCode',
  primary_language: 'primaryLanguage',
  engagement_status: 'engagementStatus',
    // The two DEEPEST tree tiers. Their row fields are imb_reg_of_people_2 / _25, which the grid did
    // not fetch — so these changed the dashboard correctly and could never move the grid. Verified
    // live before mapping (2,107 rows): both present on 2106, both {value,label}, 194 and 1736
    // distinct values, ZERO collisions after normalisation and ZERO label-vs-value cross-collisions.
    // Unlike language_family / religion_family, which are DERIVED and stay unmapped, these are real
    // fields that only needed asking for.
    cluster:          'cluster',
    people_group:     'peopleGroup',
    // THE PHASES OF ENGAGEMENT (row field imb_gsec). Mapped from the day it was added, because
    // shipping a facet that narrows the dashboard and cannot move the grid is precisely the
    // dead-button class marked `dashboardOnly` elsewhere in this file — and this one has no reason
    // to join it: imb_gsec is a real row field with 5 {value,label} pairs and no value-vs-label
    // cross-collision, so valueMatches() selects the same rows whichever vocabulary arrives.
    gospel_access:    'gospelAccess',
    // ── THE TWO FORMERLY-DERIVED-ONLY AXES, wired at last (2026-09-23) ──
    // These were the "STILL DELIBERATELY UNMAPPED" pair above: their values are DERIVED
    // ("Hinduism" from the religion code's first letter; "Indo-European" from the
    // imb_language_family label or the ISO lookup), so no fetched row field could match them
    // and mapping them would have filtered the grid to ZERO. The grid now runs the SAME
    // derivations itself (people-groups-grid.vue DERIVED_AXES, importing the same @map/colors
    // + @map/data modules dashboard.config.js reads), so the value the dashboard emits and the
    // value the grid derives come from one owner and byte-match. With that in place, the top
    // tiers of the Religion and Language trees drive the grid like every other axis.
    religion_family:  'religionFamily',
    language_family:  'languageFamily',
}

// Empty string (not null) is the grid's documented "no filter" value for every axis, so a
// cleared facet must RESET its prop rather than leave the previous value stuck.
const filter = reactive({ query: '', wagfRegion: '', wagfBlock: '', rop1: '', religion: '', countryCode: '',
  primaryLanguage: '', engagementStatus: '', cluster: '', peopleGroup: '', gospelAccess: '',
  religionFamily: '', languageFamily: '' })

function onDashboardFilter({ filterSet = {}, searchTerm = '' } = {}) {
  filter.query = searchTerm || ''
  for (const prop of Object.values(FACET_TO_PROP)) filter[prop] = ''
  for (const [facetKey, value] of Object.entries(filterSet)) {
    const prop = FACET_TO_PROP[facetKey]
    if (prop) filter[prop] = value == null ? '' : String(value)
  }
}

// (The one-screen DASHBOARD_H constant that used to live here is gone with the height pin — see the
// section note below. Its reasoning was sound and is preserved there; it is the map row, not the
// whole band, that now carries an explicit height, via --rd-map-h in page-scroll mode.)

// Two host-rendered sections (no `element`/`src` — the components are baked in, so we render them
// through StackLayout's per-section slots instead of the imperative element-mount path).
// ★ ASK THE DASHBOARD FOR ITS PAGE-SCROLL LAYOUT (BUG-CANNOT-SCROLL-DOWN-TO-THE-GRID).
// research-dashboard reads inject('profileConfig') — the same channel ProfileLoader uses for the
// profile-config attribute on a standalone embed. Providing it here is how this composite opts in
// without a prop (a prop on that component would never be populated; see its own note).
//
// WHY: the dashboard is a fixed-viewport app whose table scrolls internally. Pinned to one screen
// inside a scroll page, that table became a ~269px window over 54834px of rows and captured every
// wheel event in the lower third of the band — measured, the same gesture moved the page 2311px
// lower down but only 300px over the dashboard, so the grid below was unreachable. In page-scroll
// mode the table renders at full height and the PAGE carries it, leaving nothing under the cursor
// to compete for the wheel.
// ★ AND TELL IT WHAT TO SHARE (BUG-SHARE-FROM-COMPOSITE-LINKS-TO-THE-CHILD).
// The nested dashboard's own DashboardTopBar owns the Share button, and inside this composite that
// button had no idea it was a passenger: with no shareEmbedPath it fell through ShareButton's
// ladder to tier 3, "the page's own location", which for a baked-in child resolves to the CHILD's
// standalone page. MEASURED with `share-roundtrip-smoke --browser chromium`: sharing from
// dashboard-plus-grid produced .../research-dashboard/research-dashboard/index.html, and the gate
// caught it exactly — "share URL reopened <research-dashboard-map>, not <dashboard-plus-grid>".
// A recipient got the inner dashboard ALONE, silently losing the grid half of the composite.
//
// ★ IT MUST BE TIER 1 (`shareUrl`), NOT TIER 2 — measured, after tier 2 silently did nothing.
// resolveShareUrl's ladder is `embedPath || cfg?.shareEmbedPath`, and the nested dashboard passes
// an explicit prop: <ShareButton :embed-path="SHARE_EMBED_PATH" /> in DashboardTopBar.vue:324.
// A prop always beats host config, so shareEmbedPath here was unreachable and the rebuilt bundle
// failed the gate identically. Tier 1 is the only rung that outranks a child that has already made
// up its mind — which is exactly what its docs say it is for: "a WHOLE url the HOST supplies wins".
//
// Tier 1 takes a whole url, so it is COMPUTED rather than hardcoded: resolveEmbedBase() is the same
// helper ShareButton uses (profileConfig.embedBaseUrl → window.MAP_EMBED_BASE_URL → the root the
// built bundle derives from its own script url), so the link stays correct on doxa.life, on
// the live test host and in a dropped tree with no configuration. Hardcoding an absolute url here would
// pin every share to whichever host happened to build it.
//
// Note this is exactly the two-host defect class: research-dashboard standalone PASSES the same
// gate (1/1, verified this tick), and the identical component inside this composite FAILED. Only a
// gate that drives BOTH hosts can tell those apart, which is why the composite is now a target.
// ★ THE HOST'S OWN profile-config, WHICH THIS COMPOSITE USED TO THROW AWAY.
// It declared no props, so a partner's <dashboard-plus-grid profile-config='{"tk":"..."}'> lost its
// token entirely. MEASURED on a third-party origin before this: 'No Mapbox access token provided',
// 0 style and 0 tile requests to api.mapbox.com, no canvas — the JS embed, one of the two shipped
// embed methods, mounted a dashboard whose map could not draw. Our own leaf hides it, because that
// page carries a BAKED token; the failure exists only where there is no leaf, which is exactly the
// partner case. Same defect and same shape as research-map-plus-grid.
const props = defineProps({
  /** The host's JSON config, exactly as the embed snippet writes it. */
  profileConfig: { type: [String, Object], default: null },
})
const hostConfig = computed(() => {
  const raw = props.profileConfig
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  // A malformed attribute must not take the element down with it.
  try { return JSON.parse(raw) } catch { return {} }
})
const hostToken = computed(() => {
  const tk = hostConfig.value?.tk
  return typeof tk === 'string' && tk ? tk : ''
})
if (hostToken.value) publishMapToken(hostToken.value)

// ★ THE PHONE RULE, HERE AS WELL. This element is defined without ProfileLoader (it bakes its children
// in), so the leaf's "mobile": "desktop-only" reached its profile-config and nothing read it: at 390px the
// dashboard and the grid mounted anyway. useScreenGate is the same rule ProfileLoader applies.
const { blocked: screenBlocked, advise: screenAdvise, dismiss: screenDismiss, label: screenLabel } = useScreenGate(hostConfig)

// The provider is a host knob as well: resolveMapProvider reads profile-config.provider, and the
// config the child sees is the one provided below. Dropping it left a host that asked for maplibre
// on mapbox — demanding a token for the one configuration that exists to need none.
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
// ★ AND SOMEBODY HAS TO ACT ON IT. This composite BAKES its children in rather than mounting them
// by tag, so there is no ProfileLoader anywhere beneath it — and ProfileLoader is the only thing in
// the tree that turns a config locale into an actual i18n locale (ProfileLoader.vue: it watches
// `config.locale || config.lang` and drives appI18n.global.locale). MEASURED with studio's
// check:host-locale-contract: this leaf answered 0 Arabic strings against a reference of 1,891 —
// not because the catalogue was missing and not because appI18n was absent (index.js provides it),
// but because nothing ever told it which language the host asked for. Its sibling composite passes
// the same gate untouched, because it mounts children by tag and each child brings its own loader.
const hostLang = computed(() => {
  const l = String(hostConfig.value?.lang || hostConfig.value?.locale || '').split('-')[0].toLowerCase()
  return SUPPORTED_LOCALES.includes(l) ? l : ''
})
watchEffect(() => { if (hostLang.value) setRuntimeLocale(hostLang.value) })

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
// ★ WE CLEAR ONLY THE DIRECTION WE SET. This was a one-way `if (rtl) setAttribute` with no else,
// so ar -> zh kept a right-to-left layout for the rest of the session. The host page's own dir is
// still respected: the value found before we first wrote is restored verbatim.
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

// ★ AND PROVIDE IT THE WAY ProfileLoader WOULD. This composite bakes its children in rather than
// mounting them through ProfileLoader, and ProfileLoader is the ONLY provider of 'mapboxToken' in
// the repo — so DashboardMapPanel's inject('mapboxToken', ref('')) fell through to its empty
// default here. The shared page token keeps a late-arriving token working (the leaf FETCHES one),
// which is what the composable exists for; the host's own tk still wins.
const sharedToken = useSharedMapToken()
// ★ tokenUrl: A TOKEN SERVICE, NOT A TOKEN, AND ONLY ProfileLoader EVER READ IT (PM-tok). A host may
// name a URL to ASK for a key instead of pasting one. This composite bakes its children in rather than
// mounting them through ProfileLoader, so embedded BARE — one tag on a partner's page, which is the
// entire point of a composite — a tokenUrl-only config reached nobody: no token, "No Mapbox access
// token provided", 0 tiles, no canvas. With an outer ProfileLoader on the page it worked, because THAT
// fetched and published; the composite was passing an exam somebody else sat. The failure also wears
// the wrong face: it is identical to a missing `tk`, which IS threaded, so it reads as a host typo.
// Forwarded to the children too, so a child that outlives this fetch can still ask.
const hostTokenUrl = useHostTokenUrl(hostConfig, hostToken)

const mapboxToken = computed(() => hostToken.value || sharedToken.value || '')
provide('mapboxToken', mapboxToken)

// The host's people-group LIST (library/lists/), threaded like the engine: into the dashboard's
// provided config below, and into the grid's profile-config.
const hostList = computed(() => (typeof hostConfig.value?.list === 'string' ? hostConfig.value.list : ''))
// ★ AND THE HOST'S LANGUAGE, under both keys because each reader prefers one. The grid is mounted as
// a COMPONENT, so it shares this element's host, and its reflectDir writes onto Big Picture itself.
// Given no locale here, its language fell through to the page URL. On an English page opened with
// ?lang=ar, the grid set rtl on the whole of Big Picture, so English was laid out backwards
// (measured 2026-09-29 on the Deep Research page, before and after the dir-clear alike).
const gridConfig = computed(() => {
  const c = {}
  if (hostList.value) c.list = hostList.value
  if (hostLang.value) { c.locale = hostLang.value; c.lang = hostLang.value }
  return Object.keys(c).length ? JSON.stringify(c) : ''
})

const SHARE_LEAF = 'dashboard-plus-grid/dashboard-plus-grid/index.html'

provide('profileConfig', computed(() => ({
  profile: 'research-dashboard',
  layout: 'page-scroll',
  // Absolute wherever this lands: a relative share url works when CLICKED (the browser resolves it
  // against this page) and 404s when EMBEDDED (a partner's iframe resolves it against theirs).
  shareUrl: absoluteEmbedUrl(SHARE_LEAF),
  // Spread last so a host that supplies none leaves the key absent, and never overwrite the two
  // settings above — those are this composite's own layout and share decisions, not the host's.
  ...(hostToken.value ? { tk: hostToken.value } : {}),
  ...(hostTokenUrl.value ? { tokenUrl: hostTokenUrl.value } : {}),
  ...(hostProvider.value ? { provider: hostProvider.value } : {}),
  ...(hostLang.value ? { lang: hostLang.value } : {}),
  ...(hostList.value ? { list: hostList.value } : {}),
})))

const appI18n = inject('appI18n', null)
watchEffect(() => { if (hostLang.value && appI18n) appI18n.global.locale.value = hostLang.value })

const sections = [
  // The research-dashboard leaf SELF-TITLES (its own DashboardTopBar renders a "Research Dashboard"
  // title bar), so a StackLayout section title here would be a DUPLICATE — it was seen as "Research
  // Dashboard" twice. Omit title (and sub, which StackLayout only shows alongside a title) → the leaf's
  // own header is the single source of truth for this section. See BUG-RESEARCH-DASHBOARD-HEADER-STACK-WRONG.
  //
  // BUG-DASHBOARD-CANT-SCROLL-DOWN: the research-dashboard is a FIXED-VIEWPORT app — its shell is a CSS
  // grid with `height:100%` and a `1fr` map-hero plus inner-scroll (overflow:auto/hidden) regions. When
  // it renders in a scroll-page section with NO definite height, `height:100%` collapses to its 560px
  // floor and its inner-scroll regions swallow the wheel, so the OUTER page never grows past it → the
  // it was impossible to scroll down to the grid. Fix: give this section a definite ONE-SCREEN height
  // (minHeight === maxHeight below via the composite's `dashboardHeight`). The `1fr` map now has real
  // height to fill, the dashboard is one clean scroll-page band, and the PAGE grows below it so the grid
  // is reachable by page scroll. `overflow:hidden` on the section keeps the dashboard's own inner scroll
  // (map/table/facets) from leaking a section scrollbar — the page owns the scroll, per the StackLayout
  // contract.
  // ★ NO LONGER PINNED. The min===max pin above solved a REAL defect — without a definite height
  // the dashboard's height:100% collapsed to its 560px min-height and the 1fr map row had nothing
  // to fill. But the pin is what forced the table into a ~269px keyhole that then owned the wheel.
  // page-scroll mode solves the same original defect differently: the map row gets an explicit
  // height (--rd-map-h) so it cannot collapse, and the table sizes to its rows. The section is free
  // to be as tall as its content, which is what makes the page scroll past it.
  { key: 'dashboard' },
  // NO section title/sub (BUILD-BIGPIC-DROP-REDUNDANT-SECTION-HEADERS). There must not be a
  // black element header that repeats the element's name or tells them to scroll — one header per
  // element, not two. StackLayout only renders .stl-sec-head when `title` is set, so omitting it
  // removes the strip entirely. The dashboard self-titles; the grid needs no label to be legible.
  { key: 'grid' }
]
</script>

<template>
  <!-- No `title` and no #meta: the layout's own top bar is omitted entirely when neither is used,
       so the composite shows ONLY the nested elements' own chrome. -->
  <LargerScreenNotice v-if="screenBlocked" mode="desktop-only" :label="screenLabel" :locale="hostConfig.locale || ''" />
  <LargerScreenNotice v-else-if="screenAdvise" mode="larger-screens" :locale="hostConfig.locale || ''" @dismiss="screenDismiss" />
  <StackLayout v-if="!screenBlocked" :sections="sections">
    <template #section-dashboard>
      <ResearchDashboard @dashboard-filter="onDashboardFilter" />
    </template>
    <template #section-grid>
      <!-- NO explainer line here. An earlier attempt added one as its own <p>, which was
           correctly rejected: it created a SECOND header and re-introduced the vertical gap between
           the dashboard and the grid that we had just removed. The hint belongs INSIDE the table's
           existing header bar — centred, beside the live count — so it costs zero extra height.
           See DashboardDataTable's .rd-table-bar. -->
      <!-- The grid is DRIVEN by the research dashboard above it: the dashboard's header owns the
           search + filters, so the grid hides its own duplicates and takes external filter props.
           (BUILD-BIGPIC-GRID-DRIVEN-BY-DASHBOARD-PROPS-EVENTS.) -->
      <!-- show-total=false: the table above already reports the count twice (its bar and its Σ
           footer), and the grid's own "Total:" line rendered 38px below the footer's
           "Σ 2,107 groups" — the same number twice in adjacent rows. The grid keeps the line
           when embedded ALONE, where it is the only total. -->
      <PeopleGroupsGrid
        :query="filter.query"
        :wagf-region="filter.wagfRegion"
        :wagf-block="filter.wagfBlock"
        :rop1="filter.rop1"
        :religion="filter.religion"
        :country-code="filter.countryCode"
        :primary-language="filter.primaryLanguage"
        :engagement-status="filter.engagementStatus"
        :cluster="filter.cluster"
        :people-group="filter.peopleGroup"
        :gospel-access="filter.gospelAccess"
        :religion-family="filter.religionFamily"
        :language-family="filter.languageFamily"
        :show-search="false" :show-filters="false" :show-total="false"
        :profile-config="gridConfig" />
    </template>
  </StackLayout>
</template>

<style>
:host { display:block; width:100%; }
</style>
