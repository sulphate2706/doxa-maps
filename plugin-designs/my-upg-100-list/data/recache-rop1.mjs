// recache-rop1.mjs — slice 04t §1(h)
//
// The slice-01/02 cache (/tmp/upg-live-records.json) was fetched WITHOUT `rop1`,
// so the new affinity_bloc/A017 (deaf) selector cannot be evaluated against it.
// This script re-fetches the SAME endpoint with `rop1` ADDED to &fields= and
// writes a NEW cache file so the original cache is NOT clobbered.
//
//   GET https://pray.doxa.life/api/people-groups/list
//        ?fields=slug,name,country_code,wagf_region,wagf_block,primary_language,rop1&lang=en
//
//   ->  /tmp/upg-live-records-rop1.json   (NEW file; original cache preserved)
//
// Run:  node data/recache-rop1.mjs
//
// Idempotent: if the rop1 cache already exists AND carries rop1, it is reused
// (offline re-runs). Pass --force to always re-fetch.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const ROP1_API_URL =
  'https://pray.doxa.life/api/people-groups/list' +
  '?fields=slug,name,country_code,wagf_region,wagf_block,primary_language,rop1&lang=en';

export const ROP1_CACHE_PATH = '/tmp/upg-live-records-rop1.json';

// True if the payload's first post carries a non-null rop1 field.
function payloadHasRop1(payload) {
  const posts =
    (payload && (payload.posts || payload.data || payload.records || payload.results || payload.items)) || [];
  return Array.isArray(posts) && posts.length > 0 && posts[0] && 'rop1' in posts[0];
}

/**
 * acquireRop1Payload({ force }) -> { payload } | { skip }
 *   - reuses ROP1_CACHE_PATH if present + rop1-bearing (unless force)
 *   - otherwise fetches the rop1 endpoint and writes the NEW cache
 *   - on network failure with no usable cache -> { skip } (caller decides)
 */
export async function acquireRop1Payload({ force = false } = {}) {
  if (!force && existsSync(ROP1_CACHE_PATH)) {
    try {
      const cached = JSON.parse(readFileSync(ROP1_CACHE_PATH, 'utf8'));
      if (payloadHasRop1(cached)) {
        return { payload: cached, source: `cache ${ROP1_CACHE_PATH}` };
      }
    } catch {
      /* fall through to fetch */
    }
  }

  try {
    const res = await fetch(ROP1_API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const payload = await res.json();
    if (!payloadHasRop1(payload)) {
      return { skip: `fetched payload still lacks rop1 (API did not honor &fields=rop1)` };
    }
    try {
      writeFileSync(ROP1_CACHE_PATH, JSON.stringify(payload));
    } catch (e) {
      // continue in-memory if /tmp is unwritable
      return { payload, source: `network (cache write failed: ${e.message})` };
    }
    return { payload, source: `network -> wrote ${ROP1_CACHE_PATH}` };
  } catch (e) {
    return { skip: `network unreachable and no rop1 cache present: ${e.message}` };
  }
}

// CLI entry — run directly to (re)cache.
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  const { payload, skip, source } = await acquireRop1Payload({ force });
  if (skip) {
    console.error(`[recache-rop1] SKIP — ${skip}`);
    process.exit(2);
  }
  const posts = payload.posts || payload.data || [];
  const a017 = posts.filter((p) => (p.rop1 && (p.rop1.value ?? p.rop1)) === 'A017').length;
  console.log(`[recache-rop1] ${source}`);
  console.log(`[recache-rop1] posts=${posts.length}  total=${payload.total}  A017(rop1)=${a017}`);
  process.exit(0);
}
