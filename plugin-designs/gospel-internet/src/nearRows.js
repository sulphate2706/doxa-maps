/**
 * nearRows.js — the near-neighbours table, fetched ONCE and shared by the set charts.
 *
 * Both the bounded set and the centered-set target read the same file, and it is the
 * largest thing either of them loads. A fetch per component would double that for no
 * gain, so the promise is cached and both await it.
 *
 * DECODING. Dictionary columns hold an index into dict[col]; plain columns hold the
 * value. rop3, ring and ringNb are plain.
 *
 * THE RING STATES, as the data owner defines them:
 *   1-10  placed, ringNb = the row index of the reached group that sets the ring
 *   0     REACHED (the centre). Verified on the shipped table: all 2,591 such rows
 *         carry reached=1, so this is not a "no answer" bucket.
 *   -1    unreached, no relation found. 11 rows, all with ringNb -1.
 *   absent row — a group the source does not carry at all. It cannot appear here, so
 *         the CONSUMER counts it at the join and says so.
 *
 * Duplicated from upg-neighbor's nearData.js rather than imported: a cross-plugin
 * import couples two separately-shipped bundles, and check:no-cross-plugin-imports
 * bars it. When the loader is promoted to library/ this collapses into it.
 */
import { resolveAssetsBase } from '@map/utils/embedBase.js'

let pending = null

/** Decode once; returns { rows, byKey, cols }. Rejects loudly — callers must show the failure. */
export function loadNearRows(cfg = {}) {
  if (pending) return pending
  pending = (async () => {
    const url = cfg.nearDataUrl || `${resolveAssetsBase(cfg)}/tables/near-neighbors.json`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    const d = await res.json()
    const ix = Object.fromEntries(d.cols.map((c, i) => [c, i]))
    const dec = (r, c) => (c in ix ? (d.dict[c] ? d.dict[c][r[ix[c]]] : r[ix[c]]) : undefined)
    const rows = d.rows.map((r) => ({
      slug: dec(r, 'slug') ?? null,
      name: dec(r, 'name'), iso3: dec(r, 'iso3'), rop3: dec(r, 'rop3') ?? null,
      reached: dec(r, 'reached') === 1, ring: dec(r, 'ring'), ringNb: dec(r, 'ringNb'),
    }))
    // Both keys, so a caller can prefer rop3 and still fall back to the name pair.
    // Three keys, strongest first. Each is added only when the table carries it, so a table
    // without the column simply yields no entries of that kind rather than an entry keyed on
    // undefined — which would match every row missing the field.
    const byKey = new Map()
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.slug) byKey.set(`s:${r.slug}`, i)
      byKey.set(`n:${String(r.name).toLowerCase()}|${String(r.iso3).toUpperCase()}`, i)
      if (r.rop3) byKey.set(`r:${r.rop3}|${String(r.iso3).toUpperCase()}`, i)
    }
    return { rows, byKey, cols: d.cols }
  })()
  return pending
}

/**
 * The row index for a dashboard row, rop3 first. Returns -1 when it does not join.
 *
 * ⚠ THE COUNTRY KEY IS `iso3`, NOT `country`. This read `g.country` and shipped: on these rows
 * `country` is the country's NAME ("Malaysia") while the table keys on ISO 3166 alpha-3 ("MYS"),
 * so the pair never matched and the rop3 path never fired either — the failure seen was
 * "not drawn: 2,104" on both set charts.
 *
 * It survived my own check because I measured the join with the PROVINCE table standing in for
 * the dashboard's rows, and those rows carry `iso3` rather than `country`. The stand-in satisfied
 * the key I had chosen, so the measurement confirmed the code against a shape the real caller does
 * not have. A proxy has to match the caller in the FIELDS THE CODE READS, or it is testing itself.
 *
 * `country` is still accepted as a last resort, because a row that carries only the name is better
 * joined than dropped — but it is tried after the ISO code, never instead of it.
 */
export function indexFor(byKey, g) {
  const c = String(g?.iso3 ?? g?.country ?? '').toUpperCase()
  // SLUG FIRST: the only key that is one field on both sides and unique by construction — the
  // table's build refuses to emit two rows sharing one. rop3 + iso3 is a compound key that these
  // rows may not carry; name + iso3 depends on two sources spelling a people the same way.
  // Inert until the table ships the column, so this is safe to land in either order.
  if (g?.slug) {
    const hit = byKey.get(`s:${g.slug}`)
    if (hit != null) return hit
  }
  if (g?.rop3) {
    const hit = byKey.get(`r:${g.rop3}|${c}`)
    if (hit != null) return hit
  }
  const hit = byKey.get(`n:${String(g?.people_group ?? '').toLowerCase()}|${c}`)
  return hit == null ? -1 : hit
}
