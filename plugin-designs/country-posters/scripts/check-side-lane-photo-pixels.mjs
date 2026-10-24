#!/usr/bin/env node
// check:side-lane-photo-pixels — a BROWSER gate (browser seat only: internal/browser-slot.sh; elsewhere exit 75,
// NOT MEASURED). The 60x96 side-lane sheet, rendered by the real poster-render.js, rasterised by the real
// poster-raster.js, measured in PIXELS at every photo slot:
//   - a data: photo (a local red fixture, so it is offline) DRAWS: its slot is red;
//   - every photo on its own host stays FLAT (the paper shows through): never the broken-image glyph, which is
//     what an external <image> rasterises as inside an SVG loaded as an image.
//   - every photo's box is CLEAR of its own name's REAL drawn box (getBBox, the loaded font), never on its letters,
//     and every name's box is clear of every OTHER photo (a long inner-column name must not run into the outer
//     column's photo on the row above or below).
// --self-test: the same raster WITHOUT stripExternalImages must leave external slots NOT flat (the glyph), and a
// renderer that places the photo from an estimated width must put photos on names.
// Its source-level twin, always measured, is check:side-lanes' photo arms.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const { chromium } = await import(join(ROOT, 'internal/lib/playwright-guarded.mjs'))
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
// a 4x4 red PNG, built here (no file)
function png(w, h, rgb) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)))])))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const RED = 'data:image/png;base64,' + png(4, 4, [230, 20, 20]).toString('base64')
const { createPosterGenerator } = await import(join(ROOT, 'library/packet/poster-render.js'))
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pins = Array.from({ length: 300 }, (_, i) => ({ name: `Group ${i}`, lat: 8 + rnd() * 27, lng: 68 + rnd() * 28, slug: `g${i}`, country_code: 'IND', population: 1000 + i,
  image_url: i % 3 === 0 ? `https://media.joshuaproject.net/public/assets/media/profiles/photos/p${10120 + i}.jpg` : 'https://s3.doxa.life/no-photo-images/asia.jpg' }))
const adm0 = J('public/dx-maps/assets/boundaries/world-adm0.geojson')
const zone = { id: 'country-ind', zoneKey: 'country-ind', label: 'India', count: pins.length, color: '#d4a640', adm0: ['IND'], selector: { type: 'country_codes', values: ['IND'] } }
const RENDER_SRC = readFileSync(join(ROOT, 'library/packet/poster-render.js'), 'utf8')
const genOf = (cpg) => cpg({ env: { FORMAT: '60x96', SPARSE: '1', POSTER_DATE: '2026-10-01' }, SERIES_DEF: J('library/scripts/posters/series.json').country, ISO3_NAME: { IND: 'India' }, adm0, adm1Ind: null, adm1Chn: null, nePlaces: [], series: { totalGroups: pins.length, totalLists: 1, index: 1 } })
const gen = createPosterGenerator({ env: { FORMAT: '60x96', SPARSE: '1', POSTER_DATE: '2026-10-01' }, SERIES_DEF: J('library/scripts/posters/series.json').country, ISO3_NAME: { IND: 'India' }, adm0, adm1Ind: null, adm1Chn: null, nePlaces: [], series: { totalGroups: pins.length, totalLists: 1, index: 1 } })
let { html } = await gen.renderPoster(zone, pins, { type: 'FeatureCollection', features: adm0.features.filter((f) => f.properties?.iso3 === 'IND') })
html = html.replace(/(<image href=")https:[^"]+(")/, `$1${RED}$2`)          // the FIRST photo becomes the local fixture
const slots = [...html.matchAll(/<image href="([^"]+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({ data: m[1].startsWith('data:'), x: +m[2], y: +m[3], s: +m[4] }))
const vb = html.match(/<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/); const W = vb ? +vb[1] : 2500
const cur = readFileSync(join(ROOT, 'library/packet/poster-raster.js'), 'utf8')
const poison = cur.replace('stripExternalImages(inlineSvg(posterHtml))', 'inlineSvg(posterHtml)')
if (poison === cur) throw new Error('poison anchor moved')
console.log(`sheet: ${slots.length} photo slots (${slots.filter((s) => s.data).length} data: fixture, ${slots.filter((s) => !s.data).length} external), viewBox width ${W}`)
const selfTest = process.argv.includes('--self-test')
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
let verdict = 0
try {
  await page.setContent('<!doctype html><html><body></body></html>')
  for (const [label, src] of selfTest ? [['POISON (no strip)', poison]] : [['CURRENT', cur]]) {
    const r = await page.evaluate(async ({ src, html, slots, W }) => {
      const mod = await import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
      const blob = await mod.rasterPoster(html, { scale: 0.5, type: 'image/png' })
      const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
      const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0); const k = bmp.width / W
      const stat = (s) => { const x = Math.round((s.x + s.s * 0.2) * k), y = Math.round((s.y + s.s * 0.2) * k), n = Math.max(2, Math.round(s.s * 0.6 * k))
        const d = ctx.getImageData(x, y, n, n).data; let r = 0, g = 0, b = 0, v = 0; const px = d.length / 4
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] } r /= px; g /= px; b /= px
        for (let i = 0; i < d.length; i += 4) v += Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b)
        return { r: Math.round(r), g: Math.round(g), b: Math.round(b), varr: +(v / px).toFixed(1) } }
      const bg = stat({ x: 2, y: 2, s: 30 })
      const fix = slots.filter((s) => s.data).map(stat)
      const ext = slots.filter((s) => !s.data).map(stat)
      const near = (a) => a.varr <= 6   // flat: nothing drawn in the slot (paper shows through)
      return { size: [bmp.width, bmp.height], bg, fixture: fix, extBackground: ext.filter(near).length, extTotal: ext.length, extSample: ext.filter((a) => !near(a)).slice(0, 3) }
    }, { src, html, slots, W })
    const redOk = r.fixture.length && r.fixture.every((a) => a.r > 180 && a.g < 80 && a.b < 80)
    const flatAll = r.extBackground === r.extTotal && r.extTotal > 0
    if (selfTest) verdict = r.extBackground === 0 ? 0 : 1
    else verdict = redOk && flatAll ? 0 : 1
    console.log(`${label}: raster ${r.size.join('x')}, background rgb(${r.bg.r},${r.bg.g},${r.bg.b}); fixture slot ${JSON.stringify(r.fixture)} -> ${redOk ? 'DRAWS (red)' : 'NOT drawn'}; external slots FLAT (nothing drawn): ${r.extBackground}/${r.extTotal}${r.extSample.length ? ' non-background e.g. ' + JSON.stringify(r.extSample) : ''}`)
  }
  // PHOTO vs ITS NAME, by the real drawn boxes. Self-test: the estimated-width placement (the shipped defect).
  let boxHtml = html
  if (selfTest) {
    const a = 'const slot = slotOf(g, font), tx = L ? x - slot : x + slot;', bb = 'const px = L ? x - PHOTO : x;'
    const poisoned = RENDER_SRC.replace(a, 'const tx = x;').replace(bb, 'const tw = textW(String(g.name), font) * 1.06, px = L ? x - tw - PHOTO_GAP - PHOTO : x + tw + PHOTO_GAP;')
    const { createPosterGenerator: cpg } = await import('data:text/javascript;base64,' + Buffer.from(poisoned).toString('base64'))
    boxHtml = (await genOf(cpg).renderPoster(zone, pins, { type: 'FeatureCollection', features: adm0.features.filter((f) => f.properties?.iso3 === 'IND') })).html
  }
  await page.setContent(boxHtml, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready.then(() => true))
  const box = await page.evaluate(() => {
    let pairs = 0, on = 0, neighbour = 0
    const texts = [...document.querySelectorAll('text.snm')]
    const boxes = texts.map((t) => { const b = t.getBBox(); return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height } })
    const photos = []
    texts.forEach((t, i) => { const img = t.nextElementSibling; if (img && img.tagName.toLowerCase() === 'image') { const x = +img.getAttribute('x'), y = +img.getAttribute('y'); photos.push({ own: i, x0: x, y0: y, x1: x + +img.getAttribute('width'), y1: y + +img.getAttribute('height') }) } })
    const ov = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.01 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.01
    for (const p of photos) { pairs++; if (ov(boxes[p.own], p)) on++ }
    for (let i = 0; i < boxes.length; i++) for (const p of photos) if (p.own !== i && ov(boxes[i], p)) neighbour++
    return { pairs, on, neighbour }
  })
  console.log(`photo boxes: ${box.on} of ${box.pairs} on their own name's drawn box; ${box.neighbour} name/other-photo overlaps`)
  if (selfTest) verdict = verdict || (box.on > 0 ? 0 : 1)
  else if (box.on > 0 || box.neighbour > 0) verdict = 1
} finally { await b.close() }
if (selfTest) console.log(verdict ? '✗ MISSED: external slots stayed flat without the strip' : '✓ caught: without the strip every external slot draws (the glyph)')
else console.log(verdict ? 'FAIL check:side-lane-photo-pixels' : 'PASS check:side-lane-photo-pixels — the data: photo draws; every external photo slot is flat (no broken-image glyph)')
process.exitCode = verdict
