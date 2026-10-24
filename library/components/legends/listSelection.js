/**
 * listSelection.js — what a vertical-legend row selects, and the zones a tree forgot.
 *
 * Extracted from ListSelectorLegend.vue so both rules can be tested without mounting a component.
 * Small rules, large consequences: a dashboard filters thousands of rows by the first, and the
 * second decides whether 100+ groups are reachable at all.
 */

/** Every leaf under a node, or the node itself when it is a leaf. */
export function leavesOf(node) {
  if (!node) return []
  const kids = node.children || node.nodes || []
  if (!kids.length) return [node]
  const out = []
  for (const k of kids) out.push(...leavesOf(k))
  return out
}

/** Every zone id present anywhere in a tree. */
export function zoneIdsIn(nodes) {
  const out = new Set()
  for (const n of nodes || []) for (const l of leavesOf(n)) if (l && l.id) out.add(String(l.id))
  return out
}

export const UNASSIGNED_ID = '__unassigned__'

/**
 * ★ A ZONE THE TREE DOES NOT CONTAIN MUST STILL BE REACHABLE. Four joinable zones are absent from
 * zone-regions.json today — guizhou, xinjiang (100+ groups on its own), bihar, madhya-pradesh — so a
 * legend that renders only the region tree DROPS them, silently, and a reader has no way to select
 * groups that plainly exist. The fix is not to remember: it is to hand this function the full zone
 * set and let it render the difference. A drop then becomes structurally impossible rather than a
 * thing someone has to keep checking.
 *
 * Returns the tree unchanged when nothing is missing, so the bucket never appears without cause.
 *
 * @param {Array} nodes      the region-grouped tree
 * @param {Array<string>} allZoneIds  every zone the data can join, tree or no tree
 * @param {string} label     what to call the bucket (the caller localises it)
 */
export function withUnassigned(nodes, allZoneIds, label = 'Unassigned') {
  const present = zoneIdsIn(nodes)
  const missing = (allZoneIds || []).map(String).filter((id) => !present.has(id))
  if (!missing.length) return nodes || []
  return [
    ...(nodes || []),
    {
      id: UNASSIGNED_ID,
      label,
      depth: 0,
      // Each missing zone is a selectable leaf, not a lump: a reader wants xinjiang, not "the four
      // zones nobody filed".
      children: missing.map((id) => ({ id, label: id, zoneKey: id })),
    },
  ]
}

/**
 * The value the legend emits. gospel's contract: a single SERIALISABLE id, so it survives ?zone=,
 * profile-config and a deep link, and stays usable across their four tab shapes.
 *
 * A leaf emits its zone id; a REGION row emits the region's own id (a region selects
 * the union of its zones). The consumer expands a region id to its zones using the zone data it
 * already holds — which is also where the diacritic-folding join lives, so there is no second copy
 * of it here to drift.
 *
 * ★ REGION IDS AND ZONE IDS SHARE ONE NAMESPACE, SO NAMESPACE YOUR REGION ROWS (e.g. `region:europe`,
 * leaves left bare). One bare string on one channel carries no kind, and the two id sets overlap in
 * the shipped data: measured against zone-regions.json there are 33 zone ids and 7 region ids, and
 * the intersection is exactly {europe}, whose region is itself. So `europe` alone cannot tell a
 * consumer whether the Europe REGION was clicked (expand to every European zone) or the Europe ZONE
 * leaf (filter to that one).
 *
 * It is not live TODAY only because region `europe` currently contains exactly one zone, so both
 * readings produce the same set — the bug is masked by a data coincidence, not absent. It goes live
 * the day a second European zone is filed, and then it fails the quiet way: a smaller result, no
 * error, no empty state. check:list-selection FAILS ON PURPOSE at that moment.
 *
 * This component cannot fix it: the CONSUMER builds the tree, so only the consumer knows which rows
 * are regions. Found while wiring a plugin that namespaces its region rows; written
 * here because the next consumer to build a tree from the same zone data inherits the same collision.
 */
export function selectedId(node) {
  return node && node.id != null ? String(node.id) : null
}
