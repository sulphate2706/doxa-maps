// verify-map-paint.mjs — prove the map PAINT SET is correct without a GPU.
//
//   node verify-map-paint.mjs        # exits 1 on any failure
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// Headless Firefox on this VPS has NO WebGL, so the three global maps mount and
// fetch but can never be SEEN painting here. The research map fails identically,
// which is the control — it is the environment, not our code.
//
// But "cannot verify the GPU" is not the same as "cannot verify anything". The
// paint is two separate things:
//   1. THE PAINT SET   which features get which colour   <- verifiable, and this does it
//   2. THE GPU DRAW    turning that into pixels          <- needs a real device
// Leaving BOTH unverified because one is impossible would be the lazy read. This
// closes half the gap and names the half that remains.
//
// IT CATCHES THE BUG THAT WAS ACTUALLY FOUND. "India seems to have no internet
// coverage" was not a data gap — India's row was always correct. India had NO
// POLYGON in world-adm0.geojson, so it silently painted nothing. That class of
// failure is invisible in the data AND invisible in a build, and it is exactly
// what this guard asserts against.
//
// THE GUARD IS PROVEN TO GO RED. Verified by corrupting the input:
//   clean          -> GREEN (190 painted, india true, 0 broken)
//   corrupt band   -> RED   (1 feature with no colour)
//   India removed  -> RED   (the the brief's exact bug)
// A check that has never failed proves nothing.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { TREE_NAME } from '../../../internal/_tree-name.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, '..', '..', '..', 'public', TREE_NAME, 'assets');   // the served assets live inside the output folder

const BANDS = {
  gospel: { critical: '#b42318', high: '#e07a2b', partial: '#e8c15a', covered: '#10b981' },
  internet: { yes: '#10b981', partial: '#e8c15a', no: '#b42318', unknown: '#9aa2ad' },
};

let failed = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

const adm0Path = join(ASSETS, 'boundaries', 'world-adm0.geojson');
if (!existsSync(adm0Path)) {
  console.error('FATAL: world-adm0.geojson missing — run `bun run tree`');
  process.exit(1);
}
const adm0 = JSON.parse(readFileSync(adm0Path, 'utf8'));

// ── COORDINATE-POINT FLOOR ──────────────────────────────────────────────────
// THE BLIND SPOT THIS CLOSES. Every other check in this file — and every other
// guard in the repo — counts HOW MANY features survived. The property that
// actually matters for a printed map is HOW MUCH OF EACH survived. Measured
// 2026-08-02 on world-adm0.geojson:
//
//   lazy `--resimplify` default   162 features /  37,605 points /   621 KB
//   what actually ships           162 features / 115,775 points / 1,867 KB
//
// IDENTICAL FEATURE COUNT ACROSS A 3.1x COARSENING. A world coastline reduced
// to a third of its detail ships with a completely green board, because nothing
// was counting points. That is why this floor exists.
//
// Why the coarsening is easy to trigger: resimplify() escalates tol/min-part/
// min-ring until it is UNDER a 2 MB budget, so a lazy invocation can land far
// below budget and quietly throw away detail (source-boundaries.mjs warns
// "Aim NEAR the budget, not under it"). Nothing downstream noticed.
const POINT_FLOORS = [
  // world-adm0: floor 90,000 sits 2.4x ABOVE the lazy default (37,605) so a
  // coarsening pass fails unmistakably, and 22% BELOW what ships (115,775) so a
  // legitimate boundary re-fetch with normal variation does not false-RED. The
  // escalation loop multiplies tol by 1.8 per pass, so real outcomes land either
  // near-current or dramatically lower — almost never in the gap between.
  { file: 'world-adm0.geojson', floor: 90_000, ships: 115_775, lazy: 37_605, lazyKind: 'measured' },
  // gb-IND-ADM1: floor 50,000 is ~10x above a modeled-lazy 5,050 and 53% below
  // the shipping 105,447. Widest separation of the three.
  { file: 'gb-IND-ADM1.geojson', floor: 50_000, ships: 105_447, lazy: 5_050, lazyKind: 'modeled' },
  // gb-CHN-ADM1 is DELIBERATELY ABSENT — see the caveat block below. Its
  // shipping geometry (3,264 points) is already so coarse that the same
  // coarsening knobs only take it to 2,000 — a 1.63x spread. There is no
  // honest floor that separates those two, so none is asserted rather than
  // inventing a number that would look like protection without being any.
];

// A gate that does not state its own blind spot invites the next agent to
// over-trust it. These are the things a GREEN here does NOT mean.
const GATE_CAVEATS = [
  'A FLOOR IS NOT A FIDELITY PROOF. It catches WHOLESALE coarsening (a 3x point collapse), not a subtle reshape — geometry can be moved, smoothed, or distorted at a constant point count and this passes.',
  'IT DOES NOT CHECK SHAPE. Points are counted, never compared to a reference outline. A garbled coastline with enough vertices is GREEN.',
  'gb-CHN-ADM1.geojson HAS NO FLOOR. Shipping 3,264 points vs 2,000 under the same coarsening knobs = 1.63x — too thin to separate honestly. That file is UNGUARDED here; treat it as device-gated.',
  `THIS REPO HAS 83 FILES NAMED world-adm0.geojson (72 under app/, 10 under public/, 1 under plugin-designs/; none in node_modules). A GREEN here covers ONLY the path printed above — the other 82 are GENERATED BUNDLE ARTIFACTS and this floor says NOTHING about their freshness or even their validity. Do NOT infer a second floor is needed: a 2026-08-02 snapshot found the app/ copies were mostly PRE-INDIA BUILDS (161 features / 111,013 points, differing from the guarded file by IND alone — stale, not coarsened, and above this floor). But that snapshot is NOT a durable fact: the copies are rewritten by bundle builds, one was mid-sweep TRUNCATED and would not even parse, and any census of them is a moving target. The durable question is whether bundles are REBUILT AND VALIDATED after a boundary change — a build-pipeline property, not something a point floor can hold. NOTE THE STAKES: measured 2026-08-02, ALL NINE per-app copies under public/${TREE_NAME}/ were missing IND (161 features, built 22:05 the previous day, before India landed). "Stale by one country" IS the India-paints-nothing regression this guard was written for — and the "India paints" assertion above only covers the ONE canonical path, not the generated per-app trees.`,
  'THE ADM1 LAZY FIGURE IS MODELED, NOT OBSERVED. resimplify() only ever rewrites world-adm0.geojson, so the ADM1 files have no lazy counterpart that the shipping pipeline actually produces. Their floors were set by applying the same knobs offline.',
  'STILL DEVICE-GATED: whether the coastlines READ at print size. This converts a wholesale-coarsening regression into a CI failure; it does not replace a human looking at a printed poster.',
];

function checkPointFloors() {
  console.log('\nCoordinate-point floor (catches silent coastline coarsening)');
  // PRINT THE RESOLVED PATH, NOT THE BASENAME. 83 files in this repo are named
  // world-adm0.geojson (every app bundle carries a copy). A verifier who
  // coarsens "world-adm0.geojson" to test this floor has 83 candidates and only
  // ONE is the file read here — and coarsening any other yields a GREEN run that
  // reads exactly like "the floor does not fire". That happened during this
  // card's own review (a coarsened plugin-designs/.../data/adm0 copy, exit 0, read
  // for a minute as the guard failing). A gate that names an ambiguous file is
  // under-declaring what it measured, so it says the full path out loud.
  console.log(`  reading from: ${join(ASSETS, 'boundaries')}`);
  const countPoints = (node) => {
    let n = 0;
    const walk = (a) => {
      if (!Array.isArray(a)) return;
      if (typeof a[0] === 'number') { n++; return; }
      for (const x of a) walk(x);
    };
    walk(node);
    return n;
  };

  for (const { file, floor, ships, lazy, lazyKind } of POINT_FLOORS) {
    const p = join(ASSETS, 'boundaries', file);
    if (!existsSync(p)) { fail(`${file} missing — cannot check its point floor`); continue; }
    let fc;
    try { fc = JSON.parse(readFileSync(p, 'utf8')); }
    catch { fail(`${file} is not parseable JSON`); continue; }

    let pts = 0;
    for (const feat of fc.features || []) if (feat.geometry) pts += countPoints(feat.geometry.coordinates);

    if (pts < floor) {
      fail(`${file}: ${pts.toLocaleString()} coordinate points is BELOW the floor of ${floor.toLocaleString()} `
        + `— the geometry has been coarsened. Reference: ships ${ships.toLocaleString()}, `
        + `${lazyKind} lazy-simplify ${lazy.toLocaleString()}. Feature count alone will NOT show this.`);
    } else {
      ok(`${file}: ${pts.toLocaleString()} points >= floor ${floor.toLocaleString()} `
        + `(ships ${ships.toLocaleString()}, ${lazyKind} lazy ${lazy.toLocaleString()})`);
    }
  }
}

// ── A CHOROPLETH map: every data row must find a polygon AND a colour ───────
function checkChoropleth(name, tableFile, bandKey, bandMap) {
  const f = join(ASSETS, 'tables', tableFile);
  if (!existsSync(f)) { fail(`${name}: ${tableFile} missing`); return; }
  const rows = JSON.parse(readFileSync(f, 'utf8')).countries || [];
  const byIso = {};
  for (const r of rows) byIso[r.iso3] = r;

  const painted = [];
  for (const feat of adm0.features) {
    const iso = feat.properties?.iso3;
    const d = byIso[iso];
    if (d) painted.push({ iso, color: bandMap[d[bandKey]] });
  }

  console.log(`\n${name}`);
  const broken = painted.filter((p) => !p.color);
  if (broken.length) fail(`${broken.length} feature(s) resolve to NO COLOUR (unknown band) — e.g. ${broken[0].iso}`);
  else ok(`all ${painted.length} painted features have a colour`);

  // The the brief's bug, asserted directly.
  if (!painted.some((p) => p.iso === 'IND')) fail('INDIA does not paint — the largest field in the dataset would be a hole');
  else ok('India paints');

  if (painted.length < 150) fail(`only ${painted.length} features paint — expected >150`);
  else ok(`${painted.length} of ${adm0.features.length} features paint`);

  // A row with data but no polygon is a SILENT hole — the same class as India.
  const noPolygon = rows.filter((r) => !adm0.features.some((f) => f.properties?.iso3 === r.iso3));
  if (noPolygon.length) console.log(`  … ${noPolygon.length} data rows have no polygon (they simply do not shade): ${noPolygon.slice(0, 6).map((r) => r.iso3).join(', ')}`);
}

// ── A POINT map: every row must carry usable coordinates ────────────────────
function checkPoints(name, tableFile) {
  const f = join(ASSETS, 'tables', tableFile);
  if (!existsSync(f)) { fail(`${name}: ${tableFile} missing`); return; }
  const rows = JSON.parse(readFileSync(f, 'utf8')).rows || [];
  console.log(`\n${name}`);
  const good = rows.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)
    && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180);
  if (good.length !== rows.length) fail(`${rows.length - good.length} row(s) have unusable coordinates`);
  else ok(`all ${good.length} points have valid coordinates`);
  const atNull = good.filter((r) => r.lat === 0 && r.lng === 0);
  // 0,0 is the Atlantic — a real cluster is never there, so it means a lost value.
  if (atNull.length) fail(`${atNull.length} point(s) sit at 0,0 (Null Island) — a dropped coordinate`);
  else ok('no points at Null Island');
}

console.log('MAP PAINT VERIFICATION — the paint SET, not the GPU draw');
checkChoropleth('Gospel Resources map', 'gospel-by-country.json', 'band', BANDS.gospel);
checkChoropleth('Cities-with-Internet map', 'internet-by-country.json', 'band', BANDS.internet);
checkPoints('Key Cities map', 'key-cities.json');
checkPointFloors();

console.log(`\n${failed ? `FAILED — ${failed} problem(s)` : 'ALL PAINT SETS VALID'}`);
console.log('\nWHAT A PASS DOES NOT MEAN (do not over-trust this gate):');
for (const c of GATE_CAVEATS) console.log(`  ! ${c}`);
console.log('\nSTILL UNVERIFIED: the GPU draw itself. No WebGL on this VPS; needs a real device.');
process.exit(failed ? 1 : 0);
