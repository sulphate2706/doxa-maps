/**
 * useTreeLegendColors.js — the STACKED TREE LEGEND's colour resolver (card BUILD-TREE-LEGEND-COLOURS).
 *
 * The rule: the legend's colours must come from the cap-3 research map's semantic tree, so
 * the legend can NEVER drift from the map. This module therefore declares NO palette of its own —
 * every hex is read from the SAME colour-strategy modules the map's pins paint with:
 *
 *   People    plugin-designs/doxa-research-map/src/colors/affinity-block.js:38  PALETTE   keyed ROP1 code   'A001'
 *   Place     plugin-designs/doxa-research-map/src/colors/doxa-region.js:59     SLUG_PALETTE keyed slug     'middle_east'
 *             (+ REGION_COLOR_ALIASES:82 keyed display label, for the label-shaped facet output)
 *   Language  library/colors/language-family.js:26                              PALETTE   keyed family name 'Indo-European'
 *   Religion  library/colors/religion.js:58                                     PALETTE   keyed family letter 'C'
 *
 * ── WHY ONE ADAPTER PER AXIS, NOT ONE LOOKUP ────────────────────────────────────────────────
 * Each palette is keyed by a DIFFERENT shape, and only one of them matches what the matching
 * dashboard facet accessor emits:
 *
 *   axis      facet accessor returns            palette wants          → adapter must
 *   People    code(r.rop1)          = 'A008'    ROP1 code              → direct hit
 *   Place     lbl(r.wagf_region)    = 'Asia'    slug 'asia'            → label→slug, alias fallback
 *   Language  lbl(imb_language_family)='Mande'  family display name    → direct hit (may miss, see below)
 *   Religion  lbl(r.religion)       = 'Islam - Sunni'  family letter   → needs the CODE, not the label
 *
 * Religion is the sharp one: `lbl()` yields the localized LABEL ("Islam - Sunni") but religion.js
 * colours off the CODE's first letter ("M"). The rail therefore colours religion leaves from the
 * tree's family node, never by re-parsing the label — see the `religionFamily` facet in
 * dashboard.config.js, which is a separate facet key precisely so one key = one projection and the
 * selection bus's byte-match contract stays intact.
 *
 * ── COLOUR IS DISPLAY-ONLY ──────────────────────────────────────────────────────────────────
 * Nothing here touches a row's `value`. Colour is a pure projection off the value the accessor
 * already produced, so adding it cannot change what `bus.setFilter(facet, value)` sends.
 *
 * ── MEASURED PALETTE GAPS (live pray-tools, 2,107 rows, 2026-09-20) ─────────────────────────
 * Verified against the live API rather than assumed. Unmapped keys fall back to NEUTRAL (never to
 * another axis's palette — a wrong-but-plausible colour is worse than an obviously absent one):
 *   - ROP1 'A018' and 'A019' are LIVE but absent from affinity-block.js (which stops at A017).
 *   - Language families 'Atlantic-Congo', 'Mande', 'Tai-Kadai', 'None' are live but absent from
 *     language-family.js's PALETTE.
 * These are upstream data-vs-palette gaps, reported not papered over. Fixing them means adding
 * entries to the MAP's strategy files (so pins and legend move together) — not inventing a hex here.
 */
import { computed } from 'vue'
import { getColorStrategy, COLOR_MODES } from '@map/colors/_registry.js'
import { PALETTE as RELIGION_PALETTE } from '@map/colors/religion.js'
import { PALETTE as LANGFAM_PALETTE } from '@map/colors/language-family.js'

// A deliberately NEUTRAL unmapped tone, not a palette colour: an uncoloured node must read as
// "this axis has no colour for this key", never as a confident member of some other family.
// Matches the Material Light border token so it disappears into the rail rather than shouting.
export const NEUTRAL = '#c4c8c0'

/**
 * Read a registered strategy's palette, GUARDED on propertyKey.
 *
 * getColorStrategy() silently falls back to language-family for an unregistered mode, so an
 * unguarded read would paint People rows with LANGUAGE colours and look plausible while being
 * entirely wrong. This is the same guard useAffinityBlockLegendData.js:57 applies, and for the same
 * reason. Read lazily (at call time) so bundle-local registerStrategies() has already run.
 */
function guardedPalette(mode, propertyKey) {
  const strat = getColorStrategy(mode)
  return (strat && strat.propertyKey === propertyKey && strat.palette) ? strat.palette : null
}

// ── Place: label → slug ─────────────────────────────────────────────────────────────────────
// doxa-region.js:52 documents that wagf_region's LABEL is localized per `lang` while the slug is
// stable, so the slug palette is the authoritative one. The Place facet emits the label, so derive
// the slug the same way the API does (lowercase, spaces → underscores) and keep the label-keyed
// REGION_COLOR_ALIASES as the fallback. Verified: all 7 live region labels resolve by this path.
const toSlug = (label) => String(label || '').trim().toLowerCase().replace(/\s+/g, '_')

/**
 * Resolve one facet value → a hex colour, per axis.
 *
 * @param {string} axis   one of 'people' | 'place' | 'language' | 'religion'
 * @param {string} facet  the dashboard facet key the row was aggregated on
 * @param {string} value  the facet accessor's EXACT output (also the bus filter value)
 * @param {string} [famLetter] religion family letter, supplied by the tree (never re-parsed here)
 * @returns {string} hex colour, or NEUTRAL when this axis has no colour for the key
 */
export function useTreeLegendColors() {
  // Both Place maps come off the ONE registered doxa-region strategy — palettes are never copied.
  const placeMaps = computed(() => {
    const strat = getColorStrategy(COLOR_MODES.DOXA_REGION)
    const ok = strat && strat.propertyKey === 'doxaRegion'
    return {
      slug: (ok && strat.slugColors) || null,
      alias: (ok && strat.aliases) || null,
    }
  })

  function colorFor(axis, facet, value, famLetter) {
    if (value == null || value === '') return NEUTRAL

    if (axis === 'people') {
      // Every People tier (bloc → cluster → people group) inherits its BLOC's colour — exactly
      // what the map's semantic tree does (useAffinityBlockLegendData.js:169 assigns one `color`
      // per bloc and reuses it for cluster/pg/pgic children). The tree passes the bloc code down
      // as `famLetter`, so a cluster row is coloured by its ancestor, not by its own code.
      const palette = guardedPalette(COLOR_MODES.AFFINITY_BLOCK, 'affinityBlock')
      if (!palette) return NEUTRAL
      return palette[famLetter || value] || NEUTRAL
    }

    if (axis === 'place') {
      // Only the top tier (region) is coloured; bloc/country inherit via `famLetter` (the region
      // label of the ancestor), mirroring the map where a region's hue owns its whole subtree.
      const { slug, alias } = placeMaps.value
      const key = famLetter || value
      if (slug) { const hit = slug[toSlug(key)]; if (hit) return hit }
      if (alias) { const hit = alias[key]; if (hit) return hit }
      return NEUTRAL
    }

    if (axis === 'language') {
      // language_family rows hit the palette directly; primary_language rows inherit their
      // family's colour through `famLetter` (the ancestor family name).
      return LANGFAM_PALETTE[famLetter || value] || NEUTRAL
    }

    if (axis === 'religion') {
      // Keyed by the FAMILY LETTER only — the tree supplies it from religion.value's first char.
      // Never derived from the display label, which is localized and would not match.
      return RELIGION_PALETTE[famLetter] || NEUTRAL
    }

    return NEUTRAL
  }

  return { colorFor, NEUTRAL }
}

export default useTreeLegendColors
