<script setup>
/**
 * LegendSlot.vue — STUB. Poster-rendering slot for LegendSlot.
 * Wired into PosterPreview.vue. Real implementation pending — see
 * the build-friction notes
 * (Friction 13/14: Wave-3 poster agent ran out before finishing slots).
 */
defineProps({ spec: { type: Object, default: () => ({}) } })
</script>

<template>
  <div class="poster-slot poster-slot--LegendSlot" data-slot="LegendSlot">
    <!-- LegendSlot stub — implement when poster export is wired -->
  </div>
</template>

<style scoped>
.poster-slot { display:none; }
</style>
