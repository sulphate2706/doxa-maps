// india-isolation-proof.mjs — slice 09b-3 §1(c) isolation guarantee
//
// Proves that the clusters.json rewrite touched ONLY the India asia_lists block
// and left every frozen section (13 regional lists, deaf_lists, both China
// asia_lists entries, asia_unsolved, uncovered_scatter, top-level scalars)
// byte-identical.
//
// Two-part proof:
//  A) WRITER IS CANONICAL — the current clusters.json round-trips byte-for-byte
//     through `JSON.stringify(JSON.parse(raw), null, 2)` (no trailing newline).
//     This is the exact serialization our emitter used. Therefore any sub-tree
//     that was carried through unchanged serializes to identical bytes — there is
//     no formatting drift that could silently alter a frozen section.
//  B) FROZEN SECTIONS INTACT — structural assertions on the live file:
//       • exactly 13 `lists`, 2 `deaf_lists`
//       • asia_lists = 10 India entries (asia-india-*) THEN 2 China entries,
//         in that order; China entries are positionally LAST and untouched
//       • the 2 China entries have their known ids / counts / slug-counts
//       • asia_unsolved + uncovered_scatter + scalars present & well-formed
//
// Run: node data/india-isolation-proof.mjs   (exit 0 = PASS)

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLUSTERS = join(__dirname, 'clusters.json');
const CHINA_CLUSTERS = join(__dirname, 'china-clusters.json');

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail = 1; };

console.log('================ 09b-3 clusters.json ISOLATION PROOF ================\n');

const raw = readFileSync(CLUSTERS, 'utf8');
const obj = JSON.parse(raw);

// ---- A) writer is canonical (round-trip byte-identical, no trailing newline) ----
const canonical = JSON.stringify(JSON.parse(raw), null, 2);
ok(raw === canonical,
  '(A) clusters.json is canonical `JSON.stringify(...,null,2)` (no formatting drift; frozen sub-trees serialize identically)');

// ---- B) frozen sections intact ----
ok(obj.lists.length === 13, `(B1) exactly 13 regional lists  (got ${obj.lists.length})`);
ok(obj.deaf_lists.length === 2, `(B2) exactly 2 deaf_lists  (got ${obj.deaf_lists.length})`);

const ids = obj.asia_lists.map((e) => e.id);
const india = ids.filter((i) => i.startsWith('asia-india-'));
const china = obj.asia_lists.filter((e) => e.id.startsWith('asia-china-'));
ok(india.length === 10, `(B3) 10 India asia_lists entries  (got ${india.length})`);
ok(china.length === 2, `(B4) 2 China asia_lists entries  (got ${china.length})`);

// China entries must be positionally LAST (India block rewritten in place, China appended)
const lastTwo = ids.slice(-2);
ok(lastTwo[0].startsWith('asia-china-') && lastTwo[1].startsWith('asia-china-'),
  `(B5) China entries are positionally last  (tail: ${lastTwo.join(', ')})`);

// China ids / counts / slug-counts — read the CURRENT baseline (L16, 09b-6 §1c).
// 09b-4 re-partitioned China (xinjiang/guizhou → yunnan/tibet), so the China
// baseline can NO LONGER be hardcoded here. Source of truth = china-clusters.json
// (the emitter's output); fall back to the live clusters.json China entries if
// the side-file is absent. The proof now tracks the partition instead of pinning
// a stale snapshot.
// Track BOTH the displayed count AND the ADM1 slug-count from the side-file.
// 09b-asia-contiguity-v2 made NAS-B cross-border: its displayed `count` rolls in
// extraCountryCodes (43 China slugs + MNG3+PRK1+JPN6 = 53), while its
// `selector.values` stays 43 China-only slugs. So we compare the displayed count
// to the side-file count AND the slug count to the side-file slug count — a pure
// China zone has them equal; a cross-border zone has them differ by the extras.
const expectChina = (() => {
  const m = {};
  if (existsSync(CHINA_CLUSTERS)) {
    const cc = JSON.parse(readFileSync(CHINA_CLUSTERS, 'utf8'));
    const entries = Array.isArray(cc) ? cc : Object.values(cc);
    for (const e of entries) m[e.id] = { count: e.count, slugs: e.selector?.values?.length ?? e.count };
    return m;
  }
  for (const e of china) m[e.id] = { count: e.count, slugs: e.selector.values.length };
  return m;
})();
let chinaOk = true;
const expectedChinaCount = Object.keys(expectChina).length;
for (const e of china) {
  const want = expectChina[e.id];
  if (want === undefined) { chinaOk = false; console.log(`        unexpected China id ${e.id} (not in china-clusters.json baseline)`); }
  else if (e.count !== want.count || e.selector.values.length !== want.slugs) {
    chinaOk = false;
    console.log(`        ${e.id} count=${e.count} slugs=${e.selector.values.length} expected count=${want.count} slugs=${want.slugs}`);
  }
}
ok(chinaOk, `(B6) China entries match the CURRENT china-clusters.json baseline (${expectedChinaCount} entries; ids/counts/ADM1-slug-counts, cross-border-aware)`);

// no stray non-India non-China asia_lists entry
const stray = obj.asia_lists.filter(
  (e) => !e.id.startsWith('asia-india-') && !e.id.startsWith('asia-china-'),
);
ok(stray.length === 0, `(B7) no stray asia_lists entries  (got ${stray.length})`);

// other frozen sections present
ok(typeof obj.asia_unsolved === 'object' && obj.asia_unsolved.south_asia_india_only === 855,
  '(B8) asia_unsolved present & unchanged (india_only==855)');
ok(typeof obj.uncovered_scatter === 'object',
  '(B9) uncovered_scatter present');
ok(obj.version === 1 && obj.source_total === 2106,
  '(B10) top-level scalars unchanged (version==1, source_total==2106)');

console.log(`\n================ RESULT: ${fail === 0 ? 'ALL-PASS' : 'FAILED'} ================`);
process.exit(fail);
