// retag-adm1.mjs — slice 09b-7 §1(a) reproducible ADM1 listId re-tag
//
//   node plugin-designs/my-upg-100-list/data/retag-adm1.mjs
//
// THE BUG (09b-6 honest visual gate): gb-IND-ADM1.geojson + gb-CHN-ADM1.geojson
// features carry STALE `listId` tags from the OLD pre-09b-3/09b-4 partition. The
// 09b-3/09b-4 slices rewrote the cluster SELECTORS (clusters.json / india-/
// china-clusters.json) but never re-tagged the geojson. zone-geometry.js resolves
// an Asia zone's polygons by `feature.properties.listId === zone.id` (zone-geometry.js:77),
// so a stale tag → 0 polygons → the 4 renamed clusters (asia-india-odisha,
// asia-india-assam, asia-china-yunnan-province, asia-china-tibet-autonomous-region)
// paint nothing.
//
// THE FIX (data-only): the CURRENT authoritative cluster→members mapping lives in
// india-clusters.json (10) + china-clusters.json (2). Every ADM1 feature's
// `shapeName` appears in exactly ONE cluster's `members`. So the correct `listId`
// for a feature = the id of the cluster whose `members` contains its `shapeName`.
//
// Property verified against zone-geometry.js: it matches on `listId` ONLY (the
// feature props are exactly {shapeName, listId}; there is NO sibling list_id key).
// So we re-tag `listId` and nothing else.
//
// R-D2: a feature whose shapeName matches NO cluster must be 0. If any appear we
// LOG loudly, LEAVE the old tag (do not drop), and flag for a product decision — never
// silently mis-tag.
// R-D3: stable canonical writer — match the existing on-disk style EXACTLY
// (single-line minified JSON, no trailing newline) so the diff is the listId
// strings ONLY.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Build shapeName -> clusterId lookup from a clusters source. Loud on duplicates
// (a member in two clusters would make the re-tag ambiguous — must never happen).
function buildLookup(clusters, srcLabel) {
  const lu = new Map();
  for (const c of clusters) {
    for (const member of c.members || []) {
      if (lu.has(member) && lu.get(member) !== c.id) {
        console.log(`FATAL  ${srcLabel}: member "${member}" is in TWO clusters ` +
          `(${lu.get(member)} and ${c.id}) — ambiguous re-tag, aborting.`);
        process.exit(1);
      }
      lu.set(member, c.id);
    }
  }
  return lu;
}

// Re-tag one geojson file in place. Returns { retagged, unchanged, unmatched, diffs }.
function retagFile(fileName, lookup) {
  const path = join(__dirname, fileName);
  const geo = readJSON(path);
  const diffs = [];       // { shapeName, old, new } for every CHANGED feature
  const unmatched = [];   // shapeNames with no cluster (R-D2: leave old tag + flag)
  let retagged = 0, unchanged = 0;

  for (const f of geo.features || []) {
    const props = f.properties || (f.properties = {});
    const shapeName = props.shapeName;
    const correct = lookup.get(shapeName);
    if (correct === undefined) {
      // R-D2: no cluster owns this shapeName — must be 0. Leave the old tag, flag.
      unmatched.push({ shapeName, keptOld: props.listId });
      continue;
    }
    const old = props.listId;
    if (old === correct) {
      unchanged++;
    } else {
      props.listId = correct;
      retagged++;
      diffs.push({ shapeName, old, new: correct });
    }
  }

  // R-D3: write back in the EXACT existing on-disk style: single-line minified
  // JSON, NO trailing newline. JSON.stringify with no spacer reproduces it.
  writeFileSync(path, JSON.stringify(geo));

  return { fileName, total: (geo.features || []).length, retagged, unchanged, unmatched, diffs };
}

function report(r) {
  console.log(`\n## ${r.fileName}`);
  console.log(`   features: ${r.total}   re-tagged: ${r.retagged}   already-correct: ${r.unchanged}   unmatched: ${r.unmatched.length}`);
  if (r.diffs.length) {
    console.log(`   old → new listId diff (${r.diffs.length}):`);
    for (const d of r.diffs) {
      console.log(`     ${d.shapeName.padEnd(42)} ${String(d.old).padEnd(44)} → ${d.new}`);
    }
  }
  if (r.unmatched.length) {
    console.log(`   *** UNMATCHED (R-D2: should be 0 — LEFT old tag, FLAGGED for review) ***`);
    for (const u of r.unmatched) {
      console.log(`     !!! ${u.shapeName.padEnd(42)} kept old listId=${u.keptOld}`);
    }
  }
}

function main() {
  console.log('================ 09b-7 §1a RE-TAG ADM1 listId ================');
  const indClusters = readJSON(join(__dirname, 'india-clusters.json'));
  const chnClusters = readJSON(join(__dirname, 'china-clusters.json'));
  console.log(`india-clusters: ${indClusters.length} clusters   china-clusters: ${chnClusters.length} clusters`);

  const indLookup = buildLookup(indClusters, 'india-clusters.json');
  const chnLookup = buildLookup(chnClusters, 'china-clusters.json');

  const rInd = retagFile('gb-IND-ADM1.geojson', indLookup);
  const rChn = retagFile('gb-CHN-ADM1.geojson', chnLookup);

  report(rInd);
  report(rChn);

  const totalRetagged = rInd.retagged + rChn.retagged;
  const totalUnmatched = rInd.unmatched.length + rChn.unmatched.length;

  // Spotlight the 4 zones the QA names: prove they now own features.
  const focus = new Set([
    'asia-india-odisha', 'asia-india-assam',
    'asia-china-yunnan-province', 'asia-china-tibet-autonomous-region',
  ]);
  const owners = {};
  for (const r of [rInd, rChn]) {
    const geo = readJSON(join(__dirname, r.fileName));
    for (const f of geo.features) {
      const id = f.properties.listId;
      if (focus.has(id)) (owners[id] ||= []).push(f.properties.shapeName);
    }
  }
  console.log(`\n## the 4 previously-blank clusters now own these ADM1 features:`);
  for (const id of focus) {
    const m = owners[id] || [];
    console.log(`   ${id.padEnd(40)} ${m.length} polys  ${JSON.stringify(m)}`);
  }

  console.log(`\n================ SUMMARY ================`);
  console.log(`total re-tagged: ${totalRetagged}   total unmatched: ${totalUnmatched}`);
  if (totalUnmatched > 0) {
    console.log(`FAIL  ${totalUnmatched} feature(s) matched NO cluster (R-D2 violation) — see FLAGGED rows above.`);
    process.exit(1);
  }
  console.log(`PASS  every ADM1 feature mapped to exactly one current cluster.`);
  process.exit(0);
}

main();
