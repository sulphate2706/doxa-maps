// adjacency.mjs — slice 09b-2 §1(a–c)
//
// Queen-contiguity adjacency graph over the combined IND + CHN ADM1 polygons,
// plus a reusable contiguity test for the ZLL ("is this set of admin-1s one
// connected component?").
//
// No @turf in node_modules (verified: `ls node_modules/@turf` -> none), so this
// is a committed, dependency-free geometry test:
//   - bbox prefilter (cheap reject)
//   - queen contiguity = boundaries cross/touch OR a vertex of one ring lies
//     within EPS of a vertex/edge of the other (tolerates gbOpen slivers and
//     point-touching corners).
// Handles Polygon + MultiPolygon. Coords are [lng, lat] (gbOpen).
//
// Cache: data/adjacency.json (sorted keys + sorted neighbour arrays — no
// timestamps, byte-reproducible).
//
// Exports: buildAdjacency(), getAdjacency(), neighborsOf(), isContiguous(),
//          ISLAND_ORPHANS.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = [
  join(__dirname, 'gb-IND-ADM1.geojson'),
  join(__dirname, 'gb-CHN-ADM1.geojson'),
];
const CACHE = join(__dirname, 'adjacency.json');

// Declared island-orphans — no land border, exempt from the connected-component
// assertion. EXACT shapeName strings as they appear in the geojson (verified by
// reading both files). "Japan" is not present in these two datasets.
export const ISLAND_ORPHANS = [
  'Hainan Province',            // CHN — bare "Hainan" is not the shapeName
  'Lakshadweep',                // IND
  'Andaman and Nicobar Islands',// IND
  // 'Japan' — not in IND/CHN ADM1 files; kept here for forward-compat callers.
  'Japan',
];

// Queen tolerance in degrees. gbOpen ADM1 vertices on a shared border rarely
// coincide bit-for-bit; ~1e-4 deg ≈ 11 m at the equator catches sliver gaps
// without bridging genuinely separate admins (min real gap here is >> this).
const EPS = 1e-4;
const EPS2 = EPS * EPS;

// ---------------------------------------------------------------------------
// geometry helpers — all on [lng,lat] pairs
// ---------------------------------------------------------------------------

// every linear ring (outer + holes) of a Polygon/MultiPolygon -> array of rings
function ringsOf(geom) {
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  throw new Error('unsupported geometry: ' + geom.type);
}

function bboxOfRings(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

// bboxes overlap (inflated by EPS so point-touching corners survive the filter)
function bboxOverlap(a, b) {
  return !(a[2] + EPS < b[0] || b[2] + EPS < a[0] ||
           a[3] + EPS < b[1] || b[3] + EPS < a[1]);
}

// squared distance from point p to segment ab (planar; fine at admin scale)
function distSqPointSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p[0] - a[0], ey = p[1] - a[1];
    return ex * ex + ey * ey;
  }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  const ex = p[0] - cx, ey = p[1] - cy;
  return ex * ex + ey * ey;
}

// proper segment-intersection test (boundaries crossing each other)
function segDir(o, a, b) {
  const v = (b[1] - o[1]) * (a[0] - o[0]) - (b[0] - o[0]) * (a[1] - o[1]);
  if (v > 1e-14) return 1;
  if (v < -1e-14) return -1;
  return 0;
}
function onSeg(o, a, p) {
  return Math.min(o[0], a[0]) - EPS <= p[0] && p[0] <= Math.max(o[0], a[0]) + EPS &&
         Math.min(o[1], a[1]) - EPS <= p[1] && p[1] <= Math.max(o[1], a[1]) + EPS;
}
function segIntersect(p1, p2, p3, p4) {
  const d1 = segDir(p3, p4, p1);
  const d2 = segDir(p3, p4, p2);
  const d3 = segDir(p1, p2, p3);
  const d4 = segDir(p1, p2, p4);
  if (d1 !== d2 && d3 !== d4) return true;
  if (d1 === 0 && onSeg(p3, p4, p1)) return true;
  if (d2 === 0 && onSeg(p3, p4, p2)) return true;
  if (d3 === 0 && onSeg(p1, p2, p3)) return true;
  if (d4 === 0 && onSeg(p1, p2, p4)) return true;
  return false;
}

// Queen-adjacency between two admin geometries.
// Adjacent iff any boundary segments cross/touch OR any vertex of one ring is
// within EPS of an edge (or vertex) of the other ring. Either direction.
function adjacent(ringsA, bbA, ringsB, bbB) {
  if (!bboxOverlap(bbA, bbB)) return false;

  // 1) vertex-near-edge (both directions) — catches shared borders + corners
  if (vertexNearEdge(ringsA, ringsB)) return true;
  if (vertexNearEdge(ringsB, ringsA)) return true;

  // 2) proper segment intersection — catches crossing boundaries w/o coincident
  //    vertices (rare here, but correct).
  for (const ra of ringsA) {
    for (let i = 0; i + 1 < ra.length; i++) {
      const a1 = ra[i], a2 = ra[i + 1];
      for (const rb of ringsB) {
        for (let j = 0; j + 1 < rb.length; j++) {
          if (segIntersect(a1, a2, rb[j], rb[j + 1])) return true;
        }
      }
    }
  }
  return false;
}

function vertexNearEdge(ringsP, ringsQ) {
  for (const rp of ringsP) {
    for (const v of rp) {
      for (const rq of ringsQ) {
        for (let j = 0; j + 1 < rq.length; j++) {
          if (distSqPointSeg(v, rq[j], rq[j + 1]) <= EPS2) return true;
        }
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function loadUnits() {
  const units = [];
  for (const path of SRC) {
    const fc = JSON.parse(readFileSync(path, 'utf8'));
    for (const f of fc.features) {
      const name = f.properties.shapeName;
      const rings = ringsOf(f.geometry);
      units.push({ name, rings, bbox: bboxOfRings(rings) });
    }
  }
  return units;
}

// Build the adjacency map fresh from geojson. Returns { "<name>": Set<name> }.
export function buildAdjacency() {
  const units = loadUnits();
  const adj = {};
  for (const u of units) adj[u.name] = new Set();
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (adjacent(units[i].rings, units[i].bbox, units[j].rings, units[j].bbox)) {
        adj[units[i].name].add(units[j].name);
        adj[units[j].name].add(units[i].name);
      }
    }
  }
  return adj;
}

// Serialise to a reproducible JSON shape: sorted keys, sorted neighbour arrays.
function toCacheObject(adj) {
  const out = {};
  for (const name of Object.keys(adj).sort()) {
    out[name] = [...adj[name]].sort();
  }
  return out;
}

// Write data/adjacency.json (sorted, no timestamps).
export function writeCache(adj = buildAdjacency()) {
  writeFileSync(CACHE, JSON.stringify(toCacheObject(adj), null, 2) + '\n');
  return adj;
}

// Lazy singleton: load cache if present, else build + write.
let _adj = null;
export function getAdjacency() {
  if (_adj) return _adj;
  if (existsSync(CACHE)) {
    const obj = JSON.parse(readFileSync(CACHE, 'utf8'));
    _adj = {};
    for (const [k, v] of Object.entries(obj)) _adj[k] = new Set(v);
  } else {
    _adj = writeCache();
  }
  return _adj;
}

// (c) convenience accessor for the partitioner
export function neighborsOf(name) {
  const adj = getAdjacency();
  if (!adj[name]) return [];
  return [...adj[name]].sort();
}

// ---------------------------------------------------------------------------
// (b) contiguity test
// ---------------------------------------------------------------------------

// isContiguous(adminNames, { islandOrphans })
//   -> { contiguous, components, orphansIgnored }
// Build the subgraph induced by adminNames, drop island-orphans from the
// connectivity requirement (but report them), BFS the rest. contiguous = the
// non-orphan members form exactly ONE connected component.
export function isContiguous(adminNames, { islandOrphans = ISLAND_ORPHANS } = {}) {
  const adj = getAdjacency();
  const orphanSet = new Set(islandOrphans);
  const requested = new Set(adminNames);

  // orphans that are actually in this request (reported, not required)
  const orphansIgnored = [...requested].filter((n) => orphanSet.has(n)).sort();

  // nodes that must form one component
  const nodes = [...requested].filter((n) => !orphanSet.has(n));

  if (nodes.length === 0) {
    return { contiguous: true, components: [], orphansIgnored };
  }

  const inScope = new Set(nodes);
  const seen = new Set();
  const components = [];

  for (const start of nodes) {
    if (seen.has(start)) continue;
    const comp = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const cur = queue.shift();
      comp.push(cur);
      const nbrs = adj[cur] || new Set();
      for (const nb of nbrs) {
        if (inScope.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp.sort());
  }
  components.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return {
    contiguous: components.length === 1,
    components,
    orphansIgnored,
  };
}
