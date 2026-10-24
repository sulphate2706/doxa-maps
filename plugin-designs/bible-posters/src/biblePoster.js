/**
 * biblePoster.js — the Bible-book poster layout engine (pure: plan maths + an HTML string, no Vue).
 *
 * Modeled on wall-of-people-groups/src/blessPoster.js (the wall's engine): a `fit()` search for the
 * largest readable type size, an HTML document for the shared in-place print frame, and a screen model
 * that mirrors the print exactly ("what the wall shows is what prints"). The CONTENT differs — a book
 * is flowing text, not a card grid — so the body is CSS multi-column justified text rather than a grid.
 *
 * The approved layout: a bold BOOK-NAME header, then MULTIPLE COLUMNS about the width of a phone
 * screen, ~7-10 words per line, JUSTIFIED, the whole book visible at once. RTL scripts flow right-to-left.
 *
 * ⚠ This is a MODEL of the layout (character-advance estimates), not a measurement of the rendered page.
 * A headless plan proves the arithmetic; only a browser check proves the page. Every number the model
 * uses is named here so a rendered measurement can correct the constants.
 */

const PT = 1 / 72              // one point in inches
export const MIN_READABLE_PT = 6      // a book printed below this is grey noise on a poster
export const MAX_PT = 16
export const PX_IN = 96        // screen world: CSS px per inch (matches blessPoster.screenPoster)

// Layout targets (the approved design, made numeric — correct against a rendered measurement).
const WORDS_PER_LINE = 8       // "~7-10 words per line"
const AVG_WORD_CHARS = 6       // 5 letters + a space, averaged
const CHARS_PER_LINE = WORDS_PER_LINE * AVG_WORD_CHARS   // 48
const CHAR_EM = 0.5            // average glyph advance as a fraction of the em (justified serif)
const LINE_LH = 1.32           // body line-height
const COL_GAP_IN = 0.28        // gap between columns
const MARGIN_IN = 0.5          // poster margin (all sides)
const HEAD_FRAC = 0.10         // header band as a fraction of poster height (min 0.6in)
const CREDIT_IN = 0.32         // credit-line band height
const CONTENT_SLACK = 1.15     // justification + word-break slack over raw character count

/** Column width (inches) that yields ~WORDS_PER_LINE words per line at this type size. */
function colWidthIn(pt) { return CHARS_PER_LINE * CHAR_EM * pt * PT }

/**
 * Plan a book onto a poster of widthIn × heightIn. Returns the chosen columns + type size and whether
 * the whole book fits at a readable size.
 * @param {{widthIn:number,heightIn:number}} size
 * @param {{charCount:number,verseCount:number,blocks:Array}} book
 */
export function planBiblePoster(size, book) {
  const W = size.widthIn - 2 * MARGIN_IN
  const headH = Math.max(0.6, size.heightIn * HEAD_FRAC)
  const H = size.heightIn - 2 * MARGIN_IN - headH - CREDIT_IN
  const headingCount = (book.blocks || []).filter((b) => b.kind === 'heading').length
  // effective characters the body must hold: text + verse-number glyphs + a line's worth per heading
  const effective = Math.ceil(book.charCount * CONTENT_SLACK + book.verseCount * 3 + headingCount * CHARS_PER_LINE)

  const capacityAt = (pt) => {
    const colW = colWidthIn(pt)
    const cols = Math.max(1, Math.floor((W + COL_GAP_IN) / (colW + COL_GAP_IN)))
    const lineIn = pt * LINE_LH * PT
    const linesPerCol = Math.max(0, Math.floor(H / lineIn))
    return { pt, colW, cols, linesPerCol, capacity: cols * linesPerCol * CHARS_PER_LINE }
  }

  // Largest type size (0.5pt steps) whose capacity holds the whole book.
  let chosen = null
  for (let pt = MAX_PT; pt >= MIN_READABLE_PT - 0.001; pt -= 0.5) {
    const c = capacityAt(pt)
    if (c.capacity >= effective) { chosen = c; break }
  }
  const fits = !!chosen
  const plan = chosen || capacityAt(MIN_READABLE_PT)   // if nothing fits, report the floor's numbers
  return {
    fits, effective,
    widthIn: size.widthIn, heightIn: size.heightIn,
    marginIn: MARGIN_IN, headHIn: headH, creditHIn: CREDIT_IN,
    contentWIn: W, contentHIn: H,
    cols: plan.cols, colWIn: plan.colW, colGapIn: COL_GAP_IN,
    fontPt: plan.pt, lineHeight: LINE_LH, linesPerCol: plan.linesPerCol,
    capacity: plan.capacity,
  }
}

/** Given a book and a set of candidate sizes, the smallest that fits (for the "which size" hint). */
export function fitLadder(sizes, book) {
  return sizes.map((s) => {
    const p = planBiblePoster({ widthIn: s.widthIn, heightIn: s.heightIn }, book)
    return { id: s.id, label: s.label, fits: p.fits, fontPt: p.fontPt, cols: p.cols }
  })
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** The body HTML: headings and verses in reading order; verse numbers are bidi-isolated superscripts. */
function bodyHtml(book) {
  let html = ''
  let lastChapter = 0
  for (const b of book.blocks) {
    if (b.kind === 'heading') { html += '<h2 class="bh">' + esc(b.text) + '</h2>'; continue }
    if (b.chapter !== lastChapter) { html += '<span class="cn">' + esc(b.chapter) + '</span>'; lastChapter = b.chapter }
    html += '<span class="v"><sup class="vn" dir="ltr">' + esc(b.number) + '</sup>' + esc(b.text) + ' </span>'
  }
  return html
}

/** CSS shared by print and screen. Built by concatenation (no backticks inside — AGENT-BRIEF house rule
 *  for shadow CSS; kept here for consistency and safe embedding). `unit` scales the poster to px on screen. */
function posterCss(plan, dir, unit) {
  const u = (inches) => (inches * unit).toFixed(2) + (unit === 1 ? 'in' : 'px')
  const isRtl = dir === 'rtl'
  return ''
    + '*{box-sizing:border-box}'
    + '.bp{position:relative;width:' + u(plan.widthIn) + ';height:' + u(plan.heightIn) + ';'
      + 'padding:' + u(plan.marginIn) + ';background:#fff;color:#1c1c1c;'
      + 'font-family:Georgia,"Times New Roman",serif;direction:' + (isRtl ? 'rtl' : 'ltr') + ';'
      + '-webkit-print-color-adjust:exact;print-color-adjust:exact;overflow:hidden}'
    + '.bp-head{height:' + u(plan.headHIn) + ';display:flex;flex-direction:column;align-items:center;'
      + 'justify-content:center;text-align:center;border-bottom:' + u(0.02) + ' solid #1c1c1c}'
    + '.bp-title{margin:0;font-weight:700;line-height:1.02;font-size:' + u(plan.headHIn * 0.5) + '}'
    + '.bp-body{height:' + u(plan.contentHIn) + ';margin-top:' + u(0.12) + ';'
      + 'column-count:' + plan.cols + ';column-gap:' + u(plan.colGapIn) + ';column-fill:auto;'
      + 'font-size:' + (unit === 1 ? plan.fontPt + 'pt' : (plan.fontPt * unit / 72).toFixed(2) + 'px') + ';'
      + 'line-height:' + plan.lineHeight + ';text-align:justify;hyphens:auto;-webkit-hyphens:auto;'
      + 'text-justify:inter-word;overflow:hidden}'
    + '.bp-body .bh{font-weight:700;font-size:1.02em;margin:0.5em 0 0.15em;break-after:avoid;'
      + 'font-family:-apple-system,"Segoe UI",Arial,sans-serif}'
    + '.bp-body .cn{font-weight:700;font-size:1.5em;line-height:1;float:' + (isRtl ? 'right' : 'left') + ';'
      + 'margin:' + (isRtl ? '0 0 0 0.12em' : '0 0.12em 0 0') + ';color:#92552a}'
    + '.bp-body .vn{font-size:0.62em;font-weight:700;color:#92552a;vertical-align:super;'
      + 'unicode-bidi:isolate;margin:0 0.12em}'
    + '.bp-body .v{}'
    + '.bp-credit{position:absolute;left:' + u(plan.marginIn) + ';right:' + u(plan.marginIn) + ';'
      + 'bottom:' + u(plan.marginIn * 0.4) + ';height:' + u(plan.creditHIn) + ';display:flex;align-items:center;'
      + 'justify-content:center;text-align:center;font-family:-apple-system,"Segoe UI",Arial,sans-serif;'
      + 'font-size:' + u(0.11) + ';color:#6d766e}'
}

/** The print document: one page, the whole book. `texts` supplies the credit line and optional dir/lang. */
export function buildBiblePosterHtml(book, size, texts = {}) {
  const dir = texts.dir || book.dir || 'ltr'
  const lang = texts.lang || ''   // a BCP-47 tag so hyphens:auto works and the page declares its language
  const plan = planBiblePoster(size, book)
  const css = '@page{size:' + size.widthIn + 'in ' + size.heightIn + 'in;margin:0}html,body{margin:0;padding:0}'
    + posterCss(plan, dir, 1)
  const inner = '<div class="bp-head"><h1 class="bp-title" dir="auto">' + esc(book.name) + '</h1></div>'
    + '<div class="bp-body" dir="auto">' + bodyHtml(book) + '</div>'
    + '<div class="bp-credit">' + esc(texts.credit || '') + '</div>'
  return '<!doctype html><html' + (lang ? ' lang="' + esc(lang) + '"' : '') + (dir === 'rtl' ? ' dir="rtl"' : '') + '><head><meta charset="utf-8">'
    + '<title>' + esc(book.name) + '</title><style>' + css + '</style></head>'
    + '<body><div class="bp">' + inner + '</div></body></html>'
}

/** The screen model (WYSIWYG): the same poster, scaled to CSS px. Returns { css, html, worldW, worldH }. */
export function screenBiblePoster(book, size, texts = {}) {
  const dir = texts.dir || book.dir || 'ltr'
  const plan = planBiblePoster(size, book)
  const css = posterCss(plan, dir, PX_IN)
  const html = '<div class="bp-head"><h1 class="bp-title" dir="auto">' + esc(book.name) + '</h1></div>'
    + '<div class="bp-body" dir="auto">' + bodyHtml(book) + '</div>'
    + '<div class="bp-credit">' + esc(texts.credit || '') + '</div>'
  return { css, html, dir, lang: texts.lang || '', plan, worldW: size.widthIn * PX_IN, worldH: size.heightIn * PX_IN }
}
