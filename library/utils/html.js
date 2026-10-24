/**
 * html.js — the two helpers every HTML string built in library/ must use (CRITIC-3, 2026-09-26).
 *
 * Popups are built as HTML strings and handed to setHTML(), which parses them. A people-group name,
 * a description or a country label comes from DATA (an API or a partner's list), so interpolating it
 * raw lets a `<img onerror>` in the data run in the host page. Escape every data value; pass every URL
 * through safeUrl so a `javascript:` link cannot ride in on a data field.
 */
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }

/** Text or attribute value → safe to interpolate into HTML (null/undefined → ''). */
export function escapeHtml(v) {
  return v == null ? '' : String(v).replace(/[&<>"'`]/g, (c) => MAP[c])
}

/** An http(s) URL, escaped for an attribute; anything else (javascript:, data:, garbage) → fallback. */
export function safeUrl(u, fallback = '') {
  try {
    const url = new URL(String(u), typeof location !== 'undefined' ? location.href : 'https://example.invalid/')
    if (url.protocol === 'http:' || url.protocol === 'https:') return escapeHtml(url.href)
  } catch { /* not a URL */ }
  return escapeHtml(fallback)
}
