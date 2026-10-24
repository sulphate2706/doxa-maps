/**
 * packetStrings — the text of every printed packet, list and card deck, in all 11 languages, FETCHED at print
 * time from the served tree (<assets>/lib/packet-strings.json) instead of bundled.
 *
 * WHY. A single-file build inlines every import, dynamic ones included, so the whole table (~115 KB
 * minified: every language's prayer points, captions and headings) rode in every bundle that can print —
 * country-posters crossed the 1.5 MB ceiling once its wall's print messages were translated. A reader needs
 * the table only when they print. Same move as the sheet generator and ne-places.json (posterSheets.js).
 *
 * PINNED like them (PACKET_STRINGS_SHA384): the text is hashed before it is parsed, and a table that is not
 * the pinned one is not used. These strings are laid into the print document, so an unverified copy must
 * never reach it.
 *
 * ★ ENGLISH IS BUNDLED AS THE FALLBACK, so a print never fails for want of this file: without an asset base
 * (a host that sets none), on file:// where a page cannot fetch, on a network error, or on an integrity
 * mismatch, the packet prints in English and the console says why. `{ en }` is a named import of the JSON, so
 * only the English block is bundled; the other ten languages stay on the server.
 */
import { en as EN } from '../scripts/posters/packet-strings.json'
import { PACKET_STRINGS_SHA384 } from './poster-render.integrity.js'
import { fetchPinned } from './sha384.js'

// Captured when the module evaluates, as in posterSheets.js: a relative asset base resolves against the page
// that loaded the map, even if a single-page host changes its URL before the click.
const PAGE_BASE = globalThis.document?.baseURI || undefined
const ENGLISH_ONLY = Object.freeze({ en: EN })
const cache = new Map()

/** The full table ({ en, es, …, zh }), or `{ en }` when the served copy cannot be used. Never rejects. */
export function loadPacketStrings(assetsBase) {
  if (!assetsBase) return Promise.resolve(ENGLISH_ONLY)
  let url
  try { url = new URL(`${assetsBase}/lib/packet-strings.json`, PAGE_BASE).href } catch { return Promise.resolve(ENGLISH_ONLY) }
  if (!cache.has(url)) {
    const p = (async () => {
      // force-cache, and once more fresh on a mismatch: a stale cached copy after a re-pin must not turn a
      // returning reader's packet English (sha384.js fetchPinned says why).
      return JSON.parse(await fetchPinned(url, PACKET_STRINGS_SHA384))
    })().catch((e) => {
      console.warn(`[packetStrings] ${url}: ${e?.message || e} — printing in English`)
      cache.delete(url)                // a later print tries again rather than inheriting one failure
      return ENGLISH_ONLY
    })
    cache.set(url, p)
  }
  return cache.get(url)
}
