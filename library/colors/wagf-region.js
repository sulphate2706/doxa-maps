/**
 * WAGF region color strategy — colors pins by the region they belong to.
 *
 * ★ THE VALUES ARE THE RESEARCH MAP'S (2026-09-24). The Simple Research map's Regions tab and the
 * regions dashboard painted the same regions in different colours. Two surfaces disagreeing about
 * what Africa's colour means is a product defect whichever palette is prettier, and the research
 * map's palette was chosen to win. Source of truth:
 * library/colors/doxa-region.js (it lived at plugin-designs/doxa-research-map/src/colors/ until C1a), which the research dashboard and
 * three other consumers already paint from.
 *
 * WHAT THE CHANGE COST, measured rather than glossed (dataviz validate_palette.js, light mode,
 * surface #fcfcfb — the same tool and surface the previous palette was stepped against):
 *   Lightness band  FAIL  #1ee05f 0.793 · #FFEB3B 0.928 · #00e0bd 0.810 sit above the 0.43–0.77 band
 *   Chroma floor    PASS  all 7 >= 0.1
 *   CVD separation  PASS  worst adjacent #FFEB3B<->#1ee05f dE 8.7 protan (>= 8), tritan 14.7
 *   Normal vision   PASS  worst adjacent dE 21.0
 *   Contrast        WARN  under 3:1 vs the surface: #1ee05f 1.72 · #FFEB3B 1.19 · #00e0bd 1.65 · #ff7f11 2.47
 * The palette this replaced passed all five. So the trade is real and it is recorded here rather
 * than in a commit message nobody will read next year.
 *
 * WHY THE CONTRAST WARN IS SURVIVABLE HERE, and it is a reason, not a dismissal: that check
 * obligates relief through a secondary encoding, and both surfaces already carry one — the chooser
 * renders a LEGEND of labelled chips in these exact colours, and the dashboard renders the same
 * seven regions as a TABLE with names and figures. Identity never rests on hue alone on either.
 * The LIGHTNESS FAIL is the part with no relief: three of these read faintly as PINS on a light
 * basemap. Darkening those three by ~10% L would enter the band while keeping the hue
 * recognisable. That is provisional, pending a product decision — asked, not done quietly.
 *
 * WHY THIS EXISTS. The regions element's no-selection state is a CHOOSER: a map that shows the
 * regions and countries and lets you select one. For the
 * seven regions to read AS regions the moment the map loads, the pins have to be colored by
 * region — which is a categorical encoding no existing strategy provides. (`_registry.js` and
 * `religion.js` both mention a `doxa-region.js`; it does not exist in this tree.)
 *
 * WHY IT LIVES IN library/colors/ AND NOT IN THE PLUGIN. Not a preference — check:one-palette
 * requires it. That gate exists because a dashboard composable once declared PRIVATE palettes the
 * map had never seen, and two surfaces then disagreed about what a color meant; worse, one keyed
 * color by ARRAY INDEX over a count-sorted list, so a religion CHANGED COLOR as you filtered.
 * Every hex a consumer paints with must come from a strategy module here, discovered by
 * `_registry.js`. A lookup table inside the component is the exact shape that caused the bug.
 *
 * COLOR FOLLOWS THE ENTITY, NEVER ITS RANK. The seven slots below are assigned in a FIXED
 * ALPHABETICAL ORDER of the region's own `value`, deliberately NOT in count order: Asia has 1309
 * people groups and Oceania 24 today, and if the palette were ordered by size then a cross-filter
 * that changed the counts would repaint the survivors. Alphabetical is arbitrary but STABLE, which
 * is the property that matters.
 *
 * THE PALETTE WAS VALIDATED, NOT CHOSEN BY EYE. Run through the dataviz validator
 * (scripts/validate_palette.js, light mode, surface #fcfcfb) and re-stepped twice until every
 * check passed with no warning:
 *   Lightness band   PASS  all 7 inside L 0.43–0.77
 *   Chroma floor     PASS  all 7 >= 0.1        (an earlier teal #0e7490 FAILED at 0.094 — read gray)
 *   CVD separation   PASS  worst adjacent #dc2626 <-> #15803d dE 8.6 deutan (>= 8; 6–8 is a floor
 *                          band that would have been legal only with secondary encoding)
 *   Normal vision    PASS  worst adjacent dE 30.6
 *   Contrast         PASS  all 7 >= 3:1        (an earlier amber #f59e0b WARNed at 2.09:1)
 * The order of the hexes below IS the validated order — the CVD check measures ADJACENT pairs, so
 * a legend must render the regions in this same fixed order for that result to still hold.
 *
 * Field on the Mapbox feature: `region` (the wagf_region VALUE, e.g. 'latin_america_&_caribbean').
 */

export const PROPERTY_KEY = 'region'

// DX-life --color-brand-lighter: an unknown region reads as chrome, not as an eighth region.
// ★ DELIBERATELY NOT THEIRS. doxa-region.js uses '#0098FF' for null/undefined and keys
// 'No WAGF Region/Bloc' to '#1a1a2e'. Neither is a REGION colour — they are what an absent value
// looks like — and the instruction was about the seven regions. A bright blue for
// "unknown" would also read as a region on a map whose every other pin is a region. Every row in
// this feed carries a wagf_region, so this value is almost never painted; it is chrome on purpose.
const DEFAULT_COLOR = '#6d766e'

/** Region value → display label, as the prayer API labels them. Used by the legend. */
export const WAGF_REGIONS = {
  'africa': 'Africa',
  'asia': 'Asia',
  'europe': 'Europe',
  'latin_america_&_caribbean': 'Latin America & Caribbean',
  'middle_east': 'Middle East',
  'north_america_&_non-spanish_caribbean': 'North America & Non-Spanish Caribbean',
  'oceania': 'Oceania',
}

/**
 * Region value → color. THE RESEARCH MAP'S VALUES, so the two surfaces agree — see the header.
 * Mapped from its label-keyed table: Africa #ff2e2e, Asia #1a8cff, Europe #1ee05f,
 * Latin America & Caribbean #FFEB3B, Middle East #a83dff,
 * North America & Non-Spanish Caribbean #00e0bd, Oceania #ff7f11.
 * The order is still the fixed alphabetical one (colour follows the entity, never its rank), which
 * is also the order the adjacent-pair CVD result in the header was measured in.
 */
export const PALETTE = {
  'africa': '#ff2e2e',
  'asia': '#1a8cff',
  'europe': '#1ee05f',
  'latin_america_&_caribbean': '#FFEB3B',
  'middle_east': '#a83dff',
  'north_america_&_non-spanish_caribbean': '#00e0bd',
  'oceania': '#ff7f11',
}

/** The fixed render order — the same order the palette was validated in. */
export const REGION_ORDER = Object.keys(PALETTE)

/** Per-feature color resolver, for the JS layer. */
export function getColor(properties) {
  const v = properties?.region || properties?._raw?.wagf_region?.value || properties?._raw?.wagf_region
  return PALETTE[v] || DEFAULT_COLOR
}

/** Mapbox match expression colored by region value. */
export function applyColor() {
  const match = ['match', ['coalesce', ['get', 'region'], '']]
  for (const key of REGION_ORDER) match.push(key, PALETTE[key])
  match.push(/* default */ DEFAULT_COLOR)
  return match
}

// Registry-level alias, mirroring religion.js / language-family.js.
export const buildColorExpression = applyColor

export default {
  name:        'WAGF Region',
  propertyKey: PROPERTY_KEY,
  palette:     PALETTE,
  regions:     WAGF_REGIONS,
  order:       REGION_ORDER,
  getColor,
  applyColor,
  buildColorExpression,
  fallback:    DEFAULT_COLOR,
}
