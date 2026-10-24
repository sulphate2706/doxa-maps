/**
 * useCardSurface.js — the DX-life card surface, as ONE rule set shared by every card component.
 *
 * WHY THIS IS A MODULE AND NOT A COPY IN EACH CARD. Vue only injects the ROOT component's <style>
 * into a shadow root, so every library component that renders inside one carries its own CSS and
 * injects it with useShadowStyles (see that file). StatCard and GoalCard are two components that
 * need the SAME surface -- radius, elevation, padding, and the two variants -- and a copy in each is
 * a rule set that will drift the first time one of them is tuned.
 *
 * THE STABLE LABEL IS THE WHOLE TRICK. useShadowStyles dedups on its label, so both cards (and any
 * consumer that renders .rd-card markup of its own) can call useCardSurface() and exactly ONE
 * <style data-shadow-styles="dxlife-card-surface"> lands per shadow root, no matter how many card
 * components mount inside it. Calling it from N components is not N stylesheets.
 *
 * ★ THE CLASS NAMES KEEP THEIR `rd-` PREFIX, DELIBERATELY. It came from the regions-dashboard port
 * and means nothing outside it. Renaming would change no pixel and would cost the traceability from
 * each declaration back to the DX-life rule and the measurement that fixed it, which is the only
 * reason these values can be defended. The names are internal to the components; a consumer writes
 * <StatCard> and never types them. A rename is a safe later cleanup, not a prerequisite for reuse.
 *
 * CONTRACT: the shadow root must already carry the DX-life token layer (--dx-radius, --dx-elevated,
 * --dx-text, --dx-dark, --dx-on-dark, --spacing-*). The regions plugin injects it as DXLIFE_TOKENS.
 * Without it these rules resolve to nothing -- they are a skin over that scale, not a replacement.
 */
import { useShadowStyles } from './useShadowStyles.js'

export const CARD_SURFACE_CSS =
  // ── .card: blocks/_cards.scss:9-21. radius --border-radius-xlg (35px);
  //    padding clamp(--spacing-lg, 6vw, --spacing-2xl) clamp(--spacing-lg, 6vw, --spacing-3xl).
  '.rd-card{ position:relative; border-radius:var(--dx-radius);' +
  '  background:var(--dx-elevated); color:var(--dx-text);' +
  '  padding:clamp(var(--spacing-lg), 6cqw, var(--spacing-2xl)) clamp(var(--spacing-lg), 6cqw, var(--spacing-3xl)); }' +
  // .card[padding-small] -> --spacing-lg flat
  '.rd-card--small{ padding:var(--spacing-lg); }' +
  // .card[data-variant="secondary"] -> surface-brand-dark on text-on-brand-light
  '.rd-card--secondary{ background:var(--dx-dark); color:var(--dx-on-dark); }'

/**
 * Injects the card surface into the containing shadow root, once, under a stable label.
 * Call it at setup() time from any component that renders .rd-card markup.
 */
export function useCardSurface() {
  useShadowStyles(CARD_SURFACE_CSS, 'dxlife-card-surface')
}
