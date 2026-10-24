/**
 * model.js — the Gospel x Internet board's DATA RULES, with no Vue and no DOM, so every rule here is
 * testable in node (scripts/check-gospel-internet-model.mjs).
 *
 * ★ CODES CROSS, LABELS DO NOT. Every facet value on the bus is a stable code (access_level own|bridge
 * |zero, access_detail read_watch|hear|read|stories|none, band yes|partial|no|nodata, ISO 3166 alpha-3,
 * ISO 639-3, a province's shapeName). The components translate for display; nothing ever filters on a
 * translated string (SPEC-DASHBOARD-KIT section 5.3: a label link matches nothing in Arabic).
 *
 * ★ ONE PREDICATE. Nothing in this plugin compares a row with filterSet itself: every "does this row
 * survive" question goes through the kit bus's rowMatchesFilters(row, ACC), including the facet
 * counts (which call it with the facet's OWN key left out of ACC, so a facet counts under every OTHER
 * facet). The counts a reader acts on before clicking are, by construction, the rows the map, the grid,
 * the charts and the CSV then show.
 */

// ── the access ladder (the three headline words, then the sub-ladder) ───────────────────────────────
export const ACCESS_LEVELS = ['own', 'bridge', 'zero']
export const ACCESS_DETAILS = ['read_watch', 'read', 'hear', 'stories', 'none']
export const BANDS = ['yes', 'partial', 'no', 'nodata']
export const RESOURCE_KINDS = ['scripture', 'film', 'audio', 'video', 'stories']

// Pins say state by FORM, as Gospel Resources' do (resources-map.vue PIN_COLOR/PIN_RIM): "nothing in
// own language" is a HOLE — white core, oxblood rim — and the eye goes to the holes first. The sage
// ramp is the dx-life accent. (Phase 2: move this ladder into library/colors/ with Gospel Resources
// as its second consumer, rather than two plugins keeping two copies.)
export const DETAIL_FILL = { read_watch: '#3b463d', read: '#5f7a62', hear: '#92b195', stories: '#c9d6c6', none: '#ffffff' }
export const DETAIL_RIM = { read_watch: '#ffffff', read: '#ffffff', hear: '#ffffff', stories: '#ffffff', none: '#7d3b30' }
// Cities with Internet's band colours (connectivity-map.vue BANDS), so one band reads the same on
// both maps. (Phase 2: library/colors/internet-band.js, one rule for both.)
export const BAND_COLOR = { yes: '#10b981', partial: '#e8c15a', no: '#b42318', nodata: '#9aa2ad' }
export const LEVEL_COLOR = { own: '#3b463d', bridge: '#7d3b30', zero: '#1f1f1f' }

// ── the English for every CODED label (the catalogue gospelInternet.<family>.<code> holds each locale).
// Used as the call-site fallback when a key is built from a code, so a missing key reads as English, not
// as "read_watch". Wording rules: "own" is a resource in their OWN language, not that
// anyone has heard it; a bridge is a way IN, never coverage, and never called access without "bridge".
export const LABELS_EN = {
  level: { own: 'Something in own language', bridge: 'Nothing in own language · bridge only', zero: 'Nothing in own language · no way in yet' },
  detail: { read_watch: 'Read and watch', read: 'Read', hear: 'Watch or hear, cannot read', stories: 'Stories only', none: 'Nothing found' },
  band: { yes: '60% or more online', partial: '25-59% online', no: 'Under 25% online', nodata: 'No data' },
  wayIn: { bridge: 'Bridge language', candidate: 'Candidate language', deaf: 'Deaf bridge' },
  kind: { scripture: 'Scripture', film: 'Film', audio: 'Audio', video: 'Video', stories: 'Stories' },
  strength: { strong: 'strong', moderate: 'moderate' },
}
/** A coded value's label in the reader's language: T('gospelInternet.<family>.<code>', English). */
export function label(T, family, code) {
  return T(`gospelInternet.${family}.${code}`, (LABELS_EN[family] && LABELS_EN[family][code]) || String(code ?? ''))
}

// ── facets: key -> accessor. THE accessor; the rail, the map, the grid and the CSV all read it ──────
export const FACET_ACC = {
  access_level: (r) => r.access_level,
  access_detail: (r) => r.access_detail,
  band: (r) => r.internet_band,
  region: (r) => r.region || '',
  country: (r) => r.iso3,
  province: (r) => r.province || '',
  language: (r) => r.iso639_3,
  religion: (r) => r.religion || '',
  way_in: (r) => r.way_in || '',
  messaging: (r) => r.top_messaging_app || '',
}
// The facet hierarchy, declared ONCE and in the kit's shape (facetRail[].drill), so the bus's
// configureHierarchy() derives the cascade: clearing a country clears its province, clearing a
// region clears its country (and so its province). Clearing never leaves an orphan.
export const FACET_RAIL = [
  { id: 'access', drill: ['access_level', 'access_detail'] },
  { id: 'band', drill: ['band'] },
  { id: 'place', drill: ['region', 'country', 'province'] },
  { id: 'language', drill: ['language'] },
  { id: 'religion', drill: ['religion'] },
  { id: 'way_in', drill: ['way_in'] },
  { id: 'messaging', drill: ['messaging'] },
]

// ── URL state (../README.md, "The views"; kit D2's query form, glue until it lands) ──
// query name -> facet key. `|` separates several values (a comma occurs inside real values).
export const URL_KEYS = {
  access: 'access_level', detail: 'access_detail', band: 'band', region: 'region',
  country: 'country', province: 'province', language: 'language', religion: 'religion', wayin: 'way_in',
  app: 'messaging',
}
export const VIEWS = ['board', 'zero', 'province', 'platforms']
/** The board's URL filter names -> bus keys, for the kit's useShareableView (query mode, alias map).
 *  The published names are kept so links already shared keep restoring. */
export const SHARE_FACETS = Object.fromEntries(Object.entries(URL_KEYS))

// MAP STATE: what a link written while the map was the default carries and only the map shows (an open or
// selected people group's pin, a country or province, the province view). Such a link with no ?panel= opens
// the MAP, so old map links keep working; a bare link opens the tree.
const MAP_STATE = ['group', 'groups', 'country', 'province']
export const hasMapState = (q) => MAP_STATE.some((k) => q.get(k)) || q.get('view') === 'province'

/** Parse `?view=&access=…&group=` into { view, filters, group }. Unknown views fall back to board. */
export function parseQuery(search) {
  const q = new URLSearchParams(search || '')
  const filters = {}
  for (const [name, key] of Object.entries(URL_KEYS)) {
    const raw = q.get(name)
    if (!raw) continue
    const vals = raw.split('|').map((s) => s.trim()).filter(Boolean)
    if (vals.length) filters[key] = vals.length === 1 ? vals[0] : vals
  }
  const view = VIEWS.includes(q.get('view')) ? q.get('view') : 'board'
  // EMBED-CONTRACT PARITY with Gospel Resources (resources-map.vue:341/354): ?codes= (and ?code=) name
  // LANGUAGES by ISO 639-3, ?groups= names PEOPLES by DOXA slug. Comma-separated there, so accepted with
  // ',' as well as '|' here (neither can occur inside a slug or a code).
  const list = (name) => (q.get(name) || '').split(/[,|]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
  const codes = [...list('codes'), ...list('code')].filter((c) => /^[a-z]{3}$/.test(c))
  if (codes.length && !filters.language) filters.language = codes.length === 1 ? codes[0] : codes
  const groups = list('groups').filter((s) => /^[a-z0-9-]+$/.test(s))
  // '' = not in the URL: the board opens on its default (the language tree, 2026-09-28)
  const panel = ['tree', 'map'].includes(q.get('panel')) ? q.get('panel') : hasMapState(q) ? 'map' : ''
  const tree = /^[a-z0-9-]{3,40}$/.test(q.get('tree') || '') ? q.get('tree') : ''
  // A tree node narrows by LANGUAGE (its ISO codes); the URL carries the node, not the code list.
  if (tree) delete filters.language
  return { view, filters, group: q.get('group') || '', panel, tree, groups }
}

/** The inverse: filterSet + view + group -> a query string (no leading '?'), stable key order. */
export function buildQuery({ view, filterSet, group, keep, panel, tree, filters = true } = {}) {
  const q = new URLSearchParams(keep || '')
  // filters:false = the FILTER params belong to another writer (the kit's useShareableView): neither
  // delete nor write them, so the two writers never fight over one address bar
  for (const name of [...(filters ? Object.keys(URL_KEYS) : []), 'view', 'group', 'panel', 'tree']) q.delete(name)
  if (view && view !== 'board') q.set('view', view)
  if (tree) q.set('tree', tree)
  if (filters) for (const [name, key] of Object.entries(URL_KEYS)) {
    if (tree && key === 'language') continue
    const v = filterSet?.[key]
    if (v === undefined || v === null || v === '') continue
    q.set(name, Array.isArray(v) ? v.join('|') : String(v))
  }
  if (group) q.set('group', group)
  // the tree is the default, so it is written only where map state would otherwise open the map
  if (panel === 'map' || (panel === 'tree' && hasMapState(q))) q.set('panel', panel)
  return q.toString()
}

// ── the views are PRESETS over the one bus, never separate state ────────────────────────────────────
export function viewPreset(view) {
  if (view === 'zero') return { filters: { access_detail: 'none' }, sort: { key: 'population', dir: -1 } }
  if (view === 'province') return { filters: { country: ['IND', 'CHN'] }, sort: { key: 'population', dir: -1 } }
  // Platforms: where a digital approach could work today — nothing in own language, a country 60%+
  // online — so the reader sees which apps would carry a bridge-language resource there.
  if (view === 'platforms') return { filters: { access_detail: 'none', band: 'yes' }, sort: { key: 'population', dir: -1 } }
  return { filters: {}, sort: { key: 'population', dir: -1 } }
}

// ── rows ─────────────────────────────────────────────────────────────────────────────────────────────
/** Fill the fields the builder omitted as empty (meta.columns is the schema), so every accessor reads
 *  a defined value. Absence becomes '' / null — never 0, which would read as a measurement. */
export function normalizeRows(doc) {
  const cols = doc?.meta?.columns || []
  const NUMERIC = new Set(['population', 'internet_pct', 'mobile_per_100', 'top_platform_pct', 'bridge_candidate_pct_of_country',
    'state_internet_women', 'state_internet_men', 'people_praying', 'lat', 'lng'])
  const BOOL = new Set(['bridge_has_scripture', 'bridge_has_film'])
  return (doc?.rows || []).map((r) => {
    const o = {}
    for (const c of cols) o[c] = r[c] !== undefined ? r[c] : BOOL.has(c) ? false : NUMERIC.has(c) ? null : c === 'shares_point' ? 0 : ''
    return o
  })
}

/** Rows surviving every active facet — the kit bus's predicate, never a private copy. */
export function filterRows(rows, bus, ACC = FACET_ACC, term = '') {
  const t = String(term || '').trim().toLowerCase()
  return rows.filter((r) => bus.rowMatchesFilters(r, ACC) && (!t || matchesTerm(r, t)))
}
export function matchesTerm(r, t) {
  return (r.people_group || '').toLowerCase().includes(t) || (r.country || '').toLowerCase().includes(t)
    || (r.language || '').toLowerCase().includes(t) || r.iso639_3 === t || (r.iso3 || '').toLowerCase() === t
    || (r.province || '').toLowerCase().includes(t)
}

/**
 * Counts for one facet UNDER THE OTHER FACETS (the cascade a reader expects: picking a band shows how
 * many groups of each access level remain). Uses the bus predicate with this facet's own key left out.
 * Returns [{ value, groups, people }] sorted by groups desc (or by `order` when given).
 */
export function facetCounts(rows, bus, key, { order, ACC = FACET_ACC, term = '' } = {}) {
  const others = {}
  for (const k of Object.keys(ACC)) if (k !== key) others[k] = ACC[k]
  const get = ACC[key]
  const t = String(term || '').trim().toLowerCase()
  const m = new Map()
  for (const r of rows) {
    if (!bus.rowMatchesFilters(r, others)) continue
    if (t && !matchesTerm(r, t)) continue
    const v = get(r)
    if (v === '' || v === null || v === undefined) continue
    const e = m.get(v) || { value: v, groups: 0, people: 0 }
    e.groups++
    e.people += Number(r.population) || 0
    m.set(v, e)
  }
  const out = [...m.values()]
  if (order) {
    for (const v of order) if (!m.has(v)) out.push({ value: v, groups: 0, people: 0 })
    return out.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value))
  }
  return out.sort((a, b) => b.groups - a.groups || String(a.value).localeCompare(String(b.value)))
}

/**
 * Countries in scope, counted by the value `pick(countryEntry)` returns (the top messaging app, the top
 * social platform). A COUNTRY is counted once however many of its groups are in scope; a country the
 * source does not cover is counted under `none`, never dropped (it is "not measured", not "no app").
 */
export function countriesBy(rows, countries, pick) {
  const seen = new Set()
  const m = new Map()
  for (const r of rows) {
    if (seen.has(r.iso3)) continue
    seen.add(r.iso3)
    const v = pick((countries && countries[r.iso3]) || null) || ''
    m.set(v, (m.get(v) || 0) + 1)
  }
  return [...m.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => (a.value === '') - (b.value === '') || b.n - a.n)
}

// ── the language tree ──────────────────────────────────────────────────────────────────────────────
export const TREE_COLOR = { g: '#1f8f5f', y: '#e3a82b', r: '#b42318' }

/** Index a tree document once: children lists and, per node, every roster ISO code at or below it. */
export function indexTree(doc) {
  const nodes = doc?.nodes || []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kids = new Map()
  for (const n of nodes) if (n.p) { if (!kids.has(n.p)) kids.set(n.p, []); kids.get(n.p).push(n.id) }
  const isos = new Map()
  // nodes are written parents-first, so walking backwards sees every child before its parent
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    const set = new Set(n.iso && n.g ? [n.iso] : [])
    for (const k of kids.get(n.id) || []) for (const x of isos.get(k)) set.add(x)
    isos.set(n.id, set)
  }
  const nodeOfIso = new Map()
  for (const n of nodes) if (n.iso && n.g && !nodeOfIso.has(n.iso)) nodeOfIso.set(n.iso, n.id)
  return { nodes, byId, kids, isos, nodeOfIso }
}

/**
 * Per node, for the rows in scope: how many roster LANGUAGES of each colour sit at or below it, how many
 * groups, and the colour to draw. A language or dialect draws its own colour (a dialect's is inherited and
 * flagged); a family or branch draws the WORST colour among the in-scope languages below it, so the gap
 * is what the eye finds. `m` = 1 when anything at or below the node is in scope (else the node fades).
 */
export function treeScope(ix, rows) {
  const groupsByIso = new Map()
  for (const r of rows) groupsByIso.set(r.iso639_3, (groupsByIso.get(r.iso639_3) || 0) + 1)
  const out = new Map()
  for (let i = ix.nodes.length - 1; i >= 0; i--) {
    const n = ix.nodes[i]
    const s = { g: 0, y: 0, r: 0, groups: 0 }
    if (n.iso && n.g && groupsByIso.has(n.iso)) { s[n.st] += 1; s.groups += groupsByIso.get(n.iso) }
    for (const k of ix.kids.get(n.id) || []) { const c = out.get(k); s.g += c.g; s.y += c.y; s.r += c.r; s.groups += c.groups }
    const worst = s.r ? 'r' : s.y ? 'y' : s.g ? 'g' : ''
    s.col = (n.lv === 'l' || n.lv === 'd') && n.st ? n.st : worst || n.st || ''
    s.m = s.groups > 0 ? 1 : 0
    out.set(n.id, s)
  }
  // a dialect is "in scope" when its language is (dialects carry no groups of their own)
  for (const n of ix.nodes) if (n.lv === 'd' && !n.g) { const p = out.get(n.p); if (p) out.get(n.id).m = p.m }
  return out
}

/** Stacked series: access_detail within each band (chart 1). */
export function accessByBand(rows, measure = 'groups') {
  const out = {}
  for (const b of BANDS) out[b] = Object.fromEntries(ACCESS_DETAILS.map((d) => [d, 0]))
  for (const r of rows) {
    const cell = out[r.internet_band]
    if (!cell || !(r.access_detail in cell)) continue
    cell[r.access_detail] += measure === 'people' ? (Number(r.population) || 0) : 1
  }
  return out
}

export function sortRows(rows, { key, dir = 1 } = {}) {
  if (!key) return rows
  const num = (v) => (v === null || v === '' || v === undefined ? null : Number(v))
  const isNum = ['population', 'internet_pct', 'mobile_per_100', 'people_praying', 'state_internet_women', 'state_internet_men', 'open_data'].includes(key)
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key]
    if (isNum) {
      const p = num(x), q = num(y)
      if (p === null && q === null) return 0
      if (p === null) return 1            // no data sorts last in BOTH directions: never read as "lowest"
      if (q === null) return -1
      return (p - q) * dir
    }
    return String(x ?? '').localeCompare(String(y ?? '')) * dir
  })
}

// ── CSV (glue to the kit's useCsvExport contract until landing 6 reaches main) ──────────────────────
/** RFC-4180 quoting + CSV-injection neutralising, header on line 1, provenance LAST (the kit's rule). */
export function buildCsv(rows, columns, { provenance = '' } = {}) {
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v)
    // A leading = + - @ TAB or CR is neutralised: a spreadsheet can strip a leading TAB/CR and then read the =
    // after it as a formula (OWASP's list). The same guard as the library's useCsvExport.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const lines = [columns.map((c) => esc(c.header)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => esc(c.csv ? c.csv(r) : r[c.key])).join(','))
  if (provenance) lines.push(esc(provenance))
  return lines.join('\r\n')
}

/** Export scope, in the kit's order: selection > filter result > all. */
export function exportScope(rows, filtered, selectionSet) {
  if (selectionSet && selectionSet.size) {
    const pick = rows.filter((r) => selectionSet.has(r.slug))
    return { scope: 'selection', rows: pick }
  }
  return { scope: filtered.length === rows.length ? 'all' : 'filter', rows: filtered }
}

/**
 * Where a selection goes next: Gospel Resources' map, narrowed to exactly these peoples (its ?groups=
 * contract, by DOXA slug). A URL is the interop link that works across bundles, pages and partner sites
 * alike. Capped: a link past a few hundred slugs outgrows what browsers and servers accept, so the first
 * GROUPS_LINK_CAP go and the caller says so. `base` is the tree's embed base (resolveShareUrl).
 */
export const GROUPS_LINK_CAP = 300
export function gospelResourcesLink(base, slugs, { list = '', lang = '' } = {}) {
  const pick = [...slugs].slice(0, GROUPS_LINK_CAP)
  const q = new URLSearchParams()
  if (pick.length) q.set('groups', pick.join(','))
  if (list) q.set('list', list)
  if (lang && lang !== 'en') q.set('lang', lang)
  return `${base}${base.includes('?') ? '&' : '?'}${q.toString()}`
}

/** A safe outbound URL: http(s) only (a javascript: or data: link in a table cell is never followed).
 *  Not library/utils/html.js safeUrl: that one HTML-ESCAPES its result for string-built popups, and a
 *  Vue :href binding escapes again, so '&' would reach the browser as '&amp;amp;'. Every link in this
 *  table already passed Gospel Resources' doctrine screen at build time; this is the protocol guard. */
export function safeHref(u) {
  const s = String(u || '').trim()
  return /^https?:\/\//i.test(s) ? s : ''
}
