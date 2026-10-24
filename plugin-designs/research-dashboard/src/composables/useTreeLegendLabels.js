/**
 * useTreeLegendLabels.js — the People axis's CODE → HUMAN NAME resolver
 * (card BUG-FILTER-CHIP-SHOWS-RAW-CODE-NOT-HUMAN-NAME).
 *
 * The People facets (affinity_bloc / cluster / people_group) key by CODE on purpose — see
 * dashboard.config.js:54-57 — so the rail can cross-reference the research map's semantic tree.
 * The price of that choice is that EVERY user-facing surface has to project the code back to a
 * name, and "codes must never reach a user-facing menu". The facet rail did that projection
 * inline, so it was correct there and nowhere else: the filter chip bar rendered the raw code
 * ('Affinity Bloc:A012' instead of 'South Asian Peoples'), live-verified 2026-09-20.
 *
 * This module is that projection, extracted ONCE, exactly as useTreeLegendColors is the colour
 * projection extracted once. Both surfaces now read the same maps, built by running the SAME
 * useAffinityBlockLegendData the research map's semantic tree uses over the shell's normalized
 * features — so a bloc/cluster/PG name can never drift between the map, the rail and the chips.
 *
 * ── LABEL IS DISPLAY-ONLY ────────────────────────────────────────────────────────────────────
 * Nothing here touches a filter VALUE. The selection bus matches a stored filter against the
 * facet accessor's exact output byte-for-byte, so rewriting the value would leave the chip
 * looking right while the table silently stopped responding. `labelFor` is a pure read: it takes
 * a value and returns a string to PRINT, and falls back to the value itself when unresolvable
 * (an honest code beats a blank chip).
 *
 * ── WHICH KEYS ARE PEOPLE KEYS IS DECLARED, NOT HARD-CODED ──────────────────────────────────
 * The set is derived from config.facetRail's `tree:'affinity'` section and its `drill` list — the
 * same declaration the rail already switches on. Adding a 4th People tier to that drill therefore
 * fixes the chips too, with no second list to keep in sync.
 */

import { computed } from 'vue'
import { useAffinityBlockLegendData } from '@map/composables/legends/useAffinityBlockLegendData.js'
import { formatList } from '@map/i18n/index.js'

/**
 * @param {object} cfg           the injected dashboardConfig (read for facetRail)
 * @param {object} dataStore     the injected DataSourceManager store
 * @param {string} searchSourceId the injected active source id
 */
export function useTreeLegendLabels(cfg, dataStore, searchSourceId) {
  // DataSourceManager-normalized features — the shape useAffinityBlockLegendData resolves labels
  // from (affinityBlockLabel / clusterLabel / peopleGroupLabel).
  const normalizedFeatures = computed(() => {
    const src = dataStore && searchSourceId && dataStore.sources && dataStore.sources[searchSourceId]
    return (src && src.features) || []
  })

  const { aggregated: affinityAgg } = useAffinityBlockLegendData(normalizedFeatures)

  // The People facet keys, in tier order, read off the declarative rail config.
  const treeFacetKeys = computed(() => {
    const section = (cfg && cfg.facetRail || []).find((s) => s.tree === 'affinity')
    return (section && section.drill) || []
  })

  // code → label lookups keyed to the People facet keys, walked from the composable's aggregate
  // tree. Tier order follows treeFacetKeys, so the maps line up with the config's drill.
  const affinityLabelMaps = computed(() => {
    const [blocKey, clusterKey, pgKey] = treeFacetKeys.value
    const bloc = new Map(), cluster = new Map(), pg = new Map()
    for (const b of affinityAgg.value.values()) {
      if (b.code) bloc.set(b.code, b.label)
      for (const c of b.clusters.values()) {
        if (c.code) cluster.set(c.code, c.label)
        for (const g of c.peopleGroups.values()) { if (g.code) pg.set(g.code, g.label) }
      }
    }
    const out = {}
    if (blocKey) out[blocKey] = bloc
    if (clusterKey) out[clusterKey] = cluster
    if (pgKey) out[pgKey] = pg
    return out
  })

  /**
   * Resolve a facet value to what a human should READ. Non-People facets already carry labels
   * (their accessors run lbl()), so they pass straight through untouched.
   * @returns {string} the human name, or the original value when it cannot be resolved.
   */
  function labelFor(facetKey, value) {
    const map = affinityLabelMaps.value[facetKey]
    // ★ ARRAY-AWARE AT THE ONE OWNER (SPEC-DASHBOARD-KIT D1). Every surface that turns a filter
    // into words goes through here — the chip bar, the research-filter chips and the CSV
    // provenance comment — so resolving the list once is what keeps the three saying the same
    // thing. Without it an array fell through to its default toString and a chip read
    // "Religion: Islam,Hinduism": the codes joined by a bare comma, with no spacing and no code
    // resolved to its human name.
    // DISJUNCTION: a multi-value filter holds ALTERNATIVES, and the bus matches a row if ANY of them
    // matches. Every surface that turns a filter into words comes through here, so the connector is
    // resolved once and the chip bar, the research-filter chips and the CSV provenance line all say
    // the same thing in the reader's language.
    if (Array.isArray(value)) return formatList(value.map((v) => (map && map.get(v)) || v), { type: 'disjunction' })
    if (!map) return value
    return map.get(value) || value
  }

  return { normalizedFeatures, affinityAgg, affinityLabelMaps, treeFacetKeys, labelFor }
}

export default useTreeLegendLabels
