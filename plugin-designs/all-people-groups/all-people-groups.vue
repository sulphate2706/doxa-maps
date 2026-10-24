<script setup>
/**
 * all-people-groups.vue — every people group on earth, around the DOXA set.
 *
 * @description All 12,379 people groups (peoplegroups.org) in four colors — reached,
 * unreached, frontier — with the DOXA groups in black at the center of the story.
 * @profile  all-people-groups
 * @bundle   all-people-groups
 * @element  all-people-groups
 *
 * THE PICTURE THIS MAP PAINTS: the DOXA assignment (black) sits inside the whole
 * remaining task. Green shows where the church already is (the senders next
 * door); red shows where nothing has started. A mobilizer reads it in one look:
 * "who near this black dot could go?"
 *
 * CATEGORIES (from peoplegroups.org GSEC — Global Status of Evangelical Christianity):
 *   BLACK  doxa      — the DOXA people groups (live match vs the prayer API by ROP3)
 *   RED    frontier  — GSEC 0–1: no evangelicals, or <2% with NO church planting
 *   YELLOW unreached — GSEC 2–3: <2% evangelical, active church-planting work
 *   GREEN  reached   — GSEC 4–6: 2%+ evangelical
 *
 * DATA: assets/people-groups/people-groups-points.json — the public peoplegroups.org rows (one per
 * group×country) cut to the ten fields this map uses, with repeated strings in dictionaries
 * (library/scripts/people-groups/build-points.mjs; 0.74 MB instead of the 7.5 MB slim file) — plus
 * the live DOXA set via the standard pray-tools pipeline.
 *
 * ★ LOAD ORDER (2026-09-25: the map was reported as not loading, or taking a very long time). Pins used to
 *   wait for BOTH the 7.5 MB file AND the live prayer API before anything drew. Now the compact
 *   file alone draws every pin by GSEC, and the DOXA overlay recolours its pins black when the API
 *   answers. A slow or unreachable API costs the black layer, never the map.
 */
import { inject, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useOptionalI18n } from '@map/composables/useOptionalT.js'
import { tStatic } from '@map/i18n/index.js'
import { useMapInstance, engineGlobal } from '@map/composables/useMapInstance.js'
import { resolveMapProvider, setProjectionOn } from '@map/composables/useMapProvider.js'
import { useMapData }         from '@map/composables/useMapData.js'
import { useShadowStyles }    from '@map/composables/useShadowStyles.js'
import { DataSourceManager }  from '@map/utils/DataSourceManager.js'
import MapToolbar             from '@map/components/map-controls/MapToolbar.vue'
import ShareButton            from '@map/components/map-controls/ShareButton.vue'
import HelpButton             from '@map/components/map-controls/HelpButton.vue'
import { resolveAssetsBase }  from '@map/utils/embedBase.js'

useShadowStyles(`
  .apg-root { position:absolute;inset:0;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; }
  .apg-canvas { position:absolute;inset:0; }
  /* MATERIAL LIGHT (2026-09-21). Was background #0b1220 / color #9aa7b8 — a near-black overlay that
     every visitor sees, because v-if="!appReady" renders it on EVERY load until the data arrives.
     Same shape as the .dsm-loading violation already fixed in doxa-simple-map: an UNCONDITIONAL
     dark surface, not one of the dormant .is-dark rulesets. The earlier sweep found six dark
     matches and correctly ruled five of them unreachable, but this file was not among them.
     Palette: surface #f3f3f1, muted text #6d766e. */
  .apg-loading { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    background:#f3f3f1;color:#6d766e;font-size:14px;z-index:5; }
  .apg-error { position:absolute;top:50%;left:12px;right:12px;z-index:7;transform:translateY(-50%);
    text-align:center;font-size:13px;line-height:1.5;color:#7f1d1d;background:rgba(255,255,255,.94);
    border:1px solid rgba(127,29,29,.25);border-radius:10px;padding:12px 14px; }
  .apg-legend { position:absolute;left:10px;top:10px;z-index:6;background:rgba(255,255,255,.95);
    border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 3px 12px rgba(0,0,0,.15);
    padding:12px 14px;min-width:230px; }
  .apg-legend-title { font-size:12px;font-weight:800;color:#111827;margin-bottom:2px;
    text-transform:uppercase;letter-spacing:.05em; }
  .apg-legend-sub { font-size:11px;color:#6b7280;margin-bottom:8px; }
  .apg-row { display:flex;align-items:center;gap:9px;font-size:12.5px;color:#374151;
    line-height:2;cursor:pointer;border-radius:8px;padding:0 8px;margin:0 -8px;
    border:1px solid transparent; }
  .apg-row:hover { background:#f3f4f6; }
  .apg-row.active { background:#eef2ff;border-color:#c7d2fe;font-weight:700; }
  .apg-dot { flex:none;width:11px;height:11px;border-radius:50%;border:1.5px solid #fff;
    box-shadow:0 0 0 1px rgba(0,0,0,.35); }
  .apg-count { margin-left:auto;font-variant-numeric:tabular-nums;color:#6b7280;font-size:11.5px; }
  .apg-hint { font-size:10.5px;color:#9ca3af;margin-top:7px; }
  .apg-pop { font:12.5px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .apg-pop b { font-size:13.5px; }
  .apg-pop .cat { display:inline-block;padding:1px 8px;border-radius:999px;color:#fff;
    font-size:10.5px;font-weight:700;letter-spacing:.03em;vertical-align:1px; }
  .apg-pop .meta { color:#4b5563;margin-top:4px; }
  .apg-pop a { display:inline-block;margin-top:7px;font-weight:700;color:#b45309;text-decoration:none; }
  .apg-pop a:hover { text-decoration:underline; }
`, 'all-people-groups')

// ─── Config from ProfileLoader ───────────────────────────────────────────────
const profileConfig = inject('profileConfig')
const mapboxToken   = inject('mapboxToken')
const dataSource    = inject('dataSource')
const dataStore     = inject('dataStore')
const mapStore      = inject('mapStore')

// Read-only theme flag, the same source gospel-resources reads. No ThemeToggleButton:
// this profile does not own its theme, it follows the host page.
const isDark = computed(() => profileConfig.value?.isDark === true)

// This map's own standalone embed page, TREE-RELATIVE (<bundle>/<profile>/index.html),
// taken from the manifest entry rather than hand-composed. ShareButton joins it to the
// served tree root via utils/embedBase.js, so the link works wherever the tree is hosted
// — never a hardcoded /js/doxa-maps/…, which 404s on doxa.life's /js/doxa-maps-build/.
const SHARE_EMBED_PATH = 'all-people-groups/all-people-groups/index.html'

const mapProvider = resolveMapProvider(profileConfig)
// Through the shared resolver, not a '/assets' fallback: that root path 404s whenever the tree
// is served below the site root, and inside the Research Gallery no assetsBase is passed at all.
const assetsBase  = computed(() => resolveAssetsBase(profileConfig?.value || {}))

// ─── Words (library/i18n/locales/<lc>/allPeopleGroups.json, all 11 locales) ────
// The English for these eleven strings lives in library/i18n/locales/en/allPeopleGroups.json and
// nowhere else. An inline EN map used to duplicate it here as the bare-host fallback; with the
// locale-honouring default that copy had no job left, and a second copy of a catalogue is only a
// place for the two to drift apart.
// C4 wave 3d: the guard is library/composables/useOptionalI18n now — this site needs more than `t`,
// so it takes the {t, te, locale} form rather than useOptionalT.
// ★ THE LOCALE-HONOURING FALLBACK (ruled 2026-09-27, product goal (d)):
// a BARE-HOST EMBED WITH ?lang=ar MUST RENDER ARABIC. Recorded in COMMON.md as the embed contract.
// This file used to pass its inline EN map as the fallback, which served ENGLISH to exactly the hosts
// that cannot install vue-i18n — the seven bundles here that install none. tStatic honours the runtime
// locale and keeps English as the last resort, so those readers now get their own language.
// ★ THE RULING'S CONDITION WAS MEASURED BEFORE THE SWITCH, not after: all ELEVEN keys this file uses
// are present in all ELEVEN locales (0 gaps, counted 2026-09-27), and ar differs from en on 11 of 11,
// so the change is observable rather than cosmetic. With the catalogue complete there is nothing the
// EN map could still rescue: a key it holds is a key tStatic also holds.
// The keys arrive BARE here ('hint', 'pray'), and qualify() adds the 'allPeopleGroups.' prefix, which
// is exactly what the hand-written `const full = 'allPeopleGroups.' + key` did.
// ★ ONE EQUIVALENCE WORTH STATING: the old code asked te() first and only then t(). The helper calls
// t() and falls back when it returns the key unchanged. Same outcome both ways — present key: the
// translation; absent key: EN — and it no longer depends on te() being implemented.
const { t: tr, locale: i18nLocale } = useOptionalI18n('allPeopleGroups')
// locale arrives as a REF when the host installed i18n and a plain string when it did not
// (PosterWall.vue records the same variance), so unwrap both shapes.
const uiLocale = computed(() => {
  const l = i18nLocale
  return (l && typeof l === 'object' && 'value' in l ? l.value : l) || 'en'
})
const fmt = (n) => { try { return Number(n).toLocaleString(uiLocale.value) } catch (_) { return Number(n).toLocaleString() } }

// ─── The four categories (the chosen palette) ────────────────────────────────
// Tuned for the LIGHT basemap (2026-09-25; was a near-black map, where the black DOXA pins vanished).
// Same four meanings and hues; yellow and green are a step darker because pure #f1c40f / #2ecc71
// wash out on near-white, and every pin carries a thin dark ring instead of a white one.
const CATS = [
  { id: 'doxa',      color: '#111827' },
  { id: 'frontier',  color: '#e0392b' },
  { id: 'unreached', color: '#e6a800' },
  { id: 'reached',   color: '#23a45a' },
]
const CAT_COLOR = Object.fromEntries(CATS.map(c => [c.id, c.color]))
const counts = ref({ doxa: 0, frontier: 0, unreached: 0, reached: 0 })
// The DOXA count is only known once the prayer API answers; until then its row says "…", not 0.
const doxaReady = ref(false)

function categorize(row, doxaSet) {
  if (doxaSet.has(String(row.ROP3Code || ''))) return 'doxa'
  const g = Number(row.GSEC)
  if (!Number.isFinite(g) || g <= 1) return 'frontier'
  if (g <= 3) return 'unreached'
  return 'reached'
}

// ─── Outbound attribution (same ladder as PeopleGroupDetail) ─────────────────
function utmSource() {
  let fromUrl = ''
  try { fromUrl = new URLSearchParams(window.location.search).get('utm_source') || '' } catch (_) {}
  const fromConfig = profileConfig?.value?.utmSource
  return encodeURIComponent(String(fromUrl || fromConfig || 'agwm'))
}

// ─── Map boot (shared composable — provider-aware, token-aware) ──────────────
const mapContainer = ref(null)
const appReady = ref(false)
const mapError = ref(null)
const { map, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken: mapboxToken.value,
  provider: mapProvider,
  // Named style 'paper' = near-white minimal (Mapbox light-v11 / MapLibre positron): house style is
  // Material LIGHT, and the black DOXA pins must read on it. A host may still pass its own style.
  style: profileConfig?.value?.style ?? 'paper',
  center: [20, 12],
  zoom: 1.6,
})

// DOXA set via the standard pipeline (rop3 = peoplegroups.org ROP3Code)
const dsm = new DataSourceManager()
const mapData = useMapData({
  mapId: 'all-people-groups',
  dataSourceId: dataSource.value,
  dataSourceManager: dsm,
  dataStore,
  markRaw: (v) => v,
})

// ★ PERFORMANCE (DRV1650-APG-PERFORMANCE, 2026-09-29). The map worker gets SLIM features: an id (the
// row's index) and one category number. Every name, country, language and religion used to ride on
// all 12,379 features, 3.7 MB of GeoJSON built and re-tiled TWICE (first paint, then the DOXA recolour);
// slim, it is 1.25 MB, built once. The popup reads the row by id. The DOXA recolour no longer rebuilds
// the 12,379 with all their fields: DOXA pins are a small source of their own drawn on top, and the base
// is re-sent once, slim, WITHOUT them (an invisible twin per DOXA group still cost a draw: measured).
let rows = []                 // the decoded rows; a feature's id is its index here
let doxaIds = new Set()       // row indexes in the DOXA set (empty until the prayer API answers)
let doxaBySlugRop = new Map() // rop3 → { slug, name } for the pray link
// Category numbers on the base layer, from GSEC alone (DOXA is its own layer): the paint and the
// sort order read these.
const GSEC_CAT = ['frontier', 'unreached', 'reached']

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Rows in one shape whichever file served them: the compact points file (column arrays + string
// dictionaries), or — for a tree built before it existed — the old slim file's objects.
async function loadRows() {   // → the decoded rows
  const base = assetsBase.value
  const r = await fetch(`${base}/people-groups/people-groups-points.json`)
  if (r.ok) {
    const d = await r.json()
    const D = d.dicts || {}
    return (d.rows || []).map((x) => ({
      lng: x[0], lat: x[1], gsec: x[2], rop3: x[3], name: x[4], country: (D.country || [])[x[5]] || '',
      population: x[6], language: (D.language || [])[x[7]] || '', religion: (D.religion || [])[x[8]] || '',
      evangelical: (D.evangelical || [])[x[9]] || '',
    }))
  }
  const old = await fetch(`${base}/people-groups/people-groups-slim.json`)
  if (!old.ok) throw new Error(`people-groups-points.json ${r.status}`)
  const slim = await old.json()
  return (slim.rows || []).map((row) => ({
    lng: Number(row.Long), lat: Number(row.Lat), gsec: row.GSEC, rop3: String(row.ROP3Code || ''),
    name: row.Name || '', country: row.CountryName || '', population: Number(row.Population) || 0,
    language: row.LanguageName || '', religion: row.ReligionName || '', evangelical: row.EvangelicalLevel || '',
  }))
}

// A row the map can place (the file carries a few without coordinates).
const placed = (row) => { const lat = Number(row.lat), lng = Number(row.lng); return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) }
// A row's category: DOXA first, else by GSEC. The counts, the legend filter and the popup all use it.
const catOf = (i) => (doxaIds.has(i) ? 'doxa' : categorize({ GSEC: rows[i].gsec }, new Set()))
const slimPoint = (i, c) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [Number(rows[i].lng), Number(rows[i].lat)] }, properties: { c } })

// Every pin by GSEC, from the file alone: built ONCE. The DOXA overlay (applyDoxa) comes later and never blocks.
function buildBase() {
  const feats = []
  for (let i = 0; i < rows.length; i++) if (placed(rows[i]) && !doxaIds.has(i)) feats.push(slimPoint(i, GSEC_CAT.indexOf(catOf(i))))
  recount()
  return { type: 'FeatureCollection', features: feats }
}
function recount() {
  const c = { doxa: 0, frontier: 0, unreached: 0, reached: 0 }
  for (let i = 0; i < rows.length; i++) if (placed(rows[i])) c[catOf(i)]++
  counts.value = c
}
// The DOXA set arrived: its pins go on the top layer (a ~2,100-point source) and the base is re-sent,
// slim, without them, so no DOXA group is drawn twice.
function applyDoxa(doxaSet) {
  const m = map.value
  if (!m || !m.getSource('apg')) return
  const ids = new Set()
  for (let i = 0; i < rows.length; i++) if (placed(rows[i]) && doxaSet.has(String(rows[i].rop3 || ''))) ids.add(i)
  doxaIds = ids
  m.getSource('apg').setData(buildBase())
  m.getSource('apg-doxa').setData({ type: 'FeatureCollection', features: [...ids].map((i) => slimPoint(i, 0)) })
}

// The live DOXA set (rop3 = peoplegroups.org ROP3Code). Resolves to an empty set on failure.
async function loadDoxaSet() {
  let doxa = []
  try { await mapData.loadData(); doxa = mapData.normalizedPeopleGroups.value || [] } catch (e) {
    console.warn('[all-people-groups] DOXA overlay unavailable (map still renders by GSEC):', e)
  }
  const doxaSet = new Set()
  for (const pg of doxa) {
    // The prayer API's ROP3 is imb_reg_of_people_3, which sources.json normalises to
    // peopleGroupCountry — the API source maps NO peopleGroupId (only the CSV source does). Reading
    // peopleGroupId alone left this set empty and the legend read "DOXA people groups 0".
    const rop = String(pg.peopleGroupId || pg.rop3 || pg.peopleGroupCountry || '')
    if (!rop) continue
    doxaSet.add(rop)
    if (!doxaBySlugRop.has(rop)) doxaBySlugRop.set(rop, { slug: pg.slug || '', name: pg.name || '' })
  }
  return doxaSet
}

// Pin size and ring, shared by the base and the DOXA layer.
const PIN_RADIUS = ['interpolate', ['linear'], ['zoom'], 0, 2.2, 4, 3.4, 8, 6, 12, 9]
const PIN_STROKE_WIDTH = ['interpolate', ['linear'], ['zoom'], 0, 0.3, 6, 0.6, 12, 1]

function addLayer(fc) {
  const m = map.value
  m.addSource('apg', { type: 'geojson', data: fc })
  m.addSource('apg-doxa', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({
    id: 'apg-pins', type: 'circle', source: 'apg',
    // ★ circle-sort-key IS A LAYOUT PROPERTY, NOT PAINT — and putting it in paint cost this
    // layer entirely under MapLibre. Mapbox tolerated the misplacement; MapLibre validates the
    // spec and rejects the WHOLE layer for one unknown paint property, so every pin on this map
    // vanished with nothing thrown. FOUND by listening to the map's own `error` event across
    // every isMap leaf, which is the only place it surfaces:
    //     layers.apg-pins.paint.circle-sort-key: unknown property "circle-sort-key"
    // Same failure shape as the *-emissive-strength drops fixed alongside this; the sort order
    // itself is unchanged, it just now lives where the style spec says it belongs.
    layout: {
      // frontier above unreached above reached (DOXA is the layer above all three).
      'circle-sort-key': ['match', ['get', 'c'], 0, 3, 1, 2, 1],
    },
    paint: {
      'circle-color': ['match', ['get', 'c'], 0, CAT_COLOR.frontier, 1, CAT_COLOR.unreached, CAT_COLOR.reached],
      // Thin high-contrast ring — visible, never clunky (the pin-visibility spec).
      // A thin DARK ring on the light basemap: separates overlapping pins and keeps the yellow and
      // green legible on near-white (a white ring was right only on the old dark map).
      'circle-stroke-color': '#1f2937',
      'circle-stroke-width': PIN_STROKE_WIDTH,
      'circle-stroke-opacity': 0.55,
      'circle-radius': PIN_RADIUS,
      'circle-opacity': 0.92,
    },
  })
  // DOXA: the assignment, black, above everything else.
  m.addLayer({
    id: 'apg-doxa-pins', type: 'circle', source: 'apg-doxa',
    paint: {
      'circle-color': CAT_COLOR.doxa,
      'circle-stroke-color': '#1f2937', 'circle-stroke-width': PIN_STROKE_WIDTH, 'circle-stroke-opacity': 0.55,
      'circle-radius': PIN_RADIUS, 'circle-opacity': 0.92,
    },
  })
  for (const id of ['apg-pins', 'apg-doxa-pins']) {
    m.on('mouseenter', id, () => { m.getCanvas().style.cursor = 'pointer' })
    m.on('mouseleave', id, () => { m.getCanvas().style.cursor = '' })
  }
  // ONE click handler, top layer first: a DOXA pin wins over a base pin under it.
  m.on('click', (e) => {
    const hits = m.queryRenderedFeatures(e.point, { layers: ['apg-doxa-pins', 'apg-pins'].filter((id) => m.getLayer(id)) })
    const f = hits[0]
    if (!f || rows[Number(f.id)] == null) return
    const i = Number(f.id), row = rows[i]
    const category = catOf(i)
    const p = { name: row.name, country: row.country, population: Number(row.population) || 0, gsec: row.gsec,
      evangelical: row.evangelical, language: row.language, religion: row.religion, rop3: String(row.rop3 || ''), category }
    const doxaRec = p.category === 'doxa' ? doxaBySlugRop.get(p.rop3) : null
    const cat = CATS.find(x => x.id === p.category)
    const pray = doxaRec && doxaRec.slug
      ? `<a href="https://pray.doxa.life/${encodeURIComponent(doxaRec.slug)}?source=doxalife&utm_source=${utmSource()}" target="_blank" rel="noopener">${esc(tr('pray'))}</a>`
      : ''
    // C3: engineGlobal() resolves a provider NAME to its namespace and already defaults to Mapbox
    // for anything unrecognised, which is exactly what this ternary's else branch did.
    const NS = engineGlobal(mapProvider)
    new NS.Popup({ closeButton: true, maxWidth: '290px' })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="apg-pop">
        <b>${esc(p.name)}</b> <span class="cat" style="background:${cat.color}">${esc(tr(cat.id).split(' — ')[0])}</span>
        <div class="meta">${esc(p.country)} · ${esc(tr('population', { n: fmt(p.population) }))}</div>
        <div class="meta">${esc(p.evangelical || ('GSEC ' + p.gsec))}</div>
        <div class="meta">${esc(p.language)}${p.religion ? ' · ' + esc(p.religion) : ''}</div>
        ${pray}
      </div>`)
      .addTo(m)
  })
}

// ─── Legend interactions: click a category → filter + fit to ALL of it ───────
const activeCat = ref(null)
function selectCat(id) {
  const m = map.value
  if (!m || !m.getLayer('apg-pins')) return
  if (activeCat.value === id) {          // click again = show everything
    activeCat.value = null
    m.setFilter('apg-pins', null)
    m.setLayoutProperty('apg-doxa-pins', 'visibility', 'visible')
    m.fitBounds([[-170, -55], [179, 72]], { padding: 20, duration: 900 })
    return
  }
  activeCat.value = id
  // DOXA lives on its own layer; the other three are the base layer's category numbers (the base holds
  // no DOXA group, so a GSEC filter never shows one twice).
  if (id === 'doxa') m.setFilter('apg-pins', ['==', ['get', 'c'], -1])
  else m.setFilter('apg-pins', ['==', ['get', 'c'], GSEC_CAT.indexOf(id)])
  m.setLayoutProperty('apg-doxa-pins', 'visibility', id === 'doxa' ? 'visible' : 'none')
  // Zoom OUT to see every dot of the chosen category (the visibility spec).
  let minX = 180, minY = 85, maxX = -180, maxY = -85, n = 0
  for (let i = 0; i < rows.length; i++) {
    if (!placed(rows[i]) || catOf(i) !== id) continue
    const x = Number(rows[i].lng), y = Number(rows[i].lat)
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    n++
  }
  if (n) m.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: 900, maxZoom: 6 })
}

onMounted(async () => {
  // Start both fetches NOW, in parallel with the map booting; neither waits for the other.
  const rowsPromise = loadRows().catch((err) => { mapError.value = String(err?.message || err); return null })
  const doxaPromise = loadDoxaSet()
  try { await initializeMap() } catch (err) {
    mapError.value = String(err?.message || err); return
  }
  // No map: if the pane is still here that is a real failure (token, container) and says so; if it
  // was unmounted while initialising, useMapInstance returned quietly and so do we.
  // Shown after tr('loadError'); this detail used to be English in every locale.
  if (!map.value) { if (mapContainer.value) mapError.value = tStatic('messages.mapUnavailable'); return }
  map.value.once('style.load', async () => {
    try {
      const loaded = await rowsPromise
      if (!loaded || !map.value) return
      rows = loaded
      setProjectionOn(map.value, 'mercator')   // per-engine shape: library/useMapProvider (C2)
      addLayer(buildBase())   // every pin, by GSEC — the first paint
      mapStore?.registerMap?.('all-people-groups', map.value)
      appReady.value = true
      // DOXA overlay: recolour when the prayer API answers, whenever that is.
      const doxaSet = await doxaPromise
      if (doxaSet.size && map.value) applyDoxa(doxaSet)
      doxaReady.value = true
    } catch (err) { mapError.value = String(err?.message || err) }
  })
})

onBeforeUnmount(() => {
  mapStore?.unregisterMap?.('all-people-groups')
  destroy()
})

const totalShown = computed(() =>
  counts.value.doxa + counts.value.frontier + counts.value.unreached + counts.value.reached)
</script>

<template>
  <div class="apg-root">
    <div v-if="!appReady && !mapError" class="apg-loading">{{ tr('loading') }}</div>
    <div v-if="mapError" class="apg-error">{{ tr('loadError') }} {{ mapError }}</div>
    <div ref="mapContainer" class="apg-canvas" />

    <!-- SHARING. This bundle was published, embeddable and reachable with NO way to
         share it by any mechanism — no ShareButton, no shareUrl config, and no composite
         parent overriding one on its behalf, while every other published map had exactly
         one (check:share-policy recorded it as 'debt-no-share'). A reader who landed here
         could not send it to anyone, which is the point of an embeddable jamstack map.

         NOT gated on appReady, unlike the legend below. Sharing a map does not require
         its data to have loaded — and gating it would remove the affordance exactly when
         a slow or failed load makes a reader most likely to want the link. Same call
         gospel-resources records: "ShareButton needs neither and always renders so the
         map is embeddable."

         has-geocoder=false: this profile mounts no search pill, so the toolbar's mobile
         top offset collapses to the desktop 10px instead of reserving space for one. -->
    <MapToolbar :has-geocoder="false">
      <ShareButton :is-dark="isDark" :embed-path="SHARE_EMBED_PATH" />
      <HelpButton :is-dark="isDark" hosted />
    </MapToolbar>

    <div v-if="appReady" class="apg-legend">
      <div class="apg-legend-title">{{ tr('title') }}</div>
      <div class="apg-legend-sub">{{ tr('locations', { n: fmt(totalShown) }) }}</div>
      <div
        v-for="c in CATS" :key="c.id"
        class="apg-row" :class="{ active: activeCat === c.id }"
        @click="selectCat(c.id)"
      >
        <span class="apg-dot" :style="{ background: c.color }"></span>
        {{ tr(c.id) }}
        <span class="apg-count">{{ c.id === 'doxa' && !doxaReady ? '…' : fmt(counts[c.id] || 0) }}</span>
      </div>
      <div class="apg-hint">{{ tr('hint') }}</div>
    </div>
  </div>
</template>
