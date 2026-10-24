// verify-bundles-shipped.mjs — assert the SHIPPED bundles match what was declared.
//
//   node verify-bundles-shipped.mjs
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// Found by sweeping for DECLARED-BUT-UNASSERTED CONTRACTS — a heuristic that already
// paid out twice in this repo: the poster crossing counts were computed and printed
// for months and never gated, and out/tables/index.json declared table names and row
// counts that nothing checked. Both times the expected state was already written
// down; only the assertion was missing.
//
// public/doxa-maps/manifest.json is the third. generate-tree.mjs WRITES it —
// bundleCount, profileCount, every bundle's output path and custom-element names —
// and nothing reads it back. So a build that silently dropped a bundle would ship a
// shell whose nav entry 404s, with every other check still green: the bundles that
// DID build verify fine, and a per-bundle check cannot see a bundle that is absent.
//
// This is the same shape as the two fail-opens fixed the same day (a zone missing
// from a per-run manifest read as zero crossings; a deleted country read as correct).
// ABSENT IS NOT CLEAN — it is unverified, and it has to be loud.
//
// PROVEN RED: hide a shipped bundle .js, or edit bundleCount, and this must fail.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { TREE_NAME } from '../../../internal/_tree-name.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', '..', '..', 'public');
const MF = join(PUBLIC, TREE_NAME, 'manifest.json');

let failed = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('SHIPPED BUNDLES — does the build match its own manifest?');

if (!existsSync(MF)) { console.error(`FATAL: public/${TREE_NAME}/manifest.json missing — run the build`); process.exit(1); }
const m = JSON.parse(readFileSync(MF, 'utf8'));
const bundles = m.bundles || [];

// The manifest must agree with ITSELF first — a count that disagrees with the list
// means the generator and the data drifted apart.
if (bundles.length !== m.bundleCount) fail(`bundleCount says ${m.bundleCount} but ${bundles.length} bundles are listed`);
else ok(`bundleCount ${m.bundleCount} matches the list`);

const profiles = bundles.reduce((n, b) => n + (b.profiles || []).length, 0);
if (profiles !== m.profileCount) fail(`profileCount says ${m.profileCount} but ${profiles} profiles are listed`);
else ok(`profileCount ${m.profileCount} matches the list`);

// Then it must agree with DISK. A declared bundle whose file is absent is a nav entry
// that 404s at runtime — invisible to every other guard.
for (const b of bundles) {
  const p = join(PUBLIC, b.output);
  if (!existsSync(p)) { fail(`${b.bundle}: declared ${b.output} is MISSING on disk — its nav entry would 404`); continue; }
  const bytes = readFileSync(p).length;
  // A bundle that builds to almost nothing is a broken build, not a small app.
  if (bytes < 20_000) fail(`${b.bundle}: ${b.output} is only ${bytes} bytes — build collapsed`);
  // ── THE INLINE TRAP ──────────────────────────────────────────────────────
  // public/ is the SERVED directory, NOT part of the bundle: apps read data via
  // fetch(`${assetsBase}/tables/x.json`) at runtime, which is why key-cities.js is
  // 230KB while its table is ~900KB. That separation is held by ONE fragile rule —
  // fetch() stays out, `import` comes IN. vite builds these as a single IIFE with
  // inlineDynamicImports:true, so ONE static import of a data file inlines it. That
  // has already happened here: a single import took two bundles to 2.0MB / 2.9MB.
  // With a 7.7MB people-groups file now in public/assets, an accidental import
  // would produce an ~8MB bundle. A ceiling catches it the moment it happens.
  // The ceiling was set at ~2x the largest bundle of its day (683 KB); country-posters now sits at about
  // 1.47 MB of it, so there is little headroom left and a per-bundle pin may fit better (open question).
  // Reported in BYTES: the old MiB figures printed "1.4MB" for a 1,500,000-byte ceiling and "1.6MB" for
  // 1,662,962 bytes, which is two different units in one sentence.
  const MAX = 1_500_000;
  if (bytes > MAX) {
    fail(`${b.bundle}: ${b.output} is ${bytes.toLocaleString('en-US')} bytes (ceiling ${MAX.toLocaleString('en-US')}) `
      + '— a data file was almost certainly IMPORTED instead of fetched. public/ assets must be fetch()ed at runtime, never imported.');
  }
  if (!(b.elements || []).length) fail(`${b.bundle}: declares NO custom elements — nothing to mount`);
}
if (!failed) ok(`all ${bundles.length} declared bundles present, non-trivial, and declare elements`);

console.log(`\n${failed ? `FAILED — ${failed} problem(s)` : 'SHIPPED BUNDLES MATCH THE MANIFEST'}`);
process.exit(failed ? 1 : 0);
