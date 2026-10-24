<script setup>
/**
 * FooterSlot.vue — STUB. Poster-rendering slot for FooterSlot.
 * Wired into PosterPreview.vue. Real implementation pending — see
 * the build-friction notes
 * (Friction 13/14: Wave-3 poster agent ran out before finishing slots).
 */
defineProps({ spec: { type: Object, default: () => ({}) } })
</script>

<template>
  <div class="poster-slot poster-slot--FooterSlot" data-slot="FooterSlot">
    <!-- FooterSlot stub — implement when poster export is wired -->
  </div>
</template>

<style scoped>
.poster-slot { display:none; }
</style>
