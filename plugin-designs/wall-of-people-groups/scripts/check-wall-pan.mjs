#!/usr/bin/env node
/**
 * check-wall-pan — the Wall pans and zooms with the pointer, 1 : 1. Headless.
 *
 * d3-zoom on a <canvas> reports its transform in the canvas's own CSS px, and wallCanvas.js applies it AFTER
 * the "meet" fit of the world into the canvas. It used to apply it inside the fit, so every pan moved the wall
 * by only the fit scale k0 of the pointer (measured on development 6e1a33534: a 200 px mouse drag panned 34 px
 * at 1440; a 120 × 200 px finger drag 14 × 23 px on a phone) and a wheel zoom drifted off the pointer.
 * This runs the REAL WallCanvas methods (through Vite, so @map resolves) with d3's own transform arithmetic
 * and asserts, over several fits and zooms:
 *   - a pan of d px in d3's space moves every card d px on screen;
 *   - a zoom about a pointer keeps the world point under that pointer;
 *   - toWorld inverts toScreen;
 *   - constrain() keeps the wall over the centre of the view after a fling, and leaves a resting view alone.
 * Two-sided: the old formulas (transform inside the fit) are planted and must fail the pan and zoom arms.
 * EXIT 0 pass · 1 fail
 */
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } })

// d3-zoom's ZoomTransform arithmetic (d3-zoom/src/transform.js): translate() works in pre-scale units.
class T {
  constructor(k, x, y) { this.k = k; this.x = x; this.y = y }
  translate(x, y) { return new T(this.k, this.x + this.k * x, this.y + this.k * y) }
  invert(p) { return [(p[0] - this.x) / this.k, (p[1] - this.y) / this.k] }
}
// d3's zoom about a pointer p: the point under p (in d3's space) stays under p.
const zoomAbout = (t, k, p) => { const q = t.invert(p); return new T(k, p[0] - q[0] * k, p[1] - q[1] * k) }

/** A WallCanvas with no DOM: the prototype's own methods, over a fitted world. */
function wall(W, cssW, cssH, worldW, worldH) {
  const w = Object.create(W.prototype)
  w.mode = 'social'; w.sp = null; w.o = { worldW, worldH }; w.cssW = cssW; w.cssH = cssH
  w.k0 = Math.min(cssW / worldW, cssH / worldH); w.ox = (cssW - worldW * w.k0) / 2; w.oy = (cssH - worldH * w.k0) / 2
  w.t = new T(1, 0, 0)
  return w
}

function run(W, plant = false) {
  const errs = []
  if (plant) {   // the formulas before the fix: d3's transform applied inside the fit
    Object.defineProperty(W.prototype, 'tx', { configurable: true, get() { return this.ox + this.t.x * this.k0 } })
    Object.defineProperty(W.prototype, 'ty', { configurable: true, get() { return this.oy + this.t.y * this.k0 } })
  }
  const cases = [[1440, 793, 3456, 4608], [390, 696, 5760, 9216], [1184, 791, 4000, 3000], [390, 696, 3000, 4000]]
  let checked = 0
  for (const [cssW, cssH, worldW, worldH] of cases) {
    for (const k of [1, 2.5, 9]) {
      const w = wall(W, cssW, cssH, worldW, worldH)
      w.t = zoomAbout(w.t, k, [cssW * 0.3, cssH * 0.6])
      const pt = [worldW * 0.37, worldH * 0.61], s0 = w.toScreen(...pt)
      // pan: a drag of (120, -200) px is t.translate(120 / k, -200 / k) in d3
      w.t = w.t.translate(120 / k, -200 / k)
      const s1 = w.toScreen(...pt)
      const ratio = [(s1[0] - s0[0]) / 120, (s1[1] - s0[1]) / -200]
      if (Math.abs(ratio[0] - 1) > 1e-9 || Math.abs(ratio[1] - 1) > 1e-9) errs.push(`pan ${cssW}×${cssH} world ${worldW}×${worldH} zoom ${k}: the wall moved ${ratio.map((r) => r.toFixed(3)).join(' × ')} of the pointer, not 1`)
      // zoom about a pointer: the world point under it stays
      const p = [cssW * 0.71, cssH * 0.23], before = w.toWorld(...p)
      w.t = zoomAbout(w.t, k * 1.4, p)
      const after = w.toScreen(...before)
      if (Math.hypot(after[0] - p[0], after[1] - p[1]) > 1e-6) errs.push(`zoom ${cssW}×${cssH} zoom ${k}: the point under the pointer drifted ${Math.hypot(after[0] - p[0], after[1] - p[1]).toFixed(1)} px`)
      const back = w.toScreen(...w.toWorld(...p))
      if (Math.hypot(back[0] - p[0], back[1] - p[1]) > 1e-6) errs.push('toWorld does not invert toScreen')
      // constrain: a fling five views away still leaves the wall over the centre; a resting view is untouched
      const rest = w.t
      if (w.constrain(rest) !== rest) errs.push(`constrain moved a view that already covers the centre (${cssW}×${cssH}, zoom ${k})`)
      for (const [fx, fy] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) {
        w.t = w.constrain(rest.translate(fx * cssW / rest.k, fy * cssH / rest.k))
        const [x0, y0] = w.toScreen(0, 0), [x1, y1] = w.toScreen(worldW, worldH)
        if (!(x0 <= cssW / 2 + 1e-6 && x1 >= cssW / 2 - 1e-6 && y0 <= cssH / 2 + 1e-6 && y1 >= cssH / 2 - 1e-6)) errs.push(`a fling (${fx}, ${fy}) views away lost the wall (${cssW}×${cssH}, zoom ${k})`)
      }
      checked++
    }
  }
  if (plant) { delete W.prototype.tx; delete W.prototype.ty }
  return { errs, checked }
}

const fails = []
let real = null
try {
  const { WallCanvas } = await server.ssrLoadModule('/plugin-designs/wall-of-people-groups/src/wallCanvas.js')
  const own = { tx: Object.getOwnPropertyDescriptor(WallCanvas.prototype, 'tx'), ty: Object.getOwnPropertyDescriptor(WallCanvas.prototype, 'ty') }
  if (!own.tx || !own.ty) fails.push('WallCanvas has no tx/ty getters: this check reads the wrong file or the renderer changed shape')
  else {
    real = run(WallCanvas)
    fails.push(...real.errs)
    if (real.checked < 12) fails.push(`only ${real.checked} of 12 cases ran`)
    const planted = run(WallCanvas, true)
    Object.defineProperty(WallCanvas.prototype, 'tx', own.tx); Object.defineProperty(WallCanvas.prototype, 'ty', own.ty)
    if (!planted.errs.some((e) => /^pan /.test(e))) fails.push('SELF-TEST: the old in-fit transform was not caught by the pan arm')
    if (!planted.errs.some((e) => /^zoom /.test(e))) fails.push('SELF-TEST: the old in-fit transform was not caught by the zoom arm')
  }
} catch (e) { fails.push('could not run WallCanvas: ' + e.message) }
await server.close()

if (fails.length) { console.log('WALL-PAN: FAIL'); for (const f of fails) console.log('  - ' + f); process.exit(1) }
console.log(`WALL-PAN: PASS — ${real.checked} fits × zooms: a pan moves the wall 1:1 with the pointer, a zoom keeps the point under the pointer, toWorld inverts toScreen, and a fling never loses the wall; the old in-fit transform is caught.`)
process.exit(0)
