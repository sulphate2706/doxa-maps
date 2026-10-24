/**
 * useGiT.js — the house translation alias, T(key, en, params): the catalogue's string in the reader's
 * language, else the English written at the call site.
 *
 * The English argument is not a second catalogue. vue-i18n's own fallback is the ENGLISH CATALOGUE
 * ENTRY, so a key missing from every locale would render as the raw key ("gospelInternet.foo"); the
 * call-site English is what keeps a missing key readable while check:i18n-keys-exist reports it.
 * Keys are always FULL dotted paths (gospelInternet.*, buttons.*, …) so that gate can read them.
 */
import { useOptionalT, fillParams } from '@map/composables/useOptionalT.js'

export function useGiT() {
  const t = useOptionalT()
  return (key, en, params) => {
    let v
    try { v = t(key, params) } catch (_) { v = key }
    return !v || v === key ? fillParams(en ?? key, params) : v
  }
}
