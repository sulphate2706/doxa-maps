/**
 * useDashboardSearch.js — the ONE free-text search the whole dashboard shares.
 *
 * ★ EXTRACTED FROM useDashboardShell (dashboard-kit landing 4a) BECAUSE EIGHT THINGS IMPORT IT.
 * These three functions were exported from the shell, and every panel reached into the shell to get
 * them: the table, the map panel, the charts rail, the facet rail, the research filters, the top bar,
 * the profile and the config. That is not a shell concern; it is a module in its own right that
 * happened to live inside one.
 *
 * It also unblocks the facet rail. Landing 4 was supposed to move the rail, and the rail imports
 * these helpers — so moving the rail first would have meant a library component importing a plugin
 * composable, which check:no-cross-plugin-imports rightly refuses. The dependency had to come first;
 * SPEC-DASHBOARD-KIT section 8 did not notice that, and now says so.
 *
 * Nothing here is domain-specific: the accessors come from `config.facets`, `config.columns` and
 * `config.searchKeys`, and the matching comes from the shared @map/components/search/fuzzy.js. A
 * dashboard with different facets gets its own search for free.
 *
 * Bodies are verbatim from the shell — this is a move, not a rewrite.
 */
import { exactMatches, fuzzyMatches, resolveFuzzyValues } from '@map/components/search/fuzzy.js'

// tiny lodash-free mapValues: { k: v } -> { k: fn(v, k) }
const mapValues = (obj, fn) =>
  Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, fn(v, k)]))

/**
 * Build the free-text search accessors for a dashboard config (header-1 search bar).
 * config.searchKeys (facet keys) → those facet accessors; else the string columns' accessors.
 * ONE declaration reused by the shell (KPIs) AND every panel (table/map/charts/facets) so the
 * searchable text can never drift from what the panels show, and the substring match is not
 * copy-pasted into each panel (kills the very duplication DOXA-LIB-2 removed).
 */
export function buildSearchAccessors(config) {
  const FACET_ACC = mapValues(config.facets, (f) => f.get)
  const COL_ACC = Object.fromEntries((config.columns || []).map((c) => [c.key, c.get]))
  const keys = Array.isArray(config.searchKeys) ? config.searchKeys : null
  if (keys) return keys.map((k) => FACET_ACC[k] || COL_ACC[k]).filter((fn) => typeof fn === 'function')
  return (config.columns || []).filter((c) => c.type !== 'num' && typeof c.get === 'function').map((c) => c.get)
}

/**
 * Reusable predicate: does `row` match the bus's current free-text search term?
 * Returns true when there is no term (identical to pre-search behaviour). `accessors` is the
 * array from buildSearchAccessors(config). Case-insensitive substring over each accessor's value.
 */
export function makeSearchMatcher(bus, accessors) {
  // ★ FUZZY, NOT SUBSTRING: a country name with an n added must still find it (matching what
  // DX-life's search bar bakes in). DX-life runs real Fuse.js with
  // { threshold: 0.4, ignoreLocation: true, minMatchCharLength: 3 } (UupgsList.vue:288), so its
  // search tolerates typos. This matcher was a plain .includes() -- the one search surface that
  // silently lost that behaviour in the migration (measured: 'Bhutan' 13 rows, 'Bhutann' 0).
  // It now delegates to the shared fuzzyMatches() in @map fuzzy.js -- the same matcher the
  // grid's Fuse uses -- with the same DX-life options, so every search surface agrees.
  // Row-level predicates for the TIERED contract (see fuzzy.js exactMatches): the caller
  // (filterRowsBySearch below) runs the exact tier over the whole row set first and falls back
  // to the fuzzy tier only when exact yields nothing, so an exact term agrees with the facet.
  const test = (row, pred) => {
    const needle = (bus?.searchTerm?.value || '').trim()
    if (!needle) return true
    for (const acc of accessors) {
      const v = acc(row)
      if (v != null && pred(String(v), needle, { threshold: 0.4, minMatchCharLength: 3 })) return true
    }
    return false
  }
  const matcher = (row) => test(row, fuzzyMatches)
  matcher.exact = (row) => test(row, exactMatches)
  matcher.active = () => !!(bus?.searchTerm?.value || '').trim()
  matcher.term = () => (bus?.searchTerm?.value || '').trim()
  matcher.accessors = accessors
  return matcher
}

/**
 * Apply the TIERED search to a row set:
 *   1. exact substring -- an exact term returns exactly the rows the equivalent facet selects.
 *   2. facet-VALUE resolution (Austrian or Canadian selects that country, and the table under the
 *      map shows its result): the term is resolved by
 *      whole-value edit distance against each accessor's DISTINCT values, and the rows returned
 *      are those carrying a resolved value -- byte-identical to picking it as a filter.
 *   3. the generic windowed fuzzy rescue, only when nothing resolves.
 */
export function filterRowsBySearch(rows, matcher) {
  if (!matcher.active()) return rows
  const exact = rows.filter(matcher.exact)
  if (exact.length) return exact
  const term = matcher.term()
  // ONE pool across every accessor's distinct values, so the GLOBAL best match wins (see
  // resolveFuzzyValues: ties at the minimal distance stay, everything farther drops --
  // 'Canadian' resolves to Canada, not to 47 rows of <=3-edit neighbours across facets).
  const distinct = new Set()
  for (const acc of matcher.accessors) for (const r of rows) { const v = acc(r); if (v != null && v !== '') distinct.add(String(v)) }
  const winners = new Set(resolveFuzzyValues(term, [...distinct], { threshold: 0.4 }))
  if (winners.size) {
    const resolved = rows.filter((r) => matcher.accessors.some((acc) => { const v = acc(r); return v != null && winners.has(String(v)) }))
    if (resolved.length) return resolved
  }
  return rows.filter(matcher)
}
