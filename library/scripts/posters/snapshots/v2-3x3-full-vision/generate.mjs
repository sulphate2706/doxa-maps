// generate.mjs — UPG100-POSTERS generator (card 7c4feeda22bd8bc2, P2/P3)
//
// One self-hosted, print-deterministic SVG poster per leaf zone of the
// my-upg-100-list map. NO Mapbox, NO token, NO external fetch at render time,
// NO npm installs — pure Node 22 + the map's OWN zone-resolution logic (reused
// read-only) so every poster matches the live map exactly.
//
//   • basemap   : country (ADM0) + state-cluster (ADM1) polygons drawn as SVG
//                 from the geojson the map already ships (scope (B), approved).
//   • pins      : every people-group at its TRUE lat/lng (Web Mercator).
//   • labels    : the HARD part — names de-overlapped via a two-gutter CALLOUT
//                 layout + LEADER LINES (pins never move; labels stack in the
//                 left/right margins, ordered by latitude, connected by lines).
//   • aspect    : portrait 3:4 (3ft × 4ft). Rendered at CSS 1350×1800; shoot.mjs
//                 screenshots at deviceScaleFactor 4 → 5400×7200 px (~150 DPI @ 3ft).
//
// Usage:  node generate.mjs            # all 28 zones
//         ONLY=laos node generate.mjs  # one zone (smoke test)
//
// Output: out/posters/<zoneKey>.html  +  out/manifest.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.UPG100_DATA_PATH ? resolve(process.env.UPG100_DATA_PATH) : join(__dirname, '..', 'plugin-designs', 'my-upg-100-list', 'data');
const OUT = join(__dirname, 'out');
const POSTERS = join(OUT, 'posters');
mkdirSync(POSTERS, { recursive: true });

// ── the map's own logic, reused read-only ────────────────────────────────────
const { buildLegendNodes, leafZones } = await import(join(DATA, 'legend-tree.js'));
const { resolveZoneGeometry } = await import(join(DATA, 'zone-geometry.js'));
const { evaluate } = await import(join(DATA, 'selector-evaluator.js'));
const { normalizeRecords, extractRecords } = await import(join(DATA, 'normalize.js'));
// The adm0 geojson carries ONLY { iso3 } — no country names at all — so the label
// text has to come from the map's own ISO3 dictionary rather than the geometry.
const { ISO3_NAME } = await import(join(DATA, 'territory-counts.js'));

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clusters = readJSON(join(DATA, 'clusters.json'));
const adm0 = readJSON(join(DATA, 'adm0', 'world-adm0.geojson'));
const adm1Ind = readJSON(join(DATA, 'gb-IND-ADM1.geojson'));
const adm1Chn = readJSON(join(DATA, 'gb-CHN-ADM1.geojson'));

// CONFIG-ONLY, FAIL-CLOSED — mirrors src/api-connections/apiBaseUrl.js. The data
// host comes SOLELY from build-time config; there is deliberately NO default host
// so an unconfigured run never silently phones home to someone else's data source.
const API = process.env.VITE_API_BASE_URL || process.env.MAP_APP_API_URL;
if (!API) {
  console.error('[generate] No API base configured — set VITE_API_BASE_URL to your data source. Failing closed: no request will be made.');
  process.exit(1);
}
const FIELDS = 'slug,name,country_code,wagf_region,wagf_block,rop1,population,latitude,longitude';

// ── fetch the live pins (the only network call; happens at GENERATE time only) ─
async function loadRecords() {
  const cache = join(__dirname, 'out', '_records.json');
  if (process.env.OFFLINE) { try { return readJSON(cache); } catch { /* fall through */ } }
  const url = `${API}/api/people-groups/list?fields=${FIELDS}&lang=en`;
  const resp = await fetch(url, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`PG API ${resp.status} ${url}`);
  const raw = await resp.json();
  const recs = normalizeRecords(extractRecords(raw));
  try { writeFileSync(cache, JSON.stringify(recs)); } catch { /* best effort cache */ }
  return recs;
}

// ── Web Mercator, fit a [W,S,E,N] bbox into a cw×ch box preserving aspect ──────
const mercX = (lng) => (lng + 180) / 360;
const mercY = (lat) => {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};
function makeProjection(bbox, cw, ch, padFrac = 0.06) {
  let [w, s, e, n] = bbox;
  // pad
  const dx = (e - w) * padFrac || 0.5, dy = (n - s) * padFrac || 0.5;
  w -= dx; e += dx; s -= dy; n += dy;
  const x0 = mercX(w), x1 = mercX(e), y0 = mercY(n), y1 = mercY(s); // y0<y1
  const sx = cw / (x1 - x0), sy = ch / (y1 - y0);
  const scale = Math.min(sx, sy);
  const offX = (cw - (x1 - x0) * scale) / 2;
  const offY = (ch - (y1 - y0) * scale) / 2;
  return (lng, lat) => [offX + (mercX(lng) - x0) * scale, offY + (mercY(lat) - y0) * scale];
}

// ── geojson → SVG path d (Polygon + MultiPolygon) ─────────────────────────────
function geoToPath(geom, project) {
  const rings = geom.type === 'Polygon' ? geom.coordinates
    : geom.type === 'MultiPolygon' ? geom.coordinates.flat() : [];
  let d = '';
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [px, py] = project(ring[i][0], ring[i][1]);
      d += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1);
    }
    d += 'Z';
  }
  return d;
}
function bboxOf(geom) {
  const rings = geom.type === 'Polygon' ? geom.coordinates
    : geom.type === 'MultiPolygon' ? geom.coordinates.flat() : [];
  let W = 180, S = 90, E = -180, N = -90;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < W) W = x; if (x > E) E = x; if (y < S) S = y; if (y > N) N = y;
  }
  return [W, S, E, N];
}
const bboxIntersect = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── OCTILINEAR leader routing (design decision: 45°/90° "techno" lane traces) ──
// Each leader is a Manhattan/octilinear "circuit-board" trace — ONLY horizontal,
// vertical, or exact 45° segments, sharp corners, no curves. It is channeled
// through a per-leader vertical LANE in the side margin so parallel runs separate
// and each stays followable; the corners are 45° chamfers (the "techno" bevel).
//
// Structure (left side; right mirrors) — ORTHOGONAL-DOMINANT so crossings stay
// near the proven 0-crossing boundary-labeling baseline (a big straight 45°
// diagonal per leader is what produced the earlier spaghetti of 500–650 crossings;
// a horizontal feeler at the pin's own latitude + a vertical run in a dedicated
// lane is the low-crossing shape, and the 45° chamfer gives the techno look):
//   (1) short horizontal stub off the pin
//   (2) horizontal feeler at the pin's TRUE latitude, stopping one chamfer short
//       of the lane   ── the run that keeps leaders in disjoint latitude bands
//   (3) 45° chamfer corner into the lane (sharp bevel, no curve)
//   (4) vertical run DOWN/UP the dedicated lane to the label's row
// The label sits at the lane, so the vertical ends exactly at the port (no jog).
// The vertical gap pin→label is covered by a 45° diagonal for a fraction `dfrac`
// of its length and by a straight in-lane vertical for the rest. dfrac is swept
// per poster (pickDiagFrac) to MINIMISE crossings — every value is octilinear, so
// the winner is the minimal-crossing octilinear layout for that poster. dfrac=0
// is a pure horizontal-feeler + vertical-lane trace (cleanest 90° grid); dfrac=1
// leans the leader into a 45° diagonal where the horizontal budget allows.
function octiRoute(it, laneX, dirOut, dfrac) {
  const STUB = 7;
  const P = [it.px, it.py];
  const xStub = it.px + dirOut * STUB;             // stub end (toward the margin)
  const dy = it.labelY - it.py;
  const vdir = dy === 0 ? 0 : Math.sign(dy);       // vertical sense toward the label
  const gap = Math.abs(xStub - laneX);             // horizontal budget stub→lane (≥0)
  const diag = Math.max(0, Math.min(dfrac * Math.abs(dy), gap)); // 45° leg (both axes)
  const feeler = gap - diag;                       // remaining horizontal at pin latitude
  const pts = [P, [xStub, it.py]];                 // (1) stub — horizontal
  pts.push([xStub + dirOut * feeler, it.py]);      // (2) feeler — horizontal at pin latitude
  pts.push([laneX, it.py + vdir * diag]);          // (3) 45° diagonal into the lane
  pts.push([laneX, it.labelY]);                    // (4) vertical run in the lane to the port
  return pts;
}
// every emitted segment must be horizontal (dy=0), vertical (dx=0) or 45° (|dx|=|dy|)
function isOctilinear(pts, eps = 0.6) {
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = Math.abs(pts[i + 1][0] - pts[i][0]), dy = Math.abs(pts[i + 1][1] - pts[i][1]);
    if (dx < eps || dy < eps) continue;            // horizontal or vertical
    if (Math.abs(dx - dy) < eps) continue;         // 45°
    return false;
  }
  return true;
}
function segCross(p, q) {
  const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  const [a, b] = p, [c, d] = q;
  const same = (u, v) => Math.abs(u[0] - v[0]) < 0.5 && Math.abs(u[1] - v[1]) < 0.5;
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
  const o1 = o(...a, ...b, ...c), o2 = o(...a, ...b, ...d), o3 = o(...c, ...d, ...a), o4 = o(...c, ...d, ...b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}
function countPolyCrossings(polys) {
  const segs = [];
  polys.forEach((pts, li) => { for (let i = 0; i < pts.length - 1; i++) segs.push({ s: [pts[i], pts[i + 1]], li }); });
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (segs[i].li === segs[j].li) continue;
    if (segCross(segs[i].s, segs[j].s)) n++;
  }
  return n;
}

// ── poster geometry constants (CSS px; 3:4) ──────────────────────────────────
// ── SHEET FORMAT ────────────────────────────────────────────────────────────
// Parameterised rather than hardcoded, so a new aspect is one env var and not an
// edit: FORMAT=3x4 (default, portrait) | 3x3 (square).
// Everything downstream derives from PW/PH — the map frame fits the region inside
// whatever is left after the header, footer and gutters, so a format change does
// not require re-tuning the layout by hand.
const FORMATS = {
  '3x4': { w: 1350, h: 1800, gutter: 210, page: '3in 4in' },
  // Square: a 3ft x 3ft sheet. The map loses height relative to 3x4, so the
  // gutters widen slightly — with fewer label rows per column the names can take
  // more width, and the map stays close to square rather than becoming a letterbox.
  // gutter 250 -> 200 a side: the label columns do not need 500px of the sheet,
  // and the map does. +100px of map width at the same sheet size.
  '3x3': { w: 1500, h: 1500, gutter: 200, page: '3in 3in' },
};
const FMT = FORMATS[process.env.FORMAT || '3x4'] || FORMATS['3x4'];
// Stamped at generation time. Overridable so a rebuild can reproduce an existing
// sheet byte-for-byte — print determinism matters more than always-now.
const POSTER_DATE = process.env.POSTER_DATE
  || new Date().toISOString().slice(0, 10);
const PW = FMT.w, PH = FMT.h;
// HEADER carries the title, the Countries/Provinces list, the vision block AND
// the "Ways to use this map" examples; FOOTER carries only the scripture, so it
// stays slim. HEADER must exceed HEAD_BOTTOM (headY 104 + 298 = 402) or the map
// frame is drawn over the last lines of the examples list.
// HEADER carries the title, the facts table and the vision columns.
// FOOTER carries the BELOW-MAP sandwich (the goal question + the three networks)
// AND the scripture, so it is now the taller of the two. Both are checked at
// render time by fail-loud guards — see HEAD_BOTTOM and FOOT_LIMIT.
const HEADER = 460, FOOTER = 255;
// GUTTER was 300px A SIDE — 600 of 1350 (44% of the sheet) given to text, leaving
// the map only 750px wide. The names are short and do not need that; the MAP does.
// At 210 a side the map grows 750 -> 930 (+24% width, +24% linear scale), which is
// what gives the pins room to stop overlapping. The poster's own aspect ratio is
// untouched — PW/PH are unchanged; only the split between map and margin moves.
// Label column (LABEL_RES) drops to match, still comfortably wider than the
// longest people-group name at this size.
const GUTTER = FMT.gutter, GPAD = 16;
const MAP_X = GUTTER, MAP_Y = HEADER;
const MAP_W = PW - 2 * GUTTER, MAP_H = PH - HEADER - FOOTER;

// distribute pins into left/right gutters, balanced, return label rows w/ leader anchors
// Label rows are confined to the MAP BAND, not the whole sheet. When the map
// frame fits a landscape region it occupies only part of the sheet height, and
// labels spread over the full height then sat beside blank paper with their
// connectors pointing at nothing.
let LABEL_TOP = null, LABEL_BOT = null;
function layoutLabels(pins, project) {
  // project + clamp into the map content rect for the leader-line origin
  const items = pins.map((p) => {
    // _fixed pins carry positions already settled by the de-overlap pass; do not
    // re-project them or the separation work is thrown away.
    const [lx, ly] = p._fixed ? [p._px, p._py] : project(p.lng, p.lat);
    const x = Math.max(MAP_X + 2, Math.min(MAP_X + MAP_W - 2, lx));
    const y = Math.max(MAP_Y + 2, Math.min(MAP_Y + MAP_H - 2, ly));
    return { ...p, px: x, py: y };
  });
  // GUARANTEED NON-CROSSING side assignment (anti-overlap math).
  // Sort pins by px and split at the median index: the left half of pins (by
  // longitude) take the LEFT gutter, the right half the RIGHT. Because every
  // left pin sits physically left of every right pin, the two leader fans
  // occupy DISJOINT horizontal bands (meeting only at the median x) and cannot
  // cross each other. Within a gutter, `place()` orders the ports by pin
  // latitude (py), so the leaders form a monotonic fan to a common vertical
  // port line — the classical boundary-labeling result that straight leaders
  // are non-crossing iff the point→port assignment preserves y-order. The two
  // properties together → no leader line crosses another. (Counts are balanced
  // to ±1, so neither gutter is overcrowded and labels stay legible.)
  // Y-ORDER BASELINE (median x-split, then y within each side).
  const byX = [...items].sort((a, b) => a.px - b.px);
  const halfB = Math.ceil(byX.length / 2);
  byX.forEach((it, i) => { it.side = i < halfB ? 'L' : 'R'; });
  // INTRA-COLUMN ordering by GREEDY CROSSING REPAIR.
  // The median x-split already yields ZERO inter-column crossings (measured), so
  // the hard rule is satisfied by construction. Everything left is within
  // one column's fan.
  //
  // Sorting by y is the classic answer but is NOT optimal here, because the slots
  // are evenly pitched while the pins are not: a pin's slot y and its own y differ,
  // and two leaders cross exactly when that difference inverts between them.
  // Rather than guess an ordering heuristic, repair directly: start from y-order,
  // then repeatedly swap any ADJACENT pair whose swap reduces the crossing count.
  // Adjacent swaps are enough because a crossing between two leaders in the same
  // fan is precisely an inversion, and bubble-style repair removes inversions.
  const segCross = (a, b) => {
    const d = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) - (p2.y - p1.y) * (p3.x - p1.x);
    const A1 = { x: a.sx, y: a.sy }, A2 = { x: a.px, y: a.py };
    const B1 = { x: b.sx, y: b.sy }, B2 = { x: b.px, y: b.py };
    return (d(A1, A2, B1) > 0) !== (d(A1, A2, B2) > 0)
        && (d(B1, B2, A1) > 0) !== (d(B1, B2, A2) > 0);
  };
  for (const sd of ['L', 'R']) {
    const col = items.filter((i) => i.side === sd).sort((a, b) => a.py - b.py);
    const n2 = col.length || 1;
    const bandTop0 = LABEL_TOP ?? MAP_Y, bandBot0 = LABEL_BOT ?? (MAP_Y + MAP_H);
    const rowH0 = (bandBot0 - bandTop0) / n2;
    // FRAME_W is computed per-poster in the caller and is NOT in scope here; the
    // module-level MAP_W is the same width for the label geometry's purposes.
    const sxCol = sd === 'L' ? MAP_X - 6 : MAP_X + MAP_W + 6;
    const setSlots = () => col.forEach((it, i) => { it.sx = sxCol; it.sy = bandTop0 + rowH0 * (i + 0.5); });
    setSlots();
    // Bubble-repair: swap adjacent rows whenever it strictly reduces crossings.
    for (let pass = 0; pass < 60; pass++) {
      let improved = false;
      for (let i = 0; i < col.length - 1; i++) {
        const a = col[i], b = col[i + 1];
        const before = segCross(a, b) ? 1 : 0;
        const ay = a.sy, by = b.sy;
        a.sy = by; b.sy = ay;
        const after = segCross(a, b) ? 1 : 0;
        if (after < before) { col[i] = b; col[i + 1] = a; improved = true; }
        else { a.sy = ay; b.sy = by; }
      }
      if (!improved) break;
    }
    col.forEach((it, i) => { it.ringIdx = i; });
  }

  const place = (side) => {
    // Order within a column is: the TOP-band quadrant (sorted by pin y), then the
    // BOTTOM-band quadrant (sorted by pin y). Sorting by y INSIDE each band is the
    // monotonicity property — within a quadrant, label order matches pin order, so
    // leaders in the same quadrant cannot cross each other.
    // Rows follow the RING ORDER, not y — that ordering is the whole mechanism.
    const col = items.filter((i) => i.side === side).sort((a, b) => a.ringIdx - b.ringIdx);
    const n = col.length || 1;
    // Rows fill the MAP BAND, not the whole sheet. When the frame fits a landscape
    // region it occupies only part of the sheet height; labels spread over the full
    // height then sat beside blank paper with their connectors pointing at nothing.
    // Rows span the PINS' OWN vertical extent, not the whole frame. The map frame
    // is full sheet height but the pins occupy only a band within it, so labels
    // spread over the full height put "bottom quadrant" names far below any
    // bottom-quadrant pin — every one of those leaders then ran steeply upward,
    // which is exactly the long diagonal the quadrant scheme exists to remove.
    const pinYs = col.map((it) => it.py);
    const pinTop = Math.min(...pinYs), pinBot = Math.max(...pinYs);
    // FULL FRAME HEIGHT, evenly pitched (design, designer call). The label band
    // used to be blended toward the pins' own extent to shorten leaders — it cut
    // crossings 77 -> 24 but left the names bunched mid-sheet with empty margin
    // above and below. Longer leaders are the accepted cost: a poster is looked
    // at, not audited, and even spacing edge-to-edge reads better AND buys the
    // type more room.
    const bandTop = LABEL_TOP ?? MAP_Y;
    const bandBot = LABEL_BOT ?? (MAP_Y + MAP_H);
    const bandH = bandBot - bandTop;
    const rowH = bandH / n;
    const font = Math.max(8, Math.min(15, rowH * 0.62));
    col.forEach((it, i) => {
      it.labelY = bandTop + rowH * (i + 0.5);
      it.font = font;
      it.rowH = rowH;
      // gutter inner edge (where the leader meets the text block)
      it.dotX = side === 'L' ? MAP_X - 6 : MAP_X + MAP_W + 6;
      it.textX = side === 'L' ? MAP_X - GPAD : MAP_X + MAP_W + GPAD;
      it.anchor = side === 'L' ? 'end' : 'start';
    });
    return col;
  };
  return [...place('L'), ...place('R')];
}

// ── footer Scripture ─────────────────────────────────────────────────────────
// The feeding of the 5000 — Jesus had the crowd sit "in groups of hundreds and
// of fifties" (Mark 6:40 / Luke 9:14). That 50/100 grouping is the motif behind
// the my-upg-100-list: the harvest seated in countable companies, none forgotten.
// Override per region via VERSE_BY_ZONE (keyed by zoneKey or zone.id).
const DEFAULT_VERSE = {
  text: 'And they sat down in groups, by hundreds and by fifties.',
  ref: 'Mark 6:40',
};
const VERSE_BY_ZONE = {
  // 'asia-india-andhra-pradesh': { text: '…', ref: '…' },
};
const verseFor = (zone) => VERSE_BY_ZONE[zone.zoneKey] || VERSE_BY_ZONE[zone.id] || DEFAULT_VERSE;

// ── TEXT MEASUREMENT + COLUMN WRAPPING (for the header grid) ─────────────────
// SVG <text> does not word-wrap, so a multi-column header has to be broken into
// lines HERE. Widths come from the same per-character advance table the label
// underlines use — it is approximate but consistent, and consistency is what a
// column needs: every line in a column is measured by the same ruler.
const CHADV = (ch) => {
  if ('iIjl|.,:;\'! '.includes(ch)) return 0.28;
  if ('ftr()[]-'.includes(ch)) return 0.34;
  if ('mwMW'.includes(ch)) return 0.86;
  if ('ABCDEFGHKLNOPQRSTUVXYZ0123456789'.includes(ch)) return 0.63;
  return 0.53;
};
// Width of a plain string at a given font size, in px.
// CALIBRATED AGAINST THE RENDERER, not guessed. The raw advance table averages
// ~0.45/char over ordinary prose, but Lato at 12.5px measured 0.498/char across
// 8 rendered lines (getBBox in Firefox) — an 11% under-estimate, which let every
// column overrun its own rule. Measure, then correct; do not re-tune by eye.
const WFUDGE = 1.11;
const textW = (str, fs) => [...str].reduce((a, ch) => a + CHADV(ch), 0) * fs * WFUDGE;
// Greedy word-wrap to a pixel width. Returns an array of lines.
function wrapPx(str, fs, maxW) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (textW(next, fs) > maxW && line) { out.push(line); line = w; }
    else line = next;
  }
  if (line) out.push(line);
  return out;
}
// Emit one wrapped paragraph into a column. `lead` markup (e.g. a bold run-in)
// is applied to the opening words of the first line only.
// Returns the y AFTER the last line.
function paraInto(push, text, { x, y, w, fs, lh, cls, lead }) {
  const full = lead ? `${lead} ${text}` : text;
  const lines = wrapPx(full, fs, w);
  let cy = y;
  for (let i = 0; i < lines.length; i++) {
    let body = esc(lines[i]);
    // Re-apply the run-in emphasis to however much of it landed on line 0.
    if (i === 0 && lead) {
      const le = esc(lead);
      if (body.startsWith(le)) body = `<tspan class="hsrc-em">${le}</tspan>` + body.slice(le.length);
    }
    push(`<text x="${x}" y="${cy}" class="${cls}">${body}</text>`);
    cy += lh;
  }
  return cy;
}

function renderPoster(zone, pins, zoneFC) {
  // bbox: prefer resolved polygons; fallback to pins
  let bbox;
  if (zoneFC.features.length) {
    let W = 180, S = 90, E = -180, N = -90;
    for (const f of zoneFC.features) { const b = bboxOf(f.geometry); if (b[0] < W) W = b[0]; if (b[1] < S) S = b[1]; if (b[2] > E) E = b[2]; if (b[3] > N) N = b[3]; }
    bbox = [W, S, E, N];
  } else {
    let W = 180, S = 90, E = -180, N = -90;
    for (const p of pins) { if (p.lng < W) W = p.lng; if (p.lng > E) E = p.lng; if (p.lat < S) S = p.lat; if (p.lat > N) N = p.lat; }
    bbox = [W, S, E, N];
  }
  const FRAME_X = MAP_X;
  const proj = (lng, lat) => { const [x, y] = project(lng, lat); return [FRAME_X + x, FRAME_Y + y]; };
  // 25% context pad on EVERY side, on top of the projection's own 6%, left the
  // subject floating small inside a large empty frame — the poster's whole middle
  // was neighbouring land and sea. 10% still shows the surrounding countries (the
  // the brief calls for them named and visible) while letting the zone fill the sheet.
  // Enough surrounding land to PLACE the region on the globe. 10% showed barely
  // any neighbours; 22% brings in the countries that answer "where is this?"
  const pad = [(bbox[2] - bbox[0]) * 0.22 + 1, (bbox[3] - bbox[1]) * 0.22 + 1];
  const viewBbox = [bbox[0] - pad[0], bbox[1] - pad[1], bbox[2] + pad[0], bbox[3] + pad[1]];

  // ── FIT THE MAP FRAME TO THE REGION'S SHAPE ────────────────────────────────
  // The map frame was a fixed portrait rect (930x1580, aspect 0.59) but this
  // region is LANDSCAPE (aspect 1.26). makeProjection fits with Math.min(sx,sy),
  // so width bound and the region floated in a tall letterboxed void — roughly
  // half the sheet was empty sea and sky.
  // Now the frame takes the region's own aspect, capped so it never gets so short
  // that the label columns have nowhere to sit. The POSTER aspect is untouched;
  // only the map's share of it moves, and the freed height goes to the margins.
  const SHEET_MARGIN_X = 30;
  const mercYr = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI / 180) / 2));
  const zoneAspect = (viewBbox[2] - viewBbox[0]) / (((mercYr(viewBbox[3]) - mercYr(viewBbox[1])) * 180) / Math.PI);
  // A landscape region should be allowed to use the FULL sheet width. Capping it
  // at MAP_W (sheet minus two 210px gutters) meant this region could only reach
  // 887px of the 1580px band — 693px of dead paper. The gutters do not need to be
  // full-height: the labels now track the map band, so the map may extend past
  // them vertically and the names simply sit alongside where it is.
  const FRAME_W = MAP_W;
  // The frame keeps the SHEET's height and simply shows more surrounding land
  // above and below the region. Fitting the frame tightly to the region's own
  // aspect looked correct in isolation but left 693px of dead paper on the sheet,
  // and a poster cannot have a void that size. Extra context is not waste: the
  // the brief asked for neighbouring countries to be visible and named, and a taller
  // frame is exactly what shows them.
  // FULL SHEET HEIGHT — the map runs from just under the header to just above the
  // footer rule, so there is no dead band anywhere on the page.
  const FRAME_H = MAP_H;
  // OPTICAL CENTRING, not geometric. A block centred by arithmetic looks like it
  // is falling off the bottom of the sheet — the optical centre sits ABOVE the
  // geometric one, which is why framers cut a bottom mat 1.25-1.4x the top. Here
  // the remainder is split 42/58 so the bottom margin is the larger one.
  const FRAME_Y = MAP_Y;
  const project = makeProjection(bbox, FRAME_W, FRAME_H, 0.08);
  // Hand the label layout the map band so names track the map, not the sheet.
  LABEL_TOP = FRAME_Y; LABEL_BOT = FRAME_Y + FRAME_H;

  const color = zone.color || '#2bb';
  // context countries (faint) — any adm0 whose bbox intersects the view
  let ctx = '';
  // Context countries + their NAMES. Previously these drew as an almost-invisible
  // wash with no labels at all, so a reader could not tell what land surrounded
  // the highlighted zone. Imhof's figure-ground: the surround must be legible but
  // clearly subordinate — separation by VALUE, with a hairline edge so
  // near-identical fills still read (Tufte separates 3% and 7% tints this way).
  const ctxLabels = [];
  for (const f of adm0.features) {
    const fb = bboxOf(f.geometry);
    if (!bboxIntersect(fb, viewBbox)) continue;
    ctx += `<path d="${geoToPath(f.geometry, proj)}" class="ctry"/>`;
    // Label the LARGEST VISIBLE RING, not the feature's bbox centre.
    // A bbox centre is wrong for two independent reasons here:
    //   1. ANTIMERIDIAN — the USA spans Alaska (-178) to the Aleutians (+179), so
    //      its bbox centre is 0.8E: the middle of the Sahara. It really did print
    //      "UNITED STATES" over Algeria.
    //   2. Multi-part countries (islands, exclaves) put the centre in open water.
    // Taking the biggest ring that actually intersects the view fixes both, and is
    // also what makes the label land ON the landmass a reader associates it with.
    const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]]
                : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map((poly) => poly[0])
                : [];
    let best = null, bestArea = 0;
    for (const ring of rings) {
      let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
      for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (!bboxIntersect([x0, y0, x1, y1], viewBbox)) continue;
      const vx0 = Math.max(x0, viewBbox[0]), vx1 = Math.min(x1, viewBbox[2]);
      const vy0 = Math.max(y0, viewBbox[1]), vy1 = Math.min(y1, viewBbox[3]);
      const area = (vx1 - vx0) * (vy1 - vy0);
      if (area > bestArea) { bestArea = area; best = [vx0, vy0, vx1, vy1]; }
    }
    if (!best) continue;
    const wFrac = (best[2] - best[0]) / (viewBbox[2] - viewBbox[0]);
    const hFrac = (best[3] - best[1]) / (viewBbox[3] - viewBbox[1]);
    // Area test, not an AND of both axes: requiring both rejected every country
    // whose visible slice is wide-but-short or tall-but-narrow.
    // Threshold lowered hard: the point of the surrounding countries is to say
    // WHERE ON THE GLOBE this is, and that only works if enough of them are named.
    // Previously most neighbours were rejected and the region floated unplaced.
    if (wFrac * hFrac < 0.00025 || wFrac < 0.012 || hFrac < 0.008) continue;
    const nm = ISO3_NAME[f.properties?.iso3] || f.properties?.iso3;
    if (!nm) continue;
    // proj takes (lng, lat) as TWO ARGS — passing an array yields NaN silently,
    // which put every label at x="NaN" and rendered nothing at all.
    // A BBOX CENTRE IS NOT A POINT INSIDE THE SHAPE. China's visible slice is a
    // wide east-west band across the top of the crop; the centre of that box sits
    // SOUTH of the border — inside Nepal — so the poster printed "CHINA" in Nepal.
    // Sample candidate points inside the clipped box and keep the one that is
    // actually inside the country's own polygon and furthest from its edges. This
    // is a coarse pole-of-inaccessibility: it guarantees the name lands on its own
    // land rather than on a neighbour's.
    const ringsOf = (geom) => geom.type === 'Polygon' ? [geom.coordinates[0]]
      : geom.type === 'MultiPolygon' ? geom.coordinates.map((poly) => poly[0]) : [];
    const inRing = (px, py, ring) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    const cand = [];
    const R = ringsOf(f.geometry);
    for (let gx = 1; gx <= 7; gx++) {
      for (let gy = 1; gy <= 7; gy++) {
        const cxp = best[0] + ((best[2] - best[0]) * gx) / 8;
        const cyp = best[1] + ((best[3] - best[1]) * gy) / 8;
        if (!R.some((ring) => inRing(cxp, cyp, ring))) continue;
        // score = distance to the nearest edge of the clipped box (keeps it central)
        const d = Math.min(cxp - best[0], best[2] - cxp, cyp - best[1], best[3] - cyp);
        cand.push({ cxp, cyp, d });
      }
    }
    if (!cand.length) continue;                  // no interior point in view — skip it
    cand.sort((a, b) => b.d - a.d);
    const [lx, ly] = proj(cand[0].cxp, cand[0].cyp);
    // IS THIS COUNTRY PART OF THE ZONE, or merely a neighbour in view?
    // A zone whose members are mixed geometry (ADM1 provinces + a whole ADM0, as in
    // North India + Nepal) was labelling its OWN member country in the neighbour
    // style — so Nepal read as context, exactly like China, even though its land is
    // filled in the zone colour and 34 of the sheet's people groups are inside it.
    const isMember = Array.isArray(zone.adm0)
      && zone.adm0.includes(String(f.properties?.iso3 || '').toUpperCase());
    ctxLabels.push({ x: lx, y: ly, nm: String(nm), member: isMember });
  }
  // ALL-CAPS country names, tracked +0.1em (Bringhurst 5-10% of type size; shipped
  // map styles converge on exactly 0.1em). Haloed to the PAPER colour, not white.
  let ctryNames = '';
  for (const L of ctxLabels) {
    // Bounds must use FRAME_X, not MAP_X — the map draws from FRAME_X, so testing
    // against MAP_X silently rejected labels that were genuinely inside the frame.
    // A CLAMP IS WRONG HERE AND PRINTED "CHINA" INSIDE UTTAR PRADESH.
    // Clamping drags a name to the frame edge nearest its true centre, so a country
    // that is mostly off-screen lands its label on whatever land happens to sit
    // there. China's visible slice is the Tibetan plateau to the north while its
    // ring centre is far east — the clamp parked it in the middle of India.
    // A wrong country name on a map is worse than no name at all.
    // Instead: keep only labels whose position is genuinely INSIDE the frame, and
    // place them at the centroid of the CLIPPED visible ring (computed above), so
    // the name sits on the country's own visible landmass or not at all.
    if (L.x < FRAME_X + 26 || L.x > FRAME_X + FRAME_W - 26) continue;
    if (L.y < FRAME_Y + 26 || L.y > FRAME_Y + FRAME_H - 26) continue;
    const t = esc(L.nm.toUpperCase());
    // Member countries take the same ink as the zone's own province names, so a
    // reader can tell at a glance which land the sheet is ABOUT and which is only
    // there for orientation.
    const cls = L.member ? 'ctry-name-own' : 'ctry-name';
    ctryNames += `<text x="${L.x.toFixed(1)}" y="${L.y.toFixed(1)}" text-anchor="middle" class="ctry-name-halo">${t}</text>`
              +  `<text x="${L.x.toFixed(1)}" y="${L.y.toFixed(1)}" text-anchor="middle" class="${cls}">${t}</text>`;
  }
  // ── NEIGHBOURING PROVINCES (context ADM1) ─────────────────────────────────
  // Previously only the ZONE's provinces were drawn, so everything around the
  // highlighted cluster was one undifferentiated wash — a reader could not tell
  // which province was which, or that there were provinces at all outside the
  // zone. Draw EVERY adm1 feature intersecting the view as faint context, and
  // label it. Zero new data: gb-IND-ADM1 and gb-CHN-ADM1 are already local and
  // already carry shapeName.
  let ctxAdm1 = '';
  const adm1Labels = [];
  for (const pool of [adm1Ind, adm1Chn].filter(Boolean)) {
    for (const f of pool.features || []) {
      const fb = bboxOf(f.geometry);
      if (!bboxIntersect(fb, viewBbox)) continue;
      // EVERY province in view is painted as land FIRST, including the zone's own.
      // The zone's coloured fill draws over this, so the underlay only shows where
      // nothing else covers it. Without it, un-zoned Indian land fell through to
      // the sea fill and read as empty white space.
      ctxAdm1 += `<path d="${geoToPath(f.geometry, proj)}" class="prov"/>`;
      const inZone = f.properties && f.properties.listId === zone.id;
      if (inZone) continue;                      // its label is drawn in zone colour
      const nm = f.properties?.shapeName;
      if (!nm) continue;
      const vx0 = Math.max(fb[0], viewBbox[0]), vx1 = Math.min(fb[2], viewBbox[2]);
      const vy0 = Math.max(fb[1], viewBbox[1]), vy1 = Math.min(fb[3], viewBbox[3]);
      const wF = (vx1 - vx0) / (viewBbox[2] - viewBbox[0]);
      const hF = (vy1 - vy0) / (viewBbox[3] - viewBbox[1]);
      if (wF * hF < 0.0012) continue;             // too small to carry a name
      const [lx, ly] = proj((vx0 + vx1) / 2, (vy0 + vy1) / 2);
      adm1Labels.push({ x: lx, y: ly, nm: String(nm) });
    }
  }
  // Name the zone's OWN provinces too — the operator cannot tell Bihar from Jharkhand.
  for (const pool of [adm1Ind, adm1Chn].filter(Boolean)) {
    for (const f of pool.features || []) {
      if (!f.properties || f.properties.listId !== zone.id) continue;
      const fb = bboxOf(f.geometry);
      if (!bboxIntersect(fb, viewBbox)) continue;
      const nm = f.properties.shapeName;
      if (!nm) continue;
      const [lx, ly] = proj((fb[0] + fb[2]) / 2, (fb[1] + fb[3]) / 2);
      adm1Labels.push({ x: lx, y: ly, nm: String(nm), own: true });
    }
  }
  // ── SEA LABELS ─────────────────────────────────────────────────────────────
  // Water rendered as an unlabelled pale field, so a reader could not tell ocean
  // from a province that failed to draw — the operator read the Arabian Sea as a
  // missing polygon.
  //
  // A fixed lng/lat gazetteer does NOT work here: the frame is full sheet height
  // and shows only the northern fringe of each sea, so every gazetteer point
  // (chosen at the sea's own centre) projected far below the frame. Measured:
  // Arabian Sea at y=1829 against a frame ending at 1730.
  // Instead, place each sea's name at the point where its water is ACTUALLY
  // VISIBLE — clamp the gazetteer point into the frame along its own axis, and
  // only keep it if that clamped point is genuinely on water (no land polygon
  // covers it), tested against the same adm0/adm1 rings already loaded.
  const SEAS = [
    // Two anchors for the Arabian Sea: its true centre, and a NORTH-EAST point on
    // the Indian west coast. The centre alone is west of most India crops, so
    // coastal water on the page was attributed to a sea whose group never met the
    // minimum-patch floor and went unlabelled.
    { nm: 'ARABIAN SEA',   lng: 65,   lat: 15 },
    { nm: 'ARABIAN SEA',   lng: 71,   lat: 19 },
    { nm: 'BAY OF BENGAL', lng: 89,   lat: 15 },
    { nm: 'INDIAN OCEAN',  lng: 78,   lat: 0 },
    { nm: 'SOUTH CHINA SEA', lng: 114, lat: 14 },
    { nm: 'ATLANTIC OCEAN', lng: -20, lat: 5 },
    { nm: 'GULF OF GUINEA', lng: 2,   lat: 1 },
    { nm: 'MEDITERRANEAN SEA', lng: 18, lat: 34 },
    { nm: 'RED SEA',       lng: 38,   lat: 20 },
    { nm: 'PACIFIC OCEAN', lng: 175,  lat: -10 },
    { nm: 'CORAL SEA',     lng: 155,  lat: -17 },
  ];
  const landRings = [];
  for (const f of adm0.features || []) {
    if (!bboxIntersect(bboxOf(f.geometry), viewBbox)) continue;
    const g = f.geometry;
    if (g.type === 'Polygon') landRings.push(g.coordinates[0]);
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) landRings.push(poly[0]);
  }
  for (const pool of [adm1Ind, adm1Chn].filter(Boolean)) {
    for (const f of pool.features || []) {
      if (!bboxIntersect(bboxOf(f.geometry), viewBbox)) continue;
      const g = f.geometry;
      if (g.type === 'Polygon') landRings.push(g.coordinates[0]);
      else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) landRings.push(poly[0]);
    }
  }
  const onLand = (lng, lat) => landRings.some((ring) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  });
  // Find where each sea's water is ACTUALLY VISIBLE by scanning the frame, rather
  // than trusting a gazetteer point. A fixed lng/lat fails twice over here: the
  // Arabian Sea's centre (lng 65) is WEST of this crop entirely, and every sea's
  // centre latitude projects below the frame — so both the point and a northward
  // walk from it miss. Scanning finds the water that is on the page.
  let seaNames = '';
  {
    const stepX = (viewBbox[2] - viewBbox[0]) / 26;
    const stepY = (viewBbox[3] - viewBbox[1]) / 26;
    // Nearest named sea wins the patch, so a label describes the water beside it.
    const nearest = (lng, lat) => {
      let best = null, bd = Infinity;
      for (const S of SEAS) {
        const d = Math.hypot(S.lng - lng, S.lat - lat);
        if (d < bd) { bd = d; best = S; }
      }
      return best;
    };
    const used = new Set();
    const patches = [];
    for (let lng = viewBbox[0]; lng <= viewBbox[2]; lng += stepX) {
      for (let lat = viewBbox[1]; lat <= viewBbox[3]; lat += stepY) {
        if (onLand(lng, lat)) continue;
        const [px2, py2] = proj(lng, lat);
        if (px2 < FRAME_X + 60 || px2 > FRAME_X + FRAME_W - 60) continue;
        if (py2 < FRAME_Y + 40 || py2 > FRAME_Y + FRAME_H - 40) continue;
        patches.push({ lng, lat, px: px2, py: py2 });
      }
    }
    // Group patches by their nearest sea and label each group once, at the patch
    // furthest from land (approximated by the centre of that group's extent).
    const groups = new Map();
    for (const pt of patches) {
      const S = nearest(pt.lng, pt.lat);
      if (!S) continue;
      if (!groups.has(S.nm)) groups.set(S.nm, []);
      groups.get(S.nm).push(pt);
    }
    for (const [nm, pts] of groups) {
      if (pts.length < 4) continue;                    // too little water to name
      if (used.has(nm)) continue;
      used.add(nm);
      const mx = pts.reduce((a, q) => a + q.px, 0) / pts.length;
      const my = pts.reduce((a, q) => a + q.py, 0) / pts.length;
      seaNames += `<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" class="sea-name">${esc(nm)}</text>`;
    }
  }

  let provNames = '';
  for (const L of adm1Labels) {
    if (L.x < FRAME_X + 20 || L.x > FRAME_X + FRAME_W - 20) continue;
    if (L.y < FRAME_Y + 20 || L.y > FRAME_Y + FRAME_H - 20) continue;
    const t = esc(L.nm);
    provNames += `<text x="${L.x.toFixed(1)}" y="${L.y.toFixed(1)}" text-anchor="middle" class="prov-name-halo">${t}</text>`
               + `<text x="${L.x.toFixed(1)}" y="${L.y.toFixed(1)}" text-anchor="middle" class="prov-name${L.own ? ' own' : ''}">${t}</text>`;
  }

  // zone polygons (the region(s) this poster is about)
  let zoneP = '';
  for (const f of zoneFC.features) zoneP += `<path d="${geoToPath(f.geometry, proj)}" class="zone"/>`;

  // labels (de-overlap, full-height even pitch, balanced L/R) + OCTILINEAR
  // lane-routed leaders. Each side gets a band of vertical lanes between the map
  // edge and the label column; each leader owns a distinct lane, so vertical
  // runs never coincide. Geometry is symmetric and mirrored L/R.
  // De-overlap the PINS FIRST, then lay out labels from the settled positions.
  // Order matters and this is why: layoutLabels sorts each gutter by pin y, and
  // that y-ordering (monotonicity) is the property that keeps leaders from
  // crossing. Moving pins AFTER the sort silently invalidated it — measured 618
  // crossings at f=0 where the ordering-preserving version measures 0.
  const prePins = pins.map((p) => { const [lx, ly] = proj(p.lng, p.lat); return { ...p, _px: lx, _py: ly }; });
  // ── PIN DE-OVERLAP (relaxation, pixel space, AFTER projection) ────────────
  // The earlier version only caught EXACT pixel collisions, which missed the real
  // problem: pins that land 2-3px apart still overlap visually and still read as
  // one mark. The dense band through Chad/Cameroon piled into a solid mass.
  //
  // This is a repulsion relaxation instead: any two pins closer than MIN_SEP are
  // pushed apart along the line between them, repeatedly, until the field settles.
  // Displacement is capped so a pin never wanders far from its true location — the
  // poster must stay honest about WHERE a people group is; it is only resolving
  // marks that would otherwise be indistinguishable.
  //
  // This is what makes leaders viable again: leaders can only be routed without
  // crossing if their endpoints are distinct, and the endpoints are these pins.
  {
    // Must exceed the disc DIAMETER (2 x 10.8 = 21.6) or discs still touch.
    const MIN_SEP = 25;          // ~1.7x the numbered-disc diameter
    // Drift cap raised: at 34px a tight knot of ~10 pins could not physically
    // spread far enough to separate, so the relaxation stalled with them stacked.
    // 58px still keeps a pin near its true location at this map scale.
    const MAX_DRIFT = 58;        // hard cap on how far a pin may move from truth
    const ITERS = 260;
    for (const it of prePins) { it._ox = it._px; it._oy = it._py; }
    for (let pass = 0; pass < ITERS; pass++) {
      let moved = false;
      for (let i = 0; i < prePins.length; i++) {
        for (let j = i + 1; j < prePins.length; j++) {
          const a = prePins[i], b = prePins[j];
          let dx = b._px - a._px, dy = b._py - a._py;
          let dist = Math.hypot(dx, dy);
          if (dist >= MIN_SEP) continue;
          if (dist < 0.0001) {                    // exactly coincident — split on a
            const ang = (i * 2.399963);           // golden-angle spread, deterministic
            dx = Math.cos(ang); dy = Math.sin(ang); dist = 1;
          }
          const push = (MIN_SEP - dist) / 2 + 0.15;
          const ux = dx / dist, uy = dy / dist;
          a._px -= ux * push; a._py -= uy * push;
          b._px += ux * push; b._py += uy * push;
          moved = true;
        }
      }
      // Re-anchor: pull each pin back toward its true position if it has drifted
      // past the cap, and keep everything inside the map rect.
      for (const it of prePins) {
        const dx = it._px - it._ox, dy = it._py - it._oy;
        const d = Math.hypot(dx, dy);
        if (d > MAX_DRIFT) { it._px = it._ox + (dx / d) * MAX_DRIFT; it._py = it._oy + (dy / d) * MAX_DRIFT; }
        it._px = Math.max(MAP_X + 4, Math.min(MAP_X + MAP_W - 4, it._px));
        it._py = Math.max(FRAME_Y + 4, Math.min(FRAME_Y + FRAME_H - 4, it._py));
      }
      if (!moved) break;
    }
  }

  // Feed the settled pixel positions back as lng/lat-free overrides.
  const settled = prePins.map((p) => ({ ...p, _fixed: true }));
  const laid = layoutLabels(settled, proj);

  // LABEL_RES is the text column; LANE_* is the channel between text and map.
  // Widened the text column (names were clipping: "Jarkhandi Julaha" ran off the
  // sheet) AND tightened the lane band, so the names sit CLOSER to the map while
  // still leaving room to route a short leader per label.
  // LABEL_RES is the width available to the NAME. It must fit inside the gutter
  // minus the lane band minus the sheet margin, or names run off the paper —
  // "Jarkhandi Julaha" and "Khangar (Bundeli)" were both clipped at the edges.
  const SHEET_MARGIN = 26;
  const LANE_EDGE_GAP = 6, LABEL_GAP = 6, LANE_PITCH_MAX = 3;
  const LABEL_RES = GUTTER - SHEET_MARGIN - LANE_EDGE_GAP - 24;
  const sideItems = { L: laid.filter((i) => i.side === 'L'), R: laid.filter((i) => i.side === 'R') };
  // assign each label its own vertical lane (distinct margin channel), symmetric L/R
  for (const side of ['L', 'R']) {
    const col = sideItems[side];                  // already sorted by py (place())
    const m = col.length || 1;
    const dirOut = side === 'L' ? -1 : 1;
    const edge = side === 'L' ? MAP_X : MAP_X + MAP_W;
    const band = MAP_X - LABEL_RES - LANE_EDGE_GAP - LABEL_GAP;   // lane band width (margins are symmetric)
    const pitch = Math.min(LANE_PITCH_MAX, band / Math.max(1, m - 1));
    col.forEach((it, k) => {
      it.laneX = edge + dirOut * (LANE_EDGE_GAP + k * pitch);
      it.dirOut = dirOut;
      it.tanchor = side === 'L' ? 'end' : 'start';
    });
  }
  // route every leader at a given diagonal-fraction (all octilinear by construction)
  const routesFor = (d) => laid.map((it) => octiRoute(it, it.laneX, it.dirOut, d));
  // sweep dfrac; keep the minimal-crossing octilinear layout for THIS poster.
  // ties → prefer the smaller dfrac (cleaner 90° grid, less diagonal drift).
  let bestD = 0, bestX = Infinity;
  // po-LEADERS (L-shaped) ONLY. Barth/Gemsa/Niedermann/Nollenburg (GD 2015,
  // Information Visualization 2019) ran the first controlled readability study on
  // BOUNDARY LABELING — labels in margins joined to points by leaders, which is
  // exactly this problem. Four leader types were tested; "po" (a segment parallel
  // to the labeled side, then one orthogonal segment) won on BOTH performance and
  // preference. Straight diagonals ("s") rated fast but weaker; S-shaped ("opo")
  // was explicitly not recommended.
  // The sweep is therefore capped at pure-orthogonal, with one small 0.15 fallback
  // kept because planarity is a HARD constraint — a single crossing damages the
  // layout more than a slight bend does.
  // Sweep prefers the LOWEST d (most L-shaped) that does not cost crossings.
  // Planarity outranks leader-shape: the study ranks po highest for readability,
  // but a crossed layout is unreadable regardless of segment geometry, and Barth
  // et al. treat non-crossing as a precondition, not a preference.
  for (const d of [0]) {
    const x = countPolyCrossings(routesFor(d));
    if (x < bestX) { bestX = x; bestD = d; }
  }
  const routes = routesFor(bestD);
  let leaders = '', dots = '', labels = '', pinDots = '';
  let octiOK = true;

  // ── NUMBERED-LEGEND MODE (dense posters) ──────────────────────────────────
  // A previous builder PROVED the leader design is geometrically contradictory,
  // not badly tuned: "labels evenly filling the margin" + "non-horizontal leaders"
  // + "zero crossings" + "pins at true coords" cannot all hold at once. Measured
  // on these exact posters, crossings rise monotonically the moment any slant is
  // added — 0 at f=0, then 166 / 280 / 348 / 458 / 573 on west-africa. No sweet
  // spot; Bezier curves were tried and cross harder still.
  //
  // So above a density threshold we stop drawing leaders entirely: pins carry a
  // NUMBER at their true coordinate, and the margins carry "N. Name". Zero
  // crossings by construction, no horizontal banding, and the margins still fill
  // eloquently. This is the standard cartographic answer to dense labelling.
  // DENSE_AT — above this pin count, drop leaders and number the pins instead.
  // Measured on THIS code: leaders cross 334-622 times on west-africa at every
  // slant value including f=0. The prior builder's "0 crossings at f=0" describes
  // a code state that is NOT what is on disk — that fix was reverted or never
  // landed here. So numbering is the only variant that is actually planar today.
  const DENSE_AT = 40;
  const numbered = laid.length >= DENSE_AT;

  if (numbered) {
    // Number in READING ORDER down each gutter, so a reader scanning the list
    // moves top-to-bottom and the numbers on the map ascend with latitude.
    laid.forEach((it, i) => { it.num = i + 1; });
    laid.forEach((it) => {
      pinDots += `<circle cx="${it.px.toFixed(1)}" cy="${it.py.toFixed(1)}" r="10.8" class="pin-num-bg"/>`
              +  `<text x="${it.px.toFixed(1)}" y="${(it.py + 4.6).toFixed(1)}" text-anchor="middle" class="pin-num">${it.num}</text>`;
      // SHORT CONNECTOR from the label out to its lane. The brief calls for the line
      // back — but a full pin-to-label leader is what crossed 600+ times. A stub
      // gives the eye the same "this name belongs to that row" cue with zero
      // crossings, because every stub is horizontal and lives in its own lane.
      // UNDERLINE-INTO-CURVE (design, designer call). One continuous stroke:
      // a straight rule beneath the name — which reads as an underline — then a
      // smooth curve peeling out of it toward the numbered pin.
      //
      // Why this beats a bare leader: a straight line arriving at a name has to
      // point at some arbitrary spot on the text. An underline gives the stroke a
      // legitimate ORIGIN — it belongs to the word — and visually binds the name
      // and its line into one object.
      //
      // The curve is a cubic whose FIRST control point continues the underline's
      // direction. That makes the tangent at the join horizontal, so the underline
      // flows into the curve with no visible kink (C1 continuity, not just C0).
      const textEdge = it.dirOut < 0 ? SHEET_MARGIN + LABEL_RES : PW - SHEET_MARGIN - LABEL_RES;
      // The text is drawn at labelY + font*0.34, so the BASELINE is there and the
      // underline must clear the descenders below it. 0.44 put the rule through the
      // lower third of the glyphs — it read as a strikethrough, not an underline.
      const ulY = it.labelY + it.font * 0.34 + it.font * 0.30;
      // THE UNDERLINE MUST SIT UNDER THE TEXT, and the text runs AWAY from the map:
      // the left column is text-anchor="end" so it extends LEFT from tx, the right
      // column is "start" so it extends RIGHT. Both therefore run in the -dirOut
      // direction. The previous version extended the underline by +dirOut, i.e.
      // TOWARD the map — so on both columns the rule was drawn on the empty side of
      // the label and underlined nothing at all.
      // The text anchor point. Declared HERE because the underline geometry below
      // derives from it — leaving it further down put it in the temporal dead zone.
      const tx = it.dirOut < 0 ? SHEET_MARGIN + LABEL_RES : PW - SHEET_MARGIN - LABEL_RES;
      // MEASURED, not assumed. Text for a left-column label is anchored "end" at
      // tx, so it occupies [tx - width, tx]; a right-column label is "start" and
      // occupies [tx, tx + width]. The underline must span EXACTLY that, then the
      // leader leaves from the MAP-FACING end of it.
      // Previous attempts derived the span from dirOut and put the rule 56px clear
      // of the text on the wrong side — measurement showed text at 110-181 while
      // the underline ran 237->176.
      // Width estimate covers the "12. " index prefix AND the name. Measured at
      // 0.52em the rule fell 16px short of the text start (text 88-181, rule
      // 104-177) — the prefix was unaccounted for. 0.56em plus a wider constant
      // spans the whole label.
      // PER-CHARACTER width, not a flat character count. A count-based estimate
      // over- or under-shoots by up to 11px depending on which letters a name
      // happens to contain — "3. Raji" (narrow i/j) got a rule 6px wider than its
      // text while "5. Bhand" got one 7px narrower. Measured overhang ranged -2 to
      // +11px, which is exactly the disproportionate look reported.
      // Lato advance widths as a fraction of em, bucketed. Good to ~2% — far
      // tighter than a flat 0.56 for every glyph.
      const ADV = (ch) => {
        if ('iIjl|.,:;\'!'.includes(ch)) return 0.26;
        if ('ftr()[]-'.includes(ch)) return 0.34;
        if ('  '.includes(ch)) return 0.26;
        if ('mwMW'.includes(ch)) return 0.86;
        if ('ABCDEFGHKLNOPQRSTUVXYZ0123456789'.includes(ch)) return 0.63;
        return 0.53;                                   // ordinary lowercase
      };
      const labelText = `${it.num}. ${it.name}`;
      // Bucket values measured slightly low across the board (median -12px). A
      // uniform 1.08 correction plus a 3px pad lands the rule on the glyph edges.
      const measured = [...labelText].reduce((a, ch) => a + ADV(ch), 0) * it.font * 1.08 + 3;
      const nameW = Math.min(LABEL_RES - 18, measured);
      const ulTextStart = it.dirOut < 0 ? tx - nameW : tx + nameW;   // away-from-map end
      const ulOuter = ulTextStart;                        // under the START of the name
      const ulInner = tx + it.dirOut * 3;                 // under the map-facing end
      // Stop short of the disc so the stroke meets the pin without crossing the numeral.
      const dx = it.px - ulInner, dy = it.py - ulY;
      const len = Math.hypot(dx, dy) || 1;
      const ex = it.px - (dx / len) * 12.5, ey = it.py - (dy / len) * 12.5;
      // UNDERLINE + STRAIGHT RUN (design call, 2026-07-31). The curve was tested
      // and rejected: straight lines are easier to follow, and 92 curves reading
      // against each other made the sheet busier rather than calmer. The underline
      // stays — it gives the stroke a legitimate origin on the word — and the run
      // to the pin is now a single straight segment out of its inner end.
      const dpath = `M${ulOuter.toFixed(1)} ${ulY.toFixed(1)} L${ulInner.toFixed(1)} ${ulY.toFixed(1)} `
                  + `L${ex.toFixed(1)} ${ey.toFixed(1)}`;
      leaders += `<path d="${dpath}" class="lead-halo"/><path d="${dpath}" class="lead"/>`;
      // tx is hoisted above the underline block — it is used there.
      const avail = LABEL_RES - 26;                 // room for "58. " + the stub
      const est = it.name.length * it.font * 0.5;   // ~0.5em average advance, Lato
      if (est > avail) it.font = Math.max(8, it.font * (avail / est));
      const anchor = it.tanchor;
      // "12." set in a lighter weight than the name, so the column reads as names
      // first and indices second.
      labels += `<text x="${tx.toFixed(1)}" y="${(it.labelY + it.font * 0.34).toFixed(1)}" text-anchor="${anchor}" font-size="${it.font.toFixed(1)}" class="lbl">`
             +  `<tspan class="lnum">${it.num}.</tspan> ${esc(it.name)}</text>`;
    });
    octiOK = true;
  } else laid.forEach((it, i) => {
    const pts = routes[i];
    if (!isOctilinear(pts)) octiOK = false;
    leaders += `<path d="M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')}" class="lead"/>`;
    pinDots += `<circle cx="${it.px.toFixed(1)}" cy="${it.py.toFixed(1)}" r="3.6" class="pin"/>`;
    dots += `<circle cx="${it.laneX.toFixed(1)}" cy="${it.labelY.toFixed(1)}" r="1.6" class="ldot"/>`;
    const tx = it.laneX + it.dirOut * 5;
    labels += `<text x="${tx.toFixed(1)}" y="${(it.labelY + it.font * 0.34).toFixed(1)}" text-anchor="${it.tanchor}" font-size="${it.font.toFixed(1)}" class="lbl">${esc(it.name)}</text>`;
  });
  if (!octiOK) console.warn(`  ⚠ non-octilinear segment in ${zone.zoneKey}`);
  const crossings = countPolyCrossings(routes);
  const diagFrac = bestD;

  // ── TITLE vs SUBTITLE ──────────────────────────────────────────────────────
  // A TITLE IS NEVER A LIST. The India/China lists carry labels like "Rajasthan +
  // Haryana + Himachal Pradesh + Jammu and Kashmir + Punjab + Chandigarh + Ladakh"
  // (89 chars) — as a single SVG <text> that ran off BOTH edges of the sheet,
  // because SVG text does not wrap and the element is centre-anchored.
  // So: a SHORT functional title, with the full enumeration moved to a wrapped
  // subtitle beneath it where a reader can still find the specifics.
  const fullLabel = (zone.label || zone.id).replace(/&/g, '&amp;');
  const parts = fullLabel.split(' + ').map((x) => x.trim()).filter(Boolean);
  const isList = parts.length > 1;
  // Name the parent region from the zone id, so "asia-india-rajasthan" titles as
  // "India" rather than inventing a name from the province list.
  const parentOf = (id) =>
    id.startsWith('asia-india-') ? 'India'
    : id.startsWith('asia-china-') ? 'China'
    : null;
  const parent = parentOf(zone.zoneKey || zone.id || '');
  // Named clusters, not "India · 6 Provinces". A poster on a wall wants a NAME a
  // person can hold, and "6 Provinces" is a count, not a name. Keyed by zone id so
  // each cluster gets the name its region is actually known by.
  // Nepal is a SOVEREIGN COUNTRY, not a part of North India — naming the cluster
  // "North India" while colouring Nepali land inside it would misrepresent a
  // nation. The title names both.
  const CLUSTER_NAME = {
    'asia-india-uttarakhand': 'North India + Nepal',
  };
  const title = CLUSTER_NAME[zone.zoneKey || zone.id]
    || (!isList ? fullLabel
      : parent ? `${parent} \u00b7 ${parts.length} Provinces`
      : `${parts[0]} + ${parts.length - 1} more`);
  // The subtitle carries the enumeration, wrapped across lines that fit the sheet.
  // ── HEADER BLOCK (design spec) ─────────────────────────────────────────────
  //   Countries:  India · Nepal
  //   Provinces:  Uttarakhand · Uttar Pradesh · ...
  //   92 people groups · pray for the harvest · Luke 10:2
  //
  // Left-justified as a LABELLED LIST rather than centred prose: the labels stack
  // on a common left edge so "Countries" and "Provinces" align and the eye reads
  // down one column. The label is bold; the values are not, so the structure is
  // visible without the values shouting.
  const ctryNamesSet = [...new Set(pins.map((p) => ISO3_NAME[p.country_code] || p.country_code).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  // Provinces come from their OWN field. Deriving them by splitting `label` broke
  // the moment the label was renamed to a cluster name — the enumeration is data,
  // not a formatting artefact of the title, and needed somewhere to live.
  const provinceList = Array.isArray(zone.provinces) && zone.provinces.length
    ? zone.provinces
    : (isList ? parts : []);

  const wrapTo = (items, maxch) => {
    const out = [];
    let line = '';
    for (const it of items) {
      const next = line ? `${line} \u00b7 ${it}` : it;
      if (next.length > maxch) { out.push(line); line = it; } else { line = next; }
    }
    if (line) out.push(line);
    return out;
  };
  const HEAD_MAXCH = 78;
  const ctryLines = wrapTo(ctryNamesSet, HEAD_MAXCH);
  const provLines = wrapTo(provinceList, HEAD_MAXCH);

  // Built as absolute rows so the label column and the value column share one
  // left edge no matter how many lines each list wraps to.
  const HEAD_X = GUTTER;
  // Wider label column: "Provinces:" needs the room, and a consistent gutter
  // between key and value is what makes the two rows read as a table rather than
  // two sentences that happen to start near each other.
  // ── THE HEADER IS CENTRED ON THE SHEET'S AXIS ──────────────────────────────
  // Everything above the map was flush-left while the map below it was centred —
  // two alignments fighting on one sheet, which is why the top read as "hanging
  // off the left". Title, table and prose now share the sheet's axis (CX).
  const CX = PW / 2;
  // ── THE FACTS TABLE ────────────────────────────────────────────────────────
  // A centred table needs fixed internal geometry or the rows wander: keys are
  // RIGHT-aligned to a seam and values LEFT-aligned to it, so the colon gutter
  // forms one clean vertical seam. That seam — not a box or heavy borders — is
  // what makes it read as a table while staying quiet enough to be beautiful.
  const SEAM = CX - 30;
  const KEY_X = SEAM - 14;
  const VAL_X = SEAM + 14;
  let headY = 150;
  let headBlock = '';
  const TABLE_TOP = headY - 18;
  const headRow = (label, lines) => {
    if (!lines.length) return;
    headBlock += `<text x="${KEY_X}" y="${headY}" text-anchor="end" class="hkey">${label}</text>`;
    for (const ln of lines) {
      headBlock += `<text x="${VAL_X}" y="${headY}" text-anchor="start" class="hval">${esc(ln)}</text>`;
      headY += 23;
    }
  };
  headRow('Countries', ctryLines);
  headRow('Provinces', provLines);
  headRow('People groups', [`${pins.length} UPG`]);
  headRow('Series', [`My UPG 100 List · map ${SERIES.index} of ${SERIES.totalLists}`]);
  // Hairline rules top and bottom close the table without boxing it in.
  const TABLE_BOT = headY - 12;
  const TABLE_HALF = 320;
  headBlock += `<line x1="${SEAM - TABLE_HALF}" y1="${TABLE_TOP}" x2="${SEAM + TABLE_HALF}" y2="${TABLE_TOP}" class="hrule"/>`;
  headBlock += `<line x1="${SEAM - TABLE_HALF}" y1="${TABLE_BOT}" x2="${SEAM + TABLE_HALF}" y2="${TABLE_BOT}" class="hrule"/>`;
  headY = TABLE_BOT;
  // THE COMPASSION VERSE — given the SAME treatment as the goal question below
  // the map: one full-map-width line, ruled above and below. design note 2026-07-31:
  // "the scripture up top should also span the full width of the map and should
  // also have a line above it and below it." The two rules-and-a-line blocks now
  // bracket the sheet symmetrically — scripture at the top, the question at the
  // bottom, the map between them.
  const VRULE_L = GUTTER, VRULE_R = PW - GUTTER;
  headY += 16;
  headBlock += `<line x1="${VRULE_L}" y1="${headY}" x2="${VRULE_R}" y2="${headY}" class="hrule"/>`;
  headY += 25;
  headBlock += `<text x="${CX}" y="${headY}" text-anchor="middle" class="hverse">`
             + `\u201cBut when he saw the multitudes, he was moved with compassion for them because they were harassed and scattered, like sheep without a shepherd.\u201d`
             + ` <tspan class="hvref">MATTHEW 9:36</tspan>`
             + `</text>`;
  headY += 12;
  headBlock += `<line x1="${VRULE_L}" y1="${headY}" x2="${VRULE_R}" y2="${headY}" class="hrule"/>`;
  // SOURCE + CALL TO ACTION, in the header rather than the footer. At the bottom it
  // read as an afterthought stranded under the map; here it sits with the other
  // metadata (Countries, Provinces, count) as one coherent block a reader takes in
  // before looking at the map. /adopt is deliberately absent — that page is retired.
  // (the old full-bleed rule here is gone — the table's own hairlines already
  //  close the metadata block, and a second full-width rule below them just
  //  re-drew the same boundary twice.)
  // Numbers are DERIVED from the API + clusters.json at generation time, then
  // SPOKEN rounded — a poster outlives its data, so the vision reads in
  // approximations while the sheet's own count stays exact.
  const approxGroups = Math.round(SERIES.totalGroups / 100) * 100;
  const approxLists = Math.round(SERIES.totalLists / 10) * 10;

  // ── THE VISION BLOCK ───────────────────────────────────────────────────────
  // COPY IS THE OWN (05-poster-vision/source-material/01, "THE
  // OWN COPY"). It supersedes my drafts, and it is better for reasons worth
  // recording: it KEEPS THE MIRACLE. My versions reduced the account to a seating
  // arrangement — a logistics lesson — when the point is that Jesus supernaturally
  // multiplied the offering and the grouping is how it was DISTRIBUTED.
  // "A similar challenge" is also the honest connective: it states a likeness
  // without claiming the disciples were reading a map.
  // ── THE HEADER GRID ────────────────────────────────────────────────────────
  // Brief: "make use of the space and create a table to evenly distribute the
  // data at the top — it looks quite busy, like the text does not know how to be
  // organised beautifully."
  //
  // The problem was that sixteen full-width CENTRED lines stack into a ragged
  // column: every line starts and ends somewhere different, so the eye has no
  // edge to follow and the block reads as noise rather than as information.
  //
  // The fix is a GRID. Two bands, both built on a shared column measure:
  //   BAND 1 — the vision, in TWO columns (Feed the 5000 | What is a Prayer List)
  //   BAND 2 — the three networks, in THREE equal columns, one per network
  // Set left-aligned inside each column, so every line shares a hard left edge.
  // That edge is what makes a text block read as ORGANISED rather than busy.
  const GRID_L = GUTTER;
  const GRID_W = PW - 2 * GUTTER;
  // Brief: "increase the font slightly because we have a lot more room to work
  // with." 12.5 -> 13.5 with leading kept proportional (~1.30).
  const FS = 13.5, LH = 17.5;
  // The two vision columns sit BELOW the ruled scripture, so they read as its
  // supporting detail, not as headline copy. Slimmer type + tighter leading than
  // the sheet's body size: less height for the same words, and the contrast in
  // scale is what tells the eye the scripture outranks them.
  const B1_FS = 12, B1_LH = 15;
  const push = (frag) => { headBlock += frag; };
  const colRule = (x, y0, y1) =>
    `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" class="hcolrule"/>`;

  let py = headY + 34;

  // ── BAND 1: two columns ──────────────────────────────────────────────────
  const B1_GUT = 54;
  // TEXT_W is narrower than the column pitch so prose never touches the rule.
  const B1_CW = (GRID_W - B1_GUT) / 2;
  const B1_TW = B1_CW - 10;
  const b1x = [GRID_L, GRID_L + B1_CW + B1_GUT];
  const b1Top = py;
  headBlock += `<text x="${b1x[0]}" y="${py}" class="hvh">Jesus’ Strategy to Feed the 5000</text>`;
  headBlock += `<text x="${b1x[1]}" y="${py}" class="hvh">What is a Prayer List of 100 UPG?</text>`;
  const bodyTop = py + 20;

  // COPY IS THE OWN (05-poster-vision/source-material/01). It KEEPS THE
  // MIRACLE — earlier drafts reduced the account to a seating arrangement, when
  // the point is that Jesus supernaturally MULTIPLIED the offering and the
  // grouping is how it was distributed.
  let cy0 = bodyTop;
  cy0 = paraInto(push,
    `Jesus’ disciples faced a similar challenge: “How can we feed so many with only five loaves and two fish?” Jesus fed the 5,000 by supernaturally multiplying that small offering — and His answer holds the key to our people-groups problem.`,
    { x: b1x[0], y: cy0, w: B1_TW, fs: B1_FS, lh: B1_LH, cls: 'hsrc2' });
  cy0 += 5;
  cy0 = paraInto(push,
    `Through radical faith and miracle-expectant prayer, He focused on the few in front of Him — dividing the crowd and entrusting faithful men and women to serve the most strategic groups of fifties and hundreds (Mark 6:40).`,
    { x: b1x[0], y: cy0, w: B1_TW, fs: B1_FS, lh: B1_LH, cls: 'hsrc2' });

  let cy1 = bodyTop;
  cy1 = paraInto(push,
    `This map is one of a ${approxLists}-map set called the My UPG 100 List — a large, overwhelming target in the thousands, organised into clear groupings and displayed on maps and prayer lists.`,
    { x: b1x[1], y: cy1, w: B1_TW, fs: B1_FS, lh: B1_LH, cls: 'hsrc2' });
  cy1 += 5;
  cy1 = paraInto(push,
    `Each map comes with a prayer list of its fifty to a hundred people groups — their names, a representative photo, and more detail — to mobilise informed intercession.`,
    { x: b1x[1], y: cy1, w: B1_TW, fs: B1_FS, lh: B1_LH, cls: 'hsrc2' });

  const b1Bot = Math.max(cy0, cy1);
  headBlock += colRule(GRID_L + B1_CW + B1_GUT / 2, b1Top - 12, b1Bot - 12);
  py = b1Bot + 4;

  const HEAD_BOTTOM = py + 14;
  // FAIL LOUDLY, don't ship a silent overlap. HEADER is a module constant (MAP_Y
  // and MAP_H are derived from it before the header is laid out), so it cannot be
  // computed from the content — which means the content CAN outgrow it. It already
  // did once: the last "Ways to use this map" line landed on the map frame and the
  // markup checks all passed, because an overlap is valid SVG. Only the render
  // showed it. This turns that class of regression into a build error.
  if (HEAD_BOTTOM > HEADER) {
    throw new Error(
      `[generate] header overflows the map frame: content ends at y=${HEAD_BOTTOM} `
      + `but HEADER=${HEADER} (zone ${zone.zoneKey}). Raise HEADER or tighten the header copy.`
    );
  }

  // ── BELOW THE MAP: THE GOAL + THE THREE NETWORKS ─────────────────────────
  // design note 2026-07-31: "move this section under the map so that the question and
  // the three answers sit under the map, and then that sandwiches the map in
  // between them quite nicely."
  //
  // So the sheet now reads as a sandwich:
  //   ABOVE  — what this is (the facts table + the vision, in columns)
  //   MIDDLE — the map itself
  //   BELOW  — the question, and the three answers to it
  // The question and its three answers belong together directly under the map,
  // because they are what a reader does AFTER looking at it.
  let footBlock = '';
  // FOOT_TOP is measured UP from the verse rule, so this block always sits
  // directly beneath the map no matter how the map's height changes.
  let fy = MAP_Y + MAP_H + 30;

  // THE GOAL — the question the three networks answer. Brief: "remember the
  // goal, remember this question?" INDIGENOUS is load-bearing: the aim is not
  // merely disciples among these peoples, but disciples, churches and leaders
  // FROM them, in their own language.
  footBlock += `<line x1="${GRID_L}" y1="${fy}" x2="${GRID_L + GRID_W}" y2="${fy}" class="hrule"/>`;
  fy += 24;
  footBlock += `<text x="${CX}" y="${fy}" text-anchor="middle" class="hgoal">`
             + `How can we multiply indigenous disciples, churches and leaders among all these people groups — and get the gospel into their own language?`
             + `</text>`;
  fy += 12;
  footBlock += `<line x1="${GRID_L}" y1="${fy}" x2="${GRID_L + GRID_W}" y2="${fy}" class="hrule"/>`;

  // THE THREE NETWORKS, three equal columns — the three answers.
  // The MAP AND THE PRAYER PACKET TRAVEL TOGETHER in all three: the packet is
  // what makes the intercession INFORMED rather than general.
  fy += 28;
  footBlock += `<text x="${CX}" y="${fy}" text-anchor="middle" class="hvh">Start with Prayer!</text>`;
  fy += 22;

  const B2_GUT = 40;
  const B2_CW = (GRID_W - 2 * B2_GUT) / 3;
  const B2_TW = B2_CW - 10;
  const NETWORKS = [
    ['1 · Thirty disciples.',
     `Each follower of Jesus takes their own map and prayer list. Some set apart a room in the house to hang it; some have hung a people-group map over their bed.`],
    ['2 · Thirty churches.',
     `Each church dedicates a wall in one of its places of prayer, and keeps copies of the prayer list available for distribution.`],
    ['3 · Thirty indigenous leaders.',
     `Find leaders on the ground in these areas and give them the map and prayer list, to raise awareness of their own unengaged neighbours.`],
  ];
  const fpush = (frag) => { footBlock += frag; };
  let fBot = fy;
  NETWORKS.forEach(([lead, body], i) => {
    const x = GRID_L + i * (B2_CW + B2_GUT);
    const end = paraInto(fpush, body, { x, y: fy, w: B2_TW, fs: FS, lh: LH, cls: 'hsrc', lead });
    if (end > fBot) fBot = end;
  });
  for (let i = 1; i < 3; i++) {
    footBlock += colRule(GRID_L + i * (B2_CW + B2_GUT) - B2_GUT / 2, fy - 14, fBot - 12);
  }
  // THE VERSE RULE IS MEASURED FROM THIS BLOCK, NOT FROM A FIXED OFFSET.
  // Anchoring it at PH - FOOTER could never work: FOOTER also shrinks MAP_H, so
  // raising it moved the block and the rule up by the SAME amount and the gap
  // between them stayed constant (measured: stuck at 164px for every value of
  // FOOTER). The block is INSIDE the footer band, so the verse has to follow the
  // block's real bottom.
  const VERSE_RULE_Y = fBot + 14;
  // The sheet still has to physically fit: the verse and its reference sit below
  // the rule, and the attribution line below that.
  if (VERSE_RULE_Y + 46 > PH - 8) {
    throw new Error(
      `[generate] below-map block runs off the sheet: verse rule would sit at `
      + `y=${VERSE_RULE_Y.toFixed(0)} on a ${PH}px sheet (zone ${zone.zoneKey}). `
      + `Raise FOOTER (which shrinks the map) or tighten this copy.`
    );
  }

  const verse = verseFor(zone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">
  <rect width="${PW}" height="${PH}" fill="var(--paper)"/>
  <rect x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_W}" height="${FRAME_H}" fill="var(--sea)" stroke="var(--frame)" stroke-width="1"/>
  <!-- LAND UNDERLAY. The frame is filled with SEA, so any land not covered by a
       polygon shows as water — and India is absent from world-adm0 entirely
       (verified: 161 countries, no IND), so Indian territory outside the drawn
       ADM1 features fell through to sea. That is the "white space" gap. Painting
       every ADM1 feature in view as a land underlay closes it: the sea then shows
       only where there genuinely is sea. -->
  <g clip-path="url(#mapclip)">${ctx}${ctxAdm1}${zoneP}${seaNames}${provNames}${ctryNames}</g>
  <clipPath id="mapclip"><rect x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_W}" height="${FRAME_H}"/></clipPath>
  <g style="--zc:${color}">${leaders}${dots}${pinDots}${labels}</g>
  <!-- TITLE, in two parts. "Unengaged People Groups of North India + Nepal" set
       on one line at h1 size would either overflow the sheet or force the type
       down to where the region name stops being the loudest thing on the poster.
       Splitting it lets the CATEGORY sit quietly above and the REGION stay big:
       the region is what a passer-by uses to find their sheet on a wall of 30. -->
  <text x="${PW / 2}" y="46" text-anchor="middle" class="h1over">Unengaged People Groups of</text>
  <text x="${PW / 2}" y="104" text-anchor="middle" class="h1">${esc(title)}</text>
  <!-- THE DOXA LOCKUP, top-left. The poster travels away from the site, so it has
       to say who made it and where the live data lives. -->
  <text x="${GUTTER}" y="40" text-anchor="start" class="brand">Doxa.Life</text>
  <text x="${GUTTER}" y="58" text-anchor="start" class="brandsub">Global Partnership for the Unreached</text>
  ${headBlock}
  ${footBlock}
  <line x1="${GUTTER}" y1="${HEAD_BOTTOM}" x2="${PW - GUTTER}" y2="${HEAD_BOTTOM}" class="rule"/>
  <line x1="${GUTTER}" y1="${VERSE_RULE_Y}" x2="${PW - GUTTER}" y2="${VERSE_RULE_Y}" class="rule"/>
  <text x="${PW / 2}" y="${VERSE_RULE_Y + 26}" text-anchor="middle" class="verse">&#8220;${esc(verse.text)}&#8221;</text>
  <text x="${PW / 2}" y="${VERSE_RULE_Y + 44}" text-anchor="middle" class="vref">${esc(verse.ref)}</text>
  <!-- GENERATION DATE, bottom-left. Deliberately NO hard counts of the global
       unengaged total on this poster: that number changes as research updates, and
       a printed figure would silently go stale on a wall. What CAN be stated
       honestly is WHEN this sheet was made — so a reader knows how current it is
       and can go to the site for the live picture. -->
  <text x="14" y="${PH - 4}" text-anchor="start" class="attrib">Generated ${POSTER_DATE} \u00b7 data from doxa.life</text>
  <text x="${PW - 14}" y="${PH - 4}" text-anchor="end" class="attrib">© Mapbox © OpenStreetMap</text>
</svg>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)} — UPG poster</title>
<style>
  :root{--paper:#f7f4ec;--sea:#eef3f4;--frame:#cdbf9e;--ink:#1c1c17;--zc:${color};}
  *{margin:0;box-sizing:border-box}
  html,body{background:#777}
  .stage{width:${PW}px;height:${PH}px;margin:0 auto;background:var(--paper)}
  svg{display:block}
  /* CONTEXT COUNTRIES. Imhof rule 3 — large fills sit muted and low-saturation
     (OS ships land at 13% saturation, sea at 8%); chroma is reserved for the small
     marks. The HAIRLINE EDGE is what lets these near-identical values read as
     separate countries at all (Tufte separates 3% and 7% tints this way). Edge is
     darkened from the old #cfc6ad so borders are actually visible. */
  /* Borders must be STRONGER than the fill contrast, or a small neighbour with the
     same tone as its surroundings simply disappears — Nepal was drawn correctly
     the whole time and still read as part of India, because nothing delineated it.
     Tufte: a hairline contour is what lets near-identical fills separate; here the
     contour had to be darkened and thickened to actually do that job. */
  .ctry{fill:#EAE5D8;stroke:#9C8F73;stroke-width:1.5;stroke-linejoin:round}
  /* Country NAMES: all-caps tracked +0.1em, haloed to the PAPER colour rather
     than white (Brewer — halos should be subtle and match the background), and
     held one clear value-step lighter than the people-group labels so the surround
     never competes with the subject. */
  /* Size and value both raised: at 11px/#8C8370 these rendered but were
     effectively invisible against a fill of similar value. The density budget
     allows generosity — this poster carries ~11 names/dm2 against Imhof's 500/dm2
     world-atlas ceiling — so 15px with a darker warm grey is still subordinate to
     the people-group labels while actually being readable. */
  /* CONTEXT PROVINCES — visible structure, clearly subordinate to the zone.
     Imhof: separate by VALUE, keep the surround muted; the hairline edge is what
     lets near-identical fills read as separate territories at all. */
  .prov{fill:#E4DECF;stroke:#B3A488;stroke-width:1;stroke-linejoin:round}
  /* Province names sit BELOW country names in the hierarchy: smaller, lighter,
     and not all-caps, so the eye reads country > province > people group. */
  /* Water names: italic, spaced, in the water's own hue — the cartographic
     convention for hydrography, and it keeps them clearly distinct from land. */
  .sea-name{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:12px;
    font-style:italic;fill:#93AEBC;letter-spacing:.18em;font-weight:500}
  .prov-name{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:11.5px;
    fill:#7E7562;font-weight:500;letter-spacing:.02em}
  .prov-name.own{fill:#6B4A78;font-weight:600}
  .prov-name-halo{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:11.5px;
    fill:none;stroke:#F2EFE6;stroke-width:3;stroke-linejoin:round;letter-spacing:.02em}
  .ctry-name{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:15px;
    letter-spacing:.1em;fill:#6E6553;font-weight:700}
  .ctry-name-halo{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:15px;
    letter-spacing:.1em;font-weight:700;fill:none;stroke:#F2EFE6;stroke-width:4;stroke-linejoin:round}
  /* A country that is a MEMBER of this zone (mixed-geometry zones join whole
     countries to provinces — North India + Nepal). It takes the zone's own ink,
     matching .prov-name.own, so members and neighbours are never confusable. */
  .ctry-name-own{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:15px;
    letter-spacing:.1em;fill:#6B4A78;font-weight:700}
  /* Internal province borders inside the zone, or the 5 highlighted provinces read
     as one undifferentiated blob and the reader cannot tell Bihar from Jharkhand. */
  .zone{fill:var(--zc);fill-opacity:.30;stroke:#7B5A88;stroke-width:1.1;stroke-opacity:.75;stroke-linejoin:round}
  .pin{fill:var(--zc);stroke:#2b2616;stroke-width:1.1;paint-order:stroke}
  /* SELF-HALOED LEADER (Frye/Esri): white 1.2pt under, grey 0.6pt over. At this
     poster's CSS scale 1pt ~= 1.33px, so 1.2pt=1.6px and 0.6pt=0.8px. The grey is
     a MID value (~45%), never black — a black leader competes with the label it
     serves. 0.6pt is deliberately just above the 0.5pt print floor. */
  /* Paper-coloured halo so a hairline stays readable where it crosses land. */
  .lead-halo{fill:none;stroke:#F5F1E7;stroke-width:1.7;stroke-opacity:.7;stroke-linejoin:round;stroke-linecap:round}
  /* Leaders must be SUBORDINATE — they are wiring, not content. At .9 opacity and
     118 of them the bundle read as the loudest thing on the sheet, competing with
     both the map and the names it serves. Dropped to a light warm grey at .55, one
     clear value-step below the labels. Esri: consistent colour and weight, never
     black, never varying per label. */
  /* A true HAIRLINE in near-black. The warm grey at .55 opacity vanished against
     the map fills — a leader you cannot see does not connect anything. 0.4px is
     just above the 0.25pt offset-litho dropout floor, so it stays a hair rather
     than a rule, and near-black (not pure #000) keeps it from competing with the
     label text it serves. */
  /* 0.4px rendered as a pale grey rather than a hairline — below about 0.55px a
     stroke antialiases into a tint instead of a line, so "thin and black" needs
     WEIGHT, not a darker hex. 0.6px at full opacity is a true hair that still sits
     just above the 0.25pt offset-litho dropout floor. */
  .lead{fill:none;stroke:#14110B;stroke-width:.6;stroke-opacity:1;stroke-linejoin:round;stroke-linecap:round}
  .ldot{fill:#857A6A}
  /* NUMBERED PINS. A filled disc in the zone colour with a knocked-out numeral —
     the number must read at arm's length on a printed sheet, so the disc carries
     it rather than sitting beside it. Paper-coloured ring separates touching pins
     without adding a second hue (Imhof: separate by value, keep hues few). */
  /* Numerals sized to be READ, not merely present. At 8.6px they were illegible
     even magnified; on a printed sheet at arm's length they would fail outright.
     The density budget allows this — ~11 names/dm2 against Imhof's 500/dm2
     world-atlas ceiling — so the sheet has room the earlier size did not use. */
  .pin-num-bg{fill:var(--zc);stroke:#F7F4EC;stroke-width:1.8;fill-opacity:.97}
  .pin-num{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:13px;
    font-weight:700;fill:#FFFFFF;letter-spacing:0}
  /* The index is subordinate to the NAME — lighter and smaller, so the margin
     column reads as a list of peoples, not a list of numbers. */
  .lnum{fill:#A79C86;font-weight:400}
  /* Sans for CULTURAL features (people groups). Cartographer survey favours
     Frutiger; Lato/Open Sans are the available substitutes. Small labels take
     POSITIVE tracking (optical sizing). */
  .lbl{font-family:Lato,'Segoe UI',system-ui,-apple-system,sans-serif;fill:#3A3730;letter-spacing:.012em;dominant-baseline:auto}
  /* TITLE: display type takes NEGATIVE tracking. Set at 0 it is one of the
     loudest amateur tells. Sized up per the density budget — at ~5-11 names/dm2
     this poster is very sparse against Imhof's 500/dm2 world-atlas ceiling, so
     there is room to be generous. */
  .h1{font-family:Georgia,'Times New Roman',serif;font-size:56px;font-weight:700;fill:var(--ink);letter-spacing:-.02em}
  /* The category line above the region name — smaller, tracked, quiet. */
  .h1over{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:19px;font-weight:600;
    fill:#8a8470;letter-spacing:.16em;text-transform:uppercase}
  /* Doxa lockup, top-left. */
  .brand{font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:700;
    fill:#6B4A78;letter-spacing:.01em}
  .brandsub{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:10.5px;font-weight:600;
    fill:#8a8470;letter-spacing:.10em;text-transform:uppercase}
  /* SUBTITLE: the province enumeration lives here, wrapped, never in the title. */
  .h2{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:19px;fill:#6a6450;letter-spacing:.04em}
  .h3{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:15px;fill:#7d7663;letter-spacing:.01em}
  /* Labelled list under the title. The KEY is bold so the structure reads at a
     glance; the VALUE is regular so the names do not shout over the title. Both
     sit on their own left edge, so Countries and Provinces align as a column. */
  .hkey{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:15px;font-weight:700;
    fill:#4a4636;letter-spacing:.02em}
  .hval{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:15px;font-weight:400;
    fill:#6a6450;letter-spacing:.01em}
  .hsum{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:14px;font-weight:600;
    fill:#8a8470;letter-spacing:.03em}
  .rule{stroke:var(--frame);stroke-width:1.5}
  /* CALL TO ACTION — quiet but findable. It sits BELOW the map and ABOVE the
     scripture, so the eye lands on the map first, the invitation second, and the
     verse last. Type is small: a poster's job is the map, and a shout here would
     compete with it. */
  /* Source + invitation, set as ONE running line in the header block. Quiet
     weight so it reads as provenance rather than advertising; only the URLs and
     the term carry emphasis. */
  .hrule{stroke:#C9BFA4;stroke-width:1.2}
  .hsrc{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:12px;fill:#8a8470;letter-spacing:.01em}
  .hsrc-em{font-weight:700;fill:#5f5849}
  /* The two vision columns under the ruled scripture — a step down in scale from
     body prose, so the scripture above them stays the louder voice. */
  .hsrc2{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:12px;fill:#8a8470;letter-spacing:.01em}
  .hsrc-url{font-weight:700;fill:#6B4A78}
  .hsrc-it{font-style:italic}
  /* The goal question — the hinge between the vision and the three networks.
     Slightly larger and darker than body prose because it is the one line the
     whole header is arranged around. */
  .hgoal{font-family:Georgia,'Times New Roman',serif;font-size:14.5px;font-style:italic;
    fill:#4a4636;letter-spacing:.01em}
  /* Hairline between grid columns. A rule, not a box: it separates the columns
     without drawing a container around them. */
  .hcolrule{stroke:#D6CCB4;stroke-width:.8}
  /* The compassion verse under the facts table — scripture, so it takes the
     serif italic of the footer verse rather than the sans of the metadata. */
  /* Sized to fit the map width on ONE line — the whole point of this block is that
     it spans the map exactly, like the goal question below it. 12.5px measures
     ~1052px against an 1100px span, which keeps real headroom over the estimator's
     error band rather than sitting one glyph from overflow. */
  .hverse{font-family:Georgia,'Times New Roman',serif;font-size:12.5px;font-style:italic;
    fill:#4a4636;letter-spacing:.01em}
  .hvref{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:9.5px;
    fill:#8a8470;letter-spacing:.14em;font-weight:700;font-style:normal}
  /* The hook is a QUESTION and reads one step up from the body — it is the line
     that stops a passer-by, and everything after it is the answer. */
  /* The vision block gets a small titled heading of its own — it tells a passer-by
     what they are about to read before they commit to reading it. Small caps and
     letterspacing mark it as a heading without needing size. */
  .hvh{font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:700;
    fill:#3f3a2e;letter-spacing:.06em;font-variant:small-caps}
  .verse{font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:17px;fill:#4a4636}
  .vref{font-family:'Segoe UI',system-ui,sans-serif;font-size:12px;fill:#8a8470;letter-spacing:.14em;text-transform:uppercase}
  .attrib{font-family:'Segoe UI',system-ui,sans-serif;font-size:8px;fill:#a39c87;letter-spacing:.02em}
  @media print{@page{size:${FMT.page};margin:0}html,body{background:#fff}.stage{margin:0}}
</style></head><body><div class="stage">${svg}</div></body></html>`;
  return { html, title, octiOK, crossings, diagFrac };
}

// ── main ──────────────────────────────────────────────────────────────────────
const records = await loadRecords();
const tops = buildLegendNodes(clusters, { records });
const zones = leafZones(tops);

// ── SERIES FACTS, derived — never typed ──────────────────────────────────────
// The the brief's requirement: numbers on the poster must come from the API and the
// cluster data at generation time, so a sheet printed later states later figures
// rather than carrying a stale count on a wall. `index` is filled per-poster.
const SERIES = {
  totalGroups: zones.reduce((a, z) => a + (z.count || 0), 0),
  totalLists: zones.length,
  index: 1,
};

// attach .selector by id, EXACTLY as upg-100-list.vue:1103-1110 (leaves don't carry it)
const byId = {};
for (const l of clusters.lists || []) byId[l.id] = l.selector;
for (const a of clusters.asia_lists || []) byId[a.id] = a.selector;
for (const u of clusters.uncovered_lists || []) byId[u.id] = u.selector;
byId['deaf'] = { type: 'affinity_bloc', rop1: 'A017' };
for (const z of zones) z.selector = byId[z.id];

// slug → zoneKey, exactly as upg-100-list.vue (regional before asia; pg_slugs special-cased)
const slugToZone = {};
for (const z of zones) {
  if (z.selector && z.selector.type === 'pg_slugs') {
    for (const s of (z.selector.values || [])) if (!(s in slugToZone)) slugToZone[s] = z.zoneKey;
  } else if (z.selector) {
    try { for (const s of evaluate(z.selector, records)) if (!(s in slugToZone)) slugToZone[s] = z.zoneKey; }
    catch (e) { console.warn('zone selector skipped', z.id, e && e.message); }
  }
}
const pinsByZone = new Map(zones.map((z) => [z.zoneKey, []]));
for (const r of records) {
  const lat = Number(r.latitude), lng = Number(r.longitude);
  if (!isFinite(lat) || !isFinite(lng)) continue;
  const zk = slugToZone[r.slug];
  // country_code is carried so the poster can name the COUNTRIES it covers in its
  // subtitle; the pin record previously dropped it and the subtitle came out empty.
  if (zk && pinsByZone.has(zk)) pinsByZone.get(zk).push({
    name: r.name || r.slug || '', lat, lng, slug: r.slug, country_code: r.country_code,
  });
}

const ONLY = process.env.ONLY;
const manifest = [];
let made = 0;
for (const z of zones) {
  // The sheet's own position in the series, taken from the zone ordering so it is
  // stable across runs and correct even when ONLY builds a single poster.
  SERIES.index = zones.indexOf(z) + 1;
  if (ONLY && z.zoneKey !== ONLY && z.id !== ONLY) continue;
  const pins = pinsByZone.get(z.zoneKey) || [];
  const zoneFC = resolveZoneGeometry(z, { records, adm0, adm1Ind, adm1Chn });
  const { html, title, octiOK, crossings, diagFrac } = renderPoster(z, pins, zoneFC);
  const file = `${z.zoneKey}.html`;
  writeFileSync(join(POSTERS, file), html);
  manifest.push({ zoneKey: z.zoneKey, title, count: pins.length, octilinear: octiOK, crossings, diagFrac, html: `posters/${file}`, png: `posters/${z.zoneKey}.png` });
  made++;
  console.log(`  ✓ ${z.zoneKey.padEnd(34)} ${String(pins.length).padStart(3)} pins  octi=${octiOK?'Y':'N'}  d=${diagFrac}  cross=${crossings}`);
}
if (!ONLY) writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ generated: 'live', count: manifest.length, posters: manifest }, null, 2));
console.log(`\n${made} poster(s) → ${POSTERS}${ONLY ? ' (ONLY=' + ONLY + ')' : ', manifest.json written'}`);
