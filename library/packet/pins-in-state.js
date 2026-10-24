/**
 * pins-in-state.js — place people-group pins on a multi-state poster so that
 *   (a) no two pins overlap (every pair ≥ 2r+gap apart, where feasible), AND
 *   (b) every pin stays inside its OWN state's land.
 *
 * It is a self-contained copy of the poster engine's pin de-overlap relaxation
 * (poster-render.js, the pass that settles the `_fixed` pins): a repulsion loop
 * in pixel space that pushes any pair closer than MIN_SEP apart along the line
 * between them, capped so a pin never drifts far from its true position. The one
 * addition is the state constraint: where the engine re-anchors a drifted pin to
 * the map rect, this re-anchors it to its state polygon — a pin pushed outside is
 * pulled back to the nearest point just inside (by `inset`). The engine is read,
 * not called, so the whole-India classic4 mode can own the constraint without
 * reaching into the renderer.
 *
 * PX ONLY. Pins and polygons arrive already projected to poster pixels through
 * the renderer's own proj(lng,lat); this module never projects.
 *
 * DETERMINISTIC. Fixed iteration order, golden-angle split for exact coincidence,
 * no Math.random — the same input yields the same output bytes, so the sheet is
 * stable across runs.
 *
 * @param {object}   opts
 * @param {Array}    opts.pins    [{ id, x, y, stateId }] in poster px. Not mutated.
 * @param {object}   opts.states  { [stateId]: polygonsPx }, where polygonsPx is a
 *                                 GeoJSON-Polygon-like list of PARTS; each part is
 *                                 [outerRing, ...holeRings]; each ring is [[x,y],…]
 *                                 in px. "Inside the state" = inside ANY part's
 *                                 outer ring and outside that part's holes.
 * @param {number}   opts.r       pin radius in px.
 * @param {number}   [opts.gap=0] extra clearance between pin edges; MIN_SEP = 2r+gap.
 * @param {number}   [opts.iters=260]    relaxation passes (matches the engine).
 * @param {number}   [opts.maxDrift=58]  hard cap on how far a pin may move from truth.
 * @param {number}   [opts.inset=0.5]    how far INSIDE the boundary a pulled-back pin lands.
 * @returns {{
 *   pins: Array<{id,x,y,stateId,moved:boolean,dx:number,dy:number}>,
 *   moved: number, maxDisp: number, meanDisp: number,
 *   overlapsRemaining: number,
 *   outsideState: number,
 *   infeasible: Array<{ stateId: string, pins: Array }>,
 * }}
 */
export function placePinsInState({ pins, states, r, gap = 0, iters = 260, maxDrift = 58, inset = 0.5 }) {
  if (!Array.isArray(pins)) throw new TypeError('pins must be an array');
  if (!states || typeof states !== 'object') throw new TypeError('states must be an object');
  if (!(r > 0)) throw new TypeError('r must be a positive number');

  const MIN_SEP = r * 2 + gap;

  // Working copy — input is never mutated. _ox/_oy hold the true (projected) origin.
  const work = pins.map((p) => ({
    id: p.id, stateId: p.stateId,
    x: p.x, y: p.y, _ox: p.x, _oy: p.y,
  }));

  // Resolve each pin's state parts once. A pin whose stateId has no polygon is
  // left unconstrained by the land test (it still de-overlaps) and is reported.
  const partsOf = (stateId) => {
    const poly = states[stateId];
    return Array.isArray(poly) ? poly : null;
  };

  for (let pass = 0; pass < iters; pass++) {
    let moved = false;

    // Pairwise repulsion — same shape as the engine's pass, same fixed order.
    for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const a = work[i], b = work[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= MIN_SEP) continue;
        if (dist < 0.0001) {               // exactly coincident — split on a
          const ang = i * 2.399963;        // golden angle, deterministic
          dx = Math.cos(ang); dy = Math.sin(ang); dist = 1;
        }
        const push = (MIN_SEP - dist) / 2 + 0.15;
        const ux = dx / dist, uy = dy / dist;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        moved = true;
      }
    }

    // Re-anchor: cap drift from truth, then keep each pin inside its own state.
    for (const it of work) {
      const ddx = it.x - it._ox, ddy = it.y - it._oy;
      const d = Math.hypot(ddx, ddy);
      if (d > maxDrift) { it.x = it._ox + (ddx / d) * maxDrift; it.y = it._oy + (ddy / d) * maxDrift; }
      const parts = partsOf(it.stateId);
      if (parts && !pointInState(it.x, it.y, parts)) {
        const near = nearestInside(it.x, it.y, parts, inset);
        it.x = near.x; it.y = near.y;
      }
    }

    if (!moved) break;
  }

  // ── Report ────────────────────────────────────────────────────────────────
  let maxDisp = 0, sumDisp = 0, movedCount = 0, outsideState = 0;
  const outPins = work.map((it) => {
    const dx = it.x - it._ox, dy = it.y - it._oy;
    const disp = Math.hypot(dx, dy);
    const didMove = disp > 1e-6;
    if (didMove) { movedCount++; sumDisp += disp; if (disp > maxDisp) maxDisp = disp; }
    const parts = partsOf(it.stateId);
    if (parts && !pointInState(it.x, it.y, parts)) outsideState++;
    return { id: it.id, x: it.x, y: it.y, stateId: it.stateId, moved: didMove, dx, dy };
  });

  // Overlaps remaining: count unordered pairs still closer than MIN_SEP.
  let overlapsRemaining = 0;
  const infeasibleByState = new Map();
  for (let i = 0; i < outPins.length; i++) {
    for (let j = i + 1; j < outPins.length; j++) {
      const a = outPins[i], b = outPins[j];
      if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SEP - 1e-6) {
        overlapsRemaining++;
        // An overlap that survives is a feasibility failure of the state(s)
        // holding these pins — record both so nothing is silently stacked.
        for (const p of [a, b]) {
          if (!infeasibleByState.has(p.stateId)) infeasibleByState.set(p.stateId, new Set());
          infeasibleByState.get(p.stateId).add(p.id);
        }
      }
    }
  }

  const infeasible = [...infeasibleByState.entries()]
    .map(([stateId, ids]) => ({ stateId, pins: [...ids] }))
    .sort((p, q) => String(p.stateId).localeCompare(String(q.stateId)));

  return {
    pins: outPins,
    moved: movedCount,
    maxDisp,
    meanDisp: movedCount ? sumDisp / movedCount : 0,
    overlapsRemaining,
    outsideState,
    infeasible,
  };
}

// ── Geometry (self-contained; px space) ───────────────────────────────────────

// Ray-casting point-in-ring. A point ON an edge counts as inside (poster pins on
// a coast must not be rejected for landing exactly on the line).
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xk = ring[k][0], yk = ring[k][1];
    const intersect = ((yi > y) !== (yk > y)) &&
      (x < ((xk - xi) * (y - yi)) / ((yk - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Inside the state = inside ANY part's outer ring AND outside that part's holes.
function pointInState(x, y, parts) {
  for (const part of parts) {
    if (!part || !part.length) continue;
    const [outer, ...holes] = part;
    if (!outer || outer.length < 3) continue;
    if (!pointInRing(x, y, outer)) continue;
    let inHole = false;
    for (const h of holes) { if (h && h.length >= 3 && pointInRing(x, y, h)) { inHole = true; break; } }
    if (!inHole) return true;
  }
  return false;
}

// Nearest point ON a ring's edges to (x,y), as {x,y,d2}.
function nearestOnRing(x, y, ring) {
  let best = null;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const p = nearestOnSegment(x, y, ring[k][0], ring[k][1], ring[i][0], ring[i][1]);
    if (!best || p.d2 < best.d2) best = p;
  }
  return best;
}

function nearestOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * abx, y = ay + t * aby;
  const dx = px - x, dy = py - y;
  return { x, y, d2: dx * dx + dy * dy };
}

// Pull an outside point to the nearest point just INSIDE the state, by `inset`.
// Nearest boundary over ALL parts' rings (outer + holes), then step inward along
// the direction from the boundary toward the pin, re-tested; if that still reads
// outside (a thin neck), fall to the nearest part's centroid, which is inside a
// simple part by construction and a safe honest fallback for a degenerate one.
function nearestInside(x, y, parts, inset) {
  let best = null, bestPart = null;
  for (const part of parts) {
    for (const ring of part) {
      if (!ring || ring.length < 2) continue;
      const cand = nearestOnRing(x, y, ring);
      if (cand && (!best || cand.d2 < best.d2)) { best = cand; bestPart = part; }
    }
  }
  if (!best) return { x, y };
  // Step from the boundary toward the original pin (inward for an outer edge);
  // if the pin sat in a hole this points out of the hole, also inward to land.
  const vx = x - best.x, vy = y - best.y;
  const vlen = Math.hypot(vx, vy) || 1;
  let nx = best.x + (vx / vlen) * inset;
  let ny = best.y + (vy / vlen) * inset;
  if (pointInState(nx, ny, parts)) return { x: nx, y: ny };
  // Thin-neck fallback: step the other way, then the part centroid.
  nx = best.x - (vx / vlen) * inset; ny = best.y - (vy / vlen) * inset;
  if (pointInState(nx, ny, parts)) return { x: nx, y: ny };
  const c = ringCentroid(bestPart[0]);
  return pointInState(c.x, c.y, parts) ? c : { x: best.x, y: best.y };
}

function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const cross = ring[k][0] * ring[i][1] - ring[i][0] * ring[k][1];
    a += cross; cx += (ring[k][0] + ring[i][0]) * cross; cy += (ring[k][1] + ring[i][1]) * cross;
  }
  if (Math.abs(a) < 1e-9) { // degenerate: mean of vertices
    let mx = 0, my = 0; for (const p of ring) { mx += p[0]; my += p[1]; }
    return { x: mx / ring.length, y: my / ring.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export default placePinsInState;
