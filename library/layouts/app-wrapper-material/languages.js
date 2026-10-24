/**
 * languages.js — the language list for the app wrapper's locale dropdown.
 *
 * PORTED from dx-life's single source of truth: `config/languages.ts`
 * (LANGUAGES / ENABLED_LANGUAGES / hideFromSwitcher). Kept DELIBERATELY MINIMAL:
 * dx-life's version also carries DeepL codes, Bible translation ids, glossary ids
 * and font flags — all of which belong to the CMS/translation pipeline, not to a
 * map wrapper. Only the four fields the switcher actually renders are kept, plus
 * `dir` (RTL) because the wrapper has to flip layout direction.
 *
 * WHY NOT A LIBRARY: the switcher is ~30 lines of state over this array. Adding a
 * dependency to render a <select> would be more complexity, not less — and every
 * candidate assumes a router (dx-life's uses `switchLocalePath()` because it
 * routes /es, /fr …). The wrapper is a STATIC app with no locale routing: it just
 * needs to emit a code. So: same DATA, simpler MECHANISM.
 *
 * THE CONTRACT (already built into the bundles — do not reinvent):
 *   ProfileLoader reads `profile-config.locale` (falls back to `.lang`), lowercases
 *   it, strips any region suffix ('pt-BR' -> 'pt'), drives the bundle's i18n global
 *   locale from it, and provides `lang` to descendants. So switching language =
 *   re-setting profile-config.locale on the mounted element. Nothing else.
 */

export const LANGUAGES = [
  { code: 'en', name: 'English',    nativeName: 'English',  flag: '🇺🇸' },
  { code: 'es', name: 'Spanish',    nativeName: 'Español',  flag: '🇪🇸' },
  { code: 'fr', name: 'French',     nativeName: 'Français', flag: '🇫🇷' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'ar', name: 'Arabic',     nativeName: 'العربية',   flag: '🇸🇦', dir: 'rtl' },
  { code: 'ru', name: 'Russian',    nativeName: 'Русский',  flag: '🇷🇺' },
  // Present in dx-life but hidden from its public switcher (hideFromSwitcher: true).
  // Kept here, flagged, so the list stays a faithful mirror of the source of truth.
  { code: 'de', name: 'German',     nativeName: 'Deutsch',  flag: '🇩🇪', hideFromSwitcher: true },
  { code: 'hi', name: 'Hindi',      nativeName: 'हिन्दी',     flag: '🇮🇳', hideFromSwitcher: true },
  // enabled:false in dx-life (routable/translatable but not offered), but every library catalogue carries
  // them (library/i18n SUPPORTED_LOCALES, 11 codes). Listed, hidden from the public switcher, so a tag of
  // it/ro/zh is no longer normalised to 'en' — it was, in the studio (11 locales vs 8 here).
  { code: 'it', name: 'Italian',    nativeName: 'Italiano', flag: '🇮🇹', hideFromSwitcher: true },
  { code: 'ro', name: 'Romanian',   nativeName: 'Română',   flag: '🇷🇴', hideFromSwitcher: true },
  { code: 'zh', name: 'Chinese',    nativeName: '中文',      flag: '🇨🇳', hideFromSwitcher: true },
]

/** Languages offered in the dropdown. */
export const SWITCHER_LANGUAGES = LANGUAGES.filter(l => !l.hideFromSwitcher)

export function getLanguage(code) {
  return LANGUAGES.find(l => l.code === code)
}

/** Normalise any incoming tag to a supported code ('pt-BR' -> 'pt'; unknown -> 'en'). */
export function normaliseLocale(tag) {
  const base = String(tag || '').split('-')[0].toLowerCase()
  return LANGUAGES.some(l => l.code === base) ? base : 'en'
}

/** Persisted choice (survives reload), defaulting to the browser language. */
const KEY = 'doxa-maps:locale'
export function loadLocale() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) return normaliseLocale(saved)
  } catch (_) { /* storage may be unavailable */ }
  return normaliseLocale(navigator?.language)
}
export function saveLocale(code) {
  try { localStorage.setItem(KEY, code) } catch (_) { /* non-fatal */ }
}
