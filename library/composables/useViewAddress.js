/**
 * useViewAddress.js — the page's ADDRESS for the view a reader is on: which app tab, which view inside it, which
 * place. One shared vocabulary and ONE history writer, so a tab, a view or a selection can be reloaded and sent as a
 * link on every host, while a partner's page is never written to.
 *
 * ★ THE SCHEME (query, not hash: a hash is a host page's anchor, and filters already live there).
 *   ?tab=<app tab>&pane=<view inside the tab>&place=<selection>
 *   Levels: changing `tab` drops `pane` and `place`, which belong to the tab. `pane` and `place` are siblings: a
 *   composite keeps its selection while the reader looks at another of its panes (Regions keeps the region while the
 *   reader is on the list), so the address keeps it too. Every other parameter (a host's
 *   own, the filters useShareableView writes) and the hash are kept as they are. A value that is not a plain id
 *   (letters, digits, `-`, `_`, at most 64) reads as absent, so a stale or hand-edited link falls back to the default.
 *   `pane`, not `view`: `?view=` is already published by four of our own pages (gospel-internet's board/map, Gospel
 *   Resources' map ?view=zero, pplr-data-maps and upg-neighbor lenses), and one of them sits inside a shell tab.
 *
 * ★ ONE WRITER PER PAGE. Only the OUTERMOST element that owns the address writes it; profile-config `urlOwner` says
 * who that is:
 *   'app'   our own pages (a generated leaf, Plugin Studio): writeViewKeys() writes history itself;
 *   'host'  a host with its own router (DX Life): writeViewKeys() dispatches ADDRESS_EVENT and the HOST writes;
 *   absent  a partner's page: nothing is written; links are still READ (readViewKeys works everywhere).
 * A nested element never writes: it announces its choice upward (announceView), and the owner records it (ownAddress).
 * claimView() is the one call for a reader's choice: the owner writes it, any other element announces it.
 *
 * ★ THE ONE HISTORY WRITE: commitUrl(). The view keys and useShareableView's filters both write through it, so those
 * two can never undo each other. The tree's other history writers are pinned by check:view-address's census and move
 * onto commitUrl in later phases. On a push, commitUrl copies the previous entry's state (Vue Router's `position` and
 * `back` included). That is correct for a replace. A Vue Router page is a 'host' owner, so its router does its own
 * pushes. It keeps `history.state` and sets its `current` to the
 * new URL. MEASURED on a Vue Router host (2026-09-30): a pushState that drops Router's state fields makes the next
 * in-app navigation rewrite the entry back to Router's last-known URL, and the link is lost. It writes nothing when
 * the URL would not change. A user's tab/pane/place change is a push (one Back step); first paint, link
 * normalisation and filters are a replace.
 *
 * Pure helpers, no dependency. Safe under node and in a sandboxed frame (every access is guarded).
 */

export const VIEW_KEYS = ['tab', 'pane', 'place']
/** nested element → the address owner: { changes: { tab?, pane?, place? }, push }. Composed + bubbling, so it leaves
 *  shadow roots. One event per reader action, so one action is one Back step. */
export const VIEW_EVENT = 'dxm-view'
/** an owner with urlOwner 'host' → the host's router: { keys, href, push }; the host does router[push ? 'push' : 'replace'](href). */
export const ADDRESS_EVENT = 'dxm-address'

/** A plain id (letters, digits, `-`, `_`, at most 64), or '' for anything else. */
export const cleanKey = (v) => { const s = String(v ?? '').trim(); return /^[A-Za-z0-9][\w-]{0,63}$/.test(s) ? s : '' }

/** { tab, pane, place } from a search string; '' for a key that is absent or not a plain id. The FIRST of a repeated
 *  key decides, as URLSearchParams.get does for the shells that already read ?tab=; a malformed escape reads as absent. */
export function readViewKeys(search) {
  const q = new URLSearchParams(search || '')
  return Object.fromEntries(VIEW_KEYS.map((k) => [k, cleanKey(q.get(k))]))
}

// Bubbling + composed, so the event leaves every shadow root on its way to the owner or the host.
const send = (el, type, detail) => !!el?.dispatchEvent && (el.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail })), true)

/**
 * The search string after `changes` ({ tab?, pane?, place? }; '' or null removes a key), with the level rule: a
 * changed `tab` drops `pane` and `place` unless `changes` sets them itself. Foreign parameters keep their place and
 * their exact text (useShareableView's legible `,` and unicode are not re-encoded). Returns '' or '?…'.
 */
export function viewSearch(search, changes = {}) {
  const next = readViewKeys(search)
  VIEW_KEYS.forEach((k, level) => {
    if (!(k in changes) || cleanKey(changes[k]) === next[k]) return
    next[k] = cleanKey(changes[k])
    if (!level) VIEW_KEYS.slice(1).forEach((d) => { if (!(d in changes)) next[d] = '' })
  })
  const all = VIEW_KEYS.filter((k) => next[k]).map((k) => k + '=' + next[k])
    .concat((search || '').replace(/^\?/, '').split('&').filter((p) => p && !VIEW_KEYS.includes(p.split('=')[0])))
  return all.length ? '?' + all.join('&') : ''
}

/**
 * THE one write to the address bar. `search` ('' or '?…') and `hash` ('' or '#…') default to the current ones, which
 * is the shape viewSearch, serializeQuery and serializeView all return. Keeps history.state and sets its
 * `current` (Vue Router's field) to the new URL. Returns true when it wrote; false when the URL was already that, or
 * the page cannot be written (no history, a sandbox).
 */
export function commitUrl({ search, hash } = {}, { push = false } = {}) {
  try {
    const p = location.pathname
    const url = p + (search ?? location.search) + (hash ?? location.hash)
    if (url === p + location.search + location.hash) return false
    history[push ? 'pushState' : 'replaceState']({ ...(history.state || {}), current: url }, '', url)
    return true
  } catch (_) { return false }
}

/** 'app' | 'host' | '' from a profile-config. Anything else is '' (a partner's page: read only). */
export const urlOwnerOf = (cfg) => (cfg && (cfg.urlOwner === 'app' || cfg.urlOwner === 'host') ? cfg.urlOwner : '')

/**
 * The owner's write for tab/pane/place. owner 'app': commitUrl (push for a reader's choice). owner 'host': dispatch
 * ADDRESS_EVENT from `el` for the host's router; nothing is written here. Anything else: nothing. Returns what it did:
 * 'written' | 'announced' | 'unchanged' | 'none'.
 */
export function writeViewKeys(changes, { owner = '', push = true, el = null } = {}) {
  if ((owner !== 'app' && owner !== 'host') || !globalThis.location) return 'none'
  const search = viewSearch(location.search, changes)
  // Unchanged means the same VALUES, not the same string: viewSearch puts the view keys first, so comparing strings
  // rewrote a link like ?owner=x&pane=map as ?pane=map&owner=x on every fresh load (measured in a browser), a
  // needless replace (and on a host, a needless router.replace).
  const now = readViewKeys(location.search), next = readViewKeys(search)
  if (VIEW_KEYS.every((k) => now[k] === next[k])) return 'unchanged'
  if (owner === 'app') return commitUrl({ search }, { push }) ? 'written' : 'unchanged'
  return send(el, ADDRESS_EVENT, { keys: readViewKeys(search), href: location.pathname + search + location.hash, push }) ? 'announced' : 'none'
}

// Only the view keys, each value cleaned: what an announcement may carry.
const viewChanges = (changes) => Object.fromEntries(Object.entries(changes || {}).filter(([k]) => VIEW_KEYS.includes(k)).map(([k, v]) => [k, cleanKey(v)]))

/** A nested element reports a reader's choice to whoever owns the address (it never writes itself). */
export function announceView(el, changes, { push = true } = {}) {
  const c = viewChanges(changes)
  return Object.keys(c).length > 0 && send(el, VIEW_EVENT, { changes: c, push })
}

/** THE call for a reader's choice: the owner writes it ('written' | 'announced' | 'unchanged' | 'none'); any other
 *  element announces it to the owner above it ('announced' | 'none'). */
export const claimView = (changes, { owner = '', el = null, push = true } = {}) =>
  owner ? writeViewKeys(changes, { owner, el, push }) : (announceView(el, changes, { push }) ? 'announced' : 'none')

/** An owner records what the elements inside it announce: their pane and place. `tab` is the owner's own key, so a
 *  nested element cannot switch it. getOwner() is read per event (a host may set profile-config after mount); while
 *  it is '' the event passes on to an owner further out. Returns off(). */
export function ownAddress(el, getOwner) {
  const h = (e) => {
    const owner = getOwner()
    if (!owner || !e.detail) return
    e.stopPropagation()
    const { tab, ...changes } = viewChanges(e.detail.changes)
    if (Object.keys(changes).length) writeViewKeys(changes, { owner, el, push: e.detail.push !== false })
  }
  el?.addEventListener?.(VIEW_EVENT, h)
  return () => el?.removeEventListener?.(VIEW_EVENT, h)
}

/** Back / Forward: cb(readViewKeys(location.search)). Re-apply state only; never write from here. Returns off(). */
export function onAddressChange(cb) {
  const h = () => cb(readViewKeys(location.search))
  globalThis.addEventListener?.('popstate', h)
  return () => globalThis.removeEventListener?.('popstate', h)
}
