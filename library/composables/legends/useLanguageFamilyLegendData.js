/**
 * useLanguageFamilyLegendData — language-family legend rows with
 * carat/expand semantics ported from the OLD doxa-map-app-widget legend
 * onto the NEW LegendRows CSS-table chrome.
 *
 * RESPONSIBILITIES
 *   - Aggregate the normalized people-groups feature collection by language
 *     family, then by language within each family.
 *   - Sort families AND languages-within-a-family by:
 *       1) people-group count DESC
 *       2) population DESC
 *   - Track per-family expand/collapse state (default: ALL collapsed).
 *   - Emit a `legend:highlight` window event when a row is clicked, carrying
 *     `{ kind: 'family' | 'language' | 'cluster', familyKey?, languageKey?,
 *        clusterId?, pinIds }`. The map listener (research-map.vue) is OUT
 *     OF SCOPE here — this composable only EMITS, never dims.
 *
 * CLUSTER-READY
 *   - The `LegendRow` shape carries an optional `clusterId` field. If a row
 *     surfaces a `clusterId`, it is treated as a cluster row: kind === 'cluster'
 *     in the highlight event, and downstream LegendFamilyTree paints a small
 *     cluster icon next to the count. The composable itself never invents a
 *     clusterId — that's the upstream aggregator's job. We just don't paint
 *     into a corner.
 *
 * USAGE
 *   const {
 *     rows, toggle, isExpanded, childRowsFor, highlight
 *   } = useLanguageFamilyLegendData(peopleGroupsRef, { aggregator })
 *
 *   - `peopleGroupsRef`: a `Ref<Array<NormalizedPeopleGroup>>` — typically
 *     `dataStore.sources[activeId].features` mapped through the framework's
 *     normalization. Each member must expose at least:
 *         { id, properties: { primary_language, language_family, population } }
 *     Falls back to `_raw.LanguageFamily` / `_raw.PrimaryLanguage` /
 *     `_raw.Population` when the normalized fields are absent.
 *   - `aggregator` (optional): the name of the active language-family
 *     aggregation method. Reserved for future use ("derive from primary
 *     language" vs "use API-provided family field" vs "cluster-aware"). The
 *     default is 'auto', which uses `language_family` if present and
 *     otherwise treats every distinct language as its own family.
 */

import { computed, reactive } from 'vue'
import { getLanguageFamilyColor, LANGUAGE_FAMILY_COLORS, canonicalFamilyName } from '../../colors/language-family.js'
import langFamilyByLanguage from '../../data/langFamilyByLanguage.json'
import { splitLanguageLabelParts } from '../../utils/languageLabel.js'

// ─────────────────────────────────────────────────────────────────────────────
// Field readers — defensive against the four shapes we currently see in the
// wild: GeoJSON.features[i].properties, plain rows, and DOXA `_raw`.
// FRICTION: the API may not group by family natively — we derive it here.
// ─────────────────────────────────────────────────────────────────────────────
function readProps(item) {
  return item?.properties || item || {}
}
// pray-tools API returns {value,label} objects for many fields. Unwrap to label
// when present, fall through to whatever string is there otherwise.
function unwrap(v) {
  if (v && typeof v === 'object' && 'label' in v) return v.label || v.value || ''
  return v
}

// The pray-tools API returns primary_language.label in comma-inverted format:
// "Arabic, Shihhi" instead of the lookup key "Shihhi Arabic".
// Strategy: reverse all comma-separated parts, join with space, then look up.
// For parenthetical names like "Ainu (China)", also try stripping the parenthetical.
//
// The split is shared with the packet's describeGroup, which needs the same un-inversion for PRINTED
// prose: see library/utils/languageLabel.js for why a top-level-only split is the correct one. The
// candidates below are unchanged -- a parenthesis-internal comma used to yield an unbalanced candidate
// that could never match a key, and now yields no candidate at all, which is the same miss.
function lookupFamilyFromLanguageLabel(label) {
  if (!label || typeof label !== 'string') return null
  const parts = splitLanguageLabelParts(label)
  if (parts.length >= 2) {
    // Try full reversal: "Arabic, Shihhi" → "Shihhi Arabic"
    const fullReversed = [...parts].reverse().join(' ')
    if (langFamilyByLanguage[fullReversed]) return langFamilyByLanguage[fullReversed]
    // For 3+ parts, try reversing only the first two: "Arabic, Levantine, North" → "Levantine Arabic"
    if (parts.length >= 3) {
      const twoReversed = [parts[1], parts[0]].join(' ')
      if (langFamilyByLanguage[twoReversed]) return langFamilyByLanguage[twoReversed]
    }
  }
  // Try exact match (single-part label like "Arabic")
  if (langFamilyByLanguage[label]) return langFamilyByLanguage[label]
  // Strip parenthetical suffix for edge cases like "Ainu (China)"
  const stripped = label.replace(/\s*\(.*?\)\s*$/, '').trim()
  if (stripped !== label && langFamilyByLanguage[stripped]) return langFamilyByLanguage[stripped]
  return null
}

// Suffix patterns used ONLY to derive the language FAMILY for entries whose
// API `imb_language_family` is null and aren't in `langFamilyByLanguage.json`.
// Per QA building-round-1 R2 A1: each individual sign language ("Pakistan
// Sign Language", "American Sign Language") is a legitimate language under
// the "Sign Language" family — they must NOT be collapsed into one base
// "Sign Language" language row. So this regex doesn't touch baseLang/dialect.
const FAMILY_SUFFIXES = [
  [/ sign language$/i, 'Sign Language'],
]

// "Arabic, Shihhi" → "Arabic"  /  "Pakistan Sign Language" → "Pakistan Sign Language"  /  "Bengali" → "Bengali"
function readBaseLanguage(label) {
  if (!label || typeof label !== 'string') return '— Unknown —'
  const comma = label.indexOf(',')
  if (comma > 0) return label.slice(0, comma).trim()
  return label.trim()
}
// "Arabic, Shihhi" → "Shihhi"  /  "Pakistan Sign Language" → null  /  "Bengali" → null
function readDialectLabel(label) {
  if (!label || typeof label !== 'string') return null
  const comma = label.indexOf(',')
  if (comma >= 0) return label.slice(comma + 1).trim() || null
  return null
}

function readFamily(p) {
  const v = p.language_family ?? p.languageFamily ?? p._raw?.LanguageFamily ?? p._raw?.language_family
  const s = unwrap(v)
  const canonical = canonicalFamilyName(s)
  if (canonical && canonical !== 'Unknown') return canonical
  // imb_language_family is null for all API records — derive client-side from
  // primary_language using comma-inversion normalization + lookup (QA Round 3 A2).
  const langV = p.primary_language ?? p.primaryLanguage ?? p._raw?.PrimaryLanguage ?? p._raw?.primary_language
  const langLabel = unwrap(langV)
  if (langLabel) {
    const lbl = String(langLabel).trim()
    const derived = lookupFamilyFromLanguageLabel(lbl)
    if (derived) return derived
    // FAMILY_SUFFIXES: e.g. "Pakistan Sign Language" not in lookup, but the
    // suffix puts it in the "Sign Language" family. baseLang stays as the
    // full string ("Pakistan Sign Language") so each variant is its own row.
    for (const [re, base] of FAMILY_SUFFIXES) {
      if (re.test(lbl)) return base
    }
  }
  return 'Unknown'
}
function readLanguage(p) {
  // Read from _raw first (returns original API comma-inverted label like "Arabic, Sudanese").
  // p.language may have been overwritten to the unwrapped value form by useMapData.
  const raw = p._raw?.primary_language ?? p._raw?.PrimaryLanguage
  if (raw) {
    const rs = unwrap(raw)
    if (rs) return String(rs).trim()
  }
  const v = p.primary_language ?? p.primaryLanguage ?? p.language
  const s = unwrap(v)
  return (s && String(s).trim()) || '— Unknown —'
}
function readPopulation(p) {
  const v = p.population ?? p._raw?.Population ?? p._raw?.population ?? 0
  return parseInt(v, 10) || 0
}
function readPinId(item, p) {
  return item?.id ?? p.id ?? p.peopleGroupId ?? p._raw?.PeopleID3 ?? p._raw?.PeopleID ?? null
}
function readClusterId(item, p) {
  // Reserved hook — the aggregator (cluster engine) sets this when it ships.
  return item?.clusterId ?? p.clusterId ?? null
}
// Pull lat/lng from any of the shapes data passes through.
function readCoord(item, p) {
  const lat = parseFloat(p.latitude ?? p.lat ?? p._raw?.Latitude ?? p._raw?.latitude)
  const lng = parseFloat(p.longitude ?? p.lng ?? p._raw?.Longitude ?? p._raw?.longitude)
  if (!isFinite(lat) || !isFinite(lng)) return null
  return [lng, lat] // GeoJSON / Mapbox order: [lng, lat]
}

// Sort comparator: people-group count DESC, then population DESC.
// FRICTION: tiebreaker behavior when both count and population match is
// implementation-defined here (stable insertion order — relies on V8/JS
// engine stability).
function byCountThenPop(a, b) {
  if (b.peopleGroupCount !== a.peopleGroupCount) return b.peopleGroupCount - a.peopleGroupCount
  return (b.population || 0) - (a.population || 0)
}
// Languages within a family sort by population DESC (per UX request).
function byPopulation(a, b) {
  if ((b.population || 0) !== (a.population || 0)) return (b.population || 0) - (a.population || 0)
  return b.peopleGroupCount - a.peopleGroupCount
}

/**
 * @typedef {Object} LegendRow
 * @property {string} key                     stable row key (familyKey, languageKey, or clusterId)
 * @property {string} label                   displayed name
 * @property {string} color                   pill background color
 * @property {number} peopleGroupCount        number of people groups under this row
 * @property {number} population              summed population
 * @property {'family'|'language'|'cluster'} kind
 * @property {string} [familyKey]             for kind: 'language' rows, the parent family
 * @property {string} [clusterId]             when set, render the cluster icon and emit kind: 'cluster'
 * @property {string[]} pinIds                pin IDs the map should highlight when this row is clicked
 */

export function useLanguageFamilyLegendData(peopleGroupsRef, options = {}) {
  // Reserved for future cluster-aware / API-native family aggregation.
  // eslint-disable-next-line no-unused-vars
  const aggregator = options.aggregator ?? 'auto'

  // ── Expanded family state — default: ALL COLLAPSED (per requirements §2) ──
  // reactive plain object keyed by familyKey → boolean.
  const expanded = reactive({})

  function isExpanded(familyKey) {
    return !!expanded[familyKey]
  }
  function toggle(familyKey) {
    expanded[familyKey] = !expanded[familyKey]
  }
  /**
   * Reset the expansion map so ONLY the given keys are expanded. Used by the
   * geocoder→legend reveal flow: when a search result selects a row, collapse
   * every other family/language and expand just the ancestor chain leading to
   * the new selection (per qa-buildinng-round-1 R3 A5 / Bug 10).
   */
  function setExpansionToOnly(keys) {
    const set = new Set(Array.isArray(keys) ? keys : [])
    for (const k of Object.keys(expanded)) {
      if (!set.has(k)) expanded[k] = false
    }
    for (const k of set) expanded[k] = true
  }

  // ── Aggregation: feature[] → Map<familyKey, { language → bucket }> ────────
  // Outer key: family. Inner key: BASE language (first part before comma).
  // Each language bucket has a nested dialects Map keyed by dialect label.
  const aggregated = computed(() => {
    const features = peopleGroupsRef?.value || []
    const families = new Map()

    for (const item of features) {
      const p = readProps(item)
      const familyKey = readFamily(p)
      const langLabel = readLanguage(p)   // e.g. "Arabic, Shihhi"
      const baseLang  = readBaseLanguage(langLabel)   // e.g. "Arabic"
      const dialectLabel = readDialectLabel(langLabel) // e.g. "Shihhi" | null
      const pop = readPopulation(p)
      const pinId = readPinId(item, p)
      const clusterId = readClusterId(item, p)
      const c = readCoord(item, p)

      let fam = families.get(familyKey)
      if (!fam) {
        fam = {
          key: familyKey,
          peopleGroupCount: 0,
          population: 0,
          pinIds: [],
          coords: [],
          clusterId: null,
          languages: new Map()
        }
        families.set(familyKey, fam)
      }
      fam.peopleGroupCount += 1
      fam.population += pop
      if (pinId != null) fam.pinIds.push(pinId)
      if (c) fam.coords.push(c)
      if (clusterId && !fam.clusterId) fam.clusterId = clusterId

      let lang = fam.languages.get(baseLang)
      if (!lang) {
        lang = {
          key: baseLang,
          peopleGroupCount: 0,
          population: 0,
          pinIds: [],
          coords: [],
          clusterId: null,
          dialects: new Map()
        }
        fam.languages.set(baseLang, lang)
      }
      lang.peopleGroupCount += 1
      lang.population += pop
      if (pinId != null) lang.pinIds.push(pinId)
      if (c) lang.coords.push(c)
      if (clusterId && !lang.clusterId) lang.clusterId = clusterId

      if (dialectLabel) {
        let dialect = lang.dialects.get(dialectLabel)
        if (!dialect) {
          dialect = { key: dialectLabel, peopleGroupCount: 0, population: 0, pinIds: [], coords: [], originalLabels: new Set([langLabel]) }
          lang.dialects.set(dialectLabel, dialect)
        } else {
          dialect.originalLabels.add(langLabel)
        }
        dialect.peopleGroupCount += 1
        dialect.population += pop
        if (pinId != null) dialect.pinIds.push(pinId)
        if (c) dialect.coords.push(c)
      }
    }

    return families
  })

  // ── Top-level family rows, sorted by (count DESC, population DESC) ────────
  // When `showAllKnown` is true (default), every family in LANGUAGE_FAMILY_COLORS
  // appears in the legend even if zero people-groups currently match — the
  // expand-caret then opens to an empty list rather than the family being
  // missing entirely. Useful for global comparison views.
  const showAllKnown = options.showAllKnown !== false
  const rows = computed(() => {
    const families = aggregated.value
    const list = []
    const seen = new Set()
    for (const fam of families.values()) {
      list.push({
        key: fam.key,
        label: fam.key,
        color: getLanguageFamilyColor(fam.key),
        peopleGroupCount: fam.peopleGroupCount,
        population: fam.population,
        kind: fam.clusterId ? 'cluster' : 'family',
        clusterId: fam.clusterId || undefined,
        pinIds: fam.pinIds,
        coords: fam.coords
      })
      seen.add(fam.key)
    }
    if (showAllKnown) {
      for (const familyName of Object.keys(LANGUAGE_FAMILY_COLORS)) {
        if (seen.has(familyName)) continue
        list.push({
          key: familyName,
          label: familyName,
          color: getLanguageFamilyColor(familyName),
          peopleGroupCount: 0,
          population: 0,
          kind: 'family',
          pinIds: [],
          coords: []
        })
      }
    }
    list.sort(byCountThenPop)
    return list
  })

  // ── Language rows for a given family — Tab 1 child rows ──────────────────
  function childRowsFor(familyKey) {
    const fam = aggregated.value.get(familyKey)
    if (!fam) return []
    const out = []
    for (const lang of fam.languages.values()) {
      out.push({
        key: `${familyKey}__${lang.key}`,
        label: lang.key,
        color: getLanguageFamilyColor(familyKey),
        peopleGroupCount: lang.peopleGroupCount,
        population: lang.population,
        kind: lang.clusterId ? 'cluster' : 'language',
        familyKey,
        clusterId: lang.clusterId || undefined,
        pinIds: lang.pinIds,
        coords: lang.coords,
        hasDialects: lang.dialects.size > 0
      })
    }
    out.sort(byPopulation)
    return out
  }

  // ── Dialect rows for a given language row — key is "familyKey__baseLang" ──
  // label is "Language, Dialect" (e.g. "Arabic, Sudanese") for context.
  function dialectRowsFor(langRowKey) {
    const sep = langRowKey.indexOf('__')
    if (sep < 0) return []
    const familyKey = langRowKey.slice(0, sep)
    const baseLang  = langRowKey.slice(sep + 2)
    const fam = aggregated.value.get(familyKey)
    if (!fam) return []
    const lang = fam.languages.get(baseLang)
    if (!lang) return []
    const out = []
    for (const dialect of lang.dialects.values()) {
      out.push({
        key: `${langRowKey}__${dialect.key}`,
        label: `${baseLang}, ${dialect.key}`,
        dialectOnly: dialect.key,
        color: getLanguageFamilyColor(familyKey),
        peopleGroupCount: dialect.peopleGroupCount,
        population: dialect.population,
        kind: 'dialect',
        languageKey: baseLang,
        familyKey,
        pinIds: dialect.pinIds,
        coords: dialect.coords,
        originalLabels: Array.from(dialect.originalLabels)
      })
    }
    out.sort(byPopulation)
    return out
  }

  // ── Flat language rows across ALL families — Tab 2 ────────────────────────
  // One row per base language (e.g. "Arabic", not "Arabic, Shihhi").
  const languageRows = computed(() => {
    const families = aggregated.value
    const out = []
    for (const fam of families.values()) {
      for (const lang of fam.languages.values()) {
        out.push({
          key: `${fam.key}__${lang.key}`,
          label: lang.key,
          color: getLanguageFamilyColor(fam.key),
          peopleGroupCount: lang.peopleGroupCount,
          population: lang.population,
          kind: lang.clusterId ? 'cluster' : 'language',
          familyKey: fam.key,
          clusterId: lang.clusterId || undefined,
          pinIds: lang.pinIds,
          coords: lang.coords,
          hasDialects: lang.dialects.size > 0
        })
      }
    }
    out.sort(byPopulation)
    return out
  })

  // ── Flat dialect rows across ALL languages — Tab 3 ────────────────────────
  // label is "Language, Dialect" (e.g. "Arabic, Sudanese") for context.
  const dialectRows = computed(() => {
    const families = aggregated.value
    const out = []
    for (const fam of families.values()) {
      for (const lang of fam.languages.values()) {
        for (const dialect of lang.dialects.values()) {
          out.push({
            key: `${fam.key}__${lang.key}__${dialect.key}`,
            label: `${lang.key}, ${dialect.key}`,
            dialectOnly: dialect.key,
            color: getLanguageFamilyColor(fam.key),
            peopleGroupCount: dialect.peopleGroupCount,
            population: dialect.population,
            kind: 'dialect',
            languageKey: lang.key,
            familyKey: fam.key,
            pinIds: dialect.pinIds,
            coords: dialect.coords,
            originalLabels: Array.from(dialect.originalLabels)
          })
        }
      }
    }
    out.sort(byPopulation)
    return out
  })

  // ── highlight — fires the legend:highlight window event ───────────────────
  // The map listener (research-map.vue) is responsible for dimming non-matching
  // pins. This composable's contract is only to emit the event.
  function highlight(rowOrKey) {
    let row = rowOrKey
    if (typeof rowOrKey === 'string') {
      // Allow callers to pass a familyKey directly (top-level row shortcut)
      row = rows.value.find(r => r.key === rowOrKey)
      if (!row) return
    }
    const detail = {
      kind: row.kind,
      pinIds: row.pinIds || [],
      coords: row.coords || []
    }
    if (row.kind === 'family')   detail.familyKey   = row.label
    if (row.kind === 'language') {
      detail.languageKey = row.label
      detail.familyKey   = row.familyKey
    }
    if (row.kind === 'dialect') {
      detail.dialectKey     = row.key  // full unique key "family__lang__dialect" for toggle detection
      detail.dialectOnly    = row.dialectOnly || row.label
      detail.languageKey    = row.languageKey
      detail.familyKey      = row.familyKey
      detail.originalLabels = row.originalLabels || []
    }
    if (row.kind === 'cluster')  detail.clusterId   = row.clusterId

    if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('legend:highlight', { detail }))
    }
  }

  // ── langTree — generic semantic-tree shape for SemanticTreeLegend ─────────
  // Per QA building-round-1 R4 decision: ported PPLR's SemanticTreeLegend takes
  // a generic tree of nodes ({ id, label, color, count, pop, filter, children }).
  // This computed converts our family/language/dialect aggregation into that
  // shape with pre-built Mapbox filter expressions, so a single @select event
  // from the legend can drive the pin-layer filter directly (no kind-specific
  // dispatch logic needed downstream).
  const langTree = computed(() => {
    const families = aggregated.value
    const out = []
    for (const fam of families.values()) {
      const familyColor = getLanguageFamilyColor(fam.key)
      // Collect EVERY language string under this family — base lang + every
      // dialect's originalLabels. The pin layer's `languageFamily` property is
      // mostly 'Unknown' (API field is null for all 2,069 records); the legend
      // family bucket is itself a client-side derivation. So filter against
      // `language` (which IS populated reliably) using the full enumerated
      // set, instead of the unreliable `languageFamily` property.
      const allFamilyLangs = []
      for (const lang of fam.languages.values()) {
        if (lang.key && lang.key !== '— Unknown —') allFamilyLangs.push(lang.key)
        for (const dialect of lang.dialects.values()) {
          for (const orig of dialect.originalLabels) {
            if (orig) allFamilyLangs.push(orig)
          }
        }
      }
      const familyNode = {
        id:    `fam:${fam.key}`,
        label: fam.key,
        color: familyColor,
        count: fam.peopleGroupCount,
        pop:   fam.population,
        // Belt-and-suspenders: match pins by derived languageFamily property OR
        // by any enumerated language string under this family. The property
        // path catches pins where useMapLayers' deriveFamilyFromLanguage hit
        // (most pins, after the iter-2 fix); the language-list path catches
        // any pin whose `language` value matches a label the legend bucketed
        // here even if the property derivation missed (e.g. format variance).
        filter: allFamilyLangs.length > 0
          ? ['any',
              ['==', ['get', 'languageFamily'], fam.key],
              ['in', ['get', 'language'], ['literal', Array.from(new Set(allFamilyLangs))]]
            ]
          : ['==', ['get', 'languageFamily'], fam.key],
        children: [],
      }
      for (const lang of fam.languages.values()) {
        const langKey = lang.key
        const langNode = {
          id:    `lang:${fam.key}__${langKey}`,
          label: langKey,
          color: familyColor,
          count: lang.peopleGroupCount,
          pop:   lang.population,
          // Match base + comma-prefix + suffix-contains so "Arabic" catches
          // "Arabic, Sudanese" and "Sign Language" catches "Pakistan Sign Language".
          filter: ['any',
            ['==', ['get', 'language'], langKey],
            ['==', ['slice', ['get', 'language'], 0, langKey.length + 1], langKey + ','],
            ['in', ' ' + langKey, ['get', 'language']]
          ],
          children: [],
        }
        for (const dialect of lang.dialects.values()) {
          const labels = Array.from(dialect.originalLabels)
          langNode.children.push({
            id:    `dial:${fam.key}__${langKey}__${dialect.key}`,
            label: `${langKey}, ${dialect.key}`,
            color: familyColor,
            count: dialect.peopleGroupCount,
            pop:   dialect.population,
            // Exact match against the original API label(s) — handles both
            // comma-inverted ("Arabic, Sudanese") and suffix-grouped
            // ("Pakistan Sign Language") cases.
            filter: labels.length === 1
              ? ['==', ['get', 'language'], labels[0]]
              : ['in', ['get', 'language'], ['literal', labels]],
            originalLabels: labels,
            children: [],
          })
        }
        familyNode.children.push(langNode)
      }
      out.push(familyNode)
    }
    out.sort((a, b) => (b.pop - a.pop) || (b.count - a.count))
    return out
  })

  return { rows, languageRows, dialectRows, langTree, toggle, isExpanded, setExpansionToOnly, childRowsFor, dialectRowsFor, highlight }
}
