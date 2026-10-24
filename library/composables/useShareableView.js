/**
 * useShareableView — a dashboard's view state in the address bar, so a narrowed table can be SENT.
 *
 * The persona this exists for: a researcher narrows the table to the peoples they are working on, then
 * gives that exact view to a teammate or reopens it on a phone in the field. A link is the only part of
 * the product a person copies, pastes and reads, so the format is legible on purpose:
 *
 *     #f=affinity_bloc:A008*malay-peoples;religion_family:Hinduism&q=bhutan
 *
 * ── LIFTED FROM research-dashboard, AND WHY IT IS HERE ────────────────────────────────────────
 * This was a PRIVATE function inside plugin-designs/research-dashboard/src/composables/
 * useDashboardShell.js, so exactly one dashboard in the fleet could produce a shareable link. Every
 * other dashboard built on the kit — the gospel-internet board today, the next one after it — had no way to share
 * a view at all. Nothing about the logic was research-specific; only its address was.
 *
 * ── THE FORMAT, AND THE TWO DECISIONS INSIDE IT (carried over, not reinvented) ─────────────────
 * CODE-CANONICAL, SLUG DISPLAY-ONLY (card BUG-SHARE-URL-LEAKS-RAW-CODES). The old hash was
 * URL-encoded JSON — #f=%7B%22affinity_bloc%22%3A%22A008%22%7D — unreadable twice over: JSON
 * punctuation percent-escaped, and the value a bare API code. Now the CODE is canonical and `*slug` is
 * appended from labelFor() at share time and STRIPPED on parse, so links stay locale-independent and
 * survive label renames. A MULTI-VALUE key drops the slug entirely: there is no honest human name for
 * "these twenty-two codes", and inventing one would put a label in a URL that does not describe what
 * the URL selects.
 *
 * ── THE SEARCH TERM IS IN THE LINK, WHICH IT WAS NOT BEFORE ───────────────────────────────────
 * The hash carried filterSet ONLY. Typing in the search box is the commonest way this persona narrows a
 * table, so a shared link reopened with MORE ROWS than the sender was looking at — and silently, since
 * the recipient had no way to know their set was wider. For population data passed between teams that
 * is worse than a link that plainly fails. `q` is appended only when a term is present, so a dashboard
 * with an empty search box produces byte-identically the hash it produced before.
 *
 * @param {object} bus                       a selection bus (filterSet, setFilter, searchTerm, setSearch)
 * @param {object} [options]
 * @param {(facetKey:string, value:any)=>string} [options.labelFor]  supplies the display-only slug.
 *        Injected, never imported: the label tables are the consuming dashboard's, not the kit's.
 * @param {string} [options.hashKey='f']     the filter param name, for a host that already owns `f`
 * @param {string} [options.searchKey='q']   the search param name, same reason
 * @param {'hash'|'query'} [options.mode='hash']  where the state lives. 'query' writes one param per
 *        facet (?access=…&band=…&q=…) instead of a single #f= blob — the gospel-internet board already shares that
 *        way, restored before first render, and a composable that only spoke hash would have given it
 *        TWO URL states rather than replacing its glue. Requested by the consumer, not invented here.
 * @param {boolean} [options.write=true]   whether to WRITE the URL at all. The gospel-internet board writes only on its own
 *        leaves (profile-config urlState:'query') so a partner's address bar is never touched; reading
 *        stays unconditional, because restoring a link someone sent must work everywhere.
 */
import { watch, onMounted } from 'vue'
import { commitUrl } from './useViewAddress.js'

const slugify = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
// Minimal escaping, maximal legibility: reserve our delimiters + %, keep spaces as `+` (the
// x-www-form-urlencoded convention), leave everything else — including unicode — alone. `,` joins the
// values of ONE key (OR-within-key), and is reserved for the same reason `;` `:` `*` are: a delimiter
// that can also occur inside a value is not a delimiter. `&` joins params, so it is reserved too —
// without that, a search for "rice & beans" would truncate the link at the ampersand.
// `|` joins as well as `,` — see LIST_SEP below — so it is reserved too. A delimiter that can also occur
// inside a value is not a delimiter, and that rule has already cost this tree once: the language-code link
// joined on `,` until 120 of 864 language labels turned out to contain one.
const escapeValue = (s) => String(s).replace(/[%;:*+,&|]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/ /g, '+')

/**
 * ★ READ BOTH `,` AND `|`; WRITE `,`. The gospel-internet board has always written `band=yes|partial` and
 * `country=IND|CHN`, and those links are on partner pages now. Splitting only on `,` read that back as the
 * single value "yes|partial", which matches no row — so adopting this composable would have broken every
 * multi-value link they had already shared. Accepting BOTH separators on read costs nothing: escapeValue
 * percent-encodes a literal `,` or `|` inside a value before any join, so every separator still present in
 * a URL is genuinely a separator.
 * Writing stays `,` so there is ONE canonical form going forward rather than two dialects to reason about.
 * The one case this does not cover, stated rather than papered over: an OLD link whose VALUE contained a
 * literal `|` written before `|` was reserved would now be split. No facet vocabulary in the tree contains
 * one (checked religion.js and the region/language codes), and the gospel-internet data confirms `|` cannot occur in a facet
 * code, so the exposure is a value shape that does not exist rather than one we are choosing to risk.
 */
const LIST_SEP = /[,|]/
const unescapeValue = (s) => { try { return decodeURIComponent(String(s).replace(/\+/g, '%20')) } catch (_) { return String(s).replace(/\+/g, ' ') } }

/** Serialize a view to a hash string. Exported so a gate can drive it without a browser. */
export function serializeView(filterSet, searchTerm, { labelFor, hashKey = 'f', searchKey = 'q' } = {}) {
  const pairs = Object.entries(filterSet || {}).map(([k, v]) => {
    if (Array.isArray(v)) return k + ':' + v.map(escapeValue).join(',')
    const label = typeof labelFor === 'function' ? labelFor(k, v) : null
    const slug = label && String(label) !== String(v) ? slugify(label) : ''
    return k + ':' + escapeValue(v) + (slug ? '*' + slug : '')
  })
  const term = String(searchTerm ?? '').trim()
  return '#' + hashKey + '=' + pairs.join(';') + (term ? '&' + searchKey + '=' + escapeValue(term) : '')
}

/** Parse a hash into { filters, search }. Exported for the same reason. */
export function parseView(hash, { hashKey = 'f', searchKey = 'q' } = {}) {
  const out = { filters: {}, search: '' }
  const h = String(hash || '')
  const sm = new RegExp('[#&]' + searchKey + '=([^&]*)').exec(h)
  if (sm) out.search = unescapeValue(sm[1])
  const m = new RegExp('[#&]' + hashKey + '=([^&]*)').exec(h)
  if (!m) return out
  const raw = m[1]
  if (raw.startsWith('{') || raw.startsWith('%7B') || raw.startsWith('%7b')) {
    // A legacy JSON hash from a link shared before the readable format. Still restores.
    try { out.filters = JSON.parse(decodeURIComponent(raw)) } catch (_) { /* ignore bad hash */ }
    return out
  }
  for (const pair of raw.split(';')) {
    const i = pair.indexOf(':')
    if (i < 1) continue
    const key = pair.slice(0, i)
    const body = pair.slice(i + 1).split('*')[0]
    // Split BEFORE unescaping: a literal comma inside a value is percent-encoded by escapeValue, so
    // every `,` still here is a separator. Unescaping first would resurrect content commas and split
    // the value in half.
    const parts = body.split(LIST_SEP).map(unescapeValue).filter(Boolean)
    if (key && parts.length) out.filters[key] = parts.length > 1 ? parts : parts[0]
  }
  return out
}

/**
 * ★ A PARAM NAME IS NOT ALWAYS THE BUS KEY, AND RENAMING ONE BREAKS LINKS THAT ARE ALREADY OUT.
 * The gospel-internet board has shared `?access=` for a while against a bus key of `access_level` (and detail ->
 * access_detail, wayin -> way_in, app -> messaging). Those links sit on partner pages today. If this
 * composable insisted that the param equal the key, adopting it would silently rename every param and
 * every one of those links would stop restoring — the exact harm the shareable-view card exists to
 * prevent, caused by the thing meant to deliver it.
 * So `facetKeys` takes EITHER shape:
 *     ['access_level', 'country']                  param name === bus key
 *     { access: 'access_level', app: 'messaging' }  param -> bus key, for names already in the wild
 * An array stays the common case; the map is for a URL vocabulary you have already published.
 */
const busKeyFor = (facetKeys) => {
  if (Array.isArray(facetKeys)) { const k = new Set(facetKeys); return (p) => (k.has(p) ? p : null) }
  const m = facetKeys && typeof facetKeys === 'object' ? facetKeys : {}
  return (p) => (Object.prototype.hasOwnProperty.call(m, p) ? m[p] : null)
}
const paramNameFor = (facetKeys) => {
  if (!facetKeys || Array.isArray(facetKeys)) return (k) => k
  const rev = Object.fromEntries(Object.entries(facetKeys).map(([param, key]) => [key, param]))
  // A bus key with no declared param keeps its own name rather than being dropped: a filter that
  // cannot be written is a filter that silently will not survive the link.
  return (k) => (Object.prototype.hasOwnProperty.call(rev, k) ? rev[k] : k)
}

/**
 * Serialize to a QUERY string, one param per facet. Preserves params this composable does not own —
 * a host page's own query survives, which is the whole point of writing only on your own leaves.
 */
export function serializeQuery(filterSet, searchTerm, existing = '', { searchKey = 'q', facetKeys } = {}) {
  const paramOf = paramNameFor(facetKeys)
  const keep = []
  const mine = new Set([...Object.keys(filterSet || {}).map(paramOf), searchKey])
  for (const part of String(existing || '').replace(/^\?/, '').split('&')) {
    if (!part) continue
    const k = part.split('=')[0]
    if (!mine.has(k)) keep.push(part)
  }
  const pairs = Object.entries(filterSet || {}).map(([k, v]) =>
    paramOf(k) + '=' + (Array.isArray(v) ? v.map(escapeValue).join(',') : escapeValue(v)))
  const term = String(searchTerm ?? '').trim()
  if (term) pairs.push(searchKey + '=' + escapeValue(term))
  const all = [...keep, ...pairs]
  return all.length ? '?' + all.join('&') : ''
}

/** Parse a QUERY string. Only the keys the caller declares as facets are read as filters. */
export function parseQuery(search, facetKeys = [], { searchKey = 'q' } = {}) {
  const out = { filters: {}, search: '' }
  const keyOf = busKeyFor(facetKeys)
  for (const part of String(search || '').replace(/^\?/, '').split('&')) {
    if (!part) continue
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i)
    const body = part.slice(i + 1)
    if (k === searchKey) { out.search = unescapeValue(body); continue }
    const busKey = keyOf(k)
    if (!busKey) continue
    const parts = body.split(LIST_SEP).map(unescapeValue).filter(Boolean)
    if (parts.length) out.filters[busKey] = parts.length > 1 ? parts : parts[0]
  }
  return out
}

/**
 * The filter write. It goes through useViewAddress's commitUrl, the page's ONE history write, so it can never undo
 * a tab/pane/place write and keeps history.state (+ `current`) on a Vue Router host. It used to write
 * replaceState(null, …) itself, which wiped the router's state there. Query mode replaces only its own params; hash
 * mode replaces only the hash. Everything else in the URL stays. Exported so check:view-address drives this exact
 * write. Returns whether it wrote.
 */
export function writeFilterView(filterSet, searchTerm, options = {}) {
  try {
    if (typeof location === 'undefined') return false
    return options.mode === 'query'
      ? commitUrl({ search: serializeQuery(filterSet, searchTerm, location.search, options) })
      : commitUrl({ hash: serializeView(filterSet, searchTerm, options) })
  } catch (_) { return false }
}

export function useShareableView(bus, options = {}) {
  const { mode = 'hash', write: shouldWrite = true, facetKeys } = options
  const push = () => { if (shouldWrite) writeFilterView(bus.filterSet, bus.searchTerm?.value, options) }
  watch(() => ({ ...bus.filterSet, __q: bus.searchTerm?.value }), push, { deep: true })
  onMounted(() => {
    try {
      if (typeof location === 'undefined') return
      // READING is unconditional even when writing is off: restoring a link someone sent has to work
      // on a partner's page too, which is exactly where writing must not happen.
      const { filters, search } = mode === 'query'
        ? parseQuery(location.search, facetKeys || Object.keys(bus.filterSet || {}), options)
        : parseView(location.hash, options)
      Object.entries(filters).forEach(([k, v]) => bus.setFilter(k, v))
      if (search && typeof bus.setSearch === 'function') bus.setSearch(search)
    } catch (_) { /* ignore a bad URL */ }
  })
}

export default useShareableView
