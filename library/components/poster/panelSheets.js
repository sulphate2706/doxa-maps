/**
 * panelSheets.js — SHARED. The geometry of a large poster printed as several sheets and joined on the wall,
 * and the marks that tell the print shop how to join them. Pure: numbers and HTML/CSS strings, no Vue.
 *
 * A poster too big for one sheet is printed as `count` sheets of sheetW × sheetH inches, joined in a line
 * (`direction` 'vertical': stacked top to bottom; 'horizontal': side by side). At each join the EARLIER sheet's
 * edge is trimmed flat and laid over the first `joinIn` inches of the next one, so
 *   finished length = count × sheet − (count − 1) × joinIn      (3 × 36 − 2 × 6 = 96; 2 × 36 − 6 = 66).
 * The strip that ends up underneath (the JOIN BAND) is filled one of two ways, chosen by the renderer:
 *   · 'glue'  — left blank and marked "glue here" in red; content is fitted around it, so nothing crosses a
 *               join (the Bless wall's cards);
 *   · 'bleed' — the poster simply continues under it, so a trim a few millimetres off shows poster, never a
 *               white seam (a map, whose title and land cross the join). Only a thin guide and a small tag
 *               are printed there: a solid band would show through a misaligned join.
 * On SCREEN (PanelSheets.vue, and any preview) the band is always drawn red with the sheets pulled apart, so a
 * reader sees how the pieces go together, whichever way the print fills it.
 *
 * The parameter names are the size table's `sheets` object (library/constants/posterSizes.js), so a consumer
 * can call planPanels(SIZES[key].sheets); borderIn and joinFill belong to the renderer, not the size.
 * Lengths are inches unless a name says px.
 */

/**
 * @param {{ sheetW:number, sheetH:number, count?:number, direction?:'vertical'|'horizontal', joinIn?:number,
 *           borderIn?:number, joinFill?:'glue'|'bleed' }} o
 * @returns the plan: finished size, and per sheet where it sits in the finished poster, its join band (sheet
 *   coordinates, null on the first sheet), whether its trailing edge is trimmed, and its CONTENT box (sheet
 *   coordinates): the outer border on the poster's outer edges, the join band on a joined leading edge, and
 *   nothing on a trimmed trailing edge (that edge lies over the next sheet's join band).
 */
export function planPanels(o) {
  const sheetW = +o.sheetW, sheetH = +o.sheetH
  const count = Math.max(1, Math.round(+o.count || 1))
  const direction = o.direction === 'horizontal' ? 'horizontal' : 'vertical'
  const joinIn = count > 1 ? Math.max(0, +o.joinIn || 0) : 0
  const borderIn = Math.max(0, +o.borderIn || 0)
  const joinFill = o.joinFill === 'bleed' ? 'bleed' : 'glue'
  if (!(sheetW > 0 && sheetH > 0)) throw new Error('planPanels: sheetW and sheetH must be positive inches')
  const along = direction === 'vertical' ? sheetH : sheetW
  if (joinIn >= along) throw new Error('planPanels: joinIn must be smaller than the sheet along the join')
  const H = direction === 'vertical'
  const sheets = []
  for (let s = 0; s < count; s++) {
    const first = s === 0, last = s === count - 1
    const off = s * (along - joinIn)                       // this sheet's leading edge in the finished poster
    const at = H ? { x: 0, y: off } : { x: off, y: 0 }
    const band = first ? null : H ? { x: 0, y: 0, w: sheetW, h: joinIn } : { x: 0, y: 0, w: joinIn, h: sheetH }
    const lead = first ? borderIn : joinIn, trail = last ? borderIn : 0
    const content = H
      ? { x0: borderIn, y0: lead, x1: sheetW - borderIn, y1: sheetH - trail }
      : { x0: lead, y0: borderIn, x1: sheetW - trail, y1: sheetH - borderIn }
    sheets.push({ s, first, last, at, band, trimmed: !last && count > 1, content })
  }
  const finished = H
    ? { w: sheetW, h: count * sheetH - (count - 1) * joinIn }
    : { w: count * sheetW - (count - 1) * joinIn, h: sheetH }
  return { sheetW, sheetH, count, direction, joinIn, borderIn, joinFill, finished, sheets }
}

/**
 * The part of the FINISHED poster that sheet s (0-based: 0 … count − 1) prints, and where on the sheet it goes (inches). With 'bleed' the
 * whole sheet is poster (its band repeats what the sheet before shows); with 'glue' the band is left out.
 * A renderer draws the finished poster once and places this rect of it on page s (the per-sheet PDF page).
 */
export function sliceFor(plan, s) {
  const sh = plan.sheets[s]
  if (!sh) throw new Error(`sliceFor: no sheet ${s}; sheets are 0-based, 0..${plan.count - 1}`)
  const skip = plan.joinFill === 'glue' && sh.band ? plan.joinIn : 0
  const V = plan.direction === 'vertical'
  return V
    ? { x: sh.at.x, y: sh.at.y + skip, w: plan.sheetW, h: plan.sheetH - skip, sheetX: 0, sheetY: skip }
    : { x: sh.at.x + skip, y: sh.at.y, w: plan.sheetW - skip, h: plan.sheetH, sheetX: skip, sheetY: 0 }
}

/**
 * The sheets laid out for a SCREEN preview, pulled apart by gapIn so the joins show: stacked (vertical) or side
 * by side (horizontal), in px at pxPerIn. `step` is the distance between sheet origins in inches.
 */
export function screenLayout(plan, { gapIn = 0.75, pxPerIn = 96 } = {}) {
  const V = plan.direction === 'vertical'
  const step = (V ? plan.sheetH : plan.sheetW) + gapIn
  const sheets = plan.sheets.map((sh) => V
    ? { s: sh.s, x: 0, y: sh.s * step * pxPerIn, w: plan.sheetW * pxPerIn, h: plan.sheetH * pxPerIn }
    : { s: sh.s, x: sh.s * step * pxPerIn, y: 0, w: plan.sheetW * pxPerIn, h: plan.sheetH * pxPerIn })
  const n = plan.count
  return {
    step, gapIn, pxPerIn, sheets,
    worldW: (V ? plan.sheetW : n * plan.sheetW + (n - 1) * gapIn) * pxPerIn,
    worldH: (V ? n * plan.sheetH + (n - 1) * gapIn : plan.sheetH) * pxPerIn,
  }
}

// A left-pointing arrow as a shape: vertical text rotates arrow CHARACTERS, never an inline SVG.
export const LEFT_ARROW = '<svg viewBox="0 0 10 10" width="0.8em" height="0.8em" style="vertical-align:middle"><path d="M1 5 9 1v8z" fill="currentColor"/></svg>'

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const inch = (v) => v.toFixed(3) + 'in'

/**
 * The join marks for sheet s (0-based), as HTML to place inside the sheet's own positioned box (class "sheet"):
 *   before — the join band ("glue here ▲ s / N"), drawn first so content paints over nothing it needs;
 *   after  — the trim line on a trimmed edge, and the "s / N" sheet tag in the corner.
 * `screen: true` always draws the red band (a preview shows how the sheets join, even for a bleed print).
 * glueHere: the translated "glue here" (default English; the Bless wall passes wall.glueHere).
 */
export function panelChromeHtml(plan, s, { glueHere = 'glue here', screen = false } = {}) {
  const sh = plan.sheets[s], N = plan.count, V = plan.direction === 'vertical'
  let before = ''
  if (sh.band) {
    // The arrow points at the sheet laid over this band: the one above, or (side by side) the one to its left.
    // (In the side-by-side band the label runs top to bottom, which would turn a ◀ character on its side; the
    // arrow is drawn instead, so it points left in every browser.)
    const label = V ? `${esc(glueHere)} ▲ ${s} / ${N}`
      : `${esc(glueHere)} ${LEFT_ARROW} <bdi dir="ltr">${s} / ${N}</bdi>`
    if (plan.joinFill === 'glue' || screen) {
      before = V
        ? `<div class="glue" style="top:0;height:${inch(plan.joinIn)}">${label}</div>`
        : `<div class="glue glue-h" style="left:0;width:${inch(plan.joinIn)}">${label}</div>`
    } else {
      before = `<div class="glue-guide${V ? '' : ' glue-h'}"><span>${label}</span></div>`
    }
  }
  const trim = sh.trimmed ? (V ? '<div class="trim"></div>' : '<div class="trim trim-h"></div>') : ''
  return { before, after: `${trim}<div class="tag">${s + 1} / ${N}</div>` }
}

/**
 * The CSS for panelChromeHtml's marks. The vertical rules are the Bless poster's own, byte for byte (its print
 * is pinned by check:wall-wysiwyg and check:panel-sheets). The label and tag scale with the join band (the
 * border on a single sheet).
 */
export function panelCss(plan) {
  const j = plan.joinIn || plan.borderIn, b = plan.borderIn
  let css = `.glue{position:absolute;left:0;width:100%;border-bottom:.02in dashed #b00;display:flex;align-items:center;justify-content:center;font:700 ${inch(Math.min(0.5, j * 0.08))} sans-serif;color:#b00;background:rgba(176,0,0,.035);letter-spacing:.05em;text-transform:uppercase}
.trim{position:absolute;left:0;bottom:0;width:100%;border-bottom:.02in solid #999}
.tag{position:absolute;right:${inch(Math.max(0.15, b * 0.1))};top:${inch(Math.max(0.1, b * 0.08))};font:600 ${inch(Math.max(0.12, b * 0.035))} sans-serif;color:#aaa}`
  if (plan.direction === 'horizontal') {
    css += `
.glue.glue-h{top:0;height:100%;width:auto;border-bottom:0;border-right:.02in dashed #b00;writing-mode:vertical-rl}
.trim.trim-h{left:auto;right:0;top:0;bottom:auto;width:0;height:100%;border-bottom:0;border-right:.02in solid #999}`
  }
  if (plan.joinFill === 'bleed') {
    css += `
.glue-guide{position:absolute;left:0;top:0;width:100%;height:${inch(plan.joinIn)};border-bottom:.01in dashed #b00;pointer-events:none}
.glue-guide.glue-h{width:${inch(plan.joinIn)};height:100%;border-bottom:0;border-right:.01in dashed #b00}
.glue-guide span{position:absolute;left:${inch(0.15)};top:${inch(0.1)};font:600 ${inch(Math.max(0.12, j * 0.02))} sans-serif;color:#b00;background:rgba(255,255,255,.85);padding:0 .06in;letter-spacing:.04em;text-transform:uppercase}`
  }
  return css
}
