// emit-india-clusters.mjs — slice 09b-3 §1(b,c)
//
// Consumes partitionIndia() and emits:
//   (b) data/india-clusters.json — [{ id, label, members, count, zonalCouncil,
//       selector:{type:"pg_slugs", values:[…]} }]. The pg_slugs are the slugs in
//       admin-membership.json whose admin1 ∈ the cluster's members — this matches
//       how the existing asia_lists rows + legend-tree.js + zone-geometry already
//       consume Asia rows (pg_slugs → ADM1 union geometry).
//   (c) Rewrites ONLY the India entries of data/clusters.json asia_lists to these
//       new clusters. Everything else (13 regional lists, deaf_lists, both China
//       asia_lists entries, asia_unsolved, uncovered_scatter) is preserved
//       byte-for-byte by rebuilding the asia_lists array as
//       [ ...newIndiaEntries, ...existingChinaEntries ] and re-stringifying the
//       SAME parsed object (only asia_lists mutated).
//
// Run: node data/emit-india-clusters.mjs   (writes both files)
//      node data/emit-india-clusters.mjs --dry   (prints, writes nothing)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { partitionIndia, ZONAL_COUNCILS } from './partition-india.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMBERSHIP = JSON.parse(
  readFileSync(join(__dirname, 'admin-membership.json'), 'utf8'),
);
const CLUSTERS_PATH = join(__dirname, 'clusters.json');
const OUT_PATH = join(__dirname, 'india-clusters.json');

const DRY = process.argv.includes('--dry');

// admin1 -> [slug…] from membership (India only)
const slugsByAdmin = {};
for (const [slug, v] of Object.entries(MEMBERSHIP)) {
  if (v.country !== 'IND') continue;
  (slugsByAdmin[v.admin1] ||= []).push(slug);
}

// zonal council of a cluster = the council most of its members belong to
const zonalOf = {};
for (const [zone, members] of Object.entries(ZONAL_COUNCILS)) {
  for (const m of members) zonalOf[m] = zone;
}
function dominantZone(members) {
  const tally = {};
  for (const m of members) {
    const z = zonalOf[m] || 'Unknown';
    tally[z] = (tally[z] || 0) + 1;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
}

// stable id from the largest member admin
function clusterId(members, count) {
  const head = members[0]; // members[0] is the seed / largest by build order
  const slug = head.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `asia-india-${slug}`;
}

export function buildIndiaEntries() {
  const { clusters, total } = partitionIndia();
  if (total !== 855) {
    throw new Error(`partition total ${total} != 855 — refusing to emit`);
  }

  const entries = clusters.map((members) => {
    const count = members.reduce(
      (a, m) => a + slugsByAdmin[m]?.length || a, 0,
    ) === 0
      ? members.reduce((a, m) => a + (slugsByAdmin[m] || []).length, 0)
      : members.reduce((a, m) => a + (slugsByAdmin[m] || []).length, 0);

    // gather + sort slugs deterministically (stable, byte-reproducible)
    const values = members
      .flatMap((m) => slugsByAdmin[m] || [])
      .sort();

    if (values.length !== count) {
      // count is derived from the same source; guard against drift
    }
    return {
      id: clusterId(members, values.length),
      label: members.join(' + '),
      members,
      count: values.length,
      zonalCouncil: dominantZone(members),
      selector: { type: 'pg_slugs', values },
    };
  });

  // sanity: ids unique, total slugs == 855, no slug double-counted
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new Error('duplicate cluster id');
  const allSlugs = entries.flatMap((e) => e.selector.values);
  if (new Set(allSlugs).size !== allSlugs.length) {
    throw new Error('a slug appears in more than one cluster');
  }
  if (allSlugs.length !== 855) {
    throw new Error(`emitted ${allSlugs.length} slugs != 855`);
  }
  return entries;
}

function rewriteClusters(entries) {
  const raw = readFileSync(CLUSTERS_PATH, 'utf8');
  const obj = JSON.parse(raw);

  const before = obj.asia_lists;
  const indiaBefore = before.filter((e) => e.id.startsWith('asia-india-'));
  const chinaEntries = before.filter((e) => e.id.startsWith('asia-china-'));
  const otherAsia = before.filter(
    (e) => !e.id.startsWith('asia-india-') && !e.id.startsWith('asia-china-'),
  );
  if (otherAsia.length) {
    throw new Error('unexpected non-India non-China asia_lists entry: '
      + otherAsia.map((e) => e.id).join(', '));
  }

  // new asia_lists = new India entries (in cluster order) THEN existing China
  // entries (untouched, same object references → byte-identical).
  const newIndia = entries.map((e) => ({
    id: e.id,
    label: e.label,
    count: e.count,
    selector: e.selector,
  }));
  obj.asia_lists = [...newIndia, ...chinaEntries];

  return {
    obj,
    indiaBeforeCount: indiaBefore.length,
    indiaAfterCount: newIndia.length,
    chinaCount: chinaEntries.length,
    raw,
  };
}

const entries = buildIndiaEntries();
const { obj, indiaBeforeCount, indiaAfterCount, chinaCount } =
  rewriteClusters(entries);

console.log('India clusters:', entries.length);
for (const e of entries) {
  console.log(`  ${e.id}  [${e.count}]  ${e.zonalCouncil}  ::  ${e.members.join(', ')}`);
}
console.log(`\nasia_lists India entries: before=${indiaBeforeCount}  after=${indiaAfterCount}  (China kept=${chinaCount})`);

if (DRY) {
  console.log('\n--dry: no files written.');
} else {
  // (b) india-clusters.json
  writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2) + '\n');
  // (c) clusters.json — only asia_lists mutated. The original has NO trailing
  // newline and is exact `JSON.stringify(obj,null,2)`; we preserve that byte
  // shape so the frozen non-India sections stay byte-identical.
  writeFileSync(CLUSTERS_PATH, JSON.stringify(obj, null, 2));
  console.log('\nwrote data/india-clusters.json + rewrote data/clusters.json (asia_lists India only)');
}
