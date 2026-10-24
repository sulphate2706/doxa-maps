<!--
  MapControlButton.vue — Shared base button for all map toolbar controls.

  Renders a single round button with consistent light/dark mode styling.
  Each specific button (ZoomIn, Location, etc.) wraps this component and
  supplies its own icon slot + service logic.

  Props:
    isDark   — mirrors the app theme; switches bg/border/shadow
    title    — tooltip text
    active   — optional pressed/active visual state (e.g. fullscreen on)
    disabled — disables interaction

  Emits:
    click    — forwarded from the native button element
-->
<script setup>
import { useShadowStyles } from '../../composables/useShadowStyles.js'

useShadowStyles(`
.mcb{
  width:var(--map-btn-size,40px);height:var(--map-btn-size,40px);
  background:#fff;
  border:none;
  border-radius:50%;
  cursor:pointer;
  /* Don't let a drag that starts near a button select its glyph (the old
     "drag selects the emoji to copy" bug while grabbing the scroll edge). */
  user-select:none;-webkit-user-select:none;
  display:flex;align-items:center;justify-content:center;
  /* Tight shadow only — the old 0 2px 8px spread bled to the map's clipped right
     edge (overflow:hidden) and read as a "shadow wall" + made buttons look
     over-padded. (coder 2026-06-24) */
  box-shadow:0 1px 3px rgba(0,0,0,0.18);
  transition:background-color 0.2s,box-shadow 0.2s,transform 0.1s;
  color:#333;
  flex-shrink:0;
  outline:none;
  /* No blue/grey selection box on click/tap (webkit tap highlight). */
  -webkit-tap-highlight-color:transparent;
}
.mcb:hover:not(:disabled){background:#f0f0f0;box-shadow:0 2px 8px rgba(0,0,0,0.18),0 4px 16px rgba(0,0,0,0.12);}
.mcb:active:not(:disabled){transform:scale(0.93);}
.mcb:disabled{opacity:0.4;cursor:not-allowed;}
/* ★ KEYBOARD FOCUS WAS INVISIBLE (measured 2026-09-24). outline:none above is deliberate —
   it kills the webkit focus box on click/tap, alongside -webkit-tap-highlight-color — but it
   had no :focus-visible replacement, so a sighted keyboard user Tabbing onto ANY map control
   in ANY bundle saw nothing at all. Found by tabbing through the regions element: of 30 focus
   stops, 29 showed a 2px ring and one, button.mcb, showed outline: none with no text.
   The accessible NAME was already fine (aria-label mirrors title, 2026-09-21), so screen
   readers were never affected — only the people who navigate by eye and keyboard.
   :focus-visible is the correct half of the pair: it never fires for a mouse click, so the
   original reason for outline:none still holds and the mouse appearance is unchanged. Placed
   before the .active/.dark rules so those still win on background/colour.
   Consumers re-checked (RULE 2): ShareButton, ZoomInButton, ZoomOutButton, FullscreenButton,
   HelpButton, ThemeToggleButton, LocationButton, map-controls/index.js, plus
   my-upg-100-list/upg-100-list.vue and research-dashboard's DashboardDataTable. All of them
   render this button icon-only, so none of them styled focus themselves and none can regress:
   the rule only adds a ring where there was none. */
.mcb:focus-visible{outline:2px solid #1a73e8;outline-offset:2px;}
.mcb.dark:focus-visible{outline:2px solid #92b195;outline-offset:2px;}
.mcb.active{background:#e8f0fe;color:#1a73e8;}
/* dark */
.mcb.dark{background:#3b463d;color:#F3F3F1;border:1px solid rgba(255,255,255,0.14);box-shadow:0 1px 4px rgba(0,0,0,0.4);}
.mcb.dark:hover:not(:disabled){background:#4e594f;box-shadow:0 2px 8px rgba(0,0,0,0.5);}
.mcb.dark.active{background:#4e594f;color:#92b195;}
@media(max-width:767px){.mcb{width:36px;height:36px;}}
/* shape="square" on a STANDALONE button: their 4px corners, our fill and shadow kept.
   A button inside .map-toolbar--square is overridden back to 0 by the toolbar's rules. */
.mcb--square{ border-radius:4px; }
/* shape="rounded-square" — the HEADER-BAR button form (design rule, 2026-09-30): map controls stay ROUND,
   but a button in a dashboard HEADER is a rounded square at the SAME radius as the gallery's vertical
   tabs. --vtl-radius is that ONE shared variable (VerticalTabsLayout .vtl-tab), so the header button
   and the tabs can never drift; 8px is only the fallback for a context that never set it. */
.mcb--rounded-square{ border-radius:var(--vtl-radius,8px); }

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .mcb-btn { transition: none !important; animation: none !important; }
}
`, 'map-control-button')

defineProps({
  isDark:   { type: Boolean, default: false },
  title:    { type: String,  default: '' },
  active:   { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  /**
   * 'round' (default) is the 50% circle every map ships. 'square' is for a button used OUTSIDE a
   * MapToolbar -- inside one, set controls="square" on the TOOLBAR instead and it styles its whole
   * column, because the engine's square form is a grouped panel and a single button cannot be one.
   * ★ A STANDALONE SQUARE KEEPS ITS OWN FILL AND SHADOW and takes only the 4px corners, which is
   * what the engine gives a lone control: `button:focus:only-child { border-radius: inherit }` from
   * a group whose radius is 4px. Inside a toolbar the panel owns the fill, so the toolbar's rules
   * strip it back off -- the two rule sets compose rather than compete, and the toolbar wins by
   * being the more specific selector.
   */
  shape:    { type: String,  default: 'round' }
})

defineEmits(['click'])
</script>

<template>
  <!--
    ★ aria-label MIRRORS title (2026-09-21). These buttons render an ICON via <slot/> and carried
    ONLY `title`, so their accessible name was EMPTY: a screen reader announced "button" with no
    indication of what it does. `title` is a tooltip, not an accessible name — it is unreliably
    announced, and never surfaced to touch users at all.

    Found while proving the research-dashboard zoom controls actually WORK (they do: a click
    triggered 6 tile requests at zoom level 2). The probe that matched on aria-label found nothing
    while the probe that fell back to title found both buttons — the discrepancy WAS the defect.

    One binding here reaches all EIGHT control buttons (zoom in/out, fullscreen, location, help,
    share, hamburger, theme) across SEVEN map bundles, because every one composes this base.
    No caller has to change. This component does not set inheritAttrs:false, so a caller that
    passes its own aria-label still wins via normal attribute fallthrough — no $attrs juggling
    needed here, and `undefined` omits the attribute entirely when there is no title to mirror.

    ★ data-control (zoom-in, zoom-out, fullscreen, theme, location, help, share) is set by each
    wrapper and falls through to this <button>. It is the UNTRANSLATED identity: title and
    aria-label are localised, so a probe that finds a control by its text breaks in every other
    locale. Query `.mcb[data-control="zoom-in"]`, never the title.
  -->
  <button
    class="mcb"
    :class="{ dark: isDark, active, 'mcb--square': shape === 'square', 'mcb--rounded-square': shape === 'rounded-square' }"
    :title="title"
    :aria-label="title || undefined"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <slot />
  </button>
</template>
