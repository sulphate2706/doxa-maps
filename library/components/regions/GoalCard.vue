<!--
  GoalCard.vue — a headline figure with a goal line pinned to the bottom of the card.

  These are the banners: the cards that tell you the prayer progress.
  Their RegionDetail.vue renders three of them in a row -- Prayer Coverage, Adoption Progress,
  Engagement Progress -- identical in structure and different only in their numbers, their bar, and
  one dark variant. That is one component with props, which is why it is here and not three copies.

  ★ NAMED GoalCard, NOT PrayerGoalCard, and the deviation from the name in the order is deliberate:
  nothing in this component's props or CSS is about prayer. The shepherd's name described the first
  instance; a shared component named after one caller mis-describes it for every later one. Flagged
  in the handoff rather than decided silently.

  ★ THE MIDDLE IS A SLOT. What sits between the figure and the goal line differs per instance -- a
  segmented bar with a legend in one, a plain bar in the other two -- so the card does not import a
  bar at all. It knows about a title, a figure, and a goal; the caller supplies the rest. This is the
  same rule RegionSectionCard follows for its poster wall: one caller's feature must not become every
  caller's API.

  ★ margin-top:auto IS THE WHOLE POINT OF THE LAYOUT, not a detail. It is what makes three cards
  holding different amounts of copy align their goal lines flush along the bottom edge. The full
  measurement history is on the rules below; it survived a probe that measured the pair as "same".

  TWO TEMPLATE DETAILS, documented here rather than in the template, because a comment between nodes
  is a rendered node and this card's DOM is compared against the markup it replaced:
   • the figure and its caption sit in an UNCLASSED <div>. That grouping is what makes the card's
     stack margin fall between the groups rather than between a number and its own label.
   • the space after </strong> in the goal line is INTERPOLATED, not written as template whitespace,
     so it cannot depend on the compiler's whitespace:condense behaviour.

  CONTRACT, two things the host root must provide, exactly as for RegionSectionCard:
   • the DX-life token layer (--dx-radius, --dx-elevated, --dx-dark, --spacing-*, --font-size-*).
   • for the Cyrillic heading switch, a `lang` attribute on an ancestor INSIDE THE SAME shadow root.
     A [lang] selector cannot see the host document's attribute across a shadow boundary, so a
     consumer that does not set lang on an ancestor gets the default face and nothing else changes.
  No i18n is installed or required: every string arrives pre-localized, including the goal label.
-->
<script setup>
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { cyrillicHeading, strongMedium } from '../../styles/portedGlobals.js'
import { useCardSurface } from '../../composables/useCardSurface.js'

defineProps({
  /** The card heading, already localized. */
  title: { type: String, default: '' },
  /** The headline figure, pre-formatted by the caller, e.g. "21 / 2,107". */
  value: { type: [String, Number], default: '' },
  /** The caption under the figure, already localized. */
  valueLabel: { type: String, default: '' },
  /** The goal sentence, already localized. Pinned to the bottom of the card. */
  goal: { type: String, default: '' },
  /** The bold lead-in to the goal sentence, e.g. "Goal". Omitted entirely when empty. */
  goalLabel: { type: String, default: '' },
  /** Follows goalLabel inside the <strong>. A prop because ':' is not universal punctuation. */
  labelSeparator: { type: String, default: ':' },
  /** 'secondary' is their dark-on-light variant, used by the first of the three cards. */
  variant: { type: String, default: 'default' },
})

// .rd-card / --secondary, shared with StatCard under one stable label.
useCardSurface()

useShadowStyles(
  // ★ THEIR .stack IS margin-top, AND THAT IS LOAD-BEARING — not a stylistic detail.
  // composition/_stack.scss: `.stack > * + * { margin-top: var(--stack-spacing) }`, with
  // `.stack--lg` setting that to --spacing-lg. RegionDetail.vue's scoped
  // `.region-goal { margin-top: auto }` then OVERRIDES the same property on the last child,
  // so the goal line is pushed to the bottom and the 23.526px stack gap above it is GONE.
  // This was ported as `gap`, which margin cannot override: gap AND the auto both applied,
  // so every goal card carried ~23.5px of space their cards do not have. It showed as uneven
  // spacing on exactly these three cards. Ported as their mechanism.
  '.rd-goal-card{ display:flex; flex-direction:column; text-align:center; }' +
  '.rd-goal-card > * + *{ margin-top:var(--spacing-lg); }' +

  // ── the heading. h2: _globals.scss clamp(--font-size-2xl, 6vw, --font-size-4xl).
  // ★ THIS IS A SECOND COPY OF THE PLUGIN'S .rd-h2 RULE, under this card's own class name, and the
  // duplication is deliberate rather than overlooked. Using .rd-h2 itself would put two identical
  // selectors in one shadow root from two different files -- the shape that drifts silently the first
  // time one is tuned. The plugin keeps .rd-h2 for the one heading it still owns (its table title).
  // (The ported-globals module this comment used to card now exists -- ../../styles/portedGlobals.js
  // -- and the Cyrillic rule below comes from it. The h2 clamp itself stays local: it is this card's
  // own sizing, not a globals rule.)
  '.rd-goal-card__title{ margin:0; font-size:clamp(var(--font-size-2xl), 6cqw, var(--font-size-4xl)); line-height:1;' +
  '  font-family:"Bebas Neue","Arial Narrow",BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;' +
  '  font-weight:400; }' +
  // ★ CYRILLIC HEADINGS SWITCH FACE, as theirs do. base/_globals.scss:35-44. The rule, the reasons
  // it is load-bearing (Bebas Neue has no Cyrillic glyphs) and why it matches BOTH tag forms are
  // documented once at its source, ../../styles/portedGlobals.js -- this card supplies only its own
  // heading class, because the declaration is shared and the subject is not.
  cyrillicHeading('.rd-goal-card__title') +

  // ── the figure. .font-size-4xl .font-weight-medium / .font-size-lg
  // ★ NO line-height HERE. Theirs is `<p class="font-size-4xl font-weight-medium">` and the
  // .font-size-4xl utility sets ONLY a font-size — so their number inherits body's 1.5. Ours forced
  // 1.1, which was compensating for the base line-height we never ported (now on :host in
  // dxlife-tokens.js). The measured cost: 24px of card height, their number ~12px lower and its
  // label ~24px lower. Inheriting is the faithful port.
  // ★ A CLAMP, LIKE THEIRS, AND IT RESOLVES THE NOWRAP WORRY RATHER THAN FIGHTING IT.
  // utilities/_typography.scss gives .font-size-4xl
  //   font-size: clamp(var(--font-size-2xl), 6vw, var(--font-size-4xl))
  // and ours was a flat var(--font-size-4xl). Identical at 1440 and above (both sit on the ceiling),
  // but below that ours never shrank -- MEASURED against their resolved values:
  //     390px viewport   theirs 38.15   ours 59.60   ours 21.46 too large
  //     768px viewport   theirs 46.08   ours 59.60   ours 13.52 too large
  //    1024px and up     theirs 59.60   ours 59.60   identical
  // This was first reported as unchangeable because a figure must never split across lines in a 372px
  // card. That was backwards: the clamp makes the figure SMALLER exactly where the wrap was observed.
  // In a 372px container 6cqw is 22.3px, below the 2xl floor, so it resolves to 38.15px against the
  // 59.60px that was breaking. The clamp helps the very problem the flat value was chosen for, and
  // the nowrap stays as a belt.
  // cqw not vw, consistent with every other clamp in this port (the container-vs-viewport
  // substitution, provisional, pending a product decision); at 768 that lands 42.4 against their 46.08.
  '.rd-big{ margin:0; font-size:clamp(var(--font-size-2xl), 6cqw, var(--font-size-4xl));' +
  '  font-weight:500; }' +
  '.rd-goal-card .rd-big{ white-space:nowrap; }' +
  '.rd-big-label{ margin:0; font-size:var(--font-size-lg); }' +

  // ── the goal line. .region-goal — margin-top:auto, spelled at higher specificity than the stack
  // rule above so the override is unambiguous rather than depending on source order.
  // ★ margin-top:auto, AND IT IS LOAD-BEARING. Theirs is RegionDetail.vue:24 `.region-goal {
  // margin-top: auto }` inside `<div class="stack stack--lg | card | text-center">`, and
  // composition/_stack.scss makes .stack a flex COLUMN with `> * + * { margin-top:
  // var(--stack-spacing) }`. So the auto OVERRIDES that child margin and pushes the goal line to the
  // BOTTOM of the card. Ours was margin:0, which left it directly under the text above it.
  // The visible consequence, and why it matters for a clone: the three goal cards hold different
  // amounts of copy, so theirs align their goal lines flush along the cards' bottom edge while ours
  // floated at three different heights.
  // FOUND BY READING THEIR MARKUP after a spacing probe measured this pair as "same" -- which
  // it is, at 1440, because with no free space in the card the auto resolves to 0. An equal computed
  // margin hid a real difference, so the probe was right and incomplete at the same time.
  '.rd-goal{ margin:auto 0 0; font-size:var(--font-size-sm); }' +
  '.rd-goal-card > .rd-goal{ margin-top:auto; }' +
  // <strong> is --font-weight-medium on their site, not the UA's bold (portedGlobals.js carries the
  // source line). ★ SCOPED to .rd-goal, and the scope is the point: the plugin's own `.rd-root
  // strong` STAYS where it is, because UupgsList renders a <strong> in the same shadow root and
  // depends on it. So this is a SECOND rule for this card's subtree, not a move -- which is why the
  // shared helper is composed behind a prefix rather than emitted bare. Checked by reading the whole
  // root rather than this card's markup: a file-scoped grep would have called the plugin's copy dead
  // and deleted a rule another component needs.
  '.rd-goal ' + strongMedium()
, 'goal-card')
</script>

<template>
  <div class="rd-card rd-goal-card" :class="{ 'rd-card--secondary': variant === 'secondary' }">
    <h2 class="rd-goal-card__title">{{ title }}</h2>
    <div>
      <p class="rd-big">{{ value }}</p>
      <p class="rd-big-label">{{ valueLabel }}</p>
    </div>
    <slot />
    <p class="rd-goal"><strong v-if="goalLabel">{{ goalLabel }}{{ labelSeparator }}</strong>{{ goalLabel ? ' ' : '' }}{{ goal }}</p>
  </div>
</template>
