/**
 * wallCanvas.js — the Wall of People Groups drawn on ONE <canvas> instead of an SVG of ~36,000 nodes.
 *
 * Measured before (main 16ff7e719, all 2,107 cards): 36,247 DOM nodes (36,214 SVG), a 0.5-1.6 s
 * long task on EVERY wheel tick, 41.7 s to zoom out to the whole wall, p95 350 ms frames when panning
 * it. The JS heap was only 8.3 MB: the cost was the SVG DOM being re-laid-out and re-painted per tick.
 * Here each frame draws only the cards in view, in world coordinates, with level of detail:
 *   · under ~12 px a card is a filled rectangle;
 *   · from ~40 px it gets its text;
 *   · from 48 px its photo (a capped, least-recently-used image cache).
 * Clicks are hit-tested by inverting the zoom transform (card → region).
 *
 * The same world as before (canvasWidth × canvasHeight, "meet"-fitted), the same grid (wallLod.wallGrid),
 * and the same d3 zoom behaviour (wheel, drag, dblclick), so the wall reads and moves as it did.
 * Nothing is written to window; destroy() releases every listener and image.
 */
import { wallD3 } from './wallD3.js'
import { wallGrid } from './wallLod.js'
import { blessingFor, wrapText } from './blessings.js'
import { lightPhoto, fullPhoto } from './photoUrl.js'
import { cardText, PAPER, NAME_INK, VERSE_INK, REF_INK, PHOTO_BG } from './blessPoster.js'

// The print's sans (blessPoster SANS), for the names and references drawn on the canvas.
const SANS = 'Lato, -apple-system, "Segoe UI", system-ui, Arial, sans-serif'

// 'rtl' when a string's first strong character is Hebrew/Arabic-script, else 'ltr' (canvas has no dir="auto").
const RTL_FIRST = /^[^A-Za-z\u00C0-\u024F\u0370-\u052F\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]*[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
export const textDir = (s) => (RTL_FIRST.test(String(s || '')) ? 'rtl' : 'ltr')

const ICON = {
  heart: 'M12 20.5s-7.2-4.4-9.2-8.8C1.3 8.3 3.2 4.6 6.7 4.6c2 0 3.5 1.1 4.3 2.4.8-1.3 2.3-2.4 4.3-2.4 3.5 0 5.4 3.7 3.9 7.1-2 4.4-9.2 8.8-9.2 8.8z',
  comment: 'M4 4.5h16v11.5H9.5L4 20.5z',
  plane: 'M21 3.5 3 10.8l7 2.7 2.7 7 8.3-17z',
}
// Where a group's name links: its prayer page on pray.doxa.life (the live data has a slug), else its
// Joshua Project page (the CSV data has a PeopleID3), else nowhere.
export function groupLink(g) {
  if (g && g.slug) return `https://pray.doxa.life/${encodeURIComponent(g.slug)}?source=doxalife`
  const id = g && (g.peopleID3 || g.PeopleID3)
  return id && String(id).trim() ? `https://joshuaproject.net/people_groups/${String(id).trim()}` : ''
}
const TEXT_PX = 40, IMG_PX = 48, RECT_PX = 12, IMG_CACHE = 400, IMG_PARALLEL = 12
// A loaded photo is kept at THUMB_PX on its long side, never larger (G7, measured on the live list: 77 of the
// photos are 1024 × 1024, 4 MB each decoded, and drawImage used to downscale every one of them on every frame).
// The print frame loads the originals itself. MEASURE_PER_FRAME caps the cards whose text is first measured
// in one frame, so zooming into ~800 cards spreads that work instead of one long task.
const THUMB_PX = 320, MEASURE_PER_FRAME = 150
// A photo's pixel size, for an <img> (natural*) or a thumbnail canvas / ImageBitmap (width/height).
const pw = (im) => im.naturalWidth || im.width, ph = (im) => im.naturalHeight || im.height

export class WallCanvas {
  /**
   * host: the element to draw into. opts: { worldW, worldH, spacing, vSpacing, labels(key, params)→string,
   * prayCount(group)→number, onPray(group), onComments(group), onShare(group) }
   */
  constructor(host, opts) {
    this.host = host
    this.o = opts
    this.groups = []
    this.mode = 'bless'
    this.k0 = 1; this.ox = 0; this.oy = 0            // "meet" fit of the world into the canvas
    this.t = { k: 1, x: 0, y: 0 }                     // d3 zoom transform (in world-fit space)
    this.images = new Map()                           // url → { img, ok, used } (img: the photo or its thumbnail)
    // Counters for the performance probes (read through the Vue host hook): photos kept as thumbnails,
    // how many took the canvas fallback, and cards whose text was measured.
    // cardPx: one card's on-screen width at the last frame drawn, so a probe can read the zoom level.
    this.stats = { loaded: 0, thumbs: 0, thumbsFallback: 0, measured: 0, cardPx: 0 }
    this.loading = 0
    this.queue = []
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'wall-canvas-el'
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'
    // Focusable, with a name: a dialog opened from a click on the wall returns focus HERE on close
    // (a non-focusable canvas left focus on <body>), and the wall itself is reachable by keyboard.
    this.canvas.tabIndex = 0
    if (opts.label) this.canvas.setAttribute('aria-label', opts.label)
    this.canvas.setAttribute('role', 'img')
    host.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.icons = Object.fromEntries(Object.entries(ICON).map(([k, d]) => [k, new Path2D(d)]))
    const d3 = wallD3()
    // d3's transform lives in the canvas's own CSS px (d3.pointer on a <canvas> is element px, unlike the old
    // SVG, whose viewBox made it world units), so it is applied AFTER the "meet" fit: screen = t(fit(world)).
    // Multiplying it by the fit scale instead moved the wall by only k0 of the pointer (measured on
    // development 6e1a33534: a 200 px drag panned 34 px at 1440, a 120 × 200 px finger drag 14 × 23 px on a
    // phone), so the wall could barely be panned.
    // A ctrl-wheel is a trackpad pinch (or ctrl + mouse wheel): it zooms the wall. Filtering it out let the
    // browser zoom the whole page instead. Its step is capped, so one mouse notch is at most ~1.4×.
    this.zoom = d3.zoom().scaleExtent([0.1, 20])
      .filter((e) => (!e.ctrlKey || e.type === 'wheel') && !e.button)
      .wheelDelta((e) => {
        const d = -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002)
        return e.ctrlKey ? Math.max(-0.5, Math.min(0.5, d * 5)) : d
      })
      .constrain((t) => this.constrain(t))
      .on('zoom', (e) => { this.t = e.transform; this.request() })
    this.sel = d3.select(this.canvas).call(this.zoom).on('dblclick.zoom', null)
    this._click = (e) => this.onClick(e)
    this._move = (e) => this.onMove(e)
    this.canvas.addEventListener('click', this._click)
    this.canvas.addEventListener('mousemove', this._move)
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null
    this.ro?.observe(host)
    this.resize()
  }

  setWorld(worldW, worldH) { this.o.worldW = worldW; this.o.worldH = worldH; this.layout(); this.resize() }
  setGroups(groups) { this.groups = groups || []; this.layout(); this.request() }
  setMode(mode) { this.mode = mode; this.showPoster(); this.resize(); this.startView(96) }

  /**
   * BLESS = the poster, WYSIWYG: `sp` is blessPoster.screenPoster() for these groups, so the world is the
   * printed sheets (CSS px), the cards sit where they print and are sized by the print's own cardText, and
   * the title / chart / footer are the print's own HTML in a zoom-following overlay (pointer-events: none,
   * so the canvas keeps every click; links alone take the pointer).
   */
  setPoster(sp) {
    this.sp = sp
    this.textCache = new Map()
    this.estCache = new Map()   // the unmeasured line estimates (below text zoom, or awaiting measurement)
    if (!this.ov) {
      this.ov = document.createElement('div')
      this.ov.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none'
      if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative'
      this.host.appendChild(this.ov)
      this.ovRoot = this.ov.attachShadow ? this.ov.attachShadow({ mode: 'open' }) : this.ov
    }
    // The print CSS (its @page rule is ignored on screen), scoped by the shadow root. The overlay's sheets are
    // transparent: the canvas under them paints the paper and the cards (the print's paper colour would hide them). The overlay starts at
    // scale(0) and takes the zoom's transform on the next frame, so it never flashes at full print size.
    this.ovRoot.innerHTML = `<style>${sp.css}\n.ovw{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none}.ovw a{pointer-events:auto}.ovw .sheet{content-visibility:auto;background:none}</style>`
      + `<div class="ovw poster" style="width:${sp.worldW}px;height:${sp.worldH}px;transform:scale(0)">${sp.chromeHtml}</div>`
    this.ovw = this.ovRoot.querySelector('.ovw')
    this.showPoster(); this.resize()
  }
  get posterOn() { return this.mode === 'bless' && !!this.sp }
  showPoster() { if (this.ov) this.ov.style.display = this.posterOn ? '' : 'none' }
  get worldW() { return this.posterOn ? this.sp.worldW : this.o.worldW }
  get worldH() { return this.posterOn ? this.sp.worldH : this.o.worldH }
  /** See all of it: the identity transform is the whole world, "meet"-fitted. */
  fitAll() { this.sel.call(this.zoom.transform, wallD3().zoomIdentity) }

  layout() {
    const n = this.groups.length
    this.grid = n ? wallGrid(n, this.o.worldW, this.o.worldH, this.o.spacing, this.o.vSpacing) : null
  }

  resize() {
    const r = this.host.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.cssW = Math.max(1, r.width); this.cssH = Math.max(1, r.height)
    this.canvas.width = Math.round(this.cssW * dpr); this.canvas.height = Math.round(this.cssH * dpr)
    this.dpr = dpr
    // "meet": the whole world fits, centred (the SVG viewBox's preserveAspectRatio="xMidYMid meet").
    this.k0 = Math.min(this.cssW / this.worldW, this.cssH / this.worldH)
    this.ox = (this.cssW - this.worldW * this.k0) / 2
    this.oy = (this.cssH - this.worldH * this.k0) / 2
    this.request()
  }

  /** Screen px of one world unit, and world → screen: the "meet" fit first, then d3's transform (CSS px). */
  get scale() { return this.k0 * this.t.k }
  get tx() { return this.t.x + this.t.k * this.ox }
  get ty() { return this.t.y + this.t.k * this.oy }
  toScreen(x, y) { return [this.tx + x * this.scale, this.ty + y * this.scale] }
  toWorld(px, py) { return [(px - this.tx) / this.scale, (py - this.ty) / this.scale] }

  /**
   * Keep the wall findable: however far it is panned, it still covers the middle of the view (a zoomed-out
   * wall smaller than the view may move, but never off it). Without this a fast fling left an empty grey table.
   */
  constrain(t) {
    const W = this.worldW * this.k0, H = this.worldH * this.k0, cx = this.cssW / 2, cy = this.cssH / 2
    const x0 = t.x + t.k * this.ox, y0 = t.y + t.k * this.oy
    const dx = x0 > cx ? cx - x0 : x0 + t.k * W < cx ? cx - x0 - t.k * W : 0
    const dy = y0 > cy ? cy - y0 : y0 + t.k * H < cy ? cy - y0 - t.k * H : 0
    return dx || dy ? t.translate(dx / t.k, dy / t.k) : t   // d3's translate() is in pre-scale units
  }

  /** Open at a zoom where one card is `cardPx` wide (the old wall opened at ~96 px), world top-left in place. */
  startView(cardPx = 96) {
    if (this.posterOn) return this.fitAll()   // the poster opens whole: what you see is what prints
    if (!this.grid) return
    const k = Math.max(1, Math.min(20, cardPx / (this.grid.cw * this.k0)))
    this.sel.call(this.zoom.transform, wallD3().zoomIdentity.translate(this.ox * (1 - k), this.oy * (1 - k)).scale(k))
  }
  resetZoom() { this.sel.transition().duration(750).call(this.zoom.transform, wallD3().zoomIdentity) }

  request() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw() }) }

  cardRect(i) {
    const g = this.grid
    const col = i % g.cols, row = Math.floor(i / g.cols)
    return { x: col * (g.cw + g.spacing) + g.spacing, y: row * (g.ch + g.vSpacing) + g.vSpacing, w: g.cw, h: g.ch }
  }

  visibleRange() {
    const g = this.grid
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.cssW, this.cssH)
    const sx = g.cw + g.spacing, sy = g.ch + g.vSpacing, rows = Math.ceil(g.n / g.cols)
    return {
      c0: Math.max(0, Math.floor(x0 / sx) - 1), c1: Math.min(g.cols - 1, Math.floor(x1 / sx) + 1),
      r0: Math.max(0, Math.floor(y0 / sy) - 1), r1: Math.min(rows - 1, Math.floor(y1 / sy) + 1),
    }
  }

  draw() {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!this.grid) return
    const s = this.scale, tx = this.tx, ty = this.ty
    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * tx, this.dpr * ty)
    if (this.posterOn) return this.drawPoster(ctx, s, tx, ty)
    const cardPx = this.grid.cw * s
    this.stats.cardPx = Math.round(cardPx)
    const { c0, c1, r0, r1 } = this.visibleRange()
    const want = []
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.grid.cols + c
        if (i >= this.groups.length) break
        const R = this.cardRect(i)
        if (cardPx < RECT_PX) { ctx.fillStyle = '#e6e6e6'; ctx.fillRect(R.x, R.y, R.w, R.h); continue }
        this.drawCard(ctx, i, R, cardPx, want)
      }
    }
    if (want.length) this.load(want)
  }

  drawPoster(ctx, s, tx, ty) {
    const sp = this.sp
    // The overlay (title, chart, footer) follows the same transform as the canvas.
    if (this.ovw) this.ovw.style.transform = `translate(${tx}px,${ty}px) scale(${s})`
    // A grey table under white sheets (the wall's own background is near-white), and a 3 px drop edge
    // per sheet, drawn as an offset rect: shadowBlur ignores the transform and costs a blur per frame.
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#d4d4d4'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); ctx.restore()
    ctx.fillStyle = 'rgba(0,0,0,.16)'
    for (const R of sp.sheets) ctx.fillRect(R.x + 3 / s, R.y + 3 / s, R.w, R.h)
    ctx.fillStyle = PAPER
    for (const R of sp.sheets) ctx.fillRect(R.x, R.y, R.w, R.h)
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.cssW, this.cssH)
    const cardPx = (sp.cards[0]?.w || 0) * s, want = []
    this.stats.cardPx = Math.round(cardPx)
    this.measureBudget = MEASURE_PER_FRAME; this.measureMore = false
    for (const R of sp.cards) {
      if (R.x + R.w < x0 || R.x > x1 || R.y + R.h < y0 || R.y > y1) continue
      if (R.i >= this.groups.length) continue
      if (cardPx < RECT_PX) { ctx.fillStyle = PHOTO_BG; ctx.fillRect(R.x + R.w * 0.04, R.y + R.h * 0.04, R.w * 0.92, R.h * 0.92); continue }
      this.drawPrintCard(ctx, R, cardPx, want)
    }
    if (want.length) this.load(want)
    if (this.measureMore) this.request()   // the cards still waiting to be measured get the next frame
  }

  /** A card exactly as the print lays it out (blessPoster's .card CSS), sized by the same cardText(). */
  drawPrintCard(ctx, R, cardPx, want) {
    const g = this.groups[R.i], sp = this.sp, px = sp.pxPerIn, pt = px / 72
    const name = g.name || g.post_title || ''
    let T = this.textCache.get(R.i)
    const ct = T ? T.ct : cardText(sp.plan, name)
    const pad = ct.padIn * px, iw = R.w - 2 * pad, x = R.x + pad, cx = R.x + R.w / 2
    const nameFs = ct.name.pt * pt, vFs = ct.versePt * pt, rFs = ct.refPt * pt
    // Below TEXT_PX no text is drawn, so nothing is measured: the photo box uses an estimate of the lines
    // (a card is under 40 px there; it settles to the measured layout once text shows). At text zoom, at
    // most MEASURE_PER_FRAME new cards are measured per frame; the rest wait a frame with the estimate.
    if (!T && (cardPx < TEXT_PX || this.measureBudget <= 0)) {
      if (cardPx >= TEXT_PX) this.measureMore = true
      T = this.estCache.get(R.i)
      if (!T) {
        const est = (text, fs) => Math.max(1, Math.ceil((String(text).length * 0.5 * fs) / Math.max(1, iw)))
        T = { ct, estimate: true, nameLines: Array(ct.name.wrap ? ct.name.lines : 1).fill(''),
          verse: ct.readable ? { lines: Array(est(blessingFor(R.i).text, vFs)).fill(''), ref: '' } : null }
        this.estCache.set(R.i, T)
      }
    } else if (!T) {
      this.measureBudget--; this.stats.measured++
      // Line breaks measured once per card (the fonts are the print's), then cached.
      ctx.font = `700 ${nameFs}px ${SANS}`
      const nameLines = ct.name.wrap ? this.breakLines(ctx, name, iw, ct.name.lines) : [name]
      let verse = null
      if (ct.readable) {
        const b = blessingFor(R.i)
        ctx.font = `italic ${vFs}px Georgia, "Times New Roman", serif`
        verse = { lines: this.breakLines(ctx, b.text, iw, 99), ref: b.ref }
      }
      T = { ct, nameLines, verse }; this.textCache.set(R.i, T)
    }
    const nameH = T.nameLines.length * nameFs * ct.nameLine
    const verseH = T.verse ? T.verse.lines.length * vFs * ct.verseLine + ct.refGapPt * pt + rFs * 1.2 : 0
    const m = ct.imgMarginIn * px
    const imgY = R.y + pad + nameH + m, imgH = Math.max(0, R.h - 2 * pad - nameH - verseH - 2 * m)
    const url = lightPhoto(g.imageUrl), cached = url && this.images.get(url)
    if (cached && cached.ok) {
      cached.used = performance.now()
      const im = cached.img, ar = pw(im) / ph(im) || 1, box = iw / (imgH || 1)
      let sx = 0, sy = 0, sw = pw(im), sh = ph(im)
      if (ar > box) { sw = sh * box; sx = (pw(im) - sw) / 2 } else { sh = sw / box; sy = (ph(im) - sh) / 2 }
      ctx.drawImage(im, sx, sy, sw, sh, x, imgY, iw, imgH)                  // object-fit: cover
    } else {
      ctx.fillStyle = PHOTO_BG; ctx.fillRect(x, imgY, iw, imgH)
      if (url && cardPx >= IMG_PX) want.push(url)
    }
    if (cardPx < TEXT_PX || T.estimate) return   // no text yet (below text zoom, or waiting its turn to be measured)
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.font = `700 ${nameFs}px ${SANS}`
    ctx.fillStyle = NAME_INK   // as printed; a linked name shows the pointer cursor instead of link blue
    ctx.direction = textDir(name)
    T.nameLines.forEach((ln, k) => ctx.fillText(ln, cx, R.y + pad + k * nameFs * ct.nameLine, iw))
    if (T.verse) {
      let y = imgY + imgH + m
      ctx.font = `italic ${vFs}px Georgia, "Times New Roman", serif`; ctx.fillStyle = VERSE_INK
      ctx.direction = textDir(T.verse.lines[0])
      for (const ln of T.verse.lines) { ctx.fillText(ln, cx, y, iw); y += vFs * ct.verseLine }
      ctx.font = `${rFs}px ${SANS}`; ctx.fillStyle = REF_INK
      ctx.direction = textDir(T.verse.ref)
      ctx.fillText(T.verse.ref, cx, y + ct.refGapPt * pt, iw)
    }
    ctx.textBaseline = 'alphabetic'; ctx.direction = 'inherit'
  }

  /** Greedy word wrap by measured width (a word longer than the line is broken by characters). */
  breakLines(ctx, text, width, max) {
    const out = []
    let cur = ''
    for (const w of String(text).split(/\s+/)) {
      const tryLine = cur ? cur + ' ' + w : w
      if (ctx.measureText(tryLine).width <= width) { cur = tryLine; continue }
      if (cur) out.push(cur)
      cur = w
      while (ctx.measureText(cur).width > width && cur.length > 1) {
        let k = cur.length - 1
        while (k > 1 && ctx.measureText(cur.slice(0, k)).width > width) k--
        out.push(cur.slice(0, k)); cur = cur.slice(k)
      }
    }
    if (cur) out.push(cur)
    return out.slice(0, max)
  }

  drawCard(ctx, i, R, cardPx, want) {
    const g = this.groups[i], w = R.w, h = R.h, x = R.x, y = R.y
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h)
    ctx.lineWidth = 0.5; ctx.strokeStyle = '#dbdbdb'; ctx.strokeRect(x, y, w, h)
    const imgY = y + h * 0.18, imgH = h * 0.5
    const url = lightPhoto(g.imageUrl)
    const cached = url && this.images.get(url)
    if (cached && cached.ok) {
      cached.used = performance.now()
      const im = cached.img, ar = pw(im) / ph(im) || 1, box = w / imgH
      let sx = 0, sy = 0, sw = pw(im), sh = ph(im)
      if (ar > box) { sw = sh * box; sx = (pw(im) - sw) / 2 } else { sh = sw / box; sy = (ph(im) - sh) / 2 }
      ctx.drawImage(im, sx, sy, sw, sh, x, imgY, w, imgH)                  // object-fit: cover
    } else {
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(x, imgY, w, imgH)
      if (url && cardPx >= IMG_PX) want.push(url)
    }
    if (cardPx < TEXT_PX) return
    // Name (two lines if needed), in the card's top band.
    const nameSize = Math.max(3.5, w * 0.07)
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
    ctx.font = `700 ${nameSize}px -apple-system, "Segoe UI", Arial, sans-serif`
    ctx.fillStyle = groupLink(g) ? '#0095f6' : '#262626'
    const name = g.name || g.post_title || this.o.labels('wall.unknownGroup')
    const lines = ctx.measureText(name).width > w * 0.95 ? wrapText(name, Math.max(6, Math.floor(name.length / 2) + 2), 2) : [name]
    // Each data string is drawn in its OWN direction, not the page's: an English verse on an RTL page
    // keeps its full stop at the end (canvas direction otherwise inherits the page's rtl).
    ctx.direction = textDir(name)
    lines.forEach((ln, k) => ctx.fillText(ln, x + w / 2, y + h * 0.06 + k * nameSize * 1.1, w * 0.96))
    if (this.mode === 'bless') {
      // The verse under the photo (blessings.js, WEB, verbatim), then its reference.
      const vSize = Math.max(3, w * 0.052), per = Math.max(10, Math.floor(w / (vSize * 0.5)))
      const b = blessingFor(i), vl = wrapText(b.text, per, 4)
      const vy = imgY + imgH + vSize * 1.5
      ctx.font = `italic ${vSize}px Georgia, "Times New Roman", serif`; ctx.fillStyle = '#262626'
      ctx.direction = textDir(b.text)
      vl.forEach((ln, k) => ctx.fillText(ln, x + w / 2, vy + k * vSize * 1.25, w * 0.96))
      ctx.font = `${vSize * 0.82}px -apple-system, "Segoe UI", Arial, sans-serif`; ctx.fillStyle = '#8e8e8e'
      ctx.direction = textDir(b.ref)
      ctx.fillText(b.ref, x + w / 2, vy + vl.length * vSize * 1.25 + vSize * 0.4, w * 0.96)
      return
    }
    // SOCIAL: status, then heart / comment / share, the prayer count and "view prayers".
    ctx.font = `${Math.max(3, w * 0.055)}px -apple-system, "Segoe UI", Arial, sans-serif`; ctx.fillStyle = '#8e8e8e'
    if (g.status) { ctx.direction = textDir(g.status); ctx.fillText(g.status, x + w / 2, y + h * 0.14, w * 0.96) }
    ctx.direction = 'inherit'   // the translated counters below follow the page
    const L = this.socialLayout(R)
    const count = this.o.prayCount(g)
    ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    for (const [k, bx] of [['heart', L.hx], ['comment', L.cx], ['plane', L.px]]) {
      ctx.save(); ctx.translate(bx, L.by); ctx.scale(L.bs / 24, L.bs / 24)
      const on = k === 'heart' && count > 0
      ctx.strokeStyle = on ? '#ed4956' : '#262626'; if (on) { ctx.fillStyle = '#ed4956'; ctx.fill(this.icons[k]) }
      ctx.stroke(this.icons[k]); ctx.restore()
    }
    ctx.textAlign = 'left'; ctx.font = `600 ${L.pf}px -apple-system, "Segoe UI", Arial, sans-serif`; ctx.fillStyle = '#262626'
    ctx.fillText(this.o.labels('wall.prayedCount', { n: count }, count), L.hx, L.by + L.bs + L.pf + 2, w * 0.9)
    ctx.font = `${L.pf}px -apple-system, "Segoe UI", Arial, sans-serif`; ctx.fillStyle = '#8e8e8e'
    ctx.fillText(this.o.labels('wall.viewPrayers'), L.hx, L.by + L.bs + L.pf * 2 + 4, w * 0.9)
  }

  socialLayout(R) {
    const w = R.w, iconSize = Math.max(8, w * 0.12), bs = iconSize * 0.7, sp = bs * 1.6
    const hx = R.x + (w - (bs * 3 + sp * 2)) / 2, by = R.y + R.h * 0.72
    return { bs, hx, cx: hx + sp, px: hx + sp * 2, by, pf: Math.max(3.5, w * 0.065) }
  }

  /** Which card and region a screen point is on: { i, region: 'name'|'heart'|'comment'|'share'|'view'|'card' }. */
  hit(px, py) {
    if (this.posterOn) {
      const [wx, wy] = this.toWorld(px, py)
      const R = this.sp.cards.find((c) => wx >= c.x && wx <= c.x + c.w && wy >= c.y && wy <= c.y + c.h)
      if (!R || R.w * this.scale < TEXT_PX || R.i >= this.groups.length) return null
      const T = this.textCache.get(R.i)
      const nameBottom = R.y + (T ? T.ct.padIn * this.sp.pxPerIn + T.nameLines.length * T.ct.name.pt * (this.sp.pxPerIn / 72) * T.ct.nameLine : R.h * 0.12)
      return { i: R.i, region: wy <= nameBottom ? 'name' : 'card' }
    }
    if (!this.grid || this.grid.cw * this.scale < TEXT_PX) return null
    const [wx, wy] = this.toWorld(px, py), g = this.grid
    const c = Math.floor((wx - g.spacing) / (g.cw + g.spacing)), r = Math.floor((wy - g.vSpacing) / (g.ch + g.vSpacing))
    if (c < 0 || c >= g.cols || r < 0) return null
    const i = r * g.cols + c
    if (i >= this.groups.length) return null
    const R = this.cardRect(i)
    if (wx < R.x || wx > R.x + R.w || wy < R.y || wy > R.y + R.h) return null
    if (wy < R.y + R.h * 0.12) return { i, region: 'name' }
    if (this.mode === 'social') {
      const L = this.socialLayout(R)
      if (wy >= L.by && wy <= L.by + L.bs) {
        if (wx >= L.hx && wx <= L.hx + L.bs) return { i, region: 'heart' }
        if (wx >= L.cx && wx <= L.cx + L.bs) return { i, region: 'comment' }
        if (wx >= L.px && wx <= L.px + L.bs) return { i, region: 'share' }
      }
      if (wy > L.by + L.bs + L.pf && wy < L.by + L.bs + L.pf * 2 + 6) return { i, region: 'view' }
    }
    return { i, region: 'card' }
  }

  onMove(e) {
    const h = this.hit(e.offsetX, e.offsetY)
    const g = h && this.groups[h.i]
    const link = h && h.region === 'name' && groupLink(g)
    this.canvas.style.cursor = h && (link || ['heart', 'comment', 'share', 'view'].includes(h.region)) ? 'pointer' : ''
  }

  onClick(e) {
    if (e.defaultPrevented) return
    const h = this.hit(e.offsetX, e.offsetY)
    if (!h) return
    const g = this.groups[h.i]
    if (h.region === 'name') {
      const url = groupLink(g)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } else if (h.region === 'heart') this.o.onPray(g)
    else if (h.region === 'comment' || h.region === 'view') this.o.onComments(g)
    else if (h.region === 'share') this.o.onShare(g)
  }

  /** Load wanted photos, IMG_PARALLEL at a time; keep at most IMG_CACHE (least recently drawn dropped). */
  load(urls) {
    for (const u of urls) if (!this.images.has(u) && !this.queue.includes(u)) this.queue.push(u)
    while (this.loading < IMG_PARALLEL && this.queue.length) {
      const u = this.queue.shift()
      const img = new Image()
      const rec = { img, ok: false, used: performance.now() }
      this.images.set(u, rec)
      this.loading++
      img.decoding = 'async'
      img.onload = () => {
        this.stats.loaded++
        this.thumbnail(img).then((small) => {
          if (small) rec.img = small            // the original is dropped: only the thumbnail is kept
          rec.ok = true; this.loading--; this.request(); this.load([])
        })
      }
      // A resized copy that fails (photoUrl.js) is retried once from the original, under the same key.
      const full = fullPhoto(u)
      img.onerror = () => { if (full && img.src !== full) { img.src = full; return } this.loading--; this.load([]) }
      img.src = u
    }
    if (this.images.size > IMG_CACHE) {
      const old = [...this.images.entries()].filter(([, r]) => r.ok).sort((a, b) => a[1].used - b[1].used)
      for (const [u, r] of old.slice(0, this.images.size - IMG_CACHE)) { r.img?.close?.(); this.images.delete(u) }
    }
  }

  /**
   * A photo larger than THUMB_PX on its long side, as a small copy: createImageBitmap with resize (decoded
   * off the main thread where the browser can), or, where the resize options are missing or ignored (older
   * Safari and WebViews), ONE drawImage into a small canvas. Either way the original's pixels are released.
   * Resolves to null when the photo is already small enough (it is kept as it is).
   */
  async thumbnail(img) {
    const w0 = img.naturalWidth, h0 = img.naturalHeight
    if (!w0 || !h0 || Math.max(w0, h0) <= THUMB_PX) return null
    const k = THUMB_PX / Math.max(w0, h0), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k))
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
        if (bmp.width === w && bmp.height === h) { this.stats.thumbs++; return bmp }
        bmp.close?.()                          // the options were ignored: a full-size bitmap is no saving
      } catch (_) { /* no resize support: fall back */ }
    }
    try {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      this.stats.thumbs++; this.stats.thumbsFallback++
      return c
    } catch (_) { return null }                // a tainted or odd image: keep the original
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.sel.on('.zoom', null)
    this.canvas.removeEventListener('click', this._click)
    this.canvas.removeEventListener('mousemove', this._move)
    for (const r of this.images.values()) { if (r.img) { r.img.onload = r.img.onerror = null; if ('src' in r.img) r.img.src = ''; r.img.close?.() } }
    this.images.clear(); this.queue = []
    this.canvas.remove()
    this.ov?.remove(); this.ov = this.ovRoot = this.ovw = this.sp = null; this.textCache?.clear(); this.estCache?.clear()
  }
}
