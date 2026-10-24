#!/usr/bin/env node
/**
 * check-circular-layout.mjs — gate for library/packet/circularLayout.js.
 *
 * Builds a FROZEN synthetic 855-pin India-scale fixture (sheet 2500x4000, the
 * classic4 60x96 constants) with a grid of fake ADM1 "states", then asserts:
 *
 *  fourSides  — numbersRingOrdered true, numberDupes 0, pinsOutsideState 0,
 *               >= 800 pins placed (no vacuous pass).
 *  pairedRows — 0 crossings on the clean set, pinsOutsideState 0, octilinear true.
 *  sideLanes  — runs, returns stats with a pin-count floor and octilinear leaders.
 *  determinism — two fourSides runs byte-identical.
 *  poison      — a state far too small for its pins is NAMED in infeasible
 *                (never silently stacked), surfaced via stats.infeasible > 0.
 *  budget      — fourSides on 855 pins runs under BUDGET_MS (1.5x a measured
 *                baseline) and under a heap ceiling. Median of 3, so it is not flaky.
 *
 * Node only, headless, deterministic. Exit 0 PASS / 1 FAIL / 75 import failure.
 */
let layoutCircular;
try { ({ layoutCircular } = await import('../circularLayout.js')); }
catch (e) { console.error(`NOT MEASURED: cannot import circularLayout.js — ${e.message}`); process.exit(75); }

const fails = [], note = [];

// Independent recounts — defined HERE, not imported from the module, so a broken
// counter in circularLayout.js cannot make its own stats agree with itself.
function gateInRing(px, py, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi) hit = !hit;
  }
  return hit;
}
function gateInState(px, py, parts) {
  for (const part of parts) {
    const [outer, ...holes] = part;
    if (!outer || outer.length < 3 || !gateInRing(px, py, outer)) continue;
    if (!holes.some((h) => h && h.length >= 3 && gateInRing(px, py, h))) return true;
  }
  return false;
}
// Recount, from the OUTPUT pins, how many sit outside their own state. Projects the
// fixture feats to px the same way the module does (box.proj), keyed by shapeName.
function recountOutside(outPins, feats) {
  const statesPx = {};
  for (const f of feats) {
    const sn = f.properties.shapeName;
    const ps = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const parts = ps.map((poly) => poly.map((ring) => ring.map(([lng, lat]) => box.proj(lng, lat))));
    (statesPx[sn] = statesPx[sn] || []).push(...parts);
  }
  let out = 0;
  for (const p of outPins) {
    const parts = statesPx[p.state];
    if (parts && !gateInState(p.x, p.y, parts)) out++;
  }
  return out;
}
function segCrossGate(p, q) {
  const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  const [a, b] = p, [c, d] = q;
  return o(a[0], a[1], b[0], b[1], c[0], c[1]) !== o(a[0], a[1], b[0], b[1], d[0], d[1]) &&
         o(c[0], c[1], d[0], d[1], a[0], a[1]) !== o(c[0], c[1], d[0], d[1], b[0], b[1]);
}

// ── 60x96 classic4 geometry (the 60x96c4b FORMATS entry: w2500 h4000 gutter165) ──
const PW = 2500, PH = 4000, PXI = PW / 60; // pageWidthIn 60
const SHEET_EDGE = 26, GUTTER = 165;
const HEADER = 355, FOOTER = 316;
const C4_BAND = Math.round(PH * 0.096);
const MAP_X = GUTTER, MAP_W = PW - 2 * GUTTER;
const MAP_Y = HEADER + C4_BAND, MAP_H = PH - HEADER - FOOTER - 2 * C4_BAND;
const FRAME_X = MAP_X, FRAME_Y = MAP_Y, FRAME_W = MAP_W, FRAME_H = MAP_H;

// A linear "projection" over an India-ish bbox (68..98 lng, 6..37 lat) into the map rect.
const LNG0 = 68, LNG1 = 98, LAT0 = 6, LAT1 = 37;
const proj = (lng, lat) => [
  MAP_X + ((lng - LNG0) / (LNG1 - LNG0)) * MAP_W,
  MAP_Y + ((LAT1 - lat) / (LAT1 - LAT0)) * MAP_H,
];
const box = { PW, PH, MAP_X, MAP_W, MAP_Y, MAP_H, HEADER, FOOTER, SHEET_EDGE, GUTTER, C4_BAND, PXI, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, proj };

// ── fixture: 855 pins across a 6x5 grid of rectangular "states" (lng/lat space) ─
// Deterministic PRNG (mulberry32) so pins are varied but fixed run-to-run.
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeFixture(N) {
  const cols = 6, rows = 5, feats = [];
  const dLng = (LNG1 - LNG0) / cols, dLat = (LAT1 - LAT0) / rows;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const x0 = LNG0 + c * dLng, x1 = x0 + dLng, y0 = LAT0 + r * dLat, y1 = y0 + dLat;
    feats.push({ properties: { shapeName: `S${c}_${r}` }, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
  }
  const rand = rng(12345);
  const pins = [];
  for (let i = 0; i < N; i++) {
    // keep a margin inside a state so the point-in-poly is unambiguous
    const lng = LNG0 + 0.5 + rand() * (LNG1 - LNG0 - 1);
    const lat = LAT0 + 0.5 + rand() * (LAT1 - LAT0 - 1);
    const [px, py] = proj(lng, lat);
    pins.push({ id: `p${i}`, name: `Group ${i} ${'abcdefgh'[i % 8]}`, lng, lat, _px: px, _py: py, image_url: null });
  }
  return { pins, feats };
}

const { pins, feats } = makeFixture(855);
const fmt4 = { nameMaxPt: 11, classic4: true, rangeBadge: true, photos: false, pageWidthIn: 60, w: PW, h: PH };
const optsBase = { fmt: fmt4, feats };

// ── 1. fourSides ──────────────────────────────────────────────────────────────
const four = await layoutCircular({ pins, states: null, box, mode: 'fourSides', opts: optsBase });
note.push(`fourSides: placed ${four.stats.placed}, ringOrdered ${four.stats.numbersRingOrdered}, dupes ${four.stats.numberDupes}, outsideState ${four.stats.pinsOutsideState}, islandFallback ${four.stats.islandFallback}, namePt ${four.stats.namePt}, sides ${JSON.stringify(four.stats.sides)}`);
if (!four.stats.numbersRingOrdered) fails.push('fourSides: numbers not ring-ordered 1..N');
if (four.stats.numberDupes !== 0) fails.push(`fourSides: ${four.stats.numberDupes} duplicate numbers`);
if (four.stats.pinsOutsideState !== 0) fails.push(`fourSides: ${four.stats.pinsOutsideState} pins outside their state`);
if (four.stats.placed < 800) fails.push(`fourSides: only ${four.stats.placed} pins placed (floor 800) — vacuous`);
// (3) SIDE SEQUENCE: numbering must run L < T < R < B, and be monotone within each
// side — numbersRingOrdered alone (1..N, no gap) passes a scrambled side order too.
{
  const SEQ = ['L', 'T', 'R', 'B'];
  const bySide = { L: [], T: [], R: [], B: [] };
  for (const p of four.pins) (bySide[p.side] || (bySide[p.side] = [])).push(p.num);
  // side ranges from the pins (for the L<T<R<B sequence)
  let lo = 0, seqOk = true;
  for (const sd of SEQ) {
    const nums = bySide[sd] || [];
    for (const n of nums) if (n <= lo) seqOk = false;
    if (nums.length) lo = Math.max(lo, ...nums);
  }
  // monotone WITHIN a side = tested against GEOMETRY, not the emission arrays (which
  // numbering walks, so an emission-order check cannot fail — studio P2). Per classic4:
  // L cy DESC (num↑ ⇒ screen y DOWN), R cy ASC (y UP), T cx ASC (x UP), B cx DESC (x DOWN).
  // Pins are post-spread, so allow a drift tolerance = 60% of the side's mean step; a
  // reversed sort (studio's poison) still fails, normal de-overlap drift does not.
  const AXIS = { L: ['y', -1], R: ['y', +1], T: ['x', +1], B: ['x', -1] };
  let monoOk = true, monoWhy = '';
  for (const sd of SEQ) {
    const ps = four.pins.filter((p) => p.side === sd).sort((a, b) => a.num - b.num);
    if (ps.length < 3) continue;
    const [axis, dir] = AXIS[sd];
    const coords = ps.map((p) => p[axis] * dir);          // expected non-decreasing
    const span = coords[coords.length - 1] - coords[0];
    const tol = 0.6 * Math.abs(span) / (coords.length - 1); // 60% of mean step
    let inversions = 0;
    for (let i = 1; i < coords.length; i++) if (coords[i] < coords[i - 1] - tol) inversions++;
    // a correct side has only small local drift inversions; a reversed sort inverts ~everything
    if (inversions > coords.length * 0.2) { monoOk = false; monoWhy = `${sd}:${inversions}/${coords.length}`; }
  }
  if (!seqOk) fails.push('fourSides: numbers not in side sequence L<T<R<B');
  if (!monoOk) fails.push(`fourSides: numbering not geometrically monotone within a side (${monoWhy})`);
  // (4) RECOUNT outside-state from the OUTPUT (pins vs state rings), not from stats.
  const outFx = recountOutside(four.pins, feats);
  if (outFx !== 0) fails.push(`fourSides: recount found ${outFx} pins outside their state (stats said ${four.stats.pinsOutsideState})`);
  note.push(`fourSides check: sideSeq ${seqOk}, monotone ${monoOk}, outside(recount) ${outFx}`);
}

// ── 2. pairedRows ─────────────────────────────────────────────────────────────
const paired = await layoutCircular({ pins, states: null, box, mode: 'pairedRows', opts: optsBase });
note.push(`pairedRows: rows ${paired.stats.rows}, crossings ${paired.stats.crossings}, touches ${paired.stats.touches}, outsideState ${paired.stats.pinsOutsideState}, octilinear ${paired.stats.octilinear}`);
if (paired.stats.crossings !== 0) fails.push(`pairedRows: ${paired.stats.crossings} leader crossings (expected 0)`);
if (paired.stats.pinsOutsideState !== 0) fails.push(`pairedRows: ${paired.stats.pinsOutsideState} pins outside their state`);
if (!paired.stats.octilinear) fails.push('pairedRows: a leader is not octilinear');
if (paired.stats.placed < 800) fails.push(`pairedRows: only ${paired.stats.placed} pins placed (floor 800)`);
// (4) RECOUNT pairedRows crossings from the OUTPUT leaders[].segs (one id per fork,
// skip same-id), and outside-state from the output pins — not from stats.
{
  const segs = [];
  paired.leaders.forEach((lf, li) => { for (const s of (lf.segs || [])) segs.push({ s, li }); });
  let xr = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (segs[i].li === segs[j].li) continue;
    if (segCrossGate(segs[i].s, segs[j].s)) xr++;
  }
  if (xr !== 0) fails.push(`pairedRows: recount found ${xr} crossings (stats said ${paired.stats.crossings})`);
  const outPr = recountOutside(paired.pins, feats);
  if (outPr !== 0) fails.push(`pairedRows: recount found ${outPr} pins outside their state`);
  // (P3) every leader must actually carry its two polylines — a dropped polys passed before.
  const badPolys = paired.leaders.filter((l) => !Array.isArray(l.polys) || l.polys.length !== 2).length;
  if (badPolys !== 0) fails.push(`pairedRows: ${badPolys} leaders missing polys.length===2`);
  note.push(`pairedRows check: crossings(recount) ${xr}, outside(recount) ${outPr}, leaders-with-2-polys ${paired.leaders.length - badPolys}/${paired.leaders.length}`);
}

// ── 3. sideLanes ──────────────────────────────────────────────────────────────
const sideFmt = { nameMaxPt: 14, sideLanes: true, photos: false, pageWidthIn: 60, w: PW, h: PH };
const side = await layoutCircular({ pins, states: null, box: { ...box, LABEL_TOP: HEADER - 40, LABEL_BOT: PH - FOOTER + 40 }, mode: 'sideLanes', opts: { fmt: sideFmt, feats } });
note.push(`sideLanes: placed ${side.stats.placed}, crossings ${side.stats.crossings}, touches ${side.stats.touches}, octilinear ${side.stats.octilinear}, sides ${JSON.stringify(side.stats.sides)}`);
if (side.stats.placed < 800) fails.push(`sideLanes: only ${side.stats.placed} placed (floor 800)`);
if (!side.stats.octilinear) fails.push('sideLanes: leaders not all octilinear');

// ── 4. determinism ────────────────────────────────────────────────────────────
const four2 = await layoutCircular({ pins, states: null, box, mode: 'fourSides', opts: optsBase });
if (JSON.stringify(four.labels) !== JSON.stringify(four2.labels) || JSON.stringify(four.dots) !== JSON.stringify(four2.dots)) fails.push('NON-DETERMINISTIC: two fourSides runs differ');

// ── 5. poison — a tiny state cannot hold its pins → infeasible NAMED ───────────
{
  // one tiny state in lng/lat; pack many pins into it
  const tinyFeats = [{ properties: { shapeName: 'TINY' }, geometry: { type: 'Polygon', coordinates: [[[80, 20], [80.02, 20], [80.02, 20.02], [80, 20.02], [80, 20]]] } }];
  const tinyPins = [];
  for (let i = 0; i < 40; i++) { const [px, py] = proj(80.01, 20.01); tinyPins.push({ id: `t${i}`, name: `T${i}`, lng: 80.01, lat: 20.01, _px: px, _py: py }); }
  const pf = { nameMaxPt: 11, classic4: true, rangeBadge: false, photos: false, pageWidthIn: 60, w: PW, h: PH };
  const pres = await layoutCircular({ pins: tinyPins, states: null, box, mode: 'fourSides', opts: { fmt: pf, feats: tinyFeats } });
  note.push(`poison: infeasible ${pres.stats.infeasible}, outsideState ${pres.stats.pinsOutsideState}`);
  if (pres.stats.infeasible < 1) fails.push('POISON: a too-small state was NOT named in infeasible');
  if (pres.stats.pinsOutsideState !== 0) fails.push(`POISON: ${pres.stats.pinsOutsideState} pins escaped the tiny state`);
}

// ── 6. budget (step 2 node half): median of 3, heap delta ───────────────────────
// BASELINE: measured on this box at ~1.0-1.4s for 855 pins (fourSides, placePinsInState
// 400 iters). Budget fails at 1.5x of 3500ms = 5250ms to leave headroom on a slow CI
// box; the browser half (390px, 6x CPU throttle) is measured separately on the shared browser.
const BUDGET_MS = 5250;
const HEAP_CEIL_MB = 300;
const times = [];
let heapDelta = 0;
for (let k = 0; k < 3; k++) {
  if (globalThis.gc) globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  const t0 = process.hrtime.bigint();
  await layoutCircular({ pins, states: null, box, mode: 'fourSides', opts: optsBase });
  const t1 = process.hrtime.bigint();
  times.push(Number(t1 - t0) / 1e6);
  heapDelta = Math.max(heapDelta, (process.memoryUsage().heapUsed - h0) / 1048576);
}
times.sort((a, b) => a - b);
const medMs = times[1];
note.push(`budget: fourSides median ${medMs.toFixed(0)}ms (runs ${times.map((t) => t.toFixed(0)).join('/')}), heapΔ ~${heapDelta.toFixed(0)}MB; budget ${BUDGET_MS}ms / ${HEAP_CEIL_MB}MB`);
if (medMs > BUDGET_MS) fails.push(`budget: ${medMs.toFixed(0)}ms over ${BUDGET_MS}ms`);
if (heapDelta > HEAP_CEIL_MB) fails.push(`budget: heapΔ ${heapDelta.toFixed(0)}MB over ${HEAP_CEIL_MB}MB`);

for (const n of note) console.log(`  · ${n}`);
if (fails.length) {
  console.error('FAIL check:circular-layout');
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`PASS check:circular-layout — fourSides ring-ordered 0-dupes 0-outside, pairedRows 0-crossings, sideLanes octilinear, deterministic, poison named, ${medMs.toFixed(0)}ms < ${BUDGET_MS}ms budget`);
}
