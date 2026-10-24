// zone-geometry.js — slice 04t §1(b)
//
// resolveZoneGeometry(zone, deps) -> FeatureCollection
//
// Per legend row ("zone"), returns the polygons it needs, each feature stamped
// with the row's `zoneKey` + `zoneColor` so the tapestry's single Mapbox
// ['match', ['get','zoneKey'], …] fill expression can paint all 26 at once.
//
// Resolution rules (S04t-D1/D2/D3):
//   - REGIONAL (13) + DEAF (1):  ADM0 country polygons.
//       member countries = evaluate(zone.selector, records) -> slugs
//                          -> distinct country_code over those member records
//                          -> ADM0 features whose props.iso3 ∈ that set.
//       (deaf's selector is affinity_bloc/A017 → its 123 members' country_codes.)
//   - ASIA (12):  ADM1 features. Asia rows are state-CLUSTERS, so SELECT-MANY:
//       every ADM1 feature whose props.listId === zone.id (the on-disk
//       gb-IND-ADM1 / gb-CHN-ADM1 files are pre-tagged with listId).
//
// Design contract:
//   - always returns a FeatureCollection (never null); empty features ⇒ a zone
//     the proof will FLAG (every zone must resolve ≥1 polygon).
//   - separate polygons sharing one zone color (S04t-D3); no dissolve here.
//   - pure: no Mapbox / DOM; testable in plain Node.

import { evaluate } from './selector-evaluator.js';

const EMPTY_FC = () => ({ type: 'FeatureCollection', features: [] });

// Distinct country_code (ISO3) set for a zone's member UPGs.
// `records` are normalized (country_code flat); rop1 stays nested (selector reads it).
export function memberCountryCodes(zone, records) {
  const slugs = evaluate(zone.selector, records);
  const iso = new Set();
  for (const r of records) {
    if (r && slugs.has(r.slug) && r.country_code) iso.add(r.country_code);
  }
  return iso;
}

// True for the 12 Asia rows (admin-1 resolution).
export function isAsiaZone(zone) {
  return typeof zone.id === 'string' && zone.id.startsWith('asia-');
}

function stamp(feature, zone) {
  return {
    type: 'Feature',
    properties: {
      ...(feature.properties || {}),
      zoneKey: zone.zoneKey ?? zone.id,
      zoneColor: zone.color ?? zone.zoneColor ?? '#888',
      zoneLabel: zone.label,
      ...(zone.id === 'deaf' ? { hatch: true } : {}),
    },
    geometry: feature.geometry,
  };
}

/**
 * resolveZoneGeometry(zone, deps) -> FeatureCollection
 * @param {object} zone   a leaf zone { id, zoneKey, label, color, selector? }
 * @param {object} deps
 * @param {Array}  deps.records   normalized UPG records (rop1-bearing for deaf)
 * @param {object} deps.adm0      FeatureCollection of ADM0 (features props.iso3)
 * @param {object} deps.adm1Ind   FeatureCollection gb-IND-ADM1 (props.listId)
 * @param {object} deps.adm1Chn   FeatureCollection gb-CHN-ADM1 (props.listId)
 */
export function resolveZoneGeometry(zone, deps) {
  const { records = [], adm0, adm1Ind, adm1Chn } = deps || {};
  const fc = EMPTY_FC();

  if (isAsiaZone(zone)) {
    // ADM1 select-many: every feature pre-tagged with this row's listId.
    const pools = [adm1Ind, adm1Chn].filter(Boolean);
    for (const pool of pools) {
      for (const f of pool.features || []) {
        if (f.properties && f.properties.listId === zone.id) fc.features.push(stamp(f, zone));
      }
    }
    // slice 09b-8 §1(c): the MIXED-GEOMETRY hook. An Asia zone may ALSO carry an
    // optional `adm0` array of ISO3 codes (the Nepal-frontier cluster: ['NPL']).
    // When present, union the matching ADM0 country polygons into the SAME zone so
    // a single legend row paints both its India states (ADM1) and Nepal (ADM0) as
    // one zone. Additive + opt-in: every other Asia zone lacks `adm0`, so this loop
    // is skipped and their resolution is byte-identical to 09b-7.
    if (Array.isArray(zone.adm0) && zone.adm0.length && adm0) {
      const want = new Set(zone.adm0);
      for (const f of adm0.features || []) {
        if (f.properties && want.has(f.properties.iso3)) fc.features.push(stamp(f, zone));
      }
    }
    return fc;
  }

  // Regional / deaf: ADM0 by member country_codes.
  if (!zone.selector) return fc; // a parent (asia/india/china) — no geometry of its own
  const iso = memberCountryCodes(zone, records);
  if (adm0 && iso.size) {
    for (const f of adm0.features || []) {
      if (f.properties && iso.has(f.properties.iso3)) fc.features.push(stamp(f, zone));
    }
  }
  return fc;
}

/**
 * resolveAllZones(zones, deps) -> { tapestry: FeatureCollection, perZone: Map }
 * Builds ONE FeatureCollection (all zones, each feature carrying its zoneKey) for
 * the single-source tapestry paint, plus a per-zone resolved-count map for the proof.
 */
export function resolveAllZones(zones, deps) {
  const tapestry = EMPTY_FC();
  const perZone = new Map();
  // deaf-polygon removal (design fix, an earlier fix): the `deaf` affinity overlay is an
  // ADM0 double-stamp — its A017 selector re-paints land already owned by the 13 geographic
  // zones (16 of oceania-indonesia's 18 Pacific ISO3 alone). That double-stamp showed deaf
  // TWICE and underlapped every other region in blue (#18ffff), and the overlapping deaf land
  // didn't color correctly until click-isolate re-filtered the source to one zone. The earlier
  // 09b draw-order mitigation (resolve deaf FIRST) only re-stacked the same overlapping geometry;
  // the directive is to REMOVE the deaf polygon/region layer entirely. So we EXCLUDE
  // the deaf zone from the tapestry (region-fill) FeatureCollection here. deaf stays fully in
  // the LIST/legend (built by legend-tree.js buildLegendNodes — untouched) and in the PINS
  // (built from slugToZone selectors in upg-100-list.vue — untouched). Only the polygon/region
  // fill loses deaf, which removes the overlap and the until-click coloring bug.
  for (const zone of zones) {
    if (zone.id === 'deaf') {
      // record 0 polygons for the proof's per-zone map; deaf intentionally has no region fill now.
      perZone.set(zone.zoneKey ?? zone.id, 0);
      continue;
    }
    const fc = resolveZoneGeometry(zone, deps);
    perZone.set(zone.zoneKey ?? zone.id, fc.features.length);
    for (const f of fc.features) tapestry.features.push(f);
  }
  return { tapestry, perZone };
}

export default resolveZoneGeometry;
