/**
 * formatCount — the ONE place the fleet decides how a COUNT is punctuated.
 *
 * ★ IT HOLDS en-US ON PURPOSE. Whether numerals follow the reader's locale is provisional, pending a
 * product decision, so this file changes nothing about what anyone sees: every caller renders
 * exactly the digits and separators it rendered before. What it changes is the number of places that
 * decision is written down — from thirteen call sites across four bundles to one.
 *
 * That is the whole value while the policy is held: if the answer becomes "follow the locale", this
 * is a one-line edit here (read the same hostLang -> getRuntimeLocale() -> detectLocale() chain the
 * text reads) instead of thirteen edits by four owners, each free to pick a different locale source.
 * The first divergence in that world would be invisible: two panels in one dashboard, same number,
 * different separators.
 *
 * ★ IT FORMATS. IT DOES NOT DECIDE WHAT EMPTY MEANS, and that distinction is not fastidiousness —
 * it is the bug this fold would otherwise have shipped. The three `fmt` helpers it replaced looked
 * interchangeable and were not:
 *   DashboardDataTable    null/undefined -> ''   and '' falls through to Number('') === 0, so "0"
 *   DashboardDetailDrawer null/undefined/'' -> '—'
 *   useDashboardShell     null/undefined -> '—'  and '' likewise becomes "0"
 * Three different answers to "what does a missing count look like", in one dashboard. Folding them
 * onto one empty policy would have silently changed two of the three — a table cell going from blank
 * to an em dash, or an em dash appearing where a zero used to. So each caller keeps its own guard and
 * hands this function a value it has already decided is real.
 */
export const COUNT_LOCALE = 'en-US'

/** @param {number|string} n a value the caller has already established is present */
export const formatCount = (n) => Number(n).toLocaleString(COUNT_LOCALE)

export default formatCount
