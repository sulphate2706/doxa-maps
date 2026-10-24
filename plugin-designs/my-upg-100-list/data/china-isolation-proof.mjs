// china-isolation-proof.mjs — slice 09b-4 §1(c/d) isolation guarantee (L12 gold)
//
// Proves that the clusters.json rewrite touched ONLY the China asia_lists block
// and left every frozen section — the 10 India asia_lists entries (just set by
// 09b-3), the 13 regional lists, deaf_lists, asia_unsolved, uncovered_scatter,
// asia_solved_validation, and the top-level scalars — byte-identical.
//
// SWAP-BACK reconstruction (the gold-standard proof):
//   Take the LIVE clusters.json (China block now rewritten by 09b-4), revert ONLY
//   its China asia_lists entries to the VERBATIM PRE-09b-4 originals
//   (data/china-original-pre-09b-4.json), re-stringify with the SAME canonical
//   writer 09b-3 used (`JSON.stringify(obj, null, 2)`, no trailing newline), and
//   assert the md5 returns to 3b7ea66f6dcb3a4d2903ce5427dece89 EXACTLY. If the
//   India block (or any other frozen section) had drifted by even one byte, the
//   swap-back could not reproduce the original hash. Reproducing it proves India
//   + 13 regional + deaf + everything-else are untouched.
//
// Plus structural assertions (mirrors india-isolation-proof.mjs §B).
//
// Run: node data/china-isolation-proof.mjs   (exit 0 = PASS)

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLUSTERS = join(__dirname, 'clusters.json');
const ORIGINAL_CHINA = join(__dirname, 'china-original-pre-09b-4.json');

// (C) swap-back: revert the China asia_lists to their verbatim pre-09b-4 originals
// and re-serialise. Pre-v2 this reproduced 3b7ea66f (India frozen + China reverted).
// 09b-asia-contiguity-v2 re-cut the India asia_lists too, so the reconstructed file
// (v2-India + pre-09b-4-China, uncovered dropped) now hashes to the value below.
// The China-only-isolation invariant this guarded is now also covered by the
// india/china PARTITION proofs (855/152 conserved) + apply-grouping's per-zone
// swap-back; this md5 rolls forward to keep the structural can-fail alive.
const PRE_09B4_MD5 = 'e60cb95608a00cdb869f0a8e825e8ec9';
const PRE_V2_PRE_09B4_MD5 = '3b7ea66f6dcb3a4d2903ce5427dece89'; // historical (pre-asia-contiguity-v2)

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail = 1; };
const md5 = (s) => createHash('md5').update(s).digest('hex');

console.log('================ 09b-4 clusters.json ISOLATION PROOF (swap-back) ================\n');

const raw = readFileSync(CLUSTERS, 'utf8');
const obj = JSON.parse(raw);

// ---- A) writer is canonical (round-trip byte-identical, no trailing newline) ----
const canonical = JSON.stringify(JSON.parse(raw), null, 2);
ok(raw === canonical,
  '(A) live clusters.json is canonical `JSON.stringify(...,null,2)` (no formatting drift; frozen sub-trees serialize identically)');

// ---- B) structural: frozen sections intact, China rewritten ----
ok(obj.lists.length === 13, `(B1) exactly 13 regional lists  (got ${obj.lists.length})`);
ok(obj.deaf_lists.length === 2, `(B2) exactly 2 deaf_lists  (got ${obj.deaf_lists.length})`);

const ids = obj.asia_lists.map((e) => e.id);
const india = obj.asia_lists.filter((e) => e.id.startsWith('asia-india-'));
const china = obj.asia_lists.filter((e) => e.id.startsWith('asia-china-'));
ok(india.length === 10, `(B3) 10 India asia_lists entries (frozen)  (got ${india.length})`);
ok(china.length === 2, `(B4) 2 China asia_lists entries (rewritten)  (got ${china.length})`);

// India entries positionally FIRST, China LAST (India frozen in place, China at tail)
const firstTen = ids.slice(0, 10);
const lastTwo = ids.slice(-2);
ok(firstTen.every((i) => i.startsWith('asia-india-')),
  '(B5) the 10 India entries are positionally first (frozen block intact)');
ok(lastTwo.every((i) => i.startsWith('asia-china-')),
  `(B6) China entries are positionally last  (tail: ${lastTwo.join(', ')})`);

// New China ids / ADM1-slug-counts — the China geometry-partition baseline.
// `expectSlugs` is the China ADM1 pg_slug count (the isolation invariant: the 152
// China slugs stay partitioned China-only). 09b-asia-contiguity-v2 made NAS-B a
// cross-border zone: its DISPLAYED count rolls in extraCountryCodes [MNG,PRK,JPN]
// (43 + 3 + 1 + 6 = 53), but its `selector.values` is still 43 China-only slugs —
// so the China partition is unchanged. We assert on the slug count (geometry) and
// allow the displayed count to differ by exactly the extra-country roll-in.
const expectSlugs = {
  'asia-china-yunnan-province': 109,
  'asia-china-tibet-autonomous-region': 43,
};
const COUNTRY_PG = { MNG: 3, PRK: 1, JPN: 6 }; // membership totals for the v2 NAS-B extras
let chinaOk = true;
for (const e of china) {
  const want = expectSlugs[e.id];
  if (want === undefined) { chinaOk = false; console.log(`        unexpected China id ${e.id}`); continue; }
  const extraRoll = (e.extraCountryCodes || []).reduce((a, cc) => a + (COUNTRY_PG[cc] || 0), 0);
  if (e.selector.values.length !== want || e.count !== want + extraRoll) {
    chinaOk = false;
    console.log(`        ${e.id} count=${e.count} slugs=${e.selector.values.length} expected slugs=${want} count=${want + extraRoll}`);
  }
}
ok(chinaOk, '(B7) China entries match the geometry baseline (Yunnan=109 slugs; Tibet=43 slugs, displayed 53 w/ MNG+PRK+JPN cross-border; Σ ADM1 slugs=152)');

// the 2 unstamped must NOT appear in any China selector
const allChinaSlugs = china.flatMap((e) => e.selector.values);
const leak = ['jing', 'pana-china'].filter((s) => allChinaSlugs.includes(s));
ok(leak.length === 0, `(B8) jing + pana-china absent from China clusters (→ 09b-5)  (leaked=${leak.length})`);

// no stray asia_lists entry
const stray = obj.asia_lists.filter(
  (e) => !e.id.startsWith('asia-india-') && !e.id.startsWith('asia-china-'),
);
ok(stray.length === 0, `(B9) no stray asia_lists entries  (got ${stray.length})`);

// other frozen sections present
ok(typeof obj.asia_unsolved === 'object' && obj.asia_unsolved.south_asia_india_only === 855,
  '(B10) asia_unsolved present & unchanged (india_only==855)');
ok(typeof obj.uncovered_scatter === 'object', '(B11) uncovered_scatter present');
ok(obj.version === 1 && obj.source_total === 2106,
  '(B12) top-level scalars unchanged (version==1, source_total==2106)');

// ---- C) SWAP-BACK — revert China to verbatim originals, reproduce 3b7ea66f ----
console.log('');
const liveMd5 = md5(raw);
console.log(`     live (post-09b-4) clusters.json md5 = ${liveMd5}`);

const originalChina = JSON.parse(readFileSync(ORIGINAL_CHINA, 'utf8'));
const swapped = JSON.parse(raw); // structural clone of the live object
// rebuild asia_lists = India entries (untouched) + verbatim original China entries
const indiaLive = swapped.asia_lists.filter((e) => e.id.startsWith('asia-india-'));
swapped.asia_lists = [...indiaLive, ...originalChina];
// "PRE-09b-4" also predates any LATER-slice sibling block. 09b-5 added a
// top-level `uncovered_lists` array; drop it here so this swap-back keeps meaning
// "revert to before 09b-4" (which is before 09b-5 too). 09b-5's OWN swap-back
// (uncovered-proof.mjs) proves uncovered_lists → 3aa10103 independently.
delete swapped.uncovered_lists;

// SAME canonical writer 09b-3 used: JSON.stringify(obj, null, 2), no trailing nl
const reconstructed = JSON.stringify(swapped, null, 2);
const reconMd5 = md5(reconstructed);
console.log(`     swap-back (China reverted) clusters.json md5 = ${reconMd5}`);
console.log(`     target PRE-09b-4 md5                        = ${PRE_09B4_MD5}`);

ok(reconMd5 === PRE_09B4_MD5,
  `(C) swap-back reproduces PRE-09b-4 md5 ${PRE_09B4_MD5} → India + 13 regional + deaf + all else untouched`);

console.log(`\n================ RESULT: ${fail === 0 ? 'ALL-PASS' : 'FAILED'} ================`);
process.exit(fail);
