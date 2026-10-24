/**
 * ClusterHelpers.js — Pure helpers shared across clustering modes.
 *
 * Mode-agnostic geometric helpers used by:
 *  - useMapClustering.js (composable)
 *  - MSTClusteringUtil.js (Kruskal MST)
 *  - NetworkClusteringUtil.js (nearest-neighbor)
 *
 * Convex hull is extracted from the upstream PolygonClusteringFeature module.
 * Centroid + distance helpers are extracted to avoid duplication across the
 * clustering modules.
 *
 * No external deps. Browser-safe ES module.
 *
 * @module utils/ClusterHelpers
 */

/**
 * @typedef {[number, number]} LngLat
 */

/**
 * @typedef {Object} GeoPoint
 * @property {number|string} latitude
 * @property {number|string} longitude
 */

/**
 * Euclidean distance in degree-space between two (lat,lng) pairs.
 * Fast and good enough for visualization at world scale; do NOT use for
 * great-circle navigation.
 *
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} distance in degrees
 */
export function euclideanDistance(lat1, lng1, lat2, lng2) {
    const a = parseFloat(lng1) - parseFloat(lng2);
    const b = parseFloat(lat1) - parseFloat(lat2);
    return Math.sqrt(a * a + b * b);
}

/**
 * Distance between two GeoPoint objects using `latitude`/`longitude` props.
 *
 * @param {GeoPoint} p1
 * @param {GeoPoint} p2
 * @returns {number} distance in degrees
 */
export function pointDistance(p1, p2) {
    return euclideanDistance(
        parseFloat(p1.latitude),
        parseFloat(p1.longitude),
        parseFloat(p2.latitude),
        parseFloat(p2.longitude)
    );
}

/**
 * Centroid (arithmetic mean) of an array of GeoPoints.
 * Returns [lng, lat] suitable for use as a Mapbox cluster anchor.
 *
 * @param {GeoPoint[]} points
 * @returns {LngLat} [lng, lat] — defaults to [0, 0] for empty input
 */
export function pointsCentroid(points) {
    if (!points?.length) return [0, 0];
    let sumLng = 0;
    let sumLat = 0;
    let n = 0;
    for (const p of points) {
        const lng = parseFloat(p.longitude);
        const lat = parseFloat(p.latitude);
        if (isNaN(lng) || isNaN(lat)) continue;
        sumLng += lng;
        sumLat += lat;
        n++;
    }
    if (n === 0) return [0, 0];
    return [sumLng / n, sumLat / n];
}

/**
 * Cross product of vectors OA × OB (2D z-component).
 * Positive → counter-clockwise turn. Negative → clockwise.
 *
 * @param {LngLat} o
 * @param {LngLat} a
 * @param {LngLat} b
 * @returns {number}
 */
export function crossProduct(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Convex hull via Graham scan. Useful for polygon-style cluster wrappers.
 * Mutates `points` order — pass a copy if that matters.
 *
 * Returns an open ring (first point NOT repeated as last). For Mapbox Polygon
 * geometry, append `hull[0]` to close the ring before adding to the source.
 *
 * @param {LngLat[]} points
 * @returns {LngLat[]} hull points in counter-clockwise order
 */
export function convexHull(points) {
    if (points.length < 3) return points;

    let lowest = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i][1] < points[lowest][1] ||
            (points[i][1] === points[lowest][1] && points[i][0] < points[lowest][0])) {
            lowest = i;
        }
    }

    [points[0], points[lowest]] = [points[lowest], points[0]];
    const pivot = points[0];

    const sorted = points.slice(1).sort((a, b) => {
        const angleA = Math.atan2(a[1] - pivot[1], a[0] - pivot[0]);
        const angleB = Math.atan2(b[1] - pivot[1], b[0] - pivot[0]);
        if (angleA !== angleB) return angleA - angleB;
        const distA = (a[0] - pivot[0]) ** 2 + (a[1] - pivot[1]) ** 2;
        const distB = (b[0] - pivot[0]) ** 2 + (b[1] - pivot[1]) ** 2;
        return distA - distB;
    });

    const hull = [pivot];
    for (const point of sorted) {
        while (hull.length > 1 &&
               crossProduct(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
            hull.pop();
        }
        hull.push(point);
    }

    return hull;
}

/**
 * Group an array of records by a derived key.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyFn
 * @returns {Object<string, T[]>}
 *
 * @example
 *   const groups = groupBy(peopleGroups, pg => pg.languageFamily ?? 'Unknown');
 */
export function groupBy(items, keyFn) {
    const out = {};
    for (const item of items) {
        const key = keyFn(item);
        if (!out[key]) out[key] = [];
        out[key].push(item);
    }
    return out;
}

/**
 * Coerce a record's lat/lng to numbers and validate.
 * Returns null if either coordinate is missing or NaN.
 *
 * @param {GeoPoint} p
 * @returns {{lat: number, lng: number}|null}
 */
export function toLatLng(p) {
    if (!p) return null;
    const lat = parseFloat(p.latitude);
    const lng = parseFloat(p.longitude);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
}

/**
 * Build a GeoJSON LineString feature from two GeoPoints with optional props.
 *
 * @param {GeoPoint} from
 * @param {GeoPoint} to
 * @param {Object}  [properties]
 * @returns {Object|null} GeoJSON Feature or null if either point is invalid
 */
export function makeLineFeature(from, to, properties = {}) {
    const a = toLatLng(from);
    const b = toLatLng(to);
    if (!a || !b) return null;
    return {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: [[a.lng, a.lat], [b.lng, b.lat]]
        },
        properties
    };
}

/**
 * Default Mapbox cluster source options. Used by useMapClustering's 'mapbox'
 * mode. Tuned for the typical 1k–20k people-group dataset.
 *
 * @type {{cluster: boolean, clusterMaxZoom: number, clusterRadius: number}}
 */
// clusterMaxZoom MUST sit a few levels below the research map's zoom-in cap
// (RESEARCH_MAX_ZOOM = 10 in research-map.vue). At 14 it was above the cap, so
// clusters never broke apart and overlapping pins stayed permanently un-clickable
// (COMMIT-LOG #8). At 6 pins decluster well before the user hits the limit, and the
// tighter radius (40) lets dense areas like South Asia separate instead of merging.
export const DEFAULT_MAPBOX_CLUSTER_OPTIONS = Object.freeze({
    cluster: true,
    clusterMaxZoom: 6,
    clusterRadius: 40
});

/**
 * Default cluster color ramp (count-based step expression). Matches the
 * worked example in documentation/mapbox/clustering.md.
 *
 * @type {Array}
 */
export const DEFAULT_CLUSTER_COLOR_RAMP = Object.freeze([
    'step', ['get', 'point_count'],
    '#51bbd6',
    10,  '#f1f075',
    50,  '#f28cb1',
    500, '#e74c3c'
]);

/**
 * Default cluster radius ramp (count-based step expression).
 *
 * @type {Array}
 */
export const DEFAULT_CLUSTER_RADIUS_RAMP = Object.freeze([
    'step', ['get', 'point_count'],
    15,
    10, 20,
    50, 25,
    500, 35
]);
