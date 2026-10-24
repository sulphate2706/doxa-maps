// osm-basemap.mjs — STREET-LEVEL basemaps with NO TOKEN and NO ACCOUNT.
//
//   node osm-basemap.mjs <lat> <lng> <zoom> <outfile.png>
//
// ═══ WHY THIS EXISTS ════════════════════════════════════════════════════════
// City posters need streets and data, at a higher resolution than the polygon
// posters. An earlier static-image generator did this through Mapbox, but it is
// legacy and needs a Mapbox token, so a token-free alternative is better.
//
// Both halves of that were verified:
//   - the earlier generator's file is literally named `legacy-static-image-service.js` and
//     hits `api.mapbox.com/styles/v...` with `static mapboxToken`.
//   - The 100-list/country/city posters draw ADM0/ADM1 POLYGONS. That is correct
//     at country scale and useless at city scale: a 9km cluster needs STREETS,
//     and a polygon fill has none.
//
// THE TOKEN-FREE PATH: OpenStreetMap raster tiles. Verified 2026-08-01 —
// https://tile.openstreetmap.org/{z}/{x}/{y}.png returns a real 256x256 PNG with
// NO key and NO account, which is the whole point:
//   * a Mapbox token in a client-side poster generator is a credential to leak;
//   * a token means an account, and an account is a name — against the
//     no-account privacy stance for sensitive-context work;
//   * privacy-first: no third party gets to log who rendered what.
//
// ═══ USAGE POLICY IS A HARD CONSTRAINT, NOT A SUGGESTION ════════════════════
// OSM's tile servers are donated infrastructure. Their policy requires an
// identifying User-Agent, forbids bulk downloading, and expects heavy users to
// self-host. So this module:
//   * sends a real User-Agent
//   * CACHES every tile on disk and never re-fetches one
//   * rate-limits sequential fetches
//   * caps the tile count per render (a runaway zoom would be bulk downloading)
// For production volume the right answer is a self-hosted tile server or
// Protomaps pmtiles; this is correct and polite for poster-scale use.
//
// HD comes from TILE COUNT, not from a bigger source image: at z14 a 4x4 grid is
// 1024px of real street detail. Raising zoom raises detail AND tile count, which
// is why the cap exists.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, 'out', '_tilecache');

export const TILE_SOURCE = {
  name: 'OpenStreetMap raster tiles',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  licence: '© OpenStreetMap contributors, ODbL',
  attribution_required: true,
  no_key: true,
  policy: 'identifying User-Agent required; no bulk download; heavy use must self-host',
};

const UA = 'doxa-maps-poster/1.0 (people-group prayer posters; contact via repo)';
const MAX_TILES = 64;          // 8x8 — beyond this, self-host instead

// ── Web Mercator tile math (the standard slippy-map transform) ──────────────
export const lngToTileX = (lng, z) => ((lng + 180) / 360) * Math.pow(2, z);
export const latToTileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
};

/**
 * Fetch one tile, cached forever on disk. A cached tile is NEVER re-requested —
 * that is what keeps repeated poster builds off OSM's servers entirely.
 */
async function tile(z, x, y) {
  const f = join(CACHE, `${z}_${x}_${y}.png`);
  if (existsSync(f)) return readFileSync(f);
  // RETRY a transient failure before giving up on the whole basemap. OSM returns
  // 503 under load, and a single 503 was aborting an entire poster's tile grid —
  // the sheet then rendered with no streets at all, which the poster guard caught.
  // One flaky tile must not cost the map.
  let res = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { 'User-Agent': UA },
    });
    if (res.ok) break;
    if (res.status !== 503 && res.status !== 429) break;   // a real error, not load
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  if (!res || !res.ok) throw new Error(`tile ${z}/${x}/${y} -> HTTP ${res ? res.status : 'no response'}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  writeFileSync(f, buf);
  await new Promise((r) => setTimeout(r, 120));      // polite
  return buf;
}

/**
 * Fetch the tiles covering a bbox at a zoom, returning the grid + the exact
 * pixel-space geo transform so pins can be placed on the stitched image.
 *
 * Returns { tiles, cols, rows, px, py, width, height, project }.
 * `project(lng,lat)` gives pixel coordinates ON THE STITCHED IMAGE — without it
 * a basemap is decoration, because nothing can be positioned on it.
 */
export async function fetchGrid(bbox, zoom) {
  const [w, s, e, n] = bbox;
  const x0 = Math.floor(lngToTileX(w, zoom));
  const x1 = Math.floor(lngToTileX(e, zoom));
  const y0 = Math.floor(latToTileY(n, zoom));       // north = smaller y
  const y1 = Math.floor(latToTileY(s, zoom));
  const cols = x1 - x0 + 1, rows = y1 - y0 + 1;

  if (cols * rows > MAX_TILES) {
    throw new Error(`[osm] ${cols}x${rows}=${cols * rows} tiles exceeds the ${MAX_TILES} cap — `
      + 'lower the zoom or self-host a tile server. Bulk downloading OSM is against their policy.');
  }

  const tiles = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      tiles.push({ x: tx, y: ty, col: tx - x0, row: ty - y0, buf: await tile(zoom, tx, ty) });
    }
  }

  const width = cols * 256, height = rows * 256;
  const project = (lng, lat) => [
    (lngToTileX(lng, zoom) - x0) * 256,
    (latToTileY(lat, zoom) - y0) * 256,
  ];
  return { tiles, cols, rows, x0, y0, zoom, width, height, project };
}

/**
 * Pick the highest zoom whose tile grid still fits the cap for this bbox.
 * Detail is a function of zoom, so taking the most we are allowed is the whole
 * "make them more HD" ask — bounded by the policy rather than by guesswork.
 */
export function bestZoom(bbox, maxTiles = MAX_TILES) {
  for (let z = 16; z >= 3; z--) {
    const cols = Math.floor(lngToTileX(bbox[2], z)) - Math.floor(lngToTileX(bbox[0], z)) + 1;
    const rows = Math.floor(latToTileY(bbox[1], z)) - Math.floor(latToTileY(bbox[3], z)) + 1;
    if (cols * rows <= maxTiles) return z;
  }
  return 3;
}

// CLI smoke test
if (process.argv[1] && process.argv[1].endsWith('osm-basemap.mjs')) {
  const [lat, lng, z] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4] || 13)];
  const d = 0.05;
  const bbox = [lng - d, lat - d, lng + d, lat + d];
  const g = await fetchGrid(bbox, z);
  console.log(`[osm] ${g.cols}x${g.rows} tiles @ z${z} = ${g.width}x${g.height}px`);
  console.log(`[osm] pin at centre -> ${g.project(lng, lat).map((v) => v.toFixed(0)).join(',')}`);
  console.log(`[osm] cache: ${CACHE}`);
}
