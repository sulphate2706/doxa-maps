<!--
  TitleSlot.vue — renders the poster title strip.

  Uses HTML (not SVG) for sharp text in preview; the headless raster path uses
  its own SVG stub baked into useMapPoster. Font embedding for PDF goes through
  pdf-lib + @pdf-lib/fontkit (caller's concern).
-->
<template>
  <div class="title-slot" :style="wrapperStyle">
    <div class="title-slot__title">{{ title || 'Untitled' }}</div>
    <div v-if="subtitle" class="title-slot__subtitle">{{ subtitle }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { posterDefaults } from '../../../constants/posterDefaults.js';

const props = defineProps({
  title:    { type: String, default: '' },
  subtitle: { type: String, default: '' },
  align:    { type: String, default: 'left' },   // 'left' | 'center' | 'right'
});

defineEmits([]);

const wrapperStyle = computed(() => ({
  textAlign: props.align,
  fontFamily: posterDefaults.title.fontFamily,
  background: 'rgba(255,255,255,0.92)',
  borderBottom: '1px solid #eee',
}));
</script>

<style scoped>
.title-slot {
  padding: 4% 2%;
  display: flex; flex-direction: column; justify-content: center;
  box-sizing: border-box; width: 100%; height: 100%;
  color: #0a0a0a;
}
.title-slot__title {
  font-weight: 700;
  font-size: clamp(20px, 6vw, 64px);
  line-height: 1.05;
  letter-spacing: -0.01em;
}
.title-slot__subtitle {
  margin-top: 0.35em;
  font-weight: 500;
  font-size: clamp(12px, 2.4vw, 28px);
  color: #444;
}
</style>
