/**
 * countryName.js — a country's name in the reader's language.
 *
 * Our data speaks ISO 3166-1 ALPHA-3 ("DEU"). Intl.DisplayNames('region') accepts alpha-2 or UN M49
 * and NOT alpha-3, so every country name was stuck in English until the two were joined. The join is
 * library/data/iso3-to-alpha2.json, derived from vendored CLDR by generate-iso3-to-alpha2.mjs.
 *
 * ★ Intl.DisplayNames THROWS on a missing code. `dn.of(undefined)` is a RangeError, not a null return,
 * so every path here checks the alpha-2 before asking. That is the single defect this file exists to
 * not have: a country absent from the map would otherwise take down whatever rendered it.
 *
 * ★ AND IT THROWS ON A MALFORMED ONE TOO, which is why the regex guard is not redundant with the
 * lookup. dn.of('XYZ') is also a RangeError -- 'structurally invalid' is a different failure from
 * 'not found', and only the second returns the input unchanged.
 *
 * FALLBACK ORDER, each step a real answer rather than a placeholder:
 *   1. the localized name from Intl.DisplayNames
 *   2. the canonical ENGLISH name from library/data/countries.json — a real name in the wrong language
 *      beats a bare code for a reader, and it is what our own tables already show
 *   3. the alpha-3 code itself, so something identifiable always renders
 *
 * No i18n framework is required: this reads a locale STRING the caller already has.
 *
 * ★★ WHERE NOT TO USE THIS, MEASURED. It has NO consumer yet on purpose. Intl's English names
 * differ from the canonical names in library/data/countries.json for 42 OF 242 COUNTRIES -- "Antigua &
 * Barbuda" vs "Antigua and Barbuda", "Cape Verde" vs "Cabo Verde", "Hong Kong SAR China" vs "Hong
 * Kong", "Myanmar (Burma)" vs "Myanmar", "Caribbean Netherlands" vs "Bonaire, Sint Eustatius, and
 * Saba". So this is NOT a drop-in replacement for a name we already display:
 *
 *   ✗ do NOT swap it in where an API already returns a LOCALIZED label. region-dashboards.vue:370
 *     prefers the API's label deliberately, and the regions surfaces are measured against live
 *     doxa.life -- switching the source would change 42 English names and break clone parity, which
 *     is a product decision about which name is canonical, not a refactor.
 *   ✓ DO use it where the only thing in hand is an alpha-3 and there is no label at all, or where
 *     a label arrives in English regardless of the reader's locale. That is the gap it was built for.
 *
 * Stated here rather than left to be discovered, because the failure mode is silent: the names all
 * still look like names.
 */
import table from '../data/iso3-to-alpha2.json'
import countries from '../data/countries.json'

const ALPHA2 = table.map
const ENGLISH = new Map(countries.map((c) => [c.value, c.label]))
const BY_ENGLISH = new Map(countries.map((c) => [String(c.label).trim().toLowerCase(), c.value]))

/** The alpha-2 for an alpha-3 code, or undefined. Exported because callers building URLs and flag
 *  assets need the same lookup, and a second copy of it would drift. */
export function alpha2Of(iso3) {
  return iso3 ? ALPHA2[String(iso3).toUpperCase()] : undefined
}

/**
 * The alpha-3 for a canonical ENGLISH country name, or undefined.
 *
 * ★ FOR LABELS THAT ARRIVE IN ENGLISH WITH NO CODE ATTACHED — the case the header's ✓ names. Big
 * Picture's top-countries chart aggregates on the prayer API's English country LABEL, so by the time a
 * bar is drawn the alpha-3 is gone and only "India" is in hand. Reversing our own countries.json is
 * exact where it matches and silent where it does not, which is the only safe shape here: an unmatched
 * name keeps rendering as itself rather than becoming a code or a blank.
 *
 * Built from the SAME table englishName() reads, so the two can never disagree about which name is
 * canonical. Names are compared case-insensitively and trimmed; nothing else is normalized, because a
 * looser match is how "Congo" would quietly become the wrong country.
 */
export function iso3ForEnglishName(name) {
  if (!name) return undefined
  return BY_ENGLISH.get(String(name).trim().toLowerCase())
}

/** The canonical English name, or undefined. */
export function englishName(iso3) {
  return iso3 ? ENGLISH.get(String(iso3).toUpperCase()) : undefined
}

// One DisplayNames per locale. Constructing it is not cheap and a country list rebuilds it per row;
// a Map keyed by locale is the whole optimisation. A locale that throws is cached as null so the
// failure costs one construction, not one per call.
const cache = new Map()
function displayNames(locale) {
  const key = locale || 'en'
  if (cache.has(key)) return cache.get(key)
  let dn = null
  try {
    dn = new Intl.DisplayNames([key], { type: 'region' })
  } catch (_) {
    dn = null            // an unsupported locale tag, or no Intl.DisplayNames at all
  }
  cache.set(key, dn)
  return dn
}

/**
 * @param {string} iso3    ISO 3166-1 alpha-3, e.g. 'DEU'. Case-insensitive.
 * @param {string} [locale] BCP-47 tag, e.g. 'ar'. Defaults to English.
 * @returns {string} the country's name in that locale, its English name, or the code.
 */
export function countryName(iso3, locale) {
  const code = iso3 ? String(iso3).toUpperCase() : ''
  const a2 = ALPHA2[code]
  const fallback = ENGLISH.get(code) || code

  // Guard BEFORE asking: dn.of(undefined) and dn.of('XYZ') both throw.
  if (!a2 || !/^[A-Z]{2}$/.test(a2)) return fallback

  const dn = displayNames(locale)
  if (!dn) return fallback
  try {
    const name = dn.of(a2)
    // An UNKNOWN-but-well-formed region comes back as the input string. That is not a name, so it
    // must not win over our English label -- this is the difference between "no translation exists"
    // and "the translation is literally 'DE'".
    return name && name !== a2 ? name : fallback
  } catch (_) {
    return fallback
  }
}

export default countryName
