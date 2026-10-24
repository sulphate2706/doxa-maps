/**
 * zoneTree.js — build the region → zone tree that ListSelectorLegend renders.
 *
 * Pure, and it takes the zone tables as ARGUMENTS rather than importing them: they belong to
 * another plugin, and a relative import into its folder is refused by
 * check:no-cross-plugin-imports. They reach the browser as a published table instead, so the
 * caller fetches and passes them in. That also makes this testable with no fixture files.
 *
 * ★ REGION IDS ARE NAMESPACED, AND THIS IS LOAD-BEARING. The legend emits one bare string on
 * one channel — a leaf emits its zone id, a region row emits the region's id — and the two id
 * spaces OVERLAP: measured against zone-regions.json there are 33 zone ids and 7 region ids,
 * and the intersection is exactly {europe}, whose region is itself. So an un-namespaced
 * `europe` is ambiguous: region (expand to every European zone) or leaf (that one zone)?
 * It is invisible today only because region `europe` happens to contain exactly one zone —
 * a fact about this data, not a property of the design. The day a second European zone is
 * filed, clicking the region would filter to one zone instead of several, with no error.
 * So region rows get `region:` and leaves stay bare. The component needs no change: it emits
 * whatever id the tree gives it.
 */

export const REGION_PREFIX = 'region:'

/** Is this emitted id a region row rather than a zone leaf? */
export function isRegionId(id) {
  return typeof id === 'string' && id.startsWith(REGION_PREFIX)
}

/** `region:asia` -> `asia`. Returns null for a zone id. */
export function regionOf(id) {
  return isRegionId(id) ? id.slice(REGION_PREFIX.length) : null
}

/** A readable label from a slug, used only when the zone tables carry no label for it. */
export function humanize(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

/**
 * nodes for ListSelectorLegend.
 *
 * @param zoneRegions  { [zoneId]: regionId } — zone-regions.json
 * @param labels       { [zoneId]: string }   — optional, from the zone tables
 * @param counts       { [zoneId]: number }   — optional, groups that resolve to that zone
 *
 * Regions and their zones are both sorted by label, so the tree does not reorder between
 * renders when the underlying object's key order changes.
 */
export function buildZoneTree(zoneRegions, { labels = {}, counts = {} } = {}) {
  const byRegion = new Map()
  for (const [zoneId, regionId] of Object.entries(zoneRegions || {})) {
    if (!byRegion.has(regionId)) byRegion.set(regionId, [])
    byRegion.get(regionId).push({
      id: zoneId,
      label: labels[zoneId] || humanize(zoneId),
      count: counts[zoneId] ?? 0,
    })
  }
  const nodes = []
  for (const [regionId, children] of byRegion) {
    children.sort((a, b) => a.label.localeCompare(b.label))
    nodes.push({
      id: REGION_PREFIX + regionId,
      label: labels[regionId] || humanize(regionId),
      count: children.reduce((n, c) => n + (c.count || 0), 0),
      children,
    })
  }
  nodes.sort((a, b) => a.label.localeCompare(b.label))
  return nodes
}

/**
 * The zone ids a selection means.
 *
 * A region id expands to its zones; a zone id is itself; null is "no filter".
 * ★ A REGION SWEEP IS NOT A ZONE SWEEP. Zones absent from `zoneRegions` have no region, so
 * they can never be reached by expanding regions — that is what the legend's Unassigned
 * bucket is for, and why a select-all must enumerate ZONES rather than regions. This function
 * deliberately does not offer an "all" case: there is no correct region-based answer to it.
 */
export function zonesForSelection(id, zoneRegions) {
  if (id == null || id === '') return null
  const region = regionOf(id)
  if (region == null) return [id]
  return Object.entries(zoneRegions || {}).filter(([, r]) => r === region).map(([z]) => z)
}
