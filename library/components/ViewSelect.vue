<!--
  ViewSelect.vue — the "SELECT VIEW" switcher: a fieldset + legend wrapping a row of
  underline-indicator tabs.

  THE CANONICAL SOURCE is the app shell, layouts/app-wrapper-material/index.html
  (`.viewsel` / `.seg`, a PrimeVue-style Fieldset). This component is that control
  extracted VERBATIM — same structure (semantic <fieldset>/<legend>), same metrics
  (8px radius, 10px/700/.7px-tracking uppercase legend, 13px/500 buttons with
  6px 12px 7px padding), same 2px accent underline on the pressed tab.

  WHY IT LIVES IN THE LIBRARY. It had two independent implementations before this
  file existed — the shell's vanilla one and a hand-copied Vue port inside
  my-upg-100-list/upg-100-mfe.vue — and a third consumer (regions-dashboard) was
  about to copy it again. A control with three consumers and no map-specific
  assumptions is what this library is for; a fourth divergent copy is not.

  PARAMETERIZED, per library/components/WARNING.md — it takes props, not assumptions:
  it knows nothing about maps, panes, bundles or scrolling. It renders the views it
  is handed and reports which one was clicked. Positioning is the CALLER's job:
  this component ships no `position`/`top`/`left`, so a header that wants it
  absolutely centred styles `.viewsel` itself (as both the shell and the MFE do).

  Props:
    views    — [{ id, label }, …]  the views to offer, in order
    current  — id of the active view
    legend   — the fieldset's legend text (default "Select View")
    label    — accessible name for the tablist (default "Views")
  Emits:
    select(id) — a view's tab was clicked
-->
<script setup>
import { useShadowStyles } from '../composables/useShadowStyles.js'

defineProps({
  views:   { type: Array,  default: () => [] },
  current: { type: String, default: '' },
  legend:  { type: String, default: 'Select View' },
  label:   { type: String, default: 'Views' },
})

defineEmits(['select'])

// Child components' <style> blocks are dropped by defineCustomElement, so the CSS
// goes through useShadowStyles like every other library component.
//
// NO BACKTICKS ANYWHERE IN THIS STRING, including in comments: one stray backtick
// terminates the JS template literal and the build stops compiling. Hence string
// concatenation rather than one template literal (house style).
useShadowStyles(
  // Metrics copied from the shell's .viewsel; colours come from the ui-* custom
  // properties the host element already declares, with the material-light palette
  // as the fallback so this renders correctly even outside a themed host.
  '.viewsel{ margin:0; padding:0 10px 2px;' +
  '  border:1px solid var(--ui-border,#d1d4cd); border-radius:8px;' +
  '  background:var(--ui-bg,#ffffff); }' +
  // Legend default alignment is inline-start; the shell centres it.
  '.viewsel > legend{ margin:0 auto; padding:0 6px; font-size:10px;' +
  '  text-transform:uppercase; letter-spacing:.7px;' +
  '  color:var(--ui-text-muted,#6d766e); font-weight:700; }' +
  // Slim UNDERLINE indicator, not a filled button.
  '.seg{ display:flex; gap:2px; }' +
  '.seg button{ position:relative; display:flex; align-items:center; gap:6px;' +
  '  border:0; background:none; color:var(--ui-text-muted,#6d766e);' +
  '  padding:6px 12px 7px; font-size:13px; font-weight:500; cursor:pointer;' +
  '  transition:color .15s; font-family:inherit;' +
  // ONE LINE PER TAB. Ported from the shell's own mobile rule (app-wrapper-material
  // index.html, max-width:960px: white-space:nowrap + ellipsis) — the extraction that
  // created this component copied the DESKTOP metrics verbatim but left that hardening
  // behind, so the leaf and the shell disagreed on narrow viewports.
  // MEASURED at 390px with the label "Prayer Resources": the fieldset is width-capped
  // by the header, the TEXT wrapped inside the button (28 -> 43px) and the strip grew
  // 45 -> 60px, while the shell held 45px. The row of tabs never wrapped; only the
  // words inside one did. Ellipsis is the better failure than a taller header.
  '  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
  '.seg button::after{ content:""; position:absolute; left:8px; right:8px; bottom:0;' +
  '  height:2px; border-radius:2px 2px 0 0; background:transparent;' +
  '  transition:background .15s; }' +
  '.seg button:hover{ color:var(--ui-text,#3b463d); }' +
  '.seg button:hover::after{ background:var(--ui-border,#d1d4cd); }' +
  '.seg button[aria-pressed="true"]{ color:var(--ui-primary,#92b195); font-weight:600; }' +
  '.seg button[aria-pressed="true"]::after{ background:var(--ui-primary,#92b195); }'
  + '/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,\n   and no generated leaf ships one anyway (measured: 0 across the whole tree). Additive only. */\n@media (prefers-reduced-motion: reduce) {\n  .vs-root, .vs-opt, .vs-menu, .vs-btn { transition: none !important; animation: none !important; }\n}\n',
  'view-select'
)
</script>

<template>
  <fieldset class="viewsel">
    <legend>{{ legend }}</legend>
    <div class="seg" role="tablist" :aria-label="label">
      <button
        v-for="v in views"
        :key="v.id"
        type="button"
        role="tab"
        :aria-pressed="current === v.id ? 'true' : 'false'"
        :aria-selected="current === v.id ? 'true' : 'false'"
        @click="$emit('select', v.id)"
      >{{ v.label }}</button>
    </div>
  </fieldset>
</template>
