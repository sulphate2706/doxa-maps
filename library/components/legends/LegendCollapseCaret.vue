<script setup>
/**
 * LegendCollapseCaret.vue — SHARED (@map/components/legends/LegendCollapseCaret.vue).
 *
 * The disclosure control that collapses a legend panel. SemanticTreeLegend had one, LegendDesktop
 * grew a second by eye — its own comment says "Matches SemanticTreeLegend's .stl-collapse-btn
 * look" — and matching a look is not the same as matching a control. The copy lost the two things
 * that are not visible:
 *
 *   1. aria-expanded. A disclosure control that never reports its state leaves a screen-reader
 *      user with a button called "toggle legend" and no way to know whether the legend is open.
 *      This is the same defect I fixed in LegendMobile, in a component that already had the fix
 *      sitting beside it. STL's own header records why it was added there on 2026-09-21.
 *   2. The RTL arrow. STL carries `.stl-collapse-btn:dir(rtl) svg { transform: rotate(0deg) }`
 *      because a panel that slides off the other edge needs its caret to point the other way. The
 *      copy has no :dir(rtl) rule at all, so in Arabic it points AT the panel it would open.
 *
 * ★ THE LABEL SAYS WHICH WAY IT GOES. `aria.toggleLegend` names the control; collapseLegend /
 * expandLegend name the ACTION about to happen, which is what a caret with two states owes its
 * reader. All three keys exist in all eleven locales already, so this costs no new translation.
 *
 * ★ STATE IS THE CALLER'S. This component owns no open/closed state and no persistence: two of its
 * consumers drive the legend from uiStore's tri-state cascade (fullyOpen → open → collapsed) and
 * one from a local boolean, and a shared control that quietly adopted one of those would break the
 * other. It renders a state it is told about and emits the intent to change it.
 */
import { useShadowStyles } from '@map/composables/useShadowStyles.js'

defineProps({
  // Whether the panel this controls is currently open. Drives the arrow AND aria-expanded, so the
  // two cannot drift — the defect above was possible only because they were separate.
  open: { type: Boolean, required: true },
  // t() from the consumer's own i18n. Passed in rather than imported: these components are mounted
  // inside several bundles' shadow roots and each carries its own i18n instance.
  t: { type: Function, required: true },
})

defineEmits(['toggle'])

// ★ useShadowStyles, NOT <style scoped>. Vue's defineCustomElement injects styles from the ROOT
// component only; a child loaded through import.meta.glob has its <style> block silently dropped,
// which is the whole reason this composable exists. Every sibling legend component does this, and
// the first draft of this file did not — it would have rendered an unstyled caret inside every
// shadow root while looking perfectly correct in the source.
useShadowStyles(`
/* The dark-theme look both copies already had, to the pixel: 22x20, 5px radius, the same
   rgba(110,118,129,0.15) fill and #30363d border. Nothing here is new styling. */
.legend-collapse-caret {
  background: rgba(110,118,129,0.15); border: 1px solid #30363d; border-radius: 5px;
  color: #8b949e; cursor: pointer;
  width: 22px; height: 20px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.1s, background 0.1s;
  outline: none; -webkit-tap-highlight-color: transparent; padding: 0;
}
.legend-collapse-caret:hover { color: #c9d1d9; background: rgba(59,70,61,0.18); border-color: #73A17F; }
.legend-collapse-caret:focus-visible { outline: 2px solid #73A17F; outline-offset: 2px; }

/* THE ARROW IS DRIVEN BY THE PROP, not by a style the caller remembers to add. Open points back
   at the panel (180deg); closed points out towards where the panel will appear. */
.legend-collapse-caret svg { transition: transform 0.18s; transform: rotate(0deg); }
.legend-collapse-caret--open svg { transform: rotate(180deg); }

/* RTL: the panel slides off the other edge, so both directions swap. This is the rule the copy in
   LegendDesktop never had — additive :dir(rtl) overrides, as in VerticalTabsLayout and STL. */
.legend-collapse-caret:dir(rtl) svg { transform: rotate(180deg); }
.legend-collapse-caret--open:dir(rtl) svg { transform: rotate(0deg); }

/* Reduced motion: the arrow still flips, it just does not turn on the way there. */
@media (prefers-reduced-motion: reduce) {
  .legend-collapse-caret, .legend-collapse-caret svg { transition: none !important; }
}
`, 'legend-collapse-caret')
</script>

<template>
  <button
    type="button"
    class="legend-collapse-caret"
    :class="{ 'legend-collapse-caret--open': open }"
    :title="open ? t('aria.collapseLegend') : t('aria.expandLegend')"
    :aria-label="open ? t('aria.collapseLegend') : t('aria.expandLegend')"
    :aria-expanded="String(open)"
    @click.stop="$emit('toggle')"
  >
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"
      />
    </svg>
  </button>
</template>

<style scoped>
/* All runtime styles are injected via useShadowStyles above — a child component's <style>
   block is silently DROPPED inside a defineCustomElement shadow root. */
</style>
