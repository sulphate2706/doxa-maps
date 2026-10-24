/**
 * useDashboardData.js — RDASH phase 2: the single in-memory row store (kills the hardcode).
 *
 * Loads ALL people groups once + /statistics into a slug-keyed store. Uses the SHARED data layer
 * — sources.json (active source = pray-tools, its endpoints + defaultFields + lang) and getApiBaseUrl
 * (window.MAP_APP_API_URL / VITE_API_BASE_URL / pray.doxa.life) — but keeps the RAW API record per
 * row rather than DataSourceManager's normalized projection: the dashboard table/charts/CSV reference
 * raw fields ({value,label} objects like country_code, wagf_region, religion) and the CSV export must
 * serialize the FULL API record. DataSourceManager.normalizeData renames fields to system names and
 * drops no-coordinate rows (geo set for the map layer, phase 7) — wrong shape for this store.
 *
 * Shadow-DOM safe: pure data, no DOM/style. Reuses read-only @map config without editing it.
 */
// KIT LANDING 4d-2: moved from plugin-designs/research-dashboard/src/composables/. It needed no
// adapter — every import was already @map/ — and it injects profileConfig in a try/catch because it
// can be called outside setup, which is the one property the move had to preserve.

import { ref, shallowRef, inject } from 'vue'
import { getApiBaseUrl } from '@map/api/apiBaseUrl.js'
import { getRuntimeLocale } from '@map/i18n/index.js'
import sourcesConfig from '@map/api/sources.json'
import { applyPeopleGroupList, resolvePeopleGroupList, LIST_DEFAULT } from '@map/lists/peopleGroupList.js'

export function useDashboardData(dataOpts = {}) {
  const loading = ref(false)
  const error = ref(null)
  const rowStore = shallowRef(new Map())  // slug (PK) -> full raw API record
  const rows = shallowRef([])             // array view of the same records
  const stats = ref(null)                 // /statistics global aggregates (KPI baselines)
  const total = ref(0)                    // rowStore size (live-data marker; mock had 3)

  // Which sources.json source the rows come from. Honors the profile's declared
  // config.data.source (parameterizable) and falls back to the shared activeSource,
  // preserving current pray-tools behavior. Exposed so the shell can normalize the
  // SAME source's fieldMappings for the geocoder dataStore (rows + normalization stay
  // in lockstep — no desync if a dashboard ever points at a non-active source).
  const sourceId = dataOpts.source || sourcesConfig.activeSource
  // The map's people-group LIST (library/lists/): read here, in setup, where inject works.
  let profileConfig = null
  try { profileConfig = inject('profileConfig', null) } catch (_) { /* called outside setup */ }

  // ★ THE READER'S LOCALE, READ IN SETUP WHERE inject WORKS (the same reason profileConfig is).
  // This dashboard asked the API for lang=en on every request, because sources.json freezes that
  // value and nothing here ever overrode it. The effect was not a uniformly English page — it was
  // WORSE: DashboardChartsRail localizes its country labels through countryName(), so at ?lang=ar
  // the top-countries chart read الصين while the table row beneath it read "People's Republic of
  // China". A page that is half-translated looks like a translation bug in the half that works.
  //
  // DataSourceManager.js:261 has done exactly this for its own callers all along —
  // `if (this.locale) extraParams.lang = this.locale` — and doxa-research-map, doxa-simple-map and
  // country-posters all pass a locale in. This composable simply never got the same treatment.
  //
  // BOTH CHANNELS, because the locale genuinely arrives by either: `lang` is provided by
  // ProfileLoader for an element configured through profile-config, and window[PAGE_LOCALE_KEY] is
  // what a generated leaf sets from ?lang= — which is the URL a person actually shares. Measured on
  // the regions dashboard, where reading only one of the two left every data label English on the
  // shared-link path while the chrome translated.
  let injectedLang = null
  try { injectedLang = inject('lang', null) } catch (_) { /* called outside setup */ }

  async function load() {
    loading.value = true
    error.value = null
    try {
      const src = sourcesConfig?.sources?.[sourceId] || {}
      const base = getApiBaseUrl()
      const bulk = src.endpoints?.bulk || '/api/people-groups/list'
      const fields = (src.defaultFields || []).join(',')
      // The runtime locale WINS over the source's frozen value; 'en' remains the floor. Resolved at
      // REQUEST time, not at setup: a locale switch refetches through this same function, and a
      // value captured once would pin the dashboard to whichever locale happened to load first.
      const runtime = (injectedLang && injectedLang.value) || getRuntimeLocale() || ''
      const lang = runtime || src.queryParams?.lang || 'en'

      // ── 1) bulk list (shared config: endpoint + defaultFields + lang + cache-bust) ──
      const listUrl = `${base}${bulk}?${fields ? `fields=${fields}&` : ''}lang=${lang}&_=${Date.now()}`
      const res = await fetch(listUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error(`list HTTP ${res.status}`)
      const json = await res.json()
      const raw = await applyPeopleGroupList(Array.isArray(json) ? json : (json.posts || json.data || json.results || []), profileConfig)
      const map = new Map()
      for (const r of raw) {
        const slug = r && (r.slug || r.id)
        if (slug) map.set(slug, r)
      }
      rowStore.value = map
      rows.value = raw
      total.value = map.size

      // ── 2) /statistics seeds KPI baselines ──
      const statEndpoint = src.endpoints?.statistics || '/api/people-groups/statistics'
      // /statistics describes DOXA's whole list, so under any other list its totals would be about
      // the wrong set of groups. They are optional baselines; leave them out there.
      if (resolvePeopleGroupList(profileConfig) === LIST_DEFAULT) try {
        const sres = await fetch(`${base}${statEndpoint}?_=${Date.now()}`, { cache: 'no-store' })
        if (sres.ok && (sres.headers.get('content-type') || '').includes('json')) {
          stats.value = await sres.json()
        }
      } catch (_) { /* KPI baselines optional; the list is the source of truth */ }

      if (total.value === 0) error.value = 'No records loaded from the live API.'
    } catch (e) {
      error.value = (e && e.message) ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  return { loading, error, rowStore, rows, stats, total, load, sourceId }
}
