/**
 * zoneData.js — fetch the published UPG-100 zone tables and build the legend's tree.
 *
 * The tables belong to upg100 and are now published: L62 moved them into data/tables/, so the
 * tree copies them into the asset pool and both plugins read ONE file. That is why this fetches
 * rather than imports — a relative import into another plugin's folder is refused by
 * check:no-cross-plugin-imports, and a per-plugin copy is the drift the single-source move exists
 * to prevent.
 *
 * FETCHED ONCE and shared, like the neighbour table beside it.
 *
 * ⚠ THE TREE IS READY; THE FILTER IS NOT. Mapping a GROUP to a zone still runs through
 * admin-to-list.json, which exp measured as an older partition — 69 groups land in the wrong
 * printable zone and 436 in Unassigned. That is row 87. So this builds and counts
 * the tree, and the caller must not filter rows on it until the fold lands.
 */
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { buildZoneTree } from './zoneTree.js'

let pending = null

/** { nodes, allZoneIds, definitions } from the published tables. Rejects loudly. */
export function loadZoneTree(cfg = {}, counts = {}) {
  if (!pending) {
    pending = (async () => {
      const base = resolveAssetsBase(cfg)
      const [zr, gr] = await Promise.all([
        fetch(cfg.zoneRegionsUrl || `${base}/tables/zone-regions.json`).then(okJson),
        fetch(cfg.groupingsUrl || `${base}/tables/groupings.json`).then(okJson),
      ])
      // ★ groupings.label IS A DEFINITION, NOT A NAME, and using it as one would make the
      // legend unreadable. Measured on the published file: the labels run from 7 to 206
      // characters, and the long ones are the zone's MEMBER LIST — Tibet's reads "Tibet
      // Autonomous Region + Sichuan Province + Xinjiang Uyghur Autonomous Region + ... +
      // North Korea". Only one of the fourteen is a plain name.
      // So the tree's NAME comes from the slug, which is uniform by construction, and the
      // label is carried separately as the zone's DEFINITION — which is what it actually is,
      // and useful where there is room to say what a zone contains.
      const definitions = {}
      for (const [id, g] of Object.entries(gr || {})) if (g && g.label) definitions[id] = g.label
      return { zoneRegions: zr || {}, definitions }
    })()
  }
  return pending.then(({ zoneRegions, definitions }) => ({
    zoneRegions,
    definitions,
    // No `labels` passed: buildZoneTree falls back to humanising the slug, which gives every
    // zone a name of the same shape rather than one name and thirteen member lists.
    nodes: buildZoneTree(zoneRegions, { counts }),
    // EVERY zone the data can name, not just the ones filed under a region. The legend renders
    // the difference as a named bucket; passing only the tree's ids would drop the unfiled ones
    // with no error and no empty state — just a shorter list.
    allZoneIds: Object.keys(zoneRegions),
  }))
}

function okJson(res) {
  if (!res.ok) throw new Error(`${res.status} ${res.url}`)
  return res.json()
}
