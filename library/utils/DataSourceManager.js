/**
 * Back-compat shim. The real DataSourceManager.js lives in the `api/` seam
 * folder. New code imports from '@map/api/_registry.js' (or
 * '@map/api/DataSourceManager.js'). This shim keeps existing
 * `@map/utils/DataSourceManager.js` imports (3 plugin-designs + the barrel)
 * working.
 */
export { DataSourceManager, dataSourceManager } from '../api/DataSourceManager.js'
export { default } from '../api/DataSourceManager.js'
