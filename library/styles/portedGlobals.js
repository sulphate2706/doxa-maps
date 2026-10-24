/**
 * portedGlobals — DX Life's base/_globals.scss rules, once, for shadow-root components.
 *
 * Page CSS cannot reach into a shadow root, so every component that must look like DX Life carries
 * its own copy of that site's element rules. Seven files did, each citing base/_globals.scss by
 * line. MEASURED before extracting: where the copies overlap they are BYTE-IDENTICAL (the Cyrillic
 * font stack 3x, strong{font-weight:500} 2x, scrollbar-gutter:stable 2x). So this module is
 * DEDUPLICATION, not a fix, and its correctness test is that the emitted CSS does not change —
 * internal/check-ported-globals-identical.mjs holds the before/after hashes.
 *
 * ★ IT EXPORTS FUNCTIONS, NOT STRINGS, and that is forced by the measurement. The six copies of the
 * Cyrillic rule share ONE declaration but have SIX DIFFERENT SUBJECTS — .rd-goal-card__title,
 * .rd-h2, .rd-title, .region-card__title, .rl-title (x2). A module exporting a fixed rule string
 * would have to pick one class and would silently stop styling the other five. The caller owns its
 * selector; this module owns the declaration.
 *
 * ★ AND IT TAKES A LIST, NOT A SELECTOR, which the first draft of this module got wrong. GoalCard
 * styles ONE heading class; RegionSectionCard GROUPS TWO (.rl-title and .region-card__title) into a
 * single rule sharing one declaration block. A one-selector signature cannot reproduce the grouped
 * form — it would emit two separate rules. Same CSS to a browser, but this refactor's whole proof is
 * that the emitted bytes do not change, so "equivalent" is not good enough. Caught by diffing the
 * two call sites before writing the callers, not after the hashes disagreed.
 *
 * Plain JS returning CSS strings, zero imports, no build step — the same pure-module shape as
 * packetSets.js, so a Node gate and a Vite bundle both consume it unchanged.
 */

/**
 * base/_globals.scss:35-44 — h1,h2,h3 switch face under Cyrillic.
 *
 * ⚠ NOT DECORATION: Bebas Neue HAS NO CYRILLIC GLYPHS, so a Russian heading left in it falls out of
 * the family entirely and lands on whatever condensed system face the browser picks.
 * ⚠ BOTH TAG FORMS, deliberately: their site tags the document ru-RU while our i18n locale is `ru`,
 * and a host page embedding one of these elements may set either. A selector matching only one
 * works on their site and fails on ours, or the reverse, depending on who set the attribute. Do not
 * "simplify" this to a single form.
 *
 * @param {...string} selectors the caller's own heading classes, e.g. '.rl-title', '.region-card__title'.
 *   Several are GROUPED into one rule sharing one declaration block, which is how RegionSectionCard
 *   already spells it — pass them together rather than calling this twice.
 * @returns {string} one CSS rule
 */
export function cyrillicHeading(...selectors) {
  if (!selectors.length) throw new Error('cyrillicHeading: needs at least one selector')
  const subjects = selectors
    .map((s) => `[lang="ru"] ${s}, [lang="ru-RU"] ${s}`)
    .join(',')
  return `${subjects}{ font-family:"Oswald","Arial Narrow",BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;` +
    '  letter-spacing:-0.02em; }'
}

/** base/_globals.scss:200-202 — <strong> is --font-weight-medium (500) on their site, not the UA's bold. */
export function strongMedium() {
  return 'strong{ font-weight:500; }'
}

/**
 * base/_globals.scss html rule — reserve the scrollbar track so content does not shift by its width
 * when a list grows past the viewport.
 */
export function scrollbarGutter() {
  return 'scrollbar-gutter:stable;'
}

/**
 * ⚠ DELIBERATELY NOT PORTED, and recorded here so nobody "completes" the set later:
 *
 *   _globals.scss:80  `img { border-radius: var(--border-radius) }`
 *
 * region-dashboards.vue:805 declines it on purpose. Rounding every image inside these components is
 * not wanted — their site applies it in a context ours does not share. If a future component needs
 * it, it should opt in explicitly rather than inherit it from a shared module, because an omission
 * that is invisible is an omission that gets "fixed".
 */
export const NOT_PORTED = Object.freeze({
  'img border-radius': '_globals.scss:80 — declined at region-dashboards.vue:805; opt in explicitly if ever needed',
})
