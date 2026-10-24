/**
 * usePrayedLocally.js — the "my dot glows" encouragement loop.
 *
 * WHEN someone clicks "Pray for them", their dot turns glowing FOR THEM,
 * immediately, in this browser (localStorage) — the emotional reward that
 * closes the loop. It is deliberately TEMPORARY (TTL below): the LONG-LASTING
 * glow comes only from actually signing up on the prayer site, which registers
 * server-side and flips `peoplePraying` in the API for everyone. So the local
 * glow is the bridge of encouragement until the real signup shows up in the
 * data — and if they never complete signup, the glow quietly fades.
 *
 * Mechanism: pins color purely from the feature property `peoplePraying`
 * (see colors/prayer-progress.js + useMapLayers HAS_PRAYER). We patch that ONE
 * property (null/0 → 1) for locally-prayed slugs at data-build time — every
 * expression (color, ring, glow) lights up with zero style changes.
 *
 * Storage is sandbox-safe (try/catch — origin-isolated iframes throw).
 */

const KEY = 'doxa-prayed-local'
// The encouragement window: long enough to still glow when they come back
// tomorrow, short enough that an unconfirmed click doesn't masquerade as
// real coverage forever. Real signups persist via the API itself.
const TTL_MS = 7 * 24 * 60 * 60 * 1000

function readAll() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return (obj && typeof obj === 'object') ? obj : {}
  } catch (_) { return {} }
}

function writeAll(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)) } catch (_) { /* sandboxed */ }
}

/** Slugs prayed-for in this browser, expired entries pruned. */
export function prayedSlugs() {
  const now = Date.now()
  const all = readAll()
  let dirty = false
  for (const [slug, ts] of Object.entries(all)) {
    if (typeof ts !== 'number' || now - ts > TTL_MS) { delete all[slug]; dirty = true }
  }
  if (dirty) writeAll(all)
  return new Set(Object.keys(all))
}

/** Record a pray-click for a slug + announce it so live maps can re-glow. */
export function markPrayedLocally(slug) {
  if (!slug) return
  const all = readAll()
  all[slug] = Date.now()
  writeAll(all)
  try {
    window.dispatchEvent(new CustomEvent('doxa:prayed-locally', { detail: { slug } }))
  } catch (_) {}
}

/**
 * Patch a people-groups array: locally-prayed slugs with no real coverage get
 * peoplePraying=1 so they render as "Has Prayer". Real API values (>0) are
 * never touched — the server's truth always wins.
 */
export function applyLocalPrayer(list) {
  const set = prayedSlugs()
  if (!set.size || !Array.isArray(list)) return list
  return list.map((pg) => {
    const real = Number(pg && pg.peoplePraying) || 0
    if (real > 0 || !pg || !set.has(pg.slug)) return pg
    return { ...pg, peoplePraying: 1 }
  })
}
