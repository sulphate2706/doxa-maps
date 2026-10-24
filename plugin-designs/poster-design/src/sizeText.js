/**
 * sizeText.js — a poster's size in the reader's language, the ONE way Poster Design names sizes (Styles and Sizes).
 * Numbers are spoken whole or to one decimal (5.5); a side of a yard or more in whole or half feet reads in feet
 * (3 × 5.5 ft), anything smaller in inches (18 × 24 in). Every word comes from the posterDesign.sizes catalogue.
 *
 *   spec = { dims: [w, h] } inches · { dims, lanes: true } · { dims, panels: n } · { paper: 'letter', packetPage? } ·
 *          { any: true } (a template that prints at whatever size its reader picks)
 */
import { resolvePosterSize } from '@map/constants/posterSizes.js'

export const num = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10))

export function dimsText(w, h, t) {
  const ft = (x) => x / 12
  const halfFeet = (x) => Number.isInteger(ft(x) * 2)
  if (Math.min(w, h) >= 36 && halfFeet(w) && halfFeet(h)) return t('posterDesign.sizes.dimsFt', { w: num(ft(w)), h: num(ft(h)) })
  return t('posterDesign.sizes.dimsIn', { w: num(w), h: num(h) })
}

export function sizeText(spec, t) {
  if (!spec) return ''
  if (spec.any) return t('posterDesign.sizes.anySize')
  if (spec.paper) {
    const paper = t('posterDesign.sizes.paperLetter')
    return spec.packetPage ? t('posterDesign.sizes.packetPage1', { paper }) : paper
  }
  const dims = dimsText(spec.dims[0], spec.dims[1], t)
  if (spec.lanes) return t('posterDesign.sizes.sideLanes', { dims })
  if (spec.panels) return t('posterDesign.sizes.panels', { dims, n: num(spec.panels) })
  return dims
}

/** A plugin's declared size: a ladder key ("66x66") through the shared ladder, letter / a4 by name; anything else as written. */
export function declaredSizeText(size, t) {
  if (size === 'letter') return t('posterDesign.sizes.paperLetter')
  if (size === 'a4') return t('posterDesign.sizes.paperA4')
  const s = resolvePosterSize(size)
  return s && s.inches && !s.paper && s.id !== 'paper' ? dimsText(s.inches.w, s.inches.h, t) : String(size || '')
}
