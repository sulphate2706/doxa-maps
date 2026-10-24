/**
 * ★ NO `<area>.<key>`-SHAPED EXAMPLES IN THIS FILE'S COMMENTS. check:i18n-keys-exist reads any such
 * literal as a real catalogue key and reports it missing; studio had to reword mine twice because a
 * file copy restored them. Describe keys in words here, never in the shape of one.
 *
 * useOptionalT(namespace) — one guarded translator, for the twenty places that each stored the same
 * fact: HOW TO TRANSLATE WHEN THE HOST NEVER INSTALLED vue-i18n.
 *
 * `useI18n()` THROWS ("Need to install with `app.use` function") on a host without the plugin, and
 * seven bundles here install none — big-picture, doxa-maps-spa, doxa-vision-card, golden-path-check,
 * people-groups-grid, plugin-studio, stack-demo. An unguarded call in shared code is a blank subtree
 * waiting for the first bare host: that is exactly how library FilterDropdown blanked
 * people-groups-grid, a production plugin.
 *
 * ★ WHY THIS DOES NOT TAKE A FALLBACK CATALOGUE, though the curation spec specified
 * `(namespace, fallbackCatalogue)`. Every existing copy imports its own English JSON
 * (its own per-area English JSON) and hand-walks it after stripping the
 * namespace prefix. That is REDUNDANT: `messages` in library/i18n/index.js is keyed
 * `messages[locale][area]` where `area` is the JSON's own filename, so tStatic given a fully-qualified key already
 * walks the same tree AND already falls back to English (`tryTree(want) ?? tryTree('en')`). The
 * second import was a second copy of the same bytes.
 *
 * ★ AND IT IS NOT A BUNDLE-SIZE REGRESSION, which was the reason to suspect the narrow import existed.
 * The build NARROWS library/i18n's catalogue glob per bundle to the areas `internal/i18n-areas.mjs`
 * finds in that bundle's source graph (see check:i18n-treeshake). A bundle that references the pplr area gets the
 * pplr area and not the other thirty. Verified before writing this, because "the obvious dedup makes
 * every bundle carry every locale" would have been a real objection if the glob were still wide.
 *
 * Order of resolution, and each step earns its place:
 *   1. the host's own vue-i18n, when it installed one — so a host that manages locale keeps control;
 *   2. `tStatic`, which honours the runtime/page locale and falls back to English;
 *   3. the key itself, so a missing string is visible as a key rather than as a blank.
 * Step 2 also covers the case i18n IS installed but has no entry: `i18n.t(key)` returns the key
 * unchanged, which every copy of this pattern already treated as "not found".
 *
 * @param {string} namespace  the catalogue area name (a bare area, no dotted key) — used only to prefix bare keys
 * @returns {(key: string, params?: object) => string}
 */
import { useI18n } from 'vue-i18n'
import { tStatic, getRuntimeLocale, cldrChoiceIndex } from '@map/i18n/index.js'

/** `{n}` interpolation. Exported so a gate can test it without a Vue setup scope. */
export function fillParams(str, params) {
  if (!params) return String(str)
  // ★ `!= null`, NOT `k in params`. Gospel's interpolate() had it right and my first version did not:
  // with { count: null } a key-presence test renders the STRING "null" into the sentence, while this
  // leaves `{count}` visible. A visible placeholder is a bug you can see and fix; "null" reads as
  // content. Found by comparing against charts.vue before migrating it, not after.
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m))
}

/**
 * Pick the form of a pipe-separated plural string for a count, the way an installed vue-i18n would:
 * English by vue-i18n's OWN default rule (English sits outside the CLDR map), every other locale by the
 * SAME CLDR selection library/i18n/index.js installs (cldrChoiceIndex: ru 4 forms, ar 6, zh 1). So a
 * host without i18n picks the same form a host with it does, in every language — regions caught that
 * the English rule alone would print the wrong Russian and Arabic forms there. No pipe: returned whole.
 */
export function pickPluralForm(str, n, locale = getRuntimeLocale()) {
  const forms = String(str).split(/\s*\|\s*/)
  if (forms.length < 2 || typeof n !== 'number') return String(str)
  const lc = String(locale || 'en').split('-')[0].toLowerCase()
  if (lc !== 'en') return forms[cldrChoiceIndex(n, forms.length, lc)]
  const c = Math.abs(n)
  const i = forms.length === 2 ? (c ? (c > 1 ? 1 : 0) : 1) : (c ? Math.min(c, 2) : 0)
  return forms[Math.min(i, forms.length - 1)]
}

/** Prefix a bare key with its area, so callers may pass a bare key or an already-qualified one. */
export function qualify(namespace, key) {
  const k = String(key)
  return namespace && !k.startsWith(`${namespace}.`) ? `${namespace}.${k}` : k
}

/**
 * ★ `fallback` EXISTS BECAUSE THE FIVE LIBRARY COMPONENTS DO NOT ALL FALL BACK TO THE CATALOGUE, and
 * swapping what they fall back to is a PRODUCT change, not a consolidation. Measured:
 *   ApproxPinNote / FilterDropdown  a literal fallback MAP
 *   SemanticTreeLegend / PosterWall  humanizeKey() — a dotted legend column key renders as its last segment, title-cased
 *   PinHint                          a one-key fallback map
 * Routing those through tStatic would change what seven bare-host bundles render (and, because tStatic
 * honours the runtime locale, would start translating strings that are English today). That may well be
 * an improvement, but it is a separate decision from "store this fact once", so each site passes the
 * fallback it already had and renders byte-identically.
 * @param {(key:string, params?:object)=>string} [opts.fallback]  used instead of tStatic when the host
 *        has no i18n, or when its catalogue lacks the key. Omit it to get the catalogue (the default).
 */
// ★ THE THIRD ARGUMENT IS A PLURAL COUNT, and it is forwarded to vue-i18n, whose pluralRules map
// (library/i18n/index.js) picks each locale's CLDR form: ru 4, ar 6, zh 1. Without it a pipe string
// renders one form for every number. Omitted, the call is exactly the two-argument call it always was.
export function useOptionalT(namespace, opts = {}) {
  const viaFallback = typeof opts.fallback === 'function'
    ? (key, params, plural) => fillParams(pickPluralForm(opts.fallback(qualify(namespace, key), params) ?? key, plural), params)
    : (key, params, plural) => fillParams(pickPluralForm(tStatic(qualify(namespace, key)) ?? key, plural), params)
  try {
    const i18n = useI18n()
    return (key, params, plural) => {
      const q = qualify(namespace, key)
      const v = typeof plural === 'number' ? i18n.t(q, params || {}, plural) : i18n.t(q, params || {})
      return v === q ? viaFallback(key, params, plural) : v
    }
  } catch (_) {
    // No i18n on this host. Not an error: seven bundles deliberately install none.
    return viaFallback
  }
}

/**
 * The same guard, for callers that need more than `t`.
 *
 * ★ `te` KEEPS ITS EXISTING CONTRACT DELIBERATELY: on a host with no i18n it answers FALSE, never
 * "true because the catalogue has it". PinHint and SemanticTreeLegend both record why — "te becomes a
 * 'no, I don't have it' so every caller falls through to its own default". Making it consult tStatic
 * would silently take those callers off their own defaults, which is the same class of mistake as
 * moving a fallback.
 *
 * @returns {{ t: Function, te: (key:string)=>boolean, locale: any }}
 */
export function useOptionalI18n(namespace, opts = {}) {
  const t = useOptionalT(namespace, opts)
  try {
    const i18n = useI18n()
    return { t, te: (key) => i18n.te(qualify(namespace, key)), locale: i18n.locale }
  } catch (_) {
    return { t, te: () => false, locale: opts.locale ?? 'en' }
  }
}

export default useOptionalT
