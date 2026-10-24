<script setup>
/**
 * LanguageTreeChart.vue — every language family a roster belongs to, as a radial tree on a whiteboard.
 *
 * Promoted from gospel-internet's GiTree (product brief §B). It is deliberately THIN: the drawing is
 * library/charts/whiteboard/tiered-points.js, the surface is library/maps/whiteboard-map.js, the
 * hierarchy is library/charts/whiteboard/language-tree-model.js and the camera is
 * library/charts/whiteboard/frame-target.js — all four tested headlessly. What is left here is wiring,
 * because an SFC cannot be run by a gate and so should hold as little as possible.
 *
 * ★ PROPS IN, EVENTS OUT. GiTree had NO props and NO emits: it read a board composable and a module
 * singleton, which is what made it gospel's rather than anybody's. Everything it reached for is now a
 * prop, and `selected` is a v-model so the HOST decides what a click means.
 *
 * ★ THE CLICK TOGGLE IS THE HOST'S, DELIBERATELY. GiTree cleared the selection when you clicked the
 * selected node again — and that toggle lived inside the component's own click handler, not at the call
 * site. Moving it out MOVES behaviour rather than codifying it, which is worth saying plainly: a host
 * that wants the toggle must write it. In exchange the chart holds no selection state at all.
 *
 * ★ FRAME ON SELECT, NOT ON CHANGE. Clearing does NOT re-frame: the camera stays where the reader left
 * it, because yanking it back is a motion nobody asked for. "Frames when the selection changes" is the
 * obvious phrasing and it is wrong in exactly one case, which is the case that annoys people.
 *
 * ★ AND A SELECTION SET BEFORE THE MAP IS READY IS REPLAYED. GiTree survived this by ordering: its host
 * set the node through a composable that waited for data, so the value always arrived after the map. As
 * a PROP the ordering belongs to the host, and a prop whose effect depends on WHEN you set it is a trap
 * for every future consumer — a shared deep link would work or not depending on load timing, which is
 * unreportable. So ready replays whatever `selected` currently is.
 */
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, markRaw } from 'vue'
import { createWhiteboardMap, reducedMotion as prefersReducedMotion } from '@map/maps/whiteboard-map.js'
import { addTieredPointLayers } from '@map/charts/whiteboard/tiered-points.js'
import { indexTree, nodeFC, linkFC, subtreeCoords, worstOfDescendants } from '@map/charts/whiteboard/language-tree-model.js'
import { frameTarget, applyFrame } from '@map/charts/whiteboard/frame-target.js'
import { labelFont } from '@map/maps/label-font.js'

const props = defineProps({
  /** the built tree: { nodes: [...] } from library/scripts/build-language-tree.mjs */
  tree: { type: Object, default: null },
  /** ids or ISO codes currently on the board; null means everything is in scope */
  inScope: { type: Object, default: null },
  /** v-model: the selected node id, '' for none */
  selected: { type: String, default: '' },
  /** a node id to point at; never moves the camera */
  hovered: { type: String, default: '' },
  /** (key, fallback) => string */
  t: { type: Function, default: (k, en) => en || k },
  /** (node, { index, inScope }) => colour; defaults to the worst status among IN-SCOPE descendants */
  colorFor: { type: Function, default: null },
  /** engine config: { provider, tk, lang } — the same profile-config shape the maps take */
  profileConfig: { type: Object, default: null },
  token: { type: String, default: '' },
  /** override the media query, for hosts that expose their own setting */
  reducedMotion: { type: Boolean, default: null },
})
const emit = defineEmits(['update:selected', 'node-click', 'ready', 'error'])

const el = ref(null)
const mapRef = shallowRef(null)
const ready = ref(false)
const err = ref('')
let layers = null
let unmounted = false

const index = computed(() => (props.tree?.nodes ? indexTree(props.tree.nodes) : null))
const PALETTE = { g: '#1f8f5f', y: '#e3a82b', r: '#b42318' }
const colour = (n, ctx) => {
  if (props.colorFor) return props.colorFor(n, ctx)
  const st = worstOfDescendants(ctx.index, n.id, { inScope: ctx.inScope })
  return PALETTE[st] || '#8d968e'
}
const points = computed(() => (index.value ? nodeFC(index.value, { colorFor: colour, inScope: props.inScope }) : null))

// One symbol layer per tier, each entering at its own zoom: families first, then languages, then
// branches, then dialects. The engine resolves the collisions; this only says what may appear when.
const TIERS = [
  { tier: 'f', minzoom: 0, size: [0, 10, 1, 11, 6, 15], weight: 'bold', offset: 1.1, filter: ['==', ['get', 'root'], 1] },
  { tier: 'l', minzoom: 3.6, size: [3.6, 10, 8, 13], offset: 0.8 },
  { tier: 'b', minzoom: 4.4, size: [4.4, 9, 8, 11], offset: 0.7, muted: true },
  { tier: 'd', minzoom: 5.6, size: [5.6, 9, 9, 11], offset: 0.7, muted: true },
]

const motion = () => (props.reducedMotion === null ? prefersReducedMotion() : props.reducedMotion)

function frameSelection(id) {
  const map = mapRef.value
  if (!map || !ready.value || !id || !index.value) return
  applyFrame(map, frameTarget(subtreeCoords(index.value, id), {
    reducedMotion: motion(), currentZoom: map.getZoom ? map.getZoom() : 0,
  }))
}

onMounted(async () => {
  if (!el.value || !props.tree?.nodes?.length) { err.value = props.t('tree.noData', 'No tree data'); return }
  const made = await createWhiteboardMap(el.value, props.profileConfig, { token: props.token })
  if (unmounted) { try { made.map?.remove() } catch (_) {} return }
  if (made.error) { err.value = made.error; emit('error', made.error); return }
  const map = made.map
  mapRef.value = markRaw(map)

  map.addSource('lt-links', { type: 'geojson', data: linkFC(index.value) })
  map.addLayer({
    id: 'lt-links', type: 'line', source: 'lt-links',
    paint: { 'line-color': '#8d968e', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.3, 7, 1], 'line-opacity': 0.4 },
  })
  layers = addTieredPointLayers(map, {
    sourceId: 'lt', data: points.value, tiers: TIERS,
    colorExpr: ['get', 'colour'],
    radiusExpr: ['interpolate', ['linear'], ['zoom'], 1, ['case', ['==', ['get', 'root'], 1], 3, 1.4], 8, ['case', ['==', ['get', 'root'], 1], 7, 4]],
    opacityExpr: ['case', ['==', ['get', 'm'], 0], 0.15, 0.95],
    dish: { filter: ['==', ['get', 'root'], 1], radiusExpr: ['interpolate', ['exponential', 2], ['zoom'], 1, ['*', ['get', 'R'], 1], 8, ['*', ['get', 'R'], 128]] },
    font: labelFont,
    // The chart reports the click; it does NOT decide what a click means, and it holds no selection.
    onClick: (id, f) => { emit('node-click', id, f); emit('update:selected', id) },
    onHover: (id) => { if (id !== props.hovered) emit('update:hovered', id) },
  })

  ready.value = true
  // The opening view: the whole tapestry, instantly. An opening view is not a motion the reader asked
  // for, so it is never animated however the motion setting reads.
  const all = points.value.features.filter((f) => f.properties.root === 1).map((f) => f.geometry.coordinates)
  applyFrame(map, frameTarget(all, { reducedMotion: true }))
  // ...and THEN replay whatever the host already selected, so a deep link works regardless of ordering.
  if (props.selected) { layers.setSelected(props.selected); frameSelection(props.selected) }
  if (props.hovered) layers.setHovered(props.hovered)
  emit('ready', map)
})

watch(() => props.selected, (id) => {
  if (!layers || !ready.value) return
  layers.setSelected(id)
  if (id) frameSelection(id)      // frame on SELECT; clearing leaves the camera alone
})
// Hover only ever sets a filter. There is no camera call on this path, structurally.
watch(() => props.hovered, (id) => { if (layers && ready.value) layers.setHovered(id) })
watch(points, (fc) => { const m = mapRef.value; if (m && fc) { try { m.getSource('lt').setData(fc) } catch (_) {} } })

onBeforeUnmount(() => {
  unmounted = true
  try { layers?.destroy() } catch (_) {}
  try { mapRef.value?.remove() } catch (_) {}
})
</script>

<template>
  <div class="ltc">
    <div ref="el" class="ltc-map" role="region"
         :aria-label="t('tree.aria', 'Language tree: every language family of these people groups')"></div>
    <div v-if="err" class="ltc-msg" role="alert">{{ err }}</div>
    <div v-else-if="!ready" class="ltc-msg" role="status">{{ t('tree.loading', 'Loading…') }}</div>
    <slot name="actions" :map="mapRef" />
    <slot name="card" :selected="selected" :node="index && selected ? index.byId.get(selected) : null" />
  </div>
</template>

<style scoped>
.ltc { position: absolute; inset: 0; }
.ltc-map { position: absolute; inset: 0; }
.ltc-msg { position: absolute; inset: 0; display: grid; place-items: center; font: 13px/1.4 system-ui, sans-serif; color: #6d766e; }
</style>
