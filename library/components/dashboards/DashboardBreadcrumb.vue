<script setup>
/**
 * ── KIT LANDING 4c-4: MOVED FROM plugin-designs/research-dashboard/ ───────────────────────────
 * The breadcrumb completes the facet-cascade group the spec scheduled together — rail (4c-3), chips
 * (4c-2), breadcrumb. It was left behind when the other two moved, which is the whole reason it is
 * called out here: a group scheduled as one landing was delivered as two, and the leftover is
 * invisible unless someone re-reads the spec against the tree.
 *
 * Like the chip bar, it is mounted by NOBODY today (it was exported from the plugin barrel and
 * rendered nowhere), so its gates mean "it mounts and degrades", not "it looks right".
 */
import { tStatic } from '@map/i18n/index.js'
const L = (key, en) => tStatic('dashboard.' + key) || en
/**
 * Breadcrumb — RDASH phase 8 delighter: drill-down breadcrumb (World ▸ Asia ▸ Hinduism …).
 * Every filter pushes a crumb; click a crumb to pop back to that altitude (legible + reversible
 * linked state). Reads filterSet; click delegation (defineCustomElement-safe).
 */
import { inject, computed } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
// No research label import: the shell supplies the resolver on dashboardConfig.legend (landing 4b).

const bus = inject('selectionBus', null)
const cfg = inject('dashboardConfig', {})
const filterSet = bus?.filterSet || {}

// A crumb is a user-facing surface, so People CODES are resolved to names here exactly as the
// filter chips do (dashboard.config.js:54-57 — codes must never reach a user-facing menu).
// DISPLAY ONLY: `k` is what popTo() acts on and the stored value is never rewritten, so the bus's
// byte-match contract is untouched.
// ★ THE SAME RESOLVER, AND THE SAME UNCONFIGURED DEFAULT, AS THE CHIP BAR (4c-2). Identical on
// purpose: the breadcrumb and the chips render the same filterSet, so if their defaults differed a
// half-configured dashboard would show one value resolved and the other raw, in the same band.
// The list join matters for the same reason it did there — a filterSet value is an ARRAY once two
// values are selected (spec D1), and `String(['A012','A013'])` prints comma-jammed.
// `dataStore` and `searchSourceId` are NOT injected any more: they existed only to construct
// useTreeLegendLabels, and an unused inject is a claim about the host.
const labelFor = (facet, value) => (cfg?.legend?.labelFor ? cfg.legend.labelFor(facet, value) : (Array.isArray(value) ? value.join(', ') : value))
const crumbs = computed(() => Object.entries(filterSet).map(([k, v]) => ({ k, v: String(labelFor(k, v)) })))

function popTo(k) {
  const keys = Object.keys(filterSet); const i = keys.indexOf(k)
  if (i < 0 || !bus) return
  keys.slice(i).forEach((kk) => bus.setFilter(kk, null))
}
function onClick(e) {
  const el = e.target && e.target.closest && e.target.closest('[data-crumb]')
  if (!el || !bus) return
  const k = el.getAttribute('data-crumb')
  if (k === '__root__') bus.clearFilters(); else popTo(k)
}

useShadowStyles(`
  .rd-breadcrumb{ display:flex; align-items:center; gap:4px; font-size:11px; color:var(--dx-line, #d1d4cd); overflow:hidden; }
  .rd-crumb{ cursor:pointer; padding:2px 6px; border-radius:4px; white-space:nowrap; }
  .rd-crumb:hover{ background:#ffffff1f; color:#fff; }
  .rd-crumb.root{ color:var(--dx-muted, #6d766e); } .rd-crumb.cur{ color:#fff; font-weight:700; }
  .rd-sep{ opacity:.45; }
`, 'rd-breadcrumb')
</script>

<template>
  <nav class="rd-breadcrumb" data-breadcrumb @click="onClick" :aria-label="tStatic('aria.filterBreadcrumb') || 'Filter breadcrumb'">
    <span class="rd-crumb root" data-crumb="__root__">{{ L('world', 'World') }}</span>
    <template v-for="(c, i) in crumbs" :key="c.k">
      <span class="rd-sep">▸</span>
      <span class="rd-crumb" :class="{ cur: i === crumbs.length - 1 }" data-crumb-item :data-crumb="c.k">{{ c.v }}</span>
    </template>
  </nav>
</template>
