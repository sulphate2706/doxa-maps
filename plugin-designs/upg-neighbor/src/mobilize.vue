<script setup>
/**
 * mobilize.vue — pick an unreached people group; see the reached groups whose believers are nearest
 * to it in culture (Winter's E-scale) and geography, and export them as campaign audience segments.
 *
 * The question it answers: "for THIS unreached group, whom do we mobilize, in what language, where,
 * and how many believers are there?" Data: nearData.js (data/tables/near-neighbors.json).
 * The panel works without the map: if the map cannot be built, search and the brief still do.
 */
import { inject, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useMapInstance } from '@map/composables/useMapInstance.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { setProjectionOn } from '@map/composables/useMapProvider.js'
import { whenStyleReady } from './whenStyleReady.js'
import { useNeighborT } from './composables/useNeighborT.js'
import { tStatic, getRuntimeLocale } from '@map/i18n/index.js'
import FUNNEL from '../../../data/people-groups/vision-funnel.json'
import { loadNearData, E_COLORS, UNREACHED, REACHED, SELECTED, NAVY, fold, fmtNum, downloadCsv, downloadText } from './nearData.js'
import { buildLetter } from './letter.js'

const nt = useNeighborT()
// Full literal keys (the i18n gate reads literals; a key built by concatenation looks missing to it).
const E_SHORT = { 1: 'neighbor.e.short1', 2: 'neighbor.e.short2', 3: 'neighbor.e.short3' }
const E_TITLE = { 1: 'neighbor.e.title1', 2: 'neighbor.e.title2', 3: 'neighbor.e.title3' }
const E_LONG = { 1: 'neighbor.e.long1', 2: 'neighbor.e.long2', 3: 'neighbor.e.long3' }
// The same levels read from the other side: a REACHED group, and the unreached groups it can reach.
const E_RLONG = { 1: 'neighbor.e.rlong1', 2: 'neighbor.e.rlong2', 3: 'neighbor.e.rlong3' }
const P_TITLE = { 0: 'neighbor.p.title0', 1: 'neighbor.p.title1', 2: 'neighbor.p.title2', 3: 'neighbor.p.title3' }
const P_LONG = { 0: 'neighbor.p.long0', 1: 'neighbor.p.long1', 2: 'neighbor.p.long2', 3: 'neighbor.p.long3' }
const profileConfig = inject('profileConfig', ref({}))
const mapboxToken = inject('mapboxToken', ref(''))
const nbState = inject('nbState')              // shared with the root: selected group, active view
const cfg = computed(() => profileConfig?.value || {})

const mapContainer = ref(null)
const data = ref(null)
const loadError = ref('')
const mapError = ref('')
const query = ref('')
const pFilter = ref(0)                          // 0 = all, else only groups at that P-level
// Which groups the list shows. A church looks for its OWN (reached) group: the letter generator starts
// from a green dot, so the list and the search find reached groups too, most believers first. Kept in
// nbState, so a trip to Campaigns and back returns to the same list.
const kind = computed({ get: () => nbState.list || 'unreached', set: (v) => { nbState.list = v } })   // 'unreached' | 'reached'

const { map, initializeMap, destroy } = useMapInstance({
  containerRef: mapContainer,
  accessToken: mapboxToken?.value || cfg.value.tk || '',
  style: cfg.value.style ?? 'mapbox://styles/mapbox/light-v11',
  center: cfg.value.center ?? [45, 20],
  zoom: cfg.value.zoom ?? 1.6,
  minZoom: 1, maxZoom: 11,
})

// ─── Selection ────────────────────────────────────────────────────────────────
// BOTH DIRECTIONS (2026-09-28): a red dot shows the reached groups to mobilize for it; a green dot
// shows the unreached groups its believers are nearest to. One selection, whichever kind it is.
const selected = computed(() => data.value?.groups.find((g) => g.pgid === nbState.pgid) || null)
const isReachedSel = computed(() => !!selected.value?.reached)
const allNeighbors = computed(() => {
  const g = selected.value
  if (!g) return []
  return g.reached ? data.value.unreachedNeighborsOf(g) : data.value.neighborsOf(g)
})
// THE LETTER'S AUDIENCE (test round 2: UPG Neighbor is a letter generator for GREEN groups).
// A reached group's unreached neighbours are shown ONE E-level at a time: E-1 (the same language) by
// default, E-2 / E-3 on request, closest first. The list, the map lines and the CSV all follow it.
const levelCounts = computed(() => {
  const c = { 1: 0, 2: 0, 3: 0 }
  for (const n of allNeighbors.value) if (c[n.e] != null) c[n.e]++
  return c
})
// The reader's pick while that level has neighbours; otherwise the first level that has any (E-1 first).
// Computed, not set on click, because a group opened from a link arrives before its data does.
const eChoice = ref(null)
watch(() => nbState.pgid, () => { eChoice.value = null })
const eLevel = computed({
  get: () => (eChoice.value && levelCounts.value[eChoice.value]) ? eChoice.value : ([1, 2, 3].find((e) => levelCounts.value[e]) || 1),
  set: (v) => { eChoice.value = v },
})
const neighbors = computed(() => (isReachedSel.value
  ? allNeighbors.value.filter((n) => n.e === eLevel.value).sort((a, b) => a.km - b.km)
  : allNeighbors.value))
const byLevel = computed(() => [1, 2, 3].map((e) => ({ e, list: neighbors.value.filter((n) => n.e === e) })).filter((x) => x.list.length))
const believersNear = computed(() => neighbors.value.reduce((a, n) => a + n.g.believers, 0))
const peopleReachable = computed(() => neighbors.value.reduce((a, n) => a + n.g.pop, 0))

// A pick raises the phone sheet first, so the frame below is computed for the sheet that will show
// the pick's detail (measured at 390: a pick with the list lowered showed only a tooltip).
function select(g) { if (g) { nbState.sheetDown = false; nbState.pgid = g.pgid; query.value = '' } }

// The neighbor in focus: a dot click picks its card, a card click flies to its dot. Both ways, so the
// map and the brief never disagree about which neighbor you are looking at.
const activeId = ref(null)
// Hover label: 7,000 red dots are anonymous until clicked, so name the one under the pointer.
const hover = ref(null)   // { x, y, text }
function hoverAt(ev, text) { hover.value = text ? { x: ev.point.x, y: ev.point.y, text } : null }
// The tip opens toward the side with more room, so near an edge it is never cut off (a run saw "Ko…"
// at the right edge in ar); max-width keeps it inside half the map on a phone. A tip is stale as soon as
// the map moves (a tap, then the fly to the pick), so moving clears it.
const hoverStyle = computed(() => {
  const h = hover.value
  if (!h) return {}
  const w = mapContainer.value?.clientWidth || 0
  return h.x > w / 2 ? { right: (w - h.x + 12) + 'px', top: h.y + 12 + 'px' } : { left: h.x + 12 + 'px', top: h.y + 12 + 'px' }
})
// A big reached group can be the nearest church for 1,000+ unreached groups: render 30 cards per level
// until the reader asks for the rest, so a click never builds a thousand-card DOM.
const CARD_CAP = 30
const expanded = ref(new Set())
watch(() => nbState.pgid, () => { activeId.value = null; expanded.value = new Set() })
function expand(e) { expanded.value = new Set([...expanded.value, e]) }
function focusNeighbor(n, fly = true) {
  activeId.value = n.g.pgid
  applyActive()
  const m = map.value
  // padding: centred in the part of the map you can see, above the phone sheet
  if (fly && m) { try { m.stop(); m.easeTo({ center: [n.g.lng, n.g.lat], zoom: Math.max(m.getZoom(), 5), padding: framePadding(), duration: 700 }) } catch (_) {} }
  // A card past the first CARD_CAP of its level is not rendered yet: open that level, then scroll once it is.
  const lv = byLevel.value.find((x) => x.e === n.e)
  if (lv && !expanded.value.has(n.e) && lv.list.indexOf(n) >= CARD_CAP) expand(n.e)
  nextTick(() => {
    const card = mapContainer.value?.getRootNode?.()?.querySelector?.(`[data-nb="${n.g.pgid}"]`)
    card?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  })
}
function applyActive() {
  const m = map.value
  if (m?.getLayer?.('nb-a')) m.setFilter('nb-a', ['==', ['get', 'id'], activeId.value || ''])
}
function clearSelection() { nbState.pgid = null }

// ─── Search / default list ───────────────────────────────────────────────────
// pool = the unreached groups the map draws red (the P filter applies); the list may show reached ones.
const pool = computed(() => (data.value ? data.value.unreached.filter((u) => !pFilter.value || u.p === pFilter.value) : []))
const listPool = computed(() => (kind.value === 'reached' ? (data.value?.reached || []) : pool.value))
const results = computed(() => {
  const q = fold(query.value.trim())
  const list = q
    ? listPool.value.filter((u) => fold(u.name).includes(q) || fold(u.country).includes(q) || fold(u.langName).includes(q))
    : listPool.value
  const by = kind.value === 'reached' ? 'believers' : 'pop'
  return [...list].sort((a, b) => (b[by] || 0) - (a[by] || 0)).slice(0, 40)
})
const pCounts = computed(() => {
  const c = { 1: 0, 2: 0, 3: 0 }
  for (const u of data.value?.unreached || []) if (c[u.p] != null) c[u.p]++
  return c
})

// ─── Export: one row per neighbor = one audience segment ────────────────────
function exportSegments() {
  const u = selected.value
  if (!u) return
  const header = ['unreached_group', 'unreached_country', 'unreached_language', 'unreached_population', 'p_level',
    'e_level', 'same_people', 'neighbor_group', 'neighbor_country', 'bridge_language', 'bridge_language_code',
    'est_believers', 'distance_km', 'lat', 'lng', 'bible', 'jesus_film', 'audio', 'radio', 'pgid']
  // One row per (unreached, reached) pair, whichever side is selected, so both exports share one schema.
  const rows = neighbors.value.map((n) => {
    const un = u.reached ? n.g : u, re = u.reached ? u : n.g
    return [un.name, un.country, un.langName, un.pop, 'P-' + un.p, 'E-' + n.e, n.same ? 'yes' : '',
      re.name, re.country, re.langName, re.lang, re.believers, n.km, re.lat, re.lng,
      re.bible ? 'yes' : 'no', re.film ? 'yes' : 'no', re.audio ? 'yes' : 'no', re.radio ? 'yes' : 'no', re.pgid]
  })
  downloadCsv(u.reached ? `unreached-neighbors-${u.pgid}-E${eLevel.value}.csv` : `near-neighbors-${u.pgid}.csv`, header, rows)
}
// ─── The letter (phase 3): to the selected REACHED group's believers ─────────
// Written from the same list as the CSV (this E-level, closest first). The text is editable before it is
// copied or downloaded; it opens in a dialog that takes focus, keeps it, and closes on Escape.
const letterOpen = ref(false)
const letterText = ref('')
const letterBox = ref(null), letterBtn = ref(null)
const letterStatus = ref('')
let statusToken = null
function openLetter() {
  const g = selected.value
  if (!g || !g.reached) return
  letterText.value = buildLetter({ group: g, neighbors: neighbors.value, level: nt(E_SHORT[eLevel.value]), t: nt, fmt: fmtNum })
  letterStatus.value = ''
  letterOpen.value = true
  nextTick(() => letterBox.value?.querySelector('textarea')?.focus())
}
function closeLetter() { letterOpen.value = false; nextTick(() => letterBtn.value?.focus?.()) }
function flashStatus(msg) {
  // Cleared by identity (the token set here), never by comparing the translated text.
  const tok = {}; statusToken = tok; letterStatus.value = msg
  setTimeout(() => { if (statusToken === tok) letterStatus.value = '' }, 2000)
}
async function copyLetter() {
  try { await navigator.clipboard.writeText(letterText.value); flashStatus(tStatic('messages.copied')) }
  catch (_) { letterBox.value?.querySelector('textarea')?.select() }   // no clipboard (an http page): select it for Ctrl/Cmd-C
}
function downloadLetter() {
  const g = selected.value
  if (g) downloadText(`letter-${g.pgid}-E${eLevel.value}.txt`, letterText.value)
}
function onLetterKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLetter(); return }
  if (e.key !== 'Tab') return
  const f = [...(letterBox.value?.querySelectorAll('textarea,button') || [])]
  if (!f.length) return
  const root = letterBox.value.getRootNode(), active = root.activeElement
  if (e.shiftKey && active === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
  else if (!e.shiftKey && active === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
}
watch(() => nbState.pgid, () => { letterOpen.value = false })

// ─── The neighbours prayer packet (phase 4): the SHARED packet, not a copy ─────
// library/composables/usePosterPrints.printPacket with library/packet's renderer, the one UPG-100 prints
// with. The group set is upg100's shape (a pg_slugs selector); the members are the same list as the map,
// the CSV and the letter (this E-level, closest first), capped at PACKET_CAP, and the cover label says so.
// Decisions agreed with upg100 (2026-09-29):
//   · variant 'lightweight': the %-evangelical page is DOXA-wide today and would describe DOXA, not these
//     neighbours; lightweight prints map · triangle · profiles · wheel · points.
//   · the triangle is told its own steps: all → unreached → these N. Its default puts DOXA's 2,107 directly
//     above N, which would read as "these are a subset of DOXA's list"; they are not.
//   · one explicit record adapter (below), because the renderer and describeGroup read their own field
//     names and a mismatch prints blank, never fails.
const PACKET_CAP = 60
const packetBusy = ref(false)
const packetSlug = (g) => g.slug || g.pgid
// Photos: joined from the doxa people-group list by slug, when an API is configured (config-only and
// fail-closed, as upg100: no default host). No photo prints the renderer's own "no photo" tile.
async function doxaPhotos(groups) {
  const base = (typeof window !== 'undefined' && window.MAP_APP_API_URL) || import.meta.env.VITE_API_BASE_URL || ''
  const want = new Set(groups.map((g) => g.slug).filter(Boolean))
  if (!base || !want.size) return new Map()
  try {
    const r = await fetch(`${base}/api/people-groups/list?fields=slug,image_url`)
    if (!r.ok) return new Map()
    const j = await r.json()
    const list = Array.isArray(j) ? j : (j.data || j.people_groups || j.posts || [])
    const url = (v) => (v && typeof v === 'object' ? v.value || v.url || '' : v || '')
    return new Map(list.filter((x) => want.has(x.slug) && url(x.image_url)).map((x) => [x.slug, url(x.image_url)]))
  } catch (_) { return new Map() }
}
const packetRecord = (g, photos) => ({
  slug: packetSlug(g), name: g.name, population: g.pop, religion: g.religion,
  country_code: g.iso3,                  // the ISO3: describeGroup localizes the country name from it
  country_code_label: g.country,         // the next rung: printed if the code cannot be resolved
  primary_language_label: g.langName,    // a plain string; describeGroup reads this rung first
  imb_gsec: Number.isInteger(g.imb_gsec) ? g.imb_gsec : null,   // 0-6: the "how reached" sentence
  image_url: photos.get(g.slug) || '',
})
async function printNeighbourPacket() {
  const g = selected.value
  if (!g || !g.reached || packetBusy.value || !neighbors.value.length) return
  packetBusy.value = true
  try {
    const all = neighbors.value, members = all.slice(0, PACKET_CAP).map((x) => x.g)
    const level = nt(E_SHORT[eLevel.value])
    const label = all.length > PACKET_CAP
      ? nt('neighbor.packet.labelCapped', { group: g.name, n: PACKET_CAP, total: all.length.toLocaleString('en-US'), level })
      : nt('neighbor.packet.label', { group: g.name, level })
    const zone = { id: `neighbours-${g.pgid}-E${eLevel.value}`, label, selector: { type: 'pg_slugs', values: members.map(packetSlug) } }
    const [{ usePosterPrints }, photos] = await Promise.all([import('@map/composables/usePosterPrints.js'), doxaPhotos(members)])
    const records = members.map((m) => packetRecord(m, photos))
    const steps = (FUNNEL?.steps || []).filter((s) => s.id === 'all' || s.id === 'unreached')
    const prints = usePosterPrints({
      records: () => records,
      lang: () => String(getRuntimeLocale() || 'en').split('-')[0],
      label: (z) => z?.label || '',
      downloadPrefix: 'doxa-upg-neighbor',
    })
    await prints.printPacket(zone, { funnel: steps.length ? { steps } : { steps: [] }, variant: 'lightweight' })
  } catch (e) {
    console.warn('[upg-neighbor] packet failed:', e?.message || e)
  } finally {
    packetBusy.value = false
  }
}

function openBridge() { if (selected.value) { nbState.lang = selected.value.lang; nbState.view = 'campaigns' } }
const isBridge = computed(() => !!selected.value && !!data.value?.bridges.some((b) => b.lang === selected.value.lang))

// ─── Map ──────────────────────────────────────────────────────────────────────
const SRC_U = 'nb-u', SRC_R = 'nb-r', SRC_N = 'nb-n', SRC_L = 'nb-l', SRC_S = 'nb-s'
const fc = (features) => ({ type: 'FeatureCollection', features })
const pt = (g, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [g.lng, g.lat] }, properties: props })

function unreachedFeatures() {
  return fc(pool.value.map((u) => pt(u, { id: u.pgid, pop: u.pop })))
}
function reachedFeatures() {
  return fc((data.value?.reached || []).map((r) => pt(r, { id: r.pgid, b: r.believers })))
}
function selectionFeatures() {
  const u = selected.value
  if (!u) return { n: fc([]), l: fc([]), s: fc([]) }
  const n = [], l = []
  for (const x of neighbors.value) {
    // A reached group's neighbors are unreached: red dots, ringed in their E-level colour.
    n.push(pt(x.g, { id: x.g.pgid, e: x.e, name: x.g.name, color: u.reached ? UNREACHED : E_COLORS[x.e], ring: E_COLORS[x.e] }))
    l.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[x.g.lng, x.g.lat], [u.lng, u.lat]] }, properties: { e: x.e, color: E_COLORS[x.e] } })
  }
  return { n: fc(n), l: fc(l), s: fc([pt(u, { name: u.name, color: u.reached ? REACHED : UNREACHED })]) }
}
function setSrc(m, id, d) { const s = m.getSource(id); if (s) s.setData(d); else m.addSource(id, { type: 'geojson', data: d }) }

function ensureLayers(m) {
  setSrc(m, SRC_U, unreachedFeatures())
  setSrc(m, SRC_R, reachedFeatures())
  const sel = selectionFeatures()
  setSrc(m, SRC_L, sel.l); setSrc(m, SRC_N, sel.n); setSrc(m, SRC_S, sel.s)
  if (!m.getLayer('nb-u')) m.addLayer({ id: 'nb-u', type: 'circle', source: SRC_U, paint: {
    'circle-color': UNREACHED,
    'circle-radius': ['interpolate', ['linear'], ['ln', ['max', ['get', 'pop'], 1]], 6, 1.6, 12, 3.2, 16, 6.5, 19, 10],
    'circle-opacity': 0.55, 'circle-stroke-width': 0.4, 'circle-stroke-color': '#fff' } })
  // Green: every reached group, sized by estimated believers, drawn over the red so both are visible.
  if (!m.getLayer('nb-r')) m.addLayer({ id: 'nb-r', type: 'circle', source: SRC_R, paint: {
    'circle-color': REACHED,
    'circle-radius': ['interpolate', ['linear'], ['ln', ['max', ['get', 'b'], 1]], 4, 1.8, 10, 3.4, 14, 6, 17, 9],
    'circle-opacity': 0.6, 'circle-stroke-width': 0.4, 'circle-stroke-color': '#fff' } })
  if (!m.getLayer('nb-l')) m.addLayer({ id: 'nb-l', type: 'line', source: SRC_L, layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['match', ['get', 'e'], 1, 2.2, 2, 1.6, 1.1], 'line-opacity': 0.75 } })
  if (!m.getLayer('nb-n')) m.addLayer({ id: 'nb-n', type: 'circle', source: SRC_N, paint: {
    'circle-color': ['get', 'color'], 'circle-radius': ['match', ['get', 'e'], 1, 7, 2, 6, 5],
    'circle-stroke-width': 2, 'circle-stroke-color': ['coalesce', ['get', 'ring'], '#fff'] } })
  if (!m.getLayer('nb-a')) m.addLayer({ id: 'nb-a', type: 'circle', source: SRC_N, filter: ['==', ['get', 'id'], ''], paint: {
    'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 11, 'circle-stroke-width': 3, 'circle-stroke-color': SELECTED } })
  if (!m.getLayer('nb-s')) m.addLayer({ id: 'nb-s', type: 'circle', source: SRC_S, paint: {
    'circle-color': ['coalesce', ['get', 'color'], UNREACHED], 'circle-radius': 10, 'circle-stroke-width': 3, 'circle-stroke-color': SELECTED } })
  applyDim(m)
  applyActive()
}
function applyDim(m) {
  if (m.getLayer('nb-u')) m.setPaintProperty('nb-u', 'circle-opacity', selected.value ? 0.18 : 0.55)
  if (m.getLayer('nb-r')) m.setPaintProperty('nb-r', 'circle-opacity', selected.value ? 0.18 : 0.6)
}
let repaintPending = false
function repaint() {
  const m = map.value
  if (!m) return
  // isStyleLoaded() is also false while TILES load (MapLibre), so a data load that lands then used to
  // be dropped for good: the start view showed no dots at all (measured, upgn6). Try again once idle.
  if (!m.isStyleLoaded?.()) { if (!repaintPending) { repaintPending = true; m.once('idle', () => { repaintPending = false; repaint() }) } return }
  ensureLayers(m)
}
function frame() {
  const m = map.value, u = selected.value
  if (!m || !u) return
  const pts = [[u.lng, u.lat], ...neighbors.value.map((x) => [x.g.lng, x.g.lat])]
  const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1])
  try {
    m.stop()
    if (pts.length < 2) m.easeTo({ center: [u.lng, u.lat], zoom: 4, duration: 800 })
    else m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: framePadding(), maxZoom: 6, duration: 900 })
  } catch (_) { /* a camera call on a map mid-teardown is not worth an error */ }
}
// The panel covers part of the map: the left 400px on wide screens, the bottom 55% on a phone.
// Frame the selection in the part you can see.
// In a right-to-left locale the panel sits on the right, so the wide padding moves with it. On a phone
// the list is a bottom sheet (55% of the height, or a 56 px bar when the reader has put it down).
function framePadding() {
  const el = mapContainer.value, w = el?.clientWidth || 0, h = el?.clientHeight || 0
  const rtl = !!el && getComputedStyle(el).direction === 'rtl'
  return w > 760 ? { top: 60, bottom: 60, left: rtl ? 60 : 400, right: rtl ? 400 : 60 } : { top: 40, bottom: (nbState.sheetDown ? 56 : Math.round(h * 0.55)) + 20, left: 30, right: 30 }
}
// PHONE: the list covered 54% of the map with no way to put it down (measured at 390). A handle on the sheet
// lowers it to a bar and raises it again; the choice is shared with Campaigns.
function toggleSheet() { nbState.sheetDown = !nbState.sheetDown; nextTick(() => frame()) }

watch(() => [nbState.pgid, pFilter.value, data.value, eLevel.value], () => { repaint(); frame() })

onMounted(async () => {
  loadNearData(profileConfig).then((d) => { data.value = d; repaint(); frame() })
    .catch((e) => { loadError.value = nt('neighbor.mob.loadError', { message: String(e.message || e) }) })
  await initializeMap()
  const m = map.value
  // A shared key, so tStatic: nt() would prefix it with neighbor. and never resolve.
  if (!m) { mapError.value = tStatic('messages.mapUnavailable'); return }
  whenStyleReady(m, () => {
    setProjectionOn(m, 'mercator')
    repaint(); frame()
    // ONE click handler, topmost first: overlapping red and green dots used to fire two layer handlers
    // and the last one won. A neighbor of the current selection beats a background dot.
    m.on('click', (ev) => {
      const layers = ['nb-n', 'nb-r', 'nb-u'].filter((id) => m.getLayer(id))
      const f = layers.length ? m.queryRenderedFeatures(ev.point, { layers })[0] : null
      const id = f?.properties?.id
      if (!id) return
      if (f.layer.id === 'nb-n') {
        const n = neighbors.value.find((x) => x.g.pgid === id)
        if (n) { nbState.sheetDown = false; focusNeighbor(n, false) }
        return
      }
      const g = data.value?.groups.find((x) => x.pgid === id)
      if (g) select(g)
    })
    const byId = (id) => data.value?.groups.find((g) => g.pgid === id)
    const label = (g) => g && `${g.name} · ${g.country} · ${g.langName}`
    m.on('movestart', () => { hover.value = null })
    for (const id of ['nb-u', 'nb-r', 'nb-n']) {
      m.on('mouseenter', id, () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mousemove', id, (ev) => hoverAt(ev, label(byId(ev.features?.[0]?.properties?.id))))
      m.on('mouseleave', id, () => { m.getCanvas().style.cursor = ''; hover.value = null })
    }
  })
  // A later style reload (a theme switch) drops our layers; put them back.
  m.on('style.load', repaint)
})
onBeforeUnmount(() => destroy())

useShadowStyles(`
  .mb-root { position:absolute; inset:0; display:flex; background:#f6f7f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1f2937; }
  .mb-map { position:absolute; inset:0; }
  .mb-panel { position:absolute; top:10px; inset-inline-start:10px; bottom:10px; width:380px; z-index:20; display:flex; flex-direction:column;
    background:#fff; border:1px solid #d9dee6; border-radius:12px; box-shadow:0 6px 20px rgba(0,20,60,.12); overflow:hidden; }
  .mb-head { padding:12px 14px 10px; border-bottom:1px solid #eef0f4; }
  .mb-search { width:100%; box-sizing:border-box; border:1px solid #c9d1dd; border-radius:8px; padding:9px 11px; font:14px/1.2 inherit; }
  .mb-search:focus { outline:2px solid ${NAVY}; outline-offset:1px; }
  .mb-pchips { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
  .mb-chip { border:1px solid #c9d1dd; background:#fff; color:#374151; border-radius:999px; padding:4px 10px; font:600 12px/1 inherit; cursor:pointer; }
  .mb-chip.on { background:${NAVY}; border-color:${NAVY}; color:#fff; }
  .mb-kind { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
  .mb-kind .mb-chip { display:inline-flex; align-items:center; gap:6px; padding:6px 11px; }
  .mb-body { flex:1 1 0; overflow-y:auto; }
  .mb-row { display:flex; align-items:center; gap:10px; width:100%; text-align:start; border:0; border-bottom:1px solid #f1f3f6; background:#fff; padding:9px 14px; cursor:pointer; font:inherit; color:inherit; }
  .mb-row:hover, .mb-row:focus-visible { background:#f5f8ff; }
  .mb-row-main { flex:1 1 auto; min-width:0; }
  .mb-row-name { font:600 13px/1.25 inherit; }
  .mb-row-sub { font:12px/1.3 inherit; color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .mb-pbadge { flex:0 0 auto; font:700 11px/1 ui-monospace,monospace; border-radius:6px; padding:4px 6px; color:#fff; }
  .mb-brief { padding:12px 14px 16px; }
  .mb-back { border:0; background:none; color:${NAVY}; font:600 12px/1 inherit; cursor:pointer; padding:0 0 8px; }
  /* Arrows point the way the page reads (a plain "←" does not mirror in Arabic). */
  .mb-back::before { content:'← '; } [dir="rtl"] .mb-back::before { content:'→ '; }
  .mb-go::after { content:' →'; } [dir="rtl"] .mb-go::after { content:' ←'; }
  .mb-title { font:700 17px/1.2 inherit; margin:0; }
  .mb-sub { color:#4b5563; font-size:13px; margin:4px 0 10px; }
  .mb-p { border-radius:10px; padding:10px 12px; margin-bottom:10px; color:#0b2e1a; font-size:13px; line-height:1.4; }
  .mb-p strong { display:block; font-size:14px; margin-bottom:2px; }
  .mb-res { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px; }
  .mb-res span { font:600 11px/1 inherit; border-radius:999px; padding:4px 8px; border:1px solid #d1d5db; color:#6b7280; }
  .mb-res span.yes { border-color:#9fd3b0; color:#0b5e33; background:#eaf7ef; }
  .mb-actions { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .mb-modal { position:absolute; inset:0; z-index:40; background:rgba(0,20,50,.45); display:flex; align-items:center; justify-content:center; padding:16px; }
  .mb-letter { background:#fff; border-radius:12px; width:min(680px,100%); max-height:100%; display:flex; flex-direction:column; gap:10px; padding:16px 18px; box-shadow:0 12px 32px rgba(0,20,60,.25); }
  .mb-letter h2 { margin:0; font:700 16px/1.25 inherit; }
  .mb-letter textarea { flex:1 1 auto; min-height:260px; width:100%; box-sizing:border-box; border:1px solid #c9d1dd; border-radius:8px; padding:10px 12px; font:13px/1.55 inherit; color:inherit; resize:vertical; }
  .mb-letter textarea:focus { outline:2px solid ${NAVY}; outline-offset:1px; }
  .mb-letter .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .mb-letter .status { font-size:12px; color:#0b5e33; margin-inline-start:auto; }
  .mb-btn { border:1px solid ${NAVY}; background:${NAVY}; color:#fff; border-radius:8px; padding:8px 11px; font:600 12px/1 inherit; cursor:pointer; }
  .mb-btn.ghost { background:#fff; color:${NAVY}; }
  .mb-level { margin-top:12px; }
  .mb-level h3 { display:flex; align-items:center; gap:8px; font:700 13px/1.2 inherit; margin:0 0 4px; }
  .mb-level p { margin:0 0 6px; color:#6b7280; font-size:12px; line-height:1.35; }
  .mb-dot { width:11px; height:11px; border-radius:50%; flex:0 0 auto; }
  .mb-card { border:1px solid #e5e7eb; border-radius:8px; padding:8px 10px; margin-bottom:6px; font-size:12px; line-height:1.35; }
  .mb-card { cursor:pointer; }
  .mb-card:hover, .mb-card:focus-visible { border-color:#9fb3d9; }
  .mb-card.on { border-color:${SELECTED}; box-shadow:0 0 0 2px ${SELECTED}55; }
  .mb-card b { font-size:13px; }
  .mb-card .muted { color:#6b7280; }
  .mb-card-main { display:block; width:100%; text-align:start; border:0; background:none; padding:0; font:inherit; color:inherit; cursor:pointer; }
  .mb-card-main:focus-visible { outline:2px solid ${NAVY}; outline-offset:2px; border-radius:4px; }
  .mb-pivot { margin-top:6px; min-height:28px; border:1px solid ${NAVY}; background:#fff; color:${NAVY}; border-radius:6px; padding:4px 10px; font:600 12px/1 inherit; cursor:pointer; }
  .mb-pivot:hover, .mb-pivot:focus-visible { background:${NAVY}; color:#fff; }
  .mb-same { font:700 10px/1 inherit; color:#7a3e00; background:#fdeedd; border-radius:999px; padding:3px 6px; margin-inline-start:4px; }
  .mb-note { padding:14px; color:#6b7280; font-size:13px; line-height:1.45; }
  .mb-maperr { position:absolute; inset-inline-end:12px; top:12px; z-index:15; background:#fff; border:1px solid #d9dee6; border-radius:8px; padding:8px 12px; font-size:13px; color:#6b7280; }
  .mb-hover { position:absolute; z-index:25; pointer-events:none; background:rgba(0,27,68,.92); color:#fff; font-size:12px; line-height:1.3; padding:5px 8px; border-radius:6px; max-width:min(260px, 45%); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .mb-handle { display:none; align-items:center; justify-content:center; gap:8px; width:100%; min-height:40px; border:0; border-bottom:1px solid #eef0f4;
    background:#fff; color:${NAVY}; font:600 12px/1 inherit; cursor:pointer; flex:0 0 auto; }
  .mb-handle::before { content:''; width:36px; height:4px; border-radius:2px; background:#c9d1dd; }
  .mb-handle:focus-visible { outline:2px solid ${NAVY}; outline-offset:-2px; }
  .mb-legend { position:absolute; inset-inline-end:12px; bottom:28px; z-index:15; background:rgba(255,255,255,.95); border:1px solid #d9dee6; border-radius:10px; padding:8px 10px; font-size:12px; }
  .mb-legend div { display:flex; align-items:center; gap:7px; padding:2px 0; }
  @media (max-width:760px) {
    .mb-panel { top:auto; inset-inline:6px; bottom:6px; width:auto; height:55%; }
    .mb-panel.down { height:56px; }
    .mb-panel.down > :not(.mb-handle) { display:none; }
    .mb-handle { display:flex; }
    .mb-legend { top:8px; bottom:auto; inset-inline-end:8px; }
    /* The map's own bottom controls (the attribution) sit ABOVE the sheet, never under it:
       55% of the height when the sheet is up, a 56 px bar when it is down, both 6 px off the bottom. */
    .mb-root .maplibregl-ctrl-bottom-left, .mb-root .maplibregl-ctrl-bottom-right,
    .mb-root .mapboxgl-ctrl-bottom-left, .mb-root .mapboxgl-ctrl-bottom-right { bottom:calc(55% + 6px); }
    .mb-root.sheet-down .maplibregl-ctrl-bottom-left, .mb-root.sheet-down .maplibregl-ctrl-bottom-right,
    .mb-root.sheet-down .mapboxgl-ctrl-bottom-left, .mb-root.sheet-down .mapboxgl-ctrl-bottom-right { bottom:62px; }
  }
`, 'upgn-mobilize')
</script>

<template>
  <div class="mb-root" :class="{ 'sheet-down': nbState.sheetDown }">
    <div ref="mapContainer" class="mb-map"></div>
    <div v-if="mapError" class="mb-maperr" role="status">{{ mapError }}</div>
    <div v-if="hover" class="mb-hover" :style="hoverStyle">{{ hover.text }}</div>

    <div class="mb-legend" :aria-label="$t('neighbor.mob.legend')">
      <div><span class="mb-dot" :style="{ background: UNREACHED }"></span>{{ $t('neighbor.mob.legendUnreached') }}</div>
      <div><span class="mb-dot" :style="{ background: REACHED }"></span>{{ $t('neighbor.mob.legendReached') }}</div>
      <div v-for="e in [1, 2, 3]" :key="e"><span class="mb-dot" :style="{ background: E_COLORS[e] }"></span>{{ $t(E_SHORT[e]) }}</div>
    </div>

    <aside class="mb-panel" :class="{ down: nbState.sheetDown }">
      <button type="button" class="mb-handle" :aria-expanded="nbState.sheetDown ? 'false' : 'true'" @click="toggleSheet">{{ nbState.sheetDown ? $t('neighbor.mob.sheetShow') : $t('neighbor.mob.sheetHide') }}</button>
      <template v-if="!selected">
        <div class="mb-head">
          <div class="mb-kind" role="group" :aria-label="$t('neighbor.mob.kind')">
            <button type="button" class="mb-chip" :class="{ on: kind === 'unreached' }" :aria-pressed="kind === 'unreached' ? 'true' : 'false'" @click="kind = 'unreached'">
              <span class="mb-dot" :style="{ background: UNREACHED }"></span>{{ $t('neighbor.mob.listUnreached') }}</button>
            <button type="button" class="mb-chip" :class="{ on: kind === 'reached' }" :aria-pressed="kind === 'reached' ? 'true' : 'false'" @click="kind = 'reached'">
              <span class="mb-dot" :style="{ background: REACHED }"></span>{{ $t('neighbor.mob.listReached') }}</button>
          </div>
          <input v-model="query" class="mb-search" type="search"
                 :placeholder="kind === 'reached' ? $t('neighbor.mob.searchReached') : $t('neighbor.mob.searchPlaceholder')"
                 :aria-label="kind === 'reached' ? $t('neighbor.mob.searchReached') : $t('neighbor.mob.searchPlaceholder')" />
          <div v-if="kind === 'unreached'" class="mb-pchips" role="group" :aria-label="$t('neighbor.mob.pFilter')">
            <button class="mb-chip" :class="{ on: pFilter === 0 }" @click="pFilter = 0">{{ $t('neighbor.mob.pAll') }}</button>
            <button v-for="p in [1, 2, 3]" :key="p" class="mb-chip" :class="{ on: pFilter === p }" :title="$t(P_LONG[p])"
                    @click="pFilter = p">P-{{ p }} · {{ (pCounts[p] || 0).toLocaleString('en-US') }}</button>
          </div>
        </div>
        <div class="mb-body">
          <div v-if="loadError" class="mb-note" role="alert">{{ loadError }}</div>
          <div v-else-if="!data" class="mb-note">{{ $t('neighbor.mob.loading') }}</div>
          <template v-else>
            <div v-if="!query" class="mb-note" style="padding-bottom:6px">{{ kind === 'reached' ? $t('neighbor.mob.introReached') : $t('neighbor.mob.introBoth') }}</div>
            <button v-for="u in results" :key="u.pgid" class="mb-row" @click="select(u)">
              <span v-if="u.reached" class="mb-pbadge" :style="{ background: REACHED }" aria-hidden="true">✓</span>
              <span v-else class="mb-pbadge" :style="{ background: E_COLORS[u.p] || '#9aa7b4' }">P-{{ u.p || '–' }}</span>
              <span class="mb-row-main">
                <span class="mb-row-name">{{ u.name }}</span>
                <span v-if="u.reached" class="mb-row-sub" style="display:block">{{ u.country }} · {{ u.langName }} · {{ $t('neighbor.camp.believers', { n: fmtNum(u.believers) }) }}</span>
                <span v-else class="mb-row-sub" style="display:block">{{ u.country }} · {{ u.langName }} · {{ fmtNum(u.pop) }}</span>
              </span>
            </button>
            <div v-if="!results.length" class="mb-note">{{ $t('neighbor.mob.noMatch') }}</div>
          </template>
        </div>
      </template>

      <div v-else class="mb-body">
        <div class="mb-brief">
          <button class="mb-back" @click="clearSelection">{{ $t('neighbor.mob.back') }}</button>
          <h2 class="mb-title">{{ selected.name }}</h2>
          <div class="mb-sub">{{ selected.country }} · {{ selected.langName }} · {{ $t('neighbor.mob.people', { n: fmtNum(selected.pop) }) }} · {{ selected.religion }}</div>

          <div v-if="isReachedSel" class="mb-p" :style="{ background: REACHED + '22' }">
            <strong>{{ $t('neighbor.mob.reachedTitle') }}</strong>
            {{ $t('neighbor.mob.reachedLong', { n: fmtNum(selected.believers) }) }}
            <div style="margin-top:4px">{{ $t('neighbor.mob.reachCount', { n: neighbors.length.toLocaleString('en-US'), p: fmtNum(peopleReachable) }) }}</div>
          </div>
          <!-- ONE E-level at a time, E-1 first: the letter goes to the nearest culture before the farther ones. -->
          <div v-if="isReachedSel" class="mb-pchips" role="group" :aria-label="$t('neighbor.mob.eFilter')">
            <button v-for="e in [1, 2, 3]" :key="e" type="button" class="mb-chip" :class="{ on: eLevel === e }"
                    :aria-pressed="eLevel === e ? 'true' : 'false'" :disabled="!levelCounts[e]" :title="$t(E_RLONG[e])"
                    @click="eLevel = e">{{ $t(E_SHORT[e]) }} · {{ levelCounts[e].toLocaleString('en-US') }}</button>
          </div>
          <div v-else class="mb-p" :style="{ background: (E_COLORS[selected.p] || '#9aa7b4') + '22' }">
            <strong><template v-if="selected.p">P-{{ selected.p }} · </template>{{ $t(P_TITLE[selected.p]) }}</strong>
            {{ $t(P_LONG[selected.p]) }}
            <div style="margin-top:4px">{{ $t('neighbor.mob.believersNear', { n: fmtNum(believersNear) }) }}</div>
          </div>

          <div class="mb-res" :aria-label="$t('neighbor.mob.resources')">
            <span :class="{ yes: selected.bible }">{{ $t('neighbor.res.bible') }}</span>
            <span :class="{ yes: selected.film }">{{ $t('neighbor.res.film') }}</span>
            <span :class="{ yes: selected.audio }">{{ $t('neighbor.res.audio') }}</span>
            <span :class="{ yes: selected.radio }">{{ $t('neighbor.res.radio') }}</span>
          </div>

          <div class="mb-actions">
            <button v-if="isReachedSel && neighbors.length" ref="letterBtn" class="mb-btn" @click="openLetter">{{ $t('neighbor.letter.button') }}</button>
            <button v-if="isReachedSel && neighbors.length" type="button" class="mb-btn ghost" :disabled="packetBusy" :aria-busy="packetBusy ? 'true' : 'false'" @click="printNeighbourPacket">{{ $t('neighbor.packet.button') }}</button>
            <button class="mb-btn" :class="{ ghost: isReachedSel && neighbors.length }" @click="exportSegments">{{ $t('neighbor.mob.export') }}</button>
            <button v-if="isBridge" class="mb-btn ghost" @click="openBridge">{{ $t('neighbor.mob.openBridge', { lang: selected.langName }) }}</button>
          </div>

          <section v-for="lv in byLevel" :key="lv.e" class="mb-level">
            <h3><span class="mb-dot" :style="{ background: E_COLORS[lv.e] }"></span>{{ $t(E_TITLE[lv.e]) }}</h3>
            <p>{{ $t(isReachedSel ? E_RLONG[lv.e] : E_LONG[lv.e]) }}</p>
            <!-- A card: the first button shows it on the map; once it is the one in focus, a second button
                 makes it the selection, so you can walk from neighbor to neighbor in either direction. -->
            <div v-for="n in (expanded.has(lv.e) ? lv.list : lv.list.slice(0, CARD_CAP))" :key="n.g.pgid" class="mb-card" :class="{ on: activeId === n.g.pgid }" :data-nb="n.g.pgid">
              <button type="button" class="mb-card-main" @click="focusNeighbor(n)">
                <b>{{ n.g.name }}</b><span v-if="n.same" class="mb-same">{{ $t('neighbor.mob.samePeople') }}</span><br>
                {{ n.g.country }} · {{ n.g.langName }}<br>
                <span v-if="isReachedSel" class="muted">P-{{ n.g.p || '–' }} · {{ $t('neighbor.mob.cardStatsU', { p: fmtNum(n.g.pop), km: n.km.toLocaleString('en-US') }) }}</span>
                <span v-else class="muted">{{ $t('neighbor.mob.cardStats', { b: fmtNum(n.g.believers), km: n.km.toLocaleString('en-US') }) }}</span>
              </button>
              <button v-if="activeId === n.g.pgid" type="button" class="mb-pivot mb-go" @click="select(n.g)">{{ $t('neighbor.mob.showNeighbors') }}</button>
            </div>
            <button v-if="!expanded.has(lv.e) && lv.list.length > CARD_CAP" type="button" class="mb-pivot" @click="expand(lv.e)">{{ $t('neighbor.mob.showAll', { n: lv.list.length.toLocaleString('en-US') }) }}</button>
          </section>
          <div v-if="!byLevel.length" class="mb-note">{{ $t(isReachedSel ? 'neighbor.mob.noUnreachedNeighbors' : 'neighbor.mob.noNeighbors') }}</div>
          <p class="mb-note" style="padding:12px 0 0">{{ $t('neighbor.mob.caveat') }}</p>
        </div>
      </div>
    </aside>

    <div v-if="letterOpen && selected" class="mb-modal" @click.self="closeLetter">
      <div ref="letterBox" class="mb-letter" role="dialog" aria-modal="true" :aria-label="$t('neighbor.letter.title', { group: selected.name })" @keydown="onLetterKey">
        <h2>{{ $t('neighbor.letter.title', { group: selected.name }) }}</h2>
        <textarea v-model="letterText" dir="auto" :aria-label="$t('neighbor.letter.title', { group: selected.name })"></textarea>
        <div class="row">
          <button type="button" class="mb-btn" @click="copyLetter">{{ $t('neighbor.letter.copy') }}</button>
          <button type="button" class="mb-btn ghost" @click="downloadLetter">{{ $t('neighbor.letter.download') }}</button>
          <button type="button" class="mb-btn ghost" @click="closeLetter">{{ $t('neighbor.about.close') }}</button>
          <span class="status" role="status">{{ letterStatus }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
