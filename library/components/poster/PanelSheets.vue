<!--
  PanelSheets.vue — SHARED. A preview of a large poster as the sheets it prints on: the sheets pulled apart, each
  join's under-strip drawn as a red "glue here" band, the trimmed edges and the "s / N" tags, the way a reader
  will assemble it on the wall. The geometry is panelSheets.js (the same plan the print uses).

  - Give it `src` (the finished poster as one image or SVG URL) and each sheet shows its own slice of it, cut with
    CSS (an overflow:hidden box, the image sized to the whole poster and offset by the sheet's place). Or use
    the scoped slot #sheet="{ s, slice, band }" to draw a sheet yourself.
  - It fills its container's width; its height follows the layout's aspect. The container decides the size.
  - It handles no pointer events (pointer-events:none throughout), so a card can make the preview its control.
  - It emits ONE `load` when `src` has loaded, or ONE `error` when it cannot, per src.
  - The red band is always drawn here, even for a poster whose print BLEEDS under the join: a preview's job is
    to show how the pieces go together.
  Styles go in through useShadowStyles, because it renders inside a plugin's shadow root.
-->
<template>
  <div class="pnl" :style="{ aspectRatio: aspect }" aria-hidden="true">
    <div v-for="sh in view" :key="sh.s" class="pnl-sheet" :style="sh.box">
      <img v-if="src && !failed" class="pnl-img" :src="src" alt="" draggable="false" :style="sh.img">
      <slot name="sheet" :s="sh.s" :slice="sh.slice" :band="sh.band"></slot>
      <svg class="pnl-marks" :viewBox="`0 0 ${plan.sheetW} ${plan.sheetH}`" preserveAspectRatio="none">
        <g v-if="sh.band">
          <rect :x="sh.band.x" :y="sh.band.y" :width="sh.band.w" :height="sh.band.h" fill="rgba(176,0,0,.14)" />
          <line v-bind="sh.bandEdge" stroke="#b00" :stroke-width="stroke" :stroke-dasharray="`${stroke * 4} ${stroke * 3}`" />
        </g>
        <line v-if="sh.trimEdge" v-bind="sh.trimEdge" stroke="#999" :stroke-width="stroke" />
      </svg>
      <!-- Text in HTML, not in the stretched SVG, so it keeps its proportions; sized in the sheet's own units. -->
      <div v-if="sh.band" class="pnl-glue" :class="{ h: horizontal }" :style="sh.bandBox">
        <span :style="{ fontSize: sh.labelFs }">{{ glueHere }} <svg v-if="horizontal" class="pnl-arr" viewBox="0 0 10 10"><path d="M1 5 9 1v8z" fill="currentColor"/></svg><template v-else>▲</template> <bdi dir="ltr">{{ sh.s }} / {{ plan.count }}</bdi></span>
      </div>
      <div class="pnl-tag" dir="ltr" :style="{ fontSize: sh.tagFs }">{{ sh.s + 1 }} / {{ plan.count }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { planPanels, sliceFor, screenLayout } from './panelSheets.js'
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { useOptionalT } from '../../composables/useOptionalT.js'

const props = defineProps({
  /** One printed sheet, in inches. */
  sheetW: { type: Number, required: true },
  sheetH: { type: Number, required: true },
  count: { type: Number, default: 1 },
  direction: { type: String, default: 'vertical' },   // 'vertical' (stacked) | 'horizontal' (side by side)
  /** How far each sheet slides under the one before it (inches). */
  joinIn: { type: Number, default: 0 },
  /** The gap drawn between sheets, in inches (the Bless wall uses 0.75). */
  gapIn: { type: Number, default: 0.75 },
  /** The finished poster as one image (webp/png/svg URL). Optional: the #sheet slot can draw instead. */
  src: { type: String, default: '' },
  /** Translated strings: { glueHere }. Without one, the catalogue's poster.glue_here in the reader's language. */
  labels: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['load', 'error'])

// The preview shows the finished poster continuing under each band ('bleed'), so a sliced image lines up.
const plan = computed(() => planPanels({ sheetW: props.sheetW, sheetH: props.sheetH, count: props.count,
  direction: props.direction, joinIn: props.joinIn, joinFill: 'bleed' }))
const horizontal = computed(() => plan.value.direction === 'horizontal')
const layout = computed(() => screenLayout(plan.value, { gapIn: props.gapIn, pxPerIn: 1 }))
const aspect = computed(() => `${layout.value.worldW} / ${layout.value.worldH}`)
const t = useOptionalT('poster')
const glueHere = computed(() => props.labels.glueHere || t('poster.glue_here'))
// Marks scale with the sheet: a line ~1/300 of the sheet's short side, text from the band's depth.
const stroke = computed(() => Math.min(plan.value.sheetW, plan.value.sheetH) / 300)
const pct = (v, of) => `${(v / of) * 100}%`

const view = computed(() => {
  const P = plan.value, L = layout.value, F = P.finished
  return L.sheets.map((r) => {
    const sh = P.sheets[r.s], slice = sliceFor(P, r.s), b = sh.band
    const H = P.direction === 'horizontal'
    // font sizes as a share of the SHEET's width, via container query units (the sheet is the container)
    const cq = (inches) => `${(inches / P.sheetW) * 100}cqw`
    return {
      s: r.s, slice, band: b,
      box: { left: pct(r.x, L.worldW), top: pct(r.y, L.worldH), width: pct(r.w, L.worldW), height: pct(r.h, L.worldH) },
      // the whole finished poster behind this sheet, shifted so the sheet's slice shows
      img: { width: pct(F.w, P.sheetW), height: pct(F.h, P.sheetH), left: pct(-sh.at.x, P.sheetW), top: pct(-sh.at.y, P.sheetH) },
      bandBox: b ? { left: pct(b.x, P.sheetW), top: pct(b.y, P.sheetH), width: pct(b.w, P.sheetW), height: pct(b.h, P.sheetH) } : null,
      bandEdge: b ? (H ? { x1: b.w, y1: 0, x2: b.w, y2: P.sheetH } : { x1: 0, y1: b.h, x2: P.sheetW, y2: b.h }) : null,
      trimEdge: sh.trimmed ? (H ? { x1: P.sheetW, y1: 0, x2: P.sheetW, y2: P.sheetH } : { x1: 0, y1: P.sheetH, x2: P.sheetW, y2: P.sheetH }) : null,
      labelFs: cq(Math.min(P.joinIn * 0.16, P.sheetW * 0.03)),
      tagFs: cq(Math.max(0.35, Math.min(P.sheetW, P.sheetH) * 0.02)),
    }
  })
})

// ONE load or error per src, from one probe image (the per-sheet <img>s share its cached response). A src that
// fails shows blank sheets, never the browser's broken-image icon; the card says why.
const failed = ref(false)
let probe = null
watch(() => props.src, (src) => {
  if (probe) { probe.onload = probe.onerror = null; probe = null }
  failed.value = false
  if (!src || typeof Image === 'undefined') return
  const img = new Image()
  probe = img
  img.onload = () => { if (probe === img) { probe = null; emit('load') } }
  img.onerror = () => { if (probe === img) { probe = null; failed.value = true; emit('error') } }
  img.src = src
}, { immediate: true })
onBeforeUnmount(() => { if (probe) { probe.onload = probe.onerror = null; probe = null } })

useShadowStyles(
  '.pnl{position:relative;width:100%;pointer-events:none;user-select:none}' +
  '.pnl-sheet{position:absolute;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.28);container-type:inline-size}' +
  '.pnl-img{position:absolute;max-width:none;display:block;object-fit:fill}' +
  '.pnl-marks{position:absolute;inset:0;width:100%;height:100%;overflow:visible}' +
  '.pnl-glue{position:absolute;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
  '.pnl-glue span{color:#b00;font:700 1em/1.1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;background:rgba(255,255,255,.82);padding:.1em .35em;border-radius:.2em}' +
  '.pnl-glue.h span{writing-mode:vertical-rl}' +
  '.pnl-arr{width:.8em;height:.8em;vertical-align:middle;display:inline-block}' +
  '.pnl-tag{position:absolute;top:1.5%;right:2%;color:#999;font:600 1em/1 system-ui,-apple-system,"Segoe UI",sans-serif}',
  'panel-sheets'
)
</script>
