/**
 * API Connections Registry
 *
 * The single front door to the api/ seam — the parallel of
 * colors/_registry.js, but for data sources instead of color modes.
 *
 * A "connection" is one entry under `sources` in ./sources.json. Each
 * declares a `type` (csv | api | rest-api), where to read from, and a
 * `fieldMappings` block that maps the source's raw field names onto the
 * system field names the map/legend/detail components expect. The components
 * stay source-agnostic; only the connection knows the source's shape.
 *
 * Three moving parts make up the seam:
 *   - sources.json (./)          — WHAT to connect to (the customization surface)
 *   - apiBaseUrl.js              — the runtime base URL for rest-api sources
 *   - DataSourceManager.js       — the engine: fetch → normalize → cache
 *
 * Add a custom connection: see README.md in this folder.
 */

import sourcesConfig from './sources.json'
import { getApiBaseUrl } from './apiBaseUrl.js'
import { DataSourceManager, dataSourceManager } from './DataSourceManager.js'

/** The three connection types DataSourceManager knows how to load. */
export const SOURCE_TYPES = {
  CSV:      'csv',       // fetch + parse a local CSV file (sourceConfig.path)
  API:      'api',       // fetch a single JSON URL (sourceConfig.url)
  REST_API: 'rest-api'   // fetch a versioned REST endpoint (pray-tools shape) via getApiBaseUrl()
}

/** Raw sources map keyed by source id, straight from sources.json. */
export const SOURCES = sourcesConfig.sources || {}

/**
 * The id of the source the app loads by default (sources.json → activeSource).
 * @returns {string}
 */
export function getActiveSourceId() {
  return sourcesConfig.activeSource || Object.keys(SOURCES)[0]
}

/**
 * Resolve one connection's config by id.
 * @param {string} sourceId
 * @returns {object|undefined}
 */
export function getSourceConfig(sourceId) {
  return SOURCES[sourceId]
}

/**
 * List all registered connections (for debug / a source-picker UI).
 * Mirrors colors/_registry.js → listStrategies().
 */
export function listSources() {
  return Object.entries(SOURCES).map(([id, cfg]) => ({
    id,
    name: cfg.name,
    type: cfg.type,
    active: id === getActiveSourceId()
  }))
}

export { getApiBaseUrl, DataSourceManager, dataSourceManager, sourcesConfig }

export default {
  SOURCE_TYPES,
  SOURCES,
  getActiveSourceId,
  getSourceConfig,
  listSources,
  getApiBaseUrl,
  DataSourceManager,
  dataSourceManager
}
