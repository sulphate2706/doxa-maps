#!/usr/bin/env node
/**
 * check-ring-bands.mjs — the ring band layout keeps the promises the ring target rests on.
 *
 * Four properties, each of which fails SILENTLY if it breaks — the drawing still renders, it is
 * just wrong, and nobody can tell by looking at one sheet:
 *   1. every pin sits inside its own ring's band (not on the old single circle, not in the gap)
 *   2. no two pins on a ring are closer than minSep
 *   3. no pin sits inside a ring label's keep-out arc
 *   4. the same input twice gives byte-identical output
 *
 * Every arm has a NEGATIVE CONTROL: a deliberately broken input that must fail it. An assertion
 * that cannot fail is not evidence, and three of the bugs this module exists to prevent were
 * originally found only because a check was made to fail on purpose first.
 */
import { bandFill, curvedRingLabels, inBand, inArc, hash01 } from '../library/components/charts/ringBands.js'
import { ringRadii, RING_MAX } from '../library/components/charts/centeredSet.js'

const pass = []
const fail = []
const ok = (label, cond, detail = '') => (cond ? pass : fail).push(detail ? `${label} — ${detail}` : label)

const RING_GAP = 24
const radii = ringRadii({ innerR: 26, ringGap: RING_GAP })
const labels = curvedRingLabels(radii, (r) => `Ring ${r} — same language family`, { ringGap: RING_GAP })

/** A reproducible population: n groups spread across the rings. */
const makeItems = (n, tag = 'g') =>
  Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, ring: (i % RING_MAX) + 1 }))

const items = makeItems(120)
const out = bandFill(items, radii, { ringGap: RING_GAP, labels })

// ── 1. every pin inside its band ────────────────────────────────────────────────────────────────
const strays = out.placed.filter((p) => !inBand(p, radii, { ringGap: RING_GAP }))
ok('every pin sits inside its own ring band', strays.length === 0, `${strays.length} outside`)

// NEG CONTROL: a pin pushed out of its band must be caught, or arm 1 proves nothing.
const moved = { ...out.placed[0], r: out.placed[0].r + RING_GAP }
ok('NEG CONTROL: a pin moved a full ringGap is detected as outside', !inBand(moved, radii, { ringGap: RING_GAP }))

// ── 2. pins on a ring are at least minSep apart ─────────────────────────────────────────────────
// Measured along the arc at each pin's own radius, which is how a reader sees the gap.
const tooClose = []
const byRing = new Map()
for (const p of out.placed) {
  if (!byRing.has(p.ring)) byRing.set(p.ring, [])
  byRing.get(p.ring).push(p)
}
for (const [ring, ps] of byRing) {
  const sorted = [...ps].sort((a, b) => a.angle - b.angle)
  for (let i = 1; i < sorted.length; i++) {
    const dx = sorted[i].x - sorted[i - 1].x
    const dy = sorted[i].y - sorted[i - 1].y
    const d = Math.hypot(dx, dy)
    // Two pins may be close in ANGLE and far apart in radius — that is the band doing its job — so
    // the test is euclidean distance, not angular distance.
    if (d < Math.min(out.minSep, 2 * sorted[i].pin) - 1e-9) tooClose.push({ ring, d: d.toFixed(2) })
  }
}
ok('no two pins on a ring are closer than the pin diameter', tooClose.length === 0, `${tooClose.length} pair(s)`)

// NEG CONTROL: at an absurd minSep the ring cannot hold its items, so the module must REPORT
// unplaced rather than quietly overlapping them.
const crowded = bandFill(makeItems(400), radii, { ringGap: RING_GAP, labels, minSep: 60 })
ok(
  'NEG CONTROL: an impossible minSep reports unplaced rather than overlapping',
  crowded.unplaced.length > 0 && crowded.unplaced.every((u) => /full at the pin floor/.test(u.reason)),
  `${crowded.unplaced.length} reported`,
)

// And it must SHRINK before it reports: a visible pin beats an unplaced one.
// ★ 2000, NOT 200 — and the change of number is itself the record of a bug. This arm used 200,
// which crowded a ring only while capacity was counted as a SINGLE row of pins. Once capacity was
// counted over the rows a band's depth actually allows (the real fix), 200 groups fit at full size
// and nothing shrank, so the arm failed while the module was working better than before. The
// shipped table carries 7,296 placeable groups, so the honest pressure to test at is thousands.
const tight = bandFill(makeItems(2000), radii, { ringGap: RING_GAP, labels })
ok(
  'a crowded ring shrinks its pins before reporting anything unplaced',
  tight.rings.some((r) => r.shrunk) && tight.rings.every((r) => r.pin >= 2.6 - 1e-9),
  `min pin ${Math.min(...tight.rings.map((r) => r.pin)).toFixed(2)}, ${tight.rings.filter((r) => r.shrunk).length} ring(s) shrank`,
)

// ★ THE REAL TABLE'S SHAPE, because a uniform sample hid a 4.7x undercount. The shipped
// near-neighbours table is heavily skewed — ring 8 carries 1,932 groups and ring 5 carries 100 —
// and against a single-row capacity model bandFill placed 962 of 7,296, dropping 87% of the map
// with every drop faithfully reported. No assertion here caught it, because they all asked "is the
// overflow reported?" and none asked "is the capacity RIGHT?". This one does.
const skewed = [
  ...Array.from({ length: 1190 }, (_, i) => ({ id: `r1-${i}`, ring: 1 })),
  ...Array.from({ length: 1932 }, (_, i) => ({ id: `r8-${i}`, ring: 8 })),
  ...Array.from({ length: 100 }, (_, i) => ({ id: `r5-${i}`, ring: 5 })),
]
const real = bandFill(skewed, radii, { ringGap: RING_GAP, labels })
const r8 = real.rings.find((r) => r.ring === 8)
const r5 = real.rings.find((r) => r.ring === 5)
// Asserted as a RATIO against the single-row count this band would give, not a magic number: the
// first version of this arm hardcoded ">400", which came from the component's ringGap of 22 while
// the gate builds its radii at 24. The code was right and the threshold was guessed. A ratio stays
// true when the geometry changes, which is the only way this arm keeps meaning something.
const singleRowCapacity = (() => {
  const half = (RING_GAP / 2) * (1 - 0.16)
  const base = radii.find((x) => x.ring === 8).r
  const sep = Math.max(7, 2 * 3.4)
  const label = labels.find((l) => l.ring === 8)
  const usable = Math.PI * 2 - Math.min(label.keepOut.span, Math.PI * 2)
  return Math.floor((usable * (base - half)) / sep)
})()
ok(
  'a band counts the concentric rows its depth allows, not one circle of pins',
  r8.capacity > singleRowCapacity * 1.5,
  `ring 8 capacity ${r8.capacity} vs ${singleRowCapacity} for a single row (${(r8.capacity / singleRowCapacity).toFixed(2)}x)`,
)
ok(
  'a ring that is not over-full places everything, even when a sibling ring overflows',
  r5.fitted === 100 && r5.wanted === 100,
  `ring 5 ${r5.fitted}/${r5.wanted}`,
)

// ── 3. no pin inside a label's keep-out arc ─────────────────────────────────────────────────────
const inLabel = out.placed.filter((p) => {
  const l = labels.find((x) => x.ring === p.ring)
  return l && inArc(p.angle, l.keepOut.start, l.keepOut.span)
})
ok('no pin sits inside a ring label keep-out arc', inLabel.length === 0, `${inLabel.length} overlapping`)

// NEG CONTROL: the arc test must actually detect a point inside it — including the WRAPPING case,
// where a naive start<=a<=end comparison is wrong for exactly one label position.
const wrapStart = 6.0 // radians, so start+span crosses 0
ok('NEG CONTROL: inArc detects a point inside a wrapping arc', inArc(0.1, wrapStart, 0.6))
ok('NEG CONTROL: inArc rejects a point outside a wrapping arc', !inArc(3.0, wrapStart, 0.6))

// ── 4. determinism ──────────────────────────────────────────────────────────────────────────────
const again = bandFill(makeItems(120), radii, { ringGap: RING_GAP, labels })
ok(
  'the same input twice gives byte-identical output',
  JSON.stringify(again.placed) === JSON.stringify(out.placed),
  'two runs agree',
)
// Order of the INPUT must not change the output either: a caller that filters or re-sorts its rows
// must not move every dot on the chart.
const shuffled = bandFill([...items].reverse(), radii, { ringGap: RING_GAP, labels })
const key = (ps) => JSON.stringify([...ps].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((p) => [p.id, p.x.toFixed(9), p.y.toFixed(9)]))
ok('input order does not change any position', key(shuffled.placed) === key(out.placed))

// NEG CONTROL: the hash really does vary per id, or "deterministic" would be trivially true because
// everything landed in the same place.
ok('NEG CONTROL: hash01 separates ids', hash01('a') !== hash01('b') && hash01('a') === hash01('a'))

// ── no label may starve its own ring ────────────────────────────────────────────────────────────
// ★ THIS ARM EXISTS BECAUSE THE GATE ONCE PASSED THE BUG. Uncapped, a long name on ring 1 claimed
// 5.65 rad — 96% of that small circle — so capacity was ZERO, all 12 groups were reported unplaced,
// and the innermost ring drew empty. Every other arm was green: the items WERE reported rather than
// silently dropped, which is what they assert. "Reported, not dropped" is not the same promise as
// "the ring draws". A long label now truncates instead of eating its circle.
const longLabels = curvedRingLabels(radii, () => 'A very much longer ring label indeed', { ringGap: RING_GAP })
const starved = bandFill(makeItems(120), radii, { ringGap: RING_GAP, labels: longLabels })
ok(
  'a long label never starves its ring: every ring still places something',
  starved.rings.every((r) => r.fitted > 0),
  `empty rings: ${starved.rings.filter((r) => r.fitted === 0).map((r) => r.ring).join(',') || 'none'}`,
)
ok(
  'no label takes more than its share of its own circle',
  longLabels.every((l) => l.keepOut.span <= Math.PI * 2 * 0.45 + 2 * 0.18 + 1e-9),
  `max ${(Math.max(...longLabels.map((l) => l.keepOut.span)) / (Math.PI * 2) * 100).toFixed(0)}%`,
)
ok(
  'a truncated label says so, and says how many characters fit',
  longLabels[0].truncated === true && longLabels[0].fitChars > 0 && longLabels[0].fitChars < 36,
  `ring 1 fits ${longLabels[0].fitChars} chars`,
)

// ── mode: 'fill-all' places everything and lets the zoom separate it ────────────────────────────
// Rings that zoom apart: separation is in MAP units, so it grows with zoom. Sized on the real
// table, the worst ring separates to 8px on screen at z=4.45 and the GROUP label tier starts at 5.2,
// so every pin is clickable before the names appear. DEFAULT IS STILL 'fit' — these arms prove the
// flag works, not that the chart has adopted it.
const dense = [
  ...Array.from({ length: 1932 }, (_, i) => ({ id: `d8-${i}`, ring: 8 })),
  ...Array.from({ length: 1190 }, (_, i) => ({ id: `d1-${i}`, ring: 1 })),
]
const fitMode = bandFill(dense, radii, { ringGap: RING_GAP, labels })
const fillMode = bandFill(dense, radii, { ringGap: RING_GAP, labels, mode: 'fill-all' })
ok(
  "'fit' is the default, so the flag changes nothing until it is asked for",
  fitMode.unplaced.length > 0 && fitMode.placed.length < dense.length,
  `default dropped ${fitMode.unplaced.length}`,
)
ok(
  "'fill-all' places every group and reports nothing unplaced",
  fillMode.placed.length === dense.length && fillMode.unplaced.length === 0,
  `${fillMode.placed.length}/${dense.length}`,
)
ok(
  "'fill-all' still keeps every pin inside its own band",
  fillMode.placed.every((p) => inBand(p, radii, { ringGap: RING_GAP })),
  'no pin escapes its ring',
)
ok(
  "'fill-all' still respects the label keep-out",
  fillMode.placed.every((p) => {
    const l = labels.find((x) => x.ring === p.ring)
    return !l || !inArc(p.angle, l.keepOut.start, l.keepOut.span)
  }),
  'no pin under a label',
)
// ★ THE DEFECT THIS MODE COULD REINTRODUCE. Taking every item while keeping the 'fit' row count
// would pack 1,932 pins into the two rows a band allows at full pin size — the single-line defect
// again, one level down. The row count must follow the POPULATION here, so a dense ring uses many
// more rows than a sparse one.
const rowsUsed = (o, ring) => new Set(o.placed.filter((p) => p.ring === ring).map((p) => p.row)).size
ok(
  "'fill-all' adds rows as the ring fills, rather than crowding a fixed few",
  rowsUsed(fillMode, 8) > rowsUsed(fitMode, 8),
  `ring 8 uses ${rowsUsed(fillMode, 8)} rows in fill-all vs ${rowsUsed(fitMode, 8)} in fit`,
)
ok(
  "'fill-all' is still deterministic",
  JSON.stringify(bandFill(dense, radii, { ringGap: RING_GAP, labels, mode: 'fill-all' }).placed) === JSON.stringify(fillMode.placed),
)

// ── the label geometry is derived, not guessed ──────────────────────────────────────────────────
const shortL = curvedRingLabels(radii, () => 'A', { ringGap: RING_GAP })
const longL = curvedRingLabels(radii, () => 'A much longer ring label', { ringGap: RING_GAP })
ok(
  'a longer label claims a wider keep-out arc',
  longL[0].keepOut.span > shortL[0].keepOut.span,
  `${longL[0].keepOut.span.toFixed(3)} > ${shortL[0].keepOut.span.toFixed(3)}`,
)
ok(
  'the same text needs a SMALLER arc on a larger ring',
  longL[RING_MAX - 1].span < longL[0].span,
  'arc length = r * angle',
)

for (const p of pass) console.log(`  ✓ ${p}`)
for (const f of fail) console.log(`  ✗ ${f}`)
if (fail.length) {
  console.log(`\nRING-BANDS: FAIL — ${fail.length} of ${pass.length + fail.length}`)
  process.exit(1)
}
console.log(`\nRING-BANDS: PASS — ${pass.length} assertions, every arm with a negative control`)
