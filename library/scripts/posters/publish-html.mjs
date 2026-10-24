// publish-html.mjs — put the poster HTML where the app can fetch it, so the
// browser can rasterise a poster instead of the repo shipping 42 MB of .webp.
//
// ★ WHY THIS SCRIPT EXISTS. PosterWall falls back to rendering posters/<id>.html
// in the browser when no pre-rendered image is present (library/packet/
// poster-raster.js). That fallback was shipped and verified against a locally
// served file — but NOTHING PUBLISHED THE HTML. out/ is gitignored, public/ had
// zero .html, so deleting the .webp would have taken poster download from working
// to 404. The rasteriser worked; the feature would not have. This closes that gap.
//
// SCOPE — ZONE POSTERS ONLY, and that is a real distinction, not laziness:
//   zone posters  token-free, drawn from bundled geoBoundaries. Reproducible
//                 offline by anyone with the repo -> safe to stop shipping as
//                 images, because the HTML regenerates the picture.
//   city posters  need CITIES=1 BASEMAP=1 and fetch OSM STREET TILES at generation
//                 time. NOT reproducible offline. Deleting those .webp would make
//                 them unrecoverable without network, so they stay as images.
// Treating "42 MB of posters" as one homogeneous pile would have deleted the
// irreproducible half.
//
// ⚠ RUNNING THIS DOES NOT, BY ITSELF, SHRINK THE REPO. Measured with real git
// packs, for the 24 zone posters that render:
//   webp   5.0 MB raw  ->  ~5.0 MB packed   (already compressed; git cannot pack it)
//   HTML  21.4 MB raw  ->   5.78 MB packed  (text, and highly repetitive across posters)
// Swapping one for the other is about +0.8 MB PACKED — a net loss, not the 42 MB
// win the headline suggests. Do not ship that swap and call it a saving.
//
// WHERE THE REAL 22 MB IS: 176 city-* posters, which this script deliberately does
// not touch because they need OSM tiles to regenerate. The zone posters were never
// the expensive half.
//
// So what is this FOR? Two things that are true regardless of size:
//   1. It is the missing half of the browser-rasterise fallback. That fallback
//      fetches posters/<id>.html and nothing published it, so a zone whose image is
//      absent 404s today. Run this and the fallback has an input.
//   2. It makes the HTML the SOURCE a reader can rasterise at any resolution,
//      instead of one fixed raster — useful for a host that would rather serve text
//      and let the browser do the work.
// Use it when you are dropping the images deliberately, not as a size optimisation.
//
//   node publish-html.mjs            # all zone posters found in out/
//   ONLY=laos node publish-html.mjs  # one

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'out', 'posters');
const REPO = resolve(__dirname, '..', '..', '..');
// ⚠ data/posters, NOT public/assets/posters. public/assets/<name> is a GENERATED
// MIRROR: generate-tree.mjs rmSync's it and re-copies data/<name> over it on every
// `bun run tree`, so anything written there is deleted by the next build. This
// script wrote there and its output therefore never survived — which is a large
// part of why the browser-rasterise fallback still had no input months after it
// shipped. data/ is the tracked source the mirror is made from.
const DEST = join(REPO, 'data', 'posters');
const ONLY = process.env.ONLY || '';

if (!existsSync(SRC)) {
  console.error(`[publish-html] no ${SRC} — run \`node generate.mjs\` first.`);
  process.exit(1);
}

// ★ THE ZONE IDS THE APP CAN ACTUALLY REACH — ask the LEGEND, not clusters.json.
// Enumerating the raw cluster keys is what this used to do, and it is wrong:
// clusters.json carries 30 list definitions but the legend exposes 28 leaves.
// deaf-old-world and deaf-new-world-asia-pacific are SUPERSEDED by the unified
// `deaf` row (affinity bloc A017) — verified against live data, 63 + 60 = 123 =
// A017 exactly, with zero groups on either side of the difference. They are kept
// in clusters.json deliberately (three isolation-proof scripts assert
// deaf_lists.length === 2), but no user can select them, so a poster for them is
// unreachable. Enumerating them made this script warn that two zones were
// "MISSING" when nothing was missing at all.
const clusters = JSON.parse(readFileSync(
  join(REPO, 'plugin-designs', 'my-upg-100-list', 'data', 'clusters.json'), 'utf8'));
const { buildLegendNodes, leafZones } = await import(
  pathToFileURL(join(REPO, 'plugin-designs', 'my-upg-100-list', 'data', 'legend-tree.js')).href);
const zoneIds = new Set(leafZones(buildLegendNodes(clusters, { records: null })).map((z) => z.id));

mkdirSync(DEST, { recursive: true });

let published = 0;
let bytes = 0;
const skipped = [];
for (const file of readdirSync(SRC)) {
  if (!file.endsWith('.html')) continue;
  // ★ PAPER FORMATS CARRY A SUFFIX (generate.mjs FILE_SUFFIX): <zone>.packet.html is page 1 of the
  // prayer packet, <zone>.letter.html the poster on letter paper. The zone id is what precedes it —
  // taking everything before ".html" as the id reported every packet sheet as an unknown zone and
  // silently skipped it.
  const id = file.slice(0, -5).replace(/\.(packet|letter)$/, '');
  if (ONLY && id !== ONLY) continue;
  if (!zoneIds.has(id)) { skipped.push(id); continue; }
  const html = readFileSync(join(SRC, file), 'utf8');
  writeFileSync(join(DEST, file), html);
  published += 1;
  bytes += Buffer.byteLength(html);
}

console.log(`[publish-html] ${published} poster HTML -> data/posters/`);
console.log(`[publish-html] ${(bytes / 1048576).toFixed(1)} MB raw `
  + `(gzips to roughly a third over the wire)`);
if (skipped.length) {
  // Loud, not silent: a reader should know what was left behind and why.
  console.log(`[publish-html] skipped ${skipped.length} non-zone poster(s) `
    + `(city-* posters belong to Key Cities and need OSM tiles to regenerate)`);
}
const missing = [...zoneIds].filter((z) => !existsSync(join(SRC, `${z}.html`)));
if (missing.length && !ONLY) {
  console.warn(`[publish-html] ⚠ ${missing.length} zone(s) have NO poster HTML: `
    + `${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`);
  console.warn('[publish-html]   their download will 404 until generate.mjs covers them.');
}
