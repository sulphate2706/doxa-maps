// indiaStates.js — India's 28 states and 8 union territories, each with the people groups located inside it.
//
// SERVED, NOT BUNDLED: the table (data/people-groups/india-states.json, written by
// plugin-designs/my-upg-100-list/data/emit-india-states.mjs) ships as assets/people-groups/india-states.json and is
// fetched here only when a state is actually needed (a state in UPG-100's batch selection, Country Posters' India
// section). This build inlines every import(), so a bundled table would ride every page load.
//
// Same shape as library/packet/packetStrings.js: the copy must match the sha384 pinned in the SAME emitter run
// (indiaStates.integrity.js), one promise per URL, and a failure is dropped from the cache so a later call
// fetches again instead of inheriting one bad moment. It REJECTS on failure: there is no honest fallback for
// "which people groups live in this state".
//
//   const t = await loadIndiaStates(assetsBase)
//   t.states          → [{ id:'india-gj', iso:'IN-GJ', kind:'state'|'union_territory', name, shapeName, bbox, count, slugs }]
//   t.byShapeName     → Map(shapeName → entry)   (the map's ADM1 features carry shapeName)
//   t.byIso           → Map(iso → entry)
import { INDIA_STATES_SHA384 } from './indiaStates.integrity.js'
import { fetchPinned } from '../packet/sha384.js'

const PAGE_BASE = globalThis.document?.baseURI || undefined
const cache = new Map()

export function indiaStatesUrl(assetsBase) {
  return new URL(`${assetsBase}/people-groups/india-states.json`, PAGE_BASE).href
}

export function loadIndiaStates(assetsBase) {
  if (!assetsBase) return Promise.reject(new Error('no assets base to fetch india-states.json from'))
  let url
  try { url = indiaStatesUrl(assetsBase) } catch (e) { return Promise.reject(e) }
  if (!cache.has(url)) {
    const p = (async () => {
      // force-cache, and once more fresh on a mismatch: a stale cached copy after a re-pin must not cost a returning
      // reader India's state cards (../packet/sha384.js fetchPinned says why).
      let text
      try { text = await fetchPinned(url, INDIA_STATES_SHA384) }
      catch (e) { throw new Error(`india-states.json ${e?.message || e}`) }
      const data = JSON.parse(text)
      const states = Array.isArray(data.states) ? data.states : []
      return {
        meta: data.meta || {},
        states,
        byShapeName: new Map(states.map((s) => [s.shapeName, s])),
        byIso: new Map(states.map((s) => [s.iso, s])),
      }
    })()
    p.catch(() => { if (cache.get(url) === p) cache.delete(url) })
    cache.set(url, p)
  }
  return cache.get(url)
}

export default { loadIndiaStates, indiaStatesUrl }
