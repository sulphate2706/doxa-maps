/**
 * useSearch.js — Local geocoder search composable
 *
 * Supplements the Mapbox Geocoder (which only knows cities/countries)
 * with results from the local people-groups dataset. Returns matches
 * grouped by four categories: people groups, country groupings,
 * languages, and religions.
 *
 * Usage:
 *   const { search } = useEntitySearch({ dataStore, dataSourceId })
 *   // Pass `search` as `localGeocoder` option to MapboxGeocoder:
 *   new MapboxGeocoder({ accessToken, localGeocoder: search })
 *
 * Ranking (higher = better):
 *   - name-match     score 100  (people group name)
 *   - country-match  score 50
 *   - religion-match score 25
 *   - language-match score 10
 *
 * Tokenization: the query is whitespace-split and ALL tokens must appear
 * in a record's haystack. "India Muslim" matches records whose combined
 * (name+country+language+religion) text contains both tokens.
 *
 * Feature shape returned follows the Carmen-GeoJSON format expected by
 * mapbox-gl-geocoder:
 *   https://github.com/mapbox/carmen/blob/master/carmen-geojson.md
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import langFamilyByLanguage from '../data/langFamilyByLanguage.json'
// Religion search must group by FAMILY (same 10 families the Religion legend shows),
// not by raw sub-type names — otherwise search surfaces 'Animism'/'Romanism' rows
// the legend can't select. Reuse the legend's exact family logic.
// RELIGION_FAMILIES is no longer imported: its only use here was the label that now goes through
// religionFamilyLabel(), which reads the canonical map internally. The KEY still comes from
// getReligionFamily, so nothing that is compared or sent changed.
import { getReligionFamily, religionFamilyLabel } from '../colors/religion.js'

// ── Result category ordering by active-tab context (Round 16) ────────────────
// The search bar is unified — every category is always searched — but the
// category that matches the active legend tab is surfaced FIRST so results feel
// context-aware without being cluttered. People-groups are included in EVERY
// context (coder spec: "All tabs: can still search people groups").
const ALL_GROUPS = ['blocs', 'clusters', 'peopleGroups', 'families', 'languages', 'dialects', 'people', 'places', 'regions', 'wagfBlocks', 'religions']
const ORDER_BY_CONTEXT = {
  // People Groups tab → affinity bloc, cluster, people group, people group+country
  'people-groups': ['blocs', 'clusters', 'peopleGroups', 'people', 'places', 'families', 'languages', 'dialects', 'regions', 'religions'],
  // Language tab → language family, language, dialect
  'language':      ['families', 'languages', 'dialects', 'people', 'blocs', 'clusters', 'peopleGroups', 'places', 'regions', 'religions'],
  // Regions tab → region, block, country
  'regions':       ['regions', 'wagfBlocks', 'places', 'blocs', 'clusters', 'peopleGroups', 'people', 'families', 'languages', 'dialects', 'religions'],
  // Religion tab → religion
  'religion':      ['religions', 'people', 'blocs', 'clusters', 'peopleGroups', 'places', 'families', 'languages', 'dialects', 'regions'],
}
function groupOrder(context) {
  return ORDER_BY_CONTEXT[context] || ALL_GROUPS
}
// Per-category cap for the "All DOXA Data" section so one prolific category
// (usually people-groups) can't bury the rest.
const ALLDATA_CAPS = {
  blocs: 3, clusters: 3, peopleGroups: 3, families: 3, languages: 3,
  dialects: 3, people: 5, places: 2, regions: 3, wagfBlocks: 3, religions: 2,
}

// Parameterized search per tab (coder R42). The key is the geocoder context
// string (TAB_SEARCH_CONTEXT in the profile .vue: 'regions'|'people-groups'|
// 'language'|'religion'); the value is the subset of grouped-result keys to keep.
// A context absent here (or '') = all categories (no regression).
//
// UNIVERSAL (every tab): People Group (peopleGroups+people), Country (places),
// Default Language (languages), Religion (religions). Each tab then ADDS its own
// domain categories:
//   Regions tab       + WAGF Region/Block (regions)        — and NO blocs/clusters/families/dialects
//   People Groups tab + Affinity Block (blocs) + Cluster (clusters)
//   Languages tab     + Dialect (dialects) + Language Family (families)
//   Religion tab      + (nothing beyond universal)
// "ONLY the Regions tab shows Regions/Blocks; showing affinity blocks or people
// clusters on the Regions tab is the reported bug." WAGF blocks (e.g. "South
// Asia") fold into the `regions` aggregate (doxaRegion||wagfRegion).
const UNIVERSAL_SEARCH = ['peopleGroups', 'people', 'places', 'languages', 'religions']
const ALLOWED_BY_CONTEXT = {
  'regions':       [...UNIVERSAL_SEARCH, 'regions', 'wagfBlocks'],
  'people-groups': [...UNIVERSAL_SEARCH, 'blocs', 'clusters'],
  'language':      [...UNIVERSAL_SEARCH, 'dialects', 'families'],
  'religion':      [...UNIVERSAL_SEARCH],
}

// ── Score weights ────────────────────────────────────────────────────────────
const SCORE_NAME     = 100
const SCORE_COUNTRY  = 50
const SCORE_RELIGION = 25
const SCORE_LANGUAGE = 10

// ── Caps ─────────────────────────────────────────────────────────────────────
const MAX_PER_CATEGORY = 5
const MAX_TOTAL        = 20

// ── Base-language + dialect parsing (mirrors useLanguageFamilyLegendData rules)
// Per QA building-round-1 R2 A1: each individual sign language is its own
// language; "Pakistan Sign Language" stays whole as the base. The suffix
// regex is reserved for FAMILY resolution only (see resolveFamily below).
// "Arabic, Shihhi" → base "Arabic", dialect "Shihhi"
// "Pakistan Sign Language" → base "Pakistan Sign Language", dialect null
// "Bengali" → base "Bengali", dialect null
const FAMILY_SUFFIXES = [
  [/ sign language$/i, 'Sign Language'],
]
function readBaseLanguage(label) {
  if (!label || typeof label !== 'string') return ''
  const comma = label.indexOf(',')
  if (comma > 0) return label.slice(0, comma).trim()
  return label.trim()
}
function readDialectLabel(label) {
  if (!label || typeof label !== 'string') return null
  const comma = label.indexOf(',')
  if (comma >= 0) return label.slice(comma + 1).trim() || null
  return null
}

// ── Family lookup (same comma-inversion logic as useLanguageFamilyLegendData) ─
function resolveFamily(label) {
  if (!label || typeof label !== 'string') return null
  const parts = label.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const fullReversed = [...parts].reverse().join(' ')
    if (langFamilyByLanguage[fullReversed]) return langFamilyByLanguage[fullReversed]
    if (parts.length >= 3) {
      const twoReversed = [parts[1], parts[0]].join(' ')
      if (langFamilyByLanguage[twoReversed]) return langFamilyByLanguage[twoReversed]
    }
  }
  if (langFamilyByLanguage[label]) return langFamilyByLanguage[label]
  const stripped = label.replace(/\s*\(.*?\)\s*$/, '').trim()
  if (stripped !== label && langFamilyByLanguage[stripped]) return langFamilyByLanguage[stripped]
  // FAMILY_SUFFIXES fallback so sign-language pins agree with the legend's
  // family bucketing (e.g. "Pakistan Sign Language" → "Sign Language" family).
  for (const [re, base] of FAMILY_SUFFIXES) {
    if (re.test(label)) return base
  }
  return null
}

// ── Section-header feature (non-clickable visual divider in suggestions) ──────
function makeSectionHeader(label, isAllData) {
  return {
    id: `doxa-section-header-${slugify(label)}`,
    place_name: label,
    text: label,
    center: [0, 0],
    place_type: ['doxa-section-header'],
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { headerLabel: label, isHeader: true, isAllDataSection: !!isAllData },
    feature: null
  }
}

/**
 * Slugify any text for use in a feature id ('doxa-pg-<slug>').
 */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Normalize a string for case-insensitive matching.
 */
function norm(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.toLowerCase()
  if (typeof v === 'object' && 'label' in v) return String(v.label || '').toLowerCase()
  if (typeof v === 'object' && 'value' in v) return String(v.value || '').toLowerCase()
  return String(v).toLowerCase()
}

/**
 * Human-readable label — pulls .label / .value from {value,label} objects.
 */
function strLabel(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return v.label || v.value || ''
  return String(v)
}

/**
 * Build a precomputed search index for the people-groups dataset.
 */
function buildIndex(features) {
  if (!Array.isArray(features)) return []
  const index = []
  for (const pg of features) {
    if (!pg) continue
    const lat = Number(pg.latitude)
    const lng = Number(pg.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const nameHay     = norm(pg.name) + ' ' + norm(pg.displayName) + ' ' + norm(pg.alternateName)
    const countryHay  = norm(pg.countryName) + ' ' + norm(pg.country) + ' ' + norm(pg.countryIso) + ' ' + norm(pg.countryIsoLabel)
    const religionHay = norm(pg.religionName) + ' ' + norm(pg.religion) + ' ' + norm(pg.religionLabel) + ' ' + norm(pg.religionCode)
    const languageHay = norm(pg.language) + ' ' + norm(pg.languageFamily) + ' ' + norm(pg.languageCode)
    const regionHay   = norm(pg.doxaRegion) + ' ' + norm(pg.wagfRegion) + ' ' + norm(pg.wagfBlock)
    const blocHay     = norm(pg.affinityBlock) + ' ' + norm(pg.affinityBlockLabel) + ' ' + norm(pg._raw?.rop1)
    const clusterHay  = norm(pg.cluster) + ' ' + norm(pg.clusterLabel) + ' ' + norm(pg._raw?.imb_reg_of_people_2)
    const pgHay       = norm(pg.peopleGroup) + ' ' + norm(pg.peopleGroupLabel) + ' ' + norm(pg._raw?.imb_reg_of_people_25)

    // Pull the comma-inverted label from _raw first (the original API form,
    // e.g. "Arabic, Sudanese") — pg.language can be overwritten by useMapData.
    const rawLang = pg._raw?.primary_language ?? pg._raw?.PrimaryLanguage
    const langLabel = (rawLang && (typeof rawLang === 'object' ? (rawLang.label || rawLang.value) : rawLang))
      || strLabel(pg.language) || strLabel(pg.primaryLanguage) || ''
    const baseLang     = readBaseLanguage(langLabel)
    const dialectLabel = readDialectLabel(langLabel)
    index.push({
      feature: pg,
      nameHay,
      countryHay,
      religionHay,
      languageHay,
      regionHay,
      haystack: nameHay + ' ' + countryHay + ' ' + religionHay + ' ' + languageHay + ' ' + regionHay + ' ' + blocHay + ' ' + clusterHay + ' ' + pgHay,
      blocHay,
      clusterHay,
      pgHay,
      lat,
      lng,
      familyDerived: resolveFamily(langLabel) || null,
      languageLabel: langLabel,
      baseLang,
      dialectLabel,
    })
  }
  return index
}

/**
 * Build aggregate lookup tables for the "places / languages / religions"
 * categories.
 */
function buildAggregates(entries) {
  // extraFn(bucket, entry, isNew) lets a caller stash extra per-bucket data
  // (e.g. originalLabels for dialect aggregates).
  const aggregate = (keyFn, labelFn, extraFn) => {
    const map = new Map()
    for (const e of entries) {
      const key = keyFn(e)
      if (!key) continue
      const existing = map.get(key)
      if (existing) {
        existing.count += 1
        existing.lngSum += e.lng
        existing.latSum += e.lat
        existing.memberIds.push(String(e.feature.uniqueId ?? e.feature.id ?? e.feature.slug ?? ''))
        existing.minLng = Math.min(existing.minLng, e.lng)
        existing.maxLng = Math.max(existing.maxLng, e.lng)
        existing.minLat = Math.min(existing.minLat, e.lat)
        existing.maxLat = Math.max(existing.maxLat, e.lat)
        if (extraFn) extraFn(existing, e, false)
      } else {
        const v = {
          key,
          label: strLabel(labelFn(e)) || key,
          count: 1,
          lngSum: e.lng,
          latSum: e.lat,
          minLng: e.lng, maxLng: e.lng,
          minLat: e.lat, maxLat: e.lat,
          memberIds: [String(e.feature.uniqueId ?? e.feature.id ?? e.feature.slug ?? '')],
        }
        if (extraFn) extraFn(v, e, true)
        map.set(key, v)
      }
    }
    // finalize centroids
    for (const v of map.values()) {
      v.lng = v.lngSum / v.count
      v.lat = v.latSum / v.count
    }
    return Array.from(map.values())
  }

  return {
    countries: aggregate(
      (e) => norm(e.feature.countryName) || norm(e.feature.country) || norm(e.feature.countryIso),
      (e) => e.feature.countryName || e.feature.country || e.feature.countryIso || ''
    ),
    // Language families — derived from primary_language via langFamilyByLanguage lookup
    families: aggregate(
      (e) => norm(e.familyDerived),
      (e) => e.familyDerived || ''
    ),
    // Languages — keyed by BASE language (e.g. "Arabic" not "Arabic, Sudanese")
    // so a search for "Arabic" matches one row covering all Arabic dialects.
    languages: aggregate(
      (e) => norm(e.baseLang),
      (e) => e.baseLang || ''
    ),
    // Dialects — only entries that have a dialectLabel; keyed by base+dialect
    // so "Arabic, Sudanese" and "Sign Language, Pakistan" each get their own row.
    // originalLabels accumulates the raw API labels needed to filter pins exactly.
    dialects: aggregate(
      (e) => e.dialectLabel ? `${norm(e.baseLang)}__${norm(e.dialectLabel)}` : '',
      (e) => `${e.baseLang}, ${e.dialectLabel}`,
      (bucket, e, isNew) => {
        if (isNew) {
          bucket.originalLabels = new Set([e.languageLabel])
          bucket.familyDerived  = e.familyDerived || ''
          bucket.baseLang       = e.baseLang || ''
          bucket.dialectLabel   = e.dialectLabel || ''
        } else {
          bucket.originalLabels.add(e.languageLabel)
          // Keep the first non-empty family in case some pins lack the lookup.
          if (!bucket.familyDerived && e.familyDerived) bucket.familyDerived = e.familyDerived
        }
      }
    ),
    // Key + label by FAMILY (Christianity, Islam, Ethnoreligion, …) using the
    // SAME extraction the legend uses (getReligionFamily on the religion code),
    // so every search result corresponds to a selectable Religion-legend row.
    // The raw sub-type names ('Animism') still MATCH via religionHay, but collapse
    // into their family row.
    // ✗ THIS COMMENT USED TO SAY: "label = family name so selection can resolve the family letter back
    // (see research-map onGeocoderAggregateResult religion branch)". It was WRONG, and wrong in the
    // direction that forbids the fix below: it presented an English label as a REQUIREMENT of
    // selection. Measured 2026-09-27 — onGeocoderAggregateResult does not exist anywhere in this repo
    // (three comments name it, nothing defines it), and selection resolves by VALUE: aggregate() emits
    // `key` and `label` as SEPARATE fields (:262-263) with key from getReligionFamily, and the consumer
    // reads detail.expectedValue, never the label (country-posters/countries-map.vue:1611). So the label
    // is display-only and safe to localize. A stale comment that argues against a correct change is
    // worse than no comment: the next reader either reverts it or refuses the next one like it.
    religions: aggregate(
      (e) => getReligionFamily(e.feature.religion || e.feature._raw?.religion?.value || e.feature._raw?.religion || ''),
      (e) => religionFamilyLabel(getReligionFamily(e.feature.religion || e.feature._raw?.religion?.value || e.feature._raw?.religion || '')) || 'Unknown'
    ),
    // WAGF / DOXA regions (doxaRegion) — keyed by the region value so a search
    // for "Asia" collapses every pin in that region into one row. The click
    // handler (onGeocoderAggregateResult) already maps kind 'region' →
    // doxaRegion and dims pins to that region; the bbox auto-fits the camera.
    regions: aggregate(
      (e) => norm(e.feature.doxaRegion) || norm(e.feature.wagfRegion),
      // DISPLAY label = the API's human/translated label (e.g. "North Asia"), NOT the
      // raw slug ("north_asia"). Mirrors the legend's readRegionLabel so search rows and
      // legend rows read identically. The underscore slug is only the last-ditch fallback.
      // (coder 2026-06-25: underscores leaked because this labelled on the slug.)
      (e) => e.feature.wagfRegionLabel || e.feature.doxaRegionLabel
           || e.feature._raw?.wagf_region?.label || e.feature.doxaRegion || e.feature.wagfRegion || ''
    ),
    // WAGF Blocks must be their OWN aggregate, not folded into `regions` via `||` —
    // a block pin (e.g. "South Asia") also has a doxaRegion, so `doxaRegion||…||wagfBlock`
    // short-circuits to the region and the block never surfaces. Keyed separately so
    // "South Asia" appears as its own search row. Mapped to kind 'region' downstream
    // so it routes through the same region geocoder branch (which matches block: nodes).
    wagfBlocks: aggregate(
      (e) => norm(e.feature.wagfBlock),
      // DISPLAY label = the API's human/translated label (e.g. "South East Asia"), NOT
      // the raw slug ("south_east_asia"). Mirrors the legend's readBlockLabel.
      (e) => e.feature.wagfBlockLabel || e.feature._raw?.wagf_block?.label || e.feature.wagfBlock || ''
    ),
    // Affinity blocs (rop1) — keyed by bloc label so a search for "Malay" matches "Malay Peoples"
    blocs: aggregate(
      (e) => norm(e.feature.affinityBlockLabel) || norm(e.feature.affinityBlock),
      (e) => e.feature.affinityBlockLabel || e.feature.affinityBlock || '',
      (bucket, e, isNew) => {
        if (isNew) bucket.blocCode = e.feature.affinityBlock || ''
      }
    ),
    // Clusters (imb_reg_of_people_2) — composite key (bloc + cluster) so two blocs with same cluster name don't collide
    clusters: aggregate(
      (e) => {
        const blocCode = e.feature.affinityBlock || ''
        const clCode   = e.feature.cluster || ''
        return clCode ? `${blocCode}__${clCode}` : ''
      },
      (e) => e.feature.clusterLabel || e.feature.cluster || '',
      (bucket, e, isNew) => {
        if (isNew) {
          bucket.blocCode    = e.feature.affinityBlock || ''
          bucket.blocLabel   = e.feature.affinityBlockLabel || ''
          bucket.clusterCode = e.feature.cluster || ''
        }
      }
    ),
    // People groups (imb_reg_of_people_25 / ROP 2.5) — keyed by pg code so multi-country
    // pg's collapse into one row (e.g. "Deaf" with 123 country instances → 1 result).
    peopleGroups: aggregate(
      (e) => norm(e.feature.peopleGroup) || norm(e.feature.peopleGroupLabel),
      (e) => e.feature.peopleGroupLabel || e.feature.peopleGroup || e.feature.name || '',
      (bucket, e, isNew) => {
        if (isNew) {
          bucket.blocCode        = e.feature.affinityBlock || ''
          bucket.blocLabel       = e.feature.affinityBlockLabel || ''
          bucket.clusterCode     = e.feature.cluster || ''
          bucket.clusterLabel    = e.feature.clusterLabel || ''
          bucket.peopleGroupCode = e.feature.peopleGroup || ''
        }
      }
    ),
  }
}

/**
 * Build a Carmen-GeoJSON feature for a single people group.
 */
function makePeopleFeature(entry) {
  const pg = entry.feature
  const name = pg.name || pg.displayName || pg.slug || 'Unknown'
  const country = pg.countryName || pg.country || pg.countryIso || ''
  const religion = pg.religionName || pg.religion || ''
  const slug = pg.slug || pg.uniqueId || slugify(name + '-' + country)
  const center = [entry.lng, entry.lat]

  const tail = [country, religion].filter(Boolean).join(' — ')
  const label = tail ? `${name}, ${tail}` : name

  return {
    id: `doxa-pg-${slug}`,
    // No emoji — the renderer (GeocoderComponent.renderSuggestion) prepends a
    // labeled category tag. A clean place_name also keeps the selected-result
    // text in the input box free of emoji (Round 16).
    place_name: label,
    text: name,
    center,
    place_type: ['people-group'],
    geometry: { type: 'Point', coordinates: center },
    properties: {
      slug,
      ...pg,
    },
    feature: pg,
  }
}

/**
 * Build a Carmen-GeoJSON feature for a country / language / religion aggregate.
 */
function makeAggregateFeature(kind, agg) {
  // No emoji — GeocoderComponent.renderSuggestion draws a labeled category tag
  // from place_type (Round 16: "emojis replaced with clear labels or icons").
  let placeType, idPrefix
  switch (kind) {
    case 'country':         placeType = 'doxa-country';         idPrefix = 'doxa-country-';         break
    case 'region':          placeType = 'doxa-region';          idPrefix = 'doxa-region-';          break
    case 'language-family': placeType = 'doxa-language-family'; idPrefix = 'doxa-language-family-'; break
    case 'language':        placeType = 'doxa-language';        idPrefix = 'doxa-language-';        break
    case 'dialect':         placeType = 'doxa-dialect';         idPrefix = 'doxa-dialect-';         break
    case 'religion':        placeType = 'doxa-religion';        idPrefix = 'doxa-religion-';        break
    case 'affinity-bloc':   placeType = 'doxa-affinity-bloc';   idPrefix = 'doxa-affinity-bloc-';   break
    case 'cluster':         placeType = 'doxa-cluster';         idPrefix = 'doxa-cluster-';         break
    case 'people-group':    placeType = 'doxa-people-group';    idPrefix = 'doxa-people-group-';    break
    default:                placeType = 'doxa';                 idPrefix = 'doxa-'
  }
  const label = strLabel(agg.label) || agg.key
  const slug = slugify(agg.key)
  const center = [agg.lng, agg.lat]
  // Tier suffix in the search-bar result label, mirroring the legend's
  // (Cluster) / (PG) / (PGIC) convention so the tier is unambiguous when the
  // same name appears at multiple levels (e.g. "Deaf" at bloc & cluster & PG,
  // "Arab, Yemeni" at cluster & PG). Non-affinity kinds keep their plain form.
  const TIER_SUFFIX = {
    'affinity-bloc': 'Affinity Block',
    'cluster':       'Cluster',
    'people-group':  'PG',
    // pgic isn't surfaced as a separate aggregate in v1, but reserved here for parity:
    'pg-in-country': 'PGIC',
  }
  const tier = TIER_SUFFIX[kind]
  const display = tier
    ? `${label} (${tier}) · ${agg.count}`
    : `${label} (${agg.count})`

  // Dialect features carry originalLabels + familyDerived so the geocoder
  // result handler in research-map.vue can build a legend-matching dialect key
  // and filter pins on the exact API language string.
  const originalLabels = agg.originalLabels ? Array.from(agg.originalLabels) : undefined
  const dialectExtra = (kind === 'dialect') ? {
    familyDerived: agg.familyDerived || '',
    baseLang:      agg.baseLang || '',
    dialectLabel:  agg.dialectLabel || '',
  } : null

  return {
    id: `${idPrefix}${slug}`,
    place_name: display,
    text: label,
    center,
    bbox: [agg.minLng, agg.minLat, agg.maxLng, agg.maxLat],
    place_type: [placeType],
    geometry: { type: 'Point', coordinates: center },
    properties: {
      slug,
      doxaAggregate: kind,
      count: agg.count,
      label,
      memberIds: agg.memberIds,
      bounds: [agg.minLng, agg.minLat, agg.maxLng, agg.maxLat],
      ...(originalLabels ? { originalLabels } : {}),
      ...(dialectExtra || {}),
      ...(kind === 'affinity-bloc' ? { blocCode: agg.blocCode || '' } : {}),
      ...(kind === 'cluster'       ? { blocCode: agg.blocCode || '', blocLabel: agg.blocLabel || '', clusterCode: agg.clusterCode || '' } : {}),
      ...(kind === 'people-group'  ? { blocCode: agg.blocCode || '', blocLabel: agg.blocLabel || '', clusterCode: agg.clusterCode || '', clusterLabel: agg.clusterLabel || '', peopleGroupCode: agg.peopleGroupCode || '' } : {}),
    },
    feature: null,
  }
}

/**
 * Main composable.
 *
 * @param {object} opts
 * @param {object} opts.dataStore  Pinia data store (useDataStore())
 * @param {string} [opts.dataSourceId]  Source id to read features from.
 * @returns {{ search: (query:string)=>Array, searchGrouped: (query:string)=>object }}
 */
export function useEntitySearch(opts = {}) {
  const { dataStore, dataSourceId, getActiveFilter, getActiveContext } = opts

  // Called during GeocoderComponent setup → useI18n() resolves the per-map
  // i18n instance; the captured `t` localizes the dropdown's section headers
  // ("Within …" / "All DOXA Data") per the active locale (loc-004).
  const { t } = useI18n()

  // ── Select the active source's features reactively ─────────────────────────
  const features = computed(() => {
    if (!dataStore || !dataStore.sources) return []
    if (dataSourceId && dataStore.sources[dataSourceId]?.features) {
      return dataStore.sources[dataSourceId].features
    }
    // Fallback: first source that has features
    for (const id of Object.keys(dataStore.sources)) {
      const src = dataStore.sources[id]
      if (src?.features?.length) return src.features
    }
    return []
  })

  // ── Precomputed index + aggregates — rebuild when features change ──────────
  const index = computed(() => buildIndex(features.value))
  const aggregates = computed(() => buildAggregates(index.value))

  /**
   * Returns results grouped by category.
   */
  function searchGrouped(query) {
    const q = String(query || '').trim().toLowerCase()
    const empty = { people: [], places: [], regions: [], wagfBlocks: [], families: [], languages: [], dialects: [], religions: [], blocs: [], clusters: [], peopleGroups: [] }
    if (q.length < 2) return empty

    const tokens = q.split(/[\s,;]+/).filter(Boolean)
    if (!tokens.length) return empty

    const idx = index.value
    if (!idx.length) return empty
    const aggs = aggregates.value

    // ── People group matches ────────────────────────────────────────────────
    const peopleMatches = []
    for (const entry of idx) {
      let allMatch = true
      for (const tok of tokens) {
        if (!entry.haystack.includes(tok)) { allMatch = false; break }
      }
      if (!allMatch) continue

      let score = 0
      if (tokens.some(t => entry.nameHay.includes(t)))     score += SCORE_NAME
      if (tokens.some(t => entry.countryHay.includes(t)))  score += SCORE_COUNTRY
      if (tokens.some(t => entry.religionHay.includes(t))) score += SCORE_RELIGION
      if (tokens.some(t => entry.languageHay.includes(t))) score += SCORE_LANGUAGE

      peopleMatches.push({ entry, score })
    }
    peopleMatches.sort((a, b) => b.score - a.score)
    const peopleFeatures = peopleMatches
      .slice(0, MAX_PER_CATEGORY)
      .map(m => makePeopleFeature(m.entry))

    // ── Aggregate matches (country / language / religion) ───────────────────
    const matchAgg = (bucket) =>
      bucket
        .filter(a => tokens.every(t => a.key.includes(t) || norm(a.label).includes(t)))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_PER_CATEGORY)

    const places    = matchAgg(aggs.countries).map(a => makeAggregateFeature('country',         a))
    const regions   = matchAgg(aggs.regions  ).map(a => makeAggregateFeature('region',          a))
    // WAGF blocks ride the SAME 'region' kind so the geocoder region branch handles
    // them (it matches both region: and block: legend nodes). Keeps 'South Asia' a
    // first-class, selectable search row.
    const wagfBlocks = matchAgg(aggs.wagfBlocks).map(a => makeAggregateFeature('region',         a))
    const families  = matchAgg(aggs.families ).map(a => makeAggregateFeature('language-family', a))
    const languages = matchAgg(aggs.languages).map(a => makeAggregateFeature('language',        a))
    const dialects  = matchAgg(aggs.dialects ).map(a => makeAggregateFeature('dialect',         a))
    const religions = matchAgg(aggs.religions).map(a => makeAggregateFeature('religion',        a))
    const blocs        = matchAgg(aggs.blocs       ).map(a => makeAggregateFeature('affinity-bloc',   a))
    let   clusters     = matchAgg(aggs.clusters    ).map(a => makeAggregateFeature('cluster',         a))
    let   peopleGroups = matchAgg(aggs.peopleGroups).map(a => makeAggregateFeature('people-group',    a))

    // Dedupe across tiers when the LABEL matches a higher-tier entity AND it's
    // under the same bloc — e.g. "Deaf" exists at bloc/cluster/PG levels but
    // refers to the same entity, so only keep the bloc result. Same for "Arab,
    // Yemeni" if it appears as both cluster and PG within the Arab bloc.
    const blocLabels = new Set(blocs.map(b => norm(b.text)))
    clusters = clusters.filter(c => !blocLabels.has(norm(c.text)))
    const clusterLabels = new Set(clusters.map(c => norm(c.text)))
    peopleGroups = peopleGroups.filter(p => !blocLabels.has(norm(p.text)) && !clusterLabels.has(norm(p.text)))

    return { people: peopleFeatures, places, regions, wagfBlocks, families, languages, dialects, religions, blocs, clusters, peopleGroups }
  }

  /**
   * Flat array form — what MapboxGeocoder's `localGeocoder` option expects.
   * When getActiveFilter is provided and returns a live selection, results are
   * split into two labelled sections: "Within [selection]" and "All DOXA Data".
   * Section header features (place_type: doxa-section-header) are injected as
   * visual dividers; clicking them is suppressed in GeocoderComponent.vue.
   * "All DOXA Data" results carry properties._allDataSection = true so the
   * geocoder handler knows to deselect the legend when they are clicked.
   */
  function search(query) {
    const activeFilter  = typeof getActiveFilter  === 'function' ? getActiveFilter()  : null
    const activeContext = typeof getActiveContext === 'function' ? getActiveContext() : null
    const g = searchGrouped(query)
    // Context-aware ordering (Round 16): the active legend tab decides which
    // category surfaces FIRST, while people-groups stay reachable from every
    // tab. groupOrder() returns the category sequence for the active context
    // (or the default order when no context is set). This replaces the fixed
    // semantic-tree-first order; the same context drives the "All DOXA Data"
    // section below so both halves of the dropdown agree.
    const order   = groupOrder(activeContext)
    // Context-aware FILTERING (not just ordering): each tab's search should only
    // surface result types relevant to that tab's legend domain — e.g. the
    // Regions tab must NOT show affinity blocks / clusters / people groups, only
    // countries + WAGF regions. groupOrder() already ranks; this restricts the
    // category SET. Unknown/empty context → all categories (no regression).
    const allowed = ALLOWED_BY_CONTEXT[activeContext]
    const gFiltered = allowed
      ? Object.fromEntries(allowed.filter(k => g[k]).map(k => [k, g[k]]))
      : g
    const allFlat = order.flatMap(k => gFiltered[k] || [])

    if (!activeFilter?.key || !allFlat.length) {
      return allFlat.slice(0, MAX_TOTAL)
    }

    // Split people-group results into "within selection" and "outside"
    const withinPeople = []
    const outsidePeople = []
    for (const feat of g.people) {
      const entry = index.value.find(e => e.feature === feat.feature)
      let matches = false
      if (entry) {
        if (activeFilter.kind === 'family') {
          matches = (entry.familyDerived || '').toLowerCase() === activeFilter.key.toLowerCase()
        } else if (activeFilter.kind === 'language') {
          matches = entry.languageLabel.toLowerCase() === activeFilter.key.toLowerCase()
        }
      }
      if (matches) withinPeople.push(feat)
      else outsidePeople.push(feat)
    }

    // Build sectioned output
    const result = []
    const selectionLabel = activeFilter.key
    if (withinPeople.length) {
      result.push(makeSectionHeader(t('search.sections.within', { selection: selectionLabel }), false))
      result.push(...withinPeople.slice(0, MAX_PER_CATEGORY))
    }
    // "All DOXA Data" section: take a capped sampling from EACH kind so one
    // prolific category (usually people-groups) can't bury the rest, walked in
    // the SAME context order as the flat list so the context-relevant category
    // leads here too (Round 16). Per-kind caps live in ALLDATA_CAPS.
    const allTagged = order
      .flatMap(k => (gFiltered[k] || []).slice(0, ALLDATA_CAPS[k] ?? 3))
      .map(f => ({ ...f, properties: { ...f.properties, _allDataSection: true } }))
    result.push(makeSectionHeader(t('search.sections.allData'), true))
    result.push(...allTagged)

    return result.slice(0, MAX_TOTAL + 8) // extra room for 2 headers + extra all-data items
  }

  return { search, searchGrouped, index, aggregates }
}

export default useEntitySearch
