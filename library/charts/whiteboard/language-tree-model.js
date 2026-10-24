/**
 * language-tree-model.js — the parts of the language tree that are ABOUT the hierarchy, kept out of the
 * component so they can be tested without a browser.
 *
 * The chart itself is a whiteboard of tiered points (library/charts/whiteboard/tiered-points.js) and
 * knows nothing about trees. This is the rest: the parent/child index, the edge collection, the
 * descendants of a node, and the default colour rollup.
 *
 * ★ THE ROLLUP IS OVER THE IN-SCOPE DESCENDANTS, NOT THE WHOLE SUBTREE, and getting that wrong is
 * invisible. "A family shows the worst colour of the languages below it" is only meaningful relative to
 * what the reader is currently looking at — the rollup is computed against the FILTERED roster, so a
 * family that is red overall can be green within the reader's selection. Hand the rollup the whole
 * subtree and the colours quietly stop agreeing with the board, which is the one failure mode the
 * chart's author flagged when this was extracted.
 *
 * ★ AND THE ROLLUP IS A DEFAULT, NOT A RULE. Nothing in the drawing depends on a parent being the worst
 * of its children; a consumer colouring by speaker count or by an average would render perfectly well.
 * So statusFor is injectable and this is merely what the language tree does.
 */

/** Index a flat node list: by id, children by parent id, and the roots. */
export function indexTree(nodes = []) {
  const byId = new Map()
  const kids = new Map()
  const roots = []
  const nodeOfIso = new Map()
  for (const n of nodes) {
    byId.set(n.id, n)
    if (n.iso && !nodeOfIso.has(n.iso)) nodeOfIso.set(n.iso, n.id)
    if (n.p) { if (!kids.has(n.p)) kids.set(n.p, []); kids.get(n.p).push(n.id) } else roots.push(n.id)
  }
  return { byId, kids, roots, nodeOfIso }
}

/** Every coordinate in a node's subtree, including its own — what framing a selection fits. */
export function subtreeCoords(index, id) {
  const out = []
  if (!index || !index.byId.has(id)) return out
  const seen = new Set()
  const walk = (k) => {
    if (seen.has(k)) return          // a malformed index must not hang the board
    seen.add(k)
    const n = index.byId.get(k)
    if (n && Array.isArray(n.c)) out.push(n.c)
    for (const c of index.kids.get(k) || []) walk(c)
  }
  walk(id)
  return out
}

/** The ids of a node's descendants that carry a status — the leaves a rollup reads. */
export function descendantLeaves(index, id) {
  const out = []
  const walk = (k) => {
    const n = index.byId.get(k)
    if (!n) return
    if (n.st !== undefined) out.push(n)
    for (const c of index.kids.get(k) || []) walk(c)
  }
  walk(id)
  return out
}

/**
 * The language tree's own rollup: the WORST status among a node's in-scope descendants.
 * @param {Object}   index
 * @param {string}   id
 * @param {Object}   o
 * @param {Set}      [o.inScope]  ids (or isos) currently on the board; omit for "everything"
 * @param {string[]} [o.order]    worst-first; the first one found wins
 * @param {Function} [o.isInScope] (node) => boolean, when scope is not a plain id set
 */
export function worstOfDescendants(index, id, { inScope = null, order = ['r', 'y', 'g'], isInScope = null } = {}) {
  const self = index.byId.get(id)
  if (self && self.st !== undefined && !index.kids.get(id)?.length) return self.st
  const keep = (n) => {
    if (isInScope) return isInScope(n)
    if (!inScope) return true
    return inScope.has(n.id) || (n.iso !== undefined && inScope.has(n.iso))
  }
  const found = new Set()
  for (const n of descendantLeaves(index, id)) if (keep(n)) found.add(n.st)
  for (const s of order) if (found.has(s)) return s
  return undefined
}

/**
 * Parent -> child line segments as a GeoJSON collection. This is the ONE hierarchical layer; everything
 * else the chart draws comes from the point collection.
 * Edges are built here rather than stored by the builder because every node already carries its parent
 * id and its own coordinate: storing them again would roughly double the file for no new information.
 */
export function linkFC(index) {
  const features = []
  for (const [id, n] of index.byId) {
    if (!n.p) continue
    const parent = index.byId.get(n.p)
    if (!parent || !Array.isArray(parent.c) || !Array.isArray(n.c)) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [parent.c, n.c] },
      properties: { id, p: n.p, lv: n.lv },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** The point collection the whiteboard layer draws, with the caller's colour applied per node. */
export function nodeFC(index, { colorFor = () => undefined, inScope = null } = {}) {
  const features = []
  for (const [id, n] of index.byId) {
    if (!Array.isArray(n.c)) continue
    const inside = !inScope || inScope.has(id) || (n.iso !== undefined && inScope.has(n.iso))
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: n.c },
      properties: {
        id,
        label: n.n,
        tier: n.lv,
        k: n.R !== undefined ? 1e6 : (n.lv === 'l' ? 1e3 : 1),
        root: n.p ? 0 : 1,
        m: inside ? 1 : 0,
        ...(n.iso !== undefined ? { iso: n.iso } : {}),
        ...(n.R !== undefined ? { R: n.R } : {}),
        colour: colorFor(n, { index, inScope }),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}
