/**
 * fork-leaders.js — route ONE paired-row leader as an octilinear fork.
 *
 * A paired row has two pins (a, b) sharing one lane port on the frame margin.
 * Instead of two separate leaders, one stem leaves the port and FORKS at a 45°
 * chamfer into two short legs, one to each pin. This is the per-fork geometry
 * only; the caller pairs the rows, assigns the lanes and batches every row's
 * polylines through the engine's crossing counter.
 *
 * It imitates poster-render.js's octiRoute: a trace built from horizontal,
 * vertical and exact-45° segments, STUB 7 off the port, 45° chamfer corners, no
 * curves. The output is POLYLINES ([[x,y],…]) so it drops straight into
 * countPolyCrossings (which skips same-polyline pairs by index).
 *
 * MODES (c1/c2):
 *   'row'   — fork AT the row end: the stem is ~0, both legs leave the lane port
 *             directly to a and b. No long trunk across the page.
 *   'trunk' — the stem runs `dirOut` onto the page toward the pair's midpoint
 *             (by forkFrac of the port→midpoint horizontal budget), THEN forks
 *             near the pins.
 *
 * PX ONLY. DETERMINISTIC: no Math.random; forkFrac is the caller's sweep knob,
 * every value octilinear, so the caller's min-crossing winner is still octilinear.
 *
 * @param {object} o
 * @param {{x:number,y:number}} o.lane     the row's lane port on the margin.
 * @param {{id?:any,x:number,y:number}} o.a first pin (true de-overlapped coords, in its state).
 * @param {{id?:any,x:number,y:number}} o.b second pin.
 * @param {number} o.dirOut                +1 or -1: horizontal sense from the lane toward the map.
 * @param {'row'|'trunk'} [o.mode='row']
 * @param {number} [o.forkFrac=0.5]        'trunk' only: fraction of the port→midpoint
 *                                         horizontal budget the stem spends before forking (0..1).
 * @param {Array<{id?:any,x:number,y:number}>} [o.obstacles=[]] other pins to test legs against.
 * @param {number} [o.r=0]                 a leg "passes through" an obstacle if within r of it.
 * @returns {{
 *   stem: Array<[number,number]>, legA: Array<[number,number]>, legB: Array<[number,number]>,
 *   polys: Array<Array<[number,number]>>,  // [stem+legA, stem+legB] — for DRAWING
 *   segs: Array<[[number,number],[number,number]]>, // the fork's UNIQUE segments
 *     (stem once + each leg), deduped. Count crossings BETWEEN forks by giving
 *     every fork ONE polyline id — do NOT flatten polys into two ids, or a fork's
 *     own two arms sharing the stem score as self-crossings. Feed one fork's segs
 *     under one `li` to countPolyCrossings (as a single many-point run is not
 *     possible for a branch, pass segs with a shared index).
 *   octilinear: boolean,
 *   throughPins: Array<any>,               // obstacle ids (or indices) a leg passes through
 *   d: string,                             // convenience SVG path (derived from polys)
 * }}
 */
export function forkRoute({ lane, a, b, dirOut, mode = 'row', forkFrac = 0.5, obstacles = [], r = 0 }) {
  if (!lane || !a || !b) throw new TypeError('lane, a and b are required');
  if (dirOut !== 1 && dirOut !== -1) throw new TypeError('dirOut must be +1 or -1');
  if (mode !== 'row' && mode !== 'trunk') throw new TypeError("mode must be 'row' or 'trunk'");

  const STUB = 7;
  const ff = clamp01(forkFrac);

  // The fork point. 'row' forks essentially at the port (a tiny stub so the two
  // legs don't start exactly on the margin). 'trunk' walks dirOut toward the
  // pair's midpoint x by forkFrac of the available horizontal budget.
  const midX = (a.x + b.x) / 2;
  const budget = Math.max(0, (midX - lane.x) * dirOut); // horizontal room port→midpoint in dirOut sense (≥0)
  const stemLen = mode === 'trunk' ? Math.max(STUB, ff * budget) : STUB;
  const forkX = lane.x + dirOut * stemLen;
  const forkPt = [forkX, lane.y];

  const stem = [[lane.x, lane.y], forkPt];

  const legA = octiLeg(forkPt, a, dirOut);
  const legB = octiLeg(forkPt, b, dirOut);

  const polyA = [...stem, ...legA.slice(1)]; // legs start at forkPt; avoid duplicating it
  const polyB = [...stem, ...legB.slice(1)];
  const polys = [polyA, polyB];

  // UNIQUE segments for crossing counts: the stem counted ONCE, then each leg.
  // (polys share the stem; counting them as two polylines would self-cross.)
  const segs = dedupeSegs([...toSegs(stem), ...toSegs(legA), ...toSegs(legB)]);

  const octilinear = isOctilinear(polyA) && isOctilinear(polyB);

  // Through-pin report: an obstacle the leg body passes within r of (excluding
  // the leg's own endpoint pin). Checked on legA/legB segments only — the stem
  // is shared and tested per-poly by the caller's crossing counter.
  const throughPins = [];
  if (obstacles.length && r > 0) {
    const own = new Set([idOf(a), idOf(b)]);
    for (const ob of obstacles) {
      const oid = idOf(ob);
      if (own.has(oid)) continue;
      if (segsPassThrough(polyA, ob, r) || segsPassThrough(polyB, ob, r)) throughPins.push(oid);
    }
  }

  return { stem, legA, legB, polys, segs, octilinear, throughPins, d: toPath(polyA) + ' ' + toPath(polyB) };
}

function toSegs(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push([pts[i], pts[i + 1]]);
  return out;
}
function dedupeSegs(segs) {
  const seen = new Set(), out = [];
  for (const s of segs) {
    const k = `${s[0][0]},${s[0][1]}|${s[1][0]},${s[1][1]}`;
    const k2 = `${s[1][0]},${s[1][1]}|${s[0][0]},${s[0][1]}`;
    if (seen.has(k) || seen.has(k2)) continue;
    seen.add(k); out.push(s);
  }
  return out;
}

// One octilinear leg from the fork point to a pin: a 45° chamfer that closes the
// shorter of |dx|,|dy|, then a straight H or V run for the remainder. This keeps
// every segment H, V or exact-45° (mirrors octiRoute's feeler+diag, two-pin).
function octiLeg(from, pin, dirOut) {
  const [fx, fy] = from;
  const dx = pin.x - fx;
  const dy = pin.y - fy;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  // Diagonal leg closes min(adx,ady) on both axes at 45°; the straight remainder
  // finishes on whichever axis still has distance left.
  const diag = Math.min(adx, ady);
  const sx = Math.sign(dx) || dirOut;   // if the pin is dead in line, lean outward
  const sy = Math.sign(dy) || 0;
  const corner = [fx + sx * diag, fy + sy * diag];
  // corner → pin is now purely horizontal (adx>ady) or vertical (ady>adx) or zero.
  const pts = [[fx, fy], corner];
  if (!almost(corner[0], pin.x) || !almost(corner[1], pin.y)) pts.push([pin.x, pin.y]);
  return pts;
}

// ── octilinear invariant (same test + eps as poster-render.js) ────────────────
function isOctilinear(pts, eps = 0.6) {
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = Math.abs(pts[i + 1][0] - pts[i][0]);
    const dy = Math.abs(pts[i + 1][1] - pts[i][1]);
    if (dx < eps || dy < eps) continue;        // horizontal or vertical
    if (Math.abs(dx - dy) < eps) continue;     // 45°
    return false;
  }
  return true;
}

// Does any segment of the polyline pass within r of point ob (not at an endpoint)?
function segsPassThrough(pts, ob, r) {
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distPointToSeg(ob.x, ob.y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d <= r) return true;
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

function toPath(pts) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${round(p[0])},${round(p[1])}`).join(' ');
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const almost = (u, v) => Math.abs(u - v) < 1e-6;
const round = (n) => Math.round(n * 100) / 100;
const idOf = (p) => (p && p.id !== undefined ? p.id : p);

export default forkRoute;
