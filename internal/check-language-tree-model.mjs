#!/usr/bin/env node
/**
 * check-language-tree-model — the hierarchical half of the language tree, tested without a browser.
 *
 * The chart's drawing is a whiteboard of tiered points and is proven by check:tiered-points against a
 * NON-tree fixture. This covers what is left: the parent/child index, the edges, the descendants a
 * selection frames, and the colour rollup.
 *
 * ★ THE ROLLUP ASSERTION IS THE ONE THAT MATTERS. "A family shows the worst colour of the languages
 * below it" is only true relative to what the reader is CURRENTLY looking at: it is computed against
 * the filtered roster, not the whole subtree. A family that is red overall can be green inside the
 * reader's selection, and handing the rollup an unfiltered subtree makes the colours quietly disagree
 * with the board — no error, no blank, just a wrong fact about a real people group. So scope is
 * asserted in both directions: with a scope, and without one.
 *
 * Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const M = await import(resolve(ROOT, 'library/charts/whiteboard/language-tree-model.js'))

const fails = []
const ok = (what, cond, detail = '') => { if (!cond) fails.push(`${what}${detail ? `\n      ${detail}` : ''}`) }

//        fam (root)
//         ├── br1 ── lgA (g, iso aaa)
//         │      └── lgB (r, iso bbb)
//         └── lgC (y, iso ccc)
const NODES = [
  { id: 'fam', n: 'Family', lv: 'f', p: '', c: [0, 0], R: 5 },
  { id: 'br1', n: 'Branch', lv: 'b', p: 'fam', c: [1, 0] },
  { id: 'lgA', n: 'A', lv: 'l', p: 'br1', c: [2, 1], iso: 'aaa', st: 'g' },
  { id: 'lgB', n: 'B', lv: 'l', p: 'br1', c: [2, -1], iso: 'bbb', st: 'r' },
  { id: 'lgC', n: 'C', lv: 'l', p: 'fam', c: [-2, 0], iso: 'ccc', st: 'y' },
]
const ix = M.indexTree(NODES)

ok('every node is indexed', ix.byId.size === 5)
ok('the root is found by having no parent', JSON.stringify(ix.roots) === JSON.stringify(['fam']))
ok('children are collected under their parent', JSON.stringify(ix.kids.get('br1')) === JSON.stringify(['lgA', 'lgB']))
ok('a language is reachable from its ISO', ix.nodeOfIso.get('bbb') === 'lgB')

// ── framing a selection fits the SUBTREE, not the node ───────────────────────────────────────────
ok('a family frames all of its descendants', M.subtreeCoords(ix, 'fam').length === 5)
ok('a branch frames only its own', M.subtreeCoords(ix, 'br1').length === 3)
ok('a leaf frames itself — which is the single-point branch of frameTarget', M.subtreeCoords(ix, 'lgC').length === 1)
ok('an unknown id frames nothing rather than throwing', M.subtreeCoords(ix, 'nope').length === 0)
// A malformed index must not hang the board.
const cyclic = M.indexTree([{ id: 'a', p: 'b', c: [0, 0] }, { id: 'b', p: 'a', c: [1, 1] }])
ok('a cycle terminates instead of hanging', M.subtreeCoords(cyclic, 'a').length <= 2)

// ── the ONE hierarchical layer ───────────────────────────────────────────────────────────────────
const links = M.linkFC(ix)
ok('one edge per non-root node', links.features.length === 4)
ok('each edge runs parent -> child',
  links.features.every((f) => f.geometry.type === 'LineString' && f.geometry.coordinates.length === 2))
ok('the root has no edge', !links.features.some((f) => f.properties.id === 'fam'))

// ── ★ THE ROLLUP, IN SCOPE AND OUT ───────────────────────────────────────────────────────────────
ok('unscoped, a family is the WORST of everything below it', M.worstOfDescendants(ix, 'fam') === 'r')
ok('unscoped, a branch is the worst of ITS own', M.worstOfDescendants(ix, 'br1') === 'r')
// The reader filters to A and C: B (the red one) is no longer on the board, so the family is no longer red.
const scope = new Set(['aaa', 'ccc'])
ok('IN SCOPE, the family reflects only what the reader can see', M.worstOfDescendants(ix, 'fam', { inScope: scope }) === 'y',
  `got ${M.worstOfDescendants(ix, 'fam', { inScope: scope })}, expected y — the red language is filtered out`)
ok('...and a branch whose only in-scope child is green reads green',
  M.worstOfDescendants(ix, 'br1', { inScope: scope }) === 'g')
ok('a node with nothing in scope has no status rather than a wrong one',
  M.worstOfDescendants(ix, 'br1', { inScope: new Set(['ccc']) }) === undefined)
ok('a leaf is its own status', M.worstOfDescendants(ix, 'lgA') === 'g')

// ── the point collection carries what the whiteboard layer needs ─────────────────────────────────
const fc = M.nodeFC(ix, { colorFor: (n) => (n.st === 'r' ? '#b42318' : '#1f8f5f'), inScope: scope })
ok('every node becomes a point', fc.features.length === 5)
ok('tier comes from the node level', fc.features.find((f) => f.properties.id === 'lgA').properties.tier === 'l')
ok('the root is marked, so a dish can filter on it', fc.features.find((f) => f.properties.id === 'fam').properties.root === 1)
ok('out-of-scope nodes are MARKED, not dropped — they fade, never vanish',
  fc.features.find((f) => f.properties.id === 'lgB').properties.m === 0 && fc.features.length === 5)
ok('the caller\'s colour is applied per node',
  fc.features.find((f) => f.properties.id === 'lgB').properties.colour === '#b42318')

if (fails.length) {
  console.error('LANGUAGE-TREE-MODEL: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('LANGUAGE-TREE-MODEL: PASS — the index, the one edge layer, subtree framing, and a colour rollup that '
  + 'reflects the READER\'s scope rather than the whole subtree.')
