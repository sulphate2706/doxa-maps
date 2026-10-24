/**
 * pageThumb.js: the FIRST PAGE of a printable HTML document (a card deck, a prayer packet) as an image
 * a poster card can show.
 *
 * The poster rasteriser (library/packet/poster-raster.js) lifts an <svg> out of a poster; a deck or a
 * packet is HTML pages instead, so it has nothing to lift. This takes the document the reader would
 * print, keeps its first page, and wraps that page in an SVG <foreignObject>, which a browser draws
 * through a plain <img>. Nothing is re-laid-out here: the page, its stylesheet and its size all come
 * from the shared renderer.
 *
 * Two things an SVG shown through <img> does differently, both handled here:
 *   - it is an ISOLATED document that loads nothing, so a photo on the page is fetched now and inlined as
 *     a data: URL, but ONLY from this page's own origin: a fetch needs CORS, and the people-group photo host
 *     sends none, so a cross-origin photo is left out WITHOUT trying (trying only fills the console with
 *     refusals). Its frame stays, empty, and the printed document still carries the photo;
 *   - its markup must be XML, so the page is re-serialised with XMLSerializer (void elements closed,
 *     entities resolved) rather than pasted as HTML.
 *
 * A pilot in this plugin; if a second surface needs a document thumbnail it belongs in library/.
 */
const MAX_PHOTOS = 8

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms)
    promise.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

async function asDataUrl(src, timeoutMs) {
  const res = await withTimeout(fetch(src, { mode: 'cors', cache: 'force-cache' }), timeoutMs)
  if (!res.ok) throw new Error(`photo ${res.status}`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/**
 * @param {string} html   the whole printable document, exactly as the renderer builds it
 * @param {object} o
 *   page       CSS selector of one page (".card", ".sheet"); the first match is kept
 *   width      the page's width in CSS px (the renderer's W)
 *   height     the page's height in CSS px (the renderer's H)
 *   timeoutMs  per photo
 * @returns {Promise<string|null>} an image URL (image/svg+xml), or null when the document has no page
 */
export async function firstPageImage(html, { page, width, height, timeoutMs = 8000 } = {}) {
  if (!html || !page || !width || !height) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const first = doc.body && doc.body.querySelector(page)
  if (!first) return null
  // Keep only the body child that holds the first page.
  let top = first
  while (top.parentElement && top.parentElement !== doc.body) top = top.parentElement
  for (const n of [...doc.body.childNodes]) if (n !== top) n.remove()

  const sameOrigin = (src) => { try { return new URL(src, document.baseURI).origin === location.origin } catch (_) { return false } }
  const photos = [...top.querySelectorAll('img[src]')].filter((img) => !/^data:/i.test(img.getAttribute('src')))
  let fetched = 0
  for (const img of photos) {
    const src = img.getAttribute('src')
    if (fetched < MAX_PHOTOS && sameOrigin(src)) {
      fetched++
      try { img.setAttribute('src', await asDataUrl(src, timeoutMs)); continue } catch (_) { /* left out below */ }
    }
    img.removeAttribute('src')
  }

  const xhtml = new XMLSerializer().serializeToString(doc.documentElement)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
}
