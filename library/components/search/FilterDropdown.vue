<script setup>
/**
 * FilterDropdown.vue — SHARED (@map/components/search/FilterDropdown.vue).
 *
 * A searchable single-select dropdown with per-option counts. Fully props-driven,
 * emit-based, framework-agnostic (no Nuxt context, no i18n composables, no plugin
 * hardcoding) — so BOTH the cap-2 people-groups-grid AND the cap-1 Unified Research
 * Dashboard (big-picture) consume the SAME component instead of keeping local copies.
 *
 * Derived from DX-life (research-map-clean/app/components/public/FilterDropdown.vue),
 * Lit-derived Vue component. The SCSS the DX-life app kept in a shared _filters.scss
 * is inlined here (scoped to this element) so the dropdown styles itself when it ships
 * inside a standalone custom element / shadow root.
 *
 * ── API ────────────────────────────────────────────────────────────────────────
 * Props:
 *   label       String (required)  — control label, e.g. "Region".
 *   name        String (required)  — the axis/field key echoed back in emitted events.
 *   options     Array   []         — [{ value, label, count?, type? }] to choose from.
 *   value       String  ''         — the currently-selected option value (controlled).
 *   placeholder String  'Type to search...' — the in-menu search input placeholder.
 * Emits:
 *   filter-change { name, value, label, type }  — an option was picked.
 *   filter-clear  { name }                       — the selection was cleared.
 */
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { useOptionalT } from '@map/composables/useOptionalT.js'

const props = defineProps({
  label: { type: String, required: true },
  name: { type: String, required: true },
  options: { type: Array, default: () => [] },
  value: { type: String, default: '' },
  placeholder: { type: String, default: 'Type to search...' },
})

// ★ THIS COMPONENT HAD NO t() AT ALL, on a dropdown that every localised surface renders. Its
// two visible strings — the clear button and the empty state — were English literals, and one of
// them ('No options found') was ALREADY catalogued in eleven locales elsewhere in this repo, so
// the translation existed and this component was ignoring it.
//
// ★ i18n IS OPTIONAL HERE, NOT REQUIRED. useI18n() THROWS ("Need to install with `app.use`
// function") when the host element never installed vue-i18n — and people-groups-grid deliberately
// doesn't (its labels arrive through its `t` prop). The unguarded call blanked the grid standalone,
// in the studio and inside every composite that nests it (measured 2026-09-25: 2 DOM nodes, page
// error on mount). Use the host's translations when it has them, English otherwise.
const FALLBACK = { 'buttons.clearSelection': 'Clear selection', 'buttons.noOptions': 'No options found' }
// C4: the guard is library/composables/useOptionalT.js now; FALLBACK is passed in unchanged, so the
// grid that this component once blanked renders exactly the same strings.
const t = useOptionalT('', { fallback: (key) => FALLBACK[key] })

const emit = defineEmits(['filter-change', 'filter-clear'])

const isOpen = ref(false)
const searchText = ref('')
const highlightedIndex = ref(-1)
const rootRef = ref(null)
const searchInputRef = ref(null)
const triggerRef = ref(null)

/**
 * ── ★ WHY THE MENU IS position:fixed AND NOT JUST A BIGGER z-index ──
 * (card BUG-FILTER-DROPDOWN-HIDDEN-BEHIND-EVERYTHING-ZINDEX)
 *
 * MEASURED, not guessed: the menu's parent row (.sfh__filters-row in SearchFilterHeader)
 * is the one-row horizontal scroller. It authors `overflow-x:auto; overflow-y:visible`,
 * but CSS Overflow §3 COERCES a `visible` axis to `auto` when the other axis is not
 * visible — so it computes to `overflow: auto auto` and CLIPS VERTICALLY. Live probe at
 * 1440x900: the row's content box ended at y=95 while the open menu wanted y=62..343, so
 * ~248px of the menu was never painted. A deep (shadow-piercing) hit test below y=95 hit
 * .rd-stats and the facet rail — i.e. the content BEHIND the menu — because the menu did
 * not exist there at all.
 *
 * Raising z-index CANNOT fix that, and a previous fix that raised the band to z-index:55
 * changed nothing: clipping happens during PAINTING, before stacking order is consulted.
 * You cannot re-order pixels that were never generated. (z-index:55 was already winning
 * the stacking fight it was sent to fight — which is why the bug survived that "fix".)
 *
 * position:fixed re-parents the menu to the VIEWPORT's containing block, which also takes
 * it out of the scroller's clip chain. That is the whole fix; the accompanying high
 * z-index only preserves paint order once the menu is free. No ancestor here sets
 * transform/filter/perspective (the properties that WOULD capture a fixed descendant),
 * verified live across the chain up to <html>, so this is safe in the shadow-root/custom-
 * element embedding all three consumers use.
 *
 * Because fixed coords are viewport-relative they go stale when anything scrolls or
 * resizes, so they are recomputed on open and on scroll/resize while open.
 */
const menuStyle = ref({})

/**
 * ── ★ A `fixed` MENU IS ONLY VIEWPORT-ANCHORED IF NOTHING CAPTURES IT ──
 * (card BUG-FILTER-DROPDOWN-DETACHED-FROM-ITS-TRIGGER, reopened after a wrong close)
 *
 * position:fixed resolves against the viewport ONLY while no ancestor establishes a containing
 * block for fixed descendants. transform, filter, perspective, backdrop-filter, will-change on
 * any of those, and `contain` with paint/layout/strict/content ALL do establish one. When any is
 * present the viewport coordinates below are applied relative to THAT ancestor instead, and the
 * menu lands offset by exactly the ancestor's own position.
 *
 * MEASURED, not theorised. library/layouts/VerticalTabsLayout.vue — the cap-5 shell that hosts
 * every plugin as a tab — sets `contain: layout paint` on .vtl-content, which sits inside
 * `.vtl-main { left: 256px }`. Live probe at 1600x900 inside plugin-studio, dashboard-plus-grid
 * tab: every trigger read dLeft=256 dTop=111, with the ancestor walk naming the culprit
 * `div.vtl-content [contain:layout paint]`. The same dropdowns in the STANDALONE dashboard read
 * dLeft=0 dTop=4. Same component, same CSS, two hosts, opposite results — which is why a probe
 * that only ever measured the standalone composite passed six times while the SPA kept showing the
 * menu in what looked like a random spot, further down and to the right. It was never
 * random: it was the rail width plus the header height, exactly.
 *
 * ★ WHY NOT JUST DROP `contain` FROM THE LAYOUT. It is load-bearing there for a different reason
 * (it stops a rail collapse from reflowing a heavy mounted map), and removing it would trade this
 * bug for that one. Two locally-correct decisions composed into a globally-wrong result; the fix
 * belongs where the assumption lives, not where the containment does.
 *
 * So: do not ASSUME the containing block is the viewport — MEASURE it. offsetParent-style walking
 * is unreliable through shadow roots, so we read the offset from a probe element that is itself
 * position:fixed at 0,0: whatever it reports as its own client rect IS the origin this menu's
 * fixed coordinates will be measured from. Subtracting that origin makes the placement correct in
 * EVERY host — including hosts that do not exist yet, which is the point of putting it here rather
 * than special-casing VerticalTabsLayout.
 */
function fixedOrigin(el) {
  const doc = el.ownerDocument
  const probe = doc.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;opacity:0'
  // Insert INSIDE the same root as the menu so it shares the menu's ancestor chain (and therefore
  // its containing block). A probe appended to document.body would report the viewport even when
  // the menu is captured — it would confirm the assumption instead of testing it.
  const host = el.parentElement || el.getRootNode().body || doc.body
  host.appendChild(probe)
  const r = probe.getBoundingClientRect()
  probe.remove()
  return { x: r.left, y: r.top }
}

function positionMenu() {
  const t = triggerRef.value
  if (!t) return
  const r = t.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const MENU_MAX = 320
  const GAP = 4
  const EDGE = 8

  // ── ★ HORIZONTAL PLACEMENT IS ANCHOR-PRESERVING, NOT A BARE CLAMP ──
  // (card BUG-FILTER-DROPDOWN-DETACHED-FROM-ITS-TRIGGER)
  //
  // A previous version clamped left into the viewport unconditionally:
  //   left = min(max(r.left, EDGE), vw - width - EDGE)
  // which is correct only while the trigger is comfortably inside the viewport. MEASURED at
  // 900x800, where .sfh__filters-row overflows (scrollWidth 1010 > clientWidth 872): the
  // "Religion" trigger sits at x=864 with the menu clamped to x=732 — dLeft = -132, so the
  // menu opened underneath its NEIGHBOUR "Language". Scrolled fully right, "People" sits at
  // x=-124 and its menu clamped to x=8 — dLeft = +132, the same defect mirrored. dTop stayed
  // 4 in every case and no ancestor creates a containing block, so the anchor was never
  // stale and never captured: the CLAMP ITSELF was overwriting a correct anchor. A menu
  // parked under the wrong trigger is what "disconnected from the filter box" means.
  //
  // So: prefer left-aligned to the trigger; if that overflows the right edge, RIGHT-align to
  // the trigger's right edge (the standard popover flip — still visibly attached, because it
  // shares an edge with its trigger). Only when the trigger itself is off-viewport — where
  // no edge-sharing placement is reachable — fall back to the hard clamp, since an
  // unreachable menu is worse than a detached one. That last case cannot mislead: the
  // trigger is not on screen to look detached FROM.
  // ── ★ THE MENU IS NOT THE TRIGGER'S WIDTH (card BUILD-SLIM-FILTERS-NARROW-TRIGGER-WIDE-MENU) ──
  // The filters are very NARROW, and the dropdown menu that opens can be as wide as it needs to
  // be, so MORE OF THEM FIT ON ONE ROW WITHOUT WORD WRAPPING.
  //
  // THE COUPLING THAT MADE THAT IMPOSSIBLE was this one line: the menu was `min(r.width, …)` — the
  // TRIGGER's measured width. The two boxes have OPPOSITE constraints and were sharing one number:
  //   - the CLOSED TRIGGER competes for a shared row, so every px it takes is a px another axis
  //     cannot have; it should be as small as its label allows.
  //   - the OPEN MENU is transient and overlays everything (position:fixed, z-index above the
  //     world), so its width costs the layout NOTHING — no sibling reflows around it.
  // Sizing them together meant narrowing the trigger also narrowed the menu, truncating the option
  // labels that are the whole reason a narrow trigger is acceptable. So they are separated here.
  //
  // The menu is therefore max(trigger, MENU_MIN) and still capped to the viewport. It is a FLOOR,
  // not a fixed size: a trigger WIDER than the floor (a consumer that raised --dx-filter-w) keeps
  // the old edge-matched look, so this cannot regress a host that was already happy.
  const MENU_MIN = 240
  const width = Math.round(Math.min(Math.max(r.width, MENU_MIN), vw - EDGE * 2))
  const triggerOnScreen = r.right > EDGE && r.left < vw - EDGE
  let left
  if (!triggerOnScreen) {
    left = Math.round(Math.min(Math.max(r.left, EDGE), vw - width - EDGE))
  } else if (r.left + width > vw - EDGE) {
    left = Math.round(Math.max(r.right - width, EDGE))   // right-align to the trigger
  } else {
    left = Math.round(Math.max(r.left, EDGE))            // left-align to the trigger
  }

  // Flip above the trigger when there is not enough room below (keeps the list usable in
  // a short band near the bottom of the viewport).
  const below = vh - r.bottom
  const flipUp = below < 180 && r.top > below

  // ── ★ TRANSLATE VIEWPORT COORDS INTO THE REAL CONTAINING BLOCK ──
  // Everything above is computed in viewport space, which is the right space to REASON in (edges,
  // flips and overflow are all viewport facts). But the values are written to a fixed element whose
  // origin may not be the viewport. `o` is that origin, measured live; when nothing captures the
  // menu it is {0,0} and every number below is unchanged, so the standalone behaviour that already
  // measured dLeft=0 dTop=4 is preserved bit-for-bit.
  const o = fixedOrigin(t)
  const L = Math.round(left - o.x)
  menuStyle.value = flipUp
    ? { top: 'auto', bottom: `${Math.round(vh - r.top + GAP + o.y)}px`, left: `${L}px`, width: `${width}px`, maxHeight: `${Math.round(Math.min(MENU_MAX, r.top - GAP - EDGE))}px` }
    : { top: `${Math.round(r.bottom + GAP - o.y)}px`, bottom: 'auto', left: `${L}px`, width: `${width}px`, maxHeight: `${Math.round(Math.min(MENU_MAX, below - GAP - EDGE))}px` }
}

// `true` = capture phase, so this also sees scrolls inside the dashboard's inner scroll
// regions (they do not bubble to window).
function onReflow() { if (isOpen.value) positionMenu() }

const filteredOptions = computed(() => {
  if (!searchText.value) return props.options
  const search = searchText.value.toLowerCase()
  return props.options.filter(o => o.label.toLowerCase().includes(search))
})

const selectedOption = computed(() => props.options.find(o => o.value === props.value))

function onClickOutside(e) {
  const path = e.composedPath?.() ?? []
  if (rootRef.value && !path.includes(rootRef.value)) close()
}

function toggle() { isOpen.value ? close() : open() }

function open() {
  isOpen.value = true
  searchText.value = ''
  highlightedIndex.value = -1
  positionMenu()
  document.addEventListener('click', onClickOutside)
  window.addEventListener('scroll', onReflow, true)
  window.addEventListener('resize', onReflow)
  nextTick(() => { positionMenu(); searchInputRef.value?.focus() })
}

function close() {
  isOpen.value = false
  searchText.value = ''
  highlightedIndex.value = -1
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener('scroll', onReflow, true)
  window.removeEventListener('resize', onReflow)
}

function onSearchInput(e) {
  searchText.value = e.target.value
  highlightedIndex.value = -1
}

function onKeydown(e) {
  const options = filteredOptions.value
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      highlightedIndex.value = Math.min(highlightedIndex.value + 1, options.length - 1)
      scrollHighlightedIntoView()
      break
    case 'ArrowUp':
      e.preventDefault()
      highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0)
      scrollHighlightedIntoView()
      break
    case 'Enter': {
      e.preventDefault()
      const option = options[highlightedIndex.value]
      if (option) select(option)
      break
    }
    case 'Escape':
      e.preventDefault()
      close()
      break
  }
}

function scrollHighlightedIntoView() {
  nextTick(() => {
    const highlighted = rootRef.value?.querySelector('.filter-dropdown__option[data-highlighted]')
    highlighted?.scrollIntoView({ block: 'nearest' })
  })
}

function select(option) {
  emit('filter-change', { name: props.name, value: option.value, label: option.label, type: option.type })
  close()
}

function clear() {
  emit('filter-clear', { name: props.name })
  close()
}

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener('scroll', onReflow, true)
  window.removeEventListener('resize', onReflow)
})
</script>

<template>
  <div ref="rootRef" class="filter-dropdown" :class="{ 'is-open': isOpen }">
    <button
      ref="triggerRef"
      class="filter-dropdown__trigger input"
      :data-active="value ? '' : undefined"
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <span class="filter-dropdown__label">
        <template v-if="selectedOption">{{ label }}: <strong>{{ selectedOption.label }}</strong></template>
        <template v-else>{{ label }}</template>
      </span>
      <svg class="filter-dropdown__chevron" width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <div v-if="isOpen" class="filter-dropdown__menu" role="listbox" :style="menuStyle">
      <input
        ref="searchInputRef"
        class="filter-dropdown__search"
        type="text"
        :value="searchText"
        :placeholder="placeholder"
        @input="onSearchInput"
        @keydown="onKeydown"
      >
      <button v-if="value" class="filter-dropdown__clear" type="button" @click="clear">{{ t('buttons.clearSelection') }}</button>
      <div class="filter-dropdown__options">
        <template v-if="filteredOptions.length === 0">
          <div class="filter-dropdown__no-options">{{ t('buttons.noOptions') }}</div>
        </template>
        <template v-else>
          <div
            v-for="(option, index) in filteredOptions"
            :key="option.value"
            class="filter-dropdown__option"
            role="option"
            :data-highlighted="index === highlightedIndex ? '' : undefined"
            :data-selected="option.value === value ? '' : undefined"
            :aria-selected="option.value === value"
            @click="select(option)"
            @mouseenter="highlightedIndex = index"
          >
            <span>{{ option.label }}</span>
            <span class="filter-dropdown__count">{{ option.count }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style>
/* Inlined from DX-life blocks/_filters.scss (dropdown portion).
   DX-life material LIGHT palette, in var(--dx-token, #fallback) form: the FALLBACK keeps
   this element self-styling in a bare shadow root (the original goal), while the TOKEN
   wins whenever a consumer defines it at :host. Custom properties inherit THROUGH shadow
   boundaries, so cap-2, cap-4 and the dashboard header all theme this from their own
   :host block. Do not re-resolve these to literals — that is what made them disagree.
   Selected/active states tint with the accent but keep --dx-text for the LABEL: sage on
   white is ~1.9:1, so the accent carries the STATE and the ink carries the WORD. */
/* ── ★ THE TRIGGER IS A FIXED BOX — IT MUST NOT GROW ON SELECTION ──
   (card BUILD-FILTERS-FIXED-WIDTH-ELLIPSIS-NOT-GROWING)

   Selecting something from the dropdown must not make the filter wider: the filter stays the
   same width and truncates with an ellipsis instead.

   MEASURED BEFORE, in BOTH hosts (standalone leaf + cap-5 studio shell), 1600x900:
     empty : [160, 160, 160, 160, 160, 160]  total 960
     full  : [240, 240, 240, 184, 171, 219]  total 1294
   i.e. every trigger resized to its own content, and the row grew by 334px. The old rule was
   `min-width:160px; max-width:240px; flex:1 1 160px` — a RANGE, not a width. Three separate
   things let the box track its content:
     - flex-basis:160px is only a STARTING size; `flex-grow:1` then hands out free space,
     - max-width:240px caps but does not FIX (that is the 240,240,240 clamping above),
     - and the label `Region: <strong>North America & …</strong>` changes the content width the
       moment an option is picked, so the negotiation restarts with a different input.
   A width that is negotiated from content can only ever be content-shaped. So the fix is not a
   tighter range — it is to stop negotiating: ONE fixed width, and the label ellipsises inside it.

   WHY THIS IS NOT COSMETIC. The selections row sits UNDERNEATH this one. A trigger that grows
   reflows the row below it, so the centred stack could not hold still even
   once it was centred. Fixing the width here is what makes the alignment above it STRUCTURAL.

   --dx-filter-w is a TOKEN, not a literal, for the same reason every colour here is: this
   component is shared by people-groups-grid, big-picture AND the research-dashboard, so a
   consumer that needs a different trigger size sets the token at :host instead of forking the
   component. 168px was sized to an earlier brief — "just big enough to express the first or
   second word".

   ── ★ 168px -> 128px: THE TRIGGER AND THE MENU ARE SIZED SEPARATELY NOW ──
   (card BUILD-SLIM-FILTERS-NARROW-TRIGGER-WIDE-MENU) Asked four times: the filters were far too
   wide. Very NARROW filters fit MORE OF THEM ON ONE ROW WITHOUT WORD WRAPPING, and that in turn
   lets the headers get thinner.

   The trigger no longer has to carry the SELECTED VALUE legibly, because positionMenu() now floors
   the open menu at 240px independent of this width (see its MENU_MIN note). That is what unlocks
   the narrowing: the full value is always readable in the menu, so the closed trigger only has to
   carry the AXIS NAME plus an ellipsis hint — which is all a reader uses it for.

   128px IS MEASURED, NOT PICKED — and the first number tried (116px) was measured WRONG, which is
   why the measurement is recorded here rather than the conclusion alone. The chrome budget is:
   2px border + 16px horizontal padding (2 x --dx-filter-pad-x, trimmed 12 -> 8 with this card) +
   6px gap + 12px chevron = 36px. So a 128px trigger leaves 92px for text.

   Every axis label rendered at 0.875rem/system-ui and measured live:
     Bloc 29.8 · Status 44.6 · Prayer 45.2 · People 46.5 · Region 47.9 · Country 55.6 ·
     Religion 55.7 · Language 69.1 · Engagement 89.3
   116px was chosen first, on the reasoning that "Language" (69.1) was the longest of the SEVEN
   CURRENTLY SHIPPED and fit its 80px budget with room to spare. That was true and still wrong:
   this component is SHARED, and this file's own history records an eighth "engagement/Status" axis
   that has been present before. At 89.3px "Engagement" overflowed the 116px budget by 9.3px — the
   axis NAME would have ellipsised, which is the one truncation that must never happen (a trigger
   reading "Engageme…" is unscannable, and unlike a truncated VALUE it has no menu to recover it).
   128px fits the longest KNOWN label with 2.7px to spare and is still a 24% cut from 168px.

   The floor is a TYPE metric: it moves only if the labels or the font do — and the font is not
   allowed to move (below). If an axis longer than "Engagement" is ever added, re-measure rather
   than letting it truncate.

   ★ THE FONT-SIZE IS NOT A LEVER: shrinking it has been rejected twice, because text too small to
   read is not an option. Width, padding and TRIGGER-label truncation are the only tools; 0.875rem
   on .filter-dropdown__trigger is load-bearing and must not be traded for density. */
.filter-dropdown { position: relative; flex: 0 0 auto;
  width: var(--dx-filter-w, 128px); min-width: var(--dx-filter-w, 128px); max-width: var(--dx-filter-w, 128px); }
/* Mobile keeps the SAME fixed-box contract — only the number shrinks. The old rule here was
   `flex:1 1 100%`, which full-widthed the trigger and wrapped the row; that is the growth bug in
   its most extreme form, so it cannot come back as a "mobile exception". */
@media (max-width: 576px) { .filter-dropdown {
  width: var(--dx-filter-w-sm, 108px); min-width: var(--dx-filter-w-sm, 108px); max-width: var(--dx-filter-w-sm, 108px); } }
/* ★ THE TRIGGER'S HEIGHT IS THE FILTER ROW'S HEIGHT, and it was the last unattributed term
   (card BUILD-SELECTED-ROW-MUCH-THINNER-AND-CENTRED — "the filter row is way too thick").
   MEASURED at 1600x900 standalone, the filters band's 67px decomposes with nothing left over:
     band 67 = band padding 10 (5+5) + sfh 56
     sfh  56 = filters row 32 + sfh gap 6 + selections row 18
     row  32 = trigger 30 + row padding-bottom 2
     trigger 30 = padding 12 (6+6) + border 2 (1+1) + a 16px line box at 0.875rem
   Three of those four terms had already been trimmed in earlier rounds (the gap 10->6, the band
   padding 8->5, the selections row 24->18). The trigger was never touched, and at 30px it is the
   single largest contributor — which is why the band kept measuring ~67 no matter how much was
   shaved off the others. Vertical padding 6 -> 4 takes the trigger to 26 and the band to 63.
   ★ THE HORIZONTAL PADDING IS NOW A LEVER TOO — 12px -> 8px, and the earlier "must stay" note it
   replaces was over-stated (card BUILD-SLIM-FILTERS-NARROW-TRIGGER-WIDE-MENU). That note said
   touching it "would move a gate", having read check:filter-width as asserting a literal 168px.
   It does not: the gate records every trigger's width with nothing selected and requires the SAME
   widths after selecting the longest option — it asserts STABILITY, not a number. A uniform
   narrowing moves both arrays together and the gate stays green (verified by running it).
   The 8px is spent where it is worth most: it is 8px of the 72px text budget handed back to the
   axis label, which is what lets the trigger reach 116px without clipping "Language".
   Tokenized for the same reason as the width — a consumer trades density back without forking. */
.filter-dropdown__trigger {
  width: 100%; padding: var(--dx-filter-pad-y, 4px) var(--dx-filter-pad-x, 8px); cursor: pointer; display: flex; justify-content: space-between;
  /* Pairs its own foreground with its own background for the same reason as the menu:
     `color: inherit` over a light background rendered near-white-on-white inside the
     cap-4 dark header. Background and text are set together, never half-inherited. */
  align-items: center; gap: 6px; font-size: 0.875rem; color: var(--dx-text, #3b463d); text-align: start;
  background: var(--dx-elevated, #fff); border: 1px solid var(--dx-line, #d1d4cd); border-radius: 8px; transition: border-color 150ms ease;
}
.filter-dropdown__trigger:hover { border-color: var(--dx-accent, #92b195); }
.filter-dropdown__trigger[data-active] { background-color: var(--dx-accent-weak, rgba(146, 177, 149, .18)); border-color: var(--dx-accent, #92b195); }
/* ★ min-width:0 IS WHAT MAKES THE ELLIPSIS FIRE. text-overflow only takes effect once the box is
   actually narrower than its text, and a flex item defaults to min-width:auto — floored at its
   MIN-CONTENT width — so without this the label refuses to shrink and pushes the (now fixed)
   trigger's content past its box instead of truncating. The ellipsis rules were already here and
   were doing nothing for exactly this reason; the growth was happening one level up.
   flex:1 1 auto lets the label take the room the chevron does not, so the truncation point sits
   right before the chevron rather than at an arbitrary width. */
.filter-dropdown__label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-dropdown__chevron { flex-shrink: 0; transition: transform 200ms ease; }
.filter-dropdown.is-open .filter-dropdown__chevron { transform: rotate(180deg); }
.filter-dropdown__menu {
  /* ★ The menu is a LIGHT popover that can open inside a DARK header (cap-4 big-picture).
     It must declare its own foreground instead of inheriting: the dark header passes down
     a near-white colour, which on this white surface measured ~1.2:1 — invisible option
     labels. A popover never inherits text colour across a light/dark boundary. */
  /* ★ position:FIXED, not absolute — see the long note in <script setup>. An absolute menu
     is clipped away by the filters row's computed `overflow:auto auto`; no z-index can
     recover pixels that were never painted. Fixed escapes that clip chain; the z-index
     below only keeps paint order once it is free. Coordinates (top/left/width/max-height)
     are set inline by positionMenu() because a fixed box is viewport-relative. */
  position: fixed; z-index: 2147483000; background-color: var(--dx-elevated, #fff);
  color: var(--dx-text, #3b463d);
  border: 1px solid var(--dx-line, #d1d4cd); border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12); overflow: hidden;
  display: flex; flex-direction: column; min-width: 160px;
}
.filter-dropdown__search {
  border: none; border-bottom: 1px solid var(--dx-line, #d1d4cd); border-radius: 0; padding: 6px 12px; width: 100%;
  font-size: 0.875rem; color: var(--dx-text, #3b463d); background: var(--dx-elevated, #fff); outline: none; box-sizing: border-box;
}
.filter-dropdown__search::placeholder { color: var(--dx-muted, #6d766e); }
.filter-dropdown__clear {
  display: block; width: 100%; background: none; border: none; border-bottom: 1px solid var(--dx-line, #d1d4cd);
  padding: 6px 12px; font-size: 0.875rem; color: var(--dx-text, #3b463d); cursor: pointer; text-align: start;
  text-decoration: underline; text-decoration-color: var(--dx-accent, #92b195); text-underline-offset: 3px;
}
.filter-dropdown__clear:hover { background-color: var(--dx-accent-weak, rgba(146, 177, 149, .18)); }
/* flex:1 1 auto + min-height:0 so the list is what shrinks when positionMenu() caps the
   menu's height to the room actually available below (or above) the trigger — the search
   box and Clear row stay pinned and reachable instead of being pushed out of view. */
.filter-dropdown__options { flex: 1 1 auto; min-height: 0; max-height: 250px; overflow-y: auto; }
.filter-dropdown__search, .filter-dropdown__clear { flex: 0 0 auto; }
.filter-dropdown__option {
  padding: 5px 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;
  font-size: 0.875rem; transition: background-color 100ms ease;
}
/* Selected reads by WEIGHT + an accent bar, not by hue: a sage text colour would be the
   least readable row in the menu, which is the opposite of what "selected" should do. */
.filter-dropdown__option[data-selected] { font-weight: 700; color: var(--dx-text, #3b463d); box-shadow: inset 3px 0 0 var(--dx-accent, #92b195); }
.filter-dropdown__option:hover,
.filter-dropdown__option[data-highlighted] { background-color: var(--dx-accent-weak, rgba(146, 177, 149, .18)); }
.filter-dropdown__count { color: var(--dx-muted, #6d766e); font-size: 0.75rem; margin-inline-start: 6px; }
.filter-dropdown__no-options { padding: 12px; font-size: 0.875rem; color: var(--dx-muted, #6d766e); text-align: center; }
/* Reduced motion: this component's styles do not go through useShadowStyles, so it carries its own guard
   (check:shadow-reduced-motion). */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
</style>
