/**
 * posterTypes.js — the POSTER TYPES a poster section can show, by name.
 *
 * A type is an ADAPTER: what its posters are and how they print. The library registers 'country' (its data and
 * its sheet path are library code); a plugin registers its own type from its own code (registerPosterType), so no
 * plugin-specific code lives here. Loaded lazily: a page that shows only country posters never pulls another
 * type's data.
 *
 * adapter = {
 *   items(scope, locale)          → the cards for a scope (a region / continent / list key), [] when none
 *   title(scope, t)               → the section's heading, in the reader's language
 *   actions({ assetsBase, apiBase, lang, profileConfig, t }) → the PosterWall props that print a card:
 *     { records, sheet, unsupported, unit, itemCountKey, eventName, downloadPrefix, cardStocks }
 * }
 *
 * ★ ONE REGISTRY PER PAGE, NOT PER BUNDLE. Every bundle inlines its own copy of this file, and <dxm-poster-section>
 * is defined by whichever bundle loads first. With a module-level Map, that element read only ITS bundle's types,
 * so type="upg100-list" rendered "none" whenever the country-posters bundle had defined the element. So the
 * registry lives on the page (globalThis[REGISTRY_KEY], created once): every copy registers into it and reads from
 * it. A name registered twice keeps the FIRST (a dev warning says so; the built-in 'country' is registered by every
 * copy and is silent). Every registration is announced (TYPE_REGISTERED_EVENT on window), so a section that asked
 * before its type arrived renders when it does.
 */
export const REGISTRY_KEY = '__DXM_POSTER_TYPES__'
export const TYPE_REGISTERED_EVENT = 'dxm-poster-type-registered'
const VERSION = 1

function registry() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {}
  let r = g[REGISTRY_KEY]
  if (!r || !(r.loaders instanceof Map) || !(r.cache instanceof Map)) {
    r = { version: VERSION, loaders: new Map(), cache: new Map() }
    try { Object.defineProperty(g, REGISTRY_KEY, { value: r, configurable: true, writable: false }) } catch (_) { g[REGISTRY_KEY] = r }
  }
  return r
}
const toLoader = (a) => (typeof a === 'function' ? a : () => Promise.resolve({ default: a }))
function announce(name) {
  try { if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent(TYPE_REGISTERED_EVENT, { detail: { name } })) } catch (_) { /* no window */ }
}

/** Register a type: an adapter object, or a function that loads one (a dynamic import). The first registration wins. */
export function registerPosterType(name, adapterOrLoader) {
  const r = registry()
  if (r.loaders.has(name)) {
    if (import.meta.env && import.meta.env.DEV && typeof console !== 'undefined') console.warn(`[dx-maps] poster type "${name}" is already registered on this page; the first registration is kept.`)
    return false
  }
  r.loaders.set(name, toLoader(adapterOrLoader))
  announce(name)
  return true
}
/** The adapter for a type, or null for a type nobody on this page registered (yet). */
export function posterType(name) {
  const r = registry()
  if (!r.loaders.has(name)) return Promise.resolve(null)
  if (!r.cache.has(name)) r.cache.set(name, r.loaders.get(name)().then((m) => m.default || m))
  return r.cache.get(name)
}
export const posterTypeNames = () => [...registry().loaders.keys()]

// The built-in type, from every copy: silent, first one kept.
if (!registry().loaders.has('country')) {
  registry().loaders.set('country', () => import('./types/countryPosterType.js'))
  announce('country')
}
