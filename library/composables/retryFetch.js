/**
 * retryFetch.js — fetch(), with the same transient-blip retry the lazy components already get.
 *
 * ★ THE DEFECT AND WHAT IT IS NOT. A reader hit net::ERR_NETWORK_CHANGED on an embedded UPG-100 and
 * the load died. The URLs in his console were module URLs — locale JSON with ?import, useOptionalT.js,
 * useShadowStyles.js, useMapTheme.js — which look like lazy loads that need retrying. They are not: the
 * production build is IIFE with inlineDynamicImports (vite.config.js:216-220), so every one of those
 * modules is INSIDE the single bundle and is never fetched separately. Those failures are dev-server
 * module requests and cannot happen for a reader.
 *
 * ★ BUT THE FAILURE CLASS IS REAL IN PRODUCTION, one layer down. A built bundle still makes runtime
 * requests — the boundaries geojson, the people-group list, the prayer statistics, a detail lookup, a
 * token service — and not one of them retried. The same wifi switch, VPN flap or sleep-wake that killed
 * a dev load takes out whichever of those happened to be in flight, and the feature is simply
 * absent: an empty map, a missing outline, a statistic that never arrives. No error a reader can act on.
 *
 * So this is the fetch-shaped sibling of retryableAsyncComponent, deliberately with the SAME policy —
 * 3 attempts, growing backoff — because it is the same event being survived and two different answers
 * to "how long is a blip" would be worse than one.
 *
 * ★ IT RETRIES TRANSPORT FAILURES ONLY. A rejected fetch() is a network-layer failure; a 404 or a 500
 * RESOLVES, and retrying those would hide real breakage and hammer a struggling server. A 5xx is
 * arguably transient, but it is the server saying something, and this helper deliberately does not
 * second-guess it — the caller sees the response it would have seen.
 */

const DEFAULT_ATTEMPTS = 3
const DEFAULT_BACKOFF = (attempt) => attempt * 500

/**
 * @param {string|Request} input
 * @param {RequestInit} [init]
 * @param {Object} [opts]
 * @param {number} [opts.attempts]  total tries, including the first
 * @param {function} [opts.backoff] (attempt) => ms
 * @param {AbortSignal} [opts.signal] abort ends it immediately, without further attempts
 * @returns {Promise<Response>} the response, or the LAST transport error if every attempt failed
 */
export async function retryFetch(input, init = undefined, { attempts = DEFAULT_ATTEMPTS, backoff = DEFAULT_BACKOFF, signal = null } = {}) {
  let lastError
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted')
    try {
      return await fetch(input, init)
    } catch (err) {
      // An ABORT is a decision, not a blip: never retry one.
      if (err?.name === 'AbortError' || signal?.aborted) throw err
      lastError = err
      if (attempt >= attempts) break
      await new Promise((r) => setTimeout(r, backoff(attempt)))
    }
  }
  throw lastError
}

export default retryFetch
