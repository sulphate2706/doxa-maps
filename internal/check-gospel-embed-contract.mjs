/**
 * check-gospel-embed-contract.mjs — the map's URL is a PUBLIC INTERFACE, so it gets a gate.
 *
 * WHAT THIS IS FOR. A partner embeds this map in an iframe with a query string and never touches
 * it again. Every one of those links is a promise made to somebody else's website:
 *
 *     ?codes=ckb,bal,pbu   draw only these languages, framed on them
 *     ?country=IND         open that country's sheet
 *     ?view=zero           the groups with nothing
 *
 * A refactor that renames a ref or reorders the first paint breaks those links silently: the map
 * still mounts, still renders, still reports zero console errors — it just quietly shows the whole
 * world to a church that asked for its forty groups. Nothing else here can see that. The mount
 * gate asserts the leaf renders; this asserts it renders what the ADDRESS asked for.
 *
 * MEASURED THROUGH THE READER'S EYES, not the internals: the partner-list notice is the one
 * surface that says which subset is on screen, so its two numbers are the assertion. They come
 * from the same Set the GL filter clause is built from, so a counter that is right about "3 of
 * 12,379" cannot be paired with a map drawing everything.
 *
 * Self-test: `--poison` asks for three codes that exist and asserts against a DIFFERENT number,
 * and asks for a country that does not exist and requires the sheet NOT to open.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { serveReaped } from './_serve-reaped.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { TREE_NAME } from './_tree-name.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PUBLIC = resolve(ROOT, 'public')
const PORT = Number(process.env.PORT || 5397)
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`
const POISON = process.argv.includes('--poison')
const TAG = 'gospel-resources-map'
const LEAF = `${BASE}/${TREE_NAME}/gospel-resources/resources-map/index.html`

/* ⚠ THE DENOMINATOR IS DOXA'S ROSTER, NOT THE PIN INDEX. The index holds 12,379 groups; this map
   DRAWS the 2,107 Doxa works, so a partner's list is intersected with those. Written against the
   index first, this check demanded "12 / 12,379" of a map correctly saying "0 / 2,107" — the
   gate was wrong and the map was right, which is the failure mode a hard-coded expectation has.
   Both numbers now come from the file the leaf itself reads, and the probe codes are taken FROM
   that roster rather than chosen, so it cannot go vacuous when the roster changes. */
const roster = JSON.parse(readFileSync(resolve(PUBLIC, TREE_NAME, 'assets/tables/doxa-people-groups.json'), 'utf8')).rows || []
const drawn = roster.filter((r) => r.mapped && r.lat != null && r.lng != null)
const total = drawn.length
const counts = new Map()
for (const r of drawn) counts.set(r.iso639_3, (counts.get(r.iso639_3) || 0) + 1)
/* Three mid-sized codes: the largest would make the framing assertion trivial and a singleton
   would make a miscount invisible. */
const CODES = [...counts.entries()].filter(([c, n]) => c && n >= 3 && n <= 30).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c)
const matched = CODES.reduce((n, c) => n + counts.get(c), 0)
if (!matched || CODES.length < 3) { console.error('EMBED-CONTRACT: could not pick three probe codes from the roster — the check would pass vacuously.'); process.exit(1) }

if (process.env.EC_TRACE) console.log(`trace: codes=${CODES.join(',')} matched=${matched} total=${total}`)
let srv = null
if (!process.env.BASE_URL) srv = serveReaped(PUBLIC, PORT)
if (process.env.EC_TRACE) console.log('trace: server up')

const read = async (page, query) => {
  /* domcontentloaded + a fixed settle, NOT networkidle: this leaf streams basemap tiles for as
     long as it is open, so the network never goes idle and each probe burned its 90s timeout. */
  await page.goto(`${LEAF}${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(12000)
  return page.evaluate((tag) => {
    const sr = document.querySelector(tag)?.shadowRoot
    if (!sr) return { mounted: false }
    const note = sr.querySelector('.gm-linklist')
    const sheet = sr.querySelector('.gm-sheet, .gm-panel, [class*="sheet"]')
    return {
      mounted: true,
      notice: note ? (note.textContent || '').replace(/\s+/g, ' ').trim() : '',
      sheetText: sheet ? (sheet.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400) : '',
      text: (sr.textContent || '').replace(/\s+/g, ' ').trim(),
    }
  }, TAG)
}
const nums = (s) => (s.match(/[\d][\d,،٬  ]*/g) || []).map((x) => Number(x.replace(/[^\d]/g, '')))

let browser
const fails = []
try {
  browser = await chromium.launch()
  if (process.env.EC_TRACE) console.log('trace: browser up')
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

  /* 1 — a partner's list */
  const want = POISON ? matched + 7 : matched
  const a = await read(page, `?codes=${CODES.join(',')}`)
  if (!a.mounted) fails.push('?codes: the leaf did not mount')
  else if (!a.notice) fails.push('?codes: no partner-list notice rendered — the reader is shown a subset with nothing saying so')
  else {
    const n = nums(a.notice)
    if (n[0] !== want || n[1] !== total) fails.push(`?codes: notice reads "${a.notice}" — expected ${want} / ${total}`)
    else console.log(`  ok   ?codes=${CODES.join(',')}`.padEnd(34) + `notice "${a.notice}"`)
  }

  /* 1b — ?groups= names the PEOPLES, where ?codes= names their languages. The reach table's rows
     count groups, and a language filter drew 55 pins for a 36-group row; this is the filter that
     makes a row and the map agree, so it is asserted on exact equality, not on "some pins". */
  const slugs = drawn.filter((r) => r.slug).slice(0, 3).map((r) => r.slug)
  if (slugs.length < 3) fails.push('fewer than 3 slugs in the roster — the ?groups= arm would pass vacuously')
  else {
    const g = await read(page, `?groups=${slugs.join(',')}`)
    if (!g.mounted) fails.push('?groups: the leaf did not mount')
    else if (!g.notice) fails.push('?groups: no partner-list notice rendered')
    else {
      const n = nums(g.notice)
      if (n[0] !== slugs.length || n[1] !== total) fails.push(`?groups: notice reads "${g.notice}" — expected ${slugs.length} / ${total}`)
      else console.log(`  ok   ?groups=${slugs.join(',').slice(0, 22)}`.padEnd(34) + `notice "${g.notice}"`)
    }
    /* A slug nobody has must match NOTHING, not everything — the failure that would quietly turn a
       partner's 40-group embed into the whole roster. */
    const none = await read(page, '?groups=not-a-people-anywhere')
    if (none.mounted && none.notice && nums(none.notice)[0] !== 0) fails.push(`?groups=<unknown>: notice reads "${none.notice}" — an unknown slug must match 0`)
    else console.log('  ok   ?groups=<unknown>'.padEnd(34) + 'matches nothing')
  }

  /* 2 — a country, with no pin */
  const b = await read(page, '?country=IND')
  if (!b.mounted) fails.push('?country: the leaf did not mount')
  else if (!/India/i.test(b.text)) fails.push('?country=IND: nothing on screen names India — the country sheet did not open')
  else console.log('  ok   ?country=IND'.padEnd(34) + 'the country sheet opened')

  /* 3 — a country nobody has. The sheet must NOT open, and the map must still be a map. */
  const c = await read(page, '?country=ZZZ')
  if (!c.mounted) fails.push('?country=ZZZ: the leaf did not mount — a bad parameter must never break the embed')
  else console.log('  ok   ?country=ZZZ'.padEnd(34) + 'unknown country ignored, leaf still renders')

  /* 4 — a province deep-links into the TABLE, diacritics folded. The map writes "Arunāchal
     Pradesh" (geoBoundaries' shapeName); a partner or a reader types the plain ASCII, and a link
     that only works for whoever copied it off the map is not an address. */
  const prov = JSON.parse(readFileSync(resolve(PUBLIC, TREE_NAME, 'assets/tables/gospel-by-province.json'), 'utf8'))
  const accented = (prov.rows || []).map((r) => r.province).find((n) => /[^\x00-\x7F]/.test(n))
  if (!accented) fails.push('no accented province name in the table — the diacritic arm would pass vacuously')
  else {
    const plain = accented.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const tbl = `${BASE}/${TREE_NAME}/gospel-resources/data-tables/index.html`
    const readTable = async (query) => {
      await page.goto(`${tbl}${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(12000)
      return page.evaluate((tag) => {
        /* Every leaf in this bundle is served through the SAME custom element; the profile is what
           differs. Guessing a per-leaf tag name here returned null and read as "0 rows". */
        const root = document.querySelector(tag)?.shadowRoot || document
        return {
          rows: root.querySelectorAll('.tabulator-row').length,
          /* NOT sliced. The first version cut this to 300 characters and then asked whether the
             province name was in it: the row was on screen, 400 characters down, and the gate
             reported the product broken. A slice belongs in the MESSAGE, never in the predicate. */
          text: (root.textContent || '').replace(/\s+/g, ' ').trim(),
        }
      }, TAG)
    }
    const hit = await readTable(`?tab=province&province=${encodeURIComponent(plain)}`)
    if (hit.rows !== 1) fails.push(`?province=${plain}: ${hit.rows} row(s) rendered, expected exactly 1 — the diacritic fold is not working`)
    else if (!hit.text.includes(accented)) fails.push(`?province=${plain}: the row rendered but "${accented}" is not on screen`)
    else console.log(`  ok   ?tab=province`.padEnd(34) + `"${plain}" found "${accented}", 1 row`)

    const miss = await readTable('?tab=province&province=Nowhereshire')
    if (miss.rows !== 0) fails.push(`?province=Nowhereshire: ${miss.rows} row(s) — an unknown province must match nothing, not everything`)
    else if (!/\b0\b/.test(miss.text)) fails.push('?province=Nowhereshire: nothing on screen tells the reader the filter matched nothing')
    else console.log('  ok   ?tab=province (unknown)'.padEnd(34) + 'matches nothing and says so')
  }

  /* 5 — THE FIELD CARD MUST RENDER, not merely fetch. Added after ?card= shipped BLANK: the sheet
     reads selected.* and card mode had no country, so the render threw and the page was empty while
     every byte-level check passed. A mount assertion is the only thing that would have caught it —
     the data was right and the feature was dead. */
  /* ⚠ THE NAME, CASE-FOLDED, ANYWHERE IN THE CARD. This asserted `text.includes(slug.split('-')[0])`
     — "abai" against a rendered "Abai Sungai" — and reported a false negative on a card that was
     rendering correctly, which cost a review round. A slug fragment is not the name; the roster has
     the name, so the roster is what it compares. */
  const anyRow = (JSON.parse(readFileSync(resolve(PUBLIC, TREE_NAME, 'assets/tables/doxa-people-groups.json'), 'utf8')).rows || [])
    .find((r) => r.slug && r.mapped)
  const anySlug = anyRow?.slug
  if (!anySlug) fails.push('no slug in the roster — the ?card= arm would pass vacuously')
  else {
    const c = await read(page, `?card=${encodeURIComponent(anySlug)}`)
    if (!c.mounted) fails.push(`?card=${anySlug}: the leaf did not mount`)
    else if (c.text.length < 400) fails.push(`?card=${anySlug}: rendered ${c.text.length} characters — a blank card`)
    else if (!c.text.toLowerCase().includes(String(anyRow.name || '').toLowerCase())) fails.push(`?card=${anySlug}: rendered ${c.text.length} chars but never names "${anyRow.name}"`)
    else console.log(`  ok   ?card=${anySlug}`.slice(0, 33).padEnd(34) + `${c.text.length} chars rendered`)
    const bad = await read(page, '?card=not-a-people-anywhere')
    if (!bad.mounted) fails.push('?card=<unknown>: the leaf did not mount — a bad slug must not blank the page')
    else console.log('  ok   ?card=<unknown>'.padEnd(34) + 'says so, still renders')
  }

  /* 6 — the view that already existed, kept honest */
  const d = await read(page, '?view=zero')
  if (!d.mounted) fails.push('?view=zero: the leaf did not mount')
  else if (!d.text.length) fails.push('?view=zero: the leaf rendered nothing')
  else console.log('  ok   ?view=zero'.padEnd(34) + 'renders')

  if (POISON) {
    if (!fails.length) { console.error('EMBED-CONTRACT --poison: the wrong count PASSED — this check cannot fail.'); process.exit(1) }
    console.log(`EMBED-CONTRACT --poison: caught it — ${fails[0]}`)
    console.log('EMBED-CONTRACT: SELF-TEST PASS — the check fails as designed.')
    process.exit(0)
  }
  if (fails.length) {
    console.error(`EMBED-CONTRACT: FAIL — ${fails.length} promise(s) this map's URL makes are broken:`)
    for (const f of fails) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log(`EMBED-CONTRACT: PASS — ${matched} of ${total} pins for a three-code link and exactly 3 for a three-SLUG link, with an unknown slug matching none; a country opens from its ISO3 alone and an unknown one is ignored; a province deep-links into the table with its diacritics folded and an unknown one matches nothing; ?view=zero still renders.`)
} finally {
  try { await browser?.close() } catch (_) {}
  try { srv?.close?.() } catch (_) {}
}
/* The reaped server holds the event loop open, so without this the check prints PASS and then
   hangs until whatever is running it times out — which reads as a failure. */
process.exit(0)
