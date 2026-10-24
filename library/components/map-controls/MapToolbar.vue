<!--
  MapToolbar.vue — Positioned layout shell for map control buttons.

  ONLY responsible for the visual column layout
  (position: absolute, flex-direction: column, gap, z-index).

  Contains NO button logic and NO map reference. Exposes a default slot so
  the application profile can place any combination of button components
  inside — each bound explicitly to their own map instance.

  Multi-map usage pattern (two separate maps in one profile):

    MapToolbar > ZoomInButton :map="mapA"  ...
    MapToolbar > ZoomInButton :map="mapB"  ...

  Props:
    has-geocoder (Boolean, default true) — whether a geocoder/search pill is
    rendered above the toolbar on mobile. When false, the mobile top offset
    collapses to the same 10px used on desktop (no wasted space above the
    first control button). Default preserves the legacy mobile layout for
    profiles that DO mount a geocoder.
-->
<script setup>
import { computed, ref, provide } from 'vue'
import { useShadowStyles } from '../../composables/useShadowStyles.js'

const props = defineProps({
  hasGeocoder: { type: Boolean, default: true },
  /**
   * 'round' (default) keeps the separate floating circles every map ships today.
   * 'square' is the ENGINE'S OWN grouped card -- one white panel, 4px corners, a 2px ring and 1px
   * dividers -- which is the look asked for by name. Measured from
   * node_modules/maplibre-gl/dist/maplibre-gl.css, not invented:
   *     .maplibregl-ctrl-group             { background:#fff; border-radius:4px }
   *     .maplibregl-ctrl-group:not(:empty) { box-shadow:0 0 0 2px rgba(0,0,0,.1) }
   *     .maplibregl-ctrl-group button      { width:29px; height:29px; background:transparent; border:0 }
   *     .maplibregl-ctrl-group button+button { border-top:1px solid #ddd }
   * ★ SQUARE IS NOT A RADIUS SWAP, which is why it lives here and not only on the button: round
   * controls are separate boxes with a gap and a shadow each, and the engine's square form is ONE
   * container that owns the background, the corners and the ring while its buttons own nothing. Set
   * border-radius:0 on the buttons alone and you get squares floating 8px apart -- neither shape.
   * ★ THE 29px IS DELIBERATELY NOT PORTED. Ours stay --map-btn-size (capped to 32px in this
   * toolbar). 29px would shrink the touch target below what this project has already ruled on twice,
   * so the variant takes the SHAPE and leaves the SIZE. It is therefore not pixel-identical to the
   * engine's controls, and that is a choice rather than an oversight.
   */
  controls: { type: String, default: 'round' },
})

// The toolbar's element is provided to its controls: MapControlMenu measures it to place
// every menu at the toolbar's top, on its inner side, no taller than the control column.
const toolbarEl = ref(null)
// The shape rides the EXISTING inject so every control reads ONE source of truth. The visual work is
// done by CSS descendant rules below -- nothing has to pass a matching prop to each button -- but
// MapControlMenu measures this column, and a square toolbar is SHORTER (gap:0), so a menu using
// matchToolbar gets a shorter box. Anything that needs to know can read it here instead of guessing.
provide('mapToolbar', { el: toolbarEl, shape: computed(() => (props.controls === 'square' ? 'square' : 'round')) })

useShadowStyles(`
/* ★ NOT ON PAPER (measured on a print of fc93c97e4). Printing a full-bleed map leaf put the whole
   control column — zoom in, zoom out, locate, fullscreen, share — on the sheet, over the map it
   is meant to operate. Every one of them is a pointer affordance with nothing to do on paper.
   The engine's own control groups go too, for the maps that place them outside this toolbar; the
   ATTRIBUTION is deliberately left alone, because it is a licence term, not chrome. */
@media print {
  .map-toolbar,
  .mapboxgl-ctrl-group,
  .maplibregl-ctrl-group,
  .mapboxgl-ctrl-attrib-button,
  .maplibregl-ctrl-attrib-button { display: none !important; }
}
.map-toolbar {
  position: absolute;
  top: 6px;
  /* Sit the control column near the edge with a small symmetric padding (3px) —
     same value works whether the toolbar is swapped to the left or right side, and
     it lines up with the search bar's 3px side inset. coder 2026-06-24. */
  inset-inline-end: 3px;   /* mirrors to the left on right-to-left pages */
  display: flex;
  flex-direction: column;
  gap: var(--map-toolbar-gap, 8px);
  z-index: 10;
}
/* Slim every toolbar control to a fixed 32px (coder 2026-06-24: "buttons can be
   smaller"): smaller but still tappable, and uniform so they all align. The icons
   inside stay their own fixed px sizes (they don't scale with the button), so they
   remain legible — "icons fixed in their sizing". Caps the responsive
   --map-btn-size (40/36/32). FullscreenButton.vue is not edited; it slims here too. */
.map-toolbar .mcb,
.map-toolbar .hbg-btn { width: 32px; height: 32px; }
.map-toolbar .hbg-ctrl { margin: 10px 0 0 0; }  /* drop the 6px left offset so it lines up with the rest */

/* ── controls="square": the ENGINE'S grouped card, ported ───────────────────────────────── */
.map-toolbar--square {
  gap: 0;                                        /* the group is one panel, not a spaced column */
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);      /* .maplibregl-ctrl-group:not(:empty) */
}
/* The buttons own nothing: no corners, no shadow, no fill. The panel owns all three. */
.map-toolbar--square .mcb,
.map-toolbar--square .hbg-btn {
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}
/* button+button -> a 1px divider. Written on the toolbar's CHILDREN rather than on .mcb pairs
   because some controls wrap their button in an element of their own (.hbg-ctrl), and a divider
   that only knew about .mcb would vanish exactly where two different control types meet. */
.map-toolbar--square > * + * { border-top: 1px solid #ddd; }
/* .hbg-ctrl's 10px top margin would tear the panel apart; inside the group it has no business. */
.map-toolbar--square .hbg-ctrl { margin: 0; }
/* ★ ShareButton IS NOT A .mcb, so the rules above missed it. It wraps its button in a .share-wrap div
   carrying border-radius:50% plus a conic-gradient ring on ::before at inset:-2px -- which inside the
   panel reads as a circular rainbow halo poking out of one corner, breaking the single-card illusion
   at exactly the place the eye lands. Measured at 390, the question was whether square should flatten
   it; it should: in this variant the PANEL owns the outline, so a child may not bring its own.
   The round default keeps its ring untouched. */
.map-toolbar--square .share-wrap { border-radius: 0; }
.map-toolbar--square .share-wrap::before { display: none; }
/* ★ OUTER CORNERS ONLY, AND NO overflow:hidden. Clipping would have been the quick way to round
   the panel, but it also clips a focus ring on any inner button -- and the engine does not do it:
   it rounds the first and last buttons instead (button:focus:first-child -> 4px 4px 0 0, :last-child
   -> 0 0 4px 4px, :only-child -> inherit). Ported as their mechanism. MapControlMenu teleports out of
   this element into the map area, so clipping would not have hidden a menu -- the focus ring is the
   real cost, and it is the invisible kind. */
.map-toolbar--square > :first-child,
.map-toolbar--square > :first-child .mcb,
.map-toolbar--square > :first-child .hbg-btn { border-radius: 4px 4px 0 0; }
.map-toolbar--square > :last-child,
.map-toolbar--square > :last-child .mcb,
.map-toolbar--square > :last-child .hbg-btn { border-radius: 0 0 4px 4px; }
.map-toolbar--square > :only-child,
.map-toolbar--square > :only-child .mcb,
.map-toolbar--square > :only-child .hbg-btn { border-radius: 4px; }
/* ★ FORCED COLOURS, which our round buttons have never had. The engine ships this pair because a
   rgba() ring and a #ddd divider both disappear when the user's own palette replaces them, leaving
   one undifferentiated block where the controls were. */
@media (forced-colors: active) {
  .map-toolbar--square { box-shadow: 0 0 0 2px ButtonText; }
  .map-toolbar--square > * + * { border-top: 1px solid ButtonText; }
}

@media (max-width: 767px) {
  /* Mobile (with geocoder): drop the toolbar well below the search bar so
     it doesn't sit flush against the search pill. Search = top:10,
     height ~36, bottom:46. top:72 leaves a comfortable ~26px gap. */
  .map-toolbar { top: 72px; gap: 6px; }
  /* Mobile (no geocoder): collapse the reserved gap — controls sit flush
     to the top of the map area with the same 6px inset used on desktop. */
  .map-toolbar.map-toolbar--no-geocoder { top: 6px; gap: 6px; }
  /* ★ THE SQUARE PANEL MUST NOT GET ITS GAPS BACK HERE, and it would have. A media query adds NO
     specificity, so the .map-toolbar gap:6px rule above is (0,1,0) exactly like the
     .map-toolbar--square gap:0 rule -- and it comes LATER in the sheet, so it won. On any phone a
     square toolbar would have fallen back into six separate buttons inside one ringed panel: the
     shape breaking precisely where a reader is most likely to look at it.
     The --no-geocoder pair is (0,2,0) and outranked the variant regardless of order, so it needs the
     two-class form to answer it. Same lesson as the goal cards' gap-vs-margin: a ported mechanism is
     only ported if it still WINS. */
  .map-toolbar--square,
  .map-toolbar--square.map-toolbar--no-geocoder { gap: 0; }
}
`, 'map-toolbar')
</script>

<template>
  <div ref="toolbarEl" class="map-toolbar"
       :class="{ 'map-toolbar--no-geocoder': !hasGeocoder, 'map-toolbar--square': controls === 'square' }">
    <slot />
  </div>
</template>