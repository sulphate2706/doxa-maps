/**
 * upgZones.js — join a people group to its UPG-100 zone.
 *
 * THE CHAIN, and why it needs three files. UPG-100 lists are defined by ADMIN REGION
 * ("Tibet Autonomous Region", "Gujarat"); the people-group tables are keyed by group.
 * They share no id, so the bridge is the province assignment:
 *
 *   admin-to-list.json   admin name        -> zone id
 *   gospel-by-province-groups.json  group  -> province name
 *
 * ★ ADMIN NAMES ARE MATCHED WITH DIACRITICS FOLDED, and that is load-bearing rather than
 * defensive. The two files disagree on spelling: the zone table writes `gujarat`, the
 * province table writes `Gujarāt`; likewise Karnātaka, Tamil Nādu, Uttarākhand, Jammu and
 * Kashmīr, Haryāna. Matching on `.toLowerCase()` alone resolves 514 of 1009 rows across 9
 * zones. Folding the combining marks resolves 1009 of 1009 across 12 zones.
 *
 * That 50.9% is the dangerous number, not the 100%: a legend built on it would have shown
 * half the groups and three fewer zones with NOTHING ON SCREEN SAYING SO — every zone would
 * still have looked populated, just smaller. Fold here rather than adding spellings to the
 * zone table, so a future source spelling cannot reopen it.
 */

/** Lowercase and strip combining marks, so `Gujarāt` and `gujarat` are the same key. */
export function foldAdmin(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .trim()
    .toLowerCase()
}

/** Build a folded lookup from the zone table's `admin name -> zone id` map. */
export function zoneIndex(adminToList) {
  const ix = new Map()
  for (const [admin, zone] of Object.entries(adminToList || {})) ix.set(foldAdmin(admin), zone)
  return ix
}

/** The zone id for a province name, or null when the province is in no UPG-100 list. */
export function zoneFor(ix, province) {
  return ix.get(foldAdmin(province)) ?? null
}

/**
 * group key -> zone id, from the province bridge rows.
 * `key` decides the join key into whatever table the caller holds; the default
 * `(name, iso3)` is the pair that matches near-neighbors at 994/1009.
 */
export function zonesByGroup(adminToList, provinceRows, key = (r) => `${r.people_group}|${r.iso3}`) {
  const ix = zoneIndex(adminToList)
  const out = new Map()
  for (const r of provinceRows || []) {
    const z = zoneFor(ix, r.province)
    if (z) out.set(key(r), z)
  }
  return out
}

/**
 * ── THE SECOND JOIN: COUNTRY GRAIN ───────────────────────────────────────────
 *
 * The province bridge above only reaches India and China, because that is all
 * gospel-by-province-groups.json holds (IND 855 + CHN 154 rows). Every other
 * UPG-100 zone needs a different path, and upg100 already built it: each zone in
 * clusters.json carries a SELECTOR, and selector-evaluator.js turns a selector
 * plus a set of people-group records into the set of slugs in that zone.
 *
 * So this is an adapter, not a new join. Three paths, and which one a zone needs
 * is a property of the zone, not a fallback chain:
 *
 *   pg_slugs zones   -> the selector IS the membership; match on slug.
 *                       The evaluator REJECTS this type ON PURPOSE (it throws and
 *                       names the supported types) because there is nothing to
 *                       evaluate — reading `selector.pg_slugs` is the whole join.
 *   country selectors -> evaluate(): country_code, country_codes, union,
 *                       wagf_block, wagf_region, deaf_predicate, affinity_bloc.
 *   province zones    -> the fold above.
 *
 * ⚠ THE RECORD SHAPE IS FLAT, and this cost me a run. The evaluator reads
 * `r.country_code === want` — a plain string. The file header describes the
 * source fields as `{ value, label }`, which is the shape BEFORE normalize.js
 * flattens them. Passing `{ value }` here matches nothing and returns an empty
 * Set for every zone, which looks exactly like "this zone has no groups" rather
 * than like a bug. Pass flattened records.
 */

/** near-neighbors decoded row -> a record the selector evaluator understands. */
export function toSelectorRecord(row, slug) {
  return {
    slug,
    country_code: row.iso3 ?? null,   // FLAT, not { value }
    name: row.name ?? null,
    language: row.langName ?? null,
    rop1: row.bloc ?? null,
  }
}

/**
 * zone id -> Set<slug>, for every zone whose selector this record set can answer.
 *
 * Zones whose selector needs a field the records do not carry come back as an
 * EMPTY SET rather than being omitted, and zones the evaluator rejects are
 * reported separately — an empty zone and an unanswerable zone are different
 * facts, and a legend that renders them the same way is lying about one of them.
 */
export function zonesBySelector(zoneLists, records, evaluate) {
  const members = new Map()
  const unanswerable = new Map()
  for (const z of zoneLists || []) {
    if (!z?.id || !z.selector) continue
    try {
      members.set(z.id, evaluate(z.selector, records))
    } catch (err) {
      unanswerable.set(z.id, z.selector.type)
    }
  }
  return { members, unanswerable }
}
