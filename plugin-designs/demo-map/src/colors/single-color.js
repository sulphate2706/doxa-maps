/**
 * single-color.js — demo-map's profile-LOCAL color strategy.
 *
 * Copied from `template-bundle/src/colors/example-mode.js` (the copy-me
 * reference) and renamed, per documentation/tutorial.md "How to change colors".
 *
 * Filename → mode key: `single-color.js` → mode `singleColor` /
 * `COLOR_MODES.SINGLE_COLOR`. Registered at bundle init by demo-map/index.js via
 * `registerStrategies(import.meta.glob('./src/colors/*.js', { eager: true }))`
 * — PRIVATE to this bundle (each bundle is its own IIFE), so it can never leak
 * into another map.
 *
 * Purpose: paint EVERY pin one custom color. No data field drives the color,
 * so PROPERTY_KEY is null and both resolvers return the same constant.
 */

// No pin-feature property is read — every pin gets the same color.
export const PROPERTY_KEY = null

/** The one value to edit: the single custom pin color. */
export const PALETTE = {
  pin: '#8b5cf6', // purple — ALL pins
}

const DEFAULT_COLOR = PALETTE.pin

/** Per-feature color resolver — the JS-side lookup (popups, legends). */
export function getColor() {
  return PALETTE.pin
}

/**
 * Build the Mapbox paint expression (array whose head is an operator, per the
 * strategy contract). 'to-color' wraps the constant into a valid expression.
 */
export function applyColor() {
  return ['to-color', PALETTE.pin]
}

// Alias the registry/tab-switch handler calls by name. Keep it.
export const buildColorExpression = applyColor

export default {
  name:        'Single Color', // REQUIRED — human label for the tab/legend
  propertyKey: PROPERTY_KEY,
  palette:     PALETTE,
  getColor,
  applyColor,
  buildColorExpression,
  fallback:    DEFAULT_COLOR,
}
