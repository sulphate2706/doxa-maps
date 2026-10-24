#!/usr/bin/env node
/**
 * check-gospel-set-charts.mjs — the bounded-set and centered-set LAYOUT maths.
 *
 * Both modules are pure, which is why they can be checked here at all: a pure function's
 * inputs ARE its domain, so these assertions are evidence about the real module and not
 * about a fixture that resembles one. What they are NOT evidence about is the shape of
 * near-neighbors.json — that binding is checked where the data is read, not here.
 *
 * The properties worth pinning are the ones where a wrong answer still LOOKS like a chart:
 *
 *  · bounded set — nothing may sit ON the boundary. A dot on the line is the one thing a
 *    bounded set cannot express, and it would read as a group that is somehow both.
 *  · bounded set — a group of UNKNOWN reached-ness is its own outcome. If it were folded
 *    into `outside`, a join failure would render as "unreached" and inflate the count with
 *    something that is not a fact about the group.
 *  · centered set — a group with no ring is UNPLACED, never defaulted to the outer ring.
 *    Ring 10 is a real answer ("beyond"), so it must not double as a bin for missing data.
 *  · centered set — a REACHED group (ring 0) is the CENTRE, not unplaced. An earlier build
 *    spelled "reached" and "no relation found" with the same 0; treating that value as
 *    missing data would report the best outcome in the set as an absence. The three states
 *    are asserted apart, and a reached group is asserted to reach NO ring at all.
 *  · centered set — the arrow stops exactly at innerR. An arrow that overshoots covers the
 *    cross it is meant to point at.
 *  · both — layout is deterministic, so a group does not move between renders.
 */
import { layoutBoundedSet, boundedSetTally } from '../library/components/charts/boundedSet.js'
import { layoutCenteredSet, ringTally, inwardArrow, ringRadii, RING_MAX, RING_REACHED, RING_NO_RELATION } from '../library/components/charts/centeredSet.js'

const fail = []
const ok = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail.push(label) }
}

console.log('GOSPEL-SET-CHARTS')

// ── bounded set ─────────────────────────────────────────────────────────────
const bg = [{ id: 'a', reached: true }, { id: 'b', reached: false }, { id: 'c' }, { id: 'd', reached: null }]
const B = layoutBoundedSet(bg, { r: 100 })
const bt = boundedSetTally(B)
ok('bounded: reached inside, unreached outside, unknown neither', bt.inside === 1 && bt.outside === 1 && bt.unknown === 2,
  `in ${bt.inside} out ${bt.outside} unknown ${bt.unknown}`)
ok('bounded: unknown is NOT folded into outside', bt.outside === 1 && bt.unknown === 2)
ok('bounded: total is conserved', bt.total === bg.length)
const dist = (p) => Math.hypot(p.x, p.y)
ok('bounded: nothing sits ON the boundary', dist(B.inside[0]) < 100 && dist(B.outside[0]) > 100,
  `in r=${dist(B.inside[0]).toFixed(1)} out r=${dist(B.outside[0]).toFixed(1)}`)
ok('bounded: deterministic between renders', layoutBoundedSet(bg, { r: 100 }).inside[0].x === B.inside[0].x)

// ── centered set ────────────────────────────────────────────────────────────
const cg = [{ id: 'a', ring: 1, neighborId: 'r1' }, { id: 'b', ring: RING_MAX, neighborId: 'r2' },
  { id: 'c', ring: RING_REACHED }, { id: 'd' }, { id: 'e', ring: RING_MAX + 1 }, { id: 'f', ring: 5 }]
const C = layoutCenteredSet(cg)
const ct = ringTally(C)
ok('centered: valid rings placed, unusable ones unplaced, reached at the centre',
  ct.placed === 3 && ct.unplaced === 2 && ct.centre === 1,
  `placed ${ct.placed} centre ${ct.centre} unplaced ${ct.unplaced}`)
ok('centered: a missing ring is NOT defaulted onto the outer ring',
  C.placed.filter((p) => p.ring === RING_MAX).length === 1)
ok('centered: every unplaced group carries a reason', C.unplaced.every((u) => typeof u.reason === 'string' && u.reason))
ok('centered: rings are ordered inward to outward', ringRadii().length === RING_MAX &&
  C.placed.find((p) => p.ring === 1).r < C.placed.find((p) => p.ring === RING_MAX).r)
const p1 = C.placed.find((p) => p.ring === 1)
ok('centered: a point lies exactly on its own ring', Math.abs(Math.hypot(p1.x, p1.y) - p1.r) < 1e-9)
const arrow = inwardArrow(C.placed.find((p) => p.ring === RING_MAX))
ok('centered: the inward arrow stops at innerR and does not cover the cross',
  arrow && Math.abs(Math.hypot(arrow.x2, arrow.y2) - 26) < 1e-9, `ends at r=${Math.hypot(arrow.x2, arrow.y2).toFixed(2)}`)
ok('centered: no recorded neighbour means NO arrow, not a guessed one', inwardArrow({ x: 10, y: 0 }) === null)
ok('centered: deterministic between renders', layoutCenteredSet(cg).placed[0].x === C.placed[0].x)

// the three ring states are three different facts and must not collapse into one another
const sg = [{ id: 'p', ring: 1, neighborId: 'r' }, { id: 'reached', ring: RING_REACHED },
  { id: 'norel', ring: RING_NO_RELATION }, { id: 'noring' }]
const S = layoutCenteredSet(sg)
const st = ringTally(S)
ok('centered: reached (ring 0) is the CENTRE, not unplaced', st.centre === 1 && S.centre[0].id === 'reached')
ok('centered: no-relation (ring -1) is unplaced with its OWN reason',
  S.unplaced.find((u) => u.id === 'norel')?.reason === 'no relation found')
ok('centered: the three states stay apart', st.placed === 1 && st.centre === 1 && st.unplaced === 2,
  `placed ${st.placed} centre ${st.centre} unplaced ${st.unplaced}`)
ok('centered: a reached group reaches NO ring', [...st.counts.values()].reduce((a, b) => a + b, 0) === st.placed)


// ── the two LIBRARY components promoted from gospel-internet ────────────────────────────────────
// The layouts above are pure and already pinned. These arms guard the two ways a COMPONENT can
// undo them, both named by gospel when they handed the modules over.
const { readFileSync: rf } = await import('node:fs')
const { fileURLToPath: f2u } = await import('node:url')
const { dirname: dn, join: jn } = await import('node:path')
// ⚠ THE SEED ARM MUST READ WHAT SHIPS. It used to read library/components/charts/BoundedSet.vue and
// CenteredSetTarget.vue — two files NOTHING RENDERS. The guarantee was therefore asserted against
// dead code: a `seed` prop could appear in the components that actually draw the sets and this gate
// would stay green. regions found it while removing the dead library components (their import census
// could not see the reference, because a FILENAME IN A GATE is not an import), and retargeting is
// what makes the assertion true of the artefact rather than merely true.
const ROOT = jn(dn(f2u(import.meta.url)), '..')
const GI = jn(ROOT, 'plugin-designs', 'gospel-internet', 'src', 'components')
const { parse: parseSfc2 } = await import('@vue/compiler-sfc')
const { parse: parseJs2 } = await import('@babel/parser')
const propKeys = (file) => {
  const sfc = parseSfc2(rf(jn(GI, file), 'utf8'))
  const ast = parseJs2((sfc.descriptor.scriptSetup || sfc.descriptor.script).content, { sourceType: 'module' })
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'CallExpression' && n.callee?.name === 'defineProps' && n.arguments[0]?.type === 'ObjectExpression') {
      for (const pr of n.arguments[0].properties) out.push(pr.key?.name || pr.key?.value)
    }
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v)
    }
  }
  walk(ast.program)
  return out
}

// ★ NO `seed` PROP. Position is hashed from the group's own id, so a group lands in the same place
// on every render, in every process, forever — two printings of one packet are identical and a
// reader comparing sheets sees real movement rather than reshuffling. A seed would silently
// rescramble every dot while the data was unchanged, which on a printed artefact is unrecoverable.
// I specced one; gospel caught it before a line was written.
// The prop-bearing pair is the two whiteboard MAPS. Their parents (GiBoundedSet/GiCenteredSet) take
// no props at all — they read useBoardState() — so a seed could only ever arrive here, which is why
// these are the files the arm reads.
for (const f of ['GiBoundedSetMap.vue', 'GiCenteredSetMap.vue']) {
  const keys = propKeys(f)
  ok(`${f}: no seed prop — identity IS the seed`, keys.length > 0 && !keys.includes('seed'), keys.join(','))
}
// NEG CONTROL: the parser really does see props, so the arm above is not vacuous.
ok('the prop reader is not vacuous', propKeys('GiBoundedSetMap.vue').includes('groups'))

// ★ EVERY RING IS REPORTED, INCLUDING EMPTY ONES. Under a filter several of the nine legitimately
// go to zero, and a decoder that omits its empty rows stops being a decoder: a reader cannot tell
// "no groups here" from "this ring does not exist". Presence by identity, never by count.
const emptyTally = ringTally(layoutCenteredSet([], {}))
ok('centered: every ring is listed even when ALL are empty',
  emptyTally.counts.size === RING_MAX && [...emptyTally.counts.values()].every((v) => v === 0),
  `${emptyTally.counts.size} ring(s)`)
const oneRing = ringTally(layoutCenteredSet([{ id: 'a', ring: 3, neighborId: 'n' }], {}))
ok('centered: and a filter that empties eight of them still lists all ten',
  oneRing.counts.size === RING_MAX && oneRing.counts.get(3) === 1 && oneRing.counts.get(7) === 0)

// ★ AN ARROW IS A CLAIM ABOUT A RELATIONSHIP, so an unknown neighbour gets NO arrow, never a
// default one pointing at the centre.
const noNb = layoutCenteredSet([{ id: 'x', ring: 4 }], {})
ok('centered: a placed group with no recorded neighbour yields NO arrow',
  noNb.placed.length === 1 && inwardArrow(noNb.placed[0], {}) === null)



// ★ CENTERED CONSERVATION, which the bounded half already asserts and this half did not.
// The three states are pinned as SEPARATE above, but separateness is not completeness: a group with
// a ring nobody anticipated could fall out of all three and simply not exist on the page. That is
// the failure that looks like a smaller dataset rather than an error — an empty chart gets noticed,
// a chart quietly missing eleven groups does not. Checked with the awkward values on purpose:
// out-of-range high and low, missing, fractional, and a numeric STRING.
const odd = [
  { id: 'hi', ring: 99 }, { id: 'lo', ring: -5 }, { id: 'centre', ring: 0 },
  { id: 'norel', ring: -1 }, { id: 'none' }, { id: 'str', ring: '3' }, { id: 'frac', ring: 3.5 },
]
const oddL = layoutCenteredSet(odd, {})
const accounted = oddL.placed.length + oddL.centre.length + oddL.unplaced.length
ok('centered: total is conserved — no ring value makes a group vanish',
  accounted === odd.length, `${accounted} of ${odd.length}`)
ok('centered: an out-of-range ring is UNPLACED, never clamped into ring 1 or 10',
  oddL.unplaced.some((p) => p.id === 'hi') && oddL.unplaced.some((p) => p.id === 'lo') &&
  !oddL.placed.some((p) => p.id === 'hi' || p.id === 'lo'))
ok('centered: a fractional ring is unplaced rather than rounded onto a neighbour',
  oddL.unplaced.some((p) => p.id === 'frac'))
// NEG CONTROL: the conservation arm can fail, so it is not counting a constant.
ok('NEG CONTROL: dropping one group from the input drops the accounted total',
  (() => { const l = layoutCenteredSet(odd.slice(1), {}); return l.placed.length + l.centre.length + l.unplaced.length === odd.length - 1 })())


if (fail.length) {
  console.log(`\nGOSPEL-SET-CHARTS: FAIL — ${fail.length}: ${fail.join(', ')}`)
  process.exit(1)
}
console.log('\nGOSPEL-SET-CHARTS: PASS — both layouts pinned on the properties that fail silently')
