// emit-uncovered-clusters.mjs — slice 09b-5 §1(b,c)
//
// Consumes partitionUncovered() and emits:
//   (b) data/uncovered-clusters.json — [{ id, label, members, count, selector }]
//       The 6 country zones carry a { type:"country_codes", values:[ISO3…] }
//       selector — resolved by the EXISTING selector-evaluator + zone-geometry
//       ADM0 path (the SAME path the 13 regional `lists` use). The Scattered zone
//       carries a UNION of country_codes (USA/AND/CCK/GUF) + a pg_slugs arm for
//       the 2 unstamped CHN border PGs (jing, pana-china) so every one of the 115
//       lands in exactly one zone.
//   (c) Adds these as a NEW top-level `uncovered_lists` array in clusters.json.
//       Why a new block (NOT asia_lists): asia_lists rows are ADM1 state-clusters
//       and zone-geometry routes any id starting with `asia-` to the ADM1-listId
//       path — which has NO polygons for whole-country zones. country_codes zones
//       must flow through the ADM0 path (id NOT starting with `asia-`). A new
//       sibling array is the isolation-cleanest home: the 10 India + 2 China
//       asia_lists, 13 regional lists, deaf_lists, asia_unsolved + scalars are
//       carried through byte-for-byte (only `uncovered_lists` is added), so the
//       swap-back (delete `uncovered_lists`) reproduces md5 3aa10103 exactly.
//
// Canonical writer: IDENTICAL to emit-india-clusters.mjs §(c) —
//   writeFileSync(CLUSTERS_PATH, JSON.stringify(obj, null, 2))   (NO trailing \n)
// so the file round-trips through the india-isolation-proof canonical check.
//
// Run: node data/emit-uncovered-clusters.mjs        (writes both files)
//      node data/emit-uncovered-clusters.mjs --dry  (prints, writes nothing)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { partitionUncovered } from './partition-uncovered.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLUSTERS_PATH = join(__dirname, 'clusters.json');
const OUT_PATH = join(__dirname, 'uncovered-clusters.json');
const DRY = process.argv.includes('--dry');

// Build the selector for a zone.
//   - ALL zones carry a { type:'country_codes', values:[ISO3…] } selector — the
//     EXISTING evaluator + zone-geometry ADM0 path resolves these with ZERO
//     shared-src change (the same path the 13 regional `lists` use).
//   - The Scattered zone ALSO owns 2 admin1:null CHN border strays (jing,
//     pana-china) with no distinguishing evaluator field. They are recorded in a
//     separate `extra_slugs` array on the ENTRY (NOT a pg_slugs selector — the
//     evaluator intentionally REJECTS pg_slugs and we will not edit shared src).
//     Coverage counting + legend read `extra_slugs` directly, the SAME way
//     legend-tree.js handles the asia pg_slugs rows outside the evaluator. The
//     Scattered zone is contiguity- and geometry-EXEMPT, so the strays need no
//     ADM0 polygon.
//
// Deaf overlap: a country_codes selector also re-grabs that country's `deaf-*`
// slug (covered by the deaf A017 affinity bloc). That is the SAME design-approved
// deaf double-count from slice 08 (legend-tree.js:138) — deaf is the explicitly
// exempt/listed zone. GEOGRAPHIC coverage (the 115) stays one-slug-one-zone,
// proven in uncovered-proof.mjs.
export function zoneSelector(z) {
  return { type: 'country_codes', values: [...z.countries].sort() };
}

export function buildUncoveredEntries() {
  const { zones, total } = partitionUncovered();
  if (total !== 115) {
    throw new Error(`uncovered partition total ${total} != 115 — refusing to emit`);
  }
  const entries = zones.map((z) => ({
    id: z.id,
    label: z.label,
    count: z.count,
    contiguous: z.contiguous,
    contiguityExempt: z.contiguityExempt,
    ...(z.flag ? { flag: z.flag } : {}),
    selector: zoneSelector(z),
    // admin1:null strays with no evaluator field (Scattered's jing/pana-china).
    ...(z.slugs && z.slugs.length ? { extra_slugs: [...z.slugs].sort() } : {}),
  }));

  // sanity: ids unique, counts sum to 115, no ISO3 in two country zones.
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new Error('duplicate uncovered zone id');
  const sum = entries.reduce((a, e) => a + e.count, 0);
  if (sum !== 115) throw new Error(`emitted counts sum ${sum} != 115`);
  const seenIso = new Set();
  for (const z of zones) {
    for (const c of z.countries) {
      // CHN is intentionally NOT a country zone (its 2 strays are pg_slugs)
      if (seenIso.has(c)) throw new Error(`ISO3 ${c} appears in two zones`);
      seenIso.add(c);
    }
  }
  return entries;
}

function rewriteClusters(entries) {
  const raw = readFileSync(CLUSTERS_PATH, 'utf8');
  const obj = JSON.parse(raw);

  // FREEZE guard: refuse to run if the frozen baseline isn't what we expect.
  const india = (obj.asia_lists || []).filter((e) => e.id.startsWith('asia-india-'));
  const china = (obj.asia_lists || []).filter((e) => e.id.startsWith('asia-china-'));
  if (india.length !== 10) throw new Error(`expected 10 frozen India asia_lists, got ${india.length}`);
  if (china.length !== 2) throw new Error(`expected 2 frozen China asia_lists, got ${china.length}`);
  if ((obj.lists || []).length !== 13) throw new Error(`expected 13 frozen regional lists, got ${(obj.lists || []).length}`);
  if ((obj.deaf_lists || []).length !== 2) throw new Error(`expected 2 frozen deaf_lists, got ${(obj.deaf_lists || []).length}`);

  // ADD the new block. We store the rich entries (label/count/contiguous/flag/
  // selector) — consumers read .selector + .count just like `lists`.
  obj.uncovered_lists = entries.map((e) => ({
    id: e.id,
    label: e.label,
    count: e.count,
    contiguous: e.contiguous,
    contiguityExempt: e.contiguityExempt,
    ...(e.flag ? { flag: e.flag } : {}),
    selector: e.selector,
    ...(e.extra_slugs ? { extra_slugs: e.extra_slugs } : {}),
  }));

  return { obj, raw };
}

// Side-effecting emit (file writes) runs ONLY when invoked as a CLI — importing
// buildUncoveredEntries / zoneSelector for tests + proofs must NOT mutate disk.
function emit() {
  const entries = buildUncoveredEntries();
  const { obj } = rewriteClusters(entries);

  console.log('Uncovered zones:', entries.length);
  for (const e of entries) {
    const k = e.contiguityExempt ? 'EXEMPT' : 'contig';
    console.log(`  ${e.id.padEnd(24)} [${String(e.count).padStart(3)}] ${k}  sel=${e.selector.type}`);
  }
  console.log(`\nsum of counts = ${entries.reduce((a, e) => a + e.count, 0)} (expect 115)`);

  if (DRY) {
    console.log('\n--dry: no files written.');
  } else {
    writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2) + '\n');
    // SAME canonical writer as emit-india-clusters.mjs — no trailing newline.
    writeFileSync(CLUSTERS_PATH, JSON.stringify(obj, null, 2));
    console.log('\nwrote data/uncovered-clusters.json + added uncovered_lists to data/clusters.json');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  emit();
}
