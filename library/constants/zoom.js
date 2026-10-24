/**
 * zoom.js - Centralized Zoom Configuration
 * 
 * Single source of truth for ALL zoom-related configurations:
 * - Region-specific zoom levels (for region selection/fly-to)
 * - Map-level zoom constraints (min/max)
 * - Zoom interpolation curves (for circle sizes, stroke widths, etc.)
 * - Fly animation zoom levels
 * - Clustering zoom thresholds
 */

/**
 * Region-Specific Zoom Configurations
 * Used when clicking on a region in the legend or when flying to a region
 * Each region has an optimal zoom level and center point for best viewing
 */
export const REGION_ZOOM_CONFIG = {
    'Africa': {
        zoom: 1.3,
        center: [16.6512, 26.3538]
    },
    'Asia': {
        zoom: 0.8,
        center: [98.2654, 49.9282]
    },
    'Europe': {
        zoom: 1.4,
        center: [22.7826, 70.1026]
    },
    'Latin America & Caribbean': {
        zoom: 1.8,
        center: [-60.4619, 10.1428]
    },
    'Middle East': {
        zoom: 1.7,
        center: [22.9056, 39.5752]
    },
    'No WAGF Region/Bloc': {
        zoom: 0.6,
        center: [-8.2363, 44.2392]
    },
    'North America & Non-Spanish Caribbean': {
        zoom: 2.1,
        center: [-68.1935, 31.4282]
    },
    'Oceania': {
        zoom: 1.5,
        center: [161.6257, -0.6680]
    }
};

/**
 * Global Zoom Constraints
 * Default min/max zoom levels for all maps (can be overridden per map)
 */
export const ZOOM_CONSTRAINTS = {
    default: {
        minZoom: 0.5,
        maxZoom: 18
    },
    
    // Map-specific overrides
    languageFamilies: {
        minZoom: 1.0,
        maxZoom: 15
    },
    
    // Recommended for mobile devices
    mobile: {
        minZoom: 1.0,
        maxZoom: 16
    }
};

/**
 * Zoom Interpolation Curves
 * These define how visual properties change with zoom level
 * Used in Mapbox paint properties (circle-radius, circle-stroke-width, etc.)
 * 
 * Format: ['interpolate', ['linear'], ['zoom'], zoom1, value1, zoom2, value2, ...]
 */
export const ZOOM_INTERPOLATIONS = {
    /**
     * Circle radius interpolations
     * Different profiles for different use cases
     */
    circleRadius: {
        // Standard: Good balance for most maps (used in language-family-pins)
        standard: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 3,      // World view - small
            2, 3.5,    // Still compact
            4, 4,      // Good baseline size
            5, 5,      // Starting to grow
            6, 6.5,    // Growing more
            7, 8,      // ~50% bigger than zoom 4
            8, 10,     // Larger
            10, 14,    // Big
            12, 18,    // Bigger when zoomed in
            14, 22     // Full size at max zoom
        ],
        
        // Highlighted: Larger size for selected/highlighted pins
        highlighted: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 4,      // Larger at world view
            4, 5,
            8, 12,
            12, 20
        ],
        
        // Faded: Smaller size for non-selected pins
        faded: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 2,
            4, 2.5,
            8, 5,
            12, 8
        ],
        
        // Compact: Smaller overall for dense maps
        compact: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 2,
            4, 3,
            8, 6,
            12, 10
        ],
        
        // Large: Bigger for sparse maps or emphasis
        large: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 4,
            4, 6,
            8, 14,
            12, 24
        ],

        // Touch target: invisible hitbox layer for mobile/tablet tap targeting.
        // Visual pins stay at their normal size — only the transparent hit area grows.
        // Trimmed (2026-06-22, coder directive): overlapping pins in a dense cluster
        // had hitboxes that fully overlapped, swallowing the gap and making it
        // impossible to click *between* them. Radii cut slightly — most at high zoom,
        // where you dive into a cluster — while keeping a ~40px tap target at mid zoom.
        touchTarget: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 12,     // 24px diameter at world view
            2, 15,     // 30px
            4, 19,     // 38px — comfortable tap target
            6, 20,     // 40px
            8, 21,     // 42px
            10, 22,    // 44px
            12, 24,    // shrunk from 32 — room to click between dense pins
            14, 28     // shrunk from 40 — full-zoom cluster diving
        ]
    },
    
    /**
     * Circle stroke width interpolations
     */
    circleStrokeWidth: {
        standard: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 0.5,    // Thin stroke when zoomed out
            4, 0.75,
            8, 1,
            12, 1.5
        ],
        
        thick: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 1,
            4, 1.5,
            8, 2,
            12, 3
        ]
    },
    
    /**
     * Line width interpolations (for network connections, borders, etc.)
     */
    lineWidth: {
        thin: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 0.5,
            4, 1,
            8, 1.5,
            12, 2
        ],
        
        standard: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 1,
            4, 2,
            8, 3,
            12, 4
        ],
        
        thick: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 2,
            4, 3,
            8, 5,
            12, 8
        ]
    },
    
    /**
     * Cluster count text size
     */
    textSize: {
        standard: [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 10,
            4, 12,
            8, 14,
            12, 16
        ]
    }
};

/**
 * Clustering Zoom Thresholds
 * Define when clustering should activate/deactivate
 *
 * INVARIANT (COMMIT-LOG #8): clusterMaxZoom MUST sit a few levels BELOW the
 * map's zoom-in cap, or clusters never break apart within reach and overlapping
 * pins stay permanently un-clickable. The research map caps at
 * RESEARCH_MAX_ZOOM = 18 (lifted from 10 per coder directive so dense clusters
 * can be entered deep enough to click between pins), so the live value is 6 with radius 40 in
 * ClusterHelpers.DEFAULT_MAPBOX_CLUSTER_OPTIONS, which is the SOURCE OF TRUTH the
 * runtime actually uses. These centralized values are kept in lockstep with it
 * so that if/when a map is wired to read clustering config from here, it cannot
 * re-introduce COMMIT-LOG #8. Any override below must keep
 * maxZoom <= (the consuming map's zoom-in cap − ~2) for declustering headroom.
 */
export const CLUSTERING_ZOOM = {
    // Maximum zoom where clustering is active (beyond this, show individual pins).
    // Matches ClusterHelpers.DEFAULT_MAPBOX_CLUSTER_OPTIONS.clusterMaxZoom (live).
    maxZoom: 6,

    // Minimum zoom for cluster expansion
    minExpandZoom: 2,

    // Cluster radius (pixels) - larger = more aggressive clustering.
    // Matches the live clusterRadius (40) from ClusterHelpers.
    radius: 40,

    // Map-specific overrides — must still decluster BELOW the map's zoom-in cap.
    denseData: {
        maxZoom: 8,   // cluster a little longer for dense data, but stay below the cap
        radius: 60
    },

    sparseData: {
        maxZoom: 4,   // decluster early — sparse data rarely overlaps
        radius: 30
    }
};

/**
 * Fly Animation Durations (milliseconds)
 * Different speeds for auto-fly and manual fly-to operations
 */
export const FLY_DURATIONS = {
    // Auto-fly speeds (when flying through multiple regions/families)
    autoFly: {
        slow: 8000,
        normal: 4000,
        fast: 2000
    },
    
    // Manual fly-to (when clicking on a region/family)
    manual: {
        slow: 3000,
        normal: 2000,
        fast: 1000
    },
    
    // Zoom button animations
    zoomButton: 300,
    
    // Default
    default: 2000
};

/**
 * Calculate zoom level for a given bounds
 * Useful for fitting a set of points within the viewport
 * 
 * @param {Object} bounds - Bounding box { north, south, east, west }
 * @param {number} viewportWidth - Viewport width in pixels
 * @param {number} viewportHeight - Viewport height in pixels
 * @returns {number} Optimal zoom level
 */
export function calculateZoomForBounds(bounds, viewportWidth = 800, viewportHeight = 600) {
    const WORLD_DIM = { height: 256, width: 256 };
    const ZOOM_MAX = 21;
    
    function latRad(lat) {
        const sin = Math.sin(lat * Math.PI / 180);
        const radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
        return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
    }
    
    function zoom(mapPx, worldPx, fraction) {
        return Math.floor(Math.log(mapPx / worldPx / fraction) / Math.LN2);
    }
    
    const latFraction = (latRad(bounds.north) - latRad(bounds.south)) / Math.PI;
    const lngDiff = bounds.east - bounds.west;
    const lngFraction = ((lngDiff < 0) ? (lngDiff + 360) : lngDiff) / 360;
    
    const latZoom = zoom(viewportHeight, WORLD_DIM.height, latFraction);
    const lngZoom = zoom(viewportWidth, WORLD_DIM.width, lngFraction);
    
    return Math.min(latZoom, lngZoom, ZOOM_MAX);
}

/**
 * Get region zoom configuration
 * @param {string} regionName - The name of the region
 * @returns {Object|null} Object with zoom and center, or null if not found
 */
export function getRegionZoomConfig(regionName) {
    return REGION_ZOOM_CONFIG[regionName] || null;
}

/**
 * Get zoom constraints for a specific map type
 * @param {string} mapType - Map type identifier (default, languageFamilies, mobile)
 * @returns {Object} Object with minZoom and maxZoom
 */
export function getZoomConstraints(mapType = 'default') {
    return ZOOM_CONSTRAINTS[mapType] || ZOOM_CONSTRAINTS.default;
}

/**
 * Get circle radius interpolation expression
 * @param {string} profile - Profile name (standard, highlighted, faded, compact, large)
 * @returns {Array} Mapbox expression array
 */
export function getCircleRadiusInterpolation(profile = 'standard') {
    return ZOOM_INTERPOLATIONS.circleRadius[profile] || ZOOM_INTERPOLATIONS.circleRadius.standard;
}

/**
 * Get circle stroke width interpolation expression
 * @param {string} profile - Profile name (standard, thick)
 * @returns {Array} Mapbox expression array
 */
export function getCircleStrokeWidthInterpolation(profile = 'standard') {
    return ZOOM_INTERPOLATIONS.circleStrokeWidth[profile] || ZOOM_INTERPOLATIONS.circleStrokeWidth.standard;
}

/**
 * Get line width interpolation expression
 * @param {string} profile - Profile name (thin, standard, thick)
 * @returns {Array} Mapbox expression array
 */
export function getLineWidthInterpolation(profile = 'standard') {
    return ZOOM_INTERPOLATIONS.lineWidth[profile] || ZOOM_INTERPOLATIONS.lineWidth.standard;
}

/**
 * Get fly duration for a specific speed and context
 * @param {string} context - Context (autoFly, manual, zoomButton)
 * @param {string} speed - Speed (slow, normal, fast)
 * @returns {number} Duration in milliseconds
 */
export function getFlyDuration(context = 'manual', speed = 'normal') {
    if (context === 'autoFly') {
        return FLY_DURATIONS.autoFly[speed] || FLY_DURATIONS.autoFly.normal;
    } else if (context === 'manual') {
        return FLY_DURATIONS.manual[speed] || FLY_DURATIONS.manual.normal;
    } else if (context === 'zoomButton') {
        return FLY_DURATIONS.zoomButton;
    }
    return FLY_DURATIONS.default;
}

/**
 * Get clustering configuration
 * @param {string} datasetType - Dataset type (default, denseData, sparseData)
 * @returns {Object} Clustering config with maxZoom and radius
 */
export function getClusteringConfig(datasetType = 'default') {
    if (datasetType === 'denseData') {
        return CLUSTERING_ZOOM.denseData;
    } else if (datasetType === 'sparseData') {
        return CLUSTERING_ZOOM.sparseData;
    }
    return {
        maxZoom: CLUSTERING_ZOOM.maxZoom,
        radius: CLUSTERING_ZOOM.radius
    };
}

export default {
    REGION_ZOOM_CONFIG,
    ZOOM_CONSTRAINTS,
    ZOOM_INTERPOLATIONS,
    CLUSTERING_ZOOM,
    FLY_DURATIONS,
    calculateZoomForBounds,
    getRegionZoomConfig,
    getZoomConstraints,
    getCircleRadiusInterpolation,
    getCircleStrokeWidthInterpolation,
    getLineWidthInterpolation,
    getFlyDuration,
    getClusteringConfig
};
