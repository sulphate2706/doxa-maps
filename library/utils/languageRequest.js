/**
 * languageRequest.js — how a shell asks its HOST PAGE before it changes language.
 *
 * A shell (the Research Gallery, Posterverse) shows its own language menu, but the page around it may
 * own the language: DX Life keeps it in the URL path (/ar/deep-research), and a shell that switched on
 * its own would fight the page. So a pick is a REQUEST, sent as one native event on the shell's host
 * element:
 *
 *   doxa-language-request   detail: { language: 'ar' }   bubbles, composed, cancelable
 *
 * - A host that owns the language calls preventDefault() and changes it itself (it then sets the
 *   shell's `language` attribute). dispatchEvent returns false, and the shell does NOT switch.
 * - Nobody cancels (a standalone leaf, or a partner page that set `language="es"` once and never
 *   listens): dispatchEvent returns true, and the shell switches itself. That is why the rule keys on
 *   the cancel and not on whether `language` was passed: a static attribute would otherwise leave a
 *   dropdown that does nothing.
 *
 * ★ A NATIVE CustomEvent, NOT Vue's emit. Vue's custom-element emit wraps detail in an ARRAY
 * (detail[0]) and is never cancelable, so the host could neither read detail.language nor say no.
 *
 * The host is found the way library/utils/hostElement.js finds it (one hop out of the shadow root);
 * that helper takes a Vue instance, this takes the DOM node the pick happened on.
 */

export const LANGUAGE_REQUEST_EVENT = 'doxa-language-request'

/** The custom element a node is rendered inside, or the node itself outside any shadow root. */
export function hostOf(el) {
  try { const rn = el && el.getRootNode && el.getRootNode(); if (rn && rn.host) return rn.host } catch (_) {}
  return el || null
}

/**
 * Ask the host page for `code`. Returns true when NOBODY cancelled (the shell should switch itself),
 * false when a host took the request (the shell waits for the host to set `language`).
 */
export function requestLanguage(fromEl, code) {
  const host = hostOf(fromEl)
  if (!host || typeof host.dispatchEvent !== 'function') return true
  return host.dispatchEvent(new CustomEvent(LANGUAGE_REQUEST_EVENT, {
    detail: { language: code }, bubbles: true, composed: true, cancelable: true,
  }))
}

/**
 * Record an uncancelled pick in ?lang=, ONLY on a page this tree generated (window.MAP_OWNS_PAGE ===
 * true, stamped by internal/generate-tree.mjs and honoured by library/i18n). A host's URL is the host's:
 * a shell embedded anywhere else never writes it. Returns whether it wrote.
 */
export function writeOwnedLangParam(code, win = (typeof window !== 'undefined' ? window : null)) {
  try {
    if (!win || win.MAP_OWNS_PAGE !== true || !win.history || !win.location) return false
    const url = new URL(win.location.href)
    url.searchParams.set('lang', code)
    win.history.replaceState(win.history.state, '', url.toString())
    return true
  } catch (_) { return false }
}
