/**
 * zone-sheet.js — which people groups a map sheet pins, decided ONCE for the Node generator and the
 * browser alike.
 *
 * generate.mjs used to hold this in its main routine: attach each leaf zone's selector, then give every
 * people group to the FIRST zone that claims it and pin it there. A browser that draws the same sheet
 * must make exactly the same assignment, or the "same" poster pins a group in a different zone
 * depending on where it was printed. So both import this module; neither keeps its own copy.
 *
 * Pure: no fs, no fetch, no DOM. The caller supplies the records (with latitude/longitude).
 */
import { buildLegendNodes, leafZones, DEAF_SELECTOR } from './legend-tree.js';
import { evaluate } from './selector-evaluator.js';

/** The UPG-100 leaf zones, each carrying its selector (leaves do not carry it; the catalogue does). */
export function upg100Zones(clusters, records) {
  const zones = leafZones(buildLegendNodes(clusters, { records }));
  const byId = {};
  for (const l of clusters.lists || []) byId[l.id] = l.selector;
  for (const a of clusters.asia_lists || []) byId[a.id] = a.selector;
  for (const u of clusters.uncovered_lists || []) byId[u.id] = u.selector;
  byId['deaf'] = DEAF_SELECTOR;   // defined once in legend-tree.js
  for (const z of zones) z.selector = byId[z.id];
  return zones;
}

/**
 * zoneKey -> the pins of that zone. A group belongs to the FIRST zone (in `zones` order) whose selector
 * claims it; groups without coordinates are not pinned. Pins keep the records' own order.
 * `onSkip(zone, error)` hears about a selector that could not be evaluated (the zone then pins nothing).
 */
export function assignPins(zones, records, { onSkip = null } = {}) {
  const slugToZone = {};
  for (const z of zones) {
    if (z.selector && z.selector.type === 'pg_slugs') {
      for (const s of (z.selector.values || [])) if (!(s in slugToZone)) slugToZone[s] = z.zoneKey;
    } else if (z.selector) {
      try { for (const s of evaluate(z.selector, records)) if (!(s in slugToZone)) slugToZone[s] = z.zoneKey; }
      catch (e) { if (onSkip) onSkip(z, e); }
    }
  }
  const pinsByZone = new Map(zones.map((z) => [z.zoneKey, []]));
  for (const r of records) {
    const lat = Number(r.latitude), lng = Number(r.longitude);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const zk = slugToZone[r.slug];
    if (zk && pinsByZone.has(zk)) pinsByZone.get(zk).push({
      name: r.name || r.slug || '', lat, lng, slug: r.slug, country_code: r.country_code,
      population: r.population,
    });
  }
  return pinsByZone;
}

/** "Map N of M" and the total the poster states, from the zones being generated. */
export function seriesFacts(zones) {
  return { totalGroups: zones.reduce((a, z) => a + (z.count || 0), 0), totalLists: zones.length, index: 1 };
}
