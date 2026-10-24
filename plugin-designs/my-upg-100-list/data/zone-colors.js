// zone-colors.js — slice 09b toolC §1(a) · the per-zone color OVERRIDE map
//
// THIS APP OWNS THIS FILE. It is the editable color foundation for my-upg-100-list.
// toolA (color picker) + toolB (apply) write into ./zone-colors.json via
// ./set-zone-color.mjs; legend-tree.js reads it through colorForZone().
//
// CONTRACT (the whole point of toolC): this is a LOCAL override layer. It does NOT
// import — and must never import — src/config/color-strategies/* (the SHARED
// registry used by research-map-embed). Recoloring a zone here has ZERO blast radius
// on any sibling app. The isolation proof (color-isolation-proof.mjs) gates that.
//
// Store shape (C-D1): { "<zoneId>": "#rrggbb", … }. Starts {} — no overrides yet,
// so colorForZone() always returns the deterministic leafColor() fallback and there
// is NO visual change until the operator sets one (C-D3).
//
// Value format (C-D2): hex `#rrggbb` (what the picker emits). Mapbox accepts hex
// fills directly, so no HSL conversion is needed on the paint side.

import ZONE_COLOR_OVERRIDES from './zone-colors.json' with { type: 'json' };

export { ZONE_COLOR_OVERRIDES };

/**
 * colorForZone(id, fallback) — override wins, else the deterministic default.
 * @param {string} id        leaf zoneKey (e.g. 'asia-india-gujarat', 'deaf')
 * @param {string} fallback  the deterministic leafColor() HSL string
 * @returns {string}         hex override if present for `id`, else `fallback`
 */
export function colorForZone(id, fallback) {
  const ov = ZONE_COLOR_OVERRIDES[id];
  return (typeof ov === 'string' && ov) ? ov : fallback;
}

export default colorForZone;
