// check-deck-click — click the REAL Card Deck button and read what it prints.
//
// Every other packet/card gate drives the RENDERERS directly. This one drives the
// UI: it finds the button in the shadow root, clicks it, and captures the document
// that reaches the print frame. That is the only path that proves the wiring —
// records provider, stock picker, language, shared composable, print frame — is
// connected end to end. A renderer can be perfect while the button that calls it
// passes the wrong stock, or nothing at all.
//
// ⚠ IT INTERCEPTS THE PRINTED HTML rather than reading the iframe back.
// openPrintFrame calls window.print(), which BLOCKS in headless Chromium, and the
// frame self-removes on afterprint — reading it back measures a frame that has
// already gone and reports 0 cards for a correct deck.
//
// Usage: node internal/check-deck-click.mjs <wallUrl> [stockId] [expectedPage]
import { chromium } from './lib/playwright-guarded.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireThisTree } from './_serves-this-tree.mjs'

const URL_ = process.argv[2]
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(URL_, ROOT, 'DECK-CLICK')
if (!URL_) { console.error('usage: check-deck-click.mjs <wallUrl> [stock] [expectedPage]'); process.exit(2) }
const STOCK = process.argv[3] || ''
const EXPECT_PAGE = process.argv[4] || (STOCK === 'pokerLandscape' ? '3.5in 2.5in' : '2.5in 3.5in')

// ★ THE LABEL COMES FROM THE CATALOG FOR THIS PAGE'S LOCALE, never a hardcoded
// English string. This matched /card deck/i, so it could only ever run in English:
// pointed at ?lang=es it reported "no Card Deck button" and listed 28 buttons all
// reading "Baraja de tarjetas" — the UI correctly translated, the GATE unable to
// see it. The card deck is a core prayer artefact and it had ZERO coverage in the
// ten locales where a rendering bug is most likely.
const REPO = process.env.DOXA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localeOf = (u) => { try { return new URL(u).searchParams.get('lang') || 'en' } catch { return 'en' } }
const deckLabel = (loc) => {
  const f = join(REPO, 'library/i18n/locales', loc, 'buttons.json')
  if (!existsSync(f)) return null
  try { return JSON.parse(readFileSync(f, 'utf8')).cardDeck || null } catch { return null }
}
const LOC = localeOf(URL_)
const WANT_DECK = deckLabel(LOC) || deckLabel('en') || 'Card Deck'

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const pg = await b.newPage({ viewport: { width: 1280, height: 1000 } })
const errs = []
pg.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
await pg.goto(URL_, { waitUntil: 'load', timeout: 45000 })
await pg.waitForTimeout(9000)

await pg.evaluate((want) => { window.__WANT_DECK = want }, WANT_DECK)

await pg.evaluate(() => {
  window.__printed = ''
  const real = document.createElement.bind(document)
  document.createElement = (t) => {
    const el = real(t)
    if (t === 'iframe') {
      Object.defineProperty(el, 'contentDocument', {
        get: () => ({ open() {}, close() {}, write(h) { window.__printed += h } }),
      })
      Object.defineProperty(el, 'contentWindow', {
        get: () => ({ addEventListener() {}, focus() {}, print() {} }),
      })
    }
    return el
  }
})

const r = await pg.evaluate(async (stock) => {
  const host = [...document.querySelectorAll('*')]
    .find((e) => e.shadowRoot && e.shadowRoot.querySelector('.pbtn'))
  if (!host) return { error: 'no poster wall found on this page' }
  const sr = host.shadowRoot
  const btns = [...sr.querySelectorAll('.pbtn')]
  const deck = btns.find((x) => (x.textContent || '').trim().includes(window.__WANT_DECK))
  if (!deck) return { error: 'no Card Deck button', buttons: btns.map((x) => x.textContent.trim()) }
  if (stock) {
    const sel = sr.querySelector('.pstock')
    if (!sel) return { error: 'no card-stock picker to drive' }
    sel.value = stock
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((res) => setTimeout(res, 400))
  }
  deck.click()
  await new Promise((res) => setTimeout(res, 9000))
  const doc = new DOMParser().parseFromString(window.__printed, 'text/html')
  return {
    cards: doc.querySelectorAll('.card').length,
    qrs: doc.querySelectorAll('.qr svg').length,
    imgs: doc.querySelectorAll('img.ph').length,
    noph: doc.querySelectorAll('.ph-none').length,
    page: (window.__printed.match(/@page\{size:([^;}]*)/) || [])[1] || '',
  }
}, STOCK)
await b.close()

if (r.error) {
  console.error(`DECK-CLICK: FAIL — ${r.error}`
    + (r.buttons ? ` (buttons present: ${r.buttons.join(' | ')})` : ''))
  process.exit(1)
}

const fails = []
if (!r.cards) fails.push('the click printed no cards at all — the button is not wired to the renderer')
if (r.page.trim() !== EXPECT_PAGE) {
  fails.push(`@page size is "${r.page.trim()}", expected "${EXPECT_PAGE}"`
    + (STOCK ? ' — the stock picker is not reaching the renderer' : ''))
}
if (r.qrs !== r.cards) fails.push(`${r.qrs} QR code(s) for ${r.cards} cards`)

// ── "116 PORTRAITS" WAS PRINTED AND NEVER ASSERTED ──────────────────────────
// A prayer card without a face is a data tile. This gate collected the count,
// displayed it, and checked only the QR codes — so a deck of 116 cards with ZERO
// portraits passed. That is not hypothetical: card-render.js records that the deck
// once shipped with no photos at all, because image_url was never requested in
// fetchListRecords (measured 95/95 groups DO have a portrait, so the omission cost
// every card its picture).
//
// ⚠ THE COUNT CANNOT BE PINNED, for the same reason the packet's could not: roughly
// half the people groups have no portrait, and the CDN drops some. So two invariants
// instead of a number:
//   1. every card is one shape or the other — portraits + typographic === cards.
//      A card that is NEITHER means the renderer emitted a third nobody checks.
//   2. a deck drawn from records that carry image_url must have SOME portraits.
//      DECK_EXPECT_PORTRAITS=0 declares a deliberately photo-less deck out loud,
//      rather than leaving "none" indistinguishable from "silently none".
if (r.cards && r.imgs + r.noph !== r.cards) {
  fails.push(`${r.cards} cards but ${r.imgs} portrait + ${r.noph} typographic = ${r.imgs + r.noph}`
    + ' — every card must be exactly one of the two')
}
if (r.cards && process.env.DECK_EXPECT_PORTRAITS !== '0' && r.imgs === 0) {
  fails.push(`${r.cards} cards and NOT ONE portrait — a prayer card without a face is a data tile. `
    + 'This is what a missing image_url in the records provider looks like; set '
    + 'DECK_EXPECT_PORTRAITS=0 to declare a deliberately photo-less deck.')
}
if (errs.length) fails.push(`${errs.length} page error(s): ${errs[0]}`)

console.log(`  locale        : ${LOC}  (matched ${JSON.stringify(WANT_DECK)})`)
console.log(`  stock         : ${STOCK || '(default)'}`)
console.log(`  cards printed : ${r.cards}  (${r.imgs} portraits, ${r.noph} typographic, ${r.qrs} QR codes)`)
console.log(`  @page size    : ${r.page.trim()}   (want ${EXPECT_PAGE})`)
console.log(`  page errors   : ${errs.length}`)

if (fails.length) {
  console.error(`\nDECK-CLICK: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`\nDECK-CLICK: PASS — the real button printed ${r.cards} cards at ${r.page.trim()}.`)
