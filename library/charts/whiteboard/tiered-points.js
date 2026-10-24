/**
 * tiered-points.js — a whiteboard of TIERED POINTS: the zoom, label-priority and hit behaviour that a
 * chart gets from the map engine instead of reimplementing.
 *
 * ★ WHY THIS IS NOT "THE TREE CHART". Read against gospel-internet's GiTree, six layer groups exist and
 * exactly ONE is hierarchical — the parent->child links. The other five (the points, the selection and
 * hover rings, the dish behind a cluster, and every label layer) are sourced from one point collection
 * and know nothing about trees. gospel re-read that independently and found the same split. So the
 * reusable thing is a whiteboard of points that carry a TIER, and the language tree is this PLUS edges
 * PLUS hierarchical framing.
 *
 * ★ WHAT THE ENGINE IS ACTUALLY BEING USED FOR, since it is unusual: not a map. A GeoJSON source is
 * tiled per zoom, so zoomed out it draws LESS; symbol placement never lets two labels overlap and
 * reveals them in priority order as the reader zooms. That is a large amount of hard behaviour —
 * collision, tiling, hit-testing — obtained by describing the data rather than writing it. An SVG
 * chart keeps every node in the page at every zoom, which is what makes a big one slow.
 *
 * ★ TIERS ARE JUST STRINGS, and each gets its OWN layer with its OWN minzoom. That is the whole
 * mechanism behind "band names zoomed out, ring names mid-zoom, group names zoomed in": the engine is
 * told which labels may appear when, and it resolves the rest. The language tree's tiers are
 * family/branch/language/dialect; a centered set's are band/ring/group. Same shape, different words.
 *
 * COORDINATES ARE DEGREES. A caller lays out in its own units and converts with
 * library/maps/whiteboard-projection.js, which is a PROJECTION and not a scale — see that file for why
 * a linear scale renders concentric rings as ovals.
 *
 * No framework import, so a gate can execute it against a recording fake map.
 */

/** The default label ramp for a tier, when a caller states only a minzoom. */
const DEFAULT_SIZE = (minzoom) => [minzoom, 10, minzoom + 4, 13]

/**
 * @param {Object} map    a Mapbox/MapLibre map (or anything implementing addSource/addLayer/on)
 * @param {Object} opts
 * @param {Object} opts.data        point FeatureCollection; each feature carries id, label, tier, priority
 * @param {Array}  opts.tiers       [{ tier, minzoom, size?, weight?, offset?, muted?, filter? }] — ONE
 *                                  symbol layer per entry, in the order given
 * @param {string} [opts.sourceId]
 * @param {*} [opts.colorExpr]      paint expressions, passed through UNREAD: this module has no opinion
 * @param {*} [opts.radiusExpr]     about what a colour means, which is what keeps it reusable
 * @param {*} [opts.opacityExpr]
 * @param {Object} [opts.dish]      { filter, radiusExpr, color?, stroke? } — a circle drawn BEHIND the
 *                                  points; a family's enclosing circle, or a bounded set's boundary
 * @param {Object} [opts.keys]      { id, label, tier, priority } property names on the features
 * @param {Function} [opts.font]    (map, { weight }) => layout properties for the label font
 * @param {Function} [opts.onClick] (id, feature) => void
 * @param {Function} [opts.onHover] (id | '', feature | null) => void
 * @returns {{ layerIds: string[], setSelected: Function, setHovered: Function, destroy: Function }}
 */
export function addTieredPointLayers(map, {
  data,
  tiers = [],
  sourceId = 'wb-points',
  colorExpr = '#3b463d',
  radiusExpr = 3,
  opacityExpr = 1,
  dish = null,
  keys = {},
  font = null,
  onClick = null,
  onHover = null,
} = {}) {
  const K = { id: 'id', label: 'label', tier: 'tier', priority: 'k', ...keys }
  const layerIds = []
  const add = (spec) => { map.addLayer(spec); layerIds.push(spec.id) }

  map.addSource(sourceId, { type: 'geojson', data, promoteId: K.id })

  // A circle behind a cluster. Optional, because only some charts have one — but it is the SAME layer
  // for a language family's dish and a bounded set's boundary, so it is not a new type for either.
  if (dish) {
    add({
      id: `${sourceId}-dish`, type: 'circle', source: sourceId, filter: dish.filter,
      paint: {
        'circle-radius': dish.radiusExpr, 'circle-color': dish.color || '#ffffff', 'circle-opacity': 0.55,
        'circle-stroke-color': dish.stroke || '#d1d4cd', 'circle-stroke-width': 1, 'circle-pitch-alignment': 'map',
      },
    })
  }

  add({
    id: `${sourceId}-dots`, type: 'circle', source: sourceId,
    paint: { 'circle-radius': radiusExpr, 'circle-color': colorExpr, 'circle-opacity': opacityExpr },
    // Higher priority draws on top AND wins a label collision; one property, both effects.
    layout: { 'circle-sort-key': ['-', 0, ['get', K.priority]] },
  })

  // Selection and hover are FILTERED LAYERS, not re-paints of the points layer. That is what makes
  // hover cost one setFilter and never a data update — and, structurally, why hover cannot move the
  // camera: there is nothing here that could.
  for (const kind of ['sel', 'hover']) {
    add({
      id: `${sourceId}-${kind}`, type: 'circle', source: sourceId,
      filter: ['==', ['get', K.id], ''],
      paint: {
        'circle-radius': radiusExpr, 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': kind === 'sel' ? '#3b463d' : '#e8a33d', 'circle-stroke-width': 2.5,
      },
    })
  }

  // ★ ONE SYMBOL LAYER PER TIER, each with its own minzoom. This is the entire "labels appear as you
  // zoom in" behaviour: the engine is told which labels may exist at which zoom and does the collision.
  for (const t of tiers) {
    add({
      id: `${sourceId}-lab-${t.tier}`, type: 'symbol', source: sourceId, minzoom: t.minzoom ?? 0,
      filter: t.filter || ['==', ['get', K.tier], t.tier],
      layout: {
        'text-field': ['get', K.label],
        'text-size': ['interpolate', ['linear'], ['zoom'], ...(t.size || DEFAULT_SIZE(t.minzoom ?? 0))],
        'text-anchor': 'top', 'text-offset': [0, t.offset ?? 0.8], 'text-max-width': t.maxWidth ?? 9,
        'symbol-sort-key': ['get', K.priority],
        ...(font ? font(map, { weight: t.weight || 'regular' }) : {}),
      },
      paint: {
        'text-color': t.muted ? '#6d766e' : '#3b463d',
        'text-halo-color': '#f3f3f1', 'text-halo-width': 1.4,
      },
    })
  }

  const dots = `${sourceId}-dots`
  const handlers = []
  const on = (ev, layer, fn) => { map.on(ev, layer, fn); handlers.push([ev, layer, fn]) }
  if (onClick) on('click', dots, (e) => { const f = e.features && e.features[0]; if (f) onClick(f.properties[K.id], f) })
  if (onHover) {
    on('mousemove', dots, (e) => { const f = e.features && e.features[0]; onHover(f ? f.properties[K.id] : '', f || null) })
    on('mouseleave', dots, () => onHover('', null))
  }

  const setFilterById = (layer, id) => { try { map.setFilter(layer, ['==', ['get', K.id], id || '']) } catch (_) {} }
  return {
    layerIds,
    setSelected: (id) => setFilterById(`${sourceId}-sel`, id),
    setHovered: (id) => setFilterById(`${sourceId}-hover`, id),
    destroy: () => {
      for (const [ev, layer, fn] of handlers) { try { map.off(ev, layer, fn) } catch (_) {} }
      for (const id of [...layerIds].reverse()) { try { map.removeLayer(id) } catch (_) {} }
      try { map.removeSource(sourceId) } catch (_) {}
    },
  }
}

export default addTieredPointLayers
