// useMapClustering.js — Map Clustering Composable
// Vue 3 Composition API — ES Module
//
// Three clustering modes:
//   1. 'mapbox'  — native Supercluster (cluster: true on the GeoJSON source)
//   2. 'mst'     — Kruskal Minimum Spanning Tree network lines (no orphans)
//   3. 'network' — Nearest-neighbor shard/gem effect (denser visual)
//
// PORT NOTES:
//   - Algorithm code (Kruskal, nearest-neighbor) ported from the upstream clustering project.
//   - Pinia/inject wiring pattern adopted from doxa-simple-map-component, but
//     adapted to the upstream convention which uses provide('mapStore', …)
//     in ProfileLoader.vue (NOT a `stores` umbrella). We `inject('mapStore')`
//     synchronously in setup so multi-instance Pinia stays isolated.
//   - The composable never imports stores directly — keeps each <doxa-map>
//     web-component embed isolated from sibling embeds on the same page.
//
// COMPANION DOCS:
//   - documentation/mapbox/clustering.md      — three-mode convention reference
//   - documentation/composables/map-clustering.md — composable contract

import { labelFont } from '../maps/label-font.js'
import { ref, computed, inject } from 'vue';
import { emissivePaint } from './useMapProvider.js';

import MSTClusteringUtil from '../utils/MSTClusteringUtil.js';
import NetworkClusteringUtil from '../utils/NetworkClusteringUtil.js';
import {
    groupBy,
    DEFAULT_MAPBOX_CLUSTER_OPTIONS,
    DEFAULT_CLUSTER_COLOR_RAMP,
    DEFAULT_CLUSTER_RADIUS_RAMP
} from '../utils/ClusterHelpers.js';

/**
 * @typedef {'mapbox' | 'mst' | 'network'} ClusteringMode
 */

/**
 * @typedef {Object} UseMapClusteringOptions
 * @property {() => mapboxgl.Map|null} [getMap]               - Returns the live Mapbox map
 * @property {string}                  [mapId]                - Logging tag
 * @property {() => Array<Object>}     [getPeopleGroups]      - Returns the active dataset
 * @property {string}                  [pinSourceId]          - Source ID of the pins layer (default: 'language-families')
 * @property {string}                  [pinLayerId]           - Layer ID of the pins layer (default: 'language-family-pins')
 * @property {string}                  [groupKey]             - Property to group by for MST/network (default: 'languageFamily')
 * @property {(name: string) => string} [getGroupColor]       - Color resolver per group name
 * @property {Object}                  [mapboxClusterOptions] - Overrides for source clustering options
 */

/**
 * @typedef {Object} UseMapClusteringApi
 * @property {import('vue').ComputedRef<boolean>}        enabled
 * @property {import('vue').ComputedRef<ClusteringMode>} mode
 * @property {import('vue').Ref<Array<Object>>}          clusterLines
 * @property {(next: ClusteringMode) => void}            setMode
 * @property {(on: boolean) => void}                     setEnabled
 * @property {(handler: ((evt: Object) => void)|null) => void} onClusterClick
 * @property {() => void}                                applyClustering
 * @property {() => void}                                clearClustering
 * @property {() => void}                                cleanup
 * @property {MSTClusteringUtil}                         mstUtil
 * @property {NetworkClusteringUtil}                     networkUtil
 */

// Internal layer/source IDs owned by this composable. Kept distinct from the
// host pin layer so we can toggle without disturbing the underlying source.
const CLUSTER_LINES_SOURCE = 'cluster-lines-source';
const CLUSTER_LINES_LAYER  = 'cluster-lines';
const MAPBOX_CLUSTER_SOURCE = 'mapbox-clusters';
const MAPBOX_CLUSTER_CIRCLE = 'mapbox-clusters-circle';
const MAPBOX_CLUSTER_COUNT  = 'mapbox-clusters-count';

// Reusable empty FeatureCollection — clearing via setData(EMPTY_FC) preserves
// the GL source/layer pair across toggles. This avoids the heap leak documented
// in mapbox-gl-js issues #2607, #4862, #5252 where addLayer/removeLayer chains
// retain GPU buffers in the WebGL backbuffer.
const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: [] });

/**
 * Map clustering composable — supports three clustering modes with a single
 * unified API.
 *
 * @param {UseMapClusteringOptions} [options]
 * @returns {UseMapClusteringApi}
 */
export function useMapClustering(options = {}) {
    const {
        getMap = () => null,
        mapId = 'unknown',
        getPeopleGroups = () => [],
        pinSourceId = 'language-families',
        pinLayerId = 'language-family-pins',
        groupKey = 'languageFamily',
        getGroupColor = null,
        mapboxClusterOptions = {}
    } = options;

    // ── Inject Pinia store synchronously — DO NOT import directly ──────────
    // ProfileLoader.vue uses provide('mapStore', useMapStore()) so each
    // <doxa-map> instance gets its own store. Direct `useMapStore()` here
    // would resolve to the wrong (or undefined) Pinia when this composable
    // is invoked outside the active app instance.
    const mapStore = inject('mapStore', null);

    // Algorithm utilities — instantiated once per composable.
    const mstUtil = new MSTClusteringUtil({ maxConnectionDistance: Infinity });
    const networkUtil = new NetworkClusteringUtil({
        maxDistance: 15,
        maxNeighbors: 15,
        sortKey: 'longitude'
    });

    // Local fallback state for environments without a mapStore.
    const _enabledLocal = ref(false);
    const _modeLocal = /** @type {import('vue').Ref<ClusteringMode>} */ (ref('mapbox'));

    /**
     * Whether clustering is currently enabled. Reads from `mapStore.clusteringEnabled`
     * if present, else falls back to local ref.
     */
    const enabled = computed(() => {
        if (mapStore && 'clusteringEnabled' in mapStore) return !!mapStore.clusteringEnabled;
        return _enabledLocal.value;
    });

    /**
     * Active clustering mode. Reads from `mapStore.clusteringMode` if present,
     * else falls back to local ref. Defaults to `'mapbox'`.
     */
    const mode = computed(() => {
        if (mapStore && mapStore.clusteringMode) return /** @type {ClusteringMode} */ (mapStore.clusteringMode);
        return _modeLocal.value;
    });

    /** Last computed cluster lines (MST or network). Empty for 'mapbox' mode. */
    const clusterLines = ref([]);

    /** Click handler registered via `onClusterClick`. */
    let _clusterClickHandler = null;
    let _attachedClusterLayerId = null;

    // Per-selection filter — when set, clustering only operates on pins whose
    // `property` equals `value`. Pushed by the host when a legend row is
    // clicked (lang-fam / doxa-region). Cleared when no row is selected.
    // See research-map.vue → applyDimFilter() for the wiring.
    let _selectionFilter = /** @type {{property: string, value: any}|null} */ (null);

    // ─────────────────────────────────────────────────────────────────────────
    // Mode + enabled setters — wire through to mapStore when available.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Set the active clustering mode. Updates mapStore and re-applies the
     * current clustering pass if enabled.
     *
     * @param {ClusteringMode} next
     */
    function setMode(next) {
        const allowed = ['mapbox', 'mst', 'network'];
        if (!allowed.includes(next)) {
            console.warn(`[${mapId}] useMapClustering.setMode: unknown mode "${next}". Allowed: ${allowed.join(', ')}`);
            return;
        }

        if (mapStore && typeof mapStore.setClusteringMode === 'function') {
            mapStore.setClusteringMode(next);
        } else if (mapStore && 'clusteringMode' in mapStore) {
            mapStore.clusteringMode = next;
        } else {
            _modeLocal.value = next;
        }

        if (enabled.value) {
            // Tear down old mode before applying new — prevents pin double-render
            // and orphan layers from previous mode lingering.
            clearClustering();
            applyClustering();
        }
    }

    /**
     * Toggle clustering on/off. Updates mapStore and applies/clears layers.
     *
     * @param {boolean} on
     */
    function setEnabled(on) {
        const next = !!on;

        if (mapStore && typeof mapStore.setClusteringEnabled === 'function') {
            mapStore.setClusteringEnabled(next);
        } else if (mapStore && 'clusteringEnabled' in mapStore) {
            mapStore.clusteringEnabled = next;
        } else {
            _enabledLocal.value = next;
        }

        if (next) applyClustering();
        else clearClustering();
    }

    /**
     * Constrain clustering to pins matching `{ property, value }`. Pass a
     * falsy filter (or `{ property: null, value: null }`) to clear and let
     * clustering operate on the full dataset again.
     *
     * Re-applies clustering immediately if currently enabled so the visible
     * MST/network lines update without waiting for a toggle.
     *
     * @param {{property: string|null, value: any}|null} filter
     */
    function setSelectionFilter(filter) {
        if (!filter || !filter.property || filter.value == null) {
            _selectionFilter = null;
        } else {
            _selectionFilter = { property: filter.property, value: filter.value };
        }

        // Mirror onto mapStore so other observers (e.g. UI badges) can read it.
        if (mapStore) {
            if ('clusterFilterProperty' in mapStore) {
                mapStore.clusterFilterProperty = _selectionFilter?.property ?? null;
            }
            if ('clusterFilterValue' in mapStore) {
                mapStore.clusterFilterValue = _selectionFilter?.value ?? null;
            }
        }

        if (enabled.value) {
            clearClustering();
            applyClustering();
        }
    }

    /**
     * Apply the active selection filter (if any) to the candidate
     * people-groups array. No-op when no filter is set.
     *
     * Comparison is lenient: both sides are lowercased + alphanumeric-stripped
     * before equality. This handles the doxa-research dataset where legend
     * rows expose canonical labels ("Asia", "Latin America & Caribbean")
     * while pin properties still carry raw lowercase codes ("asia",
     * "latin_america_&_caribbean", "na"). language-family + language values
     * already agree across legend + pin data, so loose matching is safe.
     *
     * @param {Array<Object>} peopleGroups
     * @returns {Array<Object>}
     * @private
     */
    function _filterBySelection(peopleGroups) {
        if (!_selectionFilter) return peopleGroups;
        const { property, value } = _selectionFilter;
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const target = norm(value);
        if (!target) return peopleGroups;
        return peopleGroups.filter(pg => {
            const v = pg?.[property] ?? pg?.properties?.[property] ?? pg?._normalized?.[property];
            return norm(v) === target;
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Click handler registration
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Register a handler invoked when a cluster (mapbox-mode bubble) is
     * clicked. Pass `null` to detach.
     *
     * The default handler — when `null` is passed and clusters become active —
     * zooms the map to `cluster_expansion_zoom`. To override this behavior,
     * register your own handler.
     *
     * @param {((evt: { clusterId: number, coordinates: [number, number], pointCount: number, originalEvent: Object }) => void)|null} handler
     */
    function onClusterClick(handler) {
        _clusterClickHandler = handler;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Apply / clear pipeline
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Apply the currently selected clustering mode to the map. Idempotent
     * within a mode — safe to call multiple times.
     */
    function applyClustering() {
        const map = getMap();
        if (!map) return;

        // Always tear down whichever mode was active before re-applying. This
        // is the fix for the "pin double-rendering on toggle" pitfall — leaving
        // the cluster source attached while switching modes leaves stale layers.
        clearClustering();

        switch (mode.value) {
            case 'mapbox':
                _applyMapboxClustering(map);
                break;
            case 'mst':
                _applyLineClustering(map, 'mst');
                break;
            case 'network':
                _applyLineClustering(map, 'network');
                break;
            default:
                console.warn(`[${mapId}] Unknown clustering mode: ${mode.value}`);
        }

        // Dim base pins when clustering is active so the cluster takes visual
        // precedence. The host can override this paint property if it wants
        // a different dimming rule.
        _setPinDimming(map, true);
    }

    /**
     * Hide all clustering layers and empty their sources. Sources stay attached
     * for the lifetime of the map — see EMPTY_FC comment above and mapbox-gl-js
     * issues #2607, #4862, #5252.
     *
     * Idempotent: safe to call when sources/layers haven't been created yet.
     */
    function clearClustering() {
        const map = getMap();
        if (!map) return;

        // Mapbox-native cluster artefacts — hide layers, empty source
        _setLayerVisibility(map, MAPBOX_CLUSTER_COUNT,  false);
        _setLayerVisibility(map, MAPBOX_CLUSTER_CIRCLE, false);
        _emptySource(map, MAPBOX_CLUSTER_SOURCE);

        // MST/network line artefacts — hide layer, empty source
        _setLayerVisibility(map, CLUSTER_LINES_LAYER, false);
        _emptySource(map, CLUSTER_LINES_SOURCE);

        clusterLines.value = [];

        // Detach mapbox-mode click handler if present
        _detachClusterClickHandler(map);

        // Restore pin opacity
        _setPinDimming(map, false);
    }

    /**
     * Cleanup hook — call this from the host's `onBeforeUnmount`.
     * This is the ONLY place where sources/layers are physically removed.
     */
    function cleanup() {
        const map = getMap();
        if (map) {
            // Detach handlers first so removeLayer doesn't fire stale events
            _detachClusterClickHandler(map);

            if (map.getLayer(MAPBOX_CLUSTER_COUNT)) map.removeLayer(MAPBOX_CLUSTER_COUNT);
            if (map.getLayer(MAPBOX_CLUSTER_CIRCLE)) map.removeLayer(MAPBOX_CLUSTER_CIRCLE);
            if (map.getSource(MAPBOX_CLUSTER_SOURCE)) map.removeSource(MAPBOX_CLUSTER_SOURCE);

            if (map.getLayer(CLUSTER_LINES_LAYER)) map.removeLayer(CLUSTER_LINES_LAYER);
            if (map.getSource(CLUSTER_LINES_SOURCE)) map.removeSource(CLUSTER_LINES_SOURCE);

            _setPinDimming(map, false);
        }
        clusterLines.value = [];
        _clusterClickHandler = null;
    }

    /**
     * Toggle a layer's visibility without removing it. Safe no-op if the layer
     * doesn't exist yet.
     * @private
     */
    function _setLayerVisibility(map, layerId, visible) {
        if (!map.getLayer(layerId)) return;
        try {
            map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        } catch (_e) {
            // Style may be loading — safe to swallow
        }
    }

    /**
     * Replace a source's data with an empty FeatureCollection. Safe no-op if
     * the source doesn't exist yet.
     * @private
     */
    function _emptySource(map, sourceId) {
        const src = map.getSource(sourceId);
        if (src && typeof src.setData === 'function') {
            try { src.setData(EMPTY_FC); } catch (_e) { /* swallow */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Mode implementations
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Native Mapbox clustering — adds a parallel clustered source and three
     * layers (cluster circles, cluster counts, individual pins handled by
     * the host pin layer being dimmed but still rendered).
     *
     * Why a parallel source? The host pin source is shared with other layers
     * that don't want clustering. Adding a second source with `cluster: true`
     * keeps responsibilities separated.
     *
     * @param {Object} map
     * @private
     */
    function _applyMapboxClustering(map) {
        const peopleGroups = _filterBySelection(getPeopleGroups());
        if (!peopleGroups.length) return;

        const features = peopleGroups
            .map(pg => {
                const lng = parseFloat(pg.longitude ?? pg.lng);
                const lat = parseFloat(pg.latitude ?? pg.lat);
                if (isNaN(lng) || isNaN(lat)) return null;
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [lng, lat] },
                    properties: { ...(pg.properties || pg) }
                };
            })
            .filter(Boolean);

        const data = { type: 'FeatureCollection', features };

        // Reuse the existing source if it's already attached — setData avoids
        // the GL-backbuffer leak from add/removeSource churn.
        const existingSrc = map.getSource(MAPBOX_CLUSTER_SOURCE);
        if (existingSrc && typeof existingSrc.setData === 'function') {
            existingSrc.setData(data);
        } else {
            map.addSource(MAPBOX_CLUSTER_SOURCE, {
                type: 'geojson',
                data,
                ...DEFAULT_MAPBOX_CLUSTER_OPTIONS,
                ...mapboxClusterOptions
            });
        }

        // Add layers only if they don't yet exist; otherwise just unhide.
        if (!map.getLayer(MAPBOX_CLUSTER_CIRCLE)) {
            map.addLayer({
                id: MAPBOX_CLUSTER_CIRCLE,
                type: 'circle',
                source: MAPBOX_CLUSTER_SOURCE,
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': DEFAULT_CLUSTER_COLOR_RAMP,
                    'circle-radius': DEFAULT_CLUSTER_RADIUS_RAMP,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    // Bypass Standard v3 scene-lighting so cluster bubbles keep their ramp
                    // colour on the night preset instead of darkening (mirror useMapLayers.js:248).
                    ...emissivePaint(map),
                    'circle-opacity': 0.85
                }
            });
        } else {
            _setLayerVisibility(map, MAPBOX_CLUSTER_CIRCLE, true);
        }

        if (!map.getLayer(MAPBOX_CLUSTER_COUNT)) {
            map.addLayer({
                id: MAPBOX_CLUSTER_COUNT,
                type: 'symbol',
                source: MAPBOX_CLUSTER_SOURCE,
                filter: ['has', 'point_count'],
                layout: {
                    'text-field': ['get', 'point_count_abbreviated'],
                    // By engine: OpenFreeMap has no DIN, so under MapLibre every count was blank.
                    ...labelFont(map, { weight: 'medium', mapbox: ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'] }),
                    'text-size': 12
                },
                paint: { 'text-color': '#000000' }
            });
        } else {
            _setLayerVisibility(map, MAPBOX_CLUSTER_COUNT, true);
        }

        _attachClusterClickHandler(map);
    }

    /**
     * MST or network line clustering — adds a single GeoJSON line source +
     * line layer below the host pins.
     *
     * @param {Object} map
     * @param {'mst'|'network'} algorithm
     * @private
     */
    function _applyLineClustering(map, algorithm) {
        const peopleGroups = _filterBySelection(getPeopleGroups());
        if (!peopleGroups.length) return;

        const groups = groupBy(
            peopleGroups,
            pg => pg[groupKey] ?? pg._normalized?.[groupKey] ?? 'Unknown'
        );

        const colorFunc = typeof getGroupColor === 'function'
            ? getGroupColor
            : (() => '#666666');

        let lines = [];
        let stats = null;

        if (algorithm === 'mst') {
            lines = mstUtil.generateAllMSTLines(groups, colorFunc);
            // Not getMSTStats(): it recomputes every tree just for this log line (it doubled the work).
            stats = { totalGroups: Object.keys(groups).length };
        } else {
            lines = networkUtil.generateAllNetworkLines(groups, colorFunc);
            stats = networkUtil.getClusteringStats(groups);
        }

        clusterLines.value = lines;
        if (lines.length === 0) return;

        const data = { type: 'FeatureCollection', features: lines };

        // Reuse the line source across toggles — see EMPTY_FC comment.
        const existingSrc = map.getSource(CLUSTER_LINES_SOURCE);
        if (existingSrc && typeof existingSrc.setData === 'function') {
            existingSrc.setData(data);
        } else {
            map.addSource(CLUSTER_LINES_SOURCE, {
                type: 'geojson',
                data
            });
        }

        if (!map.getLayer(CLUSTER_LINES_LAYER)) {
            const layerConfig = {
                id: CLUSTER_LINES_LAYER,
                type: 'line',
                source: CLUSTER_LINES_SOURCE,
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#666666'],
                    'line-width': [
                        'interpolate', ['linear'], ['zoom'],
                        0, 0.5, 4, 0.75, 8, 1, 12, 1.5
                    ],
                    // Bypass Standard v3 scene-lighting so MST/network lines keep their colour
                    // on the night preset instead of darkening (mirror useMapLayers.js:248).
                    ...emissivePaint(map, 'line'),
                    'line-opacity': 0.5
                },
                layout: {
                    'line-cap': 'round',
                    'line-join': 'round'
                }
            };

            // Insert below the host pin layer so pins stay clickable on top.
            if (map.getLayer(pinLayerId)) {
                map.addLayer(layerConfig, pinLayerId);
            } else {
                map.addLayer(layerConfig);
            }
        } else {
            _setLayerVisibility(map, CLUSTER_LINES_LAYER, true);
        }

    }

    // ─────────────────────────────────────────────────────────────────────────
    // Mapbox-native cluster click — zoom to expansion zoom by default
    // ─────────────────────────────────────────────────────────────────────────

    function _attachClusterClickHandler(map) {
        if (!map.getLayer(MAPBOX_CLUSTER_CIRCLE)) return;

        map.on('click', MAPBOX_CLUSTER_CIRCLE, _handleClusterClick);
        map.on('mouseenter', MAPBOX_CLUSTER_CIRCLE, _setCursorPointer);
        map.on('mouseleave', MAPBOX_CLUSTER_CIRCLE, _setCursorDefault);
        _attachedClusterLayerId = MAPBOX_CLUSTER_CIRCLE;
    }

    function _detachClusterClickHandler(map) {
        if (!_attachedClusterLayerId) return;
        const layerId = _attachedClusterLayerId;
        try {
            map.off('click', layerId, _handleClusterClick);
            map.off('mouseenter', layerId, _setCursorPointer);
            map.off('mouseleave', layerId, _setCursorDefault);
        } catch (_e) {
            // Safe to swallow — Mapbox throws if the layer is already gone
        }
        _attachedClusterLayerId = null;
    }

    function _handleClusterClick(e) {
        const map = getMap();
        if (!map) return;

        const features = map.queryRenderedFeatures(e.point, { layers: [MAPBOX_CLUSTER_CIRCLE] });
        if (!features.length) return;

        const feature = features[0];
        const clusterId = feature.properties.cluster_id;
        const coordinates = feature.geometry.coordinates;
        const pointCount = feature.properties.point_count;

        // Custom handler takes precedence — let the host decide what to do.
        if (typeof _clusterClickHandler === 'function') {
            _clusterClickHandler({
                clusterId,
                coordinates,
                pointCount,
                originalEvent: e
            });
            return;
        }

        // Default behavior — zoom to cluster expansion zoom.
        const source = map.getSource(MAPBOX_CLUSTER_SOURCE);
        if (!source || typeof source.getClusterExpansionZoom !== 'function') return;

        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            map.easeTo({ center: coordinates, zoom });
        });
    }

    function _setCursorPointer() {
        const map = getMap();
        if (map) map.getCanvas().style.cursor = 'pointer';
    }

    function _setCursorDefault() {
        const map = getMap();
        if (map) map.getCanvas().style.cursor = '';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pin opacity dimming
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Dim the host pin layer when clustering is active so clusters take
     * visual precedence. Restores opacity 0.9 when clustering is off.
     *
     * Safe no-op when the host pin layer hasn't been added yet.
     *
     * @param {Object}  map
     * @param {boolean} dim
     * @private
     */
    function _setPinDimming(map, dim) {
        if (!map.getLayer(pinLayerId)) return;
        try {
            map.setPaintProperty(pinLayerId, 'circle-opacity', dim ? 0.25 : 0.9);
        } catch (_e) {
            // Layer may have been removed mid-toggle — safe to swallow
        }
    }

    return {
        // State
        enabled,
        mode,
        clusterLines,

        // Setters
        setMode,
        setEnabled,
        setSelectionFilter,

        // Click handler registration
        onClusterClick,

        // Lifecycle
        applyClustering,
        clearClustering,
        cleanup,

        // Algorithm utilities (exposed for testing / advanced use)
        mstUtil,
        networkUtil
    };
}

export default useMapClustering;
