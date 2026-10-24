// useNeighborT — My UPG Neighbors' UI text: library/i18n/locales/<lc>/neighbor.json (11 locales).
// Chrome only, by decision: research terms, provenance lines and proper
// nouns (SEND, doxa-2000, Bounded set, JP, PPLR…) stay in English as named sources.
// i18n is OPTIONAL: useI18n() throws on a host that never installed it, so the catalogue is the
// fallback, never a blank or a raw key. Call it inside setup().
//
// C4: this file and pplr-data-maps' usePplrT.js were whole-file near-duplicates at Jaccard 0.82 —
// the curation audit's proof that the guard was being COPIED, not shared. Both now call
// library/composables/useOptionalT.js. The local `import enNeighbor from
// '@map/i18n/locales/en/neighbor.json'` went with it: tStatic already walks
// messages[locale].neighbor and already falls back to English.
//
// The NAME stays. Every caller keeps `useNeighborT()`, so this migration changes no call site.
import { useOptionalT } from '@map/composables/useOptionalT.js'

export function useNeighborT() {
  return useOptionalT('neighbor')
}
