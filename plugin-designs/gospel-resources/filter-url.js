/**
 * filter-url.js — the query after this page drops its OWN filter keys.
 *
 * The tables page reads a deep-link filter from the query (?iso= / ?country= / ?label= / ?province=).
 * "Show all" must remove exactly those keys: the page's ?tab=, any key a host or a partner put on the
 * address, and the #hash are someone else's and stay as they were. The result is in commitUrl's `search`
 * shape ('' or '?…'), and every other parameter is kept as written, byte for byte. Pure (no DOM), so a node
 * check can prove it without a browser.
 */
export const FILTER_KEYS = ['iso', 'country', 'label', 'province']

/** `search` ('' or '?…') without the parameters named in `keys`, in the same shape. */
export function searchWithout(search, keys = FILTER_KEYS) {
  const kept = String(search || '').replace(/^\?/, '').split('&').filter((p) => p && !keys.includes(p.split('=')[0]))
  return kept.length ? '?' + kept.join('&') : ''
}
