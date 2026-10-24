/**
 * keyedError — an Error a READER may see, carrying the catalogue key that says it in their language.
 *
 * Code that throws does not know the reader's locale, and the UI that catches does not know what went
 * wrong, so the message used to cross that gap as English: "poster not found (404)" in an Arabic HUD. The
 * error now carries both halves: `message` stays English (logs, consoles, developers), and `i18nKey` +
 * `i18nParams` let whoever DISPLAYS it translate it.
 *
 *   throw keyedError('wall.hud.posterNotFound', 'poster not found ({status})', { status: 404 })
 *   status.value = errorText(e, t)          // the reader's language; English for an unkeyed error
 *
 * An error without a key (a TypeError, a browser's own message) is shown as before: errorText never hides
 * a failure because it has no translation for it.
 */

const fill = (s, params) => String(s).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m))

export function keyedError(key, en, params = {}) {
  const e = new Error(fill(en, params))
  e.i18nKey = key
  e.i18nParams = params
  return e
}

/** The text to show a reader for `e`: its catalogue entry through `t` when keyed and present, else its message. */
export function errorText(e, t) {
  if (e && e.i18nKey && typeof t === 'function') {
    const v = t(e.i18nKey, e.i18nParams || {})
    if (typeof v === 'string' && v && v !== e.i18nKey) return v
  }
  return String((e && e.message) || e)
}
