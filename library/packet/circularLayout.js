/**
 * circularLayout.js — the poster "circular logic" (ring order + leader routing +
 * numbered four-sides + paired-row forks) as ONE pure, Worker-safe module.
 *
 * Numbers in, geometry out. The module returns POSITIONS, POLYLINES and STATS —
 * never SVG/HTML strings (those stay in poster-render.js). It is pure: no DOM, no
 * Vue, no fetch, no canvas, no module-level mutable format state, no Math.random,
 * and no reliance on Set/Map iteration order (every tie is broken by id). The same
 * input yields byte-identical output, which the byte-proof in step 3 depends on.
 *
 * It is a PORT of the proven geometry in library/packet/poster-render.js and of
 * the classic4 four-sides reference — the same math, lifted so a cheap phone (or a
 * Worker with no canvas) can lay a big poster out. The text measurer is PASSED IN
 * (`opts.measure`) because a Worker has no canvas; the default is the renderer's
 * own CHADV × WFUDGE advance table, lifted verbatim, so the numbers match.
 *
 *   layoutCircular({ pins, states, box, mode, opts }) -> { numbers, pins, rows, leaders, badges, stats }
 *
 * MODES
 *   'sideLanes'  — today's large-sheet L/R layout: octilinear leaders in margin
 *                  lanes, photo slots. Pins are NOT moved (byte identity in step 1).
 *   'fourSides'  — design (1): NUMBERED, NO leaders. Numbers in the pin and before
 *                  the name; names on all four sides; 0 crossings by construction.
 *                  Pins de-overlapped in-state via placePinsInState.
 *   'pairedRows' — design (2): two groups per row, TWO leaders per row (octilinear
 *                  forks), in ring order, 0 crossings; pins spread in-state.
 *
 * `box` carries the per-poster geometry the renderer already computes (all px):
 *   { PW, PH, MAP_X, MAP_W, MAP_Y, MAP_H, HEADER, FOOTER, SHEET_EDGE, GUTTER,
 *     C4_BAND, PXI, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, LABEL_TOP, LABEL_BOT,
 *     proj(lng,lat)->[x,y] }
 * `opts`:
 *   { measure(str,pt)->px, slotOf(pin,pt)->px, photoOf(pin)->url|null,
 *     fmt:{ nameMaxPt, photos, rangeBadge, classic4, fork, sideLanes, pageWidthIn,
 *           w, h }, seamYs:[y...], placePinsInState, forkRoute, feats:[...] }
 *
 * placePinsInState and forkRoute come from their sibling library modules (static
 * imports below); a caller may still override either via opts for a Worker that
 * injects its own. Both are pure ESM, so the static import stays Worker-portable.
 */
import { placePinsInState as libPlacePinsInState } from './pins-in-state.js';
import { forkRoute as libForkRoute } from './fork-leaders.js';

// ── text advance (lifted verbatim from poster-render.js: CHADV × WFUDGE) ───────
// Worker-safe: a static char-advance table, no canvas. Callers may override via
// opts.measure, but the default MUST equal the renderer's or the bytes move.
const CHADV = (ch) => {
  if ('iIjl|.,:;\'! '.includes(ch)) return 0.28;
  if ('ftr()[]-'.includes(ch)) return 0.34;
  if ('mwMW'.includes(ch)) return 0.86;
  if ('ABCDEFGHKLNOPQRSTUVXYZ0123456789'.includes(ch)) return 0.63;
  return 0.53;
};
const WFUDGE = 1.11;
export const textW = (str, fs) => [...String(str)].reduce((a, ch) => a + CHADV(ch), 0) * fs * WFUDGE;

// ── octilinear leader primitives (lifted verbatim from poster-render.js) ───────
export function octiRoute(it, laneX, dirOut, dfrac) {
  const STUB = 7;
  const P = [it.px, it.py];
  const xStub = it.px + dirOut * STUB;
  const dy = it.labelY - it.py;
  const vdir = dy === 0 ? 0 : Math.sign(dy);
  const gap = Math.abs(xStub - laneX);
  const diag = Math.max(0, Math.min(dfrac * Math.abs(dy), gap));
  const feeler = gap - diag;
  const pts = [P, [xStub, it.py]];
  pts.push([xStub + dirOut * feeler, it.py]);
  pts.push([laneX, it.py + vdir * diag]);
  pts.push([laneX, it.labelY]);
  return pts;
}
export function isOctilinear(pts, eps = 0.6) {
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = Math.abs(pts[i + 1][0] - pts[i][0]), dy = Math.abs(pts[i + 1][1] - pts[i][1]);
    if (dx < eps || dy < eps) continue;
    if (Math.abs(dx - dy) < eps) continue;
    return false;
  }
  return true;
}
// Deterministic id tie-break by CODE UNIT (locale-independent, unlike localeCompare),
// so the layout is byte-identical on any runtime/locale (Node, a phone in ar or zh).
function cmpId(a, b) { const x = String(a), y = String(b); return x < y ? -1 : x > y ? 1 : 0; }

function segCrossXY(p, q) {
  const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  const [a, b] = p, [c, d] = q;
  const same = (u, v) => Math.abs(u[0] - v[0]) < 0.5 && Math.abs(u[1] - v[1]) < 0.5;
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
  const o1 = o(...a, ...b, ...c), o2 = o(...a, ...b, ...d), o3 = o(...c, ...d, ...a), o4 = o(...c, ...d, ...b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}
// Count crossings between polylines, skipping same-polyline pairs (same li). A
// FORK must be passed as ONE polyline id (its unique segs), never its two polys.
export function countPolyCrossings(polys) {
  const segs = [];
  polys.forEach((pts, li) => { for (let i = 0; i < pts.length - 1; i++) segs.push({ s: [pts[i], pts[i + 1]], li }); });
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (segs[i].li === segs[j].li) continue;
    if (segCrossXY(segs[i].s, segs[j].s)) n++;
  }
  return n;
}
// A leader that passes within r of ANOTHER group's dot ("touch"). segs: array of
// { li, pts }, dots: [{ id, x, y }]. Skips the leader's own endpoint dot by id.
function countTouches(leaderPolys, dots, r) {
  let touches = 0;
  for (const lp of leaderPolys) {
    for (const dot of dots) {
      if (dot.id === lp.id) continue;
      if (polyNearPoint(lp.pts, dot.x, dot.y, r)) touches++;
    }
  }
  return touches;
}
function polyNearPoint(pts, px, py, r) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distPointToSeg(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= r) return true;
  }
  return false;
}
function distPointToSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * abx, y = ay + t * aby;
  return Math.hypot(px - x, py - y);
}

// ── point-in-ring / state polygon helpers (for in-state de-overlap inputs) ─────
function inRing(lng, lat, r) {
  let o = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) o = !o;
  }
  return o;
}
function inPoly(lng, lat, p) {
  if (!inRing(lng, lat, p[0])) return false;
  for (let k = 1; k < p.length; k++) if (inRing(lng, lat, p[k])) return false;
  return true;
}
function inFeat(lng, lat, g) {
  return g.type === 'Polygon' ? inPoly(lng, lat, g.coordinates)
    : g.type === 'MultiPolygon' ? g.coordinates.some((p) => inPoly(lng, lat, p)) : false;
}
// Nearest ADM1 shapeName for an off-polygon point (island fallback), lifted from
// classic4Layout.nearest. Deterministic: first feature wins a tie by scan order.
function nearestState(lng, lat, feats) {
  let best = null, bd = Infinity;
  const cl = Math.cos(lat * Math.PI / 180);
  for (const f of feats) {
    const ps = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const po of ps) for (const r of po) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const ax = r[j][0], ay = r[j][1], bx = r[i][0], by = r[i][1];
      const dx = (bx - ax) * cl, dy = by - ay, pax = (lng - ax) * cl, pay = lat - ay, l2 = dx * dx + dy * dy;
      let t = l2 ? (pax * dx + pay * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const qx = pax - t * dx, qy = pay - t * dy, d = qx * qx + qy * qy;
      if (d < bd) { bd = d; best = f.properties.shapeName; }
    }
  }
  return best;
}
// Build { shapeName: polygonsPx } for placePinsInState, projecting every ring.
function statesToPx(feats, proj) {
  const statesPx = {};
  for (const f of feats) {
    const sn = f.properties.shapeName;
    const ps = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const parts = ps.map((poly) => poly.map((ring) => ring.map(([lng, lat]) => proj(lng, lat))));
    (statesPx[sn] = statesPx[sn] || []).push(...parts);
  }
  return statesPx;
}

// ── dependency resolution (injected; lazy Node fallback) ───────────────────────
function resolveDeps(opts) {
  // The library implementations by default; a Worker may inject its own via opts.
  return {
    placePinsInState: (opts && opts.placePinsInState) || libPlacePinsInState,
    forkRoute: (opts && opts.forkRoute) || libForkRoute,
  };
}

// ── clustering (id-stable; CL_R on the given coordinate pair) ──────────────────
// Scans pins in input order; nearest existing cluster within CL_R wins, ties by
// cluster creation order (first found). Deterministic — no Map/Set ordering.
function clusterBy(pins, CL_R, getX, getY) {
  const clusters = [];
  for (const p of pins) {
    let best = null, bd = CL_R;
    for (const c of clusters) {
      const d = Math.hypot(getX(c) - getX(p), getY(c) - getY(p));
      if (d <= bd) { bd = d; best = c; }
    }
    if (best) {
      best.items.push(p);
      best._sx += (getX(p) - best._sx) / best.items.length;
      best._sy += (getY(p) - best._sy) / best.items.length;
    } else {
      clusters.push({ items: [p], _sx: getX(p), _sy: getY(p) });
    }
  }
  return clusters;
}

// ───────────────────────────────── MAIN ───────────────────────────────────────
export async function layoutCircular({ pins, states, box, mode, opts = {} }) {
  if (!Array.isArray(pins)) throw new TypeError('pins must be an array');
  if (!box || typeof box !== 'object') throw new TypeError('box (geometry) is required');
  if (!['sideLanes', 'fourSides', 'pairedRows'].includes(mode)) throw new TypeError(`unknown mode: ${mode}`);
  const measure = opts.measure || textW;
  const fmt = opts.fmt || {};
  const { placePinsInState, forkRoute } = resolveDeps(opts);
  if (mode === 'fourSides') return fourSides({ pins, box, opts, fmt, measure, placePinsInState });
  if (mode === 'pairedRows') return pairedRows({ pins, box, opts, fmt, measure, placePinsInState, forkRoute });
  return sideLanes({ pins, box, opts, fmt, measure });
}

// ── FOUR-SIDES (design 1): numbered, no leaders. Ported from classic4Layout. ───
function fourSides({ pins0 = null, pins, box, opts, fmt, measure, placePinsInState }) {
  const { PW, PH, MAP_X, MAP_W, MAP_Y, MAP_H, HEADER, FOOTER, SHEET_EDGE, C4_BAND, PXI, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, proj } = box;
  const feats = opts.feats || [];
  const RANGE = !!fmt.rangeBadge;
  // project pins; px/py are the engine-settled coords passed in on each pin as _px/_py.
  const P = pins.map((p) => {
    const [rx, ry] = proj ? proj(+p.lng, +p.lat) : [p._px, p._py];
    return { ...p, px: p._px, py: p._py, rx, ry };
  });
  // state assignment + island fallback (deterministic scan order)
  let islandFallback = 0;
  for (const p of P) {
    let st = null;
    for (const f of feats) if (inFeat(+p.lng, +p.lat, f.geometry)) { st = f.properties.shapeName; break; }
    if (!st) { st = nearestState(+p.lng, +p.lat, feats); if (st) islandFallback++; }
    p._state = st;
  }
  // cluster co-located pins on RAW projected coords (CL_R=12), consecutive numbers
  const CL_R = 12;
  const clusters = [];
  for (const p of P) {
    let c = null, bd = CL_R;
    for (const q of clusters) { const d = Math.hypot(q.rx - p.rx, q.ry - p.ry); if (d <= bd) { bd = d; c = q; } }
    if (c) {
      c.items.push(p);
      c.rx += (p.rx - c.rx) / c.items.length; c.ry += (p.ry - c.ry) / c.items.length;
      c.cx += (p.px - c.cx) / c.items.length; c.cy += (p.py - c.cy) / c.items.length;
    } else clusters.push({ items: [p], rx: p.rx, ry: p.ry, cx: p.px, cy: p.py, state: p._state });
  }
  // geometry: L/R columns at the sheet edges; T/B rows on the reserved bands
  const colTop = HEADER, colBot = PH - FOOTER, colH = colBot - colTop;
  const lcolX = SHEET_EDGE + 6, rcolX = PW - SHEET_EDGE - 6;
  const rowY_T = HEADER + C4_BAND - 8, rowX0 = MAP_X + 8, rowX1 = MAP_X + MAP_W - 8, rowW = rowX1 - rowX0;
  const pitchCol = (f) => f * 1.14, pitchRow = (f) => f * 1.5;
  const capCol = (f) => Math.floor(colH / pitchCol(f)), capRow = (f) => Math.floor(rowW / pitchRow(f));
  const fCap = (fmt.nameMaxPt || 11) / 72 * PXI;
  let font = 5;
  for (let f = fCap; f >= 5; f -= 0.1) { if (2 * capRow(f) + 2 * capCol(f) >= P.length) { font = f; break; } }
  // assign whole clusters to sides (balanced by member count)
  const fRow = Math.min(capRow(font), Math.max(1, Math.floor(P.length * 0.22)));
  const byCy = [...clusters].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const used = new Set();
  const T = [], B = []; let cT = 0, cB = 0;
  for (const c of byCy) { if (cT + c.items.length <= fRow) { T.push(c); cT += c.items.length; used.add(c); } else break; }
  for (let i = byCy.length - 1; i >= 0; i--) { const c = byCy[i]; if (used.has(c)) break; if (cB + c.items.length <= fRow) { B.push(c); cB += c.items.length; used.add(c); } else break; }
  const midc = clusters.filter((c) => !used.has(c)).sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  const halfN = Math.ceil(midc.reduce((a, c) => a + c.items.length, 0) / 2);
  const L = [], R = []; let cL = 0;
  for (const c of midc) { if (cL < halfN) { L.push(c); cL += c.items.length; } else R.push(c); }
  L.sort((a, b) => b.cy - a.cy || a.cx - b.cx); R.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  T.sort((a, b) => a.cx - b.cx || a.cy - b.cy); B.sort((a, b) => b.cx - a.cx || a.cy - b.cy);
  // number 1..N in ring order [L, T, R, B]
  const ringC = [...L, ...T, ...R, ...B]; let num = 0;
  const sideOf = new Map(); L.forEach((c) => sideOf.set(c, 'L')); T.forEach((c) => sideOf.set(c, 'T')); R.forEach((c) => sideOf.set(c, 'R')); B.forEach((c) => sideOf.set(c, 'B'));
  for (const c of ringC) { c.first = num + 1; const sd = sideOf.get(c); for (const p of c.items) { p.num = ++num; p.side = sd; } c.last = num; }
  const Lp = L.flatMap((c) => c.items), Rp = R.flatMap((c) => c.items), Tp = T.flatMap((c) => c.items), Bp = B.flatMap((c) => c.items);
  // bottom row hug: slant -45, anchor one longest-name diagonal below the map
  const nmLen = (p) => `${p.num}. ${String(p.name)}`.length;
  const maxBExt = Bp.length ? Math.max(...Bp.map((p) => nmLen(p) * font * 0.55 * Math.SQRT1_2)) : 0;
  const rowY_B = Math.min(PH - FOOTER - 8, MAP_Y + MAP_H + maxBExt + 10);
  // in-state de-overlap (clusters in range mode, else individual pins)
  const rBadge = Math.max(5, font * 0.62);
  const statesPx = statesToPx(feats, proj);
  let dres;
  if (RANGE) {
    dres = placePinsInState({ pins: clusters.map((c, i) => ({ id: i, x: c.cx, y: c.cy, stateId: c.state })), states: statesPx, r: rBadge, gap: 1, iters: 400, maxDrift: 80 });
    const byId = new Map(dres.pins.map((q) => [q.id, q]));
    clusters.forEach((c, i) => { const q = byId.get(i); c.bx = q ? q.x : c.cx; c.by = q ? q.y : c.cy; });
  } else {
    dres = placePinsInState({ pins: P.map((p, i) => ({ id: i, x: p.px, y: p.py, stateId: p._state })), states: statesPx, r: rBadge, gap: 1, iters: 400, maxDrift: 80 });
    const byId = new Map(dres.pins.map((q) => [q.id, q]));
    P.forEach((p, i) => { const q = byId.get(i); if (q) { p.px = q.x; p.py = q.y; } });
  }
  // emit geometry (NOT svg): label positions + badge/dot positions
  const labels = [];
  const placeCol = (arr, x, anchor, side) => { const n = arr.length || 1, pitch = colH / n; arr.forEach((p, i) => labels.push({ x, y: colTop + pitch * (i + 0.5), pt: font, anchor, rotate: 0, num: p.num, name: String(p.name), side })); };
  const placeRow = (arr, y, side) => { const n = arr.length || 1, pitch = rowW / n; arr.forEach((p, i) => { const x = rowX0 + pitch * (i + 0.5); labels.push({ x, y, pt: font, anchor: 'start', rotate: -45, num: p.num, name: String(p.name), side }); }); };
  placeCol(Lp, lcolX, 'start', 'L'); placeCol(Rp, rcolX, 'end', 'R'); placeRow(Tp, rowY_T, 'T'); placeRow(Bp, rowY_B, 'B');
  const badges = [];
  if (RANGE) for (const c of clusters) badges.push({ x: c.bx, y: c.by, first: c.first, last: c.last, k: c.items.length, pt: font });
  const dots = RANGE ? clusters.map((c) => ({ x: c.bx, y: c.by })) : P.map((p) => ({ x: p.px, y: p.py, num: p.num }));
  // stats
  const marks = RANGE ? clusters.map((c) => ({ px: c.bx, py: c.by })) : P;
  const offFrame = marks.filter((q) => q.px < FRAME_X || q.px > FRAME_X + FRAME_W || q.py < FRAME_Y || q.py > FRAME_Y + FRAME_H).length;
  const allNums = P.map((p) => p.num).sort((a, b) => a - b);
  const numberDupes = allNums.filter((n, i) => i && n === allNums[i - 1]).length;
  const numbersRingOrdered = allNums.every((n, i) => n === i + 1);
  const stats = {
    placed: P.length, total: pins.length, namePt: +(font / PXI * 72).toFixed(1),
    crossings: 0, touches: 0, overflow: offFrame,
    numberDupes, numbersRingOrdered,
    pinsOutsideState: dres.outsideState, pinOverlaps: dres.overlapsRemaining,
    pinsMoved: dres.moved, maxDisp: +dres.maxDisp.toFixed(1), islandFallback, infeasible: dres.infeasible.length,
    sides: { L: Lp.length, R: Rp.length, T: Tp.length, B: Bp.length },
    rangeBadges: RANGE ? clusters.filter((c) => c.items.length > 1).length : 0,
  };
  return { numbers: P.map((p) => ({ id: p.id, num: p.num })), pins: P.map((p) => ({ id: p.id, x: p.px, y: p.py, num: p.num, side: p.side, state: p._state })), rows: { L: Lp.length, R: Rp.length, T: Tp.length, B: Bp.length }, leaders: [], badges, labels, dots, stats };
}

// ── PAIRED-ROWS (design 2): two groups per row, two octilinear leaders. ────────
function pairedRows({ pins, box, opts, fmt, measure, placePinsInState, forkRoute }) {
  const { MAP_X, MAP_W, MAP_Y, MAP_H, PXI, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, proj } = box;
  const feats = opts.feats || [];
  const P = pins.map((p) => ({ ...p, px: p._px, py: p._py }));
  // state assignment for spreading
  for (const p of P) {
    let st = null;
    for (const f of feats) if (inFeat(+p.lng, +p.lat, f.geometry)) { st = f.properties.shapeName; break; }
    if (!st) st = nearestState(+p.lng, +p.lat, feats);
    p._state = st;
  }
  // spread pins in-state (design 2 moves pins)
  const font = Math.max(5, (fmt.nameMaxPt || 11) / 72 * PXI);
  const rPin = Math.max(5, font * 0.62);
  const statesPx = statesToPx(feats, proj);
  if (feats.length) {
    const dres = placePinsInState({ pins: P.map((p, i) => ({ id: i, x: p.px, y: p.py, stateId: p._state })), states: statesPx, r: rPin, gap: 1, iters: 400, maxDrift: 80 });
    const byId = new Map(dres.pins.map((q) => [q.id, q]));
    P.forEach((p, i) => { const q = byId.get(i); if (q) { p.px = q.x; p.py = q.y; } });
    var spread = { outsideState: dres.outsideState, overlaps: dres.overlapsRemaining, moved: dres.moved, maxDisp: dres.maxDisp, infeasible: dres.infeasible.length };
  } else {
    var spread = { outsideState: 0, overlaps: 0, moved: 0, maxDisp: 0, infeasible: 0 };
  }
  // ring order: median x-split into L/R, then y within a side (monotone, non-crossing)
  const byX = [...P].sort((a, b) => a.px - b.px || cmpId(a.id, b.id));
  const half = Math.ceil(byX.length / 2);
  byX.forEach((p, i) => { p.side = i < half ? 'L' : 'R'; });
  const rowsOut = []; const leaderPolys = []; const allDots = P.map((p) => ({ id: p.id, x: p.px, y: p.py }));
  const bandTop = box.LABEL_TOP ?? MAP_Y, bandBot = box.LABEL_BOT ?? (MAP_Y + MAP_H);
  for (const side of ['L', 'R']) {
    const dirOut = side === 'L' ? -1 : 1;
    const laneX = side === 'L' ? MAP_X - 6 : MAP_X + MAP_W + 6;
    const col = P.filter((p) => p.side === side).sort((a, b) => a.py - b.py || cmpId(a.id, b.id));
    // two groups per row, in ring (y) order. A row's PORT sits at the mean y of its
    // own two pins (not an evenly-pitched slot): because the pairs are consecutive
    // in y, these port ys are themselves monotone, so each fork stays local to its
    // pins and neighbouring forks cannot sweep across one another. (An evenly-pitched
    // port put a row's port far from its pins and produced same-side crossings.)
    for (let i = 0; i < col.length; i += 2) {
      const a = col[i], b = col[i + 1] || col[i];
      const rowY = (a.py + (b.py)) / 2;
      const fork = forkRoute({
        lane: { x: laneX, y: rowY },
        a: { id: a.id, x: a.px, y: a.py }, b: { id: b.id, x: b.px, y: b.py },
        dirOut, mode: 'row',
        obstacles: allDots.filter((d) => d.id !== a.id && d.id !== b.id), r: rPin,
      });
      rowsOut.push({ side, rowY, aId: a.id, bId: b.id, octilinear: fork.octilinear, throughPins: fork.throughPins });
      leaderPolys.push({ id: `${side}${i}`, polys: fork.polys, segs: fork.segs });
    }
  }
  // crossings: one polyline id per fork (its deduped segs), skip same-id
  // build as [ [segpts...] per fork ] so countPolyCrossings skips intra-fork
  const perFork = leaderPolys.map((lp) => lp.segs.map((s) => [s[0], s[1]]));
  let crossings = 0;
  {
    const segs = [];
    perFork.forEach((forkSegs, li) => { for (const s of forkSegs) segs.push({ s, li }); });
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].li === segs[j].li) continue;
      if (segCrossXY(segs[i].s, segs[j].s)) crossings++;
    }
  }
  const touches = rowsOut.reduce((a, r) => a + (r.throughPins ? r.throughPins.length : 0), 0);
  const octilinear = rowsOut.every((r) => r.octilinear);
  const offFrame = P.filter((q) => q.px < FRAME_X || q.px > FRAME_X + FRAME_W || q.py < FRAME_Y || q.py > FRAME_Y + FRAME_H).length;
  const stats = {
    placed: P.length, total: pins.length, rows: rowsOut.length, namePt: +(font / PXI * 72).toFixed(1),
    crossings, touches, overflow: offFrame, octilinear,
    pinsOutsideState: spread.outsideState, pinOverlaps: spread.overlaps,
    pinsMoved: spread.moved, maxDisp: +(+spread.maxDisp).toFixed(1), infeasible: spread.infeasible,
  };
  return { numbers: P.map((p, i) => ({ id: p.id, num: i + 1 })), pins: P.map((p) => ({ id: p.id, x: p.px, y: p.py, state: p._state })), rows: rowsOut, leaders: leaderPolys.map((lp) => ({ id: lp.id, polys: lp.polys || null, segs: lp.segs })), badges: [], labels: [], dots: allDots, stats };
}

// ── SIDE-LANES (today's L/R large sheet). Ported from layoutLabels + lanes. ─────
// Pins are NOT moved. Returns leader polylines (octilinear) + label ports + stats.
function sideLanes({ pins, box, opts, fmt, measure }) {
  const { MAP_X, MAP_W, MAP_Y, MAP_H, SHEET_EDGE, GUTTER, PXI, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, proj } = box;
  const photoOf = opts.photoOf || (() => null);
  // project + clamp into the map rect (uses engine-settled _px/_py when present)
  const items = pins.map((p) => {
    const [lx, ly] = (p._fixed || p._px != null) ? [p._px, p._py] : proj(+p.lng, +p.lat);
    const x = Math.max(MAP_X + 2, Math.min(MAP_X + MAP_W - 2, lx));
    const y = Math.max(MAP_Y + 2, Math.min(MAP_Y + MAP_H - 2, ly));
    return { ...p, px: x, py: y };
  });
  // median x-split → L/R (disjoint bands, non-crossing by construction)
  const byX = [...items].sort((a, b) => a.px - b.px || cmpId(a.id, b.id));
  const halfB = Math.ceil(byX.length / 2);
  byX.forEach((it, i) => { it.side = i < halfB ? 'L' : 'R'; });
  const LABEL_TOP = box.LABEL_TOP ?? MAP_Y, LABEL_BOT = box.LABEL_BOT ?? (MAP_Y + MAP_H);
  const segCross = (a, b) => {
    const d = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) - (p2.y - p1.y) * (p3.x - p1.x);
    const A1 = { x: a.sx, y: a.sy }, A2 = { x: a.px, y: a.py };
    const B1 = { x: b.sx, y: b.sy }, B2 = { x: b.px, y: b.py };
    return (d(A1, A2, B1) > 0) !== (d(A1, A2, B2) > 0) && (d(B1, B2, A1) > 0) !== (d(B1, B2, A2) > 0);
  };
  // intra-column ring order by greedy crossing repair (bubble on adjacent pairs)
  for (const sd of ['L', 'R']) {
    const col = items.filter((i) => i.side === sd).sort((a, b) => a.py - b.py || cmpId(a.id, b.id));
    const n2 = col.length || 1;
    const rowH0 = (LABEL_BOT - LABEL_TOP) / n2;
    const sxCol = sd === 'L' ? MAP_X - 6 : MAP_X + MAP_W + 6;
    col.forEach((it, i) => { it.sx = sxCol; it.sy = LABEL_TOP + rowH0 * (i + 0.5); });
    for (let pass = 0; pass < 60; pass++) {
      let improved = false;
      for (let i = 0; i < col.length - 1; i++) {
        const a = col[i], b = col[i + 1];
        const before = segCross(a, b) ? 1 : 0;
        const ay = a.sy, by = b.sy; a.sy = by; b.sy = ay;
        const after = segCross(a, b) ? 1 : 0;
        if (after < before) { col[i] = b; col[i + 1] = a; improved = true; } else { a.sy = ay; b.sy = by; }
      }
      if (!improved) break;
    }
    col.forEach((it, i) => { it.ringIdx = i; });
  }
  // place rows in ring order, evenly pitched over the band; assign lanes
  const SHEET_MARGIN = SHEET_EDGE + 8;
  const LANE_EDGE_GAP = 6, LABEL_GAP = 6, LANE_PITCH_MAX = 3;
  const LABEL_RES = GUTTER - SHEET_MARGIN - LANE_EDGE_GAP - 24;
  const laid = [];
  for (const side of ['L', 'R']) {
    const col = items.filter((i) => i.side === side).sort((a, b) => a.ringIdx - b.ringIdx);
    const n = col.length || 1;
    const bandH = LABEL_BOT - LABEL_TOP, rowH = bandH / n;
    const dirOut = side === 'L' ? -1 : 1;
    const edge = side === 'L' ? MAP_X : MAP_X + MAP_W;
    const band = MAP_X - LABEL_RES - LANE_EDGE_GAP - LABEL_GAP;
    const pitch = Math.min(LANE_PITCH_MAX, band / Math.max(1, n - 1));
    col.forEach((it, k) => {
      it.labelY = LABEL_TOP + rowH * (k + 0.5);
      it.laneX = edge + dirOut * (LANE_EDGE_GAP + k * pitch);
      it.dirOut = dirOut;
      it.tanchor = side === 'L' ? 'end' : 'start';
      laid.push(it);
    });
  }
  // route leaders at dfrac 0 (current dev sweep is [0]); octilinear by construction
  const routesFor = (d) => laid.map((it) => octiRoute(it, it.laneX, it.dirOut, d));
  let bestD = 0, bestX = Infinity;
  for (const d of [0]) { const x = countPolyCrossings(routesFor(d)); if (x < bestX) { bestX = x; bestD = d; } }
  const routes = routesFor(bestD);
  const octiOK = routes.every((r) => isOctilinear(r));
  const dots = laid.map((it) => ({ id: it.id, x: it.px, y: it.py }));
  const touches = countTouches(routes.map((pts, i) => ({ id: laid[i].id, pts })), dots, 2);
  const stats = {
    placed: laid.length, total: pins.length, crossings: bestX, touches, overflow: 0,
    octilinear: octiOK, dfrac: bestD, pinsOutsideState: 0,
    photos: laid.filter((it) => photoOf(it)).length,
    sides: { L: items.filter((i) => i.side === 'L').length, R: items.filter((i) => i.side === 'R').length },
  };
  return {
    numbers: [], pins: laid.map((it) => ({ id: it.id, x: it.px, y: it.py })),
    rows: [], badges: [],
    labels: laid.map((it) => ({ x: it.laneX, y: it.labelY, anchor: it.tanchor, name: String(it.name) })),
    leaders: routes.map((pts, i) => ({ id: laid[i].id, pts })),
    dots, stats,
  };
}

export default layoutCircular;
