#!/usr/bin/env node
/**
 * check-packet-variants — the two packets behind the Prayer List caret, and the promise that adding
 * that caret did not disturb the Cards.
 *
 * WHY A GATE: the brief asked for a second print option on the Prayer List AND for the existing
 * print options to be left intact. Those are two assertions, and only one
 * of them is about the new code. The other — THE CARDS STILL WORK EXACTLY AS THEY DID — is the kind
 * of promise that is true when you make it and quietly false three commits later, because nothing
 * fails when a shared disclosure grows a second caller. So it is pinned here.
 *
 * Every check reads the REAL source; none reads a fixture. Headless, no browser, no network.
 * Exit 0 pass · 1 fail.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
// The wall's cards are drawn by PosterSection.vue (lifted out of PosterWall.vue, which provides it the shared state),
// so the print-row markup this gate reads lives in BOTH files: read them as one wall.
const WALL = read('library/components/poster/PosterWall.vue') + '\n' + read('library/components/poster/PosterSection.vue')
const PRINTS = read('library/composables/usePosterPrints.js')
const EN = JSON.parse(read('library/i18n/locales/en/buttons.json'))

const fails = []
const ok = (cond, msg) => { if (!cond) fails.push(msg) }

// ── 1. THE TWO VARIANTS EXIST AND AGREE ACROSS THE SEAM ────────────────────────────────────────
// packet-render owns the variant names; PosterWall names them again in its menu. A typo in either
// is invisible: buildPacket falls back to 'full' on an unknown variant, so "Lightweight" would
// print the FULL packet — a wrong packet, not an error. Both sides are read and compared.
const { createPacketRenderer } = await import(resolve(ROOT, 'library/packet/packet-render.js'))
const strings = JSON.parse(read('library/scripts/posters/packet-strings.json'))
const R = createPacketRenderer({ strings, lang: 'en' })
ok(R.VARIANTS && typeof R.VARIANTS === 'object', 'packet-render does not export VARIANTS')
const renderIds = Object.keys(R.VARIANTS || {})
ok(renderIds.includes('full') && renderIds.includes('lightweight'),
  `VARIANTS must define full + lightweight, got: ${renderIds.join(', ')}`)

// The UI's list, read out of the source rather than duplicated here — duplicating it would make
// this gate agree with itself instead of with the component.
const uiIds = [...WALL.matchAll(/\{\s*id:\s*'([a-z]+)',\s*labelKey:\s*'([\w.]+)'\s*\}/g)]
ok(uiIds.length >= 2, `the wall's packetVariants list was not found (got ${uiIds.length} entries)`)
for (const [, id, key] of uiIds) {
  ok(renderIds.includes(id), `the wall offers variant '${id}' but packet-render has no such VARIANT — buildPacket would silently fall back to 'full' and print the WRONG packet`)
  // A missing label key renders the raw key as the button text ("buttons.packetFull"), which looks
  // like a broken translation rather than a missing string.
  const leaf = key.replace(/^buttons\./, '')
  ok(EN[leaf] !== undefined, `label key '${key}' is absent from library/i18n/locales/en/buttons.json — the button would print the raw key`)
}
ok(EN.packetVariantAria !== undefined, 'buttons.packetVariantAria is missing — the revealed row would have no accessible name')

// ── 2. THE TWO PACKETS DIFFER IN THE SPECIFIED WAY, AND LOSE NOBODY ────────────────────────────
// ★ THE LOAD-BEARING ONE. A variant drops FIXED pages; it must never drop a page whose count
// depends on the data, because that drops PEOPLE — silently, with the packet still looking like a
// packet. Asserted by counting the group names actually printed, not the sheets.
const groups = Array.from({ length: 45 }, (_, i) => ({ slug: `g${i}`, name: `Group ${i}`, country_code: 'MYS', population: 1000, imb_gsec: 1 }))
const zone = { id: 'test', label: 'Test Zone' }
const funnel = { steps: [{ label: 'a', groups: 12379 }, { label: 'b', groups: 2107 }] }
const christian = { pctEvangelical: 3.2 }
// ★ THE SETS MUST BE SUPPLIED OR THIS GATE CANNOT SEE THE PAGE. setsPage returns '' without data —
// correctly, so a host with no set data still gets a valid packet — which means a build() that
// omits `sets` exercises the variant filter for every page EXCEPT the one most recently added. The
// gate stayed green through the whole sets rewrite while asserting a 2-sheet delta that had become
// 3. A fixture that is missing an input silently narrows what the whole file covers.
const sets = {
  bounded: Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, reached: i % 3 === 0 ? true : (i % 3 === 1 ? false : undefined) })),
  centered: Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, ring: (i % 12) - 1 })),
}
const build = (v) => R.buildPacket(zone, groups, new Map(), '<svg/>', funnel, christian, v, sets)
const count = (html, re) => (html.match(re) || []).length

const full = build('full')
const light = build('lightweight')
const names = (h) => count(h, /Group \d+</g)
ok(names(full) === 45, `full packet printed ${names(full)} of 45 groups`)
ok(names(light) === 45, `LIGHTWEIGHT printed ${names(light)} of 45 groups — a variant dropped PEOPLE, which is the one thing it may never do`)

// The life calendar and the %-evangelical grid are the two contemplative sheets lightweight drops.
ok(count(full, /sheet-life/g) >= 1, 'the full packet has no life calendar')
ok(count(full, /sheet-christian/g) >= 1, 'the full packet has no %-evangelical page')
ok(count(light, /sheet-life/g) === 0, 'lightweight still carries the life calendar')
ok(count(light, /sheet-christian/g) === 0, 'lightweight still carries the %-evangelical page')
// …and keeps the triangle, the profiles, the wheel and the points.
ok(count(light, /funnel-title/g) === count(full, /funnel-title/g), 'lightweight lost the funnel (the narrowing triangle)')
// …and the SETS page, which is back matter a reader sits with rather than carries — the same
// reason the life calendar and the %-evangelical grid are dropped.
// ★ ONE PAGE PER CHART (2026-09-29: the bounded set on one page, the centered set on another),
// asserted by each page's own class, so losing EITHER chart fails by name rather than inside a total.
ok(count(full, /<div class="sheet [^"]*sheet-sets\b/g) === 2, 'the full packet should have TWO sets pages, one per chart')
ok(count(full, /sheet-sets-bounded/g) === 1, 'the full packet has no bounded-set chart')
ok(count(full, /sheet-sets-centered/g) === 1, 'the full packet has no centered-set chart')
ok(count(full, /class="set-cross"/g) === 2, 'both set charts must carry the cross at their centre')
ok(count(light, /sheet-sets-(bounded|centered)/g) === 0, 'lightweight still carries a sets page')
// ⚠ THE DELTA IS DERIVED, never relaxed into a range: lightweight drops four back pages (life, % grid,
// bounded, centered) AND lists the same people as a worksheet, whose pages hold more rows than profiles.
{
  const profilePages = 1 + Math.ceil(Math.max(0, 45 - R.FD_FIRST) / R.PER_PAGE)
  const worksheetPages = count(light, /<div class="sheet sheet-worksheet/g)
  const want = 4 + profilePages - worksheetPages
  ok(worksheetPages >= 1 && count(light, /class="ws-row"/g) === 45, `the lightweight worksheet should list all 45 groups, got ${count(light, /class="ws-row"/g)}`)
  ok(count(full, /<div class="sheet/g) - count(light, /<div class="sheet/g) === want,
    `lightweight should be exactly ${want} sheets shorter, got ${count(full, /<div class="sheet/g)} vs ${count(light, /<div class="sheet/g)}`)
}
// ★ THE LIGHTWEIGHT ROWS SHOW PEOPLE TOO (2026-09-30): every worksheet row carries the group's photo (or the
// "no photo" box when the record has none) and its description, as the full packet's profiles do. Built here
// WITH photos and a describer, because build() above passes neither and so cannot see them.
{
  const RD = createPacketRenderer({ strings, lang: 'en', describe: (g) => `${g.name} is a people group in Malaysia.` })
  const pics = new Map(groups.filter((_, i) => i % 5).map((g) => [g.slug, `https://img.test/${g.slug}.jpg`]))
  const lw = RD.buildPacket(zone, groups, pics, '<svg/>', funnel, christian, 'lightweight', sets)
  const rows = count(lw, /class="ws-row"/g), imgs = count(lw, /<img class="ws-ph"/g), none = count(lw, /class="ws-ph nophoto"/g)
  ok(rows === 45 && imgs === pics.size && imgs + none === rows,
    `each lightweight row should carry ONE photo cell (${pics.size} photos + ${45 - pics.size} "no photo"), got ${imgs} + ${none} in ${rows} rows`)
  ok(count(lw, /class="ws-desc"/g) === 45, `each lightweight row should carry its group's description, got ${count(lw, /class="ws-desc"/g)} of 45`)
}
// ★ BOTH LISTS EXPLAIN THEMSELVES FIRST (2026-10-02, v2): the first list page of EACH packet carries, before any
// row, the blessing in full with its credit, ONE line of further references, the wheel pointer, and ONE band
// (class="xb"): a five-pace table whose loads are COMPUTED from the list (45 groups: all 45 a day, 6 at a
// weekly pace), what the three columns ask, and an example row of three tally cells under the table's own
// question heads. The question heads stand ONCE per page over the tally cells, never per group.
for (const [name, html, rowRe, cellRe, headRe, pageRe] of [
  ['lightweight', light, /class="ws-row"/g, /class="ws-box"/g, /class="ws-head"/g, /<div class="sheet sheet-worksheet/g],
  ['full', full, /class="card"/g, /class="pray-box"/g, /class="pray-head"/g, /<div class="hd">/g],
]) {
  const E = strings.en
  const band = html.indexOf('<section class="xb"')
  ok(count(html, /<section class="xb"/g) === 1 && band > 0 && band < html.search(rowRe),
    `the ${name} list should explain itself ONCE, on its first list page, before the first row`)
  ok(html.includes(E.blessing_text.replace(/&/g, '&amp;')) && html.includes(E.blessing_credit), `the ${name} list should print the blessing (Numbers 6:24-26) with its credit`)
  ok(count(html, /class="ws-refs"/g) === 1 && count(html, /Psalm 134:3/g) === 1, `the ${name} list should carry ONE line of blessing references`)
  ok(html.includes(E.howto_wheel), `the ${name} list should point to the prayer wheel at the end of the packet`)
  const pace = (html.match(/<table class="ws-pace-t">([\s\S]*?)<\/table>/) || [])[1] || ''
  ok(count(pace, /<tr/g) === 5 && pace.includes('all 45, every day') && pace.includes('about 6 a day') && count(pace, /ws-pace-best/g) === 1,
    `the ${name} pace table should show five paces, daily = all 45 and weekly = about 6 a day (from the list size), weekly marked: ${pace.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`)
  ok(count(html, /class="xb-cell /g) === 3 && count(html, /class="xb-marks"/g) === 3, `the ${name} band's example should be ONE row of three tally cells with marks`)
  ok(count(html, rowRe) === 45 && count(html, cellRe) === 45 * 3, `every ${name} row should carry three tally cells, got ${count(html, cellRe)} for ${count(html, rowRe)} rows`)
  ok(count(html, headRe) === count(html, pageRe), `the ${name} question heads should stand once per list page: ${count(html, headRe)} heads on ${count(html, pageRe)} pages`)
}
ok(!/no pace to keep/.test(light), 'the lightweight list should no longer say there is no pace to keep')
// ★ THE PRAYER THEMES HEAD THE POINTS PAGE (2026-10-02): seven themes, then three scenes with two references
// each, in both packets; point 12 is John 17 (its references are John 17:3, John 17:11–23, Ephesians 3:20).
for (const [name, html] of [['lightweight', light], ['full', full]]) {
  const th = (html.match(/<div class="pt-themes">([\s\S]*?)<\/div>\s*<div style="margin-bottom/) || [])[1] || ''
  const themes = count(th.split('pt-sc-list')[0] || '', /<li>/g), scenes = count(th.split('pt-sc-list')[1] || '', /<li>/g)
  ok(themes === 7 && scenes === 3 && count(th, /class="pt-sc-r"/g) === 3 && /Haggai 2:7/.test(th) && /Matthew 8:26/.test(th),
    `the ${name} points page should open with 7 themes and 3 scenes (2 references each): ${themes} themes, ${scenes} scenes`)
  ok(/John 17:3/.test(html) && /Ephesians 3:20/.test(html) && !/Acts 2:42/.test(html), `the ${name} point 12 should be John 17 (John 17:3 · John 17:11–23 · Ephesians 3:20)`)
}
ok(!/<em>[^<]*<\/em><\/span>/.test(full.slice(full.indexOf('class="card"'))), 'the full packet repeats a question under each tally cell; the heads stand once per page')
// ★ THE LIFE CALENDAR, HEADLESS — the grid's CONTENT, not just its page. An adversarial review mutated the
// renderer to shade the LAST 33 years, to shade nothing, and to draw 90 rows; every packet gate stayed green
// because none looked inside the grid. Read the cells of each frame, in order (the legend's sample boxes
// sit outside the frame and are excluded):
{
  // The grid is ONE SVG per page (packet-render lifeGrid): decode each square subpath back to its box index
  // from the geometry the SVG declares, so the check reads the boxes as drawn, in reading order.
  const grid = (html, cls) => {
    const i = html.indexOf(`<div class="sheet ${cls}`)
    const a = html.indexOf('<svg class="lc-svg"', i)
    return a < 0 || i < 0 ? '' : html.slice(a, html.indexOf('</svg>', a))
  }
  const boxes = (svg) => {
    // data-geom x0,y0,px,dec[,py]: the box pitch across and down (one pitch when py is absent).
    const [x0, y0, px, dec, py = px] = ((svg.match(/data-geom="([^"]+)"/) || [])[1] || '').split(',').map(Number)
    const weeks = Number((svg.match(/data-weeks="(\d+)"/) || [])[1])
    const idx = (d) => [...String(d || '').matchAll(/M([\d.]+) ([\d.]+)/g)].map((m) => {
      const x = Number(m[1]) - 0.5 - x0, y = Number(m[2]) - 0.5 - y0, b = Math.floor(y / (10 * py + dec))
      return (b * 10 + Math.round((y - b * (10 * py + dec)) / py)) * weeks + Math.round(x / px)
    })
    const off = idx((svg.match(/<path class="lc-off" d="([^"]*)"/) || [])[1])
    const on = idx((svg.match(/<path class="lc-(?:on|reached)" d="([^"]*)"/) || [])[1]).sort((a, b) => a - b)
    return { total: off.length + on.length, distinct: new Set([...off, ...on]).size, on }
  }
  const life = boxes(grid(full, 'sheet-life'))
  ok(life.total === 5200 && life.distinct === 5200, `the life calendar should hold 100 x 52 = 5,200 distinct boxes, got ${life.total} (${life.distinct} distinct)`)
  ok(life.on.length === 33 * 52 && life.on.every((v, i) => v === i),
    `the life calendar should shade Jesus' 33 years as its FIRST 1,716 boxes — got ${life.on.length}, from the top: ${life.on.every((v, i) => v === i)}`)
  const ev = boxes(grid(full, 'sheet-christian'))
  ok(ev.total === 5200 && ev.on.length === Math.round(0.032 * 5200) && ev.on.every((v, i) => v === i),
    `the %-evangelical grid should shade 3.2% = ${Math.round(0.032 * 5200)} boxes FROM THE TOP, got ${ev.on.length} of ${ev.total}`)
  // THE SAME TABLE: the people grid has the life grid's exact shape (one aspect ratio for both pages).
  const vb = (svg) => (svg.match(/viewBox="([^"]+)"/) || [])[1]
  ok(vb(grid(full, 'sheet-life')) && vb(grid(full, 'sheet-life')) === vb(grid(full, 'sheet-christian')), 'the people grid should have the life grid\'s exact shape')
}

// ★ THE POINTS PAGE FITS ITSELF (2026-10-03): per language it takes the LARGEST size tier whose estimate fits
// one sheet, from the one-sheet sizes up to the two-sheet sizes before them (the cap). Asserted both ways: the
// tier chosen is the largest that fits, and SHORTER words print LARGER (halving the English points raises
// the English tier) while the real words keep theirs. check:packet-render holds the estimate to the real page.
{
  for (const lang of ['en', 'ar', 'zh', 'fr']) {
    const R = createPacketRenderer({ strings, lang })
    const f = R.pointsFit, k = f.chosen(), budget = f.bodyH * f.safe
    ok(k === f.tiers || f.height(k + 1) > budget, `${lang}: points tier ${k} is not the largest that fits (tier ${k + 1} estimates ${Math.round(f.height(k + 1))}px of ${Math.round(budget)})`)
    ok(k === 0 || f.height(k) <= budget, `${lang}: points tier ${k} estimates ${Math.round(f.height(k))}px, over the ${Math.round(budget)}px budget`)
    ok(R.pointsPage().includes(`data-pt-tier="${k}"`), `${lang}: the points page does not print at the tier it chose (${k})`)
  }
  const top = (lang, s) => createPacketRenderer({ strings: s, lang }).pointsFit
  const short = JSON.parse(JSON.stringify(strings))
  short.en.points = short.en.points.map((p) => ({ ...p, text: p.text.slice(0, Math.ceil(p.text.length / 2)) }))
  const k0 = top('en', strings).chosen(), k1 = top('en', short).chosen()
  ok(k1 > k0, `halving the English points' text should raise the English points tier, got ${k0} -> ${k1}`)
  // the cap is the two-sheet sizes: the largest tier prints the point text at 22.5px
  ok(/font:400 22\.5px Georgia/.test(createPacketRenderer({ strings, lang: 'en' }).pointsPage(top('en', strings).tiers)), 'the largest points tier should print the text at 22.5px (the two-sheet size, the cap)')
}

// ★ UNKNOWN POINTS ARE STATED EVEN THOUGH THEY CANNOT BE PLOTTED. layoutBoundedSet gives them no
// x/y — deliberately, since `reached` undefined means we do not know which side they belong on and
// drawing them anywhere would assert exactly what is unknown. On a printed page there is no hover,
// so a category the reader cannot see reads as zero. It must appear in the tally text.
{
  const caps = full.match(/class="set-cap">([^<]*)</g) || []
  ok(caps.length === 2, `expected two set captions, found ${caps.length}`)
  ok(/10/.test(caps.join(' ')), 'the bounded tally does not state its unknown count — an un-inked category reads as zero in print')
}

// ★ EVERY GROUP OF THE LIST IS COUNTED (2026-10-03): a group with no record in a figure's data is named in
// that figure's caption ("15 without data"), so each caption's parts add up to the list. Both ways: the
// fixture's figures lack records (45 groups; 30 bounded, 24 centered), and complete data prints no such part.
{
  const sum = (cap) => [...cap.matchAll(/\d[\d,]*/g)].reduce((a, m) => a + Number(m[0].replace(/,/g, '')), 0)
  const capsOf = (html) => [...html.matchAll(/class="set-cap">([^<]*)</g)].map((m) => m[1])
  const nd = String(strings.en.sets_no_data).replace('{n}', '').trim()
  const short = capsOf(full)
  ok(short.length === 2 && short.every((c) => sum(c) === 45 && c.includes(nd)),
    `each set caption should add up to the list's 45 groups, naming the ones ${nd}: ${short.join(' | ')}`)
  const whole = capsOf(R.buildPacket(zone, groups, new Map(), '<svg/>', funnel, christian, 'full', {
    bounded: groups.map((g, i) => ({ id: g.slug, reached: i % 2 === 0 })), centered: groups.map((g, i) => ({ id: g.slug, ring: (i % 10) + 1 })) }))
  ok(whole.length === 2 && whole.every((c) => sum(c) === 45 && !c.includes(nd)),
    `with a record for every group, each caption should add up to 45 and name none ${nd}: ${whole.join(' | ')}`)
}

// ── THE RING LEGEND: THE AGREED VOCABULARY, AND ONLY THE RINGS THAT HOLD SOMEONE ────────────────
// ★ The names are COMPOSED from band x culture rather than a flat 1..10 table, because "same
// people" (provisional, pending a product decision) appears in rings 1, 4 AND 7 — three cells that a
// flat table would have to keep in step. This asserts the composition produces the vocabulary
// gospel and exp settled, so a printed sheet cannot disagree with the screen legend.
{
  const only = (rings) => {
    const html = R.buildPacket(zone, groups, new Map(), '<svg/>', funnel, christian, 'full',
      { bounded: [{ id: 'x', reached: true }], centered: rings.map((r, i) => ({ id: `r${i}`, ring: r })) })
    return [...html.matchAll(/<li><span class="ring-n">[^<]*<\/span>([^<]*)<span class="ring-c">([^<]*)<\/span><\/li>/g)]
      .map((m) => ({ name: m[1].trim(), count: m[2].trim() }))
  }
  const all = only([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  ok(all.length === 10, `the legend should name all ten rings, got ${all.length}`)
  // ⚠ THE CATALOGUE IS AUTHORITATIVE OVER THE COMMENT. CenteredSetTarget.vue's header abbreviates
  // ring 7-9 as "Same family"; the shipping string is "Same language family", and that is the word the
  // SCREEN renders, so the printed legend must use it too.
  const want = ['Same dialect, same people', 'Same dialect, near culture', 'Same dialect, different culture',
    'Same language, same people', 'Same language, near culture', 'Same language, different culture',
    'Same language family, same people', 'Same language family, near culture',
    'Same language family, different culture', 'Nearby only']
  want.forEach((w, i) => ok(((all[i] || {}).name || '') === w,
    `ring ${i + 1} should read ${JSON.stringify(w)}, got ${JSON.stringify(all[i])}`))
  // ★ EVERY RING IS EXPLAINED (2026-09-29: a legend explains each ring), and each row
  // states its own count. Two-sided: a populated ring shows its number, an empty ring shows a dash.
  const sparse = only([1, 1, 3, 7, 7, 7])
  ok(sparse.length === 10, `every ring should be explained even when empty, got ${sparse.length} rows`)
  ok(sparse[0].count === '2' && sparse[2].count === '1' && sparse[6].count === '3',
    `the legend should carry each populated ring's own count, got ${JSON.stringify(sparse.map((r) => r.count))}`)
  ok(sparse[1].count === '—' && sparse[9].count === '—', `an empty ring should read as a dash, got ${JSON.stringify(sparse.map((r) => r.count))}`)

  // ⚠ NO VERTICAL-OVERFLOW ASSERTION HERE, AND THAT IS DELIBERATE — I wrote one and deleted it.
  // gospel hit exactly this failure on their screen panel (21ebb4f2, "Stop the ring legend pushing
  // the centered-set chart off the page"): a legend stacked below a figure, taller than its space,
  // displaces the chart. Their fix leans on overflow:auto, which PRINT DOES NOT HAVE — so the same
  // layout would fail worse here, with the content simply gone rather than scrollable.
  // Budgeted it: the column needs ~924px of a ~1715px sheet with ALL TEN rings named, and the
  // assertion only starts failing at 51 rows. THERE ARE ONLY TEN RINGS, so it could never fail for
  // any input this code can produce — a tautology dressed as a safety check, the same class as the
  // "rows close on the bottom margin" one already deleted from check-profile-table. A printed sheet
  // is simply much taller than gospel's constrained pane, which is why their bug is not ours.
  // The real protection is the empty-ring filter asserted above (ten rows is the ceiling) plus
  // the rendered browser check; a headless budget with 790px of slack would be decoration.
}

// An unknown variant must print the FULL packet. A typo that printed a SHORTER packet would look
// like a successful print.
ok(build('nonsense-typo') === full, 'an unknown variant did not fall back to the full packet')

// ── 3. THE PRAYER LIST BUTTON PRINTS THE PACKET, NOT THE COLUMNAR LIST ─────────────────────────
// ★ THE DEFECT THIS WORK FOUND. The wall's Prayer List button called prints.printList() — a table
// of name/country/population/religion — while every other surface called printPacket(). So the
// packet the brief specified was never what this button produced. Pinned so it cannot regress.
ok(/printPacketAs[\s\S]{0,600}prints\.printPacket\(/.test(WALL),
  'printPacketAs does not call prints.printPacket — the Prayer List caret would print the columnar LIST again, not the packet')
ok(/variant/.test(PRINTS.match(/async function printPacket\([^)]*\)/)?.[0] || ''),
  'usePosterPrints.printPacket does not accept a variant — the caret\'s choice would be silently dropped')
// printList itself STAYS (by decision: keep it, just stop the button calling it).
ok(/function printList\(/.test(PRINTS) && /printList,/.test(PRINTS),
  'printList was removed — it must remain exported for any surface that still wants the columnar list')

// ── 4. THE CARDS ARE UNTOUCHED ─────────────────────────────────────────────────────────────────
// The brief: the Cards and their caret dropdown stay EXACTLY as they are. The only sanctioned
// change is the comparison key. Everything else about that button is asserted byte-for-byte.
const deckBtn = WALL.match(/<button v-if="canPrintRows" type="button" class="pbtn pbtn-deck"[\s\S]*?<\/button>/)
ok(!!deckBtn, 'the Card Deck button was not found at all')
if (deckBtn) {
  const b = deckBtn[0]
  ok(/class="pbtn pbtn-deck"/.test(b), 'the Card Deck button lost its classes')
  ok(/t\('buttons\.cardDeck'\)/.test(b), 'the Card Deck button lost its label key')
  ok(/@click\.stop="toggleDeck\(item\.id, \$event, 'deck'\)"/.test(b), 'the Card Deck button no longer opens its own row')
  ok(/:aria-expanded=/.test(b), 'the Card Deck button lost aria-expanded')
}
// The size row still gates on canPrintRows AND stockOptions.length — dropping either would render
// an empty tape.
ok(/v-if="canPrintRows && stockOptions\.length && deckOpenFor === deckKey\(item\.id, 'deck'\)"/.test(WALL),
  'the card-size row lost one of its guards, so it could render as an empty tape')
// printDeckAt still sets the stock and prints the deck.
ok(/function printDeckAt[\s\S]{0,300}pickedStock\.value = stockId[\s\S]{0,200}prints\.printCardDeck\(item\)/.test(WALL),
  'printDeckAt no longer sets the picked stock before printing the deck')

// ── 5. EXACTLY ONE TAPE OPEN AT A TIME ─────────────────────────────────────────────────────────
// ★ The property copy/paste would have lost. ONE ref holding ONE key is what makes "opening one
// closes the others" free; two booleans would let both tapes sit open and overlap in the grid gap.
const refs = [...WALL.matchAll(/const (deckOpenFor|packetOpenFor|listOpenFor)\s*=\s*ref\(/g)]
ok(refs.length === 1 && refs[0][1] === 'deckOpenFor',
  `expected exactly ONE disclosure ref, found ${refs.length}: ${refs.map((m) => m[1]).join(', ')} — two open-states means two tapes can be open at once`)
// Both tapes compare against that single ref, via the compound key.
ok(/deckOpenFor === deckKey\(item\.id, 'packet'\)/.test(WALL), 'the packet tape does not read the shared disclosure ref')
ok(/deckOpenFor === deckKey\(item\.id, 'deck'\)/.test(WALL), 'the card tape does not read the shared disclosure ref')
// The key must include BOTH the id and the which — an id-only key would make the two buttons on the
// SAME card toggle each other's row.
ok(/const deckKey = \(id, which\) => `\$\{id\}:\$\{which\}`/.test(WALL),
  'deckKey does not combine the item id AND the button — the two buttons on one card would fight over the same key')

// ── 6. EVERY @export CONSUMER SPLITS THE VARIANT OFF THE KIND ──────────────────────────────────
// ★ THE BUG THIS SECTION EXISTS FOR: the legend emits 'packet:full' / 'packet:lightweight', and a
// router that tests `kind === 'packet'` matches NEITHER, so the whole Packet submenu does nothing —
// no error, no console line, a menu item that simply never fires. It shipped in Simple Research
// while its 811-line twin in Country Posters was already fixed, which is the shape of defect that
// lives in one copy of duplicated code and cannot be found by reading either copy alone.
//
// Asserted on the SEAM rather than on one file: whatever the legend emits, every consumer must
// handle. So the emitted kinds are read out of the legend, and each consumer is required to split
// on ':' before comparing. A consumer that compares the whole string to a bare base is the bug.
const LEGEND = read('library/components/legends/SemanticTreeLegend.vue')
const emitted = [...LEGEND.matchAll(/emitExport\('([^']+)'\)/g)].map((m) => m[1])
ok(emitted.length > 0, 'no emitExport() calls found in SemanticTreeLegend — this check has gone blind')
const variantKinds = emitted.filter((k) => k.includes(':'))
ok(variantKinds.length > 0,
  `the legend emits no variant-carrying kind at all (saw: ${emitted.join(', ') || 'none'}) — if the menu lost its submenu this check is stale`)

const CONSUMERS = [
  ['plugin-designs/doxa-research-map/research-map.vue', 'onExport'],
  ['plugin-designs/country-posters/countries-map.vue', 'onExport'],
  ['plugin-designs/my-upg-100-list/upg-100-list.vue', 'onLegendExport'],
]
for (const [path, fn] of CONSUMERS) {
  let src
  try { src = read(path) } catch { ok(false, `${path} is missing — a consumer of the export menu moved or was renamed`); continue }
  const at = src.indexOf(`function ${fn}`)
  if (at < 0) { ok(false, `${path}: no ${fn}() — the export router was renamed, so this check no longer sees it`); continue }
  // The function's REAL extent, by brace depth from its opening brace. A fixed-size window read
  // part of a short router and half of a long one, and reported the long one — correct code — as
  // missing the comparison that sat just past the cutoff.
  const open = src.indexOf('{', at)
  let depth = 0, end = open
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) { end = i; break }
  }
  const body = src.slice(at, end + 1)
  ok(/String\(kind\)\.split\(':'\)/.test(body),
    `${path}: ${fn}() does not split the variant off the kind, so '${variantKinds[0]}' falls through every branch and the menu item does nothing`)
  // and having split it, it must compare the BASE — comparing the raw kind is the same bug wearing
  // a split that is computed and then ignored.
  ok(/\bbase === 'packet'/.test(body),
    `${path}: ${fn}() never compares the split base to 'packet'`)
  ok(!/\bkind === 'packet'/.test(body),
    `${path}: ${fn}() still compares the WHOLE kind to 'packet' — that is the comparison that never matches '${variantKinds[0]}'`)
}
// ── 7. A GENERATED MAP GOES THROUGH THE mapImage SEAM ──────────────────────────────────────────
// ★ THE THIRD DIVERGENCE OF THIS EXACT SHAPE between the two 811-line twins. A host that rasterises
// its LIVE map for packet page 1 must hand the URL over as `mapImage`, which the print standard
// PLACES AS THE WHOLE PAGE. Passing the same PNG as a bare <img> in `mapSvg` still renders — raw
// markup the renderer interpolates — but the page-1 redesign no longer draws that full page, so the
// map arrives shrunk inside a layout built for a stored sheet. It looks like a styling quirk rather
// than a wiring mistake, which is why it survived in one twin after the other was fixed.
for (const [path] of [
  ['plugin-designs/doxa-research-map/research-map.vue'],
  ['plugin-designs/country-posters/countries-map.vue'],
]) {
  let src
  try { src = read(path) } catch { ok(false, `${path} is missing — a packet host moved or was renamed`); continue }
  // ⚠ `[^)]*` CANNOT CROSS THE ARROW'S OWN PARENS. `useMapPoster(() => map.value).render(` contains a
  // `)` before the one that closes the call, so a negated-class match stops short and the guard
  // reports "this host does not rasterise a live map" for a host that plainly does — skipping both
  // files and leaving the whole section unexercised. Caught by poisoning it and seeing nothing fail.
  if (!/useMapPoster\([\s\S]{0,40}?\)\.render\(/.test(src)) continue   // host does not rasterise a live map
  ok(/mapImage:\s*\(\)/.test(src),
    `${path} rasterises its live map but does not pass it through the mapImage seam, so packet page 1 `
    + 'draws it at sheet size instead of full page')
  ok(!/printPacket\([^)]*\{\s*mapSvg/.test(src),
    `${path} still hands the generated map over as a bare mapSvg <img> — that is the shape the page-1 `
    + 'redesign stopped drawing full page')
}

// The variant has to survive the call, not just the comparison: splitting it and then printing the
// default is the same dead menu item with an extra line of code.
const RM = read('plugin-designs/doxa-research-map/research-map.vue')
ok(/openPacket\(variant \|\| 'full'\)/.test(RM),
  'research-map onExport drops the variant instead of passing it to openPacket')
ok(/async function openPacket\(variant = 'full'\)/.test(RM),
  'research-map openPacket does not accept a variant')
// ⚠ ASSERT THAT THE VARIANT TRAVELS, NOT THE ARGUMENT LIST IT TRAVELLED IN. This pinned the exact
// literal `{ mapSvg, variant }`, so moving the generated map to the mapImage seam — a fix — failed a
// check that was still describing the shape it replaced. A gate that names one spelling of a call
// turns every refactor into a false alarm, and a false alarm is how a real one gets waved through.
ok(/printPacket\(zone,[^)]*\bvariant\b/.test(RM),
  'research-map openPacket does not forward the variant to printPacket — every packet would print full')

if (fails.length) {
  console.error('PACKET-VARIANTS: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('PACKET-VARIANTS: PASS — both packets print every group, lightweight drops exactly the four back-matter sheets (life calendar, % grid, bounded set, centered set) and lists everyone as a worksheet, an unknown variant falls back to full, the Prayer List prints the PACKET and not the columnar list, the Cards button and its size row are unchanged, and one ref means one open tape.')
