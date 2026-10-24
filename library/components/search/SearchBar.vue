<script setup>
/**
 * SearchBar.vue — SHARED (@map/components/search/SearchBar.vue).
 *
 * A reusable search input (magnifier icon + <input type="search">). Fully props-driven,
 * emit-based, framework-agnostic (no Nuxt, no i18n composables, no plugin hardcoding) —
 * so BOTH the cap-2 people-groups-grid AND the cap-1 Unified Research Dashboard
 * (big-picture) consume the SAME control instead of hand-rolling their own <input>.
 *
 * Derived from the search box that both plugins previously inlined (the DX-life
 * UupgsList search + BpResearchHeader search). The essential layout/look is inlined
 * and scoped so it self-styles inside a standalone custom element / shadow root.
 *
 * ── API ────────────────────────────────────────────────────────────────────────
 * Props:
 *   modelValue  String  ''  — bound value (supports `v-model` for controlled use).
 *   placeholder String  'Search…' — the input placeholder text.
 *   ariaLabel   String  'Search'  — accessible label for the input.
 *   maxWidth    String  ''  — optional CSS max-width for the box (e.g. '480px');
 *                             empty = fill the container (header-driven layouts).
 * Emits:
 *   update:modelValue String  — the new value (enables `v-model`).
 *   search { value }          — fired on every input; `value` is the raw string.
 *                               (Mirrors the grid's onSearch(event) contract, but the
 *                               value is read HERE so shadow-DOM event retargeting on the
 *                               async tick can never lose event.target — consumers get a
 *                               plain string, not an event.)
 */
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Search…' },
  ariaLabel: { type: String, default: 'Search' },
  maxWidth: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'search'])

const boxStyle = computed(() => (props.maxWidth ? { maxWidth: props.maxWidth } : {}))

function onInput(e) {
  const value = e.target.value ?? ''
  emit('update:modelValue', value)
  emit('search', { value })
}
</script>

<template>
  <div class="search-box" :style="boxStyle">
    <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    <input
      type="search"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      @input="onInput"
    >
  </div>
</template>

<style>
/* Inlined + scoped so the control self-styles inside a shadow root.
   DX-life material LIGHT palette, in var(--dx-token, #fallback) form: the FALLBACK keeps
   this control self-styling when it is dropped into a bare shadow root, while the TOKEN
   wins whenever a consumer defines it at :host. CSS custom properties inherit THROUGH
   shadow boundaries, so one palette reaches cap-2, cap-4 and the dashboard header from
   their own :host blocks — no consumer has to restyle this file. Do not re-resolve these
   back to literals: that is what made three surfaces disagree. */
.search-box {
  position: relative; display: flex; align-items: center;
  margin: 0 auto; width: 100%; color: var(--dx-muted, #6d766e);
}
.search-box .search-icon { position: absolute; left: 12px; pointer-events: none; }
.search-box input {
  width: 100%; padding: 10px 12px 10px 38px; font-size: 0.95rem; color: var(--dx-text, #3b463d);
  background: var(--dx-elevated, #fff); border: 1px solid var(--dx-line, #d1d4cd); border-radius: 10px; outline: none; box-sizing: border-box;
}
/* Focus is the one place the accent carries meaning on its own, and a 2px ring keeps the
   state visible without relying on a hue that is only ~1.9:1 against white. */
.search-box input:focus { border-color: var(--dx-accent, #92b195); box-shadow: 0 0 0 2px var(--dx-accent-weak, rgba(146, 177, 149, .18)); }
</style>
