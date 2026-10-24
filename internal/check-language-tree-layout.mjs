#!/usr/bin/env node
/**
 * check-language-tree-layout — the library language-tree layout, asserted headlessly.
 *
 * WHAT THIS PROTECTS. library/scripts/build-language-tree.mjs computes, at BUILD time, the drawing a
 * fork's whole language tree is made of: every family a roster belongs to, radially laid out and packed
 * into one non-overlapping tapestry, projected to lng/lat so a map engine draws it undistorted. Nobody
 * proofreads 4,000 node positions. Every failure here is silent and looks like a design choice:
 * overlapping families read as a messy drawing, a dropped roster language reads as a shorter list, and a
 * tapestry that outgrows its share of the Mercator square just means the reader cannot zoom out as far.
 *
 * ★ THE GEOMETRY IS ASSERTED AS INVARIANTS, NOT AS A GOLDEN FILE. A snapshot of 4,000 coordinates fails
 * on every legitimate change and tells you nothing about which property broke. These check the things
 * that must be true of ANY correct layout: circles do not overlap, every roster language is reachable,
 * the drawing stays inside its budget, the poster layout excludes dialects, and the same input gives the
 * same output twice.
 *
 * ★ AND THE STATUS IS ASSERTED TO BE OPAQUE. The whole reason the layout is in library/ and gospel's
 * eBible/FCBH classification is not: a fork substitutes one function. A test that only ever passes 'g'
 * would not notice library growing an opinion about what the letters mean.
 *
 * Headless, no browser, no network. Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { buildLanguageTree } = await import(resolve(ROOT, 'library/scripts/build-language-tree.mjs'))

const fails = []
const ok = (what, cond, detail = '') => { if (!cond) fails.push(`${what}${detail ? `\n      ${detail}` : ''}`) }

// Three families of different shapes: a deep one, a broad one, and a single-language isolate — the
// isolate matters because a one-node tree is the case a radial layout most easily divides by zero on.
const languoids = [
  { id: 'fam-a', name: 'Alpha', level: 'family', iso: '', parent: '' },
  { id: 'br-a1', name: 'A-One', level: 'family', iso: '', parent: 'fam-a' },
  { id: 'lg-a1', name: 'Aa', level: 'language', iso: 'aaa', parent: 'br-a1' },
  { id: 'lg-a2', name: 'Ab', level: 'language', iso: 'aab', parent: 'br-a1' },
  { id: 'dl-a1', name: 'Aa-north', level: 'dialect', iso: 'aac', parent: 'lg-a1' },
  { id: 'fam-b', name: 'Beta', level: 'family', iso: '', parent: '' },
  { id: 'lg-b1', name: 'Ba', level: 'language', iso: 'bba', parent: 'fam-b' },
  { id: 'lg-b2', name: 'Bb', level: 'language', iso: 'bbb', parent: 'fam-b' },
  { id: 'lg-b3', name: 'Bc', level: 'language', iso: 'bbc', parent: 'fam-b' },
  { id: 'fam-c', name: 'Gamma', level: 'family', iso: 'ccc', parent: '' },
]
const roster = new Map([['aaa', ['g1']], ['aab', ['g2']], ['bba', ['g3']], ['ccc', ['g4']], ['aac', ['g5']]])
const build = (over = {}) => buildLanguageTree({ languoids, roster, statusOf: () => 'g', ...over })

const out = build()
ok('every node carries an id, a level and a coordinate pair',
  out.nodes.every((n) => n.id && n.lv && Array.isArray(n.c) && n.c.length === 2 && n.c.every(Number.isFinite)))
ok('every roster language reaches the tree', roster.size === out.nodes.filter((n) => n.iso && roster.has(n.iso)).length,
  `roster ${roster.size}, on the tree ${out.nodes.filter((n) => n.iso && roster.has(n.iso)).length}`)
ok('a roster language absent from the snapshot WARNS rather than vanishing',
  build({ roster: new Map([...roster, ['zzz', ['g9']]]) }).warnings.some((w) => /zzz/.test(w)))
ok('a languoid whose parent is outside the snapshot warns',
  buildLanguageTree({ languoids: [...languoids, { id: 'orphan', name: 'Orphan', level: 'language', iso: 'ooo', parent: 'nope' }], roster })
    .warnings.some((w) => /orphan/.test(w)))

// ── THE PACKING INVARIANT: family circles must not overlap. This is the one a reader sees instantly
// and nobody can check by eye across 300 families.
const fams = out.nodes.filter((n) => n.R !== undefined)
let worst = null
for (let i = 0; i < fams.length; i++) {
  for (let j = i + 1; j < fams.length; j++) {
    const [ax, ay] = fams[i].c, [bx, by] = fams[j].c
    const gap = Math.hypot(ax - bx, ay - by) - (fams[i].R + fams[j].R)
    if (worst === null || gap < worst.gap) worst = { gap, a: fams[i].id, b: fams[j].id }
  }
}
ok('family circles do not overlap', !worst || worst.gap >= 0, worst ? `closest pair ${worst.a}/${worst.b} gap ${worst.gap.toFixed(4)}` : '')

// ── THE ZOOM BUDGET. The drawing's share of the Mercator square is what decides how far a reader can
// zoom OUT below the opening view; it is a parameter precisely so a consumer can trade that off.
const lngSpan = (nodes) => { const xs = nodes.map((n) => n.c[0]); return Math.max(...xs) - Math.min(...xs) }
ok('the tapestry stays inside its extent budget', lngSpan(out.nodes) <= 0.17 * 360 + 1e-6,
  `spans ${lngSpan(out.nodes).toFixed(2)}° of 360°`)
ok('a smaller extentFraction really does draw smaller',
  lngSpan(build({ extentFraction: 0.08 }).nodes) < lngSpan(out.nodes))

// ── THE POSTER LAYOUT is a second, separate layout, and its whole reason is that a sheet cannot zoom.
const dialects = out.nodes.filter((n) => n.lv === 'd')
ok('dialects exist on screen', dialects.length > 0)
ok('...and get NO poster slot, so language names are not squeezed off the sheet',
  dialects.every((n) => n.pc === undefined))
ok('languages DO get a poster slot', out.nodes.filter((n) => n.lv === 'l').every((n) => Array.isArray(n.pc)))

// ── STATUS IS OPAQUE. library must carry the letter without knowing what it means.
ok('an arbitrary status string is carried through, not normalised',
  build({ statusOf: () => 'whatever-a-fork-calls-it' }).nodes.some((n) => n.st === 'whatever-a-fork-calls-it'))
ok('status is written on leaves only — a parent rollup is the CHART\'s runtime job, against the reader\'s scope',
  build().nodes.filter((n) => n.lv === 'f' || n.lv === 'b').every((n) => n.st === undefined))
ok('no statusOf at all is legal and simply omits st',
  buildLanguageTree({ languoids, roster }).nodes.every((n) => n.st === undefined))

// ── DETERMINISM. A build-time artifact that differs run to run makes every diff unreadable.
ok('the same input builds the same tree twice', JSON.stringify(build().nodes) === JSON.stringify(build().nodes))

if (fails.length) {
  console.error('LANGUAGE-TREE-LAYOUT: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`LANGUAGE-TREE-LAYOUT: PASS — ${out.nodes.length} nodes, families packed without overlap, every roster language reachable, the poster layout drops dialects, and the status letter stays opaque to library.`)
