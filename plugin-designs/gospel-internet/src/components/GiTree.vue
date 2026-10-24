<script setup>
// What this instance put on window, recorded AS IT IS SET so unmount can tell its own values
// from another instance's. Two of these can share a page; clearing by NAME alone would let the
// second unmount delete the first's live hooks.
const ownGlobals = Object.create(null)
function setGlobal(name, value) {
  try { window[name] = value; ownGlobals[name] = value } catch (_) {}
}
/**
 * GiTree.vue — the LANGUAGE TREE, on a whiteboard: every family our people groups belong to, as a radial
 * tree (family -> branches -> languages -> dialects), the families packed like cells in a dish.
 *
 * WHY THE MAP ENGINE AND NOT D3/SVG (2026-09-27: snappy, lightweight, lower definition when
 * zoomed out"): the same MapLibre / Mapbox the board already loads draws the tree on the GPU. It tiles the
 * GeoJSON per zoom level, so zoomed out it draws LESS; its label placement never lets two labels overlap
 * and shows them in priority order as you zoom (families, then languages, then branches, then dialects).
 * SVG keeps every circle and label in the page at every zoom, which is what makes a big D3 tree slow.
 * The layout is computed at BUILD time (scripts/build-language-tree.mjs), so the device does none.
 *
 * COLOURS follow gospel-access, per language: green = a New Testament or full Bible found; yellow =
 * something found but no New Testament; red = nothing found. A family or branch shows the WORST colour of
 * the in-scope languages below it. A dialect carries its language's colour, lighter: no source catalogues
 * resources by dialect.
 *
 * THE KIT'S CHANNELS: clicking a node NARROWS the board to it (the language facet, multi-value, through
 * the bus's one predicate); a hovered grid row points at its language's node (hover never moves the
 * camera); a committed selection frames its languages once, and jumps under reduced motion.
 */
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, markRaw, inject } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { labelFont } from '@map/maps/label-font.js'
import MapToolbar from '@map/components/map-controls/MapToolbar.vue'
import ZoomInButton from '@map/components/map-controls/ZoomInButton.vue'
import ZoomOutButton from '@map/components/map-controls/ZoomOutButton.vue'
import HelpButton from '@map/components/map-controls/HelpButton.vue'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { createWhiteboardMap, reducedMotion } from '@map/maps/whiteboard-map.js'
import { treeScope, TREE_COLOR } from '../model.js'
import { buildTreePoster, posterPrintHtml } from '../treePoster.js'
import { printDocument } from '@map/composables/printInPlace.js'
import { tStatic } from '@map/i18n/index.js'
import { listLabel } from '@map/lists/peopleGroupList.js'

const T = useGiT()
const board = useBoardState()
const { bus } = board
const injectedToken = inject('mapboxToken', null)   // tokenUrl / shared page token, via ProfileLoader

const el = ref(null)
const mapRef = shallowRef(null)
const err = ref('')
const ready = ref(false)
const hoverId = ref('')
// Legends start collapsed, one tap on "Legend" opens them; the embed knob legend:"open" opens them
const legendOpen = ref(board.profileConfig.value?.legend === 'open')
let unmounted = false
let ro = null

const ix = computed(() => board.tree.value)
const scope = computed(() => ix.value ? treeScope(ix.value, board.filtered.value) : null)
const fmt = (n) => (Number(n) || 0).toLocaleString()

// ── GeoJSON from the tree + the scope ──────────────────────────────────────────────────────────────
const LEVEL_NAME = computed(() => ({
  f: T('gospelInternet.tree.family', 'Family'), b: T('gospelInternet.tree.branch', 'Branch'),
  l: T('gospelInternet.tree.language', 'Language'), d: T('gospelInternet.tree.dialect', 'Dialect'),
}))
function nodeFC() {
  const t = ix.value, sc = scope.value
  return { type: 'FeatureCollection', features: t.nodes.map((n) => {
    const s = sc.get(n.id)
    return { type: 'Feature', geometry: { type: 'Point', coordinates: n.c },
      properties: { id: n.id, n: n.n, lv: n.lv, col: s.col || 'none', inh: n.inh ? 1 : 0, m: s.m, R: n.R || 0,
        root: n.p ? 0 : 1,
        // label priority: families first, then languages with the most groups (lower sorts first)
        k: (n.lv === 'f' || !n.p ? 0 : n.lv === 'l' ? 1000 : n.lv === 'b' ? 2000 : 3000) - Math.min(999, s.groups) } }
  }) }
}
function linkFC() {
  const t = ix.value, sc = scope.value
  const feats = []
  for (const n of t.nodes) {
    if (!n.p) continue
    const p = t.byId.get(n.p)
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [p.c, n.c] }, properties: { m: sc.get(n.id).m, d: n.lv === 'd' ? 1 : 0 } })
  }
  return { type: 'FeatureCollection', features: feats }
}

// A circle radius given in whiteboard units (fraction of the Web Mercator square) grows 2x per zoom
// level: a top-level exponential interpolate with a data-driven stop value is valid on both engines.
const dishRadius = ['interpolate', ['exponential', 2], ['zoom'], 0, ['*', ['get', 'R'], 512], 22, ['*', ['get', 'R'], 512 * 2 ** 22]]
const colorExpr = ['match', ['get', 'col'], 'g', TREE_COLOR.g, 'y', TREE_COLOR.y, 'r', TREE_COLOR.r, '#9aa2ad']
// Zoom stops are in the tree's own scale (build-language-tree.mjs K): the drawing is half the size it
// was, so every threshold sits one level higher than before and the opening view looks the same.
const nodeRadius = ['interpolate', ['linear'], ['zoom'],
  0, ['match', ['get', 'lv'], 'f', 3, 'l', 1, 'b', 0.6, 0.5],
  1, ['match', ['get', 'lv'], 'f', 4, 'l', 1.6, 'b', 0.9, 0.7],
  5, ['match', ['get', 'lv'], 'f', 9, 'l', 4.5, 'b', 2.4, 1.8],
  9, ['match', ['get', 'lv'], 'f', 14, 'l', 8, 'b', 4, 3.5]]
const nodeRadiusPlus = (k) => ['interpolate', ['linear'], ['zoom'],
  0, ['+', k, ['match', ['get', 'lv'], 'f', 3, 'l', 1, 'b', 0.6, 0.5]],
  1, ['+', k, ['match', ['get', 'lv'], 'f', 4, 'l', 1.6, 'b', 0.9, 0.7]],
  5, ['+', k, ['match', ['get', 'lv'], 'f', 9, 'l', 4.5, 'b', 2.4, 1.8]],
  9, ['+', k, ['match', ['get', 'lv'], 'f', 14, 'l', 8, 'b', 4, 3.5]]]

function addLayers(map) {
  map.addSource('gt-nodes', { type: 'geojson', data: nodeFC(), promoteId: 'id' })
  map.addSource('gt-links', { type: 'geojson', data: linkFC() })
  // the dish around each family
  map.addLayer({ id: 'gt-dish', type: 'circle', source: 'gt-nodes', filter: ['==', ['get', 'root'], 1], paint: {
    'circle-radius': dishRadius, 'circle-color': '#ffffff', 'circle-opacity': 0.55,
    'circle-stroke-color': '#d1d4cd', 'circle-stroke-width': 1, 'circle-pitch-alignment': 'map',
  } })
  map.addLayer({ id: 'gt-links', type: 'line', source: 'gt-links', paint: {
    'line-color': '#8d968e', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.3, 7, 1],
    'line-opacity': ['case', ['==', ['get', 'm'], 1], ['case', ['==', ['get', 'd'], 1], 0.35, 0.6], 0.12],
  } })
  map.addLayer({ id: 'gt-nodes', type: 'circle', source: 'gt-nodes', paint: {
    'circle-radius': nodeRadius,
    'circle-color': colorExpr,
    // a dialect's colour is its language's, so it is drawn lighter; out of scope fades, never vanishes
    'circle-opacity': ['case', ['==', ['get', 'm'], 0], 0.15, ['==', ['get', 'inh'], 1], 0.5, 0.95],
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['match', ['get', 'lv'], 'f', 1.5, 0.6],
  }, layout: { 'circle-sort-key': ['-', 0, ['get', 'k']] } })
  map.addLayer({ id: 'gt-sel', type: 'circle', source: 'gt-nodes', filter: ['==', ['get', 'id'], ''], paint: {
    'circle-radius': nodeRadiusPlus(4), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#3b463d', 'circle-stroke-width': 2.5,
  } })
  map.addLayer({ id: 'gt-hover', type: 'circle', source: 'gt-nodes', filter: ['==', ['get', 'id'], ''], paint: {
    'circle-radius': nodeRadiusPlus(3), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#e8a33d', 'circle-stroke-width': 2.5,
  } })
  // labels, one layer per level so each level has its own entry zoom; placement never overlaps labels
  const LABELS = [
    { lv: ['f'], min: 0, size: [0, 10, 1, 11, 6, 15], weight: 'bold', offset: 1.1 },
    { lv: ['l'], min: 3.6, size: [3.6, 10, 8, 13], weight: 'regular', offset: 0.8 },
    { lv: ['b'], min: 4.4, size: [4.4, 9, 8, 11], weight: 'regular', offset: 0.7, muted: true },
    { lv: ['d'], min: 5.6, size: [5.6, 9, 9, 11], weight: 'regular', offset: 0.7, muted: true },
  ]
  for (const L of LABELS) {
    map.addLayer({ id: 'gt-lab-' + L.lv[0], type: 'symbol', source: 'gt-nodes', minzoom: L.min,
      filter: L.lv[0] === 'f' ? ['==', ['get', 'root'], 1] : ['all', ['==', ['get', 'root'], 0], ['==', ['get', 'lv'], L.lv[0]]],
      layout: {
        'text-field': ['get', 'n'], 'text-size': ['interpolate', ['linear'], ['zoom'], ...L.size],
        'text-anchor': 'top', 'text-offset': [0, L.offset], 'text-max-width': 9, 'symbol-sort-key': ['get', 'k'],
        ...labelFont(map, { weight: L.weight, mapbox: L.weight === 'bold' ? ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'] : ['DIN Offc Pro Regular', 'Arial Unicode MS Regular'] }),
      },
      paint: {
        'text-color': L.muted ? '#6d766e' : '#3b463d', 'text-halo-color': '#f3f3f1', 'text-halo-width': 1.4,
        'text-opacity': ['case', ['==', ['get', 'm'], 0], 0.35, 1],
      } })
  }
  map.on('click', 'gt-nodes', (e) => {
    const f = e.features && e.features[0]
    if (!f) return
    const id = f.properties.id
    board.setTreeNode(board.treeNode.value === id ? '' : id)
  })
  map.on('mousemove', 'gt-nodes', (e) => {
    map.getCanvas().style.cursor = 'pointer'
    const f = e.features && e.features[0]
    hoverId.value = f ? f.properties.id : ''
  })
  map.on('mouseleave', 'gt-nodes', () => { map.getCanvas().style.cursor = ''; hoverId.value = '' })
}

// ── scope, selection, hover -> the whiteboard ────────────────────────────────────────────────────────
function repaint() {
  const map = mapRef.value
  if (!map || !ready.value) return
  try { map.getSource('gt-nodes').setData(nodeFC()); map.getSource('gt-links').setData(linkFC()) } catch (_) {}
}
watch(scope, repaint)
watch(() => board.treeNode.value, (id) => {
  const map = mapRef.value
  if (!map || !ready.value) return
  map.setFilter('gt-sel', ['==', ['get', 'id'], id || ''])
  if (id) frame(subtreeCoords(id))
})
// the pointer on a grid row (a GROUP) points at that group's language here; never a camera move
const hoverNode = computed(() => {
  if (hoverId.value) return hoverId.value
  const slug = bus.hoverKey.value
  const row = slug && board.bySlug.value.get(slug)
  return (row && ix.value && ix.value.nodeOfIso.get(row.iso639_3)) || ''
})
watch(hoverNode, (id) => { const map = mapRef.value; if (map && ready.value) map.setFilter('gt-hover', ['==', ['get', 'id'], id || '']) })
// a committed selection frames its groups' languages, once (glue to useSelectionCamera's contract)
let camTimer = null
watch(() => bus.selectionVersion.value, () => {
  if (camTimer) clearTimeout(camTimer)
  camTimer = setTimeout(() => {
    camTimer = null
    if (!ix.value || !bus.selectionSet.size) return
    const coords = []
    for (const s of bus.selectionSet) {
      const r = board.bySlug.value.get(s)
      const id = r && ix.value.nodeOfIso.get(r.iso639_3)
      if (id) coords.push(ix.value.byId.get(id).c)
    }
    frame(coords)
  }, 150)
})

function subtreeCoords(id) {
  const t = ix.value, out = []
  const walk = (k) => { out.push(t.byId.get(k).c); for (const c of t.kids.get(k) || []) walk(c) }
  walk(id)
  return out
}
function frame(coords) {
  const map = mapRef.value
  if (!map || !coords.length) return
  let w = 180, s = 90, e = -180, n = -90
  for (const [x, y] of coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y) }
  const duration = reducedMotion() ? 0 : 900
  try {
    if (e - w < 1e-4 && n - s < 1e-4) {
      const z = Math.max(map.getZoom(), 6)
      duration ? map.easeTo({ center: [w, s], zoom: z, duration, essential: true }) : map.jumpTo({ center: [w, s], zoom: z })
    } else map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 8, duration, essential: true })
  } catch (_) { /* a degenerate frame never breaks the board */ }
}

// ── mount (only when the tree is shown: the tree data loads on first use) ────────────────────────────
async function build() {
  const t = await board.loadTree()
  if (unmounted || !el.value || mapRef.value) return
  const made = await createWhiteboardMap(el.value, board.profileConfig.value, { whiteboard: true, boundaries: false, center: [0, 0], zoom: 1, token: injectedToken?.value || '' })
  if (made.error) { err.value = T('messages.engineMissing', `The ${made.error} map engine did not load.`, { engine: made.error }); return }
  if (unmounted) { try { made.map.remove() } catch (_) {} return }
  const map = made.map
  mapRef.value = markRaw(map)
  addLayers(map)
  ready.value = true
  // frame the whole tapestry once, instantly (an opening view is not a motion the reader asked for)
  const all = t.nodes.filter((n) => !n.p).flatMap((n) => {
    const R = (n.R || 0) * 360
    return [[n.c[0] - R, n.c[1]], [n.c[0] + R, n.c[1]]]
  })
  let w = 180, e = -180
  for (const [x] of all) { w = Math.min(w, x); e = Math.max(e, x) }
  const lat = Math.min(80, (e - w) / 2)
  try { map.fitBounds([[w, -lat], [e, lat]], { padding: 20, duration: 0 }) } catch (_) {}
  if (board.treeNode.value) { map.setFilter('gt-sel', ['==', ['get', 'id'], board.treeNode.value]); frame(subtreeCoords(board.treeNode.value)) }
  try {
    setGlobal('__giTree', map)
    setGlobal('__giTreeState', () => ({ provider: made.provider, nodes: t.nodes.length,
      renderedNodes: map.queryRenderedFeatures({ layers: ['gt-nodes'] }).length,
      renderedLabels: map.queryRenderedFeatures({ layers: ['gt-lab-f', 'gt-lab-l', 'gt-lab-b', 'gt-lab-d'] }).length,
      treeNode: board.treeNode.value }))
  } catch (_) {}
}
onMounted(() => {
  if (el.value && typeof ResizeObserver !== 'undefined') {
    // the engines only follow WINDOW resizes; a dragged rail or an un-hidden panel must resize the canvas
    ro = new ResizeObserver(() => { try { mapRef.value && mapRef.value.resize() } catch (_) {} })
    ro.observe(el.value)
  }
  build().catch((e) => { err.value = String(e && e.message || e) })
})
onBeforeUnmount(() => {
  // ★ RELEASE THE TEST HOOKS. Each pins whatever it closes over — a map instance pins its
  // canvas, its sources, and through them the whole app — so every mount that leaves one behind
  // leaks another copy, measured at roughly 10 MB each.
  // Released as a SET, not just the obvious one: a block that sets several and clears one leaks
  // the rest silently, and the named one is the one you remember. One delete per line, so the
  // released set is readable and greppable.
  // Identity-checked: only this instance's own value is cleared, so a second instance sharing the
  // page does not delete the first's live hooks on its way out.
  try { if (window.__giTree === ownGlobals.__giTree) delete window.__giTree } catch (_) {}
  try { if (window.__giTreeState === ownGlobals.__giTreeState) delete window.__giTreeState } catch (_) {}
  unmounted = true
  if (camTimer) clearTimeout(camTimer)
  try { ro && ro.disconnect() } catch (_) {}
  try { mapRef.value && mapRef.value.remove() } catch (_) {}
})

// ── the info card: the hovered node, else the selected one ─────────────────────────────────────────
const card = computed(() => {
  const id = hoverNode.value || board.treeNode.value
  if (!id || !ix.value || !scope.value) return null
  const n = ix.value.byId.get(id), s = scope.value.get(id)
  if (!n || !s) return null
  return { n, s, level: LEVEL_NAME.value[n.lv] || '', selected: id === board.treeNode.value }
})
const totals = computed(() => {
  if (!scope.value || !ix.value) return null
  const t = { g: 0, y: 0, r: 0 }
  for (const n of ix.value.nodes) if (!n.p) { const s = scope.value.get(n.id); t.g += s.g; t.y += s.y; t.r += s.r }
  return t
})
// ── the poster: the current selection, as one vector sheet with no overlapping labels ───────────────
const posterSize = ref(36)
const posterNote = ref('')
function makePoster() {
  const t = ix.value
  if (!t || !scope.value) return null
  const size = posterSize.value
  const list = listLabel(board.listId.value, (k) => T(k, '')) || ''
  const { svg, stats } = buildTreePoster(t, scope.value, {
    sizeIn: size,
    title: T('gospelInternet.tree.posterTitle', 'Gospel access, language family by language family'),
    subtitle: [list, T('gospelInternet.tree.legendTitle', 'In their own language')].filter(Boolean).join(' · '),
    legend: ['g', 'y', 'r'].map((s) => ({ col: TREE_COLOR[s], text: T('gospelInternet.tree.st.' + s, ST_EN[s]) })),
    footer: [T('gospelInternet.tree.sources', 'Tree: Glottolog (CC BY 4.0). Resources: eBible, Faith Comes By Hearing, Scripture Earth, PNG.Bible, JESUS Film, Global Recordings and others, keyed by ISO 639-3.'), citation.value].filter(Boolean),
    omittedText: (n) => T('gospelInternet.tree.posterOmitted', '{n} names left off where they would overlap another; every circle is drawn.', { n: fmt(n) }),
  })
  posterNote.value = stats.omitted ? T('gospelInternet.tree.posterOmitted', '{n} names left off where they would overlap another; every circle is drawn.', { n: fmt(stats.omitted) }) : ''
  return { svg, size }
}
function printPoster() {
  const p = makePoster()
  // printDocument: the in-place frame on desktop, the page itself on a phone (printInPlace.js says why).
  if (p) printDocument(posterPrintHtml(p.svg, p.size, T('gospelInternet.tree.posterTitle', 'Gospel access, language family by language family')),
    { labels: { print: tStatic('wall.hud.printNow') || 'Print', close: tStatic('buttons.close') || 'Close' } })
}
// ★ NO DOWNLOAD BUTTON HERE. This used to write gospel-language-tree-<size>in.svg to disk beside the
// Print button. A poster action opens the PRINT DIALOG and never downloads a file, and there was no
// case for an exception here: printPoster above builds the same poster from the same
// makePoster(), so the download was a second route to one artefact rather than a capability only it
// could offer. A reader who needs a file prints to PDF — the system's own dialog, not a silent write.
// check:poster-action-print (regions) uses this file as its poison case, so a download added here
// again fails the gate rather than shipping quietly.

const ST_EN = { g: 'New Testament or full Bible found', y: 'Something found, but no New Testament', r: 'Nothing found' }
const citation = computed(() => (ix.value && ix.value.meta && ix.value.meta.citation) || '')

useShadowStyles(
  '.gtr{position:relative;width:100%;height:100%;overflow:hidden;background:#f3f3f1}' +
  '.gtr-map{position:absolute;inset:0}' +
  '.gtr-msg{position:absolute;top:45%;left:0;right:0;text-align:center;font-size:13px;color:#6d766e}' +
  '.gtr-card,.gtr-legend{position:absolute;z-index:4;background:rgba(255,255,255,.96);color:#3b463d;border:1px solid #d1d4cd;' +
  'border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.10);font:12px/1.4 Roboto,-apple-system,"Segoe UI",sans-serif}' +
  '.gtr-card{inset-block-start:10px;inset-inline-start:10px;padding:8px 10px;max-width:min(300px,calc(100% - 64px))}' +
  '.gtr-card h4{margin:0 0 2px;font-size:13.5px}' +
  '.gtr-lvl{font-size:11px;color:#6d766e;margin-bottom:5px}' +
  '.gtr-counts{display:flex;gap:10px;flex-wrap:wrap;font-variant-numeric:tabular-nums}' +
  '.gtr-c{display:inline-flex;align-items:center;gap:4px}' +
  '.gtr-dot{width:10px;height:10px;border-radius:50%;flex:none}' +
  '.gtr-via{font-size:11px;color:#6d766e;margin-top:4px}' +
  '.gtr-card button{margin-top:6px;border:1px solid #d1d4cd;background:#fff;color:#3b463d;border-radius:6px;min-height:26px;padding:2px 10px;font:inherit;cursor:pointer}' +
  '.gtr-legend{inset-block-end:10px;inset-inline-start:10px;padding:8px 10px;max-width:min(360px,calc(100% - 64px))}' +
  '.gtr-lh{display:flex;align-items:center;font-weight:700;margin-bottom:4px}' +
  '.gtr-lh button{margin-inline-start:auto;border:0;background:none;color:#6d766e;cursor:pointer;font:inherit;display:inline-grid;place-items:center;width:28px;height:28px;padding:0;flex:none}' +
  '.gtr-row{display:flex;align-items:flex-start;gap:6px;margin:2px 0}' +
  '.gtr-row .gtr-dot{margin-top:3px}' +
  '.gtr-levels{margin:6px 0 2px;font-size:11.5px}' +
  '.gtr-note{font-size:10.5px;color:#6d766e;margin-top:4px}' +
  // ALWAYS ON, like a map's attribution control: the CC BY credit never hides behind the collapsed legend
  '.gtr-credit{position:absolute;z-index:3;inset-block-end:0;inset-inline-end:0;padding:2px 6px;font:11px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
  'background:rgba(255,255,255,.82);color:#3a4048;border-start-start-radius:3px}' +
  '.gtr-credit a{color:#2a5d8f;text-decoration:none}' +
  '.gtr-poster{display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #e6e8e3;font-weight:600}' +
  '.gtr-poster select,.gtr-poster button{font:inherit;font-weight:400;font-size:12px;border:1px solid #d1d4cd;background:#fff;color:#3b463d;border-radius:6px;min-height:26px;padding:2px 8px;cursor:pointer}' +
  '.gtr-poster button:focus-visible,.gtr-poster select:focus-visible{outline:2px solid #92b195;outline-offset:1px}' +
  '.gtr-min{position:absolute;inset-block-end:10px;inset-inline-start:10px;z-index:4;border:1px solid #d1d4cd;background:#fff;color:#3b463d;' +
  'border-radius:8px;padding:5px 10px;min-height:28px;font:600 12px Roboto,sans-serif;cursor:pointer}',
  'gi-tree',
)
</script>

<template>
  <div class="gtr" data-region="tree">
    <div ref="el" class="gtr-map" role="region" :aria-label="T('gospelInternet.tree.aria', 'Language tree: every language family of these people groups, coloured by what is found in each language')"></div>
    <div v-if="err" class="gtr-msg" role="alert">{{ err }}</div>
    <div v-else-if="!ready" class="gtr-msg" role="status">{{ T('grid.loading', 'Loading…') }}</div>

    <MapToolbar v-if="mapRef">
      <ZoomInButton :map="mapRef" />
      <ZoomOutButton :map="mapRef" />
      <HelpButton hosted />
    </MapToolbar>

    <div v-if="card" class="gtr-card" data-tree-card>
      <h4><bdi>{{ card.n.n }}</bdi></h4>
      <div class="gtr-lvl">{{ card.level }}<template v-if="card.n.iso"> · {{ card.n.iso }}</template>
        <template v-if="card.s.groups"> · {{ T('gospelInternet.tree.groupsN', '{n} people groups', { n: fmt(card.s.groups) }) }}</template></div>
      <div v-if="card.n.lv === 'f' || card.n.lv === 'b'" class="gtr-counts">
        <span class="gtr-c"><span class="gtr-dot" :style="{ background: TREE_COLOR.r }"></span>{{ fmt(card.s.r) }}</span>
        <span class="gtr-c"><span class="gtr-dot" :style="{ background: TREE_COLOR.y }"></span>{{ fmt(card.s.y) }}</span>
        <span class="gtr-c"><span class="gtr-dot" :style="{ background: TREE_COLOR.g }"></span>{{ fmt(card.s.g) }}</span>
        <span>{{ T('gospelInternet.tree.languagesHere', 'languages here') }}</span>
      </div>
      <div v-else-if="card.n.st" class="gtr-c"><span class="gtr-dot" :style="{ background: TREE_COLOR[card.n.st] }"></span>{{ T('gospelInternet.tree.st.' + card.n.st, ST_EN[card.n.st]) }}</div>
      <div v-if="card.n.iso && board.readiness.value.byIso.get(card.n.iso)" class="gtr-via" data-tree-open>{{ T('gospelInternet.drawer.openCount', 'Open data') }}: {{ T('gospelInternet.drawer.openOf', '{n} of 5 signals', { n: fmt(board.readiness.value.byIso.get(card.n.iso).signals) }) }}</div>
      <div v-if="card.n.inh" class="gtr-via">{{ T('gospelInternet.tree.inherited', 'Colour of its language: no source catalogues resources by dialect.') }}</div>
      <div v-if="card.n.via" class="gtr-via">{{ T('gospelInternet.tree.via', 'Also on this path:') }} {{ card.n.via.join(' › ') }}</div>
      <button v-if="card.selected" type="button" @click="board.setTreeNode('')">{{ T('controls.clear', 'Clear') }}</button>
    </div>

    <div v-if="legendOpen" class="gtr-legend" data-tree-legend>
      <div class="gtr-lh"><span>{{ T('gospelInternet.tree.legendTitle', 'In their own language') }}</span>
        <button type="button" :aria-label="T('gospelInternet.legend.hide', 'Hide the legend')" @click="legendOpen = false">✕</button></div>
      <div class="gtr-row"><span class="gtr-dot" :style="{ background: TREE_COLOR.g }"></span><span>{{ T('gospelInternet.tree.st.g', 'New Testament or full Bible found') }}<template v-if="totals"> · {{ fmt(totals.g) }}</template></span></div>
      <div class="gtr-row"><span class="gtr-dot" :style="{ background: TREE_COLOR.y }"></span><span>{{ T('gospelInternet.tree.st.y', 'Something found, but no New Testament') }}<template v-if="totals"> · {{ fmt(totals.y) }}</template></span></div>
      <div class="gtr-row"><span class="gtr-dot" :style="{ background: TREE_COLOR.r }"></span><span>{{ T('gospelInternet.tree.st.r', 'Nothing found') }}<template v-if="totals"> · {{ fmt(totals.r) }}</template></span></div>
      <div class="gtr-levels">{{ T('gospelInternet.tree.levels', 'Family › branch › language › dialect. A family or branch shows the worst colour inside it. A dialect shows its language\'s colour, lighter: resources are catalogued per language, not per dialect. Click a circle to narrow the board to it.') }}</div>
      <div class="gtr-poster" data-tree-poster>
        <span>{{ T('gospelInternet.tree.poster', 'Poster') }}</span>
        <select v-model.number="posterSize" :aria-label="T('gospelInternet.tree.posterSizeAria', 'Poster size')">
          <option :value="36">{{ T('gospelInternet.tree.poster3ft', '3 × 3 ft') }}</option>
          <option :value="48">{{ T('gospelInternet.tree.poster4ft', '4 × 4 ft') }}</option>
        </select>
        <button type="button" @click="printPoster">{{ T('gospelInternet.tree.posterPrint', 'Print') }}</button>
      </div>
      <div v-if="posterNote" class="gtr-note">{{ posterNote }}</div>
      <div class="gtr-note">{{ T('gospelInternet.tree.sources', 'Tree: Glottolog (CC BY 4.0). Resources: eBible, Faith Comes By Hearing, Scripture Earth, PNG.Bible, JESUS Film, Global Recordings and others, keyed by ISO 639-3.') }} {{ citation }}</div>
    </div>
    <button v-else type="button" class="gtr-min" @click="legendOpen = true">{{ T('gospelInternet.legend.show', 'Legend') }}</button>
    <!-- names and a licence, the same in every language (like the map's own attribution): not catalogue text -->
    <div class="gtr-credit" data-tree-credit><a href="https://glottolog.org" target="_blank" rel="noopener noreferrer">Glottolog</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></div>
  </div>
</template>
