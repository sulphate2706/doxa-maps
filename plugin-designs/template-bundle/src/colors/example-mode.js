/**
 * example-mode.js — a COPY-ME profile-local color strategy.
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * A "color strategy" decides how map pins are colored for one "color mode". This
 * file lives in a BUNDLE's own `src/colors/` folder (not the shared library's
 * `library/colors/`), so it is PRIVATE to this bundle. At bundle init,
 * index.js globs this folder and calls `registerStrategies(...)`, which merges these
 * files OVER the shared library set:
 *   - filename derives the mode key: `example-mode.js` → mode `exampleMode`
 *     / `COLOR_MODES.EXAMPLE_MODE` (kebab → camelCase / UPPER_SNAKE).
 *   - if the derived mode MATCHES a shared library mode, THIS file OVERRIDES it
 *     for this bundle only.
 *   - if it's a NEW mode, it ADDS a private strategy nobody else sees.
 * Because each bundle builds as its own IIFE, this can never leak into another map.
 *
 * ── The rule (where does a strategy belong?) ─────────────────────────────────
 * Parameterized + genuinely reused by more than one profile  → the shared library
 *   (`library/colors/`). Not reused → keep it here, in your profile.
 * "Local by default, promote deliberately."
 *
 * ── How to use this template ─────────────────────────────────────────────────
 * 1. Copy this file to `src/colors/<your-mode>.js` in your bundle folder.
 * 2. Rename it so the filename → mode key matches what your map's tab passes as
 *    its `colorStrategy` (see your profile's tab list).
 * 3. Point PROPERTY_KEY at the pin feature field you color by, and fill PALETTE.
 * 4. `bun run dev` on the bundler → your map picks it up via HMR, no rebuild.
 *
 * The strategy CONTRACT (required shape) is documented in
 * `library/colors/README.md`. `name` is REQUIRED — an absent name
 * shows a blank legend/tab label. Mirror the canonical `religion.js` for a real one.
 */

// The GeoJSON pin-feature property this strategy reads. Every pin already carries
// `peoplePraying` (a number), so this example paints without any data plumbing.
export const PROPERTY_KEY = 'peoplePraying'

const DEFAULT_COLOR = '#94a3b8' // slate gray — used when the value is missing

/** Simple two-bucket palette: has-prayer vs no-prayer. Replace with your own. */
export const PALETTE = {
  hasPrayer: '#22c55e', // green
  noPrayer:  '#ef4444', // red
}

/** Per-feature color resolver — the JS-side lookup (used for popups, legends). */
export function getColor(properties) {
  const n = Number(properties?.[PROPERTY_KEY] ?? 0)
  return n > 0 ? PALETTE.hasPrayer : PALETTE.noPrayer
}

/**
 * Build the Mapbox paint expression (array whose head is an operator). Fed
 * directly to `circle-color`. Here: a `case` on whether peoplePraying > 0.
 */
export function applyColor() {
  return [
    'case',
    ['>', ['to-number', ['coalesce', ['get', PROPERTY_KEY], 0]], 0],
    PALETTE.hasPrayer,
    PALETTE.noPrayer,
  ]
}

// Alias the registry/tab-switch handler calls by name. Keep it.
export const buildColorExpression = applyColor

export default {
  name:        'Example Mode', // REQUIRED — human label for the tab/legend. Never omit.
  propertyKey: PROPERTY_KEY,
  palette:     PALETTE,
  getColor,
  applyColor,
  buildColorExpression,
  fallback:    DEFAULT_COLOR,
}
