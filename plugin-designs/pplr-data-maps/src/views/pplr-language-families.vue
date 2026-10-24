<script setup>
import { dataUrl, glFor, exposeMap, releaseMap, whenGeojsonDrawn, setProjectionFor } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { tStatic } from '@map/i18n/index.js'
/**
 * pplr-language-families.vue — PG pins colored by PPLR ethnolinguistic family.
 *
 * Language hierarchy (parse rule):
 *   colon = dialect separator; comma = variant separator (NOT dialect).
 *   "Punjabi, Western" → root "Punjabi", variant "Punjabi, Western"
 *   "Arabic, Egyptian: Cairene" → root "Arabic", variant "Arabic, Egyptian", dialect full string
 *
 * The full tree (family → language → variant → dialect) drives SemanticTreeLegend.
 * Each depth level = one tab. Filter expressions are pre-built into each tree node.
 */
import { inject, onMounted, onBeforeUnmount, ref, computed, watch } from 'vue'
import { resolveNamedStyle } from '@map/styles/registry.js'
import { resolveMapProvider } from '@map/composables/useMapProvider.js'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { addCountryPolygons, POPUP_CSS, FullscreenToggleControl, makePinIndicator, bindFuzzyPinClick, escHtml } from '../utils/pplrMap.js'
import SemanticTreeLegend from '@map/components/legends/SemanticTreeLegend.vue'
import MapboxGeocoder from '../components/MapboxGeocoder.vue'
import PinDetailCard from '../components/PinDetailCard.vue'
import LoadingGlobe from '../components/LoadingGlobe.vue'
import { createPplrInstance, provideInstance } from '@map/composables/usePplrInstance.js'

const pplrInstance = createPplrInstance('language-families')
provideInstance(pplrInstance)

// Registry names resolve per engine, so the Dark/Satellite/Light switch works under MapLibre too.
const mapProvider = resolveMapProvider(inject('profileConfig', null))
const mapboxToken = inject('mapboxToken')
const mapContainer = ref(null)
const profileRoot  = ref(null)   // FullscreenControl target — fullscreens .profile so chrome stays visible
const t = usePplrT()
const tShared = useOptionalT()   // unqualified: tabs.* is a shared area
const status = ref(t('pplr.status.loading'))
const PIN_LAYER = 'lf-pins'

const { map, isMapReady, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken:  mapboxToken.value,
  style:        'ink',   // named: dark-v11 under Mapbox, OpenFreeMap dark under MapLibre
  center:       [25, 18],
  zoom:         1.6,
  projection:   'mercator'  // pinned at construct time — no globe→mercator reproject flash
})

// ── Language families ─────────────────────────────────────────────────────────
const FAMILIES = [
  { key: 'North Indian',            color: '#f97316' },
  { key: 'Bantu',                   color: '#8b5cf6' },
  { key: 'Tibeto-Burmese',          color: '#3b82f6' },
  { key: 'Indo-Malay',              color: '#06b6d4' },
  { key: 'Papuan',                  color: '#84cc16' },
  { key: 'Dravidian',               color: '#f59e0b' },
  { key: 'Southern Amerindian',     color: '#a78bfa' },
  { key: 'Bantoid',                 color: '#10b981' },
  { key: 'Germanic',                color: '#94a3b8' },
  { key: 'Iranian',                 color: '#ec4899' },
  { key: 'Arab (Arabic)',           color: '#fbbf24' },
  { key: 'Melanesian',              color: '#0ea5e9' },
  { key: 'Sudanic',                 color: '#6366f1' },
  { key: 'Latin (Romance)',         color: '#ef4444' },
  { key: 'Chinese',                 color: '#f43f5e' },
  { key: 'Slav',                    color: '#67e8f9' },
  { key: 'Central Amerindian',      color: '#22c55e' },
  { key: 'Altaic',                  color: '#fb923c' },
  { key: 'Guinean (Kwa)',           color: '#c084fc' },
  { key: 'Hausa-Chadic',            color: '#14b8a6' },
  { key: 'Mon-Khmer',               color: '#a3e635' },
  { key: 'Northern Amerindian',     color: '#fde047' },
  { key: 'Jewish',                  color: '#60a5fa' },
  { key: 'Tai',                     color: '#4ade80' },
  { key: 'Nilotic (Para-Nilotic)',  color: '#f87171' },
  { key: 'Other',                   color: '#374151' },
]

const familyColorMap = new Map(FAMILIES.map(f => [f.key, f.color]))
function familyColor(fam) { return familyColorMap.get(fam) || familyColorMap.get('Other') }

// LoadingGlobe stays mounted until pins are added to the map. Flips true after
// setupLayers + family aggregation completes: the loader must not drop
// before pins populate.
const dataReady = ref(false)
function reload() { window.location.reload() }

// ── Settings (data sources) ──────────────────────────────────────────────────
const showSettings = ref(false)
const DATA_SOURCES = [
  { label: 'PG pins (PG-in-country)',         url: 'pg-points.json',
    fields: ['code', 'name', 'rop1', 'rop2', 'rop3', 'rop25', 'iso3', 'country', 'language', 'fam (joined)'] },
  { label: 'Language family lookup (joined)', url: 'pplr-geoid-family.json',
    fields: ['<rop25-code>: <Family Name>'] },
  { label: 'Country polygons (live)',         url: 'PPLR FeatureServer · aCountry',
    fields: ['GENCalpha3', 'ISOalpha2', 'CtryNm', 'ctryNmDisp'] },
]

function buildColorExpr() {
  return ['match', ['get', 'fam'],
    ...FAMILIES.slice(0, 25).flatMap(f => [f.key, f.color]),
    '#374151'
  ]
}

// ── Projection + basemap ──────────────────────────────────────────────────────
const projection    = ref('mercator')  // default: mercator
const showBasemap   = ref(false)
const currentBasemap = ref('dark')
const BASEMAPS = [
  { key: 'dark',      label: 'Dark',      url: 'ink' },
  { key: 'satellite', label: 'Satellite', url: 'hybrid' },
  { key: 'light',     label: 'Light',     url: 'paper' },
]
const pgData = ref(null)

// ── Data state ────────────────────────────────────────────────────────────────
const familyCounts  = ref({})   // famKey → PGIC count
const familyPops    = ref({})   // famKey → total population
const hasPop        = ref(false)
const famLangGroups = ref({})   // famKey → { count, pop, langs: LangGroup[] }

// computed + the reactive shared-key t: tStatic reads a window global, so a computed over it would freeze too
const LANG_TABS = computed(() => [
  { id: 'family',   label: tShared('tabs.family'),
    info: 'PPLR\'s ethnolinguistic family classification (per assets/data/pplr-geoid-family.json). Note: PPLR groups Arabic under "Arab (Arabic)" rather than the broader linguistic family "Afro-Asiatic", and splits other Afro-Asiatic peoples into "Hausa-Chadic", "Cushitic", "Sudanic", etc.' },
  { id: 'language', label: tShared('tabs.language'),
    info: 'A distinct language (e.g. Arabic, Hindi, Punjabi). Identified by 3-character ROL code (ISO 639-3).' },
  { id: 'variant',  label: tShared('tabs.dialect'),
    info: 'A regional or social variety of a language (e.g. "Punjabi, Western", "Arabic, Egyptian"). Comma-separated names group as variants under a root language.' },
])

const LANG_KIND_LABELS = { family: 'Lang Family', language: 'Language', variant: 'Variant', dialect: 'Dialect' }

// ── Sort helper ───────────────────────────────────────────────────────────────
function byPopThenCount(a, b) {
  const pd = (b.pop || 0) - (a.pop || 0)
  return pd !== 0 ? pd : (b.count || 0) - (a.count || 0)
}

// ── Language parse: colon = dialect, comma = variant (NOT dialect) ────────────
function parseLang(lang) {
  if (lang.includes(':')) {
    const colonIdx = lang.indexOf(':')
    const before   = lang.substring(0, colonIdx).trim()
    if (before.includes(',')) {
      const commaIdx = before.indexOf(',')
      return { root: before.substring(0, commaIdx).trim(), variant: before, dialectFull: lang }
    }
    return { root: before, variant: null, dialectFull: lang }
  }
  if (lang.includes(',')) {
    const commaIdx = lang.indexOf(',')
    return { root: lang.substring(0, commaIdx).trim(), variant: lang, dialectFull: null }
  }
  return { root: lang, variant: null, dialectFull: null }
}

function accumulateLang(lmap, lang, pop) {
  if (!lang) return
  const { root, variant, dialectFull } = parseLang(lang)
  if (!lmap[root]) lmap[root] = { base: root, count: 0, pop: 0, variants: {}, dialects: [] }
  lmap[root].count++
  lmap[root].pop += pop
  if (variant) {
    if (!lmap[root].variants[variant]) lmap[root].variants[variant] = { name: variant, count: 0, pop: 0, dialects: [] }
    lmap[root].variants[variant].count++
    lmap[root].variants[variant].pop += pop
    if (dialectFull) {
      const vd = lmap[root].variants[variant].dialects
      let d = vd.find(x => x.name === dialectFull)
      if (!d) { d = { name: dialectFull, count: 0, pop: 0 }; vd.push(d) }
      d.count++; d.pop += pop
    }
  } else if (dialectFull) {
    let d = lmap[root].dialects.find(x => x.name === dialectFull)
    if (!d) { d = { name: dialectFull, count: 0, pop: 0 }; lmap[root].dialects.push(d) }
    d.count++; d.pop += pop
  }
}

function finalizeLmap(lmap) {
  return Object.values(lmap)
    .map(l => ({
      ...l,
      variants: Object.values(l.variants)
        .map(v => ({ ...v, dialects: [...v.dialects].sort(byPopThenCount) }))
        .sort(byPopThenCount),
      dialects: [...l.dialects].sort(byPopThenCount),
    }))
    .sort(byPopThenCount)
}

// ── Tree builders — convert lang data into SemanticTreeLegend node format ─────
function langFilter(langs) {
  return langs.length === 1
    ? ['==', ['get', 'language'], langs[0]]
    : ['in', ['get', 'language'], ['literal', langs]]
}

function buildDialectLeaf(d, famKey) {
  return {
    id:       `d:${famKey}:${d.name}`,
    label:    d.name,
    color:    familyColor(famKey),
    count:    d.count,
    pop:      d.pop,
    filter:   ['==', ['get', 'language'], d.name],
    children: [],
  }
}

function buildVariantNode(vt, famKey) {
  const langs = [vt.name, ...vt.dialects.map(d => d.name)]
  return {
    id:       `v:${famKey}:${vt.name}`,
    label:    vt.name,
    color:    familyColor(famKey),
    count:    vt.count,
    pop:      vt.pop,
    filter:   langFilter(langs),
    children: vt.dialects.map(d => buildDialectLeaf(d, famKey)),
  }
}

function buildLangNode(lg, famKey) {
  const allLangs = [
    lg.base,
    ...lg.variants.map(v => v.name),
    ...lg.variants.flatMap(v => v.dialects.map(d => d.name)),
    ...lg.dialects.map(d => d.name),
  ]
  return {
    id:       `l:${famKey}:${lg.base}`,
    label:    lg.base,
    color:    familyColor(famKey),
    count:    lg.count,
    pop:      lg.pop,
    filter:   langFilter(allLangs),
    children: [
      ...lg.variants.map(vt => buildVariantNode(vt, famKey)),
      ...lg.dialects.map(d => buildDialectLeaf(d, famKey)),
    ],
  }
}

// ── langTree: the single family-rooted tree that drives all 4 legend tabs ─────
const sortedFamilies = computed(() =>
  [...FAMILIES].sort((a, b) => {
    const pd = (familyPops.value[b.key] || 0) - (familyPops.value[a.key] || 0)
    return pd !== 0 ? pd : (familyCounts.value[b.key] || 0) - (familyCounts.value[a.key] || 0)
  })
)

const KNOWN_FAMS = FAMILIES.slice(0, 25).map(f => f.key)

const langTree = computed(() => {
  if (Object.keys(famLangGroups.value).length === 0) return []
  return sortedFamilies.value
    .filter(f => (familyCounts.value[f.key] || 0) > 0)
    .map(f => ({
      id:       `fam:${f.key}`,
      label:    f.key,
      color:    f.color,
      count:    familyCounts.value[f.key] || 0,
      pop:      familyPops.value[f.key] || 0,
      filter:   f.key === 'Other'
        ? ['!', ['in', ['get', 'fam'], ['literal', KNOWN_FAMS]]]
        : ['==', ['get', 'fam'], f.key],
      children: (famLangGroups.value[f.key]?.langs || []).map(lg => buildLangNode(lg, f.key)),
    }))
})

// ── Pin-click indicator ─────────────────────────────────────────────────────
const pinIndicator = makePinIndicator()
watch(() => pplrInstance.pinDetail.value, p => { if (!p) pinIndicator.hide() })

// ── Geocoder → map sync ────────────────────────────────────────────────────
// Geocoder writes instance.selection but doesn't emit an event the map
// listens for. Watch the store so geocoder picks actually filter the map.
watch(() => pplrInstance.selection.value, sel => {
  if (!map.value) return
  onLegendSelect(sel || null)
})

// Selection only filters which pins are visible. Pin appearance stays
// identical to the base-map style — no halos, no size change, no pulse.
function onLegendSelect(node) {
  if (!node) {
    map.value?.setFilter(PIN_LAYER, null)
  } else if (node.filter) {
    map.value?.setFilter(PIN_LAYER, node.filter)
    flyToFilter(node.filter)
  }
}

// Compute bounds of pins matching a filter expression and fly there.
// Handles the two filter shapes the legend builds: ['==', ['get', f], v]
// and ['in', ['get', f], ['literal', [v...]]]. Anything else is ignored.
function flyToFilter(filter) {
  if (!map.value || !pgData.value || !Array.isArray(filter)) return
  let field, values
  if (filter[0] === '==' && Array.isArray(filter[1]) && filter[1][0] === 'get') {
    field = filter[1][1]; values = [filter[2]]
  } else if (filter[0] === 'in' && Array.isArray(filter[1]) && filter[1][0] === 'get'
             && Array.isArray(filter[2]) && filter[2][0] === 'literal') {
    field = filter[1][1]; values = filter[2][1]
  } else return
  const set = new Set(values)
  const lngs = [], lats = []
  for (const f of pgData.value.features) {
    if (set.has(f.properties[field])) {
      lngs.push(f.geometry.coordinates[0])
      lats.push(f.geometry.coordinates[1])
    }
  }
  if (!lngs.length) return
  map.value.stop()
  if (lngs.length === 1) {
    map.value.flyTo({ center: [lngs[0], lats[0]], zoom: 6.5, duration: 1200 })
  } else {
    map.value.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 60, maxZoom: 6, duration: 1200 }
    )
  }
}

// ── Local search index for the geocoder: flatten the tree with kind tags ─────
const langLocalIndex = computed(() => {
  const out = []
  function walk(nodes, depth, kind) {
    for (const n of nodes) {
      out.push({ ...n, kind, depth })
      if (n.children?.length) {
        const childKind = depth === 0 ? 'language' : (depth === 1 ? 'variant' : 'dialect')
        walk(n.children, depth + 1, childKind)
      }
    }
  }
  walk(langTree.value, 0, 'family')
  return out
})

function onGeocoderPlace(p) {
  if (!map.value) return
  map.value.stop()  // cancel in-flight animation so back-to-back picks don't stack
  if (p.bbox) {
    map.value.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: 60, maxZoom: 7, duration: 1200 })
  } else if (p.center) {
    map.value.flyTo({ center: p.center, zoom: 5, duration: 1200 })
  }
}

function onPinLocate(p) {
  if (!map.value || p?.lng == null || p?.lat == null) return
  map.value.stop()
  map.value.flyTo({ center: [p.lng, p.lat], zoom: 6, duration: 1200 })
}

const detailColor = computed(() => {
  const p = pplrInstance.pinDetail.value
  return p ? familyColor(p.fam || 'Other') : '#73A17F'
})

// ── Projection / basemap ──────────────────────────────────────────────────────
function toggleProjection() {
  projection.value = projection.value === 'globe' ? 'mercator' : 'globe'
  if (map.value) setProjectionFor(map.value, projection.value)
}

function setBasemap(key) {
  if (key === currentBasemap.value) { showBasemap.value = false; return }
  currentBasemap.value = key
  pplrInstance.theme.value = key === 'light' ? 'light' : 'dark'
  showBasemap.value = false
  const style = BASEMAPS.find(b => b.key === key)?.url
  if (!style || !map.value) return
  map.value.once('style.load', () => { setupLayers(); setProjectionFor(map.value, projection.value) })
  // diff:false suppresses Mapbox's "Unimplemented: setSprite" warning between
  // dark-v11 and light-v11. We re-add layers in setupLayers anyway.
  map.value.setStyle(resolveNamedStyle(style, mapProvider).style, { diff: false })
}

function toggleTheme() {
  setBasemap(currentBasemap.value === 'dark' ? 'light' : 'dark')
}

// ── Map layers ────────────────────────────────────────────────────────────────
function setupLayers() {
  if (!pgData.value || !map.value) return
  addCountryPolygons(map.value, { theme: pplrInstance.theme.value })
  if (!map.value.getSource('lf-pgs')) {
    map.value.addSource('lf-pgs', { type: 'geojson', data: pgData.value, cluster: false })
    map.value.addLayer({
      id: PIN_LAYER, type: 'circle', source: 'lf-pgs',
      paint: {
        'circle-color': buildColorExpr(),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 4, 12, 7],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#0d1117',
        'circle-stroke-width': 0.5
      }
    })
    bindFuzzyPinClick(map.value, PIN_LAYER, ({ features }) => {
      const f = features[0]
      const lng = f.geometry.coordinates[0]
      const lat = f.geometry.coordinates[1]
      pplrInstance.pinDetail.value = { ...f.properties, lng, lat }
      pinIndicator.show(map.value, [lng, lat], { color: familyColor(f.properties.fam || 'Other') })
    })
  }
}

function popupHtml(p) {
  const d = v => (v == null || v === 'None' || v === '' || v === '*') ? '—' : escHtml(v)
  const color = familyColor(p.fam || 'Other')
  return `<div class="pplr-popup">
    <h3>${d(p.name)}<small>${d(p.country)}</small></h3>
    <table>
      <tr><td>${escHtml(t('pplr.popup.language'))}</td><td>${d(p.language)}</td></tr>
      <tr><td>${escHtml(t('pplr.popup.family'))}</td><td><b style="color:${color}">${d(p.fam)}</b></td></tr>
      <tr><td>${escHtml(t('pplr.popup.affinityBloc'))}</td><td>${d(p.rop1)}</td></tr>
      <tr><td>${escHtml(t('pplr.popup.religion'))}</td><td>${d(p.religion)}</td></tr>
      <tr><td>IMB PGID</td><td><code>${d(p.imb)}</code></td></tr>
      <tr><td>JP Code</td><td><code>${d(p.jp)}</code></td></tr>
    </table>
  </div>`
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  await initializeMap()
  exposeMap(map.value)
  if (!map.value) {
    // The map did not construct (e.g. provider=mapbox with no token; useMapInstance logs why). Say so
    // and stop: everything below needs a map, and map.value.on() threw into the mounted hook.
    status.value = tStatic('messages.mapUnavailable')   // a shared key: usePplrT would prefix it with pplr.
    return
  }
  if (map.value) {
    map.value.addControl(new (glFor(map.value)).NavigationControl({ showCompass: false, visualizePitch: false }), 'bottom-right')
    map.value.addControl(new FullscreenToggleControl(profileRoot.value), 'bottom-right')
  }
  map.value.on('load', async () => {
    // The constructor's projection:'mercator' is only a request: on Mapbox the style's own projection
    // (globe) wins, so the map booted as a globe while this view's state and button said Mercator, and
    // the first "Switch to Globe" click did nothing (C2). The style is ready here, on both
    // engines, so apply the state to the map.
    setProjectionFor(map.value, projection.value)
    try {
      // Shift logical center right of the 380px legend so the globe / pin
      // density isn't hidden behind the column.
      map.value.setPadding({ left: 380, top: 0, right: 0, bottom: 0 })
      addCountryPolygons(map.value, { theme: pplrInstance.theme.value })

      status.value = t('pplr.status.loadingLanguage')
      const [pgResp, lfResp] = await Promise.all([
        fetch(dataUrl('pg-points.json')),
        fetch(dataUrl('pplr-geoid-family.json'))
      ])
      const fc          = await pgResp.json()
      const geoIdFamily = await lfResp.json()

      let matched = 0, inTop25 = 0, totalPopSum = 0
      const COLORED = new Set(KNOWN_FAMS)

      for (const feat of fc.features) {
        const code = String(feat.properties.code)
        const fam  = geoIdFamily[code] || null
        feat.properties.fam = fam
        if (fam) { matched++; if (COLORED.has(fam)) inTop25++ }
        totalPopSum += feat.properties.pop || feat.properties.population || 0
      }
      hasPop.value = totalPopSum > 0
      pgData.value = fc
      setupLayers()

      // Family counts + pops
      const fcounts = {}, fpops = {}
      for (const feat of fc.features) {
        const f = feat.properties.fam || 'Other'
        const p = feat.properties.pop || feat.properties.population || 0
        fcounts[f] = (fcounts[f] || 0) + 1
        fpops[f]   = (fpops[f]   || 0) + p
      }
      familyCounts.value = fcounts
      familyPops.value   = fpops

      // Family → language groups (builds the tree)
      const fLangMap = {}
      for (const feat of fc.features) {
        const fam  = feat.properties.fam || 'Other'
        const lang = feat.properties.language || ''
        const pop  = feat.properties.pop || feat.properties.population || 0
        if (!fLangMap[fam]) fLangMap[fam] = { count: 0, pop: 0, lmap: {} }
        fLangMap[fam].count++
        fLangMap[fam].pop += pop
        if (lang) accumulateLang(fLangMap[fam].lmap, lang, pop)
      }
      const result = {}
      for (const fam of Object.keys(fLangMap)) {
        result[fam] = { count: fLangMap[fam].count, pop: fLangMap[fam].pop, langs: finalizeLmap(fLangMap[fam].lmap) }
      }
      famLangGroups.value = result

      const coverage = Math.round(100 * matched / fc.features.length)
      status.value = t('pplr.status.readyLanguage', { pins: fc.features.length.toLocaleString(), coverage, top: Math.round(100 * inTop25 / fc.features.length) })
      // keep the LoadingGlobe up until the pins are actually drawn, not merely added
      await whenGeojsonDrawn(map.value)
      dataReady.value = true
    } catch (err) {
      status.value = t('pplr.status.error', { message: err.message })
    }
  })
})
onBeforeUnmount(() => { releaseMap(map.value); pinIndicator.destroy(); destroy() })

const LF_CSS = POPUP_CSS + `
.pplr-popup h3 small { display: block; font-weight: 400; color: #6b7280; font-size: 11px; margin-top: 2px; }
`
</script>

<template>
  <div ref="profileRoot" class="profile" :data-theme="pplrInstance.theme.value">
    <LoadingGlobe v-if="!isMapReady || !dataReady" :label="status" @retry="reload" />

    <!-- Decoupled geocoder above the legend, sharing the per-map instance store -->
    <div class="geocoder-slot">
      <MapboxGeocoder
        :local-index="langLocalIndex"
        :kind-labels="LANG_KIND_LABELS"
        :mapbox-token="mapboxToken"
        :placeholder="t('pplr.ui.search')"
        @place="onGeocoderPlace"
      />
    </div>

    <!-- Pin-detail card swaps in for the legend when a pin is clicked -->
    <PinDetailCard
      v-if="pplrInstance.pinDetail.value"
      :color="detailColor"
      @locate="onPinLocate"
    />

    <!-- Reusable semantic tree legend — decoupled from map, connected via @select -->
    <SemanticTreeLegend
      v-else
      :nodes="langTree"
      :tabs="LANG_TABS"
      :title="t('pplr.tabs.languageFamilies')"
      @select="onLegendSelect"
    />

    <div ref="mapContainer" class="map" />
    <div class="status">{{ status }}</div>
    <div class="header-pill">{{ t('pplr.pill.languageFamilies') }}</div>

    <!-- Toolbar — rounded pill controls -->
    <div class="map-toolbar">
      <button class="toolbar-btn round" :title="tShared(currentBasemap === 'dark' ? 'buttons.switchToLightMode' : 'buttons.switchToDarkMode')" :aria-label="tShared(currentBasemap === 'dark' ? 'buttons.switchToLightMode' : 'buttons.switchToDarkMode')"
        @click="toggleTheme">
        <svg v-if="currentBasemap === 'dark'" width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="toolbar-btn round" :title="tShared(projection === 'globe' ? 'mapui.disableGlobe' : 'mapui.enableGlobe')" :aria-label="tShared(projection === 'globe' ? 'mapui.disableGlobe' : 'mapui.enableGlobe')"
        @click="toggleProjection">
        <span class="toolbar-icon">{{ projection === 'globe' ? '🌐' : '🗺' }}</span>
      </button>
      <div class="basemap-wrap">
        <button class="toolbar-btn round" :title="t('pplr.ui.baseMap')" @click="showBasemap = !showBasemap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M3 7l9-4 9 4-9 4-9-4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M3 12l9 4 9-4M3 17l9 4 9-4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </button>
        <div v-if="showBasemap" class="basemap-panel">
          <div class="basemap-title">{{ t('pplr.ui.baseMap') }}</div>
          <button v-for="b in BASEMAPS" :key="b.key" class="basemap-opt"
            :class="{ active: currentBasemap === b.key }"
            @click="setBasemap(b.key)">{{ b.label }}</button>
        </div>
      </div>
      <div class="settings-wrap">
        <button class="toolbar-btn round" :title="t('pplr.ui.dataSources')" @click="showSettings = !showSettings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
            <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.6A7 7 0 0 0 7.5 6.8l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2.1 1.2L10 21h4l.4-2.6a7 7 0 0 0 2.1-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
        </button>
        <div v-if="showSettings" class="settings-panel">
          <div class="settings-header">{{ t('pplr.ui.dataSources') }}</div>
          <div v-for="src in DATA_SOURCES" :key="src.url" class="settings-src">
            <div class="settings-src-label">{{ src.label }}</div>
            <div class="settings-src-url">{{ src.url }}</div>
            <div class="settings-fields">
              <span v-for="f in src.fields" :key="f" class="settings-field">{{ f }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <component is="style">{{ LF_CSS }}</component>
  </div>
</template>

<style scoped>
.profile { width: 100%; height: 100%; position: relative; }
.map     { width: 100%; height: 100%; }
.loading {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: #0f1216; color: #94a3b8; font: 13px sans-serif; z-index: 1;
}
/* Pills sized to fit under the 380px legend column without sticking out
   to its right, and lifted above the Mapbox attribution at the bottom. */
.status {
  position: absolute; bottom: 32px; left: 12px;
  background: rgba(13,17,23,0.92); color: #86efac; border: 1px solid #30363d;
  font: 11px ui-monospace, monospace; padding: 6px 12px; border-radius: 4px; z-index: 2;
  max-width: 340px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.header-pill {
  position: absolute; bottom: 64px; left: 12px;
  background: rgba(13,17,23,0.92); color: #c9d1d9; border: 1px solid #30363d;
  font: 11px system-ui; padding: 6px 12px; border-radius: 999px; z-index: 2;
  max-width: 340px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Geocoder slot — sits above the legend, matches its 380px width ─────────── */
.geocoder-slot {
  position: absolute; top: 12px; left: 8px; width: 380px; z-index: 5;
}
@media (max-width: 640px) {
  .geocoder-slot { width: 92vw; max-width: 380px; left: 8px; }
}

/* ── Light-mode chrome overrides ─────────────────────────────────────────── */
.profile[data-theme="light"] .toolbar-btn {
  background: rgba(255,255,255,0.96); border-color: #d0d7de; color: #57606a;
  box-shadow: 0 3px 10px rgba(31,35,40,0.12);
}
.profile[data-theme="light"] .toolbar-btn:hover {
  background: #f6f8fa; color: #3b463d; border-color: #3b463d;
}
.profile[data-theme="light"] .toolbar-btn.round { background: #ffffff; }
.profile[data-theme="light"] .toolbar-btn.round:hover {
  background: #f6f8fa; box-shadow: 0 5px 14px rgba(59,70,61,0.2);
}
.profile[data-theme="light"] .basemap-panel {
  background: rgba(255,255,255,0.98); border-color: #d0d7de;
  box-shadow: 0 6px 20px rgba(31,35,40,0.15);
}
.profile[data-theme="light"] .basemap-title { color: #3b463d; border-color: #d8dee4; }
.profile[data-theme="light"] .basemap-opt { color: #57606a; }
.profile[data-theme="light"] .basemap-opt:hover { background: #f6f8fa; color: #1f2328; }
.profile[data-theme="light"] .basemap-opt.active { border-color: #3b463d; color: #3b463d; }
.profile[data-theme="light"] .status {
  background: rgba(255,255,255,0.95); border-color: #d0d7de; color: #1a7f37;
}
.profile[data-theme="light"] .header-pill {
  background: rgba(255,255,255,0.95); border-color: #d0d7de; color: #1f2328;
}
.profile[data-theme="light"] .loading { background: #f6f8fa; color: #57606a; }
.map-toolbar {
  position: absolute; top: 12px; right: 12px; z-index: 5;
  display: flex; flex-direction: column; gap: 4px; align-items: flex-end;
}
.toolbar-btn {
  display: flex; align-items: center; gap: 5px;
  background: rgba(13,17,23,0.92); color: #8b949e;
  border: 1px solid #30363d; border-radius: 6px;
  font: 11px ui-monospace, monospace; padding: 5px 10px;
  cursor: pointer; white-space: nowrap;
  transition: color 0.12s, border-color 0.12s, background 0.12s, transform 0.12s,
              box-shadow 0.12s;
}
.toolbar-btn:hover { color: #c9d1d9; border-color: #73A17F; }

.toolbar-btn.round {
  width: 36px; height: 36px; padding: 0;
  border-radius: 50%; justify-content: center;
  background: #161b22;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
}
.toolbar-btn.round:hover {
  background: #1c2333; transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(59,70,61,0.25);
}
.toolbar-icon { font-size: 13px; line-height: 1; }
.toolbar-label { font-size: 10px; letter-spacing: 0.04em; }
.basemap-wrap { position: relative; }
.basemap-panel {
  position: absolute; top: calc(100% + 4px); right: 0;
  background: rgba(13,17,23,0.97); border: 1px solid #30363d; border-radius: 6px;
  padding: 8px; min-width: 130px; z-index: 10;
  display: flex; flex-direction: column; gap: 3px;
}
.basemap-title {
  font: 600 10px ui-monospace, monospace; color: #73A17F;
  text-transform: uppercase; letter-spacing: 0.06em;
  padding: 0 4px 4px; border-bottom: 1px solid #21262d; margin-bottom: 2px;
}
.basemap-opt {
  background: transparent; border: 1px solid transparent; border-radius: 4px;
  color: #8b949e; font: 11px system-ui; padding: 4px 8px; cursor: pointer; text-align: left;
}
.basemap-opt:hover { background: #161b22; color: #c9d1d9; }
.basemap-opt.active { border-color: #73A17F; color: #73A17F; }

/* ── Settings (data sources) — toolbar-attached panel ────────────────────── */
.settings-wrap { position: relative; }
.settings-panel {
  position: absolute; top: calc(100% + 4px); right: 0;
  background: rgba(13,17,23,0.97); color: #c9d1d9;
  border: 1px solid #30363d; border-radius: 8px;
  font: 12px system-ui; padding: 12px 16px;
  min-width: 320px; max-width: 420px; max-height: 50vh; overflow-y: auto;
  z-index: 10;
}
.settings-header {
  font: 600 11px ui-monospace, monospace; color: #c9d1d9;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0 4px 8px; margin-bottom: 6px;
  border-bottom: 1px solid #21262d;
}
.settings-src { margin-bottom: 8px; }
.settings-src:last-child { margin-bottom: 0; }
.settings-src-label {
  font: 600 9px ui-monospace, monospace; color: #73A17F;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;
}
.settings-src-url {
  font: 10px ui-monospace, monospace; color: #6e7681; word-break: break-all;
  background: #161b22; border: 1px solid #21262d; border-radius: 3px;
  padding: 3px 5px; margin-bottom: 3px;
}
.settings-fields { display: flex; flex-wrap: wrap; gap: 2px; }
.settings-field {
  font: 10px ui-monospace, monospace; background: #21262d;
  color: #c9d1d9; border-radius: 3px; padding: 1px 4px;
}
.profile[data-theme="light"] .settings-panel {
  background: rgba(255,255,255,0.98); border-color: #d0d7de;
  box-shadow: 0 6px 20px rgba(31,35,40,0.15); color: #1f2328;
}
.profile[data-theme="light"] .settings-header { color: #1f2328; border-bottom-color: #d8dee4; }
.profile[data-theme="light"] .settings-src-label { color: #3b463d; }
.profile[data-theme="light"] .settings-src-url { background: #f6f8fa; border-color: #d0d7de; color: #57606a; }
.profile[data-theme="light"] .settings-field { background: #eaeef2; color: #1f2328; }
</style>
