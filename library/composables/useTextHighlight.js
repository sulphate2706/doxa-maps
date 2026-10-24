/**
 * highlightRanges(value, indices) — wrap each matched index range in
 * <span class="search-highlight">, escaping every segment around it.
 *
 * WHY THIS IS SHARED. Two plugins built the same construction independently, line for line apart from
 * variable names: regions-dashboard/src/UupgsList.vue and people-groups-grid/people-groups-grid.vue.
 * Both consume the same Fuse-compatible shim (library/components/search/fuzzy.js), both read
 * `match.indices`, both wrap with the same class, and both append the tail only on the last range.
 * RULE 2 is satisfied by a NAMED second consumer, not by a guess that one might appear.
 *
 * The construction is dx-life's (their UupgsList.vue:336-348) and is ported rather than invented: walk
 * the ranges in order, escape the gap before each hit, wrap the hit, and append the remaining tail once
 * at the end. Indices come from the SEARCHED corpus (which may be accent-stripped) and are applied to
 * the ORIGINAL string, which is why the caller passes both rather than re-deriving one from the other.
 *
 * ★ ESCAPING COMES FROM library/utils/html.js, AND THAT IS A DELIBERATE CHANGE FOR BOTH CALLERS.
 * Each plugin had hand-rolled its own escapeHtml, and the three differed in ways worth naming:
 *   library/utils/html.js  escapes & < > " ' AND backtick, and returns '' for null/undefined
 *   UupgsList              escapes & < > " ' (no backtick), guards null via String(v ?? '')
 *   people-groups-grid     escapes & < > " ' (no backtick), and has NO NULL GUARD AT ALL —
 *                          `s.replace(...)` on null/undefined THROWS
 * Both deltas move in the safe direction: one more character escaped, and a throw removed. Neither
 * changes the output for any value that renders today. Stated here because "I swapped your escaper"
 * is exactly the kind of quiet substitution that should never be discovered by a reader later.
 *
 * @param {string} value    the ORIGINAL text to render
 * @param {Array<[number, number]>} indices  inclusive [start, end] pairs, in order
 * @returns {string} HTML: escaped text with <span class="search-highlight"> around each range
 */
import { escapeHtml } from '../utils/html.js'

export function highlightRanges(value, indices) {
  const original = String(value ?? '')
  if (!Array.isArray(indices) || indices.length === 0) return escapeHtml(original)
  let cursor = 0
  let out = ''
  indices.forEach((idx, i) => {
    const [start, end] = idx
    const isLast = i === indices.length - 1
    out += escapeHtml(original.slice(cursor, start))
      + '<span class="search-highlight">' + escapeHtml(original.slice(start, end + 1)) + '</span>'
      + (isLast ? escapeHtml(original.slice(end + 1)) : '')
    cursor = end + 1
  })
  return out
}

export default highlightRanges
