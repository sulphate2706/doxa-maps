<script setup>
/**
 * DashboardFilterChips — the live filterSet rendered as removable AND-stacked chips
 * (Islam ✕ | South Asia ✕ | …) + Clear all. The chip bar IS the live query state and is what CSV
 * export reads later. Click delegation on the bar, which is what makes it defineCustomElement-safe.
 *
 * ── KIT LANDING 4c-2: MOVED HERE FROM plugin-designs/research-dashboard/ ──────────────────────
 * Nothing about the rendering changed. What made the move possible was landing 4b, which inverted
 * the one dependency that blocked it: this file used to import useTreeLegendLabels — the People
 * CODE → NAME tables, which are research-specific and STAY in plugin-designs — and a library
 * component importing a plugin composable is exactly what check:no-cross-plugin-imports refuses.
 * Now the resolver arrives on dashboardConfig.legend and this file needs no research anything.
 *
 * ★ AN EXPLICIT EXCEPTION TO library/components/WARNING.md, recorded so the next reader does not
 * think the rule was missed. That file says a component graduates into the library only once MORE
 * THAN ONE map uses it. This one is used by ZERO: the topbar dedup pass unmounted it when
 * SearchFilterHeader became the single source of truth for showing and clearing filters, and it has
 * stayed unmounted deliberately. It is here because the kit's promise runs the other way round — a
 * NEW dashboard mounts kit components, so waiting for a second consumer before providing the first
 * one is a deadlock. The honest consequence: its passing gate means "it mounts and degrades", not
 * "it looks right", and nobody has SEEN it since the dedup. Anyone wiring it into a dashboard should
 * expect to be its first real reader, and must not mount it alongside a SearchFilterHeader that is
 * already showing chips — two chip rows over one filterSet is the bug the dedup removed.
 */
import { inject, computed } from 'vue'
import { tStatic, formatList } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it.
const T = (key, en) => tStatic(key) || en
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
// No research label import (kit landing 4b) — the shell supplies it on dashboardConfig.legend.

const bus = inject('selectionBus', null)
const cfg = inject('dashboardConfig', {})
// `dataStore` and `searchSourceId` were injected here ONLY to construct useTreeLegendLabels, and
// landing 4b removed that construction. They are gone rather than left harmlessly in place: an
// unused inject is a claim about the host, and a kit component that appears to need a research
// dataStore is one a new dashboard will dutifully provide before finding out it was never read.
const filterSet = bus?.filterSet || {}

// ── People codes must not reach this chip ────────────────────────────────────────────────────
// The People facets key by CODE (dashboard.config.js:54-57), so a chip built straight off the
// stored value read 'Affinity Bloc:A012' — the user clicked "South Asian Peoples" and got back an
// opaque identifier. labelFor() is the SAME projection the rail uses, so the two can never drift.
// DISPLAY ONLY: `k` (the facet key) and the stored filterSet value are never rewritten — the bus
// matches the accessor's output byte-for-byte, and a chip that merely looked right while the
// table stopped responding would be a worse bug than the one being fixed.
// ★ THE UNCONFIGURED DEFAULT JOINS A LIST, because a filterSet value is an ARRAY once two values
// are selected (spec D1) and 4b's fallback returned it untouched — so `String(value)` printed
// "A012,A013", comma-jammed, while a dashboard that DID supply a resolver got "South Asian Peoples,
// Bengali Peoples". Configured and unconfigured should differ in whether CODES RESOLVE, never in
// punctuation: the second difference reads as a rendering bug rather than as missing configuration.
// Kept as one liftable expression on purpose — check:legend-mirrors pulls it out of this source and
// drives it, so "no resolver yields the raw value" is measured instead of asserted.
// Several values on ONE facet are ALTERNATIVES: the selection bus matches with includes(), so adding a value
// widens the result. 'or' in the reader's language says that; a bare comma read as ALL to most people.
const labelFor = (facet, value) => (cfg?.legend?.labelFor ? cfg.legend.labelFor(facet, value) : (Array.isArray(value) ? formatList(value, { type: 'disjunction' }) : value))
const chips = computed(() => Object.entries(filterSet).map(([k, v]) => ({
  k,
  text: String(labelFor(k, v)),
  facet: cfg.facets?.[k]?.label || k,
})))

function onClick(e) {
  const el = e.target && e.target.closest && e.target.closest('[data-chip]')
  if (!el || !bus) return
  const k = el.getAttribute('data-chip')
  if (k === '__all__') bus.clearFilters(); else bus.setFilter(k, null)
}

// ── ★ THE CHIP IS A BUTTON, AND THAT IS THE WHOLE KEYBOARD FIX ─────────────────────────────────
// These were <span data-chip> with click delegation on the bar. A span is not focusable, has no
// role, and fires no click from Enter or Space — so a filter that could be SET from the keyboard
// (the tree rail's rows and the dropdowns are both operable) could NOT BE CLEARED from the
// keyboard. That asymmetry is the defect: a keyboard user could walk themselves into a filtered
// view with no way out except reloading the page.
//
// A <button type="button"> fixes it with NO new handler, because the browser already synthesises a
// click for Enter and Space on a button. The existing delegation (closest('[data-chip]')) keeps
// working byte-for-byte — which is the point: adding a @keydown here would have created a SECOND
// activation path that can disagree with the click path, and the bar's one-listener design is
// deliberate (it is defineCustomElement-safe).
//
// `type="button"` is not decoration. A bare <button> inside a form defaults to type="submit"; a
// partner page that embeds this element inside its own form would have had every chip submit it.
//
// THE ACCESSIBLE NAME must say what the press DOES, not what the chip shows. The visible text is
// "Religion: Islam"; announced alone that is a label, not an action, so a screen-reader user hears
// the filter but not that pressing removes it. `title` is NOT an accessible name (this repo's
// check:a11y-button-names exists for exactly that confusion), so the name is an aria-label.
const removeLabel = (c) => T('aria.removeFilter', 'Remove filter {name}').replace('{name}', c.facet + ': ' + c.text)

useShadowStyles(`
  /* BOUNDED so the chips never slide under the centred search bar (BUG-SELECTION-CHIPS-UNDER-SEARCHBAR).
     MEASURED live at 1440x900 before the fix: search x 540..900, first chip x 482..718 — ~178px of
     overlap, which is why the chips rendered badly under the top search bar.
     WHY THE CHIPS MOVE AND NOT THE SEARCH: DashboardTopBar deliberately absolute-centres the search
     (left:50% + translateX(-50%)) so its centre stays fixed "regardless of the left (title/breadcrumb/
     chips) or right content widths" — a flow-based margin:auto would drift as chips grow. It also
     sits ON TOP of the row. So the search is not the thing to move.
     THE BUDGET: the search is width:360px, max-width:min(360px,42%), centred — so its left edge is at
     50% - min(180px, 21%). The chip strip starts after the brand/breadcrumb and must STOP SHORT of
     that edge. min(180px,21%) + a 14px gutter gives the max-width below; 34% is the conservative
     floor for narrow viewports where the 42% clamp binds instead of the 360px one.
     nowrap + the per-chip cap keeps the bar at 52px. A second header row is ruled out, repeatedly
     and firmly, so growing the bar is not an option. Overflowing chips scroll horizontally
     and every truncated label keeps its full text in a title tooltip. */
  /* NO max-width here ON PURPOSE. The bound lives ONCE, on .rd-left in DashboardTopBar (which wraps
     brand + breadcrumb + chips together). I briefly had a second cap here and it was both redundant
     and a hazard: two mechanisms constraining the same axis interact, and the outer one is the only
     one that can be correct — measured, the chips' natural width (297px) is already under any sane
     cap, while the brand (248px) + breadcrumb (196px) push the chips' START past the search's left
     edge. Capping width cannot fix a start position. */
  .rd-chips{ display:flex; align-items:center; gap:6px; flex-wrap:nowrap; min-width:0;
    overflow-x:auto; overflow-y:hidden; scrollbar-width:none; }
  .rd-chips::-webkit-scrollbar{ height:0; width:0; }
  /* A <button> does NOT inherit the host's font, resets margin to the UA's, and paints a UA
     background/appearance — so every one of those is restated here. Without font-family:inherit the
     chips would silently drop to the UA default face while every other chip-like control in the
     dashboard kept the app font: the keyboard fix would have arrived as a typography regression.
     text-align + margin:0 cover the other two UA defaults a span never had. */
  .rd-chip{ display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px;
    background:#fff; color:#1a1a2e; border:1px solid #e67e22; cursor:pointer; line-height:1.2;
    font-family:inherit; margin:0; text-align:left; -webkit-appearance:none; appearance:none;
    /* WCAG 2.5.8 is a TARGET SIZE criterion, not a touch criterion — so the 24px floor belongs at
       EVERY width, never behind @media (pointer:coarse). Measured before: 11px text x 1.2 + 6px
       padding + 2px border = ~21px. The bar is 52px and the chips are centred in it, so the 3px
       costs no layout; the font size is untouched. */
    min-height:24px;
    flex:0 0 auto; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  /* :focus-visible, not :focus — a MOUSE click on a button focuses it, and a permanent ring after
     every click would read as a selection state the chip does not have. The offset keeps the ring
     off the 1px orange border so the two do not merge into one muddy edge. */
  .rd-chip:focus-visible{ outline:2px solid #1a237e; outline-offset:2px; }
  /* the label span is what actually truncates; the facet prefix and the x stay readable */
  .rd-chip .rd-chip-val{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .rd-chip .fc{ opacity:.55; font-weight:500; flex:0 0 auto; } .rd-chip i{ font-style:normal; opacity:.6; font-size:12px; flex:0 0 auto; }
  .rd-chip:hover{ background:#fff4ea; } .rd-chip:hover i{ opacity:1; }
  .rd-chip.rd-clear{ border-color:var(--dx-line, #d1d4cd); color:var(--dx-muted, #6d766e); } .rd-chip.rd-clear:hover{ background:var(--dx-surface, #f3f3f1); }
`, 'rd-chips')
</script>

<template>
  <div v-if="chips.length" class="rd-chips" data-chips-bar @click="onClick">
    <!-- :title carries the FULL "Facet: Value" even when the chip truncates, so a long People or
         Language label (some run 40+ chars) stays readable on hover rather than being lost to the
         ellipsis. The value lives in its own span because that is the only part that should shrink:
         the facet prefix and the ✕ affordance must stay legible at every width. -->
    <button v-for="c in chips" :key="c.k" type="button" class="rd-chip" :data-chip="c.k" data-filter-chip
            :title="c.facet + ': ' + c.text" :aria-label="removeLabel(c)">
      <span class="fc">{{ c.facet }}:</span><span class="rd-chip-val">{{ c.text }}</span> <i aria-hidden="true">✕</i>
    </button>
    <!-- ★ REUSES controls.reset_all rather than adding a second key. This chip clears every
         filter, which is the same action that button names, and two keys for one action is how
         a control ends up saying two different things in two languages. The English shifts from
         "Clear all" to "Reset all" — a deliberate consequence of having one name for one thing. -->
    <!-- No aria-label: this one has VISIBLE TEXT, and visible text IS the accessible name. Adding
         an aria-label would OVERRIDE it, which is how a control ends up announced as something
         other than what it reads as — and it would break voice control, where the user says the
         words they can see. -->
    <button type="button" class="rd-chip rd-clear" data-chip="__all__">{{ T('controls.reset_all', 'Reset all') }}</button>
  </div>
</template>
