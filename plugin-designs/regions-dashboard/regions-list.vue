<script setup>
/**
 * regions-list.vue — Tab 1 ("Regions List") of the regions-dashboard bundle.
 *
 * @description A refactor of DX-life's /regions index page (app/pages/regions/index.vue) into
 *   an owned, self-contained doxa-maps custom element: one card per WAGF region, each holding
 *   its countries as a responsive list. Independently scrollable (the shell hosts this beside a
 *   sibling "Region Dashboards" tab and swaps between them). Clicking a region heading or a
 *   country row does NOT navigate — it EMITS a selection so the shell can switch to tab 2.
 *
 * SOURCE (READ-ONLY, copy-only — root-dx-life/doxa-life is standing law, zero edits):
 *   root-dx-life/doxa-life/app/pages/regions/index.vue        — the layout being ported
 *   root-dx-life/doxa-life/server/api/regions.get.ts           — the /api/regions contract
 *   root-dx-life/doxa-life/config/countries-meta.ts             — summarizeRegions() + fields
 *
 * WHY THIS FETCHES AND GROUPS ITSELF rather than calling /api/regions: that endpoint is a Nitro
 * server route inside the DX-life Nuxt app and is not reachable from a standalone embed. The
 * SAME live people-groups endpoint people-groups-grid.vue already uses (pray.doxa.life) carries
 * the same wagf_region / country_code fields the Nuxt route reads, so grouping happens here,
 * client-side, using the identical fields (PEOPLE_GROUP_LIST_FIELDS) and the identical rollup
 * shape (one row per country, rolled into one card per region) as countries-meta.ts's
 * summarizeRegions().
 *
 * ★ AND IT IS NOW ONE IMPLEMENTATION, NOT A COPY. This paragraph used to say the grouping was a
 * COPY of countries-meta.ts "not an import", because DX-life's file is a .ts module with a
 * Nuxt-only COUNTRIES import that cannot resolve outside that app. That was true when it was
 * written and it stopped being true when the file was ported to
 * library/utils/countries-meta.js: BOTH tabs now import summarizeRegions and
 * PEOPLE_GROUP_LIST_FIELDS from there, and grep finds exactly one definition in the repo.
 * Corrected because a comment that still describes the old shape is worse than no comment — the
 * next reader would have duplicated the rollup a third time on its authority. When a comment and
 * the code disagree, the comment is the one to distrust.
 *
 * EVENT CONTRACT (for the shell that nests this element — see RESULT-regions-list-element.md):
 *   region-selected  { slug, value, label, countryCount, count }   — region heading clicked
 *   country-selected { slug, code, name, region: {slug,value,label}, count }  — a country row clicked
 *   Both are emitted as a Vue `emit` AND as a native bubbling+composed CustomEvent on the host
 *   element (same double-emit pattern as people-groups-grid.vue's `groups-filtered`), so a plain
 *   host page hears it standalone and a Vue-nesting shell hears it as a prop-less DOM event.
 */
import { inject, ref, computed, onMounted, watch, getCurrentInstance } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'
import { SHADOW_BOX_SIZING_RESET } from './src/shadowReset.js'
import { splitLastWord } from './src/useLastWordHighlight.js'
import { useRegionsI18n } from '@map/i18n/useRegionsI18n.js'
import { useOptionalT } from '@map/composables/useOptionalT.js'
// ar renders right-to-left. RTL_LOCALES is the shared set and :dir on our own root is the
// house pattern (doxa-simple-map.vue:18, :246, :1346) — an EMBEDDED element must not reach for
// document.documentElement.dir, which belongs to the host page.
import { RTL_LOCALES, localeFromUrl } from '@map/i18n/index.js'
import { useI18n } from 'vue-i18n'
import { useDocumentFont, BEBAS_NEUE_FACES, POPPINS_FACES, FIGTREE_FACES, OSWALD_FACES } from '@map/composables/useDocumentFont.js'
import { summarizeRegions, PEOPLE_GROUP_LIST_FIELDS } from '@map/utils/countries-meta.js'
// DX-life's spacing/type scales under THEIR token names. Prepended to this
// component's shadow CSS so every var() below resolves inside the shadow root.
import { DXLIFE_TOKENS } from './dxlife-tokens.js'
// THE COUNTRY-POSTER DROPDOWN — the THIRD sanctioned addition, after the SELECT VIEW tab strip
// and the no-selection chooser. The requirement: a toggle at the bottom of each region section
// that opens that region's country posters.
//
// NOTHING HERE IS REBUILT. Each region's posters are the library's <dxm-poster-section type="country">
// (library/elements/posterSectionElement.js), the same section, cards and print options as the Country Posters
// wall, so the list is composed from the shared element rather than drawing a wall of its own. This file supplies
// only the toggle and the region.
import RegionSectionCard from '@map/components/regions/RegionSectionCard.vue'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { registerPosterSectionElement } from '@map/elements/posterSectionElement.js'
import { regionKey } from '@map/components/poster/types/countryPosterType.js'
import { onBeforeUnmount } from 'vue'
import { cyrillicHeading } from '@map/styles/portedGlobals.js'
import { hostElement } from '@map/utils/hostElement.js'

const props = defineProps({
  profileConfig: { type: String, default: '' },
  // Same standalone-dep pattern as people-groups-grid.vue: the people-groups API host.
  prayBaseUrl:  { type: String, default: '' },
  languageCode: { type: String, default: '' },
})

const emit = defineEmits(['region-selected', 'country-selected'])

// profile-config JSON can override prayBaseUrl / languageCode (single string attr).
// ★ THE CONFIG ARRIVES BY INJECT, NOT AS A PROP (measured 2026-09-23).
// The custom element this bundle registers IS ProfileLoader (index.js:41), which parses the
// profile-config ATTRIBUTE itself and hands the parsed object to its descendants via
// provide('profileConfig', config) (ProfileLoader.vue:195). So a profile component's own
// `profileConfig` STRING PROP is always empty, and every value read off it silently fell back
// to a default: prayBaseUrl, languageCode, instanceId and assetsBase alike. Nothing looked
// broken because the defaults happened to be right -- until assetsBase mattered, and the
// vendored Tabulator 404'd twice with no error while the table just never drew.
// Inject first, fall back to the prop so a direct <regions-dashboard profile-config='...'>
// outside ProfileLoader still works.
const injectedCfg = inject('profileConfig', null)
const cfg = computed(() => {
  const inj = injectedCfg && (injectedCfg.value !== undefined ? injectedCfg.value : injectedCfg)
  if (inj && typeof inj === 'object') return inj
  if (!props.profileConfig) return {}
  try { return JSON.parse(props.profileConfig) || {} } catch { return {} }
})
const prayBaseUrl  = computed(() => props.prayBaseUrl || cfg.value.prayBaseUrl || 'https://pray.doxa.life')
// The prayer API localises its LABELS from ?lang= — country names, region names, religion
// names. MEASURED: with locale=ar the UI translated but every country in the table stayed
// English, because this read only cfg.languageCode while the locale arrives as
// cfg.locale (ProfileLoader's contract, ProfileLoader.vue:156 accepts locale OR lang).
// Falling through to the same keys means translating the chrome also translates the data.
// ★ AND THE URL, LAST — the same fix region-dashboards.vue got, on the leaf that did not get it.
// I fixed the dashboard leaf and stopped, and the ENGLISH census could not see what was left:
// its ours-vs-theirs sets matched because both sides were in English. The ARABIC census found it
// on the first run — our h1 and subtitle rendered "المناطق" while all 41 country names in the
// table stayed "Angola", "Benin", "Cameroon". A shared /regions-list/?lang=ar link translated the
// chrome and then asked the prayer API in English, which is the defect this comment block already
// describes; it was only ever half fixed.
const languageCode = computed(() =>
  props.languageCode || cfg.value.languageCode || cfg.value.locale || cfg.value.lang || localeFromUrl() || '')
// Where the shared asset tree is served from: the generator bakes it per page depth and the
// composite forwards it via INHERITED_PAGE_KEYS. Needed for the vendored @font-face path below.
const assetsBase   = computed(() => cfg.value.assetsBase || './assets')
const { locale: i18nLocale } = useI18n()
const isRTL = computed(() => RTL_LOCALES.has(i18nLocale.value))

// ★ THEIR PAGE HEAD, WHICH THIS PROFILE DID NOT HAVE AT ALL.
// pages/regions/index.vue:47-58 opens with a centred .stack--xs of
// <h1 class="highlight" data-highlight-last>Regions</h1> and a .color-brand-lighter subtitle.
// We rendered only the region cards, so the standalone leaf page had no title and no strapline —
// invisible inside the composite, where the tab strip names the view, and plainly missing on
// /doxa-maps/regions-dashboard/regions-list/index.html, which is a page in its own right.
const { t, tf } = useRegionsI18n()
// ★ A SECOND TRANSLATOR, DELIBERATELY. useRegionsI18n's t() resolves DX-life's English sentences as
// keys inside the `regions` namespace only, which is what this page is cloned from. A dotted key in
// another area — messages.countryPosterTooMany — misses there and would render the literal string
// "messages.countryPosterTooMany" on the wall. tKey is vue-i18n's own lookup, for keys that live
// outside this page's namespace.
const tKey = useOptionalT('')
const headTitle = computed(() => splitLastWord(t('Regions')))

// ★ REGISTER BEBAS NEUE AT DOCUMENT LEVEL, not in the shadow root: @font-face is document-scoped
// and a face declared inside a shadow root is ignored. This profile registers it too, and not
// only tab 2, because its own leaf page (regions-list/index.html) is a standalone surface where
// tab 2 is not present — relying on a sibling would leave THIS page on the fallback face.
// Idempotent per document, so the composite still registers exactly one.
// ★ THE FONT BASE MUST BE ABSOLUTE, and this is the one place where that is not merely safer.
// @font-face is DOCUMENT-scoped: useDocumentFont injects a <style> into the HOST document, so a
// RELATIVE src resolves against the HOST PAGE, not against this bundle. On our own leaf that is
// invisible — the leaf's generated config says '../../assets' and the leaf really is two
// directories deep, so it resolves correctly. On a THIRD-PARTY PAGE it resolves against the
// partner's URL, the file is not there, and every face fails.
// MEASURED, which is the only reason I know: the cross-origin embed probe reported every
// FontFace in the partner document as status 'error' while the woff2 responses were 200 and the
// asset host was sending both access-control-allow-origin:* and content-type: font/woff2. Two
// wrong hypotheses died first — a missing CORS header (the server already sends it) and a check
// made before document.fonts.ready (fixed, still error). The URL was the answer.
// resolveAssetsBase exists for exactly this and its own header documents this bug class; the
// poster previews next door have used it all along. The font loader was the last consumer still
// taking the raw value.
const fontAssetsBase = resolveAssetsBase(cfg.value)
useDocumentFont('Bebas Neue', BEBAS_NEUE_FACES, fontAssetsBase)
// Poppins is their --font-family-base — the face of every line of BODY text on these
// pages. It was the larger of the two typography gaps and completely invisible to a
// computed-style diff, which read 68/68 while our body text was a system fallback 5.5%
// wider per glyph. Registered the same way and for the same reason as Bebas.
useDocumentFont('Poppins', POPPINS_FACES, fontAssetsBase)
// Figtree stands in for Brandon Grotesque, which is commercial and must not ship in a public
// giveaway. @font-face is DOCUMENT-scoped, so it registers here beside
// the other two rather than inside the shadow root that uses it.
useDocumentFont('Figtree', FIGTREE_FACES, fontAssetsBase)
// Oswald, for CYRILLIC HEADINGS ONLY. base/_globals.scss:35-44 switches every h1/h2/h3 to
// --font-family-cyrillic under [lang="ru-RU"], because BEBAS NEUE HAS NO CYRILLIC GLYPHS — their
// heading face cannot render Russian at all, so without the switch the heading leaves the family.
// We ship a `ru` locale and had neither the rule nor the font, so every Russian heading here was
// rendering in whatever condensed system face the browser picked.
useDocumentFont('Oswald', OSWALD_FACES, fontAssetsBase)

// ── state ───────────────────────────────────────────────────────────────────
const regions = ref([])
const loading = ref(true)
const loadFailed = ref(false)

// ── same field list the source page's PEOPLE_GROUP_LIST_FIELDS asks for ─────
// Their PEOPLE_GROUP_LIST_FIELDS, imported rather than restated — one list, one source.
// ★ THIS PAGE ASKS FOR TWO FIELDS, NOT EIGHT. The list page was reported slow, with the posters
// suspected; the posters are behind a v-if and never load until a region is opened. The cost
// was this fetch: it requested the full PEOPLE_GROUP_LIST_FIELDS for EVERY people group, then
// summarizeRegions computed population, adoption, engagement, commitment and pin lat/lngs from them —
// and this page renders NONE of that. It shows a region's label, its group count, its country count
// and its country names, all of which come from country_code and wagf_region alone. Verified by
// running summarizeRegions on two-field rows: the four values this page binds all come out.
// The shared PEOPLE_GROUP_LIST_FIELDS is left alone — the DASHBOARD tab genuinely needs all eight for
// its map pins and its stat cards, so this is a narrower request for a narrower page, not a change to
// what the list means.
const FIELDS = 'country_code,wagf_region'

function formatNumber(n) {
  // Theirs, RegionDetail.vue:16: n.toLocaleString(`${locale}-u-nu-latn`) — locale grouping
  // separators with Latin digits. Hardcoding en-US made de/fr/es wrong (they group with '.'
  // or a thin space). Same fix already applied in region-dashboards.vue.
  const v = Number(n || 0)
  try { return v.toLocaleString(`${i18nLocale.value || 'en'}-u-nu-latn`) } catch (_) { return v.toLocaleString('en-US') }
}

function summaryLine(region) {
  // THEIRS, pages/regions/index.vue:29-31:
  //   t('%count% people groups in %countries% countries')
  //     .replace('%count%', formatNumber(region.count))
  //     .replace('%countries%', formatNumber(region.countryCount))
  // This was a hardcoded English template, so /ru/regions rendered "315 people groups in 41
  // countries" while theirs reads "315 групп людей в 41 странах". The ru string was ALREADY in
  // library/i18n/locales/ru/regions.json — copied, never wired. Caught by reading the Russian
  // screenshot, not by any assertion.
  return tf('%count% people groups in %countries% countries', {
    count: formatNumber(region.count),
    countries: formatNumber(region.countryCount),
  })
}

// ── emit (Vue + native composed CustomEvent, same pattern as people-groups-grid) ────────────
const inst = getCurrentInstance()
const hostEl = () => hostElement(inst)
function dispatch(name, detail) {
  emit(name, detail)
  const el = hostEl()
  if (el && typeof el.dispatchEvent === 'function') {
    el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }
}

function selectRegion(region) {
  dispatch('region-selected', {
    slug: region.slug, value: region.value, label: region.label || t('Other'),
    countryCount: region.countryCount, count: region.count,
  })
}

function selectCountry(country, region) {
  dispatch('country-selected', {
    slug: country.slug, code: country.code, name: country.name,
    region: { slug: region.slug, value: region.value, label: region.label || t('Other') },
    count: country.count,
  })
}

// "See Africa dashboard" / "See Asia dashboard" — same wording pattern as DX-life's
// dashboardLink() in app/pages/regions/index.vue (t('See %region% dashboard')).
function dashboardLink(region) {
  // THEIRS: t('See %region% dashboard') — ru renders "Открыть панель: %region%", which is not
  // even the same word order, so a hardcoded English template could never be patched into it.
  // The translation was already catalogued; only the wiring was missing.
  return tf('See %region% dashboard', { region: region.label || t('Other') })
}

// ── data fetch (same live endpoint + fields as people-groups-grid.vue) ──────────────────────
async function loadRegions() {
  const url = `${prayBaseUrl.value}/api/people-groups/list?fields=${FIELDS}&lang=${languageCode.value}`
  loading.value = true
  loadFailed.value = false
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    // Only the groups of this page's people-group LIST (library/lists/).
    const posts = await applyPeopleGroupList(Array.isArray(data.posts) ? data.posts : [], injectedCfg)
    regions.value = summarizeRegions(posts)
  } catch (error) {
    console.error('[regions-list] fetch error:', error)
    loadFailed.value = true
    regions.value = []
  } finally {
    loading.value = false
  }
}

// ─── COUNTRY POSTERS, per region ─────────────────────────────────────────────
// One poster section per region, opened by the footer toggle: the library's <dxm-poster-section type="country">.
// Its scope is the region's key through the country type's own regionKey, so the list and the element can never
// spell a region two ways. It is not collapsible (the toggle already opens and shuts it) and shows two cards a row,
// on a phone as well.
// ⚠ The element files countries under the poster data's region (library/data/country-posters.json), so this list
// shows exactly that data's membership for each region.
registerPosterSectionElement()
const SECTION_EVENT = 'doxa-country-posters:show-on-map'
// Read off the injected config the same way every other value in this file is (see the note
// above cfg) — a bare default here would make two embeds on one page answer each other's
// poster events.
const instanceId = computed(() => cfg.value.instanceId || 'regions-list')
const posterAssetsBase = computed(() => resolveAssetsBase(cfg.value))
const sectionAttrs = (region) => ({
  type: 'country',
  scope: regionKey(region.value || region.label),
  locale: i18nLocale.value || languageCode.value || 'en',
  collapsible: 'false',
  columns: '2',
  // Two posters a row on a phone too, as this list has always shown them: 150 px lets two cards fit at 390.
  'min-card-px': '150',
  'assets-base': posterAssetsBase.value,
  // The same people-groups service this list reads its regions from, so a card's list and deck match it.
  'api-base-url': prayBaseUrl.value,
})
const openPosters = ref(new Set())

function togglePosters(region) {
  const next = new Set(openPosters.value)
  next.has(region.slug) ? next.delete(region.slug) : next.add(region.slug)
  openPosters.value = next // a new Set, so the computed template actually re-renders
}
const postersOpen = (region) => openPosters.value.has(region.slug)

// A poster card's "Show on map" dispatches a window CustomEvent carrying listId (the poster id,
// e.g. "country-chn") or null when the user toggles the same card off. Mapping that id back to
// the country record and reusing selectCountry() is what makes the button open the dashboard
// tab for that country: the requirement is that the view-on-map button opens the country
// dashboard page for that country.
// The library's poster sections name themselves 'poster-section-country-<region>' (PosterSectionView.vue); selecting
// through selectCountry() keeps the region context in the selection.
function onPosterShowOnMap(ev) {
  const d = ev?.detail || {}
  if (!String(d.instanceId || '').startsWith('poster-section-country-')) return
  if (!d.listId) return // a deselect is not a navigation
  const iso3 = String(d.listId).replace(/^country-/, '').toUpperCase()
  for (const region of regions.value) {
    const hit = (region.countries || []).find(c => String(c.code || '').toUpperCase() === iso3)
    if (hit) { selectCountry(hit, region); return }
  }
}

// A LOCALE CHANGE MUST REFETCH, not just re-render. The region and country LABELS come from
// the API's ?lang=, not from the i18n catalogue — MEASURED on their live site, which serves
// "Азия"/"Африка"/"Азербайджан (3)" on /ru/regions against "Africa"/"Angola" on /regions. With
// no watcher this tab kept whatever labels the first fetch returned, so switching to Russian
// translated the chrome and left every region and country name in English. region-dashboards.vue
// already had this watcher (line 541); this tab was simply missed.
watch(languageCode, () => { loadRegions() })

onMounted(() => { if (typeof window !== 'undefined') window.addEventListener(SECTION_EVENT, onPosterShowOnMap) })
onBeforeUnmount(() => { if (typeof window !== 'undefined') window.removeEventListener(SECTION_EVENT, onPosterShowOnMap) })

onMounted(loadRegions)

// Design values are a DIRECT PORT of DX-life's live /regions page (root-dx-life/doxa-life —
// read-only, standing law), not our own judgement. DX-life's <html> sets
// `font-size: var(--font-size-base)` = 10px as its rem root (app/assets/styles/base/_globals.scss),
// so every rem token below is resolved against a 10px root, NOT the browser's 16px default — e.g.
// their --border-radius-xlg: 3.5rem is 35px, not 56px. Values were cross-checked two ways: hand-
// resolving the SCSS token files (tokens/semantic/_spacing.scss, _shapes.scss, _colors.scss,
// _typography.scss) AND reading getComputedStyle() live on https://doxa.life/regions — both agree.
// Colours/fonts/radii are an intentional exception to this repo's material-light chrome tokens —
// an exact clone of DX-life's OWN design is required here, so the clone wins.
useShadowStyles(
  // Their _reset.scss:3-8 FIRST -- see src/shadowReset.js.
  SHADOW_BOX_SIZING_RESET +
  DXLIFE_TOKENS +
  ':host{ display:block; position:relative; width:100%; height:100%; min-height:320px; }' +
  '.rl-root{ position:absolute; inset:0; display:flex; flex-direction:column; min-height:0;' +
  // --dx-surface = --color-surface-default ($color-beige-50); --dx-elevated = --color-surface-white
  // --dx-text = --color-text-on-default ($color-green-600 #2a332a) -- body copy on the light page bg
  // --dx-header-bg = --color-surface-brand ($color-green-500 #3b463d) -- the card header band
  // --dx-header-text = --color-text-on-brand (#fff); --dx-link = --color-brand-light ($color-green-400 #4e594f)
  // --dx-muted = --color-brand-lighter (colors.scss redeclares this twice; 2nd wins: $color-green-300 #6d766e)
  // --dx-line = --color-brand-secondary-light ($color-beige-200 #d1d4cd)
  '  --dx-surface:#f3f3f1; --dx-elevated:#fff; --dx-text:#2a332a; --dx-header-bg:#3b463d;' +
  '  --dx-header-text:#fff; --dx-link:#4e594f; --dx-muted:#6d766e; --dx-line:#d1d4cd;' +
  '  --dx-radius:35px;' +
  '  background:var(--dx-surface); color:var(--dx-text);' +
  '  font:var(--font-size-md)/1.5 Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,sans-serif; }' +
  // container-type:inline-size makes this pane the query container for the cqw units below.
  // DX-life sizes those with 4vw (the VIEWPORT), which is right for a full-page route and wrong
  // for us: this element is also one pane of the regions-mfe composite, where the viewport is not
  // the width available. cqw honours their DECISION (scale with the width you actually have)
  // rather than transcribing a unit that only works in their layout. Same primitive already used
  // in research-dashboard.vue:284. Safe here because nothing in this element is position:fixed --
  // inline-size containment is what made a fixed scrim pane-relative in check:scrim-viewport.
  // Side padding is deliberately 0: the .container formula below supplies the gutter, as theirs does.
    // ★ scrollbar-gutter: stable — ported from their base/_globals.scss html rule, and it is
  // LOAD-BEARING for layout, not cosmetic. MEASURED at 390px: their container is 353.5px
  // and ours was 367px, because their html reserves the scrollbar gutter always and our
  // scroller did not. 13.5px, invisible at 1440 where both cap at 1200 — which is exactly
  // why a desktop-only diff read 68/68 while every mobile width was wrong.
  // Worse, it CASCADED: at 768 our container came out 707.2px and theirs 693.7px, and
  // their .switcher flips at 700px of container — so their three goal cards stacked and
  // ours stayed three-across. One missing property, a different layout.
  // We cannot set this on the host document from inside a shadow root, and should not;
  // this element's own scroller is the box every child measures against.
'.rl-scroll{ flex:1 1 auto; min-height:0; overflow-y:auto; scrollbar-gutter:stable; -webkit-overflow-scrolling:touch;' +
  '  padding:20px 0; display:flex; flex-direction:column; gap:var(--spacing-lg);' +
  '  container-type:inline-size; }' +
  // ★ THE DESKTOP MAX-WIDTH, ported verbatim from DX-life's .container
  // (app/assets/styles/composition/_container.scss), which BOTH /regions and /regions/<slug> use:
  //     --container-max-width:1200px; --screen-min-width:320px; --min-margin:8px;
  //     width: calc(90% + (10/100 * 320px) - (2 * 8px))  ->  calc(90% + 16px)
  //     max-width: 1200px; margin-left/right: auto
  // So it is FLUID at 90%+16px until the viewport reaches 1315.625px, then pinned at 1200px centred.
  // Our cards previously stretched to the full pane at every width -- there was no cap at all.
  // box-sizing:border-box so .rl-status's own padding (--spacing-xl) stays inside the cap.
  '.rl-scroll > *{ width:calc(90% + 16px); max-width:1200px;' +
  '  margin-left:auto; margin-right:auto; }' +
  // Their head block: .stack--xs (10px) gap, centred. h1 is _globals' clamp(--font-size-3xl,
  // 7vw, --font-size-5xl) and the subtitle is --font-size-md in --color-brand-lighter.
  // cqw not vw, for the same composite-pane reason as every other clamp here.
  // ★ THEIR REDUCED-MOTION RESET, which a shadow boundary had been swallowing.
  // base/_reset.scss:66-79 is `@media (prefers-reduced-motion: reduce) { *, *::before, *::after {
  // animation-duration:.01ms!important; animation-iteration-count:1!important;
  // transition-duration:.01ms!important; scroll-behavior:auto!important } }` -- a DOCUMENT-level
  // universal selector, so it styles nothing inside a shadow root. The same boundary swallowed
  // their box-sizing reset.
  // It matters because we ported their animation faithfully: their RegionDetail.vue:209 and our
  // .rd-seg / .rd-bar__slider both carry `transition: width 1s ease-out`. MEASURED with
  // emulateMedia on the segment that actually carries it -- theirs goes 1s -> 1e-05s under reduce,
  // ours stayed 1s -> 1s. So a vestibular visitor got a full one-second sliding bar from us that
  // their own site suppresses: a clone difference and an accessibility regression in one.
  // Their `html:focus-within{scroll-behavior:auto}` half is deliberately NOT ported -- a shadow
  // root cannot style the host document's html element, and the leaf page owns that.
  '@media (prefers-reduced-motion: reduce){' +
  '  .rl-root, .rl-root *, .rl-root *::before, .rl-root *::after{' +
  '    animation-duration:0.01ms !important; animation-iteration-count:1 !important;' +
  '    transition-duration:0.01ms !important; scroll-behavior:auto !important; } }' +
  '.rl-head{ display:flex; flex-direction:column; gap:10px; text-align:center; }' +
  // NO text-transform. MEASURED on their live h1, both locales: text-transform is `none`
  // (/regions and /ru/regions alike). This rule used to force uppercase, which is INVISIBLE in
  // English because Bebas Neue is an all-caps face — and wrong the moment the text is not Latin:
  // Bebas carries no Cyrillic, so /ru falls back to a normal system face and their heading reads
  // "Регионы" while ours read "РЕГИОНЫ". The same conclusion is already written out for
  // .region-card__title below ("DX-life applies NO transform on top of the font"); this rule was
  // simply missed, and no check caught it because the vs-live property diff covers the DASHBOARD
  // tab's .rd-title, never this one. _probe-list-vs-live.mjs now covers it.
  '.rl-title{ margin:0; font-size:clamp(var(--font-size-3xl), 7cqw, var(--font-size-5xl)); line-height:1;' +
  '  font-family:"Bebas Neue","Arial Narrow",BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;' +
  '  font-weight:400; }' +
  '.rl-title__last{ color:#92b195; }' +
  '.rl-summary{ margin:0; color:var(--dx-muted); font-size:var(--font-size-md); }' +
  '.rl-status{ padding:var(--spacing-xl); text-align:center; color:var(--dx-muted); font-size:var(--font-size-md); }' +
  '.rl-status.rl-failed{ font-weight:600; }' +
  // ★ CYRILLIC HEADINGS SWITCH FACE, as theirs do. base/_globals.scss:35-44:
  //     h1,h2,h3 { [lang="ru-RU"] & { font-family: var(--font-family-cyrillic); letter-spacing: -0.02em } }
  // and --font-family-cyrillic is Oswald. The switch is not decoration: BEBAS NEUE HAS NO CYRILLIC
  // GLYPHS, so a Russian heading in it leaves the family entirely and lands on whatever condensed
  // system face the browser picks. We ship a `ru` locale and had neither the rule nor the font.
  // ONLY the headings, exactly as theirs — their .region-stat__value is a <p> and keeps Bebas even in
  // Russian, which is their behaviour and so is ours.
  // BOTH TAG FORMS, deliberately: their site tags the document ru-RU while our i18n locale is `ru`,
  // and a host page embedding this element may set either. A selector that matched only one would
  // work on their site and fail on ours, or the reverse, depending on who set the attribute.
  // ★ THIS RULE WAS INERT AND ATE THE STYLE-ID. It used to end with a trailing comma and no
  // declaration block, so the concatenation emitted
  //     [lang="ru"] .rl-title, [lang="ru-RU"] .rl-title,regions-list
  // — a selector list with nothing to apply, so the Russian heading font never applied, and
  // useShadowStyles' style-id argument was consumed as CSS, leaving the sheet unlabelled. Braces
  // stayed balanced, so nothing caught it for weeks. check:shadow-css-parses now has an arm that
  // does (SELECTOR WITH NO BLOCK), and this file is its poison test.
  cyrillicHeading('.rl-title'),
  'regions-list'
)
</script>

<template>
  <!-- :lang is here for the SAME REASON :dir is: a [lang=] selector in this shadow root cannot
         see the host document's attribute, so the switch their global sheet performs on
         [lang="ru-RU"] can only fire if the attribute is INSIDE the root. It is also simply
         correct HTML — screen readers and hyphenation read it. -->
    <div class="rl-root" :lang="i18nLocale" :dir="isRTL ? 'rtl' : 'ltr'">
    <!-- THEIR ICON, DELIVERED THE WAY THEIR MARKUP DELIVERS IT. Theirs is
         <svg class="icon | rotate-90 right"><use href="/assets/icons/arrow-chevron.svg#chevron-up"/></svg>
         — one <use> reference, not a path repeated per call site.
         MEASURED BEFORE CHOOSING, because I assumed the platform forced the inline copy and it
         does not: an external <use href="file.svg#id"> renders in Chromium, renders INSIDE a
         shadow root, and a local <symbol> + <use href="#id"> renders too — bbox 410x234 in all
         three cases.
         WHAT IS ACTUALLY FORCED IS THE EXTERNAL HREF, not the mechanism. A dropped bundle
         resolves assets against whatever tree it sits in, and generate-tree stages an allowlist
         with no icons/ dir, so an external href would 404 SILENTLY and the chevron would simply
         vanish. Same reason worldmap.svg arrives through an imagesBase prop instead of their bare
         `const imagesUrl = '/assets/images'`.
         So: their 454-byte file's path verbatim, as a <symbol> declared ONCE, referenced by
         <use href="#chevron-up"> exactly as their markup does. No external fetch, and the path is
         no longer copied three times. -->
    <svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
      <symbol id="chevron-up" viewBox="0 0 489.67 289.877">
        <path d="M439.017,211.678L263.258,35.919c-3.9-3.9-8.635-6.454-13.63-7.665-9.539-2.376-20.051.161-27.509,7.619L46.361,211.632c-11.311,11.311-11.311,29.65,0,40.961h0c11.311,11.311,29.65,11.311,40.961,0L242.667,97.248l155.39,155.39c11.311,11.311,29.65,11.311,40.961,0h0c11.311-11.311,11.311-29.65,0-40.961Z" />
      </symbol>
    </svg>
    <div class="rl-scroll">
      <!-- pages/regions/index.vue:47-58 — their centred head: the title with its last word
           in brand primary, and the strapline underneath. -->
      <div class="rl-head">
        <h1 class="rl-title">{{ headTitle.head ? headTitle.head + ' ' : '' }}<span class="rl-title__last">{{ headTitle.last }}</span></h1>
        <p class="rl-summary">{{ t('Find unreached people groups by region and country.') }}</p>
      </div>
      <!-- THEIR string, not a new one: 'Loading results...' is in their common.json and so is
           already translated in all eight locales. Their /regions is server-rendered and has no
           loading state of its own, but reusing their wording beats inventing English here. -->
      <div v-if="loading" class="rl-status">{{ t('Loading results...') }}</div>
      <div v-else-if="loadFailed" class="rl-status rl-failed" role="status">{{ t('Region data could not be loaded. This is a connection problem, not a filter.') }}</div>
      <div v-else-if="!regions.length" class="rl-status">{{ t('No regions found.') }}</div>

      <template v-else>
        <RegionSectionCard
          v-for="region in regions"
          :key="region.slug"
          :title="region.label || t('Other')"
          :summary="summaryLine(region)"
          :countries="region.countries"
          :footer-label="dashboardLink(region)"
          :disclosure-label="postersOpen(region) ? t('Hide country posters') : t('View country posters')"
          :disclosure-open="postersOpen(region)"
          :disclosure-id="`posters-${region.slug}`"
          @toggle-disclosure="togglePosters(region)"
          @select="selectRegion(region)"
          @select-country="(c) => selectCountry(c, region)"
        >
          <template #extra>
            <dxm-poster-section v-bind="sectionAttrs(region)" />
          </template>
        </RegionSectionCard>
      </template>
    </div>
  </div>
</template>
