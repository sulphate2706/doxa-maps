<script setup>
/**
 * SemanticSunburst — D3 sunburst with mouse-wheel zoom + drag pan.
 *
 * The original click-to-expand-arc behavior is replaced with map-style
 * scroll-wheel zoom + click-and-drag pan. Click-to-expand was slow, and readers
 * expect the same gesture they get on a Mapbox map.
 *
 * Labels are now visibility-tuned: only render labels for arcs that occupy
 * at least `LABEL_MIN_RADIANS` of arc, and font scales up at higher zoom
 * (label visibility re-evaluated on each zoom event).
 *
 * D3 comes from ensureD3()/pplrD3() in pplrData.js: pinned, integrity-checked, never window.d3.
 *
 * Props:
 *   tree         — { name, code?, children?: Tree[], value?: number }
 *   colorMap     — { [code]: hex } for depth-1 nodes; deeper depths lighten
 *   centerLabel  — string shown in the donut hole
 *   depthLabels  — string[] — e.g. ['', 'Affinity Bloc', 'Cluster', 'PG']
 *   maxDepth     — number — render up to this many rings (default 3)
 */
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { pplrD3, ensureD3 } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'
import { formatCount } from '@map/utils/formatCount.js'   // counts stay fixed en-US: numerals are held, pending a product decision

const props = defineProps({
  tree:        { type: Object, required: true },
  colorMap:    { type: Object, default: () => ({}) },
  centerLabel: { type: String, default: '' },
  depthLabels: { type: Array,  default: () => [] },
  maxDepth:    { type: Number, default: 3 },
})

const container = ref(null)
// The status is a KEY and its values, translated in the template, so it follows a language change.
const t = usePplrT()
const status = ref(null)   // { key, params }
let svgEl = null
let resizeObs = null

function arcColorOf(node) {
  // Walk up to depth-1 ancestor for the base color
  let n = node
  while (n.depth > 1) n = n.parent
  const base = n.depth === 1 ? (props.colorMap[n.data.code] || '#888') : '#334155'
  // Lighten deeper rings by blending toward white
  const light = node.depth === 1 ? 0 : node.depth === 2 ? 0.18 : 0.34
  if (light === 0) return base
  const hex = base.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const lr = Math.round(r + (255 - r) * light)
  const lg = Math.round(g + (255 - g) * light)
  const lb = Math.round(b + (255 - b) * light)
  return `rgb(${lr},${lg},${lb})`
}

// Threshold (radians) — labels only render for arcs at least this wide.
// At higher zoom scales we lower the threshold so more labels become visible.
const LABEL_MIN_RADIANS = 0.10

function build() {
  const d3 = pplrD3()   // the pinned, scoped d3 (pplrData.js), never the host page's window.d3
  // not loaded yet (a caller that did not await ensureD3): load it, then build; no refresh needed
  if (!d3) { ensureD3().then(build, () => { status.value = { key: 'pplr.status.d3Failed' } }); return }
  const el = container.value
  if (!el || !props.tree) return

  // Tear down any prior render so we don't stack svgs on resize/data-swap.
  el.innerHTML = ''

  const W = el.clientWidth  || 720
  const H = el.clientHeight || 600
  const R = Math.min(W, H) / 2 - 10

  const hierarchy = d3.hierarchy(props.tree)
    .sum(d => d.value || 0)
    .sort((a, b) => b.value - a.value)

  d3.partition().size([2 * Math.PI, R])(hierarchy)

  const arc = d3.arc()
    .startAngle(d => d.x0)
    .endAngle(d => d.x1)
    .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.004))
    .padRadius(R / 2)
    .innerRadius(d => d.y0)
    .outerRadius(d => Math.max(d.y0, d.y1 - 1.5))

  const svg = d3.select(el).append('svg')
    .attr('viewBox', [-W / 2, -H / 2, W, H])
    .attr('width', W).attr('height', H)
    .style('font', '10px system-ui')
    .style('background', 'transparent')
    .style('cursor', 'grab')
  svgEl = svg.node()

  // Single transform group — wheel zoom + drag pan apply via d3.zoom().
  const root = svg.append('g')

  const centerLabelEl = root.append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .style('fill', '#c9d1d9').style('font-size', '12px').style('font-weight', '600')
    .style('pointer-events', 'none')
    .text(props.centerLabel)

  const tooltip = d3.select(el).append('div')
    .style('position', 'absolute').style('pointer-events', 'none').style('display', 'none')
    .style('background', 'rgba(13,17,23,0.95)').style('color', '#c9d1d9')
    .style('border', '1px solid #30363d').style('border-radius', '6px')
    .style('padding', '8px 12px').style('font', '12px system-ui')
    .style('z-index', '10').style('max-width', '260px')

  // Render arcs with paint-order so larger inner rings draw first.
  const visible = hierarchy.descendants().filter(d => d.depth > 0 && d.depth <= props.maxDepth)
  const path = root.append('g').selectAll('path')
    .data(visible)
    .join('path')
      .attr('fill', d => arcColorOf(d))
      .attr('fill-opacity', d => d.depth === 1 ? 0.92 : 0.7)
      .attr('stroke', '#0d1117').attr('stroke-width', 0.5)
      .attr('d', arc).style('cursor', 'pointer')

  // Inner-ring labels — bigger font + better contrast (white text), and we
  // reposition them on zoom so they stay legible when zoomed in.
  const labelData = visible.filter(d => d.depth === 1 && (d.x1 - d.x0) > LABEL_MIN_RADIANS)
  const labelGroup = root.append('g').attr('pointer-events', 'none')
  const label = labelGroup.selectAll('text')
    .data(labelData)
    .join('text')
      .attr('transform', d => {
        const x = (d.x0 + d.x1) / 2 * 180 / Math.PI - 90
        const y = (d.y0 + d.y1) / 2
        return `rotate(${x}) translate(${y},0) rotate(${x < 90 || x > 270 ? 0 : 180})`
      })
      .attr('dy', '0.35em').attr('text-anchor', 'middle')
      .style('fill', '#ffffff').style('font-size', '11px').style('font-weight', '700')
      .style('paint-order', 'stroke').style('stroke', 'rgba(13,17,23,0.65)').style('stroke-width', '2.5px')
      .text(d => (d.data.name || '').replace(' Peoples', '').replace(' People', ''))

  // Hover tooltip only — arc clicks no longer trigger zoom (wheel-zoom + drag-pan
  // instead of click-to-expand).
  path.on('mousemove', (event, d) => {
    const depth = props.depthLabels[d.depth] || ''
    tooltip.style('display', 'block')
      .style('left', (event.offsetX + 14) + 'px')
      .style('top', (event.offsetY - 10) + 'px')
      .html(`<b>${d.data.name}</b><br><span style="color:#6b7280">${depth} · ${d.value.toLocaleString()} entries</span>`)
  })
  .on('mouseleave', () => tooltip.style('display', 'none'))

  // ── Wheel zoom + drag pan (Mapbox-style gesture) ──
  // wheelDelta: tweak default for smoother small-step zooming.
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.5, 12])
    .wheelDelta(event => -event.deltaY * (event.deltaMode ? 120 : 1) / 500)
    .on('zoom', (event) => {
      root.attr('transform', event.transform)
      // Hide labels that become too small when zoomed out, scale font down
      // when zoomed in (so they don't get artificially huge).
      const k = event.transform.k
      label.style('font-size', `${Math.max(9, 11 / k * 1.1)}px`)
        .style('display', d => (d.x1 - d.x0) * k > LABEL_MIN_RADIANS ? null : 'none')
    })
  // Cursor toggle for drag affordance
  svg.call(zoomBehavior)
    .on('mousedown.cursor', () => svg.style('cursor', 'grabbing'))
    .on('mouseup.cursor',   () => svg.style('cursor', 'grab'))
    .on('dblclick.zoom', null)  // disable dblclick-zoom — keep gesture purely wheel/drag

  const total = hierarchy.value
  status.value = { key: 'pplr.status.readyD3', params: { entries: formatCount(total) } }
}

onMounted(() => {
  build()
  // Re-render on container resize (window resize, gem-slot collapse, etc.)
  if ('ResizeObserver' in window && container.value) {
    let scheduled = false
    resizeObs = new ResizeObserver(() => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => { scheduled = false; build() })
    })
    resizeObs.observe(container.value)
  }
})
onBeforeUnmount(() => {
  resizeObs?.disconnect()
  if (svgEl) svgEl.remove()
})

// Re-build when tree data swaps (e.g. switching profile context)
watch(() => props.tree, () => build(), { deep: false })
</script>

<template>
  <div class="ssb-frame">
    <div ref="container" class="ssb-canvas" />
    <div v-if="status" class="ssb-status">{{ t(status.key, status.params) }}</div>
  </div>
</template>

<style scoped>
.ssb-frame {
  width: 100%; height: 100%;
  position: relative;
  background: #0d1117;
}
.ssb-canvas { width: 100%; height: 100%; position: relative; }
.ssb-status {
  position: absolute; bottom: 8px; left: 12px;
  background: rgba(13,17,23,0.92); color: #86efac; border: 1px solid #30363d;
  font: 11px ui-monospace, monospace; padding: 5px 10px; border-radius: 4px;
  z-index: 2;
}
</style>
