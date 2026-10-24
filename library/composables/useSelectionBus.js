/**
 * useSelectionBus.js — hand-rolled pub/sub brushing-and-linking bus.
 *
 * ★ SHARED AS OF DASHBOARD-KIT LANDING 1. This is the first piece of Big Picture to become
 * library code, and it went first for one reason: it has ZERO domain references and imports
 * nothing but `vue`, so it is the only piece that could move with no adapter and no behaviour
 * change. Everything below is the file as research-dashboard shipped it — not a rewrite, not a
 * generalisation. A move that also edits is a move nobody can verify.
 *
 * research-dashboard's old copy re-exported this file for one cycle so nothing broke mid-flight;
 * that shim is now deleted. What the bus carries, and why selection does not travel by emit:
 * library/dashboards/README.md.
 *
 * The move and SPEC-DASHBOARD-KIT D1 (multi-value `filterSet`: an array means OR-within-key,
 * AND-across-keys) landed as separate commits, the move first, so 'Big Picture is unchanged' by the
 * move stayed provable rather than asserted.
 *
 * Two DISTINCT global reactive objects, two distinct visual languages (plan §INTERACTION):
 *   - filterSet     : active facet predicates (tree node / map region / chart slice).
 *                     NARROWS scope — panels render excluded context by FADING, never removing.
 *   - selectionSet  : explicit set of slugs (table checkbox / map lasso / chart pick).
 *                     MARKS individuals — panels render with RING/OUTLINE.
 *   - hoverKey      : the ONE record the pointer is over, or null (D3).
 *                     POINTS at one — panels may fade or outline; they may not fly, select or
 *                     filter. Hover is not a commitment, so nothing irreversible may follow it.
 *
 * Export priority (later phases): selectionSet (if non-empty) > filterSet result > full dataset.
 * Every panel is both publisher and subscriber. All client-side over one in-memory row store
 * keyed on slug (PK) — no per-brush round-trips.
 *
 * ── PERFORMANCE CONTRACT (BUG-TABLE-BATCH-SELECTION-FREEZES-20S) ──────────────────────────
 * selectionSet is a PLAIN Set, not `reactive(new Set())`, and `selectionVersion` is the single
 * reactive dependency that stands in for it. Read it in any computed that inspects the set:
 *
 *     const isSel = computed(() => { bus.selectionVersion.value; return bus.selectionSet.has(x) })
 *
 * WHY. A `reactive(new Set())` fires Vue's ITERATE_KEY on EVERY add/delete, and the old
 * per-row `toggleSelect()` loop also fired a SYNCHRONOUS `emit('select')` per row. Selecting
 * all 2,107 people groups therefore ran 2,107 full map-panel rebuilds — each one re-scanning
 * every row and calling MapLibre `setData()` — allocating ~2.2 MILLION GeoJSON features to
 * arrive at 2,107. Measured at 5,323 ms of pure JS in node (~20 s in the browser with the real
 * map + charts + DOM). See selectMany/deselectMany/setSelection: each mutates the set fully,
 * THEN bumps the version and emits ONCE. Same work, measured at 2.9 ms — a ~1,800x speedup.
 *
 * RULE: never loop `toggleSelect()` over many slugs. Use the bulk ops. They are the only
 * reason batch selection is interactive.
 *
 * ── HIERARCHY CONTRACT (BUG-DESELECTING-A-PARENT-FACET-ORPHANS-ITS-CHILD-SELECTION) ────────
 * A CHILD FACET SELECTION MUST NOT OUTLIVE ITS PARENT. Clearing a parent facet cascade-clears
 * every descendant, transitively, in one commit.
 *
 * WHY IT LIVES HERE AND NOWHERE ELSE. filterSet is AND-stacked: filteredRows keeps a row only
 * when EVERY active key matches. So an orphaned child keeps filtering after its parent is gone —
 * deselect "Indo-European" while "Marathi" is picked and Marathi survives; pick a DIFFERENT
 * family and the two predicates can never both hold, so the map goes empty with no error. The
 * user reads that as "there are no people groups here" rather than "my filter state is
 * inconsistent" — a SILENT WRONG RESULT, which is why this is a data-trust bug, not a nit.
 *
 * Four separate controls clear a filter — the tree rail (DashboardFacetRail), the dropdowns
 * (DashboardResearchFilters), the per-chip ✕ (SearchFilterHeader/DashboardFilterChips) and
 * Clear All / the breadcrumb — and ALL FOUR funnel through setFilter()/clearFilters() here.
 * Implementing the cascade in any one component would fix one button and leave the identical
 * bug reachable through the other three. One chokepoint, one rule.
 *
 * The hierarchy is NOT declared twice: `configureHierarchy()` derives it from the config's
 * existing `facetRail[].drill` arrays, which are already ordered parent→child (the rail renders
 * them as tiers). The config stays the single source of truth for what nests inside what.
 *
 * Transitivity is the whole point: People is THREE deep (affinity_bloc → cluster → people_group)
 * and Place is three deep (wagf_region → wagf_block → country_code). A one-level cascade would
 * look fixed from the top tier while leaving the same orphan one rung down.
 */
import { reactive, ref } from 'vue'

/**
 * Derive facetKey → [descendant keys, nearest-first] from a dashboard config.
 * Reads `facetRail[].drill` (already ordered parent→child) so the hierarchy is declared ONCE,
 * in the config, and can never drift from the tiers the rail actually renders.
 * A section with no `drill` (e.g. the flat Status list) contributes nothing — a facet absent
 * from the map simply has no descendants and clears alone, exactly as before.
 */
export function deriveHierarchy(config) {
  const children = {}
  for (const section of config?.facetRail || []) {
    const drill = Array.isArray(section.drill) ? section.drill.filter(Boolean) : []
    // every tier below i is a descendant of tier i (transitive closure, nearest-first)
    for (let i = 0; i < drill.length - 1; i++) {
      const rest = drill.slice(i + 1)
      children[drill[i]] = children[drill[i]] ? children[drill[i]].concat(rest.filter((k) => !children[drill[i]].includes(k))) : rest
    }
  }
  return children
}

export function createSelectionBus() {
  const filterSet = reactive({})           // { facetKey: value | value[] }  — AND-stacked facets
  // PLAIN Set (see the performance contract above) — pair every read with `selectionVersion`.
  const selectionSet = new Set()           // Set<slug>                      — explicit picks
  // Bumped once per committed selection change. THE reactive handle on selectionSet: one
  // dependency to invalidate instead of a collection proxy that fires per element.
  const selectionVersion = ref(0)
  // Free-text search term (DX-life research-page search bar → header-1). Distinct from the
  // facet filterSet: it applies a substring/label match across the config's `searchKeys` in
  // useDashboardShell.filteredRows. Empty string = no text predicate (identical to before).
  const searchTerm = ref('')
  // ── hoverKey (SPEC-DASHBOARD-KIT D3) ────────────────────────────────────────────────────────
  // THE THIRD COORDINATED CHANNEL, and the only one this bus was missing. filterSet narrows scope
  // and selectionSet marks individuals; HOVER points at one record without committing to it, so a
  // reader can sweep a table and watch the map answer. kepler.gl treats hover as a configured
  // interaction alongside filters for the same reason.
  //
  // ★ IT IS A PLAIN ref AND NOT A SET, AND THAT IS THE WHOLE DESIGN. Hover fires on every
  // mousemove across a 2,107-row table. selectionSet had to be a plain Set with a version counter
  // precisely because a reactive collection fires per element (see the performance contract
  // above); a single ref has none of that problem — one dependency, one write, no iteration. Any
  // future "hover several things" must be argued for against that, not assumed.
  //
  // ★ HOVER IS NOT SELECTION, AND MUST NEVER BECOME IT. It does not enter selectionSet, does not
  // bump selectionVersion, and therefore does not move the camera: useSelectionCamera watches the
  // version, and a camera that chased the pointer across a table would be the resize-strobe bug
  // wearing a new hat, on a reader who may be photosensitive. A panel may fade or outline on hover; it
  // may not fly, select or filter.
  const hoverKey = ref(null)
  const subs = new Map()                   // event -> Set<cb>

  function on(event, cb) {
    if (!subs.has(event)) subs.set(event, new Set())
    subs.get(event).add(cb)
    return () => subs.get(event)?.delete(cb)   // returns an unsubscribe
  }
  function emit(event, payload) {
    subs.get(event)?.forEach((cb) => { try { cb(payload) } catch (_) { /* isolate subscribers */ } })
  }

  // ── facet hierarchy (see the HIERARCHY CONTRACT above) ──
  // facetKey -> [descendant keys]. Empty until the shell calls configureHierarchy(config), so a
  // bus used without a config behaves exactly as it did before (every facet clears alone).
  let childFacets = {}
  function configureHierarchy(config) { childFacets = deriveHierarchy(config) }

  // ── filterSet ops (scope) ──
  /**
   * Set or clear one facet. CLEARING CASCADES: removing a parent removes every descendant in the
   * same call, so a child predicate can never outlive the parent that scoped it.
   *
   * Setting is deliberately NOT cascading in either direction. Selecting a child with no parent
   * set is a legitimate, self-consistent state — the child alone is strictly narrower than its
   * parent, so the result is never wrong, merely more specific (the tree rail, the dropdowns and
   * the geocoder bars all allow it today, and it is how "search language → Marathi" works without
   * first picking a family). The invariant is one-directional by design: no ORPHANS, but
   * stand-alone children are fine.
   *
   * One 'filter' emit for the whole cascade — subscribers rebuild the map/table once, not once
   * per cleared tier (same batching discipline as commitSelection).
   */
  function setFilter(key, value) {
    // ★ AN ARRAY MEANS OR-WITHIN-KEY (SPEC-DASHBOARD-KIT D1). An EMPTY array is not a filter that
    // matches nothing — it is no filter, and it clears like null. Treating [] as "narrow to zero"
    // is the same silent-empty-screen failure the hierarchy contract above exists to prevent, and
    // a UI that deselects its last chip produces exactly that array.
    if (Array.isArray(value) && value.length === 0) value = null
    // A one-element array is stored as the SCALAR it means. The hash, the chips and every adapter
    // then keep their existing single-value shape for the overwhelmingly common case, so D1 costs
    // nothing to read until somebody actually picks two.
    if (Array.isArray(value) && value.length === 1) value = value[0]
    if (value === null || value === undefined) {
      delete filterSet[key]
      // transitive: childFacets[key] already holds the full descendant closure
      for (const child of childFacets[key] || []) delete filterSet[child]
    } else {
      filterSet[key] = value
    }
    emit('filter', filterSet)
  }
  function clearFilters() {
    Object.keys(filterSet).forEach((k) => delete filterSet[k])
    emit('filter', filterSet)
  }

  // ── free-text search (header-1) ──
  /** Point at one record, or `null` for nothing. The value is whatever the profile's primary key
   *  is (`config.data.primaryKey`, a slug here) so every panel is pointing at the same thing.
   *  Deliberately NOT debounced in the bus: what a hover costs depends on what the panel does with
   *  it, so the panel that repaints owns that decision. The bus's job is to be cheap enough that
   *  it never needs one. */
  function setHover(key) {
    const next = key === undefined ? null : key
    if (hoverKey.value === next) return      // a no-op must not wake every panel watching the ref
    hoverKey.value = next
    emit('hover', next)
  }

  function setSearch(term) {
    searchTerm.value = term == null ? '' : String(term)
    emit('search', searchTerm.value)
  }

  // ── selectionSet ops (marks) ──
  // The ONE place a selection change becomes visible: bump the version, notify subscribers once.
  // Every mutator below finishes its whole batch before calling this exactly once.
  function commitSelection() {
    selectionVersion.value++
    emit('select', selectionSet)
  }

  function toggleSelect(slug) {
    selectionSet.has(slug) ? selectionSet.delete(slug) : selectionSet.add(slug)
    commitSelection()
  }
  function clearSelection() {
    if (!selectionSet.size) return            // no-op stays silent (no wasted map rebuild)
    selectionSet.clear()
    commitSelection()
  }

  /**
   * Add many slugs in ONE commit. `additive:false` replaces the selection outright.
   * Returns true when something actually changed (a no-op never repaints the map).
   */
  function selectMany(slugs, { additive = true } = {}) {
    let changed = false
    if (!additive) {
      if (selectionSet.size) { selectionSet.clear(); changed = true }
    }
    for (const s of slugs) if (!selectionSet.has(s)) { selectionSet.add(s); changed = true }
    if (changed) commitSelection()
    return changed
  }

  /** Remove many slugs in ONE commit. Returns true when something actually changed. */
  function deselectMany(slugs) {
    let changed = false
    for (const s of slugs) if (selectionSet.delete(s)) changed = true
    if (changed) commitSelection()
    return changed
  }

  /**
   * Replace the whole selection with `slugs` in ONE commit — the primitive the table's
   * shift+click range-select is built on (base snapshot ⊕ range, applied atomically).
   * Skips the commit when the new set is identical to the current one.
   */
  function setSelection(slugs) {
    const next = slugs instanceof Set ? slugs : new Set(slugs)
    if (next.size === selectionSet.size) {
      let same = true
      for (const s of next) if (!selectionSet.has(s)) { same = false; break }
      if (same) return false
    }
    selectionSet.clear()
    for (const s of next) selectionSet.add(s)
    commitSelection()
    return true
  }

  return {
    filterSet, selectionSet, selectionVersion, searchTerm, hoverKey, on, emit,
    setFilter, clearFilters, setSearch, setHover, configureHierarchy,
    toggleSelect, clearSelection, selectMany, deselectMany, setSelection,
    toggleFilterValue, facetMatches, isFilterActive, rowMatchesFilters,
  }

  // ── THE PREDICATE, AND WHY IT LIVES HERE ───────────────────────────────────────────────────
  // `a(r) === filterSet[k]` was written out SEVEN times: the shell's filteredRows, the facet
  // rail twice, the map panel, the table, the charts rail and the CSV exporter. Seven copies of
  // one rule is survivable while the rule is one character long. It stops being survivable the
  // moment the rule grows an array case — six of the seven would keep comparing an array with
  // `===`, every one of them would quietly match nothing, and the six panels would disagree with
  // each other about what is on screen. That is not a hypothetical: the facet rail computes the
  // COUNTS the user reads before clicking, so a rail that still used `===` would print counts for
  // a scope the map and table no longer show.
  //
  // So D1 is not only "filterSet may hold an array". It is "there is one function that answers
  // does this row match, and every panel calls it". The array support is four lines; the
  // de-duplication is the part that makes it safe.
  function facetMatches(rowValue, selected) {
    if (selected === null || selected === undefined) return true
    // OR within the key. Compared with ===, exactly as the scalar path always has been: the bus
    // stores whatever the facet accessor produced, and a looser comparison here would silently
    // widen every existing filter.
    if (Array.isArray(selected)) return selected.some((v) => rowValue === v)
    return rowValue === selected
  }
  /** Does `row` survive every active facet? `ACC` is facetKey -> accessor (the shell's FACET_ACC).
   *  A key with no accessor is skipped, not failed — a facet declared for the rail but not for the
   *  data must not empty the board. */
  function rowMatchesFilters(row, ACC) {
    for (const k of Object.keys(filterSet)) {
      const a = ACC && ACC[k]
      if (a && !facetMatches(a(row), filterSet[k])) return false
    }
    return true
  }
  /** Is `value` part of the current selection for `key`? The UI's "is this row lit" question,
   *  which was `filterSet[facet] === value` in four places and has the same array problem. */
  function isFilterActive(key, value) {
    const cur = filterSet[key]
    if (cur === null || cur === undefined) return false
    return Array.isArray(cur) ? cur.includes(value) : cur === value
  }
  /** Add or remove ONE value from a key's selection — the multi-select primitive a rail row or a
   *  chart slice needs. Removing the last value clears the key (and cascades), so there is no way
   *  to arrive at an empty array through the UI. */
  function toggleFilterValue(key, value) {
    const cur = filterSet[key]
    if (cur === null || cur === undefined) return setFilter(key, value)
    const list = Array.isArray(cur) ? cur : [cur]
    const next = list.includes(value) ? list.filter((v) => v !== value) : list.concat(value)
    setFilter(key, next.length ? next : null)
  }
}
