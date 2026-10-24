<script setup>
/**
 * region-dashboards.vue — Tab 2 ("Region Dashboards") of the regions-dashboard bundle.
 *
 * @description The dashboard half of the 2-tab Regions element: given a region (or a
 *   single country inside one), it summarises that selection — headline stats plus a comparison
 *   of its countries — using the SAME live people-groups endpoint and the SAME rollup fields as
 *   regions-list.vue (tab 1), so the two tabs can never disagree about a number.
 *
 * HOW IT LEARNS WHAT TO SHOW. This element is deliberately not wired to tab 1 directly. It takes
 * its selection from its own `profile-config` (keys `regionSlug` / `countrySlug`) and ALSO listens
 * for a scoped window event, 'doxa-regions-dashboard:select'. The composite (regions-mfe.vue)
 * nests both tabs as sibling custom elements and forwards tab 1's `region-selected` /
 * `country-selected` onto that event, scoped by instanceId — the same cross-pane seam
 * upg-100-mfe.vue uses for the poster wall's 'doxa-upg-100-list:show-on-map'. Keeping the seam an
 * EVENT (not a prop) is what lets each tab keep its own ProfileLoader/Pinia and still stay in sync.
 *
 * WITH NO SELECTION it shows every region compared against each other, so the tab is meaningful
 * standalone (and on first paint, before anything has been clicked) rather than an empty state.
 *
 * SOURCE for the grouping logic: library/utils/countries-meta.js — the port of DX-life's
 * config/countries-meta.ts. BOTH tabs import summarizeRegions and PEOPLE_GROUP_LIST_FIELDS from
 * there, so "kept field-for-field identical" is no longer a discipline anyone has to maintain: it
 * is the same function. This paragraph previously said the logic was copied from regions-list.vue
 * rather than imported, which was true before the port and false afterwards.
 */
import { inject, ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { readViewKeys, claimView, urlOwnerOf, commitUrl, onAddressChange } from '@map/composables/useViewAddress.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'
// ar renders right-to-left. RTL_LOCALES is the shared set and :dir on our own root is the
// house pattern (doxa-simple-map.vue:18, :246, :1346) — an EMBEDDED element must not reach for
// document.documentElement.dir, which belongs to the host page.
import { RTL_LOCALES, localeFromUrl } from '@map/i18n/index.js'
import { resolveAssetsBase, resolveEmbedBase } from '@map/utils/embedBase.js'
import { loadScriptOnce, whenTagDefined } from '@map/utils/embedScript.js'
import { useDocumentFont, BEBAS_NEUE_FACES, POPPINS_FACES, FIGTREE_FACES, OSWALD_FACES } from '@map/composables/useDocumentFont.js'
import FilterDropdown from '@map/components/search/FilterDropdown.vue'
import UupgsList from './src/UupgsList.vue'
// Their strings, via their own English keys (see @map/i18n/useRegionsI18n.js). The goal sentences,
// the stat labels and the table headers are all t() calls on their page; hardcoding the
// English was the last thing keeping this clone monolingual.
import { useRegionsI18n } from '@map/i18n/useRegionsI18n.js'
import { splitLastWord } from './src/useLastWordHighlight.js'
// Region colours come from the shared strategy (check:one-palette), and REGION_ORDER is the
// order its CVD separation was validated in — the legend must render in it for that to hold.
import { PALETTE as REGION_PALETTE, WAGF_REGIONS, REGION_ORDER } from '@map/colors/wagf-region.js'
// DX-life's spacing/type scales under THEIR token names. Prepended to this
// component's shadow CSS so every var() below resolves inside the shadow root.
import { DXLIFE_TOKENS } from './dxlife-tokens.js'
import RegionCountryMap from '@map/components/maps/RegionCountryMap.vue'
// The ONE print mechanism (five copies of this busy state exist in the repo; this is the shared one).
import { printWhenReady } from '@map/composables/printInPlace.js'
// REGLIB batch 2: the stat card, the three goal cards and their bars are library components now.
// They carry their own shadow CSS (useShadowStyles) and the card surface they share, so the rules
// for .rd-card / .rd-stat* / .rd-goal* / .rd-big* / .rd-bar* / .rd-legend are no longer below.
import StatCard from '@map/components/regions/StatCard.vue'
import GoalCard from '@map/components/regions/GoalCard.vue'
import ProgressBar from '@map/components/charts/ProgressBar.vue'
import BackToTopButton from '@map/components/BackToTopButton.vue'
import { SHADOW_BOX_SIZING_RESET } from './src/shadowReset.js'
import { summarizeRegions, emptyStats, toNumber, PEOPLE_GROUP_LIST_FIELDS } from '@map/utils/countries-meta.js'
import { peopleGroupPoints, PEOPLE_GROUP_POINT_FIELDS } from '@map/utils/peopleGroupPoints.js'
import { cyrillicHeading } from '@map/styles/portedGlobals.js'

const props = defineProps({
  profileConfig: { type: String, default: '' },
  prayBaseUrl:  { type: String, default: '' },
  languageCode: { type: String, default: '' },
})

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
// Their popup's second button. RegionDetail passes CountryMap `:research-url="localePath('/research') + '/'"`;
// we have no router, so it comes from profile-config with their public site as the default —
// the same ladder and the same default UupgsList.vue:74 already uses.
const researchUrl  = computed(() => cfg.value.researchUrl || 'https://doxa.life/research/')
// Where a country NAME links, as distinct from where a people group's profile lives. DX-life sends
// it to its own /regions/<slug> page, so a host embedding us keeps that under its own control.
const countryUrl   = computed(() => cfg.value.countryUrl || 'https://doxa.life/regions/')
// The prayer API localises its LABELS from ?lang= — country names, region names, religion
// names. MEASURED: with locale=ar the UI translated but every country in the table stayed
// English, because this read only cfg.languageCode while the locale arrives as
// cfg.locale (ProfileLoader's contract, ProfileLoader.vue:156 accepts locale OR lang).
// Falling through to the same keys means translating the chrome also translates the data.
// ★ AND THE URL, LAST. The prayer API localises its LABELS from its own lang parameter, so the
// region and country NAMES follow whatever this resolves to. Reading only props and profile-config
// meant a SHARED LINK — /region-dashboards/?lang=ar, the URL a person actually sends someone —
// translated the chrome through detectLocale() and then asked the API in English. MEASURED: 597
// Arabic chrome characters via profile-config against 309 via ?lang=ar on this leaf, and the whole
// gap was the seven region names in the chooser legend plus the seven in the table.
// localeFromUrl() is the library's own reader, imported rather than re-implemented, so the data
// call and the chrome can never disagree about what the URL asked for.
const languageCode = computed(() =>
  props.languageCode || cfg.value.languageCode || cfg.value.locale || cfg.value.lang || localeFromUrl() || '')
const instanceId   = computed(() => cfg.value.instanceId || '')
// THE CAP-4 ASSET-PATH LESSON (BUG-UPG100MFE-ASSET-PATH, and it bit again here): DataTable
// injects the vendored Tabulator from a path RELATIVE to the document. Nested inside the
// regions-mfe composite the document is .../regions-mfe/index.html, so './assets' resolved to
// .../regions-mfe/assets/vendor/tabulator/* and 404'd twice with no visible error -- the table
// simply never drew. The generator bakes the right base per page depth and regions-mfe.vue
// already forwards it in INHERITED_PAGE_KEYS; this reads it instead of trusting the default.
const assetsBase   = computed(() => cfg.value.assetsBase || './assets')

// ★ REGISTER BEBAS NEUE AT DOCUMENT LEVEL, not in the shadow root: @font-face is
// document-scoped and a face declared inside a shadow root is ignored. Their headings ARE
// this font (tokens/semantic/_typography.scss:5) and it could not be loaded from their
// origin — no CORS headers — so it is vendored under public/assets/fonts/bebas-neue (OFL,
// provenance in LICENSE.txt beside it). Loading it deleted an uppercase imitation and two
// stepped-down font-sizes that only existed because the fallback face was wider.
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
const { t, tf , locale } = useRegionsI18n()
// syncTitle() shadows `t` with the subject title, so it needs a second handle on the
// translator. Same function, different name — not a second i18n instance.
const t2 = t
// their <h1 class="highlight" data-highlight-last> — the final word in brand primary
const titleParts = computed(() => splitLastWord(subject.value?.title || ''))
const isRTL = computed(() => RTL_LOCALES.has(locale.value))

const regions = ref([])
// The rollup aggregates records away, and the map needs them one by one. Kept flat and
// pre-parsed once here rather than re-fetched inside the map child, as DX-life's CountryMap
// does -- one request per element, and the pins provably describe the same rows as the stats.
const points = ref([])
// The scroll container the back-to-top arrow drives. It is .rd-scroll rather than the window:
// this plugin renders inside a shadow root in someone else's page, so the page's scroll is not
// ours to move and may not even be the one the reader is using.
const scrollEl = ref(null)
const loading = ref(true)

// ★ PRINT — the half the @media print rules could not do. The reported complaint was
// "no loading indicator on a click": the reader presses Print, the dialog takes a second to
// rise, and nothing on the page says anything is happening. Worse on this page than most, because
// what the dialog is waiting for is a MAP — press it a moment early and the sheet carries a grey
// rectangle where the map should be.
const printing = ref(false)
const mapEl = ref(null)

async function printDashboard() {
  if (printing.value) return           // a second click during the wait must not start a second print
  await printWhenReady({
    // Ask the map itself. Absent (no map on this view, or it failed) the array is empty and we
    // print straight away, which is correct: there is nothing to wait for.
    waitFor: mapEl.value?.whenIdle ? [mapEl.value.whenIdle({ timeoutMs: 7000 })] : [],
    onBusy: (v) => { printing.value = v },
    // Under the map's own ceiling, so the map decides it first and this is only the backstop.
    timeoutMs: 8000,
  })
}
const loadFailed = ref(false)
// The current selection, as { regionSlug, countrySlug } — seeded from profile-config so a
// standalone embed can deep-link straight to one region's dashboard.
const sel = ref({
  regionSlug: cfg.value.regionSlug || '',
  countrySlug: cfg.value.countrySlug || '',
})

// ── identical field list + rollup to tab 1 ──────────────────────────────────
// A SUPERSET of tab 1's list: name + slug are added for the map popups and the country
// people-group list. Every ROLLUP field is unchanged, so the two tabs still roll up
// identically -- the extra fields are read by the map, never by addToStats().
// Their PEOPLE_GROUP_LIST_FIELDS plus the two this tab's map needs (name, slug) — derived
// from the shared list so the two can never drift apart.
// ★ PLUS THEIR FIVE POPUP FIELDS. CountryMap.vue:89 fetches
//   name,slug,country_code,rop1,religion,population,location_description,image_url,has_photo,
//   latitude,longitude,people_committed
// and their pin popup renders every one of them. Ours fetched neither rop1, religion,
// location_description nor the photo, so the popup COULD NOT have been a clone however it was
// written — the data was not on the page. Same one request, five more columns.
// ★ imb_people_description, NOT location_description. Their CountryMap's PIN_FIELDS names
// imb_people_description and the popup binds it (CountryMap.vue:89 and :114 on MASTER); the
// doxa-maps-build branch this repo's checkout is parked on still says location_description, and
// that is what we had cloned. The two are different prose: location_description says where a
// people live, imb_people_description describes the people. So our popup was showing the wrong
// paragraph — visible content, not a field-name detail.
const FIELDS = PEOPLE_GROUP_POINT_FIELDS + ',' + PEOPLE_GROUP_LIST_FIELDS

function formatNumber(n) {
  // THEIRS, RegionDetail.vue:16: `n.toLocaleString(`${locale.value}-u-nu-latn`)` — locale
  // grouping separators with Latin digits. This was hardcoded 'en-US', which is only
  // correct for English: de/fr/es group with '.' and ar would otherwise get Arabic-Indic
  // digits. The -u-nu-latn keeps Latin digits, which is the half theirs pins deliberately.
  // A bad tag throws RangeError in toLocaleString, so fall back rather than blank the page.
  const v = Number(n || 0)
  try { return v.toLocaleString(`${locale.value || 'en'}-u-nu-latn`) } catch (_) { return v.toLocaleString('en-US') }
}


// ── the selected subject ────────────────────────────────────────────────────
const selectedRegion = computed(() =>
  regions.value.find((r) => r.slug === sel.value.regionSlug) || null
)
const selectedCountry = computed(() => {
  if (!sel.value.countrySlug) return null
  const r = selectedRegion.value
  const pool = r ? r.countries : regions.value.flatMap((x) => x.countries)
  return pool.find((c) => c.slug === sel.value.countrySlug) || null
})

// ★ THE COUNTRY'S POSTER, UNDER ITS MAP. The country view carries the Regions list's own disclosure,
// "View country posters". Opening it loads the Country Posters bundle ONCE, as its own element (so this
// bundle does not grow by a poster wall), and mounts that wall filtered to this one country: its
// profile-config `countries` filter, flat, one card with the Regions list's print row. A new country closes
// it, because the wall belongs to the country it was opened for. The asset pool goes over ABSOLUTE
// (resolveAssetsBase): a relative base would resolve against whichever page hosts this dashboard.
const POSTER_WALL_TAG = 'country-posters-map'
const POSTER_WALL_KEYS = ['apiBaseUrl', 'prayBaseUrl', 'tokenUrl', 'dataSource', 'locale', 'lang', 'languageCode', 'isDark', 'provider', 'embedBaseUrl']
const postersOpen = ref(false)
const postersHost = ref(null)
// One wall per country, and per dashboard: the id scopes the wall's "Show on map" event to this one.
const posterWallId = (iso3) => `${instanceId.value || 'region-dashboards'}-poster-${String(iso3).toLowerCase()}`
function posterWallConfig(iso3) {
  const c = cfg.value || {}
  // columns:1 — one card, centred under the toggle by .rd-posters__wall (a two-column grid left it off to one side).
  const out = { profile: 'country-poster-wall', countries: [iso3], columns: 1, instanceId: posterWallId(iso3), assetsBase: resolveAssetsBase(c) }
  for (const k of POSTER_WALL_KEYS) if (c[k] != null && c[k] !== '') out[k] = c[k]
  if (!out.languageCode && languageCode.value) out.languageCode = languageCode.value
  return out
}
async function togglePosters() {
  postersOpen.value = !postersOpen.value
  const iso3 = selectedCountry.value?.code
  const host = postersHost.value
  if (!postersOpen.value || !iso3 || !host || host.firstElementChild) return
  try {
    if (!customElements.get(POSTER_WALL_TAG)) {
      const base = resolveEmbedBase(cfg.value)
      await loadScriptOnce(`${base ? base + '/' : ''}country-posters/country-posters.js`)
      await whenTagDefined(POSTER_WALL_TAG, 15000)
    }
    // The reader may have moved on while the bundle loaded.
    if (selectedCountry.value?.code !== iso3 || host.firstElementChild) return
    const el = document.createElement(POSTER_WALL_TAG)
    el.setAttribute('profile-config', JSON.stringify(posterWallConfig(iso3)))
    host.appendChild(el)
  } catch (e) {
    // Offline or blocked: the disclosure closes again, and the next tap retries (loadScriptOnce forgets a
    // failed load). No sentence of its own: one new catalogue key would change every bundle's locale data.
    postersOpen.value = false
    console.warn('[region-dashboards] the country poster wall did not load:', e && e.message)
  }
}
watch(() => selectedCountry.value?.code, () => {
  postersOpen.value = false
  if (postersHost.value) postersHost.value.replaceChildren()
})
// The card's "Show on map": the country is already this view's subject, so it brings the map above back into
// view. Only this dashboard's own wall (its instanceId) answers here; clearing the toggle (listId null) does not.
const POSTER_WALL_EVENT = 'doxa-country-posters:show-on-map'
function onPosterShowOnMap(e) {
  const d = e?.detail || {}
  const iso3 = selectedCountry.value?.code
  if (!iso3 || !d.listId || d.instanceId !== posterWallId(iso3)) return
  const el = mapEl.value && mapEl.value.$el
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
}

// The subject line — a country if one was clicked, else the region, else everything.
const subject = computed(() => {
  if (selectedCountry.value) {
    const c = selectedCountry.value
    return { kind: 'country', title: c.name, context: c.region?.label || t('Other'), stats: c }
  }
  if (selectedRegion.value) {
    const r = selectedRegion.value
    return { kind: 'region', title: r.label || t('Other'), context: tf('Countries: %count%', { count: formatNumber(r.countryCount) }), stats: r }
  }
  const all = emptyStats()
  for (const r of regions.value) {
    all.count += r.count; all.population += r.population; all.adopted += r.adopted
    all.engaged += r.engaged; all.withPrayer += r.withPrayer
    all.withFullPrayer += r.withFullPrayer; all.peopleCommitted += r.peopleCommitted
  }
  // t('All Regions'), not the literal. Their own key, translated in all eleven locales
  // ('جميع المناطق' at ar), and this file ALREADY calls t('All Regions') for the back-link —
  // so the same string was translated in one place and hardcoded in another. MEASURED at ar
  // and zh: this title rendered English inside an otherwise fully localised element.
  return { kind: 'all', title: t('All Regions'), context: tf('Regions: %count%', { count: formatNumber(regions.value.length) }), stats: all }
})

// ★ NO BAR CHART. It was ours, not theirs, and the rule is that a SELECTED region or country
// must look IDENTICAL to its DX-life page — RegionDetail.vue has four stat cards, the map, three
// goal cards and the country table, and nothing else. The one deliberate difference in this
// element is the NO-SELECTION state below, which their site has no route for at all.

// ── DX-life's RegionDetail, field for field ──────────────────────────────────
// Ported from root-dx-life/doxa-life/app/components/public/RegionDetail.vue (read-only clone,
// standing law). Every figure below is one THEIR component also computes, from the rollup we
// already had -- nothing here is a new metric we invented to fill a card.

// Their prayer split, RegionDetail.vue:24-26: fully covered (100+ committed), partially covered
// (1+), and nobody yet. partial/none are DERIVED, never fetched, so the three always total count.
const partialPrayerCount = computed(() => Math.max(0, (subject.value.stats.withPrayer || 0) - (subject.value.stats.withFullPrayer || 0)))
const noPrayerCount = computed(() => Math.max(0, (subject.value.stats.count || 0) - (subject.value.stats.withPrayer || 0)))

// The three prayer-coverage bands as ONE list, feeding both the bar widths and the legend numbers.
// ProgressBar divides each `value` by its `max`, so a width and the figure printed beside it come
// from the same number and cannot drift apart -- before extraction they were computed separately.
// The colours are the very tokens the deleted .rd-seg--full/--partial/--none rules set, so every
// rendered colour is unchanged; only the mechanism moved from a class to a value.
const prayerSegments = computed(() => [
  { value: subject.value.stats.withFullPrayer || 0, color: 'var(--dx-accent)',  label: t('100+ People Praying') },
  { value: partialPrayerCount.value,                color: 'var(--dx-partial)', label: t('1+ People Praying') },
  { value: noPrayerCount.value,                     color: 'var(--dx-track)',   label: t('No One Praying') },
])

// Their four headline stats, RegionDetail.vue:52-69: People Groups / Countries / Population /
// Unengaged. A COUNTRY subject has no countryCount, and their own country page does not show one
// either -- so that slot becomes Engaged, which the rollup measures for a country identically.
const stats = computed(() => {
  const s = subject.value.stats || emptyStats()
  const unengaged = Math.max(0, (s.count || 0) - (s.engaged || 0))
  const four = [{ label: t('People Groups'), value: formatNumber(s.count) }]
  if (subject.value.kind === 'country') four.push({ label: t('Engaged'), value: formatNumber(s.engaged) })
  else four.push({ label: t('Countries'), value: formatNumber(subject.value.kind === 'all' ? totalCountryCount.value : (selectedRegion.value?.countryCount || 0)) })
  four.push({ label: t('Population'), value: formatNumber(s.population) })
  four.push({ label: t('Unengaged people groups'), value: formatNumber(unengaged) })
  return four
})

const totalCountryCount = computed(() => regions.value.reduce((n, r) => n + (r.countryCount || 0), 0))

// Their three goal cards, RegionDetail.vue:88-141. The goal SENTENCES are theirs verbatim --
// they are the DOXA goals, not copy we get to reword.

// Their per-country table, RegionDetail.vue:144-171 -- five columns, same order.
// A country subject keeps its REGION's rows with itself highlighted, for the reason the chart
// already gives: one lone row is a number without a scale.
const tableRows = computed(() => {
  if (subject.value.kind === 'all') {
    return regions.value.map((r) => ({
      key: r.slug, name: r.label || t('Other'), count: r.count, withPrayer: r.withPrayer,
      adopted: r.adopted, engaged: r.engaged, isSelected: false, kind: 'region',
    }))
  }
  const r = selectedRegion.value
  const rows = r ? r.countries : []
  return rows.map((c) => ({
    key: c.slug, name: c.name, count: c.count, withPrayer: c.withPrayer,
    adopted: c.adopted, engaged: c.engaged,
    isSelected: !!selectedCountry.value && c.slug === selectedCountry.value.slug, kind: 'country',
  }))
})

const tableTitle = computed(() => {
  if (subject.value.kind === 'all') return t('Regions')
  return t('Countries in this region')
})

// t('Region') has NO key in their catalogue — they never needed it, having no all-regions
// state — so it fell back to English. t('Regions') and t('Countries') both exist and are
// translated everywhere, and read correctly as column headings.
// The COUNTRY branch must be SINGULAR: their live /regions/africa table header reads
// "Country", measured, and t('Country') is in their catalogue and translated in every locale.
// I changed this to t('Countries') last tick for plural symmetry with the chooser dropdown and
// broke exact parity — I had checked that the key was translated but NOT that the word matched
// their page. The structural-text comparison added to _probe-region-vs-live.mjs caught it.
// The ALL branch keeps the plural: that column only exists in the chooser, which is ours, and
// t('Region') has no key in their catalogue because they have no all-regions state.
const tableFirstCol = computed(() => (subject.value.kind === 'all' ? t('Regions') : t('Country')))

// Their summary line, RegionDetail.vue:32-36 / the list's own. Kept as a %token% template for
// the same reason tab 1 keeps it -- it is how their i18n carries this string.
const summaryLine = computed(() => {
  const s = subject.value.stats || emptyStats()
  if (subject.value.kind === 'country') {
    return formatNumber(s.count) + ' ' + t('People Groups') + ' \u00b7 ' + (selectedCountry.value?.region?.label || t('Other'))
  }
  const countries = subject.value.kind === 'all' ? totalCountryCount.value : (selectedRegion.value?.countryCount || 0)
  return tf('%count% people groups in %countries% countries', {
    count: formatNumber(s.count), countries: formatNumber(countries),
  })
})

// ★ THE NO-SELECTION QUESTION, answered from what DX-life actually does.
// There is NO dashboard-without-a-subject route on their site: /regions is the LIST, and
// /regions/<slug> ALWAYS has a subject -- pages/regions/[slug].vue throws a 404 when the slug
// matches neither a region nor a country. So their answer is "that state does not exist; you are
// on the list instead". A 2-tab element cannot borrow that answer, because tab 2 is reachable
// before anything is clicked. Keeping their INVARIANT (the dashboard always has a subject) and
// making the widest honest subject the default gives: with nothing selected the subject is ALL
// REGIONS -- the same dashboard, every figure summed, and the table switched from countries to
// regions so the page still compares like with like. The prompt below then says how to narrow it.
const isAll = computed(() => subject.value.kind === 'all')

// ── THE CHOOSER'S MAP: colour mode + legend ─────────────────────────────────
// Only the no-selection state paints by region. A SELECTED page keeps DX-life's own modes
// exactly — prayer on a region, in-country on a country — because those pages are clones.
const mapColorMode = computed(() => {
  if (subject.value.kind === 'country') return 'in-country'
  if (subject.value.kind === 'region') return 'prayer'
  return 'region'
})

// In REGION_ORDER, not by count: the palette's CVD separation was measured on ADJACENT pairs in
// that order, and sorting by size would also mean the legend reshuffles as data changes.
const regionLegend = computed(() => {
  const byValue = new Map(regions.value.map((r) => [r.value, r]))
  return REGION_ORDER
    .map((value) => {
      const r = byValue.get(value)
      // PREFER THE API'S LOCALIZED LABEL. This read WAGF_REGIONS[value] || r.label, so the
      // hardcoded ENGLISH display name in library/colors/wagf-region.js always WON over r.label
      // — which is the localized name the API returns for ?lang=, and the very name the region
      // CARDS render. MEASURED at locale=ar and zh: the cards read "آسيا" / "中东" while this
      // legend, inside the same element, read "Asia" and "Middle East". My code was discarding
      // their localized data. WAGF_REGIONS stays as the FALLBACK, for a region the API returns
      // with no label at all.
      return r ? { value, slug: r.slug, label: r.label || WAGF_REGIONS[value], count: r.count, color: REGION_PALETTE[value] } : null
    })
    .filter(Boolean)
})

const hoveredRegion = ref('')

// A pin click in the chooser picks THAT PIN'S COUNTRY — the finest subject the map can express.
function onPickFromMap(d) {
  const code = d?.code
  if (!code) return
  for (const r of regions.value) {
    const c = r.countries.find((x) => x.code === code)
    if (c) { sel.value = { regionSlug: r.slug, countrySlug: c.slug }; return }
  }
}

// ── THE ONE DELIBERATE DIFFERENCE: the no-selection chooser ─────────────────
// DX-life has no route for a dashboard without a subject (/regions is the list,
// /regions/<slug> always has one, [slug].vue 404s otherwise). Opening tab 2 first is a state
// only this element can reach, so it gets the one thing their site cannot give: a GENERIC map
// of everything, plus three independent ways to choose a subject — a region dropdown, a country
// dropdown, and the all-regions table, whose rows are already clickable. Once a subject is
// chosen the page becomes the faithful clone and this chooser disappears.
const regionOptions = computed(() =>
  regions.value.map((r) => ({ value: r.slug, label: r.label || t('Other'), count: r.count }))
)
const countryOptions = computed(() =>
  regions.value
    .flatMap((r) => r.countries.map((c) => ({ value: c.slug, label: c.name, count: c.count })))
    .sort((a, b) => a.label.localeCompare(b.label))
)

function onPickRegion(e) {
  sel.value = { regionSlug: e?.value || '', countrySlug: '' }
}
function onPickCountry(e) {
  const slug = e?.value || ''
  const owner = regions.value.find((r) => r.countries.some((c) => c.slug === slug))
  sel.value = { regionSlug: owner?.slug || '', countrySlug: slug }
}

// ── the map's subject: which countries to highlight, and how to frame them ──
// DX-life gets centre/zoom/bounds from config/countries-meta.ts, a build-time table we do not
// have. Deriving the frame from the FOCUS POINTS themselves is better, not a workaround: their
// own comment at CountryMap.vue:177-178 says bounds take precedence over centre/zoom because the
// frame should fit the real data rather than "the build-time approximation".
const focusCodes = computed(() => {
  if (selectedCountry.value) return [selectedCountry.value.code]
  if (selectedRegion.value) return selectedRegion.value.countries.map((c) => c.code)
  return regions.value.flatMap((r) => r.countries.map((c) => c.code))
})

const mapBounds = computed(() => {
  // ★ NEVER fitBounds THE WHOLE WORLD. In the chooser the focus is every country, so the bounds
  // span ~180 degrees of longitude and Mapbox fits that by pulling the globe into a crescent:
  // measured at 1440x1000 it rendered as a skewed arc of pins over mostly empty white, which for
  // the one screen that has to invite a choice is the worst possible first impression. A plain
  // world view is both correct and what a chooser wants. This stays a deliberate exception.
  if (isAll.value) return null
  // ★ THEIR FRAME, from countries-meta's viewFor()/lngExtent(), NOT a min/max box.
  // A naive min/max has no antimeridian handling, and MEASURED on Oceania that was catastrophic:
  // our box spanned 353.2 degrees — the long way round the globe — where theirs spans 44.0 along
  // the short Pacific arc. The ported rollup already computes the right answer per country and
  // per region; this component was still deriving its own and throwing that away.
  const subj = selectedCountry.value || selectedRegion.value
  return (subj && subj.bounds) || null
})

// Used when bounds cannot be formed (a single people group, or none plotted yet) — and now
// carrying THEIR centre rather than an arithmetic mean of the pins.
const mapCenter = computed(() => {
  // The chooser gets a fixed world view rather than a centroid: the mean of every people group
  // sits in south Asia (1309 of 2107 are in Asia), which framed the world off-centre and cut
  // the Americas. 10E/20N with the zoom below puts every region on screen at once.
  if (isAll.value) return [10, 28]   // shifted north: the poles crop, and the data is northern
  // Theirs is fitView's rounded midpoint of the SHORT-ARC box. The mean of the pins is a
  // different point entirely: for Oceania it landed at [28.02, -16.06], in Africa, because the
  // longitudes average across the antimeridian. Theirs is [165.9, -13.8], in the Pacific.
  const subj = selectedCountry.value || selectedRegion.value
  if (subj && Array.isArray(subj.center)) return subj.center
  return [20, 10]   // countries-meta's WORLD_VIEW centre, for a subject with no coordinates
})
const mapZoom = computed(() => {
  // Mercator's world is square (512*2^z on both axes) and the frame is 16/9, so a world view
  // cannot fill both. Fill the WIDTH (512*2^z ~ 1200 -> z ~ 1.23) and let the ice caps crop.
  if (isAll.value) return 1.25
  // Theirs, from fitView: the tighter of the lat/lng fit, minus NEIGHBOUR_PADDING 0.6 so
  // surrounding countries stay visible, clamped to [1.6, 6]. This was a hardcoded 4-or-2, which
  // is right for no region and no country in particular.
  const subj = selectedCountry.value || selectedRegion.value
  if (subj && typeof subj.zoom === 'number') return subj.zoom
  return selectedCountry.value ? 4 : 2
})

// Their map notes, verbatim, with the same %token% substitution their i18n uses.
// RegionDetail.vue:38-42 and CountryDetail.vue:29-33.
const mapNote = computed(() => {
  if (selectedCountry.value) {
    return tf('There are %count% people groups in %country%. Check the map for the people groups on the border of this country as well.', {
      count: formatNumber(selectedCountry.value.count), country: selectedCountry.value.name,
    })
  }
  const label = subject.value.title
  const countries = subject.value.kind === 'all' ? totalCountryCount.value : (selectedRegion.value?.countryCount || 0)
  // THE CHOOSER PAINTS BY REGION, so their sentence — which promises "Each pin is coloured by how
  // many people are praying for that people group" — is FALSE here. Found by LOOKING at the page:
  // every assertion was green, including the two that measure the pins ARE region-painted and the
  // prayer key is absent, because nothing compared their prose against the actual paint.
  // Their sentence is ONE i18n key, translated in all 11 locales, so it cannot be split (a '. '
  // split breaks on zh/ar punctuation) and a replacement clause would be copy I would have to
  // invent in 11 languages. So the chooser simply drops the claim: the subtitle above already
  // states both counts, and the region key below the map is what explains the colours.
  // Their own pages keep the sentence verbatim — it is true there, and measured identical to live.
  if (subject.value.kind === 'all') return ''
  return tf('%region% has %count% people groups across %countries% countries. Each pin is coloured by how many people are praying for that people group.', {
    region: label, count: formatNumber(subject.value.stats.count), countries: formatNumber(countries),
  })
})

// The country page's list is DX-life's own UupgsList, ported at src/UupgsList.vue — not a table
// of ours. It fetches and filters the people groups itself, exactly as theirs does, so there is
// no countryTable computed here any more.

// ── ADDRESS <-> SELECTION: what makes this a standalone app rather than a widget ─
// MEASURED before this existed: 4 of 10 app properties OK. Five of the six failures were ONE missing thing — the URL never reflected
// the selection, so nothing was linkable, a reload lost the subject, Back unmounted the element,
// a deep link did nothing, and Share shared the index. DX-life gets all of that free from Nuxt
// routing (/regions/oceania IS the state); a custom element has to do it deliberately.
//
// THE SUBJECT IS ?place=<slug> (library/composables/useViewAddress.js, the page address every shell and composite
// shares). Slugs are DX-life's own (oceania, cameroon), so a link reads the way theirs does. It used to be the HASH,
// written here with this element's own pushState; one writer per page replaces that:
//   on its OWN leaf (urlOwner 'app') this element writes ?place= itself;
//   nested (in Regions, a shell, DX Life) it ANNOUNCES the choice, and the page's owner writes it with its own keys,
//     so a nested Regions no longer touches a host's #anchor at all, and Regions inside the Research Gallery gets
//     its own link (?tab=…&pane=dashboard&place=angola);
//   on a partner's page nothing is written; a link is still READ.
// Replace on the first paint, push on a reader's choice, nothing on Back/Forward: Back means "the previous subject".
// An old #<slug> link still opens its subject; on our own leaf the first paint rewrites it to ?place=.
// A slug may name a region OR a country — DX-life's [slug].vue matches region slugs first, then
// country slugs, and 404s on neither. Same order here; "neither" lands on the chooser rather
// than an error, because the chooser is a legitimate state for this element.
function selectionForSlug(slug) {
  if (!slug) return { regionSlug: '', countrySlug: '' }
  const r = regions.value.find((x) => x.slug === slug)
  if (r) return { regionSlug: r.slug, countrySlug: '' }
  for (const reg of regions.value) {
    const c = reg.countries.find((x) => x.slug === slug)
    if (c) return { regionSlug: reg.slug, countrySlug: c.slug }
  }
  return { regionSlug: '', countrySlug: '' }
}

function currentSlug() {
  return sel.value.countrySlug || sel.value.regionSlug || ''
}

// The OLD form of a link, #<slug>. Read only when the address has no place.
function slugFromHash() {
  if (typeof location === 'undefined') return ''
  try { return decodeURIComponent(String(location.hash || '').replace(/^#/, '')).trim() } catch (_) { return '' }
}
const placeInAddress = () => readViewKeys(typeof location !== 'undefined' ? location.search : '').place

function claimPlace(push) {
  claimView({ place: currentSlug() }, { owner: urlOwnerOf(cfg.value), el: scrollEl.value, push })
}

// ★ urlSync:false NOW GUARDS THE TAB TITLE ONLY. A shell passes it so a nested Regions does not retitle the host's
// tab; the address no longer needs it, since only the page's owner writes the address.
const titleSyncEnabled = computed(() => typeof document !== 'undefined' && cfg.value.urlSync !== false)

// Their page sets the document title per subject (useSeoMeta in [slug].vue: `${title} — Doxa`).
// A standalone app should too: it is what a bookmark, a tab strip and a shared link all show.
function syncTitle() {
  if (typeof document === 'undefined') return
  // The host owns its tab title when we are nested; see titleSyncEnabled.
  if (!titleSyncEnabled.value) return
  const t = subject.value?.title
  // COMPARE AGAINST THE TRANSLATED VALUE, not the English literal. The subject title is now
  // t('All Regions'), so at ar it is 'جميع المناطق' and a comparison with the English string
  // never matched — the no-selection state would have produced 'جميع المناطق — Regions'
  // instead of the bare fallback. Both halves go through t(), whose keys are theirs and are
  // translated in all eleven locales.
  const allLabel = t2('All Regions')
  const suffix = t2('Regions')
  try { document.title = t && t !== allLabel ? t + ' — ' + suffix : suffix } catch (_) {}
}

// Back / Forward: re-apply the address's subject. Never writes: the watcher below then claims the same subject, which
// the address already holds, so nothing is written and the forward stack survives.
function onAddress({ place }) {
  sel.value = selectionForSlug(place || slugFromHash())
}

// One watcher rather than a claim at each of the five places a selection is made
// (tab-1 event, table row, region dropdown, country dropdown, back-link) — those would drift.
// ★ A NEW SUBJECT OPENS AT ITS TOP. Picking a region from the all-regions table, or a country from a region,
// kept the old scroll height, so the reader landed at the bottom of the new page (reported on a phone). The
// scroller is this dashboard's own <main>, the one the Back-to-top button drives. Switching to the list and
// back selects nothing new, so the selected dashboard keeps its place there. A string key, because an array
// literal is a new object on every run and would fire on no change.
watch(() => `${sel.value.regionSlug}|${sel.value.countrySlug}`, () => {
  const el = scrollEl.value
  if (el && el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'auto' })
}, { flush: 'post' })

watch(() => [sel.value.regionSlug, sel.value.countrySlug], () => {
  claimPlace(true)
  syncTitle()
}, { flush: 'post' })

// ── in-dashboard navigation ─────────────────────────────────────────────────
// Their back-link (RegionDetail.vue:48) goes to /regions. We have no router, so it drops the
// selection, which lands on the ALL REGIONS subject -- the closest thing this element has to
// their index page, and reachable without leaving the tab.
function clearSelection() {
  sel.value = { regionSlug: '', countrySlug: '' }
}

// Their table's first column is a NuxtLink to /regions/<slug> (RegionDetail.vue:166). Here the
// same click re-points THIS dashboard: a region row on the all-regions table drills into that
// region, a country row into that country. Same destination, no navigation.
function selectFromTable(row) {
  if (row.kind === 'region') sel.value = { regionSlug: row.key, countrySlug: '' }
  else sel.value = { regionSlug: sel.value.regionSlug || selectedRegion.value?.slug || '', countrySlug: row.key }
}

// ── cross-pane seam: the composite forwards tab 1's selection here ──────────
const SELECT_EVENT = 'doxa-regions-dashboard:select'

function onSelect(e) {
  const d = e?.detail || {}
  // Scoped by instanceId exactly as upg-100-mfe's show-on-map seam is: an event carrying a
  // DIFFERENT instance's id belongs to another embed on the same page and must be ignored.
  if (d.instanceId && instanceId.value && d.instanceId !== instanceId.value) return
  sel.value = { regionSlug: d.regionSlug || '', countrySlug: d.countrySlug || '' }
}

// ── data fetch ──────────────────────────────────────────────────────────────
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
    // The mapping moved to @map/utils/peopleGroupPoints.js when country-map became its second
    // consumer — same fields, same has_photo gate, same drop of rows without finite coordinates.
    points.value = peopleGroupPoints(posts, toNumber)
  } catch (error) {
    console.error('[region-dashboards] fetch error:', error)
    loadFailed.value = true
    regions.value = []
    points.value = []
  } finally {
    loading.value = false
  }
}

// A locale change has to REFETCH, not just re-render: the labels come from the API's ?lang=,
// so without this the chrome switches language and the country names keep the language of
// first paint.
watch(languageCode, () => { loadRegions() })

let offAddress = null
let reshown = null
onMounted(async () => {
  window.addEventListener(SELECT_EVENT, onSelect)
  window.addEventListener(POSTER_WALL_EVENT, onPosterShowOnMap)
  offAddress = onAddressChange(onAddress)
  // The address can only be resolved to a subject once the regions are known, so it is applied
  // after the fetch rather than on mount — otherwise a deep link silently lands on the chooser.
  await loadRegions()
  const place = placeInAddress()
  const legacy = place ? '' : slugFromHash()
  if (place || legacy) sel.value = selectionForSlug(place || legacy)
  // First paint is a REPLACE. An old #<slug> link becomes ?place= on our own leaf, and its hash goes, so the address
  // has ONE form. Nested, the hash is the host's and stays.
  claimPlace(false)
  if (legacy && currentSlug() && urlOwnerOf(cfg.value) === 'app') commitUrl({ hash: '' })
  syncTitle()
  // A KEPT-ALIVE Regions shown again (a shell switched back to its tab: no height, then height). The tab change
  // dropped ?place= while this element kept its subject, so the screen claims it again (a replace). An address that
  // names a subject wins (Back already applied it).
  if (typeof ResizeObserver !== 'undefined' && scrollEl.value) {
    let h = null
    reshown = new ResizeObserver(() => {
      const was = h
      h = scrollEl.value?.clientHeight || 0
      if (was !== 0 || !h) return
      const place = placeInAddress()
      if (place && place !== currentSlug()) sel.value = selectionForSlug(place)
      else if (!place) claimPlace(false)
    })
    reshown.observe(scrollEl.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener(SELECT_EVENT, onSelect)
  window.removeEventListener(POSTER_WALL_EVENT, onPosterShowOnMap)
  offAddress?.()
  reshown?.disconnect()
})

// Palette is DX-life material light, matching regions-list.vue tab-for-tab so swapping between
// the two tabs does not change the surface under the reader.
// NO BACKTICKS in this string, including comments (house style: one terminates the literal).
useShadowStyles(
  // Their _reset.scss:3-8 FIRST, so every rule below is authored against border-box exactly as
  // theirs is. See src/shadowReset.js for why it lives there and for the measured blast radius.
  SHADOW_BOX_SIZING_RESET +
  DXLIFE_TOKENS +
  // EVERY value below is DX-life's own, resolved against their 10px rem root
  // (app/assets/styles/base/_globals.scss html{font-size:var(--font-size-base)}, and
  // tokens/semantic/_typography.scss $font-size-base:10px). Sources, one per block:
  //   .container         composition/_container.scss
  //   .card              blocks/_cards.scss:9-37
  //   .switcher          composition/_switcher.scss
  //   .progress-bar      blocks/_progress-bar.scss
  //   .region-*          RegionDetail.vue's own scoped block
  //   colours            tokens/semantic/_colors.scss
  // Spacing is the 1.33 modular scale: 2xs 5.65 / xs 7.52 / sm 13.3 / md 17.7 / lg 23.5 /
  // xl 31.3 / 2xl 41.6 / 3xl 55.3.  Type is the 1.25 scale off 10px: sm 15.6 / md 19.5 /
  // lg 24.4 / 2xl 38.1 / 3xl 47.7 / 4xl 59.6 / 5xl 74.5.
  // NO BACKTICKS in this string, including comments (house style: one terminates the literal).
  ':host{ display:block; position:relative; width:100%; height:100%; min-height:320px; }' +
  '.rd-root{ position:absolute; inset:0; display:flex; flex-direction:column; min-height:0;' +
  // tokens/semantic/_colors.scss. --color-brand-lighter is declared TWICE there; the second
  // wins, so it is green-300 #6d766e, not green-200.
  '  --dx-surface:#f3f3f1; --dx-elevated:#fff; --dx-text:#2a332a; --dx-header-bg:#3b463d;' +
  '  --dx-header-text:#fff; --dx-muted:#6d766e; --dx-line:#d1d4cd; --dx-accent:#92b195;' +
  '  --dx-dark:#2a332a; --dx-on-dark:#f3f3f1; --dx-track:#4e594f; --dx-partial:#f0c64a;' +
  '  --dx-radius:35px; --dx-radius-lg:25px;' +
  // base/_globals.scss:99-105 + :205-207 style EVERY table on their site: --table-border-color
  // is $color-gray-500 (#666) and --border-radius-lg is 2.5rem at their 10px root = 25px.
  '  --dx-table-border:#666;' +
  // base/_globals.scss:132-141 styles EVERY anchor: --color-brand-light on hover to
  // --color-brand-lighter. $color-green-400 / $color-green-300.
  '  --dx-link:#4e594f; --dx-link-hover:#6d766e;' +
  '  background:var(--dx-surface); color:var(--dx-text);' +
  '  font:var(--font-size-md)/1.5 Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }' +
  // Same responsive context + same 1200px cap as tab 1 (regions-list.vue). DX-life applies its
  // .container to the DETAIL routes too -- RegionDetail.vue:46 and CountryDetail.vue:35 are both
  // class="container page-content ..." -- so the dashboard half is capped by the same rule.
  // gap = their .stack--3xl (var(--spacing-3xl)), the gap between every block on that page.
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
  // ★ THEIR MARGIN RESET, AS AN ELEMENT SELECTOR — and the specificity is the whole point.
  // base/_reset.scss zeroes margins with `body,h1,h2,h3,h4,p,figure,blockquote,dl,dd { margin: 0 }`,
  // a bare element selector at 0-0-1. Their `.stack > * + *` is 0-1-0, so the stack WINS and their
  // heading gets its 10px. We had recreated that reset as CLASS rules (.rd-title{margin:0}), which
  // is also 0-1-0 — `*` contributes nothing to specificity — so ours came down to source order and
  // the later class rule beat the stack.
  // MEASURED on live /regions/africa: their head is a(0px), h1(10px), p(10px). Ours was h1(0px),
  // p(0px) — the title and strapline sat flush against the back-link, 10px tight, on every region
  // and country page. Their .region-goal is 0px and ours matches, so that one was never a defect.
  // Porting the reset properly and deleting the class-level margin:0 restores their cascade exactly.
  'h1,h2,h3,h4,p,figure,blockquote,dl,dd{ margin:0; }' +
  // ★ AND THEIR IMAGE RESET, the other half of base/_reset.scss that the shadow boundary blocked:
  //   img, picture { max-width: 100%; display: block }
  // MEASURED on a COUNTRY page, where the uupg photos actually render: their img.uupg__image has
  // max-width 100%, ours had max-width NONE, so an image wider than its grid cell overflows our
  // card where theirs is constrained. display already matched, and height/border-radius/object-fit
  // already match because our .uupg__image class sets them (100px, 7.5px, cover -- identical to
  // theirs), so max-width was the whole gap.
  // NOT PORTED, deliberately: _globals.scss:80's `img { border-radius: var(--border-radius-lg) }`.
  // On their site that rounds every image because every image there is theirs. Applying it inside
  // our root would also round the POSTER WALL previews, which are part of a sanctioned addition
  // that does not exist on their page -- so porting it would change something they have no opinion
  // about. The elements that ARE clones already carry the right radius from their own class.
  'img,picture{ max-width:100%; display:block; }' +
  '@media (prefers-reduced-motion: reduce){' +
  '  .rd-root, .rd-root *, .rd-root *::before, .rd-root *::after{' +
  '    animation-duration:0.01ms !important; animation-iteration-count:1 !important;' +
  '    transition-duration:0.01ms !important; scroll-behavior:auto !important; } }' +
'.rd-scroll{ flex:1 1 auto; min-height:0; overflow-y:auto; scrollbar-gutter:stable; -webkit-overflow-scrolling:touch;' +
  '  padding:var(--spacing-3xl) 0 var(--spacing-4xl); display:flex; flex-direction:column;' +
  '  container-type:inline-size; }' +
  '.rd-scroll > * + *{ margin-top:var(--spacing-3xl); }' +   // .stack .stack--3xl
  '.rd-scroll > *{ width:calc(90% + 16px); max-width:1200px;' +
  '  margin-left:auto; margin-right:auto; }' +
  '.rd-status{ padding:var(--spacing-xl); text-align:center; color:var(--dx-muted); font-size:var(--font-size-md); }' +

  // ── ★ PRINT: LET THE DOCUMENT FLOW ONTO PAGES ───────────────────────────────────────────────
  // "The header and footer don't show properly" has a structural cause, not a styling one. This
  // page is an app shell: .rd-root is position:absolute inset:0 and .rd-scroll owns the scroll.
  // On paper there is no viewport to be absolute INSIDE and no scrollbar to move, so the browser
  // prints the one screenful that happens to be laid out and drops everything above and below it.
  // Releasing both back into normal flow is what makes the whole dashboard printable at all.
  '@media print{' +
  '  .rd-root{ position:static; inset:auto; height:auto; overflow:visible; }' +
  '  .rd-scroll{ overflow:visible; height:auto; max-height:none; padding:0; }' +
  // Keep a heading with the block it introduces rather than orphaned at a page foot.
  '  .rd-head, .rd-stats, .rd-mapblock, .rd-section{ break-inside:avoid; }' +
  '  .rd-h2{ break-after:avoid; }' +
  // Controls that only do something under a pointer. The back-to-top arrow is the clearest case:
  // on paper it is a circle with an arrow in it and nothing to scroll.
  '  .rd-chooser, .btt, .rd-printrow{ display:none !important; }' +
  '}' +
  '.rd-status.rd-failed{ font-weight:600; }' +

  // ── head: RegionDetail.vue:47-51, a .stack--xs (7.5px) block, centred ──
  // ★ EVERY .stack HERE IS NOW THEIR MECHANISM, not `gap`. The goal card proved the two are not
  // interchangeable (a child's margin-top:auto can override a margin and cannot override a gap),
  // and the extended live diff then caught the residue: their .stack rowGap computes to `normal`
  // because the spacing is margin, while ours read 17.689px. Same pixels, different code — and the
  // requirement is that the CODE match, not just the screenshot. Converted, so the next
  // margin-overriding child anywhere on this page behaves as it does on their page.
  // .stack .stack--xs — --spacing-xs is 1rem at their 10px root.
  '.rd-printrow{ margin:0; }' +
  // Quiet by default — this is a secondary action under a title, not a call to action. The busy
  // state changes the CURSOR and the opacity as well as the label, because on a fast connection
  // the label may only be readable for a few hundred ms and the cursor is what a reader feels.
  '.rd-print{ font:inherit; font-size:var(--font-size-sm); color:var(--dx-muted);' +
  '  background:transparent; border:1px solid var(--dx-border); border-radius:6px;' +
  '  padding:4px 12px; cursor:pointer; transition:color .2s ease, border-color .2s ease; }' +
  '.rd-print:hover:not(:disabled){ color:var(--dx-text); border-color:var(--dx-accent); }' +
  '.rd-print:focus-visible{ outline:2px solid var(--dx-accent); outline-offset:2px; }' +
  '.rd-print[aria-busy="true"]{ cursor:progress; opacity:.7; }' +
  '.rd-head{ display:flex; flex-direction:column; text-align:center; }' +
  '.rd-head > * + *{ margin-top:10px; }' +
  '.rd-backlink{ margin:0; }' +
  // their .light-link on a dark-on-light page: brand-light, underlined on hover
  // THEIR back-link is an <a class="light-link">, so it inherits the UA underline plus their
  // own `a` rule (_globals.scss:132-138): font-weight medium, text-decoration-thickness 2px,
  // text-underline-offset 4px — and .light-link recolours it to --color-brand-secondary =
  // $color-beige-300 = #cbc5b9. MEASURED on their live /regions/cameroon: rgb(203, 197, 185)
  // with text-decoration-line underline.
  // Ours is a <button> because this element has no router, and a button inherits NEITHER the
  // underline nor any link colour — so it was rendering #4e594f with text-decoration:none, on
  // BOTH the region and country pages. Neither vs-live diff measured the back-link at all,
  // which is why it survived; _probe-country-head-vs-live.mjs now covers it.
  '.rd-light-link{ appearance:none; background:none; border:0; padding:0; margin:0; cursor:pointer;' +
  '  font:inherit; font-size:var(--font-size-md); color:#cbc5b9; font-weight:500;' +
  '  text-decoration:underline; text-decoration-thickness:2px; text-underline-offset:4px; }' +
  '.rd-light-link:hover{ color:#d1d4cd; }' +
  '.rd-light-link:focus-visible{ outline:2px solid var(--dx-accent); outline-offset:2px; border-radius:4px; }' +
  // h1: _globals.scss clamp(--font-size-3xl, 7vw, --font-size-5xl) = clamp(var(--font-size-3xl),_,var(--font-size-5xl)),
  // heading family, line-height 1. cqw not vw -- see tab 1 for why.
  '.rd-title{ font-size:clamp(var(--font-size-3xl), 7cqw, var(--font-size-5xl)); line-height:1;' +
  '  font-family:"Bebas Neue","Arial Narrow",BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;' +
  '  font-weight:400; }' +
  // their .color-brand-lighter summary under the h1
  // .color-primary on the highlighted word — --color-brand-primary, measured live as
  // rgb(146,177,149). The h1 itself keeps --color-text-on-default.
  '.rd-title__last{ color:var(--dx-accent); }' +
  '.rd-summary{ color:var(--dx-muted); font-size:var(--font-size-md); }' +
  '.rd-prompt{ margin:0; color:var(--dx-muted); font-size:var(--font-size-sm); }' +

  // ── .card (blocks/_cards.scss:9-21) lives in library/composables/useCardSurface.js now: StatCard
  //    and GoalCard both need it, and both call useCardSurface(), which injects ONE copy per shadow
  //    root under a stable label. This element renders no .rd-card markup of its own any more, so it
  //    does not call it. If markup here ever needs the surface again, call useCardSurface() -- do not
  //    re-declare the rules, or there will be two copies to keep in step.

  // ── .region-stats: RegionDetail.vue's scoped block. The GRID stays here and the CARD went to the
  //    library, deliberately: how many stats there are and how they wrap is this page's decision,
  //    while the look of one stat is the reusable part. See library/components/regions/StatCard.vue.
  // ★ auto-FILL WITH A CAPPED TRACK MINIMUM. Reported: the Population card — the LAST of four —
  // was centred in a box four times too wide on a tablet. Cause: auto-FIT collapses the
  // empty tracks, so at 3 columns the lone card in row 2 stretched across the whole row. Desktop
  // fits all four, which is why only desktop looked right.
  //   auto-fill alone fixes that and breaks desktop: at 1200px it makes SIX tracks for four cards,
  //   leaving two empty on the right and squeezing the cards to their 180px floor.
  // So the track minimum is also capped at a quarter of the row: at most four tracks ever, and the
  // orphan is never stretched. Measured at 1200/1000/900/800/768/700/600/500/390 — four columns
  // down to 800, three to 600, two below, no empty tracks at any of them.
  // ⚠ THIS NOW DIFFERS FROM dx-life, deliberately. Theirs is the same auto-fit rule
  // (RegionDetail.vue:176) and stretches the same card, so the clone diverges here deliberately;
  // the divergence is being carried back as a product question.
  '.rd-stats{ display:grid;' +
  '  grid-template-columns:repeat(auto-fill, minmax(max(180px, calc((100% - 3 * var(--spacing-md)) / 4)), 1fr));' +
  '  gap:var(--spacing-md); }' +
  '.rd-chart{ padding:var(--spacing-lg) clamp(var(--spacing-md), 4cqw, var(--spacing-xl)); }' +
  // RegionDetail wraps the note and the map in a .stack--sm (13.3px). The note is their
  // .text-center .color-primary .font-weight-bold -- --color-brand-primary at weight 700.
  // The chooser's two controls, side by side and wrapping on a phone. Its own block so the
  // clone below is untouched by it.
  '.rd-chooser{ display:flex; flex-wrap:wrap; gap:13.3px; align-items:flex-end;' +
  '  justify-content:center; }' +
  // .stack .stack--sm — --spacing-sm, 1.33rem.
  // ── the map sat below the fold at 1440, and this is the part of that I can fix without
  // ── touching the clone or the order ────────────────────────────────────────────────────────
  // ARITHMETIC AT 1440, container 1200px, tokens resolved: padding-top 55.3 + head 147 + 3 gaps of
  // 55.3 + chooser ~62 + stats ~110 + note 29 + 13.3 puts the map's TOP at ~583px, and the map is
  // 780px tall because min-height:780px beats what 16/9 asks for at 1200 wide (675). Bottom ~1363.
  // So a reader at 1440x900 sees roughly the top 190px of an 780px map: a sliver, which is what
  // "below the fold" meant.
  //
  // WHAT THIS DOES AND DOES NOT DO. Tightening the three gaps above the map from --spacing-3xl to
  // --spacing-xl and dropping the outsized title one step recovers ~99px, so ~286px of map shows
  // instead of ~190 — about 50% more map on load. It does NOT get the whole map above the fold,
  // and nothing that leaves the map at 780px can: you would need the map under ~320px tall. That
  // fix exists (bound .rcm by viewport height) but it changes the map's rendered SIZE, which is a
  // change to what the Campaign Server shows, so it is PROVISIONAL, pending a product decision.
  //
  // SCOPED TO THE ALL-REGIONS PAGE ONLY (.rd-root--all), and at >=1200px only. That page is ours;
  // the region and country pages are the clone, and their vertical rhythm is measured against
  // dx-life, so a global trim here would quietly un-clone three pages to improve one.
  '@media (min-width:1200px){' +
  '  .rd-root--all .rd-scroll > .rd-chooser,' +
  '  .rd-root--all .rd-scroll > .rd-stats,' +
  '  .rd-root--all .rd-scroll > .rd-mapblock{ margin-top:var(--spacing-xl); }' +
  '  .rd-root--all .rd-title{ font-size:var(--font-size-3xl); }' +
  '}' +
  '.rd-mapblock{ display:flex; flex-direction:column; }' +
  '.rd-mapblock > * + *{ margin-top:13.3px; }' +
  '.rd-mapnote{ margin:0; text-align:center; color:#92b195; font-weight:700; font-size:var(--font-size-md); }' +
  // .rounded-xlg on their <CountryMap>; the child takes border-radius:inherit from here.
  '.rd-mapframe{ border-radius:var(--dx-radius); overflow:hidden; }' +
  // The poster disclosure: a 44px pill in their brand green, the Regions list's chevron (down closed, up open).
  '.rd-posters{ display:flex; flex-direction:column; }' +
  '.rd-posters__toggle{ align-self:center; display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:0 18px;' +
  '  border:1px solid #92b195; border-radius:100px; background:#fff; color:#3b463d; font:inherit; font-weight:700; cursor:pointer; }' +
  '.rd-posters__toggle:hover{ background:#f3f6f3; }' +
  '.rd-posters__toggle:focus-visible{ outline:2px solid #2563eb; outline-offset:2px; }' +
  '.rd-posters__toggle svg{ width:12px; height:12px; fill:currentColor; transform:rotate(180deg); }' +
  '.rd-posters__toggle[aria-expanded="true"] svg{ transform:none; }' +
  '.rd-posters__wall{ margin-top:12px; width:100%; max-width:520px; align-self:center; }' +
  // ★ ON PHONES THE MAPS ARE HALF AGAIN AS TALL AS THEY ARE WIDE (height = 1.5 x width), all regions, a region
  // and a country. A square was asked for first, then proved too small to use a people-group popup in.
  // RegionCountryMap keeps DX Life's cloned 1/2 portrait under 768px for its other consumer (the country
  // page's country-map), so the override lives HERE, scoped to this dashboard's frame: two classes outrank the
  // component's one (and .rcm--chooser's). Desktop is untouched.
  // ★ AND ON THESE SMALL MAPS: the LEFT scroll-past strip is off (a thumb pinches from the right edge too, and
  // two strips left almost no map to pinch), and the people-group popup is compact and lets a pinch through
  // (its body passes touches to the map; its links and close button still take them).
  // ★ THE CARD FILLS THE COMPACT BOX. RegionCountryMap's card is a fixed 240px (their desktop popup), so inside the
  // 220px box it overhung by 40px: the stat values, the second button and, in Arabic, the name under the close
  // button, cut off at the edge (embedded and in the gallery alike). Here the box is 220px and the card takes its
  // inner width; the name keeps clear of the close button, which sits top-right in both directions.
  '@media (max-width:768px){ .rd-mapframe .rcm{ aspect-ratio:2/3; }' +
  '  .rd-mapframe .map-scroll-edge--left{ display:none; }' +
  '  .rd-mapframe .maplibregl-popup-content, .rd-mapframe .mapboxgl-popup-content{ width:220px; max-width:220px; padding:8px 10px; font-size:12.5px; pointer-events:none; }' +
  '  .rd-mapframe .cm-popup{ width:auto; }' +
  '  .rd-mapframe .cm-popup__name{ padding-right:18px; }' +
  '  .rd-mapframe .maplibregl-popup-content a, .rd-mapframe .mapboxgl-popup-content a,' +
  '  .rd-mapframe .maplibregl-popup-close-button, .rd-mapframe .mapboxgl-popup-close-button{ pointer-events:auto; }' +
  '  .rd-mapframe .maplibregl-popup-content img, .rd-mapframe .mapboxgl-popup-content img{ max-height:90px; width:auto; max-width:100%; } }' +
  // The region key. Their token scale throughout so the one screen we add does not look
  // foreign next to the clone: --spacing-xs/sm gaps, --font-size-sm, the 100px pill radius
  // their chips use, and --color-brand-lighter for the count.
  '.rd-regionkey{ list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap;' +
  '  gap:10px 13.3px; justify-content:center; }' +
  '.rd-regionkey__item{ appearance:none; border:1px solid var(--dx-line); background:var(--dx-elevated);' +
  '  border-radius:100px; padding:var(--spacing-2xs) 13.3px; cursor:pointer; font:inherit;' +
  '  font-size:var(--font-size-sm); color:var(--dx-text); display:inline-flex; align-items:center;' +
  '  gap:var(--spacing-2xs); transition:border-color .15s ease, background-color .15s ease; }' +
  '.rd-regionkey__item:hover{ border-color:var(--dx-header-bg); background:#fff; }' +
  '.rd-regionkey__item:focus-visible{ outline:2px solid var(--dx-accent); outline-offset:2px; }' +
  '.rd-regionkey__dot{ width:10px; height:10px; border-radius:100px; flex:0 0 auto; }' +
  '.rd-regionkey__count{ color:var(--dx-muted); font-variant-numeric:tabular-nums; }' +
  '.rd-regionkey__hint{ margin:0; text-align:center; color:var(--dx-muted); font-size:var(--font-size-sm); }' +

  // ── .switcher[data-width="xl"]: composition/_switcher.scss. --switcher-width 70rem = 700px,
  //    gap --spacing-2xl (var(--spacing-2xl)). flex-basis calc((700px - 100%) * 999) is every-layout's
  //    switch: below 700px of container the basis goes hugely positive and each card takes a
  //    full row; above it, negative, so the three share the row. Ported as-is -- this IS their
  //    responsive rule for these cards, and it needs no media query.
  '.rd-switcher{ display:flex; flex-wrap:wrap; gap:var(--spacing-2xl); }' +
  // min-width:0 is REQUIRED for their basis to govern. A flex item's automatic minimum size is
  // its MIN-CONTENT width, and MEASURED: our goal cards' min-content is ~490px (the h2's
  // longest word plus 2x55.35px padding), so three of them could not share 1200px and the
  // third wrapped to its own row -- 579/579/1200 instead of their 372/372/372. DX-life needs
  // no such reset because Bebas Neue is far narrower than any fallback we can load.
  '.rd-switcher > *{ flex-grow:1; flex-basis:calc((700px - 100%) * 999); min-width:0; }' +
  // The last rule of their composition/_switcher.scss, ported for completeness rather than for
  // effect: at six or more children every one takes a full row instead of sharing. MEASURED in the
  // rendered page, not counted in the template: 3 direct children, widths 372/372/372 at 1440 --
  // the same three goal cards their RegionDetail.vue lays out. (A static tag-count of this block
  // said 4 and was wrong; the runtime count is the one that governs a :nth-last-child selector.)
  // So the threshold of 6 is out of reach and the selector matches nothing today. It is carried
  // because the brief is
  // an exact clone and because a fifth or sixth goal card would otherwise silently diverge from
  // their layout -- a one-line rule now, or a puzzle later about why six cards behave differently
  // here than on doxa.life. The other two rules in that file are NOT ported and that is measured,
  // not an oversight: .switcher-item{display:flex} never applies because their switcher's children
  // are `.stack | card`, not `.switcher-item`, and .three-part-switcher is a different component
  // that the regions page does not use.
  '.rd-switcher > :nth-last-child(n + 6), .rd-switcher > :nth-last-child(n + 6) ~ *{ flex-basis:100%; }' +
  // ★ A CONSEQUENCE OF THE FONT SUBSTITUTION, not a departure from their design.
  // Their h2 is clamp(--font-size-2xl, 6vw, --font-size-4xl) and resolves to var(--font-size-4xl) at
  // 1440 -- verified live. In Bebas that fits their 372.25px card (261.55px of inner width).
  // MEASURED in our stand-in face: 'Engagement' is 380.1px at var(--font-size-4xl), 304.1px at var(--font-size-3xl),
  // 265.3px at 41.6px -- all overflowing -- and 243.2px at var(--font-size-2xl), which fits. var(--font-size-2xl) is
  // --font-size-2xl, the FLOOR OF THEIR OWN CLAMP: the largest step on their type scale our
  // substituted face can render in their card. Pinning it there keeps THEIR LAYOUT (three
  // cards across, heading on two lines) which is what the clone is actually for. The table
  // heading keeps the full clamp -- it has 1200px and no such constraint.
    // The three goal cards are library/components/regions/GoalCard.vue now, and the .stack--lg /
  // margin-top:auto layout that aligns their goal lines went with them. The .rd-h2 rule below is
  // still here because this element keeps ONE heading of its own -- the breakdown table's title.
  // h2: _globals.scss clamp(--font-size-2xl, 6vw, --font-size-4xl) = clamp(var(--font-size-2xl),_,var(--font-size-4xl))
  '.rd-h2{ margin:0; font-size:clamp(var(--font-size-2xl), 6cqw, var(--font-size-4xl)); line-height:1;' +
  '  font-family:"Bebas Neue","Arial Narrow",BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;' +
  '  font-weight:400; }' +
  '.rd-h2--start{ text-align:start; }' +
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
  // The Cyrillic heading face now comes from the shared module rather than a third copy of the
  // same rule — its output is byte-identical to what this file emitted before (verified), so this
  // is a de-duplication and not a style change. See library/styles/portedGlobals.js for the
  // measurement history and for the one global it DELIBERATELY does not port.
  cyrillicHeading('.rd-title', '.rd-h2') +
  // .rd-big / .rd-big-label / .rd-goal and the .stack--xs that separates a bar from its legend are
  // in library/components/regions/GoalCard.vue and library/components/charts/ProgressBar.vue now,
  // together with the measurement history that fixed each value. The `strong` rule below STAYS:
  // UupgsList renders a <strong> in this same shadow root and depends on it.
  // base/_globals.scss:200-202 — <strong> is --font-weight-medium (500) on their site, not the
  // UA's bold. The 'Goal:' label in all three cards is a <strong>, so ours was rendering 700.
  '.rd-root strong{ font-weight:500; }' +

  // ── .progress-bar (blocks/_progress-bar.scss) + their .prayer-coverage-segments override and
  //    legend are library/components/charts/ProgressBar.vue now. The three --full/--partial/--none
  //    colour rules are GONE rather than left behind: a segment's colour is a prop there, passed as
  //    the same var(--dx-accent) / var(--dx-partial) / var(--dx-track) tokens these rules set, so a
  //    shared bar needs no vocabulary about prayer. A rule no selector can reach is not a fallback.

  // ── the breakdown table: RegionDetail.vue's scoped block. min-width 560px inside an
  //    overflow-x:auto wrapper is how they keep five columns readable on a phone instead of
  //    crushing them -- the table scrolls sideways, the page does not.
  // ★ base/_globals.scss:19-23 — their countries block is a <section>, and EVERY <section> on
  // their site carries padding-top clamp(--spacing-2xl, 6vw, --spacing-4xl) and padding-bottom
  // --spacing-4xl. At 1440 that is 73.614px above and below, ON TOP of the --spacing-3xl the
  // page stack already puts between blocks: 128.96px of air above the heading, where ours had
  // 55.35px and nothing below. Another global rule, another thing reading RegionDetail.vue
  // alone could not tell me. Same clamp, in container units for the embedded case.
  '.rd-section{ display:flex; flex-direction:column;' +
  '  padding-top:clamp(var(--spacing-2xl), 6cqw, var(--spacing-4xl));' +
  '  padding-bottom:var(--spacing-4xl); }' +
  '.rd-section > * + *{ margin-top:var(--spacing-md); }' +   // .stack .stack--md

  '.rd-table-scroll{ overflow-x:auto; }' +
  // ★ base/_globals.scss:99-105 — the part of their table that is NOT in RegionDetail's
  // scoped block and was therefore missed: every <table> on their site is a rounded,
  // ring-outlined WHITE card, and every <td> carries a 1px gridline (:205-207). Ours was a
  // bare borderless table on the page background. So the table component was NOT the same, and the
  // reason it was missed is that the rule lived in a global stylesheet, not next to
  // the markup, so reading RegionDetail.vue alone could not show it.
  // overflow:hidden is what makes border-radius clip the header's own background.
  '.rd-table{ width:100%; min-width:560px; border-collapse:collapse; font-size:var(--font-size-md);' +
  '  border-radius:var(--dx-radius-lg); overflow:hidden; background:#fff;' +
  '  box-shadow:0 0 0 1px var(--dx-table-border); }' +
  // td ONLY — their th has no border of its own, it has the header fill.
  '.rd-table td{ border:1px solid var(--dx-table-border); }' +
  '.rd-table th, .rd-table td{ padding:var(--spacing-2xs) 13.3px; text-align:start; }' +
  '.rd-table th:not(:first-child), .rd-table td:not(:first-child){ text-align:end; }' +
  '.rd-table th{ background:var(--dx-muted); color:var(--dx-on-dark); font-weight:500; }' +
  '.rd-tr--selected{ background:#e8ece7; font-weight:600; }' +
  // ★ Their country cell is a <NuxtLink>, i.e. an <a>, which picks up base/_globals.scss:132-141:
  // --color-brand-light, --font-weight-medium, the UA underline at 2px thickness / 4px offset,
  // hovering to --color-brand-lighter. Ours is a <button> (it selects a subject in place
  // rather than navigating, which is the one thing this element does differently) and a
  // button inherits NONE of that — it read as plain body text, unweighted and unlined.
  // So the anchor rule is spelled out here: same element role, same appearance.
  '.rd-row-link{ appearance:none; background:none; border:0; padding:0; margin:0; cursor:pointer;' +
  '  font:inherit; font-weight:500; color:var(--dx-link); text-align:start;' +
  '  text-decoration:underline; text-decoration-thickness:2px; text-underline-offset:4px;' +
  '  text-decoration-skip-ink:auto; transition:color .3s ease; }' +
  '.rd-row-link:hover{ color:var(--dx-link-hover); }' +
  '.rd-row-link:focus-visible{ outline:2px solid var(--dx-accent); outline-offset:2px; border-radius:4px; }',
  'region-dashboards'
)
</script>

<template>
  <!-- :lang is here for the SAME REASON :dir is: a [lang=] selector in this shadow root cannot
         see the host document's attribute, so the switch their global sheet performs on
         [lang="ru-RU"] can only fire if the attribute is INSIDE the root. It is also simply
         correct HTML — screen readers and hyphenation read it. -->
    <div class="rd-root" :class="{ 'rd-root--all': isAll }" :lang="locale" :dir="isRTL ? 'rtl' : 'ltr'">
    <!-- a landmark, so a screen reader can jump to the dashboard body; the app probe
         measured none on the page and it costs nothing to name the region. -->
    <main ref="scrollEl" class="rd-scroll" :aria-label="t('Region dashboard')">
      <div v-if="loading" class="rd-status">{{ t('Loading region dashboards…') }}</div>
      <div v-else-if="loadFailed" class="rd-status rd-failed" role="status">{{ t('Region data could not be loaded. This is a connection problem, not a filter.') }}</div>

      <!-- ★ ONE TEMPLATE, ONE MAP INSTANCE — not two branches each owning a <RegionCountryMap>.
           MEASURED: with a branch per subject kind, switching region -> country UNMOUNTED one map
           and MOUNTED another, and the new one initialised into a container that had no size yet.
           It reported a 1200x780 canvas and drew NOTHING: layers [], m.loaded() false, a blank
           white card. Every assertion I had passed, because "a canvas exists at size" is not the
           same property as "the map drew something".
           So the map is mounted ONCE here and re-framed by prop (applySubject), and the blocks
           that genuinely differ between their two pages are the ones that come and go. DOM order
           is chosen so each page reads in ITS OWN sequence with no CSS reordering:
             region/all  head · stats · map · chart · goals · table     (RegionDetail.vue)
             country     head · map · people-group list                 (CountryDetail.vue) -->
      <template v-else>
        <!-- RegionDetail.vue:47-51 / CountryDetail.vue:37-45 — back-link, title, summary -->
        <div class="rd-head">
          <p v-if="!isAll" class="rd-backlink">
            <button type="button" class="rd-light-link" @click="clearSelection">&larr; {{ t('All Regions') }}</button>
          </p>
          <h1 class="rd-title">{{ titleParts.head ? titleParts.head + ' ' : '' }}<span class="rd-title__last">{{ titleParts.last }}</span></h1>
          <!-- aria-busy, not just a changed label: a screen reader is told the control is working,
               and :disabled is what actually prevents the second print. -->
          <p class="rd-printrow">
            <button
              type="button"
              class="rd-print"
              :disabled="printing"
              :aria-busy="printing ? 'true' : 'false'"
              @click="printDashboard"
            >{{ printing ? t('Preparing the page…') : t('Print') }}</button>
          </p>
          <p v-if="subject.kind === 'country'" class="rd-summary">
            <!-- RAW, not formatNumber: CountryDetail.vue:40 is `{{ country.count }}` and that
                 component never defines formatNumber (RegionDetail does). Their own asymmetry. -->
            {{ subject.stats.count }} {{ t('People Groups') }} &middot;
            <button
              type="button"
              class="rd-light-link"
              @click="selectFromTable({ kind: 'region', key: selectedRegion?.slug })"
            >{{ subject.context }}</button>
          </p>
          <p v-else class="rd-summary">{{ summaryLine }}</p>
          <p v-if="isAll" class="rd-prompt">
            {{ t('Pick a region or a country on the Regions List tab to narrow this dashboard.') }}
          </p>
        </div>

        <!-- THE CHOOSER — the no-selection state, and the only thing here DX-life does not have -->
        <div v-if="isAll" class="rd-chooser">
          <!-- Labels and placeholders through t(), using THEIR existing keys rather than new
               ones: 'Regions', 'Countries' and 'Type to search...' are all in their common.json
               and translated in every locale we ship. These were static attributes, so at ar the
               element's one KEYBOARD/SCREEN-READER path — which the brief calls load-bearing,
               since pin clicking is mouse-only — was labelled in English inside an otherwise
               localised page. The plural reads naturally on a selector and costs no new strings.
               The placeholders were invisible to a text-node scan, which is its own lesson. -->
          <FilterDropdown
            :label="t('Regions')"
            name="region"
            :options="regionOptions"
            value=""
            :placeholder="t('Type to search...')"
            @filter-change="onPickRegion"
            @filter-clear="clearSelection"
          />
          <FilterDropdown
            :label="t('Countries')"
            name="country"
            :options="countryOptions"
            value=""
            :placeholder="t('Type to search...')"
            @filter-change="onPickCountry"
            @filter-clear="clearSelection"
          />
        </div>

        <!-- RegionDetail.vue:53-70 — four stat cards. CountryDetail has none. -->
        <div v-if="subject.kind !== 'country'" class="rd-stats">
          <StatCard v-for="st in stats" :key="st.label" :value="st.value" :label="st.label" />
        </div>

        <!-- RegionDetail.vue:72-86 and CountryDetail.vue:47-61 — a .stack--sm of the note and the
             map. color-by-prayer is theirs on the REGION page only; the country page passes it
             not at all, which is what makes its pins read in-country vs surrounding. -->
        <div class="rd-mapblock">
          <p v-if="mapNote" class="rd-mapnote">{{ mapNote }}</p>
          <div class="rd-mapframe">
            <RegionCountryMap
              ref="mapEl"
              :country-codes="focusCodes"
              :points="points"
              :bounds="mapBounds"
              :center="mapCenter"
              :zoom="mapZoom"
              :color-mode="mapColorMode"
              :highlight-region="hoveredRegion"
              :select-on-pin-click="isAll"
              :pray-base-url="prayBaseUrl"
              :research-url="researchUrl"
          :country-url="countryUrl"
              @pick-country="onPickFromMap"
            />
          </div>

          <!-- The country's poster: the Regions list's disclosure, under this country's map (see POSTER_WALL_TAG). -->
          <div v-if="selectedCountry" class="rd-posters">
            <button type="button" class="rd-posters__toggle" :aria-expanded="String(postersOpen)" @click="togglePosters">
              {{ postersOpen ? t('Hide country posters') : t('View country posters') }}
              <svg viewBox="0 0 489.67 289.877" aria-hidden="true" focusable="false"><path d="M439.017,211.678L263.258,35.919c-3.9-3.9-8.635-6.454-13.63-7.665-9.539-2.376-20.051.161-27.509,7.619L46.361,211.632c-10.323,10.323-10.323,27.056,0,37.379,10.323,10.323,27.056,10.323,37.379,0l161.068-161.068,161.068,161.068c10.323,10.323,27.056,10.323,37.379,0,10.277-10.324,10.277-27.011-.238-37.333Z" /></svg>
            </button>
            <div v-show="postersOpen" ref="postersHost" class="rd-posters__wall" />
          </div>

          <!-- THE REGION KEY — chooser only, and it is a CONTROL as well as a key: the requirement
               is a map that shows the regions and countries AND lets a reader select one.
               Rendered in REGION_ORDER because that is the order the palette's CVD separation was
               validated in. Buttons, not swatches with click handlers, so the keyboard reaches
               them and check:a11y-button-names has a name to find. -->
          <ul v-if="isAll" class="rd-regionkey" :aria-label="t('Choose a region')">
            <li v-for="r in regionLegend" :key="r.value">
              <button
                type="button"
                class="rd-regionkey__item"
                :aria-label="tf('See %region% dashboard', { region: r.label || t('Other') })"
                @click="sel = { regionSlug: r.slug, countrySlug: '' }"
                @mouseenter="hoveredRegion = r.value"
                @mouseleave="hoveredRegion = ''"
                @focus="hoveredRegion = r.value"
                @blur="hoveredRegion = ''"
              >
                <i class="rd-regionkey__dot" :style="{ background: r.color }" aria-hidden="true" />
                <span class="rd-regionkey__label">{{ r.label }}</span>
                <span class="rd-regionkey__count">{{ formatNumber(r.count) }}</span>
              </button>
            </li>
          </ul>
          <p v-if="isAll" class="rd-regionkey__hint">
            {{ t("Pick a region above, or click any dot to open that people group's country.") }}
          </p>
        </div>

        <!-- RegionDetail.vue:88-141 — the three DOXA goal cards in their .switcher -->
        <div v-if="subject.kind === 'region'" class="rd-switcher">
          <GoalCard
            variant="secondary"
            :title="t('Prayer Coverage')"
            :value="formatNumber(subject.stats.peopleCommitted)"
            :value-label="t('People committed to praying')"
            :goal-label="t('Goal')"
            :goal="t('Mobilize 100+ people praying daily for each DOXA people group')"
          >
            <ProgressBar
              :max="subject.stats.count"
              :segments="prayerSegments"
              legend
              :format="formatNumber"
              :label="t('Prayer coverage progress')"
            />
          </GoalCard>

          <GoalCard
            :title="t('Adoption Progress')"
            :value="formatNumber(subject.stats.adopted) + ' / ' + formatNumber(subject.stats.count)"
            :value-label="t('people groups adopted')"
            :goal-label="t('Goal')"
            :goal="t('Every unengaged people group adopted by a church committed to prayer, giving, and sending')"
          >
            <ProgressBar :value="subject.stats.adopted" :max="subject.stats.count" />
          </GoalCard>

          <GoalCard
            :title="t('Engagement Progress')"
            :value="formatNumber(subject.stats.engaged) + ' / ' + formatNumber(subject.stats.count)"
            :value-label="t('people groups engaged')"
            :goal-label="t('Goal')"
            :goal="t('No unengaged people groups by 2033')"
          >
            <ProgressBar :value="subject.stats.engaged" :max="subject.stats.count" />
          </GoalCard>
        </div>

        <!-- RegionDetail.vue:144-171 — the five-column breakdown. CountryDetail has no table. -->
        <div v-if="subject.kind !== 'country'" class="rd-section">
          <h2 class="rd-h2 rd-h2--start">{{ tableTitle }}</h2>
          <div class="rd-table-scroll">
            <table class="rd-table">
              <thead>
                <tr>
                  <th>{{ tableFirstCol }}</th>
                  <th>{{ t('People Groups') }}</th>
                  <th>{{ t('1+ People Praying') }}</th>
                  <th>{{ t('Adopted') }}</th>
                  <th>{{ t('Engaged') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in tableRows" :key="row.key" :class="{ 'rd-tr--selected': row.isSelected }">
                  <td><button type="button" class="rd-row-link" @click="selectFromTable(row)">{{ row.name }}</button></td>
                  <td>{{ formatNumber(row.count) }}</td>
                  <td>{{ formatNumber(row.withPrayer) }}</td>
                  <td>{{ formatNumber(row.adopted) }}</td>
                  <td>{{ formatNumber(row.engaged) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- CountryDetail.vue:63-69 — <UupgsList :lock-country-code hide-see-all-link />, and
             nothing around it: their page puts no heading above this block. -->
        <!-- C11, found by the bug-class sweep: RegionCountryMap already received :research-url and
             this list did not, so a host configuring researchUrl got it honoured on the map popup's
             Full Profile link and silently ignored by every profile link here. One config, two
             surfaces, two answers — and the wrong one fell back to a hardcoded doxa.life default,
             so it looked like a working link rather than a missing binding. -->
        <UupgsList
          v-if="subject.kind === 'country' && selectedCountry"
          :lock-country-code="selectedCountry.code"
          :pray-base-url="prayBaseUrl"
          :language-code="languageCode"
          :images-base="assetsBase + '/images'"
          :research-url="researchUrl"
        />
      </template>
    </main>
    <!-- Inside .rd-root, which is position:absolute inset:0, so the button's own absolute
         positioning resolves against the plugin rather than the host page. -->
    <BackToTopButton :target="scrollEl" :labels="{ backToTop: t('Back to top') }" />
  </div>
</template>
