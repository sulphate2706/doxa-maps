<script setup>
/**
 * GiCenteredSetMap.vue — the centered-set target on the whiteboard: pannable, zoomable, and
 * labelled by tier as the reader zooms in, the way the language tree is.
 *
 * WHY THE MAP ENGINE AND NOT SVG, which is the opposite of the call this chart shipped with:
 * the ask changed. A static target is fine in SVG; a zoomable one with ~2,100 labels is not.
 * The engine tiles the collection per zoom so it draws LESS when zoomed out, and its symbol
 * layers do label collision — which is the part that would take me longest to do badly. SVG
 * keeps every node in the page at every zoom, which is exactly what makes a big tree slow.
 *
 * THE LABEL STAGING IS REQUIRED, and it is one layer per tier with its own minzoom:
 * band names when zoomed out, ring names in the middle, group names when you are in close.
 * Nothing in that is tree-shaped, which is why it is a shared layer rather than a copy.
 *
 * ⚠ COORDINATES GO THROUGH THE PROJECTION, NEVER A SCALE. The whiteboard's inverse-Mercator is
 * the exact inverse of the renderer's own transform, so a circle stays a circle; a linear scale
 * would draw these concentric rings as ovals worsening outward, plausibly enough to waste an
 * afternoon on. The one number this chart owns is its EXTENT.
 */
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, markRaw } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { labelFont } from '@map/maps/label-font.js'
import { whiteboardProjection } from '@map/maps/whiteboard-projection.js'
import { addTieredPointLayers } from '@map/charts/whiteboard/tiered-points.js'
import { createWhiteboardMap, reducedMotion } from '@map/maps/whiteboard-map.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { ringInfo, CENTRE_COLOR } from '../ringInfo.js'
import { layoutCenteredSet, ringRadii, RING_MAX } from '@map/components/charts/centeredSet.js'
import { centeredSetFeatures, toFeatureCollection, TIERS, addCrossLayer } from '../setChartFeatures.js'
import { bandFill, curvedRingLabels } from '@map/components/charts/ringBands.js'

const props = defineProps({
  groups: { type: Array, default: () => [] },   // { id, label, ring, neighborId }
  activeRing: { type: [Number, null], default: null },
})
const emit = defineEmits(['select'])

const T = useGiT()
const board = useBoardState()
const el = ref(null)
const mapRef = shallowRef(null)
const handle = shallowRef(null)
// The ResizeObserver that keeps the fit following the container. Held so it can be DISCONNECTED
// on unmount: an observer left attached pins the element, and through it the map and its canvas.
let fitRo = null
const ready = ref(false)
const failed = ref('')

const EXTENT = 30 + (RING_MAX - 1) * 22          // 228 — the ring the outermost groups sit on
// ★ 0.095, NOT THE 0.17 DEFAULT. With renderWorldCopies:false the engine will not zoom out past the
// point where ONE WORLD fills the canvas WIDTH, so the minimum zoom is log2(canvasWidth/512) and a
// wide, short figure is clamped too close to fit its own height. minZoom is irrelevant; the width
// constraint wins. The symptom measured at 1440 — 54 groups outside the frame in ar, 97 in en,
// so it was never RTL-specific. At 0.17 the drawing spans 0.34 of the Mercator square and needs
// 271px of vertical room where the canvas offers 249; at 0.095 it spans 0.17 and needs 151px
// against 169 available at padding 40. Checked by check:gospel-set-fit.
const EXTENT_FRACTION = 0.095
const project = whiteboardProjection({ extent: EXTENT, extentFraction: EXTENT_FRACTION })

const INNER_R = 30, RING_GAP = 22
const radii = computed(() => ringRadii({ innerR: INNER_R, ringGap: RING_GAP }))

// The ring LABELS, and the arc each one reserves. bandFill is given these so it can refuse to place
// a pin inside a label — one source for both, which is what makes "pins never overlap the labels"
// hold by construction rather than by luck.
const ringLabels = computed(() => curvedRingLabels(
  radii.value,
  (r) => `${T('gospelInternet.rings.ring', 'Ring')} ${r}`,
  { ringGap: RING_GAP },
))

const layout = computed(() => layoutCenteredSet(props.groups, { innerR: INNER_R, ringGap: RING_GAP }))

// ★ THE TARGET, NOT A CIRCLE OF DOTS. layoutCenteredSet gives every group on ring N the same
// radius, so a crowded ring drew as a single line. bandFill spreads them THROUGH the ring's band,
// evenly by angle and deterministically by id, never inside a label's keep-out arc. Over-full rings
// shrink their pins to a floor before anything is reported unplaced — a visible pin beats a missing
// one — and whatever still cannot fit is reported rather than silently overlapped or dropped.
// ★ THE ONE LINE ROW 130 DECIDES. 'fit' (today) keeps every pin separable at the chart's own
// scale and reports what will not fit; on the real default view that is 931 of 2,074 drawn and 1,143
// reported. 'fill-all' draws all 2,074 and lets zoom do the separating — measured: 0 unplaced, every
// pin inside its band, none under a label, ring 2 using 18 rows for its 658 groups.
//
// 'fit' is NOT a placeholder and must stay the default here until the ruling: it is the honest mode
// for a page that cannot zoom, which is why the POSTER should keep it whatever the screen chooses.
// The binding constraint is band DEPTH, not separation — sep can never fall below 2x the pin floor
// (5.2), and an 18.5-unit band therefore holds at most 3 rows, so no minSep reaches ring 2's 658.
// That is why this is a mode and not a tuned number.
const SET_FILL_MODE = 'fit'          // ← row 130: change to 'fill-all' for the screen charts

const banded = computed(() => bandFill(layout.value.placed, radii.value, {
  ringGap: RING_GAP,
  labels: ringLabels.value,
  // The chart's own units, not screen pixels: this module cannot know the zoom.
  minSep: 7,
  mode: SET_FILL_MODE,
}))

const features = computed(() => centeredSetFeatures(
  banded.value.placed,
  radii.value,
  { population: (p) => p.pop ?? 0,
    ringLabel: (r) => T(`gospelInternet.rings.ring`, 'Ring') + ' ' + r,
    bandLabel: (b) => T(`gospelInternet.rings.band.${b}`, b) },
))
const data = computed(() => toFeatureCollection(features.value, project).collection)

// Colour comes from ringInfo so the chart, the legend and the printed sheet share one palette;
// a ring with no info (the centre) falls back to the cross's colour rather than to a default
// that would silently look like a real ring.
const colorExpr = computed(() => {
  const stops = []
  for (let r = 1; r <= RING_MAX; r++) stops.push(r, ringInfo(r)?.color || CENTRE_COLOR)
  return ['match', ['get', 'ring'], ...stops, CENTRE_COLOR]
})

// Dimming is a paint expression rather than a filter, for the same reason the SVG version dims
// instead of hiding: a ring emptied of dots reads as a ring with no groups, which is the
// opposite of what a reader selecting it just asked.
const opacityExpr = computed(() => props.activeRing == null
  ? 0.85
  : ['case', ['==', ['get', 'ring'], props.activeRing], 1, 0.12])

/**
 * Open a people group and frame it — GiTree's interaction, not a second version of it.
 *
 * The zoom mirrors GiTree.frame()'s degenerate-point branch: a single dot has no extent, so
 * fitBounds on it would ask the engine for an infinite zoom. easeTo at a sensible zoom instead, and
 * jumpTo when the reader has asked for reduced motion. Wrapped, because a camera that throws must
 * never take the board down with it — the drawer has already opened by then and that is the part
 * the reader asked for.
 */
function openAndFrame(slug, feature) {
  try { board.openGroup?.(slug) } catch (_) { /* the drawer is the ask; the camera is the flourish */ }
  const map = mapRef.value
  const c = feature?.geometry?.coordinates
  if (!map || !Array.isArray(c) || c.length < 2) return
  try {
    const duration = reducedMotion() ? 0 : 700
    const zoom = Math.max(map.getZoom(), 5.2)   // the zoom the GROUP tier becomes readable at
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
        sourceId: 'gcsm',
        // The staging is: bands read zoomed out, rings in the middle, groups in close.
        tiers: [
          { tier: TIERS.BAND, minzoom: 0, weight: 'bold', offset: 1.1 },
          { tier: TIERS.RING, minzoom: 3.2, weight: 'regular', offset: 0.8, muted: true },
          { tier: TIERS.GROUP, minzoom: 5.2, weight: 'regular', offset: 0.7 },
        ],
        colorExpr: colorExpr.value,
        radiusExpr: ['interpolate', ['linear'], ['zoom'], 1, 1.6, 6, 3.4],
        opacityExpr: opacityExpr.value,
        font: labelFont,
        // A click on a GROUP opens that people group and frames it; a click anywhere else on a ring
        // selects the ring, as before. The requirement is "exactly like the Language tree", so
        // this is GiTree's path rather than an approximation of it: openGroup() is the same call,
        // and the camera respects reduced motion the same way.
        onClick: (id, f) => {
          const tier = f?.properties?.tier
          if (tier === TIERS.GROUP && id) { openAndFrame(id, f) ; return }
          const r = f?.properties?.ring
          if (r != null) emit('select', r)
        },
      }))
      addCrossLayer(map, project, 'gcsm-cross')
      // ★ REFIT WHENEVER THE BOX CHANGES SIZE, because a one-shot fit cannot know when that is.
      // These panels are v-show, so a map can be created while its container is display:none and
      // therefore zero-sized; the engine keeps whatever size it measured then, and a fit computed
      // against it lands at the wrong zoom. That is why one layout opened at 0.64 while an almost
      // identically-shaped one opened at 0.31 — and why raising padding, resizing once and
      // refitting on idle all left it BIT-IDENTICAL: none of them was the moment the box changed.
      const fitTarget = () => {
        try {
          const box = el.value
          if (!box || !box.clientWidth || !box.clientHeight) return   // still hidden: wait to be shown
          map.resize()
          const [w, sLat] = project(-EXTENT, -EXTENT)
          const [e, nLat] = project(EXTENT, EXTENT)
          map.fitBounds([[w, sLat], [e, nLat]], { padding: 40, duration: 0 })
        } catch (e) {
          console.warn('[gospel-internet] could not fit the chart to its box:', e && e.message || e)
        }
      }
      fitTarget()
      try {
        fitRo = new ResizeObserver(fitTarget)
        if (el.value) fitRo.observe(el.value)
      } catch (_) { /* no ResizeObserver: the initial fit stands */ }
      ready.value = true
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
    // FAILS VISIBLY: an empty whiteboard is indistinguishable from a chart with no groups.
    failed.value = String(e?.message || e)
  }
})

watch(data, (d) => { try { mapRef.value?.getSource('gcsm')?.setData(d) } catch (_) {} })
// ⚠ THE LAYER ID COMES FROM THE HANDLE, NOT FROM A GUESS. I first wrote 'gcsm-points'; the
// module names it `${sourceId}-dots`. Wrapped in a try/catch, that mistake does not throw — the
// dimming simply never happens, which looks like a legend that does nothing rather than like a
// bug. Reading layerIds means a rename over there cannot silently disable this.
const dotsLayer = computed(() => (handle.value?.layerIds || []).find((id) => id.endsWith('-dots')))
watch(opacityExpr, (o) => {
  const id = dotsLayer.value
  if (!id) return
  try { mapRef.value?.setPaintProperty(id, 'circle-opacity', o) } catch (_) {}
})

onBeforeUnmount(() => { try { fitRo?.disconnect() } catch (_) {} ; try { handle.value?.destroy?.() } catch (_) {} ; try { mapRef.value?.remove?.() } catch (_) {} })

useShadowStyles(
  '.gcsm{position:absolute;inset:0;min-height:0;min-width:0}' +
  '.gcsm-map{position:absolute;inset:0}' +
  '.gcsm-fail{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'padding:16px;text-align:center;color:#3b463d;font-size:13px;background:#f3f3f1}',
  'gi-centered-set-map',
)
</script>

<template>
  <div class="gcsm">
    <div ref="el" class="gcsm-map" />
    <p v-if="failed" class="gcsm-fail">
      {{ T('gospelInternet.centered.failed', 'The neighbour table could not be loaded, so this chart is not drawn.') }}
      <span dir="ltr">{{ failed }}</span>
    </p>
  </div>
</template>
