/**
 * NetworkClusteringUtil.js
 *
 * Reusable utility for generating network cluster lines using a
 * nearest-neighbor algorithm. Creates a denser shard/gem visual effect
 * than MST. NOT a true Minimum Spanning Tree.
 *
 * Algorithm:
 *  1. Sort points by `sortKey` (longitude or latitude)
 *  2. For each point, connect to the next N neighbors within `maxDistance`
 *  3. Three-pass orphan rescue: connect orphans to nearest connected point;
 *     remaining orphans connect to each other
 *  4. O(n log n) overall (sort dominates)
 *
 * Use this when you want visible web-like clusters (every point feels
 * "embedded" in its group). Use MSTClusteringUtil when you want a clean
 * tree with no redundant edges.
 *
 * Ported verbatim from the upstream NetworkClusteringUtil module (~393 lines)
 * to the the upstream template. No external deps beyond ES2020.
 *
 * @module utils/NetworkClusteringUtil
 */

import { euclideanDistance } from './ClusterHelpers.js';

/**
 * @typedef {Object} GeoPoint
 * @property {number|string} latitude
 * @property {number|string} longitude
 */

/**
 * @typedef {Object} NetworkOptions
 * @property {number}  [maxDistance]      - Max edge length in degrees (default: 15)
 * @property {number}  [maxNeighbors]     - Max neighbors per point (default: 15)
 * @property {string}  [sortKey]          - 'longitude' or 'latitude' (default: 'longitude')
 * @property {boolean} [connectOrphans]   - Run orphan-rescue passes (default: true)
 */

/**
 * @typedef {Object} NetworkGroupResult
 * @property {Array<Object>} lines
 * @property {number}        count
 * @property {number}        pointCount
 */

/**
 * Nearest-neighbor network clustering utility.
 *
 * @example
 *   const util = new NetworkClusteringUtil({ maxDistance: 12, maxNeighbors: 8 });
 *   const lines = util.generateNetworkLines(points);
 */
export class NetworkClusteringUtil {
    /**
     * @param {NetworkOptions} [options]
     */
    constructor(options = {}) {
        this.maxDistance = options.maxDistance ?? 15;
        this.maxNeighbors = options.maxNeighbors ?? 15;
        this.sortKey = options.sortKey ?? 'longitude';
    }

    /**
     * Calculate Euclidean distance in degrees.
     * @private
     */
    _calculateDistance(lat1, lng1, lat2, lng2) {
        return euclideanDistance(lat1, lng1, lat2, lng2);
    }

    /**
     * Generate network lines for a single point group.
     *
     * @param {GeoPoint[]} points
     * @param {NetworkOptions} [options]
     * @returns {Array<Object>} GeoJSON LineString features
     */
    generateNetworkLines(points, options = {}) {
        const maxDistance    = options.maxDistance    ?? this.maxDistance;
        const maxNeighbors   = options.maxNeighbors   ?? this.maxNeighbors;
        const sortKey        = options.sortKey        ?? this.sortKey;
        const connectOrphans = options.connectOrphans ?? true;

        if (!points || points.length < 2) return [];

        const validPoints = points.filter(p => {
            const lat = parseFloat(p.latitude);
            const lng = parseFloat(p.longitude);
            return !isNaN(lat) && !isNaN(lng);
        });

        if (validPoints.length < 2) return [];

        const lineFeatures = [];
        const connectedPoints = new Set();

        const sorted = [...validPoints].sort((a, b) => {
            return parseFloat(a[sortKey]) - parseFloat(b[sortKey]);
        });

        // PASS 1 — connect each point to next N neighbors (shard effect)
        for (let i = 0; i < sorted.length; i++) {
            const current = sorted[i];
            const currentLat = parseFloat(current.latitude);
            const currentLng = parseFloat(current.longitude);
            const endIndex = Math.min(i + 1 + maxNeighbors, sorted.length);

            for (let j = i + 1; j < endIndex; j++) {
                const other = sorted[j];
                const otherLat = parseFloat(other.latitude);
                const otherLng = parseFloat(other.longitude);

                const distance = this._calculateDistance(currentLat, currentLng, otherLat, otherLng);

                if (distance < maxDistance) {
                    lineFeatures.push({
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [currentLng, currentLat],
                                [otherLng, otherLat]
                            ]
                        },
                        properties: { distance, type: 'normal' }
                    });
                    connectedPoints.add(i);
                    connectedPoints.add(j);
                }
            }
        }

        // PASS 2 — orphan-to-connected rescue
        if (connectOrphans) {
            for (let i = 0; i < sorted.length; i++) {
                if (connectedPoints.has(i)) continue;

                const orphan = sorted[i];
                const orphanLat = parseFloat(orphan.latitude);
                const orphanLng = parseFloat(orphan.longitude);

                let nearestIdx = -1;
                let nearestDist = Infinity;

                for (let j = 0; j < sorted.length; j++) {
                    if (i === j) continue;
                    if (!connectedPoints.has(j)) continue;

                    const other = sorted[j];
                    const otherLat = parseFloat(other.latitude);
                    const otherLng = parseFloat(other.longitude);

                    const distance = this._calculateDistance(orphanLat, orphanLng, otherLat, otherLng);
                    if (distance < nearestDist) {
                        nearestDist = distance;
                        nearestIdx = j;
                    }
                }

                if (nearestIdx !== -1) {
                    const nearest = sorted[nearestIdx];
                    lineFeatures.push({
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [orphanLng, orphanLat],
                                [parseFloat(nearest.longitude), parseFloat(nearest.latitude)]
                            ]
                        },
                        properties: { distance: nearestDist, type: 'orphan-connector' }
                    });
                    connectedPoints.add(i);
                }
            }

            // PASS 3 — remaining orphans connect to nearest of any kind
            const remainingOrphans = [];
            for (let i = 0; i < sorted.length; i++) {
                if (!connectedPoints.has(i)) remainingOrphans.push(i);
            }

            for (const orphanIdx of remainingOrphans) {
                const orphan = sorted[orphanIdx];
                const orphanLat = parseFloat(orphan.latitude);
                const orphanLng = parseFloat(orphan.longitude);

                let nearestIdx = -1;
                let nearestDist = Infinity;

                for (let j = 0; j < sorted.length; j++) {
                    if (orphanIdx === j) continue;

                    const other = sorted[j];
                    const otherLat = parseFloat(other.latitude);
                    const otherLng = parseFloat(other.longitude);

                    const distance = this._calculateDistance(orphanLat, orphanLng, otherLat, otherLng);
                    if (distance < nearestDist) {
                        nearestDist = distance;
                        nearestIdx = j;
                    }
                }

                if (nearestIdx !== -1) {
                    const nearest = sorted[nearestIdx];
                    lineFeatures.push({
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [orphanLng, orphanLat],
                                [parseFloat(nearest.longitude), parseFloat(nearest.latitude)]
                            ]
                        },
                        properties: { distance: nearestDist, type: 'orphan-to-orphan' }
                    });
                    connectedPoints.add(orphanIdx);
                }
            }
        }

        return lineFeatures;
    }

    /**
     * Generate network lines for multiple groups, processed largest-first.
     *
     * @param {Object<string, GeoPoint[]>} groups
     * @param {(groupName: string) => string|null} [colorFunc]
     * @param {NetworkOptions} [options]
     * @returns {Object<string, NetworkGroupResult>}
     */
    generateMultiGroupNetworkLines(groups, colorFunc = null, options = {}) {
        const results = {};

        const sortedGroupNames = Object.keys(groups).sort(
            (a, b) => groups[b].length - groups[a].length
        );

        for (const groupName of sortedGroupNames) {
            const points = groups[groupName];

            if (!points || points.length < 2) {
                results[groupName] = { lines: [], count: 0, pointCount: points?.length || 0 };
                continue;
            }

            const lines = this.generateNetworkLines(points, options);

            if (typeof colorFunc === 'function') {
                const color = colorFunc(groupName);
                lines.forEach(line => {
                    line.properties = { ...line.properties, group: groupName, color };
                });
            } else {
                lines.forEach(line => {
                    line.properties = { ...line.properties, group: groupName };
                });
            }

            results[groupName] = {
                lines,
                count: lines.length,
                pointCount: points.length
            };
        }

        return results;
    }

    /**
     * Flatten multi-group network results into a single feature array.
     *
     * @param {Object<string, GeoPoint[]>} groups
     * @param {(groupName: string) => string|null} [colorFunc]
     * @param {NetworkOptions} [options]
     * @returns {Array<Object>}
     */
    generateAllNetworkLines(groups, colorFunc = null, options = {}) {
        const multiResult = this.generateMultiGroupNetworkLines(groups, colorFunc, options);
        const allLines = [];
        for (const groupName in multiResult) {
            allLines.push(...multiResult[groupName].lines);
        }
        return allLines;
    }

    /**
     * Compute clustering statistics (debug/logging aid).
     *
     * @param {Object<string, GeoPoint[]>} groups
     * @param {NetworkOptions} [options]
     * @returns {Object}
     */
    getClusteringStats(groups, options = {}) {
        const multiResult = this.generateMultiGroupNetworkLines(groups, null, options);

        let totalLines = 0;
        let totalPoints = 0;
        const groupStats = [];

        for (const groupName in multiResult) {
            const { lines, pointCount } = multiResult[groupName];
            totalLines += lines.length;
            totalPoints += pointCount;
            groupStats.push({
                name: groupName,
                points: pointCount,
                lines: lines.length,
                ratio: pointCount > 0 ? (lines.length / pointCount).toFixed(2) : 0
            });
        }

        groupStats.sort((a, b) => b.points - a.points);

        return {
            algorithm: 'Network (nearest-neighbor)',
            totalGroups: Object.keys(groups).length,
            totalPoints,
            totalLines,
            avgLinesPerPoint: totalPoints > 0 ? (totalLines / totalPoints).toFixed(2) : 0,
            groups: groupStats
        };
    }
}

/**
 * Default network clustering instance with standard settings.
 * @type {NetworkClusteringUtil}
 */
export const defaultNetworkClustering = new NetworkClusteringUtil({
    maxDistance: 15,
    maxNeighbors: 15,
    sortKey: 'longitude'
});

export default NetworkClusteringUtil;
