// poster-raster.js — turn a poster's HTML/SVG into a downloadable image, in the
// browser, on click.
//
// ★ WHY: 378 posters were committed as .webp — 41 MB in every clone, shipped to
// every reader whether or not they open one. Not shipping ~80 MB of images in a
// public folder, and letting the website generate the posters, is a big win.
// A publish was ALREADY rejected once at a 74 MB asset tree
// (git-packed to 57 MiB), which is what not doing this costs.
//
// THE MOVE IS NOT A REWRITE. generate.mjs is 2,816 lines with 26 Node touchpoints;
// porting it to the browser would be a large, risky job. But the poster's shipped
// artefact does not have to be a RASTER — the browser can rasterise the SVG itself:
//
//   posters/<id>.html   ~115 KB gzipped (text, compresses well)
//   posters/<id>.webp   ~213 KB          (already rasterised, one fixed size)
//
// So the HTML is SMALLER than the image it produces, and it is the source: the
// reader picks the resolution at download time instead of being handed one. The
// packet already fetches this same HTML to draw its map page, so the file is
// already a shipped, proven artefact.
//
// ⚠ AN SVG LOADED THROUGH <img> IS AN ISOLATED DOCUMENT. It cannot see the host
// page's CSS, so every var() falls back to its initial value — and `fill`'s initial
// value is BLACK. That is exactly how the packet's map first shipped as a solid
// black rectangle with no error. The stylesheet must be INLINED into the SVG, and
// the result must be checked by MEASURING the pixels, not by looking at the code.

/**
 * Lift the <svg> out of a poster document with its stylesheet inlined, so it
 * renders standalone.
 */
export function inlineSvg(posterHtml) {
  const svg = (posterHtml.match(/<svg[\s\S]*?<\/svg>/) || [])[0];
  if (!svg) throw new Error('poster HTML contains no <svg>');
  const css = (posterHtml.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  // Strip any nested </style> so the injected block cannot terminate early.
  const safe = css.replace(/<\/style>/gi, '');
  return svg.replace(/<svg([^>]*)>/, `<svg$1><style>${safe}</style>`);
}

/**
 * ⚠ AN EXTERNAL IMAGE CAN NEVER DRAW IN THAT ISOLATED DOCUMENT. An SVG loaded through <img> fetches no external
 * resource by spec, and no people-group photo host sends CORS headers, so a photo cannot be inlined as data: in
 * the browser either. Left in, each one rasterises as the browser's broken-image glyph (measured on the large
 * side-lane sheet's photos). So the raster drops every <image> whose href is not data: (the basemap tiles, which
 * ARE data:, stay); a sheet that carries photos PRINTS AS A DOCUMENT instead, where they load (hasExternalImages).
 */
const EXTERNAL_IMAGE = /<image\b[^>]*?\bhref="(?!data:)[^"]*"[^>]*?\/>/g;
export function hasExternalImages(posterHtml) { return /<image\b[^>]*?\bhref="(?!data:)/.test(posterHtml || ''); }
export function stripExternalImages(svg) { return svg.replace(EXTERNAL_IMAGE, ''); }

/**
 * Rasterise a poster to a Blob in the browser.
 * @param {string} posterHtml  the poster document (posters/<id>.html)
 * @param {object} opts  scale (default 2), type ('image/webp'|'image/png'), quality
 */
export async function rasterPoster(posterHtml, { scale = 2, type = 'image/webp', quality = 0.85 } = {}) {
  const svg = stripExternalImages(inlineSvg(posterHtml));
  // encodeURIComponent, not btoa: the posters carry non-Latin-1 characters (people
  // group and place names), and btoa throws on those.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.src = url;
  await img.decode();

  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // White under the art: a transparent canvas prints as black on some viewers, and
  // the poster's own paper colour only covers its drawn area.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
  if (!blob) throw new Error('canvas.toBlob returned nothing');
  return blob;
}

/**
 * Is this canvas mostly black? A cheap guard against the isolated-document trap
 * above, so a broken render fails LOUDLY instead of downloading a black rectangle.
 */
export async function looksRendered(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = 40; c.height = 40;
  const x = c.getContext('2d');
  x.drawImage(bmp, bmp.width * 0.4, bmp.height * 0.45, 40, 40, 0, 0, 40, 40);
  const d = x.getImageData(0, 0, 40, 40).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return sum / (d.length / 4) > 40;
}
