<script setup>
import { religionFamilyLabel } from '@map/colors/religion.js'
import { WAGF_REGIONS } from '@map/colors/wagf-region.js'
import countryName, { iso3ForEnglishName } from '@map/utils/countryName.js'
import { tStatic, getRuntimeLocale } from '@map/i18n/index.js'
/**
 * ChartsRail — RDASH phase 5: cross-filtered charts rail. Religion donut + Region donut (doxa-region
 * palette) + Top-country bar, all re-aggregating on filterSet and brushable back into it (click a
 * slice/bar -> setFilter -> filter chip -> table+charts narrow). Hand-rolled SVG (0-dep, shadow-safe),
 * click via delegation on the stable container (per-element @click is unreliable in a virtualized/
 * patched defineCustomElement tree). Tweens via CSS (bar width + slice opacity).
 */
import { inject, computed, ref } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { buildDonut, buildBars, buildCountryRegionColors } from '../../composables/useDashboardAggregations.js'
import { aggregate, lbl, OTHER_KEY, otherLabel } from '@map/composables/useFacetAggregation.js'
import { buildSearchAccessors, makeSearchMatcher, filterRowsBySearch } from '@map/composables/useDashboardSearch.js'

/**
 * ── THE RAIL'S TAB STRIP ──────────────────────────────────────────────────────────────────────
 * Charts is selected by default, which is the wording: "Charts will be a SELECTED TAB
 * that will show the charts."
 *
 * ★ GOSPEL RESOURCES SHIPS DISABLED, NOT HIDDEN, and that is a deliberate choice rather than a
 * placeholder. Its content is not a separate dataset panel — it is the SAME
 * facet breakdown re-measured on a different axis ("people groups by their gospel resources
 * availability"), and three decisions about that data are still open: the official lostness number,
 * whether to stay key-less or register a Joshua Project key, and the UI shape. Guessing any of them
 * would ship a wrong picture that looks right, which is this codebase's most expensive failure mode.
 *
 * A HIDDEN tab is indistinguishable from an unbuilt one. A disabled tab carrying its reason in the
 * title attribute tells the reader exactly what it is waiting on, every time he looks at the rail —
 * which is worth more than the tab being invisible until it is perfect.
 *
 * `tabs` is a plain array rather than config-driven on purpose: there are two of them and one is a
 * stub. Making it configurable now would be an abstraction over a single real case.
 */
const tabs = [
  { id: 'charts', get label() { return tStatic('dashboard.charts') || 'Charts' } },
  {
    id: 'gospel',
    get label() { return tStatic('dashboard.gospel_resources') || 'Gospel Resources' },
    disabled: true,
    get why() { return tStatic('dashboard.gospel_pending') || 'Not ready yet: the lostness figure, the data-source key and the layout are still being decided.' },
  },
]
const activeTab = ref('charts')

const dash = inject('dashboardData', null)
const bus = inject('selectionBus', null)
const cfg = inject('dashboardConfig', {})
const filterSet = bus?.filterSet || {}
const FACET_ACC = Object.fromEntries(Object.entries(cfg.facets || {}).map(([k, f]) => [k, f.get]))
// Crossfilter rule: aggregate each chart over rows filtered by all OTHER active facets EXCEPT its
// own — so filtering a chart by its own facet does NOT collapse it to a single slice. Mirrors the
// `rowsExcluding([facet])` pattern in DashboardFacetRail.vue.
const matchSearch = makeSearchMatcher(bus, buildSearchAccessors(cfg))
function rowsExcluding(exclude) {
  const rows = dash?.rows?.value || []
  const keys = Object.keys(filterSet).filter((k) => !exclude.includes(k))
  const hasText = !!(bus?.searchTerm?.value || '').trim()
  if (!keys.length && !hasText) return rows
  const faceted = rows.filter((r) => bus.rowMatchesFilters(r, FACET_ACC))
  return filterRowsBySearch(faceted, matchSearch)
}

// COUNTRY -> REGION hue ("countries should match the colour of their regions").
// A country has no palette of its own, so the Top-countries bar inherits the hue of its
// MAJORITY region — the same hex the Region donut and the map legend use for that region.
// Computed off the FULL row store (not the cross-filtered set) so a country keeps one stable
// colour no matter what is filtered; a colour that moved with the filter is precisely the
// defect this whole change removes.
const countryRegionColors = computed(() => {
  const countryAcc = cfg.facets?.country_code?.get
  const regionAcc = cfg.facets?.wagf_region?.get
  if (!countryAcc || !regionAcc) return null
  return buildCountryRegionColors(dash?.rows?.value || [], countryAcc, regionAcc)
})

const charts = computed(() => (cfg.charts || []).map((c) => {
  const acc = cfg.facets?.[c.facet]?.get || ((r) => lbl(r[c.facet]))
  // Exclude this chart's own facet so it keeps ALL its slices while highlighting the active one.
  const agg = aggregate(rowsExcluding([c.facet]), acc, c.topN)
  // Colour is now keyed by FACET + VALUE (registry palettes), never by slice index.
  const overrides = c.facet === 'country_code' ? countryRegionColors.value : null
  return {
    id: c.id,
    type: c.type,
    facet: c.facet,
    title: c.title,
    geometry: c.type === 'bar'
      ? buildBars(agg, c.facet, overrides)
      : buildDonut(agg, 132, 0.58, c.facet, overrides),
  }
}))
const isActive = (facet, key) => bus.isFilterActive(facet, key)
// Display-only projection for a facet VALUE. Only the religion family axis has values that were
// derived in English rather than taken from the API, so it is the only one that needs projecting;
// every other facet's values arrive already localized. Returns the key unchanged for anything else,
// so a new facet is never silently rewritten.
// Two projections, one function, and both follow the same rule: the key crosses, the label is read.
// OTHER_KEY is the rollup sentinel aggregate() produces; it must stay English on the wire (this
// component refuses to filter on it by testing `key === 'Other'`) and be localized for a reader.
// ★ TWO MORE FACETS CARRY ENGLISH DATA LABELS, and both were read on ?lang=ar (KA3, 3d64bcad).
// They are not chrome: no catalogue held them, so every i18n gate passed while the chart spoke English.
//   · wagf_region — the prayer API's seven region names. A closed set, so they are CATALOGUED, five of
//     them from vendored CLDR (internal/generate-wagf-region-names.mjs); middle_east and
//     north_america_&_non-spanish_caribbean have no CLDR code that means them and stay English.
//   · country_code — the API's English country name. The alpha-3 is gone by aggregation time, so
//     library/utils/countryName.js reverses its own table and then asks CLDR, per the ✓ case in that
//     file's header: a label that arrives in English regardless of the reader.
// English is left EXACTLY as authored: at locale 'en' both projections return the key untouched, which
// also keeps the 42 countries whose CLDR name differs from ours (see countryName.js) reading as before.
// The five keys are written out rather than assembled from the slug: a template-literal key is
// invisible to check:i18n-keys-exist (it counts such expressions as dynamic and will not guess at
// them), and these entries are generated, so the gate is the only thing standing between a regenerated
// catalogue and a chart silently back in English. Written out, deleting one fails the build.
const REGION_SLUG = new Map(Object.entries(WAGF_REGIONS).map(([slug, label]) => [label, slug]))
const REGION_KEY = {
  africa: 'dashboard.wagfRegion.africa',
  asia: 'dashboard.wagfRegion.asia',
  europe: 'dashboard.wagfRegion.europe',
  'latin_america_&_caribbean': 'dashboard.wagfRegion.latin_america_&_caribbean',
  oceania: 'dashboard.wagfRegion.oceania',
}
const regionLabel = (key) => {
  const slug = REGION_SLUG.get(key)
  const k = slug && REGION_KEY[slug]
  return (k && tStatic(k)) || key
}
// ★ THE CODE COMES FROM THE ROW, NOT FROM THE NAME (?lang=ar after the first fix: "People's
// Republic of China" and "Lao People's Democratic Republic" were still English). The API labels some
// countries with their FORMAL name, which countries.json does not carry — it says "China" and "Laos" —
// so reversing the English name missed exactly the countries whose names are longest. Every row already
// carries both halves: the label the chart aggregates on, and the alpha-3 in country_code.value, which
// is the accessor the choropleth already joins on. Reading the pair out of the data is exact and needs
// no alias table.
// Deliberately NOT a looser text match: "Democratic Republic of the Congo" and "Republic of the Congo"
// are two countries, so stripping formal prefixes is how one would silently become the other — the
// failure countryName.js's own header warns about.
const COUNTRY_ISO_BY_LABEL = computed(() => {
  const m = new Map()
  const acc = FACET_ACC.country_code
  const geo = cfg.facets?.country_code?.geoIso
  if (!acc || !geo) return m
  for (const r of (dash?.rows?.value || [])) {
    const label = acc(r), iso = geo(r)
    if (label && iso && !m.has(label)) m.set(label, String(iso).toUpperCase())
  }
  return m
})
const countryLabel = (key) => {
  const lc = getRuntimeLocale()
  if (!lc || lc === 'en') return key
  // The row pair first, the English-name table second: the table still answers for a label whose rows
  // are currently filtered out, and a synthetic key ("Other") resolves to neither and renders as itself.
  const iso3 = COUNTRY_ISO_BY_LABEL.value.get(key) || iso3ForEnglishName(key)
  return iso3 ? countryName(iso3, lc) : key
}
const legendLabel = (facet, key) => {
  if (key === OTHER_KEY) return otherLabel()
  if (facet === 'religion_family') return religionFamilyLabel(key)
  if (facet === 'wagf_region') return regionLabel(key)
  if (facet === 'country_code') return countryLabel(key)
  return key
}
// true when this chart's own facet has an active selection → drives the pop-out / dim-others state.
const hasSelection = (facet) => filterSet[facet] != null   // any selection, scalar or array

function pick(facet, key) {
  if (!key || key === 'Other' || !bus) return
  bus.setFilter(facet, filterSet[facet] === key ? null : key)
}
function onChartClick(e) {
  const el = e.target && e.target.closest && e.target.closest('[data-facet]')
  if (el) pick(el.getAttribute('data-facet'), el.getAttribute('data-key'))
}

useShadowStyles(`
  /* ══ READ THIS BEFORE YOU VERIFY A LABEL IN THIS FILE ══════════════════════════════════════
     Every text label here (.rd-lt, .rd-bl) is a -webkit-line-clamp box. THE OBVIOUS TEST FOR
     "is this text cut off" IS WRONG ON THEM:

         el.scrollWidth > el.clientWidth      // <-- DOES NOT DETECT A CLAMP

     A clamp truncates VERTICALLY, so horizontal metrics stay clean while line 4 is being cut.
     Measured on the live composite 2026-09-22: that test reported 0 of 16 legend labels clipped
     while 4 were actually truncated, including the two just complained about.
     A green result from it is not evidence.

     USE A STRUCTURALLY DIFFERENT MEASUREMENT — clone the label, strip the clamp, let it lay out
     at the SAME width, and compare the height it WANTS to the height it GOT:

         naturalH(el) <= el.getBoundingClientRect().height   // true = every glyph is on screen

     This is the fourth time in this repo that a verification instrument has returned a
     confident wrong answer. When a gate disagrees with what the screen plainly shows, suspect
     the gate, and cross-check with a measurement that fails for different reasons.
     ═══════════════════════════════════════════════════════════════════════════════════════ */
  /* SPACE ECONOMY (BUILD-SPACE-ECONOMY-SCROLLBARS-CHARTS-MAP): the rail is a narrow column, so
     every horizontal pixel of padding is taken from the charts themselves. Padding is trimmed
     12px -> 6px, and the RIGHT padding is dropped to 0 so the thin overlay scrollbar sits flush
     against the panel edge instead of floating in a gutter. The 6px is given back to the chart
     cards as their own right margin only when no scrollbar is present. */
  .rd-charts{ display:flex; flex-direction:column; gap:var(--s2,8px); height:100%; min-height:0;
    padding:6px 2px 6px 6px;
    background:var(--rd-panel,#fff); overflow-y:auto; overflow-x:hidden; box-sizing:border-box;
    scrollbar-width:thin; scrollbar-color:var(--dx-scroll-thumb, #c4c8c0) transparent;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .rd-charts::-webkit-scrollbar{ width:8px; height:8px; }
  .rd-charts::-webkit-scrollbar-track{ background:transparent; }
  .rd-charts::-webkit-scrollbar-thumb{ background:var(--dx-scroll-thumb, #c4c8c0); border-radius:8px; }
  .rd-charts::-webkit-scrollbar-thumb:hover{ background:#9aa197; }
  /* ★ THE TAB STRIP REPLACES .rd-h, and inherits its exact typography on purpose: weight 700, the
     --fs-md token, uppercase, .5px tracking. The rail's visual weight is unchanged, so this reads
     as the same header having gained a second option rather than as new chrome appearing. .rd-h is
     kept below only because a future rail section may want a plain heading again; it is currently
     unused in this file and in every other file under research-dashboard/ (checked). */
  .rd-charts .rd-h{ font-weight:700; font-size:var(--fs-md,12px); text-transform:uppercase; letter-spacing:.5px; color:var(--rd-muted, #6d766e); }
  .rd-charts .rd-tabs{ display:flex; gap:2px; align-items:stretch; border-bottom:1px solid var(--rd-border, #d1d4cd); margin-bottom:6px; }
  .rd-charts .rd-tab{ appearance:none; background:none; border:none; cursor:pointer;
    padding:4px 8px 5px; font-family:inherit; font-weight:700; font-size:var(--fs-md,12px);
    text-transform:uppercase; letter-spacing:.5px; color:var(--rd-muted, #6d766e);
    border-bottom:2px solid transparent; margin-bottom:-1px; white-space:nowrap; }
  .rd-charts .rd-tab:hover:not(:disabled){ color:var(--rd-text, #3b463d); }
  /* The selected tab is the ACCENT underline plus full-strength text — the same signal the facet
     rail uses for an active row, so one visual language covers both rails. */
  .rd-charts .rd-tab.on{ color:var(--rd-text, #3b463d); border-bottom-color:var(--rd-accent, #92b195); }
  /* A disabled tab stays LEGIBLE at .45 rather than being hidden: it is a status report, and its
     title attribute names the three decisions it waits on. Hiding it would make "not built yet"
     and "does not exist" look identical. */
  .rd-charts .rd-tab.off{ opacity:.45; cursor:not-allowed; }
  .rd-charts .rd-tab:focus-visible{ outline:2px solid var(--rd-accent, #92b195); outline-offset:-2px; }
  /* 10px -> 7px 6px: reclaims ~8px of width per card for the plot area itself. */
  .rd-chart{ border:1px solid var(--rd-line, #d1d4cd); border-radius:var(--r-lg,10px); background:var(--rd-bg, #f3f3f1); padding:7px 6px; }
  .rd-chart .rd-ct{ font-weight:700; font-size:var(--fs-sm,11px); color:var(--rd-ink, #3b463d); margin-bottom:6px; }
  .rd-donutwrap{ display:flex; align-items:flex-start; gap:8px; }
  /* 108px -> 84px (card BUILD-REBALANCE-THE-TWO-SIDEBARS). The rail narrowed to 264px to give
     the tree rail room, and the donut was consuming 108px + a 10px gap of it — leaving the
     legend labels only ~82px, narrow enough that "North America & Non-Spanish Caribbean" still
     needed THREE lines and was truncated even after wrapping was enabled. The donut is the
     DECORATIVE half of this card (the legend beside it carries the exact numbers), so it is the
     side that gives way. 24px of donut + 2px of gap becomes 26px of label. */
  .rd-donut{ width:84px; height:84px; flex:0 0 auto; }
  .rd-slice{ cursor:pointer; transition:opacity .18s, transform .18s; transform-box:view-box; transform-origin:center; }
  .rd-slice:hover{ opacity:.82; }
  /* Active slice pops out (scale) with a clear ink stroke; when a slice is selected the rest dim. */
  .rd-donut.has-sel .rd-slice{ opacity:.42; }
  .rd-slice.on, .rd-donut.has-sel .rd-slice.on{ opacity:1; stroke:var(--rd-ink, #3b463d); stroke-width:2.5;
    transform:scale(1.08); filter:drop-shadow(0 1px 2px rgba(31,39,51,.35)); }
  /* The donut legend is the WORST offender reported: a short, always-scrolling list
     whose default scrollbar ate a large share of an already narrow column. Thin overlay bar,
     transparent track, and no right padding so it hugs the card edge. */
  /* ── MAX-HEIGHT 108px -> 168px (card BUILD-REBALANCE-THE-TWO-SIDEBARS) ───────────────────
     THE TRADE, STATED SO THE NEXT AUTHOR DOES NOT FLIP IT BACK A THIRD TIME:
     The 108px cap existed to match the donut's height, so the legend never made the card
     taller than the chart beside it. That cap is what forced .rd-lt to ELLIPSISE rather than
     wrap — a wrapping row is ~2x tall, and in a 108px box that pushes items out of view.
     READABILITY NOW WINS OVER COMPACTNESS: on the religion and region charts a reader could not
     scroll right to read the rest of a label, and there was indeed nothing to scroll to — .rd-legend is overflow-x:hidden by design, so an ellipsised
     label was simply unrecoverable text.
     So the legend is allowed to grow PAST the donut (176px, vs the donut's 84px) and .rd-lt
     wraps to at most 3 lines. The card gets taller; that is the accepted cost. If you need to
     reclaim vertical space, lower -webkit-line-clamp or trim the LABEL TEXT upstream — do NOT
     restore white-space:nowrap + ellipsis here, and do not re-cap this to the donut's height:
     that cap is precisely what forced the unreadable ellipsis that was rejected. */
  .rd-legend{ display:flex; flex-direction:column; gap:2px; font-size:10.5px; color:var(--dx-text, #3b463d); max-height:120px;
    overflow-y:auto; overflow-x:hidden; flex:1 1 auto; min-width:0;
    scrollbar-width:thin; scrollbar-color:var(--dx-scroll-thumb, #c4c8c0) transparent; }
  .rd-legend::-webkit-scrollbar{ width:6px; height:6px; }
  .rd-legend::-webkit-scrollbar-track{ background:transparent; }
  .rd-legend::-webkit-scrollbar-thumb{ background:var(--dx-scroll-thumb, #c4c8c0); border-radius:6px; }
  .rd-legend::-webkit-scrollbar-thumb:hover{ background:#9aa197; }
  /* align-items FLEX-START (not center) and no row-level nowrap: with a wrapping label the row is
     now two lines tall, and centring would float the swatch and the count in the middle of that
     block, detached from the first line of text they label. The count is top-aligned with a 1px
     nudge (.rd-li b) so it reads as belonging to the row's first line. */
  /* ★ THE CONVENTIONAL LEGEND ROW. Two earlier variants were replaced: scroll-to-read (a reader
     could not scroll right) and a frozen count column on a painted backing (an opaque white block
     where the backing was meant to be invisible). This is the pattern every
     chart library ships: swatch, label that ELLIPSIZES at the available width, count right-
     aligned in a fixed-width slot. No horizontal scroll, no sticky, no background -- the number
     needs no backing because nothing can ever slide beneath it. The full label lives in the
     row's existing :title tooltip. Rows stretch to the container, so every count shares one
     right edge by ordinary flex geometry. */
  .rd-li{ display:flex; align-items:center; gap:5px; cursor:pointer; padding:1px 2px; border-radius:3px; }
  .rd-li > i{ flex:0 0 auto; }
  .rd-li .rd-lt{ flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }  /* max-content: the row is as wide as its label, so the scrollport has something to scroll */
  .rd-li:hover{ background:var(--dx-surface, #f3f3f1); } .rd-li.on{ background:#fff4ea; font-weight:700; color:var(--rd-ink, #3b463d); }
  /* margin-top nudges keep the swatch and the count optically on the label's FIRST line now that
     a row can be two lines tall. */
  .rd-li i{ width:9px; height:9px; border-radius:2px; flex:0 0 auto; margin-top:3px; }
  /* ★ THE COUNT IS A FROZEN COLUMN: pinned, on an opaque background, so the label never slides under
     it and the numbers stay visible while the label scrolls.
     This is the other half of the horizontal-scroll change and shipping without it was incomplete:
     nowrap + overflow-x:auto made the long label reachable, but the label then slides UNDER the
     count and the two overlap mid-scroll. A scrollable row needs a pinned column, or the thing you
     scrolled to read collides with the thing you were reading it against.
     position:sticky right:0 pins it to the SCROLLPORT's right edge, so it holds while the label
     travels beneath it. The opaque background is load-bearing, not decoration — without it the
     label shows THROUGH the number and both become unreadable, which is worse than clipping.
     Background is --rd-panel (the card's own surface) so the pin matches its host rather than
     assuming white; the card is #fff today but a host that re-skins the panel should not get a
     white rectangle floating on a tinted card. */
  /* ★ THE COUNT COLUMN IS UNIFORM, RIGHT-JUSTIFIED AND IMMOVABLE, in this chart and the region chart
     alike, so it is easier to read. One fixed width for every row means the
     digits align into a scannable column instead of each number sitting wherever its label ended;
     right-justified plus the existing tabular-nums makes magnitudes comparable at a glance (541
     visibly longer than 72). 3.4em clears the widest live value (1,309 in the region chart) with
     a little air. sticky right:0 (from the frozen-column fix) is what makes it immovable while the
     label scrolls beneath. Both donut legends share .rd-li, so religion and region get this from
     the one rule -- which is exactly why it lives here and not per-chart. */
  .rd-li b{ flex:0 0 auto; min-width:3.4em; text-align:end;
    color:var(--rd-muted, #6d766e); font-variant-numeric:tabular-nums; }
  /* The label is the ONLY item allowed to shrink. It used to be a bare text node, which in a
     nowrap flex row cannot shrink at all: the row grew past .rd-legend (overflow-x:hidden) and
     carried the VALUE out of sight — "Ethnoreligion - Chinese Folk Religion" rendered with no
     number at all. Wrapping it in .rd-lt with min-width:0 makes it yield instead, so the count
     (flex:0 0 auto) is always the last thing on screen.
     ── WRAP, NOT ELLIPSIS (card BUILD-REBALANCE-THE-TWO-SIDEBARS) ───────────────────────────
     This previously read overflow:hidden + text-overflow:ellipsis + white-space:nowrap, a
     DELIBERATE earlier choice to protect the 108px scroller (see the .rd-legend note above).
     It is reversed for readability: measured before this change, 4 of 16 legend
     labels were ellipsised, including these two — "Ethnoreligion - Chinese Folk Religion"
     (191px of text in a 130px box) and "North America & Non-Spanish Caribbean" (214px in 130px).
     Because the scroller is overflow-x:hidden, that hidden text could not be scrolled to; it was
     simply GONE. Two lines at this rail width fit both in full.
     THE CLAMP IS 3, AND THAT NUMBER IS MEASURED, NOT GUESSED. A 2-line clamp was tried first and
     still truncated the two labels above: at this rail width they need 40px of text height and a
     2-line box gives 27px. BEWARE THE INSTRUMENT — a clamped element reports
     scrollWidth === clientWidth even while it truncates, because the clamp cuts VERTICALLY; the
     horizontal overflow test says "fine" and is wrong. To re-verify, clone the label with the
     clamp removed, measure its natural height at the same width, and require naturalH <= renderedH.
     The clamp is kept (not dropped) so one pathological label can never own the whole legend; it
     degrades to a plain wrap where -webkit-line-clamp is unsupported, which is still readable.
     overflow-wrap:anywhere breaks only words that genuinely cannot fit, so ordinary labels still
     break at spaces. Keep .rd-li's count at flex:0 0 auto — the number must never be the thing
     that yields. */
  /* ★ THIRD AND RESOLVING PASS ON THIS TRADE — read the block above first.
     History: (1) capped at 108px to match the donut, which forced ELLIPSIS; (2) that was rejected
     because a truncated label could not be scrolled to and read, so wrapping was enabled, the cap
     raised to 176px, and a taller card was accepted as the cost.
     (3) The thing missing from BOTH: horizontal scrolling on the charts, so line wrapping can go and
     the height it cost is reclaimed.
     ★ THIS IS NOT A FLIP-FLOP BACK TO PASS 1, and the difference is the whole point. Pass 1 was
     nowrap + ellipsis + overflow-x:HIDDEN — the label was truncated and UNRECOVERABLE, which is the
     defect that was rejected. This is nowrap + overflow-x:AUTO on the scroller: the full label still
     exists and is reachable by scrolling right. The old warning said "do NOT restore nowrap", and it
     was right given hidden overflow; with a real horizontal scrollbar its precondition is gone.
     The vertical saving is the reason: a 3-line clamp makes every long row ~2.5x tall. */
  .rd-lt{ flex:1 1 auto; min-width:0; white-space:nowrap; line-height:1.28; overflow:visible; }
  .rd-bars{ display:flex; flex-direction:column; gap:3px; }
  .rd-bar{ display:flex; align-items:center; gap:6px; cursor:pointer; font-size:10.5px; padding:1px 2px; border-radius:3px; }
  .rd-bar:hover{ background:var(--dx-surface, #f3f3f1); } .rd-bar.on{ background:#fff4ea; font-weight:700; color:var(--rd-ink, #3b463d); }
  /* Same wrap rule as .rd-lt, applied to the bar chart's country labels: measured before this
     change, 2 of 13 clipped — "People's Republic of China" (138px of text in 84px) and "Lao
     People's Democratic Republic" (177px in 84px) — and like the donut legend there was no way
     to scroll to the hidden half. Clamped at 3 lines — same measured reason as .rd-lt above, and
     the same instrument warning: scrollWidth does NOT detect a vertical clamp. The column also
     widens 84px -> 96px, because at 84px "Lao People's Democratic Republic" needed a 4th line;
     the bar track (.rd-bt) is flex:1 1 auto so it absorbs the 12px. Value (.rd-bv) unchanged. */
  .rd-bl{ flex:0 0 96px; white-space:normal; overflow-wrap:anywhere; line-height:1.28; color:var(--dx-text, #3b463d);
    display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .rd-bt{ flex:1 1 auto; height:11px; background:var(--dx-surface, #f3f3f1); border-radius:3px; overflow:hidden; }
  .rd-bf{ display:block; height:100%; border-radius:3px; transition:width .35s cubic-bezier(.4,0,.2,1); }
  .rd-bv{ flex:0 0 auto; color:var(--rd-muted, #6d766e); font-variant-numeric:tabular-nums; min-width:30px; text-align:end; }
`, 'rd-charts')
</script>

<template>
  <aside class="rd-charts" data-region="charts-rail" @click="onChartClick">
    <!--
      ★ THE RAIL IS A TAB STRIP, NOT A HEADING: Charts is one tab (selected by default, showing the
      charts), so a Gospel Resources tab can sit next to it.

      THIS IS HALF THE CARD, DELIBERATELY. The container is buildable now; what the Gospel Resources
      tab ENCODES is not, because it waits on three open product decisions (the official lostness
      number, key-less vs a registered Joshua Project key, and the UI shape). Building the strip now
      means the tab exists the moment those land, instead of the whole feature waiting on them.

      So the second tab renders DISABLED with an explicit reason rather than being hidden. A hidden
      tab is indistinguishable from an unbuilt one; a disabled tab that says why is a status report.
    -->
    <div class="rd-tabs" role="tablist" :aria-label="tStatic('aria.railViews') || 'Rail views'">
      <button
        v-for="t in tabs" :key="t.id"
        class="rd-tab" :class="{ on: activeTab === t.id, off: t.disabled }"
        role="tab" type="button"
        :aria-selected="activeTab === t.id ? 'true' : 'false'"
        :disabled="t.disabled"
        :title="t.disabled ? t.why : t.label"
        :data-tab="t.id"
        @click.stop="!t.disabled && (activeTab = t.id)"
      >{{ t.label }}</button>
    </div>

    <template v-for="chart in charts" :key="chart.id">
      <div v-if="chart.type === 'donut'" class="rd-chart" :data-chart="chart.facet">
        <div class="rd-ct">{{ chart.title }}</div>
        <div class="rd-donutwrap">
          <svg class="rd-donut" :class="{ 'has-sel': hasSelection(chart.facet) }" viewBox="0 0 132 132" role="img" :aria-label="(tStatic('aria.donutChart') || '{title} donut chart').replace('{title}', chart.title)">
            <path v-for="s in chart.geometry" :key="s.key" :d="s.path" :fill="s.color" class="rd-slice"
                  :class="{ on: isActive(chart.facet, s.key) }" :data-facet="chart.facet" :data-key="s.key">
              <title>{{ legendLabel(chart.facet, s.key) }}: {{ s.value }} ({{ s.pct }}%)</title>
            </path>
          </svg>
          <div class="rd-legend">
            <!-- ★ THE LABEL IS PROJECTED; THE KEY IS NOT (the Arabic survey: 70 of 85 letters in
                 this legend were Latin). `s.key` is a facet VALUE, and for the religion donut it is a
                 DERIVED English family name — "Islam", "Hinduism" — that library/colors/religion.js
                 produces from a religion code. It is English in every locale because it is not a
                 string anyone wrote for a reader; it is the value the bus carries and the grid
                 re-derives per row.
                 So this does NOT translate the value. data-key, isActive() and every click path keep
                 the canonical English, exactly as before; only the visible text is projected through
                 legendLabel(). Translating the value instead would work in English and match nothing
                 in Arabic — silently, because an empty intersection reads as "no results". That is
                 the language-link defect, one facet over. Same rule as the shareable URL: the code is
                 canonical, the label is display-only. -->
            <span v-for="s in chart.geometry" :key="s.key" class="rd-li" :class="{ on: isActive(chart.facet, s.key) }"
                  :data-facet="chart.facet" :data-key="s.key" :title="legendLabel(chart.facet, s.key) + ': ' + s.value"><i :style="{ background: s.color }"></i><span class="rd-lt">{{ legendLabel(chart.facet, s.key) }}</span><b>{{ s.value }}</b></span>
          </div>
        </div>
      </div>

      <div v-else class="rd-chart" :data-chart="chart.facet">
        <div class="rd-ct">{{ chart.title }}</div>
        <div class="rd-bars">
          <div v-for="b in chart.geometry" :key="b.key" class="rd-bar" :class="{ on: isActive(chart.facet, b.key) }"
               :data-facet="chart.facet" :data-key="b.key">
            <!-- ★ THE BAR LABEL WAS THE ONE CHART SURFACE STILL PRINTING THE RAW KEY. The donut, its
                 legend and both tooltips already read legendLabel(); the bar list did not, which is why
                 the top-countries and region charts stayed English after the donut was fixed. Same
                 projector, so the two charts cannot disagree about a name again. -->
            <span class="rd-bl">{{ legendLabel(chart.facet, b.key) }}</span>
            <span class="rd-bt"><span class="rd-bf" :style="{ width: (b.frac * 100) + '%', background: b.color }"></span></span>
            <span class="rd-bv">{{ b.value }}</span>
          </div>
        </div>
      </div>
    </template>
  </aside>
</template>
