// partition-china.mjs — slice 09b-4 §1(a)
//
// Reproducible, committed partitioner that divides China's 12 admin-1 units
// (152 PGs PIP-located) into 2–3 CONTIGUOUS clusters in the ZLL band (~40–110).
// Mirrors data/partition-india.mjs exactly — same partitioner shape, China set.
// Contiguity is HARD (never broken); band is SOFT (China's sparse NE forces one
// accepted low outlier — C-D2).
//
// Algorithm (deterministic — no randomness, stable sorts):
//   1. Restrict the adjacency graph to CHINA admins only. Every neighbor lookup
//      is filtered to the CHN key set, which DROPS the 7 real India–China LAC
//      cross-country edges (Tibet↔{Arunāchal,Assam,Himāchal,Ladākh,Sikkim,
//      Uttarākhand}; Xinjiang↔Ladākh). A greedy walk therefore can never cross
//      into India. CRITICAL — carried forward from 09b-2 CT.
//   2. Greedy contiguous grow: seed from the largest unassigned mainland admin,
//      grow by the highest-count China-neighbor (Macro-region members preferred
//      as a soft tiebreak) toward TARGET, never exceeding the band ceiling.
//   3. Merge-small pass: any cluster < MERGE_BELOW merges into its highest-count
//      CONTIGUOUS China-neighbor cluster. Tight ceiling (110) is tried first so
//      balanced merges win; a relaxed ceiling then absorbs any remainder. After
//      every merge isContiguous() is re-asserted — contiguity is never broken.
//   4. Island-orphans (Hainan) attach to their nearest mainland cluster (C-D4
//      default: Hainan→CN-1 South-Central, southern coast) and are exempt from
//      the contiguity assertion.
//
// The 2 unstamped China-border points (jing, pana-china — beyond PIP tolerance,
// admin1=null) are NOT admin members and never enter a cluster; they route to
// 09b-5 (uncovered). China partition target = 152 (C-D5).
//
// Every member name is validated against the counts / graph keys; unknown names
// are warned.
//
// Exports: partitionChina() -> { clusters, total, macroOf, count }, MACRO_REGIONS.
// Run directly (`node data/partition-china.mjs`) to print the cluster table.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neighborsOf, isContiguous, ISLAND_ORPHANS } from './adjacency.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COUNTS = JSON.parse(
  readFileSync(join(__dirname, 'admin-counts.json'), 'utf8'),
).CHN;

const CHN = new Set(Object.keys(COUNTS));
const ORPHANS = new Set(ISLAND_ORPHANS);

// China-restricted neighbors — this is where the LAC India edges get dropped.
const chnNbrs = (name) => neighborsOf(name).filter((n) => CHN.has(n));

// ---------------------------------------------------------------------------
// 2 macro-regions (soft grouping; RE finding mirroring India's Zonal Councils).
// South-Central = the dense SW core + the southern fold; West-North = the sparse
// high-plateau chain fused with the NE. Hainan is an island-orphan (no land
// border) — listed under South-Central as its attach anchor.
// ---------------------------------------------------------------------------
export const MACRO_REGIONS = {
  'South-Central': ['Yunnan Province', 'Guizhou Province',
    'Guangxi Zhuang Autonomous Region', 'Hunan Province', 'Hainan Province'],
  'West-North': ['Tibet Autonomous Region', 'Sichuan Province',
    'Xinjiang Uyghur Autonomous Region', 'Qinghai Province', 'Gansu Province',
    'Inner Mongolia Autonomous Region', 'Heilongjiang Province'],
};

const MACRO_OF = {};
for (const [region, members] of Object.entries(MACRO_REGIONS)) {
  for (const m of members) MACRO_OF[m] = region;
}

// ---------------------------------------------------------------------------
// tunables (same shape as India; TARGET tuned so the dense SW core grows the
// South-Central bloc before the sparse plateau seeds its own).
// ---------------------------------------------------------------------------
const BAND = [40, 110];     // soft target band (ZLL)
const TARGET = 85;          // greedy stops growing past this
const MERGE_BELOW = 40;     // clusters under this absorb into a neighbor
const ATTACH = {            // C-D4 island-orphan anchors
  'Hainan Province': 'Yunnan Province', // nearest mainland anchor → CN-1
};

const cnt = (members) => members.reduce((a, m) => a + (COUNTS[m] || 0), 0);

// ---------------------------------------------------------------------------
// name validation (warn on unknown)
// ---------------------------------------------------------------------------
function validateNames() {
  const warnings = [];
  for (const z of Object.values(MACRO_REGIONS)) {
    for (const m of z) {
      if (!CHN.has(m)) warnings.push(`Macro-region member not in counts: "${m}"`);
    }
  }
  // every CHN admin must be reachable in the adjacency graph (orphans exempt)
  for (const m of CHN) {
    if (!ORPHANS.has(m) && chnNbrs(m).length === 0) {
      warnings.push(`China admin "${m}" has no China neighbor (would be a singleton)`);
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
  const mainland = [...CHN]
    .filter((n) => !ORPHANS.has(n))
    .sort((a, b) => COUNTS[b] - COUNTS[a] || (a < b ? -1 : 1)); // stable

  for (const seed of mainland) {
    if (assigned.has(seed)) continue;
    const cl = [seed];
    assigned.add(seed);
    let c = COUNTS[seed];
    const seedRegion = MACRO_OF[seed];

    while (c < TARGET) {
      // frontier = unassigned China-neighbors of the cluster so far
      const front = new Set();
      for (const m of cl) {
        for (const nb of chnNbrs(m)) {
          if (!assigned.has(nb) && !ORPHANS.has(nb)) front.add(nb);
        }
      }
      if (!front.size) break;

      // pick highest-count neighbor that keeps us in-band; same-region preferred
      let best = null;
      let bestScore = -1;
      for (const f of [...front].sort()) {
        if (c + COUNTS[f] > BAND[1]) continue;
        const score = COUNTS[f] + (MACRO_OF[f] === seedRegion ? 1000 : 0);
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
        // must touch via a China edge
        let touch = false;
        for (const m of cl) {
          for (const nb of chnNbrs(m)) {
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
    if (!CHN.has(orphan)) continue;
    let ci = clusters.findIndex((cl) => cl.includes(anchor));
    if (ci < 0) ci = 0; // fallback: largest cluster
    clusters[ci].push(orphan);
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// public entry
// ---------------------------------------------------------------------------
export function partitionChina() {
  validateNames();
  let clusters = grow();
  clusters = mergeSmall(clusters, BAND[1]);     // balanced merges first (<=110)
  clusters = mergeSmall(clusters, BAND[1] + 30); // relaxed: absorb any remainder
  clusters = attachOrphans(clusters);

  // deterministic order: largest first, then alpha by first member
  clusters.sort((a, b) => cnt(b) - cnt(a) || (a[0] < b[0] ? -1 : 1));

  const total = clusters.reduce((a, cl) => a + cnt(cl), 0);
  return { clusters, total, macroOf: MACRO_OF, count: cnt };
}

// ---------------------------------------------------------------------------
// CLI: print the cluster table
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const { clusters, total } = partitionChina();
  console.log('\nChina contiguous partition:');
  for (const cl of clusters) {
    const r = isContiguous(cl);
    const outlier = cnt(cl) < BAND[0] || cnt(cl) > BAND[1] ? '  *OUTLIER' : '';
    console.log(`  [${String(cnt(cl)).padStart(3)}] contig=${r.contiguous} :: ${cl.join(', ')}${outlier}`);
  }
  console.log(`\n  total = ${total} (expected 152; jing + pana-china unstamped → 09b-5)  clusters = ${clusters.length}`);
}
