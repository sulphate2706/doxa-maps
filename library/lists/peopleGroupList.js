/**
 * peopleGroupList.js — the people-group LIST, a universal prop like engine, locale and token.
 *
 * Every map shows people groups, and until now always DOXA's (the live API's 2,107). The same maps
 * must work for any project's list: Project 7000 (unreached), 4700 (frontier), 700 (frontier of
 * 500,000 or more), 2000 (DOXA). A list is chosen the way the engine is, first answer wins:
 *   1. profile-config `list`   — this embed, decided by whoever mounted the element
 *   2. ?list= in the page URL  — any generated leaf can be switched from the URL
 *   3. window.MAP_LIST         — a host global, for a host that sets it programmatically
 *   4. 'doxa'                  — the default: exactly today's behaviour, nothing fetched, nothing filtered
 * An id or an alias ('700', 'project-700') is accepted; anything unknown falls back to the default
 * and says so once in the console.
 *
 * WHAT A MAP DOES WITH IT (Tier A). Rows keep coming from the DOXA API, because that is where the
 * prayer fields live. applyPeopleGroupList() keeps the rows whose slug belongs to the list, from a
 * membership file the build writes (data/people-groups/lists/<id>.json, served under the asset
 * pool). So under Project 700 a map shows the DOXA groups that are Project 700 groups. The list's
 * groups that DOXA does not carry are Tier B, per map (library/lists/README.md).
 *
 * FAILS CLOSED. If a non-default list's membership cannot be loaded, the map gets NO rows and the
 * console names the list and the URL. A map that silently showed all 2,107 while an embed asked for
 * Project 700 would be showing the wrong list with no sign of it.
 *
 * Pure except for the fetch; safe outside a Vue setup().
 */
import { retryFetch } from '../composables/retryFetch.js'
import registry from './lists.json'
import { resolveAssetsBase } from '../utils/embedBase.js'

export const LIST_DEFAULT = registry.default

const byKey = new Map()
for (const l of registry.lists) {
  byKey.set(l.id, l)
  for (const a of l.aliases || []) byKey.set(String(a).toLowerCase(), l)
}

/** Every list the registry defines: { id, label, definition?, source, filter }. */
export function peopleGroupLists() { return registry.lists }

/** The registry entry for an id or alias, or null. */
export function listInfo(idOrAlias) {
  return byKey.get(String(idOrAlias ?? '').toLowerCase().trim()) || null
}

// A list's name and definition in the READER'S language. They live in the i18n catalogues
// (library/i18n/locales/<lc>/lists.json, area `lists`), not here, so every surface that shows a list
// speaks the page's locale. `t` is the caller's translator (useI18n's t, tStatic, or any (key) =>
// string); this module takes it as an argument instead of importing the i18n runtime, so it stays
// pure. With no translator, or a key the catalogue lacks, the registry's English answers.
function listText(idOrAlias, field, t) {
  const l = listInfo(idOrAlias)
  if (!l) return ''
  const key = `lists.${l.id}.${field}`
  let v = ''
  if (typeof t === 'function') { try { v = t(key) } catch { v = '' } }
  return v && v !== key ? v : (l[field] || '')
}
/** The list's label ("Project 700: …") in the reader's language, English as the fallback. */
export function listLabel(idOrAlias, t) { return listText(idOrAlias, 'label', t) }
/** The list's one-line definition in the reader's language, English as the fallback. */
export function listDefinition(idOrAlias, t) { return listText(idOrAlias, 'definition', t) }

/** Unwrap a ref/computed to its config object; parse a JSON string; pass plain objects through. */
function unwrapConfig(profileConfig) {
  let cfg = profileConfig
  if (cfg && typeof cfg === 'object' && 'value' in cfg && !('list' in cfg) && !('profile' in cfg)) cfg = cfg.value
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = null } }
  return cfg && typeof cfg === 'object' ? cfg : null
}

const warned = new Set()
/** The list this map should show, as a registry id. Always a known id. */
export function resolvePeopleGroupList(profileConfig) {
  const cfg = unwrapConfig(profileConfig)
  const fromConfig = cfg?.list
  const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('list') : null
  const fromWindow = typeof window !== 'undefined' ? window.MAP_LIST : undefined
  const raw = fromConfig || fromUrl || fromWindow || LIST_DEFAULT
  const hit = listInfo(raw)
  if (hit) return hit.id
  if (!warned.has(raw)) {
    warned.add(raw)
    console.warn(`[list] unknown people-group list "${raw}", showing "${LIST_DEFAULT}". Known: ${registry.lists.map((l) => l.id).join(', ')}`)
  }
  return LIST_DEFAULT
}

const membership = new Map()
/** The set of DOXA slugs in a list (fetched once per URL). Rejects if it cannot be loaded. */
export function loadListMembership(id, profileConfig) {
  const url = `${resolveAssetsBase(unwrapConfig(profileConfig))}/people-groups/lists/${id}.json`
  if (!membership.has(url)) {
    membership.set(url, retryFetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => new Set(Array.isArray(d?.slugs) ? d.slugs : []))
      .catch((e) => { membership.delete(url); throw new Error(`list "${id}" membership ${url}: ${e.message}`) }))
  }
  return membership.get(url)
}

/**
 * Keep the rows that belong to the resolved list. The default list returns `rows` itself, untouched
 * and without a fetch. `key` reads a row's slug (default: row.slug).
 */
export async function applyPeopleGroupList(rows, profileConfig, { key = (r) => r?.slug } = {}) {
  const id = resolvePeopleGroupList(profileConfig)
  if (id === LIST_DEFAULT || !Array.isArray(rows)) return rows
  try {
    const slugs = await loadListMembership(id, profileConfig)
    return rows.filter((r) => slugs.has(key(r)))
  } catch (e) {
    console.error(`[list] ${e.message}. Showing no people groups rather than the wrong list.`)
    return []
  }
}
