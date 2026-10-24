// check-packet-render — the UPG-100 prayer packet must RENDER, not merely generate.
//
// Every bug this gate exists for produced a file of the right size, with no error, no
// broken image, and a generator that reported success. They were only visible at the
// RENDERED layer, which is why this drives a real browser and reads computed style.
//
// ★ THE LAW THIS GATE ENCODES: never print a number without asserting on it. An earlier
// version of this probe PRINTED "PDF pages: 16" for several runs while reporting
// "✓ packet verified", because the failure counter never looked at that value. A number
// that is displayed but not asserted on is decoration, not verification.
//
// What it catches, each measured on a real regression:
//  1. PAGE COUNT. transform:scale() is PAINT-time, so a scaled sheet still RESERVES its
//     full layout box and the paginator splits it — 8 sheets came out as 16 PDF pages,
//     inking only the top of each. (zoom is LAYOUT-time and paginates correctly.)
//     The packet is printed front-and-back, so an exact page count is load-bearing.
//  2. MAP PALETTE. The map SVG carries almost no presentation attributes; it is styled
//     from the poster document's stylesheet. Lift the <svg> without those rules and SVG
//     `fill` falls back to its INITIAL value, which is BLACK — 670 elements painted solid
//     black with no error of any kind. Asserted as a WHOLE-MAP property, because the first
//     attempt at this check tested one hand-picked <rect> (the one just repaired) and went
//     green while 647 others were still black.
//  3. Content specified explicitly: Mark 5:1-20 in full, 12 wheel segments,
//     the prayer rhythms, and exactly two minimal metacamp.org attributions.
//
// Usage: node internal/check-packet-render.mjs [path/to/packet.html]
// Default path is overridable with PACKET_HTML so this is not machine-specific.

import { chromium } from './lib/playwright-guarded.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { requirePathInThisCheckout } from './_serves-this-tree.mjs'

// ★ --expect-funnel TURNS AN OPTIONAL PAGE INTO A DECLARED REQUIREMENT, and it exists because of a
// real near-miss (2026-09-26, reported unprompted). A merge resolved with
// `git checkout --ours` silently deleted the printPacket call site that supplies the funnel data —
// 60 lines — AND EVERY GATE STAYED GREEN. It had to: the funnel page is optional by design
// (buildPacket omits it when the arg is null), so a packet with no page 2 is not malformed, just
// smaller. My own design choice is what made the deletion invisible.
//
// ⚠ THE FIX IS NOT "ALWAYS REQUIRE IT". That would fail the 11 pre-funnel laos packets and any host
// that legitimately has no funnel data — a false red, which costs as much as a false green. Instead
// the CALLER, who knows whether this packet was built with funnel data, says so. An absence is then
// either DECLARED (no flag, fine) or a FAILURE (flag passed, page missing) — never a silent nothing.
// ⚠ Flags are filtered out of the positional read: a bare `--expect-funnel` was otherwise taken as
// the packet path, which is the flag-eaten-as-positional trap this repo has hit three times.
const EXPECT_FUNNEL = process.argv.includes('--expect-funnel')
  || process.env.PACKET_EXPECT_FUNNEL === '1'
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const target = positional[0] || process.env.PACKET_HTML
if (!target) {
  console.log('PACKET-RENDER: SKIP — no packet given (pass a path or set PACKET_HTML).')
  console.log('  The packet is generated on demand, so this gate is opt-in rather than')
  console.log('  failing a build on a file that is not expected to exist.')
  process.exit(0)
}
const file = resolve(target)
if (!existsSync(file)) {
  console.error(`PACKET-RENDER: FAIL — no such packet: ${file}`)
  process.exit(1)
}
// Measure THIS build, or measure nothing (exit 75 = NOT MEASURED; see a9550858 / _serves-this-tree.mjs).
requirePathInThisCheckout(file, resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'PACKET-RENDER')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1941 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' })

// Resolve the rhythm words for THIS packet's language from the shared catalog.
// Per-key fallback to English, the same contract the renderer honours.
const lang = await page.evaluate(() => document.documentElement.lang || 'en')
// ★ WHAT THE PACKET SAYS ABOUT ITS OWN BUILD. packet.mjs stamps data-packet-build with the
// flags it was generated under ("full", "nophotos", "nomap", or a combination). Without it
// the only way to tell a fast layout-iteration build from a shippable one was for the PERSON
// RUNNING THE GATE to remember and pass PACKET_EXPECT_PHOTOS=0 — which is why the sweep sat
// RED in doxa-maps-plugin-studio on two probe artifacts nobody intended to ship.
// The ARTEFACT declares its own intent; the env vars below remain as an override for packets
// generated before this stamp existed.
const build = await page.evaluate(() => document.documentElement.getAttribute('data-packet-build') || '')
// ★ AND WHICH LIST IT HOLDS. A packet built under a non-default list is a DIFFERENT DOCUMENT from the
// same zone's default packet — different rows, a different funnel denominator, an extra funnel step —
// and out/packets/ is gitignored, so a sweep grades whatever files are there. Printing the list makes
// 'which packet is this?' answerable from the gate's own output rather than from whoever last ran the
// generator. Empty means the default list.
const packetList = await page.evaluate(() => document.documentElement.getAttribute('data-packet-list') || '')
// RTL languages must actually be laid out RTL. Without dir="rtl" an Arabic packet
// renders readable glyphs LEFT-aligned — it looks like a styling quirk rather than
// the bug it is, and no other assertion here would notice.
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi'])
const dir = await page.evaluate(() => document.documentElement.dir || 'ltr')
// ── AND THE TEXT MUST ACTUALLY BE LAID OUT THAT WAY ─────────────────────────
// dir="rtl" is a DECLARATION, not a layout. It can be set correctly on <html>
// while an inner element overrides it, or while the sheet keeps its LTR flow —
// and every other assertion here would still pass, because an Arabic packet with
// readable glyphs in LTR order looks like a styling quirk rather than the bug it
// is. So measure where the painted text actually sits.
//
// ⚠ MEASURE THE INLINE TEXT RUN, NOT THE BLOCK. A first attempt compared each
// element's own box to its parent's and got IDENTICAL numbers for Arabic and
// English — it was measuring container geometry, which does not move when
// direction flips. A Range over the text node gives the painted extent, which
// does: in ar the run pins to the RIGHT edge (rightGap 0, slack on the left), in
// en/hi to the LEFT. Centred text is skipped because it proves nothing either
// way, and so is text that fills its box — no room to tell.
const layout = await page.evaluate(() => {
  const out = { pinnedRight: 0, pinnedLeft: 0, sampled: 0, rtlComputed: 0 }
  for (const el of document.querySelectorAll('.sheet *')) {
    if (el.childElementCount) continue
    if ((el.textContent || '').trim().length < 8) continue
    const cs = getComputedStyle(el)
    if (cs.textAlign === 'center') continue
    const box = el.getBoundingClientRect()
    const rng = document.createRange(); rng.selectNodeContents(el)
    const tb = rng.getBoundingClientRect()
    if (tb.width < 20 || box.width < 50 || box.width - tb.width < 12) continue
    if (cs.direction === 'rtl') out.rtlComputed += 1
    // Against the CONTENT box: a padded table cell (the pace table's) starts its run at its padding, which is
    // still the left (or right) edge the direction pins it to.
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0
    if (Math.round(box.right - pr - tb.right) <= 1) out.pinnedRight += 1
    else if (Math.round(tb.left - box.left - pl) <= 1) out.pinnedLeft += 1
    out.sampled += 1
    if (out.sampled >= 25) break
  }
  return out
})
// SCRIPT FONT. Some languages need a face the system stack does not carry — Hindi
// renders as tofu boxes in Georgia/Palatino/serif. When the packet declares one,
// it must actually LOAD; a declared-but-failed @font-face is silent, and the page
// then prints as empty rectangles with every other assertion still green.
//
// ⚠ This asserts the FONT LOADED, not that glyphs are correct. A general tofu
// detector was attempted and abandoned: comparing shaped width against a missing
// font false-positives on every system-covered script (Cyrillic, CJK, Arabic all
// legitimately measure the same in both stacks), and an ink-profile heuristic
// scored CORRECTLY-RENDERED Devanagari the same as tofu, because its baseline bar
// gives a uniform column profile. A detector that blocks working packets is worse
// than none. Read the pixels for that; this covers the mechanical half.
const fontStatus = await page.evaluate(async () => {
  await document.fonts.ready
  const faces = [...document.fonts]
  return { declared: faces.length, loaded: faces.filter((f) => f.status === 'loaded').length,
           names: faces.map((f) => `${f.family}:${f.status}`) }
})
// The catalog sits beside the generator that produced this packet, so derive it
// from the packet's own path rather than hardcoding a machine-specific location.
const catalogPath = process.env.PACKET_STRINGS
  || resolve(dirname(file), '..', '..', 'packet-strings.json')
if (!existsSync(catalogPath)) {
  console.error(`PACKET-RENDER: FAIL — no strings catalog at ${catalogPath}`)
  console.error('  Set PACKET_STRINGS if the packet lives outside the generator tree.')
  process.exit(1)
}
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const enR = catalog.en.rhythms
const langR = (catalog[lang] || {}).rhythms || {}
const expected = [...new Set(Object.keys(enR).map((k) => langR[k] ?? enR[k]))]
// ★ A NON-ENGLISH PACKET MUST ACTUALLY DIFFER FROM ENGLISH. The failure this
// catches is a language block that exists but does nothing — a typo'd key, a
// block under the wrong ISO code, or a renderer that ignored the lang argument.
// Every assertion below would still pass in that case, because an all-English
// packet is a perfectly valid packet; only the comparison reveals it.
const translated = lang !== 'en'
  ? Object.keys(catalog.en).filter((k) => typeof catalog.en[k] === 'string'
      && (catalog[lang] || {})[k] && catalog[lang][k] !== catalog.en[k]).length
  : null

// ── THE LARGEST BLOCK OF READER-FACING TEXT, REPORTED SEPARATELY ────────────
// point4_passage is Mark 5:1-20 in full — 2,141 characters, by far the longest string
// in the packet and the one singled out: prayer point four is reading the word
// itself. It is ABSENT from all ten non-English blocks, so every
// translated packet prints its longest passage in English. The per-locale "19 strings
// translated" headline looked healthy while this was true, because 19 short keys and
// one 2,141-character one count the same.
// Reported, NOT failed: a Bible passage cannot be machine-translated or written from
// memory — it must be an exact, correctly-licensed text, and the English here is
// deliberately public-domain (World English Bible). Picking a translation per language
// is a sourcing decision with licensing consequences, not a code change. Failing the
// build over it would only pressure someone into pasting a copyrighted text.
const scriptureIsEnglish = lang !== 'en'
  && !(catalog[lang] || {}).point4_passage
await page.evaluate((words) => { window.__EXPECTED_RHYTHMS = words }, expected)

// The life grid's decoder: every square subpath (M x y …) of an .lc-svg back to its box index, from the geometry
// the SVG declares. Used by the life-calendar checks below.
await page.evaluate(() => {
  window.__lcBoxes = (svg) => {
    // data-geom x0,y0,px,dec[,py]: the box pitch across and down (one pitch when py is absent).
    const [x0, y0, px, dec, py = px] = String(svg.dataset.geom || '').split(',').map(Number)
    const weeks = Number(svg.dataset.weeks)
    const idx = (d) => [...String(d || '').matchAll(/M([\d.]+) ([\d.]+)/g)].map((m) => {
      const x = Number(m[1]) - 0.5 - x0, y = Number(m[2]) - 0.5 - y0
      const b = Math.floor(y / (10 * py + dec))
      return (b * 10 + Math.round((y - b * (10 * py + dec)) / py)) * weeks + Math.round(x / px)
    })
    const off = idx((svg.querySelector('path.lc-off') || {}).getAttribute?.('d'))
    const sh = svg.querySelector('path.lc-on, path.lc-reached')
    const shaded = sh ? idx(sh.getAttribute('d')).sort((a, b) => a - b) : []
    return { total: off.length + shaded.length, shaded, distinct: new Set([...off, ...shaded]).size }
  }
})
const r = await page.evaluate(() => {
  const body = document.body.innerText
  const imgs = [...document.querySelectorAll('.card img, img.ws-ph')]   // profile cards, or lightweight rows (2026-09-30)
  // ⚠ The expected rhythm words come from the STRINGS CATALOG FOR THIS PACKET'S
  // LANGUAGE, never a hardcoded English list. A fixed list tests the opposite of
  // what i18n means: it passed a packet whose translation silently did nothing and
  // FAILED every correctly-translated one (measured — the Spanish packet reported
  // 0/11 rhythms while rendering all twelve correctly as ALABANZA/ESPERAR/...).
  // Read the packet's own <html lang> and resolve per-key, exactly as the renderer
  // does, so this asserts the PROPERTY (all rhythms present, in this language)
  // rather than a vocabulary.
  const RHYTHMS = window.__EXPECTED_RHYTHMS || []

  // Whole-map property, NOT one sampled element — see header note 2.
  const mapFaults = (() => {
    // ⚠ SCOPE TO PAGE 1. This was `document.querySelector('.sheet svg')` — "the first svg
    // ANYWHERE" — which is a FALLBACK SELECTOR, and a fallback selector turns an absence
    // into a pass. Measured 2026-09-24: deleting the map svg from page 1 entirely left this
    // gate reporting "map: palette resolves, not black — PASS, map painted", because the
    // query silently retargeted to the PRAYER WHEEL's svg two sheets later. The wheel has no
    // CSS variables to leave unresolved and no black fills, so both checks passed vacuously
    // while page 1 — the map one-pager, the first line of the packet spec — was
    // blank. The sheet count stayed 8 because the empty sheet still exists.
    // The packet's page order is the product spec and does not vary: sheet 0 IS the map page.
    const sheet0 = document.querySelector('.sheet')
    const svg = sheet0 ? sheet0.querySelector('svg') : null
    if (!svg) return ['no map svg on page 1 — the map one-pager rendered without its map']
    const faults = []
    // ⚠ AND ASSERT IT PAINTS GEOGRAPHY. Palette-resolves + not-black are both properties a
    // map with ZERO country shapes satisfies perfectly. Geography is counted as paths whose
    // `d` is long enough to be a coastline rather than an icon or a chart tick. MEASURED
    // across zones: laos 13, brazil 18, middle-east-core 55 — it varies with how many
    // countries a zone spans, so the floor is well under the smallest rather than an exact
    // count. Zones whose groups do not resolve are SKIPPED by the generator and never reach
    // this gate ("europe: no groups resolved — skipped"), so a zero here is a real fault.
    const geoPaths = [...svg.querySelectorAll('path')]
      .filter((e) => (e.getAttribute('d') || '').length > 200).length
    if (geoPaths < 5) {
      faults.push(`only ${geoPaths} geography path(s) on the map page — the map one-pager is `
        + 'blank or drew nothing but furniture (a correct palette and no black fills are both '
        + 'satisfied by a map with no countries on it)')
    }
    const names = [...new Set((svg.outerHTML.match(/var\((--[a-z0-9-]+)/g) || []).map((v) => v.slice(4)))]
    const cs = getComputedStyle(svg)
    for (const n of names) if (!cs.getPropertyValue(n).trim()) faults.push(`unresolved ${n}`)
    const all = [...svg.querySelectorAll('path,circle,text,rect,line')]
    const black = all.filter((e) => getComputedStyle(e).fill === 'rgb(0, 0, 0)')
    if (all.length && black.length > all.length * 0.25) {
      faults.push(`${black.length}/${all.length} map elements fill BLACK`)
    }
    return faults
  })()

  return {
    sheets: document.querySelectorAll('.sheet').length,
    cards: document.querySelectorAll('.card').length,
    // The LIGHTWEIGHT packet lists its people as worksheet rows (packet-render worksheetPages), not cards.
    wsRows: document.querySelectorAll('.ws-row').length,
    wsBoxes: document.querySelectorAll('.ws-box').length,
    wsSheets: document.querySelectorAll('.sheet-worksheet').length,
    // The page-2 funnel is OPTIONAL (buildPacket omits it when no funnel data was supplied), so its
    // presence is DETECTED rather than assumed — see the sheet arithmetic below, which must stay
    // exact about list pages whether or not this page is there.
    funnel: document.querySelectorAll('.funnel-title').length,
    lifeSheets: document.querySelectorAll('.sheet-life').length,
    // The bounded- and centered-set back pages (one sheet per chart). Counted so the arithmetic below
    // stays exact whether or not the caller supplied set data.
    setsSheets: document.querySelectorAll('.sheet-sets').length,
    christianSheets: document.querySelectorAll('.sheet-christian').length,
    // ★ THE LIFE GRIDS ARE ONE SVG EACH (2026-10-02): two paths of square subpaths (empty and shaded) placed by
    // the geometry the SVG states (data-geom x0,y0,px,decadeGap,py). Each subpath is decoded back to its box index
    // in reading order, so the checks below still see box by box what is drawn, not a count the renderer asserts.
    lifeCells: [...document.querySelectorAll('.lc-frame .lc-svg')].reduce((a, g) => a + window.__lcBoxes(g).total, 0),
    prayBoxes: document.querySelectorAll('.pray-box').length,
    fdTopOver: (() => { const b = document.querySelector('.fd-top'); if (!b) return 0; const top = b.getBoundingClientRect().top
      return Math.round(Math.max(0, ...[...b.children].map((k) => k.getBoundingClientRect().bottom + parseFloat(getComputedStyle(k).marginBottom))) - top - b.clientHeight) })(),
    // The points page is ONE sheet by design and fits only because its sizes were tuned to the longest locale;
    // measure its content against its box (studio's ask), as fdTopOver does for the list's first page.
    // Each points sheet's body is measured, the worst one reported (one sheet today).
    pointsOver: (() => { const bs = [...document.querySelectorAll('.points-body')]; if (!bs.length) return null
      return Math.max(...bs.map((b) => { const top = b.getBoundingClientRect().top
        return Math.round(Math.max(b.scrollHeight - b.clientHeight, ...[...b.children].map((k) => k.getBoundingClientRect().bottom - top - b.clientHeight))) })) })(),
    pointsSheets: document.querySelectorAll('.sheet-points').length,
    // ★ THE POINTS PAGE SIZES ITSELF FROM AN ESTIMATE (2026-10-03, data-pt-est): the page must never be taller
    // than the estimate it was sized by, or the estimate is drifting and only its 3% margin still saves the page.
    pointsUnder: (() => { const b = document.querySelector('.points-body[data-pt-est]'); if (!b) return null
      const top = b.getBoundingClientRect().top, kids = [...b.children]
      const real = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom - top)) + parseFloat(getComputedStyle(kids[kids.length - 1]).marginBottom)
      return { real: Math.round(real), est: Number(b.dataset.ptEst), tier: Number(b.dataset.ptTier) } })(),
    funnelTip: document.querySelectorAll('.funnel-tip').length,
    lifeShaded: (() => { const g = document.querySelector('.sheet-christian .lc-svg'); return g ? window.__lcBoxes(g).shaded.length : null })(),
    // ★ FILLED FROM THE TOP, in reading order (the packet's design), measured on the DOM order of the cells:
    // the shaded boxes must be EXACTLY the first N. This used to require a SCATTER, the opposite design;
    // a count alone still cannot tell a top fill from a scatter or a fill from the bottom.
    lifeTopFill: (() => {
      const g = document.querySelector('.sheet-christian .lc-svg')
      if (!g) return null
      const s = window.__lcBoxes(g).shaded
      return s.every((v, i) => v === i)
    })(),
    // The life page: Jesus' 33 years, the first 33 x 52 = 1,716 boxes and no others.
    jesusTopFill: (() => {
      const g = document.querySelector('.sheet-life .lc-svg')
      if (!g) return null
      const s = window.__lcBoxes(g).shaded
      return { on: s.length, top: s.every((v, i) => v === i) }
    })(),
    funnelEq: document.querySelectorAll('.funnel-eq').length,
    funnelSteps: document.querySelectorAll('.funnel-mine').length,
    // ★ MEASURED SO THE GATE CAN REPORT WHAT IT ASSERTED. A review found the gate printed no funnel line, even
    // with --expect-funnel, so a reader could not see WHAT it asserted about page 2. A silent pass is
    // the mirror of a printed-but-unasserted number: the check is real and the evidence is invisible.
    // ⚠ ZERO POPULATION IS COUNTED ON PURPOSE. The reader's row printed "0 people" in every packet
    // (Number(null) is 0, so the finite-number guard admitted a deliberate no-data marker). Fixed in
    // the renderer — and counted here so the fix cannot silently regress.
    // ★ BY EXPLICIT HOOKS, NOT BY STYLE STRINGS. These used to count divs whose inline style contained
    // "line-height:1" (rows) and "height:16px" (bars). The page is now one SVG triangle, which has
    // neither, so both would have read ZERO and "rows === bars" would have passed while asserting
    // nothing. Every tier is a .funnel-tier shape and every tier's count a .funnel-n, inside the
    // shape or leading its caption.
    funnelRows: (() => {
      const sheet = document.querySelector('.funnel-title')?.closest('.sheet')
      return sheet ? sheet.querySelectorAll('.funnel-n').length : 0
    })(),
    funnelBars: (() => {
      const sheet = document.querySelector('.funnel-title')?.closest('.sheet')
      return sheet ? sheet.querySelectorAll('.funnel-tier').length : 0
    })(),
    funnelZeroPop: (() => {
      const sheet = document.querySelector('.funnel-title')?.closest('.sheet')
      if (!sheet) return 0
      return [...sheet.querySelectorAll('div')]
        .filter((d) => !d.children.length && /(^|\D)0(\D|$)/.test(d.textContent.trim())
          && d.textContent.trim().length < 24 && /\d/.test(d.textContent))
        .filter((d) => /^0(\.0+)?\s+\D/.test(d.textContent.trim())).length
    })(),
    funnelShare: (document.querySelector('.funnel-share')?.textContent || '').trim().slice(0, 80),
    // ★ LATIN RUNS ON A NON-LATIN SHEET, the one gap a review named and that was left open: the gate
    // passed because it counted rows, not the rows' language. It asserted the funnel page's STRUCTURE
    // and nothing about whether its prose reached the reader's language, the standing rule turned on
    // this gate itself.
    //
    // ⚠ IT ONLY WORKS IN A NON-LATIN-SCRIPT LOCALE, and that is why it is worth having rather than
    // aspiring to a general "is this translated?" test, which is not decidable. On a hi/ar/ru/zh sheet
    // a run of Latin letters is a proper name, a number, or an UNTRANSLATED STRING — three
    // possibilities, two of which are enumerable. In de/fr/es an untranslated string looks like
    // ordinary text and this measures nothing, so those locales are not covered and the gate does not
    // pretend otherwise.
    //
    // MEASURED across every non-Latin packet in out/ (hi, ar, ru, zh): exactly TWO Latin runs appear,
    // both the data source's name. Anything else is the defect. Verified against the real one — with
    // the pre-fix English list label restored on the hi sheet it reports ['Project', 'frontier people
    // groups'], and an untranslated key reports ['THIS packet'].
    funnelLatinRuns: (() => {
      const sheet = document.querySelector('.funnel-title')?.closest('.sheet')
      if (!sheet) return []
      const txt = sheet.textContent || ''
      // Digits break a run, so "Project 4700" surfaces as "Project" — deliberate: the designation is
      // allowed by name below, and a bare "Project" beside a number is exactly what an untranslated
      // label looks like.
      const runs = txt.match(/[A-Za-z][A-Za-z.'/&-]{2,}(?:\s+[A-Za-z][A-Za-z.'/&-]*)*/g) || []
      return [...new Set(runs.map((r) => r.trim()))]
    })(),
    // ★ A CARD MUST NAME ITS PEOPLE GROUP. Counting .card proves the element exists; the spec says
    // pages 2..n carry "the people groups, 20 per page, with photos" — a card with a photo and a
    // BLANK NAME satisfies every count here: the total holds, the photo/typographic split holds,
    // the page arithmetic holds. Same gap the .nophoto count had, one element up.
    // ⚠ MEASURE THE NAME ELEMENT, NOT THE WHOLE CARD. A first version tested card.textContent and
    // FAILED ITS OWN MUTATION TEST: blanking every name still left 18 characters per card, because
    // the typographic fallback ("no photo available") lives INSIDE .card. The card was not empty;
    // it just said nothing about a people group. .nm is the name line the spec means
    // (packet-render.js:229), so that is what has to be non-empty.
    // MEASURED 2026-09-25 on laos: 95 names, 0 blank, shortest "1. Aheu" — a threshold of 3 sits
    // far below any real entry and above an empty one.
    cardsBlank: [...document.querySelectorAll('.card')]
      .filter((c) => {
        const nm = c.querySelector('.nm')
        return !nm || (nm.textContent || '').replace(/\s+/g, ' ').trim().length < 3
      }).length,
    imgs: imgs.length,
    // ⚠ DISTINCT sources, not the tag count. A PDF DE-DUPLICATES identical images, so the
    // number of /Subtype /Image objects can never equal the number of <img> tags when two
    // people groups share a portrait. MEASURED on laos: 95 cards, 95 <img>, but only 85
    // distinct srcs — ten groups reuse another group's photo, which is a fact about the
    // upstream photo set, not a rendering fault. Comparing the PDF against 95 would have
    // reported "8 photos dropped at print time" on a correct packet; comparing against 85
    // asks the question that has a right answer.
    distinctImgSrc: new Set(imgs.map((i) => i.getAttribute('src'))).size,
    broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length,
    nophoto: document.querySelectorAll('.nophoto').length,
    // ★ A TYPOGRAPHIC CARD MUST SAY SOMETHING. The count above proves the element exists; it says
    // nothing about whether the reader sees a label or an empty grey box. The renderer writes
    // t('no_photo') there (packet-render.js:225), which is translated in all 11 catalogs — so a
    // blank fallback is both a layout defect and a silent i18n failure, and counting alone catches
    // neither.
    // MEASURED 2026-09-25 on the first MIXED packet ever rendered (PHOTOS_EVERY=3 over laos:
    // 31 photos, 64 typographic): all 64 read "no photo available", 0 blank, all 64 with a real box.
    nophotoBlank: [...document.querySelectorAll('.nophoto')]
      .filter((e) => !(e.textContent || '').trim()).length,
    nophotoUnsized: [...document.querySelectorAll('.nophoto')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width < 4 || r.height < 4 }).length,
    rhythms: RHYTHMS.filter((w) => body.includes(w)).length,
    rhythmsTotal: RHYTHMS.length,
    // The segments are the wheel sheet's filled ARC paths (M centre L rim A …), whatever their colour notation:
    // counting fill^="hsl" read 0 once the wheel took the source's hex palette, and the gate went red on every
    // packet while the wheel was fine. The "Start here" arrow is a path too, but unfilled and arc-less.
    wheelSegs: (() => {
      const title = document.querySelector('.wheel-title')
      const svg = title ? title.closest('.sheet')?.querySelector('svg') : null
      return svg ? [...svg.querySelectorAll('path')].filter((p) => / A /.test(p.getAttribute('d') || '')
        && (p.getAttribute('fill') || 'none') !== 'none').length : 0
    })(),
    // ⚠ COUNT THE WHEEL'S OWN LABELS, SCOPED TO THE WHEEL SHEET. `rhythms` below
    // searches document.body.innerText, and the SAME rhythm vocabulary is rendered
    // TWICE — once per wheel segment, and once per prayer point (each point prints
    // tr(p.rhythm) as its heading). So "every rhythm word appears in the document" is
    // satisfied by the POINTS page alone and says nothing about the wheel.
    // Measured 2026-09-24: blanking every wheel segment label left the gate reporting
    // "12 segments, 11/11 rhythms, content intact — PASS" on a prayer wheel that was a
    // twelve-colour pie chart with no words on it. Both numbers stayed true: the
    // segments are <path> elements and survive, and the words were still on the points
    // page. The spec names the wheel as one of the packet's four sections.
    //
    // COUNT ELEMENTS, NOT DISTINCT WORDS. `order` renders 12 segments from 12 keys, but
    // `praise` and `praise_end` collapse to the same word in English (which is why the
    // line below prints 11/11, not 12/12) — and that collision is LOCALE-DEPENDENT. A
    // distinct-word count would be a different number per language.
    wheelLabels: (() => {
      const title = document.querySelector('.wheel-title')
      const sheet = title ? title.closest('.sheet') : null
      const svg = sheet ? sheet.querySelector('svg') : null
      if (!svg) return -1
      // The segment labels are the wheel's own label runs (class="wheel-label", packet-render wheelPage), counted
      // when they carry words. Counting every non-numeric <text> read 25 once each rim badge gained its
      // "minutes" tag and the wheel its "Start here": those are furniture, not segment labels.
      return [...svg.querySelectorAll('text.wheel-label')]
        .filter((t) => (t.textContent || '').trim()).length
    })(),
    // ⚠ NOT body.includes('Gadarenes'). That was an ENGLISH proper noun, so this
    // assertion would go RED on a correctly-translated packet and stays green today
    // only because every locale falls back to English for this key. The check and the
    // bug were locked together. Assert the STRUCTURE instead — the passage block exists
    // and carries a full passage's worth of text — which holds in any language.
    mark5Len: (document.querySelector('.p4-passage')?.textContent || '').trim().length,
    // ★ POINT 4 NOW PRINTS A READING LIST, NOT THE PASSAGE (2026-09-30): THE HEAVENLY FATHER'S HEART, seven
    // readings. Counted by STRUCTURE (the .p4-heart hook and its items), which holds in any language.
    heartItems: document.querySelectorAll('.p4-heart li').length,
    heartTitle: (document.querySelector('.p4-heart-h')?.textContent || '').trim().length,
    v19Len: (document.querySelector('.p4-passage .p4-v19')?.textContent || '').trim().length,
    // ⚠ COUNT THE POINTS. The sheet-sum invariant below already required a points PAGE —
    // and a page with three points on it is still exactly one sheet, so a packet headed
    // "12 Prayer Points" printed THREE and every number this gate asserted stayed correct.
    // Measured 2026-09-24 against a deliberately partial locale block: the renderer did
    // `L.points || EN.points`, which is a whole-block fallback when the key is ABSENT but
    // TRUNCATES when a translator has done some of the 12 (a 3-element array is truthy).
    // Counted from the rendered numbered rows, not from the strings file, because the
    // strings file was complete in all 11 locales — the defect only exists downstream.
    points: (() => {
      const title = document.querySelector('.points-title')
      if (!title) return -1
      const host = title.parentElement?.parentElement
      if (!host) return -1
      // Each point's heading carries class="pt-h": a numbered LINE is not a point. German cites "1. Petrus 5:6–11"
      // (its own name for 1 Peter), and that reference line was counted as a thirteenth point.
      const heads = document.querySelectorAll('.pt-h')
      if (heads.length) return heads.length
      return (host.innerText || '').split('\n').filter((l) => /^\s*\d{1,2}\.\s/.test(l)).length
    })(),
    metacamp: (body.match(/metacamp\.org/g) || []).length,
    mapFaults,
    // Printed beside the verdict: a reader should see the number the assertion rests on,
    // not just the word "painted".
    mapGeoPaths: (() => {
      const sheet0 = document.querySelector('.sheet')
      const svg = sheet0 ? sheet0.querySelector('svg') : null
      if (!svg) return -1
      return [...svg.querySelectorAll('path')].filter((e) => (e.getAttribute('d') || '').length > 200).length
    })(),
    // The per-page "{from}-{to} of {count}" headers, as DIGIT TRIPLES rather than text.
    // Read from the rendered DOM (not the source template) so what is checked is what a
    // reader would see. Locale digits are normalised to ASCII first: several catalogs
    // render through toLocaleString, and Arabic-Indic digits would not match \d.
    ranges: [...document.querySelectorAll('.hd-r')].map((el) => {
      const ascii = el.textContent
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
        .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
        .replace(/[,٬   ]/g, '')   // thousands separators
      return (ascii.match(/\d+/g) || []).map(Number)
    }).filter((nums) => nums.length === 3),
  }
})

const pdf = await page.pdf({ preferCSSPageSize: true })
await browser.close()

const raw = pdf.toString('latin1')
const boxes = [...raw.matchAll(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [+m[1], +m[2]])
const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length
const landscape = boxes.filter(([w, h]) => h <= w).length
// ★ THE PRINT LAYER, WHICH NOTHING ASSERTED. This gate already GENERATED a PDF and then
// read only its STRUCTURE — page count and MediaBox. The packet exists to be PRINTED (it
// is a standalone file with photos and fonts inlined precisely so it prints offline), so
// "8 pages of the right size" is satisfied by eight blank sheets.
// FontFile2 = a TrueType face actually EMBEDDED in the document. Zero means the text was
// either rasterised or left to whatever fonts the printer happens to have, which for a
// packet carrying a vendored Devanagari face is the difference between Hindi and tofu.
const pdfFonts = (raw.match(/\/FontFile2/g) || []).length
const pdfImages = (raw.match(/\/Subtype\s*\/Image/g) || []).length
const pdfBytes = pdf.length

// Counts are RELATIVE (sheets vs pages, cards vs photos) so this gate is not pinned to
// one zone's group count — a per-zone packet has a different number of both.
const fails = []
if (!r.sheets) fails.push('no .sheet elements — the packet did not render')
if (!r.cards && !r.wsRows) fails.push('no people-group cards or worksheet rows — a packet of nobody')
if (r.wsRows && r.wsBoxes !== r.wsRows * 3) fails.push(`${r.wsRows} worksheet rows should carry ${r.wsRows * 3} tally cells but the packet has ${r.wsBoxes}`)
if (r.cardsBlank) {
  fails.push(`${r.cardsBlank} of ${r.cards} people-group card(s) have no NAME — a card that `
    + 'names nobody is a slot on the page, not an entry in a prayer list. The counts above cannot '
    + 'see this: the total, the photo split and the page arithmetic all hold, and so does '
    + 'card.textContent, because the "no photo available" fallback sits inside the card.')
}
if (r.broken) fails.push(`${r.broken} broken photo(s)`)

// ── "20 PER PAGE **WITH IMAGES**" WAS PRINTED, NEVER ASSERTED ────────────────
// The packet spec names the photos explicitly, and this gate printed
// "95 cards (0 photos, 95 typographic)" and PASSED — every locale, every run.
// Measured 2026-09-24: all 2,107 source records carry an image_url, so zero photos
// means the fetch was skipped or failed wholesale, not that the groups have none.
//
// ⚠ THE COUNT CANNOT BE PINNED. Roughly half the groups genuinely have no photo,
// the CDN drops some, and NOPHOTOS=1 is a SUPPORTED dev mode for fast layout
// iteration (packet.mjs:35). A packet built that way is a valid artefact, not a
// defect — so the assertion has to tell "deliberately none" from "silently none".
// Two invariants do that without pinning a number:
//   1. every card is one or the other — photos + typographic === cards. A card that
//      is neither means the renderer emitted a third shape nobody is checking.
//   2. a packet with SOME photos proves the pipeline ran. Zero is only acceptable
//      when EVERY card is typographic AND the run was declared photo-less, which is
//      what PACKET_EXPECT_PHOTOS=0 says out loud.
if (r.nophotoBlank) {
  fails.push(`${r.nophotoBlank} of ${r.nophoto} typographic card(s) render an EMPTY box — the `
    + 'renderer writes a localized "no photo" label there, so a blank one is both a layout defect '
    + 'and a silent i18n failure. Counting the elements cannot see this.')
}
if (r.nophotoUnsized) {
  fails.push(`${r.nophotoUnsized} of ${r.nophoto} typographic card(s) collapsed to no box — a `
    + 'fallback that occupies no space leaves a hole where a face should be')
}
if (r.cards && r.imgs + r.nophoto !== r.cards) {
  fails.push(`${r.cards} people cards but ${r.imgs} photo + ${r.nophoto} typographic = `
    + `${r.imgs + r.nophoto} — every card must be exactly one of the two`)
}
// The packet's own stamp is authoritative; the env var stays as an override for
// artefacts generated before data-packet-build existed.
// `fixture` implies no photos: a fixture packet is built from a committed records subset
// with image_url stripped precisely so CI never fetches ~43 images from someone else's CDN.
const expectPhotos = process.env.PACKET_EXPECT_PHOTOS !== '0' && !/\b(nophotos|fixture)\b/.test(build)
if (r.cards && expectPhotos && r.imgs === 0) {
  fails.push(`${r.cards} people cards and NOT ONE photo — the packet spec is "20 per page `
    + 'WITH IMAGES", and every source record carries an image_url, so this is a skipped or '
    + 'failed photo fetch, not a zone without pictures. Re-run without NOPHOTOS=1, or set '
    + 'PACKET_EXPECT_PHOTOS=0 to declare this a deliberately photo-less packet.')
}
// ★ THE LIGHTWEIGHT ROWS SHOW PEOPLE TOO (2026-09-30): every worksheet row carries exactly one photo cell, a
// photo or the "no photo" box, and a photo-expecting packet carries at least one photo, as the cards above.
if (r.wsRows && r.imgs + r.nophoto !== r.wsRows) {
  fails.push(`${r.wsRows} worksheet rows but ${r.imgs} photo + ${r.nophoto} "no photo" = ${r.imgs + r.nophoto} — `
    + 'every row must carry exactly one of the two')
}
if (r.wsRows && expectPhotos && r.imgs === 0) {
  fails.push(`${r.wsRows} worksheet rows and NOT ONE photo — the lightweight packet shows every group's photo `
    + 'too, so this is a skipped or failed photo fetch. Set PACKET_EXPECT_PHOTOS=0 to declare a photo-less packet.')
}
if (r.wheelSegs !== 12) fails.push(`prayer wheel has ${r.wheelSegs} segments, expected 12`)
// A SEGMENT WITHOUT ITS WORD IS A COLOUR. 12 labels, one per segment, on the wheel
// sheet itself — not merely somewhere in the document.
const WHEEL_LABELS = 12
if (r.wheelLabels !== WHEEL_LABELS) {
  fails.push(r.wheelLabels === -1
    ? 'no prayer-wheel svg found (no .wheel-title sheet) — the wheel page did not render'
    : `the prayer wheel paints ${r.wheelLabels} segment label(s), expected ${WHEEL_LABELS} — `
      + 'the rhythm words are rendered TWICE in this packet (wheel segments and prayer-point '
      + 'headings), so the document-wide rhythm check below passes on the points page alone '
      + 'and cannot see an unlabelled wheel')
}
if (r.rhythms !== r.rhythmsTotal) fails.push(`only ${r.rhythms}/${r.rhythmsTotal} prayer rhythms present`)
// Mark 5:1-20 in full is a requirement for point 4: it lists out the full scripture,
// because prayer point four is reading the word itself. The
// English passage is 2,141 chars; 1,200 is a floor that no truncation or placeholder
// survives while leaving room for languages that render the same text more compactly
// (zh is typically ~40% shorter in characters).
// Point 4 prints THE HEAVENLY FATHER'S HEART: a heading and seven readings, each addressed in the reader's
// own Bible. It replaced Mark 5:1-20 in full (2026-09-30), so the passage is no longer asserted; the list is.
// ★ POINT 4 PRINTS MARK 5:18-20 (2026-09-30, the second revision: only those verses, so all twelve points fit
// one page), with verse 19 in bold. English is 385 chars + the credit; 250 is a floor no truncation or
// placeholder survives, with room for the more compact languages (Russian is 277).
// ★ AND A CEILING: the floor alone also passes the full 1-20 passage (2,141 chars in English). The browser
// gate's one-sheet fit refuses 1-20 too, but it is NOT MEASURED in a headless run, so this ceiling is the
// only headless guard for "18-20 only". 18-20 measures 277-428 chars across the 11 locales; 1-20 is well
// over 700 in every one of them.
const MARK5_MIN = 250
const MARK5_MAX = 700
if (r.mark5Len < MARK5_MIN) {
  fails.push(r.mark5Len === 0
    ? 'Mark 5:18-20 is NOT printed (a requirement for point 4): no .p4-passage block'
    : `Mark 5:18-20 looks truncated: ${r.mark5Len} chars, expected at least ${MARK5_MIN}`)
} else if (r.mark5Len > MARK5_MAX) {
  fails.push(`point 4's passage is ${r.mark5Len} chars, over ${MARK5_MAX}: more than Mark 5:18-20 is printed `
    + '(the full 1-20 passage is back?), and the twelve points no longer fit one page')
}
if (!r.v19Len) fails.push('Mark 5:19 is not in bold (no .p4-v19 inside the passage)')
const HEART_ITEMS = 7
if (r.heartItems !== HEART_ITEMS || !r.heartTitle) {
  fails.push(r.heartItems === 0
    ? "point 4's reading list is NOT printed (no .p4-heart block)"
    : `point 4's reading list prints ${r.heartItems} of ${HEART_ITEMS} readings${r.heartTitle ? '' : ', and no heading'}`)
}
// THE PRODUCT IS NAMED FOR THIS NUMBER. The page header says "12 Prayer Points" in every
// locale, so 12 is a contract, not a preference — and the failure mode it guards is SILENT:
// a partial translation rendered fewer, with nothing blank and no error raised.
const POINTS_EXPECT = 12
if (r.points !== POINTS_EXPECT) {
  fails.push(r.points === -1
    ? 'no .points-title block — the 12 prayer points page did not render at all'
    : `${r.points} prayer point(s) rendered, expected ${POINTS_EXPECT} — a partial locale `
      + 'block truncates the list instead of falling back per key, and the page still '
      + 'carries its "12 Prayer Points" heading')
}
if (r.metacamp !== 2) fails.push(`${r.metacamp} metacamp.org attributions, expected exactly 2`)
// THE MAP PAGE IS OPT-OUT-ABLE, THE SAME WAY THE PHOTOS ARE — and for the same reason.
// packet.mjs lifts the map from out/posters/<zone>.html and, when that file is absent,
// deliberately "still builds (cover page without the map) rather than failing". That soft
// fail is intentional, but it is also INVISIBLE: measured 2026-09-24, a packet built with
// no poster sources has 8 sheets and an <svg> present (the prayer wheel's) and carries no
// marker at all, so it is structurally indistinguishable from a good one while page 1
// promises a map one-pager and delivers an empty sheet. doxa-maps-plugin-studio ships 0
// poster html files against wt-packet's 28, so every packet generated there is degraded
// this way and nothing said so.
// Default to FAILING, so the degradation has to be DECLARED rather than discovered.
const expectMap = process.env.PACKET_EXPECT_MAP !== '0' && !/\bnomap\b/.test(build)
if (r.mapFaults.length && expectMap) {
  fails.push(`map: ${r.mapFaults.join('; ')}`
    + (r.mapGeoPaths === -1
      ? ' — build the poster sources first (node library/scripts/posters/generate.mjs), or set '
        + 'PACKET_EXPECT_MAP=0 to declare this a deliberately map-less packet'
      : ''))
}
if (fontStatus.declared && fontStatus.loaded !== fontStatus.declared) {
  fails.push(`a declared @font-face did not load (${fontStatus.names.join(', ')}) — `
    + 'text in that script will print as empty boxes')
}
if (RTL.has(lang) && dir !== 'rtl') fails.push(`lang="${lang}" is right-to-left but dir="${dir}"`)
if (!RTL.has(lang) && dir === 'rtl') fails.push(`lang="${lang}" is not RTL but dir="rtl"`)
// The attribute is necessary; this is the part that proves it took effect.
if (layout.sampled >= 5) {
  const wantRight = RTL.has(lang)
  const pinned = wantRight ? layout.pinnedRight : layout.pinnedLeft
  if (pinned < Math.ceil(layout.sampled * 0.8)) {
    fails.push(`lang="${lang}" should paint text to the ${wantRight ? 'RIGHT' : 'LEFT'}, but only `
      + `${pinned}/${layout.sampled} sampled runs do (right ${layout.pinnedRight}, left ${layout.pinnedLeft}) — `
      + `dir="${dir}" is declared and not taking effect`)
  }
  if (RTL.has(lang) && layout.rtlComputed < layout.sampled) {
    fails.push(`${layout.sampled - layout.rtlComputed}/${layout.sampled} sampled elements compute `
      + 'direction:ltr inside an RTL packet — something overrides the document direction')
  }
}
if (translated === 0) {
  fails.push(`lang="${lang}" but no string differs from English — `
    + 'the language block is missing, mis-keyed, or the renderer ignored it')
}
// ── "N strings translated" WAS PRINTED, AND ONLY ZERO WAS ASSERTED ──────────
// A locale regressing from 19 translated keys to 1 passed silently: the only check
// was `=== 0`. But the count CANNOT be pinned — measured 2026-09-24, de translates
// 18 of the same 19 keys and fr 17, because a word or two legitimately matches
// English. Hardcoding 19 would fail two correct catalogs.
// So assert a FLOOR derived from the catalog itself: most of what a block carries
// must actually differ from English. Two-thirds leaves generous room for shared
// proper nouns while still catching a block that has quietly emptied out.
// The structural half of this — every key PRESENT, all 12 points, all 12 rhythms —
// is check:packet-strings-parity, which does not need a rendered packet to run.
if (translated !== null && translated > 0) {
  const present = Object.keys(catalog.en).filter((k) => typeof catalog.en[k] === 'string'
    && typeof (catalog[lang] || {})[k] === 'string').length
  const floor = Math.ceil(present * 2 / 3)
  if (present && translated < floor) {
    fails.push(`lang="${lang}" carries ${present} string(s) but only ${translated} differ from `
      + `English (floor ${floor}) — most of this block has reverted to English text`)
  }
}
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)
if (landscape) fails.push(`${landscape} landscape page(s) — the packet must be portrait`)
if (pages !== r.sheets) fails.push(`${pages} PDF pages for ${r.sheets} sheets — one sheet must be exactly one page`)

// ── THE PRINTED ARTEFACT ────────────────────────────────────────────────────
// TEXT MUST BE EMBEDDED TEXT. Measured across scripts: en 7 FontFile2, ar/hi/zh all
// embed too. Zero would mean the packet prints with whatever the printer has, which
// defeats the reason photos and fonts are inlined in the first place.
if (pdfFonts === 0) {
  fails.push('the PDF embeds NO fonts (0 /FontFile2) — the packet is a standalone file '
    + 'meant to print offline, so its text must travel with it rather than depend on the '
    + "printer's font set")
}
// THE PHOTOS MUST SURVIVE PRINTING. Compared against DISTINCT srcs, because the PDF
// de-duplicates identical images — see the note on distinctImgSrc above. A small
// allowance covers the map and page furniture, which are images too.
if (expectPhotos && r.distinctImgSrc > 0 && pdfImages < r.distinctImgSrc) {
  fails.push(`${pdfImages} image(s) in the PDF for ${r.distinctImgSrc} distinct photo source(s) — `
    + 'photos are being dropped at PRINT time, which no on-screen check can see')
}
// AND IT MUST NOT BE AN EMPTY SHELL. A packet with 95 inlined photos is megabytes; a
// few hundred KB means the content did not make it into the print output at all.
const PDF_MIN_KB = expectPhotos ? 500 : 40
if (pdfBytes / 1024 < PDF_MIN_KB) {
  fails.push(`the PDF is only ${Math.round(pdfBytes / 1024)}KB, expected at least ${PDF_MIN_KB}KB — `
    + 'the pages are the right size and count but carry almost nothing')
}

// ── THE PAGE SIZE WAS PRINTED BUT NEVER CHECKED ─────────────────────────────
// `landscape` only catches h <= w, so a WRONG PORTRAIT size sailed through: A4 is
// 595x842pt, taller-than-wide like Letter, and would have been reported as a clean
// pass on a packet that prints with the wrong margins on every US printer.
// That is not hypothetical here — this repo has already paid for it once. `@page
// {size:...}` silently falls back to Letter in Chromium for any named size beyond
// letter/A4, so the declared size and the produced size can disagree with no error
// anywhere. The renderer declares `@page{size:letter portrait}` (packet-render.js:97);
// this asserts the PDF actually came out that way.
// Tolerance is 1pt for float formatting in the MediaBox, not for real drift.
const LETTER = [612, 792]
if (!boxes.length) {
  fails.push('the PDF declares no MediaBox — page geometry could not be read at all')
} else {
  const wrong = boxes.filter(([w, h]) => Math.abs(w - LETTER[0]) > 1 || Math.abs(h - LETTER[1]) > 1)
  if (wrong.length) {
    fails.push(`${wrong.length}/${boxes.length} page(s) are not US Letter — got `
      + `${wrong[0].join(' x ')}pt, expected ${LETTER.join(' x ')}pt `
      + '(@page{size:letter portrait} did not take effect)')
  }
}

// ── THE CARD COUNT WAS PRINTED BUT ONLY CHECKED FOR ZERO ────────────────────
// `if (!r.cards)` passes a packet carrying ONE card. The existing comment is right
// that counts must stay RELATIVE — a per-zone packet has a different group count, so
// pinning 95 would make this gate zone-specific. But relative does not mean unasserted:
// the renderer lays out PER_PAGE cards per list page (packet-render.js:59, COLS*ROWS),
// and the packet is map + list pages + points + wheel. So the whole structure is
// derivable from the card count alone, for ANY zone:
//
//     sheets === 1 + ceil(cards / PER_PAGE) + 2
//
// That ties the printed number to the sheet count without pinning either. It catches
// silently dropped groups (a selector that resolves 95 but renders 40 keeps the same
// page arithmetic only if the pages drop too) and a mis-sized grid, which is the way
// "20 per page WITH IMAGES" actually regresses. Verified against all 11 locale packets
// of laos (95 cards -> 8 sheets) before being turned on.
//
// ⚠ THE PAGE-2 FUNNEL IS COUNTED, NOT TOLERATED. When it was added (2026-09-26) every fixture went
// red here with "43 cards should lay out as 6 sheets, but the packet has 7" — the gate doing its job
// on a structural change it had not been told about. The wrong fix is to accept N or N+1 sheets:
// this assertion exists to catch SILENTLY DROPPED PEOPLE GROUPS, and a ±1 tolerance is exactly the
// slack a lost list page would hide in. So the funnel is DETECTED (.funnel-title) and added as a
// known term, leaving the list-page arithmetic as strict as it was.
// ⚠ AND THE SAME FOR THE LIFE-CALENDAR PAGES (2026-09-27, the specified page order). Two more structural
// sheets — a 100-year life in weeks, then the SAME grid shaded by the evangelical share of these
// groups' population — so they are DETECTED and added as known terms for exactly the reason the
// funnel was, and for the reason stated above: a tolerance here would hide a dropped list page.
// THE PAGE SIZES ARE THE RENDERER'S, read from it rather than retyped: the first list page of each packet
// gives rows to the explanation band (2026-10-02), so a typed number drifted the moment the band changed.
const { createPacketRenderer: makeR } = await import(resolve(dirname(fileURLToPath(import.meta.url)), '../library/packet/packet-render.js'))
const RR = makeR({ strings: catalog, lang: 'en' })
const PER_PAGE = RR.PER_PAGE
const funnelSheets = r.funnel ? 1 : 0
const lifeSheets = (r.lifeSheets || 0) + (r.christianSheets || 0)
// ⚠ AND THE SETS PAGES (bounded, centered): back matter, DETECTED for the same reason as the rest.
// Before they were counted the arithmetic only held when a fixture omitted set data.
const setsSheets = r.setsSheets || 0
// Both lists give their first page to the explanation band: the worksheet holds WS_FIRST rows there and
// WS_REST after; the profile pages FD_FIRST, then PER_PAGE.
const wsPages = (n) => (n <= 0 ? 0 : 1 + Math.ceil(Math.max(0, n - RR.WS_FIRST) / RR.WS_REST))
const fdPages = (n) => (n <= 0 ? 0 : 1 + Math.ceil(Math.max(0, n - RR.FD_FIRST) / PER_PAGE))
const listSheets = r.cards ? fdPages(r.cards) : wsPages(r.wsRows)
// The Full detail's first page reserves a block for the explanation and CLIPS what outgrows it (rather than
// let it overlap the rows): only a measurement sees a clipped line, so measure it.
if (r.pointsOver !== null && r.pointsOver > 0) fails.push(`the prayer-points page outgrows its sheet by ${r.pointsOver}px — the twelve points and the themes must fit ONE page in every language`)
if (r.pointsUnder && r.pointsUnder.real > r.pointsUnder.est) fails.push(`the prayer-points page is ${r.pointsUnder.real}px tall, over the ${r.pointsUnder.est}px its size tier ${r.pointsUnder.tier} was chosen by — the estimate (packet-render pointsHeight) under-measures this language`)
if (r.fdTopOver > 0) fails.push(`the Full detail's explanation block outgrows its reserved height by ${r.fdTopOver}px — text is clipped (raise FD_TOP_H)`)
if (r.wsRows && r.wsSheets !== wsPages(r.wsRows)) fails.push(`${r.wsRows} worksheet rows should take ${wsPages(r.wsRows)} page(s) but the packet has ${r.wsSheets}`)
// + 2 again (2026-09-30, the second revision): point 4's Mark 5:18-20 and the Father's-heart list are back ON the
// points page, so the back matter is the wheel and the points.
// + 2: the wheel and the points, the twelve points and the themes on ONE sheet (2026-10-02, at the demo).
if (r.pointsSheets !== 1) fails.push(`the twelve prayer points and the themes should fit ONE sheet, found ${r.pointsSheets}`)
const expectedSheets = 1 + lifeSheets + funnelSheets + listSheets + setsSheets + 2
// ── THE LIFE-CALENDAR PAGES, asserted rather than merely counted ──────────────────────────────────
// A page that EXISTS is not a page that is RIGHT: an empty grid, a grid of the wrong size, or a
// christian page whose shading silently fell to zero would all still be one sheet. 5,200 is the
// spec's own arithmetic (100 years x 52 weeks) and is the only number here that may not drift.
if (r.lifeSheets) {
  const EXPECT = 5200
  const perGrid = r.lifeCells / (r.lifeSheets + (r.christianSheets || 0))
  if (perGrid !== EXPECT) {
    fails.push(`the life calendar should be ${EXPECT} cells per grid (100 years x 52 weeks) `
      + `but rendered ${perGrid} — the grid changed size, so the page no longer shows a human life`)
  }
}
// ⚠ AND THE SHADE MUST BE SCATTERED, NOT STACKED — the assertion that would have caught what three gates
// and a passing suite did not. A contact sheet (2026-09-28) showed page 3 reading as ONE SOLID BAR:
// 32 contiguous cells fill most of row 1 of 52, so the page said "a big green block" where the
// intent is 32 boxes lost in 5,200. Every assertion passed, because they all measured the COUNT.
// Half the grid height is a deliberately loose floor: a genuine scatter of even a few cells spans most of
// the page (measured: 32 cells over 26 rows, 95% of the height), and a bar spans ~1%. Anything in between
// is worth a human look.
if (r.christianSheets && r.lifeTopFill === false) {
  fails.push('the christian-share page\'s shaded boxes are not the first N in reading order — the grid must fill FROM THE TOP')
}
if (r.lifeSheets && r.jesusTopFill && (r.jesusTopFill.on !== 33 * 52 || !r.jesusTopFill.top)) {
  fails.push(`the life page shades ${r.jesusTopFill.on} boxes${r.jesusTopFill.top ? '' : ', not from the top'} — Jesus' 33 years are the first 1,716`)
}
// ★ THE SHADED SHARE MUST BE NON-ZERO AND NOT EVERYTHING. 0 shaded means the percentage never
// reached the page (a null christian-share file renders the page with an empty grid, which reads as
// "nobody is reached" — a false claim rather than missing data); 5,200 means the maths inverted.
if (r.christianSheets) {
  const shaded = r.lifeShaded ?? null
  if (shaded !== null && (shaded <= 0 || shaded >= 5200)) {
    fails.push(`the christian-share page shaded ${shaded} of 5200 cells — 0 would claim nobody is `
      + `reached and 5200 would claim everybody is; both mean the percentage did not arrive`)
  }
}
// The three prayer columns: one tally cell per group per question, so the count is exactly 3 x cards.
if (r.cards && r.prayBoxes !== r.cards * 3) {
  fails.push(`${r.cards} people cards should carry ${r.cards * 3} prayer tally cells `
    + `(did I bless them / what do you want me to know / what do you want me to do) but the packet has ${r.prayBoxes}`)
}
if (r.cards && r.sheets !== expectedSheets) {
  fails.push(`${r.cards} people cards should lay out as ${expectedSheets} sheets `
    + `(1 map${lifeSheets ? ` + ${lifeSheets} life-calendar` : ''}${funnelSheets ? ' + 1 funnel' : ''} + ${listSheets} list${setsSheets ? ` + ${setsSheets} sets` : ''} + points + wheel), `
    + `but the packet has ${r.sheets} — either groups were dropped from a page or the `
    + `${PER_PAGE}-per-page grid changed`)
}
// ★ AND IF THE FUNNEL PAGE IS THERE, IT MUST CARRY ITS NUMBERS. A sheet holding the title and no
// figures would satisfy the arithmetic above perfectly — the same "a number printed but not asserted
// on is decoration" trap the card-name check above exists for, one page earlier. .funnel-mine is the
// reader's own share, the one figure on the page that is about THIS packet.
if (r.funnel && !r.funnelSteps) {
  fails.push('the funnel page rendered its title but no share figure (.funnel-mine) — '
    + 'page 2 is asserting a narrowing it never states')
}
// ★ AND IF THE CALLER DECLARED IT, ITS ABSENCE IS A FAILURE. See the --expect-funnel note at the top:
// a lost call site produces a packet that is CORRECT but missing page 2, which is why nothing caught
// a merge deleting one.
// ★ EVERY FUNNEL ROW MUST HAVE A BAR. A browser check measured the first version: the reader's step had no bar,
// so the funnel never visibly narrowed to "yours" — a funnel whose final term is not drawn as part of
// the funnel fails at the one thing it is for. Rows and bars are counted separately so the next
// regression is a mismatch rather than an invisible omission.
if (r.funnel && r.funnelRows !== r.funnelBars) {
  fails.push(`the funnel page has ${r.funnelRows} step row(s) but ${r.funnelBars} bar(s) — `
    + 'every step must be drawn as part of the funnel, including the reader\'s own')
}
// ★ AND NO STEP MAY PRINT A ZERO POPULATION. "0 people" appeared on the reader's row of every packet
// because Number(null) is 0 and the renderer's guard tested finiteness rather than PRESENCE. A people
// group with no people is not a fact; it is missing data wearing a number's clothes.
// ★ AND ON A NON-LATIN SHEET, THE FUNNEL'S PROSE MUST BE IN THE READER'S SCRIPT. See funnelLatinRuns
// above for why this is only meaningful in hi/ar/ru/zh. This is the gap a review named after the ?list=
// render (the gate passed because it counted rows, not the rows' language), and it was right — the English
// list label sat among Devanagari and every assertion here was green.
//
// ⚠ THE ALLOWLIST IS TWO ENTRIES AND BOTH ARE DECISIONS, NOT BOOKMARKS:
//   IMB, peoplegroups.org — the publisher's name and its domain. A reader following the citation meets
//     the English name at the destination, so translating it would hide the thing it identifies. Same
//     reasoning the i18n allowlist uses for "Open Bible Stories" and "Scripture Earth".
//   Project — the campaign designation ("Project 4700" / "مشروع 4700" / "4700 计划"). Digits break a run,
//     so the numeral is not part of the match; the WORD is allowed because it is a name, while the
//     description beside it ("frontier people groups") is prose and must be translated.
// If a third entry is ever needed, say in the entry whether it is settled or deferred — an allowlist
// that does not distinguish the two turns an open defect into a verdict.
// 'UPG-' is the Latin run left by "UPG-100", the PRODUCT NAME, which every locale keeps verbatim —
// the same reason 'Project' is here (Project 4700 / 700 are list names, not prose). Verified it is the
// only Latin left in the ar funnel page after the tip and sidebar strings were genuinely translated:
// an allowlist entry added BEFORE translating would have hidden fifteen untranslated strings.
// 'UPG' is the same product name as renamed, "UPG 100" with a space: the digits break the run, so it
// surfaces as 'UPG' (page 2's kicker and packets tier). Settled, like 'UPG-' — a name, not prose.
// The series is now written as ONE term, "UPG100" (2026-10-02): the digits still break the run, so it too
// surfaces as 'UPG'.
const LATIN_OK = new Set(['IMB', 'peoplegroups.org', 'Project', 'UPG-', 'UPG'])
const NON_LATIN_LOCALES = new Set(['hi', 'ar', 'ru', 'zh', 'he', 'fa', 'ur', 'bn', 'ta', 'th', 'ko', 'ja'])
if (r.funnel && NON_LATIN_LOCALES.has(String(lang).split('-')[0])) {
  const stray = (r.funnelLatinRuns || []).filter((x) => !LATIN_OK.has(x))
  if (stray.length) {
    fails.push(`the funnel page carries Latin-script prose in a ${lang} packet: `
      + `${stray.map((x) => JSON.stringify(x)).join(', ')} — an untranslated string, or a name that `
      + 'belongs in LATIN_OK with a reason')
  }
}
if (r.funnel && r.funnelZeroPop) {
  fails.push(`${r.funnelZeroPop} funnel row(s) print a ZERO population — absent data must be hidden, `
    + 'not rendered as the number 0 (Number(null) === 0, so test presence, not finiteness)')
}
if (EXPECT_FUNNEL && !r.funnel) {
  fails.push('--expect-funnel was passed but this packet has NO funnel page (.funnel-title) — '
    + 'the caller that supplies funnel data to buildPacket is missing or passing null, '
    + 'and a packet without page 2 is otherwise indistinguishable from a correct one')
}

// ── ...AND THAT ALONE IS NOT ENOUGH: IT ONLY PROVES SELF-CONSISTENCY ────────
// ⚠ MUTATION-TESTED, AND THE FIRST VERSION OF THIS GATE FAILED THE TEST. Deleting a
// whole list sheet from a finished packet removed 15 cards AND one sheet, so
// `sheets === 1 + ceil(cards/20) + 2` still held: 80 cards / 7 sheets is internally
// valid arithmetic, and the packet PASSED while missing 15 people groups. A packet can
// be perfectly self-consistent and still have lost content — exactly the shape of the
// index.json "declares 16, 15 on disk" bug.
// So compare against an INDEPENDENT WITNESS the renderer prints for the reader: each
// list page's header carries {from}-{to} of {count} (packet-render.js:219). `count` is
// the zone's TRUE group total, derived from groups.length rather than from the pages,
// so it does not move when a page is lost.
//
// ⚠ PARSE THE NUMBERS, NEVER THE WORD ORDER. That header is TRANSLATED and the
// languages disagree on order: en/ar read "1-20 of 95", hi reads "95 में से 1–20" and
// zh reads "95 之中的 1–20" — the total comes FIRST. A positional regex would read hi
// and zh backwards and assert against 1 instead of 95. Since count >= to >= from always,
// max() recovers the total without knowing any locale's grammar.
if (r.ranges.length) {
  const totals = [...new Set(r.ranges.map((t) => Math.max(...t)))]
  if (totals.length > 1) {
    fails.push(`list pages disagree on the zone total: ${totals.join(' vs ')}`)
  } else {
    const total = totals[0]
    if (r.cards !== total) {
      fails.push(`the packet's own page headers say this zone has ${total} people groups, `
        + `but only ${r.cards} cards rendered — ${total - r.cards} were silently dropped`)
    }
    // The pages must TILE [1..total] with no gap and no overlap: a lost middle page
    // leaves a hole that the totals check above cannot see.
    const spans = r.ranges.map((t) => { const s = [...t].sort((a, b) => a - b); return [s[0], s[1]] })
      .sort((a, b) => a[0] - b[0])
    let cursor = 0
    for (const [from, to] of spans) {
      if (from !== cursor + 1) {
        fails.push(`list pages do not tile: expected a page starting at ${cursor + 1}, got ${from} — `
          + 'a page is missing or duplicated')
        break
      }
      cursor = to
    }
    if (cursor !== total && !fails.some((f) => f.includes('do not tile'))) {
      fails.push(`list pages stop at ${cursor} but the zone has ${total} groups`)
    }
  }
} else if (r.cards) {
  fails.push('no list-page range headers found — the "N of M" witness this gate '
    + 'cross-checks the card count against is missing')
}

console.log(`  build            : ${build || '(unstamped — generated before data-packet-build)'}`)
console.log(`  people-group list: ${packetList || '(default)'}`)
if (r.funnel && NON_LATIN_LOCALES.has(String(lang).split('-')[0])) {
  console.log(`  funnel Latin runs: ${(r.funnelLatinRuns || []).length
    ? r.funnelLatinRuns.map((x) => JSON.stringify(x)).join(', ') : '(none)'}`)
}
console.log(`  sheets/PDF pages : ${r.sheets} / ${pages}`)
console.log(`  printed artefact : ${(pdfBytes / 1024 / 1024).toFixed(1)}MB, ${pdfFonts} embedded font(s), `
  + `${pdfImages} image(s) for ${r.distinctImgSrc} distinct source(s)`)
console.log(`  people cards     : ${r.cards}  (${r.imgs} photos, ${r.nophoto} typographic)`)
console.log(`  funnel (page 2)  : ${r.funnel
  ? `${r.funnelRows} row(s), ${r.funnelBars} bar(s)${r.funnelShare ? ` — "${r.funnelShare}"` : ' — no share line'}`
  : 'absent' + (EXPECT_FUNNEL ? ' (REQUIRED — see FAIL above)' : ' (not required)')}`)
console.log(`  prayer points    : ${r.points} / ${POINTS_EXPECT}`)
if (r.pointsUnder) console.log(`  points size tier : ${r.pointsUnder.tier} (estimated ${r.pointsUnder.est}px, measured ${r.pointsUnder.real}px)`)
console.log(`  wheel segments   : ${r.wheelSegs}  (${r.wheelLabels}/${WHEEL_LABELS} labelled)`)
console.log(`  point 4         : Mark 5:18-20 ${r.mark5Len} chars, verse 19 bold ${r.v19Len} chars, ${r.heartItems} readings`)
console.log(`  metacamp.org     : ${r.metacamp}`)
console.log(`  map (page 1)     : ${r.mapFaults.length
  ? `${r.mapFaults.join('; ')}${expectMap ? '' : `   [declared deliberate: ${/\bnomap\b/.test(build) ? 'data-packet-build="' + build + '"' : 'PACKET_EXPECT_MAP=0'}]`}`
  : `${r.mapGeoPaths} geography paths, palette resolves, not black`}`)
console.log(`  page size        : ${boxes[0] ? boxes[0].join(' x ') : '?'} pt`
  + `${boxes.length ? ` (all ${boxes.length} pages, asserted US Letter)` : ''}`)
console.log(`  layout           : ${r.cards} cards / ${PER_PAGE} per page `
  + `= ${expectedSheets} sheets expected, ${r.sheets} rendered`)
console.log(`  script font      : ${fontStatus.declared ? fontStatus.names.join(', ') : 'system stack'}`)
console.log(`  text layout      : ${layout.pinnedRight} right / ${layout.pinnedLeft} left of `
  + `${layout.sampled} sampled run(s)${layout.sampled < 5 ? '  (too few to assert)' : ''}`)
console.log(`  language         : ${lang} (dir=${dir})  (${r.rhythms}/${r.rhythmsTotal} rhythms in ${lang}`
  + `${translated === null ? '' : `, ${translated} strings translated`})`)

if (fails.length) {
  console.error(`\nPACKET-RENDER: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
// ⚠ THE VERDICT MUST NOT CLAIM MORE THAN WAS CHECKED. It read "map painted" unconditionally,
// so a packet passing under PACKET_EXPECT_MAP=0 — one with NO map on page 1 — was summarised
// as having a painted map. The summary line is the part a reader actually quotes.
console.log(`\nPACKET-RENDER: PASS — ${r.sheets} sheets, ${r.sheets} pages, portrait, `
  + `${r.mapFaults.length ? 'NO map (declared)' : 'map painted'}, content intact.`)
