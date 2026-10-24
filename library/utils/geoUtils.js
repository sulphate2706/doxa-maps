/**
 * geoUtils.js — Geographic / GeoJSON Utility Functions
 *
 * Pure functions — no Vue, no Mapbox dependency.
 * Safe to use in composables, stores, or profile components.
 *
 * Origin: doxa-research-mfe (research wins on shared symbols).
 * Symbol-merged from doxa-simple-map-mfe: calculateZoomForBounds,
 * darkenColor, isValidCoordinate, validateGeoJSONFeature,
 * validatePeopleGroup, clampZoom, isValidHexColor.
 */

/**
 * Extract all coordinates from a GeoJSON geometry.
 * @param {Object} geometry    - GeoJSON geometry (Polygon or MultiPolygon)
 * @param {Array}  coordsArray - Array to push [lng, lat] pairs into
 */
export function extractCoordinates(geometry, coordsArray) {
  if (!geometry || !coordsArray) return
  if (geometry.type === 'Polygon') {
    geometry.coordinates[0].forEach(coord => coordsArray.push(coord))
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polygon => {
      polygon[0].forEach(coord => coordsArray.push(coord))
    })
  }
}

/**
 * Calculate the centroid of an array of points.
 * @param {Array} points - Objects with `longitude` and `latitude` properties
 * @returns {Array} [lng, lat]
 */
export function calculateCentroid(points) {
  if (!points?.length) return [0, 0]
  let sumLon = 0, sumLat = 0
  points.forEach(p => { sumLon += p.longitude; sumLat += p.latitude })
  return [sumLon / points.length, sumLat / points.length]
}

/**
 * Calculate a bounding box for an array of points.
 * @param {Array} points - Objects with `longitude` and `latitude` properties
 * @returns {{ minLon, maxLon, minLat, maxLat } | null}
 */
export function calculateBounds(points) {
  if (!points?.length) return null
  let minLon = Infinity, maxLon = -Infinity
  let minLat = Infinity, maxLat = -Infinity
  points.forEach(p => {
    minLon = Math.min(minLon, p.longitude)
    maxLon = Math.max(maxLon, p.longitude)
    minLat = Math.min(minLat, p.latitude)
    maxLat = Math.max(maxLat, p.latitude)
  })
  return { minLon, maxLon, minLat, maxLat }
}

/**
 * Convert a bounds object to a Mapbox LngLatBoundsLike array.
 * @param {{ minLon, maxLon, minLat, maxLat }} bounds
 * @returns {Array} [[minLon, minLat], [maxLon, maxLat]]
 */
export function boundsToLngLatBounds(bounds) {
  if (!bounds) return null
  return [[bounds.minLon, bounds.minLat], [bounds.maxLon, bounds.maxLat]]
}

/**
 * Check if a [lng, lat] coordinate is valid (within world bounds).
 * @param {Array} coord - [lng, lat]
 * @returns {boolean}
 */
export function isValidCoord(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return false
  const [lng, lat] = coord
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
}

/**
 * Build a GeoJSON FeatureCollection from an array of point records.
 * @param {Array}    records    - Objects with `longitude`, `latitude`, and any properties
 * @param {Function} [getProps] - (record) => properties object. Defaults to spreading the record.
 * @returns {Object} GeoJSON FeatureCollection
 */
export function toPointFeatureCollection(records, getProps) {
  const features = records
    .filter(r => r.longitude != null && r.latitude != null)
    .map(r => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [r.longitude, r.latitude]
      },
      properties: getProps ? getProps(r) : { ...r }
    }))
  return { type: 'FeatureCollection', features }
}

// ─── Ported from doxa-map-mfe geoUtils.js (Friction fix during research-mfe build) ──
/**
 * Generate a deterministic HSL color from a string (used by language-family
 * legend coloring fallback when no palette entry exists).
 * @param {string} str
 * @returns {string} `hsl(h,60%,50%)`
 */
export function generateColorFromString(str) {
  if (!str) return 'hsl(0, 60%, 50%)'
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash % 360)
  return `hsl(${hue}, 60%, 50%)`
}

// ─── Symbol-merged from simple-map (missing in research) ───
// Origin: simple-map
/**
 * Calculate appropriate zoom level for given bounds.
 * Conservative — zooms out more to show all points.
 * @param {Object} bounds - Bounds object from calculateBounds
 * @returns {number} Zoom level (1-4.5)
 */
export function calculateZoomForBounds(bounds) {
  if (!bounds) return 3
  const lonSpread = bounds.maxLon - bounds.minLon
  const latSpread = bounds.maxLat - bounds.minLat
  const maxSpread = Math.max(lonSpread, latSpread)
  if (maxSpread > 120) return 1
  if (maxSpread > 80) return 1.5
  if (maxSpread > 50) return 2
  if (maxSpread > 30) return 2.5
  if (maxSpread > 20) return 3
  if (maxSpread > 10) return 3.5
  if (maxSpread > 5) return 4
  return 4.5
}

// Origin: simple-map
/**
 * Darken a hex color by a percentage. Includes hardcoded overrides for
 * specific region colors so legend lines stay visible against fills.
 * @param {string} color - Hex color (e.g., '#e74c3c')
 * @param {number} percent - Percentage to darken (0-100), default 15
 * @returns {string} Darkened hex color
 */
export function darkenColor(color, percent = 15) {
  if (!color || typeof color !== 'string') {
    console.error('darkenColor: Invalid color input:', color)
    return '#000000'
  }
  // Hardcoded region overrides (East Asia, Africa, Latin America,
  // Eurasia/Europe, North America, Middle East)
  if (color === '#3498db') return '#2171b5'
  if (color === '#f03b2d') return '#c0392b'
  if (color === '#e74c3c') return '#c0392b'
  if (color === '#f39c12') return '#ca6f1e'
  if (color === '#f0c64a') return '#c9a227'   // prayer yellow → darker yellow
  if (color === '#2ecc71') return '#229954'
  if (color === '#1abc9c') return '#138d75'
  if (color === '#9b59b6') return '#7d3c98'

  const hex = color.replace('#', '')
  if (hex.length !== 6 || !/^[0-9A-Fa-f]{6}$/.test(hex)) {
    console.error('darkenColor: Invalid hex color:', color)
    return '#000000'
  }
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    console.error('darkenColor: Failed to parse RGB from:', color)
    return '#000000'
  }
  const factor = (100 - percent) / 100
  const newR = Math.max(0, Math.floor(r * factor))
  const newG = Math.max(0, Math.floor(g * factor))
  const newB = Math.max(0, Math.floor(b * factor))
  const toHex = (n) => {
    const hexVal = n.toString(16)
    return hexVal.length === 1 ? '0' + hexVal : hexVal
  }
  return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`
}

// Origin: simple-map
/**
 * Validate a coordinate pair (numeric form).
 * @param {number} lon - Longitude (-180 to 180)
 * @param {number} lat - Latitude (-90 to 90)
 * @returns {boolean} True if valid
 */
export function isValidCoordinate(lon, lat) {
  return (
    typeof lon === 'number' && !isNaN(lon) && lon >= -180 && lon <= 180 &&
    typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90
  )
}

// Origin: simple-map
/**
 * Validate a GeoJSON feature.
 * @param {Object} feature - GeoJSON feature to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateGeoJSONFeature(feature) {
  const errors = []
  if (!feature) return { valid: false, errors: ['Feature is null or undefined'] }
  if (feature.type !== 'Feature') {
    errors.push(`Invalid type: ${feature.type}, expected 'Feature'`)
  }
  if (!feature.geometry) {
    errors.push('Missing geometry')
  } else {
    const validTypes = ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon']
    if (!validTypes.includes(feature.geometry.type)) {
      errors.push(`Invalid geometry type: ${feature.geometry.type}`)
    }
    if (!feature.geometry.coordinates) {
      errors.push('Missing coordinates')
    }
  }
  return { valid: errors.length === 0, errors }
}

// Origin: simple-map
/**
 * Validate a people-group-shaped object has required fields.
 * @param {Object} pg - People group object
 * @param {string[]} requiredFields - Fields to check for
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validatePeopleGroup(pg, requiredFields = ['id', 'name', 'latitude', 'longitude']) {
  if (!pg) return { valid: false, missing: ['entire object'] }
  const missing = requiredFields.filter(field => {
    const value = pg[field] ?? pg._normalized?.[field]
    return value === undefined || value === null || value === ''
  })
  return { valid: missing.length === 0, missing }
}

// Origin: simple-map
/**
 * Clamp a zoom level into the acceptable range.
 * @param {number} zoom - Zoom level to validate
 * @param {number} min - Minimum zoom (default 0)
 * @param {number} max - Maximum zoom (default 22 for Mapbox)
 * @returns {number} Clamped zoom value
 */
export function clampZoom(zoom, min = 0, max = 22) {
  if (typeof zoom !== 'number' || isNaN(zoom)) return min
  return Math.max(min, Math.min(max, zoom))
}

// Origin: simple-map
/**
 * Validate hex color format (#RGB or #RRGGBB).
 * @param {string} color - Color string to validate
 * @returns {boolean} True if valid hex color
 */
export function isValidHexColor(color) {
  if (typeof color !== 'string') return false
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color)
}
