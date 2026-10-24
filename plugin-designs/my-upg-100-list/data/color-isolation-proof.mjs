#!/usr/bin/env node
// color-isolation-proof.mjs — slice 09b toolC §1(d) · THE LOAD-BEARING GATE
//
//   node plugin-designs/my-upg-100-list/data/color-isolation-proof.mjs
//
// Proves, can-fail, that recoloring a my-upg-100-list zone has ZERO blast radius:
//
//   1. md5 the ENTIRE shared registry src/config/color-strategies/* (10 files) and
//      clusters.json BEFORE a color set.
//   2. set-zone-color.mjs asia-india-gujarat #ff0000  (a real override write).
//   3. md5 the shared registry + clusters.json AFTER  → assert BYTE-IDENTICAL
//      (zero bytes changed in anything shared / in the partition data).
//   4. Rebuild the my-upg-100-list IIFE WITH the override, then md5 the sibling
//      bundles (simple-map.js, research-map-embed.js, geo-steward.js) before vs
//      after → assert BYTE-IDENTICAL (recoloring this app rebuilds nothing shared).
//   5. ALWAYS revert the test override (restore zone-colors.json to its pre-test
//      bytes) so the committed tree is clean — even if an assertion throws.
//
// If the legend-tree hook ever reached into shared src, or the build coupled the
// bundles, one of these md5 comparisons diverges and the proof exits non-zero.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));            // .../data
const ROOT = join(HERE, '..', '..', '..');                       // map-bundler root
const SHARED_DIR = join(ROOT, 'src', 'config', 'color-strategies');
const CLUSTERS = join(HERE, 'clusters.json');
const STORE = join(HERE, 'zone-colors.json');
const SETTER = join(HERE, 'set-zone-color.mjs');
const APP_DIR = join(ROOT, 'app');
const SIBLINGS = ['simple-map.js', 'research-map-embed.js', 'geo-steward.js'];

const TEST_ZONE = 'asia-india-gujarat';
const TEST_HEX = '#ff0000';

function md5(file) {
  return createHash('md5').update(readFileSync(file)).digest('hex');
}

// Hash every file in the shared registry dir (sorted, path-prefixed) into ONE digest.
function dirDigest(dir) {
  const files = readdirSync(dir)
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort();
  const h = createHash('md5');
  for (const f of files) h.update(f).update('\0').update(readFileSync(join(dir, f)));
  return { digest: h.digest('hex'), files };
}

function siblingDigests() {
  const out = {};
  for (const s of SIBLINGS) out[s] = md5(join(APP_DIR, s));
  return out;
}

function assert(cond, msg) {
  if (!cond) throw new Error('ISOLATION-FAIL: ' + msg);
}

const log = (...a) => console.log(...a);

// Snapshot the store bytes so we can restore EXACTLY (even if it was non-empty).
const storeBytesBefore = readFileSync(STORE);

let failed = null;
try {
  log('== color isolation proof (toolC §1d) ==');

  // ── 1. baselines ──────────────────────────────────────────────────────────
  const sharedBefore = dirDigest(SHARED_DIR);
  const clustersBefore = md5(CLUSTERS);
  log(`shared registry (${sharedBefore.files.length} files) digest BEFORE: ${sharedBefore.digest}`);
  log(`clusters.json md5 BEFORE: ${clustersBefore}`);
  assert(sharedBefore.files.length === 10, `expected 10 shared-registry files, got ${sharedBefore.files.length}`);
  const sibBefore = siblingDigests();
  log('sibling bundles BEFORE:');
  for (const s of SIBLINGS) log(`  ${s}: ${sibBefore[s]}`);

  // ── 2. write a real override ────────────────────────────────────────────────
  log(`\nset-zone-color ${TEST_ZONE} ${TEST_HEX} ...`);
  execFileSync('node', [SETTER, TEST_ZONE, TEST_HEX], { stdio: 'inherit' });
  const storeNow = JSON.parse(readFileSync(STORE, 'utf8'));
  assert(storeNow[TEST_ZONE] === TEST_HEX, `override not written for ${TEST_ZONE}`);

  // ── 3. shared registry + clusters UNCHANGED after the color set ─────────────
  const sharedAfterSet = dirDigest(SHARED_DIR);
  const clustersAfterSet = md5(CLUSTERS);
  log(`\nshared registry digest AFTER set:  ${sharedAfterSet.digest}`);
  log(`clusters.json md5 AFTER set:       ${clustersAfterSet}`);
  assert(sharedAfterSet.digest === sharedBefore.digest,
    'shared color-strategies registry CHANGED after a my-upg color set');
  assert(clustersAfterSet === clustersBefore,
    'clusters.json (partition data) CHANGED after a color set');
  log('PASS  shared registry + clusters byte-identical after the color set');

  // ── 4. rebuild WITH the override; siblings byte-identical ───────────────────
  log(`\nrebuild my-upg-100-list IIFE with the ${TEST_HEX} override ...`);
  execFileSync('npx', ['vite', 'build'], {
    cwd: ROOT,
    env: { ...process.env, BUNDLE: 'my-upg-100-list' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  // confirm the override actually flowed into THIS bundle
  const myBundle = readFileSync(join(APP_DIR, 'my-upg-100-list.js'), 'utf8');
  assert(myBundle.includes('ff0000') || myBundle.includes('#ff0000'),
    'override #ff0000 did NOT reach the my-upg-100-list bundle (hook broken)');
  log('PASS  override #ff0000 present in app/my-upg-100-list.js');

  const sharedAfterBuild = dirDigest(SHARED_DIR);
  assert(sharedAfterBuild.digest === sharedBefore.digest,
    'shared registry CHANGED during the my-upg build');
  const sibAfter = siblingDigests();
  log('sibling bundles AFTER build:');
  let sibOk = true;
  for (const s of SIBLINGS) {
    const same = sibAfter[s] === sibBefore[s];
    sibOk = sibOk && same;
    log(`  ${s}: ${sibAfter[s]} ${same ? '(identical)' : '(CHANGED!)'}`);
  }
  assert(sibOk, 'a sibling bundle changed during the my-upg recolor build');
  log('PASS  shared registry + all sibling bundles byte-identical across the recolor build');

  log('\n== ISOLATION PROOF GREEN — recoloring my-upg-100-list touches NOTHING shared ==');
} catch (e) {
  failed = e;
} finally {
  // ── 5. ALWAYS revert the test override → clean tree ─────────────────────────
  execFileSync('node', [SETTER, TEST_ZONE, '--clear'], { stdio: 'inherit' });
  // restore EXACT pre-test bytes (handles any prior hand-set overrides + formatting)
  const { writeFileSync } = await import('node:fs');
  writeFileSync(STORE, storeBytesBefore);
  log(`reverted ${TEST_ZONE} test override → zone-colors.json restored to pre-test bytes`);
}

if (failed) {
  console.error(String(failed.message || failed));
  process.exit(1);
}
