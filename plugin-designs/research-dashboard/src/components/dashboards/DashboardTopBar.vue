<script setup>
import { tStatic } from '@map/i18n/index.js'
const L = (key, en) => tStatic('dashboard.' + key) || en
/**
 * DashboardTopBar — RDASH P4 Command Bar (topbar grid region, 52px).
 * One cohesive header surface holding, on ONE row:
 *   title · the SHARED filter search bar · Align · Share.
 * (The inline Breadcrumb that used to sit between title and search is GONE — see the ★ rule below.)
 *
 * ── ★ NO SELECTION STATE IN THIS HEADER, IN ANY FORM ──
 * Asked 2026-09-22, for about the fiftieth time: based on the selections, it should NOT show up
 * in the first header where the search bar is... The only selection data should show up underneath
 * the toggles — people, regions, block, country, language — the filters."
 *
 * THE RULE IS ABOUT SELECTION STATE, NOT ABOUT CHIPS. That distinction is the whole reason this
 * bug survived ~50 requests, so it is written at the top rather than buried below:
 *   - Round 1 removed <DashboardFilterChips/> from this bar (the notes below). Correct, incomplete.
 *   - <DashboardBreadcrumb/> STAYED, and it is ALSO a view over bus.filterSet — it rendered
 *     "World ▸ South Asian Peoples" in bold white, the most prominent selection echo on screen.
 * Every verification after round 1 searched for CHIPS — chip classes, the literal "Clear all" — and
 * came back green while the reader was plainly still looking at their selection in the top bar. A
 * numeric probe for the wrong noun is indistinguishable from a fixed bug. MEASURED 2026-09-22 on
 * BOTH the leaf and the cap-4 composite: chips/Clear-All were already correctly in region 'filters'
 * (1 of each, 0 in topbar) while the topbar read "…World ▸ South Asian Peoples ⤢ Align Dashboard".
 *
 * ★ SO THE TEST FOR A FUTURE EDIT IS NOT "did I add a chip?" — it is: does this render anything
 * DERIVED FROM bus.filterSet / bus.selected / bus.searchTerm? If yes, it belongs in the second
 * header. The search INPUT is the one allowed exception: it is the control that creates the state,
 * not a readout of it, and the requirement names it as this header's defining occupant.
 *
 * NOTHING WAS LOST TO THE USER — the second header already carries every affordance the breadcrumb
 * offered, which is why this is de-duplication and not a feature removal:
 *   show active selections     -> the sfh__chip labels (richer: they name the facet too)
 *   pop back one level (popTo) -> the chip's ✕ -> remove-filter -> bus.setFilter(k, null)
 *   the "World" crumb (clear)  -> "Clear All" -> clear-all -> bus.clearFilters()
 * DashboardBreadcrumb.vue is KEPT in the kit and still exported from ./index.js — it is a working
 * drill-down crumb another dashboard may mount. It simply must not sit in a header that also hosts
 * the search bar, beside a SearchFilterHeader that is already showing the same state.
 *
 * ── (round 1, retained) ACTIVE-FILTER CHIPS ARE NOT HERE (card
 *    BUG-DUPLICATE-FILTER-BADGES-IN-BOTH-DASHBOARD-HEADERS) ──
 * The symptom: the Unified Research dashboard showed the same selection twice ("Africa", "Region
 * Africa", "Clear All"), with two Clear Alls and two sets of badges. The SECOND header is the one
 * place for them; the TOP header, where the search bar is, carries none.
 *
 * The duplication was ARCHITECTURAL, not a copy-paste: the dashboard mounts TWO headers in this
 * order (research-dashboard.vue:265-266) and each had grown its OWN independent chip implementation
 * over the same shared state:
 *   1. THIS topbar (grid-area 'topbar', 52px, hosts the search bar) rendered <DashboardFilterChips/>,
 *      which emits the chips AND its own "Clear all" span.
 *   2. DashboardResearchFilters (grid-area 'filters', the SECOND header) passes :active-chips into
 *      the shared @map/components/search/SearchFilterHeader.vue, which renders its own chip row and
 *      its own "Clear all" button.
 * Both read the SAME bus.filterSet, so they could only ever render identical content — hence two of
 * everything, every time. Grep found the literal "Clear all" only once because copy 2's text lives
 * in the shared library component, not in this design folder; that is why the duplication survived
 * several passes.
 *
 * The SECOND header is now the SINGLE SOURCE OF TRUTH for showing and clearing active filters. It
 * is the right home on the merits, not just by decree: it is the band that OWNS the filter
 * dropdowns, so the chips sit with the controls that created them, and it is a free-height flow row
 * rather than this fixed 52px bar — the chip strip here had already forced a bounded, scrollable,
 * ellipsised left group (see .rd-left below) purely to avoid a second header row.
 *
 * NOTHING was re-homed to make this work: the second header's clear is entirely self-contained
 * (SearchFilterHeader emits 'clear-all' -> DashboardResearchFilters.onClearAll -> bus.clearFilters),
 * with no dependency on this component. DashboardFilterChips.vue is left in the kit and still
 * exported from ./index.js — it is a working, label-resolving chip strip another dashboard may
 * mount; it simply must not be mounted ALONGSIDE a SearchFilterHeader that is already showing chips.
 *
 * CSV export is NOT here — it belongs to the people-groups table it exports, so it lives on
 * DashboardDataTable's header bar below the map (card
 * BUILD-CSV-EXPORT-MOVE-TO-TABLE-HEADER-ALL-FIELDS).
 *
 * ── HEADER STACK (card BUG-RESEARCH-DASHBOARD-HEADER-STACK-WRONG) ──
 * The primary search bar lives HERE now, in the topbar row, so the header stack reads:
 *   [THIS topbar: title · search · Align] → [filters dropdowns] → [KPI stats] → body.
 * It is the SHARED SearchBar wired straight to bus.setSearch — the SAME free-text search that
 * DashboardResearchFilters used to host in the filters band — so every linked panel (table/map/
 * charts/facets/KPIs) re-derives via the shared makeSearchMatcher exactly as before; only the
 * bar's PLACEMENT moved out of the filters band and up into this row (search-ABOVE-filters).
 *
 * The old LOCAL typeahead (type-a-name → pick → bus.toggleSelect) is kept behind the
 * `showTopBarSearch` flag (default OFF) for dashboards that want a jump-to-record affordance
 * instead of a live filter — it does NOT drive the shared filter bus.
 * All CSS via useShadowStyles (scoped <style> is dropped in the defineCustomElement shadow build).
 *
 * Config-driven (DOXA-LIB-2): the brand title and the FACET_ACC accessors are read from
 * inject('dashboardConfig') instead of being hard-coded — see ./README.md.
 */
import { inject, computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import SearchBar from '@map/components/search/SearchBar.vue'
// DashboardBreadcrumb is NOT imported here — it renders bus.filterSet, i.e. selection state, which
// this header must not show (see the ★ rule at the top). It remains exported from ./index.js.
import ShareButton from '@map/components/map-controls/ShareButton.vue'
// The header ⓘ ("What can this map do?"). It reuses the map-control MapInfoButton in its HEADER form
// (shape="rounded-square"): the same control bridge announces to the tab's MapInfo (trigger:'control'
// in doxa-maps-spa/src/tabInfo.js), which suppresses the gallery's floating ⓘ — exactly one ⓘ, fail-open.
import MapInfoButton from '@map/components/map-controls/MapInfoButton.vue'
import { lbl } from '@map/composables/useFacetAggregation.js'

const dash = inject('dashboardData', null)
const bus = inject('selectionBus', null)
const cfg = inject('dashboardConfig', {})
// The old RDASH command-bar typeahead is superseded by the 4 DashboardSearchHeader
// facet bars (People/Place/Language/Religion). Feature-flag it OFF by default —
// code kept warm; a dashboard can opt back in with config `showTopBarSearch: true`.
const showTopBarSearch = computed(() => cfg.showTopBarSearch === true)
// Share the WHOLE dashboard: this profile's standalone leaf page, TREE-RELATIVE
// (<bundle>/<profile>/index.html) — ShareButton joins it to the served tree root, so the snippet
// resolves from whatever host the folder was dropped on. Path read from the published catalog and
// verified 200 live, not constructed by hand.
const SHARE_EMBED_PATH = 'research-dashboard/research-dashboard/index.html'

// "Align Dashboard" — snap the drag-resized layout back to defaults. Stays generic: TopBar just
// emits on the shared selection bus; the profile's useDashboardLayout listens (bus.on('resetLayout',
// reset)) and clears its localStorage key + inline vars. Desktop-only — hidden via CSS on .rd-narrow.
function onAlignLayout() { if (bus) bus.emit('resetLayout') }

// ── primary filter search (shared SearchBar → the selection bus) ──
// The value the panels honor lives on the bus; this bar reads/writes it via bus.searchTerm /
// bus.setSearch, so it is the SAME free-text search the whole surface re-derives against.
const filterSearch = computed(() => bus?.searchTerm?.value || '')
// The config's own wording wins when an instance sets one; otherwise the catalogue, not an English
// constant — dashboard.search_placeholder is the same sentence, already translated everywhere.
const filterSearchPlaceholder = computed(() => cfg.researchFilters?.searchPlaceholder || L('search_placeholder', 'Search people groups, place, language, religion…'))
function onFilterSearch(payload) { bus?.setSearch(payload?.value ?? '') }

// ── live typeahead search over the in-memory row store ──
const q = ref('')
const open = ref(false)
const active = ref(0)
const results = computed(() => {
  const term = q.value.trim().toLowerCase()
  if (term.length < 2) return []
  const rows = dash?.rows?.value || []
  const out = []
  for (const r of rows) {
    const name = (r.name || '').toLowerCase()
    if (name.includes(term)) { out.push(r); if (out.length >= 8) break }
  }
  return out
})
function focusResult(r) {
  if (!r || !bus) return
  if (r.slug) { bus.toggleSelect(r.slug); bus.emit('focusRow', { slug: r.slug, name: r.name }) }
  q.value = ''; open.value = false; active.value = 0
}
function onInput() { open.value = true; active.value = 0 }
function onKeydown(e) {
  if (!results.value.length) { if (e.key === 'Escape') { q.value = ''; open.value = false } return }
  if (e.key === 'ArrowDown') { e.preventDefault(); active.value = (active.value + 1) % results.value.length }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = (active.value - 1 + results.value.length) % results.value.length }
  else if (e.key === 'Enter') { e.preventDefault(); focusResult(results.value[active.value]) }
  else if (e.key === 'Escape') { q.value = ''; open.value = false; active.value = 0 }
}
function onResultsClick(e) {
  const el = e.target && e.target.closest && e.target.closest('[data-slug]')
  if (!el) return
  const slug = el.getAttribute('data-slug')
  const r = (dash?.rows?.value || []).find((x) => x.slug === slug)
  if (r) focusResult(r)
}
// close the dropdown on outside click (shadow-DOM safe: listen on the host root, not document)
const rootEl = ref(null)
function onDocClick(e) { if (rootEl.value && !rootEl.value.contains(e.target)) open.value = false }
onMounted(() => { try { rootEl.value?.getRootNode()?.addEventListener('click', onDocClick) } catch (_) {} })
onBeforeUnmount(() => { try { rootEl.value?.getRootNode()?.removeEventListener('click', onDocClick) } catch (_) {} })

useShadowStyles(`
  /* DOXA green research-map header — matches research-map.vue site header (#4e594f / light ink #f3f3f1).
     Tokens stay overridable: --rd-header (green surface), --rd-header-ink (light text),
     --rd-header-muted (light muted for icons/placeholders/sub-text). */
  /* --rd-search-w is the ONE source of truth for the centred search's width; both the search box
     itself and the chip strip's right-hand bound are derived from it, so the two can never drift
     (a hardcoded second copy is what let the chips run under the search — see .rd-chips below). */
  /* padding resolves --rd-edge (the header stack's ONE edge gutter, defined on :host in
     research-dashboard.vue) so this bar, the filters band and the KPI strip share an edge. They
     were 14 / 14 / 16 — a measured 2px staircase. Do not re-literalise the horizontal value. */
  .rd-topbar{ position:relative; display:flex; align-items:center; gap:12px; height:100%; padding:0 var(--rd-edge,14px);
    --rd-search-w:min(360px,34%);
    background:var(--rd-header,#4e594f); color:var(--rd-header-ink,#f3f3f1); border-bottom:1px solid var(--rd-header-line,#3c453d);
    box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  /* LEFT GROUP (cards BUG-SELECTED-CHIPS-UGLY-UNDER-TOP-SEARCHBAR / BUG-SELECTION-CHIPS-UNDER-SEARCHBAR).
     The search is position:absolute, so it is OUT OF FLOW — the flex row does not know the centre
     strip is occupied, and the left content grew straight under it. The search stays centred exactly
     as designed (its centre must not drift); the LEFT CONTENT is what gets bounded.
     The bound is DERIVED from --rd-search-w so the two can never drift: the reserved strip is
     --rd-search-w wide, so the left zone ends at 50% - half of it - one gutter (see below).
     nowrap + min-width:0 keeps the 52px bar SINGLE-ROW (before the fix the chips wrapped to h=50
     at 1024x768) — it is settled: NEVER add a second header row. */
  .rd-topbar .rd-left{ display:flex; align-items:center; gap:12px; flex:0 1 auto; min-width:0;
    flex-wrap:nowrap; overflow:hidden;
    /* MEASURED RESIDUAL — why this is ONE term and not a 12px gutter plus a 14px padding add-back.
       BOTH original terms were deliberate: 12px was the gutter, and +14px added back the bar's
       padding because this box starts inside the padding box. But they NET TO +2px, and the
       measurement found exactly that overlap: chip-bar right 542 vs search left 540 at 1440,
       462 vs 460 at 1280. The reasoning was sound; the arithmetic left no gutter at all.
       The padding add-back is also not needed here: max-width resolves against this box's
       CONTAINING BLOCK, which is the topbar's CONTENT box — the 14px padding is already excluded,
       so adding it back double-counts and eats the gutter.
       One explicit term instead. 16px > 12px on purpose: it absorbs the sub-pixel rounding you get
       when two rects are rounded independently, and the narrow case where the search's percentage
       clamp binds rather than its 360px (that one measured -7px, not -2px). */
    max-width:calc(50% - (var(--rd-search-w) / 2) - 16px); }
  /* The BRAND still shrinks + ellipsises. Measured at 1024x768 the left zone is only ~334px while
     the brand alone was 248px, so the title must be able to give way rather than force the group
     wider; min-width:0 + overflow/ellipsis is what actually lets it, since a flex item will not
     shrink past its min-content width on shrink-factor alone.
     BOTH sibling rules that used to live here are GONE with the elements they sized — .rd-chips
     (round 1) and .rd-breadcrumb (this fix). A rule matching nothing is not free: it reads as a
     live constraint to the next person and invites a phantom fix. The two .rd-brand declarations
     are likewise collapsed into the ONE below; they were split only so the second could override
     the first's flex:0 0 auto on source order, and with no neighbour left to compete for space
     that dance is just a trap for the next reader. */
  .rd-topbar .rd-brand{ display:flex; align-items:baseline; gap:7px; flex:0 1 auto; min-width:0; overflow:hidden; }
  .rd-topbar .rd-left .rd-brand .rd-ttl{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .rd-topbar .rd-ttl{ font-weight:800; font-size:var(--fs-lg,13px); letter-spacing:.2px; color:var(--rd-header-ink,#f3f3f1); }
  .rd-topbar .rd-ttl .dot{ color:var(--rd-accent,#e67e22); }
  .rd-topbar .rd-spacer{ flex:1; }
  /* HEADER BUTTONS — the ⓘ + Share, rounded squares at the vertical tabs' radius (design rule, 2026-09-30).
     The rounded-square SHAPE is not set here: it comes from each button's shape="rounded-square" prop
     (library MapControlButton → border-radius:var(--vtl-radius)), so the header button and the gallery's
     tabs share ONE radius variable and can never drift. This bar only sizes them to its own control scale
     and restores the tap target — the same treatment the Share button already had, now covering both so
     the ⓘ matches it exactly. Scoped to .rd-topbar, so the map toolbars keep their 40px round buttons.
     At map size they were too large for this bar: ShareButton is a 40px round map control + a 2px rainbow ring, 44px
     in a 38px bar. Here both take 28px (+ Share's ring = 32px, the search box's height), icon 16px. */
  .rd-topbar .rd-header-btns{ display:inline-flex; align-items:center; gap:8px; flex:0 0 auto; }
  .rd-topbar .rd-header-btns .mcb{ --map-btn-size:28px; position:relative; }
  .rd-topbar .rd-header-btns .mcb svg{ width:16px; height:16px; }
  /* ★ THE BUTTONS ARE 28px TO LOOK RIGHT; THE THING A FINGER HAS TO HIT IS NOT. This repo states its own
     44px floor twice — DataTable.vue:294 ("44px is the accessible tap target; anything smaller is a miss
     on a phone") and LegendDesktop.vue:124. A transparent box centred on each button restores the target
     without moving a pixel of the drawing: absolutely positioned, so it changes no layout, and part of the
     button, so it takes the same clicks.
     ★ 44 WIDE, 38 TALL, AND THE SHORTFALL IS DELIBERATE. The bar is 38px (--rd-topbar-h), so 44 vertical
     cannot fit inside it: the extra 3px each side would hang over the filters row below and start eating
     taps meant for a filter — trading one miss for another. 44x38 is the largest target that costs nothing. */
  .rd-topbar .rd-header-btns .mcb::after{
    content:''; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    width:44px; height:var(--rd-topbar-h,38px);
  }
  /* primary FILTER search bar (shared SearchBar → bus.setSearch), lifted into the topbar row so
     it sits ABOVE the filters-dropdowns band (card BUG-RESEARCH-DASHBOARD-HEADER-STACK-WRONG).
     Compact it for the 52px bar: shrink the primitive's padding/height so the white box fits.
     CENTERED (card BUG-SEARCH-BAR-NOT-CENTERED): absolutely-positioned to the header's horizontal
     centre so its centre stays dead-on regardless of the left (title/breadcrumb/chips) or right
     (Align/CSV/toast) content widths. left:50% + translateX(-50%) is width-agnostic; a flow-based
     margin:auto would drift as the interleaved chips grow. Sits ON TOP of the row (its neighbours
     are the flow); pointer-events kept only on the box itself so it doesn't eat clicks around it. */
  .rd-topbar .rd-filter-search{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    z-index:2; width:360px; max-width:var(--rd-search-w); min-width:150px; }
  .rd-topbar .rd-filter-search .search-box{ margin:0; color:var(--rd-header-muted,#cbc5b9); }
  /* ★ FULL PILL, not a bigger number picked by eye: the header's search bar is fully rounded. The input is a MEASURED 32px tall, so 16px is exactly half its
     height — the radius at which the ends become true semicircles. Any larger value renders
     identically (the browser clamps to height/2), so this is the actual maximum, and it stays
     correct if the height changes only in the sense that it is derived from a value stated right
     here on the same line.
     ★ SCOPED TO THE TOP HEADER ONLY. The card's scope field named library/components/search/
     SearchBar.vue, but that component's own 10px is NOT what renders here — this rule overrides it
     (measured: computed border-radius was 6px, not 10px). Changing the library would have altered
     people-groups-grid and big-picture too, which was not asked for. Verify what actually
     paints before editing the file a card names. */
  .rd-topbar .rd-filter-search .search-box input{ height:32px; padding:0 10px 0 34px; font-size:var(--fs-md,12px);
    border-radius:16px; border-color:#ffffff3d; }
  .rd-topbar .rd-filter-search .search-box input:focus{ border-color:var(--rd-accent,#e67e22); }
  .rd-topbar .rd-filter-search .search-icon{ inset-inline-start:10px; width:15px; height:15px; }
  /* narrow: return the search to normal flow (drop the absolute centring) and let it take the row
     width; the align button is already hidden here, so a centred search has no right-hand anchor. */
  .rd-shell.rd-narrow .rd-topbar .rd-filter-search{ position:static; transform:none;
    inset-inline-start:auto; top:auto; flex:1 1 auto; width:auto; max-width:none; }
  /* search — translucent light field so typed text stays legible on the green bar */
  .rd-search{ position:relative; flex:0 1 280px; min-width:140px; }
  .rd-search input{ width:100%; box-sizing:border-box; height:30px; padding:0 10px 0 28px; font-size:var(--fs-md,12px);
    color:var(--rd-header-ink,#f3f3f1); background:#ffffff1f; border:1px solid #ffffff3d;
    border-radius:var(--r-md,6px); outline:none; }
  .rd-search input:focus{ border-color:var(--rd-accent,#e67e22); background:#ffffff33; }
  .rd-search input::placeholder{ color:var(--rd-header-muted,#cbc5b9); }
  .rd-search .ic{ position:absolute; inset-inline-start:8px; top:50%; transform:translateY(-50%); font-size:12px; color:var(--rd-header-muted,#cbc5b9); pointer-events:none; }
  .rd-results{ position:absolute; left:0; right:0; top:34px; z-index:60; background:#fff; border:1px solid var(--rd-line, #d1d4cd);
    border-radius:var(--r-md,6px); box-shadow:0 8px 24px #1f273322; overflow:hidden; max-height:320px; overflow-y:auto;
    scrollbar-width:thin; scrollbar-color:var(--dx-scroll-thumb, #c4c8c0) transparent; }
  .rd-results .rd-res{ display:flex; align-items:baseline; gap:8px; padding:6px 10px; cursor:pointer; font-size:var(--fs-md,12px); }
  .rd-results .rd-res:hover, .rd-results .rd-res.on{ background:var(--rd-bg, #f3f3f1); }
  .rd-results .rd-res .nm{ font-weight:700; color:var(--rd-ink, #3b463d); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rd-results .rd-res .sub{ margin-inline-start:auto; color:var(--rd-muted, #6d766e); font-size:var(--fs-sm,11px); white-space:nowrap; flex:0 0 auto; }
  .rd-results .rd-empty{ padding:8px 10px; color:var(--rd-muted, #6d766e); font-size:var(--fs-sm,11px); }
  /* (csv button + toast styles moved to DashboardDataTable's header bar) */
  /* Align Dashboard — subtle ghost button on the green bar; snaps the dragged layout to defaults.
     Desktop-only: hidden whenever the shell is in its narrow/mobile mode (shared shadow root). */
  .rd-topbar .rd-align{ display:inline-flex; align-items:center; gap:5px; font-size:var(--fs-sm,11px); font-weight:700;
    cursor:pointer; user-select:none; flex:0 0 auto; color:var(--rd-header-ink,#f3f3f1);
    background:#ffffff1f; border:1px solid #ffffff3d; border-radius:var(--r-md,6px); padding:5px 11px; }
  .rd-topbar .rd-align:hover{ background:#ffffff33; border-color:var(--rd-accent,#e67e22); color:#fff; }
  .rd-shell.rd-narrow .rd-topbar .rd-align{ display:none; }
`, 'rd-topbar')
</script>

<template>
  <header ref="rootEl" class="rd-topbar" data-region="topbar">
    <!-- LEFT GROUP — now the BRAND TITLE ONLY. Both of the group's data-driven members are gone:
         the chips (round 1) and the breadcrumb (this fix), because both rendered bus.filterSet.
         What is left is static chrome, so the left group can no longer grow with the user's
         selection and slide under the centred search — the bug class that forced the bound below
         is now structurally impossible rather than merely contained.
         THE BOUND IS DELIBERATELY KEPT ANYWAY. The search is still position:absolute and therefore
         still out of flow, so this row still cannot see that the centre strip is occupied; a long
         cfg.title alone would run under it. It costs nothing and it is the guard that fails safe if
         anyone re-adds a variable-width member here. -->
    <div class="rd-left">
      <span class="rd-brand"><span class="rd-ttl">{{ cfg.title || L('title', 'Research Dashboard') }}<span class="dot">.</span></span></span>
    </div>
    <div class="rd-filter-search" data-filter-search>
      <SearchBar
        :model-value="filterSearch"
        :placeholder="filterSearchPlaceholder"
        :aria-label="filterSearchPlaceholder"
        max-width="360px"
        @search="onFilterSearch"
      />
    </div>
    <span class="rd-spacer" />
    <div v-if="showTopBarSearch" class="rd-search" data-search>
      <span class="ic">⌕</span>
      <input type="text" v-model="q" :placeholder="tStatic('grid.search') || 'Search people groups…'" data-search-input
             :aria-label="tStatic('aria.searchPeopleGroups') || 'Search people groups'" @input="onInput" @focus="onInput" @keydown="onKeydown" />
      <div v-if="open && q.trim().length >= 2" class="rd-results" data-search-results @click="onResultsClick">
        <template v-if="results.length">
          <div v-for="(r, i) in results" :key="r.slug" class="rd-res" :class="{ on: i === active }" :data-slug="r.slug">
            <span class="nm">{{ r.name }}</span>
            <span class="sub">{{ lbl(r.country_code) }} · {{ lbl(r.religion) }}</span>
          </div>
        </template>
        <div v-else class="rd-empty">{{ (tStatic('dashboard.no_match') || 'No people groups match “{q}”.').replace('{q}', q.trim()) }}</div>
      </div>
    </div>
    <span class="rd-align" role="button" tabindex="0" data-align-btn
          :title="L('align_dashboard_tip', 'Reset the dashboard layout to its default alignment')"
          @click="onAlignLayout" @keydown.enter.prevent="onAlignLayout" @keydown.space.prevent="onAlignLayout">
      ⤢ {{ L('align_dashboard', 'Align Dashboard') }}
    </span>
    <!-- CSV export MOVED to the people-groups table header (DashboardDataTable), below the map —
         card BUILD-CSV-EXPORT-MOVE-TO-TABLE-HEADER-ALL-FIELDS. It exports THAT table, so it now
         lives on that table's header bar, which stays docked even when the table is collapsed. -->
    <!-- HEADER BUTTONS (design rule, 2026-09-30): a rounded-square ⓘ to the LEFT of a rounded-square Share.
         DOM order [ⓘ, Share] gives ⓘ at the logical START — left in English, and RIGHT of Share in
         Arabic, because this flex row reverses its main axis under dir=rtl. Both are the SAME reusable
         header-button form, shape="rounded-square" (radius = the vertical tabs' --vtl-radius).
         SHARE the WHOLE dashboard: one share button gives the embed for a partner site. Reuses the SAME ShareButton the upg-100 MFE ships (no hand-rolled
         variant); the embed path is THIS profile's tree-relative leaf, which ShareButton joins to the
         served tree root. The ⓘ reuses MapInfoButton — it renders ONLY once the tab's MapInfo answers
         (fail-open: no host, no ⓘ, same as before), so a standalone leaf with no gallery is unchanged. -->
    <div class="rd-header-btns" data-header-btns>
      <MapInfoButton shape="rounded-square" />
      <ShareButton :embed-path="SHARE_EMBED_PATH" shape="rounded-square" />
    </div>
  </header>
</template>
