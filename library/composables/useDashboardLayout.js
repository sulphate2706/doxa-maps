/**
 * useDashboardLayout.js — reusable drag-resize + persistence engine for the CMV dashboard grid.
 *
 * ★ SHARED AS OF DASHBOARD-KIT LANDING 2. The second piece of Big Picture to become library code,
 * and the second on the same test: it imports nothing but `vue` and touches no domain field. The
 * four mentions of a people-groups grid below are comments naming an EXAMPLE of what a host stacks
 * underneath; nothing here reads a row.
 *
 * The body is what research-dashboard shipped, with one behaviour change that the spec asked for
 * BEFORE this file could be shared — see the storage-key note on `storageKey` below. Everything
 * else is verbatim.
 *
 * plugin-designs/research-dashboard/src/composables/useDashboardLayout.js re-exports this for one
 * cycle. The contract the dashboard panels share is library/dashboards/README.md.
 *
 * A dashboard shell (see plugin-designs/research-dashboard/research-dashboard.vue) is a CSS
 * grid whose three flexible tracks are driven by CSS custom properties:
 *   --facet-w  (left facet-rail column width)   default 296px
 *   --rail-w   (right charts-rail column width)  default 296px — equals --facet-w, so the map column sits centred
 *   --table-h  (bottom table row height)         default 34%   (map above it is the 1fr hero)
 *
 * This composable OWNS those three vars: it exposes pointer-based drag handlers (one per edge),
 * clamps each to a sane min/max, writes the vars onto the shell root element as INLINE custom
 * properties, PERSISTS the chosen layout to localStorage on every drag-end, RESTORES it on init,
 * and offers reset() to clear the key and snap back to the exact defaults.
 *
 * SHELL vs. TABLE axis (page-scroll mode only — BUG-SHELL-HANDLE-BOUND-TO-WRONG-DIVIDER):
 *   Two DIFFERENT questions look similar and must stay answered by two DIFFERENT handles.
 *     "table" axis  = the MAP/TABLE SPLIT. In page-scroll mode it redistributes height BETWEEN
 *                      the map and the table; the sum of the two (the element's total height)
 *                      does NOT change. This is the EXISTING map/table divider
 *                      (.rd-rz-table in research-dashboard.vue), unchanged in grid-mode.
 *     "shell" axis   = the ELEMENT'S OWN HEIGHT (page-scroll mode only) — a bar at the shell's
 *                      BOTTOM edge, the boundary between the whole research-dashboard element and
 *                      whatever a host stacks below it (e.g. the people-groups grid in
 *                      dashboard-plus-grid.vue). Dragging it changes --rd-shell-h, the total map+
 *                      table budget; the map/table SPLIT within that budget is untouched.
 *   --rd-shell-h is the new independent variable; --rd-map-h is now the map's share of it, and
 *   the table's share is derived as shellH - mapH (see the CSS in research-dashboard.vue). Before
 *   this, --rd-map-h alone was BOTH "the map/table split" AND "the element's total height" — one
 *   knob answering two questions, which is why dragging the map/table divider used to resize the
 *   whole element as a side effect: the divider between the map and the table was bound to the
 *   page's height, which is not what that control is for.
 *
 * COMPOSITION with the collapse-table fix (do NOT regress):
 *   The shell's DEFAULT rows are `52px auto 42px 1fr var(--table-h,34%)` while the collapsed rule
 *   `.rd-shell.rd-table-collapsed{ grid-template-rows:52px auto 42px 1fr 0 }` comes LATER in source
 *   order (same specificity) so COLLAPSE WINS over --table-h. Because we only touch the CSS var
 *   (never the collapsed row template), collapsing hides the table regardless of a dragged height,
 *   and expanding restores the user's dragged --table-h. The center map is 1fr and already
 *   self-resizes via DashboardMapPanel's ResizeObserver → map.resize(); we add no second resize.
 *
 * NON-REGRESSION with the responsive slim rails:
 *   `.rd-shell.rd-slim-rail{ --rail-w:228px }` / `.rd-shell.rd-slim-facet{ --facet-w:250px }` are
 *   medium-width niceties set via CLASS. Inline styles always beat class rules, so we apply inline
 *   vars ONLY once the layout is customized (restored-from-storage or dragged). An untouched
 *   dashboard writes no inline vars → the slim classes and the exact CSS defaults are preserved.
 *   reset() removes the inline vars entirely, fully handing control back to the stylesheet.
 *
 * DESKTOP-ONLY: every drag is gated on `!isNarrow`; narrow/mobile never resizes or persists.
 *
 * Library-parameterizable — the profile's identity (defaults + storage key) lives in options, not
 * here. Any dashboard grid exposing the same three vars can reuse this unchanged.
 *
 * @param {object}  options
 * @param {import('vue').Ref<HTMLElement|null>} options.shellRef  ref holding the .rd-shell root el
 * @param {object=} options.bus        selection bus; when given, listens bus.on('resetLayout', reset)
 * @param {import('vue').Ref<boolean>|boolean=} options.isNarrow  desktop gate (true = mobile/narrow)
 * @param {import('vue').Ref<boolean>|boolean=} options.pageScroll  when true, the table axis drives
 *        --rd-map-h (px) instead of --table-h — see the PAGE-SCROLL AXIS SWITCH note below.
 * @param {string=} options.storageKey localStorage key (default 'rd-dashboard-layout')
 * @param {{facetW?:number, railW?:number, tableH?:string, mapH?:number, shellH?:number}=} options.defaults  default track sizes
 * @param {{facetW?:[number,number], railW?:[number,number], tableH?:[number,number], mapH?:[number,number], shellH?:[number,number]}=} options.clamps
 *        min/max — facetW/railW/mapH/shellH in px, tableH in percent-of-shell-height
 *
 * @returns {{
 *   facetW: import('vue').Ref<number>, railW: import('vue').Ref<number>, tableH: import('vue').Ref<string>,
 *   mapH: import('vue').Ref<number>, shellH: import('vue').Ref<number>,
 *   startFacetResize:(e:PointerEvent)=>void, startRailResize:(e:PointerEvent)=>void,
 *   startTableResize:(e:PointerEvent)=>void, startShellResize:(e:PointerEvent)=>void,
 *   reset:()=>void, applyVars:()=>void, customized:import('vue').Ref<boolean>,
 *   stepResize:(axis:'facet'|'rail'|'table'|'shell', dir:-1|1, toExtreme?:boolean)=>void,
 *   onResizeKeydown:(axis:'facet'|'rail'|'table'|'shell', e:KeyboardEvent)=>void
 * }}
 */
import { ref, unref, onMounted, onBeforeUnmount } from 'vue'

// The single key every dashboard shared before landing 2 namespaced them. Kept ONLY so a reader's
// existing layout survives the change; nothing writes to it. Delete it once no reader can plausibly
// still be carrying one.
const LEGACY_SHARED_KEY = 'rd-dashboard-layout'
// The default key, named once so the legacy read-through can ask "am I the default?" instead of
// re-typing the literal — a fallback comparing against a copy of its own default is a fallback that
// silently stops matching the day someone bumps the version suffix.
const DEFAULT_STORAGE_KEY = 'rd-dashboard-layout-v6'

// Tree rail WIDER than the charts rail — see the rail-balance note in research-dashboard.vue.
// These must stay in lockstep with the CSS `:host` defaults, since reset() snaps back to them.
// mapH mirrors the CSS fallback 40svh (~360px at a 900px viewport — see the page-scroll note
// below); it is only ever WRITTEN once the user drags, so an untouched embed stays on the
// viewport-relative svh default and keeps resizing with the window, exactly like every other var.
// ★ 58svh (522px) was the ORIGINAL default and left the page-scroll band taller than one desktop
// viewport (BUG-DASHBOARD-BAND-GROWS-ENORMOUS: chrome 137px + map 522px + table 552px = 1211px
// against 900px). 40svh is the value that makes chrome + map(X) + table(X + bar-height) fit <=900px.
// shellH default (720) is the SUM the old single-knob mapH(360) used to imply — map 360 + table
// budget 360 (328 grid + 32 bar) — so first paint is pixel-identical to before this axis split;
// only DRAGGING behaves differently now (see the SHELL vs. TABLE axis note above).
// ★ shellH 720 -> 602 so the table OPENS at seven data rows by default. 602 = map 360 + bar 32 + 7 rows x 26 + foot 28.
// ★ A DEFAULT, NOT A LOCK — and the distinction is the whole correction. My first attempt hard-capped
// the keyhole at 7 rows in CSS, which read as the same thing and was not: nothing writes
// --rd-table-rows, while the drag handles write --rd-shell-h and --rd-map-h, so the cap could not
// be reached by any gesture: BOTH resizes were lost at once, when only the table was meant to
// change (seven rows as a default, still resizable). Setting the STARTING VALUE instead leaves the
// derivation intact: the keyhole stays
// shell - map - bar - foot, so dragging either handle still moves the table, and seven rows is
// merely where it opens.
// ★ RECLAIM PASS 2: reclaim height so half of the People Groups grid's first row shows. mapH 360 -> 300 and shellH follows the same
// arithmetic as before: 300 map + 32 bar + 7x26 rows + 28 foot = 542. The seven-row table
// promise is unchanged; only the map's share shrinks -- and the map compensates by DEFAULTING
// MORE ZOOMED OUT with the world-floor released on the globe (see DashboardMapPanel), so a
// shorter map shows MORE world, not less.
// shellH 502 -> 542: the dashboard about 40px taller. The
// extra 40px flows to the TABLE via the standing derivation (table = shell - map - bar - foot);
// the map row stays pinned at mapH. One owner: this number, with the CSS var fallbacks in
// research-dashboard.vue kept byte-equal at 542.
// mapH 260 -> 300: the +40px belongs to the map, 40px more display room. shellH stays 542, so the table's derived share returns to its
// pre-+40 height and the whole gain lands in the map row.
// +40px again, added to the map's height: shellH 542 -> 582 and mapH 300 -> 340 move together, so
// the whole gain lands in the map row and the table's derived share stays put.
// Fine-tune: the map keeps its height and the dashboard loses about 20px. Map stays 340; the 20px comes out of
// the table's derived share (shell - map - bar - foot).
const DEFAULTS = { facetW: 296, railW: 296, tableH: '34%', mapH: 340, shellH: 562 }
const CLAMPS = { facetW: [160, 420], railW: [200, 520], tableH: [12, 70], mapH: [220, 1400], shellH: [400, 2600] }

// Mirrors the CSS fallback --rd-table-bar-h (research-dashboard.vue's .rd-table-bar budget calc) —
// the table's header bar (count + Export CSV) sits ABOVE its scrollport and is not itself
// resizable, so the map/table split must always leave it at least this much room, or the divider
// could drag the table's usable grid to zero while its outer cell still looks non-empty.
const TABLE_BAR_H = 32
const TABLE_MIN_H = 120   // grid's own floor below the bar — a table smaller than this is unusable

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))
const pctNum = (v, fallback) => {
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}

export function useDashboardLayout(options = {}) {
  const {
    shellRef,
    bus = null,
    isNarrow = false,
    pageScroll = false,
    // ★ KEY VERSIONED v2. The sidebars still looked unequal AFTER the symmetric-rail change landed
    // -- because a browser restores a layout
    // SAVED under the old defaults (rail 264), and a restored value outranks any new default by
    // design. When defaults change materially, the old saved layouts are prescriptions from a
    // different bottle: bump the key so every reader starts from the new defaults once, and a
    // fresh drag re-personalises from there. The v1 blob is left in place, inert.
    // v2 -> v3: retire stored layouts so the new 542 default is actually SEEN -- a persisted
    // shellH:502 from the previous default would silently mask this change in any browser that saved one.
    // ★ NAMESPACED PER DASHBOARD, AND THAT IS THE ONE BEHAVIOUR CHANGE IN THIS MOVE.
    // This was the move's named risk: the key was a single constant, so
    // the moment a page carries TWO dashboards they read and write one another's layout. Dragging a
    // divider in one would move the other's on next load, and neither would be wrong on its own.
    // While there was exactly one dashboard that was invisible; sharing the engine is precisely
    // what makes a second one possible, so the fix belongs in the commit that shares it rather than
    // in the commit that first trips over it.
    // The caller passes its own id (the shell uses config.id). The default keeps a caller that
    // passes nothing working, and still namespaces it away from any caller that does.
    storageKey = DEFAULT_STORAGE_KEY,
  } = options

  const defaults = { ...DEFAULTS, ...(options.defaults || {}) }
  const clamps = { ...CLAMPS, ...(options.clamps || {}) }

  const facetW = ref(defaults.facetW)   // px
  const railW = ref(defaults.railW)     // px
  const tableH = ref(defaults.tableH)   // string, e.g. '34%'
  const mapH = ref(defaults.mapH)       // px — only meaningful/applied in page-scroll mode
  const shellH = ref(defaults.shellH)   // px — page-scroll ELEMENT total height (map+table budget)
  const customized = ref(false)         // has the user (or a restored layout) diverged from CSS defaults?
  const mapHCustomized = ref(false)     // page-scroll's own inline var is written independently of
                                         // customized (below), since an untouched grid-mode drag
                                         // must never suddenly pin --rd-map-h and vice versa.
  const shellHCustomized = ref(false)   // same independence, one level up: the shell handle is a
                                         // separate drag from the map/table split and must not fire
                                         // just because the OTHER page-scroll var was touched.

  const narrow = () => !!unref(isNarrow)
  const inPageScroll = () => !!unref(pageScroll)

  // ── what --rd-shell-h CURRENTLY RESOLVES TO (BUG-SHELL-HANDLE-SNAPS-144PX) ───────────────────
  // The shell drag must anchor on the budget the CSS is resolving RIGHT NOW, or the first frame
  // "corrects" from a wrong anchor and the user sees height they did not drag. Two sources, in
  // priority order, because the variable and the rendered size legitimately disagree:
  //
  //   1. THE COMPUTED VARIABLE, whenever it is set. --rd-shell-h is a CEILING — it feeds the
  //      table grid's max-height — and a ceiling is not a floor: if the table has fewer rows than
  //      the budget allows, the element renders SMALLER than the variable says. MEASURED with a
  //      restored shellH of 983: the element was 1126 while map+table summed to only 743, because
  //      the grid had ~240px of budget and no rows to fill it. Anchoring on that 743 snapped the
  //      variable 983 -> 744 on the first frame — a -239px jump, the mirror image of the +144 one
  //      this card started from. Whatever the CSS already holds is what the drag must continue
  //      from, so the pointer only ever ADDS to a value that is already in effect.
  //   2. THE MEASURED map + table, only when the variable is unset. Before the first drag the CSS
  //      is on its stylesheet fallback (`80svh`), which shellH.value cannot stand in for: the 720
  //      default only equals 80svh at a 900px viewport, so trusting it would jump by the
  //      difference at any other window height.
  //
  // Measuring map + table rather than the shell's own box is deliberate — the shell is
  // `height:auto` here and includes the chrome the variable does not budget for. Summing the two
  // regions lands on the same span calc(shell-h - map-h - bar - foot) works from, without
  // restating the chrome's height as a second number that could drift from the stylesheet.
  function currentShellBudget() {
    const el = shellRef && shellRef.value
    if (!el) return shellH.value
    const declared = parseFloat(getComputedStyle(el).getPropertyValue('--rd-shell-h'))
    if (Number.isFinite(declared) && declared > 0) return Math.round(declared)
    const mapEl = el.querySelector('[data-region="map"]')
    const tableEl = el.querySelector('[data-region="table"]')
    if (!mapEl || !tableEl) return shellH.value
    const h = mapEl.getBoundingClientRect().height + tableEl.getBoundingClientRect().height
    // A collapsed/hidden region measures 0; fall back rather than anchoring the drag on nothing.
    return h > 0 ? Math.round(h) : shellH.value
  }

  // ── write / clear the inline CSS custom properties on the shell root ──
  // --rd-map-h is applied independently of `customized` (grid-mode's facet/rail/table-h gate):
  // page-scroll is a different layout entirely, with its own untouched-vs-dragged state, so
  // gating it on the grid vars' flag would either apply it before any page-scroll drag ever
  // happened, or (worse) suppress a real page-scroll drag because the grid vars were untouched.
  function applyVars() {
    const el = shellRef && shellRef.value
    if (!el) return
    if (customized.value) {
      el.style.setProperty('--facet-w', facetW.value + 'px')
      el.style.setProperty('--rail-w', railW.value + 'px')
      el.style.setProperty('--table-h', tableH.value)
    }
    if (mapHCustomized.value) {
      el.style.setProperty('--rd-map-h', mapH.value + 'px')
    }
    if (shellHCustomized.value) {
      el.style.setProperty('--rd-shell-h', shellH.value + 'px')
    }
  }
  function clearVars() {
    const el = shellRef && shellRef.value
    if (!el) return
    el.style.removeProperty('--facet-w')
    el.style.removeProperty('--rail-w')
    el.style.removeProperty('--table-h')
    el.style.removeProperty('--rd-map-h')
    el.style.removeProperty('--rd-shell-h')
  }

  // ── persistence ──
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        facetW: facetW.value, railW: railW.value, tableH: tableH.value, mapH: mapH.value, shellH: shellH.value,
      }))
    } catch (_) { /* storage blocked / SSR — layout still works this session */ }
  }
  function restore() {
    try {
      // ★ A ONE-TIME READ-THROUGH FROM THE OLD SHARED KEY, so namespacing does not silently reset
      // every reader's saved layout. Read-only and never written back: the new key is written on
      // the next drag-end, and the old value is simply left where it is rather than migrated and
      // deleted — a migration that also deletes is one that cannot be rolled back.
      // ★ ONLY FOR THE DEFAULT KEY (2026-09-27) — a regression from kit landing 2. The
      // read-through was added so namespacing would not discard a reader's saved
      // layout, and was applied unconditionally: so a caller that passes its OWN storageKey, which
      // is the entire point of namespacing, still inherited Big Picture's rail widths on first
      // load. The migration meant to protect one dashboard's layout was handing it to every other
      // dashboard. A fallback that ignores the key it is falling back FROM is not a fallback.
      const legacyOk = storageKey === DEFAULT_STORAGE_KEY
      const raw = localStorage.getItem(storageKey) || (legacyOk ? localStorage.getItem(LEGACY_SHARED_KEY) : null)
      if (!raw) return false
      const s = JSON.parse(raw)
      if (Number.isFinite(s.facetW)) facetW.value = clamp(s.facetW, clamps.facetW)
      if (Number.isFinite(s.railW)) railW.value = clamp(s.railW, clamps.railW)
      if (s.tableH != null) tableH.value = clamp(pctNum(s.tableH, pctNum(defaults.tableH, 34)), clamps.tableH) + '%'
      customized.value = true
      // shellH restores BEFORE mapH so the mapH clamp below (which bounds map to <= shellH, see
      // startResize's isTablePageScroll branch) has the right ceiling on first paint too.
      if (Number.isFinite(s.shellH)) { shellH.value = clamp(s.shellH, clamps.shellH); shellHCustomized.value = true }
      if (Number.isFinite(s.mapH)) { mapH.value = clamp(s.mapH, clamps.mapH); mapHCustomized.value = true }
      return true
    } catch (_) { return false }
  }

  // ── reset: clear the key + snap back to the EXACT defaults (hand control to the stylesheet) ──
  function reset() {
    try { localStorage.removeItem(storageKey) } catch (_) { /* ignore */ }
    facetW.value = defaults.facetW
    railW.value = defaults.railW
    tableH.value = defaults.tableH
    mapH.value = defaults.mapH
    shellH.value = defaults.shellH
    customized.value = false
    mapHCustomized.value = false
    shellHCustomized.value = false
    clearVars()
  }

  // ── drag-live signalling (BUG-RESIZE-STROBE) ──────────────────────────────
  // Two channels, because two different consumers need it:
  //   1. `data-rd-resizing` on the shell root — a pure-CSS hook so transitions/animations can be
  //      killed for the duration of the drag (no JS needed, works inside shadow DOM).
  //   2. bus 'layoutResizing' — lets the map panel downgrade to a cheap canvas resize while the
  //      drag is live, then do the one expensive re-fit on drag end.
  // Both are no-ops when absent, so this composable stays usable without a bus.
  const resizing = ref(false)
  function beginDrag() {
    if (resizing.value) return
    resizing.value = true
    const el = shellRef && shellRef.value
    if (el) el.setAttribute('data-rd-resizing', '1')
    if (bus && typeof bus.emit === 'function') { try { bus.emit('layoutResizing', true) } catch (_) {} }
  }
  function endDrag() {
    if (!resizing.value) return
    resizing.value = false
    const el = shellRef && shellRef.value
    if (el) el.removeAttribute('data-rd-resizing')
    if (bus && typeof bus.emit === 'function') { try { bus.emit('layoutResizing', false) } catch (_) {} }
  }

  // ── generic pointer drag; axis ∈ 'facet' | 'rail' | 'table' ──
  function startResize(axis, e) {
    if (narrow()) return
    const el = shellRef && shellRef.value
    if (!el) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const startX = e.clientX
    const startFacet = facetW.value
    const startRail = railW.value
    // ★ THE X DELTA HAS A READING DIRECTION (2026-09-27). Under dir=rtl the grid mirrors —
    // the facet rail sits on the RIGHT — so dragging its handle toward the map INCREASES clientX
    // where in LTR it decreases it. The maths below was written once, in LTR, and the result in
    // Arabic is that dragging the facet handle shrinks the CHARTS rail: both handles fight, and
    // neither does what the cursor says. This reaches Big Picture in ar today, not only the gospel-internet dashboard.
    // Read per drag rather than cached: a host can flip dir between gestures (our own composites
    // set it on the custom-element host from the runtime locale), and a cached sign would be wrong
    // for the rest of the session.
    // ★ PROBE THE HANDLE, NOT THE SHELL. The sign has to match the element the GRID lays out with,
    // and the handle is a grid child: whatever direction the grid resolves, the handle inherits. The
    // shell is one node further out, so a host that sets dir between the two — or a shellRef that is
    // not the grid itself — gives a direction that disagrees with the mirroring the user can see.
    // Falls back to the shell, then to ltr, so a detached handle cannot throw mid-gesture.
    const rtl = (() => {
      for (const node of [e.currentTarget, unref(shellRef)]) {
        try { const d = node && getComputedStyle(node).direction; if (d) return d === 'rtl' } catch (_) { /* next */ }
      }
      return false
    })()
    const xSign = rtl ? -1 : 1
    const handleEl = e.currentTarget
    // ── PAGE-SCROLL AXIS SWITCH (BUG-TABLE-RESIZE-HANDLE-DOES-NOTHING) ──────────────────────
    // In page-scroll mode (research-dashboard.vue's pageScroll / dashboard-plus-grid.vue) the
    // shell is `height:auto` and grows with its content, so `rect` above is NOT one screen tall
    // — `rect.bottom` can sit thousands of px below the viewport. --table-h is force-set to
    // `auto` by the .rd-page-scroll stylesheet rule and no longer drives ANY layout: the map's
    // height instead comes from --rd-map-h (default 40svh as of BUG-DASHBOARD-BAND-GROWS-ENORMOUS;
    // see the CSS note beside it), and the table's own max-height comes from --rd-table-max-h.
    // Writing tableH in this mode is a complete no-op — MEASURED (at the prior 58svh default):
    // map height 522px before and after a real 200px drag, every
    // frame. The fix is to drive --rd-map-h directly, from the MAP ELEMENT's own top edge
    // (not the unbounded shell rect), so growing the map is a plain function of where the
    // pointer is relative to where the map starts.
    //
    // ★ THE map/table SPLIT vs. THE shell's OWN HEIGHT (BUG-SHELL-HANDLE-BOUND-TO-WRONG-DIVIDER)
    // — this handle must move height BETWEEN map and table, never grow the total. mapH is now
    // clamped to leave the table at least TABLE_BAR_H + TABLE_MIN_H of the FIXED shellH budget,
    // so dragging this divider can only redistribute the two, exactly like resizing an internal
    // pane split rather than the window itself.
    const isTablePageScroll = axis === 'table' && inPageScroll()
    const isShellResize = axis === 'shell' && inPageScroll()
    let startMapTop = 0
    let mapHCeiling = clamps.mapH[1]
    if (isTablePageScroll) {
      const mapEl = el.querySelector('[data-region="map"]')
      const mapRect = mapEl ? mapEl.getBoundingClientRect() : null
      startMapTop = mapRect ? mapRect.top : (e.clientY - mapH.value)
      mapHCeiling = Math.max(clamps.mapH[0], shellH.value - (TABLE_BAR_H + TABLE_MIN_H))
    }
    // ★ DELTA-ANCHORED ON THE LIVE BUDGET (BUG-SHELL-HANDLE-SNAPS-144PX-ON-FIRST-FRAME).
    // MEASURED at 1440x900: a 1px drag grew the element 144px. TWO defects stacked here, and
    // fixing only the first leaves the number bit-for-bit unchanged — which is the clue that
    // named the second.
    //
    //   1. POINTER-ABSOLUTE math. The old line set shellH to (pointerY - shellTop), treating the
    //      cursor's Y AS the new height. That is only correct if the handle sits exactly shellH
    //      px below the shell's top, and it does not. Fixed by anchoring on a start value and
    //      adding the pointer DELTA.
    //   2. THE WRONG ANCHOR — the actual source of the 144. Anchoring on the element's measured
    //      height is the obvious move and is wrong, because --rd-shell-h IS NOT THE ELEMENT'S
    //      HEIGHT. The shell is `height:auto` in page-scroll mode (.rd-shell.rd-page-scroll) and
    //      nothing reads --rd-shell-h as a height; its ONLY consumer is the table grid's
    //      max-height: calc(--rd-shell-h - --rd-map-h - bar - foot). So the variable budgets
    //      MAP + TABLE and excludes the chrome above them (topbar 52 + filters 55 + stats 30 =
    //      141px measured). Seeding it with the measured 863 published a budget 144px too large:
    //      the grid's max-height jumped 300 -> 444 on the FIRST frame and the element grew with
    //      it. 863 - 719 = 144 is not a coincidence — it is the chrome, double-counted.
    const startShellY = e.clientY
    const startShellH = isShellResize ? currentShellBudget() : shellH.value
    try { handleEl && handleEl.setPointerCapture && handleEl.setPointerCapture(e.pointerId) } catch (_) {}

    // ── A11Y / PHOTOSENSITIVITY (BUG-RESIZE-STROBE): mark the drag as LIVE ──
    // Writing the CSS vars every pointermove reflows the grid, which fires the map panel's
    // ResizeObserver → map.resize() → MapLibre's own 'resize' event → useMapInstance's
    // _onResize → setMinZoom/setZoom. Because the zoom FLOOR is derived from the container
    // HEIGHT, a vertical drag re-snapped the camera on EVERY frame — a ~60Hz full-canvas
    // re-render that reads as strobing. Flagging the drag lets the map coalesce to a single
    // cheap canvas resize while dragging and do the one expensive re-fit on drag END.
    beginDrag()

    // Coalesce the inline-var writes to one per animation frame. pointermove can fire faster
    // than the compositor on high-polling-rate mice, so without this the grid could reflow
    // several times per painted frame — wasted work that makes the strobe worse.
    let frame = 0
    let pending = null
    function flush() {
      frame = 0
      if (!pending) return
      const ev = pending
      pending = null
      if (axis === 'facet') {
        // left facet edge → dragging right widens the facet column
        facetW.value = Math.round(clamp(startFacet + xSign * (ev.clientX - startX), clamps.facetW))
        customized.value = true
      } else if (axis === 'rail') {
        // right rail's LEFT edge → dragging left widens the rail column
        railW.value = Math.round(clamp(startRail - xSign * (ev.clientX - startX), clamps.railW))
        customized.value = true
      } else if (isTablePageScroll) {
        // page-scroll: the handle sits pinned to the MAP's own bottom edge (.rd-rz-table is
        // align-self:end on the map grid-area — see the CSS below), whose top never moves. The
        // pointer's new Y position IS the map's new bottom edge, so the new height is simply the
        // distance from the map's (fixed) top to the cursor — a direct 1:1 follow, exactly like
        // dragging the corner of a window. Re-derived fresh every frame from startMapTop (not
        // summed from a delta), so it can never drift from the cursor across a long drag.
        // Clamped to mapHCeiling (not the raw clamps.mapH max) — the ceiling reserves the table's
        // bar + a usable minimum out of the FIXED shellH budget, so this drag only ever moves
        // height between map and table and can never grow the element's total height. That is
        // the shell axis's job (see isShellResize below), not this one's.
        mapH.value = Math.round(clamp(ev.clientY - startMapTop, [clamps.mapH[0], mapHCeiling]))
        mapHCustomized.value = true
      } else if (axis === 'table') {
        // map/table divider → dragging up grows the table (height measured from shell bottom)
        const pct = ((rect.bottom - ev.clientY) / rect.height) * 100
        tableH.value = Math.round(clamp(pct, clamps.tableH)) + '%'
        customized.value = true
      } else if (isShellResize) {
        // The NEW shell handle — spans the whole element's bottom edge (research-dashboard.vue's
        // .rd-rz-shell), the boundary with whatever a host stacks below (e.g. the people-groups
        // grid in dashboard-plus-grid.vue). Same fixed-top / 1:1-follow pattern as the map handle
        // above. This is the ONLY axis that changes --rd-shell-h, i.e. the only handle that
        // changes the element's total height — the map/table divider above must never do this
        // (see its own comment).
        // DELTA from the live start budget, NOT the pointer's absolute Y: unlike the map handle,
        // this variable is not a distance from a fixed top edge, so there is no "pointer Y IS the
        // new value" identity to exploit — assuming one produced the 144px snap (see the note on
        // startShellH above).
        shellH.value = Math.round(clamp(startShellH + (ev.clientY - startShellY), clamps.shellH))
        shellHCustomized.value = true
      }
      applyVars()
    }
    function move(ev) {
      // keep only the LATEST position; the rAF does the single write for this frame
      pending = { clientX: ev.clientX, clientY: ev.clientY }
      if (!frame) frame = requestAnimationFrame(flush)
    }
    function up(ev) {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
      flush()   // land the final position even if the last frame never ran
      try { handleEl && handleEl.releasePointerCapture && handleEl.releasePointerCapture(ev.pointerId) } catch (_) {}
      persist()
      endDrag()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const startFacetResize = (e) => startResize('facet', e)
  const startRailResize = (e) => startResize('rail', e)
  const startTableResize = (e) => startResize('table', e)
  const startShellResize = (e) => startResize('shell', e)

  // ── keyboard step-resize (a11y: role="separator" needs an operable equivalent to the drag) ──
  // Reuses the SAME refs/clamps/persist/applyVars as the pointer path — no parallel math. One
  // discrete step per keypress (no rAF coalescing needed; a keydown can't fire faster than a frame).
  // `table` axis mirrors startResize's own page-scroll branch: in page-scroll mode it steps mapH
  // (the map/table split within the FIXED shellH budget), otherwise it steps the grid-mode tableH
  // percentage. `shell` steps shellH directly — the only axis that changes the element's total height.
  const STEP = { facet: 16, rail: 16, table: 24, mapH: 24, shellH: 24 }   // px per arrow-key press (tableH in %)
  // `toExtreme` bypasses the per-step delta entirely and clamps straight to lo/hi — Home/End jump,
  // not a long walk of individual steps (which would also mean 200 localStorage writes per keypress).
  function stepResize(axis, dir, toExtreme) {
    if (narrow()) return
    if (axis === 'facet') {
      facetW.value = toExtreme ? (dir < 0 ? clamps.facetW[0] : clamps.facetW[1])
        : Math.round(clamp(facetW.value + dir * STEP.facet, clamps.facetW))
      customized.value = true
    } else if (axis === 'rail') {
      // Same "left edge, dragging left widens" sense as the pointer path: ArrowLeft (dir -1)
      // widens the rail, so the rail's step direction is inverted relative to facet's.
      railW.value = toExtreme ? (dir < 0 ? clamps.railW[1] : clamps.railW[0])
        : Math.round(clamp(railW.value - dir * STEP.rail, clamps.railW))
      customized.value = true
    } else if (axis === 'table' && inPageScroll()) {
      // Same ceiling as the pointer path (startResize's mapHCeiling): reserve the table's bar +
      // usable minimum out of the CURRENT shellH so a keyboard drag can redistribute but never
      // grow the total either.
      const ceiling = Math.max(clamps.mapH[0], shellH.value - (TABLE_BAR_H + TABLE_MIN_H))
      mapH.value = toExtreme ? (dir < 0 ? clamps.mapH[0] : ceiling)
        : Math.round(clamp(mapH.value + dir * STEP.mapH, [clamps.mapH[0], ceiling]))
      mapHCustomized.value = true
    } else if (axis === 'table') {
      const pct = toExtreme ? (dir < 0 ? clamps.tableH[0] : clamps.tableH[1])
        : clamp(pctNum(tableH.value, pctNum(defaults.tableH, 34)) - dir * STEP.table / 4, clamps.tableH)
      tableH.value = Math.round(pct) + '%'
      customized.value = true
    } else if (axis === 'shell' && inPageScroll()) {
      shellH.value = toExtreme ? (dir < 0 ? clamps.shellH[0] : clamps.shellH[1])
        : Math.round(clamp(shellH.value + dir * STEP.shellH, clamps.shellH))
      shellHCustomized.value = true
    }
    applyVars()
    persist()
  }
  // ArrowUp/Left = grow toward the start edge, ArrowDown/Right = grow toward the end edge, matching
  // each handle's drag SENSE (facet/rail are col-resize, table/map/shell are row-resize). Home/End
  // jump to the axis's clamp extremes in one write (not a walk of individual steps).
  function onResizeKeydown(axis, e) {
    const K = e.key
    let dir = 0
    if (axis === 'table' || axis === 'shell') { if (K === 'ArrowUp') dir = -1; else if (K === 'ArrowDown') dir = 1 }
    else {
      // ★ AND THE ARROWS FOLLOW THE SAME SIGN. The pointer path now mirrors under rtl; if
      // the keyboard did not, the two input methods would disagree about which way widens — and a
      // keyboard user in Arabic would find the arrows inverted relative to the drag they just
      // watched. aria-valuenow reports the same ref for both, so a disagreement here would also
      // make the announced value move the wrong way.
      let kSign = 1
      // Same node choice as the pointer path above, for the same reason.
      try { for (const node of [e.currentTarget, unref(shellRef)]) { const d = node && getComputedStyle(node).direction; if (d) { if (d === 'rtl') kSign = -1; break } } } catch (_) { /* no element */ }
      if (K === 'ArrowLeft') dir = -1 * kSign; else if (K === 'ArrowRight') dir = 1 * kSign
    }
    if (dir) { e.preventDefault(); stepResize(axis, dir); return }
    if (K === 'Home' || K === 'End') {
      e.preventDefault()
      stepResize(axis, K === 'Home' ? -1 : 1, true)
    }
  }

  // ── lifecycle: restore + apply after the shell el exists; wire the reset bus event ──
  let offReset = null
  onMounted(() => {
    if (restore()) applyVars()
    if (bus && typeof bus.on === 'function') offReset = bus.on('resetLayout', reset)
  })
  onBeforeUnmount(() => {
    try { offReset && offReset() } catch (_) {}
    // If the component tears down mid-drag, release the suppression so a re-mounted map
    // is never left permanently in the cheap "resizing" mode.
    try { endDrag() } catch (_) {}
  })

  return {
    facetW, railW, tableH, mapH, shellH, customized, resizing,
    startFacetResize, startRailResize, startTableResize, startShellResize,
    startResize, reset, applyVars, stepResize, onResizeKeydown,
  }
}
