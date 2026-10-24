#!/usr/bin/env node
/**
 * build-language-tree.mjs — the LANGUAGE TREE the board draws on its whiteboard: every language family
 * our people groups belong to, as a radial tree (family -> branches -> languages -> dialects), packed with
 * the other families into one non-overlapping tapestry, coloured by what the gospel sources hold.
 *
 * LAYOUT IS COMPUTED HERE, ONCE, so a phone does no layout work. Each family is a radial tree (branches
 * fanned around its root, one angular slot per leaf, radius by depth, the ring wide enough for its leaves).
 * Each tree's enclosing circle is then packed against the others, largest first, at the nearest free spot
 * on a spiral: circles never overlap, and the whole fills a roughly round board. Coordinates are written as
 * lng/lat through the INVERSE of Web Mercator, so on the map engine the drawing is undistorted.
 *
 * COLOUR, PER LANGUAGE (ISO 639-3), from sources the board can cite:
 *   g  a New Testament or full Bible found: eBible (nt/full flags), a link whose scope is New
 *      Testament, Full Bible, or 27/66 parts (FCBH, Scripture Earth, PNG.Bible, Door43), or FCBH's own
 *      verse scope (people-group-pins codes[iso].au.vsc) of 27 or 66 parts
 *   y  something found in their own language (the access ladder), but no New Testament
 *   r  nothing found in their own language in the sources checked
 * A DIALECT is never coloured on its own evidence: every source catalogues by language, never by dialect.
 * It carries its language's colour with `inh:1`, and the board draws it lighter and says so.
 * A family or branch is coloured by the WORST language inside it (red if any has nothing), with counts,
 * so the eye goes to the gap. The board recomputes these per list and per filter; the values here are the
 * whole roster's.
 *
 * Chains of single-child branches are collapsed for drawing (their names kept in `via`), so a 12-deep path
 * with no splits does not become 12 dots in a line. Codes Glottolog lacks go under one labelled node,
 * "Not in Glottolog", never dropped.
 *
 * Inputs: data/glottolog/glottolog-subset.json, data/tables/gospel-internet.json, ebible-index.json,
 * gospel-resource-links.json. Outputs: data/tables/gospel-internet-tree.json and
 * gospel-internet-resources.json (+ their public/dx-maps/assets/tables copies). `--check` compares.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const T = (f) => JSON.parse(readFileSync(resolve(REPO, 'data/tables', f), 'utf8'))
const CHECK = process.argv.includes('--check')
const failures = []
const fail = (m) => failures.push(m)

const glotto = JSON.parse(readFileSync(resolve(REPO, 'data/glottolog/glottolog-subset.json'), 'utf8'))
const gi = T('gospel-internet.json')
const ebible = T('ebible-index.json').codes || {}
const links = T('gospel-resource-links.json').rows || []

// ── colour per language ────────────────────────────────────────────────────────────────────────────
const ntFound = new Set()
for (const [iso, v] of Object.entries(ebible)) if (v && (v.nt || v.full)) ntFound.add(iso)
const NT_SCOPE = /^(New Testament|Full Bible)$|^(27|66) parts/
for (const r of links) if (NT_SCOPE.test(r.scope || '')) ntFound.add(r.iso639_3)
// Faith Comes By Hearing's own verse scope for its fileset (people-group-pins codes[iso].au.vsc, shaped
// "N parts, FIRST to LAST"): the same 27|66-parts rule. FCBH's published claim, recorded as cited, not
// counted book by book (2026-09-27: 4 full Bibles + 5 NTs this adds).
for (const [iso, c] of Object.entries(T('people-group-pins.json').codes || {})) if (/^(27|66) parts/.test((c && c.au && c.au.vsc) || '')) ntFound.add(iso)
const langAccess = new Map()            // iso -> 'some' | 'none' (from the rows: the access ladder)
const groupsBy = new Map()              // iso -> groups on the roster
for (const r of gi.rows) {
  const some = (r.access_detail || 'none') !== 'none'
  langAccess.set(r.iso639_3, langAccess.get(r.iso639_3) === 'some' || some ? 'some' : 'none')
  groupsBy.set(r.iso639_3, (groupsBy.get(r.iso639_3) || 0) + 1)
}
const statusOf = (iso) => ntFound.has(iso) ? 'g' : langAccess.get(iso) === 'some' ? 'y' : 'r'

// ── the tree ────────────────────────────────────────────────────────────────────────────────────────
const L = new Map(glotto.languoids.map((l) => [l.id, { ...l, kids: [] }]))
const ROOT_MISSING = 'not-in-glottolog'
const roots = []
for (const n of L.values()) {
  if (n.parent && L.has(n.parent)) L.get(n.parent).kids.push(n)
  else if (!n.parent) roots.push(n)
  else fail(`${n.id} (${n.name}) has a parent ${n.parent} outside the snapshot`)
}
// the codes Glottolog lacks: one labelled root, one leaf per code, so no group is left off the tree
if (glotto.not_in_glottolog.length) {
  const miss = { id: ROOT_MISSING, name: 'Not in Glottolog', level: 'family', iso: '', parent: '', kids: [] }
  const nameOf = new Map(gi.rows.map((r) => [r.iso639_3, r.language]))
  for (const iso of glotto.not_in_glottolog) {
    const leaf = { id: 'iso-' + iso, name: nameOf.get(iso) || iso, level: 'language', iso, parent: ROOT_MISSING, kids: [] }
    L.set(leaf.id, leaf); miss.kids.push(leaf)
  }
  L.set(ROOT_MISSING, miss); roots.push(miss)
}
// isolates are language-level roots: keep them as one-node trees
const isoToNode = new Map()
for (const n of L.values()) if (n.iso) isoToNode.set(n.iso, n)
for (const iso of groupsBy.keys()) if (!isoToNode.has(iso)) fail(`language ${iso} of the roster is not on the tree`)

// collapse single-child branch chains (drawing only; names kept)
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
roots.forEach(collapse)

// ── radial layout per family ────────────────────────────────────────────────────────────────────────
// Two layouts from one algorithm: the SCREEN one (ARC 1: the map engine hides labels that do not fit,
// and reveals them as the reader zooms) and the POSTER one (wider leaf spacing, because a printed sheet
// cannot zoom: every name must fit at one scale). The poster's is stored as `pc` / `pR` beside `c` / `R`.
let ARC = 1.0            // minimum arc between neighbouring leaves (layout units)
let STEP_MIN = 3.2       // minimum ring spacing
const POSTER = { ARC: 1.0, STEP_MIN: 3.2 }
function leaves(n) { return n._leaves ??= (n.kids.length ? n.kids.reduce((s, k) => s + leaves(k), 0) : 1) }
function depth(n) { return n._depth ??= (n.kids.length ? 1 + Math.max(...n.kids.map(depth)) : 0) }
function layoutFamily(root) {
  const nLeaves = leaves(root), d = depth(root)
  const step = d ? Math.max(STEP_MIN, (nLeaves * ARC) / (2 * Math.PI * d)) : 0
  let slot = 0
  const place = (n, lvl) => {
    if (!n.kids.length) { n._a = ((slot + 0.5) / nLeaves) * 2 * Math.PI; slot++ }
    else { n.kids.forEach((k) => place(k, lvl + 1)); n._a = (n.kids[0]._a + n.kids[n.kids.length - 1]._a) / 2 }
    n._r = lvl * step
  }
  place(root, 0)
  // The enclosing circle is the tree's REAL extent (its outermost node) plus room for one label, not
  // the deepest possible ring: sized by the ring, the packing wasted about a third of the board.
  let far = 0
  const walk = (n) => { far = Math.max(far, n._r); n.kids.forEach(walk) }
  walk(root)
  root._R = far + 1.6 + Math.min(3, Math.sqrt(nLeaves) * 0.25)
  return root
}
// ── pack the families: largest first, nearest free spot on a spiral ────────────────────────────────
function pack() {
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

// the poster layout first, remembered per node in units of its own extent (so it is scale-free).
// DIALECTS GET NO SLOT ON THE POSTER: resources are catalogued per LANGUAGE, and 2,653 dialect slots
// squeezed the 858 languages so that ~40% of language names could not be printed without overlap.
const clearMemo = (n) => { delete n._leaves; delete n._depth; n.kids.forEach(clearMemo) }
const hideDialects = (n) => { n._allKids = n.kids; n.kids = n.kids.filter((k) => k.level !== 'dialect'); n.kids.forEach(hideDialects) }
const showDialects = (n) => { if (n._allKids) { n.kids = n._allKids; delete n._allKids } n.kids.forEach(showDialects) }
roots.forEach(hideDialects); roots.forEach(clearMemo)
;({ ARC, STEP_MIN } = POSTER)
roots.forEach(layoutFamily)
{
  const pl = pack()
  let pext = 1
  for (const p of pl) pext = Math.max(pext, Math.abs(p.x) + p.R, Math.abs(p.y) + p.R)
  const keep = (n, root) => { n._pu = [(root._cx + n._r * Math.cos(n._a)) / pext, (root._cy + n._r * Math.sin(n._a)) / pext]; n.kids.forEach((k) => keep(k, root)) }
  for (const root of roots) { keep(root, root); root._pR = root._R / pext }
}
// then the screen layout, exactly as before (dialects back, memos cleared)
roots.forEach(showDialects); roots.forEach(clearMemo)
;({ ARC, STEP_MIN } = { ARC: 1.0, STEP_MIN: 3.2 })
roots.forEach(layoutFamily)
const placed = pack()

// ── to lng/lat through inverse Web Mercator, uniformly scaled, so the drawing is not distorted ─────
let ext = 1
for (const p of placed) ext = Math.max(ext, Math.abs(p.x) + p.R, Math.abs(p.y) + p.R)
// The tapestry spans ~34% of the Mercator square. The engines stop at zoom 0 (the whole square), so the
// smaller the drawing, the further a reader can zoom OUT from its opening view: at 68% there was about
// one level of room (2026-09-27: one more level of zoom-out was needed); now there are two.
const K = 0.17 / ext
const toLngLat = (u, v) => {
  const X = 0.5 + u * K, Y = 0.5 - v * K
  const lng = (X - 0.5) * 360
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180 / Math.PI
  return [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]
}

// ── emit nodes + edges ─────────────────────────────────────────────────────────────────────────────
const LV = { family: 'f', language: 'l', dialect: 'd' }
const nodes = []
function emit(n, root, parentId, isRoot) {
  const x = root._cx + n._r * Math.cos(n._a), y = root._cy + n._r * Math.sin(n._a)
  const lv = isRoot && n.level === 'family' ? 'f' : n.level === 'family' ? 'b' : LV[n.level] || 'b'
  const node = { id: n.id, n: n.name, lv, p: parentId || '', c: toLngLat(x, y) }
  if (n.iso) node.iso = n.iso
  if (n.via) node.via = n.via
  if (lv === 'l' || (lv === 'd' && n.iso && groupsBy.has(n.iso))) node.st = statusOf(n.iso)
  if (n.iso && groupsBy.has(n.iso)) node.g = groupsBy.get(n.iso)
  if (lv === 'f' || isRoot) { node.R = Math.round(root._R * K * 1e6) / 1e6; node.pR = Math.round(root._pR * 1e5) / 1e5 }
  if (n._pu) node.pc = [Math.round(n._pu[0] * 1e5) / 1e5, Math.round(n._pu[1] * 1e5) / 1e5]   // dialects: none
  nodes.push(node)
  // Edges are NOT written: every node carries its parent id and both coordinates, so the board draws
  // each parent->child line itself (4,300 lines in one GeoJSON source). It halves the file.
  for (const k of n.kids) emit(k, root, n.id, false)
}
for (const root of roots) emit(root, root, '', true)

// dialects inherit their language's colour (never their own evidence)
const byId = new Map(nodes.map((n) => [n.id, n]))
for (const n of nodes) {
  if (n.lv !== 'd' || n.st) continue
  let p = byId.get(n.p)
  while (p && !p.st) p = byId.get(p.p)
  if (p && p.st) { n.st = p.st; n.inh = 1 }
}

// ── coverage and the resources table ───────────────────────────────────────────────────────────────
const onTree = new Set(nodes.filter((n) => n.iso).map((n) => n.iso))
const missingLangs = [...groupsBy.keys()].filter((i) => !onTree.has(i))
if (missingLangs.length) fail(`${missingLangs.length} roster languages missing from the tree: ${missingLangs.slice(0, 5).join(', ')}`)
const st = nodes.filter((n) => n.lv === 'l' || (n.lv === 'd' && n.iso && n.g)).reduce((m, n) => { m[n.st] = (m[n.st] || 0) + 1; return m }, {})
const levels = nodes.reduce((m, n) => { m[n.lv] = (m[n.lv] || 0) + 1; return m }, {})

const ours = new Set(groupsBy.keys())
const resources = links.filter((r) => ours.has(r.iso639_3)).map((r) => ({
  iso: r.iso639_3, language: r.language, resource: r.resource, type: r.type, scope: r.scope || '', source: r.source, url: r.resource_url,
}))

const treeDoc = {
  meta: {
    title: 'Language tree — every family our people groups belong to, coloured by what the gospel sources hold',
    generated_by: 'plugin-designs/gospel-internet/scripts/build-language-tree.mjs',
    source: glotto.source, citation: glotto.citation, licence: glotto.licence, url: glotto.url, fetched: glotto.fetched,
    newick_note: 'Glottolog publishes every subtree in Newick (text/newick), the standard text format for trees; this file is its drawing, with the classification path kept as parent links.',
    colours: {
      g: 'a New Testament or full Bible found in the language (eBible nt/full, or a resource scoped New Testament / Full Bible / 27 or 66 parts: FCBH, Scripture Earth, PNG.Bible, Door43)',
      y: 'something found in the language (film, audio, stories, portions) but no New Testament',
      r: 'nothing found in the language in the sources checked; never a claim that nothing exists',
      parent: 'a family or branch shows the WORST colour inside it, with counts, so the gap is what the eye finds',
      dialect: 'every source catalogues by LANGUAGE (ISO 639-3), never by dialect: a dialect carries its language\'s colour (inh:1) and is drawn lighter',
    },
    collapsed: 'chains of single-child branches are drawn as one link; the skipped names are in `via`',
    coverage: { nodes: nodes.length, levels, language_status: st, not_in_glottolog: glotto.not_in_glottolog.length, families: roots.length },
  },
  nodes,
}
const resDoc = {
  meta: { title: 'Gospel resources for the languages on the board', source: 'gospel-resource-links.json: every link already screened', rows: resources.length },
  rows: resources,
}

if (failures.length) {
  for (const f of failures.slice(0, 30)) console.error('FAIL ' + f)
  console.error(`FAIL build-language-tree: ${failures.length}; nothing written`)
  process.exitCode = 1
} else {
  const outs = [
    ['gospel-internet-tree.json', JSON.stringify(treeDoc) + '\n'],
    ['gospel-internet-resources.json', JSON.stringify(resDoc) + '\n'],
  ]
  let stale = false
  for (const [f, body] of outs) for (const dir of ['data/tables', 'public/dx-maps/assets/tables']) {
    const p = resolve(REPO, dir, f)
    if (CHECK) { try { if (readFileSync(p, 'utf8') !== body) stale = true } catch { stale = true } }
    else writeFileSync(p, body)
  }
  if (CHECK) { console.log(stale ? 'FAIL language tree is stale: re-run the builder' : 'ok language tree is current'); if (stale) process.exitCode = 1 }
  else console.log('ok wrote gospel-internet-tree.json + gospel-internet-resources.json')
  console.log(JSON.stringify(treeDoc.meta.coverage), 'resources', resources.length)
}
