// usePplrT — PPLR's UI text: library/i18n/locales/<lc>/pplr.json, in all eleven locales.
// i18n is OPTIONAL: useI18n() throws on a host that never installed it, so the catalogue is the
// fallback, never a blank or a raw key. Call it inside setup().
//
// C4: the guard, the English fallback and the {param} fill used to be written out here and in
// useNeighborT.js at Jaccard 0.82 — the same fact stored twice, and eighteen more times elsewhere.
// They now come from library/composables/useOptionalT.js. The local `import enPplr from
// '@map/i18n/locales/en/pplr.json'` went with them: tStatic already walks messages[locale].pplr and
// already falls back to English, so that import was a second copy of the same bytes.
//
// The NAME stays. Every caller keeps `usePplrT()`, so this migration changes no call site.
import { useOptionalT } from '@map/composables/useOptionalT.js'

export function usePplrT() {
  return useOptionalT('pplr')
}
