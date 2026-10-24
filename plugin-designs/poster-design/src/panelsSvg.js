/**
 * panelsSvg.js: a poster printed on several sheets, drawn as the sheets pulled apart, each join a red glue
 * band, as one SVG image for a poster card's thumbnail.
 *
 * The geometry is the shared panel plan (library/components/poster/panelSheets.js planPanels + screenLayout):
 * the same sheets, joins and content boxes the print uses. Inside each sheet's content box sit rows of cards,
 * the way the Bless wall fills its 5 × 8 ft panels: a banner on the first sheet, a footer on the last, and
 * card rows that never cross a join. The cards are a LAYOUT (blocks, no words): the Bless wall draws its real
 * cards in its own plugin, which a library-only gallery cannot import.
 */
import { planPanels, screenLayout } from '@map/components/poster/panelSheets.js'

const PAPER = '#f7f4ec'
const INK = '#3b463d'
const ACCENT = '#6B4A78'          // the Bless wall's purple
const PHOTO = '#e9e3d4'
const LINE = '#c9c3b3'

/**
 * @param {{ sheetW, sheetH, count, direction, joinIn }} sheets  a size's `sheets` from the shared ladder
 * @param {{ borderIn?: number, gapIn?: number, cols?: number }} o
 * @returns {string} an image URL (a data: URL of an SVG), drawn in inches
 */
export function panelsSvgUrl(sheets, { borderIn = sheets.joinIn || 2, gapIn = 0.75, cols = 14 } = {}) {
  const plan = planPanels({ ...sheets, borderIn, joinFill: 'glue' })
  const L = screenLayout(plan, { gapIn, pxPerIn: 1 })
  const W = L.worldW, H = L.worldH
  const s1 = Math.min(plan.sheetW, plan.sheetH)
  const stroke = s1 / 200
  let out = ''
  for (const sh of plan.sheets) {
    const at = L.sheets[sh.s]
    const ox = at.x, oy = at.y
    out += `<rect x="${ox}" y="${oy}" width="${plan.sheetW}" height="${plan.sheetH}" fill="${PAPER}" stroke="${LINE}" stroke-width="${stroke}"/>`
    const c = sh.content
    let top = oy + c.y0, bottom = oy + c.y1
    const cw0 = c.x1 - c.x0
    if (sh.first) {                                   // the banner: a title band and the prayer-themes table
      const bh = cw0 * 0.075, th = cw0 * 0.17
      out += `<rect x="${ox + c.x0}" y="${top}" width="${cw0}" height="${bh}" fill="${INK}"/>`
      out += `<rect x="${ox + c.x0}" y="${top + bh + cw0 * 0.01}" width="${cw0}" height="${th}" fill="none" stroke="${ACCENT}" stroke-width="${stroke * 2}"/>`
      top += bh + th + cw0 * 0.025
    }
    if (sh.last) {                                    // the footer: the blessing and the closing line
      const fh = cw0 * 0.09
      out += `<rect x="${ox + c.x0}" y="${bottom - fh}" width="${cw0}" height="${fh}" fill="${ACCENT}" opacity=".85"/>`
      bottom -= fh + cw0 * 0.015
    }
    // rows of portrait cards (0.8 aspect), centred in the band, never crossing a join
    const cw = cw0 / cols, ch = cw / 0.8
    const rows = Math.max(0, Math.floor((bottom - top) / ch))
    const y0 = top + Math.max(0, (bottom - top) - rows * ch) / 2
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const x = ox + c.x0 + k * cw, y = y0 + r * ch
        out += `<rect x="${x + cw * 0.08}" y="${y + ch * 0.06}" width="${cw * 0.84}" height="${cw * 0.84}" fill="${PHOTO}"/>`
        out += `<rect x="${x + cw * 0.15}" y="${y + ch * 0.06 + cw * 0.9}" width="${cw * 0.7}" height="${ch * 0.06}" fill="${INK}" opacity=".7"/>`
      }
    }
    if (sh.band) {                                    // the glue band: red, dashed at its edge, as PanelSheets draws it
      const b = sh.band
      const ex = plan.direction === 'vertical' ? `x1="${ox}" y1="${oy + b.h}" x2="${ox + b.w}" y2="${oy + b.h}"` : `x1="${ox + b.w}" y1="${oy}" x2="${ox + b.w}" y2="${oy + b.h}"`
      out += `<rect x="${ox + b.x}" y="${oy + b.y}" width="${b.w}" height="${b.h}" fill="rgba(176,0,0,.14)"/>`
      out += `<line ${ex} stroke="#b00" stroke-width="${stroke * 1.5}" stroke-dasharray="${stroke * 6} ${stroke * 4}"/>`
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${(W * 4).toFixed(0)}" height="${(H * 4).toFixed(0)}">${out}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
