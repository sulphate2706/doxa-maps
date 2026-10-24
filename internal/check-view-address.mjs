#!/usr/bin/env node
// check:view-address — the page's address (library/composables/useViewAddress.js) and its ONE history write.
//   A. the pure helpers: the id whitelist + 64 cap; an unknown or malformed value reads as absent (the default opens);
//      the level rule (a tab change drops pane and place unless the change sets them; pane and place are siblings);
//      foreign params keep their exact text.
//   B. the writes, on a simulated browser history: an 'app' owner pushes once and keeps history.state with `current`
//      and the hash; an unchanged address writes nothing; a partner page (no owner) writes nothing; a 'host' owner
//      writes nothing and hands the host one dxm-address event; nested elements announce dxm-view; Back/Forward is
//      only read, never written.
//   C. COEXISTENCE with the filters (useShareableView, which writes through the same commitUrl): a filter write keeps
//      tab/pane/place, the hash or the query it does not own, and the router's history.state; a tab/pane/place write
//      keeps the filters (query AND hash form); both survive Back and Forward, and re-applying the old tab after Back
//      writes nothing, so Forward still exists.
//   D. THE CENSUS of history writers, enumerated from the tree: every history.pushState/replaceState call in library/
//      and plugin-designs/ is the helper's or a listed writer. A new one fails until it is listed here with its reason.
//   E. ONE WRITER, NESTED: claimView writes for an owner and announces for anyone else (one event per action, view keys
//      only); ownAddress records an announcement only while it owns (and stops it there), so a pane and its selection
//      clicked together are ONE Back step.
//   F. pane-wrapper's opt-in address, on a simulated column: a link opens its pane without writing, also on a FRESH
//      load where the column is built before its layout (it waits for a height, measured in a browser); a click is a push
//      (the first pane is the default and is never written); a click's selection rides in the same push; where the
//      reader's scroll settles is a replace; Back/Forward scroll and never write; nested it announces; without the
//      opt-in it never writes; a kept-alive column shown again claims its pane back (a replace), unless the address
//      names one.
//   G. THE WIRING in Regions: regions-mfe opts its column in, owns its leaf, and carries the place with its pane;
//      region-dashboards claims ?place= (replace at first paint, push on a choice) and re-applies it on Back. And
//      each shell (Plugin Studio, the Research Gallery, Posterverse) records its nested composites' choices
//      (ownAddress) and releases the listener before any hot-update return.
// --self-test: each poison below must FAIL its arm. Pure node: no Vite, no build, no browser.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The history writers that exist today besides the helper, by call count. Adding one means a row here with a reason.
const KNOWN = {
  'library/composables/useViewAddress.js': [1, 'THE write (commitUrl)'],
  'library/utils/languageRequest.js': [1, '?lang= on a generated page only (MAP_OWNS_PAGE); keeps state and every other param'],
  'library/layouts/app-wrapper-material/index.html': [1, "the layout page's own #/<map> hash; a fragment-only URL keeps the query"],
  'plugin-designs/gospel-internet/src/useBoard.js': [1, 'its own keys on its own leaves (writeUrl); keeps state, foreign params and the hash'],
}
// SOURCE files only: gates and node scripts may simulate history. A write is `.pushState(` / `.replaceState(` (an aliased
// history included) or a computed `history[… 'pushState' …]`.
const WRITE = /\.(?:push|replace)State\s*\(|\[[^\]\n]*['"](?:push|replace)State['"]/g
function census() {
  const out = execFileSync('git', ['grep', '--untracked', '-cE', '(push|replace)State', '--', 'library', 'plugin-designs',
    ':!*.md', ':!*.mjs', ':!**/scripts/**', ':!**/test/**', ':!**/*.test.*', ':!**/*.spec.*'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const counts = {}
  for (const line of out.split('\n').filter(Boolean)) {
    const i = line.lastIndexOf(':')
    const file = line.slice(0, i)
    // -c counts LINES; count the calls themselves (a ternary writes twice on one line).
    const n = (readFileSync(join(ROOT, file), 'utf8').match(WRITE) || []).length
    if (n) counts[file] = n
  }
  return counts
}

// ── a browser's history, simulated: entries + index, popstate on back/forward, write counters ──────────────────────
function browser(href, state = null) {
  const entries = [{ url: new URL(href), state }]
  let i = 0
  const writes = { push: 0, replace: 0 }
  const listeners = new Set()
  const loc = {
    get href() { return entries[i].url.href },
    get pathname() { return entries[i].url.pathname },
    get search() { return entries[i].url.search },
    get hash() { return entries[i].url.hash },
  }
  const copy = (s) => (s == null ? s : JSON.parse(JSON.stringify(s)))
  const hist = {
    get state() { return entries[i].state },
    get length() { return entries.length },
    pushState(s, _, url) { writes.push++; entries.splice(i + 1); entries.push({ url: new URL(url, entries[i].url), state: copy(s) }); i++ },
    replaceState(s, _, url) { writes.replace++; entries[i] = { url: new URL(url, entries[i].url), state: copy(s) } },
    back() { if (i > 0) { i--; listeners.forEach((h) => h()) } },
    forward() { if (i < entries.length - 1) { i++; listeners.forEach((h) => h()) } },
  }
  globalThis.location = loc; globalThis.history = hist
  globalThis.addEventListener = (t, h) => t === 'popstate' && listeners.add(h)
  globalThis.removeEventListener = (t, h) => t === 'popstate' && listeners.delete(h)
  const at = () => loc.pathname + loc.search + loc.hash
  const q = () => new URLSearchParams(loc.search)
  return { loc, hist, writes, at, q, listeners }
}
const unset = () => { for (const k of ['location', 'history', 'addEventListener', 'removeEventListener']) delete globalThis[k] }

// A column of panes for pane-wrapper, simulated: each pane is 100 px tall, scrolling dispatches 'scroll'.
class FakeEl extends EventTarget {
  constructor() { super(); this.className = ''; this.dataset = {}; this.children = []; this.parent = null; this.scrollTop = 0; this.clientHeight = FakeEl.h0 ?? 100; this.innerHTML = '' }
  appendChild(c) { c.parent = this; this.children.push(c); return c }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this) }
  // A pane's top is its index times the column's height: 0 while the column has no layout.
  get offsetTop() { return this.parent ? this.parent.children.filter((c) => c.className === 'pane').indexOf(this) * this.parent.clientHeight : 0 }
  querySelector(sel) {
    const id = /data-pane-id="([^"]+)"/.exec(sel)?.[1]
    const walk = (n) => { for (const c of n.children) { if (c.className === 'pane' && c.dataset.paneId === id) return c; const r = walk(c); if (r) return r } return null }
    return walk(this)
  }
  scrollTo({ top }) { this.scrollTop = top; this.dispatchEvent(new Event('scroll')) }
}
const SPEC = { paneHint: false, panes: [{ id: 'list', label: 'List', at: [0, 0] }, { id: 'dashboard', label: 'Dashboard', at: [1, 0] }] }
const settle = () => new Promise((r) => setTimeout(r, 125))   // just past the 120 ms debounce; an earlier-due timer always fires first

async function arms({ va, sv, counts, pw, src }, { skipF = false } = {}) {
  const fails = []
  const eq = (tag, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${tag}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
  try {
    // ── A. pure helpers ──
    eq('A: a plain id is kept', va.cleanKey('regions-dashboard'), 'regions-dashboard')
    eq('A: a 64-char id is kept', va.cleanKey('a'.repeat(64)), 'a'.repeat(64))
    for (const bad of ['a'.repeat(65), '<b>', 'a b', '-lead', '../x', 'x?y', 'x#y', '']) {
      if (va.cleanKey(bad) !== '') fails.push(`A: the whitelist lets ${JSON.stringify(bad.slice(0, 20))} through`)
    }
    eq('A: an unknown or malformed value reads as absent', va.readViewKeys('?tab=a%20b&pane=%E0%A4%A&place=angola&tab=second'), { tab: '', pane: '', place: 'angola' })
    eq('A: a tab change drops pane and place', va.viewSearch('?tab=a&pane=b&place=c&lang=ar', { tab: 'd' }), '?tab=d&lang=ar')
    eq('A: a pane change keeps tab and place (siblings)', va.viewSearch('?tab=a&pane=b&place=c', { pane: 'e' }), '?tab=a&pane=e&place=c')
    eq('A: a place change keeps tab and pane', va.viewSearch('?tab=a&pane=b&place=c', { place: 'f' }), '?tab=a&pane=b&place=f')
    eq('A: a change that sets the deeper level keeps it', va.viewSearch('?tab=a&pane=b&place=c', { tab: 'd', pane: 'p' }), '?tab=d&pane=p')
    eq('A: the same tab changes nothing', va.viewSearch('?tab=a&pane=b&place=c', { tab: 'a' }), '?tab=a&pane=b&place=c')
    eq('A: foreign params keep their exact text', va.viewSearch('?lang=ar&access=yes%7Cpartial&q=rice+%26+beans&tab=a', { tab: 'b' }), '?tab=b&lang=ar&access=yes%7Cpartial&q=rice+%26+beans')
    eq('A: removing the last key leaves no "?"', va.viewSearch('?tab=a', { tab: '' }), '')
    eq('A: urlOwner', ['app', 'host', 'App', true, undefined, 'partner'].map((o) => va.urlOwnerOf({ urlOwner: o })), ['app', 'host', '', '', '', ''])

    // ── B. writes ──
    {
      const b = browser('https://x.test/deep-research?lang=ar#top', { back: '/', current: '/deep-research?lang=ar#top', position: 3 })
      const r = va.writeViewKeys({ tab: 'regions' }, { owner: 'app', push: true })
      if (r !== 'written' || b.writes.push !== 1) fails.push(`B: an app owner's tab change is not ONE push (${r}, ${b.writes.push} pushes)`)
      if (b.at() !== '/deep-research?tab=regions&lang=ar#top') fails.push(`B: the write lost the hash or a foreign param: ${b.at()}`)
      const s = b.hist.state || {}
      if (s.position !== 3 || s.back !== '/') fails.push(`B: history.state was not kept: ${JSON.stringify(s)}`)
      if (s.current !== b.at()) fails.push(`B: history.state.current is not the new URL (${s.current}): a Vue Router host loses the link`)
      const r2 = va.writeViewKeys({ tab: 'regions' }, { owner: 'app', push: true })
      if (r2 !== 'unchanged' || b.writes.push + b.writes.replace !== 1) fails.push(`B: an unchanged address wrote (${r2})`)
      if (va.commitUrl({}) !== false || b.writes.push + b.writes.replace !== 1) fails.push('B: commitUrl wrote an identical URL')
      // the same values in another order is unchanged too (a link written by someone else, a host's own params first)
      va.commitUrl({ search: '?owner=x&pane=map&tab=regions' })
      const n = b.writes.push + b.writes.replace
      const r3 = va.writeViewKeys({ pane: 'map' }, { owner: 'app', push: false })
      if (r3 !== 'unchanged' || b.writes.push + b.writes.replace !== n) fails.push(`B: the same keys in another order were rewritten (${r3}): ${b.at()}`)
    }
    {
      const b = browser('https://partner.test/page?tab=theirs')
      for (const owner of ['', undefined, 'partner']) va.writeViewKeys({ tab: 'regions' }, { owner, push: true })
      if (b.writes.push + b.writes.replace) fails.push(`B: a partner page (no owner) was written ${b.writes.push + b.writes.replace}×`)
    }
    {
      const b = browser('https://dx.test/deep-research?lang=ar')
      const el = new EventTarget(); const got = []
      el.addEventListener(va.ADDRESS_EVENT, (e) => got.push(e))
      const r = va.writeViewKeys({ tab: 'posters' }, { owner: 'host', push: true, el })
      if (b.writes.push + b.writes.replace) fails.push("B: a 'host' owner wrote history itself (the host's router must)")
      if (r !== 'announced' || got.length !== 1) fails.push(`B: a 'host' owner did not hand the host ONE ${va.ADDRESS_EVENT} (${r}, ${got.length})`)
      else {
        const e = got[0]
        if (!e.bubbles || !e.composed) fails.push(`B: ${va.ADDRESS_EVENT} cannot leave a shadow root (bubbles ${e.bubbles}, composed ${e.composed})`)
        if (e.detail?.keys?.tab !== 'posters' || e.detail?.push !== true || e.detail?.href !== '/deep-research?tab=posters&lang=ar') fails.push(`B: ${va.ADDRESS_EVENT} detail is wrong: ${JSON.stringify(e.detail)}`)
      }
      // the host has not navigated yet; once it has, the same choice again must not ask it to navigate twice
      b.hist.replaceState(b.hist.state, '', '/deep-research?tab=posters&lang=ar'); b.writes.replace--
      const r2 = va.writeViewKeys({ tab: 'posters' }, { owner: 'host', push: true, el })
      if (r2 !== 'unchanged' || got.length !== 1) fails.push(`B: a 'host' owner announced an unchanged address (${r2}, ${got.length} events)`)
    }
    {
      browser('https://x.test/p')
      const el = new EventTarget(); const got = []
      el.addEventListener(va.VIEW_EVENT, (e) => got.push(e))
      va.announceView(el, { pane: 'dashboard' })
      if (va.announceView(el, { filters: 'x' }) !== false) fails.push('B: announceView accepts a key that is not tab/pane/place')
      if (got.length !== 1 || !got[0].bubbles || !got[0].composed || got[0].detail?.changes?.pane !== 'dashboard') fails.push(`B: a nested element's ${va.VIEW_EVENT} is wrong or cannot leave its shadow root`)
    }

    // ── C. coexistence with the filters, and Back/Forward ──
    {
      const b = browser('https://x.test/board?tab=a&pane=b&place=c#top', { current: '/board?tab=a&pane=b&place=c#top', position: 2 })
      sv.writeFilterView({ access_level: 'yes' }, 'rice', { mode: 'query', facetKeys: { access: 'access_level' } })
      const q = b.q()
      if (q.get('tab') !== 'a' || q.get('pane') !== 'b' || q.get('place') !== 'c') fails.push(`C: a filter write (query) dropped tab/pane/place: ${b.at()}`)
      if (q.get('access') !== 'yes' || q.get('q') !== 'rice' || b.loc.hash !== '#top') fails.push(`C: a filter write (query) lost its own params or the hash: ${b.at()}`)
      if (b.hist.state?.position !== 2 || b.hist.state?.current !== b.at()) fails.push(`C: a filter write dropped the router's history.state or its current: ${JSON.stringify(b.hist.state)}`)
      if (b.writes.push) fails.push('C: a filter write pushed (filters replace)')
    }
    {
      const b = browser('https://x.test/research?tab=a&pane=b')
      sv.writeFilterView({ region: 'asia' }, '', {})
      if (b.loc.search !== '?tab=a&pane=b' || !b.loc.hash.startsWith('#f=region:asia')) fails.push(`C: a filter write (hash) dropped tab/pane/place: ${b.at()}`)
    }
    {
      const b = browser('https://x.test/board?access=yes&q=rice#f=region:asia')
      va.writeViewKeys({ tab: 'map' }, { owner: 'app', push: true })
      const q = b.q()
      if (q.get('access') !== 'yes' || q.get('q') !== 'rice' || b.loc.hash !== '#f=region:asia') fails.push(`C: a tab write dropped the filters: ${b.at()}`)
      va.writeViewKeys({ place: 'angola' }, { owner: 'app', push: true })
      if (b.q().get('access') !== 'yes' || b.loc.hash !== '#f=region:asia') fails.push(`C: a place write dropped the filters: ${b.at()}`)
    }
    {
      // A shell with the filters inside: first paint, a filter, a tab change, another filter, then Back and Forward.
      // The app re-applies the tab on popstate the way an owner does: it sets its tab, and its tab watcher writes.
      const b = browser('https://x.test/deep-research')
      const app = { tab: '' }
      const setTab = (t, push) => { app.tab = t; va.writeViewKeys({ tab: t }, { owner: 'app', push }) }
      const off = va.onAddressChange((keys) => setTab(keys.tab || 'home', true))
      setTab('a', false)
      sv.writeFilterView({ access_level: 'yes' }, '', { mode: 'query', facetKeys: { access: 'access_level' } })
      setTab('b', true)
      sv.writeFilterView({ access_level: 'no' }, '', { mode: 'query', facetKeys: { access: 'access_level' } })
      const len = b.hist.length; const w = b.writes.push + b.writes.replace
      b.hist.back()
      if (b.q().get('tab') !== 'a' || b.q().get('access') !== 'yes') fails.push(`C: after Back the entry lost its tab or its filters: ${b.at()}`)
      if (app.tab !== 'a') fails.push('C: Back did not re-apply the tab')
      if (b.writes.push + b.writes.replace !== w) fails.push('C: re-applying the tab after Back WROTE history (Forward is lost)')
      b.hist.forward()
      if (b.hist.length !== len || b.q().get('tab') !== 'b' || b.q().get('access') !== 'no') fails.push(`C: after Forward the entry lost its tab or its filters, or Forward was gone: ${b.at()} (${b.hist.length}/${len})`)
      off()
      if (b.listeners.size) fails.push('C: onAddressChange off() left its popstate listener')
    }

    // ── E. one writer, nested ──
    {
      const b = browser('https://x.test/p?tab=regions')
      const el = new EventTarget(); const got = []
      el.addEventListener(va.VIEW_EVENT, (e) => got.push(e))
      const r = va.claimView({ pane: 'dashboard', place: 'angola', filters: 'x' }, { owner: '', el, push: true })
      if (b.writes.push + b.writes.replace) fails.push('E: a claim by an element that does not own the address WROTE history')
      if (r !== 'announced' || got.length !== 1) fails.push(`E: a non-owner's claim is not ONE announcement (${r}, ${got.length})`)
      else if (JSON.stringify(got[0].detail?.changes) !== JSON.stringify({ pane: 'dashboard', place: 'angola' }) || got[0].detail?.push !== true) fails.push(`E: an announcement carries more or less than the view keys: ${JSON.stringify(got[0].detail)}`)
      const r2 = va.claimView({ pane: 'dashboard' }, { owner: 'app', el })
      if (r2 !== 'written' || got.length !== 1 || b.writes.push !== 1) fails.push(`E: an owner's claim did not write it itself (${r2}, ${got.length} events)`)
    }
    {
      const b = browser('https://x.test/shell?tab=regions&lang=ar')
      const el = new EventTarget(); let owner = 'app'
      const off = va.ownAddress(el, () => owner)
      const fire = (changes, push = true) => { const e = new CustomEvent(va.VIEW_EVENT, { bubbles: true, composed: true, detail: { changes, push } }); el.dispatchEvent(e); return e }
      const e1 = fire({ pane: 'dashboard', place: 'angola' })
      if (b.writes.push !== 1 || b.at() !== '/shell?tab=regions&pane=dashboard&place=angola&lang=ar') fails.push(`E: an owner did not record a nested pane + place as ONE push: ${b.at()} (${b.writes.push} pushes)`)
      if (!e1.cancelBubble) fails.push('E: a recorded announcement went on bubbling (an outer owner could write it twice)')
      fire({ place: 'angola' })
      if (b.writes.push !== 1) fails.push('E: the selection claimed again after its pane click was a second Back step')
      owner = ''
      const e2 = fire({ place: 'benin' })
      if (b.writes.push !== 1 || b.writes.replace) fails.push('E: ownAddress wrote while the page has no owner')
      if (e2.cancelBubble) fails.push('E: an announcement an element does not own was stopped (the real owner further out never hears it)')
      owner = 'app'
      const before = b.at()
      fire({ tab: 'posters' })
      if (b.at() !== before) fails.push(`E: a nested announcement switched the OWNER's tab: ${b.at()}`)
      off(); fire({ place: 'benin' })
      if (b.writes.push !== 1) fails.push('E: ownAddress off() left its listener')
      b.hist.back()
      if (b.at() !== '/shell?tab=regions&lang=ar') fails.push(`E: Back after a pane + place click did not return in one step: ${b.at()}`)
    }

    // ── F. pane-wrapper's address, on a simulated column (the slow arm: it waits out the scroll debounce) ──
    globalThis.document = { createElement: () => new FakeEl() }
    if (!skipF) {
      const b = browser('https://x.test/regions-mfe?pane=dashboard&lang=ar')
      const host = new FakeEl(); const got = []
      host.addEventListener(va.VIEW_EVENT, (e) => got.push(e))
      const c = pw.buildPaneColumn(SPEC, { host, address: { owner: () => 'app' } })
      const col = host.children[0]
      await settle()
      if (col.scrollTop !== 100) fails.push(`F: a link to ?pane=dashboard did not open that pane (scrollTop ${col.scrollTop})`)
      if (b.writes.push + b.writes.replace) fails.push('F: opening a link wrote the address')
      c.scrollTo('list'); await settle()
      if (b.writes.push !== 1 || b.at() !== '/regions-mfe?lang=ar') fails.push(`F: a click on the first pane is not ONE push that removes ?pane= (the default is never written): ${b.at()}`)
      c.scrollTo('dashboard', { changes: { place: 'angola' } }); await settle()
      if (b.writes.push !== 2 || b.at() !== '/regions-mfe?pane=dashboard&place=angola&lang=ar') fails.push(`F: a click's pane and its selection are not ONE push: ${b.at()} (${b.writes.push} pushes)`)
      const w2 = b.writes.push + b.writes.replace
      b.hist.back(); await settle()
      if (col.scrollTop !== 0 || b.writes.push + b.writes.replace !== w2) fails.push(`F: Back did not show the address's pane, or it WROTE (scrollTop ${col.scrollTop}, ${b.at()})`)
      b.hist.forward(); await settle()
      if (col.scrollTop !== 100 || b.writes.push + b.writes.replace !== w2) fails.push(`F: Forward wrote, or showed the wrong pane (scrollTop ${col.scrollTop})`)
      const w = b.writes.push + b.writes.replace
      col.scrollTo({ top: 0 }); await settle()
      if (b.writes.push + b.writes.replace !== w + 1 || b.writes.push !== 2 || b.at() !== '/regions-mfe?place=angola&lang=ar') fails.push(`F: where the reader's scroll settles is not ONE replace (place kept): ${b.at()}`)
      c.destroy()
      if (b.listeners.size) fails.push('F: destroy() left its popstate listener')
      if (got.length) fails.push('F: an owner composite announced instead of writing')
    }
    if (!skipF) {
      // A FRESH LOAD: the column is built before it has a layout (measured in a browser), and a ResizeObserver's
      // FIRST callback comes after layout, already with the full height. The link must still open.
      const ros = []
      globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; ros.push(this) } observe() {} disconnect() { this.off = true } }
      const b = browser('https://x.test/country-posters-mfe?pane=dashboard&lang=ar')
      const host = new FakeEl()
      FakeEl.h0 = 0
      const c = pw.buildPaneColumn(SPEC, { host, address: { owner: () => 'app' } })
      FakeEl.h0 = undefined
      const col = host.children[0]
      col.dispatchEvent(new Event('scroll')); await settle()
      if (b.at() !== '/country-posters-mfe?pane=dashboard&lang=ar') fails.push(`F: before its layout, the column overwrote the link it has not opened yet: ${b.at()}`)
      col.clientHeight = 100; ros.forEach((r) => !r.off && r.cb([])); await settle()
      if (col.scrollTop !== 100) fails.push(`F: a FRESH LOAD with ?pane=dashboard did not open that pane once the column had its layout (scrollTop ${col.scrollTop})`)
      if (b.writes.push + b.writes.replace) fails.push('F: opening a link on a fresh load wrote the address')
      c.destroy()
      delete globalThis.ResizeObserver
    }
    if (!skipF) {
      // The same fresh load, where the observer NEVER fires again after layout (a pane's height arrived after the
      // column's last resize): the bounded rAF loop must still open the link.
      const ros = []
      globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; ros.push(this) } observe() {} disconnect() { this.off = true } }
      globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 5)
      const b = browser('https://x.test/upg-100-mfe?pane=dashboard')
      const host = new FakeEl()
      FakeEl.h0 = 0
      const c = pw.buildPaneColumn(SPEC, { host, address: { owner: () => 'app' } })
      FakeEl.h0 = undefined
      const col = host.children[0]
      col.clientHeight = 100; await settle()
      if (col.scrollTop !== 100) fails.push(`F: with an observer that never fires again, the bounded rAF did not open the link (scrollTop ${col.scrollTop})`)
      if (b.writes.push + b.writes.replace) fails.push('F: the rAF-opened link wrote the address')
      c.destroy()
      delete globalThis.ResizeObserver; delete globalThis.requestAnimationFrame
    }
    if (!skipF) {
      // A KEPT-ALIVE column whose tab is hidden and shown again (ResizeObserver: no height, then height).
      const ros = []
      globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; ros.push(this) } observe() { this.cb([]) } disconnect() { this.off = true } }
      const b = browser('https://x.test/shell?tab=regions')
      const host = new FakeEl()
      const c = pw.buildPaneColumn(SPEC, { host, address: { owner: () => 'app' } })
      const col = host.children[0]
      const resize = async (hgt) => { col.clientHeight = hgt; ros.forEach((r) => !r.off && r.cb([])); await settle() }
      c.scrollTo('dashboard', null); await settle()
      if (b.at() !== '/shell?tab=regions&pane=dashboard') fails.push(`F: scrollTo(id, null) did not behave as scrollTo(id): ${b.at()}`)
      await resize(0)
      va.writeViewKeys({ tab: 'posters' }, { owner: 'app' }); va.writeViewKeys({ tab: 'regions' }, { owner: 'app' })
      const w = b.writes.push + b.writes.replace
      await resize(100)
      if (b.at() !== '/shell?tab=regions&pane=dashboard' || b.writes.push + b.writes.replace !== w + 1 || b.writes.replace < 1) fails.push(`F: a kept-alive column shown again did not claim its pane back with ONE replace: ${b.at()}`)
      await resize(0)
      col.scrollTop = 0
      va.commitUrl({ search: '?tab=regions&pane=dashboard' })
      const w2 = b.writes.push + b.writes.replace
      await resize(100)
      if (col.scrollTop !== 100 || b.writes.push + b.writes.replace !== w2) fails.push(`F: shown again with an address that names a pane, the column did not show it (or wrote): scrollTop ${col.scrollTop}`)
      c.destroy()
      if (!ros.every((r) => r.off)) fails.push('F: destroy() left its ResizeObserver')
      delete globalThis.ResizeObserver
    }
    if (!skipF) {
      const b = browser('https://x.test/shell?tab=regions')
      const host = new FakeEl(); const got = []
      host.addEventListener(va.VIEW_EVENT, (e) => got.push(e))
      const c = pw.buildPaneColumn(SPEC, { host, address: { owner: () => '' } })
      c.scrollTo('dashboard'); await settle()
      if (b.writes.push + b.writes.replace) fails.push('F: a NESTED composite wrote history')
      if (!got.length || got[0].detail?.changes?.pane !== 'dashboard' || got[0].detail?.push !== true) fails.push('F: a nested composite did not announce its pane to the owner')
      c.destroy()
    }
    if (!skipF) {
      const b = browser('https://x.test/plain?pane=dashboard')
      const host = new FakeEl(); const got = []
      host.addEventListener(va.VIEW_EVENT, (e) => got.push(e))
      const c = pw.buildPaneColumn(SPEC, { host })
      c.scrollTo('dashboard'); await settle(); c.scrollTo('list'); await settle()
      if (b.writes.push + b.writes.replace || got.length || host.children[0].scrollTop !== 0) fails.push('F: a column WITHOUT the address opt-in read or wrote the address')
      c.destroy()
    }
    delete globalThis.document
  } finally { unset(); delete globalThis.document }

  // ── G. the wiring in Regions ──
  {
    const m = src.mfe, d = src.dash
    if (!/buildPaneColumn\(spec\.value, \{ host: stage\.value, address: \{ owner \} \}\)/.test(m)) fails.push('G: regions-mfe does not opt its column into the address')
    if (!/ownAddress\(stage\.value, owner\)/.test(m)) fails.push("G: regions-mfe does not record its panes' announcements on its own leaf (ownAddress)")
    if (!/go\('dashboard', \{ place: detail\.countrySlug \|\| detail\.regionSlug/.test(m)) fails.push('G: regions-mfe opens the dashboard without its place (two Back steps for one click)')
    if (!/claimView\(\{ place: currentSlug\(\) \}/.test(d)) fails.push('G: region-dashboards does not claim ?place=')
    if (!/claimPlace\(false\)/.test(d) || !/claimPlace\(true\)/.test(d)) fails.push('G: region-dashboards does not replace at first paint and push on a choice')
    if (!/onAddressChange\(onAddress\)/.test(d)) fails.push('G: region-dashboards does not re-apply ?place= on Back/Forward')
    if (!/new ResizeObserver\([\s\S]{0,400}else if \(!place\) claimPlace\(false\)/.test(d)) fails.push('G: a kept-alive region-dashboards shown again does not claim its place back')
    // A composite that opts its column in also owns its own leaf: it records its panes' choices (ownAddress) and
    // releases that listener on unmount, or a choice made inside it on its own leaf is never written.
    if (!Object.keys(src.opted || {}).length) fails.push('G: no composite opts its pane column into the address (the census of opted composites is empty)')
    for (const [f, t] of Object.entries(src.opted || {})) {
      if (!/ownAddress\(stage\.value, owner\)/.test(t)) fails.push(`G: ${f} opts its column in but does not record its panes' choices (ownAddress)`)
      else if (!/offOwn\?\.\(\)/.test(t)) fails.push(`G: ${f} never releases ownAddress`)
    }
    // Each shell that owns a page records its nested composites' choices, and releases the listener on unmount
    // BEFORE any hot-update early return (or a hot remount stacks a second one).
    for (const [f, t] of Object.entries(src.shells || {})) {
      if (!/this\._offOwn = ownAddress\(this\.\$el, \(\) => urlOwnerOf\(this\.cfg\)\)/.test(t)) { fails.push(`G: the shell ${f} does not record nested choices (ownAddress)`); continue }
      const bu = t.indexOf('beforeUnmount()')
      const rel = bu < 0 ? -1 : t.indexOf('this._offOwn()', bu)
      const hot = bu < 0 ? -1 : t.indexOf('if (import.meta.hot) return', bu)
      if (rel < 0 || (hot >= 0 && hot < rel)) fails.push(`G: the shell ${f} does not release ownAddress in beforeUnmount before any hot-update return`)
    }
  }

  // ── D. the census ──
  for (const [file, n] of Object.entries(counts)) {
    if (!KNOWN[file]) fails.push(`D: a new history writer: ${file} (${n}). Route it through useViewAddress (commitUrl), or list it in KNOWN with its reason`)
    else if (KNOWN[file][0] !== n) fails.push(`D: ${file} now has ${n} history writes, the census says ${KNOWN[file][0]}`)
  }
  for (const file of Object.keys(KNOWN)) if (!counts[file]) fails.push(`D: ${file} is listed as a writer but no longer writes: drop its row`)
  return fails
}

const va = await import(join(ROOT, 'library/composables/useViewAddress.js'))
const sv = await import(join(ROOT, 'library/composables/useShareableView.js'))
const PW = 'library/layouts/pane-wrapper/pane-wrapper.js'
const pw = await import(join(ROOT, PW))
const SHELLS = ['plugin-studio/plugin-studio.vue', 'doxa-maps-spa/doxa-maps-spa.vue', 'posterverse/posterverse.vue']
// Every composite that opts its pane column into the address, enumerated from the tree.
const OPTED = execFileSync('git', ['grep', '--untracked', '-lE', 'buildPaneColumn\\([^)]*address:', '--', 'plugin-designs', 'library', ':!*.md'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const src = {
  mfe: readFileSync(join(ROOT, 'plugin-designs/regions-dashboard/regions-mfe.vue'), 'utf8'),
  dash: readFileSync(join(ROOT, 'plugin-designs/regions-dashboard/region-dashboards.vue'), 'utf8'),
  shells: Object.fromEntries(SHELLS.map((f) => [f, readFileSync(join(ROOT, 'plugin-designs', f), 'utf8')])),
  opted: Object.fromEntries(OPTED.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')])),
}
const counts = census()
const real = { va, sv, counts, pw, src }
// A pane-wrapper with one line changed, loaded from a sibling file so its relative import still resolves.
let nth = 0
async function pwVariant(from, to) {
  const s = readFileSync(join(ROOT, PW), 'utf8')
  if (!s.includes(from)) throw new Error('poison anchor not found in pane-wrapper.js: ' + from)
  const f = join(ROOT, `library/layouts/pane-wrapper/.tmp-check-view-address-${process.pid}-${nth++}.js`)
  writeFileSync(f, s.replace(from, to))
  try { return await import(f) } finally { unlinkSync(f) }
}
let code = 0
if (process.argv.includes('--self-test')) {
  // The old filter write, as it was: its own replaceState(null, …) of the whole URL.
  const oldFilterWrite = (fs, term, o = {}) => {
    const url = o.mode === 'query' ? sv.serializeQuery(fs, term, location.search, o) + location.hash : location.search + sv.serializeView(fs, term, o)
    history.replaceState(null, '', location.pathname + url); return true
  }
  const poisons = [
    ['a write that drops history.state.current', { ...real, va: { ...va, writeViewKeys: (c, o) => { const s = va.viewSearch(location.search, c); history[o.push ? 'pushState' : 'replaceState']({ ...history.state }, '', location.pathname + s + location.hash); return 'written' } } }, /^B: history\.state\.current/],
    ['a write when not the owner', { ...real, va: { ...va, writeViewKeys: (c, o) => va.writeViewKeys(c, { ...o, owner: 'app' }) } }, /^B: a partner page/],
    ['a tab change that keeps a stale place', { ...real, va: { ...va, viewSearch: (s, c) => { const k = { ...va.readViewKeys(s), ...Object.fromEntries(Object.entries(c).map(([a, b]) => [a, va.cleanKey(b)])) }; const f = s.replace(/^\?/, '').split('&').filter((p) => p && !va.VIEW_KEYS.includes(p.split('=')[0])); const all = [...va.VIEW_KEYS.filter((x) => k[x]).map((x) => `${x}=${k[x]}`), ...f]; return all.length ? '?' + all.join('&') : '' } } }, /^A: a tab change drops pane and place/],
    ['a whitelist with no length cap', { ...real, va: { ...va, cleanKey: (v) => (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(v ?? '')) ? String(v) : '') } }, /^A: the whitelist lets/],
    ['unchanged judged by the string, not the values', { ...real, va: { ...va, writeViewKeys: (c, o) => { if (o.owner !== 'app') return va.writeViewKeys(c, o); const s = va.viewSearch(location.search, c); if (s === location.search) return 'unchanged'; return va.commitUrl({ search: s }, { push: o.push }) ? 'written' : 'unchanged' } } }, /^B: the same keys in another order were rewritten/],
    ['a write when the address is unchanged', { ...real, va: { ...va, writeViewKeys: (c, o) => { const s = va.viewSearch(location.search, c); history[o.push ? 'pushState' : 'replaceState']({ ...(history.state || {}), current: location.pathname + s + location.hash }, '', location.pathname + s + location.hash); return 'written' } } }, /^B: an unchanged address wrote|^C: re-applying the tab after Back WROTE/],
    ["a 'host' owner that writes history itself", { ...real, va: { ...va, writeViewKeys: (c, o) => va.writeViewKeys(c, { ...o, owner: o.owner === 'host' ? 'app' : o.owner }) } }, /^B: a 'host' owner wrote/],
    ['a dxm-address that cannot leave a shadow root', { ...real, va: { ...va, writeViewKeys: (c, o) => { if (o.owner !== 'host') return va.writeViewKeys(c, o); const s = va.viewSearch(location.search, c); o.el.dispatchEvent(new CustomEvent(va.ADDRESS_EVENT, { bubbles: true, detail: { keys: va.readViewKeys(s), href: location.pathname + s, push: o.push } })); return 'announced' } } }, /^B: dxm-address cannot leave/],
    // the three coexistence poisons
    ['a FILTER write that drops tab/pane/place (no foreign params kept)', { ...real, sv: { ...sv, writeFilterView: (fs, term, o = {}) => va.commitUrl(o.mode === 'query' ? { search: sv.serializeQuery(fs, term, '', o) } : { search: '', hash: sv.serializeView(fs, term, o) }) } }, /^C: a filter write \((query|hash)\) dropped tab\/pane\/place/],
    ['the old filter write: its own replaceState(null) (the router state is wiped)', { ...real, sv: { ...sv, writeFilterView: oldFilterWrite } }, /^C: a filter write dropped the router's history\.state/],
    ['a TAB write that drops the filters (foreign params and hash)', { ...real, va: { ...va, writeViewKeys: (c, o) => { if (o.owner !== 'app') return va.writeViewKeys(c, o); const k = va.readViewKeys(va.viewSearch(location.search, c)); const s = va.VIEW_KEYS.filter((x) => k[x]).map((x) => `${x}=${k[x]}`).join('&'); return va.commitUrl({ search: s ? '?' + s : '', hash: '' }, { push: o.push }) ? 'written' : 'unchanged' } } }, /^C: a (tab|place) write dropped the filters/],
    ['a tab change written as a REPLACE (Back leaves the page)', { ...real, va: { ...va, writeViewKeys: (c, o) => va.writeViewKeys(c, { ...o, push: false }) } }, /^B: an app owner's tab change is not ONE push|^C: after Back/],
    ['a popstate handler that writes the address', { ...real, va: { ...va, onAddressChange: (cb) => va.onAddressChange((k) => { cb(k); history.pushState(history.state, '', location.href) }) } }, /^C: re-applying the tab after Back WROTE|^C: after Forward/],
    // the census
    ['a new history writer in the tree', { ...real, counts: { ...counts, 'plugin-designs/some-plugin/page.vue': 1 } }, /^D: a new history writer/],
    ['useShareableView writing history itself again', { ...real, counts: { ...counts, 'library/composables/useShareableView.js': 1 } }, /^D: a new history writer: library\/composables\/useShareableView\.js/],
    ['region-dashboards writing its #slug itself again', { ...real, counts: { ...counts, 'plugin-designs/regions-dashboard/region-dashboards.vue': 2 } }, /^D: a new history writer: plugin-designs\/regions-dashboard/],
    // P2: nested writes, pane-wrapper, the Regions wiring
    ['the old level rule: a pane change drops place', { ...real, va: { ...va, viewSearch: (s, c) => va.viewSearch(s, 'pane' in c && !('place' in c) ? { ...c, place: '' } : c) } }, /^A: a pane change keeps tab and place/],
    ['a claim by a non-owner that writes', { ...real, va: { ...va, claimView: (c, o) => va.writeViewKeys(c, { ...o, owner: 'app' }) } }, /^E: a claim by an element that does not own/],
    ['an announcement that carries any key', { ...real, va: { ...va, claimView: (c, o) => (o.owner ? va.claimView(c, o) : (o.el.dispatchEvent(new CustomEvent(va.VIEW_EVENT, { bubbles: true, composed: true, detail: { changes: c, push: o.push } })), 'announced')) } }, /^E: an announcement carries more or less/],
    ['ownAddress that writes with no owner', { ...real, va: { ...va, ownAddress: (el, g) => va.ownAddress(el, () => g() || 'app') } }, /^E: ownAddress wrote while the page has no owner/],
    ['ownAddress that lets a recorded announcement bubble on', { ...real, va: { ...va, ownAddress: (el, g) => { const h = (e) => { const o = g(); if (o) va.writeViewKeys(e.detail.changes, { owner: o, el, push: e.detail.push }) }; el.addEventListener(va.VIEW_EVENT, h); return () => el.removeEventListener(va.VIEW_EVENT, h) } } }, /^E: a recorded announcement went on bubbling/],
    ['pane-wrapper writing the default pane', { ...real, pw: await pwVariant("pane: id === column[0].id ? '' : id", 'pane: id') }, /^F: a click on the first pane/],
    ["pane-wrapper writing a click's selection separately", { ...real, pw: await pwVariant('if (write && known(paneId)) claimPane(paneId, push, changes)', 'if (write && known(paneId)) { claimPane(paneId, push); if (Object.keys(changes).length) claimView(changes, { owner: address.owner(), el: host, push }) }') }, /^F: a click's pane and its selection are not ONE push/],
    ['pane-wrapper pushing where a scroll settles', { ...real, pw: await pwVariant('claimPane(current(), false)', 'claimPane(current(), true)') }, /^F: where the reader's scroll settles/],
    ['pane-wrapper writing on Back (the pane it is leaving)', { ...real, pw: await pwVariant("show(known(pane) ? pane : column[0].id, 'smooth')", "(claimPane(current(), true), show(known(pane) ? pane : column[0].id, 'smooth'))") }, /^F: Back did not show the address's pane, or it WROTE/],
    ['pane-wrapper opening a link at build time only (before the column has a layout)', { ...real, pw: await pwVariant("let pending = known(linked) && linked !== column[0].id ? linked : ''", "let pending = ''; if (known(linked)) show(linked, 'instant')") }, /^F: a FRESH LOAD with \?pane=dashboard did not open/],
    ['pane-wrapper whose settle overwrites a link still waiting to open', { ...real, pw: await pwVariant('if (col.clientHeight && !pending) claimPane(current(), false)', 'if (!pending || true) claimPane(current(), false)') }, /^F: before its layout, the column overwrote the link/],
    ['pane-wrapper retrying a pending link by rAF only when there is no observer', { ...real, pw: await pwVariant("if (pending && typeof requestAnimationFrame !== 'undefined') {", "if (pending && typeof ResizeObserver === 'undefined' && typeof requestAnimationFrame !== 'undefined') {") }, /^F: with an observer that never fires again/],
    ['pane-wrapper ignoring a link', { ...real, pw: await pwVariant("let pending = known(linked) && linked !== column[0].id ? linked : ''", "let pending = ''") }, /^F: a link to \?pane=dashboard did not open/],
    ['pane-wrapper writing without the opt-in', { ...real, pw: await pwVariant("=> address && claimView({ pane: id === column[0].id ? '' : id, ...changes }, { owner: address.owner(),", "=> claimView({ pane: id === column[0].id ? '' : id, ...changes }, { owner: address ? address.owner() : 'app',") }, /^F: a column WITHOUT the address opt-in/],
    ['ownAddress that lets a nested element switch the tab', { ...real, va: { ...va, ownAddress: (el, g) => { const h = (e) => { const o = g(); if (o) { e.stopPropagation(); va.writeViewKeys(e.detail.changes, { owner: o, el, push: e.detail.push }) } }; el.addEventListener(va.VIEW_EVENT, h); return () => el.removeEventListener(va.VIEW_EVENT, h) } } }, /^E: a nested announcement switched the OWNER's tab/],
    ['pane-wrapper not claiming its pane when shown again', { ...real, pw: await pwVariant("if (typeof ResizeObserver !== 'undefined') {", 'if (false) {') }, /^F: a kept-alive column shown again/],
    ['pane-wrapper letting the screen beat an address that names a pane', { ...real, pw: await pwVariant('if (known(asked) && asked !== current()) show(asked, \'instant\')\n        else if (!asked) claimPane', 'if (false) show(asked, \'instant\')\n        else claimPane') }, /^F: shown again with an address that names a pane/],
    ['pane-wrapper whose scrollTo(id, null) throws (the old default)', { ...real, pw: await pwVariant('const { write = true, push = true, changes = {} } = o || {}', 'const { write = true, push = true, changes = {} } = o === undefined ? {} : o') }, /^F: scrollTo\(id, null\)|^THREW: .*null/],
    ['region-dashboards not claiming its place when shown again', { ...real, src: { ...src, dash: src.dash.replace('else if (!place) claimPlace(false)', 'else if (!place) void 0') } }, /^G: a kept-alive region-dashboards shown again/],
    ['regions-mfe opening the dashboard without its place', { ...real, src: { ...src, mfe: src.mfe.replace("go('dashboard', { place: detail.countrySlug || detail.regionSlug || '' })", "go('dashboard')") } }, /^G: regions-mfe opens the dashboard without its place/],
    ['regions-mfe without the address opt-in', { ...real, src: { ...src, mfe: src.mfe.replace('{ host: stage.value, address: { owner } }', '{ host: stage.value }') } }, /^G: regions-mfe does not opt its column in/],
    ['a composite that opts in without ownAddress', { ...real, src: { ...src, opted: { ...src.opted, 'plugin-designs/x/x-mfe.vue': "column = buildPaneColumn(spec.value, { host: stage.value, address: { owner } })" } } }, /^G: plugin-designs\/x\/x-mfe\.vue opts its column in but does not record/],
    ['no composite opted in at all', { ...real, src: { ...src, opted: {} } }, /^G: no composite opts its pane column/],
    ['Plugin Studio without ownAddress', { ...real, src: { ...src, shells: { ...src.shells, 'plugin-studio/plugin-studio.vue': src.shells['plugin-studio/plugin-studio.vue'].replace('this._offOwn = ownAddress(this.$el, () => urlOwnerOf(this.cfg))', 'this._offOwn = null') } } }, /^G: the shell plugin-studio\/plugin-studio\.vue does not record/],
    ['Plugin Studio releasing ownAddress after its hot-update return', { ...real, src: { ...src, shells: { ...src.shells, 'plugin-studio/plugin-studio.vue': src.shells['plugin-studio/plugin-studio.vue'].replace('    if (this._offOwn) { this._offOwn(); this._offOwn = null }\n    if (import.meta.hot) return', '    if (import.meta.hot) return\n    if (this._offOwn) { this._offOwn(); this._offOwn = null }') } } }, /^G: the shell plugin-studio\/plugin-studio\.vue does not release/],
    ['the Research Gallery without ownAddress', { ...real, src: { ...src, shells: { ...src.shells, 'doxa-maps-spa/doxa-maps-spa.vue': src.shells['doxa-maps-spa/doxa-maps-spa.vue'].replace('this._offOwn = ownAddress(', 'this._offOwn = (') } } }, /^G: the shell doxa-maps-spa/],
    ['Posterverse never releasing ownAddress', { ...real, src: { ...src, shells: { ...src.shells, 'posterverse/posterverse.vue': src.shells['posterverse/posterverse.vue'].replace('if (this._offOwn) { this._offOwn(); this._offOwn = null }', 'void 0') } } }, /^G: the shell posterverse\/posterverse\.vue does not release/],
    ['region-dashboards not re-applying ?place= on Back', { ...real, src: { ...src, dash: src.dash.replace('onAddressChange(onAddress)', 'null') } }, /^G: region-dashboards does not re-apply/],
  ]
  for (const [name, inp, rx] of poisons) {
    let f
    // Only a pane-wrapper poison needs the slow arm F; every other poison must fail its own, faster arm.
    try { f = await arms(inp, { skipF: !/^\/\^F|THREW/.test(String(rx)) }) } catch (e) { f = ['THREW: ' + e.message] }
    const ok = f.some((x) => rx.test(x))
    console.log(ok ? `✓ caught: ${name} -> ${f.find((x) => rx.test(x))}` : `✗ MISSED: ${name}${f.length ? ' (failed instead: ' + f[0] + ')' : ''}`)
    if (!ok) code = 1
  }
} else {
  const f = await arms(real)
  if (f.length) { f.forEach((x) => console.log('FAIL ' + x)); code = 1 }
  else console.log(`PASS check:view-address — the id whitelist and the level rule; one push per tab change with history.state + current kept; nothing written when unchanged, on a partner page, or by a 'host' owner (one dxm-address instead); filters and tab/pane/place keep each other through writes, Back and Forward; nested choices announced and recorded by the one owner, a pane and its selection as one Back step; pane-wrapper's opt-in ?pane= (link, click, scroll, Back) and the Regions wiring; ${Object.keys(counts).length} history writers in the tree, all accounted for`)
}
process.exit(code)
