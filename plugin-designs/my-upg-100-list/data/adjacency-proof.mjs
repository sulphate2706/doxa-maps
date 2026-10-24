// adjacency-proof.mjs — slice 09b-2 §1(d), can-fail
//
//   node plugin-designs/my-upg-100-list/data/adjacency-proof.mjs
//
// Proves:
//   1. graph builds; every admin has >=1 neighbour EXCEPT declared island-orphans
//      (reports orphans found vs declared).
//   2. CAN-FAIL: isContiguous(['Mahārāshtra','Jammu and Kashmīr']) -> contiguous:false (2 comps)
//   3. isContiguous(['West Bengal','Bihār']) -> contiguous:true
//   4. neighborsOf('Bihār') includes 'Uttar Pradesh','Jhārkhand','West Bengal'
//
// Exact shapeName strings (diacritics preserved) verified against the geojson.

import { buildAdjacency, writeCache, getAdjacency, neighborsOf, isContiguous, ISLAND_ORPHANS } from './adjacency.mjs';

let fail = 0;
const ok = (b, msg) => { console.log((b ? 'PASS  ' : 'FAIL  ') + msg); if (!b) fail = 1; };

console.log('================ 09b-2 ADJACENCY PROOF ================');

// --- build (fresh, then re-cache so adjacency.json is reproducible) ---------
const adj = buildAdjacency();
writeCache(adj);                 // ensure data/adjacency.json is on disk + sorted
const names = Object.keys(adj);
let edges = 0;
for (const n of names) edges += adj[n].size;
edges /= 2;
console.log(`\n## graph: units=${names.length}  edges=${edges}  avgNbr=${(2 * edges / names.length).toFixed(2)}`);

// --- (1) every admin >=1 neighbour except declared island-orphans -----------
const declared = new Set(ISLAND_ORPHANS);
const zeroNbr = names.filter((n) => adj[n].size === 0).sort();
const orphansInData = names.filter((n) => declared.has(n)).sort();
const declaredButAbsent = ISLAND_ORPHANS.filter((n) => !adj[n]).sort();
const isolatedNonOrphan = zeroNbr.filter((n) => !declared.has(n));

console.log('\n## §1d(1) land-border coverage');
console.log('  declared island-orphans : ' + JSON.stringify(ISLAND_ORPHANS));
console.log('  orphans present in data  : ' + JSON.stringify(orphansInData));
console.log('  declared-but-absent      : ' + JSON.stringify(declaredButAbsent) + '  (not in these 2 files — ok)');
console.log('  zero-neighbour units     : ' + JSON.stringify(zeroNbr));
ok(isolatedNonOrphan.length === 0,
   '(1) every non-orphan admin has >=1 neighbour' +
   (isolatedNonOrphan.length ? '  BUG isolated: ' + JSON.stringify(isolatedNonOrphan) : ''));
ok(zeroNbr.every((n) => declared.has(n)),
   '(1) every zero-neighbour unit is a declared island-orphan');

// --- (2) CAN-FAIL: Mahārāshtra + Jammu and Kashmīr -> 2 components -----------
console.log('\n## §1d(2) can-fail: Mahārāshtra + Jammu and Kashmīr (~1500 km apart)');
const r2 = isContiguous(['Mahārāshtra', 'Jammu and Kashmīr']);
console.log('  ' + JSON.stringify(r2));
ok(r2.contiguous === false && r2.components.length === 2,
   '(2) isContiguous(Mahārāshtra, Jammu and Kashmīr) -> contiguous:false, 2 components');

// --- (3) West Bengal + Bihār -> contiguous -----------------------------------
console.log('\n## §1d(3) known-good: West Bengal + Bihār');
const r3 = isContiguous(['West Bengal', 'Bihār']);
console.log('  ' + JSON.stringify(r3));
ok(r3.contiguous === true && r3.components.length === 1,
   '(3) isContiguous(West Bengal, Bihār) -> contiguous:true, 1 component');

// --- (4) neighborsOf('Bihār') spot-check ------------------------------------
console.log('\n## §1d(4) neighborsOf(Bihār)');
const bn = neighborsOf('Bihār');
console.log('  ' + JSON.stringify(bn));
const need = ['Uttar Pradesh', 'Jhārkhand', 'West Bengal'];
ok(need.every((n) => bn.includes(n)),
   '(4) neighborsOf(Bihār) includes Uttar Pradesh, Jhārkhand, West Bengal');

// --- bonus: orphan exemption is honoured (orphan + 1 real admin still "1 comp")
const r5 = isContiguous(['Bihār', 'Lakshadweep']);
console.log('\n## bonus: orphan exemption — Bihār + Lakshadweep (orphan ignored)');
console.log('  ' + JSON.stringify(r5));
ok(r5.contiguous === true && r5.orphansIgnored.includes('Lakshadweep'),
   '(b) island-orphan is reported in orphansIgnored and not required for connectivity');

console.log('\n================ RESULT: ' + (fail === 0 ? 'ALL-PASS' : 'FAILED') + ' ================');
process.exit(fail);
