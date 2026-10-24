// recache-full.mjs — slice 04u §1(a)
//
// The slice-01/02 cache had no rop1; the 04t recache-rop1.mjs added rop1 but NOT
// population. Per L3 ("one full-record cache, no per-slice field subsets"), this
// fetches the list endpoint ONCE with EVERY field a downstream slice needs —
// rop1 AND population AND lat/long — and writes a SINGLE full-record cache:
//
//   GET https://pray.doxa.life/api/people-groups/list
//        ?fields=slug,name,country_code,wagf_region,wagf_block,primary_language,
//                rop1,population,latitude,longitude&lang=en
//
//   ->  /tmp/upg-live-records-full.json   (NEW file; rop1 + population caches kept)
//
// `population` arrives as a FLAT STRING (e.g. "1200"); this script parses it to an
// int once at cache time so every reader gets a numeric `population` (NaN-safe → 0).
//
// Run:  node data/recache-full.mjs   [--force]
//
// Idempotent: reuses the full cache if it already carries population (offline
// re-runs); --force always re-fetches.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const FULL_API_URL =
  'https://pray.doxa.life/api/people-groups/list' +
  '?fields=slug,name,country_code,wagf_region,wagf_block,primary_language,rop1,population,latitude,longitude' +
  '&lang=en';

export const FULL_CACHE_PATH = '/tmp/upg-live-records-full.json';

// The list endpoint wraps records under `posts`; tolerate a few common shapes.
function postsOf(payload) {
  return (
    (payload && (payload.posts || payload.data || payload.records || payload.results || payload.items)) || []
  );
}

// True if the payload's first post carries BOTH rop1 AND population.
function payloadIsFull(payload) {
  const posts = postsOf(payload);
  if (!Array.isArray(posts) || posts.length === 0 || !posts[0]) return false;
  return 'rop1' in posts[0] && 'population' in posts[0];
}

// population is a flat string on the API ("1200"); parse to a clean int (NaN → 0).
export function parsePopulation(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

// Mutate each post so `population` is a parsed int (raw string preserved under
// `population_raw` for audit). Idempotent: a post already carrying an int is left.
function coercePopulations(payload) {
  for (const p of postsOf(payload)) {
    if (p == null) continue;
    if (typeof p.population === 'number') continue;
    p.population_raw = p.population ?? null;
    p.population = parsePopulation(p.population);
  }
  return payload;
}

/**
 * acquireFullPayload({ force }) -> { payload } | { skip }
 *   - reuses FULL_CACHE_PATH if present + full (rop1 + population), unless force
 *   - otherwise fetches the full endpoint, parses population to int, writes cache
 *   - on network failure with no usable cache -> { skip } (caller decides)
 */
export async function acquireFullPayload({ force = false } = {}) {
  if (!force && existsSync(FULL_CACHE_PATH)) {
    try {
      const cached = JSON.parse(readFileSync(FULL_CACHE_PATH, 'utf8'));
      if (payloadIsFull(cached)) {
        return { payload: coercePopulations(cached), source: `cache ${FULL_CACHE_PATH}` };
      }
    } catch {
      /* fall through to fetch */
    }
  }

  try {
    const res = await fetch(FULL_API_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const payload = coercePopulations(await res.json());
    if (!payloadIsFull(payload)) {
      return { skip: `fetched payload lacks rop1 or population (API did not honor &fields=)` };
    }
    try {
      writeFileSync(FULL_CACHE_PATH, JSON.stringify(payload));
    } catch (e) {
      return { payload, source: `network (cache write failed: ${e.message})` };
    }
    return { payload, source: `network -> wrote ${FULL_CACHE_PATH}` };
  } catch (e) {
    return { skip: `network unreachable and no full cache present: ${e.message}` };
  }
}

// CLI entry — run directly to (re)cache the full record set.
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  const { payload, skip, source } = await acquireFullPayload({ force });
  if (skip) {
    console.error(`[recache-full] SKIP — ${skip}`);
    process.exit(2);
  }
  const posts = postsOf(payload);
  const a017 = posts.filter((p) => (p.rop1 && (p.rop1.value ?? p.rop1)) === 'A017').length;
  const withPop = posts.filter((p) => (p.population || 0) > 0).length;
  const totalPop = posts.reduce((s, p) => s + (p.population || 0), 0);
  console.log(`[recache-full] ${source}`);
  console.log(
    `[recache-full] posts=${posts.length}  total=${payload.total}  A017(rop1)=${a017}  ` +
      `pop>0=${withPop}/${posts.length}  Σpop=${totalPop.toLocaleString()}`,
  );
  process.exit(0);
}
