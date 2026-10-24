/**
 * useRegionsI18n.js — t() for the regions clone, keyed by DX-life's own English strings.
 *
 * WHY A SHIM AND NOT PLAIN t(). DX-life's components call t('Prayer Coverage') — the English
 * sentence IS the key, which is how their common.json is built. Our catalogue lands at
 * messages[locale].regions (library/i18n/index.js composes the namespace from the FILENAME), so
 * the vue-i18n path would be 'regions.Prayer Coverage'. That breaks for any key containing a dot,
 * and several do — 'Loading results...', 'Type to search...' — because '.' is vue-i18n's key
 * separator. tm() returns the whole namespace object instead, so we can index it by the literal
 * string and call their key exactly as they wrote it. The port stays 1:1 with their source, which
 * is the point.
 *
 * FALLS BACK TO THE KEY. A missing string renders the English sentence rather than 'regions.Foo'.
 * ✗ THE REASON GIVEN HERE IS NOW STALE, corrected 2026-09-27. It read: "our repo ships 11 locales and
 * DX-life translates 8, so it/ro/zh have no regions.json at all and resolve through this fallback."
 * MEASURED: all ELEVEN locales now carry a regions.json, it/ro/zh included. The fallback is still
 * right and still load-bearing — a key absent from a catalogue renders its English sentence, which is
 * exactly what a reader should see — but it is no longer three whole languages leaning on it.
 * COVERAGE, measured the same day: 61 of the 61 keys this plugin actually calls are present in all 11
 * locales. The 62nd that a raw source scan reports is t('Region') appearing only inside two COMMENTS,
 * which say themselves that DX-life never needed the key (they have no all-regions state).
 *
 * PLACEMENT: plugin-local on purpose. It is four lines shaped entirely by how THESE pages were
 * written, and the repo's rule is to default to the plugin folder and promote to library/ only
 * with a named second consumer. If another bundle ever clones DX-life pages the same way, promote
 * it then.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export function useRegionsI18n() {
  const { tm, rt, locale, t: vt } = useI18n()
  // Digits follow the reader's locale, Latin numerals — same rule the count formatters use.
  const fmt = (n) => { try { return Number(n||0).toLocaleString(`${locale.value||'en'}-u-nu-latn`) } catch (_) { return String(n) } }
  // tm() gives the namespace object; rt() resolves a message from it.
  const catalogue = computed(() => {
    try { return tm('regions') || {} } catch (_) { return {} }
  })

  /** t('Prayer Coverage') — their call, verbatim. Unknown key renders as itself. */
  function t(key) {
    const v = catalogue.value?.[key]
    if (v == null) return key
    try { return rt(v) } catch (_) { return typeof v === 'string' ? v : key }
  }

  /**
   * Their %token% substitution (RegionDetail.vue:32-42 explains why they avoid vue-i18n's {0}
   * slots: it empties brace slots when a key resolves with no args and leaves them literal when
   * the key is missing, so neither path interpolates). Same manual replace, so the same strings
   * work in every locale.
   */
  function tf(key, tokens = {}) {
    let out = t(key)
    for (const [k, v] of Object.entries(tokens)) out = out.replace('%' + k + '%', String(v))
    return out
  }

  /**
   * tc('countryCount', n) — a plural-aware count, which t() above CANNOT do.
   *
   * t() resolves through tm()+rt(), and rt() takes a message only: there is nowhere to pass the
   * choice, so a pipe string would come back whole ("a | b | c"). This goes through vue-i18n's
   * own t(key, named, choice) instead, against the SAME regions namespace, so the plural rule
   * installed in library/i18n (CLDR, scoped to exclude en) is what picks the form.
   */
  function tc(key, n) {
    try { return vt(`regions.${key}`, { n: fmt(n) }, Number(n) || 0) } catch (_) { return String(n) }
  }

  return { t, tf, tc, locale }
}
