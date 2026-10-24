// poster-fetch.js — fetch a poster's raster or its source, and refuse anything else.
//
// ★ WHY. A dev server or a single-page-app host answers a MISSING file with its own page:
// 200, text/html. Measured on a drop-in host's dev server (Nuxt): a missing
// posters/<id>.webp answered 200 text/html. Taken at face value that page became the
// "poster": as a raster, a broken image handed to the print dialog; as a source, the
// rasteriser lifts the first <svg> it finds (an icon on the host's page) and prints that.
// So a raster counts only if it is an image, and a source only if it is a poster
// document (the `class="stage"` element every generated poster source has).
//
// One helper for every caller: usePosterPrints and PosterWall each carried their own copy
// of this fetch, and a guard added to one did not reach the other.

export const POSTER_SOURCE_MARK = 'class="stage"'

// The image's first bytes, for hosts that label a WebP as application/octet-stream.
async function looksLikeImage(blob) {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to))
  return (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')            // WebP
    || (b[0] === 0x89 && ascii(1, 4) === 'PNG')                          // PNG
    || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)                  // JPEG
}

// The raster at `url` as a Blob, or null when it is missing, unreachable, or not an image.
export async function fetchPosterRaster(url, fetchImpl = fetch) {
  let res
  try { res = await fetchImpl(url) } catch { return null }
  if (!res || !res.ok) return null
  const type = (res.headers.get('content-type') || '').toLowerCase()
  if (type.startsWith('text/')) return null
  const blob = await res.blob()
  return type.startsWith('image/') || await looksLikeImage(blob) ? blob : null
}

// The poster source at `url`: { html } when it is one, else { html: null, status }. A 200 that
// is not a poster document reports 404, since the poster is not there. A network error is
// thrown, not reported as a status: the source is the last resort, so the reader should see
// the real failure rather than "not found".
export async function fetchPosterSource(url, fetchImpl = fetch) {
  const res = await fetchImpl(url)
  if (!res.ok) return { html: null, status: res.status }
  const html = await res.text()
  return html.includes(POSTER_SOURCE_MARK) ? { html, status: res.status } : { html: null, status: 404 }
}
