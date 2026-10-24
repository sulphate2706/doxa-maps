<script setup>
/**
 * demo-map.vue — Application Profile: Demo Map
 *
 * @description Simple two-tab demo map. Tab 1 colors pins by religion (shared
 *              library strategy); Tab 2 paints all pins one custom purple
 *              (#8b5cf6) via this bundle's local `single-color.js` strategy.
 * @profile     demo-map
 * @bundle      demo-map
 * @element     demo-map
 *
 * Built by composing reusable @map/* library pieces (see documentation/reference.md):
 *   useMapInstance  — Mapbox map boot/teardown
 *   useMapData      — data load via DataSourceManager
 *   useMapLayers    — the 'language-family-pins' circle layer + popups
 *   useShadowStyles — Shadow-DOM-safe CSS injection
 * Everything demo-map-specific (tabs, mini legend, the purple strategy) lives
 * in this bundle's own folder — it modifies nothing in library/ or internal/.
 * For colors it imports only the registry seam from @map (colors/_registry.js)
 * and defines its purple strategy locally (single-color.js) — the intended way
 * to use the seam.
 */

import { inject, provide, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useMapInstance }  from '@map/composables/useMapInstance.js'
import { resolveMapProvider, setProjectionOn } from '@map/composables/useMapProvider.js'
import { useMapData }      from '@map/composables/useMapData.js'
import { useMapLayers }    from '@map/composables/useMapLayers.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { DataSourceManager } from '@map/utils/DataSourceManager.js'
import { getLanguageFamilyColor } from '@map/colors/language-family.js'
import { buildColorExpression, getColorStrategy, COLOR_MODES } from '@map/colors/_registry.js'

// Map toolbar — canonical modular control rail (MapToolbar slot-wrapper + button
// children). ThemeToggleButton is omitted: this profile has no theme-toggle
// handler; isDark defaults to false (profile-config may still flip it).
import MapToolbar       from '@map/components/map-controls/MapToolbar.vue'
import ZoomInButton     from '@map/components/map-controls/ZoomInButton.vue'
import ZoomOutButton    from '@map/components/map-controls/ZoomOutButton.vue'
import LocationButton   from '@map/components/map-controls/LocationButton.vue'
import FullscreenButton from '@map/components/map-controls/FullscreenButton.vue'
import ShareButton      from '@map/components/map-controls/ShareButton.vue'

// ─── Shadow DOM style injection ──────────────────────────────────────────────
useShadowStyles(`
  .dm-root { position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; }
  .dm-tab-bar { flex:0 0 auto;display:flex;align-items:center;background:#fff;
    border-bottom:2px solid #e0e0e0;box-shadow:0 2px 4px rgba(0,0,0,.08);height:48px;
    padding:0 12px;gap:4px;z-index:10; }
  .dm-tab { background:none;border:none;padding:0 20px;height:100%;font-size:14px;
    font-weight:500;color:#555;cursor:pointer;border-bottom:3px solid transparent;
    transition:color .15s,border-color .15s,background .15s;white-space:nowrap; }
  .dm-tab:hover { background:rgba(139,92,246,.06);color:#8b5cf6; }
  .dm-tab.active { color:#8b5cf6;border-bottom-color:#8b5cf6;background:rgba(139,92,246,.06); }
  .dm-map-area { flex:1 1 0;position:relative;overflow:hidden; }
  .dm-map-canvas { position:absolute;inset:0; }
  .dm-loading { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    background:#f8f9fa;color:#555;font-size:14px;z-index:5; }
  /* Failure state, NOT a cover: modelled on cities-internet's .gm-err so anything the
     map did manage to render stays visible around it. A spinner that outlives the
     failure reads as "slow" and the user just waits; this says the map is gone. */
  .dm-error { position:absolute;top:50%;left:12px;right:12px;z-index:7;transform:translateY(-50%);
    text-align:center;font-size:13px;line-height:1.5;color:#7f1d1d;background:rgba(255,255,255,.94);
    border:1px solid rgba(127,29,29,.25);border-radius:10px;padding:12px 14px;
    box-shadow:0 2px 10px rgba(0,0,0,.16); }
  .dm-legend { position:absolute;left:10px;bottom:26px;z-index:6;background:rgba(255,255,255,.92);
    border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.12);
    padding:10px 14px;max-width:220px; }
  .dm-legend-title { font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;
    text-transform:uppercase;letter-spacing:.04em; }
  .dm-legend-row { display:flex;align-items:center;gap:8px;font-size:12px;color:#4b5563;
    line-height:1.7; }
  .dm-dot { flex:none;width:10px;height:10px;border-radius:50%;
    border:1px solid rgba(0,0,0,.25); }
`, 'demo-map')

// ─── Config from ProfileLoader ────────────────────────────────────────────────
const profileConfig = inject('profileConfig')
const mapboxToken   = inject('mapboxToken')
const dataSource    = inject('dataSource')
// Read-only theme flag for the control rail — no theme-toggle handler in this
// profile, so ThemeToggleButton is omitted; defaults false unless profile-config
// passes isDark.
const isDark        = computed(() => profileConfig?.value?.isDark === true)

// ─── Tabs ─────────────────────────────────────────────────────────────────────
// Two fixed tabs (a host page may still override via profile-config.tabs,
// mirroring the doxa-simple-map pattern):
//   religion — shared library strategy (COLOR_MODES.RELIGION)
//   purple   — this bundle's local single-color strategy (all pins #8b5cf6)
const DEFAULT_TABS = [
  { id: 'religion', label: 'By Religion',  colorStrategy: COLOR_MODES.RELIGION },
  { id: 'purple',   label: 'Purple Pins',  colorStrategy: COLOR_MODES.SINGLE_COLOR },
]
const tabs        = computed(() => profileConfig?.value?.tabs ?? DEFAULT_TABS)
const activeTabId = ref(null)
const activeTab   = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? tabs.value[0])

function switchTab(tabId) {
  if (tabId === activeTabId.value) return
  activeTabId.value = tabId
  const tab = tabs.value.find(t => t.id === tabId)
  const m = map.value
  if (!tab || !m || !m.getLayer('language-family-pins')) return
  m.setPaintProperty('language-family-pins', 'circle-color',
    buildColorExpression(tab.colorStrategy))
}

// ─── Mini legend (local to this profile — values come from the strategies) ───
const legendRows = computed(() => {
  const strat = getColorStrategy(activeTab.value?.colorStrategy)
  if (!strat) return []
  // Religion strategy exposes `families` (letter → label) + `palette` (letter → hex)
  if (strat.families) {
    return Object.entries(strat.families).map(([letter, label]) => ({
      label,
      color: strat.palette?.[letter] ?? strat.fallback,
    }))
  }
  // Single-color strategy: one swatch for everything
  return [{ label: 'All people groups', color: strat.palette?.pin ?? strat.fallback }]
})
const legendTitle = computed(() =>
  getColorStrategy(activeTab.value?.colorStrategy)?.name ?? 'Legend')

// ─── Map ID ───────────────────────────────────────────────────────────────────
const injectedInstanceId = inject('instanceId', null)
const mapId = (injectedInstanceId?.value || injectedInstanceId) ||
  ('demo-map-' + Math.random().toString(36).slice(2, 7))
provide('mapId', mapId)

// ─── Stores (provided by ProfileLoader) ──────────────────────────────────────
const mapStore  = inject('mapStore')
const dataStore = inject('dataStore')
const uiStore   = inject('uiStore')

// ─── Data + map + layers (all reused from @map) ──────────────────────────────
const mapContainer = ref(null)
const appReady     = ref(false)
// Set when map init concludes it has failed. appReady alone cannot express this:
// it is false both while loading AND forever after a failure, so the loading
// overlay outlived every failure. Same `err` shape cities-internet already uses.
const mapError     = ref(null)
const dsm          = new DataSourceManager()

const { map, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken: mapboxToken.value,
  // Engine per profile-config.provider ('mapbox' default | 'maplibre' token-free).
  // Under maplibre, useMapInstance swaps this mapbox:// style for its free basemap.
  provider: resolveMapProvider(profileConfig),
  style: 'mapbox://styles/mapbox/light-v11',
  center: [20, 10],
  zoom: 1.8,
})

const mapData = useMapData({
  mapId,
  dataSourceId: dataSource.value,
  dataSourceManager: dsm,
  dataStore,
  markRaw: (v) => v,
})

const mapLayers = useMapLayers({
  getMap: () => map.value,
  mapId,
  getLanguageFamilyColor,
  getNormalizedPeopleGroups: () => mapData.normalizedPeopleGroups.value || [],
})

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(async () => {
  activeTabId.value = tabs.value[0]?.id ?? null
  uiStore?.updateBreakpoint?.(window.innerWidth)

  // 1. Start the data load immediately (parallel with map init)
  const dataPromise = mapData.loadData().catch((err) => {
    console.error('[demo-map] Data load failed:', err)
    return { normalizedPeopleGroups: [] }
  })

  // 2. Boot the map
  try {
    await initializeMap()
  } catch (err) {
    // `new mapboxgl.Map()` throws outright when the device has no WebGL context.
    console.error('[demo-map] Map failed to initialize —', err)
    mapError.value = String(err?.message || err)
    return
  }
  if (!map.value) {
    console.error('[demo-map] Map failed to initialize — check token and container')
    mapError.value = 'Map failed to initialize — check token and container'
    return
  }

  // 3. After style.load: add the pins colored by the ACTIVE tab's strategy
  map.value.once('style.load', async () => {
    try {
      const { normalizedPeopleGroups } = await dataPromise
      mapStore?.registerMap?.(mapId, map.value)
      setProjectionOn(map.value, 'mercator')   // per-engine shape: library/useMapProvider (C2)
      if (normalizedPeopleGroups?.length) {
        mapLayers.addLanguageFamilyLayer(normalizedPeopleGroups, activeTab.value?.colorStrategy)
      }
      mapStore?.setMapReady?.(mapId)
      appReady.value = true
    } catch (err) {
      console.error('[demo-map] Map ready failed:', err)
      mapError.value = String(err?.message || err)
    }
  })
})

onBeforeUnmount(() => {
  mapStore?.unregisterMap?.(mapId)
  destroy()
})
</script>

<template>
  <div class="dm-root">
    <!-- Two-tab bar: religion coloring vs single custom purple -->
    <div class="dm-tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="dm-tab"
        :class="{ active: activeTab?.id === tab.id }"
        @click="switchTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Map area -->
    <div class="dm-map-area">
      <div v-if="!appReady && !mapError" class="dm-loading">Loading map…</div>
      <div v-if="mapError" class="dm-error">The map could not be loaded. {{ mapError }}</div>
      <div ref="mapContainer" class="dm-map-canvas" />

      <!-- Shared control rail — MapToolbar self-positions top-right. Zoom/Location/
           Fullscreen gate on the live map instance; ShareButton needs neither and
           always renders so the map is embeddable. -->
      <MapToolbar v-if="appReady && map">
        <ZoomInButton     :map="map"                    :is-dark="isDark" />
        <ZoomOutButton    :map="map"                    :is-dark="isDark" />
        <LocationButton   :map="map"                    :is-dark="isDark" />
        <FullscreenButton :map-container="mapContainer" :is-dark="isDark" />
        <ShareButton      :is-dark="isDark"             :embed-path="'demo-map/demo-map/index.html'" />
      </MapToolbar>

      <!-- Mini legend, driven by the active tab's strategy values -->
      <div v-if="appReady" class="dm-legend">
        <div class="dm-legend-title">{{ legendTitle }}</div>
        <div v-for="row in legendRows" :key="row.label" class="dm-legend-row">
          <span class="dm-dot" :style="{ background: row.color }"></span>{{ row.label }}
        </div>
      </div>
    </div>
  </div>
</template>
