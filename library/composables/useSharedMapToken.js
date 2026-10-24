/**
 * useSharedMapToken.js — ONE page, ONE map token, shared by every element on it.
 *
 * THE BUG THIS ENDS (the repo names it BUG-COMPOSITE-LEAVES-ARE-TOKEN-FREE-BUT-NEST-REAL-MAPS): the
 * element receives the tk, and it must not gatekeep it to one component — every component in a
 * plugin can share it.
 *
 * Inside ONE element that was already true: ProfileLoader provides 'mapboxToken' and eleven
 * components inject it. The gate is the ELEMENT BOUNDARY. Every custom element mounts its own Vue
 * app with its own ProfileLoader, which re-derives the token from ITS OWN profile-config — so a
 * composite that nests a real map hands the child no `tk` and the child starts from nothing.
 *
 * ★ AND THE FALLBACK THAT WAS SUPPOSED TO COVER THAT COULD NOT FIRE. ProfileLoader's ladder already
 *   read `window.MAP_TOKEN` after config.tk. MEASURED on the built tree: window.MAP_TOKEN IS set on
 *   the composite leaf — and the child STILL had no search bar. The reason is that the ladder lives
 *   in a computed() and window.MAP_TOKEN is a PLAIN GLOBAL, not a reactive source. The generated
 *   composite leaf FETCHES its token (one fetch( in the page), so the computed evaluates to '' long
 *   before the token lands, caches that, and never re-runs — nothing reactive ever changed.
 *   So the symptom looked like "no token" while the token was right there, seconds later. A grep
 *   for the fallback would have said the fallback existed; only reading WHEN it ran explains it.
 *
 * THE FIX: make the page-level token a REACTIVE, CROSS-ELEMENT fact.
 *   - publishMapToken(tk) stores it and announces it on `window`.
 *   - useSharedMapToken() returns a ref that is seeded from whatever is already known and UPDATES
 *     when a later publish happens — so an async token reaches elements that mounted before it.
 *   - Assignments to `window.MAP_TOKEN` are adopted automatically (see installBridge), so every
 *     ALREADY-GENERATED page keeps working untouched: the leaf pages assign that global today and
 *     now that assignment broadcasts instead of landing silently.
 *
 * ★ WHY AN EVENT AND NOT A SHARED MODULE REF. Each bundle is its own IIFE with its own copy of this
 *   module, so a module-level ref is NOT shared between <research-map-plus-grid> and the
 *   <doxa-research-map> it nests — they are different bundles. The storage therefore lives on
 *   `window` and changes travel as a DOM event, which is the only channel both copies can see.
 *
 * SECURITY: this shares a PUBLIC Mapbox token (pk.*) that is already in the page's HTML and in
 * every tile request. It does not widen exposure — it stops a second element on the SAME page from
 * being unable to use what that page was already given. Nothing is persisted or sent anywhere.
 */
import { retryFetch } from './retryFetch.js'
import { ref, onBeforeUnmount } from 'vue'

const KEY   = '__doxaMapToken'      // the value, on window, so every bundle sees one copy
const EVENT = 'doxa:map-token'      // fired when it changes
const FLAG  = '__doxaMapTokenBridge'

const readStored = () => {
  if (typeof window === 'undefined') return ''
  const v = window[KEY]
  return typeof v === 'string' ? v : ''
}

/** Announce a token to every element on the page. No-ops on an empty or unchanged value. */
export function publishMapToken(tk) {
  if (typeof window === 'undefined') return ''
  installBridge()
  const next = typeof tk === 'string' ? tk.trim() : ''
  if (!next || next === readStored()) return readStored()
  window[KEY] = next
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })) } catch { /* pre-CustomEvent host */ }
  return next
}

/**
 * Withdraw the page-wide token (a "Clear" in the studio). publishMapToken('') is deliberately a no-op, and
 * `delete window.MAP_TOKEN` removed the bridge's accessor while its install flag stayed set, so the bridge
 * never came back and the OLD token stayed live. This empties the value through the same channel.
 */
export function clearMapToken() {
  if (typeof window === 'undefined') return
  const had = readStored() || (typeof window.MAP_TOKEN === 'string' && window.MAP_TOKEN)
  installBridge()
  window[KEY] = ''
  if (!Object.getOwnPropertyDescriptor(window, 'MAP_TOKEN')?.get) { try { window.MAP_TOKEN = '' } catch { /* host-owned */ } }
  if (had) { try { window.dispatchEvent(new CustomEvent(EVENT, { detail: '' })) } catch { /* pre-CustomEvent host */ } }
}

/**
 * Adopt `window.MAP_TOKEN` as a source, in BOTH directions and for the whole life of the page.
 *
 * Every generated leaf assigns `window.MAP_TOKEN`, some of them from an async fetch. Replacing that
 * property with an accessor means such an assignment publishes to every element automatically —
 * which is what makes this fix reach pages nobody regenerates. Installed once per bundle; guarded
 * because N bundles on one page would otherwise stack N accessors on the same property.
 */
function installBridge() {
  if (typeof window === 'undefined') return
  // Installed AND still in place: a host (the studio's old Clear did) can `delete window.MAP_TOKEN`, which
  // removes the accessor while the flag stays set — then nothing was ever adopted again. Re-install.
  if (window[FLAG] && Object.getOwnPropertyDescriptor(window, 'MAP_TOKEN')?.get) return
  // Seed from whatever the page already set before this bundle loaded.
  const existing = typeof window.MAP_TOKEN === 'string' ? window.MAP_TOKEN : ''
  if (existing && !readStored()) window[KEY] = existing
  try {
    Object.defineProperty(window, 'MAP_TOKEN', {
      configurable: true,
      get() { return readStored() },
      set(v) { publishMapToken(v) },
    })
    window[FLAG] = true
  } catch {
    // A host may have made MAP_TOKEN non-configurable. Reading it still works through the ladder
    // below, so degrade to "no live adoption" rather than throwing during bundle init.
  }
}

/**
 * A reactive view of the page's shared map token.
 * @returns {import('vue').Ref<string>} updates when any element publishes a token
 */
export function useSharedMapToken() {
  installBridge()
  const token = ref(readStored())
  if (typeof window !== 'undefined') {
    const onChange = () => { token.value = readStored() }
    window.addEventListener(EVENT, onChange)
    // A composable may be called outside a component (rare here); guard so it cannot throw.
    try { onBeforeUnmount(() => window.removeEventListener(EVENT, onChange)) } catch { /* not in setup */ }
  }
  return token
}

/**
 * profile-config.tokenUrl: a token SERVICE the element asks when it was handed no token (the studio's
 * header and the gallery write it; nothing used to read it). Same contract as the leaf pages' ladder:
 * JSON {token|tk|accessToken} or a bare string, and only a PUBLIC token (pk.…) is accepted. One fetch per
 * URL per page; the answer is published page-wide. While it is in flight, window.__doxaMapTokenPending
 * holds the promise, so a map about to start on Mapbox waits for it instead of failing tokenless.
 * @returns {Promise<string>} the token, or '' when the service did not give one
 */
export function fetchMapToken(url) {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(String(url || ''))) return Promise.resolve('')
  const cache = (window.__doxaMapTokenFetches = window.__doxaMapTokenFetches || {})
  if (cache[url]) return cache[url]
  const p = retryFetch(url)
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return (r.headers.get('content-type') || '').includes('json') ? r.json() : r.text() })
    .then((d) => {
      const tk = String((typeof d === 'string' ? d : d && (d.token || d.tk || d.accessToken)) || '').trim()
      if (!tk.startsWith('pk.')) return ''
      publishMapToken(tk)
      return tk
    })
    .catch((e) => { console.warn(`[map token] ${url}: ${e && e.message ? e.message : e}`); return '' })
    .finally(() => { if (window.__doxaMapTokenPending === p) window.__doxaMapTokenPending = null })
  window.__doxaMapTokenPending = p
  cache[url] = p
  return p
}
