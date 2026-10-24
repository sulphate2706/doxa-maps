/**
 * useAggregations.js — RDASH phase 5: client-side facet aggregation + chart geometry + palettes.
 *
 * Hand-rolled (no ECharts: starter-kit node_modules is a symlink into frozen doxa-life — can't
 * install). SVG donut/bar geometry is pure math, renders in the shadow root, tweens via CSS.
 */
import { getColorStrategy, COLOR_MODES } from '@map/colors/_registry.js'
import { PALETTE as RELIGION_PALETTE, RELIGION_FAMILIES, getReligionFamily } from '@map/colors/religion.js'

/**
 * ── ONE PALETTE FOR MAP, LEGEND AND CHARTS (card BUILD-MAP-STYLE-MUST-BE-BEAUTIFUL) ──────────
 *
 * WHAT WAS WRONG. This module used to declare TWO private palettes — a label-keyed
 * REGION_COLORS and a 15-entry CATEGORICAL — that the map and legend had never seen. Every
 * chart colour came from one line:
 *
 *     colorFor(key, i) => REGION_COLORS[key] || CATEGORICAL[i % CATEGORICAL.length]
 *
 * Two distinct defects came out of that, and the second is a correctness bug, not a taste one:
 *
 *  1) REGION near-misses. Both tables had an 'Africa' and they disagreed (#e74c3c chart vs
 *     #ff2e2e map); Latin America was ORANGE #f39c12 in the chart and YELLOW #FFEB3B on the
 *     map. A near-miss reads as a rendering artefact rather than a bug, which is worse.
 *
 *  2) RELIGION coloured BY ARRAY INDEX. REGION_COLORS held no religion keys at all, so every
 *     religion fell to CATEGORICAL[i] — its position in a list sorted BY COUNT. The counts
 *     move whenever you cross-filter, so a religion CHANGED COLOUR AS YOU FILTERED.
 *     MEASURED 2026-09-22 by simulating a cross-filter that reorders four religions:
 *        Islam        #2456c7 -> #e67e22     Hinduism     #e67e22 -> #2456c7
 *        Buddhism     #16a085 -> #8e44ad     Christianity #8e44ad -> #16a085
 *     All four swapped. That is not a palette mismatch — it is colour carrying no meaning.
 *
 * THE RULE NOW. A categorical colour is keyed by the VALUE, never by the index. Every hex is
 * read from the SAME colour-strategy modules the map's pins paint with, via the auto-discovering
 * registry at library/colors/_registry.js. This module declares NO palette of its own — the same
 * standard useTreeLegendColors.js already documents and obeys. It is a DELETION, not a new
 * abstraction: the registry already existed and was already load-bearing for map + legend.
 *
 * WHY A PER-FACET ADAPTER AND NOT ONE LOOKUP. Each palette is keyed by a different shape, and
 * the chart's aggregation key (the facet accessor's output) matches only one of them directly:
 *
 *   chart facet     agg key is                 palette wants        -> adapter must
 *   wagf_region     'Asia' (localized LABEL)   slug 'asia'          -> label->slug + alias
 *   religion        'Islam - Sunni' (LABEL)    family letter 'M'    -> first letter of the CODE
 *   country_code    'India'                    (no country palette) -> NEUTRAL, see below
 *
 * Religion is the sharp one: the aggregation key is the localized label, but religion.js colours
 * off the CODE's first letter. getReligionFamily() is the map's OWN resolver, reused here rather
 * than re-implemented, so chart and pin can never drift.
 */

// ★ THE GENERIC HALF LIVES IN THE LIBRARY. lbl() and aggregate() are pure counting and moved to
// @map/composables/useFacetAggregation.js in kit landing 4c-1, re-exported from here for one cycle
// so callers could migrate. That cycle is over: every caller now imports them from the library
// directly, so the re-export is gone. What remains in this file — colorFor and its facet branches,
// the religion palettes, the donut and bar builders — is research-specific and stays.
//
// NEUTRAL is still IMPORTED, because colorFor() and buildCountryRegionColors() below read it five
// times as the "this facet has no palette for that key" colour. When 4c-1 moved it to the library it
// updated the re-export line and not this import, so every read threw ReferenceError and Big
// Picture's Religion and Region charts came up empty on both engines and both languages. Deleting a
// re-export is not the same as deleting the import beside it.
import { NEUTRAL } from '@map/composables/useFacetAggregation.js'


// Place: the facet emits the localized label but the authoritative palette is slug-keyed
// (doxa-region.js documents that the label is localized per `lang` and the slug is stable).
// Derive the slug the way the API does, and keep the label-keyed aliases as the fallback.
const toSlug = (label) => String(label || '').trim().toLowerCase().replace(/\s+/g, '_')

/**
 * Read a registered strategy's palette, GUARDED on propertyKey.
 * getColorStrategy() silently falls back to language-family for an unregistered mode, so an
 * unguarded read would paint Region slices with LANGUAGE colours — plausible-looking and
 * entirely wrong. Same guard, same reason, as useTreeLegendColors.js.
 */
function guardedStrategy(mode, propertyKey) {
  const strat = getColorStrategy(mode)
  return (strat && strat.propertyKey === propertyKey) ? strat : null
}

/**
 * Religion LABEL -> family letter.
 *
 * ★ CAUGHT BY LOOKING AT A RENDERED MAP, NOT BY A CONTRAST NUMBER (2026-09-22).
 * The `religion` chart facet emits the DISPLAY LABEL ('Islam - Sunni', 'Buddhism - Tibetan'),
 * while religion.js keys its palette on the family letter taken from the CODE ('MSN' -> 'M').
 * A first-letter-of-the-label fallback looks right and is quietly wrong:
 *     'Hinduism'     -> 'H'  correct BY COINCIDENCE
 *     'Islam - Sunni'-> 'I'  NOT a family letter -> fell through to 'U' = Unknown GREY,
 *                            while the map painted those same pins Islam RED.
 * 542 rows — the second-largest slice — would have shipped grey in the chart and red on the
 * map. The label is not the code and must never be treated as one.
 *
 * So resolve by the family NAME the label STARTS WITH ('Islam - Sunni' -> 'Islam' -> 'M'),
 * which is exactly how the API composes these labels ('<Family> - <Branch>'). Exact match
 * first, then longest-prefix so 'Ethnoreligion - Chinese Folk Religion' cannot be beaten by
 * a shorter unrelated family. Falls back to the code path for a genuine CODE input, and to
 * 'U' only when nothing matches — which is now a real Unknown, not a silent miss.
 */
function religionLetterFromLabel(key, families) {
  const s = String(key || '').trim()
  if (!s) return 'U'
  const letters = Object.keys(families)
  // 1) exact family name ('Islam') — what `religion_family` emits.
  const exact = letters.find((L) => families[L] === s)
  if (exact) return exact
  // 2) longest family name the label starts with ('Islam - Sunni' -> 'Islam').
  let best = null, bestLen = 0
  for (const L of letters) {
    const name = families[L]
    if (name && s.toLowerCase().startsWith(name.toLowerCase()) && name.length > bestLen) { best = L; bestLen = name.length }
  }
  if (best) return best
  // 3) a raw CODE ('MSN') — but ONLY if the input really IS a code.
  //
  // ★ WHY THIS IS GUARDED BY A SHAPE TEST (hardened 2026-09-22 after review).
  // This step used to run on ANY unmatched string, taking its FIRST LETTER. That is what put
  // 'Islam - Sunni' (542 rows) into Unknown grey: 'I' is not a family letter, so it fell to
  // 'U'. Steps 1-2 now catch every one of the 31 live labels (AUDITED: 990 rows exact,
  // 1,117 prefix, 0 reaching here, 0 disagreeing with the map), so step 3 is currently
  // unreachable by a label — but "unreachable today" is not "safe".
  //
  // AUDITED the latent failure: on an unguarded first letter, a NEW label would be coloured
  // CONFIDENTLY WRONG rather than obviously unknown —
  //     'Bahai'     -> B -> Buddhism      'Jainism'  -> J -> Judaism
  //     'Mandaeism' -> M -> Islam         'Shinto'   -> S -> Sikhism
  //     'Confucianism' -> C -> Christianity (the one family that means "blue" here)
  // religion.js's own header lists Bahai/Druze/Jainism/Mandaeism/Zoroastrianism under family
  // 'O', so those are realistic future labels, not exotic ones. A plausible wrong answer is
  // worse than an obvious one: grey says "no strategy for this key" and gets reported, while
  // a confident hue silently lies and matches nothing on the map.
  //
  // The API's religion codes are 1-3 UPPERCASE letters ('M', 'MSN', 'CPR'). Requiring that
  // shape means a real code still resolves, and anything else returns 'U' = Unknown, which
  // renders as the neutral and is meant to be SEEN and fixed.
  if (/^[A-Z]{1,3}$/.test(s)) return getReligionFamily(s)
  return 'U'
}


/**
 * COUNTRY -> REGION HUE: each country takes the colour of its region.
 * A country has no palette of its own, so the Top-countries bar inherits its REGION's hue —
 * which makes the bar chart, the Region donut and the map legend agree at a glance.
 *
 * Pure client-side join over rows already fetched: group by the country label, read the
 * `wagf_region` of those rows, take the MAJORITY region (regions are NOT strictly partitioned
 * by country in this data, so "majority wins, ties -> NEUTRAL" is the honest rule rather than
 * assuming a clean join). No API change, no new field.
 *
 * @param {Array} rows    the row store
 * @param {Function} countryAcc  facet accessor for the country label
 * @param {Function} regionAcc   facet accessor for the region label
 * @returns {Map<string,string>} country label -> hex
 */
export function buildCountryRegionColors(rows, countryAcc, regionAcc) {
  const tally = new Map() // country -> Map(region -> count)
  for (const r of rows || []) {
    const c = countryAcc && countryAcc(r)
    const g = regionAcc && regionAcc(r)
    if (!c || !g) continue
    if (!tally.has(c)) tally.set(c, new Map())
    const t = tally.get(c)
    t.set(g, (t.get(g) || 0) + 1)
  }
  const out = new Map()
  for (const [country, regions] of tally) {
    let best = null, bestN = 0, tied = false
    for (const [region, n] of regions) {
      if (n > bestN) { best = region; bestN = n; tied = false }
      else if (n === bestN) tied = true
    }
    out.set(country, (best && !tied) ? colorFor('wagf_region', best) : NEUTRAL)
  }
  return out
}

/** Donut slice geometry (SVG path strings), starting at 12 o'clock, clockwise. */
export function buildDonut(data, size = 132, innerRatio = 0.58, facet = '', overrides = null) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 3, ri = (size / 2 - 3) * innerRatio
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  let a = -Math.PI / 2
  return data.map((d, i) => {
    const a0 = a, a1 = a + (d.value / total) * Math.PI * 2; a = a1
    const big = (a1 - a0) > Math.PI ? 1 : 0
    const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`
    const path = `M${p(a0, r)} A${r},${r} 0 ${big} 1 ${p(a1, r)} L${p(a1, ri)} A${ri},${ri} 0 ${big} 0 ${p(a0, ri)} Z`
    return { ...d, path, pct: Math.round((d.value / total) * 100), color: resolveColor(facet, d.key, overrides) }
  })
}

/** Horizontal-bar geometry as fractions of the widest bar. */
export function buildBars(data, facet = '', overrides = null) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0) || 1
  return data.map((d) => ({ ...d, frac: d.value / max, color: resolveColor(facet, d.key, overrides) }))
}

/**
 * One colour resolution point for both geometry builders: an explicit per-key override
 * (e.g. the country->region join) wins, otherwise the facet's registry palette.
 * Note both paths are keyed by the VALUE — no index is consulted anywhere.
 */
function resolveColor(facet, key, overrides) {
  if (overrides && key !== 'Other') { const hit = overrides.get ? overrides.get(key) : overrides[key]; if (hit) return hit }
  return colorFor(facet, key)
}

/**
 * Resolve ONE chart key -> hex, keyed by the VALUE and the FACET. Never by index.
 *
 * @param {string} facet  the dashboard facet key this chart aggregates on
 * @param {string} key    the aggregation key (the facet accessor's exact output)
 * @returns {string} hex from the map's own strategy module, or NEUTRAL when unmapped
 */
export function colorFor(facet, key) {
  if (key == null || key === '') return NEUTRAL
  // The long-tail bucket is a chart-side construct, not a data value — always neutral.
  if (key === 'Other') return NEUTRAL

  if (facet === 'religion' || facet === 'religion_family') {
    const strat = guardedStrategy(COLOR_MODES.RELIGION, 'religion')
    const palette = (strat && strat.palette) || RELIGION_PALETTE
    const families = (strat && strat.families) || RELIGION_FAMILIES
    return palette[religionLetterFromLabel(key, families)] || NEUTRAL
  }

  if (facet === 'wagf_region') {
    const strat = guardedStrategy(COLOR_MODES.DOXA_REGION, 'doxaRegion')
    if (!strat) return NEUTRAL
    const hit = strat.slugColors && strat.slugColors[toSlug(key)]
    if (hit) return hit
    const alias = strat.aliases && strat.aliases[key]
    return alias || NEUTRAL
  }

  if (facet === 'affinity_bloc') {
    // The People facet emits the ROP1 CODE ('A008'), which is this palette's own key.
    const strat = guardedStrategy(COLOR_MODES.AFFINITY_BLOCK, 'affinityBlock')
    return (strat && strat.palette && strat.palette[key]) || NEUTRAL
  }

  if (facet === 'language_family') {
    const strat = guardedStrategy(COLOR_MODES.LANGUAGE_FAMILY, 'languageFamily')
    return (strat && strat.palette && strat.palette[key]) || NEUTRAL
  }

  // No colour strategy exists for this facet (e.g. country_code — a country's identity is
  // carried by the choropleth, not by a categorical hue). Returning NEUTRAL is deliberate
  // and STABLE; inventing an index-keyed colour is exactly the bug this replaced.
  return NEUTRAL
}
