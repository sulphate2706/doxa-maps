<!--
  ProgressBar.vue — the DX-life progress bar: a single-value track, or a segmented one with a legend.

  Ported from blocks/_progress-bar.scss plus RegionDetail.vue's scoped .prayer-coverage-segments
  override. Three instances in the regions dashboard used it: one segmented bar with a three-key
  legend, and two plain adopted/engaged bars.

  ★ ONE NUMBER FEEDS BOTH THE WIDTH AND THE LEGEND, which is the actual reason this is a component
  and not two copies of markup. Before extraction the segment widths were computed from raw counts in
  the template while the legend printed those counts separately, so a bar and the number beside it
  could disagree and nothing would say so. Here a segment is { value, color, label } and the width
  IS value/max -- they cannot drift apart, because there is only one figure.

  ★ SEGMENT COLOUR IS A VALUE, NOT A CLASS, and this is the ONE substitution in the port. Their
  markup (and ours, before this) selected colours with .rd-seg--full / --partial / --none, three
  prayer-specific class names. A shared component cannot know what "full prayer coverage" is, and
  baking those three names in is exactly the monolith this extraction exists to undo. So the caller
  passes a CSS colour -- the regions plugin passes the same var(--dx-accent) / var(--dx-partial) /
  var(--dx-track) tokens those classes set, so every rendered colour is unchanged; only the mechanism
  moved from a stylesheet rule to an inline background. The three --full/--partial/--none rules are
  deleted rather than left behind, because a rule no selector can reach is not a fallback.

  THE THREE TEMPLATE BRANCHES, and why there are no comments between them: a comment sitting between
  v-if branches is a RENDERED NODE, which turns the component's root into a FRAGMENT
  (<!--[-->...<!--]-->) instead of a single element. Measured by server-rendering it. So the branches
  are bare and the explanation lives here:
    • showLegend      -> root is the ported .stack.stack--xs wrapper, 10px above the legend
    • segments only   -> root is the segmented .rd-bar
    • neither         -> root IS the plain .rd-bar, exactly as their cards 2 and 3 render it

  DOM IS UNCHANGED FOR ALL THREE INSTANCES, deliberately, because the clone is measured against the
  live site. With a legend the root is the ported .stack.stack--xs wrapper (10px between bar and
  legend); without one the root IS the .rd-bar element, exactly as their cards 2 and 3 render it --
  hence the three template branches rather than one uniform wrapper, which would have added a box
  DX-life does not have to two of the three cards.

  NOT ADDED HERE, ON PURPOSE: role="progressbar" / aria-valuenow. Neither their bar nor our port has
  it, and inventing an accessibility tree the clone target does not have is a change to request, not
  to slip in. Carded for a ruling instead.

  CONTRACT: the containing shadow root carries the DX-life token layer (--dx-track, --dx-accent,
  --spacing-*). No i18n is installed or required -- every string arrives pre-localized.
-->
<script setup>
import { computed } from 'vue'
import { useShadowStyles } from '../../composables/useShadowStyles.js'

const props = defineProps({
  /** The filled amount, in the same units as `max`. Ignored when `segments` is non-empty. */
  value: { type: Number, default: 0 },
  /** The denominator. A zero or missing max renders an empty bar rather than dividing by zero. */
  max: { type: Number, default: 100 },
  /** The single-value fill colour. Any CSS colour; defaults to the DX-life accent. */
  color: { type: String, default: 'var(--dx-accent)' },
  /**
   * [{ value, color, label }] — when non-empty the bar is segmented. `value` is a RAW count over the
   * same `max`, not a percentage: the component divides, so the legend and the width agree.
   */
  segments: { type: Array, default: () => [] },
  /** Render the legend built from `segments`. Has no effect without segments. */
  legend: { type: Boolean, default: false },
  /** aria-label for the track. Omitted entirely when empty, as their plain bars have none. */
  label: { type: String, default: '' },
  /** Formats a segment's value for the legend. The caller owns locale-dependent formatting. */
  format: { type: Function, default: (n) => String(n) },
  /** Between a legend key's label and its number. A prop because ':' is not universal punctuation. */
  separator: { type: String, default: ': ' },
})

// RegionDetail.vue:28-30. Capped at 100 for the same reason theirs is: a bar wider than its
// track is a rendering bug, not a data story. Ported verbatim from the plugin's percentOfSubject,
// which existed only to serve these bars and is deleted there.
const percentOf = (count) => (props.max ? Math.min(100, ((count || 0) / props.max) * 100) : 0)

const isSegmented = computed(() => props.segments.length > 0)
const showLegend = computed(() => props.legend && isSegmented.value)
const pct = computed(() => percentOf(props.value))
const segStyles = computed(() => props.segments.map((s) => ({
  width: percentOf(s.value) + '%',
  background: s.color,
})))

useShadowStyles(
  // ── .progress-bar: blocks/_progress-bar.scss. The HEIGHT comes from padding-top, not height
  //    -- clamp(15px, 6%, 25px) at [data-size="md"] -- so the track scales with its own width.
  '.rd-bar{ position:relative; overflow:hidden; width:100%; border-radius:100px;' +
  '  background:var(--dx-track); border:none; padding-top:clamp(15px, 6%, 25px); }' +
  '.rd-bar__slider{ position:absolute; top:0; height:100%; width:0; border-radius:100px;' +
  '  background:var(--dx-accent); transition:width 1s ease-out; }' +
  // .prayer-coverage-segments overrides that padding with a real height (their own scoped rule)
  '.rd-bar--segments{ display:flex; height:clamp(15px, 6cqw, 25px); padding-top:0; }' +
  '.rd-seg{ height:100%; transition:width 1s ease-out; }' +
  // The ported .stack.stack--xs that separates the bar from its legend by 10px. It is the root only
  // when a legend is rendered, so a plain bar keeps their exact single-element shape.
  '.rd-bar-stack{ display:flex; flex-direction:column; }' +
  '.rd-bar-stack > * + *{ margin-top:10px; }' +
  '.rd-legend{ display:grid; justify-content:center; gap:3.5px; font-size:var(--font-size-sm);' +
  '  font-weight:600; text-align:center; }' +
  '.rd-legend span{ display:inline-flex; align-items:center; justify-content:center; gap:4px; }' +
  '.rd-key{ display:inline-block; flex:0 0 auto; width:7.5px; height:7.5px; border-radius:100px; }' +
  // ★ THE COMPONENT CARRIES ITS OWN REDUCED-MOTION GUARD, and it is not redundant. base/_reset.scss
  // does this with a DOCUMENT-level universal selector, which styles nothing inside a shadow root, so
  // the regions plugin re-ported it scoped to its own `.rd-root *`. That covers these bars only while
  // they are inside .rd-root. A shared component used anywhere else would carry the 1s width
  // transition with nothing suppressing it -- reintroducing the exact regression that was measured
  // and fixed here (theirs 1s -> 1e-05s under emulated reduce, ours stayed 1s: a vestibular visitor
  // got a full one-second sliding bar their own site suppresses). A component that ships an animation
  // owes the guard for it; relying on an ancestor's reset is what makes a component non-portable.
  '@media (prefers-reduced-motion: reduce){' +
  '  .rd-bar__slider, .rd-seg{ transition-duration:0.01ms !important; } }'
, 'progress-bar')
</script>

<template>
  <div v-if="showLegend" class="rd-bar-stack">
    <div class="rd-bar rd-bar--segments" :aria-label="label || undefined">
      <div v-for="(s, i) in segStyles" :key="i" class="rd-seg" :style="s" />
    </div>
    <div class="rd-legend">
      <span v-for="(s, i) in segments" :key="i">
        <i class="rd-key" :style="{ background: s.color }" />{{ s.label }}{{ separator }}{{ format(s.value) }}
      </span>
    </div>
  </div>

  <div v-else-if="isSegmented" class="rd-bar rd-bar--segments" :aria-label="label || undefined">
    <div v-for="(s, i) in segStyles" :key="i" class="rd-seg" :style="s" />
  </div>

  <div v-else class="rd-bar" :aria-label="label || undefined">
    <div class="rd-bar__slider" :style="{ width: pct + '%', background: color }" />
  </div>
</template>
