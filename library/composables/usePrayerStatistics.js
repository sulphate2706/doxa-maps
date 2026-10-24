/**
 * usePrayerStatistics.js — the ONE authoritative prayer-coverage source of truth.
 *
 * The prayer-tab legend used to COUNT loaded pins client-side (peoplePraying > 0),
 * which produced 435 — but the parent doxa-life site shows 601. They diverged for
 * two reasons: (1) a different field — the parent counts `people_committed > 0`, the
 * client scan counted `people_praying > 0`; and (2) a different record set — the map
 * only counts the pins it has loaded. The server `/api/people-groups/statistics`
 * aggregate is computed over the FULL dataset and is what the parent trusts, so every
 * surface (research-map, simple-map, dashboard, parent site) must read its numbers
 * from HERE instead of recomputing locally.
 *
 * The upstream endpoint returns BOTH metrics; the parent treats the *committed* one as
 * canonical (its server route renames `total_with_prayer_committed` → `total_with_prayer`
 * and `total_with_100_committed` → `total_with_full_prayer`). We mirror that exactly:
 *
 *   withPrayer     = total_with_prayer_committed   (601 — "1+ committed to pray")
 *   withFullPrayer = total_with_100_committed      (0   — full coverage, >= 100 committed)
 *   total          = total                         (2106)
 *
 * → none = total - withPrayer (1505), partial = withPrayer - withFullPrayer (601),
 *   full = withFullPrayer (0). These are the 601 / 1505 / 0 the parent shows.
 *
 * Shared-layer contract: the fetch is a MODULE-LEVEL singleton, so all profiles/legends
 * on a page share ONE request and ONE reactive result — the single source of truth.
 * Uses the same shared data config as the rest of the app (sources.json activeSource
 * endpoint + getApiBaseUrl); no DOM, shadow-DOM safe.
 */
import { retryFetch } from './retryFetch.js'
import { ref } from 'vue'
import { getApiBaseUrl } from '../api/apiBaseUrl.js'
import sourcesConfig from '../api/sources.json'

// ── Module-level singleton state (shared across every usePrayerStatistics() call) ──
const total          = ref(0)
const withPrayer     = ref(0)   // total_with_prayer_committed (partial-or-full, committed)
const withFullPrayer = ref(0)   // total_with_100_committed
const loaded         = ref(false)
const loading        = ref(false)
const error          = ref(null)
let   inflight       = null      // dedupe concurrent loads → one network request

async function load() {
  if (loaded.value) return        // already have the authoritative numbers
  if (inflight) return inflight   // a load is already in progress — await it
  loading.value = true
  error.value = null
  inflight = (async () => {
    try {
      const src  = sourcesConfig?.sources?.[sourcesConfig.activeSource] || {}
      const base = getApiBaseUrl()
      const endpoint = src.endpoints?.statistics || '/api/people-groups/statistics'
      const res = await retryFetch(`${base}${endpoint}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`statistics HTTP ${res.status}`)
      const d = await res.json()
      total.value = Number(d.total || 0)
      // Committed is canonical (matches the parent site). Fall back to the
      // prayer-based fields only if the committed ones are absent, so an older
      // upstream shape still yields a number rather than 0.
      withPrayer.value     = Number(d.total_with_prayer_committed ?? d.total_with_prayer ?? 0)
      withFullPrayer.value = Number(d.total_with_100_committed ?? d.total_with_full_prayer ?? 0)
      loaded.value = true
    } catch (e) {
      error.value = (e && e.message) ? e.message : String(e)
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

/**
 * @returns reactive prayer-coverage aggregate + derived per-bucket counts.
 *   total, withPrayer, withFullPrayer  — raw authoritative numbers
 *   noPrayerCount / hasPrayerCount / fullPrayerCount — the 1505 / 601 / 0 buckets
 *   loaded — false until the fetch resolves (consumers can fall back meanwhile)
 *   load() — idempotent; safe to call from every consumer (deduped)
 */
export function usePrayerStatistics() {
  return {
    total, withPrayer, withFullPrayer, loaded, loading, error, load,
    // Derived, EXCLUSIVE buckets that sum to `total` (partial excludes full),
    // mirroring the parent's "601 partial / 0 full / 1505 none".
    noPrayerCount:   () => Math.max(0, total.value - withPrayer.value),
    hasPrayerCount:  () => Math.max(0, withPrayer.value - withFullPrayer.value),
    fullPrayerCount: () => withFullPrayer.value,
  }
}

export default usePrayerStatistics
