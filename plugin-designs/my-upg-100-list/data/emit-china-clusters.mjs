// emit-china-clusters.mjs — slice 09b-4 §1(b,c)
//
// Mirrors data/emit-india-clusters.mjs. Consumes partitionChina() and emits:
//   (b) data/china-clusters.json — [{ id, label, members, count, region,
//       selector:{type:"pg_slugs", values:[…]} }]. The pg_slugs are the slugs in
//       admin-membership.json whose country==CHN and admin1 ∈ the cluster's
//       members. The 2 unstamped China-border points (jing, pana-china;
//       admin1=null) are NOT a member of any admin → they NEVER enter a cluster.
//       China target = 152.
//   (c) Rewrites ONLY the China entries of data/clusters.json asia_lists to these
//       new clusters. Everything else (the 10 India asia_lists entries just set
//       by 09b-3, the 13 regional lists, deaf_lists, asia_unsolved,
//       uncovered_scatter, asia_solved_validation, top-level scalars) is preserved
//       byte-for-byte by rebuilding the asia_lists array as
//       [ ...existingIndiaEntries, ...newChinaEntries ] and re-stringifying the
//       SAME parsed object (only the China slice of asia_lists mutated). India is
//       positionally first and untouched; China is rewritten in place at the tail.
//
// CANONICAL WRITER — identical to emit-india-clusters.mjs: india-clusters style
// output uses `JSON.stringify(entries, null, 2) + '\n'`; clusters.json uses
// `JSON.stringify(obj, null, 2)` with NO trailing newline (matches the 09b-3
// byte shape so the swap-back md5 reproduces 3b7ea66f exactly).
//
// Run: node data/emit-china-clusters.mjs        (writes both files)
//      node data/emit-china-clusters.mjs --dry  (prints, writes nothing)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { partitionChina, MACRO_REGIONS } from './partition-china.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMBERSHIP = JSON.parse(
  readFileSync(join(__dirname, 'admin-membership.json'), 'utf8'),
);
const CLUSTERS_PATH = join(__dirname, 'clusters.json');
const OUT_PATH = join(__dirname, 'china-clusters.json');

const DRY = process.argv.includes('--dry');

// admin1 -> [slug…] from membership (China only). admin1=null (jing, pana-china)
// is skipped — those 2 unstamped points belong to 09b-5, not a China cluster.
const slugsByAdmin = {};
for (const [slug, v] of Object.entries(MEMBERSHIP)) {
  if (v.country !== 'CHN') continue;
  if (!v.admin1) continue; // unstamped → 09b-5
  (slugsByAdmin[v.admin1] ||= []).push(slug);
}

// macro-region of a cluster = the region most of its members belong to
const regionOf = {};
for (const [region, members] of Object.entries(MACRO_REGIONS)) {
  for (const m of members) regionOf[m] = region;
}
function dominantRegion(members) {
  const tally = {};
  for (const m of members) {
    const r = regionOf[m] || 'Unknown';
    tally[r] = (tally[r] || 0) + 1;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
}

// stable id from the largest member admin (members[0] is seed / largest)
function clusterId(members) {
  const head = members[0];
  const slug = head.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `asia-china-${slug}`;
}

export function buildChinaEntries() {
  const { clusters, total } = partitionChina();
  if (total !== 152) {
    throw new Error(`partition total ${total} != 152 — refusing to emit`);
  }

  const entries = clusters.map((members) => {
    // gather + sort slugs deterministically (stable, byte-reproducible)
    const values = members
      .flatMap((m) => slugsByAdmin[m] || [])
      .sort();
    return {
      id: clusterId(members),
      label: members.join(' + '),
      members,
      count: values.length,
      region: dominantRegion(members),
      selector: { type: 'pg_slugs', values },
    };
  });

  // sanity: ids unique, total slugs == 152, no slug double-counted
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new Error('duplicate cluster id');
  const allSlugs = entries.flatMap((e) => e.selector.values);
  if (new Set(allSlugs).size !== allSlugs.length) {
    throw new Error('a slug appears in more than one cluster');
  }
  if (allSlugs.length !== 152) {
    throw new Error(`emitted ${allSlugs.length} slugs != 152`);
  }
  return entries;
}

function rewriteClusters(entries) {
  const raw = readFileSync(CLUSTERS_PATH, 'utf8');
  const obj = JSON.parse(raw);

  const before = obj.asia_lists;
  const indiaEntries = before.filter((e) => e.id.startsWith('asia-india-'));
  const chinaBefore = before.filter((e) => e.id.startsWith('asia-china-'));
  const otherAsia = before.filter(
    (e) => !e.id.startsWith('asia-india-') && !e.id.startsWith('asia-china-'),
  );
  if (otherAsia.length) {
    throw new Error('unexpected non-India non-China asia_lists entry: '
      + otherAsia.map((e) => e.id).join(', '));
  }

  // new asia_lists = existing India entries (untouched, same object references →
  // byte-identical) THEN new China entries (in cluster order).
  const newChina = entries.map((e) => ({
    id: e.id,
    label: e.label,
    count: e.count,
    selector: e.selector,
  }));
  obj.asia_lists = [...indiaEntries, ...newChina];

  return {
    obj,
    indiaCount: indiaEntries.length,
    chinaBeforeCount: chinaBefore.length,
    chinaAfterCount: newChina.length,
    raw,
  };
}

const entries = buildChinaEntries();
const { obj, indiaCount, chinaBeforeCount, chinaAfterCount } =
  rewriteClusters(entries);

console.log('China clusters:', entries.length);
for (const e of entries) {
  console.log(`  ${e.id}  [${e.count}]  ${e.region}  ::  ${e.members.join(', ')}`);
}
console.log(`\nasia_lists China entries: before=${chinaBeforeCount}  after=${chinaAfterCount}  (India kept=${indiaCount})`);

if (DRY) {
  console.log('\n--dry: no files written.');
} else {
  // (b) china-clusters.json  — canonical writer (trailing newline), as India did.
  writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2) + '\n');
  // (c) clusters.json — only the China slice of asia_lists mutated. NO trailing
  // newline; exact `JSON.stringify(obj,null,2)` — preserves the 09b-3 byte shape
  // so frozen non-China sections stay byte-identical.
  writeFileSync(CLUSTERS_PATH, JSON.stringify(obj, null, 2));
  console.log('\nwrote data/china-clusters.json + rewrote data/clusters.json (asia_lists China only)');
}
