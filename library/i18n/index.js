/**
 * i18n/index.js — Vue I18n setup for doxa-map-mfe
 *
 * One i18n instance per <doxa-map> element (via entry.js configureApp).
 * All 11 locale catalogs are inlined in the IIFE bundle (Vite can't code-split
 * IIFE output anyway; strings-only catalog size is small).
 *
 * LAZY-LOAD EXPERIMENT (2026-04-26): converted to `import.meta.glob({ eager:false })`
 * with `setLocale()` helper + eager `en` fallback. Result: bundle GREW by ~22 KB
 * raw / ~5 KB gz because Vite's `inlineDynamicImports: true` (required for IIFE)
 * inlines every dynamic chunk back into the IIFE AND adds per-import wrapper
 * closures + a runtime resolver. Reverted to eager glob.
 *
 * If we ever want a real win here, the path is:
 *   - Ship `en` only in the IIFE.
 *   - Host other locales as standalone JSON at a known URL (e.g. /widgets/research-map/locales/<lc>.json).
 *   - Fetch + setLocaleMessage() on demand (no Vite dynamic-import involved).
 * That requires Nuxt-side public asset placement and a CORS-safe fetch path,
 * so it's a deploy-pipeline change, not a build-config tweak.
 *
 * Locales are organized as folder-per-locale with one JSON file per top-level
 * area. All 11 locales ship 10 of the 11 areas (aria, buttons, detail, legend,
 * messages, options, popup, prayerLaps, search, tabs). ONE area is still partial:
 * regions.json exists for ar/de/en/es/fr/hi/pt/ru, so it/ro/zh fall back to
 * English for regions.* — 54 keys of full sentences each, the last i18n debt in
 * the app. A missing area file is fine: those namespaces resolve through
 * fallbackLocale: 'en'.
 *
 * ⚠ THAT FALLBACK IS WHY THIS COMMENT GOES STALE SILENTLY, so trust the gates over
 * these sentences: check:i18n-parity counts the missing keys per locale against a
 * ratchet, and check:tabs-localized renders tabs.* and asserts the text actually
 * CHANGES with the locale. Key-parity alone cannot tell a shipped translation from
 * a dead one — tabs.json was fully translated in 7 locales while its only consumer
 * reached it through a dynamic key no grep could see.
 * A Vite eager glob loads all area files at build time and composes them into
 * the per-locale message object.
 *
 * Locale detection priority:
 *   1. ?lang= / ?locale= on the URL   (a reader or a link can choose)
 *   2. document.documentElement.lang  (set by Polylang on WordPress)
 *   3. 'en' fallback
 *
 * Missing-key behavior: falls back to English. Missing-locale: whole map renders in English.
 *
 * See documentation/feedback.md → Section A for the design rationale.
 */

import { watch, effectScope } from 'vue'
import { createI18n } from 'vue-i18n'

// Eager glob — the locale subfolders the build leaves in. vite.config's i18nAreasPlugin narrows
// this to the areas one bundle uses, and (when SHIP_ONE_LOCALE is on) to `en` alone; the other ten
// are emitted as assets beside the bundle and fetched by loadLocale() below.
const rawModules = import.meta.glob('./locales/*/*.json', { eager: true, import: 'default' })
// rawModules keys look like './locales/ar/legend.json', './locales/ar/detail.json'
const messages = {}
for (const [path, subtree] of Object.entries(rawModules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (!match) continue
  const [, locale, area] = match
  messages[locale] ??= {}
  messages[locale][area] = subtree
}

// ★ THE BASE URL IS CAPTURED AS THIS SCRIPT EVALUATES, AND IT HAS TO BE. Rollup shims
// import.meta.url to document.currentScript in IIFE output, and currentScript is null the moment
// the script finishes running — so a base read at mount, or on a later locale switch, resolves
// against document.baseURI instead: right on our own pages, wrong on every host that serves the
// bundle from a different path. deriveTreeBase() already exists for exactly this and already
// carries the warning; this is the one call, at the top, on purpose.
// deriveTreeBase() is the same capture at the same moment, but it returns the TREE root — it strips
// "<bundle>/<bundle>.js" — and these assets live in the bundle's OWN directory one level deeper, so
// each bundle carries only the areas it uses. One less path segment removed, same rule.
const LOCALE_BASE = (() => {
  try {
    const cur = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || ''
    if (!cur) return ''
    return cur.split(/[?#]/)[0].replace(/[^/]+$/, '')   // …/<bundle>/  (trailing slash kept)
  } catch { return '' }
})()

// Filled by the build (i18nAreasPlugin) with { ar: 'sha384-…', … } for the locales it emitted as
// assets. Embeds are SRI-pinned, and a fetched catalogue would not be unless its hash travels with
// the bundle — so a swapped file fails closed to English rather than injecting text into the page.
// Empty when every locale is inlined, which is also why loadLocale() is a no-op in that build.
const LOCALE_SRI = (typeof __DX_LOCALE_SRI__ !== 'undefined' ? __DX_LOCALE_SRI__ : {})

const _loaded = new Map()   // code -> Promise, so concurrent instances share one request

// ★ THE REQUEST STARTS NOW, NOT AT MOUNT. Kicked off as the script evaluates so it overlaps the
// bundle's own startup instead of queueing behind it — the catalogue is ~13 KB gzipped and the
// bundle is an order of magnitude more, so in practice it lands first. Nothing awaits this here;
// createAppI18n() picks up the same promise from _loaded.
let PRELOAD = null
// How long an RTL locale may hold its text chrome. For ar the flash is a LAYOUT change — English
// LTR, then a flip to RTL — which is visibly worse than the plain re-render the other locales get,
// so the chrome waits. The map never waits, and the timeout means a failed fetch degrades to
// English rather than to a blank panel.
const RTL_HOLD_MS = 1500

/**
 * Fetch a locale that was emitted beside the bundle rather than inlined, and install it.
 *
 * Resolves to true when the locale is usable (already present, or fetched and installed) and false
 * when it is not — the caller then simply stays on the English fallback, which is what a reader
 * gets today for a locale with no catalogue. Never throws: a failed catalogue must not take the map
 * down with it.
 *
 * ⚠ CALLED AFTER THE INSTANCE EXISTS, NEVER DURING createI18n. setLocaleMessage() touches no effect
 * scope, so this stays clear of the stopped-scope failure that createGlobal() has (see below).
 */
export function loadLocale(i18n, code) {
  const c = String(code || '').split('-')[0].toLowerCase()
  if (!c || c === 'en' || !SUPPORTED_LOCALES.includes(c)) return Promise.resolve(c === 'en')
  // Already here — inlined by this build, or fetched for an earlier instance. Still install it into
  // THIS instance: vue-i18n copied `messages` when it was constructed, so a catalogue that arrived
  // afterwards is in the shared map and not in this one.
  if (messages[c]) { i18n?.global?.setLocaleMessage?.(c, messages[c]); return Promise.resolve(true) }
  // One request per locale, however many instances ask — but each caller still installs the result.
  if (_loaded.has(c)) {
    return _loaded.get(c).then((okEarlier) => {
      if (okEarlier && messages[c]) i18n?.global?.setLocaleMessage?.(c, messages[c])
      return okEarlier
    })
  }
  // ★ NO PIN, NO FETCH (studio). The hash map is written by the build ONLY for locales it actually
  // emitted, so its presence is the one reliable statement that a file is there to fetch. Without
  // this guard the flag-OFF build still reaches the network: a bundle with no areas inlines nothing,
  // so messages[c] is empty and the preload requests locales/<lc>.json on every non-English page —
  // a 404 per reader, and fetched with no integrity because there was no hash to pass. Keying on the
  // pin makes the flag-off build inert and the flag-on build fail closed to English.
  if (!LOCALE_SRI[c]) return Promise.resolve(!!messages[c])
  const run = (async () => {
    try {
      if (!LOCALE_BASE) return false                     // base unknown: stay on English
      const url = new URL(`locales/${c}.json`, LOCALE_BASE).href
      const res = await fetch(url, { integrity: LOCALE_SRI[c] })
      if (!res.ok) return false
      const tree = await res.json()
      if (!tree || typeof tree !== 'object') return false
      messages[c] = tree
      i18n?.global?.setLocaleMessage?.(c, tree)
      return true
    } catch { return false }
  })()
  _loaded.set(c, run)
  return run
}

/**
 * The English catalogue, exported from the ONE module that already owns it.
 *
 * Four gospel profiles used to `import enGospel from '@map/i18n/locales/en/gospel.json'` to
 * get a real English fallback for a host that never installed i18n. That file is ALSO pulled
 * in by the eager glob above, so the bundle ended up with two instances of the same module
 * and the IIFE threw "Identifier 'Ge' has already been declared" on evaluation — a hard
 * error that killed every gospel leaf while the SRI hash still matched and the page still
 * returned 200. Importing it from here instead means there is exactly one.
 */
export const EN_MESSAGES = messages.en || {}

export const SUPPORTED_LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'pt', 'ro', 'ru', 'zh']

export const RTL_LOCALES = new Set(['ar'])

/**
 * The locale a ?lang= / ?locale= link is asking for, or '' if the URL names none.
 *
 * ★ EXPORTED BECAUSE A SECOND CONSUMER NEEDS THE SAME FACT. detectLocale() uses this for the UI
 * chrome, and regions-dashboard needs it for the API call that fetches region and country NAMES:
 * the prayer API localises its labels from its own lang parameter, so if the chrome reads the URL
 * and the data call does not, a shared ?lang=ar link renders Arabic chrome around English region
 * names. MEASURED before this: region-dashboards rendered 597 Arabic chrome characters through
 * profile-config and only 309 through ?lang=ar, the gap being the seven region names in the
 * chooser legend and the seven in the table.
 *
 * Both spellings are accepted because both are in use in this codebase (`lang` in profile configs,
 * `locale` in the i18n layer) and guessing wrong is a silent no-op. Kept here, as one copy, rather
 * than re-read in the plugin: two copies of one fact drift, which is how the asset-path bug and
 * the PosterWall fallback table both went wrong.
 */
export function localeFromUrl() {
  try {
    const q = new URLSearchParams(window.location.search)
    return (q.get('lang') || q.get('locale') || '').split('-')[0].toLowerCase()
  } catch { return '' }              // no window (SSR/tests)
}

export function detectLocale() {
  // ★ URL FIRST — otherwise the translations are UNREACHABLE in a dropped tree.
  // The host page is the intended source (Polylang sets <html lang> on WordPress),
  // but EVERY generated leaf page in this repo is hardcoded lang="en": measured
  // 2026-09-24, 20 of 20. So on the built/static tree — the jamstack case, which is
  // the whole point of these bundles — a reader had no way to reach any of the ten
  // non-English locales, and the prayer packet, the card deck and every label
  // rendered in English no matter how complete the translation was.
  //
  // A query parameter is the smallest thing that makes them reachable: it needs no
  // per-language page, it is linkable and shareable, and it leaves the host-page
  // path intact for WordPress. Both spellings are accepted because both are in use
  // across this codebase (`lang` in profile configs, `locale` in the i18n layer),
  // and guessing wrong is a silent no-op.
  const fromUrl = localeFromUrl()
  if (SUPPORTED_LOCALES.includes(fromUrl)) return fromUrl

  const raw = document?.documentElement?.lang || ''
  const code = raw.split('-')[0].toLowerCase()
  return SUPPORTED_LOCALES.includes(code) ? code : 'en'
}

// Start the fetch as this module evaluates. Deliberately not awaited and deliberately not inside
// createAppI18n: the request overlaps the rest of the bundle's startup, and every instance that
// mounts later joins the same promise instead of issuing its own.
try { PRELOAD = loadLocale(null, detectLocale()) } catch { PRELOAD = null }

/**
 * Resolves when the active locale's text is ready to paint, or when the hold expires.
 *
 * Only an RTL locale actually waits. For the others a late catalogue is a re-render — vue-i18n is
 * reactive, so the words simply change — but for ar it is a LAYOUT flip, and painting English LTR
 * and then mirroring is the one outcome worth a short hold. Always resolves; never rejects.
 *
 * @returns {Promise<boolean>} true when the catalogue landed in time
 */
export function localeChromeReady(code = detectLocale()) {
  const c = String(code || '').split('-')[0].toLowerCase()
  if (!RTL_LOCALES.has(c) || messages[c]) return Promise.resolve(true)
  const pending = _loaded.get(c) || PRELOAD || Promise.resolve(false)
  return Promise.race([
    pending.then((ok) => !!ok).catch(() => false),
    new Promise((r) => setTimeout(() => r(false), RTL_HOLD_MS)),
  ])
}

/**
 * Build a fresh i18n instance. Called once per <doxa-map> element.
 */
export function createAppI18n() {
  const locale = detectLocale()
  // ⚠ REFLECT AN RTL LOCALE ON THE DOCUMENT. Only one component reads RTL_LOCALES
  // today (regions' UupgsList), so choosing Arabic would otherwise give Arabic TEXT
  // inside a left-to-right layout everywhere else — readable glyphs in the wrong
  // place, which reads as a styling quirk rather than the bug it is. The prayer
  // packet sets its own dir internally; the app chrome had nothing.
  //
  // Only ever SET it, never clear it: a host page that already declares dir (a
  // WordPress RTL theme) owns that decision, and stomping it to "ltr" for an
  // English map embedded in an Arabic page would break the page around us.
  // ★ ONLY WHERE WE OWN THE PAGE. This used to run whenever the locale resolved to an RTL
  // language, which meant an EMBEDDED plugin on a partner's page flipped the PARTNER'S whole
  // <html> — their headings, their nav, their footer — because a reader followed a ?lang=ar link.
  // The comment below already worried about the host owning that decision, but it only guarded
  // against CLEARING dir, never against setting it.
  //
  // A GENERATED LEAF owns its document and says so with window.MAP_OWNS_PAGE. Nothing else sets
  // it, so the DEFAULT IS "not ours" — a partner page that declares nothing is never touched,
  // which is the safe direction for a flag whose absence must mean restraint.
  //
  // The element's OWN direction is not this code's business and never was: ProfileLoader binds
  // dir on .profile-loader from effectiveLocale (0f6d5049), so the plugin mirrors correctly
  // whether or not it owns the document. This is only about the page around it.
  //
  // LANG TRAVELS WITH DIR (measured on a research page with ?lang=ar): an owned page flipped to dir=rtl but
  // kept the generator's <html lang="en">, so a screen reader read the Arabic with an English voice (and
  // ?lang=fr left lang="en" too). The page is ours, so its lang is the locale in force.
  try {
    const ownsPage = typeof window !== 'undefined' && window.MAP_OWNS_PAGE === true
    if (ownsPage && locale && document?.documentElement) {
      document.documentElement.lang = locale
      if (RTL_LOCALES.has(locale)) document.documentElement.dir = 'rtl'
    }
  } catch { /* no document (SSR/tests) — nothing to reflect */ }
  // ★ A DETACHED EFFECT SCOPE (P0, seen in a live console, 2026-09-27). vue-i18n's createGlobal() runs
  // inside scope.run() and throws UNEXPECTED_ERROR ("SyntaxError: Unexpected error") when that returns
  // undefined; Vue 3.5 creates a new EffectScope INACTIVE when the currently active scope is STOPPED.
  // A custom element's connectedCallback -> configureApp -> here can run while a released tab's stopped
  // scope is still current (Plugin Studio's gallery, every tab after the first). effectScope(true) never
  // inherits the ambient scope, so this instance and its locale watcher are always created live.
  const i18nScope = effectScope(true)
  const i18n = i18nScope.run(() => createI18n({
    legacy: false,
    globalInjection: true,
    locale,
    fallbackLocale: 'en',
    messages,
    missingWarn: false,
    fallbackWarn: false,
    pluralRules: CLDR_PLURAL_RULES,
  }))

  // ★ THE CATALOGUE MAY ARRIVE AFTER THIS INSTANCE DOES. vue-i18n copies `messages` at
  // construction, so a fetch that lands later has to be installed per instance — the preload above
  // fills the shared `messages` map, which is enough for instances created afterwards and not for
  // the ones already built. Outside createI18n() on purpose: setLocaleMessage touches no effect
  // scope, while createGlobal() is the call that throws inside a stopped one.
  if (locale !== 'en' && !messages[locale]) {
    loadLocale(i18n, locale).catch(() => { /* stays on the English fallback */ })
  }

  // ★ INSTALLING i18n ALSO PROVIDES IT, so a bundle CANNOT forget. This is the durable half of a
  // bug that is invisible by construction.
  //
  // THE DEFECT: ProfileLoader applies a host's `profile-config.locale` by driving the app's i18n
  // directly — but it reaches it with `inject('appI18n', null)` (ProfileLoader.vue:168-169):
  //     const appI18n = inject('appI18n', null)
  //     watchEffect(() => { if (lang.value && appI18n) appI18n.global.locale.value = lang.value })
  // The inject DEFAULT IS NULL. So a bundle whose entry does `app.use(createAppI18n())` without a
  // matching `app.provide('appI18n', i18n)` turns that watchEffect into a SILENT no-op: no error,
  // no warning, no translation. MEASURED by regions on my-upg-100-list — profile-config.locale
  // 'ar' produced ZERO Arabic strings, while the same harness switched regions-dashboard (which
  // does provide it) perfectly. A host embedding the element simply cannot set its language.
  //
  // ⚠ WHY HERE AND NOT IN SIX index.js FILES. The fix is one line per bundle, which is exactly
  // why it decays: it is one fact stored in six places, and the seventh bundle written next month
  // re-introduces it with nothing to catch it. An i18n instance IS a Vue plugin, so wrapping its
  // own install() makes the provide a consequence of installing rather than a step beside it.
  // Bundles that already call app.provide('appI18n', i18n) with this same instance are
  // unaffected — providing the identical value twice is a no-op.
  // ★ AND PUBLISH THE LOCALE WHERE THE PLUGIN-FREE READER CAN SEE IT. Same shape of argument as
  // the provide above, one layer down: tStatic (below) resolves the locale from the URL and the
  // document, which are the only two things a STATIC page can say — so a locale set at RUNTIME, by
  // a host's profile-config or by a language picker, moved every t() string and left every tStatic
  // string in English. MEASURED on research-map-plus-grid: the map's six tabs came back Arabic
  // while the grid's four dropdown labels stayed English, on the same screen. Half a translation
  // reads as "some strings were never translated", and sends the search to the catalogues, where
  // every one of those strings is already present and correct.
  //
  // Watching the instance's own locale ref is the single choke point: ProfileLoader, the SPA's
  // picker and the studio's picker all move THIS ref, so none of them has to remember to also tell
  // the static reader.
  i18nScope.run(() => watch(i18n.global.locale, (l) => setRuntimeLocale(l), { immediate: true }))

  const install = i18n.install.bind(i18n)
  i18n.install = (app, ...rest) => {
    const out = install(app, ...rest)
    app.provide('appI18n', i18n)
    // Several bundle entries still call app.provide('appI18n', i18n) themselves after app.use(i18n). The
    // value is the same instance, but Vue warns "App already provides property with key appI18n" on every
    // mount. A second provide of THIS instance under that key is made a no-op; anything else passes through.
    const provide = app.provide.bind(app)
    app.provide = (key, value) => (key === 'appI18n' && value === i18n ? app : provide(key, value))
    return out
  }
  return i18n
}

export default createAppI18n

/**
 * Read a catalogue string WITHOUT the vue-i18n plugin.
 *
 * WHY THIS EXISTS. Some components are mounted as their OWN custom element by a bundle entry that
 * calls defineCustomElement(Component) and installs nothing — people-groups-grid is one. useI18n()
 * inside such a component THROWS, and a thrown setup() removes the subtree silently (this repo has
 * already paid for that once: three buttons vanished behind ignorable console noise). So a shared
 * component that must work in BOTH mounts needs a plugin-free reader, which is all this is.
 *
 * Falls back locale -> en -> undefined, so a caller can keep its own literal as the last resort and
 * a missing translation degrades to English rather than to a key.
 *
 * @param {string} path  dotted, e.g. 'grid.hide_filters'
 * @param {string} [locale]  defaults to the detected one (?lang= / host / browser)
 */
// ★ THE LOCALE THIS PAGE IS BEING READ IN, KEPT ON THE WINDOW AND NOT IN THIS MODULE.
// MEASURED, and the measurement is the whole reason for the odd-looking global: a composite loads
// SEVERAL bundles — research-map-plus-grid loads its own, doxa-research-map's and
// people-groups-grid's — and each bundle carries its own copy of this module. A module-level
// variable set inside the map's copy is invisible to the grid's copy, so the first version of this
// fix translated the map and left the grid in English, which is exactly the defect it was meant to
// remove. Module state is per-BUNDLE; a locale is per-PAGE. The shared map token crosses bundles
// the same way for the same reason (library/composables/useSharedMapToken.js).
//
// Guarded because there is no window in SSR or a unit test, and because a page can be served where
// touching a global throws; a locale that cannot be published simply leaves detectLocale in charge.
const PAGE_LOCALE_KEY = '__DOXA_PAGE_LOCALE'
export function setRuntimeLocale(code) {
  const c = String(code || '').split('-')[0].toLowerCase()
  if (!SUPPORTED_LOCALES.includes(c)) return
  try { if (typeof window !== 'undefined') window[PAGE_LOCALE_KEY] = c } catch { /* no window */ }
}
/**
 * CLDR plural selection — the map vue-i18n does not ship.
 *
 * ★ WHY THIS IS NEEDED AT ALL. vue-i18n v9's default pluralization is INDEX-BASED, not CLDR: it
 * picks form 0/1/2 by an English-shaped rule and applies it to EVERY locale. Measured on a real
 * instance, authoring 'a | b | c':
 *   ru  n=0 -> the ONE form, n=2 -> the MANY form   (CLDR: 0=many, 2=few — both wrong)
 *   ar  n=3, 11 and 100 -> all the DUAL form        (CLDR: few, many, other)
 * That is confidently wrong grammar that LOOKS translated, which is worse than a single fixed
 * form. upg100 hit exactly this (upg-100-list.vue:3006) and a plural key was correctly refused
 * then, because this map did not exist. It exists now, so the refusal's premise is gone.
 *
 * ★ SCOPED TO EXCLUDE en, DELIBERATELY. en is the only locale with pipe strings today
 * (wall.prayedCount, wall.havePrayed), and vue-i18n's 3-form default there is zero|one|many while
 * CLDR for en is one|other — so putting en under CLDR would change what n=0 renders. Leaving en
 * out means every string that exists today renders byte-identically: 132 renders compared across
 * 2 keys x 11 locales x {0,1,2,3,11,100}, 0 changed.
 *
 * ★ AUTHORING ORDER IS CLDR ORDER: zero | one | two | few | many | other. A locale supplies the
 * forms its own category set needs (ru 4, ar 6, zh 1) — check:plural-forms fails a string that
 * supplies fewer, because a short list makes the pick clamp silently onto the wrong form.
 */
const CLDR_CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other']

export function cldrChoiceIndex(choice, choicesLength, locale) {
  let rules
  try { rules = new Intl.PluralRules(locale) } catch (_) { return choice === 1 ? 0 : 1 }
  const category = rules.select(choice)

  // THE INDEX IS INTO THIS LOCALE'S OWN CATEGORIES, NOT INTO THE FULL SIX.
  // The first version indexed into the fixed zero|one|two|few|many|other list, which is correct
  // only for a locale that HAS all six. ru has {one, few, many, other} and no zero/two, so 'few'
  // sat at global index 3 while the authored ru string holds it at 1 -- n=2 and n=3 rendered the
  // MANY form ("2 stran" instead of "2 strany"). Arabic hid it completely, being the one locale
  // that does have all six, so the two indexes coincide there. Caught by reading the rendered
  // Russian, not by the gate, which was counting forms rather than checking agreement.
  const have = rules.resolvedOptions().pluralCategories
  const cats = CLDR_CATEGORY_ORDER.filter((c) => have.includes(c))
  let i = cats.indexOf(category)
  if (i < 0) i = cats.indexOf('other')
  // A catalogue with fewer forms than its locale has categories degrades to 'other', then to the
  // last form it does have. check:plural-forms makes this unreachable; it is here so a bad
  // catalogue renders a real sentence rather than undefined.
  if (i >= choicesLength) {
    const other = cats.indexOf('other')
    i = other >= 0 && other < choicesLength ? other : choicesLength - 1
  }
  return Math.max(0, Math.min(i, choicesLength - 1))
}

// en is absent on purpose — see above. Every other shipped locale gets CLDR selection.
const CLDR_PLURAL_RULES = Object.fromEntries(
  ['ar', 'de', 'es', 'fr', 'hi', 'it', 'pt', 'ro', 'ru', 'zh']
    .map((loc) => [loc, (choice, choicesLength) => cldrChoiceIndex(choice, choicesLength, loc)]),
)

export function getRuntimeLocale() {
  try { return (typeof window !== 'undefined' && window[PAGE_LOCALE_KEY]) || '' } catch { return '' }
}

export function tStatic(path, locale) {
  const tryTree = (loc) => {
    let node = messages[loc]
    for (const part of String(path).split('.')) {
      if (!node || typeof node !== 'object') return undefined
      node = node[part]
    }
    return typeof node === 'string' ? node : undefined
  }
  // Explicit argument first, then the locale a host set at runtime, then what the page itself says.
  const want = locale || getRuntimeLocale() || detectLocale()
  return tryTree(want) ?? tryTree('en')
}

/**
 * A list of items in the reader's language: formatList(['A', 'B', 'C']) is "A, B, and C" in English,
 * "A وB وC" in Arabic, "A、B和C" in Chinese, "A, B und C" in German. `join(', ')` is wrong in every
 * locale but English, and no catalogue key can fix it: the separator and the final conjunction ARE the
 * grammar, and a key-built sentence like pins.sharedPoint still carried English commas inside Arabic prose
 * (measured by gospel, 2026-09-29; 31 such joins across library and plugins). Intl.ListFormat knows every
 * locale's list grammar, so this is only the locale resolution tStatic already uses: the explicit
 * argument, then the host's runtime locale, then the page's own.
 *
 *   type   'conjunction' (and, the default) · 'disjunction' (or) · 'unit' (no conjunction)
 *   style  'long' (default) · 'short' · 'narrow'
 * Items are stringified. Where a browser has no Intl.ListFormat it falls back to ', ', today's behaviour.
 * PICK THE TYPE FROM WHAT THE LIST MEANS. Several values on one filter facet are alternatives, so 'disjunction'
 * (the chip bar: the bus matches with includes()). Things that all hold are a 'conjunction'. If a facet ever needs
 * ALL its values, the type belongs in that facet's config, not fixed at the call site. Never 'unit' for names:
 * in zh it joins them with no separator at all.
 */
const listFormats = new Map()
export function formatList(items, { type = 'conjunction', style = 'long', locale } = {}) {
  const list = Array.from(items || [], (x) => String(x))
  // The page's own locale only as the last resort, and never allowed to throw: outside a browser (a
  // server render, a Node gate) there is no document to read it from.
  const page = () => { try { return detectLocale() } catch { return '' } }
  const want = locale || getRuntimeLocale() || page() || 'en'
  const key = `${want}|${type}|${style}`
  try {
    if (!listFormats.has(key)) listFormats.set(key, new Intl.ListFormat(want, { type, style }))
    return listFormats.get(key).format(list)
  } catch {
    return list.join(', ')
  }
}
