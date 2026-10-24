/**
 * layoutSvg.js: the LAYOUT of the 3 × 3 country poster (a header band, the map, the names down both sides,
 * a table beneath, and the bold scripture footer), drawn at any finished size as an SVG image.
 *
 * The Sizes tab shows how each ladder size prints before the renderer draws that size for real, so this is
 * a layout, not a poster: blocks in the poster's own colours, no words (nothing to translate, nothing that
 * reads as real data). Units are INCHES (the viewBox is the finished w × h), so PanelSheets can slice it
 * across sheets exactly as it slices a real poster.
 */
const PAPER = '#f7f4ec'
const INK = '#3b463d'
const LINE = '#c9c3b3'
const LAND = '#dcd3ba'
const SEA = '#e6eef0'
const ACCENT = '#92b195'

/** @returns {string} an image URL (a data: URL of an SVG) of the layout at w × h inches. */
export function layoutSvgUrl(w, h) {
  const m = Math.min(w, h) * 0.05                  // outer margin
  const headH = h * 0.09
  const footH = h * 0.08
  const bodyTop = m + headH + m * 0.6
  const bodyBottom = h - m - footH - m * 0.6
  const tableH = (bodyBottom - bodyTop) * 0.22
  const mapBottom = bodyBottom - tableH - m * 0.5
  const colW = (w - 2 * m) * 0.22                  // a name column on each side of the map
  const mapX = m + colW + m * 0.4
  const mapW = w - 2 * mapX
  const lineGap = Math.max(h / 80, 0.35)
  const nameLines = (x) => {
    let out = ''
    for (let y = bodyTop + lineGap; y < mapBottom - lineGap / 2; y += lineGap) {
      out += `<rect x="${x.toFixed(2)}" y="${(y - lineGap * 0.28).toFixed(2)}" width="${(colW * (0.55 + 0.4 * ((y * 7) % 1))).toFixed(2)}" height="${(lineGap * 0.4).toFixed(2)}" fill="${LINE}"/>`
    }
    return out
  }
  let table = ''
  const rows = 4
  for (let r = 0; r <= rows; r++) {
    const y = mapBottom + m * 0.5 + (tableH * r) / rows
    table += `<line x1="${m}" y1="${y.toFixed(2)}" x2="${(w - m).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${LINE}" stroke-width="${(lineGap * 0.12).toFixed(3)}"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`
    + `<rect width="${w}" height="${h}" fill="${PAPER}"/>`
    + `<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${headH}" rx="${(headH * 0.12).toFixed(2)}" fill="${INK}"/>`
    + `<rect x="${(m + (w - 2 * m) * 0.25).toFixed(2)}" y="${(m + headH * 0.38).toFixed(2)}" width="${((w - 2 * m) * 0.5).toFixed(2)}" height="${(headH * 0.24).toFixed(2)}" fill="${PAPER}" opacity=".85"/>`
    + `<rect x="${mapX.toFixed(2)}" y="${bodyTop.toFixed(2)}" width="${mapW.toFixed(2)}" height="${(mapBottom - bodyTop).toFixed(2)}" fill="${SEA}"/>`
    + `<ellipse cx="${(mapX + mapW * 0.5).toFixed(2)}" cy="${((bodyTop + mapBottom) / 2).toFixed(2)}" rx="${(mapW * 0.36).toFixed(2)}" ry="${((mapBottom - bodyTop) * 0.34).toFixed(2)}" fill="${LAND}"/>`
    + nameLines(m) + nameLines(w - m - colW)
    + table
    + `<rect x="${m}" y="${(h - m - footH).toFixed(2)}" width="${w - 2 * m}" height="${footH}" rx="${(footH * 0.12).toFixed(2)}" fill="${ACCENT}"/>`
    + `<rect x="${(m + (w - 2 * m) * 0.15).toFixed(2)}" y="${(h - m - footH * 0.62).toFixed(2)}" width="${((w - 2 * m) * 0.7).toFixed(2)}" height="${(footH * 0.24).toFixed(2)}" fill="${INK}" opacity=".8"/>`
    + `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
