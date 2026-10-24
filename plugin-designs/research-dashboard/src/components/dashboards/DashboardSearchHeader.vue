<script setup>
/**
 * DashboardSearchHeader — the 4 facet search bars (DOXA-LIB-3, the reuse proof).
 *
 * Renders one standalone GeocoderComponent per `config.search` entry (people-groups /
 * regions / language / religion). Each bar CONSUMES the SAME `useGeocoderSearch`
 * composable the map profiles use (LIB-1) — but swaps the map sink for a `busAdapter`
 * that lands the result on the dashboard's selectionBus. That is the headline reviewer
 * artifact: the kind-switch (KIND_PROPERTY + the per-kind filter-expression builder) runs
 * in EXACTLY ONE place — the composable — for BOTH the map profiles AND this dashboard.
 *
 * This component does NOT re-implement the kind resolution. The composable resolves the
 * geocoder event to { kind, value, property, expr }; the busAdapter only maps the already
 * RESOLVED `kind` to the dashboard's OWN facet key (wagf_region / country_code /
 * primary_language / religion) and lands a byte-match-safe value (per spec §8 — derived
 * from a member row, not the geocoder's display label).
 *
 * Brushing-and-linking: every panel re-derives from bus.filterSet / bus.selectionSet, so a
 * pick in any bar narrows the WHOLE dashboard (table, charts, facet rail, KPIs, map) with
 * zero panel edits — a new input source plugging into the bus.
 *
 * DATA (DASH-FIX-8): the geocoder's local suggestions come from the injected `dataStore`
 * (useEntitySearch reads dataStore.sources[searchSourceId].features). The dashboard loads its
 * rows into its OWN store (useDashboardData), so useDashboardShell now ALSO normalizes those
 * already-fetched rows through the SAME DataSourceManager the map profiles use and exposes
 * them as a shared `dataStore` under `searchSourceId` (provided here via inject). That makes
 * useEntitySearch build an IDENTICAL index → the dashboard bars produce the SAME suggestions as
 * research-map, with no second network request. The bar → composable → bus wiring below is
 * independent of that and is what this kit proves.
 */
import { inject, ref, computed, unref, onMounted } from 'vue'
import GeocoderComponent from '@map/components/map-controls/GeocoderComponent.vue'
import { useGeocoderSearch } from '@map/composables/useGeocoderSearch.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { resolveMapProvider } from '@map/composables/useMapProvider.js'

const bus = inject('selectionBus', null)
const dash = inject('dashboardData', null)
const cfg = inject('dashboardConfig', {})
const mapboxToken = inject('mapboxToken', ref(''))
// The source id the shell keyed its DataSourceManager-normalized features under
// (dataStore.sources[searchSourceId].features). Passed to each GeocoderComponent
// as :data-source-id so useEntitySearch reads that exact source — mirrors how the
// map profiles wire :data-source-id="dataSource" (DASH-FIX-2).
const searchSourceId = inject('searchSourceId', '')

// ★ WHICH ENGINE THIS DASHBOARD IS RUNNING ON, because the search bar has to agree with it.
// The same ladder every map panel uses: profile-config.provider -> ?provider= -> window.MAP_PROVIDER
// -> mapbox.
// inject() at setup top level, NOT inside the computed: Vue only resolves an injection during
// setup, and a call from inside a computed returns undefined with a warning — which would have
// silently resolved every host to the default engine, i.e. exactly the bug being fixed.
const profileConfig = inject('profileConfig', null)
const provider = computed(() => resolveMapProvider(profileConfig))

const token = computed(() => unref(mapboxToken) || '')

// ── Host-independent geocoder-plugin loader ────────────────────────────────────
// GeocoderComponent builds the bars from the global `MapboxGeocoder` (the
// mapbox-gl-geocoder plugin). The MAP profiles get it from a <script> in their
// host page; but a reusable dashboard bundle must NOT depend on the embedding
// host remembering to add that script. So load the plugin from the Mapbox CDN
// ourselves (mirrors how GeocoderComponent injects the geocoder CSS at runtime)
// and only mount the bars once it's ready — works in ANY host with zero wiring.
// ★ AND UNDER MapLibre IT MUST NOT BE THE MAPBOX ONE. This preloader fetched
// api.mapbox.com/.../mapbox-gl-geocoder.min.js unconditionally, so a partner who chose MapLibre
// precisely to avoid Mapbox still sent every visitor's IP to api.mapbox.com the moment this
// dashboard mounted — the keyless embed's whole reason for existing, cancelled by one hardcoded
// URL. (Found by studio's Mapbox-globals audit.)
//
// GeocoderComponent already loads whichever plugin its `provider` says (ensureMapboxGeocoder /
// ensureMaplibreGeocoder), so under MapLibre the right thing to do here is NOTHING: mark ready and
// let the component fetch its own from jsDelivr. The mapbox preload stays for the mapbox path,
// where it is what keeps a host from having to remember a <script> tag.
const GEOCODER_JS = 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.min.js'
const pluginReady = ref(false)
function ensureGeocoderPlugin() {
  if (typeof window === 'undefined') return
  if (provider.value === 'maplibre') { pluginReady.value = true; return }
  if (typeof window.MapboxGeocoder !== 'undefined') { pluginReady.value = true; return }
  let s = document.querySelector(`script[src="${GEOCODER_JS}"]`)
  if (!s) {
    s = document.createElement('script')
    s.src = GEOCODER_JS
    s.async = true
    document.head.appendChild(s)
  }
  s.addEventListener('load', () => { pluginReady.value = true })
  // If another mount already loaded it between the check and here, don't hang.
  if (typeof window.MapboxGeocoder !== 'undefined') pluginReady.value = true
}
onMounted(ensureGeocoderPlugin)

// RESOLVED geocoder kind → the dashboard's OWN facet key. This is NOT a copy of the
// composable's KIND_PROPERTY (which maps kind → a MAPBOX PIN property); these are the
// dashboard facet keys the rest of the panels filter on. The composable already did the
// kind-switch; here we only choose which facet bucket the resolved value lands in.
const KIND_FACET = {
  region: 'wagf_region',
  country: 'country_code',
  block: 'wagf_block',
  province: 'wagf_block',
  religion: 'religion',
  'language-family': 'primary_language',
  language: 'primary_language',
  dialect: 'primary_language',
}

// Resolve the BYTE-MATCH-SAFE facet value (spec §8). The geocoder's display label may not
// byte-match what config.facets[facet].get(row) returns (e.g. country "India" vs ISO-3
// "IND"); if it doesn't, setFilter narrows to an empty set ("blank dashboard"). So derive
// the value FROM a member row using the SAME accessor the facet rail/table/charts use —
// guaranteeing search-set and facet-set share one string space. Fall back to the resolved
// value / display label only when no member row is found.
function resolveFacetValue(facet, r, evt) {
  const acc = cfg.facets?.[facet]?.get
  const store = dash?.rowStore?.value
  const memberId = (evt?.memberIds && evt.memberIds[0]) || evt?.slug
  if (acc && store && memberId) {
    const row = store.get(memberId)
    if (row) {
      const v = acc(row)
      if (v != null && v !== '') return v
    }
  }
  return r?.value != null && r.value !== '' ? r.value : evt?.label
}

// One bar = one GeocoderComponent + one useGeocoderSearch call (its own busAdapter).
// config.search is fixed at setup time, so building the bars once is safe.
const bars = (cfg.search || []).map((entry) => {
  const geocoderRef = ref(null)
  // each bar remembers what it last landed so clear() (the geocoder X) can undo
  // exactly its own contribution: a facet filter OR a member selection.
  const state = { _lastFacet: null, _selectedMembers: false }

  // Land a group's member rows on the selectionSet in ONE commit. A bloc / cluster /
  // people-group AGGREGATE has no dashboard facet key (the dashboard facets are
  // region / country / block / religion / language), so instead of doing nothing we
  // MARK its member rows — the dashboard equivalent of research-map's "dim to just
  // this group's members".
  //
  // Uses bus.setSelection() (the bulk replace primitive) rather than hand-mutating the
  // raw Set: selectionSet is deliberately NOT reactive, so a direct .clear()/.add() would
  // never bump selectionVersion and every dependent computed would silently go stale.
  // It is also one commit instead of two — a big PG ("Deaf", 100+ countries) repaints the
  // map once. See the performance contract in useSelectionBus.js.
  function selectMembers(memberIds, name) {
    const members = Array.isArray(memberIds) ? memberIds.filter(Boolean) : []
    if (!members.length || !bus) return false
    bus.setSelection(members)
    bus.emit('focusRow', { slug: members[0], name })
    return true
  }

  const busAdapter = {
    // r = { kind, value, property, expr } already resolved by the composable.
    aggregate(r, evt) {
      if (!bus) return
      const facet = KIND_FACET[r.kind]
      if (facet) {
        const value = resolveFacetValue(facet, r, evt)
        if (value == null || value === '') return
        bus.setFilter(facet, value)
        state._lastFacet = facet
        return
      }
      // No dashboard facet for this resolved kind (affinity-bloc / cluster /
      // people-group aggregate) → brush the group's member rows instead of no-op.
      if (selectMembers(evt?.memberIds, r.value)) state._selectedMembers = true
    },
    peopleGroup(f) {
      const slug = f?.properties?.slug || f?.slug
      if (!slug || !bus) return
      bus.toggleSelect(slug)
      bus.emit('focusRow', { slug, name: f?.properties?.name })
    },
    clear() {
      if (!bus) return
      if (state._lastFacet) { bus.setFilter(state._lastFacet, null); state._lastFacet = null }
      if (state._selectedMembers) { bus.clearSelection(); state._selectedMembers = false }
    },
  }

  // SAME composable as the map profiles — only the sink is swapped (busAdapter) and the
  // kinds are scoped to this bar's subset. No map / clustering / mapStore needed.
  const handlers = useGeocoderSearch({
    busAdapter,
    supportedKinds: entry.kinds,
    geocoderRef,
    mapId: entry.id,
  })

  return { entry, geocoderRef, handlers }
})

useShadowStyles(`
  /* position:relative + high z-index so the absolutely-positioned geocoder
     suggestion dropdowns render ABOVE the stats/map/table rows below this header.
     overflow MUST be visible — overflow-x:auto created a clipping context that
     hid the dropdown extending below the single-row header. */
  .rd-searchbar-header{ position:relative; z-index:60; display:flex; align-items:center; gap:8px;
    height:100%; padding:6px 14px; background:var(--rd-panel,#fff);
    border-bottom:1px solid var(--rd-line, #d1d4cd); box-sizing:border-box; overflow:visible; }
  .rd-searchbar{ position:relative; flex:1 1 0; min-width:150px; }
  .rd-searchbar .dg-standalone-geocoder .mapboxgl-ctrl-geocoder{ width:100%!important; max-width:none!important;
    box-shadow:none!important; border:1px solid var(--rd-line, #d1d4cd); border-radius:var(--r-md,6px);
    background:var(--rd-bg, #f3f3f1); }
  .rd-searchbar .dg-standalone-geocoder{ width:100%; }
  /* lift the mapbox-gl-geocoder suggestions list above sibling dashboard panels */
  .rd-searchbar .mapboxgl-ctrl-geocoder .suggestions,
  .rd-searchbar .mapboxgl-ctrl-geocoder ul.suggestions,
  .rd-searchbar .mapboxgl-ctrl-geocoder--results{ z-index:200!important; }
`, 'rd-search-header')
</script>

<template>
  <div class="rd-searchbar-header" data-region="search" data-sub="search-header">
    <div v-for="bar in bars" :key="bar.entry.id" class="rd-searchbar" :data-search-bar="bar.entry.id">
      <GeocoderComponent
        v-if="pluginReady"
        :ref="(el) => { bar.geocoderRef.value = el }"
        standalone
        :provider="provider"
        :access-token="token"
        :data-source-id="searchSourceId"
        :placeholder="bar.entry.label"
        :active-context="bar.entry.context"
        @aggregate-result="bar.handlers.onAggregateResult"
        @people-group-result="bar.handlers.onPeopleGroupResult"
        @clear="bar.handlers.onClear" />
    </div>
  </div>
</template>
