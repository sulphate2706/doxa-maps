/**
 * wallLod.js — level of detail for the Wall of People Groups, the way a map does it.
 *
 * ★ WHY. The wall gave every one of its ~2,100 card images its full-size href at once, so the
 * browser fetched and DECODED every photo even when the whole 4000×3000 wall was on screen and each
 * photo was a few pixels wide. Decoded bitmaps are uncompressed, so that was the bulk of the ~1.4 GB
 * measured in testing. A map never does this: it draws light tiles when zoomed out and loads detail
 * only for what is in view. Same rule here:
 *   - zoomed out (a card smaller than `minPx` on screen): NO photos, just the light image slot;
 *   - zoomed in: HD photos only for the cards in view (plus a margin), and they are UNLOADED again
 *     when they leave the view;
 *   - a hard `cap` so no zoom level can load more than that many at once.
 * Pure geometry, no DOM: the component asks which card indices should hold an HD image and
 * reconciles the difference. That also makes it testable in node.
 */

/**
 * @param {{k:number,x:number,y:number}} t       the d3 zoom transform (viewBox units)
 * @param {{width:number,height:number}} view    the viewBox size (the wall canvas)
 * @param {number} displayScale                  CSS pixels per viewBox unit (svg meet scale)
 * @param {{n:number,cols:number,cw:number,ch:number,spacing:number,vSpacing:number}} grid
 * @param {{minPx?:number,marginCards?:number,cap?:number}} [opts]
 * @returns {{mode:'placeholder'|'hd', cardPx:number, visible:number[]}}
 */
export function lodPlan(t, view, displayScale, grid, { minPx = 48, marginCards = 1, cap = 300 } = {}) {
  const cardPx = grid.cw * t.k * displayScale
  if (!(cardPx >= minPx)) return { mode: 'placeholder', cardPx, visible: [] }
  // the part of the wall canvas the viewport currently shows, in wall coordinates
  const x0 = (0 - t.x) / t.k, x1 = (view.width - t.x) / t.k
  const y0 = (0 - t.y) / t.k, y1 = (view.height - t.y) / t.k
  const stepX = grid.cw + grid.spacing, stepY = grid.ch + grid.vSpacing
  const rows = Math.ceil(grid.n / grid.cols)
  const c0 = Math.max(0, Math.floor((x0 - grid.spacing) / stepX) - marginCards)
  const c1 = Math.min(grid.cols - 1, Math.floor((x1 - grid.spacing) / stepX) + marginCards)
  const r0 = Math.max(0, Math.floor((y0 - grid.vSpacing) / stepY) - marginCards)
  const r1 = Math.min(rows - 1, Math.floor((y1 - grid.vSpacing) / stepY) + marginCards)
  const visible = []
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * grid.cols + c
      if (i < grid.n) visible.push(i)
    }
  }
  // the cap is a safety net: if the view somehow holds more cards than that, stay light
  if (visible.length > cap) return { mode: 'placeholder', cardPx, visible: [] }
  return { mode: 'hd', cardPx, visible }
}

/** The grid the wall lays out (renderCards), so lodPlan and the renderer can never disagree. */
export function wallGrid(n, canvasWidth, canvasHeight, spacing, vSpacing) {
  const cols = Math.ceil(Math.sqrt(n * (canvasWidth / canvasHeight)))
  const rows = Math.ceil(n / cols)
  const availableWidth = canvasWidth - spacing * (cols + 1)
  const availableHeight = canvasHeight - spacing * (rows + 1)
  const cw = Math.min(availableWidth / cols, (availableHeight / rows) * 0.7)
  return { n, cols, rows, cw, ch: cw / 0.7, spacing, vSpacing }
}
