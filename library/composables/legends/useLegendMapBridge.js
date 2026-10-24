/**
 * useLegendMapBridge — the wiring between a semantic-tree legend and the map beside it.
 *
 * ★ WHY THIS EXISTS. country-posters/countries-map.vue and doxa-research-map/research-map.vue share
 * 1,756 lines across 60 contiguous blocks, and 78% of that is one concern: the legend↔map bridge.
 * The two files already import the same 41 library modules and the same five legend-data
 * composables, so the DATA layer was never the duplication — the GLUE was. Glue is exactly where a
 * fix lands in one copy and not the other, and three defects did precisely that before this existed:
 * the legend's packet kind-split, the poster attribution reading, and the packet page-1 map hand-off.
 * Each was fixed in one twin, and nothing reported that the other still had it.
 *
 * ⚠ ONLY THE FUNCTIONS THAT ARE BYTE-IDENTICAL IN BOTH TWINS LIVE HERE. Measured, not assumed:
 * clearCountryHighlight, _flatItemsToStlNodes, onLegendRowClick and _bridgeSelection are character
 * for character the same in both files. applyDimFilter (185 lines vs 170) and switchTab (49 vs 50)
 * are NOT, and they stay where they are — sharing code that merely looks similar is how a refactor
 * silently picks one plugin's behaviour for both.
 *
 * ⚠ A COMPOSABLE, NOT A COMPONENT. The legend markup already lives in SemanticTreeLegend /
 * LegendDesktop / LegendMobile. What was missing is the thing that wires a legend to a map, and a
 * component would have forced both plugins to give up their own template — which is where their
 * genuine differences live.
 *
 * Everything is passed in, nothing is reached for: this module injects nothing and reads no store
 * directly, so a caller can hand it a test double and a second dashboard can adopt it without
 * inheriting research-map's provide tree.
 *
 * @param {object}   deps
 * @param {import('vue').Ref} deps.map             the map instance ref
 * @param {import('vue').Ref} deps.activeTab       the tab object currently shown
 * @param {object}   deps.countryOutline           useCountryOutline() — needs .clearCountry()
 * @param {Function} deps.regionIdle               (value) => paint expression for the idle state
 * @param {object}   deps.mapFly                   camera helpers — .flyToCoords?.() / .fitBounds?.()
 * @param {object}   deps.pplrInstance             carries .selection (a ref) for the legend bridge
 * @param {string}   deps.mapId                    this map's id, to ignore other instances' events
 */

import { FULL_PRAYER_THRESHOLD } from '@map/colors/prayer-progress.js'
/**
 * Depth-first search of a legend tree.
 *
 * Module-level, NOT inside the factory below, because it closes over nothing: the tree and the
 * predicate are both arguments. A pure function hidden inside a closure can only be reached by
 * constructing the whole bridge, which is the difference between a utility and a dependency.
 *
 * @param {Array}   nodes      legend tree nodes, each optionally carrying `children`
 * @param {Function} predicate called with each node; the first truthy match wins
 * @returns {object|null}
 */
export function findNodeInTree(nodes, predicate) {
  for (const n of nodes) {
    if (predicate(n)) return n
    if (n.children?.length) {
      const f = findNodeInTree(n.children, predicate)
      if (f) return f
    }
  }
  return null
}

/**
 * The map filter expression for one row of a FLAT legend (prayer / engagement / adoption / religion).
 *
 * ⚠ RETURNS null RATHER THAN A MATCH-NOTHING EXPRESSION for an unknown tier or key, and callers rely
 * on that: null means "this legend type has no filter for that row", which leaves the map unfiltered,
 * while a match-nothing expression would empty it. An empty map reads as lost data.
 *
 * @param {object} node        the legend row; its `id` is the bucket key
 * @param {string} legendType  'prayer' | 'engagement' | 'adoption' | 'religion'
 * @returns {Array|null} a MapLibre/Mapbox filter expression, or null
 */
export function buildFlatLegendMatchExpr(node, legendType) {
  if (!node || !legendType) return null
  const key = node.id
  if (legendType === 'prayer') {
    const v = ['to-number', ['get', 'peoplePraying']]
    if (key === 'noPrayer')   return ['==', v, 0]
    if (key === 'fullPrayer') return ['>=', v, FULL_PRAYER_THRESHOLD]
    if (key === 'hasPrayer')  return ['all', ['>', v, 0], ['<', v, FULL_PRAYER_THRESHOLD]]
  } else if (legendType === 'engagement') {
    if (key === 'hasEngagement') return ['==', ['get', 'engagementStatus'], true]
    if (key === 'notEngaged')    return ['==', ['get', 'engagementStatus'], false]
  } else if (legendType === 'adoption') {
    if (key === 'hasAdoption') return ['==', ['get', 'adoptionStatus'], true]
    if (key === 'notAdopted')  return ['==', ['get', 'adoptionStatus'], false]
  } else if (legendType === 'religion') {
    // expectedValue is a family letter (C/M/H/B/E/J/S/N/O/U). Match first char.
    return ['==', ['slice', ['coalesce', ['get', 'religion'], ''], 0, 1], key]
  }
  return null
}

/**
 * regionIdle — the doxa-regions "idle" paint expression.
 *
 * ★ WHY THIS LIVES HERE. Both maps that paint the regions layers — research-map.vue and
 * countries-map.vue — defined their own copy of this one-liner while ALREADY passing it into this
 * composable, which then called it to paint the idle state. So the library owned the paint logic and
 * not the expression it painted with, and the two copies could be edited apart with nothing failing:
 * the same "idle" would render differently on the two maps. check:region-paint-single-source is the
 * gate that now fails if either plugin re-introduces a local copy.
 *
 * ⚠ THE SAME VALUE ON BOTH BRANCHES IS THE POINT, not a mistake. ['case', cond, v, v] returns v
 * whichever way the condition falls — it exists so the expression is shaped like the HIGHLIGHT
 * expressions it sits beside (which do differ per branch), and so a region with no
 * iso_3166_1_alpha_3 is painted rather than skipped. Collapsing it to a bare `v` would change what
 * MapLibre does with featureless regions.
 *
 * @param {*} v  the paint value to apply in both branches
 * @returns {Array} a MapLibre 'case' expression
 */
export function regionIdle(v) {
  return ['case', ['has', 'iso_3166_1_alpha_3'], v, v]
}

export function useLegendMapBridge({ map, activeTab, countryOutline, regionIdle, mapFly, pplrInstance, mapId }) {
  /**
   * Drop every highlight the legend may have painted on the country/region layers.
   *
   * The boundary outline clears FIRST and unconditionally: it is independent of regions-fill, so it
   * must clear even on a tab that never loaded the WAGF regions source.
   */
  function clearCountryHighlight() {
    countryOutline.clearCountry()
    const m = map.value
    if (!m || !m.getLayer('regions-fill')) return
    m.setPaintProperty('regions-fill', 'fill-opacity', regionIdle(0.20))
    m.setPaintProperty('regions-fill', 'fill-outline-color', null)
    m.setPaintProperty('regions-border', 'line-color', regionIdle('rgba(60,60,80,0.35)'))
    m.setPaintProperty('regions-border', 'line-width', regionIdle(0.6))
    if (activeTab.value?.id !== 'doxa-regions') {
      m.setLayoutProperty('regions-fill',   'visibility', 'none')
      m.setLayoutProperty('regions-border', 'visibility', 'none')
    }
  }

  /** Flatten a flat legend's items (and one level of children) into STL-compatible nodes. */
  function flatItemsToStlNodes(items) {
    const out = []
    for (const item of items) {
      out.push({
        id: item.key, label: item.label, color: item.color,
        count: item.count ?? 0, pop: item.population ?? 0,
        filter: item.filterKey ? ['==', ['get', '_flat_filter'], item.filterKey] : null,
        children: [],
      })
      for (const c of (item.children || [])) {
        out.push({
          id: c.key, label: c.label, color: c.color,
          count: c.count ?? 0, pop: c.population ?? 0,
          filter: c.filterKey ? ['==', ['get', '_flat_filter'], c.filterKey] : null,
          children: [],
        })
      }
    }
    return out
  }

  /**
   * Move the camera for a legend row click.
   * ⚠ The mapId guard is load-bearing: two <doxa-map> elements on one page both hear this event, and
   * without it a row click in one legend flies the other map.
   */
  function onLegendRowClick(evt) {
    const detail = evt?.detail
    if (!detail || detail.mapId !== mapId) return
    if (detail.center && Array.isArray(detail.center)) {
      mapFly.flyToCoords?.({ longitude: detail.center[0], latitude: detail.center[1] }, detail.zoom ?? 4)
    } else if (detail.bounds) {
      mapFly.fitBounds?.(detail.bounds, 60)
    }
  }

  /**
   * Publish a legend selection onto the shared instance, or clear it.
   *
   * ⚠ THE SAME-KIND-AND-LABEL EARLY RETURN IS NOT AN OPTIMISATION. If the legend already holds a
   * selection of this kind and label, the user's click landed on a SPECIFIC node carrying its exact
   * family prefix in the id. A label-matched lookup can pick a different family bucket when the same
   * label appears twice (Bengali under Indo-European and under "Unknown", for pins with a null
   * imb_language_family and no lookup hit). Overwriting with the wrong id breaks the legend's
   * _lastInternalId guard and triggers a depth-based tab switch on what should be a same-tab click.
   *
   * The FULL node is stored, not a trimmed copy: its color, children and filter are what the row
   * highlight, the descendant-dim exemption and the parent breadcrumb all read.
   */
  function bridgeSelection(kind, fullNode) {
    if (!fullNode) {
      const cur = pplrInstance.selection.value
      if (cur && cur.id?.startsWith(kind + ':')) pplrInstance.selection.value = null
      return
    }
    const cur = pplrInstance.selection.value
    if (cur && cur.id?.startsWith(kind + ':') && cur.label === fullNode.label) return
    pplrInstance.selection.value = fullNode
  }

  return { clearCountryHighlight, flatItemsToStlNodes, onLegendRowClick, bridgeSelection }
}

export default useLegendMapBridge
