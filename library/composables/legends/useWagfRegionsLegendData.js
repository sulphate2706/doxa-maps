/**
 * useWagfRegionsLegendData — 3-tier WAGF Regions legend for SemanticTreeLegend.
 *
 * Hierarchy: WAGF Region → WAGF Block → Country
 *
 *   region node  id: 'region:asia'
 *   block  node  id: 'block:asia__south_east_asia'
 *   country node id: 'country:asia__south_east_asia__MY'
 *
 * DSM-normalized properties used:
 *   properties.doxaRegion     = wagf_region.value  (slug, e.g. 'asia')
 *   properties.wagfRegionLabel = wagf_region.label  (e.g. 'Asia')
 *   properties.wagfBlock      = wagf_block.value    (slug, e.g. 'south_east_asia')
 *   properties.wagfBlockLabel = wagf_block.label    (e.g. 'South East Asia')
 *   properties.countryIso     = country_code.value  (alpha-3, e.g. 'MYS')
 *   properties.countryIsoLabel = country_code.label (e.g. 'Malaysia')
 *
 * Pin filter expressions (Mapbox GL) — filter pins by normalized property:
 *   region:  ['==', ['get', 'doxaRegion'], regionSlug]
 *   block:   ['==', ['get', 'wagfBlock'],  blockSlug]
 *   country: ['==', ['get', 'countryIso'], isoAlpha3]
 *
 * Polygon highlight — iso_3166_1_alpha_3 on Mapbox country-boundaries-v1:
 *   node.isoCodes carries alpha-3 codes for research-map.vue to use in:
 *   ['match', ['get', 'iso_3166_1_alpha_3'], isoCodes, 0.7, 0.1]
 */

import { computed } from 'vue'

// ── Region color palette ──────────────────────────────────────────────────────
// Keyed on the STABLE slug (wagf_region.value), NOT the localized label. The API
// localizes the label per `lang` ("Africa" → "África" → "Afrique"), so a
// label-keyed lookup falls back to grey for every region except "Asia" (spelled
// identically across locales) once the user switches language. The slug is
// locale-independent. Mirrors SLUG_PALETTE in the research bundle's
// library/colors/doxa-region.js (moved there in C1a).
const REGION_COLORS = {
  'africa':                                '#ff2e2e',
  'asia':                                  '#1a8cff',
  'europe':                                '#1ee05f',
  'latin_america_&_caribbean':             '#FFEB3B',
  'middle_east':                           '#a83dff',
  'north_america_&_non-spanish_caribbean': '#00e0bd',
  'oceania':                               '#ff7f11',
}
const FALLBACK_COLOR = '#95a5a6'

function regionColor(slug) {
  return REGION_COLORS[String(slug || '').toLowerCase()] || FALLBACK_COLOR
}

function readProps(item) { return item?.properties || item || {} }
function readPop(p) {
  const n = Number(p.population ?? p.populationNum ?? p._raw?.population ?? 0)
  return Number.isFinite(n) ? n : 0
}

function readRegionSlug(p) {
  return String(p.doxaRegion || p.wagfRegion || p._raw?.wagf_region?.value || '').trim()
}
function readRegionLabel(p) {
  const raw = p._raw?.wagf_region
  return String(
    p.wagfRegionLabel || p.doxaRegionLabel ||
    (raw && typeof raw === 'object' ? raw.label : '') ||
    p.doxaRegion || ''
  ).trim()
}

function readBlockSlug(p) {
  return String(p.wagfBlock || p._raw?.wagf_block?.value || '').trim()
}
function readBlockLabel(p) {
  const raw = p._raw?.wagf_block
  return String(
    p.wagfBlockLabel ||
    (raw && typeof raw === 'object' ? raw.label : '') ||
    p.wagfBlock || ''
  ).trim()
}

function readCountryIso(p) {
  // Alpha-3 from country_code field (e.g. 'MYS') — matches Mapbox iso_3166_1_alpha_3
  return String(p.countryIso || p._raw?.country_code?.value || '').trim().toUpperCase()
}
function readCountryName(p) {
  const raw = p._raw?.country_code
  return String(
    p.countryIsoLabel ||
    (raw && typeof raw === 'object' ? raw.label : '') ||
    p.countryIso || ''
  ).trim()
}

export function useWagfRegionsLegendData(peopleGroupsRef) {
  /**
   * aggregated: Map<regionSlug → { label, color, blocks: Map<blockSlug → { label, countries }> }>
   */
  const aggregated = computed(() => {
    const list = (peopleGroupsRef && peopleGroupsRef.value) || []
    const regions = new Map()

    for (const item of list) {
      const p = readProps(item)
      const regionSlug  = readRegionSlug(p)
      const regionLabel = readRegionLabel(p) || regionSlug || '— Unknown —'
      const blockSlug   = readBlockSlug(p)
      const blockLabel  = readBlockLabel(p) || blockSlug || '— Unknown —'
      const iso         = readCountryIso(p)
      const countryName = readCountryName(p) || iso || '— Unknown —'
      const pop         = readPop(p)

      // Skip unclassified entries (N/A, None, empty)
      if (!regionSlug || regionSlug === 'na' || regionSlug === 'none') continue

      let region = regions.get(regionSlug)
      if (!region) {
        region = { slug: regionSlug, label: regionLabel, count: 0, pop: 0, blocks: new Map() }
        regions.set(regionSlug, region)
      }
      region.count += 1
      region.pop   += pop

      if (!blockSlug || blockSlug === 'na') continue

      let block = region.blocks.get(blockSlug)
      if (!block) {
        block = { slug: blockSlug, label: blockLabel, count: 0, pop: 0, countries: new Map() }
        region.blocks.set(blockSlug, block)
      }
      block.count += 1
      block.pop   += pop

      if (!iso) continue

      let country = block.countries.get(iso)
      if (!country) {
        country = { iso, name: countryName, count: 0, pop: 0 }
        block.countries.set(iso, country)
      }
      country.count += 1
      country.pop   += pop
    }

    return regions
  })

  /**
   * regionsTree — SemanticTreeLegend node shape.
   * { id, label, color, count, pop, filter, isoCodes, children }
   * `isoCodes` (alpha-3, matched on iso_3166_1_alpha_3) drives Mapbox polygon highlight directly.
   */
  const regionsTree = computed(() => {
    const regions = aggregated.value
    const out = []

    for (const region of regions.values()) {
      // Color by the stable slug (locale-independent), not the localized label.
      const color = regionColor(region.slug)
      const regionIsoCodes = []
      const blockNodes = []

      const sortedBlocks = [...region.blocks.values()]
        .sort((a, b) => (b.pop - a.pop) || a.label.localeCompare(b.label))

      for (const block of sortedBlocks) {
        const blockIsoCodes = []
        const countryNodes = []

        const sortedCountries = [...block.countries.values()]
          .sort((a, b) => (b.pop - a.pop) || a.name.localeCompare(b.name))

        for (const c of sortedCountries) {
          blockIsoCodes.push(c.iso)
          regionIsoCodes.push(c.iso)
          countryNodes.push({
            id:       `country:${region.slug}__${block.slug}__${c.iso}`,
            label:    c.name,
            color,
            count:    c.count,
            pop:      c.pop,
            filter:   ['==', ['get', 'countryIso'], c.iso],
            isoCodes: [c.iso],
            children: [],
          })
        }

        blockNodes.push({
          id:       `block:${region.slug}__${block.slug}`,
          label:    `${block.label} (Bloc)`,
          color,
          count:    block.count,
          pop:      block.pop,
          filter:   ['==', ['get', 'wagfBlock'], block.slug],
          isoCodes: blockIsoCodes,
          children: countryNodes,
        })
      }

      out.push({
        id:       `region:${region.slug}`,
        label:    `${region.label} (Region)`,
        color,
        count:    region.count,
        pop:      region.pop,
        filter:   ['==', ['get', 'doxaRegion'], region.slug],
        isoCodes: [...new Set(regionIsoCodes)],
        children: blockNodes,
      })
    }

    out.sort((a, b) => (b.pop - a.pop) || a.label.localeCompare(b.label))
    return out
  })

  function highlight(node) {
    if (typeof window === 'undefined' || typeof window.CustomEvent !== 'function') return
    if (!node) {
      window.dispatchEvent(new CustomEvent('legend:highlight', { detail: { kind: null } }))
      return
    }
    const id = String(node.id || '')
    const detail = { kind: null, label: node.label, filterExpr: node.filter }
    if (id.startsWith('region:'))       detail.kind = 'region'
    else if (id.startsWith('block:'))   detail.kind = 'block'
    else if (id.startsWith('country:')) detail.kind = 'country'
    window.dispatchEvent(new CustomEvent('legend:highlight', { detail }))
  }

  return { aggregated, regionsTree, highlight }
}