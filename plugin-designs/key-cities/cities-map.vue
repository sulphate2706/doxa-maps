<script setup>
/**
 * cities-map.vue — THE KEY CITIES GLOBAL MAP.
 *
 * Every located population centre as a POINT, sized by how many people groups it
 * holds. One of the data maps this project adds.
 *
 * POINTS, NOT COUNTRY SHADING — this is the one dataset with real coordinates
 * (1,646 clusters, 277 of them gazetteer-named), so shading a country would throw
 * away the precision the corpus was built for. The other two maps shade because
 * their data is genuinely country-resolution; this one does not have to.
 *
 * CLONE of gospel-resources/resources-map.vue with the data and bands swapped —
 * profiles duplicate, the pattern does not get re-derived. Same mobile-first
 * rules: one WebGL context, tap-not-hover, legend strip, bottom sheet.
 *
 * MOBILE FIRST, deliberately. The brief asked for mobile-friendliness before this
 * map existed, so it is built that way rather than retrofitted:
 *   - one WebGL context (the ~16-cap rule; this is the app's only map pane)
 *   - tap-to-select with a bottom SHEET, not a hover popup — hover does not exist
 *     on a phone, and a hover-only map is an unusable map
 *   - the legend is a horizontal strip, not a floating panel that eats the screen
 *   - boundaries FETCHED at runtime (the IIFE inlines every import; 2.7MB of
 *     geojson in the bundle would block first paint)
 *
 * ═══ WHAT A POINT IS, AND WHAT IT IS NOT ═══════════════════════════════════
 * A point is a CLUSTER OF PEOPLE-GROUP PINS within ~25km — not a municipal
 * boundary. Each pin marks a people group, not a settlement.
 *
 * NAMED points were resolved by a cited gazetteer (Nominatim/OSM). UNNAMED ones
 * show as "unnamed location" with their coordinates rather than an invented
 * placename — fabricating one in a persecution-sensitive dataset is the dangerous
 * kind of wrong, so the map says what it does not know.
 */
import { labelFont } from '@map/maps/label-font.js'
import { computed, inject, ref, shallowRef, markRaw, onMounted, onBeforeUnmount } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { addMapAttribution } from '@map/composables/useMapAttribution'
import { ensureEngineScript, engineGlobal, ensureEngineCSS, engineStylesheetUrl } from '@map/composables/useMapInstance.js'
import { resolveMapProvider } from '@map/composables/useMapProvider.js'
import { resolveNamedStyle } from '@map/styles/registry.js'
import { installRtlTextPlugin } from '@map/maps/rtl-text.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { useI18n } from 'vue-i18n'
import enKeyCities from '@map/i18n/locales/en/keyCities.json'
// guarded: useI18n() throws on a host without vue-i18n; the English catalog is the fallback
let t = (k) => String(k).replace(/^keyCities\./, '').split('.').reduce((o, x) => (o == null ? o : o[x]), enKeyCities) ?? k
try { t = useI18n().t } catch (_) { /* no i18n on this host */ }

const profileConfig = inject('profileConfig', ref(null))
const isDark = computed(() => profileConfig.value?.isDark === true)
let unmounted = false
// The token through the library's channel (documentation/reference-universal-props.md): the
// profile-config tk, then ProfileLoader's injected mapboxToken (which carries the page-wide shared
// token, fed by window.MAP_TOKEN), then window.MAP_TOKEN. This read window.DOXA_TOKEN, which only a
// few dev pages set, so in the studio and on every built page the map ignored the page's token.
const injectedTk = inject('mapboxToken', null)
const mapboxToken = computed(() => profileConfig.value?.tk || injectedTk?.value
  || (typeof window !== 'undefined' && window.MAP_TOKEN) || '')
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

const mapEl = ref(null)
const mapRef = shallowRef(null)
const rows = ref([])
const selected = ref(null)
const err = ref(null)

// Bands, not a continuous ramp: a reader can hold four categories, not a gradient.
// Labels are keyCities.map.bands.<id> (the legend translates them).
const BANDS = [
  { id: 'named',  color: '#0b7a5b' },
  { id: 'multi',  color: '#e07a2b' },
  { id: 'single', color: '#9aa2ad' },
]
const bandColor = (b) => (BANDS.find((x) => x.id === b) || {}).color || '#9aa2ad'

const points = computed(() => rows.value.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)))

// KEY CITIES, rendered as STARS so they are visually distinct from people-group
// pins — the phase's "custom city pin" requirement. Only rows the corpus actually
// named are here (277); nothing is invented for places with no data.
const keyCities = ref([])
const starPoints = computed(() => keyCities.value.filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))))

async function load() {
  const res = await fetch(`${assetsBase.value}/tables/key-cities.json`)
  if (!res.ok) throw new Error(`key-cities table not found (${res.status})`)
  rows.value = (await res.json()).rows || []
  // CITY-STAR LAYER (a richer city display). Fetched SEPARATELY — never a
  // static import, which would inline the table into the IIFE bundle (that trap
  // once took two bundles to 2.0/2.9MB). Failure here must NOT break the base map,
  // so it is caught: the city layer is an ENHANCEMENT, not a dependency.
  try {
    const kr = await fetch(`${assetsBase.value}/tables/key-cities-admin-n.json`)
    if (kr.ok) keyCities.value = (await kr.json()).rows || []
  } catch (_) { /* base map still renders; star layer simply absent */ }
}

function paint(map) {
  const fc = {
    type: 'FeatureCollection',
    features: points.value.map((r) => ({
      type: 'Feature',
      properties: {
        name: r.place_name || '',
        band: r.named ? 'named' : r.is_population_centre ? 'multi' : 'single',
        groups: r.people_group_count,
        _row: JSON.stringify({
          place_name: r.place_name, country: r.country, admin_state: r.admin_state,
          people_group_count: r.people_group_count, people_groups: r.people_groups,
          languages: r.languages, upg_population: r.upg_population,
          lat: r.lat, lng: r.lng, named: r.named,
          country_internet_pct: r.country_internet_pct, poster_id: r.poster_id,
        }),
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    })),
  }

  if (map.getSource('kc-src')) { map.getSource('kc-src').setData(fc); return }
  map.addSource('kc-src', { type: 'geojson', data: fc })
  // Radius scales with people-group count so the dense centres read first — the
  // same "greatest need leads" rule the lists sort by.
  map.addLayer({
    id: 'kc-pts', type: 'circle', source: 'kc-src',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'groups'], 1, 3.5, 5, 6, 14, 11],
      'circle-color': ['match', ['get', 'band'], 'named', '#0b7a5b', 'multi', '#e07a2b', '#9aa2ad'],
      'circle-opacity': 0.85,
      'circle-stroke-width': 1,
      'circle-stroke-color': 'rgba(255,255,255,0.85)',
    },
  })
  // TAP TARGET: a 3.5px dot is unhittable with a thumb. An invisible wider circle
  // sits under the visible one purely to catch the tap — the accessible-target
  // rule applied to a map, where it is usually forgotten.
  map.addLayer({
    id: 'kc-hit', type: 'circle', source: 'kc-src',
    paint: { 'circle-radius': 14, 'circle-opacity': 0 },
  })
  map.on('click', 'kc-hit', (e) => {
    const raw = e.features?.[0]?.properties?._row
    if (raw) { try { selected.value = JSON.parse(raw) } catch (_) {} }
  })
  map.on('mouseenter', 'kc-hit', () => { map.getCanvas().style.cursor = 'pointer' })
  paintCityStars(map)
  map.on('mouseleave', 'kc-hit', () => { map.getCanvas().style.cursor = '' })
}

onMounted(async () => {
  // Load the engine rather than assume the page did: leaf <head>s no longer preload mapbox-gl.js
  // (it leaked every visitor's IP to Mapbox under provider=maplibre). THE ENGINE THE PAGE ASKED FOR,
  // OR NONE: no silent fallback to mapboxgl. Resolved by the library like every other map
  // (?provider=, profile-config, window.MAP_PROVIDER; 'auto' = Mapbox only when a token is at hand,
  // including the one ProfileLoader injected). This map used to hard-construct Mapbox GL under
  // provider=maplibre.
  const kcProvider = resolveMapProvider(profileConfig, { token: mapboxToken.value })
  try { await ensureEngineScript(kcProvider) } catch (_) {}
  const gl = engineGlobal(kcProvider)
  if (!gl || !mapEl.value) { err.value = t('keyCities.map.engineMissing'); return }
  // RTL SHAPING before the map exists: a raw map is not covered by useMapInstance's install, and
  // the Mapbox basemap draws Middle-East places in Arabic/Persian/Hebrew script for every viewer.
  installRtlTextPlugin(gl)
  try {
    await load()
    if (unmounted || !mapEl.value) return
    // The engine's stylesheet must be INSIDE this shadow root; a document-level <link> never reaches
    // it (Mapbox's "missing CSS declarations" canary).
    const css = engineStylesheetUrl(kcProvider)
    if (css) await ensureEngineCSS(mapEl.value, css)
    if (unmounted || !mapEl.value) return
    const map = new gl.Map({
      container: mapEl.value,
      // Paired through the registry: 'ink' = mapbox dark-v11 / OpenFreeMap dark, 'paper' = light-v11 /
      // positron, the same pair connectivity-map uses. The literal is the fallback if a name stops resolving.
      style: resolveNamedStyle(isDark.value ? 'ink' : 'paper', kcProvider).style
        || (isDark.value ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11'),
      accessToken: mapboxToken.value,
      center: [42, 18], zoom: 1.3, projection: 'mercator', attributionControl: false,
    })
    mapRef.value = markRaw(map)
    // LICENCE OBLIGATION, not decoration. attributionControl:false above kills
    // Mapbox's built-in credit, and nothing replaced it — these maps were shipping
    // with NO attribution for geoBoundaries, Mapbox or OpenStreetMap. geoBoundaries
    // asks for its name + a link back, prominently, on any page using the boundaries.
    addMapAttribution(map, { boundaries: true })
    map.once('load', () => paint(map))
  } catch (e) { err.value = String(e.message || e) }
})
onBeforeUnmount(() => { unmounted = true; try { mapRef.value?.remove() } catch (_) {} })

const fmt = (n) => (Number(n) || 0).toLocaleString()

// ── CITY-STAR LAYER — the the brief's "better city display", zero taxonomy change ──
// Phase 3 originally asked for a new admin-n level IN THE SEMANTIC TREE. That was
// refused and the phase corrected: the tree is a WRITTEN READ-ONLY design decision
// (upgn-flower-clusters-schematic.md — "READ-ONLY — never edit the research map"),
// it encodes hand-curated choices (13 regions, the Deaf 'R1.1' leaf, India/China
// specials), and only 276 of 1,646 clusters carry an admin unit — so an admin-n
// tree for ALL countries would render mostly EMPTY branches, which is fabricated
// precision expressed as a legend.
//
// This delivers the same USER-FACING ask on the data that actually exists: key
// cities as STAR pins, visually distinct from the round people-group pins, drawn
// UNDER nothing and OVER nothing that would hide them. No tree touched.
function makeStarIcon(map, id, fill) {
  if (map.hasImage && map.hasImage(id)) return
  // Mapbox ships no star, so generate one. A 5-point star drawn to a canvas and
  // registered as a map image — self-contained, no network request, no CDN icon
  // (a CDN icon would leak the viewer's IP; see the open mapbox-CDN finding).
  const S = 44, c = document.createElement('canvas')
  c.width = S; c.height = S
  const x = c.getContext('2d')
  const cx = S / 2, cy = S / 2, outer = S * 0.44, inner = outer * 0.42
  x.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (Math.PI / 5) * i - Math.PI / 2
    const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a)
    i === 0 ? x.moveTo(px, py) : x.lineTo(px, py)
  }
  x.closePath()
  x.fillStyle = fill
  x.fill()
  x.lineWidth = 2.4
  x.strokeStyle = 'rgba(255,255,255,0.95)'   // halo so it reads on any basemap
  x.stroke()
  const d = x.getImageData(0, 0, S, S)
  map.addImage(id, { width: S, height: S, data: new Uint8Array(d.data.buffer) })
}

function paintCityStars(map) {
  if (!starPoints.value.length) return          // honest: no data -> no layer
  makeStarIcon(map, 'city-star', '#b8860b')

  const fc = {
    type: 'FeatureCollection',
    features: starPoints.value.map((r) => ({
      type: 'Feature',
      properties: {
        name: r.place_name || '',
        tier: r.key_tier || 'candidate',
        groups: Number(r.people_group_count) || 0,
        _row: JSON.stringify({
          place_name: r.place_name, country: r.country, admin_state: r.admin_n,
          admin_n_level: r.admin_n_level, key_tier: r.key_tier,
          people_group_count: r.people_group_count, people_groups: r.people_groups,
          languages: r.languages, upg_population: r.upg_population,
          lat: r.lat, lng: r.lng,
          verification_tier: r.verification_tier,
          verification_meaning: r.verification_meaning,
        }),
      },
      geometry: { type: 'Point', coordinates: [Number(r.lng), Number(r.lat)] },
    })),
  }

  if (map.getSource('kc-star-src')) { map.getSource('kc-star-src').setData(fc); return }
  map.addSource('kc-star-src', { type: 'geojson', data: fc })
  map.addLayer({
    id: 'kc-stars', type: 'symbol', source: 'kc-star-src',
    layout: {
      'icon-image': 'city-star',
      // Size by KEY TIER, not raw count — the tier is already a band computed from
      // this corpus's own distribution, so the visual matches the published table.
      'icon-size': ['match', ['get', 'tier'], 'key-high', 0.55, 'key', 0.44, 0.34],
      'icon-allow-overlap': true,
      'text-field': ['case', ['==', ['get', 'tier'], 'key-high'], ['get', 'name'], ''],
      ...labelFont(map),   // a font the engine's glyph server has (library/maps/label-font.js)
      'text-size': 11, 'text-offset': [0, 1.25], 'text-anchor': 'top',
      'text-optional': true,
    },
    paint: {
      'text-color': '#5b4708',
      'text-halo-color': 'rgba(255,255,255,0.92)',
      'text-halo-width': 1.4,
    },
  })
  map.on('click', 'kc-stars', (e) => {
    const raw = e.features?.[0]?.properties?._row
    if (raw) { try { selected.value = JSON.parse(raw) } catch (_) {} }
  })
  map.on('mouseenter', 'kc-stars', () => { map.getCanvas().style.cursor = 'pointer' })
}

useShadowStyles(
  '.gm{position:absolute;inset:0;overflow:hidden}' +
  '.gm-map{position:absolute;inset:0}' +
  // LEGEND: a horizontal strip pinned to the top, so it never eats a phone screen
  // the way a floating panel does.
  '.gm-legend{position:absolute;top:8px;left:8px;right:8px;z-index:4;padding:8px 10px;' +
  'border-radius:10px;background:rgba(255,255,255,.94);color:#0f1419;' +
  "font:12px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.16)}" +
  '.is-dark .gm-legend{background:rgba(19,32,25,.95);color:#e5e7eb}' +
  '.gm-title{font-weight:700;font-size:12.5px;margin-bottom:5px}' +
  '.gm-keys{display:flex;flex-wrap:wrap;gap:5px 12px}' +
  '.gm-key{display:flex;align-items:center;gap:5px;font-size:11px;white-space:nowrap}' +
  '.gm-sw{width:12px;height:12px;border-radius:3px;flex:none}' +
  '.gm-caveat{margin-top:5px;font-size:10.5px;opacity:.72;line-height:1.4}' +
  // DETAIL: a bottom sheet on a phone, a corner card on desktop.
  '.gm-sheet{position:absolute;left:0;right:0;bottom:0;z-index:6;max-height:62%;overflow-y:auto;' +
  'background:#fff;color:#0f1419;border-radius:14px 14px 0 0;padding:14px 16px 22px;' +
  "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 -6px 26px rgba(0,0,0,.28)}" +
  '@media(min-width:700px){.gm-sheet{left:auto;right:14px;bottom:14px;width:330px;border-radius:12px}}' +
  '.is-dark .gm-sheet{background:#132019;color:#e5e7eb}' +
  '.gm-sh-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}' +
  '.gm-sh-name{font-weight:800;font-size:15px}' +
  '.gm-x{margin-left:auto;border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit;' +
  'font:600 12px inherit;padding:6px 12px;border-radius:8px;cursor:pointer;min-height:34px}' +
  '.gm-stat{display:flex;justify-content:space-between;gap:12px;padding:4px 0;' +
  'border-bottom:1px solid rgba(0,0,0,.07);font-variant-numeric:tabular-nums}' +
  '.is-dark .gm-stat{border-bottom-color:rgba(255,255,255,.09)}' +
  '.gm-stat b{font-weight:700}' +
  '.gm-list{margin-top:9px}' +
  '.gm-list-h{font-weight:700;font-size:12px;margin-bottom:3px}' +
  '.gm-list ul{margin:0;padding-left:17px;font-size:12px;line-height:1.5}' +
  '.gm-note{margin-top:9px;font-size:11px;line-height:1.5;opacity:.75}' +
  '.gm-err{position:absolute;top:50%;left:0;right:0;text-align:center;font-size:13px;opacity:.7}',
  'doxa-cities-map',
)
</script>

<template>
  <div class="gm" :class="{ 'is-dark': isDark }">
    <div ref="mapEl" class="gm-map"></div>

    <div class="gm-legend">
      <div class="gm-title">{{ $t('keyCities.map.title') }}</div>
      <div class="gm-keys">
        <span v-for="b in BANDS" :key="b.id" class="gm-key">
          <i class="gm-sw" :style="{ background: b.color }"></i>{{ $t('keyCities.map.bands.' + b.id) }}
        </span>
      </div>
      <div class="gm-caveat">
        {{ $t('keyCities.map.note') }}
      </div>
    </div>

    <div v-if="err" class="gm-err">{{ err }}</div>

    <!-- Tap a country: bottom sheet on mobile, corner card on desktop. -->
    <div v-if="selected" class="gm-sheet">
      <div class="gm-sh-head">
        <span class="gm-sh-name">{{ selected.place_name || $t('keyCities.map.unnamed', { lat: selected.lat, lng: selected.lng }) }}</span>
        <button type="button" class="gm-x" @click="selected = null">{{ $t('keyCities.map.close') }}</button>
      </div>
      <div class="gm-stat"><span>{{ $t('keyCities.map.country') }}</span><b>{{ selected.country }}</b></div>
      <div v-if="selected.admin_state" class="gm-stat"><span>{{ $t('keyCities.map.admin') }}</span><b>{{ selected.admin_state }}</b></div>
      <div class="gm-stat"><span>{{ $t('keyCities.map.peopleGroups') }}</span><b>{{ fmt(selected.people_group_count) }}</b></div>
      <div class="gm-stat"><span>{{ $t('keyCities.map.upgPopulation') }}</span><b>{{ fmt(selected.upg_population) }}</b></div>
      <div class="gm-stat"><span>{{ $t('keyCities.map.internet') }}</span><b>{{ selected.country_internet_pct != null ? selected.country_internet_pct + '%' : $t('keyCities.map.unknown') }}</b></div>
      <div v-if="selected.people_groups" class="gm-list">
        <div class="gm-list-h">{{ $t('keyCities.map.pgHere') }}</div>
        <ul><li v-for="(g, i) in String(selected.people_groups).split(', ')" :key="i">{{ g }}</li></ul>
      </div>
      <div v-if="selected.languages" class="gm-list">
        <div class="gm-list-h">{{ $t('keyCities.map.languages') }}</div>
        <ul><li v-for="(l, i) in String(selected.languages).split(', ')" :key="i">{{ l }}</li></ul>
      </div>
      <p class="gm-note">
        {{ $t('keyCities.map.sheetNote') }}
        {{ $t('keyCities.map.national') }}
      </p>
    </div>
  </div>
</template>
