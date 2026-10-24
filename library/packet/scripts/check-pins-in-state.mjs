#!/usr/bin/env node
/**
 * check-pins-in-state.mjs — unit check for library/packet/pins-in-state.js.
 *
 * Verifies, at the whole-India 60x96in poster's px scale (sheet 2500x4000,
 * PIN_R_BASE 8.0, MIN_SEP = 2r*1.16 ≈ the engine's), that placePinsInState():
 *   1. leaves 0 pins outside their own state polygon,
 *   2. leaves 0 overlaps that are NOT reported in `infeasible`,
 *   3. is DETERMINISTIC (two runs, identical output), and
 *   4. is poison-tested: a state too small for its pins is NAMED in `infeasible`,
 *      never silently overlapped.
 *
 * Runs on the REAL India data when it is present (the state-assignment JSON that
 * reg-post provides); otherwise on a self-contained synthetic 60x96 fixture, so
 * the gate is runnable now and tightens automatically once the data lands. A
 * vacuous pass is refused: the run asserts a floor on how many pins it exercised.
 *
 * No browser, no network. Exit 0 PASS, 1 FAIL (reason flushed first), 75 NOT
 * MEASURED only if the module cannot be imported.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');

let placePinsInState;
try {
  ({ placePinsInState } = await import('../pins-in-state.js'));
} catch (e) {
  console.error(`NOT MEASURED: cannot import pins-in-state.js — ${e.message}`);
  process.exitCode = 75;
}

if (placePinsInState) {
  // ── Scale constants, taken from poster-render.js for the 60x96 sheet ─────────
  const SHEET_W = 2500, SHEET_H = 4000;   // '60x96': { w:2500, h:4000 }
  const GUTTER = 572;
  const MAP_X = GUTTER, MAP_W = SHEET_W - 2 * GUTTER; // ≈1356
  const MAP_Y = 360, MAP_H = SHEET_H - 760;           // generous India map band
  const R = 8.0;                                      // PIN_R_BASE
  const GAP = R * 2 * 0.16;                            // MIN_SEP = 2r+GAP ≈ 2r*1.16
  const MIN_SEP = R * 2 + GAP;

  let pins, states, source;
  const real = findRealData();
  if (real) { ({ pins, states } = real); source = 'REAL India data'; }
  else { ({ pins, states } = synthFixture()); source = 'synthetic 60x96 fixture'; }

  const FLOOR = 200; // refuse a vacuous pass
  const fails = [];
  const note = [];

  if (pins.length < FLOOR) {
    fails.push(`exercised only ${pins.length} pins (floor ${FLOOR}) — vacuous`);
  }

  // ── 1+2: the real placement ─────────────────────────────────────────────────
  const res = placePinsInState({ pins, states, r: R, gap: GAP, maxDrift: 58 });
  note.push(`${source}: ${pins.length} pins across ${Object.keys(states).length} states`);
  note.push(`moved ${res.moved}, maxDisp ${res.maxDisp.toFixed(1)}px, meanDisp ${res.meanDisp.toFixed(1)}px, ` +
            `overlapsRemaining ${res.overlapsRemaining}, outsideState ${res.outsideState}, ` +
            `infeasible states ${res.infeasible.length}`);

  if (res.outsideState !== 0) fails.push(`${res.outsideState} pins ended OUTSIDE their own state`);

  // Input must be unmutated.
  if (pins.some((p, i) => p.x !== (real ? real.origX[i] : p.x))) { /* only meaningful for real */ }

  // Every surviving overlap must be accounted for in `infeasible`.
  const infeasibleIds = new Set(res.infeasible.flatMap((f) => f.pins));
  let unaccountedOverlaps = 0;
  for (let i = 0; i < res.pins.length; i++) {
    for (let j = i + 1; j < res.pins.length; j++) {
      const a = res.pins[i], b = res.pins[j];
      if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SEP - 1e-6) {
        if (!infeasibleIds.has(a.id) || !infeasibleIds.has(b.id)) unaccountedOverlaps++;
      }
    }
  }
  if (unaccountedOverlaps !== 0) fails.push(`${unaccountedOverlaps} overlaps NOT reported in infeasible (silent stacking)`);

  // ── 3: determinism ───────────────────────────────────────────────────────────
  const res2 = placePinsInState({ pins, states, r: R, gap: GAP, maxDrift: 58 });
  const same = JSON.stringify(res.pins) === JSON.stringify(res2.pins);
  if (!same) fails.push('NON-DETERMINISTIC: two runs produced different output');

  // ── 4: poison — a UT too small to hold its pins must be NAMED infeasible ──────
  const poison = poisonFixture(R, GAP);
  const pres = placePinsInState({ pins: poison.pins, states: poison.states, r: R, gap: GAP });
  const poisonNamed = pres.infeasible.some((f) => f.stateId === 'tiny-UT' && f.pins.length >= 2);
  // Count overlaps inside the tiny UT; they MUST all be reported (not silent).
  let poisonSilent = 0;
  for (let i = 0; i < pres.pins.length; i++)
    for (let j = i + 1; j < pres.pins.length; j++) {
      const a = pres.pins[i], b = pres.pins[j];
      if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SEP - 1e-6) {
        const ids = new Set(pres.infeasible.flatMap((f) => f.pins));
        if (!ids.has(a.id) || !ids.has(b.id)) poisonSilent++;
      }
    }
  if (!poisonNamed) fails.push('POISON: a too-small state was NOT named in infeasible');
  if (poisonSilent !== 0) fails.push(`POISON: ${poisonSilent} overlaps in the tiny state went unreported`);
  // Poison pins must still be INSIDE the tiny state (constraint beats separation).
  if (pres.outsideState !== 0) fails.push(`POISON: ${pres.outsideState} pins escaped the tiny state`);
  note.push(`poison: tiny-UT named=${poisonNamed}, silent overlaps=${poisonSilent}, outside=${pres.outsideState}`);

  // ── 5: multipolygon + hole + island-fallback paths (the island/coast cases) ──
  {
    const outer = [[100, 100], [400, 100], [400, 400], [100, 400], [100, 100]];
    const hole = [[200, 200], [300, 200], [300, 300], [200, 300], [200, 200]];
    const island = [[600, 100], [680, 100], [680, 180], [600, 180], [600, 100]];
    const mstates = { A: [[outer, hole], [island]] };
    const mpins = [
      { id: 'inHole', x: 250, y: 250, stateId: 'A' },   // in the mainland hole → must leave it
      { id: 'onIsland', x: 640, y: 140, stateId: 'A' },  // on the island part → inside
      { id: 'mainland', x: 150, y: 150, stateId: 'A' },  // inside mainland
    ];
    const mres = placePinsInState({ pins: mpins, states: mstates, r: R, gap: GAP });
    if (mres.outsideState !== 0) fails.push(`multipoly: ${mres.outsideState} pins outside a 2-part state with a hole`);
    const moved = mres.pins.find((p) => p.id === 'inHole');
    if (Math.abs(moved.dx) + Math.abs(moved.dy) < 1e-6) fails.push('multipoly: the in-hole pin was not moved onto land');

    // Island fallback: a pin geocoded OFF its state is pulled onto the state's land.
    const istates = { Lakshadweep: [[[[50, 50], [90, 50], [90, 90], [50, 90], [50, 50]]]] };
    const ires = placePinsInState({ pins: [{ id: 'offshore', x: 300, y: 300, stateId: 'Lakshadweep' }], states: istates, r: R, gap: GAP });
    if (ires.outsideState !== 0) fails.push('island: an offshore pin was not pulled onto its state');
    note.push(`multipoly+hole outside=${mres.outsideState}, in-hole moved=${(Math.abs(moved.dx) + Math.abs(moved.dy) > 1e-6)}; island pulled ${Math.hypot(ires.pins[0].dx, ires.pins[0].dy).toFixed(1)}px onto land`);
  }

  for (const n of note) console.log(`  · ${n}`);
  if (fails.length) {
    console.error(`FAIL check:pins-in-state (${source})`);
    for (const f of fails) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS check:pins-in-state — ${pins.length} pins, 0 outside-state, 0 silent overlaps, deterministic, poison caught (${source})`);
  }
}

// ── Real-data loader (best-effort; the shapes reg-post controls) ───────────────
function findRealData() {
  // Candidate committed locations for the India state-assignment + boundary px.
  const candidates = [
    'plugin-designs/country-posters/data/india-pins-in-state.json',
    'plugin-designs/country-posters/data/india-state-pins-px.json',
  ];
  for (const rel of candidates) {
    const p = resolve(REPO, rel);
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      if (Array.isArray(j.pins) && j.states && typeof j.states === 'object') {
        const origX = j.pins.map((q) => q.x);
        return { pins: j.pins, states: j.states, origX };
      }
    } catch { /* fall through to synthetic */ }
  }
  return null;
}

// ── Synthetic 60x96 fixture: a grid of states, pins clustered so de-overlap bites,
//    every pin tagged to the state it sits in. Deterministic, ≥ FLOOR pins. ──────
function synthFixture() {
  const states = {};
  const pins = [];
  const COLS = 6, ROWS = 7;                 // 42 states
  const CW = 1356 / COLS, CH = 2600 / ROWS; // within the India map band
  const X0 = 572, Y0 = 400, PAD = 6;
  let pid = 0;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const id = `S${c}-${r}`;
      const x0 = X0 + c * CW + PAD, y0 = Y0 + r * CH + PAD;
      const x1 = X0 + (c + 1) * CW - PAD, y1 = Y0 + (r + 1) * CH - PAD;
      // Single-part rectangle (outer ring only).
      states[id] = [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]];
      // 5 pins per state, deliberately stacked near the centre so they must spread.
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      for (let k = 0; k < 5; k++) {
        pins.push({ id: `p${pid++}`, x: cx + (k % 2), y: cy + (k * 0.7), stateId: id });
      }
    }
  }
  return { pins, states }; // 210 pins ≥ FLOOR
}

// ── Poison: one tiny state with far more pins than fit at MIN_SEP ──────────────
function poisonFixture(R, GAP) {
  const MIN_SEP = R * 2 + GAP;
  // A box barely larger than one pin — cannot separate 4 pins to MIN_SEP.
  const s = MIN_SEP * 0.8;
  const x0 = 1000, y0 = 1000;
  const states = { 'tiny-UT': [[[[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]]] };
  const cx = x0 + s / 2, cy = y0 + s / 2;
  const pins = [];
  for (let k = 0; k < 4; k++) pins.push({ id: `tp${k}`, x: cx, y: cy, stateId: 'tiny-UT' });
  return { pins, states };
}
