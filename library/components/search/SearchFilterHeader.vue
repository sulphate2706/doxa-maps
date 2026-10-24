<script setup>
import { useOptionalT } from '@map/composables/useOptionalT.js'
/**
 * SearchFilterHeader.vue — SHARED (@map/components/search/SearchFilterHeader.vue).
 *
 * The DX-life research-page filter header, cloned as ONE parameterized, reusable element:
 *   header-1 = a search bar   (the SearchBar primitive)
 *   header-2 = an "expand filters" dropdown SET (a row of FilterDropdown primitives) plus
 *              optional boolean toggle-buttons (Adopted / Engaged / Exact …) and a live
 *              removable active-filter chip strip.
 *
 * Cloned (COPY-ONLY, never imported) from the DX-life research page's UupgsList.vue filter
 * block (root-dx-life/.../components/public/UupgsList.vue) — the search box + "Show/Hide
 * Filters" toggle + the FilterDropdown panel + the toggle-button panel + the active-chips
 * strip. It reuses the already-shared SearchBar + FilterDropdown primitives so there is ONE
 * source of truth for the controls; this element only ADDS the header composition + the
 * expand/collapse + the one-row horizontal-scroll layout.
 *
 * FULLY props-driven / emit-based / framework-agnostic (no Nuxt, no i18n composable, no
 * fetch, no bus, no plugin hardcoding). The consumer supplies the option lists + selected
 * values and reacts to the emits — so the SAME header drives the people-groups-grid, the
 * big-picture, AND the research-dashboard. The dashboard couples it to its selection bus via
 * a thin adapter (DashboardResearchFilters.vue); the grid drives its in-memory Fuse filter;
 * big-picture forwards to its cap-2 grid. None of that lives here.
 *
 * ── ★ ONE-ROW HORIZONTAL SCROLL (card BUILD-DROPDOWNS-HORIZONTAL-SCROLL-ONE-ROW) ──
 * The dropdown set is a SINGLE flex row that NEVER wraps — on overflow it scrolls
 * horizontally (overflow-x:auto; flex-wrap:nowrap). Each FilterDropdown is flex:0 0 auto so
 * it keeps its width instead of shrinking into a second line.
 *
 * ── API ────────────────────────────────────────────────────────────────────────
 * Props:
 *   search        String  ''  — the search-bar value (supports `v-model:search`).
 *   filters       Array   []  — the dropdown axes, ONE object per dropdown:
 *                                 { name, label, options:[{value,label,count?}], value?, placeholder? }
 *   toggles       Array   []  — boolean toggle-buttons: { name, label, active? }
 *   activeChips   Array   []  — removable active-filter chips: { name, label }
 *                                (when omitted the header derives chips from filters+toggles).
 *   searchPlaceholder String 'Search…'
 *   searchMaxWidth    String '520px' — max-width of the header-1 search box.
 *   showSearch    Boolean|String true — render the header-1 search row at all. Set false when
 *                                the consumer hosts the search bar elsewhere (e.g. the research-
 *                                dashboard lifts it into the topbar) so this header is FILTERS-ONLY.
 *   showFilters   Boolean|String true — render the header-2 filter row at all.
 *   startExpanded Boolean false — show the dropdown row without a first click.
 *   collapsible   Boolean true  — show the Show/Hide-Filters toggle; false = always open.
 *   labels        Object {}  — i18n overrides: { show_filters, hide_filters, clear_all,
 *                                                type_to_search, filters }
 * Emits:
 *   update:search String                     — new search value (enables v-model:search).
 *   search        { value }                  — on every keystroke (raw string).
 *   filter-change { name, value, label, type }  — a dropdown option was picked.
 *   filter-clear  { name }                    — a dropdown selection was cleared.
 *   toggle        { name, active }            — a boolean toggle flipped.
 *   remove-filter { name }                    — an active chip's ✕ was clicked.
 *   clear-all                                 — the "Clear all" chip was clicked.
 */
import { ref, computed } from 'vue'
import SearchBar from './SearchBar.vue'
import FilterDropdown from './FilterDropdown.vue'

const props = defineProps({
  search: { type: String, default: '' },
  filters: { type: Array, default: () => [] },
  toggles: { type: Array, default: () => [] },
  activeChips: { type: Array, default: null },
  searchPlaceholder: { type: String, default: 'Search…' },
  searchMaxWidth: { type: String, default: '520px' },
  showSearch: { type: [Boolean, String], default: true },
  showFilters: { type: [Boolean, String], default: true },
  startExpanded: { type: Boolean, default: false },
  collapsible: { type: Boolean, default: true },
  labels: { type: Object, default: () => ({}) },
})

const emit = defineEmits([
  'update:search', 'search', 'filter-change', 'filter-clear', 'toggle', 'remove-filter', 'clear-all',
])

const truthy = (v) => !(v === false || v === 'false' || v === '0' || v === 0)
const useSearch = computed(() => truthy(props.showSearch))
const useFilters = computed(() => truthy(props.showFilters))

// ★ THESE DEFAULTS WERE THE LAST ENGLISH IN THE HEADER. They are the fallbacks a host that passes
// no `labels` gets — which is every host — so in ar/zh/ru/hi the filter row, its aria label, the
// chip remove buttons and the "World" empty state all read English above translated content.
// The catalogue answers first now; a host's own labels still win, which is what the prop is for.
// Through the host's vue-i18n when it installed one: its t() reads the locale ref, so this computed
// re-runs on a mid-session language switch. tStatic reads a plain global the computed cannot track,
// which left all eight labels in the boot language (check:frozen-labels).
const tr = useOptionalT('')
const T = (key, en) => { const v = tr(key); return v && v !== key ? v : en }
const L = computed(() => ({
  show_filters: T('grid.show_filters', 'Show Filters'),
  hide_filters: T('grid.hide_filters', 'Hide Filters'),
  clear_all: T('grid.clear_all', 'Clear All'),
  type_to_search: T('grid.type_to_search', 'Type to search...'),
  filters: T('dashboard.filters', 'Filters'),
  selected: T('dashboard.selected', 'Selected'),
  world: T('dashboard.world', 'World'),
  remove: T('dashboard.remove_filter', 'Remove'),
  ...props.labels,
}))

// The dropdown row is collapsed by default (DX-life behaviour) unless startExpanded /
// non-collapsible — then it's always open.
const expanded = ref(props.startExpanded || !props.collapsible)
function toggleExpanded() { expanded.value = !expanded.value }
// When the search row is hidden the Show/Hide-Filters toggle is gone too, so the dropdown row
// can only be reached if it stays open — force it open in that case.
const isOpen = computed(() => !props.collapsible || !useSearch.value || expanded.value)

// Chips: consumer-supplied, else derived from the selected dropdowns + active toggles so a
// standalone consumer gets a working removable chip strip for free.
const chips = computed(() => {
  if (Array.isArray(props.activeChips)) return props.activeChips
  const out = []
  for (const f of props.filters) {
    if (!f.value) continue
    const opt = (f.options || []).find(o => o.value === f.value)
    out.push({ name: f.name, label: opt ? opt.label : f.value })
  }
  for (const t of props.toggles) {
    if (t.active) out.push({ name: t.name, label: t.label })
  }
  return out
})

function onSearch(payload) {
  const value = payload?.value ?? ''
  emit('update:search', value)
  emit('search', { value })
}
function onFilterChange(detail) { emit('filter-change', detail) }
function onFilterClear(detail) { emit('filter-clear', detail) }
function onToggle(t) { emit('toggle', { name: t.name, active: !t.active }) }
function onRemoveChip(name) { emit('remove-filter', { name }) }
function onClearAll() { emit('clear-all') }
</script>

<template>
  <div class="sfh">
    <!-- header-1: the search bar (omitted when the consumer hosts search elsewhere) -->
    <div v-if="useSearch" class="sfh__search-row">
      <SearchBar
        :model-value="search"
        :placeholder="searchPlaceholder"
        :aria-label="searchPlaceholder"
        :max-width="searchMaxWidth"
        @search="onSearch"
      />
      <button
        v-if="useFilters && collapsible"
        class="sfh__toggle"
        type="button"
        :aria-expanded="isOpen"
        @click="toggleExpanded"
      >
        {{ isOpen ? L.hide_filters : L.show_filters }}
        <svg class="sfh__toggle-chev" width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <!-- header-2: the expand-filters dropdown SET — ONE row, horizontal-scroll on overflow -->
    <div v-if="useFilters && isOpen" class="sfh__filters-row" role="group" :aria-label="L.filters">
      <FilterDropdown
        v-for="f in filters"
        :key="f.name"
        class="sfh__dd"
        :label="f.label"
        :name="f.name"
        :options="f.options || []"
        :value="f.value || ''"
        :placeholder="f.placeholder || L.type_to_search"
        @filter-change="onFilterChange"
        @filter-clear="onFilterClear"
      />
      <button
        v-for="t in toggles"
        :key="t.name"
        class="sfh__pill"
        type="button"
        :data-active="t.active ? '' : undefined"
        @click="onToggle(t)"
      >{{ t.label }}</button>
    </div>

    <!-- ★ THE SELECTIONS ROW IS PERMANENT — it must never leave the DOM.
         This was v-if="useFilters && chips.length", so the row DISAPPEARED whenever nothing was
         selected. That is the actual bug, and it is layout shift rather than chip placement:
         deselecting removed the row's height, so the ENTIRE LOWER APP SHIFTED UPWARD, which is very
         hard to track with the eyes.
         A row that appears on select and vanishes on clear moves the map, the table and the grid on
         every single click. The row now always renders and only its CONTENTS change, so nothing below
         it can move.
         The empty state is "World", and it reads correctly: no filter really
         does mean the whole world is in scope. Clear-all is omitted rather than the row collapsing,
         because there is nothing to clear; the row keeps its height either way. -->
    <!-- ★ CLEAR ALL TRAVELS WITH THE CHIPS — it is the LAST CHILD OF THE SCROLL STRIP
         (card BUILD-CLEAR-ALL-SITS-BESIDE-THE-SELECTIONS-NOT-FAR-RIGHT).
         The Clear All button should look polished, and it belongs right next to the
         selections, not at the far right.

         THIS DELIBERATELY REVERSES the previous instruction (kept below for the record, because
         the reasoning was sound and someone will be tempted to re-apply it): Clear All used to be
         a SIBLING pinned outside the strip so it stayed reachable while the chips scrolled —
         "even if you have so many options selected that you need the scroll bar activated
         horizontally, you still need to be able to see the Clear All button." That pinning is what
         MEASURED as gap(last chip -> Clear All) = -164.72px: the button sat at x=1512 while the
         chips ran on to 1676 UNDERNEATH it. Reachable, yes — but detached from the thing it acts
         on, and overlapping it.
         The newer instruction wins. Do not re-pin it; if the reachability concern returns, the
         answer is to keep the strip from overflowing (fewer/narrower chips), not to re-separate
         the button from its subject. -->
    <div v-if="useFilters" class="sfh__chips" :class="{ 'is-empty': !chips.length }">
      <div class="sfh__chip-strip">
        <span class="sfh__sel-label">{{ L.selected || 'Selected' }}</span>
        <template v-if="chips.length">
          <span v-for="c in chips" :key="c.name" class="sfh__chip">
            {{ c.label }}
            <button class="sfh__chip-x" type="button" :aria-label="`${L.remove} ${c.label}`" @click="onRemoveChip(c.name)">&times;</button>
          </span>
          <button class="sfh__clear" type="button" @click="onClearAll">{{ L.clear_all }}</button>
        </template>
        <span v-else class="sfh__sel-world">{{ L.world || 'World' }}</span>
      </div>
    </div>
  </div>
</template>

<style>
/* Self-contained + scoped so the header self-styles inside a standalone custom-element
   shadow root (mirrors the SearchBar / FilterDropdown primitives).
   DX-life material LIGHT palette. --brand/--ink/… are this header's semantic aliases (the
   original DX-life CUBE names); they RESOLVE to the --dx-* tokens rather than carrying
   their own colour, so the fallback keeps this self-styling standalone while a consumer's
   :host tokens win when embedded. Do not re-resolve to literals. */
.sfh {
  --brand: var(--dx-accent, #92b195); --ink: var(--dx-text, #3b463d); --mut: var(--dx-muted, #6d766e);
  --line: var(--dx-line, #d1d4cd); --card: var(--dx-elevated, #fff);
  /* ★ SOURCE 1 OF THE THREE HEIGHT SOURCES — "decreasing the height of the white space
     underneath the filters" (card BUILD-SELECTED-ROW-MUCH-THINNER-AND-CENTRED). 10px -> 6px.
     This gap is what sits BETWEEN the filters row and the selections row, so it reads as the
     white space under the filters even though no element owns it. That is why it was easy to
     miss when only the row's own height was being hunted.
     ★ 6px -> 4px on the second pass. The first pass took 10 -> 6 and the band still measured 67px,
     because the gap was never the dominant term — the TRIGGER's 30px was (see FilterDropdown's
     --dx-filter-pad-y note). With the trigger finally trimmed, this 2px is the last of the
     inter-row air and is worth taking together with it rather than alone. */
  display: flex; flex-direction: column; gap: var(--dx-sfh-gap, 4px); width: 100%; box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color: var(--ink);
}
/* ★ THE SEARCH BAR IS BAND 1 OF THE CENTRED STACK, so it centres like the rest
   (card BUILD-THE-FOUR-HEADERS-ARE-ONE-CENTRED-STACK: "the search input CENTRED in the page,
   not left-justified").
   The Show/Hide-Filters toggle is a SIBLING in this row, so a naive centring would centre the
   PAIR and leave the input itself off-centre by half the toggle's width. The input is centred
   instead by giving the row three parts: a flexible spacer, the box, and the toggle balanced by
   an equal spacer. Simpler and more robust than absolute positioning (which is what the
   dashboard's topbar has to do, because there the search shares a row with a title it cannot
   measure): here the header owns both children, so plain flow can do it.
   Consumers that hide the search (the research-dashboard passes :show-search="false" and hosts
   it in the topbar) are unaffected — this row is not rendered at all for them. */
.sfh__search-row { display: flex; align-items: center; gap: 12px; justify-content: center; }
.sfh__search-row > :first-child { flex: 0 1 auto; }
.sfh__toggle {
  flex: 0 0 auto; background: none; border: none; cursor: pointer; font-size: 0.875rem;
  color: var(--ink); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; padding: 4px 2px;
  text-decoration: underline; text-decoration-color: var(--brand); text-underline-offset: 4px;
}
.sfh__toggle-chev { transition: transform 200ms ease; }
.sfh__toggle[aria-expanded="true"] .sfh__toggle-chev { transform: rotate(180deg); }

/* ★ ONE ROW, NEVER WRAP — horizontal-scroll on overflow.
   NOTE the missing `overflow-y: visible`: it was there, and it was a LIE. CSS Overflow §3
   coerces a `visible` axis to `auto` whenever the other axis is not visible, so
   `overflow-x:auto; overflow-y:visible` COMPUTES to `overflow: auto auto` — a vertical clip
   that reads, in source, as the exact opposite. That clip is what ate the open FilterDropdown
   menu (card BUG-FILTER-DROPDOWN-HIDDEN-BEHIND-EVERYTHING-ZINDEX); measured live, ~248px of a
   281px menu was never painted. Writing only `overflow-x` is honest about what the box does.
   This row therefore still clips vertically ON PURPOSE (it must, to scroll horizontally) —
   which is why FilterDropdown's menu is position:FIXED and escapes the clip chain entirely
   rather than trying to out-z-index it. Do not "restore" an overflow-y here; it cannot work. */
/* ★ CENTRED AS A GROUP, EVENLY SPACED (card BUILD-THE-FOUR-HEADERS-ARE-ONE-CENTRED-STACK).
   Evenly spaced, so that everything is centred rather than justified left.

   MEASURED BEFORE at 1600x900 standalone: the triggers started 14px from the left edge and ended
   242px from the right — a quarter-screen of dead space on one side only, which is precisely what
   "justified left" looks like in numbers.

   justify-content:center is the whole fix, and it is SAFE HERE ONLY BECAUSE of the overflow rule
   below it. On an overflowing flex row `justify-content:center` is the classic trap: it centres
   the content by pushing the first item to a NEGATIVE offset, which is unreachable because a
   scroll container cannot scroll left of zero — the first dropdown would be permanently cut off.
   `justify-content: safe center` is the guard: it degrades to flex-start exactly when centring
   would overflow, so the row is centred while it fits and left-aligned (fully scrollable) once it
   does not. The BEFORE run measured the studio host already overflowing (right gutter -40), so
   this is a live case here, not a hypothetical.
   The unprefixed fallback is listed first for engines without `safe` — they get plain centring,
   which is the pre-existing behaviour for the fitting case and no worse for the other. */
/* ★ THE SLACK GOES BETWEEN THE TRIGGERS, NOT INTO TWO EDGE VOIDS
   (card BUILD-CENTRE-THE-SEARCH-BAR-AND-SPREAD-THE-FILTER-TOGGLES). The filter dropdown
   toggles are centred too, so that they FILL THE FULL WIDTH of the second header, equally
   spaced.

   MEASURED at 1600x900 standalone BEFORE this change: the row is 1572px wide and its content is
   6 triggers x 168px + 5 gaps x 10px = 1058px — so scrollWidth (1572) == clientWidth (1572),
   `overflowing: false`, with 514px of slack. Centring alone therefore parks ~257px of dead space
   at EACH edge, which is what "not filling the width" looks like in numbers. The row is NOT
   overflowing at desktop width, so the reported horizontal scrollbar is a
   narrow-viewport artifact, not the desktop case.

   `space-between` would push the first and last triggers hard against the edges, breaking the
   --rd-edge gutter the stack's alignment depends on. `space-evenly` is the one that distributes
   the slack into EQUAL gaps including the two end gaps — the triggers stay inside the band's
   padding and the run reads as one evenly-spaced group. Equal spacing is literally the ask.

   ★ THE OVERFLOW GUARD IS PRESERVED, and it is why the fallback chain is three deep rather than
   one line. On an OVERFLOWING scroll container every distributed justify-content value has the
   same defect as plain `center`: it pushes the first item to a negative offset that a scroller
   can never reach (it cannot scroll left of zero), permanently clipping the first dropdown.
   `safe` degrades exactly that case to flex-start. So:
     1. `space-evenly`      — engines without `safe`: distributed, matching prior centring risk.
     2. `safe space-evenly` — distributed while it fits, flex-start (fully scrollable) once not.
   The studio host was measured overflowing once already (right gutter -40), so this is a live
   case, not a hypothetical — do not simplify this to a single unguarded value. */
/* ★ WRAP, DO NOT SCROLL (2026-09-23). This row was flex-wrap:nowrap + overflow-x:auto — a
   horizontal SCROLLER. The constraint is explicit: no horizontal scrollbar in the filter section;
   everything resizes and everything stays visible.
   MEASURED with the eighth dropdown (engagement/Status) added: the dropdowns are a fixed 168px on a
   200px pitch, so eight need ~1428px. At a 1440 viewport that just fits (maxRight 1428); at 1280 it
   did not, and sfh__filters-row reported scrollWidth 1414 against clientWidth 1252 — a scrollbar,
   exactly what was asked not to be shown.
   Wrapping is the right lever rather than shrinking the dropdowns: their fixed 168px width is itself
   a product decision (filters not so wide), and a flexible width was what made them jump as a
   selection changed. So the row now flows onto a second line when it must.
   ★ AND START THE WRAPPED LINE ON THE SAME LEFT EDGE (2026-09-23). `space-evenly` was kept here
   when wrapping landed, on the reasoning that `safe` made it harmless. That reasoning was about a
   SCROLLER — a single line that could push its first item to a negative offset — and it does not
   survive wrapping: space-evenly distributes EACH LINE independently, so a final line holding one
   orphan centres that orphan under the seven above it.
   MEASURED at three viewports on the shipped dashboard, line-2 left edge vs line-1:
       1440px   line1 x=36   line2 x=636   — 600px adrift
       1280px   line1 x=16   line2 x=556   — 540px adrift
       1024px   line1 x=33   line2 x=132   —  99px adrift
   A lone centred "Status" control under a left-aligned row does not read as a layout decision, it
   reads as a bug — which is the bar this is held to. flex-start keeps every line on one edge, so a
   wrapped row looks like a grid at any width. The `safe` keyword is dropped with it: it exists to
   rescue centred/space-* distributions from negative offsets, and flex-start cannot produce one. */
.sfh__filters-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--dx-filter-gap, 10px);
  justify-content: flex-start;
  overflow-x: clip; padding-bottom: 2px;
  scrollbar-width: thin; -webkit-overflow-scrolling: touch;
}
/* keep each control at its width instead of collapsing into a 2nd line.
   The primitive now fixes its OWN width (--dx-filter-w), so this no longer has to fight it — it
   only has to stop the flex row from shrinking it, which flex-shrink:0 does. */
.sfh__dd { flex: 0 0 auto; }
.sfh__filters-row::-webkit-scrollbar { height: 8px; }
/* --dx-scroll-thumb is a DELIBERATE neutral, not a sage: it must read between line and
   muted on both white and surface, which a sage tint does not do (matches research-dashboard). */
.sfh__filters-row::-webkit-scrollbar-thumb { background: var(--dx-scroll-thumb, #c4c8c0); border-radius: 8px; }
.sfh__filters-row::-webkit-scrollbar-track { background: transparent; }

.sfh__pill {
  flex: 0 0 auto; padding: 6px 12px; cursor: pointer; font-size: 0.875rem; color: inherit;
  background: var(--card); border: 1px solid var(--line); border-radius: 8px; white-space: nowrap;
  transition: border-color 150ms ease, background 150ms ease;
}
.sfh__pill:hover { border-color: var(--brand); }
.sfh__pill[data-active] { background-color: var(--dx-accent-weak, rgba(146, 177, 149, .18)); border-color: var(--brand); color: var(--ink); }

/* ★ FIXED HEIGHT IS THE WHOLE POINT — this row must be the same size empty or full, or everything
   below it jumps on every click. min-height pins it; nowrap keeps a long selection on ONE line rather
   than growing to a second (flex-wrap was the other way this row could change height).
   ★ min-height MUST be >= the tallest child, or it stops being a floor and the CHIP drives the
   height instead. Measured that failure here once already: at min-height:22px the empty row was 22px
   and the chipped row 24.25px, walking the map 180 -> 182.25px — the exact layout shift this row
   exists to prevent, reintroduced by a floor set too low. So the floor and the chip's own box are
   set TOGETHER, every time either moves.

   ★ 18px, AND THE OLD 24px MEASUREMENT IS NOT EVIDENCE IT WAS RIGHT
   (card BUILD-SELECTED-ROW-MUCH-THINNER-AND-CENTRED). Asked twice in one message: the selected
   row was far too tall, and needed to be a lot thinner and a lot more subtle.
   A previous fix asserted rowH=24 identical across empty / one-chip / many-chip states and cited it
   as done. That measurement was TRUE and it proved the row does not RESIZE — it never said a word
   about whether 24 is the right number, which is a different question, a product one. The
   answer came back: still too tall. Do not re-cite a stability measurement as a
   sizing one.
   He named THREE height sources, so all three come down together — reducing only the row would
   have been the same partial fix again:
     1. the white space UNDER the filters -> .sfh gap 10 -> 6, .sfh__filters-row padding-bottom 4 -> 2
     2. the selected section itself       -> this min-height 24 -> 18
     3. the CHIP BUTTONS                  -> .sfh__chip height 22 -> 18, font 0.9375rem -> 0.8125rem
   --dx-sel-row-h keeps the floor tokenized so a consumer can trade density back without forking.

   ★ CENTRED: justify-content:center, because the selections sit directly above the map, centred
   right above the globe.
   ★ THE ROW ITSELF STILL DOES NOT SCROLL. overflow-x lives on .sfh__chip-strip. That split is now
   doing a different job than when it was introduced (it was there to pin Clear All OUTSIDE the
   scroller; Clear All has since moved INSIDE, per its own card) — it is kept because a scroll box
   cannot also be the thing that centres its overflowing content, and because overflow here would
   re-eat the fixed FilterDropdown menu. Do not put overflow back on this element. */
/* ★ 18px -> 16px, AND THE CHIP MOVES WITH IT (the two values are equal BY CONSTRUCTION — see the
   .sfh__chip note; a floor below the chip's own box stops being a floor and the chip drives the
   height instead, which is the layout shift this row exists to prevent). 16px is the floor for a
   0.75rem/12px glyph in a border-box chip with 1px borders: 12 + 2 border + 2 leading. Going
   below it would clip the descenders rather than slim the row. */
.sfh__chips { display: flex; flex-wrap: nowrap; gap: 6px; align-items: center;
  justify-content: center;
  min-height: var(--dx-sel-row-h, 16px); }
/* ★ THE ONLY SCROLLING ZONE. min-width:0 is REQUIRED, not decorative: a flex item defaults to
   min-width:auto, which floors it at its CONTENT width, so the strip would refuse to shrink and
   would widen the row instead of scrolling inside itself.
   ★ flex is now `0 1 auto`, not `1 1 auto`. Growing was only needed while Clear All sat OUTSIDE
   as a pinned sibling — the strip had to eat all the free space to shove it to the far right.
   That is the layout that was just reversed, so the growth term goes with it: at 0 1 auto the
   strip is only as wide as its chips (shrinking to fit when they overflow), which is what lets
   .sfh__chips centre it as a group rather than centring a full-width box that merely CONTAINS
   left-aligned chips. Keeping flex-grow here would have silently defeated the centring above.
   ★ safe center for the same reason as the filters row: once the chips overflow, plain centring
   would push the first chip to a negative, unscrollable offset.
   overflow-y is omitted deliberately (see the .sfh__filters-row note): a visible y-axis computes
   to auto next to a non-visible x-axis, so naming it would clip nothing and mislead the reader. */
.sfh__chip-strip {
  flex: 0 1 auto; min-width: 0; display: flex; flex-wrap: nowrap; gap: 6px; align-items: center;
  justify-content: center; justify-content: safe center;
  overflow-x: auto; scrollbar-width: thin; -webkit-overflow-scrolling: touch;
}
.sfh__chip-strip::-webkit-scrollbar { height: 6px; }
.sfh__chip-strip::-webkit-scrollbar-thumb { background: var(--dx-scroll-thumb, #c4c8c0); border-radius: 8px; }
.sfh__chip-strip::-webkit-scrollbar-track { background: transparent; }
/* The persistent prefix. flex:0 0 auto so it never shrinks away and the row always starts the same
   way, which is what makes the strip scannable at a glance.
   It moved INSIDE .sfh__chip-strip so it is part of the group being centred — left outside it, it
   would have been a fixed-width item that the centring had to work around, pushing the chips
   off-centre by its own width. It scrolls with the chips now, which is the same trade Clear All
   makes and for the same reason: the label describes the chips, so it belongs with them.
   0.6875rem + subtler colour: this is a LABEL, not content — the row is to read a lot more
   subtly, and shrinking the all-caps prefix is the cheapest way to drop the row's
   visual weight without touching the chips' legibility. */
.sfh__sel-label { flex: 0 0 auto; font-size: 0.6875rem; font-weight: 700; letter-spacing: .5px;
  text-transform: uppercase; color: var(--mut, #6d766e); opacity: .75; }
/* The empty state. Muted rather than hidden: "World" is real information (nothing is filtered), and
   rendering it keeps the row's content box occupied so the height cannot collapse. Tracks the chip
   type size so the empty and full states read at the same weight. */
.sfh__sel-world { flex: 0 0 auto; font-size: 0.75rem; color: var(--mut, #6d766e); }
/* ★ SOURCE 3 OF THE THREE HEIGHT SOURCES — "the size of the buttons that show up whenever you
   select something." 22px -> 18px, and the type comes DOWN with it (0.9375rem -> 0.8125rem).
   NOTE THIS REVERSES AN EARLIER, CORRECTLY-FOLLOWED INSTRUCTION. A previous round was told
   "increase the font slightly of the selected row", and did: 0.85rem -> 0.9375rem. The whole row
   is now to be a lot more subtle, and at 18px a 0.9375rem glyph does not
   fit its box. The newer instruction wins; this is not a regression of the older one.
   white-space:nowrap keeps a two-word label on one line — a wrapped chip would grow the row and
   re-break the fixed-height invariant.
   ★ height + border-box is what makes that invariant STRUCTURAL rather than lucky: without it the
   chip's height is a computed sum of font-size x line-height + padding + border, so a token change
   or a glyph with taller metrics could silently push past the row's floor and reopen the layout
   shift. Pinning the box means the floor (18px, above) is provably the maximum. The two numbers
   are EQUAL on purpose and must be changed together. */
.sfh__chip {
  flex: 0 0 auto; display: inline-flex; gap: 4px; align-items: center;
  background-color: var(--dx-accent-weak, rgba(146, 177, 149, .18));
  color: var(--ink); border: 1px solid var(--line); border-radius: 100px;
  padding: 0 8px; font-size: 0.75rem; line-height: 1; white-space: nowrap;
  height: var(--dx-sel-row-h, 16px); box-sizing: border-box;
}
.sfh__chip-x { background: none; border: none; cursor: pointer; font-size: 1.05em; line-height: 1; color: inherit; padding: 0; display: inline-flex; align-items: center;
  /* ★ A 24px TARGET THAT COSTS ZERO LAYOUT (WCAG 2.5.8).
     MEASURED: the chip's box is pinned to --dx-sel-row-h (16px) and this button carries padding:0,
     so the only way to remove a filter was a roughly 13x16px glyph. That is the smallest control in
     the product, and it is the ONLY way out of a narrowed board — the one place where a miss costs
     the user the whole view.
     THE ROW HEIGHT IS NOT NEGOTIABLE and must not be touched here: the three comment blocks above
     record a measured layout-shift bug (18px vs a 24.25px chipped row walking the map 180 -> 182.25px)
     and the "a lot more subtle" instruction that set 16px. Growing the button would reopen
     both.
     So the HIT AREA grows and the BOX does not. An absolutely-positioned ::after centred on the
     button claims 24x24 of pointer/touch surface while contributing nothing to the flex row's
     intrinsic size — the chip stays 16px tall, the strip's fixed-height invariant holds, and
     nothing moves by a pixel. position:relative scopes the overlay to this button.
     2.5.8 is a TARGET SIZE criterion, not a touch criterion, so this is unconditional — never
     behind @media (pointer: coarse). The overlay is transparent and inert to the eye. */
  position: relative; }
.sfh__chip-x::after { content: ''; position: absolute; left: 50%; top: 50%;
  width: 24px; height: 24px; transform: translate(-50%, -50%); }
.sfh__chip-x:hover { opacity: 0.7; }
/* The chips sit inside an overflow-x strip, so a focused ✕ must be visibly ringed rather than
   merely scrolled into view. :focus-visible, not :focus — a mouse click focuses the button too, and
   a ring that outlives every click reads as a state the chip does not have. */
.sfh__chip-x:focus-visible { outline: 2px solid var(--brand, #1a237e); outline-offset: 1px; border-radius: 2px; }
/* ★ THE LAST CHIP'S NEIGHBOUR, NOT A PINNED CONTROL
   (card BUILD-CLEAR-ALL-SITS-BESIDE-THE-SELECTIONS-NOT-FAR-RIGHT — "right next to the selected
   stuff", and "fancy Nancy", i.e. it should look like a light touch, not a button).
   It is now the strip's last child, so it inherits the strip's gap and simply follows the chips.
   THE LEFT BORDER IS GONE with the pinning that justified it: that rule read "separates it from a
   strip that may be mid-scroll UNDERNEATH" — there is no underneath any more, and a divider
   between a chip and the button that clears it would now draw a boundary where the relationship
   is the point. The extra left padding goes for the same reason.
   Type tracks the chips (0.8125rem) so it sits on the same baseline as its neighbours rather than
   out-shouting them. */
.sfh__clear {
  flex: 0 0 auto; white-space: nowrap; background: none; border: none; cursor: pointer;
  font-size: 0.75rem; line-height: 1; color: var(--mut, #6d766e); text-decoration: underline;
  text-decoration-color: var(--brand); text-underline-offset: 3px;
  padding: 0 4px; margin-inline-start: 2px;
}
.sfh__clear:hover { color: var(--ink); }
/* Reduced motion: this component's styles do not go through useShadowStyles, so it carries its own guard
   (check:shadow-reduced-motion). */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
</style>
