// useMapFly.js - Map Navigation/Fly Composable
// Handles smooth map navigation with fly animations
// Vue 3 Composition API - ES Module with NPM packages

// Import Vue functions from NPM package
import { ref, computed } from 'vue';
import { readSourceFeatures, matchesExpression, resolveExpr } from '../maps/pin-selection.js';

// Import zoom configuration (region zoom settings are in zoom.js)
import { getRegionZoomConfig, REGION_ZOOM_CONFIG } from '../constants/zoom.js';
// Import map configuration for initial view defaults
import { mapDefaults } from '../constants/mapDefaults.js';

/**
 * useMapFly composable - manages smooth map navigation
 *
 * Includes:
 * - flyTo(center, options)
 * - flyToCoords({ longitude, latitude }, zoom?, options?)
 * - fitBounds(bounds, padding?)
 * - slowFlyToFamily / slowFlyToRegion (domain-aware helpers used by legend clicks)
 * - getOffsetCenter — shifts map center to account for a UI panel overlay
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.getMap - Function that returns the map instance
 * @param {string} options.mapId - Unique map identifier for logging
 * @param {Object} options.mapStore - Pinia mapStore for shared state
 * @param {Object} options.regionsGeoData - Regions geo data with polygon features
 * @param {Array}  options.defaultCenter - [lng, lat] used by resetView()
 * @param {number} options.defaultZoom   - Zoom for resetView()
 *
 * @returns {Object} Fly navigation functions
 */
export function useMapFly(options = {}) {
    const {
        getMap = () => null,
        mapId = 'unknown',
        mapStore = null,
        regionsGeoData = null,
        defaultCenter = mapDefaults?.center || [20, 10],
        defaultZoom   = mapDefaults?.zoom   || 2
    } = options;

    // ★ REDUCED MOTION IS DECIDED HERE, NOT BY EACH CALLER (2026-09-26). A reader who asks the OS for
    // reduced motion (prefers-reduced-motion: reduce) gets every camera move in this composable as an
    // instant jump. Callers used to pass { duration: 0 } themselves, and flyToCoords took no options, so
    // theirs was silently dropped and the map still flew: a photosensitivity issue, not a style choice.
    // Every animated call below goes through cam(map), so no caller can miss it.
    const prefersReducedMotion = () => {
        try { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch { return false; }
    };
    function cam(map) {
        const still = prefersReducedMotion();
        const jump = (o = {}) => {
            const view = {};
            for (const k of ['center', 'zoom', 'bearing', 'pitch', 'padding']) if (o[k] !== undefined) view[k] = o[k];
            return map.jumpTo(view);
        };
        return {
            flyTo:     (o) => (still ? jump(o) : map.flyTo(o)),
            easeTo:    (o) => (still ? jump(o) : map.easeTo(o)),
            fitBounds: (b, o = {}) => map.fitBounds(b, still ? { ...o, animate: false, duration: 0 } : o),
        };
    }

    // Default fly animation configuration
    const FLY_CONFIG = {
        speed: 0.5,          // Slow fly speed
        essential: true,
        curve: 1.2
    };

    /**
     * Calculate center with offset accounting for UI overlays
     * This prevents the map center from being hidden behind sidebars/panels
     *
     * @param {Array} center - [lng, lat] coordinates
     * @param {number} zoom - Target zoom level
     * @param {Object} offsetOptions - Pixel offsets {x, y}
     * @returns {Array} Adjusted [lng, lat] center
     */
    function getOffsetCenter(center, zoom, offsetOptions = { x: 150, y: 0 }) {
        const map = getMap();
        if (!map) return center;

        try {
            // Get canvas dimensions
            const canvas = map.getCanvas();
            const width = canvas.width;
            const height = canvas.height;

            // Project center to pixels
            const projected = map.project(center);

            // Calculate meters per pixel at this zoom
            // Account for device pixel ratio
            const dpr = window.devicePixelRatio || 1;

            // Apply offset (typically shift left to account for right sidebar)
            const offsetX = (offsetOptions.x || 0) * dpr;
            const offsetY = (offsetOptions.y || 0) * dpr;

            // Create offset point
            const offsetPoint = {
                x: projected.x - offsetX,
                y: projected.y - offsetY
            };

            // Unproject back to coordinates
            const newCenter = map.unproject(offsetPoint);

            return [newCenter.lng, newCenter.lat];
        } catch (error) {
            return center;
        }
    }

    /**
     * Slow fly animation to a language family's centroid
     * Uses family data to calculate center and zoom
     *
     * @param {string} familyName - Name of the language family
     * @param {Array} peopleGroups - People groups data (optional, for calculating bounds)
     */
    function slowFlyToFamily(familyName, peopleGroups = []) {
        const map = getMap();
        if (!map) {
            return;
        }

        // Try to get family data from mapStore or calculate from people groups
        let center = null;
        let zoom = 5;

        // Calculate centroid from people groups matching this family
        const familyGroups = peopleGroups.filter(pg => pg.languageFamily === familyName);

        if (familyGroups.length > 0) {
            // Calculate bounding box and center
            let minLng = Infinity, maxLng = -Infinity;
            let minLat = Infinity, maxLat = -Infinity;

            familyGroups.forEach(pg => {
                if (pg.longitude && pg.latitude) {
                    minLng = Math.min(minLng, pg.longitude);
                    maxLng = Math.max(maxLng, pg.longitude);
                    minLat = Math.min(minLat, pg.latitude);
                    maxLat = Math.max(maxLat, pg.latitude);
                }
            });

            if (minLng !== Infinity) {
                center = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];

                // Calculate zoom based on extent
                const lngSpan = maxLng - minLng;
                const latSpan = maxLat - minLat;
                const maxSpan = Math.max(lngSpan, latSpan);

                // Rough zoom calculation
                if (maxSpan > 50) zoom = 2;
                else if (maxSpan > 20) zoom = 3;
                else if (maxSpan > 10) zoom = 4;
                else if (maxSpan > 5) zoom = 5;
                else zoom = 6;
            }
        }

        if (!center) {
            return;
        }

        // Apply offset to account for UI panels
        const offsetCenter = getOffsetCenter(center, zoom);


        cam(map).flyTo({
            center: offsetCenter,
            zoom: zoom,
            ...FLY_CONFIG
        });
    }

    /**
     * Slow fly animation to a region
     * Uses region config or calculates from polygon data
     *
     * @param {string} regionName - Name of the region
     */
    function slowFlyToRegion(regionName) {
        const map = getMap();
        if (!map) {
            return;
        }

        // First check REGION_ZOOM_CONFIG from zoom.js for region zoom settings
        let center = null;
        let zoom = 4;

        const regionConfig = getRegionZoomConfig(regionName);
        if (regionConfig) {
            center = regionConfig.center;
            zoom = regionConfig.zoom || 4;
        } else if (regionsGeoData?.features) {
            // Calculate center from polygon data
            const regionFeature = regionsGeoData.features.find(
                f => f.properties?.region === regionName || f.properties?.name === regionName
            );

            if (regionFeature) {
                center = calculateRegionCenterFromPolygon(regionFeature);
            }
        }

        if (!center) {
            return;
        }

        // Apply offset to account for UI panels
        const offsetCenter = getOffsetCenter(center, zoom);


        cam(map).flyTo({
            center: offsetCenter,
            zoom: zoom,
            ...FLY_CONFIG
        });
    }

    /**
     * Calculate center point from a GeoJSON polygon feature
     *
     * @param {Object} feature - GeoJSON feature
     * @returns {Array|null} [lng, lat] center or null
     */
    function calculateRegionCenterFromPolygon(feature) {
        if (!feature || !feature.geometry) return null;

        const { type, coordinates } = feature.geometry;
        let allCoords = [];

        if (type === 'Polygon') {
            allCoords = coordinates[0] || [];
        } else if (type === 'MultiPolygon') {
            coordinates.forEach(polygon => {
                allCoords = allCoords.concat(polygon[0] || []);
            });
        }

        if (allCoords.length === 0) return null;

        // Calculate centroid
        let sumLng = 0, sumLat = 0;
        allCoords.forEach(coord => {
            sumLng += coord[0];
            sumLat += coord[1];
        });

        return [sumLng / allCoords.length, sumLat / allCoords.length];
    }

    /**
     * Fly to specific coordinates with options
     *
     * @param {Array} center - [lng, lat] coordinates
     * @param {Object} flyOptions - Fly animation options
     */
    function flyTo(center, flyOptions = {}) {
        const map = getMap();
        if (!map) return;

        const options = {
            center,
            ...FLY_CONFIG,
            ...flyOptions
        };

        cam(map).flyTo(options);
    }

    /**
     * Fly to a { longitude, latitude } object (e.g. a people group record).
     * @param {Object} coords   - { longitude, latitude }
     * @param {number} [zoom]   - Target zoom (defaults to current zoom + 2)
     */
    function flyToCoords(coords, zoom, flyOptions = {}) {
        const map = getMap();
        if (!map || coords?.longitude == null || coords?.latitude == null) return;
        const targetZoom = zoom ?? Math.min(map.getZoom() + 2, 8);
        // Caller options (e.g. { duration: 0 }) are honoured; they used to be dropped (no third argument).
        flyTo([coords.longitude, coords.latitude], { ...flyOptions, zoom: targetZoom });
    }

    /**
     * Fit the map to a LngLatBounds (e.g. to frame a region polygon).
     * @param {mapboxgl.LngLatBounds} bounds
     * @param {Object} [padding]  - { top, right, bottom, left } in px
     */
    function fitBounds(bounds, padding = { top: 40, right: 40, bottom: 40, left: 40 }, options = {}) {
        const map = getMap();
        if (!map || !bounds) return;
        // maxZoom defaults to 4 (continent-scale framing). Caller can override.
        const maxZoom = options.maxZoom ?? 4;
        // ★ fitBounds NEEDS `duration`; FLY_CONFIG alone leaves it INSTANT (2026-09-23).
        // FLY_CONFIG carries `speed` and `curve`, which flyTo understands and fitBounds IGNORES —
        // so this call looked animated and was a hard cut. MEASURED in the cap-4: selecting a row
        // moved the camera 1.45 -> 6 with only TWO distinct zoom values across 14 samples over
        // ~1.7s, where an eased move shows a curve of intermediates. That is why transitions
        // read as snappy rather than smooth, and it is specific to fitBounds: the flyTo
        // paths in this same file were always eased.
        //
        // 900ms matches the feel of the flyTo paths at speed 0.5 without making a selection feel
        // sluggish. `options` still spreads LAST, so an accessibility caller passing `duration: 0`
        // still jumps — that path is unchanged and is why the default lives here rather than in
        // FLY_CONFIG, which is shared with callers that must not inherit it.
        const duration = options.duration ?? 900;
        // `options` is spread LAST so a caller can override any animation field — notably
        // `duration: 0`, which an accessibility path needs in order to JUMP instead of ease
        // for prefers-reduced-motion users. Previously only `maxZoom` was read and every
        // other caller option was silently dropped, so a reduced-motion caller still got
        // FLY_CONFIG's easing. Passing no options is byte-for-byte the previous behaviour.
        cam(map).fitBounds(bounds, { padding, maxZoom, duration, ...FLY_CONFIG, ...options });
    }

    /**
     * Reset map to initial view
     */
    function resetView() {
        const map = getMap();
        if (!map) return;

        cam(map).flyTo({
            center: defaultCenter,
            zoom: defaultZoom,
            ...FLY_CONFIG
        });
    }

    // Uniform legend-row camera constants. Single source of truth for how
    // tight a row-click zooms — keep these conservative so even sparse rows
    // (single pin, single country) don't slam the camera into street-level.
    const LEGEND_FIT_PADDING_PX = 80;
    const LEGEND_FIT_DURATION_MS = 800;
    const LEGEND_FIT_MAX_ZOOM = 5;
    const LEGEND_SINGLE_PIN_ZOOM = 5;
    // Globe-FILLING selections (e.g. "Islam" reaches every continent, span ~134°):
    // a longitude span this wide can't be framed tightly without the camera
    // animating the wrong way around the antimeridian (the snap). Past this
    // threshold we ease to a stable world overview instead of a literal fitBounds.
    // 110° is tuned from live data: catches Islam (134°) / Ethnoreligion (198°) /
    // Europe (107°) but leaves every real continent a tight fit (Oceania 76°,
    // Middle East 67°, Africa 58°, Asia 51°).
    const LEGEND_WIDE_SPAN_DEG = 110;
    const LEGEND_WORLD_ZOOM = 1.2;

    // Antimeridian-aware longitude span. For scopes that cross ±180° (Oceania,
    // east-Russia, Aleutians), naive min/max returns a span of ~360° because
    // points sit at -179 and +179. Re-project longitudes into [0, 360) and
    // recompute; pick the smaller span. Returns { minLng, maxLng } in the
    // representation that yields the tighter bbox. Caller must accept that
    // maxLng can exceed 180 — Mapbox's fitBounds accepts that and wraps.
    function _tightLngBounds(longitudes) {
        if (!longitudes.length) return null;
        let aMin = Infinity, aMax = -Infinity; // raw [-180, 180]
        let bMin = Infinity, bMax = -Infinity; // shifted [0, 360)
        for (const lng of longitudes) {
            if (!Number.isFinite(lng)) continue;
            if (lng < aMin) aMin = lng;
            if (lng > aMax) aMax = lng;
            const shifted = lng < 0 ? lng + 360 : lng;
            if (shifted < bMin) bMin = shifted;
            if (shifted > bMax) bMax = shifted;
        }
        if (!Number.isFinite(aMin)) return null;
        const spanA = aMax - aMin;
        const spanB = bMax - bMin;
        if (spanB < spanA) {
            // The cross-antimeridian representation is tighter. Convert back
            // to fitBounds-friendly form: keep minLng in [-180,180] and let
            // maxLng exceed 180 (Mapbox wraps it correctly).
            const minRaw = bMin > 180 ? bMin - 360 : bMin;
            return { minLng: minRaw, maxLng: minRaw + spanB };
        }
        return { minLng: aMin, maxLng: aMax };
    }

    // Robust, antimeridian-safe longitude extent + a STABLE deterministic center.
    // A circular (atan2) mean is DEGENERATE for near-global sets: the unit vectors
    // cancel, so the center collapses to an arbitrary angle and the camera "doesn't
    // know where to zoom" (janky ease). Instead:
    //   1) unwrap at the largest circular gap so a wrapping set becomes contiguous;
    //   2) trim ~2.5% off each tail so a few far outliers (e.g. a "Europe" polygon's
    //      far-east-Russia tail) don't blow up the extent — lets the dense cluster
    //      frame tightly;
    //   3) center = midpoint of the TRIMMED range → deterministic + stable, even for
    //      globe-spanning sets, so the world-overview ease always lands predictably.
    function _robustLngExtent(lngs) {
        const xs = lngs.filter(Number.isFinite).slice().sort((a, b) => a - b);
        const n = xs.length;
        if (!n) return null;
        let gap = -1, gapIdx = 0;
        for (let i = 0; i < n; i++) {
            const next = (i + 1 < n) ? xs[i + 1] : xs[0] + 360;
            const g = next - xs[i];
            if (g > gap) { gap = g; gapIdx = i; }
        }
        const start = (gapIdx + 1) % n;
        const u = new Array(n);
        for (let k = 0; k < n; k++) {
            let v = xs[(start + k) % n];
            if (k > 0 && v < u[k - 1]) v += 360;     // single unwrap across the seam
            u[k] = v;
        }
        const loI = Math.floor(n * 0.025);
        const hiI = Math.max(loI, Math.ceil(n * 0.975) - 1);
        const lo = u[loI], hi = u[hiI];
        const norm = (x) => (((x + 180) % 360) + 360) % 360 - 180;
        const minLng = norm(lo);
        // World-overview center = the DENSEST longitude bin (24 × 15°), not the
        // trimmed midpoint: a wide set whose mass is in real Europe but whose extent
        // is dragged east by a far-east-Russia tail would otherwise center mid-Asia.
        // Densest-bin centers on where the data actually concentrates — deterministic
        // and stable (no degenerate circular-mean wobble).
        const BINS = 24, size = 360 / BINS;
        const counts = new Array(BINS).fill(0);
        for (const x of xs) { let b = Math.floor(((((x + 180) % 360) + 360) % 360) / size); if (b >= BINS) b = BINS - 1; counts[b]++; }
        let bb = 0; for (let i = 1; i < BINS; i++) if (counts[i] > counts[bb]) bb = i;
        const center = norm(-180 + (bb + 0.5) * size);
        return { center, minLng, maxLng: minLng + (hi - lo), span: hi - lo };
    }

    // Zoom at which exactly ONE world fills the viewport width (worldPx = 512·2^z).
    // The basemap keeps renderWorldCopies:true, so going BELOW this reveals repeated
    // world copies. Clamp to the map's own min so we never request out of range.
    function _noCopyZoom(map) {
        try {
            const W = (map.getContainer && map.getContainer().clientWidth) || 0;
            const nz = W > 0 ? Math.log2(W / 512) : LEGEND_WORLD_ZOOM;
            const mn = typeof map.getMinZoom === 'function' ? map.getMinZoom() : nz;
            return Math.max(mn, nz);
        } catch (_) { return LEGEND_WORLD_ZOOM; }
    }

    // Smoothly ease to a stable WORLD OVERVIEW for a selection too wide to frame
    // without showing repeated world copies — globe-spanning rows ("Islam"), wide
    // region polygons ("Europe" reaching into Russia), or any set whose fitBounds
    // would clamp at/below the no-copy floor. Center = wrap-safe circular mean of
    // longitudes; zoom = one-world-fills-width; easeTo (NOT flyTo) so the camera
    // never arcs out past the floor and flashes the copies.
    function _easeWorldOverview(map, centerLng, minLat, maxLat) {
        cam(map).easeTo({
            center: [centerLng, (minLat + maxLat) / 2],
            zoom: _noCopyZoom(map),
            duration: LEGEND_FIT_DURATION_MS,
            essential: true
        });
    }

    // True when an extent is too wide to frame above the no-copy floor — i.e.
    // fitBounds would clamp and/or wrap the wrong way (the snap). Fast path on the
    // longitude span, precise check via viewport-aware cameraForBounds.
    function _tooWideToFit(map, bounds, span) {
        if (span > LEGEND_WIDE_SPAN_DEG) return true;
        try {
            const probe = typeof map.cameraForBounds === 'function'
                ? map.cameraForBounds(bounds, { padding: LEGEND_FIT_PADDING_PX, maxZoom: LEGEND_FIT_MAX_ZOOM })
                : null;
            if (probe == null) return true;
            return typeof probe.zoom === 'number' && probe.zoom <= _noCopyZoom(map) + 0.05;
        } catch (_) { return false; }
    }

    /**
     * zoomToLegendRow — uniform "click a legend row, fit the scope it represents."
     *
     * Reads the full `language-families` source data through readSourceFeatures()
     * (library/maps/pin-selection.js, which knows both engines' source shapes; never
     * the engine-private `_data` directly) and evaluates the filter expression in JS, bypassing the viewport
     * clip that previously caused off-screen regions to silently no-op. fitBounds
     * is bidirectional — it zooms OUT to a wider region just as readily as it
     * zooms IN to a tight cluster, so Africa-row and North-India-cluster-row
     * feel like the same gesture from any starting camera.
     *
     *   count == 0 → no-op (intentional — never blank-out the map)
     *   count == 1 → flyTo single-pin coords @ LEGEND_SINGLE_PIN_ZOOM
     *   count >= 2 → fitBounds with padding LEGEND_FIT_PADDING_PX
     *
     * @param {Object} row - STL legend node { id, label, filter, ... }
     * @param {Object} [opts]
     * @param {Array}  [opts.matchExpr] - Override Mapbox expression for flat tabs
     *                                    (prayer/engagement/adoption) where row.filter
     *                                    is a placeholder against `_flat_filter`.
     * @param {string} [opts.sourceId='language-families'] - Pin source id to query
     */
    function zoomToLegendRow(row, opts = {}) {
        const map = getMap();
        if (!map || !row) return;

        // Region rows on the doxa-regions tab represent polygons, not pin clusters.
        // The pin-cluster path below would zoom to whatever sparse pins happen to
        // overlap the region's bbox — which for sparse regions like Oceania zooms
        // OUT to fit a few scattered pins. Fit the polygon directly instead, so
        // "click Oceania" zooms TO Oceania.
        if (opts.regionPolygonSource && map.getSource(opts.regionPolygonSource)) {
            const polyFeatures = readSourceFeatures(map, opts.regionPolygonSource);
            const regionKey = row.id ?? row.label;
            const match = polyFeatures.find(f => {
                const p = f?.properties || {};
                return p.region === regionKey || p.name === regionKey || p.id === regionKey;
            });
            if (match) {
                const lngs = [];
                let pMinLat = Infinity, pMaxLat = -Infinity;
                const visit = (coords) => {
                    for (const c of coords) {
                        if (Array.isArray(c[0])) visit(c);
                        else if (Number.isFinite(c[0]) && Number.isFinite(c[1])) {
                            lngs.push(c[0]);
                            if (c[1] < pMinLat) pMinLat = c[1];
                            if (c[1] > pMaxLat) pMaxLat = c[1];
                        }
                    }
                };
                if (match.geometry?.coordinates) visit(match.geometry.coordinates);
                // Robust extent: trims a wide polygon's sparse tail (e.g. "Europe"
                // reaching into far-east Russia) so the DENSE cluster (real Europe)
                // frames tightly instead of fitBounds-ing the antimeridian-crossing sprawl.
                const ext = _robustLngExtent(lngs);
                if (ext && Number.isFinite(pMinLat)) {
                    const pBounds = [[ext.minLng, pMinLat], [ext.maxLng, pMaxLat]];
                    // Normal region → fit the polygon tightly (zoom TO the region). A
                    // too-wide polygon (e.g. "Europe (Region)", whose geometry is dominated
                    // by far-east Russia) would snap/show copies — ease to a STABLE world
                    // overview (densest-bin center) instead.
                    if (_tooWideToFit(map, pBounds, ext.span)) {
                        _easeWorldOverview(map, ext.center, pMinLat, pMaxLat);
                    } else {
                        cam(map).fitBounds(pBounds, {
                            padding: LEGEND_FIT_PADDING_PX,
                            maxZoom: LEGEND_FIT_MAX_ZOOM,
                            duration: LEGEND_FIT_DURATION_MS,
                            essential: true
                        });
                    }
                    return;
                }
            }
            // Polygon not found — fall through to pin-cluster path below.
        }

        const sourceId = opts.sourceId ?? 'language-families';
        if (!map.getSource(sourceId)) return;

        const filter = opts.matchExpr ?? row.filter;
        if (!filter) return;

        const allFeatures = readSourceFeatures(map, sourceId);
        if (!allFeatures.length) return;

        const lngs = [];
        let minLat = Infinity, maxLat = -Infinity;
        let pointCount = 0;
        let firstLng = 0, firstLat = 0;
        const seen = new Set();
        for (const f of allFeatures) {
            const props = f?.properties;
            if (!matchesExpression(filter, props)) continue;
            const id = props?.uniqueId;
            if (id != null) {
                if (seen.has(id)) continue;
                seen.add(id);
            }
            const c = f.geometry?.coordinates;
            if (!Array.isArray(c) || c.length < 2) continue;
            const lng = c[0], lat = c[1];
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
            if (pointCount === 0) { firstLng = lng; firstLat = lat; }
            lngs.push(lng);
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            pointCount++;
        }
        if (pointCount === 0) return;

        if (pointCount === 1) {
            cam(map).flyTo({
                center: [firstLng, firstLat],
                zoom: LEGEND_SINGLE_PIN_ZOOM,
                duration: LEGEND_FIT_DURATION_MS,
                essential: true
            });
            return;
        }

        // Robust, antimeridian-safe extent with outlier trim + a STABLE center.
        const ext = _robustLngExtent(lngs) || { center: 0, minLng: 0, maxLng: 0, span: 0 };
        const bounds = [[ext.minLng, minLat], [ext.maxLng, maxLat]];
        // Too wide to frame without revealing repeated world copies — a globe-spanning
        // row ("Islam" reaches every continent) or any fit that would clamp at/below the
        // no-copy floor (the old snap animated the wrong way and flashed the copies).
        // Ease to a STABLE world overview (deterministic trimmed center — NOT a degenerate
        // circular mean) so it always lands predictably. Regional rows (Africa, North-India
        // cluster) frame tightly via the fitBounds below — no regression.
        if (_tooWideToFit(map, bounds, ext.span)) {
            _easeWorldOverview(map, ext.center, minLat, maxLat);
            return;
        }
        try {
            cam(map).fitBounds(bounds, {
                padding: LEGEND_FIT_PADDING_PX,
                maxZoom: LEGEND_FIT_MAX_ZOOM,
                duration: LEGEND_FIT_DURATION_MS,
                essential: true
            });
        } catch (_) { /* fitBounds throws on degenerate bounds */ }
    }

    return {
        // Core navigation
        getOffsetCenter,
        slowFlyToFamily,
        slowFlyToRegion,
        flyTo,
        flyToCoords,
        fitBounds,
        resetView,
        zoomToLegendRow,

        // Utilities
        calculateRegionCenterFromPolygon
    };
}

// ES Module export
