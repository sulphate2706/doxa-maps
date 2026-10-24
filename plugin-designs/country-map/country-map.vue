<script setup>
/**
 * country-map.vue — the standalone country map, as its own element.
 *
 * @element doxa-country-map
 * @description One country's people groups on a map, as a single droppable element — the pins,
 * their prayer colouring and their popups, without the regions dashboard's stat cards, chooser
 * or table. Use it where a page already knows which country it is about: give it countryCodes
 * and it fetches and draws that country's groups itself.
 *
 * ★ WHY THIS BUNDLE EXISTS. DX-life's country pages render nothing where a map belongs. The map
 * they need has been in this repo since the regions clone landed, but it was reachable only by
 * loading the whole regions dashboard — a bundle that fetches the people-group list, builds four
 * stat cards, a region chooser and a table, none of which a country page wants. So this is not a
 * new map. It is the SAME component (now at @map/components/maps/RegionCountryMap.vue) given its
 * own element and its own bundle, so a host can drop one tag on a country page.
 *
 * THE CONTRACT, as confirmed: countryCodes, center, zoom, bounds, colorByPrayer, researchUrl,
 * prayBaseUrl. Every one arrives through profile-config, the same channel every other element in
 * this repo uses, so a generated page and a hand-written host page are configured identically.
 *
 * colorByPrayer is a BOOLEAN in the contract and colorMode is a STRING inside the component.
 * That is a translation, not a rename, and it is done here rather than by widening the component:
 * a host asking for prayer colouring should not have to know the vocabulary of the mode registry.
 *
 * countryUrl is additive and not in the confirmed contract. It is here because the component's
 * country link needs a base and DX-life's country pages live under /regions/ — a host that does
 * not set it gets exactly the documented default.
 */
import { computed, inject, ref, onMounted, watch } from 'vue'
import RegionCountryMap from '@map/components/maps/RegionCountryMap.vue'
import { toNumber, PEOPLE_GROUP_LIST_FIELDS } from '@map/utils/countries-meta.js'
import { peopleGroupPoints, PEOPLE_GROUP_POINT_FIELDS } from '@map/utils/peopleGroupPoints.js'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'
import { useRegionsI18n } from '@map/i18n/useRegionsI18n.js'

const props = defineProps({
  profileConfig: { type: String, default: '' },
})

// ★ THE CONFIG ARRIVES BY INJECT, NOT AS A PROP. The custom element this bundle registers IS
// ProfileLoader, which parses the profile-config ATTRIBUTE and provides the parsed object to its
// descendants; a profile's own profileConfig string prop is always empty under it. Inject first,
// fall back to the prop so a direct <doxa-country-map profile-config='...'> outside ProfileLoader
// still works. Measured on region-dashboards 2026-09-23, where reading the prop silently fell
// back to defaults that happened to be right until one of them was not.
const injectedCfg = inject('profileConfig', null)
const cfg = computed(() => {
  const inj = injectedCfg && (injectedCfg.value !== undefined ? injectedCfg.value : injectedCfg)
  if (inj && typeof inj === 'object') return inj
  if (!props.profileConfig) return {}
  try { return JSON.parse(props.profileConfig) || {} } catch { return {} }
})

// A host may write country-codes as an array or as "TCD,NER,MLI" — an HTML attribute is a string,
// and JSON inside an attribute inside JSON is the shape people get wrong. Both are accepted.
const countryCodes = computed(() => {
  const v = cfg.value.countryCodes
  if (Array.isArray(v)) return v.filter(Boolean).map((c) => String(c).toUpperCase())
  if (typeof v === 'string') return v.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
  return []
})

// ★ undefined, NOT null, WHEN THE HOST SETS NEITHER. Vue applies a prop default only for
// undefined; an explicit null OVERRIDES it. Passing null here therefore replaced
// RegionCountryMap's center default [20, 10] with null, which reached the Map constructor, and
// MapLibre's LngLat.convert(null) throws before a style or tile is ever requested.
// MEASURED on the drop-in, 12 of 12 cases: the map never started, 0 network requests to the tile
// host, and the page showed "a map-token or connection problem" - which blamed the wrong thing
// entirely. center and bounds are both documented OPTIONAL in this element's contract, and the
// manifest's own embed snippet sends neither.
const center = computed(() => (Array.isArray(cfg.value.center) ? cfg.value.center : undefined))
const bounds = computed(() => (Array.isArray(cfg.value.bounds) ? cfg.value.bounds : undefined))
const zoom   = computed(() => (Number.isFinite(Number(cfg.value.zoom)) ? Number(cfg.value.zoom) : 2))

// The contract's boolean, translated into the component's mode vocabulary at the one place that
// knows both. false/absent keeps the component's own default rather than naming it again here.
const colorMode = computed(() => (cfg.value.colorByPrayer ? 'prayer' : undefined))

const researchUrl = computed(() => cfg.value.researchUrl || 'https://doxa.life/research/')
const prayBaseUrl = computed(() => cfg.value.prayBaseUrl || 'https://pray.doxa.life')
const countryUrl  = computed(() => cfg.value.countryUrl  || 'https://doxa.life/regions/')
const languageCode = computed(() => cfg.value.languageCode || cfg.value.locale || cfg.value.lang || 'en')
const { t } = useRegionsI18n()

// ★ THE ELEMENT FETCHES ITS OWN PINS. prayBaseUrl is in the contract, and it is the API base the
// rest of this repo reads people groups from — an element given only a country code and a base URL
// and no way to fetch would draw a country outline with nothing in it, which is the blank page it
// exists to fix. Same endpoint, same fields and same mapping the regions dashboard uses; the only
// difference is that this one asks for a country rather than the world.
const points = ref([])
const loading = ref(true)
const loadFailed = ref(false)

// ★ ONLY THE NEWEST REQUEST MAY WRITE. loadPoints is async and re-runs on a locale or country
// change, so two can be in flight at once -- and the one that STARTED first can FINISH last. Both
// used to assign points, so a slow earlier response overwrote a newer one and the map showed the
// previous country's pins with no error and no way for the reader to tell. Every run takes a ticket
// and a stale ticket writes nothing: not the points, not loadFailed, not loading. fetch is left to
// complete rather than aborted, because the response is cached for the next switch back.
let runId = 0

async function loadPoints() {
  const mine = ++runId
  const current = () => mine === runId
  loading.value = true
  loadFailed.value = false
  try {
    const url = `${prayBaseUrl.value}/api/people-groups/list?fields=${PEOPLE_GROUP_POINT_FIELDS},${PEOPLE_GROUP_LIST_FIELDS}&lang=${languageCode.value}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    // ★ THE HOST'S LIST IS APPLIED TO THE RAW POSTS, BEFORE THEY BECOME POINTS. `list` is a
    // profile-config prop every other consumer of this endpoint honours — DataSourceManager,
    // useDashboardData, useCsvExport, peopleGroupRecords and the people-groups grid all call
    // applyPeopleGroupList on the rows they fetched. This element did not, so a host that asked for
    // one curated list got the WHOLE endpoint drawn on its country map and nothing said so: the pins
    // looked like data rather than like the wrong list. Applying it here, on data.posts rather than
    // on the mapped points, is what keeps this element and a dashboard showing the same country from
    // disagreeing about which groups are in it — the same reason the country filter below is
    // client-side.
    // The default list returns the rows untouched and makes no fetch, so an unconfigured host pays
    // nothing; a list whose membership cannot be loaded yields NO groups rather than the wrong ones,
    // which is applyPeopleGroupList's own contract and the safer failure for a prayer surface.
    const posts = await applyPeopleGroupList(Array.isArray(data.posts) ? data.posts : [], cfg.value)
    const all = peopleGroupPoints(posts, toNumber)
    // Filter HERE rather than asking the API for one country: the endpoint returns the whole list
    // and every other consumer in this repo filters client-side, so a country page and a dashboard
    // showing the same country cannot disagree about which groups are in it.
    // ★ NO COUNTRY MEANS NO PINS, NOT EVERY PIN. This used to fall through to `all` when
    // countryCodes was empty, which is the opposite of what this element is: a host that forgets
    // the attribute, or misspells it, or passes a value neither array nor comma-string, got the
    // ENTIRE global list — 2,106 groups across 175 countries, against a typical country's 1 and
    // the largest country's 855 — drawn with no country outline at all, because the child's fill
    // expression matches nothing on an empty list. A wall of worldwide pins looks like data rather
    // than like the misconfiguration it is. Empty now draws nothing and says so below.
    const want = new Set(countryCodes.value)
    if (!want.size) {
      // Addressed to whoever embedded the element, not to the reader: this is a missing attribute,
      // not a data state, so it belongs in the console beside the fetch error rather than in a
      // translated sentence on the page.
      console.error('[country-map] no country-codes given, so there is nothing to draw. Set '
        + 'countryCodes in profile-config, as an array (["TCD"]) or a comma string ("TCD,NER").')
    }
    if (!current()) return
    points.value = want.size ? all.filter((p) => want.has(String(p.code).toUpperCase())) : []
  } catch (error) {
    if (!current()) return
    console.error('[country-map] fetch error:', error)
    loadFailed.value = true
    points.value = []
  } finally {
    // The newest run owns the spinner: an older one finishing later must not clear it while the
    // current fetch is still running.
    if (current()) loading.value = false
  }
}

onMounted(loadPoints)
// A locale change REFETCHES: the popup's labels — country, religion, people-group names — come
// from the API's ?lang=, not from our catalogue, so re-rendering alone leaves them in the old
// language. Measured on the dashboard, where exactly this left every country name in English.
// ★ A STRING, NOT AN ARRAY -- AND THAT IS THE WHOLE FIX. This getter used to return a new array
// literal, and Vue compares a watch's value with Object.is, so a fresh array is ALWAYS "changed".
// Both computeds read the injected cfg, so the effect re-ran on ANY profile-config change and the
// callback then fired unconditionally: toggling isDark, or a host adding pinHint, refetched all
// 2,106 records and redrew the map. MEASURED with real Vue -- an isDark flip produced a refetch,
// and so did adding an unrelated key. A joined string compares by VALUE, so only a real change to
// the language or the country list refetches. The composite re-forward makes config writes routine,
// which is what turned a latent waste into one on every locale switch upstream.
watch(() => `${languageCode.value}|${countryCodes.value.join(',')}`, loadPoints)
</script>

<template>
  <RegionCountryMap
    :points="points"
    :country-codes="countryCodes"
    :center="center"
    :bounds="bounds"
    :zoom="zoom"
    :color-mode="colorMode"
    :research-url="researchUrl"
    :pray-base-url="prayBaseUrl"
    :country-url="countryUrl"
  />
  <!-- The REGIONS wording is wrong on this element: it has no region, it has one or more countries,
       and it fetches PEOPLE GROUPS. A reader whose country map failed was told the region data
       failed, in all eleven locales — ar "بيانات المناطق", ru "данные по регионам", de
       "Regionsdaten" all say regions. The people-groups sentence is already in the catalogue and
       already translated in all eleven, so this costs no new string. -->
  <!-- ★ THE SPINNER STATE EXISTED AND WAS NEVER SHOWN. `loading` was assigned in three places and
       read in none, so a reader on a country page waited on an EMPTY map with no outline, no pins
       and nothing to say why -- indistinguishable from a country with no people groups, and this
       element fetches the whole 2,106-record list before it can draw one pin. The string is already
       in the catalogue in all eleven locales, so saying so costs no new translation. -->
  <p v-if="loading" class="cm-status" role="status">{{ t('Loading results...') }}</p>
  <p v-else-if="loadFailed" class="cm-status" role="status">{{ t('People groups could not be loaded. This is a connection problem, not a filter.') }}</p>
</template>
