#!/usr/bin/env node
/**
 * drop-portability-check.mjs — the executable half of the commit-2 DONE gate #1
 * (2026-07-11: "paste that folder into Cloudflare Drop and it would work").
 *
 * A dropped/subpath-hosted tree breaks on ROOT-RELATIVE references ("/doxa-maps/...",
 * src="/...", href="/...") — they resolve against the HOST origin, not the tree.
 * Position-independence = every intra-tree reference is RELATIVE (./ or ../).
 *
 * Usage:  node internal/drop-portability-check.mjs [treeDir]
 *         (default treeDir: app/<name> read from vite.doxa-maps-build-config.json)
 * Exit 0 = PORTABLE (drop-safe) · Exit 1 = root-relative refs found (listed).
 *
 * Wired into package.json after `tree`:  "check:drop": "node internal/drop-portability-check.mjs"
 * TEST-THE-SEE: run BEFORE the relative-path fix -> must FAIL listing manifest.json refs;
 * after the fix -> PASS; a tree with only ./relative refs must stay PASS (benign case).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TREE_NAME } from './_tree-name.mjs'

const here = dirname(fileURLToPath(import.meta.url));
const bundlerRoot = resolve(here, '..');

let treeDir = process.argv[2];
if (!treeDir) {
  let name = TREE_NAME;
  const cfgPath = join(bundlerRoot, 'vite.doxa-maps-build-config.json');
  if (existsSync(cfgPath)) {
    try { name = JSON.parse(readFileSync(cfgPath, 'utf8')).name || name; } catch {}
  }
  treeDir = join(bundlerRoot, 'public', name);
}
if (!existsSync(treeDir)) {
  console.error(`drop-portability-check: tree not found: ${treeDir} (run the build first)`);
  process.exit(1);
}

// Root-relative reference patterns that break under subpath hosting.
// Matches "/anything/... inside href/src/url attrs and JSON string values, but NOT
// protocol URLs (https://, //cdn) and NOT data:/#.
const ATTR_RE = /(?:src|href)\s*=\s*"(\/(?!\/)[^"]*)"/g;          // src="/..." href="/..."
const JSON_RE = /"(?:iframeUrl|scriptUrl|url|embedUrl|output)"\s*:\s*"(\/(?!\/)[^"]*)"/g;

const findings = [];
// ★ COVERAGE COUNTER — see the MIN_FILES assertion below for why this exists.
let scanned = 0;

function scan(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { scan(p); continue; }
    if (!/\.(html|json)$/.test(e)) continue;
    scanned++;
    const text = readFileSync(p, 'utf8');
    const rel = relative(treeDir, p);
    for (const re of [ATTR_RE, JSON_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) findings.push({ file: rel, ref: m[1] });
    }
  }
}
scan(treeDir);

// ★ COVERAGE ASSERTION — "no root-relative refs found" and "nothing was searched" are the SAME
// EXIT CODE without this. Verified 2026-09-20: pointed at an EMPTY directory, this script printed
// its confident PASS line and exited 0. A tree gutted by a per-bundle `BUNDLE=x vite build` (which
// empties other bundles' leaf pages) would therefore sail straight through check:drop, exactly as
// it sails through check:sri — a gate that walks only what EXISTS is structurally blind to absence.
// This is the LIVENESS-vs-CORRECTNESS class: "the scan ran" is not "the tree is portable".
// Found by APPLYING that rule to the other gates, not by hitting the bug in production.
// ★ THE FLOOR IS DERIVED, NOT HARDCODED — because a hardcoded floor DECAYS INTO A SLOGAN.
// The first version of this assertion used a flat MIN_FILES=20 against a 76-file tree: 74% slack,
// so it would have passed a tree that had lost 56 of its 76 files while printing a confident PASS.
// That is the same defect one layer up — "a threshold that cannot fail is a PASS with extra
// arithmetic" (named by the grid-palette agent, 2026-09-20). A constant encodes the tree that
// existed WHEN THE GATE WAS WRITTEN, and every build after that widens the gap.
// So derive the expectation from manifest.json, which the build REGENERATES every time: it records
// bundleCount + profileCount, giving a known-good shape that cannot go stale. Each bundle emits at
// least a leaf index.html, each profile its own page, plus the root index.html + manifest.json.
// EXPECTED remains a FLOOR, not an equality: nested/composite profiles emit extra pages this
// arithmetic does not model (predicted 59 vs an actual 76). TOLERANCE absorbs that legitimate
// drift while still catching the gutted-tree case this exists for.
// ★ HONEST LIMITATION — say it rather than imply precision: at 44-vs-76 there is still ~42% slack,
// so this catches a CATASTROPHICALLY gutted tree, not a tree that quietly lost a few pages. It is
// strictly better than the flat 20 (74% slack) and, unlike a constant, it TIGHTENS AUTOMATICALLY as
// the manifest grows. If you want a precise assertion, model the remaining page classes here rather
// than raising TOLERANCE — a tolerance nudged upward until it stops complaining is how a floor
// decays back into a slogan.
const TOLERANCE = 0.75; // fail if the tree is below 75% of the shape the manifest describes
let expected = 0;
let basis = 'flat floor (manifest unreadable)';
try {
  const mf = JSON.parse(readFileSync(join(treeDir, 'manifest.json'), 'utf8'));
  const bundles = Number(mf.bundleCount) || 0;
  const profiles = Number(mf.profileCount) || 0;
  // Instance pages are real emitted pages and the manifest knows them, so COUNT THEM rather than
  // absorbing them into slack — every term recovered here tightens the floor. Measured 2026-09-20:
  // 17 bundles + 26 profiles + 14 instances + 2 root files = 59 vs an actual 76. Ignoring instances
  // predicted 45, which left so much slack the floor barely constrained anything.
  const list = Array.isArray(mf.bundles) ? mf.bundles : Object.values(mf.bundles || {});
  const instances = list.reduce((n, b) =>
    n + (b.profiles || []).reduce((m, pr) => m + ((pr.instances || []).length), 0), 0);
  if (bundles && profiles) {
    expected = Math.floor((bundles + profiles + instances + 2) * TOLERANCE);
    basis = `manifest ${bundles} bundle(s) + ${profiles} profile(s) + ${instances} instance(s), ${TOLERANCE * 100}% tolerance`;
  }
} catch { /* fall through to the flat floor below */ }
const MIN_FILES = Number(process.env.MIN_FILES || expected || 20);
if (scanned < MIN_FILES) {
  console.error(`DROP-PORTABILITY: FAIL — scanned only ${scanned} html/json file(s) (expected >=${MIN_FILES} from ${basis}).`);
  console.error('  A near-empty tree cannot demonstrate portability; it just has nothing to find.');
  console.error('  Run a FULL build (`bun run build`), or set MIN_FILES if this tree is legitimately small.');
  process.exit(1);
}

if (findings.length) {
  console.error(`DROP-PORTABILITY: FAIL — ${findings.length} root-relative ref(s); tree breaks under subpath hosting (Cloudflare-Drop class):`);
  const byFile = {};
  for (const f of findings) (byFile[f.file] ||= []).push(f.ref);
  for (const [file, refs] of Object.entries(byFile)) {
    console.error(`  ${file}  (${refs.length})`);
    for (const r of refs.slice(0, 4)) console.error(`     ${r}`);
    if (refs.length > 4) console.error(`     … +${refs.length - 4} more`);
  }
  console.error('FIX: make intra-tree refs RELATIVE (./bundle/profile/...); absolute embed snippets are computed at RUNTIME from location.');
  process.exit(1);
}
console.log(`DROP-PORTABILITY: PASS — ${scanned} html/json file(s) scanned (floor ${MIN_FILES} from ${basis}), no root-relative refs; tree is position-independent (file://, Drop, subpath, Railway all behave identically).`);
