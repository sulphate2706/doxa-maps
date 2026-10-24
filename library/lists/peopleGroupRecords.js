/**
 * peopleGroupRecords.js — the RECORDS half of the print standard: the people groups of ANY set, in the
 * shape usePosterPrints' `records(item)` wants, so any map can offer the prayer list, the card deck and
 * the prayer packet for whatever its reader picked — a country, a region, a list, a selection.
 *
 * ★ WHY IT IS IN THE LIBRARY. Every wall that prints rows used to carry its own fetch: the UPG-100 wall
 * had one, and the country walls had none, which is why a country card said "prayer list coming soon"
 * while the data to print it was one request away. The fetch, the normalisation and the membership
 * rules are the same for every set; only the SET differs, so the set is a parameter (a selector).
 *
 * A SELECTOR names the set:
 *   { type: 'country',  values: ['TCD', …] }             by ISO3 country code
 *   { type: 'pg_slugs', values: ['slug', …] }            explicit people groups
 *   { type: 'field', field: 'wagf_region', values: […] } any field's value (after normalisation)
 * Anything else is handed to the host's `evaluate(selector, records)` (the UPG-100 selector language),
 * and a selector nobody understands selects NOTHING rather than everything: a packet of every people
 * group on earth printed under one country's name would be worse than no packet.
 *
 * ONE FETCH PER LANGUAGE, shared by every item: the list endpoint returns every group, so a wall of 175
 * countries costs one request, not 175. A failed fetch is not cached, so the next click retries.
 */
import { applyPeopleGroupList, resolvePeopleGroupList } from './peopleGroupList.js'
import { keyedError } from '../i18n/keyedError.js'

// What the prints read: the card's face and language, the profile's description (imb_gsec feeds its
// reachedness sentence), the sets page's joins (slug), and the country for the page-1 map and captions.
export const PRINT_FIELDS = 'slug,name,country_code,wagf_region,wagf_block,rop1,population,religion,'
  + 'image_url,primary_language,imb_gsec,latitude,longitude'   // coordinates: a generated map's pins

// Fields the API sends as { value, label } dicts. Normalised to the value, with the label kept beside
// it as <field>_label — the shape card-render and describeGroup read. Same rule as the UPG-100
// profile's normalize.js, so a row prints the same whichever surface fetched it.
const NESTED = ['country_code', 'wagf_region', 'wagf_block', 'primary_language', 'religion', 'imb_gsec']

export function normalizeRecord(raw) {
  if (raw == null || typeof raw !== 'object') return raw
  const out = { ...raw }
  for (const f of NESTED) {
    if (!(f in out)) continue
    const v = out[f]
    if (v && typeof v === 'object') {
      out[f] = v.value ?? null
      if (v.label != null) out[`${f}_label`] = v.label
    }
  }
  return out
}

export function extractRecords(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    return payload.posts || payload.data || payload.records || payload.results || payload.items || []
  }
  return []
}

/** The records a selector names, sorted by name. `evaluate` handles selector types this module does not. */
export function selectRecords(records, selector, evaluate = null, locale = undefined) {
  const rows = Array.isArray(records) ? records : []
  const s = selector || {}
  const vals = new Set((s.values || []).map(String))
  let picked
  if (s.type === 'country') {
    const up = new Set([...vals].map((v) => v.toUpperCase()))
    picked = rows.filter((r) => r && up.has(String(r.country_code || '').toUpperCase()))
  } else if (s.type === 'pg_slugs') {
    picked = rows.filter((r) => r && vals.has(String(r.slug)))
  } else if (s.type === 'field' && s.field) {
    picked = rows.filter((r) => r && vals.has(String(r[s.field])))
  } else if (typeof evaluate === 'function') {
    const slugs = evaluate(selector, rows)
    picked = rows.filter((r) => r && slugs && slugs.has(r.slug))
  } else {
    picked = []
  }
  // Sorted in the READER's collation (the list prints in their language, so its order should read as theirs).
  return picked.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), locale))
}

/**
 * @param {object} o
 *   apiBase       () => string   the people-groups API origin ('' = none: every call rejects, so the
 *                                 print shows its error state rather than an empty packet)
 *   lang          () => string   the reader's language; names and labels come back in it
 *   profileConfig ref|object     the host's config, for the universal `list` membership rule
 *   evaluate      (selector, records) => Set<slug>   for selector types beyond the built-in three
 *   fetchImpl     fetch          injectable, so the module is testable without a network
 * @returns {(selector) => Promise<rows[]>}
 */
export function createPeopleGroupRecords({ apiBase, lang = () => 'en', profileConfig = null, evaluate = null, fetchImpl = null } = {}) {
  const cache = new Map()
  const doFetch = fetchImpl || ((...a) => fetch(...a))
  // CACHED BY LANGUAGE AND LIST. A host can change profileConfig.list at runtime, and the membership
  // filter depends on it — a cache keyed by language alone kept serving the first list's rows. And a load
  // whose membership came back EMPTY from non-empty rows is not kept: applyPeopleGroupList answers a
  // failed membership fetch with [] (it cannot throw into a render), and caching that would print
  // "no people groups" for the rest of the session instead of retrying on the next click.
  function all() {
    const lc = (typeof lang === 'function' ? lang() : lang) || 'en'
    let list = ''
    try { list = profileConfig ? String(resolvePeopleGroupList(profileConfig) || '') : '' } catch { list = '' }
    const key = `${lc}|${list}`
    if (!cache.has(key)) {
      const p = (async () => {
        const base = typeof apiBase === 'function' ? apiBase() : apiBase
        if (!base) throw keyedError('wall.hud.noApi', 'no people-groups service is configured')
        const resp = await doFetch(`${base}/api/people-groups/list?fields=${PRINT_FIELDS}&lang=${encodeURIComponent(lc)}`, { cache: 'no-store' })
        if (!resp.ok) throw keyedError('wall.hud.fetchFailed', 'could not load the people groups ({status})', { status: resp.status })
        const rows = extractRecords(await resp.json())
        const member = profileConfig ? await applyPeopleGroupList(rows, profileConfig) : rows
        if (rows.length && !member.length) cache.delete(key)      // a failed membership: retry next time
        return member.map(normalizeRecord)
      })()
      p.catch(() => cache.delete(key))
      cache.set(key, p)
    }
    return cache.get(key)
  }
  const recordsFor = async (selector) => selectRecords(await all(), selector, evaluate, (typeof lang === 'function' ? lang() : lang) || undefined)
  // Every record, unselected — what a generated map sheet needs to assign pins across all its zones.
  recordsFor.all = all
  return recordsFor
}
