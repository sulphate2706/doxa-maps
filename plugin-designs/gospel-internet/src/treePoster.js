/**
 * treePoster.js — the language tree as a PRINTABLE POSTER: one vector SVG, 36 x 36 inches by default,
 * every family, branch, language and dialect in its colour, and every label placed so that NO TWO
 * LABELS OVERLAP (2026-09-27: a 3 ft x 3 ft poster with no overlaps).
 *
 * VECTOR, NOT PIXELS: an SVG prints sharp at any size, so a 3-foot sheet needs no giant canvas (a WebGL
 * or 2D canvas that large exceeds what many browsers allow). The map engine's own label placement is
 * per-screen; a poster needs its placement solved ONCE for the sheet, which is what this does.
 *
 * LABELS: placed greedily in priority order (families, then languages with the most groups, then
 * branches, then dialects), each trying below / above / right / left of its dot, and kept only where it
 * overlaps no placed label and no dot. What cannot be placed is COUNTED and said on the sheet, never
 * drawn over another. Text width is estimated per character (0.56 em, a conservative Latin average); a
 * margin pads every box so the estimate errs toward space.
 *
 * Pure: no DOM, no Vue. Returns { svg, stats }. The board prints it through library printInPlace.
 */
const UNIT = 72                          // SVG user units per inch (1 pt)
const COL = { g: '#1f8f5f', y: '#e3a82b', r: '#b42318' }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Web Mercator x/y (0..1) of a node's lng/lat: the space the tree was laid out in, undistorted. */
function merc([lng, lat]) {
  const s = Math.sin(lat * Math.PI / 180)
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]
}

/**
 * @param {object} ix     indexTree(doc) (+ .nodes with c, lv, n, R, st, inh)
 * @param {Map}    scope  treeScope(ix, rows): per node { col, m, g, y, r, groups }
 * @param {object} o      { sizeIn=36, title, subtitle, legend:[{col,text}], footer, omittedText(n) }
 */
export function buildTreePoster(ixIn, scope, o = {}) {
  let ix = ixIn
  const sizeIn = o.sizeIn || 36
  const W = sizeIn * UNIT
  const margin = 1.2 * UNIT, head = 2.4 * UNIT, foot = 2.2 * UNIT
  const area = { x: margin, y: margin + head, w: W - 2 * margin, h: W - 2 * margin - head - foot }

  // The POSTER layout (pc, pR: wider leaf spacing, from build-language-tree.mjs) when the tree carries it,
  // else the screen one. A sheet cannot zoom, so it needs the layout made for one fixed scale.
  // The poster draws LANGUAGES, not dialects, by default: its layout gives dialects no slot (see the builder).
  const drawn = ix.nodes.filter((n) => Array.isArray(n.pc))
  const usePoster = drawn.length > 0
  if (usePoster) ix = { ...ix, nodes: drawn }
  const xy = (n) => (usePoster ? n.pc : merc(n.c))
  const rad = (n) => (usePoster ? (n.pR || 0) : (n.R || 0))
  // fit the tapestry (dishes included) into the drawing area
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const n of ix.nodes) {
    const [x, y] = xy(n), R = n.p ? 0 : rad(n)
    x0 = Math.min(x0, x - R); x1 = Math.max(x1, x + R); y0 = Math.min(y0, y - R); y1 = Math.max(y1, y + R)
  }
  const k = Math.min(area.w / (x1 - x0), area.h / (y1 - y0))
  const ox = area.x + (area.w - (x1 - x0) * k) / 2, oy = area.y + (area.h - (y1 - y0) * k) / 2
  const P = (n) => { const [x, y] = xy(n); return [ox + (x - x0) * k, oy + (y - y0) * k] }

  const DOT = { f: 5, l: 2.4, b: 1.4, d: 1.1 }
  const FONT = { f: 15, l: 5.2, b: 4.2, d: 3.6 }       // points; dialects ~1.3 mm, still legible on paper
  const pos = new Map(ix.nodes.map((n) => [n.id, P(n)]))

  // ── label placement with a spatial grid of occupied boxes ─────────────────────────────────────────
  const CELL = 24
  const grid = new Map()
  const boxes = []
  const keyOf = (i, j) => i + ',' + j
  const cellsOf = (b) => { const out = []; for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) out.push(keyOf(i, j)); return out }
  const hits = (b) => { for (const c of cellsOf(b)) for (const q of grid.get(c) || []) if (b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]) return true; return false }
  const occupy = (b) => { boxes.push(b); for (const c of cellsOf(b)) { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(b) } }
  // dots are obstacles too: a label never covers another circle
  for (const n of ix.nodes) { const [x, y] = pos.get(n.id), r = (DOT[n.lv] || 1) + 0.4; occupy([x - r, y - r, x + r, y + r]) }

  const order = ix.nodes.filter((n) => n.n).map((n) => {
    const s = scope.get(n.id) || {}
    const rank = !n.p ? 0 : n.lv === 'l' ? 1 : n.lv === 'b' ? 2 : 3
    return { n, rank, groups: s.groups || 0 }
  }).sort((a, b) => a.rank - b.rank || b.groups - a.groups || a.n.n.localeCompare(b.n.n))

  const labels = []
  const dropped = { f: 0, b: 0, l: 0, d: 0 }
  const kids = ix.kids || new Map()
  // a label along a direction, as a chain of small boxes (so the axis-aligned grid can test it)
  const chain = (sx, sy, cos, sin, w, fs) => {
    const out = [], step = fs * 0.9
    for (let t = 0; t <= w; t += step) { const cx = sx + cos * (t + step / 2), cy = sy + sin * (t + step / 2), r = fs * 0.55; out.push([cx - r, cy - r, cx + r, cy + r]) }
    return out
  }
  for (const { n } of order) {
    const lv = !n.p ? 'f' : n.lv
    const fs = FONT[lv], w = String(n.n).length * fs * 0.56 + 1, h = fs * 1.15
    const [x, y] = pos.get(n.id), d = (DOT[lv] || 1) + 1
    let placed = null
    // 1. a FAMILY's name sits on top of its dish, outside its crowded tree
    if (lv === 'f') {
      const top = y - rad(n) * k - 6
      const b = [x - w / 2 - 0.5, top - fs, x + w / 2 + 0.5, top + fs * 0.25]
      if (!hits(b)) placed = { boxes: [b], anchor: 'middle', tx: x, ty: top, rot: 0 }
    }
    // 2. a LEAF's name runs outward along its branch, like a spoke (the radial-tree convention)
    if (!placed && n.p && !(kids.get(n.id) || []).length) {
      const [px, py] = pos.get(n.p)
      const L = Math.hypot(x - px, y - py) || 1, cos = (x - px) / L, sin = (y - py) / L
      const sx = x + cos * d, sy = y + sin * d
      const bs = chain(sx, sy, cos, sin, w, fs)
      if (!bs.some(hits)) {
        let deg = Math.atan2(sin, cos) * 180 / Math.PI
        const flip = cos < 0
        if (flip) deg += 180
        placed = { boxes: bs, anchor: flip ? 'end' : 'start', tx: sx, ty: sy, rot: deg, dy: fs * 0.35 }
      }
    }
    // 3. otherwise below / above / right / left of the dot
    if (!placed) {
      const tries = [
        [x - w / 2, y + d, 'middle', x, y + d + fs * 0.9],
        [x - w / 2, y - d - h, 'middle', x, y - d - fs * 0.25],
        [x + d, y - h / 2, 'start', x + d, y + fs * 0.35],
        [x - d - w, y - h / 2, 'end', x - d, y + fs * 0.35],
      ]
      for (const [bx, by, anchor, tx, ty] of tries) {
        const b = [bx - 0.5, by - 0.5, bx + w + 0.5, by + h + 0.5]
        if (!hits(b)) { placed = { boxes: [b], anchor, tx, ty, rot: 0 }; break }
      }
    }
    if (!placed) { dropped[lv]++; continue }
    placed.boxes.forEach(occupy)
    labels.push({ lv, text: n.n, x: placed.tx, y: placed.ty, anchor: placed.anchor, fs, rot: placed.rot, dy: placed.dy || 0,
      m: (scope.get(n.id) || {}).m, boxes: placed.boxes })
  }

  // ── the drawing ───────────────────────────────────────────────────────────────────────────────────
  const parts = []
  parts.push(`<rect x="0" y="0" width="${W}" height="${W}" fill="#f3f3f1"/>`)
  for (const n of ix.nodes) if (!n.p) {
    const [x, y] = pos.get(n.id)
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(rad(n) * k).toFixed(1)}" fill="#ffffff" fill-opacity="0.7" stroke="#d1d4cd" stroke-width="0.8"/>`)
  }
  const links = []
  for (const n of ix.nodes) if (n.p) {
    const [a, b] = pos.get(n.p), [c, d] = pos.get(n.id)
    links.push(`M${a.toFixed(1)} ${b.toFixed(1)}L${c.toFixed(1)} ${d.toFixed(1)}`)
  }
  parts.push(`<path d="${links.join('')}" stroke="#8d968e" stroke-width="0.35" stroke-opacity="0.7" fill="none"/>`)
  for (const n of ix.nodes) {
    const [x, y] = pos.get(n.id), s = scope.get(n.id) || {}
    const col = COL[s.col] || '#9aa2ad', lv = !n.p ? 'f' : n.lv
    const op = s.m === 0 ? 0.2 : n.inh ? 0.5 : 1
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${DOT[lv] || 1}" fill="${col}" fill-opacity="${op}" stroke="#fff" stroke-width="${lv === 'f' ? 1 : 0.3}"/>`)
  }
  for (const l of labels) {
    const weight = l.lv === 'f' ? 700 : 400, fill = l.lv === 'b' || l.lv === 'd' ? '#6d766e' : '#3b463d'
    const rot = l.rot ? ` transform="rotate(${l.rot.toFixed(1)} ${l.x.toFixed(1)} ${l.y.toFixed(1)})" dy="${l.dy.toFixed(1)}"` : ''
    parts.push(`<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}"${rot} font-size="${l.fs}" font-weight="${weight}" text-anchor="${l.anchor}" fill="${fill}"${l.m === 0 ? ' fill-opacity="0.45"' : ''}>${esc(l.text)}</text>`)
  }
  // title, legend, footer
  const omitted = dropped.f + dropped.b + dropped.l + dropped.d
  parts.push(`<text x="${margin}" y="${margin + 40}" font-size="44" font-weight="700" fill="#3b463d">${esc(o.title || '')}</text>`)
  parts.push(`<text x="${margin}" y="${margin + 80}" font-size="20" fill="#6d766e">${esc(o.subtitle || '')}</text>`)
  let lx = margin
  for (const it of o.legend || []) {
    parts.push(`<circle cx="${lx + 9}" cy="${margin + 122}" r="9" fill="${it.col}"/><text x="${lx + 26}" y="${margin + 129}" font-size="20" fill="#3b463d">${esc(it.text)}</text>`)
    lx += 60 + String(it.text).length * 11
  }
  const fy = W - margin - foot + 50
  for (const [i, line] of [...(o.footer || []), omitted && o.omittedText ? o.omittedText(omitted) : ''].filter(Boolean).entries()) {
    parts.push(`<text x="${margin}" y="${fy + i * 26}" font-size="16" fill="#6d766e">${esc(line)}</text>`)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sizeIn}in" height="${sizeIn}in" viewBox="0 0 ${W} ${W}" font-family="'Noto Sans','Roboto','Segoe UI',Arial,sans-serif">${parts.join('')}</svg>`
  return { svg, stats: { nodes: ix.nodes.length, labels: labels.length, dropped, omitted, labelBoxes: labels.map((l) => l.boxes), sizeIn } }
}

/** The print page: one sheet of exactly the poster's size, no margins, nothing but the poster. */
export function posterPrintHtml(svg, sizeIn = 36, title = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:${sizeIn}in ${sizeIn}in;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${sizeIn}in;height:${sizeIn}in}</style></head><body>${svg}</body></html>`
}
