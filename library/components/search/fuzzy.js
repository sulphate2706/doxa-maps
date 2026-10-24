/**
 * fuzzy.js — SHARED (@map/components/search/fuzzy.js).
 *
 * A small, self-contained fuzzy matcher with the SAME public surface consumers
 * use from Fuse.js, vendored here so any doxa-maps element ships with NO external
 * npm dependency (fuse.js is not a dependency of the doxa-maps bundler, and adding
 * one would touch the shared package.json/bun.lock). This is the ONE shared home;
 * plugins (people-groups-grid, big-picture, …) import it via
 *   import Fuse from '@map/components/search/fuzzy.js'
 * rather than keeping a local copy.
 *
 * COPY-ONLY NOTE: the DX-life source (UupgsList.vue) uses `new Fuse(list, opts).search(term)`
 * with { keys, threshold, includeMatches, ignoreLocation, minMatchCharLength }. We reproduce
 * exactly the parts of that contract the grid relies on:
 *   - keys: array of dotted paths ('name', 'country_code.label', …) read from each item
 *   - threshold: 0 = exact substring only; >0 = fuzzy (k-errors edit distance, Fuse-parity)
 *   - minMatchCharLength: shortest run counted as a match
 *   - .search(term) -> [{ item, matches:[{ key, indices:[[start,end], …] }] }]
 * The `matches[].indices` drive the <span class="search-highlight"> wrapping in the grid,
 * identical in shape to Fuse's includeMatches output.
 */

function getByPath(obj, path) {
  if (!path.includes('.')) return obj == null ? undefined : obj[path]
  const [head, ...rest] = path.split('.')
  let cur = obj == null ? undefined : obj[head]
  for (const k of rest) cur = cur == null ? undefined : cur[k]
  return cur
}

// Contiguous case-insensitive substring match -> the run of [start,end] indices.
function exactIndices(haystack, needle) {
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  const out = []
  let from = 0
  let idx = h.indexOf(n, from)
  while (idx !== -1) {
    out.push([idx, idx + n.length - 1])
    from = idx + n.length
    idx = h.indexOf(n, from)
  }
  return out
}

// ── Fuzzy match, FUSE-PARITY (2026-09-23) ────────────────────────────────────────────────
// This used to be a strict SUBSEQUENCE matcher ("every char of needle appears in order"), and
// that is NOT what Fuse.js does. The difference bit in production: DX-life's real Fuse
// (threshold 0.4, ignoreLocation) tolerates TYPOS -- an extra trailing letter ("Bhutann"),
// a substituted one ("Indoa") -- because bitap scores k errors against the pattern length.
// A subsequence can only ever DROP haystack chars; an EXTRA needle char always fails it.
// Measured on the live dashboard: 'Bhutan' -> 13 rows, 'Bhutann' -> 0, the reported test.
//
// So this is the standard approximate-substring DP (Sellers/Ukkonen "k-errors" matching):
// best edit distance of the needle against ANY window of the haystack (free start, free end),
// matching iff errors/needle.length <= threshold -- the same score contract Fuse applies with
// ignoreLocation:true. Highlight indices are the best-scoring window's char span.
function approxIndices(haystack, needle, threshold) {
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  const m = n.length
  if (!m || !h.length) return null
  // ★ ABSOLUTE CAP AT 2 EDITS (the classic did-you-mean bound). threshold*len alone grows with
  // the term: at 8+ chars it allowed 3 errors, and 3-edit windows are how 'Canadian' -- a country
  // with ZERO rows in this dataset -- raked 47 rows of unrelated facets. Every real typo the
  // reported (Bhutann, Banladesh, Austrian->Austria, Canadian->Canada) is 1-2 edits.
  const maxErr = Math.min(2, Math.floor(threshold * m))
  if (maxErr <= 0) return null
  // dp[j] = min errors matching the whole prefix n[0..i] ending at text position j.
  // Row 0 is all zeros: the match may START anywhere (that is the "search" variant).
  let prev = new Array(h.length + 1).fill(0)
  let cur = new Array(h.length + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= h.length; j++) {
      const sub = prev[j - 1] + (n[i - 1] === h[j - 1] ? 0 : 1)
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1)
    }
    ;[prev, cur] = [cur, prev]
  }
  let best = Infinity, bestEnd = -1
  for (let j = 1; j <= h.length; j++) if (prev[j] < best) { best = prev[j]; bestEnd = j }
  if (best > maxErr) return null
  const start = Math.max(0, bestEnd - m)
  return [[start, bestEnd - 1]]
}

/**
 * Low-level predicates shared with the dashboard's search matcher (useDashboardShell.js).
 *
 * ★ TIERED, NOT A UNION: search was too fuzzy (Bhutan returned more than the country) and did not
 * agree with the other filters, such as choosing it as a Place. The first fuzzy pass returned exact matches PLUS every <=k-error
 * neighbour, so the EXACT term 'Bhutan' counted 132 rows while the Country filter counted 13 --
 * two controls disagreeing about the same place. The conventional contract is tiered: when a
 * term has exact matches, return ONLY those (search now agrees with the facet, 13 = 13); the
 * k-errors pass exists solely as the ZERO-RESULT typo rescue ('Bhutann', 'Banladesh').
 * Callers implement the tier over their row set: filter with exactMatches first, and only if
 * that yields nothing, filter with fuzzyMatches.
 */
export function exactMatches(text, term) {
  const raw = String(text ?? '')
  const q = String(term ?? '').trim()
  if (!q) return true
  if (!raw) return false
  return raw.toLowerCase().includes(q.toLowerCase())
}
/**
 * ★ TIER 2 — FACET-VALUE RESOLUTION: a country's name with an n added (Austrian, Canadian) selects
 * that country in the search results, so the table under the map shows that country's result.
 * Given the DISTINCT values of a facet (country labels, region names...), return the values the
 * term fuzzy-resolves to. A term like 'Austrian' then selects rows by country === 'Austria' --
 * byte-identical to picking the country as a Place filter -- instead of raking every text field
 * for <=k-error neighbours. Precise where fuzzy rescue used to be noisy ('Banladesh' -> exactly
 * the Bangladesh rows).
 */
export function resolveFuzzyValues(term, values, { threshold = 0.4 } = {}) {
  const q = String(term ?? '').trim().toLowerCase()
  if (!q) return []
  const maxErr = Math.min(2, Math.floor(threshold * q.length))   // same did-you-mean cap as approxIndices
  const out = []
  for (const v of values) {
    if (!v) continue
    const s = String(v).toLowerCase()
    // WHOLE-VALUE distance, deliberately NOT the windowed matcher: resolution asks "is this
    // term a misspelling of this VALUE" ('austrian' ~ 'austria', 1 edit), where the windowed
    // matcher asks "does a neighbourhood of this term appear ANYWHERE in this text" -- the
    // question that made fuzzy rescue noisy. Length pre-filter keeps it O(values).
    if (Math.abs(s.length - q.length) > maxErr) continue
    const d = levenshtein(s, q, maxErr)
    if (d <= maxErr) out.push({ value: v, distance: d })
  }
  // ★ BEST MATCH WINS, not everything under the cap. Measured: 'Canadian' at k=3 admitted 47
  // rows across unrelated facets (first card PERU) because every value within 3 edits of any
  // accessor resolved. The user misspelled ONE thing; return the closest value(s) only --
  // ties at the same minimal distance stay (genuine ambiguity), everything farther drops.
  if (!out.length) return []
  const best = Math.min(...out.map((o) => o.distance))
  return out.filter((o) => o.distance === best).map((o) => o.value)
}

// Banded Levenshtein with early exit past maxErr.
function levenshtein(a, b, maxErr) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const cur = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), prev[j] + 1, cur[j - 1] + 1)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > maxErr) return maxErr + 1
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]
  }
  return prev[b.length]
}

export function fuzzyMatches(text, term, { threshold = 0.4, minMatchCharLength = 3 } = {}) {
  const raw = String(text ?? '')
  const q = String(term ?? '').trim()
  if (!q) return true
  if (!raw) return false
  if (raw.toLowerCase().includes(q.toLowerCase())) return true
  if (threshold === 0 || q.length < minMatchCharLength) return false
  return approxIndices(raw, q, threshold) !== null
}

export default class Fuse {
  constructor(list, options = {}) {
    this.list = Array.isArray(list) ? list : []
    this.keys = options.keys || []
    this.threshold = typeof options.threshold === 'number' ? options.threshold : 0.4
    this.minMatchCharLength = options.minMatchCharLength || 1
  }

  search(term) {
    const q = String(term || '').trim()
    if (!q) return this.list.map(item => ({ item, matches: [] }))
    if (q.length < this.minMatchCharLength) return []
    const exactOnly = this.threshold === 0
    // TIER 1: exact substring across the whole list. If ANY item matches exactly, fuzzy never
    // runs -- an exact term returns exactly the rows the equivalent facet filter selects
    // (see the tiered-contract note on exactMatches above).
    const exact = []
    for (const item of this.list) {
      const matches = []
      for (const key of this.keys) {
        const raw = getByPath(item, key)
        if (typeof raw !== 'string' || !raw) continue
        const indices = exactIndices(raw, q)
        if (indices.length) matches.push({ key, indices })
      }
      if (matches.length) exact.push({ item, matches })
    }
    if (exact.length || exactOnly) return exact
    // TIER 2: facet-VALUE resolution -- resolve the term against each key's distinct values
    // ('Austrian' -> the value 'Austria') and return the items carrying a resolved value.
    // See resolveFuzzyValues above; runs before the generic per-item rescue because selecting
    // by the resolved value is exact (facet-equivalent) where raking all text is noisy.
    // Resolve across the DISTINCT values of ALL keys in one pool so the global best match
    // wins (per-key pools would let a distance-3 language beat nothing while a distance-2
    // country exists under another key).
    const pool = new Map() // value -> Set(keys carrying it)
    for (const key of this.keys) {
      for (const item of this.list) {
        const raw = getByPath(item, key)
        if (typeof raw !== 'string' || !raw) continue
        if (!pool.has(raw)) pool.set(raw, new Set())
        pool.get(raw).add(key)
      }
    }
    const winners = new Set(resolveFuzzyValues(q, [...pool.keys()], { threshold: this.threshold }))
    const hitByKey = new Map()
    for (const v of winners) for (const key of pool.get(v)) {
      if (!hitByKey.has(key)) hitByKey.set(key, new Set())
      hitByKey.get(key).add(v)
    }
    if (hitByKey.size) {
      const resolved = []
      for (const item of this.list) {
        const matches = []
        for (const [key, hits] of hitByKey) {
          const raw = getByPath(item, key)
          if (typeof raw === 'string' && hits.has(raw)) matches.push({ key, indices: [[0, raw.length - 1]] })
        }
        if (matches.length) resolved.push({ item, matches })
      }
      if (resolved.length) return resolved
    }
    // TIER 3: the zero-result typo rescue (k-errors edit distance).
    const results = []
    for (const item of this.list) {
      const matches = []
      for (const key of this.keys) {
        const raw = getByPath(item, key)
        if (typeof raw !== 'string' || !raw) continue
        const fz = approxIndices(raw, q, this.threshold)
        if (fz) matches.push({ key, indices: fz })
      }
      if (matches.length) results.push({ item, matches })
    }
    return results
  }
}
