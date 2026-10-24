<script setup>
/**
 * RegionSectionCard.vue — one region as a card: a heading, a summary line, a grid of its countries,
 * and a footer link. The DX-life /regions card, made reusable.
 *
 * WHY THIS IS IN library/. So future plugins can reuse it: a parameterized component where a caller
 * sets the region titles and fills in the countries. The design is the point as much
 * as the markup: the 156 lines of CSS below are lifted UNCHANGED from the regions plugin, so a caller
 * gets the look, not a lookalike.
 *
 * ★ IT TAKES DATA, NOT AN API. The plugin version fetched its own regions and owned the layout, which
 * is what made it unusable anywhere else. This takes `title`, `summary` and `countries` and emits what
 * was clicked. Nothing here knows where regions come from.
 *
 * ★ THE CHEVRON IS INLINE ON PURPOSE, and this is the one thing a mover has to get right. The plugin
 * declared <symbol id="chevron-up"> ONCE in its own template and every card referenced it with
 * <use href="#chevron-up">. A shadow-root id is scoped to that root, so the same card mounted anywhere
 * else would reference a symbol that does not exist — and an unresolved <use> renders NOTHING, with no
 * error. The chevron would simply be missing. The plugin's own comment warns about exactly this class
 * for external hrefs ("would 404 SILENTLY and the chevron would simply vanish"); a cross-root id
 * reference fails the same way. So the path travels with the component.
 *
 * ★ RTL NEEDS AN ANCESTOR CARRYING dir, and that is a REQUIREMENT ON THE CONSUMER. The rules below
 * include [dir="rtl"] .region-card__icon, ported because a chevron meaning "forward" must mirror in
 * Arabic while a disclosure caret meaning "open/closed" must not — and the rtl --open rule is
 * load-bearing, since [dir="rtl"] .region-card__icon is specificity 0-2-0 and would otherwise beat the
 * 0-1-0 --open modifier and freeze the caret. The regions plugin satisfies this because .rl-root
 * carries :dir itself. A new consumer must set dir on an ancestor inside its own shadow root, or the
 * mirroring silently will not happen.
 *
 * ★ EXTRA CONTENT IS A SLOT, NOT A PROP. The regions plugin shows a country-poster wall under each
 * card, configured with fourteen PosterWall props. Baking that in would have dragged one plugin's
 * feature into every consumer's API. The `extra` slot keeps it where it belongs.
 */
import { useShadowStyles } from '../../composables/useShadowStyles.js'
import { cyrillicHeading } from '../../styles/portedGlobals.js'

const props = defineProps({
  /** The region's display name. Already localized by the caller. */
  title:       { type: String, default: '' },
  /** The line under the title, e.g. "12 countries · 480 groups". Caller-formatted. */
  summary:     { type: String, default: '' },
  /** [{ name, count, slug }] — `count` is optional and rendered in parentheses when present. */
  countries:   { type: Array,  default: () => [] },
  /** The footer link's text, e.g. "View the region dashboard". Omit it to hide the footer. */
  footerLabel: { type: String, default: '' },
  /**
   * OPTIONAL DISCLOSURE ROW, and the card owns it deliberately. The regions plugin needed a
   * "View country posters" toggle under each card. The first cut put that row in the consumer's slot
   * — which immediately meant copying this component's footer-link look and its rotating caret back
   * into the plugin, i.e. re-creating the duplication this extraction exists to remove. A disclosure
   * inside a card is a CARD feature; only the revealed CONTENT belongs to the consumer.
   * Omit the label to hide the row entirely.
   */
  disclosureLabel: { type: String, default: '' },
  disclosureOpen:  { type: Boolean, default: false },
  /** id for aria-controls, so the button and the revealed region are really associated. */
  disclosureId:    { type: String, default: '' },
})

const emit = defineEmits(['select', 'select-country', 'toggle-disclosure'])

useShadowStyles(
  // .region-card: DX-life's --border-radius-xlg (35px), overflow hidden, white body, no border --
  // the dark header band supplies its own edge, unlike our old grey-outlined card.
  '.region-card{ flex:0 0 auto; border-radius:var(--dx-radius); overflow:hidden; background:var(--dx-elevated); }' +
  // .region-card__header: padding = --spacing-md / clamp(--spacing-md,4vw,--spacing-2xl) -- the clamp
  // is KEPT as a clamp (var(--spacing-md) / var(--spacing-2xl) are the resolved ends), not frozen at its desktop maximum.
  // gap = --spacing-2xs (7.5px), on --color-surface-brand.
  '.region-card__header{ display:flex; flex-direction:column; gap:var(--spacing-2xs);' +
  '  padding:var(--spacing-md) clamp(var(--spacing-md), 4cqw, var(--spacing-2xl));' +
  '  background:var(--dx-header-bg); color:var(--dx-header-text); }' +
  // .region-card__title: font-size clamp(--font-size-xl,4vw,--font-size-3xl) = clamp(var(--font-size-xl),_,var(--font-size-3xl)).
  // A phone gets the var(--font-size-xl) FLOOR, as theirs does; it only reaches var(--font-size-3xl) past ~1192px of width.
  // DX-life's heading font (Bebas Neue -- a bold condensed display face), regular weight (the
  // face itself carries the boldness), all-caps to match the source screenshot exactly.
  // Bebas Neue itself is DX-life's own self-hosted font file (doxa.life/assets/fonts/BebasNeue/),
  // not served with CORS -- cross-origin @font-face silently fails without it, so it cannot be
  // loaded here without shipping a font asset this repo doesn't own. Approximated with the
  // standard condensed-display-face fallback stack (bold weight + font-stretch:condensed + tight
  // tracking), since Bebas Neue's glyphs read as heavy/compressed even at its nominal "400" weight.
  // getComputedStyle() on the live card title reads weight 400 / line-height 1.0 (47.68px on a
  // 47.69px font-size) / letter-spacing normal / text-transform none -- Bebas Neue's own glyphs
  // are what read as bold+condensed+caps-like, DX-life applies NO transform on top of the font.
  // Our fallback stack has no true Bebas-Neue substitute, so font-stretch:condensed stands in for
  // the face's natural narrowness, but weight/leading/tracking/case now match the measured values
  // exactly rather than compounding extra "boldness" the source doesn't have.
  '.region-card__title{ margin:0; font-size:clamp(var(--font-size-xl), 4cqw, var(--font-size-3xl)); line-height:1;' +
  '  font-family:"Bebas Neue","Arial Narrow",BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;' +
  '  font-weight:400; letter-spacing:normal; }' +
  // Their link is an <a class="region-card__link | with-icon">, so it carries their `a` rule's
  // font-weight: var(--font-weight-medium) = 500 (_globals.scss:132). Ours is a <button>
  // because this element has no router, and `font:inherit` gave it 400 — MEASURED against
  // their live /regions. Same class of miss as the dashboard back-link.
  // The icon spacing is theirs too: .with-icon is inline-flex with align-items:baseline and NO
  // gap (composition/_icon.scss:12), and the 1rem separation comes from
  // `.with-icon .icon.right { margin-inline-start: 1rem }` — 10px at their 10px root. We had
  // the same 10px via `gap`, which looks identical but means their rule would not apply, so
  // the mechanism is now theirs: margin on the icon, gap left alone.
    // ★ text-align:START, not left. Theirs is a NuxtLink, an inline <a> that shrink-wraps to its
  // text; ours must be a <button> because this element changes the embed's subject in place instead
  // of navigating a route. A button's UA default is text-align:center, so the port overrode it -- but
  // it overrode it with the PHYSICAL `left`, which is identical to `start` in English and its
  // opposite in Arabic. MEASURED on live /ar/regions vs ours at dir=rtl: same 246.9px row and the
  // same 102.7px of text, their label flush to the row's RIGHT edge (gap 0px, the RTL reading start)
  // and ours flush LEFT -- every label stranded 144.2px on the wrong side. Invisible in English,
  // which is exactly why it survived a 37-property card diff and an 11-property bullet diff.
  '.region-card__link{ appearance:none; background:none; border:0; padding:0; margin:0; text-align:start;' +
  '  cursor:pointer; color:inherit; font:inherit; font-weight:500;' +
  '  display:inline-flex; align-items:baseline; }' +
  '.region-card__link:hover{ color:#92b195; }' +
  '.region-card__link:focus-visible{ outline:2px solid #fff; outline-offset:2px; }' +
  // .region-card__icon: DX-life's own <svg class="icon | rotate-90 right"><use href="arrow-
  // chevron.svg#chevron-up"></use></svg> -- a REAL chevron path (viewBox 0 0 489.67 289.877),
  // not a text glyph. Ported verbatim (fill:currentColor tracks the surrounding text colour,
  // same as their `.icon{ fill:currentColor }` utility) and rotated 90deg to point right, same
  // as their `rotate-90` class. getComputedStyle measured it at 33.38px square on the live page.
  // ★ 1rem WAS THE ONE UNIT IN THIS PORT THAT INHERITS THE HOST PAGE'S ROOT, and it was wrong on
  // our own leaf, not only in an embed. `rem` resolves against the DOCUMENT root wherever the
  // element lives — which is the whole reason dxlife-tokens.js resolves their scale to px — and
  // their root is 10px (html{font-size: var(--font-size-base)}, $font-size-base: 10px). Ours
  // inherits whatever the host sets: 16px by default, so this gap rendered 16px against their
  // 10px, and on a host with the common html{font-size:62.5%} reset it would render 10px by
  // accident. Pinned to the value their root produces, like every other token here.
  // No diff caught it: the list diff's `link` spec reads colour, decoration, weight, display and
  // alignItems — no margin — so the icon's own spacing was never a measured property. It is now.
  // (Credit where due: the class of bug came to me as a flock relay from another agent's sweep.)
  '.region-card__icon{ width:0.7em; height:0.7em; flex:none; fill:currentColor; transform:rotate(90deg);' +
  '  margin-inline-start:10px; }' +
  // .region-card__summary: --font-size-md (var(--font-size-md)), 0.85 opacity, on the header band.
  '.region-card__summary{ font-size:var(--font-size-md); opacity:0.85; margin:0; }' +
  // ★ CYRILLIC HEADINGS SWITCH FACE, as theirs do. base/_globals.scss:35-44. The declaration and the
  // reasons it is load-bearing live at ../../styles/portedGlobals.js; this card supplies its two
  // heading classes.
  // ★ BOTH CLASSES IN ONE CALL, not two, because they were ONE grouped rule and the extraction had to
  // stay byte-identical: two calls emit two rules, which a browser renders the same and the gate
  // reports as a change. Equivalent CSS is not the bar here; unchanged CSS is.
  // ONLY the headings, exactly as theirs — their .region-stat__value is a <p> and keeps Bebas even in
  // Russian, which is their behaviour and so is ours.
  cyrillicHeading('.rl-title', '.region-card__title') +
  // .region-card__body: padding --spacing-lg / clamp(...) / --spacing-xl -> var(--spacing-lg) / clamp / var(--spacing-xl)
  '.region-card__body{ padding:var(--spacing-lg) clamp(var(--spacing-md), 4cqw, var(--spacing-2xl)) var(--spacing-xl); }' +
  // .countries-grid: DX-life's track is minmax(220px,1fr). Gap --spacing-xs / --spacing-xl
  // (10px / var(--spacing-xl)). getComputedStyle on the live grid shows padding-left:35.16px -- that's the
  // page's global `ul` reset (bullets kept, not list-style:none), so the whole grid is indented
  // one list-item's worth even though DX-life's countries-grid a rule doesn't set it directly.
  // Reproduced with list-style:none + the same 35.16px indent kept explicitly so a real list
  // bullet has somewhere to sit without stealing width from the text column.
    // padding-INLINE-start, as theirs is (1.8em). The physical `padding-left:35.2px` it replaces
  // put the indent on the wrong side in Arabic, where the bullets hang off the right edge.
  '.countries-grid{ list-style:none; margin:0; padding-inline-start:1.8em; display:grid;' +
  '  grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px var(--spacing-xl); }' +
  // Plain inline text (not a flex row) so multi-line country names wrap the same way DX-life's
  // <NuxtLink> text does -- a flex row with align-items:baseline pinned the bullet to the first
  // line only and stranded the (count) span beside the second line on wrap. font-weight:500
  // matches getComputedStyle() on the live country links (theirs is medium, not regular).
  // Their country entries are bare <NuxtLink>s inside .countries-grid li — no class of their
  // own — so they take their `a` rule: color var(--color-brand-light) = $color-green-400 =
  // #4e594f, font-weight medium. MEASURED on their live /regions: rgb(78, 89, 79). Ours used
  // var(--dx-text), which resolves to rgb(42, 51, 42) — the body ink, not their link ink.
  '.country-link{ appearance:none; background:none; border:0; padding:2px 0; margin:0;' +
  '  text-align:start; cursor:pointer; color:#4e594f; font:inherit; font-size:var(--font-size-md);' +
  '  font-weight:500; width:100%; position:relative; }' +
  // inset-inline-start, NOT left: the bullet hangs off the text's starting edge, which is the
  // RIGHT edge in Arabic. With `left:-16px` it stayed on the physical left in RTL — measured
  // at locale=ar, computed right was 256.938px instead of the -16px near-edge overhang.
  // ★ THEIR BULLET, COPIED — not an invented dot. base/_globals.scss:117-131 paints the list
  // marker with a 16x16 data-URI SVG circle in #92b195 sized to 1.5em, hung off the text's start
  // edge by margin-inline-start:-1.3em (-2em in RTL), top .3em, line-height .9. Their
  // .countries-grid comment is explicit that keeping it is deliberate ("Keeps the site's list
  // bullets (global ul padding + ::before dot)").
  // An earlier port re-created it as a 6px border-radius:50% square, and MEASURED against live it was wrong
  // in 9 of 11 properties: 6px vs 29.2969px box, solid fill vs a transparent box carrying the
  // image, top 11.72px vs 5.86px, and positioned with inset-inline-start:-16px instead of their
  // negative margin. Not a near-miss — a different bullet.
  // The rule is a double-quoted JS string because the data URI contains single quotes.
  ".country-link::before{ content:''; position:absolute; top:0.3em; width:1.5em; height:1.5em;" +
  "  line-height:0.9; margin-inline-start:-1.3em; background-repeat:no-repeat;" +
  "  background-image:url(\"data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 16 16' fill='%2392b195' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='8' cy='8' r='7' stroke='%2392b195' stroke-width='1.5'/%3E%3C/svg%3E\"); }" +
  // Their RTL variant. It is a separate rule here rather than a nested [dir="rtl"] & because this
  // CSS lives in a shadow root, where a [dir] selector on an outer ancestor does not reach in.
  '[dir="rtl"] .country-link::before{ margin-inline-start:-2em; }' +
  '.country-link:hover{ text-decoration:underline; text-decoration-color:#92b195; }' +
  '.country-link:focus-visible{ outline:2px solid #92b195; outline-offset:2px; border-radius:4px; }' +
  '.country-link__count{ color:var(--dx-muted); }' +
  // .region-card__footer: DX-life's exact rule -- flex, flex-end, margin-top --spacing-lg (var(--spacing-lg)),
  // NO margin-bottom. This element is a <p>; its user-agent default margin-block-end (~var(--font-size-md) at
  // this font-size) was leaking through because only margin-top was ever set -- pin margin:0
  // first, then apply margin-top, so the bottom UA default can't survive the cascade.
  // The toggle row and the wall it opens. The caret rotates rather than swapping glyphs,
  // which is what makes open/closed legible at a glance.
  '.region-card__posters-toggle{ margin-top:0; }' +
  '.region-card__icon--open{ transform:rotate(180deg); }' +
  // RTL MIRRORING, ported from their utilities/_shapes.scss:
  //   .rotate-90 { transform:rotate(90deg); [dir="rtl"] & { transform:rotate(-90deg); } }
  // Their .rotate-180 has NO rtl variant, and that distinction is the whole rule: a chevron that
  // means "forward" must mirror, a disclosure caret that means "open/closed" must not. MEASURED
  // on live doxa.life: .region-card__link svg is matrix(0,1,-1,0,0,0) at /regions and
  // matrix(0,-1,1,0,0,0) at /ar/regions — ours stayed at +90deg in Arabic, so the chevron sat on
  // the correct side pointing the WRONG WAY. Found by looking at the Arabic screenshot.
  // The selector works inside our shadow root because .rl-root carries :dir itself.
  '[dir="rtl"] .region-card__icon{ transform:rotate(-90deg); }' +
  // ...and this one is load-bearing: [dir="rtl"] .region-card__icon is specificity 0-2-0, which
  // would otherwise beat the 0-1-0 --open modifier and freeze the poster caret in Arabic.
  '[dir="rtl"] .region-card__icon--open{ transform:rotate(180deg); }' +
  '.region-card__posters{ margin-top:13.3px; }' +
  '.region-card__footer{ display:flex; justify-content:flex-end; margin:0; margin-top:var(--spacing-lg);' +
  '  padding:0 clamp(var(--spacing-md), 4cqw, var(--spacing-2xl)) var(--spacing-lg); }' +
  '.region-card__footer-link{ appearance:none; background:none; border:0; padding:0; margin:0;' +
  '  cursor:pointer; font:inherit; font-size:var(--font-size-md); font-weight:500; color:var(--dx-link);' +
  '  display:inline-flex; align-items:baseline; gap:10px; text-decoration:underline; text-decoration-thickness:2px; }' +
  '.region-card__footer-link:hover{ color:var(--dx-header-bg); }' +
  '.region-card__footer-link:focus-visible{ outline:2px solid var(--dx-link); outline-offset:2px; border-radius:4px; }',
  // ★ THIS LABEL MUST NOT BE 'regions-list'. useShadowStyles keys its <style> by the label, and on a
  // COLLISION it OVERWRITES the existing tag's text rather than adding one (useShadowStyles.js:60-61).
  // This card is a CHILD of regions-list, so they share one shadow root: with both keyed
  // 'regions-list' the cards mount second, find the list's tag and replace the .rl-* rules with the
  // card CSS. Measured in the running page: .rl-root went position:static, .rl-scroll overflow-y:
  // visible, 3 style tags where a working tree has 4, and no 'rl-root{' anywhere in the root -- so
  // the regions list could not scroll and its lower regions were unreachable.
  // The stray extra argument was the whole bug: useShadowStyles takes (css, label), so the SECOND
  // argument was the key and 'region-section-card' was silently ignored.
  'region-section-card')
</script>

<template>
  <div class="region-card">
    <div class="region-card__header">
      <h2 class="region-card__title">
        <button type="button" class="region-card__link" @click="emit('select')">
          {{ title }}
          <svg class="region-card__icon" viewBox="0 0 489.67 289.877" aria-hidden="true">
            <path d="M439.017,211.678L263.258,35.919c-3.9-3.9-8.635-6.454-13.63-7.665-9.539-2.376-20.051.161-27.509,7.619L46.361,211.632c-10.323,10.323-10.323,27.056,0,37.379,10.323,10.323,27.056,10.323,37.379,0l161.068-161.068,161.068,161.068c10.323,10.323,27.056,10.323,37.379,0,10.277-10.324,10.277-27.011-.238-37.333Z"/>
          </svg>
        </button>
      </h2>
      <p v-if="summary" class="region-card__summary">{{ summary }}</p>
    </div>

    <div class="region-card__body">
      <ul class="countries-grid">
        <li v-for="c in countries" :key="c.slug || c.name">
          <button type="button" class="country-link" @click="emit('select-country', c)">
            {{ c.name }}<span v-if="c.count != null" class="country-link__count"> ({{ c.count }})</span>
          </button>
        </li>
      </ul>
    </div>

    <p v-if="footerLabel" class="region-card__footer">
      <button type="button" class="region-card__footer-link" @click="emit('select')">
        {{ footerLabel }}
        <svg class="region-card__icon" viewBox="0 0 489.67 289.877" aria-hidden="true">
          <path d="M439.017,211.678L263.258,35.919c-3.9-3.9-8.635-6.454-13.63-7.665-9.539-2.376-20.051.161-27.509,7.619L46.361,211.632c-10.323,10.323-10.323,27.056,0,37.379,10.323,10.323,27.056,10.323,37.379,0l161.068-161.068,161.068,161.068c10.323,10.323,27.056,10.323,37.379,0,10.277-10.324,10.277-27.011-.238-37.333Z"/>
        </svg>
      </button>
    </p>

    <p v-if="disclosureLabel" class="region-card__footer region-card__posters-toggle">
      <button
        type="button"
        class="region-card__footer-link"
        :aria-expanded="disclosureOpen ? 'true' : 'false'"
        :aria-controls="disclosureId || undefined"
        @click="emit('toggle-disclosure')"
      >
        {{ disclosureLabel }}
        <svg class="region-card__icon" :class="{ 'region-card__icon--open': disclosureOpen }" viewBox="0 0 489.67 289.877" aria-hidden="true">
            <path d="M439.017,211.678L263.258,35.919c-3.9-3.9-8.635-6.454-13.63-7.665-9.539-2.376-20.051.161-27.509,7.619L46.361,211.632c-10.323,10.323-10.323,27.056,0,37.379,10.323,10.323,27.056,10.323,37.379,0l161.068-161.068,161.068,161.068c10.323,10.323,27.056,10.323,37.379,0,10.277-10.324,10.277-27.011-.238-37.333Z"/>
          </svg>
      </button>
    </p>

    <!-- Only the revealed CONTENT is the consumer's. The regions plugin puts its PosterWall here. -->
    <div v-if="disclosureOpen" :id="disclosureId || undefined" class="region-card__posters">
      <slot name="extra" />
    </div>
  </div>
</template>
