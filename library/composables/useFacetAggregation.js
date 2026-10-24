/**
 * useFacetAggregation.js — count rows by a facet accessor, and roll the tail into one bucket.
 *
 * ★ EXTRACTED FROM useDashboardAggregations (dashboard-kit landing 4c-1). That module has a split
 * personality: these two functions are pure counting, while the rest of it — colorFor with its
 * hardcoded religion / wagf_region / affinity_bloc branches, the religion palettes, the donut and
 * bar builders — is research-specific and STAYS in plugin-designs. Only the generic half could
 * move, and the facet rail needs only the generic half, which is what made this the piece blocking
 * kit landing 4c.
 *
 * Bodies are verbatim. Nothing here knows a facet name: the caller supplies the accessor.
 */
import { tStatic } from '@map/i18n/index.js'

/**
 * A deliberately NEUTRAL tone for a value this facet has no palette for — matching the tree
 * legend's NEUTRAL exactly. An uncoloured slice must read as "no colour strategy for this key",
 * never as a confident member of some other family. Critically it is STABLE: the same key gets
 * the same neutral every time, so nothing changes colour when a filter reorders the list.
 */
export const NEUTRAL = '#c4c8c0'

export const lbl = (v) => (v === null || v === undefined ? '' : (typeof v === 'object' ? (v.label ?? v.value ?? '') : v))

/** Count rows by a key accessor; collapse the long tail into 'Other'. */
export function aggregate(rows, keyFn, topN) {
  const m = new Map()
  for (const r of rows) { const k = keyFn(r); if (k === null || k === undefined || k === '') continue; m.set(k, (m.get(k) || 0) + 1) }
  let arr = [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value)
  if (topN && arr.length > topN) {
    const top = arr.slice(0, topN)
    const other = arr.slice(topN).reduce((s, x) => s + x.value, 0)
    if (other > 0) top.push({ key: 'Other', value: other, other: true })
    arr = top
  }
  return arr
}


/**
 * ★ THE ROLLUP BUCKET'S KEY IS A SENTINEL; ITS LABEL IS A TRANSLATION. Keep them apart.
 *
 * aggregate() pushes `{ key: OTHER_KEY, other: true }` for the tail, and 'Other' was rendered
 * directly — so every locale showed the English word, in the facet rail and the charts rail both.
 * check:i18n-keys-exist could not see it, because there is no T() call to inspect: the string was
 * never a lookup, it was a key being used as a label.
 *
 * The KEY must not be translated. The rail tests `key === 'Other'` to make the row inert and
 * unfilterable, and the charts rail refuses to filter on it — a localized key would make the bucket
 * clickable in Arabic and silently filter on a value no row carries. That is the same value/label
 * trap as the religion families, arriving in generic code this time, which is worse: unfixed it
 * would have been exported to every future dashboard the moment this module became kit code.
 *
 * So the sentinel stays English and OTHER_LABEL() projects it for a reader, next to the function
 * that produces it, so the two cannot drift apart.
 */
export const OTHER_KEY = 'Other'
export const otherLabel = () => tStatic('dashboard.other') || OTHER_KEY
