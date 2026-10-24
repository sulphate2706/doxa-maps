#!/usr/bin/env node
/**
 * check-poster-wall-host-seams.mjs: PosterWall's two host seams, headerAction and previewSrc, do what they
 * say, and with neither set every wall behaves as before.
 *
 * WHY (headerAction). PosterWall's card header was hard-wired to "Show on map". A wall with no map beside it (the
 * Poster Design gallery) needs the same card with a different action, so the header became a seam:
 * headerAction null (the default) keeps the "Show on map" TOGGLE; { labelKey, ariaKey } makes it a
 * plain button that emits 'header-action'. Every existing wall passes nothing, so the default path is
 * the one that must not move, and the new path must not leak the old one's side effects (a window
 * event a map would act on, aria-pressed, the is-last highlight).
 *
 * WHY (previewSrc). The card's thumbnail was always the stored previews/<id>.webp. A gallery of templates
 * drawn from the library has no stored file and must show a library change, so the thumbnail can come
 * from the host. A gallery renders many cards, so the seam is LAZY (only cards in view), ONE render at a
 * time, cached per page, and bounded: no answer, a throw or a timeout falls back to the wall's
 * "preview unavailable" placeholder, never a blank or an endless wait.
 *
 * HOW. No browser (fleet policy). PosterWall has no <style> block, so it is compiled here as a CLIENT
 * component (compiler-sfc, inline template) and loaded through Vite with the repo's @map alias. It is
 * mounted on a recording renderer: every element keeps its tag, props and children, so the gate reads
 * the rendered header buttons and CALLS their real onClick. Two arms, one card each:
 *   A (default)       one .tape-h, aria-pressed="false"; a click dispatches ONE window event named by
 *                     eventName with listId = the item id, sets aria-pressed="true" and is-last, and
 *                     emits nothing; a second click dispatches listId null (the toggle).
 *   B (headerAction)  one .tape-h, NO aria-pressed, label = "7 UPG ·" + t(labelKey), aria-label = t(ariaKey);
 *                     a click emits 'header-action' with the item, dispatches NO window event, sets no is-last.
 *   C (headerAction, an item with no count)  the sticker reads t(labelKey) alone: no "UPG", no "·".
 *   D (no previewSrc)  the card is an <img class="img"> on previews/<id>.webp; no pending placeholder, and the
 *                     wall creates no IntersectionObserver.
 *   E (previewSrc)    3 cards, all pending, 0 renders before any is in view (lazy), observed with the wall's
 *                     own scroller as the root (it clips its cards). Two come into view: exactly
 *                     one render runs; when it answers a URL that card becomes an <img> with that src and the
 *                     second render starts; an answer of null gives the "preview unavailable" placeholder. The
 *                     card never in view is never rendered.
 *   F (previewSrc that never answers)  after the timeout the card shows the placeholder.
 *   G (cache)         a remount with the same instanceId shows the cached URL with no second render.
 *   H (no previewSrc, the stored webp fails)  the first error retries the tree's own copy
 *                     (<tree>/assets/previews/<id>.webp) and only the second shows the placeholder.
 *   I (previewSrc, the generated image fails)  one error shows the placeholder: there is no second base.
 *   J (section heads)  a section with people (total > 0) reads "<n people groups> · <items>", as it always has;
 *                     a section with none (a template gallery) reads "<items>" alone: no 0 count, no " · ".
 *   L (the loader)  a fixture component that imports a CHILD .vue by relative path loads and renders the child's text:
 *                     PosterWall may render its sections through a child component, and the gate must still load it.
 *   K (sectionItemCountKey)  a section the callback names is counted in its own words and number ({ key, n });
 *                     a section it answers null for keeps the default count.
 * embedBase.js is served to the gate as if from a BUILT tree (<tree>/<bundle>/<bundle>.js), because
 * PosterWall's second base is derived from that URL; from source it is empty and H could not fail.
 * A vacuous run (no .tape-h found, or no items rendered) FAILS.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join, isAbsolute, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WALL = join(ROOT, 'library/components/poster/PosterWall.vue')
const LOADER_FIXTURE = join(ROOT, 'internal/fixtures/poster-wall-host-seams/GateParent.vue')
const failures = []
const fail = (m) => failures.push(m)

// ── the thinnest page PosterWall's setup touches ───────────────────────────────────────────────
const dispatched = []
const observers = []
{
  const noop = () => {}
  const el = () => ({ style: {}, dataset: {}, setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    appendChild: (c) => c, removeChild: noop, addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [], getRootNode() { return this },
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false } })
  const html = el(); html.lang = 'en'
  Object.assign(globalThis, {
    window: globalThis, self: globalThis,
    document: Object.assign(el(), { documentElement: html, head: el(), body: el(), createElement: el, createTextNode: el,
      currentScript: null, readyState: 'complete', cookie: '', getElementById: () => null }),
    location: new URL(`https://gate.invalid/${TREE_NAME}/x/x/index.html?lang=en`),
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    addEventListener: noop, removeEventListener: noop,
    dispatchEvent: (e) => { dispatched.push(e); return true },
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    // A RECORDING observer, so the gate can bring a card into view on demand.
    IntersectionObserver: class { constructor(cb, opts) { this.cb = cb; this.opts = opts || {}; this.els = new Set(); observers.push(this) }
      observe(e) { this.els.add(e) } unobserve(e) { this.els.delete(e) } disconnect() { this.els.clear() } },
    MutationObserver: class { observe() {} disconnect() {} },
    HTMLElement: class {}, ShadowRoot: globalThis.ShadowRoot || class ShadowRoot {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail } },
  })
  if (!globalThis.navigator?.language) globalThis.navigator = { language: 'en', languages: ['en'], userAgent: 'gate' }
}

// ── PosterWall as a CLIENT component, loaded through Vite for the alias ────────────────────────
// PosterWall's fallback base comes from the bundle's own script URL (embedBase.js bundleTreeRoot), which
// from source is not a built bundle URL, so the fallback would be empty and arm H vacuous.
const GATE_TREE = 'https://gate.invalid/tree'
const builtScriptUrl = {
  name: 'gate-built-script-url',
  transform(code, id) {
    if (!id.endsWith('/library/utils/embedBase.js')) return null
    if (!/const SCRIPT_URL = import\.meta\.url/.test(code)) throw new Error('embedBase.js no longer reads SCRIPT_URL from import.meta.url; update arm H')
    return code.replace(/const SCRIPT_URL = import\.meta\.url/, `const SCRIPT_URL = ${JSON.stringify(GATE_TREE + '/poster-design/poster-design.js')}`)
  },
}
// EVERY .vue on the way is compiled here as a CLIENT component: PosterWall, and any .vue it imports (a child component
// such as a section). Each keeps its REAL path plus a ?gate-client marker, so its own relative imports resolve as they do
// in the build. The gate runs Vite without the Vue plugin, so without this hook a child .vue import fails to LOAD and
// the gate goes red on correct code. Arm L proves the hook with a parent/child fixture.
const CLIENT = '?gate-client'
const clientCompile = {
  name: 'gate-client-sfc',
  // 'pre': Vite's own resolver would otherwise resolve a relative './Child.vue' first and load it raw.
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === 'virtual:poster-wall-client') return WALL + CLIENT
    if (source === 'virtual:gate-loader-fixture') return LOADER_FIXTURE + CLIENT
    if (!/\.vue$/.test(source)) return null
    const from = String(importer || '').split('?')[0]
    return (isAbsolute(source) ? source : resolve(dirname(from), source)) + CLIENT
  },
  async load(id) {
    if (!id.endsWith(CLIENT)) return null
    const file = id.slice(0, -CLIENT.length)
    const sfc = await import('@vue/compiler-sfc')
    const { descriptor, errors } = sfc.parse(readFileSync(file, 'utf8'), { filename: file })
    if (errors.length) throw new Error(`${relative(ROOT, file)} did not parse: ${errors[0].message}`)
    return sfc.compileScript(descriptor, { id: `gate-${basename(file, '.vue')}`, inlineTemplate: true }).content
  },
}

const { createServer } = await import('vite')
const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  plugins: [clientCompile, builtScriptUrl],
  resolve: { alias: { '@map': join(ROOT, 'library') } },
  define: { __DOXA_TREE_NAME__: JSON.stringify(TREE_NAME) },
})

// ── a renderer that records what it draws ──────────────────────────────────────────────────────
// Recorded elements also answer the few DOM calls PosterWall's hooks make (v-show writes style.display,
// the row fitter queries the wall, useShadowStyles finds its root node).
const noopFn = () => {}
function node(tag) {
  return { tag, props: {}, children: [], parent: null, text: '', style: { setProperty: noopFn, getPropertyValue: () => '' },
    dataset: {}, classList: { add: noopFn, remove: noopFn, toggle: noopFn, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], addEventListener: noopFn, removeEventListener: noopFn,
    setAttribute: noopFn, getAttribute: () => null, removeAttribute: noopFn, appendChild: (c) => c,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getRootNode() { return { host: null, adoptedStyleSheets: [], appendChild: (c) => c, querySelector: () => null } } }
}
function insert(child, parent, anchor) {
  if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
  child.parent = parent
  const i = anchor ? parent.children.indexOf(anchor) : -1
  if (i >= 0) parent.children.splice(i, 0, child); else parent.children.push(child)
}
const walk = (n, f) => { f(n); for (const c of n.children) walk(c, f) }
const textOf = (n) => { let s = ''; walk(n, (x) => { if (x.tag === '#text') s += x.text }); return s }
const hasClass = (n, c) => String(n.props.class || '').split(/\s+/).includes(c)
const classStr = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(classStr).join(' ')
  : v && typeof v === 'object' ? Object.keys(v).filter((k) => v[k]).join(' ') : '')

let buttonsSeen = 0
try {
  const rc = await import('@vue/runtime-core')
  const { createApp } = rc.createRenderer({
    insert, remove: (c) => { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = null },
    createElement: (tag) => node(tag), createText: (t) => Object.assign(node('#text'), { text: t }),
    createComment: () => node('#comment'), setText: (n, t) => { n.text = t },
    setElementText: (n, t) => { n.children = [Object.assign(node('#text'), { text: t, parent: n })] },
    parentNode: (n) => n.parent, nextSibling: (n) => { const p = n.parent; return p ? p.children[p.children.indexOf(n) + 1] || null : null },
    patchProp: (el, key, _prev, next) => { el.props[key] = key === 'class' ? classStr(next) : next },
  })
  const PosterWall = (await server.ssrLoadModule('virtual:poster-wall-client')).default
  const item = { id: 'gate-item', label: 'Gate Item', count: 7 }

  async function mountWall(extra, items = [item]) {
    const emitted = []
    const root = node('root')
    const app = createApp(PosterWall, { items, eventName: 'gate:show', instanceId: 'gate', ...extra,
      'onHeader-action': (i) => emitted.push(i) })
    app.config.errorHandler = (e) => fail(`mount error: ${e?.message || e}`)
    app.mount(root)
    await rc.nextTick()
    const tapes = []; walk(root, (n) => { if (n.tag === 'button' && hasClass(n, 'tape-h')) tapes.push(n) })
    const cards = []; walk(root, (n) => { if (n.tag === 'div' && hasClass(n, 'card')) cards.push(n) })
    buttonsSeen += tapes.length
    return { root, tapes, cards, emitted, app }
  }

  // ── A: the default is the toggle it always was ─────────────────────────────────────────────
  {
    dispatched.length = 0
    const w = await mountWall({})
    if (w.cards.length !== 1) fail(`A: expected 1 card, rendered ${w.cards.length}`)
    if (w.tapes.length !== 1) fail(`A: expected 1 header sticker, found ${w.tapes.length}`)
    const b = w.tapes[0]
    if (b) {
      if (b.props['aria-pressed'] !== 'false') fail(`A: aria-pressed should start "false", got ${JSON.stringify(b.props['aria-pressed'])}`)
      if (typeof b.props.onClick !== 'function') fail('A: the sticker has no click handler')
      else {
        b.props.onClick(); await rc.nextTick()
        const ev = dispatched.filter((e) => e.type === 'gate:show')
        if (ev.length !== 1 || ev[0].detail?.listId !== item.id) fail(`A: first click should dispatch gate:show with listId ${item.id}, got ${JSON.stringify(ev.map((e) => e.detail))}`)
        if (b.props['aria-pressed'] !== 'true') fail('A: aria-pressed should be "true" after the first click')
        if (!hasClass(w.cards[0], 'is-last')) fail('A: the card should carry is-last after the first click')
        b.props.onClick(); await rc.nextTick()
        const ev2 = dispatched.filter((e) => e.type === 'gate:show')
        if (ev2.length !== 2 || ev2[1].detail?.listId !== null) fail('A: second click should dispatch listId null (the toggle)')
      }
      if (w.emitted.length) fail(`A: the default must emit nothing, emitted ${w.emitted.length}`)
    }
    w.app.unmount()
  }

  // ── B: headerAction swaps the action and drops the toggle's side effects ────────────────────
  {
    dispatched.length = 0
    const w = await mountWall({ headerAction: { labelKey: 'gate.fullDetails', ariaKey: 'gate.fullDetailsAria' } })
    if (w.tapes.length !== 1) fail(`B: expected 1 header sticker, found ${w.tapes.length}`)
    const b = w.tapes[0]
    if (b) {
      if ('aria-pressed' in b.props && b.props['aria-pressed'] != null) fail(`B: a plain button must not carry aria-pressed, got ${JSON.stringify(b.props['aria-pressed'])}`)
      const label = textOf(b)
      // No i18n is installed, so t() falls back to humanizing the key: the label must come from
      // labelKey, and must not be the map wording.
      if (!/full\s*details/i.test(label)) fail(`B: label should come from labelKey, got ${JSON.stringify(label)}`)
      if (/on\s*map/i.test(label)) fail(`B: label still says the map wording: ${JSON.stringify(label)}`)
      if (!/7\s*UPG/.test(label)) fail(`B: an item WITH a count keeps its "7 UPG ·" prefix, got ${JSON.stringify(label)}`)
      if (!/aria/i.test(String(b.props['aria-label']))) fail(`B: aria-label should come from ariaKey, got ${JSON.stringify(b.props['aria-label'])}`)
      if (typeof b.props.onClick !== 'function') fail('B: the sticker has no click handler')
      else {
        b.props.onClick(); await rc.nextTick()
        if (w.emitted.length !== 1 || w.emitted[0]?.id !== item.id) fail(`B: a click should emit header-action with the item once, emitted ${JSON.stringify(w.emitted)}`)
        if (dispatched.some((e) => e.type === 'gate:show')) fail('B: a click must dispatch NO show-on-map window event')
        if (hasClass(w.cards[0], 'is-last')) fail('B: the card must not take the is-last highlight')
      }
    }
    w.app.unmount()
  }

  // ── C: a template card has no count, so its sticker is the label alone ─────────────────────
  {
    const w = await mountWall({ headerAction: { labelKey: 'gate.fullDetails' } }, [{ id: 'gate-template', label: 'Gate Template' }])
    const label = w.tapes[0] ? textOf(w.tapes[0]) : ''
    if (w.tapes.length !== 1) fail(`C: expected 1 header sticker, found ${w.tapes.length}`)
    else if (/UPG|·|undefined/.test(label) || !/full\s*details/i.test(label)) fail(`C: a countless item should read the label alone, got ${JSON.stringify(label)}`)
    w.app.unmount()
  }

  // ── the previewSrc seam ───────────────────────────────────────────────────────────────────────
  const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 0)); await rc.nextTick() } }
  const imgs = (root) => { const out = []; walk(root, (n) => { if (n.tag === 'img' && hasClass(n, 'img')) out.push(n) }); return out }
  const pending = (root) => { const out = []; walk(root, (n) => { if (n.tag === 'div' && hasClass(n, 'ph') && hasClass(n, 'is-pending')) out.push(n) }); return out }
  const phFor = (root, label) => { let hit = null; walk(root, (n) => { if (!hit && n.tag === 'div' && hasClass(n, 'ph') && textOf(n).includes(label)) hit = n }); return hit }
  const inView = (el) => { for (const io of observers) if (io.els.has(el)) io.cb([{ target: el, isIntersecting: true }]) }

  // D: no previewSrc, the stored file exactly as before
  {
    const before = observers.length
    const w = await mountWall({})
    const im = imgs(w.root)
    if (im.length !== 1 || !String(im[0].props.src).endsWith('/previews/gate-item.webp')) fail(`D: expected one img on previews/gate-item.webp, got ${JSON.stringify(im.map((x) => x.props.src))}`)
    if (pending(w.root).length) fail('D: a wall without previewSrc must show no pending placeholder')
    if (observers.length !== before) fail('D: a wall without previewSrc must create no IntersectionObserver')
    w.app.unmount()
  }

  // E + G: lazy, one at a time, fallback on null, cached
  const three = [{ id: 'p1', label: 'Pone', count: 3 }, { id: 'p2', label: 'Ptwo', count: 2 }, { id: 'p3', label: 'Pthree', count: 1 }]
  const calls = []; let inFlight = 0; let maxInFlight = 0; const answer = {}
  const previewSrc = (it) => { calls.push(it.id); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
    return new Promise((res) => { answer[it.id] = (v) => { inFlight--; res(v) } }) }
  {
    const w = await mountWall({ previewSrc, instanceId: 'gate-e' }, three)
    await settle()
    if (pending(w.root).length !== 3) fail(`E: expected 3 pending cards before any is in view, got ${pending(w.root).length}`)
    if (imgs(w.root).length) fail('E: no card may show an img before its preview arrives')
    if (calls.length) fail(`E: LAZY broken, ${calls.length} render(s) before any card was in view`)
    // A pane wall scrolls inside .wall, so the observer must watch THAT scroller or its margin never looks ahead.
    const io = observers[observers.length - 1]
    if (!io || !io.opts.root || io.opts.root.tag !== 'div' || !hasClass(io.opts.root, 'wall')) fail(`E: the observer's root should be the wall's own scroller (.wall), got ${io?.opts.root ? io.opts.root.tag + '.' + io.opts.root.props.class : String(io?.opts.root)}`)
    inView(phFor(w.root, 'Pone')); inView(phFor(w.root, 'Ptwo')); await settle()
    if (calls.length !== 1) fail(`E: ONE AT A TIME broken, ${calls.length} renders running with two cards in view`)
    answer.p1?.('blob:gate-one'); await settle()
    const im = imgs(w.root)
    if (im.length !== 1 || im[0].props.src !== 'blob:gate-one') fail(`E: the answered card should be an img on blob:gate-one, got ${JSON.stringify(im.map((x) => x.props.src))}`)
    if (calls.length !== 2 || calls[1] !== 'p2') fail(`E: the second render should start after the first answered, calls ${JSON.stringify(calls)}`)
    answer.p2?.(null); await settle()
    const ph2 = phFor(w.root, 'Ptwo')
    if (!ph2 || hasClass(ph2, 'is-pending') || !/unavailable/i.test(textOf(ph2))) fail(`E: a null answer should show the "preview unavailable" placeholder, got ${JSON.stringify(ph2 && textOf(ph2))}`)
    if (calls.includes('p3')) fail('E: a card never in view was rendered')
    if (maxInFlight !== 1) fail(`E: ${maxInFlight} renders overlapped`)
    w.app.unmount()
  }
  {
    const n = calls.length
    const w = await mountWall({ previewSrc, instanceId: 'gate-e' }, three)
    await settle()
    const p1 = phFor(w.root, 'Pone'); if (p1) inView(p1)
    await settle()
    if (calls.length !== n) fail(`G: CACHE broken, a remount rendered again (${calls.slice(n).join(',')})`)
    const im = imgs(w.root)
    if (!im.some((x) => x.props.src === 'blob:gate-one')) fail('G: the remount should show the cached blob:gate-one')
    w.app.unmount()
  }

  // F: a render that never answers is bounded by the timeout
  {
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, ms >= 10000 ? 1 : ms, ...a)
    try {
      const w = await mountWall({ previewSrc: () => new Promise(() => {}), instanceId: 'gate-f' }, [{ id: 'f1', label: 'Fone', count: 1 }])
      await settle()
      inView(phFor(w.root, 'Fone'))
      await settle(); await new Promise((r) => realSetTimeout(r, 20)); await settle()
      const ph = phFor(w.root, 'Fone')
      if (!ph || hasClass(ph, 'is-pending') || !/unavailable/i.test(textOf(ph))) fail(`F: a render that never answers should end on the placeholder, got ${JSON.stringify(ph && textOf(ph))}`)
      w.app.unmount()
    } finally { globalThis.setTimeout = realSetTimeout }
  }

  // H: a default wall's broken stored webp tries the tree's copy before giving up
  {
    const w = await mountWall({})
    const first = imgs(w.root)[0]
    const firstSrc = first?.props.src
    if (!first || typeof first.props.onError !== 'function') fail('H: the default card has no img error handler')
    else {
      first.props.onError(); await settle()
      const second = imgs(w.root)[0]
      const want = `${GATE_TREE}/assets/previews/gate-item.webp`
      if (!second || second.props.src !== want) fail(`H: the first error should retry ${want}, got ${JSON.stringify(second?.props.src)} (was ${JSON.stringify(firstSrc)})`)
      else {
        second.props.onError(); await settle()
        const ph = phFor(w.root, 'Gate Item')
        if (imgs(w.root).length || !ph || !/unavailable/i.test(textOf(ph))) fail('H: the second error should show the "preview unavailable" placeholder')
      }
    }
    w.app.unmount()
  }

  // I: a generated preview that fails to load has no second base
  {
    const w = await mountWall({ previewSrc: async () => 'blob:gate-broken', instanceId: 'gate-i' }, [{ id: 'i1', label: 'Ione', count: 1 }])
    await settle(); inView(phFor(w.root, 'Ione')); await settle()
    const im = imgs(w.root)[0]
    if (!im || im.props.src !== 'blob:gate-broken') fail(`I: the generated URL should be on the img, got ${JSON.stringify(im?.props.src)}`)
    else {
      im.props.onError(); await settle()
      const ph = phFor(w.root, 'Ione')
      if (imgs(w.root).length || !ph || !/unavailable/i.test(textOf(ph))) fail('I: one error on a generated preview should show the placeholder, not retry another base')
    }
    w.app.unmount()
  }

  // J: a section head names its people-group total only when there is one
  {
    const groups = { j1: 'People', j2: 'People', j3: 'Templates', j4: 'Templates' }
    const root = node('root')
    const app = createApp(PosterWall, { instanceId: 'gate-j', groupBy: (x) => groups[x.id],
      items: [{ id: 'j1', label: 'Jone', count: 5 }, { id: 'j2', label: 'Jtwo', count: 2 }, { id: 'j3', label: 'Jthree' }, { id: 'j4', label: 'Jfour' }] })
    app.mount(root); await rc.nextTick()
    const heads = []
    walk(root, (n) => { if (hasClass(n, 'sec-count')) heads.push(textOf(n).trim()) })
    if (heads.length !== 2) fail(`J: expected 2 section heads, found ${heads.length}`)
    const withPeople = heads.find((h) => /\b7\b/.test(h))
    const without = heads.find((h) => !/\b7\b/.test(h))
    if (!withPeople || !/·/.test(withPeople) || !/people/i.test(withPeople)) fail(`J: a section with people should read "<n> people groups · <items>", got ${JSON.stringify(withPeople)}`)
    if (!without || /·/.test(without) || /\b0\b/.test(without) || /people/i.test(without)) fail(`J: a section with no people should read its items alone, got ${JSON.stringify(without)}`)
    app.unmount()
  }

  // K: one section counted in its own words (India: its states, not countries); the others unchanged
  {
    const groups = { k1: 'India', k2: 'India', k3: 'India', k4: 'Asia', k5: 'Asia' }
    const root = node('root')
    const app = createApp(PosterWall, { instanceId: 'gate-k', groupBy: (x) => groups[x.id],
      sectionItemCountKey: (sec) => (sec.name === 'India' ? { key: 'regions.countryCount', n: 5 } : null),
      items: Object.keys(groups).map((id, i) => ({ id, label: id, count: i + 1 })) })
    app.mount(root); await rc.nextTick()
    const heads = {}
    walk(root, (n) => { if (hasClass(n, 'sec-head')) heads[textOf(n).includes('India') ? 'India' : 'Asia'] = textOf(n) })
    if (!/\b5 countries\b/.test(heads.India || '')) fail(`K: the named section should count 5 in its own key, got ${JSON.stringify(heads.India)}`)
    if (/\b3 list/.test(heads.India || '')) fail('K: the named section still shows the default count')
    if (!/\b2 lists?\b/.test(heads.Asia || '')) fail(`K: an unnamed section should keep the default count, got ${JSON.stringify(heads.Asia)}`)
    app.unmount()
  }

  // L: the gate loads a component that renders a child .vue (internal/fixtures/poster-wall-host-seams/)
  {
    const Parent = (await server.ssrLoadModule('virtual:gate-loader-fixture')).default
    const root = node('root')
    const app = createApp(Parent, { label: 'gate-loader-ok' })
    app.config.errorHandler = (e) => fail(`L: mount error: ${e?.message || e}`)
    app.mount(root); await rc.nextTick()
    let child = null
    walk(root, (n) => { if (!child && hasClass(n, 'gate-child')) child = n })
    if (!child || textOf(child).trim() !== 'gate-loader-ok') fail(`L: the child .vue did not render through the loader (found ${child ? JSON.stringify(textOf(child)) : 'no .gate-child'})`)
    app.unmount()
  }
} catch (e) {
  fail(`threw: ${e?.stack || e}`)
} finally {
  await server.close()
}

if (!buttonsSeen) fail('vacuous: no header sticker rendered in either arm')
if (failures.length) {
  console.error(`POSTER-WALL-HOST-SEAMS: FAIL (${failures.length})\n  - ${failures.join('\n  - ')}`)
  process.exitCode = 1
} else {
  console.log(`POSTER-WALL-HOST-SEAMS: PASS (12 arms, ${buttonsSeen} stickers rendered; defaults unchanged: the Show-on-map toggle and the stored webp; headerAction emits, previewSrc is lazy, one at a time, cached and bounded)`)
}
