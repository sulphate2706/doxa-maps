#!/usr/bin/env node
/**
 * check-composites-mount.mjs: every composite's setup() must run without throwing, in en and ar.
 *
 * WHY THIS EXISTS. 08f89f55 gave dashboard-plus-grid and research-map-plus-grid a text-direction
 * computed that called getRuntimeLocale(), detectLocale() and RTL_LOCALES without importing them.
 * Nothing checks free names at build time, so the build was green and the bundles on main carried
 * three undefined globals. watch(textDir, ...) evaluates the computed DURING setup, so setup threw
 * a ReferenceError in every locale and Vue rendered NOTHING for the whole composite (Big Picture
 * and Simple Research, both in the Research Gallery). Every structural gate passed. This gate runs
 * the thing that failed: the composite's own setup, and its mounted hooks.
 *
 * HOW. No browser (by design: this gate runs headless). Vite loads each composite .vue through
 * ssrLoadModule with the repo's alias and the same vue({ customElement: true }) plugin, and
 * @vue/runtime-core mounts it on a no-op renderer. The SSR compile gives the component an
 * ssrRender rather than a render, so the renderer draws nothing and no CHILD is set up: this
 * measures the composite's OWN setup and lifecycle, which is exactly the part a composite author
 * writes. Each composite is mounted twice, with profile-config {"lang":"en"} and {"lang":"ar"}
 * (ar is the RTL path, which is where the direction code lives).
 *
 * WHAT FAILS. Any error Vue reports while mounting: setup, a watcher's first run, a mounted hook.
 * An import that throws also fails, naming the file. A run that finds no composites FAILS
 * (vacuous guard). Composites are those whose *.meta.json type is nested-elements-mfe (capability
 * 4) or nested-mfe-spa (capability 5); the .vue is the meta's basename.
 *
 * NOT A SUBSTITUTE FOR A BROWSER. It proves setup runs; it cannot prove the children render.
 *
 * NEGATIVE-TESTED (2026-09-26): on main 75c4b54e (before the fix 57009b7e) it FAILS exactly
 * dashboard-plus-grid and research-map-plus-grid, in en and ar, with "ReferenceError: RTL_LOCALES is
 * not defined", and mounts the other 8 clean; on 521f8b18 all 20 mount clean. A throw poisoned into
 * big-picture's setup (a directly-defined element) and into regions-mfe's (a ProfileLoader profile)
 * each FAIL that composite in both locales. About 20 s.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES = ['en', 'ar']
const TYPES = new Set(['nested-elements-mfe', 'nested-mfe-spa'])

// ── the page a composite expects to be dropped into, at its thinnest ──────────────────────────
// Only what setup-time code touches. Anything a composite reaches for beyond this shows up as a
// failure naming the missing global, which is the signal to add it here, not to skip the file.
function installPage(lang) {
  const noop = () => {}
  const el = () => ({ style: {}, dataset: {}, setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    appendChild: (c) => c, removeChild: noop, addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [], getRootNode() { return this }, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } })
  const html = el(); html.lang = lang
  const store = new Map()
  Object.assign(globalThis, {
    window: globalThis, self: globalThis,
    document: Object.assign(el(), { documentElement: html, head: el(), body: el(), createElement: el, createTextNode: el,
      currentScript: null, readyState: 'complete', cookie: '', getElementById: () => null }),
    location: new URL(`https://gate.invalid/${TREE_NAME}/x/x/index.html?lang=${lang}`),
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    customElements: { define: noop, get: () => undefined, whenDefined: () => new Promise(noop) },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    HTMLElement: class {}, ShadowRoot: globalThis.ShadowRoot || class ShadowRoot {}, CustomEvent: globalThis.CustomEvent || class extends Event { constructor(t, o) { super(t, o); this.detail = o?.detail } },
  })
  if (!globalThis.navigator?.language) globalThis.navigator = { language: lang, languages: [lang], userAgent: 'gate' }
}

// --all-profiles (check:profiles-mount): EVERY profile .vue of every bundle, and every preset instance
// with its props, not only composites. 0a2a7b09 was a setup-time TDZ throw in a NON-composite lens
// (upg-neighbor lang-cluster, reached through an instance's `view` prop), which the composite scope
// could not see and check:no-free-identifiers cannot see either (the name IS bound, only late).
const ALL = process.argv.includes('--all-profiles')
function allProfiles() {
  const out = []
  const base = join(ROOT, 'plugin-designs')
  for (const bundle of readdirSync(base)) {
    if (bundle.startsWith('_') || bundle.startsWith('.')) continue
    const dir = join(base, bundle)
    let files = []
    try { files = readdirSync(dir) } catch { continue }
    if (!files.includes('index.js')) continue
    for (const f of files.filter((f) => f.endsWith('.vue'))) {
      const profile = f.replace(/\.vue$/, '')
      out.push({ bundle, profile, vue: join(dir, f), missing: false })
      let inst = null
      for (const cand of [`${profile}.instances.json`, ...files.filter((x) => x.endsWith('.instances.json'))]) {
        try { const j = JSON.parse(readFileSync(join(dir, cand), 'utf8')); if (!j.profile || j.profile === profile) { inst = j; break } } catch { /* none */ }
      }
      for (const i of (inst && inst.instances) || []) out.push({ bundle, profile, vue: join(dir, f), missing: false, instance: i.id, props: i.props || {} })
    }
  }
  return out
}

function composites() {
  const out = []
  const base = join(ROOT, 'plugin-designs')
  for (const bundle of readdirSync(base)) {
    const dir = join(base, bundle)
    let files = []
    try { files = readdirSync(dir) } catch { continue }
    for (const f of files.filter((f) => f.endsWith('.meta.json'))) {
      let meta
      try { meta = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { continue }
      if (!TYPES.has(meta.type)) continue
      const vue = join(dir, f.replace(/\.meta\.json$/, '.vue'))
      out.push({ bundle, profile: f.replace(/\.meta\.json$/, ''), vue, missing: !existsSync(vue) })
    }
  }
  return out
}

const list = ALL ? allProfiles() : composites()
if (!list.length) { console.error('COMPOSITES-MOUNT: FAIL, found no composites (vacuous run)'); process.exit(1) }

// ── mount each composite the way its bundle entry does ─────────────────────────────────────────
// A composite's setup depends on what its entry's configureApp installs (pinia, the i18n instance,
// provides) and, for a ProfileLoader bundle, on what ProfileLoader provides. Mounting the bare .vue
// would fail a correct composite for a missing app.use and pass nothing real, so the gate RUNS the
// entry: every defineCustomElement(...) in plugin-designs/<bundle>/index.js is swapped for a
// recorder, and the recorded component + configureApp are what gets mounted.
// ★ AND THE SHARED HELPER. Since every entry builds its element through
// library/elements/defineMapElement.js, the defineCustomElement call lives THERE, not in index.js.
// Capturing only index.js recorded nothing, and every composite read as 'defines neither'.
const ENTRY_RE = /(plugin-designs\/[^/]+\/index\.js|library\/elements\/defineMapElement\.js)$/
const entryCapture = {
  name: 'gate-entry-capture',
  enforce: 'post',
  resolveId: (id) => (id === 'virtual:gate-define' ? '\0gate-define' : null),
  load: (id) => (id === '\0gate-define'
    ? 'export function __gateDefine(comp, opts) { (globalThis.__gateDefs ||= []).push({ comp, opts: opts || {} }); return class {} }'
    : null),
  transform(code, id) {
    if (!ENTRY_RE.test(id)) return null
    return 'import { __gateDefine } from "virtual:gate-define";\n' + code.replace(/\bdefineCustomElement\s*\(/g, '__gateDefine(')
  },
}

const { createServer } = await import('vite')
const { default: vuePlugin } = await import('@vitejs/plugin-vue')
const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [vuePlugin({ customElement: true }), entryCapture],
  resolve: { alias: { '@map': join(ROOT, 'library') } },
  define: { __DOXA_TREE_NAME__: JSON.stringify(TREE_NAME) },
})

// A node the no-op renderer hands out. $el.getRootNode().host is how composites find their own
// custom-element host (for dir, and for DOM events), so the root node answers with a shadow root.
function makeNode() {
  const noop = () => {}
  const node = { style: {}, dataset: {}, setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    querySelector: () => null, querySelectorAll: () => [], appendChild: (c) => c }
  const host = { ...node }
  const shadow = Object.assign(Object.create(globalThis.ShadowRoot.prototype), node, { host })
  node.getRootNode = () => shadow
  return node
}

const failures = []
let mounted = 0
try {
  const rc = await import('@vue/runtime-core')
  const noop = () => {}
  const { createApp } = rc.createRenderer({
    insert: noop, remove: noop, createElement: makeNode, createText: makeNode, createComment: makeNode,
    setText: noop, setElementText: noop, parentNode: () => null, nextSibling: () => null, patchProp: noop,
  })

  for (const lang of LOCALES) {
    installPage(lang)
    // Re-evaluate every module per locale: module-level state (the runtime locale, the stores) must
    // start from the page this locale describes, and a cached entry would not run its defines again.
    server.moduleGraph.invalidateAll()
    const stores = await Promise.all(['uiStore', 'mapStore', 'dataStore'].map((n) => server.ssrLoadModule(`/library/stores/${n}.js`)))
    const [useUIStore, useMapStore, useDataStore] = [stores[0].useUIStore, stores[1].useMapStore, stores[2].useDataStore]
    const entryDefs = {}
    for (const c of list) {
      const tag = `${c.bundle}/${c.profile}${c.instance ? '/' + c.instance : ''} [${lang}]`
      if (c.missing) { failures.push(`${tag}: no ${c.profile}.vue beside its meta.json`); continue }
      let comp, defs
      try {
        comp = (await server.ssrLoadModule(c.vue)).default
        // The entry runs ONCE per locale (the module is cached after), so its recorded defines are kept
        // per bundle: a second profile of the same bundle reads the same record.
        entryDefs[c.bundle] ||= await (async () => {
          globalThis.__gateDefs = []
          await server.ssrLoadModule(`/plugin-designs/${c.bundle}/index.js`)
          return globalThis.__gateDefs
        })()
        defs = entryDefs[c.bundle]
      } catch (e) { failures.push(`${tag}: import threw: ${e?.message || e}`); continue }

      const own = defs.find((d) => d.comp === comp)
      const viaLoader = defs.find((d) => String(d.comp?.__file || '').endsWith('/ProfileLoader.vue'))
      const def = own || viaLoader
      if (!def) { failures.push(`${tag}: its bundle entry defines neither this component nor ProfileLoader`); continue }

      const cfg = { ...(c.props || {}), profile: c.profile, lang, locale: lang }
      let root = comp
      if (!own) {
        // Under ProfileLoader the profile is a child: give it what ProfileLoader provides.
        root = { setup() {
          rc.provide('mapboxToken', rc.ref(''))
          rc.provide('dataSource', rc.ref(''))
          rc.provide('colorSet', rc.ref(null))
          rc.provide('profileConfig', rc.computed(() => cfg))
          rc.provide('instanceId', 'gate')
          rc.provide('lang', rc.ref(lang))
          rc.provide('uiStore', useUIStore())
          rc.provide('mapStore', useMapStore())
          rc.provide('dataStore', useDataStore())
          return () => rc.h(comp)
        } }
      }
      const errors = []
      const app = createApp(root, own ? { profileConfig: JSON.stringify(cfg) } : null)
      app.config.errorHandler = (e, _i, info) => errors.push(`${info}: ${e?.name || 'Error'}: ${e?.message || e}`)
      app.config.warnHandler = noop
      // plugin-vue's SSR transform records each module in useSSRContext().modules during setup
      app.provide(rc.ssrContextKey, { modules: new Set() })
      try { def.opts.configureApp?.(app) } catch (e) { errors.push(`configureApp: ${e?.message || e}`) }
      try { app.mount(makeNode()) } catch (e) { errors.push(`mount: ${e?.message || e}`) }
      await new Promise((r) => setTimeout(r, 0))
      try { app.unmount() } catch (_) { /* unmount is not what is measured */ }
      if (errors.length) failures.push(`${tag}: ${errors.join(' | ')}`)
      else mounted++
    }
  }
} finally {
  await server.close()
}

console.log(`${ALL ? 'PROFILES-MOUNT' : 'COMPOSITES-MOUNT'}: ${list.length} ${ALL ? 'profile/instance(s)' : 'composite(s)'} x ${LOCALES.length} locale(s): ${mounted} mounted clean`)
for (const f of failures) console.log(`  FAIL ${f}`)
const NAME = ALL ? 'PROFILES-MOUNT' : 'COMPOSITES-MOUNT'
console.log(failures.length ? `${NAME}: FAIL (${failures.length})` : `${NAME}: PASS`)
process.exit(failures.length ? 1 : 0)
