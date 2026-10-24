<script setup>
/**
 * DashboardResearchFilters — the DX-life research-page expand-filters dropdown set, baked into
 * the research-dashboard as the FILTERS band (the header row BELOW the topbar).
 *
 * ── HEADER STACK (card BUG-RESEARCH-DASHBOARD-HEADER-STACK-WRONG) ──
 * The search bar was LIFTED UP into the DashboardTopbar (it shares the top row with Align/CSV),
 * so this band is now FILTERS-ONLY: it passes `:show-search="false"` to the shared header and
 * renders just the horizontal-scroll dropdown row. The final clean stack is therefore:
 *   [topbar: title · search · Align · CSV] → [THIS filters/dropdowns row] → [KPI stats] → body.
 * The search wiring still lands on the SAME selection bus (the topbar calls bus.setSearch), so
 * every linked panel re-derives identically — only the search bar's PLACEMENT moved.
 *
 * This is the THIN ADAPTER (profile side): it renders the SHARED, parameterized
 * @map/components/search/SearchFilterHeader.vue and COUPLES it to the dashboard's selection
 * bus + in-memory row store. The header element itself is pure UI (no bus, no fetch, no
 * hardcoding) so the SAME element also drives the people-groups-grid + big-picture; the wiring
 * that makes searching/filtering change the dashboard data + map + table lives HERE.
 *
 * HOW IT COUPLES (brushing-and-linking, zero panel edits):
 *   - search bar  → bus.setSearch(term)   → every panel's local `filtered` honors bus.searchTerm
 *                                            via the shared makeSearchMatcher (table/map/charts/
 *                                            facets/KPIs all re-derive → live-filter).
 *   - a dropdown pick → bus.setFilter(facetKey, LABEL) — the value fed to the bus is the SAME
 *                       string cfg.facets[facetKey].get(row) returns (the label), so filteredRows'
 *                       `accessor(r) === filterSet[k]` matches (byte-match safe, spec §8 intent).
 *   - clear / remove chip → bus.setFilter(facetKey, null).
 *
 * OPTIONS + COUNTS: computed from the injected dashboardData rows through the config's facet
 * accessors, with cross-filtered counts (each axis counted under the OTHER active filters) —
 * the SAME faceted-count model DX-life's UupgsList + the people-groups-grid use, so the
 * dropdown numbers agree with the facet rail.
 *
 * Which axes to show is config-driven: cfg.researchFilters.dropdowns = [facetKey, …]
 * (defaults to the classic DX-life five: region / block / country / people-group / religion,
 * mapped to this dashboard's facet keys). Nothing here is dashboard-specific beyond that map.
 */
import { inject, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { tStatic, formatList } from '@map/i18n/index.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import SearchFilterHeader from '@map/components/search/SearchFilterHeader.vue'
import { getPrayerLevel, LABELS as PRAYER_LABELS } from '@map/colors/prayer-progress.js'
import { useTreeLegendLabels } from '../../composables/useTreeLegendLabels.js'

const { locale } = useI18n()
const bus = inject('selectionBus', null)
const dash = inject('dashboardData', null)
const cfg = inject('dashboardConfig', {})

const rows = computed(() => dash?.rows?.value || [])
const filterSet = bus?.filterSet || {}

// ── ★ THE PRAYER AXIS (card BUILD-ADD-A-PRAYER-FILTER-FIRST-IN-THE-ROW) ──
// Asked: add a new filter called prayer, probably as the first dropdown.
// It was described once as a toggle and once as a dropdown; the card makes the ordering explicit:
// MEASURE THE DATA FIRST, then pick the control — boolean is a toggle, levels are a dropdown.
//
// THE MEASUREMENT, and it did not need inventing: `people_praying` is already a LIVE per-row field
// on the pray-tools source. Three shipping consumers read it — the KPI strip sums it
// (dashboard.config.js `{ kind:'sum', field:'people_praying' }`), the table renders it as the
// "Praying" column (`num(r.people_praying)`), and the detail drawer prints it. So the honest field
// the card asked us to find exists, and no derived boolean had to be manufactured.
//
// It is NOT a boolean: it is a COUNT, and the app already splits that count THREE ways —
// library/colors/prayer-progress.js, the prayer map's colour strategy: none (0/null) / partial
// (0 < n < 144) / full (n >= 144). Three levels => a DROPDOWN, which is also where the requirement
// landed. We reuse getPrayerLevel + its LABELS rather than re-deriving the split here, so the
// filter can never disagree with the colour of the pin it filters to — one threshold, one owner.
//
// ── WHY THIS FACET IS DEFINED HERE AND NOT IN dashboard.config.js ──
// Every other axis lives in the config's `facets` block, and that is where this one belongs long
// term. It is declared in this adapter instead because dashboard.config.js is owned by another
// agent in this session and concurrent edits to it were out of scope for this card. The shape is
// IDENTICAL to a config facet ({ label, get }), and `FACETS` below merges config-first, so moving
// this block into the config later is a cut-and-paste that changes no behaviour and needs no edit
// here: a key present in cfg.facets wins over this local default.
const PRAYER_KEY = 'prayer_level'
const prayerFacet = {
  // MEASURED, because the comment above says this block is a DEFAULT and a reader should not have to
  // work out whether it is live: dashboard.config.js:80 DOES define `prayer_level`, and FACETS spreads
  // cfg.facets last, so this label never renders for the DX-life config — the dropdown shows the
  // config's translated one (الصلاة in ar). It is read only by a config that omits the facet, which
  // is exactly the case that would otherwise render one English word beside six translated ones.
  get label() { return tStatic('dashboard.prayer') || 'Prayer' },
  // Returns the human LABEL, which is what the bus stores and byte-matches — same value-is-label
  // contract every non-People axis follows, so a pick lands a matching filterSet entry with no
  // separate display projection needed.
  get: (r) => {
    const n = r?.people_praying
    const raw = n && typeof n === 'object' ? n.value : n
    // getPrayerLevel reads `peoplePraying` (camel) or `_raw.people_praying`; these rows carry the
    // flat snake field, so hand it the shape it documents rather than hoping the fallback fires.
    return PRAYER_LABELS[getPrayerLevel({ peoplePraying: raw ?? null })]
  },
}

// facet key -> accessor (returns the exact value the bus matches on — a label for most axes,
// a CODE for the People tiers; see optionsFor's note on value-vs-display).
// The local prayer facet is a DEFAULT: cfg.facets wins on a key collision, so promoting it into
// the config later silently takes over.
const FACETS = computed(() => ({ [PRAYER_KEY]: prayerFacet, ...(cfg.facets || {}) }))
const ACC = computed(() => Object.fromEntries(Object.entries(FACETS.value).map(([k, f]) => [k, f.get])))

// Which dropdown axes to render (config-driven; DX-life default five mapped to dashboard facet keys).
// ★ PRAYER IS FORCED FIRST — "it should probably be the first drop down." It is prepended to
// whatever the config lists (and de-duplicated, so promoting it into cfg.researchFilters.dropdowns
// later does not render it twice — it just stops being prepended and keeps its position).
const rf = computed(() => cfg.researchFilters || {})
const dropdownKeys = computed(() => {
  const configured = rf.value.dropdowns || ['wagf_region', 'wagf_block', 'country_code', 'people_group', 'religion']
  return [PRAYER_KEY, ...configured.filter((k) => k !== PRAYER_KEY)]
})
// locale.value is read and passed for the same reason as the search chip below: without it this
// computed never re-runs, and the placeholder stays in the boot language after a switch.
const searchPlaceholder = computed(() => rf.value.searchPlaceholder || tStatic('dashboard.search_placeholder', locale.value) || 'Search people groups, place, language, religion…')

// Apply a filter-set (facetKey -> label) to a row list — reused for cross-filtered counts.
function applyWith(fset, list) {
  const keys = Object.keys(fset)
  if (!keys.length) return list
  return list.filter((r) => keys.every((k) => { const a = ACC.value[k]; return a ? a(r) === fset[k] : true }))
}

// Build one axis's options with cross-filtered counts (this axis counted under the OTHER active
// filters — DX-life updateFilterOptionCounts). option.value is ALWAYS the accessor's output, so
// a pick lands a byte-match-safe value on the bus.
//
// ── VALUE AND DISPLAY ARE SEPARATE (card BUG-PEOPLE-AND-AFFINITY-BLOC-ARE-THE-SAME-AXIS-TWICE) ──
// For most axes the accessor already returns a human label, so value === label as before. The
// People axis (`affinity_bloc`) is the exception: its canonical value is a CODE ('A012'), because
// it is the SAME key the semantic tree filters on — that shared key is what makes a tree click and
// a dropdown pick one selection instead of two rival ones. A code must never be what the user
// READS, so the facet may declare `optionLabel(row)` — a display projection of the SAME row — and
// we key the tally by VALUE while carrying the name alongside. Both projections come off one
// field on one record, so the pair can never drift.
function optionsFor(key) {
  const acc = ACC.value[key]
  if (!acc) return []
  const optLabel = FACETS.value[key]?.optionLabel
  const others = {}
  for (const [k, v] of Object.entries(filterSet)) if (k !== key) others[k] = v
  const subset = applyWith(others, rows.value)
  const counts = new Map()
  for (const r of subset) {
    const value = acc(r)
    if (value == null || value === '') continue
    const prev = counts.get(value)
    if (prev) prev.count += 1
    // Fall back to the value when there is no display projection (or it is empty on this row):
    // an honest code beats a blank menu entry, matching labelFor()'s rule for the chips.
    else counts.set(value, { label: (optLabel && optLabel(r)) || value, count: 1 })
  }
  return Array.from(counts.entries())
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
}

// The `filters` prop the shared header renders (ONE object per dropdown).
const filters = computed(() => dropdownKeys.value.map((key) => ({
  name: key,
  label: FACETS.value[key]?.label || key,
  options: optionsFor(key),
  // ★ A DROPDOWN CANNOT SHOW A MULTI-VALUE SELECTION, SO IT SHOWS NONE (D1).
  // Picking the first of several would put a tick beside one option while the board is narrowed by
  // three — a control stating something false about the state it belongs to, which is worse than a
  // control stating nothing. The CHIP still names every value, so the selection is never invisible:
  // it is simply reported by the surface that can report it honestly.
  value: Array.isArray(filterSet[key]) ? '' : (filterSet[key] || ''),
})))

// Chips derived from the live filterSet. For THIS component's own dropdown axes label === value
// (optionsFor builds options straight off the accessor output), but the filterSet is SHARED — the
// Tree Legend lands People-tier CODE filters (affinity_bloc / cluster / people_group) on the same
// bus, and those chips rendered raw ('Affinity Bloc: A012'). labelFor() resolves them the same way
// the filter chips do. DISPLAY ONLY: `name` is what onRemoveChip acts on and the stored value is
// never rewritten.
// ★ PRAYER IS EXEMPT FROM labelFor. labelFor resolves a CODE to a human name by looking the value
// up in the tree-legend's code tables; the prayer value is ALREADY the human label
// ('Needs Prayer'), so passing it through a code resolver can only fail to find it and fall back —
// at best a no-op, at worst a blank chip. The value-is-label axes need no resolution by definition.
const { labelFor } = useTreeLegendLabels(cfg, inject('dataStore', null), inject('searchSourceId', null))
const activeChips = computed(() => {
  const out = Object.keys(filterSet).map((k) => {
    const v = filterSet[k]
    // An ARRAY is a multi-value filter (D1). labelFor() joins one for display at its single owner,
    // but the prayer arm skips labelFor by the note above, so it has to do its own join — otherwise
    // a two-value pick renders as "A,B" with no spacing. LATENT, not live: nothing in this plugin
    // calls toggleFilterValue, so no caller produces a prayer array today. Closed here because the
    // next caller that does would not think to look in a chip label for the reason.
    // DISJUNCTION, not a plain list: several values of ONE facet are ALTERNATIVES. The bus matches a
    // row if ANY of them matches (useSelectionBus some(), DashboardDataTable includes()), so a
    // comma-joined "Islam, Hinduism" reads as "and" in any language with an explicit connector —
    // stating the opposite of what the filter does.
    const shown = k === PRAYER_KEY ? (Array.isArray(v) ? formatList(v, { type: 'disjunction' }) : v) : labelFor(k, v)
    return { name: k, label: `${FACETS.value[k]?.label || k}: ${shown}` }
  })
  // ★ THE TYPED SEARCH IS A FILTER AND MUST LOOK LIKE ONE: searching "Bhutan" did not show that a
  // country was now selected. MEASURED: typing narrows
  // the scope live via bus.searchTerm (2,107 -> 13) while filterSet stays empty, so the data
  // changed and no control anywhere said why -- invisible state, the same class as the silent
  // grey pane. The conventional faceted-search answer is that free text is its OWN chip beside
  // the facet chips, clearable like any of them. It deliberately does NOT masquerade as a Country
  // selection: the term matches across ALL searchKeys (name, region, language, religion...), so
  // labelling it a country filter would lie whenever it matches something else.
  // (First attempt went into DashboardFilterChips.vue -- a component the topbar dedup pass had
  // already unmounted; THIS band is the documented single source of truth for chips.)
  const term = (bus?.searchTerm?.value || '').trim()
  // ★ THE SEARCH CHIP WAS THE ONE CHIP STILL IN ENGLISH, and the string it needed already existed.
  // dashboard.search_live is in all eleven locales, written for exactly this line — and it has to
  // be, because the punctuation is not assemblable here: fr is "Recherche : {term}" with a narrow
  // space before the colon and zh is "搜索：{term}" with a full-width one. Composing 'Search' + ':'
  // in code would get both wrong even with a translated word. It was simply never wired, so ten
  // locales rendered an English label beside localized facet chips. tStatic takes no params, so
  // {term} is filled here rather than by the catalogue.
  // ★ locale.value is READ so this computed re-runs on a language switch, and PASSED so tStatic reads
  // the catalogue the reader just chose. Without it the chip resolved once and stayed in the boot
  // language beside chips that had moved — a frozen label, which check:frozen-labels now catches.
  // research-dashboard installs i18n (index.js:83), so useI18n resolves here; big-picture does not,
  // which is why its sibling fix pins the locale from hostLang instead.
  if (term) out.push({ name: '__search__', label: (tStatic('dashboard.search_live', locale.value) || 'Search: {term}').replace('{term}', term) })
  return out
})

const searchValue = computed(() => bus?.searchTerm?.value || '')

// ── couplers ──
function onSearch(payload) { bus?.setSearch(payload?.value ?? '') }
function onFilterChange(detail) { bus?.setFilter(detail.name, detail.value) }
function onFilterClear(detail) { bus?.setFilter(detail.name, null) }
function onRemoveFilter(detail) {
  if (detail.name === '__search__') { bus?.setSearch(''); return }
  bus?.setFilter(detail.name, null)
}
function onClearAll() { bus?.clearFilters(); bus?.setSearch('') }

useShadowStyles(`
  /* header-2 host: the research-filters band sits in the dashboard's dedicated 'filters' grid row.
     z-index high so the dropdown menus render ABOVE the stats/map/table below. */
  /* ★ EDGE GUTTER COMES FROM --rd-edge, THE STACK'S ONE SOURCE (card
     BUILD-THE-FOUR-HEADERS-ARE-ONE-CENTRED-STACK). It was a hand-set 14px here and 16px on the
     KPI strip below, so the stack's edges formed a 2px staircase instead of a line — measured,
     not guessed. The horizontal value must never be re-literalised.
     ★ The VERTICAL padding drops 8px -> 5px: it is part of "the white space underneath the
     filters" the spec named (card BUILD-SELECTED-ROW-MUCH-THINNER-AND-CENTRED). The band's own
     padding, the header's inter-row gap and the selections row's height are three different
     owners of what looks like one strip of white space, which is why trimming any one of them
     alone has never been enough. */
  /* ★ 5px -> 3px. The band's own padding is the FOURTH owner of what reads as one
     strip of white space, and the measurement is what made it worth touching: at 1600x900 the
     band read 67px and decomposed exactly — 10px of this padding + 56px of header. Two of those
     ten are the cheapest px in the budget because nothing sits in them. */
  .rd-research-filters{ position:relative; z-index:55; height:100%; box-sizing:border-box;
    padding:3px var(--rd-edge,14px); background:var(--rd-panel,#fff); border-bottom:1px solid var(--rd-line, #d1d4cd);
    overflow:visible; }
`, 'rd-research-filters')
</script>

<template>
  <div class="rd-research-filters" data-region="filters" data-sub="research-filters">
    <SearchFilterHeader
      :search="searchValue"
      :filters="filters"
      :active-chips="activeChips"
      :search-placeholder="searchPlaceholder"
      :show-search="false"
      start-expanded
      @search="onSearch"
      @filter-change="onFilterChange"
      @filter-clear="onFilterClear"
      @remove-filter="onRemoveFilter"
      @clear-all="onClearAll"
    />
  </div>
</template>
