// useSelectedPin.js - Selected Pin Highlight + Animated GO Marker
// When a people group is selected, turns the dot mandarin neon orange and
// floats an animated "GO" location pin above it with a pulsing light glow.

import { watch, inject } from 'vue';
import { emissivePaint, isMapboxMap, engineFor } from './useMapProvider.js';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const GO_ORANGE          = '#1a1a1a';   // Black indicator (was '#FF6600'; a plain black/white pin reads best)
const HIGHLIGHT_LAYER_ID = 'selected-pin-highlight';

/**
 * Create the custom HTML element for the "GO" map pin marker.
 * Self-contained inline <style> so it works inside Mapbox's marker DOM.
 */
function createGoMarkerElement(color = GO_ORANGE) {
    const el = document.createElement("div");
    el.className = "map-go-pin-wrapper";
    const gradId = `pinGrad-${Math.random().toString(36).slice(2, 8)}`;

    el.innerHTML = `
<style>
/* Angled, brush-style pin: a slight tilt, a diagonal gradient and a stronger
   drop-shadow give it a hand-drawn, "set down on the map" look without raster art. */
.map-go-pin-wrapper {
  position: relative;
  width: 32px;
  height: 40px;
  pointer-events: none;
  overflow: visible;
}
.map-go-pin__svg {
  position: relative;
  width: 32px;
  height: 40px;
  filter: drop-shadow(2px 4px 3px rgba(0,0,0,0.4));
}
</style>

<svg
  class="map-go-pin__svg"
  viewBox="-2 -2 32 40"
  xmlns="http://www.w3.org/2000/svg"
  aria-label="Selected people group"
>
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${color}" stop-opacity="0.92"/>
      <stop offset="55%"  stop-color="${color}" stop-opacity="1"/>
      <stop offset="100%" stop-color="#000"     stop-opacity="0.85"/>
    </linearGradient>
  </defs>
      <path
      d="M14 1 C6.8 1 1 6.8 1 14 C1 24 14 35 14 35 C14 35 27 24 27 14 C27 6.8 21.2 1 14 1 Z"
      fill="none" stroke="white" stroke-width="2" stroke-linejoin="round"
    />
    <path
      d="M14 1 C6.8 1 1 6.8 1 14 C1 24 14 35 14 35 C14 35 27 24 27 14 C27 6.8 21.2 1 14 1 Z"
      fill="url(#${gradId})"
    />
</svg>
`;

    return el;
}

/**
 * useSelectedPin composable
 *
 * @param {Object}   options
 * @param {Function} options.getMap  - Returns the mapboxgl.Map instance (or null)
 */
export function useSelectedPin(options = {}) {
    const { getMap = () => null, getActivePinColor: getActivePinColorOpt = null } = options;
    const uiStore = inject('uiStore');

    let _markerEl  = null;
    let _marker    = null;

    // Dynamic pin color (the pin matches the active tab's
    // dot color so a click on a green dot shows a green pin, red shows red,
    // etc.). Falls back to the literal GO_ORANGE constant if the parent
    // profile didn't provide a resolver.
    // Prefer the resolver passed in via options (from the profile's setup). A Vue 3
    // component CANNOT inject('getActivePinColor') against its OWN provide — inject
    // resolves against the parent/app provide chain, never the instance's own provides
    // — and no ancestor (ProfileLoader) supplies this key, so the inject below always
    // returned null. That made _currentColor fall through to GO_ORANGE ('#1a1a1a',
    // black) on every selection (the dot/marker rendered black). Passing the resolver
    // as an option (like getMap) is the only path that actually resolves at runtime;
    // inject is kept purely as a no-op fallback for callers that don't pass it.
    const getActivePinColor = getActivePinColorOpt ?? inject("getActivePinColor", null);
    let _currentColor = GO_ORANGE;

    function _addHighlightLayer() {
        const map = getMap();
        if (!map) return;
        if (map.getLayer(HIGHLIGHT_LAYER_ID)) return;
        if (!map.getSource('language-families')) return;

        map.addLayer({
            id: HIGHLIGHT_LAYER_ID,
            type: 'circle',
            source: 'language-families',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 3, 2, 3.5, 4, 4, 5, 5, 6, 6.5, 7, 8, 8, 10, 10, 14, 12, 18, 14, 22
                ],
                'circle-color'         : _currentColor,
                // Mapbox Standard v3 lights custom circle layers by the lightPreset; WITHOUT an
                // emissive strength the circle is modulated by the scene light and gets darkened
                // to near-black (night preset, and the not-yet-settled boot-time lighting right
                // after a page reload). Setting it to 1 makes the selected-pin highlight render
                // its OWN colour identically in day + night. Mirror of language-family-pins
                // (useMapLayers.js:248) — without this the selected dot turned black on first
                // click after a reload until a tab switch re-lit the layer.
                ...emissivePaint(map),
                'circle-opacity'       : 1,
                'circle-stroke-width'  : 2,
                'circle-stroke-color'  : '#FFFFFF',
                'circle-stroke-opacity': 1
            },
            filter: ['==', ['get', 'uniqueId'], '__none__']
        });

    }

    function _ensureMarkerEl() {
        // The floating GO / popup-indicator "plan" pin is ALWAYS black (coder wants the
        // indicator pin black). ONLY the on-map selected-DOT highlight circle follows the
        // active strategy colour (_currentColor, set in updateSelectedPin) — the marker
        // deliberately does NOT, so it stays black regardless of the selected dot's colour.
        if (!_markerEl) {
            _markerEl = createGoMarkerElement(GO_ORANGE);
        }
    }

    function _showMarker(lng, lat) {
        const map = getMap();
        if (!map) return;

        _ensureMarkerEl();

        if (_marker) {
            _marker.remove();
        }

        // anchor:'bottom' pins the marker's bottom edge to the lat/lng.
        // After the wrapper resize to match the SVG (43px), the bottom edge
        // IS the pin's tip — no offset compensation needed.
        // engineFor, not the bare `mapboxgl` global: under MapLibre there may be no Mapbox global
        _marker = new (engineFor(map).Marker)({
            element : _markerEl,
            anchor  : 'bottom',
            offset  : [0, 0]
        })
            .setLngLat([lng, lat])
            .addTo(map);
    }

    function _hideMarker() {
        if (_marker) {
            _marker.remove();
            _marker = null;
        }
    }

    function updateSelectedPin(feature) {
        const map = getMap();
        if (!map) return;

        // Resolve the pin color from the active tab strategy each call — but ONLY when
        // there is a feature. On DESELECT (feature == null, e.g. closing the detail modal)
        // the highlight is hidden below, so the colour is irrelevant; calling the strategy
        // resolver with undefined properties throws (getPrayerLevel reads
        // properties.peoplePraying), and that thrown error aborts the reactive update,
        // which is what left the people-group detail modal unable to close (its X handler
        // sets selectedPeopleGroup=null → this watcher → crash). Guarding here fixes that.
        if (feature) {
            _currentColor = getActivePinColor?.(feature.properties) ?? GO_ORANGE;
        }
        // Ensure the layer exists, then ALWAYS (re)assert BOTH the colour and the
        // emissive strength on every selection. circle-emissive-strength:1 is
        // re-asserted defensively here (not only in _addHighlightLayer) because the
        // layer is first added at boot under not-yet-settled Standard lighting; the
        // first click after a page reload could otherwise render the emissive-less
        // circle near-black until a tab switch re-lit it. Re-asserting on every
        // selection makes the highlight show its own colour regardless of when the
        // style finished loading. (selected-dot-turns-black-on-first-click fix.)
        _addHighlightLayer();
        if (map.getLayer(HIGHLIGHT_LAYER_ID)) {
            map.setPaintProperty(HIGHLIGHT_LAYER_ID, "circle-color", _currentColor);
            // Mapbox-only lighting prop — MapLibre logs an error for unknown paint props.
            if (isMapboxMap(map)) map.setPaintProperty(HIGHLIGHT_LAYER_ID, "circle-emissive-strength", 1);
        }

        if (!feature) {
            if (map.getLayer(HIGHLIGHT_LAYER_ID)) {
                map.setFilter(HIGHLIGHT_LAYER_ID, ['==', ['get', 'uniqueId'], '__none__']);
            }
            _hideMarker();
            return;
        }

        const uniqueId = feature.properties?.uniqueId || '__none__';
        const coords   = feature.geometry?.coordinates;

        if (!coords) {
            return;
        }

        if (map.getLayer(HIGHLIGHT_LAYER_ID)) {
            map.setFilter(HIGHLIGHT_LAYER_ID, ['==', ['get', 'uniqueId'], uniqueId]);
        }

        const [lng, lat] = coords;
        _showMarker(lng, lat);

    }

    watch(
        () => uiStore.selectedPeopleGroup,
        (newFeature) => {
            updateSelectedPin(newFeature);
        }
    );

    function initialize() {
        _addHighlightLayer();
    }

    function cleanup() {
        _hideMarker();
        _markerEl = null;
    }

    return { initialize, cleanup, updateSelectedPin };
}
