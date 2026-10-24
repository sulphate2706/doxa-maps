/**
 * packetSets — join a packet's people groups to the near-neighbours table and shape the result
 * for setsPage's two figures (bounded + centered).
 *
 * WHY THIS EXISTS: setsPage landed as a renderer capability with NO DATA SUPPLIER — it returns ''
 * without data, correctly, which meant the FULL-DETAIL packet had never once printed its
 * distinguishing back page in real use. This module is the supplier. It is PURE and has ZERO
 * imports, deliberately: the same function runs under Node (the offline generator reads the table
 * from disk) and under Vite (the browser path fetches it), so the JOIN cannot fork between the two.
 *
 * THE TABLE ARRIVES RAW ({ cols, dict, rows }) AND FETCHING STAYS WITH THE CALLER — same seam
 * pattern as `strings` and `describe`: each host supplies what it can reach, and this module owns
 * only the decode + join. The decode duplicates the shape gospel's nearRows.js reads (which itself
 * documents being a copy of upg-neighbor's, pending promotion to library/) — a THIRD reading of one
 * format is real debt, flagged rather than hidden: when the loader is promoted, this module's
 * decode collapses into it and only the join below remains.
 *
 * THE RING STATES, as the data owner defines them (nearRows.js:12-17, kept in the same words so
 * the two files cannot drift silently):
 *   1-10  placed          0  REACHED (the centre)          -1  unreached, no relation found
 *   absent row = the source does not carry the group; counted here as `unmatched` and REPORTED,
 *   because on a printed page a category the reader cannot see reads as zero.
 */

/** Decode the raw { cols, dict, rows } table into a Map keyed by slug. */
export function decodeNearTable(raw) {
  if (!raw || !Array.isArray(raw.cols) || !Array.isArray(raw.rows)) return new Map()
  const ix = Object.fromEntries(raw.cols.map((c, i) => [c, i]))
  const dict = raw.dict || {}
  const dec = (r, c) => (c in ix ? (dict[c] ? dict[c][r[ix[c]]] : r[ix[c]]) : undefined)
  const bySlug = new Map()
  for (const r of raw.rows) {
    const slug = dec(r, 'slug')
    if (!slug) continue
    bySlug.set(String(slug), {
      reached: dec(r, 'reached') === 1,
      ring: dec(r, 'ring'),
      ringNb: dec(r, 'ringNb'),
    })
  }
  return bySlug
}

/**
 * buildPacketSets(groups, rawTable) -> { bounded, centered, unmatched } | null
 *
 * bounded:  [{ id, label, reached }]           reached undefined = the table lacks the group —
 *                                              UNKNOWN, which layoutBoundedSet inks as its own
 *                                              category rather than guessing a side.
 * centered: [{ id, label, ring, neighborId }]  ring passed through untouched: 0 goes to the
 *                                              centre, -1 to unplaced, both by the layout's own
 *                                              rules — mapping them here would duplicate its
 *                                              policy and drift.
 * Returns null when NOTHING joined: a sets page about none of the packet's groups would be a
 * chart of the join failure, not of the people, and setsPage's ''-without-data rule is the
 * honest rendering of that.
 */
export function buildPacketSets(groups, rawTable) {
  const bySlug = decodeNearTable(rawTable)
  if (!bySlug.size || !Array.isArray(groups) || !groups.length) return null
  const bounded = []
  const centered = []
  let matched = 0
  for (const g of groups) {
    const id = String(g.slug || g.id || '')
    if (!id) continue
    const label = g.name || id
    const row = bySlug.get(id)
    if (!row) {
      // Unknown side of the boundary — inked, never guessed. No centered entry: a ring is a
      // measurement, and an absent row has none to report.
      bounded.push({ id, label, reached: undefined })
      continue
    }
    matched++
    bounded.push({ id, label, reached: row.reached })
    centered.push({ id, label, ring: row.ring, neighborId: row.ringNb == null ? null : String(row.ringNb) })
  }
  if (!matched) return null
  return { bounded, centered, unmatched: bounded.length - matched }
}
