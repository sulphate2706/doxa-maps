#!/usr/bin/env node
// check:side-lanes — the large side-lane sheets (60x96 / 66x66 / 36x60) name every group once, horizontally, with
// leaders that never cross, on a DETERMINISTIC worst case: a seeded synthetic country of 855 groups with stacked
// duplicates and tight clusters (district geocodes are like that), long and short names, real photos on an allowed
// host, the generic placeholder, and photos on a host that is NOT allowed (none of the last two may be drawn).
// Rendered through the real poster-render.js (renderPoster), so it measures what prints.
//
// Asserts per format: every name drawn exactly once; leader crossings 0 (the renderer's own count, re-measured here
// from the SVG); no overflow rows; photos = the pins with a real photo (60x96/66x66) or none (36x60); every photo
// on its name's ANCHOR side (so it can never sit on the name's letters, whatever width the font draws).
// PHOTOS ARE NEVER RASTERISED: a sheet whose photos sit on their own hosts must (a) reach the raster with NO external
// <image> (poster-raster.js strips them: inside an SVG loaded as an image they can only draw the broken-image glyph,
// and no photo host sends CORS), and (b) PRINT as its own document from PosterWall, where the photos load. The pixel
// side of this (a data: photo draws, an external slot stays flat) is check:side-lane-photo-pixels, a browser gate.
// --self-test: a renderer copy WITHOUT the lane clamp must FAIL the crossing arm, a raster that keeps external
// images must FAIL arm (a), and a PosterWall print that rasterises them must FAIL arm (b) (else the arms prove nothing).
// Exit 0 pass, 1 fail.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const RENDER = join(ROOT, 'library/packet/poster-render.js')

function synthetic(n = 855) {
  let seed = 20261001
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const syll = ['ka', 'ra', 'mu', 'thi', 'ban', 'dho', 'li', 'sa', 'ga', 'pa', 'rwa', 'kot', 'ni', 'al', 'u']
  const centres = Array.from({ length: 60 }, () => [68 + rnd() * 28, 8 + rnd() * 27])
  const pins = []
  for (let i = 0; i < n; i++) {
    const c = centres[Math.floor(rnd() * centres.length)]
    const stacked = rnd() < 0.15 && pins.length                       // an exact duplicate of an earlier position
    const lng = stacked ? pins[pins.length - 1].lng : c[0] + (rnd() - 0.5) * 1.6
    const lat = stacked ? pins[pins.length - 1].lat : c[1] + (rnd() - 0.5) * 1.6
    const words = 1 + Math.floor(rnd() * (rnd() < 0.05 ? 5 : 2))
    const name = Array.from({ length: words }, () => Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => syll[Math.floor(rnd() * syll.length)]).join('')).join(' ')
      .replace(/^./, (m) => m.toUpperCase()) + ` ${i}`
    // real (an allowed photo host), placeholder, or a non-placeholder on a host that is NOT allowed (must not draw)
    const roll = rnd()
    const image_url = roll < 0.18 ? `https://media.joshuaproject.net/public/assets/media/profiles/photos/p${i}.jpg`
      : roll < 0.22 ? `http://elsewhere.example/p/${i}.jpg`
      : 'https://s3.doxa.life/no-photo-images/asia.jpg'
    pins.push({ name, lat, lng, slug: `g-${i}`, country_code: 'IND', population: 1000 + i, image_url })
  }
  return pins
}

async function measure(createPosterGenerator, format, pins) {
  const adm0 = J('public/dx-maps/assets/boundaries/world-adm0.geojson')
  const series = J('library/scripts/posters/series.json')
  const zone = { id: 'country-ind', zoneKey: 'country-ind', label: 'India', count: pins.length, color: '#d4a640', adm0: ['IND'], selector: { type: 'country_codes', values: ['IND'] } }
  const zoneFC = { type: 'FeatureCollection', features: adm0.features.filter((f) => f.properties?.iso3 === 'IND') }
  const gen = createPosterGenerator({ env: { FORMAT: format, SPARSE: '1', POSTER_DATE: '2026-10-01' }, SERIES_DEF: series.country, ISO3_NAME: { IND: 'India' }, adm0, adm1Ind: null, adm1Chn: null, nePlaces: [], series: { totalGroups: pins.length, totalLists: 1, index: 1 } })
  const out = await gen.renderPoster(zone, pins, zoneFC)
  const html = out.html || ''
  const names = [...html.matchAll(/<text class="snm"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
  const photos = (html.match(/<image href="/g) || []).length
  // re-measure crossings from the SVG itself, independent of the renderer's own count
  const polys = [...html.matchAll(/class="slead" d="M([^"]+)"/g)].map((m) => m[1].split('L').map((q) => q.trim().split(' ').map(Number)))
  const segs = polys.map((pl) => pl.slice(1).map((q, k) => [pl[k], q]))
  const sx = (p, q, r) => (r[1] - p[1]) * (q[0] - p[0]) - (q[1] - p[1]) * (r[0] - p[0])
  const X = (a, b) => (sx(a[0], a[1], b[0]) > 0) !== (sx(a[0], a[1], b[1]) > 0) && (sx(b[0], b[1], a[0]) > 0) !== (sx(b[0], b[1], a[1]) > 0)
  let crossings = 0
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[i].some((a) => segs[j].some((b) => X(a, b)))) crossings++
  // PHOTO BESIDE ITS NAME, NEVER ON IT: each photo must sit on the ANCHOR side of its name (left column: right of the
  // name's end anchor; right column: left of its start anchor), at least the 4 px gap away. The name's glyphs lie
  // wholly on the other side of that anchor, so this holds whatever width the font draws.
  let photoOnName = 0
  for (const m of html.matchAll(/<text class="snm" x="([\d.]+)"[^>]*?( text-anchor="end")?>[^<]*<\/text><image href="[^"]*" x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)"/g)) {
    const tx = +m[1], end = !!m[2], ix = +m[3], iw = +m[4]
    if (end ? ix < tx + 3.9 : ix + iw > tx - 3.9) photoOnName++
  }
  return { stats: out.sideLanes, names, photos, crossings, leaders: polys.length, photoOnName }
}

function judge(format, m, pins, wantPhotos) {
  const fails = []
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const want = new Map(pins.map((p) => [esc(p.name), 0]))
  for (const n of m.names) if (want.has(n)) want.set(n, want.get(n) + 1)
  const missing = [...want].filter(([, v]) => v === 0).length, dup = [...want].filter(([, v]) => v > 1).length
  if (!m.stats) fails.push(`${format}: renderPoster returned no sideLanes stats (not a side-lane format?)`)
  if (m.names.length !== pins.length || missing || dup) fails.push(`${format}: ${m.names.length} names drawn for ${pins.length} groups (${missing} missing, ${dup} duplicated)`)
  if (m.crossings !== 0) fails.push(`${format}: ${m.crossings} leader crossings (re-measured from the SVG)`)
  if (m.stats && m.stats.crossings !== m.crossings) fails.push(`${format}: the renderer reports ${m.stats.crossings} crossings, the SVG has ${m.crossings}`)
  if (m.stats && m.stats.overflowRows) fails.push(`${format}: ${m.stats.overflowRows} rows overflow the band`)
  const real = pins.filter((p) => /^https:\/\/media\.joshuaproject\.net\//.test(p.image_url)).length   // the allowed ones only
  if (m.photos !== (wantPhotos ? real : 0)) fails.push(`${format}: ${m.photos} photos drawn, expected ${wantPhotos ? real : 0}`)
  if (m.photoOnName) fails.push(`${format}: ${m.photoOnName} photos are not on their name's anchor side (they can land on its letters)`)
  return fails
}

// (a) + (b), on the 60x96 sheet's HTML. rasterSrc / wallSrc are the source texts, so a poison can swap them.
async function photoArms(html, rasterSrc, wallSrc) {
  const fails = []
  const m = await import('data:text/javascript;base64,' + Buffer.from(rasterSrc).toString('base64'))
  const ext = (t) => (t.match(/<image\b[^>]*?\bhref="(?!data:)/g) || []).length
  if (!ext(html)) fails.push('photos: the 60x96 sheet carries no external photo, so these arms measure nothing')
  if (typeof m.hasExternalImages !== 'function' || !m.hasExternalImages(html)) fails.push('photos: poster-raster.js hasExternalImages() does not see the sheet\'s photos')
  // what rasterPoster hands to new Image(): its own first line, inlineSvg + whatever it applies
  const body = (rasterSrc.match(/export async function rasterPoster[\s\S]*?const url = /) || [''])[0]
  const prep = (body.match(/const svg = ([^;]+);/) || [])[1] || ''
  const svg = prep ? new Function('inlineSvg', 'stripExternalImages', 'posterHtml', `return ${prep}`)(m.inlineSvg, m.stripExternalImages, html) : ''
  if (!prep) fails.push('photos: could not find what rasterPoster rasterises (const svg = ...)')
  else if (ext(svg)) fails.push(`photos: rasterPoster would rasterise ${ext(svg)} external <image> (each one prints the broken-image glyph)`)
  // (b) the wall's generated-sheet branch prints a sheet with external images as a document, before any raster
  const branch = (wallSrc.match(/if \(props\.sheet\) \{[\s\S]*?rasterPoster\(html/) || [''])[0]
  if (!/posterAction === 'print' && hasExternalImages\(html\)\) \{ await printSheetDocument\(html\); return \}/.test(branch)) fails.push('photos: PosterWall prints a sheet with photos through the raster (they cannot draw there)')
  if (!/async function printSheetDocument\(html\)[\s\S]{0,400}printDocument\(html,/.test(wallSrc)) fails.push('photos: printSheetDocument does not hand the sheet itself to printDocument')
  return fails
}
const RASTER = join(ROOT, 'library/packet/poster-raster.js'), WALL = join(ROOT, 'library/components/poster/PosterWall.vue')
async function sheetHtml(createPosterGenerator, pins) {
  const adm0 = J('public/dx-maps/assets/boundaries/world-adm0.geojson')
  const gen = createPosterGenerator({ env: { FORMAT: '60x96', SPARSE: '1', POSTER_DATE: '2026-10-01' }, SERIES_DEF: J('library/scripts/posters/series.json').country, ISO3_NAME: { IND: 'India' }, adm0, adm1Ind: null, adm1Chn: null, nePlaces: [], series: { totalGroups: pins.length, totalLists: 1, index: 1 } })
  const zone = { id: 'country-ind', zoneKey: 'country-ind', label: 'India', count: pins.length, color: '#d4a640', adm0: ['IND'], selector: { type: 'country_codes', values: ['IND'] } }
  return (await gen.renderPoster(zone, pins, { type: 'FeatureCollection', features: adm0.features.filter((f) => f.properties?.iso3 === 'IND') })).html || ''
}

const selfTest = process.argv.includes('--self-test')
const src = readFileSync(RENDER, 'utf8')
const pins = synthetic()
if (selfTest) {
  // POISON: drop the lane clamp (each lane at its own pin's height); stubs/runs/fans must then cross on this data
  const a = 'let y = Math.min(Math.max(c.y, lo + LANE_GAP), hi - LANE_GAP);'
  if (!src.includes(a)) { console.log('NOT MEASURED: the lane clamp line moved; update the poison'); process.exitCode = 75 }
  else {
    const poisoned = src.replace(a, 'let y = c.y; lo = -Infinity; hi = Infinity;')
    const { createPosterGenerator } = await import('data:text/javascript;base64,' + Buffer.from(poisoned).toString('base64'))
    const m = await measure(createPosterGenerator, '60x96', pins)
    const f = judge('60x96', m, pins, true)
    console.log(f.some((x) => /crossings/.test(x)) ? `✓ caught: no lane clamp -> ${m.crossings} crossings` : '✗ MISSED: the crossing arm stayed green without the lane clamp')
    process.exitCode = f.some((x) => /crossings/.test(x)) ? 0 : 1
  }
  {
    // POISON: the photo placed from the ESTIMATED width again (the shipped defect) must fail the placement arm
    const a = 'const slot = slotOf(g, font), tx = L ? x - slot : x + slot;', b = 'const px = L ? x - PHOTO : x;'
    if (!src.includes(a) || !src.includes(b)) { console.log('NOT MEASURED: the photo placement lines moved; update the poison'); process.exitCode = 75 }
    else {
      const poisoned = src.replace(a, 'const tx = x;').replace(b, 'const tw = textW(String(g.name), font) * 1.06, px = L ? x - tw - PHOTO_GAP - PHOTO : x + tw + PHOTO_GAP;')
      const { createPosterGenerator: cpg } = await import('data:text/javascript;base64,' + Buffer.from(poisoned).toString('base64'))
      const m = await measure(cpg, '60x96', pins)
      const ok = judge('60x96', m, pins, true).some((x) => /anchor side/.test(x))
      console.log(ok ? `✓ caught: a photo placed from the estimated width -> ${m.photoOnName} photos off their anchor side` : '✗ MISSED: the placement arm stayed green with the estimated-width placement')
      if (!ok) process.exitCode = 1
    }
  }
  const { createPosterGenerator } = await import(RENDER)
  const html = await sheetHtml(createPosterGenerator, pins)
  const rs = readFileSync(RASTER, 'utf8'), ws = readFileSync(WALL, 'utf8')
  for (const [name, r, w, rx] of [
    ['a raster that keeps external images', rs.replace('stripExternalImages(inlineSvg(posterHtml))', 'inlineSvg(posterHtml)'), ws, /rasterise \d+ external/],
    ['a wall print that rasterises a sheet with photos', rs, ws.replace("if (props.posterAction === 'print' && hasExternalImages(html)) { await printSheetDocument(html); return }", ''), /through the raster/],
  ]) {
    if (r === rs && w === ws) { console.log(`NOT MEASURED: the poison anchor for "${name}" moved`); process.exitCode = 75; continue }
    const f = await photoArms(html, r, w)
    const ok = f.some((x) => rx.test(x)); console.log(ok ? `✓ caught: ${name} -> ${f.find((x) => rx.test(x))}` : `✗ MISSED: ${name}`)
    if (!ok) process.exitCode = 1
  }
} else {
  const { createPosterGenerator } = await import(RENDER)
  const fails = [], lines = []
  for (const [format, photos] of [['60x96', true], ['66x66', true], ['36x60', false]]) {
    const m = await measure(createPosterGenerator, format, pins)
    fails.push(...judge(format, m, pins, photos))
    lines.push(`${format}: ${m.names.length} names, ${m.leaders} leaders, ${m.crossings} crossings, ${m.photos} photos, ${m.stats?.namePt} pt`)
  }
  const html = await sheetHtml(createPosterGenerator, pins)
  const pf = await photoArms(html, readFileSync(RASTER, 'utf8'), readFileSync(WALL, 'utf8'))
  fails.push(...pf); if (!pf.length) lines.push(`photos: ${(html.match(/<image\b[^>]*?\bhref="(?!data:)/g) || []).length} external, 0 reach the raster, the wall prints the sheet as a document`)
  if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exitCode = 1 }
  else console.log(`PASS check:side-lanes — synthetic ${pins.length} groups (stacked + clustered); ${lines.join(' | ')}`)
}
