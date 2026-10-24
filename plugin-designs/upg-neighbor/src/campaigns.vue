<script setup>
/**
 * campaigns.vue — BRIDGE LANGUAGES: the mass-media planner.
 *
 * A bridge language is spoken both by reached groups (believers who can be mobilized in it) and by
 * unreached groups (whom those believers could reach at E-1, in their own language). One campaign in
 * that language, placed where the believers are, mobilizes all of them at once. The list is ranked
 * by the unreached population a campaign could reach; selecting one shows where to run it, whom it
 * reaches, and what content already exists in the language. Data: nearData.js.
 */
import { inject, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { setProjectionOn } from '@map/composables/useMapProvider.js'
import { whenStyleReady } from './whenStyleReady.js'
import { useNeighborT } from './composables/useNeighborT.js'
import { tStatic, formatList } from '@map/i18n/index.js'
import { loadNearData, E_COLORS, UNREACHED, NAVY, fold, fmtNum, downloadCsv } from './nearData.js'

const nt = useNeighborT()
const profileConfig = inject('profileConfig', ref({}))
const mapboxToken = inject('mapboxToken', ref(''))
const nbState = inject('nbState')
const cfg = computed(() => profileConfig?.value || {})

const mapContainer = ref(null)
const data = ref(null)
const loadError = ref('')
const mapError = ref('')
const query = ref('')
const minBelievers = ref(1000)       // hide languages with too few believers to run a campaign through

const { map, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken: mapboxToken?.value || cfg.value.tk || '',
  style: cfg.value.style ?? 'mapbox://styles/mapbox/light-v11',
  center: cfg.value.center ?? [45, 20],
  zoom: cfg.value.zoom ?? 1.6,
  minZoom: 1, maxZoom: 11,
})

const list = computed(() => {
  if (!data.value) return []
  const q = fold(query.value.trim())
  return data.value.bridges.filter((b) => b.believers >= minBelievers.value &&
    (!q || fold(b.langName).includes(q) || b.reachedCountries.some((c) => fold(c).includes(q)) || b.unreachedCountries.some((c) => fold(c).includes(q))))
})
const active = computed(() => data.value?.bridges.find((b) => b.lang === nbState.lang) || null)

// A pick raises the phone sheet first, so its detail is in view and the frame is computed for it.
function pick(b) { nbState.sheetDown = false; nbState.lang = b.lang }
function back() { nbState.lang = null }
function openGroup(u) { nbState.sheetDown = false; nbState.pgid = u.pgid; nbState.view = 'mobilize' }

// Where to run the campaign: believers per country, largest first.
const audience = computed(() => {
  const b = active.value
  if (!b) return []
  const m = new Map()
  for (const g of b.reached) { const x = m.get(g.country) || { country: g.country, believers: 0, groups: 0 }; x.believers += g.believers; x.groups++; m.set(g.country, x) }
  return [...m.values()].sort((a, b2) => b2.believers - a.believers)
})
const reachedTargets = computed(() => (active.value ? [...active.value.unreached].sort((a, b) => b.pop - a.pop) : []))

function exportCampaign() {
  const b = active.value
  if (!b) return
  const header = ['bridge_language', 'language_code', 'role', 'group', 'country', 'population', 'est_believers', 'lat', 'lng', 'pgid']
  const rows = [
    ...b.reached.map((g) => [b.langName, b.lang, 'mobilize (reached)', g.name, g.country, g.pop, g.believers, g.lat, g.lng, g.pgid]),
    ...b.unreached.map((g) => [b.langName, b.lang, 'reach (unreached)', g.name, g.country, g.pop, '', g.lat, g.lng, g.pgid]),
  ]
  downloadCsv(`bridge-language-${b.lang}.csv`, header, rows)
}
function exportAll() {
  const header = ['bridge_language', 'language_code', 'unreached_population', 'unreached_groups', 'est_believers', 'reached_groups',
    'believers_in_countries', 'unreached_in_countries', 'bible', 'jesus_film', 'audio', 'radio']
  const rows = list.value.map((b) => [b.langName, b.lang, b.unreachedPop, b.unreached.length, b.believers, b.reached.length,
    b.reachedCountries.join('; '), b.unreachedCountries.join('; '),
    b.res.bible ? 'yes' : 'no', b.res.film ? 'yes' : 'no', b.res.audio ? 'yes' : 'no', b.res.radio ? 'yes' : 'no'])
  downloadCsv('bridge-languages.csv', header, rows)
}

// ─── Map: believers (green) and the unreached they would reach (red) ─────────
// Before a language is picked, the map shows the list itself: one bubble per bridge language, placed on
// its largest unreached group and sized by the unreached population it reaches. A click picks it.
const SRC_R = 'cp-r', SRC_U = 'cp-u', SRC_B = 'cp-b'
const anchor = (b) => b.unreached.reduce((m, g) => (!m || g.pop > m.pop ? g : m), null)
function bridgeFeatures() {
  if (active.value) return fc([])
  return fc(list.value.map((b) => { const g = anchor(b); return g && { type: 'Feature', geometry: { type: 'Point', coordinates: [g.lng, g.lat] }, properties: { lang: b.lang, pop: b.unreachedPop } } }).filter(Boolean))
}
const fc = (features) => ({ type: 'FeatureCollection', features })
// Hover label: after a language is picked, its believers (green) and the unreached they reach (red)
// were anonymous until clicked, and a green dot could not be clicked at all. Same label as Mobilize.
const hover = ref(null)   // { x, y, text }
// The tip opens toward the side with more room, so near an edge it is never cut off (a run saw "Ko…"
// at the right edge in ar); max-width keeps it inside half the map on a phone. A tip is stale as soon as
// the map moves (a tap, then the fly to the pick), so moving clears it.
const hoverStyle = computed(() => {
  const h = hover.value
  if (!h) return {}
  const w = mapContainer.value?.clientWidth || 0
  return h.x > w / 2 ? { right: (w - h.x + 12) + 'px', top: h.y + 12 + 'px' } : { left: h.x + 12 + 'px', top: h.y + 12 + 'px' }
})
const pt = (g) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [g.lng, g.lat] }, properties: { id: g.pgid, pop: g.pop, b: g.believers } })
function setSrc(m, id, d) { const s = m.getSource(id); if (s) s.setData(d); else m.addSource(id, { type: 'geojson', data: d }) }
let repaintPending = false
function repaint() {
  const m = map.value
  if (!m) return
  // isStyleLoaded() is also false while TILES load (MapLibre), so a data load that lands then used to
  // be dropped for good: the start view showed no dots at all (measured, upgn6). Try again once idle.
  if (!m.isStyleLoaded?.()) { if (!repaintPending) { repaintPending = true; m.once('idle', () => { repaintPending = false; repaint() }) } return }
  const b = active.value
  setSrc(m, SRC_B, bridgeFeatures())
  setSrc(m, SRC_U, fc(b ? b.unreached.map(pt) : []))
  setSrc(m, SRC_R, fc(b ? b.reached.map(pt) : []))
  if (!m.getLayer('cp-b')) m.addLayer({ id: 'cp-b', type: 'circle', source: SRC_B, paint: {
    'circle-color': UNREACHED, 'circle-opacity': 0.45, 'circle-stroke-width': 1.5, 'circle-stroke-color': E_COLORS[1],
    'circle-radius': ['interpolate', ['linear'], ['ln', ['max', ['get', 'pop'], 1]], 8, 3, 12, 6, 16, 12, 19, 18] } })
  if (!m.getLayer('cp-u')) m.addLayer({ id: 'cp-u', type: 'circle', source: SRC_U, paint: {
    'circle-color': UNREACHED, 'circle-opacity': 0.7, 'circle-stroke-width': 0.6, 'circle-stroke-color': '#fff',
    'circle-radius': ['interpolate', ['linear'], ['ln', ['max', ['get', 'pop'], 1]], 6, 2, 12, 4, 16, 8, 19, 12] } })
  if (!m.getLayer('cp-r')) m.addLayer({ id: 'cp-r', type: 'circle', source: SRC_R, paint: {
    'circle-color': E_COLORS[1], 'circle-opacity': 0.9, 'circle-stroke-width': 1.2, 'circle-stroke-color': '#fff',
    'circle-radius': ['interpolate', ['linear'], ['ln', ['max', ['get', 'b'], 1]], 2, 3, 8, 5, 12, 8, 15, 12] } })
}
function frame() {
  const m = map.value, b = active.value
  if (!m || !b) return
  const pts = [...b.reached, ...b.unreached]
  const lngs = pts.map((g) => g.lng), lats = pts.map((g) => g.lat)
  const w = mapContainer.value?.clientWidth || 0, h = mapContainer.value?.clientHeight || 0
  // The panel covers the left 440px on wide screens, the bottom 55% on a phone: frame what you can see.
  // In a right-to-left locale the panel sits on the right, so the wide padding moves with it.
  const rtl = !!mapContainer.value && getComputedStyle(mapContainer.value).direction === 'rtl'
  const padding = w > 760 ? { top: 60, bottom: 60, left: rtl ? 60 : 440, right: rtl ? 440 : 60 } : { top: 40, bottom: (nbState.sheetDown ? 56 : Math.round(h * 0.55)) + 20, left: 30, right: 30 }
  try {
    m.stop()
    m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding, maxZoom: 5.5, duration: 900 })
  } catch (_) { /* a camera call on a map mid-teardown is not worth an error */ }
}
watch(() => [nbState.lang, data.value], () => { repaint(); frame() })
watch(list, () => repaint())   // the bubbles follow the search and the believers filter
// PHONE: the same handle as Mobilize; the list can be lowered to a bar and raised again.
function toggleSheet() { nbState.sheetDown = !nbState.sheetDown; nextTick(() => frame()) }

onMounted(async () => {
  loadNearData(profileConfig).then((d) => { data.value = d; repaint(); frame() })
    .catch((e) => { loadError.value = nt('neighbor.mob.loadError', { message: String(e.message || e) }) })
  await initializeMap()
  const m = map.value
  // A shared key, so tStatic: nt() would prefix it with neighbor. and never resolve.
  if (!m) { mapError.value = tStatic('messages.mapUnavailable'); return }
  whenStyleReady(m, () => {
    setProjectionOn(m, 'mercator'); repaint(); frame()
    m.on('click', 'cp-u', (ev) => {
      const id = ev.features?.[0]?.properties?.id
      const u = active.value?.unreached.find((g) => g.pgid === id)
      if (u) openGroup(u)
    })
    // A GREEN dot opens that reached group in Mobilize: the unreached neighbours its believers can
    // reach, the letter's audience (test round 2: green dots on the Campaigns map could not be clicked).
    m.on('click', 'cp-r', (ev) => {
      const id = ev.features?.[0]?.properties?.id
      const r = active.value?.reached.find((g) => g.pgid === id)
      if (r) openGroup(r)
    })
    m.on('click', 'cp-b', (ev) => {
      const b = data.value?.bridges.find((x) => x.lang === ev.features?.[0]?.properties?.lang)
      if (b) pick(b)
    })
    m.on('movestart', () => { hover.value = null })
    for (const id of ['cp-u', 'cp-r', 'cp-b']) {
      m.on('mouseenter', id, () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', id, () => { m.getCanvas().style.cursor = '' })
    }
    m.on('mousemove', 'cp-b', (ev) => {
      const b = data.value?.bridges.find((x) => x.lang === ev.features?.[0]?.properties?.lang)
      hover.value = b ? { x: ev.point.x, y: ev.point.y, text: `${b.langName} · ${nt('neighbor.camp.unreachedPeople', { n: fmtNum(b.unreachedPop) })}` } : null
    })
    m.on('mouseleave', 'cp-b', () => { hover.value = null })
    const byId = (id) => active.value && [...active.value.reached, ...active.value.unreached].find((g) => g.pgid === id)
    for (const id of ['cp-u', 'cp-r']) {
      m.on('mousemove', id, (ev) => {
        const g = byId(ev.features?.[0]?.properties?.id)
        hover.value = g ? { x: ev.point.x, y: ev.point.y, text: `${g.name} · ${g.country}` } : null
      })
      m.on('mouseleave', id, () => { hover.value = null })
    }
  })
  m.on('style.load', repaint)
})
onBeforeUnmount(() => destroy())

useShadowStyles(`
  .cp-root { position:absolute; inset:0; background:#f6f7f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1f2937; }
  .cp-map { position:absolute; inset:0; }
  .cp-panel { position:absolute; top:10px; inset-inline-start:10px; bottom:10px; width:420px; z-index:20; display:flex; flex-direction:column;
    background:#fff; border:1px solid #d9dee6; border-radius:12px; box-shadow:0 6px 20px rgba(0,20,60,.12); overflow:hidden; }
  .cp-head { padding:12px 14px 10px; border-bottom:1px solid #eef0f4; }
  .cp-head p { margin:0 0 8px; font-size:12.5px; line-height:1.4; color:#4b5563; }
  .cp-search { width:100%; box-sizing:border-box; border:1px solid #c9d1dd; border-radius:8px; padding:9px 11px; font:14px/1.2 inherit; }
  .cp-tools { display:flex; align-items:center; gap:8px; margin-top:8px; font-size:12px; color:#4b5563; flex-wrap:wrap; }
  .cp-tools select { border:1px solid #c9d1dd; border-radius:6px; padding:4px 6px; font:12px inherit; }
  .cp-btn { border:1px solid ${NAVY}; background:${NAVY}; color:#fff; border-radius:8px; padding:7px 10px; font:600 12px/1 inherit; cursor:pointer; }
  .cp-btn.ghost { background:#fff; color:${NAVY}; }
  .cp-body { flex:1 1 0; overflow-y:auto; }
  .cp-row { display:block; width:100%; text-align:start; border:0; border-bottom:1px solid #f1f3f6; background:#fff; padding:10px 14px; cursor:pointer; font:inherit; color:inherit; }
  .cp-row:hover, .cp-row:focus-visible { background:#f5f8ff; }
  .cp-row b { font-size:14px; }
  .cp-bar { display:flex; gap:10px; margin-top:4px; font-size:12px; color:#4b5563; flex-wrap:wrap; }
  .cp-bar .u { color:${UNREACHED}; font-weight:600; }
  .cp-bar .r { color:${E_COLORS[1]}; font-weight:600; }
  .cp-where { font-size:11.5px; color:#6b7280; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cp-brief { padding:12px 14px 16px; }
  .cp-back { border:0; background:none; color:${NAVY}; font:600 12px/1 inherit; cursor:pointer; padding:0 0 8px; }
  .cp-back::before { content:'← '; } [dir="rtl"] .cp-back::before { content:'→ '; }
  .cp-title { font:700 18px/1.2 inherit; margin:0 0 4px; }
  .cp-big { display:flex; gap:10px; margin:10px 0; }
  .cp-big div { flex:1; border-radius:10px; padding:10px; font-size:12px; line-height:1.3; }
  .cp-big strong { display:block; font-size:18px; }
  .cp-res { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px; }
  .cp-res span { font:600 11px/1 inherit; border-radius:999px; padding:4px 8px; border:1px solid #d1d5db; color:#6b7280; }
  .cp-res span.yes { border-color:#9fd3b0; color:#0b5e33; background:#eaf7ef; }
  .cp-brief h3 { font:700 13px/1.2 inherit; margin:14px 0 6px; }
  .cp-line { display:flex; justify-content:space-between; gap:8px; font-size:12.5px; padding:5px 0; border-bottom:1px solid #f1f3f6; }
  .cp-line button { border:0; background:none; padding:0; font:inherit; color:${NAVY}; cursor:pointer; text-align:start; }
  .cp-note { padding:14px; color:#6b7280; font-size:13px; line-height:1.45; }
  .cp-hover { position:absolute; z-index:25; pointer-events:none; background:rgba(0,27,68,.92); color:#fff; font-size:12px; line-height:1.3; padding:5px 8px; border-radius:6px; max-width:min(260px, 45%); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cp-maperr { position:absolute; inset-inline-end:12px; top:12px; z-index:15; background:#fff; border:1px solid #d9dee6; border-radius:8px; padding:8px 12px; font-size:13px; color:#6b7280; }
  .cp-handle { display:none; align-items:center; justify-content:center; gap:8px; width:100%; min-height:40px; border:0; border-bottom:1px solid #eef0f4;
    background:#fff; color:${NAVY}; font:600 12px/1 inherit; cursor:pointer; flex:0 0 auto; }
  .cp-handle::before { content:''; width:36px; height:4px; border-radius:2px; background:#c9d1dd; }
  .cp-handle:focus-visible { outline:2px solid ${NAVY}; outline-offset:-2px; }
  @media (max-width:760px) { .cp-panel { top:auto; inset-inline:6px; bottom:6px; width:auto; height:55%; }
    .cp-panel.down { height:56px; } .cp-panel.down > :not(.cp-handle) { display:none; } .cp-handle { display:flex; }
    /* The map's own bottom controls (the attribution) sit ABOVE the sheet, never under it:
       55% of the height when the sheet is up, a 56 px bar when it is down, both 6 px off the bottom. */
    .cp-root .maplibregl-ctrl-bottom-left, .cp-root .maplibregl-ctrl-bottom-right,
    .cp-root .mapboxgl-ctrl-bottom-left, .cp-root .mapboxgl-ctrl-bottom-right { bottom:calc(55% + 6px); }
    .cp-root.sheet-down .maplibregl-ctrl-bottom-left, .cp-root.sheet-down .maplibregl-ctrl-bottom-right,
    .cp-root.sheet-down .mapboxgl-ctrl-bottom-left, .cp-root.sheet-down .mapboxgl-ctrl-bottom-right { bottom:62px; }
  }
`, 'upgn-campaigns')
</script>

<template>
  <div class="cp-root" :class="{ 'sheet-down': nbState.sheetDown }">
    <div ref="mapContainer" class="cp-map"></div>
    <div v-if="mapError" class="cp-maperr" role="status">{{ mapError }}</div>
    <div v-if="hover" class="cp-hover" :style="hoverStyle">{{ hover.text }}</div>

    <aside class="cp-panel" :class="{ down: nbState.sheetDown }">
      <button type="button" class="cp-handle" :aria-expanded="nbState.sheetDown ? 'false' : 'true'" @click="toggleSheet">{{ nbState.sheetDown ? $t('neighbor.mob.sheetShow') : $t('neighbor.mob.sheetHide') }}</button>
      <template v-if="!active">
        <div class="cp-head">
          <p>{{ $t('neighbor.camp.intro') }}</p>
          <input v-model="query" class="cp-search" type="search" :placeholder="$t('neighbor.camp.searchPlaceholder')" :aria-label="$t('neighbor.camp.searchPlaceholder')" />
          <div class="cp-tools">
            <label>{{ $t('neighbor.camp.minBelievers') }}
              <select v-model.number="minBelievers">
                <option :value="1">1+</option><option :value="1000">1K+</option><option :value="10000">10K+</option><option :value="100000">100K+</option>
              </select>
            </label>
            <button class="cp-btn ghost" :disabled="!list.length" @click="exportAll">{{ $t('neighbor.camp.exportAll') }}</button>
          </div>
        </div>
        <div class="cp-body">
          <div v-if="loadError" class="cp-note" role="alert">{{ loadError }}</div>
          <div v-else-if="!data" class="cp-note">{{ $t('neighbor.mob.loading') }}</div>
          <template v-else>
            <button v-for="b in list" :key="b.lang" class="cp-row" @click="pick(b)">
              <b>{{ b.langName }}</b>
              <div class="cp-bar">
                <span class="u">{{ $t('neighbor.camp.unreachedPeople', { n: fmtNum(b.unreachedPop) }) }}</span>
                <span class="r">{{ $t('neighbor.camp.believers', { n: fmtNum(b.believers) }) }}</span>
              </div>
              <div class="cp-where">{{ $t('neighbor.camp.believersIn', { list: formatList(b.reachedCountries) }) }}</div>
            </button>
            <div v-if="!list.length" class="cp-note">{{ $t('neighbor.mob.noMatch') }}</div>
          </template>
        </div>
      </template>

      <div v-else class="cp-body">
        <div class="cp-brief">
          <button class="cp-back" @click="back">{{ $t('neighbor.camp.back') }}</button>
          <h2 class="cp-title">{{ active.langName }}</h2>
          <div class="cp-big">
            <div :style="{ background: E_COLORS[1] + '1f' }"><strong>{{ fmtNum(active.believers) }}</strong>{{ $t('neighbor.camp.bigBelievers', { g: active.reached.length, c: active.reachedCountries.length }) }}</div>
            <div :style="{ background: UNREACHED + '1a' }"><strong>{{ fmtNum(active.unreachedPop) }}</strong>{{ $t('neighbor.camp.bigUnreached', { g: active.unreached.length, c: active.unreachedCountries.length }) }}</div>
          </div>
          <div class="cp-res" :aria-label="$t('neighbor.mob.resources')">
            <span :class="{ yes: active.res.bible }">{{ $t('neighbor.res.bible') }}</span>
            <span :class="{ yes: active.res.film }">{{ $t('neighbor.res.film') }}</span>
            <span :class="{ yes: active.res.audio }">{{ $t('neighbor.res.audio') }}</span>
            <span :class="{ yes: active.res.radio }">{{ $t('neighbor.res.radio') }}</span>
          </div>
          <button class="cp-btn" @click="exportCampaign">{{ $t('neighbor.camp.export') }}</button>

          <h3>{{ $t('neighbor.camp.whereToRun') }}</h3>
          <div v-for="a in audience" :key="a.country" class="cp-line">
            <span>{{ a.country }}</span><span>{{ $t('neighbor.camp.believersInGroups', { n: fmtNum(a.believers), g: a.groups }) }}</span>
          </div>

          <h3>{{ $t('neighbor.camp.whoTheyReach') }}</h3>
          <div v-for="u in reachedTargets" :key="u.pgid" class="cp-line">
            <button @click="openGroup(u)">{{ u.name }} · {{ u.country }}</button><span>{{ fmtNum(u.pop) }}</span>
          </div>
          <p class="cp-note" style="padding:12px 0 0">{{ $t('neighbor.mob.caveat') }}</p>
        </div>
      </div>
    </aside>
  </div>
</template>
