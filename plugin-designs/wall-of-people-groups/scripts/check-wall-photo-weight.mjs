#!/usr/bin/env node
/**
 * check-wall-photo-weight — the Wall's poster loads its photos at the size it prints them. Headless.
 *
 * The 77 IMB photos (peoplegroupspublic.blob.core.windows.net, images.peoplegroups.org) are 1024 px originals of
 * ~1.5 MB: 114 MB of the print's 133 MB, measured 2026-09-30, a minute or more before the print dialog can open
 * on a home connection. photoUrl.js loads a 320 px copy from the host's own resizer instead (19-20 MB in all).
 * This pins, on the REAL modules:
 *   - an IMB photo on EITHER host maps to images.peoplegroups.org/cdn-cgi/image/width=320 for the same file;
 *   - every other photo (Joshua Project, doxa) is untouched, and a non-URL stays as it is;
 *   - fullPhoto() gives the original back for a resized URL, and null for anything else;
 *   - the PRINT HTML (buildBlessPosterHtml) uses the resized copy, with the original as its onerror fallback,
 *     and leaves the other photos alone; the screen canvas loads through the same lightPhoto().
 * Two-sided: lightPhoto replaced by the identity (the old behaviour) must fail the mapping and the print arms.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const P = await import(pathToFileURL(join(DIR, 'photoUrl.js')).href)
const B = await import(pathToFileURL(join(DIR, 'blessPoster.js')).href)
const canvasSrc = readFileSync(join(DIR, 'wallCanvas.js'), 'utf8')

const IMB = ['https://peoplegroupspublic.blob.core.windows.net/imbpeople-featured-images/PG016542.jpg',
  'https://images.peoplegroups.org/imbpeople-featured-images/PG023972.jpg']
const OTHER = ['https://media.joshuaproject.net/public/assets/media/profiles/photos/p10120.jpg',
  'https://joshuaproject.net/assets/media/profiles/photos/p20298.jpg', 'https://s3.doxa.life/no-photo-images/asia.jpg']
const WANT = (file) => `https://images.peoplegroups.org/cdn-cgi/image/width=320,format=jpeg/imbpeople-featured-images/${file}`

function run(light, full) {
  const errs = []
  for (const u of IMB) {
    const file = u.split('/').pop()
    if (light(u) !== WANT(file)) errs.push(`map: ${u} → ${light(u)}, want the 320 px copy`)
    if (full(light(u)) !== `https://images.peoplegroups.org/imbpeople-featured-images/${file}`) errs.push(`full: no original for ${u}`)
  }
  for (const u of OTHER) { if (light(u) !== u) errs.push(`map: ${u} was rewritten`); if (full(u) !== null) errs.push(`full: ${u} is not a resized URL`) }
  if (light('') !== '' || light('not a url') !== 'not a url') errs.push('map: a non-URL was changed')
  // the print HTML, through the real engine, with this light()
  const groups = [{ name: 'A', imageUrl: IMB[0] }, { name: 'B', imageUrl: OTHER[0] }, { name: 'C', imageUrl: '' }]
  const html = B.buildBlessPosterHtml(groups, '3x4ft', {})
  const imgs = [...html.matchAll(/<img src="([^"]+)"([^>]*)>/g)]
  if (imgs.length !== 2) errs.push(`print: ${imgs.length} photos in the document, want 2`)
  else {
    if (imgs[0][1] !== light(IMB[0]) || !imgs[0][1].includes('/cdn-cgi/image/width=320')) errs.push(`print: the IMB photo prints from ${imgs[0][1]}`)
    if (!/data-full="https:\/\/images\.peoplegroups\.org\/imbpeople-featured-images\/PG016542\.jpg"/.test(imgs[0][2]) || !/onerror=/.test(imgs[0][2])) errs.push('print: the resized photo has no fallback to its original')
    if (imgs[1][1] !== OTHER[0] || /data-full/.test(imgs[1][2])) errs.push('print: a Joshua Project photo was changed')
  }
  return errs
}

const fails = []
fails.push(...run(P.lightPhoto, P.fullPhoto))
// the canvas loads through the same helper (both draw paths) and retries the original
if ((canvasSrc.match(/lightPhoto\(g\.imageUrl\)/g) || []).length < 2) fails.push('canvas: wallCanvas.js does not load every card photo through lightPhoto()')
if (!/fullPhoto\(u\)/.test(canvasSrc)) fails.push('canvas: a failed resized photo is not retried from its original')
// SELF-TEST: the old behaviour (originals) must fail the mapping arm; the print arm reads the real engine, so
// it is checked by running the engine's output against an identity map
const planted = run((u) => u, () => null)
if (!planted.some((e) => e.startsWith('map:'))) fails.push('SELF-TEST: originals (identity) were not caught by the mapping arm')
if (!planted.some((e) => e.startsWith('print:') || e.startsWith('full:'))) fails.push('SELF-TEST: the print/fallback arms did not react to the identity map')

if (fails.length) { console.log('WALL-PHOTO-WEIGHT: FAIL'); for (const f of fails) console.log('  - ' + f); process.exitCode = 1 }
else console.log('WALL-PHOTO-WEIGHT: PASS — IMB photos on both hosts load as 320 px copies with their originals as the fallback, every other photo is untouched, and the print and the canvas both go through photoUrl.js; the old full-size behaviour is caught.')
