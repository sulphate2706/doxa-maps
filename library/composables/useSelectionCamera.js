/**
 * useSelectionCamera.js — "select rows in the table, the map zooms to that selection."
 *
 * Subscribes to the selection bus and drives the map camera ONCE per committed selection
 * change. The table never talks to the map: it mutates `bus.selectionSet` and bumps
 * `bus.selectionVersion`; this composable watches that version. That is exactly the
 * decoupling the bus exists for — the table panel owns no camera code, and this file owns
 * no table code.
 *
 * ── MOTION SAFETY (BUG-RESIZE-STROBE class; a reader may be photosensitive) ────────────
 * The strobe bug fixed in @map/composables/useMapInstance.js was caused by a resize handler
 * re-snapping the camera on EVERY frame at 60fps. The rule learned there is applied here:
 *
 *   1. ONE animation per committed selection change — never per frame, never per row.
 *      `selectionVersion` is bumped once per BATCH (useSelectionBus's performance contract),
 *      so selecting 2,107 rows emits ONE version bump, not 2,107.
 *   2. DEBOUNCED (CAMERA_DEBOUNCE_MS). Rapid shift+click range-dragging bumps the version
 *      many times in a few hundred ms; only the final state moves the camera. Each new bump
 *      CANCELS the pending move, so intermediate states are never animated.
 *   3. REDUCED MOTION — when the user asks for less motion we JUMP (duration 0) instead of
 *      easing. Same destination, zero traversal, no optical flow across the viewport.
 *   4. NOTHING here runs in a render path. The bbox is computed inside the debounced
 *      callback, i.e. at most once per settled selection, never inside a computed/watcher
 *      that the map redraw depends on.
 *
 * ── COST ──────────────────────────────────────────────────────────────────────────────
 * One O(n) pass over the selected rows per settled change (n = selection size), using the
 * slug-keyed rowStore for O(1) lookups rather than re-scanning all 2,107 rows per slug.
 * Selecting everything is a single ~2,107-element numeric pass — sub-millisecond — and it
 * happens once, after the debounce, off the render path.
 */
import { watch } from 'vue'

// ── Camera policy constants ───────────────────────────────────────────────────────────
// Debounce window. Long enough to swallow a shift+click range drag or a "select all"
// cascade, short enough that a single checkbox click still feels immediate.
const CAMERA_DEBOUNCE_MS = 150
// One eased move. Matches the panel's existing fitBounds duration so the selection camera
// and the filter camera feel like the same gesture.
const FLY_DURATION_MS = 1200
// Viewport padding so selected pins never sit flush against the panel edge.
const FIT_PADDING_PX = 70
// Ceiling for a MULTI-row fit. Without it, two rows in the same city fit at street level.
const FIT_MAX_ZOOM = 5.5
// A SINGLE selected row has a degenerate (zero-area) bbox — fitBounds would resolve it at
// maxZoom, slamming the camera to street level for a people-group whose coordinate is a
// country-scale centroid. Fly to the point at a deliberately regional zoom instead.
const SINGLE_ROW_ZOOM = 6
// Degenerate-bbox guard for the multi-row path: several rows can share one coordinate (or
// sit within metres of each other), which is a zero-area bbox by another route. Below this
// span we treat the cluster as a single point and use SINGLE_ROW_ZOOM.
const DEGENERATE_SPAN_DEG = 0.01
// Past this longitude span a selection effectively wraps the globe; framing it literally
// makes the camera animate the wrong way around the antimeridian. Ease to a world overview
// instead. Tuned to match the LEGEND_WIDE_SPAN_DEG threshold in @map/composables/useMapFly.js.
const WIDE_SPAN_DEG = 110
const WORLD_ZOOM = 1.45   // the panel's own initial zoom — a stable, familiar overview

/**
 * ★ THE CAMERA'S POLICY IN ONE NAMED PLACE (dashboard-kit landing 3).
 *
 * The eight constants above are not magic numbers; together they are a decision about how this
 * camera behaves, and the reason for each is in the comment beside it. Collecting them here is what
 * the kit spec asked for, and the failure it prevents is specific: a second dashboard re-picking
 * them one at a time, arriving at a camera that feels different from Big Picture's for no reason
 * anybody wrote down. A consumer that cites CAMERA_POLICY.FLY_DURATION_MS can be asked why it
 * differs; a consumer that retypes 1200 has made an invisible decision.
 *
 * ★ READ-ONLY, AND DELIBERATELY NOT YET OVERRIDABLE. Making each value a per-caller option means
 * threading eight of them through every use, and no consumer has asked for a different camera.
 * Exporting the decision so it can be READ and CITED is the half that has a use today; the override
 * belongs with the first consumer that needs one, who will also be able to say which value and why.
 * Saying that here is better than shipping eight options nobody passes.
 */
export const CAMERA_POLICY = Object.freeze({
  CAMERA_DEBOUNCE_MS, FLY_DURATION_MS, FIT_PADDING_PX, FIT_MAX_ZOOM,
  SINGLE_ROW_ZOOM, DEGENERATE_SPAN_DEG, WIDE_SPAN_DEG, WORLD_ZOOM,
})

/** True when the user has asked the OS for reduced motion. Read live (never cached): the
 *  preference can be toggled mid-session, and a stale `false` would animate at them. */
function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch (_) { return false }
}

/**
 * Numeric coordinate pair for a row, or null when unusable.
 *
 * The live API returns coordinates as STRINGS ("5.68736400", verified against 2,107 live
 * records on pray.doxa.life), so every read must go through Number() — a raw string compare
 * would order "9.5" above "78.2" lexically and silently produce a wrong bbox.
 *
 * Number.isFinite (not truthiness): `Number(r.latitude) && …` rejects a legitimate 0°
 * coordinate. We accept 0 per-axis and reject only the exact 0,0 pair — the null-island
 * sentinel that a missing geocode degrades into. Flying there would show the camera an
 * empty patch of the Gulf of Guinea.
 */
// ★ HOW a row carries its coordinate is a parameter; WHAT makes a coordinate usable is not.
// `row.longitude` / `row.latitude` is pray-tools' spelling, not a universal one — the next
// dashboard's rows put the same idea under different keys. So only the READ is configurable, and
// every guard below it (Number() on API strings, 0 accepted per-axis, the exact 0,0 null-island
// sentinel rejected, the out-of-range check) applies to every consumer. A kit that let each caller
// re-implement the validation would hand the next dashboard the same four bugs to rediscover.
const DEFAULT_COORD_READ = (row) => [row.longitude, row.latitude]
function coordsOf(row, readPair = DEFAULT_COORD_READ) {
  if (!row) return null
  const pair = readPair(row) || []
  const lng = Number(pair[0])
  const lat = Number(pair[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng === 0 && lat === 0) return null          // null island — a missing geocode, not a place
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null   // out-of-range guard
  return [lng, lat]
}

/**
 * Antimeridian-aware longitude extent.
 *
 * A Pacific selection holds longitudes near -176 and +178 (both present in the live data:
 * the full range is -176.18 .. +178.48). Naive min/max calls that a ~355° span and frames
 * the whole globe — or worse, animates the long way round. Re-projecting into [0,360) makes
 * the same set contiguous with a ~6° span. We compute both and keep the tighter one.
 *
 * Returns { minLng, maxLng, span }; maxLng may exceed 180, which Mapbox's fitBounds accepts
 * and wraps correctly.
 */
function lngExtent(longitudes) {
  let aMin = Infinity, aMax = -Infinity      // raw [-180, 180]
  let bMin = Infinity, bMax = -Infinity      // shifted [0, 360)
  for (const lng of longitudes) {
    if (lng < aMin) aMin = lng
    if (lng > aMax) aMax = lng
    const shifted = lng < 0 ? lng + 360 : lng
    if (shifted < bMin) bMin = shifted
    if (shifted > bMax) bMax = shifted
  }
  if (!Number.isFinite(aMin)) return null
  const spanA = aMax - aMin
  const spanB = bMax - bMin
  if (spanB < spanA) {
    const minRaw = bMin > 180 ? bMin - 360 : bMin
    return { minLng: minRaw, maxLng: minRaw + spanB, span: spanB }
  }
  return { minLng: aMin, maxLng: aMax, span: spanA }
}

/**
 * Bounding box of the selected rows.
 *
 * Resolves each slug through the slug-keyed rowStore (O(1)) instead of filtering the full
 * row array per slug, so a 2,107-row selection stays one linear pass.
 *
 * @returns {null | { kind:'point', center:[lng,lat] }
 *                 | { kind:'bounds', bounds:[[w,s],[e,n]], span:number }}
 *          null when NOTHING is selected or no selected row has usable coordinates —
 *          the caller must then leave the camera alone.
 */
export function selectionBounds(selectedSlugs, rowStore, readPair = DEFAULT_COORD_READ) {
  if (!selectedSlugs || !selectedSlugs.size || !rowStore) return null

  const lngs = []
  let minLat = Infinity, maxLat = -Infinity
  let first = null
  let count = 0

  for (const slug of selectedSlugs) {
    const c = coordsOf(rowStore.get(slug), readPair)
    if (!c) continue                                  // missing/null/invalid coords — skip the row
    if (count === 0) first = c
    lngs.push(c[0])
    if (c[1] < minLat) minLat = c[1]
    if (c[1] > maxLat) maxLat = c[1]
    count++
  }

  // Every selected row lacked coordinates (or the selection is empty) — no camera move.
  if (count === 0) return null
  if (count === 1) return { kind: 'point', center: first }

  const ext = lngExtent(lngs)
  if (!ext) return { kind: 'point', center: first }

  // Co-located cluster: a zero-area bbox by another route. fitBounds would hit maxZoom.
  if (ext.span < DEGENERATE_SPAN_DEG && (maxLat - minLat) < DEGENERATE_SPAN_DEG) {
    return { kind: 'point', center: [(ext.minLng + ext.maxLng) / 2, (minLat + maxLat) / 2] }
  }

  return {
    kind: 'bounds',
    bounds: [[ext.minLng, minLat], [ext.maxLng, maxLat]],
    span: ext.span,
  }
}

/**
 * Wire selection -> camera. Call once from the map panel's setup.
 *
 * @param {Object}   o
 * @param {Object}   o.bus         - the selection bus (selectionSet + selectionVersion)
 * @param {Function} o.getMap      - () => the live map instance (null before ready)
 * @param {Function} o.getRowStore - () => Map<slug, row>
 * @param {Object}   o.mapFly      - a useMapFly instance (shared library helper)
 * @param {Function} [o.isEnabled] - () => boolean; skip while false (e.g. map not ready)
 * @returns {Function} teardown — clears the pending timer and stops the watcher
 */
export function useSelectionCamera({ bus, getMap, getRowStore, mapFly, isEnabled = () => true,
  // `coords` is the one data-shape assumption this file makes. Default = the fields
  // research-dashboard has always used, so a caller that passes nothing is byte-for-byte unchanged.
  coords = DEFAULT_COORD_READ }) {
  if (!bus || !bus.selectionVersion) return () => {}

  let timer = null

  function moveCamera() {
    timer = null
    const map = getMap && getMap()
    if (!map || !isEnabled()) return

    // ★ `coords` IS PASSED HERE, and leaving it out was a real bug I nearly shipped: the option was
    // accepted in the signature and never reached selectionBounds, so a caller could set it, type-
    // check clean, build clean, and watch it do nothing. That is the presence-vs-reachability trap
    // this tree has paid for before (a defineProps on a component the custom element never binds).
    // An option that cannot be observed to work is worse than no option: it reads as supported.
    const target = selectionBounds(bus.selectionSet, getRowStore && getRowStore(), coords)
    // EDGE CASE — selection cleared, or no selected row has coordinates: hold position.
    // Deliberately NOT a reset-to-world: an unrequested snap-back is both jarring and, for
    // a photosensitive user, motion they did not ask for. Deselecting is not a navigation.
    if (!target) return

    // Reduced motion: same destination, zero traversal.
    const duration = prefersReducedMotion() ? 0 : FLY_DURATION_MS

    try {
      if (target.kind === 'point') {
        // Single row (or a co-located cluster). fitBounds on a degenerate bbox resolves at
        // maxZoom; a fixed regional zoom is the honest framing for a country-scale centroid.
        mapFly.flyTo(target.center, { zoom: SINGLE_ROW_ZOOM, duration, essential: true })
        return
      }
      if (target.span > WIDE_SPAN_DEG) {
        // Globe-spanning selection (e.g. "select all"). Framing it literally makes the
        // camera swing the wrong way around the antimeridian — the visible "snap".
        mapFly.flyTo(
          [(target.bounds[0][0] + target.bounds[1][0]) / 2,
           (target.bounds[0][1] + target.bounds[1][1]) / 2],
          { zoom: WORLD_ZOOM, duration, essential: true },
        )
        return
      }
      mapFly.fitBounds(target.bounds, FIT_PADDING_PX, {
        maxZoom: FIT_MAX_ZOOM, duration, essential: true,
      })
    } catch (_) { /* fitBounds throws on degenerate bounds — never break the dashboard */ }
  }

  // ONE watcher on ONE reactive handle. `selectionVersion` is bumped once per committed
  // batch (see useSelectionBus's performance contract), so a 2,107-row "select all" runs
  // this callback ONCE — and the debounce collapses even that into a single camera move.
  const stop = watch(() => bus.selectionVersion.value, () => {
    if (timer) clearTimeout(timer)       // a newer selection supersedes the pending move
    timer = setTimeout(moveCamera, CAMERA_DEBOUNCE_MS)
  })

  return function teardown() {
    if (timer) { clearTimeout(timer); timer = null }
    try { stop() } catch (_) {}
  }
}
