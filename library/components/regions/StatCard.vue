<!--
  StatCard.vue — one figure with a caption, on the DX-life card surface.

  Their RegionDetail.vue renders a row of these above the map: a big number and a small grey label,
  centred on a small-padding card. That is the whole component, and it is the smallest genuinely
  reusable piece of the regions dashboard.

  ★ THE GRID IS NOT IN HERE, AND THAT IS THE POINT. The plugin's `.rd-stats` container
  (grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))) stays with the CONSUMER. How many
  stats there are and how they wrap is a decision belonging to the page, not to one stat; baking a
  grid into a single card would make it impossible to place one on its own, or two side by side, or
  in a column. So a consumer supplies its own container and puts as many StatCards in it as it has.

  VALUES ARE PRE-FORMATTED BY THE CALLER. `value` is a string or number and is rendered verbatim,
  because number formatting is locale-dependent and the caller already knows the locale -- the
  regions plugin passes formatNumber(n) through its own i18n. This component installs no i18n and
  therefore works on a host that has none.

  CONTRACT: the containing shadow root must carry the DX-life token layer (DXLIFE_TOKENS in the
  regions plugin) and, for the figure to render in the intended face, the Bebas Neue @font-face --
  which is DOCUMENT-scoped and so must be registered on the host document, not in the shadow root.
  See useDocumentFont.js. Without the face the declared fallbacks apply; nothing breaks.
-->
<script setup>
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { useCardSurface } from '../../composables/useCardSurface.js'

defineProps({
  /** The figure. Already formatted for the locale by the caller, e.g. "43,045,275". */
  value: { type: [String, Number], default: '' },
  /** The caption under the figure. Already localized by the caller. */
  label: { type: String, default: '' },
})

// .rd-card / --small, shared with GoalCard under one stable label so only one copy is injected.
useCardSurface()

useShadowStyles(
  // ── .region-stat: RegionDetail.vue's scoped block ──
  '.rd-stat{ text-align:center; }' +
  // ★ THE data-len SHRINK IS GONE, AND ITS OWN COMMENT SHOWED WHY. Their .region-stat__value is
  // font-family-heading + font-size-3xl + line-height:1 and nothing else -- no such attribute exists
  // in their markup. Ours was a shrink-to-fit workaround whose stated premise was "our condensed
  // fallback is wider" than Bebas. That is STALE: Bebas is vendored now (assets/fonts/bebas-neue,
  // glyph oracle 279 = 279 SAME), so there is no wider fallback to compensate for.
  // Its other claim -- "every value DX-life itself renders keeps their size" -- was FALSIFIED by
  // measurement: "43,045,275" (10 chars, so it hit the 'long' bucket) rendered at
  // 38.15px against their 47.68px on the same-width card, while the other three stats matched
  // exactly. A rule whose own invariant is violated in practice is not protecting anything.
  // Deleted WITH its mechanism -- the binding and lenBucket() too, not just the rules.
  '.rd-stat__value{ margin:0; font-size:var(--font-size-3xl); line-height:1;' +
  '  font-family:"Bebas Neue","Arial Narrow",BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;' +
  '  font-weight:400; }' +
  '.rd-stat__label{ margin:var(--spacing-2xs) 0 0; font-size:var(--font-size-sm); color:var(--dx-muted); }'
, 'stat-card')
</script>

<template>
  <div class="rd-card rd-card--small rd-stat">
    <p class="rd-stat__value">{{ value }}</p>
    <p class="rd-stat__label">{{ label }}</p>
  </div>
</template>
