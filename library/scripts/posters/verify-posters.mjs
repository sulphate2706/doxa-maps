// verify-posters.mjs — assert the RENDERED poster, not the generator's intent.
//
//   node verify-posters.mjs                # every poster in out/posters
//   node verify-posters.mjs city-          # only city sheets
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// generate.mjs already has fail-loud guards, but they check what the generator
// BELIEVES before it draws. Every real poster defect this session was found by a
// human looking at a picture:
//   • label running off the sheet edge   (x=1479.7 vs a 1474 edge)
//   • a ~25x over-zoom from a +1 DEGREE padding floor — 8 pins as a dot
//   • 36 OSM tiles correctly placed and INVISIBLE (opacity 0.72 + saturate 0.55)
//   • the zone polygon painted OVER the streets it was supposed to reveal
// Not one of those trips a generator-side guard. They are all properties of the
// RENDERED artefact, so that is what this measures — via getBBox in the real
// renderer, which is the discipline the poster README already mandates and which
// nothing was actually enforcing.
//
// FIREFOX, never Chromium (privacy-first: no third-party browser telemetry). No WebGL needed: an SVG poster is DOM.
//
// THE GUARD IS ONLY WORTH ITS GREEN IF IT CAN GO RED. Each check below states the
// real defect it would have caught, so a future reader can corrupt an input and
// confirm the assertion still fires.

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { firefox } from 'playwright';
import { requireThisTree } from '../../../internal/_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.POSTER_DIR || join(__dirname, 'out', 'posters');
const PREFIX = process.argv[2] || '';
const ROOT = _resolvePath(_dirnamePath(fileURLToPath(import.meta.url)), '../../..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(PREFIX, ROOT, 'POSTERS')

if (!existsSync(DIR)) { console.error('no out/posters — run the generator first'); process.exit(1); }
const files = readdirSync(DIR).filter((f) => f.endsWith('.html') && f.startsWith(PREFIX));
if (!files.length) { console.error(`no posters matching "${PREFIX}"`); process.exit(1); }

// The generator records a crossing count per zone; load it so the render check can
// assert on it instead of silently trusting a number nobody reads.
let crossingsByZone = null;
try {
  const mf = JSON.parse(readFileSync(join(DIR, '..', 'manifest.json'), 'utf8'));
  const entries = Array.isArray(mf) ? mf : (mf.posters || mf.entries || []);
  crossingsByZone = Object.fromEntries(entries.filter((e) => e && e.zoneKey)
    .map((e) => [e.zoneKey, e.crossings || 0]));
} catch { crossingsByZone = null; }

const browser = await firefox.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 2000 } });

const problems = [];
let checked = 0;

for (const f of files) {
  const page = await ctx.newPage();
  await page.goto(`file://${join(DIR, f)}`);
  await page.waitForTimeout(120);

  const r = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    const vb = (svg?.getAttribute('viewBox') || '0 0 1500 1500').split(/\s+/).map(Number);
    const [, , W, H] = vb;
    const clip = document.querySelector('#mapclip rect');
    const box = clip ? {
      x: +clip.getAttribute('x'), y: +clip.getAttribute('y'),
      w: +clip.getAttribute('width'), h: +clip.getAttribute('height'),
    } : null;

    // 1. LABELS INSIDE THE SHEET. Caught "Eastern Xiangxi Miao" at x=1479.7.
    const over = [];
    for (const e of document.querySelectorAll('text.lbl')) {
      const b = e.getBBox();
      if (b.x + b.width > W - 20 || b.x < 20) over.push(e.textContent.trim().slice(0, 30));
    }

    // 2. PIN SPREAD. Caught the +1-degree over-zoom: 8 pins in a 51x40px dot
    //    inside an 840x853 frame. A cluster that occupies <8% of the frame is not
    //    a map of that place, it is a map of the region around it.
    const cx = [], cy = [];
    for (const c of document.querySelectorAll('circle')) {
      const x = +c.getAttribute('cx'), y = +c.getAttribute('cy');
      if (Number.isFinite(x) && Number.isFinite(y)) { cx.push(x); cy.push(y); }
    }
    const spread = cx.length > 1 && box
      ? { fx: (Math.max(...cx) - Math.min(...cx)) / box.w, fy: (Math.max(...cy) - Math.min(...cy)) / box.h }
      : null;

    // 3. BASEMAP VISIBILITY. Caught 36 tiles placed correctly and rendered
    //    invisible. Placement alone is not evidence — the opacity has to be read.
    const tiles = [...document.querySelectorAll('image')];
    const layer = tiles[0]?.closest('g');
    const op = layer ? parseFloat(getComputedStyle(layer).opacity || '1') : null;

    return {
      W, H, box,
      title: document.querySelector('text.h1')?.textContent?.trim().slice(0, 40) || '',
      labels: document.querySelectorAll('text.lbl').length,
      overflow: over,
      pins: cx.length,
      spread,
      tiles: tiles.length,
      tileOpacity: op,
      hasScripture: !!document.body.textContent.match(/MARK 6:40|MATTHEW 9:36/i),
      // How many DISTINCT source locations this sheet plots. Coincident pins are a
      // data property; the renderer's fanned-out pixels would hide that, so read
      // the stamped truth coordinates rather than cx/cy.
      stampedPins: document.querySelectorAll('circle[class^="pin"][data-lng]').length,
      distinctCoords: new Set([...document.querySelectorAll('circle[class^="pin"][data-lng]')]
        .map((c) => `${c.getAttribute('data-lng')},${c.getAttribute('data-lat')}`)).size,
      // The GEOGRAPHIC span of the true coordinates, in degrees. Counting distinct
      // coordinate STRINGS is too coarse: Nagercoil plots three "distinct" points
      // that span 0.0006 x 0.0012 deg — about 65m x 130m, one city block, differing
      // only in gazetteer rounding. No framing can spread that, so like the fully
      // coincident case it is a data property rather than a framing bug.
      geoSpan: (() => {
        const pts = [...document.querySelectorAll('circle[class^="pin"][data-lng]')]
          .map((c) => [+c.getAttribute('data-lng'), +c.getAttribute('data-lat')])
          .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
        if (pts.length < 2) return 0;
        const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
        return Math.max(Math.max(...lng) - Math.min(...lng), Math.max(...lat) - Math.min(...lat));
      })(),
    };
  });

  r.zoneKey = f.replace(/\.html$/, '');
  const bad = [];
  if (r.overflow.length) bad.push(`label off-sheet: ${r.overflow[0]}`);
  if (!r.labels) bad.push('NO name labels');
  if (!r.pins) bad.push('NO pins');
  if (!r.hasScripture) bad.push('scripture band missing');
  // SPREAD, judged only where spread is a MEANINGFUL signal.
  //
  // I chased Kasaragod and Nagercoil as over-zoom for three rounds. They are not.
  // Measured from source: their people groups carry IDENTICAL lat/lng — several
  // groups pinned at one city centroid, because that is the only location the
  // gazetteer gives for them. The bbox is therefore DEGENERATE (zero extent), and
  // the pin de-overlap relaxation then fans those coincident pins into a line at
  // exactly MIN_SEP pitch. Kasaragod's four pins measured 18.75px apart with a
  // y-span of exactly 0 — that is the repulsion artifact, not a geography.
  //
  // So a low spread has TWO different causes and only one is a defect:
  //   * distinct coordinates squeezed small   -> over-zoom, a FRAMING bug, fixable
  //   * coincident coordinates fanned apart   -> a DATA property, unfixable by zoom
  // Padding a degenerate bbox cannot spread points that occupy one spot. Flagging
  // it would be an assertion that can never go green, and a guard that cannot be
  // satisfied gets ignored — which costs more than it catches.
  //
  // The distinguishing test is the SOURCE coordinates, not the rendered pixels:
  // count how many distinct locations the sheet actually plots.
  // A MISSING stamp must be LOUD. If data-lng ever stops being emitted,
  // distinctCoords reads 0 and the spread check below would silently switch
  // itself off — a guard that quietly stops guarding is worse than none.
  if (r.pins && !r.stampedPins) bad.push('pins carry no data-lng/data-lat stamp — spread check cannot run');
  // 0.005 deg ~= 550m: below this the pins describe a single locality, and the
  // basemap is already at OSM's max zoom, so a small on-sheet spread is the honest
  // rendering rather than a defect.
  if (r.geoSpan > 0.005 && r.pins > 3) {
    const widest = r.spread ? Math.max(r.spread.fx, r.spread.fy) : null;
    if (widest !== null && widest < 0.08) {
      bad.push(`pins occupy <8% of the frame (${(r.spread.fx * 100).toFixed(1)}% x ${(r.spread.fy * 100).toFixed(1)}%) `
        + `across ${r.distinctCoords} distinct locations — over-zoomed`);
    }
  }
  // 4. LEADER CROSSINGS. The generator already COUNTS these and the whole label
  //    layout is built to hold them at zero ("ORTHOGONAL-DOMINANT so crossings
  //    stay at zero by construction"), but nothing asserted it — so 36 of 173
  //    country sheets shipped with crossing leaders (sdn 536, bra 599, chn 990)
  //    and every one passed this guard. A crossed leader points at the wrong pin,
  //    which on a prayer poster misattributes a people group to a place.
  //    Read from the manifest the generator writes, not re-derived here.
  // FAIL LOUDLY WHEN THE COUNT IS ABSENT, never treat missing as zero.
  // The manifest is rewritten by EVERY generator run and only covers the zones THAT
  // run produced — so building the 3x4 China tier overwrote the 173-country manifest,
  // and this check then found no entry for 173 sheets and passed them all. Crossings
  // appeared to drop 36 -> 1: the guard had gone blind, not the posters improved.
  // A sheet with no recorded count is UNVERIFIED, which is not the same as clean.
  if (crossingsByZone) {
    const n = crossingsByZone[r.zoneKey];
    if (n === undefined) {
      bad.push('no crossing count in manifest.json for this zone — regenerate this tier '
        + '(the manifest only covers the LAST generator run) before trusting this sheet');
    } else if (n) {
      bad.push(`${n} leader crossing(s) — a leader that crosses points at the wrong pin`);
    }
  }
  if (r.tiles && r.tileOpacity !== null && r.tileOpacity < 0.5) {
    bad.push(`basemap present but ~invisible (opacity ${r.tileOpacity})`);
  }

  if (bad.length) problems.push({ file: f, title: r.title, bad });
  checked++;
  if (checked % 40 === 0) console.log(`  … ${checked}/${files.length}`);
  await page.close();
}

await browser.close();

console.log(`\nPOSTER VERIFICATION — ${checked} rendered sheets measured via getBBox`);
if (!problems.length) {
  console.log('ALL CLEAN — no off-sheet labels, no empty sheets, no over-zoom, no invisible basemaps');
} else {
  console.log(`${problems.length} sheet(s) with problems:`);
  for (const p of problems.slice(0, 25)) {
    console.log(`  ✗ ${p.title || p.file}`);
    for (const b of p.bad) console.log(`      ${b}`);
  }
}
process.exit(problems.length ? 1 : 0);
