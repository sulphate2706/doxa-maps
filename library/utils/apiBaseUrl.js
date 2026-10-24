/**
 * Back-compat shim. The real apiBaseUrl.js lives in the `api/` seam folder.
 * New code imports from '@map/api/_registry.js' (or '@map/api/apiBaseUrl.js').
 * This shim keeps existing `@map/utils/apiBaseUrl.js` imports working.
 */
export { getApiBaseUrl } from '../api/apiBaseUrl.js'
