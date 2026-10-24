/**
 * usePosterLayout — slot positioning math for poster compositions.
 *
 * Given a PosterSpec (inches + DPI + margins + slot config) and the resolved
 * pixel dimensions, returns the absolute pixel boxes for each slot:
 *
 *   { map, title, legend, scaleBar, north, footer }
 *
 * Layout (default research-poster preset):
 *
 *   ┌──────────────────────────────────────────┐
 *   │         TITLE (top strip)                │
 *   ├──────────────────────────────────────┬───┤
 *   │                                      │ L │
 *   │                                      │ E │
 *   │              MAP                     │ G │
 *   │                                      │ E │
 *   │                                      │ N │
 *   │                                      │ D │
 *   ├─────────────────┬───────────────┬────┴───┤
 *   │ SCALE           │  NORTH        │        │
 *   ├─────────────────┴───────────────┴────────┤
 *   │              FOOTER (attribution)        │
 *   └──────────────────────────────────────────┘
 *
 * All boxes are { x, y, w, h } in pixels (origin top-left).
 * Margins are honored; bleed is added outside the page (caller may ignore).
 *
 * @example
 *   const layout = computeLayout(spec, posterPixels(spec));
 *   ctx.drawImage(legendImg, layout.legend.x, layout.legend.y, layout.legend.w, layout.legend.h);
 */

import { posterDefaults } from '../../constants/posterDefaults.js';

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 *
 * @typedef {Object} PosterLayout
 * @property {Box} page
 * @property {Box} content    inside-margins area
 * @property {Box} title
 * @property {Box} map
 * @property {Box} legend
 * @property {Box} scaleBar
 * @property {Box} north
 * @property {Box} footer
 */

/**
 * Convert inches → pixels using DPI.
 * @param {number} inches
 * @param {number} dpi
 */
export function inchToPx(inches, dpi) {
  return Math.round(inches * dpi);
}

/**
 * Compute the layout boxes for a poster.
 *
 * @param {import('./useMapPoster.js').PosterSpec} spec
 * @param {{ width: number, height: number, dpi: number }} px
 * @returns {PosterLayout}
 */
export function computeLayout(spec, px) {
  const dpi = px.dpi;
  const margins = spec.margins || posterDefaults.margins;

  const pageBox = { x: 0, y: 0, w: px.width, h: px.height };

  const content = {
    x: inchToPx(margins.left, dpi),
    y: inchToPx(margins.top,  dpi),
    w: px.width  - inchToPx(margins.left + margins.right, dpi),
    h: px.height - inchToPx(margins.top  + margins.bottom, dpi),
  };

  // Title strip — top of content
  const titleH = spec.slots?.title
    ? inchToPx(spec.slots.title.heightIn || posterDefaults.title.heightIn, dpi)
    : 0;
  const title = { x: content.x, y: content.y, w: content.w, h: titleH };

  // Footer strip — bottom of content (always present per ToS)
  const footerH = inchToPx(spec.slots?.footer?.heightIn || posterDefaults.footer.heightIn, dpi);
  const footer = {
    x: content.x,
    y: content.y + content.h - footerH,
    w: content.w,
    h: footerH,
  };

  // Legend column on the right (if present)
  const legendW = spec.slots?.legend
    ? inchToPx(spec.slots.legend.widthIn || posterDefaults.legend.widthIn, dpi)
    : 0;

  // Scale bar + north arrow live in a thin band under the map (above footer)
  const chromeBandH = (spec.slots?.scaleBar || spec.slots?.north)
    ? inchToPx(posterDefaults.chromeBand.heightIn, dpi)
    : 0;

  const mapTop    = content.y + titleH + (titleH ? inchToPx(posterDefaults.gutter.in, dpi) : 0);
  const mapBottom = footer.y - chromeBandH - (chromeBandH ? inchToPx(posterDefaults.gutter.in, dpi) : 0);
  const map = {
    x: content.x,
    y: mapTop,
    w: content.w - (legendW ? legendW + inchToPx(posterDefaults.gutter.in, dpi) : 0),
    h: mapBottom - mapTop,
  };

  const legend = legendW
    ? {
        x: content.x + content.w - legendW,
        y: mapTop,
        w: legendW,
        h: map.h,
      }
    : { x: 0, y: 0, w: 0, h: 0 };

  // Scale bar — left half of chrome band
  const scaleW = inchToPx(posterDefaults.scaleBar.widthIn, dpi);
  const scaleH = chromeBandH;
  const scaleBar = spec.slots?.scaleBar
    ? {
        x: content.x,
        y: mapBottom + (chromeBandH ? inchToPx(posterDefaults.gutter.in, dpi) : 0),
        w: scaleW,
        h: scaleH,
      }
    : { x: 0, y: 0, w: 0, h: 0 };

  // North arrow — right of scale (or far-right of map area)
  const northSize = inchToPx(posterDefaults.north.sizeIn, dpi);
  const north = spec.slots?.north
    ? {
        x: content.x + content.w - northSize - (legendW ? legendW + inchToPx(posterDefaults.gutter.in, dpi) : 0),
        y: mapBottom + (chromeBandH ? inchToPx(posterDefaults.gutter.in, dpi) : 0),
        w: northSize,
        h: northSize,
      }
    : { x: 0, y: 0, w: 0, h: 0 };

  return { page: pageBox, content, title, map, legend, scaleBar, north, footer };
}

/**
 * Functional wrapper. Returns { computeLayout, inchToPx }.
 */
export function usePosterLayout() {
  return { computeLayout, inchToPx };
}
