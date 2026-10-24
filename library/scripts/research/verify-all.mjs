// verify-all.mjs — run every DX corpus + app guard, in dependency order.
//
//   node verify-all.mjs            # data guards only (no browser, fast)
//   node verify-all.mjs --full     # + the browser guards (posters, live apps)
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// Eight guards were written across this flight, each catching a real defect that had
// already shipped. Scattered, they are worth much less than they look: nobody knows
// the list, so nobody runs them, and a guard nobody runs is documentation.
//
// The defects these caught, all of which passed every pre-existing check:
//   iso2-map        NER->NG gave NIGER Nigeria's data — byte-identical rows.
//                   FABRICATED data, which is worse than missing: a null is visibly
//                   unknown, a wrong-but-populated row gets used.
//   resource-join   `no_resource_found` is the corpus's most consequential claim.
//                   Verified BOTH directions against the RAW pools, because checking
//                   a table against its own input only proves faithfulness to that
//                   input and can never catch an error IN it.
//   tables-complete a per-item guard cannot catch a MISSING item. Every other check
//                   verifies tables it is GIVEN; none would notice one that stopped
//                   being produced. index.json already declared the expected set and
//                   row counts — the contract existed and was simply never asserted.
//   bundles-shipped nothing read back the build's OWN manifest (bundleCount,
//                   profileCount, each bundle's output path), so a dropped bundle
//                   would ship a nav entry that 404s with every other check green.
//   map-paint       India had NO polygon, so it silently painted nothing — invisible
//                   in the data AND invisible in a build.
//   posters         5 over-zoomed sheets; a FOOTER 17px short that made the generator
//                   throw on the FIRST zone so NO city poster rendered at all.
//   app-tables      the apps mount + actually fetch their tables at runtime.
//
// EXPECTED STATE TODAY: 5 PASS / 2 FAIL. The two FAILs are KNOWN, ROUTED, unfixed
// defects — NOT regressions, and NOT to be "fixed" by weakening a guard:
//   posters     41 of 350 sheets draw crossing leaders (bra 599, sdn 536, chn 990).
//               Root cause: a one-element dfrac sweep + leaders still drawn beside
//               the numbered badges + a DENSE_AT threshold that exists only as a
//               comment. Fixing it changes the look of 41 posters in the SHARED
//               template, which is a product design call.
//               ALSO expect ONE "no crossing count" failure for country-chn: it is
//               the 3x4 tier, built by a SEPARATE run, so the 173-country manifest
//               does not cover it. That is the guard refusing to call an unmeasured
//               sheet clean — working as designed, not a bug.
//   app-tables  4 requests per page load to api.mapbox.com, leaking the viewer's IP.
//               Removing it is a MAP-ENGINE change (the CDN globals are load-bearing),
//               so it is a design call. Fetches and rendered rows both PASS.
//
// ORDER MATTERS: iso2 feeds five consumers, so it runs first — if that map is wrong,
// every downstream table is keyed to the wrong country and the rest is noise.
//
// THE WAYS A CHECK LIES, all hit for real this flight and all now guarded:
//   wrong TARGET  — the test hit something else (a port bound by another project).
//   empty INPUT   — a side parsed to nothing, so everything "mismatches" (or passes).
//   derived-not-SOURCE — proves a table matches its own input, not that it is right.
//   stale GREEN   — the pass predates the assertion; adding a check invalidates every
//                   earlier run, so when a guard GROWS, re-run the whole corpus.
//   absent-as-CLEAN — `if (lookup[key])` conflates absent / falsey / zero. I wrote
//                   this bug TWICE in one day, in two different guards, while hunting
//                   this exact class elsewhere: verify-posters treated a zone missing
//                   from a per-run manifest as zero crossings (173 sheets passed), and
//                   verify-iso2-map let a DELETED country through while printing
//                   "NER … all correct". In verification ABSENT means UNVERIFIED and
//                   must fail LOUD, by name. Knowing a trap is not avoiding it — after
//                   fixing any fail-open, grep the SHAPE across every sibling check.
// Each guard below asserts its inputs are the ones it meant, at their known size,
// before believing anything. A guard that cannot fail is not a guard.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTERS = resolve(__dirname, '..', 'posters');
const FULL = process.argv.includes('--full');

const GUARDS = [
  { name: 'network-policy', file: join(__dirname, 'verify-network-policy.mjs'),
    why: 'this box READS published research and never PROBES — no active-measurement tooling, no non-allowlisted host' },
  { name: 'iso2-map',       file: join(__dirname, 'verify-iso2-map.mjs'),
    why: 'shared lookup — 5 consumers; a wrong code fabricates another country\'s data' },
  { name: 'resource-join',  file: join(__dirname, 'verify-resource-join.mjs'),
    why: 'no_resource_found, verified BOTH directions against the RAW pools' },
  { name: 'tables-complete', file: join(__dirname, 'verify-tables-complete.mjs'),
    why: 'the table SET is whole — a per-item guard cannot catch a MISSING item' },
  { name: 'bundles-shipped', file: join(__dirname, 'verify-bundles-shipped.mjs'),
    why: 'the SHIPPED build matches its own manifest — a dropped bundle 404s silently' },
  { name: 'map-paint',      file: join(__dirname, 'verify-map-paint.mjs'),
    why: 'every data row resolves to a polygon AND a colour' },
  { name: 'posters',        file: join(POSTERS, 'verify-posters.mjs'), browser: true,
    why: 'the RENDERED sheet, measured via getBBox in Firefox' },
  { name: 'app-tables',     file: join(__dirname, 'verify-app-tables.mjs'), browser: true,
    why: 'the live apps mount and fetch their tables (needs a server — see the file)' },
];

const results = [];
for (const g of GUARDS) {
  if (g.browser && !FULL) { results.push([g.name, 'skipped', '--full not passed']); continue; }
  if (!existsSync(g.file)) { results.push([g.name, 'MISSING', g.file]); continue; }
  console.log(`\n${'─'.repeat(72)}\n▶ ${g.name} — ${g.why}\n${'─'.repeat(72)}`);
  const r = spawnSync(process.execPath, [g.file], { stdio: 'inherit', cwd: dirname(g.file) });
  results.push([g.name, r.status === 0 ? 'PASS' : 'FAIL', r.status === 0 ? '' : `exit ${r.status}`]);
}

console.log(`\n${'═'.repeat(72)}\nDX VERIFICATION SUMMARY\n${'═'.repeat(72)}`);
for (const [name, status, note] of results) {
  const mark = status === 'PASS' ? '✓' : status === 'skipped' ? '·' : '✗';
  console.log(`  ${mark} ${name.padEnd(16)} ${status}${note ? '  — ' + note : ''}`);
}
// A MISSING guard is a FAILURE, not a skip: it means the file was deleted or moved
// and the coverage silently vanished. Only an explicit --full opt-out is a skip.
const failed = results.filter(([, s]) => s === 'FAIL' || s === 'MISSING');
console.log(failed.length ? `\nFAILED — ${failed.length} guard(s)` : '\nALL GUARDS PASS');
if (!FULL) console.log('(browser guards skipped — re-run with --full)');
process.exit(failed.length ? 1 : 0);
