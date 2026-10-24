/**
 * breakpoints.js — the one width at which this dashboard stops being a three-column board.
 *
 * ★ IT IS A CONSTANT BECAUSE IT WAS TWO NUMBERS. board.vue collapsed to a single panel below
 * 760px; the set charts stacked their legend below 900px. Between those two widths the board
 * still held three columns while a chart inside it had already given up on having room — at
 * 768 the centre column was about 145px, so the bounded figure was crushed to 124px and the
 * centered figure's own minimum made it spill UNDER the right-hand panel.
 *
 * Neither number was wrong on its own. The defect was that they were separate, and nothing
 * connected the width at which a chart needs room to the width at which the board gives it any.
 */
export const NARROW_MAX = 900

/** True when the shell is too narrow for side panels beside the centre column. */
export function isNarrowWidth(px) {
  return Number(px) < NARROW_MAX
}
