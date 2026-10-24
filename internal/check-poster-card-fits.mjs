#!/usr/bin/env node
/**
 * check-poster-card-fits — a poster card's print-options row must stay inside its own card.
 *
 * THE DEFECT THIS CATCHES, reported by the repo-hygiene agent off a fresh 1440px screenshot and
 * confirmed here: every poster card's print-options row (Prayer List · Card Deck · stock select ·
 * Poster Map) burst its card and overlapped the neighbours. MEASURED 2026-09-24 at 1440px:
 * 27 of 27 cards overflowing, worst 110px past a 212px card.
 *
 * ★ WHY SOURCE READING MISSED IT. `.pfs` already had `width:82%`, so the rule looks correct — a
 * constrained box. But flex items default to `min-width:auto` and REFUSE to shrink below their
 * intrinsic content width, so four controls pushed the row open regardless of the container's
 * width. The fix is flex-wrap plus min-width:0 on the children; the point for this gate is that
 * only GEOMETRY shows it.
 *
 * ⚠ IT ASSERTS TWO THINGS, because either alone is satisfiable by a broken UI:
 *   1. No print row intrudes into another card's box — the reported symptom.
 *   2. Every control still has a usable box. "Nothing overflows" is trivially true if the row
 *      collapsed the buttons to zero width, which would be a worse product than the overflow.
 *
 * Usage: node internal/check-poster-card-fits.mjs [leafUrl] — SKIPs when nothing is served.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { servesThisTree } from './_serves-this-tree.mjs'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_LEAF = (process.env.BASE_URL || 'http://127.0.0.1:4173')
  + `/${TREE_NAME}/my-upg-100-list/upg-100-mfe/index.html`
const LEAF = process.argv[2] || DEFAULT_LEAF
// ⚠ SWEEP WIDTHS. The report named 1440px, so this first guarded 1440px — but the defect is a
// FLEX-SHRINK failure, and those are width-dependent: a narrower viewport gives the controls less
// room, which is where the next regression appears. Guarding one width encodes the reporter's
// sampling choice, not the property.
const WIDTHS = (process.env.CARD_FIT_WIDTH || '390,768,1024,1440,1920')
  .split(',').map((n) => Number(n.trim())).filter(Boolean)

// ★ AND SWEEP LOCALES, for exactly the same reason the widths are swept. The requirement was full
// words visible AND localization supported; this gate only ever ran in English, which is
// the shortest of the eleven. MEASURED 2026-09-24 at 1440px, the three print labels:
//   en  Prayer List 76px · Card Deck 72px · Poster Map 79px
//   ro  Listă de rugăciune 122px · Pachet de cartonașe 133px · Harta afișului 92px  (+75%)
//   zh  禱告名單 56px · 禱告卡組 56px · 海报地图 56px
// Romanian is the widest RENDERED, which is the property that matters — not the longest string.
// Chinese is only 4 characters yet each glyph is near double-width, so a character-count heuristic
// would have picked the wrong worst case. The gate asserts scrollWidth > clientWidth, which is
// pixels, so the sweep has to be pixels too.
// en is always included as the control; ro and zh are the measured extremes. Override with
// CARD_FIT_LANG to check a specific locale.
const LANGS = (process.env.CARD_FIT_LANG || 'en,ro,zh')
  .split(',').map((s) => s.trim()).filter(Boolean)

let reachable = false
try { const r = await fetch(LEAF, { signal: AbortSignal.timeout(4000) }); reachable = r.ok } catch { /* precondition */ }
if (!reachable) {
  console.log(`POSTER-CARD-FITS: SKIP — nothing served at ${LEAF}.`)
  console.log('  Serve the built tree: python3 -m http.server 4173 --directory public (or set BASE_URL)')
  process.exit(0)
}

// ★ "ANSWERS 200" AND "IS SERVING THIS BUILD" ARE DIFFERENT QUESTIONS, and only the first was
// asked above. This gate reports on geometry it cannot attribute: point it at a stale server and
// it measures the OLD build and says PASS, with nothing in the output naming which tree it saw.
//
// THAT IS NOT HYPOTHETICAL — I DID IT FOR SEVENTEEN TICKS. The published site was many merges
// behind while I ran this gate against it and recorded the results as live verification. They were
// measurements of a tree that was not mine. The defect that finally surfaced (country-posters
// previews 404ing) was only visible once the publish made live and local agree; before that, this
// gate would have passed on the stale copy either way.
//
// bundler-2 found this class first (BUG-BROWSER-GATES-CAN-MEASURE-ANOTHER-WORKTREES-TREE: :4173 on
// this box was held by a different worktree) and wrote _serves-this-tree.mjs. Its comment is the
// rule: "A gate that can report on the wrong tree is worse than no gate — it produces confident
// findings about code nobody changed, and hides real ones."
//
// ⚠ NOT MEASURED, NOT SKIP, and the distinction is the point. A SKIP reads as "nothing to check
// here"; this is "I could not attribute what I saw", which is a different and louder fact. Exit 2
// so a caller can tell it apart from both a pass (0) and a real failure (1).
// The helper wants the tree's BASE, not a leaf URL — it fetches <base>/<TREE_NAME>/manifest.json.
// LEAF is `<base>/<TREE_NAME>/<bundle>/<profile>/index.html`, so cut at that segment. The name is
// a config knob (_tree-name.mjs), and a hardcoded 'doxa-maps' here is how a rename silently makes
// a gate measure a folder that no longer exists — which cost me a whole tick of false readings.
const TREE_BASE = LEAF.split(`/${TREE_NAME}/`)[0]
const treeCheck = await servesThisTree(TREE_BASE, ROOT)
if (!treeCheck.ok) {
  console.error('POSTER-CARD-FITS: NOT MEASURED — the server is not serving this checkout.')
  console.error(`  ${treeCheck.why}`)
  console.error('  Every number below would describe someone else\'s build. Point BASE_URL at a')
  console.error('  server for THIS tree, or publish first if you meant to measure live.')
  process.exit(2)
}

const WALK = `(root, out) => { out = out || []; const rec = (r) => { for (const e of r.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) rec(e.shadowRoot) } }; rec(root); return out }`

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })

async function measure(width, lang) {
  const mobile = width < 500
  const page = await browser.newPage({ viewport: { width, height: 1000 }, isMobile: mobile, hasTouch: mobile })
  // ?lang= is how the app selects a locale (library/i18n/index.js:83). Appended rather than
  // replaced so a caller can still pass a leaf URL that already carries query params.
  const url = lang && lang !== 'en'
    ? LEAF + (LEAF.includes('?') ? '&' : '?') + 'lang=' + encodeURIComponent(lang)
    : LEAF
  await page.goto(url, { waitUntil: 'load', timeout: 45000 })
  await page.waitForTimeout(10000)

  // ★ HOVER IS INVISIBLE TO A STATIC PROBE, which is exactly how the blue outline stayed
  // unbuilt for so long. A blue outline around the hovered poster was reported missing more than once;
  // measuring the loaded page found `outline:none` on all 136 framed elements and concluded it had
  // never existed — true, and useless, because the affordance in question only exists WHILE
  // THE POINTER IS OVER THE CARD. The pointer has to actually move.
  //
  // ⚠ AND IT MUST NOT MOVE ANYTHING. The whole rest of this gate asserts where the print row sits.
  // A hover that grew a border would re-lay-out the card and push that row, so a cosmetic state
  // could break a gate about print controls. Outline paints outside the box; this asserts the box
  // WIDTH is identical hovered and not, which is the property that keeps the two independent.
  let hover = null
  try {
    const target = await page.evaluate(`(() => {
      const all = (${WALK})(document)
      const c = all.filter((e) => (e.className||'').toString().split(' ').includes('card'))
        .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 })[0]
      if (!c) return null
      c.scrollIntoView({ block: 'center' })
      const r = c.getBoundingClientRect()
      const cs = getComputedStyle(c)
      // ⚠ MEASURE clientWidth, NOT THE BORDER BOX. The card is a GRID ITEM, so its outer width is
      // fixed by the track (minmax(210px,1fr)) and CANNOT change no matter what the hover rule
      // does — a border grown on hover eats INWARD and leaves getBoundingClientRect().width
      // identical. Asserting on the outer width is therefore unfalsifiable here, which is a
      // decorative assertion, not a real one. MEASURED: growing border-width to 4px on hover left
      // the outer width at 212px and moved nothing this gate was watching. clientWidth is the
      // CONTENT box — it shrinks when the border grows, and it is what actually repositions the
      // print row, which is the property worth protecting.
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width),
               inner: c.clientWidth, outlineStyle: cs.outlineStyle }
    })()`)
    if (target) {
      await page.mouse.move(target.x, target.y)
      await page.waitForTimeout(500)
      const hovered = await page.evaluate(`(() => {
        const all = (${WALK})(document)
        const c = all.filter((e) => (e.className||'').toString().split(' ').includes('card'))
          .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 })[0]
        if (!c) return null
        const cs = getComputedStyle(c)
        return { outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor,
                 outlineWidth: cs.outlineWidth, w: Math.round(c.getBoundingClientRect().width),
                 inner: c.clientWidth }
      })()`)
      if (hovered) hover = { before: target, after: hovered }
    }
  } catch (_) { /* hover is an enhancement; never let it break the geometry run */ }

  // ★ CAN A READER ACTUALLY REACH THE LAST POSTER? Everything else here measures cards that are
  // ALREADY laid out — which is satisfied perfectly by a wall whose bottom half is unreachable.
  // The Kingdom-agent ruled UPG-100 the one mobile-app showcase, promising an "Instagram-style
  // scroll", and nothing asserted it.
  //
  // ⚠ DO NOT ASK document.documentElement.scrollHeight. MEASURED at 390x844 on upg-100-mfe: it
  // reports 844 — exactly one viewport — while the wall holds 13,032px of cards. The composite
  // scrolls an INNER element, so the document is not the thing that moves and a document-level
  // check would call a healthy wall empty. Find the element that actually overflows.
  //
  // It SCROLLS rather than computing: geometry saying "the last card is at 13001px" is not the
  // same claim as "scrolling brings it into view with working controls".
  let reach = null
  try {
    reach = await page.evaluate(`(async () => {
      const all = (${WALK})(document)
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 }
      const cards = all.filter((e) => (e.className||'').toString().split(' ').includes('card')).filter(vis)
      if (!cards.length) return null
      const last = cards[cards.length - 1]
      // The scroller is whichever ancestor-ish element genuinely overflows. Picking the LARGEST
      // overflow avoids matching a small inner scroller (the legend's own list, say).
      const scrollers = all.filter((e) => {
        const cs = getComputedStyle(e)
        return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 8
      }).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      const sc = scrollers[0]
      if (sc) { sc.scrollTop = sc.scrollHeight } else { window.scrollTo(0, document.body.scrollHeight) }
      await new Promise((r) => setTimeout(r, 1000))
      const lb = last.getBoundingClientRect()
      const ctrls = [...last.querySelectorAll('.pbtn,.pstock')]
      return {
        scrolled: sc ? Math.round(sc.scrollTop) : Math.round(window.scrollY),
        maxScroll: sc ? sc.scrollHeight - sc.clientHeight : 0,
        lastInView: lb.top < window.innerHeight && lb.bottom > 0,
        lastControls: ctrls.length,
        lastClipped: ctrls.filter((e) => e.scrollWidth > e.clientWidth + 1).length,
        lastUnusable: ctrls.filter((e) => {
          const r = e.getBoundingClientRect(); return r.width < 18 || r.height < 10
        }).length,
      }
    })()`)
  } catch (_) { /* reachability is additive; never let it break the geometry run */ }

  const out = await page.evaluate(`(() => {
    const all = (${WALK})(document)
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 }
    const cards = all.filter((e) => (e.className||'').toString().split(' ').includes('card')).filter(vis)
    const boxes = cards.map((c) => ({ c, b: c.getBoundingClientRect() }))
    let intrusions = 0, overflowing = 0, worst = 0, coveringPreview = 0, worstY = 0
    let previewsPainted = 0, previewsBroken = 0, noPreview = 0, unnamedPreview = 0
    let notTaped = 0, worstTape = 0, selectsInRow = 0
    let headNotTaped = 0, worstHead = 0, mapCovered = 0, worstCover = 0
    let uncontained = 0, worstBelow = 0
    for (const { c, b } of boxes) {
      const row = c.querySelector('.pfs')
      if (!row) continue
      const rb = row.getBoundingClientRect()
      if (rb.right > b.right + 1 || rb.left < b.left - 1) {
        overflowing++
        worst = Math.max(worst, Math.round(Math.max(rb.right - b.right, b.left - rb.left)))
      }
      // ★ AND THE CARD CONTAINS ITS ROW (2026-09-30, from a phone at two posters per row). The row
      // wrapped to three lines and hung about 45px below the card's white box, into the row gap:
      // horizontally inside, so the check above stayed green. PosterWall now fits each card to its
      // own row (--pfs-room); this is the assertion that keeps that true in every locale x width.
      if (rb.bottom > b.bottom + 0.5) {
        uncontained++
        worstBelow = Math.max(worstBelow, Math.round(rb.bottom - b.bottom))
      }
      // ⚠ THE VERTICAL AXIS TOO — this measured only left/right, which is exactly how it passed a
      // visible regression. Fixing the horizontal overflow with flex-wrap grew the row
      // 35px -> 78px, and because it sits at bottom:-14px the extra height pushed its TOP from
      // 216px up to 173px in a 238px card: over the preview image and the card's outline.
      // Horizontal clean, card visibly broken, gate green.
      // COUNT THE PREVIEW, do not merely guard on it. An if-guard protects this loop from a
      // placeholder card — and also means a card with NO preview passes the over-preview assertion
      // perfectly. BOTH a missing-previews symptom AND the overlap were reported;
      // measuring only the overlap leaves the first unasserted.
      // NOTE: no backticks in this block — it lives inside a JS template literal.
      const img = c.querySelector('img')
      // ONLY JUDGE WHAT IS IN VIEW. Every preview carries loading=lazy, so a card below the fold
      // legitimately has naturalWidth 0 — measured at 390px: 8 of 27 painted, the first unpainted
      // one 3926px down an 844px viewport, and ZERO failing HTTP responses. A first version of this
      // assertion called that 18 broken images. Deferred is not broken; only an in-viewport image
      // that never painted is.
      // ★ THE ALT IS THE CARD'S ONLY NAME. MEASURED 2026-09-25: a card's TEXT reads
      // "116 UPG·Show on map" — a count and an action, no zone. The identity lives in the image's
      // alt ("Northwest India — prayer poster…"), which all 27 carry. So the wall is correct as
      // built, and that alt is doing load-bearing work NOTHING asserted: remove it and a
      // screen-reader user meets 27 anonymous pictures while every check here stays green.
      if (img && !(img.getAttribute('alt') || '').trim()) unnamedPreview++
      if (!img) noPreview++
      else {
        const ib2 = img.getBoundingClientRect()
        const inView = ib2.top < window.innerHeight && ib2.bottom > 0
        if (img.complete && img.naturalWidth > 0) previewsPainted++
        else if (inView) previewsBroken++
      }
      if (img) {
        const ib = img.getBoundingClientRect()
        if (ib.height > 2 && rb.top < ib.bottom - 1) {
          coveringPreview++
          worstY = Math.max(worstY, Math.round(ib.bottom - rb.top))
        }
      }
      // ★ A STICKER STRADDLES THE EDGE IT TAPES (2026-09-25, the sticker/banner brief).
      // The card is a BANNER displaying a map; each sticker sits centred on a banner edge, part
      // on the banner's own white space and part overhanging. Three things were each true while
      // this gate was green, so all three are now asserted:
      //   1. the row floated 26px BELOW the banner, touching nothing (the shipped state);
      //   2. the row sat entirely below the edge, touching at one pixel;
      //   3. the row straddled correctly but landed ON THE MAP — "offensive to the map".
      // over-preview above catches only a row overlapping the <img> from above.
      const frame = c.querySelector('.main')
      if (frame) {
        const fb = frame.getBoundingClientRect()
        // STRADDLE: some of the sticker on the banner, some off it. Requiring a near-even split
        // would encode a ratio the brief explicitly left open (probably an equal or larger
        // overlap); requiring BOTH sides to be non-trivial is the property actually stated.
        const onBanner = Math.round(fb.bottom - rb.top)
        const offBanner = Math.round(rb.bottom - fb.bottom)
        if (onBanner < 4 || offBanner < 4) {
          notTaped++
          const d = onBanner < 4 ? onBanner : -offBanner
          worstTape = Math.abs(d) > Math.abs(worstTape) ? d : worstTape
        }
      }
      // ★ NO NATIVE DROPDOWN IN THE DEFAULT ROW (same ruling). The reason is not cosmetic: a
      // dropdown on the card makes it hard for others to have dropdowns too — a <select> here
      // collides with the host page's own
      // selects. The size picker is a disclosure, revealed by the Card Deck button. A <select>
      // reappearing in .pfs is the regression this catches.
      if (row.querySelector('select')) selectsInRow++
      // ★ AND THE HEADER STICKER STRADDLES ITS EDGE TOO. Same requirement, other end of the
      // banner, and it was ALSO wrong while everything here was green: MEASURED 35px above the
      // banner's top edge and -1px below, i.e. floating over the card touching the banner
      // nowhere. Asserting only the footer would have left that in place indefinitely.
      const headSticker = c.querySelector('.tape-h')
      if (frame && headSticker) {
        const hb = headSticker.getBoundingClientRect()
        const fb2 = frame.getBoundingClientRect()
        const onB = Math.round(hb.bottom - fb2.top)
        const offB = Math.round(fb2.top - hb.top)
        if (onB < 4 || offB < 4) {
          headNotTaped++
          const d = onB < 4 ? onB : -offB
          worstHead = Math.abs(d) > Math.abs(worstHead) ? d : worstHead
        }
      }
      // ★ NOTHING TOUCHES THE MAP. The brief is unambiguous and is the reason the banner grew
      // at all: "the preview banner to showcase a map should not have anything overlapping the
      // map because the map needs to be fully visible." Measured on the first straddle attempt:
      // header over the map by 6px, footer by 8px — a correct straddle onto a banner with too
      // little white space reserved. THIS is the assertion that catches that, and neither the
      // straddle checks above nor over-preview can: over-preview only sees a row whose top is
      // above the image bottom, which is a different geometry from a sticker landing on it.
      if (img) {
        const ib3 = img.getBoundingClientRect()
        if (ib3.height > 2) {
          const byFoot = Math.round(ib3.bottom - rb.top)
          if (byFoot > 0) { mapCovered++; worstCover = Math.max(worstCover, byFoot) }
          if (headSticker) {
            const hb2 = headSticker.getBoundingClientRect()
            const byHead = Math.round(hb2.bottom - ib3.top)
            if (byHead > 0) { mapCovered++; worstCover = Math.max(worstCover, byHead) }
          }
        }
      }
      for (const o of boxes) {
        if (o.c === c) continue
        const ox = Math.min(rb.right, o.b.right) - Math.max(rb.left, o.b.left)
        const oy = Math.min(rb.bottom, o.b.bottom) - Math.max(rb.top, o.b.top)
        if (ox > 1 && oy > 1) intrusions++
      }
    }
    const ctrls = all.filter((e) => /\\b(pbtn|pstock)\\b/.test((e.className||'').toString())).filter(vis)
    const tiny = ctrls.filter((e) => { const b = e.getBoundingClientRect(); return b.width < 18 || b.height < 10 })
    // FITS is not READABLE, and this gate asserted only the weaker one. A control 40px wide passes
    // every size check while showing five characters of a 76px label — measured, 81 of 108 controls
    // clipped, with Prayer List and Poster Map both rendering as Pra... A row made to fit by hiding
    // what its buttons SAY has not been fixed. scrollWidth > clientWidth is the browser telling us
    // the text did not fit its box.
    const clipped = ctrls.filter((e) => e.scrollWidth > e.clientWidth + 1)
    // ★ DENSITY: how many posters share a row, and how wide each is.
    // The ask: around 4 per row on desktop, like Instagram. The grid is ONE rule for
    // every width — repeat(auto-fill, minmax(210px,1fr)) — so the count falls out of the viewport
    // rather than being chosen, and NOTHING measured it. The card's own verify says it: "perRow is
    // currently printed nowhere and asserted nowhere. A number printed but not asserted on is
    // decoration."
    // ⚠ REPORTED, NOT YET ASSERTED, and that is deliberate. The desktop target is settled (~4) but
    // the MOBILE one is not: 3 per row at 390px is a ~120px card, which cannot hold the wrapped
    // print footer this same gate asserts is readable. Asserting a number no one has
    // ruled on would encode my taste as a requirement. Measuring it first is what makes the
    // ruling answerable — and it is the precondition for tuning, since you cannot tune toward a
    // target you are not measuring.
    // Row-mates are found by TOP EDGE, not by index: a grid row is a set of boxes sharing a y,
    // and counting "every Nth card" assumes the very layout under question.
    // ⚠ IT IS THE MAX, AND THE WALL IS SECTIONED. Grouping every card by top edge at 1440px gives
    // row sizes [5,5,5,3,3,2,2,1,1] — the short rows are the REMAINDERS of collapsible sections,
    // not a density failure. Reading the first row alone would be right here by luck and wrong on
    // a wall whose first section holds one poster. The max across all rows is the density the
    // "around 4 per row" ask is about; cardW is reported beside it because the two move
    // together and the width is what explains the count.
    let perRow = 0, cardW = 0
    if (cards.length) {
      const byTop = new Map()
      for (const c of cards) {
        const t = Math.round(c.getBoundingClientRect().top / 8) * 8
        byTop.set(t, (byTop.get(t) || 0) + 1)
      }
      perRow = Math.max(...byTop.values())
      cardW = Math.round(cards[0].getBoundingClientRect().width)
    }
    return { cards: cards.length, rows: cards.filter((c) => c.querySelector('.pfs')).length,
             overflowing, worst, intrusions, coveringPreview, worstY,
             previewsPainted, previewsBroken, noPreview, unnamedPreview, clipped: clipped.length,
             controls: ctrls.length, tiny: tiny.length, perRow, cardW,
             notTaped, worstTape, selectsInRow, headNotTaped, worstHead, mapCovered, worstCover,
             uncontained, worstBelow }
  })()`)
  await page.close()
  return { width, lang, hover, reach, ...out }
}

const results = []
try {
  for (const lang of LANGS) for (const w of WIDTHS) results.push(await measure(w, lang))
} finally {
  await browser.close()
}

console.log('POSTER-CARD-FITS')
console.log(`  leaf      : ${LEAF}`)
for (const r of results) {
  console.log(`  ${(r.lang || 'en').padEnd(2)} ${String(r.width).padStart(4)}px   cards ${String(r.cards).padStart(2)}`
    + ` · overflow ${r.overflowing}${r.worst ? ` (${r.worst}px)` : ''}`
    + ` · below-card ${r.uncontained}${r.worstBelow ? ` (${r.worstBelow}px)` : ''}`
    + ` · neighbour ${r.intrusions}`
    + ` · over-preview ${r.coveringPreview}${r.worstY ? ` (${r.worstY}px)` : ''}`
    + ` · off-frame ${r.notTaped}${r.worstTape ? ` (${r.worstTape > 0 ? '+' : ''}${r.worstTape}px)` : ''}`
    + ` · selects ${r.selectsInRow}`
    + ` · head-off ${r.headNotTaped}${r.worstHead ? ` (${r.worstHead > 0 ? '+' : ''}${r.worstHead}px)` : ''}`
    + ` · map-covered ${r.mapCovered}${r.worstCover ? ` (${r.worstCover}px)` : ''}`
    + ` · previews ${r.previewsPainted} painted`
    + `${r.previewsBroken ? `/${r.previewsBroken} BROKEN` : ''}${r.noPreview ? `/${r.noPreview} none` : ''}`
    + ` · max ${r.perRow}/row @ ${r.cardW}px`
    + ` · ${r.controls} control(s), ${r.tiny} too small, ${r.clipped} clipped`
    + (r.reach ? ` · last card ${r.reach.lastInView ? 'reachable' : 'UNREACHABLE'}` : '')
    + (r.hover
      ? ` · hover ${r.hover.after.outlineStyle === 'none'
        ? 'no outline' + (r.width < 500 ? ' (touch, correct)' : '')
        : `${r.hover.after.outlineWidth} ${r.hover.after.outlineColor}`}`
      : ''))
}

const fails = []
for (const r of results) {
  const at = `${r.lang || 'en'} ${r.width}px`
  // PRECONDITION: no cards means nothing was tested at this width — not a pass.
  if (!r.cards) { fails.push(`${at}: no poster cards rendered — wrong url, or the wall did not mount`); continue }
  if (!r.rows) { fails.push(`${at}: ${r.cards} card(s) but none carry a .pfs print-options row`); continue }
  if (r.intrusions) fails.push(`${at}: ${r.intrusions} print row(s) overlap a NEIGHBOURING card`)
  if (r.overflowing) fails.push(`${at}: ${r.overflowing} print row(s) extend past their own card (worst ${r.worst}px)`)
  if (r.uncontained) fails.push(`${at}: ${r.uncontained} print row(s) hang below their own card's box (worst ${r.worstBelow}px): the card must contain its row`)
  // ⚠ "Nothing overflows" is trivially satisfied by a row whose buttons collapsed to nothing.
  if (r.tiny) {
    fails.push(`${at}: ${r.tiny} print control(s) shrank below a usable size — fitting the row by `
      + 'crushing the buttons is not a fix')
  }
  // AND THE LABELS MUST BE READABLE. Same failure in a subtler form: the control keeps a usable
  // BOX while its text is ellipsised away, so a reader cannot tell Prayer List from Poster Map.
  if (r.clipped) {
    fails.push(`${at}: ${r.clipped} of ${r.controls} print control(s) have CLIPPED labels `
      + '(scrollWidth exceeds clientWidth) — the button is big enough to press and no longer says '
      + 'what it does')
  }
  // The row belongs BELOW the preview. Reported 2026-09-24: the download/print options were not
  // showing under the blue outline; they overlapped where the blue outline would be.
  // THE PREVIEW MUST ACTUALLY BE THERE. A card with no image passes every geometry assertion
  // above trivially — nothing can overlap what does not render. The wall is
  // supposed to show the previews (2026-09-24).
  if (r.unnamedPreview) {
    fails.push(`${at}: ${r.unnamedPreview} poster preview(s) have no alt text — the card's own text `
      + 'is a count and an action ("116 UPG · Show on map"), so the alt is the ONLY thing naming '
      + 'which poster this is. Without it a screen-reader user meets an anonymous picture, and '
      + 'every geometry assertion here still passes.')
  }
  if (r.previewsBroken) {
    fails.push(`${at}: ${r.previewsBroken} preview image(s) failed to load (naturalWidth 0) — `
      + 'a broken preview is not something the geometry checks can see')
  }
  // ★ THE OTHER EDGE OF over-preview. That assertion catches a row sitting too HIGH; this one
  // catches it sitting too LOW, which is the state that actually shipped and that nothing here
  // could see: MEASURED frame bottom 426, row top 452, and a full green run.
  if (r.notTaped) {
    fails.push(`${at}: ${r.notTaped} print row(s) do not STRADDLE the banner's bottom edge `
      + `(worst ${r.worstTape > 0 ? '+' : ''}${r.worstTape}px on one side; positive = too little `
      + 'on the banner, negative = too little overhanging). The footer sticker sits centred on '
      + 'that edge, part on the banner\'s white space and part hanging onto the page below — '
      + '"slight overlap over the banner, but not over the content of the banner". A row '
      + 'floating clear of the banner is as wrong as one covering the map.')
  }
  // ★ THE ONE THAT MATTERS MOST: nothing may overlap the map on the preview banner that showcases
  // it, because the map needs to be fully visible.
  if (r.mapCovered) {
    fails.push(`${at}: ${r.mapCovered} sticker(s) OVERLAP the map preview (worst ${r.worstCover}px). `
      + 'The banner\'s header and footer stickers straddle the banner\'s edges; the map inside is '
      + 'never to be touched — "if I put a piece of tape over the text it would be offensive to '
      + 'the map". Reserve more banner white space via --banner-pad-top/--banner-pad-bottom on '
      + '.main rather than moving the sticker: a sticker centred on the edge puts HALF its '
      + 'height on the banner, so the padding must exceed that half.')
  }
  if (r.headNotTaped) {
    fails.push(`${at}: ${r.headNotTaped} header sticker(s) do not straddle the banner's top edge `
      + `(worst ${r.worstHead > 0 ? '+' : ''}${r.worstHead}px on one side). A sticker sits ON the `
      + 'edge it tapes, part on the banner and part overhanging — measured 35px above / -1px '
      + 'below before this was asserted, i.e. floating free of the banner entirely.')
  }
  if (r.selectsInRow) {
    fails.push(`${at}: ${r.selectsInRow} native <select>(s) in the print row. The card-stock `
      + 'picker is a DISCLOSURE behind the Card Deck button, not a control in the default row — '
      + '"I don\'t want to add the dropdown for the card because it makes it hard for others to '
      + 'have dropdowns too." A <select> here also collides with the host page\'s own dropdowns.')
  }
  // EVERY card falling back to the placeholder means the previews are gone. MEASURED by aborting
  // every previews/** request: the product degrades WELL — all 27 cards swap to a .ph placeholder
  // reading "poster not generated yet", with no broken-image icons and no <img> left at all. That
  // is correct behaviour and exactly why it is invisible to an image-health check: previewsBroken
  // stays 0 because there is nothing left to be broken. Assert the FALLBACK instead.
  if (r.cards && r.noPreview === r.cards) {
    fails.push(`${at}: all ${r.cards} card(s) fell back to the "poster not generated yet" `
      + 'placeholder — no preview rendered anywhere, and the geometry assertions above are vacuous '
      + 'without one (they cannot overlap an image that is not there)')
  }
  if (r.previewsPainted === 0 && r.cards && r.noPreview !== r.cards) {
    fails.push(`${at}: NOT ONE preview image painted across ${r.cards} card(s) — the geometry `
      + 'assertions above are vacuous without them')
  }
  if (r.coveringPreview) {
    fails.push(`${at}: ${r.coveringPreview} print row(s) COVER the preview image `
      + `(top sits ${r.worstY}px above the image's bottom edge) — growing the row taller to fit it `
      + 'horizontally is not a fix')
  }
  // HOVER: the card must answer the pointer, and must not move when it does.
  // Only asserted where a pointer exists — a touch viewport has `@media (hover:none)` suppressing
  // the state deliberately, so demanding an outline there would fail the correct behaviour.
  // REACHABILITY: the LAST card must be reachable, and still work when you get there.
  if (r.reach) {
    if (!r.reach.lastInView) {
      fails.push(`${at}: scrolling to the bottom does NOT bring the last poster into view `
        + `(scrolled ${r.reach.scrolled} of ${r.reach.maxScroll}) — every geometry assertion above `
        + 'is satisfied by a wall whose bottom half a reader can never get to')
    }
    if (r.reach.lastControls === 0) {
      fails.push(`${at}: the last poster has NO print controls — the wall degrades toward the end`)
    }
    if (r.reach.lastClipped) {
      fails.push(`${at}: ${r.reach.lastClipped} control(s) on the LAST poster are clipped — the `
        + 'sampled cards near the top fit while the far end does not')
    }
    if (r.reach.lastUnusable) {
      fails.push(`${at}: ${r.reach.lastUnusable} control(s) on the last poster are too small to press`)
    }
  }
  if (r.hover) {
    const { before, after } = r.hover
    const pointer = r.width >= 500
    if (pointer) {
      if (after.outlineStyle === 'none') {
        fails.push(`${at}: hovering a card paints NO outline — the card does not answer the `
          + 'pointer, so a reader cannot tell which poster their click is about to act on')
      } else if (before.outlineStyle !== 'none') {
        fails.push(`${at}: the card carries an outline even when NOT hovered `
          + `(${before.outlineStyle}) — the outline is meant to be the hover affordance, not a `
          + 'permanent frame')
      }
      if (after.w !== before.w || after.inner !== before.inner) {
        fails.push(`${at}: hovering RESIZED the card `
          + `(outer ${before.w}->${after.w}px, content ${before.inner}->${after.inner}px). The `
          + 'hover state must not re-lay-out anything: every print-row assertion above is about '
          + 'where that row sits, and a cosmetic hover that moves the box can break them. Use '
          + 'outline (painted OUTSIDE the box and taking no space), never a border change.')
      }
    } else if (after.outlineStyle !== 'none') {
      fails.push(`${at}: a TOUCH viewport painted a hover outline (${after.outlineStyle}) — with `
        + 'no pointer this either never appears or sticks after a tap, leaving a card looking '
        + 'permanently selected')
    }
  }
}

if (fails.length) {
  console.error(`\nPOSTER-CARD-FITS: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
// Report widths x LOCALES, not the product. "15 width(s)" misdescribes 5 widths in 3 languages,
// and a summary that overstates its own coverage is how a green line stops meaning anything.
console.log(`\nPOSTER-CARD-FITS: PASS — ${WIDTHS.length} width(s) (${WIDTHS.join(', ')}px) `
  + `x ${LANGS.length} locale(s) (${LANGS.join(', ')}) = ${results.length} combination(s). Every `
  + 'print-options row sits inside its own card and below its preview, with every control still '
  + 'big enough to press and its label fully readable in every locale checked.')
