<script setup>
/**
 * BarChart.vue — THE SHARED HORIZONTAL BAR CHART (hand-rolled SVG, zero dependencies).
 *
 * Renders a `series` of rows — plain bars, stacked segments, or a row whose value is
 * NOT KNOWN — into inline SVG. Every colour, label and caveat is a PROP: the component
 * knows nothing about gospel resources, cities or languages, so the same file serves
 * any profile that needs to compare quantities across categories.
 *
 * ═══ WHY HAND-ROLLED SVG AND NOT A CHART LIBRARY ════════════════════════════
 * SELF-HOSTED ONLY. A chart CDN request from a persecuted user's device leaks their
 * IP to a third party — that is the privacy-first rule (no third-party calls), and it is a
 * SAFETY rule, not a preference. The alternative to a CDN is vendoring a library the
 * way DataTable.vue vendors Tabulator (443KB, injected at runtime); for bars that is
 * paying a runtime fetch, a shadow-root stylesheet injection and a version to track
 * for shapes the browser already draws natively. So: no library, no fetch, no vendor
 * folder, nothing to leak.
 *
 * ═══ THE ROW THAT IS THE REASON THIS COMPONENT EXISTS ═══════════════════════
 * `{ unknown: true }` renders a HATCHED track and the words "not measured" — never a
 * zero-length bar. In this corpus a pool that was never checked (GRN audio: an API
 * key we do not have) would otherwise draw as an empty bar, and an empty bar reads as
 * "nothing exists for these people" — the exact opposite of "we did not look". A
 * chart is precisely where that distinction gets lost, so the component refuses to
 * draw absence and not-measured the same way.
 *
 * ═══ SIZING: MEASURED, NOT SCALED ═══════════════════════════════════════════
 * The SVG is drawn at the container's REAL pixel width (ResizeObserver), not squeezed
 * through a viewBox. A viewBox scales the text with the box, so the same chart is
 * 13px on a laptop and 8px on a phone — unreadable exactly where readability matters.
 *
 * SHADOW DOM: styles go through useShadowStyles, because a child component's <style>
 * block is silently DROPPED inside a custom element. A chart that renders perfectly in
 * a light-DOM test can render unstyled in the bundle, and the light-DOM test cannot
 * reveal it.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useShadowStyles } from '../../composables/useShadowStyles.js'

const props = defineProps({
  // [{ label, value, segments?, note?, color?, unknown?, unknownText?, meta? }]
  // `segments` = [{ label, value, color }] stacked left-to-right; when present it
  // replaces `value` for drawing (value is still used for the printed total).
  series:      { type: Array,  required: true },
  title:       { type: String, default: '' },
  subtitle:    { type: String, default: '' },
  // Axis caption — say what ONE unit of the bar actually counts. A bar length with no
  // stated unit is a shape, not a measurement.
  unit:        { type: String, default: '' },
  // 0 = scale to the largest row. Set explicitly to compare two charts on one scale.
  max:         { type: Number, default: 0 },
  isDark:      { type: Boolean, default: false },
  barHeight:   { type: Number, default: 24 },
  gap:         { type: Number, default: 10 },
  // 0 = auto (a share of the measured width, clamped) — labels are language and
  // country names here, and they are long.
  labelWidth:  { type: Number, default: 0 },
  color:       { type: String, default: '#10b981' },
  // [{ label, color, note? }] — drawn above the plot; segment charts are unreadable
  // without it.
  legend:      { type: Array,  default: () => [] },
  // Rendered UNDER the chart and never collapsed. Same discipline as DataTable: a
  // summary strips context, so the limits travel with it.
  caveats:     { type: Array,  default: () => [] },
  format:      { type: Function, default: (n) => (Number(n) || 0).toLocaleString() },
  emptyText:   { type: String, default: 'No rows' },
})
const emit = defineEmits(['bar-click'])

const host = ref(null)
const width = ref(0)

// Unique per instance: two charts on one page would otherwise share one <pattern> id
// and the second would resolve the first's fill.
const uid = `bc${Math.random().toString(36).slice(2, 9)}`

let ro = null
onMounted(() => {
  const measure = () => { width.value = host.value?.clientWidth || 0 }
  measure()
  if (typeof ResizeObserver !== 'undefined' && host.value) {
    ro = new ResizeObserver(measure)
    ro.observe(host.value)
  }
})
onBeforeUnmount(() => { try { ro?.disconnect() } catch (_) {} })

const rows = computed(() => (props.series || []).filter(Boolean))

// Label column: a third of the width reads well on a laptop, but a phone needs a
// floor or the names are three characters wide, and a wide screen needs a cap or the
// bars start halfway across.
const labelW = computed(() => {
  if (props.labelWidth > 0) return props.labelWidth
  return Math.max(96, Math.min(260, Math.round((width.value || 640) * 0.34)))
})
// Room on the right for the printed value when a bar runs long.
// The value column fits the LONGEST value label (row 82: a fixed 74px clipped "10,160,000" at the edge
// of a 335px card). ~7px per character at the value font, plus the 8px gap and a margin; never under 74.
const VALUE_GUTTER = computed(() => {
  const longest = Math.max(0, ...rows.value.filter((r) => !r.unknown).map((r) => String(props.format(total(r))).length))
  return Math.max(74, longest * 7 + 16)
})
const plotW = computed(() => Math.max(40, (width.value || 640) - labelW.value - VALUE_GUTTER.value))

const rowStep = computed(() => props.barHeight + props.gap)
const svgH = computed(() => Math.max(rowStep.value, rows.value.length * rowStep.value + 6))

const total = (r) => Array.isArray(r.segments) && r.segments.length
  ? r.segments.reduce((n, s) => n + (Number(s.value) || 0), 0)
  : (Number(r.value) || 0)

// UNKNOWN rows are excluded from the scale — a not-measured row has no magnitude, and
// letting one participate would silently rescale every real bar against a guess.
const scaleMax = computed(() => {
  if (props.max > 0) return props.max
  const m = Math.max(0, ...rows.value.filter((r) => !r.unknown).map(total))
  return m > 0 ? m : 1
})
const px = (v) => Math.max(0, (Number(v) || 0) / scaleMax.value * plotW.value)

// Truncate to what the label column can actually show; the full string stays in the
// row's <title> so nothing is lost, only shortened.
const CHAR_W = 6.6
const short = (s) => {
  const t = String(s ?? '')
  const cap = Math.max(4, Math.floor((labelW.value - 10) / CHAR_W))
  return t.length > cap ? `${t.slice(0, cap - 1)}…` : t
}

// Row geometry, computed once per render rather than five times inside the template.
const laid = computed(() => rows.value.map((r, i) => {
  const y = i * rowStep.value + 3
  const segs = []
  if (Array.isArray(r.segments) && r.segments.length) {
    let x = labelW.value
    for (const s of r.segments) {
      const w = px(s.value)
      segs.push({ ...s, x, w })
      x += w
    }
  } else if (!r.unknown) {
    segs.push({ label: r.label, value: total(r), color: r.color || props.color, x: labelW.value, w: px(total(r)) })
  }
  const barEnd = segs.length ? segs[segs.length - 1].x + segs[segs.length - 1].w : labelW.value
  return {
    row: r, y, segs, barEnd,
    valueText: r.unknown ? (r.unknownText || 'unknown — not measured') : props.format(total(r)),
    title: [r.label, r.unknown ? (r.unknownText || 'unknown — not measured') : props.format(total(r)), r.note]
      .filter(Boolean).join(' · '),
  }
}))

const ariaLabel = computed(() => [props.title, props.unit, `${rows.value.length} rows`]
  .filter(Boolean).join(' — '))

useShadowStyles(
  // box-sizing is NOT inherited into a shadow root from the host page's reset.
  '.bc,.bc *{box-sizing:border-box}' +
  ".bc{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:100%}" +
  '.bc-h{margin:0 0 2px;font-size:14.5px;font-weight:700;line-height:1.35}' +
  '.bc-sub{margin:0 0 8px;font-size:12px;opacity:.72;line-height:1.5}' +
  '.bc-unit{margin:0 0 8px;font-size:11px;opacity:.6;letter-spacing:.02em}' +
  '.bc-leg{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 10px;font-size:11.5px}' +
  '.bc-leg span{display:inline-flex;align-items:center;gap:6px;opacity:.85}' +
  '.bc-sw{width:11px;height:11px;border-radius:3px;flex:0 0 auto}' +
  '.bc-lab{font-size:12px;fill:currentColor;opacity:.88}' +
  '.bc-val{font-size:11.5px;font-weight:700;fill:currentColor;font-variant-numeric:tabular-nums}' +
  '.bc-unk{font-size:11px;fill:currentColor;opacity:.62;font-style:italic}' +
  '.bc-track{fill:rgba(0,0,0,.055)}' +
  '.is-dark .bc-track{fill:rgba(255,255,255,.075)}' +
  '.bc-row{cursor:pointer}' +
  '.bc-row:hover .bc-seg{opacity:.82}' +
  '.bc-row:focus{outline:none}' +
  '.bc-row:focus-visible .bc-track{stroke:currentColor;stroke-width:1.5}' +
  '.bc-empty{padding:22px;text-align:center;font-size:12.5px;opacity:.6}' +
  '.bc-cav{margin:10px 0 0;padding:9px 11px;border-radius:8px;background:rgba(0,0,0,.045);' +
  'font-size:11.5px;line-height:1.6;opacity:.88}' +
  '.is-dark .bc-cav{background:rgba(255,255,255,.06)}' +
  '.bc-cav p{margin:0 0 5px}' +
  '.bc-cav p:last-child{margin:0}',
  'doxa-bar-chart',
)
</script>

<template>
  <div ref="host" class="bc" :class="{ 'is-dark': isDark }">
    <h3 v-if="title" class="bc-h">{{ title }}</h3>
    <p v-if="subtitle" class="bc-sub">{{ subtitle }}</p>
    <p v-if="unit" class="bc-unit">{{ unit }}</p>

    <div v-if="legend.length" class="bc-leg">
      <span v-for="l in legend" :key="l.label">
        <i class="bc-sw" :style="{ background: l.color }"></i>{{ l.label }}
      </span>
    </div>

    <div v-if="!rows.length" class="bc-empty">{{ emptyText }}</div>

    <!-- direction:ltr on the SVG: its geometry is left-to-right by construction (labels at x=0, values after
         the bar end). Under an inherited rtl, text-anchor start flips, so labels ran off the left edge and
         values back over their bars (row 82, ar). Each label's own text still shapes as Arabic. -->
    <svg v-else :width="width || 640" :height="svgH" role="img" :aria-label="ariaLabel" direction="ltr" style="direction:ltr">
      <defs>
        <!-- Hatching means NOT MEASURED. It must not look like a small bar. -->
        <pattern :id="`${uid}-hatch`" width="7" height="7" patternUnits="userSpaceOnUse"
                 patternTransform="rotate(45)">
          <rect width="7" height="7" fill="transparent" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" stroke-width="2.4" opacity=".22" />
        </pattern>
      </defs>

      <g v-for="(r, i) in laid" :key="i" class="bc-row" tabindex="0"
         @click="emit('bar-click', r.row)"
         @keydown.enter.prevent="emit('bar-click', r.row)">
        <title>{{ r.title }}</title>

        <text class="bc-lab" :x="0" :y="r.y + barHeight * 0.68">{{ short(r.row.label) }}</text>

        <rect class="bc-track" :x="labelW" :y="r.y" :width="plotW" :height="barHeight" rx="4" />

        <template v-if="r.row.unknown">
          <rect :x="labelW" :y="r.y" :width="plotW" :height="barHeight" rx="4"
                :fill="`url(#${uid}-hatch)`" />
          <text class="bc-unk" :x="labelW + 10" :y="r.y + barHeight * 0.68">{{ r.valueText }}</text>
        </template>

        <template v-else>
          <rect v-for="(s, j) in r.segs" :key="j" class="bc-seg"
                :x="s.x" :y="r.y" :width="s.w" :height="barHeight"
                :rx="r.segs.length > 1 ? 2 : 4" :fill="s.color || color" />
          <text class="bc-val" :x="r.barEnd + 8" :y="r.y + barHeight * 0.68">{{ r.valueText }}</text>
        </template>
      </g>
    </svg>

    <div v-if="caveats.length" class="bc-cav">
      <p v-for="(c, i) in caveats" :key="i">{{ c }}</p>
    </div>
  </div>
</template>
