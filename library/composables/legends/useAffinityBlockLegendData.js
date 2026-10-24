/**
 * useAffinityBlockLegendData — 4-tier affinity-block legend data for SemanticTreeLegend.
 *
 * Mirrors the public surface of useLanguageFamilyLegendData (rows, langTree-equiv,
 * highlight) so research-map.vue can swap data sources by activeLegendType while
 * reusing the SAME <SemanticTreeLegend> component (no duplicate legend).
 *
 * Tree shape: 4 tiers — Affinity Block → Cluster → People Group → People Group in Country.
 *
 *   { id: 'bloc:A008',                                        ← rop1
 *     label: 'Malay Peoples', color, count, pop, filter,
 *     children: [{
 *       id: 'cluster:A008__C0059',                            ← imb_reg_of_people_2
 *       label: 'Borneo-Kalimantan', ...,
 *       children: [{
 *         id: 'pg:A008__C0059__300005',                       ← imb_reg_of_people_25 (ROP 2.5)
 *         label: 'Abai Sungai', ...,
 *         children: [{
 *           id: 'pgic:abai-sungai',                            ← unique row (slug)
 *           label: 'Abai Sungai, Malaysia', ...,
 *           filter: ['==', ['get', 'uniqueId'], 'abai-sungai'],
 *           children: []
 *         }]
 *       }]
 *     }]
 *   }
 *
 * For most pgs, tier-3 → tier-4 fan-out is 1:1 (the people group exists in only
 * one country). For the small number of pgs that span multiple countries
 * (e.g. "Bantu Swahili" in 3 countries, JPID 15145), tier 3 has multiple tier-4
 * children — researchers see "the same people group, multiple country instances"
 * at a glance.
 *
 * Pin properties used in filter expressions (after DataSourceManager normalization):
 *   - properties.affinityBlock      = rop1 value (e.g. 'A008')
 *   - properties.cluster            = imb_reg_of_people_2 value (e.g. 'C0059')
 *   - properties.peopleGroup        = imb_reg_of_people_25 value (e.g. '300005')
 *   - properties.uniqueId           = slug (per-row identity)
 */

import { computed } from 'vue'
// Single source of truth — pins paint with this same palette, keyed by ROP1 code.
// Resolving the SAME strategy the pins use keeps legend ↔ map in lock-step (was a
// separate name-keyed palette causing pin/legend drift). affinity-block is a per-map
// strategy, which NOW LIVES IN library/colors/affinity-block.js (C1): it was private to
// plugin-designs/doxa-research-map/ and duplicated in country-posters, where the stale copy
// covered only A001-A017 and sent 134 Tibetan/Himalayan rows to the grey fallback.
// It is resolved via the registry, which now discovers it from library/colors/ for EVERY
// bundle rather than from one plugin's local glob -- that is the whole point of the move.
// Read LAZILY (at call time
// inside blocColor — this composable is only invoked by research surfaces) so
// registration has already run, and GUARDED on propertyKey — getColorStrategy
// silently falls back to language-family for unregistered modes, and that palette
// must not masquerade as bloc colors.
import { getColorStrategy, COLOR_MODES } from '../../colors/_registry.js'

const FALLBACK_COLOR = '#6b7280'

function pinPalette() {
  const strat = getColorStrategy(COLOR_MODES.AFFINITY_BLOCK)
  return (strat && strat.propertyKey === 'affinityBlock' && strat.palette) ? strat.palette : {}
}

function blocColor(blocCode, blocLabel) {
  // Code-keyed lookup matches the pin paint expression exactly.
  const palette = pinPalette()
  if (blocCode && palette[blocCode]) return palette[blocCode]
  return FALLBACK_COLOR
}

function readProps(item) { return item?.properties || item || {} }
function unwrap(v) {
  if (v && typeof v === 'object' && 'label' in v) return v.label || v.value || ''
  return v
}
function readBlocCode(p)        { return String(p.affinityBlock || unwrap(p._raw?.rop1) || '').trim() }
// typeof null === 'object' — the JS trap that took down four research-map tabs
// (2026-09-16): an API record with rop1:null passed the typeof check and read
// null.label. Every extractor below now null-guards first.
function readBlocLabel(p)       { return String(p.affinityBlockLabel || (p._raw?.rop1 && typeof p._raw.rop1 === 'object' ? p._raw.rop1.label : '') || '').trim() }
function readClusterCode(p)     { return String(p.cluster || unwrap(p._raw?.imb_reg_of_people_2) || '').trim() }
function readClusterLabel(p)    { return String(p.clusterLabel || (p._raw?.imb_reg_of_people_2 && typeof p._raw.imb_reg_of_people_2 === 'object' ? p._raw.imb_reg_of_people_2.label : '') || '').trim() }
function readPgCode(p)          { return String(p.peopleGroup || unwrap(p._raw?.imb_reg_of_people_25) || '').trim() }
function readPgLabel(p)         { return String(p.peopleGroupLabel || (p._raw?.imb_reg_of_people_25 && typeof p._raw.imb_reg_of_people_25 === 'object' ? p._raw.imb_reg_of_people_25.label : '') || p.name || '').trim() }
function readPgicId(p)          { return String(p.uniqueId || p.slug || p._raw?.slug || '').trim() }
function readPgicName(p)        { return String(p.name || p.displayName || p._raw?.name || '').trim() }
function readPop(p) {
  const n = Number(p.population ?? p.populationNum ?? p._raw?.population ?? 0)
  return Number.isFinite(n) ? n : 0
}
function readCountry(p) {
  return String(p.countryName || p.country || p.countryIsoLabel || p.countryIso || '').trim()
}

export function useAffinityBlockLegendData(peopleGroupsRef) {
  // 4-tier aggregate: bloc → cluster → people-group (rop25) → people-group-in-country (slug rows)
  const aggregated = computed(() => {
    const list = (peopleGroupsRef && peopleGroupsRef.value) || []
    const blocs = new Map()
    for (const item of list) {
      const p = readProps(item)
      const blocCode  = readBlocCode(p)
      const blocLabel = readBlocLabel(p) || blocCode || '— Unknown —'
      const clCode    = readClusterCode(p)
      const clLabel   = readClusterLabel(p) || clCode || '— Unknown —'
      const pgCode    = readPgCode(p)
      const pgLabel   = readPgLabel(p) || pgCode || '— Unknown —'
      const pgicId    = readPgicId(p)
      const pgicName  = readPgicName(p) || pgicId
      const pop       = readPop(p)
      const country   = readCountry(p)

      if (!pgicId) continue

      // Tier 1: bloc
      let bloc = blocs.get(blocCode || '__unknown__')
      if (!bloc) {
        bloc = { code: blocCode, label: blocLabel, count: 0, pop: 0, memberIds: [], clusters: new Map() }
        blocs.set(blocCode || '__unknown__', bloc)
      }
      bloc.count += 1
      bloc.pop   += pop
      bloc.memberIds.push(pgicId)

      // Tier 2: cluster
      let cluster = bloc.clusters.get(clCode || '__unknown__')
      if (!cluster) {
        cluster = { code: clCode, label: clLabel, count: 0, pop: 0, memberIds: [], peopleGroups: new Map() }
        bloc.clusters.set(clCode || '__unknown__', cluster)
      }
      cluster.count += 1
      cluster.pop   += pop
      cluster.memberIds.push(pgicId)

      // Tier 3: people group (rop25)
      let pg = cluster.peopleGroups.get(pgCode || '__unknown__')
      if (!pg) {
        pg = { code: pgCode, label: pgLabel, count: 0, pop: 0, memberIds: [], instances: [] }
        cluster.peopleGroups.set(pgCode || '__unknown__', pg)
      }
      pg.count += 1
      pg.pop   += pop
      pg.memberIds.push(pgicId)

      // Tier 4: people group in country (one entry per row)
      pg.instances.push({ id: pgicId, name: pgicName, country, pop })
    }
    return blocs
  })

  // ── Row filter by MEMBER IDS (robust to code/label drift) ─────────────────
  // The bloc/cluster/PG rows used to filter by CODE
  // (['==',['get','affinityBlock'|'cluster'|'peopleGroup'], code]). That silently
  // matched nothing on the map — the affinity tab DIMS via ['case', node.filter, 1, 0],
  // so a non-matching filter drove EVERY pin to opacity 0 ("counts right, pins don't
  // show"). The leaf (PGIC) rows already filter by uniqueId and worked, proving the
  // per-pin uniqueId is the reliable key. So every tier now filters by the exact
  // member uniqueIds we already aggregated — no dependency on which code/label form
  // the pin properties happen to carry. ()
  const memberFilter = (ids) =>
    (ids && ids.length)
      ? ['in', ['get', 'uniqueId'], ['literal', ids]]
      : ['==', ['get', 'uniqueId'], '__none__']   // matches nothing (never blanks all pins)

  // ── affinityTree — generic semantic-tree shape for SemanticTreeLegend ─────
  // Same shape contract as useLanguageFamilyLegendData.langTree:
  //   { id, label, color, count, pop, filter, children }
  const affinityTree = computed(() => {
    const blocs = aggregated.value
    const out = []
    for (const bloc of blocs.values()) {
      const color = blocColor(bloc.code, bloc.label)
      const blocNode = {
        id:    `bloc:${bloc.code || bloc.label}`,
        label: bloc.label,
        color,
        count: bloc.count,
        pop:   bloc.pop,
        filter: memberFilter(bloc.memberIds),
        children: [],
      }
      for (const cluster of bloc.clusters.values()) {
        const clusterNode = {
          id:    `cluster:${bloc.code}__${cluster.code || cluster.label}`,
          label: `${cluster.label} (Cluster)`,
          color,
          count: cluster.count,
          pop:   cluster.pop,
          filter: memberFilter(cluster.memberIds),
          children: [],
        }
        for (const pg of cluster.peopleGroups.values()) {
          const pgNode = {
            id:    `pg:${bloc.code}__${cluster.code}__${pg.code || pg.label}`,
            label: `${pg.label} (PG)`,
            color,
            count: pg.count,
            pop:   pg.pop,
            filter: memberFilter(pg.memberIds),
            children: [],
          }
          // Tier 4: each row = one people-group-in-country instance.
          // Sort by population desc so most-populous country instance leads.
          pg.instances.sort((a, b) => (b.pop - a.pop) || a.country.localeCompare(b.country))
          for (const inst of pg.instances) {
            pgNode.children.push({
              id:    `pgic:${inst.id}`,
              label: `${inst.country ? `${inst.name}, ${inst.country}` : inst.name} (PGIC)`,
              color,
              count: 1,
              pop:   inst.pop,
              filter: ['==', ['get', 'uniqueId'], inst.id],
              children: [],
            })
          }
          clusterNode.children.push(pgNode)
        }
        // Sort people groups by count desc, then pop desc
        clusterNode.children.sort((a, b) => (b.count - a.count) || (b.pop - a.pop))
        blocNode.children.push(clusterNode)
      }
      // Sort clusters by count desc, then pop desc
      blocNode.children.sort((a, b) => (b.count - a.count) || (b.pop - a.pop))
      out.push(blocNode)
    }
    // Sort blocs by count desc, then pop desc
    out.sort((a, b) => (b.count - a.count) || (b.pop - a.pop))
    return out
  })

  // ── highlight — fires legend:highlight window event (parity with useLanguageFamilyLegendData) ──
  function highlight(node) {
    if (typeof window === 'undefined' || typeof window.CustomEvent !== 'function') return
    if (!node) {
      window.dispatchEvent(new CustomEvent('legend:highlight', { detail: { kind: null } }))
      return
    }
    const id = String(node.id || '')
    const detail = { kind: null, label: node.label, filterExpr: node.filter }
    if (id.startsWith('bloc:'))         detail.kind = 'bloc'
    else if (id.startsWith('cluster:')) detail.kind = 'cluster'
    else if (id.startsWith('pg:'))      detail.kind = 'people-group'
    else if (id.startsWith('pgic:'))    detail.kind = 'people-group-in-country'
    window.dispatchEvent(new CustomEvent('legend:highlight', { detail }))
  }

  return { aggregated, affinityTree, highlight }
}

export default useAffinityBlockLegendData
