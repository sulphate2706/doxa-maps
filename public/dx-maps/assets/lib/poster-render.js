/**
 * poster-render.js — THE MAP SHEET GENERATOR, as a pure factory that runs in Node AND in the browser.
 *
 * ★ WHY IT MOVED HERE. The zone and country map sheets (the posters, and the map-only sheet on a
 * packet's page 1) were drawn only by library/scripts/posters/generate.mjs, a Node script: the browser
 * could print a sheet only if one had been generated ahead of time and STORED. The print
 * standard's rule is the opposite — every export is generated at the moment it is asked for, and
 * only true previews are stored. This file is that generator with its Node half taken off: the drawing
 * code is moved here byte-for-byte, and everything it used to read from the machine is now PASSED IN.
 *
 * What the caller supplies (generate.mjs from files and env; a browser from fetches):
 *   env        the knobs generate.mjs read from process.env: FORMAT, POSTER_DATE, SPARSE, CITIES,
 *              BASEMAP, SERIES_NAME, PIN_R. A plain object — the code below reads `process.env.X`
 *              through a LOCAL `process`, which is what lets it move without a single edit.
 *   SERIES_DEF the series' definition from series.json (upg100 / country): its poster text, networks,
 *              and whether it is the country series.
 *   ISO3_NAME  the ISO3 -> English country name table the labels are drawn from.
 *   adm0       world country boundaries (the neighbouring countries drawn around the zone).
 *   adm1Ind, adm1Chn  province boundaries (optional; zones with provinces name them from these).
 *   nePlaces   Natural Earth capitals and cities (optional; absent = no city dots, never a crash).
 *   fetchGrid, bestZoom  the OSM street basemap (optional; only city posters use it).
 *   series     { totalGroups, totalLists, index } — the SERIES facts; the caller may mutate it.
 *
 * renderPoster(zone, pins, zoneFC) -> { html, title, octiOK, crossings, diagFrac }, exactly as before.
 * PROVEN BYTE-IDENTICAL AT THE MOVE: every sheet the Node generator writes — the 28 zones in all four
 * formats and the countries at both sheet sizes, offline with a pinned date — hashed the same before and
 * after (see the commit that created this file). Cities are the one mode not in that proof: they fetch
 * live OSM tiles, which no offline run can reproduce.
 */
export function createPosterGenerator({
  env = {}, SERIES_DEF = {}, ISO3_NAME = {}, adm0 = null, adm1Ind = null, adm1Chn = null, nePlaces = [],
  fetchGrid = null, bestZoom = null, series = { totalGroups: 0, totalLists: 0, index: 1 },
} = {}) {
// The moved code reads process.env.X; this LOCAL process makes that read the caller's env object.
const process = { env };
const SERIES = series;
// ── PIN BBOX: antimeridian-aware, outlier-trimmed ───────────────────────────
// Two independent failure modes made three posters render the WHOLE GLOBE:
//
//  1. ANTIMERIDIAN WRAP. oceania-indonesia runs 83.9E -> -136.0 (i.e. across the
//     date line). A plain min/max gives W=-136, E=+83.9 and calls that 220 wide,
//     so the projection zooms out to fit a span that is really ~140 the OTHER
//     way round. It is a zoom issue: part of the region overlaps the edge of the
//     globe, so the frame zooms in and takes the clip from the other edge.
//     Fix: sort the longitudes, find the LARGEST GAP between adjacent pins, and
//     cut the circle there — the remaining arc is the true span. Longitudes east
//     of the cut are unrolled past 180 so the box is contiguous.
//
//  2. FAR OUTLIERS. europe ran -42 -> 168.6E: a handful of pins in Siberia and
//     the Americas dragged the box across Eurasia, so "Europe" rendered Brazil,
//     Japan and Iceland. Fix: drop the extreme 4% at each end when that shrinks
//     the span materially. Every pin still RENDERS — the leader lines reach them
//     — but a few strays no longer set the zoom for the other 96%.
function pinBbox(pins) {
  const lats = pins.map((p) => p.lat).sort((a, b) => a - b);
  const lngs = pins.map((p) => p.lng).sort((a, b) => a - b);
  const n = lngs.length;
  // (1) cut the circle at the largest gap
  let gap = -1, cut = 0;
  for (let i = 0; i < n; i++) {
    const a = lngs[i], b = lngs[(i + 1) % n];
    const g = i === n - 1 ? (b + 360) - a : b - a;
    if (g > gap) { gap = g; cut = (i + 1) % n; }
  }
  const unrolled = lngs.map((_, k) => {
    const v = lngs[(cut + k) % n];
    return v < lngs[cut] ? v + 360 : v;
  });
  // (2) trim outliers, but only when it actually helps
  const trim = (arr) => {
    const k = Math.floor(arr.length * 0.04);
    if (k < 1) return arr;
    const inner = arr.slice(k, arr.length - k);
    const full = arr[arr.length - 1] - arr[0];
    const cutSpan = inner[inner.length - 1] - inner[0];
    return cutSpan < full * 0.72 ? inner : arr;
  };
  const lo = trim(unrolled), la = trim(lats);
  let W = lo[0], E = lo[lo.length - 1];
  if (W > 180) { W -= 360; E -= 360; }
  return [W, la[0], E, la[la.length - 1]];
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
  // 3x4 REBUILT 2026-08-01 from the production v5 3x3 — NOT the old 1350x1800 sheet.
  // It is cheap because the whole template already exists: the sheet is one foot
  // longer, and every field and parameter built for the 100 list carries over.
  // WIDTH STAYS 1500. That is the whole reason this is cheap: the header budget,
  // the 330 gutter and every width-derived measurement were calibrated at 1500 and
  // carry over intact. The OLD 3x4 was 1350 wide, and that narrower sheet is exactly
  // what overflowed the header guard by 4px (content y=355 vs HEADER=351) — the rot
  // was a WIDTH problem, not a height one. Only height-derived values change here,
  // and those already derive from MAP_BREATH/HEADER rather than hardcoded offsets.
  // Serves China (154 groups) and is the sheet the shelved granular 4-column table
  // (F93) was waiting on — build it once, both are served.
  '3x4': { w: 1500, h: 2000, gutter: 330, page: '3in 4in', pageWidthIn: 3 },
  // Square: a 3ft x 3ft sheet. The map loses height relative to 3x4, so the
  // gutters widen slightly — with fewer label rows per column the names can take
  // more width, and the map stays close to square rather than becoming a letterbox.
  // GUTTER IS THE NAME COLUMN — widening it narrows the map, and that is the
  // intended trade: a slightly narrower map gives the names room to get longer
  // or larger.
  // 240 -> 285: at 240 the name column was only ~145px after the index column, so
  // ordinary names like "Kummara, Kummari" and "Parvatarajakulam" wrapped when
  // they had no need to. Wrapping is only necessary when a name would overrun
  // the gutter space. 285 fits every name on this sheet but the single longest.
  // 285 -> 330. The white sheet edge took 26px off each label column and nothing
  // gave it back, so names needed 185-215px but had only 177 and SEVEN wrapped
  // that had no need to (rows 1, 6, 34, 44 and 49 among them). At 330 the name
  // column is 222px and only "Vellaiyan Kuppam Padaiyaci" (265px) still wraps,
  // which is a name that genuinely overruns any sane column.
  '3x3': { w: 1500, h: 1500, gutter: 330, page: '3in 3in', pageWidthIn: 3 },
  // LETTER PORTRAIT — the same sheet, sized for paper a normal printer can take.
  // The layout and the text stay exactly those of the poster; only the format
  // changes, to a vertical sheet of paper.
  //
  // WIDTH STAYS 1500 for the reason the 3x4 note gives above: every width-derived
  // measurement (the 330 gutter, the name columns, the header budget) was calibrated
  // at 1500 and carries over UNCHANGED. Height is the only variable: 8.5x11 at
  // width 1500 -> 1500 * (11/8.5) = 1941. That lands between 3x3 (1500) and 3x4
  // (2000), so the map keeps roughly the 3x3 proportions with ~29% more height for
  // the label columns — the sheet gets taller, nothing gets re-tuned.
  //
  // `page` is what the generated HTML puts in @page{size:...}. Naming the real
  // paper size (rather than an inch pair) lets the browser's own Letter preset
  // match it, which is what makes an ordinary printer produce a full-bleed-free,
  // correctly-scaled sheet instead of "fit to page" guesswork.
  letter: { w: 1500, h: 1941, gutter: 330, page: 'letter portrait', pageWidthIn: 8.5 },
  // ★ PACKET PAGE 1 — THE MAP ALONE, ON A VERTICAL PAGE. Not the poster: page 1 of a prayer packet is
  // a lightweight one-pager showing the geography and every pin with its numbered name, and nothing of
  // the poster's furniture (the facts table, the two vision columns, the three networks, the closing
  // verse). Those are English prose baked into the artwork, which is also why the poster could never be
  // page 1 of a translated packet: the packet draws its OWN title into the reserved band, from the
  // locale's strings, and this sheet supplies only what needs no translation — the map, the pins and
  // the people-group names.
  //
  // SAME 1500x1941 AS `letter` AND AS THE PACKET'S OWN SHEET (packet-render.js W/H), so it drops onto
  // page 1 at 1:1 with no rescale. `header` is the band left EMPTY for the packet's title block and
  // `footer` the band for its fine print; everything between goes to the map and its label columns —
  // about 1,600px of height against the letter sheet's ~1,200, which is what lets the names grow.
  // Output: <zone>.packet.html beside the posters (see FILE_SUFFIX), never over them.
  packet: { w: 1500, h: 1941, gutter: 330, page: 'letter portrait', pageWidthIn: 8.5, mapOnly: true, header: 250, footer: 90 },
  // ★ LARGE SHEETS WITH SIDE LANES (`sideLanes`): a whole country's hundreds of groups, every one named horizontally
  // in two staggered columns per side, ONE leader per cluster of co-located groups, crossing-free by construction
  // (see sideLanesLayout). Same 41.67 px/in as the 3x3, so the header, pins and footer keep their physical size.
  // `nameMaxPt` caps the names' print size; the layout solves the largest size that fits the rows and columns.
  '60x96': { w: 2500, h: 4000, gutter: 572, page: '60in 96in', pageWidthIn: 60, sideLanes: true, nameMaxPt: 20.7, photos: true },
  '66x66': { w: 2750, h: 2750, gutter: 470, page: '66in 66in', pageWidthIn: 66, sideLanes: true, nameMaxPt: 18, photos: true },
  '36x60': { w: 1500, h: 2500, gutter: 400, page: '36in 60in', pageWidthIn: 36, sideLanes: true, nameMaxPt: 14, photos: false },
};
const FMT_KEY = FORMATS[process.env.FORMAT] ? process.env.FORMAT : '3x4';
// The side-lane marks' styles: emitted ONLY on a sideLanes sheet, so every other format's page is byte-identical.
const SIDE_LANES_CSS = `
  .slead{stroke:#5a5246;stroke-width:0.9;fill:none;opacity:.5}
  .sbr{stroke:#5a5246;stroke-width:1.1;fill:none}
  .srow{stroke:#b9ac8c;stroke-width:.3;fill:none;opacity:.7}
  .spin{fill:#1c1c17;stroke:#f7f4ec;stroke-width:.8}
  .snm{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-weight:700;fill:#1c1c17}`;
// The three-column header's styles, and the footer prose drawn at the size it is MEASURED at: the footer's
// three blocks are wrapped and spaced for 13.5px (FS below) but were drawn at .hsrc's 12px, so the text can
// grow to 13.5 with no change to the lines or the band's height. Emitted only for a series that opts in.
const HEAD_COLUMNS_CSS = `
  .hcolk{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:12.5px;fill:#8a8470;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
  .hcolt{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:14px;fill:#5f5849;letter-spacing:.01em}
  .hsrc{font-size:13.5px}`;
// ★ READABLE ON PAPER (2026-10-02): the full sheet is the packet's page 1, printed on letter at 92% (its margins),
// where 14px column text came out near 5pt in light grey. The header band and the footer's three blocks are set
// at 22 / 21px with darker ink: about 8pt on the printed page. Only the full layout (HEAD_COLUMNS) gets this; the
// series-wide rules above stay as they were, so the series' SPARSE posters are byte-identical.
// Print size = sheet px x 0.92 (the packet's margins) x 0.408 (1500px = 8.5in): 22px ≈ 8.3pt, 19px ≈ 7.1pt.
const HEAD_COLUMNS_FULL_CSS = `
  .hcolk{font-size:19px;fill:#2f2a22;font-weight:800;letter-spacing:.1em}
  .hcolt{font-size:22px;fill:#3a362c}
  .hcolb{font-weight:700;fill:#2f2a22}
  .hcolh{font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:700;fill:#2f2a22;letter-spacing:.04em;font-variant:small-caps}
  .hvref{font-size:19px}
  .hverse{font-size:19.5px}
  .hsrc{font-size:22px;fill:#4a4636}
  .hsrc-em{fill:#2f2a22}`;
const FMT = FORMATS[FMT_KEY];
// Map-only sheets (packet page 1) skip the poster's header and footer furniture — see FORMATS.packet.
const MAP_ONLY = FMT.mapOnly === true;
// ★ A FORMAT THAT IS NOT A POSTER MUST NOT OVERWRITE THE POSTER. Every format used to write
// out/posters/<zone>.html, so `FORMAT=letter` silently replaced the 3x4 poster the wall and the site
// serve — which is part of why no letter or packet sheet was ever generated alongside them. The paper
// formats get their own names. 3x4 and 3x3 keep the bare name: they ARE the poster, whichever was
// built last, and renaming them would break every consumer that fetches posters/<zone>.html.
const FILE_SUFFIX = { letter: '.letter', packet: '.packet' }[FMT_KEY] || '';
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
// ── SPARSE (v3, "thumbnail-worthy") ─────────────────────────────────────────
// The full sheet carried too much information. This variant carries less: larger
// people-group names and a larger map; the how-to question stays at the bottom,
// the scripture at the top, and the table that explains the countries stays too;
// the two explainers (the Jesus Strategy for 5000, and What is a Prayer List of
// 100) are dropped.
//
// The point is a poster that survives being a BLOG THUMBNAIL: at thumbnail scale
// the only things that must still read are the region name, the map and the
// people-group names. The two vision columns are what cost the most height, and
// height is what was squeezing the names down to ~10.6px.
//
// SPARSE=1 drops those two columns and gives the reclaimed height to the map,
// which raises the label type from ~10.6px to ~14.8px (+40%).
const SPARSE = process.env.SPARSE === '1';
// ★ THE HEADER IN THREE COLUMNS (series opt-in, `poster.headColumns`). The full sheet's facts stacked as
// centred rows ABOVE the scripture and only two columns sat under it, the first starting at the band's
// edge with no inset. With the flag the scripture banner sits directly under the title and ONE
// three-column band follows it, built like the footer's: the facts (countries, administrative areas,
// people groups, series) | Jesus' strategy | what the series is, each block centred in an equal column
// between short rules, the text a size larger. Opt-in per series so every other series' sheet stays
// byte-identical; SPARSE already sets its facts as columns and is unchanged.
// MODE FLAGS live HERE, beside SPARSE, because renderPoster() reads them at line
// ~735 — far above where the mode blocks sit. Declaring them next to their mode
// block left a const declared at 2372 being read at 735; it happened to work
// because renderPoster is only CALLED after that line executes, but it is a
// temporal-dead-zone accident, not a design. One misplaced early call would turn
// it into a crash that looks unrelated to the mode.
const CITIES = process.env.CITIES === '1';
// OSM street tiles on city sheets. Opt-in (BASEMAP=1) so a run can be reproduced
// without network access, and so the tile cache is only exercised deliberately.
const BASEMAP = process.env.BASEMAP === '1';
// ★ DERIVED FROM THE SERIES, so SERIES=country selects the country ZONE SOURCE too and not just
// the wording. COUNTRIES=1 still works: it resolves to SERIES_ID 'country' above, whose
// countryMode is true, so this is the same boolean by a different route.
const COUNTRIES = SERIES_DEF.countryMode === true;
// SERIES NAME — the operator is still settling this ("it might make more sense to
// call it 'UPG100 List'"). One constant, so the rename is a one-line change
// and never has to be hunted across the sheet.
// The name inside the quotes on the sheet: Series "UPG100 List".
// PARAMETERIZED PER APP — the country app is a different series entirely, so it
// must not print the 100-list's name. Country mode defaults it below (COUNTRIES=1
// → "Country Maps"); SERIES_NAME still overrides either default.
// The country series prints "Country Maps" inside the quotes, so the series name is a
// parameterized field.
// ★ NOW FROM series.json (SERIES_DEF.poster.seriesName), so the Series line, the facts-table row
// and the side box all read one source. CITIES keeps its own name: there is no cities entry in
// series.json yet, and inventing one here would be a second place to look. SERIES_NAME still
// overrides everything, which is the behaviour the original comment promised.
const POSTER_TEXT = SERIES_DEF.poster || {};
const HEAD_COLUMNS = POSTER_TEXT.headColumns === true && !SPARSE && !MAP_ONLY;
// The series-wide part (the footer prose at its measured size) applies to its SPARSE sheets too.
const HEAD_COLUMNS_ON_SERIES = POSTER_TEXT.headColumns === true && !MAP_ONLY;
// The full sheet's footer band at the larger type (21px blocks): measured on the 28 zones, see HEAD_COLUMNS_FULL_CSS.
const FULL_FOOTER = 400;
const SERIES_NAME = process.env.SERIES_NAME
  || (process.env.CITIES === '1' ? 'Key City Maps'
   :  POSTER_TEXT.seriesName
   || 'UPG100 List');
// ── PIN BADGE RADIUS (template parameter) ───────────────────────────────────
// The numbered disc on the map. It is the single knob that decides how far the
// de-collision pass has to shove pins away from their true coordinates: MIN_SEP
// is derived from it, so a smaller badge means truer pin placement.
// 8.0 measured: drops mainland occupancy on Tamil Nadu from 51% -> 29%.
// Overridable per run; `zone.pinScale` multiplies it per zone.
const PIN_R_BASE = Number(process.env.PIN_R || 8.0);
// The province enumeration for a zone. `label` is now an authored REGION NAME, so
// it must NOT be split for provinces — clusters.json keeps the old enumeration in
// `provinceLabel`. Defined once because the header-MEASURING pass and the RENDER
// pass both need it and had drifted to different rules.
const provincesOf = (zone) =>
  Array.isArray(zone.provinces) && zone.provinces.length ? zone.provinces
  : zone.provinceLabel ? String(zone.provinceLabel).split(' + ').map((x) => x.trim()).filter(Boolean)
  : String(zone.label || zone.id).split(' + ').map((x) => x.trim()).filter(Boolean);
// Sheet margin for the FULL-WIDTH bands (scripture + facts above the map, the
// goal question + three networks below it, and the closing verse). Deliberately
// independent of GUTTER: the gutters exist to give the label columns room and get
// re-tuned per format, while these bands always want the sheet's own edge.
// The horizontal rules go full width, all the way to the white border: they run
// to SHEET_EDGE exactly and terminate against it —
// the white edge becomes the frame they resolve into. The TEXT inside these bands
// still gets its own inset (BAND_TEXT_PAD) so words never touch the border.
const BAND_MARGIN_G = 26;   // == SHEET_EDGE; rules meet the white border
// Breathing space between the map block and the ruled bands above and below it.
// The map and the people groups sat closer to the bottom table than to the top
// one, so the spacing needed evening out. The two gaps were set by INDEPENDENT
// constants and had drifted to 82px above / 38px below — the map block visibly
// sank toward the footer. One constant is used on both sides, so they cannot
// diverge again as the header grows or shrinks per zone.
const MAP_BREATH = 58;
const BAND_TEXT_PAD = 30;   // text inset within those rules
// White edge framing the whole sheet — a print margin: the border around the
// poster itself is a white edge. Drawn LAST, over everything, so any
// element that runs to the sheet edge is trimmed by it rather than colliding.
const SHEET_EDGE = 26;
// Label-column geometry. Hoisted to module scope because the label LAYOUT pass
// (which now solves for a uniform type size + wrapping) needs the same column
// width the RENDER pass uses; they were duplicated locals and drifted apart.
// Label columns must clear the white sheet edge, not sit ON it — at 26 they ran
// exactly to the edge and every long name was trimmed by it. Derived from
// SHEET_EDGE so the two can never drift apart again.
const SHEET_MARGIN_L = SHEET_EDGE + 8;
const LANE_EDGE_GAP_L = 6;
const LABEL_RES_M = () => GUTTER - SHEET_MARGIN_L - LANE_EDGE_GAP_L - 24;
const HEADER_BASE = SPARSE ? 355 : 460;
// 280 not 255 in the dense case. MEASURED, not guessed: on a 3x3 city sheet the
// below-map block put the verse rule at y=1461 against a hard limit of PH-56=1444
// — 17px over, and CONSTANT for every city zone (HEADER/MAP_H/fy are all
// zone-invariant when SPARSE is off), so the guard failed on the FIRST zone and
// no city poster rendered at all. 280 clears it with ~8px of slack for the
// per-zone wrapping the block's height depends on. This costs 25px of map height,
// which is the documented trade this constant exists to make.
const FOOTER = MAP_ONLY ? FMT.footer : SPARSE ? 316 : HEAD_COLUMNS ? FULL_FOOTER : 280;
// GUTTER was 300px A SIDE — 600 of 1350 (44% of the sheet) given to text, leaving
// the map only 750px wide. The names are short and do not need that; the MAP does.
// At 210 a side the map grows 750 -> 930 (+24% width, +24% linear scale), which is
// what gives the pins room to stop overlapping. The poster's own aspect ratio is
// untouched — PW/PH are unchanged; only the split between map and margin moves.
// Label column (LABEL_RES) drops to match, still comfortably wider than the
// longest people-group name at this size.
const GUTTER = FMT.gutter, GPAD = 16;
const MAP_X = GUTTER;
const MAP_W = PW - 2 * GUTTER;
// Set per-zone by setMapBox() before each poster renders.
let HEADER = MAP_ONLY ? FMT.header : SPARSE ? 355 : 460;
let MAP_Y = HEADER;
let MAP_H = PH - HEADER - FOOTER;
const setMapBox = (headerPx) => {
  HEADER = headerPx;
  MAP_Y = HEADER;
  MAP_H = PH - HEADER - FOOTER;
};
// HEADER IS PER-ZONE, NOT A SHARED CONSTANT. The facts table's height depends on
// how many countries and provinces a zone has, so one fixed HEADER cannot serve
// all 28 sheets: tuned to North India (2 countries) it overflowed on west-africa
// (many more), and tuned to west-africa it would steal ~60px of map from every
// other sheet. measureHeader() predicts the height from the zone's OWN content,
// so each poster gets exactly the header it needs and the map takes the rest.
// The fail-loud guard still runs afterwards as the backstop.
function measureHeader(zone, pins, ctryNames, provinces) {
  if (HEAD_COLUMNS) {
    // The same layout function the renderer draws with, so this is the height, not an estimate.
    const { bottom } = headColumnsBand(HC_TOP, headFacts(zone, pins), Math.round(SERIES.totalLists / 10) * 10);
    return bottom + 4 + 14;
  }
  if (!SPARSE) {
    // ── FULL VERSION: measured, not a constant ────────────────────────────────
    // This used to `return HEADER_BASE` — a flat 460 — so the per-zone measurement
    // everything above describes ONLY ever ran in SPARSE mode. Four zones' content
    // is taller than 460 and they threw the fail-loud guard, which meant they had
    // NO POSTER AT ALL: oceania-indonesia and andean-caribbean at 504, deaf at 619,
    // asia-china-tibet at 481.
    //
    // Raising the constant is the wrong fix: HEADER is subtracted from the map
    // height, so 460 -> 620 would steal 160px of map from the 25 healthy sheets to
    // rescue 4. That is exactly the tradeoff the per-zone measurement exists to
    // avoid (see the note above about tuning to North India breaking west-africa).
    //
    // MEASURED the full header on six zones and the shape is exact, not estimated:
    //   HEAD_BOTTOM = (headY + 34) + 118        on laos, west-africa, deaf,
    //                                           oceania-indonesia, andean-caribbean
    //                                           and asia-china-tibet — all six.
    // The 118 is the two vision columns (a constant 104 — they are fixed copy, so
    // they wrap the same on every sheet) plus the 14px trailing gap. ALL per-zone
    // variation is the facts table, which advances headY by 23px PER WRAPPED LINE.
    //
    // So the prediction is arithmetic on the same inputs the renderer wraps, and it
    // needs no slack — unlike the SPARSE model below, whose long +24/+52/+66/-8/+6
    // calibration history is what an estimate costs.
    const HEAD_MAXCH = 78;                 // must match the renderer's wrap width
    const wrapCount = (items) => {
      let lines = 0;
      let line = '';
      for (const it of items || []) {
        const next = line ? `${line} · ${it}` : it;
        if (next.length > HEAD_MAXCH) { lines += 1; line = it; } else { line = next; }
      }
      return lines + (line ? 1 : 0);
    };
    // headY = 191 + 23 * lines, DERIVED FROM THE RENDER on four zones rather than
    // from reading the code — an earlier attempt at this reasoned the constant to
    // 138 by tracing headY's assignments and was 53px short on every zone, because
    // the scripture block between the table and the vision columns advances the
    // cursor too. Measured: laos 283 (4 lines), west-africa 306 (5),
    // oceania-indonesia 352 (7), deaf 467 (12) — headY - 23*lines = 191 on all four.
    // The 4 rows are countries, administrative areas, people groups, series.
    const tableLines = wrapCount(ctryNames) + wrapCount(provinces) + 1 + 1;
    const headY = 191 + tableLines * 23;
    // +8 of slack: the guard is the real check, and being short fails the build
    // while being long costs a few px of map. Measured exact on six zones, so the
    // slack covers a content shape none of them had rather than a known gap.
    return headY + 34 + 118 + 8;
  }
  // PREDICT WITH THE SAME COLUMN WIDTHS THE RENDERER USES. This used to assume
  // four EQUAL quarter-width columns, but the table now sizes columns to their
  // content — so a zone with one long list (deaf, europe) was predicted to wrap
  // far more than it really does. The surplus landed as dead space ABOVE the map:
  // deaf rendered 340px above vs 74px below, a 266px drift.
  const FT_BAND = PW - 2 * BAND_MARGIN_G;
  const vals = [
    [`${pins.length} UPG's`, 34],
    [ctryNames.join(' \u00b7 ') || '\u2014', 17],
    [provinces.join(' \u00b7 ') || '\u2014', 17],
    ['~0.0M', 34],
  ];
  const wts = vals.map(([v]) => Math.sqrt(Math.max(10, String(v).length)));
  const tot = wts.reduce((a, b) => a + b, 0);
  const minW = FT_BAND * 0.17;
  let ws = wts.map((w) => Math.max(minW, (w / tot) * FT_BAND));
  const sum = ws.reduce((a, b) => a + b, 0);
  ws = ws.map((w) => (w / sum) * FT_BAND);
  const rows = Math.max(...vals.map(([v, fs], i) =>
    wrapPx(v, fs, ws[i] - 24 - BAND_TEXT_PAD / 2).length));
  // 136 title flow + series(28) + scripture block(53) + table head(22)
  // + first value row(34) + each extra wrapped row(20) + 14 trailing.
  // +24 measured: the guard reported 351 against a predicted 327 on the
  // reference zone, so the fixed part of the block is 24px taller than the
  // sum of its nominal steps (baseline offsets inside each sub-block).
  // +52 not +38: the estimate is a PREDICTION of a block whose exact height
  // depends on per-zone wrapping, so it carries slack rather than sitting on the
  // boundary. 14px of slack costs 14px of map on the tightest sheets and prevents
  // a per-zone constant hunt (sudan tripped a 38 that North India cleared).
  // The fail-loud guard remains the real check.
  // +66, was +52. The header now also carries the two-tone title, which sits on
  // its own line above the series text; zones whose facts wrap to fewer rows
  // (gujarat: one country, one province) tripped the guard at 52.
  // The trailing term is the gap between the last header rule and the map's top
  // edge. It uses MAP_BREATH so it MATCHES the gap below the map, plus 8px for
  // the rule's own weight and the drop shadow that sits above the frame.
  // -8 not +8: measured, the block lands 16px lower than the nominal sum of its
  // steps (baseline offsets inside each sub-block), so the trailing term is
  // corrected against the RENDER rather than trusted from arithmetic. This makes
  // the gap above the map equal the gap below it.
  // +6 of slack over the corrected value: the prediction is a MODEL of a block
  // whose height depends on per-zone wrapping, and gujarat (one country, one
  // province -> fewest wrapped rows) landed 12px past the corrected estimate.
  // Slack here costs a few px of map; being short trips the guard and fails the
  // build, so it errs generous. The guard remains the real check.
  // 28 -> 12: the series block is ONE line now, not two, so the model must stop
  // reserving the second line or the freed space just becomes a bigger top gap.
  // +16, was +6. Predicting with the renderer's real column widths made this
  // estimate much tighter, which is what let the map grow — but oceania-indonesia
  // then landed 8px past it and tripped the guard. A small fixed margin covers
  // the residual per-zone variation; the map still takes everything else.
  return 136 + 12 + 53 + 22 + 34 + Math.max(0, rows - 1) * 20 + MAP_BREATH + 16;
}

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
    // Seen from a distance the people-group names did not read; they need to be
    // larger and bold.
    // Two separate limits were holding them down: the 0.62 row-height ratio, and a
    // hard 15px CAP that bit as soon as the map grew. At 46 rows in a ~1030px band
    // the pitch is ~22px, so 0.76 gives ~17px type with ~5px of leading left — the
    // names stay separated while getting materially bigger. The cap rises with it;
    // rowH still governs, so a denser zone cannot collide.
    // ── ONE SIZE FOR EVERY NAME, WITH WRAPPING ────────────────────────────
    // Previously the size came from row pitch alone and long names were then
    // SHRUNK to fit the column width, so no two rows matched. Now the size is
    // uniform and a long name wraps instead — but a wrapped name occupies two
    // line-slots, so the pitch has to account for the extra lines BEFORE the size
    // is fixed. Solve it by trying the largest size down: for each candidate,
    // count how many lines the column really needs; keep the largest size whose
    // total lines still fit the band.
    // The number column is reserved on every line, so the wrap solver needs the
    // sheet's largest index. `pins.length` is the count for the whole sheet.
    const MAXNUM_L = pins.length;
    col.forEach((it) => { it.maxNum = MAXNUM_L; });
    // A map-only sheet frees the header and footer bands the same way SPARSE frees the vision
    // columns, so it gets SPARSE's ceiling; the solver still only uses what the column can hold.
    const MAXF = (SPARSE || MAP_ONLY) ? 19 : 15;
    // AVAIL IS THE COLUMN, AND THE NAME DOES NOT GET ALL OF IT.
    // The renderer draws the name starting one number-column IN from the column's
    // map-facing edge (`nameEdge = tx ± numColW`) but does not shrink its budget by
    // the same amount — so the name is handed `LABEL_RES` of room while physically
    // having `LABEL_RES - numColW`. Below, wrapName subtracts numW from `avail`,
    // which is the right intent but leaves the two ends disagreeing about where the
    // column starts. On a 109-row sheet that gap let "Eastern Xiangxi Miao" set as
    // one line and run to x=1479.7 — past the 1474 sheet edge. (Measured, not
    // estimated: the label is only 224.7px wide against a 262px budget, so it was
    // never a too-wide name. It STARTED 55px too far right.)
    // Trimming the budget here narrows the name column by SHEET_EDGE, which is
    // exactly the inset the renderer already applies. MEASURED EFFECT on the 28
    // 3x3 sheets: 18 identical, 10 shifted slightly as a row re-wrapped (e.g.
    // tamil-nadu 267->271, central-africa 256->239, deaf 115->119). No sheet gained
    // an overflow and none tripped a guard — the shifts are re-wraps, not damage.
    const avail = LABEL_RES_M() - 4 - SHEET_EDGE;
    const BOLD_W = 1.06;
    // Wrap `name` to `avail`, reserving room for the "12. " prefix on line 1.
    const wrapName = (it, f) => {
      // The name column is inset by the NUMBER column on every line (the number is
      // its own element now), so the reserve applies to all lines, not just line 1.
      const numW = textW(`${it.maxNum}.`, f) * BOLD_W + f * 0.42;
      const words = String(it.name).split(/\s+/).filter(Boolean);
      const out = []; let line = ''; let first = true;
      const room = avail - numW;
      for (const w of words) {
        const cand = line ? `${line} ${w}` : w;
        if (textW(cand, f) * BOLD_W > room && line) { out.push(line); line = w; }
        else line = cand;
      }
      if (line) out.push(line);
      return out.length ? out : [it.name];
    };
    let font = MAXF, wraps = null;
    for (let f = MAXF; f >= 8; f -= 0.25) {
      const ws = col.map((it) => wrapName(it, f));
      const totalLines = ws.reduce((a, w) => a + w.length, 0);
      // Each line needs f*1.06 of pitch, plus a little air between rows.
      if (totalLines * (f * 1.06) + col.length * (f * 0.34) <= bandH) { font = f; wraps = ws; break; }
    }
    if (!wraps) wraps = col.map((it) => wrapName(it, font));
    // Re-pitch rows by LINE COUNT so a two-line name gets the room it needs and
    // single-line rows are not stretched to match it.
    const lineH = font * 1.06;
    const gap = font * 0.34;
    const usedH = wraps.reduce((a, w) => a + w.length * lineH, 0) + col.length * gap;
    const slack = Math.max(0, bandH - usedH) / Math.max(1, col.length);
    let cursor = bandTop + slack / 2;
    col.forEach((it, i) => {
      it.wrap = wraps[i];
      const blockH = wraps[i].length * lineH;
      it.labelY = cursor + lineH * 0.5 - font * 0.34;
      cursor += blockH + gap + slack;
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

// ── THE THREE-COLUMN HEADER BAND (HEAD_COLUMNS) ──────────────────────────────
// ONE function lays the band out for both callers: measureHeader() reads only its bottom, renderPoster() emits
// its text. A second copy of the arithmetic is how the full header's prediction once ran 53px short.
// Built like the footer's three networks: equal columns, a text measure narrower than the column, each block
// CENTRED on its column with its lines sharing one left edge, and short rules between the columns.
//   1 Jesus' strategy to feed the 5000
//   2 the facts: a bold key above each value (countries, administrative areas, people groups, series)
//   3 what the series is
const HC = { gut: 32, fs: 22, lh: 27, keyFs: 19, keyLh: 24, headLh: 30, gap: 8, headFs: 23 };
// textW is calibrated for Lato. Without Lato the browser falls back to a system sans that sets
// these columns 2-6% wider (measured 1.05-1.06x in DejaVu Sans). Each block is centred on its
// width at 1.03x, halfway, so any overrun splits across both sides instead of all running right.
const HC_FALLBACK = 1.03;
// The two explainer columns' text, ONE copy for both header layouts (the head-columns band and the classic
// header), so the two can no longer drift apart. A series may set its own Jesus column in series.json
// (poster.strategyBody: one paragraph, or a list of them), as UPG100 does; the series that do not, the
// Country and India-state posters, print this default.
// COPY IS THE OWN (05-poster-vision/source-material/01). It KEEPS THE MIRACLE: earlier drafts reduced the
// account to a seating arrangement, when the point is that Jesus supernaturally MULTIPLIED the offering
// and the grouping is how it was distributed.
const STRATEGY_DEFAULT = [
  'Jesus’ disciples faced a similar challenge: “How can we feed so many with only five loaves and two fish?” Jesus fed the 5,000 by supernaturally multiplying that small offering — and His answer holds the key to our people-groups problem.',
  'Through radical faith and miracle-expectant prayer, He focused on the few in front of Him — dividing the crowd and entrusting faithful men and women to serve the most strategic groups of fifties and hundreds (Mark 6:40).',
];
const strategyParas = () => (POSTER_TEXT.strategyBody ? [].concat(POSTER_TEXT.strategyBody) : STRATEGY_DEFAULT);
// The explainer's further paragraphs (its first is series.json's sideBoxBody). A series may set its own in
// series.json (poster.sideBoxMore: one paragraph, or a list; [] prints none), as UPG100 does to keep its band even.
const whatIsMore = () => (POSTER_TEXT.sideBoxMore !== undefined ? [].concat(POSTER_TEXT.sideBoxMore) : [WHAT_IS_MORE]);
const WHAT_IS_MORE = 'Each map comes with a prayer list of its fifty to a hundred people groups — their names, a representative photo, and more detail — to mobilise informed intercession.';
// A paragraph's lines as SVG text content, its **...** runs set bold (.hcolb); the markers are not printed.
// The wrap measures the plain text: a short bold run is a few px wider, inside the measure's room.
function boldLines(text, width) {
  let plain = '', bold = [], on = false;
  for (const part of String(text).replace(/\s+/g, ' ').trim().split('**')) {
    for (let i = 0; i < part.length; i++) { plain += part[i]; bold.push(on); }   // per UTF-16 unit, as plain[p] reads
    on = !on;
  }
  let p = 0;
  return wrapPx(plain, HC.fs, width).map((ln) => {
    while (plain[p] === ' ') p++;
    let out = '', run = '', runBold = null;
    const flush = () => { if (run) out += runBold ? `<tspan class="hcolb">${esc(run)}</tspan>` : esc(run); run = ''; };
    for (let k = 0; k < ln.length; k++, p++) {
      if (bold[p] !== runBold) { flush(); runBold = bold[p]; }
      run += plain[p];
    }
    flush();
    return out;
  });
}
function headColumnsBand(top, facts, approxLists) {
  const GRID_L = BAND_MARGIN_G, GRID_W = PW - 2 * BAND_MARGIN_G;
  const CW = (GRID_W - 2 * HC.gut) / 3;
  // The measure leaves room for a fallback font (see HC_FALLBACK): a block set to it stays inside its column.
  const TW = (CW - 10 - BAND_TEXT_PAD / 2) * 0.92;
  // Uppercase, letterspaced keys: measured as capitals plus the .14em tracking.
  const keyW = (k) => textW(k.toUpperCase(), HC.keyFs) + k.length * HC.keyFs * 0.14;
  // Column order (2026-10-02): Jesus' strategy | the facts | what the series is.
  const cols = [
    [{ head: 'Jesus’ Strategy to Feed the 5000', paras: strategyParas() }],
    facts.map(([key, value]) => ({ key, lines: wrapPx(value, HC.fs, TW) })),
    [{ head: POSTER_TEXT.sideBoxHeading || 'What is a UPG100 List?', paras: [
      (POSTER_TEXT.sideBoxBody
        || 'This map is one of a {approxLists}-map set called the {seriesName} — a large, overwhelming target in the thousands, organised into clear groupings and displayed on maps and prayer lists.')
        .replace('{approxLists}', String(approxLists)).replace('{seriesName}', SERIES_NAME),
      ...whatIsMore(),
    ] }],
  ];
  let frags = '', bottom = top;
  cols.forEach((col, i) => {
    const centre = GRID_L + i * (CW + HC.gut) + CW / 2;
    if (col[0] && col[0].key !== undefined) {   // the facts column: a bold key above each value
      const blockW = Math.min(TW, Math.max(...col.map((r) => Math.max(keyW(r.key), ...r.lines.map((ln) => textW(ln, HC.fs))))));
      const x = (centre - blockW * HC_FALLBACK / 2).toFixed(1);
      let y = top;
      col.forEach((r, k) => {
        if (k) y += HC.gap;
        frags += `<text x="${x}" y="${y}" class="hcolk">${esc(r.key)}</text>`;
        y += HC.keyLh;
        for (const ln of r.lines) { frags += `<text x="${x}" y="${y}" class="hcolt">${esc(ln)}</text>`; y += HC.lh; }
      });
      bottom = Math.max(bottom, y);
    } else {
      const { head, paras } = col[0];
      // ★ MIRRORED (2026-10-03): both prose columns take the full measure, so each sits the same distance from
      // its rule and the two outer columns mirror each other round the centred facts column. (Each used to be
      // centred on its own widest line, so the two could sit at different distances from their rules.)
      const blockW = TW;
      const x = (centre - blockW * HC_FALLBACK / 2).toFixed(1);
      frags += `<text x="${x}" y="${top}" class="hcolh">${esc(head)}</text>`;
      let y = top + HC.headLh;
      paras.forEach((text, k) => {
        if (k) y += HC.gap;
        for (const ln of boldLines(text, TW)) { frags += `<text x="${x}" y="${y}" class="hcolt">${ln}</text>`; y += HC.lh; }
      });
      bottom = Math.max(bottom, y);
    }
  });
  for (let i = 1; i < 3; i++) {
    const rx = (GRID_L + i * (CW + HC.gut) - HC.gut / 2).toFixed(1);
    frags += `<line x1="${rx}" y1="${top - 14}" x2="${rx}" y2="${bottom - 12}" class="hcolrule"/>`;
  }
  return { frags, bottom };
}
// The facts the band's first column states, in its order. Shared by the measure and the render.
function headFacts(zone, pins) {
  const ctry = [...new Set([
    ...pins.map((p) => ISO3_NAME[p.country_code] || p.country_code),
    ...(Array.isArray(zone.adm0) ? zone.adm0.map((c) => ISO3_NAME[c] || c) : []),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en-US'));
  return [
    // A list of countries longer than a column can carry (the Deaf bloc names 66) prints its first ten and the
    // count of the rest, so one sheet's facts do not take its map's height.
    ['Countries', (ctry.length > 12 ? `${ctry.slice(0, 10).join(' \u00b7 ')} \u00b7 +${ctry.length - 10}` : ctry.join(' \u00b7 ')) || '\u2014'],
    ['Administrative Areas', provincesOf(zone).join(' \u00b7 ') || '\u2014'],
    ['People groups', `${pins.length} UPG`],
    ['Series', `${SERIES_NAME} \u00b7 map ${SERIES.index} of ${SERIES.totalLists}`],
  ];
}
// The band's first baseline: the title flow (136), the scripture block (16 + 25 + 12), and the 34 the
// renderer leaves before its columns. The bottom adds the renderer's 4 + 14.
// The verse's second line (HEAD_COLUMNS sets it on two) and the split, by words, nearest the middle of the text.
const HC_VERSE_LH = 26;
function VERSE_LINES(v) {
  const w = v.split(' '), half = v.length / 2;
  let best = 1, d = Infinity, run = 0;
  for (let i = 0; i < w.length - 1; i++) { run += w[i].length + 1; if (Math.abs(run - half) < d) { d = Math.abs(run - half); best = i + 1 } }
  return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
}
const HC_TOP = 136 + 16 + 25 + HC_VERSE_LH + 12 + 34;

async function renderPoster(zone, pins, zoneFC) {
  // Per-zone override for the badge, so a zone with unusually crowded or sparse
  // pins can tune without a code branch. Defaults to the template value.
  const PIN_R = PIN_R_BASE * (Number(zone.pinScale) > 0 ? Number(zone.pinScale) : 1);
  // SIZE THE HEADER FIRST — the map box is derived from it, and every geometry
  // consumer below reads MAP_Y/MAP_H. Both inputs are available up here: the
  // country list comes from the pins, and the province list from the zone (the
  // title-derived fallback only applies to zones with no `provinces` field, which
  // are exactly the zones whose label IS the province list).
  {
    const ctry = [...new Set(pins.map((p) => ISO3_NAME[p.country_code] || p.country_code).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'en-US'));   // pinned: the sheet must not sort by the reader's browser
    const prov = provincesOf(zone);
    // TWO-PASS SIZING. measureHeader() must err GENEROUS or the fail-loud guard
    // trips mid-build — but every over-reserved pixel used to sit as dead white
    // space above the map (deaf: 340px above vs 74px below).
    // A map with white space around it should grow into any vertical room, with
    // the people-group columns spaced out to match.
    // So: predict generously, then hand the map the FULL remaining band. MAP_H is
    // derived from the prediction, so a smaller header automatically yields a
    // taller map — and the label columns re-pitch to the same band, which is what
    // spaces the names out to match.
    // A map-only sheet has no header CONTENT to measure — the band is reserved, at a fixed height,
    // for the title the packet draws itself.
    setMapBox(MAP_ONLY ? FMT.header : measureHeader(zone, pins, ctry, prov));
  }
  // bbox: prefer resolved polygons; fallback to pins
  let bbox;
  // A CITY frames its OWN PINS. Its geometry selector is the whole country (see
  // the CITY MODE note), so falling through to the polygon bbox would zoom out to
  // all of India for an 8-pin cluster — measured on Ernakulam, where the sheet
  // showed three states and the cluster was a dot. pinBbox() also carries the
  // antimeridian + outlier handling the country path needs.
  if (CITIES && pins.length) {
    bbox = pinBbox(pins);
  } else if (zoneFC.features.length) {
    let W = 180, S = 90, E = -180, N = -90;
    for (const f of zoneFC.features) { const b = bboxOf(f.geometry); if (b[0] < W) W = b[0]; if (b[1] < S) S = b[1]; if (b[2] > E) E = b[2]; if (b[3] > N) N = b[3]; }
    bbox = [W, S, E, N];
    // A polygon set can span the globe for the same two reasons the pins can —
    // an antimeridian wrap or a far outlier — so fall back to the pin-derived
    // box when the polygon box is implausibly wide.
    if (E - W > 170 && pins.length) bbox = pinBbox(pins);
  } else {
    bbox = pinBbox(pins);
  }
  const FRAME_X = MAP_X;
  const proj = (lng, lat) => { const [x, y] = project(lng, lat); return [FRAME_X + x, FRAME_Y + y]; };
  // 25% context pad on EVERY side, on top of the projection's own 6%, left the
  // subject floating small inside a large empty frame — the poster's whole middle
  // was neighbouring land and sea. 10% still shows the surrounding countries (the
  // the brief calls for them named and visible) while letting the zone fill the sheet.
  // Enough surrounding land to PLACE the region on the globe. 10% showed barely
  // any neighbours; 22% brings in the countries that answer "where is this?"
  // CONTEXT PAD — a plain 22% of the subject's own span.
  // The `+1` is a DEGREE FLOOR so a narrow zone still shows some surround. For a
  // 100-list zone or a country that is right; for a CITY it dominates entirely.
  // MEASURED on Ernakulam: pin bbox 0.08deg wide, pad +1.018deg per side -> a
  // 2.1deg view. A ~9km cluster rendered as a three-state map with the pins as a
  // dot. That is a ~25x over-zoom produced by a constant, not by the math.
  // So the floor scales to the subject: a city gets a floor proportional to its
  // own span (min 0.05deg ~ 5km of surround), everything else keeps the 1deg floor
  // that the 28 existing sheets are tuned to.
  // The floor must scale with the CLUSTER, not sit at a constant. Measured after
  // the first fix: Thrissur's 5 pins still rendered 44x42px inside an 840x853
  // frame — 5% of the sheet — because a 0.05deg floor is huge next to a ~0.01deg
  // cluster. Five sheets shipped that way and I would not have caught them by eye.
  // Now the floor is a MULTIPLE OF THE SPAN with a very small absolute minimum, so
  // a tight cluster stays tight and a wide one still gets context.
  // Use the LARGER span for the floor, but pad each AXIS from its OWN span, so a
  // degenerate axis does not inherit the other's padding.
  // Measured: Kasaragod's 4 pins are PERFECTLY COLLINEAR — y-span exactly 0 — so a
  // single shared floor derived from max(w,h) over-padded the vertical into a
  // 0.0%-spread sheet. Nagercoil had the same shape less severely.
  // A zero-height bbox is not an error, it is a real arrangement of real pins, and
  // the frame has to cope with it rather than the data being blamed.
  const _w = bbox[2] - bbox[0], _h = bbox[3] - bbox[1];
  const _floor = (span) => Math.max(0.012, span * 0.6);
  const floorDeg = CITIES ? _floor(Math.max(_w, _h)) : 1;
  // PER-AXIS floor. A collinear cluster (zero span on one axis) must not be padded
  // as if it were as wide as the other axis — that is what produced a 0.0% spread.
  // A side-lane sheet is the COUNTRY at its largest: a thin margin, since the names, not neighbours, fill the sides.
  const pad = FMT.sideLanes ? [_w * 0.04, _h * 0.04]
    : CITIES
    ? [_w * 0.22 + _floor(Math.max(_w, _h * 0.35)), _h * 0.22 + _floor(Math.max(_h, _w * 0.35))]
    : [_w * 0.22 + floorDeg, _h * 0.22 + floorDeg];
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
  // A side-lane sheet fits the frame to the country's own shape and centres it: its names run the sheet's full height
  // beside it, so the frame need not, and a full-height frame would only shrink the country to show its neighbours.
  const FRAME_H = FMT.sideLanes ? Math.min(MAP_H, FRAME_W / zoneAspect) : MAP_H;
  // OPTICAL CENTRING, not geometric. A block centred by arithmetic looks like it
  // is falling off the bottom of the sheet — the optical centre sits ABOVE the
  // geometric one, which is why framers cut a bottom mat 1.25-1.4x the top. Here
  // the remainder is split 42/58 so the bottom margin is the larger one.
  const FRAME_Y = FMT.sideLanes ? MAP_Y + (MAP_H - FRAME_H) / 2 : MAP_Y;
  // PROJECT FROM viewBbox, NOT bbox.
  // These two had drifted apart: `viewBbox` (bbox + 22% context pad) decides WHICH
  // countries are drawn, while the projection scaled from the bare `bbox` — so the
  // generator selected neighbours it then had no room to show. They were emitted
  // into the SVG and clipped away by #mapclip.
  // Measured on country-zaf: 8 context polygons in the file, only 2 visible. Three
  // were at NEGATIVE y (-368, -98, -196) — above the frame — and two ran past its
  // right edge. Botswana/Zimbabwe/Mozambique were "missing" because they were drawn
  // off-sheet, not because they were absent.
  // The result on the sheet was random white spots where the countries around the
  // highlighted country should have been.
  // One box now governs both selection and scale, so anything chosen for context
  // is guaranteed to fit. padFrac drops to 0.02 because viewBbox already carries
  // the 22% context margin — keeping 0.08 would pad the padding and shrink the
  // subject on every sheet.
  const project = makeProjection(viewBbox, FRAME_W, FRAME_H, 0.02);
  // Hand the label layout the map band so names track the map, not the sheet.
  // IN SPARSE MODE the names get the SHEET's height instead. The names live in the
  // side margins, not inside the frame, so nothing stops them running past the map
  // band — and row pitch is what sets their type size. Letting them use the full
  // column between the header rule and the footer rule buys ~2px of type at no
  // cost to the map, and larger names are the point.
  if (SPARSE) {
    LABEL_TOP = HEADER - 40;
    LABEL_BOT = PH - FOOTER + 40;
  } else {
    LABEL_TOP = FRAME_Y; LABEL_BOT = FRAME_Y + FRAME_H;
  }

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
    ctxLabels.push({ x: lx, y: ly, nm: String(nm), member: isMember, area: bestArea });
  }
  // ALL-CAPS country names, tracked +0.1em (Bringhurst 5-10% of type size; shipped
  // map styles converge on exactly 0.1em). Haloed to the PAPER colour, not white.
  let ctryNames = '';
  // Biggest visible landmass first, so when two names compete for the same space
  // the more prominent country keeps its label.
  ctxLabels.sort((a, b) => (b.area || 0) - (a.area || 0));
  const placedLabels = [];
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
    // GREEDY DE-OVERLAP. The area test admits a label if the country is big
    // enough to deserve one, but says nothing about whether there is ROOM. On a
    // world-scale zone (uncovered-scatter) that let ~60 names pile into Eurasia
    // as an unreadable block. Reserve each accepted label's box and drop any
    // later one that would land on top of it — a name that cannot be read is
    // worse than no name, and the big countries win because they are sorted
    // by visible area first.
    const halfW = textW(L.nm, 15) * 0.5 + 6, halfH = 9;
    if (placedLabels.some((q) => Math.abs(q.x - L.x) < halfW + q.halfW
                              && Math.abs(q.y - L.y) < halfH + q.halfH)) continue;
    placedLabels.push({ x: L.x, y: L.y, halfW, halfH });
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
  // Provinces de-overlap against the SAME reservation list the country names
  // used, not a fresh one — otherwise a province name lands on top of a country
  // name that was already placed. Country names are laid out first and win, which
  // is the right precedence: a province is the finer detail of the two.
  for (const L of adm1Labels) {
    if (L.x < FRAME_X + 20 || L.x > FRAME_X + FRAME_W - 20) continue;
    if (L.y < FRAME_Y + 20 || L.y > FRAME_Y + FRAME_H - 20) continue;
    // 1.21 is MEASURED, not assumed: "Dādra and Nagar Haveli and Damān and Diu"
    // renders 295px where textW predicts 244 — the advance table under-reports
    // this run by ~21%, so an uncorrected guard let the overrun through.
    const PROV_W_CORR = 1.21;
    const pHalfW = textW(L.nm, 11.5) * PROV_W_CORR * 0.5 + 5, pHalfH = 7;
    // THE WHOLE LABEL MUST FIT INSIDE THE FRAME, not just its anchor point.
    // Only the anchor was bounds-checked, so a long name on a small subdivision
    // near the edge ran out of the map and was sliced mid-word by the frame
    // border, its tail crossing the leader lines. Measured on Central India:
    // "Dādra and Nagar Haveli and Damān and Diu" is far wider than the union
    // territory it names. A half-word ending at a hard edge is worse than no
    // label — same principle as the country-name de-overlap.
    if (L.x - pHalfW < FRAME_X + 4 || L.x + pHalfW > FRAME_X + FRAME_W - 4) continue;
    if (placedLabels.some((q) => Math.abs(q.x - L.x) < pHalfW + q.halfW
                              && Math.abs(q.y - L.y) < pHalfH + q.halfH)) continue;
    placedLabels.push({ x: L.x, y: L.y, halfW: pHalfW, halfH: pHalfH });
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
  // A side-lane sheet keeps every pin at its TRUE position: co-located groups share one leader instead.
  if (!FMT.sideLanes) {
    // MIN_SEP MUST TRACK THE BADGE SIZE. It was a hardcoded 25 tuned against the
    // old r=10.8 disc; leaving it fixed while the badge shrinks would keep pushing
    // pins just as far apart and defeat the whole point of the smaller badge.
    // 1.16x the diameter keeps a hairline of paper between neighbouring discs.
    const MIN_SEP = PIN_R * 2 * 1.16;
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

  // ── SIDE LANES: a whole country's groups on one large sheet (FMT.sideLanes) ───────────────────────────
  // Every name HORIZONTAL, on the left and right of the map, in two STAGGERED columns per side: the rows alternate
  // inner/outer at half the line pitch, so each column keeps a full pitch and each row holds exactly ONE name.
  // Co-located groups (within CL_R px) form a CLUSTER with ONE leader, a bracket and a block of names.
  // CROSSING-FREE BY CONSTRUCTION, which the numbered design below could not reach at this density:
  //   · one vertical split (the weighted median x) sends each cluster to the nearer side, so runs never meet;
  //   · each leader is a short vertical stub to its own LANE, a horizontal run to the map edge, then a straight fan
  //     to its block; lanes are placed FARTHEST-FROM-THE-EDGE first, each clamped between its neighbouring lanes,
  //     so a stub never jumps a lane, and the fan keeps the lanes' top-to-bottom order (ordered points on two
  //     parallel lines, joined in order, cannot cross). The count is measured and returned, never assumed.
  // A real photo (never the generic placeholder) sits on the OUTSIDE of its name when the format allows photos.
  function sideLanesLayout(pinsIn) {
    const X0 = MAP_X, X1 = MAP_X + MAP_W;
    const BY0 = LABEL_TOP ?? FRAME_Y, BY1 = LABEL_BOT ?? (FRAME_Y + FRAME_H);
    const PXI = PW / FMT.pageWidthIn;
    const pins = pinsIn.map((p) => ({ ...p, px: p._px, py: p._py }));
    // A photo only from the known people-group photo hosts, over https, and never the generic placeholder.
    const PHOTO_HOSTS = /^https:\/\/(media\.joshuaproject\.net|joshuaproject\.net|images\.peoplegroups\.org|peoplegroupspublic\.blob\.core\.windows\.net)\//;
    const photoOf = (p) => (FMT.photos && typeof p.image_url === 'string' && PHOTO_HOSTS.test(p.image_url) && !/no-photo-images/.test(p.image_url) ? p.image_url : null);
    const CL_R = 14, clusters = [];
    for (const p of pins) {
      const c = clusters.find((q) => Math.hypot(q.x - p.px, q.y - p.py) <= CL_R);
      if (c) { c.items.push(p); c.x += (p.px - c.x) / c.items.length; c.y += (p.py - c.y) / c.items.length; }
      else clusters.push({ x: p.px, y: p.py, items: [p] });
    }
    for (const c of clusters) c.items.sort((a, b) => String(a.name).localeCompare(String(b.name), 'en'));
    const byX = [...clusters].sort((a, b) => a.x - b.x);
    let acc = 0, split = byX.length ? byX[0].x : 0;
    for (const c of byX) { acc += c.items.length; if (acc >= pins.length / 2) { split = c.x; break; } }
    for (const c of clusters) c.side = c.x <= split ? 'L' : 'R';
    // THE TYPE: the largest size (capped by nameMaxPt) whose rows fit the band and whose two columns fit the gutter.
    const FAN = 70, GAP = 10, PHOTO_GAP = 4;
    const room = GUTTER - (SHEET_EDGE + 8) - FAN - GAP;
    const photoPx = (f) => Math.floor(f * 1.18) - 1;
    // ★ A PHOTO SITS IN A FIXED SLOT ON THE LEADER SIDE of its name, and its name moves out by the slot. A side-lane
    // name is anchored at its leader-side end (left: text-anchor end; right: start), so its glyphs lie wholly on the
    // far side of that anchor and the photo wholly on the near side: they cannot overlap whatever width the font
    // draws. (Placing the photo from an ESTIMATED width put it on the first letters of half the 60x96 names,
    // measured.) Only a name WITH a photo takes the slot, so the columns, and the type, keep their size.
    const slotOf = (p, f) => (photoOf(p) ? photoPx(f) + PHOTO_GAP : 0);
    const longest = (f) => Math.max(...pins.map((p) => textW(String(p.name), f) * 1.06 + slotOf(p, f)));
    const lineCount = (sd) => clusters.filter((c) => c.side === sd).reduce((a, c) => a + c.items.length, 0);
    const maxLines = Math.max(1, lineCount('L'), lineCount('R'));
    let font = Math.min((FMT.nameMaxPt || 14) / 72 * PXI, (BY1 - BY0) / (maxLines * 0.59 * 1.02));
    while (font > 5 && 2 * (longest(font) + 8) > room) font -= 0.1;
    const ROW = font * 1.18 / 2, PHOTO = photoPx(font), COLW = longest(font) + 8;
    // LANES, farthest from the edge first (see above). PIN_CLEAR: within its safe gap a lane prefers a height
    // that passes no other pin, at most 7.5 px from its own pin.
    const LANE_GAP = 1.5, PIN_CLEAR = 4.5;
    let laneJumps = 0;
    for (const sd of ['L', 'R']) {
      const L = sd === 'L';
      const mine = clusters.filter((c) => c.side === sd).sort((a, b) => (L ? b.x - a.x : a.x - b.x));
      const lanes = [];
      for (const c of mine) {
        let lo = -Infinity, hi = Infinity;
        for (const ly of lanes) { if (ly < c.y && ly > lo) lo = ly; if (ly >= c.y && ly < hi) hi = ly; }
        let y = Math.min(Math.max(c.y, lo + LANE_GAP), hi - LANE_GAP);
        if (lo + LANE_GAP > hi - LANE_GAP) { y = (lo + hi) / 2; laneJumps++; }
        else {
          const a0 = L ? X0 : c.x, a1 = L ? c.x : X1;
          const blockers = clusters.filter((o) => o !== c && o.x > a0 + 1 && o.x < a1 - 1);
          let best = y, bestHits = Infinity;
          for (let t = Math.max(lo + LANE_GAP, c.y - 7.5); t <= Math.min(hi - LANE_GAP, c.y + 7.5); t += 0.75) {
            const hits = blockers.filter((o) => Math.abs(o.y - t) < PIN_CLEAR).length;
            if (hits < bestHits || (hits === bestHits && Math.abs(t - c.y) < Math.abs(best - c.y))) { best = t; bestHits = hits; }
          }
          if (bestHits !== Infinity) y = best;
        }
        c.lane = y; lanes.push(y);
      }
    }
    // BLOCKS, stacked top to bottom in lane order, each as near its lane as the rows allow.
    const rowsAvail = Math.floor((BY1 - BY0) / ROW);
    let leadersS = '', labelsS = '', dotsS = '', overflow = 0;
    const placed = [];
    for (const sd of ['L', 'R']) {
      const L = sd === 'L';
      const blocks = clusters.filter((c) => c.side === sd).sort((a, b) => a.lane - b.lane)
        .map((c) => ({ c, n: c.items.length, want: (c.lane - BY0) / ROW }));
      const pos = []; let cur = 0;
      for (const b of blocks) { const q = Math.max(cur, Math.round(b.want - b.n / 2)); pos.push(q); cur = q + b.n; }
      let over = cur - rowsAvail;
      for (let k = pos.length - 1; k >= 0 && over > 0; k--) {
        const lim = k ? pos[k - 1] + blocks[k - 1].n : 0, can = Math.min(over, pos[k] - lim);
        for (let j = k; j < pos.length; j++) pos[j] -= can;
        over -= can;
      }
      overflow += Math.max(0, over);
      const edgeX = L ? X0 : X1, portX = L ? X0 - FAN : X1 + FAN;
      const innerX = L ? portX - 6 : portX + 6, outerX = L ? innerX - COLW : innerX + COLW;
      blocks.forEach((b, k) => {
        const c = b.c, r0 = pos[k], midY = BY0 + (r0 + b.n / 2) * ROW;
        leadersS += `<path class="slead" d="M${c.x.toFixed(1)} ${c.y.toFixed(1)}L${c.x.toFixed(1)} ${c.lane.toFixed(2)}L${edgeX.toFixed(1)} ${c.lane.toFixed(2)}L${portX.toFixed(1)} ${midY.toFixed(1)}"/>`;
        if (b.n > 1) leadersS += `<path class="sbr" d="M${portX.toFixed(1)} ${(BY0 + r0 * ROW + 1).toFixed(1)}V${(BY0 + (r0 + b.n) * ROW - 1).toFixed(1)}"/>`;
        dotsS += `<circle class="spin" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${b.n > 1 ? 4.4 : 3.2}"/>`;
        c.items.forEach((g, j) => {
          const r = r0 + j, rowY = BY0 + (r + 0.5) * ROW, x = r % 2 === 0 ? innerX : outerX;
          if (r % 2 === 1) leadersS += `<path class="srow" d="M${innerX.toFixed(1)} ${rowY.toFixed(1)}H${(L ? outerX + 3 : outerX - 3).toFixed(1)}"/>`;
          const slot = slotOf(g, font), tx = L ? x - slot : x + slot;
          labelsS += `<text class="snm" x="${tx.toFixed(1)}" y="${(rowY + font * 0.34).toFixed(1)}" font-size="${font.toFixed(2)}"${L ? ' text-anchor="end"' : ''}>${esc(String(g.name))}</text>`;
          const ph = photoOf(g);
          if (ph) {
            const px = L ? x - PHOTO : x;
            labelsS += `<image href="${esc(ph)}" x="${px.toFixed(1)}" y="${(rowY - PHOTO / 2).toFixed(1)}" width="${PHOTO}" height="${PHOTO}" preserveAspectRatio="xMidYMid slice"/>`;
          }
          placed.push({ g, side: sd, r, photo: !!ph });
        });
      });
    }
    // MEASURED, not assumed: leader crossings (every segment pair of different leaders).
    const polys = [...leadersS.matchAll(/class="slead" d="M([^"]+)"/g)].map((m) => m[1].split('L').map((q) => q.trim().split(' ').map(Number)));
    const segsOf = polys.map((pl) => pl.slice(1).map((q, k) => [pl[k], q]));
    const sx = (p, q, r) => (r[1] - p[1]) * (q[0] - p[0]) - (q[1] - p[1]) * (r[0] - p[0]);
    const segX = (a, b) => (sx(a[0], a[1], b[0]) > 0) !== (sx(a[0], a[1], b[1]) > 0) && (sx(b[0], b[1], a[0]) > 0) !== (sx(b[0], b[1], a[1]) > 0);
    let crossingsS = 0;
    for (let i = 0; i < segsOf.length; i++) for (let j = i + 1; j < segsOf.length; j++) if (segsOf[i].some((a) => segsOf[j].some((b) => segX(a, b)))) crossingsS++;
    const stats = { names: placed.length, pins: pins.length, clusters: clusters.length, crossings: crossingsS, overflowRows: overflow,
      laneJumps, photos: placed.filter((p) => p.photo).length, namePt: +(font / PXI * 72).toFixed(1), photoMm: FMT.photos ? +(PHOTO / PXI * 25.4).toFixed(1) : 0 };
    return { leaders: leadersS, labels: labelsS, pinDots: dotsS, crossings: crossingsS, pins, stats };
  }

  const laid = FMT.sideLanes ? [] : layoutLabels(settled, proj);
  const sides = FMT.sideLanes ? sideLanesLayout(settled) : null;
  // What the city layer must keep clear of: the drawn pins (laid out, or true positions on a side-lane sheet).
  const avoidPins = sides ? sides.pins : laid;

  // ── CAPITALS + MAJOR CITIES ────────────────────────────────────────────────
  // Orientation marks, deliberately SUBORDINATE to the people-group pins. Imhof's
  // figure-ground again: this layer answers "where am I?" and must never compete
  // with the layer that answers "who do I pray for?".
  //
  // Three devices keep it quiet:
  //   1. A DENSITY BUDGET, not a fixed list. A sheet showing one small country and
  //      one showing half a continent need different numbers of dots; ranking by
  //      importance and capping the count keeps both legible.
  //   2. IMPORTANCE ORDER — national capitals first, then admin-1 capitals, then
  //      big cities by population, so what survives the cap is what orients best.
  //   3. COLLISION REJECTION in SHEET space, not lng/lat degrees. Degrees are not
  //      a constant distance on the page (and shrink with latitude), so a
  //      degree-based spacing test scatters at one zoom and overlaps at another.
  let cityDots = '';
  const cityPlaced = [];
  if (!CITIES) {                                   // city sheets have OSM streets already
    const inView = nePlaces.filter((p) =>
      p.x >= viewBbox[0] && p.x <= viewBbox[2] && p.y >= viewBbox[1] && p.y <= viewBbox[3]);
    // Budget scales with frame area so a dense sheet does not turn into a dot field.
    const budget = Math.max(6, Math.min(28, Math.round((FRAME_W * FRAME_H) / 42000)));
    // ★ RANK BY RELEVANCE TO THE SUBJECT, NOT BY GLOBAL IMPORTANCE.
    // Sorting purely by capital-rank then population looks reasonable and is wrong:
    // neighbours are often bigger than the subject. Measured on the Laos sheet, that
    // sort spent the budget on 12 Vietnamese and 8 Thai cities and printed exactly
    // ONE Laotian place (Vientiane) while 12 more sat available — a poster of Laos
    // labelled almost entirely with other countries' cities. The subject's places
    // orient a reader inside the zone; neighbours only fill what is left over.
    // ⚠ Derive the subject countries from THE PINS ON THIS SHEET, not from the zone
    // definition. `zone.adm0` exists only on generated city/country zones — the
    // hand-authored lists in clusters.json carry a `selector` in SEVEN different
    // shapes (pg_slugs, country_code, country_codes, wagf_block, wagf_region, union,
    // deaf_predicate), and the most common of them names no country at all. Reading
    // zone.adm0 therefore produced an EMPTY set for the Laos sheet and this whole
    // sort silently did nothing. The pins always know which country they are in.
    const memberIso = new Set(pins.map((p) => String(p.country_code || '').toUpperCase())
      .filter(Boolean));
    const ranked = inView.sort((a, b) =>
      (memberIso.has(b.c) - memberIso.has(a.c))   // subject countries first
      || (a.k - b.k)                               // then national > admin-1 > city
      || (b.p - a.p));                             // then by population
    for (const p of ranked) {
      if (cityPlaced.length >= budget) break;
      const [cx, cy] = proj(p.x, p.y);
      if (cx < FRAME_X + 6 || cx > FRAME_X + FRAME_W - 6) continue;
      if (cy < FRAME_Y + 6 || cy > FRAME_Y + FRAME_H - 6) continue;
      // Reject anything too close to an already-placed city, IN PAGE PIXELS.
      const MIN_PX = p.k === 0 ? 26 : 34;          // a capital may crowd a bit closer
      if (cityPlaced.some((q) => Math.hypot(q.cx - cx, q.cy - cy) < MIN_PX)) continue;
      // ★ THE PEOPLE-GROUP PINS WIN, ALWAYS. This layer orients; that layer IS the
      // poster. Measured before this guard: 7 of 25 city labels landed within 14px
      // of a numbered pin and Vientiane sat 6px away, so the orientation layer was
      // crowding the one thing a reader is meant to find. Choose the side of the
      // dot that is furthest from the nearest pin, and if even the better side is
      // cramped, drop the city entirely — a missing city costs nothing, an obscured
      // people group costs the poster its purpose.
      // ⚠ Test the BOX THE TEXT OCCUPIES, not its anchor point. Measuring distance
      // from the anchor is wrong for a right-aligned label: with text-anchor="end"
      // the glyphs run LEFTWARD from the anchor, so an anchor comfortably clear of a
      // pin can still have its text sitting on top of one. Measured with the naive
      // anchor test, Saravan landed 2px from a pin while the test reported it clear.
      const fs = p.k === 0 ? 10.5 : 9.5;
      const wPx = esc(p.n).length * fs * 0.55;        // ~0.55em average advance
      const boxClear = (x0) => {                      // x0 = left edge of the glyphs
        const x1 = x0 + wPx, yTop = cy - fs * 0.5, yBot = cy + fs * 0.5;
        let best = Infinity;
        // ⚠ Use the LAID-OUT positions (laid[].px/py), not proj(pin.lng,pin.lat).
        // The de-overlap relaxation MOVES badges apart after projection, so the raw
        // projected point is not where the badge is drawn. Measuring against the
        // source coordinate let Saravan's label land 1.4px from a badge while the
        // guard believed it was clear. This block therefore runs AFTER layoutLabels.
        for (const pin of avoidPins) {
          const px = pin.px, py = pin.py;
          const dx = px < x0 ? x0 - px : (px > x1 ? px - x1 : 0);
          const dy = py < yTop ? yTop - py : (py > yBot ? py - yBot : 0);
          best = Math.min(best, Math.hypot(dx, dy));
        }
        return best;
      };
      const RIGHT = { dx: 5.5, anchor: 'start', clear: boxClear(cx + 5.5) };
      const LEFT = { dx: -5.5, anchor: 'end', clear: boxClear(cx - 5.5 - wPx) };
      const side = RIGHT.clear >= LEFT.clear ? RIGHT : LEFT;
      if (side.clear < 7) continue;                   // cramped on both sides — drop it
      cityPlaced.push({ cx, cy, ...p, ...side });
    }
    for (const c of cityPlaced) {
      // A capital is a ringed dot (the cartographic convention); a city is a plain
      // small dot. Shape carries the rank so colour does not have to.
      cityDots += c.k === 0
        ? `<circle cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="3.6" class="cap-o"/>`
          + `<circle cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="1.5" class="cap-i"/>`
        : `<circle cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="${c.k === 1 ? 2.1 : 1.7}" class="cty-d"/>`;
      cityDots += `<text x="${(c.cx + c.dx).toFixed(1)}" y="${(c.cy + 3.4).toFixed(1)}" `
        + `text-anchor="${c.anchor}" class="${c.k === 0 ? 'cap-t' : 'cty-t'}">${esc(c.n)}</text>`;
    }
  }


  // LABEL_RES is the text column; LANE_* is the channel between text and map.
  // Widened the text column (names were clipping: "Jarkhandi Julaha" ran off the
  // sheet) AND tightened the lane band, so the names sit CLOSER to the map while
  // still leaving room to route a short leader per label.
  // LABEL_RES is the width available to the NAME. It must fit inside the gutter
  // minus the lane band minus the sheet margin, or names run off the paper —
  // "Jarkhandi Julaha" and "Khangar (Bundeli)" were both clipped at the edges.
  const SHEET_MARGIN = SHEET_EDGE + 8;
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
  // ONE TEMPLATE, ONE PATH. This was `laid.length >= 40`, so any zone with fewer
  // than 40 pins fell through to a legacy branch with NO numbered badges, NO
  // straight leaders and none of the current label treatment: Southern Africa
  // and the Scattered/Diaspora map drew without straight lines and broke the
  // template.
  // Exactly three zones were affected — uncovered-scatter (6), deaf (28),
  // southern-africa-islands (39) — and all three sat just under the threshold.
  // A sparse zone is not a different KIND of poster; it is the same poster with
  // fewer pins, so it takes the same path.
  const numbered = true;

  if (numbered) {
    // Number in READING ORDER down each gutter, so a reader scanning the list
    // moves top-to-bottom and the numbers on the map ascend with latitude.
    laid.forEach((it, i) => { it.num = i + 1; });
    // Every row reserves the same number-column width, sized to the largest index
    // on the sheet, so the name columns line up and no width is wasted.
    const MAXNUM = laid.length;
    laid.forEach((it) => { it.maxNum = MAXNUM; });
    laid.forEach((it) => {
      // THE BADGE MUST FIT ITS NUMBER. Radius and type were both fixed, so on a
      // zone with 100+ groups a three-digit index overflowed its circle — the
      // digits spilled out and read as stray marks on the map. Both now scale
      // with the digit count: the badge grows a little, the type shrinks a little.
      // BADGE SIZE IS A TEMPLATE PARAMETER, not a constant.
      // Large badges pushed pins far from their true location, outside the
      // province and apparently into the ocean; a smaller badge lets each pin sit
      // closer to its true position.
      //
      // Measured on Tamil Nadu: 64 mainland pins in a 219x312px area need 51%
      // occupancy at r=10.8 / MIN_SEP 25 — high enough that the de-collision pass,
      // not geography, sets the layout. At r=8 that falls to 29%, so each pin can
      // sit much nearer its true coordinate.
      //
      // The sheet is BOTH a 3ft print and a blog thumbnail, so this is the floor
      // of what stays legible rather than the smallest that would fit.
      // `zone.pinScale` tunes it per zone; default serves every map.
      // SIZE THE NUMERAL FROM WHAT MUST FIT, not from a flat multiple of the
      // radius. `rad * 1.2` produced ~9.6px digits inside a 16px disc — they
      // overflowed and read as smudges. The digits must fit INSIDE the circle:
      // the usable chord across a disc of radius r, allowing a little padding,
      // is about 1.5r, so solve for the size whose measured width fits that.
      const nd = String(it.num).length;
      const rad = PIN_R * (nd >= 3 ? 1.17 : 1);
      // SIZE THE NUMERAL FROM MEASURED DIGIT WIDTH, NOT THE ADVANCE TABLE.
      // CHADV gives digits 0.63em, but Lato BOLD tabular digits actually render
      // at ~0.98em — a 55% under-prediction, which is exactly why the numeral
      // overflowed its circle. Measured on the render: "118" at font 9.2 came out
      // 27.1px wide inside an 18.72px disc (8.4px of spill), and even a single
      // digit's line box (17px) exceeded a 16px diameter.
      //
      // A circle's usable width at the glyphs' own height is NOT the full
      // diameter — text is centred on its baseline, not the disc's centre line —
      // so reserve DIGIT_PAD and size from what genuinely fits.
      const DIGIT_EM = 0.98;                         // measured, bold tabular
      const DIGIT_PAD = 3.0;                         // keeps glyphs off the rim
      const dia = rad * 2;
      const nfs = Math.min(
        dia * 0.62,                                  // vertical ceiling: cap-height must fit
        (dia - DIGIT_PAD) / (String(it.num).length * DIGIT_EM)
      );
      // Stamped with the TRUE source coordinate for the same reason as the plain
      // pin below: the de-overlap relaxation moves marks apart, so drawn cx/cy
      // cannot distinguish "several places" from "one place drawn several times".
      // The NUMBERED badge is the path the city posters actually take.
      pinDots += `<circle cx="${it.px.toFixed(1)}" cy="${it.py.toFixed(1)}" r="${rad}" class="pin-num-bg"`
        + ` data-lng="${Number(it.lng).toFixed(4)}" data-lat="${Number(it.lat).toFixed(4)}"/>`
              +  `<text x="${it.px.toFixed(1)}" y="${(it.py + nfs * 0.355).toFixed(1)}" text-anchor="middle" font-size="${nfs}" class="pin-num">${it.num}</text>`;
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
      // THE UNDERLINE FOLLOWS THE WRAP: it goes under the wrapped name and never
      // cuts it in half. With a two-line name the rule has to
      // drop by one line height or it strikes through the second line.
      const nLines = (it.wrap || [it.name]).length;
      const ulY = it.labelY + it.font * 0.34 + it.font * 0.30 + (nLines - 1) * (it.font * 1.06);
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
      // Span the LAST rendered line — that is the one the rule sits beneath.
      // On a wrapped name the last line has NO "12. " prefix and is indented, so
      // measuring the whole label would draw a rule wider than the text above it.
      // The NAME now lives in its own element, inset by the number column, so the
      // rule spans just the last line of the name — the number is never underlined.
      const lastLine = (it.wrap || [it.name])[nLines - 1];
      const measured = [...lastLine].reduce((a, ch) => a + ADV(ch), 0) * it.font * 1.08 + 3;
      const nameW = Math.min(LABEL_RES - 18, measured);
      // A wrapped last line starts at the HANGING INDENT, not at the number
      // column, so the rule under it must start there too.
      // Everything is measured from the NAME COLUMN's edge (one number-column in
      // from the map-facing edge), not from tx, since the name starts there now.
      const ulNumColW = textW(`${it.maxNum}.`, it.font) * 1.06 + it.font * 0.42;
      const ulNameEdge = it.dirOut < 0 ? tx - ulNumColW : tx + ulNumColW;
      const ulTextStart = it.dirOut < 0 ? ulNameEdge - nameW : ulNameEdge + nameW;
      // RUN THE RULE OUT TO THE WHITE BORDER: each people-group rule spans
      // outward and connects to the white border.
      // It used to stop at the start of the name, so every rule ended at a
      // different x (names are ragged) and the outer edge of both columns looked
      // unresolved. Extending to SHEET_EDGE gives all 73 a shared outer terminus
      // against the border — the same trick that fixed the number column, applied
      // to the rules: one hard edge instead of a ragged one.
      const ulOuter = it.dirOut < 0 ? SHEET_EDGE : PW - SHEET_EDGE;
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
      // MEASURE WHAT IS ACTUALLY DRAWN. Two independent bugs lived here:
      //   1. the estimate used an uncalibrated 0.5em advance (real: ~0.498 for
      //      REGULAR Lato, and BOLD is wider again), so it under-reported; and
      //   2. it measured `it.name` while the element renders `"36. " + name`.
      //      A flat `- 26` reserve was standing in for that prefix, but the prefix
      //      scales with the type: at 16.8px bold it costs ~36px, not 26.
      // Both together let "36. Khangar (Bundeli)" render 209.5px into a 184px
      // column — off the sheet edge. Measure the WHOLE string, calibrated.
      const anchor = it.tanchor;
      // WRAP, DO NOT SHRINK. Long names used to be scaled down to fit the column,
      // which made every row a different size — measured 10.6px to 19.0px on this
      // sheet, a 79% spread, with "53. Vellaiyan Kuppam Padaiyaci" the smallest.
      // The goal: every people-group name and number at exactly the same font
      // size, with word wrapping supported.
      //
      // So the type size is now UNIFORM across the whole sheet and a name that
      // does not fit takes a second line instead. it.wrap carries the lines.
      // HANGING INDENT (it reads better): the number sits in its own column and
      // continuation lines align under the NAME, not under the number.
      const lines = it.wrap || [it.name];
      // ── THE NUMBER IS ITS OWN ELEMENT, PINNED TO THE MAP-FACING EDGE ────────
      // The numbers were not aligned. Putting the number on the map-facing side of
      // the name lines every number up.
      //
      // Why the numbers were ragged: the label is ONE text element anchored at the
      // column's outer edge ("end" on the left column). Its first line is
      // "12. Name", so the number's x depends on how wide THAT LINE happens to be
      // — every row a different width, so every number a different position. It
      // only looked aligned before wrapping because the outer edge was the edge.
      //
      // Splitting the number out fixes it by construction: it is anchored at the
      // column's MAP-FACING edge, which is the same x for every row, so the whole
      // index column reads as a straight rule. The name is then a separate element
      // that grows away from the map and wraps freely without ever moving a number.
      const numGap = it.font * 0.42;
      const numX = tx;                                   // map-facing edge, shared
      const nameX = tx - it.dirOut * 0 + (it.dirOut < 0 ? 0 : 0);
      // The name block starts one number-column in from the map-facing edge.
      // Reserve for the LARGEST index actually on this sheet, not a fixed three
      // digits. A 73-pin zone was giving up 40px to a hypothetical "000." when
      // "73." needs 29 — 11px of name width thrown away on every row.
      const numColW = textW(`${it.maxNum}.`, it.font) * 1.06 + numGap;
      const nameEdge = it.dirOut < 0 ? tx - numColW : tx + numColW;
      labels += `<text x="${numX.toFixed(1)}" y="${(it.labelY + it.font * 0.34).toFixed(1)}" `
             +  `text-anchor="${it.dirOut < 0 ? 'end' : 'start'}" font-size="${it.font.toFixed(1)}" class="lnum-col">${it.num}.</text>`;
      labels += `<text x="${nameEdge.toFixed(1)}" y="${(it.labelY + it.font * 0.34).toFixed(1)}" text-anchor="${anchor}" font-size="${it.font.toFixed(1)}" class="lbl">`
             +  lines.map((ln, k) => k === 0 ? esc(ln)
                  : `<tspan x="${nameEdge.toFixed(1)}" dy="${(it.font * 1.06).toFixed(1)}">${esc(ln)}</tspan>`).join('')
             +  `</text>`;
    });
    octiOK = true;
  } else laid.forEach((it, i) => {
    const pts = routes[i];
    if (!isOctilinear(pts)) octiOK = false;
    leaders += `<path d="M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')}" class="lead"/>`;
    // Stamp the TRUE source coordinate alongside the drawn position. The pin
    // de-overlap relaxation deliberately moves pins apart, so cx/cy cannot tell a
    // verifier whether two marks are two places or one place drawn twice. Several
    // city sheets pin multiple people groups at one gazetteer centroid; without
    // this, a coincident-pin sheet is indistinguishable from an over-zoomed one.
    pinDots += `<circle cx="${it.px.toFixed(1)}" cy="${it.py.toFixed(1)}" r="3.6" class="pin"`
      + ` data-lng="${Number(it.lng).toFixed(4)}" data-lat="${Number(it.lat).toFixed(4)}"/>`;
    dots += `<circle cx="${it.laneX.toFixed(1)}" cy="${it.labelY.toFixed(1)}" r="1.6" class="ldot"/>`;
    const tx = it.laneX + it.dirOut * 5;
    labels += `<text x="${tx.toFixed(1)}" y="${(it.labelY + it.font * 0.34).toFixed(1)}" text-anchor="${it.tanchor}" font-size="${it.font.toFixed(1)}" class="lbl">${esc(it.name)}</text>`;
  });
  if (sides) { leaders += sides.leaders; pinDots += sides.pinDots; labels += sides.labels; }
  if (!octiOK) console.warn(`  ⚠ non-octilinear segment in ${zone.zoneKey}`);
  const crossings = sides ? sides.crossings : countPolyCrossings(routes);
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
  // (The hand-coded CLUSTER_NAME map is gone. Region names now live in
  //  clusters.json `label`, where they belong as data — two zones had been
  //  special-cased in code while the other eight fell back to a generic
  //  "India · N Provinces". See provinceLabel for the enumeration they replaced.)
  const CLUSTER_NAME = {};
  // THE LABEL IS THE TITLE. Once `label` became an authored REGION NAME, the
  // "collapse a long list into 'India · N Provinces'" fallback became actively
  // wrong: "Southeast India + Andaman Islands" contains a "+", so it was treated
  // as an enumeration and collapsed back into the generic form the rename was
  // meant to remove. The collapse now only applies to a label that is STILL a raw
  // province enumeration — i.e. one with no provinceLabel recorded beside it.
  const labelIsRegionName = Boolean(zone.provinceLabel) || parts.length <= 2;
  const title = CLUSTER_NAME[zone.zoneKey || zone.id]
    || (labelIsRegionName || !isList ? fullLabel
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
  // COUNTRIES = the countries the sheet COVERS, which is not only the countries
  // its pins happen to sit in. A zone can declare a whole country as a member
  // (zone.adm0) whose land is drawn and highlighted even when it carries no
  // people groups of its own — Mongolia on the Mainland-China sheet. Deriving
  // this column from the pins alone silently dropped those, so the title said
  // "+ Mongolia" while the Countries column said only "China".
  const ctryNamesSet = [...new Set([
    ...pins.map((p) => ISO3_NAME[p.country_code] || p.country_code),
    ...(Array.isArray(zone.adm0) ? zone.adm0.map((c) => ISO3_NAME[c] || c) : []),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en-US'));   // pinned, as above
  // Provinces come from their OWN field. Deriving them by splitting `label` broke
  // the moment the label was renamed to a cluster name — the enumeration is data,
  // not a formatting artefact of the title, and needed somewhere to live.
  // The label is now a REGION NAME ("Southeast India + Andaman Islands"), so it no
  // longer enumerates provinces. clusters.json preserves the old enumeration in
  // `provinceLabel` — use it so the facts table keeps naming the actual provinces.
  const provinceList = provincesOf(zone);

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
  // The h1 baseline is y=104 at 56px, so its descenders reach ~118 — starting the
  // header flow at 118 printed the series line straight through the title. 136
  // clears it.
  let headY = SPARSE || HEAD_COLUMNS ? 136 : 150;
  let headBlock = '';

  // THE SERIES LINE, in the header FLOW so it can never collide with the rule
  // below it. The site reference was wrapped into the scripture header, where it
  // does not belong.
  if (SPARSE) {
    // ONE LINE, not two, to save the space under the title, which was too
    // generous. The site reference folds in after a separator rather
    // than taking a line of its own.
    headBlock += `<text x="${CX}" y="${headY}" text-anchor="middle" class="hseries">`
               + `Series <tspan class="hseries-em">\u201c${esc(SERIES_NAME)}\u201d</tspan>`
               // ★ SMALL-TOTAL GUARD. The total is rounded to ~tens because a series of 28 or 173 is
               // read as a size, not counted. Below ten that rounding breaks: a one-member tier --
               // China, the only 3x4 country sheet -- rounds 1 to ~0 and would print "1 of ~0 maps".
               // So under ten the line states the exact count, "map 1 of 1", the same text the
               // dense layout already prints. Every real series is unaffected: 28 -> ~30, 173 -> ~170.
               + (SERIES.totalLists < 10
                   ? ` \u2014 map ${SERIES.index} of ${SERIES.totalLists}`
                   : ` \u2014 ${SERIES.index} of ~${Math.round(SERIES.totalLists / 10) * 10} maps covering unengaged people groups in prayer`)
               + ` \u00b7 <tspan class="hseries-em">https://Doxa.Life</tspan>`
               + `</text>`;
    headY += 12;
  }

  // In SPARSE the facts move BELOW the scripture as a real 4-column table —
  // see THE FACTS TABLE further down. Nothing is emitted here. With HEAD_COLUMNS they are the first column of
  // the band under the scripture (headColumnsBand).
  if (!SPARSE && !HEAD_COLUMNS) {
  // ── THE FACTS TABLE (full version) ───────────────────────────────────────
  // A centred table needs fixed internal geometry or the rows wander: keys are
  // RIGHT-aligned to a seam and values LEFT-aligned to it, so the colon gutter
  // forms one clean vertical seam. That seam — not a box or heavy borders — is
  // what makes it read as a table while staying quiet enough to be beautiful.
  const SEAM = CX - 30;
  const KEY_X = SEAM - 14;
  const VAL_X = SEAM + 14;
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
  headRow('Administrative Areas', provLines);
  headRow('People groups', [`${pins.length} UPG`]);
  headRow('Series', [`${SERIES_NAME} · map ${SERIES.index} of ${SERIES.totalLists}`]);
  // Hairline rules top and bottom close the table without boxing it in.
  const TABLE_BOT = headY - 12;
  const TABLE_HALF = 320;
  headBlock += `<line x1="${SEAM - TABLE_HALF}" y1="${TABLE_TOP}" x2="${SEAM + TABLE_HALF}" y2="${TABLE_TOP}" class="hrule"/>`;
  headBlock += `<line x1="${SEAM - TABLE_HALF}" y1="${TABLE_BOT}" x2="${SEAM + TABLE_HALF}" y2="${TABLE_BOT}" class="hrule"/>`;
  headY = TABLE_BOT;
  }
  // THE COMPASSION VERSE — given the SAME treatment as the goal question below
  // the map: one full-map-width line, ruled above and below, so the scripture up
  // top spans the full width of the map too. The two rules-and-a-line blocks now
  // bracket the sheet symmetrically — scripture at the top, the question at the
  // bottom, the map between them.
  // THE SCRIPTURE + FACTS BAND SPANS THE FULL SHEET, not the map's width.
  // The table spans the full width of the poster.
  // It was pinned to GUTTER (the MAP's edge), so as the gutters widened to give
  // the names room, this band narrowed with them — it is header information about
  // the whole sheet, not a caption belonging to the map, so it should use the
  // sheet's own margin instead.
  const VRULE_L = BAND_MARGIN_G, VRULE_R = PW - BAND_MARGIN_G;
  headY += 16;
  headBlock += `<line x1="${VRULE_L}" y1="${headY}" x2="${VRULE_R}" y2="${headY}" class="hrule"/>`;
  headY += 25;
  const VERSE = `\u201cBut when he saw the multitudes, he was moved with compassion for them because they were harassed and scattered, like sheep without a shepherd.\u201d`;
  if (HEAD_COLUMNS) {
    // At the full sheet's print size the verse is set on TWO balanced lines (one line at a readable size would
    // run past the band); the reference ends the second line.
    const [l1, l2] = VERSE_LINES(VERSE);
    headBlock += `<text x="${CX}" y="${headY}" text-anchor="middle" class="hverse">${esc(l1)}</text>`;
    headY += HC_VERSE_LH;
    headBlock += `<text x="${CX}" y="${headY}" text-anchor="middle" class="hverse">${esc(l2)} <tspan class="hvref">MATTHEW 9:36</tspan></text>`;
  } else {
    headBlock += `<text x="${CX}" y="${headY}" text-anchor="middle" class="hverse">`
               + VERSE
               + ` <tspan class="hvref">MATTHEW 9:36</tspan>`
               + `</text>`;
  }
  headY += 12;
  headBlock += `<line x1="${VRULE_L}" y1="${headY}" x2="${VRULE_R}" y2="${headY}" class="hrule"/>`;

  // ── THE FACTS TABLE (SPARSE) — four columns, under the scripture ─────────
  // People Groups, Countries, Provinces and Population sit under the scripture,
  // above the map, as a table: four columns, each with a header and its value.
  //
  // A four-column table beats the single run-on line it replaces because each
  // fact gets a HEADER naming what the number is. "92" on its own means nothing;
  // "People Groups / 92" is self-describing — which is what a stranger reading a
  // blog thumbnail needs. Columns are evenly pitched across the map width so the
  // block reads as one band rather than four stranded items.
  if (SPARSE) {
    const totalPop = pins.reduce((a, p) => a + (Number(p.population) || 0), 0);
    // Populations are estimates that move; print them ROUNDED and prefixed so the
    // sheet never claims a precision the data does not have.
    const popText = totalPop >= 1e6 ? `~${(totalPop / 1e6).toFixed(1)}M`
                  : totalPop >= 1e3 ? `~${Math.round(totalPop / 1e3)}K`
                  : String(totalPop || '—');
    // THE TWO NUMERIC COLUMNS ARE THE HEADLINE STATS. The count is much larger
    // than the people-group text, and it reads {n} UPG's CALCULATED FROM THE
    // NUMBER, because this is the template every sheet follows.
    // So the count is DERIVED from pins.length on every sheet, never written down;
    // the apostrophe form matches the series name the operator is using.
    // `big: true` marks the columns that get display type; the two list columns
    // stay at reading size because a list cannot be set at display size and fit.
    const FACTS = [
      ['People Groups', `${pins.length} UPG's`, true],
      ['Countries', ctryNamesSet.join(' · ') || '—', false],
      // "PROVINCES" WAS INACCURATE: not every country uses the term, and some of
      // these areas are not provinces at all. Andaman and Nicobar,
      // Puducherry, Lakshadweep and Chandīgarh are UNION TERRITORIES, and one zone
      // carries a sovereign country (Nepal). Across the 28 sheets this column
      // holds states, union territories, provinces, prefectures and countries.
      // "Administrative Areas" is the widest term that is true of all of them.
      ['Administrative Areas', provinceList.join(' · ') || '—', false],
      ['Population', popText, true],
    ];
    // COLUMN WIDTHS FOLLOW CONTENT: a zone with many countries or provinces needs
    // wider columns for them in the four-column table.
    // Four equal columns forced west-bengal's nine administrative areas onto five
    // lines while POPULATION sat beside it holding "~5.6M". Weight each column by
    // the length of what it must hold, then clamp so no column starves.
    // PAD THE OUTER COLUMNS: the first and fourth columns' content keeps clear of
    // the white border and aligns with the people-group columns under them.
    // The RULES still run to the border (that is deliberate), but the table's
    // CONTENT is inset to SHEET_MARGIN_L — the same x the label columns beneath
    // start at — so the first value sits directly above the first name and the
    // last above the last, instead of crowding the white edge.
    const FT_INSET = SHEET_MARGIN_L - VRULE_L;
    const FT_BAND = (VRULE_R - VRULE_L) - FT_INSET * 2;
    // sqrt-damped weights: a 90-char list should get MORE room than a 5-char one,
    // but not 18x more — raw length starved the short columns so badly that
    // "Bangladesh · Bhutan · India" broke across two lines with "· India" orphaned.
    const ftWeights = FACTS.map(([, val]) => Math.sqrt(Math.max(10, String(val).length)));
    const ftTotal = ftWeights.reduce((a, b) => a + b, 0);
    const FT_MIN = FT_BAND * 0.17;            // no column below 17% of the band
    let ftW = ftWeights.map((w) => Math.max(FT_MIN, (w / ftTotal) * FT_BAND));
    const ftSum = ftW.reduce((a, b) => a + b, 0);
    ftW = ftW.map((w) => (w / ftSum) * FT_BAND);   // renormalise after clamping
    const ftX = [];
    ftW.reduce((acc, w) => { ftX.push(acc); return acc + w; }, VRULE_L + FT_INSET);
    const FT_W = FT_BAND / 4;                 // kept for the header-height model
    headY += 22;
    let fbot = headY;
    FACTS.forEach(([head, val, big], i) => {
      const cx = ftX[i] + ftW[i] / 2;
      headBlock += `<text x="${cx}" y="${headY}" text-anchor="middle" class="hfhead">${esc(head)}</text>`;
      // Values wrap inside their own column so a long province list cannot run
      // into its neighbour.
      // Wrap at the size the value is ACTUALLY set at — wrapping at one size and
      // rendering at another overruns the column by exactly the ratio between them.
      const vfs = big ? 34 : 17;
      const lines = wrapPx(val, vfs, ftW[i] - 24 - BAND_TEXT_PAD / 2);
      lines.forEach((ln, k) => {
        headBlock += `<text x="${cx}" y="${headY + (big ? 34 : 24) + k * (big ? 36 : 20)}" text-anchor="middle" class="${big ? 'hfbig' : 'hfval'}">${esc(ln)}</text>`;
      });
      const bot = headY + (big ? 34 : 24) + (lines.length - 1) * (big ? 36 : 20);
      if (bot > fbot) fbot = bot;
    });
    // Thin dividers between the four columns.
    for (let i = 1; i < 4; i++) {
      const rx = ftX[i];
      headBlock += `<line x1="${rx}" y1="${headY - 16}" x2="${rx}" y2="${fbot + 6}" class="hcolrule"/>`;
    }
    // CLOSE THE TABLE. The band was ruled above (under the scripture) but open at
    // the bottom, so it bled into the map. A rule here closes it as a block.
    headBlock += `<line x1="${VRULE_L}" y1="${fbot + 14}" x2="${VRULE_R}" y2="${fbot + 14}" class="hrule"/>`;
    headY = fbot + 14;
  }
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
  // The data at the top looked busy and unorganised; a table uses the space and
  // distributes it evenly.
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
  // FULL-SHEET WIDTH, like the scripture/facts band above the map: the footer
  // section goes full width too.
  // These blocks are about the whole sheet (the goal question, the three
  // networks), not captions on the map, so they use the sheet margin — not the
  // map's gutter, which moves whenever the label columns are re-tuned.
  const GRID_L = BAND_MARGIN_G;
  const GRID_W = PW - 2 * BAND_MARGIN_G;
  // The type is slightly larger now that there is more room to work with.
  // 12.5 -> 13.5 with leading kept proportional (~1.30).
  const FS = HEAD_COLUMNS ? 22 : 13.5, LH = HEAD_COLUMNS ? 28 : 17.5;
  // The two vision columns sit BELOW the ruled scripture, so they read as its
  // supporting detail, not as headline copy. Slimmer type + tighter leading than
  // the sheet's body size: less height for the same words, and the contrast in
  // scale is what tells the eye the scripture outranks them.
  const B1_FS = 12, B1_LH = 15;
  const push = (frag) => { headBlock += frag; };
  const colRule = (x, y0, y1) =>
    `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" class="hcolrule"/>`;

  let py = headY + 34;

  // ── BAND 1: the two vision columns — FULL VERSION ONLY ───────────────────
  // In SPARSE mode these are dropped entirely (the Jesus Strategy for 5000 and
  // the What is a Prayer List of 100 explainers), and the
  // height they occupied goes to the map, which is what makes the people-group
  // names bigger. The scripture above and the question below both stay.
  if (HEAD_COLUMNS) {
    const band = headColumnsBand(py, headFacts(zone, pins), approxLists);
    headBlock += band.frags;
    py = band.bottom + 4;
  } else if (!SPARSE) {
    const B1_GUT = 54;
    // TEXT_W is narrower than the column pitch so prose never touches the rule.
    const B1_CW = (GRID_W - B1_GUT) / 2;
    const B1_TW = B1_CW - 10;
    const b1x = [GRID_L, GRID_L + B1_CW + B1_GUT];
    const b1Top = py;
    headBlock += `<text x="${b1x[0]}" y="${py}" class="hvh">Jesus’ Strategy to Feed the 5000</text>`;
    headBlock += `<text x="${b1x[1]}" y="${py}" class="hvh">${esc(POSTER_TEXT.sideBoxHeading || 'What is a UPG100 List?')}</text>`;
    const bodyTop = py + 20;

    // The text is STRATEGY_DEFAULT unless the series sets its own (see strategyParas).
    let cy0 = bodyTop;
    strategyParas().forEach((text, k) => {
      if (k) cy0 += 5;
      cy0 = paraInto(push, text, { x: b1x[0], y: cy0, w: B1_TW, fs: B1_FS, lh: B1_LH, cls: 'hsrc2' });
    });

    let cy1 = bodyTop;
    // {approxLists} and {seriesName} are filled here rather than in series.json, so the sentence
    // still states the MEASURED list count (approxLists is derived from the zones actually built)
    // and can never carry a typed number that drifts from the sheet it is printed on.
    const whatIs = (POSTER_TEXT.sideBoxBody
      || 'This map is one of a {approxLists}-map set called the {seriesName} — a large, overwhelming target in the thousands, organised into clear groupings and displayed on maps and prayer lists.')
      .replace('{approxLists}', String(approxLists))
      .replace('{seriesName}', SERIES_NAME);
    [whatIs, ...whatIsMore()].forEach((text, k) => {
      if (k) cy1 += 5;
      cy1 = paraInto(push, text, { x: b1x[1], y: cy1, w: B1_TW, fs: B1_FS, lh: B1_LH, cls: 'hsrc2' });
    });

    const b1Bot = Math.max(cy0, cy1);
    headBlock += colRule(GRID_L + B1_CW + B1_GUT / 2, b1Top - 12, b1Bot - 12);
    py = b1Bot + 4;

  }

  const HEAD_BOTTOM = py + 14;
  // FAIL LOUDLY, don't ship a silent overlap. HEADER is a module constant (MAP_Y
  // and MAP_H are derived from it before the header is laid out), so it cannot be
  // computed from the content — which means the content CAN outgrow it. It already
  // did once: the last "Ways to use this map" line landed on the map frame and the
  // markup checks all passed, because an overlap is valid SVG. Only the render
  // showed it. This turns that class of regression into a build error.
  // A map-only sheet computes the header content but never EMITS it (see the assembly below), so
  // there is nothing to overflow — the guard would only be measuring a block that is thrown away.
  if (!MAP_ONLY && HEAD_BOTTOM > HEADER) {
    throw new Error(
      `[generate] header overflows the map frame: content ends at y=${HEAD_BOTTOM} `
      + `but HEADER=${HEADER} (zone ${zone.zoneKey}). Raise HEADER or tighten the header copy.`
    );
  }

  // ── BELOW THE MAP: THE GOAL + THE THREE NETWORKS ─────────────────────────
  // This section sits under the map: the question and its three answers below,
  // the facts above, with the map sandwiched between them.
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
  let fy = MAP_Y + MAP_H + (SPARSE ? MAP_BREATH : 30);

  // THE GOAL — the question the three networks answer, kept in view on every
  // sheet. INDIGENOUS is load-bearing: the aim is not
  // merely disciples among these peoples, but disciples, churches and leaders
  // FROM them, in their own language.
  // RULE ABOVE THE GOAL. Restored now that the band runs the FULL SHEET width —
  // at the map's width it lined up with the map edge and read as a stray second
  // border; spanning the sheet it clearly belongs to this block instead.
  fy += 16;
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
  fy += SPARSE ? 22 : 28;
  // Its OWN class, not the shared .hvh — this is the call to action the three
  // networks answer, so it carries more weight than an ordinary column heading,
  // and sizing it here does not move every other heading on the sheet.
  footBlock += `<text x="${CX}" y="${fy}" text-anchor="middle" class="hcta">Start with Prayer!</text>`;
  fy += SPARSE ? 25 : HEAD_COLUMNS ? 38 : 22;   // clears the larger .hcta line (and, full, the larger blocks below)

  const B2_GUT = 40;
  const B2_CW = (GRID_W - 2 * B2_GUT) / 3;
  // The text measure is deliberately NARROWER than the column. At full width each
  // block filled ~90% of its column, so there was no slack to centre INTO — what
  // read as "not centred" was the ragged right edge of a block already spanning
  // the column. Wrapping to 82% leaves real margin on both sides, which is what
  // makes the block read as set INSIDE its column.
  const B2_TW = (B2_CW - 10 - BAND_TEXT_PAD / 2) * 0.82;
  // The three columns under the map need to align.
  // They ran 4 / 3 / 4 lines, so their bottoms were ragged. The copy is trimmed
  // to run the SAME number of lines in each column — that is what makes three
  // columns read as one band instead of three unequal blocks, and it costs a line
  // of height, which goes back to the map.
  // ★ FROM series.json, NOT FROM HERE. These three blocks were the second reported problem: they
  // tell the reader to divide the set among THIRTY disciples, which is coherent for ~30 UPG-100
  // zones and incoherent for ~170 country posters. The country wording is not a find-and-replace of
  // "thirty" with "a hundred and seventy" — the SHAPE changed, from "split the set" to "ask
  // which one, then give them that poster". Both sets live in series.json.
  // ENGLISH ONLY, on purpose: this file does no localization at all (no PACKET_LANG, no
  // packet-strings, and its non-ASCII characters are entirely typographic — no translated string
  // has ever been in it). The packet's 11 locales live in packet-strings.json.
  const NETWORKS = SERIES_DEF.networks;
  const fpush = (frag) => { footBlock += frag; };
  let fBot = fy;
  NETWORKS.forEach(([lead, body], i) => {
    // CENTRE THE BLOCK, LEFT-ALIGN THE LINES: the text stays left-aligned within
    // its block, and the block is centred in the column.
    // Ragged-right text that starts at the column's left edge leaves all its
    // slack on the right, so the block reads as shoved left inside its column.
    // Measuring the widest wrapped line and offsetting by half the leftover
    // centres the BLOCK while every line keeps a shared left edge to read down.
    // CENTRE EACH BLOCK ON ITS COLUMN.
    // The block's width is its widest wrapped line. Line 0 carries the BOLD
    // run-in ("3 \u00b7 Thirty indigenous leaders.") and the rest is regular, so a
    // flat correction mis-measures whichever block happens to be widest on its
    // first line — that is why col3 drifted 50px while col1 sat at 3px.
    // Measure line 0 with the bold weight and the others without.
    const BOLD_RUN = 1.06;   // bold costs ~6% width at this size
    // textW carries WFUDGE; regular runs ~10% narrower. That 0.90 is also 12/13.5: the prose is wrapped at FS
    // but .hsrc drew it at 12px. Where the series draws it at FS (HEAD_COLUMNS_CSS), its width IS the estimate,
    // and centring on 0.90 of it pushed every block right.
    const REG_FILL = HEAD_COLUMNS_ON_SERIES ? 1 : 0.90;
    const colCentre = GRID_L + i * (B2_CW + B2_GUT) + B2_CW / 2;
    const lines = wrapPx(`${lead} ${body}`, FS, B2_TW);
    const lineW = (ln, k) => {
      if (k > 0) return textW(ln, FS) * REG_FILL;
      // Line 0 = bold lead + regular remainder.
      const rest = ln.startsWith(lead) ? ln.slice(lead.length) : ln;
      const leadPart = ln.length - rest.length > 0 ? lead : '';
      return (textW(leadPart, FS) * BOLD_RUN + textW(rest, FS)) * REG_FILL;
    };
    const blockW = Math.min(B2_TW, lines.reduce((m, ln, k) => Math.max(m, lineW(ln, k)), 0));
    const x = colCentre - blockW / 2;
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
  // The reference baseline sits at VERSE_RULE_Y + 44; the attribution line is at
  // PH - 4. Keeping the ref's descender clear of it needs +44 <= PH - 12, so the
  // real limit is +56, not the +46/PH-8 pair that was guarding an imagined 8px.
  // Same reasoning as the header guard: map-only sheets never emit the below-map block.
  if (!MAP_ONLY && VERSE_RULE_Y + 56 > PH) {
    throw new Error(
      `[generate] below-map block runs off the sheet: verse rule would sit at `
      + `y=${VERSE_RULE_Y.toFixed(0)} on a ${PH}px sheet (zone ${zone.zoneKey}). `
      + `Raise FOOTER (which shrinks the map) or tighten this copy.`
    );
  }

  // ── MAP CREDITS (inside the map, UNDER the leader lines) ─────────────────
  // The Mapbox copyright painted above the leader lines, which is wrong, and the
  // data tag moves to the BOTTOM LEFT. Emitted inside the clipped map
  // group so every leader and label paints over them — they are basemap
  // furniture, not content, and must never occlude the sheet's own data.
  const credit = (x, y, anchor, txt) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" class="attrib-halo">${txt}</text>`
    + `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" class="attrib">${txt}</text>`;
  // ATTRIBUTION CORRECTED 2026-09-23. This said "(c) Mapbox (c) OpenStreetMap",
  // which was inherited boilerplate and simply not true of this sheet: the header
  // of this file states NO Mapbox, NO token, NO external fetch at render time, and
  // the basemap is drawn from GeoJSON bundled in the repo. Crediting a vendor that
  // contributes nothing implies a dependency that does not exist \u2014 the kind of line
  // that makes a later reader add a token "to comply".
  // The real source is geoBoundaries (the adm0/adm1 files carry its shapeGroup /
  // shapeName fields), CC BY 4.0, which REQUIRES attribution \u2014 so the credit stays,
  // it just names who actually earned it. OpenStreetMap is named only when OSM
  // street tiles are actually fetched (BASEMAP=1, city sheets).
  const basemapCredit = BASEMAP
    ? '\u00a9 geoBoundaries \u00b7 \u00a9 OpenStreetMap'
    : '\u00a9 geoBoundaries (CC BY 4.0)';
  // \u2605 PRIVACY LINE. The people-group coordinates arrive already generalised from
  // the data publisher \u2014 they are deliberately NOT precise locations. A printed
  // sheet travels far beyond the person who generated it, so it has to carry that
  // fact itself rather than rely on the reader knowing it.
  // Worded as provenance ("generalised at the source"), not as a claim about
  // processing we perform here, because we do no rounding of our own.
  const privacyNote = 'Marker positions are approximate \u00b7 people-group locations are generalised at the source for privacy';
  // The privacy line gets its OWN row, 13px above the credits. Sharing the credit
  // row put it at 516-984px against a stamp ending at 543 \u2014 a measured collision.
  // It is also a different KIND of text: the other two are ~200px provenance
  // stamps, this is a sentence a reader must actually READ, so it needs the room.
  const mapCredits =
      credit(FRAME_X + FRAME_W / 2, FRAME_Y + FRAME_H - 20, 'middle', privacyNote)
    + credit(FRAME_X + 8, FRAME_Y + FRAME_H - 7, 'start', `Generated ${POSTER_DATE} \u00b7 data from doxa.life`)
    + credit(FRAME_X + FRAME_W - 8, FRAME_Y + FRAME_H - 7, 'end', basemapCredit);

  // FIT THE TITLE TO THE SHEET. Region names vary a lot in length ("West India"
  // vs "Northeast India + Bangladesh + Bhutan"), and the qualifier adds a fixed
  // ~13 characters on top, so a single hardcoded size cannot serve all 28 sheets —
  // at 56px this one ran off BOTH edges. Solve for the largest size that fits
  // between the sheet margins.
  const H1_MAX = 56, H1_MIN = 26;
  const h1Text = `${POSTER_TEXT.titleQualifier || 'Unengaged of'} ${title}`;
  const h1Room = PW - 2 * (SHEET_EDGE + 24);
  let H1_SIZE = H1_MAX;
  // GEORGIA BOLD MEASURES ~1.35x THE LATO-TUNED ESTIMATE. textW's advance table
  // is calibrated for Lato at body sizes; at display size in a serif bold it
  // under-predicts badly. Measured on the render: 54px produced 1474px of text
  // where the estimate said ~1090 — the title ran off BOTH sheet edges twice
  // before this factor was taken from the actual getBBox width.
  const H1_SERIF_BOLD = 1.35;
  while (H1_SIZE > H1_MIN && textW(h1Text, H1_SIZE) * H1_SERIF_BOLD > h1Room) H1_SIZE -= 0.5;

  const verse = verseFor(zone);
  // ── OSM STREET BASEMAP (city sheets only) ────────────────────────────────
  // A city sheet at ~9km needs STREETS; the ADM0/ADM1 polygon fill this template
  // draws has none, which is why the first 176 city posters shipped as blank
  // shapes. Tiles are stitched UNDER everything else inside #mapclip, so pins,
  // leaders and labels all still draw on top unchanged.
  //
  // NO TOKEN, NO ACCOUNT — see osm-basemap.mjs for why that matters here rather
  // than being a convenience. Country/100-list sheets are untouched: at that scale
  // street tiles are noise, and the polygon fill is the right artefact.
  let baseLayer = '';
  if (CITIES && BASEMAP) {
    try {
      const z = bestZoom(viewBbox);
      const grid = await fetchGrid(viewBbox, z);
      // Place each tile by projecting its own top-left corner through the SHEET's
      // projection, so the basemap lands in the same geo-space as the pins rather
      // than merely near them.
      const parts = [];
      for (const t of grid.tiles) {
        const lng = (t.x / Math.pow(2, z)) * 360 - 180;
        const nAt = Math.PI - (2 * Math.PI * t.y) / Math.pow(2, z);
        const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(nAt) - Math.exp(-nAt)));
        const lng2 = ((t.x + 1) / Math.pow(2, z)) * 360 - 180;
        const nAt2 = Math.PI - (2 * Math.PI * (t.y + 1)) / Math.pow(2, z);
        const lat2 = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(nAt2) - Math.exp(-nAt2)));
        const [x0p, y0p] = proj(lng, lat);
        const [x1p, y1p] = proj(lng2, lat2);
        parts.push(`<image x="${x0p.toFixed(1)}" y="${y0p.toFixed(1)}" `
          + `width="${(x1p - x0p).toFixed(1)}" height="${(y1p - y0p).toFixed(1)}" `
          + `href="data:image/png;base64,${t.buf.toString('base64')}" `
          + `preserveAspectRatio="none"/>`);
      }
      // FULL OPACITY. The first attempt used opacity:0.72 + saturate(0.55), which
      // on OSM's already-pale palette made the streets effectively invisible —
      // measured: 36 tiles correctly placed across the clip, and the sheet still
      // read as blank. Figure-ground here is achieved by the PINS being saturated
      // cyan on a muted map, not by fading the map until it disappears.
      baseLayer = `<g style="filter:saturate(0.72) contrast(1.04)">${parts.join('')}</g>`;
      console.log(`   basemap: ${grid.cols}x${grid.rows} OSM tiles @ z${z}`);
    } catch (e) {
      // A basemap failure must NOT lose the poster — the sheet still carries the
      // names, pins and scripture, which is the artefact that matters.
      console.warn(`   basemap skipped: ${e.message}`);
    }
  }

  // data-sheet="map-only" tells the packet this sheet reserves the top band for the packet's own
  // title (packet-render.js liftMap), as opposed to a poster that carries its own.
  // ★ EVERYTHING FROM THE TITLE TO THE CLOSING VERSE, AND THE WHITE EDGE, IS POSTER FURNITURE, and a
  // map-only sheet (packet page 1) omits all of it: the title, the facts table and vision columns
  // (headBlock), the goal question and three networks (footBlock), and the verse. The packet supplies
  // its own title in the reserved band, in the reader's language.
  // ⚠ These notes are JS comments, NOT <!-- --> inside the literal: an HTML comment there is EMITTED
  // into every poster, which made the default 3x4 output differ from before this mode existed.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}"${MAP_ONLY ? ' data-sheet="map-only"' : ''}>
  <rect width="${PW}" height="${PH}" fill="var(--paper)"/>
  <defs>
    <!-- Two-part shadow: a tight dark edge for definition, plus a wide soft one
         for lift. One blur alone reads either muddy or hard. -->
    <!-- THE FILTER REGION MUST CONTAIN THE WHOLE BLUR, or the blur is clipped and
         its bounding box shows in the paper as a faint rectangle offset from the
         map — visible above and left of the top-left corner. A Gaussian needs
         ~3x stdDeviation to fade to nothing: the widest shadow here is
         stdDeviation 18 with a 10px y-offset, so it needs ~64px of margin. The
         region is set in objectBoundingBox units, so the percentage has to cover
         that on the SHORTEST side. userSpaceOnUse with explicit padding is exact
         and cannot drift when the frame's aspect changes between zones. -->
    <filter id="mapfloat" filterUnits="userSpaceOnUse"
            x="${FRAME_X - 60}" y="${FRAME_Y - 60}"
            width="${FRAME_W + 120}" height="${FRAME_H + 120}">
      <!-- ONE tight shadow, not a wide second pass. The wide pass (stdDeviation 18,
           dy 10) needed ~64px+ of filter margin to fade out; anything less clipped
           it and the clip edge showed in the paper as a faint rectangle offset up
           and left of the map. A single tighter shadow gives the same "floating"
           read, fades out inside 30px, and cannot produce a visible box. -->
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#2A2721" flood-opacity="0.34"/>
    </filter>
  </defs>
  <!-- THE MAP FLOATS: a border line around the map itself, with a shadow outside
       that line, makes the map look like it is floating.
       A soft drop shadow under a crisp 1.5px border lifts the map off the paper,
       so it reads as an object ON the sheet rather than a window cut INTO it —
       which is also what makes the surrounding text feel like a mount around it. -->
  <!-- THE MAP FLOATS: a border line around the map, with a shadow outside it.
       The white mat was tried and rejected — the shadow-only
       border reads better, and the mat also cut every leader line with a band of
       white where the lines crossed it. -->
  <rect x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_W}" height="${FRAME_H}" fill="var(--sea)"
        stroke="var(--frameline)" stroke-width="1.5" filter="url(#mapfloat)"/>
  <!-- LAND UNDERLAY. The frame is filled with SEA, so any land not covered by a
       polygon shows as water — and India was absent from world-adm0 entirely
       (161 countries, no IND), so Indian territory outside the drawn ADM1 features
       fell through to sea. That is the "white space" gap. Painting every ADM1
       feature in view as a land underlay closes it: the sea then shows only where
       there genuinely is sea. India is now in world-adm0 too (2026-08-02), but the
       ADM1 underlay stays — it is what makes the gap impossible rather than merely
       filled for one country. -->
  <!-- On a CITY sheet the zone fill is the whole COUNTRY (its geometry selector),
       so painting it over the tiles would hide every street the basemap exists to
       show. City sheets therefore drop ctx/zone fills and let OSM be the map. -->
  <g clip-path="url(#mapclip)">${baseLayer}${(CITIES && BASEMAP) ? '' : ctx}${(CITIES && BASEMAP) ? '' : ctxAdm1}${(CITIES && BASEMAP) ? '' : zoneP}${seaNames}${provNames}${ctryNames}${cityDots}${mapCredits}</g>
  <clipPath id="mapclip"><rect x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_W}" height="${FRAME_H}"/></clipPath>
  <g style="--zc:${color}">${leaders}${dots}${pinDots}${labels}</g>
  <!-- TITLE, in two parts. "Unengaged People Groups of North India + Nepal" set
       on one line at h1 size would either overflow the sheet or force the type
       down to where the region name stops being the loudest thing on the poster.
       Splitting it lets the CATEGORY sit quietly above and the REGION stay big:
       the region is what a passer-by uses to find their sheet on a wall of 30. -->
  <!-- TITLE, two-tone. The title reads "Unengaged of <Region>", with
       "Unengaged of" in a DIFFERENT COLOUR from the region name — so a passer-by
       reads at a glance that it is these PEOPLE who are unengaged, while the
       region stays the loudest thing on the sheet. The overline above it is now
       the plain category, "Unengaged People Groups". -->
  <!-- CENTRED between the white edge and the title, not flush against the edge.
       At y=46 its cap-height started ~32 — only 6px clear of the 26px border, so
       it read as pinned to the edge. The band runs 26..(title cap-top ~78), so
       its optical middle is ~57. -->
  ${MAP_ONLY ? '' : `<text x="${PW / 2}" y="57" text-anchor="middle" class="h1over">${esc(POSTER_TEXT.kicker || 'Unengaged People Groups')}</text>
  <text x="${PW / 2}" y="104" text-anchor="middle" class="h1" font-size="${H1_SIZE}"><tspan class="h1qual">${esc(POSTER_TEXT.titleQualifier || 'Unengaged of')}</tspan> ${esc(title)}</text>
  <!-- (The series line is emitted INSIDE headBlock, not here. Absolutely placing
       it at a fixed y while the scripture flowed from headY is what made the
       "(see Doxa.Life…)" line collide with the scripture rule.) -->
  <!-- (The top-left Doxa.Life lockup was removed 2026-07-31 at the the brief's
       request: the series line under the title already carries the site
       reference, so the lockup was saying it twice.) -->
  ${headBlock}
  ${footBlock}
  <!-- (The HEAD_BOTTOM rule is gone. It marked the boundary between the header and
       the map back when the map was a plain rect. The white mat and its drop
       shadow now define that edge far more clearly, so the rule just floated as a
       stray horizontal line above the map.) -->
  <line x1="${BAND_MARGIN_G}" y1="${VERSE_RULE_Y}" x2="${PW - BAND_MARGIN_G}" y2="${VERSE_RULE_Y}" class="rule"/>
  <!-- FOOTER SCRIPTURE — TIER 1: larger, bold, on ONE line, with the scripture
       reference on the right. It is one of the
       three things that must read when a reader steps closer, alongside the title
       and the people-group names, so it carries display weight. The reference is
       right-aligned to the map's own edge, which is what keeps it on ONE line. -->
  <!-- CENTRED on the sheet axis, with the reference set inline after it so the
       whole thing reads as ONE centred line. It was left-aligned with the ref
       pushed to the right margin, which split it into two objects at opposite
       ends of the sheet rather than one closing statement. -->
  <text x="${PW / 2}" y="${VERSE_RULE_Y + 30}" text-anchor="middle" class="verse">&#8220;${esc(verse.text)}&#8221;<tspan class="vref"> ${esc(verse.ref)}</tspan></text>`}
  <!-- GENERATION DATE, bottom-left. Deliberately NO hard counts of the global
       unengaged total on this poster: that number changes as research updates, and
       a printed figure would silently go stale on a wall. What CAN be stated
       honestly is WHEN this sheet was made — so a reader knows how current it is
       and can go to the site for the live picture. -->
  <!-- THE WHITE SHEET EDGE. Drawn last so it trims anything reaching the paper's
       edge. A stroked rect inset by half its own width paints a band exactly
       SHEET_EDGE wide around the whole poster. -->
  ${MAP_ONLY ? '' : `<rect x="${SHEET_EDGE / 2}" y="${SHEET_EDGE / 2}" width="${PW - SHEET_EDGE}" height="${PH - SHEET_EDGE}"
        fill="none" stroke="#FFFFFF" stroke-width="${SHEET_EDGE}"/>`}
</svg>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)} — UPG poster</title>
<style>
  :root{--paper:#f7f4ec;--sea:#eef3f4;--frame:#cdbf9e;--frameline:#B9AC8C;--ink:#1c1c17;--zc:${color};}
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
  /* CAPITALS + CITIES sit at the BOTTOM of the label hierarchy — smaller and
     lighter than province names — because they orient the reader, they are not the
     subject. Reading order stays country > province > city > people group, and the
     people-group pins keep the only saturated colour on the sheet.
     A capital is a ringed dot (the cartographic convention) and its name is set in
     the darker ink; an ordinary city is a plain dot with a lighter name. Shape and
     value carry the rank, so no extra hue is spent on this layer. */
  .cap-o{fill:#FFFFFF;stroke:#5C5443;stroke-width:1.4}
  .cap-i{fill:#5C5443}
  .cty-d{fill:#8A8271}
  .cap-t{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:10.5px;
    fill:#5C5443;font-weight:700;letter-spacing:.02em;paint-order:stroke;
    stroke:#F2EFE6;stroke-width:3;stroke-linejoin:round}
  .cty-t{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:9.5px;
    fill:#8A8271;font-weight:500;letter-spacing:.02em;paint-order:stroke;
    stroke:#F2EFE6;stroke-width:2.6;stroke-linejoin:round}
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
  /* ★ INK, NOT THE ZONE HUE, AND MEASURED. The number sits in white (.pin-num below) on this disc.
     While this was filled with var(--zc) the white failed WCAG 4.5:1 on most zone hues -- six of the
     eight country-region hues, and on the 100-list's own sheets too (europe's hsl(103,72%,56%) gives
     1.70:1). The demo country, Sudan, was 1.62:1. These numbers render at 5.3-9.9px on the sheet, so
     the large-text 3:1 allowance does not apply.
     A per-hue choice of white-or-ink CANNOT fix it: on red, hsl(0,72%,56%), white is 4.26 and ink
     4.01, so the best of the two is still under 4.5. White on #1c1c17 is 17.10:1 on every hue,
     unconditionally, and #1c1c17 is the sheet's own --ink rather than a new colour.
     The badge therefore stops carrying the zone hue; the zone fill and the pins still do, so the
     sheet keeps its colour identity. */
  .pin-num-bg{fill:#1c1c17;stroke:#F7F4EC;stroke-width:1.8;fill-opacity:.97}
  /* NO font-size HERE. It used to declare 13px, and a CSS rule BEATS the SVG
     font-size presentation attribute — so every per-badge size the generator
     computed was silently discarded and every numeral rendered at 13px. That is
     why "118" spilled 8.4px out of an 18.7px disc: the fix was being overridden
     by the stylesheet, not miscalculated. Size is set per element, on purpose,
     because it depends on the digit count and the disc radius. */
  .pin-num{font-family:Lato,'Segoe UI',system-ui,sans-serif;
    font-weight:700;fill:#FFFFFF;letter-spacing:0}
  /* The index is subordinate to the NAME — lighter and smaller, so the margin
     column reads as a list of peoples, not a list of numbers. */
  .lnum{fill:#A79C86;font-weight:400}
  /* Sans for CULTURAL features (people groups). Cartographer survey favours
     Frutiger; Lato/Open Sans are the available substitutes. Small labels take
     POSITIVE tracking (optical sizing). */
  /* The people-group names ARE the payload of this sheet — at thumbnail scale they
     are the one thing that must still read. Bold, and darker than body ink. */
  .lbl{font-family:Lato,'Segoe UI',system-ui,-apple-system,sans-serif;fill:#2A2721;
    font-weight:700;letter-spacing:.012em;dominant-baseline:auto}
  /* The index column — its own element so every number shares one x. Lighter than
     the name so the column reads as names first, indices second. */
  .lnum-col{font-family:Lato,'Segoe UI',system-ui,-apple-system,sans-serif;fill:#8a8470;
    font-weight:600;letter-spacing:.012em;dominant-baseline:auto}
  /* TITLE: display type takes NEGATIVE tracking. Set at 0 it is one of the
     loudest amateur tells. Sized up per the density budget — at ~5-11 names/dm2
     this poster is very sparse against Imhof's 500/dm2 world-atlas ceiling, so
     there is room to be generous. */
  .h1{font-family:Georgia,'Times New Roman',serif;font-weight:700;fill:var(--ink);letter-spacing:-.02em}
  /* "Unengaged of" — same size and weight as the title so it reads as one line,
     but in a lighter tone so the REGION NAME still carries the emphasis. */
  .h1qual{fill:#A79E8A}
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
  /* Sized to FILL its band. At 14.5px it measured ~1018px in a 1388px band and
     read as a small line floating in a wide space; the band went full-sheet-width
     and the type did not follow. 18px MEASURED (getBBox) at 1344px in the 1388px
     band — the estimator said 19px would fit at 1334 but it actually rendered
     1419 and overflowed both edges, so this size is taken from the RENDER. */
  .hgoal{font-family:Georgia,'Times New Roman',serif;font-size:18px;font-style:italic;
    fill:#4a4636;letter-spacing:.01em}
  /* Hairline between grid columns. A rule, not a box: it separates the columns
     without drawing a container around them. */
  .hcolrule{stroke:#D6CCB4;stroke-width:.8}
  /* SPARSE header: the series line under the title, and the one-line facts. */
  .hseries{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:14px;fill:#7E7562;letter-spacing:.01em}
  .hseries-em{font-weight:700;fill:#6B4A78}
  .hseries-dim{fill:#A79E8A}
  /* The site reference on its OWN line, so the series block is less wide. A
     single long line was forcing the series block wider than the map. */
  .hseries-dim2{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:12px;
    fill:#A79E8A;letter-spacing:.02em}
  /* SPARSE four-column facts table under the scripture. The HEADER names what the
     number is — "92" alone is meaningless, "People Groups / 92" is self-describing. */
  .hfhead{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:12.5px;fill:#8a8470;
    font-weight:700;letter-spacing:.14em;text-transform:uppercase}
  .hfval{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:17px;fill:#3A3730;
    font-weight:700;letter-spacing:.01em}
  /* The two HEADLINE stats — the count and the population. Display size, in the
     zone ink, so they read before anything else in this band. */
  .hfbig{font-family:Georgia,'Times New Roman',serif;font-size:34px;fill:#6B4A78;
    font-weight:700;letter-spacing:-.01em}
  /* The compassion verse under the facts table — scripture, so it takes the
     serif italic of the footer verse rather than the sans of the metadata. */
  /* Sized to FILL the full-sheet band on ONE line. It was 12.5px when the band was
     the map's width (~1100px); the band is now 1388px, so the type follows.
     15px measures ~1263px — fills the band while keeping headroom over the width
     estimator's error rather than sitting one glyph from overflow. */
  /* 13.5px bold. At full width it was too large: the line needs gaps at both
     ends. At 15px bold it measured 1396px of the 1448px band,
     i.e. touching both rules; 13.5 measures ~1256px and leaves ~96px of paper at
     each end, so the line reads as SET INSIDE the band rather than filling it.
     Bold + dark ink still carry the weight. */
  .hverse{font-family:Georgia,'Times New Roman',serif;font-size:13.5px;font-style:italic;
    font-weight:700;fill:#3a362c;letter-spacing:.01em}
  /* The scripture REFERENCE — bold and in the zone ink, matching how the series
     name and the site URL are emphasised, so the citation reads as a deliberate
     part of the line rather than a grey afterthought. */
  .hvref{font-family:Lato,'Segoe UI',system-ui,sans-serif;font-size:11px;
    fill:#6B4A78;letter-spacing:.14em;font-weight:700;font-style:normal}
  /* The hook is a QUESTION and reads one step up from the body — it is the line
     that stops a passer-by, and everything after it is the answer. */
  /* The vision block gets a small titled heading of its own — it tells a passer-by
     what they are about to read before they commit to reading it. Small caps and
     letterspacing mark it as a heading without needing size. */
  .hvh{font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:700;
    fill:#3f3a2e;letter-spacing:.06em;font-variant:small-caps}
  /* "Start with Prayer!" — the call to action above the three networks. */
  .hcta{font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:700;
    fill:#3f3a2e;letter-spacing:.06em;font-variant:small-caps}
  .verse{font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:23px;font-weight:700;fill:#2A2721}
  .vref{font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;font-weight:700;fill:#6B4A78;letter-spacing:.14em;text-transform:uppercase}
  .attrib{font-family:'Segoe UI',system-ui,sans-serif;font-size:9px;fill:#8d857a;letter-spacing:.02em}
  /* Haloed so the credits stay legible wherever they land on the map. */
  .attrib-halo{font-family:'Segoe UI',system-ui,sans-serif;font-size:9px;fill:none;
    stroke:#EEF3F4;stroke-width:2.6;stroke-linejoin:round;letter-spacing:.02em}
  /* PRINT. The stage is sized in CSS PIXELS (1500 wide) while @page declares a
     PHYSICAL size, so a browser maps 1500px -> 96dpi -> 15.6in and TILES that
     across the sheet: the 3x3 sheet prints as FOUR pages, not one. That went
     unnoticed because these posters were built to be SCREENSHOT by shoot.mjs at
     deviceScaleFactor 4, never printed from the browser.
     Scaling the stage to the page's own width makes one sheet = one page on any
     format, which is what a home printer needs. transform-origin top-left so the
     scale collapses toward the page corner rather than the element centre. */
  @media print{
    @page{size:${FMT.page};margin:0}
    html,body{background:#fff}
    /* A FIXED ratio, computed at generate time — not a vw calc. a vw/px ratio does not
       resolve against the PAGE box in print, so the calc silently evaluated to a
       no-op and the sheet still tiled. The page width in CSS px is the paper width
       in inches x 96; the scale is that over the stage width. */
    .stage{margin:0;transform:scale(${(FMT.pageWidthIn * 96 / FMT.w).toFixed(6)});transform-origin:top left}
    /* The scaled stage still reserves its ORIGINAL box, which pushes a blank second
       page. Collapse the flow height to the scaled height. */
    html,body{width:${(FMT.pageWidthIn * 96).toFixed(0)}px;height:${(FMT.pageWidthIn * 96 * FMT.h / FMT.w).toFixed(0)}px;overflow:hidden}
  }
${FMT.sideLanes ? SIDE_LANES_CSS + '\n' : ''}${HEAD_COLUMNS_ON_SERIES ? HEAD_COLUMNS_CSS + '\n' : ''}${HEAD_COLUMNS ? HEAD_COLUMNS_FULL_CSS + '\n' : ''}</style></head><body><div class="stage">${svg}</div></body></html>`;
  return sides ? { html, title, octiOK, crossings, diagFrac, sideLanes: sides.stats } : { html, title, octiOK, crossings, diagFrac };
}

return { renderPoster, CITIES, COUNTRIES, FILE_SUFFIX, FMT_KEY, FMT, MAP_ONLY, FORMATS };
}
