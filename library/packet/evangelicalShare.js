/**
 * evangelicalShare — the evangelical share of ONE packet's own people groups.
 *
 * The packet's "% evangelical" page says each box is a share of the people in this list. It printed a
 * single DOXA-wide figure in every packet instead. This sums the packet's own groups, by the same method
 * the DOXA-wide figure uses (each group's published EvangelicalLevel band at its midpoint, weighted by
 * population — see library/scripts/people-groups/build-evangelical-share.mjs, whose table reproduces
 * that figure exactly when summed over every DOXA group).
 *
 * Pure, zero imports, so the browser print and the offline generator run the identical sum.
 *
 * @param {Array<{slug:string}>} groups  the packet's rows
 * @param {{groups: Object<string,[number,number]>}} table  evangelical-by-slug.json
 * @returns {{groupsInList:number, groupsMatched:number, population:number, evangelicalPopulation:number,
 *            pctEvangelical:(number|null)}|null}
 *   pctEvangelical is null when none of the packet's groups has a published level: the page then prints
 *   a dash, never a number — above all never a DOXA-wide number presented as this list's.
 *   null for no table at all, so the page is omitted rather than drawn from nothing.
 */
export function evangelicalShareFor(groups, table) {
  const bySlug = table && table.groups
  if (!bySlug || typeof bySlug !== 'object') return null
  const rows = Array.isArray(groups) ? groups : []
  let population = 0, evangelical = 0, matched = 0
  for (const g of rows) {
    const e = g && bySlug[g.slug]
    if (!Array.isArray(e)) continue
    const [pct, pop] = e
    if (!Number.isFinite(pct) || !Number.isFinite(pop)) continue
    matched++
    population += pop
    evangelical += (pop * pct) / 100
  }
  return {
    groupsInList: rows.length,
    groupsMatched: matched,
    population,
    evangelicalPopulation: Math.round(evangelical),
    pctEvangelical: population > 0 ? (100 * evangelical) / population : null,
  }
}
