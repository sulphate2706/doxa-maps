// evaluator.test.mjs — empirical proof for the selector evaluator (slice 01)
//
// qa §1 item 4 + A3: evaluate every committed list selector against the LIVE 2106
// records and assert the resulting slug-set SIZE equals the committed count.
//
// Run from the slice root:   node data/evaluator.test.mjs
//
// Behaviour:
//   - loads data/clusters.json (the 13 regional `lists` + 2 `deaf_lists`)
//   - fetches the 2106 live records ONCE; caches to /tmp/upg-live-records.json
//     so re-runs are offline. If the network is unreachable AND no cache exists,
//     SKIP loudly (exit 0) rather than failing falsely.
//   - normalizes via normalize.js, evaluates each selector, asserts size == count
//     within tolerance S1-D3 (exact expected; allow ±2 and LOG the delta).
//   - NEGATIVE tests: bogus country_code "ZZZ" -> empty Set (no crash);
//     unknown selector type -> throws.
//   - prints PASS/FAIL per list + a final summary; process.exit(failures ? 1 : 0).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { evaluate } from './selector-evaluator.js';
import { loadRecords } from './normalize.js';
import { acquireRop1Payload } from './recache-rop1.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CLUSTERS_PATH = join(__dirname, 'clusters.json');
const CACHE_PATH = '/tmp/upg-live-records.json';
const API_URL =
  'https://pray.doxa.life/api/people-groups/list' +
  '?fields=slug,name,country_code,wagf_region,wagf_block,primary_language&lang=en';
const TOLERANCE = 2; // S1-D3: exact expected; allow ±2 and LOG the delta.

// ---------------------------------------------------------------------------
// Live data acquisition (fetch once, cache to /tmp, offline on re-run).
// Returns { payload } on success, or { skip: <reason> } if unreachable + no cache.
// ---------------------------------------------------------------------------
async function acquirePayload() {
  if (existsSync(CACHE_PATH)) {
    try {
      const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
      console.log(`[cache] using ${CACHE_PATH}`);
      return { payload: cached };
    } catch (e) {
      console.log(`[cache] ${CACHE_PATH} unreadable (${e.message}); re-fetching`);
    }
  }

  try {
    console.log(`[fetch] GET ${API_URL}`);
    const res = await fetch(API_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const payload = await res.json();
    try {
      writeFileSync(CACHE_PATH, JSON.stringify(payload));
      console.log(`[cache] wrote ${CACHE_PATH}`);
    } catch (e) {
      console.log(`[cache] could not write cache (${e.message}); continuing in-memory`);
    }
    return { payload };
  } catch (e) {
    return { skip: `network unreachable and no cache present: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
async function main() {
  const clusters = JSON.parse(readFileSync(CLUSTERS_PATH, 'utf8'));

  const { payload, skip } = await acquirePayload();
  if (skip) {
    console.log('');
    console.log('========================================================');
    console.log(`SKIP — ${skip}`);
    console.log('(not a failure: no live data and no cache to test against)');
    console.log('========================================================');
    process.exit(0);
  }

  const records = loadRecords(payload);
  console.log(`[data] normalized ${records.length} records (expected source_total ${clusters.source_total})`);
  console.log('');

  let failures = 0;
  let passes = 0;
  const deltas = [];

  // The 13 regional lists (count) + the 2 deaf lists (expected_count).
  const regional = (clusters.lists || []).map((l) => ({ ...l, expected: l.count, kind: 'list' }));
  const deaf = (clusters.deaf_lists || []).map((l) => ({ ...l, expected: l.expected_count, kind: 'deaf' }));
  const allLists = [...regional, ...deaf];

  console.log(`--- ${allLists.length} lists (${regional.length} regional + ${deaf.length} deaf) ---`);
  for (const list of allLists) {
    let actual;
    try {
      actual = evaluate(list.selector, records).size;
    } catch (e) {
      console.log(`FAIL  ${list.id.padEnd(34)} threw: ${e.message}`);
      failures++;
      continue;
    }
    const expected = list.expected;
    const delta = actual - expected;
    const within = Math.abs(delta) <= TOLERANCE;
    const exact = delta === 0;

    const tag = exact ? 'PASS' : within ? 'PASS~' : 'FAIL';
    const deltaStr = delta === 0 ? '' : ` (Δ${delta > 0 ? '+' : ''}${delta} vs expected ${expected})`;
    console.log(
      `${tag.padEnd(5)} ${list.id.padEnd(34)} actual=${String(actual).padStart(4)}  expected=${String(expected).padStart(4)}${deltaStr}`,
    );

    if (within) {
      passes++;
      if (delta !== 0) deltas.push(`${list.id}: Δ${delta > 0 ? '+' : ''}${delta} (live drift within ±${TOLERANCE})`);
    } else {
      failures++;
    }
  }

  // -------------------------------------------------------------------------
  // NEGATIVE tests.
  // -------------------------------------------------------------------------
  console.log('');
  console.log('--- negative tests ---');

  // N1: bogus country_code value -> empty Set, no crash.
  try {
    const empty = evaluate({ type: 'country_code', value: 'ZZZ' }, records);
    if (empty instanceof Set && empty.size === 0) {
      console.log('PASS  bogus country_code "ZZZ" -> empty Set (no crash)');
      passes++;
    } else {
      console.log(`FAIL  bogus country_code "ZZZ" -> size ${empty.size} (expected 0)`);
      failures++;
    }
  } catch (e) {
    console.log(`FAIL  bogus country_code "ZZZ" threw instead of empty Set: ${e.message}`);
    failures++;
  }

  // N2: unknown selector type -> throws.
  try {
    evaluate({ type: 'pg_slugs', values: ['x'] }, records);
    console.log('FAIL  unknown selector type "pg_slugs" did NOT throw (expected Error)');
    failures++;
  } catch (e) {
    console.log(`PASS  unknown selector type throws: ${e.message.split('(')[0].trim()}`);
    passes++;
  }

  // N3: malformed selector (no type) -> throws.
  try {
    evaluate({ value: 'x' }, records);
    console.log('FAIL  malformed selector (no type) did NOT throw (expected Error)');
    failures++;
  } catch (e) {
    console.log('PASS  malformed selector (no type) throws');
    passes++;
  }

  // -------------------------------------------------------------------------
  // slice 04t §1g — Deaf affinity-bloc (A017) against the rop1-bearing cache.
  //   - reads the NEW rop1 cache (/tmp/upg-live-records-rop1.json) via recache-rop1.mjs
  //   - asserts affinity_bloc/A017 size === 123
  //   - asserts ZERO DELTA vs the old deaf_predicate slug set (union of both deaf_lists)
  // -------------------------------------------------------------------------
  console.log('');
  console.log('--- slice 04t: deaf affinity_bloc (A017) ---');
  const { payload: rop1Payload, skip: rop1Skip, source: rop1Source } = await acquireRop1Payload();
  if (rop1Skip) {
    console.log(`FAIL  rop1 cache unavailable: ${rop1Skip}`);
    console.log('      (re-run: node data/recache-rop1.mjs --force)');
    failures++;
  } else {
    console.log(`[rop1] ${rop1Source}`);
    // loadRecords flattens NESTED_FIELDS (country_code, …) but leaves rop1 nested,
    // which is exactly what the affinity_bloc selector reads (.rop1.value).
    const rop1Records = loadRecords(rop1Payload);

    // (1) A017 size === 123
    const a017 = evaluate({ type: 'affinity_bloc', rop1: 'A017' }, rop1Records);
    if (a017.size === 123) {
      console.log(`PASS  affinity_bloc/A017 -> 123 PGs (got ${a017.size})`);
      passes++;
    } else {
      console.log(`FAIL  affinity_bloc/A017 -> expected 123, got ${a017.size}`);
      failures++;
    }

    // (2) ZERO DELTA vs the old deaf_predicate slug set (union of both deaf_lists).
    const oldDeaf = new Set();
    for (const dl of clusters.deaf_lists || []) {
      for (const slug of evaluate(dl.selector, rop1Records)) oldDeaf.add(slug);
    }
    const onlyNew = [...a017].filter((s) => !oldDeaf.has(s));
    const onlyOld = [...oldDeaf].filter((s) => !a017.has(s));
    if (onlyNew.length === 0 && onlyOld.length === 0) {
      console.log(`PASS  zero-delta: A017 set === old deaf_predicate set (both ${oldDeaf.size})`);
      passes++;
    } else {
      console.log(
        `FAIL  delta vs old deaf_predicate: A017-only=${onlyNew.length} ${JSON.stringify(onlyNew.slice(0, 5))} ` +
          `old-only=${onlyOld.length} ${JSON.stringify(onlyOld.slice(0, 5))}`,
      );
      failures++;
    }
  }

  // -------------------------------------------------------------------------
  // Summary.
  // -------------------------------------------------------------------------
  console.log('');
  if (deltas.length) {
    console.log('logged deltas (live drift, within tolerance):');
    for (const d of deltas) console.log(`  - ${d}`);
    console.log('');
  }
  console.log('========================================================');
  console.log(`SUMMARY: ${passes} passed, ${failures} failed  (tolerance ±${TOLERANCE}, ${deltas.length} within-tolerance deltas)`);
  console.log('========================================================');

  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('UNEXPECTED ERROR:', e);
  process.exit(1);
});
