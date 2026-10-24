/**
 * Gospel Resources Color Strategy
 *
 * Colors pins based on available gospel resources.
 * DEFAULT: Binary coloring - Green (has ANY resource) / Black (no resources)
 * LEGEND COUNTS: Show TOTAL for each resource (can overlap)
 */

export const PROPERTY_KEY = 'resourceType'

/**
 * Gospel Resources Colors
 * DEFAULT: Binary coloring - Green (has ANY resource) / Black (no resources)
 * LEGEND: Show TOTAL count for each resource (INCLUSIVE, can overlap)
 */
export const PALETTE = {
  bible:        '#3498db', // Blue - Bible available
  jesusFilm:    '#20c997', // Fisher Green (teal-green) - Jesus Film available
  radio:        '#9b59b6', // Purple - Radio broadcast available
  gospel:       '#f39c12', // Orange - Gospel recordings available
  audio:        '#1abc9c', // Teal - Audio resources available
  stories:      '#e74c3c', // Red - Stories available
  hasResources: '#27ae60', // Green - Has ANY gospel resource (default pin color)
  noResources:  '#2c3e50'  // Dark/Black - No gospel resources
}

export const RESOURCE_COLORS = PALETTE

/** Resource priority order for pin coloring */
export const RESOURCE_PRIORITY = ['bible', 'jesusFilm', 'radio', 'gospel', 'audio', 'stories']

/** Resource display names for legend */
export const NAMES = {
  bible:        'Bible',
  jesusFilm:    'Jesus Film',
  radio:        'Radio',
  gospel:       'Gospel',
  audio:        'Audio',
  stories:      'Stories',
  hasResources: 'Has Resources',
  noResources:  'No Resources'
}

export const RESOURCE_NAMES = NAMES

/**
 * Get CSV column name for a resource key.
 */
export function getCSVColumn(resourceKey) {
  const mapping = {
    bible: 'Bible',
    jesusFilm: 'Jesus',
    radio: 'Radio',
    gospel: 'Gospel',
    audio: 'Audio',
    stories: 'Stories'
  }
  return mapping[resourceKey]
}

/**
 * Get color for a feature based on resource availability.
 * Binary logic: Green if has ANY resource, Black if none.
 */
export function getColor(properties) {
  for (const resourceKey of RESOURCE_PRIORITY) {
    const value = properties[resourceKey] || properties._raw?.[getCSVColumn(resourceKey)]
    if (value === 'Available') {
      return PALETTE.hasResources // Green
    }
  }
  return PALETTE.noResources // Black
}

/**
 * Check if feature has ANY resource (for hasResources).
 */
export function hasAnyResource(properties) {
  for (const resourceKey of RESOURCE_PRIORITY) {
    const value = properties[resourceKey] || properties._raw?.[getCSVColumn(resourceKey)]
    if (value === 'Available') {
      return true
    }
  }
  return false
}

/**
 * Get the highest priority resource type for a feature.
 * Returns the resource key that determines the pin color.
 */
export function getResourceType(properties) {
  for (const resourceKey of RESOURCE_PRIORITY) {
    const value = properties[resourceKey] || properties._raw?.[getCSVColumn(resourceKey)]
    if (value === 'Available') {
      return resourceKey
    }
  }
  return 'noResources'
}

/**
 * Build Mapbox color expression for gospel resources.
 * DEFAULT: Binary coloring - Green if has ANY resource, Black if none.
 */
export function applyColor() {
  return [
    'case',
    // If ANY resource is Available → Green (hasResources)
    ['any',
      ['==', ['get', 'bible'], 'Available'],
      ['==', ['get', 'jesusFilm'], 'Available'],
      ['==', ['get', 'radio'], 'Available'],
      ['==', ['get', 'gospel'], 'Available'],
      ['==', ['get', 'audio'], 'Available'],
      ['==', ['get', 'stories'], 'Available']
    ],
    PALETTE.hasResources, // Green
    // Default: No resources → Black
    PALETTE.noResources   // Black
  ]
}

export const buildColorExpression = applyColor

export default {
  name: 'Gospel Resources',
  propertyKey: PROPERTY_KEY,
  palette: PALETTE,
  colors: PALETTE,
  names: NAMES,
  priority: RESOURCE_PRIORITY,
  getColor,
  applyColor,
  buildColorExpression,
  hasAnyResource,
  getResourceType,
  getCSVColumn
}
