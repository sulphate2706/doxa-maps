/**
 * boundaries.js — fetch the India boundary geojson the generator draws on, from the served tree.
 * Cached per base, so re-generating (a size switch, a re-render) costs one fetch. The generator only
 * needs India's own ADM0 feature + its ADM1 states + place labels; we fetch the tree files and the
 * generator filters India out of ADM0 itself.
 */
const cache = new Map()

export function loadBoundaries(assetsBase) {
  const base = String((typeof assetsBase === 'function' ? assetsBase() : assetsBase) || './assets').replace(/\/$/, '')
  if (cache.has(base)) return cache.get(base)
  const b = `${base}/boundaries`
  const p = Promise.all([
    fetch(`${b}/world-adm0.geojson`).then((r) => r.json()),
    fetch(`${b}/gb-IND-ADM1.geojson`).then((r) => r.json()),
    fetch(`${b}/ne-places.json`).then((r) => r.json()).catch(() => ({ places: [] })),
  ]).then(([adm0, adm1Ind, ne]) => ({
    adm0, adm1Ind, nePlaces: Array.isArray(ne) ? ne : (ne.places || []),
  }))
  cache.set(base, p)
  return p
}
