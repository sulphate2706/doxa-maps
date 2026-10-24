// legend-tree.js — slice 04t §1(a)
//
// Pure shaper: buildLegendNodes(clusters) -> TreeNode[]
//
// Turns clusters.json (13 regional `lists` + 2 `deaf_lists` + 12 `asia_lists`)
// into the NESTED `nodes` tree consumed by the forge-shared
// src/components/SemanticTreeLegend.vue (S04t-D4: nested). It does NOT rebuild a
// legend — it only shapes data.
//
// Tree node shape (per SemanticTreeLegend.vue:13-30):
//   { id, label, color?, count?, pop?, filter?, info?, children?: TreeNode[] }
//
// Output shape (26 LEAF rows total):
//   - 13 Region leaves       (top level)
//   - 1  Deaf leaf           (top level; the two deaf_lists collapse into ONE
//                             A017 row, count 123 — R1.1 design correction)
//   - 1  Asia parent ▸ India (10 state-cluster leaves) / China (2 leaves)
//
// Parents (Asia / India / China) carry rolled-up count. A stable zoneKey === leaf
// id is assigned so the paint layer's ['match', ['get','zoneKey'], …] and the
// legend's `select` emit share one key space.

// Deterministic per-leaf color: even hue spread across the 26 leaves, comma-HSL
// (Mapbox paint expressions reject the modern slash hsl() syntax). Mirrors the
// slice-04b color rule (profiles/upg-100-list.vue:77).
export function leafColor(i, n) {
  return `hsl(${Math.round((i * 360) / (n || 1))}, 72%, 56%)`;
}

import { evaluate } from './selector-evaluator.js';

// Count for one leaf: regional/asia carry `count`, deaf carries the A017 total.
function leafCount(row) {
  if (typeof row.count === 'number') return row.count;
  if (typeof row.expected_count === 'number') return row.expected_count;
  return undefined;
}

// ── slice 04u §1(b): population per leaf ─────────────────────────────────────
// Sum parseInt(member.population) over a zone's MEMBER records — the same member
// set used for `count`. population is a flat string on the live record (full
// recache parses it to int; parseInt here is belt-and-suspenders for either form).
function popOf(record) {
  const n = parseInt(record && record.population, 10);
  return Number.isFinite(n) ? n : 0;
}

// Resolve a zone's member records, then sum their population.
//   - regional + deaf rows use the selector-evaluator (country_code / wagf_* /
//     union / affinity_bloc) — same path zone-geometry uses for `count`.
//   - ASIA rows carry a `pg_slugs` selector the evaluator intentionally REJECTS
//     (it resolves geometry by pre-tagged listId, not by evaluating slugs). For
//     population we sum records whose slug ∈ selector.values directly — no
//     evaluator change, no shared-src edit.
function leafPopulation(row, records) {
  if (!Array.isArray(records) || records.length === 0) return undefined;
  const sel = row && row.selector;
  if (sel == null) return undefined;

  // Asia state-clusters: explicit pg_slugs member list.
  if (sel.type === 'pg_slugs') {
    const want = new Set(Array.isArray(sel.values) ? sel.values : []);
    let sum = 0;
    for (const r of records) if (r && want.has(r.slug)) sum += popOf(r);
    return sum;
  }

  // Everything else the evaluator handles → Set<slug> → sum member population.
  const slugs = evaluate(sel, records);
  let sum = 0;
  for (const r of records) if (r && slugs.has(r.slug)) sum += popOf(r);
  return sum;
}

/**
 * buildLegendNodes(clusters, opts?) -> TreeNode[]
 * @param {object} clusters  parsed clusters.json
 * @param {object} [opts]
 * @param {number} [opts.deafCount=123]  A017 PG count for the unified deaf leaf
 * @param {Array}  [opts.records]  normalized live records — when supplied, every
 *                 node also gets `pop` (Σ member population; parents roll up).
 *                 Omit to keep the prior count-only behaviour (pop undefined).
 * @returns {Array} nested TreeNode[] (3 top-level groups, 26 leaves total)
 */
// ★ THE UNIFIED DEAF LEAF'S SELECTOR, DEFINED ONCE. The legend collapses the two deaf_lists into one
// leaf (affinity bloc A017) whose selector exists nowhere in clusters.json, so every consumer that
// RESOLVES zones had to know it — and each typed its own copy of the literal (the map in
// upg-100-list.vue, generate.mjs, packet.mjs). The browser packet path had no copy at all, which is why
// the Deaf packet could not be printed from the UI: the zone lookup found nothing and returned silently.
export const DEAF_SELECTOR = { type: 'affinity_bloc', rop1: 'A017' };

// The catalogue key (poster.<key>) that names each REGION_OF grouping in the reader's language. The
// English values stay the grouping identity (ids are derived from them), so the heading is translated
// at render: here for the legend via opts.regionTitle, and by poster-wall.vue for the wall's sections.
// One table for both surfaces, so a region added here cannot be translated on one and English on the other.
export const REGION_KEY = {
  'Africa': 'region_africa',
  'Middle East': 'region_middle_east',
  'Central Asia': 'region_central_asia',
  'Southeast Asia + Oceania': 'region_southeast_asia_oceania',
  'China + Mongolia': 'region_china_mongolia',
  'India': 'region_india',
  'Other': 'region_other',
  'Americas': 'region_americas',
  'Europe': 'region_europe',
  'Deaf': 'region_deaf',
};

export function buildLegendNodes(clusters, opts = {}) {
  const deafCount = opts.deafCount ?? 123;
  const records = Array.isArray(opts.records) ? opts.records : null;
  // ★ OPTIONAL GENERATED TITLE (2026-09-27). `opts.title(zone)` returns a localized title
  // composed from already-translated parts, or NULL for a zone whose title cannot be generated — see
  // data/zone-title.js. Passing nothing keeps every hand-written English label exactly as it was, which
  // is why this is an option rather than a rewrite: the legend, the poster and the packet adopt it
  // independently, and a caller that has no records yet (records:null) still builds a correct tree.
  // ⚠ NULL MEANS "KEEP YOURS", NOT "NO TITLE". 18 of 28 zones decline (their labels are sub-national or
  // taxonomic, and Intl has no subdivisions), so the fallback is the normal path, not the error path.
  const titleOf = typeof opts.title === 'function'
    ? (zone, fallback) => opts.title(zone) || fallback
    : (_zone, fallback) => fallback;
  // `opts.regionTitle(english)` names a region section in the reader's language (see REGION_KEY); the
  // node id stays derived from the English grouping key, so selection and ids never depend on a locale.
  const regionTitleOf = typeof opts.regionTitle === 'function'
    ? (english) => opts.regionTitle(english) || english
    : (english) => english;
  const lists = clusters.lists || [];
  const asia = clusters.asia_lists || [];
  // slice 09b-6 §1(a): wire the 7 uncovered "Frontier Asia" zones (Nepal,
  // Himalaya, SA-West, Central-Asia, Mongolia, Japan, Scatter). They carry a
  // `country_codes` selector → resolved by zone-geometry's REGIONAL/ADM0 path
  // (same as the 13 regional rows), NOT the asia ADM1 path. Default empty so
  // pre-09b-6 clusters (no uncovered_lists) keep the prior 26-leaf shape.
  const uncovered = clusters.uncovered_lists || [];

  // Deaf row's selector is implicit (affinity bloc A017), so population can be
  // summed the same way as the regional rows. Module-level and exported — see DEAF_SELECTOR below.

  // ── ordered leaf list (drives color index space) ───────────────────────────
  // order: 13 regional, 1 deaf, asia (10 India + 2 China), then the Frontier-Asia
  // uncovered rows — matches the legend reading order and the paint match arms.
  // ★ COUNTS ARE DERIVED FROM clusters.json, never asserted here (2026-09-21). This comment
  // used to claim "33 leaves" and "7 Frontier-Asia uncovered"; the shipped clusters.json
  // carries 13 + 12 + 2 + 1 deaf = 28, with exactly TWO uncovered rows
  // (uncovered-scatter, uncovered-nas-a). The stale 26-vs-reality gap also shipped as a
  // "27/26 zones" badge in upg-100-list.vue. A hardcoded count next to data that grows is a
  // drift waiting to happen — read the arrays instead.
  const indiaRows = asia.filter((a) => a.id.startsWith('asia-india'));
  const chinaRows = asia.filter((a) => a.id.startsWith('asia-china'));
  const orderedLeafIds = [
    ...lists.map((l) => l.id),
    'deaf',
    ...indiaRows.map((r) => r.id),
    ...chinaRows.map((r) => r.id),
    ...uncovered.map((u) => u.id),
  ];
  const N = orderedLeafIds.length; // 33 (26 + 7 uncovered)
  const colorOf = (id) => leafColor(orderedLeafIds.indexOf(id), N);

  // `pop` is attached only when records were supplied; undefined otherwise so the
  // prior count-only callers are unaffected. `withPop` adds the key conditionally.
  const withPop = (node, row, selector) => {
    if (!records) return node;
    const sel = selector ?? (row && row.selector);
    node.pop = leafPopulation({ selector: sel }, records);
    return node;
  };
  // Sum child pops (parent roll-up, S04u-D3). Returns undefined when no records.
  const sumPop = (children) =>
    records ? children.reduce((s, c) => s + (c.pop || 0), 0) : undefined;

  // ── 13 Region leaves ───────────────────────────────────────────────────────
  const regionLeaves = lists.map((l) =>
    withPop(
      {
        id: l.id,
        zoneKey: l.id,
        label: titleOf(l, l.label),
        // Carry the province enumeration the region-name label replaced.
        ...(l.provinceLabel ? { provinceLabel: l.provinceLabel } : {}),
        color: colorOf(l.id),
        count: leafCount(l),
      },
      l,
    ),
  );

  // ── 1 Deaf leaf (unified A017; R1.1) ───────────────────────────────────────
  // D2: deaf pop = Σ population of the 123 A017 members. This WILL double-count
  // vs the geographic rows (those members also fall inside a regional zone) —
  // the design-approved deaf double-count (slice 08). Per-zone equality still
  // holds; only a naïve global sum would over-count, which the proof avoids.
  const deafLeaf = withPop(
    {
      id: 'deaf',
      zoneKey: 'deaf',
      // Named like every other leaf: opts.title reads the bloc's name from the strings it was given
      // (zone-title.js, zone_affinity_A017); the English label is only the no-title fallback.
      label: titleOf({ id: 'deaf', selector: DEAF_SELECTOR }, 'Deaf (affinity bloc A017)'),
      color: colorOf('deaf'),
      count: deafCount,
      info: 'Unified deaf row — affinity bloc rop1=A017 (collapses the two deaf_lists; zero-delta vs old deaf_predicate). Population double-counts vs geographic rows (design-approved, slice 08).',
    },
    null,
    DEAF_SELECTOR,
  );

  // ── Asia parent ▸ India / China ────────────────────────────────────────────
  const mkAsiaLeaf = (r) =>
    withPop(
      {
        id: r.id,
        zoneKey: r.id,
        label: titleOf(r, r.label),
        // The province enumeration the region-name label replaced. Carried through
        // like adm0/provinces above — a node rebuilt field-by-field silently drops
        // anything not named, which is exactly how adm0 and population were lost.
        ...(r.provinceLabel ? { provinceLabel: r.provinceLabel } : {}),
        color: colorOf(r.id),
        count: leafCount(r),
        // MIXED GEOMETRY: carry the optional `adm0` ISO3 list through to the node.
        // zone-geometry.js ALREADY supports it — an Asia zone may union whole ADM0
        // countries alongside its ADM1 provinces, and its comment names the Nepal
        // case explicitly — but the node was rebuilt field-by-field here and
        // silently dropped adm0, so the hook could never fire.
        ...(Array.isArray(r.adm0) && r.adm0.length ? { adm0: r.adm0 } : {}),
        // Same passthrough reason as adm0: the province enumeration is data the
        // poster header prints, and rebuilding the node field-by-field drops it.
        ...(Array.isArray(r.provinces) && r.provinces.length ? { provinces: r.provinces } : {}),
      },
      r,
    );
  const indiaChildren = indiaRows.map(mkAsiaLeaf);
  const chinaChildren = chinaRows.map(mkAsiaLeaf);

  // (The India / China / "Asia (admin-1)" and "Frontier Asia (uncovered)" PARENT nodes that used to be
  // built here are gone: since the regional grouping below, the tree is assembled from the LEAVES, so those
  // parents were constructed and never returned — dead code whose English labels read as reader text.)

  // ── Frontier Asia parent ▸ 7 uncovered zones (09b-6 §1a, W-D1) ─────────────
  // Each uncovered row carries a `country_codes` selector → ADM0 polygons
  // (Nepal→NPL, SA-West→AFG+PAK, …). Same leaf shape as regional rows so the
  // tapestry's single ['match',['get','zoneKey'],…] paints them with the rest.
  const mkUncoveredLeaf = (u) =>
    withPop(
      {
        id: u.id,
        zoneKey: u.id,
        label: titleOf(u, u.label),
        // Carry the province enumeration the region-name label replaced.
        ...(u.provinceLabel ? { provinceLabel: u.provinceLabel } : {}),
        color: colorOf(u.id),
        count: leafCount(u),
      },
      u,
    );
  const uncoveredChildren = uncovered.map(mkUncoveredLeaf);

  // ── REGIONAL GROUPING — the SAME sections the poster page uses ─────────────
  // The legend used to emit 14 LOOSE LEAVES at top level (West Africa, Sudan,
  // Brazil, Laos, …) beside two odd parents, "Asia (admin-1)" and "Frontier Asia
  // (uncovered)". That grouping read poorly beside the poster page, so the legend
  // now uses the poster page's own sections.
  //
  // So the same 28 zones now group into the poster page's nine regions. The
  // mapping is duplicated from poster-wall.vue rather than imported because this
  // file is a PURE SHAPER with no imports by design — but the two lists must stay
  // in step, so any edit here belongs in poster-wall.vue's REGION_OF too.
  const REGION_OF = {
    'west-africa': 'Africa', 'sudan': 'Africa', 'east-africa': 'Africa',
    'central-africa': 'Africa', 'southern-africa-islands': 'Africa',
    'maghreb-egypt': 'Middle East', 'middle-east-core': 'Middle East',
    'uncovered-nas-a': 'Central Asia',
    'laos': 'Southeast Asia + Oceania', 'oceania-indonesia': 'Southeast Asia + Oceania',
    'mainland-se-asia-philippines': 'Southeast Asia + Oceania',
    'brazil': 'Americas', 'andean-caribbean': 'Americas', 'uncovered-scatter': 'Americas',
    'europe': 'Europe', 'deaf': 'Deaf', 'deaf-old-world': 'Deaf',
  };
  const regionFor = (id) =>
    REGION_OF[id]
    || (String(id).startsWith('asia-india-') ? 'India'
     :  String(id).startsWith('asia-china-') ? 'China + Mongolia'
     :  'Other');

  // Every leaf the tree can paint, flattened out of its source block. India and
  // China leaves are indiaChildren / chinaChildren; the rest are already flat.
  const allLeaves = [
    ...regionLeaves,
    deafLeaf,
    ...indiaChildren,
    ...chinaChildren,
    ...uncoveredChildren,
  ].filter(Boolean);

  const byRegion = new Map();
  for (const leaf of allLeaves) {
    const r = regionFor(leaf.id || leaf.zoneKey);
    if (!byRegion.has(r)) byRegion.set(r, []);
    byRegion.get(r).push(leaf);
  }

  // Sections ordered by TOTAL people groups (largest first), leaves within a
  // section by their own count — the densest prayer need leads at both levels,
  // matching the poster page exactly.
  const tops = [...byRegion.entries()]
    .map(([label, children]) => {
      children.sort((a, b) => (b.count || 0) - (a.count || 0));
      const node = {
        // ★ FOLD DIACRITICS BEFORE STRIPPING, or the mark is DELETED and the id silently becomes a
        // different id: Gujarāt -> 'region-gujar-t', not 'region-gujarat'. Today's labels are the
        // fixed ASCII set from regionFor(), so nothing is broken — but the whole point is that
        // a fork brings its OWN people-group set and names its own regions, and the first accented
        // label would split one region into two with no error and no empty state. Same class as a measured
        // join of admin-to-list.json: a naive fold matched 514 of 1009 rows and lost THREE
        // whole zones, while every surviving zone still looked populated. Fix the class, not the six
        // spellings we happen to know.
        id: 'region-' + label.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        label: regionTitleOf(label),
        count: children.reduce((n, c) => n + (c.count || 0), 0),
        children,
      };
      if (records) node.pop = sumPop(children);
      return node;
    })
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  // ── L15 consumer-shape assertion (09b-6 §1b) ───────────────────────────────
  // Every RENDERED LEAF — regardless of source block (lists / asia_lists /
  // uncovered_lists) — must carry the same required fields so zone-geometry and
  // the paint match expression read a uniform shape. Fail loud (throw) rather
  // than silently paint a malformed zone.
  assertUniformLeafShape(leafZones(tops), { withPop: !!records });

  return tops;
}

// L15 (09b-6 §1b): assert every leaf zone has the uniform consumer shape.
// Required on ALL leaves: id, zoneKey, label, color (string), count (number).
// When records were supplied, `pop` must also be a number on every leaf.
// Parents (asia/india/china/frontier-asia) are intentionally NOT leaves and are
// excluded by leafZones() — they carry roll-ups, not a zoneKey/selector.
export function assertUniformLeafShape(leaves, { withPop = false } = {}) {
  const bad = [];
  for (const z of leaves || []) {
    const errs = [];
    if (typeof z.id !== 'string' || !z.id) errs.push('id');
    if (typeof z.zoneKey !== 'string' || !z.zoneKey) errs.push('zoneKey');
    if (typeof z.label !== 'string' || !z.label) errs.push('label');
    if (typeof z.color !== 'string' || !z.color) errs.push('color');
    if (typeof z.count !== 'number') errs.push('count');
    if (withPop && typeof z.pop !== 'number') errs.push('pop');
    if (errs.length) bad.push({ id: z.id || '(no-id)', errs });
  }
  if (bad.length) {
    // A developer assertion: the text is composed here, inside the throw, so it is plainly not reader copy.
    throw new Error(
      `legend-tree L15: ${bad.length} leaf node(s) violate the uniform consumer shape:\n  ` +
        bad.map((b) => `${b.id}: missing/!type [${b.errs.join(', ')}]`).join('\n  '),
    );
  }
  return true;
}

// Flatten a nodes tree to its LEAF nodes (rows that own a zoneKey/paint zone).
export function leafZones(nodes) {
  const out = [];
  const walk = (arr) => {
    for (const n of arr) {
      if (n.children && n.children.length) walk(n.children);
      else out.push(n);
    }
  };
  walk(nodes || []);
  return out;
}

/**
 * Every printable zone — the legend's leaves — each carrying the selector that resolves its groups.
 *
 * ★ THE ENUMERATION IS THE LEGEND'S, NOT clusters.json's BUCKETS. Spreading lists/asia_lists/
 * uncovered_lists gives 27 zones and silently drops `deaf`, which the legend shows as one row; a
 * packet lookup built that way cannot print Deaf, and a count built that way prints "one of 27" on
 * page 1 and at the triangle's tip while 28 packets exist. Leaves do not carry selectors, so they are
 * attached here by id, the unified deaf leaf taking DEAF_SELECTOR.
 * Returns COPIES; the legend's own node objects are left untouched.
 *
 * @param {object} clusters  the zone catalogue (clusters.json shape)
 * @param {object} [opts]    passed through to buildLegendNodes
 * @returns {Array<{id:string, zoneKey:string, label:string, selector:object}>}
 */
export function zonesWithSelectors(clusters, opts = {}) {
  const byId = {};
  for (const k of ['lists', 'asia_lists', 'uncovered_lists']) {
    for (const z of (clusters && clusters[k]) || []) byId[z.id] = z.selector;
  }
  byId.deaf = DEAF_SELECTOR;
  return leafZones(buildLegendNodes(clusters, opts))
    .map((z) => ({ ...z, zoneKey: z.zoneKey || z.id, selector: byId[z.id] }));
}

export default buildLegendNodes;
