/**
 * blessPoster.js — the large printed poster engine, first used for "Bless the nations in Jesus' name":
 * every people group (photo, name and a blessing verse) on ONE poster, sized for a print shop.
 *
 * THREE SIZES (the brief): 3 × 4 ft, the DEFAULT, and 2 × 3 ft are one sheet each; 5 × 8 ft is the large one,
 * printed as THREE 5 × 3 ft sheets stacked top to bottom:
 *   · every sheet has a 6-inch BORDER on its top, left and right;
 *   · the top two sheets' BOTTOM edge is FLAT (trimmed at the shop) and is glued onto the 6-inch top
 *     border of the sheet below, which is a blank GLUE band (marked "glue here");
 *   · the bottom sheet also has a 6-inch bottom border, so the finished poster has a 6-inch border all
 *     the way round. 36 + 30 + 30 = 96 in = 8 ft tall, 60 in = 5 ft wide.
 * Content never straddles a glue line: rows are fitted to each sheet's band.
 *
 * The single-sheet sizes reuse the same engine (one sheet with a plain border). The card size and every
 * text size are COMPUTED from the preset and the number of groups. The brief asks that the scripture stay
 * readable at every size: where a verse under every card would print below MIN_READABLE_PT (3 × 4 and
 * 2 × 3 ft, for ~2,100 groups), the size uses the STRIP layout, cards of name + photo with ONE verse per
 * row on a strip under it at STRIP_PT, instead of dropping the verses.
 *
 * Pure: plan maths + an HTML string for the shared in-place print frame (library printInPlace), and the
 * SAME layout for the screen (screenPoster: what the wall shows is what prints). No Vue.
 */
import { blessingFor, POSTER, THEMES } from './blessings.js'
import { lightPhoto, fullPhoto } from './photoUrl.js'
// The sheets, their glue bands and the print marks: the shared panel geometry (also India's large posters).
import { planPanels, screenLayout, panelChromeHtml, panelCss } from '../../../library/components/poster/panelSheets.js'

// Sheet sizes in inches (w × h of ONE printed page), how many stack vertically, and the border. The brief's
// three: 3 × 4 ft (the default, a living-room wall), 2 × 3 ft (small), 5 × 8 ft (three glued panels).
export const PRESETS = {
  '3x4ft': { label: '3 × 4 ft', sheetW: 36, sheetH: 48, sheets: 1, border: 2 },
  '2x3ft': { label: '2 × 3 ft', sheetW: 24, sheetH: 36, sheets: 1, border: 1 },
  '5x8ft': { label: '5 × 8 ft', sheetW: 60, sheetH: 36, sheets: 3, border: 6 },
}
export const DEFAULT_PRESET = '3x4ft'
export const MIN_READABLE_PT = 6   // verse size below which a verse under every card is not readable
export const STRIP_PT = 9          // the one-verse strip under each row, on the sizes that use it

// A preset as panels: its sheets stacked top to bottom, each join a blank GLUE band as deep as the border.
const panelsOf = (P) => planPanels({ sheetW: P.sheetW, sheetH: P.sheetH, count: P.sheets, direction: 'vertical', joinIn: P.border, borderIn: P.border, joinFill: 'glue' })

// The poster's colours, shared with the screen canvas (wallCanvas.js) so the wall shows what prints: the UPG 100
// List template's paper, ink and purple, with a warm grey under a photo that has not loaded.
export const PAPER = '#f7f4ec', INK = '#1c1c17', NAME_INK = '#2A2721', ACCENT = '#6B4A78', PHOTO_BG = '#e9e3d4'
export const VERSE_INK = '#3a362c', REF_INK = '#8a8470'

const CARD_ASPECT = 0.8      // card width / height: a portrait card (name, photo, verse)
const PT = 1 / 72            // one point in inches

/**
 * The plan for n groups on a preset: per-sheet content bands, the card grid, and the text sizes.
 * Banner + subtitle sit at the top of sheet 1's band; the footer at the bottom of the last sheet's.
 */
export function planPoster(presetId, n) {
  const P = PRESETS[presetId] || PRESETS[DEFAULT_PRESET]
  const b = P.border
  const W = P.sheetW - 2 * b
  // Top of sheet 1: the title and the DOXA line, then the prayer-themes table. Bottom of the last sheet: the
  // call to action (a ruled band), the journey's table, a rule, and the benediction (Numbers 6:24-26). All scale with the width.
  // gapH: air between the chart and the first row of cards, and between the last row and the footer (the grid
  // used to butt against the chart's border).
  const titleH = W * 0.075, headH = titleH, tableH = W * 0.17, gapH = W * 0.012
  const bannerH = headH + tableH + gapH, footerH = footerHeight(W, BENEDICTION_FILL[PRESETS[presetId] ? presetId : DEFAULT_PRESET] ?? 1)
  // Each sheet's content band, in the sheet's own coordinates: y0..y1. The panels give each sheet's content box:
  // sheet 1 starts below its outer border, the others below their glue band; only the last has a bottom border
  // (the others' bottom edge is trimmed flat and glued over the next sheet's band).
  const panels = panelsOf(P)
  const bands = panels.sheets.map(({ s, last, content: { y0, y1 } }) => {
    const top = s === 0 ? bannerH : 0, bottom = last ? footerH + gapH : 0
    return { s, y0: y0 + top, y1: y1 - bottom, bannerY: s === 0 ? y0 : null, footerY: last ? y1 - footerH : null }
  })
  // The largest card (fewest columns) whose grid holds n when rows are fitted to each band; `strip` is the
  // height of the verse strip under each row (0 = the card layout, a verse on every card).
  const fit = (strip) => {
    for (let cols = 4; cols <= 400; cols++) {
      const cw = W / cols, ch = cw / CARD_ASPECT
      const rowsPer = bands.map((bd) => Math.max(0, Math.floor((bd.y1 - bd.y0) / (ch + strip))))
      if (cols * rowsPer.reduce((a, r) => a + r, 0) >= n) return { cols, cw, ch, rowsPer, strip }
    }
  }
  // Text sizes from the card: the verse gets ~4 lines of ~26 characters across the card width.
  const versePtOf = (cw) => (cw / 12.5) / PT          // character width ≈ 0.5 em, ~24 chars per line
  let grid = fit(0)
  const stripLayout = versePtOf(grid.cw) < MIN_READABLE_PT
  if (stripLayout) grid = fit((STRIP_PT * 1.35 + 4) * PT)   // one line at STRIP_PT, plus air
  const { cols, cw, ch, rowsPer, strip } = grid
  // Place cards band by band, row by row; in the strip layout each row's strip sits under it.
  const cards = [], strips = []
  let i = 0, row = 0
  for (let s = 0; s < bands.length && i < n; s++) {
    // The spare height goes BETWEEN the rows first (up to a quarter of a row each), so the photos spread to
    // fill the sheet, and what remains is shared equally above and below.
    const used = Math.min(rowsPer[s], Math.ceil((n - i) / cols))
    const slack = Math.max(0, (bands[s].y1 - bands[s].y0) - used * (ch + strip))
    const rowGap = used > 1 ? Math.min(slack / (used + 1), (ch + strip) * 0.25) : 0
    const top = bands[s].y0 + (slack - rowGap * (used - 1)) / 2
    for (let r = 0; r < rowsPer[s] && i < n; r++, row++) {
      const y = top + r * (ch + strip + rowGap)
      for (let c = 0; c < cols && i < n; c++, i++) cards.push({ i, s, x: b + c * cw, y, w: cw, h: ch })
      if (strip) strips.push({ row, s, x: b, y: y + ch, w: W, h: strip })
    }
  }
  const versePt = versePtOf(cw)
  return {
    preset: P, presetId: PRESETS[presetId] ? presetId : DEFAULT_PRESET, n, cols, rowsPer, cw, ch, bands, cards,
    layout: stripLayout ? 'strip' : 'cards', strips,
    bannerH, footerH, headH, titleH, tableH, gapH, contentW: W,
    posterW: panels.finished.w, posterH: panels.finished.h,   // after gluing: 60 × 96 for 5x8ft
    text: { versePt: +versePt.toFixed(1), namePt: +(versePt * 1.25).toFixed(1), readable: !stripLayout, stripPt: STRIP_PT },
  }
}

// The footer's height at content width W (inches), FROM ITS TEXT: the journey's seven columns (as tall as
// its longest passage wraps), the rule, the benediction's two lines (sized to fill the width), its reference
// and the scripture credit. Characters are counted at ≈ 0.5 em each, with 12% slack for word breaks. The
// same font sizes as the CSS.
// The journey's passages are the long text: never below 6 pt (2 × 3 ft), ~12 pt on the 5 × 8 ft poster, which
// keeps the 5 × 8's verse under every card at 6 pt (a larger footer would shrink the cards below it).
// ONE inner padding for every block (header, chart cells, footer), so all the text shares the same left and
// right edges across the full content width.
const padOf = (W) => W * 0.008
// THE BENEDICTION'S WIDTH, per size: the share of the footer's text width its longer clause fills. 1 = the full
// width (the brief's "two lines, large, filling the footer width"). The trade-off at 5 × 8 ft, measured with
// 2,107 groups: at 1 the footer is 17.3 in deep and the cards 0.87 in, one verse per ROW; at 0.3 the cards
// keep a verse UNDER EVERY CARD (1.04 in). Change a size's number here to choose; nothing else needs to move.
export const BENEDICTION_FILL = { '3x4ft': 1, '2x3ft': 1, '5x8ft': 1 }
// Georgia bold italic, em per character of the longer line, MEASURED on the rendered print of these two lines:
// 0.61 filled 0.911 of the width, so ≈ 0.555; 0.56 fills ~0.99 and leaves a hair of the padding clear.
const BENEDICTION_EM = 0.56
// MEASURED: at 0.47 the English line needed 1.057 of its band (it wrapped), so ≈ 0.50; 0.51 keeps it on one line
const CTA_EM = 0.51
export const FOOTER_FONTS = (W, fill = 1) => ({
  ref: W * 0.0075, name: W * 0.0062, station: Math.max(6 / 72, W * 0.0034), credit: Math.max(6 / 72, W * 0.0042),
  // the call to action fills its band on one line in English (CTA_EM, Georgia italic); a longer
  // translation wraps to a second line, which footerHeight() budgets for
  cta: (W - 2 * padOf(W)) / (CLOSING_EN.length * CTA_EM),
  verse: (fill * (W - 2 * padOf(W))) / (Math.max(...POSTER.benediction.lines.map((l) => l.length)) * BENEDICTION_EM),
})
function footerHeight(W, fill) {
  const F = FOOTER_FONTS(W, fill), gap = W * 0.006
  const lines = (text, width, fs) => Math.max(1, Math.ceil((String(text).length * 0.5 * fs * 1.12) / width))
  const colW = (W - 6 * gap) / 7 - W * 0.008
  const stationH = Math.max(...POSTER.journey.map((v) => lines(v.text, colW, F.station) * F.station * 1.3)) + F.name * 1.6 + F.ref * 1.6 + W * 0.006
  // the call to action's band (two lines budgeted), the seven stations, the rule, the benediction's two lines,
  // its reference and the credit line
  const ctaH = 2 * F.cta * 1.3 + W * 0.02
  const verseH = POSTER.benediction.lines.length * F.verse * 1.12 + F.ref * 1.8 + F.credit * 1.6
  return (ctaH + stationH + verseH + W * 0.04) * 1.05
}

// The journey's station names (agent-written); translated via texts.labels.journey_<id> when available.
// The call to action above the journey (agent-written; translated via texts.labels.closing): the poster's one line
// of its own words, in a ruled band as the UPG 100 List posters set theirs, while the footer itself is scripture.
const CLOSING_EN = 'Jesus Christ is the cornerstone, and we are living stones. These people groups are the reward of his suffering. Take up our priestly calling: bless them in his name, and join the global family in prayer.'
const JOURNEY_EN = { called: 'Called', promised: 'Promised', redeemed: 'Redeemed', cornerstone: 'The cornerstone', children: 'Children of Abraham', priesthood: 'A royal priesthood', sent: 'Sent to the lost' }
const THEME_EN = { treasure: 'Treasure', mountain: 'Mountain', sea: 'Sea' }
// Three simple line icons for the prayer themes (stroke = currentColor).
const ICONS = {
  treasure: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M8 30h48v24H8z"/><path d="M8 30c0-11 9-17 24-17s24 6 24 17"/><path d="M8 38h48"/><rect x="27.5" y="34" width="9" height="10" rx="1.5"/><path d="M20 16v14M44 16v14"/></svg>',
  mountain: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M3 54 24 18l11 18 7-10 19 28z"/><path d="M18 28l6 5 5-5"/></svg>',
  sea: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 24c5-5 10-5 15 0s10 5 15 0 10-5 15 0 10 5 11 2"/><path d="M4 36c5-5 10-5 15 0s10 5 15 0 10-5 15 0 10 5 11 2"/><path d="M4 48c5-5 10-5 15 0s10 5 15 0 10-5 15 0 10 5 11 2"/></svg>',
}

/**
 * ONE source for a card's text sizes, called by the print HTML AND the screen canvas (wallCanvas), so the
 * two cannot drift. Sizes in points, lengths in inches.
 *  · the reference prints at the verse's size × 0.8, never below MIN_READABLE_PT (a reference that can't
 *    be read is noise); verse and reference are only printed on sizes whose verses are readable;
 *  · a long name shrinks to fit its line (bold ≈ 0.72 em a character: measured wide on purpose, since
 *    0.68 left "Kummara, Kumbara" 2 px over), down to MIN_READABLE_PT (or the preset's own name size if that
 *    is smaller); still too long, it wraps, at the size that fits two lines, or more (up to four) at the floor.
 */
export function cardText(plan, name) {
  const vPt = plan.text.versePt, nPt = plan.text.namePt
  const EM = 0.72, inner = plan.cw * 0.93 / PT, len = Math.max(1, String(name).length)
  const floor = Math.min(nPt, MIN_READABLE_PT), want = inner / (len * EM)
  const wrap = want < floor
  // Wrapped: the size that fits two lines (not below the floor), and as many lines (≤ 4) as that size needs.
  // A line breaks only between words, so the longest word must fit a line too ("Liechtensteiners" did not, and
  // "Deaf Liechtensteiners" printed its third line under the clamp).
  const words = String(name).split(/\s+/).filter(Boolean), longest = Math.max(1, ...words.map((w) => w.length))
  const pt = wrap ? Math.max(floor, Math.min(nPt, (2 * inner) / (len * EM), inner / (longest * EM))) : Math.min(nPt, want)
  // Lines counted the way the browser breaks them: whole words, greedily (a word longer than a line is cut), with
  // 15% slack on the character width (bold names measured wider than the plain sum). Up to 4 lines: a long
  // name at the floor size ("Northern Conchucos Ancash Quechua") needs 4, and the photo gives up the height.
  const lines = wrap ? Math.min(4, wrapLines(words, inner / (EM * pt * 1.15))) : 1
  return {
    readable: plan.text.readable, versePt: vPt, refPt: +Math.max(MIN_READABLE_PT, vPt * 0.8).toFixed(1),
    name: { pt: Math.floor(pt * 10) / 10, wrap, lines },
    padIn: plan.cw * 0.035, imgMarginIn: plan.cw * 0.02, nameLine: 1.1, verseLine: 1.15, refGapPt: 1,
  }
}

// How many lines a list of words takes at perLine characters a line, broken at spaces (a longer word is cut).
function wrapLines(words, perLine) {
  let lines = 1, cur = 0
  for (const w of words) {
    const need = cur ? cur + 1 + w.length : w.length
    if (need <= perLine) { cur = need; continue }
    if (cur) lines++
    cur = w.length
    while (cur > perLine) { lines++; cur -= Math.floor(perLine) || 1 }
  }
  return lines
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * The print document: one page per sheet. groups: [{ name, imageUrl }]. texts: { banner, subtitle,
 * subBanner: {text, ref}, footer: {text, ref}, glueHere } (the wall passes translated UI strings).
 */
export function buildBlessPosterHtml(groups, presetId = DEFAULT_PRESET, texts = {}) {
  const { css, pages, banner } = posterParts(groups, presetId, texts)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(banner)}</title><style>${css}</style></head>`
    + `<body class="poster">${pages.map((pg) => `<section class="sheet">${pg.cards}${pg.chrome}</section>`).join('')}</body></html>`
}

// The gap between stacked sheets on SCREEN (inches); print has none (each sheet is its own page).
export const SCREEN_GAP_IN = 0.75
const PX_IN = 96   // CSS px per inch: the screen world is the print, in CSS px

/**
 * The SCREEN view of the same poster (WYSIWYG): the sheets stacked as they print, in CSS px (96 per inch).
 * cards: the plan's cards in world px; chromeHtml: every sheet's title, chart, footer, glue band and tag,
 * exactly as printed, minus the cards (the canvas draws those, with cardText's sizes).
 */
export function screenPoster(groups, presetId = DEFAULT_PRESET, texts = {}) {
  const { plan, css, pages } = posterParts(groups, presetId, texts, false)
  const L = screenLayout(panelsOf(plan.preset), { gapIn: SCREEN_GAP_IN, pxPerIn: PX_IN }), step = L.step
  return {
    plan, css, pxPerIn: PX_IN,
    worldW: L.worldW, worldH: L.worldH,
    sheets: L.sheets.map(({ x, y, w, h }) => ({ x, y, w, h })),
    cards: plan.cards.map((c) => ({ i: c.i, x: c.x * PX_IN, y: (c.s * step + c.y) * PX_IN, w: c.w * PX_IN, h: c.h * PX_IN })),
    chromeHtml: pages.map((pg, s) => `<section class="sheet" style="position:absolute;left:0;top:${s * step}in">${pg.chrome}</section>`).join(''),
  }
}

function posterParts(groups, presetId, texts, withCards = true) {
  const plan = planPoster(presetId, groups.length)
  const P = plan.preset, b = P.border
  const banner = texts.banner || POSTER.banner
  const subtitle = texts.subtitle || ''
  const L = texts.labels || {}
  const lab = (k, en) => L[k] || en
  const dir = texts.dir === 'rtl' ? 'rtl' : 'ltr'
  const upright = /^(zh|ja|ko)/.test(String(texts.lang || ''))   // CJK sidebar labels stand upright
  const glueHere = texts.glueHere || 'glue here'
  const f = (v) => v.toFixed(3) + 'in'
  const W = plan.contentW, FF = FOOTER_FONTS(W, BENEDICTION_FILL[plan.presetId] ?? 1)   // the footer's sizes: the same numbers footerHeight() plans with
  const vPt = plan.text.versePt, rPt = cardText(plan, '').refPt
  // The rotated sidebar labels of the chart are sized from their text: the longest word must fit the row's
  // height (a CJK label stands upright, one em a character; other scripts ≈ 0.84 em a capital: 0.72 for the
  // letter, 0.06 of letter spacing, and slack, since "TESTAMENT" at 0.72 overran its row), and the wrapped lines
  // must fit the sidebar's width.
  const railH = plan.tableH * 0.33 - W * 0.006, railW = W * 0.06 - W * 0.004
  const railFs = (text) => {
    const words = String(text).split(/\s+/), em = upright ? 1.02 : 0.84
    const longest = Math.max(...words.map((w) => w.length)) * em
    const byH = railH / longest, byW = railW / (Math.min(words.length, 3) * 1.2)
    return Math.min(W * 0.0105, byH, byW)
  }
  // The chart's verse cells: one size for all six, the largest (up to W × 0.0078) at which the longest cell
  // (verse at line-height 1.3, then its reference) fits its row. Characters ≈ 0.5 em with 15% slack for breaks.
  const cellW = (W - W * 0.06) / 3 - 2 * W * 0.008, cellH = plan.tableH * 0.33 - 2 * W * 0.006 - W * 0.002 - W * 0.0062 * 1.3
  const cellFits = (fs) => THEMES.every((t) => [t.ot, t.nt].every((v) => Math.ceil((String(v.text).length * 0.5 * fs * 1.15) / cellW) * fs * 1.3 <= cellH))
  let tvFs = W * 0.0078
  while (tvFs > W * 0.005 && !cellFits(tvFs)) tvFs *= 0.97
  const railLabel = (text) => `<span style="font-size:${f(railFs(text))}">${esc(text)}</span>`
  const card = (c) => {
    const g = groups[c.i], v = blessingFor(c.i)
    // The photo at print size (photoUrl.js); a resized copy that fails falls back to the original, so a change on
    // the photo host costs weight, never a photo.
    const light = lightPhoto(g.imageUrl), full = fullPhoto(light)
    const img = g.imageUrl ? `<img src="${esc(light)}" alt=""${full ? ` data-full="${esc(full)}" onerror="this.onerror=null;this.src=this.dataset.full"` : ''}>` : '<div class="noimg"></div>'
    // Below MIN_READABLE_PT the verse would print as grey noise: that size shows name + photo only.
    const verse = plan.text.readable ? `<div class="vs" dir="auto">${esc(v.text)}</div><div class="rf" dir="auto">${esc(v.ref)}</div>` : ''
    const nf = cardText(plan, g.name || '').name
    return `<div class="card" style="left:${f(c.x)};top:${f(c.y)};width:${f(c.w)};height:${f(c.h)}">`
      + `<div class="nm${nf.wrap ? ' w2' : ''}" dir="auto" style="font-size:${nf.pt}pt${nf.wrap ? ';-webkit-line-clamp:' + nf.lines : ''}">${esc(g.name || '')}</div>${img}${verse}</div>`
  }
  const panels = panelsOf(P)
  const pages = plan.bands.map((bd) => {
    const s = bd.s
    const marks = panelChromeHtml(panels, s, { glueHere })   // the glue band (before), the trim line + s / N tag (after)
    // THE STORY, top to bottom: in Jesus' name → three prayer themes (OT + NT) → every people group →
    // the calling to bless, Abraham to the church with Christ at its centre → the benediction, at the
    // foundation. Each station's text takes dir="auto": the grid runs right to left in an RTL locale, while an
    // English verse inside it keeps its punctuation at the end. The same holds for every scripture, name and
    // reference on the sheet; the benediction and its credit are set left to right, as the English they are.
    const cell = (v) => `<p class="tv" dir="auto">${esc(v.text)}</p><p class="tr" dir="auto">${esc(v.ref)}</p>`
    const table = `<div class="themes" dir="${dir}">`
      + `<div class="rl rl-h">${railLabel(lab('themesLabel', 'Prayer themes'))}</div>`
      + THEMES.map((t) => `<div class="th"><div class="ic">${ICONS[t.id]}</div><div class="tn">${esc(lab('theme_' + t.id, THEME_EN[t.id]))}</div></div>`).join('')
      + `<div class="rl">${railLabel(lab('oldTestament', 'Old Testament'))}</div>`
      + THEMES.map((t) => `<div class="td">${cell(t.ot)}</div>`).join('')
      + `<div class="rl">${railLabel(lab('newTestament', 'New Testament'))}</div>`
      + THEMES.map((t) => `<div class="td">${cell(t.nt)}</div>`).join('')
      + '</div>'
    const head = bd.bannerY != null
      ? `<header class="ban" dir="${dir}" style="top:${f(bd.bannerY)};height:${f(plan.bannerH)}">`
        + `<div class="hd" style="height:${f(plan.headH)}"><h1>${esc(banner)}</h1>`
        + (subtitle ? `<p class="subt">${esc(subtitle)}</p>` : '') + `</div>`
        + `<div class="tblw" style="height:${f(plan.tableH)}">${table}</div></header>` : ''
    const foot = bd.footerY != null
      ? `<footer class="ftr" dir="${dir}" style="top:${f(bd.footerY)};height:${f(plan.footerH)}">`
        + `<div class="cta"><p class="ctal" dir="auto">${esc(lab('closing', CLOSING_EN))}</p></div>`
        + `<div class="jny">${POSTER.journey.map((v) => `<div class="st${v.centre ? ' ctr' : ''}"><p class="sn" dir="auto">${esc(lab('journey_' + v.id, JOURNEY_EN[v.id]))}</p><p class="sv" dir="auto">${esc(v.text)}</p><p class="sr" dir="auto">${esc(v.ref)}</p></div>`).join('')}</div>`
        + `<div class="frule"></div>`
        + `<p class="fv" dir="ltr" lang="en">${POSTER.benediction.lines.map(esc).join('<br>')}</p>`
        + `<p class="fvref" dir="ltr">${esc(POSTER.benediction.ref)}</p>`
        + `<p class="fcredit" dir="ltr" lang="en">${esc(POSTER.benediction.credit)}</p>`
        + `</footer>` : ''
    // STRIP layout: one blessing verse per row, on a strip under the row (the same rotation as the cards').
    const strips = plan.strips.filter((t) => t.s === s).map((t) => { const v = blessingFor(t.row)
      return `<div class="vstrip" dir="auto" style="left:${f(t.x)};top:${f(t.y)};width:${f(t.w)};height:${f(t.h)}">${esc(v.text)}<span class="vref">${esc(v.ref)}</span></div>` }).join('')
    return { cards: withCards ? plan.cards.filter((c) => c.s === s).map(card).join('') : '', chrome: `${marks.before}${head}${strips}${foot}${marks.after}` }
  })
  // THE HOUSE POSTER STYLE, from the UPG 100 List template (library/packet/poster-render.js, the approved v5):
  // warm paper, rules instead of boxes, Georgia for titles and scripture, the sans for labels and names,
  // tracked capitals for the small labels, and the purple ink for references and emphasis.
  const PAD = padOf(W)
  // SECTION DIVIDERS run the page's width, as on the UPG 100 List posters: XR past the content column on each
  // side, stopping a quarter of the border short of the sheet's edge. The text stays in the content column.
  const XR = b * 0.75
  const SANS = "Lato,-apple-system,'Segoe UI',system-ui,Arial,sans-serif"
  const css = `@page{size:${P.sheetW}in ${P.sheetH}in;margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body,.poster{font-family:Georgia,'Times New Roman',serif;color:${INK};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{position:relative;width:${P.sheetW}in;height:${P.sheetH}in;overflow:hidden;page-break-after:always;break-after:page;background:${PAPER}}
.ban{position:absolute;left:${f(b)};width:${f(W)};text-align:center}
.hd{padding:0 ${f(PAD)}}
.hd{position:relative;display:flex;flex-direction:column;justify-content:center;align-items:center}
.hd::after,.tblw::after,.cta::before,.cta::after{content:'';position:absolute;border-top:.015in solid #C9BFA4}
.hd::after{left:${f(-XR)};right:${f(-XR)};bottom:0}
.tblw{position:relative}.tblw::after{left:${f(-XR)};right:${f(-XR)};bottom:0;border-top-width:.02in}
.hd h1{margin:0;font-size:${f(plan.titleH * 0.44)};line-height:1.15;font-weight:700;letter-spacing:-.02em;color:#1c1c17}
.hd .subt{margin:${f(plan.titleH * 0.06)} 0 0;font:${f(plan.titleH * 0.085)}/1.35 ${SANS};color:#7E7562;letter-spacing:.01em}
.themes{display:grid;grid-template-columns:${f(W * 0.06)} repeat(3,1fr);grid-template-rows:34% 33% 33%;height:100%;overflow:hidden}
.themes > div{padding:${f(W * 0.006)} ${f(PAD)};overflow:hidden;border-inline-start:.01in solid #D6CCB4}
.themes > .rl{display:flex;align-items:center;justify-content:center;color:#8a8470;padding:${f(W * 0.002)};border-inline-start:0}
.themes > .td,.themes > .rl:not(.rl-h){border-top:.01in solid #D6CCB4}
.rl span{writing-mode:vertical-rl;${upright ? 'text-orientation:upright;' : 'transform:rotate(180deg);'}font-weight:700;font-family:${SANS};line-height:1.15;letter-spacing:.06em;text-transform:uppercase;text-align:center}
.themes > .th{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${f(W * 0.003)};padding-top:${f(W * 0.003)};padding-bottom:${f(W * 0.003)}}
.th .ic{width:${f(W * 0.028)};height:${f(W * 0.028)};color:${ACCENT};flex:none}.th .ic svg{width:100%;height:100%}
.th .tn{font:700 ${f(W * 0.012)}/1.1 Georgia,serif;letter-spacing:.02em;color:${ACCENT}}
.td{display:flex;flex-direction:column;justify-content:center;text-align:center}
.td .tv{margin:0;font-size:${f(tvFs)};line-height:1.3;font-style:italic;color:#3a362c}
.td .tr{margin:${f(W * 0.002)} 0 0;font:700 ${f(W * 0.0055)} ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${ACCENT}}
.ftr{position:absolute;left:${f(b)};width:${f(W)};padding:0 ${f(PAD)};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
/* The call to action, in a band ruled across the page (the UPG posters' goal line), above the journey's table. */
.cta{position:relative;width:100%;padding:${f(W * 0.009)} 0}
.cta::before{left:${f(-PAD - XR)};right:${f(-PAD - XR)};top:0}.cta::after{left:${f(-PAD - XR)};right:${f(-PAD - XR)};bottom:0}
.ctal{margin:0;font:italic ${f(FF.cta)}/1.3 Georgia,'Times New Roman',serif;color:#4a4636}
/* Rules run the full content width, like the chart's; the padding belongs to the text. */
.jny{display:grid;grid-template-columns:repeat(7,1fr);gap:${f(W * 0.006)};margin:${f(W * 0.01)} ${f(-PAD)} 0;width:${f(W)};align-items:stretch}
.st{display:flex;flex-direction:column;justify-content:flex-start;padding:${f(W * 0.003)} ${f(W * 0.004)}}
.st + .st{border-inline-start:.01in solid #D6CCB4}
.st .sn{margin:0 0 ${f(W * 0.002)};font:700 ${f(FF.name)} ${SANS};letter-spacing:.08em;text-transform:uppercase;color:#8a8470}
.st .sv{margin:0;font-size:${f(FF.station)};font-style:italic;line-height:1.3;color:#4a4636}
.st .sr{margin:${f(W * 0.002)} 0 0;font:700 ${f(Math.max(6 / 72, W * 0.0048))} ${SANS};letter-spacing:.1em;text-transform:uppercase;color:${ACCENT}}
.st.ctr{background:#F2EFE6;border:.02in solid #cdbf9e}.st.ctr + .st{border-inline-start:0}.st.ctr .sv{font-weight:600;color:#2A2721}.st.ctr .sn{color:${ACCENT}}
.frule{width:${f(W + 2 * XR)};margin:${f(W * 0.012)} ${f(-PAD - XR)} ${f(W * 0.01)};border-top:.015in solid #C9BFA4}
.fv{margin:0;font:italic 700 ${f(FF.verse)}/1.12 Georgia,'Times New Roman',serif;color:#2A2721;letter-spacing:-.01em;white-space:nowrap}
.fvref{margin:${f(W * 0.004)} 0 0;font:700 ${f(FF.ref)} ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${ACCENT}}
.fcredit{margin:${f(W * 0.004)} 0 0;font:${f(FF.credit)}/1.3 ${SANS};color:#8a8470}
.vstrip{position:absolute;display:flex;align-items:center;justify-content:center;gap:.6em;font-size:${STRIP_PT}pt;font-style:italic;
  color:#3a362c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-top:.01in solid #D6CCB4}
.vstrip .vref{font:700 .8em ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${ACCENT}}
.card{position:absolute;padding:${f(plan.cw * 0.035)};display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden}
.card .nm{font-weight:700;line-height:1.1;font-family:${SANS};color:${NAME_INK};width:100%;white-space:nowrap;overflow:hidden;flex:none}
.card .nm.w2{white-space:normal;overflow-wrap:anywhere;hyphens:auto;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
/* The photo takes whatever height the text leaves, so a card's content never outgrows the card. */
.card img,.card .noimg{width:100%;flex:1 1 0;min-height:0;object-fit:cover;margin:${f(plan.cw * 0.02)} 0;background:${PHOTO_BG}}
.card .vs{font-size:${vPt}pt;line-height:1.15;font-style:italic;color:${VERSE_INK}}
.card .vs,.card .rf{flex:none}
.card .rf{font-size:${rPt.toFixed(1)}pt;font-family:${SANS};color:${REF_INK};margin-top:1pt}
${panelCss(panels)}`
  return { plan, css, pages, banner }
}
