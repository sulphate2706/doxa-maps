/**
 * Their box-sizing reset, ported into the shadow root.
 *
 * WHAT THIS IS. app/assets/styles/base/_reset.scss:3-8 on DX-life master, verbatim:
 *
 *     *,
 *     *::before,
 *     *::after {
 *       box-sizing: border-box;
 *     }
 *
 * a piccalil.li reset that applies to EVERY element on their page.
 *
 * WHY IT WAS MISSING FOR SO LONG, and why no component could reveal it. Our leaf document already
 * carries the identical rule (regions-dashboard/index.html:9) -- but these components render inside
 * a SHADOW ROOT, and a document-level `*` selector does not cross a shadow boundary. So every
 * element in here was content-box while every element of theirs was border-box, and no scoped
 * component style could show the difference. It was the SEVENTH global rule of theirs found
 * missing, and it is why this codebase had accumulated seven separate per-element
 * `box-sizing:border-box` patches: each was a local workaround for the reset that never arrived.
 *
 * WHAT IT COST, measured rather than described: their legend swatch is `width:10px; border:1px
 * solid #fff` -- 10px under border-box, 12px under content-box. Two swatch columns of 1px each are
 * exactly the 2px by which our legend panel measured wider than theirs (167px vs 165px) after the
 * rest of the legend had been aligned to the pixel. The same label string measured 129px on both
 * sides in the same Poppins, so the text was never the cause.
 *
 * WHY PORTING IT IS SAFE, and this is the part that made the change cheap instead of frightening:
 * the blast radius was MEASURED before any of it was written.
 * _probe-boxsizing-blast-radius.mjs injected this exact rule into every shadow root at runtime and
 * diffed every element's rect before and after -- 0 of 431 elements moved on region-dashboards and
 * 0 of 678 on regions-list, with 301 already border-box by their own declarations. So the port is a
 * geometric NO-OP and the whole value of it is DELETING the per-element patches it replaces, which
 * is the direction RULE 3 asks for. The detector was negative-tested (NEG=1 injects padding-left:3px
 * and it reports the movement), because a zero from a check that cannot fail is worth nothing.
 *
 * WHY HERE AND NOT library/useShadowStyles.js. Putting it there would fix all 25 bundles at once and
 * is tempting for exactly that reason -- but the blast radius above was measured on THESE two pages
 * only, and geometry in 23 other bundles would change on an unmeasured basis. RULE 2 says default to
 * the plugin folder; the second consumer that would justify library/ is not named yet. If another
 * plugin wants it, it moves then, with that plugin's blast radius measured too.
 *
 * WHY A MODULE AND NOT THREE COPIES. Three roots inject into the shared shadow root
 * (region-dashboards, regions-list, regions-mfe) and any of them can be the one that mounts, so all
 * three need it. One exported string keeps it one fact in one place.
 */

/** Their _reset.scss:3-8, as a shadow-root-scoped rule. */
export const SHADOW_BOX_SIZING_RESET =
  '*, *::before, *::after{ box-sizing:border-box; }'

export default SHADOW_BOX_SIZING_RESET
