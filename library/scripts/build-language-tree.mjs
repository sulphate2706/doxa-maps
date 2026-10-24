/**
 * build-language-tree.mjs — the LANGUAGE TREE layout, as a library function a fork can call on ITS rows.
 *
 * Every language family a roster belongs to, drawn as a radial tree (family -> branches -> languages ->
 * dialects), each family's enclosing circle packed against the others into one non-overlapping tapestry.
 * LAYOUT IS COMPUTED HERE, ONCE, AT BUILD TIME, so a phone does none of it, and the output is projected
 * to lng/lat so a map engine can draw it undistorted on the GPU.
 *
 * ★ WHY THIS IS IN library/ AND WHAT DELIBERATELY IS NOT (the brief: make it reusable). This was
 * extracted from gospel-internet's scripts/build-language-tree.mjs, which does TWO jobs in one file: this
 * layout, and a classification of each language from eBible, FCBH verse scopes and a screened link table.
 * Moving the file whole would have put those sources inside library/ and a fork building the tree from
 * its OWN rows has no eBible index — the literal move is the one shape that would not deliver the reuse.
 * So the CLASSIFICATION STAYS WITH ITS OWNER and arrives here as `statusOf`, a function returning an
 * OPAQUE string. Nothing in this file knows what 'g' means, and a consumer colouring by speaker count,
 * or by anything else, substitutes one function instead of forking a data pipeline.
 *
 * ★ THE STATUS IS WRITTEN ON LEAVES ONLY, ON PURPOSE. A family or branch gets NO status here. Rolling a
 * parent's colour up from its descendants ("worst of the languages below it") is a RUNTIME decision the
 * chart makes against the reader's current scope — which is not knowable at build time, because it
 * changes as the reader filters. Baking it would freeze one scope's answer into the data.
 *
 * The numbers below are measured, not chosen. Where a constant has a reason it is stated; changing one
 * without re-measuring is how this drawing gets quietly worse.
 */

import { whiteboardProjection } from '../maps/whiteboard-projection.js'

/** A tree whose single-child branch chains are collapsed for DRAWING; the skipped names are kept in `via`. */
function collapse(n) {
  n.kids = n.kids.map((k) => {
    let c = k
    const via = []
    while (c.level === 'family' && c.kids.length === 1 && c.kids[0].level === 'family') { via.push(c.name); c = c.kids[0] }
    if (via.length) c.via = via
    return c
  })
  n.kids.sort((a, b) => a.name.localeCompare(b.name))
  n.kids.forEach(collapse)
}

const leaves = (n) => (n._leaves ??= (n.kids.length ? n.kids.reduce((s, k) => s + leaves(k), 0) : 1))
const depth = (n) => (n._depth ??= (n.kids.length ? 1 + Math.max(...n.kids.map(depth)) : 0))
const clearMemo = (n) => { delete n._leaves; delete n._depth; n.kids.forEach(clearMemo) }
const hideDialects = (n) => { n._allKids = n.kids; n.kids = n.kids.filter((k) => k.level !== 'dialect'); n.kids.forEach(hideDialects) }
const showDialects = (n) => { if (n._allKids) { n.kids = n._allKids; delete n._allKids } n.kids.forEach(showDialects) }

/** One family: leaves evenly around the circle, parents at the mean of their children, radius by depth. */
function layoutFamily(root, { ARC, STEP_MIN }) {
  const nLeaves = leaves(root), d = depth(root)
  const step = d ? Math.max(STEP_MIN, (nLeaves * ARC) / (2 * Math.PI * d)) : 0
  let slot = 0
  const place = (n, lvl) => {
    if (!n.kids.length) { n._a = ((slot + 0.5) / nLeaves) * 2 * Math.PI; slot++ }
    else { n.kids.forEach((k) => place(k, lvl + 1)); n._a = (n.kids[0]._a + n.kids[n.kids.length - 1]._a) / 2 }
    n._r = lvl * step
  }
  place(root, 0)
  // The enclosing circle is the tree's REAL extent (its outermost node) plus room for one label, NOT the
  // deepest possible ring: sized by the ring, the packing wasted about a third of the board.
  let far = 0
  const walk = (n) => { far = Math.max(far, n._r); n.kids.forEach(walk) }
  walk(root)
  root._R = far + 1.6 + Math.min(3, Math.sqrt(nLeaves) * 0.25)
  return root
}

/** Largest first, at the nearest free spot on a spiral: circles never overlap and the whole fills a disc. */
function pack(roots) {
  const placed = []
  for (const root of [...roots].sort((a, b) => b._R - a._R || a.name.localeCompare(b.name))) {
    const R = root._R
    let best = null
    if (!placed.length) best = [0, 0]
    for (let t = 0; !best; t += 0.05) {
      const rad = 0.35 * t * Math.max(1, R * 0.2)
      const x = rad * Math.cos(t), y = rad * Math.sin(t)
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.R + R + 0.8)) best = [x, y]
    }
    placed.push({ x: best[0], y: best[1], R })
    root._cx = best[0]; root._cy = best[1]
  }
  return placed
}

const LV = { family: 'f', language: 'l', dialect: 'd' }

/**
 * @param {Object}   input
 * @param {Array}    input.languoids        [{ id, name, level, iso, parent }] — a Glottolog-shaped subset
 * @param {string[]} [input.notInGlottolog] ISO codes the snapshot lacks; each becomes a leaf under one
 *                                          labelled root, so no roster language is left off the tree
 * @param {Map}      input.roster           iso -> whatever the consumer wants on the node as `g`
 * @param {Function} [input.statusOf]       (iso) => opaque string, written as `st` on LEAVES only
 * @param {Function} [input.nameOf]         (iso) => display name for a notInGlottolog leaf
 * @param {Object}   [input.screen]         { ARC, STEP_MIN } — the on-screen layout
 * @param {Object}   [input.poster]         { ARC, STEP_MIN } — the print layout, stored as `pc` / `pR`
 * @param {number}   [input.extentFraction] share of the Mercator square the tapestry spans
 * @returns {{ nodes: Array, coverage: Object, warnings: string[] }}
 */
export function buildLanguageTree({
  languoids,
  notInGlottolog = [],
  roster = new Map(),
  statusOf = () => undefined,
  nameOf = (iso) => iso,
  screen = { ARC: 1.0, STEP_MIN: 3.2 },
  poster = { ARC: 1.0, STEP_MIN: 3.2 },
  extentFraction = 0.17,
  missingRootId = 'not-in-glottolog',
  missingRootName = 'Not in Glottolog',
} = {}) {
  const warnings = []
  const L = new Map((languoids || []).map((l) => [l.id, { ...l, kids: [] }]))
  const roots = []
  for (const n of L.values()) {
    if (n.parent && L.has(n.parent)) L.get(n.parent).kids.push(n)
    else if (!n.parent) roots.push(n)
    else warnings.push(`${n.id} (${n.name}) has a parent ${n.parent} outside the snapshot`)
  }
  if (notInGlottolog.length) {
    const miss = { id: missingRootId, name: missingRootName, level: 'family', iso: '', parent: '', kids: [] }
    for (const iso of notInGlottolog) {
      const leaf = { id: 'iso-' + iso, name: nameOf(iso) || iso, level: 'language', iso, parent: missingRootId, kids: [] }
      L.set(leaf.id, leaf); miss.kids.push(leaf)
    }
    L.set(missingRootId, miss); roots.push(miss)
  }
  const isoToNode = new Map()
  for (const n of L.values()) if (n.iso) isoToNode.set(n.iso, n)
  for (const iso of roster.keys()) if (!isoToNode.has(iso)) warnings.push(`language ${iso} of the roster is not on the tree`)

  roots.forEach(collapse)

  // ★ THE POSTER LAYOUT IS COMPUTED FIRST, AND WITHOUT DIALECTS. Resources are catalogued per LANGUAGE,
  // and on a sheet that cannot zoom, 2,653 dialect slots squeezed the 858 languages until ~40% of the
  // language names could not be printed without overlap. The screen layout keeps them, because the map
  // engine hides labels that do not fit and reveals them as the reader zooms — a printed sheet has one
  // scale and must fit every name at it. Stored per node in units of its own extent, so it is scale-free.
  roots.forEach(hideDialects); roots.forEach(clearMemo)
  roots.forEach((r) => layoutFamily(r, poster))
  {
    const pl = pack(roots)
    let pext = 1
    for (const p of pl) pext = Math.max(pext, Math.abs(p.x) + p.R, Math.abs(p.y) + p.R)
    const keep = (n, root) => {
      n._pu = [(root._cx + n._r * Math.cos(n._a)) / pext, (root._cy + n._r * Math.sin(n._a)) / pext]
      n.kids.forEach((k) => keep(k, root))
    }
    for (const root of roots) { keep(root, root); root._pR = root._R / pext }
  }
  roots.forEach(showDialects); roots.forEach(clearMemo)
  roots.forEach((r) => layoutFamily(r, screen))
  const placed = pack(roots)

  // ── to lng/lat through the INVERSE of Web Mercator, uniformly scaled, so the drawing is undistorted ──
  let ext = 1
  for (const p of placed) ext = Math.max(ext, Math.abs(p.x) + p.R, Math.abs(p.y) + p.R)
  // ★ HOW MUCH OF THE SQUARE THE TAPESTRY SPANS DECIDES HOW FAR A READER CAN ZOOM OUT, and that is the
  // whole reason this number is a parameter with a measured default. The engines stop at zoom 0 (the
  // whole Mercator square), so the SMALLER the drawing, the more room there is below its opening view.
  // At 68% there was about one level of room, and zooming out a bit further was needed; at 0.17
  // there are two.
  // The conversion moved to library/maps/whiteboard-projection.js so a second whiteboard chart cannot
  // re-derive it — gospel's set charts were about to scale linearly into degrees, which Mercator then
  // renders as ovals. Behaviour here is unchanged and check:whiteboard-projection asserts that over a
  // grid, so the language tree's existing layout cannot move by this refactor.
  const toLngLat = whiteboardProjection({ extent: ext, extentFraction })
  const K = toLngLat.K

  // Edges are NOT emitted: every node carries its parent id and both coordinates, so the chart draws each
  // parent->child line itself. It halves the file.
  const nodes = []
  const emit = (n, root, parentId, isRoot) => {
    const x = root._cx + n._r * Math.cos(n._a), y = root._cy + n._r * Math.sin(n._a)
    const lv = isRoot && n.level === 'family' ? 'f' : n.level === 'family' ? 'b' : LV[n.level] || 'b'
    const node = { id: n.id, n: n.name, lv, p: parentId || '', c: toLngLat(x, y) }
    if (n.iso) node.iso = n.iso
    if (n.via) node.via = n.via
    if (lv === 'l' || (lv === 'd' && n.iso && roster.has(n.iso))) {
      const st = statusOf(n.iso)
      if (st !== undefined && st !== null && st !== '') node.st = st
    }
    if (n.iso && roster.has(n.iso)) node.g = roster.get(n.iso)
    if (lv === 'f' || isRoot) { node.R = Math.round(root._R * K * 1e6) / 1e6; node.pR = Math.round(root._pR * 1e5) / 1e5 }
    if (n._pu) node.pc = [Math.round(n._pu[0] * 1e5) / 1e5, Math.round(n._pu[1] * 1e5) / 1e5]
    nodes.push(node)
    for (const k of n.kids) emit(k, root, n.id, false)
  }
  for (const root of roots) emit(root, root, '', true)

  const levels = nodes.reduce((a, n) => ((a[n.lv] = (a[n.lv] || 0) + 1), a), {})
  return {
    nodes,
    coverage: { nodes: nodes.length, levels, families: roots.length, not_in_glottolog: notInGlottolog.length },
    warnings,
  }
}

export default buildLanguageTree
