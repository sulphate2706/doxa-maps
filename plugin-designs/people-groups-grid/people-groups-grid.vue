<script setup>
/**
 * people-groups-grid.vue — the Cat-2 (prop-table / preset-element) people-groups grid.
 *
 * @description The people-groups grid as an owned custom element: card list, search and four
 *   cross-filtering dropdowns with faceted counts, served live from pray.doxa.life. Ships two
 *   presets — 'standalone' owns its own controls, 'driven' turns them off and takes filters as
 *   props from a parent header. It is the capability-2 half of the Big Picture composite.
 *
 * WHAT THIS IS
 *   A COPY-ONLY migration of the DX-life people-groups grid
 *   (root-dx-life/research-map-clean/app/components/public/UupgsList.vue) into an OWNED,
 *   self-contained doxa-maps custom element. The grid + Fuse-style search + the four
 *   dropdowns + faceted (cross-filter) counts are copied from UupgsList.vue — NOT imported
 *   from DX-life. DX-life is READ-ONLY source; nothing there is edited.
 *
 * THE CAT-2 CONTRACT (this IS the real cap-2 grid the big-picture Cat-4 composite nests)
 *   - By DEFAULT it owns its internal search box + filter dropdowns and filters itself.
 *   - `show-search` / `show-filters` ([Boolean,String], default true) TURN OFF its own
 *     controls so an external header (e.g. the Big-Picture Cat-4 shell) can drive it.
 *   - External filter props feed it when the matching control is hidden:
 *       query, wagfRegion, wagfBlock, rop1 (people-group), religion, countryCode
 *     …the four dropdown axes (Region / Block / People-Group / Religion) PLUS Country.
 *     Precedence = internal control (when shown) ELSE the incoming prop (local-else-prop).
 *
 *     ★ COUNTRY IS PROP-ONLY, NOT A FIFTH DROPDOWN. The exclusion of Country was
 *     about this element's OWN CONTROLS — it ships four dropdowns, not five, and that is
 *     unchanged (see extractFilterOptions + the filters__panel template). What is added is a
 *     `countryCode` INPUT so a host that already owns a country control (the cap-4
 *     dashboard's "Top countries" chart) can drive the grid. Nothing new is rendered.
 *   - Emits `groups-filtered` { query, activeFilters, total, slugs } on every change —
 *     BOTH a Vue emit AND a native bubbling+composed DOM CustomEvent, so a plain host page
 *     hears it when the element is embedded standalone.
 *
 * STANDALONE DEPS (injected, so it needs NO Nuxt context)
 *   - prayBaseUrl : String prop (or profile-config.prayBaseUrl) — the people-groups API host
 *                   (default https://pray.doxa.life). The fetch is the SAME endpoint DX-life uses.
 *   - languageCode: String prop — the `lang` query param.
 *   - researchUrl / selectUrl : String props — link bases for the cards.
 *   - t (i18n labels): via the `t` / profile-config.t object prop (no useI18n).
 */
import { ref, computed, watch, onMounted, onUnmounted, getCurrentInstance } from 'vue'
// SHARED search primitives (one source of truth for BOTH cap-2 grid + cap-1 dashboard).
import Fuse from '@map/components/search/fuzzy.js'
import { highlightRanges } from '@map/composables/useTextHighlight.js'
import SearchBar from '@map/components/search/SearchBar.vue'
import FilterDropdown from '@map/components/search/FilterDropdown.vue'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { formatCount } from '@map/utils/formatCount.js'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'
import { tStatic, localeFromUrl, RTL_LOCALES, getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
import { countrySlug } from './src/countries.js'
// ── DERIVED family axes (BUG-SEMANTIC-TREE-SIDEBAR-NOT-INTEROPERABLE-WITH-GRID) ──
// The Religion/Language trees' TOP TIERS emit DERIVED family names ("Hinduism",
// "Indo-European") that exist on no row field, so for months they could narrow the dashboard
// but never this grid. The fix is to run the SAME derivation here, from the SAME library
// modules the dashboard's config uses -- one owner per derivation, two consumers:
import { RELIGION_FAMILIES } from '@map/colors/religion.js'
import { canonicalFamilyName } from '@map/colors/language-family.js'
import langFamilyByIso from '@map/data/langFamilyByIso.json'
import { joinBase } from '@map/composables/joinBase.js'
import { hostElement } from '@map/utils/hostElement.js'

// ★ THE HOST'S INLINE STYLE MUST NOT LAND ON OUR ROOT.
// This SFC is mounted AS a custom element, so a style attribute the HOST page puts on the tag falls
// through onto this component's root element. MEASURED 2026-09-25 with a host style of
// "display:flex; position:relative; height:100%": that exact string appeared verbatim on the inner
// root div of this component — the gallery sets one on every tab, and on the Prayer Walk Planner
// the same fallthrough collapsed the plugin to 76px. The element's own :host rules are the contract
// for how it sizes itself; a host styling the TAG is styling the box, not our internals.
defineOptions({ inheritAttrs: false })


const props = defineProps({
  // ── injected standalone deps (replace Nuxt useRuntimeConfig / useI18n / useLocalePath) ──
  profileConfig: { type: String, default: '' },
  prayBaseUrl:   { type: String, default: '' },
  languageCode:  { type: String, default: '' },
  // ★ default '' NOT '/research/': a non-empty prop default is ALWAYS truthy, so the computed
  // below could never reach its canonical fallback -- the relative default simply moved houses
  // and kept winning (measured: bundle carried the canonical branch AND default:"/research/",
  // and every rendered link was still relative). Unset must mean unset. */
  researchUrl:   { type: String, default: '' },
  countryUrl:    { type: String, default: '' },
  selectUrl:     { type: String, default: '' },
  t:             { type: Object, default: () => ({}) },

  // ── Cat-2 contract: turn the element's OWN controls off (accept string 'false' too) ──
  showSearch:  { type: [Boolean, String], default: true },
  showFilters: { type: [Boolean, String], default: true },
  // showTotal defaults TRUE so the standalone cap-2 element is unchanged — there the count is the
  // element's ONLY row-total and must stay. A HOST that already shows one passes false.
  // MEASURED on the cap-4 composite: the same 2,107 renders FIVE times down one page — KPI (y=117),
  // KPI duplicate (y=176), table bar (y=1228), table footer 'Σ 2,107 groups' (y=1827) and this
  // 'Total: 2107' (y=1865). The last two sit 38px apart, which is the redundancy that was reported.
  showTotal:   { type: [Boolean, String], default: true },

  // ── external filter props (used when the matching internal control is hidden) ──
  //    The four dropdown axes — Region / Block / People-Group / Religion — plus Country.
  query:      { type: String, default: '' },
  wagfRegion: { type: String, default: '' },
  wagfBlock:  { type: String, default: '' },
  rop1:       { type: String, default: '' }, // "People Group" axis (rop1)
  religion:   { type: String, default: '' },

  // ★ COUNTRY — WHY IT WAS DROPPED, AND WHAT MAKES IT SAFE TO MAP NOW.
  //
  // THE BUG (reported 2026-09-22): clicking India in the top countries did nothing —
  // the people groups grid stayed the same. That was accurate and the cause was
  // NOT a wiring fault. The cap-4 composite's FACET_TO_PROP translates dashboard facet keys to
  // grid props, and it mapped only four; `country_code` was one of eight facets deliberately
  // DROPPED, on the standing rule that it is better to not narrow on an axis than to push a value
  // into a prop that filters differently and silently show the WRONG rows. With no country prop
  // to land in, a country selection had nowhere to go — so the honest fix is to add the prop
  // here FIRST, which is what this is. (See the composite's header for the rule + the
  // religion_family worked example.)
  //
  // WHY THIS ONE IS SAFE, WHERE religion_family IS NOT. The rule the composite states is: never
  // map a facet onto a prop that filters over a DIFFERENT field. Measured against that test:
  //   religion_family — dashboard.config.js DERIVES it (first letter of the religion code →
  //                     "Hinduism"). There is no `religion_family` field on a row at all, so it
  //                     could only be aimed at `religion`, which holds CODES. Different field →
  //                     unsafe → still dropped.
  //   country_code    — dashboard.config.js:80 is `get: (r) => lbl(r.country_code)`. That is the
  //                     LABEL OF THE VERY SAME FIELD this filter reads, `u.country_code`. Same
  //                     field, same 2,107 rows, nothing derived. Only the SPELLING differs.
  // So country passes the test on its merits; it is not an exception to the rule.
  //
  // THE SPELLING DIFFERENCE IS ALREADY HANDLED — see valueMatches() below. MEASURED on the live
  // API (2,107 rows, 2026-09-22): country_code is a {value,label} pair with an ALPHA-3 machine
  // value and a human label — {"value":"IND","label":"India"} — across 175 distinct countries,
  // populated on 100% of rows (zero nulls). The dashboard emits the LABEL ("India"); the row
  // stores "IND". A strict === would filter to zero, which is the same defect the label-vs-value
  // fix already addressed for region. Routing country through valueMatches() makes EITHER
  // vocabulary work: it normalises and compares against value AND label, so "India", "india" and
  // "IND" all select the same 855 rows.
  //
  // AND THE WIDENING IS NOT OVER-WIDE. norm() strips case and [\s_&-], so the fair question is
  // whether two DIFFERENT countries can collapse onto one key and over-match. Checked over all
  // 175 values and all 175 labels: ZERO collisions. Country is safe on both sides of the match.
  countryCode: { type: String, default: '' },

  // ── LANGUAGE + STATUS — the tree-rail axes, added on the SAME same-field test as country ──
  //
  // Reported 2026-09-22: the People/Place/Language/Religion tree rail was not interoperating with
  // the people groups grid beneath it. Language and Status were two of the
  // axes a click could not reach, because there was no prop for the composite's FACET_TO_PROP to
  // land a value in. As with country, the honest fix is to add the real prop HERE first.
  //
  // Both pass the test "does the facet filter over the SAME field as the prop?":
  //   primary_language  — dashboard.config.js is `get: (r) => lbl(r.primary_language)`, the LABEL
  //                       of the very field this filter reads (u.primary_language). Nothing
  //                       derived. Measured live: {value:'abf', label:'Abai Sungai'}, 863 distinct
  //                       languages, populated on 100% of 2,107 rows.
  //   engagement_status — `get: (r) => lbl(r.engagement_status)`; u.engagement_status is
  //                       {value:'unengaged', label:'Unengaged'}, 2 distinct values, 100% populated.
  //
  // ★ primary_language WAS NOT IN THIS ELEMENT'S FETCH and had to be added to the `fields=` list
  // (see getUUPGs). That gap is its own silent-zero trap: applyDropdownFilters indexes u[field]
  // directly, so an unfetched field is undefined on EVERY row and valueMatches() returns false for
  // all of them — the grid would have filtered to zero and looked like a data bug, which is the
  // exact failure mode the religion_family note warns about, reached by a different route.
  //
  // ★ AND THE ONE MEASURED IMPRECISION, recorded rather than glossed. norm() strips case and
  // [\s_&-]; across all 863 language values and labels there is exactly ONE cross-collision — ISO
  // code 'yom' (Yombe) versus the LABEL 'Yom' (whose code is 'pil'). Picking "Yom" therefore also
  // admits Yombe rows. Country could claim a measured ZERO collisions; language cannot, and saying
  // so is the point. One over-match in 863 beats an axis that cannot filter at all.
  primaryLanguage:  { type: String, default: '' },

  // ★ THE LAST TWO REACHABLE TREE AXES. The semantic tree's deepest tiers — Cluster and People Group
  // — changed the dashboard correctly but could not move the grid, because the fields they read were
  // simply not in the grid's fetch. Unlike language_family and religion_family (which are DERIVED and
  // have no matching row field at all, so they stay unmapped), these are real fields and only needed
  // asking for.
  //
  // VERIFIED AGAINST THE LIVE API BEFORE MAPPING — the standing rule is never to guess a mapping, and
  // the religion_family worked example in dashboard-plus-grid.vue shows why: a plausible-looking
  // mapping filters confidently to the WRONG rows, which is worse than not narrowing. Measured over
  // all 2,107 rows:
  //     imb_reg_of_people_2  (cluster)      present 2106/2107  {value,label}  194 distinct
  //     imb_reg_of_people_25 (people group) present 2106/2107  {value,label}  1736 distinct
  //     collisions after norm(): 0 and 0        label-vs-value cross-collisions: 0 and 0
  // Codes and labels never overlap (C0059/"Borneo-Kalimantan", 300005/"Abai Sungai"), so valueMatches
  // can accept either vocabulary without over-matching — the same property that made country_code safe.
  cluster:          { type: String, default: '' },
  peopleGroup:      { type: String, default: '' },
  engagementStatus: { type: String, default: '' },
  // ── THE PHASES OF ENGAGEMENT (imb_gsec) ──────────────────────────────────────────────────
  // `engagementStatus` above is BINARY and that is its limitation, not a bug: measured live over
  // 2,108 rows it is 2,081 Unengaged / 27 Engaged, so filtering on it separates 1.3% of the corpus
  // from the rest and tells a researcher almost nothing about WHERE a group sits.
  //
  // imb_gsec is the ordinal ladder underneath that flag, present on 2,106/2,108 as {value,label}:
  //     0     225  No Evangelicals, Churches or Resources
  //     1   1,853  Less than 2% Evangelical, No Active CP Activity
  //     2      23  Less than 2% Evangelical, Concentrated CP Activity
  //     4       4  2% or Greater but Less than 5% Evangelical
  //     6       1  10% or Greater Evangelical
  //
  // ★ WHY IT EARNS ITS OWN FILTER. Cross-tabbed against the binary flag, ALL 225 groups with NO
  // evangelicals, churches or resources — the most lost category in the data — are simply
  // "Unengaged", indistinguishable from the 1,841 groups that at least have some evangelical
  // presence. The flag cannot express the distinction the map exists to show.
  //
  // SAFE TO FILTER ON, verified the same way cluster/people_group were before they were wired:
  // 5 distinct {value,label} pairs, and the value set and label set do NOT intersect ('0' vs 'No
  // Evangelicals…'), so valueMatches() can accept either vocabulary without over-matching. This is
  // a REAL row field, unlike the derived language_family/religion_family facets, which is why it
  // can move the grid at all.
  gospelAccess:     { type: String, default: '' },
  // ── the two DERIVED family axes (no row field carries them; see DERIVED_AXES below) ──
  religionFamily:   { type: String, default: '' },
  languageFamily:   { type: String, default: '' },

  // ── presentation knobs copied from UupgsList (defaults preserve today's behaviour) ──
  perPage:      { type: Number, default: 24 },
  morePerPage:  { type: Number, default: 0 },
})

const emit = defineEmits(['groups-filtered'])

// profile-config JSON can override prayBaseUrl / languageCode / t / links (single string attr).
const cfg = computed(() => {
  if (!props.profileConfig) return {}
  try { return JSON.parse(props.profileConfig) || {} } catch { return {} }
})
// ── THE WORLD-MAP BACKDROP BEHIND THE FILTERS (requested 2026-09-24) ──────────
// An SVG world map shows under the search bar, where the toggles are.
// It is DX-life's own treatment, ported rather than reinvented: UupgsList.vue puts
// `background-image: url(<images>/worldmap.svg); background-size: 60%; background-position: top`
// on the container that wraps the search box and the toggles — a BACKGROUND, not an icon beside
// the input, which is the detail that makes the block read as a map tool instead of a form.
//
// The file (311KB) is served as a SHARED ASSET rather than inlined: a data: URI would put it in
// every bundle that imports this grid, and it is decorative. resolveAssetsBase() is the same
// helper the boundary geojson uses, so it resolves wherever the tree is dropped — CDN, sub-path,
// or the plugin studio — instead of assuming a root-relative path.
//
// Only drawn when the block actually exists: with show-search and show-filters both off there is
// no filter block to sit behind, and a backdrop with nothing on it is just noise.
const filtersBackdrop = computed(() => {
  if (!useSearch.value && !useFilters.value) return null
  const base = resolveAssetsBase(cfg.value)
  return {
    // ★ assets/images/, NOT a second copy under assets/brand/. I originally ported this file to
    // brand/; a later audit landed the SAME 311KB bytes at assets/images/worldmap.svg — DX-life's
    // own path — with a PROVENANCE record beside it explaining why no licence file accompanies it
    // (first-party artwork, no embedded credits, contrast with the OFL fonts). Two byte-identical
    // copies (md5 b7af01b3…) is 311KB of duplication and two places for the provenance to drift
    // from the asset, so this now points at the documented one and the brand/ copy is deleted.
    backgroundImage: `url(${base}/images/worldmap.svg)`,
    backgroundSize: '60%',
    backgroundPosition: 'top center',
    backgroundRepeat: 'no-repeat',
  }
})
const prayBaseUrl  = computed(() => props.prayBaseUrl || cfg.value.prayBaseUrl || 'https://pray.doxa.life')
// ★ THE URL IS A SOURCE OF TRUTH FOR THE DATA TOO, not just for the chrome.
// MEASURED at ?lang=ar and ?lang=es: this grid's CHROME translated and its DATA stayed
// English — country names, affinity names, religion labels — because the `&lang=` on the fetch was
// built from props and profile-config ONLY. A reader who asked for Arabic got Arabic buttons around
// English content, which reads as a half-finished translation rather than the wiring bug it is.
// localeFromUrl() is the library's own reader, imported rather than re-implemented, so the fetch and
// the chrome can never disagree about what the URL asked for. Same ladder regions uses
// (region-dashboards.vue:95), and a host that passes languageCode still wins.
// ⚠ ALL THREE SPELLINGS ARE IN USE AND `lang` HAS A CALLER. big-picture composes this grid and threads
// the host's locale into its profile-config as `lang` (big-picture.vue, listConfig) — it cannot reach
// this bundle any other way, because getRuntimeLocale is module state and a separately-built child gets
// its own copy. Dropping `cfg.value.lang` from this chain would leave a composed grid in the wrong
// language on a profile-config embed while ?lang= embeds carry on working, which is how it would ship.
const languageCode = computed(() =>
  props.languageCode || cfg.value.languageCode || cfg.value.locale || cfg.value.lang || localeFromUrl() || '')

// ★ RTL IS A DIRECTION, NOT A TRANSLATION — and this grid had none.
// MEASURED in ar: the cards, the total and the filter bar all laid out left-to-right around Arabic
// words. createAppI18n reflects an RTL locale onto document.documentElement, which is right for a
// page it owns and useless for an element dropped into someone else's, which is this grid's whole
// job. Set on the HOST, like both composites: `dir` takes effect through the inherited CSS
// `direction`, and inheritance crosses shadow boundaries, so one attribute turns the element and
// everything it renders. Set and CLEARED, but only ever ours — a host page that declares its own dir owns
// that decision.
const textDir = computed(() => {
  const l = languageCode.value || getRuntimeLocale() || detectLocale()
  return RTL_LOCALES.has(String(l).split('-')[0].toLowerCase()) ? 'rtl' : 'ltr'
})
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
    const host = hostEl()
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
watch(textDir, reflectDir)
// ★ ABSOLUTE CANONICAL DEFAULT. Reported 2026-09-23 from a dev server at
// /research/pitaguari/: "view more information" did not
// send a reader to the proper doxa.life page. The old default '/research/' was ROOT-RELATIVE, so it
// resolved against whatever origin happened to host the element: right on doxa.life, wrong on
// every other host -- the dev server, an iframe embed, a partner site. Same defect class as the
// ../../ child-src bug: a relative default encoding an assumption about the host.
// The shared PeopleGroupDetail already solved this exact problem (PeopleGroupDetail.vue:427):
// window.DOXA_SITE_URL override, else the absolute canonical origin. Adopting the SAME pattern
// here makes the card link and the detail panel agree on where a people group lives -- two
// surfaces, one rule. Prop and cfg still take precedence for hosts that want their own base.
const researchUrl  = computed(() => props.researchUrl || cfg.value.researchUrl
  || (((typeof window !== 'undefined' && window.DOXA_SITE_URL) || 'https://doxa.life').replace(/\/+$/, '') + '/research/'))
// ★ THE COUNTRY LINK WAS THE WRONG PAGE, not just the wrong join. It built
// `${researchUrl}../countries/<slug>`, climbing out of the research base to a /countries/ path.
// Theirs (app/components/public/UupgsList.vue:610 and :638, the component this card is ported
// from) links to localePath(`/regions/<slug>`) — a page on the host site. Same site base as
// researchUrl above, different section, and a host can override either.
const countryUrl   = computed(() => props.countryUrl || cfg.value.countryUrl
  || (((typeof window !== 'undefined' && window.DOXA_SITE_URL) || 'https://doxa.life').replace(/\/+$/, '') + '/regions/'))
const selectUrl    = computed(() => props.selectUrl || cfg.value.selectUrl || '')
// ★ EVERY LABEL IN THIS GRID WAS ENGLISH IN ALL ELEVEN LOCALES.
// The `t` object is a HOST-SUPPLIED map (the Nuxt page passes its own strings), with an English
// literal at each call site as the fallback. Nothing else ever filled it, so a reader on ?lang=ru
// got a fully Russian map with 'Search people groups…', 'Hide Filters', 'Exact', 'Load more' and
// 'Full profile' underneath it — MEASURED on the composite: every Latin-script string on that page
// belonged to this grid, the map half above it was entirely translated.
// The catalogue now carries them (locales/<loc>/grid.json) and this reads it directly rather than
// through useI18n, because this component is ALSO mounted as its own custom element by an entry
// that installs no i18n plugin — useI18n() there throws, and a thrown setup() removes the subtree
// with no build error. Order: host `t` wins (it always did), then the catalogue, then the English
// literal already at each call site, so a locale missing a key degrades to today's behaviour.
/**
 * ★ CARDS PER ROW. "Auto" is not a value — it is the ABSENCE of one, and that is the whole design.
 * The CSS that already works must not break: the grid is
 * repeat(auto-fill, minmax(240px, 1fr)), which already gives 1 column on a phone and 3-5 on a
 * desktop by measuring the container. So Auto writes NO inline style and the stylesheet is
 * untouched; only an explicit override sets grid-template-columns. A "smart" Auto that computed a
 * number and wrote it back would be the same picture until the container changed size, and then
 * silently wrong.
 *
 * ⚠ AN OVERRIDE IS HONOURED EVEN WHEN IT IS A BAD IDEA — 5 columns on a 390px phone is 62px cards.
 * That is deliberate: the reader asked. The escape is that Auto is the default and is one click
 * away, and the control says which one is active. Clamping someone's explicit choice to what we
 * think is sensible is how a control stops being trusted.
 */
const PER_ROW_OPTIONS = ['auto', '1', '2', '3', '4', '5']
const perRowKey = computed(() => `pgg-cards-per-row:${cfg.value.profile || 'default'}`)
const perRow = ref('auto')
/**
 * ★ RESTORED AT SETUP, NOT AT MOUNT, AND RE-READ IF THE KEY ARRIVES LATE.
 *
 * Restoring in onMounted runs AFTER first paint, so a returning reader who chose 2 columns saw the
 * auto layout painted and then snap — a shift suffered only by the reader whose preference we were
 * trying to honour. sr found that while deciding they could not read this value for lazy-loading,
 * which is also why it matters to them: at first paint this was 'auto' for everyone.
 *
 * But a setup-only read is the opposite bug, and sr caught that too. perRowKey is derived from
 * cfg.profile, which comes from the profile-config ATTRIBUTE, and a host can set that after the
 * element upgrades — the generated pages do createElement, setAttribute, appendChild in that order.
 * So at setup the key may still be 'default', and a setup-only read would restore the wrong
 * profile's value and never correct itself. That is the shared-key failure useDashboardLayout
 * already paid for once.
 *
 * So: read now for the first paint, and re-read if the key actually changes — but never over a
 * choice the reader has since made by hand. ONE restore path, not two.
 */
let perRowTouched = false
function restorePerRow() {
  try {
    const saved = localStorage.getItem(perRowKey.value)
    if (saved && PER_ROW_OPTIONS.includes(saved)) perRow.value = saved
  } catch (_) { /* private mode, blocked storage, or no window at all: the default is correct, not an error */ }
}
restorePerRow()
watch(perRowKey, (next, prev) => { if (next !== prev && !perRowTouched) restorePerRow() })
watch(perRow, (v) => {
  perRowTouched = true
  try { localStorage.setItem(perRowKey.value, v) } catch (_) {}
})
/** Auto contributes NOTHING, so the stylesheet keeps its own rule. */
const gridStyle = computed(() => (perRow.value === 'auto'
  ? null
  : { gridTemplateColumns: `repeat(${perRow.value}, minmax(0, 1fr))` }))

const t = computed(() => {
  const host = { ...(cfg.value.t || {}), ...(props.t || {}) }
  const locale = cfg.value.locale || cfg.value.lang || undefined
  return new Proxy(host, {
    get(target, key) {
      if (key in target) return target[key]
      if (typeof key !== 'string') return undefined
      return tStatic('grid.' + key, locale)
    },
  })
})

// ── Cat-2 show/hide (accept the DOM-attribute string 'false') ──────────────────
// How many cards can sit in the FIRST ROW at any supported width. The grid is
// repeat(auto-fill, minmax(240px, 1fr)) unless a host overrides cards-per-row, giving 1 column on a
// phone and 3-5 on a desktop — so five is the upper bound of "already on screen", not a preference.
// Deliberately a constant rather than a read of perRow: the override is the host's state and this
// only needs a SAFE CEILING. Being generous by a card or two costs a few KB; being short by one
// lazy-loads something the reader is looking at, which is the visible failure.
const EAGER_IMAGES = 5
const truthy = (v) => !(v === false || v === 'false' || v === '0' || v === 0)

// ★ THE PRESET'S KEYS WERE NEVER REACHING THESE (measured, RQ20). The "driven" preset asks for
// show-search:false and show-filters:false and the page rendered both anyway, with 0 console
// errors — because nothing was failing. ProfileLoader PROVIDES profile-config; it does not bind
// its keys as props. So props.showSearch stayed at its default of true and the preset was inert.
//
// Read the config as well as the prop, in the same prop -> cfg ladder researchUrl above already
// uses. BOTH SPELLINGS are accepted: an author writing profile-config by hand reaches for the
// kebab attribute spelling ("show-search") because that is what the docs show on the tag, while
// the prop is camel. Accepting only one is what made this silent — and a preset key that does
// nothing looks exactly like a preset key that works.
const cfgFlag = (camelKey, kebabKey) => {
  const c = cfg.value
  return c?.[camelKey] !== undefined ? c[camelKey] : c?.[kebabKey]
}
const resolveFlag = (propValue, camelKey, kebabKey) => {
  // An explicit prop on the tag still wins; otherwise the config decides; otherwise the default.
  if (propValue !== undefined && propValue !== true) return truthy(propValue)
  const fromCfg = cfgFlag(camelKey, kebabKey)
  return fromCfg === undefined ? truthy(propValue) : truthy(fromCfg)
}
const useSearch  = computed(() => resolveFlag(props.showSearch,  'showSearch',  'show-search'))
const useFilters = computed(() => resolveFlag(props.showFilters, 'showFilters', 'show-filters'))
const useTotal   = computed(() => resolveFlag(props.showTotal,   'showTotal',   'show-total'))

// ── state (copied from UupgsList) ──────────────────────────────────────────────
const uupgs = ref([])
const filteredUUPGs = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(true)
// True when the last fetch FAILED (network down, or a non-2xx). Distinct from "zero matches" so
// the empty state can say which one happened — see getUUPGs and the template below.
const loadFailed = ref(false)
// OPEN BY DEFAULT. The filters ARE the feature of this grid — the canonical chain asks for
// "the same search bar + dropdowns as the UPG grid-list", so the dropdowns must be VISIBLE on
// load. Collapsed-by-default hid all four behind a text link, which was reported as
// not letting a reader see the dropdowns to select them. Still collapsible (the toggle
// remains) — the DEFAULT is what changed.
const filtersExpanded = ref(true)
const filterOptions = ref({})

// internal (control-owned) filter state — authoritative only when the control is shown.
const localSearchTerm = ref('')
const localFilters = ref({}) // { wagf_region|wagf_block|rop1|religion: {value,label} } + toggles

// effective search term = internal (if search shown) else the query prop.
const effSearchTerm = computed(() => (useSearch.value ? localSearchTerm.value : (props.query || '')))

// effective dropdown selections = internal (if filters shown) else the props.
const propFilters = computed(() => {
  const f = {}
  const lbl = (v) => v // label unknown for prop-driven values; value doubles as label
  if (props.wagfRegion) f.wagf_region = { value: props.wagfRegion, label: lbl(props.wagfRegion) }
  if (props.wagfBlock)  f.wagf_block  = { value: props.wagfBlock,  label: lbl(props.wagfBlock) }
  if (props.rop1)       f.rop1        = { value: props.rop1,       label: lbl(props.rop1) }
  if (props.religion)   f.religion    = { value: props.religion,   label: lbl(props.religion) }
  // The key MUST be the API field name `country_code`, not the prop name: applyDropdownFilters
  // indexes the row with it directly (u[field]). camelCase here would read u.countryCode, which
  // is undefined on every row, and filter the grid to zero.
  if (props.countryCode) f.country_code = { value: props.countryCode, label: lbl(props.countryCode) }
  // Same rule as country above: the key MUST be the API field name, because applyDropdownFilters
  // indexes the row with it directly (u[field]). A camelCase key would read an undefined field on
  // every row and filter the grid to zero.
  if (props.primaryLanguage) f.primary_language = { value: props.primaryLanguage, label: lbl(props.primaryLanguage) }
  if (props.engagementStatus) f.engagement_status = { value: props.engagementStatus, label: lbl(props.engagementStatus) }
  // Same API-field-name rule again, and here the names give no hint of it: the tree calls these
  // "Cluster" and "People Group", but the row fields are imb_reg_of_people_2 and
  // imb_reg_of_people_25. Keying on the friendly name would read an undefined field on every row and
  // filter the grid to zero — the exact failure the two comments above describe.
  if (props.cluster)     f.imb_reg_of_people_2  = { value: props.cluster,     label: lbl(props.cluster) }
  if (props.peopleGroup) f.imb_reg_of_people_25 = { value: props.peopleGroup, label: lbl(props.peopleGroup) }
  // The API-field-name rule a fourth time, for the same reason: the prop is `gospelAccess` and the
  // row field is `imb_gsec`. Keying on the prop name would read undefined on every row.
  if (props.gospelAccess) f.imb_gsec = { value: props.gospelAccess, label: lbl(props.gospelAccess) }
  // DERIVED axes: the key is not a row field but a DERIVED_AXES accessor name -- rowAxisValue()
  // resolves it, so both filter loops stay on the one shared matcher.
  if (props.religionFamily) f.__religion_family = { value: props.religionFamily, label: lbl(props.religionFamily) }
  if (props.languageFamily) f.__language_family = { value: props.languageFamily, label: lbl(props.languageFamily) }
  return f
})
const activeFilters = computed(() => (useFilters.value ? localFilters.value : propFilters.value))

// ★ A HOST-DRIVEN FACET MUST REACH THE GRID EVEN WHEN THE GRID SHOWS ITS OWN FILTERS.
// activeFilters picks ONE source: local when the dropdowns are visible, props when they are not.
// That is right for the desktop composite, which hides this grid's controls and drives it entirely
// by props — but it silently drops a host's filter whenever the controls ARE shown. MEASURED in the
// Simple Research composite: the map's region selection set wagf-region="africa" on this element and
// the list stayed at all 2,107, because show-filters is true there and props were not consulted.
// So a prop arriving in LOCAL mode is seeded INTO the local state, exactly as if the reader had
// picked it: the chip appears in this grid's own bar, the count updates, and the reader can clear it
// here. Nothing happens when no host sends one, so a standalone grid is untouched.
watch(() => props.wagfRegion, (v) => {
  if (!useFilters.value) return
  const cur = localFilters.value.wagf_region
  if (v) {
    if (cur && cur.value === v) return
    // The label is the value's own display form: `lbl` is local to propFilters (a prop-driven value
    // carries no separate label), so build the same shape here rather than reaching for a helper
    // that does not exist in this scope — the first version did, and the watcher died on
    // "lbl is not defined" with the attribute set and the list unchanged.
    const option = ((filterOptions.value && filterOptions.value.wagf_region) || []).find((o) => o.value === v)
    localFilters.value = { ...localFilters.value, wagf_region: { value: v, label: (option && option.label) || v } }
  } else if (cur) {
    const next = { ...localFilters.value }
    delete next.wagf_region
    localFilters.value = next
  }
})

// RELIGION AND LANGUAGE, THE SAME WAY AND FOR THE SAME REASON (BUILD-LINKED-FILTERING cell D).
// Both are host INPUTS that must also survive local-control mode — see the wagfRegion note above,
// which this repeats rather than generalises, because the RESOLUTION differs per facet and a shared
// loop would have to encode that difference as a table.
//
// ★ RELIGION LINKS AT THE FAMILY, NOT AT THE CODE, AND THE MAPPING IS ALREADY SHARED.
// MEASURED: a research map filters religion through its legend's flat tab, keyed by the FIRST LETTER
// of the religion code, and turns that letter into a name with RELIGION_FAMILIES — the very module
// this file imports at the top to derive `__religion_family`. So the two halves already share one
// canonical↔key table and neither holds a copy of it: the map reverses the lookup, this grid runs it
// forward per row. The wire carries the family NAME because that is the form the shared table names
// and the form a reader sees on both sides.
//
// The code-level `religion` prop stays exactly as it was, un-linked: a map cannot express 'BLA'
// distinctly from 'BMA' (both dim as Buddhism), so linking at the code would promise a precision one
// half cannot keep. An honest gap beats a wrong link.
watch(() => props.religionFamily, (v) => {
  if (!useFilters.value) return
  const cur = localFilters.value.__religion_family
  if (v) {
    if (cur && norm(cur.value) === norm(v)) return
    localFilters.value = { ...localFilters.value, __religion_family: { value: v, label: v } }
  } else if (cur) {
    const next = { ...localFilters.value }
    delete next.__religion_family
    localFilters.value = next
  }
})

// Language needs no translation at all — MEASURED, the map's language vocabulary is already display
// names ('Afar', 'Afrikaans'), the same strings this grid's primary_language labels carry, and
// valueMatches compares the normalized label as well as the value. That is a measurement, not an
// assumption; religion above is the counter-example that made it worth measuring.
watch(() => props.primaryLanguage, (v) => {
  if (!useFilters.value) return
  const cur = localFilters.value.primary_language
  if (v) {
    if (cur && norm(cur.value) === norm(v)) return
    localFilters.value = { ...localFilters.value, primary_language: { value: v, label: v } }
  } else if (cur) {
    const next = { ...localFilters.value }
    delete next.primary_language
    localFilters.value = next
  }
})

// How many filters are ACTUALLY narrowing the list. Counts only entries carrying a real value —
// an empty/cleared filter still occupies a key, so Object.keys().length would over-report and the
// badge would lie. Drives the toggle's count badge, so a collapsed panel still says what it hides.
const activeFilterCount = computed(() => Object.values(activeFilters.value || {})
  .filter(f => f && f.value !== '' && f.value != null).length)

// Active dropdown chips the user can see/remove (only meaningful when filters are shown).
const visibleFilterCount = computed(() => Object.keys(activeFilters.value).length)

// IS THIS GRID CURRENTLY SHOWING A SUBSET? Drives the count line's third state (see the markup
// note at .pgg-body): a host-embedded grid stays silent while it merely echoes the dashboard's
// total, and speaks up as soon as it is actually narrowed. Reuses activeFilterCount rather than
// Object.keys() because a CLEARED filter still occupies a key — counting keys would report
// "narrowed" for a grid showing everything, which is the precise lie the comment above guards.
// The search term counts too: typing narrows the grid just as a facet does — and it reads
// effSearchTerm, not the local ref, because that computed already resolves the local-control-else-
// incoming-prop precedence. In the composite the search lives in the HOST's header, so the local
// ref is always empty there and only the prop is real.
const isNarrowed = computed(() => activeFilterCount.value > 0 || !!(effSearchTerm.value || '').trim())


function debounce(fn, ms = 500) {
  let timeout
  return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => fn(...args), ms) }
}

// Debounce only the FILTER pass; the term itself is captured synchronously at the
// input event (shadow-DOM retargets event.target on the async tick, so we must NOT
// read event.target inside the debounced closure — read it now, filter later).
const runFilterDebounced = debounce(() => {
  loading.value = true
  page.value = 1
  filterUUPGs()
}, 500)
// SearchBar (shared) emits `search { value }` — the value is read inside the control,
// so shadow-DOM event retargeting on the async tick can never lose it.
function onSearch(payload) {
  localSearchTerm.value = payload?.value ?? ''
  runFilterDebounced()
}

function toggleFilters() { filtersExpanded.value = !filtersExpanded.value }

function onFilterChange(detail) {
  localFilters.value = { ...localFilters.value, [detail.name]: { value: detail.value, label: detail.label } }
  page.value = 1
  filterUUPGs()
}
function onFilterClear(detail) { removeFilter(detail.name) }
function removeFilter(name) {
  const copy = { ...localFilters.value }
  delete copy[name]
  localFilters.value = copy
  page.value = 1
  filterUUPGs()
}
function clearAllFilters() {
  localFilters.value = {}
  page.value = 1
  filterUUPGs()
}
function toggleExact() {
  if (localFilters.value.exact) return removeFilter('exact')
  localFilters.value = { ...localFilters.value, exact: { value: 'yes', label: t.value.exact_filter || 'Exact' } }
  page.value = 1
  filterUUPGs()
}

// ── copied from UupgsList: dropdown filtering + faceted counts + Fuse search ────

// TWO VOCABULARIES MEET HERE, AND A STRICT === SILENTLY FILTERED TO ZERO.
//
// THE BUG (reported and measured live 2026-09-22, dashboard-plus-grid leaf). Picking a
// region in the dashboard above showed "1,309" in its own chart while the grid below said
// "no people groups match this filter" — every host-driven selection produced ZERO cards.
// Neither half was broken and the event wiring was correct; the two sides simply SPELL the
// same value differently:
//   the dashboard emits the human LABEL ...... "Asia", "North America & non-Spanish Caribbean"
//   the API stores the machine VALUE ......... "asia", "north_america_&_non-spanish_caribbean"
// `vl?.value === selection.value` compares those literally, so it never matched.
//
// ★ WHY THE GRID'S OWN DROPDOWNS ALWAYS WORKED — and why no gate caught this. Those options
// are built by extractFilterOptions() FROM THE DATA ITSELF, so that path compares "asia" to
// "asia" and can never mismatch. Only the HOST-PROP path (see the props→activeFilters bridge
// above, which wraps an incoming prop verbatim) can inject a label into this comparison. The
// defect therefore exists ONLY in the composite, which is why the standalone grid is fine and
// verify:gate1 passes 13/13 on the same 2,107 records.
//
// THE FIX IS A NORMALISING MATCH, NOT A TRANSLATION TABLE. A lookup mapping label→value would
// need maintaining for every axis and would rot the moment the API adds a region. Instead
// compare both the value AND the label, case- and separator-insensitively, so EITHER
// vocabulary works and a new value needs no code change. Kept deliberately narrow: it only
// widens what counts as equal, so a genuine non-match still filters to nothing.
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_&-]+/g, '')
// ── DERIVED AXES: family values computed per-row, byte-parity with dashboard.config.js ──
// religion family = first letter of the religion CODE -> RELIGION_FAMILIES name; language
// family = the API's imb_language_family label when present (1.6% of rows), else the
// ISO-639-3 lookup via langFamilyByIso (lifts coverage to ~96%), both case-folded through
// canonicalFamilyName. Returned as {value,label} so valueMatches() treats a derived axis
// exactly like a fetched one.
const DERIVED_AXES = {
  __religion_family: (u) => {
    const code = u.religion && typeof u.religion === 'object' ? u.religion.value : u.religion
    const c = String(code || '').charAt(0).toUpperCase()
    const name = c && RELIGION_FAMILIES[c] ? RELIGION_FAMILIES[c] : ''
    return name ? { value: name, label: name } : null
  },
  __language_family: (u) => {
    const f = u.imb_language_family
    const api = f && typeof f === 'object' ? (f.label || f.value) : f
    let name = ''
    if (api) name = canonicalFamilyName(api)
    else {
      const iso = u.primary_language && typeof u.primary_language === 'object' ? u.primary_language.value : null
      const hit = iso && langFamilyByIso[iso]
      name = hit ? canonicalFamilyName(hit) : ''
    }
    return name ? { value: name, label: name } : null
  },
}
// ONE resolver for both filter loops: a derived key runs its accessor, a real key reads the row.
const rowAxisValue = (u, field) => (DERIVED_AXES[field] ? DERIVED_AXES[field](u) : u[field])
// ★ A SELECTION MAY BE SEVERAL VALUES (SPEC-DASHBOARD-KIT D1), and this is the end of the wire
// that makes the "Arabic" case a real narrowing instead of an honest abstention. The language tier
// "Arabic" covers 23 ISO codes, so no single value expresses it; until now the composite had to
// send nothing and leave the axis unfiltered rather than show a fraction of the selection or an
// empty grid. A comma-separated list is accepted here and matched as OR-within-the-axis, which is
// exactly what the bus's facetMatches() does at the other end — one rule, two implementations,
// and they have to stay the same shape.
// ★ THE SEPARATOR IS `|`, AND IT IS NOT `,` FOR A MEASURED REASON. A separator that can also occur
// inside a value is not a separator — the rule the URL hash already states one file over. The first
// version of this split on `,` and BROKE LABEL MATCHING, because 40% of the live language labels
// are comma-inverted ("Arabic, Mesopotamian"): the selection was chopped into "Arabic" and
// "Mesopotamian" and matched neither. Caught by check:filter-multivalue's own label assertion
// before it left this machine, which is the entire point of asserting a behaviour you are keeping
// rather than only the one you are adding. Measured on the 864 live label/value pairs: `,` appears
// in 120 of them, `|` in none.
// A HOST STILL SENDS ONE STRING: an attribute is a string, so a list arrives as "apd|acm|ayl", and
// a single value with no separator takes the identical path it always did.
function valueMatches(vl, selection) {
  if (!vl) return false
  const raw = selection?.value
  if (raw === null || raw === undefined || raw === '') return false
  const wants = (Array.isArray(raw) ? raw : String(raw).split('|'))
    .map((v) => norm(v)).filter(Boolean)
  if (!wants.length) return false
  const value = norm(vl.value), label = norm(vl.label)
  return wants.some((want) => value === want || label === want)
}

function applyDropdownFilters(list) {
  let filtered = list
  for (const [field, selection] of Object.entries(activeFilters.value)) {
    if (field === 'exact') { filtered = filtered } else {
      filtered = filtered.filter((u) => valueMatches(rowAxisValue(u, field), selection))
    }
  }
  return filtered
}

function extractFilterOptions() {
  const extract = (field) => {
    const counts = new Map()
    for (const u of uupgs.value) {
      const vl = u[field]
      if (!vl?.value) continue
      const existing = counts.get(vl.value)
      if (existing) existing.count++
      else counts.set(vl.value, { label: vl.label, count: 1 })
    }
    return Array.from(counts.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }
  // THE FOUR AXES ONLY — Country is deliberately absent here, and that is not an oversight.
  // filterOptions is what RENDERS the dropdowns (see the filters__panel template), so adding
  // country_code would grow this element a FIFTH dropdown, which is exactly the control that was
  // excluded. The new `countryCode` prop is an INPUT, not a control: it reaches the rows
  // through propFilters → activeFilters → applyDropdownFilters without ever passing through here.
  //
  // The cross-filtering still comes out right. updateFilterOptionCounts() below iterates
  // Object.keys(filterOptions) for the fields it RECOMPUTES, but feeds applyWith() the whole of
  // activeFilters minus that one field — so an incoming country selection DOES narrow the four
  // visible counts (pick India and Religion re-counts over 855 rows, not 2,107), it simply never
  // gets a picker of its own. Input, not control: that is the whole distinction.
  filterOptions.value = {
    wagf_region: extract('wagf_region'),
    wagf_block: extract('wagf_block'),
    rop1: extract('rop1'),
    religion: extract('religion'),
  }
}

function updateFilterOptionCounts() {
  const fields = Object.keys(filterOptions.value)
  const next = {}
  for (const field of fields) {
    const filtersWithout = {}
    for (const [key, val] of Object.entries(activeFilters.value)) {
      if (key !== field) filtersWithout[key] = val
    }
    // apply the OTHER filters to compute this field's cross-filtered counts
    const subset = applyWith(filtersWithout, uupgs.value)
    const counts = new Map()
    for (const u of subset) {
      const vl = u[field]
      if (!vl?.value) continue
      counts.set(vl.value, (counts.get(vl.value) ?? 0) + 1)
    }
    next[field] = (filterOptions.value[field] ?? []).map(opt => ({ ...opt, count: counts.get(opt.value) ?? 0 }))
  }
  filterOptions.value = next
}

// helper: apply a specific filter-set (used by the faceted-count cross-filter)
// Uses the same valueMatches() as applyDropdownFilters: if the two disagreed, the facet COUNTS
// would contradict the rows actually shown (a chart reading 1,309 above an empty list — exactly
// the symptom that was reported). One matcher, both call sites.
function applyWith(filters, list) {
  let filtered = list
  for (const [field, selection] of Object.entries(filters)) {
    if (field === 'exact') continue
    filtered = filtered.filter((u) => valueMatches(rowAxisValue(u, field), selection))
  }
  return filtered
}

function filterUUPGs() {
  // reset per-item highlight state
  uupgs.value = uupgs.value.map((u) => {
    u.matches = []
    u.country_label = ''
    u.rop1_label = ''
    return u
  })

  const hasActive = Object.keys(activeFilters.value).length > 0
  const preFiltered = hasActive ? applyDropdownFilters(uupgs.value) : uupgs.value
  const term = effSearchTerm.value

  if (!term) {
    filteredUUPGs.value = preFiltered
    total.value = filteredUUPGs.value.length
    loading.value = false
    updateFilterOptionCounts()
    emitFiltered()
    return
  }

  const fuse = new Fuse(preFiltered, {
    includeMatches: true,
    ignoreLocation: true,
    minMatchCharLength: 3,
    threshold: activeFilters.value.exact ? 0 : 0.4,
    keys: ['name', 'imb_alternate_name', 'country_code.label', 'rop1.label', 'religion.label', 'wagf_region.label', 'wagf_block.label'],
  })

  const result = fuse.search(term)
  filteredUUPGs.value = result.map((res) => {
    const newItem = { ...res.item }
    if (!res.matches) return newItem
    newItem.matches = []
    for (const match of res.matches) {
      const matchKey = match.key
      if (!matchKey) continue
      let value = ''
      if (String(matchKey).includes('.')) {
        const [parentKey, childKey] = String(matchKey).split('.')
        value = newItem[parentKey]?.[childKey]
      } else {
        value = newItem[String(matchKey)]
      }
      if (value && typeof value === 'string') {
        // The same construction regions-dashboard's UupgsList had, character for character apart from
        // variable names, which is what earned it a place in library/ under RULE 2. One fact, one copy.
        const highlightedValue = highlightRanges(value, match.indices)
        if (String(matchKey).includes('imb_alternate_name')) {
          newItem.matches.push({ key: t.value.alternate_name ?? 'Also known as', label: highlightedValue })
        } else if (String(matchKey).includes('.')) {
          const [parentKey] = String(matchKey).split('.')
          const keyTranslations = {
            religion: t.value.religion,
            country_code: t.value.country,
            rop1: t.value.rop1,
            wagf_region: t.value.wagf_region,
            wagf_block: t.value.wagf_block,
          }
          if (parentKey === 'rop1') { newItem.rop1_label = highlightedValue }
          else if (parentKey === 'country_code') { newItem.country_label = highlightedValue }
          else if (parentKey === 'wagf_region') { /* no dedicated slot */ }
          else { newItem.matches.push({ key: keyTranslations[parentKey] ?? parentKey, label: highlightedValue }) }
        } else {
          newItem[String(matchKey)] = highlightedValue
        }
      }
    }
    return newItem
  })

  total.value = filteredUUPGs.value.length
  loading.value = false
  updateFilterOptionCounts()
  emitFiltered()
}

// ── emit `groups-filtered` (Vue + native composed CustomEvent) ─────────────────
const inst = getCurrentInstance()
const hostEl = () => hostElement(inst)
function emitFiltered() {
  const detail = {
    query: effSearchTerm.value,
    activeFilters: activeFilters.value,
    total: total.value,
    slugs: filteredUUPGs.value.map((u) => u.slug),
  }
  emit('groups-filtered', detail)
  const el = hostEl()
  if (el && typeof el.dispatchEvent === 'function') {
    el.dispatchEvent(new CustomEvent('groups-filtered', { detail, bubbles: true, composed: true }))
  }
}

// ── pagination (copied from UupgsList) ─────────────────────────────────────────
function hasMore() {
  if (props.morePerPage > 0) {
    return total.value > props.perPage + (page.value - 1) * props.morePerPage && !loading.value && filteredUUPGs.value.length > 0
  }
  return total.value > page.value * props.perPage && !loading.value && filteredUUPGs.value.length > 0
}
function loadMore() { page.value = page.value + 1 }
const displayedUUPGs = computed(() => {
  if (props.morePerPage > 0) return filteredUUPGs.value.slice(0, props.perPage + (page.value - 1) * props.morePerPage)
  return filteredUUPGs.value.slice(0, page.value * props.perPage)
})
const showMore = computed(() => hasMore())

// ── data fetch (SAME endpoint DX-life uses; host now injected) ─────────────────
async function getUUPGs() {
  // `primary_language` is REQUIRED BY A FILTER, not by the card markup — applyDropdownFilters
  // reads u.primary_language directly, so leaving it out of this list would make the new
  // primaryLanguage prop match nothing and silently filter the grid to zero rows. Verified live
  // (2026-09-22): adding it keeps the response at 2,107 rows and the field is populated on 100%
  // of them. Any future filter axis must be added HERE as well as to propFilters.
  const url = `${prayBaseUrl.value}/api/people-groups/list?fields=name,slug,wagf_region,wagf_block,country_code,rop1,religion,has_photo,image_url,adopted_by_churches,imb_alternate_name,engagement_status,people_committed,primary_language,imb_reg_of_people_2,imb_reg_of_people_25,imb_gsec,imb_language_family&lang=${languageCode.value}`
  loading.value = true
  loadFailed.value = false
  try {
    const response = await fetch(url)
    // ★ CHECK THE STATUS. fetch() only rejects on a NETWORK failure — a 404, a 500 or an HTML error
    // page all resolve, and response.json() on them either throws (landing in the catch, which used
    // to be silent) or yields an object with no `posts`, which sets an EMPTY grid and reports
    // success. Both looked identical to "your filter matched nothing".
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    // The people-group LIST this embed shows (library/lists/). The default keeps every row, so the
    // API's total stands; any other list is counted from the rows it kept.
    const rows = Array.isArray(data.posts) ? data.posts : []
    const listed = await applyPeopleGroupList(rows, props.profileConfig)
    total.value = listed === rows ? data.total : listed.length
    uupgs.value = listed
    extractFilterOptions()
    filterUUPGs()
  } catch (error) {
    // ★ A DATA-SOURCE FAILURE IS NOT AN EMPTY RESULT (fixed 2026-09-23).
    // This catch used to log to the console and clear `loading`, leaving the template's
    // `v-else-if="!displayedUUPGs.length"` branch to render "No people groups match this filter."
    // MEASURED by blocking pray.doxa.life in a browser: the host was unreachable, two console
    // errors were logged, and the user was told their FILTER was wrong. They would then adjust
    // filters that were never the problem, and an operator glancing at the page would see a normal
    // empty state rather than an outage — the console is the only place the truth appeared, and
    // users do not open it.
    //
    // The distinction matters most in the embedded cases this element exists for: on a partner
    // site or inside the cap-4/cap-5 composites, nobody is watching a console at all.
    console.error('[people-groups-grid] fetch error:', error)
    loadFailed.value = true
    uupgs.value = []
    loading.value = false
  }
}

// external prop-driven filters should re-filter the grid (when controls are hidden).
// ★ WATCH THE DERIVED propFilters, NOT a hand-enumerated prop list. This watcher used to spell
// out every filter prop by name -- the THIRD copy of the axis list (defineProps, propFilters,
// here), and the copy nobody remembers: religionFamily/languageFamily landed in the first two
// and the grid received the prop, showed its "Showing" count line, and silently never
// re-filtered (measured: Hinduism selected, first card still a Malaysian Islamic group).
// propFilters already derives from every axis prop, so watching it makes the axis list have
// ONE owner and a future axis cannot miss the watcher.
watch(() => [props.query, propFilters.value,
  useSearch.value, useFilters.value], () => {
  page.value = 1
  filterUUPGs()
})

// ★ THE VOCABULARY THIS GRID FILTERS BY, READ OFF ITS OWN ROWS.
// A composite linking this grid to another element has to know which strings the two halves share,
// and the only answer that cannot go stale is the one the data gives. Symmetric with the research
// map's `__researchMapVocabulary`, deliberately: a check can ask both halves the same question and
// compare the two answers, which is what makes the linking VERIFIABLE instead of merely plausible.
// Returns display names, because that is the form both halves can read.
//
// Exposed on the ELEMENT first — one page may hold several grids and a window global would answer
// for whichever mounted last — with the global kept as the convenience a plain host page reaches
// for, matching `__researchMapFilterState`'s existing shape.
function vocabulary(field) {
  const seen = new Set()
  for (const u of (uupgs.value || [])) {
    // rowAxisValue, not u[field] — so a DERIVED axis (`__religion_family`) answers through the same
    // accessor the filters use. Asking the raw field would report codes for a facet that links by name.
    const vl = rowAxisValue(u, field)
    const name = vl && typeof vl === 'object' ? vl.label : vl
    if (typeof name === 'string' && name) seen.add(name)
  }
  return [...seen].sort()
}

/**
 * ★ THE WINDOW HANDLE IS RELEASED ON UNMOUNT, AND ONLY IF IT IS STILL OURS.
 *
 * window.__peopleGroupsGridVocabulary was set on mount and never cleared, so it held a reference
 * into this app for as long as the page lived — every unmounted grid stayed reachable. The element
 * handle beside it (el.__vocabulary) needs no teardown: it dies with the element that carries it.
 *
 * The identity check is the part that matters. This grid can appear more than once on a page, and
 * the last mount wins the global — so a plain delete on the FIRST grid's unmount would strip the
 * SECOND, live, grid's handle and break whatever reads it, with no error. Clearing a shared global
 * is only safe while you can prove you are still the one who set it.
 */
onUnmounted(() => {
  if (typeof window !== 'undefined' && window.__peopleGroupsGridVocabulary === vocabulary) {
    delete window.__peopleGroupsGridVocabulary
  }
})

onMounted(() => {
  const el = hostEl()
  if (el) el.__vocabulary = vocabulary
  if (typeof window !== 'undefined') window.__peopleGroupsGridVocabulary = vocabulary
  // The watcher above only fires on a CHANGE, and the common case is a page that loads in Arabic
  // and never changes — so reflect it once on mount as well.
  reflectDir()
  getUUPGs()
})
</script>

<template>
  <div class="pgg-root">
    <!-- The element's OWN filters block: shown by default, hidden when driven externally. -->
    <div v-if="useSearch || useFilters" id="filters" class="filters" :style="filtersBackdrop">
      <!-- ★ EXACT BELONGS IN THE SEARCH ROW, because it modifies the SEARCH.
           DX-life's UupgsList puts the input and the Exact button in one `.repel` row inside
           `.search-box`, so the modifier reads as part of the field it changes. Ours had it in a
           second `.filters__panel` BELOW the four dropdowns, where it looked like a fifth filter
           and only appeared once the panel was expanded — so a user searching with the panel
           collapsed could not reach it at all. Now it sits beside the input whenever search is
           shown, which is also when it can do anything. -->
      <div v-if="useSearch" class="pgg-search pgg-search--repel">
        <SearchBar
          :model-value="localSearchTerm"
          :placeholder="t.search || 'Search people groups…'"
          :aria-label="t.search || 'Search people groups'"
          max-width="600px"
          @search="onSearch"
        />
        <button
          v-if="useFilters"
          class="filter-toggle pgg-exact" type="button"
          :data-active="activeFilters.exact ? '' : undefined"
          @click="toggleExact"
        >{{ t.exact_filter || 'Exact' }}</button>
      </div>

      <button
        v-if="useFilters"
        class="filters__toggle"
        type="button"
        :aria-expanded="filtersExpanded"
        @click="toggleFilters"
      >
        <svg class="filters__toggle-icon" width="13" height="13" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M1.5 2.5h9M3 6h6M4.5 9.5h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        {{ filtersExpanded ? (t.hide_filters || 'Hide Filters') : (t.show_filters || 'Show Filters') }}
        <span v-if="activeFilterCount" class="filters__toggle-count">{{ activeFilterCount }}</span>
        <svg class="filters__toggle-chevron" width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <template v-if="useFilters && filtersExpanded">
        <!-- THE FOUR dropdowns: Region / Block / People-Group / Religion (Country EXCLUDED). -->
        <div class="filters__panel">
          <FilterDropdown
            :label="t.wagf_region || 'Region'" name="wagf_region"
            :options="filterOptions.wagf_region || []"
            :value="activeFilters.wagf_region?.value ?? ''"
            :placeholder="t.type_to_search || 'Type to search...'"
            @filter-change="onFilterChange" @filter-clear="onFilterClear"
          />
          <FilterDropdown
            :label="t.wagf_block || 'Bloc'" name="wagf_block"
            :options="filterOptions.wagf_block || []"
            :value="activeFilters.wagf_block?.value ?? ''"
            :placeholder="t.type_to_search || 'Type to search...'"
            @filter-change="onFilterChange" @filter-clear="onFilterClear"
          />
          <FilterDropdown
            :label="t.rop1 || 'People Group'" name="rop1"
            :options="filterOptions.rop1 || []"
            :value="activeFilters.rop1?.value ?? ''"
            :placeholder="t.type_to_search || 'Type to search...'"
            @filter-change="onFilterChange" @filter-clear="onFilterClear"
          />
          <FilterDropdown
            :label="t.religion || 'Religion'" name="religion"
            :options="filterOptions.religion || []"
            :value="activeFilters.religion?.value ?? ''"
            :placeholder="t.type_to_search || 'Type to search...'"
            @filter-change="onFilterChange" @filter-clear="onFilterClear"
          />
        </div>
      </template>

      <div v-if="useFilters && visibleFilterCount > 0" class="filters__active">
        <template v-for="(filter, name) in activeFilters" :key="name">
          <span class="filter-chip">
            {{ filter.label }}
            <button class="filter-chip__remove" type="button" @click="removeFilter(String(name))">&times;</button>
          </span>
        </template>
        <button class="filters__clear-all" type="button" @click="clearAllFilters">
          {{ t.clear_all || 'Clear All' }}
        </button>
      </div>
    </div>

    <div class="pgg-body">
      <!-- THE COUNT LINE, AND WHY IT HAS THREE STATES RATHER THAN TWO.
           Two requests point in opposite directions and BOTH are right:
             (a) earlier — "the same 2,107 renders five times down one page", so the host-embedded
                 grid was given show-total=false and went silent;
             (b) 2026-09-22 — "the people groups grid underneath should tell me how many people
                 groups are currently displaying, and that number should change based on the
                 selections."
           Those only LOOK contradictory. (a) is about a number that merely ECHOES the dashboard's
           own total; (b) is about a number that DESCRIBES THIS GRID. Before today they were always
           the same value, so the echo was pure noise. After the label-vs-value fix the grid really
           does narrow — a region selection takes it well below the dashboard's 2,107 — so the two
           numbers now differ, and a differing number is information rather than repetition.
           Hence: show it when it SAYS something (a filter is narrowing this grid), stay silent when
           it would only repeat the host. showTotal=true is unchanged for the standalone element,
           where this line is the only row-total and must always render. -->
      <div v-if="useTotal || isNarrowed" class="repel">
        <div class="font-size-sm">
          <template v-if="!loading">
            {{ isNarrowed && !useTotal
                ? (t.showing || 'Showing') + ' ' + formatCount(total)
                : (t.total || 'Total') + ': ' + formatCount(total) }}
          </template>
          <span v-else>&nbsp;</span>
        </div>
      </div>

      <!-- Its own row, NOT inside #filters: that block is gated on useSearch || useFilters, so a
           host that turns both off would lose this control too — and it has nothing to do with
           either. It modifies the grid, so it sits on the grid. -->
      <div class="pgg-gridbar">
        <label class="pgg-perrow">
          <span>{{ t.cards_per_row }}</span>
          <select v-model="perRow" :aria-label="t.cards_per_row">
            <option v-for="o in PER_ROW_OPTIONS" :key="o" :value="o">{{ o === 'auto' ? t.cards_per_row_auto : o }}</option>
          </select>
        </label>
      </div>
      <div id="results" class="grid uupgs-list" :style="gridStyle">
        <template v-for="(uupg, ui) in displayedUUPGs" :key="uupg.slug">
          <div class="card uupg__card">
            <!-- ★ THE PHOTOS WERE COMPETING WITH THE MAP FOR THE FIRST THREE SECONDS. Measurement showed a
                 cold load of Simple Research pulling 24 people-group photos, 5.3 MB, DURING BOOT —
                 alongside the map engine and the API data, on the same connection. Nothing was wrong
                 with any one image; there was simply no instruction about WHEN to fetch them.
                 EAGER_IMAGES is a column count, not a taste: the grid is
                 repeat(auto-fill, minmax(240px, 1fr)) by default, which is 1 column on a phone and
                 3-5 on a desktop, so the FIRST ROW is never more than five cards at any width. Those
                 five keep their normal priority — lazy-loading what the reader is already looking at
                 trades a real flash of empty cards for bytes nobody saves. Everything past them waits
                 until it approaches the viewport.
                 The size is declared so the reservation survives BEFORE the stylesheet applies: .uupg__image
                 already carries aspect-ratio 1/1, which is what actually holds the box, and width/height
                 repeat it as an intrinsic ratio for the moments that CSS has not reached yet. Same 1:1,
                 stated twice on purpose rather than a second, different truth. -->
            <img
              v-if="uupg.image_url"
              class="uupg__image"
              :src="uupg.image_url"
              :alt="uupg.name"
              width="240"
              height="240"
              decoding="async"
              :loading="ui < EAGER_IMAGES ? 'eager' : 'lazy'"
              :fetchpriority="ui < EAGER_IMAGES ? 'auto' : 'low'"
            >
            <div class="uupg__header">
              <h3 class="uupg__name" v-html="uupg.name" />
              <p v-if="uupg.country_code" class="uupg__country">
                <a
                  class="uupg__country-link"
                  :href="joinBase(countryUrl, countrySlug(uupg.country_code.value, uupg.country_code.label))"
                ><span v-html="uupg.country_label ? uupg.country_label : uupg.country_code.label" /></a>
                <template v-if="uupg.rop1"> (<span v-html="uupg.rop1_label ? uupg.rop1_label : uupg.rop1.label" />)</template>
              </p>
              <template v-if="uupg.matches">
                <p v-for="(match, mi) in uupg.matches" :key="mi" class="uupg__match">
                  <strong>{{ match.key }}</strong>: <span v-html="match.label" />
                </p>
              </template>
            </div>
            <p v-if="uupg.location_description" class="uupg__content">{{ uupg.location_description }}</p>
            <a class="uupg__more-button" :href="joinBase(researchUrl, uupg.slug)">{{ t.full_profile || 'Full Profile' }}</a>
          </div>
        </template>

        <div v-if="loading" class="loading">{{ t.loading || 'Loading…' }}</div>
        <div v-else-if="loadFailed" class="pgg-empty pgg-failed" role="status">
          {{ t.load_failed || 'People-group data could not be loaded. This is a connection problem, not your filter.' }}
        </div>
        <div v-else-if="!displayedUUPGs.length" class="pgg-empty">
          {{ t.no_results || 'No people groups match this filter.' }}
        </div>
      </div>

      <button v-if="showMore" class="pgg-loadmore" type="button" @click="loadMore">
        {{ t.load_more || 'Load More' }}
      </button>
    </div>
  </div>
</template>

<style>
/* Self-contained styling: the DX-life grid relied on the app's shared CUBE SCSS
   (blocks/_filters.scss + blocks/_cards.scss); those don't ship here, so the essential
   layout/look is inlined and scoped to this element's shadow root. Class names are
   preserved so the DX-life SCSS COULD still apply if this ever mounts inside that app. */
/* Self-size as a block regardless of how a parent mounts us — never depend on the mounter
   forcing display (an unstyled host defaults to inline and mis-sizes). This grid is
   natural-height (grows with content), so :host is display:block, width:100%, no fixed height.
   See BUG-EMBEDDED-PLUGIN-STUDIO-BLACK-SCREEN-DISPLAY-BLOCK. */
/* DX-life material LIGHT palette. Defined at :host (not .pgg-root) so a host page or the
   Cat-4 composite can override a token from outside — a :host declaration loses to the
   host's own rule, which is exactly the override hook we want. LIGHT ONLY; there is no
   dark mode in this product and none may be added. Same token set + same values as
   research-dashboard's :host, so this element matches whatever it is stacked with. */
:host {
  display: block; width: 100%;
  --dx-surface: #f3f3f1; --dx-elevated: #ffffff; --dx-text: #3b463d; --dx-muted: #6d766e;
  --dx-line: #d1d4cd; --dx-accent: #92b195;
  --dx-accent-weak: rgba(146, 177, 149, .18); --dx-accent-soft: rgba(146, 177, 149, .10);
  /* #657967, not #7b9b7e: white-on-fill must clear WCAG AA for TEXT (4.5:1), and this button's
     label is 0.85rem/700 = ~13.6px — NOT 'large text' (>=18.66px bold), so the 3:1 large-text
     allowance does not apply. #7b9b7e measures 3.07:1 (below AA at this size); #657967 is 4.68:1
     and stays unmistakably in the sage family (52% blend toward --dx-text). Computed from the
     WCAG 2.1 relative-luminance formula, not eyeballed. See REF-dx-sage-contrast-role-split. */
  --dx-accent-strong: #657967;
}
.pgg-root {
  /* --brand/--ink/… are this grid's semantic aliases (the original DX-life CUBE names);
     they RESOLVE to the tokens above rather than carrying their own colour. */
  --brand: var(--dx-accent, #92b195); --ink: var(--dx-text, #3b463d); --mut: var(--dx-muted, #6d766e);
  --line: var(--dx-line, #d1d4cd); --card: var(--dx-elevated, #fff); --bg: var(--dx-surface, #f3f3f1);
  width: 100%; box-sizing: border-box; color: var(--ink); background: var(--bg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  padding: 16px;
}
.filters { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;
  /* padding-block, never a `padding` shorthand: the shorthand would zero the side gutters
     this grid relies on at phone width. min-height gives the 60%-wide backdrop room to read
     behind the controls, which is what makes it a backdrop and not a stripe. */
  padding-block: 18px 8px; min-height: 190px; }
/* The search box itself is the shared @map SearchBar (self-styling). This wrapper only
   centres it; the input's look lives in library/components/search/SearchBar.vue. */
.pgg-search { display: flex; justify-content: center; }
/* ★ THE ROW IS CONSTRAINED, WHICH IS WHAT MAKES `repel` READ AS A PAIR.
   DX-life's markup is `.search-box | center | max-width-md` wrapping a `.repel` — the
   repel only looks right because the BOX is narrow. Copying the repel without the width
   cap put Exact against the far edge of a 1248px row, 390px from the field it modifies,
   which reads as an unrelated control (measured: input ended at x=843, button at x=1231).
   So: cap the row near the field's own 480px, centre it, and repel INSIDE that. Wraps on a
   phone so the button drops under the input instead of squeezing it. */
.pgg-search--repel {
  gap: 10px; align-items: center; flex-wrap: wrap;
  justify-content: center;
  width: 100%; max-width: 600px; margin-inline: auto;
  /* ★ CLEAR OF THE GALLERY'S ROUND ☰ ONLY WHILE IT RESTS HERE, full width otherwise (as the live DX
     Life list's field is). On a phone the ☰ is a 44px circle at the bottom-left (bottom-right in ar), and
     this row sits right where it rests on the first screen. It rides up above the map's legend sheet once
     the sheet announces itself, so it rests here only until then: while the map loads (measured at 390:
     still resting 6 s after the grid showed), or for good if the map fails. The layout publishes both
     facts only while the ☰ shows: --map-fab-beside (its footprint) and --vtl-fab-lift (0 while it rests).
     The clamp keeps the footprint as padding on BOTH sides (centred) at a lift of 0 and drops it to 0 at
     any real lift. With no ☰ (desktop, a standalone page) both are unset, and the padding is 0. */
  padding-inline: clamp(0px, calc(var(--map-fab-beside, 0px) - var(--vtl-fab-lift, 0px) * 100), var(--map-fab-beside, 0px));
  transition: padding .2s ease;   /* the ☰'s own .2s move */
  box-sizing: border-box;
}
@media (prefers-reduced-motion: reduce) { .pgg-search--repel { transition: none; } }
.pgg-search--repel > :first-child { flex: 1 1 320px; min-width: 0; }
/* Exact is hidden. Readers could not tell what the chip meant, and on a phone it wrapped under the
   field onto a line of its own. The search stays fuzzy, and the filter code behind the chip is
   unchanged. With the field alone in the row, the row centres it instead of repelling a pair. */
.pgg-exact { display: none; }
/* A CONTROL, not a text link. It was background:none + border:none + text-decoration:underline,
   which reads as a hyperlink — so the four dropdowns it gates were effectively undiscoverable
   (reported). Now a bordered, filled affordance in the material-light palette with a
   filter glyph and an active-count badge, so it looks pressable and says what it is hiding. */
.filters__toggle {
  background: var(--dx-elevated, #fff); border: 1px solid var(--dx-line, #d1d4cd);
  border-radius: 8px; cursor: pointer; font-size: 0.875rem; font-weight: 500;
  color: var(--dx-text, #3b463d); padding: 7px 12px;
  display: inline-flex; align-items: center; gap: 7px; margin-inline: auto;
  transition: background-color .15s ease, border-color .15s ease;
}
.filters__toggle:hover { background: var(--dx-accent-weak, rgba(146,177,149,.18)); border-color: var(--dx-accent, #92b195); }
.filters__toggle:focus-visible { outline: 2px solid var(--dx-accent, #92b195); outline-offset: 2px; }
.filters__toggle-icon { color: var(--dx-accent, #92b195); flex: none; }
.filters__toggle-count {
  background: var(--dx-accent, #92b195); color: #fff; border-radius: 999px;
  min-width: 18px; padding: 0 5px; font-size: 0.75rem; line-height: 18px; text-align: center;
}
/* Only the CHEVRON turns over when the filters are open. The rule used to match every svg in the
   button, so the filter icon beside the label flipped upside down too (its longest line at the
   bottom), which read as a broken icon. Measured on a phone, where the grid opens with its filters
   expanded. */
.filters__toggle-chevron { flex: none; }
.filters__toggle[aria-expanded="true"] .filters__toggle-chevron { transform: rotate(180deg); }
.filters__panel { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; align-items: flex-start; }
.filter-toggle {
  padding: 6px 12px; cursor: pointer; font-size: 0.875rem; color: inherit; background: var(--card);
  border: 1px solid var(--line); border-radius: 8px; transition: border-color 150ms ease, background 150ms ease;
}
.filter-toggle:hover { border-color: var(--brand); }
/* Active/selected states tint with the sage accent but keep --ink for the label: sage on
   white is a ~1.9:1 text pair, so the accent carries the STATE and the ink carries the WORD. */
.filter-toggle[data-active] { background-color: var(--dx-accent-weak, rgba(146, 177, 149, .18)); border-color: var(--brand); color: var(--ink); }
.filters__active { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; }
.filter-chip {
  display: inline-flex; gap: 6px; align-items: center; background-color: var(--dx-accent-weak, rgba(146, 177, 149, .18));
  color: var(--ink); border: 1px solid var(--line); border-radius: 100px; padding: 4px 12px; font-size: 0.85rem;
}
.filter-chip__remove { background: none; border: none; cursor: pointer; font-size: 1.1em; line-height: 1; color: inherit; padding: 0; display: inline-flex; align-items: center; }
.filter-chip__remove:hover { opacity: 0.7; }
.filters__clear-all { background: none; border: none; cursor: pointer; font-size: 0.875rem; color: var(--ink); text-decoration: underline; text-decoration-color: var(--brand); text-underline-offset: 4px; }
.repel { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.font-size-sm { font-size: 0.875rem; color: var(--mut); }
/* 240px floor (was 220px) so the square image below is genuinely LARGER, not just squarer — the
   both were asked for. auto-fill keeps the column count responsive, so this only widens cards when
   there is room; on a narrow viewport the track still collapses to one full-width column rather than
   overflowing. Paired with .uupg__image's aspect-ratio:1/1 this takes the image from a 220x130
   letterbox to a 240x240 square: ~2x the visible area, and the face is no longer cropped to a band. */
.grid.uupgs-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
/* Top-right, above the grid it controls. Logical inline-end so it mirrors under RTL. */
/* ★ INSET FROM THE CONTENT EDGE, not just from the viewport. .pgg-root already pads 16px, so the
   control was landing exactly level with the rightmost card's edge — technically inside the
   padding and still reading as flush, because the eye compares it to the card grid below it
   rather than to the plugin's border. The extra inline-end gives it room against that edge.
   Logical property, so it is the correct side under RTL without a second rule. */
.pgg-gridbar { display: flex; justify-content: flex-end; margin-bottom: 8px; padding-inline-end: 8px; }
.pgg-perrow { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--mut); }
.pgg-perrow select { font: inherit; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; }
.card.uupg__card {
  display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line);
  border-radius: 12px; overflow: hidden; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
/* SQUARE, NOT A LETTERBOX — the image is the point of the card.
   The images are larger, and closer to squares than to wide rectangles, so the
   people image is easier to see. The old rule was a fixed
   height:130px against a column that is at least 220px wide (see .grid.uupgs-list above), i.e. a
   220x130 letterbox — roughly 1.7:1 — which crops a standing person to a band and renders faces small.

   aspect-ratio:1/1 rather than a taller fixed height: the columns are fluid (auto-fill minmax(220px,
   1fr)), so ANY fixed pixel height re-letterboxes at a different viewport width. A ratio holds the
   square at every column width, which is the actual requirement.

   object-fit:cover is KEPT and is load-bearing — it was already correct. Switching to a square while
   letting the image stretch would distort faces, which is worse than the letterbox it replaces; cover
   crops instead of squashing. object-position defaults to centre, which suits these portraits.

   Consequence accepted: taller cards make the page longer. That is fine here — the grid is a
   scroll-page section, and in the cap-4 composite it sits BELOW a fixed-height dashboard band, so the
   page simply grows downward rather than fighting an inner-scroll region. */
.uupg__image { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: var(--line); }
.uupg__header { padding: 12px 14px 6px; }
.uupg__name { font-size: 1rem; font-weight: 700; line-height: 1.2; margin: 0 0 4px; }
.uupg__country { font-size: 0.85rem; color: var(--mut); margin: 0; }
/* Country is a LINK inside a muted line, so it needs a non-colour affordance: sage as a
   text colour is ~1.9:1 on white and unreadable. Ink + a sage underline reads as a link
   and passes contrast; the hover thickens rather than recolours. */
.uupg__country-link { color: var(--ink); font-weight: 600; text-decoration: underline; text-decoration-color: var(--brand); text-decoration-thickness: 1px; text-underline-offset: 2px; }
.uupg__country-link:hover { text-decoration-thickness: 2px; }
.uupg__match { font-size: 0.8rem; color: var(--mut); margin: 4px 0 0; }
.uupg__content { padding: 0 14px; font-size: 0.85rem; color: var(--mut); }
/* The primary action. --dx-accent-strong is a DELIBERATE darkened sage, not a new hue: the
   plain accent under white text is ~1.9:1, which is unreadable; the strong stop carries the
   same sage identity at a contrast a button label can actually be read at. */
.uupg__more-button {
  margin: 12px 14px 14px; padding: 8px 12px; text-align: center; font-size: 0.85rem; font-weight: 700;
  color: var(--dx-elevated, #fff); background: var(--dx-accent-strong, #657967); border-radius: 8px; text-decoration: none;
}
.uupg__more-button:hover { background: var(--dx-text, #3b463d); }
/* RULED EXCEPTION — amber stays. .search-highlight is not chrome: it is injected around the
   substring Fuse matched, so its whole job is to be conspicuous against body text. Sage on
   sage would erase the only thing it communicates. Same family as the map scrim and the
   data-viz ramp stops: semantic colour, out of scope for the palette sweep. */
.search-highlight { background: #fde68a; border-radius: 2px; padding: 0 1px; }
.loading, .pgg-empty { grid-column: 1 / -1; padding: 28px; text-align: center; color: var(--mut); font-size: 0.9rem; }
/* A LOAD FAILURE reads slightly heavier than an empty result, because it is a different KIND of
   message: "nothing matched" is normal operation, "the data did not arrive" is a fault the reader
   can act on. No new colour — the palette is material-light only and --mut is what this component
   already uses; weight and a hairline are enough to separate the two without adding an alarm state
   the design language does not have. */
.pgg-failed { font-weight: 600; border-top: 1px solid var(--bd, #d1d4cd); }
.pgg-loadmore {
  display: block; margin: 20px auto 0; padding: 8px 18px; font-size: 0.9rem; cursor: pointer;
  color: var(--ink); background: var(--card); border: 1px solid var(--brand); border-radius: 8px;
}
.pgg-loadmore:hover { background: var(--dx-accent-soft, rgba(146, 177, 149, .10)); }

/* ★ THE SEARCH AND FILTERS LOOK LIKE THE LIVE DX LIFE LIST (doxa.life/research, the list under the
   research map). These values are that page's own computed styles, measured at 390 and at 1440:
     - the pill search field, 51px tall, in the page's grey, with its 20px glass 19px in;
     - "Show filters" as an uppercase link, not a bordered button;
     - 37px dropdowns in the same grey, full width on a phone and up to 240px beside each other above one.
   Every selector starts at .pgg-root. The Big Picture bundle compiles this grid next to its own header,
   and that header uses the same shared SearchBar and FilterDropdown, which must not change; in Big
   Picture the grid's search and filters are off, so none of these rules finds an element there.
   The fonts name the live page's families first (Poppins; Brandon Grotesque for the link). Where the
   host page loads them, as DX Life does, the grid matches it; elsewhere the system stack after them shows. */
.pgg-root .filters { gap: 18px; }
.pgg-root .pgg-search .search-box .search-icon { left: auto; inset-inline-start: 19px; width: 20px; height: 20px; color: rgb(128, 128, 128); }
.pgg-root .pgg-search .search-box input {
  height: 51px; padding-block: 10px; padding-inline: 52px 24px;
  border: 1px solid rgb(128, 128, 128); border-radius: 100px; color: #000;
  font-family: Poppins, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 19.5px;
}
.pgg-root .pgg-search .search-box input::placeholder { color: rgb(128, 128, 128); }
/* A phone keeps the grid's own 15.2px text and insets inside the same pill. There the row pads the round
   ☰'s footprint on both sides whenever the ☰ rests in its corner (see .pgg-search--repel), which leaves the
   field about 230px wide at 390, and at the live list's 19.5px the placeholder does not fit in it. */
@media (max-width: 576px) {
  .pgg-root .pgg-search .search-box input { font-size: 0.95rem; padding-inline: 38px 12px; }
  .pgg-root .pgg-search .search-box .search-icon { inset-inline-start: 12px; width: 18px; height: 18px; }
}
.pgg-root .filters__toggle {
  background: none; border-color: transparent; border-radius: 100px; padding: 10px 42px; line-height: 1;
  font-family: 'Brandon Grotesque', Poppins, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 15.6px; font-weight: 400; text-transform: uppercase;
}
.pgg-root .filters__toggle-icon { display: none; }
.pgg-root .filters__panel { gap: 13px; }
.pgg-root .filters__panel .filter-dropdown { flex: 1 1 160px; min-width: 160px; max-width: 240px; }
@media (max-width: 576px) { .pgg-root .filters__panel .filter-dropdown { flex: 1 1 100%; max-width: 90vw; } }
.pgg-root .filters__panel .filter-dropdown__trigger {
  min-height: 37px; padding: 5px 13px; gap: 7.5px; border: 1px solid rgb(128, 128, 128);
  font-family: Poppins, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 15.6px;
}
</style>
