<script setup>
/**
 * UupgsList.vue — DX-life's people-group list, ported for the country page.
 *
 * @description CountryDetail.vue:63-69 nests <UupgsList :lock-country-code="country.code"
 *   hide-see-all-link />. That component IS the bottom half of the page you land on when you
 *   click a country on DX-life, so cloning that page means cloning this. Ported from
 *   root-dx-life/doxa-life/app/components/public/UupgsList.vue (read-only clone, standing law),
 *   which is itself a Lit -> Vue port of marketing-theme/js/components/src/uupgs-list.ts and
 *   whose own header says it "preserves class names, markup structure, fetch endpoints, and
 *   filter logic verbatim so the source SCSS applies unchanged".
 *
 * WHAT IS CLONED. The markup and the class names, so the ported CSS below is theirs rather than
 * a lookalike: .filters / .filters__toggle / .filters__panel / .filters__active / .filter-chip,
 * the .search-box, the .grid[data-width-lg] card grid, and the .uupg__card grid-template-areas
 * with its 576px reflow. Their endpoint and field list too (UupgsList.vue:388).
 *
 * SCOPED TO WHAT THE COUNTRY PAGE ACTUALLY RENDERS, and that is a deliberate narrowing rather
 * than an omission. Their component carries four call-sites' worth of options — useSelectCard,
 * useHighlightedUUPGs, randomizeList, dontShowListOnLoad, a select-card variant with prayer
 * counters, the /highlighted endpoint, the see-all link. CountryDetail passes NONE of them: it
 * passes a locked country and hide-see-all-link, which selects the DEFAULT full card and hides
 * the see-all. Porting the branches the page cannot reach would be code no consumer runs.
 *
 * NOT CLONED, and it is visible: their cards show a photo per people group from image_url, and
 * the /api/people-groups/list response we consume carries has_photo + image_url, so the img is
 * wired. Where a group has no photo the card reflows without one, as theirs does.
 */
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'
// ar renders right-to-left. RTL_LOCALES is the shared set and :dir on our own root is the
// house pattern (doxa-simple-map.vue:18, :246, :1346) — an EMBEDDED element must not reach for
// document.documentElement.dir, which belongs to the host page.
import { RTL_LOCALES } from '@map/i18n/index.js'
import FilterDropdown from '@map/components/search/FilterDropdown.vue'
// Their strings, via their own keys — see useRegionsI18n. buildUupgListTranslations.ts is the
// authoritative list of what this component's labels are called, and porting it corrected
// several I had written from the markup instead: the rop1 filter is 'People Group' not
// 'Affinity Bloc', the search placeholder is the full
// 'Search names, country/continent, religions...', and prayer_coverage reads 'Intercessors'.
import { useRegionsI18n } from '@map/i18n/useRegionsI18n.js'
// THEIR SEARCH, via the repo's Fuse-compatible shim. fuzzy.js exposes the surface their UupgsList
// uses — keys, threshold, minMatchCharLength, matches[].indices — and its own header says those
// indices exist to drive the <span class="search-highlight"> wrapping. So the wiring is a port.
//
// THIS IS THE ONE DOCUMENTED SUBSTITUTION (RULE 1), and it is not exact parity — an earlier
// version of this note claimed "Fuse-parity" and "not a new matcher" without ever measuring it.
// WHAT FORCED IT: theirs is Fuse.js; Fuse is not in package.json and not installed, and the brief
// forbids new dependencies. Reimplementing Fuse's bitap scoring would be a from-scratch lookalike
// of a scoring algorithm — the thing RULE 1 calls a failure even when it looks right — and this
// shim has four other consumers (people-groups-grid, gospel-resources x2, research-dashboard), so
// changing its tiered contract to chase Fuse would alter their search too.
//
// THE MEASURED COST, ours vs live /regions/cameroon (_probe-search-vs-live.mjs):
//   "Cameroon"  ours 8 rows / 9 highlight spans === theirs 8 / 9, and the SAME rows
//   "Cameron"   a typo of it: both find 8 — tolerance holds
//   "Wolof"     both empty
//   "islam"     ours 5, theirs 7. The two we omit are Majera and Osatu; Osatu's religion is
//               "Ethnoreligion - Animism" and "islam" appears in none of the seven keys. They are
//               Fuse's fuzzy reach at threshold 0.4, not rows we failed to find — and our shim's
//               tier 1 deliberately returns the exact set and stops. We never return a row live
//               would not; the shortfall is always on the fuzzy side.
// Also unimplemented: useExtendedSearch's operator syntax (^prefix, !exclude, 'literal, |or).
import Fuse from '@map/components/search/fuzzy.js'
import { highlightRanges } from '@map/composables/useTextHighlight.js'
// DX-life's spacing/type scales under THEIR token names. Prepended to this
// component's shadow CSS so every var() below resolves inside the shadow root.
import { DXLIFE_TOKENS } from '../dxlife-tokens.js'
import { joinBase } from '@map/composables/joinBase.js'
import { countrySlug } from '@map/utils/countries-meta.js'

const props = defineProps({
  // ISO-3. Their `lockCountryCode`: the country filter is pre-applied and its dropdown hidden.
  lockCountryCode: { type: String, default: '' },
  prayBaseUrl: { type: String, default: 'https://pray.doxa.life' },
  languageCode: { type: String, default: '' },
  researchUrl: { type: String, default: 'https://doxa.life/research/' },
  // Where a COUNTRY name links. DX-life's own UupgsList sends it to localePath('/regions/<slug>'),
  // i.e. a page on the host site, not a research profile — so the base has to come from the host.
  countryUrl: { type: String, default: 'https://doxa.life/regions/' },
  // Their perPage / morePerPage defaults (UupgsList.vue props block).
  perPage: { type: Number, default: 24 },
  morePerPage: { type: Number, default: 0 },
  // Where worldmap.svg lives. THEIRS is a bare `const imagesUrl = '/assets/images'`
  // (UupgsList.vue:73) because their app is served from one origin; ours must take it from the
  // caller, since a dropped bundle resolves its assets relative to the tree it sits in.
  imagesBase: { type: String, default: './assets/images' },
})

// Their field list, verbatim (UupgsList.vue:388).
// ★ location_description IS NOT IN THIS LIST, and its absence is the clone being correct.
// The doxa-maps-build branch of DX-life renders <p class="uupg__content"> with it and then hides
// the element with display:none; their MASTER has removed the markup, the rule and the field.
// We had cloned the hidden version faithfully — including fetching a field on every request purely
// to fill an element nobody can see. The pin POPUP still needs location_description and still asks
// for it: that is region-dashboards.vue's own FIELDS (:176), a different request.
const FIELDS = 'name,slug,wagf_region,wagf_block,country_code,rop1,religion,has_photo,image_url,adopted_by_churches,imb_alternate_name,engagement_status,people_committed'

const { t , locale } = useRegionsI18n()
const isRTL = computed(() => RTL_LOCALES.has(locale.value))

// buildUupgListTranslations (app/utils/uupgListTranslations.ts), ported key for key. Their
// component takes this as a `t` prop; ours resolves it from the catalogue at render time so a
// locale change re-renders without re-mounting.
const T = computed(() => ({
  search: t('Search names, country/continent, religions...'),
  show_filters: t('Show Filters'),
  hide_filters: t('Hide Filters'),
  clear_all: t('Clear All'),
  type_to_search: t('Type to search...'),
  wagf_region: t('WAGF Region'),
  wagf_block: t('WAGF Block'),
  rop1: t('People Group'),
  religion: t('Religion'),
  loading: t('Loading results...'),
  load_more: t('Load More'),
  full_profile: t('Full Profile'),
  total: t('Total'),
  alternate_name: t('Alternate Names'),
  exact_filter: t('Exact Search'),
  adopted_filter: t('Adopted'),
  engaged_filter: t('Engaged'),
}))

const rows = ref([])
const loading = ref(true)
const failed = ref(false)
const searchTerm = ref('')
const filtersExpanded = ref(false)
const shown = ref(props.perPage)
// Their filter set, minus `country` — a locked country hides that one (their own rule).
// adopted / engaged / exact live in the SAME activeFilters object theirs uses, not a separate
// flag set, because their applyDropdownFilters() iterates that object and branches on the
// field name — and their chips row renders whatever is in it, toggles included.
const active = ref({ wagf_region: null, wagf_block: null, rop1: null, religion: null,
  adopted: null, engaged: null, exact: null })

const label = (f) => (f && typeof f === 'object' ? f.label : f) || ''
const value = (f) => (f && typeof f === 'object' ? f.value : f) || ''

// The page's profile-config, for its people-group LIST; this list sits under the same ProfileLoader.
const listCfg = inject('profileConfig', null)

async function load() {
  loading.value = true
  failed.value = false
  try {
    const r = await fetch(`${props.prayBaseUrl}/api/people-groups/list?fields=${FIELDS}&lang=${props.languageCode}`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const d = await r.json()
    // Only the groups of this page's people-group LIST (library/lists/).
    const all = await applyPeopleGroupList(Array.isArray(d.posts) ? d.posts : [], listCfg)
    rows.value = props.lockCountryCode
      ? all.filter((p) => value(p.country_code) === props.lockCountryCode)
      : all
  } catch (e) {
    console.error('[UupgsList] fetch error:', e)
    failed.value = true
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.lockCountryCode, load)

// Distinct values per filter key, with counts — the shape FilterDropdown wants.
function optionsFor(key) {
  const m = new Map()
  for (const p of rows.value) {
    const v = value(p[key]); const l = label(p[key])
    if (!v) continue
    const e = m.get(v) || { value: v, label: l || v, count: 0 }
    e.count++; m.set(v, e)
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
}
const filterDefs = computed(() => [
  { name: 'wagf_region', label: T.value.wagf_region },
  { name: 'wagf_block', label: T.value.wagf_block },
  { name: 'rop1', label: T.value.rop1 },
  { name: 'religion', label: T.value.religion },
].map((f) => ({ ...f, options: optionsFor(f.name) })))

const activeChips = computed(() =>
  Object.entries(active.value).filter(([, v]) => v).map(([name, v]) => ({ name, ...v }))
)

// Their comment, UupgsList.vue:264-265: "Search compares with combining diacritics stripped, so
// 'Mexico' matches 'México'. Safe for highlighting: stripping marks from NFC data preserves
// string indices." They do it through Fuse's getFn; our shim has no getFn, so the corpus is
// pre-stripped instead and the indices are applied to the ORIGINAL strings — which is exactly
// the property their comment establishes.
function stripDiacritics(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Their key list, verbatim (UupgsList.vue:307-315).
const SEARCH_KEYS = ['name', 'imb_alternate_name', 'country_code.label', 'rop1.label',
  'religion.label', 'wagf_region.label', 'wagf_block.label']

const byPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o)

// Their dropdown filters AND first, then the term. (Their filterUUPGs, same order.)
const preFiltered = computed(() => rows.value.filter((p) => {
  for (const [k, v] of Object.entries(active.value)) {
    if (!v) continue
    // THEIR applyDropdownFilters branches, verbatim (UupgsList.vue:190-205).
    if (k === 'adopted') { if (!((p.adopted_by_churches ?? 0) > 0)) return false; continue }
    // ★ THEIR BUG, CLONED ON PURPOSE. Their branch is
    //     filtered.filter(u => (u.people_praying ?? 0) > 0)
    // and `people_praying` is NOT in the field list they request — they fetch
    // people_committed. So the field is always undefined and the filter matches nothing.
    // MEASURED on their live /regions/india: 855 rows before, 0 after clicking Engaged.
    // The scope rule is that what exists on DX Life must match it here, so this reproduces their
    // result rather than quietly correcting it. Reading people_committed instead would make
    // us DIFFER. Raised upstream as a product question: the fix is one word, in their file.
    if (k === 'engaged') { if (!((p.people_praying ?? 0) > 0)) return false; continue }
    // Their `exact` branch is `filtered = filtered` — a no-op here. It only changes the FUSE
    // threshold once a search term exists, which is where we already read active.exact.
    if (k === 'exact') continue
    if (value(p[k]) !== v.value) return false
  }
  return true
}))

/**
 * Wrap each matched index range in <span class="search-highlight">, their exact construction
 * (UupgsList.vue:336-348): escape the gap, wrap the hit, and append the tail only on the last
 * range. Indices come from the stripped corpus and are applied to the original string.
 */
const highlight = (original, indices) => highlightRanges(original, indices)

const filtered = computed(() => {
  const term = searchTerm.value.trim()
  if (!term) return preFiltered.value

  // Search a diacritic-stripped MIRROR of each row, keeping a handle on the original.
  const corpus = preFiltered.value.map((p) => ({
    __row: p,
    name: stripDiacritics(p.name),
    imb_alternate_name: stripDiacritics(p.imb_alternate_name),
    country_code: { label: stripDiacritics(label(p.country_code)) },
    rop1: { label: stripDiacritics(label(p.rop1)) },
    religion: { label: stripDiacritics(label(p.religion)) },
    wagf_region: { label: stripDiacritics(label(p.wagf_region)) },
    wagf_block: { label: stripDiacritics(label(p.wagf_block)) },
  }))
  // Their Fuse options: minMatchCharLength 3, and threshold 0 when Exact Search is on.
  const fuse = new Fuse(corpus, {
    keys: SEARCH_KEYS,
    threshold: active.value.exact ? 0 : 0.4,
    minMatchCharLength: 3,
  })

  return fuse.search(stripDiacritics(term)).map((res) => {
    const row = res.item.__row
    // A shallow copy per result, so highlighting never mutates the fetched rows — their version
    // resets the labels on every keystroke precisely because it mutates in place.
    const out = { ...row, matches: [], name_label: '', country_label: '', rop1_label: '' }
    for (const m of (res.matches || [])) {
      const original = String(byPath(row, m.key) ?? (m.key.includes('.') ? label(byPath(row, m.key.split('.')[0])) : ''))
      if (!original) continue
      const html = highlight(original, m.indices)
      const parent = m.key.split('.')[0]
      // Their routing, UupgsList.vue:350-375, for the DEFAULT (non-select-card) card:
      //   name              -> the title itself
      //   country_code      -> the country link
      //   rop1              -> shown beside the country, as their card does
      //   imb_alternate_name-> a "Alternate Names" matches row
      //   religion/wagf_*   -> a labelled matches row
      // wagf_region is deliberately dropped on this card, exactly as theirs is.
      if (m.key === 'name') out.name_label = html
      else if (m.key === 'imb_alternate_name') out.matches.push({ key: T.value.alternate_name, label: html })
      else if (parent === 'country_code') out.country_label = html
      else if (parent === 'rop1') out.rop1_label = html
      else if (parent === 'wagf_region') { /* their card shows none */ }
      else out.matches.push({ key: parent === 'religion' ? T.value.religion : T.value.wagf_block, label: html })
    }
    return out
  })
})
const displayed = computed(() => filtered.value.slice(0, shown.value))
const showMore = computed(() => filtered.value.length > shown.value)
function loadMore() { shown.value += (props.morePerPage || props.perPage) }
watch([searchTerm, active], () => { shown.value = props.perPage }, { deep: true })

// Their toggleAdopted / toggleEngaged / toggleExact (UupgsList.vue:169-188): a second click
// REMOVES the filter, and each sets a {value:'yes', label} pair so it also appears as a chip.
function toggleFlag(name, label) {
  active.value = { ...active.value, [name]: active.value[name] ? null : { value: 'yes', label } }
}

function onFilterChange(e) { if (e && e.name) active.value = { ...active.value, [e.name]: { value: e.value, label: e.label } } }
function onFilterClear(e) { if (e && e.name) active.value = { ...active.value, [e.name]: null } }
function clearAll() { active.value = { wagf_region: null, wagf_block: null, rop1: null, religion: null } }
function profileUrl(p) { return joinBase(props.researchUrl, p.slug || '') }
// ★ THE COUNTRY LINK POINTED AT THE PEOPLE GROUP. It used profileUrl(p), the same destination as
// the "Full Profile" button directly beneath it — two links on one card, one of them labelled with
// a country name, both landing on that people group's profile.
//
// THEIRS, both card variants (app/components/public/UupgsList.vue:610 and :638):
//     localePath(`/regions/${countrySlug(country_code.value, country_code.label)}`)
// A page on the HOST site. That is why the base is a prop and not a constant: only the host knows
// where its country pages live, and DX-life's are under /regions/, not under a research base.
// Our countrySlug is theirs, verbatim — same body, same slugify, same ENGLISH_NAME_BY_CODE.
function countryHref(p) {
  const code = value(p.country_code)
  if (!code) return profileUrl(p)
  return joinBase(props.countryUrl, countrySlug(code, label(p.country_code)))
}

// Every value resolved against DX-life's 10px rem root, from the same token files as the rest of
// this bundle. Sources: blocks/_filters.scss (.filters*, .filter-chip*), blocks/_form.scss
// (.search-box, input[type=search]), blocks/_cards.scss:143-236 (.uupg__*), blocks/_buttons.scss
// (.button, .button.compact), composition/_grid.scss (.grid + data-width-lg).
// NO BACKTICKS in this string, including comments (house style: one terminates the literal).
useShadowStyles(
  DXLIFE_TOKENS +
  ':host{ display:block; }' +
  // The static half of their watermark. The URL itself is inline (it needs imagesBase at
  // runtime); everything that does not depend on the base lives here.
  '.ul-root{ display:flex; flex-direction:column; gap:var(--spacing-md);' +
  '  background-repeat:no-repeat; background-size:60%; background-position:top; min-height:400px;' +
  '  --dx-text:#2a332a; --dx-muted:#6d766e; --dx-white:#fff; color:var(--dx-text);' +
  '  font:var(--font-size-md)/1.5 Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }' +
  // .filters — a .stack--md column
  '.filters{ display:flex; flex-direction:column; gap:var(--spacing-md); }' +
  // .search-box + input[type=search]: 100% wide, pill, text indented past the icon
  // .search-box is theirs at width:100% (blocks/_form.scss:115-118); the cap comes from the
  // .max-width-md utility they compose onto it, which is `max-width: 50ch`
  // (utilities/_sizes.scss:11). This was a hardcoded 480px — the wrong value AND the wrong
  // UNIT: ch scales with the input's own font, px does not, so the box stopped tracking the
  // type at every other size. MEASURED: theirs renders ~600px inside the 1200px container
  // and shows the whole placeholder; ours truncated it at 480px.
  '.search-box{ position:relative; width:100%; max-width:50ch; margin-inline:auto; }' +
  '.search-box input{ width:100%; border:1px solid #666; border-radius:100px;' +
  '  background:var(--dx-white); padding:10px var(--spacing-lg); text-indent:1.5em; font:inherit;' +
  '  font-size:var(--font-size-md); color:var(--dx-text); }' +
  '.search-box input::placeholder{ color:gray; }' +
  // THEIRS verbatim, blocks/_form.scss:119-128 — inset-inline-start:1em, top:0/bottom:0 with
  // margin:auto 0 for the centring, and 1em square so the icon scales with the input's type.
  // Ours had `left:16px` with a translate, which in RTL left the icon on the physical LEFT:
  // MEASURED against their live /ar/regions/cameroon, ours sat 566px from the inline-start edge
  // against their 19.5px. A physical property survives a direction flip; a logical one does not.
  // Their fixed 18px square also could not track the font, where theirs is 1em.
  '.search-icon{ position:absolute; inset-inline-start:1em; top:0; bottom:0; margin:auto 0;' +
  '  width:1em; height:1em; fill:none; stroke:var(--dx-muted); stroke-width:2; pointer-events:none; }' +
  // .filters__toggle — centred, chevron rotates when expanded
  // ★ THEIRS IS .button.compact.link, NOT A BARE BUTTON, and ours was missing four of its
  // declarations. Measured on /regions/ethiopia: ours 25.44px tall against their 37.63.
  // Their numbers reconcile exactly once the right rules are applied -- _buttons.scss gives
  // .button { border:1px solid var(--button-border-color, transparent); line-height:
  // var(--line-height-none); border-radius:100px } and .button.compact { padding: var(--spacing-xs)
  // var(--spacing-2xl) }, with .button.link setting --button-border-color: transparent:
  //     line-height 15.63 (font-size-sm x 1) + 2x10 padding + 2x1 border = 37.63
  // Ours declared NO padding (so the UA's 1px showed) and border:0, and font:inherit pulled the
  // base line-height 1.5 through as 23.44. All four are portable, so all four are ported.
  // THE ONE SUBSTITUTION, documented rather than silently skipped: their .button also sets
  // font-family: var(--font-family-buttons), which resolves to Brandon Grotesque. That face is
  // commercial and BLOCKED ON A LICENSING DECISION, so this button keeps our stand-in and the family remains
  // the one measured difference here. Everything geometric now matches.
  '.filters__toggle{ background:none; cursor:pointer; font:inherit; font-size:var(--font-size-sm);' +
  // ★ LITERAL 10px, NOT var(--spacing-xs) -- I used the token and it DOES NOT EXIST.
  // dxlife-tokens.js:43-45 says so explicitly and gives the reason: "--spacing-xs (10px) and
  // --spacing-sm (13.3px) are deliberately NOT tokenised: '10px' is far too common a literal in this
  // CSS to substitute safely, and a wrong substitution here is worse than a magic number because it
  // reads as deliberate." I substituted anyway.
  // WHAT AN UNDEFINED var() COSTS, measured: it invalidates the WHOLE declaration at compute
  // time, so padding fell to 0 on BOTH axes and the button went 25.44 -> 17.63 -- FURTHER from their
  // 37.63 than before I touched it. The border, radius and line-height all landed; only this line
  // failed, and it failed silently. Their computed value is "10px 41.6158px", so with the literal:
  // 15.625 + 2x10 + 2x1 = 37.63 tall and ~210.7 wide (theirs 210.73).
  '  padding:10px var(--spacing-2xl); border:1px solid transparent; border-radius:100px;' +
  '  line-height:var(--line-height-none);' +
  '  display:inline-flex; align-items:center; gap:var(--spacing-2xs); margin-inline:auto; color:var(--dx-text); }' +
  '.filters__toggle svg{ transition:transform 200ms ease; }' +
  '.filters__toggle[aria-expanded="true"] svg{ transform:rotate(180deg); }' +
  // .filter-toggle — their _filters.scss:218 composed with .input and .fit-content, taken
  // from the MEASURED computed style of their live button rather than by chasing tokens:
  // padding 5.65323px 13.3px, font-size var(--font-size-sm), radius 8px, 1px solid rgb(128,128,128),
  // white ground, ink rgb(42,51,42), width fit-content, and a 150ms border/background
  // transition.
  '.filter-toggle{ padding:5.65323px 13.3px; cursor:pointer; font:inherit;' +
  '  font-size:var(--font-size-sm); color:#2a332a; border:1px solid rgb(128,128,128); border-radius:8px;' +
  '  background-color:#fff; width:fit-content;' +
  '  transition:border-color 150ms ease, background-color 150ms ease; }' +
  '.filter-toggle:hover{ border-color:#92b195; }' +
  // ★ THIS SHIPPED AN ILLEGIBLE BUTTON FOR A CLONE OF A LEGIBLE ONE, and the comment that used to
  // sit here is why it lasted. It said their active state is white-on-white "on purpose", that
  // --color-surface-brand-lighter "is NOT DEFINED in their token files", and that the white-on-white
  // had been "MEASURED on their live page". Two of those three were wrong:
  //   · tokens/semantic/_colors.scss:64 DOES define it — $color-green-300, #6d766e.
  //   · getComputedStyle returns the SPECIFIED colour, never the composite, so neither candidate
  //     could ever serialise as white: the token is #6d766e and the declared fallback is
  //     rgba(0,80,160,0.05). The only rule on that button yielding white is .input's
  //     var(--color-surface-white) — which is the INACTIVE state. The "measurement" had almost
  //     certainly read a button without data-active set.
  // MEASURED PROPERLY (_probe-filter-state-vs-live.mjs, which CLICKS the Adopted filter on both
  // sides and then reads): their live active button is background rgb(109,118,110) on
  // color rgb(255,255,255). White on grey-green. Perfectly legible. We were shipping their DEAD
  // FALLBACK — 5%-alpha blue, which over the white .input ground leaves a white label on white.
  // So: the token's value, as theirs resolves it.
  '.filter-toggle[data-active]{ background-color:#6d766e; color:#fff; }' +
  '.filters__panel{ display:flex; flex-wrap:wrap; gap:13.3px; justify-content:center;' +
  '  align-items:flex-start; }' +
  '.filters__active{ display:flex; flex-wrap:wrap; gap:var(--spacing-2xs); align-items:center;' +
  '  justify-content:center; }' +
  // .filter-chip — surface-brand-lighter on white, fully round
  '.filter-chip{ display:inline-flex; gap:var(--spacing-2xs); background:#6d766e; color:#fff;' +
  '  border-radius:100px; padding:var(--spacing-3xs) 13.3px; font-size:var(--font-size-sm); text-align:center; }' +
  '.filter-chip__remove{ background:none; border:0; cursor:pointer; font-size:1.1em; line-height:1;' +
  '  color:inherit; padding:0; display:inline-flex; align-items:center; }' +
  '.filter-chip__remove:hover{ opacity:0.7; }' +
  // ★ Clear All is `.button compact link` on their side, and blocks/_buttons.scss:64-69 gives
  // .button.link `--button-text-color: var(--color-brand)` = $color-green-500 = #3b463d. Ours used
  // var(--dx-text) (#2a332a, the body ink) — a different green, measured against live as
  // rgb(42,51,42) vs their rgb(59,70,61). Found twice over, independently: by the applied-filter
  // diff, and by a static sweep of their markup's classes that flagged `.link` as a rule our CSS
  // had no equivalent for at all.
  '.filters__clear-all{ background:none; border:0; cursor:pointer; font:inherit; font-size:var(--font-size-sm);' +
  '  color:#3b463d; text-decoration:underline; text-underline-offset:4px;' +
  '  text-decoration-thickness:2px; }' +
  // .repel — their space-between row (composition/_repel.scss), at --font-size-md gap.
  '.ul-total{ display:flex; gap:var(--spacing-md); justify-content:space-between; align-items:center; }' +
  '.ul-total__count{ font-size:var(--font-size-sm); }' +
  // utilities/_visibility.scss:17 — theirs exactly.
  '.invisible-placeholder{ visibility:hidden; overflow:hidden; }' +
  // .grid[data-width-lg] — auto-fit, 400px min track, --spacing-2xl gap
  '.grid{ display:grid; grid-gap:var(--spacing-2xl);' +
  '  grid-template-columns:repeat(auto-fit, minmax(min(400px,100%), 1fr)); }' +
  // .card + .uupg__card: their grid-template-areas, radius-xlg, --spacing-md padding + gap
  '.uupg__card{ background:var(--dx-white); color:var(--dx-text);' +
  '  border-radius:35px; display:grid;' +
  '  grid-template-areas:"image header adopted" "image content content" "footer footer footer-right";' +
  '  grid-template-columns:auto 1fr auto; grid-template-rows:auto auto auto;' +
  '  gap:var(--spacing-md); padding:var(--spacing-md); }' +
  '.uupg__image{ width:100px; height:100px; object-fit:cover; grid-area:image; border-radius:7.5px;' +
  '  background:#f3f3f1; }' +
  '.uupg__header{ grid-area:header; }' +
  '.uupg__name{ margin:0; font-family:inherit; font-size:var(--font-size-lg); font-weight:500;' +
  '  line-height:1.25; }' +
  '.uupg__country{ margin:0; font-size:var(--font-size-md); }' +
  '.uupg__country-link{ color:#4e594f; text-decoration:none; }' +
  '.uupg__country-link:hover{ text-decoration:underline; }' +
  // theirs is display:none — the location line is fetched and deliberately not shown
  // blocks/_cards.scss:258 — brand primary ground, white ink.
  // THEIR .sr-only, utilities/_visibility.scss:2-12, verbatim. We already used their CLASS
  // NAME on the search label — which is the right instinct under RULE 1 — but the RULE was
  // never ported, so the class did nothing and the label rendered as visible text above the
  // input, duplicating its own placeholder. Caught by reading the screenshot; every computed
  // check passed, because a class that matches no rule is invisible to a property diff.
  // Borrowing a class name only works if its declarations travel with it.
  '.sr-only{ position:absolute; width:1px; height:1px; padding:0; margin:-1px;' +
  '  overflow:hidden; clip:rect(0, 0, 0, 0); white-space:nowrap; border-width:0; }' +
  '.search-highlight{ background-color:#92b195; color:#fff; }' +
  '.uupg__match{ margin:0; font-size:var(--font-size-sm); color:var(--dx-muted); }' +
  // .button.compact, grid-area footer, bottom-aligned
  '.uupg__more-button{ grid-area:footer; align-self:flex-end; display:block; width:fit-content;' +
  '  padding:10px var(--spacing-2xl); color:#f3f3f1; background:#92b195;' +
  '  border-radius:100px; border:1px solid transparent; line-height:1; text-decoration:none;' +
  '  text-transform:uppercase; font-size:var(--font-size-md);' +
  // THEIR FAMILY IS "Brandon Grotesque", WHICH IS COMMERCIAL — the one substitution RULE 1
  // allows, and a commercial face must not ship in a public giveaway.
  // Figtree chosen by MEASUREMENT, not by name: on live doxa.life their button renders
  // 'FULL PROFILE' at 128.00px in Brandon at 500/19.5312px. Of 19 libre grotesques measured
  // the same way, Figtree is 126 (-2.00) — closest — against Inter 134, Archivo 135,
  // Poppins 119, Montserrat 148. (The 134.33 in the old scorecard is the GENERIC SANS
  // fallback, not Brandon; their page really does load Brandon_Grotesque_medium.woff2.)
  '  font-family:Figtree,Poppins,-apple-system,"Segoe UI",sans-serif;' +
  '  transition:background-color .3s ease, color .3s ease; cursor:pointer; }' +
  '.uupg__more-button:hover{ background:#2a332a; color:#f3f3f1; }' +
  // their 576px reflow: the photo and the header stop sharing a row
  '@media (max-width:576px){ .uupg__card{' +
  '  grid-template-areas:"image adopted" "header header" "content content" "footer footer";' +
  '  grid-template-columns:auto 1fr; grid-template-rows:auto auto auto auto; } }' +
  '.loading, .ul-status{ text-align:center; color:var(--dx-muted); font-size:var(--font-size-md); padding:var(--spacing-md); }' +
  '.ul-status.ul-failed{ font-weight:600; }' +
  // .center | .button compact .stack-spacing-2xl
  '.ul-more{ margin-inline:auto; margin-top:var(--spacing-2xl); display:block; width:fit-content;' +
  '  padding:10px var(--spacing-2xl); color:#f3f3f1; background:#92b195; border-radius:100px;' +
  '  border:1px solid transparent; line-height:1; text-transform:uppercase; font-size:var(--font-size-md);' +
  '  font-family:Figtree,Poppins,-apple-system,"Segoe UI",sans-serif; cursor:pointer; }' +
  '.ul-more:hover{ background:#2a332a; }',
  'uupgs-list'
)
</script>

<template>
  <!-- THEIR watermark, UupgsList.vue:451-454: the list root carries worldmap.svg as a
       background-image, inline, with background-size 60% / background-position top /
       min-height 400px, over their .bg-image class (_globals.scss:93) which supplies
       background-repeat:no-repeat. MEASURED on their live /regions/cameroon: computed
       background-size 60%, background-position 50% 0%, background-repeat no-repeat,
       min-height 400px — so the inline size and position override .bg-image's cover/center,
       and only no-repeat survives from the class. Reproduced exactly, with the URL taken from
       imagesBase because a dropped bundle cannot assume an absolute /assets path. -->
  <div
    class="ul-root"
    :dir="isRTL ? 'rtl' : 'ltr'"
    :style="`background-image: url(${imagesBase}/worldmap.svg);`"
  >
    <div class="filters">
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" stroke-linecap="round" />
        </svg>
        <label class="sr-only" for="ul-search">{{ T.search }}</label>
        <input id="ul-search" v-model="searchTerm" type="search" :placeholder="T.search" :aria-label="T.search">
      </div>

      <button
        type="button"
        class="filters__toggle"
        :aria-expanded="filtersExpanded ? 'true' : 'false'"
        @click="filtersExpanded = !filtersExpanded"
      >
        {{ filtersExpanded ? T.hide_filters : T.show_filters }}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <div v-if="filtersExpanded" class="filters__panel">
        <FilterDropdown
          v-for="f in filterDefs"
          :key="f.name"
          :label="f.label"
          :name="f.name"
          :options="f.options"
          :value="active[f.name]?.value || ''"
          :placeholder="T.type_to_search"
          @filter-change="onFilterChange"
          @filter-clear="onFilterClear"
        />
      </div>

      <!-- THEIR SECOND PANEL (UupgsList.vue:541-560). We shipped only the dropdown panel, so
           three of their filter controls were simply absent — measured on their live country
           page: two .filters__panel blocks and three .filter-toggle buttons against our one
           and zero. -->
      <div v-if="filtersExpanded" class="filters__panel">
        <button
          type="button"
          class="filter-toggle"
          :data-active="active.adopted ? '' : undefined"
          @click="toggleFlag('adopted', T.adopted_filter)"
        >{{ T.adopted_filter }}</button>
        <button
          type="button"
          class="filter-toggle"
          :data-active="active.engaged ? '' : undefined"
          @click="toggleFlag('engaged', T.engaged_filter)"
        >{{ T.engaged_filter }}</button>
        <button
          type="button"
          class="filter-toggle"
          :data-active="active.exact ? '' : undefined"
          @click="toggleFlag('exact', T.exact_filter)"
        >{{ T.exact_filter }}</button>
      </div>

      <div v-if="activeChips.length" class="filters__active">
        <span v-for="c in activeChips" :key="c.name" class="filter-chip">
          {{ c.label }}
          <button type="button" class="filter-chip__remove" :aria-label="c.label" @click="onFilterClear({ name: c.name })">×</button>
        </span>
        <button type="button" class="filters__clear-all" @click="clearAll">{{ T.clear_all }}</button>
      </div>
    </div>

    <!-- THEIR count line, UupgsList.vue:577-583: "{{ t.total }}: {{ total }}" in a .repel at
         .font-size-sm, with the see-all link on the right — which CountryDetail hides via
         hide-see-all-link, so only the total shows. What was here before ("N People Groups ·
         Cameroon") was MINE, not theirs, and the scope rule says anything that exists on their
         page must match rather than be improved on. -->
    <!-- ★ THE ROW STAYS, AND HOLDS ITS HEIGHT WHILE LOADING. Theirs never removes it: it swaps
         the total for <span class="invisible-placeholder">Placeholder</span>, which
         utilities/_visibility.scss:17 makes visibility:hidden + overflow:hidden — occupying its
         line so the results below do not jump down when the count arrives. Ours removed the whole
         row with a v-if and the layout shifted on every load.
         Found by the class-coverage sweep only AFTER its extractor was widened to the whole file
         (the class is in a branch my template-only scan reached, but the sweep had never seen the
         name at all, so nobody asked what it was for). -->
    <div v-if="!failed" class="ul-total">
      <div class="ul-total__count">
        <template v-if="!loading">{{ T.total }}: {{ filtered.length }}</template>
        <span v-else class="invisible-placeholder">{{ T.total }}</span>
      </div>
    </div>

    <div v-if="failed" class="ul-status ul-failed" role="status">{{ t('People groups could not be loaded. This is a connection problem, not a filter.') }}</div>

    <div id="results" class="grid" data-width-lg>
      <div v-for="p in displayed" :key="p.slug" class="uupg__card">
        <img v-if="p.image_url" class="uupg__image" :src="p.image_url" :alt="p.name" loading="lazy">
        <div class="uupg__header">
          <!-- v-html because the values carry their <span class="search-highlight"> wrapping;
               every segment is escaped in highlight() before the span is added. -->
          <h3 v-if="p.name_label" class="uupg__name" v-html="p.name_label" />
          <h3 v-else class="uupg__name">{{ p.name }}</h3>
          <p class="uupg__country">
            <a class="uupg__country-link" :href="countryHref(p)">
              <span v-if="p.country_label" v-html="p.country_label" /><span v-else>{{ label(p.country_code) }}</span>
            </a>
            <!-- THEIR NODE SHAPE, UupgsList.vue:639: `</a> (<span v-html=... />)`. The parens are
                 TEXT SIBLINGS of a span, with no wrapper element around the group. Ours used an
                 outer <span> and, in the un-highlighted branch, inlined the whole thing as
                 " ({{ label }})" — a SINGLE text node where theirs has three. Measured by the
                 element census against live: ours "(Horn of Africa)" vs theirs "(", "Horn of
                 Africa", ")". <template> renders no element, so this is their exact shape.
                 ★ THE GUARD STAYS, and it is the one deliberate difference. Theirs has none, so a
                 group with no rop1 renders " ()" on their side; measured on /regions/ethiopia all
                 24 of their cards carry a bloc, so the guard never diverges from what they show. -->
            <template v-if="p.rop1_label"> (<span v-html="p.rop1_label" />)</template>
            <template v-else-if="label(p.rop1)"> (<span>{{ label(p.rop1) }}</span>)</template>
          </p>
          <!-- their matches rows, UupgsList.vue:28-32 in the card -->
          <p v-for="(m, mi) in (p.matches || [])" :key="mi" class="uupg__match">
            <strong>{{ m.key }}</strong>: <span v-html="m.label" />
          </p>
        </div>
        <a class="uupg__more-button" :href="profileUrl(p)">{{ T.full_profile }}</a>
      </div>
      <div v-if="loading" class="loading">{{ T.loading }}</div>
    </div>

    <button v-if="showMore" type="button" class="ul-more" @click="loadMore">{{ T.load_more }}</button>
  </div>
</template>
