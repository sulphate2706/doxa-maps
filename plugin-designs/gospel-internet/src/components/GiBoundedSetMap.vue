<script setup>
/**
 * GiBoundedSetMap.vue — the bounded set on the whiteboard: one circle, reached inside,
 * unreached outside, pannable and zoomable like its neighbour.
 *
 * The chart still makes exactly one claim — which side of the line a group is on — so nothing
 * here encodes distance, ranking or gradient. What zoom buys is reading the names: at 2,100
 * dots the inside is a cluster until you can get close to it.
 *
 * ★ THE BOUNDARY IS A DISH, AND ITS RADIUS MUST BE IN MAP UNITS. circle-radius is SCREEN
 * PIXELS: a fixed value would hold its size on screen while the dots spread out from under it,
 * so the circle would be correct at exactly one zoom and wrong at every other — and for dots
 * near the edge the inside/outside reading would silently invert, which is the only thing this
 * chart says. degreesToPixelRadius converts it with an exponential-base-2 interpolation, which
 * is exact rather than approximate because pixels-per-degree doubles with every zoom level.
 *
 * The cross rides in the point collection as its own tier rather than as an overlay, so it pans
 * and zooms with the drawing instead of floating over it.
 */
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, markRaw } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { labelFont } from '@map/maps/label-font.js'
import { whiteboardProjection } from '@map/maps/whiteboard-projection.js'
import { addTieredPointLayers } from '@map/charts/whiteboard/tiered-points.js'
import { createWhiteboardMap, reducedMotion } from '@map/maps/whiteboard-map.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { layoutBoundedSet } from '@map/components/charts/boundedSet.js'
import { boundedSetFeatures, toFeatureCollection, dishRadiusDegrees, degreesToPixelRadius, TIERS, addCrossLayer } from '../setChartFeatures.js'

const props = defineProps({ groups: { type: Array, default: () => [] } })

const T = useGiT()
const board = useBoardState()
const el = ref(null)
// Held so it can be DISCONNECTED on unmount: an observer left attached pins the element, and
// through it the map and its canvas.
let fitRo = null
const mapRef = shallowRef(null)
const handle = shallowRef(null)
const failed = ref('')

const R = 120, SPREAD = 260
// ★ 0.095, NOT THE 0.17 DEFAULT — the same clamp as the centered chart, and the same number so the
// two sets read at one scale. renderWorldCopies:false stops the engine zooming out past
// log2(canvasWidth/512), so a wide, short figure cannot fit its height at 0.17 and the outermost
// groups fall outside the frame (measured at 1440: 54 outside in ar and 97 in en — the width, not RTL).
// Kept EQUAL to GiCenteredSetMap's on purpose: a reader switching tabs compares two drawings, and a
// different footprint per tab would make the same population look like a different size.
const EXTENT_FRACTION = 0.095
const project = whiteboardProjection({ extent: SPREAD, extentFraction: EXTENT_FRACTION })

const layout = computed(() => layoutBoundedSet(props.groups, { r: R, spread: SPREAD }))
const built = computed(() => boundedSetFeatures(layout.value, { population: (p) => p.pop ?? 0 }))

// The cross is a feature, not an overlay, so it moves with the drawing. It is its own tier so
// the label layer renders it at every zoom while group names stay hidden until you are close.
const features = computed(() => [
  ...built.value.features,
  { id: '__centre', label: '✝', tier: 'centre', k: 3e9, u: 0, v: 0 },
])
const data = computed(() => toFeatureCollection(features.value, project).collection)

const dishDegrees = computed(() => dishRadiusDegrees(R, project))

/**
 * Open a people group and frame it — the same interaction as the centered set and as GiTree, so a
 * reader who learns one chart has learned all three. See GiCenteredSetMap.openAndFrame for why the
 * camera treats a single dot as a degenerate frame rather than calling fitBounds on it.
 */
function openAndFrame(slug, feature) {
  try { board.openGroup?.(slug) } catch (_) { /* the drawer is the ask; the camera is the flourish */ }
  const map = mapRef.value
  const c = feature?.geometry?.coordinates
  if (!map || !Array.isArray(c) || c.length < 2) return
  try {
    const duration = reducedMotion() ? 0 : 700
    const zoom = Math.max(map.getZoom(), 5.2)
    if (duration) map.easeTo({ center: c, zoom, duration, essential: true })
    else map.jumpTo({ center: c, zoom })
  } catch (_) { /* a degenerate frame never breaks the board */ }
}

onMounted(async () => {
  try {
    const made = await createWhiteboardMap(el.value, board.profileConfig?.value || {},
      { whiteboard: true, boundaries: false, center: [0, 0], zoom: 1 })
    const map = markRaw(made.map || made)
    mapRef.value = map
    // ★ createWhiteboardMap ALREADY AWAITS LOAD. The library helper resolves only after
    // `await new Promise(res => map.once('load', res))`, so by the time this runs the event has
    // fired and will not fire again — a second `map.on('load', …)` never runs and the layers are
    // never added. The chart then draws a basemap-less whiteboard with no source on it: empty,
    // silent, and with nothing thrown for a failure branch to catch.
    // Guarded rather than assumed: if a future engine resolves earlier, once('load') still fires.
    const setup = () => {
      handle.value = markRaw(addTieredPointLayers(map, {
        data: data.value,
        sourceId: 'gbsm',
        tiers: [
          { tier: 'centre', minzoom: 0, weight: 'bold', offset: 0 },
          { tier: TIERS.GROUP, minzoom: 5.2, weight: 'regular', offset: 0.7 },
        ],
        // Inside and outside are the whole claim, so they are the whole palette.
        colorExpr: ['match', ['get', 'side'], 'in', '#92b195', 'out', '#6d766e', '#3b463d'],
        radiusExpr: ['interpolate', ['linear'], ['zoom'], 1, 1.8, 6, 3.6],
        opacityExpr: ['case', ['==', ['get', 'side'], 'out'], 0.65, 0.95],
        dish: {
          filter: ['==', ['get', 'id'], '__centre'],
          radiusExpr: degreesToPixelRadius(dishDegrees.value),
          color: 'rgba(0,0,0,0)',            // the boundary is a LINE, not a filled disc:
          stroke: '#3b463d',                 // a fill would imply the inside is a region
        },
        font: labelFont,
        // A pin opens its people group, the same as the centered set. The centre dish is not a
        // group, so it is filtered out by tier rather than by id.
        onClick: (id, f) => { if (f?.properties?.tier === TIERS.GROUP && id) openAndFrame(id, f) },
      }))
      // The cross marks the centre the boundary is drawn around — this chart was reported as having
      // none. Same geometry and the same call as the centered chart, so the two cannot drift apart.
      addCrossLayer(map, project, 'gbsm-cross')
      // The same ResizeObserver fit as the centered chart, and for the same reason: this panel is
      // v-show, so the map can be built while its container is display:none and zero-sized, and a
      // one-shot fit against that box lands at the wrong zoom.
      const fitTarget = () => {
        try {
          const box = el.value
          if (!box || !box.clientWidth || !box.clientHeight) return   // still hidden: wait to be shown
          map.resize()
          const [w, sLat] = project(-SPREAD, -SPREAD)
          const [e, nLat] = project(SPREAD, SPREAD)
          map.fitBounds([[w, sLat], [e, nLat]], { padding: 40, duration: 0 })
        } catch (e) {
          console.warn('[gospel-internet] could not fit the bounded chart to its box:', e && e.message || e)
        }
      }
      fitTarget()
      try {
        fitRo = new ResizeObserver(fitTarget)
        if (el.value) fitRo.observe(el.value)
      } catch (_) { /* no ResizeObserver: the initial fit stands */ }
    }
    // ★ CALLED UNCONDITIONALLY, AND THE GUARD THAT USED TO BE HERE IS WHY THIS WAS BROKEN TWICE.
    // createWhiteboardMap only resolves after `await map.once('load')`, so by here the event HAS fired.
    // The previous line read `map.loaded() ? setup() : map.once('load', setup)` — but loaded()
    // does not mean "the load event fired", it means "the style AND every tile are loaded", and
    // the basemap tiles were still arriving. So it returned false, took the else branch, and
    // registered a handler for an event that had already happened. A guard added for a
    // hypothetical future engine broke the only case that actually exists.
    // If a defensive check is ever wanted here it is isStyleLoaded(), not loaded().
    setup()
  } catch (e) {
    failed.value = String(e?.message || e)
  }
})

watch(data, (d) => { try { mapRef.value?.getSource('gbsm')?.setData(d) } catch (_) {} })
onBeforeUnmount(() => { try { fitRo?.disconnect() } catch (_) {} ; try { handle.value?.destroy?.() } catch (_) {} ; try { mapRef.value?.remove?.() } catch (_) {} })

useShadowStyles(
  '.gbsm{position:absolute;inset:0;min-height:0;min-width:0}' +
  '.gbsm-map{position:absolute;inset:0}' +
  '.gbsm-fail{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'padding:16px;text-align:center;color:#3b463d;font-size:13px;background:#f3f3f1}',
  'gi-bounded-set-map',
)
</script>

<template>
  <div class="gbsm">
    <div ref="el" class="gbsm-map" />
    <p v-if="failed" class="gbsm-fail">
      {{ T('gospelInternet.bounded.failed', 'The reached/unreached table could not be loaded, so this chart is not drawn.') }}
      <span dir="ltr">{{ failed }}</span>
    </p>
  </div>
</template>
