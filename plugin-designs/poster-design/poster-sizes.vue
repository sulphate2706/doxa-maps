<script setup>
/**
 * poster-sizes.vue: every poster size, drawn to scale, with the sheets each one prints on.
 *
 * @element poster-design
 * @description Every poster size the print picker offers, from standard paper to 5 × 8 ft, drawn to scale.
 *   A size that prints on several sheets shows them pulled apart with the red strip where the next sheet is
 *   glued on, as the Wall of People Groups previews its 5 × 8 ft poster.
 *
 * The sizes are the ONE shared ladder (library/constants/posterSizes.js POSTER_LADDER, in
 * POSTER_LADDER_ORDER), never a second list: a size the ladder gains appears here by itself. Each size's
 * `sheets` goes straight into the library's PanelSheets, the same component and the same geometry
 * (panelSheets.js) the print uses. What fills the sheets is the 3 × 3 country poster's LAYOUT drawn at that
 * size (src/layoutSvg.js), labelled as a layout, because the renderer does not draw the large sizes yet.
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import PanelSheets from '@map/components/poster/PanelSheets.vue'
import { planPanels, screenLayout } from '@map/components/poster/panelSheets.js'
import { POSTER_LADDER, POSTER_LADDER_ORDER, paperFor } from '@map/constants/posterSizes.js'
import { useOptionalT, useOptionalI18n } from '@map/composables/useOptionalT.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { layoutSvgUrl } from './src/layoutSvg.js'
import { num, dimsText } from './src/sizeText.js'

const t = useOptionalT('')
const { locale } = useOptionalI18n('')

// Sizes are named the one way Poster Design names them (src/sizeText.js, shared with Styles).
const n = num
const dims = (w, h) => dimsText(w, h, t)
// Standard printer paper is Letter or A4 by the reader's region, as the print picker decides it.
const paperIsA4 = computed(() => {
  const l = locale && (locale.value ?? locale)
  const tag = (typeof navigator !== 'undefined' && navigator.language) || (typeof l === 'string' ? l : '') || 'en'
  return paperFor(tag) === 'a4'
})

const sizes = computed(() => POSTER_LADDER_ORDER.map((key) => POSTER_LADDER[key]).filter(Boolean).map((s) => {
  const { sheetW, sheetH, count, direction, joinIn } = s.sheets
  return {
    key: s.id,
    w: s.inches.w,
    h: s.inches.h,
    sheets: { sheetW, sheetH, count, direction, joinIn },
    title: s.paper ? t('posterDesign.sizes.paper') : dims(s.inches.w, s.inches.h),
    subtitle: s.paper ? t(paperIsA4.value ? 'posterDesign.sizes.paperA4' : 'posterDesign.sizes.paperLetter') : '',
    count,
    sheetDims: dims(sheetW, sheetH),
    overlap: count > 1 ? t('posterDesign.sizes.dimsInOne', { v: n(joinIn) }) : '',
    photos: !!s.photos,
    shop: s.path === 'pdf',
    src: layoutSvgUrl(s.inches.w, s.inches.h),
  }
}))

// The box PanelSheets draws, in inches: its own screenLayout of the same plan, so a fit computed here is the fit
// it renders (each sheet whole, pulled apart by the gap, which is taller than the finished poster).
const LINEUP_GAP_IN = 1.5
const CARD_GAP_IN = 0.75
function world(s, gapIn) {
  const L = screenLayout(planPanels(s.sheets), { gapIn, pxPerIn: 1 })
  return { w: L.worldW, h: L.worldH }
}

// THE LINEUP: every size at ONE scale, standing on one baseline, so 5 × 8 ft looks as big beside paper as it
// is. Each size gets an equal column; the scale is the largest at which the tallest drawing is LINEUP_H and
// the widest still fits its column, so on a phone every size stays in view and stays to scale.
const LINEUP_H = 240                               // px for the tallest size, when there is room
const COL_GAP = 12
const rowEl = ref(null)
const rowW = ref(1000)
let ro = null
onMounted(() => {
  if (!rowEl.value || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(([e]) => { if (e && e.contentRect.width) rowW.value = e.contentRect.width })
  ro.observe(rowEl.value)
})
onBeforeUnmount(() => { ro?.disconnect(); ro = null })
const pxPerIn = computed(() => {
  const ws = sizes.value.map((s) => world(s, LINEUP_GAP_IN))
  if (!ws.length) return 1
  const col = (rowW.value - COL_GAP * (ws.length - 1)) / ws.length
  return Math.min(LINEUP_H / Math.max(...ws.map((w) => w.h)), col / Math.max(...ws.map((w) => w.w)))
})
const lineupW = (s) => `${Math.max(4, world(s, LINEUP_GAP_IN).w * pxPerIn.value)}px`

useShadowStyles(`
:host{display:block;width:100%;height:100%;min-height:420px}
.pd-sizes{position:absolute;inset:0;overflow-y:auto;padding:24px 20px 40px;background:#f3f3f1;color:#3b463d;
  font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;box-sizing:border-box}
.pd-sizes__h{margin:0 0 6px;font-size:22px;font-weight:700}
.pd-sizes__intro{margin:0 0 18px;max-width:70ch;color:#6d766e}
.pd-lineup{background:#fff;border:1px solid #d1d4cd;border-radius:12px;padding:16px 16px 10px;margin:0 0 24px}
.pd-lineup__h{margin:0 0 12px;font-size:14px;font-weight:700;color:#6d766e}
.pd-lineup__row{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);align-items:end;gap:12px;
  padding-bottom:6px;border-bottom:2px solid #d1d4cd}
.pd-lineup__item{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0}
.pd-lineup__label{font-size:12px;font-weight:600;text-align:center;line-height:1.25;overflow-wrap:anywhere}
.pd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.pd-card{background:#fff;border:1px solid #d1d4cd;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.pd-card__art{display:flex;justify-content:center;align-items:flex-end;height:220px;background:#f3f3f1;border-radius:8px;padding:10px;box-sizing:border-box}
.pd-card__art > .pd-card__fit{height:100%;display:flex;align-items:flex-end;justify-content:center;width:100%}
.pd-card__title{margin:0;font-size:17px;font-weight:700}
.pd-card__sub{margin:-8px 0 0;color:#6d766e;font-size:13px}
.pd-card__rows{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0;font-size:13px}
.pd-card__rows dt{color:#6d766e}
.pd-card__rows dd{margin:0}
.pd-note{margin:20px 0 0;max-width:70ch;color:#6d766e;font-size:13px}
`, 'poster-design-sizes')

// A card's art box leaves 200 × 222 px for the drawing; it fits by whichever side binds first.
const ART_H = 200
const ART_W = 222
function artWidth(s) {
  const { w, h } = world(s, CARD_GAP_IN)
  return `${Math.floor(w * Math.min(ART_H / h, ART_W / w))}px`
}
</script>

<template>
  <div class="pd-sizes">
    <h2 class="pd-sizes__h">{{ t('posterDesign.sizes.heading') }}</h2>
    <p class="pd-sizes__intro">{{ t('posterDesign.sizes.intro') }}</p>

    <section class="pd-lineup" :aria-label="t('posterDesign.sizes.lineup')">
      <h3 class="pd-lineup__h">{{ t('posterDesign.sizes.lineup') }}</h3>
      <div ref="rowEl" class="pd-lineup__row">
        <div v-for="s in sizes" :key="s.key" class="pd-lineup__item">
          <div :style="{ width: lineupW(s) }">
            <PanelSheets v-bind="s.sheets" :gap-in="LINEUP_GAP_IN" :src="s.src" />
          </div>
          <span class="pd-lineup__label">{{ s.title }}</span>
        </div>
      </div>
    </section>

    <div class="pd-grid">
      <article v-for="s in sizes" :key="s.key" class="pd-card" :data-size="s.key">
        <div class="pd-card__art">
          <div class="pd-card__fit">
            <div :style="{ width: artWidth(s) }"><PanelSheets v-bind="s.sheets" :gap-in="CARD_GAP_IN" :src="s.src" /></div>
          </div>
        </div>
        <h3 class="pd-card__title">{{ s.title }}</h3>
        <p v-if="s.subtitle" class="pd-card__sub">{{ s.subtitle }}</p>
        <dl class="pd-card__rows">
          <dt>{{ t('posterDesign.sizes.rowSheets') }}</dt><dd>{{ s.count }}</dd>
          <template v-if="s.count > 1">
            <dt>{{ t('posterDesign.sizes.rowSheet') }}</dt><dd>{{ s.sheetDims }}</dd>
            <dt>{{ t('posterDesign.sizes.rowOverlap') }}</dt><dd>{{ s.overlap }}</dd>
          </template>
          <dt>{{ t('posterDesign.sizes.rowPhotos') }}</dt><dd>{{ s.photos ? t('posterDesign.sizes.yes') : t('posterDesign.sizes.no') }}</dd>
          <dt>{{ t('posterDesign.sizes.rowPrint') }}</dt><dd>{{ s.shop ? t('posterDesign.sizes.printShop') : t('posterDesign.sizes.printHome') }}</dd>
        </dl>
      </article>
    </div>
    <p class="pd-note">{{ t('posterDesign.sizes.layoutNote') }}</p>
  </div>
</template>
