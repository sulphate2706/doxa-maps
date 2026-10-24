<!--
  PosterPreview.vue — scaled live preview of the poster composition.

  - Captures the source map's current canvas as a low-res PNG snapshot
    (re-captured whenever the spec changes substantially).
  - Renders the slot SVG components on top, sized via usePosterLayout.
  - Scales the entire composition to fit the available container width.
-->
<template>
  <div ref="rootEl" class="poster-preview">
    <div
      class="poster-preview__page"
      :style="pageStyle"
    >
      <img
        v-if="snapshot"
        class="poster-preview__map"
        :src="snapshot"
        :style="boxStyle(layout.map)"
        :alt="T('poster.map_preview', 'map preview')"
      />
      <div v-else class="poster-preview__map placeholder" :style="boxStyle(layout.map)">
        {{ T('poster.loading_snapshot', 'Loading map snapshot…') }}
      </div>

      <TitleSlot
        v-if="spec.slots?.title"
        class="poster-preview__slot"
        :style="boxStyle(layout.title)"
        :title="spec.slots.title.text"
        :subtitle="spec.slots.title.subtitle"
      />

      <LegendSlot
        v-if="spec.slots?.legend && spec.slots.legend.rows?.length"
        class="poster-preview__slot"
        :style="boxStyle(layout.legend)"
        :rows="spec.slots.legend.rows"
        :type="spec.slots.legend.type"
      />

      <ScaleBarSlot
        v-if="spec.slots?.scaleBar"
        class="poster-preview__slot"
        :style="boxStyle(layout.scaleBar)"
        :map-bounds="mapBoundsRef"
        :map-center-lat="centerLat"
      />

      <NorthArrowSlot
        v-if="spec.slots?.north"
        class="poster-preview__slot"
        :style="boxStyle(layout.north)"
        :bearing="bearing"
      />

      <FooterSlot
        class="poster-preview__slot"
        :style="boxStyle(layout.footer)"
        :left="spec.slots?.footer?.left"
        :right="spec.slots?.footer?.right"
        :attribution="spec.slots?.footer?.attribution"
        :metadata="metadata"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { tStatic } from '../../i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in.
const T = (key, en) => tStatic(key) || en
import TitleSlot      from './slots/TitleSlot.vue';
import LegendSlot     from './slots/LegendSlot.vue';
import ScaleBarSlot   from './slots/ScaleBarSlot.vue';
import NorthArrowSlot from './slots/NorthArrowSlot.vue';
import FooterSlot     from './slots/FooterSlot.vue';
import { computeLayout } from '../../composables/poster/usePosterLayout.js';
import { posterPixels }  from '../../composables/poster/useMapPoster.js';

const props = defineProps({
  spec:       { type: Object, required: true },
  getMap:     { type: Function, required: true },
  legendRows: { type: Array,  default: () => [] },
  metadata:   { type: Object, default: () => ({}) },
});

const rootEl     = ref(null);
const snapshot   = ref('');
const containerW = ref(800);
const bearing    = ref(0);
const centerLat  = ref(0);
const mapBoundsRef = ref(null);

const px = computed(() => posterPixels(props.spec));
const layout = computed(() => computeLayout(props.spec, px.value));

const scale = computed(() => {
  const w = px.value.width;
  if (!w) return 1;
  // Cap preview at container width; never scale up past 1.
  return Math.min(1, (containerW.value - 24) / w);
});

const pageStyle = computed(() => ({
  width:  px.value.width  + 'px',
  height: px.value.height + 'px',
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
  background: '#fff',
  position: 'relative',
  boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
}));

function boxStyle(box) {
  if (!box) return { display: 'none' };
  return {
    position: 'absolute',
    left:   box.x + 'px',
    top:    box.y + 'px',
    width:  box.w + 'px',
    height: box.h + 'px',
  };
}

let resizeObs = null;
onMounted(() => {
  if (rootEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => {
      containerW.value = rootEl.value?.clientWidth || 800;
    });
    resizeObs.observe(rootEl.value);
    containerW.value = rootEl.value.clientWidth;
  }
  _refreshSnapshot();
});

onUnmounted(() => {
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
});

watch(() => [props.spec.widthIn, props.spec.heightIn, props.spec.orientation, props.spec.dpi], () => {
  _refreshSnapshot();
});

async function _refreshSnapshot() {
  const map = props.getMap?.();
  if (!map) return;
  try {
    if (!map.loaded() || map.isMoving()) {
      await new Promise((res) => map.once('idle', res));
    }
    snapshot.value = map.getCanvas().toDataURL('image/png');
    bearing.value  = map.getBearing?.() || 0;
    const c        = map.getCenter?.();
    centerLat.value = c?.lat || 0;
    mapBoundsRef.value = map.getBounds?.();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[PosterPreview] snapshot failed', err);
  }
}
</script>

<style scoped>
.poster-preview {
  width: 100%;
  height: 100%;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 0;
}
.poster-preview__page { display: block; }
.poster-preview__map  { object-fit: cover; display: block; }
.poster-preview__map.placeholder {
  display: flex; align-items: center; justify-content: center;
  background: #ddd; color: #555; font-size: 14px;
}
.poster-preview__slot { pointer-events: none; }
</style>
