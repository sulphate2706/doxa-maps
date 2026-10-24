#!/usr/bin/env node
/**
 * check-packet-a1-structure — the prayer packet is built to its specified structure.
 *
 * FULL DETAIL is four front pages, the profiles, four back pages:
 *     map · triangle · life calendar · % evangelical · profiles… · bounded set · centered set · wheel · points
 * LIGHTWEIGHT is two front pages, the profiles, two back pages:
 *     map · triangle · profiles… · wheel · points
 * and the pages that carry the design are the ones described: page 1 is the zone's map on a VERTICAL
 * page with a title saying which set it belongs to; page 2 is one inverted triangle narrowing from
 * every people group to THIS packet; the wheel is the Metacamp Module 1 wheel, in its colours and its
 * orientation.
 *
 * ★ ORDER IS READ FROM EACH SHEET'S CONTENT, NOT COUNTED. A sheet total can hold while two pages swap,
 * or while one page is lost and another duplicated. Every sheet is identified by what is on it.
 *
 * ★ TWO-SIDED WHERE A ONE-SIDED CHECK WOULD PASS A CONSTANT: the packets tier must appear WITH a packet
 * count and must NOT appear without one; the series line likewise; a "− N" step must appear where the
 * sets nest and must NOT appear where they do not.
 *
 * Exit 0 pass · 1 fail · 75 NOT MEASURED.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

let createPacketRenderer, zonesWithSelectors, DEAF_SELECTOR, strings, clusters, funnelRaw, christian
try {
  ;({ createPacketRenderer } = await import(join(REPO, 'library/packet/packet-render.js')))
  ;({ zonesWithSelectors, DEAF_SELECTOR } = await import(join(REPO, 'plugin-designs/my-upg-100-list/data/legend-tree.js')))
  strings = JSON.parse(readFileSync(join(REPO, 'library/scripts/posters/packet-strings.json'), 'utf8'))
  clusters = JSON.parse(readFileSync(join(REPO, 'plugin-designs/my-upg-100-list/data/clusters.json'), 'utf8'))
  funnelRaw = JSON.parse(readFileSync(join(REPO, 'data/people-groups/vision-funnel.json'), 'utf8'))
  christian = JSON.parse(readFileSync(join(REPO, 'data/people-groups/christian-share.json'), 'utf8'))
} catch (e) {
  console.error(`PACKET-A1: NOT MEASURED (exit 75) — an input did not load: ${e.message}`)
  process.exit(75)
}

const fails = []
const notes = []
const ok = (cond, msg, note) => { if (!cond) fails.push(msg); else if (note) notes.push(`  ok    ${note}`) }

const R = createPacketRenderer({ strings, lang: 'en' })
const { W, H } = R
const M = 60
const zone = { id: 'test', label: 'Test Zone' }
const groups = Array.from({ length: 45 }, (_, i) => ({ slug: `g${i}`, name: `Group ${i}`, country_code: 'MYS', population: 1000, imb_gsec: 1 }))
const sets = {
  bounded: Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, reached: i % 3 === 0 ? true : (i % 3 === 1 ? false : undefined) })),
  centered: Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, ring: (i % 12) - 1 })),
}
const withK = { ...funnelRaw, listCount: 28, listTotal: funnelRaw.steps[funnelRaw.steps.length - 1].groups }
const noK = { steps: funnelRaw.steps }
const MAP_ONLY_SHEET = '<html><style>.x{}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 1941" width="1500" height="1941" data-sheet="map-only"><rect width="1500" height="1941" fill="#f7f4ec"/></svg></html>'
const POSTER_SHEET = '<html><style>.x{}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 2000" width="1500" height="2000"><rect width="1500" height="2000"/></svg></html>'
const ICON_PAGE = '<html><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></body></html>'

// ── A. PAGE ORDER, READ FROM CONTENT ────────────────────────────────────────────────────────────
function sequence(html) {
  const starts = [...html.matchAll(/<div class="sheet([^"]*)">/g)]
  const out = []
  starts.forEach((m, i) => {
    const cls = m[1]
    const seg = html.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : html.length)
    const kind = /sheet-map\b/.test(cls) ? 'map'
      : /funnel-title/.test(seg) ? 'triangle'
      : /sheet-life/.test(cls) ? 'life'
      : /sheet-christian/.test(cls) ? 'christian'
      : /sheet-sets-bounded/.test(cls) ? 'bounded'
      : /sheet-sets-centered/.test(cls) ? 'centered'
      : /sheet-worksheet/.test(cls) ? 'worksheet'
      : /wheel-title/.test(seg) ? 'wheel'
      : /class="card"/.test(seg) ? 'profiles'
      : /word-title/.test(seg) ? 'word'   // point 4's passage in full + the Father's-heart list (2026-09-30)
      : /points-title|points_title|Prayer Points/.test(seg) ? 'points'
      : `?${cls.trim()}`
    if ((kind === 'profiles' || kind === 'worksheet' || kind === 'points') && out[out.length - 1] === kind) return   // one entry per run
    out.push(kind)
  })
  return out.join(' · ')
}
const liftedMap = R.liftMap(MAP_ONLY_SHEET)
const full = R.buildPacket(zone, groups, new Map(), liftedMap, withK, christian, 'full', sets)
const light = R.buildPacket(zone, groups, new Map(), liftedMap, withK, christian, 'lightweight', sets)
const FULL = 'map · triangle · life · christian · profiles · bounded · centered · wheel · points'
const LIGHT = 'map · triangle · worksheet · wheel · points'
ok(sequence(full) === FULL, `full-detail order is\n      ${sequence(full)}\n    expected\n      ${FULL}`, `full detail:  ${FULL}`)
ok(sequence(light) === LIGHT, `lightweight order is\n      ${sequence(light)}\n    expected\n      ${LIGHT}`, `lightweight:  ${LIGHT}`)

// ── B. PAGE 1 — the map, on a vertical page, saying which set it belongs to ─────────────────────
const box = (html) => {
  const m = html.match(/data-map-kind="([^"]+)" data-map-scale="([\d.]+)" style="position:absolute;left:([\d.]+)px;top:([\d.]+)px;width:([\d.]+)px;height:([\d.]+)px/)
  return m && { kind: m[1], s: +m[2], x: +m[3], y: +m[4], w: +m[5], h: +m[6] }
}
{
  const b = box(liftedMap)
  ok(b && b.kind === 'map-only', 'a map-only sheet was not placed as one', 'page 1 places a map-only sheet as the whole page')
  // its label columns start 34px inside the sheet; they must land on the packet's own margin
  if (b) ok(Math.abs(b.x + 34 * b.s - M) < 1 && b.y + 34 * b.s >= M - 1,
    `the map-only sheet's names start ${(b.x + 34 * b.s).toFixed(1)}px from the edge; every packet page keeps ${M}px`,
    `its names land on the same ${M}px margin as every other page (scale ${b.s})`)
  // ★ A POSTER FILLS THE PAGE inside the white margin M (2026-09-29: page 1 is the map alone).
  const p = box(R.liftMap(POSTER_SHEET))
  ok(p && p.kind === 'poster' && p.x >= M - 0.5 && p.y >= M - 0.5 && p.x + p.w <= W - M + 0.5 && p.y + p.h <= H - M + 0.5
    && (Math.abs(p.w - (W - 2 * M)) < 1 || Math.abs(p.h - (H - 2 * M)) < 1),
    `a 3x4 poster does not fill the page inside the margin: ${JSON.stringify(p)}`, `a 3x4 poster fills the page inside the ${M}px margin (scale ${p && p.s})`)
  // the lifted artwork is laid out left-to-right and must not inherit an rtl page's direction
  ok(/class="map-sheet" dir="ltr"/.test(liftedMap) && /class="map-sheet" dir="ltr"/.test(R.liftMap(POSTER_SHEET)),
    'the lifted map sheet does not pin dir="ltr", so an Arabic packet mirrors the English artwork', 'the lifted sheet pins dir="ltr" inside an rtl page')
  ok(R.liftMap(ICON_PAGE) === '', 'an icon-sized <svg> (an SPA fallback page) was lifted as if it were a map', 'an icon-sized <svg> is refused, not printed as the map')
  ok(R.liftMap('<html>no svg</html>') === '', 'a page with no <svg> did not lift to empty')
  // A MAP-ONLY sheet leaves its top band empty for the packet's title, so there the title is drawn — after the map.
  const firstSheet = (html) => { const a = html.indexOf('<div class="sheet sheet-map'); return html.slice(a, html.indexOf('<div class="sheet', a + 10)) }
  const p1 = firstSheet(full)
  ok(p1.indexOf('class="map-sheet"') >= 0 && p1.indexOf('class="map-sheet"') < p1.indexOf('map-series'),
    'page 1 draws its title BEFORE the map, so the map-only sheet\'s background paints over it', 'on a map-only sheet the map is drawn first, the title over it')
  // two-sided: the series line WITH a packet count, and NOT without one
  ok(/class="map-series"[\s\S]{0,200}One of 28 UPG100 prayer lists/.test(p1), 'page 1 (map-only) does not say it is one of the 28 UPG100 prayer lists')
  const noKp1 = R.mapPage(zone, groups, liftedMap, noK)
  ok(!/map-series/.test(noKp1), 'page 1 prints a series line with NO packet count to state', 'a map-only page 1 says "One of 28 UPG100 prayer lists" — and stays silent without a count')
  // ★ A POSTER PAGE 1 HAS ONE HEADER, THE POSTER'S — two-sided against the map-only page above, which has the packet's.
  const posterP1 = R.mapPage(zone, groups, R.liftMap(POSTER_SHEET), withK)
  ok(/sheet-map-poster/.test(posterP1) && !/map-series/.test(posterP1) && !posterP1.includes(strings.en.map_page_sub.split('{count}')[0]),
    'a poster page 1 still draws the packet\'s own title over the poster — two headers', 'a poster page 1 is the poster alone: no second title, no series line')
  ok(/class="map-missing"/.test(R.mapPage(zone, groups, R.liftMap(ICON_PAGE), withK)), 'a refused sheet does not fall through to the missing-map notice')
}

// ── C. PAGE 2 — the triangle ──────────────────────────────────────────────────────────────────
{
  const tri = (html) => {
    const i = html.indexOf('funnel-title')
    const a = html.lastIndexOf('<div class="sheet', i)
    const b = html.indexOf('<div class="sheet', i)
    return html.slice(a, b < 0 ? html.length : b)
  }
  const page = tri(full)
  const tiers = (page.match(/class="funnel-tier/g) || []).length
  const nums = (page.match(/class="funnel-n/g) || []).length
  ok(tiers === funnelRaw.steps.length + 2 && nums === tiers,
    `with a packet count the triangle should have ${funnelRaw.steps.length + 2} tiers each with its number; got ${tiers} tiers, ${nums} numbers`,
    `${tiers} tiers, every one with its number: ${funnelRaw.steps.length} global steps, the packets, this packet`)
  ok(/UPG100 prayer packets divide/.test(page), 'the packets tier is missing although a packet count was supplied')
  const pageNoK = tri(R.buildPacket(zone, groups, new Map(), liftedMap, noK, christian, 'full', sets))
  const tiersNoK = (pageNoK.match(/class="funnel-tier/g) || []).length
  ok(tiersNoK === funnelRaw.steps.length + 1 && !/UPG100 prayer packets divide/.test(pageNoK),
    `without a packet count the packets tier must be absent (${tiersNoK} tiers)`, 'no packet count, no packets tier')
  ok(/class="[^"]*funnel-mine/.test(page), 'the reader\'s own count (.funnel-mine) is missing from the triangle')
  // two-sided: a step is subtracted where the sets nest, and only there
  const steps = funnelRaw.steps
  const byId = Object.fromEntries(steps.map((s) => [s.id, s.groups]))
  const eq = [...page.matchAll(/class="funnel-eq"[^>]*>− ([\d,]+)</g)].map((m) => Number(m[1].replace(/,/g, '')))
  const want = [byId.all - byId.unreached, byId.unreached - byId.frontier]
  ok(JSON.stringify(eq) === JSON.stringify(want),
    `the "− N" steps are ${JSON.stringify(eq)}; only the nesting steps may carry one: ${JSON.stringify(want)}`,
    `"− N" appears only where the sets nest: ${want.map((n) => n.toLocaleString('en')).join(', ')}`)
  const doxa = steps.find((s) => s.id === 'doxa')
  if (doxa && doxa.frontier) {
    ok(page.includes(`${doxa.frontier.toLocaleString('en')} of them are frontier`),
      'the network\'s list is not told apart from a subset of frontier (its "N of them are frontier" note is missing)',
      'the network\'s list states how many of its groups are frontier instead of a false "− N"')
  }
}

// ── D. THE WHEEL — the Metacamp Module 1 wheel ─────────────────────────────────────────────────
{
  const i = full.indexOf('wheel-title')
  const page = full.slice(full.lastIndexOf('<div class="sheet', i), full.indexOf('<div class="sheet', i) < 0 ? full.length : full.indexOf('<div class="sheet', i))
  const PDF = ['#fe936a', '#febb64', '#fed164', '#fffa83', '#e6f37d', '#a3d979', '#47ccfc', '#6293fe', '#722cfd', '#c632fd', '#e6578d', '#ff766f']
  const fills = [...page.matchAll(/<path d="M [\d.]+ [\d.]+ L [\d.-]+ [\d.-]+ A[^"]*" fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
  ok(JSON.stringify(fills) === JSON.stringify(PDF), `the wheel's colours are ${JSON.stringify(fills)}, not the source PDF's`, 'the wheel carries the source PDF\'s twelve colours, in order')
  const first = page.match(/<path d="M ([\d.]+) ([\d.]+) L ([\d.-]+) ([\d.-]+) A/)
  // ★ PRAISE AT THE TOP (2026-09-30): turned 90° clockwise from the source's nine o'clock, so the opening and
  // closing PRAISE meet at twelve, and a "Start here" marker points at the opening, top-right one.
  ok(first && Math.abs(+first[3] - +first[1]) < 1 && +first[4] < +first[2],
    'the opening PRAISE does not start at twelve o\'clock', 'the hour opens at twelve o\'clock, praise meeting praise at the top')
  ok(page.includes('class="wheel-start"'), 'the wheel has no "Start here" marker', 'a "Start here" marker on the opening praise')
  ok((page.match(/>5<\/text>/g) || []).length === 12, 'the wheel does not carry twelve "5 minutes" badges')
  ok(/metacamp\.org/.test(page), 'the wheel lost its attribution (source and website)', 'twelve "5 minutes" badges and the source attribution')
}

// ── D2. POINT 4 PRINTS MARK 5:18-20 ONLY, IN EVERY LOCALE ─────────────────────────────────────
// The same 250..700 bound as check-packet-render, here because this gate runs in gates:pre with no
// browser and no generated packets: check-packet-render only runs over packets someone generated
// (check:packets-all SKIPs on a clean checkout) and the browser gate is not measured headless. The
// floor catches a truncated or missing passage; the ceiling catches the full 1-20 passage coming back
// (2,141 chars in English), which would also push the twelve points off their one page.
{
  const P4_MIN = 250, P4_MAX = 700
  const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim()
  const bad = []
  const langs = Object.keys(strings).filter((k) => k !== '_meta')
  for (const lang of langs) {
    const page = createPacketRenderer({ strings, lang }).pointsPage()
    const at = page.indexOf('class="p4-passage"')
    const end = at < 0 ? -1 : page.indexOf('</div></div>', at)
    const len = end < 0 ? 0 : text(page.slice(page.indexOf('>', at) + 1, end)).length
    if (len < P4_MIN || len > P4_MAX) bad.push(`${lang} ${len}`)
  }
  ok(!bad.length, `point 4's passage is outside ${P4_MIN}..${P4_MAX} chars (Mark 5:18-20 only): ${bad.join(', ')}`,
    `point 4 prints Mark 5:18-20 only (${P4_MIN}..${P4_MAX} chars) in all ${langs.length} locales`)
}

// ── E. EVERY ZONE A READER CAN PICK ────────────────────────────────────────────────────────────
{
  const zones = zonesWithSelectors(clusters, { deafCount: 123 })
  const deaf = zones.find((z) => z.id === 'deaf')
  ok(zones.length === 28, `${zones.length} printable zones; the legend offers 28`)
  ok(deaf && deaf.selector === DEAF_SELECTOR, 'the Deaf zone has no selector, so its packet cannot be resolved')
  const own = {}
  for (const k of ['lists', 'asia_lists', 'uncovered_lists']) for (const z of clusters[k] || []) own[z.id] = z.selector
  const wrong = zones.filter((z) => z.id !== 'deaf' && z.selector !== own[z.id]).map((z) => z.id)
  ok(!wrong.length, `zones whose selector is not the catalogue's own: ${wrong.join(', ')}`,
    `all 28 zones resolvable, Deaf by its affinity-bloc selector and the other 27 by their own`)
}

for (const n of notes) console.log(n)
if (fails.length) {
  console.error('PACKET-A1: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('PACKET-A1: PASS — full detail and lightweight are built to their specified structure, page by page, read from each page\'s content.')
