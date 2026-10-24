// check-poster-raster — a poster with NO pre-rendered image must still download.
//
// ★ THE POINT: 378 posters ship as .webp — 41 MB in every clone, delivered to every
// reader whether or not they open one, and a publish was ALREADY rejected once at a
// 74 MB asset tree. Not shipping ~80 MB of images in a public folder, and letting
// the website generate the posters, is a big win.
//
// The fallback rasterises posters/<id>.html in the browser. This gate proves the
// generated image is REAL, because the failure mode here is silent and total:
//
// ⚠ AN SVG LOADED THROUGH <img> IS AN ISOLATED DOCUMENT. It cannot see the host
// page's CSS, so every var() falls back to its initial value — and `fill`'s initial
// value is BLACK. A poster that lost its stylesheet downloads as a black rectangle
// with no error, no exception and a perfectly normal file size. So this gate
// MEASURES PIXELS: mean luminance and colour variety, not "did it produce bytes".
//
// Usage: node internal/check-poster-raster.mjs [zoneId]
//   PACKET_ORIGIN (default http://127.0.0.1:4898)
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'

const ORIGIN = process.env.PACKET_ORIGIN || 'http://127.0.0.1:4898'
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(ORIGIN, ROOT, 'POSTER-RASTER')
const ZONE = process.argv[2] || 'laos'
const HTML = `${ORIGIN}/library/scripts/posters/out/posters/${ZONE}.html`

const b = await chromium.launch()
const pg = await b.newPage({ viewport: { width: 1200, height: 900 } })
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 140)))
await pg.goto(ORIGIN + '/')

const r = await pg.evaluate(async ({ ORIGIN, HTML }) => {
  const { rasterPoster, looksRendered, inlineSvg } =
    await import(`${ORIGIN}/library/packet/poster-raster.js`)
  const res = await fetch(HTML)
  if (!res.ok) return { error: `poster HTML ${res.status}` }
  const html = await res.text()

  // The stylesheet must actually travel with the svg.
  const svg = inlineSvg(html)
  const carriesCss = /<style>/.test(svg)

  const blob = await rasterPoster(html, { scale: 2 })
  const ok = await looksRendered(blob)

  // Independent pixel read: sample a grid and count distinct coarse colours. A
  // black rectangle has ~1; a real poster has many.
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = 200; c.height = 260
  const x = c.getContext('2d')
  x.drawImage(bmp, 0, 0, 200, 260)
  const d = x.getImageData(0, 0, 200, 260).data
  const seen = new Set()
  let sum = 0
  for (let i = 0; i < d.length; i += 4) {
    sum += (d[i] + d[i + 1] + d[i + 2]) / 3
    seen.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`)
  }
  return { bytes: blob.size, w: bmp.width, h: bmp.height, ok, carriesCss,
           meanLuma: Math.round(sum / (d.length / 4)), colours: seen.size }
}, { ORIGIN, HTML })
await b.close()

if (r.error) { console.error(`POSTER-RASTER: FAIL — ${r.error}`); process.exit(1) }

const fails = []
if (!r.carriesCss) fails.push('the inlined SVG carries no <style> — every fill will render BLACK')
if (!r.bytes) fails.push('no image produced')
if (r.w < 1000 || r.h < 1000) fails.push(`rasterised at ${r.w}x${r.h} — too small to print`)
if (r.meanLuma < 60) fails.push(`mean luminance ${r.meanLuma} — the poster rendered dark/black`)
if (r.colours < 12) fails.push(`only ${r.colours} distinct colours — this is not a painted poster`)
if (!r.ok) fails.push('looksRendered() rejected the output')
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

console.log(`  zone            : ${ZONE}`)
console.log(`  rasterised      : ${r.w} x ${r.h}`)
console.log(`  image bytes     : ${(r.bytes / 1024).toFixed(0)} KB`)
console.log(`  stylesheet inline: ${r.carriesCss}`)
console.log(`  mean luminance  : ${r.meanLuma}   (near 0 = black = CSS lost)`)
console.log(`  distinct colours: ${r.colours}`)

if (fails.length) {
  console.error(`\nPOSTER-RASTER: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`\nPOSTER-RASTER: PASS — ${ZONE} generates a real ${r.w}x${r.h} poster with no pre-rendered image.`)
