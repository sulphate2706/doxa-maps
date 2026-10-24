// check-card-deck — a DECK must print as CARDS, not as paper.
//
// THE BUG THIS EXISTS FOR: the previous deck used @page{size:letter portrait} with
// height:100% per card, so one card stretched across a whole 8.5x11 sheet — 95
// mostly-empty letter pages, and no photo at all. "The print dialog needs to show
// all the cards not in a paper format but a CARD format."
//
// ⚠ IT ASSERTS THE MEASURED MediaBox, NOT THE CSS. Chromium SILENTLY falls back to
// letter for a named size it does not know: `size: A6 portrait` yields 612x792pt
// with no error, while `size: 2.5in 3.5in` yields exactly 180x252pt. A gate that
// grepped the stylesheet would pass on a deck that prints as letter paper.
//
// Usage: node internal/check-card-deck.mjs [lang] [stock]
//   PACKET_ORIGIN (default http://127.0.0.1:4898) · PACKET_API · PACKET_ISO3
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
await requireThisTree(ORIGIN, ROOT, 'CARD-DECK')
const API = process.env.PACKET_API || 'https://pray.doxa.life'
const ISO3 = process.env.PACKET_ISO3 || 'LAO'
const LANG = process.argv[2] || 'en'
const STOCK = process.argv[3] || 'poker'
// Expected MediaBox in points, derived from the stock's inches (72pt = 1in).
// a6 is 4.13x5.83in, the inch rounding of 105x148mm -> ~297.4x419.8pt. An earlier
// constant here said 396.5x559.7 and FAILED a correct render: the gate's own
// arithmetic was wrong, not the renderer. Derive, do not hand-copy.
const IN = { poker: [2.5, 3.5], postcard: [4, 6], a6: [4.13, 5.83] }[STOCK]
if (!IN) { console.error(`unknown stock "${STOCK}"`); process.exit(2) }
const EXPECT = IN.map(v => +(v * 72).toFixed(2))

const b = await chromium.launch()
const pg = await b.newPage({ viewport: { width: 900, height: 1200 } })
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 140)))
await pg.goto(ORIGIN + '/')

const out = await pg.evaluate(async ({ ORIGIN, API, ISO3, LANG, STOCK }) => {
  const [{ createCardRenderer }, strings, norm] = await Promise.all([
    import(`${ORIGIN}/library/packet/card-render.js`),
    fetch(`${ORIGIN}/library/scripts/posters/packet-strings.json`).then(r => r.json()),
    import(`${ORIGIN}/plugin-designs/my-upg-100-list/data/normalize.js`),
  ])
  const resp = await fetch(`${API}/api/people-groups/list?fields=slug,name,country_code,population,religion,image_url,primary_language&lang=en`, { cache: 'no-store' })
  const recs = norm.normalizeRecords(norm.extractRecords(await resp.json()))
  const groups = recs.filter(r => String(r.country_code) === ISO3)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), LANG))
  const R = createCardRenderer({ strings, lang: LANG, stock: STOCK })
  return { html: R.buildDeck({ id: ISO3.toLowerCase(), label: ISO3 }, groups), n: groups.length }
}, { ORIGIN, API, ISO3, LANG, STOCK })

await pg.setContent(out.html, { waitUntil: 'load' })
await pg.waitForTimeout(4000)
const r = await pg.evaluate(() => {
  const cards = [...document.querySelectorAll('.card')]
  const imgs = [...document.querySelectorAll('img.ph')]
  const qrs = [...document.querySelectorAll('.qr svg')]
  // Does the QR carry a real symbol, or an empty path?
  const qrPaths = qrs.map(s => (s.querySelector('path')?.getAttribute('d') || '').length)
  return {
    cards: cards.length,
    imgs: imgs.length,
    broken: imgs.filter(i => !i.complete || i.naturalWidth === 0).length,
    nophoto: document.querySelectorAll('.ph-none').length,
    qrs: qrs.length,
    qrEmpty: qrPaths.filter(n => n < 50).length,
    urls: [...document.querySelectorAll('.url')].slice(0, 2).map(e => e.textContent),
    // ⚠ ASSERT THE VALUES ARE HUMAN-READABLE, not merely present. The first deck
    // rendered "LAO" / "thm" / "EAN" because normalizeRecords() flattens each
    // { value, label } dict to its VALUE and parks the label under <field>_label.
    // A gate counting rows passed it: the rows were there, just unreadable.
    // An all-caps or all-lowercase token of 2-4 chars with no space is a code.
    codeish: [...document.querySelectorAll('.v')]
      .map(e => (e.textContent || '').trim())
      .filter(v => /^[A-Z]{2,4}$|^[a-z]{2,4}$/.test(v)),
    cta: (document.querySelector('.cta') || {}).textContent || '',
    overflow: cards.filter(c => c.scrollHeight > c.clientHeight + 2).length,
  }
})
const pdf = await pg.pdf({ preferCSSPageSize: true, printBackground: true })
await b.close()

const raw = pdf.toString('latin1')
const boxes = [...raw.matchAll(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(m => [+m[1], +m[2]])
const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length
const [pw, ph] = boxes[0] || [0, 0]

const fails = []
if (!r.cards) fails.push('no cards rendered')
if (pages !== r.cards) fails.push(`${pages} PDF pages for ${r.cards} cards — one card must be exactly one page`)
if (Math.abs(pw - EXPECT[0]) > 2 || Math.abs(ph - EXPECT[1]) > 2) {
  fails.push(`page is ${pw}x${ph}pt, expected ${EXPECT[0]}x${EXPECT[1]}pt for "${STOCK}"`
    + (Math.abs(pw - 612) < 2 ? ' — this is LETTER: the @page size silently fell back' : ''))
}
if (r.broken) fails.push(`${r.broken} broken portrait(s)`)
if (!r.imgs && !r.nophoto) fails.push('no portraits at all — a prayer card needs a face')
if (r.qrs !== r.cards) fails.push(`${r.qrs} QR codes for ${r.cards} cards`)
if (r.qrEmpty) fails.push(`${r.qrEmpty} QR code(s) render an empty symbol`)
if (r.overflow) fails.push(`${r.overflow} card(s) overflow their own box`)
if (r.codeish.length) {
  fails.push(`${r.codeish.length} field(s) show a raw CODE instead of a label `
    + `(e.g. ${[...new Set(r.codeish)].slice(0, 4).join(', ')}) — read <field>_label`)
}
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

console.log(`  stock / lang     : ${STOCK} / ${LANG}`)
console.log(`  cards / PDF pages: ${r.cards} / ${pages}`)
console.log(`  page size        : ${pw} x ${ph} pt  (${(pw / 72).toFixed(2)} x ${(ph / 72).toFixed(2)} in)`)
console.log(`  portraits        : ${r.imgs} (${r.broken} broken, ${r.nophoto} placeholder)`)
console.log(`  QR codes         : ${r.qrs} (${r.qrEmpty} empty)`)
console.log(`  sample URL       : ${r.urls[0] || '—'}`)
console.log(`  call to action   : ${r.cta}`)
console.log(`  raw codes shown  : ${r.codeish.length}${r.codeish.length ? ' (' + [...new Set(r.codeish)].slice(0,4).join(', ') + ')' : ''}`)
console.log(`  overflowing cards: ${r.overflow}`)
if (fails.length) {
  console.error(`\nCARD-DECK: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`\nCARD-DECK: PASS — ${r.cards} cards, one card per ${(pw / 72).toFixed(2)}x${(ph / 72).toFixed(2)}in page.`)
