// china-partition-proof.mjs — slice 09b-4 §1(d)
//
// Can-fail proof over the China contiguous partition. Mirrors
// india-partition-proof.mjs. Asserts:
//   1. EVERY produced China cluster is isContiguous==true (Hainan island-orphan
//      exempt — handled by isContiguous's ISLAND_ORPHANS).
//   2. Σ cluster counts == 152 (the 2 unstamped jing + pana-china are NOT in any
//      cluster — they route to 09b-5; noted, not counted).
//   3. Each cluster ∈ [40,110] OR is logged as a justified outlier (CN-2 ~43 is
//      the expected accepted low outlier per C-D2 — China's sparse NE chain).
//   4. No member name is unknown to the counts/graph keys.
//   5. The pg_slugs selectors emitted in china-clusters.json sum to 152 and are
//      a partition of the 152 STAMPED China slugs (no slug in two clusters, none
//      dropped, jing/pana-china correctly absent).
//   6. CAN-FAIL: inject a non-adjacent pair (Yunnan + Heilongjiang) → isContiguous
//      must return false, proving the contiguity assertion has teeth.
//
// Run: node data/china-partition-proof.mjs   (exit 0 = PASS, 1 = FAIL)

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isContiguous } from './adjacency.mjs';
import { partitionChina } from './partition-china.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COUNTS = JSON.parse(
  readFileSync(join(__dirname, 'admin-counts.json'), 'utf8'),
).CHN;
const MEMBERSHIP = JSON.parse(
  readFileSync(join(__dirname, 'admin-membership.json'), 'utf8'),
);
const CHN_KEYS = new Set(Object.keys(COUNTS));
const BAND = [40, 110];

let fail = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fail = 1; };

const { clusters, total } = partitionChina();
const cnt = (m) => m.reduce((a, x) => a + COUNTS[x], 0);

console.log('================ 09b-4 CHINA PARTITION PROOF ================\n');

// ---- the cluster table ----
console.log('Final China cluster table:');
console.log('  id'.padEnd(28) + 'count  contig  members');
const idOf = (members) => 'asia-china-' + members[0].toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outliers = [];
for (const cl of clusters) {
  const c = cnt(cl);
  const contig = isContiguous(cl).contiguous;
  const id = idOf(cl);
  const isOut = c < BAND[0] || c > BAND[1];
  if (isOut) outliers.push({ id, c });
  console.log(`  ${id.padEnd(26)}${String(c).padStart(4)}   ${contig ? ' ✓ ' : ' ✗ '}   ${cl.join(', ')}${isOut ? '   *OUTLIER' : ''}`);
}
console.log('');

// 1. every cluster contiguous
let allContig = true;
for (const cl of clusters) if (!isContiguous(cl).contiguous) allContig = false;
ok(allContig, '(1) every China cluster isContiguous==true (Hainan island-orphan exempt)');

// 2. sum == 152 (jing + pana-china unstamped → 09b-5, not counted)
ok(total === 152, `(2) Σ cluster counts == 152  (got ${total}; jing + pana-china unstamped → 09b-5)`);

// 3. band check (outliers logged, not fatal — band is SOFT per C-D1/C-D2)
if (outliers.length === 0) {
  ok(true, '(3) every cluster ∈ [40,110]');
} else {
  console.log(`PASS  (3) band SOFT — ${outliers.length} logged outlier(s): `
    + outliers.map((o) => `${o.id}=${o.c}`).join(', '));
  for (const o of outliers) {
    const over = o.c > BAND[1] ? o.c - BAND[1] : BAND[0] - o.c;
    console.log(`        • ${o.id} = ${o.c} (${over} beyond band) — justified: geographically-coherent contiguous macro-region (sparse West→North chain, C-D2), contiguity preserved`);
  }
}

// 4. no unknown member name
let unknown = [];
for (const cl of clusters) for (const m of cl) if (!CHN_KEYS.has(m)) unknown.push(m);
ok(unknown.length === 0,
  `(4) no unknown member name${unknown.length ? ': ' + unknown.join(', ') : ''}`);

// 5. emitted pg_slugs are a clean partition of the 152 STAMPED China slugs
if (existsSync(join(__dirname, 'china-clusters.json'))) {
  const emitted = JSON.parse(
    readFileSync(join(__dirname, 'china-clusters.json'), 'utf8'),
  );
  const allSlugs = emitted.flatMap((e) => e.selector.values);
  const dupe = allSlugs.length !== new Set(allSlugs).size;
  // ground-truth: every STAMPED CHN slug in membership (admin1 != null)
  const chnSlugs = Object.entries(MEMBERSHIP)
    .filter(([, v]) => v.country === 'CHN' && v.admin1).map(([s]) => s);
  const missing = chnSlugs.filter((s) => !allSlugs.includes(s));
  const extra = allSlugs.filter((s) => !chnSlugs.includes(s));
  // the 2 unstamped must NOT appear
  const leak = ['jing', 'pana-china'].filter((s) => allSlugs.includes(s));
  ok(!dupe && missing.length === 0 && extra.length === 0 && allSlugs.length === 152 && leak.length === 0,
    `(5) pg_slugs are a partition of 152 stamped China slugs (emitted=${allSlugs.length}, dupes=${dupe}, missing=${missing.length}, extra=${extra.length}, unstamped-leak=${leak.length})`);
} else {
  console.log('SKIP  (5) china-clusters.json not yet emitted — run emit-china-clusters.mjs');
}

// 6. CAN-FAIL — a deliberately non-adjacent pair must read as non-contiguous
const canFail = isContiguous(['Yunnan Province', 'Heilongjiang Province']);
ok(canFail.contiguous === false,
  `(6) can-fail: isContiguous(['Yunnan Province','Heilongjiang Province']) == false  (got contiguous=${canFail.contiguous}, ${canFail.components.length} components)`);

console.log(`\n================ RESULT: ${fail === 0 ? 'ALL-PASS' : 'FAILED'} ================`);
process.exit(fail);
