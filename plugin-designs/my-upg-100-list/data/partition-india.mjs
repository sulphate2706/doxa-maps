// partition-india.mjs — slice 09b-3 §1(a)
//
// Reproducible, committed partitioner that divides India's 34 admin-1 units
// (855 PGs) into ~9–11 CONTIGUOUS clusters in the ZLL band (~40–110, target
// ~95). Contiguity is HARD (never broken); band is SOFT (outliers logged).
//
// Algorithm (deterministic — no randomness, stable sorts):
//   1. Restrict the adjacency graph to INDIA admins only. Every neighbor lookup
//      is filtered to the IND key set, which DROPS the 7 real India–China LAC
//      cross-country edges (Ladākh↔{Tibet,Xinjiang}; Arunāchal/Sikkim/Himāchal/
//      Uttarākhand/Assam↔Tibet). A greedy walk therefore can never cross into
//      China. CRITICAL — carried forward from 09b-2 CT.
//   2. Greedy contiguous grow: seed from the largest unassigned mainland admin,
//      grow by the highest-count India-neighbor (Zonal-Council members preferred
//      as a soft tiebreak) toward TARGET, never exceeding the band ceiling.
//   3. Merge-small pass: any cluster < MERGE_BELOW merges into its highest-count
//      CONTIGUOUS India-neighbor cluster. Tight ceiling (110) is tried first so
//      balanced merges win; a relaxed ceiling then absorbs any remainder. After
//      every merge isContiguous() is re-asserted — contiguity is never broken.
//   4. Island-orphans (Andaman & Nicobar, Lakshadweep) attach to their nearest
//      mainland cluster (I-D4 defaults: A&N→Tamil Nādu, Lakshadweep→Kerala) and
//      are exempt from the contiguity assertion.
//
// Every member name is validated against the counts / graph keys; unknown names
// are warned (Mizoram + Nagaland are ABSENT from the 34-feature gbOpen dataset —
// they are intentionally never referenced).
//
// Exports: partitionIndia() -> { clusters, total, zonalOf }, ZONAL_COUNCILS.
// Run directly (`node data/partition-india.mjs`) to print the cluster table.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neighborsOf, isContiguous, ISLAND_ORPHANS } from './adjacency.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COUNTS = JSON.parse(
  readFileSync(join(__dirname, 'admin-counts.json'), 'utf8'),
).IND;

const IND = new Set(Object.keys(COUNTS));
const ORPHANS = new Set(ISLAND_ORPHANS);

// India-restricted neighbors — this is where the LAC China edges get dropped.
const indNbrs = (name) => neighborsOf(name).filter((n) => IND.has(n));

// ---------------------------------------------------------------------------
// 6 Zonal Councils (soft grouping; §A RE finding). Mizoram + Nagaland omitted
// on purpose — they are absent from the 34-feature dataset.
// ---------------------------------------------------------------------------
export const ZONAL_COUNCILS = {
  Northern: ['Jammu and Kashmīr', 'Ladākh', 'Himāchal Pradesh', 'Punjab',
    'Haryāna', 'Chandīgarh', 'Delhi', 'Rājasthān'],
  Central: ['Uttar Pradesh', 'Uttarākhand', 'Chhattīsgarh', 'Madhya Pradesh'],
  Eastern: ['Bihār', 'Jhārkhand', 'Odisha', 'West Bengal'],
  Western: ['Goa', 'Gujarāt', 'Mahārāshtra',
    'Dādra and Nagar Haveli and Damān and Diu'],
  Southern: ['Andhra Pradesh', 'Karnātaka', 'Kerala', 'Tamil Nādu',
    'Telangāna', 'Puducherry', 'Lakshadweep', 'Andaman and Nicobar Islands'],
  'North-Eastern': ['Arunāchal Pradesh', 'Assam', 'Manipur', 'Meghālaya',
    'Sikkim', 'Tripura'],
};

const ZONAL_OF = {};
for (const [zone, members] of Object.entries(ZONAL_COUNCILS)) {
  for (const m of members) ZONAL_OF[m] = zone;
}

// ---------------------------------------------------------------------------
// tunables
// ---------------------------------------------------------------------------
const BAND = [40, 110];     // soft target band (ZLL)
const TARGET = 85;          // greedy stops growing past this
const MERGE_BELOW = 40;     // clusters under this absorb into a neighbor
const ATTACH = {            // I-D4 island-orphan anchors
  Lakshadweep: 'Kerala',
  'Andaman and Nicobar Islands': 'Tamil Nādu',
};

const cnt = (members) => members.reduce((a, m) => a + (COUNTS[m] || 0), 0);

// ---------------------------------------------------------------------------
// name validation (warn on unknown)
// ---------------------------------------------------------------------------
function validateNames() {
  const warnings = [];
  for (const z of Object.values(ZONAL_COUNCILS)) {
    for (const m of z) {
      if (!IND.has(m)) warnings.push(`Zonal member not in counts: "${m}"`);
    }
  }
  // every IND admin must be reachable in the adjacency graph
  for (const m of IND) {
    if (!ORPHANS.has(m) && indNbrs(m).length === 0) {
      warnings.push(`India admin "${m}" has no India neighbor (would be a singleton)`);
    }
  }
  for (const w of warnings) console.warn('⚠ ' + w);
  return warnings;
}

// ---------------------------------------------------------------------------
// step 2 — greedy contiguous grow
// ---------------------------------------------------------------------------
function grow() {
  const assigned = new Set();
  const clusters = [];
  const mainland = [...IND]
    .filter((n) => !ORPHANS.has(n))
    .sort((a, b) => COUNTS[b] - COUNTS[a] || (a < b ? -1 : 1)); // stable

  for (const seed of mainland) {
    if (assigned.has(seed)) continue;
    const cl = [seed];
    assigned.add(seed);
    let c = COUNTS[seed];
    const seedZone = ZONAL_OF[seed];

    while (c < TARGET) {
      // frontier = unassigned India-neighbors of the cluster so far
      const front = new Set();
      for (const m of cl) {
        for (const nb of indNbrs(m)) {
          if (!assigned.has(nb) && !ORPHANS.has(nb)) front.add(nb);
        }
      }
      if (!front.size) break;

      // pick highest-count neighbor that keeps us in-band; same-zone preferred
      let best = null;
      let bestScore = -1;
      for (const f of [...front].sort()) {
        if (c + COUNTS[f] > BAND[1]) continue;
        const score = COUNTS[f] + (ZONAL_OF[f] === seedZone ? 1000 : 0);
        if (score > bestScore) { bestScore = score; best = f; }
      }
      if (!best) break;
      cl.push(best);
      assigned.add(best);
      c += COUNTS[best];
    }
    clusters.push(cl);
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// step 3 — merge-small pass (contiguity re-checked after every merge)
// ---------------------------------------------------------------------------
function mergeSmall(clusters, ceiling) {
  let changed = true;
  while (changed) {
    changed = false;
    clusters.sort((a, b) => cnt(a) - cnt(b)); // smallest first
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      if (cnt(cl) >= MERGE_BELOW) continue;

      let best = -1;
      let bestScore = -1;
      for (let j = 0; j < clusters.length; j++) {
        if (j === i) continue;
        const other = clusters[j];
        // must touch via an India edge
        let touch = false;
        for (const m of cl) {
          for (const nb of indNbrs(m)) {
            if (other.includes(nb)) { touch = true; break; }
          }
          if (touch) break;
        }
        if (!touch) continue;

        const merged = [...cl, ...other];
        // HARD: never break contiguity
        if (!isContiguous(merged).contiguous) continue;
        if (cnt(merged) > ceiling) continue;

        const score = cnt(other); // merge into highest-count contiguous neighbor
        if (score > bestScore) { bestScore = score; best = j; }
      }

      if (best >= 0) {
        clusters[best] = [...clusters[best], ...cl];
        clusters.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// step 4 — attach island-orphans
// ---------------------------------------------------------------------------
function attachOrphans(clusters) {
  for (const [orphan, anchor] of Object.entries(ATTACH)) {
    if (!IND.has(orphan)) continue;
    let ci = clusters.findIndex((cl) => cl.includes(anchor));
    if (ci < 0) ci = 0; // fallback: largest cluster
    clusters[ci].push(orphan);
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// public entry
// ---------------------------------------------------------------------------
export function partitionIndia() {
  validateNames();
  let clusters = grow();
  clusters = mergeSmall(clusters, BAND[1]);   // balanced merges first (<=110)
  clusters = mergeSmall(clusters, BAND[1] + 30); // relaxed: absorb any remainder
  clusters = attachOrphans(clusters);

  // deterministic order: largest first, then alpha by first member
  clusters.sort((a, b) => cnt(b) - cnt(a) || (a[0] < b[0] ? -1 : 1));

  const total = clusters.reduce((a, cl) => a + cnt(cl), 0);
  return { clusters, total, zonalOf: ZONAL_OF, count: cnt };
}

// ---------------------------------------------------------------------------
// CLI: print the cluster table
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const { clusters, total } = partitionIndia();
  console.log('\nIndia contiguous partition:');
  for (const cl of clusters) {
    const r = isContiguous(cl);
    const outlier = cnt(cl) < BAND[0] || cnt(cl) > BAND[1] ? '  *OUTLIER' : '';
    console.log(`  [${String(cnt(cl)).padStart(3)}] contig=${r.contiguous} :: ${cl.join(', ')}${outlier}`);
  }
  console.log(`\n  total = ${total} (expected 855)  clusters = ${clusters.length}`);
}
