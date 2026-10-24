// pop-proof.mjs — slice 04u §1(d) runnable, can-fail empirical proof
//
//   node data/pop-proof.mjs
//
// Asserts (population column — the data layer; build-emit + sibling md5 live in
// proof.sh, the bash wrapper):
//   (1) all 26 legend nodes (13 region + deaf + asia parent/India/China + 12 asia
//       leaves) carry a numeric `pop` > 0.
//   (2) for 3 spot-checked zones, node.pop EQUALS the population independently
//       re-summed from that zone's member records (a wrong field access → pop
//       0/NaN → this FAILS loudly). This is the can-fail check.
//   (3) parent roll-up: asia.pop === India.pop + China.pop, and each of
//       India/China === Σ its admin-1 children (D3).
//
// NOTE (D2): we do NOT assert Σ(all node pops) === the live 206,161,169 total.
// Zones overlap / don't cover all 2106 records, and the deaf row double-counts
// (its 123 A017 members also live in geographic rows). Per-zone equality is the
// correct, honest check.
//
// Data source = the FULL record cache (rop1 + population), written by
// recache-full.mjs. The independent re-sum re-implements member resolution from
// scratch (no shared helper) so a bug in legend-tree.js cannot hide behind it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadRecords } from './normalize.js';
import { evaluate } from './selector-evaluator.js';
import { acquireFullPayload } from './recache-full.mjs';
import { buildLegendNodes } from './legend-tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Flatten the nested 26-node tree to ALL nodes (parents + leaves).
function allNodes(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    if (n.children && n.children.length) allNodes(n.children, out);
  }
  return out;
}

// INDEPENDENT re-sum of a zone's member population — deliberately re-implemented
// here so it can disagree with legend-tree.js (the can-fail point). Mirrors the
// member-resolution rules: pg_slugs → slug ∈ values; everything else → evaluator.
function independentPop(selector, records) {
  const pop = (r) => {
    const n = parseInt(r && r.population, 10);
    return Number.isFinite(n) ? n : 0;
  };
  if (selector && selector.type === 'pg_slugs') {
    const want = new Set(Array.isArray(selector.values) ? selector.values : []);
    let s = 0;
    for (const r of records) if (r && want.has(r.slug)) s += pop(r);
    return s;
  }
  const slugs = evaluate(selector, records);
  let s = 0;
  for (const r of records) if (r && slugs.has(r.slug)) s += pop(r);
  return s;
}

async function main() {
  let fails = 0;
  const log = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

  const { payload, skip, source } = await acquireFullPayload();
  if (skip) {
    console.log(`SKIP — ${skip}\n(run: node data/recache-full.mjs --force)`);
    process.exit(2);
  }
  console.log(`[pop-proof] records from ${source}`);
  const records = loadRecords(payload);
  const clusters = readJSON(join(__dirname, 'clusters.json'));

  // Build the tree WITH records → every node should carry pop.
  const nodes = buildLegendNodes(clusters, { deafCount: 123, records });
  const flat = allNodes(nodes);
  console.log(`[pop-proof] total nodes (parents + leaves) = ${flat.length}`);

  // selector lookup for the independent re-sum
  const selById = {};
  for (const l of clusters.lists || []) selById[l.id] = l.selector;
  for (const a of clusters.asia_lists || []) selById[a.id] = a.selector;
  selById['deaf'] = { type: 'affinity_bloc', rop1: 'A017' };

  // ── (1) every node has numeric pop > 0 ──────────────────────────────────────
  console.log('\n--- (1) every node pop is a number > 0 ---');
  let badPop = 0;
  for (const n of flat) {
    const ok = typeof n.pop === 'number' && Number.isFinite(n.pop) && n.pop > 0;
    if (!ok) {
      badPop++;
      console.log(`FAIL  ${String(n.id).padEnd(28)} pop=${JSON.stringify(n.pop)}`);
    }
  }
  log(badPop === 0, `all ${flat.length} nodes have numeric pop > 0 (${badPop} bad)`);
  // Expected node count post-09b-6: 37 total (33 leaves + 4 parents: asia, India,
  // China, Frontier Asia). 09b-asia-contiguity-v2 DISSOLVED the 6 frontier-uncovered
  // stubs (nepal→IN-A, himalaya→IN-D, mongolia+japan→NAS-B as extraCountryCodes,
  // sa-west+central-asia MERGED into uncovered-nas-a) → net −5 leaves. The 4 parents
  // are unchanged (Frontier Asia still parents the 2 remaining uncovered rows). So
  // total = 32 (28 leaves + 4 parents); leaves = 13 region + 1 deaf + 12 asia + 2
  // uncovered = 28.
  // THEN the regional grouping replaced those 4 parents with the poster page's 9 REGION sections (Africa,
  // Middle East, Central Asia, Southeast Asia + Oceania, Americas, Europe, Deaf, India, China + Mongolia),
  // and the tree is built from the leaves: total = 28 leaves + 9 region parents = 37. The old 4 parents were
  // still constructed (and never returned) until they were deleted as dead code.
  log(flat.length === 37, `node tree has 37 total nodes incl. parents (got ${flat.length})`);
  const leaves = flat.filter((n) => !(n.children && n.children.length));
  log(leaves.length === 28, `28 leaf rows own a zone (got ${leaves.length})`);

  // ── (2) 3 spot-checked zones: node.pop === independent re-sum ────────────────
  console.log('\n--- (2) spot-check: node.pop === independent member re-sum ---');
  const byId = Object.fromEntries(flat.map((n) => [n.id, n]));
  // one regional, one asia (pg_slugs), one deaf (affinity_bloc) — different code paths
  const spot = ['west-africa', 'asia-india-gujarat', 'deaf'];
  for (const id of spot) {
    const node = byId[id];
    const sel = selById[id];
    const indep = independentPop(sel, records);
    const ok = node && node.pop === indep;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(22)} node.pop=${node ? node.pop.toLocaleString() : '∅'}  ` +
        `independent=${indep.toLocaleString()}`,
    );
    if (!ok) fails++;
  }

  // ── (3) parent roll-up (D3) ─────────────────────────────────────────────────
  console.log('\n--- (3) parent roll-up (D3) ---');
  // The PARENTS are the region sections now. This section used to look up 'asia-india' / 'asia-china' /
  // 'asia' — parents the regional grouping replaced, which were built and never returned — so it threw on
  // every run while the tree a reader sees went unchecked. It measures the parents the tree actually has.
  const parents = nodes.filter((n) => Array.isArray(n.children) && n.children.length);
  log(parents.length > 0, `the tree has region parents to roll up (${parents.length})`);
  for (const r of parents) {
    const sum = r.children.reduce((s, c) => s + (c.pop || 0), 0);
    log(r.pop === sum, `${r.id}.pop (${(r.pop ?? NaN).toLocaleString()}) === Σ children (${sum.toLocaleString()})`);
  }

  console.log('\n========================================================');
  console.log(`POP-PROOF SUMMARY: ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  console.log('========================================================');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('POP-PROOF ERROR', e); process.exit(1); });
