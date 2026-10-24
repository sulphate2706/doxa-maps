/**
 * useLegendData — builds a unified, data-driven legend item tree
 * for ANY legend type from a single declarative config map.
 *
 * Each legend type produces an array of LegendItem:
 *   { key, label, color, count?, population?, filterKey?, children?: LegendItem[] }
 *
 * The composable reads from injected Pinia stores (dataStore, uiStore, mapStore)
 * so it works identically in both Desktop and Mobile legend shells.
 *
 * USAGE:
 *   const { items, columns, title, activeFilter, setFilter, totalCount, totalPopulation,
 *           progress }   // progress: prayer-only payload for <LegendProgressBar>, else null
 *     = useLegendData(props.legendType)
 */

import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { PRAYER_COLORS } from '../../colors/prayer-progress.js'
import { usePrayerStatistics } from '../usePrayerStatistics.js'
import { ENGAGEMENT_COLORS } from '../../colors/engagement.js'
import { ADOPTION_COLORS } from '../../colors/adoption.js'
import { getLanguageFamilyColor } from '../../colors/language-family.js'
import { getColorStrategy, COLOR_MODES } from '../../colors/_registry.js'
import { PALETTE as RELIGION_COLORS, getReligionFamily, religionFamilyLabel } from '../../colors/religion.js'
import { useLanguageFamilyLegendData } from './useLanguageFamilyLegendData.js'

const COLUMNS_SIMPLE = [] // e.g. affinity-blocs — no numeric columns

// ─── Resource palette/names (research-only strategy) ──────────────────────────
// resource is a per-map (research-only) strategy that lives in
// library/colors/resource.js (moved there in C1b) and is resolved via
// the registry (registered by the research bundle's local src/colors glob).
// Read LAZILY (inside the items computed, at call time) so registration has already
// run, and GUARDED on propertyKey — getColorStrategy silently falls back to
// language-family when a mode isn't registered on a bundle, and we must not paint
// the resource legend with the language-family palette.
function resourceStrategy() {
  const strat = getColorStrategy(COLOR_MODES.RESOURCE)
  return (strat && strat.propertyKey === 'resourceType') ? strat : null
}

// ─── Region / Bloc palettes (registry strategies — single source of truth) ───
// doxa-region and affinity-block are PER-MAP (research-only) strategies that
// live in library/colors/ and are discovered by _registry.js for every bundle, not via a
// research bundle's local src/colors glob. Read LAZILY (inside the items
// computed, at call time) so registration has already run, and GUARDED on
// propertyKey — getColorStrategy silently falls back to language-family when a
// mode isn't registered on a bundle, and we must not paint these legends with
// the language-family palette. The STRATEGY palettes win: the palettes
// previously inlined here had drifted from them (they were the bug).
function doxaRegionPalette() {
  const strat = getColorStrategy(COLOR_MODES.DOXA_REGION)
  return (strat && strat.propertyKey === 'doxaRegion') ? (strat.palette || {}) : {}
}

// The affinity-block strategy PALETTE is keyed by ROP1 CODE (A001…) while the
// legend rows are keyed by display NAME ('Arab World'…). The registry hands
// back the strategy's default export, which carries no name-keyed color map —
// so derive one at call time from its code→name (names) + code→color (palette)
// maps.
function affinityBlocColorsByName() {
  const strat = getColorStrategy(COLOR_MODES.AFFINITY_BLOCK)
  if (!strat || strat.propertyKey !== 'affinityBlock') return {}
  const names = strat.names || {}
  const palette = strat.palette || {}
  const byName = {}
  for (const code of Object.keys(names)) byName[names[code]] = palette[code] || '#999'
  return byName
}

// ─── Helper: scan all loaded sources for features matching a predicate ────────
function scanFeatures(dataStore, filterFn) {
  const allSources = Object.values(dataStore.sources || {})
  const features = allSources.flatMap(src => src?.features || [])
  const matched = features.filter(item => filterFn(item.properties || item))
  return {
    count: matched.length,
    population: matched.reduce((sum, item) => {
      const p = item.properties || item
      return sum + (parseInt(p.population || p._raw?.Population || 0) || 0)
    }, 0)
  }
}

// ─── Prayer coverage by the COMMITTED metric (matches the parent site) ────────
// The prayer legend COUNTS come from usePrayerStatistics (/statistics aggregate over
// the full dataset). Population has no per-bucket authoritative value, so it is summed
// from the loaded set using the SAME `people_committed` metric — so a row's count and
// population describe one thing. 100 = the parent's full-coverage threshold
// (FULL_PRAYER_COVERAGE_COUNT in server/api/people-groups/statistics.get.ts).
const FULL_PRAYER_COMMITTED = 100
function committedOf(p) {
  let v = p?.peopleCommitted ?? p?._raw?.people_committed ?? p?.people_committed ?? null
  if (v && typeof v === 'object') v = v.value ?? v.label ?? 0
  return Number(v) || 0
}
function committedLevel(level) {
  return (p) => {
    const c = committedOf(p)
    if (level === 'fullPrayer') return c >= FULL_PRAYER_COMMITTED
    if (level === 'hasPrayer')  return c > 0 && c < FULL_PRAYER_COMMITTED
    return c <= 0   // noPrayer
  }
}

// ─── Engagement / Adoption checkers ───────────────────────────────────────────
function checkHasEngagement(props) {
  const val = props.engagementStatus ?? props._raw?.people_committed
  return val === true || val === 1 || val === '1' || val === 'true'
      || (typeof val === 'number' && val > 0)
      || (typeof val === 'string' && parseInt(val, 10) > 0)
}
function checkHasAdoption(props) {
  const val = props.adoptionStatus ?? props._raw?.adopted_by_churches
  return val === true || val === 1 || val === '1' || val === 'true'
      || (typeof val === 'number' && val > 0)
      || (typeof val === 'string' && parseInt(val, 10) > 0)
}

// ─── Title i18n-key map ───────────────────────────────────────────────────────
// Maps legend type → i18n key under `legend.title.*`.
const TITLE_KEYS = {
  'prayer':            'legend.title.prayer',
  'engagement':        'legend.title.engagement',
  'adoption':          'legend.title.adoption',
  'language-families': 'legend.title.languageFamilies',
  // 'language-family' (singular) is the NEW expand/collapse tree variant —
  // its rows come from useLanguageFamilyLegendData. Title falls back to the
  // plural i18n key so existing translations work.
  'language-family':   'legend.title.languageFamilies',
  'doxa-regions':      'legend.title.doxaRegions',
  // Alias: research-map profile uses 'doxa-region' (singular) for symmetry
  // with 'language-family'. Resolved to the same data path below.
  'doxa-region':       'legend.title.doxaRegions',
  'affinity-blocs':    'legend.title.affinityBlocs',
  // COUNTRIES — the country-posters map's default level. No i18n key yet; the
  // title falls back to the literal "Countries" the same way religion does.
  // Both singular and plural resolve to one canonical key below, matching the
  // doxa-region / language-family precedent.
  'countries':         'legend.title.countries',
  'country':           'legend.title.countries',
  'gospel-resources':  'legend.title.gospelResources',
  // No i18n key for religion in v1 — title falls back to the literal "Religion"
  // via the title computed below. Add `legend.title.religion` translations
  // when localizing the religion tab.
  'religion':          'legend.title.religion'
}

// ─── Legend-type alias normalizer ─────────────────────────────────────────────
// Profiles may use either singular or plural forms; normalize so the items
// computed below can use a single canonical key per type.
function normalizeLegendType(t) {
  if (t === 'doxa-region') return 'doxa-regions'
  if (t === 'country') return 'countries'
  return t
}

// ─── Format helpers ───────────────────────────────────────────────────────────
function fmtPop(pop) {
  if (!pop) return '0'
  if (pop >= 1_000_000) return (pop / 1_000_000).toFixed(1) + 'M'
  if (pop >= 1_000)     return (pop / 1_000).toFixed(1) + 'K'
  return pop.toLocaleString()
}
function fmtCount(n) { return (Number(n) || 0).toLocaleString() }

// ═══════════════════════════════════════════════════════════════════════════════
// Main composable
// ═══════════════════════════════════════════════════════════════════════════════
export function useLegendData(legendTypeRef, opts = {}) {
  const dataStore = inject('dataStore')
  const uiStore   = inject('uiStore')
  const mapStore  = inject('mapStore')
  const { t: $t } = useI18n()

  // Authoritative prayer-coverage counts (single source of truth shared by every
  // profile). Kick off the one /statistics fetch; the `items` computed reads its
  // reactive `loaded` flag, so the legend updates to 601/1505/0 the moment it resolves.
  const prayerStats = usePrayerStatistics()
  prayerStats.load()

  // ── Title ─────────────────────────────────────────────────────────────────
  const title = computed(() => {
    const _t = normalizeLegendType(legendTypeRef.value)
    if (_t === 'religion') return 'Religion'  // literal fallback until i18n added
    const key = TITLE_KEYS[legendTypeRef.value]
    return key ? $t(key) : ''
  })

  // ── Columns ───────────────────────────────────────────────────────────────
  // Column labels translated at read-time so locale switches re-render headers.
  const columns = computed(() => {
    const type = normalizeLegendType(legendTypeRef.value)
    if (type === 'affinity-blocs') return COLUMNS_SIMPLE
    return [
      { key: 'count',      label: $t('legend.columns.upgs'),       width: 48 },
      { key: 'population', label: $t('legend.columns.population'), width: 48 }
    ]
  })

  // ── Active filter key (for highlight ring on selected row) ────────────────
  const activeFilter = computed(() => {
    const t = normalizeLegendType(legendTypeRef.value)
    if (t === 'prayer')     return uiStore.prayerFilter
    if (t === 'engagement') return uiStore.engagementFilter
    if (t === 'adoption')   return uiStore.adoptionFilter
    if (t === 'language-families') return mapStore.selectedFamily
    if (t === 'doxa-regions')     return mapStore.selectedRegion
    if (t === 'gospel-resources') return mapStore.selectedResource
    if (t === 'religion')         return uiStore.religionFilter
    return null
  })

  // ── Set filter (called when a row is clicked) ─────────────────────────────
  function setFilter(filterKey) {
    const t = normalizeLegendType(legendTypeRef.value)
    if (t === 'prayer') {
      uiStore.setPrayerFilter(uiStore.prayerFilter === filterKey ? null : filterKey)
    } else if (t === 'engagement') {
      uiStore.setEngagementFilter(uiStore.engagementFilter === filterKey ? null : filterKey)
    } else if (t === 'adoption') {
      uiStore.setAdoptionFilter(uiStore.adoptionFilter === filterKey ? null : filterKey)
    } else if (t === 'language-families') {
      mapStore.selectFamily(mapStore.selectedFamily === filterKey ? null : filterKey)
    } else if (t === 'doxa-regions') {
      mapStore.selectRegion(mapStore.selectedRegion === filterKey ? null : filterKey)
    } else if (t === 'gospel-resources') {
      mapStore.selectResource(mapStore.selectedResource === filterKey ? null : filterKey)
    } else if (t === 'religion') {
      uiStore.setReligionFilter(uiStore.religionFilter === filterKey ? null : filterKey)
    }
  }

  // ── Items tree ────────────────────────────────────────────────────────────
  const items = computed(() => {
    const t = normalizeLegendType(legendTypeRef.value)

    // ── Prayer (3-tier: parent + 2 children) ────────────────────────────────
    if (t === 'prayer') {
      // COUNT = the authoritative /statistics aggregate (committed metric, full
      // dataset) — the single source of truth the parent site uses, NOT a client
      // scan of loaded pins (which under-counted to 435 vs the parent's 601).
      // Population is summed from the loaded set on the SAME committed metric so
      // each row's count + population agree. Until /statistics resolves, fall back
      // to the committed scan so the legend is never blank.
      const noScan   = scanFeatures(dataStore, committedLevel('noPrayer'))
      const hasScan  = scanFeatures(dataStore, committedLevel('hasPrayer'))
      const fullScan = scanFeatures(dataStore, committedLevel('fullPrayer'))
      const ready = prayerStats.loaded.value
      const noCount   = ready ? prayerStats.noPrayerCount()   : noScan.count
      const hasCount  = ready ? prayerStats.hasPrayerCount()  : hasScan.count
      const fullCount = ready ? prayerStats.fullPrayerCount() : fullScan.count
      return [{
        key: 'noPrayer', label: $t('legend.prayer.needsPrayer'), color: PRAYER_COLORS.noPrayer,
        count: noCount, population: noScan.population, filterKey: 'noPrayer',
        children: [
          { key: 'hasPrayer', label: $t('legend.prayer.hasPrayer'), color: PRAYER_COLORS.hasPrayer,
            count: hasCount, population: hasScan.population, filterKey: 'hasPrayer' },
          { key: 'fullPrayer', label: $t('legend.prayer.fullPrayerCoverage'), color: PRAYER_COLORS.fullPrayer,
            count: fullCount, population: fullScan.population, filterKey: 'fullPrayer' }
        ]
      }]
    }

    // ── Engagement (binary parent/child) ────────────────────────────────────
    if (t === 'engagement') {
      const no  = scanFeatures(dataStore, p => !checkHasEngagement(p))
      const has = scanFeatures(dataStore, p => checkHasEngagement(p))
      return [{
        key: 'notEngaged', label: $t('legend.engagement.needsEngagement'), color: ENGAGEMENT_COLORS.notEngaged,
        count: no.count, population: no.population, filterKey: 'notEngaged',
        children: [
          { key: 'hasEngagement', label: $t('legend.engagement.hasEngagement'), color: ENGAGEMENT_COLORS.hasEngagement,
            count: has.count, population: has.population, filterKey: 'hasEngagement' }
        ]
      }]
    }

    // ── Adoption (binary parent/child) ──────────────────────────────────────
    if (t === 'adoption') {
      const no  = scanFeatures(dataStore, p => !checkHasAdoption(p))
      const has = scanFeatures(dataStore, p => checkHasAdoption(p))
      return [{
        key: 'notAdopted', label: $t('legend.adoption.needsAdoption'), color: ADOPTION_COLORS.notAdopted,
        count: no.count, population: no.population, filterKey: 'notAdopted',
        children: [
          { key: 'hasAdoption', label: $t('legend.adoption.hasAdoption'), color: ADOPTION_COLORS.hasAdoption,
            count: has.count, population: has.population, filterKey: 'hasAdoption' }
        ]
      }]
    }

    // ── Religion (flat list, one row per religion family) ──────────────────
    if (t === 'religion') {
      // Roll up by family letter (first char of religion code: C/M/H/B/E/J/S/N/O/U).
      // Each row gets a count + population summed across all sub-religions in that family.
      const familyAggregates = {}
      const allSources = Object.values(dataStore.sources || {})
      const features = allSources.flatMap(src => src?.features || [])
      for (const item of features) {
        const p = item.properties || item
        const code = p.religion || p._raw?.religion?.value || p._raw?.religion || ''
        const fam = getReligionFamily(code)
        if (!familyAggregates[fam]) familyAggregates[fam] = { count: 0, population: 0 }
        familyAggregates[fam].count += 1
        familyAggregates[fam].population += parseInt(p.population || p._raw?.Population || 0) || 0
      }
      // Christianity always first; rest sorted by population desc.
      // Optional family-letter exclusions (e.g. ['C'] on the unengaged-PG dataset
      // — Christianity-followers aren't unengaged so the row would be misleading).
      // Configured via RESEARCH_LEGEND_OPTIONS.excludeReligionFamilies.
      const exclude = new Set(opts?.excludeReligionFamilies || [])
      for (const fam of exclude) delete familyAggregates[fam]
      const order = Object.keys(familyAggregates).sort((a, b) => {
        if (a === 'C') return -1
        if (b === 'C') return 1
        return (familyAggregates[b].population - familyAggregates[a].population)
      })
      return order.map(fam => ({
        key:        fam,
        // REGREL: the LABEL is localized, the VALUE is not. `key` and `filterKey` below stay the
        // canonical family letter, which is what the filter and the map compare on; only this
        // display string follows the reader's language. RELIGION_FAMILIES is no longer imported here:
        // religionFamilyLabel() reads it internally, so this file's only use of it was this label.
        label:      religionFamilyLabel(fam) || 'Unknown',
        color:      RELIGION_COLORS[fam] || '#94a3b8',
        count:      familyAggregates[fam].count,
        population: familyAggregates[fam].population,
        filterKey:  fam,
        children:   []
      }))
    }

    // ── Language Families (flat list, each is a "parent" with no children) ───
    if (t === 'language-families') {
      return (dataStore.languageFamiliesData || []).map(f => ({
        key: f.name, label: f.name, color: getLanguageFamilyColor(f.name),
        count: f.count, population: f.population, filterKey: f.name,
        children: []
      }))
    }

    // ── Language Family TREE (singular) — delegate row construction to the
    // dedicated composable. The returned shape is the LegendRow shape from
    // useLanguageFamilyLegendData ({ peopleGroupCount, ..., kind, pinIds }).
    // LegendDesktop / LegendMobile branch on `legendType === 'language-family'`
    // BEFORE consuming items, so this is a fallback for any caller that still
    // reads `items` directly (e.g. a custom host).
    if (t === 'language-family') {
      const features = Object.values(dataStore.sources || {})
        .flatMap(src => src?.features || [])
      const featuresRef = { value: features }
      const { rows: famRows } = useLanguageFamilyLegendData(featuresRef)
      return famRows.value.map(r => ({
        key: r.key, label: r.label, color: r.color,
        count: r.peopleGroupCount, population: r.population,
        filterKey: r.key, children: []
      }))
    }

    // ── Doxa Regions (flat) ─────────────────────────────────────────────────
    if (t === 'doxa-regions') {
      const REGION_COLORS = doxaRegionPalette() // lazy+guarded registry read
      return (dataStore.doxaRegionsData || []).map(r => ({
        key: r.name, label: r.name, color: REGION_COLORS[r.name] || '#999',
        count: r.count, population: r.population, filterKey: r.name,
        children: []
      }))
    }

    // ── Gospel Resources (parent/child tree) ────────────────────────────────
    if (t === 'gospel-resources') {
      // Lazy + guarded: research-only strategy, present only on bundles that
      // register it locally. Empty legend (not wrong colors) when absent.
      const strat = resourceStrategy()
      const RESOURCE_COLORS = strat?.palette ?? {}
      const RESOURCE_NAMES  = strat?.names ?? {}
      const resources = dataStore.resourcesData || []
      return Object.keys(RESOURCE_COLORS).map(rKey => {
        const data = resources.find(r => r.key === rKey)
        return {
          key: rKey, label: RESOURCE_NAMES[rKey] || rKey, color: RESOURCE_COLORS[rKey],
          count: data?.count || 0, population: data?.population || 0, filterKey: rKey,
          children: (data?.children || []).map(c => ({
            key: c.key, label: c.name || c.key, color: c.color || RESOURCE_COLORS[rKey],
            count: c.count || 0, population: c.population || 0, filterKey: c.key
          }))
        }
      })
    }

    // ── Affinity Blocks (flat, no counts) ────────────────────────────────────
    if (t === 'affinity-blocs') {
      // lazy+guarded registry read; sorted to keep the alphabetical row order
      // the old inlined (name-keyed) palette produced.
      const BLOC_COLORS = affinityBlocColorsByName()
      return Object.keys(BLOC_COLORS).sort().map(b => ({
        key: b, label: b, color: BLOC_COLORS[b], filterKey: b, children: []
      }))
    }

    return []
  })

  // ── Totals ────────────────────────────────────────────────────────────────
  function sumTree(arr, field) {
    return arr.reduce((s, item) => {
      let v = item[field] || 0
      if (item.children?.length) v += sumTree(item.children, field)
      return s + v
    }, 0)
  }
  const totalCount      = computed(() => sumTree(items.value, 'count'))
  const totalPopulation = computed(() => sumTree(items.value, 'population'))

  // ── Prayer progress (header bar payload) ──────────────────────────────────
  // Payload for <LegendProgressBar> (library/components/legends/LegendProgressBar.vue)
  // — PRAYER ONLY, null for every other legend type (the consumers render nothing
  // on null). Hosts pass it as the `progress` prop of SemanticTreeLegend / LegendRows
  // AND provide('legendProgress', progress) so the mobile sheet's embedded legend
  // (LegendMobile → SemanticTreeLegend) picks it up via inject.
  // The three prayer row counts above are mutually EXCLUSIVE (usePrayerStatistics:
  // partial excludes full; committedLevel: has = 0 < committed < 100), so the bar's
  // has-prayer SPAN = has + full and full FILLS that span from the left (full ⊂ has).
  //   covered  = has + full                      (the span; drives "covered/total · %")
  //   total    = totalCount                      (no + has + full = /statistics `total`
  //              once loaded — every people group in the data source; the loaded-pin
  //              count until then)
  //   segments = [full, has, no] LEFT→RIGHT, exclusive counts, prayer-strategy colours
  const progress = computed(() => {
    if (normalizeLegendType(legendTypeRef.value) !== 'prayer') return null
    const row = items.value[0]
    if (!row) return null
    const has  = (row.children || []).find(c => c.key === 'hasPrayer')
    const full = (row.children || []).find(c => c.key === 'fullPrayer')
    const noCount = Number(row.count) || 0
    const hasCount = Number(has?.count) || 0
    const fullCount = Number(full?.count) || 0
    // Population of the covered span, so the progress row can fill the Population column
    // with the same number the Has Prayer + Full Prayer rows add up to.
    const coveredPopulation = (Number(has?.population) || 0) + (Number(full?.population) || 0)
    return {
      covered: hasCount + fullCount,
      total: totalCount.value,
      coveredPopulation,
      totalPopulation: totalPopulation.value,
      segments: [
        { key: 'fullPrayer', label: full?.label ?? $t('legend.prayer.fullPrayerCoverage'), count: fullCount, color: PRAYER_COLORS.fullPrayer },
        { key: 'hasPrayer',  label: has?.label  ?? $t('legend.prayer.hasPrayer'),          count: hasCount,  color: PRAYER_COLORS.hasPrayer },
        { key: 'noPrayer',   label: row.label,                                              count: noCount,   color: PRAYER_COLORS.noPrayer }
      ]
    }
  })

  return {
    items, columns, title, activeFilter, setFilter,
    totalCount, totalPopulation,
    progress,
    fmtPop, fmtCount
  }
}
