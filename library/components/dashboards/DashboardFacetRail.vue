<script setup>
import { tStatic } from '@map/i18n/index.js'
const L = (key, en) => tStatic('dashboard.' + key) || en
/**
 * DashboardFacetRail (was Sidebar.vue) — RDASH redesign phase 2: the floating @map SemanticTreeLegend is DROPPED.
 *
 * Root cause it fixes: SemanticTreeLegend's `.stl-panel{position:absolute;width:380px;z-index:4}`
 * resolved against the shell and floated OVER the map (the #1 "overlapping" complaint). This is a
 * docked, in-flow, light facet rail that fills the "facets" grid cell — NO position:absolute.
 *
 * Loses NOTHING vs the tree: same facet groups, same setFilter wiring, same mapFocus cross-highlight.
 * The sections are now config-driven from `inject('dashboardConfig').facetRail` — each section is
 * either a multi-level drill (`{ drill:[facetKey,…] }`, expands under the active row) or a flat
 * single-facet count-list (`{ facet }`). Each row = label · micro-bar · count; the active row gets a
 * --rd-accent left rail. Reuses aggregate()/lbl() from @map/composables/useDashboardAggregations and
 * the same per-row facet → bus.setFilter wiring.
 */
/**
 * ── KIT LANDING 4c-3: MOVED HERE FROM plugin-designs/research-dashboard/ ──────────────────────
 * The facet rail follows the chip bar (4c-2). Rendering is unchanged; what changed is where its two
 * remaining plugin imports point. 4b had already removed the research COLOUR and LABEL tables (they
 * stay in plugin-designs and arrive on dashboardConfig.legend), which left exactly two:
 *   useDashboardAggregations -> @map/composables/useFacetAggregation.js   (extracted by 4c-1)
 *   useDashboardShell        -> @map/composables/useDashboardSearch.js    (extracted by 4a)
 * Both repoint at the MODULE that owns the function rather than at a re-export: a library component
 * reading a plugin's shim is the dependency this move exists to remove, and check:filter-multivalue
 * already records why it follows the file — left at the plugin path it read the shim, found no
 * predicate to object to, and PASSED VACUOUSLY.
 *
 * Unlike the chip bar, this component IS mounted and IS on screen (research-dashboard.vue), so the
 * move is verifiable by eyes as well as by gate — and it needs them: it is 770 lines of tree, search
 * and drag behaviour, and nothing about "the imports resolve" says the rail still opens four trees
 * by default or that its search still narrows.
 */
import { inject, ref, reactive, computed, onMounted } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { formatCount } from '@map/utils/formatCount.js'
import { aggregate, lbl, otherLabel } from '@map/composables/useFacetAggregation.js'
import { buildSearchAccessors, makeSearchMatcher, filterRowsBySearch } from '@map/composables/useDashboardSearch.js'
// ★ NO RESEARCH COLOUR IMPORTS (kit landing 4b). This component used to import
// useTreeLegendColors and useTreeLegendLabels, which are the DOXA palettes and the People code
// tables — research-specific, and they stay in plugin-designs. Importing them is what stopped this
// file from being able to move into the kit at all. It now declares what it needs and the shell
// supplies it on dashboardConfig.legend; see the note beside that provide().

const dash = inject('dashboardData', null)
const bus = inject('selectionBus', null)
const cfg = inject('dashboardConfig', {})
// `dataStore` and `searchSourceId` were injected here ONLY to construct useTreeLegendColors and
// useTreeLegendLabels, and landing 4b removed both constructions. They are gone rather than left
// harmlessly in place: an unused inject is a claim about the host, and a kit component that appears
// to need a research dataStore is one a new dashboard will dutifully provide before finding out it
// was never read. The chip bar shed the same pair in 4c-2, for the same reason.
const filterSet = bus?.filterSet || {}

// facet-key -> row accessor (sourced from config) — drives both the count tally and setFilter.
const FACET_ACC = Object.fromEntries(Object.entries(cfg.facets || {}).map(([k, f]) => [k, f.get]))

// ── FACETS THAT DRIVE THE DASHBOARD BUT CANNOT MOVE A GRID BELOW IT ──────────────────────────
// Read from config (`facets.<key>.dashboardOnly`), never a hardcoded list here: the rail is generic
// and the dashboard that hosts it owns which of its facets are derived.
//
// THE DEFECT THIS MARKS (measured 2026-09-23, interop sweep). language_family and religion_family
// are DERIVED — a language family resolved via langFamilyByIso for ~96% of rows, a religion family
// computed from the first letter of a religion code. Both narrow this dashboard correctly (2107 ->
// 677/306/222/151 and 2107 -> 693/649/610/83) and neither can filter a row grid, because the value
// they emit exists on no row field. Wiring them would be WORSE than leaving them: mapping
// religion_family onto `religion` compares "Hinduism" against a CODE and empties the grid.
//
// ★ SO THE HONEST FIX IS A LABEL, NOT A WIRE. Unmarked, these rows are indistinguishable from
// broken buttons — the row highlights, the numbers above move, the list below ignores you, and the
// only way to learn that is to click and squint. They stay fully CLICKABLE (unlike `zero`/`other`
// rows, which are inert because they would do nothing at all); what changes is that the row now
// says what it does.
const DASHBOARD_ONLY = new Set(
  Object.entries(cfg.facets || {}).filter(([, f]) => f && f.dashboardOnly).map(([k]) => k)
)
// rows under the current filterSet, MINUS the facet(s) being aggregated (so each list stays navigable).
const matchSearch = makeSearchMatcher(bus, buildSearchAccessors(cfg))
function rowsExcluding(exclude) {
  const rows = dash?.rows?.value || []
  const keys = Object.keys(filterSet).filter((k) => !exclude.includes(k))
  const hasText = !!(bus?.searchTerm?.value || '').trim()
  if (!keys.length && !hasText) return rows
  // The rail prints the COUNTS a reader acts on before clicking, so it above all must use the
  // same predicate the map and table use — a rail still comparing with === would show counts for
  // a scope the other panels no longer render. See D1 in useSelectionBus.js.
  const faceted = rows.filter((r) => bus.rowMatchesFilters(r, FACET_ACC))
  return filterRowsBySearch(faceted, matchSearch)
}

// ── SECTION COLLAPSE STATE (BUG-DASHBOARD-BAND-GROWS-ENORMOUS-WITH-LIVE-DATA) ────────────────
// Once live data filled the sidebars, the dashboard grew very tall and every section had to be
// collapsed by hand. MEASURED live at 1440x900 in page-scroll mode
// (dashboard-plus-grid): all five sections open by default rendered 69 rows total (16 People / 7
// Place / 31 Language / 10 Religion / 5 Gospel Access), and the rail's OWN scroller never engaged
// — frBody clientHeight === scrollHeight === 2117px — because a fully-open rail is simply that
// tall in flow. The whole dashboard band measured 2325px against a 900px viewport.
//
// All five now start CLOSED. This is the DEFAULT, not a new mechanism — the section already had
// per-id open/closed state (`open[sec.id]`, `toggle()`) driving `v-show` on `.fr-rows`; only the
// initial value changes. A user who wants a tree open still gets it by clicking the section
// header, same interaction as before.
// ★ OPEN BY DEFAULT — and that is NOT a revert to the bug, it is the correct reading of it.
//
// The previous pass set every section CLOSED, a literal reading of "the rail should not be fully
// expanded". The intent was different: People, Place, Language and Religion stay OPEN, but open
// inside a bounded scroller, so they never grow the dashboard's height.
//
// So the defect was never "the sections are open". It was that opening them grew the PAGE instead of
// filling a bounded scroller — 69 rows of content pushing the band to 2325px against a 900px
// viewport. Closing them hid the symptom and cost the user the four trees the rail exists to show.
//
// ★ THE SCROLLER ALREADY EXISTS AND ALWAYS DID: .rd-facets is height:100%;min-height:0 and
// .fr-body is flex:1 1 auto;min-height:0;overflow-y:auto (see the style block below). A bounded
// parent is all that is required for open sections to scroll rather than stretch — which is why the
// right fix is upstream, in what bounds the rail, not in hiding its contents.
//
// The four semantic trees (People / Place / Language / Religion) are the instrument this dashboard
// is built around; starting them closed means the first thing a user sees is four collapsed
// headings instead of the data. Gospel Access stays closed: it is a 5-row flat facet, not a tree,
// and it is the newest addition rather than part of the original four.
const OPEN_BY_DEFAULT = new Set(['people', 'place', 'language', 'religion'])
const open = reactive(Object.fromEntries(
  (cfg.facetRail || []).map((s) => [s.id, OPEN_BY_DEFAULT.has(s.id)])
))
function toggle(sec) { open[sec] = !open[sec] }

// ── PER-NODE EXPAND/COLLAPSE, SEPARATE FROM FILTERING (card BUILD-STACKED-TREE-LEGEND) ──────
// Previously a branch opened ONLY when its row was `active`, i.e. the ONLY way to see a region's
// blocs was to FILTER the whole dashboard to that region. That conflates two different intents —
// "show me what's inside this" (navigation) vs "narrow everything to this" (selection) — and makes
// the tree impossible to browse: you cannot compare two branches without re-filtering between them.
//
// So expansion is now its OWN state, keyed by `facet:value` (globally unique across all four
// trees, since a facet key belongs to exactly one tree). The caret toggles expansion; the row
// body still toggles the filter. A node the user has never touched falls back to "expanded iff it
// is the active filter" (isExpandedRaw), so the old auto-open-the-filtered-branch behaviour is
// preserved exactly as a special case.
const expanded = reactive({})
const nodeKey = (facet, value) => facet + ':' + value
function toggleExpand(facet, value) {
  const k = nodeKey(facet, value)
  expanded[k] = !isExpandedRaw(facet, value)
}
function isExpandedRaw(facet, value) {
  const k = nodeKey(facet, value)
  // undefined = never touched → fall back to "expanded iff this node is the active filter",
  // so an active branch still opens itself exactly as it always did.
  return k in expanded ? expanded[k] : bus.isFilterActive(facet, value)
}

function toRows(agg, facet, level) {
  const max = agg.reduce((m, d) => Math.max(m, d.value), 0) || 1
  return agg.map((d) => ({
    // ★ THE BUCKET'S KEY IS A SENTINEL, ITS LABEL IS A TRANSLATION (kit landing 4c-1).
    // `value` stays d.key — including the English 'Other' — because the row's inertness is tested
    // against it (`row.other` is set from it below, and the template refuses to make such a row
    // clickable). Translating the value would make the bucket filterable in Arabic, on a value no
    // row carries. Only the LABEL is projected.
    facet, value: d.key, label: d.other ? otherLabel() : d.key, count: d.value, frac: d.value / max, level,
    other: !!d.other, active: !d.other && bus.isFilterActive(facet, d.key),
    // Carried per-ROW rather than looked up in the template, so the zero-row baseline snapshot
    // (which spreads a row object) keeps the mark when a row is re-admitted.
    dashboardOnly: DASHBOARD_ONLY.has(facet),
  }))
}

// ── THE ROWS THAT WENT TO ZERO (card BUG-TREE-LEGEND-BUTTONS-GO-DEAD-AFTER-TOGGLING) ────────
// THE REPORT: after some clicking around, the buttons stopped responding. The
// buttons did not break — THEY LEFT. aggregate() only ever returns keys that survive the current
// filterSet, so a filtered-out sibling is simply ABSENT from the row list and is REMOVED FROM THE
// DOM. Measured on the live composite (2026-09-22): selecting Place > Oceania took the rail from
// 66 rows to 21 — 46 rows DELETED, none dimmed. A row the user just clicked, or was about to
// click, vanishes under the cursor, which reads exactly as "the button died".
//
// It also broke this component's OWN stated contract. The header above promises "Loses NOTHING vs
// the tree" — a legend that deletes 70% of its entries on one click loses a great deal, and there
// is no way back to a sibling branch except to clear the filter you cannot see any more.
//
// THE FIX: remember the rows a section rendered BEFORE any filter narrowed it, and re-admit the
// missing ones with count 0 so the tree KEEPS ITS SHAPE. They are dimmed and inert (see the
// `.fr-row.zero` rule) — present as context, never clickable, because filtering to a zero-count
// node would produce an empty dashboard.
//
// WHY A BASELINE SNAPSHOT AND NOT "AGGREGATE OVER ALL ROWS": the zero rows must be the ones the
// user could actually SEE a moment ago, at their original position and depth. Re-aggregating
// unfiltered would also re-admit rows that were never rendered (every level capped by topN, every
// unexpanded branch), which would ADD rows on filtering — the opposite surprise. The snapshot is
// keyed per section id and only ever taken while the dashboard is unfiltered.
// ── WHICH LIST OWNS THE ORDER (card BUG-TREE-EXPANDS-AT-THE-BOTTOM-NOT-UNDER-THE-SELECTED-NODE) ──
// THE REPORT: the affinity block expanded not underneath the selected affinity but underneath
// the very last affinity group at the bottom of the semantic tree legend. The trigger was
// isolated exactly: expanding with the caret ALONE is correct; SELECTING a row and THEN expanding
// it is broken.
//
// ROOT CAUSE — this function used to let the BASELINE own the row order. It emitted every baseline
// row first (survivor or zero), and only then appended whatever the live list had that the baseline
// did not know about. A branch expanded AFTER a filter went on is precisely that case: those
// children never existed in the unfiltered snapshot, so they were appended — landing after the last
// baseline row of the section. Measured on the live composite: People had 15 level-0 blocs, and
// expanding the SELECTED first bloc put its 41 children at indices 16-56 instead of 1-41. Expanding
// with no filter was fine only because the `unfiltered` early return means no baseline walk runs.
//
// THE FIX — INVERT THE AUTHORITY. buildDrillRows already emits a correct depth-first list: a child
// always immediately follows its parent. That ordering is the tree, so we KEEP it and walk the LIVE
// rows, splicing each absent baseline row back in at its anchor. The baseline now contributes only
// MISSING ROWS, never ORDER. A newly expanded child can no longer be misplaced, because it is never
// lifted out of its position to begin with.
//
// The zero rows still land where they sat before: each is anchored to the nearest baseline row that
// is still on screen, so a gap in the middle of a section reopens in the middle, not at the end.
const rowBaseline = new Map()
function keepZeroRows(sectionId, rows, unfiltered) {
  if (unfiltered) {
    // Nothing is narrowing the rail, so what is on screen IS the full shape — record it.
    rowBaseline.set(sectionId, rows.map((r) => ({ ...r, count: 0, frac: 0, active: false, expanded: false })))
    return rows
  }
  const base = rowBaseline.get(sectionId)
  if (!base) return rows
  const key = (r) => r.facet + ':' + r.value
  const present = new Set(rows.map(key))
  const missing = base.filter((b) => !present.has(key(b)))
  if (!missing.length) return rows

  // Anchor each missing row to the baseline row it FOLLOWED that is still on screen. Rows missing
  // from the very top of the section have no such predecessor and are keyed to '' (= emit first).
  const after = new Map()
  let anchor = ''
  for (const b of base) {
    const k = key(b)
    if (present.has(k)) { anchor = k; continue }
    if (!after.has(anchor)) after.set(anchor, [])
    after.get(anchor).push({ ...b, zero: true })
  }

  // THE LIVE LIST DRIVES THE WALK — its depth-first order is the tree's real shape.
  //
  // An anchor's zero rows are emitted after that anchor's WHOLE SUBTREE, not immediately after the
  // anchor row itself. A re-admitted SIBLING dropped straight after an expanded parent would sit
  // between the parent and its children and read as one of them — the same positional lie this
  // card is about, just one level down. Advancing to the end of the subtree keeps a zero sibling
  // a sibling.
  const out = []
  for (const z of after.get('') || []) out.push(z)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    out.push(row)
    const held = after.get(key(row))
    if (!held) continue
    while (i + 1 < rows.length && rows[i + 1].level > row.level) out.push(rows[++i])
    for (const z of held) out.push(z)
  }
  return out
}

// ── single flat facet list (e.g. Status) ──
function buildFacetRows(facet, topN) {
  return toRows(aggregate(rowsExcluding([facet]), FACET_ACC[facet], topN ?? 24), facet, 0)
}

// ── multi-level drill (e.g. Place: region → bloc → country) ──────────────────────────────────
// Excludes drill.slice(level) at each level so the list under the active parent stays navigable:
// the parent's own filter REMAINS applied (it sits above `level`), so children always sum exactly
// to their parent's count. Verified against the live API — picking region "Asia" yields blocs
// summing to 1,309, which is exactly the number of Asia rows.
//
// A branch now descends when the node is EXPANDED (see isExpandedRaw) rather than only when it is
// the active filter — so several branches can be open and compared at once without filtering.
// That is only safe because of `parentChain`: rowsExcluding(drill.slice(level)) drops the parent
// tier's predicate, so without an explicit ancestor scope an expanded-but-unfiltered node would
// list the ENTIRE next level instead of its own children. The chain re-applies exactly the
// ancestors we descended through, which is what keeps children summing to their parent.
function buildDrillRows(drill, topN) {
  const out = []
  const walk = (level, parentChain) => {
    const facet = drill[level]
    const cap = (topN && topN[level]) ?? (level === drill.length - 1 ? 40 : 30)
    // Rows for this level, scoped to the ancestor chain the caller descended through. The chain
    // is applied as an extra predicate so an expanded-but-not-filtered parent still shows only
    // ITS children — expansion never widens the set the way a missing predicate would.
    let base = rowsExcluding(drill.slice(level))
    if (parentChain.length) {
      base = base.filter((r) => parentChain.every(([k, v]) => { const a = FACET_ACC[k]; return a ? a(r) === v : true }))
    }
    const rows = toRows(aggregate(base, FACET_ACC[facet], cap), facet, level)
    for (const row of rows) {
      // a row can be drilled into iff it is not the 'Other' bucket and a deeper level exists
      row.hasChildren = !row.other && level < drill.length - 1
      row.expanded = row.hasChildren && isExpandedRaw(row.facet, row.value)
      out.push(row)
      if (row.expanded) walk(level + 1, [...parentChain, [facet, row.value]])
    }
  }
  walk(0, [])
  return out
}

// ── TREE TRUNKS (card BUILD-TREE-LEGEND-SEMANTIC-INDENTED) ────────────────────────────────
// The content was hard to read because nothing showed it is INDENTED like a tree; the rail uses the
// same nested legend as the research maps.
//
// Root cause: the rail conveyed depth with padding-left ALONE (.l0/.l1/.l2). Whitespace does not
// read as hierarchy — nothing visually ties a child row to its parent, so People > bloc > cluster
// and Place > region > bloc > country looked like one flat list of unrelated rows.
//
// Fix: reuse the research-map semantic tree's ACTUAL indentation model rather than inventing a
// second one. This is a direct port of SemanticTreeLegend.visibleRows' trunk pass
// (@map/components/legends/SemanticTreeLegend.vue) — per row it emits one segment per ancestor
// level, drawn by the SAME .stl-trunk-{pipe,tee,elbow,blank} CSS vocabulary (a 1px rule at
// left:5px, with a 7px horizontal stub at the row's midpoint):
//   pipe  │  an ancestor's branch continues past this row
//   tee   ├  this row has a later sibling
//   elbow └  this row is the last child of its parent
//   blank    the ancestor's branch ended above
// The upstream walks a real node tree (relDepth/ancestors); the rail's rows are a FLAT list
// carrying `level`, so "has a later sibling" = the next row at the same level before any
// shallower row, and "ancestor continues" = some later row is deeper than L before the tree
// returns to L or above. Same output shape (`row.trunks`), same renderer, same look.
function addTrunks(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const segs = []
    for (let L = 0; L < row.level; L++) {
      if (L === row.level - 1) {
        // deepest segment: does another row share this row's parent below it?
        let hasLaterSibling = false
        for (let j = i + 1; j < rows.length; j++) {
          if (rows[j].level < row.level) break
          if (rows[j].level === row.level) { hasLaterSibling = true; break }
        }
        segs.push(hasLaterSibling ? 'tee' : 'elbow')
      } else {
        // an ancestor level: its branch continues iff a later row sits at that level again
        let trunkContinues = false
        for (let j = i + 1; j < rows.length; j++) {
          if (rows[j].level <= L) { trunkContinues = rows[j].level === L; break }
        }
        segs.push(trunkContinues ? 'pipe' : 'blank')
      }
    }
    row.trunks = segs
  }
  return rows
}

// ── People labels: single-sourced from the SAME resolver the research-map's semantic tree uses ──
// The People facets key by CODE (from config.facets). Those codes → human names are resolved by
// running useAffinityBlockLegendData over the shell's normalized features (NOT a re-derived
// hierarchy), so bloc/cluster/PG names in this rail are always identical to the map's tree.
// The maps were built inline here, which made this rail the ONLY surface that projected them —
// the filter chip bar rendered the raw code. They now live in useTreeLegendLabels, next to
// useTreeLegendColors, and every People-facing surface reads that one copy.
// ★ THE KIT'S OWN NEUTRAL, NOT the research palette's. useTreeLegendColors exports a NEUTRAL with
// the same value today, and importing it would re-create the dependency this landing removes. The
// two are deliberately NOT coupled: a consumer with no palette gets a plainly uncoloured rail, and
// the research palette remains free to change its own neutral without reaching in here.
const KIT_NEUTRAL_SWATCH = '#c4c8c0'
// A dashboard that supplies no `legend` gets an honest degraded rail — uncoloured swatches and raw
// values — rather than a crash. That is the state a new dashboard sees before it wires its own palette, and
// a half-configured dashboard should look plain, not broken.
const legend = computed(() => (cfg && cfg.legend) || null)
const colorFor = (...a) => (legend.value?.colorFor ? legend.value.colorFor(...a) : KIT_NEUTRAL_SWATCH)
const legendLabelFor = (facet, value) => (legend.value?.labelFor ? legend.value.labelFor(facet, value) : value)

// ── COLOURS: still the research map's strategies, now HANDED IN rather than imported ─────────
// Every hex in this rail comes from the SAME strategy modules the map's pins paint with, so the
// legend cannot drift from the map — but the rail no longer reaches for them itself. The shell
// supplies them as dashboardConfig.legend.colorFor (kit landing 4b), which is what lets this file
// become kit code while the DOXA palettes stay in plugin-designs. Colour is applied AFTER the rows
// exist and touches only `swatch`; `facet`/`value` (what the bus filters on) are untouched.

// A row inherits its ANCESTOR's colour, mirroring the map's semantic tree where one hue owns a
// whole subtree (useAffinityBlockLegendData.js:169 assigns one colour per bloc and reuses it for
// every descendant). We therefore track the nearest level-0 value while walking the flat row list.
function addColors(rows, axis, famByValue) {
  if (!axis) return rows                       // Status: deliberately uncoloured
  let rootValue = null
  for (const row of rows) {
    if (row.level === 0) rootValue = row.value
    if (row.other) { row.swatch = null; continue }   // the 'Other' bucket is not a real member
    // Religion keys its palette by FAMILY LETTER, which only the level-0 row can supply; every
    // other axis inherits the level-0 VALUE itself.
    const anchor = axis === 'religion' ? (famByValue.get(rootValue) || '') : rootValue
    row.swatch = colorFor(axis, row.facet, row.value, anchor)
  }
  return rows
}

// Religion family NAME → family LETTER, built from the config's famKey accessor over live rows.
// The name is what the user sees and what the bus filters on; the letter only ever indexes the
// map's palette, exactly as religion.js:104 does for pins.
const religionFamKeys = computed(() => {
  const m = new Map()
  const facet = cfg.facets && cfg.facets.religion_family
  if (!facet || !facet.famKey) return m
  for (const r of (dash?.rows?.value || [])) {
    const name = facet.get(r)
    if (name && !m.has(name)) m.set(name, facet.famKey(r))
  }
  return m
})

// "Nothing is narrowing the rail" — no facet filter AND no search term. Both can remove rows
// (rowsExcluding applies the search matcher too), so both must gate the baseline snapshot.
const unfiltered = computed(() => !Object.keys(filterSet).length && !(bus?.searchTerm?.value || '').trim())

const sections = computed(() => (cfg.facetRail || []).map((s) => {
  let rows = s.drill ? buildDrillRows(s.drill, s.topN) : buildFacetRows(s.facet, s.topN)
  // Re-admit rows the current filter drove to zero, BEFORE labels/colours/trunks are computed,
  // so a zero row gets the same human label, swatch and ├/└ glyph as any other row.
  rows = keepZeroRows(s.id, rows, unfiltered.value)
  // For a tree-backed section (People), swap the aggregated CODE keys for the composable's human
  // names — display only; facet/value/filter identity stays the code so filtering matches the map.
  if (s.tree === 'affinity') {
    // labelFor returns the VALUE unchanged when it has no mapping, so "did it map?" is
    // `mapped !== r.value` — and an unmapped row keeps the label it already had, exactly as the
    // affinityLabelMaps lookup did with its `|| r.label`.
    rows = rows.map((r) => {
      if (r.other) return r
      const mapped = legendLabelFor(r.facet, r.value)
      return mapped !== r.value ? { ...r, label: mapped } : r
    })
  }
  rows = addColors(rows, s.axis, religionFamKeys.value)
  // Trunks are computed LAST, over the FINAL row list, so the ├/└ glyphs reflect exactly what
  // is rendered (the label swap above doesn't move rows, but any future row filtering would).
  return { id: s.id, title: s.title, axis: s.axis, rows: addTrunks(rows) }
}))

// header: full-filterSet scope count (unchanged logic from the tree header).
const scopeCount = computed(() => {
  const rows = dash?.rows?.value || []
  const keys = Object.keys(filterSet)
  if (!keys.length) return rows.length
  return rows.filter((r) => bus.rowMatchesFilters(r, FACET_ACC)).length
})

// each rendered row already carries its own facet key (data-facet/data-value).
//
// TWO INTENTS, TWO TARGETS: a click on the caret EXPANDS (navigate); a click anywhere else on the
// row FILTERS (select). The caret is checked first because it sits inside the row.
//
// ── THE BYTE-MATCH CONTRACT ────────────────────────────────────────────────────────────────
// `value` is read straight back off the DOM attribute that was rendered from `row.value`, and
// `row.value` is `aggregate()`'s map key — which is the VERBATIM return of FACET_ACC[facet](row).
// So the string handed to setFilter is byte-for-byte the accessor's own output, which is exactly
// what every consumer re-compares against (`a(r) === filterSet[k]`). Nothing in the colour or
// expand work above rewrites `value`; the People axis's label swap writes `label` only, and the
// 'Other' bucket renders a null data-facet so it can never be filtered on.
// ── AFFORDANCE (card BUG-SEMANTIC-TREE-SIDEBAR-NOT-INTEROPERABLE-WITH-GRID) ─────────────────
// THE REPORT: clicking any of the people, place, language or religion semantic tree dropdowns
// did nothing. Measured, that report was TRUE-AS-EXPERIENCED and the wiring was FINE: the
// rail split its hit targets so that the caret NAVIGATED and only the row body FILTERED. Clicking
// a caret grew the row count 66 -> 73 and correctly did not filter. Correct by design — and
// completely undiscoverable, because nothing on screen said the two halves of one row did two
// different things. A user must never click something that silently does nothing.
//
// SO THE HIT TARGETS ARE NOW EXPLICIT, not positional:
//   the WHOLE ROW filters   — the reader's mental model: clicking a row selects it
//   an explicit CHEVRON BUTTON expands — a real <button> with its own hit area, focus ring and
//                             aria-label/aria-expanded, so "open this branch" is a thing you can
//                             SEE and tab to rather than a 12px strip you must know about.
// The chevron is checked first because it sits inside the row; it stops propagation so opening a
// branch never also re-filters the dashboard.
//
// ── THE BYTE-MATCH CONTRACT (unchanged) ────────────────────────────────────────────────────
// `value` is read straight back off the DOM attribute rendered from `row.value`, and `row.value`
// is aggregate()'s map key — the VERBATIM return of FACET_ACC[facet](row). So the string handed
// to setFilter is byte-for-byte the accessor's own output, which is exactly what every consumer
// re-compares against (`a(r) === filterSet[k]`). The colour/expand/zero work above rewrites only
// `label`, `swatch` and `count`; the People axis's label swap writes `label` only.
function onRowClick(e) {
  const t = e.target
  if (!t || !t.closest) return
  const caret = t.closest('[data-expand]')
  if (caret) {
    const facet = caret.getAttribute('data-expand'); const value = caret.getAttribute('data-expand-value')
    if (facet && value != null) { e.stopPropagation(); toggleExpand(facet, value) }
    return
  }
  const el = t.closest('[data-facet]')
  if (!el || !bus) return
  const facet = el.getAttribute('data-facet'); const value = el.getAttribute('data-value')
  if (!facet || !value) return
  bus.setFilter(facet, filterSet[facet] === value ? null : value)
}

// Keyboard parity for the row itself. The row is focusable (tabindex on filterable rows only),
// so Enter/Space must do what a click does — otherwise the rail is mouse-only, and the chevron
// being a real <button> would be the only thing a keyboard user could reach.
function onRowKey(e) {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
  const el = e.target && e.target.closest ? e.target.closest('[data-facet]') : null
  if (!el || !bus) return
  e.preventDefault()
  const facet = el.getAttribute('data-facet'); const value = el.getAttribute('data-value')
  if (!facet || !value) return
  bus.setFilter(facet, filterSet[facet] === value ? null : value)
}

// cross-highlight: when the map (or another panel) brushes a value, scroll the rail to it.
// scrollIntoView would scroll the host page (shadow DOM) — set the container scrollTop instead.
const railEl = ref(null)
onMounted(() => {
  bus && bus.on('mapFocus', ({ value } = {}) => {
    if (!value || !railEl.value) return
    const rows = [...railEl.value.querySelectorAll('.fr-row')]
    const hit = rows.find((r) => r.textContent && r.textContent.includes(value))
    if (hit) railEl.value.scrollTop = Math.max(0, hit.offsetTop - 8)
  })
})

useShadowStyles(`
  .rd-facets{ display:flex; flex-direction:column; height:100%; min-height:0; box-sizing:border-box;
    background:var(--rd-panel,#fff); }
  .rd-facets .fr-head{ flex:0 0 auto; padding:var(--s3,12px) var(--s3,12px) var(--s2,8px); border-bottom:1px solid var(--rd-line, #d1d4cd); }
  .rd-facets .fr-title{ font-size:12px; font-weight:700; letter-spacing:.4px; color:var(--rd-ink,#3b463d); margin-bottom:2px; }
  .rd-facets .fr-scope{ font-size:11px; color:var(--rd-muted, #6d766e); } .rd-facets .fr-scope b{ color:var(--rd-ink, #3b463d); font-size:13px; }
  /* Thin overlay scrollbar flush to the rail edge — transparent track, low-contrast thumb
     that darkens on hover (BUILD-MATERIAL-THIN-OVERLAY-SCROLLBARS). */
  .rd-facets .fr-body{ flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden;
    scrollbar-width:thin; scrollbar-color:var(--dx-scroll-thumb, #c4c8c0) transparent; }
  .rd-facets .fr-body::-webkit-scrollbar{ width:8px; height:8px; }
  .rd-facets .fr-body::-webkit-scrollbar-track{ background:transparent; }
  .rd-facets .fr-body::-webkit-scrollbar-thumb{ background:var(--dx-scroll-thumb, #c4c8c0); border-radius:8px; }
  .rd-facets .fr-body::-webkit-scrollbar-thumb:hover{ background:#9aa197; }
  .fr-sec{ border-bottom:1px solid var(--rd-line, #d1d4cd); }
  /* ★ STICKY SECTION HEADERS, GITHUB-MARKDOWN STYLE: while scrolling, each section's header stays
     visible until the next section scrolls in, as in a rendered markdown file. The conventional mechanism does all of it natively: position:sticky
     top:0 inside the scrolling .fr-body pins the current header, and the NEXT header pushes the
     previous one away as it arrives, because two sticky siblings at the same top contend for the
     slot. The opaque background is required -- rows scroll UNDER the pinned header, and sticky
     over transparent paints the rows through the label. z-index keeps it above row hover states. */
  .fr-sech{ position:sticky; top:0; z-index:2; background:var(--rd-panel,#fff);
    display:flex; align-items:center; gap:6px; padding:5px 12px; cursor:pointer; user-select:none;
    font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--rd-muted, #6d766e); }
  .fr-sech:hover{ background:var(--rd-bg, #f3f3f1); }
  .fr-sech .chev{ margin-left:auto; transition:transform .15s; font-size:10px; color:var(--dx-muted, #6d766e); }
  .fr-sech.closed .chev{ transform:rotate(-90deg); }
  .fr-rows{ padding-bottom:6px; }
  /* gap:0 so consecutive trunk spans butt flush and their 1px rules form ONE continuous line
     (an 8px flex gap would break each level's rule into a dashed ladder). The label/bar/count
     spacing that the gap used to provide is restored by margin-left on .fr-lbl below. */
  /* min-height replaces an implicit one-line height so a WRAPPED label (see .fr-lbl) grows the
     row instead of overflowing it; single-line rows keep their previous rhythm. */
  /* ★ TIGHTENED: the rows were too tall, so the per-row padding came down. Vertical padding 3px -> 1px and
     min-height 22px -> 18px, which at 4px saved per row is ~276px across the 69 rows the rail
     renders with its four sections open -- most of a viewport.
     ★ FONT-SIZE IS NOT A LEVER HERE and must not become one: text too small to read is not an
     option, and the note below at .fr-lbl records
     that the width for the count came from the BAR and the gutters for the same reason. 12px
     stays; only the whitespace around it moves.
     min-height 18px still clears a 12px glyph at line-height 1.3 (15.6px), so this tightens the
     row without clipping a descender. */
  .fr-row{ position:relative; display:flex; align-items:center; gap:0; padding:1px 12px 1px 14px; min-height:18px; cursor:pointer; font-size:12px; color:var(--dx-text, #3b463d); }
  .fr-row:hover{ background:var(--dx-surface, #f3f3f1); }
  /* Indentation is carried by the TRUNK SPANS (one 12px span per ancestor level), not by
     padding-left — so depth is drawn as a connected tree instead of implied by whitespace.
     Ported from SemanticTreeLegend's .stl-trunk-* rules: a 1px vertical rule at left:5px plus
     a 7px horizontal stub at the row midpoint. Colors are the Material Light border tone. */
  .fr-trunk{ position:relative; flex:0 0 auto; width:12px; align-self:stretch; }
  .fr-trunk-pipe::before,
  .fr-trunk-tee::before{ content:''; position:absolute; left:5px; top:0; bottom:0; width:1px;
    background:var(--rd-line,#d1d4cd); }
  .fr-trunk-elbow::before{ content:''; position:absolute; left:5px; top:0; height:50%; width:1px;
    background:var(--rd-line,#d1d4cd); }
  .fr-trunk-tee::after{ content:''; position:absolute; left:5px; top:50%; height:1px; width:7px;
    background:var(--rd-line,#d1d4cd); }
  .fr-trunk-elbow::after{ content:''; position:absolute; left:5px; top:calc(50% - 0.5px); height:1px; width:7px;
    background:var(--rd-line,#d1d4cd); }
  /* the active row's own branch darkens so the selected path reads at a glance */
  .fr-row.on .fr-trunk-pipe::before,
  .fr-row.on .fr-trunk-tee::before,
  .fr-row.on .fr-trunk-tee::after,
  .fr-row.on .fr-trunk-elbow::before,
  .fr-row.on .fr-trunk-elbow::after{ background:var(--rd-primary,#92b195); }
  /* ── SELECTION EASES IN, IT DOES NOT SNAP (card BUG-TREE-SELECTION-SNAPS-NO-TRANSITION) ────
     THE REPORT: the tree selection snaps — it arrives in one frame with no sense of movement.
     MEASURED CAUSE, and it was NOT the one the card guessed. The card's lead was that
     keepZeroRows rebuilds the row array and Vue recreates the nodes, leaving a CSS transition
     with nothing to animate from. That is not what happens: the template keys each row on
     r.facet + ':' + r.value (see the v-for below), which is the row's IDENTITY pair and is
     preserved verbatim by keepZeroRows — so a surviving row is PATCHED IN PLACE across a
     filter change, not recreated. The keys were already stable; nothing needed fixing there.
     The real cause is simply that NOTHING on the selected state was transitioned. Before this
     rule the only three transitions in the rail were the two chevron rotations and .fr-bar i's
     width. Gaining .on therefore changed four things in a single frame — background,
     font-weight, the ::before accent rail (0 -> full height) and the trunk colours — which is
     exactly what "snap" describes.
     WHAT IS ANIMATED, AND WHAT IS DELIBERATELY NOT:
       background / color / trunk background  — eased. Paint-only, so 60+ rows cost no layout.
       the ::before accent rail               — eased via transform:scaleX, NOT width. The rail
                                                is always present at full width and merely
                                                scales from 0, so it composites instead of
                                                re-laying-out the row on every frame.
       font-weight                            — NOT transitioned, on purpose. It is not an
                                                animatable property, and because .fr-lbl WRAPS
                                                (see its note below) a weight change alters text
                                                metrics and can re-wrap the label mid-animation.
                                                Easing it is impossible; easing AROUND it is what
                                                keeps the row from jolting.
     140ms/ease-out: long enough to read as movement, short enough that a fast drill through
     three tiers never feels laggy. prefers-reduced-motion drops it to 0 (rule below). */
  .fr-row{ transition:background .14s ease-out, color .14s ease-out; }
  .fr-row .fr-trunk-pipe::before, .fr-row .fr-trunk-tee::before, .fr-row .fr-trunk-tee::after,
  .fr-row .fr-trunk-elbow::before, .fr-row .fr-trunk-elbow::after{ transition:background .14s ease-out; }
  .fr-row.on{ background:#fff4ea; font-weight:700; color:var(--rd-ink, #3b463d); }
  /* The accent rail is rendered on EVERY filterable row and scaled to 0 — so becoming active
     scales it up rather than creating it. A ::before that only exists under .on would have no
     start state to animate from (the same "nothing to animate" failure the card warned about,
     arriving by a different route). Inert rows are excluded: they can never be active, and a
     zero-width invisible pseudo-element on 40+ context rows is pure waste. */
  .fr-row:not(.inert)::before{ content:''; position:absolute; left:0; top:2px; bottom:2px; width:3px;
    background:var(--rd-accent,#e67e22); border-radius:0 2px 2px 0;
    transform:scaleX(0); transform-origin:left center; transition:transform .14s ease-out; }
  .fr-row.on::before{ transform:scaleX(1); }
  @media (prefers-reduced-motion: reduce){
    .fr-row, .fr-row:not(.inert)::before,
    .fr-row .fr-trunk-pipe::before, .fr-row .fr-trunk-tee::before, .fr-row .fr-trunk-tee::after,
    .fr-row .fr-trunk-elbow::before, .fr-row .fr-trunk-elbow::after{ transition:none; }
  }
  /* The whole row is the FILTER target now, so it gets the affordances of a control: a pointer,
     a hover wash and a visible focus ring. */
  .fr-row:focus-visible{ outline:2px solid var(--rd-primary,#92b195); outline-offset:-2px; }
  /* ── INERT ROWS: 'Other' buckets and rows the filter drove to ZERO ────────────────────────
     Both are unclickable BY DESIGN and both used to look exactly like a working row, which is
     the whole affordance complaint. They are now unmistakably passive: muted, no pointer, no
     hover response, not focusable (no tabindex in the template), and pointer-events:none so a
     click lands on the rail behind them rather than appearing to "not work". */
  .fr-row.inert{ cursor:default; color:var(--dx-muted, #6d766e); pointer-events:none; }
  .fr-row.inert:hover{ background:transparent; }
  /* a zero-count row is CONTEXT, not a control — it holds the tree's shape while the filter is
     narrow, so a branch the user just came from is still visibly there to go back to. */
  .fr-row.zero{ opacity:.42; }
  .fr-row.zero .fr-bar i{ background:var(--rd-line,#d1d4cd); }
  /* CHEVRON BUTTON — the EXPAND control, now a real button rather than a 12px span. Wider than
     the old caret (16px) so it is a genuine hit target, with its own hover plate and focus ring;
     the glyph inside rotates, not the button, so the hit area never moves. Leaf rows still render
     the empty 12px .fr-caret-leaf so every label in a tree stays left-aligned — a ragged left
     edge is what makes a tree unreadable. */
  .fr-caret-btn{ flex:0 0 auto; width:16px; height:16px; margin:0; padding:0; display:flex;
    align-items:center; justify-content:center; background:transparent; border:0; border-radius:3px;
    color:var(--dx-muted, #6d766e); cursor:pointer; -webkit-appearance:none; appearance:none; }
  .fr-caret-btn:hover{ background:var(--rd-line,#d1d4cd); color:var(--rd-ink, #3b463d); }
  .fr-caret-btn:focus-visible{ outline:2px solid var(--rd-primary,#92b195); outline-offset:0; }
  .fr-caret-gl{ display:block; font-size:9px; line-height:1; transition:transform .15s; }
  .fr-caret-btn.open .fr-caret-gl{ transform:rotate(90deg); }
  /* the empty slot leaf rows render so their labels line up with expandable siblings */
  .fr-caret{ flex:0 0 auto; width:12px; text-align:center; font-size:9px; line-height:1;
    color:var(--dx-muted, #6d766e); user-select:none; }
  .fr-caret-leaf{ cursor:default; }
  /* swatch — the cap-3 map's colour for this node, so a legend row and its pins read as one thing.
     Square (not a dot) to match the charts rail's .rd-li i, which is the same idea in that panel. */
  .fr-sw{ flex:0 0 auto; width:9px; height:9px; border-radius:2px; margin-left:4px;
    box-shadow:inset 0 0 0 1px rgba(59,70,61,.18); }
  /* re-introduce the inter-column spacing the row's gap used to supply (trunks stay flush) */
  /* WRAP, DON'T ELLIPSISE — the COUNT is the information, and nowrap was hiding it.
     Reported: long labels such as "North America and non-Spanish Caribbean" and "Chinese folk
     religion" pushed the numbers out of reach, with no way to scroll right to them. The old rule
     was white-space:nowrap + overflow:hidden + text-overflow:ellipsis, which let a long label
     eat the row; because .fr-body is overflow-x:hidden (vertical scroll only, by design), there
     was NO way to scroll right and recover the number. An ellipsis hid the label AND cost the count.
     Wrapping to a second line keeps both readable at the rail's fixed width.
     overflow-wrap:anywhere (not break-all) breaks only when a word genuinely cannot fit, so
     ordinary labels still break at spaces. The trunk glyphs stay aligned because .fr-trunk is
     align-self:stretch — it grows with the row instead of assuming one text line. */
  /* ── ONE LINE PER ROW (card BUILD-TREE-LEGEND-ONE-LINE-ROWS-NARROWER-PROGRESS-BARS) ────────
     The tree legend rows should each be ONE line, with narrower progress bars.
     THIS CARD AND THE WRAP NOTE ABOVE PULL IN OPPOSITE DIRECTIONS, and both reports are real, so
     the resolution has to satisfy BOTH rather than simply reverting the earlier one:
       - the wrap rule exists because nowrap+ellipsis ATE THE COUNT (no way to scroll right to
         the numbers). Any return to a plain ellipsis re-breaks that, because .fr-body is
         overflow-x:hidden by design and there is no way to scroll the number back into view.
       - this card wants the scannable one-line rhythm back.
     SO: clamp to ONE LINE, but buy the width for it instead of taking it out of the label.
     line-clamp:1 (with the -webkit- prefixed pair, which is what actually ships in Chromium)
     bounds the label to a single line and ellipsises ONLY the label — .fr-cnt is flex:0 0 auto
     and sits OUTSIDE this box, so unlike the old white-space:nowrap on a competing flex child
     the count can never be pushed out of the row. That is the specific failure being avoided:
     the count stays on screen at every width, which was the whole point of the wrap fix.
     The width to afford it comes from the BAR (34px -> 18px below) and the tightened gutters —
     NOT from the font, because text too small to read is not an option. overflow-wrap:anywhere is kept so a single unbreakable token still yields
     rather than overflowing the rail.
     min-height on .fr-row stays: it is now an exact one-line height rather than a floor. */
  .fr-lbl{ flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
    display:-webkit-box; -webkit-line-clamp:1; line-clamp:1; -webkit-box-orient:vertical;
    overflow-wrap:anywhere; line-height:1.3; margin-left:6px; }
  /* The bar YIELDS to the label now that the label wraps (flex:1 1 auto above). Previously both
     were flex:1 1 auto and the bar's 24px floor competed with the text for the same row; with a
     wrapping label the bar must be the element that gives way, so it is capped and allowed to
     shrink to zero-ish on a narrow rail. The COUNT (.fr-cnt, flex:0 0 auto) never shrinks — it is
     the number that could not previously be seen.
     ── 56px -> 34px (card BUILD-REBALANCE-THE-TWO-SIDEBARS) ──────────────────────────────────
     The little progress bars needed to be narrower. Measured on the live composite before this change: the MEDIAN tree label had 85px
     while the bar next to it had 56px — the bar was taking 40% of the label's budget to convey
     a magnitude that .fr-cnt already states EXACTLY, in numbers, on the same row. The bar is
     redundant precision; the label is the information. Combined with the wider rail this is
     ~50px handed back to every row's text, which is what drives the wrap count down.
     The bar is kept (not deleted) because the at-a-glance MAGNITUDE ranking is genuinely useful
     when scanning; 34px still resolves ~10 distinguishable steps, which is enough to rank rows.
     Do NOT solve a future width squeeze by shrinking the FONT: text too small to read is not an
     option. Shrink this bar further first.
     ── 34px -> 18px, AND THE NOTE ABOVE IS THE REASON ────────────────────────────────────────
     The same card asked again for narrower progress bars. The previous author left the exact
     instruction for this situation one line up — when the rail needs width, the BAR yields
     before the type does — so this takes it, rather than touching the font size.
     Those 16px per row are what pay for the one-line clamp on .fr-lbl: the label's budget goes
     UP by 16px at the same time its height budget drops to a single line, so the clamp bites on
     far fewer rows than it would have at 34px. The two halves of this card are one change.
     18px still reads as a magnitude (roughly 6 distinguishable steps at this height) and the
     EXACT number is on the same row in .fr-cnt, which is why degrading the bar's precision is
     acceptable where degrading the label's legibility is not. The height also drops 6px -> 4px
     so a shorter bar does not read as a fat stub. */
  .fr-bar{ flex:0 1 18px; height:4px; min-width:0; background:var(--dx-surface, #f3f3f1); border-radius:2px; overflow:hidden; margin-left:8px; }
  /* magnitude fill — a QUANTITY bar, not a categorical series, so it takes the sage accent
     rather than a hue of its own (the pale blue here was the last of the drift). */
  .fr-bar i{ display:block; height:100%; background:var(--dx-accent, #92b195); border-radius:2px; transition:width .3s; }
  .fr-row.on .fr-bar i{ background:var(--rd-accent,#e67e22); }
  .fr-cnt{ flex:0 0 auto; font-variant-numeric:tabular-nums; color:var(--dx-muted, #6d766e); min-width:30px; text-align:right; font-size:11px; margin-left:8px; }
  /* DASHBOARD-ONLY MARK. A half-filled circle reads as "half of this works" without needing a
     legend, and it is muted so it never competes with the count beside it. Deliberately NOT the
     .zero treatment (opacity:.42 on the whole row): a zero row does nothing at all, while these
     rows genuinely drive every chart above — dimming them would understate what they do. */
  .fr-row.dash-only .fr-donly{ flex:0 0 auto; margin-left:6px; font-size:10px; line-height:1;
    color:var(--dx-muted, #6d766e); opacity:.75; }
`, 'rd-facetrail')
</script>

<template>
  <aside class="rd-facets" data-region="facets">
    <div class="fr-head">
      <!-- "Vertical Legend" — the naming rule: not "tree legend"; the component is Vertical, and
           the vocabulary is nesting or folders. The visible title says VERTICAL; the drill-down vocabulary in code and
           comments is NESTING/FOLDERS, not tree/semantic. Earlier ruling, kept: -->
      <!-- (prior note) the word "semantic" is dropped from the
           user-facing label (the component/docs still describe the semantic-tree MODEL).
           The four stacked trees below it are People · Place · Language · Religion, in that
           order — the four axes a researcher navigates to find who has gospel resources. -->
      <div class="fr-title">{{ L('vertical_legend', 'Vertical Legend') }}</div>
      <div class="fr-scope" data-scope-count><b>{{ formatCount(scopeCount) }}</b> {{ L('groups_in_scope', 'groups in scope') }}</div>
    </div>
    <div class="fr-body" ref="railEl" @click="onRowClick" @keydown="onRowKey">

      <div v-for="sec in sections" :key="sec.id" class="fr-sec" :data-facet-section="sec.id">
        <div class="fr-sech" :class="{ closed: !open[sec.id] }" @click.stop="toggle(sec.id)"><span>{{ sec.title }}</span><span class="chev">▾</span></div>
        <div v-show="open[sec.id]" class="fr-rows">
          <!-- A row is CLICKABLE only when it can actually filter: not the 'Other' bucket, and not
               a row the current filter drove to zero. Those two render as plain, muted,
               non-focusable text so the rail never offers a target that does nothing. -->
          <div v-for="r in sec.rows" :key="r.facet + ':' + r.value" class="fr-row"
               :class="['l' + r.level, { on: r.active, other: r.other, zero: r.zero, inert: r.other || r.zero, 'dash-only': r.dashboardOnly }]"
               :data-facet="(r.other || r.zero) ? null : r.facet" :data-value="(r.other || r.zero) ? null : r.value"
               :tabindex="(r.other || r.zero) ? null : 0"
               :role="(r.other || r.zero) ? null : 'button'"
               :aria-pressed="(r.other || r.zero) ? null : (r.active ? 'true' : 'false')"
               :aria-label="(r.other || r.zero) ? null : ((r.active ? L('remove_filter', 'Remove filter') : L('filter_by', 'Filter by')) + ' ' + r.label + ', ' + formatCount(r.count) + ' ' + L('groups', 'groups') + (r.dashboardOnly ? '. Updates the charts on this dashboard only; it does not filter the list below.' : ''))"
               :title="r.dashboardOnly ? 'Updates this dashboard only — the list below does not filter on ' + r.label : null">
            <!-- tree trunks: one span per ancestor level, same glyph vocabulary as the
                 research-map's SemanticTreeLegend so the hierarchy is DRAWN, not just padded. -->
            <span v-for="(seg, i) in r.trunks" :key="'tr' + i" class="fr-trunk" :class="'fr-trunk-' + seg"></span>
            <!-- CHEVRON = EXPAND, a real <button> with its own hit area, focus ring and label.
                 Previously a 12px <span> that merely LOOKED like part of the row — clicking it
                 expected a selection and got navigation with no visible feedback.
                 Leaf rows render an empty slot so every label in a tree stays left-aligned. -->
            <button v-if="r.hasChildren" type="button" class="fr-caret-btn" :class="{ open: r.expanded }"
                    :data-expand="r.facet" :data-expand-value="r.value"
                    :aria-expanded="r.expanded ? 'true' : 'false'"
                    :aria-label="(r.expanded ? L('collapse', 'Collapse') : L('expand', 'Expand')) + ' ' + r.label"><span class="fr-caret-gl" aria-hidden="true">▸</span></button>
            <span v-else class="fr-caret fr-caret-leaf" aria-hidden="true"></span>
            <!-- swatch: the cap-3 map's colour for this node. Display-only — never part of the
                 filter value. Omitted for uncoloured sections and for the 'Other' bucket. -->
            <span v-if="r.swatch" class="fr-sw" :style="{ background: r.swatch }" aria-hidden="true"></span>
            <span class="fr-lbl">{{ r.label }}</span>
            <span class="fr-bar"><i :style="{ width: Math.max(4, r.frac * 100) + '%' }"></i></span>
            <span class="fr-cnt">{{ formatCount(r.count) }}</span>
            <!-- A VISIBLE mark, not only a title/aria one. A tooltip answers a question the user
                 does not know to ask: the whole defect is that this row LOOKS identical to a row
                 that filters the list. The glyph is what prompts the hover. -->
            <span v-if="r.dashboardOnly" class="fr-donly" aria-hidden="true">◐</span>
          </div>
        </div>
      </div>

    </div>
  </aside>
</template>
