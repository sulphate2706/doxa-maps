/**
 * Color Strategies Registry — AUTO-DISCOVERED
 *
 * Each strategy lives in its own file in this folder (one strategy = one file).
 * Strategies are discovered automatically at build time via Vite's
 * `import.meta.glob` — the SAME pattern plugin-designs use to auto-discover
 * bundles. There is NO manual registration step.
 *
 * Add a new strategy:
 *   1. Create <name>.js next to this file with `export default { name, propertyKey,
 *      getColor, applyColor, ... }` (see religion.js for the canonical shape).
 *   2. Build. It appears automatically.
 *
 * That's it — no import, no COLOR_MODES entry, no STRATEGIES entry to maintain.
 *
 * Naming contract (how the mode key is derived from the filename):
 *   file `affinity-block.js`  → mode string `affinityBlock`  (camelCase)
 *                             → COLOR_MODES.AFFINITY_BLOCK    (UPPER_SNAKE enum key)
 *   file `religion.js`        → mode string `religion`        → COLOR_MODES.RELIGION
 *   Files whose name starts with `_` or `.` are skipped (e.g. THIS file).
 */

// ─── Auto-discovery ──────────────────────────────────────────────────────────
// Eager glob: Vite inlines every sibling .js at build time (relative to THIS
// file), so each bundle that imports the registry gets the full strategy set.
const modules = import.meta.glob('./*.js', { eager: true })

const kebabToCamel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
const kebabToUpperSnake = (s) => s.replace(/-/g, '_').toUpperCase()

// Reserved modes that have NO strategy file (enum values referenced elsewhere).
const RESERVED_MODES = { STATUS: 'status', CUSTOM: 'custom' }

const COLOR_MODES = { ...RESERVED_MODES }
const STRATEGIES = {}

// Register one glob result (path→module map) into COLOR_MODES + STRATEGIES using the
// shared filename→mode derivation. Same `_`/`.` skip + no-default-export skip rules as
// the shared baseline. A later call with the same mode key OVERRIDES the earlier one —
// that's how a profile-local strategy overrides a shared one.
function registerModules(globResult) {
  for (const path of Object.keys(globResult).sort()) {
    const file = path.split('/').pop().replace(/\.js$/, '')     // e.g. 'affinity-block'
    if (file.startsWith('_') || file.startsWith('.')) continue  // skip registry + dotfiles
    const strategy = globResult[path].default
    if (!strategy) continue                                     // no default export → not a strategy
    const mode = kebabToCamel(file)                             // 'affinityBlock'
    COLOR_MODES[kebabToUpperSnake(file)] = mode                 // COLOR_MODES.AFFINITY_BLOCK = 'affinityBlock'
    STRATEGIES[mode] = strategy
  }
}

// ─── Shared baseline: every strategy file in THIS folder ─────────────────────
registerModules(modules)

/**
 * Merge a bundle's PROFILE-LOCAL color strategies over the shared baseline.
 *
 * A bundle's index.js evaluates `import.meta.glob('./src/colors/*.js',
 * { eager: true })` (relative to the bundle folder — the same seam index.js uses for
 * profileModules) and hands the result here at bundle init, BEFORE any map mounts.
 *
 * Safe by construction: each bundle is built as its own IIFE (vite.config.js —
 * separate BUNDLE build, inlineDynamicImports), so it inlines its OWN copy of this
 * module. Registering local strategies mutates only THIS bundle's registry — it cannot
 * leak into another bundle. In dev each bundle is a separate module graph too.
 *
 * Semantics: a local file whose derived mode matches a shared mode OVERRIDES it; a new
 * mode ADDS a profile-private strategy. Idempotent — re-registering is harmless.
 * A no-op when the bundle's `src/colors/` folder has no strategy files (empty glob).
 *
 * @param {Record<string, { default?: object }>} localModules - eager import.meta.glob result
 */
export function registerStrategies(localModules) {
  if (!localModules) return
  registerModules(localModules)
}

export { COLOR_MODES }

/**
 * Resolve a color strategy by mode key.
 * Falls back to LANGUAGE_FAMILY when mode is missing or unknown.
 *
 * @param {string} mode - Color mode (from COLOR_MODES)
 * @returns {object} Strategy module default export
 */
export function getColorStrategy(mode) {
  return STRATEGIES[mode] || STRATEGIES[COLOR_MODES.LANGUAGE_FAMILY]
}

/**
 * Build Mapbox color expression for a given mode.
 *
 * @param {string} mode - Color mode (from COLOR_MODES)
 * @param {{ colorSource?: 'properties'|'feature-state' }} [options]
 * @returns {array} Mapbox expression array
 */
export function buildColorExpression(mode, options = {}) {
  const strategy = getColorStrategy(mode)
  return strategy.applyColor(options)
}

/**
 * Get color for a feature based on mode.
 *
 * @param {object} properties - Feature properties
 * @param {string} mode - Color mode (from COLOR_MODES)
 * @returns {string} Hex color code
 */
export function getFeatureColor(properties, mode) {
  const strategy = getColorStrategy(mode)
  return strategy.getColor(properties)
}

/**
 * List all registered strategies (for debug / introspection).
 */
export function listStrategies() {
  return Object.entries(STRATEGIES).map(([mode, strategy]) => ({
    mode,
    name: strategy.name,
    propertyKey: strategy.propertyKey
  }))
}

// Back-compat: name matches the monolithic colorStrategies.js export.
export const colorStrategies = STRATEGIES

export default {
  COLOR_MODES,
  colorStrategies: STRATEGIES,
  getColorStrategy,
  buildColorExpression,
  getFeatureColor,
  listStrategies
}
