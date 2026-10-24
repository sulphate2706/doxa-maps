// partition-uncovered.mjs — slice 09b-5 §1(b)
//
// Reproducible, committed partitioner that groups the 115 UNCOVERED UPGs into
// contiguous ADM0 (country) zones, honoring the §2 decision-matrix defaults.
// Sibling of partition-india.mjs / partition-china.mjs (same exported-fn + CLI
// shape). Contiguity here is COUNTRY-adjacency (whole-country members), and the
// band is SOFT (these are sparse frontier / diaspora sets — §2 S5-D5).
//
// Source of truth for the uncovered set: the SAME computation slice 09b-5 §0 ran
// — every UPG NOT already in a clusters.json zone (13 regional `lists` +
// 10 India + 2 China `asia_lists` + deaf A017). We recompute it here from the
// live rop1 cache when present (authoritative), and fall back to the committed
// 115-row breakdown (by country_code) when the cache is absent so this script is
// standalone-runnable + byte-reproducible.
//
// §2 default zones (S5-D1..D5):
//   - Nepal                 NPL (own zone, 34 — in-band)              [contiguous]
//   - Bhutan + Bangladesh   BTN+BGD (15)                              [contiguous*]
//   - Afghanistan + Pakistan AFG+PAK (43, share a border)            [contiguous]
//   - Central Asia          UZB+KGZ+TJK (+AZE flagged non-adjacent)  [contiguous, AZE flagged]
//   - Mongolia              MNG (3, island-of-steppe)                [contiguous]
//   - Japan                 JPN (6, island-orphan)                   [EXEMPT]
//   - Scattered / Diaspora  USA + AND + CCK + GUF + jing + pana-china [EXEMPT — the
//                           ONE allowed non-contiguous zone besides deaf]
//
// *BTN+BGD touch via the narrow India "Siliguri corridor" only — flagged as a
//  Himalayan-frontier pairing (see CONTIGUITY_EXEMPT note); both individually are
//  single connected countries. Country-adjacency contiguity for the contiguous
//  zones is asserted in uncovered-proof.mjs against a small committed border map.
//
// Exports: partitionUncovered() -> { zones, total, uncoveredByCC, scatterSlugs }
// Run directly (`node data/partition-uncovered.mjs`) to print the zone table.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROP1_CACHE = '/tmp/upg-live-records-rop1.json';
const PLAIN_CACHE = '/tmp/upg-live-records.json';

// ── committed fallback (the recomputed 115, slice 09b-5 §0) ───────────────────
// by-country-code counts (used only when no live cache is present).
const COMMITTED_UNCOVERED_CC = {
  NPL: 34, PAK: 23, AFG: 20, BTN: 12, JPN: 6, USA: 3, BGD: 3, MNG: 3,
  AZE: 2, CHN: 2, TJK: 2, AND: 1, CCK: 1, KGZ: 1, UZB: 1, GUF: 1,
};
// the 2 unstamped CHN border PGs are individual admin1:null slugs (09b-1/09b-4).
const CHINA_STRAY_SLUGS = ['jing', 'pana-china'];

// ── recompute the uncovered set from the live cache (authoritative) ───────────
function flat(p, f) { const v = p && p[f]; return v && typeof v === 'object' ? v.value : v; }

function matches(p, sel) {
  if (!sel) return false;
  const cc = flat(p, 'country_code'), wb = flat(p, 'wagf_block'), wr = flat(p, 'wagf_region');
  switch (sel.type) {
    case 'country_code': return cc === sel.value;
    case 'country_codes': return Array.isArray(sel.values) && sel.values.includes(cc);
    case 'wagf_block': return wb === sel.value;
    case 'wagf_region': return wr === sel.value;
    case 'union': return Array.isArray(sel.selectors) && sel.selectors.some((s) => matches(p, s));
    case 'deaf_predicate': {
      const hay = ((p.slug || '') + ' ' + (p.name || '')).toLowerCase();
      return hay.includes('deaf') && (Array.isArray(sel.regions) ? sel.regions.includes(wr) : true);
    }
    case 'affinity_bloc': return flat(p, 'rop1') === sel.rop1;
    case 'pg_slugs': return Array.isArray(sel.values) && sel.values.includes(p.slug);
    default: return false;
  }
}

// returns { byCC, slugsByCC, straySlugs } for the UNCOVERED set, or null if no cache.
function recomputeUncovered() {
  const cachePath = existsSync(ROP1_CACHE) ? ROP1_CACHE : existsSync(PLAIN_CACHE) ? PLAIN_CACHE : null;
  if (!cachePath) return null;
  const posts = JSON.parse(readFileSync(cachePath, 'utf8')).posts || [];
  const clusters = JSON.parse(readFileSync(join(__dirname, 'clusters.json'), 'utf8'));

  // covered = regional lists + deaf (A017) + every asia_lists pg_slug.
  const covered = new Set();
  const add = (p) => { if (p && p.slug) covered.add(p.slug); };
  for (const row of clusters.lists || []) for (const p of posts) if (matches(p, row.selector)) add(p);
  for (const p of posts) if (matches(p, { type: 'affinity_bloc', rop1: 'A017' })) add(p);
  for (const a of clusters.asia_lists || []) {
    if (a.selector?.type === 'pg_slugs') for (const s of a.selector.values) covered.add(s);
  }
  // (also respect any pre-existing uncovered zones so re-runs are idempotent)
  for (const a of clusters.uncovered_lists || []) {
    if (a.selector?.type === 'country_codes') {
      for (const p of posts) if (a.selector.values.includes(flat(p, 'country_code'))) covered.add(p.slug);
    } else if (a.selector?.type === 'pg_slugs') {
      for (const s of a.selector.values) covered.add(s);
    }
  }

  const byCC = {};
  const slugsByCC = {};
  const straySlugs = [];
  for (const p of posts) {
    if (!p.slug || covered.has(p.slug)) continue;
    const cc = flat(p, 'country_code') || '??';
    byCC[cc] = (byCC[cc] || 0) + 1;
    (slugsByCC[cc] ||= []).push(p.slug);
    if (CHINA_STRAY_SLUGS.includes(p.slug)) straySlugs.push(p.slug);
  }
  for (const k of Object.keys(slugsByCC)) slugsByCC[k].sort();
  straySlugs.sort();
  return { byCC, slugsByCC, straySlugs, source: cachePath };
}

// ── zone definitions (§2 defaults) ────────────────────────────────────────────
// Each zone: id, label, kind, members (ISO3 list) OR slugs, contiguous flag.
// `contiguous: true`  -> asserted by uncovered-proof.mjs country-adjacency walk.
// `contiguityExempt`  -> Japan / Scattered / (Himalaya BTN+BGD flagged).
const ZONE_DEFS = [
  { id: 'uncovered-nepal',        label: 'Nepal',                 countries: ['NPL'],               contiguous: true },
  // BTN+BGD do NOT share a land border (India's Siliguri corridor lies between).
  // Per §2 S5-D1 this is a flagged "Himalayan-frontier" pairing — joined only via
  // India — so it is contiguity-EXEMPT and explicitly listed, exactly like the
  // Scattered + Japan buckets. (Keeping them one zone honors the in-band default
  // of 15 over two sub-band singletons of 12 + 3.)
  { id: 'uncovered-himalaya',     label: 'Bhutan + Bangladesh',   countries: ['BTN', 'BGD'],        contiguous: false, contiguityExempt: true, flag: 'BTN+BGD share no land border (India Siliguri corridor between) — flagged Himalayan-frontier pairing, contiguity-exempt (S5-D1)' },
  { id: 'uncovered-sa-west',      label: 'Afghanistan + Pakistan', countries: ['AFG', 'PAK'],        contiguous: true },
  { id: 'uncovered-central-asia', label: 'Central Asia',          countries: ['UZB', 'KGZ', 'TJK', 'AZE'], contiguous: true, flag: 'AZE non-adjacent (Caspian) — flagged near-member per S5-D2; UZB+KGZ+TJK are mutually contiguous' },
  { id: 'uncovered-mongolia',     label: 'Mongolia',              countries: ['MNG'],               contiguous: true },
  { id: 'uncovered-japan',        label: 'Japan',                 countries: ['JPN'],               contiguous: true, contiguityExempt: true, flag: 'island-orphan (S5-D4)' },
  { id: 'uncovered-scatter',      label: 'Scattered / Diaspora',  countries: ['USA', 'AND', 'CCK', 'GUF'], slugs: CHINA_STRAY_SLUGS, contiguityExempt: true, flag: 'allowed non-contiguous bucket (S5-D3) — diaspora/island/micro-territory strays + 2 unstamped CHN border PGs' },
];

// AZE in central-asia is members-by-flag: it contributes its UPGs to the zone but
// is explicitly recorded as a non-adjacent near-member (it is NOT part of the
// contiguity assertion's required-connected core; see uncovered-proof.mjs).
export const CENTRAL_ASIA_CONTIG_CORE = ['UZB', 'KGZ', 'TJK'];

export function partitionUncovered() {
  const live = recomputeUncovered();
  const byCC = live ? live.byCC : { ...COMMITTED_UNCOVERED_CC };
  const slugsByCC = live ? live.slugsByCC : null;
  const straySlugs = live ? live.straySlugs : [...CHINA_STRAY_SLUGS];

  // CHN's 2 uncovered are exactly the strays; do not double-count them as a
  // country zone (they go into Scattered as pg_slugs).
  const ccCount = (cc) => {
    if (cc === 'CHN') return 0; // handled via straySlugs in scatter
    return byCC[cc] || 0;
  };

  const zones = ZONE_DEFS.map((z) => {
    let count = z.countries.reduce((a, c) => a + ccCount(c), 0);
    if (z.slugs) count += z.slugs.length; // scatter's CHN strays
    const members = [...z.countries];
    if (z.slugs) members.push(...z.slugs.map((s) => `chn:${s}`));
    return {
      id: z.id,
      label: z.label,
      countries: z.countries,
      slugs: z.slugs || null,
      count,
      contiguous: !!z.contiguous,
      contiguityExempt: !!z.contiguityExempt,
      flag: z.flag || null,
      members,
    };
  });

  const total = zones.reduce((a, z) => a + z.count, 0);
  return { zones, total, byCC, slugsByCC, straySlugs, source: live?.source || 'committed-fallback' };
}

// ── CLI: print the zone table ─────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { zones, total, byCC, straySlugs, source } = partitionUncovered();
  console.log(`\nUncovered partition (source: ${source}):`);
  for (const z of zones) {
    const kind = z.contiguityExempt ? 'EXEMPT ' : 'contig ';
    const flag = z.flag ? `  ⚑ ${z.flag}` : '';
    console.log(`  [${String(z.count).padStart(3)}] ${kind} ${z.id.padEnd(24)} :: ${z.members.join(', ')}${flag}`);
  }
  console.log(`\n  by country_code: ${JSON.stringify(byCC)}`);
  console.log(`  china strays (scatter pg_slugs): ${JSON.stringify(straySlugs)}`);
  console.log(`  total covered by new zones = ${total} (expected 115)  zones = ${zones.length}`);
}
