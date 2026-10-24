// pip-stamp.mjs — slice 09b-1 (Asia repartition GATE)
//
//   node plugin-designs/my-upg-100-list/data/pip-stamp.mjs
//
// Point-in-polygon stamps every PG to its TRUE admin-1.
// For each record with finite lat/lng, ray-cast [lng,lat] against every
// IND + CHN gbOpen ADM1 polygon; admin1 = containing polygon's shapeName.
// Border-miss (no polygon) -> nearest-centroid fallback within tolerance.
// Non-IND/CHN -> admin1: null.
//
// Outputs (committed, byte-stable: keys sorted, no timestamps):
//   data/admin-membership.json  { "<slug>": { country, admin1, lat, lng }, ... }
//   data/admin-counts.json      { "IND": { "<shapeName>": N }, "CHN": {...} }
//
// PIP fn: committed ray-casting (no heavy dep — @turf not in node_modules).
// gbOpen coords are [lng,lat]; we test [lng,lat] to match.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = "/tmp/upg-live-records-full.json";

// Nearest-centroid fallback tolerance, in degrees (border slivers only).
// ~0.75deg ~= 80km; generous enough for coastline/border digitization gaps,
// tight enough that an interior point never grabs a far province.
const FALLBACK_TOL_DEG = 0.75;

// ---- committed ray-casting point-in-polygon ------------------------------
// ring: array of [lng,lat]. Standard even-odd ray cast. Returns true if the
// point [x=lng, y=lat] is inside the ring.
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// A GeoJSON Polygon is [outerRing, hole1, hole2, ...]. Inside the outer ring
// AND not inside any hole.
function pointInPolygonRings(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(x, y, rings[h])) return false; // in a hole
  }
  return true;
}

// Handles geometry.type Polygon and MultiPolygon.
function pointInGeometry(x, y, geom) {
  if (geom.type === "Polygon") {
    return pointInPolygonRings(x, y, geom.coordinates);
  }
  if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      if (pointInPolygonRings(x, y, poly)) return true;
    }
    return false;
  }
  return false;
}

// ---- centroid for fallback (average of outer-ring vertices) --------------
function geometryCentroid(geom) {
  let sx = 0, sy = 0, n = 0;
  const eat = (rings) => {
    const outer = rings[0];
    for (const [lng, lat] of outer) { sx += lng; sy += lat; n++; }
  };
  if (geom.type === "Polygon") eat(geom.coordinates);
  else if (geom.type === "MultiPolygon") for (const p of geom.coordinates) eat(p);
  return [sx / n, sy / n];
}

// ---- load polygon sets ---------------------------------------------------
function loadAdm1(file) {
  const gj = JSON.parse(readFileSync(join(__dirname, file), "utf8"));
  return gj.features.map((f) => ({
    shapeName: f.properties.shapeName,
    geom: f.geometry,
    centroid: geometryCentroid(f.geometry),
  }));
}

// India is stamped against ALL 36 states and union territories (data/boundaries/gb-IND-ADM1-full.geojson). The
// 34-shape map copy beside this file has no Nāgāland or Mizoram, so a group located there would have been
// stamped into a neighbour by the fallback (none is today: re-stamped 2026-09-30, 853/855 agree, 0 differ).
const IND_POLYS = loadAdm1("../../../data/boundaries/gb-IND-ADM1-full.geojson");
const CHN_POLYS = loadAdm1("gb-CHN-ADM1.geojson");

// Stamp one point against a polygon set. Returns { shapeName, fallback }
// or null if even the fallback is outside tolerance.
function stamp(lng, lat, polys) {
  let hits = [];
  for (const p of polys) {
    if (pointInGeometry(lng, lat, p.geom)) hits.push(p.shapeName);
  }
  if (hits.length === 1) return { shapeName: hits[0], fallback: false };
  if (hits.length > 1) {
    // Should not happen with clean admin-1 — first wins, but log it.
    console.warn(`[double-stamp] (${lng},${lat}) in: ${hits.join(", ")} -> taking ${hits[0]}`);
    return { shapeName: hits[0], fallback: false };
  }
  // miss -> nearest centroid within tolerance
  let best = null, bestD = Infinity;
  for (const p of polys) {
    const dx = lng - p.centroid[0];
    const dy = lat - p.centroid[1];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best && bestD <= FALLBACK_TOL_DEG) {
    return { shapeName: best.shapeName, fallback: true };
  }
  return null;
}

// ---- main ----------------------------------------------------------------
const cache = JSON.parse(readFileSync(CACHE, "utf8"));
const records = cache.posts;
if (!Array.isArray(records)) {
  console.error("FATAL: cache.posts is not an array — bad input cache.");
  process.exit(1);
}

const membership = {};
const counts = { IND: {}, CHN: {} };
let stampedReal = 0, fallbackCount = 0, indCountedTotal = 0, chnCountedTotal = 0;

for (const r of records) {
  const slug = r.slug;
  const cc = r.country_code && r.country_code.value;
  const lat = parseFloat(r.latitude);
  const lng = parseFloat(r.longitude);
  const finite = Number.isFinite(lat) && Number.isFinite(lng);

  let admin1 = null;
  if (finite && (cc === "IND" || cc === "CHN")) {
    const polys = cc === "IND" ? IND_POLYS : CHN_POLYS;
    const res = stamp(lng, lat, polys);
    if (res) {
      admin1 = res.shapeName;
      if (res.fallback) fallbackCount++; else stampedReal++;
      const bucket = counts[cc];
      bucket[admin1] = (bucket[admin1] || 0) + 1;
      if (cc === "IND") indCountedTotal++; else chnCountedTotal++;
    }
  }

  membership[slug] = {
    country: cc || null,
    admin1,
    lat: finite ? lat : null,
    lng: finite ? lng : null,
  };
}

// ---- stable serialization (sort keys; no timestamps) ---------------------
function sortObj(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}
function sortCounts(c) {
  return { IND: sortObj(c.IND), CHN: sortObj(c.CHN) };
}

const sortedMembership = {};
for (const k of Object.keys(membership).sort()) sortedMembership[k] = membership[k];

writeFileSync(
  join(__dirname, "admin-membership.json"),
  JSON.stringify(sortedMembership, null, 1) + "\n"
);
writeFileSync(
  join(__dirname, "admin-counts.json"),
  JSON.stringify(sortCounts(counts), null, 1) + "\n"
);

console.log("pip-stamp done");
console.log(`  records:        ${records.length}`);
console.log(`  IND located:    ${indCountedTotal}  CHN located: ${chnCountedTotal}`);
console.log(`  real-stamp:     ${stampedReal}  fallback: ${fallbackCount}`);
console.log(`  wrote admin-membership.json + admin-counts.json`);
console.log("  NEXT: node plugin-designs/my-upg-100-list/data/emit-india-states.mjs (re-derives data/people-groups/india-states.json + its pin; check:india-states fails until you do)");
