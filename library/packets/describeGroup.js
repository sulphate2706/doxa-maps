/**
 * describeGroup.js — one localized sentence pair describing a people group, built ONLY from API fields.
 *
 * THE BRIEF: the packet's profile rows carry a short GENERATED description built from the API
 * variables, localized: how lost/unreached they are, where (country), what language they speak.
 * ~20 rows per page, so it has to be short, and it has to be right in eleven languages.
 *
 * PURE. (group, locale) -> string. No refs, no map, no fetch. The strings object is the third argument
 * so a test can inject one; it defaults to the packet's own catalogue, which is what the renderer
 * already loads (usePosterPrints.js:209).
 *
 * ★ THE LEVEL IS PHRASED FROM GSEC, A NUMBER — never from EvangelicalLevel or GSECDescription, which are
 * ENGLISH PROSE the API and the CSV hand us ("2% or Greater but Less than 5%"). Interpolating either
 * leaves the widest column of every non-English packet in English, which is the leak class this repo
 * spent 2026-09-28 removing. GSEC is 0-6 and present on all 12,379 rows, so it maps to a key per level.
 *
 * ★ AND IT DOES NOT SAY "unreached" OR "frontier". The packet's funnel page already defines both
 * (packet-strings funnel_unreached "under 2% evangelical", funnel_frontier "0.1% or less"). GSEC carries
 * the 2% line — levels 0-3 are exactly "fewer than 2%", 7,307 of 12,379 rows — but NOTHING in GSEC
 * encodes 0.1%: no GSECDescription or GSECLongDescription mentions it (checked by upg100 and by me,
 * independently). Deriving "frontier" from GSEC would assert something the field does not carry, and
 * §E of the same brief has the UPG/FPG calculation open. So the wording agrees with the funnel's 2%
 * line and stops there; when E lands it is one more key, not a rewrite.
 *
 * ★ TWO SENTENCES, NOT ONE, AND THAT IS WHY THE FALLBACKS WORK. upg100 authored seven whole sentences
 * whose FIRST half is identical in all seven, deliberately, so a translator writes it once. Splitting
 * that shared half into its own key makes the saving real instead of aspirational, and it is the only
 * shape in which their own fallback rule can be expressed: drop the clause, never blank the row. Their
 * English is preserved verbatim; only the seam moved. Each key is a COMPLETE sentence — the thing rule 1
 * forbids is assembling one sentence from fragments, which is how a Hindi verb ends up in the wrong
 * place; two finished sentences in sequence carry no such risk.
 *
 * KEYS (packet-strings.json, beside funnel_*):
 *   desc_where_both      "The {people} live in {country} and speak {language}."
 *   desc_where_country   "The {people} live in {country}."          — language unknown (1 row of 12,379)
 *   desc_where_language  "The {people} speak {language}."           — country unknown
 *   desc_gsec_0 … _6     the level sentence, one per GSEC value
 */
import { naturalLanguageLabel } from '../utils/languageLabel.js'

const LEVELS = [0, 1, 2, 3, 4, 5, 6]

/**
 * Unwrap the API's { value, label } pair to its VALUE — the same flattening normalize.js:22 applies, done
 * here so a caller that hands us a RAW record gets the same answer as one that hands us a normalized one.
 *
 * ★ WITHOUT THIS, Number({value:'1'}) IS NaN AND THE WHOLE GSEC SENTENCE DISAPPEARS. Not an error, not a
 * fallback: the level clause is simply absent, and the row reads as a people group nobody has a reached-
 * ness figure for. upg100 hit it and fixed their own normalizer (3b644893), which fixes their caller and
 * nobody else's — every other consumer passing the raw record loses the sentence the same silent way. The
 * unwrap belongs here, at the read, because this function's contract is "an API/normalized row" and both
 * spellings are in that contract.
 */
const unwrap = (v) => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? v.value : v)

/** The first field present, trimmed; '' when none is. Accepts both the API and normalized spellings. */
const pick = (group, ...names) => {
  for (const n of names) {
    const v = unwrap(group && group[n])
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/**
 * The DISPLAY half of the same pair, and only when the field really is one. A raw record carries the
 * human name at `<field>.label`; a normalized one moved it to `<field>_label` and left `<field>` holding a
 * CODE. So this returns a label ONLY for a nested object and '' for a bare string — consulting a
 * flattened `primary_language` would print "and speak abf", which is the defect the field comment below
 * exists to prevent. Same rule, opposite half: pick() takes the value, labelOf() takes the name.
 */
const labelOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? String(v.label ?? '').trim() : '')

const fill = (tpl, params) =>
  String(tpl).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m))

/**
 * Cut at a WORD boundary and mark it. Physical width is the real budget (the profile column is ~1/5 of
 * a card in packet-render's 2x10 grid), so the caller measures and decides; this only guarantees that a
 * limit, when given, is honoured without slicing a word in half. No limit by default.
 */
const clip = (s, max) => {
  if (!max || s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…'
}

/**
 * @param {Object} group   an API/normalized people-group row
 * @param {string} locale  e.g. 'ar'; falls back to 'en' when the catalogue has no such block
 * @param {Object} [opts]
 * @param {Object} [opts.strings]  the packet strings object ({ en: {...}, ar: {...} })
 * @param {function} [opts.countryName] (iso3, locale) => localized country name; see below for why
 *                                      this is injected and what happens when it is not
 * @param {number} [opts.maxChars] optional hard cap, cut at a word boundary
 * @returns {string} '' when the group carries none of the three facts
 */
export function describeGroup(group, locale, opts = {}) {
  const strings = opts.strings || {}
  const lc = String(locale || 'en').split('-')[0].toLowerCase()
  const block = strings[lc] || strings.en || {}
  const en = strings.en || {}
  const key = (k) => block[k] || en[k] || ''

  const people = pick(group, 'name', 'Name', 'peopleName')
  // The country is resolved to the READER's language from its code — the packet fetch carries
  // country_code, and country_code_label is the API's ENGLISH name, which is a leak in a Hindi packet.
  //
  // ★ THE RESOLVER IS INJECTED RATHER THAN IMPORTED, and that is a testability decision, not a style
  // one. library/utils/countryName.js is reachable only through the Vite '@map/' alias and imports two
  // JSON files without an import attribute — both fine in a bundle, both fatal to `node internal/
  // check-describe-group.mjs`, which is the gate that proves this function right in eleven languages.
  // Importing it would make this module unloadable by its own test. So the packet renderer, which runs
  // inside Vite and can import it, passes it in: opts.countryName = (iso, locale) => string.
  //
  // ★ AND THE FALLBACK IS THE SAME LADDER countryName.js WALKS, so forgetting to inject degrades the
  // way that file already documents rather than blanking the clause: localized name → the canonical
  // English name we already show in our own tables → the alpha-3 code, so something identifiable
  // always renders. A missing injection is an English country name, never an empty row.
  const iso = pick(group, 'country_code', 'countryIso', 'ISOAlpha3', 'countryCode')
  const country = (iso && opts.countryName ? opts.countryName(iso, lc) : '')
    || pick(group, 'country_code_label')
    || labelOf(group && group.country_code)
    || pick(group, 'country', 'CountryName', 'countryName')
    || iso
  // A language NAME is a proper noun; it is not translated, and there is no source that would.
  //
  // ★ IT IS primary_language_LABEL, NOT primary_language. primary_language is in normalize.js's
  // NESTED_FIELDS, so the API's { value, label } is flattened to its VALUE -- an ISO 639-3 code. Reading
  // it would print "and speak abf". The label is the name. There is deliberately no fall-back to the
  // code: upg100's rule for a missing field is DROP THE CLAUSE, never blank the row, and a bare code is
  // worse for a reader than no clause at all -- so an unresolvable language falls to desc_where_country.
  //
  // ★ AND THE LABEL IS INDEX-ORDERED: the API hands us "Arabic, Shihhi" for what reads "Shihhi Arabic".
  // 725 of 12,379 rows carry one. naturalLanguageLabel un-inverts it, sharing its split with the
  // language-family legend so the two readings of the same field cannot drift apart.
  const language = naturalLanguageLabel(
    pick(group, 'primary_language_label')
    || labelOf(group && group.primary_language)
    || pick(group, 'LanguageName', 'languageName'),
  )

  const whereKey = language && country ? 'desc_where_both'
    : country ? 'desc_where_country'
      : language ? 'desc_where_language' : ''
  const where = whereKey && people ? fill(key(whereKey), { people, country, language }) : ''

  // imb_gsec is the API's spelling (upg100 added it to the packet fetch); GSEC is the CSV's.
  const gsecRaw = pick(group, 'imb_gsec', 'gsec', 'GSEC')
  const gsec = gsecRaw === '' ? null : Number(gsecRaw)
  const level = LEVELS.includes(gsec) ? key(`desc_gsec_${gsec}`) : ''

  return clip([where, level].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(), opts.maxChars)
}

export default describeGroup
