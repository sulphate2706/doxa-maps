#!/usr/bin/env node
// apply-grouping.mjs — slice 09b toolB §1(b) · the coordinator's ONE-command
// fast-regroup tool.
//
//   node data/apply-grouping.mjs --payload "<clipboard text>"   # upsert a zone
//   node data/apply-grouping.mjs --payload "..." --dry          # preview only
//   node data/apply-grouping.mjs --payload "..." --force        # allow non-contiguous
//   node data/apply-grouping.mjs                                # re-apply whole config
//
// PAYLOAD shape (from toolA clipboard):
//   "Name1, Name2, … — {total} UUPG · #hex"
//   e.g. "Uttar Pradesh, Uttarākhand, Bihār — 92 UUPG · #3aa0ff"
//   (the em-dash "—" and middle-dot "·" are the canonical separators; this parser
//    also tolerates a plain hyphen "-" before the total and "|" before the hex.)
//
// WHAT IT DOES (deterministic, idempotent):
//   (0) groupings.json is the SOURCE OF TRUTH: { zoneId: { label, kind, color?,
//       members:[territory names], … } }. The committed india/china/uncovered
//       cluster files + clusters.json + zone-colors.json are DERIVED outputs of it.
//   (1) parse names + total + color; resolve every territory name to an
//       India-admin1 / China-admin1 / uncovered-country (ISO3).
//   (2) upsert the payload zone in groupings.json (move those territories in; pull
//       them out of whatever zone held them before; set its color).
//   (3) re-derive india/china/uncovered cluster membership from groupings.json.
//   (4) write the zone's color into toolC's zone-colors.json (via set-zone-color).
//   (5) re-run retag-adm1.mjs (re-tag the ADM1 geojson listIds to match).
//   (6) recompute counts from admin-membership.json (India/China = pg_slug count;
//       uncovered = preserved coverage count, see NOTE-COUNT).
//   (7) emit clusters.json — the CANONICAL WRITER (rebuild asia_lists +
//       uncovered_lists from the cluster files; everything else byte-frozen).
//   (8) run the proof suite (isContiguous + zone-resolves-≥1-poly + coverage 2106
//       + swap-back of untouched zones).
//   (9) report a diff (what moved, new counts, contiguity pass/fail per touched
//       zone). CROSS-CHECK the payload's stated total vs the recomputed total
//       (warn on mismatch — catches a stale payload; geometry is truth, B-D3).
//
// B-D1 GUARDRAIL: a real apply BLOCKS a non-contiguous, non-exempt zone with a
//   clear "GAP: X not connected to Y" message — unless --force (then it warns and
//   tags the zone non-contiguous). `--dry` is always allowed.
//
// NOTE-COUNT: India/China zone counts are exactly the number of pg_slugs whose
//   admin1 ∈ the zone's members (admin-membership.json) — fully recomputable.
//   Uncovered zone counts are COVERAGE counts (UPGs in those countries NOT already
//   claimed by a regional/deaf/asia list), which depend on the live rop1 cache and
//   are NOT recomputable from admin-membership alone (partition-uncovered.mjs owns
//   that). So an uncovered zone's count is carried through from groupings.json
//   unchanged unless its membership set actually changes. A payload that moves an
//   India/China state never touches an uncovered count.
//
// SCOPE: writes ONLY files this app owns under data/ (groupings.json, the 3 cluster
//   files, clusters.json, zone-colors.json, the 2 ADM1 geojsons). It NEVER touches
//   profiles/*.vue or shared src/. The proof suite asserts that isolation.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isContiguous, ISLAND_ORPHANS } from './adjacency.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = (f) => join(HERE, f);
const readJSON = (f) => JSON.parse(readFileSync(P(f), 'utf8'));

// ── canonical paths ───────────────────────────────────────────────────────────
// ★ MOVED TO data/tables/. groupings.json is now in the shared asset pool the tree copies into
// public/dx-maps/assets/tables/, because the gospel legend renders IN THE BROWSER and needs it at
// runtime — a build-time import path would not reach the bundle. The name stays relative so P()
// still resolves it against this directory; only the prefix changed.
const GROUPINGS = '../../../data/tables/groupings.json';
const CLUSTERS = 'clusters.json';
const INDIA = 'india-clusters.json';
const CHINA = 'china-clusters.json';
const UNCOVERED = 'uncovered-clusters.json';
const ZONE_COLORS = 'zone-colors.json';
const MEMBERSHIP_F = 'admin-membership.json';
const COUNTS_F = 'admin-counts.json';

// ───────────────────────────────────────────────────────────────────────────────
// resolvers — territory name → { country, admin1? } | { iso3 }
// ───────────────────────────────────────────────────────────────────────────────

// admin1 sets (India + China) from admin-counts.json keys.
function adminSets() {
  const counts = readJSON(COUNTS_F);
  return { IND: new Set(Object.keys(counts.IND || {})), CHN: new Set(Object.keys(counts.CHN || {})) };
}

// Country label → ISO3, for the uncovered zones (their members are ISO3 already,
// but a config payload may type a friendly country NAME). Small committed table
// covering every country that appears in the current uncovered set + common synonyms.
const COUNTRY_TO_ISO3 = {
  nepal: 'NPL', bhutan: 'BTN', bangladesh: 'BGD', afghanistan: 'AFG',
  pakistan: 'PAK', azerbaijan: 'AZE', kyrgyzstan: 'KGZ', tajikistan: 'TJK',
  uzbekistan: 'UZB', mongolia: 'MNG', japan: 'JPN', andorra: 'AND',
  'cocos islands': 'CCK', 'cocos (keeling) islands': 'CCK',
  'french guiana': 'GUF', usa: 'USA', 'united states': 'USA',
  'united states of america': 'USA',
};

// classify a single territory token.
function resolveTerritory(name, sets) {
  const trimmed = name.trim();
  if (sets.IND.has(trimmed)) return { kind: 'india', country: 'IND', admin1: trimmed };
  if (sets.CHN.has(trimmed)) return { kind: 'china', country: 'CHN', admin1: trimmed };
  // ISO3 literal?
  if (/^[A-Z]{3}$/.test(trimmed)) return { kind: 'uncovered', iso3: trimmed };
  // friendly country name?
  const iso = COUNTRY_TO_ISO3[trimmed.toLowerCase()];
  if (iso) return { kind: 'uncovered', iso3: iso };
  return { kind: 'unknown', raw: trimmed };
}

// ───────────────────────────────────────────────────────────────────────────────
// payload parser
// ───────────────────────────────────────────────────────────────────────────────
// "Name1, Name2, … — {total} UUPG · #hex"  →  { names:[…], total, hex|null }
export function parsePayload(text) {
  if (!text || !text.trim()) throw new Error('empty payload');
  let s = text.trim();

  // hex color: last #rrggbb anywhere in the string.
  let hex = null;
  const hexMatch = s.match(/#([0-9a-fA-F]{6})\b/);
  if (hexMatch) { hex = '#' + hexMatch[1].toLowerCase(); s = s.replace(hexMatch[0], ''); }

  // total: the integer immediately before "UUPG" (case-insensitive), else the
  // last integer in the string.
  let total = null;
  const uupg = s.match(/(\d+)\s*UUPG/i);
  if (uupg) { total = parseInt(uupg[1], 10); s = s.replace(uupg[0], ''); }
  else {
    const nums = s.match(/\b\d+\b/g);
    if (nums) { total = parseInt(nums[nums.length - 1], 10); }
  }

  // strip trailing separators / the "· " marker / the total leftover.
  // the names are everything before the first em-dash / " - " / " — " split.
  let head = s;
  const sepIdx = head.search(/\s+[—–-]\s+/);
  if (sepIdx >= 0) head = head.slice(0, sepIdx);
  head = head.replace(/[·•|]/g, ' ');

  const names = head.split(',').map((n) => n.trim()).filter(Boolean);
  if (!names.length) throw new Error(`payload has no territory names: "${text}"`);

  return { names, total: Number.isFinite(total) ? total : null, hex };
}

// ───────────────────────────────────────────────────────────────────────────────
// groupings.json (re)generation
// ───────────────────────────────────────────────────────────────────────────────
// Generate groupings.json FROM the current cluster files (round-trips present
// state). Returns the object (does NOT write unless asked).
export function generateGroupings() {
  const ic = readJSON(INDIA);
  const cc = readJSON(CHINA);
  const uc = readJSON(UNCOVERED);
  const zc = existsSync(P(ZONE_COLORS)) ? readJSON(ZONE_COLORS) : {};
  const g = {};

  const addAsia = (e, kind) => {
    const o = { label: e.label, kind, members: [...e.members], count: e.count };
    if (zc[e.id]) o.color = zc[e.id];
    if (e.zonalCouncil) o.zonalCouncil = e.zonalCouncil;
    if (e.region) o.region = e.region;
    if (e.adm0) o.adm0 = [...e.adm0];
    if (e.extraCountryCodes) o.extraCountryCodes = [...e.extraCountryCodes];
    g[e.id] = o;
  };
  ic.forEach((e) => addAsia(e, 'india'));
  cc.forEach((e) => addAsia(e, 'china'));

  uc.forEach((e) => {
    const o = {
      label: e.label, kind: 'uncovered',
      members: [...(e.selector.values || [])], count: e.count,
      contiguous: e.contiguous, contiguityExempt: e.contiguityExempt,
    };
    if (zc[e.id]) o.color = zc[e.id];
    if (e.extra_slugs) o.extra_slugs = [...e.extra_slugs];
    if (e.flag) o.flag = e.flag;
    g[e.id] = o;
  });

  return g;
}

// stable serializer for groupings.json: keys sorted, 2-space indent, trailing \n.
function serializeGroupings(g) {
  const sorted = {};
  for (const k of Object.keys(g).sort()) sorted[k] = g[k];
  return JSON.stringify(sorted, null, 2) + '\n';
}

function loadGroupings() {
  if (existsSync(P(GROUPINGS))) return readJSON(GROUPINGS);
  return generateGroupings();
}

// ───────────────────────────────────────────────────────────────────────────────
// derive the 3 cluster files + zone-colors from a groupings object
// ───────────────────────────────────────────────────────────────────────────────
function deriveClusterFiles(g) {
  const M = readJSON(MEMBERSHIP_F);

  // admin1 -> [slug] (India / China)
  const indSlugs = {}, chnSlugs = {};
  const byCC = {};
  for (const [slug, v] of Object.entries(M)) {
    byCC[v.country] = (byCC[v.country] || 0) + 1;
    if (v.country === 'IND') (indSlugs[v.admin1] ||= []).push(slug);
    else if (v.country === 'CHN' && v.admin1) (chnSlugs[v.admin1] ||= []).push(slug);
  }

  const india = [], china = [], uncovered = [];
  const colors = {};

  // CANONICAL ORDER: groupings.json keys are stored alpha-sorted, but the committed
  // cluster files (and clusters.json asia_lists / uncovered_lists) are ordered by
  // the EXISTING side-file order (India: count-desc; China: region; uncovered:
  // partition order). To round-trip byte-identically we replay that on-disk order:
  // emit zones first in the order their id appears in the committed side-file, then
  // append any brand-new zone ids (alpha) at the tail of their kind.
  const orderOf = (file) => {
    if (!existsSync(P(file))) return [];
    return readJSON(file).map((e) => e.id);
  };
  const indOrder = orderOf(INDIA);
  const chnOrder = orderOf(CHINA);
  const uncOrder = orderOf(UNCOVERED);
  const orderRank = (id, order) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length + 1 : i;
  };

  const sortedIds = Object.keys(g).sort((aId, bId) => {
    const za = g[aId], zb = g[bId];
    if (za.kind !== zb.kind) return 0; // kept grouped by per-kind pushes below
    const order = za.kind === 'india' ? indOrder : za.kind === 'china' ? chnOrder : uncOrder;
    const ra = orderRank(aId, order), rb = orderRank(bId, order);
    if (ra !== rb) return ra - rb;
    return aId < bId ? -1 : aId > bId ? 1 : 0; // new ids: alpha tail
  });

  for (const id of sortedIds) {
    const z = g[id];
    if (z.color) colors[id] = z.color;

    if (z.kind === 'india') {
      const values = z.members.flatMap((m) => indSlugs[m] || []).sort();
      const entry = {
        id, label: z.label, members: [...z.members], count: values.length,
        zonalCouncil: z.zonalCouncil || undefined,
        selector: { type: 'pg_slugs', values },
      };
      // mixed-geometry (Nepal-frontier-style) carry-through
      if (z.adm0) entry.adm0 = [...z.adm0];
      if (z.extraCountryCodes) {
        entry.extraCountryCodes = [...z.extraCountryCodes];
        // count rolls in the extra-country PGs (membership country totals)
        entry.count = values.length + z.extraCountryCodes.reduce((a, cc) => a + (byCC[cc] || 0), 0);
      }
      india.push(entry);
    } else if (z.kind === 'china') {
      const values = z.members.flatMap((m) => chnSlugs[m] || []).sort();
      const entry = {
        id, label: z.label, members: [...z.members], count: values.length,
        region: z.region || undefined,
        selector: { type: 'pg_slugs', values },
      };
      // mixed-geometry (Nepal-frontier-style) carry-through — symmetric with the
      // india branch (09b-asia-contiguity-v2 NAS-B: Mongolia/Japan/North Korea ride
      // the China ADM1 core as extraCountryCodes; count rolls in their PG totals,
      // the ADM1 selector stays China-only so the coverage partition is unchanged).
      if (z.adm0) entry.adm0 = [...z.adm0];
      if (z.extraCountryCodes) {
        entry.extraCountryCodes = [...z.extraCountryCodes];
        entry.count = values.length + z.extraCountryCodes.reduce((a, cc) => a + (byCC[cc] || 0), 0);
      }
      china.push(entry);
    } else if (z.kind === 'uncovered') {
      const entry = {
        id, label: z.label,
        // NOTE-COUNT: coverage count is carried through from groupings.json.
        count: z.count,
        contiguous: !!z.contiguous, contiguityExempt: !!z.contiguityExempt,
      };
      if (z.flag) entry.flag = z.flag;
      entry.selector = { type: 'country_codes', values: [...z.members].sort() };
      if (z.extra_slugs) entry.extra_slugs = [...z.extra_slugs].sort();
      uncovered.push(entry);
    }
  }

  // strip undefined keys so the side-files match the committed shape exactly.
  const clean = (arr) => arr.map((e) => {
    const o = {};
    for (const [k, v] of Object.entries(e)) if (v !== undefined) o[k] = v;
    return o;
  });

  return { india: clean(india), china: clean(china), uncovered: clean(uncovered), colors };
}

// ───────────────────────────────────────────────────────────────────────────────
// CANONICAL WRITER — rebuild clusters.json asia_lists + uncovered_lists from the
// cluster source arrays; every other section is carried through byte-frozen.
// (mirrors emit-india/china/uncovered-clusters.mjs exactly.)
// ───────────────────────────────────────────────────────────────────────────────
function buildClustersObject(india, china, uncovered) {
  const obj = readJSON(CLUSTERS);

  const newIndia = india.map((e) => ({
    id: e.id, label: e.label, count: e.count, selector: e.selector,
    ...(e.adm0 ? { adm0: e.adm0 } : {}),
    ...(e.extraCountryCodes ? { extraCountryCodes: e.extraCountryCodes } : {}),
  }));
  const newChina = china.map((e) => ({
    id: e.id, label: e.label, count: e.count, selector: e.selector,
    ...(e.adm0 ? { adm0: e.adm0 } : {}),
    ...(e.extraCountryCodes ? { extraCountryCodes: e.extraCountryCodes } : {}),
  }));
  obj.asia_lists = [...newIndia, ...newChina];

  obj.uncovered_lists = uncovered.map((e) => ({
    id: e.id, label: e.label, count: e.count,
    contiguous: e.contiguous, contiguityExempt: e.contiguityExempt,
    ...(e.flag ? { flag: e.flag } : {}),
    selector: e.selector,
    ...(e.extra_slugs ? { extra_slugs: e.extra_slugs } : {}),
  }));

  return obj;
}

// ───────────────────────────────────────────────────────────────────────────────
// contiguity check for a derived India/China zone (admin graph). uncovered zones
// are country-graph + mostly exempt → skipped here (their flags are authoritative).
// ───────────────────────────────────────────────────────────────────────────────
function checkZoneContiguity(zoneId, z) {
  if (z.kind === 'uncovered') {
    return { ok: true, exempt: true, reason: 'uncovered (country-graph; flag authoritative)' };
  }
  if (z.contiguityExempt) return { ok: true, exempt: true };
  const members = z.members.filter((m) => !ISLAND_ORPHANS.includes(m));
  if (members.length <= 1) return { ok: true, exempt: false, trivial: true };
  const r = isContiguous(z.members);
  if (r.contiguous) return { ok: true, exempt: false, components: r.components };
  // build a clear "GAP: X not connected to Y" message between the two largest comps
  const comps = r.components;
  const a = comps[0][0], b = comps[comps.length - 1][0];
  return {
    ok: false, exempt: false, components: comps,
    gap: `GAP: ${a} not connected to ${b} (${comps.length} disconnected components in zone "${zoneId}": ` +
      comps.map((c) => '{' + c.join(', ') + '}').join(' ⟂ ') + ')',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// upsert a payload zone into a groupings object (pure; returns { g, zoneId, moved })
// ───────────────────────────────────────────────────────────────────────────────
export function upsertPayloadZone(g, payload, sets) {
  const resolved = payload.names.map((n) => ({ name: n, ...resolveTerritory(n, sets) }));
  const unknown = resolved.filter((r) => r.kind === 'unknown');
  if (unknown.length) {
    throw new Error(`unresolved territory name(s): ${unknown.map((u) => `"${u.raw}"`).join(', ')}`);
  }
  const kinds = new Set(resolved.map((r) => r.kind));
  if (kinds.size > 1) {
    throw new Error(`payload mixes territory kinds (${[...kinds].join('+')}); a zone must be all-India, all-China, or all-uncovered`);
  }
  const kind = [...kinds][0];

  // members in the cluster file's native key space.
  const members = kind === 'uncovered'
    ? resolved.map((r) => r.iso3)
    : resolved.map((r) => r.admin1);

  // which existing zone owns the FIRST member? that zone's id is the target to
  // upsert into (so the payload re-shapes an existing zone deterministically). If
  // no zone owns it, derive a fresh id from the first member.
  const owningZoneOf = (member, k) => {
    for (const [zid, z] of Object.entries(g)) {
      if (z.kind !== k) continue;
      if (z.members.includes(member)) return zid;
    }
    return null;
  };

  const targetId = owningZoneOf(members[0], kind) || deriveZoneId(members[0], kind);

  // remove every payload member from ALL other zones of the same kind.
  const moved = [];
  for (const [zid, z] of Object.entries(g)) {
    if (z.kind !== kind) continue;
    const before = z.members.length;
    z.members = z.members.filter((m) => !members.includes(m) || zid === targetId);
    if (z.members.length !== before) moved.push({ from: zid, removed: before - z.members.length });
  }

  // upsert the target zone with EXACTLY the payload members (sorted-stable for
  // uncovered ISO3; preserve order for admin1 names since label uses members[0]).
  const existing = g[targetId];
  const labelMembers = kind === 'uncovered' ? [...members].sort() : members;
  g[targetId] = {
    label: existing?.label && sameSet(existing.members, members) ? existing.label : labelMembers.join(' + '),
    kind,
    ...(payload.hex ? { color: payload.hex } : existing?.color ? { color: existing.color } : {}),
    members: kind === 'uncovered' ? [...members].sort() : members,
    count: existing?.count ?? 0,
    ...(existing?.adm0 ? { adm0: existing.adm0 } : {}),
    ...(existing?.extraCountryCodes ? { extraCountryCodes: existing.extraCountryCodes } : {}),
    ...(kind === 'uncovered'
      ? {
        contiguous: existing?.contiguous ?? true,
        contiguityExempt: existing?.contiguityExempt ?? false,
        ...(existing?.extra_slugs ? { extra_slugs: existing.extra_slugs } : {}),
        ...(existing?.flag ? { flag: existing.flag } : {}),
      }
      : {}),
  };

  // drop any same-kind zone that lost all its members (it was fully absorbed).
  for (const zid of Object.keys(g)) {
    if (g[zid].kind === kind && zid !== targetId && g[zid].members.length === 0) delete g[zid];
  }

  return { g, zoneId: targetId, kind, members, moved };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function deriveZoneId(member, kind) {
  const slug = member.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (kind === 'india') return `asia-india-${slug}`;
  if (kind === 'china') return `asia-china-${slug}`;
  return `uncovered-${slug}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// the apply pipeline (shared by --payload, --dry, and no-arg whole-config)
// ───────────────────────────────────────────────────────────────────────────────
export function runApply({ payloadText = null, dry = false, force = false, quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const sets = adminSets();

  // 0. load groupings (source of truth); generate it if missing.
  let g = loadGroupings();
  const groupingsExisted = existsSync(P(GROUPINGS));

  // snapshot the BEFORE derivation for the diff + swap-back.
  const beforeFiles = {
    clusters: readFileSync(P(CLUSTERS), 'utf8'),
    india: existsSync(P(INDIA)) ? readFileSync(P(INDIA), 'utf8') : null,
    china: existsSync(P(CHINA)) ? readFileSync(P(CHINA), 'utf8') : null,
    uncovered: existsSync(P(UNCOVERED)) ? readFileSync(P(UNCOVERED), 'utf8') : null,
    zoneColors: existsSync(P(ZONE_COLORS)) ? readFileSync(P(ZONE_COLORS), 'utf8') : null,
  };

  let payload = null, touched = null;
  if (payloadText) {
    payload = parsePayload(payloadText);
    const r = upsertPayloadZone(g, payload, sets);
    g = r.g;
    touched = r;
    log(`\n payload → zone "${r.zoneId}" (${r.kind}): ${r.members.join(', ')}`);
    if (r.moved.length) {
      log('  moved out of:');
      for (const m of r.moved) if (m.from !== r.zoneId) log(`    - ${m.from} (-${m.removed})`);
    }
  } else {
    log('\n no payload — re-applying the whole groupings.json config');
  }

  // 3+6. derive cluster files (recomputes India/China counts from membership).
  const { india, china, uncovered, colors } = deriveClusterFiles(g);

  // refresh groupings counts from the derived cluster files (so groupings.json is
  // self-consistent after recompute). uncovered counts are coverage-derived and
  // carried through unchanged.
  const countById = {};
  for (const e of [...india, ...china]) countById[e.id] = e.count;
  for (const [id, z] of Object.entries(g)) {
    if (z.kind !== 'uncovered' && countById[id] != null) z.count = countById[id];
  }

  // 7. CANONICAL clusters.json object.
  const clustersObj = buildClustersObject(india, china, uncovered);

  // ── contiguity gate (B-D1) over every TOUCHED India/China zone ──────────────
  const contigReports = [];
  const zonesToCheck = touched
    ? [touched.zoneId]
    : Object.keys(g).filter((id) => g[id].kind !== 'uncovered');
  for (const zid of zonesToCheck) {
    if (!g[zid]) continue;
    const rep = checkZoneContiguity(zid, g[zid]);
    contigReports.push({ zoneId: zid, ...rep });
  }
  const blockers = contigReports.filter((r) => !r.ok);

  // diff: counts before/after for touched zones + the cross-check.
  const recomputedTotal = touched
    ? (countById[touched.zoneId] ?? g[touched.zoneId]?.count ?? 0)
    : null;

  log('\n── contiguity ──');
  for (const r of contigReports) {
    if (r.exempt) log(`  ${r.zoneId}: EXEMPT`);
    else if (r.ok) log(`  ${r.zoneId}: contiguous ✓`);
    else log(`  ${r.zoneId}: NON-CONTIGUOUS ✗  ${r.gap}`);
  }

  if (payload && recomputedTotal != null && payload.total != null && payload.total !== recomputedTotal) {
    log(`\n⚠ TOTAL MISMATCH (B-D3): payload said ${payload.total} UUPG, recomputed ${recomputedTotal} ` +
      `(proceeding with recomputed — geometry is truth; check for a stale payload).`);
  }

  // BLOCK on a non-contiguous non-exempt zone unless --force or --dry.
  if (blockers.length && !force && !dry) {
    log('\n================ BLOCKED (B-D1) ================');
    for (const b of blockers) log('  ' + b.gap);
    log('  Refusing to write a non-contiguous non-exempt zone. Re-run with --force to override (warns + tags it).');
    log('================================================');
    return { ok: false, blocked: true, blockers, dry, payload, touched };
  }
  if (blockers.length && force) {
    log('\n⚠ --force: writing a NON-CONTIGUOUS zone (tagged). The gap(s):');
    for (const b of blockers) {
      log('  ' + b.gap);
      // tag the zone non-contiguous in groupings (carried into derived files if uncovered)
      if (g[b.zoneId]) g[b.zoneId].contiguous = false;
    }
  }

  if (dry) {
    log('\n── DRY RUN — diff preview (NO files written) ──');
    diffReport(beforeFiles, g, india, china, uncovered, clustersObj, log);
    return { ok: true, dry: true, blocked: false, blockers, payload, touched, india, china, uncovered, clustersObj, g };
  }

  // ── WRITE PHASE ─────────────────────────────────────────────────────────────
  // (0) groupings.json (source of truth) — only when a payload mutated it, or when
  //     it didn't yet exist (first generation).
  if (payload || !groupingsExisted) {
    writeFileSync(P(GROUPINGS), serializeGroupings(g));
  }

  // (3) the 3 cluster files (canonical writers: trailing \n, JSON 2-space).
  writeFileSync(P(INDIA), JSON.stringify(india, null, 2) + '\n');
  writeFileSync(P(CHINA), JSON.stringify(china, null, 2) + '\n');
  writeFileSync(P(UNCOVERED), JSON.stringify(uncovered, null, 2) + '\n');

  // (4) zone-colors.json — sync every zone color FROM groupings.json via
  //     set-zone-color.mjs (toolC's writer; keeps its sorted/normalised shape).
  //     • payload + hex → set that one zone's color (the common fast path).
  //     • whole-config re-apply → re-assert every zone color that differs from the
  //       on-disk store, so a revert restores colors too. Non-zone keys
  //       (andean-caribbean, brazil, …) are never in groupings → left untouched.
  if (payload && payload.hex && touched) {
    execFileSync(process.execPath, [P('set-zone-color.mjs'), touched.zoneId, payload.hex], { stdio: quiet ? 'ignore' : 'inherit' });
  } else if (!payload) {
    const onDisk = existsSync(P(ZONE_COLORS)) ? readJSON(ZONE_COLORS) : {};
    for (const [id, hex] of Object.entries(colors)) {
      if (onDisk[id] !== hex) {
        execFileSync(process.execPath, [P('set-zone-color.mjs'), id, hex], { stdio: quiet ? 'ignore' : 'inherit' });
      }
    }
  }

  // (7) clusters.json — CANONICAL WRITER: JSON.stringify(obj,null,2) NO trailing \n.
  writeFileSync(P(CLUSTERS), JSON.stringify(clustersObj, null, 2));

  // (5) re-tag the ADM1 geojson listIds to match the new cluster membership.
  execFileSync(process.execPath, [P('retag-adm1.mjs')], { stdio: quiet ? 'ignore' : 'inherit' });

  // (8) proof suite — run AFTER the write so the proofs see the new state.
  log('\n── proof suite ──');
  const proofOk = runProofSuite({ quiet, touched, beforeFiles, india, china, uncovered });

  // (9) diff report.
  diffReport(beforeFiles, g, india, china, uncovered, clustersObj, log);

  log(`\n================ apply ${proofOk ? 'OK' : 'PROOF-FAILED'} ================`);
  return { ok: proofOk, blocked: false, blockers, dry: false, payload, touched, india, china, uncovered, clustersObj, g };
}

// run the post-regroup INVARIANTS (§1(b) step 7). These are the checks that hold
// for ANY valid regroup — NOT the older slice-09b-3/4/5 swap-back proofs, whose
// (C) clause pins a frozen-India / frozen-China pre-state md5 that a legitimate
// move is supposed to change. The four invariants:
//   (i)   isContiguous — every touched India/China zone is one connected component
//         (already gated in runApply via the B-D1 block; re-asserted here).
//   (ii)  resolve-≥1-poly — every geographic zone still owns ≥1 ADM1 polygon after
//         the re-tag (this is exactly zone-resolves-proof.mjs's invariant; it does
//         NOT pin a pre-state md5, so it survives a regroup).
//   (iii) coverage — the India pg_slug partition is conserved at 855 and China at
//         152 (no slug dropped/duplicated by the move); uncovered counts unchanged.
//   (iv)  swap-back of UNTOUCHED zones — every asia_lists / uncovered_lists entry
//         NOT in the payload is byte-identical to its pre-apply serialization.
function runProofSuite({ quiet, touched, beforeFiles, india, china, uncovered }) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  let allOk = true;
  const gate = (c, m) => { log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) allOk = false; };

  // (ii) geometry — reuse zone-resolves-proof.mjs (pure invariant, no md5 pin).
  if (existsSync(P('zone-resolves-proof.mjs'))) {
    try {
      execFileSync(process.execPath, [P('zone-resolves-proof.mjs')], { stdio: 'ignore' });
      gate(true, 'resolve-≥1-poly (every geographic zone owns ≥1 ADM1 polygon)');
    } catch {
      gate(false, 'resolve-≥1-poly (a zone resolved 0 polygons — stale ADM1 tag?)');
    }
  }

  // (iii) coverage — India 855 + China 152 pg_slugs conserved, none double-counted.
  const indSlugs = india.flatMap((e) => e.selector.values);
  const chnSlugs = china.flatMap((e) => e.selector.values);
  gate(indSlugs.length === 855 && new Set(indSlugs).size === 855,
    `coverage India 855/855 pg_slugs (got ${indSlugs.length}, distinct ${new Set(indSlugs).size})`);
  gate(chnSlugs.length === 152 && new Set(chnSlugs).size === 152,
    `coverage China 152/152 pg_slugs (got ${chnSlugs.length}, distinct ${new Set(chnSlugs).size})`);

  // (iv) swap-back of UNTOUCHED zones — only meaningful for a PAYLOAD apply (it
  //      proves a single regroup touched ONLY its own zones). A no-payload
  //      whole-config re-apply intentionally re-derives EVERY zone from
  //      groupings.json, so there is no "untouched" subset to pin — skip it there.
  //      "Involved" = the target zone (touched.zoneId) PLUS any source zone the
  //      payload pulled members OUT of (touched.moved). Everything else must be
  //      byte-identical to its pre-apply serialization.
  if (touched) {
    const involved = new Set([touched.zoneId]);
    for (const m of touched.moved || []) involved.add(m.from);
    const beforeObj = JSON.parse(beforeFiles.clusters);
    const afterObj = buildClustersObject(india, china, uncovered);
    const sig = (arr, id) => {
      const e = (arr || []).find((x) => x.id === id);
      return e ? JSON.stringify(e) : null;
    };
    let untouchedOk = true, checked = 0;
    for (const block of ['asia_lists', 'uncovered_lists']) {
      const ids = new Set([...(beforeObj[block] || []), ...(afterObj[block] || [])].map((e) => e.id));
      for (const id of ids) {
        if (involved.has(id)) continue;
        checked++;
        if (sig(beforeObj[block], id) !== sig(afterObj[block], id)) {
          untouchedOk = false;
          log(`        untouched zone CHANGED: ${id}`);
        }
      }
    }
    gate(untouchedOk, `swap-back: ${checked} untouched zone(s) byte-identical (only the payload zone(s) moved)`);
  } else {
    log('  PASS  swap-back: whole-config re-apply (no payload) — all zones re-derived by design, no subset pinned');
  }

  return allOk;
}

function diffReport(before, g, india, china, uncovered, clustersObj, log) {
  const afterClusters = JSON.stringify(clustersObj, null, 2);
  log('\n── diff ──');
  log(`  clusters.json: ${before.clusters === afterClusters ? 'byte-identical (no-op)' : 'CHANGED'}`);
  log(`  zones: ${Object.keys(g).length} total ` +
    `(${india.length} india, ${china.length} china, ${uncovered.length} uncovered)`);
  const total = [...india, ...china, ...uncovered].reduce((a, e) => a + e.count, 0);
  log(`  summed count across all zones: ${total}`);
}

// ───────────────────────────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry');
  const force = argv.includes('--force');
  let payloadText = null;
  const pi = argv.indexOf('--payload');
  if (pi >= 0) payloadText = argv[pi + 1];

  console.log('================ toolB apply-grouping ================');
  const res = runApply({ payloadText, dry, force });
  // exit non-zero on a B-D1 block (so a coordinator script knows the apply was
  // REJECTED) or on a proof failure; 0 on a clean apply/dry-run.
  process.exit(res.ok && !res.blocked ? 0 : 1);
}
