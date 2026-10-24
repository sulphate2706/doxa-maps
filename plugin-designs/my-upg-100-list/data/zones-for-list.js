/**
 * zones-for-list — which ZONES a project list is clustered into.
 *
 * THE GAP THIS CLOSES. Membership is already parameterised by list: library/lists/lists.json registers
 * five (doxa = Project 2000, unreached = 7000, frontier = 4700, frontier-500k = 700, unengaged), and
 * resolvePeopleGroupList(profileConfig) already picks one from `config.list` / `?list=` / window.MAP_LIST
 * with a default. What NO list has is ZONES: a list file says WHICH people groups, and nothing says how
 * to cluster them into the ~100-group printable zones a poster needs. clusters.json is UPG-100's, and it
 * was the only answer available.
 *
 * ★ WHY THIS IS A RESOLVER AND NOT A DYNAMIC IMPORT. The two consumers do:
 *       import { lists, asia_lists, uncovered_lists } from './data/clusters.json'
 *   and that NAMED import is load-bearing — its own comment says so: only the zone arrays ship, while
 *   clusters.json's eight bookkeeping fields (version, generated, source_total, validation_run, …) are
 *   tree-shaken out. Swapping it for `await import(path)` would ship the whole file in every bundle, and
 *   would make the zone list asynchronous in code that reads it synchronously at setup. So the default
 *   stays a static named import, and alternates are REGISTERED rather than computed from a path.
 *
 * ⚠ AND THE DEFAULT MUST BE THE OLD BEHAVIOUR EXACTLY. A list with no zones of its own gets UPG-100's,
 * which is what every caller gets today — so this file is inert until someone registers a second set.
 * That is deliberate: the pattern has to be landable before any second list exists, or it cannot be the
 * thing the second list is built against.
 *
 * ★ WHAT A NEW LIST ACTUALLY SHIPS, and this is the pattern for another agent to follow:
 *   1. data/zones/<list-id>.json          the four zone-bearing keys, same shape as clusters.json:
 *                                        lists / deaf_lists / asia_lists / uncovered_lists
 *   2. data/zoning-declarations.<id>.json the facts a gate cannot infer — bloc zones, expected orphans,
 *                                        known geographic overlaps, page budget
 *   3. one line in ZONES_BY_LIST below
 * Then `npm run check:zoning-declared -- --list <id>` grades the zoning, and the legend, poster wall and
 * packet all follow, because all three already enumerate through leafZones(buildLegendNodes(zones)).
 *
 * ZONING RULE (2026-09-27), recorded here because it is the judgement the format cannot
 * capture: cluster by GEOGRAPHY FIRST so the poster maps make sense, balanced with LANGUAGE — languages
 * usually cluster geographically, so the two mostly agree, and where they disagree geography wins for a
 * map's sake. UPG-100's own 28 already mix the two: the country_codes zones are geographic, and the 12
 * India/China pg_slugs zones are hand groupings where language and geography were traded off.
 *
 * ⚠ THE DEAF ZONE IS THE KNOWN EXCEPTION AND MUST NOT BE FORCED. `deaf` is affinity bloc A017: 123 groups
 * spanning every region, global by construction, and the one poster whose zone cannot be a map extent. It
 * breaks the geography-first rule the rest of the pattern rests on, and it is recorded as not yet
 * solved. A list whose clusters include an affinity or language bloc inherits the same open question —
 * declare it in bloc_zones so the gate treats it as a second partition, and do NOT invent a geography for
 * it to make a validator happy.
 *
 * ⚠ THIS MODULE IS BROWSER/VITE-ONLY, BY CONSTRUCTION. The static JSON import below is what keeps the
 * tree-shaking (see above), and bare `import … from './x.json'` is a bundler feature: plain Node throws
 * ERR_IMPORT_ASSERTION_TYPE_MISSING without an `with { type: 'json' }` attribute. That is fine and is the
 * existing convention here — NO Node-side file imports clusters.json as a module; packet.mjs and every
 * gate read it with readFileSync + JSON.parse (packet.mjs:125). So a Node consumer that wants the same
 * resolution should read the JSON itself and pass the object on, rather than importing this file.
 */
import { lists, deaf_lists, asia_lists, uncovered_lists } from './clusters.json'

/** UPG-100's zones — the default for every list until one registers its own. */
const UPG_100_ZONES = { lists, deaf_lists, asia_lists, uncovered_lists }

/**
 * list id → its zone set.
 * ★ A REGISTRY, NOT A DIRECTORY SCAN: each entry is a static import somewhere, so the bundler can see
 * which zone files a bundle actually reaches and drop the rest. A scan would defeat that and would also
 * make a missing file a runtime error instead of a build one.
 */
const ZONES_BY_LIST = {
  // 'project-3000': PROJECT_3000_ZONES,   ← the shape a second list adds
}

/**
 * The zones for a list id.
 *
 * @param {string} [listId]  as returned by resolvePeopleGroupList(profileConfig)
 * @returns {{lists:Array, deaf_lists?:Array, asia_lists:Array, uncovered_lists:Array}}
 *
 * ⚠ FALLS BACK RATHER THAN THROWING, and says so once. A list without registered zones is the NORMAL
 * state right now (five lists, one zone set), so throwing would break every caller for a condition that
 * is expected. But it is silent-wrong-data territory — a reader would see UPG-100's zones under another
 * list's name and have no way to tell — so it warns exactly once per id, naming what it did.
 */
const warned = new Set()
export function zonesForList(listId) {
  const id = String(listId || '')
  const own = ZONES_BY_LIST[id]
  if (own) return own
  if (id && !warned.has(id) && typeof console !== 'undefined') {
    warned.add(id)
    console.warn(`[zones] list "${id}" has no zones of its own; showing UPG-100's ${countZones(UPG_100_ZONES)} `
      + 'zones. Register a set in data/zones-for-list.js to give it its own poster clusters.')
  }
  return UPG_100_ZONES
}

/** Zone count across the zone-bearing keys. NOT a leaf count — buildLegendNodes collapses deaf_lists. */
export function countZones(zones) {
  let n = 0
  for (const k of ['lists', 'asia_lists', 'uncovered_lists']) n += (zones?.[k] || []).length
  // ★ deaf_lists is counted as ONE, not as its member count: legend-tree collapses its two entries into a
  // single unified leaf (legend-tree.js:106, "13 + 12 + 2 + 1 deaf = 28"). Counting its members would
  // report 29 for a 28-leaf tree — a number that disagrees with every other count in the app.
  if ((zones?.deaf_lists || []).length) n += 1
  return n
}

/** Every list id that has its own zones — for a gate or a diagnostic to enumerate. */
export function listsWithOwnZones() { return Object.keys(ZONES_BY_LIST) }
