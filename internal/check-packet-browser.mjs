// check-packet-browser — the packet the READER gets, not the one Node writes.
//
// WHY A SECOND PACKET GATE. check-packet-render verifies a packet FILE produced by
// the build-time generator. This one verifies the BROWSER path: the legend's
// Export > Prayer packet action imports library/packet/packet-render.js, fetches
// live records, and prints in-place. Both callers share that one renderer, and this
// gate is what proves the shared module actually runs in a browser — a module can
// be perfectly correct under Node and still fail in a tab (a bare `process.env`
// reference, a Node-only import, a JSON import assertion).
//
// It also covers I18N, which is a product requirement rather than a nicety: pass a
// language and the gate reports which headings came back translated. Fallback is
// PER KEY, so a half-finished translation must render its finished keys and leave
// the rest in English — never blank.
//
// Usage:  node internal/check-packet-browser.mjs [lang]
//   PACKET_ORIGIN  http origin serving the repo root (default http://127.0.0.1:4898)
//   PACKET_API     records API (default https://pray.doxa.life)
//   PACKET_ISO3    country to build a test packet for (default LAO)
// Needs a static server over the repo root, e.g.:  python3 -m http.server 4898

import { chromium } from './lib/playwright-guarded.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const b = await chromium.launch()
const pg = await b.newPage({ viewport:{width:1500,height:1941} })
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,140)))

let ORIGIN = process.env.PACKET_ORIGIN || 'http://127.0.0.1:4898'
let OWN_SERVER = null
const API = process.env.PACKET_API || 'https://pray.doxa.life'
const ISO3 = process.env.PACKET_ISO3 || 'LAO'
let RENDER = `${ORIGIN}/library/packet/packet-render.js`
let STRINGS = `${ORIGIN}/library/scripts/posters/packet-strings.json`
// The SAME catalog, read from disk for the assertions below. STRINGS is the URL the
// browser fetches; this is the local path, so the gate compares against the file the
// page actually loaded rather than a second copy.
const STRINGS_PATH = resolve(dirname(fileURLToPath(import.meta.url)),
  '..', 'library/scripts/posters/packet-strings.json')
// The POSTER zone whose map page 1 shows. ISO3 selects the people groups; the poster is
// keyed by ZONE id, and they are not the same string (ISO3 'LAO' vs zone 'laos').
const ZONE = process.env.PACKET_ZONE || 'laos'
const LANG = process.argv[2] || 'en'

// ⚠ SKIP CLEANLY WHEN THE PRECONDITION IS ABSENT. This needs a static server over the
// REPO ROOT and a reachable records API; without either it threw an unhandled navigation
// error and dumped a stack trace, which is why it could never join a wave — a gate that
// goes red with a stack on a machine that simply has no server running only teaches
// people to disable it. Absence of a server is not a product failure; say so and exit 0.
try {
  await pg.goto(ORIGIN + '/', { timeout: 8000 })
} catch {
  await b.close()
  console.log(`PACKET-BROWSER: SKIP — nothing served at ${ORIGIN}.`)
  console.log('  This gate exercises the BROWSER export path, so it needs the repo root served:')
  console.log('    python3 -m http.server 4898   (or set PACKET_ORIGIN)')
  process.exit(0)
}

// ⚠ AND IT MUST BE THIS CHECKOUT'S ROOT. Several worktrees of this repo run on one machine,
// so a port that answers may belong to another one — measured 2026-09-24 on :4173, where a
// browser gate reported on a build that was not on disk here. This gate imports the shared
// renderer FROM THE SERVER, so the wrong origin means it verifies someone else's renderer
// and says nothing about this change. Precondition, not a product failure: SKIP and name it.
{
  const { servesThisTree, serveThisTree } = await import('./_serves-this-tree.mjs')
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const tree = await servesThisTree(ORIGIN + '/public', repo)
  if (/DIFFERENT build/.test(tree.why)) {
    // Serve this checkout rather than skip: the default port belongs to whichever worktree
    // started first on this box, and a gate that skips every wave stops being a gate.
    OWN_SERVER = await serveThisTree(repo)
    if (!OWN_SERVER) {
      await b.close()
      console.log('PACKET-BROWSER: SKIP — not this checkout, and I could not start my own server.')
      console.log(`  ${tree.why}`)
      console.log('  Serve THIS repo root and re-run (PACKET_ORIGIN=http://127.0.0.1:PORT).')
      process.exit(0)
    }
    console.log(`  · ${tree.why}`)
    console.log(`  · serving this checkout on ${OWN_SERVER.origin} instead`)
    ORIGIN = OWN_SERVER.origin
    RENDER = `${ORIGIN}/library/packet/packet-render.js`
    STRINGS = `${ORIGIN}/library/scripts/posters/packet-strings.json`
    // The page is already sitting on the OTHER origin, and a dynamic import across origins is
    // refused (no CORS on a plain static server) — measured: "Failed to fetch dynamically
    // imported module". Re-navigate so the renderer is same-origin with the page importing it.
    await pg.goto(ORIGIN + '/', { timeout: 8000 })
  }
}
const html = await pg.evaluate(async ({RENDER, STRINGS, LANG, ORIGIN, API, ISO3, ZONE}) => {
  const [{ createPacketRenderer }, strings, norm] = await Promise.all([
    import(RENDER),
    fetch(STRINGS).then(r=>r.json()),
    import(`${ORIGIN}/plugin-designs/my-upg-100-list/data/normalize.js`),
  ])
  const R = createPacketRenderer({ strings, lang: LANG })
  const resp = await fetch(`${API}/api/people-groups/list?fields=slug,name,country_code,population,religion,image_url&lang=en`, {cache:'no-store'})
  // Use the SAME normalizer the app uses — the API returns { posts, total }, and
  // hand-rolling the extraction is how a probe ends up testing something the
  // product never does.
  const recs = norm.normalizeRecords(norm.extractRecords(await resp.json()))
  const groups = recs.filter(r=>String(r.country_code)===ISO3)
    .sort((a,b)=>String(a.name).localeCompare(String(b.name), LANG))
  const photos = new Map(groups.filter(g=>g.image_url).map(g=>[g.slug,g.image_url]))
  // ⚠ FETCH THE MAP THE WAY THE PRODUCT DOES. This passed '' for mapSvg, so the
  // browser packet had NO page-1 map and any geography assertion would have been
  // measuring the HARNESS's shortcut rather than the product. The real export path
  // (usePosterPrints fetchMapSheet, which the list and the wall both print through) fetches posters/<zone>.html and lifts its <svg>,
  // returning '' on failure — a legitimate degraded state, the browser twin of the
  // build-time `nomap`. Exercise that code shape here instead of skipping it.
  // ★ THE PRODUCT'S OWN LIFT, not a copy of it. This harness used to rebuild the page-1 wrapper by
  // hand (250px down, scale 0.62); once the product moved to packet-render.js liftMap, that copy kept
  // "verifying" a page 1 that no longer shipped. It now walks the same preference order
  // (R.mapSheetFiles: the map-only sheet, then the poster) and places it with R.liftMap.
  let mapSvg = ''
  for (const file of R.mapSheetFiles(ZONE)) {
    try {
      const res = await fetch(`${ORIGIN}/library/scripts/posters/out/posters/${file}`)
      const lifted = res.ok ? R.liftMap(await res.text()) : ''
      if (lifted) { mapSvg = lifted; break }
    } catch { /* try the next file; none generated means page 1 says the map is missing */ }
  }
  return R.buildPacket({id:ISO3.toLowerCase(),label:ISO3}, groups, photos, mapSvg)
}, {RENDER, STRINGS, LANG, ORIGIN, API, ISO3, ZONE})

await pg.setContent(html, { waitUntil:'load' })
await pg.waitForTimeout(3000)
// ⚠ READ THE HEADINGS BY STRUCTURE, NOT BY ENGLISH WORDS. These were greps for
// /Wheel/ and /Prayer Points|Puntos/, so they returned EMPTY for every language
// whose heading contains neither — Spanish reported a blank wheel heading and
// Hindi blanked BOTH, while the catalog holds 'Rueda de Oración' and
// 'प्रार्थना चक्र'. Nothing asserted them, so the gate PASSED on what looked
// exactly like a product i18n failure. It was the harness. The renderer marks
// these two blocks, so select them and compare to the catalog below.
const r = await pg.evaluate(()=>({
  sheets: document.querySelectorAll('.sheet').length,
  cards: document.querySelectorAll('.card').length,
  wheel: document.querySelectorAll('svg path[fill^="hsl"]').length,
  // The passage block, not the English proper noun 'Gadarenes': that word would
  // vanish the moment point4_passage is translated, so the assertion would go RED
  // on a CORRECTLY translated packet (the same trap already fixed in
  // check-packet-render).
  mark5Len: (document.querySelector('.p4-passage')||{textContent:''}).textContent.trim().length,
  heartItems: document.querySelectorAll('.p4-heart li').length,
  // ★ THE SAME PACKET, EXPORTED THROUGH A DIFFERENT PATH, WAS HELD TO A WEAKER STANDARD.
  // check-packet-render gained these over several ticks — the 12 points, the wheel's 12
  // LABELS (not just its 12 segments), page 1's geography — each found by mutation, each
  // catching a real "looks fine, is empty" shape. None of them existed here, and THIS is
  // the packet a reader actually gets: the legend's Export > Prayer packet action. The
  // build-time file is the one nobody clicks.
  // Counted the same way as the build-time gate, deliberately, so the two cannot disagree.
  points: (() => {
    const t = document.querySelector('.points-title')
    const host = t && t.parentElement && t.parentElement.parentElement
    if (!host) return -1
    return (host.innerText || '').split('\n').filter((l) => /^\s*\d{1,2}\.\s/.test(l)).length
  })(),
  // A segment without its word is a colour. `order` renders 12 from 12 keys, but `praise`
  // and `praise_end` collapse to one WORD in English — so count ELEMENTS, never distinct
  // words, or the expected number changes per language.
  wheelLabels: (() => {
    const t = document.querySelector('.wheel-title')
    const sheet = t && t.closest('.sheet')
    const svg = sheet && sheet.querySelector('svg')
    if (!svg) return -1
    // The "Start here" marker's words are not a segment label (.wheel-start, 2026-09-30).
    return [...svg.querySelectorAll('text')].filter((e) => !e.closest('.wheel-start'))
      .map((e) => (e.textContent || '').trim())
      .filter((s) => s && !/^\d+$/.test(s) && !/^\d[\s\S]*×\s*12$/.test(s)).length
  })(),
  // Page 1 is the map one-pager. Palette-resolves and not-black are BOTH satisfied by a
  // map with zero country shapes, so count the coastlines: paths whose `d` is long enough
  // to be geography rather than an icon.
  mapGeoPaths: (() => {
    const sheet0 = document.querySelector('.sheet')
    const svg = sheet0 && sheet0.querySelector('svg')
    if (!svg) return -1
    return [...svg.querySelectorAll('path')].filter((e) => (e.getAttribute('d') || '').length > 200).length
  })(),
  metacamp: (document.body.innerText.match(/metacamp\.org/g)||[]).length,
  firstCard: (document.querySelector('.card')||{}).innerText||'',
  wheelTitle: (document.querySelector('.wheel-title')||{textContent:''}).textContent.trim(),
  pointsTitle: (document.querySelector('.points-title')||{textContent:''}).textContent.trim(),
}))
const pdf = await pg.pdf({ preferCSSPageSize:true })
const t = pdf.toString('latin1')
const pages=(t.match(/\/Type\s*\/Page[^s]/g)||[]).length
const boxes=[...t.matchAll(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(m=>[+m[1],+m[2]])
// THE PRINT LAYER. This gate already made a PDF and read only its STRUCTURE — page count
// and MediaBox — which eight blank sheets of the right size satisfy perfectly. The packet
// exists to be PRINTED, and a print-only CSS rule can strip content every on-screen check
// still sees. FontFile2 = a face actually embedded, so the text travels with the file.
const pdfFonts=(t.match(/\/FontFile2/g)||[]).length
const pdfBytes=pdf.length
await b.close()
console.log(`  lang             : ${LANG}`)
console.log(`  sheets/PDF pages : ${r.sheets} / ${pages}`)
console.log(`  people cards     : ${r.cards}`)
console.log(`  prayer points    : ${r.points} / 12`)
console.log(`  wheel segments   : ${r.wheel}  (${r.wheelLabels}/12 labelled)`)
console.log(`  map (page 1)     : ${r.mapGeoPaths} geography paths`)
console.log(`  printed artefact : ${(pdfBytes/1024/1024).toFixed(1)}MB, ${pdfFonts} embedded font(s)`)
console.log(`  point 4         : Mark 5:18-20 ${r.mark5Len} chars, ${r.heartItems} readings`)
                                                  // beside a PASS for as long as this gate has existed. The ASSERTION below always read
                                                  // the right key, so the requirement was protected; only the display was blind.
console.log(`  metacamp.org     : ${r.metacamp}`)
console.log(`  page size        : ${boxes[0]?boxes[0].join(' x '):'?'} pt`)
console.log(`  points heading   : ${r.pointsTitle.trim()}`)
console.log(`  wheel heading    : ${r.wheelTitle.trim()}`)
console.log(`  page errors      : ${errs.length} ${errs[0]||''}`)
// ── NAMED ASSERTIONS, NOT ONE COLLAPSED BOOLEAN ─────────────────────────────
// This was `const bad = a || b || c || ...`, so a failure printed "FAIL" without
// saying WHICH of six conditions tripped. Three further metrics were printed and
// never checked at all: page size, and the two headings — which are the very
// strings this gate's own header says it covers ("the gate reports which headings
// came back translated"). Reports, not asserts.
const fails = []
if (!r.sheets) fails.push('no .sheet elements — the browser packet did not render')
if (pages !== r.sheets) fails.push(`${pages} PDF pages for ${r.sheets} sheets — one sheet must be one page`)
if (!r.cards) fails.push('no people-group cards')
if (r.wheel !== 12) fails.push(`prayer wheel has ${r.wheel} segments, expected 12`)
// THE PRODUCT IS NAMED FOR THIS NUMBER: the page header reads "12 Prayer Points" in every
// locale, so 12 is a contract. The failure it guards is silent — a partial translation once
// rendered THREE under that heading, with nothing blank and no error.
if (r.points !== 12) {
  fails.push(r.points === -1
    ? 'no .points-title block — the 12 prayer points page did not render at all'
    : `${r.points} prayer point(s) rendered, expected 12`)
}
// A wheel with 12 coloured segments and no words on it is a pie chart. The document-wide
// rhythm vocabulary cannot see this: the SAME words are rendered twice, once per segment
// and once per prayer-point heading, so a whole-document search passes on the points page.
if (r.wheelLabels !== 12) {
  fails.push(r.wheelLabels === -1
    ? 'no prayer-wheel svg found — the wheel page did not render'
    : `the prayer wheel paints ${r.wheelLabels} segment label(s), expected 12`)
}
// Page 1 is the map one-pager — the first line of the packet spec.
if (r.mapGeoPaths !== -1 && r.mapGeoPaths < 5) {
  fails.push(`only ${r.mapGeoPaths} geography path(s) on page 1 — the map one-pager is blank `
    + 'or drew nothing but furniture')
}
// A missing map is a DECLARED degradation here, exactly as PACKET_EXPECT_MAP=0 is for the
// build-time gate: out/posters/ is gitignored, so a checkout that never ran `bun run posters`
// legitimately has none, and the product itself returns '' in that case.
if (r.mapGeoPaths === -1) {
  console.log(`  map (page 1)     : ABSENT — no out/posters/${ZONE}.html (run \`bun run posters\`)`)
}
// The packet is a standalone file meant to print offline, so its text must travel with it.
if (pdfFonts === 0) {
  fails.push('the PDF embeds NO fonts (0 /FontFile2) — the text depends on the printer\'s font set')
}
if (r.metacamp !== 2) fails.push(`${r.metacamp} metacamp.org attributions, expected exactly 2`)
// Mark 5:1-20 in full, by LENGTH rather than an English proper noun.
// Point 4 prints Mark 5:18-20 AND THE HEAVENLY FATHER'S HEART (seven readings) on the points page (2026-09-30).
if (r.mark5Len < 250) {
  fails.push(r.mark5Len === 0
    ? 'Mark 5:18-20 is NOT printed (no .p4-passage block)'
    : `Mark 5:18-20 looks truncated: ${r.mark5Len} chars`)
}
if (r.heartItems !== 7) {
  fails.push(r.heartItems === 0
    ? "point 4's reading list is NOT printed (no .p4-heart block)"
    : `point 4's reading list prints ${r.heartItems} of 7 readings`)
}

// PAGE SIZE was printed and never compared. `@page{size:letter portrait}` is
// 612x792pt; a wrong PORTRAIT size (A4 is 595x842) is taller-than-wide too, so
// nothing else here would notice it.
if (!boxes.length) fails.push('the PDF declares no MediaBox — page geometry unreadable')
else {
  const wrong = boxes.filter(([w,h]) => Math.abs(w-612)>1 || Math.abs(h-792)>1)
  if (wrong.length) fails.push(`${wrong.length}/${boxes.length} page(s) are ${wrong[0].join(' x ')}pt, expected 612 x 792pt`)
}
// ── I18N, ASSERTED AGAINST THE CATALOG ──────────────────────────────────────
// The heading a reader sees must equal the catalog entry for THIS packet's
// language — per-key fallback to English when the key is absent, exactly as the
// renderer resolves it. Never a hardcoded expectation, which is what made these
// two unassertable in the first place.
const cat = JSON.parse(readFileSync(STRINGS_PATH, 'utf8'))
const expect = (key) => ((cat[LANG]||{})[key] ?? cat.en[key])
for (const [sel, key, got] of [['points-title','points_title',r.pointsTitle],
                               ['wheel-title','wheel_title',r.wheelTitle]]) {
  const want = expect(key)
  if (!got) fails.push(`.${sel} is EMPTY — a blank heading is worse than an English one`)
  else if (got !== want) fails.push(`.${sel} reads ${JSON.stringify(got)}, catalog says ${JSON.stringify(want)}`)
}
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

OWN_SERVER?.stop()

if (fails.length) {
  console.error(`\nPACKET-BROWSER: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nPACKET-BROWSER: PASS — the browser-rendered packet is correct, and its headings '
  + `match the ${LANG} catalog.`)
